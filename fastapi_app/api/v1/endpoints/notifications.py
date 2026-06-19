from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime
from bson import ObjectId
from typing import Optional

from models.user import User
from models.notification import Notification
from core.security import get_current_user

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("/count")
async def get_notification_count(user: User = Depends(get_current_user)):
    coll  = Notification.get_motor_collection()
    count = await coll.count_documents({"user": user.id, "is_read": False, "is_active": True})
    return {"success": True, "unread_count": count}


@router.get("/")
async def get_notifications(
    is_read: Optional[bool] = None,
    limit:   int = 50,
    user: User = Depends(get_current_user),
):
    coll = Notification.get_motor_collection()
    f: dict = {"user": user.id, "is_active": True}
    if is_read is not None:
        f["is_read"] = is_read

    items = await coll.find(f).sort("created_at", -1).limit(limit).to_list(limit)
    unread = await coll.count_documents({"user": user.id, "is_read": False, "is_active": True})
    return {"success": True, "count": len(items), "unread_count": unread, "data": items}


@router.put("/read-all")
async def mark_all_as_read(user: User = Depends(get_current_user)):
    coll   = Notification.get_motor_collection()
    result = await coll.update_many(
        {"user": user.id, "is_read": False, "is_active": True},
        {"$set": {"is_read": True, "read_at": datetime.utcnow()}}
    )
    return {"success": True, "message": f"{result.modified_count} notifications marked as read"}


@router.put("/{notification_id}/read")
async def mark_as_read(notification_id: str, user: User = Depends(get_current_user)):
    coll   = Notification.get_motor_collection()
    result = await coll.find_one_and_update(
        {"_id": ObjectId(notification_id), "user": user.id, "is_active": True},
        {"$set": {"is_read": True, "read_at": datetime.utcnow()}},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"success": True, "data": result}


@router.delete("/{notification_id}")
async def delete_notification(notification_id: str, user: User = Depends(get_current_user)):
    coll   = Notification.get_motor_collection()
    result = await coll.find_one_and_update(
        {"_id": ObjectId(notification_id), "user": user.id},
        {"$set": {"is_active": False}},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"success": True, "message": "Notification deleted successfully"}
