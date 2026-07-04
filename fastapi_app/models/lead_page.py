from sqlalchemy import String, Text, Integer, Boolean, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class LeadPage(Base):
    """An AI-generated landing page for lead capture. Public visitors reach it
    at /p/{slug} with no auth; only `published` pages are servable."""
    __tablename__ = "lead_pages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)

    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(255), default="Untitled page")
    prompt: Mapped[str] = mapped_column(Text, default="")

    headline: Mapped[str] = mapped_column(String(120), default="")
    subheadline: Mapped[str] = mapped_column(String(200), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    cta_text: Mapped[str] = mapped_column(String(60), default="Get instant access")
    fields: Mapped[list] = mapped_column(JSON, default=lambda: [
        {"key": "name", "label": "Your name", "type": "text", "required": True},
        {"key": "email", "label": "Email", "type": "email", "required": True},
    ])
    deliverable_ai_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    thank_you_message: Mapped[str] = mapped_column(
        String(255), default="Check your email — your resource is on the way."
    )

    pixel_meta: Mapped[str | None] = mapped_column(String(50), nullable=True)
    pixel_google: Mapped[str | None] = mapped_column(String(50), nullable=True)
    pixel_custom_html: Mapped[str | None] = mapped_column(Text, nullable=True)

    published: Mapped[bool] = mapped_column(Boolean, default=False)
    views: Mapped[int] = mapped_column(Integer, default=0)
    submissions: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
