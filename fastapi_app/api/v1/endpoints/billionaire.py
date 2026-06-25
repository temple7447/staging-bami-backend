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
from datetime import datetime, date, timedelta
from typing import Optional

from models.user import User
from models.billionaire import SignalMission, TimeBlock, KingsAuditItem, TimeValueProfile
from schemas.billionaire import (
    MissionCreate, MissionUpdate, RolloverRequest,
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


# Default 18-hour schedule seeded into the Time Audit on request.
# Times are stored 24-hour "HH:MM" so string ordering == chronological order.
DEFAULT_SCHEDULE = [
    ("04:00", "Morning routine / prayer", "neutral",  "Start of 18hr window"),
    ("04:30", "Deep work — signal mission 1", "signal", "Mission 1"),
    ("06:30", "Review & plan", "reminder", "Check mission progress"),
    ("08:00", "Team comms (batched)", "noise", "Max 15 min — no reactive"),
    ("08:30", "Lead generation / signal mission", "signal", "Mission 2"),
    ("11:30", "Mid-day check", "reminder", "SNR audit — on track?"),
    ("12:30", "Email batch (15 min)", "noise", "Batch only"),
    ("13:00", "Deep work — signal mission 3", "signal", "Mission 3"),
    ("15:30", "Metrics review", "reminder", "Are missions on track?"),
    ("17:30", "Evening planning", "reminder", "Set tomorrow's 3-5 signals"),
    ("22:00", "End of 18hr window", "reminder", "Missions complete?"),
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


# ── analytics (real data — streak, SNR trend, time split) ───────────────────────

@router.get("/analytics")
async def get_analytics(
    days: int = Query(7, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    today = date.fromisoformat(_today())
    window_start = (today - timedelta(days=days - 1)).isoformat()
    streak_start = (today - timedelta(days=89)).isoformat()  # look back up to 90 days

    # All missions in the streak lookback window (covers the chart window too)
    all_missions = await find_all(
        db, SignalMission,
        SignalMission.user_id == user.id,
        SignalMission.mission_date >= streak_start,
        SignalMission.mission_date <= today.isoformat(),
    )
    by_date: dict[str, dict] = {}
    for m in all_missions:
        slot = by_date.setdefault(m.mission_date, {"total": 0, "done": 0})
        slot["total"] += 1
        if m.completed:
            slot["done"] += 1

    # Daily SNR series for the chart window
    daily = []
    win_total = win_done = 0
    for i in range(days):
        d = (today - timedelta(days=days - 1 - i)).isoformat()
        s = by_date.get(d, {"total": 0, "done": 0})
        t, dn = s["total"], s["done"]
        win_total += t
        win_done += dn
        snr = round(96 + (dn / t * 4), 1) if t else None
        daily.append({"date": d, "total": t, "done": dn, "snr": snr})

    completion_rate = round(win_done / win_total * 100, 1) if win_total else 0.0

    # Streak: consecutive days (ending today) where every mission was completed.
    # Today is skipped without breaking if nothing has been planned yet.
    streak = 0
    cursor = today
    first = True
    for _ in range(90):
        key = cursor.isoformat()
        s = by_date.get(key, {"total": 0, "done": 0})
        if s["total"] == 0:
            if first:
                cursor -= timedelta(days=1)
                first = False
                continue
            break
        if s["done"] == s["total"]:
            streak += 1
            cursor -= timedelta(days=1)
            first = False
        else:
            break

    # Time-block split across the chart window (real time audit data)
    blocks = await find_all(
        db, TimeBlock,
        TimeBlock.user_id == user.id,
        TimeBlock.block_date >= window_start,
        TimeBlock.block_date <= today.isoformat(),
    )
    time_split = {"signal": 0, "noise": 0, "reminder": 0, "neutral": 0}
    for b in blocks:
        time_split[b.block_type] = time_split.get(b.block_type, 0) + 1
    tracked = time_split["signal"] + time_split["noise"]
    time_snr = round(time_split["signal"] / tracked * 100, 1) if tracked else 0.0

    # King's audit composition
    kings = await find_all(db, KingsAuditItem, KingsAuditItem.user_id == user.id)
    kings_split = {
        "high": sum(1 for k in kings if k.bucket == "high"),
        "low": sum(1 for k in kings if k.bucket == "low"),
    }

    return {
        "success": True,
        "days": days,
        "daily": daily,
        "streak": streak,
        "completion_rate": completion_rate,
        "time_split": time_split,
        "time_snr": time_snr,
        "kings_split": kings_split,
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


@router.post("/missions/rollover", status_code=201)
async def rollover_missions(
    body: RolloverRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Carry unfinished missions from one day to another (default: today -> tomorrow)."""
    src = body.from_date or _today()
    dst = body.to_date or (date.fromisoformat(_today()) + timedelta(days=1)).isoformat()
    if src == dst:
        raise HTTPException(status_code=400, detail="Source and target dates must differ")

    incomplete = await find_all(
        db, SignalMission,
        SignalMission.user_id == user.id, SignalMission.mission_date == src,
        SignalMission.completed == False,  # noqa: E712
        order_by=SignalMission.sort_order,
    )
    existing_dst = await find_all(
        db, SignalMission,
        SignalMission.user_id == user.id, SignalMission.mission_date == dst,
    )
    slots = MAX_MISSIONS - len(existing_dst)
    if slots <= 0:
        raise HTTPException(status_code=400, detail="Target day already has 5 missions")

    created = []
    for i, m in enumerate(incomplete[:slots]):
        new = SignalMission(
            id=gen_uuid(), user_id=user.id, title=m.title, deadline=m.deadline,
            mission_date=dst, sort_order=len(existing_dst) + i,
        )
        db.add(new)
        created.append(new)
    await db.commit()
    for n in created:
        await db.refresh(n)
    return {"success": True, "carried": len(created), "date": dst, "data": [_mission_dict(m) for m in created]}


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
            delegate=[], outsource=[], automate=[], delete_list=[],
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
