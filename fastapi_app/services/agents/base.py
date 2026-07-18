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
import re as _re
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
        "Rules: use ONLY the numbers in the DATA below — never invent figures, dates, counts, or status "
        "claims that aren't there. If something relevant isn't in the data (e.g. no social-media posting/"
        "analytics integration exists, so post performance is never tracked), say plainly it isn't tracked "
        "instead of guessing a plausible-sounding number — an honest 'we don't have that' beats any invented "
        "figure. Be concrete (name the tenant/meter/estate) with what IS real. No corporate filler. "
        f"Nigeria-appropriate. Keep the whole thing tight (under ~{max(90, max_tokens // 3)} words)."
    )
    prompt = f"DATA:\n{facts}\n\nTASK: {ask}"
    return await llm.text(system, prompt, tier=tier, max_tokens=max_tokens)


def _parse_review(resp: str) -> tuple[int, str | None]:
    """Pull (score, revised_text) out of a review response.

    Expected shape:
        SCORE: <1-10>
        ISSUES: ...
        REVISED:
        <improved deliverable, or the single word SAME>
    Missing/garbled parts degrade gracefully (score 0, no revision).
    """
    score = 0
    m = _re.search(r"SCORE:\s*(\d+)", resp, _re.IGNORECASE)
    if m:
        score = max(0, min(10, int(m.group(1))))
    revised = None
    m = _re.search(r"REVISED:\s*(.*)$", resp, _re.IGNORECASE | _re.DOTALL)
    if m:
        body = m.group(1).strip()
        if body and body.strip().upper() != "SAME":
            revised = body
    return score, revised


async def ai_refine(role: str, task: str, draft: str, rubric: str,
                    max_rounds: int = 2, target: int = 8,
                    tier: str = SONNET, max_tokens: int = 520) -> str:
    """Self-refinement loop: the model grades its own draft against a rubric and
    rewrites it, repeating until the score clears `target`, it stops improving,
    or `max_rounds` is hit — whichever comes first.

    This is a generator→critic→revise (reflection) loop. It is deliberately
    capped: quality plateaus after 2–3 rounds, so extra rounds only cost tokens.

    `role`   — who is judging/writing ("a Nigerian property lawyer").
    `task`   — what the deliverable is meant to achieve.
    `draft`  — the first-pass output to improve.
    `rubric` — the concrete bar to grade against (specific = better self-judging).
    """
    best = (draft or "").strip()
    if not best:
        return best
    last_score = -1
    for _ in range(max(1, max_rounds)):
        system = (
            f"You are {role}, reviewing a draft like a demanding editor. Grade it "
            f"honestly against the rubric, then improve it. Respond EXACTLY as:\n"
            "SCORE: <integer 1-10>\n"
            "ISSUES: <one line, the biggest weaknesses, or 'none'>\n"
            "REVISED:\n<the improved version in full — or the single word SAME if it "
            "already fully meets the rubric>\n"
            "FABRICATION CHECK (do this first, it overrides the score): scan the draft for any specific "
            "number, date, status, or metric that could not plausibly be known or verified — especially "
            "social-media view/save/impression/click counts or 'post is live/scheduled' claims, since "
            "BamiHost has no integration that tracks or publishes to social platforms. If you find any, "
            "score it no higher than 3 and rewrite that part as an honest statement that it isn't tracked, "
            "instead of repeating or softening the invented number. Never invent facts or numbers of your "
            "own either. Keep the length similar."
        )
        prompt = (f"TASK: {task}\n\nRUBRIC (grade against this):\n{rubric}\n\n"
                  f"DRAFT:\n{best}")
        try:
            resp = await llm.text(system, prompt, tier=tier, max_tokens=max_tokens)
        except Exception as e:
            logger.warning("[REFINE] review call failed: %s", e)
            break
        score, revised = _parse_review(resp)
        if revised:
            best = revised.strip()
        # Stop when good enough, or when it's no longer improving.
        if score >= target or score <= last_score or not revised:
            break
        last_score = score
    return best


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
