from sqlalchemy import String, Boolean, DateTime, JSON, Float, Text
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    estate: Mapped[str] = mapped_column(String(36), index=True)
    unit: Mapped[str] = mapped_column(String(36), index=True)
    unit_label: Mapped[str] = mapped_column(String(255), default="")

    tenant_name: Mapped[str] = mapped_column(String(255))
    tenant_email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    tenant_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    rent_amount: Mapped[float] = mapped_column(Float, default=0.0)
    base_rent: Mapped[float] = mapped_column(Float, default=0.0)
    service_charge_amount: Mapped[float] = mapped_column(Float, default=0.0)
    base_service_charge: Mapped[float] = mapped_column(Float, default=0.0)

    tenant_type: Mapped[str] = mapped_column(String(50), default="new")
    status: Mapped[str] = mapped_column(String(50), default="occupied", index=True)

    electric_meter_number: Mapped[str] = mapped_column(String(100), default="")
    entry_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    next_due_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)

    user: Mapped[str | None] = mapped_column(String(36), nullable=True)
    telegram_id: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    profile_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    profile_image_public_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    history: Mapped[list] = mapped_column(JSON, default=list)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)

    rent_outstanding: Mapped[float] = mapped_column(Float, default=0.0)
    service_charge_outstanding: Mapped[float] = mapped_column(Float, default=0.0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
