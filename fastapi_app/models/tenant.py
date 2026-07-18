from sqlalchemy import String, Boolean, DateTime, JSON, Float, Text, Integer, Index, text
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, Money, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class Tenant(Base):
    __tablename__ = "tenants"
    __table_args__ = (
        # A unit can only have one active tenant at a time — prevents the
        # duplicate-row billing confusion seen with re-onboarded tenants.
        Index(
            "uq_tenants_active_unit", "unit",
            unique=True,
            postgresql_where=text("is_active"),
            sqlite_where=text("is_active"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    estate: Mapped[str] = mapped_column(String(36), index=True)
    unit: Mapped[str] = mapped_column(String(36), index=True)
    unit_label: Mapped[str] = mapped_column(String(255), default="")

    tenant_name: Mapped[str] = mapped_column(String(255))
    tenant_email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    tenant_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    rent_amount: Mapped[float] = mapped_column(Money, default=0.0)
    base_rent: Mapped[float] = mapped_column(Money, default=0.0)
    service_charge_amount: Mapped[float] = mapped_column(Money, default=0.0)
    base_service_charge: Mapped[float] = mapped_column(Money, default=0.0)

    tenant_type: Mapped[str] = mapped_column(String(50), default="new")
    status: Mapped[str] = mapped_column(String(50), default="occupied", index=True)

    electric_meter_number: Mapped[str] = mapped_column(String(100), default="")
    entry_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    next_due_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    lease_end_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    lease_duration_months: Mapped[int | None] = mapped_column(nullable=True)

    # Per-tenant rent-increase anchor. Overrides the estate's start date for
    # this tenant only; when null, the estate default (then entry date) is used.
    # The percent/cycle stay estate-wide — this just fixes WHEN the clock starts.
    rent_increase_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Tenant-controlled: when due, pay rent + service charge from the wallet
    # automatically if the balance covers the full amount.
    auto_pay_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    user: Mapped[str | None] = mapped_column(String(36), nullable=True)
    profile_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    profile_image_public_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    history: Mapped[list] = mapped_column(JSON, default=list)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)

    rent_outstanding: Mapped[float] = mapped_column(Money, default=0.0)
    service_charge_outstanding: Mapped[float] = mapped_column(Money, default=0.0)
    # What period the current outstanding balance relates to, and when the
    # remainder is due — set by the super admin alongside the balance itself
    # (billing cycles here run 6 months, so this tracks a partial payment's gap).
    outstanding_period_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    outstanding_period_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    outstanding_due_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # NPS — Level 1 "Sell & Serve 10": 0–10 recommend score (9–10 = promoter)
    nps_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    nps_asked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    nps_answered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
