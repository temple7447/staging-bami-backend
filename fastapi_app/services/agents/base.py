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

import anthropic
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.autopilot_action import AutopilotAction
from models.base import gen_uuid
from models.estate import Estate
from models.user import User

logger = logging.getLogger(__name__)

HAIKU = "claude-haiku-4-5"
SONNET = "claude-sonnet-4-6"

# Reuse one client across calls — constructing an AsyncAnthropic per request
# churns the underlying HTTP connection pool for no benefit.
_client: "anthropic.AsyncAnthropic | None" = None


def _get_client() -> "anthropic.AsyncAnthropic":
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


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
    """Call Claude and return the text response (async-safe)."""
    resp = await _get_client().messages.create(
        model=model, max_tokens=max_tokens, system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.content[0].text.strip() if resp.content else ""


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
