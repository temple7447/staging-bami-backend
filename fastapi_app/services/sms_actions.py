"""SMS tool for the AI team — lets Head Office chat send a text message on
the owner's behalf (to a tenant by name, or to a raw phone number) via
utils/sms_service.py (BulkSMS Nigeria).

Same shape as services/google_actions.py: a tool schema list, a progress
label, a prompt fragment to append to the system prompt, and an execute()
that always returns a plain string for the model (compact JSON on success,
"ERROR: …" on failure).
"""
from __future__ import annotations

import json
import logging
import re

from sqlalchemy import select

from core.database import AsyncSessionLocal
from models.user import User
from models.tenant import Tenant
from services.agents.base import owner_estate_ids
from utils import sms_service

logger = logging.getLogger(__name__)

PROGRESS_LABELS = {
    "sms_send": "Sending the text",
}

SMS_TOOLS: list[dict] = [
    {
        "name": "sms_send",
        "description": (
            "Send an SMS text message on the owner's behalf. `recipient` is "
            "either a tenant's name (their phone on file is used) or a raw "
            "phone number. ONLY call this after the owner has confirmed the "
            "exact recipient and message text in this conversation — never "
            "send on a guess."
        ),
        "input_schema": {"type": "object", "properties": {
            "recipient": {"type": "string", "description": "Tenant name or phone number"},
            "message": {"type": "string", "description": "Exact SMS text to send"},
        }, "required": ["recipient", "message"]},
    },
]

TOOLS_PROMPT = """
SMS ACCESS: You have a live tool to send a text message (SMS) to a tenant by
name or to any phone number. Before sending, state exactly who you're texting
and the exact message, and get the owner's go-ahead — unless they already gave
you those exact details and told you to send it. If SMS isn't configured or a
tenant has no phone on file, say so plainly instead of pretending it sent.
"""


async def _sms_send(args: dict, owner_id: str) -> str:
    recipient = (args.get("recipient") or "").strip()
    message = (args.get("message") or "").strip()
    if not recipient or not message:
        return "ERROR: both recipient and message are required."
    if not sms_service.is_configured():
        return "ERROR: SMS is not configured (missing BULKSMS_NG_API_TOKEN)."

    digits = re.sub(r"\D", "", recipient)
    tenant_name: str | None = None
    phone: str | None = None

    if len(digits) >= 7:
        phone = recipient
    else:
        async with AsyncSessionLocal() as db:
            user = await db.get(User, owner_id)
            estate_ids = await owner_estate_ids(db, user) if user else []
            if not estate_ids:
                return f"ERROR: no tenants found for this owner to match '{recipient}' against."
            matches = (await db.execute(
                select(Tenant).where(
                    Tenant.estate.in_(estate_ids),
                    Tenant.tenant_name.ilike(f"%{recipient}%"),
                )
            )).scalars().all()
            if not matches:
                return f"ERROR: no tenant found matching '{recipient}'."
            if len(matches) > 1:
                names = ", ".join(t.tenant_name for t in matches[:8])
                return (f"ERROR: {len(matches)} tenants match '{recipient}' — ask the owner "
                        f"which one: {names}.")
            tenant = matches[0]
            if not tenant.tenant_phone:
                return f"ERROR: {tenant.tenant_name} has no phone number on file."
            tenant_name, phone = tenant.tenant_name, tenant.tenant_phone

    res = await sms_service.send_sms(phone, message)
    if not res.get("success"):
        return f"ERROR: SMS failed — {res.get('error') or res.get('response')}"
    return json.dumps({"sent": True, "to": phone, "recipient_name": tenant_name})


_EXECUTORS = {
    "sms_send": _sms_send,
}

TOOL_NAMES = set(_EXECUTORS)


async def execute(name: str, args: dict, owner_id: str) -> str:
    fn = _EXECUTORS.get(name)
    if not fn:
        return f"ERROR: unknown tool '{name}'."
    try:
        return await fn(args or {}, owner_id)
    except Exception as e:
        logger.error("[SMS-TOOLS] %s crashed: %s", name, e, exc_info=True)
        return f"ERROR: {name} failed — {str(e)[:200]}"
