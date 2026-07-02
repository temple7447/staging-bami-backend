from sqlalchemy import String, Text, JSON, DateTime, Boolean, Float
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class Candidate(Base):
    __tablename__ = "candidates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)

    # Identity
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Role being applied for
    role: Mapped[str] = mapped_column(String(255))
    department: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Pipeline: sourced, screened, interview, offer, hired, rejected, withdrawn
    stage: Mapped[str] = mapped_column(String(50), default="sourced")

    # Source: referral, linkedin, direct, job_board, walk-in, other
    source: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Salary expectation
    salary_expectation: Mapped[float | None] = mapped_column(Float, nullable=True)
    offered_salary: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Documents
    cv_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    portfolio_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Scores / halo research
    halo_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    skills_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    culture_fit_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Notes / interviews
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    interview_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    start_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
