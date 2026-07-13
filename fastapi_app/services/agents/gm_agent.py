"""GM agent — Gbenga, the General Manager / Chief of Staff.

Every other agent understands one slice of the business; the owner cannot be
expected to assemble twelve slices into a picture every morning. Gbenga's job
is the whole: he runs LAST, after the entire team, reads what every agent just
produced plus the company vitals, and writes ONE "State of the Company"
briefing — where the business stands, what the team found, and the few things
that genuinely need the owner's decision today. He chases; he does not decide.
"""
from datetime import timedelta

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.tenant import Tenant
from models.unit import Unit
from models.user import User
from models.autopilot_action import AutopilotAction
from services.agents.base import (
    AgentMeta, ai_analyze, make_action, owner_estate_ids, active_business_lines, SONNET,
)
from utils.time_utils import utcnow

META = AgentMeta(
    key="gm",
    name="Gbenga · GM",
    emoji="🧭",
    description="The General Manager — reads every agent's output and the company vitals, then writes one State of the Company briefing with what needs the owner today.",
    # A read-only executive summary is always safe to deliver automatically.
    auto_safe=["state_of_company"],
    business_line="Company-wide",
)


async def scan(db: AsyncSession, user: User,
               team_actions: "list[AutopilotAction] | None" = None) -> list[AutopilotAction]:
    """Runs after the rest of the team; `team_actions` is everything they just
    produced this run (passed by the orchestrator, since none of it is in the
    DB yet when this scan executes)."""
    uid = str(user.id)
    estate_ids = await owner_estate_ids(db, user)
    if not estate_ids:
        return []

    now = utcnow()
    team_actions = team_actions or []

    # ── The team's desk: what every agent just put on the table ──────────
    by_agent: dict[str, list[AutopilotAction]] = {}
    for a in team_actions:
        by_agent.setdefault(a.skill, []).append(a)

    desk_lines = []
    urgent: list[str] = []
    for skill, items in sorted(by_agent.items()):
        highs = [a for a in items if a.priority == "high"]
        desk_lines.append(f"{skill}: {len(items)} item(s)"
                          + (f", {len(highs)} HIGH — {'; '.join(a.title for a in highs[:2])}" if highs else ""))
        urgent.extend(a.title for a in highs)

    # ── Company vitals (the numbers behind the words) ─────────────────────
    unit_rows = (await db.execute(
        select(Unit.status, func.count()).where(
            Unit.estate.in_(estate_ids), Unit.is_active == True,  # noqa: E712
        ).group_by(Unit.status)
    )).all()
    unit_counts = {str(s): int(c) for s, c in unit_rows}
    total_units = sum(unit_counts.values())
    occupied = unit_counts.get("occupied", 0)
    occupancy_pct = round(occupied / total_units * 100) if total_units else 0

    arrears = (await db.execute(
        select(func.coalesce(func.sum(Tenant.rent_outstanding + Tenant.service_charge_outstanding), 0.0)).where(
            Tenant.estate.in_(estate_ids), Tenant.is_active == True,  # noqa: E712
        )
    )).scalar() or 0.0

    monthly_rent = (await db.execute(
        select(func.coalesce(func.sum(Tenant.rent_amount), 0.0)).where(
            Tenant.estate.in_(estate_ids), Tenant.is_active == True,  # noqa: E712
        )
    )).scalar() or 0.0

    expiring_60d = (await db.execute(
        select(func.count()).select_from(Tenant).where(
            Tenant.estate.in_(estate_ids), Tenant.is_active == True,  # noqa: E712
            Tenant.lease_end_date.is_not(None),
            Tenant.lease_end_date >= now,
            Tenant.lease_end_date <= now + timedelta(days=60),
        )
    )).scalar() or 0

    vitals = (f"Occupancy {occupancy_pct}% ({occupied}/{total_units} units) · "
              f"Rent run-rate ₦{monthly_rent:,.0f}/mo · Arrears ₦{arrears:,.0f} · "
              f"{expiring_60d} lease(s) end within 60 days")

    # ── Cross-business-line: BamiHost runs MANY businesses, not just estate ──
    lines = await active_business_lines(db, user)
    metering_line = ""
    if "Smart Metering" in lines:
        from models.meter_device import MeterDevice
        m_rows = (await db.execute(
            select(MeterDevice).where(
                MeterDevice.estate.in_(estate_ids), MeterDevice.is_active == True,  # noqa: E712
            )
        )).scalars().all()
        low = sum(1 for d in m_rows if d.prepaid_mode and (d.credit_balance or 0) <= (d.low_balance_threshold or 0))
        offline = sum(1 for d in m_rows if not d.is_online)
        metering_line = (f"Smart Metering — {len(m_rows)} meter(s), "
                         f"{low} low on credit, {offline} offline")

    lines_label = ", ".join(lines) if lines else "Real Estate"

    briefing = await ai_analyze(
        "the General Manager briefing the owner",
        f"Active business lines: {lines_label}.\n"
        f"Real Estate vitals: {vitals}.\n"
        + (f"{metering_line}.\n" if metering_line else "")
        + "Team desk this run:\n" + ("\n".join(desk_lines) or "no new items — a quiet day") + "\n"
        f"High-priority titles: {'; '.join(urgent) or 'none'}.",
        "Write today's State of the Company briefing covering ALL active business lines "
        "(never assume estate is the only one): overall health, the top 2-3 priorities across "
        "the WHOLE team and why, and exactly what needs the owner's decision today.",
        max_tokens=520)

    desk_section = "\n\nTEAM DESK — THIS RUN\n" + ("\n".join(f"• {l}" for l in desk_lines)
                                                  or "• No agent raised anything this run.")

    return [make_action(
        uid, "gm", "state_of_company",
        f"State of the Company — {now.strftime('%d %b %Y')} · {occupancy_pct}% occupied · "
        f"{len(team_actions)} team item(s)",
        "Gbenga read every agent's output and the company vitals. This is the one briefing to read "
        "first — and what needs your decision today.",
        briefing + f"\n\nBUSINESS LINES\n• {lines_label}"
        + (f"\n\nVITALS\n• " + vitals.replace(" · ", "\n• "))
        + (f"\n• {metering_line}" if metering_line else "")
        + desk_section,
        "internal", "daily_standup",
        {"team_items": len(team_actions), "high_priority": len(urgent),
         "occupancy_pct": occupancy_pct, "arrears": arrears,
         "expiring_60d": expiring_60d, "as_of": now.strftime("%Y-%m-%d")},
        priority="high" if urgent else "medium",
        auto_execute=True)]
