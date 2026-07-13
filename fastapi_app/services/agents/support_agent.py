"""Customer Support agent — keeps tenants & prospects happy and heard.

Watches three signals of neglect: prospect enquiries left unanswered, open
maintenance issues that are ageing, and tenants who scored low on NPS. It
drafts warm replies and flags who to reach out to before they churn or leave a
bad review.
"""
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.enquiry import Enquiry
from models.issue import Issue
from models.tenant import Tenant
from models.estate import Estate
from models.user import User
from models.autopilot_action import AutopilotAction
from services.agents.base import AgentMeta, ai_text, make_action, owner_estate_ids
from utils.time_utils import utcnow

META = AgentMeta(
    key="support",
    name="Zainab · Support",
    emoji="💬",
    description="Watches unanswered enquiries, ageing issues and unhappy (low-NPS) tenants; drafts warm replies and save-the-relationship outreach.",
    auto_safe=[],
)

LOW_NPS = 6  # 0–6 = detractor


async def scan(db: AsyncSession, user: User) -> list[AutopilotAction]:
    uid = str(user.id)
    estate_ids = await owner_estate_ids(db, user)
    if not estate_ids:
        return []

    now = utcnow()
    two_days_ago = now - timedelta(days=2)

    pending_enq = (await db.execute(
        select(Enquiry).where(
            Enquiry.estate.in_(estate_ids),
            Enquiry.is_active == True,          # noqa: E712
            Enquiry.status == "pending",
        ).order_by(Enquiry.created_at.asc())
    )).scalars().all()

    ageing_issues = (await db.execute(
        select(Issue).where(
            Issue.estate.in_(estate_ids),
            Issue.is_active == True,            # noqa: E712
            Issue.status != "completed",
            Issue.created_at <= two_days_ago,
        ).order_by(Issue.created_at.asc())
    )).scalars().all()

    unhappy = (await db.execute(
        select(Tenant, Estate)
        .join(Estate, Tenant.estate == Estate.id)
        .where(
            Tenant.estate.in_(estate_ids),
            Tenant.is_active == True,           # noqa: E712
            Tenant.nps_score.isnot(None),
            Tenant.nps_score <= LOW_NPS,
        )
    )).all()

    if not pending_enq and not ageing_issues and not unhappy:
        return []

    unhappy_names = "; ".join(f"{t.tenant_name} (NPS {t.nps_score}, {e.name})" for t, e in unhappy[:6]) or "none"
    ctx = {
        "pending_enquiries": len(pending_enq),
        "ageing_issues": len(ageing_issues),
        "unhappy_tenants": len(unhappy),
        "unhappy": unhappy_names,
        "as_of": now.strftime("%Y-%m-%d"),
    }

    guidance = await ai_text(
        "You are a customer-success lead for a Nigerian property business. In under 120 words, prioritise "
        "who to contact first, draft ONE warm reply template for an unanswered enquiry, and give a one-line "
        "save-the-relationship message for an unhappy tenant. Warm, human, specific — no corporate filler.",
        f"Unanswered enquiries: {len(pending_enq)}. Open issues older than 2 days: {len(ageing_issues)}. "
        f"Unhappy tenants (NPS ≤ {LOW_NPS}): {len(unhappy)} — {unhappy_names}. "
        "What should support do today to keep everyone happy?")

    priority = "high" if (unhappy or len(pending_enq) >= 3) else "medium"
    bits = []
    if pending_enq:
        bits.append(f"{len(pending_enq)} enquiries")
    if ageing_issues:
        bits.append(f"{len(ageing_issues)} ageing issues")
    if unhappy:
        bits.append(f"{len(unhappy)} unhappy tenants")
    return [make_action(
        uid, "support", "support_alert",
        f"Tenants & prospects need a reply — {', '.join(bits)}",
        "Unanswered enquiries, ageing issues, or unhappy tenants need attention before they churn.",
        guidance, "internal", "support_review", ctx,
        priority=priority)]
