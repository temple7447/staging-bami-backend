from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, status
from typing import Optional, List
from datetime import datetime, timedelta
from bson import ObjectId
import re, cloudinary, cloudinary.uploader

from models.estate import Estate
from models.tenant import Tenant
from models.unit import Unit
from models.transaction import Transaction
from models.user import User
from schemas.estate import EstateCreate, EstateUpdate
from core.security import get_current_user, require_admin_or_above
from core.config import settings
from utils.date_range import resolve_date_range
from utils.rent_calculator import get_current_rent

router = APIRouter(prefix="/estates", tags=["Estates"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _check_estate_access(estate: Estate, user: User):
    if user.role == "business_owner":
        if not estate.owner or str(estate.owner) != str(user.id):
            raise HTTPException(status_code=403, detail="You do not have access to this estate")
    elif user.role == "admin":
        if not any(str(m) == str(user.id) for m in estate.managers):
            raise HTTPException(status_code=403, detail="You do not have access to this estate")


def _build_estate_filter(user: User) -> dict:
    f: dict = {"is_active": True}
    if user.role == "business_owner":
        f["$or"] = [{"owner": user.id}, {"created_by": user.id}]
    elif user.role == "admin":
        f["managers"] = user.id
    return f


async def _upload_to_cloudinary(buffer: bytes, folder: str, resource_type: str = "image") -> dict:
    result = cloudinary.uploader.upload(
        buffer,
        folder=folder,
        resource_type=resource_type,
        transformation=[{"quality": "auto", "fetch_format": "auto"}] if resource_type == "image" else None,
    )
    return {"url": result["secure_url"], "public_id": result["public_id"]}


# ── Overall overview ──────────────────────────────────────────────────────────

@router.get("/overview/all")
async def get_overall_overview(
    period:       Optional[str] = None,
    year:         Optional[int] = None,
    month:        Optional[int] = None,
    start_date:   Optional[str] = Query(None, alias="startDate"),
    end_date:     Optional[str] = Query(None, alias="endDate"),
    estate_ids:   Optional[str] = Query(None, alias="estateIds"),
    unit_status:  Optional[str] = Query(None, alias="unitStatus"),
    tenant_status: Optional[str] = Query(None, alias="tenantStatus"),
    payment_status: Optional[str] = Query(None, alias="paymentStatus"),
    user: User = Depends(get_current_user),
):
    now = datetime.utcnow()
    filter_start, filter_end = resolve_date_range(period, year, month, start_date, end_date)

    estate_filter = _build_estate_filter(user)
    accessible = await Estate.find(estate_filter).project({"_id": 1}).to_list()
    accessible_ids = [e.id for e in accessible]

    if not accessible_ids:
        return {"success": True, "data": {
            "estates": {"totalEstates": 0}, "units": {}, "tenants": {}, "revenue": {"amount": 0}
        }}

    scoped_ids = accessible_ids
    if estate_ids:
        req_ids = [ObjectId(i.strip()) for i in estate_ids.split(",") if i.strip()]
        scoped_ids = [i for i in accessible_ids if i in req_ids]

    # Unit stats
    unit_filter: dict = {"is_active": True, "estate": {"$in": scoped_ids}}
    if unit_status:
        unit_filter["status"] = unit_status

    # Tenant stats
    tenant_filter: dict = {"is_active": True, "estate": {"$in": scoped_ids}}
    tenant_filter["status"] = tenant_status if tenant_status else {"$in": ["occupied", "pending"]}

    next7  = now + timedelta(days=7)
    next30 = now + timedelta(days=30)

    unit_coll    = Unit.get_motor_collection()
    tenant_coll  = Tenant.get_motor_collection()

    unit_agg = await unit_coll.aggregate([
        {"$match": unit_filter},
        {"$group": {"_id": None,
            "totalUnits":       {"$sum": 1},
            "occupiedUnits":    {"$sum": {"$cond": [{"$eq": ["$status", "occupied"]}, 1, 0]}},
            "vacantUnits":      {"$sum": {"$cond": [{"$eq": ["$status", "vacant"]}, 1, 0]}},
            "maintenanceUnits": {"$sum": {"$cond": [{"$eq": ["$status", "maintenance"]}, 1, 0]}},
            "reservedUnits":    {"$sum": {"$cond": [{"$eq": ["$status", "reserved"]}, 1, 0]}},
        }}
    ]).to_list(1)

    unit_stats = unit_agg[0] if unit_agg else {"totalUnits": 0, "occupiedUnits": 0, "vacantUnits": 0}
    total_units = unit_stats.get("totalUnits", 0)
    occupancy_rate = (unit_stats.get("occupiedUnits", 0) / total_units * 100) if total_units else 0

    active_count  = await Tenant.find(tenant_filter).count()
    due7_count    = await Tenant.find({**tenant_filter, "next_due_date": {"$gte": now, "$lte": next7}}).count()
    due30_count   = await Tenant.find({**tenant_filter, "next_due_date": {"$gte": now, "$lte": next30}}).count()

    tx_coll = Transaction.get_motor_collection()
    rev_agg = await tx_coll.aggregate([
        {"$match": {"is_active": True, "status": "paid", "estate": {"$in": scoped_ids},
                    "created_at": {"$gte": filter_start, "$lte": filter_end}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}, "count": {"$sum": 1}}}
    ]).to_list(1)
    revenue  = rev_agg[0]["total"] if rev_agg else 0
    tx_count = rev_agg[0]["count"] if rev_agg else 0

    return {"success": True, "data": {
        "period":  {"startDate": filter_start, "endDate": filter_end},
        "estates": {"totalEstates": len(scoped_ids), "activeEstates": len(scoped_ids)},
        "units":   {**unit_stats, "occupancyRate": round(occupancy_rate, 2)},
        "tenants": {"totalActiveTenants": active_count, "dueSoon7Days": due7_count, "dueSoon30Days": due30_count},
        "revenue": {"amount": revenue, "transactionCount": tx_count},
    }}


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("/")
async def list_estates(
    page:          int = 1,
    limit:         int = 20,
    search:        Optional[str] = None,
    sort_by:       str = Query("created_at", alias="sortBy"),
    order:         str = "desc",
    min_units:     Optional[int] = Query(None, alias="minUnits"),
    max_units:     Optional[int] = Query(None, alias="maxUnits"),
    created_after: Optional[str] = Query(None, alias="createdAfter"),
    created_before: Optional[str] = Query(None, alias="createdBefore"),
    user: User = Depends(get_current_user),
):
    f = _build_estate_filter(user)
    if search:
        f["name"] = re.compile(search, re.IGNORECASE)
    if min_units is not None or max_units is not None:
        f["total_units"] = {}
        if min_units is not None: f["total_units"]["$gte"] = min_units
        if max_units is not None: f["total_units"]["$lte"] = max_units
    if created_after or created_before:
        f["created_at"] = {}
        if created_after:  f["created_at"]["$gte"] = datetime.fromisoformat(created_after)
        if created_before:
            end = datetime.fromisoformat(created_before).replace(hour=23, minute=59, second=59)
            f["created_at"]["$lte"] = end

    valid_sort = {"name", "created_at", "total_units"}
    sort_field = sort_by if sort_by in valid_sort else "created_at"
    sort_dir   = 1 if order == "asc" else -1

    skip  = (page - 1) * limit
    coll  = Estate.get_motor_collection()
    total = await coll.count_documents(f)
    items = await coll.find(f).sort(sort_field, sort_dir).skip(skip).limit(limit).to_list(limit)

    return {"success": True, "data": items, "pagination": {
        "currentPage": page, "totalPages": -(-total // limit),
        "totalItems": total, "itemsPerPage": limit,
    }}


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_estate(body: EstateCreate, user: User = Depends(get_current_user)):
    existing = await Estate.find_one(
        {"name": re.compile(f"^{re.escape(body.name)}$", re.IGNORECASE), "is_active": True}
    )
    if existing:
        raise HTTPException(status_code=400, detail="An estate with this name already exists")

    estate = Estate(
        name=body.name,
        description=body.description,
        total_units=body.total_units,
        created_by=user.id,
    )
    estate.set_slug()
    await estate.insert()
    return {"success": True, "message": "Estate created successfully", "data": estate.model_dump()}


@router.get("/{estate_id}/overview")
async def get_estate_overview(
    estate_id: str,
    period:     Optional[str] = None,
    year:       Optional[int] = None,
    month:      Optional[int] = None,
    start_date: Optional[str] = Query(None, alias="startDate"),
    end_date:   Optional[str] = Query(None, alias="endDate"),
    user: User = Depends(get_current_user),
):
    estate = await Estate.get(estate_id)
    if not estate or not estate.is_active:
        raise HTTPException(status_code=404, detail="Estate not found")
    _check_estate_access(estate, user)

    filter_start, filter_end = resolve_date_range(period, year, month, start_date, end_date)
    now = datetime.utcnow()

    occupied_count = await Tenant.find(
        {"estate": estate.id, "is_active": True, "status": {"$in": ["occupied", "pending"]}}
    ).count()
    due_soon_count = await Tenant.find({
        "estate": estate.id, "is_active": True,
        "next_due_date": {"$gte": now, "$lte": now + timedelta(days=30)}
    }).count()

    active_tenants = await Tenant.find(
        {"estate": estate.id, "is_active": True, "status": {"$in": ["occupied", "pending"]}}
    ).to_list()

    potential_monthly = sum(
        get_current_rent(t.rent_amount, t.entry_date or t.created_at, False) +
        get_current_rent(t.service_charge_amount, t.entry_date or t.created_at, False)
        for t in active_tenants
    )

    tx_coll = Transaction.get_motor_collection()
    rev_agg = await tx_coll.aggregate([
        {"$match": {"estate": estate.id, "is_active": True, "status": "paid",
                    "created_at": {"$gte": filter_start, "$lte": filter_end}}},
        {"$group": {"_id": "$type", "total": {"$sum": "$amount"}, "count": {"$sum": 1}}}
    ]).to_list(None)

    income_by_category = {row["_id"]: row["total"] for row in rev_agg}
    period_revenue = sum(r["total"] for r in rev_agg)
    period_tx_count = sum(r["count"] for r in rev_agg)

    total_units   = estate.total_units or 0
    vacant_units  = max(total_units - occupied_count, 0)
    occupancy_rate = (occupied_count / total_units * 100) if total_units else 0

    return {"success": True, "data": {
        "estate":     {"_id": str(estate.id), "name": estate.name, "totalUnits": total_units},
        "occupancy":  {"totalUnits": total_units, "occupiedUnits": occupied_count,
                       "vacantUnits": vacant_units, "occupancyRate": round(occupancy_rate, 2)},
        "projections": {"monthly": potential_monthly, "yearly": potential_monthly * 12, "currency": "NGN"},
        "billing":    {"upcomingDueCount": due_soon_count, "periodStats": {
            "period": period or "last_30_days", "revenue": period_revenue,
            "transactions": period_tx_count, "breakdown": income_by_category,
        }},
    }}


@router.get("/{estate_id}")
async def get_estate(estate_id: str, user: User = Depends(get_current_user)):
    estate = await Estate.get(estate_id)
    if not estate or not estate.is_active:
        raise HTTPException(status_code=404, detail="Estate not found")
    return {"success": True, "data": estate.model_dump()}


@router.put("/{estate_id}")
async def update_estate(estate_id: str, body: EstateUpdate, user: User = Depends(get_current_user)):
    estate = await Estate.get(estate_id)
    if not estate or not estate.is_active:
        raise HTTPException(status_code=404, detail="Estate not found")

    if body.name and body.name != estate.name:
        dup = await Estate.find_one({
            "name": re.compile(f"^{re.escape(body.name)}$", re.IGNORECASE),
            "is_active": True, "_id": {"$ne": estate.id}
        })
        if dup:
            raise HTTPException(status_code=400, detail="An estate with this name already exists")
        estate.name = body.name
        estate.set_slug()

    if body.description is not None: estate.description = body.description
    if body.total_units is not None:  estate.total_units = body.total_units
    estate.updated_by = user.id
    estate.updated_at = datetime.utcnow()
    await estate.save()
    return {"success": True, "message": "Estate updated successfully", "data": estate.model_dump()}


@router.delete("/{estate_id}")
async def delete_estate(estate_id: str, user: User = Depends(get_current_user)):
    estate = await Estate.get(estate_id)
    if not estate:
        raise HTTPException(status_code=404, detail="Estate not found")
    if not estate.is_active:
        return {"success": True, "message": "Estate deleted successfully"}
    estate.is_active  = False
    estate.updated_by = user.id
    estate.updated_at = datetime.utcnow()
    await estate.save()
    return {"success": True, "message": "Estate deleted successfully"}


# ── Estate media ──────────────────────────────────────────────────────────────

@router.post("/{estate_id}/media/images")
async def upload_estate_images(
    estate_id: str,
    images: List[UploadFile] = File(...),
    user: User = Depends(get_current_user),
):
    estate = await Estate.get(estate_id)
    if not estate:
        raise HTTPException(status_code=404, detail="Estate not found")

    folder   = f"{settings.CLOUDINARY_CLOUD_NAME}/estates/{estate_id}/images"
    uploaded = []
    for img in images:
        data   = await img.read()
        result = await _upload_to_cloudinary(data, folder, "image")
        uploaded.append(result)

    estate.images.extend(uploaded)
    estate.updated_by = user.id
    estate.updated_at = datetime.utcnow()
    await estate.save()
    return {"success": True, "message": f"{len(uploaded)} image(s) uploaded", "images": estate.images}


@router.patch("/{estate_id}/media")
async def update_estate_media(
    estate_id: str,
    body: dict,
    user: User = Depends(get_current_user),
):
    estate = await Estate.get(estate_id)
    if not estate:
        raise HTTPException(status_code=404, detail="Estate not found")

    images  = body.get("images", [])
    replace = body.get("replace", False)
    mapped  = [{"url": i.get("url") or i.get("secure_url"), "public_id": i.get("publicId") or i.get("public_id"), "caption": i.get("caption")} for i in images if i.get("url") or i.get("secure_url")]
    estate.images    = mapped if replace else [*estate.images, *mapped]
    estate.updated_by = user.id
    estate.updated_at = datetime.utcnow()
    await estate.save()
    return {"success": True, "images": estate.images}


@router.delete("/{estate_id}/media")
async def remove_estate_media(
    estate_id: str,
    body: dict,
    user: User = Depends(get_current_user),
):
    estate = await Estate.get(estate_id)
    if not estate:
        raise HTTPException(status_code=404, detail="Estate not found")

    image_ids = body.get("imageIds", [])
    for img in estate.images:
        if img.get("public_id") in image_ids:
            cloudinary.uploader.destroy(img["public_id"])

    estate.images     = [i for i in estate.images if i.get("public_id") not in image_ids]
    estate.updated_by = user.id
    estate.updated_at = datetime.utcnow()
    await estate.save()
    return {"success": True, "images": estate.images}
