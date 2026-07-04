import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from pydantic import BaseModel
from typing import Optional

from models.user import User
from models.integration import BusinessIntegration, IntegrationSnapshot
from core.security import get_current_user
from core.database import get_db
from models.base import gen_uuid
from utils.time_utils import utcnow
from utils.crypto import encrypt_secret, decrypt_secret

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/integrations", tags=["Integrations Hub"])


def _integ_dict(i: BusinessIntegration) -> dict:
    # auth_value is write-only — never echoed back once stored.
    return {
        "id": i.id, "name": i.name, "kind": i.kind, "base_url": i.base_url,
        "auth_header": i.auth_header, "has_auth_value": bool(i.auth_value_encrypted),
        "enabled": i.enabled, "last_synced_at": i.last_synced_at.isoformat() if i.last_synced_at else None,
        "last_status": i.last_status,
    }


class IntegrationCreate(BaseModel):
    name: str
    kind: str = "custom"
    base_url: str
    auth_header: str = "Authorization"
    auth_value: Optional[str] = None


class IntegrationUpdate(BaseModel):
    name: Optional[str] = None
    kind: Optional[str] = None
    base_url: Optional[str] = None
    auth_header: Optional[str] = None
    auth_value: Optional[str] = None
    enabled: Optional[bool] = None


@router.get("")
async def list_integrations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (await db.execute(
        select(BusinessIntegration).where(BusinessIntegration.owner_id == str(current_user.id))
        .order_by(BusinessIntegration.created_at.desc())
    )).scalars().all()
    return {"data": [_integ_dict(i) for i in rows]}


@router.post("", status_code=201)
async def create_integration(
    body: IntegrationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    integ = BusinessIntegration(
        id=gen_uuid(), owner_id=str(current_user.id),
        name=body.name, kind=body.kind, base_url=body.base_url, auth_header=body.auth_header,
        auth_value_encrypted=encrypt_secret(body.auth_value) if body.auth_value else None,
    )
    db.add(integ)
    await db.commit()
    return {"id": integ.id}


@router.put("/{integration_id}")
async def update_integration(
    integration_id: str,
    body: IntegrationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    integ = (await db.execute(
        select(BusinessIntegration).where(
            BusinessIntegration.id == integration_id, BusinessIntegration.owner_id == str(current_user.id)
        )
    )).scalar_one_or_none()
    if not integ:
        raise HTTPException(404, "Integration not found")
    patch = body.model_dump(exclude_unset=True)
    auth_value = patch.pop("auth_value", None)
    for k, v in patch.items():
        setattr(integ, k, v)
    if auth_value is not None:
        integ.auth_value_encrypted = encrypt_secret(auth_value)
    integ.updated_at = utcnow()
    await db.commit()
    return {"message": "Integration updated"}


@router.delete("/{integration_id}")
async def delete_integration(
    integration_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    integ = (await db.execute(
        select(BusinessIntegration).where(
            BusinessIntegration.id == integration_id, BusinessIntegration.owner_id == str(current_user.id)
        )
    )).scalar_one_or_none()
    if not integ:
        raise HTTPException(404, "Integration not found")
    await db.delete(integ)
    await db.commit()
    return {"message": "Integration deleted"}


@router.post("/{integration_id}/sync")
async def sync_integration(
    integration_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    integ = (await db.execute(
        select(BusinessIntegration).where(
            BusinessIntegration.id == integration_id, BusinessIntegration.owner_id == str(current_user.id)
        )
    )).scalar_one_or_none()
    if not integ:
        raise HTTPException(404, "Integration not found")

    headers = {"Accept": "application/json"}
    if integ.auth_value_encrypted:
        headers[integ.auth_header or "Authorization"] = decrypt_secret(integ.auth_value_encrypted)

    status_code = None
    payload: dict = {}
    error = None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(integ.base_url, headers=headers)
        status_code = resp.status_code
        try:
            payload = resp.json()
        except Exception:
            payload = {"raw": resp.text[:10_000]}
        if resp.status_code >= 400:
            error = f"HTTP {resp.status_code}"
    except Exception as e:
        error = str(e)[:500]

    snapshot = IntegrationSnapshot(
        id=gen_uuid(), integration_id=integ.id, status=status_code, payload=payload, error=error,
    )
    db.add(snapshot)
    integ.last_synced_at = utcnow()
    integ.last_status = error or (f"OK {status_code}" if status_code else "OK")
    await db.commit()

    return {"ok": error is None, "status": status_code, "error": error, "payload": payload}


@router.get("/{integration_id}/snapshots")
async def list_snapshots(
    integration_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    owns = (await db.execute(
        select(BusinessIntegration.id).where(
            BusinessIntegration.id == integration_id, BusinessIntegration.owner_id == str(current_user.id)
        )
    )).scalar_one_or_none()
    if not owns:
        raise HTTPException(404, "Integration not found")
    rows = (await db.execute(
        select(IntegrationSnapshot).where(IntegrationSnapshot.integration_id == integration_id)
        .order_by(desc(IntegrationSnapshot.fetched_at)).limit(20)
    )).scalars().all()
    return {"data": [
        {"id": s.id, "fetched_at": s.fetched_at.isoformat(), "status": s.status, "payload": s.payload, "error": s.error}
        for s in rows
    ]}
