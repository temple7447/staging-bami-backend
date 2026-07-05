import asyncio
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime
from typing import Optional
from pydantic import BaseModel

from models.user import User
from models.tenant import Tenant
from models.billing_item import BillingItem
from models.payment import Payment
from models.unit import Unit
from models.estate import Estate
from core.security import get_current_user
from core.database import get_db
from core.authz import accessible_estate_ids, require_estate_access, require_tenant_access
from core.db_helpers import find_one, find_all, save, count
from utils.tenant_helpers import project_next_due_date
from utils.rent_calculator import get_current_rent, calculate_effective_rent, estate_rent_config, resolve_increase_start
from models.base import gen_uuid
from utils.time_utils import utcnow

router = APIRouter(prefix="/billing", tags=["Billing"])

ADMIN_ROLES  = {"super_admin", "admin", "super_manager", "business_owner", "manager"}
TENANT_ROLES = {"tenant", "user"}


class BillingItemCreate(BaseModel):
    label: str
    item_type: str = "other"
    amount: float
    due_date: Optional[datetime] = None
    description: Optional[str] = None
    is_recurring: bool = False
    frequency: Optional[str] = None


class BillingItemUpdate(BaseModel):
    label: Optional[str] = None
    amount: Optional[float] = None
    due_date: Optional[datetime] = None
    description: Optional[str] = None
    is_recurring: Optional[bool] = None
    frequency: Optional[str] = None


def _days_from_now(dt: datetime | None) -> int | None:
    if not dt:
        return None
    return int((dt - utcnow()).days)


async def _get_paid_one_time_fees(db: AsyncSession, tenant_id: str) -> set:
    paid = set()
    items = await find_all(
        db, Payment,
        Payment.tenant == tenant_id,
        Payment.payment_status == "completed",
        Payment.payment_type.in_(["caution_fee", "legal_fee", "initial", "bundle"]),
    )
    for p in items:
        if p.payment_type == "caution_fee":
            paid.add("caution_fee")
        if p.payment_type == "legal_fee":
            paid.add("legal_fee")
        meta = ((p.paystack_response or {}).get("data", {}).get("metadata", {}).get("billing_items", []))
        for item in meta:
            if item.get("type") == "caution_fee" or item.get("code") == "caution_fee":
                paid.add("caution_fee")
            if item.get("type") == "legal_fee" or item.get("code") == "legal_fee":
                paid.add("legal_fee")
    return paid


async def _build_tenant_detail(db: AsyncSession, tenant: Tenant) -> dict:
    unit = await db.get(Unit, tenant.unit) if tenant.unit else None
    estate = await db.get(Estate, tenant.estate) if tenant.estate else None
    _rate, _cycle, _start = estate_rent_config(estate)   # per-estate increase policy
    _start = resolve_increase_start(tenant, _start)      # tenant override wins over estate
    now  = utcnow()

    projected_due = project_next_due_date(tenant)
    due_in   = _days_from_now(projected_due)
    overdue  = due_in is not None and due_in < 0
    origin   = tenant.entry_date or tenant.created_at

    recurring = []
    if tenant.rent_amount > 0:
        eff_rent = get_current_rent(tenant.rent_amount, origin, False, _rate, _cycle, _start)
        recurring.append({"code": "rent", "label": "Rent",
                          "stored_amount": tenant.rent_amount, "effective_amount": eff_rent,
                          "is_increased": eff_rent > tenant.rent_amount,
                          "frequency": "monthly", "next_due_date": projected_due,
                          "days_until_due": due_in, "is_overdue": overdue})

    svc_base = tenant.service_charge_amount or (unit.service_charge_monthly if unit else 0) or 0
    if svc_base > 0:
        eff_svc = get_current_rent(svc_base, origin, False, _rate, _cycle, _start)
        recurring.append({"code": "service_charge", "label": "Service Charge",
                          "stored_amount": svc_base, "effective_amount": eff_svc,
                          "is_increased": eff_svc > svc_base,
                          "frequency": "monthly", "next_due_date": projected_due,
                          "days_until_due": due_in, "is_overdue": overdue})

    one_time  = []
    paid_fees = await _get_paid_one_time_fees(db, tenant.id)
    if unit and (unit.caution_fee or 0) > 0:
        eff = get_current_rent(unit.caution_fee, origin, False, _rate, _cycle, _start)
        is_paid = "caution_fee" in paid_fees
        one_time.append({"code": "caution_fee", "label": "Caution Fee", "amount": eff,
                         "is_paid": is_paid, "status": "paid" if is_paid else "unpaid"})
    if unit and (unit.legal_fee or 0) > 0:
        eff = get_current_rent(unit.legal_fee, origin, False, _rate, _cycle, _start)
        is_paid = "legal_fee" in paid_fees
        one_time.append({"code": "legal_fee", "label": "Legal Fee", "amount": eff,
                         "is_paid": is_paid, "status": "paid" if is_paid else "unpaid"})

    bill_docs = await find_all(db, BillingItem,
                               BillingItem.tenant == tenant.id, BillingItem.is_active == True,
                               order_by=BillingItem.due_date.asc())
    utility_bills = []
    for b in bill_docs:
        item_due = _days_from_now(b.due_date)
        is_overdue_item = not b.is_paid and b.due_date and (item_due or 0) < 0
        utility_bills.append({
            "id": b.id, "code": b.item_type, "label": b.label, "amount": b.amount,
            "due_date": b.due_date, "is_paid": b.is_paid, "is_overdue": is_overdue_item,
            "days_overdue": abs(item_due) if is_overdue_item else 0,
            "days_until_due": item_due if not b.is_paid else None,
            "is_recurring": b.is_recurring, "frequency": b.frequency, "description": b.description,
        })

    recurring_monthly = sum(r["effective_amount"] for r in recurring)
    unpaid_one_time   = sum(o["amount"] for o in one_time if not o["is_paid"])
    unpaid_utility    = sum(u["amount"] for u in utility_bills if not u["is_paid"])
    overdue_utility   = sum(u["amount"] for u in utility_bills if u["is_overdue"])
    overdue_recurring = recurring_monthly if overdue else 0

    requires_initial = False
    initial_payment  = None
    if tenant.tenant_type == "new":
        has_completed = await find_one(
            db, Payment,
            Payment.tenant == tenant.id,
            Payment.payment_status == "completed",
            Payment.payment_type.in_(["initial", "rent", "bundle"]),
        )
        if not has_completed:
            requires_initial = True
            rent_r  = calculate_effective_rent(tenant.rent_amount or 0, origin, 12, False, origin, _rate, _cycle, _start)
            svc_r   = calculate_effective_rent(svc_base, origin, 12, False, origin, _rate, _cycle, _start) if svc_base else {"total_amount": 0}
            rent_r6 = calculate_effective_rent(tenant.rent_amount or 0, origin, 6, False, origin, _rate, _cycle, _start)
            svc_r6  = calculate_effective_rent(svc_base, origin, 6, False, origin, _rate, _cycle, _start) if svc_base else {"total_amount": 0}
            c_amount = get_current_rent(unit.caution_fee if unit else 0, origin, False, _rate, _cycle, _start)
            l_amount = get_current_rent(unit.legal_fee if unit else 0, origin, False, _rate, _cycle, _start)
            fees = c_amount + l_amount
            initial_payment = {
                "rent_12_months": rent_r["total_amount"],
                "service_charge_12_months": svc_r["total_amount"],
                "rent_6_months": rent_r6["total_amount"],
                "service_charge_6_months": svc_r6["total_amount"],
                "caution_fee": c_amount, "legal_fee": l_amount,
                "total": rent_r["total_amount"] + svc_r["total_amount"] + fees,
                "total_6_months": rent_r6["total_amount"] + svc_r6["total_amount"] + fees,
            }

    return {
        "tenant": {
            "id": tenant.id, "name": tenant.tenant_name, "email": tenant.tenant_email,
            "phone": tenant.tenant_phone, "unit": tenant.unit_label or (unit.label if unit else None),
            "next_due_date": projected_due, "days_until_due": due_in,
            "is_overdue": overdue, "tenant_type": tenant.tenant_type, "status": tenant.status,
            "entry_date": tenant.entry_date,
            "auto_pay_enabled": bool(tenant.auto_pay_enabled),
        },
        "charges": {"recurring": recurring, "one_time": one_time, "utility_bills": utility_bills},
        "summary": {
            "recurring_monthly": recurring_monthly,
            "one_time_unpaid": unpaid_one_time, "utility_unpaid": unpaid_utility,
            "onboarding_outstanding": (tenant.rent_outstanding or 0) + (tenant.service_charge_outstanding or 0),
            "total_outstanding": unpaid_one_time + unpaid_utility + overdue_recurring +
                                 (tenant.rent_outstanding or 0) + (tenant.service_charge_outstanding or 0),
            "overdue_amount": overdue_utility + overdue_recurring, "is_overdue": overdue,
            "days_until_due": due_in,
            "requires_initial_payment": requires_initial, "initial_payment": initial_payment,
        },
    }


@router.get("/summary")
async def get_billing_summary(
    estate_id: Optional[str] = Query(None, alias="estateId"),
    tenant_id: Optional[str] = Query(None, alias="tenantId"),
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    role = user.role

    if role in TENANT_ROLES:
        tenant = await find_one(db, Tenant, Tenant.user == user.id, Tenant.is_active == True)
        if not tenant:
            raise HTTPException(status_code=404, detail="No active tenant profile found")
        detail = await _build_tenant_detail(db, tenant)
        return {"success": True, "view_as": "tenant", "data": detail}

    if role in ADMIN_ROLES and tenant_id:
        tenant = await find_one(db, Tenant, Tenant.id == tenant_id, Tenant.is_active == True)
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")
        await require_tenant_access(db, user, tenant)
        detail = await _build_tenant_detail(db, tenant)
        return {"success": True, "view_as": "admin_detail", "data": detail}

    if role in ADMIN_ROLES:
        # Cross-business isolation: restrict to estates the caller can access.
        allowed = await accessible_estate_ids(db, user)
        conditions = [Tenant.is_active == True]
        if allowed is not None:
            if not allowed:
                return {"success": True, "view_as": "admin_list",
                        "data": {"tenants": [],
                                 "summary": {"total_tenants": 0, "overdue_count": 0, "total_outstanding": 0}},
                        "pagination": {"current_page": page, "total_pages": 0, "total_items": 0}}
            conditions.append(Tenant.estate.in_(allowed))
        if estate_id:
            await require_estate_access(db, user, estate_id)
            conditions.append(Tenant.estate == estate_id)

        total = await count(db, Tenant, *conditions)
        skip = (page - 1) * limit
        tenants = await find_all(db, Tenant, *conditions,
                                 order_by=Tenant.tenant_name.asc(), skip=skip, limit=limit)

        now = utcnow()
        summaries, overdue_count, total_outstanding = [], 0, 0.0
        _cfg_cache: dict = {}

        for t in tenants:
            origin = t.entry_date or t.created_at
            due    = project_next_due_date(t)
            due_in = _days_from_now(due)
            overdue = due_in is not None and due_in < 0

            if t.estate not in _cfg_cache:
                _cfg_cache[t.estate] = estate_rent_config(await db.get(Estate, t.estate) if t.estate else None)
            _r, _c, _s = _cfg_cache[t.estate]
            _s = resolve_increase_start(t, _s)           # tenant override wins over estate
            eff_rent = get_current_rent(t.rent_amount, origin, False, _r, _c, _s)
            svc_base = t.service_charge_amount or 0
            eff_svc  = get_current_rent(svc_base, origin, False, _r, _c, _s) if svc_base else 0
            recurring_monthly = eff_rent + eff_svc

            bills = await find_all(db, BillingItem, BillingItem.tenant == t.id,
                                   BillingItem.is_active == True, BillingItem.is_paid == False)
            unpaid_utility  = sum(b.amount for b in bills)
            overdue_bills   = [b for b in bills if b.due_date and b.due_date < now]
            overdue_utility = sum(b.amount for b in overdue_bills)
            overdue_recurring = recurring_monthly if overdue else 0
            onboarding = (t.rent_outstanding or 0) + (t.service_charge_outstanding or 0)
            tenant_total = unpaid_utility + overdue_recurring + onboarding
            overdue_amount = overdue_utility + overdue_recurring

            if overdue or overdue_amount > 0:
                overdue_count += 1
            total_outstanding += tenant_total

            summaries.append({
                "id": t.id, "name": t.tenant_name, "email": t.tenant_email,
                "unit": t.unit_label, "next_due_date": due, "days_until_due": due_in,
                "is_overdue": overdue, "tenant_type": t.tenant_type, "status": t.status,
                "recurring_monthly": recurring_monthly,
                "onboarding_outstanding": onboarding, "unpaid_utility": unpaid_utility,
                "total_outstanding": tenant_total, "overdue_amount": overdue_amount,
            })

        if status == "overdue":
            summaries = [s for s in summaries if s["is_overdue"] or s["overdue_amount"] > 0]
        elif status == "unpaid":
            summaries = [s for s in summaries if s["total_outstanding"] > 0]

        return {"success": True, "view_as": "admin_list",
                "data": {"tenants": summaries,
                         "summary": {"total_tenants": total, "overdue_count": overdue_count,
                                     "total_outstanding": total_outstanding}},
                "pagination": {"current_page": page, "total_pages": -(-total // limit), "total_items": total}}

    raise HTTPException(status_code=403, detail="Access denied")


@router.post("/tenants/{tenant_id}/billing", status_code=201)
async def create_billing_item(
    tenant_id: str, body: BillingItemCreate,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    tenant = await find_one(db, Tenant, Tenant.id == tenant_id, Tenant.is_active == True)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    await require_tenant_access(db, user, tenant, write=True)
    item = BillingItem(
        id=gen_uuid(), user=tenant.user, tenant=tenant.id, estate=tenant.estate,
        item_type=body.item_type, label=body.label, amount=body.amount,
        due_date=body.due_date, description=body.description,
        is_recurring=body.is_recurring, frequency=body.frequency, created_by=user.id,
    )
    await save(db, item)
    return {"success": True, "message": "Billing item created successfully",
            "data": {"id": item.id, "label": item.label, "amount": item.amount}}


@router.get("/tenants/{tenant_id}/billing")
async def get_tenant_billing_items(
    tenant_id: str,
    include_inactive: bool = False, include_paid: bool = False,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    tenant = await find_one(db, Tenant, Tenant.id == tenant_id, Tenant.is_active == True)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    await require_tenant_access(db, user, tenant)
    conditions = [BillingItem.tenant == tenant.id]
    if not include_inactive:
        conditions.append(BillingItem.is_active == True)
    if not include_paid:
        conditions.append(BillingItem.is_paid == False)
    items = await find_all(db, BillingItem, *conditions, order_by=BillingItem.due_date.asc())
    return {"success": True, "count": len(items),
            "data": [{"id": i.id, "label": i.label, "amount": i.amount, "due_date": i.due_date,
                      "is_paid": i.is_paid, "item_type": i.item_type} for i in items]}


@router.put("/{item_id}")
async def update_billing_item(
    item_id: str, body: BillingItemUpdate,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    item = await find_one(db, BillingItem, BillingItem.id == item_id, BillingItem.is_active == True)
    if not item:
        raise HTTPException(status_code=404, detail="Billing item not found")
    await require_estate_access(db, user, item.estate)
    if item.is_paid:
        raise HTTPException(status_code=400, detail="Cannot update a paid billing item")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(item, k, v)
    item.updated_by = user.id
    item.updated_at = utcnow()
    await save(db, item)
    return {"success": True, "message": "Billing item updated"}


@router.delete("/{item_id}")
async def delete_billing_item(
    item_id: str,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    item = await find_one(db, BillingItem, BillingItem.id == item_id, BillingItem.is_active == True)
    if not item:
        raise HTTPException(status_code=404, detail="Billing item not found")
    await require_estate_access(db, user, item.estate)
    if item.is_paid:
        raise HTTPException(status_code=400, detail="Cannot delete a paid billing item")
    item.is_active = False
    item.updated_by = user.id
    item.updated_at = utcnow()
    await save(db, item)
    return {"success": True, "message": "Billing item deleted"}
