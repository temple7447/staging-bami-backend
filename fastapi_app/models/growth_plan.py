from sqlalchemy import String, Integer, Float, Text, JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime


class GrowthPlan(Base):
    """The owner's Level 7 / Scalable Impact Plan — persisted so it survives
    refreshes and devices, and so the AI Coach + Scale page can read it.

    `data` holds the entire Scalable Impact Planner + Operating System builder
    state (opaque JSON). A few key fields are denormalised for fast reads.
    """
    __tablename__ = "growth_plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)

    # Full planner state (opaque to the backend)
    data: Mapped[dict] = mapped_column(JSON, default=dict)

    # Denormalised for the Coach / Scale page
    current_step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stated_level: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_revenue: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_profit: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_valuation: Mapped[float | None] = mapped_column(Float, nullable=True)
    why_summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
