from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from models.setting import Setting
from core.security import require_super_admin
from core.database import get_db
from core.db_helpers import find_one, save
from models.base import gen_uuid
from models.user import User

router = APIRouter(prefix="/settings", tags=["Settings"])

BANK_DEFAULTS = {"bank_name": "UBA", "account_number": "1234567890", "account_name": "BamiHost Properties Ltd"}
PREPARED_BY_DEFAULTS = {"name": "", "address": "", "phone": "", "email": ""}


class BankInfoBody(BaseModel):
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    account_name: Optional[str] = None


class PreparedByBody(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


class PlatformSettingsBody(BaseModel):
    bank_info: Optional[BankInfoBody] = None
    prepared_by: Optional[PreparedByBody] = None


@router.get("")
async def get_platform_settings(
    db: AsyncSession = Depends(get_db), actor: User = Depends(require_super_admin),
):
    """Platform-wide config: the deposit bank account shown to tenants, and the
    solicitor named on every generated tenancy agreement. Single row for the
    whole platform (not per-estate)."""
    setting = await find_one(db, Setting)
    data = (setting.data or {}) if setting else {}
    return {"success": True, "data": {
        "bankInfo": {**BANK_DEFAULTS, **(data.get("bank_info") or {})},
        "preparedBy": {**PREPARED_BY_DEFAULTS, **(data.get("prepared_by") or {})},
    }}


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
    if body.prepared_by is not None:
        # Prepared-by is sent as a whole block from the form (unlike bank_info,
        # which builds up field-by-field) — a blank field should be allowed to
        # clear a previously-set one, e.g. dropping a lawyer entirely.
        data["prepared_by"] = body.prepared_by.model_dump()

    setting.data = data
    await save(db, setting)

    return {"success": True, "message": "Settings updated", "data": {
        "bankInfo": {**BANK_DEFAULTS, **(data.get("bank_info") or {})},
        "preparedBy": {**PREPARED_BY_DEFAULTS, **(data.get("prepared_by") or {})},
    }}
