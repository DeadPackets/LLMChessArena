from __future__ import annotations

import logging
import time
from typing import Callable, Awaitable

import chess
import chess.pgn

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
    ):
        self.config = config
        self.board = chess.Board()
        self.move_history: list[MoveRecord] = []
        self.move_callbacks: list[Callable[[MoveRecord], Awaitable[None]]] = []
        self.illegal_move_callbacks: list[Callable[[dict], Awaitable[None]]] = []
        self.status_callback: Callable[[str], Awaitable[None]] | None = None
        self.stockfish = stockfish
        self.opening_detector = opening_detector
        self._last_opening: dict[str, str] | None = None
        self._consecutive_illegal_moves = 0

    async def play_game(self) -> GameResult:
        """Run the main game loop until completion."""
        max_total_moves = self.config.max_moves * 2

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
                    logger.warning("Stockfish eval_before failed: %s", e)

            await self._emit_status(f"Waiting for {current_color.title()} ({model_name}) to move...")
            move_result = await self._get_llm_move(model_name, current_color)

            if move_result is None:
                return self._build_result(
                    outcome=f"{'black' if current_color == 'white' else 'white'}_wins",
                    termination="illegal_moves",
                )

            chess_move, narration, trash_talk, elapsed_ms, usage_data = move_result

            # Record the SAN before pushing
            san = self.board.san(chess_move)
            self.board.push(chess_move)

            # Evaluate position AFTER the move
            eval_after: PositionEval | None = None
            if self.stockfish:
                await self._emit_status("Running Stockfish analysis...")
                try:
                    eval_after = await self.stockfish.evaluate(self.board)
                except Exception as e:
                    logger.warning("Stockfish eval_after failed: %s", e)

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
                trash_talk=trash_talk,
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
            )
            self.move_history.append(record)

            for cb in self.move_callbacks:
                await cb(record)

        # Game ended naturally
        if len(self.move_history) >= max_total_moves and not self.board.is_game_over():
            return self._build_result(outcome="draw", termination="max_moves")

        return self._build_result_from_board()

    async def _emit_status(self, message: str) -> None:
        if self.status_callback:
            await self.status_callback(message)

    async def _get_llm_move(
        self, model_name: str, color: str
    ) -> tuple[chess.Move, str, str, int, dict] | None:
        """Get a legal move from the LLM, with retries for illegal moves.

        Uses a game-wide consecutive illegal move counter. Resets on each legal move.
        Returns (move, narration, trash_talk, elapsed_ms, usage_data) or None on forfeit.
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
            try:
                result = await chess_agent.run(
                    user_prompt,
                    deps=ctx,
                    model=f"openrouter:{model_name}",
                )
            except Exception as e:
                self._consecutive_illegal_moves += 1
                error_context = f"API error: {e}"
                await self._emit_illegal_move(
                    color=color, model=model_name,
                    attempted_move="(API error)", reason=str(e),
                    attempt=self._consecutive_illegal_moves,
                )
                continue
            elapsed_ms = int((time.monotonic() - start) * 1000)

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
            trash_talk = result.output.trash_talk

            try:
                move = chess.Move.from_uci(uci_str)
                if move in self.board.legal_moves:
                    self._consecutive_illegal_moves = 0  # Reset on legal move
                    return move, narration, trash_talk, elapsed_ms, usage_data
                else:
                    self._consecutive_illegal_moves += 1
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
