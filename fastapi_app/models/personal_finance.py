from sqlalchemy import String, JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class PersonalFinance(Base):
    """Pillar 2 (personal/business finance) persistence — one JSON doc per owner.

    Holds the Investment Portfolio, 50/30/20 budget, and Financial Goals tools
    (previously in-memory mock data). Opaque JSON, keyed by tool.
    """
    __tablename__ = "personal_finance"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)

    goals: Mapped[list] = mapped_column(JSON, default=list)        # [{id,title,category,targetAmount,...}]
    budget: Mapped[dict] = mapped_column(JSON, default=dict)       # {monthlyIncome, categories:[...]}
    portfolio: Mapped[dict] = mapped_column(JSON, default=dict)    # {assets:[...], ...}

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
