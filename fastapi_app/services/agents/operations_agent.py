"""Operations agent — triages open maintenance issues into an action plan."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.issue import Issue
from models.user import User
from models.autopilot_action import AutopilotAction
from services.agents.base import AgentMeta, ai_text, make_action, owner_estate_ids

META = AgentMeta(
    key="operations",
    name="Obi · Operations",
    emoji="🔧",
    description="Triages open issues, assigns the best vendor, and tracks resolution.",
    auto_safe=["maintenance_plan"],  # producing a plan is safe; dispatching a vendor stays manual
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
    ctx = {"open_count": len(issues), "high_priority": len(high)}
    plan = await ai_text(
        "You are a property operations manager. Give a brief action plan (3 bullet points max) "
        "for handling open maintenance issues. Specific and practical.",
        f"{len(issues)} open issues, {len(high)} high priority. What should be done today?")
    return [make_action(
        uid, "operations", "maintenance_plan",
        f"Maintenance action plan — {len(issues)} open issues",
        "Your Operations agent reviewed open issues and built an action plan.",
        plan, "internal", "issue_reported", ctx,
        priority="high" if high else "medium")]
