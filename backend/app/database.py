from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlmodel import SQLModel, Field
from sqlmodel.ext.asyncio.session import AsyncSession

DATABASE_URL = "sqlite+aiosqlite:///./data/llmchessarena.db"


# --- Table Models ---

class Game(SQLModel, table=True):
    __tablename__ = "games"

    id: str = Field(primary_key=True)
    white_model: str
    black_model: str
    status: str = Field(default="pending")  # pending, active, completed
    outcome: Optional[str] = None
    termination: Optional[str] = None
    opening_eco: Optional[str] = None
    opening_name: Optional[str] = None
    pgn: Optional[str] = None
    total_moves: int = Field(default=0)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    white_illegal_moves: int = Field(default=0)
    black_illegal_moves: int = Field(default=0)
    total_cost_usd: float = Field(default=0.0)
    white_temperature: Optional[float] = None
    black_temperature: Optional[float] = None
    white_reasoning_effort: Optional[str] = None
    black_reasoning_effort: Optional[str] = None
    white_is_human: Optional[bool] = Field(default=False)
    black_is_human: Optional[bool] = Field(default=False)
    white_is_stockfish: Optional[bool] = Field(default=False)
    black_is_stockfish: Optional[bool] = Field(default=False)
    player_secret: Optional[str] = None


class Move(SQLModel, table=True):
    __tablename__ = "moves"

    id: Optional[int] = Field(default=None, primary_key=True)
    game_id: str = Field(foreign_key="games.id", index=True)
    move_number: int
    color: str
    uci: str
    san: str
    fen_after: str
    narration: Optional[str] = None
    table_talk: Optional[str] = None
    centipawns: Optional[int] = None
    mate_in: Optional[int] = None
    win_probability: Optional[float] = None
    best_move_uci: Optional[str] = None
    classification: Optional[str] = None
    response_time_ms: int = Field(default=0)
    opening_eco: Optional[str] = None
    opening_name: Optional[str] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    cost_usd: Optional[float] = None
    timestamp: Optional[datetime] = None


class LLMModel(SQLModel, table=True):
    __tablename__ = "models"

    id: str = Field(primary_key=True)  # OpenRouter model ID
    display_name: Optional[str] = None
    elo_rating: float = Field(default=1500.0)
    games_played: int = Field(default=0)
    wins: int = Field(default=0)
    draws: int = Field(default=0)
    losses: int = Field(default=0)
    total_illegal_moves: int = Field(default=0)


# --- Engine + Session ---

engine = None
async_session_factory = None


async def init_db(url: str = DATABASE_URL):
    """Create the async engine, session factory, and initialize all tables."""
    global engine, async_session_factory

    engine = create_async_engine(url, connect_args={"check_same_thread": False})
    async_session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
        # Lightweight migrations for new columns on existing tables
        await _migrate_add_columns(conn)

    return engine


async def _migrate_add_columns(conn) -> None:
    """Add missing columns to existing tables (idempotent)."""
    import sqlalchemy

    migrations = [
        ("games", "temperature", "FLOAT"),
        ("games", "reasoning_effort", "VARCHAR"),
        ("games", "white_temperature", "FLOAT"),
        ("games", "black_temperature", "FLOAT"),
        ("games", "white_reasoning_effort", "VARCHAR"),
        ("games", "black_reasoning_effort", "VARCHAR"),
        ("games", "white_is_human", "BOOLEAN DEFAULT 0"),
        ("games", "black_is_human", "BOOLEAN DEFAULT 0"),
        ("games", "white_is_stockfish", "BOOLEAN DEFAULT 0"),
        ("games", "black_is_stockfish", "BOOLEAN DEFAULT 0"),
        ("games", "player_secret", "VARCHAR"),
    ]
    for table, column, col_type in migrations:
        try:
            await conn.execute(
                sqlalchemy.text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
            )
        except Exception:
            pass  # Column already exists


def get_session_factory():
    if async_session_factory is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    return async_session_factory


async def get_session():
    """FastAPI dependency that yields an async session."""
    factory = get_session_factory()
    async with factory() as session:
        yield session
