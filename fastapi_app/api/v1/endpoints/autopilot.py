"""
BamiHost Business Autopilot
Monitors the business 24/7, generates AI content, and executes actions
(WhatsApp blasts, reminders, post captions, follow-ups, reports).
"""
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel
from typing import Optional

from models.user import User
from models.tenant import Tenant
from models.unit import Unit
from models.estate import Estate
from models.billing_item import BillingItem
from models.enquiry import Enquiry
from models.issue import Issue
from models.autopilot_action import AutopilotAction
from models.base import gen_uuid
from core.security import get_current_user
from core.database import get_db
from core.config import settings
from utils.telegram_service import send_to_tenant_by_phone, send_to_owner, is_configured
from utils.time_utils import utcnow
from services import llm

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/autopilot", tags=["Autopilot"])

# Provider-agnostic model tiers (see services/llm.py).
HAIKU = llm.FAST
SONNET = llm.DEEP


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _ai(system: str, prompt: str, model: str = HAIKU, max_tokens: int = 400) -> str:
    """Call the configured LLM and return the text response."""
    return await llm.text(system, prompt, tier=model, max_tokens=max_tokens)


def _action(owner_id: str, skill: str, action_type: str, title: str,
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


# ─── Ops Manager proposal executor ─────────────────────────────────────────────
# Dispatches an approved AutopilotAction(skill="ops_manager") by its
# action_type ("kind" in the proposal), actually applying trigger_context
# (the proposal payload) to the relevant resource.

async def _execute_ops_proposal(db: AsyncSession, current_user: User, action: AutopilotAction) -> dict:
    payload = action.trigger_context or {}
    kind = action.action_type
    owner_id = str(current_user.id)

    if kind == "lead_page":
        from models.lead_page import LeadPage
        from api.v1.endpoints.lead_capture import _slugify, _unique_slug

        page_id = payload.get("id")
        page = None
        if page_id:
            page = (await db.execute(
                select(LeadPage).where(LeadPage.id == page_id, LeadPage.owner_id == owner_id)
            )).scalar_one_or_none()
        if page:
            for k in ("title", "headline", "subheadline", "body", "cta_text", "thank_you_message"):
                if k in payload:
                    setattr(page, k, payload[k])
            return {"success": True, "note": f"Updated lead page {page.slug}", "lead_page_id": page.id}
        slug = await _unique_slug(db, _slugify(payload.get("title") or "page"))
        page = LeadPage(
            id=gen_uuid(), owner_id=owner_id, slug=slug,
            title=payload.get("title", "Untitled page"),
            headline=payload.get("headline", ""), subheadline=payload.get("subheadline", ""),
            body=payload.get("body", ""), cta_text=payload.get("cta_text", "Get instant access"),
        )
        db.add(page)
        await db.flush()
        return {"success": True, "note": f"Created lead page /p/{page.slug}", "lead_page_id": page.id}

    if kind == "integration":
        from models.integration import BusinessIntegration
        from utils.crypto import encrypt_secret

        integ = BusinessIntegration(
            id=gen_uuid(), owner_id=owner_id,
            name=payload.get("name", "Integration"), kind=payload.get("kind", "custom"),
            base_url=payload.get("base_url", ""), auth_header=payload.get("auth_header", "Authorization"),
            auth_value_encrypted=encrypt_secret(payload["auth_value"]) if payload.get("auth_value") else None,
        )
        db.add(integ)
        await db.flush()
        return {"success": True, "note": f"Created integration '{integ.name}'", "integration_id": integ.id}

    if kind == "task":
        # No safe generic mutation exists for an arbitrary "task" — this is a
        # reminder for the human, acknowledged not auto-actioned.
        return {"success": True, "note": "Task acknowledged — action it manually"}

    # report / agent_create / agent_update / other — nothing safe to auto-apply.
    return {"success": True, "note": "Proposal acknowledged — no automatic action defined for this kind"}


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _owner_estate_ids(db: AsyncSession, user: User) -> list[str]:
    """Estate IDs this user can act on. super_admin → all active; else owned.

    Child records (units, tenants, issues, enquiries) link to an estate, not
    directly to the owner, so we always scope queries through the estates.
    """
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


# ─── Core: Generate Actions from Business State ───────────────────────────────

async def generate_actions(db: AsyncSession, user: User) -> list[AutopilotAction]:
    """
    Scan the business and return a list of autopilot actions with AI-generated content.
    Called by the scheduler daily and on-demand from the dashboard.
    """
    # Run the full agent team. Each agent scans its own domain and returns actions.
    # Designer runs first and pre-designs listing graphics the Marketer reuses.
    from services.agents import run_all_agents
    actions = await run_all_agents(db, user)

    # Daily business briefing, derived from what the team found this scan.
    by_type: dict[str, int] = {}
    for a in actions:
        by_type[a.action_type] = by_type.get(a.action_type, 0) + 1
    vacant    = by_type.get("telegram_blast", 0)
    overdue   = by_type.get("payment_reminder", 0)
    enquiries = by_type.get("follow_up", 0)
    has_issues = by_type.get("maintenance_plan", 0) > 0

    briefing = await _ai(
        "You are the BamiHost Business AI. Generate a concise morning business briefing "
        "for a Nigerian property manager. Use bullet points. Max 120 words. "
        "Mention what to focus on today: occupancy, cash flow, follow-ups, maintenance.",
        f"Business snapshot: {vacant} vacant units, {overdue} overdue tenants, "
        f"{enquiries} pending enquiries, {'open issues need attention' if has_issues else 'no open issues'}. "
        "Write today's briefing.",
        model=SONNET, max_tokens=300,
    )
    actions.append(_action(
        str(user.id), "marketer", "daily_briefing",
        f"Daily Business Briefing — {utcnow().strftime('%d %b %Y')}",
        "Your AI-generated daily briefing. Start your day here.",
        briefing, "internal", "daily_briefing",
        {"vacant": vacant, "overdue": overdue, "enquiries": enquiries, "issues": has_issues},
        priority="medium",
    ))

    return actions


# ─── Routes ──────────────────────────────────────────────────────────────────

@router.post("/generate")
async def generate_autopilot_actions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    AI scans the full business and generates a fresh batch of actions.
    Old pending actions are cleared first.
    """
    uid = str(current_user.id)

    # Clear existing pending/approved actions (keep executed/dismissed history)
    existing = (await db.execute(
        select(AutopilotAction).where(
            AutopilotAction.owner_id == uid,
            AutopilotAction.status.in_(["pending", "approved"]),
        )
    )).scalars().all()
    for a in existing:
        await db.delete(a)

    # Generate new actions
    try:
        actions = await generate_actions(db, current_user)
    except Exception as e:
        logger.error(f"Autopilot generate error: {e}")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {e}")

    for a in actions:
        db.add(a)
    await db.commit()

    return {
        "generated": len(actions),
        "actions": [_serialize(a) for a in actions],
    }


@router.get("/agents")
async def get_agents(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Roster of the autonomous agent team + per-agent activity for this owner."""
    from services.agents import ALL_AGENTS
    from sqlalchemy import func as _func

    uid = str(current_user.id)
    # Count actions per skill (agent) for this owner
    rows = (await db.execute(
        select(AutopilotAction.skill, AutopilotAction.status, _func.count())
        .where(AutopilotAction.owner_id == uid)
        .group_by(AutopilotAction.skill, AutopilotAction.status)
    )).all()
    counts: dict[str, dict[str, int]] = {}
    for skill, status, n in rows:
        counts.setdefault(skill, {})[status] = n

    agents = []
    for a in ALL_AGENTS:
        m = a.META
        c = counts.get(m.key, {})
        agents.append({
            "key": m.key,
            "name": m.name,
            "emoji": m.emoji,
            "description": m.description,
            "auto_safe": m.auto_safe,
            "pending": c.get("pending", 0),
            "done": c.get("done", 0),
            "total": sum(c.values()),
        })
    return {"agents": agents}


@router.get("/queue")
async def get_queue(
    status: str = "pending",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all autopilot actions for the current user."""
    q = select(AutopilotAction).where(
        AutopilotAction.owner_id == str(current_user.id),
    ).order_by(AutopilotAction.created_at.desc())

    if status != "all":
        q = q.where(AutopilotAction.status == status)

    rows = (await db.execute(q)).scalars().all()
    return {"data": [_serialize(a) for a in rows]}


class ExecuteBody(BaseModel):
    recipients: Optional[list[dict]] = None   # override recipients if needed


@router.post("/execute/{action_id}")
async def execute_action(
    action_id: str,
    body: ExecuteBody = ExecuteBody(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Execute an autopilot action.
    - telegram platform  → send via Telegram bot to tenant's linked chat
    - social / internal  → mark done (content copied by frontend)
    """
    from utils.telegram_service import send_to_tenant_by_phone, send_to_owner, is_configured as tg_configured

    action = (await db.execute(
        select(AutopilotAction).where(
            AutopilotAction.id == action_id,
            AutopilotAction.owner_id == str(current_user.id),
        )
    )).scalar_one_or_none()

    if not action:
        raise HTTPException(status_code=404, detail="Action not found")

    if action.status == "done":
        return {"message": "Already executed", "action": _serialize(action)}

    # Ops Manager proposals dispatch by `action_type` (the proposal "kind"),
    # not by `platform` — this is the approval executor the reference app
    # (echo-web-heart) never built; there, "Approve" only flipped a status flag.
    if action.skill == "ops_manager":
        result = await _execute_ops_proposal(db, current_user, action)
        action.status = "done"
        action.executed_at = utcnow()
        action.execution_result = result
        await db.commit()
        return {"success": result.get("success", True), "result": result, "action": _serialize(action)}

    recipients = body.recipients or action.recipients or []
    result: dict = {}

    # Telegram send
    if action.platform in ("telegram", "whatsapp") and action.content:
        from utils.telegram_service import send_to_tenant
        # Cross-business guard: recipients are client-supplied, so only allow
        # messaging tenants that belong to THIS owner's estates. Otherwise an
        # owner could push arbitrary content to another business's tenants.
        allowed_estates = set(await _owner_estate_ids(db, current_user))

        async def _recipient_tenant(r: dict):
            tid = r.get("tenant_id", "")
            phone = r.get("phone", "")
            if tid:
                return await db.get(Tenant, tid)
            if phone:
                return (await db.execute(
                    select(Tenant).where(Tenant.tenant_phone == phone, Tenant.is_active == True)  # noqa: E712
                )).scalars().first()
            return None

        sent = []
        failed = []
        for r in recipients:
            name = r.get("name", "")
            tenant = await _recipient_tenant(r)
            if (r.get("tenant_id") or r.get("phone")):
                if not tenant or tenant.estate not in allowed_estates:
                    failed.append({**r, "result": {"success": False, "error": "Recipient not in your estates"}})
                    continue
                res = await send_to_tenant(db, tenant.id, action.content)
            else:
                # Fallback: notify the owner via Telegram with the message
                res = await send_to_owner(db, str(current_user.id),
                    f"📤 *Message for {name}* (no Telegram linked):\n\n{action.content}")
            (sent if res.get("success") else failed).append({**r, "result": res})
        result = {"sent": sent, "failed": failed, "success": len(sent) > 0}

    # Social / internal — just mark done, content is copied by frontend
    elif action.platform in ("instagram", "facebook", "email", "internal"):
        result = {"success": True, "note": "Content ready — user posts manually"}

    else:
        result = {"success": True, "note": "Action acknowledged"}

    # Update action
    action.status = "done"
    action.executed_at = utcnow()
    action.execution_result = result
    await db.commit()

    return {"success": result.get("success", True), "result": result, "action": _serialize(action)}


@router.put("/dismiss/{action_id}")
async def dismiss_action(
    action_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    action = (await db.execute(
        select(AutopilotAction).where(
            AutopilotAction.id == action_id,
            AutopilotAction.owner_id == str(current_user.id),
        )
    )).scalar_one_or_none()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")
    action.status = "dismissed"
    await db.commit()
    return {"dismissed": True}


@router.post("/generate-content")
async def generate_custom_content(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    On-demand content generation.
    body: { platform, topic, context }
    """
    platform = body.get("platform", "telegram")
    topic = body.get("topic", "property listing")
    context = body.get("context", "")

    PLATFORM_PROMPTS = {
        "telegram": "Write a Telegram broadcast message. Max 3 lines. Plain text. Conversational. Nigerian tone. Use *bold* for emphasis.",
        "instagram": "Write an Instagram caption. Use emojis. Add 5 hashtags. Max 100 words. Engaging CTA.",
        "facebook": "Write a Facebook post. Detailed (100-150 words). Include features, price, contact info.",
        "twitter": "Write a tweet (max 240 chars). Punchy. Include 2-3 hashtags. Nigerian property audience.",
        "email": "Write a professional property email. Subject line first, then body. Formal but warm. Max 200 words.",
        "sms": "Write an SMS (max 160 chars). Direct. Include a phone number placeholder [PHONE].",
    }

    system = PLATFORM_PROMPTS.get(platform, PLATFORM_PROMPTS["telegram"])
    content = await _ai(system, f"Topic: {topic}\nContext: {context}", model=SONNET, max_tokens=400)

    return {"platform": platform, "content": content}


@router.get("/stats")
async def autopilot_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    uid = str(current_user.id)
    all_actions = (await db.execute(
        select(AutopilotAction).where(AutopilotAction.owner_id == uid)
    )).scalars().all()

    pending   = [a for a in all_actions if a.status == "pending"]
    done      = [a for a in all_actions if a.status == "done"]
    dismissed = [a for a in all_actions if a.status == "dismissed"]

    by_skill: dict[str, int] = {}
    for a in pending:
        by_skill[a.skill] = by_skill.get(a.skill, 0) + 1

    return {
        "pending":   len(pending),
        "done":      len(done),
        "dismissed": len(dismissed),
        "total":     len(all_actions),
        "by_skill":  by_skill,
    }


# ─── Serializer ──────────────────────────────────────────────────────────────

def _serialize(a: AutopilotAction) -> dict:
    return {
        "id": a.id,
        "skill": a.skill,
        "action_type": a.action_type,
        "priority": a.priority,
        "status": a.status,
        "title": a.title,
        "description": a.description,
        "content": a.content,
        "platform": a.platform,
        "image_url": a.image_url,
        "trigger_event": a.trigger_event,
        "trigger_context": a.trigger_context,
        "recipients": a.recipients,
        "auto_execute": a.auto_execute,
        "executed_at": a.executed_at.isoformat() if a.executed_at else None,
        "execution_result": a.execution_result,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


class EmailCampaignRequest(BaseModel):
    subject: str
    body: str                              # plain text or simple HTML
    recipients: list[dict]                 # [{"name": "...", "email": "..."}]
    ai_personalize: bool = False           # ask AI to personalize each email


@router.post("/email-campaign")
async def send_email_campaign(
    body: EmailCampaignRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Send bulk email campaign to a list of recipients. AI personalization optional."""
    from utils.email_service import send_email, is_configured

    if not is_configured():
        raise HTTPException(status_code=400, detail="Email (Mailtrap) not configured. Set MAILTRAP_TOKEN and FROM_EMAIL env vars.")

    results = []
    for r in body.recipients:
        name  = r.get("name", "")
        email = r.get("email", "")
        if not email:
            continue

        html_body = body.body
        if body.ai_personalize:
            try:
                html_body = await llm.text(
                    "You are writing personalized marketing emails for a Nigerian property company. Keep it warm and professional. Return HTML only.",
                    f"Personalize this email for {name}:\n\n{body.body}",
                    tier=llm.FAST, max_tokens=400,
                ) or body.body
            except Exception:
                html_body = body.body

        result = await send_email(email=email, subject=body.subject, html=html_body, name=name)
        results.append({"email": email, "name": name, **result})

    sent = sum(1 for r in results if r.get("success"))
    failed = len(results) - sent
    return {"sent": sent, "failed": failed, "total": len(results), "results": results}


@router.get("/email-campaign/prospects")
async def get_email_prospects(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return list of all enquiry prospects with emails — ready for campaign targeting."""
    from models.enquiry import Enquiry

    estate_ids = await _owner_estate_ids(db, current_user) or ["__none__"]
    rows = (await db.execute(
        select(Enquiry).where(
            and_(
                (Enquiry.estate.in_(estate_ids)) | (Enquiry.owner_id == str(current_user.id)),
                Enquiry.email.isnot(None),
                Enquiry.email != "",
                Enquiry.status != "closed",
            )
        ).order_by(Enquiry.created_at.desc())
    )).scalars().all()

    return {
        "count": len(rows),
        "prospects": [
            {
                "name": e.name, "email": e.email, "phone": e.phone,
                "status": e.status, "subject": e.subject,
                "lead_score": e.lead_score, "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in rows
        ],
    }


# ── Auto-Execute Settings ──────────────────────────────────────────────────────

from models.autopilot_settings import AutopilotSettings


class AutopilotSettingsUpdate(BaseModel):
    auto_execute_types: Optional[list[str]] = None   # ["whatsapp_reminder", "follow_up", ...]
    enabled: Optional[bool] = None
    daily_scan_enabled: Optional[bool] = None
    notify_high_priority: Optional[bool] = None
    notify_all: Optional[bool] = None


@router.get("/settings")
async def get_autopilot_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = (await db.execute(
        select(AutopilotSettings).where(AutopilotSettings.owner_id == str(current_user.id))
    )).scalars().first()

    if not row:
        # Default to "full auto where safe": the agent team's safe action types
        # are pre-enabled for auto-execution; sensitive ones still wait for approval.
        from services.agents import AUTO_SAFE_TYPES
        return {
            "owner_id": str(current_user.id),
            "auto_execute_types": AUTO_SAFE_TYPES,
            "enabled": True,
            "daily_scan_enabled": True,
            "notify_high_priority": True,
            "notify_all": False,
        }

    return {
        "owner_id": row.owner_id,
        "auto_execute_types": row.auto_execute_types or [],
        "enabled": row.enabled,
        "daily_scan_enabled": row.daily_scan_enabled,
        "notify_high_priority": row.notify_high_priority,
        "notify_all": row.notify_all,
    }


@router.put("/settings")
async def update_autopilot_settings(
    body: AutopilotSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = (await db.execute(
        select(AutopilotSettings).where(AutopilotSettings.owner_id == str(current_user.id))
    )).scalars().first()

    if not row:
        row = AutopilotSettings(id=gen_uuid(), owner_id=str(current_user.id))
        db.add(row)

    if body.auto_execute_types is not None:
        row.auto_execute_types = body.auto_execute_types
    if body.enabled is not None:
        row.enabled = body.enabled
    if body.daily_scan_enabled is not None:
        row.daily_scan_enabled = body.daily_scan_enabled
    if body.notify_high_priority is not None:
        row.notify_high_priority = body.notify_high_priority
    if body.notify_all is not None:
        row.notify_all = body.notify_all

    await db.commit()
    return {"success": True, "message": "Settings saved"}


@router.post("/auto-run")
async def run_auto_execute(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Execute all pending actions whose action_type is in the owner's auto-execute list."""
    from utils.telegram_service import send_to_tenant_by_phone as _tg_send

    settings_row = (await db.execute(
        select(AutopilotSettings).where(AutopilotSettings.owner_id == str(current_user.id))
    )).scalars().first()

    if not settings_row or not settings_row.auto_execute_types:
        return {"executed": 0, "message": "No auto-execute rules configured"}

    auto_types = set(settings_row.auto_execute_types)

    pending_actions = (await db.execute(
        select(AutopilotAction).where(
            AutopilotAction.owner_id == str(current_user.id),
            AutopilotAction.status == "pending",
            AutopilotAction.action_type.in_(auto_types),
        )
    )).scalars().all()

    executed = 0
    for action in pending_actions:
        try:
            if action.platform in ("telegram", "whatsapp") and action.content and action.recipients:
                for r in (action.recipients or []):
                    phone = r.get("phone", "")
                    if phone:
                        await _tg_send(db, phone, action.content)
            action.status = "done"
            action.executed_at = utcnow()
            action.execution_result = {"auto_executed": True}
            executed += 1
        except Exception as e:
            logger.error("[AUTO_RUN] Failed for action %s: %s", action.id, e)

    await db.commit()
    return {"executed": executed, "total_eligible": len(pending_actions)}


# ── Telegram Broadcast to all tenants ─────────────────────────────────────────

class BroadcastRequest(BaseModel):
    message: str
    tenant_ids: Optional[list[str]] = None   # None = all tenants


@router.post("/broadcast")
async def telegram_broadcast(
    body: BroadcastRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Send a Telegram message to all (or selected) tenants who have linked their bot."""
    from utils.telegram_service import send_to_tenant
    from models.tenant import Tenant as TenantModel

    estate_ids = await _owner_estate_ids(db, current_user) or ["__none__"]
    conds = [TenantModel.estate.in_(estate_ids), TenantModel.is_active == True,  # noqa: E712
             TenantModel.telegram_id.isnot(None)]
    if body.tenant_ids:
        conds.append(TenantModel.id.in_(body.tenant_ids))

    tenants = (await db.execute(select(TenantModel).where(*conds))).scalars().all()

    sent, failed = 0, 0
    for t in tenants:
        res = await send_to_tenant(db, t.id, body.message)
        if res.get("success"):
            sent += 1
        else:
            failed += 1

    return {
        "sent": sent, "failed": failed,
        "total_with_telegram": len(tenants),
        "message": f"Broadcast sent to {sent} tenants via Telegram"
    }


# ── Paystack payment link auto-send ───────────────────────────────────────────

@router.post("/payment-links")
async def send_payment_links(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    For every overdue tenant who has Telegram linked:
    - Generate a Paystack payment link (if PAYSTACK_SECRET_KEY is set)
    - Send it via Telegram with their outstanding amount
    """
    import os, httpx
    from models.tenant import Tenant as TenantModel
    from utils.telegram_service import send_to_tenant

    PAYSTACK_KEY = os.getenv("PAYSTACK_SECRET_KEY", "")
    uid = str(current_user.id)

    estate_ids = await _owner_estate_ids(db, current_user) or ["__none__"]
    overdue = (await db.execute(
        select(TenantModel).where(
            TenantModel.estate.in_(estate_ids),
            TenantModel.is_active == True,  # noqa: E712
            TenantModel.rent_outstanding > 0,
            TenantModel.telegram_id.isnot(None),
        )
    )).scalars().all()

    results = []
    for t in overdue:
        outstanding = (t.rent_outstanding or 0) + (t.service_charge_outstanding or 0)
        email = t.tenant_email or ""
        payment_url = None

        # Try to generate Paystack link
        if PAYSTACK_KEY and email:
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    resp = await client.post(
                        "https://api.paystack.co/transaction/initialize",
                        headers={"Authorization": f"Bearer {PAYSTACK_KEY}"},
                        json={
                            "email": email,
                            "amount": int(outstanding * 100),  # kobo
                            "currency": "NGN",
                            "metadata": {"tenant_id": t.id, "owner_id": uid},
                        }
                    )
                    data = resp.json()
                    if data.get("status"):
                        payment_url = data["data"]["authorization_url"]
            except Exception as e:
                logger.warning("[PAYSTACK] Link gen failed for %s: %s", t.id, e)

        # Build Telegram message
        if payment_url:
            msg = (
                f"💳 *Payment Request — BamiHost*\n\n"
                f"Hi {t.tenant_name or 'Tenant'},\n\n"
                f"You have an outstanding balance of *₦{outstanding:,.0f}*.\n\n"
                f"Click below to pay securely via Paystack:\n"
                f"🔗 {payment_url}\n\n"
                f"Thank you for your prompt payment."
            )
        else:
            msg = (
                f"⚠️ *Rent Reminder — BamiHost*\n\n"
                f"Hi {t.tenant_name or 'Tenant'},\n\n"
                f"Your outstanding balance is *₦{outstanding:,.0f}*.\n\n"
                f"Please contact management to make payment. Thank you."
            )

        res = await send_to_tenant(db, t.id, msg)
        results.append({
            "tenant": t.tenant_name, "outstanding": outstanding,
            "payment_url": payment_url, "telegram_sent": res.get("success"),
        })

    sent = sum(1 for r in results if r["telegram_sent"])
    return {
        "processed": len(results),
        "telegram_sent": sent,
        "results": results,
    }
