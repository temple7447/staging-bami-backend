from sqlalchemy import String, Boolean, DateTime, Float, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class MeterDevice(Base):
    """Links a Tuya device to a unit/tenant with billing config."""
    __tablename__ = "meter_devices"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)

    # Tuya identifiers
    device_id: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    device_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Links
    unit: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    estate: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    tenant: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)

    # Meter number shown on physical device
    meter_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Billing config
    rate_per_kwh: Mapped[float] = mapped_column(Float, default=70.0)   # ₦/kWh
    prepaid_mode: Mapped[bool] = mapped_column(Boolean, default=True)
    credit_balance: Mapped[float] = mapped_column(Float, default=0.0)  # ₦ remaining
    low_balance_threshold: Mapped[float] = mapped_column(Float, default=500.0)  # ₦

    # Baseline kWh reading at start (for monthly delta)
    baseline_kwh: Mapped[float] = mapped_column(Float, default=0.0)
    baseline_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Latest snapshot (updated by sync job)
    last_kwh: Mapped[float] = mapped_column(Float, default=0.0)
    last_voltage: Mapped[float] = mapped_column(Float, default=0.0)
    last_current: Mapped[float] = mapped_column(Float, default=0.0)
    last_power: Mapped[float] = mapped_column(Float, default=0.0)
    last_power_factor: Mapped[float] = mapped_column(Float, default=0.0)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Status
    is_online: Mapped[bool] = mapped_column(Boolean, default=False)
    is_connected: Mapped[bool] = mapped_column(Boolean, default=True)   # relay state
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Extra DP values (raw Tuya response stored as JSON)
    raw_status: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
