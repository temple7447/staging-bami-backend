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


@router.get("/forecast")
async def get_forecast(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """AI-powered 3-month financial forecast."""
    import anthropic
    from core.config import settings

    uid = str(current_user.id)
    now = datetime.utcnow()

    # Gather current data
    tenants_q = await db.execute(
        select(Tenant).where(Tenant.owner_id == uid, Tenant.is_active == True)
    )
    tenants = tenants_q.scalars().all()

    active_count = len(tenants)
    monthly_revenue = sum((t.rent_amount or 0) + (t.service_charge_amount or 0) for t in tenants)
    total_outstanding = sum((t.rent_outstanding or 0) + (t.service_charge_outstanding or 0) for t in tenants)
    overdue_count = len([t for t in tenants if (t.rent_outstanding or 0) > 0])

    # Leases expiring in next 90 days
    expiring_90 = [t for t in tenants if t.lease_end_date and
                   now <= t.lease_end_date <= now + timedelta(days=90)]

    # Last 3 months actual revenue
    three_months_ago = now - timedelta(days=90)
    payments_q = await db.execute(
        select(Payment).where(
            Payment.owner_id == uid,
            Payment.created_at >= three_months_ago,
            Payment.payment_status.in_(["completed", "success"]),
        )
    )
    recent_payments = payments_q.scalars().all()
    avg_monthly_collected = sum(p.amount for p in recent_payments) / 3 if recent_payments else 0

    snapshot = (
        f"Active tenants: {active_count}, Monthly rent roll: ₦{monthly_revenue:,.0f}, "
        f"Avg collected last 3mo: ₦{avg_monthly_collected:,.0f}, "
        f"Total outstanding: ₦{total_outstanding:,.0f}, Overdue tenants: {overdue_count}, "
        f"Leases expiring next 90 days: {len(expiring_90)}"
    )

    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    resp = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=600,
        system=(
            "You are a Nigerian property finance expert. Generate a 3-month financial forecast "
            "in JSON format ONLY. No prose outside the JSON. Format:\n"
            '{"months":[{"month":"Month Year","projected_revenue":0,"projected_collections":0,'
            '"risk_notes":"..."}],"summary":"...","recommendations":["...","...","..."]}'
        ),
        messages=[{"role": "user", "content": f"Business snapshot: {snapshot}. Forecast next 3 months."}],
    )

    import json
    text = resp.content[0].text.strip() if resp.content else "{}"
    try:
        forecast = json.loads(text)
    except Exception:
        # Extract JSON from text if wrapped in markdown
        import re
        match = re.search(r'\{.*\}', text, re.DOTALL)
        forecast = json.loads(match.group()) if match else {"error": "Could not parse forecast"}

    return {
        "snapshot": {
            "active_tenants": active_count,
            "monthly_rent_roll": monthly_revenue,
            "avg_monthly_collected": avg_monthly_collected,
            "total_outstanding": total_outstanding,
            "overdue_count": overdue_count,
            "leases_expiring_90_days": len(expiring_90),
        },
        "forecast": forecast,
    }
