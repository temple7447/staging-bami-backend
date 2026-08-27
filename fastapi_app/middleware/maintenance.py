"""Platform-wide maintenance-mode kill switch.

Backed by the singleton Setting row (data.maintenance_mode /
data.maintenance_message) so it can be flipped instantly from
PUT /api/settings — no redeploy, no env var change. Cached in-process with a
short TTL to avoid a DB round trip on every single request; invalidated
immediately after a toggle so the very next request reflects it rather than
waiting out the TTL.

A tiny, explicit allowlist stays reachable while maintenance mode is on —
without it, a super_admin could flip the switch on and then have no way to
log in and flip it back off."""
import time
from fastapi import Request
from fastapi.responses import JSONResponse
from core.database import AsyncSessionLocal
from core.db_helpers import find_one
from models.setting import Setting

DEFAULT_MAINTENANCE_MESSAGE = (
    "BamiHost is undergoing scheduled maintenance. Please check back shortly."
)

_ALLOWED_PATHS = {
    "/", "/api-docs", "/api-redoc", "/openapi.json",
    "/api/auth/login", "/api/auth/refresh",
    "/api/settings",
    "/api/settings/maintenance/auto-enable",
}

_CACHE_TTL_SECONDS = 5
_cache = {"checked_at": 0.0, "enabled": False, "message": DEFAULT_MAINTENANCE_MESSAGE}


def invalidate_maintenance_cache() -> None:
    """Call right after writing Setting.data.maintenance_mode so the change
    is live on the next request instead of up to _CACHE_TTL_SECONDS later."""
    _cache["checked_at"] = 0.0


async def _refresh_cache() -> None:
    async with AsyncSessionLocal() as db:
        setting = await find_one(db, Setting)
        data = (setting.data or {}) if setting else {}
        _cache["enabled"] = bool(data.get("maintenance_mode") or False)
        _cache["message"] = data.get("maintenance_message") or DEFAULT_MAINTENANCE_MESSAGE
        _cache["checked_at"] = time.time()


async def maintenance_middleware(request: Request, call_next):
    if time.time() - _cache["checked_at"] > _CACHE_TTL_SECONDS:
        try:
            await _refresh_cache()
        except Exception:
            # A DB hiccup here must never itself take the whole app down —
            # serve normally and just try the read again next request.
            return await call_next(request)

    if _cache["enabled"] and request.method != "OPTIONS" and request.url.path not in _ALLOWED_PATHS:
        return JSONResponse(
            status_code=503,
            content={"success": False, "maintenance": True, "message": _cache["message"]},
        )

    return await call_next(request)
