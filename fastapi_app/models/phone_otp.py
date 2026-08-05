from sqlalchemy import String, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class PhoneOtp(Base):
    """Phone sign-in/sign-up verification codes (Bami-Wash). One row per send;
    consumed once verified so a code can't be replayed. Codes are hashed —
    never stored plaintext, same convention as every other credential here."""
    __tablename__ = "phone_otps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    request_id: Mapped[str] = mapped_column(String(36), index=True, unique=True)
    phone: Mapped[str] = mapped_column(String(50), index=True)
    code_hash: Mapped[str] = mapped_column(String(255))
    pending_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
