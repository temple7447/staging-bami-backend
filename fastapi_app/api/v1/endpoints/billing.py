import asyncio
from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime
from bson import ObjectId
from typing import Optional

from models.user import User
from models.tenant import Tenant
from models.billing_item import BillingItem
from models.payment import Payment
from models.estate import Estate
from schemas.billing import BillingItemCreate, BillingItemUpdate
from core.security import get_current_user
from utils.tenant_helpers import project_next_due_date
from utils.rent_calculator import get_current_rent

router = APIRouter(prefix="/billing", tags=["Billing"])

ADMIN_ROLES  = {"super_admin", "admin", "super_manager", "business_owner", "manager"}
TENANT_ROLES = {"tenant", "user"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _days_from_now(dt: datetime | None) -> int | None:
    if not dt:
        return None
    return int((dt - datetime.utcnow()).days)


async def _get_paid_one_time_fees(tenant_id) -> set:
    pcoll = Payment.get_motor_collection()
    paid = set()
    docs = await pcoll.find({
        "tenant": tenant_id,
        "payment_status": "completed",
        "payment_type": {"$in": ["caution_fee", "legal_fee", "initial", "bundle"]}
    }).to_list(None)
    for p in docs:
        if p.get("payment_type") == "caution_fee": paid.add("caution_fee")
        if p.get("payment_type") == "legal_fee":   paid.add("legal_fee")
        items = (p.get("paystack_response") or {}).get("data", {}).get("metadata", {}).get("billing_items", [])
        for item in items:
            if item.get("type") == "caution_fee" or item.get("code") == "caution_fee": paid.add("caution_fee")
            if item.get("type") == "legal_fee"   or item.get("code") == "legal_fee":   paid.add("legal_fee")
    return paid


async def _build_tenant_detail(tenant: Tenant) -> dict:
    from models.unit import Unit
    unit = await Unit.get(str(tenant.unit)) if tenant.unit else None
    now  = datetime.utcnow()

    projected_due = project_next_due_date(tenant)
    due_in   = _days_from_now(projected_due)
    overdue  = due_in is not None and due_in < 0
    origin   = tenant.entry_date or tenant.created_at

    # Recurring
    recurring = []
    if tenant.rent_amount > 0:
        eff_rent = get_current_rent(tenant.rent_amount, origin, False)
        recurring.append({"code": "rent", "label": "Rent",
                           "stored_amount": tenant.rent_amount, "effective_amount": eff_rent,
                           "is_increased": eff_rent > tenant.rent_amount,
                           "frequency": "monthly", "next_due_date": projected_due,
                           "days_until_due": due_in, "is_overdue": overdue})

    svc_base = tenant.service_charge_amount or (unit.service_charge_monthly if unit else 0) or 0
    if svc_base > 0:
        eff_svc = get_current_rent(svc_base, origin, False)
        recurring.append({"code": "service_charge", "label": "Service Charge",
                           "stored_amount": svc_base, "effective_amount": eff_svc,
                           "is_increased": eff_svc > svc_base,
                           "frequency": "monthly", "next_due_date": projected_due,
                           "days_until_due": due_in, "is_overdue": overdue})

    # One-time fees
    one_time = []
    paid_fees = await _get_paid_one_time_fees(tenant.id)
    if unit and (unit.caution_fee or 0) > 0:
        eff = get_current_rent(unit.caution_fee, origin, False)
        is_paid = "caution_fee" in paid_fees
        one_time.append({"code": "caution_fee", "label": "Caution Fee",
                          "amount": eff, "is_paid": is_paid,
                          "status": "paid" if is_paid else "unpaid"})
    if unit and (unit.legal_fee or 0) > 0:
        eff = get_current_rent(unit.legal_fee, origin, False)
        is_paid = "legal_fee" in paid_fees
        one_time.append({"code": "legal_fee", "label": "Legal Fee",
                          "amount": eff, "is_paid": is_paid,
                          "status": "paid" if is_paid else "unpaid"})

    # Admin-created billing items
    bcoll = BillingItem.get_motor_collection()
    bill_docs = await bcoll.find({"tenant": tenant.id, "is_active": True}).sort("due_date", 1).to_list(None)
    utility_bills = []
    for b in bill_docs:
        item_due = _days_from_now(b.get("due_date"))
        is_overdue_item = not b.get("is_paid") and b.get("due_date") and (item_due or 0) < 0
        utility_bills.append({
            "id":           str(b["_id"]),
            "code":         b.get("item_type"),
            "label":        b.get("label"),
            "amount":       b.get("amount", 0),
            "due_date":     b.get("due_date"),
            "is_paid":      b.get("is_paid", False),
            "is_overdue":   is_overdue_item,
            "days_overdue": abs(item_due) if is_overdue_item else 0,
            "days_until_due": item_due if not b.get("is_paid") else None,
            "is_recurring": b.get("is_recurring", False),
            "frequency":    b.get("frequency"),
            "description":  b.get("description"),
        })

    # Summaries
    recurring_monthly = sum(r["effective_amount"] for r in recurring)
    unpaid_one_time   = sum(o["amount"] for o in one_time if not o["is_paid"])
    unpaid_utility    = sum(u["amount"] for u in utility_bills if not u["is_paid"])
    overdue_utility   = sum(u["amount"] for u in utility_bills if u["is_overdue"])
    overdue_recurring = recurring_monthly if overdue else 0

    # Initial payment check (new tenants)
    requires_initial = False
    initial_payment  = None
    if tenant.tenant_type == "new":
        pcoll = Payment.get_motor_collection()
        has_completed = await pcoll.find_one({"tenant": tenant.id, "payment_status": "completed",
                                               "payment_type": {"$in": ["initial", "rent", "bundle"]}})
        if not has_completed:
            from utils.rent_calculator import calculate_effective_rent
            requires_initial = True
            rent_r   = calculate_effective_rent(tenant.rent_amount or 0, origin, 12, False, origin)
            svc_r    = calculate_effective_rent(svc_base, origin, 12, False, origin) if svc_base else {"total_amount": 0}
            c_amount = get_current_rent(unit.caution_fee if unit else 0, origin, False)
            l_amount = get_current_rent(unit.legal_fee if unit else 0, origin, False)
            initial_payment = {
                "rent_12_months":        rent_r["total_amount"],
                "service_charge_12_months": svc_r["total_amount"],
                "caution_fee":           c_amount,
                "legal_fee":             l_amount,
                "total": rent_r["total_amount"] + svc_r["total_amount"] + c_amount + l_amount,
                "note": "New tenant: 12-month rent + one-time fees required as initial payment",
            }

    return {
        "tenant": {
            "id":          str(tenant.id),
            "name":        tenant.tenant_name,
            "email":       tenant.tenant_email,
            "phone":       tenant.tenant_phone,
            "unit":        tenant.unit_label or (unit.label if unit else None),
            "next_due_date": projected_due,
            "days_until_due": due_in,
            "is_overdue":  overdue,
            "tenant_type": tenant.tenant_type,
            "status":      tenant.status,
            "entry_date":  tenant.entry_date,
        },
        "charges": {"recurring": recurring, "one_time": one_time, "utility_bills": utility_bills},
        "summary": {
            "recurring_monthly":        recurring_monthly,
            "one_time_unpaid":          unpaid_one_time,
            "utility_unpaid":           unpaid_utility,
            "onboarding_outstanding":   (tenant.rent_outstanding or 0) + (tenant.service_charge_outstanding or 0),
            "total_outstanding":        unpaid_one_time + unpaid_utility + overdue_recurring +
                                        (tenant.rent_outstanding or 0) + (tenant.service_charge_outstanding or 0),
            "overdue_amount":           overdue_utility + overdue_recurring,
            "is_overdue":               overdue,
            "days_until_due":           due_in,
            "requires_initial_payment": requires_initial,
            "initial_payment":          initial_payment,
        },
    }


# ── Billing Summary (unified) ─────────────────────────────────────────────────

@router.get("/summary")
async def get_billing_summary(
    estate_id: Optional[str] = None,
    tenant_id: Optional[str] = None,
    status:    Optional[str] = None,
    page:      int = 1,
    limit:     int = 20,
    user: User = Depends(get_current_user),
):
    role = user.role

    # ── Tenant: own billing ───────────────────────────────────────────────────
    if role in TENANT_ROLES:
        tenant = await Tenant.find_one({"user": user.id, "is_active": True})
        if not tenant:
            raise HTTPException(status_code=404, detail="No active tenant profile found")
        detail = await _build_tenant_detail(tenant)
        return {"success": True, "view_as": "tenant", "data": detail}

    # ── Admin: single-tenant detail ───────────────────────────────────────────
    if role in ADMIN_ROLES and tenant_id:
        tenant = await Tenant.find_one({"_id": ObjectId(tenant_id), "is_active": True})
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")
        detail = await _build_tenant_detail(tenant)
        return {"success": True, "view_as": "admin_detail", "data": detail}

    # ── Admin: estate-level list ──────────────────────────────────────────────
    if role in ADMIN_ROLES:
        estate_filter: dict = {}
        if role == "super_admin":
            if estate_id:
                estate_filter["estate"] = ObjectId(estate_id)
        else:
            allowed = getattr(user, "assigned_estates", []) or []
            if not allowed and not estate_id:
                raise HTTPException(status_code=400, detail="No estates assigned. Provide estateId.")
            estate_filter["estate"] = ObjectId(estate_id) if estate_id else {"$in": allowed}

        q = {**estate_filter, "is_active": True}
        tcoll  = Tenant.get_motor_collection()
        total  = await tcoll.count_documents(q)
        skip   = (page - 1) * limit
        docs   = await tcoll.find(q).sort("tenant_name", 1).skip(skip).limit(limit).to_list(limit)

        if not docs:
            return {"success": True, "view_as": "admin_list",
                    "data": {"tenants": [], "summary": {"total_tenants": 0, "overdue_count": 0, "total_outstanding": 0}},
                    "pagination": {"current_page": page, "total_pages": 0, "total_items": 0}}

        # Batch-fetch billing items and payments
        tid_list = [d["_id"] for d in docs]
        bcoll    = BillingItem.get_motor_collection()
        pcoll    = Payment.get_motor_collection()
        all_bills, all_pmts = await asyncio.gather(
            bcoll.find({"tenant": {"$in": tid_list}, "is_active": True, "is_paid": False},
                       {"tenant": 1, "amount": 1, "due_date": 1}).to_list(None),
            pcoll.find({"tenant": {"$in": tid_list}, "payment_status": "completed",
                        "payment_type": {"$in": ["caution_fee", "legal_fee", "initial", "bundle"]}},
                       {"tenant": 1, "payment_type": 1, "paystack_response": 1}).to_list(None),
        )

        bills_by_tid: dict = {}
        for b in all_bills:
            k = str(b["tenant"]); bills_by_tid.setdefault(k, []).append(b)

        paid_by_tid: dict = {}
        for p in all_pmts:
            k  = str(p["tenant"]); paid_by_tid.setdefault(k, set())
            pt = p.get("payment_type")
            if pt == "caution_fee": paid_by_tid[k].add("caution_fee")
            if pt == "legal_fee":   paid_by_tid[k].add("legal_fee")

        now = datetime.utcnow()
        summaries, overdue_count, total_outstanding = [], 0, 0.0

        for doc in docs:
            t   = Tenant.model_validate(doc)
            origin = t.entry_date or t.created_at
            due = project_next_due_date(t)
            due_in  = _days_from_now(due)
            overdue = due_in is not None and due_in < 0

            eff_rent = get_current_rent(t.rent_amount, origin, False)
            svc_base = t.service_charge_amount or 0
            eff_svc  = get_current_rent(svc_base, origin, False) if svc_base else 0
            recurring_monthly = eff_rent + eff_svc

            paid = paid_by_tid.get(str(t.id), set())
            tenant_bills  = bills_by_tid.get(str(t.id), [])
            unpaid_utility = sum(b["amount"] for b in tenant_bills)
            overdue_bills  = [b for b in tenant_bills if b.get("due_date") and b["due_date"] < now]
            overdue_utility = sum(b["amount"] for b in overdue_bills)

            overdue_recurring   = recurring_monthly if overdue else 0
            onboarding_outstanding = (t.rent_outstanding or 0) + (t.service_charge_outstanding or 0)
            tenant_total_outstanding = unpaid_utility + overdue_recurring + onboarding_outstanding
            overdue_amount = overdue_utility + overdue_recurring

            if overdue or overdue_amount > 0: overdue_count += 1
            total_outstanding += tenant_total_outstanding

            summaries.append({
                "id": str(t.id), "name": t.tenant_name, "email": t.tenant_email,
                "unit": t.unit_label, "next_due_date": due, "days_until_due": due_in,
                "is_overdue": overdue, "tenant_type": t.tenant_type, "status": t.status,
                "recurring_monthly": recurring_monthly,
                "onboarding_outstanding": onboarding_outstanding,
                "unpaid_utility": unpaid_utility,
                "total_outstanding": tenant_total_outstanding,
                "overdue_amount": overdue_amount,
            })

        if status == "overdue":
            summaries = [s for s in summaries if s["is_overdue"] or s["overdue_amount"] > 0]
        elif status == "unpaid":
            summaries = [s for s in summaries if s["total_outstanding"] > 0]

        return {"success": True, "view_as": "admin_list",
                "data": {"tenants": summaries,
                          "summary": {"total_tenants": total, "overdue_count": overdue_count, "total_outstanding": total_outstanding}},
                "pagination": {"current_page": page, "total_pages": -(-total // limit), "total_items": total}}

    raise HTTPException(status_code=403, detail="Access denied")


# ── Admin billing item CRUD ───────────────────────────────────────────────────

@router.post("/tenants/{tenant_id}/billing", status_code=201)
async def create_billing_item(tenant_id: str, body: BillingItemCreate, user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    tenant = await Tenant.find_one({"_id": ObjectId(tenant_id), "is_active": True})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    item = BillingItem(
        user=tenant.user,
        tenant=tenant.id,
        estate=tenant.estate,
        item_type=body.item_type,
        label=body.label,
        amount=body.amount,
        due_date=body.due_date,
        description=body.description,
        is_recurring=body.is_recurring,
        frequency=body.frequency,
        created_by=user.id,
    )
    await item.insert()
    return {"success": True, "message": "Billing item created successfully", "data": item.model_dump()}


@router.get("/tenants/{tenant_id}/billing")
async def get_tenant_billing_items(
    tenant_id:       str,
    include_inactive: bool = False,
    include_paid:     bool = False,
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    tenant = await Tenant.find_one({"_id": ObjectId(tenant_id), "is_active": True})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    q: dict = {"tenant": tenant.id}
    if not include_inactive: q["is_active"] = True
    if not include_paid:     q["is_paid"]   = False

    coll  = BillingItem.get_motor_collection()
    items = await coll.find(q).sort([("due_date", 1), ("created_at", -1)]).to_list(None)
    return {"success": True, "count": len(items), "data": items}


@router.put("/{item_id}")
async def update_billing_item(item_id: str, body: BillingItemUpdate, user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    item = await BillingItem.get(item_id)
    if not item or not item.is_active:
        raise HTTPException(status_code=404, detail="Billing item not found")
    if item.is_paid:
        raise HTTPException(status_code=400, detail="Cannot update a paid billing item")

    for field, val in body.model_dump(exclude_none=True).items():
        setattr(item, field, val)
    item.updated_by = user.id
    item.updated_at = datetime.utcnow()
    await item.save()
    return {"success": True, "message": "Billing item updated successfully", "data": item.model_dump()}


@router.delete("/{item_id}")
async def delete_billing_item(item_id: str, user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    item = await BillingItem.get(item_id)
    if not item or not item.is_active:
        raise HTTPException(status_code=404, detail="Billing item not found")
    if item.is_paid:
        raise HTTPException(status_code=400, detail="Cannot delete a paid billing item")

    item.is_active  = False
    item.updated_by = user.id
    item.updated_at = datetime.utcnow()
    await item.save()
    return {"success": True, "message": "Billing item deleted successfully"}


