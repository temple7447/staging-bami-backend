from sqlalchemy import String, Boolean, DateTime, JSON, Float, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(50), default="tenant")

    position: Mapped[str | None] = mapped_column(String(255), nullable=True)
    assigned_estates: Mapped[list] = mapped_column(JSON, default=list)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)

    email_verification_token: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password_reset_token: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password_reset_expire: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    password_reset_otp_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password_reset_otp_expire: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    profile_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    profile_image_public_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    business_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    business_type_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    specialization: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cac_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    gov_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    certification: Mapped[str | None] = mapped_column(String(255), nullable=True)
    business_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    portfolio: Mapped[list] = mapped_column(JSON, default=list)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    rating: Mapped[float] = mapped_column(Float, default=0.0)
    review_count: Mapped[int] = mapped_column(Integer, default=0)
    location_city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    location_state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    op_hours_start: Mapped[str] = mapped_column(String(20), default="9:00 AM")
    op_hours_end: Mapped[str] = mapped_column(String(20), default="6:00 PM")
    is_verified_pro: Mapped[bool] = mapped_column(Boolean, default=False)
    manager: Mapped[str | None] = mapped_column(String(36), nullable=True)

    # Telegram link — lets the AI coach auto-recognise this user on Telegram
    # without re-logging in, so it always has their live business data.
    telegram_id: Mapped[str | None] = mapped_column(String(50), index=True, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
