"""Google (Drive + Gmail) connection + knowledge sync endpoints.

Flow:
  GET  /google/connect   → { authUrl }        (owner's browser goes to Google)
  GET  /google/callback  ← Google redirects    (exchange code, store token, sync)
  GET  /google/status    → connection + index stats
  POST /google/sync      → re-index Drive + Gmail
  POST /google/disconnect→ forget tokens + wipe the owner's chunks
  GET  /google/search?q= → debug: what the index returns for a query
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from jose import jwt, JWTError
from sqlalchemy import select, delete, func

from core.config import settings
from core.security import get_current_user
from core.database import get_db, AsyncSessionLocal
from models.user import User
from models.google_connection import GoogleConnection
from models.knowledge_chunk import KnowledgeChunk
from models.base import gen_uuid
from services import google_oauth, knowledge
from utils.crypto import encrypt_secret, decrypt_secret
from utils.time_utils import utcnow

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/google", tags=["Google Knowledge"])

# Keep references to background sync tasks so they aren't garbage-collected.
_SYNC_TASKS: set[asyncio.Task] = set()

_STATE_PURPOSE = "google_oauth_state"


def _sign_state(owner_id: str) -> str:
    return jwt.encode(
        {"id": owner_id, "purpose": _STATE_PURPOSE,
         "exp": datetime.now(timezone.utc) + timedelta(minutes=15)},
        settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _read_state(state: str) -> str:
    try:
        payload = jwt.decode(state, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(400, "Invalid or expired OAuth state")
    if payload.get("purpose") != _STATE_PURPOSE or not payload.get("id"):
        raise HTTPException(400, "Invalid OAuth state")
    return payload["id"]


# ─── background sync ─────────────────────────────────────────────────────────

async def _run_sync(owner_id: str) -> None:
    """Full re-index of the owner's Drive + Gmail. Runs detached from the request."""
    async with AsyncSessionLocal() as db:
        conn = (await db.execute(
            select(GoogleConnection).where(GoogleConnection.owner_id == owner_id)
        )).scalar_one_or_none()
        if not conn or not conn.refresh_token_enc:
            return
        conn.last_sync_status = "running"
        await db.commit()
        try:
            access = await google_oauth.access_token_from_refresh(decrypt_secret(conn.refresh_token_enc))
            drive_n = await knowledge.sync_drive(db, owner_id, access)
            gmail_n = await knowledge.sync_gmail(db, owner_id, access)
            conn.drive_synced, conn.gmail_synced = drive_n, gmail_n
            conn.last_sync_status, conn.last_error = "done", None
            conn.status = "connected"
        except Exception as e:
            logger.error("[GOOGLE] sync failed for %s: %s", owner_id, e)
            conn.last_sync_status, conn.last_error = "error", str(e)[:500]
        conn.last_sync_at = utcnow()
        await db.commit()


def _kick_sync(owner_id: str) -> None:
    task = asyncio.create_task(_run_sync(owner_id))
    _SYNC_TASKS.add(task)
    task.add_done_callback(_SYNC_TASKS.discard)


# ─── endpoints ───────────────────────────────────────────────────────────────

@router.get("/status")
async def google_status(db=Depends(get_db), user: User = Depends(get_current_user)):
    conn = (await db.execute(
        select(GoogleConnection).where(GoogleConnection.owner_id == str(user.id))
    )).scalar_one_or_none()
    chunk_count = (await db.execute(
        select(func.count()).select_from(KnowledgeChunk).where(
            KnowledgeChunk.owner_id == str(user.id))
    )).scalar() or 0
    return {
        "success": True,
        "configured": google_oauth.is_configured(),
        "connected": bool(conn and conn.status == "connected" and conn.refresh_token_enc),
        "email": conn.google_email if conn else None,
        "status": conn.status if conn else None,
        "lastSyncAt": conn.last_sync_at if conn else None,
        "lastSyncStatus": conn.last_sync_status if conn else None,
        "lastError": conn.last_error if conn else None,
        "driveSynced": conn.drive_synced if conn else 0,
        "gmailSynced": conn.gmail_synced if conn else 0,
        "indexedChunks": chunk_count,
    }


@router.get("/connect")
async def google_connect(user: User = Depends(get_current_user)):
    """Return the Google consent URL for the owner's browser to visit."""
    if not google_oauth.is_configured():
        raise HTTPException(400, "Google OAuth is not configured on the server "
                                 "(set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI).")
    return {"success": True, "authUrl": google_oauth.build_auth_url(_sign_state(str(user.id)))}


@router.get("/callback")
async def google_callback(code: str = Query(None), state: str = Query(None),
                          error: str = Query(None), db=Depends(get_db)):
    """Google redirects here after consent. Public (no bearer) — trust comes from
    the signed `state`. Exchanges the code, stores the encrypted refresh token,
    kicks off the first sync, then bounces the browser back to the app."""
    dest = settings.GOOGLE_POST_CONNECT_REDIRECT or "/"
    if error:
        return RedirectResponse(f"{dest}?google=denied")
    if not code or not state:
        raise HTTPException(400, "Missing code/state")

    owner_id = _read_state(state)
    try:
        tokens = await google_oauth.exchange_code(code)
    except Exception as e:
        logger.error("[GOOGLE] code exchange failed: %s", e)
        return RedirectResponse(f"{dest}?google=error")

    refresh = tokens.get("refresh_token")
    access = tokens.get("access_token")
    email = await google_oauth.fetch_email(access) if access else None

    conn = (await db.execute(
        select(GoogleConnection).where(GoogleConnection.owner_id == owner_id)
    )).scalar_one_or_none()
    if not conn:
        conn = GoogleConnection(id=gen_uuid(), owner_id=owner_id)
        db.add(conn)
    if refresh:  # Google only returns refresh_token on first consent; keep the old one otherwise
        conn.refresh_token_enc = encrypt_secret(refresh)
    conn.google_email = email or conn.google_email
    conn.scopes = tokens.get("scope")
    conn.status = "connected"
    conn.last_error = None
    await db.commit()

    _kick_sync(owner_id)
    return RedirectResponse(f"{dest}?google=connected")


@router.post("/sync")
async def google_sync(user: User = Depends(get_current_user), db=Depends(get_db)):
    conn = (await db.execute(
        select(GoogleConnection).where(GoogleConnection.owner_id == str(user.id))
    )).scalar_one_or_none()
    if not conn or not conn.refresh_token_enc:
        raise HTTPException(400, "Google is not connected")
    _kick_sync(str(user.id))
    return {"success": True, "message": "Sync started — indexing your Drive & Gmail in the background."}


@router.post("/disconnect")
async def google_disconnect(user: User = Depends(get_current_user), db=Depends(get_db)):
    uid = str(user.id)
    await db.execute(delete(KnowledgeChunk).where(KnowledgeChunk.owner_id == uid))
    await db.execute(delete(GoogleConnection).where(GoogleConnection.owner_id == uid))
    await db.commit()
    return {"success": True, "message": "Google disconnected and knowledge index cleared."}


@router.get("/search")
async def google_search(q: str = Query(..., min_length=2), k: int = Query(8, ge=1, le=20),
                        user: User = Depends(get_current_user), db=Depends(get_db)):
    """Debug/utility: what the knowledge index returns for a query."""
    hits = await knowledge.search(db, str(user.id), q, k=k)
    return {"success": True, "count": len(hits), "results": hits}
