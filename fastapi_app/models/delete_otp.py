from sqlalchemy import String, DateTime, Integer
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime
from models.base import Base, gen_uuid
from utils.time_utils import utcnow


class DeleteOtp(Base):
    """A one-time code the owner must relay back before a business-critical
    delete completes. Not tied to a session — the code itself, sent to the
    owner's phone+email, is the approval; whoever has it can confirm the
    specific (resource_type, resource_id) it was issued for."""
    __tablename__ = "delete_otps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    resource_type: Mapped[str] = mapped_column(String(50), index=True)
    resource_id: Mapped[str] = mapped_column(String(36), index=True)
    resource_label: Mapped[str] = mapped_column(String(255))
    requested_by: Mapped[str] = mapped_column(String(36))
    code_hash: Mapped[str] = mapped_column(String(128))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
