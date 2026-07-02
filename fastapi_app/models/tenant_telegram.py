from sqlalchemy import String, DateTime, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from typing import Any
from utils.time_utils import utcnow


class TenantTelegramSession(Base):
    __tablename__ = "tenant_telegram_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    telegram_id: Mapped[str] = mapped_column(String(50), unique=True, index=True)

    # Linked account
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    tenant_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    role: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Bot state machine
    # idle | awaiting_email | awaiting_password | logged_in | <feature_state>
    state: Mapped[str] = mapped_column(String(50), default="idle")

    # Temp storage during multi-step flows (email during login, etc.)
    temp_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    context: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
