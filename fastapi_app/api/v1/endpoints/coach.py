import json
import logging
import cloudinary
import cloudinary.uploader
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, delete
from pydantic import BaseModel
from typing import Optional
from core.database import AsyncSessionLocal, get_db
from core.config import settings
from core.security import get_current_user
from models.user import User
from models.coach import CoachMessage
from models.base import gen_uuid
from services.ai_coach import get_coach_reply, fetch_business_context, _format_context

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/coach", tags=["AI Coach"])


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
    "metering": (
        "You are the BamiHost Metering/Energy AI. You just received a business event notification. "
        "Give ONE specific action about prepaid smart meters. Max 3 sentences. "
        "Focus on: which meter to top up, the reminder to send a tenant, or an offline meter to reconnect."
    ),
    "legal": (
        "You are the BamiHost Legal AI. You just received a business event notification. "
        "Give ONE specific tenancy-paperwork action. Max 3 sentences. "
        "Focus on: the agreement/renewal notice to prepare and the clause or step to get it signed."
    ),
    "support": (
        "You are the BamiHost Customer Support AI. You just received a business event notification. "
        "Give ONE specific action to keep a tenant or prospect happy. Max 3 sentences. "
        "Focus on: who to reply to, the warm message to send, or the relationship to save."
    ),
    "procurement": (
        "You are the BamiHost Procurement AI. You just received a business event notification. "
        "Give ONE specific vendor/procurement action. Max 3 sentences. "
        "Focus on: the recurring cost to negotiate, the vendor to RFQ, or the bulk deal to pursue."
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
    from services import llm

    skill = body.skill.lower()
    event_label = EVENT_LABELS.get(body.event, body.event.replace("_", " "))
    context_str = "\n".join(f"{k}: {v}" for k, v in body.context.items()) if body.context else ""

    system = SKILL_SYSTEM_PROMPTS.get(skill, SKILL_SYSTEM_PROMPTS["marketer"]) + (
        " Never invent numbers, dates, or status claims (e.g. social-media views/saves/impressions, "
        "'post is live') that aren't in the event details or business snapshot below — BamiHost has no "
        "social-platform integration, so post performance is never tracked. If you don't have a figure, "
        "say so plainly instead of making one up."
    )

    # Also fetch live business context so the AI has full visibility
    live_ctx = await fetch_business_context(db, current_user.id, current_user.role)
    live_summary = _format_context(live_ctx)

    user_message = (
        f"Event: {event_label}\n"
        f"Details: {context_str}\n"
        f"---\n"
        f"Business snapshot:{live_summary[:1500]}"  # trim for speed
    )

    advice = await llm.text(system, user_message, tier=llm.FAST, max_tokens=200) \
        or "Check your skill dashboard for next steps."

    return {
        "skill": skill,
        "event": body.event,
        "advice": advice,
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
