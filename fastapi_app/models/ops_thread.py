from sqlalchemy import String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class OpsThread(Base):
    """A conversation thread with the Ops Manager — unlike the singleton
    Coach conversation, Ops Manager supports multiple named threads."""
    __tablename__ = "ops_threads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)

    title: Mapped[str] = mapped_column(String(255), default="New conversation")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class OpsMessage(Base):
    __tablename__ = "ops_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    thread_id: Mapped[str] = mapped_column(String(36), index=True)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)

    role: Mapped[str] = mapped_column(String(10))  # user | assistant
    content: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
