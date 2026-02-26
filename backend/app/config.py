import os
from dotenv import load_dotenv

load_dotenv()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")

# Game defaults
MAX_MOVES_PER_SIDE = 200
MAX_CONSECUTIVE_ILLEGAL_MOVES = 10

# Stockfish
STOCKFISH_PATH = os.getenv("STOCKFISH_PATH", "/usr/games/stockfish")
STOCKFISH_DEPTH_LIVE = 18
STOCKFISH_DEPTH_DEEP = 22
