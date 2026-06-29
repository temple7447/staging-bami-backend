"""
Telegram messaging service — replaces WhatsApp/Termii for all AI-generated messages.

Sending flow:
  send_to_tenant(db, tenant_id, text)  — looks up Tenant.telegram_id
  send_to_owner(db, owner_id, text)    — looks up CoachUser.telegram_id
  send_to_chat(chat_id, text)          — direct send to any known chat_id

Recipients must have started the bot first before we can message them.
"""
import logging
import os
import httpx

logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
_API_BASE = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"


# ── Core send ─────────────────────────────────────────────────────────────────

async def send_to_chat(chat_id: str | int, text: str) -> dict:
    """Send a plain-text Telegram message to a known chat_id."""
    if not TELEGRAM_BOT_TOKEN:
        logger.warning("[TELEGRAM] BOT_TOKEN not set — message skipped")
        return {"success": False, "error": "BOT_TOKEN not configured"}
    if not chat_id:
        return {"success": False, "error": "No chat_id"}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{_API_BASE}/sendMessage", json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "Markdown",
            })
            data = resp.json()
            ok = data.get("ok", False)
            if not ok:
                logger.warning("[TELEGRAM] Send failed for %s: %s", chat_id, data.get("description"))
            return {"success": ok, "response": data}
    except Exception as e:
        logger.error("[TELEGRAM] Error sending to %s: %s", chat_id, e)
        return {"success": False, "error": str(e)}


async def send_to_tenant(db, tenant_id: str, text: str) -> dict:
    """Send a Telegram message to a tenant by their DB tenant_id."""
    try:
        from sqlalchemy import select
        from models.tenant import Tenant
        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalars().first()
        if not tenant or not tenant.telegram_id:
            logger.info("[TELEGRAM] Tenant %s has no Telegram linked — message queued only", tenant_id)
            return {"success": False, "error": "Tenant has not connected Telegram yet"}
        return await send_to_chat(tenant.telegram_id, text)
    except Exception as e:
        logger.error("[TELEGRAM] send_to_tenant failed: %s", e)
        return {"success": False, "error": str(e)}


async def send_to_owner(db, owner_id: str, text: str) -> dict:
    """Send a Telegram message to a business owner via their CoachUser record."""
    try:
        from sqlalchemy import select
        from models.coach import CoachUser
        coach = (await db.execute(
            select(CoachUser).where(CoachUser.user_id == owner_id)
        )).scalars().first()
        if not coach or not coach.telegram_id:
            logger.info("[TELEGRAM] Owner %s has no Telegram linked", owner_id)
            return {"success": False, "error": "Owner has not connected Telegram bot"}
        return await send_to_chat(coach.telegram_id, text)
    except Exception as e:
        logger.error("[TELEGRAM] send_to_owner failed: %s", e)
        return {"success": False, "error": str(e)}


async def send_to_tenant_by_phone(db, phone: str, text: str) -> dict:
    """Look up tenant by phone and send Telegram message."""
    try:
        from sqlalchemy import select, or_
        from models.tenant import Tenant
        # Normalize phone for matching
        clean = phone.replace(" ", "").replace("-", "").replace("+", "")
        result = await db.execute(
            select(Tenant).where(
                Tenant.is_active == True,
                or_(
                    Tenant.tenant_phone.contains(clean[-10:]),  # last 10 digits
                    Tenant.tenant_phone == phone,
                )
            ).limit(1)
        )
        tenant = result.scalars().first()
        if not tenant:
            return {"success": False, "error": f"No tenant found with phone {phone}"}
        if not tenant.telegram_id:
            return {"success": False, "error": f"Tenant {tenant.tenant_name} has not connected Telegram"}
        return await send_to_chat(tenant.telegram_id, text)
    except Exception as e:
        logger.error("[TELEGRAM] send_to_tenant_by_phone failed: %s", e)
        return {"success": False, "error": str(e)}


def is_configured() -> bool:
    return bool(TELEGRAM_BOT_TOKEN)
