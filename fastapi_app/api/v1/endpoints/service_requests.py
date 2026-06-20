from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime
from typing import Optional
from pydantic import BaseModel

from models.service_request import ServiceRequest
from models.user import User
from core.security import get_current_user
from core.database import get_db
from core.db_helpers import find_all, find_one, save
from models.base import gen_uuid

router = APIRouter(prefix="/service-requests", tags=["Service Requests"])

ADMIN_ROLES = {"super_admin", "admin", "super_manager", "business_owner", "manager"}


class ServiceRequestCreate(BaseModel):
    title: str
    description: str
    category: str = "general"
    priority: str = "medium"
    estate: Optional[str] = None
    unit: Optional[str] = None


@router.post("", status_code=201)
async def create_service_request(
    body: ServiceRequestCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sr = ServiceRequest(id=gen_uuid(), **body.model_dump(), requester=user.id)
    await save(db, sr)
    return {"success": True, "data": _sr(sr)}


@router.get("")
async def list_service_requests(
    status: Optional[str] = None,
    estate: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conditions = [ServiceRequest.is_active == True]
    if user.role not in ADMIN_ROLES:
        conditions.append(ServiceRequest.requester == user.id)
    if status:
        conditions.append(ServiceRequest.status == status)
    if estate:
        conditions.append(ServiceRequest.estate == estate)
    items = await find_all(db, ServiceRequest, *conditions, order_by=ServiceRequest.created_at.desc())
    return {"success": True, "count": len(items), "data": [_sr(s) for s in items]}


@router.patch("/{sr_id}/status")
async def update_status(
    sr_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    sr = await find_one(db, ServiceRequest, ServiceRequest.id == sr_id)
    if not sr:
        raise HTTPException(status_code=404, detail="Service request not found")
    sr.status = body.get("status", sr.status)
    sr.assigned_to = body.get("assigned_to", sr.assigned_to)
    sr.note = body.get("note", sr.note)
    sr.updated_by = user.id
    sr.updated_at = datetime.utcnow()
    await save(db, sr)
    return {"success": True, "data": _sr(sr)}


def _sr(s: ServiceRequest) -> dict:
    return {
        "id": s.id, "title": s.title, "description": s.description,
        "category": s.category, "priority": s.priority, "status": s.status,
        "requester": s.requester, "assigned_to": s.assigned_to,
        "estate": s.estate, "unit": s.unit, "note": s.note,
        "created_at": s.created_at,
    }
