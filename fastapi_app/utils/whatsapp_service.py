"""
WhatsApp + SMS messaging via Termii (https://termii.com).

Env vars:
  TERMII_API_KEY               — API key from Termii dashboard
  TERMII_SENDER_ID             — approved SMS sender ID (default "Termii")
  TERMII_WHATSAPP_TEMPLATE_ID  — pre-approved WhatsApp template id
  TERMII_WHATSAPP_DEVICE_ID    — WhatsApp device/phone id
  DEFAULT_COUNTRY_CODE         — for phone normalization (default "234" Nigeria)
  REMINDER_CHANNEL             — whatsapp | sms | both (default whatsapp)

Behaviour:
  send_reminder() sends over WhatsApp when a template+device are configured,
  otherwise falls back to SMS — so it works immediately with just an API key.
"""
import os
import re
import logging
from typing import Optional
import httpx

logger = logging.getLogger(__name__)

API_KEY      = os.getenv("TERMII_API_KEY", "")
BASE_URL     = os.getenv("TERMII_BASE_URL", "https://api.ng.termii.com").rstrip("/")
SENDER_ID    = os.getenv("TERMII_SENDER_ID", "Termii")
TEMPLATE_ID  = os.getenv("TERMII_WHATSAPP_TEMPLATE_ID", "")
DEVICE_ID    = os.getenv("TERMII_WHATSAPP_DEVICE_ID", "")
COUNTRY_CODE = os.getenv("DEFAULT_COUNTRY_CODE", "234")
CHANNEL      = os.getenv("REMINDER_CHANNEL", "whatsapp").lower()


def is_configured() -> bool:
    return bool(API_KEY)


def whatsapp_ready() -> bool:
    return bool(API_KEY and TEMPLATE_ID and DEVICE_ID)


def normalize_phone(raw: Optional[str]) -> Optional[str]:
    """Return an international number without '+' (Termii format), e.g. 2348012345678."""
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
    # bare local number (e.g. 8012345678)
    if len(digits) <= 10:
        return COUNTRY_CODE + digits
    return digits


def format_currency(amount: float) -> str:
    return f"₦{amount:,.0f}"


async def _post(path: str, payload: dict) -> dict:
    url = f"{BASE_URL}{path}"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(url, json=payload)
        try:
            return resp.json()
        except Exception:
            return {"status_code": resp.status_code, "text": resp.text}


async def send_sms(phone: str, message: str) -> dict:
    if not is_configured():
        logger.warning("[TERMII] Not configured. Would SMS %s: %s", phone, message)
        return {"success": False, "error": "TERMII_API_KEY not set"}
    to = normalize_phone(phone)
    if not to:
        return {"success": False, "error": "invalid phone"}
    data = await _post("/api/sms/send", {
        "to": to,
        "from": SENDER_ID,
        "sms": message,
        "type": "plain",
        "channel": "generic",
        "api_key": API_KEY,
    })
    ok = "message_id" in data or str(data.get("code", "")).lower() == "ok"
    if ok:
        logger.info("[TERMII] SMS sent to %s", to)
    else:
        logger.error("[TERMII] SMS failed to %s: %s", to, data)
    return {"success": ok, "channel": "sms", "response": data}


async def send_whatsapp(phone: str, data_vars: dict) -> dict:
    """Send a pre-approved WhatsApp template. `data_vars` keys must match the template."""
    if not whatsapp_ready():
        return {"success": False, "error": "WhatsApp template/device not configured"}
    to = normalize_phone(phone)
    if not to:
        return {"success": False, "error": "invalid phone"}
    data = await _post("/api/send/template", {
        "phone_number": to,
        "device_id": DEVICE_ID,
        "template_id": TEMPLATE_ID,
        "api_key": API_KEY,
        "data": data_vars,
    })
    # Termii template endpoint returns a list/array of message envelopes on success
    ok = isinstance(data, list) or "message_id" in (data if isinstance(data, dict) else {})
    if ok:
        logger.info("[TERMII] WhatsApp template sent to %s", to)
    else:
        logger.error("[TERMII] WhatsApp failed to %s: %s", to, data)
    return {"success": ok, "channel": "whatsapp", "response": data}


async def send_reminder(
    phone: str, name: str, amount: float, due_date: str, estate: str = ""
) -> dict:
    """Send a rent reminder over WhatsApp (if configured) and/or SMS."""
    if not is_configured():
        logger.warning("[TERMII] Not configured — skipping reminder to %s", phone)
        return {"success": False, "error": "TERMII_API_KEY not set"}

    results = {}

    if CHANNEL in ("whatsapp", "both"):
        if whatsapp_ready():
            results["whatsapp"] = await send_whatsapp(phone, {
                "name": name or "there",
                "amount": format_currency(amount),
                "due_date": due_date,
                "estate": estate,
            })
            if CHANNEL == "whatsapp":
                return {"success": results["whatsapp"]["success"], **results}
        else:
            logger.warning("[TERMII] WhatsApp not fully configured — falling back to SMS")

    msg = (
        f"Hi {name or 'there'}, your rent of {format_currency(amount)} is due on "
        f"{due_date}. Please pay on time to avoid disruption. — BamiHustle"
    )
    results["sms"] = await send_sms(phone, msg)
    any_ok = any(r.get("success") for r in results.values())
    return {"success": any_ok, **results}
