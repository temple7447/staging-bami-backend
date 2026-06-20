from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional
from datetime import datetime
import cloudinary, cloudinary.uploader

from models.unit import Unit
from models.estate import Estate
from models.tenant import Tenant
from models.user import User
from schemas.unit import UnitCreate, UnitUpdate
from core.security import get_current_user
from core.database import get_db
from core.db_helpers import find_all, find_one, save, count
from core.config import settings
from models.base import gen_uuid

router = APIRouter(prefix="/units", tags=["Units"])
ADMIN_ROLES = {"super_admin", "admin", "super_manager", "business_owner", "manager"}


def _u(u: Unit) -> dict:
    return {
        "id": u.id, "estate": u.estate, "label": u.label,
        "monthly_price": u.monthly_price, "service_charge_monthly": u.service_charge_monthly,
        "caution_fee": u.caution_fee, "legal_fee": u.legal_fee,
        "meter_number": u.meter_number, "description": u.description,
        "category": u.category, "listing_type": u.listing_type,
        "bedrooms": u.bedrooms, "bathrooms": u.bathrooms, "area": u.area,
        "amenities": u.amenities or {}, "images": u.images or [],
        "status": u.status, "occupied_by": u.occupied_by,
        "features": u.features or [], "is_active": u.is_active,
        "created_at": u.created_at, "updated_at": u.updated_at,
    }


@router.get("")
async def list_units(
    estate_id: Optional[str] = Query(None, alias="estateId"),
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conditions = [Unit.is_active == True]
    if estate_id:
        conditions.append(Unit.estate == estate_id)
    if status:
        conditions.append(Unit.status == status)
    skip = (page - 1) * limit
    total = await count(db, Unit, *conditions)
    items = await find_all(db, Unit, *conditions, order_by=Unit.created_at.desc(), skip=skip, limit=limit)
    return {
        "success": True, "count": total,
        "data": [_u(u) for u in items],
        "pagination": {"current_page": page, "total_pages": -(-total // limit), "total_items": total},
    }


@router.post("", status_code=201)
async def create_unit(
    body: UnitCreate,
    estate_id: Optional[str] = Query(None, alias="estateId"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    eid = estate_id or body.estate
    if not eid:
        raise HTTPException(status_code=400, detail="estateId is required")
    estate = await find_one(db, Estate, Estate.id == eid, Estate.is_active == True)
    if not estate:
        raise HTTPException(status_code=404, detail="Estate not found")
    data = body.model_dump()
    data["estate"] = eid
    unit = Unit(id=gen_uuid(), **data, created_by=user.id)
    await save(db, unit)
    estate.total_units = (estate.total_units or 0) + 1
    await save(db, estate)
    return {"success": True, "data": _u(unit)}


@router.get("/{unit_id}")
async def get_unit(unit_id: str, db: AsyncSession = Depends(get_db)):
    unit = await find_one(db, Unit, Unit.id == unit_id, Unit.is_active == True)
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    return {"success": True, "data": _u(unit)}


@router.put("/{unit_id}")
async def update_unit(
    unit_id: str,
    body: UnitUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    unit = await find_one(db, Unit, Unit.id == unit_id, Unit.is_active == True)
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(unit, k, v)
    unit.updated_by = user.id
    unit.updated_at = datetime.utcnow()
    await save(db, unit)
    return {"success": True, "data": _u(unit)}


@router.delete("/{unit_id}")
async def delete_unit(
    unit_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    unit = await find_one(db, Unit, Unit.id == unit_id, Unit.is_active == True)
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    has_tenant = await find_one(db, Tenant, Tenant.unit == unit_id, Tenant.is_active == True)
    if has_tenant:
        raise HTTPException(status_code=400, detail="Cannot delete unit with active tenant")
    unit.is_active = False
    unit.updated_by = user.id
    unit.updated_at = datetime.utcnow()
    await save(db, unit)
    return {"success": True, "message": "Unit deleted"}


@router.post("/{unit_id}/upload")
async def upload_unit_image(
    unit_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    unit = await find_one(db, Unit, Unit.id == unit_id, Unit.is_active == True)
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")

    cloudinary.config(
        cloud_name=settings.CLOUDINARY_CLOUD_NAME,
        api_key=settings.CLOUDINARY_API_KEY,
        api_secret=settings.CLOUDINARY_API_SECRET,
    )
    buffer = await file.read()
    result = cloudinary.uploader.upload(buffer, folder=f"bamihustle/units/{unit_id}")
    img = {"url": result["secure_url"], "public_id": result["public_id"]}
    images = list(unit.images or [])
    images.append(img)
    unit.images = images
    unit.updated_at = datetime.utcnow()
    await save(db, unit)
    return {"success": True, "data": img}
