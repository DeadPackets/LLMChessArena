"""Live E2E for game-creation guards and the human move path. Spends ~1 cent on OpenRouter.

Not collected by pytest. Starts its own servers in a temp dir (fresh SQLite DB), using
Cloudflare's always-pass Turnstile test keys. Writes a JSON report as the artifact.

    cd backend && .venv/bin/python tests/e2e_game_limits.py /path/to/report.json
"""

import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
import websockets
from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND / ".env")  # OPENROUTER_API_KEY, STOCKFISH_PATH
MODEL = "google/gemini-3.1-flash-lite"
ADMIN = "e2e-admin"
TS_PASS_TOKEN = "XXXX.DUMMY.TOKEN.XXXX"  # accepted by the always-pass test secret
results: list[dict] = []


def check(name: str, ok: bool, detail) -> None:
    results.append({"check": name, "ok": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name, "" if ok else detail)


def start_server(port: int, workdir: str, **env) -> subprocess.Popen:
    full_env = {**os.environ, "PYTHONPATH": str(BACKEND), "GAMES_PER_DAY": "1",
                "TURNSTILE_SITE_KEY": "1x00000000000000000000AA",
                "TURNSTILE_SECRET_KEY": "1x0000000000000000000000000000000AA",
                "TURNSTILE_HOSTNAMES": "example.com",  # what the test secret reports
                "ADMIN_TOKEN": ADMIN, "HUMAN_MOVE_TIMEOUT_DEFAULT": "20", **env}
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port)],
        cwd=workdir, env=full_env, stdout=subprocess.DEVNULL, stderr=open(f"{workdir}/server.log", "w"),
    )
    for _ in range(60):
        try:
            if httpx.get(f"http://127.0.0.1:{port}/health").status_code == 200:
                return proc
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    raise RuntimeError(f"server on {port} did not start")


def body(**extra) -> dict:
    return {"white_is_human": True, "black_model": MODEL, "turnstile_token": TS_PASS_TOKEN, **extra}


async def human_move_flow(base: str, game_id: str, secret: str) -> None:
    async with websockets.connect(f"ws://127.0.0.1:{base.rsplit(':', 1)[1]}/ws/games/{game_id}") as ws:
        events = []
        async def until(pred, timeout=90):
            end = time.monotonic() + timeout
            while time.monotonic() < end:
                msg = json.loads(await asyncio.wait_for(ws.recv(), end - time.monotonic()))
                events.append(msg["type"])
                if pred(msg):
                    return msg
            raise TimeoutError
        catch_up = await until(lambda m: m["type"] == "catch_up")
        if catch_up["data"]["awaiting_human_move"] != "white":
            await until(lambda m: m["type"] == "awaiting_human_move")
        await ws.send(json.dumps({"type": "human_move", "uci": "e2e4", "player_secret": secret}))
        mine = await until(lambda m: m["type"] == "move_played")
        check("human move e2e4 accepted", mine["data"]["uci"] == "e2e4", mine["data"])
        reply = await until(lambda m: m["type"] == "move_played")
        check("LLM replied as black", reply["data"]["color"] == "black", reply["data"].get("san"))
        over = await until(lambda m: m["type"] == "game_over", timeout=60)
        check("idle human forfeits on time (no slot leak)", over["data"]["termination"] == "timeout", over["data"])


async def main(report: Path) -> None:
    workdir = tempfile.mkdtemp(prefix="chess-e2e-")
    good = start_server(8765, workdir)
    base = "http://127.0.0.1:8765"
    try:
        c = httpx.Client(base_url=base, timeout=30)
        qs = c.get("/api/games/queue-status").json()
        check("queue-status exposes site key + quota", qs["turnstile_site_key"] and qs["games_per_day"] == 1, qs)

        r = c.post("/api/games", json=body(turnstile_token=None))
        check("missing Turnstile token -> 403", r.status_code == 403, r.text)

        r = c.post("/api/games", json=body(black_model=f"{MODEL}:batch"))
        check(":batch variant -> 400", r.status_code == 400, r.text)

        first = c.post("/api/games", json=body())
        check("first game today -> 200", first.status_code == 200, first.text)

        r = c.post("/api/games", json=body())
        check("second game same IP -> 429 with Retry-After",
              r.status_code == 429 and int(r.headers.get("retry-after", 0)) > 23 * 3600, [r.text, dict(r.headers)])

        other = {"X-Real-IP": "203.0.113.7"}
        r = c.post("/api/games", json=body(), headers=other)
        check("different IP -> 200", r.status_code == 200, r.text)
        c.post(f"/api/games/{r.json()['id']}/stop", json={"player_secret": r.json()["player_secret"]})

        r1 = c.post("/api/games", json=body(), headers={"X-Real-IP": "2001:db8:1:2::1"})
        r2 = c.post("/api/games", json=body(), headers={"X-Real-IP": "2001:db8:1:2::ffff"})
        check("IPv6 quota keyed by /64", r1.status_code == 200 and r2.status_code == 429, [r1.text, r2.text])
        c.post(f"/api/games/{r1.json()['id']}/stop", json={"player_secret": r1.json()["player_secret"]})

        r = c.post("/api/games", json=body(turnstile_token=None), headers={"X-Admin-Token": ADMIN})
        check("admin token bypasses quota + Turnstile", r.status_code == 200, r.text)
        c.post(f"/api/games/{r.json()['id']}/stop", json={"player_secret": r.json()["player_secret"]})

        g = first.json()
        await human_move_flow(base, g["id"], g["player_secret"])
    finally:
        good.terminate()

    bad = start_server(8766, workdir, OPENROUTER_API_KEY="sk-or-v1-disabled-e2e")
    try:
        c = httpx.Client(base_url="http://127.0.0.1:8766", timeout=30)
        qs = c.get("/api/games/queue-status").json()
        check("disabled key reported in queue-status", bool(qs["llm_unavailable"]), qs["llm_unavailable"])
        r = c.post("/api/games", json=body(), headers={"X-Real-IP": "198.51.100.9"})
        check("disabled key -> 503 with reason", r.status_code == 503 and "paused" in r.text, r.text)
    finally:
        bad.terminate()

    # Mid-game 401: drive the real engine against OpenRouter with a dead key.
    proc = subprocess.run([sys.executable, "-c", """
import asyncio
from app.models.chess_models import GameConfig
from app.services.game_engine import GameEngine
from app.services import openrouter_key
r = asyncio.run(GameEngine(GameConfig(white_model='%s', black_model='%s', max_moves=1)).play_game())
print(r.outcome, r.termination, bool(openrouter_key._state['reason']))
""" % (MODEL, MODEL)], cwd=workdir, capture_output=True, text=True, timeout=120,
        env={**os.environ, "PYTHONPATH": str(BACKEND), "OPENROUTER_API_KEY": "sk-or-v1-disabled-e2e"})
    out = proc.stdout.strip().splitlines()[-1] if proc.stdout.strip() else proc.stderr[-500:]
    check("mid-game 401 -> outcome * / llm_unavailable, new games blocked", out == "* llm_unavailable True", out)

    report.write_text(json.dumps({"passed": all(r["ok"] for r in results), "results": results,
                                  "server_logs": workdir}, indent=2, default=str))
    print(f"\n{sum(r['ok'] for r in results)}/{len(results)} passed -> {report}")
    sys.exit(0 if all(r["ok"] for r in results) else 1)


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1] if len(sys.argv) > 1 else "e2e_game_limits_report.json")))
