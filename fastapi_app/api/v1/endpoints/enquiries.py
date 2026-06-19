from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime
from bson import ObjectId
from pydantic import BaseModel, EmailStr
from typing import Optional

from models.user import User
from models.enquiry import Enquiry
from core.security import get_current_user

router = APIRouter(prefix="/enquiries", tags=["Enquiries"])

ADMIN_ROLES = {"super_admin", "admin", "super_manager", "business_owner", "manager"}


class EnquiryCreate(BaseModel):
    name:        str
    email:       str
    phone:       Optional[str] = None
    message:     str
    subject:     Optional[str] = None
    estate_id:   Optional[str] = None
    unit_id:     Optional[str] = None
    enquiry_type: Optional[str] = "general"


class StatusUpdate(BaseModel):
    status: str
    note:   Optional[str] = None


# ── Public endpoint ───────────────────────────────────────────────────────────

@router.post("/", status_code=201)
async def submit_enquiry(body: EnquiryCreate):
    coll = Enquiry.get_motor_collection()
    doc  = {
        "name":         body.name,
        "email":        body.email.lower().strip(),
        "phone":        body.phone,
        "message":      body.message,
        "subject":      body.subject,
        "estate":       ObjectId(body.estate_id) if body.estate_id else None,
        "unit":         ObjectId(body.unit_id)   if body.unit_id   else None,
        "enquiry_type": body.enquiry_type,
        "status":       "pending",
        "is_active":    True,
        "created_at":   datetime.utcnow(),
        "updated_at":   datetime.utcnow(),
    }
    result = await coll.insert_one(doc)
    doc["_id"] = result.inserted_id
    return {"success": True, "message": "Enquiry submitted successfully", "data": doc}


# ── Protected endpoints ───────────────────────────────────────────────────────

@router.get("/")
async def get_enquiries(
    estate_id: Optional[str] = None,
    status_:   Optional[str] = Query(None, alias="status"),
    page:      int = 1,
    limit:     int = 20,
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    coll = Enquiry.get_motor_collection()
    f: dict = {"is_active": True}
    if estate_id: f["estate"] = ObjectId(estate_id)
    if status_:   f["status"] = status_

    total = await coll.count_documents(f)
    skip  = (page - 1) * limit
    items = await coll.find(f).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"success": True, "data": items,
            "pagination": {"current_page": page, "total_pages": -(-total // limit), "total_items": total}}


@router.get("/{enquiry_id}")
async def get_enquiry(enquiry_id: str, user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    coll = Enquiry.get_motor_collection()
    doc  = await coll.find_one({"_id": ObjectId(enquiry_id), "is_active": True})
    if not doc:
        raise HTTPException(status_code=404, detail="Enquiry not found")
    return {"success": True, "data": doc}


@router.patch("/{enquiry_id}/status")
async def update_enquiry_status(
    enquiry_id: str, body: StatusUpdate, user: User = Depends(get_current_user)
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    coll   = Enquiry.get_motor_collection()
    result = await coll.find_one_and_update(
        {"_id": ObjectId(enquiry_id), "is_active": True},
        {"$set": {"status": body.status, "note": body.note,
                  "updated_at": datetime.utcnow(), "updated_by": user.id}},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Enquiry not found")
    return {"success": True, "message": "Enquiry status updated", "data": result}


@router.delete("/{enquiry_id}")
async def delete_enquiry(enquiry_id: str, user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    coll   = Enquiry.get_motor_collection()
    result = await coll.find_one_and_update(
        {"_id": ObjectId(enquiry_id), "is_active": True},
        {"$set": {"is_active": False, "updated_at": datetime.utcnow()}},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Enquiry not found")
    return {"success": True, "message": "Enquiry deleted successfully"}
