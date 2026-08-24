import re
from sqlalchemy import String, Boolean, DateTime, JSON, Integer, Text, Float
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class Estate(Base):
    __tablename__ = "estates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    total_units: Mapped[int] = mapped_column(Integer, default=0)
    owner: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    managers: Mapped[list] = mapped_column(JSON, default=list)
    # Per-property team: [{"user_id": str, "email": str, "role": "admin"|"manager"|"viewer"}].
    # The owner above is the implicit property admin; members grant additional
    # emails a role scoped to THIS estate only. See core/authz.py for enforcement.
    members: Mapped[list] = mapped_column(JSON, default=list)
    images: Mapped[list] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Rent-increase policy (per estate). percent=26 & cycle_years=2 => +26% every 2 years.
    # Increases are OPT-IN: cycle_years defaults to 0 (NO increase) so a new estate never
    # silently escalates rent — the owner sets a cycle to turn it on. percent=26 is just a
    # suggested value used once a cycle is chosen. start = the date increases are counted
    # from; when null, each tenant's own entry date is used as the anchor.
    rent_increase_percent: Mapped[float] = mapped_column(Float, default=26.0, server_default="26.0")
    rent_increase_cycle_years: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    rent_increase_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # This estate's own tenancy-agreement terms, overriding the platform default
    # (utils/tenancy_terms.TERMS_TEMPLATE) for every tenant who signs here from
    # now on. Null/empty means "use the platform default" — never retroactively
    # applied to an agreement someone already signed (that's a frozen snapshot).
    tenancy_terms: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # This estate's assigned solicitor — a User with role="vendor" (a legal
    # services vendor). Different estates may point at different lawyers, or
    # share the same one. Null means no solicitor assigned yet; the agreement
    # PDF's "Prepared By" section is simply omitted until one is.
    lawyer_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)

    # Letterhead branding for receipts/statements — distinct from `name`
    # (the internal estate label, e.g. "Balado Estate") because the managing
    # company's registered name/phone/logo may differ. Null falls back to
    # `name` / the owner's phone / an initials badge, so nothing breaks for
    # an estate that hasn't set these. company_name may contain a newline —
    # the first line renders as the bold company name, the rest as a
    # smaller subtitle (e.g. "SAMFRED\nGLOBAL RESOURCES LTD").
    company_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    company_phone: Mapped[str | None] = mapped_column(String(100), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    def set_slug(self):
        slug = self.name.lower()
        slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
        self.slug = slug
