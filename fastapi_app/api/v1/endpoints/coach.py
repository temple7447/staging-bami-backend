import json
import httpx
import logging
import cloudinary
import cloudinary.uploader
from fastapi import APIRouter, Request, HTTPException, Depends, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, delete
from pydantic import BaseModel
from typing import Optional
from core.database import AsyncSessionLocal, get_db
from core.config import settings
from core.security import get_current_user
from models.user import User
from models.coach import CoachUser, CoachMessage
from models.base import gen_uuid
from models.tenant_telegram import TenantTelegramSession
from services.ai_coach import get_coach_reply, fetch_business_context, _format_context
import services.tenant_bot as tenant_bot
import services.admin_bot as admin_bot

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/coach", tags=["AI Coach"])

TELEGRAM_API = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}"

TENANT_ROLES = {"tenant", "user"}
ADMIN_ROLES = {"admin", "super_admin", "business_owner", "manager", "super_manager"}

# Commands that always go to the tenant portal (when logged in as tenant)
TENANT_CMDS = {
    "/dashboard", "/balance", "/payments", "/billing", "/issues",
    "/report", "/requests", "/notifications", "/wallet", "/logout",
    "/menu", "/help",
}

# Commands that always go to the admin panel (when logged in as admin)
ADMIN_CMDS = {
    "/dashboard", "/tenants", "/estates", "/payments", "/issues",
    "/notify", "/search", "/logout", "/menu", "/help",
}


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def send_telegram_message(chat_id: int | str, text: str) -> None:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{TELEGRAM_API}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"},
            timeout=15,
        )
        if resp.status_code >= 400:
            logger.warning(f"Telegram sendMessage {resp.status_code}: {resp.text[:200]}")


async def get_or_create_coach_user(
    db: AsyncSession, telegram_id: str, first_name: str | None, username: str | None
) -> CoachUser:
    result = await db.execute(select(CoachUser).where(CoachUser.telegram_id == telegram_id))
    user = result.scalar_one_or_none()
    if not user:
        user = CoachUser(telegram_id=telegram_id, first_name=first_name, telegram_username=username)
        db.add(user)
        await db.commit()
        await db.refresh(user)
    return user


async def get_conversation_history(db: AsyncSession, telegram_id: str) -> list[dict]:
    result = await db.execute(
        select(CoachMessage)
        .where(CoachMessage.telegram_id == telegram_id)
        .order_by(desc(CoachMessage.created_at))
        .limit(20)
    )
    messages = result.scalars().all()
    return [{"role": m.role, "content": m.content} for m in reversed(messages)]


async def save_messages(db: AsyncSession, telegram_id: str, user_text: str, assistant_text: str) -> None:
    db.add(CoachMessage(telegram_id=telegram_id, role="user", content=user_text))
    db.add(CoachMessage(telegram_id=telegram_id, role="assistant", content=assistant_text))
    await db.commit()


async def get_session(db: AsyncSession, telegram_id: str) -> TenantTelegramSession | None:
    result = await db.execute(
        select(TenantTelegramSession).where(TenantTelegramSession.telegram_id == telegram_id)
    )
    return result.scalar_one_or_none()


# ─── Webhook ──────────────────────────────────────────────────────────────────

@router.post("/telegram/webhook")
async def telegram_webhook(request: Request):
    secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
    if settings.TELEGRAM_WEBHOOK_SECRET and secret != settings.TELEGRAM_WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="Invalid secret")

    body = await request.json()
    message = body.get("message") or body.get("edited_message")
    if not message:
        return {"ok": True}

    chat_id = message["chat"]["id"]
    text = message.get("text", "").strip()
    from_user = message.get("from", {})
    telegram_id = str(from_user.get("id", chat_id))
    first_name = from_user.get("first_name")
    username = from_user.get("username")

    if not text:
        return {"ok": True}

    cmd = text.lower().split()[0]  # first word only for command detection

    try:
        async with AsyncSessionLocal() as db:
            session = await get_session(db, telegram_id)
            state = session.state if session else "idle"
            role = session.role if session else None

            # ── /start — universal welcome ─────────────────────────────────────
            if cmd == "/start":
                reply = (
                    f"👋 Hello{f', {first_name}' if first_name else ''}! Welcome to *BamiHost*.\n\n"
                    "What would you like to do?\n\n"
                    "🏠 */tenant* — Tenant portal (rent, issues, payments)\n"
                    "🔐 */admin* — Management panel (owners, managers, admins)\n"
                    "🚀 */coach* — AI Business Coach (Level 7 framework)\n\n"
                    "Choose one to get started."
                )
                await send_telegram_message(chat_id, reply)
                return {"ok": True}

            # ── /tenant — enter tenant portal ──────────────────────────────────
            if cmd == "/tenant":
                if state == "logged_in" and role in TENANT_ROLES and session.tenant_id:
                    t = await tenant_bot.get_tenant(db, session.tenant_id)
                    reply = tenant_bot.main_menu(t) if t else "Send /tenant to login."
                else:
                    s = await tenant_bot.get_or_create_session(db, telegram_id)
                    await tenant_bot.update_session(db, s, state="awaiting_email",
                                                    user_id=None, tenant_id=None, role=None)
                    reply = (
                        "🏠 *Tenant Portal Login*\n\n"
                        "Enter your registered email address:"
                    )
                await send_telegram_message(chat_id, reply)
                return {"ok": True}

            # ── /admin — enter admin panel ─────────────────────────────────────
            if cmd == "/admin":
                if state == "admin:logged_in" and role in ADMIN_ROLES and session.user_id:
                    from services.admin_bot import get_user, get_my_estates
                    user = await get_user(db, session.user_id)
                    estates = await get_my_estates(db, user)
                    reply = admin_bot.admin_menu(user, estates) if user else "Send /admin to login."
                else:
                    s = await admin_bot.get_or_create_session(db, telegram_id)
                    await admin_bot.update_session(db, s, state="admin:awaiting_email",
                                                   user_id=None, tenant_id=None, role=None)
                    reply = (
                        "🔐 *Management Panel Login*\n\n"
                        "Enter your admin/manager/owner email address:"
                    )
                await send_telegram_message(chat_id, reply)
                return {"ok": True}

            # ── /coach — switch to AI coaching mode ───────────────────────────
            if cmd == "/coach":
                name_str = f", {first_name}" if first_name else ""
                logged_in_hint = ""
                if session and session.user_id and session.role:
                    logged_in_hint = "\n\nI already have access to your live business data from BamiHost, so I can coach you based on your real numbers."
                reply = (
                    f"🚀 *AI Business Coach — Level 7 Framework*{name_str}\n\n"
                    "I'm your personal coach trained on the Ryan Deiss Level 7 Masterclass."
                    f"{logged_in_hint}\n\n"
                    "What's your current biggest business challenge?"
                )
                await send_telegram_message(chat_id, reply)
                return {"ok": True}

            # ── Route based on current session state ───────────────────────────

            # Tenant flows
            tenant_states = {
                "awaiting_email", "awaiting_password", "logged_in",
                "tenant:report_issue",
            }
            if state in tenant_states:
                reply = await tenant_bot.handle(db, telegram_id, text, first_name)
                await send_telegram_message(chat_id, reply)
                return {"ok": True}

            # Any admin: prefixed state routes to the admin bot
            if state.startswith("admin:"):
                reply = await admin_bot.handle(db, telegram_id, text, first_name)
                await send_telegram_message(chat_id, reply)
                return {"ok": True}

            # ── No active session — default to AI Business Coach ──────────────
            coach_user = await get_or_create_coach_user(db, telegram_id, first_name, username)
            history = await get_conversation_history(db, telegram_id)
            user_profile = {
                "first_name": coach_user.first_name,
                "current_level": coach_user.current_level,
                "customers_served": coach_user.customers_served,
                "current_revenue": coach_user.current_revenue,
                "current_profit": coach_user.current_profit,
                "target_revenue": coach_user.target_revenue,
                "their_why": coach_user.their_why,
                "completed_levels": coach_user.completed_levels or [],
            }
            # Pass DB + user identity so AI can read live business data
            live_user_id = session.user_id if session else None
            live_role = session.role if session else None

            # If not logged in via /admin or /tenant, auto-resolve the business
            # account from the Telegram ID so the coach always has live data.
            if not live_user_id:
                linked = await db.execute(
                    select(User).where(User.telegram_id == telegram_id, User.is_active == True)  # noqa: E712
                )
                linked_user = linked.scalar_one_or_none()
                if linked_user:
                    live_user_id = linked_user.id
                    live_role = linked_user.role

            reply = await get_coach_reply(
                user_profile, history, text,
                db=db, user_id=live_user_id, role=live_role,
            )
            await save_messages(db, telegram_id, text, reply)
            await send_telegram_message(chat_id, reply)

    except Exception as e:
        logger.error(f"Webhook error for {telegram_id}: {e}", exc_info=True)
        await send_telegram_message(chat_id, "Sorry, I hit a snag. Try again in a moment.")

    return {"ok": True}


# ─── Setup endpoint ───────────────────────────────────────────────────────────

@router.post("/telegram/setup-webhook")
async def setup_webhook(webhook_url: str):
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{TELEGRAM_API}/setWebhook",
            json={
                "url": webhook_url,
                "secret_token": settings.TELEGRAM_WEBHOOK_SECRET or "",
                "allowed_updates": ["message", "edited_message"],
            },
            timeout=10,
        )
    return resp.json()


class WebChatRequest(BaseModel):
    message: str
    history: list[dict] = []


class SkillTriggerRequest(BaseModel):
    skill: str          # designer, marketer, sales, finance, operations, hr
    event: str          # what just happened: "new_property_listed", "new_tenant", "vacancy_opened", etc.
    context: dict = {}  # event-specific data (estate name, unit label, amount, etc.)


@router.get("/history")
async def get_web_chat_history(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the last 30 web chat messages for this user."""
    result = await db.execute(
        select(CoachMessage)
        .where(CoachMessage.web_user_id == str(current_user.id))
        .order_by(desc(CoachMessage.created_at))
        .limit(30)
    )
    messages = result.scalars().all()
    return {
        "history": [
            {"role": m.role, "content": m.content, "created_at": m.created_at.isoformat()}
            for m in reversed(messages)
        ]
    }


@router.post("/chat")
async def web_chat(
    body: WebChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Web-based AI coach chat — persists history to database."""
    uid = str(current_user.id)

    # Load last 12 messages from DB for context (ignore frontend-sent history)
    db_history_result = await db.execute(
        select(CoachMessage)
        .where(CoachMessage.web_user_id == uid)
        .order_by(desc(CoachMessage.created_at))
        .limit(12)
    )
    db_history = [
        {"role": m.role, "content": m.content}
        for m in reversed(db_history_result.scalars().all())
    ]

    user_profile = {
        "name": current_user.name,
        "role": current_user.role,
        "email": current_user.email,
    }
    reply = await get_coach_reply(
        user_profile=user_profile,
        conversation_history=db_history,
        new_message=body.message,
        db=db,
        user_id=uid,
        role=current_user.role,
    )

    # Persist both messages
    db.add(CoachMessage(id=gen_uuid(), web_user_id=uid, role="user",    content=body.message))
    db.add(CoachMessage(id=gen_uuid(), web_user_id=uid, role="assistant", content=reply))
    await db.commit()

    return {"reply": reply}


SKILL_SYSTEM_PROMPTS = {
    "marketer": (
        "You are the BamiHost Marketer AI. You just received a business event notification. "
        "Give ONE specific, actionable marketing move the user should take RIGHT NOW based on this event. "
        "Be direct. Reference the specific estate/unit/amount in your response. Max 3 sentences. "
        "Include: what to post/send, which channel, and what to say."
    ),
    "designer": (
        "You are the BamiHost Designer AI. You just received a business event notification. "
        "Give ONE specific, actionable design/branding recommendation based on this event. "
        "Be direct. Max 3 sentences. Focus on: photos, listing presentation, or brand consistency."
    ),
    "sales": (
        "You are the BamiHost Sales AI. You just received a business event notification. "
        "Give ONE specific sales action to take immediately. Max 3 sentences. "
        "Focus on: who to call, what to say, which stage to move a deal to."
    ),
    "finance": (
        "You are the BamiHost Finance AI. You just received a business event notification. "
        "Give ONE specific financial insight or action based on this event. Max 3 sentences. "
        "Focus on: cash flow impact, what to record, what to watch."
    ),
    "operations": (
        "You are the BamiHost Operations AI. You just received a business event notification. "
        "Give ONE specific operational action to take. Max 3 sentences. "
        "Focus on: vendor assignment, process to follow, SLA to maintain."
    ),
    "hr": (
        "You are the BamiHost HR AI. You just received a business event notification. "
        "Give ONE specific people/team action based on this event. Max 3 sentences. "
        "Focus on: who to involve, what to check, team communication."
    ),
}

EVENT_LABELS = {
    "new_property_listed": "A new property has been listed",
    "vacancy_opened": "A unit has become vacant",
    "new_tenant": "A new tenant has moved in",
    "tenant_overdue": "A tenant is overdue on payment",
    "issue_reported": "A maintenance issue has been reported",
    "new_enquiry": "A new property enquiry has come in",
    "new_application": "A new rental application has been submitted",
    "payment_received": "A payment has been received",
    "payment_failed": "A payment has failed",
    "service_request": "A tenant submitted a service request",
}


@router.post("/skill-trigger")
async def skill_trigger(
    body: SkillTriggerRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Called when a business event happens (e.g., new property listed, new enquiry).
    Returns targeted skill advice for the relevant skill.
    """
    import anthropic
    from core.config import settings

    skill = body.skill.lower()
    event_label = EVENT_LABELS.get(body.event, body.event.replace("_", " "))
    context_str = "\n".join(f"{k}: {v}" for k, v in body.context.items()) if body.context else ""

    system = SKILL_SYSTEM_PROMPTS.get(skill, SKILL_SYSTEM_PROMPTS["marketer"])

    # Also fetch live business context so the AI has full visibility
    live_ctx = await fetch_business_context(db, current_user.id, current_user.role)
    live_summary = _format_context(live_ctx)

    user_message = (
        f"Event: {event_label}\n"
        f"Details: {context_str}\n"
        f"---\n"
        f"Business snapshot:{live_summary[:1500]}"  # trim for speed
    )

    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    response = await client.messages.create(
        model="claude-haiku-4-5",  # use Haiku for speed on skill triggers
        max_tokens=200,
        system=system,
        messages=[{"role": "user", "content": user_message}],
    )
    advice = response.content[0].text.strip() if response.content else "Check your skill dashboard for next steps."

    return {
        "skill": skill,
        "event": body.event,
        "advice": advice,
    }


@router.get("/user/{telegram_id}")
async def get_user_progress(telegram_id: str):
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(CoachUser).where(CoachUser.telegram_id == telegram_id))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return {
            "name": user.first_name,
            "current_level": user.current_level,
            "completed_levels": user.completed_levels,
            "customers_served": user.customers_served,
            "current_revenue": user.current_revenue,
            "current_profit": user.current_profit,
            "target_revenue": user.target_revenue,
            "their_why": user.their_why,
            "joined": user.created_at.isoformat(),
        }


# ─── Streaming web chat (with Project Space grounding) ────────────────────────

class StreamChatRequest(BaseModel):
    message: str
    active_group_ids: list[str] = []


@router.post("/chat/stream")
async def web_chat_stream(
    body: StreamChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Same context as /chat but streams the reply token-by-token over SSE."""
    from services.ai_coach import build_coach_context
    from services.streaming import stream_claude

    uid = str(current_user.id)

    db_history_result = await db.execute(
        select(CoachMessage)
        .where(CoachMessage.web_user_id == uid)
        .order_by(desc(CoachMessage.created_at))
        .limit(12)
    )
    db_history = [
        {"role": m.role, "content": m.content}
        for m in reversed(db_history_result.scalars().all())
    ]
    user_profile = {"name": current_user.name, "role": current_user.role, "email": current_user.email}

    system_blocks, messages = await build_coach_context(
        user_profile=user_profile,
        conversation_history=db_history,
        new_message=body.message,
        db=db,
        user_id=uid,
        role=current_user.role,
        active_group_ids=body.active_group_ids or None,
    )

    db.add(CoachMessage(id=gen_uuid(), web_user_id=uid, role="user", content=body.message))
    await db.commit()

    async def generator():
        acc = ""
        async for chunk in stream_claude(system_blocks, messages):
            if chunk.startswith(b"data: ") and b'"delta"' in chunk:
                try:
                    payload = json.loads(chunk[len(b"data: "):].decode())
                    acc += payload.get("delta", "")
                except Exception:
                    pass
            yield chunk
        if acc:
            async with AsyncSessionLocal() as save_db:
                save_db.add(CoachMessage(id=gen_uuid(), web_user_id=uid, role="assistant", content=acc))
                await save_db.commit()

    return StreamingResponse(generator(), media_type="text/event-stream")


# ─── Project Space — Jarvis's knowledge base ───────────────────────────────────

class InstructionGroupBody(BaseModel):
    name: str
    description: Optional[str] = None
    color: str = "primary"
    sort_order: int = 0


class InstructionItemBody(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    source_url: Optional[str] = None
    sort_order: Optional[int] = None


@router.get("/project-space/groups")
async def list_instruction_groups(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models.instruction import InstructionGroup

    groups = (await db.execute(
        select(InstructionGroup).where(InstructionGroup.owner_id == str(current_user.id))
        .order_by(InstructionGroup.sort_order)
    )).scalars().all()
    return {"groups": [
        {"id": g.id, "name": g.name, "description": g.description, "color": g.color,
         "sort_order": g.sort_order, "is_active": g.is_active}
        for g in groups
    ]}


@router.post("/project-space/groups", status_code=201)
async def create_instruction_group(
    body: InstructionGroupBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models.instruction import InstructionGroup

    group = InstructionGroup(id=gen_uuid(), owner_id=str(current_user.id), **body.model_dump())
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return {"id": group.id}


@router.put("/project-space/groups/{group_id}")
async def update_instruction_group(
    group_id: str,
    body: InstructionGroupBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models.instruction import InstructionGroup

    group = (await db.execute(
        select(InstructionGroup).where(InstructionGroup.id == group_id, InstructionGroup.owner_id == str(current_user.id))
    )).scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    for k, v in body.model_dump().items():
        setattr(group, k, v)
    await db.commit()
    return {"ok": True}


@router.delete("/project-space/groups/{group_id}")
async def delete_instruction_group(
    group_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models.instruction import InstructionGroup, InstructionItem

    group = (await db.execute(
        select(InstructionGroup).where(InstructionGroup.id == group_id, InstructionGroup.owner_id == str(current_user.id))
    )).scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    await db.execute(delete(InstructionItem).where(InstructionItem.group_id == group_id))
    await db.delete(group)
    await db.commit()
    return {"ok": True}


@router.get("/project-space/groups/{group_id}/items")
async def list_instruction_items(
    group_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models.instruction import InstructionItem

    items = (await db.execute(
        select(InstructionItem).where(InstructionItem.group_id == group_id, InstructionItem.owner_id == str(current_user.id))
        .order_by(InstructionItem.sort_order)
    )).scalars().all()
    return {"items": [
        {"id": i.id, "kind": i.kind, "title": i.title, "content": i.content, "source_url": i.source_url,
         "file_url": i.file_url, "file_name": i.file_name, "file_mime": i.file_mime,
         "images": i.images, "sort_order": i.sort_order}
        for i in items
    ]}


@router.post("/project-space/groups/{group_id}/items", status_code=201)
async def create_text_or_url_item(
    group_id: str,
    kind: str = Query("text"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models.instruction import InstructionItem

    if kind not in ("text", "url", "file"):
        raise HTTPException(status_code=400, detail="kind must be text, url, or file")
    default_title = {"text": "New note", "url": "New link", "file": "New file"}[kind]
    item = InstructionItem(id=gen_uuid(), group_id=group_id, owner_id=str(current_user.id),
                            kind=kind, title=default_title)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return {"id": item.id}


@router.put("/project-space/items/{item_id}")
async def update_instruction_item(
    item_id: str,
    body: InstructionItemBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models.instruction import InstructionItem

    item = (await db.execute(
        select(InstructionItem).where(InstructionItem.id == item_id, InstructionItem.owner_id == str(current_user.id))
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    await db.commit()
    return {"ok": True}


@router.delete("/project-space/items/{item_id}")
async def delete_instruction_item(
    item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models.instruction import InstructionItem

    item = (await db.execute(
        select(InstructionItem).where(InstructionItem.id == item_id, InstructionItem.owner_id == str(current_user.id))
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    await db.delete(item)
    await db.commit()
    return {"ok": True}


@router.post("/project-space/items/{item_id}/fetch-url")
async def fetch_url_instruction(
    item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Re-fetch the item's source_url and refresh its extracted content."""
    from models.instruction import InstructionItem
    from services.extraction import extract_from_url

    item = (await db.execute(
        select(InstructionItem).where(InstructionItem.id == item_id, InstructionItem.owner_id == str(current_user.id))
    )).scalar_one_or_none()
    if not item or not item.source_url:
        raise HTTPException(status_code=404, detail="Item not found or has no source_url")
    try:
        item.content = await extract_from_url(item.source_url)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not fetch URL: {e}")
    await db.commit()
    return {"content": item.content}


@router.post("/project-space/items/{item_id}/upload-file")
async def upload_instruction_file(
    item_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models.instruction import InstructionItem
    from services.extraction import extract_from_file

    item = (await db.execute(
        select(InstructionItem).where(InstructionItem.id == item_id, InstructionItem.owner_id == str(current_user.id))
    )).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    data = await file.read()
    try:
        item.content = extract_from_file(data, file.filename or "", file.content_type)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    cloudinary.config(
        cloud_name=settings.CLOUDINARY_CLOUD_NAME,
        api_key=settings.CLOUDINARY_API_KEY,
        api_secret=settings.CLOUDINARY_API_SECRET,
    )
    upload_result = cloudinary.uploader.upload(
        data, resource_type="raw", folder=f"instruction-files/{current_user.id}",
    )
    item.file_url = upload_result.get("secure_url")
    item.file_name = file.filename
    item.file_mime = file.content_type
    item.title = file.filename or item.title
    await db.commit()
    return {"content": item.content, "file_url": item.file_url}


# ─── Voice notes ────────────────────────────────────────────────────────────

class VoiceNoteBody(BaseModel):
    transcript: str
    duration_sec: Optional[int] = None


@router.get("/voice-notes")
async def list_voice_notes(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models.voice_note import VoiceNote

    notes = (await db.execute(
        select(VoiceNote).where(VoiceNote.owner_id == str(current_user.id))
        .order_by(desc(VoiceNote.created_at)).limit(10)
    )).scalars().all()
    return {"notes": [
        {"id": n.id, "transcript": n.transcript, "duration_sec": n.duration_sec,
         "created_at": n.created_at.isoformat()}
        for n in notes
    ]}


@router.post("/voice-notes", status_code=201)
async def create_voice_note(
    body: VoiceNoteBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models.voice_note import VoiceNote

    note = VoiceNote(id=gen_uuid(), owner_id=str(current_user.id), **body.model_dump())
    db.add(note)
    await db.commit()
    await db.refresh(note)
    return {"id": note.id, "created_at": note.created_at.isoformat()}
