from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import JWTError, jwt
import bcrypt as _bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from core.config import settings
from hashlib import sha256 as _sha256
from secrets import token_urlsafe as _token_urlsafe
import re

bearer_scheme = HTTPBearer()


def hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode(), _bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


def _parse_duration(expire_str: str, default: timedelta) -> timedelta:
    match = re.match(r"(\d+)([dhm])", expire_str or "")
    if not match:
        return default
    val, unit = int(match.group(1)), match.group(2)
    return {"d": timedelta(days=val), "h": timedelta(hours=val), "m": timedelta(minutes=val)}[unit]


def create_access_token(user_id: str, role: str) -> str:
    delta = _parse_duration(settings.JWT_EXPIRE, timedelta(days=30))
    expire = datetime.now(timezone.utc) + delta
    return jwt.encode(
        # jti keeps every issuance distinct — without it two tokens minted in the
        # same second are byte-identical, which makes rotation impossible to see.
        {"id": user_id, "role": role, "typ": "access", "jti": _token_urlsafe(8), "exp": expire},
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )


def password_fingerprint(password_hash: str) -> str:
    """Short digest of the stored bcrypt hash, embedded in refresh tokens so a
    password change (or reset) silently invalidates every refresh token issued
    before it — revocation without a token table."""
    return _sha256((password_hash or "").encode()).hexdigest()[:16]


def create_refresh_token(user_id: str, role: str, password_hash: str) -> str:
    """Long-lived token whose only power is minting new access tokens at
    /api/auth/refresh. Never accepted as a bearer token by get_current_user."""
    delta = _parse_duration(settings.JWT_REFRESH_EXPIRE, timedelta(days=180))
    expire = datetime.now(timezone.utc) + delta
    return jwt.encode(
        {
            "id": user_id,
            "role": role,
            "typ": "refresh",
            "jti": _token_urlsafe(8),
            "pwd": password_fingerprint(password_hash),
            "exp": expire,
        },
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authorized to access this resource")


def decode_refresh_token(token: str) -> dict:
    payload = decode_token(token)
    if payload.get("typ") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not a refresh token")
    return payload


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(lambda: None),  # overridden below
):
    from models.user import User
    payload = decode_token(credentials.credentials)
    result = await db.execute(select(User).where(User.id == payload["id"]))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="No user found with this token")
    if not user.is_active:
        raise HTTPException(status_code=401, detail="User account has been deactivated")
    return user


def _make_get_current_user():
    from core.database import get_db

    async def _get_current_user(
        credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
        db: AsyncSession = Depends(get_db),
    ):
        from models.user import User
        payload = decode_token(credentials.credentials)
        if payload.get("typ") == "refresh":
            raise HTTPException(status_code=401, detail="Refresh tokens cannot be used to access resources")
        result = await db.execute(select(User).where(User.id == payload["id"]))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="No user found with this token")
        if not user.is_active:
            raise HTTPException(status_code=401, detail="User account has been deactivated")
        return user

    return _get_current_user


get_current_user = _make_get_current_user()


def require_roles(*roles: str):
    async def checker(user=Depends(get_current_user)):
        if user.role not in roles:
            raise HTTPException(status_code=403, detail=f"Role '{user.role}' is not authorized")
        return user
    return checker


require_super_admin    = require_roles("super_admin")
require_admin_or_above = require_roles("super_admin", "admin", "super_manager")
require_business_owner = require_roles("super_admin", "business_owner")
require_lawyer          = require_roles("lawyer")
