from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from datetime import datetime
from bson import ObjectId
from typing import Optional, List
import cloudinary, cloudinary.uploader

from models.user import User
from models.issue import Issue
from models.tenant import Tenant
from core.security import get_current_user

router = APIRouter(prefix="/issues", tags=["Issues"])

ADMIN_ROLES  = {"super_admin", "admin", "super_manager", "business_owner", "manager"}
VALID_STAGES = {"review", "started", "inprogress", "completed"}


async def _upload_files(files: list, folder: str) -> list:
    uploaded = []
    for f in files:
        data   = await f.read()
        is_vid = f.content_type.startswith("video/")
        result = cloudinary.uploader.upload(data, folder=folder,
                                              resource_type="video" if is_vid else "image")
        uploaded.append({"url": result["secure_url"], "public_id": result["public_id"],
                          "type": "video" if is_vid else "image"})
    return uploaded


@router.post("/", status_code=201)
async def create_issue(
    title:       str = Form(...),
    description: str = Form(...),
    category:    str = Form("other"),
    priority:    str = Form("medium"),
    estate_id:   Optional[str] = Form(None),
    unit_id:     Optional[str] = Form(None),
    images: List[UploadFile] = File(default=[]),
    videos: List[UploadFile] = File(default=[]),
    user: User = Depends(get_current_user),
):
    tenant = await Tenant.find_one({"user": user.id, "is_active": True})

    media = []
    all_files = [*images, *videos]
    if all_files:
        folder = "bamihustle/issues"
        media  = await _upload_files(all_files, folder)

    coll = Issue.get_motor_collection()
    doc  = {
        "title":       title,
        "description": description,
        "category":    category,
        "priority":    priority,
        "reporter":    user.id,
        "estate":      ObjectId(estate_id) if estate_id else (tenant.estate if tenant else None),
        "unit":        ObjectId(unit_id)   if unit_id   else (tenant.unit   if tenant else None),
        "tenant":      tenant.id if tenant else None,
        "status":      "open",
        "stage":       "review",
        "media":       media,
        "timeline":    [{"stage": "review", "note": "Issue submitted for review",
                          "media": [], "updated_by": str(user.id),
                          "created_at": datetime.utcnow().isoformat()}],
        "is_active":   True,
        "created_at":  datetime.utcnow(),
        "updated_at":  datetime.utcnow(),
    }
    result = await coll.insert_one(doc)
    doc["_id"] = result.inserted_id
    return {"success": True, "message": "Issue reported successfully", "data": doc}


@router.get("/")
async def get_issues(
    estate_id: Optional[str] = None,
    stage:     Optional[str] = None,
    category:  Optional[str] = None,
    page:      int = 1,
    limit:     int = 20,
    user: User = Depends(get_current_user),
):
    coll = Issue.get_motor_collection()
    f: dict = {"is_active": True}

    if user.role in ADMIN_ROLES:
        if estate_id: f["estate"] = ObjectId(estate_id)
    else:
        # Tenants and users see their own issues only
        f["reporter"] = user.id

    if stage:    f["stage"]    = stage
    if category: f["category"] = category

    total = await coll.count_documents(f)
    skip  = (page - 1) * limit
    items = await coll.find(f).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)

    return {"success": True, "data": items,
            "pagination": {"current_page": page, "total_pages": -(-total // limit), "total_items": total}}


@router.get("/{issue_id}")
async def get_issue(issue_id: str, user: User = Depends(get_current_user)):
    coll = Issue.get_motor_collection()
    doc  = await coll.find_one({"_id": ObjectId(issue_id), "is_active": True})
    if not doc:
        raise HTTPException(status_code=404, detail="Issue not found")
    return {"success": True, "data": doc}


@router.patch("/{issue_id}/status")
async def update_issue_status(
    issue_id: str,
    stage:    str = Form(...),
    note:     Optional[str] = Form(None),
    images:   List[UploadFile] = File(default=[]),
    videos:   List[UploadFile] = File(default=[]),
    user: User = Depends(get_current_user),
):
    if stage not in VALID_STAGES:
        raise HTTPException(status_code=400, detail=f"Invalid stage. Valid: {', '.join(VALID_STAGES)}")

    coll = Issue.get_motor_collection()
    doc  = await coll.find_one({"_id": ObjectId(issue_id), "is_active": True})
    if not doc:
        raise HTTPException(status_code=404, detail="Issue not found")

    media = []
    all_files = [*images, *videos]
    if all_files:
        folder = f"bamihustle/issues/{issue_id}"
        media  = await _upload_files(all_files, folder)

    timeline_entry = {"stage": stage, "note": note or f"Status advanced to {stage}",
                       "media": media, "updated_by": str(user.id),
                       "created_at": datetime.utcnow().isoformat()}

    new_status = "resolved" if stage == "completed" else "in_progress"

    result = await coll.find_one_and_update(
        {"_id": ObjectId(issue_id)},
        {"$set": {"stage": stage, "status": new_status, "updated_at": datetime.utcnow()},
         "$push": {"timeline": timeline_entry}},
        return_document=True
    )
    return {"success": True, "message": f"Issue advanced to {stage}", "data": result}


@router.patch("/{issue_id}/assign")
async def assign_issue(issue_id: str, body: dict, user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    assignee_id = body.get("assigneeId") or body.get("assignee_id")
    if not assignee_id:
        raise HTTPException(status_code=400, detail="assigneeId is required")

    coll   = Issue.get_motor_collection()
    result = await coll.find_one_and_update(
        {"_id": ObjectId(issue_id), "is_active": True},
        {"$set": {"assigned_to": ObjectId(assignee_id), "updated_at": datetime.utcnow()}},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Issue not found")
    return {"success": True, "message": "Issue assigned successfully", "data": result}


@router.delete("/{issue_id}")
async def cancel_issue(issue_id: str, user: User = Depends(get_current_user)):
    coll = Issue.get_motor_collection()
    f    = {"_id": ObjectId(issue_id), "is_active": True}
    if user.role not in ADMIN_ROLES:
        f["reporter"] = user.id  # non-admins can only cancel own issues

    result = await coll.find_one_and_update(
        f, {"$set": {"is_active": False, "status": "cancelled", "updated_at": datetime.utcnow()}},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Issue not found")
    return {"success": True, "message": "Issue cancelled successfully"}
