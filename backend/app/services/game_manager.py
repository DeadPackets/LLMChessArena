from __future__ import annotations

import asyncio
from collections import deque
import logging
import secrets as secrets_mod
from datetime import datetime, timezone
from uuid import uuid4

import chess
import chess.pgn
from sqlmodel import select
from sqlalchemy import update as sa_update, delete as sa_delete
from sqlalchemy.exc import OperationalError

from app.config import (
    MAX_CONCURRENT_GAMES,
    DEFAULT_MODEL_ELO,
    MAX_QUEUED_GAMES,
    MAX_WS_EVENT_QUEUE_SIZE,
)
from app.database import Game, Move, LLMModel, get_session_factory
from app.models.chess_models import GameConfig, GameResult, MoveRecord
from app.services.elo_service import (
    calculate_elo_change,
    rating_display,
    rating_key,
    score_white_from_outcome,
    temperature_is_default,
)
from app.services.game_engine import GameEngine
from app.services.opening_detector import OpeningDetector
from app.services.stockfish_service import StockfishService
from app.services.stockfish_player_service import StockfishPlayerService

logger = logging.getLogger(__name__)


def side_label(
    is_human: bool, is_stockfish: bool, model: str, sf_elo: int | None = None
) -> str:
    """Raw player label stored in Game.white_model/black_model and shown per-game.

    LLMs use their model id; Human/Stockfish get a fixed label (strength-limited
    Stockfish carries its ELO). The leaderboard *identity* is derived from this via
    ``elo_service.rating_key`` (which adds the reasoning tier for LLMs)."""
    if is_human:
        return "Human"
    if is_stockfish:
        return f"Stockfish ({sf_elo})" if sf_elo else "Stockfish"
    return model


def _game_rating_keys(g: Game) -> tuple[str, str]:
    """(white_key, black_key) leaderboard identities for a stored game row."""
    wk = rating_key(
        g.white_model,
        g.white_reasoning_effort,
        bool(g.white_is_human),
        bool(g.white_is_stockfish),
    )
    bk = rating_key(
        g.black_model,
        g.black_reasoning_effort,
        bool(g.black_is_human),
        bool(g.black_is_stockfish),
    )
    return wk, bk


def pgn_from_sans(white: str, black: str, sans: list[str]) -> str:
    """Rebuild a partial PGN from persisted SANs (stopped/errored games)."""
    game = chess.pgn.Game()
    game.headers["Event"] = "LLM Chess Arena"
    game.headers["White"] = white
    game.headers["Black"] = black
    game.headers["Result"] = "*"
    node: chess.pgn.GameNode = game
    board = chess.Board()
    for san in sans:
        try:
            move = board.push_san(san)
        except ValueError:
            break  # chaos-mode SANs can be unreplayable; keep the valid prefix
        node = node.add_variation(move)
    return str(game)


def game_eligible_for_elo(g: Game) -> bool:
    """Whether a stored game counts toward ELO under the current rules.

    Excludes chaos games, strength-limited Stockfish, and games where either LLM
    side used a non-default temperature. Requires a completed game with a decisive
    or drawn outcome. This is the single predicate shared by the live persist path
    and ``recompute_all_elo`` so the leaderboard and the ELO-history chart agree.
    """
    if g.status != "completed":
        return False
    if g.outcome not in ("white_wins", "black_wins", "draw"):
        return False
    # API-error forfeits are infra failures, not chess results.
    if g.termination == "api_error":
        return False
    if g.chaos_mode:
        return False
    if g.white_stockfish_elo is not None or g.black_stockfish_elo is not None:
        return False
    white_is_llm = not (g.white_is_human or g.white_is_stockfish)
    black_is_llm = not (g.black_is_human or g.black_is_stockfish)
    if white_is_llm and not temperature_is_default(g.white_temperature):
        return False
    if black_is_llm and not temperature_is_default(g.black_temperature):
        return False
    # Self-play (same identity on both sides) can't move a rating against itself —
    # one entity would be credited a win and a loss simultaneously. Skip it.
    wk, bk = _game_rating_keys(g)
    if wk == bk:
        return False
    return True


class GameManager:
    """Manages active games as background tasks and persists results to the DB."""

    def __init__(
        self,
        stockfish: StockfishService,
        opening_detector: OpeningDetector | None = None,
    ):
        self.stockfish = stockfish
        self.opening_detector = opening_detector
        self.active_games: dict[str, asyncio.Task] = {}
        self.event_queues: dict[str, list[asyncio.Queue]] = {}
        self.human_move_queues: dict[str, asyncio.Queue] = {}
        self._awaiting_human_move: dict[
            str, str | None
        ] = {}  # game_id -> color or None
        self.player_secrets: dict[str, str] = {}  # game_id -> secret token
        self._semaphore = asyncio.Semaphore(MAX_CONCURRENT_GAMES)
        self._queued_games: deque[str] = deque()  # game IDs waiting for a slot
        self._running_games: set[str] = set()  # game IDs currently executing
        logger.info(
            "GameManager: max concurrent games = %d, max queued games = %d",
            MAX_CONCURRENT_GAMES,
            MAX_QUEUED_GAMES,
        )

    def can_accept_new_game(self) -> bool:
        return len(self._queued_games) < MAX_QUEUED_GAMES

    async def recover_orphaned_games(self) -> None:
        """Mark any games left as 'active' in the DB but with no running task.

        This handles the case where the server restarted mid-game. Since board
        state is not persisted, these games cannot be resumed and must be
        terminated cleanly.
        """
        now = datetime.now(timezone.utc)
        async with get_session_factory()() as session:
            results = await session.exec(
                select(Game).where(
                    (Game.status == "active") | (Game.status == "queued")
                )
            )
            orphaned = results.all()
            for game in orphaned:
                if game.id not in self.active_games:
                    logger.warning(
                        "Orphaned game %s (%s vs %s, %d moves): marking as completed (server_restart)",
                        game.id,
                        game.white_model,
                        game.black_model,
                        game.total_moves or 0,
                    )
                    game.status = "stopped"
                    game.outcome = "*"
                    game.termination = "server_restart"
                    game.completed_at = now
                    session.add(game)
            if orphaned:
                await session.commit()
                logger.info("Recovered %d orphaned game(s)", len(orphaned))

    async def start_game(
        self, config: GameConfig, player_secret: str | None = None
    ) -> tuple[str, str]:
        """Create a game record and start it as a background task."""
        game_id = uuid4().hex[:12]
        now = datetime.now(timezone.utc)
        is_queued = self._semaphore.locked()

        if is_queued and not self.can_accept_new_game():
            raise ValueError("Game queue is full. Please try again later.")

        white_label = side_label(
            config.white_is_human,
            config.white_is_stockfish,
            config.white_model,
            config.white_stockfish_elo,
        )
        black_label = side_label(
            config.black_is_human,
            config.black_is_stockfish,
            config.black_model,
            config.black_stockfish_elo,
        )
        logger.info(
            "Creating game %s: %s (white) vs %s (black)",
            game_id,
            white_label,
            black_label,
        )

        # Register leaderboard entries. LLMs are keyed by (model + reasoning tier);
        # Human/Stockfish keep their plain label. Game.white_model still stores the
        # raw label (above) for per-game display; the composite is the rating identity.
        await self._ensure_model(
            rating_key(white_label, config.white_reasoning_effort,
                       config.white_is_human, config.white_is_stockfish),
            rating_display(white_label, config.white_reasoning_effort,
                           config.white_is_human, config.white_is_stockfish),
        )
        await self._ensure_model(
            rating_key(black_label, config.black_reasoning_effort,
                       config.black_is_human, config.black_is_stockfish),
            rating_display(black_label, config.black_reasoning_effort,
                           config.black_is_human, config.black_is_stockfish),
        )

        if player_secret:
            self.player_secrets[game_id] = player_secret

        async with get_session_factory()() as session:
            game = Game(
                id=game_id,
                white_model=white_label,
                black_model=black_label,
                status="queued" if is_queued else "active",
                started_at=now,
                white_temperature=config.white_temperature,
                black_temperature=config.black_temperature,
                white_reasoning_effort=config.white_reasoning_effort,
                black_reasoning_effort=config.black_reasoning_effort,
                white_is_human=config.white_is_human,
                black_is_human=config.black_is_human,
                white_is_stockfish=config.white_is_stockfish,
                black_is_stockfish=config.black_is_stockfish,
                white_stockfish_elo=config.white_stockfish_elo,
                black_stockfish_elo=config.black_stockfish_elo,
                player_secret=player_secret,
                chaos_mode=config.chaos_mode,
                move_time_limit=config.move_time_limit,
                draw_adjudication=config.draw_adjudication,
            )
            session.add(game)
            await session.commit()

        task = asyncio.create_task(self._run_game(game_id, config))
        self.active_games[game_id] = task
        logger.info("Game %s: background task started", game_id)
        return game_id, ("queued" if is_queued else "active")

    def subscribe(self, game_id: str) -> asyncio.Queue:
        """Subscribe to real-time events for a game."""
        queue: asyncio.Queue = asyncio.Queue(maxsize=MAX_WS_EVENT_QUEUE_SIZE)
        self.event_queues.setdefault(game_id, []).append(queue)
        count = len(self.event_queues[game_id])
        logger.debug("Game %s: WebSocket subscriber added (total: %d)", game_id, count)
        self._fire_and_forget(self._broadcast_spectator_count(game_id))
        return queue

    def unsubscribe(self, game_id: str, queue: asyncio.Queue) -> None:
        queues = self.event_queues.get(game_id, [])
        if queue in queues:
            queues.remove(queue)
        logger.debug("Game %s: WebSocket subscriber removed", game_id)
        if game_id in self.event_queues:
            self._fire_and_forget(self._broadcast_spectator_count(game_id))

    def get_spectator_count(self, game_id: str) -> int:
        return len(self.event_queues.get(game_id, []))

    def total_spectators(self) -> int:
        """Total live WebSocket spectators across all games."""
        return sum(len(queues) for queues in self.event_queues.values())

    async def _broadcast_spectator_count(self, game_id: str) -> None:
        count = self.get_spectator_count(game_id)
        await self._broadcast(
            game_id,
            {
                "type": "spectator_count",
                "data": {"count": count},
            },
        )

    async def stop_game(self, game_id: str) -> bool:
        """Stop an active game. Does not count for ELO."""
        task = self.active_games.get(game_id)
        if task and not task.done():
            logger.info("Game %s: stop requested, cancelling task", game_id)
            total_moves = 0
            async with get_session_factory()() as session:
                game = await session.get(Game, game_id)
                if game:
                    # Idempotent: if a terminal write already landed, don't clobber it.
                    if game.status in {"completed", "stopped"}:
                        logger.info(
                            "Game %s: stop requested but already %s; skipping write",
                            game_id,
                            game.status,
                        )
                    else:
                        game.status = "stopped"
                        game.outcome = "*"
                        game.termination = "stopped"
                        game.completed_at = datetime.now(timezone.utc)
                        # total_moves/pgn are only written at completion; count the
                        # already-persisted moves so a stopped game keeps its record.
                        moves_res = await session.exec(
                            select(Move)
                            .where(Move.game_id == game_id)
                            .order_by(Move.id)  # type: ignore[arg-type]
                        )
                        move_rows = list(moves_res.all())
                        game.total_moves = len(move_rows)
                        if move_rows:
                            game.pgn = pgn_from_sans(
                                game.white_model,
                                game.black_model,
                                [m.san for m in move_rows],
                            )
                        session.add(game)
                        await session.commit()
                    total_moves = game.total_moves or 0
            # Broadcast game_over so WS clients update cleanly
            await self._broadcast(
                game_id,
                {
                    "type": "game_over",
                    "data": {
                        "outcome": "*",
                        "termination": "stopped",
                        "total_moves": total_moves,
                    },
                },
            )
            task.cancel()
            return True
        return False

    async def delete_game(self, game_id: str) -> bool:
        """Hard-delete a game and its moves (admin action).

        Cancels the game if it is still running so its task and in-memory state
        are torn down cleanly, then removes the DB rows. ELO is intentionally
        left untouched. Returns False if no such game exists.
        """
        async with get_session_factory()() as session:
            game_row = await session.get(Game, game_id)
            exists = game_row is not None
            was_rated = bool(game_row.rated) if game_row else False
        is_active = game_id in self.active_games
        is_queued = game_id in self._queued_games
        if not exists and not is_active and not is_queued:
            return False

        logger.info(
            "Game %s: admin delete requested (rated=%s)", game_id, was_rated
        )

        # Tell spectators the game is gone before we tear down their queues.
        await self._broadcast(
            game_id, {"type": "game_deleted", "data": {"game_id": game_id}}
        )

        # Cancel a running task; its finally-block frees the semaphore slot and
        # pops the in-memory dicts (active_games, event_queues, ...).
        task = self.active_games.get(game_id)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

        # Drop it from the wait queue if it never started.
        try:
            self._queued_games.remove(game_id)
        except ValueError:
            pass

        # Defensive cleanup for non-active games (the finally-block above already
        # handles games that were running).
        self.player_secrets.pop(game_id, None)
        self.human_move_queues.pop(game_id, None)
        self._awaiting_human_move.pop(game_id, None)
        self._running_games.discard(game_id)
        for q in self.event_queues.pop(game_id, []):
            try:
                q.put_nowait(None)
            except asyncio.QueueFull:
                pass

        # Hard-delete: moves first (FK-free, but keeps the row count honest), then the game.
        async with get_session_factory()() as session:
            await session.exec(sa_delete(Move).where(Move.game_id == game_id))  # type: ignore[call-overload]
            game = await session.get(Game, game_id)
            if game:
                await session.delete(game)
            await session.commit()

        # A removed rated game invalidates every later rating — rebuild from scratch.
        if was_rated:
            await self.recompute_all_elo()

        logger.info("Game %s: deleted (elo_recomputed=%s)", game_id, was_rated)
        return True

    async def validate_player_secret(self, game_id: str, secret: str | None) -> bool:
        """Check if the provided secret matches the game's player secret."""
        expected = self.player_secrets.get(game_id)
        if expected is None:
            async with get_session_factory()() as session:
                game = await session.get(Game, game_id)
                expected = game.player_secret if game else None
        if not expected:
            return False
        return secrets_mod.compare_digest(expected, secret or "")

    async def submit_human_move(
        self, game_id: str, uci: str, color: str | None = None
    ) -> tuple[bool, str | None]:
        """Submit a human move for an active game.

        Returns (accepted, reason). `reason` is a short message to relay back to
        the client when rejected, so the UI can re-enable the board.
        """
        queue = self.human_move_queues.get(game_id)
        if queue is None:
            logger.warning("Game %s: human move submitted but no queue exists", game_id)
            return False, "This game is not accepting moves."

        # The game must currently be awaiting a human move.
        awaiting = self._awaiting_human_move.get(game_id)
        if awaiting is None:
            return False, "It is not your turn yet."

        # If the caller's color is known, it must match the side to move.
        if color is not None and color != awaiting and uci != "resign":
            return False, "It is not your turn yet."

        try:
            queue.put_nowait(uci)
        except asyncio.QueueFull:
            logger.warning("Game %s: human move queue full, rejecting", game_id)
            return False, "A move is already being processed — try again."
        return True, None

    async def get_catch_up_state(self, game_id: str) -> dict | None:
        """Get full game state for a late-joining WebSocket client."""
        async with get_session_factory()() as session:
            game = await session.get(Game, game_id)
            if not game:
                return None

            results = await session.exec(
                select(Move).where(Move.game_id == game_id).order_by(Move.id)  # type: ignore[arg-type]
            )
            move_rows = results.all()

        moves = []
        last_fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
        for m in move_rows:
            last_fen = m.fen_after
            moves.append(
                {
                    "move_number": m.move_number,
                    "color": m.color,
                    "uci": m.uci,
                    "san": m.san,
                    "fen_after": m.fen_after,
                    "narration": m.narration,
                    "table_talk": m.table_talk,
                    "centipawns": m.centipawns,
                    "mate_in": m.mate_in,
                    "win_probability": m.win_probability,
                    "best_move_uci": m.best_move_uci,
                    "classification": m.classification,
                    "response_time_ms": m.response_time_ms or 0,
                    "opening_eco": m.opening_eco,
                    "opening_name": m.opening_name,
                    "input_tokens": m.input_tokens,
                    "output_tokens": m.output_tokens,
                    "cost_usd": m.cost_usd,
                    "is_chaos_move": bool(m.is_chaos_move),
                }
            )

        return {
            "type": "catch_up",
            "data": {
                "game_id": game.id,
                "white_model": game.white_model,
                "black_model": game.black_model,
                "status": game.status,
                "outcome": game.outcome,
                "termination": game.termination,
                "fen": last_fen,
                "moves": moves,
                "white_temperature": game.white_temperature,
                "black_temperature": game.black_temperature,
                "white_reasoning_effort": game.white_reasoning_effort,
                "black_reasoning_effort": game.black_reasoning_effort,
                "white_is_human": bool(game.white_is_human),
                "black_is_human": bool(game.black_is_human),
                "white_is_stockfish": bool(game.white_is_stockfish),
                "black_is_stockfish": bool(game.black_is_stockfish),
                "awaiting_human_move": self._awaiting_human_move.get(game.id),
                "chaos_mode": bool(game.chaos_mode),
                "white_stockfish_elo": game.white_stockfish_elo,
                "black_stockfish_elo": game.black_stockfish_elo,
                "move_time_limit": game.move_time_limit,
                "draw_adjudication": bool(game.draw_adjudication)
                if game.draw_adjudication is not None
                else True,
                "spectator_count": self.get_spectator_count(game_id),
            },
        }

    def queue_status(self) -> dict:
        """Return current queue state."""
        return {
            "active": len(self._running_games),
            "queued": len(self._queued_games),
            "max": MAX_CONCURRENT_GAMES,
            "max_queued": MAX_QUEUED_GAMES,
        }

    async def _run_game(self, game_id: str, config: GameConfig) -> None:
        """Execute a full game, waiting for a semaphore slot if at capacity."""
        if self._semaphore.locked():
            self._queued_games.append(game_id)
            position = self._queued_games.index(game_id) + 1
            logger.info("Game %s: queued (position %d)", game_id, position)
            async with get_session_factory()() as session:
                game = await session.get(Game, game_id)
                if game and game.status != "queued":
                    game.status = "queued"
                    session.add(game)
                    await session.commit()
            await self._broadcast(
                game_id,
                {
                    "type": "queued",
                    "data": {
                        "position": position,
                        "active": len(self._running_games),
                        "max": MAX_CONCURRENT_GAMES,
                    },
                },
            )

        async with self._semaphore:
            if game_id in self._queued_games:
                self._queued_games.remove(game_id)
            self._running_games.add(game_id)
            logger.info(
                "Game %s: acquired slot (%d/%d active)",
                game_id,
                len(self._running_games),
                MAX_CONCURRENT_GAMES,
            )
            try:
                async with get_session_factory()() as session:
                    game = await session.get(Game, game_id)
                    if game and game.status != "active":
                        game.status = "active"
                        session.add(game)
                        await session.commit()
                await self._run_game_inner(game_id, config)
            finally:
                self._running_games.discard(game_id)

    async def _run_game_inner(self, game_id: str, config: GameConfig) -> None:
        """Execute a full game and persist results."""
        logger.info("Game %s: engine initializing", game_id)

        # Create human move queue if either side is human
        human_queue: asyncio.Queue | None = None
        if config.white_is_human or config.black_is_human:
            human_queue = asyncio.Queue(maxsize=2)
            self.human_move_queues[game_id] = human_queue

        # Create strength-limited Stockfish player(s) if needed
        stockfish_player_white: StockfishPlayerService | None = None
        stockfish_player_black: StockfishPlayerService | None = None
        if config.white_is_stockfish and config.white_stockfish_elo is not None:
            stockfish_player_white = StockfishPlayerService()
            await stockfish_player_white.start(elo=config.white_stockfish_elo)
        if config.black_is_stockfish and config.black_stockfish_elo is not None:
            stockfish_player_black = StockfishPlayerService()
            await stockfish_player_black.start(elo=config.black_stockfish_elo)
        stockfish_player = stockfish_player_white or stockfish_player_black

        engine = GameEngine(
            config,
            stockfish=self.stockfish,
            stockfish_player=stockfish_player,
            stockfish_player_white=stockfish_player_white,
            stockfish_player_black=stockfish_player_black,
            opening_detector=self.opening_detector,
            human_move_queue=human_queue,
            game_id=game_id,
        )

        async def on_move(record: MoveRecord) -> None:
            self._awaiting_human_move.pop(game_id, None)
            await self._persist_move(game_id, record)
            await self._broadcast(
                game_id,
                {
                    "type": "move_played",
                    "data": record.model_dump(),
                },
            )

        async def on_status(message: str) -> None:
            await self._broadcast(
                game_id,
                {
                    "type": "status",
                    "data": {"message": message},
                },
            )

        async def on_illegal_move(event: dict) -> None:
            await self._handle_illegal_move(game_id, event)

        async def on_awaiting_human_move(color: str) -> None:
            self._awaiting_human_move[game_id] = color
            await self._broadcast(
                game_id,
                {
                    "type": "awaiting_human_move",
                    "data": {"color": color},
                },
            )

        async def on_chaos_move(event: dict) -> None:
            await self._broadcast(
                game_id,
                {
                    "type": "chaos_move_detected",
                    "data": event,
                },
            )

        engine.move_callbacks.append(on_move)
        engine.illegal_move_callbacks.append(on_illegal_move)
        engine.chaos_move_callbacks.append(on_chaos_move)
        engine.status_callback = on_status
        engine.awaiting_human_move_callback = on_awaiting_human_move

        # Broadcast game started
        await self._broadcast(
            game_id,
            {
                "type": "game_started",
                "data": {
                    "game_id": game_id,
                    "white_model": "Stockfish"
                    if config.white_is_stockfish
                    else "Human"
                    if config.white_is_human
                    else config.white_model,
                    "black_model": "Stockfish"
                    if config.black_is_stockfish
                    else "Human"
                    if config.black_is_human
                    else config.black_model,
                    "white_is_human": config.white_is_human,
                    "black_is_human": config.black_is_human,
                    "white_is_stockfish": config.white_is_stockfish,
                    "black_is_stockfish": config.black_is_stockfish,
                    "white_stockfish_elo": config.white_stockfish_elo,
                    "black_stockfish_elo": config.black_stockfish_elo,
                    "white_reasoning_effort": config.white_reasoning_effort,
                    "black_reasoning_effort": config.black_reasoning_effort,
                    "white_temperature": config.white_temperature,
                    "black_temperature": config.black_temperature,
                    "chaos_mode": config.chaos_mode,
                    "move_time_limit": config.move_time_limit,
                    "draw_adjudication": config.draw_adjudication,
                },
            },
        )

        try:
            result = await engine.play_game()
            logger.info(
                "Game %s: completed — %s by %s, %d moves, cost $%.4f",
                game_id,
                result.outcome,
                result.termination,
                result.total_moves,
                result.total_cost_usd,
            )
            # Leaderboard identities (model + reasoning tier for LLMs; plain label
            # for Human/Stockfish). Game.white_model keeps the raw label for
            # per-game display; these composite keys are the rating identity.
            white_label = side_label(
                config.white_is_human, config.white_is_stockfish,
                config.white_model, config.white_stockfish_elo,
            )
            black_label = side_label(
                config.black_is_human, config.black_is_stockfish,
                config.black_model, config.black_stockfish_elo,
            )
            white_key = rating_key(
                white_label, config.white_reasoning_effort,
                config.white_is_human, config.white_is_stockfish,
            )
            black_key = rating_key(
                black_label, config.black_reasoning_effort,
                config.black_is_human, config.black_is_stockfish,
            )

            # Rated unless chaos, strength-limited Stockfish, or a side used a
            # non-default temperature. Changing reasoning effort is allowed (it
            # ranks as a separate leaderboard entry).
            has_limited_sf = (
                config.white_stockfish_elo is not None
                or config.black_stockfish_elo is not None
            )
            white_is_llm = not (config.white_is_human or config.white_is_stockfish)
            black_is_llm = not (config.black_is_human or config.black_is_stockfish)
            custom_temp = (
                white_is_llm and not temperature_is_default(config.white_temperature)
            ) or (
                black_is_llm and not temperature_is_default(config.black_temperature)
            )
            self_play = white_key == black_key
            api_error_forfeit = result.termination == "api_error"
            skip_elo = (
                config.chaos_mode
                or has_limited_sf
                or custom_temp
                or self_play
                or api_error_forfeit
            )
            reason = ""
            if skip_elo:
                reason = (
                    "chaos mode"
                    if config.chaos_mode
                    else "strength-limited Stockfish"
                    if has_limited_sf
                    else "custom temperature"
                    if custom_temp
                    else "self-play"
                    if self_play
                    else "API-error forfeit"
                )
                logger.info("Game %s: skipping ELO update (%s)", game_id, reason)
            wrote = await self._persist_result(
                game_id,
                result,
                apply_elo=not skip_elo,
                white_key=white_key,
                black_key=black_key,
            )
            logger.info(
                "Game %s: results persisted%s%s",
                game_id,
                "" if wrote else " (already terminal — skipped)",
                f" (ELO skipped — {reason})" if skip_elo else " and ELO updated",
            )
            await self._broadcast(
                game_id,
                {
                    "type": "game_over",
                    "data": {
                        "outcome": result.outcome,
                        "termination": result.termination,
                        "total_moves": result.total_moves,
                        "total_cost_usd": result.total_cost_usd,
                        "total_input_tokens": result.total_input_tokens,
                        "total_output_tokens": result.total_output_tokens,
                        "pgn": result.pgn,
                    },
                },
            )
        except asyncio.CancelledError:
            logger.info("Game %s cancelled", game_id)
        except Exception:
            logger.exception("Game %s failed", game_id)
            crash_total_moves = 0
            async with get_session_factory()() as session:
                game = await session.get(Game, game_id)
                if game and game.status not in {"completed", "stopped"}:
                    game.status = "completed"
                    game.outcome = "*"
                    game.termination = "error"
                    game.completed_at = datetime.now(timezone.utc)
                    moves_res = await session.exec(
                        select(Move)
                        .where(Move.game_id == game_id)
                        .order_by(Move.id)  # type: ignore[arg-type]
                    )
                    move_rows = list(moves_res.all())
                    game.total_moves = len(move_rows)
                    crash_total_moves = len(move_rows)
                    if move_rows:
                        game.pgn = pgn_from_sans(
                            game.white_model,
                            game.black_model,
                            [m.san for m in move_rows],
                        )
                    session.add(game)
                    await session.commit()
            await self._broadcast(
                game_id,
                {
                    "type": "game_over",
                    "data": {
                        "outcome": "*",
                        "termination": "error",
                        "total_moves": crash_total_moves,
                    },
                },
            )
        finally:
            if stockfish_player_white:
                await stockfish_player_white.stop()
            if stockfish_player_black and stockfish_player_black is not stockfish_player_white:
                await stockfish_player_black.stop()
            self.active_games.pop(game_id, None)
            self.human_move_queues.pop(game_id, None)
            self._awaiting_human_move.pop(game_id, None)
            self.player_secrets.pop(game_id, None)
            # Signal end to any remaining subscribers
            for q in self.event_queues.pop(game_id, []):
                try:
                    q.put_nowait(None)
                except asyncio.QueueFull:
                    pass

    async def _handle_illegal_move(self, game_id: str, event: dict) -> None:
        """Broadcast illegal move attempt and update DB counters."""
        await self._broadcast(
            game_id,
            {
                "type": "illegal_move_attempt",
                "data": event,
            },
        )

        # Update counters in DB using atomic increments to avoid race conditions.
        # The model counter lives on the composite leaderboard identity (rating_key);
        # fall back to the raw label for events emitted before this field existed.
        color = event.get("color", "white")
        model_id = event.get("rating_key") or event.get("model", "")
        try:
            async with get_session_factory()() as session:
                if color == "white":
                    await session.exec(  # type: ignore[call-overload]
                        sa_update(Game)
                        .where(Game.id == game_id)
                        .values(white_illegal_moves=Game.white_illegal_moves + 1)
                    )
                else:
                    await session.exec(  # type: ignore[call-overload]
                        sa_update(Game)
                        .where(Game.id == game_id)
                        .values(black_illegal_moves=Game.black_illegal_moves + 1)
                    )
                await session.exec(  # type: ignore[call-overload]
                    sa_update(LLMModel)
                    .where(LLMModel.id == model_id)
                    .values(total_illegal_moves=LLMModel.total_illegal_moves + 1)
                )
                await session.commit()
        except Exception:
            logger.warning("Failed to update illegal move counters", exc_info=True)

    async def _persist_move(self, game_id: str, record: MoveRecord) -> None:
        """Persist a move, retrying transient SQLite write-lock contention.

        A transient 'database is locked' must never abort the game; we retry
        a few times with a short backoff before giving up (and logging).
        """
        for attempt in range(1, 4):
            try:
                await self._persist_move_once(game_id, record)
                return
            except OperationalError as e:
                if "database is locked" in str(e).lower() and attempt < 3:
                    logger.warning(
                        "Game %s: move persist locked (attempt %d/3), retrying",
                        game_id,
                        attempt,
                    )
                    await asyncio.sleep(0.1 * attempt)
                    continue
                logger.exception("Game %s: move persist failed permanently", game_id)
                return

    async def _persist_move_once(self, game_id: str, record: MoveRecord) -> None:
        async with get_session_factory()() as session:
            move = Move(
                game_id=game_id,
                move_number=record.move_number,
                color=record.color,
                uci=record.uci,
                san=record.san,
                fen_after=record.fen_after,
                narration=record.narration,
                table_talk=record.table_talk,
                centipawns=record.eval_after.centipawns if record.eval_after else None,
                mate_in=record.eval_after.mate_in if record.eval_after else None,
                win_probability=record.eval_after.win_probability_white
                if record.eval_after
                else None,
                centipawns_before=record.eval_before.centipawns
                if record.eval_before
                else None,
                mate_in_before=record.eval_before.mate_in
                if record.eval_before
                else None,
                win_probability_before=record.eval_before.win_probability_white
                if record.eval_before
                else None,
                best_move_uci=record.best_move_uci,
                classification=record.classification,
                response_time_ms=record.response_time_ms,
                opening_eco=record.opening_eco,
                opening_name=record.opening_name,
                input_tokens=record.input_tokens,
                output_tokens=record.output_tokens,
                cost_usd=record.cost_usd,
                timestamp=datetime.now(timezone.utc),
                is_chaos_move=record.is_chaos_move,
            )
            session.add(move)
            await session.commit()

    async def _persist_result(
        self,
        game_id: str,
        result: GameResult,
        apply_elo: bool = False,
        white_key: str | None = None,
        black_key: str | None = None,
    ) -> bool:
        """Persist the terminal game state (idempotently) and optionally fold in
        the ELO update within the same transaction.

        ``white_key``/``black_key`` are the composite leaderboard identities to
        credit (model + reasoning tier for LLMs). Returns True only if this call
        performed the terminal write. If the row was already completed/stopped,
        returns False and does nothing — so ELO is applied at most once even if
        this path runs twice.
        """
        now = datetime.now(timezone.utc)
        async with get_session_factory()() as session:
            game = await session.get(Game, game_id)
            if not game:
                return False
            if game.status in {"completed", "stopped"}:
                logger.info(
                    "Game %s: result persist skipped (already %s)", game_id, game.status
                )
                return False

            game.status = "completed"
            game.outcome = result.outcome
            game.termination = result.termination
            game.opening_eco = result.opening_eco
            game.opening_name = result.opening_name
            game.pgn = result.pgn
            game.total_moves = result.total_moves
            game.total_cost_usd = result.total_cost_usd
            game.completed_at = now
            session.add(game)

            if apply_elo and not game.rated and white_key and black_key:
                applied = await self._apply_elo(
                    session, white_key, black_key, result.outcome
                )
                # Only flag rated if the update actually landed, so a game can
                # never appear in the chart/recompute without a matching ELO change.
                game.rated = applied

            await session.commit()
            return True

    async def _apply_elo(
        self, session, white_key: str, black_key: str, outcome: str | None
    ) -> bool:
        """Apply an ELO update to both leaderboard identities within the caller's
        session. Does not commit — the caller commits as part of the result txn.
        Returns True if the update was applied, False if it was a no-op.
        """
        # Self-play would credit one identity a win and a loss at once (same row
        # fetched twice). Never rate it. The caller's skip_elo already guards this;
        # this is defence in depth so the invariant holds wherever _apply_elo runs.
        if white_key == black_key:
            return False

        score_white = score_white_from_outcome(outcome)

        w = await session.get(LLMModel, white_key)
        b = await session.get(LLMModel, black_key)
        if not w or not b:
            return False

        new_w, new_b = calculate_elo_change(w.elo_rating, b.elo_rating, score_white)

        w.elo_rating = new_w
        w.games_played += 1
        w.wins += 1 if score_white == 1.0 else 0
        w.draws += 1 if score_white == 0.5 else 0
        w.losses += 1 if score_white == 0.0 else 0
        session.add(w)

        b.elo_rating = new_b
        b.games_played += 1
        b.wins += 1 if score_white == 0.0 else 0
        b.draws += 1 if score_white == 0.5 else 0
        b.losses += 1 if score_white == 1.0 else 0
        session.add(b)
        return True

    async def recompute_all_elo(self) -> None:
        """Rebuild every leaderboard identity's ELO and W/D/L from scratch.

        ELO is path-dependent (each step's K-factor applies to the ratings *at
        that moment*), so any change — a deleted game, or new rating rules —
        invalidates every later rating. The only correct fix is to reset all
        identities to the default and replay every eligible game in completion
        order, which reproduces the live ``_apply_elo`` result exactly (same
        ordering, same per-step rounding).

        Eligibility (``game_eligible_for_elo``) and the (model + reasoning tier)
        identity (``_game_rating_keys``) are re-derived from each game row, so this
        also migrates existing data to the current convention. ``Game.rated`` is
        rewritten to match, keeping the ELO-history chart (which filters on
        ``Game.rated``) in lock-step. Identities with no eligible games are left at
        zero and hidden by the leaderboard's ``games_played > 0`` filter.
        """
        async with get_session_factory()() as session:
            models = list((await session.exec(select(LLMModel))).all())
            for m in models:
                m.elo_rating = DEFAULT_MODEL_ELO
                m.games_played = 0
                m.wins = 0
                m.draws = 0
                m.losses = 0
                session.add(m)
            by_id = {m.id: m for m in models}

            def ensure(key: str, display: str) -> LLMModel:
                row = by_id.get(key)
                if row is None:
                    row = LLMModel(
                        id=key, display_name=display, elo_rating=DEFAULT_MODEL_ELO
                    )
                    session.add(row)
                    by_id[key] = row
                return row

            games = list(
                (
                    await session.exec(
                        select(Game)
                        .where(Game.status == "completed")
                        .order_by(
                            Game.completed_at.asc(),  # type: ignore[union-attr]
                            Game.id.asc(),  # type: ignore[union-attr]
                        )
                    )
                ).all()
            )

            replayed = 0
            for g in games:
                eligible = game_eligible_for_elo(g)
                if bool(g.rated) != eligible:
                    g.rated = eligible
                    session.add(g)
                if not eligible:
                    continue

                white_key, black_key = _game_rating_keys(g)
                w = ensure(
                    white_key,
                    rating_display(
                        g.white_model, g.white_reasoning_effort,
                        bool(g.white_is_human), bool(g.white_is_stockfish),
                    ),
                )
                b = ensure(
                    black_key,
                    rating_display(
                        g.black_model, g.black_reasoning_effort,
                        bool(g.black_is_human), bool(g.black_is_stockfish),
                    ),
                )
                score_white = score_white_from_outcome(g.outcome)
                new_w, new_b = calculate_elo_change(
                    w.elo_rating, b.elo_rating, score_white
                )
                w.elo_rating = new_w
                w.games_played += 1
                w.wins += 1 if score_white == 1.0 else 0
                w.draws += 1 if score_white == 0.5 else 0
                w.losses += 1 if score_white == 0.0 else 0

                b.elo_rating = new_b
                b.games_played += 1
                b.wins += 1 if score_white == 0.0 else 0
                b.draws += 1 if score_white == 0.5 else 0
                b.losses += 1 if score_white == 1.0 else 0
                replayed += 1

            await session.commit()

        logger.info(
            "Recomputed ELO: %d identities from %d eligible games",
            len(by_id),
            replayed,
        )

    async def _ensure_model(self, model_id: str, display_name: str) -> None:
        """Insert the leaderboard identity into the models table if it's new."""
        async with get_session_factory()() as session:
            existing = await session.get(LLMModel, model_id)
            if not existing:
                model = LLMModel(
                    id=model_id,
                    display_name=display_name,
                    elo_rating=DEFAULT_MODEL_ELO,
                )
                session.add(model)
                await session.commit()

    _background_tasks: set[asyncio.Task] = set()

    def _fire_and_forget(self, coro) -> None:
        """Create a task with exception logging so errors aren't silently lost."""
        task = asyncio.create_task(coro)
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)
        task.add_done_callback(self._task_exception_handler)

    @staticmethod
    def _task_exception_handler(task: asyncio.Task) -> None:
        if not task.cancelled() and task.exception():
            logger.error("Background task failed: %s", task.exception())

    async def _broadcast(self, game_id: str, event: dict) -> None:
        queues = self.event_queues.get(game_id, [])
        event_type = event.get("type", "unknown")
        dropped = 0
        stale: list[asyncio.Queue] = []
        drop_allowed = event_type in {"status", "spectator_count"}
        for q in queues:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                dropped += 1
                if drop_allowed:
                    continue
                stale.append(q)
        if stale:
            for q in stale:
                try:
                    self.event_queues.get(game_id, []).remove(q)
                except ValueError:
                    pass
                # Wake the WS reader blocked on queue.get() so it terminates and
                # the client reconnects + re-catches-up, instead of hanging.
                try:
                    q.get_nowait()  # drain one slot so the sentinel fits
                except asyncio.QueueEmpty:
                    pass
                try:
                    q.put_nowait(None)
                except asyncio.QueueFull:
                    pass
        if dropped:
            logger.warning(
                "Game %s: broadcast %s dropped for %d/%d subscribers (queue full)",
                game_id,
                event_type,
                dropped,
                len(queues),
            )
