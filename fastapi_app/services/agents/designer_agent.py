"""Designer agent — keeps every active listing supplied with a branded graphic."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.unit import Unit
from models.estate import Estate
from models.user import User
from models.autopilot_action import AutopilotAction
from services.designer import design_listing_graphic
from services.agents.base import AgentMeta, owner_estate_ids

META = AgentMeta(
    key="designer",
    name="Designer",
    emoji="🎨",
    description="Designs branded marketing graphics for every new listing, automatically.",
    auto_safe=["listing_graphic"],  # designing an image is always safe to auto-run
)


async def scan(db: AsyncSession, user: User) -> list[AutopilotAction]:
    """Ensure each vacant unit has a designed marketing graphic (cached on the unit).

    The Marketer agent reuses these graphics, so the Designer 'pre-designs' them.
    No autopilot action is emitted here — the work is the cached graphic itself.
    """
    estate_ids = await owner_estate_ids(db, user)
    if not estate_ids:
        return []

    rows = (await db.execute(
        select(Unit, Estate).join(Estate, Unit.estate == Estate.id).where(
            Unit.estate.in_(estate_ids), Unit.status == "vacant",
        )
    )).all()

    for unit, estate in rows:
        if getattr(unit, "listing_graphic_url", None):
            continue
        ctx = {
            "unit": unit.label, "estate": estate.name,
            "price": f"₦{unit.monthly_price:,.0f}/mo" if unit.monthly_price else "price on request",
            "bedrooms": unit.bedrooms or "", "category": unit.category or "unit",
            "listing_type": unit.listing_type or "Rent",
        }
        await design_listing_graphic(db, str(user.id), ctx, unit=unit)
    return []
