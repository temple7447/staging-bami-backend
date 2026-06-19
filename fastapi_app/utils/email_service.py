"""
Email service — wraps Mailtrap API (same provider as the Node.js backend).
Uses the mailtrap-python SDK. Falls back to stdout log if not configured.
"""
import os
import logging
from typing import Optional, Union, List

logger = logging.getLogger(__name__)

MAILTRAP_TOKEN       = os.getenv("MAILTRAP_TOKEN", "")
MAILTRAP_SENDER_EMAIL = os.getenv("MAILTRAP_SENDER_EMAIL", "noreply@bamihost.com")
MAILTRAP_SENDER_NAME  = os.getenv("MAILTRAP_SENDER_NAME", "BamiHustle")

_client = None


def _get_client():
    global _client
    if _client is None:
        from mailtrap import MailtrapClient
        _client = MailtrapClient(token=MAILTRAP_TOKEN)
    return _client


def is_configured() -> bool:
    return bool(MAILTRAP_TOKEN)


def get_status() -> dict:
    missing = []
    if not MAILTRAP_TOKEN:        missing.append("MAILTRAP_TOKEN")
    if not MAILTRAP_SENDER_EMAIL: missing.append("MAILTRAP_SENDER_EMAIL")
    return {"ok": len(missing) == 0, "missing": missing}


def format_currency(amount: float) -> str:
    return f"₦{amount:,.0f}"


async def send_email(
    email:    Union[str, List[str]],
    subject:  str,
    html:     Optional[str] = None,
    message:  Optional[str] = None,
    name:     Optional[str] = None,
) -> dict:
    """Send an email via Mailtrap. Falls back to logging when not configured."""
    if not html and not message:
        raise ValueError("Either html or message must be provided")

    body_html = html or f"<p>{message}</p>"

    if not is_configured():
        logger.warning("[EMAIL] Mailtrap not configured. Would send to %s: %s", email, subject)
        return {"success": False, "error": "MAILTRAP_TOKEN not set"}

    try:
        from mailtrap import Mail, Address
        client = _get_client()

        if isinstance(email, str):
            recipients = [Address(email=e.strip()) for e in email.split(",")]
        else:
            recipients = [Address(email=e) for e in email]

        mail = Mail(
            sender   = Address(email=MAILTRAP_SENDER_EMAIL, name=MAILTRAP_SENDER_NAME),
            to       = recipients,
            subject  = subject,
            html     = body_html,
        )
        client.send(mail)
        logger.info("[EMAIL] Sent '%s' to %s", subject, email)
        return {"success": True}
    except Exception as e:
        logger.error("[EMAIL] Failed to send '%s': %s", subject, str(e))
        return {"success": False, "error": str(e)}


# ── Template helpers ─────────────────────────────────────────────────────────

async def send_welcome_email(recipient_email: str, name: str, password: str) -> dict:
    html = f"""
    <h2>Welcome to BamiHustle!</h2>
    <p>Hi {name},</p>
    <p>Your account has been created. Use the credentials below to log in:</p>
    <p><strong>Email:</strong> {recipient_email}</p>
    <p><strong>Temporary Password:</strong> {password}</p>
    <p>Please change your password after your first login.</p>
    """
    return await send_email(recipient_email, "Welcome to BamiHustle — Your Account Details", html=html)


async def send_rent_reminder(
    recipient_email: str, name: str, amount: float, due_date: str, estate: str = ""
) -> dict:
    html = f"""
    <h2>Rent Payment Reminder</h2>
    <p>Hi {name},</p>
    <p>This is a reminder that your rent payment of <strong>{format_currency(amount)}</strong>
       is due on <strong>{due_date}</strong>.</p>
    {"<p>Property: " + estate + "</p>" if estate else ""}
    <p>Please ensure timely payment to avoid any inconvenience.</p>
    """
    return await send_email(recipient_email, "Rent Payment Reminder — BamiHustle", html=html)


async def send_payment_confirmation(
    recipient_email: str, name: str, amount: float, reference: str, payment_type: str = "rent"
) -> dict:
    html = f"""
    <h2>Payment Confirmed</h2>
    <p>Hi {name},</p>
    <p>Your {payment_type} payment of <strong>{format_currency(amount)}</strong> has been received.</p>
    <p><strong>Reference:</strong> {reference}</p>
    <p>Thank you for your payment.</p>
    """
    return await send_email(recipient_email, f"Payment Confirmation — {format_currency(amount)}", html=html)


async def send_password_reset(recipient_email: str, name: str, reset_token: str) -> dict:
    html = f"""
    <h2>Password Reset Request</h2>
    <p>Hi {name},</p>
    <p>Use the token below to reset your password:</p>
    <p><strong>{reset_token}</strong></p>
    <p>This token expires in 1 hour. If you did not request this, ignore this email.</p>
    """
    return await send_email(recipient_email, "Password Reset — BamiHustle", html=html)


async def send_overdue_notice(
    recipient_email: str, name: str, amount: float, days_overdue: int
) -> dict:
    html = f"""
    <h2>Overdue Payment Notice</h2>
    <p>Hi {name},</p>
    <p>Your rent payment of <strong>{format_currency(amount)}</strong> is
       <strong>{days_overdue} days overdue</strong>.</p>
    <p>Please make payment immediately to avoid further action.</p>
    """
    return await send_email(recipient_email, f"Overdue Rent Notice — {days_overdue} Days Past Due", html=html)
