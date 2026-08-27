from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from models.setting import Setting
from models.user import User
from core.security import require_super_admin
from core.database import get_db
from core.config import settings as app_settings
from core.db_helpers import find_one, save
from models.base import gen_uuid
from middleware.maintenance import DEFAULT_MAINTENANCE_MESSAGE, invalidate_maintenance_cache as _invalidate_maintenance_cache

router = APIRouter(prefix="/settings", tags=["Settings"])

BANK_DEFAULTS = {"bank_name": "UBA", "account_number": "1234567890", "account_name": "BamiHost Properties Ltd"}


class BankInfoBody(BaseModel):
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    account_name: Optional[str] = None


class PlatformSettingsBody(BaseModel):
    bank_info: Optional[BankInfoBody] = None
    maintenance_mode: Optional[bool] = None
    maintenance_message: Optional[str] = None


def _settings_payload(data: dict) -> dict:
    return {
        "bankInfo": {**BANK_DEFAULTS, **(data.get("bank_info") or {})},
        "maintenanceMode": bool(data.get("maintenance_mode") or False),
        "maintenanceMessage": data.get("maintenance_message") or DEFAULT_MAINTENANCE_MESSAGE,
    }


@router.get("")
async def get_platform_settings(
    db: AsyncSession = Depends(get_db), actor: User = Depends(require_super_admin),
):
    """Platform-wide config: the deposit bank account shown to tenants, and
    the maintenance-mode kill switch (see middleware/maintenance.py — while
    on, every request except login and this settings endpoint gets a 503).
    Single row for the whole platform (not per-estate). The tenancy-agreement
    solicitor is assigned per estate instead — see PUT /estates/{id}/lawyer."""
    setting = await find_one(db, Setting)
    data = (setting.data or {}) if setting else {}
    return {"success": True, "data": _settings_payload(data)}


@router.put("")
async def update_platform_settings(
    body: PlatformSettingsBody,
    db: AsyncSession = Depends(get_db), actor: User = Depends(require_super_admin),
):
    setting = await find_one(db, Setting)
    if not setting:
        setting = Setting(id=gen_uuid(), data={})

    data = dict(setting.data or {})
    if body.bank_info is not None:
        data["bank_info"] = {**(data.get("bank_info") or {}), **body.bank_info.model_dump(exclude_none=True)}
    if body.maintenance_mode is not None:
        data["maintenance_mode"] = body.maintenance_mode
    if body.maintenance_message is not None:
        data["maintenance_message"] = body.maintenance_message

    setting.data = data
    await save(db, setting)
    _invalidate_maintenance_cache()

    return {"success": True, "message": "Settings updated", "data": _settings_payload(data)}


@router.post("/maintenance/auto-enable")
async def auto_enable_maintenance(
    db: AsyncSession = Depends(get_db),
    x_maintenance_secret: Optional[str] = Header(default=None, alias="X-Maintenance-Secret"),
):
    """Machine-only: turns maintenance mode ON, never off. Used by the
    scheduled monthly routine — deliberately not the human PUT above, so
    this narrow secret can't do anything else if it ever leaks: it can't
    read data, disable maintenance, or touch any other setting. Requires
    MAINTENANCE_TOGGLE_SECRET to be set; a wrong/missing secret 404s rather
    than 401/403, so the endpoint's existence isn't advertised."""
    if not app_settings.MAINTENANCE_TOGGLE_SECRET or x_maintenance_secret != app_settings.MAINTENANCE_TOGGLE_SECRET:
        raise HTTPException(status_code=404)

    setting = await find_one(db, Setting)
    if not setting:
        setting = Setting(id=gen_uuid(), data={})
    data = dict(setting.data or {})
    data["maintenance_mode"] = True
    setting.data = data
    await save(db, setting)
    _invalidate_maintenance_cache()

    return {"success": True, "message": "Maintenance mode enabled"}
