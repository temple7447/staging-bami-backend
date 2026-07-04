"""Symmetric encryption for secrets stored at rest (Integrations Hub auth
values). The reference app (echo-web-heart) stores these in plaintext —
this fixes that since we don't have Postgres RLS as a safety net here."""
import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken

from core.config import settings

logger = logging.getLogger(__name__)

_fernet: "Fernet | None" = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        key = settings.INTEGRATION_ENCRYPTION_KEY
        if not key:
            # Derive a stable key from JWT_SECRET so this works even if a
            # dedicated key hasn't been configured yet — still far better
            # than plaintext, though a real INTEGRATION_ENCRYPTION_KEY is
            # recommended for production.
            key = base64.urlsafe_b64encode(hashlib.sha256(settings.JWT_SECRET.encode()).digest()).decode()
            logger.warning("INTEGRATION_ENCRYPTION_KEY not set — deriving encryption key from JWT_SECRET")
        _fernet = Fernet(key if _is_fernet_key(key) else base64.urlsafe_b64encode(hashlib.sha256(key.encode()).digest()))
    return _fernet


def _is_fernet_key(key: str) -> bool:
    try:
        Fernet(key)
        return True
    except Exception:
        return False


def encrypt_secret(value: str) -> str:
    return _get_fernet().encrypt(value.encode()).decode()


def decrypt_secret(token: str) -> str:
    try:
        return _get_fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        logger.error("Failed to decrypt integration secret — key mismatch")
        raise
