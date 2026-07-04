from sqlalchemy import String, Text, Date, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime, date
from utils.time_utils import utcnow


class OpsReport(Base):
    """A generated Ops Manager report — currently just the daily standup
    brief ('Today's Brief'), kept as history."""
    __tablename__ = "ops_reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)

    kind: Mapped[str] = mapped_column(String(20), default="daily")
    for_date: Mapped[date] = mapped_column(Date, default=lambda: utcnow().date())
    content: Mapped[str] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
