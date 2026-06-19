from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from typing import Optional, List
from datetime import datetime
from bson import ObjectId
import uuid, cloudinary, cloudinary.uploader

from models.unit import Unit, UnitStatus
from models.tenant import Tenant
from models.estate import Estate
from models.user import User
from schemas.unit import UnitCreate, UnitUpdate, MediaUpdateBody, MediaRemoveBody, ConditionReportJson
from core.security import get_current_user
from core.config import settings
from utils.rent_calculator import get_current_rent

router = APIRouter(prefix="/estates", tags=["Units"])


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_unit_or_404(unit_id: str) -> Unit:
    unit = await Unit.get(unit_id)
    if not unit or not unit.is_active:
        raise HTTPException(status_code=404, detail="Unit not found")
    return unit


async def _upload_file(data: bytes, folder: str, resource_type: str = "image") -> dict:
    result = cloudinary.uploader.upload(data, folder=folder, resource_type=resource_type)
    return {"url": result["secure_url"], "public_id": result["public_id"]}


# ── Public routes (no auth) ───────────────────────────────────────────────────

@router.get("/public/listings")
async def public_listings(
    page: int = 1, limit: int = 20,
    category: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
):
    f: dict = {"is_active": True, "status": "vacant", "listing_type": "Rent"}
    if category:  f["category"] = category
    if min_price: f["monthly_price"] = {"$gte": min_price}
    if max_price: f.setdefault("monthly_price", {})["$lte"] = max_price

    coll  = Unit.get_motor_collection()
    total = await coll.count_documents(f)
    items = await coll.find(f).skip((page - 1) * limit).limit(limit).to_list(limit)
    return {"success": True, "data": items, "pagination": {
        "currentPage": page, "totalPages": -(-total // limit), "totalItems": total
    }}


@router.get("/public/listings/{unit_id}")
async def public_listing_detail(unit_id: str):
    unit = await Unit.get(unit_id)
    if not unit or not unit.is_active:
        raise HTTPException(status_code=404, detail="Unit not found")
    return {"success": True, "data": unit.model_dump()}


@router.get("/public/estates")
async def public_estates():
    estates = await Estate.find({"is_active": True}).to_list()
    return {"success": True, "data": [e.model_dump() for e in estates]}


# ── Estate-scoped unit routes ─────────────────────────────────────────────────

@router.post("/{estate_id}/units", status_code=status.HTTP_201_CREATED)
async def create_unit(estate_id: str, body: UnitCreate, user: User = Depends(get_current_user)):
    estate = await Estate.get(estate_id)
    if not estate or not estate.is_active:
        raise HTTPException(status_code=404, detail="Estate not found")

    existing = await Unit.find_one({"estate": ObjectId(estate_id), "label": body.label, "is_active": True})
    if existing:
        raise HTTPException(status_code=400, detail="A unit with this label already exists in the estate")

    unit = Unit(
        estate=ObjectId(estate_id),
        label=body.label,
        monthly_price=body.monthly_price,
        service_charge_monthly=body.service_charge_monthly,
        caution_fee=body.caution_fee,
        legal_fee=body.legal_fee,
        meter_number=body.meter_number,
        description=body.description,
        category=body.category,
        listing_type=body.listing_type,
        available_date=body.available_date,
        bedrooms=body.bedrooms,
        bathrooms=body.bathrooms,
        area=body.area,
        amenities=body.amenities,
        street_address=body.street_address,
        features=body.features,
        created_by=user.id,
    )
    await unit.insert()
    return {"success": True, "message": "Unit created successfully", "data": unit.model_dump()}


@router.get("/{estate_id}/units")
async def get_estate_units(
    estate_id: str,
    status: Optional[str] = None,
    user: User = Depends(get_current_user),
):
    f: dict = {"estate": ObjectId(estate_id), "is_active": True}
    if status: f["status"] = status
    units = await Unit.find(f).to_list()
    return {"success": True, "data": [u.model_dump() for u in units]}


@router.get("/{estate_id}/units/vacant")
async def get_vacant_units(estate_id: str, user: User = Depends(get_current_user)):
    units = await Unit.find({"estate": ObjectId(estate_id), "status": "vacant", "is_active": True}).to_list()
    return {"success": True, "data": [u.model_dump() for u in units]}


@router.post("/{estate_id}/units/{unit_id}/assign-tenant")
async def assign_tenant(estate_id: str, unit_id: str, body: dict, user: User = Depends(get_current_user)):
    unit = await _get_unit_or_404(unit_id)
    if unit.status == UnitStatus.occupied:
        raise HTTPException(status_code=400, detail="Unit is already occupied")

    tenant_id = body.get("tenantId")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenantId is required")

    tenant = await Tenant.get(tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    unit.status        = UnitStatus.occupied
    unit.occupied_by   = ObjectId(tenant_id)
    unit.occupied_since = datetime.utcnow()
    unit.updated_by    = user.id
    unit.updated_at    = datetime.utcnow()
    await unit.save()
    return {"success": True, "message": "Tenant assigned to unit", "data": unit.model_dump()}


@router.post("/{estate_id}/units/{unit_id}/remove-tenant")
async def remove_tenant(estate_id: str, unit_id: str, user: User = Depends(get_current_user)):
    unit = await _get_unit_or_404(unit_id)
    unit.status       = UnitStatus.vacant
    unit.occupied_by  = None
    unit.occupied_since = None
    unit.updated_by   = user.id
    unit.updated_at   = datetime.utcnow()
    await unit.save()
    return {"success": True, "message": "Unit is now vacant", "data": unit.model_dump()}


# ── Single unit routes (/unit/:unitId) ────────────────────────────────────────

@router.get("/unit/{unit_id}")
async def get_unit_details(unit_id: str, user: User = Depends(get_current_user)):
    unit = await _get_unit_or_404(unit_id)
    return {"success": True, "data": unit.model_dump()}


@router.put("/unit/{unit_id}")
async def update_unit(unit_id: str, body: UnitUpdate, user: User = Depends(get_current_user)):
    unit = await _get_unit_or_404(unit_id)
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(unit, field, val)
    unit.updated_by = user.id
    unit.updated_at = datetime.utcnow()
    await unit.save()
    return {"success": True, "message": "Unit updated successfully", "data": unit.model_dump()}


@router.delete("/unit/{unit_id}")
async def delete_unit(unit_id: str, user: User = Depends(get_current_user)):
    unit = await _get_unit_or_404(unit_id)
    unit.is_active  = False
    unit.updated_by = user.id
    unit.updated_at = datetime.utcnow()
    await unit.save()
    return {"success": True, "message": "Unit deleted successfully"}


# ── Unit media ────────────────────────────────────────────────────────────────

@router.post("/unit/{unit_id}/media/images")
async def upload_unit_images(
    unit_id: str,
    images: List[UploadFile] = File(...),
    user: User = Depends(get_current_user),
):
    unit   = await _get_unit_or_404(unit_id)
    folder = f"bamihustle/units/{unit_id}/images"
    uploaded = []
    for img in images:
        if img.content_type not in ["image/jpeg", "image/png", "image/gif", "image/webp"]:
            raise HTTPException(status_code=400, detail="Only jpeg, png, gif, webp images allowed")
        data   = await img.read()
        result = await _upload_file(data, folder, "image")
        uploaded.append(result)

    unit.images.extend(uploaded)
    unit.updated_by = user.id
    unit.updated_at = datetime.utcnow()
    await unit.save()
    return {"success": True, "message": f"{len(uploaded)} image(s) uploaded", "images": unit.images}


@router.post("/unit/{unit_id}/media/videos")
async def upload_unit_video(
    unit_id: str,
    video: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    unit   = await _get_unit_or_404(unit_id)
    folder = f"bamihustle/units/{unit_id}/videos"
    data   = await video.read()
    result = await _upload_file(data, folder, "video")
    unit.videos.append(result)
    unit.updated_by = user.id
    unit.updated_at = datetime.utcnow()
    await unit.save()
    return {"success": True, "message": "Video uploaded", "videos": unit.videos}


@router.patch("/unit/{unit_id}/media")
async def update_unit_media(unit_id: str, body: MediaUpdateBody, user: User = Depends(get_current_user)):
    unit = await _get_unit_or_404(unit_id)
    if body.images is not None:
        unit.images = body.images if body.replace else [*unit.images, *body.images]
    if body.videos is not None:
        unit.videos = body.videos if body.replace else [*unit.videos, *body.videos]
    unit.updated_by = user.id
    unit.updated_at = datetime.utcnow()
    await unit.save()
    return {"success": True, "images": unit.images, "videos": unit.videos}


@router.delete("/unit/{unit_id}/media")
async def remove_unit_media(unit_id: str, body: MediaRemoveBody, user: User = Depends(get_current_user)):
    unit = await _get_unit_or_404(unit_id)
    for pid in body.image_ids:
        cloudinary.uploader.destroy(pid)
    for pid in body.video_ids:
        cloudinary.uploader.destroy(pid, resource_type="video")
    unit.images = [i for i in unit.images if i.get("public_id") not in body.image_ids]
    unit.videos = [v for v in unit.videos if v.get("public_id") not in body.video_ids]
    unit.updated_by = user.id
    unit.updated_at = datetime.utcnow()
    await unit.save()
    return {"success": True, "images": unit.images, "videos": unit.videos}


# ── Condition reports ─────────────────────────────────────────────────────────

@router.post("/unit/{unit_id}/condition/json")
async def create_condition_report_json(
    unit_id: str, body: ConditionReportJson, user: User = Depends(get_current_user)
):
    unit = await _get_unit_or_404(unit_id)
    report = {
        "id":               str(uuid.uuid4()),
        "type":             body.type,
        "overall_condition": body.overall_condition,
        "notes":            body.notes,
        "images":           body.images,
        "videos":           body.videos,
        "recorded_by":      str(user.id),
        "created_at":       datetime.utcnow().isoformat(),
    }
    unit.condition_reports.append(report)
    unit.updated_at = datetime.utcnow()
    await unit.save()
    return {"success": True, "message": "Condition report created", "data": report}


@router.get("/unit/{unit_id}/condition")
async def get_condition_reports(
    unit_id: str, type: Optional[str] = None, user: User = Depends(get_current_user)
):
    unit = await _get_unit_or_404(unit_id)
    reports = unit.condition_reports
    if type:
        reports = [r for r in reports if r.get("type") == type]
    return {"success": True, "data": reports}


@router.delete("/unit/{unit_id}/condition/{report_id}")
async def delete_condition_report(unit_id: str, report_id: str, user: User = Depends(get_current_user)):
    unit = await _get_unit_or_404(unit_id)
    before = len(unit.condition_reports)
    unit.condition_reports = [r for r in unit.condition_reports if r.get("id") != report_id]
    if len(unit.condition_reports) == before:
        raise HTTPException(status_code=404, detail="Condition report not found")
    unit.updated_at = datetime.utcnow()
    await unit.save()
    return {"success": True, "message": "Condition report deleted"}


# ── Vacancy scenarios ─────────────────────────────────────────────────────────

@router.get("/unit/{unit_id}/vacancy-scenarios")
async def get_vacancy_scenarios(unit_id: str, user: User = Depends(get_current_user)):
    unit = await _get_unit_or_404(unit_id)
    origin = unit.created_at
    scenarios = []
    for years in range(1, 6):
        from datetime import timedelta
        vacant_start = datetime.utcnow() + timedelta(days=years * 365)
        rent = get_current_rent(unit.monthly_price, origin, is_vacant=True)
        scenarios.append({"yearsVacant": years, "projectedRent": rent, "annualLoss": rent * 12})
    return {"success": True, "data": scenarios}
