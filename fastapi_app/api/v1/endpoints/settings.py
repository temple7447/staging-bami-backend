from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional

from models.setting import Setting
from models.user import User
from models.tenancy_agreement import TenancyAgreement
from core.security import require_super_admin, hash_password
from core.database import get_db
from core.db_helpers import find_one, find_all, save
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


async def _sync_prepared_by_to_unsigned_agreements(db: AsyncSession, prepared_by: dict):
    """Keep every agreement's printed "Prepared By" block current with whoever
    the active solicitor is — but only for agreements counsel hasn't actually
    countersigned yet. The moment a lawyer signs one, it's locked: a later
    solicitor swap must never rewrite what a specific lawyer put their name
    and signature to."""
    agreements = await find_all(db, TenancyAgreement, TenancyAgreement.lawyer_signed_at.is_(None))
    for a in agreements:
        parties = dict(a.parties or {})
        parties["prepared_by_name"] = prepared_by.get("name", "")
        parties["prepared_by_address"] = prepared_by.get("address", "")
        parties["prepared_by_phone"] = prepared_by.get("phone", "")
        parties["prepared_by_email"] = prepared_by.get("email", "")
        a.parties = parties
        await save(db, a)


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
        prior_lawyer_user_id = data.get("prepared_by_user_id")
        lawyer_user_id = prior_lawyer_user_id

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

            # Swapped to a different solicitor — the previous one loses access.
            # (Without this, replacing a lawyer left their old login active,
            # since only the new one was ever touched.)
            if prior_lawyer_user_id and prior_lawyer_user_id != lawyer_user_id:
                prior = await db.get(User, prior_lawyer_user_id)
                if prior:
                    prior.is_active = False
                    await save(db, prior)
        elif prior_lawyer_user_id:
            # Blanked out — deactivate the login rather than deleting it, so
            # signatures they already made on real agreements stay attributable.
            prior = await db.get(User, prior_lawyer_user_id)
            if prior:
                prior.is_active = False
                await save(db, prior)
            lawyer_user_id = None

        data["prepared_by_user_id"] = lawyer_user_id

    setting.data = data
    await save(db, setting)

    if body.prepared_by is not None:
        current_prepared_by = {**PREPARED_BY_DEFAULTS, **(data.get("prepared_by") or {})}
        await _sync_prepared_by_to_unsigned_agreements(db, current_prepared_by)

    if provisioned_password and provisioned_email:
        await send_welcome_email(provisioned_email, body.prepared_by.name, provisioned_password)

    return {"success": True, "message": "Settings updated", "data": {
        "bankInfo": {**BANK_DEFAULTS, **(data.get("bank_info") or {})},
        "preparedBy": {**PREPARED_BY_DEFAULTS, **(data.get("prepared_by") or {})},
    }}
