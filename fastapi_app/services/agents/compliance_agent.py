"""Compliance agent — keeps tenancy paperwork legal and current.

Two silent liabilities creep up on landlords: leases that have already expired
(the tenant is now on an informal holdover with no valid agreement) and tenants
with no agreement on file at all. Both are legal risk. This agent surfaces them
and drafts the paperwork-regularisation reminders so nothing sits expired.
"""
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.tenant import Tenant
from models.estate import Estate
from models.user import User
from models.autopilot_action import AutopilotAction
from services.agents.base import AgentMeta, ai_text, make_action, owner_estate_ids
from utils.time_utils import utcnow

META = AgentMeta(
    key="compliance",
    name="Chidi · Compliance",
    emoji="📋",
    description="Tracks expired/missing tenancy agreements and drafts the paperwork-regularisation reminders.",
    # Legal paperwork always needs a human eye before it goes out.
    auto_safe=[],
)


async def scan(db: AsyncSession, user: User) -> list[AutopilotAction]:
    uid = str(user.id)
    estate_ids = await owner_estate_ids(db, user)
    if not estate_ids:
        return []

    now = utcnow()
    tenants = (await db.execute(
        select(Tenant, Estate).join(Estate, Tenant.estate == Estate.id).where(
            Tenant.estate.in_(estate_ids),
            Tenant.is_active == True,  # noqa: E712
        )
    )).all()

    expired: list[tuple] = []   # lease_end_date in the past
    missing: list[tuple] = []   # no lease_end_date on file
    for tenant, estate in tenants:
        if tenant.lease_end_date is None:
            missing.append((tenant, estate))
        elif tenant.lease_end_date < now:
            expired.append((tenant, estate))

    if not expired and not missing:
        return []

    def _names(rows, limit=8):
        labels = [f"{t.tenant_name} ({t.unit_label or 'unit'} @ {e.name})" for t, e in rows[:limit]]
        extra = len(rows) - limit
        if extra > 0:
            labels.append(f"…and {extra} more")
        return "; ".join(labels)

    ctx = {
        "expired_count": len(expired), "missing_count": len(missing),
        "expired": _names(expired), "missing": _names(missing),
        "as_of": now.strftime("%Y-%m-%d"),
    }

    guidance = await ai_text(
        "You are a compliance officer for a Nigerian property business. In under 110 words, explain the "
        "legal risk of expired or missing tenancy agreements and give a 3-step checklist to regularise "
        "them this week. Practical and calm, not alarmist.",
        f"Expired agreements: {len(expired)} tenant(s) — {ctx['expired'] or 'none'}. "
        f"No agreement on file: {len(missing)} tenant(s) — {ctx['missing'] or 'none'}. "
        "What should the owner do to bring the paperwork back into compliance?")

    total = len(expired) + len(missing)
    return [make_action(
        uid, "compliance", "compliance_alert",
        f"Paperwork needs attention — {len(expired)} expired, {len(missing)} missing agreements",
        f"{total} tenant(s) have expired or missing tenancy agreements. Regularise the paperwork.",
        guidance, "internal", "compliance_review", ctx,
        priority="high" if expired else "medium")]
