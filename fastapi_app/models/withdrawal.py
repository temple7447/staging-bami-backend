from sqlalchemy import String, Boolean, DateTime, JSON, Float, Text
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime


class Withdrawal(Base):
    __tablename__ = "withdrawals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    user: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    bank_details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
