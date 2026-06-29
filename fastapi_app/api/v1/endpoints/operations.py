from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from pydantic import BaseModel
from datetime import datetime

from models.user import User
from models.vendor import Vendor
from models.service_request import ServiceRequest
from models.issue import Issue
from core.security import get_current_user
from core.database import get_db
from models.base import gen_uuid

router = APIRouter(prefix="/operations", tags=["Operations"])


class VendorCreate(BaseModel):
    name: str
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    category: str = "other"
    services: list = []
    estate_ids: list = []
    notes: Optional[str] = None
    tags: list = []


class VendorUpdate(BaseModel):
    name: Optional[str] = None
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    category: Optional[str] = None
    status: Optional[str] = None
    rating: Optional[float] = None
    jobs_completed: Optional[int] = None
    total_paid: Optional[float] = None
    services: Optional[list] = None
    estate_ids: Optional[list] = None
    notes: Optional[str] = None
    tags: Optional[list] = None


def _vendor_dict(v: Vendor) -> dict:
    return {
        "id": v.id,
        "name": v.name,
        "contact_name": v.contact_name,
        "email": v.email,
        "phone": v.phone,
        "address": v.address,
        "category": v.category,
        "status": v.status,
        "rating": v.rating,
        "jobs_completed": v.jobs_completed,
        "total_paid": v.total_paid,
        "services": v.services,
        "estate_ids": v.estate_ids,
        "notes": v.notes,
        "tags": v.tags,
        "created_at": v.created_at.isoformat(),
    }


@router.get("/vendors")
async def list_vendors(
    category: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(Vendor).where(Vendor.owner_id == current_user.id)
    if category:
        q = q.where(Vendor.category == category)
    if status:
        q = q.where(Vendor.status == status)
    q = q.order_by(Vendor.name)
    result = await db.execute(q)
    vendors = result.scalars().all()
    return {"data": [_vendor_dict(v) for v in vendors], "total": len(vendors)}


@router.post("/vendors", status_code=201)
async def create_vendor(
    body: VendorCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    vendor = Vendor(id=gen_uuid(), owner_id=current_user.id, **body.model_dump())
    db.add(vendor)
    await db.commit()
    return {"message": "Vendor created", "id": vendor.id}


@router.get("/vendors/{vendor_id}")
async def get_vendor(
    vendor_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Vendor).where(Vendor.id == vendor_id, Vendor.owner_id == current_user.id)
    )
    v = result.scalar_one_or_none()
    if not v:
        raise HTTPException(404, "Vendor not found")
    return {"data": _vendor_dict(v)}


@router.put("/vendors/{vendor_id}")
async def update_vendor(
    vendor_id: str,
    body: VendorUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Vendor).where(Vendor.id == vendor_id, Vendor.owner_id == current_user.id)
    )
    vendor = result.scalar_one_or_none()
    if not vendor:
        raise HTTPException(404, "Vendor not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(vendor, k, v)
    vendor.updated_at = datetime.utcnow()
    await db.commit()
    return {"message": "Vendor updated"}


@router.delete("/vendors/{vendor_id}")
async def delete_vendor(
    vendor_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Vendor).where(Vendor.id == vendor_id, Vendor.owner_id == current_user.id)
    )
    vendor = result.scalar_one_or_none()
    if not vendor:
        raise HTTPException(404, "Vendor not found")
    await db.delete(vendor)
    await db.commit()
    return {"message": "Vendor deleted"}


@router.get("/overview")
async def operations_overview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Vendors
    vend_result = await db.execute(select(Vendor).where(Vendor.owner_id == current_user.id))
    vendors = vend_result.scalars().all()

    active_vendors = [v for v in vendors if v.status == "active"]
    category_counts: dict[str, int] = {}
    for v in active_vendors:
        category_counts[v.category] = category_counts.get(v.category, 0) + 1

    # Service requests — open ones involving this owner's estates
    from models.estate import Estate
    estate_result = await db.execute(select(Estate.id).where(Estate.owner_id == current_user.id))
    estate_ids = [r[0] for r in estate_result.all()]

    open_requests = 0
    in_progress_requests = 0
    if estate_ids:
        sr_result = await db.execute(
            select(ServiceRequest).where(ServiceRequest.estate_id.in_(estate_ids))
        )
        srs = sr_result.scalars().all()
        open_requests = sum(1 for s in srs if s.status == "pending")
        in_progress_requests = sum(1 for s in srs if s.status == "in_progress")

    # Open maintenance issues
    open_issues = 0
    if estate_ids:
        issue_result = await db.execute(
            select(Issue).where(
                Issue.estate_id.in_(estate_ids),
                Issue.status.notin_(["resolved", "closed"]),
            )
        )
        open_issues = len(issue_result.scalars().all())

    return {
        "vendors": {
            "total": len(vendors),
            "active": len(active_vendors),
            "total_paid": sum(v.total_paid for v in vendors),
            "by_category": category_counts,
        },
        "service_requests": {
            "open": open_requests,
            "in_progress": in_progress_requests,
        },
        "maintenance_issues": open_issues,
    }
