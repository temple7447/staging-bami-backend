from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from pydantic import BaseModel
from datetime import datetime

from models.user import User
from models.candidate import Candidate
from core.security import get_current_user
from core.database import get_db
from models.base import gen_uuid
from utils.time_utils import utcnow

router = APIRouter(prefix="/hr", tags=["HR"])

PIPELINE_STAGES = ["sourced", "screened", "interview", "offer", "hired", "rejected", "withdrawn"]


class CandidateCreate(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    role: str
    department: Optional[str] = None
    stage: str = "sourced"
    source: Optional[str] = None
    salary_expectation: Optional[float] = None
    offered_salary: Optional[float] = None
    cv_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    halo_score: Optional[float] = None
    skills_score: Optional[float] = None
    culture_fit_score: Optional[float] = None
    notes: Optional[str] = None
    interview_date: Optional[datetime] = None
    start_date: Optional[datetime] = None
    tags: list = []


class CandidateUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    department: Optional[str] = None
    stage: Optional[str] = None
    source: Optional[str] = None
    salary_expectation: Optional[float] = None
    offered_salary: Optional[float] = None
    halo_score: Optional[float] = None
    skills_score: Optional[float] = None
    culture_fit_score: Optional[float] = None
    notes: Optional[str] = None
    interview_date: Optional[datetime] = None
    start_date: Optional[datetime] = None
    tags: Optional[list] = None
    is_active: Optional[bool] = None


def _candidate_dict(c: Candidate) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "email": c.email,
        "phone": c.phone,
        "role": c.role,
        "department": c.department,
        "stage": c.stage,
        "source": c.source,
        "salary_expectation": c.salary_expectation,
        "offered_salary": c.offered_salary,
        "cv_url": c.cv_url,
        "portfolio_url": c.portfolio_url,
        "halo_score": c.halo_score,
        "skills_score": c.skills_score,
        "culture_fit_score": c.culture_fit_score,
        "notes": c.notes,
        "interview_date": c.interview_date.isoformat() if c.interview_date else None,
        "start_date": c.start_date.isoformat() if c.start_date else None,
        "tags": c.tags,
        "is_active": c.is_active,
        "created_at": c.created_at.isoformat(),
    }


@router.get("/candidates")
async def list_candidates(
    stage: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(Candidate).where(Candidate.owner_id == current_user.id)
    if stage:
        q = q.where(Candidate.stage == stage)
    if department:
        q = q.where(Candidate.department == department)
    q = q.order_by(Candidate.created_at.desc())
    result = await db.execute(q)
    candidates = result.scalars().all()
    return {"data": [_candidate_dict(c) for c in candidates], "total": len(candidates)}


@router.post("/candidates", status_code=201)
async def create_candidate(
    body: CandidateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    c = Candidate(id=gen_uuid(), owner_id=current_user.id, **body.model_dump())
    db.add(c)
    await db.commit()
    return {"message": "Candidate created", "id": c.id}


@router.get("/candidates/{candidate_id}")
async def get_candidate(
    candidate_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Candidate).where(Candidate.id == candidate_id, Candidate.owner_id == current_user.id)
    )
    c = result.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Candidate not found")
    return {"data": _candidate_dict(c)}


@router.put("/candidates/{candidate_id}")
async def update_candidate(
    candidate_id: str,
    body: CandidateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Candidate).where(Candidate.id == candidate_id, Candidate.owner_id == current_user.id)
    )
    c = result.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Candidate not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(c, k, v)
    c.updated_at = utcnow()
    await db.commit()
    return {"message": "Candidate updated"}


@router.delete("/candidates/{candidate_id}")
async def delete_candidate(
    candidate_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Candidate).where(Candidate.id == candidate_id, Candidate.owner_id == current_user.id)
    )
    c = result.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Candidate not found")
    await db.delete(c)
    await db.commit()
    return {"message": "Candidate deleted"}


@router.get("/pipeline")
async def hr_pipeline(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Candidate).where(Candidate.owner_id == current_user.id))
    candidates = result.scalars().all()

    pipeline: dict[str, dict] = {}
    for stage in PIPELINE_STAGES:
        stage_candidates = [c for c in candidates if c.stage == stage]
        pipeline[stage] = {
            "count": len(stage_candidates),
            "candidates": [_candidate_dict(c) for c in stage_candidates],
        }

    hired = [c for c in candidates if c.stage == "hired"]
    upcoming_interviews = [
        c for c in candidates
        if c.stage == "interview" and c.interview_date and c.interview_date >= utcnow()
    ]

    return {
        "pipeline": pipeline,
        "summary": {
            "total_candidates": len(candidates),
            "active_pipeline": len([c for c in candidates if c.stage not in ("hired", "rejected", "withdrawn")]),
            "hired_count": len(hired),
            "upcoming_interviews": len(upcoming_interviews),
        },
    }


@router.get("/overview")
async def hr_overview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Candidate).where(Candidate.owner_id == current_user.id))
    candidates = result.scalars().all()

    by_stage: dict[str, int] = {}
    by_dept: dict[str, int] = {}
    for c in candidates:
        by_stage[c.stage] = by_stage.get(c.stage, 0) + 1
        dept = c.department or "General"
        by_dept[dept] = by_dept.get(dept, 0) + 1

    return {
        "total_candidates": len(candidates),
        "by_stage": by_stage,
        "by_department": by_dept,
        "hired_this_quarter": sum(
            1 for c in candidates
            if c.stage == "hired" and c.start_date and
            c.start_date >= utcnow().replace(month=((utcnow().month - 1) // 3) * 3 + 1, day=1)
        ),
    }
