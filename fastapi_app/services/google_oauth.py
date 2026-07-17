"""Server-side Google OAuth (Drive + Gmail + Calendar, read/write).

The owner connects once via the browser consent screen; we keep only the
refresh token (encrypted at rest) and mint short-lived access tokens on demand.
Token exchange/refresh is done directly against Google's token endpoint with
httpx so we don't need google-auth-oauthlib.

Setup (one-time, by the owner):
  1. Google Cloud Console → create an OAuth 2.0 Client ID (type: Web application).
  2. Enable the Google Drive, Gmail and Google Calendar APIs for the project.
  3. Add redirect URI = settings.GOOGLE_REDIRECT_URI (…/api/google/callback).
  4. Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI in env.

Connections made before the read/write upgrade only carry read-only scopes;
`has_write_scopes` lets callers detect that and prompt a reconnect (the consent
screen re-issues a refresh token with the new scopes).
"""
from __future__ import annotations

import logging
from urllib.parse import urlencode

import httpx
from google.oauth2.credentials import Credentials

from core.config import settings

logger = logging.getLogger(__name__)

AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URI = "https://oauth2.googleapis.com/token"
USERINFO_URI = "https://www.googleapis.com/oauth2/v3/userinfo"

# Read/write Drive + Gmail + Calendar, plus identity so we can label the
# connection. Full `drive` (not drive.file) so the workspace UI can browse
# everything the account owns, and doc/sheet creation works anywhere.
SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]

# The scopes the workspace UI needs beyond the original read-only connection.
_WRITE_SCOPES = {
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar",
}


def has_write_scopes(granted: str | None) -> bool:
    """True if a connection's granted scope string covers the read/write set."""
    have = set((granted or "").split())
    return _WRITE_SCOPES.issubset(have)


def is_configured() -> bool:
    return bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET
                and settings.GOOGLE_REDIRECT_URI)


def build_auth_url(state: str) -> str:
    """The URL to send the owner's browser to for consent.

    access_type=offline + prompt=consent guarantees a refresh token is returned.
    `state` carries our signed owner reference through the round trip.
    """
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
        "state": state,
    }
    return f"{AUTH_URI}?{urlencode(params)}"


async def exchange_code(code: str) -> dict:
    """Swap the authorization code for tokens. Returns Google's token JSON
    (access_token, refresh_token, expires_in, scope, id_token)."""
    data = {
        "code": code,
        "client_id": settings.GOOGLE_CLIENT_ID,
        "client_secret": settings.GOOGLE_CLIENT_SECRET,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "grant_type": "authorization_code",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(TOKEN_URI, data=data)
        r.raise_for_status()
        return r.json()


async def fetch_email(access_token: str) -> str | None:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(USERINFO_URI,
                                  headers={"Authorization": f"Bearer {access_token}"})
            if r.status_code == 200:
                return r.json().get("email")
    except Exception as e:
        logger.warning("[GOOGLE] userinfo failed: %s", e)
    return None


async def access_token_from_refresh(refresh_token: str) -> str:
    """Mint a fresh access token from the stored refresh token."""
    data = {
        "refresh_token": refresh_token,
        "client_id": settings.GOOGLE_CLIENT_ID,
        "client_secret": settings.GOOGLE_CLIENT_SECRET,
        "grant_type": "refresh_token",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(TOKEN_URI, data=data)
        r.raise_for_status()
        return r.json()["access_token"]


def credentials_from_token(access_token: str) -> Credentials:
    """Build a googleapiclient-compatible Credentials object from a bearer token.

    We already refreshed the token ourselves, so this is a simple bearer wrapper
    the Drive/Gmail service builders can consume.
    """
    return Credentials(
        token=access_token,
        refresh_token=None,
        token_uri=TOKEN_URI,
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=SCOPES,
    )
