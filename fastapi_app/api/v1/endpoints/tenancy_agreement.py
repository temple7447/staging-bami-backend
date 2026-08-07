"""Tenancy Agreement — the standard terms a tenant reads and e-signs from
their dashboard. One template (utils/tenancy_terms.py) personalized per
tenant with their real landlord, estate, unit and rent; a signature is a
frozen snapshot so later edits never rewrite what was actually agreed to.

Registration particulars (ID verification, next-of-kin, witness) are
collected from the tenant at signing time — the landlord's own signature is
deliberately out of scope here, since the landlord isn't at the same device
as the tenant; that's a separate admin-side flow if ever needed."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
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
from core.db_helpers import find_one, find_all, save
from core.authz import require_tenant_access, accessible_estate_ids
from utils.tenancy_terms import build_parties, build_terms
from utils.tenant_helpers import estate_config_for
from utils.pdf_service import generate_agreement_pdf
from utils.time_utils import utcnow

logger = logging.getLogger(__name__)

ADMIN_ROLES = {"super_admin", "admin", "super_manager", "business_owner", "manager"}
router = APIRouter(prefix="/tenants", tags=["Tenancy Agreement"])

# A separate, top-level router (not nested under /tenants) so the admin list
# endpoint below can never collide with tenants.py's `GET /tenants/{tenant_id}`
# — that route is registered first and would otherwise swallow any single
# path segment directly under /tenants (e.g. /tenants/agreements) as a
# tenant_id lookup. Same convention as /bank-deposits, /service-requests, etc.
list_router = APIRouter(prefix="/tenancy-agreements", tags=["Tenancy Agreement"])


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
        "status": a.status,
        "rejectionReason": a.rejection_reason,
        "reviewedBy": a.reviewed_by,
        "reviewedAt": a.reviewed_at.isoformat() if a.reviewed_at else None,
        "lawyerTypedName": a.lawyer_typed_name,
        "lawyerSignatureImage": a.lawyer_signature_image,
    }


@router.get("/me/agreement")
async def get_my_agreement(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    tenant = await find_one(db, Tenant, Tenant.user == user.id, Tenant.is_active == True)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant record not found for this user")

    existing = await find_one(db, TenancyAgreement, TenancyAgreement.tenant_id == tenant.id)
    if existing:
        # A rejection isn't final — report signed=False so the tenant's own
        # dashboard re-opens the editable form (prefilled from this same
        # record) instead of locking them out with no way to fix it.
        return {"success": True, "signed": existing.status != "rejected",
                "status": existing.status, "data": _serialize(existing)}

    estate, unit, owner = await _context_for(db, tenant)
    if not estate:
        raise HTTPException(status_code=404, detail="Estate not found for this tenancy")
    estate_config = await estate_config_for(db, estate.id)
    parties = build_parties(tenant, estate, unit, owner, estate_config=estate_config)
    return {"success": True, "signed": False, "status": None, "data": {
        "parties": parties, "terms": build_terms(parties, estate.tenancy_terms), "registration": {},
        "typedName": None, "signatureImage": None, "signedAt": None,
    }}


@router.post("/me/agreement/upload-id")
async def upload_my_id_document(
    file: UploadFile = File(...), db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    tenant = await find_one(db, Tenant, Tenant.user == user.id, Tenant.is_active == True)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant record not found for this user")
    existing = await find_one(db, TenancyAgreement, TenancyAgreement.tenant_id == tenant.id)
    if existing and existing.status != "rejected":
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

    existing = await find_one(db, TenancyAgreement, TenancyAgreement.tenant_id == tenant.id)
    if existing and existing.status != "rejected":
        raise HTTPException(status_code=400, detail="This tenancy agreement has already been signed")

    typed_name = (body.typedName or "").strip()
    if not typed_name:
        raise HTTPException(status_code=400, detail="Type your full name to sign")
    if not (body.signatureImage or "").strip():
        raise HTTPException(status_code=400, detail="Your signature is required")
    if not (body.witnessSignatureImage or "").strip():
        raise HTTPException(status_code=400, detail="Your witness's signature is required")

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
    if existing:
        # Resubmitting after a rejection: update the same row in place (the
        # unique tenant_id constraint means there's never more than one row
        # per tenant) and put it back in the review queue.
        existing.parties = parties
        existing.terms = build_terms(parties, estate.tenancy_terms)
        existing.registration = registration
        existing.typed_name = typed_name
        existing.signature_image = body.signatureImage
        existing.signed_at = utcnow()
        existing.status = "pending"
        existing.rejection_reason = None
        existing.reviewed_by = None
        existing.reviewed_at = None
        agreement = existing
    else:
        agreement = TenancyAgreement(
            id=gen_uuid(), tenant_id=tenant.id, estate_id=estate.id, owner_id=estate.owner or "",
            parties=parties, terms=build_terms(parties, estate.tenancy_terms), registration=registration,
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
    if agreement.status != "approved":
        raise HTTPException(status_code=403, detail="Your copy will be available once the estate office approves your registration")
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


@list_router.get("")
async def list_agreements(
    estate_id: Optional[str] = Query(None, alias="estateId"),
    status_filter: Optional[str] = Query(None, alias="status"),
    search: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin/manager: every tenant's SIGNED tenancy agreement, newest first,
    scoped to the caller's accessible estates. Unsigned tenants have no
    TenancyAgreement row at all (nothing is persisted until signing), so
    this is inherently a list of submissions, not a list of tenants."""
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    allowed = await accessible_estate_ids(db, user)
    conditions = []
    if allowed is not None:
        if not allowed:
            return {"success": True, "data": [],
                    "pagination": {"currentPage": page, "totalPages": 0, "totalItems": 0}}
        conditions.append(TenancyAgreement.estate_id.in_(allowed))
    if estate_id:
        conditions.append(TenancyAgreement.estate_id == estate_id)
    if status_filter:
        conditions.append(TenancyAgreement.status == status_filter)

    agreements = await find_all(db, TenancyAgreement, *conditions,
                                order_by=TenancyAgreement.signed_at.desc())

    items = []
    for a in agreements:
        p = a.parties or {}
        items.append({
            "id": a.id,
            "tenant_id": a.tenant_id,
            "estate_id": a.estate_id,
            "tenant_name": p.get("tenant_name"),
            "tenant_email": p.get("tenant_email"),
            "tenant_phone": p.get("tenant_phone"),
            "estate_name": p.get("estate_name"),
            "unit_label": p.get("unit_label"),
            "typed_name": a.typed_name,
            "signed_at": a.signed_at,
            "status": a.status,
            "rejection_reason": a.rejection_reason,
            "reviewed_by": a.reviewed_by,
            "reviewed_at": a.reviewed_at,
        })

    # tenant/estate names live inside the frozen `parties` JSON snapshot, not
    # a queryable column, so search filters in Python rather than SQL — fine
    # at the scale of "signed agreements for one operator's estates".
    if search:
        s = search.strip().lower()
        items = [
            i for i in items
            if s in (i["tenant_name"] or "").lower()
            or s in (i["estate_name"] or "").lower()
            or s in (i["unit_label"] or "").lower()
            or s in (i["tenant_email"] or "").lower()
        ]

    total = len(items)
    skip = (page - 1) * limit
    page_items = items[skip: skip + limit]

    return {"success": True, "data": page_items,
            "pagination": {"currentPage": page,
                            "totalPages": -(-total // limit) if total else 0,
                            "totalItems": total}}


class ReviewAgreementBody(BaseModel):
    status: str  # "approved" | "rejected"
    reason: Optional[str] = None
    lawyerTypedName: Optional[str] = None
    lawyerSignatureImage: Optional[str] = None


@list_router.patch("/{agreement_id}/status")
async def review_agreement(
    agreement_id: str,
    body: ReviewAgreementBody,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Admin/manager approves or rejects a submitted agreement. Rejecting is
    not a dead end — the tenant's own /me/agreement/sign re-opens on their
    dashboard and resubmission updates this same row (see sign_my_agreement)."""
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    new_status = (body.status or "").strip().lower()
    if new_status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="status must be 'approved' or 'rejected'")

    reason = (body.reason or "").strip()
    if new_status == "rejected" and not reason:
        raise HTTPException(status_code=400, detail="A reason is required to reject an agreement")

    lawyer_name = (body.lawyerTypedName or "").strip()
    if new_status == "approved" and not lawyer_name:
        raise HTTPException(status_code=400, detail="A signature is required to approve an agreement")

    agreement = await find_one(db, TenancyAgreement, TenancyAgreement.id == agreement_id)
    if not agreement:
        raise HTTPException(status_code=404, detail="Agreement not found")

    allowed = await accessible_estate_ids(db, user)
    if allowed is not None and agreement.estate_id not in allowed:
        raise HTTPException(status_code=403, detail="Not your estate")

    agreement.status = new_status
    agreement.rejection_reason = reason if new_status == "rejected" else None
    agreement.reviewed_by = user.id
    agreement.reviewed_at = utcnow()
    if new_status == "approved":
        agreement.lawyer_typed_name = lawyer_name
        agreement.lawyer_signature_image = body.lawyerSignatureImage
    await save(db, agreement)

    return {"success": True, "data": _serialize(agreement)}
