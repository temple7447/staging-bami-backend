from datetime import datetime
from sqlalchemy import String, Boolean, Float, DateTime, JSON, Text, Integer
from sqlalchemy.orm import Mapped, mapped_column
from core.database import Base


class AutopilotAction(Base):
    __tablename__ = "autopilot_actions"

    id:          Mapped[str]  = mapped_column(String(36), primary_key=True)
    owner_id:    Mapped[str]  = mapped_column(String(36), nullable=False, index=True)

    # Classification
    skill:       Mapped[str]  = mapped_column(String(30))   # marketer, finance, operations, sales, hr, designer
    action_type: Mapped[str]  = mapped_column(String(50))   # whatsapp_blast, instagram_post, payment_reminder, follow_up, etc.
    priority:    Mapped[str]  = mapped_column(String(10), default="medium")  # high, medium, low
    status:      Mapped[str]  = mapped_column(String(20), default="pending")  # pending, approved, executing, done, dismissed

    # Trigger context
    trigger_event:   Mapped[str | None]  = mapped_column(String(100))  # vacancy_opened, tenant_overdue, etc.
    trigger_context: Mapped[dict]        = mapped_column(JSON, default=dict)  # raw data that triggered this

    # Content the AI generated
    title:       Mapped[str]         = mapped_column(String(200))
    description: Mapped[str]         = mapped_column(Text)   # what the AI recommends doing
    content:     Mapped[str | None]  = mapped_column(Text)   # the actual post/message/email body to use
    platform:    Mapped[str | None]  = mapped_column(String(30))  # whatsapp, instagram, facebook, email, internal

    # Execution
    auto_execute:    Mapped[bool]        = mapped_column(Boolean, default=False)
    executed_at:     Mapped[datetime | None] = mapped_column(DateTime)
    execution_result:Mapped[dict]        = mapped_column(JSON, default=dict)

    # Recipients (for messaging actions)
    recipients:  Mapped[list]  = mapped_column(JSON, default=list)  # [{name, phone, email}]

    created_at:  Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime)
