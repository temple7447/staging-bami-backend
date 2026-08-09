"""Delete-confirmation OTP — a one-time code sent to the owner's phone and
email before a business-critical delete (estate, unit, tenant, staff/vendor
account) is allowed to complete. This is an oversight gate, not self-
verification: it always goes to the owner, regardless of which admin or
manager actually triggers the delete."""
import hashlib
import hmac
import secrets
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.db_helpers import save
from models.base import gen_uuid
from models.delete_otp import DeleteOtp
from models.user import User
from utils.email_service import send_email
from utils.sms_service import send_sms
from utils.time_utils import utcnow

OTP_TTL_MINUTES = 10
MAX_ATTEMPTS = 5

RESOURCE_LABELS = {
    "estate": "Estate",
    "unit": "Unit",
    "tenant": "Tenant",
    "business_owner": "Business Owner",
    "manager": "Manager",
    "vendor": "Vendor",
}


def _hash_code(code: str) -> str:
    # JWT_SECRET as pepper — no new secret to manage, never leaves this process.
    return hmac.new(settings.JWT_SECRET.encode(), code.encode(), hashlib.sha256).hexdigest()


async def request_delete_otp(
    db: AsyncSession, actor: User, resource_type: str, resource_id: str, resource_label: str,
) -> dict:
    if not settings.ADMIN_OTP_PHONE and not settings.ADMIN_OTP_EMAIL:
        raise HTTPException(status_code=503, detail="Delete confirmation is not configured — contact the platform administrator")

    code = f"{secrets.randbelow(1_000_000):06d}"
    otp = DeleteOtp(
        id=gen_uuid(), resource_type=resource_type, resource_id=resource_id,
        resource_label=resource_label, requested_by=actor.id,
        code_hash=_hash_code(code), expires_at=utcnow() + timedelta(minutes=OTP_TTL_MINUTES),
    )
    await save(db, otp)

    label = RESOURCE_LABELS.get(resource_type, resource_type.replace("_", " ").title())
    actor_name = actor.name or actor.email or "An admin"
    message = (
        f"BamiHost: {actor_name} is about to delete {label} \"{resource_label}\". "
        f"Confirmation code: {code} (expires in {OTP_TTL_MINUTES} minutes). "
        f"If you did not expect this, do not share this code."
    )

    if settings.ADMIN_OTP_PHONE:
        await send_sms(settings.ADMIN_OTP_PHONE, message)
    if settings.ADMIN_OTP_EMAIL:
        await send_email(
            settings.ADMIN_OTP_EMAIL,
            subject=f"Delete confirmation needed: {label} \"{resource_label}\"",
            message=message,
        )

    return {"otpId": otp.id, "expiresInMinutes": OTP_TTL_MINUTES}


async def verify_delete_otp(
    db: AsyncSession, otp_id: str | None, code: str | None, resource_type: str, resource_id: str,
) -> None:
    """Raises on any failure; returns None (and marks the code used) on success."""
    if not otp_id or not code:
        raise HTTPException(status_code=400, detail="A confirmation code is required to delete this")

    otp = await db.get(DeleteOtp, otp_id)
    if not otp or otp.resource_type != resource_type or otp.resource_id != resource_id:
        raise HTTPException(status_code=400, detail="Invalid confirmation request — request a new code")
    if otp.used_at:
        raise HTTPException(status_code=400, detail="This code has already been used — request a new one")
    if otp.expires_at < utcnow():
        raise HTTPException(status_code=400, detail="This code has expired — request a new one")
    if otp.attempts >= MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Too many incorrect attempts — request a new code")

    if not hmac.compare_digest(_hash_code(code.strip()), otp.code_hash):
        otp.attempts += 1
        await save(db, otp)
        raise HTTPException(status_code=400, detail="Incorrect code")

    otp.used_at = utcnow()
    await save(db, otp)
