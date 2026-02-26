from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel.ext.asyncio.session import AsyncSession

from app.database import get_session
from app.models.api_models import PlatformOverview
from app.services.stats_service import compute_platform_overview

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("/overview", response_model=PlatformOverview)
async def get_stats_overview(session: AsyncSession = Depends(get_session)):
    return await compute_platform_overview(session)
