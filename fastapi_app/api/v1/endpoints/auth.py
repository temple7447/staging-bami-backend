from fastapi import APIRouter, HTTPException, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime
import hashlib, secrets, random, re

from models.user import User
from models.wallet import Wallet
from models.estate import Estate
from schemas.auth import (
    RegisterRequest, LoginRequest, TokenResponse,
    ForgotPasswordRequest, ResetPasswordRequest, ChangePasswordRequest,
)
from core.security import hash_password, verify_password, create_access_token, get_current_user, require_super_admin
from core.database import get_db
from core.db_helpers import find_one, find_all, save
from utils.email_service import send_welcome_email, send_password_reset
from utils.tenant_helpers import generate_temp_password
from models.base import gen_uuid
from utils.time_utils import utcnow

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

    token = create_access_token(user.id, user.role)
    return {"success": True, "token": token, "user": _user_dict(user)}


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

    token = create_access_token(user.id, user.role)
    return {"success": True, "token": token, "user": _user_dict(user)}


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
    return {"success": True, "message": "Password updated successfully"}


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
    user = await find_one(db, User, User.password_reset_token == body.token)
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    if user.password_reset_expire and user.password_reset_expire < utcnow():
        raise HTTPException(status_code=400, detail="Reset token has expired")

    user.password = hash_password(body.new_password)
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
    owner_id: str, db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
):
    owner = await _get_business_owner_or_404(db, owner_id)
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
    manager_id: str, db: AsyncSession = Depends(get_db),
    actor: User = Depends(require_super_admin),
):
    manager = await _get_manager_or_404(db, manager_id)
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
