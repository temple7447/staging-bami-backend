"""Metering / Energy agent — watches the Smart Metering business line.

Prepaid meters silently run down and cut off; offline meters stop billing and
nobody notices until a tenant complains. This agent flags meters that are low
on credit or have gone offline, and drafts the top-up / attention reminders so
power never lapses unexpectedly.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.meter_device import MeterDevice
from models.estate import Estate
from models.user import User
from models.autopilot_action import AutopilotAction
from services.agents.base import AgentMeta, ai_analyze, make_action, owner_estate_ids
from utils.time_utils import utcnow

META = AgentMeta(
    key="metering",
    name="Ada · Metering",
    emoji="⚡",
    description="Watches smart-meter credit balances and connectivity; drafts low-balance top-up reminders and flags offline meters.",
    # Reminders are drafted for a human to send; nothing auto-executes on hardware.
    auto_safe=[],
    business_line="Smart Metering",
)


async def scan(db: AsyncSession, user: User) -> list[AutopilotAction]:
    uid = str(user.id)
    estate_ids = await owner_estate_ids(db, user)
    if not estate_ids:
        return []

    devices = (await db.execute(
        select(MeterDevice, Estate)
        .join(Estate, MeterDevice.estate == Estate.id)
        .where(MeterDevice.estate.in_(estate_ids), MeterDevice.is_active == True)  # noqa: E712
    )).all()
    if not devices:
        return []

    low: list[tuple] = []       # prepaid & at/below threshold
    offline: list[tuple] = []   # not reporting
    for d, e in devices:
        if not d.is_online:
            offline.append((d, e))
        if d.prepaid_mode and (d.credit_balance or 0) <= (d.low_balance_threshold or 0):
            low.append((d, e))

    if not low and not offline:
        return []

    def _label(d, e):
        who = d.device_name or d.meter_number or d.device_id
        return f"{who} ({e.name})"

    def _names(rows, limit=8):
        labels = [_label(d, e) for d, e in rows[:limit]]
        extra = len(rows) - limit
        if extra > 0:
            labels.append(f"…and {extra} more")
        return "; ".join(labels)

    low_detail = "; ".join(f"{_label(d, e)}: ₦{(d.credit_balance or 0):,.0f} left" for d, e in low[:8])
    ctx = {
        "low_count": len(low), "offline_count": len(offline),
        "low": low_detail or "none", "offline": _names(offline),
        "as_of": utcnow().strftime("%Y-%m-%d"),
    }

    guidance = await ai_analyze(
        "an energy/metering operations lead running prepaid smart meters",
        f"Low-balance prepaid meters: {len(low)} — {ctx['low']}. "
        f"Offline meters (not reporting): {len(offline)} — {ctx['offline'] or 'none'}.",
        "Keep power from lapsing: which meters to top up first, the exact message to send "
        "tenants on low prepaid meters, and how to get offline meters back online.")

    priority = "high" if low else "medium"
    title_bits = []
    if low:
        title_bits.append(f"{len(low)} low-balance")
    if offline:
        title_bits.append(f"{len(offline)} offline")
    return [make_action(
        uid, "metering", "metering_alert",
        f"Meters need attention — {', '.join(title_bits)}",
        "Prepaid meters are low on credit or offline. Top up / reconnect before power lapses.",
        guidance, "internal", "metering_review", ctx,
        priority=priority)]
