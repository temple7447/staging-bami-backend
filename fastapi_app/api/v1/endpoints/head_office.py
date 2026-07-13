"""Head Office — the owner's boardroom chat with the whole AI agent team.

The CEO/owner asks anything; the Head Office answers in the voice of the
relevant department head(s) (the agents in services/agents/), grounded in the
owner's live business data and the team's recent findings. Streams over SSE,
reusing the shared streaming pipeline (services/streaming.py → services/llm.py).
"""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from pydantic import BaseModel

from models.user import User
from models.head_office import HeadOfficeThread, HeadOfficeMessage
from models.autopilot_action import AutopilotAction
from models.base import gen_uuid
from core.security import get_current_user
from core.database import get_db, AsyncSessionLocal
from services.streaming import stream_claude
from services.agents import AGENT_META
from utils.time_utils import utcnow

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/head-office", tags=["Head Office"])

MAX_HISTORY = 20


def _roster() -> str:
    """The department heads currently in the room, from the live agent registry."""
    return "\n".join(
        f"- {m.emoji} {m.name} — {m.description}" for m in AGENT_META.values()
    )


def _system_prompt() -> str:
    return (
        "You are the BamiHost HEAD OFFICE — the owner's (CEO's) private boardroom of AI department heads. "
        "The owner talks to the whole team here. Your job is to answer as the team: when a question belongs "
        "to a department, answer in that head's voice and PREFIX the answer with their name, e.g. "
        "'Ada · Metering:' or 'Finance:'. If several departments are relevant, give each a short turn. "
        "When the owner asks something broad ('how are we doing?'), act as the General Manager and give a "
        "crisp cross-department read, then hand to the specific heads for detail.\n\n"
        "The department heads in the room:\n" + _roster() + "\n\n"
        "Rules: Be direct and concrete — always reference the owner's REAL numbers from the live context "
        "below. No corporate filler. Keep each department's turn to a few sentences. If you don't have data "
        "for something, say so plainly and say what you'd need. Never invent figures."
    )


async def _live_context(db: AsyncSession, user: User) -> str:
    """Live business data + what the agent team has recently flagged."""
    parts = []
    try:
        from services.ai_coach import fetch_business_context, _format_context
        ctx = await fetch_business_context(db, str(user.id), user.role)
        parts.append(_format_context(ctx))
    except Exception as e:
        logger.warning(f"[HEAD_OFFICE] business context failed: {e}")

    recent = (await db.execute(
        select(AutopilotAction).where(AutopilotAction.owner_id == str(user.id))
        .order_by(desc(AutopilotAction.created_at)).limit(12)
    )).scalars().all()
    if recent:
        parts.append(
            "What the AI team has recently flagged:\n" + "\n".join(
                f"- [{a.skill}] {a.title} ({a.status})" for a in recent
            )
        )
    return "\n\n".join(p for p in parts if p)


# ─── Roster ─────────────────────────────────────────────────────────────────────

@router.get("/team")
async def get_team(user: User = Depends(get_current_user)):
    """The department heads the owner can consult in the Head Office."""
    return {"success": True, "team": [
        {"key": m.key, "name": m.name, "emoji": m.emoji, "description": m.description}
        for m in AGENT_META.values()
    ]}


# ─── Threads ────────────────────────────────────────────────────────────────────

@router.get("/threads")
async def list_threads(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.execute(
        select(HeadOfficeThread).where(HeadOfficeThread.owner_id == str(user.id))
        .order_by(desc(HeadOfficeThread.updated_at))
    )).scalars().all()
    return {"success": True, "data": [
        {"id": t.id, "title": t.title, "updatedAt": t.updated_at} for t in rows
    ]}


@router.post("/threads", status_code=201)
async def create_thread(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    t = HeadOfficeThread(id=gen_uuid(), owner_id=str(user.id))
    db.add(t)
    await db.commit()
    return {"success": True, "data": {"id": t.id, "title": t.title}}


@router.get("/threads/{thread_id}/messages")
async def get_messages(thread_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    thread = (await db.execute(
        select(HeadOfficeThread).where(HeadOfficeThread.id == thread_id, HeadOfficeThread.owner_id == str(user.id))
    )).scalar_one_or_none()
    if not thread:
        raise HTTPException(404, "Thread not found")
    rows = (await db.execute(
        select(HeadOfficeMessage).where(HeadOfficeMessage.thread_id == thread_id)
        .order_by(HeadOfficeMessage.created_at)
    )).scalars().all()
    return {"success": True, "data": [
        {"id": m.id, "role": m.role, "content": m.content, "createdAt": m.created_at} for m in rows
    ]}


class ChatBody(BaseModel):
    message: str


@router.post("/threads/{thread_id}/chat")
async def head_office_chat(
    thread_id: str,
    body: ChatBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    thread = (await db.execute(
        select(HeadOfficeThread).where(HeadOfficeThread.id == thread_id, HeadOfficeThread.owner_id == str(current_user.id))
    )).scalar_one_or_none()
    if not thread:
        raise HTTPException(404, "Thread not found")

    history = (await db.execute(
        select(HeadOfficeMessage).where(HeadOfficeMessage.thread_id == thread_id)
        .order_by(HeadOfficeMessage.created_at).limit(MAX_HISTORY)
    )).scalars().all()
    is_first = len(history) == 0
    messages = [{"role": m.role, "content": m.content} for m in history]
    messages.append({"role": "user", "content": body.message})

    context = await _live_context(db, current_user)
    system_blocks = [
        {"type": "text", "text": _system_prompt(), "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": f"LIVE CONTEXT (the owner's real business):\n{context or 'No data yet.'}"},
    ]

    db.add(HeadOfficeMessage(id=gen_uuid(), thread_id=thread_id, owner_id=str(current_user.id),
                             role="user", content=body.message))
    if is_first:
        thread.title = body.message[:60]
    thread.updated_at = utcnow()
    await db.commit()

    owner_id = str(current_user.id)

    async def generator():
        acc = ""
        async for chunk in stream_claude(system_blocks, messages, max_tokens=1200):
            if chunk.startswith(b"data: [DONE]"):
                continue
            if not chunk.startswith(b"data: "):
                continue
            try:
                payload = json.loads(chunk[len(b"data: "):].decode())
            except Exception:
                continue
            if "delta" in payload:
                acc += payload["delta"]
            yield chunk  # forward delta and error frames to the client
        yield b"data: [DONE]\n\n"

        async with AsyncSessionLocal() as save_db:
            save_db.add(HeadOfficeMessage(id=gen_uuid(), thread_id=thread_id, owner_id=owner_id,
                                          role="assistant", content=acc))
            await save_db.commit()

    return StreamingResponse(generator(), media_type="text/event-stream")
