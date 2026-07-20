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

    signed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
