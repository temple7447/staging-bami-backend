"""
Growth — persists the Scalable Impact Plan (Level 7 planner + OS builder).

One JSON document per owner. The Coach and the Scale page read the denormalised
key fields (number, level, why) so the whole system shares one source of truth.
"""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from models.user import User
from models.growth_plan import GrowthPlan
from models.base import gen_uuid
from core.security import get_current_user
from core.database import get_db
from utils.time_utils import utcnow

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/growth", tags=["Growth / Level 7 Plan"])


class GrowthPlanBody(BaseModel):
    data: Optional[dict] = None
    current_step: Optional[int] = None
    stated_level: Optional[int] = None
    target_revenue: Optional[float] = None
    target_profit: Optional[float] = None
    target_valuation: Optional[float] = None
    why_summary: Optional[str] = None


def _serialize(p: GrowthPlan) -> dict:
    return {
        "exists": True,
        "data": p.data or {},
        "current_step": p.current_step,
        "stated_level": p.stated_level,
        "target_revenue": p.target_revenue,
        "target_profit": p.target_profit,
        "target_valuation": p.target_valuation,
        "why_summary": p.why_summary,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


async def get_owner_plan(db: AsyncSession, owner_id: str) -> GrowthPlan | None:
    return (await db.execute(
        select(GrowthPlan).where(GrowthPlan.owner_id == owner_id)
    )).scalars().first()


@router.get("/plan")
async def get_plan(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    plan = await get_owner_plan(db, str(current_user.id))
    if not plan:
        return {"exists": False, "data": {}, "current_step": 1, "stated_level": None,
                "target_revenue": None, "target_profit": None, "target_valuation": None,
                "why_summary": None}
    return _serialize(plan)


@router.put("/plan")
async def save_plan(
    body: GrowthPlanBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    plan = await get_owner_plan(db, str(current_user.id))
    if not plan:
        plan = GrowthPlan(id=gen_uuid(), owner_id=str(current_user.id))
        db.add(plan)
    update = body.model_dump(exclude_none=True)
    # `data` is shared by several independent panels (Strategy, Focus, Time &
    # Delegation, the Level 1-6 workbook), each owning its own top-level key
    # (e.g. "big5_items", "time_entries", "endgame_data"). A full replace would
    # let one panel's save silently wipe out another's — merge instead so each
    # panel can save its own slice safely.
    if "data" in update:
        plan.data = {**(plan.data or {}), **update.pop("data")}
    for k, v in update.items():
        setattr(plan, k, v)
    plan.updated_at = utcnow()
    await db.commit()
    return {"success": True}
