from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime
from bson import ObjectId
from pydantic import BaseModel
from typing import Optional, List

from models.user import User
from models.subscription import Subscription
from core.security import get_current_user

router = APIRouter(prefix="/subscriptions", tags=["Subscriptions"])

ADMIN_ROLES = {"super_admin", "admin"}


class SubscriptionCreate(BaseModel):
    name:           str
    price:          float
    billing_period: str = "month"
    description:    Optional[str] = None
    icon:           Optional[str] = None
    status:         str = "Active"
    features:       Optional[List[str]] = None


class SubscriptionUpdate(BaseModel):
    name:           Optional[str] = None
    price:          Optional[float] = None
    billing_period: Optional[str] = None
    description:    Optional[str] = None
    icon:           Optional[str] = None
    status:         Optional[str] = None
    features:       Optional[List[str]] = None


@router.post("/", status_code=201)
async def create_subscription(body: SubscriptionCreate, user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    # Parse features from newline-separated string if needed
    features = body.features or []
    if isinstance(features, str):
        features = [f.strip() for f in features.split("\n") if f.strip()]

    sub = Subscription(
        name=body.name, price=body.price, billing_period=body.billing_period,
        description=body.description, icon=body.icon, status=body.status,
        features=features, created_by=user.id,
    )
    await sub.insert()
    return {"success": True, "message": "Subscription created successfully", "data": sub.model_dump()}


@router.get("/")
async def get_all_subscriptions(
    status_:        Optional[str] = Query(None, alias="status"),
    billing_period: Optional[str] = None,
    page:           int = 1,
    limit:          int = 20,
):
    coll = Subscription.get_motor_collection()
    f: dict = {"is_active": True}
    if status_:         f["status"]         = status_
    if billing_period:  f["billing_period"] = billing_period

    total = await coll.count_documents(f)
    skip  = (page - 1) * limit
    items = await coll.find(f).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"success": True, "data": items,
            "pagination": {"current_page": page, "total_pages": -(-total // limit), "total_items": total}}


@router.get("/{sub_id}")
async def get_subscription(sub_id: str):
    sub = await Subscription.get(sub_id)
    if not sub or not sub.is_active:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return {"success": True, "data": sub.model_dump()}


@router.put("/{sub_id}")
async def update_subscription(sub_id: str, body: SubscriptionUpdate, user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    sub = await Subscription.get(sub_id)
    if not sub or not sub.is_active:
        raise HTTPException(status_code=404, detail="Subscription not found")

    for field, val in body.model_dump(exclude_none=True).items():
        setattr(sub, field, val)
    sub.updated_at = datetime.utcnow()
    await sub.save()
    return {"success": True, "message": "Subscription updated successfully", "data": sub.model_dump()}


@router.delete("/{sub_id}")
async def delete_subscription(sub_id: str, user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    sub = await Subscription.get(sub_id)
    if not sub or not sub.is_active:
        raise HTTPException(status_code=404, detail="Subscription not found")

    sub.is_active  = False
    sub.updated_at = datetime.utcnow()
    await sub.save()
    return {"success": True, "message": "Subscription deleted successfully"}
