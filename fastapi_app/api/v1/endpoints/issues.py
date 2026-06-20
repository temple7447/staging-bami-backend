from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime
from typing import Optional
from pydantic import BaseModel

from models.issue import Issue
from models.user import User
from core.security import get_current_user
from core.database import get_db
from core.db_helpers import find_all, find_one, save, count
from models.base import gen_uuid

router = APIRouter(prefix="/issues", tags=["Issues"])
ADMIN_ROLES = {"super_admin", "admin", "super_manager", "business_owner", "manager"}


class IssueCreate(BaseModel):
    title: str
    description: str
    category: str = "other"
    priority: str = "medium"
    estate: Optional[str] = None
    unit: Optional[str] = None
    tenant: Optional[str] = None


@router.post("", status_code=201)
async def create_issue(
    body: IssueCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    issue = Issue(id=gen_uuid(), **body.model_dump(), reporter=user.id)
    await save(db, issue)
    return {"success": True, "data": _i(issue)}


@router.get("")
async def list_issues(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    estate: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conditions = [Issue.is_active == True]
    if user.role not in ADMIN_ROLES:
        conditions.append(Issue.reporter == user.id)
    if status:
        conditions.append(Issue.status == status)
    if priority:
        conditions.append(Issue.priority == priority)
    if estate:
        conditions.append(Issue.estate == estate)
    skip = (page - 1) * limit
    items = await find_all(db, Issue, *conditions,
                           order_by=Issue.created_at.desc(), skip=skip, limit=limit)
    return {"success": True, "count": len(items), "data": [_i(i) for i in items]}


@router.get("/{issue_id}")
async def get_issue(issue_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    issue = await find_one(db, Issue, Issue.id == issue_id, Issue.is_active == True)
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    return {"success": True, "data": _i(issue)}


@router.put("/{issue_id}")
async def update_issue(
    issue_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    issue = await find_one(db, Issue, Issue.id == issue_id, Issue.is_active == True)
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")

    allowed = {"title", "description", "category", "priority", "status", "stage", "assigned_to", "note"}
    for k, v in body.items():
        if k in allowed:
            setattr(issue, k, v)
    if "stage" in body:
        tl = list(issue.timeline or [])
        tl.append({"stage": body["stage"], "by": user.id, "at": datetime.utcnow().isoformat()})
        issue.timeline = tl
    issue.updated_at = datetime.utcnow()
    await save(db, issue)
    return {"success": True, "data": _i(issue)}


@router.delete("/{issue_id}")
async def delete_issue(issue_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    issue = await find_one(db, Issue, Issue.id == issue_id)
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    issue.is_active = False
    issue.updated_at = datetime.utcnow()
    await save(db, issue)
    return {"success": True, "message": "Issue deleted"}


def _i(i: Issue) -> dict:
    return {
        "id": i.id, "title": i.title, "description": i.description,
        "category": i.category, "priority": i.priority,
        "status": i.status, "stage": i.stage,
        "reporter": i.reporter, "assigned_to": i.assigned_to,
        "estate": i.estate, "unit": i.unit, "tenant": i.tenant,
        "media": i.media or [], "timeline": i.timeline or [],
        "created_at": i.created_at,
    }
