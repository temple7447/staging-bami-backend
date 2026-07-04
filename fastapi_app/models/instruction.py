from sqlalchemy import String, Text, Integer, Boolean, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class InstructionGroup(Base):
    """A Project Space 'brain module' — a named group of instructions the
    owner curates for the AI Coach to treat as ground truth when active."""
    __tablename__ = "instruction_groups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)

    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str] = mapped_column(String(20), default="primary")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class InstructionItem(Base):
    """A single instruction inside a group: typed text, a fetched URL, or an
    uploaded file — content is always plain text once extracted."""
    __tablename__ = "instruction_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    group_id: Mapped[str] = mapped_column(String(36), index=True)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)

    kind: Mapped[str] = mapped_column(String(10), default="text")  # text | file | url
    title: Mapped[str] = mapped_column(String(255), default="New note")
    content: Mapped[str] = mapped_column(Text, default="")
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_mime: Mapped[str | None] = mapped_column(String(100), nullable=True)
    images: Mapped[list] = mapped_column(JSON, default=list)  # [{url, caption}]
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
