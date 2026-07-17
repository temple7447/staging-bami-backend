"""Google Workspace — let the owner actually USE their connected Google account
from the dashboard (read AND write), not just have it indexed for the AI.

  Gmail:    GET  /google/gmail/messages        list inbox (search, paging)
            GET  /google/gmail/messages/{id}   full message body
            POST /google/gmail/send            compose + send
  Drive:    GET  /google/drive/files           browse a folder / search
            GET  /google/drive/files/{id}/download   proxy download (exports Google Docs)
            POST /google/drive/upload          upload a file (multipart)
            POST /google/drive/folders         create a folder
            POST /google/drive/create          create a Google Doc / Sheet
  Calendar: GET  /google/calendar/events       upcoming events
            POST /google/calendar/events       create an event

Everything is scoped to the calling user's own GoogleConnection (same trust
model as the /google knowledge endpoints). Connections predating the
read/write scope upgrade get a 403 with reconnect=True so the UI can prompt.
"""
from __future__ import annotations

import base64
import logging
from email.message import EmailMessage

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from core.security import get_current_user
from core.database import get_db
from models.user import User
from models.google_connection import GoogleConnection
from services import google_oauth
from utils.crypto import decrypt_secret

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/google", tags=["Google Workspace"])

GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"
DRIVE = "https://www.googleapis.com/drive/v3"
DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3"
CALENDAR = "https://www.googleapis.com/calendar/v3"

# Google-native editor files aren't downloadable directly — export them.
_EXPORT_AS = {
    "application/vnd.google-apps.document": ("application/pdf", ".pdf"),
    "application/vnd.google-apps.spreadsheet": (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"),
    "application/vnd.google-apps.presentation": ("application/pdf", ".pdf"),
}
_MAX_DOWNLOAD = 50 * 1024 * 1024  # 50 MB proxy cap


# ─── helpers ─────────────────────────────────────────────────────────────────

async def _access_token(db, user: User, *, need_write: bool = False) -> str:
    conn = (await db.execute(
        select(GoogleConnection).where(GoogleConnection.owner_id == str(user.id))
    )).scalar_one_or_none()
    if not conn or not conn.refresh_token_enc or conn.status != "connected":
        raise HTTPException(400, "Google is not connected — connect it first from the Google Workspace page.")
    if need_write and not google_oauth.has_write_scopes(conn.scopes):
        raise HTTPException(status_code=403, detail={
            "message": "Your Google connection is read-only. Reconnect Google to grant write access.",
            "reconnect": True,
        })
    try:
        return await google_oauth.access_token_from_refresh(decrypt_secret(conn.refresh_token_enc))
    except Exception as e:
        logger.error("[GOOGLE-WS] token refresh failed for %s: %s", user.id, e)
        raise HTTPException(502, "Couldn't refresh the Google session — try reconnecting Google.")


async def _gget(token: str, url: str, params: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, params=params,
                             headers={"Authorization": f"Bearer {token}"})
    if r.status_code >= 400:
        logger.warning("[GOOGLE-WS] GET %s -> %s %s", url, r.status_code, r.text[:300])
        raise HTTPException(502, f"Google API error ({r.status_code})")
    return r.json()


async def _gpost(token: str, url: str, json: dict | None = None,
                 params: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(url, json=json, params=params,
                              headers={"Authorization": f"Bearer {token}"})
    if r.status_code >= 400:
        logger.warning("[GOOGLE-WS] POST %s -> %s %s", url, r.status_code, r.text[:300])
        raise HTTPException(502, f"Google API error ({r.status_code})")
    return r.json()


def _header(payload: dict, name: str) -> str | None:
    for h in payload.get("headers", []):
        if h.get("name", "").lower() == name.lower():
            return h.get("value")
    return None


def _walk_parts(part: dict, out: dict) -> None:
    """Collect the first text/plain and text/html bodies from a MIME tree."""
    mime = part.get("mimeType", "")
    data = part.get("body", {}).get("data")
    if data and mime in ("text/plain", "text/html") and mime not in out:
        out[mime] = base64.urlsafe_b64decode(data + "===").decode("utf-8", "replace")
    for sub in part.get("parts", []) or []:
        _walk_parts(sub, out)


# ─── Gmail ───────────────────────────────────────────────────────────────────

@router.get("/gmail/messages")
async def gmail_list(q: str = Query("", description="Gmail search, e.g. from:x is:unread"),
                     label: str = Query("INBOX"),
                     page_token: str = Query(None, alias="pageToken"),
                     max_results: int = Query(25, ge=1, le=50, alias="max"),
                     db=Depends(get_db), user: User = Depends(get_current_user)):
    token = await _access_token(db, user)
    params: dict = {"maxResults": max_results}
    if q:
        params["q"] = q
    elif label:
        params["labelIds"] = label
    if page_token:
        params["pageToken"] = page_token
    listing = await _gget(token, f"{GMAIL}/messages", params)

    messages = []
    ids = [m["id"] for m in listing.get("messages", [])]
    if ids:
        async with httpx.AsyncClient(timeout=30) as client:
            for mid in ids:
                r = await client.get(
                    f"{GMAIL}/messages/{mid}",
                    params={"format": "metadata",
                            "metadataHeaders": ["From", "To", "Subject", "Date"]},
                    headers={"Authorization": f"Bearer {token}"})
                if r.status_code != 200:
                    continue
                m = r.json()
                p = m.get("payload", {})
                messages.append({
                    "id": m["id"],
                    "threadId": m.get("threadId"),
                    "from": _header(p, "From"),
                    "to": _header(p, "To"),
                    "subject": _header(p, "Subject") or "(no subject)",
                    "date": _header(p, "Date"),
                    "snippet": m.get("snippet", ""),
                    "unread": "UNREAD" in (m.get("labelIds") or []),
                })
    return {"success": True, "messages": messages,
            "nextPageToken": listing.get("nextPageToken")}


@router.get("/gmail/messages/{message_id}")
async def gmail_read(message_id: str, db=Depends(get_db),
                     user: User = Depends(get_current_user)):
    token = await _access_token(db, user)
    m = await _gget(token, f"{GMAIL}/messages/{message_id}", {"format": "full"})
    p = m.get("payload", {})
    bodies: dict = {}
    _walk_parts(p, bodies)
    return {"success": True, "message": {
        "id": m["id"],
        "threadId": m.get("threadId"),
        "from": _header(p, "From"),
        "to": _header(p, "To"),
        "cc": _header(p, "Cc"),
        "subject": _header(p, "Subject") or "(no subject)",
        "date": _header(p, "Date"),
        "snippet": m.get("snippet", ""),
        "unread": "UNREAD" in (m.get("labelIds") or []),
        "bodyText": bodies.get("text/plain"),
        "bodyHtml": bodies.get("text/html"),
    }}


class SendEmailBody(BaseModel):
    to: str = Field(min_length=3)
    subject: str = ""
    body: str = Field(min_length=1)
    cc: str | None = None
    bcc: str | None = None


@router.post("/gmail/send")
async def gmail_send(payload: SendEmailBody, db=Depends(get_db),
                     user: User = Depends(get_current_user)):
    token = await _access_token(db, user, need_write=True)
    msg = EmailMessage()
    msg["To"] = payload.to
    msg["Subject"] = payload.subject
    if payload.cc:
        msg["Cc"] = payload.cc
    if payload.bcc:
        msg["Bcc"] = payload.bcc
    msg.set_content(payload.body)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    sent = await _gpost(token, f"{GMAIL}/messages/send", {"raw": raw})
    return {"success": True, "id": sent.get("id"), "message": "Email sent."}


# ─── Drive ───────────────────────────────────────────────────────────────────

_FILE_FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink,iconLink,parents"


@router.get("/drive/files")
async def drive_list(folder_id: str = Query("root", alias="folderId"),
                     q: str = Query(""),
                     page_token: str = Query(None, alias="pageToken"),
                     db=Depends(get_db), user: User = Depends(get_current_user)):
    token = await _access_token(db, user)
    if q:
        query = f"name contains '{q.replace(chr(39), '')}' and trashed = false"
    else:
        query = f"'{folder_id}' in parents and trashed = false"
    params = {
        "q": query,
        "fields": f"nextPageToken,files({_FILE_FIELDS})",
        "orderBy": "folder,modifiedTime desc",
        "pageSize": 50,
        "supportsAllDrives": "true",
        "includeItemsFromAllDrives": "true",
    }
    if page_token:
        params["pageToken"] = page_token
    data = await _gget(token, f"{DRIVE}/files", params)
    return {"success": True, "files": data.get("files", []),
            "nextPageToken": data.get("nextPageToken")}


@router.get("/drive/files/{file_id}/download")
async def drive_download(file_id: str, db=Depends(get_db),
                         user: User = Depends(get_current_user)):
    token = await _access_token(db, user)
    meta = await _gget(token, f"{DRIVE}/files/{file_id}",
                       {"fields": "id,name,mimeType,size", "supportsAllDrives": "true"})
    mime = meta.get("mimeType", "")
    name = meta.get("name", "file")
    if int(meta.get("size") or 0) > _MAX_DOWNLOAD:
        raise HTTPException(413, "File is larger than the 50 MB download limit — open it in Drive instead.")

    if mime in _EXPORT_AS:
        out_mime, ext = _EXPORT_AS[mime]
        url, params = f"{DRIVE}/files/{file_id}/export", {"mimeType": out_mime}
        if not name.endswith(ext):
            name += ext
    else:
        out_mime = mime or "application/octet-stream"
        url, params = f"{DRIVE}/files/{file_id}", {"alt": "media", "supportsAllDrives": "true"}

    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.get(url, params=params,
                             headers={"Authorization": f"Bearer {token}"})
    if r.status_code >= 400:
        raise HTTPException(502, f"Google API error ({r.status_code})")
    safe = name.replace('"', "")
    return Response(content=r.content, media_type=out_mime,
                    headers={"Content-Disposition": f'attachment; filename="{safe}"'})


@router.post("/drive/upload")
async def drive_upload(file: UploadFile = File(...),
                       folder_id: str = Form("root", alias="folderId"),
                       db=Depends(get_db), user: User = Depends(get_current_user)):
    token = await _access_token(db, user, need_write=True)
    content = await file.read()
    if len(content) > _MAX_DOWNLOAD:
        raise HTTPException(413, "File is larger than the 50 MB upload limit.")
    import json as _json
    meta = {"name": file.filename or "upload", "parents": [folder_id]}
    boundary = "bami_upload_boundary"
    body = (
        f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
        f"{_json.dumps(meta)}\r\n"
        f"--{boundary}\r\nContent-Type: {file.content_type or 'application/octet-stream'}\r\n\r\n"
    ).encode() + content + f"\r\n--{boundary}--".encode()
    async with httpx.AsyncClient(timeout=300) as client:
        r = await client.post(
            f"{DRIVE_UPLOAD}/files",
            params={"uploadType": "multipart", "fields": _FILE_FIELDS,
                    "supportsAllDrives": "true"},
            content=body,
            headers={"Authorization": f"Bearer {token}",
                     "Content-Type": f"multipart/related; boundary={boundary}"})
    if r.status_code >= 400:
        logger.warning("[GOOGLE-WS] upload -> %s %s", r.status_code, r.text[:300])
        raise HTTPException(502, f"Google API error ({r.status_code})")
    return {"success": True, "file": r.json(), "message": f"Uploaded {meta['name']}."}


class CreateFolderBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    parentId: str = "root"


@router.post("/drive/folders")
async def drive_create_folder(payload: CreateFolderBody, db=Depends(get_db),
                              user: User = Depends(get_current_user)):
    token = await _access_token(db, user, need_write=True)
    created = await _gpost(token, f"{DRIVE}/files", {
        "name": payload.name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [payload.parentId],
    }, params={"fields": _FILE_FIELDS, "supportsAllDrives": "true"})
    return {"success": True, "file": created, "message": f"Folder '{payload.name}' created."}


_CREATE_TYPES = {
    "doc": "application/vnd.google-apps.document",
    "sheet": "application/vnd.google-apps.spreadsheet",
}


class CreateDocBody(BaseModel):
    type: str = Field(pattern="^(doc|sheet)$")
    name: str = Field(min_length=1, max_length=200)
    parentId: str = "root"


@router.post("/drive/create")
async def drive_create_doc(payload: CreateDocBody, db=Depends(get_db),
                           user: User = Depends(get_current_user)):
    token = await _access_token(db, user, need_write=True)
    created = await _gpost(token, f"{DRIVE}/files", {
        "name": payload.name,
        "mimeType": _CREATE_TYPES[payload.type],
        "parents": [payload.parentId],
    }, params={"fields": _FILE_FIELDS, "supportsAllDrives": "true"})
    label = "Doc" if payload.type == "doc" else "Sheet"
    return {"success": True, "file": created,
            "message": f"Google {label} '{payload.name}' created — open it in Drive to edit."}


# ─── Calendar ────────────────────────────────────────────────────────────────

@router.get("/calendar/events")
async def calendar_list(days: int = Query(30, ge=1, le=365),
                        db=Depends(get_db), user: User = Depends(get_current_user)):
    from datetime import datetime, timedelta, timezone
    token = await _access_token(db, user)
    now = datetime.now(timezone.utc)
    data = await _gget(token, f"{CALENDAR}/calendars/primary/events", {
        "timeMin": now.isoformat(),
        "timeMax": (now + timedelta(days=days)).isoformat(),
        "singleEvents": "true",
        "orderBy": "startTime",
        "maxResults": 100,
    })
    events = [{
        "id": e.get("id"),
        "summary": e.get("summary") or "(no title)",
        "description": e.get("description"),
        "location": e.get("location"),
        "start": (e.get("start") or {}).get("dateTime") or (e.get("start") or {}).get("date"),
        "end": (e.get("end") or {}).get("dateTime") or (e.get("end") or {}).get("date"),
        "allDay": "date" in (e.get("start") or {}),
        "htmlLink": e.get("htmlLink"),
    } for e in data.get("items", [])]
    return {"success": True, "events": events}


class CreateEventBody(BaseModel):
    summary: str = Field(min_length=1, max_length=300)
    description: str | None = None
    location: str | None = None
    start: str  # ISO datetime, or YYYY-MM-DD when allDay
    end: str
    allDay: bool = False


@router.post("/calendar/events")
async def calendar_create(payload: CreateEventBody, db=Depends(get_db),
                          user: User = Depends(get_current_user)):
    token = await _access_token(db, user, need_write=True)
    key = "date" if payload.allDay else "dateTime"
    body: dict = {
        "summary": payload.summary,
        "start": {key: payload.start},
        "end": {key: payload.end},
    }
    if payload.description:
        body["description"] = payload.description
    if payload.location:
        body["location"] = payload.location
    if not payload.allDay:
        # Give Google an explicit zone if the client sent a naive datetime.
        for k in ("start", "end"):
            if "T" in body[k][key] and "+" not in body[k][key] and "Z" not in body[k][key]:
                body[k]["timeZone"] = "Africa/Lagos"
    created = await _gpost(token, f"{CALENDAR}/calendars/primary/events", body)
    return {"success": True, "event": {"id": created.get("id"),
                                       "htmlLink": created.get("htmlLink")},
            "message": "Event created."}
