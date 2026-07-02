from sqlalchemy import String, Float, JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class OwnerFinancePlan(Base):
    """Level 4 'Double Your Take-Home' — the owner's pay-yourself-first plan.

    Stores the targets (monthly salary, profit %, emergency fund, expense ratios)
    so the Scale dashboard can compare them against actual revenue/expenses.
    """
    __tablename__ = "owner_finance_plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)

    # Pay yourself first
    target_monthly_salary: Mapped[float] = mapped_column(Float, default=0.0)
    living_expenses: Mapped[float] = mapped_column(Float, default=0.0)  # salary should be this + 15%

    # Profit-first
    target_profit_pct: Mapped[float] = mapped_column(Float, default=20.0)  # % of revenue

    # Reserves
    emergency_fund_target: Mapped[float] = mapped_column(Float, default=0.0)  # 3–6 months opex
    emergency_fund_current: Mapped[float] = mapped_column(Float, default=0.0)

    # Expense ratios: {"category": pct, ...} should sum to 100 of the non-profit remainder
    expense_ratios: Mapped[dict] = mapped_column(JSON, default=dict)

    # ── Cash Sweep Waterfall (Level 4) — the 5 accounts + allocation ──
    monthly_opex: Mapped[float] = mapped_column(Float, default=0.0)          # 1-month reserve target
    operating_reserve_current: Mapped[float] = mapped_column(Float, default=0.0)
    tax_pct: Mapped[float] = mapped_column(Float, default=0.0)               # % of revenue set aside
    tax_current: Mapped[float] = mapped_column(Float, default=0.0)
    sweep_current: Mapped[float] = mapped_column(Float, default=0.0)
    sinking_funds: Mapped[list] = mapped_column(JSON, default=list)          # [{name, target, current}]

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
