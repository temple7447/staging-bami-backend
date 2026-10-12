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

# Electricity is priced per 0.01 kWh — the smallest step a prepaid meter takes.
DEFAULT_ELECTRICITY_UNIT_PRICE = 0.70     # ₦ per 0.01 kWh  (= ₦70 per kWh)


def _unit_price(data: dict) -> float:
    price = data.get("electricity_unit_price")
    return float(price) if isinstance(price, (int, float)) and price > 0 else DEFAULT_ELECTRICITY_UNIT_PRICE


async def electricity_rate_per_kwh(db: AsyncSession) -> float:
    """The platform electricity price as ₦ per kWh (what MeterDevice.rate_per_kwh stores)."""
    setting = await find_one(db, Setting)
    return round(_unit_price((setting.data or {}) if setting else {}) * 100, 4)


class BankInfoBody(BaseModel):
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    account_name: Optional[str] = None


class PlatformSettingsBody(BaseModel):
    bank_info: Optional[BankInfoBody] = None
    maintenance_mode: Optional[bool] = None
    maintenance_message: Optional[str] = None
    electricity_unit_price: Optional[float] = None    # ₦ per 0.01 kWh


def _settings_payload(data: dict) -> dict:
    return {
        "bankInfo": {**BANK_DEFAULTS, **(data.get("bank_info") or {})},
        "maintenanceMode": bool(data.get("maintenance_mode") or False),
        "maintenanceMessage": data.get("maintenance_message") or DEFAULT_MAINTENANCE_MESSAGE,
        "electricityUnitPrice": _unit_price(data),
        "electricityRatePerKwh": round(_unit_price(data) * 100, 4),
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
    repriced = 0
    if body.electricity_unit_price is not None:
        if not (0 < body.electricity_unit_price <= 1000):
            raise HTTPException(status_code=400, detail="Electricity price must be between ₦0 and ₦1,000 per 0.01 kWh")
        data["electricity_unit_price"] = round(body.electricity_unit_price, 4)
        repriced = await _reprice_meters(db, data["electricity_unit_price"] * 100)

    setting.data = data
    await save(db, setting)
    _invalidate_maintenance_cache()

    return {"success": True, "message": "Settings updated",
            "data": {**_settings_payload(data), "metersRepriced": repriced}}


async def _reprice_meters(db: AsyncSession, rate_per_kwh: float) -> int:
    """Apply the new price to every active meter. The prepaid credit lives on the
    meter in kWh, so only its naira mirror is recalculated — nobody's kWh change."""
    from models.meter_device import MeterDevice
    from core.db_helpers import find_all
    meters = await find_all(db, MeterDevice, MeterDevice.is_active == True, limit=100000)
    for m in meters:
        kwh_left = (m.credit_balance / m.rate_per_kwh) if m.rate_per_kwh else 0.0
        m.rate_per_kwh = rate_per_kwh
        m.credit_balance = round(kwh_left * rate_per_kwh, 2)
    await db.commit()
    return len(meters)


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
