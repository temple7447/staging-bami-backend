from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime
from typing import Optional
from pydantic import BaseModel

from models.subscription import Subscription
from models.user import User
from core.security import get_current_user
from core.database import get_db
from core.db_helpers import find_all, find_one, save, count
from models.base import gen_uuid

router = APIRouter(prefix="/subscriptions", tags=["Subscriptions"])


class SubscriptionCreate(BaseModel):
    name: str
    price: float = 0.0
    billing_period: str = "month"
    description: Optional[str] = None
    icon: Optional[str] = None
    features: list[str] = []
    status: str = "Active"


class SubscriptionUpdate(BaseModel):
    name: Optional[str] = None
    price: Optional[float] = None
    billing_period: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    features: Optional[list[str]] = None
    status: Optional[str] = None


@router.post("/", status_code=201)
async def create_subscription(
    body: SubscriptionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role != "super_admin":
        raise HTTPException(status_code=403, detail="Super admins only")
    sub = Subscription(id=gen_uuid(), **body.model_dump(), created_by=user.id)
    await save(db, sub)
    return {"success": True, "data": _s(sub)}


@router.get("/")
async def list_subscriptions(
    billing_period: Optional[str] = None,
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    conditions = [Subscription.is_active == True]
    if billing_period:
        conditions.append(Subscription.billing_period == billing_period)
    if status:
        conditions.append(Subscription.status == status)
    items = await find_all(db, Subscription, *conditions, order_by=Subscription.created_at.desc())
    return {"success": True, "count": len(items), "data": [_s(s) for s in items]}


@router.get("/{sub_id}")
async def get_subscription(sub_id: str, db: AsyncSession = Depends(get_db)):
    sub = await find_one(db, Subscription, Subscription.id == sub_id, Subscription.is_active == True)
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription plan not found")
    return {"success": True, "data": _s(sub)}


@router.put("/{sub_id}")
async def update_subscription(
    sub_id: str,
    body: SubscriptionUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role != "super_admin":
        raise HTTPException(status_code=403, detail="Super admins only")
    sub = await find_one(db, Subscription, Subscription.id == sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription plan not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(sub, k, v)
    sub.updated_at = datetime.utcnow()
    await save(db, sub)
    return {"success": True, "data": _s(sub)}


@router.delete("/{sub_id}")
async def delete_subscription(
    sub_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role != "super_admin":
        raise HTTPException(status_code=403, detail="Super admins only")
    sub = await find_one(db, Subscription, Subscription.id == sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription plan not found")
    sub.is_active = False
    sub.updated_at = datetime.utcnow()
    await save(db, sub)
    return {"success": True, "message": "Subscription plan deleted"}


def _s(s: Subscription) -> dict:
    return {
        "id": s.id, "name": s.name, "price": s.price,
        "billing_period": s.billing_period, "description": s.description,
        "icon": s.icon, "status": s.status, "features": s.features or [],
        "is_active": s.is_active, "created_at": s.created_at,
    }
