"""POST /api/admin/delete-otp/request — first step of confirming a
business-critical delete. Verifies the caller has the same permission the
real delete would require, then sends a one-time code to the owner's
phone+email (utils/delete_otp.py) that must be replayed back to the delete
endpoint itself (as otpId + otpCode) to actually complete it."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from core.database import get_db
from core.security import get_current_user
from core.db_helpers import find_one
from core.authz import require_estate_access
from models.user import User
from models.estate import Estate
from utils.delete_otp import request_delete_otp

router = APIRouter(prefix="/admin/delete-otp", tags=["Delete Confirmation"])

RESOURCE_TYPES = {"estate", "unit", "tenant", "business_owner", "manager", "vendor"}


async def _authorize_and_label(db: AsyncSession, user: User, resource_type: str, resource_id: str) -> str:
    """Mirrors the permission check of the real delete endpoint for this
    resource type and resolves a human label for the OTP message. The real
    delete endpoint re-checks permission itself when the code is redeemed —
    this only gatekeeps who may even request a code."""
    if resource_type == "estate":
        from api.v1.endpoints.estates import _check_estate_access
        estate = await find_one(db, Estate, Estate.id == resource_id, Estate.is_active == True)
        if not estate:
            raise HTTPException(status_code=404, detail="Estate not found")
        _check_estate_access(estate, user)
        return estate.name

    if resource_type == "unit":
        from api.v1.endpoints.units import _get_unit_scoped
        unit = await _get_unit_scoped(db, resource_id, user)
        await require_estate_access(db, user, unit.estate, "manager")
        return unit.label

    if resource_type == "tenant":
        from api.v1.endpoints.tenants import _get_tenant_or_404
        tenant = await _get_tenant_or_404(db, resource_id, user, write=True)
        return tenant.tenant_name or tenant.unit_label or resource_id

    if resource_type in ("business_owner", "manager", "vendor"):
        if user.role != "super_admin":
            raise HTTPException(status_code=403, detail=f"Role '{user.role}' is not authorized")
        from api.v1.endpoints.auth import (
            _get_business_owner_or_404, _get_manager_or_404, _get_vendor_or_404,
        )
        getter = {
            "business_owner": _get_business_owner_or_404,
            "manager": _get_manager_or_404,
            "vendor": _get_vendor_or_404,
        }[resource_type]
        record = await getter(db, resource_id)
        return record.name or record.email

    raise HTTPException(status_code=400, detail="Unknown resource type")


class DeleteOtpRequestBody(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    resource_type: str
    resource_id: str


@router.post("/request")
async def create_delete_otp_request(
    body: DeleteOtpRequestBody,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if body.resource_type not in RESOURCE_TYPES:
        raise HTTPException(status_code=400, detail="Unknown resource type")
    label = await _authorize_and_label(db, user, body.resource_type, body.resource_id)
    result = await request_delete_otp(db, user, body.resource_type, body.resource_id, label)
    return {"success": True, "data": result}
