from fastapi import APIRouter, HTTPException, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime
import hashlib, secrets

from models.user import User
from models.wallet import Wallet
from schemas.auth import (
    RegisterRequest, LoginRequest, TokenResponse,
    ForgotPasswordRequest, ResetPasswordRequest, ChangePasswordRequest,
)
from core.security import hash_password, verify_password, create_access_token, get_current_user
from core.database import get_db
from core.db_helpers import find_one, save
from models.base import gen_uuid

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

    token = create_access_token(user.id, user.role)
    return {"success": True, "token": token, "user": _user_dict(user)}


@router.post("/login")
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await find_one(db, User, User.email == body.email)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(body.password, user.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=401, detail="Account has been deactivated")

    user.last_login = datetime.utcnow()
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
    current_user.updated_at = datetime.utcnow()
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
    current_user.updated_at = datetime.utcnow()
    await save(db, current_user)
    return {"success": True, "message": "Password updated successfully"}


@router.post("/forgot-password")
async def forgot_password(body: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    user = await find_one(db, User, User.email == body.email)
    if not user:
        return {"success": True, "message": "If that email exists, a reset link has been sent"}

    token = secrets.token_urlsafe(32)
    user.password_reset_token = token
    from datetime import timedelta
    user.password_reset_expire = datetime.utcnow() + timedelta(hours=1)
    await save(db, user)

    return {"success": True, "message": "Password reset link sent", "debug_token": token}


@router.post("/reset-password")
async def reset_password(body: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    user = await find_one(db, User, User.password_reset_token == body.token)
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    if user.password_reset_expire and user.password_reset_expire < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Reset token has expired")

    user.password = hash_password(body.new_password)
    user.password_reset_token = None
    user.password_reset_expire = None
    user.updated_at = datetime.utcnow()
    await save(db, user)
    return {"success": True, "message": "Password has been reset successfully"}


@router.post("/logout")
async def logout(current_user: User = Depends(get_current_user)):
    return {"success": True, "message": "Logged out successfully"}
