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
from services import llm
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
        "BamiHost is a MULTI-BUSINESS company (property/Real Estate, Smart Metering, and more lines are "
        "added over time) — never assume estate is the only business; speak to whichever business lines the "
        "owner actually runs (see LIVE CONTEXT). The owner talks to the whole team here. Answer as the team: "
        "when a question belongs to a department, answer in that head's voice and PREFIX the answer with "
        "their name, e.g. 'Ada · Metering:' or 'Femi · Finance:'. If several departments are relevant, give "
        "each a short turn. When the owner asks something broad ('how are we doing?'), act as the General "
        "Manager and give a crisp cross-department, cross-business-line read, then hand to the specific heads "
        "for detail.\n\n"
        "The department heads in the room:\n" + _roster() + "\n\n"
        "You can TASK the team: if the owner wants a fresh sweep/scan of the business, tell them to hit "
        "'Run the team' (or that you've asked the team to re-scan) — a live run refreshes every department's "
        "findings.\n\n"
        "You also have the owner's own DOCUMENTS & EMAILS: when the LIVE CONTEXT includes a 'FROM YOUR "
        "GOOGLE DRIVE & GMAIL' section, use those excerpts to answer and cite the document/email by its "
        "title (e.g. 'per your lease agreement…', 'the vendor's email says…'). Only use what's shown.\n\n"
        "Rules: Be direct and concrete — always reference the owner's REAL numbers, documents and emails "
        "from the live context below. No corporate filler. Keep each department's turn to a few sentences.\n\n"
        "ABSOLUTE RULE — NEVER FABRICATE DATA. If a number, status, or event is not explicitly present in "
        "the LIVE CONTEXT below, you do not have it. Do not invent it, estimate it, or make it up to sound "
        "helpful or complete. Concretely:\n"
        "- BamiHost has NO integration with Instagram, Facebook, Twitter/X, or any social platform — nothing "
        "is auto-posted, scheduled, or tracked there. NEVER claim a post 'went live', is 'scheduled', or "
        "report view/save/impression/click counts, enquiry counts from social, or campaign status for them. "
        "If asked about social performance, say plainly: 'That isn't tracked in BamiHost — I can draft the "
        "post, but I have no way to see how it performs once it's posted.'\n"
        "- Never invent dates, amounts, names, or 'as of X hours/minutes ago' specifics that aren't in the "
        "context.\n"
        "- If you don't have data for something, say so plainly in one line and say what's needed to get it "
        "(e.g. 'connect Meta/Instagram' or 'no enquiries logged yet') — a short honest 'we don't have that' "
        "is always correct; a fabricated number is always wrong, with no exceptions."
    )


async def _live_context(db: AsyncSession, user: User, query: str | None = None) -> str:
    """Live business data + which business lines run + each department's latest
    finding + the most relevant excerpts from the owner's Google Drive & Gmail."""
    parts = []

    # RAG: pull the Drive/Gmail excerpts most relevant to what the owner just asked.
    if query:
        try:
            from services.knowledge import context_block
            kb = await context_block(db, str(user.id), query, k=6)
            if kb:
                parts.append(kb)
        except Exception as e:
            logger.debug(f"[HEAD_OFFICE] knowledge retrieval skipped: {e}")

    # Which business lines the owner ACTUALLY runs — so the room never assumes estate-only.
    try:
        from services.agents.base import active_business_lines
        lines = await active_business_lines(db, user)
        if lines:
            parts.append("ACTIVE BUSINESS LINES: " + ", ".join(lines))
    except Exception as e:
        logger.debug(f"[HEAD_OFFICE] business-line probe failed: {e}")

    try:
        from services.ai_coach import fetch_business_context, _format_context
        ctx = await fetch_business_context(db, str(user.id), user.role)
        parts.append(_format_context(ctx))
    except Exception as e:
        logger.warning(f"[HEAD_OFFICE] business context failed: {e}")

    recent = (await db.execute(
        select(AutopilotAction).where(AutopilotAction.owner_id == str(user.id))
        .order_by(desc(AutopilotAction.created_at)).limit(40)
    )).scalars().all()
    if recent:
        # Each department's single latest finding — the room's current picture.
        latest_by_skill: dict[str, AutopilotAction] = {}
        for a in recent:
            latest_by_skill.setdefault(a.skill, a)
        parts.append(
            "EACH DEPARTMENT'S LATEST FINDING:\n" + "\n".join(
                f"- [{a.skill}] {a.title} ({a.status})" for a in latest_by_skill.values()
            )
        )
    return "\n\n".join(p for p in parts if p)


# ─── Roster ─────────────────────────────────────────────────────────────────────

@router.get("/team")
async def get_team(user: User = Depends(get_current_user)):
    """The department heads the owner can consult in the Head Office."""
    return {"success": True, "team": [
        {"key": m.key, "name": m.name, "emoji": m.emoji,
         "description": m.description, "businessLine": m.business_line}
        for m in AGENT_META.values()
    ]}


@router.post("/run-team")
async def run_team(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Task the whole team from the boardroom: run a fresh scan across every
    department and persist the findings, so the next question is answered against
    up-to-the-minute data. Mirrors the Autopilot generate (clears stale pending
    items first), but callable straight from the Head Office."""
    from services.agents import run_all_agents

    uid = str(user.id)
    # Clear stale pending/approved so the room sees a clean, current desk.
    existing = (await db.execute(
        select(AutopilotAction).where(
            AutopilotAction.owner_id == uid,
            AutopilotAction.status.in_(["pending", "approved"]),
        )
    )).scalars().all()
    for a in existing:
        await db.delete(a)

    try:
        actions = await run_all_agents(db, user)
    except Exception as e:
        logger.error(f"[HEAD_OFFICE] run-team failed: {e}")
        raise HTTPException(500, f"Team run failed: {e}")

    for a in actions:
        db.add(a)
    await db.commit()

    # Per-department summary for the room.
    by_skill: dict[str, int] = {}
    for a in actions:
        by_skill[a.skill] = by_skill.get(a.skill, 0) + 1
    return {
        "success": True,
        "ran": len(actions),
        "byDepartment": [
            {"skill": s, "name": AGENT_META[s].name if s in AGENT_META else s, "items": n}
            for s, n in sorted(by_skill.items(), key=lambda kv: kv[1], reverse=True)
        ],
    }


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

    context = await _live_context(db, current_user, query=body.message)
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

    def _frame(obj: dict) -> bytes:
        return f"data: {json.dumps(obj)}\n\n".encode()

    async def _stream_fallback():
        """The original plain streaming path — used if the tool loop fails."""
        acc = ""
        async for chunk in stream_claude(system_blocks, messages, max_tokens=1200):
            if chunk.startswith(b"data: [DONE]") or not chunk.startswith(b"data: "):
                continue
            try:
                payload = json.loads(chunk[len(b"data: "):].decode())
            except Exception:
                continue
            if "delta" in payload:
                acc += payload["delta"]
            yield chunk
        yield ("", acc)  # sentinel: done, final text

    async def generator():
        # Agentic loop: the team may call Google tools (email/drive/calendar)
        # before answering. Falls back to plain streaming on any loop failure
        # so chat never breaks because of the tools.
        from services import google_actions, sms_actions
        acc = ""
        try:
            all_tools = google_actions.GOOGLE_TOOLS + sms_actions.SMS_TOOLS
            progress_labels = {**google_actions.PROGRESS_LABELS, **sms_actions.PROGRESS_LABELS}
            tool_system = list(system_blocks) + [
                {"type": "text", "text": google_actions.TOOLS_PROMPT + sms_actions.TOOLS_PROMPT}]
            convo = list(messages)
            final_text = ""
            for _round in range(5):
                turn = await llm.chat_with_tools(
                    tool_system, convo, tools=all_tools,
                    tier=llm.DEEP, max_tokens=1200)
                if not turn.tool_calls:
                    final_text = turn.text
                    break
                results: dict[str, str] = {}
                for tc in turn.tool_calls:
                    label = progress_labels.get(tc.name, "Working on it")
                    yield _frame({"status": f"{label}…"})
                    if tc.name in sms_actions.TOOL_NAMES:
                        results[tc.id] = await sms_actions.execute(tc.name, tc.input, owner_id)
                    else:
                        results[tc.id] = await google_actions.execute(tc.name, tc.input, owner_id)
                convo.extend(llm.tool_exchange(turn, results))
            else:
                final_text = turn.text or "I started acting on that but hit the tool-call limit — ask me to continue."

            acc = final_text
            # Send the answer as delta frames (chunked so the UI still "types").
            for i in range(0, len(final_text), 60):
                yield _frame({"delta": final_text[i:i + 60]})
        except Exception as e:
            logger.error("[HEAD_OFFICE] tool loop failed, falling back to stream: %s", e, exc_info=True)
            async for item in _stream_fallback():
                if isinstance(item, tuple):
                    acc = item[1]
                else:
                    yield item

        yield b"data: [DONE]\n\n"

        async with AsyncSessionLocal() as save_db:
            save_db.add(HeadOfficeMessage(id=gen_uuid(), thread_id=thread_id, owner_id=owner_id,
                                          role="assistant", content=acc))
            await save_db.commit()

    return StreamingResponse(generator(), media_type="text/event-stream")
