from sqlalchemy import String, Text, Float, Integer, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, Money, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class Deal(Base):
    __tablename__ = "deals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)

    # Which pipeline this deal belongs to: "sales" (general CRM) or "level1"
    # (the Scale-framework "Get 10 Customers" funnel — same table, filtered view).
    pipeline: Mapped[str] = mapped_column(String(20), default="sales")
    # Level 1 only: NPS score (0-10) and lifetime value, used for the
    # graduation status (10 sales won, 10 promoters, Model 10 filled).
    nps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ltv: Mapped[float | None] = mapped_column(Money, nullable=True)

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
    # (Level 1 pipeline additionally uses "delivered", after "won")
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
