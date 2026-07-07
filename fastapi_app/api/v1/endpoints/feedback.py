from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from pydantic import BaseModel, Field

from models.feedback import Feedback
from models.tenant import Tenant
from models.estate import Estate
from models.notification import Notification
from models.user import User
from core.security import get_current_user
from core.database import get_db
from core.authz import accessible_estate_ids
from core.db_helpers import find_all, find_one, save, count
from models.base import gen_uuid
from utils.time_utils import utcnow

router = APIRouter(prefix="/feedback", tags=["Feedback"])

ADMIN_ROLES = {"super_admin", "admin", "super_manager", "business_owner", "manager"}

CATEGORIES = {"suggestion", "improvement", "complaint", "feature_request", "praise", "other"}
STATUSES = {"new", "reviewed", "in_progress", "done", "dismissed"}


class FeedbackCreate(BaseModel):
    subject: str
    message: str
    category: str = "suggestion"
    rating: Optional[int] = Field(default=None, ge=1, le=5)


class FeedbackRespond(BaseModel):
    status: Optional[str] = None
    admin_response: Optional[str] = None


@router.post("", status_code=201)
async def create_feedback(
    body: FeedbackCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not body.subject.strip():
        raise HTTPException(status_code=400, detail="Subject is required")
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Message is required")
    category = body.category if body.category in CATEGORIES else "other"

    # Attach the submitter's tenancy/estate so estate staff can see it
    tenant = None
    if user.role in ("tenant", "user"):
        tenant = await find_one(db, Tenant, Tenant.user == user.id, Tenant.is_active == True)

    fb = Feedback(
        id=gen_uuid(), subject=body.subject.strip(), message=body.message.strip(),
        category=category, rating=body.rating,
        submitted_by=user.id, submitted_by_role=user.role,
        tenant=tenant.id if tenant else None,
        estate=tenant.estate if tenant else None,
    )
    await save(db, fb)

    # Notify the estate's owner so new feedback doesn't sit unseen
    if tenant and tenant.estate:
        estate = await find_one(db, Estate, Estate.id == tenant.estate)
        notify_id = (estate.owner or estate.created_by) if estate else None
        if notify_id:
            await save(db, Notification(
                id=gen_uuid(), user=notify_id, type="feedback",
                title="New tenant feedback",
                message=f"{tenant.tenant_name or 'A tenant'}: {fb.subject}",
            ))

    return {"success": True, "message": "Thank you for your feedback!", "data": _fb(fb)}


@router.get("")
async def list_feedback(
    status: Optional[str] = None,
    category: Optional[str] = None,
    estate: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conditions = [Feedback.is_active == True]

    if user.role in ADMIN_ROLES:
        allowed = await accessible_estate_ids(db, user)
        if allowed is not None:
            # Estate-scoped staff: their estates' feedback + staff-submitted without estate
            conditions.append(
                Feedback.estate.in_(allowed) if allowed else Feedback.submitted_by == user.id
            )
    else:
        conditions.append(Feedback.submitted_by == user.id)

    if status:
        conditions.append(Feedback.status == status)
    if category:
        conditions.append(Feedback.category == category)
    if estate:
        conditions.append(Feedback.estate == estate)

    skip = (page - 1) * limit
    total = await count(db, Feedback, *conditions)
    items = await find_all(db, Feedback, *conditions,
                           order_by=Feedback.created_at.desc(), skip=skip, limit=limit)
    return {"success": True, "count": total, "total": total,
            "total_pages": -(-total // limit), "page": page,
            "data": [_fb(f) for f in items]}


@router.get("/stats")
async def feedback_stats(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    conditions = [Feedback.is_active == True]
    allowed = await accessible_estate_ids(db, user)
    if allowed is not None:
        if not allowed:
            return {"success": True, "data": {s: 0 for s in STATUSES} | {"total": 0}}
        conditions.append(Feedback.estate.in_(allowed))
    stats = {}
    for s in STATUSES:
        stats[s] = await count(db, Feedback, *conditions, Feedback.status == s)
    stats["total"] = await count(db, Feedback, *conditions)
    return {"success": True, "data": stats}


@router.patch("/{feedback_id}")
async def respond_to_feedback(
    feedback_id: str,
    body: FeedbackRespond,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    fb = await find_one(db, Feedback, Feedback.id == feedback_id, Feedback.is_active == True)
    if not fb:
        raise HTTPException(status_code=404, detail="Feedback not found")

    allowed = await accessible_estate_ids(db, user)
    if allowed is not None and fb.estate and fb.estate not in allowed:
        raise HTTPException(status_code=403, detail="Not your estate's feedback")

    if body.status:
        if body.status not in STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status. Use one of: {sorted(STATUSES)}")
        fb.status = body.status
    if body.admin_response is not None:
        fb.admin_response = body.admin_response.strip() or None
        fb.responded_by = user.id
        fb.responded_at = utcnow()
    fb.updated_at = utcnow()
    await save(db, fb)

    # Let the submitter know management replied / progressed their feedback
    if fb.submitted_by and (body.admin_response or body.status):
        note = body.admin_response or f"Status updated to: {fb.status.replace('_', ' ')}"
        await save(db, Notification(
            id=gen_uuid(), user=fb.submitted_by, type="feedback",
            title=f"Response to your feedback: {fb.subject}",
            message=note,
        ))

    return {"success": True, "data": _fb(fb)}


@router.delete("/{feedback_id}")
async def delete_feedback(
    feedback_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    fb = await find_one(db, Feedback, Feedback.id == feedback_id, Feedback.is_active == True)
    if not fb:
        raise HTTPException(status_code=404, detail="Feedback not found")
    if user.role not in ADMIN_ROLES and fb.submitted_by != user.id:
        raise HTTPException(status_code=403, detail="Not allowed")
    fb.is_active = False
    fb.updated_at = utcnow()
    await save(db, fb)
    return {"success": True, "message": "Feedback deleted"}


def _fb(f: Feedback) -> dict:
    return {
        "id": f.id, "subject": f.subject, "message": f.message,
        "category": f.category, "rating": f.rating, "status": f.status,
        "submitted_by": f.submitted_by, "submitted_by_role": f.submitted_by_role,
        "tenant": f.tenant, "estate": f.estate,
        "admin_response": f.admin_response,
        "responded_by": f.responded_by, "responded_at": f.responded_at,
        "created_at": f.created_at, "updated_at": f.updated_at,
    }
