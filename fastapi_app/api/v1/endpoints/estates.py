from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from typing import Optional, List
from datetime import datetime, timedelta, timezone
import cloudinary, cloudinary.uploader

from models.estate import Estate
from models.tenant import Tenant
from models.unit import Unit
from models.transaction import Transaction
from models.payment import Payment
from models.user import User
from schemas.estate import EstateCreate, EstateUpdate
from schemas.tenant import TenantCreate, TenantUpdate
from schemas.unit import UnitCreate, UnitUpdate
from core.security import get_current_user
from core.database import get_db
from core.authz import require_estate_access
from core.db_helpers import find_all, find_one, save, count, sum_col
from core.config import settings
from models.base import gen_uuid
from utils.date_range import resolve_date_range
from utils.time_utils import utcnow

router = APIRouter(prefix="/estates", tags=["Estates"])
ADMIN_ROLES = {"super_admin", "admin", "super_manager", "business_owner", "manager"}


def _check_estate_access(estate: Estate, user: User):
    if user.role == "business_owner":
        # Owner is the single source of truth (see core.authz.accessible_estate_ids).
        if estate.owner != user.id:
            raise HTTPException(status_code=403, detail="You do not have access to this estate")
    elif user.role == "admin":
        if user.id not in (estate.managers or []):
            raise HTTPException(status_code=403, detail="You do not have access to this estate")


async def _accessible_estate_ids(db: AsyncSession, user: User) -> list[str]:
    if user.role == "super_admin":
        result = await db.execute(select(Estate.id).where(Estate.is_active == True))
        return [r[0] for r in result.all()]
    elif user.role == "business_owner":
        # Owner-only (see core.authz.accessible_estate_ids) — created_by is not honoured.
        result = await db.execute(
            select(Estate.id).where(Estate.is_active == True, Estate.owner == user.id)
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
        "rent_increase_percent": getattr(e, "rent_increase_percent", 26.0),
        "rent_increase_cycle_years": getattr(e, "rent_increase_cycle_years", 2),
        "rent_increase_start": getattr(e, "rent_increase_start", None),
    }


# ── Overview (all estates) ────────────────────────────────────────────────────

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
            "estates":  {"total_estates": 0, "active_estates": 0},
            "units":    {"total_units": 0, "occupied_units": 0, "vacant_units": 0,
                         "maintenance_units": 0, "reserved_units": 0, "occupancy_rate": 0},
            "tenants":  {"total_active_tenants": 0, "due_soon_7_days": 0, "due_soon_30_days": 0},
            "revenue":  {"last_30_days": {"amount": 0, "transaction_count": 0},
                         "last_90_days": {"amount": 0, "transaction_count": 0}},
            "payments": {"pending_count": 0, "completed_last_30_days": 0},
        }}

    now = utcnow()
    thirty_ago = now - timedelta(days=30)
    ninety_ago = now - timedelta(days=90)
    in_7  = now + timedelta(days=7)
    in_30 = now + timedelta(days=30)

    total_units  = await count(db, Unit, Unit.estate.in_(accessible_ids), Unit.is_active == True)
    occupied     = await count(db, Unit, Unit.estate.in_(accessible_ids), Unit.is_active == True, Unit.status == "occupied")
    maintenance  = await count(db, Unit, Unit.estate.in_(accessible_ids), Unit.is_active == True, Unit.status == "maintenance")
    reserved     = await count(db, Unit, Unit.estate.in_(accessible_ids), Unit.is_active == True, Unit.status == "reserved")
    occupancy_rate = round(occupied / total_units * 100, 1) if total_units else 0

    total_t = await count(db, Tenant, Tenant.estate.in_(accessible_ids), Tenant.is_active == True)
    due_7   = await count(db, Tenant, Tenant.estate.in_(accessible_ids), Tenant.is_active == True,
                          Tenant.next_due_date >= now, Tenant.next_due_date <= in_7)
    due_30  = await count(db, Tenant, Tenant.estate.in_(accessible_ids), Tenant.is_active == True,
                          Tenant.next_due_date >= now, Tenant.next_due_date <= in_30)

    rev_30   = await sum_col(db, Transaction, Transaction.amount,
                             Transaction.estate.in_(accessible_ids), Transaction.status == "paid",
                             Transaction.is_active == True, Transaction.created_at >= thirty_ago)
    rev_90   = await sum_col(db, Transaction, Transaction.amount,
                             Transaction.estate.in_(accessible_ids), Transaction.status == "paid",
                             Transaction.is_active == True, Transaction.created_at >= ninety_ago)
    tx_30    = await count(db, Transaction, Transaction.estate.in_(accessible_ids),
                           Transaction.status == "paid", Transaction.is_active == True,
                           Transaction.created_at >= thirty_ago)
    tx_90    = await count(db, Transaction, Transaction.estate.in_(accessible_ids),
                           Transaction.status == "paid", Transaction.is_active == True,
                           Transaction.created_at >= ninety_ago)

    pending_count  = await count(db, Payment, Payment.estate.in_(accessible_ids),
                                 Payment.payment_status == "pending")
    completed_30   = await count(db, Payment, Payment.estate.in_(accessible_ids),
                                 Payment.payment_status == "completed",
                                 Payment.created_at >= thirty_ago)

    return {"success": True, "data": {
        "estates": {
            "total_estates": len(accessible_ids),
            "active_estates": len(accessible_ids),
        },
        "units": {
            "total_units":       total_units,
            "occupied_units":    occupied,
            "vacant_units":      total_units - occupied - maintenance - reserved,
            "maintenance_units": maintenance,
            "reserved_units":    reserved,
            "occupancy_rate":    occupancy_rate,
        },
        "tenants": {
            "total_active_tenants": total_t,
            "due_soon_7_days":      due_7,
            "due_soon_30_days":     due_30,
        },
        "revenue": {
            "last_30_days": {"amount": rev_30 or 0, "transaction_count": tx_30},
            "last_90_days": {"amount": rev_90 or 0, "transaction_count": tx_90},
        },
        "payments": {
            "pending_count":          pending_count,
            "completed_last_30_days": completed_30,
        },
    }}


# ── Estate CRUD ───────────────────────────────────────────────────────────────

@router.get("")
async def list_estates(
    page: int = 1,
    limit: int = 20,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    accessible_ids = await _accessible_estate_ids(db, user)
    if not accessible_ids:
        return {"success": True, "count": 0, "data": [], "total": 0}
    conditions = [Estate.id.in_(accessible_ids), Estate.is_active == True]
    if search:
        conditions.append(or_(
            Estate.name.ilike(f"%{search}%"),
            Estate.description.ilike(f"%{search}%"),
        ))
    skip = (page - 1) * limit
    total = await count(db, Estate, *conditions)
    items = await find_all(db, Estate, *conditions, order_by=Estate.created_at.desc(), skip=skip, limit=limit)
    return {"success": True, "count": len(items), "total": total, "data": [_e(e) for e in items]}


@router.post("", status_code=201)
async def create_estate(
    body: EstateCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in {"super_admin", "business_owner"}:
        raise HTTPException(status_code=403, detail="Not authorized to create estates")
    # exclude_none so omitted policy fields fall back to the model defaults
    # (no increase) instead of sending NULL into NOT NULL columns.
    estate = Estate(id=gen_uuid(), **body.model_dump(exclude_none=True), owner=user.id, created_by=user.id)
    estate.set_slug()
    await save(db, estate)
    return {"success": True, "data": _e(estate)}


# ── Unit sub-routes (must be before /{estate_id} to avoid slug conflicts) ────

@router.get("/unit/{unit_id}")
async def get_estate_unit(unit_id: str, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    from api.v1.endpoints.units import get_unit as _get_unit
    return await _get_unit(unit_id=unit_id, db=db, user=user)


@router.put("/unit/{unit_id}")
async def update_estate_unit(
    unit_id: str,
    body: UnitUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from api.v1.endpoints.units import update_unit as _update_unit
    return await _update_unit(unit_id=unit_id, body=body, db=db, user=user)


@router.delete("/unit/{unit_id}")
async def delete_estate_unit(
    unit_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from api.v1.endpoints.units import delete_unit as _delete_unit
    return await _delete_unit(unit_id=unit_id, db=db, user=user)


@router.post("/unit/{unit_id}/media/images")
async def upload_unit_images(
    unit_id: str,
    images: List[UploadFile] = File(...),
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
    uploaded = []
    for file in images:
        buffer = await file.read()
        result = cloudinary.uploader.upload(buffer, folder=f"bamihost/units/{unit_id}")
        uploaded.append({"url": result["secure_url"], "public_id": result["public_id"]})
    imgs = list(unit.images or [])
    imgs.extend(uploaded)
    unit.images = imgs
    unit.updated_at = utcnow()
    await save(db, unit)
    return {"success": True, "data": {"images": unit.images, "videos": unit.videos or []}}


@router.patch("/unit/{unit_id}/media")
async def patch_unit_media(
    unit_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    unit = await find_one(db, Unit, Unit.id == unit_id, Unit.is_active == True)
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    replace = body.get("replace", False)
    new_images = body.get("images") or []
    new_videos = body.get("videos") or []
    if replace:
        unit.images = new_images
        unit.videos = new_videos
    else:
        imgs = list(unit.images or [])
        imgs.extend(new_images)
        unit.images = imgs
        vids = list(unit.videos or [])
        vids.extend(new_videos)
        unit.videos = vids
    unit.updated_at = utcnow()
    await save(db, unit)
    return {"success": True, "data": {"images": unit.images, "videos": unit.videos}}


@router.delete("/unit/{unit_id}/media")
async def delete_unit_media(
    unit_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    unit = await find_one(db, Unit, Unit.id == unit_id, Unit.is_active == True)
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")
    remove_image_ids = set(body.get("imageIds") or body.get("image_ids") or [])
    remove_video_ids = set(body.get("videoIds") or body.get("video_ids") or [])
    unit.images = [i for i in (unit.images or []) if i.get("public_id") not in remove_image_ids]
    unit.videos = [v for v in (unit.videos or []) if v.get("public_id") not in remove_video_ids]
    unit.updated_at = utcnow()
    await save(db, unit)
    return {"success": True, "data": {"images": unit.images, "videos": unit.videos}}


# ── Estate by ID ──────────────────────────────────────────────────────────────

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
        # DB timestamps are tz-naive; coerce any tz-aware value (e.g. an ISO "...Z")
        if isinstance(v, datetime) and v.tzinfo is not None:
            v = v.astimezone(timezone.utc).replace(tzinfo=None)
        setattr(estate, k, v)
    if body.name:
        estate.set_slug()
    estate.updated_by = user.id
    estate.updated_at = utcnow()
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
    estate.updated_at = utcnow()
    await save(db, estate)
    return {"success": True, "message": "Estate deleted"}


# ── Estate overview ───────────────────────────────────────────────────────────

@router.get("/{estate_id}/overview")
async def get_estate_overview(
    estate_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    estate = await find_one(db, Estate, Estate.id == estate_id, Estate.is_active == True)
    if not estate:
        raise HTTPException(status_code=404, detail="Estate not found")

    now        = utcnow()
    thirty_ago = now - timedelta(days=30)
    in_30      = now + timedelta(days=30)

    total_units = await count(db, Unit, Unit.estate == estate_id, Unit.is_active == True)
    occupied    = await count(db, Unit, Unit.estate == estate_id, Unit.is_active == True, Unit.status == "occupied")
    total_t     = await count(db, Tenant, Tenant.estate == estate_id, Tenant.is_active == True)
    overdue_t   = await count(db, Tenant, Tenant.estate == estate_id, Tenant.is_active == True,
                              Tenant.next_due_date < now)
    upcoming_due = await count(db, Tenant, Tenant.estate == estate_id, Tenant.is_active == True,
                               Tenant.next_due_date >= now, Tenant.next_due_date <= in_30)

    rev_30 = await sum_col(db, Transaction, Transaction.amount,
                           Transaction.estate == estate_id, Transaction.status == "paid",
                           Transaction.created_at >= thirty_ago)
    tx_30  = await count(db, Transaction, Transaction.estate == estate_id,
                         Transaction.status == "paid", Transaction.created_at >= thirty_ago)
    revenue_total = await sum_col(db, Transaction, Transaction.amount,
                                  Transaction.estate == estate_id, Transaction.status == "paid")

    return {"success": True, "data": {
        "estate": {
            "id": estate.id, "name": estate.name,
            "total_units": estate.total_units,
            "created_at": estate.created_at,
        },
        "occupancy": {
            "total_units":    total_units,
            "occupied_units": occupied,
            "vacant_units":   total_units - occupied,
            "occupancy_rate": round(occupied / total_units * 100, 1) if total_units else 0,
        },
        "billing": {
            "upcoming_due_count": upcoming_due,
            "last30d": {"revenue": rev_30 or 0, "transactions": tx_30},
        },
        "tenants": {"total": total_t, "overdue": overdue_t},
        "revenue":  {"total": revenue_total or 0},
    }}


# ── Estate tenants (nested) ───────────────────────────────────────────────────

@router.get("/{estate_id}/tenants")
async def list_estate_tenants(
    estate_id: str,
    page: int = 1,
    limit: int = 20,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from api.v1.endpoints.tenants import list_tenants as _list_tenants
    return await _list_tenants(estate_id=estate_id, page=page, limit=limit,
                               search=search, db=db, user=user)


@router.get("/{estate_id}/tenants/{quarter}")
async def list_estate_tenants_quarterly(
    estate_id: str,
    quarter: str,
    year: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from api.v1.endpoints.tenants import list_tenants as _list_tenants
    return await _list_tenants(estate_id=estate_id, quarter=quarter,
                               view="quarterly", db=db, user=user)


@router.post("/{estate_id}/tenants", status_code=201)
async def create_estate_tenant(
    estate_id: str,
    body: TenantCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from api.v1.endpoints.tenants import create_tenant as _create_tenant
    return await _create_tenant(body=body, estate_id=estate_id, db=db, user=user)


# ── Estate units (nested) ─────────────────────────────────────────────────────

@router.get("/{estate_id}/units")
async def list_estate_units(
    estate_id: str,
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from api.v1.endpoints.units import list_units as _list_units
    return await _list_units(estate_id=estate_id, status=status, page=page, limit=limit, db=db, user=user)


@router.get("/{estate_id}/units/vacant")
async def list_estate_vacant_units(
    estate_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await require_estate_access(db, user, estate_id)
    units = await find_all(db, Unit, Unit.estate == estate_id,
                           Unit.is_active == True, Unit.status == "vacant",
                           order_by=Unit.label.asc())
    data = [
        {
            "unit_id": u.id, "label": u.label,
            "monthly_price": u.monthly_price,
            "meter_number": u.meter_number,
            "status": u.status, "description": u.description,
            "category": u.category,
        }
        for u in units
    ]
    return {"success": True, "total": len(data), "data": data}


@router.post("/{estate_id}/units", status_code=201)
async def create_estate_unit(
    estate_id: str,
    body: UnitCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from api.v1.endpoints.units import create_unit as _create_unit
    return await _create_unit(body=body, estate_id=estate_id, db=db, user=user)


@router.post("/{estate_id}/units/{unit_id}/remove-tenant")
async def remove_unit_tenant(
    estate_id: str,
    unit_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    unit = await find_one(db, Unit, Unit.id == unit_id, Unit.estate == estate_id, Unit.is_active == True)
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found in this estate")

    tenants = await find_all(db, Tenant, Tenant.unit == unit_id, Tenant.is_active == True)
    for t in tenants:
        t.is_active = False
        t.status = "vacant"
        t.updated_by = user.id
        t.updated_at = utcnow()
        await save(db, t)
        if t.user:
            u = await db.get(User, t.user)
            if u:
                u.is_active = False
                await save(db, u)

    unit.status = "vacant"
    unit.occupied_by = None
    unit.occupied_since = None
    unit.updated_by = user.id
    unit.updated_at = utcnow()
    await save(db, unit)
    return {"success": True, "message": "Tenant removed from unit"}


# ── Estate image upload ───────────────────────────────────────────────────────

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
    result = cloudinary.uploader.upload(buffer, folder=f"bamihost/estates/{estate_id}")
    img = {"url": result["secure_url"], "public_id": result["public_id"]}
    images = list(estate.images or [])
    images.append(img)
    estate.images = images
    estate.updated_at = utcnow()
    await save(db, estate)
    return {"success": True, "data": img}
