from sqlalchemy import String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class CoachMessage(Base):
    """Individual message in the web-based AI coach conversation."""
    __tablename__ = "coach_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    web_user_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    role: Mapped[str] = mapped_column(String(10))   # "user" | "assistant"
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
