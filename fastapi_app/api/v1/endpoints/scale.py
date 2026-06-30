"""
Scale — the Level 7 progress system.

Operationalises the Scalable.co "7 Levels of Scale" inside Bami Host:
- Level diagnosis from live data
- L1: NPS / promoters ("Sell & Serve 10")
- L2: Growth scorecard (funnel stage metrics)
- L4: Pay-yourself-first / profit-first finance plan
"""
import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from models.user import User
from models.tenant import Tenant
from models.unit import Unit
from models.enquiry import Enquiry
from models.payment import Payment
from models.owner_finance_plan import OwnerFinancePlan
from core.security import get_current_user
from core.database import get_db
from services.agents.base import owner_estate_ids

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/scale", tags=["Scale / Level 7"])

PROMOTER_THRESHOLD = 9   # NPS 9-10 = promoter
LEVEL1_TARGET = 10       # 10 promoters to clear Level 1
LEVEL2_MONTHLY = 10000   # ~$10k/mo equivalent for the growth flywheel


# ─── helpers ──────────────────────────────────────────────────────────────────

async def _confirmed_payments(db: AsyncSession, estate_ids: list[str]) -> list[Payment]:
    rows = (await db.execute(
        select(Payment).where(
            Payment.estate.in_(estate_ids or ["__none__"]),
            Payment.payment_status.in_(["confirmed", "completed"]),
        )
    )).scalars().all()
    return rows


def _monthly_revenue(payments: list[Payment], months: int = 6) -> list[dict]:
    now = datetime.utcnow()
    buckets: dict[str, float] = {}
    for m in range(months):
        d = (now.replace(day=1) - timedelta(days=30 * m))
        buckets[d.strftime("%Y-%m")] = 0.0
    for p in payments:
        key = p.created_at.strftime("%Y-%m")
        if key in buckets:
            buckets[key] += p.amount or 0
    return [{"month": k, "revenue": v} for k, v in sorted(buckets.items())]


# ─── Level diagnosis / overview ────────────────────────────────────────────────

@router.get("/overview")
async def scale_overview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    estate_ids = await owner_estate_ids(db, current_user)
    ids = estate_ids or ["__none__"]

    # L1 — promoters
    promoters = (await db.execute(
        select(func.count()).select_from(Tenant).where(
            Tenant.estate.in_(ids), Tenant.nps_score >= PROMOTER_THRESHOLD,
        )
    )).scalar() or 0

    # L2 — months at/above the flywheel threshold
    payments = await _confirmed_payments(db, estate_ids)
    monthly = _monthly_revenue(payments, 6)
    months_hit = sum(1 for m in monthly if m["revenue"] >= LEVEL2_MONTHLY)

    # L3 — has an operating system installed? (agents producing actions)
    from models.autopilot_action import AutopilotAction
    actions = (await db.execute(
        select(func.count()).select_from(AutopilotAction).where(
            AutopilotAction.owner_id == str(current_user.id)
        )
    )).scalar() or 0

    # L4 — has a finance plan + paying themselves
    plan = (await db.execute(
        select(OwnerFinancePlan).where(OwnerFinancePlan.owner_id == str(current_user.id))
    )).scalars().first()

    # Diagnose current level = last fully-cleared level
    l1_done = promoters >= LEVEL1_TARGET
    l2_done = l1_done and months_hit >= 3
    l3_done = l2_done and actions > 0
    l4_done = l3_done and bool(plan and plan.target_monthly_salary > 0)
    current_level = 1
    for done, lvl in [(l1_done, 2), (l2_done, 3), (l3_done, 4), (l4_done, 5)]:
        if done:
            current_level = lvl

    levels = [
        {"level": 1, "name": "Sell & Serve 10", "done": l1_done,
         "progress": f"{promoters}/{LEVEL1_TARGET} promoters"},
        {"level": 2, "name": "Growth Flywheel", "done": l2_done,
         "progress": f"{months_hit}/3 months above target"},
        {"level": 3, "name": "Upgrade your OS", "done": l3_done,
         "progress": f"{actions} agent actions generated"},
        {"level": 4, "name": "Double Take-Home", "done": l4_done,
         "progress": "plan set" if (plan and plan.target_monthly_salary) else "no pay-yourself plan"},
        {"level": 5, "name": "Advisory Board", "done": False, "progress": "—"},
        {"level": 6, "name": "Acquisition", "done": False, "progress": "—"},
        {"level": 7, "name": "Hit Your Number", "done": False, "progress": "—"},
    ]
    # The owner's stated plan (their Number) from the Scalable Impact Planner
    from models.growth_plan import GrowthPlan
    gp = (await db.execute(
        select(GrowthPlan).where(GrowthPlan.owner_id == str(current_user.id))
    )).scalars().first()
    stated = {
        "has_plan": bool(gp),
        "target_revenue": gp.target_revenue if gp else None,
        "target_profit": gp.target_profit if gp else None,
        "target_valuation": gp.target_valuation if gp else None,
        "why_summary": gp.why_summary if gp else None,
    }

    return {
        "current_level": current_level,
        "levels": levels,
        "promoters": promoters,
        "promoter_target": LEVEL1_TARGET,
        "months_above_target": months_hit,
        "monthly_target": LEVEL2_MONTHLY,
        "stated_plan": stated,
    }


# ─── L1: NPS / promoters ────────────────────────────────────────────────────────

@router.get("/nps")
async def get_nps(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ids = (await owner_estate_ids(db, current_user)) or ["__none__"]
    tenants = (await db.execute(
        select(Tenant).where(Tenant.estate.in_(ids), Tenant.is_active == True)  # noqa: E712
    )).scalars().all()

    scored = [t for t in tenants if t.nps_score is not None]
    promoters = [t for t in scored if t.nps_score >= 9]
    passives = [t for t in scored if 7 <= t.nps_score <= 8]
    detractors = [t for t in scored if t.nps_score <= 6]
    nps = round((len(promoters) - len(detractors)) / len(scored) * 100) if scored else 0

    return {
        "promoters": len(promoters),
        "passives": len(passives),
        "detractors": len(detractors),
        "responses": len(scored),
        "total_tenants": len(tenants),
        "nps_score": nps,
        "target": LEVEL1_TARGET,
        "progress_pct": min(100, round(len(promoters) / LEVEL1_TARGET * 100)),
        "scores": [
            {"id": t.id, "name": t.tenant_name, "unit": t.unit_label,
             "score": t.nps_score, "connected": bool(t.telegram_id)}
            for t in tenants
        ],
    }


@router.post("/nps/request")
async def request_nps(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Send the 1-question NPS to every connected tenant via Telegram."""
    from utils.telegram_service import send_to_tenant, is_configured
    ids = (await owner_estate_ids(db, current_user)) or ["__none__"]
    tenants = (await db.execute(
        select(Tenant).where(
            Tenant.estate.in_(ids), Tenant.is_active == True,  # noqa: E712
            Tenant.telegram_id.isnot(None),
        )
    )).scalars().all()

    if not is_configured():
        raise HTTPException(503, "Telegram is not configured")

    sent = 0
    msg = ("⭐ *Quick favour* — on a scale of *0 to 10*, how likely are you to "
           "recommend us to a friend or colleague?\n\nJust reply with a number (0–10). Thank you!")
    for t in tenants:
        res = await send_to_tenant(db, t.id, msg)
        if res.get("success"):
            t.nps_asked_at = datetime.utcnow()
            # mark the tenant's bot session to capture the next numeric reply
            sent += 1
    await db.commit()
    return {"sent": sent, "total_connected": len(tenants),
            "message": f"NPS survey sent to {sent} tenants on Telegram"}


# ─── L2: Growth scorecard ───────────────────────────────────────────────────────

@router.get("/growth-scorecard")
async def growth_scorecard(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    estate_ids = await owner_estate_ids(db, current_user)
    ids = estate_ids or ["__none__"]
    now = datetime.utcnow()
    d30 = now - timedelta(days=30)

    enquiries = (await db.execute(
        select(Enquiry).where(
            and_((Enquiry.estate.in_(ids)) | (Enquiry.owner_id == str(current_user.id)))
        )
    )).scalars().all()
    units = (await db.execute(select(Unit).where(Unit.estate.in_(ids)))).scalars().all()
    tenants = (await db.execute(
        select(Tenant).where(Tenant.estate.in_(ids), Tenant.is_active == True)  # noqa: E712
    )).scalars().all()

    total_units = len(units)
    occupied = len([u for u in units if u.status == "occupied"])
    new_enq_30 = len([e for e in enquiries if e.created_at and e.created_at >= d30])
    converted = len([e for e in enquiries if e.status in ("converted", "closed")])
    new_tenants_30 = len([t for t in tenants if t.created_at and t.created_at >= d30])

    payments = await _confirmed_payments(db, estate_ids)
    monthly = _monthly_revenue(payments, 6)

    # Funnel stages with a metric each (the "growth scorecard")
    stages = [
        {"stage": "Leads (enquiries)", "metric": len(enquiries), "sub": f"{new_enq_30} new in 30d"},
        {"stage": "Pending follow-up", "metric": len([e for e in enquiries if e.status == "pending"]), "sub": "Sales agent chases these"},
        {"stage": "Converted", "metric": converted,
         "sub": f"{round(converted/len(enquiries)*100) if enquiries else 0}% conversion"},
        {"stage": "Units occupied", "metric": f"{occupied}/{total_units}",
         "sub": f"{round(occupied/total_units*100) if total_units else 0}% occupancy"},
        {"stage": "New tenants (30d)", "metric": new_tenants_30, "sub": "growth velocity"},
    ]
    # crude bottleneck = the stage with the biggest drop
    bottleneck = "Pending follow-up" if len([e for e in enquiries if e.status == "pending"]) > converted else "Leads (enquiries)"

    return {
        "stages": stages,
        "monthly_revenue": monthly,
        "occupancy_pct": round(occupied / total_units * 100) if total_units else 0,
        "conversion_pct": round(converted / len(enquiries) * 100) if enquiries else 0,
        "bottleneck": bottleneck,
        "monthly_target": LEVEL2_MONTHLY,
    }


# ─── L3: Live Company Scorecard (the OS "Common Language") ──────────────────────

def _status(value: float, good: float, warn: float, higher_is_better: bool = True) -> str:
    """Return green/amber/red for a metric vs thresholds."""
    if higher_is_better:
        return "green" if value >= good else "amber" if value >= warn else "red"
    return "green" if value <= good else "amber" if value <= warn else "red"


@router.get("/scorecard")
async def company_scorecard(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The live company scorecard: 3 evergreen (lagging) + North Star (leading)
    + per-agent (team) metrics, auto-computed from real business data."""
    estate_ids = await owner_estate_ids(db, current_user)
    ids = estate_ids or ["__none__"]
    now = datetime.utcnow()
    som = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    d30 = now - timedelta(days=30)

    payments = await _confirmed_payments(db, estate_ids)
    month_rev = sum(p.amount or 0 for p in payments if p.created_at and p.created_at >= som)

    units = (await db.execute(select(Unit).where(Unit.estate.in_(ids)))).scalars().all()
    total_units = len(units)
    occupied = len([u for u in units if u.status == "occupied"])
    occupancy = round(occupied / total_units * 100) if total_units else 0

    tenants = (await db.execute(
        select(Tenant).where(Tenant.estate.in_(ids), Tenant.is_active == True)  # noqa: E712
    )).scalars().all()
    rent_roll = sum((t.rent_amount or 0) + (t.service_charge_amount or 0) for t in tenants)
    outstanding = sum((t.rent_outstanding or 0) + (t.service_charge_outstanding or 0) for t in tenants)
    collection = round(month_rev / rent_roll * 100) if rent_roll else 0
    promoters = len([t for t in tenants if t.nps_score is not None and t.nps_score >= 9])

    enquiries = (await db.execute(
        select(Enquiry).where(and_((Enquiry.estate.in_(ids)) | (Enquiry.owner_id == str(current_user.id))))
    )).scalars().all()
    new_enq = len([e for e in enquiries if e.created_at and e.created_at >= d30])

    # Per-agent (team) output — actions in the last 30 days
    from models.autopilot_action import AutopilotAction
    acts = (await db.execute(
        select(AutopilotAction.skill, func.count()).where(
            AutopilotAction.owner_id == str(current_user.id),
            AutopilotAction.created_at >= d30,
        ).group_by(AutopilotAction.skill)
    )).all()
    by_skill = {s: n for s, n in acts}

    evergreen = [
        {"label": "Revenue (this month)", "value": f"₦{month_rev:,.0f}",
         "status": _status(month_rev, LEVEL2_MONTHLY, LEVEL2_MONTHLY * 0.5)},
        {"label": "Monthly rent roll", "value": f"₦{rent_roll:,.0f}", "status": "green"},
        {"label": "Outstanding", "value": f"₦{outstanding:,.0f}",
         "status": _status(outstanding, rent_roll * 0.1, rent_roll * 0.3, higher_is_better=False)},
    ]
    north_star = [
        {"label": "Occupancy", "value": f"{occupancy}%", "status": _status(occupancy, 90, 70)},
        {"label": "Collection rate", "value": f"{collection}%", "status": _status(collection, 90, 70)},
        {"label": "New enquiries (30d)", "value": new_enq, "status": _status(new_enq, 5, 1)},
        {"label": "Promoters", "value": f"{promoters}/{LEVEL1_TARGET}", "status": _status(promoters, LEVEL1_TARGET, 5)},
    ]
    teams = [
        {"team": "🎨 Designer", "metric": by_skill.get("designer", 0)},
        {"team": "📣 Marketer", "metric": by_skill.get("marketer", 0)},
        {"team": "💼 Sales", "metric": by_skill.get("sales", 0)},
        {"team": "💰 Finance", "metric": by_skill.get("finance", 0)},
        {"team": "🔧 Operations", "metric": by_skill.get("operations", 0)},
        {"team": "👥 HR", "metric": by_skill.get("hr", 0)},
    ]
    return {"evergreen": evergreen, "north_star": north_star, "teams": teams,
            "as_of": now.strftime("%d %b %Y")}


# ─── L3: Value Engine map (the OS "Algorithms" — your machine, visualised) ──────

@router.get("/value-engines")
async def value_engines(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The property business as two value engines (Growth + Fulfillment) with
    live data at each stage and which AI agent automates each power stage."""
    estate_ids = await owner_estate_ids(db, current_user)
    ids = estate_ids or ["__none__"]
    now = datetime.utcnow()
    som = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    units = (await db.execute(select(Unit).where(Unit.estate.in_(ids)))).scalars().all()
    vacant = len([u for u in units if u.status == "vacant"])
    occupied = len([u for u in units if u.status == "occupied"])

    enquiries = (await db.execute(
        select(Enquiry).where(and_((Enquiry.estate.in_(ids)) | (Enquiry.owner_id == str(current_user.id))))
    )).scalars().all()
    pending_enq = len([e for e in enquiries if e.status == "pending"])
    converted = len([e for e in enquiries if e.status in ("converted", "closed")])

    tenants = (await db.execute(
        select(Tenant).where(Tenant.estate.in_(ids), Tenant.is_active == True)  # noqa: E712
    )).scalars().all()
    overdue = len([t for t in tenants if (t.rent_outstanding or 0) + (t.service_charge_outstanding or 0) > 0])
    promoters = len([t for t in tenants if t.nps_score is not None and t.nps_score >= 9])

    from models.issue import Issue
    open_issues = (await db.execute(
        select(func.count()).select_from(Issue).where(
            Issue.estate.in_(ids), Issue.status.in_(["open", "pending", "in_progress"]),
        )
    )).scalar() or 0

    payments = await _confirmed_payments(db, estate_ids)
    month_rev = sum(p.amount or 0 for p in payments if p.created_at and p.created_at >= som)

    growth = {
        "name": "Growth Engine",
        "subtitle": "Acquire & convert tenants",
        "stages": [
            {"name": "Vacant units", "metric": vacant, "agent": "designer", "agent2": "marketer", "power": True},
            {"name": "Enquiries (leads)", "metric": len(enquiries), "agent": "sales", "power": True},
            {"name": "In follow-up", "metric": pending_enq, "agent": "sales", "power": False},
            {"name": "Converted", "metric": converted, "agent": None, "power": False},
            {"name": "Occupied units", "metric": occupied, "agent": None, "power": False, "terminus": True},
        ],
    }
    fulfillment = {
        "name": "Fulfillment Engine",
        "subtitle": "Deliver the promise & keep tenants",
        "stages": [
            {"name": "Active tenants", "metric": len(tenants), "agent": None, "power": False},
            {"name": "Rent overdue", "metric": overdue, "agent": "finance", "power": True},
            {"name": "Collected (mo)", "metric": f"₦{month_rev:,.0f}", "agent": "finance", "power": False},
            {"name": "Open issues", "metric": open_issues, "agent": "operations", "power": True},
            {"name": "Promoters", "metric": promoters, "agent": None, "power": False, "terminus": True},
        ],
    }
    return {"engines": [growth, fulfillment]}


# ─── L3/L5: High Output Team Canvas (accountability) + HR hiring signal ─────────

# Each AI agent's Critical Accountability Bullet (the power stage it owns)
_AGENT_CAB = {
    "designer": "Design listing marketing graphics",
    "marketer": "Market vacant units (posts & blasts)",
    "sales": "Follow up & convert enquiries",
    "finance": "Collect rent & chase overdue",
    "operations": "Resolve maintenance issues (assign vendors)",
    "hr": "Flag when it's time to hire",
}


@router.get("/team-canvas")
async def team_canvas(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """High Output Team Canvas — who owns each critical function. In Bami Host the
    AI agents are team members owning the power stages; humans + the HR hiring
    signal complete the picture."""
    from services.agents import AGENT_META
    from models.autopilot_action import AutopilotAction
    from models.candidate import Candidate

    uid = str(current_user.id)
    now = datetime.utcnow()
    d30 = now - timedelta(days=30)
    estate_ids = await owner_estate_ids(db, current_user)

    # AI agent team — each agent + its accountability + 30d output
    acts = (await db.execute(
        select(AutopilotAction.skill, func.count()).where(
            AutopilotAction.owner_id == uid, AutopilotAction.created_at >= d30,
        ).group_by(AutopilotAction.skill)
    )).all()
    by_skill = {s: n for s, n in acts}
    agents = [{
        "key": m.key, "name": m.name, "emoji": m.emoji,
        "accountability": _AGENT_CAB.get(m.key, m.description),
        "output_30d": by_skill.get(m.key, 0),
    } for m in AGENT_META.values()]

    # Human team — the owner + direct reports / managers
    humans = [{"name": current_user.name, "role": current_user.role, "is_owner": True,
               "estates": len(estate_ids)}]
    reports = (await db.execute(
        select(User).where(User.manager == uid, User.is_active == True)  # noqa: E712
    )).scalars().all()
    for r in reports:
        humans.append({"name": r.name, "role": r.role, "is_owner": False,
                       "estates": len(r.assigned_estates or [])})

    # HR hiring signal (mirrors the HR agent)
    tenant_count = (await db.execute(
        select(func.count()).select_from(Tenant).where(
            Tenant.estate.in_(estate_ids or ["__none__"]), Tenant.is_active == True,  # noqa: E712
        )
    )).scalar() or 0
    HIRE_THRESHOLD = 15
    hiring = {
        "active_tenants": tenant_count,
        "threshold": HIRE_THRESHOLD,
        "should_hire": tenant_count >= HIRE_THRESHOLD,
        "message": (f"You manage {tenant_count} tenants — past {HIRE_THRESHOLD}, consider hiring support."
                    if tenant_count >= HIRE_THRESHOLD
                    else f"{tenant_count}/{HIRE_THRESHOLD} tenants — your AI agents cover the load for now."),
    }

    # Candidate pipeline (HR)
    cands = (await db.execute(
        select(Candidate.stage, func.count()).where(Candidate.owner_id == uid).group_by(Candidate.stage)
    )).all()
    pipeline = {stage: n for stage, n in cands}

    return {"agents": agents, "humans": humans, "hiring": hiring,
            "candidate_pipeline": pipeline, "candidate_total": sum(pipeline.values())}


# ─── L4: Pay-yourself-first / finance plan ──────────────────────────────────────

class FinancePlanBody(BaseModel):
    target_monthly_salary: Optional[float] = None
    living_expenses: Optional[float] = None
    target_profit_pct: Optional[float] = None
    emergency_fund_target: Optional[float] = None
    emergency_fund_current: Optional[float] = None
    expense_ratios: Optional[dict] = None


@router.get("/finance-plan")
async def get_finance_plan(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    plan = (await db.execute(
        select(OwnerFinancePlan).where(OwnerFinancePlan.owner_id == str(current_user.id))
    )).scalars().first()

    estate_ids = await owner_estate_ids(db, current_user)
    payments = await _confirmed_payments(db, estate_ids)
    monthly = _monthly_revenue(payments, 3)
    avg_monthly_rev = round(sum(m["revenue"] for m in monthly) / max(1, len(monthly)))

    if not plan:
        return {
            "exists": False,
            "target_monthly_salary": 0, "living_expenses": 0,
            "target_profit_pct": 20.0, "emergency_fund_target": 0,
            "emergency_fund_current": 0, "expense_ratios": {},
            "avg_monthly_revenue": avg_monthly_rev,
            "recommended_salary": 0, "emergency_fund_pct": 0,
        }

    recommended_salary = round(plan.living_expenses * 1.15) if plan.living_expenses else 0
    ef_pct = round(plan.emergency_fund_current / plan.emergency_fund_target * 100) \
        if plan.emergency_fund_target else 0
    return {
        "exists": True,
        "target_monthly_salary": plan.target_monthly_salary,
        "living_expenses": plan.living_expenses,
        "target_profit_pct": plan.target_profit_pct,
        "emergency_fund_target": plan.emergency_fund_target,
        "emergency_fund_current": plan.emergency_fund_current,
        "expense_ratios": plan.expense_ratios or {},
        "avg_monthly_revenue": avg_monthly_rev,
        "recommended_salary": recommended_salary,
        "salary_gap": round(recommended_salary - plan.target_monthly_salary),
        "emergency_fund_pct": min(100, ef_pct),
    }


@router.put("/finance-plan")
async def update_finance_plan(
    body: FinancePlanBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models.base import gen_uuid
    plan = (await db.execute(
        select(OwnerFinancePlan).where(OwnerFinancePlan.owner_id == str(current_user.id))
    )).scalars().first()
    if not plan:
        plan = OwnerFinancePlan(id=gen_uuid(), owner_id=str(current_user.id))
        db.add(plan)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(plan, k, v)
    plan.updated_at = datetime.utcnow()
    await db.commit()
    return {"success": True}
