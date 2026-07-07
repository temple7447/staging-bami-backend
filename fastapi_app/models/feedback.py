from sqlalchemy import String, Boolean, DateTime, Text, Integer
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class Feedback(Base):
    """Product/service feedback from tenants (and staff) — suggestions,
    improvement requests, complaints about the system itself. Distinct from
    Issue (physical maintenance) and ServiceRequest (chargeable services)."""

    __tablename__ = "feedback"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    subject: Mapped[str] = mapped_column(String(255), default="")
    message: Mapped[str] = mapped_column(Text, default="")
    # suggestion | improvement | complaint | feature_request | praise | other
    category: Mapped[str] = mapped_column(String(50), default="suggestion")
    # Optional 1–5 satisfaction rating attached to the feedback
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # new | reviewed | in_progress | done | dismissed
    status: Mapped[str] = mapped_column(String(50), default="new", index=True)

    submitted_by: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    submitted_by_role: Mapped[str | None] = mapped_column(String(50), nullable=True)
    tenant: Mapped[str | None] = mapped_column(String(36), nullable=True)
    estate: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)

    admin_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    responded_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
