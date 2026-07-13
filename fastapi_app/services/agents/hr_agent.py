"""HR agent — watches portfolio growth and flags when it's time to hire."""
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from models.tenant import Tenant
from models.user import User
from models.autopilot_action import AutopilotAction
from services.agents.base import AgentMeta, ai_analyze, make_action, owner_estate_ids

META = AgentMeta(
    key="hr",
    name="Hauwa · HR",
    emoji="👥",
    description="Flags when the portfolio is big enough to hire, and drafts the role.",
    auto_safe=[],  # hiring is always a human decision
    business_line="Company-wide",
)

# Rough span-of-control threshold: above this many active tenants, a single
# owner/manager is stretched thin and should consider help.
HIRE_TENANT_THRESHOLD = 15


async def scan(db: AsyncSession, user: User) -> list[AutopilotAction]:
    uid = str(user.id)
    estate_ids = await owner_estate_ids(db, user)
    if not estate_ids:
        return []

    tenant_count = (await db.execute(
        select(func.count()).select_from(Tenant).where(
            Tenant.estate.in_(estate_ids), Tenant.is_active == True,  # noqa: E712
        )
    )).scalar() or 0

    if tenant_count < HIRE_TENANT_THRESHOLD:
        return []

    ctx = {"active_tenants": tenant_count, "threshold": HIRE_TENANT_THRESHOLD}
    jd = await ai_analyze(
        "an HR advisor",
        f"The owner now manages {tenant_count} active tenants across {len(estate_ids)} estate(s) "
        "and is handling everything alone.",
        "Recommend the ONE role to hire next given the portfolio size, with 3 key responsibilities.")
    return [make_action(
        uid, "hr", "hiring_recommendation",
        f"Time to hire — {tenant_count} active tenants under management",
        f"Your portfolio crossed {HIRE_TENANT_THRESHOLD} active tenants. Consider hiring support.",
        jd, "internal", "hiring_trigger", ctx, priority="medium")]
