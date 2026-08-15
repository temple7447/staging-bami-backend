from sqlalchemy import String, Text, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class TenancyAgreement(Base):
    """A tenant's signed acknowledgement of the tenancy terms.

    Frozen snapshots (parties + terms) are stored at signing time so a later
    template edit, rent change, or estate-detail update never rewrites what
    someone actually agreed to. One row = one signature; a tenant can only
    sign once (re-signing is a deliberate follow-up, not assumed)."""
    __tablename__ = "tenancy_agreements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    tenant_id: Mapped[str] = mapped_column(String(36), index=True, unique=True)
    estate_id: Mapped[str] = mapped_column(String(36), index=True)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)

    parties: Mapped[dict] = mapped_column(JSON, default=dict)   # landlord/tenant/premises/rent, frozen
    terms: Mapped[list] = mapped_column(JSON, default=list)     # clause text, frozen

    # Registration particulars the tenant supplies when signing: residential
    # address, occupation, ID verification, next-of-kin, and their witness.
    # One JSON blob rather than a dozen columns — nothing here is queried on
    # its own, it's read back as a unit for the signed record/PDF.
    registration: Mapped[dict] = mapped_column(JSON, default=dict)

    typed_name: Mapped[str] = mapped_column(String(255))
    signature_image: Mapped[str | None] = mapped_column(Text, nullable=True)  # base64 PNG data URI

    # Admin review: pending until an admin/manager acts on it. A rejection is
    # not final — the tenant may fix and resubmit, which updates this same
    # row in place (see sign_my_agreement) and resets status to "pending".
    status: Mapped[str] = mapped_column(String(20), default="pending")
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Counsel's own countersignature — independent of the admin review above,
    # captured via the lawyer's own login (POST /tenancy-agreements/{id}/lawyer-sign).
    # Only settable once the tenant has already signed (this row only exists then).
    lawyer_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    lawyer_typed_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lawyer_signature_image: Mapped[str | None] = mapped_column(Text, nullable=True)
    lawyer_signed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    signed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
