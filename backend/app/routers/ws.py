from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

logger = logging.getLogger(__name__)


def _json_default(obj):
    """Handle datetime and other non-serializable types."""
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


async def _send_events(websocket: WebSocket, queue: asyncio.Queue, game_id: str) -> None:
    """Forward events from the game manager queue to the WebSocket client."""
    while True:
        event = await queue.get()
        if event is None:
            logger.info("WebSocket received end signal: game=%s", game_id)
            break
        event_type = event.get("type", "unknown")
        await websocket.send_text(json.dumps(event, default=_json_default))
        logger.debug("WebSocket sent event: game=%s, type=%s", game_id, event_type)
        if event_type == "game_over":
            break


async def _receive_messages(websocket: WebSocket, game_id: str) -> None:
    """Read messages from the WebSocket client (human moves, resignation)."""
    manager = websocket.app.state.game_manager
    while True:
        raw = await websocket.receive_text()
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("WebSocket invalid JSON from client: game=%s", game_id)
            continue

        msg_type = msg.get("type")
        if msg_type == "human_move":
            uci = msg.get("uci", "").strip()
            if uci:
                logger.info("WebSocket human move received: game=%s, uci=%s", game_id, uci)
                await manager.submit_human_move(game_id, uci)
            else:
                logger.warning("WebSocket human_move missing uci: game=%s", game_id)
        elif msg_type == "resign":
            logger.info("WebSocket resignation received: game=%s", game_id)
            await manager.submit_human_move(game_id, "resign")
        else:
            logger.debug("WebSocket unknown message type: game=%s, type=%s", game_id, msg_type)


@router.websocket("/ws/games/{game_id}")
async def game_websocket(websocket: WebSocket, game_id: str):
    """Stream real-time game events over WebSocket.

    Protocol:
      1. Server sends catch_up with current game state (moves so far)
      2. Server streams: status, move_played, game_over events
      3. Client can send: human_move, resign messages
      4. Connection closes after game_over or on client disconnect
    """
    await websocket.accept()
    logger.info("WebSocket connected: game=%s, client=%s", game_id, websocket.client)

    manager = websocket.app.state.game_manager

    # Send catch-up state (all moves played so far)
    catch_up = await manager.get_catch_up_state(game_id)
    if catch_up is None:
        logger.warning("WebSocket game not found: %s", game_id)
        await websocket.send_json({"type": "error", "data": {"message": "Game not found"}})
        await websocket.close(code=4004)
        return

    move_count = len(catch_up["data"].get("moves", []))
    status = catch_up["data"]["status"]
    logger.info("WebSocket catch-up sent: game=%s, %d moves, status=%s", game_id, move_count, status)
    await websocket.send_text(json.dumps(catch_up, default=_json_default))

    # If game is already completed, close after sending catch-up
    if status == "completed":
        logger.info("WebSocket closing (game completed): game=%s", game_id)
        await websocket.close()
        return

    # Subscribe to live events
    queue = manager.subscribe(game_id)
    try:
        # Run send and receive concurrently
        send_task = asyncio.create_task(_send_events(websocket, queue, game_id))
        receive_task = asyncio.create_task(_receive_messages(websocket, game_id))

        done, pending = await asyncio.wait(
            {send_task, receive_task},
            return_when=asyncio.FIRST_COMPLETED,
        )

        for t in pending:
            t.cancel()
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected: game=%s", game_id)
    except Exception:
        logger.exception("WebSocket error: game=%s", game_id)
    finally:
        manager.unsubscribe(game_id, queue)
        try:
            await websocket.close()
        except Exception:
            pass
