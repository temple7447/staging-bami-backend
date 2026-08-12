from fastapi import APIRouter, HTTPException, Depends, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime, timedelta
from typing import Optional
import hashlib, secrets, random, re

from models.user import User
from models.wallet import Wallet
from models.estate import Estate
from models.phone_otp import PhoneOtp
from utils import sms_service
from schemas.auth import (
    RegisterRequest, LoginRequest, TokenResponse,
    ForgotPasswordRequest, ResetPasswordRequest, ChangePasswordRequest,
)
from core.security import (
    hash_password, verify_password, create_access_token, create_refresh_token,
    decode_refresh_token, password_fingerprint, get_current_user, require_super_admin,
)
from core.database import get_db
from core.db_helpers import find_one, find_all, save
from utils.email_service import send_welcome_email, send_password_reset
from utils.tenant_helpers import generate_temp_password
from models.base import gen_uuid
from utils.time_utils import utcnow
from utils.delete_otp import verify_delete_otp

router = APIRouter(prefix="/auth", tags=["Auth"])


def _user_dict(user: User) -> dict:
    return {
        "id":               user.id,
        "name":             user.name,
        "email":            user.email,
        "role":             user.role,
        "phone":            user.phone,
        "is_active":        user.is_active,
        "email_verified":   user.email_verified,
        "profile_image_url": user.profile_image_url,
        "agreement_signed_at": user.agreement_signed_at,
    }


def _session_tokens(user: User) -> dict:
    """Both halves of a session: the short-lived bearer token every request
    carries, plus the refresh token the client keeps to mint new ones."""
    return {
        "token":         create_access_token(user.id, user.role),
        "refresh_token": create_refresh_token(user.id, user.role, user.password),
    }


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await find_one(db, User, User.email == body.email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        id=gen_uuid(),
        name=body.name,
        email=body.email,
        password=hash_password(body.password),
        role=body.role,
        phone=getattr(body, "phone", None),
    )
    await save(db, user)

    wallet = Wallet(id=gen_uuid(), user_id=user.id, balance=0, currency="NGN")
    await save(db, wallet)

    await send_welcome_email(user.email, user.name, body.password, phone=user.phone or "")

    return {"success": True, **_session_tokens(user), "user": _user_dict(user)}


def _phone_suffix(raw: str) -> str:
    """Last 10 digits of a phone number — stable across '0803...', '+234803...',
    and '234803...' formats so a login lookup doesn't need normalized storage."""
    digits = re.sub(r"\D", "", raw or "")
    return digits[-10:] if len(digits) >= 10 else digits


async def _find_user_by_identifier(db: AsyncSession, identifier: str) -> User | None:
    """Resolve a login identifier to a User — an email address, or a phone
    number matched against User.phone regardless of how it was formatted."""
    ident = (identifier or "").strip()
    if not ident:
        return None
    if "@" in ident:
        return await find_one(db, User, func.lower(User.email) == ident.lower())

    suffix = _phone_suffix(ident)
    if len(suffix) < 7:  # too short to be a real phone number
        return None
    matches = (await db.execute(
        select(User).where(User.phone.isnot(None), User.phone.like(f"%{suffix}"))
    )).scalars().all()
    return matches[0] if len(matches) == 1 else None


@router.post("/login")
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await _find_user_by_identifier(db, body.email)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(body.password, user.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=401, detail="Account has been deactivated")

    user.last_login = utcnow()
    await save(db, user)

    return {"success": True, **_session_tokens(user), "user": _user_dict(user)}


@router.post("/refresh")
async def refresh_session(body: dict, db: AsyncSession = Depends(get_db)):
    """Exchange a refresh token for a fresh access token (and a rotated refresh
    token), so a returning user is never bounced back to the login screen while
    their refresh token is still good."""
    raw = (body or {}).get("refresh_token") or (body or {}).get("refreshToken")
    if not raw:
        raise HTTPException(status_code=400, detail="refresh_token is required")

    payload = decode_refresh_token(raw)
    user = await find_one(db, User, User.id == payload.get("id"))
    if not user:
        raise HTTPException(status_code=401, detail="No user found with this token")
    if not user.is_active:
        raise HTTPException(status_code=401, detail="Account has been deactivated")
    # A password change/reset rotates the fingerprint, retiring older sessions.
    if payload.get("pwd") != password_fingerprint(user.password):
        raise HTTPException(status_code=401, detail="Session expired — please sign in again")

    return {"success": True, **_session_tokens(user), "user": _user_dict(user)}


@router.post("/session/upgrade")
async def upgrade_session(current_user: User = Depends(get_current_user)):
    """Hand a refresh token to a client that only has a (still-valid) access
    token — apps installed before refresh tokens existed. Costs the caller a
    valid bearer token, so it grants nothing they don't already hold."""
    return {"success": True, **_session_tokens(current_user), "user": _user_dict(current_user)}


@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user)):
    return {"success": True, "user": _user_dict(current_user)}


@router.put("/update-details")
async def update_details(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    allowed = {"name", "phone", "position", "bio"}
    for key, val in body.items():
        if key in allowed:
            setattr(current_user, key, val)
    current_user.updated_at = utcnow()
    await save(db, current_user)
    return {"success": True, "user": _user_dict(current_user)}


@router.put("/update-password")
async def update_password(
    body: ChangePasswordRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(body.current_password, current_user.password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    current_user.password = hash_password(body.new_password)
    current_user.updated_at = utcnow()
    await save(db, current_user)
    # Changing the password retires every refresh token minted under the old
    # one — hand this client a replacement pair so the person who *made* the
    # change isn't the one who gets signed out.
    return {"success": True, "message": "Password updated successfully", **_session_tokens(current_user)}


_SIGN_REQUIRED_ROLES = {"business_owner", "manager", "super_manager", "vendor", "super_vendor", "super_admin", "admin"}


@router.post("/me/sign-agreement", status_code=status.HTTP_201_CREATED)
async def sign_my_agreement(
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in _SIGN_REQUIRED_ROLES:
        raise HTTPException(status_code=400, detail="Not applicable to your account type")
    if current_user.agreement_signed_at:
        raise HTTPException(status_code=400, detail="You have already signed")

    typed_name = (body.get("typedName") or "").strip()
    if not typed_name:
        raise HTTPException(status_code=400, detail="Type your full name to sign")

    current_user.agreement_signed_at = utcnow()
    current_user.agreement_typed_name = typed_name
    current_user.agreement_signature_image = body.get("signatureImage")
    current_user.updated_at = utcnow()
    await save(db, current_user)
    return {"success": True, "user": _user_dict(current_user)}


# ── Phone OTP (Bami-Wash) ──────────────────────────────────────────────────────
# Customer-facing phone sign-in/sign-up for the car-wash app. Distinct from the
# email/password flow above — a phone-only account gets a synthetic unique
# email (User.email is NOT NULL UNIQUE) that's never used for contact/login.

_STAFF_ROLE_HINTS = {"wash_staff", "business_owner", "manager", "super_manager", "admin", "super_admin"}


def _phone_user_dict(user: User) -> dict:
    return {
        "id": user.id,
        "phone": user.phone,
        "name": user.name,
        "role": "staff" if user.role in _STAFF_ROLE_HINTS else "customer",
        "created_at": user.created_at,
    }


@router.post("/phone/send-otp", status_code=status.HTTP_201_CREATED)
async def send_phone_otp(body: dict, db: AsyncSession = Depends(get_db)):
    phone = (body.get("phone") or "").strip()
    if not re.match(r"^\+?\d{10,15}$", phone):
        raise HTTPException(status_code=400, detail="Enter a valid phone number")

    code = f"{random.randint(0, 999999):06d}"
    request_id = gen_uuid()
    expires_at = utcnow() + timedelta(minutes=10)
    otp = PhoneOtp(id=gen_uuid(), request_id=request_id, phone=phone,
                   code_hash=hash_password(code), expires_at=expires_at)
    await save(db, otp)

    message = f"Your Bami-Wash verification code is {code}. It expires in 10 minutes."
    result = await sms_service.send_sms(phone, message)
    if not result.get("success"):
        raise HTTPException(status_code=502, detail="Couldn't send the verification code. Please try again.")

    return {"success": True, "requestId": request_id, "expiresAt": expires_at}


@router.post("/phone/verify-otp", status_code=status.HTTP_201_CREATED)
async def verify_phone_otp(body: dict, db: AsyncSession = Depends(get_db)):
    request_id = (body.get("requestId") or "").strip()
    code = (body.get("code") or "").strip()
    name = (body.get("name") or "").strip() or None

    otp = await find_one(db, PhoneOtp, PhoneOtp.request_id == request_id, PhoneOtp.consumed == False)
    if not otp:
        raise HTTPException(status_code=400, detail="This code has expired. Request a new one.")
    if otp.expires_at < utcnow():
        raise HTTPException(status_code=400, detail="This code has expired. Request a new one.")
    if not verify_password(code, otp.code_hash):
        raise HTTPException(status_code=400, detail="That code does not match. Please try again.")

    # Only mark the code consumed once every other precondition is satisfied —
    # a new-signup request missing `name` must NOT burn the code, or the
    # customer's next (correct) retry finds nothing left to verify against.
    user = await find_one(db, User, User.phone == otp.phone)
    if not user and not name:
        raise HTTPException(status_code=400, detail="Tell us your name to finish setting up.")

    otp.consumed = True
    await save(db, otp)

    if not user:
        placeholder_email = f"{re.sub(r'[^0-9]', '', otp.phone)}@phone.bamiwash.internal"
        user = User(id=gen_uuid(), name=name, phone=otp.phone, email=placeholder_email,
                    password=hash_password(secrets.token_urlsafe(24)),
                    role="wash_customer", email_verified=True)
        await save(db, user)
        await save(db, Wallet(id=gen_uuid(), user_id=user.id, balance=0, currency="NGN"))

    user.last_login = utcnow()
    await save(db, user)

    return {"success": True, **_session_tokens(user), "user": _phone_user_dict(user)}


@router.post("/forgot-password")
async def forgot_password(body: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    user = await find_one(db, User, User.email == body.email)
    if not user:
        return {"success": True, "message": "If that email exists, a reset code has been sent"}

    otp = str(random.randint(100000, 999999))
    user.password_reset_token = otp
    from datetime import timedelta
    user.password_reset_expire = utcnow() + timedelta(hours=1)
    await save(db, user)

    await send_password_reset(user.email, user.name or "User", otp)

    return {"success": True, "message": "Password reset code sent to your email"}


@router.post("/reset-password")
async def reset_password(body: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    user = await find_one(db, User, User.password_reset_token == body.otp)
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    if user.password_reset_expire and user.password_reset_expire < utcnow():
        raise HTTPException(status_code=400, detail="Reset token has expired")

    user.password = hash_password(body.password)
    user.password_reset_token = None
    user.password_reset_expire = None
    user.updated_at = utcnow()
    await save(db, user)
    return {"success": True, "message": "Password has been reset successfully"}


@router.post("/logout")
async def logout(current_user: User = Depends(get_current_user)):
    return {"success": True, "message": "Logged out successfully"}


# ── Business Owner management (super_admin only) ──────────────────────────────
# A business owner "owns" estates via Estate.owner == user.id (see core/authz).

async def _owned_estates(db: AsyncSession, owner_id: str, active_only: bool = True):
    conds = [Estate.owner == owner_id]
    if active_only:
        conds.append(Estate.is_active == True)
    return (await db.execute(select(Estate).where(*conds))).scalars().all()


async def _serialize_business_owner(db: AsyncSession, u: User) -> dict:
    estates = await _owned_estates(db, u.id)
    creator = None
    if u.created_by:
        c = await db.get(User, u.created_by)
        if c:
            creator = {"_id": c.id, "name": c.name, "email": c.email}
    return {
        "_id": u.id, "name": u.name, "email": u.email, "phone": u.phone,
        "role": u.role,
        "assignedEstates": [{"_id": e.id, "name": e.name, "totalUnits": e.total_units} for e in estates],
        "isActive": u.is_active, "emailVerified": u.email_verified,
        "lastLogin": u.last_login, "createdBy": creator,
        "createdAt": u.created_at, "updatedAt": u.updated_at,
    }


async def _assign_owned_estates(db: AsyncSession, owner_id: str, estate_ids: list, actor_id: str) -> None:
    """Make owner_id the owner of exactly `estate_ids` (release any it no longer holds)."""
    target = set(estate_ids or [])
    for e in await _owned_estates(db, owner_id, active_only=False):
        if e.id not in target:
            e.owner = None
            e.updated_by = actor_id
            await save(db, e)
    for eid in target:
        e = await db.get(Estate, eid)
        if e and e.is_active and e.owner != owner_id:
            e.owner = owner_id
            e.updated_by = actor_id
            await save(db, e)


async def _get_business_owner_or_404(db: AsyncSession, owner_id: str) -> User:
    u = await find_one(db, User, User.id == owner_id, User.role == "business_owner")
    if not u:
        raise HTTPException(status_code=404, detail="Business owner not found")
    return u


@router.post("/onboard-business-owner", status_code=status.HTTP_201_CREATED)
async def onboard_business_owner(
    body: dict, db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
):
    name  = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    phone = (body.get("phone") or "").strip()
    estate_ids = body.get("estateIds") or []
    send_creds = body.get("sendCredentials", True)

    if not name or not email or not phone:
        raise HTTPException(status_code=400, detail="Name, email and phone are required")
    if await find_one(db, User, func.lower(User.email) == email):
        raise HTTPException(status_code=400, detail="Email already registered")

    password = generate_temp_password(8)
    owner = User(id=gen_uuid(), name=name, email=email, phone=phone,
                 password=hash_password(password), role="business_owner",
                 created_by=actor.id, email_verified=True)
    await save(db, owner)
    await save(db, Wallet(id=gen_uuid(), user_id=owner.id, balance=0, currency="NGN"))
    await _assign_owned_estates(db, owner.id, estate_ids, actor.id)

    if send_creds:
        await send_welcome_email(email, name, password, phone=phone)

    return {"success": True, "message": "Business owner onboarded successfully",
            "data": await _serialize_business_owner(db, owner)}


@router.get("/business-owners")
async def list_business_owners(
    db: AsyncSession = Depends(get_db), actor: User = Depends(require_super_admin),
):
    owners = await find_all(db, User, User.role == "business_owner",
                            order_by=User.created_at.desc())
    data = [await _serialize_business_owner(db, u) for u in owners]
    return {"success": True, "count": len(data), "data": data}


@router.put("/business-owner/{owner_id}")
async def update_business_owner(
    owner_id: str, body: dict, db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
):
    owner = await _get_business_owner_or_404(db, owner_id)
    if body.get("name"):
        owner.name = body["name"].strip()
    if body.get("phone") is not None:
        owner.phone = (body["phone"] or "").strip() or None
    if body.get("email"):
        new_email = body["email"].strip().lower()
        if new_email != (owner.email or "").lower():
            if await find_one(db, User, func.lower(User.email) == new_email, User.id != owner.id):
                raise HTTPException(status_code=409, detail="Another account already uses this email")
            owner.email = new_email
    if body.get("estateIds") is not None:
        await _assign_owned_estates(db, owner.id, body["estateIds"], actor.id)
    owner.updated_at = utcnow()
    await save(db, owner)
    return {"success": True, "message": "Business owner updated successfully",
            "data": await _serialize_business_owner(db, owner)}


@router.put("/business-owner/{owner_id}/status")
async def set_business_owner_status(
    owner_id: str, body: dict, db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
):
    owner = await _get_business_owner_or_404(db, owner_id)
    owner.is_active = bool(body.get("isActive"))
    owner.updated_at = utcnow()
    await save(db, owner)
    return {"success": True,
            "message": f"Business owner {'activated' if owner.is_active else 'deactivated'} successfully",
            "data": await _serialize_business_owner(db, owner)}


@router.delete("/business-owner/{owner_id}")
async def delete_business_owner(
    owner_id: str,
    otp_id: Optional[str] = Query(None, alias="otpId"),
    otp_code: Optional[str] = Query(None, alias="otpCode"),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
):
    owner = await _get_business_owner_or_404(db, owner_id)
    await verify_delete_otp(db, otp_id, otp_code, "business_owner", owner_id)
    # Release their estates so no record points at a deleted owner.
    for e in await _owned_estates(db, owner.id, active_only=False):
        e.owner = None
        e.updated_by = actor.id
        await save(db, e)
    wallet = await find_one(db, Wallet, Wallet.user_id == owner.id)
    if wallet:
        await db.delete(wallet)
    await db.delete(owner)
    await db.commit()
    return {"success": True, "message": "Business owner removed successfully"}


@router.post("/business-owner/{owner_id}/resend-credentials")
async def resend_business_owner_credentials(
    owner_id: str, db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
):
    owner = await _get_business_owner_or_404(db, owner_id)
    password = generate_temp_password(8)
    owner.password = hash_password(password)
    owner.is_active = True
    owner.updated_at = utcnow()
    await save(db, owner)
    result = await send_welcome_email(owner.email, owner.name or "Business Owner", password, phone=owner.phone or "")
    if not result.get("success"):
        raise HTTPException(status_code=502, detail="Password reset but the email could not be sent. Please try again.")
    return {"success": True, "message": f"Login credentials sent to {owner.email}"}


# ── Manager management (super_admin only) ─────────────────────────────────────
# A manager is scoped to estates listed in user.assigned_estates (see core/authz).

async def _serialize_manager(db: AsyncSession, u: User) -> dict:
    ids = u.assigned_estates or []
    estates = []
    if ids:
        estates = (await db.execute(
            select(Estate).where(Estate.id.in_(ids), Estate.is_active == True)
        )).scalars().all()
    creator = None
    if u.created_by:
        c = await db.get(User, u.created_by)
        if c:
            creator = {"_id": c.id, "name": c.name, "email": c.email}
    return {
        "_id": u.id, "name": u.name, "email": u.email, "phone": u.phone,
        "role": u.role,
        "assignedEstates": [{"_id": e.id, "name": e.name, "totalUnits": e.total_units} for e in estates],
        "isActive": u.is_active, "emailVerified": u.email_verified,
        "lastLogin": u.last_login, "createdBy": creator,
        "createdAt": u.created_at, "updatedAt": u.updated_at,
    }


async def _valid_estate_ids(db: AsyncSession, estate_ids: list) -> list:
    """Keep only ids that map to an existing, active estate (order-preserving, de-duped)."""
    ids = list(dict.fromkeys(estate_ids or []))
    if not ids:
        return []
    rows = (await db.execute(
        select(Estate.id).where(Estate.id.in_(ids), Estate.is_active == True)
    )).scalars().all()
    valid = set(rows)
    return [i for i in ids if i in valid]


async def _get_manager_or_404(db: AsyncSession, manager_id: str) -> User:
    u = await find_one(db, User, User.id == manager_id, User.role == "manager")
    if not u:
        raise HTTPException(status_code=404, detail="Manager not found")
    return u


@router.post("/onboard-manager", status_code=status.HTTP_201_CREATED)
async def onboard_manager(
    body: dict, db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
):
    name  = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    phone = (body.get("phone") or "").strip()
    position = (body.get("position") or "").strip() or None
    estate_ids = await _valid_estate_ids(db, body.get("estateIds") or [])
    send_creds = body.get("sendCredentials", True)

    if not name or not email:
        raise HTTPException(status_code=400, detail="Name and email are required")
    if await find_one(db, User, func.lower(User.email) == email):
        raise HTTPException(status_code=400, detail="Email already registered")

    password = generate_temp_password(8)
    manager = User(id=gen_uuid(), name=name, email=email, phone=phone or None,
                   position=position, assigned_estates=estate_ids,
                   password=hash_password(password), role="manager",
                   created_by=actor.id, email_verified=True)
    await save(db, manager)
    await save(db, Wallet(id=gen_uuid(), user_id=manager.id, balance=0, currency="NGN"))

    if send_creds:
        await send_welcome_email(email, name, password, phone=phone)

    return {"success": True, "message": "Manager onboarded successfully",
            "data": await _serialize_manager(db, manager)}


@router.get("/managers")
async def list_managers(
    db: AsyncSession = Depends(get_db), actor: User = Depends(require_super_admin),
):
    managers = await find_all(db, User, User.role == "manager",
                              order_by=User.created_at.desc())
    data = [await _serialize_manager(db, u) for u in managers]
    return {"success": True, "count": len(data), "data": data}


@router.put("/manager/{manager_id}")
async def update_manager(
    manager_id: str, body: dict, db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
):
    manager = await _get_manager_or_404(db, manager_id)
    if body.get("name"):
        manager.name = body["name"].strip()
    if body.get("phone") is not None:
        manager.phone = (body["phone"] or "").strip() or None
    if body.get("position") is not None:
        manager.position = (body["position"] or "").strip() or None
    if body.get("email"):
        new_email = body["email"].strip().lower()
        if new_email != (manager.email or "").lower():
            if await find_one(db, User, func.lower(User.email) == new_email, User.id != manager.id):
                raise HTTPException(status_code=409, detail="Another account already uses this email")
            manager.email = new_email
    if body.get("estateIds") is not None:
        manager.assigned_estates = await _valid_estate_ids(db, body["estateIds"])
    manager.updated_at = utcnow()
    await save(db, manager)
    return {"success": True, "message": "Manager updated successfully",
            "data": await _serialize_manager(db, manager)}


@router.put("/manager/{manager_id}/status")
async def set_manager_status(
    manager_id: str, body: dict, db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
):
    manager = await _get_manager_or_404(db, manager_id)
    manager.is_active = bool(body.get("isActive"))
    manager.updated_at = utcnow()
    await save(db, manager)
    return {"success": True,
            "message": f"Manager {'activated' if manager.is_active else 'deactivated'} successfully",
            "data": await _serialize_manager(db, manager)}


@router.delete("/manager/{manager_id}")
async def delete_manager(
    manager_id: str,
    otp_id: Optional[str] = Query(None, alias="otpId"),
    otp_code: Optional[str] = Query(None, alias="otpCode"),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
):
    manager = await _get_manager_or_404(db, manager_id)
    await verify_delete_otp(db, otp_id, otp_code, "manager", manager_id)
    wallet = await find_one(db, Wallet, Wallet.user_id == manager.id)
    if wallet:
        await db.delete(wallet)
    await db.delete(manager)
    await db.commit()
    return {"success": True, "message": "Manager removed successfully"}


@router.post("/manager/{manager_id}/resend-credentials")
async def resend_manager_credentials(
    manager_id: str, db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
):
    manager = await _get_manager_or_404(db, manager_id)
    password = generate_temp_password(8)
    manager.password = hash_password(password)
    manager.is_active = True
    manager.updated_at = utcnow()
    await save(db, manager)
    result = await send_welcome_email(manager.email, manager.name or "Manager", password, phone=manager.phone or "")
    if not result.get("success"):
        raise HTTPException(status_code=502, detail="Password reset but the email could not be sent. Please try again.")
    return {"success": True, "message": f"Login credentials sent to {manager.email}"}


# ── Vendor management (super_admin only) ──────────────────────────────────────
# A vendor reports to a manager (user.manager); their business-profile columns
# already exist on User (added for the earlier CRM-style vendor concept).

async def _serialize_vendor(db: AsyncSession, u: User) -> dict:
    creator = None
    if u.created_by:
        c = await db.get(User, u.created_by)
        if c:
            creator = {"_id": c.id, "name": c.name, "email": c.email}
    return {
        "_id": u.id, "name": u.name, "email": u.email, "phone": u.phone,
        "role": u.role, "position": u.position, "managerId": u.manager,
        "businessTypeId": u.business_type_id, "businessName": u.business_name,
        "specialization": u.specialization, "bio": u.bio,
        "cacNumber": u.cac_number, "govId": u.gov_id, "certification": u.certification,
        "businessAddress": u.business_address, "portfolio": u.portfolio or [],
        "isVerifiedPro": u.is_verified_pro,
        "isActive": u.is_active, "emailVerified": u.email_verified,
        "lastLogin": u.last_login, "createdBy": creator,
        "createdAt": u.created_at, "updatedAt": u.updated_at,
    }


async def _get_vendor_or_404(db: AsyncSession, vendor_id: str) -> User:
    u = await find_one(db, User, User.id == vendor_id, User.role == "vendor")
    if not u:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return u


@router.post("/onboard-vendor", status_code=status.HTTP_201_CREATED)
async def onboard_vendor(
    body: dict, db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
):
    name  = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    phone = (body.get("phone") or "").strip()
    position = (body.get("position") or "").strip() or None
    manager_id = body.get("managerId") or None
    business_type_id = body.get("businessTypeId") or None
    send_creds = body.get("sendCredentials", True)

    if not name or not email:
        raise HTTPException(status_code=400, detail="Name and email are required")
    if await find_one(db, User, func.lower(User.email) == email):
        raise HTTPException(status_code=400, detail="Email already registered")
    if manager_id and not await find_one(db, User, User.id == manager_id, User.role == "manager"):
        raise HTTPException(status_code=400, detail="Selected manager was not found")

    password = generate_temp_password(8)
    vendor = User(id=gen_uuid(), name=name, email=email, phone=phone or None,
                  position=position, manager=manager_id, business_type_id=business_type_id,
                  password=hash_password(password), role="vendor",
                  created_by=actor.id, email_verified=True)
    await save(db, vendor)
    await save(db, Wallet(id=gen_uuid(), user_id=vendor.id, balance=0, currency="NGN"))

    if send_creds:
        await send_welcome_email(email, name, password, phone=phone)

    return {"success": True, "message": "Vendor onboarded successfully",
            "data": await _serialize_vendor(db, vendor)}


@router.get("/vendors")
async def list_vendors(
    db: AsyncSession = Depends(get_db), actor: User = Depends(require_super_admin),
):
    vendors = await find_all(db, User, User.role == "vendor",
                             order_by=User.created_at.desc())
    data = [await _serialize_vendor(db, u) for u in vendors]
    return {"success": True, "count": len(data), "data": data}


@router.put("/vendor/{vendor_id}")
async def update_vendor(
    vendor_id: str, body: dict, db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
):
    vendor = await _get_vendor_or_404(db, vendor_id)
    if body.get("name"):
        vendor.name = body["name"].strip()
    if body.get("phone") is not None:
        vendor.phone = (body["phone"] or "").strip() or None
    if body.get("email"):
        new_email = body["email"].strip().lower()
        if new_email != (vendor.email or "").lower():
            if await find_one(db, User, func.lower(User.email) == new_email, User.id != vendor.id):
                raise HTTPException(status_code=409, detail="Another account already uses this email")
            vendor.email = new_email
    if body.get("managerId") is not None:
        manager_id = body["managerId"] or None
        if manager_id and not await find_one(db, User, User.id == manager_id, User.role == "manager"):
            raise HTTPException(status_code=400, detail="Selected manager was not found")
        vendor.manager = manager_id
    for key, col in (
        ("businessTypeId", "business_type_id"), ("businessName", "business_name"),
        ("specialization", "specialization"), ("bio", "bio"),
        ("cacNumber", "cac_number"), ("govId", "gov_id"),
        ("certification", "certification"), ("businessAddress", "business_address"),
    ):
        if body.get(key) is not None:
            setattr(vendor, col, (body[key] or "").strip() or None)
    if body.get("isVerifiedPro") is not None:
        vendor.is_verified_pro = bool(body["isVerifiedPro"])
    if body.get("portfolio") is not None:
        vendor.portfolio = body["portfolio"] or []
    vendor.updated_at = utcnow()
    await save(db, vendor)
    return {"success": True, "message": "Vendor updated successfully",
            "data": await _serialize_vendor(db, vendor)}


@router.put("/vendor/{vendor_id}/status")
async def set_vendor_status(
    vendor_id: str, body: dict, db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
):
    vendor = await _get_vendor_or_404(db, vendor_id)
    vendor.is_active = bool(body.get("isActive"))
    vendor.updated_at = utcnow()
    await save(db, vendor)
    return {"success": True,
            "message": f"Vendor {'activated' if vendor.is_active else 'deactivated'} successfully",
            "data": await _serialize_vendor(db, vendor)}


@router.delete("/vendor/{vendor_id}")
async def delete_vendor(
    vendor_id: str,
    otp_id: Optional[str] = Query(None, alias="otpId"),
    otp_code: Optional[str] = Query(None, alias="otpCode"),
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
):
    vendor = await _get_vendor_or_404(db, vendor_id)
    await verify_delete_otp(db, otp_id, otp_code, "vendor", vendor_id)
    wallet = await find_one(db, Wallet, Wallet.user_id == vendor.id)
    if wallet:
        await db.delete(wallet)
    await db.delete(vendor)
    await db.commit()
    return {"success": True, "message": "Vendor removed successfully"}


@router.post("/vendor/{vendor_id}/resend-credentials")
async def resend_vendor_credentials(
    vendor_id: str, db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
):
    vendor = await _get_vendor_or_404(db, vendor_id)
    password = generate_temp_password(8)
    vendor.password = hash_password(password)
    vendor.is_active = True
    vendor.updated_at = utcnow()
    await save(db, vendor)
    result = await send_welcome_email(vendor.email, vendor.name or "Vendor", password, phone=vendor.phone or "")
    if not result.get("success"):
        raise HTTPException(status_code=502, detail="Password reset but the email could not be sent. Please try again.")
    return {"success": True, "message": f"Login credentials sent to {vendor.email}"}


@router.get("/public/vendors")
async def list_public_vendors(search: str | None = None, db: AsyncSession = Depends(get_db)):
    conds = [User.role == "vendor", User.is_active == True]
    vendors = await find_all(db, User, *conds, order_by=User.created_at.desc())
    if search:
        needle = search.strip().lower()
        vendors = [
            v for v in vendors
            if needle in (v.name or "").lower()
            or needle in (v.business_name or "").lower()
            or needle in (v.specialization or "").lower()
        ]
    data = [await _serialize_vendor(db, v) for v in vendors]
    return {"success": True, "count": len(data), "data": data}


@router.get("/public/vendors/{vendor_id}")
async def get_public_vendor(vendor_id: str, db: AsyncSession = Depends(get_db)):
    vendor = await find_one(db, User, User.id == vendor_id, User.role == "vendor", User.is_active == True)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return {"success": True, "data": await _serialize_vendor(db, vendor)}
