"""Sales agent — chases pending enquiries with friendly follow-ups."""
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from models.enquiry import Enquiry
from models.user import User
from models.autopilot_action import AutopilotAction
from services.agents.base import AgentMeta, ai_text, make_action, owner_estate_ids

META = AgentMeta(
    key="sales",
    name="Sade · Sales",
    emoji="💼",
    description="Scores leads and sends warm follow-ups to every pending enquiry.",
    # Drafting follow-ups is safe; sending is gated unless the owner opts in.
    auto_safe=[],
)


async def scan(db: AsyncSession, user: User) -> list[AutopilotAction]:
    uid = str(user.id)
    estate_ids = await owner_estate_ids(db, user) or ["__none__"]

    enquiries = (await db.execute(
        select(Enquiry).where(and_(
            Enquiry.status == "pending",
            (Enquiry.estate.in_(estate_ids)) | (Enquiry.owner_id == uid),
        ))
    )).scalars().all()

    actions: list[AutopilotAction] = []
    for enq in enquiries:
        ctx = {
            "name": enq.name,
            "unit_interest": getattr(enq, "unit_interest", "") or "",
            "phone": enq.phone or "",
        }
        recipients = []
        if enq.phone:
            recipients.append({"name": enq.name, "phone": enq.phone, "email": getattr(enq, "email", "") or ""})

        follow_up = await ai_text(
            "You are a Nigerian property sales consultant. Write a friendly WhatsApp follow-up to a "
            "property enquiry. Max 4 sentences. Offer to schedule a viewing. Warm and professional.",
            f"Prospect: {enq.name}, interested in: {ctx['unit_interest'] or 'a property'}.")
        actions.append(make_action(
            uid, "sales", "follow_up", f"Follow up — {enq.name}",
            f"Move {enq.name} closer to signing with a follow-up.", follow_up, "telegram",
            "new_enquiry", ctx, priority="high", recipients=recipients))
    return actions
