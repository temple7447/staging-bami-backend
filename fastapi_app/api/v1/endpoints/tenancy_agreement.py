"""Tenancy Agreement — the standard terms a tenant reads and e-signs from
their dashboard. One template (utils/tenancy_terms.py) personalized per
tenant with their real landlord, estate, unit and rent; a signature is a
frozen snapshot so later edits never rewrite what was actually agreed to.

Registration particulars (ID verification, next-of-kin, witness) are
collected from the tenant at signing time — the landlord's own signature is
deliberately out of scope here, since the landlord isn't at the same device
as the tenant; that's a separate admin-side flow if ever needed."""
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
import cloudinary
import cloudinary.uploader

from models.tenant import Tenant
from models.estate import Estate
from models.unit import Unit
from models.user import User
from models.tenancy_agreement import TenancyAgreement
from models.base import gen_uuid
from core.security import get_current_user
from core.database import get_db
from core.config import settings
from core.db_helpers import find_one, save
from core.authz import require_tenant_access
from utils.tenancy_terms import build_parties, build_terms
from utils.tenant_helpers import estate_config_for
from utils.pdf_service import generate_agreement_pdf
from utils.time_utils import utcnow

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tenants", tags=["Tenancy Agreement"])


async def _context_for(db: AsyncSession, tenant: Tenant):
    estate = await db.get(Estate, tenant.estate) if tenant.estate else None
    unit = await db.get(Unit, tenant.unit) if tenant.unit else None
    owner = await db.get(User, estate.owner) if estate and estate.owner else None
    return estate, unit, owner


def _serialize(a: TenancyAgreement) -> dict:
    return {
        "id": a.id,
        "parties": a.parties,
        "terms": a.terms,
        "registration": a.registration,
        "typedName": a.typed_name,
        "signatureImage": a.signature_image,
        "signedAt": a.signed_at.isoformat() if a.signed_at else None,
    }


@router.get("/me/agreement")
async def get_my_agreement(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    tenant = await find_one(db, Tenant, Tenant.user == user.id, Tenant.is_active == True)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant record not found for this user")

    existing = await find_one(db, TenancyAgreement, TenancyAgreement.tenant_id == tenant.id)
    if existing:
        return {"success": True, "signed": True, "data": _serialize(existing)}

    estate, unit, owner = await _context_for(db, tenant)
    if not estate:
        raise HTTPException(status_code=404, detail="Estate not found for this tenancy")
    estate_config = await estate_config_for(db, estate.id)
    parties = build_parties(tenant, estate, unit, owner, estate_config=estate_config)
    return {"success": True, "signed": False, "data": {
        "parties": parties, "terms": build_terms(parties), "registration": {},
        "typedName": None, "signatureImage": None, "signedAt": None,
    }}


@router.post("/me/agreement/upload-id")
async def upload_my_id_document(
    file: UploadFile = File(...), db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    tenant = await find_one(db, Tenant, Tenant.user == user.id, Tenant.is_active == True)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant record not found for this user")
    if await find_one(db, TenancyAgreement, TenancyAgreement.tenant_id == tenant.id):
        raise HTTPException(status_code=400, detail="This tenancy agreement has already been signed")

    cloudinary.config(
        cloud_name=settings.CLOUDINARY_CLOUD_NAME,
        api_key=settings.CLOUDINARY_API_KEY,
        api_secret=settings.CLOUDINARY_API_SECRET,
    )
    data = await file.read()
    result = cloudinary.uploader.upload(data, folder=f"bamihost/tenancy-ids/{tenant.id}", resource_type="image")
    return {"success": True, "data": {"url": result["secure_url"]}}


class SignAgreementBody(BaseModel):
    typedName: str
    signatureImage: str | None = None

    # Registration particulars
    address: str
    occupation: str
    employer: str | None = None
    idType: str
    idNumber: str
    idDocumentUrl: str
    kinName: str
    kinRelationship: str
    kinPhone: str
    witnessName: str
    witnessAddress: str
    witnessOccupation: str
    witnessPhone: str | None = None
    witnessRelationship: str
    witnessTypedName: str
    witnessSignatureImage: str | None = None


_REQUIRED_FIELDS = [
    "address", "occupation", "idType", "idNumber", "idDocumentUrl",
    "kinName", "kinRelationship", "kinPhone",
    "witnessName", "witnessAddress", "witnessOccupation", "witnessRelationship", "witnessTypedName",
]


@router.post("/me/agreement/sign", status_code=201)
async def sign_my_agreement(
    body: SignAgreementBody,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    tenant = await find_one(db, Tenant, Tenant.user == user.id, Tenant.is_active == True)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant record not found for this user")

    if await find_one(db, TenancyAgreement, TenancyAgreement.tenant_id == tenant.id):
        raise HTTPException(status_code=400, detail="This tenancy agreement has already been signed")

    typed_name = (body.typedName or "").strip()
    if not typed_name:
        raise HTTPException(status_code=400, detail="Type your full name to sign")

    for field in _REQUIRED_FIELDS:
        if not (getattr(body, field) or "").strip():
            raise HTTPException(status_code=400, detail=f"{field} is required")

    estate, unit, owner = await _context_for(db, tenant)
    if not estate:
        raise HTTPException(status_code=404, detail="Estate not found for this tenancy")

    estate_config = await estate_config_for(db, estate.id)
    parties = build_parties(tenant, estate, unit, owner, estate_config=estate_config)
    registration = {
        "address": body.address.strip(),
        "occupation": body.occupation.strip(),
        "employer": (body.employer or "").strip(),
        "idType": body.idType.strip(),
        "idNumber": body.idNumber.strip(),
        "idDocumentUrl": body.idDocumentUrl,
        "kinName": body.kinName.strip(),
        "kinRelationship": body.kinRelationship.strip(),
        "kinPhone": body.kinPhone.strip(),
        "witnessName": body.witnessName.strip(),
        "witnessAddress": body.witnessAddress.strip(),
        "witnessOccupation": body.witnessOccupation.strip(),
        "witnessPhone": (body.witnessPhone or "").strip(),
        "witnessRelationship": body.witnessRelationship.strip(),
        "witnessTypedName": body.witnessTypedName.strip(),
        "witnessSignatureImage": body.witnessSignatureImage,
    }
    agreement = TenancyAgreement(
        id=gen_uuid(), tenant_id=tenant.id, estate_id=estate.id, owner_id=estate.owner or "",
        parties=parties, terms=build_terms(parties), registration=registration,
        typed_name=typed_name, signature_image=body.signatureImage,
        signed_at=utcnow(),
    )
    await save(db, agreement)

    history = tenant.history or []
    history.append({"event": "note", "note": "Tenancy agreement signed",
                    "meta": {"typedName": typed_name}, "created_by": user.id,
                    "created_at": utcnow().isoformat()})
    tenant.history = history
    await save(db, tenant)

    return {"success": True, "data": _serialize(agreement)}


@router.get("/me/agreement/pdf")
async def download_my_agreement(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    tenant = await find_one(db, Tenant, Tenant.user == user.id, Tenant.is_active == True)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant record not found for this user")
    agreement = await find_one(db, TenancyAgreement, TenancyAgreement.tenant_id == tenant.id)
    if not agreement:
        raise HTTPException(status_code=404, detail="You haven't signed a tenancy agreement yet")
    pdf_bytes = generate_agreement_pdf(agreement.parties, agreement.terms, agreement.typed_name,
                                       agreement.signature_image, agreement.signed_at,
                                       registration=agreement.registration)
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename=tenancy-agreement-{tenant.id}.pdf"})


@router.get("/{tenant_id}/agreement")
async def get_tenant_agreement(
    tenant_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    """Admin/manager view of a tenant's agreement status — read-only."""
    tenant = await find_one(db, Tenant, Tenant.id == tenant_id, Tenant.is_active == True)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    await require_tenant_access(db, user, tenant, write=False)

    existing = await find_one(db, TenancyAgreement, TenancyAgreement.tenant_id == tenant.id)
    if not existing:
        return {"success": True, "signed": False, "data": None}
    return {"success": True, "signed": True, "data": _serialize(existing)}


@router.get("/{tenant_id}/agreement/pdf")
async def download_tenant_agreement(
    tenant_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    """Admin/manager download of a tenant's signed agreement PDF — read-only."""
    tenant = await find_one(db, Tenant, Tenant.id == tenant_id, Tenant.is_active == True)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    await require_tenant_access(db, user, tenant, write=False)

    agreement = await find_one(db, TenancyAgreement, TenancyAgreement.tenant_id == tenant.id)
    if not agreement:
        raise HTTPException(status_code=404, detail="This tenant hasn't signed a tenancy agreement yet")
    pdf_bytes = generate_agreement_pdf(agreement.parties, agreement.terms, agreement.typed_name,
                                       agreement.signature_image, agreement.signed_at,
                                       registration=agreement.registration)
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename=tenancy-agreement-{tenant.id}.pdf"})
