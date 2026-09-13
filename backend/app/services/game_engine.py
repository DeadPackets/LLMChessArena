from __future__ import annotations

import asyncio
import logging
import time
from typing import Callable, Awaitable

import chess
import chess.pgn

from pydantic_ai import PromptedOutput
from pydantic_ai.models.openrouter import OpenRouterModelSettings
from pydantic_ai.exceptions import UnexpectedModelBehavior
from openai import APIConnectionError
import httpx

from app.config import (
    MAX_MOVES_PER_SIDE,
    MAX_CONSECUTIVE_ILLEGAL_MOVES,
    DRAW_ADJUDICATION_CP,
    DRAW_ADJUDICATION_MOVES,
    LLM_MAX_TOKENS,
    DEFAULT_TEMPERATURE,
    LLM_REQUEST_TIMEOUT,
    LLM_MOVE_TIMEOUT_DEFAULT,
    MOVE_WATCHDOG_INTERVAL,
    LLM_TRANSPORT_ATTEMPTS,
    LLM_RETRY_BASE_DELAY,
    LLM_CACHE_TTL,
    MOVE_HISTORY_PLIES,
    TABLE_TALK_HISTORY,
    HARNESS_VERSION,
)
from app.models.chess_models import (
    ChessMove,
    LLMRequestRecord,
    GameConfig,
    GameResult,
    MoveRecord,
    PositionEval,
)
from app.services.chess_agent import chess_agent, ChessGameContext, build_user_prompt
from app.services.openrouter_model import arena_model
from app.services.elo_service import rating_key
from app.services.move_classifier import (
    classify_move,
    MoveClassification,
    CLASSIFICATION_SYMBOLS,
)
from app.services.opening_detector import OpeningDetector
from app.services.stockfish_service import StockfishService
from app.services.stockfish_player_service import StockfishPlayerService

logger = logging.getLogger(__name__)

DRAW_ADJUDICATION_CP_THRESHOLD = DRAW_ADJUDICATION_CP
DRAW_ADJUDICATION_MOVE_THRESHOLD = DRAW_ADJUDICATION_MOVES


class GameEngine:
    """Orchestrates a complete game between two LLM players."""

    def __init__(
        self,
        config: GameConfig,
        stockfish: StockfishService | None = None,
        stockfish_player: StockfishPlayerService | None = None,
        stockfish_player_white: StockfishPlayerService | None = None,
        stockfish_player_black: StockfishPlayerService | None = None,
        opening_detector: OpeningDetector | None = None,
        human_move_queue: asyncio.Queue | None = None,
        game_id: str = "",
    ):
        self.config = config
        self.game_id = game_id
        self.board = chess.Board()
        self.move_history: list[MoveRecord] = []
        self.move_callbacks: list[Callable[[MoveRecord], Awaitable[None]]] = []
        self.request_records: list[LLMRequestRecord] = []
        self.request_callbacks: list[Callable[[LLMRequestRecord], Awaitable[None]]] = []
        self._move_had_transport_error = False
        self.illegal_move_callbacks: list[Callable[[dict], Awaitable[None]]] = []
        self.status_callback: Callable[[str], Awaitable[None]] | None = None
        self.awaiting_human_move_callback: Callable[[str], Awaitable[None]] | None = (
            None
        )
        self.stockfish = stockfish
        self.stockfish_player = stockfish_player
        self.stockfish_player_white = stockfish_player_white
        self.stockfish_player_black = stockfish_player_black
        self.opening_detector = opening_detector
        self.human_move_queue = human_move_queue
        self._last_opening: dict[str, str] | None = None
        self._consecutive_illegal_moves = 0
        self._forfeit_was_api_error = False
        self._prompted_output_colors: set[str] = set()
        self._last_move_was_chaos = False
        self._consecutive_draw_eval_count = 0
        self.chaos_move_callbacks: list[Callable[[dict], Awaitable[None]]] = []

    async def play_game(self) -> GameResult:
        """Run the main game loop until completion."""
        max_total_moves = self.config.max_moves * 2
        logger.info(
            "Game started: %s (white) vs %s (black), max %d moves per side",
            self.config.white_model,
            self.config.black_model,
            self.config.max_moves,
        )

        while (
            not self.board.is_game_over() and len(self.move_history) < max_total_moves
        ):
            current_color = "white" if self.board.turn == chess.WHITE else "black"
            model_name = (
                self.config.white_model
                if current_color == "white"
                else self.config.black_model
            )

            # Evaluate position BEFORE the move (for classification)
            eval_before: PositionEval | None = None
            if self.stockfish:
                await self._emit_status(
                    f"Evaluating position (move {self.board.fullmove_number})..."
                )
                try:
                    eval_before = await self.stockfish.evaluate(self.board)
                except Exception as e:
                    logger.warning(
                        "Stockfish eval_before failed (move %d): %s",
                        self.board.fullmove_number,
                        e,
                    )

            # Determine side type
            is_human = (current_color == "white" and self.config.white_is_human) or (
                current_color == "black" and self.config.black_is_human
            )
            is_stockfish = (
                current_color == "white" and self.config.white_is_stockfish
            ) or (current_color == "black" and self.config.black_is_stockfish)

            if is_human:
                logger.debug(
                    "Move %d: awaiting human move (%s) | FEN: %s",
                    self.board.fullmove_number,
                    current_color,
                    self.board.fen(),
                )
                await self._emit_status(
                    f"Waiting for {current_color.title()} (Human) to move..."
                )
                move_coro = self._get_human_move(current_color)
            elif is_stockfish:
                logger.debug(
                    "Move %d: requesting Stockfish move (%s) | FEN: %s",
                    self.board.fullmove_number,
                    current_color,
                    self.board.fen(),
                )
                await self._emit_status(
                    f"Stockfish ({current_color.title()}) is thinking..."
                )
                move_coro = self._get_stockfish_move(current_color, eval_before)
            else:
                logger.debug(
                    "Move %d: requesting move from %s (%s) | FEN: %s",
                    self.board.fullmove_number,
                    model_name,
                    current_color,
                    self.board.fen(),
                )
                await self._emit_status(
                    f"Waiting for {current_color.title()} ({model_name}) to move..."
                )
                move_coro = self._get_llm_move(model_name, current_color)

            # Apply per-move time limit if configured; non-human sides always get
            # a ceiling so a hung provider can't stall the game forever.
            effective_limit = self.config.move_time_limit
            if effective_limit is None and not is_human:
                effective_limit = LLM_MOVE_TIMEOUT_DEFAULT
            heartbeat: asyncio.Task | None = None
            if not is_human:
                waiting_label = "Stockfish" if is_stockfish else model_name
                heartbeat = asyncio.create_task(
                    self._still_waiting_heartbeat(waiting_label, current_color)
                )
            try:
                if effective_limit is not None:
                    move_result = await asyncio.wait_for(
                        move_coro,
                        timeout=effective_limit,
                    )
                else:
                    move_result = await move_coro
            except asyncio.TimeoutError:
                winner = "black" if current_color == "white" else "white"
                side_label = (
                    "Human" if is_human else "Stockfish" if is_stockfish else model_name
                )
                logger.warning(
                    "Move %d: %s (%s) timed out after %.1fs",
                    self.board.fullmove_number,
                    side_label,
                    current_color,
                    effective_limit,
                )
                await self._emit_status(f"{current_color.title()} timed out!")
                return self._build_result(
                    outcome=f"{winner}_wins",
                    termination="api_error" if not is_human and not is_stockfish and (self.config.move_time_limit is None or self._move_had_transport_error) else "timeout",
                )
            finally:
                if heartbeat:
                    heartbeat.cancel()

            if move_result is None:
                winner = "black" if current_color == "white" else "white"
                if is_human:
                    logger.info(
                        "Move %d: %s (Human) resigned",
                        self.board.fullmove_number,
                        current_color,
                    )
                    return self._build_result(
                        outcome=f"{winner}_wins",
                        termination="resignation",
                    )
                elif is_stockfish:
                    logger.error(
                        "Move %d: Stockfish failed to produce a move (%s)",
                        self.board.fullmove_number,
                        current_color,
                    )
                    return self._build_result(
                        outcome="draw",
                        termination="error",
                    )
                else:
                    termination = (
                        "api_error"
                        if self._forfeit_was_api_error
                        else "illegal_moves"
                    )
                    logger.warning(
                        "Move %d: %s (%s) forfeited: %s",
                        self.board.fullmove_number,
                        model_name,
                        current_color,
                        termination,
                    )
                    return self._build_result(
                        outcome=f"{winner}_wins",
                        termination=termination,
                    )

            chess_move, narration, table_talk, elapsed_ms, usage_data = move_result

            # Record the SAN before pushing
            is_chaos = self._last_move_was_chaos
            self._last_move_was_chaos = False  # Reset after consuming
            if is_chaos:
                san = self._chaos_san(chess_move)
            else:
                san = self.board.san(chess_move)
            self.board.push(chess_move)

            # In chaos mode, check if a king was captured (game-ending)
            if is_chaos:
                if self.board.king(chess.WHITE) is None:
                    record = MoveRecord(
                        move_number=self.board.fullmove_number
                        - (1 if current_color == "black" else 0),
                        color=current_color,
                        uci=chess_move.uci(),
                        san=san,
                        fen_after=self.board.fen(),
                        narration=narration,
                        table_talk=table_talk,
                        response_time_ms=elapsed_ms,
                        eval_before=eval_before,
                        eval_after=eval_before,
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
                        move_number=self.board.fullmove_number
                        - (1 if current_color == "black" else 0),
                        color=current_color,
                        uci=chess_move.uci(),
                        san=san,
                        fen_after=self.board.fen(),
                        narration=narration,
                        table_talk=table_talk,
                        response_time_ms=elapsed_ms,
                        eval_before=eval_before,
                        eval_after=eval_before,
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
                logger.debug(
                    "Move %d: %s (%s) played %s (%s)",
                    self.board.fullmove_number - (1 if current_color == "black" else 0),
                    current_color,
                    side_label,
                    san,
                    chess_move.uci(),
                )
            else:
                logger.debug(
                    "Move %d: %s played %s (%s) in %dms | tokens: %s in / %s out | cost: $%s",
                    self.board.fullmove_number - (1 if current_color == "black" else 0),
                    current_color,
                    san,
                    chess_move.uci(),
                    elapsed_ms,
                    usage_data.get("input_tokens", "?"),
                    usage_data.get("output_tokens", "?"),
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
                cls = classify_move(
                    eval_before, eval_after, chess_move.uci(), current_color
                )
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
                try:
                    await cb(record)
                except Exception:
                    logger.exception(
                        "move_callback failed (move %d %s); continuing game",
                        record.move_number,
                        record.color,
                    )

            # Draw adjudication check
            if self.config.draw_adjudication and eval_after and not is_chaos:
                if (
                    abs(eval_after.centipawns) <= DRAW_ADJUDICATION_CP_THRESHOLD
                    and eval_after.mate_in is None
                ):
                    self._consecutive_draw_eval_count += 1
                else:
                    self._consecutive_draw_eval_count = 0
                if (
                    self._consecutive_draw_eval_count
                    >= DRAW_ADJUDICATION_MOVE_THRESHOLD
                ):
                    logger.info(
                        "Draw adjudication: eval within ±%dcp for %d consecutive moves",
                        DRAW_ADJUDICATION_CP_THRESHOLD,
                        self._consecutive_draw_eval_count,
                    )
                    await self._emit_status(
                        "Draw by adjudication — position evaluated as equal for 30 moves"
                    )
                    return self._build_result("draw", "adjudication")

        # Game ended naturally
        if len(self.move_history) >= max_total_moves and not self.board.is_game_over():
            logger.info("Game ended: draw by max moves (%d)", max_total_moves)
            return self._build_result(outcome="draw", termination="max_moves")

        result = self._build_result_from_board()
        logger.info(
            "Game ended: %s by %s after %d moves",
            result.outcome,
            result.termination,
            result.total_moves,
        )
        return result

    async def _still_waiting_heartbeat(self, label: str, color: str) -> None:
        """Emit periodic status while a side thinks, so slow providers stay visible."""
        waited = 0.0
        while True:
            await asyncio.sleep(MOVE_WATCHDOG_INTERVAL)
            waited += MOVE_WATCHDOG_INTERVAL
            await self._emit_status(
                f"Still waiting on {label} ({color}) — {waited:.0f}s..."
            )

    async def _emit_status(self, message: str) -> None:
        if self.status_callback:
            await self.status_callback(message)

    async def _get_human_move(
        self,
        color: str,
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
                    logger.debug("Human move accepted: %s (%s)", uci_str, color)
                    return move, "", "", 0, {}
                else:
                    logger.warning(
                        "Human submitted illegal move: %s (%s)", uci_str, color
                    )
                    await self._emit_illegal_move(
                        color=color,
                        model="Human",
                        attempted_move=uci_str,
                        reason="Illegal move",
                        attempt=1,
                    )
                    # Re-signal that we're still waiting
                    if self.awaiting_human_move_callback:
                        await self.awaiting_human_move_callback(color)
            except (ValueError, chess.InvalidMoveError):
                logger.warning("Human submitted invalid UCI: '%s' (%s)", uci_str, color)
                await self._emit_illegal_move(
                    color=color,
                    model="Human",
                    attempted_move=uci_str,
                    reason="Invalid UCI notation",
                    attempt=1,
                )
                if self.awaiting_human_move_callback:
                    await self.awaiting_human_move_callback(color)

    async def _get_stockfish_move(
        self,
        color: str,
        eval_before: PositionEval | None,
    ) -> tuple[chess.Move, str, str, int, dict] | None:
        """Get the best move from Stockfish engine.

        Uses the strength-limited player engine if available, otherwise
        reuses eval_before or evaluates at full strength.
        Returns (move, narration, table_talk, elapsed_ms, usage_data).
        Stockfish moves have no narration, table talk, or usage data.
        """
        best_move_uci: str | None = None
        elapsed_ms = 0

        # Pick the correct per-side player, falling back to shared
        side_player = (self.stockfish_player_white if color == "white" else self.stockfish_player_black) or self.stockfish_player
        if side_player:
            # Use strength-limited player engine
            try:
                best_move_uci, elapsed_ms = await side_player.get_best_move(self.board)
            except Exception as e:
                logger.error("Stockfish player engine failed (%s): %s", color, e)
                return None
        elif eval_before and eval_before.best_move_uci:
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
                logger.error(
                    "Stockfish returned illegal move: %s (%s)", best_move_uci, color
                )
                return None
            self._consecutive_illegal_moves = 0
            return move, "", "", elapsed_ms, {}
        except (ValueError, chess.InvalidMoveError):
            logger.error(
                "Stockfish returned invalid UCI: %s (%s)", best_move_uci, color
            )
            return None

    async def _get_llm_move(
        self, model_name: str, color: str
    ) -> tuple[chess.Move, str, str, int, dict] | None:
        """Get a legal move from the LLM, with retries for illegal moves.

        Uses a game-wide consecutive illegal move counter. Resets on each legal move.
        Returns (move, narration, table_talk, elapsed_ms, usage_data) or None on forfeit.
        usage_data contains input_tokens, output_tokens, cost_usd.
        """
        started = time.monotonic()
        self._forfeit_was_api_error = False
        self._move_had_transport_error = False
        self._consecutive_illegal_moves = 0
        history = [r.model_dump() for r in self.move_history[-max(MOVE_HISTORY_PLIES, TABLE_TALK_HISTORY):]]
        effort = getattr(self.config, f"{color}_reasoning_effort")
        routing = self.config.routing_mode or ("nitro" if self.config.use_nitro else "economy")
        settings: OpenRouterModelSettings = {
            "max_tokens": LLM_MAX_TOKENS,
            "timeout": LLM_REQUEST_TIMEOUT,
            "openrouter_usage": {"include": True},
            "openrouter_cache_instructions": LLM_CACHE_TTL,
        }
        if effort and effort != "provider_default":
            settings["openrouter_reasoning"] = {"effort": effort}
        if effort == "none":
            temp = getattr(self.config, f"{color}_temperature")
            settings["temperature"] = temp if temp is not None else DEFAULT_TEMPERATURE
        if self.game_id:
            settings["extra_body"] = {"session_id": f"{self.game_id}:{color}"}
        if routing == "responsive":
            routed_model = model_name
            settings["openrouter_provider"] = {"sort": "latency"}
        else:
            routed_model = f"{model_name}:{'nitro' if routing == 'nitro' else 'floor'}"
        deps = ChessGameContext(
            board=self.board.copy(), color=color, move_history=history,
            model_name=model_name, reasoning_effort=effort, routing_mode=routing,
            chaos_mode=self.config.chaos_mode, status_callback=self._emit_status,
            illegal_callback=self._emit_illegal_move,
        )
        prompt = build_user_prompt(self.board, color, history)
        transport_errors = 0
        persisted = 0
        while True:
            deps.output_mode = "prompted" if color in self._prompted_output_colors else "tool"
            kwargs = {"output_type": PromptedOutput(ChessMove)} if deps.output_mode == "prompted" else {}
            retry_delay = None
            fallback = False
            try:
                result = await chess_agent.run(
                    prompt, deps=deps, model=arena_model(routed_model),
                    model_settings=settings, **kwargs,
                )
            except asyncio.CancelledError:
                if deps.current:
                    deps.current.status = "cancelled"
                    deps.current.elapsed_ms = int((time.monotonic() - deps.request_started) * 1000)
                raise
            except UnexpectedModelBehavior:
                if not deps.response_received:
                    self._forfeit_was_api_error = True
                    if deps.current:
                        deps.current.status = "provider_error"
                        deps.current.elapsed_ms = int((time.monotonic() - deps.request_started) * 1000)
                    return None
                if deps.current and deps.current.status == "invalid_output":
                    await deps.reject("(invalid output)", "Response did not match the move format")
                self._consecutive_illegal_moves = deps.invalid_count
                return None
            except Exception as exc:
                code = getattr(exc, "status_code", None)
                transient = code in (408, 429) or (isinstance(code, int) and code >= 500) or isinstance(exc, (httpx.TransportError, APIConnectionError, TimeoutError))
                # Forced tool output is unsupported by some reasoning routes.
                fallback = code == 400 and any(term in str(exc).lower() for term in ("tool_choice", "tool choice")) and deps.output_mode == "tool"
                if deps.current is None or deps.current in deps.records[:persisted]:
                    deps.request_started = time.monotonic()
                    deps.current = LLMRequestRecord(
                        move_number=self.board.fullmove_number, color=color, model=model_name,
                        attempt=len(deps.records) + 1, output_mode=deps.output_mode,
                        reasoning_effort=effort, routing_mode=routing,
                        harness_version=HARNESS_VERSION, status="provider_error", elapsed_ms=0,
                    )
                    deps.records.append(deps.current)
                deps.current.status = "transport_error" if transient else "provider_error"
                deps.current.elapsed_ms = int((time.monotonic() - deps.request_started) * 1000)
                logger.warning("LLM request failed: game=%s color=%s status=%s code=%s", self.game_id, color, deps.current.status, code)
                if fallback:
                    self._prompted_output_colors.add(color)
                elif transient:
                    self._move_had_transport_error = True
                    transport_errors += 1
                    if transport_errors < LLM_TRANSPORT_ATTEMPTS:
                        retry_after = getattr(exc, "retry_after", None)
                        retry_delay = max(0.0, retry_after) if retry_after is not None else LLM_RETRY_BASE_DELAY * 2 ** (transport_errors - 1)
                if not fallback and retry_delay is None:
                    self._forfeit_was_api_error = True
                    return None
            else:
                move = chess.Move.from_uci(result.output.move.strip())
                self._consecutive_illegal_moves = 0
                self._last_move_was_chaos = move not in self.board.legal_moves
                if self._last_move_was_chaos:
                    await self._emit_chaos_move(
                        color=color, model=model_name, attempted_move=move.uci(),
                        move_number=self.board.fullmove_number,
                    )
                await deps.status(f"{color.title()}: move accepted")
                usage = {
                    name: sum(getattr(r, name) for r in deps.records)
                    if all(getattr(r, name) is not None for r in deps.records) else None
                    for name in ("input_tokens", "output_tokens", "cost_usd")
                }
                return move, result.output.narration, result.output.table_talk, int((time.monotonic() - started) * 1000), usage
            finally:
                pending = deps.records[persisted:]
                self.request_records.extend(pending)
                for record in pending:
                    logger.info("llm_request game=%s record=%s", self.game_id, record.model_dump_json())
                    for callback in self.request_callbacks:
                        try:
                            await callback(record)
                        except Exception:
                            logger.exception("Request persistence callback failed: game=%s request=%s", self.game_id, record.id)
                persisted = len(deps.records)
            if fallback:
                await deps.status(f"{color.title()}: retrying with compatible move format…")
            elif retry_delay is not None:
                await deps.status(f"{color.title()}: provider unavailable; retrying in {retry_delay:g}s…")
                await asyncio.sleep(retry_delay)
            if deps.invalid_count:
                prompt = build_user_prompt(
                    self.board, color, history,
                    "Previous responses did not produce a legal move. Check the position and move format.",
                    include_legal_moves=deps.invalid_count >= 3,
                )

    async def _emit_illegal_move(
        self, *, color: str, model: str, attempted_move: str, reason: str, attempt: int
    ) -> None:
        """Notify all illegal move callbacks."""
        # The DB counter lives on the composite leaderboard identity, so emit it
        # alongside the raw label (which is used for display). Illegal moves only
        # come from LLM/Human sides, never a strength-limited Stockfish.
        is_human = (color == "white" and self.config.white_is_human) or (
            color == "black" and self.config.black_is_human
        )
        is_stockfish = (color == "white" and self.config.white_is_stockfish) or (
            color == "black" and self.config.black_is_stockfish
        )
        effort = (
            self.config.white_reasoning_effort
            if color == "white"
            else self.config.black_reasoning_effort
        )
        event = {
            "color": color,
            "model": model,
            "rating_key": rating_key(model, effort, is_human, is_stockfish),
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
        self,
        *,
        color: str,
        model: str,
        attempted_move: str,
        move_number: int,
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
        total_input = sum(r.input_tokens or 0 for r in self.request_records)
        total_output = sum(r.output_tokens or 0 for r in self.request_records)
        total_cost = sum(r.cost_usd or 0.0 for r in self.request_records)
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
            total_input_tokens=total_input if all(r.input_tokens is not None for r in self.request_records) else None,
            total_output_tokens=total_output if all(r.output_tokens is not None for r in self.request_records) else None,
            total_cost_usd=total_cost if all(r.cost_usd is not None for r in self.request_records) else None,
            known_input_tokens=total_input,
            known_output_tokens=total_output,
            known_cost_usd=total_cost,
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
                if record.eval_after.mate_in is not None:
                    raw_score = chess.engine.Mate(record.eval_after.mate_in)
                else:
                    raw_score = chess.engine.Cp(record.eval_after.centipawns)
                node.set_eval(chess.engine.PovScore(raw_score, chess.WHITE))

            board.push(move)

        return str(game)
