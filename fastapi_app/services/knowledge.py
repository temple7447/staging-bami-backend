"""Knowledge index — ingest the owner's Google Drive + Gmail into searchable,
embedded chunks, and retrieve the most relevant ones for a question (RAG).

The Google API client (googleapiclient) is synchronous, so every blocking call
is pushed to a worker thread via asyncio.to_thread. Embeddings + DB writes are
async. Ingestion is idempotent per document: a doc's old chunks are deleted
before its fresh chunks are written, so re-syncing updates in place.
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
from datetime import datetime

from bs4 import BeautifulSoup
from googleapiclient.discovery import build
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from models.knowledge_chunk import KnowledgeChunk
from models.base import gen_uuid
from services import embeddings
from services import google_oauth
from utils.time_utils import utcnow

logger = logging.getLogger(__name__)

# Chunking (character-based; ~1 token ≈ 4 chars, so ~375 tokens/chunk).
CHUNK_SIZE = 1500
CHUNK_OVERLAP = 200

# Google Docs editors → export MIME.
_EXPORT = {
    "application/vnd.google-apps.document": "text/plain",
    "application/vnd.google-apps.spreadsheet": "text/csv",
    "application/vnd.google-apps.presentation": "text/plain",
}
_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


# ─── text helpers ────────────────────────────────────────────────────────────

def _chunk(text: str) -> list[str]:
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= CHUNK_SIZE:
        return [text]
    out, start = [], 0
    while start < len(text):
        end = start + CHUNK_SIZE
        out.append(text[start:end])
        start = end - CHUNK_OVERLAP
    return out


def _pdf_text(data: bytes) -> str:
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        return "\n".join((p.extract_text() or "") for p in reader.pages)
    except Exception as e:
        logger.warning("[KNOWLEDGE] pdf extract failed: %s", e)
        return ""


def _docx_text(data: bytes) -> str:
    try:
        import docx
        d = docx.Document(io.BytesIO(data))
        return "\n".join(p.text for p in d.paragraphs)
    except Exception as e:
        logger.warning("[KNOWLEDGE] docx extract failed: %s", e)
        return ""


def _html_to_text(html: str) -> str:
    try:
        return BeautifulSoup(html, "html.parser").get_text("\n").strip()
    except Exception:
        return html


# ─── storage ─────────────────────────────────────────────────────────────────

async def _store_doc(db: AsyncSession, owner_id: str, source: str, source_id: str,
                     title: str, url: str | None, full_text: str, meta: dict) -> int:
    """Chunk → embed → replace this document's chunks. Returns #chunks written."""
    chunks = _chunk(full_text)
    if not chunks:
        return 0
    vecs = await embeddings.embed_texts(chunks)
    # Replace any existing chunks for this document (idempotent re-sync).
    await db.execute(delete(KnowledgeChunk).where(
        KnowledgeChunk.owner_id == owner_id,
        KnowledgeChunk.source == source,
        KnowledgeChunk.source_id == source_id,
    ))
    for i, (c, v) in enumerate(zip(chunks, vecs)):
        db.add(KnowledgeChunk(
            id=gen_uuid(), owner_id=owner_id, source=source, source_id=source_id,
            chunk_index=i, title=title[:512] if title else None, url=url,
            text=c, embedding=v, meta=meta,
        ))
    await db.commit()
    return len(chunks)


# ─── Drive ───────────────────────────────────────────────────────────────────

def _drive_service(access_token: str):
    return build("drive", "v3", credentials=google_oauth.credentials_from_token(access_token),
                 cache_discovery=False)


def _list_drive_files(service, limit: int) -> list[dict]:
    files, page = [], None
    while len(files) < limit:
        resp = service.files().list(
            q="trashed=false",
            fields="nextPageToken, files(id,name,mimeType,modifiedTime,webViewLink,size)",
            pageSize=min(100, limit - len(files)),
            pageToken=page,
            orderBy="modifiedTime desc",
        ).execute()
        files.extend(resp.get("files", []))
        page = resp.get("nextPageToken")
        if not page:
            break
    return files[:limit]


def _fetch_drive_text(service, f: dict) -> str:
    mime = f.get("mimeType", "")
    try:
        if mime in _EXPORT:
            data = service.files().export_media(fileId=f["id"], mimeType=_EXPORT[mime]).execute()
            return data.decode("utf-8", "ignore") if isinstance(data, bytes) else str(data)
        if mime == "application/pdf":
            return _pdf_text(service.files().get_media(fileId=f["id"]).execute())
        if mime == _DOCX:
            return _docx_text(service.files().get_media(fileId=f["id"]).execute())
        if mime.startswith("text/"):
            data = service.files().get_media(fileId=f["id"]).execute()
            return data.decode("utf-8", "ignore") if isinstance(data, bytes) else str(data)
    except Exception as e:
        logger.warning("[KNOWLEDGE] drive fetch %s (%s) failed: %s", f.get("name"), mime, e)
    return ""  # unsupported/binary types are skipped


async def sync_drive(db: AsyncSession, owner_id: str, access_token: str, limit: int = 2000) -> int:
    service = await asyncio.to_thread(_drive_service, access_token)
    files = await asyncio.to_thread(_list_drive_files, service, limit)
    docs = 0
    for f in files:
        text = await asyncio.to_thread(_fetch_drive_text, service, f)
        if not text.strip():
            continue
        n = await _store_doc(
            db, owner_id, "drive", f["id"], f.get("name", "Untitled"),
            f.get("webViewLink"), text,
            {"mimeType": f.get("mimeType"), "modifiedTime": f.get("modifiedTime")})
        if n:
            docs += 1
    logger.info("[KNOWLEDGE] drive: indexed %d/%d files for %s", docs, len(files), owner_id)
    return docs


# ─── Gmail ───────────────────────────────────────────────────────────────────

def _gmail_service(access_token: str):
    return build("gmail", "v1", credentials=google_oauth.credentials_from_token(access_token),
                 cache_discovery=False)


def _list_gmail_ids(service, limit: int) -> list[str]:
    ids, page = [], None
    while len(ids) < limit:
        resp = service.users().messages().list(
            userId="me", maxResults=min(100, limit - len(ids)), pageToken=page,
        ).execute()
        ids.extend(m["id"] for m in resp.get("messages", []))
        page = resp.get("nextPageToken")
        if not page:
            break
    return ids[:limit]


def _decode_part(data: str) -> str:
    try:
        return base64.urlsafe_b64decode(data.encode()).decode("utf-8", "ignore")
    except Exception:
        return ""


def _extract_body(payload: dict) -> str:
    """Walk the MIME tree, prefer text/plain, fall back to stripped text/html."""
    plain, html = [], []

    def walk(part):
        mime = part.get("mimeType", "")
        body = part.get("body", {})
        if body.get("data"):
            if mime == "text/plain":
                plain.append(_decode_part(body["data"]))
            elif mime == "text/html":
                html.append(_html_to_text(_decode_part(body["data"])))
        for p in part.get("parts", []) or []:
            walk(p)

    walk(payload)
    return "\n".join(plain).strip() or "\n".join(html).strip()


def _fetch_gmail_message(service, mid: str) -> dict | None:
    try:
        msg = service.users().messages().get(userId="me", id=mid, format="full").execute()
    except Exception as e:
        logger.warning("[KNOWLEDGE] gmail get %s failed: %s", mid, e)
        return None
    headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}
    body = _extract_body(msg.get("payload", {}))
    return {
        "id": mid,
        "subject": headers.get("subject", "(no subject)"),
        "from": headers.get("from", ""),
        "to": headers.get("to", ""),
        "date": headers.get("date", ""),
        "snippet": msg.get("snippet", ""),
        "body": body,
    }


async def sync_gmail(db: AsyncSession, owner_id: str, access_token: str, limit: int = 3000) -> int:
    service = await asyncio.to_thread(_gmail_service, access_token)
    ids = await asyncio.to_thread(_list_gmail_ids, service, limit)
    docs = 0
    for mid in ids:
        m = await asyncio.to_thread(_fetch_gmail_message, service, mid)
        if not m:
            continue
        full = (f"Subject: {m['subject']}\nFrom: {m['from']}\nTo: {m['to']}\n"
                f"Date: {m['date']}\n\n{m['body'] or m['snippet']}")
        if not full.strip():
            continue
        n = await _store_doc(
            db, owner_id, "gmail", mid, m["subject"],
            f"https://mail.google.com/mail/u/0/#all/{mid}", full,
            {"from": m["from"], "date": m["date"]})
        if n:
            docs += 1
    logger.info("[KNOWLEDGE] gmail: indexed %d/%d messages for %s", docs, len(ids), owner_id)
    return docs


# ─── retrieval (RAG) ─────────────────────────────────────────────────────────

async def search(db: AsyncSession, owner_id: str, query: str, k: int = 8) -> list[dict]:
    """Top-k most relevant Drive/Gmail chunks for a natural-language query."""
    rows = (await db.execute(
        select(KnowledgeChunk.id, KnowledgeChunk.embedding).where(
            KnowledgeChunk.owner_id == owner_id)
    )).all()
    if not rows:
        return []
    qvec = await embeddings.embed_query(query)
    ranked = embeddings.top_k(qvec, [(r.id, r.embedding) for r in rows], k=k)
    if not ranked:
        return []
    ids = [cid for cid, _ in ranked]
    score_by_id = dict(ranked)
    chunks = (await db.execute(
        select(KnowledgeChunk).where(KnowledgeChunk.id.in_(ids))
    )).scalars().all()
    chunks.sort(key=lambda c: score_by_id.get(c.id, 0), reverse=True)
    return [{
        "source": c.source, "title": c.title, "url": c.url,
        "text": c.text, "meta": c.meta, "score": round(score_by_id.get(c.id, 0), 3),
    } for c in chunks]


async def context_block(db: AsyncSession, owner_id: str, query: str, k: int = 6) -> str:
    """A formatted 'FROM YOUR DRIVE & GMAIL' block for injection into agent/Head
    Office prompts, or '' if nothing relevant / not indexed."""
    hits = await search(db, owner_id, query, k=k)
    if not hits:
        return ""
    lines = ["FROM YOUR GOOGLE DRIVE & GMAIL (most relevant excerpts):"]
    for h in hits:
        tag = "📄 Drive" if h["source"] == "drive" else "✉️ Gmail"
        who = h["meta"].get("from") or h["meta"].get("mimeType") or ""
        snippet = " ".join((h["text"] or "").split())[:600]
        lines.append(f"- [{tag}] {h['title']}{f' — {who}' if who else ''}: {snippet}")
    return "\n".join(lines)
