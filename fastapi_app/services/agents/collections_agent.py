"""Collections agent — the escalation ladder for genuinely overdue rent.

Where the Finance agent sends a single polite nudge for any outstanding balance,
Collections handles accounts that are *past their due date*, escalating tone with
days overdue: a gentle reminder becomes a firm notice becomes a final notice with
an owner alert. This keeps cash flowing without the owner having to track who is
how late.
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
    key="collections",
    name="Chike · Collections",
    emoji="⏰",
    description="Escalation ladder for overdue rent — gentle reminder → firm notice → final notice + owner alert.",
    # Chasing money is sensitive; every notice waits for approval.
    auto_safe=[],
)


def _tier(days_overdue: int) -> tuple[str, str, str]:
    """Return (stage_label, tone_instruction, priority) for the escalation ladder."""
    if days_overdue <= 7:
        return ("Gentle reminder", "friendly and understanding, assume they simply forgot", "medium")
    if days_overdue <= 30:
        return ("Firm notice", "firm and clear that payment is now overdue, but still professional and respectful", "high")
    return ("Final notice", "serious and formal, state this is a final notice and outline next steps if unpaid, while staying legally careful and non-threatening", "high")


async def scan(db: AsyncSession, user: User) -> list[AutopilotAction]:
    uid = str(user.id)
    estate_ids = await owner_estate_ids(db, user) or ["__none__"]

    now = utcnow()
    rows = (await db.execute(
        select(Tenant, Estate).join(Estate, Tenant.estate == Estate.id).where(
            Tenant.estate.in_(estate_ids),
            Tenant.is_active == True,  # noqa: E712
            Tenant.next_due_date.is_not(None),
            Tenant.next_due_date < now,
            (Tenant.rent_outstanding + Tenant.service_charge_outstanding) > 0,
        )
    )).all()

    actions: list[AutopilotAction] = []
    for tenant, estate in rows:
        days_overdue = (now - tenant.next_due_date).days
        if days_overdue < 1:
            continue
        outstanding = (tenant.rent_outstanding or 0) + (tenant.service_charge_outstanding or 0)
        stage, tone, priority = _tier(days_overdue)
        unit_label = tenant.unit_label or "their unit"
        recipients = []
        if tenant.tenant_phone:
            recipients.append({"name": tenant.tenant_name, "phone": tenant.tenant_phone,
                               "email": tenant.tenant_email or ""})

        ctx = {"name": tenant.tenant_name, "unit": unit_label, "estate": estate.name,
               "days_overdue": days_overdue, "stage": stage,
               "outstanding": f"₦{outstanding:,.0f}"}

        notice = await ai_text(
            f"You are a Nigerian property manager writing a rent collections message. Tone: {tone}. "
            "Max 4 sentences. Address the tenant by name, state the amount and how many days overdue, "
            "and invite them to settle. Never threaten or use abusive language.",
            f"Tenant: {tenant.tenant_name}, Unit: {unit_label} at {estate.name}, "
            f"Outstanding: ₦{outstanding:,.0f}, {days_overdue} days overdue.")

        actions.append(make_action(
            uid, "collections", "collections_notice",
            f"{stage} — {tenant.tenant_name} ({days_overdue}d overdue, ₦{outstanding:,.0f})",
            f"{tenant.tenant_name} at {estate.name} is {days_overdue} days overdue for ₦{outstanding:,.0f}. "
            f"Send the {stage.lower()}.",
            notice, "telegram", "rent_overdue", ctx,
            priority=priority, recipients=recipients))
    return actions
