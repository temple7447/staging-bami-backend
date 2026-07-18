"""
SMS service — BulkSMS Nigeria (https://www.bulksmsnigeria.com/app/api/docs).

Infobip was tried first but its shared trial UK sender is silently blocked
by Nigerian carriers (accepted by Infobip, never delivered — no error, no
delivery report). BulkSMS Nigeria has direct local carrier routes and was
verified end-to-end (balance check, live send, delivery report) on
2026-07-18 before adoption.

Env vars:
  BULKSMS_NG_API_TOKEN  — Bearer token from Account > API (Laravel Sanctum
                          personal access token, format "{id}|{secret}")
  BULKSMS_NG_SENDER     — sender id shown to recipients, max 11 chars
                          (default "BamiHost"; no sender id needs pre-
                          registration to send via the direct-refund gateway)
  DEFAULT_COUNTRY_CODE  — for phone normalization (default "234" Nigeria)

Used alongside utils/email_service.py as a second delivery channel for tenant
reminders.
"""
import os
import re
import logging
from typing import Optional

import httpx

from core.config import settings

logger = logging.getLogger(__name__)

API_TOKEN    = os.getenv("BULKSMS_NG_API_TOKEN", "")
SENDER       = os.getenv("BULKSMS_NG_SENDER", "BamiHost")[:11]
COUNTRY_CODE = os.getenv("DEFAULT_COUNTRY_CODE", "234")

_BASE = "https://www.bulksmsnigeria.com/api/v2"


def _site_link() -> str:
    """Bare domain (no scheme/www) — keeps every SMS's link short."""
    return settings.FRONTEND_URL.replace("https://", "").replace("http://", "").replace("www.", "").rstrip("/")


def is_configured() -> bool:
    return bool(API_TOKEN)


def get_status() -> dict:
    missing = [] if API_TOKEN else ["BULKSMS_NG_API_TOKEN"]
    return {"ok": len(missing) == 0, "missing": missing}


def normalize_phone(raw: Optional[str]) -> Optional[str]:
    """Return an international number without '+' (BulkSMS NG format), e.g. 2348012345678."""
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


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


async def send_sms(phone: str, message: str) -> dict:
    """Send one SMS via BulkSMS Nigeria. Returns {success, response|error}."""
    if not is_configured():
        logger.warning("[BULKSMS_NG] Not configured. Would SMS %s: %s", phone, message)
        return {"success": False, "error": "SMS not configured (BULKSMS_NG_API_TOKEN)"}
    to = normalize_phone(phone)
    if not to:
        return {"success": False, "error": "invalid phone"}

    link = _site_link()
    body = message if link in message else f"{message} {link}"

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(f"{_BASE}/sms", headers=_headers(), json={
                "from": SENDER,
                "to": to,
                "body": body,
            })
            data = resp.json()
    except Exception as e:
        logger.error("[BULKSMS_NG] Request failed for %s: %s", to, e)
        return {"success": False, "error": str(e)}

    ok = resp.status_code == 200 and data.get("status") == "success"
    if ok:
        logger.info("[BULKSMS_NG] SMS sent to %s (message_id=%s, cost=%s)",
                    to, (data.get("data") or {}).get("message_id"), (data.get("data") or {}).get("cost"))
    else:
        logger.error("[BULKSMS_NG] SMS failed to %s (%s): %s", to, resp.status_code, data)
    return {"success": ok, "channel": "sms", "response": data}


async def delivery_status(message_id: str) -> dict:
    """Look up delivery status for a previously sent message."""
    if not is_configured():
        return {"success": False, "error": "SMS not configured (BULKSMS_NG_API_TOKEN)"}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(f"{_BASE}/delivery-reports",
                                    headers=_headers(), params={"message_id": message_id})
            return {"success": resp.status_code == 200, "response": resp.json()}
    except Exception as e:
        logger.error("[BULKSMS_NG] delivery_status failed for %s: %s", message_id, e)
        return {"success": False, "error": str(e)}


async def send_reminder(phone: str, name: str, amount: float, due_date: str, estate: str = "") -> dict:
    """Send a rent-reminder SMS, naming the estate/property it's for."""
    property_line = f" for {estate}" if estate else ""
    msg = (
        f"Hi {name or 'there'}, your rent of {format_currency(amount)}{property_line} is due on "
        f"{due_date}. Please pay on time to avoid disruption. — BamiHost"
    )
    return await send_sms(phone, msg)


async def send_credentials(phone: str, name: str, email: str, password: str, estate: str = "") -> dict:
    """Send login credentials (email + temp password) by SMS — mirrors the welcome email."""
    property_line = f" for {estate}" if estate else ""
    msg = (
        f"Hi {name or 'there'}, your BamiHost account{property_line} is ready. "
        f"Login email: {email}  Temp password: {password}. "
        f"You can log in with your email or this phone number. "
        f"Please change your password after first login. — BamiHost"
    )
    return await send_sms(phone, msg)
