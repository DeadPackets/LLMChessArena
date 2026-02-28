import os
from dotenv import load_dotenv

load_dotenv()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")

# Game defaults
MAX_MOVES_PER_SIDE = int(os.getenv("MAX_MOVES_PER_SIDE", "200"))
MAX_CONSECUTIVE_ILLEGAL_MOVES = int(os.getenv("MAX_CONSECUTIVE_ILLEGAL_MOVES", "10"))

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

# LLM output limits
NARRATION_CHAR_CAP = int(os.getenv("NARRATION_CHAR_CAP", "128"))
