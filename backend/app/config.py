import os
from dotenv import load_dotenv

load_dotenv()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")

# Game defaults
MAX_MOVES_PER_SIDE = int(os.getenv("MAX_MOVES_PER_SIDE", "200"))
MAX_CONSECUTIVE_ILLEGAL_MOVES = int(os.getenv("MAX_CONSECUTIVE_ILLEGAL_MOVES", "10"))
MIN_MOVE_TIME_LIMIT = float(os.getenv("MIN_MOVE_TIME_LIMIT", "5"))
MAX_MOVE_TIME_LIMIT = float(os.getenv("MAX_MOVE_TIME_LIMIT", "600"))

# ELO
ELO_K_FACTOR = int(os.getenv("ELO_K_FACTOR", "32"))
DEFAULT_MODEL_ELO = float(os.getenv("DEFAULT_MODEL_ELO", "1500.0"))

# Rate limiting (per IP, per minute)
RATE_LIMIT_GAME_CREATE = int(os.getenv("RATE_LIMIT_GAME_CREATE", "5"))
RATE_LIMIT_API_READ = int(os.getenv("RATE_LIMIT_API_READ", "60"))
RATE_LIMIT_GAME_STOP = int(os.getenv("RATE_LIMIT_GAME_STOP", "10"))
RATE_LIMIT_WS_CONNECT = int(os.getenv("RATE_LIMIT_WS_CONNECT", "20"))

# Concurrency
MAX_CONCURRENT_GAMES = int(os.getenv("MAX_CONCURRENT_GAMES", "3"))
MAX_QUEUED_GAMES = int(os.getenv("MAX_QUEUED_GAMES", "25"))
MAX_WS_EVENT_QUEUE_SIZE = int(os.getenv("MAX_WS_EVENT_QUEUE_SIZE", "64"))

# Stockfish (evaluation engine)
STOCKFISH_PATH = os.getenv("STOCKFISH_PATH", "/usr/games/stockfish")
STOCKFISH_THREADS = int(os.getenv("STOCKFISH_THREADS", "2"))
STOCKFISH_HASH_MB = int(os.getenv("STOCKFISH_HASH_MB", "128"))
STOCKFISH_DEPTH_LIVE = int(os.getenv("STOCKFISH_DEPTH_LIVE", "18"))
STOCKFISH_DEPTH_DEEP = int(os.getenv("STOCKFISH_DEPTH_DEEP", "22"))

# Stockfish (strength-limited player engine)
STOCKFISH_PLAYER_THREADS = int(os.getenv("STOCKFISH_PLAYER_THREADS", "1"))
STOCKFISH_PLAYER_HASH_MB = int(os.getenv("STOCKFISH_PLAYER_HASH_MB", "64"))
STOCKFISH_PLAYER_MOVE_TIME = float(os.getenv("STOCKFISH_PLAYER_MOVE_TIME", "1.0"))
STOCKFISH_MIN_ELO = int(os.getenv("STOCKFISH_MIN_ELO", "1320"))
STOCKFISH_MAX_ELO = int(os.getenv("STOCKFISH_MAX_ELO", "3190"))

# Draw adjudication
DRAW_ADJUDICATION_CP = int(os.getenv("DRAW_ADJUDICATION_CP", "20"))
DRAW_ADJUDICATION_MOVES = int(os.getenv("DRAW_ADJUDICATION_MOVES", "30"))

# LLM sampling / prompting
# Default sampling temperature applied when a side leaves temperature unset. 0.7
# is the conventional "general intelligence" competitive default (between the
# vendor raw default of 1.0 and the agentic-reliability lows of 0.2-0.3): coherent
# enough for legal moves and structured output, varied enough for interesting
# games. It is ALSO the rated baseline — a game counts toward ELO only when both
# LLM sides leave temperature at this default (see GameManager skip_elo). Reasoning
# models often reject/ignore an explicit temperature, so the engine omits it
# entirely when reasoning effort is active; the game stays rated regardless.
DEFAULT_TEMPERATURE = float(os.getenv("DEFAULT_TEMPERATURE", "0.7"))
# Trim the move list / table-talk fed to the LLM each turn. The FEN already encodes
# the full position; only recent plies matter for tactical continuity, and a bounded
# prompt avoids unbounded token growth (and "lost in the middle") in long games.
MOVE_HISTORY_PLIES = int(os.getenv("MOVE_HISTORY_PLIES", "16"))
TABLE_TALK_HISTORY = int(os.getenv("TABLE_TALK_HISTORY", "10"))

# Hard HTTP timeout per LLM request; a hung provider fails the attempt instead of
# stalling the game (the engine's retry loop then counts it as a failure).
LLM_REQUEST_TIMEOUT = float(os.getenv("LLM_REQUEST_TIMEOUT", "120"))
# Default whole-move ceiling (incl. retries) for LLM/Stockfish sides when the game
# has no explicit move_time_limit. Never applied to humans.
LLM_MOVE_TIMEOUT_DEFAULT = float(os.getenv("LLM_MOVE_TIMEOUT_DEFAULT", "300"))
# Heartbeat while a side is thinking, so a slow/hung provider is visible in the UI.
MOVE_WATCHDOG_INTERVAL = float(os.getenv("MOVE_WATCHDOG_INTERVAL", "30"))

# LLM output limits
NARRATION_CHAR_CAP = int(os.getenv("NARRATION_CHAR_CAP", "128"))
# Cap on completion tokens per LLM move. Sent as max_tokens to OpenRouter.
# When unset, OpenRouter falls back to the model's full output ceiling (e.g. 64k
# for Claude Opus), which makes its pre-flight credit check reserve enough credit
# for that worst case and can 402 on premium models. This also bounds reasoning:
# on the reasoning.effort path the thinking budget is a fraction of max_tokens
# (high ~= 0.8), so 16384 gives high-effort models ~13k thinking tokens plus
# ample room for the small move/narration/table_talk response.
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "16384"))

# Admin — shared secret authorizing destructive admin actions (e.g. deleting
# broken games) via the X-Admin-Token header. Left empty by default: when unset,
# the admin endpoints are disabled entirely (return 404), so public/forked
# deployments expose nothing. Set this in your own deployment to enable them.
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")

# Logging
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

# CORS — comma-separated origins, locked to production domain by default
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "https://llmchess.deadpackets.pw").split(
    ","
)
