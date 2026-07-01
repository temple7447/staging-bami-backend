import re
from sqlalchemy import String, Boolean, DateTime, JSON, Integer, Text, Float
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime


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
    # cycle_years = 0 (or None) means NO increase. start = the date increases are counted
    # from; when null, each tenant's own entry date is used as the anchor.
    rent_increase_percent: Mapped[float] = mapped_column(Float, default=26.0)
    rent_increase_cycle_years: Mapped[int] = mapped_column(Integer, default=2)
    rent_increase_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def set_slug(self):
        slug = self.name.lower()
        slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
        self.slug = slug
