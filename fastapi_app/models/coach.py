from sqlalchemy import String, Integer, Float, DateTime, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class CoachUser(Base):
    """A user being coached through the Level 7 framework via Telegram."""
    __tablename__ = "coach_users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    telegram_id: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    telegram_username: Mapped[str | None] = mapped_column(String(100), nullable=True)
    first_name: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Level 7 progress
    current_level: Mapped[int] = mapped_column(Integer, default=1)  # 1–7

    # Scalable Impact Planner — their "number"
    current_revenue: Mapped[float | None] = mapped_column(Float, nullable=True)
    current_profit: Mapped[float | None] = mapped_column(Float, nullable=True)
    current_valuation: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_revenue: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_profit: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_valuation: Mapped[float | None] = mapped_column(Float, nullable=True)
    their_why: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Level completion tracking — JSON array of completed level numbers
    completed_levels: Mapped[list] = mapped_column(JSON, default=list)

    # Level-specific data
    customers_served: Mapped[int] = mapped_column(Integer, default=0)  # Level 1 progress
    has_growth_flywheel: Mapped[bool | None] = mapped_column(String(5), nullable=True)
    has_operating_system: Mapped[bool | None] = mapped_column(String(5), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class CoachMessage(Base):
    """Individual message in a coaching conversation (Telegram or web)."""
    __tablename__ = "coach_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    telegram_id: Mapped[str | None] = mapped_column(String(50), index=True, nullable=True)
    web_user_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    role: Mapped[str] = mapped_column(String(10))   # "user" | "assistant"
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
