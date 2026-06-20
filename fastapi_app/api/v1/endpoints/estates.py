from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from typing import Optional, List
from datetime import datetime
import cloudinary, cloudinary.uploader

from models.estate import Estate
from models.tenant import Tenant
from models.unit import Unit
from models.transaction import Transaction
from models.user import User
from schemas.estate import EstateCreate, EstateUpdate
from core.security import get_current_user
from core.database import get_db
from core.db_helpers import find_all, find_one, save, count, sum_col
from core.config import settings
from models.base import gen_uuid
from utils.date_range import resolve_date_range
from utils.rent_calculator import get_current_rent

router = APIRouter(prefix="/estates", tags=["Estates"])
ADMIN_ROLES = {"super_admin", "admin", "super_manager", "business_owner", "manager"}


def _check_estate_access(estate: Estate, user: User):
    if user.role == "business_owner":
        if estate.owner != user.id and estate.created_by != user.id:
            raise HTTPException(status_code=403, detail="You do not have access to this estate")
    elif user.role == "admin":
        if user.id not in (estate.managers or []):
            raise HTTPException(status_code=403, detail="You do not have access to this estate")


async def _accessible_estate_ids(db: AsyncSession, user: User) -> list[str]:
    if user.role == "super_admin":
        result = await db.execute(select(Estate.id).where(Estate.is_active == True))
        return [r[0] for r in result.all()]
    elif user.role == "business_owner":
        result = await db.execute(
            select(Estate.id).where(Estate.is_active == True,
                                    or_(Estate.owner == user.id, Estate.created_by == user.id))
        )
        return [r[0] for r in result.all()]
    elif user.role in {"admin", "manager", "super_manager"}:
        assigned = user.assigned_estates or []
        result = await db.execute(
            select(Estate.id).where(Estate.is_active == True, Estate.id.in_(assigned))
        )
        return [r[0] for r in result.all()]
    return []


def _e(e: Estate) -> dict:
    return {
        "id": e.id, "name": e.name, "slug": e.slug, "description": e.description,
        "address": e.address, "total_units": e.total_units,
        "owner": e.owner, "managers": e.managers or [], "images": e.images or [],
        "is_active": e.is_active, "created_at": e.created_at, "updated_at": e.updated_at,
    }


@router.get("/overview/all")
async def get_overall_overview(
    period: Optional[str] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    start_date: Optional[str] = Query(None, alias="startDate"),
    end_date: Optional[str] = Query(None, alias="endDate"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    accessible_ids = await _accessible_estate_ids(db, user)
    if not accessible_ids:
        return {"success": True, "data": {
            "estates": {"totalEstates": 0}, "units": {}, "tenants": {}, "revenue": {"amount": 0}
        }}

    filter_start, filter_end = resolve_date_range(period, year, month, start_date, end_date)

    total_units = await count(db, Unit, Unit.estate.in_(accessible_ids), Unit.is_active == True)
    occupied   = await count(db, Unit, Unit.estate.in_(accessible_ids), Unit.is_active == True, Unit.status == "occupied")
    total_t    = await count(db, Tenant, Tenant.estate.in_(accessible_ids), Tenant.is_active == True)

    tx_conds = [Transaction.estate.in_(accessible_ids), Transaction.status == "paid", Transaction.is_active == True]
    if filter_start:
        tx_conds.append(Transaction.created_at >= filter_start)
    if filter_end:
        tx_conds.append(Transaction.created_at <= filter_end)
    revenue = await sum_col(db, Transaction, Transaction.amount, *tx_conds)

    return {"success": True, "data": {
        "estates": {"totalEstates": len(accessible_ids)},
        "units": {"total": total_units, "occupied": occupied, "vacant": total_units - occupied},
        "tenants": {"total": total_t},
        "revenue": {"amount": revenue},
    }}


@router.get("/")
async def list_estates(
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    accessible_ids = await _accessible_estate_ids(db, user)
    if not accessible_ids:
        return {"success": True, "count": 0, "data": []}
    skip = (page - 1) * limit
    items = await find_all(db, Estate, Estate.id.in_(accessible_ids), Estate.is_active == True,
                           order_by=Estate.created_at.desc(), skip=skip, limit=limit)
    return {"success": True, "count": len(items), "data": [_e(e) for e in items]}


@router.post("/", status_code=201)
async def create_estate(
    body: EstateCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in {"super_admin", "business_owner"}:
        raise HTTPException(status_code=403, detail="Not authorized to create estates")
    estate = Estate(id=gen_uuid(), **body.model_dump(), owner=user.id, created_by=user.id)
    estate.set_slug()
    await save(db, estate)
    return {"success": True, "data": _e(estate)}


@router.get("/{estate_id}")
async def get_estate(
    estate_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    estate = await find_one(db, Estate, Estate.id == estate_id, Estate.is_active == True)
    if not estate:
        raise HTTPException(status_code=404, detail="Estate not found")
    _check_estate_access(estate, user)
    return {"success": True, "data": _e(estate)}


@router.put("/{estate_id}")
async def update_estate(
    estate_id: str,
    body: EstateUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    estate = await find_one(db, Estate, Estate.id == estate_id, Estate.is_active == True)
    if not estate:
        raise HTTPException(status_code=404, detail="Estate not found")
    _check_estate_access(estate, user)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(estate, k, v)
    if body.name:
        estate.set_slug()
    estate.updated_by = user.id
    estate.updated_at = datetime.utcnow()
    await save(db, estate)
    return {"success": True, "data": _e(estate)}


@router.delete("/{estate_id}")
async def delete_estate(
    estate_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in {"super_admin", "business_owner"}:
        raise HTTPException(status_code=403, detail="Not authorized")
    estate = await find_one(db, Estate, Estate.id == estate_id, Estate.is_active == True)
    if not estate:
        raise HTTPException(status_code=404, detail="Estate not found")
    estate.is_active = False
    estate.updated_by = user.id
    estate.updated_at = datetime.utcnow()
    await save(db, estate)
    return {"success": True, "message": "Estate deleted"}


@router.get("/{estate_id}/overview")
async def get_estate_overview(
    estate_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    estate = await find_one(db, Estate, Estate.id == estate_id, Estate.is_active == True)
    if not estate:
        raise HTTPException(status_code=404, detail="Estate not found")

    total_units  = await count(db, Unit, Unit.estate == estate_id, Unit.is_active == True)
    occupied     = await count(db, Unit, Unit.estate == estate_id, Unit.is_active == True, Unit.status == "occupied")
    total_t      = await count(db, Tenant, Tenant.estate == estate_id, Tenant.is_active == True)
    revenue      = await sum_col(db, Transaction, Transaction.amount,
                                 Transaction.estate == estate_id, Transaction.status == "paid")
    now = datetime.utcnow()
    overdue_t    = await count(db, Tenant, Tenant.estate == estate_id, Tenant.is_active == True,
                               Tenant.next_due_date < now)

    return {"success": True, "data": {
        "estate": _e(estate),
        "units":   {"total": total_units, "occupied": occupied, "vacant": total_units - occupied},
        "tenants": {"total": total_t, "overdue": overdue_t},
        "revenue": {"total": revenue},
    }}


@router.post("/{estate_id}/upload")
async def upload_estate_image(
    estate_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    estate = await find_one(db, Estate, Estate.id == estate_id, Estate.is_active == True)
    if not estate:
        raise HTTPException(status_code=404, detail="Estate not found")

    cloudinary.config(
        cloud_name=settings.CLOUDINARY_CLOUD_NAME,
        api_key=settings.CLOUDINARY_API_KEY,
        api_secret=settings.CLOUDINARY_API_SECRET,
    )
    buffer = await file.read()
    result = cloudinary.uploader.upload(buffer, folder=f"bamihustle/estates/{estate_id}")
    img = {"url": result["secure_url"], "public_id": result["public_id"]}
    images = list(estate.images or [])
    images.append(img)
    estate.images = images
    estate.updated_at = datetime.utcnow()
    await save(db, estate)
    return {"success": True, "data": img}
