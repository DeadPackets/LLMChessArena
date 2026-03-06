from __future__ import annotations

import asyncio
from collections import deque
import logging
import secrets as secrets_mod
from datetime import datetime, timezone
from uuid import uuid4

from sqlmodel import select
from sqlalchemy import update as sa_update

from app.config import (
    MAX_CONCURRENT_GAMES,
    DEFAULT_MODEL_ELO,
    MAX_QUEUED_GAMES,
    MAX_WS_EVENT_QUEUE_SIZE,
)
from app.database import Game, Move, LLMModel, get_session_factory
from app.models.chess_models import GameConfig, GameResult, MoveRecord
from app.services.elo_service import calculate_elo_change
from app.services.game_engine import GameEngine
from app.services.opening_detector import OpeningDetector
from app.services.stockfish_service import StockfishService
from app.services.stockfish_player_service import StockfishPlayerService

logger = logging.getLogger(__name__)


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
                    game.status = "completed"
                    game.outcome = "draw"
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

        def _side_label(
            is_human: bool, is_stockfish: bool, model: str, sf_elo: int | None = None
        ) -> str:
            if is_human:
                return "Human"
            if is_stockfish:
                return f"Stockfish ({sf_elo})" if sf_elo else "Stockfish"
            return model

        white_label = _side_label(
            config.white_is_human,
            config.white_is_stockfish,
            config.white_model,
            config.white_stockfish_elo,
        )
        black_label = _side_label(
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

        # Register models (Human/Stockfish get their own model entries)
        await self._ensure_model(white_label)
        await self._ensure_model(black_label)

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
        asyncio.create_task(self._broadcast_spectator_count(game_id))
        return queue

    def unsubscribe(self, game_id: str, queue: asyncio.Queue) -> None:
        queues = self.event_queues.get(game_id, [])
        if queue in queues:
            queues.remove(queue)
        logger.debug("Game %s: WebSocket subscriber removed", game_id)
        if game_id in self.event_queues:
            asyncio.create_task(self._broadcast_spectator_count(game_id))

    def get_spectator_count(self, game_id: str) -> int:
        return len(self.event_queues.get(game_id, []))

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
                    game.status = "stopped"
                    game.outcome = "*"
                    game.termination = "stopped"
                    game.completed_at = datetime.now(timezone.utc)
                    total_moves = game.total_moves or 0
                    session.add(game)
                    await session.commit()
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

    async def submit_human_move(self, game_id: str, uci: str) -> bool:
        """Submit a human move for an active game. Returns True if queued."""
        queue = self.human_move_queues.get(game_id)
        if queue is None:
            logger.warning("Game %s: human move submitted but no queue exists", game_id)
            return False
        await queue.put(uci)
        return True

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
            human_queue = asyncio.Queue()
            self.human_move_queues[game_id] = human_queue

        # Create strength-limited Stockfish player if needed
        stockfish_player: StockfishPlayerService | None = None
        if config.white_is_stockfish or config.black_is_stockfish:
            # Use the relevant side's ELO (or None for full strength)
            sf_elo = (
                config.white_stockfish_elo
                if config.white_is_stockfish
                else config.black_stockfish_elo
            )
            if sf_elo is not None:
                stockfish_player = StockfishPlayerService()
                await stockfish_player.start(elo=sf_elo)

        engine = GameEngine(
            config,
            stockfish=self.stockfish,
            stockfish_player=stockfish_player,
            opening_detector=self.opening_detector,
            human_move_queue=human_queue,
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
            await self._persist_result(game_id, result)
            # Normalize model IDs for non-LLM sides before ELO update
            if config.white_is_stockfish:
                result.white_model = "Stockfish"
            elif config.white_is_human:
                result.white_model = "Human"
            if config.black_is_stockfish:
                result.black_model = "Stockfish"
            elif config.black_is_human:
                result.black_model = "Human"
            has_limited_sf = (
                config.white_stockfish_elo is not None
                or config.black_stockfish_elo is not None
            )
            skip_elo = config.chaos_mode or has_limited_sf
            reason = ""
            if skip_elo:
                reason = (
                    "chaos mode" if config.chaos_mode else "strength-limited Stockfish"
                )
                logger.info("Game %s: skipping ELO update (%s)", game_id, reason)
            else:
                await self._update_elo(result)
            logger.info(
                "Game %s: results persisted%s",
                game_id,
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
            async with get_session_factory()() as session:
                game = await session.get(Game, game_id)
                if game:
                    game.status = "completed"
                    game.outcome = "draw"
                    game.termination = "error"
                    game.completed_at = datetime.now(timezone.utc)
                    session.add(game)
                    await session.commit()
            await self._broadcast(
                game_id,
                {
                    "type": "game_over",
                    "data": {
                        "outcome": "draw",
                        "termination": "error",
                        "total_moves": 0,
                    },
                },
            )
        finally:
            if stockfish_player:
                await stockfish_player.stop()
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

        # Update counters in DB using atomic increments to avoid race conditions
        color = event.get("color", "white")
        model_id = event.get("model", "")
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

    async def _persist_result(self, game_id: str, result: GameResult) -> None:
        now = datetime.now(timezone.utc)
        async with get_session_factory()() as session:
            game = await session.get(Game, game_id)
            if game:
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
                await session.commit()

    async def _update_elo(self, result: GameResult) -> None:
        """Update ELO ratings for both models after a game."""
        if "white_wins" in result.outcome:
            score_white = 1.0
        elif "black_wins" in result.outcome:
            score_white = 0.0
        else:
            score_white = 0.5

        async with get_session_factory()() as session:
            w = await session.get(LLMModel, result.white_model)
            b = await session.get(LLMModel, result.black_model)

            if not w or not b:
                return

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

            await session.commit()

    async def _ensure_model(self, model_id: str) -> None:
        """Insert the model into the models table if it doesn't exist."""
        async with get_session_factory()() as session:
            existing = await session.get(LLMModel, model_id)
            if not existing:
                model = LLMModel(
                    id=model_id,
                    display_name=model_id.split("/")[-1],
                    elo_rating=DEFAULT_MODEL_ELO,
                )
                session.add(model)
                await session.commit()

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
        if dropped:
            logger.warning(
                "Game %s: broadcast %s dropped for %d/%d subscribers (queue full)",
                game_id,
                event_type,
                dropped,
                len(queues),
            )
