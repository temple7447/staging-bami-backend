from sqlalchemy import String, Text, Float, DateTime, JSON, Integer
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime


class Vendor(Base):
    __tablename__ = "vendors"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)

    name: Mapped[str] = mapped_column(String(255))
    contact_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Category: plumber, electrician, cleaner, security, landscaper, supplier, contractor, it, other
    category: Mapped[str] = mapped_column(String(100), default="other")

    # Status: active, inactive, blacklisted
    status: Mapped[str] = mapped_column(String(50), default="active")

    # Performance
    rating: Mapped[float] = mapped_column(Float, default=0.0)
    jobs_completed: Mapped[int] = mapped_column(Integer, default=0)
    total_paid: Mapped[float] = mapped_column(Float, default=0.0)

    # Service detail
    services: Mapped[list] = mapped_column(JSON, default=list)   # list of service strings
    estate_ids: Mapped[list] = mapped_column(JSON, default=list)  # which estates they serve

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
