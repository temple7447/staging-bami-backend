"""Shared bits for creating logins for people an admin adds (managers, vendors, owners, staff, lawyers,
contractors). Phone number is required; email is optional. A person with no email gets a login on a
made-up address (see core.contact_unique) and is reached by SMS."""
from fastapi import HTTPException

from core.contact_unique import is_valid_phone, placeholder_email, real_email
from utils import sms_service
from utils.email_service import send_welcome_email


def login_identity(email: str | None, phone: str | None) -> tuple[str, str | None, str]:
    """-> (login_email, real_email_or_None, clean_phone). Phone is required; email optional."""
    phone = (phone or "").strip()
    if not is_valid_phone(phone):
        raise HTTPException(status_code=400, detail="A phone number is required (at least 10 digits). Email is optional.")
    mail = real_email((email or "").strip().lower())
    return (mail or placeholder_email(phone)), mail, phone


async def deliver_credentials(name: str, email: str | None, phone: str | None, password: str, scope: str = "") -> dict:
    """Email the temporary password if there is a real email, and text it if there is a phone number.
    Never raises. Returns {channels, temp_password?}; the password is returned only when the person has no
    email, so the admin can pass it on if the text message does not arrive."""
    channels = []
    mail = real_email(email)
    if mail:
        try:
            res = await send_welcome_email(mail, name or "there", password, phone=phone or "")
            if not isinstance(res, dict) or res.get("success", True):
                channels.append("email")
        except Exception:
            pass
    if phone and sms_service.is_configured():
        try:
            res = await sms_service.send_credentials(phone, name or "there", mail or phone, password, estate=scope)
            if res.get("success"):
                channels.append("sms")
        except Exception:
            pass
    out = {"channels": channels, "login": "email" if mail else "phone"}
    if not mail:
        out["temp_password"] = password
    return out
