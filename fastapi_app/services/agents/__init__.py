"""
The autonomous AI agent team.

Every agent module exposes `META` (AgentMeta) and `async scan(db, user)`. The
Autopilot orchestrator iterates `ALL_AGENTS` to run the whole team.

Order matters: Designer runs first so it pre-designs listing graphics that the
Marketer then reuses.
"""
from sqlalchemy.ext.asyncio import AsyncSession

from models.user import User
from models.autopilot_action import AutopilotAction

from services.agents import (
    designer_agent, marketer_agent, sales_agent,
    finance_agent, operations_agent, hr_agent,
    retention_agent, collections_agent, analyst_agent, compliance_agent,
    records_agent, metering_agent, legal_agent, support_agent,
    procurement_agent, gm_agent,
)
from services.agents.base import AgentMeta

# Run order: Designer first (pre-designs graphics), then the rest.
# The GM runs LAST — run_all_agents hands him the whole team's output.
ALL_AGENTS = [
    designer_agent,
    marketer_agent,
    sales_agent,
    finance_agent,
    operations_agent,
    hr_agent,
    retention_agent,
    collections_agent,
    analyst_agent,
    compliance_agent,
    records_agent,
    metering_agent,
    legal_agent,
    support_agent,
    procurement_agent,
    gm_agent,
]

# Convenience: agent metadata keyed by agent key
AGENT_META: dict[str, AgentMeta] = {a.META.key: a.META for a in ALL_AGENTS}

# All action types that are safe to auto-execute, across the whole team.
AUTO_SAFE_TYPES: list[str] = sorted({t for a in ALL_AGENTS for t in a.META.auto_safe})


async def run_all_agents(db: AsyncSession, user: User) -> list[AutopilotAction]:
    """Run every agent's scan() and return the combined list of actions.

    The GM is special: he runs after everyone and receives the team's freshly
    generated actions (they are not in the DB yet at this point), so his
    State of the Company briefing covers what the team found THIS run."""
    import logging
    logger = logging.getLogger(__name__)
    actions: list[AutopilotAction] = []
    for agent in ALL_AGENTS:
        if agent is gm_agent:
            continue
        try:
            actions.extend(await agent.scan(db, user))
        except Exception as e:  # one agent failing must not break the team
            logger.error("[AGENTS] %s.scan failed: %s", agent.META.key, e)
    try:
        actions.extend(await gm_agent.scan(db, user, team_actions=actions))
    except Exception as e:
        logger.error("[AGENTS] gm.scan failed: %s", e)

    return actions
