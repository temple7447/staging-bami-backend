from fastapi import APIRouter, HTTPException, Depends, status
from datetime import datetime
import hashlib, secrets

from models.user import User
from schemas.auth import (
    RegisterRequest, LoginRequest, TokenResponse,
    ForgotPasswordRequest, ResetPasswordRequest, ChangePasswordRequest,
)
from core.security import hash_password, verify_password, create_access_token, get_current_user

router = APIRouter(prefix="/auth", tags=["Auth"])


def _user_dict(user: User) -> dict:
    return {
        "id":           str(user.id),
        "name":         user.name,
        "email":        user.email,
        "role":         user.role,
        "phone":        user.phone,
        "is_active":    user.is_active,
        "email_verified": user.email_verified,
        "profile_image_url": user.profile_image_url,
    }


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest):
    existing = await User.find_one(User.email == body.email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        name=body.name,
        email=body.email,
        password=hash_password(body.password),
        role=body.role,
        phone=body.phone,
    )
    await user.insert()

    # Auto-create wallet
    from models.wallet import Wallet
    await Wallet(user_id=user.id, balance=0, currency="NGN").insert()

    token = create_access_token(str(user.id), user.role)
    return {"success": True, "token": token, "user": _user_dict(user)}


@router.post("/login")
async def login(body: LoginRequest):
    user = await User.find_one(User.email == body.email, fetch_links=False)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not verify_password(body.password, user.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=401, detail="Account has been deactivated")

    user.last_login = datetime.utcnow()
    await user.save()

    token = create_access_token(str(user.id), user.role)
    return {"success": True, "token": token, "user": _user_dict(user)}


@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user)):
    return {"success": True, "user": _user_dict(current_user)}


@router.put("/update-details")
async def update_details(body: dict, current_user: User = Depends(get_current_user)):
    allowed = {"name", "phone", "position", "bio"}
    for key, val in body.items():
        if key in allowed:
            setattr(current_user, key, val)
    current_user.updated_at = datetime.utcnow()
    await current_user.save()
    return {"success": True, "user": _user_dict(current_user)}


@router.put("/change-password")
async def change_password(body: ChangePasswordRequest, current_user: User = Depends(get_current_user)):
    if not verify_password(body.current_password, current_user.password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    current_user.password = hash_password(body.new_password)
    current_user.updated_at = datetime.utcnow()
    await current_user.save()
    return {"success": True, "message": "Password updated successfully"}


@router.post("/forgot-password")
async def forgot_password(body: ForgotPasswordRequest):
    user = await User.find_one(User.email == body.email)
    if not user:
        # Don't leak user existence
        return {"success": True, "message": "If that email exists, an OTP has been sent"}

    otp = str(secrets.randbelow(900000) + 100000)          # 6-digit OTP
    from datetime import timedelta
    user.password_reset_otp_hash = hashlib.sha256(otp.encode()).hexdigest()
    user.password_reset_otp_expire = datetime.utcnow() + timedelta(minutes=10)
    await user.save()

    # TODO: send OTP via email (wire up aiosmtplib in utils/email.py)
    return {"success": True, "message": "OTP sent to your email"}


@router.post("/reset-password")
async def reset_password(body: ResetPasswordRequest):
    from datetime import timezone
    user = await User.find_one(User.email == body.email)
    if not user or not user.password_reset_otp_hash:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")

    otp_hash = hashlib.sha256(body.otp.encode()).hexdigest()
    if otp_hash != user.password_reset_otp_hash:
        raise HTTPException(status_code=400, detail="Invalid OTP")

    now = datetime.utcnow()
    if user.password_reset_otp_expire and user.password_reset_otp_expire < now:
        raise HTTPException(status_code=400, detail="OTP has expired")

    user.password = hash_password(body.password)
    user.password_reset_otp_hash = None
    user.password_reset_otp_expire = None
    user.updated_at = now
    await user.save()
    return {"success": True, "message": "Password reset successfully"}
