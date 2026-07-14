"""Marketer agent — turns vacant units into ready-to-post social content + a daily briefing.

Uses the marketing skill for expert copywriting and campaign strategy.
"""
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
    name="Moji · Marketer",
    emoji="📣",
    description="Expert marketing strategist — writes social posts, ad copy, email campaigns, and brand content for vacant units with the Designer's graphics.",
    # Drafting content is safe to auto-generate; actual posting/blasting still needs approval.
    auto_safe=["daily_briefing", "campaign_strategy", "ad_copy", "email_sequence"],
)


# ─── Marketing Skill System Prompt ─────────────────────────────────────────────

MARKETING_SKILL = """You are an expert Nigerian property marketer and copywriter. Use these frameworks:

FRAMEWORKS:
- AIDA: Attention → Interest → Desire → Action (long-form)
- PAS: Problem → Agitate → Solution (problem-aware)
- BAB: Before → After → Bridge (transformation)
- FAB: Feature → Advantage → Benefit (feature-heavy)

PRINCIPLES:
1. Lead with benefits, not features — what does the customer GET?
2. Be specific — numbers > vague claims ("47% faster" > "much faster")
3. Social proof matters — testimonials, case studies, numbers
4. Clear beats clever — don't sacrifice comprehension for creativity
5. One CTA per post/email — don't split attention
6. Know the audience — talk to their pain, not your product

NIGERIAN CONTEXT:
- Use ₦ figures, Nigerian cities, local property terms
- WhatsApp is primary — short, punchy, conversational
- Instagram — visual-first, emojis, 3-5 hashtags, strong CTA
- Facebook — 100-150 words, features + price + contact
- Email — subject line under 50 chars, benefit-driven

OUTPUT STYLE:
- Telegram-friendly: short paragraphs, bullet points
- Always specific: use estate names, unit details, ₦ figures
- Direct and action-oriented: end with ONE clear next action
- Warm but professional — trusted advisor, not chatbot
"""


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

        # WhatsApp — short, urgent, conversational
        wa = await ai_text(
            f"{MARKETING_SKILL}\n\nWrite a short WhatsApp message (max 3 lines) "
            "to broadcast a property listing. Plain text, conversational, add urgency.",
            f"Property: {ctx['bedrooms']}bed {ctx['category']} at {ctx['estate']}, {ctx['price']}.")
        actions.append(make_action(
            uid, "marketer", "telegram_blast", f"Telegram blast — {unit.label}, {estate.name}",
            "Broadcast this vacant unit to your contact list.", wa, "telegram",
            "vacancy_opened", ctx, priority="high", image_url=graphic))

        # Instagram — visual, emojis, hashtags, CTA
        ig = await ai_text(
            f"{MARKETING_SKILL}\n\nWrite an Instagram caption for a Nigerian property listing. "
            "Emojis, 3-5 hashtags, CTA. Max 150 words. Use FAB framework (Feature → Advantage → Benefit).",
            f"Property: {ctx['bedrooms']}bed {ctx['category']} at {ctx['estate']}, {ctx['price']}.")
        actions.append(make_action(
            uid, "marketer", "instagram_post", f"Instagram post — {unit.label}, {estate.name}",
            "Post this with the AI-designed graphic to attract leads.", ig, "instagram",
            "vacancy_opened", ctx, image_url=graphic))

        # Facebook — informative, features, contact
        fb = await ai_text(
            f"{MARKETING_SKILL}\n\nWrite a Facebook post for a Nigerian property listing. "
            "100-150 words, features, price, contact. No markdown. Use AIDA framework.",
            f"Property: {ctx['bedrooms']}bed {ctx['category']} at {ctx['estate']}, {ctx['price']}.")
        actions.append(make_action(
            uid, "marketer", "facebook_post", f"Facebook post — {unit.label}, {estate.name}",
            "Share on your page or property groups.", fb, "facebook",
            "vacancy_opened", ctx, image_url=graphic))

    return actions


async def generate_campaign_strategy(
    db: AsyncSession,
    user: User,
    campaign_brief: str,
) -> str:
    """Generate a full marketing campaign strategy from a brief."""
    from services.agents.base import ai_text

    return await ai_text(
        f"""{MARKETING_SKILL}

Generate a complete marketing campaign strategy based on this brief:

{campaign_brief}

Include:
## Campaign Objective
## Target Audience (Nigerian property context)
## Key Messaging & Value Propositions
## Channel Strategy (WhatsApp, Instagram, Facebook, Email)
## Content Plan (3-5 content pieces)
## Timeline (2-week or 30-day)
## Budget Allocation (in ₦)
## Success Metrics & KPIs
## A/B Testing Recommendations""",
        "Create a comprehensive campaign strategy.",
        tier=SONNET,
        max_tokens=2048,
    ) or "Could not generate strategy. Please try again."


async def generate_ad_copy(
    db: AsyncSession,
    user: User,
    ad_context: str,
    platform: str = "general",
) -> str:
    """Generate ad copy for a property/campaign."""
    from services.agents.base import ai_text

    return await ai_text(
        f"""{MARKETING_SKILL}

Create ad copy for: {ad_context}
Platform: {platform}

Provide:
- 3 headline variations (benefit-driven, under 10 words each)
- Body copy for each headline (2-3 sentences)
- Strong CTA options
- A/B test suggestions

Be specific to the Nigerian market. Use ₦ figures where applicable.""",
        "Generate compelling ad copy.",
        tier=SONNET,
        max_tokens=1024,
    ) or "Could not generate ad copy. Please try again."


async def generate_email_sequence(
    db: AsyncSession,
    user: User,
    sequence_brief: str,
) -> str:
    """Generate an email nurture sequence."""
    from services.agents.base import ai_text

    return await ai_text(
        f"""{MARKETING_SKILL}

Generate an email nurture sequence based on: {sequence_brief}

Create 3-5 emails with:
- Subject line (under 50 chars, benefit-driven)
- Preview text
- Body copy (short paragraphs, bullet points)
- CTA

Use PAS framework (Problem → Agitate → Solution) for cold leads.
Use BAB framework (Before → After → Bridge) for warm leads.""",
        "Create an email sequence.",
        tier=SONNET,
        max_tokens=1500,
    ) or "Could not generate email sequence. Please try again."
