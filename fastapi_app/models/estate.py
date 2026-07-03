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

    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    def set_slug(self):
        slug = self.name.lower()
        slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
        self.slug = slug
