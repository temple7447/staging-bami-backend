"""Head Office — the CEO/owner's boardroom chat with the whole AI agent team.

A threaded conversation (like OpsThread) but framed as a boardroom where the
owner consults every department head (the agents in services/agents/). Kept as
its own tables so Head Office threads don't mix with the Ops Manager threads.
"""
from sqlalchemy import String, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime

from models.base import Base, gen_uuid
from utils.time_utils import utcnow


class HeadOfficeThread(Base):
    __tablename__ = "head_office_threads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)
    title: Mapped[str] = mapped_column(String(255), default="New boardroom chat")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class HeadOfficeMessage(Base):
    __tablename__ = "head_office_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    thread_id: Mapped[str] = mapped_column(String(36), index=True)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)
    role: Mapped[str] = mapped_column(String(10))  # user | assistant
    content: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
