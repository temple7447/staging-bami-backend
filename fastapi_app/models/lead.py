from sqlalchemy import String, Text, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class Lead(Base):
    """A form submission from a public LeadPage. owner_id/lead_page_id are
    always derived server-side from the looked-up page — never trusted from
    the (anonymous, unauthenticated) submitter."""
    __tablename__ = "leads"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)
    lead_page_id: Mapped[str] = mapped_column(String(36), index=True)

    data: Mapped[dict] = mapped_column(JSON, default=dict)
    source: Mapped[str | None] = mapped_column(String(50), nullable=True)
    utm: Mapped[dict] = mapped_column(JSON, default=dict)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)

    # new -> contacted -> promoted -> archived
    status: Mapped[str] = mapped_column(String(20), default="new")
    promoted_deal_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
