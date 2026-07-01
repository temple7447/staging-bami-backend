from sqlalchemy import String, JSON, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime


class Playbook(Base):
    """A Business Playbook — a documented step-by-step checklist for a power stage
    (Scalable OS 'Algorithms'). Built via the 3 Ds (Define → Design → Deploy),
    kept 'always open', reviewed every 90 days, and owned by one person.
    """
    __tablename__ = "playbooks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)

    title: Mapped[str] = mapped_column(String(255))
    engine: Mapped[str] = mapped_column(String(30), default="growth")   # growth | fulfillment | innovation | internal
    stage: Mapped[str | None] = mapped_column(String(255), nullable=True)   # the power stage it documents
    playbook_owner: Mapped[str | None] = mapped_column(String(255), nullable=True)  # person responsible (not the CEO)
    steps: Mapped[list] = mapped_column(JSON, default=list)   # ordered list of step strings
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)  # last reviewed
