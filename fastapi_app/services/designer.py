"""
Designer — the background graphic-design agent.

Runs autonomously (no UI). When other parts of the system need visuals — a new
property is listed, a vacancy opens, a campaign goes out — they ask the Designer
to produce a branded marketing graphic. The Designer pulls the owner's brand
assets (colours/logo), builds a prompt, generates the image via Nano Banana, and
stores it on Cloudinary.

Listing graphics are cached on the Unit (`listing_graphic_url`) so each property
is designed once and reused across every social post, instead of regenerating on
every autopilot scan.
"""
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.brand_asset import BrandAsset
from utils.image_gen import generate_and_store, is_image_gen_configured

logger = logging.getLogger(__name__)


async def _owner_brand(db: AsyncSession, owner_id: str) -> dict:
    """Read the owner's brand colours + business name for design prompts."""
    rows = (await db.execute(
        select(BrandAsset).where(
            BrandAsset.owner_id == owner_id, BrandAsset.is_active == True,  # noqa: E712
        )
    )).scalars().all()
    colors = [
        a.extra_data.get("hex")
        for a in rows
        if a.asset_type == "color" and (a.extra_data or {}).get("hex")
    ]
    logo = next((a.url for a in rows if a.asset_type == "logo" and a.url), None)
    return {"colors": colors, "logo": logo}


def _listing_prompt(ctx: dict, brand: dict) -> str:
    """Build the marketing-graphic prompt for a property listing."""
    palette = ", ".join(brand.get("colors") or []) or "an elegant premium palette (deep navy, gold, ivory)"
    bedrooms = ctx.get("bedrooms")
    bed_str = f"{bedrooms}-bedroom " if bedrooms else ""
    return (
        "A polished, social-media-ready real-estate marketing graphic (square 1:1) "
        f"advertising a {bed_str}{ctx.get('category', 'property')} FOR {ctx.get('listing_type', 'RENT').upper()} "
        f"at {ctx.get('estate', 'a premium estate')} in Nigeria. "
        f"Headline text: '{ctx.get('unit', 'Now Available')}'. "
        f"Show the price prominently: {ctx.get('price', 'Price on request')}. "
        "Modern, clean, aspirational property advertisement with a tasteful building/interior illustration, "
        f"bold readable typography, and a clear 'Enquire Now' call-to-action. "
        f"Brand colour palette: {palette}. "
        "High contrast, professional, no watermark. Spell all text correctly."
    )


async def design_listing_graphic(
    db: AsyncSession, owner_id: str, ctx: dict, unit=None, force: bool = False,
) -> str | None:
    """
    Ensure a branded marketing graphic exists for a listing and return its URL.

    If `unit` is given and already has a cached `listing_graphic_url`, that is
    reused (unless force=True). Otherwise a new graphic is generated, cached on
    the unit, and returned. Returns None if image generation isn't configured or
    fails (callers should degrade to text-only).
    """
    if unit is not None and not force:
        cached = getattr(unit, "listing_graphic_url", None)
        if cached:
            return cached

    if not is_image_gen_configured():
        logger.info("[DESIGNER] image gen not configured — skipping graphic for owner %s", owner_id)
        return None

    brand = await _owner_brand(db, owner_id)
    prompt = _listing_prompt(ctx, brand)
    stored = await generate_and_store(prompt, folder=f"bamihost/designer/{owner_id}/listings")
    if not stored:
        return None

    url = stored["url"]
    if unit is not None:
        unit.listing_graphic_url = url
        # caller is responsible for committing within its own session/transaction
    logger.info("[DESIGNER] designed listing graphic for owner %s: %s", owner_id, url)
    return url


async def design_marketing_graphic(db: AsyncSession, owner_id: str, prompt_subject: str) -> str | None:
    """Generic branded marketing graphic for any subject (campaigns, promos, etc.)."""
    if not is_image_gen_configured():
        return None
    brand = await _owner_brand(db, owner_id)
    palette = ", ".join(brand.get("colors") or []) or "a premium brand palette"
    prompt = (
        f"A clean, professional social-media marketing graphic (square 1:1) for a Nigerian business: "
        f"{prompt_subject}. Modern, aspirational, bold readable typography, clear call-to-action. "
        f"Brand colour palette: {palette}. High contrast, no watermark, correct spelling."
    )
    stored = await generate_and_store(prompt, folder=f"bamihost/designer/{owner_id}/marketing")
    return stored["url"] if stored else None
