from __future__ import annotations

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


@router.websocket("/ws/games/{game_id}")
async def game_websocket(websocket: WebSocket, game_id: str):
    """Stream real-time game events over WebSocket.

    Protocol:
      1. Server sends catch_up with current game state (moves so far)
      2. Server streams: status, move_played, game_over events
      3. Connection closes after game_over or on client disconnect
    """
    await websocket.accept()

    manager = websocket.app.state.game_manager

    # Send catch-up state (all moves played so far)
    catch_up = await manager.get_catch_up_state(game_id)
    if catch_up is None:
        await websocket.send_json({"type": "error", "data": {"message": "Game not found"}})
        await websocket.close(code=4004)
        return

    await websocket.send_text(json.dumps(catch_up, default=_json_default))

    # If game is already completed, close after sending catch-up
    if catch_up["data"]["status"] == "completed":
        await websocket.close()
        return

    # Subscribe to live events
    queue = manager.subscribe(game_id)
    try:
        while True:
            event = await queue.get()
            if event is None:
                # Game ended, manager sends None to signal cleanup
                break
            await websocket.send_text(json.dumps(event, default=_json_default))
            if event.get("type") == "game_over":
                break
    except WebSocketDisconnect:
        logger.debug("WebSocket client disconnected from game %s", game_id)
    except Exception:
        logger.exception("WebSocket error for game %s", game_id)
    finally:
        manager.unsubscribe(game_id, queue)
        try:
            await websocket.close()
        except Exception:
            pass
