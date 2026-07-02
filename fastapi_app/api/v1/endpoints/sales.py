from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from pydantic import BaseModel
from datetime import datetime

from models.user import User
from models.deal import Deal
from core.security import get_current_user
from core.database import get_db
from models.base import gen_uuid
from utils.time_utils import utcnow

router = APIRouter(prefix="/sales", tags=["Sales"])

PIPELINE_STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"]


class DealCreate(BaseModel):
    client_name: str
    client_email: Optional[str] = None
    client_phone: Optional[str] = None
    client_company: Optional[str] = None
    title: str
    description: Optional[str] = None
    value: float = 0.0
    stage: str = "lead"
    probability: float = 0.0
    source: Optional[str] = None
    linked_estate_id: Optional[str] = None
    linked_campaign_id: Optional[str] = None
    linked_enquiry_id: Optional[str] = None
    expected_close_date: Optional[datetime] = None
    next_action: Optional[str] = None
    next_action_date: Optional[datetime] = None
    notes: Optional[str] = None
    tags: list = []


class DealUpdate(BaseModel):
    client_name: Optional[str] = None
    client_email: Optional[str] = None
    client_phone: Optional[str] = None
    client_company: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    value: Optional[float] = None
    stage: Optional[str] = None
    probability: Optional[float] = None
    source: Optional[str] = None
    linked_estate_id: Optional[str] = None
    expected_close_date: Optional[datetime] = None
    last_activity: Optional[str] = None
    next_action: Optional[str] = None
    next_action_date: Optional[datetime] = None
    notes: Optional[str] = None
    tags: Optional[list] = None


def _deal_dict(d: Deal) -> dict:
    return {
        "id": d.id,
        "client_name": d.client_name,
        "client_email": d.client_email,
        "client_phone": d.client_phone,
        "client_company": d.client_company,
        "title": d.title,
        "description": d.description,
        "value": d.value,
        "stage": d.stage,
        "probability": d.probability,
        "source": d.source,
        "linked_estate_id": d.linked_estate_id,
        "linked_campaign_id": d.linked_campaign_id,
        "linked_enquiry_id": d.linked_enquiry_id,
        "expected_close_date": d.expected_close_date.isoformat() if d.expected_close_date else None,
        "closed_at": d.closed_at.isoformat() if d.closed_at else None,
        "last_activity": d.last_activity,
        "next_action": d.next_action,
        "next_action_date": d.next_action_date.isoformat() if d.next_action_date else None,
        "notes": d.notes,
        "tags": d.tags,
        "created_at": d.created_at.isoformat(),
    }


@router.get("/deals")
async def list_deals(
    stage: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(Deal).where(Deal.owner_id == current_user.id)
    if stage:
        q = q.where(Deal.stage == stage)
    q = q.order_by(Deal.created_at.desc())
    result = await db.execute(q)
    deals = result.scalars().all()
    return {"data": [_deal_dict(d) for d in deals], "total": len(deals)}


@router.post("/deals", status_code=201)
async def create_deal(
    body: DealCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    deal = Deal(id=gen_uuid(), owner_id=current_user.id, **body.model_dump())
    db.add(deal)
    await db.commit()
    return {"message": "Deal created", "id": deal.id}


@router.get("/deals/{deal_id}")
async def get_deal(
    deal_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Deal).where(Deal.id == deal_id, Deal.owner_id == current_user.id)
    )
    deal = result.scalar_one_or_none()
    if not deal:
        raise HTTPException(404, "Deal not found")
    return {"data": _deal_dict(deal)}


@router.put("/deals/{deal_id}")
async def update_deal(
    deal_id: str,
    body: DealUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Deal).where(Deal.id == deal_id, Deal.owner_id == current_user.id)
    )
    deal = result.scalar_one_or_none()
    if not deal:
        raise HTTPException(404, "Deal not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(deal, k, v)
    if body.stage in ("won", "lost") and not deal.closed_at:
        deal.closed_at = utcnow()
    deal.updated_at = utcnow()
    await db.commit()
    return {"message": "Deal updated"}


@router.delete("/deals/{deal_id}")
async def delete_deal(
    deal_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Deal).where(Deal.id == deal_id, Deal.owner_id == current_user.id)
    )
    deal = result.scalar_one_or_none()
    if not deal:
        raise HTTPException(404, "Deal not found")
    await db.delete(deal)
    await db.commit()
    return {"message": "Deal deleted"}


@router.get("/pipeline")
async def sales_pipeline(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Deal).where(Deal.owner_id == current_user.id))
    deals = result.scalars().all()

    pipeline: dict[str, dict] = {}
    for stage in PIPELINE_STAGES:
        stage_deals = [d for d in deals if d.stage == stage]
        pipeline[stage] = {
            "count": len(stage_deals),
            "value": sum(d.value for d in stage_deals),
            "deals": [_deal_dict(d) for d in stage_deals],
        }

    active_deals = [d for d in deals if d.stage not in ("won", "lost")]
    won_deals = [d for d in deals if d.stage == "won"]
    win_rate = round(len(won_deals) / len(deals) * 100, 1) if deals else 0

    return {
        "pipeline": pipeline,
        "summary": {
            "total_deals": len(deals),
            "active_deals": len(active_deals),
            "won_deals": len(won_deals),
            "total_pipeline_value": sum(d.value for d in active_deals),
            "total_won_value": sum(d.value for d in won_deals),
            "win_rate": win_rate,
        },
    }
