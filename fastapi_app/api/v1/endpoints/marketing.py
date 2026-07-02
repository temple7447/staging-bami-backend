from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional
from pydantic import BaseModel
from datetime import datetime

from models.user import User
from models.campaign import Campaign
from models.enquiry import Enquiry
from core.security import get_current_user
from core.database import get_db
from models.base import gen_uuid
from utils.time_utils import utcnow

router = APIRouter(prefix="/marketing", tags=["Marketing"])


class CampaignCreate(BaseModel):
    name: str
    description: Optional[str] = None
    channel: str = "other"
    budget: float = 0.0
    goal: Optional[str] = None
    target_audience: Optional[str] = None
    linked_estate_id: Optional[str] = None
    content_url: Optional[str] = None
    notes: Optional[str] = None
    tags: list = []
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    channel: Optional[str] = None
    status: Optional[str] = None
    budget: Optional[float] = None
    spend: Optional[float] = None
    impressions: Optional[int] = None
    clicks: Optional[int] = None
    leads: Optional[int] = None
    conversions: Optional[int] = None
    goal: Optional[str] = None
    target_audience: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[list] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None


def _campaign_dict(c: Campaign) -> dict:
    ctr = round(c.clicks / c.impressions * 100, 2) if c.impressions else 0
    cpl = round(c.spend / c.leads, 2) if c.leads else 0
    return {
        "id": c.id,
        "name": c.name,
        "description": c.description,
        "channel": c.channel,
        "status": c.status,
        "budget": c.budget,
        "spend": c.spend,
        "impressions": c.impressions,
        "clicks": c.clicks,
        "leads": c.leads,
        "conversions": c.conversions,
        "ctr": ctr,
        "cpl": cpl,
        "goal": c.goal,
        "target_audience": c.target_audience,
        "linked_estate_id": c.linked_estate_id,
        "notes": c.notes,
        "tags": c.tags,
        "start_date": c.start_date.isoformat() if c.start_date else None,
        "end_date": c.end_date.isoformat() if c.end_date else None,
        "created_at": c.created_at.isoformat(),
    }


@router.get("/campaigns")
async def list_campaigns(
    status: Optional[str] = Query(None),
    channel: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(Campaign).where(Campaign.owner_id == current_user.id)
    if status:
        q = q.where(Campaign.status == status)
    if channel:
        q = q.where(Campaign.channel == channel)
    q = q.order_by(Campaign.created_at.desc())
    result = await db.execute(q)
    campaigns = result.scalars().all()
    return {"data": [_campaign_dict(c) for c in campaigns], "total": len(campaigns)}


@router.post("/campaigns", status_code=201)
async def create_campaign(
    body: CampaignCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    c = Campaign(id=gen_uuid(), owner_id=current_user.id, **body.model_dump())
    db.add(c)
    await db.commit()
    return {"message": "Campaign created", "id": c.id}


@router.get("/campaigns/{campaign_id}")
async def get_campaign(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.owner_id == current_user.id)
    )
    c = result.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Campaign not found")
    return {"data": _campaign_dict(c)}


@router.put("/campaigns/{campaign_id}")
async def update_campaign(
    campaign_id: str,
    body: CampaignUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.owner_id == current_user.id)
    )
    c = result.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Campaign not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(c, k, v)
    c.updated_at = utcnow()
    await db.commit()
    return {"message": "Campaign updated"}


@router.delete("/campaigns/{campaign_id}")
async def delete_campaign(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.owner_id == current_user.id)
    )
    c = result.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Campaign not found")
    await db.delete(c)
    await db.commit()
    return {"message": "Campaign deleted"}


@router.get("/overview")
async def marketing_overview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Campaigns
    camp_result = await db.execute(
        select(Campaign).where(Campaign.owner_id == current_user.id)
    )
    campaigns = camp_result.scalars().all()

    active = [c for c in campaigns if c.status == "active"]
    total_spend = sum(c.spend for c in campaigns)
    total_budget = sum(c.budget for c in campaigns)
    total_leads = sum(c.leads for c in campaigns)
    total_conversions = sum(c.conversions for c in campaigns)

    # Enquiries linked to the owner (as proxy for lead pipeline)
    from models.estate import Estate
    estate_result = await db.execute(
        select(Estate.id).where(Estate.owner == current_user.id)
    )
    estate_ids = [r[0] for r in estate_result.all()]

    enq_total = 0
    enq_converted = 0
    enq_pending = 0
    if estate_ids:
        enq_result = await db.execute(select(Enquiry).where(Enquiry.estate.in_(estate_ids)))
        enqs = enq_result.scalars().all()
        enq_total = len(enqs)
        enq_converted = sum(1 for e in enqs if e.status == "converted")
        enq_pending = sum(1 for e in enqs if e.status == "pending")

    conversion_rate = round(total_conversions / total_leads * 100, 1) if total_leads else 0
    enq_conversion_rate = round(enq_converted / enq_total * 100, 1) if enq_total else 0

    return {
        "campaigns": {
            "total": len(campaigns),
            "active": len(active),
            "total_budget": total_budget,
            "total_spend": total_spend,
            "total_leads": total_leads,
            "total_conversions": total_conversions,
            "conversion_rate": conversion_rate,
        },
        "enquiries": {
            "total": enq_total,
            "converted": enq_converted,
            "pending": enq_pending,
            "conversion_rate": enq_conversion_rate,
        },
        "channels": list({c.channel for c in campaigns}),
    }
