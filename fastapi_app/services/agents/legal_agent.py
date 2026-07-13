"""Legal / Contracts agent — drafts the tenancy paperwork before it's needed.

Where the Compliance agent flags what's already broken (expired/missing
agreements), this agent looks AHEAD: leases coming up for renewal in the next
60 days, and drafts the renewal notice / agreement language the owner can send
so a new agreement is signed before the current one lapses. Legal wording always
waits for a human eye.
"""
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.tenant import Tenant
from models.estate import Estate
from models.user import User
from models.autopilot_action import AutopilotAction
from services.agents.base import AgentMeta, ai_text, make_action, owner_estate_ids
from utils.time_utils import utcnow

META = AgentMeta(
    key="legal",
    name="Barr. Uche · Legal",
    emoji="⚖️",
    description="Drafts tenancy agreements, renewal notices and breach letters; looks ahead to leases renewing soon.",
    auto_safe=[],
)


async def scan(db: AsyncSession, user: User) -> list[AutopilotAction]:
    uid = str(user.id)
    estate_ids = await owner_estate_ids(db, user)
    if not estate_ids:
        return []

    now = utcnow()
    window = now + timedelta(days=60)
    rows = (await db.execute(
        select(Tenant, Estate)
        .join(Estate, Tenant.estate == Estate.id)
        .where(
            Tenant.estate.in_(estate_ids),
            Tenant.is_active == True,           # noqa: E712
            Tenant.lease_end_date.isnot(None),
            Tenant.lease_end_date >= now,
            Tenant.lease_end_date <= window,
        )
        .order_by(Tenant.lease_end_date.asc())
    )).all()
    if not rows:
        return []

    def _label(t, e):
        end = t.lease_end_date.strftime("%d %b %Y") if t.lease_end_date else "?"
        return f"{t.tenant_name} ({t.unit_label or 'unit'} @ {e.name}) — lease ends {end}"

    detail = "; ".join(_label(t, e) for t, e in rows[:8])
    extra = len(rows) - 8
    if extra > 0:
        detail += f"; …and {extra} more"

    ctx = {
        "renewing_count": len(rows),
        "renewals": detail,
        "window_days": 60,
        "as_of": now.strftime("%Y-%m-%d"),
    }

    guidance = await ai_text(
        "You are a property lawyer for a Nigerian landlord. In under 130 words, draft a short, warm "
        "renewal-notice message the owner can send to tenants whose lease is ending soon (mention that a "
        "renewed tenancy agreement will be prepared and any rent-increase applies per the agreement), then "
        "list the 3 documents/steps to get the renewal signed before the current lease lapses. Plain "
        "language, professional, Nigeria-appropriate.",
        f"{len(rows)} tenancy agreement(s) end within 60 days: {detail}. "
        "Draft the renewal notice and the steps to get it signed in time.")

    return [make_action(
        uid, "legal", "legal_draft",
        f"{len(rows)} lease(s) renewing within 60 days — prepare the paperwork",
        "Tenancy agreements are approaching their end date. Send renewal notices and prepare new agreements.",
        guidance, "internal", "legal_review", ctx,
        priority="medium")]
