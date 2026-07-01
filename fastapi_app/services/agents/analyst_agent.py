"""Analyst agent — the weekly plain-English portfolio report.

Every scan it reads the whole portfolio (occupancy, revenue run-rate, arrears,
satisfaction) and writes one clear briefing the owner can read in 30 seconds:
where things stand, the biggest risk, and the single next best action. This is
the "Company Scorecard" turned into a sentence.
"""
from datetime import datetime

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.tenant import Tenant
from models.unit import Unit
from models.user import User
from models.autopilot_action import AutopilotAction
from services.agents.base import AgentMeta, ai_text, make_action, owner_estate_ids

META = AgentMeta(
    key="analyst",
    name="Analyst",
    emoji="📊",
    description="Writes a weekly plain-English portfolio report: occupancy, revenue, top risk, next best action.",
    # A read-only summary sent to the owner is always safe to auto-run.
    auto_safe=["weekly_report"],
)


async def scan(db: AsyncSession, user: User) -> list[AutopilotAction]:
    uid = str(user.id)
    estate_ids = await owner_estate_ids(db, user)
    if not estate_ids:
        return []

    # Occupancy from units
    unit_rows = (await db.execute(
        select(Unit.status, func.count()).where(
            Unit.estate.in_(estate_ids), Unit.is_active == True,  # noqa: E712
        ).group_by(Unit.status)
    )).all()
    unit_counts = {str(s): int(c) for s, c in unit_rows}
    total_units = sum(unit_counts.values())
    occupied = unit_counts.get("occupied", 0)
    vacant = total_units - occupied
    occupancy_pct = round(occupied / total_units * 100) if total_units else 0

    # Tenants: count, recurring rent run-rate, arrears, satisfaction
    active_tenants = (await db.execute(
        select(func.count()).select_from(Tenant).where(
            Tenant.estate.in_(estate_ids), Tenant.is_active == True,  # noqa: E712
        )
    )).scalar() or 0

    monthly_rent = (await db.execute(
        select(func.coalesce(func.sum(Tenant.rent_amount), 0.0)).where(
            Tenant.estate.in_(estate_ids), Tenant.is_active == True,  # noqa: E712
        )
    )).scalar() or 0.0

    arrears = (await db.execute(
        select(func.coalesce(func.sum(Tenant.rent_outstanding + Tenant.service_charge_outstanding), 0.0)).where(
            Tenant.estate.in_(estate_ids), Tenant.is_active == True,  # noqa: E712
        )
    )).scalar() or 0.0

    overdue_count = (await db.execute(
        select(func.count()).select_from(Tenant).where(
            Tenant.estate.in_(estate_ids), Tenant.is_active == True,  # noqa: E712
            (Tenant.rent_outstanding + Tenant.service_charge_outstanding) > 0,
        )
    )).scalar() or 0

    avg_nps = (await db.execute(
        select(func.avg(Tenant.nps_score)).where(
            Tenant.estate.in_(estate_ids), Tenant.nps_score.is_not(None),
        )
    )).scalar()
    avg_nps = round(float(avg_nps), 1) if avg_nps is not None else None

    ctx = {
        "estates": len(estate_ids), "total_units": total_units, "occupied": occupied,
        "vacant": vacant, "occupancy_pct": occupancy_pct, "active_tenants": active_tenants,
        "monthly_rent": f"₦{monthly_rent:,.0f}", "arrears": f"₦{arrears:,.0f}",
        "overdue_count": overdue_count, "avg_nps": avg_nps,
        "as_of": datetime.utcnow().strftime("%Y-%m-%d"),
    }

    report = await ai_text(
        "You are a portfolio analyst for a Nigerian property owner. Using the numbers, write a short "
        "weekly briefing (max 120 words) in plain English: 1) one-line summary of health, 2) the single "
        "biggest risk right now, 3) the ONE next best action this week. Be specific and encouraging.",
        f"Estates: {len(estate_ids)}. Units: {total_units} ({occupied} occupied, {vacant} vacant, "
        f"{occupancy_pct}% occupancy). Active tenants: {active_tenants}. Monthly rent run-rate: "
        f"₦{monthly_rent:,.0f}. Arrears: ₦{arrears:,.0f} across {overdue_count} tenants. "
        f"Avg satisfaction (NPS): {avg_nps if avg_nps is not None else 'no responses yet'}.",
        max_tokens=350)

    priority = "high" if (overdue_count and arrears > 0) or occupancy_pct < 70 else "medium"
    return [make_action(
        uid, "analyst", "weekly_report",
        f"Weekly portfolio report — {occupancy_pct}% occupied · ₦{arrears:,.0f} arrears",
        "Your Analyst reviewed the whole portfolio and wrote this week's briefing.",
        report, "telegram", "weekly_review", ctx, priority=priority, auto_execute=True)]
