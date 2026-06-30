from sqlalchemy import String, Boolean, DateTime, JSON, Float, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime


class Unit(Base):
    __tablename__ = "units"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    estate: Mapped[str] = mapped_column(String(36), index=True)
    label: Mapped[str] = mapped_column(String(255))
    monthly_price: Mapped[float] = mapped_column(Float, default=0.0)
    service_charge_monthly: Mapped[float] = mapped_column(Float, default=0.0)
    caution_fee: Mapped[float] = mapped_column(Float, default=0.0)
    legal_fee: Mapped[float] = mapped_column(Float, default=0.0)
    meter_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(50), default="Apartment")
    listing_type: Mapped[str] = mapped_column(String(50), default="Rent")
    available_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    bedrooms: Mapped[int] = mapped_column(Integer, default=0)
    bathrooms: Mapped[int] = mapped_column(Integer, default=0)
    area: Mapped[float] = mapped_column(Float, default=0.0)
    amenities: Mapped[dict] = mapped_column(JSON, default=dict)
    street_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    images: Mapped[list] = mapped_column(JSON, default=list)
    videos: Mapped[list] = mapped_column(JSON, default=list)
    listing_graphic_url: Mapped[str | None] = mapped_column(Text, nullable=True)  # AI-designed marketing graphic (Designer agent)
    status: Mapped[str] = mapped_column(String(50), default="vacant")
    occupied_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    occupied_since: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    features: Mapped[list] = mapped_column(JSON, default=list)
    condition_reports: Mapped[list] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
