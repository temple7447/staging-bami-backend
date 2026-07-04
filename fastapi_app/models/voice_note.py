from sqlalchemy import String, Text, Integer, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class VoiceNote(Base):
    """A dictated voice note (browser speech-to-text), kept as durable context
    for the AI Coach and Ops Manager."""
    __tablename__ = "voice_notes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)

    transcript: Mapped[str] = mapped_column(Text)
    duration_sec: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
