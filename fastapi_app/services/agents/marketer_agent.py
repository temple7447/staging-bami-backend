"""Marketer agent — turns vacant units into ready-to-post social content + a daily briefing."""
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.unit import Unit
from models.estate import Estate
from models.user import User
from models.autopilot_action import AutopilotAction
from services.designer import design_listing_graphic
from services.agents.base import AgentMeta, ai_text, make_action, owner_estate_ids, SONNET

META = AgentMeta(
    key="marketer",
    name="Marketer",
    emoji="📣",
    description="Writes & schedules social posts for vacant units, with the Designer's graphics.",
    # Drafting content is safe to auto-generate; actual posting/blasting still needs approval.
    auto_safe=["daily_briefing"],
)


async def scan(db: AsyncSession, user: User) -> list[AutopilotAction]:
    uid = str(user.id)
    estate_ids = await owner_estate_ids(db, user)
    if not estate_ids:
        estate_ids = ["__none__"]

    vacant_rows = (await db.execute(
        select(Unit, Estate).join(Estate, Unit.estate == Estate.id).where(
            Unit.estate.in_(estate_ids), Unit.status == "vacant",
        )
    )).all()

    actions: list[AutopilotAction] = []
    for unit, estate in vacant_rows:
        ctx = {
            "unit": unit.label, "estate": estate.name,
            "price": f"₦{unit.monthly_price:,.0f}/mo" if unit.monthly_price else "price on request",
            "bedrooms": unit.bedrooms or "", "category": unit.category or "unit",
            "listing_type": unit.listing_type or "Rent",
        }
        # 🎨 reuse (or design) the listing graphic so each post ships with an image
        graphic = await design_listing_graphic(db, uid, ctx, unit=unit)

        wa = await ai_text(
            "You are a Nigerian property marketer. Write a short WhatsApp message (max 3 lines) "
            "to broadcast a property listing. Plain text, conversational, add urgency.",
            f"Property: {ctx['bedrooms']}bed {ctx['category']} at {ctx['estate']}, {ctx['price']}.")
        actions.append(make_action(
            uid, "marketer", "telegram_blast", f"Telegram blast — {unit.label}, {estate.name}",
            "Broadcast this vacant unit to your contact list.", wa, "telegram",
            "vacancy_opened", ctx, priority="high", image_url=graphic))

        ig = await ai_text(
            "Write an Instagram caption for a Nigerian property listing. Emojis, 3-5 hashtags, CTA. Max 150 words.",
            f"Property: {ctx['bedrooms']}bed {ctx['category']} at {ctx['estate']}, {ctx['price']}.")
        actions.append(make_action(
            uid, "marketer", "instagram_post", f"Instagram post — {unit.label}, {estate.name}",
            "Post this with the AI-designed graphic to attract leads.", ig, "instagram",
            "vacancy_opened", ctx, image_url=graphic))

        fb = await ai_text(
            "Write a Facebook post for a Nigerian property listing. 100-150 words, features, price, contact. No markdown.",
            f"Property: {ctx['bedrooms']}bed {ctx['category']} at {ctx['estate']}, {ctx['price']}.")
        actions.append(make_action(
            uid, "marketer", "facebook_post", f"Facebook post — {unit.label}, {estate.name}",
            "Share on your page or property groups.", fb, "facebook",
            "vacancy_opened", ctx, image_url=graphic))

    return actions
