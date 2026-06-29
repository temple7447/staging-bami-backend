"""
BamiHustle Business Autopilot
Monitors the business 24/7, generates AI content, and executes actions
(WhatsApp blasts, reminders, post captions, follow-ups, reports).
"""
import logging
import anthropic
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
from utils.whatsapp_service import send_sms, send_whatsapp, is_configured, normalize_phone

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/autopilot", tags=["Autopilot"])

HAIKU = "claude-haiku-4-5-20251001"
SONNET = "claude-sonnet-4-6"


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _ai(system: str, prompt: str, model: str = HAIKU, max_tokens: int = 400) -> str:
    """Call Claude and return the text response."""
    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    resp = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    return resp.content[0].text.strip() if resp.content else ""


def _action(owner_id: str, skill: str, action_type: str, title: str,
            description: str, content: str | None, platform: str | None,
            trigger_event: str, trigger_context: dict,
            priority: str = "medium", recipients: list | None = None,
            auto_execute: bool = False) -> AutopilotAction:
    return AutopilotAction(
        id=gen_uuid(),
        owner_id=owner_id,
        skill=skill,
        action_type=action_type,
        title=title,
        description=description,
        content=content,
        platform=platform,
        trigger_event=trigger_event,
        trigger_context=trigger_context,
        priority=priority,
        recipients=recipients or [],
        auto_execute=auto_execute,
    )


# ─── Core: Generate Actions from Business State ───────────────────────────────

async def generate_actions(db: AsyncSession, user: User) -> list[AutopilotAction]:
    """
    Scan the business and return a list of autopilot actions with AI-generated content.
    Called by the scheduler daily and on-demand from the dashboard.
    """
    actions: list[AutopilotAction] = []
    uid = str(user.id)

    # --- 1. Vacant units → Marketer posts --------------------------
    vacant_q = (
        select(Unit, Estate)
        .join(Estate, Unit.estate_id == Estate.id)
        .where(Unit.owner_id == uid, Unit.is_occupied == False)
    )
    vacant_rows = (await db.execute(vacant_q)).all()

    for unit, estate in vacant_rows:
        ctx = {
            "unit": unit.label,
            "estate": estate.name,
            "price": f"₦{unit.monthly_price:,.0f}/mo" if unit.monthly_price else "price on request",
            "bedrooms": unit.bedrooms or "",
            "category": unit.category or "unit",
        }

        # WhatsApp broadcast
        wa_content = await _ai(
            "You are a Nigerian property marketer. Write a short WhatsApp message (max 3 lines) "
            "to broadcast a property listing. Use plain text, no markdown. Be conversational and add urgency.",
            f"Property: {ctx['bedrooms']}bed {ctx['category']} at {ctx['estate']}, {ctx['price']}. "
            "Write the broadcast message."
        )
        actions.append(_action(
            uid, "marketer", "whatsapp_blast",
            f"WhatsApp blast — {unit.label}, {estate.name}",
            "Send a WhatsApp broadcast to your contact list advertising this vacant unit.",
            wa_content, "whatsapp", "vacancy_opened", ctx, priority="high"
        ))

        # Instagram caption
        ig_content = await _ai(
            "You are a Nigerian property marketer. Write an Instagram caption for a property listing. "
            "Include relevant emojis, 3-5 hashtags, and a call to action. Max 150 words.",
            f"Property: {ctx['bedrooms']}bed {ctx['category']} at {ctx['estate']}, {ctx['price']}. "
            "Write the Instagram caption."
        )
        actions.append(_action(
            uid, "marketer", "instagram_post",
            f"Instagram post — {unit.label}, {estate.name}",
            "Post this caption on Instagram with property photos to attract leads.",
            ig_content, "instagram", "vacancy_opened", ctx
        ))

        # Facebook post
        fb_content = await _ai(
            "You are a Nigerian property marketer. Write a Facebook post for a property listing. "
            "Be detailed (100-150 words), include features, price, and how to contact. No markdown.",
            f"Property: {ctx['bedrooms']}bed {ctx['category']} at {ctx['estate']}, {ctx['price']}. "
            "Write the Facebook post."
        )
        actions.append(_action(
            uid, "marketer", "facebook_post",
            f"Facebook post — {unit.label}, {estate.name}",
            "Share this on your Facebook page or in property groups to reach more prospects.",
            fb_content, "facebook", "vacancy_opened", ctx
        ))

    # --- 2. Overdue tenants → Finance reminders --------------------
    overdue_q = (
        select(Tenant, Unit, Estate)
        .join(Unit, Tenant.unit_id == Unit.id)
        .join(Estate, Unit.estate_id == Estate.id)
        .where(
            Tenant.owner_id == uid,
            Tenant.is_active == True,
            (Tenant.rent_outstanding + Tenant.service_charge_outstanding) > 0,
        )
    )
    overdue_rows = (await db.execute(overdue_q)).all()

    for tenant, unit, estate in overdue_rows:
        outstanding = (tenant.rent_outstanding or 0) + (tenant.service_charge_outstanding or 0)
        ctx = {
            "name": tenant.name,
            "unit": unit.label,
            "estate": estate.name,
            "outstanding": f"₦{outstanding:,.0f}",
        }
        recipients = []
        if tenant.phone:
            recipients.append({"name": tenant.name, "phone": tenant.phone, "email": tenant.email or ""})

        reminder_msg = await _ai(
            "You are a professional Nigerian property manager. Write a polite but firm WhatsApp/SMS "
            "payment reminder. Max 3 sentences. Address the tenant by name. Be professional, not aggressive.",
            f"Tenant: {tenant.name}, Unit: {unit.label} at {estate.name}, "
            f"Outstanding: ₦{outstanding:,.0f}. Write the reminder."
        )
        actions.append(_action(
            uid, "finance", "payment_reminder",
            f"Payment reminder — {tenant.name} ({unit.label})",
            f"{tenant.name} owes ₦{outstanding:,.0f}. Send a polite reminder now.",
            reminder_msg, "whatsapp", "tenant_overdue", ctx,
            priority="high", recipients=recipients, auto_execute=False
        ))

    # --- 3. Pending enquiries → Sales follow-ups -------------------
    enquiry_q = select(Enquiry).where(
        Enquiry.owner_id == uid,
        Enquiry.status == "pending",
    )
    enquiries = (await db.execute(enquiry_q)).scalars().all()

    for enq in enquiries:
        ctx = {
            "name": enq.name,
            "unit_interest": getattr(enq, "unit_interest", "") or "",
            "phone": enq.phone or "",
        }
        recipients = []
        if enq.phone:
            recipients.append({"name": enq.name, "phone": enq.phone, "email": getattr(enq, "email", "") or ""})

        follow_up = await _ai(
            "You are a Nigerian property sales consultant. Write a friendly WhatsApp follow-up "
            "message to a property enquiry. Max 4 sentences. Offer to schedule a viewing. "
            "Be warm and professional.",
            f"Prospect name: {enq.name}, interested in: {ctx['unit_interest'] or 'a property'}. "
            "Write the follow-up message."
        )
        actions.append(_action(
            uid, "sales", "follow_up",
            f"Follow up — {enq.name}",
            f"Send a follow-up to {enq.name} who has a pending enquiry. Move them closer to signing.",
            follow_up, "whatsapp", "new_enquiry", ctx,
            priority="high", recipients=recipients
        ))

    # --- 4. Open issues → Operations vendor assignment -------------
    issue_q = select(Issue).where(
        Issue.owner_id == uid,
        Issue.status.in_(["open", "pending"]),
    )
    issues = (await db.execute(issue_q)).scalars().all()

    if issues:
        high = [i for i in issues if getattr(i, "priority", "") == "high"]
        ctx = {"open_count": len(issues), "high_priority": len(high)}

        ops_advice = await _ai(
            "You are a property operations manager. Give a brief action plan (3 bullet points max) "
            "for handling open maintenance issues. Be specific and practical.",
            f"{len(issues)} open issues, {len(high)} are high priority. "
            "What should the manager do today to resolve these?"
        )
        actions.append(_action(
            uid, "operations", "maintenance_plan",
            f"Maintenance action plan — {len(issues)} open issues",
            "Your Operations AI has reviewed open issues and created an action plan.",
            ops_advice, "internal", "issue_reported", ctx,
            priority="high" if high else "medium"
        ))

    # --- 5. Daily business briefing (always generated) -------------
    briefing = await _ai(
        "You are the BamiHustle Business AI. Generate a concise morning business briefing "
        "for a Nigerian property manager. Use bullet points. Max 120 words. "
        "Mention what to focus on today: occupancy, cash flow, follow-ups, maintenance.",
        f"Business snapshot: {len(vacant_rows)} vacant units, {len(overdue_rows)} overdue tenants, "
        f"{len(enquiries)} pending enquiries, {len(issues)} open issues. "
        "Write today's briefing.",
        model=SONNET, max_tokens=300,
    )
    actions.append(_action(
        uid, "marketer", "daily_briefing",
        f"Daily Business Briefing — {datetime.utcnow().strftime('%d %b %Y')}",
        "Your AI-generated daily briefing. Start your day here.",
        briefing, "internal", "daily_briefing",
        {"vacant": len(vacant_rows), "overdue": len(overdue_rows),
         "enquiries": len(enquiries), "issues": len(issues)},
        priority="medium"
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
    - whatsapp_blast / payment_reminder / follow_up → send via Termii
    - instagram_post / facebook_post               → mark done (user posts manually)
    - internal / daily_briefing                    → mark done
    """
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

    recipients = body.recipients or action.recipients or []
    result: dict = {}

    # WhatsApp / SMS send
    if action.platform == "whatsapp" and action.content:
        if not is_configured():
            result = {"success": False, "error": "Termii not configured — message copied to clipboard instead"}
        else:
            sent = []
            failed = []
            for r in recipients:
                phone = r.get("phone", "")
                if not phone:
                    failed.append(r)
                    continue
                res = await send_sms(phone, action.content)
                (sent if res.get("success") else failed).append({**r, "result": res})
            result = {"sent": sent, "failed": failed, "success": len(sent) > 0}

    # Social / internal — just mark done, content is copied by frontend
    elif action.platform in ("instagram", "facebook", "email", "internal"):
        result = {"success": True, "note": "Content ready — user posts manually"}

    else:
        result = {"success": True, "note": "Action acknowledged"}

    # Update action
    action.status = "done"
    action.executed_at = datetime.utcnow()
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
    platform = body.get("platform", "whatsapp")
    topic = body.get("topic", "property listing")
    context = body.get("context", "")

    PLATFORM_PROMPTS = {
        "whatsapp": "Write a WhatsApp broadcast message. Max 3 lines. Plain text. Conversational. Nigerian tone.",
        "instagram": "Write an Instagram caption. Use emojis. Add 5 hashtags. Max 100 words. Engaging CTA.",
        "facebook": "Write a Facebook post. Detailed (100-150 words). Include features, price, contact info.",
        "twitter": "Write a tweet (max 240 chars). Punchy. Include 2-3 hashtags. Nigerian property audience.",
        "email": "Write a professional property email. Subject line first, then body. Formal but warm. Max 200 words.",
        "sms": "Write an SMS (max 160 chars). Direct. Include a phone number placeholder [PHONE].",
    }

    system = PLATFORM_PROMPTS.get(platform, PLATFORM_PROMPTS["whatsapp"])
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
        "trigger_event": a.trigger_event,
        "trigger_context": a.trigger_context,
        "recipients": a.recipients,
        "auto_execute": a.auto_execute,
        "executed_at": a.executed_at.isoformat() if a.executed_at else None,
        "execution_result": a.execution_result,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }
