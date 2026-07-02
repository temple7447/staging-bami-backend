from sqlalchemy import String, Boolean, JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class AutopilotSettings(Base):
    """Per-owner settings for which autopilot action types should execute automatically."""
    __tablename__ = "autopilot_settings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)

    # Which action_types auto-execute without human approval
    auto_execute_types: Mapped[list] = mapped_column(JSON, default=list)

    # Master switch — turn off autopilot entirely
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    # Daily scan enabled
    daily_scan_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    # Notification preferences
    notify_high_priority: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_all: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
