from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime
from typing import Optional
from pydantic import BaseModel

from models.enquiry import Enquiry
from models.user import User
from core.security import get_current_user
from core.database import get_db
from core.db_helpers import find_all, find_one, save
from models.base import gen_uuid
from utils.event_hooks import fire_event
import asyncio
from utils.time_utils import utcnow

router = APIRouter(prefix="/enquiries", tags=["Enquiries"])


ADMIN_ROLES = {"super_admin", "admin", "super_manager", "business_owner", "manager"}


class EnquiryCreate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    subject: Optional[str] = None
    message: str
    enquiry_type: str = "general"
    estate: Optional[str] = None
    unit: Optional[str] = None


@router.post("", status_code=201)
async def submit_enquiry(
    body: EnquiryCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    name  = body.name  or user.name  or "Anonymous"
    email = body.email or user.email or ""
    eq = Enquiry(id=gen_uuid(), owner_id=str(user.id), name=name, email=email,
                 phone=body.phone, subject=body.subject, message=body.message,
                 enquiry_type=body.enquiry_type, estate=body.estate, unit=body.unit)
    await save(db, eq)

    # Fire AI event — generate follow-up action and lead score
    asyncio.ensure_future(fire_event("new_enquiry", str(user.id), {
        "name": name, "email": email, "phone": body.phone or "",
        "subject": body.subject or "", "unit_interest": body.subject or "",
        "enquiry_id": eq.id,
    }, db))

    return {"success": True, "message": "Enquiry submitted successfully", "data": _e(eq)}


@router.get("")
async def list_enquiries(
    status: Optional[str] = None,
    estate: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from core.db_helpers import count
    conditions = [Enquiry.is_active == True]
    if user.role in ADMIN_ROLES:
        # admins see everything
        if status:
            conditions.append(Enquiry.status == status)
        if estate:
            conditions.append(Enquiry.estate == estate)
    else:
        # tenants see only their own enquiries
        conditions.append(Enquiry.email == user.email)
    skip = (page - 1) * limit
    total = await count(db, Enquiry, *conditions)
    items = await find_all(db, Enquiry, *conditions,
                           order_by=Enquiry.created_at.desc(), skip=skip, limit=limit)
    return {"success": True, "count": total, "total": total,
            "total_pages": -(-total // limit), "page": page,
            "data": [_e(e) for e in items]}


@router.patch("/{eq_id}/status")
async def update_status(
    eq_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in {"super_admin", "admin", "super_manager", "business_owner", "manager"}:
        raise HTTPException(status_code=403, detail="Admins only")
    eq = await find_one(db, Enquiry, Enquiry.id == eq_id)
    if not eq:
        raise HTTPException(status_code=404, detail="Enquiry not found")
    eq.status = body.get("status", eq.status)
    eq.note = body.get("note", eq.note)
    eq.updated_by = user.id
    eq.updated_at = utcnow()
    await save(db, eq)
    return {"success": True, "data": _e(eq)}


def _e(e: Enquiry) -> dict:
    return {
        "id": e.id, "name": e.name, "email": e.email, "phone": e.phone,
        "subject": e.subject, "message": e.message, "enquiry_type": e.enquiry_type,
        "status": e.status, "estate": e.estate, "unit": e.unit,
        "note": e.note, "lead_score": e.lead_score,
        "lead_score_reason": e.lead_score_reason, "created_at": e.created_at,
    }
