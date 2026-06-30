"""Finance agent — chases overdue rent and flags cash-flow risk."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.tenant import Tenant
from models.estate import Estate
from models.user import User
from models.autopilot_action import AutopilotAction
from services.agents.base import AgentMeta, ai_text, make_action, owner_estate_ids

META = AgentMeta(
    key="finance",
    name="Finance",
    emoji="💰",
    description="Sends rent reminders, generates payment links, and flags cash-flow risk.",
    # Reminders are safe to auto-send; payment LINKS (money) stay manual.
    auto_safe=["payment_reminder"],
)


async def scan(db: AsyncSession, user: User) -> list[AutopilotAction]:
    uid = str(user.id)
    estate_ids = await owner_estate_ids(db, user) or ["__none__"]

    overdue = (await db.execute(
        select(Tenant, Estate).join(Estate, Tenant.estate == Estate.id).where(
            Tenant.estate.in_(estate_ids),
            Tenant.is_active == True,  # noqa: E712
            (Tenant.rent_outstanding + Tenant.service_charge_outstanding) > 0,
        )
    )).all()

    actions: list[AutopilotAction] = []
    for tenant, estate in overdue:
        outstanding = (tenant.rent_outstanding or 0) + (tenant.service_charge_outstanding or 0)
        unit_label = tenant.unit_label or "their unit"
        ctx = {"name": tenant.tenant_name, "unit": unit_label, "estate": estate.name,
               "outstanding": f"₦{outstanding:,.0f}"}
        recipients = []
        if tenant.tenant_phone:
            recipients.append({"name": tenant.tenant_name, "phone": tenant.tenant_phone,
                               "email": tenant.tenant_email or ""})

        reminder = await ai_text(
            "You are a professional Nigerian property manager. Write a polite but firm WhatsApp/SMS "
            "payment reminder. Max 3 sentences. Address the tenant by name. Professional, not aggressive.",
            f"Tenant: {tenant.tenant_name}, Unit: {unit_label} at {estate.name}, Outstanding: ₦{outstanding:,.0f}.")
        actions.append(make_action(
            uid, "finance", "payment_reminder",
            f"Payment reminder — {tenant.tenant_name} ({unit_label})",
            f"{tenant.tenant_name} owes ₦{outstanding:,.0f}. Send a polite reminder now.",
            reminder, "telegram", "tenant_overdue", ctx,
            priority="high", recipients=recipients))
    return actions
