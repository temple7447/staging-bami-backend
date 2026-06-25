"""
Billionaire OS — personal 18-hour execution system.

Per-user productivity endpoints:
  /api/billionaire/summary          dashboard SNR + counts
  /api/billionaire/missions         signal missions (3-5/day)
  /api/billionaire/time-blocks      time-audit calendar
  /api/billionaire/kings-audit      80/20 worksheet
  /api/billionaire/time-value       hourly-rate calculator + action lists
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, date
from typing import Optional

from models.user import User
from models.billionaire import SignalMission, TimeBlock, KingsAuditItem, TimeValueProfile
from schemas.billionaire import (
    MissionCreate, MissionUpdate,
    TimeBlockCreate, TimeBlockUpdate, SeedRequest,
    KingsAuditCreate, TimeValueUpdate,
)
from core.security import get_current_user
from core.database import get_db
from core.db_helpers import find_one, find_all, save
from models.base import gen_uuid

router = APIRouter(prefix="/billionaire", tags=["Billionaire OS"])

WINDOW_HOURS = 18
MAX_MISSIONS = 5


def _today() -> str:
    return date.today().isoformat()


# Default 18-hour schedule seeded into the Time Audit on request
DEFAULT_SCHEDULE = [
    ("4:00 AM",  "Morning routine / prayer", "neutral",  "Start of 18hr window"),
    ("4:30 AM",  "Deep work — signal mission 1", "signal", "Mission 1"),
    ("6:30 AM",  "Review & plan", "reminder", "Check mission progress"),
    ("8:00 AM",  "Team comms (batched)", "noise", "Max 15 min — no reactive"),
    ("8:30 AM",  "Lead generation / signal mission", "signal", "Mission 2"),
    ("11:30 AM", "Mid-day check", "reminder", "SNR audit — on track?"),
    ("12:30 PM", "Email batch (15 min)", "noise", "Batch only"),
    ("1:00 PM",  "Deep work — signal mission 3", "signal", "Mission 3"),
    ("3:30 PM",  "Metrics review", "reminder", "Are missions on track?"),
    ("5:30 PM",  "Evening planning", "reminder", "Set tomorrow's 3-5 signals"),
    ("10:00 PM", "End of 18hr window", "reminder", "Missions complete?"),
]

DEFAULT_KINGS_AUDIT = {
    "low": [
        "Checking emails", "Running errands", "Customer support",
        "Checking stats", "Cooking / cleaning", "Writing proposals",
    ],
    "high": [
        "Making sales calls", "Following up leads", "Generating leads",
        "Writing sales copy", "Building sales funnels", "Shooting videos",
    ],
}


# ── serializers ─────────────────────────────────────────────────────────────────

def _mission_dict(m: SignalMission) -> dict:
    return {
        "id": m.id,
        "title": m.title,
        "deadline": m.deadline,
        "completed": m.completed,
        "mission_date": m.mission_date,
        "sort_order": m.sort_order,
        "created_at": m.created_at,
    }


def _block_dict(b: TimeBlock) -> dict:
    return {
        "id": b.id,
        "block_date": b.block_date,
        "time_label": b.time_label,
        "activity": b.activity,
        "block_type": b.block_type,
        "note": b.note,
    }


def _kings_dict(k: KingsAuditItem) -> dict:
    return {"id": k.id, "bucket": k.bucket, "text": k.text}


def _profile_dict(p: TimeValueProfile) -> dict:
    hourly = (p.weekly_income / p.weekly_hours) if p.weekly_hours else 0.0
    return {
        "weekly_hours": p.weekly_hours,
        "weekly_income": p.weekly_income,
        "hourly_rate": round(hourly, 2),
        "outsource_threshold": round(hourly / 2, 2),
        "delegate": p.delegate or [],
        "outsource": p.outsource or [],
        "automate": p.automate or [],
        "delete": p.delete_list or [],
    }


# ── dashboard summary ───────────────────────────────────────────────────────────

@router.get("/summary")
async def get_summary(
    day: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    d = day or _today()
    missions = await find_all(
        db, SignalMission,
        SignalMission.user_id == user.id, SignalMission.mission_date == d,
        order_by=SignalMission.sort_order,
    )
    total = len(missions)
    done = sum(1 for m in missions if m.completed)

    # SNR starts at 96% and tracks toward 100% as the day's missions complete
    snr = 96 + (done / total * 4) if total else 96

    return {
        "success": True,
        "date": d,
        "window_hours": WINDOW_HOURS,
        "missions_total": total,
        "missions_done": done,
        "snr_score": round(snr, 1),
        "missions": [_mission_dict(m) for m in missions],
    }


# ── signal missions ─────────────────────────────────────────────────────────────

@router.get("/missions")
async def list_missions(
    day: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    d = day or _today()
    missions = await find_all(
        db, SignalMission,
        SignalMission.user_id == user.id, SignalMission.mission_date == d,
        order_by=SignalMission.sort_order,
    )
    return {"success": True, "date": d, "data": [_mission_dict(m) for m in missions]}


@router.post("/missions", status_code=201)
async def create_mission(
    body: MissionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    d = body.mission_date or _today()
    existing = await find_all(
        db, SignalMission,
        SignalMission.user_id == user.id, SignalMission.mission_date == d,
    )
    if len(existing) >= MAX_MISSIONS:
        raise HTTPException(
            status_code=400,
            detail="Maximum of 5 signal missions per day. Protect your focus — remove one first.",
        )
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Mission title is required")

    mission = SignalMission(
        id=gen_uuid(), user_id=user.id, title=title,
        deadline=(body.deadline or None), mission_date=d,
        sort_order=len(existing),
    )
    await save(db, mission)
    return {"success": True, "data": _mission_dict(mission)}


@router.patch("/missions/{mid}")
async def update_mission(
    mid: str,
    body: MissionUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    mission = await find_one(db, SignalMission, SignalMission.id == mid, SignalMission.user_id == user.id)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")
    if body.title is not None:
        mission.title = body.title.strip()
    if body.deadline is not None:
        mission.deadline = body.deadline or None
    if body.completed is not None:
        mission.completed = body.completed
    await save(db, mission)
    return {"success": True, "data": _mission_dict(mission)}


@router.delete("/missions/{mid}")
async def delete_mission(
    mid: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    mission = await find_one(db, SignalMission, SignalMission.id == mid, SignalMission.user_id == user.id)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")
    await db.delete(mission)
    await db.commit()
    return {"success": True}


# ── time-audit blocks ───────────────────────────────────────────────────────────

@router.get("/time-blocks")
async def list_time_blocks(
    day: Optional[str] = Query(None),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conds = [TimeBlock.user_id == user.id]
    if start and end:
        conds.append(TimeBlock.block_date >= start)
        conds.append(TimeBlock.block_date <= end)
    else:
        conds.append(TimeBlock.block_date == (day or _today()))
    blocks = await find_all(db, TimeBlock, *conds, order_by=TimeBlock.time_label)
    return {"success": True, "data": [_block_dict(b) for b in blocks]}


@router.post("/time-blocks", status_code=201)
async def create_time_block(
    body: TimeBlockCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    block = TimeBlock(
        id=gen_uuid(), user_id=user.id,
        block_date=(body.block_date or _today()),
        time_label=body.time_label, activity=body.activity,
        block_type=(body.block_type or "neutral"), note=(body.note or None),
    )
    await save(db, block)
    return {"success": True, "data": _block_dict(block)}


@router.patch("/time-blocks/{bid}")
async def update_time_block(
    bid: str,
    body: TimeBlockUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    block = await find_one(db, TimeBlock, TimeBlock.id == bid, TimeBlock.user_id == user.id)
    if not block:
        raise HTTPException(status_code=404, detail="Time block not found")
    if body.time_label is not None:
        block.time_label = body.time_label
    if body.activity is not None:
        block.activity = body.activity
    if body.block_type is not None:
        block.block_type = body.block_type
    if body.note is not None:
        block.note = body.note or None
    await save(db, block)
    return {"success": True, "data": _block_dict(block)}


@router.delete("/time-blocks/{bid}")
async def delete_time_block(
    bid: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    block = await find_one(db, TimeBlock, TimeBlock.id == bid, TimeBlock.user_id == user.id)
    if not block:
        raise HTTPException(status_code=404, detail="Time block not found")
    await db.delete(block)
    await db.commit()
    return {"success": True}


@router.post("/time-blocks/seed", status_code=201)
async def seed_time_blocks(
    body: SeedRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Populate the default 18-hour schedule for a given date (only if empty)."""
    d = body.block_date or _today()
    existing = await find_all(
        db, TimeBlock, TimeBlock.user_id == user.id, TimeBlock.block_date == d,
    )
    if existing:
        raise HTTPException(status_code=400, detail="This day already has time blocks")
    created = []
    for time_label, activity, block_type, note in DEFAULT_SCHEDULE:
        block = TimeBlock(
            id=gen_uuid(), user_id=user.id, block_date=d,
            time_label=time_label, activity=activity, block_type=block_type, note=note,
        )
        db.add(block)
        created.append(block)
    await db.commit()
    return {"success": True, "data": [_block_dict(b) for b in created]}


# ── king's audit (80/20 worksheet) ──────────────────────────────────────────────

@router.get("/kings-audit")
async def list_kings_audit(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    items = await find_all(db, KingsAuditItem, KingsAuditItem.user_id == user.id,
                           order_by=KingsAuditItem.created_at)
    return {
        "success": True,
        "low": [_kings_dict(i) for i in items if i.bucket == "low"],
        "high": [_kings_dict(i) for i in items if i.bucket == "high"],
    }


@router.post("/kings-audit", status_code=201)
async def create_kings_audit(
    body: KingsAuditCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if body.bucket not in ("low", "high"):
        raise HTTPException(status_code=400, detail="bucket must be 'low' or 'high'")
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Activity text is required")
    item = KingsAuditItem(id=gen_uuid(), user_id=user.id, bucket=body.bucket, text=text)
    await save(db, item)
    return {"success": True, "data": _kings_dict(item)}


@router.delete("/kings-audit/{iid}")
async def delete_kings_audit(
    iid: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    item = await find_one(db, KingsAuditItem, KingsAuditItem.id == iid, KingsAuditItem.user_id == user.id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    await db.delete(item)
    await db.commit()
    return {"success": True}


@router.post("/kings-audit/seed", status_code=201)
async def seed_kings_audit(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    existing = await find_all(db, KingsAuditItem, KingsAuditItem.user_id == user.id)
    if existing:
        raise HTTPException(status_code=400, detail="King's Audit already populated")
    for bucket, items in DEFAULT_KINGS_AUDIT.items():
        for text in items:
            db.add(KingsAuditItem(id=gen_uuid(), user_id=user.id, bucket=bucket, text=text))
    await db.commit()
    return await list_kings_audit(db=db, user=user)


# ── time-value profile ──────────────────────────────────────────────────────────

async def _get_or_create_profile(db: AsyncSession, user: User) -> TimeValueProfile:
    profile = await find_one(db, TimeValueProfile, TimeValueProfile.user_id == user.id)
    if not profile:
        profile = TimeValueProfile(
            id=gen_uuid(), user_id=user.id,
            delegate=["Email management", "Customer support", "Scheduling", "Data entry"],
            outsource=["House cleaning", "Meal prep", "Bookkeeping", "Running errands"],
            automate=["Email follow-up sequences", "Lead capture forms", "Social media posting"],
            delete_list=["Scrolling social media", "Unnecessary meetings", "Busywork"],
        )
        await save(db, profile)
    return profile


@router.get("/time-value")
async def get_time_value(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    profile = await _get_or_create_profile(db, user)
    return {"success": True, "data": _profile_dict(profile)}


@router.put("/time-value")
async def update_time_value(
    body: TimeValueUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    profile = await _get_or_create_profile(db, user)
    if body.weekly_hours is not None:
        profile.weekly_hours = max(0.0, body.weekly_hours)
    if body.weekly_income is not None:
        profile.weekly_income = max(0.0, body.weekly_income)
    if body.delegate is not None:
        profile.delegate = body.delegate
    if body.outsource is not None:
        profile.outsource = body.outsource
    if body.automate is not None:
        profile.automate = body.automate
    if body.delete is not None:
        profile.delete_list = body.delete
    await save(db, profile)
    return {"success": True, "data": _profile_dict(profile)}
