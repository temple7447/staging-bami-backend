from sqlalchemy import String, Boolean, DateTime, Float, Integer
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime


class MeterReading(Base):
    """Time-series snapshot of a meter's readings (stored every sync cycle)."""
    __tablename__ = "meter_readings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)

    meter_device: Mapped[str] = mapped_column(String(36), index=True)
    unit: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    estate: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    tenant: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)

    # Core readings
    kwh: Mapped[float] = mapped_column(Float, default=0.0)         # cumulative kWh
    voltage: Mapped[float] = mapped_column(Float, default=0.0)     # V
    current: Mapped[float] = mapped_column(Float, default=0.0)     # A
    power: Mapped[float] = mapped_column(Float, default=0.0)       # W
    power_factor: Mapped[float] = mapped_column(Float, default=0.0)

    # Billing snapshot
    credit_balance: Mapped[float] = mapped_column(Float, default=0.0)  # ₦ at time of reading
    rate_per_kwh: Mapped[float] = mapped_column(Float, default=70.0)

    # Period (for monthly grouping)
    period_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    period_year: Mapped[int | None] = mapped_column(Integer, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
