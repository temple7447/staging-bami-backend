from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime
from typing import Optional, Union
from pydantic import BaseModel, Field, model_validator

from models.subscription import Subscription
from models.user import User
from core.security import get_current_user
from core.database import get_db
from core.db_helpers import find_all, find_one, save, count
from models.base import gen_uuid
from utils.time_utils import utcnow

router = APIRouter(prefix="/subscriptions", tags=["Subscriptions"])


def _parse_date(v) -> "datetime | None":
    if not v:
        return None
    if isinstance(v, datetime):
        return v
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(v.rstrip("Z").split(".")[0], fmt.rstrip("Z").split(".")[0])
        except ValueError:
            continue
    return None


def _parse_features(v) -> list[str]:
    if v is None:
        return []
    if isinstance(v, list):
        return [s.strip() for s in v if s.strip()]
    if isinstance(v, str):
        return [s.strip() for s in v.splitlines() if s.strip()]
    return []


class SubscriptionCreate(BaseModel):
    model_config = {"populate_by_name": True}

    name: Optional[str] = None
    plan: Optional[str] = None
    price: float = 0.0
    amount: Optional[float] = None
    billing_period: Optional[str] = Field(default=None, alias="billingPeriod")
    duration_months: Optional[int] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    features: Union[list[str], str, None] = []
    status: str = "Active"
    start_date: Optional[str] = Field(default=None, alias="startDate")
    expires_at: Optional[str] = Field(default=None, alias="expiresAt")

    @model_validator(mode="after")
    def normalise(self):
        if not self.billing_period:
            self.billing_period = "month"
        self.features = _parse_features(self.features)
        return self


class SubscriptionUpdate(BaseModel):
    model_config = {"populate_by_name": True}

    name: Optional[str] = None
    price: Optional[float] = None
    billing_period: Optional[str] = Field(default=None, alias="billingPeriod")
    description: Optional[str] = None
    icon: Optional[str] = None
    features: Union[list[str], str, None] = None
    status: Optional[str] = None
    start_date: Optional[str] = Field(default=None, alias="startDate")
    expires_at: Optional[str] = Field(default=None, alias="expiresAt")

    @model_validator(mode="after")
    def normalise(self):
        if self.features is not None:
            self.features = _parse_features(self.features)
        return self


@router.post("", status_code=201)
async def create_subscription(
    body: SubscriptionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in {"super_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Admins only")
    name = body.name or body.plan or "Plan"
    price = body.price or body.amount or 0.0
    sub = Subscription(
        id=gen_uuid(), name=name, price=price,
        billing_period=body.billing_period or "month",
        description=body.description, icon=body.icon,
        features=body.features, status=body.status,
        start_date=_parse_date(body.start_date),
        expires_at=_parse_date(body.expires_at),
        created_by=user.id,
    )
    await save(db, sub)
    return {"success": True, "data": _s(sub)}


@router.get("")
async def list_subscriptions(
    billing_period: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    conditions = [Subscription.is_active == True]
    if billing_period:
        conditions.append(Subscription.billing_period == billing_period)
    if status:
        conditions.append(Subscription.status == status)
    skip = (page - 1) * limit
    total = await count(db, Subscription, *conditions)
    items = await find_all(db, Subscription, *conditions,
                           order_by=Subscription.created_at.desc(), skip=skip, limit=limit)
    return {"success": True, "count": total, "total": total,
            "total_pages": -(-total // limit), "page": page,
            "data": [_s(s) for s in items]}


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
    updates = body.model_dump(exclude_none=True, by_alias=False)
    for k in ("start_date", "expires_at"):
        if k in updates:
            updates[k] = _parse_date(updates[k])
    for k, v in updates.items():
        setattr(sub, k, v)
    sub.updated_at = utcnow()
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
    sub.updated_at = utcnow()
    await save(db, sub)
    return {"success": True, "message": "Subscription plan deleted"}


def _s(s: Subscription) -> dict:
    return {
        "id": s.id, "name": s.name, "price": s.price,
        "billing_period": s.billing_period, "description": s.description,
        "icon": s.icon, "status": s.status, "features": s.features or [],
        "is_active": s.is_active,
        "start_date": s.start_date,
        "expires_at": s.expires_at,
        "created_at": s.created_at,
        "updated_at": s.updated_at,
    }
