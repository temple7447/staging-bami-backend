from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timedelta
from typing import Optional, Union
from pydantic import BaseModel, Field, model_validator

from models.subscription import Subscription
from models.user import User
from core.security import get_current_user
from core.database import get_db
from core.db_helpers import find_all, find_one, save, count
from models.base import gen_uuid
from utils.tenant_helpers import add_months
from utils.time_utils import utcnow

router = APIRouter(prefix="/subscriptions", tags=["Subscriptions"])
ADMIN_ROLES = {"super_admin", "admin"}
CATEGORIES = {"domain", "frontend", "backend", "other"}
CURRENCIES = ("USD", "NGN")   # most of the platform's bills are in dollars


def _currency(v, default: str = "NGN") -> str:
    v = (v or default).upper()
    if v not in CURRENCIES:
        raise HTTPException(status_code=422, detail=f"currency must be one of: {', '.join(CURRENCIES)}")
    return v


def _pay_currency(p: dict) -> str:
    return p.get("currency") or "NGN"      # payments recorded before currencies existed were naira


def _totals(payments) -> dict:
    """Sum payments per currency — dollars and naira are never added together."""
    out: dict[str, float] = {}
    for p in payments or []:
        c = _pay_currency(p)
        out[c] = round(out.get(c, 0) + (p.get("amount") or 0), 2)
    return out


def _check_category(v):
    if v is not None and v not in CATEGORIES:
        raise HTTPException(status_code=422, detail=f"category must be one of: {', '.join(sorted(CATEGORIES))}")
    return v


def _months_between(start: "datetime | None", end: "datetime | None") -> "int | None":
    if not start or not end or end <= start:
        return None
    return max(1, round((end - start).days / 30.44))


def _payment(amount, months, period_start, period_end, paid_on=None, note=None,
             currency="NGN", ngn_equivalent=None) -> dict:
    return {
        "id": gen_uuid(),
        "paid_on": (paid_on or utcnow()).isoformat(),
        "amount": round(amount, 2),            # exactly what was paid, in `currency`
        "currency": currency,
        # For dollar payments: the naira the bank actually debited (optional)
        "ngn_equivalent": round(ngn_equivalent, 2) if ngn_equivalent is not None else None,
        "months": months,
        "period_start": period_start.isoformat() if period_start else None,
        "period_end": period_end.isoformat() if period_end else None,
        "note": note,
    }


def _parse_date(v) -> "datetime | None":
    if not v:
        return None
    if isinstance(v, datetime):
        return v
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(v.rstrip("Z").split(".")[0], fmt.rstrip("Z").split(".")[0])
        except ValueError:
            continue
    return None


def _parse_features(v) -> list[str]:
    if v is None:
        return []
    if isinstance(v, list):
        return [s.strip() for s in v if s.strip()]
    if isinstance(v, str):
        return [s.strip() for s in v.splitlines() if s.strip()]
    return []


class SubscriptionCreate(BaseModel):
    model_config = {"populate_by_name": True}

    name: Optional[str] = None
    plan: Optional[str] = None
    price: float = 0.0
    amount: Optional[float] = None
    currency: Optional[str] = None
    ngn_equivalent: Optional[float] = Field(default=None, alias="ngnEquivalent", ge=0)
    billing_period: Optional[str] = Field(default=None, alias="billingPeriod")
    duration_months: Optional[int] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    category: Optional[str] = None
    provider: Optional[str] = None
    features: Union[list[str], str, None] = []
    status: str = "Active"
    start_date: Optional[str] = Field(default=None, alias="startDate")
    expires_at: Optional[str] = Field(default=None, alias="expiresAt")

    @model_validator(mode="after")
    def normalise(self):
        if not self.billing_period:
            self.billing_period = "month"
        self.features = _parse_features(self.features)
        return self


class SubscriptionUpdate(BaseModel):
    model_config = {"populate_by_name": True}

    name: Optional[str] = None
    price: Optional[float] = None
    currency: Optional[str] = None
    billing_period: Optional[str] = Field(default=None, alias="billingPeriod")
    description: Optional[str] = None
    icon: Optional[str] = None
    category: Optional[str] = None
    provider: Optional[str] = None
    features: Union[list[str], str, None] = None
    status: Optional[str] = None
    start_date: Optional[str] = Field(default=None, alias="startDate")
    expires_at: Optional[str] = Field(default=None, alias="expiresAt")

    @model_validator(mode="after")
    def normalise(self):
        if self.features is not None:
            self.features = _parse_features(self.features)
        return self


class RenewRequest(BaseModel):
    model_config = {"populate_by_name": True}

    months: int = Field(..., ge=1, le=60)
    amount: Optional[float] = Field(default=None, ge=0)   # defaults to the plan's price
    currency: Optional[str] = None                        # defaults to the plan's currency
    ngn_equivalent: Optional[float] = Field(default=None, alias="ngnEquivalent", ge=0)
    paid_on: Optional[str] = Field(default=None, alias="paidOn")
    note: Optional[str] = Field(default=None, max_length=300)


@router.post("", status_code=201)
async def create_subscription(
    body: SubscriptionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    _check_category(body.category)
    currency = _currency(body.currency)
    name = body.name or body.plan or "Plan"
    price = body.price or body.amount or 0.0
    start, expires = _parse_date(body.start_date), _parse_date(body.expires_at)
    # What was paid up front is the first entry in the payment history.
    payments = [_payment(price, _months_between(start, expires), start, expires, paid_on=start,
                         currency=currency, ngn_equivalent=body.ngn_equivalent)] if price > 0 else []
    sub = Subscription(
        id=gen_uuid(), name=name, price=price, currency=currency,
        billing_period=body.billing_period or "month",
        description=body.description, icon=body.icon,
        category=body.category, provider=body.provider, payments=payments,
        features=body.features, status=body.status,
        start_date=start, expires_at=expires,
        created_by=user.id,
    )
    await save(db, sub)
    return {"success": True, "data": _s(sub)}


@router.get("")
async def list_subscriptions(
    billing_period: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    conditions = [Subscription.is_active == True]
    if billing_period:
        conditions.append(Subscription.billing_period == billing_period)
    if status:
        conditions.append(Subscription.status == status)
    skip = (page - 1) * limit
    total = await count(db, Subscription, *conditions)
    items = await find_all(db, Subscription, *conditions,
                           order_by=Subscription.created_at.desc(), skip=skip, limit=limit)
    return {"success": True, "count": total, "total": total,
            "total_pages": -(-total // limit), "page": page,
            "data": [_s(s) for s in items]}


@router.get("/spend")
async def subscription_spend(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """What the platform has spent on its own subscriptions (domain, hosting, ...),
    built from every recorded payment. Amounts are kept per currency (never summed
    across USD and NGN). `ngn_total` is the naira cost where it is known: naira
    payments plus the naira the bank debited for dollar payments."""
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    start, end = _parse_date(date_from), _parse_date(date_to)
    subs = await find_all(db, Subscription, Subscription.is_active == True, limit=1000)

    ledger = []
    for sub in subs:
        category = sub.category or ("backend" if sub.icon == "Server (Backend)" else "frontend")
        for p in (sub.payments or []):
            paid_on = _parse_date(p.get("paid_on"))
            if not paid_on or (start and paid_on < start) or (end and paid_on >= end + timedelta(days=1)):
                continue
            ledger.append({
                "payment_id": p.get("id"), "subscription_id": sub.id, "name": sub.name,
                "category": category, "provider": sub.provider,
                "paid_on": paid_on, "amount": p.get("amount") or 0, "currency": _pay_currency(p),
                "ngn_equivalent": p.get("ngn_equivalent"),
                "months": p.get("months"), "period_start": p.get("period_start"),
                "period_end": p.get("period_end"), "note": p.get("note"),
            })
    ledger.sort(key=lambda x: x["paid_on"], reverse=True)

    def add(bucket: dict, key, row):
        cur = bucket.setdefault(key, {})
        cur[row["currency"]] = round(cur.get(row["currency"], 0) + row["amount"], 2)

    by_month: dict[str, dict] = {}
    by_category: dict[str, dict] = {}
    totals: dict[str, float] = {}
    this_month: dict[str, float] = {}
    this_year: dict[str, float] = {}
    ngn_total, ngn_missing = 0.0, 0
    now = utcnow()
    for row in ledger:
        add(by_month, row["paid_on"].strftime("%Y-%m"), row)
        add(by_category, row["category"], row)
        c = row["currency"]
        totals[c] = round(totals.get(c, 0) + row["amount"], 2)
        if row["paid_on"].year == now.year:
            this_year[c] = round(this_year.get(c, 0) + row["amount"], 2)
            if row["paid_on"].month == now.month:
                this_month[c] = round(this_month.get(c, 0) + row["amount"], 2)
        if c == "NGN":
            ngn_total += row["amount"]
        elif row["ngn_equivalent"] is not None:
            ngn_total += row["ngn_equivalent"]
        else:
            ngn_missing += 1

    currencies = [c for c in CURRENCIES if c in totals]
    return {"success": True, "data": {
        "currencies": currencies,
        "totals": totals,
        "this_month": this_month,
        "this_year": this_year,
        "ngn_total": round(ngn_total, 2),
        "ngn_missing": ngn_missing,          # dollar payments with no naira amount recorded
        "payment_count": len(ledger),
        "by_month": [{"month": k, "amounts": v} for k, v in sorted(by_month.items(), reverse=True)],
        "by_category": [{"category": k, "amounts": v} for k, v in sorted(by_category.items())],
        "payments": ledger,
    }}


@router.get("/{sub_id}")
async def get_subscription(sub_id: str, db: AsyncSession = Depends(get_db),
                           user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    sub = await find_one(db, Subscription, Subscription.id == sub_id, Subscription.is_active == True)
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription plan not found")
    return {"success": True, "data": _s(sub)}


@router.put("/{sub_id}")
async def update_subscription(
    sub_id: str,
    body: SubscriptionUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role != "super_admin":
        raise HTTPException(status_code=403, detail="Super admins only")
    sub = await find_one(db, Subscription, Subscription.id == sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription plan not found")
    _check_category(body.category)
    if body.currency is not None:
        body.currency = _currency(body.currency)
    updates = body.model_dump(exclude_none=True, by_alias=False)
    for k in ("start_date", "expires_at"):
        if k in updates:
            updates[k] = _parse_date(updates[k])
    for k, v in updates.items():
        setattr(sub, k, v)
    sub.updated_at = utcnow()
    await save(db, sub)
    return {"success": True, "data": _s(sub)}


@router.post("/{sub_id}/renew")
async def renew_subscription(
    sub_id: str,
    body: RenewRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Record a new payment and push the expiry date forward.

    The new period starts where the old one ends (so renewing early never wastes
    paid time); if it has already lapsed it starts from the payment date."""
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    sub = await find_one(db, Subscription, Subscription.id == sub_id, Subscription.is_active == True)
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription plan not found")

    paid_on = _parse_date(body.paid_on) or utcnow()
    period_start = sub.expires_at if sub.expires_at and sub.expires_at > paid_on else paid_on
    period_end = add_months(period_start, body.months)
    amount = sub.price if body.amount is None else body.amount
    currency = _currency(body.currency, default=sub.currency or "NGN")

    sub.payments = [*(sub.payments or []),
                    _payment(amount, body.months, period_start, period_end, paid_on=paid_on, note=body.note,
                             currency=currency, ngn_equivalent=body.ngn_equivalent)]
    sub.currency = currency
    sub.expires_at = period_end
    if not sub.start_date:
        sub.start_date = period_start
    sub.status = "Active"
    sub.updated_at = utcnow()
    await save(db, sub)
    return {"success": True, "message": "Subscription renewed", "data": _s(sub)}


@router.delete("/{sub_id}")
async def delete_subscription(
    sub_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role != "super_admin":
        raise HTTPException(status_code=403, detail="Super admins only")
    sub = await find_one(db, Subscription, Subscription.id == sub_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription plan not found")
    sub.is_active = False
    sub.updated_at = utcnow()
    await save(db, sub)
    return {"success": True, "message": "Subscription plan deleted"}


def _s(s: Subscription) -> dict:
    return {
        "id": s.id, "name": s.name, "price": s.price,
        "billing_period": s.billing_period, "description": s.description,
        "icon": s.icon, "category": s.category, "provider": s.provider,
        "payments": s.payments or [],
        "currency": s.currency or "NGN",
        "total_paid_by_currency": _totals(s.payments),
        "status": s.status, "features": s.features or [],
        "is_active": s.is_active,
        "start_date": s.start_date,
        "expires_at": s.expires_at,
        "created_at": s.created_at,
        "updated_at": s.updated_at,
    }
