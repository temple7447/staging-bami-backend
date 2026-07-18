"""Retention agent — watches lease expiries and drafts renewal offers before churn.

Level-1 of the 7 Levels is about keeping the customers you already won. A tenant
whose lease is about to end — especially one who isn't a promoter — is the
cheapest customer to keep and the most expensive to replace. This agent surfaces
them early and drafts a warm renewal offer so the owner never lets one slip.
"""
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.tenant import Tenant
from models.estate import Estate
from models.user import User
from models.autopilot_action import AutopilotAction
from services.agents.base import AgentMeta, ai_text, make_action, owner_estate_ids
from utils.time_utils import utcnow

META = AgentMeta(
    key="retention",
    name="Ronke · Retention",
    emoji="🔁",
    description="Watches lease expiries, drafts renewal offers, and flags at-risk tenants before they churn.",
    # Drafting a renewal offer is safe; SENDING it (a commercial offer that may
    # change terms) stays a human decision.
    auto_safe=[],
)

# How far ahead to start the renewal conversation.
RENEWAL_WINDOW_DAYS = 60
# NPS at or below this marks the tenant as "at risk" (a detractor/passive).
AT_RISK_NPS = 7


async def scan(db: AsyncSession, user: User) -> list[AutopilotAction]:
    uid = str(user.id)
    estate_ids = await owner_estate_ids(db, user) or ["__none__"]

    now = utcnow()
    horizon = now + timedelta(days=RENEWAL_WINDOW_DAYS)

    rows = (await db.execute(
        select(Tenant, Estate).join(Estate, Tenant.estate == Estate.id).where(
            Tenant.estate.in_(estate_ids),
            Tenant.is_active == True,  # noqa: E712
            Tenant.lease_end_date.is_not(None),
            Tenant.lease_end_date >= now,
            Tenant.lease_end_date <= horizon,
        )
    )).all()

    actions: list[AutopilotAction] = []
    for tenant, estate in rows:
        days_left = (tenant.lease_end_date - now).days
        at_risk = tenant.nps_score is not None and tenant.nps_score <= AT_RISK_NPS
        unit_label = tenant.unit_label or "their unit"
        recipients = []
        if tenant.tenant_phone:
            recipients.append({"name": tenant.tenant_name, "phone": tenant.tenant_phone,
                               "email": tenant.tenant_email or ""})

        ctx = {"name": tenant.tenant_name, "unit": unit_label, "estate": estate.name,
               "days_left": days_left, "at_risk": at_risk,
               "nps": tenant.nps_score, "rent": f"₦{(tenant.rent_amount or 0):,.0f}"}

        risk_note = ("This tenant is AT RISK — their satisfaction score is low, so be extra warm and "
                     "acknowledge you value them.") if at_risk else "This tenant seems happy — keep it warm and simple."
        offer = await ai_text(
            "You are a professional Nigerian property manager. Write a warm WhatsApp/SMS renewal "
            "message inviting the tenant to renew their lease. Max 4 sentences. Address them by name, "
            "note the lease is ending soon, and invite them to continue. " + risk_note,
            f"Tenant: {tenant.tenant_name}, Unit: {unit_label} at {estate.name}, "
            f"Lease ends in {days_left} days, Current rent: ₦{(tenant.rent_amount or 0):,.0f}.")

        actions.append(make_action(
            uid, "retention", "renewal_offer",
            f"{'⚠️ At-risk renewal' if at_risk else 'Renewal'} — {tenant.tenant_name} ({days_left}d left)",
            f"{tenant.tenant_name}'s lease at {estate.name} ends in {days_left} days. "
            f"{'They are at risk of leaving. ' if at_risk else ''}Send a renewal offer now.",
            offer, "sms", "lease_expiring", ctx,
            priority="high" if at_risk or days_left <= 30 else "medium",
            recipients=recipients))
    return actions
