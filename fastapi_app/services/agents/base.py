"""
Agent framework — shared foundation for the autonomous AI agent team.

Each agent (Designer, Marketer, Sales, Finance, Operations, HR) is a module that
exposes:
  - META: AgentMeta  (identity + which action types are safe to auto-execute)
  - async def scan(db, user) -> list[AutopilotAction]

The Autopilot orchestrator iterates every registered agent's scan() on a schedule
and on demand. Agents also react to live events via utils/event_hooks.py.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.autopilot_action import AutopilotAction
from models.base import gen_uuid
from models.estate import Estate
from models.user import User
from services import llm
from utils.time_utils import utcnow

logger = logging.getLogger(__name__)

# Model TIERS (provider-agnostic — see services/llm.py). Kept as HAIKU/SONNET
# names so existing agent calls like ai_text(..., model=SONNET) still resolve.
HAIKU = llm.FAST
SONNET = llm.DEEP


@dataclass
class AgentMeta:
    key: str            # "marketer"
    name: str           # "Marketer"
    emoji: str          # "📣"
    description: str    # one-line role
    # Action types this agent produces that are SAFE to auto-execute without
    # human approval ("full auto where safe"). Sensitive actions (payments,
    # hiring) are intentionally excluded so they always wait for approval.
    auto_safe: list[str] = field(default_factory=list)
    # Which business line this agent serves. BamiHost runs MANY businesses;
    # Estate/Real Estate is only one. "Company-wide" = cross-cutting (GM, HR,
    # Finance, Support). This lets the team and Head Office reason per line.
    business_line: str = "Real Estate"


async def ai_text(system: str, prompt: str, model: str = HAIKU, max_tokens: int = 400) -> str:
    """Call the configured LLM and return the text response (async-safe).

    `model` carries a tier (HAIKU/SONNET → llm.FAST/DEEP); the concrete model id
    is resolved per provider inside services/llm.py.
    """
    return await llm.text(system, prompt, tier=model, max_tokens=max_tokens)


async def ai_analyze(role: str, facts: str, ask: str,
                     tier: str = SONNET, max_tokens: int = 480) -> str:
    """Deeper-intelligence helper for the analytical agents.

    Wraps the LLM in a consistent senior-analyst contract so every agent's
    output is specific, quantified and prioritised — not a generic blurb. The
    model is told to lead with the single most important finding, quantify the
    impact in ₦ where it can, then give a numbered, prioritised action list.

    `role`  — who the agent is ("an energy/metering operations lead …").
    `facts` — the real data the agent gathered (numbers, names, ₦ amounts).
    `ask`   — the specific decision/output wanted.
    """
    system = (
        f"You are {role} for BamiHost, a Nigerian multi-business company (property, "
        "smart metering and more). Think like a sharp senior operator, not a chatbot. "
        "Structure your answer as:\n"
        "1) HEADLINE — one blunt sentence on the single most important thing here.\n"
        "2) WHY IT MATTERS — the business impact, quantified in ₦ or numbers when the data allows.\n"
        "3) DO THIS — a short numbered list (max 3) of specific, concrete next actions, "
        "most urgent first, each naming who/what.\n"
        "Rules: use ONLY the numbers in the data — never invent figures. Be concrete "
        "(name the tenant/meter/estate). No corporate filler. Nigeria-appropriate. "
        f"Keep the whole thing tight (under ~{max(90, max_tokens // 3)} words)."
    )
    prompt = f"DATA:\n{facts}\n\nTASK: {ask}"
    return await llm.text(system, prompt, tier=tier, max_tokens=max_tokens)


def make_action(owner_id: str, skill: str, action_type: str, title: str,
                description: str, content: str | None, platform: str | None,
                trigger_event: str, trigger_context: dict,
                priority: str = "medium", recipients: list | None = None,
                auto_execute: bool = False, image_url: str | None = None) -> AutopilotAction:
    return AutopilotAction(
        id=gen_uuid(),
        owner_id=owner_id,
        skill=skill,
        action_type=action_type,
        title=title,
        description=description,
        content=content,
        platform=platform,
        image_url=image_url,
        trigger_event=trigger_event,
        trigger_context=trigger_context,
        priority=priority,
        recipients=recipients or [],
        auto_execute=auto_execute,
    )


async def owner_estate_ids(db: AsyncSession, user: User) -> list[str]:
    """Estate IDs this user can act on. super_admin → all active; else owned."""
    uid = str(user.id)
    if str(getattr(user, "role", "")) == "super_admin":
        rows = (await db.execute(
            select(Estate.id).where(Estate.is_active == True)  # noqa: E712
        )).scalars().all()
    else:
        rows = (await db.execute(
            select(Estate.id).where(Estate.owner == uid, Estate.is_active == True)  # noqa: E712
        )).scalars().all()
    return list(rows)


async def active_business_lines(db: AsyncSession, user: User) -> list[str]:
    """Which business lines this owner ACTUALLY operates, detected from their data.

    BamiHost is a multi-business platform — never assume "the business" is estate.
    A line is reported only if the owner has data in it, so the GM and Head Office
    speak about the lines that exist, not a hard-coded list.
    """
    from sqlalchemy import func

    estate_ids = await owner_estate_ids(db, user)
    lines: list[str] = []
    if estate_ids:
        lines.append("Real Estate")
        # Smart Metering rides on the same estates; report it only if meters exist.
        try:
            from models.meter_device import MeterDevice
            meters = (await db.execute(
                select(func.count()).select_from(MeterDevice).where(
                    MeterDevice.estate.in_(estate_ids)
                )
            )).scalar() or 0
            if meters:
                lines.append("Smart Metering")
        except Exception as e:  # metering is optional — never break the roster
            logger.debug("[AGENTS] business-line probe (metering) skipped: %s", e)
    return lines


async def deliver_owner_actions(db: AsyncSession, user: User,
                                actions: "list[AutopilotAction]") -> int:
    """Take a REAL action on the owner-facing briefings the team produced.

    The team no longer just fills a dashboard — for every auto-execute, owner-
    facing item (a briefing/alert with no tenant recipients), we push the content
    straight to the owner on Telegram and mark it delivered. Tenant-facing sends
    (reminders, notices) are deliberately NOT touched here — those always wait for
    explicit approval so we never message a tenant automatically.

    Returns the number of items actually delivered.
    """
    try:
        from utils.telegram_service import send_to_owner, is_configured
    except Exception:
        return 0
    if not is_configured():
        return 0

    delivered = 0
    for a in actions:
        owner_facing = (a.platform in ("internal", "telegram")) and not (a.recipients or [])
        if not (getattr(a, "auto_execute", False) and owner_facing and a.content):
            continue
        try:
            emoji = AGENT_EMOJI.get(a.skill, "📌")
            res = await send_to_owner(
                db, str(user.id),
                f"{emoji} *{a.title}*\n\n{a.content}")
            if res.get("success"):
                a.status = "done"
                a.executed_at = utcnow()
                a.execution_result = {"auto_delivered": "telegram"}
                delivered += 1
        except Exception as e:
            logger.warning("[AGENTS] owner delivery failed for %s: %s", a.skill, e)
    return delivered


# Emoji per skill for owner deliveries (kept here to avoid importing the registry,
# which would be a circular import). Mirrors each agent's META.emoji.
AGENT_EMOJI: dict[str, str] = {
    "gm": "🧭", "analyst": "📊", "operations": "🔧", "metering": "⚡",
    "legal": "⚖️", "support": "💬", "procurement": "🧾", "compliance": "📋",
    "finance": "💰", "collections": "⏰", "retention": "🔁", "sales": "💼",
    "marketer": "📣", "designer": "🎨", "hr": "👥", "records": "🗂️",
}
