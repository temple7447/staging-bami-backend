"""
Billionaire OS — personal execution system models.

Per-user productivity data:
  SignalMission   — daily 3-5 mission-critical tasks (the "signal")
  TimeBlock       — colour-coded blocks across the 18-hour window (time audit)
  KingsAuditItem  — 80/20 worksheet items (low-yield vs high-yield activities)
  TimeValueProfile— hourly-rate calculator settings + the 4 action lists
"""
from sqlalchemy import String, Boolean, DateTime, Float, Integer, JSON
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class SignalMission(Base):
    """A single mission-critical task for a given day. Max 5/day enforced in API."""
    __tablename__ = "signal_missions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    user_id: Mapped[str] = mapped_column(String(36), index=True)

    title: Mapped[str] = mapped_column(String(500))
    deadline: Mapped[str | None] = mapped_column(String(100), nullable=True)   # "2 PM", "End of day"
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    mission_date: Mapped[str] = mapped_column(String(10), index=True)          # "YYYY-MM-DD"
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class TimeBlock(Base):
    """A time-audit block within the 4 AM - 10 PM window."""
    __tablename__ = "time_blocks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    user_id: Mapped[str] = mapped_column(String(36), index=True)

    block_date: Mapped[str] = mapped_column(String(10), index=True)            # "YYYY-MM-DD"
    time_label: Mapped[str] = mapped_column(String(20))                        # "4:00 AM"
    activity: Mapped[str] = mapped_column(String(300))
    block_type: Mapped[str] = mapped_column(String(20), default="neutral")     # signal|noise|reminder|neutral
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class KingsAuditItem(Base):
    """An activity in the 80/20 worksheet.

    bucket = 'low'  → 80% activities producing 20% revenue (the not-to-do list)
    bucket = 'high' → 20% activities producing 80% revenue (the protected zone)
    """
    __tablename__ = "kings_audit_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    user_id: Mapped[str] = mapped_column(String(36), index=True)

    bucket: Mapped[str] = mapped_column(String(10))                            # 'low' | 'high'
    text: Mapped[str] = mapped_column(String(300))

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class TimeValueProfile(Base):
    """Per-user time-value calculator settings and the four action lists."""
    __tablename__ = "time_value_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    user_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)

    weekly_hours: Mapped[float] = mapped_column(Float, default=0.0)
    weekly_income: Mapped[float] = mapped_column(Float, default=0.0)

    # Action lists — stored as JSON arrays of strings
    delegate: Mapped[list | None] = mapped_column(JSON, default=list)
    outsource: Mapped[list | None] = mapped_column(JSON, default=list)
    automate: Mapped[list | None] = mapped_column(JSON, default=list)
    delete_list: Mapped[list | None] = mapped_column(JSON, default=list)

    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
