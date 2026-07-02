import cloudinary, cloudinary.uploader
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime
from pydantic import BaseModel
from typing import Optional, List

from models.user import User
from models.rental_application import RentalApplication
from models.business_type import BusinessType
from models.bank_deposit import BankDeposit
from core.security import get_current_user
from core.database import get_db
from core.db_helpers import find_one, find_all, save, count
from core.config import settings
from models.base import gen_uuid
from utils.time_utils import utcnow

router = APIRouter(tags=["Misc"])
ADMIN_ROLES = {"super_admin", "admin", "super_manager", "business_owner"}


class RentalApplicationCreate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    unit_id: Optional[str] = None
    estate_id: Optional[str] = None
    message: Optional[str] = None
    move_in_date: Optional[str] = None


@router.post("/rental-applications", status_code=201)
async def submit_rental_application(
    body: RentalApplicationCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    name_parts = (user.name or "").split(" ", 1)
    first = body.first_name or name_parts[0]
    last  = body.last_name  or (name_parts[1] if len(name_parts) > 1 else "")
    email = body.email or user.email
    app = RentalApplication(
        id=gen_uuid(), first_name=first, last_name=last, email=email,
        phone=body.phone, unit=body.unit_id, estate=body.estate_id,
        message=body.message, move_in_date=body.move_in_date,
    )
    await save(db, app)
    return {"success": True, "message": "Application submitted", "data": {"id": app.id}}


@router.get("/rental-applications")
async def list_rental_applications(
    status: Optional[str] = None,
    estate: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conditions = [RentalApplication.is_active == True]
    if user.role in ADMIN_ROLES:
        if status:
            conditions.append(RentalApplication.status == status)
        if estate:
            conditions.append(RentalApplication.estate == estate)
    else:
        # tenants see only their own applications
        conditions.append(RentalApplication.email == user.email)
    skip = (page - 1) * limit
    total = await count(db, RentalApplication, *conditions)
    items = await find_all(db, RentalApplication, *conditions,
                           order_by=RentalApplication.created_at.desc(), skip=skip, limit=limit)
    return {"success": True, "count": total, "total": total,
            "total_pages": -(-total // limit), "page": page,
            "data": [_ra(a) for a in items]}


@router.patch("/rental-applications/{app_id}/status")
async def update_application_status(
    app_id: str, body: dict,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    app = await find_one(db, RentalApplication, RentalApplication.id == app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    app.status = body.get("status", app.status)
    app.updated_by = user.id
    app.updated_at = utcnow()
    await save(db, app)
    return {"success": True, "data": _ra(app)}


@router.post("/business-types", status_code=201)
async def create_business_type(
    body: dict,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    bt = BusinessType(id=gen_uuid(), name=body.get("name", ""), description=body.get("description"),
                      icon=body.get("icon"), created_by=user.id)
    await save(db, bt)
    return {"success": True, "data": {"id": bt.id, "name": bt.name}}


@router.get("/business-types")
async def list_business_types(db: AsyncSession = Depends(get_db)):
    items = await find_all(db, BusinessType, BusinessType.is_active == True,
                           order_by=BusinessType.name.asc())
    return {"success": True, "data": [{"id": i.id, "name": i.name, "icon": i.icon} for i in items]}


@router.delete("/business-types/{bt_id}")
async def delete_business_type(
    bt_id: str,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    bt = await find_one(db, BusinessType, BusinessType.id == bt_id)
    if not bt:
        raise HTTPException(status_code=404, detail="Not found")
    bt.is_active = False
    bt.updated_at = utcnow()
    await save(db, bt)
    return {"success": True, "message": "Business type deleted"}


@router.get("/bank-deposits/bank-info")
async def get_bank_info(db: AsyncSession = Depends(get_db)):
    from models.setting import Setting
    setting = await find_one(db, Setting)
    bank_data = (setting.data or {}).get("bank_info", {}) if setting else {}
    return {"success": True, "data": {
        "bankName":      bank_data.get("bank_name", "UBA"),
        "accountNumber": bank_data.get("account_number", "1234567890"),
        "accountName":   bank_data.get("account_name", "BamiHost Properties Ltd"),
    }}


@router.get("/bank-deposits/my")
async def my_deposits(
    page: int = 1, limit: int = 10, status: Optional[str] = None,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    conditions = [BankDeposit.submitted_by == user.id, BankDeposit.is_active == True]
    if status:
        conditions.append(BankDeposit.status == status)
    skip = (page - 1) * limit
    from core.db_helpers import count as db_count
    total = await db_count(db, BankDeposit, *conditions)
    items = await find_all(db, BankDeposit, *conditions, order_by=BankDeposit.created_at.desc(), skip=skip, limit=limit)
    return {"success": True, "count": total, "total": total,
            "total_pages": -(-total // limit), "page": page,
            "data": [_dep(i) for i in items]}


@router.post("/bank-deposits", status_code=201)
async def record_bank_deposit(
    amount: Optional[float] = None,
    bank_name: Optional[str] = None,
    account_name: Optional[str] = None,
    account_number: Optional[str] = None,
    reference: Optional[str] = None,
    paid_for: Optional[str] = None,
    proof_image: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    proof_url = None
    if proof_image and proof_image.filename:
        cloudinary.config(
            cloud_name=settings.CLOUDINARY_CLOUD_NAME,
            api_key=settings.CLOUDINARY_API_KEY,
            api_secret=settings.CLOUDINARY_API_SECRET,
        )
        buf = await proof_image.read()
        result = cloudinary.uploader.upload(buf, folder="bamihost/deposits")
        proof_url = result.get("secure_url")
    dep = BankDeposit(
        id=gen_uuid(), amount=amount or 0, bank_name=bank_name,
        reference=reference, paid_for=paid_for, notes=proof_url,
        submitted_by=user.id,
    )
    await save(db, dep)
    return {"success": True, "message": "Deposit submitted for review",
            "data": {"depositId": dep.id, "amount": dep.amount, "status": dep.status,
                     "submittedAt": dep.created_at}}


@router.get("/bank-deposits")
async def list_bank_deposits(
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    conditions = [BankDeposit.is_active == True]
    if status:
        conditions.append(BankDeposit.status == status)
    skip = (page - 1) * limit
    total = await count(db, BankDeposit, *conditions)
    items = await find_all(db, BankDeposit, *conditions,
                           order_by=BankDeposit.created_at.desc(), skip=skip, limit=limit)
    return {"success": True, "count": total, "total": total,
            "total_pages": -(-total // limit), "page": page,
            "data": [_dep(i) for i in items]}


@router.get("/bank-deposits/{dep_id}")
async def get_bank_deposit(
    dep_id: str,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    dep = await find_one(db, BankDeposit, BankDeposit.id == dep_id, BankDeposit.is_active == True)
    if not dep:
        raise HTTPException(status_code=404, detail="Deposit not found")
    if user.role not in ADMIN_ROLES and dep.submitted_by != user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    return {"success": True, "data": _dep(dep)}


@router.patch("/bank-deposits/{dep_id}/approve")
async def approve_bank_deposit(
    dep_id: str, body: dict = {},
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    dep = await find_one(db, BankDeposit, BankDeposit.id == dep_id)
    if not dep:
        raise HTTPException(status_code=404, detail="Deposit not found")
    dep.status = "approved"
    dep.approved_by = user.id
    dep.notes = body.get("adminNote") or dep.notes
    dep.updated_at = utcnow()
    await save(db, dep)
    return {"success": True, "message": "Deposit approved",
            "data": {"depositId": dep.id, "status": dep.status}}


@router.patch("/bank-deposits/{dep_id}/reject")
async def reject_bank_deposit(
    dep_id: str, body: dict = {},
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    dep = await find_one(db, BankDeposit, BankDeposit.id == dep_id)
    if not dep:
        raise HTTPException(status_code=404, detail="Deposit not found")
    dep.status = "rejected"
    dep.approved_by = user.id
    dep.notes = body.get("adminNote") or dep.notes
    dep.updated_at = utcnow()
    await save(db, dep)
    return {"success": True, "message": "Deposit rejected",
            "data": {"depositId": dep.id, "status": dep.status}}


def _dep(i: BankDeposit) -> dict:
    return {"id": i.id, "amount": i.amount, "status": i.status, "bank_name": i.bank_name,
            "reference": i.reference, "paid_for": i.paid_for, "notes": i.notes,
            "submitted_by": i.submitted_by, "approved_by": i.approved_by,
            "created_at": i.created_at, "updated_at": i.updated_at}


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    cloudinary.config(
        cloud_name=settings.CLOUDINARY_CLOUD_NAME,
        api_key=settings.CLOUDINARY_API_KEY,
        api_secret=settings.CLOUDINARY_API_SECRET,
    )
    buffer = await file.read()
    result = cloudinary.uploader.upload(buffer, folder="bamihost/uploads")
    return {"success": True, "data": {"url": result["secure_url"], "public_id": result["public_id"]}}


def _ra(a: RentalApplication) -> dict:
    return {
        "id": a.id, "first_name": a.first_name, "last_name": a.last_name,
        "email": a.email, "phone": a.phone, "estate": a.estate, "unit": a.unit,
        "status": a.status, "move_in_date": a.move_in_date, "created_at": a.created_at,
    }
