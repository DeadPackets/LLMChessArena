from __future__ import annotations

import asyncio
import logging
import time
from typing import Callable, Awaitable

import chess
import chess.pgn

from pydantic_ai.settings import ModelSettings

from app.config import MAX_MOVES_PER_SIDE, MAX_CONSECUTIVE_ILLEGAL_MOVES
from app.models.chess_models import ChessMove, GameConfig, GameResult, MoveRecord, PositionEval
from app.services.chess_agent import chess_agent, ChessGameContext, build_user_prompt
from app.services.move_classifier import classify_move, MoveClassification, CLASSIFICATION_SYMBOLS
from app.services.opening_detector import OpeningDetector
from app.services.stockfish_service import StockfishService

logger = logging.getLogger(__name__)


class GameEngine:
    """Orchestrates a complete game between two LLM players."""

    def __init__(
        self,
        config: GameConfig,
        stockfish: StockfishService | None = None,
        opening_detector: OpeningDetector | None = None,
        human_move_queue: asyncio.Queue | None = None,
    ):
        self.config = config
        self.board = chess.Board()
        self.move_history: list[MoveRecord] = []
        self.move_callbacks: list[Callable[[MoveRecord], Awaitable[None]]] = []
        self.illegal_move_callbacks: list[Callable[[dict], Awaitable[None]]] = []
        self.status_callback: Callable[[str], Awaitable[None]] | None = None
        self.awaiting_human_move_callback: Callable[[str], Awaitable[None]] | None = None
        self.stockfish = stockfish
        self.opening_detector = opening_detector
        self.human_move_queue = human_move_queue
        self._last_opening: dict[str, str] | None = None
        self._consecutive_illegal_moves = 0
        self._last_move_was_chaos = False
        self.chaos_move_callbacks: list[Callable[[dict], Awaitable[None]]] = []

    async def play_game(self) -> GameResult:
        """Run the main game loop until completion."""
        max_total_moves = self.config.max_moves * 2
        logger.info(
            "Game started: %s (white) vs %s (black), max %d moves per side",
            self.config.white_model, self.config.black_model, self.config.max_moves,
        )

        while not self.board.is_game_over() and len(self.move_history) < max_total_moves:
            current_color = "white" if self.board.turn == chess.WHITE else "black"
            model_name = (
                self.config.white_model
                if current_color == "white"
                else self.config.black_model
            )

            # Evaluate position BEFORE the move (for classification)
            eval_before: PositionEval | None = None
            if self.stockfish:
                await self._emit_status(f"Evaluating position (move {self.board.fullmove_number})...")
                try:
                    eval_before = await self.stockfish.evaluate(self.board)
                except Exception as e:
                    logger.warning("Stockfish eval_before failed (move %d): %s", self.board.fullmove_number, e)

            # Determine side type
            is_human = (
                (current_color == "white" and self.config.white_is_human) or
                (current_color == "black" and self.config.black_is_human)
            )
            is_stockfish = (
                (current_color == "white" and self.config.white_is_stockfish) or
                (current_color == "black" and self.config.black_is_stockfish)
            )

            if is_human:
                logger.info(
                    "Move %d: awaiting human move (%s) | FEN: %s",
                    self.board.fullmove_number, current_color, self.board.fen(),
                )
                await self._emit_status(f"Waiting for {current_color.title()} (Human) to move...")
                move_result = await self._get_human_move(current_color)
            elif is_stockfish:
                logger.info(
                    "Move %d: requesting Stockfish move (%s) | FEN: %s",
                    self.board.fullmove_number, current_color, self.board.fen(),
                )
                await self._emit_status(f"Stockfish ({current_color.title()}) is thinking...")
                move_result = await self._get_stockfish_move(current_color, eval_before)
            else:
                logger.info(
                    "Move %d: requesting move from %s (%s) | FEN: %s",
                    self.board.fullmove_number, model_name, current_color, self.board.fen(),
                )
                await self._emit_status(f"Waiting for {current_color.title()} ({model_name}) to move...")
                move_result = await self._get_llm_move(model_name, current_color)

            if move_result is None:
                winner = "black" if current_color == "white" else "white"
                if is_human:
                    logger.info("Move %d: %s (Human) resigned", self.board.fullmove_number, current_color)
                    return self._build_result(
                        outcome=f"{winner}_wins",
                        termination="resignation",
                    )
                elif is_stockfish:
                    logger.error("Move %d: Stockfish failed to produce a move (%s)", self.board.fullmove_number, current_color)
                    return self._build_result(
                        outcome="draw",
                        termination="error",
                    )
                else:
                    logger.warning(
                        "Move %d: %s (%s) forfeited after %d consecutive illegal moves",
                        self.board.fullmove_number, model_name, current_color,
                        self._consecutive_illegal_moves,
                    )
                    return self._build_result(
                        outcome=f"{winner}_wins",
                        termination="illegal_moves",
                    )

            chess_move, narration, table_talk, elapsed_ms, usage_data = move_result

            # Record the SAN before pushing
            is_chaos = self._last_move_was_chaos
            if is_chaos:
                san = self._chaos_san(chess_move)
            else:
                san = self.board.san(chess_move)
            self.board.push(chess_move)

            # In chaos mode, check if a king was captured (game-ending)
            if is_chaos:
                if self.board.king(chess.WHITE) is None:
                    record = MoveRecord(
                        move_number=self.board.fullmove_number - (1 if current_color == "black" else 0),
                        color=current_color, uci=chess_move.uci(), san=san,
                        fen_after=self.board.fen(), narration=narration, table_talk=table_talk,
                        response_time_ms=elapsed_ms, eval_before=eval_before,
                        is_chaos_move=True,
                        input_tokens=usage_data.get("input_tokens"),
                        output_tokens=usage_data.get("output_tokens"),
                        cost_usd=usage_data.get("cost_usd"),
                    )
                    self.move_history.append(record)
                    for cb in self.move_callbacks:
                        await cb(record)
                    return self._build_result("black_wins", "king_captured")
                if self.board.king(chess.BLACK) is None:
                    record = MoveRecord(
                        move_number=self.board.fullmove_number - (1 if current_color == "black" else 0),
                        color=current_color, uci=chess_move.uci(), san=san,
                        fen_after=self.board.fen(), narration=narration, table_talk=table_talk,
                        response_time_ms=elapsed_ms, eval_before=eval_before,
                        is_chaos_move=True,
                        input_tokens=usage_data.get("input_tokens"),
                        output_tokens=usage_data.get("output_tokens"),
                        cost_usd=usage_data.get("cost_usd"),
                    )
                    self.move_history.append(record)
                    for cb in self.move_callbacks:
                        await cb(record)
                    return self._build_result("white_wins", "king_captured")

            if is_human or is_stockfish:
                side_label = "Human" if is_human else "Stockfish"
                logger.info(
                    "Move %d: %s (%s) played %s (%s)",
                    self.board.fullmove_number - (1 if current_color == "black" else 0),
                    current_color, side_label, san, chess_move.uci(),
                )
            else:
                logger.info(
                    "Move %d: %s played %s (%s) in %dms | tokens: %s in / %s out | cost: $%s",
                    self.board.fullmove_number - (1 if current_color == "black" else 0),
                    current_color, san, chess_move.uci(), elapsed_ms,
                    usage_data.get("input_tokens", "?"), usage_data.get("output_tokens", "?"),
                    f"{usage_data.get('cost_usd', 0) or 0:.4f}",
                )

            # Evaluate position AFTER the move
            eval_after: PositionEval | None = None
            if self.stockfish:
                await self._emit_status("Running Stockfish analysis...")
                try:
                    eval_after = await self.stockfish.evaluate(self.board)
                except Exception as e:
                    logger.warning("Stockfish eval_after failed (move %s): %s", san, e)

            # Classify the move
            classification: str | None = None
            if eval_before and eval_after:
                cls = classify_move(eval_before, eval_after, chess_move.uci(), current_color)
                classification = cls.value

            # Detect opening
            opening_eco: str | None = None
            opening_name: str | None = None
            if self.opening_detector:
                opening = self.opening_detector.detect(self.board)
                if opening:
                    self._last_opening = opening
                    opening_eco = opening["eco"]
                    opening_name = opening["name"]

            # Compute move number
            move_number = (
                self.board.fullmove_number
                if current_color == "white"
                else self.board.fullmove_number - 1
            )

            record = MoveRecord(
                move_number=move_number,
                color=current_color,
                uci=chess_move.uci(),
                san=san,
                fen_after=self.board.fen(),
                narration=narration,
                table_talk=table_talk,
                response_time_ms=elapsed_ms,
                eval_before=eval_before,
                eval_after=eval_after,
                classification=classification,
                best_move_uci=eval_before.best_move_uci if eval_before else None,
                opening_eco=opening_eco,
                opening_name=opening_name,
                input_tokens=usage_data.get("input_tokens"),
                output_tokens=usage_data.get("output_tokens"),
                cost_usd=usage_data.get("cost_usd"),
                is_chaos_move=is_chaos,
            )
            self.move_history.append(record)

            for cb in self.move_callbacks:
                await cb(record)

        # Game ended naturally
        if len(self.move_history) >= max_total_moves and not self.board.is_game_over():
            logger.info("Game ended: draw by max moves (%d)", max_total_moves)
            return self._build_result(outcome="draw", termination="max_moves")

        result = self._build_result_from_board()
        logger.info(
            "Game ended: %s by %s after %d moves",
            result.outcome, result.termination, result.total_moves,
        )
        return result

    async def _emit_status(self, message: str) -> None:
        if self.status_callback:
            await self.status_callback(message)

    async def _get_human_move(
        self, color: str,
    ) -> tuple[chess.Move, str, str, int, dict] | None:
        """Wait for a human player to submit a move via the WebSocket queue.

        Returns (move, narration, table_talk, elapsed_ms, usage_data) or None on forfeit.
        Human moves have no narration, table talk, or usage data.
        """
        if self.human_move_queue is None:
            logger.error("Human move requested but no queue available")
            return None

        # Signal that we're waiting for a human move
        if self.awaiting_human_move_callback:
            await self.awaiting_human_move_callback(color)

        while True:
            uci_str = await self.human_move_queue.get()

            # Check for resignation
            if uci_str == "resign":
                logger.info("Human (%s) resigned", color)
                return None

            try:
                move = chess.Move.from_uci(uci_str)
                if move in self.board.legal_moves:
                    self._consecutive_illegal_moves = 0
                    logger.info("Human move accepted: %s (%s)", uci_str, color)
                    return move, "", "", 0, {}
                else:
                    logger.warning("Human submitted illegal move: %s (%s)", uci_str, color)
                    await self._emit_illegal_move(
                        color=color, model="Human",
                        attempted_move=uci_str, reason="Illegal move",
                        attempt=1,
                    )
                    # Re-signal that we're still waiting
                    if self.awaiting_human_move_callback:
                        await self.awaiting_human_move_callback(color)
            except (ValueError, chess.InvalidMoveError):
                logger.warning("Human submitted invalid UCI: '%s' (%s)", uci_str, color)
                await self._emit_illegal_move(
                    color=color, model="Human",
                    attempted_move=uci_str, reason="Invalid UCI notation",
                    attempt=1,
                )
                if self.awaiting_human_move_callback:
                    await self.awaiting_human_move_callback(color)

    async def _get_stockfish_move(
        self, color: str, eval_before: PositionEval | None,
    ) -> tuple[chess.Move, str, str, int, dict] | None:
        """Get the best move from Stockfish engine.

        Reuses eval_before if available (already computed), otherwise evaluates.
        Returns (move, narration, table_talk, elapsed_ms, usage_data).
        Stockfish moves have no narration, table talk, or usage data.
        """
        best_move_uci: str | None = None
        elapsed_ms = 0

        if eval_before and eval_before.best_move_uci:
            best_move_uci = eval_before.best_move_uci
        elif self.stockfish:
            start = time.monotonic()
            try:
                result = await self.stockfish.evaluate(self.board)
                elapsed_ms = int((time.monotonic() - start) * 1000)
                best_move_uci = result.best_move_uci
            except Exception as e:
                logger.error("Stockfish evaluate failed (%s): %s", color, e)
                return None
        else:
            logger.error("Stockfish move requested but stockfish service not available")
            return None

        if not best_move_uci:
            logger.error("Stockfish returned no best move (%s)", color)
            return None

        try:
            move = chess.Move.from_uci(best_move_uci)
            if move not in self.board.legal_moves:
                logger.error("Stockfish returned illegal move: %s (%s)", best_move_uci, color)
                return None
            self._consecutive_illegal_moves = 0
            return move, "", "", elapsed_ms, {}
        except (ValueError, chess.InvalidMoveError):
            logger.error("Stockfish returned invalid UCI: %s (%s)", best_move_uci, color)
            return None

    async def _get_llm_move(
        self, model_name: str, color: str
    ) -> tuple[chess.Move, str, str, int, dict] | None:
        """Get a legal move from the LLM, with retries for illegal moves.

        Uses a game-wide consecutive illegal move counter. Resets on each legal move.
        Returns (move, narration, table_talk, elapsed_ms, usage_data) or None on forfeit.
        usage_data contains input_tokens, output_tokens, cost_usd.
        """
        history_dicts = [r.model_dump() for r in self.move_history]
        error_context = ""

        while self._consecutive_illegal_moves < MAX_CONSECUTIVE_ILLEGAL_MOVES:
            ctx = ChessGameContext(
                board=self.board.copy(),
                color=color,
                move_history=history_dicts,
            )

            # After 3 consecutive illegal moves, inject legal moves as a lifeline
            show_legal = self._consecutive_illegal_moves >= 3
            user_prompt = build_user_prompt(
                self.board, color, history_dicts, error_context,
                include_legal_moves=show_legal,
            )

            start = time.monotonic()
            # Build per-color model settings from config
            temp = (
                self.config.white_temperature if color == "white"
                else self.config.black_temperature
            )
            reasoning = (
                self.config.white_reasoning_effort if color == "white"
                else self.config.black_reasoning_effort
            )
            settings: ModelSettings = {}
            if temp is not None:
                settings["temperature"] = temp
            if reasoning:
                settings["extra_body"] = {
                    "reasoning": {"effort": reasoning},
                }

            logger.info(
                "LLM call: model=%s, color=%s, attempt=%d, show_legal=%s, temp=%s, reasoning=%s",
                model_name, color, self._consecutive_illegal_moves + 1, show_legal,
                temp, reasoning,
            )
            try:
                result = await chess_agent.run(
                    user_prompt,
                    deps=ctx,
                    model=f"openrouter:{model_name}",
                    model_settings=settings,
                )
            except Exception as e:
                elapsed_ms = int((time.monotonic() - start) * 1000)
                self._consecutive_illegal_moves += 1
                error_context = f"API error: {e}"
                logger.error(
                    "LLM call failed: model=%s, error=%s, elapsed=%dms, consecutive_failures=%d",
                    model_name, e, elapsed_ms, self._consecutive_illegal_moves,
                )
                await self._emit_illegal_move(
                    color=color, model=model_name,
                    attempted_move="(API error)", reason=str(e),
                    attempt=self._consecutive_illegal_moves,
                )
                continue
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.info("LLM response: model=%s, elapsed=%dms", model_name, elapsed_ms)

            # Extract token/cost data from pydantic-ai result
            usage = result.usage()
            provider_details = result.response.provider_details or {}
            usage_data = {
                "input_tokens": usage.input_tokens,
                "output_tokens": usage.output_tokens,
                "cost_usd": provider_details.get("cost"),
            }

            uci_str = result.output.move.strip()
            narration = result.output.narration
            table_talk = result.output.table_talk

            try:
                move = chess.Move.from_uci(uci_str)
                if move in self.board.legal_moves:
                    self._consecutive_illegal_moves = 0  # Reset on legal move
                    self._last_move_was_chaos = False
                    logger.debug("LLM move accepted: %s (%s)", uci_str, model_name)
                    return move, narration, table_talk, elapsed_ms, usage_data
                elif self.config.chaos_mode and self._is_valid_chaos_move(move, color):
                    # Chaos mode: illegal but structurally valid — force it
                    self._consecutive_illegal_moves = 0
                    self._last_move_was_chaos = True
                    logger.info(
                        "Chaos move accepted: model=%s, uci=%s (illegal but own piece on source)",
                        model_name, uci_str,
                    )
                    await self._emit_chaos_move(
                        color=color, model=model_name,
                        attempted_move=uci_str,
                        move_number=self.board.fullmove_number,
                    )
                    return move, narration, table_talk, elapsed_ms, usage_data
                else:
                    self._consecutive_illegal_moves += 1
                    logger.warning(
                        "Illegal move: model=%s, attempted=%s, consecutive=%d/%d",
                        model_name, uci_str, self._consecutive_illegal_moves, MAX_CONSECUTIVE_ILLEGAL_MOVES,
                    )
                    error_context = (
                        f"ILLEGAL MOVE: '{uci_str}' is valid UCI notation but is not a "
                        f"legal move in this position. The piece cannot move there. "
                        f"Re-read the board and pick a different move."
                    )
                    await self._emit_illegal_move(
                        color=color, model=model_name,
                        attempted_move=uci_str, reason="Illegal move",
                        attempt=self._consecutive_illegal_moves,
                    )
            except (ValueError, chess.InvalidMoveError):
                self._consecutive_illegal_moves += 1
                logger.warning(
                    "Invalid UCI: model=%s, attempted='%s', consecutive=%d/%d",
                    model_name, uci_str, self._consecutive_illegal_moves, MAX_CONSECUTIVE_ILLEGAL_MOVES,
                )
                error_context = (
                    f"INVALID UCI: '{uci_str}' is not valid UCI notation. "
                    f"UCI moves must be 4-5 lowercase characters: source square + "
                    f"destination square (e.g. 'e2e4', 'g1f3', 'e7e8q'). "
                    f"Do NOT use SAN notation like 'Nf3' or 'O-O'."
                )
                await self._emit_illegal_move(
                    color=color, model=model_name,
                    attempted_move=uci_str, reason="Invalid UCI notation",
                    attempt=self._consecutive_illegal_moves,
                )

        logger.error(
            "Forfeit: model=%s (%s) reached %d consecutive illegal moves",
            model_name, color, MAX_CONSECUTIVE_ILLEGAL_MOVES,
        )
        return None  # Forfeit after MAX_CONSECUTIVE_ILLEGAL_MOVES consecutive illegal moves

    async def _emit_illegal_move(
        self, *, color: str, model: str, attempted_move: str, reason: str, attempt: int
    ) -> None:
        """Notify all illegal move callbacks."""
        event = {
            "color": color,
            "model": model,
            "attempted_move": attempted_move,
            "reason": reason,
            "attempt": attempt,
            "max_attempts": MAX_CONSECUTIVE_ILLEGAL_MOVES,
            "move_number": self.board.fullmove_number,
        }
        for cb in self.illegal_move_callbacks:
            try:
                await cb(event)
            except Exception:
                logger.warning("Illegal move callback failed", exc_info=True)

    def _is_valid_chaos_move(self, move: chess.Move, color: str) -> bool:
        """Check if an illegal move can be force-pushed in chaos mode.

        Valid chaos move = source square has the current mover's own piece.
        """
        piece = self.board.piece_at(move.from_square)
        if piece is None:
            return False
        expected_color = chess.WHITE if color == "white" else chess.BLACK
        return piece.color == expected_color

    def _chaos_san(self, move: chess.Move) -> str:
        """Generate pseudo-SAN for an illegal chaos move (board.san() would raise)."""
        piece = self.board.piece_at(move.from_square)
        piece_char = ""
        if piece and piece.piece_type != chess.PAWN:
            piece_char = piece.symbol().upper()
        return f"{piece_char}{move.uci()}!?"

    async def _emit_chaos_move(
        self, *, color: str, model: str, attempted_move: str, move_number: int,
    ) -> None:
        """Notify callbacks that a chaos move was detected and allowed."""
        event = {
            "color": color,
            "model": model,
            "attempted_move": attempted_move,
            "move_number": move_number,
        }
        for cb in self.chaos_move_callbacks:
            try:
                await cb(event)
            except Exception:
                logger.warning("Chaos move callback failed", exc_info=True)

    def _build_result_from_board(self) -> GameResult:
        """Build result from the board's game-over state."""
        outcome_obj = self.board.outcome()
        if outcome_obj is None:
            return self._build_result("draw", "unknown")

        if outcome_obj.winner is None:
            outcome_str = "draw"
        elif outcome_obj.winner == chess.WHITE:
            outcome_str = "white_wins"
        else:
            outcome_str = "black_wins"

        termination_map = {
            chess.Termination.CHECKMATE: "checkmate",
            chess.Termination.STALEMATE: "stalemate",
            chess.Termination.INSUFFICIENT_MATERIAL: "insufficient_material",
            chess.Termination.THREEFOLD_REPETITION: "repetition",
            chess.Termination.FIVEFOLD_REPETITION: "repetition",
            chess.Termination.FIFTY_MOVES: "fifty_moves",
            chess.Termination.SEVENTYFIVE_MOVES: "fifty_moves",
        }
        termination = termination_map.get(outcome_obj.termination, "unknown")

        return self._build_result(outcome_str, termination)

    def _build_result(self, outcome: str, termination: str) -> GameResult:
        """Build the final GameResult with PGN and aggregated cost data."""
        pgn = self._generate_pgn()
        total_input = sum(m.input_tokens or 0 for m in self.move_history)
        total_output = sum(m.output_tokens or 0 for m in self.move_history)
        total_cost = sum(m.cost_usd or 0.0 for m in self.move_history)
        return GameResult(
            outcome=outcome,
            termination=termination,
            moves=self.move_history,
            pgn=pgn,
            total_moves=len(self.move_history),
            white_model=self.config.white_model,
            black_model=self.config.black_model,
            opening_eco=self._last_opening["eco"] if self._last_opening else None,
            opening_name=self._last_opening["name"] if self._last_opening else None,
            total_input_tokens=total_input,
            total_output_tokens=total_output,
            total_cost_usd=total_cost,
        )

    def _generate_pgn(self) -> str:
        """Generate PGN string with evaluations and narrations as comments."""
        game = chess.pgn.Game()
        game.headers["Event"] = "LLM Chess Arena"
        if self.config.chaos_mode:
            game.headers["Variant"] = "Chaos"
        game.headers["White"] = self.config.white_model
        game.headers["Black"] = self.config.black_model
        if self._last_opening:
            game.headers["Opening"] = self._last_opening["name"]
            game.headers["ECO"] = self._last_opening["eco"]

        if self.board.is_game_over():
            game.headers["Result"] = self.board.result()
        else:
            game.headers["Result"] = "*"

        node = game
        board = chess.Board()
        for record in self.move_history:
            move = chess.Move.from_uci(record.uci)
            node = node.add_variation(move)

            # Build comment with eval + classification + narration
            parts = []
            if record.is_chaos_move:
                parts.append("[CHAOS]")
            if record.eval_after:
                eval_str = StockfishService.format_eval(
                    record.eval_after.centipawns, record.eval_after.mate_in
                )
                parts.append(f"[eval {eval_str}]")
            if record.classification:
                symbol = CLASSIFICATION_SYMBOLS.get(
                    MoveClassification(record.classification), ""
                )
                if symbol:
                    parts.append(f"[{record.classification}{symbol}]")
            parts.append(record.narration)
            node.comment = " ".join(parts)

            # Set eval annotation
            if record.eval_after:
                score = chess.engine.PovScore(
                    chess.engine.Cp(record.eval_after.centipawns),
                    chess.WHITE,
                )
                node.set_eval(score)

            board.push(move)

        return str(game)
