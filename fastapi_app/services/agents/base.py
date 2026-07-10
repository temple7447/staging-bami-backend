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


async def ai_text(system: str, prompt: str, model: str = HAIKU, max_tokens: int = 400) -> str:
    """Call the configured LLM and return the text response (async-safe).

    `model` carries a tier (HAIKU/SONNET → llm.FAST/DEEP); the concrete model id
    is resolved per provider inside services/llm.py.
    """
    return await llm.text(system, prompt, tier=model, max_tokens=max_tokens)


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
