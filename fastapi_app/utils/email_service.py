"""
Email service — Mailtrap sending API (verified domain required).

Env vars:
  MAILTRAP_TOKEN        — API token from Mailtrap > Sending > API Tokens
  FROM_EMAIL            — verified sender address (e.g. support@bamihost.com)
  FROM_NAME             — display name (default: BamiHost)
"""
import os
import logging
from typing import Optional, Union, List

logger = logging.getLogger(__name__)

MAILTRAP_TOKEN = os.getenv("MAILTRAP_TOKEN", "")
FROM_EMAIL     = os.getenv("FROM_EMAIL", os.getenv("MAILTRAP_SENDER_EMAIL", ""))
FROM_NAME      = os.getenv("FROM_NAME",  os.getenv("MAILTRAP_SENDER_NAME", "BamiHost"))

_client = None


def _get_client():
    global _client
    if _client is None:
        from mailtrap import MailtrapClient
        _client = MailtrapClient(token=MAILTRAP_TOKEN)
    return _client


def is_configured() -> bool:
    return bool(MAILTRAP_TOKEN and FROM_EMAIL)


def get_status() -> dict:
    missing = []
    if not MAILTRAP_TOKEN: missing.append("MAILTRAP_TOKEN")
    if not FROM_EMAIL:     missing.append("FROM_EMAIL")
    return {"ok": len(missing) == 0, "missing": missing}


def format_currency(amount: float) -> str:
    return f"₦{amount:,.0f}"


async def send_email(
    email:   Union[str, List[str]],
    subject: str,
    html:    Optional[str] = None,
    message: Optional[str] = None,
    name:    Optional[str] = None,
) -> dict:
    if not html and not message:
        raise ValueError("Either html or message must be provided")

    body_html = html or f"<p>{message}</p>"

    if not is_configured():
        logger.warning("[EMAIL] Mailtrap not configured. Would send to %s: %s", email, subject)
        return {"success": False, "error": "MAILTRAP_TOKEN or FROM_EMAIL not set"}

    recipients = [email] if isinstance(email, str) else email

    try:
        import asyncio
        from mailtrap import Mail, Address

        client = _get_client()
        mail = Mail(
            sender=Address(email=FROM_EMAIL, name=FROM_NAME),
            to=[Address(email=e.strip()) for e in recipients],
            subject=subject,
            html=body_html,
        )
        # SDK send() is sync — run in executor so we don't block the event loop
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, client.send, mail)

        logger.info("[EMAIL] Sent '%s' to %s", subject, recipients)
        return {"success": True}
    except Exception as e:
        logger.error("[EMAIL] Failed to send '%s': %s", subject, str(e))
        return {"success": False, "error": str(e)}


# ── Template helpers ──────────────────────────────────────────────────────────

async def send_welcome_email(recipient_email: str, name: str, password: str) -> dict:
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
      <h2 style="color:#2563eb">Welcome to BamiHost!</h2>
      <p>Hi {name},</p>
      <p>Your account has been created. Use the credentials below to log in:</p>
      <p><strong>Email:</strong> {recipient_email}</p>
      <p><strong>Temporary Password:</strong>
         <code style="background:#f3f4f6;padding:4px 8px;border-radius:4px">{password}</code></p>
      <p>Please change your password after your first login.</p>
      <p style="color:#6b7280;font-size:12px">BamiHost — Property Management</p>
    </div>"""
    return await send_email(recipient_email, "Welcome to BamiHost — Your Account Details", html=html)


async def send_rent_reminder(
    recipient_email: str, name: str, amount: float, due_date: str, estate: str = ""
) -> dict:
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
      <h2 style="color:#2563eb">Rent Payment Reminder</h2>
      <p>Hi {name},</p>
      <p>This is a reminder that your rent payment of <strong>{format_currency(amount)}</strong>
         is due on <strong>{due_date}</strong>.</p>
      {"<p>Property: " + estate + "</p>" if estate else ""}
      <p>Please ensure timely payment to avoid any inconvenience.</p>
      <p style="color:#6b7280;font-size:12px">BamiHost — Property Management</p>
    </div>"""
    return await send_email(recipient_email, "Rent Payment Reminder — BamiHost", html=html)


async def send_payment_confirmation(
    recipient_email: str, name: str, amount: float, reference: str, payment_type: str = "rent"
) -> dict:
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
      <h2 style="color:#16a34a">Payment Confirmed ✓</h2>
      <p>Hi {name},</p>
      <p>Your {payment_type} payment of <strong>{format_currency(amount)}</strong> has been received.</p>
      <p><strong>Reference:</strong> {reference}</p>
      <p>Thank you for your payment.</p>
      <p style="color:#6b7280;font-size:12px">BamiHost — Property Management</p>
    </div>"""
    return await send_email(recipient_email, f"Payment Confirmation — {format_currency(amount)}", html=html)


async def send_password_reset(recipient_email: str, name: str, reset_token: str) -> dict:
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
      <h2 style="color:#2563eb">Password Reset Request</h2>
      <p>Hi {name},</p>
      <p>Use the OTP below to reset your password:</p>
      <p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#2563eb">{reset_token}</p>
      <p>This code expires in 1 hour. If you did not request this, ignore this email.</p>
      <p style="color:#6b7280;font-size:12px">BamiHost — Property Management</p>
    </div>"""
    return await send_email(recipient_email, "Password Reset — BamiHost", html=html)


async def send_overdue_notice(
    recipient_email: str, name: str, amount: float, days_overdue: int
) -> dict:
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
      <h2 style="color:#dc2626">Overdue Payment Notice</h2>
      <p>Hi {name},</p>
      <p>Your rent payment of <strong>{format_currency(amount)}</strong> is
         <strong>{days_overdue} days overdue</strong>.</p>
      <p>Please make payment immediately to avoid further action.</p>
      <p style="color:#6b7280;font-size:12px">BamiHost — Property Management</p>
    </div>"""
    return await send_email(recipient_email, f"Overdue Rent Notice — {days_overdue} Days Past Due", html=html)
