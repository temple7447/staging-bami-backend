from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, func
from typing import Optional
from datetime import datetime, timedelta
import cloudinary, cloudinary.uploader

from models.tenant import Tenant
from models.user import User
from models.unit import Unit
from models.estate import Estate
from models.payment import Payment
from models.wallet import Wallet
from models.transaction import Transaction
from models.billing_item import BillingItem
from schemas.tenant import TenantCreate, TenantUpdate, HistoryCreate, TransactionCreate, PayBillingItemsRequest
from core.security import get_current_user, hash_password
from core.database import get_db
from core.db_helpers import find_one, find_all, save, count, sum_col
from core.config import settings
from utils.tenant_helpers import parse_flexible_date, generate_temp_password, process_tenant, project_next_due_date
from utils.rent_calculator import get_current_rent, calculate_effective_rent
from models.base import gen_uuid

router = APIRouter(prefix="/tenants", tags=["Tenants"])

ADMIN_ROLES = {"super_admin", "admin", "super_manager", "business_owner", "manager"}


async def _get_tenant_or_404(db: AsyncSession, tenant_id: str) -> Tenant:
    t = await find_one(db, Tenant, Tenant.id == tenant_id, Tenant.is_active == True)
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return t


async def _reconcile_next_due_date(db: AsyncSession, tenant: Tenant) -> datetime | None:
    payments = await find_all(
        db, Payment,
        Payment.tenant == tenant.id, Payment.payment_status == "completed",
        Payment.payment_type.in_(["rent", "service_charge", "bundle", "initial"]),
        order_by=Payment.created_at.desc(),
    )
    if not payments:
        return None
    latest = tenant.next_due_date
    for p in payments:
        meta = ((p.paystack_response or {}).get("data", {}).get("metadata", {}))
        duration = meta.get("duration_months", 12)
        base = p.created_at or datetime.utcnow()
        candidate = base.replace(day=tenant.entry_date.day if tenant.entry_date else base.day)
        for _ in range(duration):
            m = candidate.month + 1 if candidate.month < 12 else 1
            y = candidate.year if candidate.month < 12 else candidate.year + 1
            candidate = candidate.replace(year=y, month=m)
        if not latest or candidate > latest:
            latest = candidate
    return latest


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_tenant(
    body: TenantCreate,
    estate_id: Optional[str] = Query(None, alias="estateId"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not estate_id:
        raise HTTPException(status_code=400, detail="estateId is required")
    estate = await find_one(db, Estate, Estate.id == estate_id, Estate.is_active == True)
    if not estate:
        raise HTTPException(status_code=404, detail="Estate not found")
    unit = await find_one(db, Unit, Unit.id == body.unit_id, Unit.estate == estate_id, Unit.is_active == True)
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found in this estate")
    if unit.status == "occupied":
        raise HTTPException(status_code=409, detail="This unit is already occupied")

    full_name   = (body.tenant_name or "").strip() or " ".join(filter(None, [body.first_name, body.other_names, body.surname])).strip()
    email_addr  = (body.tenant_email or body.email or "").strip()
    phone       = body.tenant_phone or body.whatsapp or ""
    tenant_type = body.tenant_type or "new"

    duration = body.duration_months
    if tenant_type == "new":
        duration = duration if duration is not None else 12
        if duration < 12:
            raise HTTPException(status_code=400, detail="New tenants require minimum 12-month contract")
    else:
        if duration is not None and duration < 6:
            raise HTTPException(status_code=400, detail="Minimum 6 months payment required for renewals")
    if duration is not None and duration > 12:
        raise HTTPException(status_code=400, detail="System does not accept payments for more than 12 months")

    parsed_entry = parse_flexible_date(body.entry_date)
    parsed_next  = parse_flexible_date(body.next_due_date)
    today = datetime.utcnow()

    if parsed_next:
        effective_next = parsed_next
    elif tenant_type != "new" and parsed_entry:
        base = datetime(parsed_entry.year, parsed_entry.month, parsed_entry.day)
        while base <= today:
            base = base.replace(year=base.year + 1)
        effective_next = base
    else:
        raw = parsed_entry or today
        effective_next = datetime(raw.year, raw.month, raw.day)

    user_id, generated_password = None, None
    if email_addr:
        existing_user = await find_one(db, User, User.email == email_addr)
        if existing_user:
            if existing_user.role != "tenant":
                raise HTTPException(status_code=400, detail=f"Email registered as {existing_user.role}")
            user_id = existing_user.id
            generated_password = generate_temp_password(6)
            existing_user.password = hash_password(generated_password)
            existing_user.is_active = True
            await save(db, existing_user)
        else:
            generated_password = generate_temp_password(6)
            new_user = User(id=gen_uuid(), name=full_name or "Tenant", email=email_addr,
                            password=hash_password(generated_password), role="tenant",
                            created_by=user.id, email_verified=True)
            await save(db, new_user)
            wallet = Wallet(id=gen_uuid(), user_id=new_user.id, balance=0.0, currency="NGN")
            await save(db, wallet)
            user_id = new_user.id

    # Displace existing tenants in this unit
    displaced = await find_all(db, Tenant, Tenant.estate == estate_id, Tenant.unit_label == unit.label, Tenant.is_active == True)
    for d in displaced:
        d.is_active = False
        d.status = "vacant"
        d.updated_by = user.id
        await save(db, d)
        if d.user:
            u = await db.get(User, d.user)
            if u:
                u.is_active = False
                await save(db, u)

    tenant = Tenant(
        id=gen_uuid(), estate=estate_id, unit=body.unit_id, unit_label=unit.label,
        tenant_name=full_name, tenant_email=email_addr or None, tenant_phone=phone or None,
        rent_amount=unit.monthly_price, base_rent=unit.monthly_price,
        service_charge_amount=unit.service_charge_monthly or 0, base_service_charge=unit.service_charge_monthly or 0,
        tenant_type=tenant_type, electric_meter_number=unit.meter_number or "",
        entry_date=parsed_entry or today, next_due_date=effective_next,
        status="occupied", user=user_id,
        rent_outstanding=max(0, body.rent_outstanding or 0),
        service_charge_outstanding=max(0, body.service_charge_outstanding or 0),
        history=[{"event": "created", "note": "Tenant record created",
                  "meta": {"unit_id": body.unit_id, "unit_label": unit.label},
                  "created_by": user.id, "created_at": today.isoformat()}],
        created_by=user.id,
    )
    await save(db, tenant)

    unit.status = "occupied"
    unit.occupied_by = tenant.id
    unit.occupied_since = parsed_entry or today
    unit.updated_by = user.id
    await save(db, unit)

    return {"success": True, "message": "Tenant created successfully",
            "data": {"id": tenant.id, "temp_password": generated_password}}


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("")
async def list_tenants(
    estate_id: Optional[str] = Query(None, alias="estateId"),
    page: int = 1, limit: int = 20,
    search: Optional[str] = None,
    quarter: Optional[str] = None,
    view: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conditions = [Tenant.is_active == True]
    if estate_id:
        conditions.append(Tenant.estate == estate_id)
    if search:
        conditions.append(or_(
            Tenant.tenant_name.ilike(f"%{search}%"),
            Tenant.tenant_email.ilike(f"%{search}%"),
            Tenant.tenant_phone.ilike(f"%{search}%"),
        ))

    q = (quarter or "").upper()
    is_quarterly = view == "quarterly" or q in ("Q1", "Q2", "Q3", "Q4")

    if is_quarterly:
        all_tenants = await find_all(db, Tenant, *conditions, order_by=Tenant.next_due_date.asc())
        month_names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
        quarters: dict = {
            "Q1": {"Jan": [], "Feb": [], "Mar": []},
            "Q2": {"Apr": [], "May": [], "Jun": []},
            "Q3": {"Jul": [], "Aug": [], "Sep": []},
            "Q4": {"Oct": [], "Nov": [], "Dec": []},
        }
        total_monthly = 0
        for t in all_tenants:
            computed = process_tenant(t)
            due = computed.get("next_due_date")
            if not due:
                continue
            mi  = due.month - 1
            mn  = month_names[mi]
            qk  = f"Q{mi // 3 + 1}"
            if mn in quarters.get(qk, {}):
                quarters[qk][mn].append({**t.__dict__, **computed})
                total_monthly += computed.get("total_monthly_fees", 0)

        return {"success": True,
                "data": quarters[q] if q in quarters else quarters,
                "summary": {"tenant_count": len(all_tenants), "total_monthly_rent": total_monthly, "currency": "NGN"}}

    total = await count(db, Tenant, *conditions)
    skip  = (page - 1) * limit
    tenants = await find_all(db, Tenant, *conditions, order_by=Tenant.next_due_date.asc(), skip=skip, limit=limit)
    items = [{**t.__dict__, **process_tenant(t)} for t in tenants]
    return {"success": True, "data": items,
            "pagination": {"currentPage": page, "totalPages": -(-total // limit), "totalItems": total}}


# ── Self (/me) ────────────────────────────────────────────────────────────────

@router.get("/me")
async def get_my_tenant(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    tenant = await find_one(db, Tenant, Tenant.user == user.id, Tenant.is_active == True)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant record not found for this user")
    computed = process_tenant(tenant)
    return {"success": True, "data": {**{c.key: getattr(tenant, c.key) for c in tenant.__table__.columns}, **computed}}


@router.get("/me/history")
async def list_my_history(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    tenant = await find_one(db, Tenant, Tenant.user == user.id, Tenant.is_active == True)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant record not found")
    return {"success": True, "data": list(reversed(tenant.history or []))}


@router.get("/me/billing")
async def get_my_billing_items(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    tenant = await find_one(db, Tenant, Tenant.user == user.id, Tenant.is_active == True)
    recurring, one_time = [], []
    if tenant:
        unit   = await db.get(Unit, tenant.unit) if tenant.unit else None
        origin = tenant.entry_date or tenant.created_at
        dynamic_rent    = get_current_rent(tenant.rent_amount, origin, False)
        dynamic_service = get_current_rent(tenant.service_charge_amount or 0, origin, False)
        if dynamic_rent > 0:
            recurring.insert(0, {"code": "rent", "label": "Rent", "amount": dynamic_rent,
                                  "due_date": tenant.next_due_date, "type": "recurring", "frequency": "monthly"})
        if dynamic_service > 0:
            recurring.append({"code": "service_charge", "label": "Service Charge", "amount": dynamic_service,
                               "due_date": tenant.next_due_date, "type": "recurring", "frequency": "monthly"})
        if (tenant.rent_outstanding or 0) > 0:
            one_time.insert(0, {"code": "outstanding_rent", "label": "Outstanding Rent Balance",
                                 "amount": tenant.rent_outstanding, "type": "one_time", "frequency": "once"})
        if (tenant.service_charge_outstanding or 0) > 0:
            one_time.append({"code": "outstanding_service_charge", "label": "Outstanding Service Charge Balance",
                              "amount": tenant.service_charge_outstanding, "type": "one_time", "frequency": "once"})
        if unit and tenant.tenant_type not in ("existing", "transfer"):
            if (unit.caution_fee or 0) > 0:
                paid = await find_one(db, Payment, Payment.tenant == tenant.id,
                                      Payment.payment_status == "completed", Payment.payment_type == "caution_fee")
                if not paid:
                    one_time.append({"code": "caution_fee", "label": "Caution Fee", "amount": unit.caution_fee, "type": "one_time"})
            if (unit.legal_fee or 0) > 0:
                paid = await find_one(db, Payment, Payment.tenant == tenant.id,
                                      Payment.payment_status == "completed", Payment.payment_type == "legal_fee")
                if not paid:
                    one_time.append({"code": "legal_fee", "label": "Legal Fee", "amount": unit.legal_fee, "type": "one_time"})
    return {"success": True, "data": {"recurring": recurring, "one_time": one_time, "optional": []}}


@router.get("/me/transactions")
async def list_my_transactions(
    page: int = 1, limit: int = 20,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    tenant = await find_one(db, Tenant, Tenant.user == user.id, Tenant.is_active == True)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant record not found")
    total = await count(db, Transaction, Transaction.user == user.id)
    skip  = (page - 1) * limit
    items = await find_all(db, Transaction, Transaction.user == user.id,
                           order_by=Transaction.created_at.desc(), skip=skip, limit=limit)
    return {"success": True, "count": total, "data": [
        {"id": t.id, "amount": t.amount, "type": t.type, "method": t.method,
         "status": t.status, "reference": t.reference, "created_at": t.created_at}
        for t in items
    ]}


@router.post("/me/billing/pay")
async def pay_billing_items(
    body: PayBillingItemsRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if body.duration_months not in (6, 12):
        raise HTTPException(status_code=400, detail="Payment duration must be 6 or 12 months")
    tenant = await find_one(db, Tenant, Tenant.user == user.id, Tenant.is_active == True)
    wallet = await find_one(db, Wallet, Wallet.user_id == user.id)
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")
    origin = tenant.entry_date if tenant else datetime.utcnow()
    items_to_process, total_amount = [], 0.0
    for item_id in body.item_ids:
        if item_id == "rent" and tenant and tenant.rent_amount > 0:
            result = calculate_effective_rent(tenant.rent_amount, tenant.entry_date or datetime.utcnow(), body.duration_months, False, origin)
            total_amount += result["total_amount"]
            items_to_process.append({"code": "rent", "amount": result["total_amount"], "duration": body.duration_months})
        elif item_id == "service_charge" and tenant:
            base = tenant.service_charge_amount or 0
            if base > 0:
                result = calculate_effective_rent(base, origin, body.duration_months, False, origin)
                total_amount += result["total_amount"]
                items_to_process.append({"code": "service_charge", "amount": result["total_amount"]})
        elif item_id == "outstanding_rent" and tenant and (tenant.rent_outstanding or 0) > 0:
            total_amount += tenant.rent_outstanding
            items_to_process.append({"code": "outstanding_rent", "amount": tenant.rent_outstanding})
        elif item_id == "outstanding_service_charge" and tenant and (tenant.service_charge_outstanding or 0) > 0:
            total_amount += tenant.service_charge_outstanding
            items_to_process.append({"code": "outstanding_service_charge", "amount": tenant.service_charge_outstanding})
    if not items_to_process:
        raise HTTPException(status_code=400, detail="No valid billing items found")
    if total_amount <= 0:
        raise HTTPException(status_code=400, detail="Total amount must be greater than zero")
    if wallet.balance < total_amount:
        raise HTTPException(status_code=400, detail=f"Insufficient wallet balance. Have: {wallet.balance}, need: {total_amount}")

    wallet.balance    -= total_amount
    wallet.total_spent += total_amount
    wallet.updated_at  = datetime.utcnow()
    await save(db, wallet)

    payment = Payment(
        id=gen_uuid(), tenant=tenant.id if tenant else None, amount=total_amount,
        payment_type="bundle" if len(items_to_process) > 1 else items_to_process[0]["code"],
        payment_status="completed", created_by=user.id,
    )
    await save(db, payment)

    if tenant:
        if any(i["code"] == "rent" for i in items_to_process):
            base = tenant.next_due_date or tenant.entry_date or datetime.utcnow()
            new_due = base
            for _ in range(body.duration_months):
                m = (new_due.month % 12) + 1
                y = new_due.year + (1 if new_due.month == 12 else 0)
                new_due = new_due.replace(year=y, month=m)
            tenant.next_due_date = new_due
        if any(i["code"] == "outstanding_rent" for i in items_to_process):
            tenant.rent_outstanding = 0
        if any(i["code"] == "outstanding_service_charge" for i in items_to_process):
            tenant.service_charge_outstanding = 0
        tenant.updated_at = datetime.utcnow()
        await save(db, tenant)

    return {"success": True, "message": "Payment processed successfully",
            "data": {"total_paid": total_amount, "items": items_to_process, "wallet_balance": wallet.balance}}


@router.post("/me/avatar")
async def upload_my_avatar(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    tenant = await find_one(db, Tenant, Tenant.user == user.id, Tenant.is_active == True)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant record not found")
    data   = await file.read()
    result = cloudinary.uploader.upload(data, folder="bamihustle/avatars", resource_type="image")
    tenant.profile_image_url       = result["secure_url"]
    tenant.profile_image_public_id = result["public_id"]
    tenant.updated_at              = datetime.utcnow()
    await save(db, tenant)
    return {"success": True, "data": {"url": tenant.profile_image_url}}


# ── Single tenant CRUD ────────────────────────────────────────────────────────

@router.get("/{tenant_id}")
async def get_tenant(
    tenant_id: str,
    expand: Optional[str] = None,
    page: int = 1, limit: int = 10,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    tenant = await _get_tenant_or_404(db, tenant_id)
    unit   = await db.get(Unit, tenant.unit) if tenant.unit else None
    origin = tenant.entry_date or tenant.created_at
    rent_base = tenant.base_rent or tenant.rent_amount
    svc_base  = tenant.base_service_charge or tenant.service_charge_amount or 0
    is_new    = tenant.tenant_type == "new"
    current_rent    = get_current_rent(rent_base, origin, False)
    current_service = get_current_rent(svc_base, origin, False)
    current_caution = get_current_rent(unit.caution_fee if unit else 0, origin, False) if is_new else 0
    current_legal   = get_current_rent(unit.legal_fee if unit else 0, origin, False) if is_new else 0

    payments_by_type = {}
    total_paid = 0.0
    completed = await find_all(db, Payment, Payment.tenant == tenant.id, Payment.payment_status == "completed")
    for p in completed:
        ptype = p.payment_type or "other"
        if ptype not in payments_by_type:
            payments_by_type[ptype] = {"total": 0.0, "count": 0, "last_payment": None}
        payments_by_type[ptype]["total"] += p.amount
        payments_by_type[ptype]["count"] += 1
        if not payments_by_type[ptype]["last_payment"] or p.created_at > payments_by_type[ptype]["last_payment"]:
            payments_by_type[ptype]["last_payment"] = p.created_at
        total_paid += p.amount

    final_caution = current_caution if is_new and not payments_by_type.get("caution_fee") else 0
    final_legal   = current_legal   if is_new and not payments_by_type.get("legal_fee")   else 0

    corrected = await _reconcile_next_due_date(db, tenant)
    if corrected:
        tenant.next_due_date = corrected
    renewal_start = project_next_due_date(tenant) or tenant.next_due_date or datetime.utcnow()
    billing_start = renewal_start.replace(year=renewal_start.year - 1)
    y1_rent = calculate_effective_rent(rent_base, billing_start, 12, False, origin)
    y1_svc  = calculate_effective_rent(svc_base, billing_start, 12, False, origin)
    y2_rent = calculate_effective_rent(rent_base, renewal_start, 12, False, origin)
    y2_svc  = calculate_effective_rent(svc_base, renewal_start, 12, False, origin)
    ref_date = tenant.entry_date or tenant.created_at
    lease_months = max(0, (renewal_start.year - ref_date.year) * 12 + (renewal_start.month - ref_date.month)) if ref_date else 0

    overview = {
        "rent": current_rent, "service_charge": current_service,
        "caution_fee": final_caution, "legal_fee": final_legal,
        "lease_duration_months": lease_months, "next_due": renewal_start,
        "entry_date": tenant.entry_date, "status": tenant.status, "tenant_type": tenant.tenant_type,
        "rent_outstanding": tenant.rent_outstanding or 0,
        "service_charge_outstanding": tenant.service_charge_outstanding or 0,
        "total_outstanding": (tenant.rent_outstanding or 0) + (tenant.service_charge_outstanding or 0),
        "yearly_breakdown": {
            "year1": {"label": "Current Year", "billing_start": billing_start, "billing_end": renewal_start,
                      "annual_rent": y1_rent["total_amount"], "annual_service": y1_svc["total_amount"],
                      "monthly_rent": y1_rent["final_rent"], "monthly_service": y1_svc["final_rent"],
                      "one_time_fees": final_caution + final_legal,
                      "total": y1_rent["total_amount"] + y1_svc["total_amount"] + final_caution + final_legal},
            "year2": {"label": "Renewal Year", "billing_start": renewal_start,
                      "annual_rent": y2_rent["total_amount"], "annual_service": y2_svc["total_amount"],
                      "monthly_rent": y2_rent["final_rent"], "monthly_service": y2_svc["final_rent"],
                      "total": y2_rent["total_amount"] + y2_svc["total_amount"],
                      "rent_increased": y2_rent["final_rent"] > y1_rent["final_rent"]},
        }
    }

    tenant_dict = {c.key: getattr(tenant, c.key) for c in tenant.__table__.columns}
    response_data: dict = {"tenant": tenant_dict, "overview": overview,
                            "financial_summary": {"total_paid": total_paid, "breakdown": payments_by_type}}
    if expand and "history" in expand:
        response_data["history"] = list(reversed(tenant.history or []))[:limit]
    if expand and "transactions" in expand:
        skip = (page - 1) * limit
        txs  = await find_all(db, Transaction, Transaction.user == (tenant.user or tenant.id),
                               order_by=Transaction.created_at.desc(), skip=skip, limit=limit)
        response_data["transactions"] = [{"id": t.id, "amount": t.amount, "type": t.type, "created_at": t.created_at} for t in txs]

    return {"success": True, "data": response_data}


@router.put("/{tenant_id}")
@router.patch("/{tenant_id}")
async def update_tenant(
    tenant_id: str, body: TenantUpdate,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    tenant = await _get_tenant_or_404(db, tenant_id)
    if body.unit_label is not None: tenant.unit_label = body.unit_label
    new_name = (body.tenant_name or "").strip() or " ".join(filter(None, [body.first_name, body.other_names, body.surname])).strip()
    if new_name: tenant.tenant_name = new_name
    if body.tenant_email or body.email:
        tenant.tenant_email = body.tenant_email or body.email
    if body.tenant_phone or body.whatsapp:
        tenant.tenant_phone = body.tenant_phone or body.whatsapp
    history_meta: dict = {}
    if body.rent_amount is not None:
        if body.rent_amount != tenant.rent_amount:
            history_meta["old_rent"] = tenant.rent_amount
            history_meta["new_rent"] = body.rent_amount
        tenant.rent_amount = body.rent_amount
        if tenant.unit:
            unit = await db.get(Unit, tenant.unit)
            if unit:
                unit.monthly_price = body.rent_amount
                await save(db, unit)
    if body.service_charge_amount is not None:
        tenant.service_charge_amount = body.service_charge_amount
        if tenant.unit:
            unit = await db.get(Unit, tenant.unit)
            if unit:
                unit.service_charge_monthly = body.service_charge_amount
                await save(db, unit)
    if body.tenant_type is not None:   tenant.tenant_type = body.tenant_type
    if body.status is not None:
        tenant.status = body.status
        if tenant.user:
            u = await db.get(User, tenant.user)
            if u:
                u.is_active = body.status == "occupied"
                await save(db, u)
    if body.electric_meter_number is not None: tenant.electric_meter_number = body.electric_meter_number
    if body.entry_date is not None:    tenant.entry_date    = parse_flexible_date(body.entry_date)
    if body.next_due_date is not None: tenant.next_due_date = parse_flexible_date(body.next_due_date)
    if body.rent_outstanding is not None:           tenant.rent_outstanding           = max(0, body.rent_outstanding)
    if body.service_charge_outstanding is not None: tenant.service_charge_outstanding = max(0, body.service_charge_outstanding)
    if history_meta:
        history = tenant.history or []
        history.append({"event": "note", "note": "Tenant information updated",
                        "meta": history_meta, "created_by": user.id, "created_at": datetime.utcnow().isoformat()})
        tenant.history = history
    tenant.updated_by = user.id
    tenant.updated_at = datetime.utcnow()
    await save(db, tenant)
    return {"success": True, "message": "Tenant updated successfully",
            "data": {"id": tenant.id, "tenant_name": tenant.tenant_name}}


@router.delete("/{tenant_id}")
async def delete_tenant(
    tenant_id: str,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    tenant = await _get_tenant_or_404(db, tenant_id)
    if tenant.user:
        u = await db.get(User, tenant.user)
        if u:
            u.is_active = False
            await save(db, u)
    # Free the unit
    if tenant.unit:
        unit = await db.get(Unit, tenant.unit)
        if unit:
            unit.status = "vacant"
            unit.occupied_by = None
            unit.occupied_since = None
            unit.updated_by = user.id
            await save(db, unit)
    tenant.is_active = False
    tenant.status = "vacant"
    tenant.updated_by = user.id
    tenant.updated_at = datetime.utcnow()
    await save(db, tenant)
    return {"success": True, "message": "Tenant deleted successfully"}


# ── History / Transactions / Billing ─────────────────────────────────────────

@router.get("/{tenant_id}/history")
async def list_history(tenant_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    tenant = await _get_tenant_or_404(db, tenant_id)
    return {"success": True, "data": list(reversed(tenant.history or []))}


@router.post("/{tenant_id}/history", status_code=201)
async def add_history(
    tenant_id: str, body: HistoryCreate,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    tenant  = await _get_tenant_or_404(db, tenant_id)
    history = tenant.history or []
    entry   = {"event": body.event, "note": body.note, "meta": body.meta,
                "created_by": user.id, "created_at": datetime.utcnow().isoformat()}
    history.append(entry)
    tenant.history    = history
    tenant.updated_at = datetime.utcnow()
    await save(db, tenant)
    return {"success": True, "message": "History added", "data": entry}


@router.get("/{tenant_id}/billing")
async def list_billing_items(
    tenant_id: str,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    tenant = await _get_tenant_or_404(db, tenant_id)
    unit   = await db.get(Unit, tenant.unit) if tenant.unit else None
    items  = []
    if tenant.rent_amount > 0:
        items.append({"code": "rent", "label": "Rent", "amount": tenant.rent_amount, "type": "recurring"})
    if unit and (unit.service_charge_monthly or 0) > 0:
        items.append({"code": "service_charge", "label": "Service Charge", "amount": unit.service_charge_monthly, "type": "recurring"})
    if unit and (unit.caution_fee or 0) > 0:
        paid = await find_one(db, Payment, Payment.tenant == tenant.id, Payment.payment_status == "completed", Payment.payment_type == "caution_fee")
        if not paid:
            items.append({"code": "caution_fee", "label": "Caution Fee (one-time)", "amount": unit.caution_fee, "type": "one_time"})
    if unit and (unit.legal_fee or 0) > 0:
        paid = await find_one(db, Payment, Payment.tenant == tenant.id, Payment.payment_status == "completed", Payment.payment_type == "legal_fee")
        if not paid:
            items.append({"code": "legal_fee", "label": "Legal Fee (one-time)", "amount": unit.legal_fee, "type": "one_time"})
    return {"success": True, "data": {"tenant": {"id": tenant.id, "name": tenant.tenant_name}, "items": items}}


@router.get("/{tenant_id}/transactions")
async def list_transactions(
    tenant_id: str, page: int = 1, limit: int = 20,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    tenant = await _get_tenant_or_404(db, tenant_id)
    total  = await count(db, Transaction, Transaction.user == (tenant.user or tenant.id))
    skip   = (page - 1) * limit
    items  = await find_all(db, Transaction, Transaction.user == (tenant.user or tenant.id),
                             order_by=Transaction.created_at.desc(), skip=skip, limit=limit)
    return {"success": True, "data": [{"id": t.id, "amount": t.amount, "type": t.type, "created_at": t.created_at} for t in items],
            "pagination": {"currentPage": page, "totalPages": -(-total // limit), "totalItems": total}}


@router.post("/{tenant_id}/transactions", status_code=201)
async def add_transaction(
    tenant_id: str, body: TransactionCreate,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    tenant = await _get_tenant_or_404(db, tenant_id)
    tx = Transaction(
        id=gen_uuid(), user=tenant.user or tenant.id, estate=tenant.estate,
        amount=body.amount, type=body.type, method=body.method or "manual",
        status=body.status, reference=body.reference or gen_uuid()[:8],
        created_by=user.id,
    )
    await save(db, tx)
    if body.type in ("rent", "service_charge") and body.status == "paid":
        months = body.duration_months or (12 if tenant.tenant_type == "new" else 6)
        base   = tenant.next_due_date or tenant.entry_date or datetime.utcnow()
        new_due = base
        for _ in range(months):
            m = (new_due.month % 12) + 1
            y = new_due.year + (1 if new_due.month == 12 else 0)
            new_due = new_due.replace(year=y, month=m)
        tenant.next_due_date = new_due
        tenant.updated_at    = datetime.utcnow()
        await save(db, tenant)
    return {"success": True, "message": "Transaction recorded", "data": {"id": tx.id}}


@router.post("/{tenant_id}/avatar")
async def upload_tenant_avatar(
    tenant_id: str, file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    tenant = await _get_tenant_or_404(db, tenant_id)
    is_admin = user.role in ADMIN_ROLES
    is_owner = tenant.user and tenant.user == user.id
    if not is_admin and not is_owner:
        raise HTTPException(status_code=403, detail="Not allowed to update this profile image")
    if tenant.profile_image_public_id:
        try:
            cloudinary.uploader.destroy(tenant.profile_image_public_id)
        except Exception:
            pass
    data   = await file.read()
    result = cloudinary.uploader.upload(data, folder="bamihustle/avatars", resource_type="image")
    tenant.profile_image_url       = result["secure_url"]
    tenant.profile_image_public_id = result["public_id"]
    tenant.updated_by              = user.id
    tenant.updated_at              = datetime.utcnow()
    await save(db, tenant)
    return {"success": True, "data": {"url": tenant.profile_image_url}}
