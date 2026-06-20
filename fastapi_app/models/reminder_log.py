from sqlalchemy import String, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime


class ReminderLog(Base):
    __tablename__ = "reminder_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
