"""
Miscellaneous endpoints: rental applications, business types, bank deposits,
file upload, and vendor/manager payout.
"""
import cloudinary, cloudinary.uploader
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from datetime import datetime
from bson import ObjectId
from pydantic import BaseModel
from typing import Optional, List

from models.user import User
from models.rental_application import RentalApplication
from models.business_type import BusinessType
from models.bank_deposit import BankDeposit
from core.security import get_current_user

router = APIRouter(tags=["Misc"])

ADMIN_ROLES = {"super_admin", "admin", "super_manager", "business_owner"}


# ── Rental Applications ───────────────────────────────────────────────────────

class RentalApplicationCreate(BaseModel):
    first_name:  str
    last_name:   str
    email:       str
    phone:       Optional[str] = None
    unit_id:     Optional[str] = None
    estate_id:   Optional[str] = None
    message:     Optional[str] = None
    move_in_date: Optional[str] = None


@router.post("/rental-applications", status_code=201)
async def submit_rental_application(body: RentalApplicationCreate):
    coll = RentalApplication.get_motor_collection()
    doc  = {
        "first_name":   body.first_name,
        "last_name":    body.last_name,
        "email":        body.email.lower().strip(),
        "phone":        body.phone,
        "unit":         ObjectId(body.unit_id)   if body.unit_id   else None,
        "estate":       ObjectId(body.estate_id) if body.estate_id else None,
        "message":      body.message,
        "move_in_date": body.move_in_date,
        "status":       "pending",
        "is_active":    True,
        "created_at":   datetime.utcnow(),
        "updated_at":   datetime.utcnow(),
    }
    result = await coll.insert_one(doc)
    doc["_id"] = result.inserted_id
    return {"success": True, "message": "Application submitted", "data": doc}


@router.get("/rental-applications")
async def get_rental_applications(
    estate_id: Optional[str] = None,
    status_:   Optional[str] = Query(None, alias="status"),
    page: int = 1, limit: int = 20,
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    coll  = RentalApplication.get_motor_collection()
    f: dict = {"is_active": True}
    if estate_id: f["estate"] = ObjectId(estate_id)
    if status_:   f["status"] = status_
    total = await coll.count_documents(f)
    items = await coll.find(f).sort("created_at", -1).skip((page-1)*limit).limit(limit).to_list(limit)
    return {"success": True, "data": items,
            "pagination": {"current_page": page, "total_pages": -(-total // limit), "total_items": total}}


@router.patch("/rental-applications/{app_id}/status")
async def update_rental_application_status(
    app_id: str, body: dict, user: User = Depends(get_current_user)
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    coll = RentalApplication.get_motor_collection()
    result = await coll.find_one_and_update(
        {"_id": ObjectId(app_id), "is_active": True},
        {"$set": {"status": body.get("status"), "updated_at": datetime.utcnow(), "updated_by": user.id}},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Application not found")
    return {"success": True, "data": result}


# ── Business Types ────────────────────────────────────────────────────────────

class BusinessTypeCreate(BaseModel):
    name:        str
    description: Optional[str] = None
    icon:        Optional[str] = None


@router.post("/business-types", status_code=201)
async def create_business_type(body: BusinessTypeCreate, user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    coll = BusinessType.get_motor_collection()
    doc  = {"name": body.name, "description": body.description, "icon": body.icon,
             "is_active": True, "created_by": user.id, "created_at": datetime.utcnow(), "updated_at": datetime.utcnow()}
    result = await coll.insert_one(doc)
    doc["_id"] = result.inserted_id
    return {"success": True, "message": "Business type created", "data": doc}


@router.get("/business-types")
async def get_business_types():
    coll  = BusinessType.get_motor_collection()
    items = await coll.find({"is_active": True}).to_list(100)
    return {"success": True, "data": items}


@router.delete("/business-types/{bt_id}")
async def delete_business_type(bt_id: str, user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    coll = BusinessType.get_motor_collection()
    await coll.update_one({"_id": ObjectId(bt_id)}, {"$set": {"is_active": False}})
    return {"success": True, "message": "Business type deleted"}


# ── Bank Deposits ─────────────────────────────────────────────────────────────

class BankDepositCreate(BaseModel):
    amount:      float
    bank_name:   Optional[str] = None
    reference:   Optional[str] = None
    paid_for:    Optional[str] = None  # tenant_id or user_id it benefits


@router.post("/bank-deposits", status_code=201)
async def record_bank_deposit(body: BankDepositCreate, user: User = Depends(get_current_user)):
    coll = BankDeposit.get_motor_collection()
    doc  = {
        "amount":    body.amount,
        "bank_name": body.bank_name,
        "reference": body.reference,
        "paid_for":  body.paid_for,
        "status":    "pending",
        "submitted_by": user.id,
        "is_active": True,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }
    result = await coll.insert_one(doc)
    doc["_id"] = result.inserted_id
    return {"success": True, "message": "Bank deposit recorded", "data": doc}


@router.get("/bank-deposits")
async def get_bank_deposits(
    status_: Optional[str] = Query(None, alias="status"),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    coll = BankDeposit.get_motor_collection()
    f: dict = {"is_active": True}
    if status_: f["status"] = status_
    items = await coll.find(f).sort("created_at", -1).to_list(100)
    return {"success": True, "data": items}


@router.patch("/bank-deposits/{deposit_id}/approve")
async def approve_bank_deposit(deposit_id: str, user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    coll = BankDeposit.get_motor_collection()
    result = await coll.find_one_and_update(
        {"_id": ObjectId(deposit_id), "is_active": True},
        {"$set": {"status": "approved", "approved_by": user.id, "updated_at": datetime.utcnow()}},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Deposit not found")
    return {"success": True, "message": "Deposit approved", "data": result}


# ── File Upload ───────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    folder: Optional[str] = "bamihustle/uploads",
    user: User = Depends(get_current_user),
):
    data     = await file.read()
    is_video = file.content_type.startswith("video/")
    result   = cloudinary.uploader.upload(
        data, folder=folder, resource_type="video" if is_video else "image"
    )
    return {"success": True, "data": {"url": result["secure_url"], "public_id": result["public_id"]}}


# ── Vendor/Manager Payout (stub — full logic in Phase 6 services) ─────────────

@router.get("/vendor-payout/status")
async def get_payout_status(user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    return {"success": True, "message": "Payout status endpoint — full implementation in Phase 6 services"}


@router.post("/vendor-payout/process")
async def process_payout(user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    return {"success": True, "message": "Process payout — full implementation in Phase 6 services"}
