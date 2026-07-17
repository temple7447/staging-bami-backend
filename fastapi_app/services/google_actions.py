"""Google tools for the AI team — lets Head Office chat READ and ACT on the
owner's connected Google account (Gmail, Drive, Calendar) via tool calls,
so the owner never has to leave the boardroom.

Every executor returns a plain string for the model: compact JSON on success,
"ERROR: …" on failure (the model relays it honestly instead of inventing a
result — house rule: never fake data). Each call opens its own DB session so
it works from inside a streaming response generator.

The tool schemas are the Anthropic shape ({name, description, input_schema});
services/llm.py translates for DeepSeek automatically.
"""
from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

import httpx
from sqlalchemy import select

from core.database import AsyncSessionLocal
from models.google_connection import GoogleConnection
from services import google_oauth
from utils.crypto import decrypt_secret

logger = logging.getLogger(__name__)

GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"
DRIVE = "https://www.googleapis.com/drive/v3"
CALENDAR = "https://www.googleapis.com/calendar/v3"

# What the chat shows while each tool runs.
PROGRESS_LABELS = {
    "gmail_search": "Checking the inbox",
    "gmail_read": "Reading the email",
    "gmail_send": "Sending the email",
    "drive_search": "Looking through Drive",
    "drive_create_file": "Creating the document",
    "calendar_upcoming": "Checking the calendar",
    "calendar_create_event": "Adding the event",
}

GOOGLE_TOOLS: list[dict] = [
    {
        "name": "gmail_search",
        "description": (
            "Search the owner's Gmail inbox. Use Gmail query syntax in `query` "
            "(e.g. 'from:vendor@x.com', 'is:unread', 'subject:rent newer_than:7d'); "
            "leave it empty for the latest inbox messages. Returns id, from, "
            "subject, date and a snippet per message — use gmail_read for a full body."
        ),
        "input_schema": {"type": "object", "properties": {
            "query": {"type": "string", "description": "Gmail search query; empty = latest inbox"},
            "max_results": {"type": "integer", "description": "1-20, default 10"},
        }},
    },
    {
        "name": "gmail_read",
        "description": "Read the full body of one email by the id returned from gmail_search.",
        "input_schema": {"type": "object", "properties": {
            "message_id": {"type": "string"},
        }, "required": ["message_id"]},
    },
    {
        "name": "gmail_send",
        "description": (
            "Send an email from the owner's own Gmail address. ONLY call this after "
            "the owner has confirmed the recipient and the content in this "
            "conversation — never send on a guess. Write the body in plain text."
        ),
        "input_schema": {"type": "object", "properties": {
            "to": {"type": "string"},
            "subject": {"type": "string"},
            "body": {"type": "string"},
        }, "required": ["to", "subject", "body"]},
    },
    {
        "name": "drive_search",
        "description": (
            "Find files in the owner's Google Drive by name (contains-match). "
            "Returns name, id, type, last-modified and a webViewLink the owner can open."
        ),
        "input_schema": {"type": "object", "properties": {
            "query": {"type": "string", "description": "Part of the file/folder name"},
        }, "required": ["query"]},
    },
    {
        "name": "drive_create_file",
        "description": (
            "Create a new empty Google Doc or Google Sheet in the owner's Drive "
            "and return its link. Use when the owner asks to draft/start a document."
        ),
        "input_schema": {"type": "object", "properties": {
            "file_type": {"type": "string", "enum": ["doc", "sheet"]},
            "name": {"type": "string"},
        }, "required": ["file_type", "name"]},
    },
    {
        "name": "calendar_upcoming",
        "description": "List the owner's upcoming Google Calendar events (default next 14 days).",
        "input_schema": {"type": "object", "properties": {
            "days": {"type": "integer", "description": "How many days ahead, 1-90, default 14"},
        }},
    },
    {
        "name": "calendar_create_event",
        "description": (
            "Create an event on the owner's Google Calendar. ONLY call this after "
            "the owner has confirmed the title and time in this conversation. "
            "Times are ISO format, Africa/Lagos unless the owner says otherwise: "
            "'2026-07-20T14:00:00' for timed events, 'YYYY-MM-DD' with all_day=true."
        ),
        "input_schema": {"type": "object", "properties": {
            "summary": {"type": "string"},
            "start": {"type": "string"},
            "end": {"type": "string"},
            "all_day": {"type": "boolean"},
            "description": {"type": "string"},
            "location": {"type": "string"},
        }, "required": ["summary", "start", "end"]},
    },
]

# Appended to the Head Office system prompt when the tools are available.
TOOLS_PROMPT = """
GOOGLE ACCOUNT ACCESS: You have live tools for the owner's connected Google
account — Gmail (search/read/send), Drive (search, create Doc/Sheet) and
Calendar (list/create). Use them whenever the owner asks about their email,
files or schedule; never guess or invent what an email or file says — read it
with a tool first, and if a tool errors, say so plainly.
Before SENDING an email or CREATING a calendar event, state exactly what you
are about to send/create (recipient, subject, body / title, time) and get the
owner's go-ahead in the conversation — unless the owner has already given you
those exact details and told you to do it.
"""


# ─── plumbing ────────────────────────────────────────────────────────────────

async def _token_for(owner_id: str) -> str | None:
    async with AsyncSessionLocal() as db:
        conn = (await db.execute(
            select(GoogleConnection).where(GoogleConnection.owner_id == owner_id)
        )).scalar_one_or_none()
        if not conn or not conn.refresh_token_enc or conn.status != "connected":
            return None
        return await google_oauth.access_token_from_refresh(decrypt_secret(conn.refresh_token_enc))


async def _get(token: str, url: str, params: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, params=params, headers={"Authorization": f"Bearer {token}"})
    r.raise_for_status()
    return r.json()


async def _post(token: str, url: str, body: dict, params: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(url, json=body, params=params,
                              headers={"Authorization": f"Bearer {token}"})
    r.raise_for_status()
    return r.json()


def _header(payload: dict, name: str) -> str | None:
    for h in payload.get("headers", []):
        if h.get("name", "").lower() == name.lower():
            return h.get("value")
    return None


def _walk_parts(part: dict, out: dict) -> None:
    mime = part.get("mimeType", "")
    data = part.get("body", {}).get("data")
    if data and mime in ("text/plain", "text/html") and mime not in out:
        out[mime] = base64.urlsafe_b64decode(data + "===").decode("utf-8", "replace")
    for sub in part.get("parts", []) or []:
        _walk_parts(sub, out)


def _strip_html(html: str) -> str:
    try:
        from bs4 import BeautifulSoup
        return BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
    except Exception:
        return html


# ─── executors ───────────────────────────────────────────────────────────────

async def _gmail_search(token: str, args: dict) -> str:
    n = min(max(int(args.get("max_results") or 10), 1), 20)
    params: dict = {"maxResults": n}
    q = (args.get("query") or "").strip()
    if q:
        params["q"] = q
    else:
        params["labelIds"] = "INBOX"
    listing = await _get(token, f"{GMAIL}/messages", params)
    out = []
    async with httpx.AsyncClient(timeout=30) as client:
        for m in listing.get("messages", [])[:n]:
            r = await client.get(
                f"{GMAIL}/messages/{m['id']}",
                params={"format": "metadata", "metadataHeaders": ["From", "Subject", "Date"]},
                headers={"Authorization": f"Bearer {token}"})
            if r.status_code != 200:
                continue
            d = r.json()
            p = d.get("payload", {})
            out.append({"id": d["id"], "from": _header(p, "From"),
                        "subject": _header(p, "Subject") or "(no subject)",
                        "date": _header(p, "Date"), "snippet": d.get("snippet", "")[:150],
                        "unread": "UNREAD" in (d.get("labelIds") or [])})
    return json.dumps({"count": len(out), "messages": out}) if out else "No messages found."


async def _gmail_read(token: str, args: dict) -> str:
    m = await _get(token, f"{GMAIL}/messages/{args['message_id']}", {"format": "full"})
    p = m.get("payload", {})
    bodies: dict = {}
    _walk_parts(p, bodies)
    body = bodies.get("text/plain") or _strip_html(bodies.get("text/html", "")) or m.get("snippet", "")
    return json.dumps({
        "from": _header(p, "From"), "to": _header(p, "To"),
        "subject": _header(p, "Subject"), "date": _header(p, "Date"),
        "body": body[:6000],
    })


async def _gmail_send(token: str, args: dict) -> str:
    msg = EmailMessage()
    msg["To"] = args["to"]
    msg["Subject"] = args.get("subject") or ""
    msg.set_content(args["body"])
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    sent = await _post(token, f"{GMAIL}/messages/send", {"raw": raw})
    return json.dumps({"sent": True, "id": sent.get("id"), "to": args["to"]})


async def _drive_search(token: str, args: dict) -> str:
    q = (args.get("query") or "").replace("'", "")
    data = await _get(token, f"{DRIVE}/files", {
        "q": f"name contains '{q}' and trashed = false",
        "fields": "files(id,name,mimeType,modifiedTime,webViewLink)",
        "pageSize": 15, "orderBy": "modifiedTime desc",
        "supportsAllDrives": "true", "includeItemsFromAllDrives": "true",
    })
    files = [{"id": f["id"], "name": f["name"],
              "type": "folder" if f["mimeType"].endswith("folder") else f["mimeType"].rsplit(".", 1)[-1],
              "modified": f.get("modifiedTime"), "link": f.get("webViewLink")}
             for f in data.get("files", [])]
    return json.dumps({"count": len(files), "files": files}) if files else "No files matched."


_CREATE_MIME = {"doc": "application/vnd.google-apps.document",
                "sheet": "application/vnd.google-apps.spreadsheet"}


async def _drive_create_file(token: str, args: dict) -> str:
    created = await _post(token, f"{DRIVE}/files",
                          {"name": args["name"], "mimeType": _CREATE_MIME[args["file_type"]]},
                          params={"fields": "id,name,webViewLink"})
    return json.dumps({"created": True, "name": created.get("name"),
                       "link": created.get("webViewLink")})


async def _calendar_upcoming(token: str, args: dict) -> str:
    days = min(max(int(args.get("days") or 14), 1), 90)
    now = datetime.now(timezone.utc)
    data = await _get(token, f"{CALENDAR}/calendars/primary/events", {
        "timeMin": now.isoformat(), "timeMax": (now + timedelta(days=days)).isoformat(),
        "singleEvents": "true", "orderBy": "startTime", "maxResults": 50,
    })
    events = [{"summary": e.get("summary") or "(no title)",
               "start": (e.get("start") or {}).get("dateTime") or (e.get("start") or {}).get("date"),
               "end": (e.get("end") or {}).get("dateTime") or (e.get("end") or {}).get("date"),
               "location": e.get("location")}
              for e in data.get("items", [])]
    return json.dumps({"days": days, "count": len(events), "events": events}) \
        if events else f"Nothing on the calendar in the next {days} days."


async def _calendar_create_event(token: str, args: dict) -> str:
    key = "date" if args.get("all_day") else "dateTime"
    body: dict = {"summary": args["summary"],
                  "start": {key: args["start"]}, "end": {key: args["end"]}}
    if args.get("description"):
        body["description"] = args["description"]
    if args.get("location"):
        body["location"] = args["location"]
    if key == "dateTime":
        for k in ("start", "end"):
            v = body[k][key]
            if "T" in v and "+" not in v and "Z" not in v:
                body[k]["timeZone"] = "Africa/Lagos"
    created = await _post(token, f"{CALENDAR}/calendars/primary/events", body)
    return json.dumps({"created": True, "summary": created.get("summary"),
                       "link": created.get("htmlLink")})


_EXECUTORS = {
    "gmail_search": _gmail_search,
    "gmail_read": _gmail_read,
    "gmail_send": _gmail_send,
    "drive_search": _drive_search,
    "drive_create_file": _drive_create_file,
    "calendar_upcoming": _calendar_upcoming,
    "calendar_create_event": _calendar_create_event,
}


async def execute(name: str, args: dict, owner_id: str) -> str:
    """Run one tool call for the owner; always returns a string for the model."""
    fn = _EXECUTORS.get(name)
    if not fn:
        return f"ERROR: unknown tool '{name}'."
    token = await _token_for(owner_id)
    if not token:
        return ("ERROR: the owner's Google account is not connected. "
                "Ask them to connect it on the Google Workspace page (System → Google Workspace).")
    try:
        return await fn(token, args or {})
    except httpx.HTTPStatusError as e:
        reason = ""
        try:
            reason = (e.response.json().get("error") or {}).get("message") or ""
        except Exception:
            pass
        logger.warning("[GOOGLE-TOOLS] %s failed: %s %s", name, e.response.status_code, reason[:200])
        return f"ERROR: Google rejected {name} ({e.response.status_code}). {reason[:300]}"
    except Exception as e:
        logger.error("[GOOGLE-TOOLS] %s crashed: %s", name, e, exc_info=True)
        return f"ERROR: {name} failed — {str(e)[:200]}"
