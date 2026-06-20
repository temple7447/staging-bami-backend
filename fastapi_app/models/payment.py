from sqlalchemy import String, Boolean, DateTime, JSON, Float, Text
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    tenant: Mapped[str] = mapped_column(String(36), index=True)
    estate: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    amount: Mapped[float] = mapped_column(Float)
    payment_type: Mapped[str] = mapped_column(String(100))
    payment_status: Mapped[str] = mapped_column(String(50), default="pending", index=True)
    reference: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    paystack_response: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
