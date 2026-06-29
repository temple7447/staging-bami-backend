from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional
from datetime import datetime, timedelta
from calendar import monthrange

from models.user import User
from models.payment import Payment
from models.billing_item import BillingItem
from models.withdrawal import Withdrawal
from models.bank_deposit import BankDeposit
from models.wallet import Wallet
from models.estate import Estate
from models.tenant import Tenant
from core.security import get_current_user
from core.database import get_db

router = APIRouter(prefix="/finance", tags=["Finance"])


@router.get("/overview")
async def finance_overview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.utcnow()
    start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    start_of_year = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)

    # Revenue: confirmed payments this month
    pay_result = await db.execute(
        select(Payment).where(
            Payment.owner_id == current_user.id,
            Payment.payment_status == "confirmed",
        )
    )
    all_payments = pay_result.scalars().all()
    month_revenue = sum(p.amount for p in all_payments if p.created_at >= start_of_month)
    ytd_revenue = sum(p.amount for p in all_payments if p.created_at >= start_of_year)
    total_revenue = sum(p.amount for p in all_payments)

    # Outstanding billing
    bill_result = await db.execute(
        select(BillingItem).where(
            BillingItem.owner_id == current_user.id,
            BillingItem.is_paid == False,
        )
    )
    unpaid_bills = bill_result.scalars().all()
    total_outstanding = sum(b.amount for b in unpaid_bills)

    # Withdrawals (expenses)
    with_result = await db.execute(
        select(Withdrawal).where(
            Withdrawal.user_id == current_user.id,
            Withdrawal.status == "approved",
        )
    )
    withdrawals = with_result.scalars().all()
    month_expenses = sum(w.amount for w in withdrawals if w.created_at and w.created_at >= start_of_month)
    ytd_expenses = sum(w.amount for w in withdrawals if w.created_at and w.created_at >= start_of_year)

    # Bank deposits
    dep_result = await db.execute(
        select(BankDeposit).where(BankDeposit.user_id == current_user.id)
    )
    deposits = dep_result.scalars().all()
    total_deposits = sum(d.amount for d in deposits)

    # Wallet balance
    wallet_result = await db.execute(select(Wallet).where(Wallet.user_id == current_user.id))
    wallet = wallet_result.scalar_one_or_none()
    wallet_balance = wallet.balance if wallet else 0.0

    # 12-month revenue trend
    months = []
    for i in range(11, -1, -1):
        ref = (now.replace(day=1) - timedelta(days=i * 28)).replace(day=1)
        _, last_day = monthrange(ref.year, ref.month)
        end_of = ref.replace(day=last_day, hour=23, minute=59, second=59)
        rev = sum(p.amount for p in all_payments if ref <= p.created_at <= end_of)
        months.append({
            "month": ref.strftime("%b %Y"),
            "revenue": rev,
        })

    # Net profit this month
    net_month = month_revenue - month_expenses

    return {
        "revenue": {
            "this_month": month_revenue,
            "ytd": ytd_revenue,
            "total": total_revenue,
        },
        "expenses": {
            "this_month": month_expenses,
            "ytd": ytd_expenses,
        },
        "net_profit_month": net_month,
        "outstanding": total_outstanding,
        "unpaid_bills_count": len(unpaid_bills),
        "total_deposits": total_deposits,
        "wallet_balance": wallet_balance,
        "monthly_trend": months,
        "payment_by_type": _group_by(all_payments, "payment_type"),
    }


@router.get("/cashflow")
async def cashflow(
    months: int = Query(6, ge=1, le=24),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.utcnow()

    pay_result = await db.execute(
        select(Payment).where(
            Payment.owner_id == current_user.id,
            Payment.payment_status == "confirmed",
        )
    )
    payments = pay_result.scalars().all()

    with_result = await db.execute(
        select(Withdrawal).where(
            Withdrawal.user_id == current_user.id,
            Withdrawal.status == "approved",
        )
    )
    withdrawals = with_result.scalars().all()

    rows = []
    for i in range(months - 1, -1, -1):
        ref = (now.replace(day=1) - timedelta(days=i * 28)).replace(day=1)
        _, last_day = monthrange(ref.year, ref.month)
        end_of = ref.replace(day=last_day, hour=23, minute=59, second=59)
        income = sum(p.amount for p in payments if ref <= p.created_at <= end_of)
        outflow = sum(w.amount for w in withdrawals if w.created_at and ref <= w.created_at <= end_of)
        rows.append({
            "month": ref.strftime("%b %Y"),
            "income": income,
            "expenses": outflow,
            "net": income - outflow,
        })

    return {"data": rows}


@router.get("/unpaid-bills")
async def unpaid_bills(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(BillingItem).where(
            BillingItem.owner_id == current_user.id,
            BillingItem.is_paid == False,
        ).order_by(BillingItem.due_date.asc().nullslast())
    )
    bills = result.scalars().all()
    return {
        "data": [
            {
                "id": b.id,
                "label": b.label,
                "amount": b.amount,
                "item_type": b.item_type,
                "due_date": b.due_date.isoformat() if b.due_date else None,
                "created_at": b.created_at.isoformat(),
            }
            for b in bills
        ],
        "total_outstanding": sum(b.amount for b in bills),
    }


def _group_by(items, attr: str) -> dict:
    result: dict[str, float] = {}
    for item in items:
        key = getattr(item, attr, "other") or "other"
        result[key] = result.get(key, 0) + item.amount
    return result
