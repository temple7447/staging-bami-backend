from sqlalchemy import String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class Model10Entry(Base):
    """Level 1 'Model 10' — the owner's curated list of best customers and
    why they belong (high LTV / advocate / repeat buyer). Purely a display
    target of 10; not enforced as a hard cap."""
    __tablename__ = "model10_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)

    name: Mapped[str] = mapped_column(String(255), default="")
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
