from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from pydantic import BaseModel
from datetime import datetime

from models.user import User
from models.deal import Deal
from models.model10_entry import Model10Entry
from core.security import get_current_user
from core.database import get_db
from models.base import gen_uuid
from utils.time_utils import utcnow

router = APIRouter(prefix="/sales", tags=["Sales"])

PIPELINE_STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"]
# Level 1 ("Get 10 Customers") funnel order, mapped onto the same stage column:
# lead -> contacted(qualified) -> offered(proposal) -> won -> delivered
LEVEL1_STAGES = ["lead", "qualified", "proposal", "won", "delivered"]


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
    pipeline: str = "sales"
    nps: Optional[int] = None
    ltv: Optional[float] = None
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
    nps: Optional[int] = None
    ltv: Optional[float] = None
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
        "pipeline": d.pipeline,
        "nps": d.nps,
        "ltv": d.ltv,
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
    # Defaults to "sales" so the existing CRM view doesn't suddenly show Level 1
    # prospects once someone starts using the Level 1 pipeline. Pass "all" to
    # bypass the filter, or "level1" for the Scale-framework funnel.
    pipeline: str = Query("sales"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(Deal).where(Deal.owner_id == current_user.id)
    if stage:
        q = q.where(Deal.stage == stage)
    if pipeline != "all":
        q = q.where(Deal.pipeline == pipeline)
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
    result = await db.execute(
        select(Deal).where(Deal.owner_id == current_user.id, Deal.pipeline == "sales")
    )
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


# ─── Level 1 — Model 10 ────────────────────────────────────────────────────────

class Model10Body(BaseModel):
    name: str = ""
    reason: Optional[str] = None


def _model10_dict(m: Model10Entry) -> dict:
    return {"id": m.id, "name": m.name, "reason": m.reason, "created_at": m.created_at.isoformat()}


@router.get("/model10")
async def list_model10(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Model10Entry).where(Model10Entry.owner_id == current_user.id)
        .order_by(Model10Entry.created_at)
    )
    entries = result.scalars().all()
    return {"data": [_model10_dict(m) for m in entries]}


@router.post("/model10", status_code=201)
async def create_model10(
    body: Model10Body,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = Model10Entry(id=gen_uuid(), owner_id=current_user.id, **body.model_dump())
    db.add(entry)
    await db.commit()
    return {"message": "Entry created", "id": entry.id}


@router.put("/model10/{entry_id}")
async def update_model10(
    entry_id: str,
    body: Model10Body,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Model10Entry).where(Model10Entry.id == entry_id, Model10Entry.owner_id == current_user.id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Entry not found")
    for k, v in body.model_dump().items():
        setattr(entry, k, v)
    await db.commit()
    return {"message": "Entry updated"}


@router.delete("/model10/{entry_id}")
async def delete_model10(
    entry_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Model10Entry).where(Model10Entry.id == entry_id, Model10Entry.owner_id == current_user.id)
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(404, "Entry not found")
    await db.delete(entry)
    await db.commit()
    return {"message": "Entry deleted"}


@router.get("/level1-status")
async def level1_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Level 1 ('Get 10 Customers') graduation status — direct port of the
    reference app's level1GraduationStatus: 10 sales won/delivered, 10
    promoters (NPS >= 9), and a filled-out Model 10 list."""
    deals_result = await db.execute(
        select(Deal).where(Deal.owner_id == current_user.id, Deal.pipeline == "level1")
    )
    deals = deals_result.scalars().all()
    model10_result = await db.execute(
        select(Model10Entry).where(Model10Entry.owner_id == current_user.id)
    )
    model10 = model10_result.scalars().all()

    sales_won = sum(1 for d in deals if d.stage in ("won", "delivered"))
    promoters = sum(1 for d in deals if d.nps is not None and d.nps >= 9)
    model10_filled = sum(1 for m in model10 if m.name and m.name.strip())

    sales_ok = sales_won >= 10
    promoters_ok = promoters >= 10
    model10_ok = model10_filled >= 10

    return {
        "sales_won": sales_won,
        "promoters": promoters,
        "model10_filled": model10_filled,
        "sales_ok": sales_ok,
        "promoters_ok": promoters_ok,
        "model10_ok": model10_ok,
        "all_ok": sales_ok and promoters_ok and model10_ok,
    }
