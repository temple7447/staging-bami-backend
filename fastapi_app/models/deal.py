from sqlalchemy import String, Text, Float, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class Deal(Base):
    __tablename__ = "deals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)

    # Contact
    client_name: Mapped[str] = mapped_column(String(255))
    client_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    client_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    client_company: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Deal info
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    value: Mapped[float] = mapped_column(Float, default=0.0)

    # Pipeline stage: lead, qualified, proposal, negotiation, won, lost
    stage: Mapped[str] = mapped_column(String(50), default="lead")
    probability: Mapped[float] = mapped_column(Float, default=0.0)  # 0-100

    # Source: referral, social, walk-in, campaign, website, other
    source: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Links
    linked_estate_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    linked_campaign_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    linked_enquiry_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    # Dates
    expected_close_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Activity
    last_activity: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_action_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
