"""Operations agent — triages open maintenance issues into an action plan."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.issue import Issue
from models.user import User
from models.autopilot_action import AutopilotAction
from services.agents.base import AgentMeta, ai_analyze, make_action, owner_estate_ids

META = AgentMeta(
    key="operations",
    name="Obi · Operations",
    emoji="🔧",
    description="Triages open issues, assigns the best vendor, and tracks resolution.",
    auto_safe=["maintenance_plan"],  # producing a plan is safe; dispatching a vendor stays manual
    business_line="Real Estate",
)


async def scan(db: AsyncSession, user: User) -> list[AutopilotAction]:
    uid = str(user.id)
    estate_ids = await owner_estate_ids(db, user) or ["__none__"]

    issues = (await db.execute(
        select(Issue).where(
            Issue.estate.in_(estate_ids),
            Issue.status.in_(["open", "pending", "in_progress"]),
        )
    )).scalars().all()
    if not issues:
        return []

    high = [i for i in issues if getattr(i, "priority", "") == "high"]
    # Group by category so the plan can target the biggest cost/effort clusters.
    from collections import Counter
    by_cat = Counter((getattr(i, "category", None) or "other").lower() for i in issues)
    cat_line = "; ".join(f"{c}: {n}" for c, n in by_cat.most_common(6))
    high_titles = "; ".join((getattr(i, "title", "") or getattr(i, "category", "issue")) for i in high[:5]) or "none"
    ctx = {"open_count": len(issues), "high_priority": len(high), "by_category": cat_line}
    plan = await ai_analyze(
        "a property operations manager",
        f"{len(issues)} open maintenance issues, {len(high)} high-priority. "
        f"By category: {cat_line}. High-priority items: {high_titles}.",
        "Give today's action plan to clear these issues — which to tackle first and how.")
    return [make_action(
        uid, "operations", "maintenance_plan",
        f"Maintenance action plan — {len(issues)} open issues",
        "Your Operations agent reviewed open issues and built an action plan.",
        plan, "internal", "issue_reported", ctx,
        priority="high" if high else "medium")]
