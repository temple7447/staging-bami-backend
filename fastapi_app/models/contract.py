from sqlalchemy import String, Boolean, DateTime, JSON, Float, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class Contract(Base):
    """A job done for a client, the total agreed for it, the instalments that are
    due and the payments received so far. The balance is always derived from these."""
    __tablename__ = "contracts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    title: Mapped[str] = mapped_column(String(255), default="")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    developer_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)   # who is owed the money
    total_amount: Mapped[float] = mapped_column(Float, default=0.0)
    currency: Mapped[str] = mapped_column(String(3), default="NGN")              # NGN | USD
    status: Mapped[str] = mapped_column(String(20), default="active")            # active | completed | cancelled
    # project  = a fixed price job (total_amount, instalments)
    # retainer = monthly support with no fixed total: monthly_amount due on billing_day each month
    # what the work is: development | legal | maintenance | design | marketing | other (for spend reports)
    category: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # scope and conditions agreed in writing; the contractor must accept the contract (see `acceptance`)
    terms: Mapped[str | None] = mapped_column(Text, nullable=True)
    # {status: accepted|declined, typed_name, accepted_at, ip, hash, decline_reason, declined_at}
    # `hash` fingerprints the terms/amounts at that moment, so a later edit makes it need re-accepting
    acceptance: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    kind: Mapped[str] = mapped_column(String(20), default="project", server_default="project")
    monthly_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    billing_day: Mapped[int | None] = mapped_column(Integer, nullable=True)     # 1-28
    start_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    end_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # [{id, label, amount, due_date}] — due_date is YYYY-MM-DD or null
    instalments: Mapped[list] = mapped_column(JSON, default=list)
    # [{id, paid_on, amount, method, note, recorded_by, recorded_by_name}]
    payments: Mapped[list] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
