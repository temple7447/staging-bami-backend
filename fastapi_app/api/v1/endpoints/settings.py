from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from models.setting import Setting
from models.user import User
from core.security import require_super_admin, hash_password
from core.database import get_db
from core.db_helpers import find_one, save
from models.base import gen_uuid
from utils.tenant_helpers import generate_temp_password
from utils.email_service import send_welcome_email
from utils.time_utils import utcnow

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

    provisioned_password = None
    provisioned_email = None
    if body.prepared_by is not None:
        # Prepared-by is sent as a whole block from the form (unlike bank_info,
        # which builds up field-by-field) — a blank field should be allowed to
        # clear a previously-set one, e.g. dropping a lawyer entirely.
        data["prepared_by"] = body.prepared_by.model_dump()

        name = (body.prepared_by.name or "").strip()
        email = (body.prepared_by.email or "").strip()
        lawyer_user_id = data.get("prepared_by_user_id")

        if name and email:
            existing = await find_one(db, User, User.email == email)
            if existing and existing.role != "lawyer":
                raise HTTPException(status_code=400, detail=f"{email} is already used by a {existing.role} account — use a different email for the solicitor's login")

            if existing:
                # Same lawyer, details edited — keep their password as-is,
                # no re-send. Re-activates them if they'd been removed before.
                existing.name = name
                existing.is_active = True
                await save(db, existing)
                lawyer_user_id = existing.id
            else:
                provisioned_password = generate_temp_password(8)
                lawyer = User(
                    id=gen_uuid(), name=name, email=email,
                    password=hash_password(provisioned_password), role="lawyer",
                    created_by=actor.id, email_verified=True,
                )
                await save(db, lawyer)
                lawyer_user_id = lawyer.id
                provisioned_email = email
        elif lawyer_user_id:
            # Blanked out — deactivate the login rather than deleting it, so
            # signatures they already made on real agreements stay attributable.
            prior = await db.get(User, lawyer_user_id)
            if prior:
                prior.is_active = False
                await save(db, prior)

        data["prepared_by_user_id"] = lawyer_user_id

    setting.data = data
    await save(db, setting)

    if provisioned_password and provisioned_email:
        await send_welcome_email(provisioned_email, body.prepared_by.name, provisioned_password)

    return {"success": True, "message": "Settings updated", "data": {
        "bankInfo": {**BANK_DEFAULTS, **(data.get("bank_info") or {})},
        "preparedBy": {**PREPARED_BY_DEFAULTS, **(data.get("prepared_by") or {})},
    }}
