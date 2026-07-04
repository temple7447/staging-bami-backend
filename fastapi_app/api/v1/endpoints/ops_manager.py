"""Ops Manager — a human-in-the-loop operator chat that proposes structured
changes (fenced ```proposal JSON blocks) as AutopilotAction rows requiring
explicit approve/reject (see autopilot.py's execute/dismiss + the
_execute_ops_proposal dispatcher), plus a daily standup brief.
"""
import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from pydantic import BaseModel
from typing import Optional

from models.user import User
from models.ops_thread import OpsThread, OpsMessage
from models.ops_report import OpsReport
from models.autopilot_action import AutopilotAction
from models.voice_note import VoiceNote
from models.lead import Lead
from models.base import gen_uuid
from core.security import get_current_user
from core.database import get_db, AsyncSessionLocal
from services.streaming import stream_claude
from services.agents.base import ai_text
from utils.time_utils import utcnow

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ops", tags=["Ops Manager"])

VALID_KINDS = {"planner_edit", "agent_create", "agent_update", "lead_page", "integration", "report", "task", "other"}

SYSTEM_PROMPT = """You are the BamiHost Ops Manager — a human-in-the-loop operator, positioned above the AI Coach and other assistants. You never act directly. Instead, when there's a clear, concrete next step, you propose it as a fenced block:

```proposal
{"kind": "planner_edit|agent_create|agent_update|lead_page|integration|report|task|other", "title": "Short imperative title", "rationale": "Why this moves the needle, referencing the user's actual numbers", "payload": {...concrete fields needed to execute it...}}
```

Rules:
- Only propose on explicit ask or a clear, result-oriented next step — don't propose for the sake of it.
- One proposal per fenced block; you may emit multiple blocks in one reply.
- payload must have exact, concrete field names/values — the user only clicks Approve or Reject, there's no further back-and-forth.
- After proposing, briefly tell the user what to check.
- Be direct and punchy. Reference the user's real business data below.
"""


async def _gather_ops_context(db: AsyncSession, user: User) -> str:
    from models.growth_plan import GrowthPlan

    parts = []
    gp = (await db.execute(select(GrowthPlan).where(GrowthPlan.owner_id == str(user.id)))).scalars().first()
    if gp:
        parts.append(f"Growth plan: step {gp.current_step}/7, stated level {gp.stated_level}, "
                      f"target revenue ₦{gp.target_revenue or 0:,.0f}, target profit ₦{gp.target_profit or 0:,.0f}")

    notes = (await db.execute(
        select(VoiceNote).where(VoiceNote.owner_id == str(user.id)).order_by(desc(VoiceNote.created_at)).limit(6)
    )).scalars().all()
    if notes:
        parts.append("Recent voice notes:\n" + "\n".join(f"- {n.transcript[:200]}" for n in notes))

    proposals = (await db.execute(
        select(AutopilotAction).where(AutopilotAction.owner_id == str(user.id))
        .order_by(desc(AutopilotAction.created_at)).limit(8)
    )).scalars().all()
    if proposals:
        parts.append("Recent proposals/actions:\n" + "\n".join(
            f"- [{p.status}] {p.title} ({p.action_type})" for p in proposals
        ))

    leads = (await db.execute(
        select(Lead).where(Lead.owner_id == str(user.id)).order_by(desc(Lead.created_at)).limit(50)
    )).scalars().all()
    if leads:
        by_status: dict[str, int] = {}
        for l in leads:
            by_status[l.status] = by_status.get(l.status, 0) + 1
        parts.append("Lead pipeline: " + ", ".join(f"{k}: {v}" for k, v in by_status.items()))

    return "\n\n".join(parts)


def _extract_proposals(text: str) -> tuple[str, list[dict]]:
    proposals = []

    def _consume(m: re.Match) -> str:
        try:
            obj = json.loads(m.group(1).strip())
            if isinstance(obj, dict) and isinstance(obj.get("title"), str) and obj.get("kind") in VALID_KINDS:
                proposals.append({
                    "kind": obj["kind"], "title": obj["title"],
                    "rationale": obj.get("rationale", ""), "payload": obj.get("payload") or {},
                })
        except Exception:
            pass
        return ""

    cleaned = re.sub(r"```proposal\s*([\s\S]*?)```", _consume, text)
    return cleaned.strip(), proposals


def _visible_text(acc: str) -> str:
    """Text safe to show mid-stream: strips completed ```proposal fences, and
    hides a still-open one entirely so raw JSON never flashes on screen while
    Claude is still typing it out."""
    idx = acc.rfind("```proposal")
    if idx != -1 and "```" not in acc[idx + len("```proposal"):]:
        acc = acc[:idx]
    cleaned, _ = _extract_proposals(acc)
    return cleaned


# ─── Threads ────────────────────────────────────────────────────────────────────

@router.get("/threads")
async def list_threads(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    threads = (await db.execute(
        select(OpsThread).where(OpsThread.owner_id == str(current_user.id))
        .order_by(desc(OpsThread.updated_at))
    )).scalars().all()
    if not threads:
        thread = OpsThread(id=gen_uuid(), owner_id=str(current_user.id), title="Daily ops")
        db.add(thread)
        await db.commit()
        threads = [thread]
    return {"data": [{"id": t.id, "title": t.title, "updated_at": t.updated_at.isoformat()} for t in threads]}


@router.post("/threads", status_code=201)
async def create_thread(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    thread = OpsThread(id=gen_uuid(), owner_id=str(current_user.id))
    db.add(thread)
    await db.commit()
    return {"id": thread.id}


@router.get("/threads/{thread_id}/messages")
async def get_thread_messages(
    thread_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    messages = (await db.execute(
        select(OpsMessage).where(OpsMessage.thread_id == thread_id, OpsMessage.owner_id == str(current_user.id))
        .order_by(OpsMessage.created_at)
    )).scalars().all()
    return {"data": [{"role": m.role, "content": m.content, "created_at": m.created_at.isoformat()} for m in messages]}


class ChatBody(BaseModel):
    message: str


@router.post("/threads/{thread_id}/chat")
async def ops_chat(
    thread_id: str,
    body: ChatBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    thread = (await db.execute(
        select(OpsThread).where(OpsThread.id == thread_id, OpsThread.owner_id == str(current_user.id))
    )).scalar_one_or_none()
    if not thread:
        raise HTTPException(404, "Thread not found")

    history_rows = (await db.execute(
        select(OpsMessage).where(OpsMessage.thread_id == thread_id).order_by(OpsMessage.created_at).limit(20)
    )).scalars().all()
    is_first_message = len(history_rows) == 0
    messages = [{"role": m.role, "content": m.content} for m in history_rows]
    messages.append({"role": "user", "content": body.message})

    context = await _gather_ops_context(db, current_user)
    system_blocks = [
        {"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": f"LIVE CONTEXT:\n{context}"},
    ]

    db.add(OpsMessage(id=gen_uuid(), thread_id=thread_id, owner_id=str(current_user.id),
                       role="user", content=body.message))
    if is_first_message:
        thread.title = body.message[:60]
    thread.updated_at = utcnow()
    await db.commit()

    owner_id = str(current_user.id)

    async def generator():
        acc = ""
        sent_len = 0
        async for chunk in stream_claude(system_blocks, messages):
            if chunk.startswith(b"data: [DONE]"):
                continue
            if not chunk.startswith(b"data: "):
                continue
            try:
                payload = json.loads(chunk[len(b"data: "):].decode())
            except Exception:
                continue
            if "error" in payload:
                yield chunk
                continue

            acc += payload.get("delta", "")
            visible = _visible_text(acc)
            if len(visible) > sent_len:
                new_text = visible[sent_len:]
                sent_len = len(visible)
                yield f"data: {json.dumps({'delta': new_text})}\n\n".encode()

        yield b"data: [DONE]\n\n"

        cleaned, proposals = _extract_proposals(acc)
        async with AsyncSessionLocal() as save_db:
            save_db.add(OpsMessage(id=gen_uuid(), thread_id=thread_id, owner_id=owner_id,
                                    role="assistant", content=cleaned))
            for p in proposals:
                save_db.add(AutopilotAction(
                    id=gen_uuid(), owner_id=owner_id, skill="ops_manager", action_type=p["kind"],
                    title=p["title"], description=p["rationale"], platform=None,
                    trigger_event="ops_manager_chat", trigger_context=p["payload"],
                ))
            await save_db.commit()

    return StreamingResponse(generator(), media_type="text/event-stream")


# ─── Daily brief ────────────────────────────────────────────────────────────────

BRIEF_PROMPT = """Using the live context below, write today's standup brief in exactly these 5 markdown sections, punchy and no fluff, referencing concrete numbers:

1. Yesterday's signal
2. Today's #1 focus
3. Blockers / drift
4. 3 micro-actions (each <= 10 words)
5. A question for you
"""


@router.post("/brief")
async def generate_brief(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    context = await _gather_ops_context(db, current_user)
    content = await ai_text(BRIEF_PROMPT, f"LIVE CONTEXT:\n{context}", max_tokens=600)

    report = OpsReport(id=gen_uuid(), owner_id=str(current_user.id), kind="daily",
                        for_date=utcnow().date(), content=content)
    db.add(report)
    await db.commit()
    return {"report": {"content": content, "for_date": report.for_date.isoformat()}}


@router.get("/reports")
async def list_reports(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    reports = (await db.execute(
        select(OpsReport).where(OpsReport.owner_id == str(current_user.id))
        .order_by(desc(OpsReport.for_date)).limit(7)
    )).scalars().all()
    return {"data": [
        {"id": r.id, "content": r.content, "for_date": r.for_date.isoformat()} for r in reports
    ]}
