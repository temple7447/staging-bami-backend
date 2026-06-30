"""
Personal Finance (Pillar 2) — persists the Goals / 50-30-20 / Portfolio tools.
One JSON document per owner.
"""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from models.user import User
from models.personal_finance import PersonalFinance
from models.base import gen_uuid
from core.security import get_current_user
from core.database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/personal-finance", tags=["Personal Finance"])


class PersonalFinanceBody(BaseModel):
    goals: Optional[list] = None
    budget: Optional[dict] = None
    portfolio: Optional[dict] = None


@router.get("")
async def get_personal_finance(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = (await db.execute(
        select(PersonalFinance).where(PersonalFinance.owner_id == str(current_user.id))
    )).scalars().first()
    if not row:
        return {"exists": False, "goals": [], "budget": {}, "portfolio": {}}
    return {"exists": True, "goals": row.goals or [], "budget": row.budget or {},
            "portfolio": row.portfolio or {},
            "updated_at": row.updated_at.isoformat() if row.updated_at else None}


@router.put("")
async def save_personal_finance(
    body: PersonalFinanceBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = (await db.execute(
        select(PersonalFinance).where(PersonalFinance.owner_id == str(current_user.id))
    )).scalars().first()
    if not row:
        row = PersonalFinance(id=gen_uuid(), owner_id=str(current_user.id))
        db.add(row)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(row, k, v)
    row.updated_at = datetime.utcnow()
    await db.commit()
    return {"success": True}
