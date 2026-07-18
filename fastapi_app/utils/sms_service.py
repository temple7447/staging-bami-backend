"""
SMS service — Infobip HTTP API (https://www.infobip.com).

Env vars:
  INFOBIP_API_KEY   — API key from Infobip dashboard (Authorization: App <key>)
  INFOBIP_BASE_URL  — per-account base URL, e.g. "k94qln.api.infobip.com" (no scheme)
  INFOBIP_SENDER    — sender id/number (Infobip's shared test sender while on
                      free trial; a real alphanumeric sender id once approved)
  DEFAULT_COUNTRY_CODE — for phone normalization (default "234" Nigeria)

Used as a fallback channel for tenants who haven't connected Telegram — see
utils/telegram_service.py (primary) and utils/email_service.py.
"""
import os
import re
import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

API_KEY      = os.getenv("INFOBIP_API_KEY", "")
BASE_URL     = os.getenv("INFOBIP_BASE_URL", "").strip().rstrip("/")
SENDER       = os.getenv("INFOBIP_SENDER", "")
COUNTRY_CODE = os.getenv("DEFAULT_COUNTRY_CODE", "234")


def is_configured() -> bool:
    return bool(API_KEY and BASE_URL and SENDER)


def get_status() -> dict:
    missing = []
    if not API_KEY:  missing.append("INFOBIP_API_KEY")
    if not BASE_URL: missing.append("INFOBIP_BASE_URL")
    if not SENDER:   missing.append("INFOBIP_SENDER")
    return {"ok": len(missing) == 0, "missing": missing}


def normalize_phone(raw: Optional[str]) -> Optional[str]:
    """Return an international number without '+' (Infobip format), e.g. 2348012345678."""
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return None
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith(COUNTRY_CODE):
        return digits
    if digits.startswith("0"):
        return COUNTRY_CODE + digits[1:]
    if len(digits) <= 10:  # bare local number, e.g. 8012345678
        return COUNTRY_CODE + digits
    return digits


def format_currency(amount: float) -> str:
    return f"₦{amount:,.0f}"


async def send_sms(phone: str, message: str) -> dict:
    """Send one SMS via Infobip. Returns {success, response|error}."""
    if not is_configured():
        logger.warning("[INFOBIP] Not configured. Would SMS %s: %s", phone, message)
        return {"success": False, "error": "SMS not configured (INFOBIP_API_KEY/BASE_URL/SENDER)"}
    to = normalize_phone(phone)
    if not to:
        return {"success": False, "error": "invalid phone"}

    url = f"https://{BASE_URL}/sms/3/messages"
    payload = {"messages": [{
        "destinations": [{"to": to}],
        "sender": SENDER,
        "content": {"text": message},
    }]}
    headers = {
        "Authorization": f"App {API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            data = resp.json()
    except Exception as e:
        logger.error("[INFOBIP] Request failed for %s: %s", to, e)
        return {"success": False, "error": str(e)}

    # Success: every message in the batch has a status group "PENDING" or "DELIVERED" (groupId 1/3)
    messages = data.get("messages", [])
    ok = resp.status_code < 400 and bool(messages) and all(
        (m.get("status") or {}).get("groupId") not in (5,)  # 5 = REJECTED
        for m in messages
    )
    if ok:
        logger.info("[INFOBIP] SMS sent to %s", to)
    else:
        logger.error("[INFOBIP] SMS failed to %s (%s): %s", to, resp.status_code, data)
    return {"success": ok, "channel": "sms", "response": data}


async def send_reminder(phone: str, name: str, amount: float, due_date: str, estate: str = "") -> dict:
    """Send a rent-reminder SMS. Mirrors telegram_service's reminder copy."""
    msg = (
        f"Hi {name or 'there'}, your rent of {format_currency(amount)} is due on "
        f"{due_date}. Please pay on time to avoid disruption. — BamiHost"
    )
    return await send_sms(phone, msg)
