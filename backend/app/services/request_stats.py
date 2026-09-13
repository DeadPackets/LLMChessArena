from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.database import Game, LLMRequest, Move
from app.models.api_models import GameEfficiency
from app.models.chess_models import LLMRequestRecord


async def get_game_usage(session: AsyncSession, game: Game) -> dict:
    records = (await session.exec(
        select(LLMRequest).where(LLMRequest.game_id == game.id)
    )).all()
    stats = summarize_requests(records)
    legacy = not records and game.harness_version is None
    return {
        "total_cost_usd": game.total_cost_usd if legacy else stats.total_cost_usd,
        "total_input_tokens": stats.input_tokens,
        "total_output_tokens": stats.output_tokens,
        "known_cost_usd": game.total_cost_usd if legacy else stats.known_cost_usd,
        "known_input_tokens": sum(r.input_tokens for r in records if r.input_tokens is not None),
        "known_output_tokens": sum(r.output_tokens for r in records if r.output_tokens is not None),
    }


def summarize_requests(
    records: Sequence[LLMRequest | LLMRequestRecord],
    moves: Sequence[Move] = (),
) -> GameEfficiency:
    def complete_sum(field: str, rows=records):
        values = [getattr(row, field) for row in rows]
        return sum(values) if values and all(v is not None for v in values) else None

    plies = defaultdict(list)
    for record in records:
        plies[(record.color, record.move_number)].append(record)
    retries = [r for rows in plies.values() for r in sorted(rows, key=lambda r: r.attempt)[1:]]
    cache_rows = [r for r in records if r.cache_read_tokens is not None]
    paired_cache_rows = [r for r in cache_rows if r.input_tokens is not None]
    cache_input = sum(r.input_tokens for r in paired_cache_rows)
    timings = {(m.color, m.move_number): m.response_time_ms for m in moves}
    accepted_times = [
        timings.get(key, sum(r.elapsed_ms for r in rows))
        for key, rows in plies.items() if any(r.status == "accepted" for r in rows)
    ]
    return GameEfficiency(
        request_count=len(records),
        retry_count=len(retries),
        input_tokens=complete_sum("input_tokens"),
        output_tokens=complete_sum("output_tokens"),
        cache_read_tokens=complete_sum("cache_read_tokens"),
        cache_write_tokens=complete_sum("cache_write_tokens"),
        cache_hit_ratio=(sum(r.cache_read_tokens for r in paired_cache_rows) / cache_input)
        if cache_input else None,
        known_cost_usd=sum(r.cost_usd for r in records if r.cost_usd is not None),
        total_cost_usd=complete_sum("cost_usd"),
        retry_cost_usd=complete_sum("cost_usd", retries) if retries else (0.0 if records else None),
        cost_known_requests=sum(r.cost_usd is not None for r in records),
        cache_known_requests=len(cache_rows),
        avg_move_ms=sum(accepted_times) / len(accepted_times) if accepted_times else None,
        providers=sorted({r.provider for r in records if r.provider}),
    )
