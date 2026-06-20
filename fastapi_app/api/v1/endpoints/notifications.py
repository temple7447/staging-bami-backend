from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update as sa_update
from datetime import datetime

from models.user import User
from models.notification import Notification
from core.security import get_current_user
from core.database import get_db
from core.db_helpers import find_all, find_one, save, count
from models.base import gen_uuid

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("/")
async def get_notifications(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    items = await find_all(db, Notification,
                           Notification.user == user.id, Notification.is_active == True,
                           order_by=Notification.created_at.desc(), limit=50)
    unread = sum(1 for n in items if not n.is_read)
    return {"success": True, "count": len(items), "unread": unread,
            "data": [_n(n) for n in items]}


@router.get("/count")
async def get_notification_count(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    items = await find_all(db, Notification,
                           Notification.user == user.id, Notification.is_active == True,
                           Notification.is_read == False)
    return {"success": True, "count": len(items), "unread": len(items)}


@router.put("/read-all")
async def mark_all_read(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    now = datetime.utcnow()
    await db.execute(
        sa_update(Notification)
        .where(Notification.user == user.id, Notification.is_read == False)
        .values(is_read=True, read_at=now)
    )
    await db.commit()
    return {"success": True, "message": "All notifications marked as read"}


@router.put("/{nid}/read")
async def mark_read(nid: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    n = await find_one(db, Notification, Notification.id == nid, Notification.user == user.id)
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    n.is_read = True
    n.read_at = datetime.utcnow()
    await save(db, n)
    return {"success": True, "data": _n(n)}


@router.delete("/{nid}")
async def delete_notification(nid: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    n = await find_one(db, Notification, Notification.id == nid, Notification.user == user.id)
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    n.is_active = False
    await save(db, n)
    return {"success": True, "message": "Notification deleted"}


def _n(n: Notification) -> dict:
    return {
        "id": n.id, "title": n.title, "message": n.message,
        "type": n.type, "link": n.link, "is_read": n.is_read,
        "read_at": n.read_at, "created_at": n.created_at,
    }
