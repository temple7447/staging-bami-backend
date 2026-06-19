from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime
from bson import ObjectId
from pydantic import BaseModel
from typing import Optional

from models.user import User
from models.service_request import ServiceRequest
from models.tenant import Tenant
from core.security import get_current_user

router = APIRouter(prefix="/service-requests", tags=["Service Requests"])

ADMIN_ROLES  = {"super_admin", "admin", "super_manager", "business_owner", "manager"}
VENDOR_ROLES = {"vendor", "super_vendor"}


class ServiceRequestCreate(BaseModel):
    title:       str
    description: str
    category:    Optional[str] = "general"
    priority:    Optional[str] = "medium"
    estate_id:   Optional[str] = None
    unit_id:     Optional[str] = None


class StatusUpdate(BaseModel):
    status: str
    note:   Optional[str] = None


@router.post("/", status_code=201)
async def create_service_request(body: ServiceRequestCreate, user: User = Depends(get_current_user)):
    tenant = await Tenant.find_one({"user": user.id, "is_active": True})
    coll   = ServiceRequest.get_motor_collection()
    doc    = {
        "title":       body.title,
        "description": body.description,
        "category":    body.category,
        "priority":    body.priority,
        "requester":   user.id,
        "estate":      ObjectId(body.estate_id) if body.estate_id else (tenant.estate if tenant else None),
        "unit":        ObjectId(body.unit_id)   if body.unit_id   else (tenant.unit   if tenant else None),
        "tenant":      tenant.id if tenant else None,
        "status":      "pending",
        "is_active":   True,
        "created_at":  datetime.utcnow(),
        "updated_at":  datetime.utcnow(),
    }
    result = await coll.insert_one(doc)
    doc["_id"] = result.inserted_id
    return {"success": True, "message": "Service request created", "data": doc}


@router.get("/my-requests")
async def get_my_requests(
    page: int = 1, limit: int = 20,
    user: User = Depends(get_current_user),
):
    coll  = ServiceRequest.get_motor_collection()
    f     = {"requester": user.id, "is_active": True}
    total = await coll.count_documents(f)
    items = await coll.find(f).sort("created_at", -1).skip((page-1)*limit).limit(limit).to_list(limit)
    return {"success": True, "data": items,
            "pagination": {"current_page": page, "total_pages": -(-total // limit), "total_items": total}}


@router.get("/vendor-tasks")
async def get_vendor_tasks(
    page: int = 1, limit: int = 20,
    user: User = Depends(get_current_user),
):
    if user.role not in VENDOR_ROLES and user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Vendors and admins only")

    coll  = ServiceRequest.get_motor_collection()
    f: dict = {"is_active": True}
    if user.role in VENDOR_ROLES:
        f["assigned_to"] = user.id
    total = await coll.count_documents(f)
    items = await coll.find(f).sort("created_at", -1).skip((page-1)*limit).limit(limit).to_list(limit)
    return {"success": True, "data": items,
            "pagination": {"current_page": page, "total_pages": -(-total // limit), "total_items": total}}


@router.put("/{request_id}/status")
async def update_service_request_status(
    request_id: str, body: StatusUpdate, user: User = Depends(get_current_user)
):
    coll   = ServiceRequest.get_motor_collection()
    result = await coll.find_one_and_update(
        {"_id": ObjectId(request_id), "is_active": True},
        {"$set": {"status": body.status, "note": body.note, "updated_at": datetime.utcnow(),
                  "updated_by": user.id}},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Service request not found")
    return {"success": True, "message": "Status updated", "data": result}
