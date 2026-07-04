from sqlalchemy import String, Text, Boolean, Integer, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class BusinessIntegration(Base):
    """A read-only connection to an external system (CRM, accounting,
    payments, or custom API). auth_value is stored encrypted at rest."""
    __tablename__ = "business_integrations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)

    name: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(30), default="custom")  # custom | crm | accounting | payments
    base_url: Mapped[str] = mapped_column(Text, default="")
    auth_header: Mapped[str] = mapped_column(String(100), default="Authorization")
    auth_value_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_status: Mapped[str | None] = mapped_column(String(100), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class IntegrationSnapshot(Base):
    """One 'sync now' result — a timestamped GET response snapshot."""
    __tablename__ = "integration_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    integration_id: Mapped[str] = mapped_column(String(36), index=True)

    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
