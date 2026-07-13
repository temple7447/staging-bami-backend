"""Procurement / Vendor agent — turns repeat maintenance into better deals.

When the same category of maintenance issue keeps recurring (plumbing every
month, generator every few weeks), paying per-callout is expensive — a fixed
vendor contract or bulk purchase is cheaper. This agent spots the high-volume
categories over the last 90 days and drafts the vendor RFQ / negotiation ask.
"""
from collections import Counter
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.issue import Issue
from models.user import User
from models.autopilot_action import AutopilotAction
from services.agents.base import AgentMeta, ai_analyze, make_action, owner_estate_ids
from utils.time_utils import utcnow

META = AgentMeta(
    key="procurement",
    name="Tunde · Procurement",
    emoji="🧾",
    description="Spots recurring maintenance categories and drafts vendor RFQs / negotiation asks to cut per-callout cost.",
    auto_safe=[],
)

# Only nudge once a category is genuinely recurring within the window.
RECURRING_THRESHOLD = 3
WINDOW_DAYS = 90


async def scan(db: AsyncSession, user: User) -> list[AutopilotAction]:
    uid = str(user.id)
    estate_ids = await owner_estate_ids(db, user)
    if not estate_ids:
        return []

    since = utcnow() - timedelta(days=WINDOW_DAYS)
    issues = (await db.execute(
        select(Issue).where(
            Issue.estate.in_(estate_ids),
            Issue.is_active == True,            # noqa: E712
            Issue.created_at >= since,
        )
    )).scalars().all()
    if not issues:
        return []

    counts = Counter((i.category or "other").lower() for i in issues)
    recurring = {cat: n for cat, n in counts.items() if n >= RECURRING_THRESHOLD}
    if not recurring:
        return []

    ranked = sorted(recurring.items(), key=lambda kv: kv[1], reverse=True)
    breakdown = "; ".join(f"{cat}: {n} in {WINDOW_DAYS}d" for cat, n in ranked)
    ctx = {
        "window_days": WINDOW_DAYS,
        "total_issues": len(issues),
        "recurring_categories": len(recurring),
        "breakdown": breakdown,
        "as_of": utcnow().strftime("%Y-%m-%d"),
    }

    guidance = await ai_analyze(
        "a procurement/vendor manager",
        f"Maintenance issues in the last {WINDOW_DAYS} days by category: {breakdown}. "
        f"Total issues: {len(issues)}.",
        "Recommend which category to put on a fixed vendor contract or bulk supply first "
        "(and why it beats paying per-callout), and draft a 2-line RFQ to send to 2–3 vendors.")

    top_cat = ranked[0][0]
    return [make_action(
        uid, "procurement", "procurement_suggestion",
        f"Recurring {top_cat} maintenance — negotiate a vendor deal",
        f"{len(recurring)} maintenance category(ies) are recurring in the last {WINDOW_DAYS} days. "
        "A fixed vendor contract likely beats paying per callout.",
        guidance, "internal", "procurement_review", ctx,
        priority="medium")]
