from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, status
from typing import Optional
from datetime import datetime, timedelta
from bson import ObjectId
import cloudinary, cloudinary.uploader

from models.tenant import Tenant, TenantStatus, TenantHistory
from models.user import User, UserRole
from models.unit import Unit, UnitStatus
from models.estate import Estate
from models.payment import Payment
from models.wallet import Wallet
from models.transaction import Transaction
from models.billing_item import BillingItem
from schemas.tenant import TenantCreate, TenantUpdate, HistoryCreate, TransactionCreate, PayBillingItemsRequest
from core.security import get_current_user, hash_password
from utils.tenant_helpers import parse_flexible_date, generate_temp_password, process_tenant, project_next_due_date
from utils.rent_calculator import get_current_rent, calculate_effective_rent

router = APIRouter(prefix="/tenants", tags=["Tenants"])


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_tenant_or_404(tenant_id: str) -> Tenant:
    t = await Tenant.get(tenant_id)
    if not t or not t.is_active:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return t


async def _reconcile_next_due_date(tenant: Tenant) -> datetime | None:
    """
    Derive next due date from latest completed rent payment.
    If no payments exist, return None (preserve admin-set date).
    """
    coll = Payment.get_motor_collection()
    payments = await coll.find(
        {"tenant": tenant.id, "payment_status": "completed",
         "payment_type": {"$in": ["rent", "service_charge", "bundle", "initial"]}},
        sort=[("created_at", -1)]
    ).to_list(100)

    if not payments:
        return None

    # Use the max of (storedNextDueDate, latest payment date advanced by duration)
    latest = tenant.next_due_date
    for p in payments:
        meta = (p.get("paystack_response") or {}).get("data", {}).get("metadata", {})
        duration = meta.get("duration_months", 12)
        base = p.get("created_at") or datetime.utcnow()
        candidate = base.replace(day=tenant.entry_date.day if tenant.entry_date else base.day)
        for _ in range(duration):
            m = candidate.month + 1 if candidate.month < 12 else 1
            y = candidate.year if candidate.month < 12 else candidate.year + 1
            candidate = candidate.replace(year=y, month=m)
        if not latest or candidate > latest:
            latest = candidate
    return latest


# ── Estate-scoped create (POST /api/estates/:estateId/tenants) ────────────────
# Also used as flat POST /api/tenants  — estateId in body when not in path

@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_tenant(
    body: TenantCreate,
    estate_id: Optional[str] = Query(None, alias="estateId"),
    user: User = Depends(get_current_user),
):
    eid = estate_id
    if not eid:
        raise HTTPException(status_code=400, detail="estateId is required")

    estate = await Estate.get(eid)
    if not estate or not estate.is_active:
        raise HTTPException(status_code=404, detail="Estate not found")

    unit = await Unit.find_one({"_id": ObjectId(body.unit_id), "estate": ObjectId(eid), "is_active": True})
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found in this estate")
    if unit.status == UnitStatus.occupied:
        raise HTTPException(status_code=409, detail="This unit is already occupied")

    full_name = (body.tenant_name or "").strip() or " ".join(
        filter(None, [body.first_name, body.other_names, body.surname])
    ).strip()
    email_addr  = (body.tenant_email or body.email or "").strip()
    phone       = body.tenant_phone or body.whatsapp or ""
    tenant_type = body.tenant_type or "new"

    # Duration validation
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

    # Parse dates
    parsed_entry   = parse_flexible_date(body.entry_date)
    parsed_next    = parse_flexible_date(body.next_due_date)
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

    # User account
    user_id, generated_password = None, None
    if email_addr:
        existing_user = await User.find_one({"email": email_addr})
        if existing_user:
            if existing_user.role != UserRole.tenant:
                raise HTTPException(status_code=400, detail=f"Email registered as {existing_user.role}")
            user_id = existing_user.id
            if not existing_user.is_active:
                existing_user.is_active = True
            generated_password = generate_temp_password(6)
            existing_user.password = hash_password(generated_password)
            await existing_user.save()
        else:
            generated_password = generate_temp_password(6)
            new_user = User(
                name=full_name or "Tenant",
                email=email_addr,
                password=hash_password(generated_password),
                role=UserRole.tenant,
                created_by=user.id,
                email_verified=True,
            )
            await new_user.insert()
            # auto-create wallet
            await Wallet(user_id=new_user.id, balance=0, currency="NGN").insert()
            user_id = new_user.id

    # Displace existing active tenants for this unit label
    coll = Tenant.get_motor_collection()
    displaced = await coll.find(
        {"estate": ObjectId(eid), "unit_label": unit.label, "is_active": True}, {"user": 1}
    ).to_list(None)
    displaced_uids = [d["user"] for d in displaced if d.get("user")]
    await coll.update_many(
        {"estate": ObjectId(eid), "unit_label": unit.label, "is_active": True},
        {"$set": {"is_active": False, "status": "vacant", "updated_by": user.id}}
    )
    if displaced_uids:
        await User.get_motor_collection().update_many(
            {"_id": {"$in": displaced_uids}}, {"$set": {"is_active": False}}
        )

    tenant = Tenant(
        estate=ObjectId(eid),
        unit=ObjectId(body.unit_id),
        unit_label=unit.label,
        tenant_name=full_name,
        tenant_email=email_addr or None,
        tenant_phone=phone or None,
        rent_amount=unit.monthly_price,
        base_rent=unit.monthly_price,
        service_charge_amount=unit.service_charge_monthly or 0,
        base_service_charge=unit.service_charge_monthly or 0,
        tenant_type=tenant_type,
        electric_meter_number=unit.meter_number or "",
        entry_date=parsed_entry or today,
        next_due_date=effective_next,
        status="occupied",
        user=user_id,
        rent_outstanding=max(0, body.rent_outstanding or 0),
        service_charge_outstanding=max(0, body.service_charge_outstanding or 0),
        history=[TenantHistory(event="created", note="Tenant record created",
                               meta={"unit_id": str(body.unit_id), "unit_label": unit.label},
                               created_by=str(user.id))],
        created_by=user.id,
    )
    await tenant.insert()

    # Mark unit occupied
    unit.status        = UnitStatus.occupied
    unit.occupied_by   = tenant.id
    unit.occupied_since = parsed_entry or today
    unit.updated_by    = user.id
    await unit.save()

    # TODO: send welcome email (Phase 6 — email service)

    return {"success": True, "message": "Tenant created successfully", "data": tenant.model_dump()}


# ── List tenants ──────────────────────────────────────────────────────────────

@router.get("/")
async def list_tenants(
    estate_id:   Optional[str] = Query(None, alias="estateId"),
    page:        int = 1,
    limit:       int = 20,
    search:      Optional[str] = None,
    quarter:     Optional[str] = None,
    view:        Optional[str] = None,
    year:        Optional[int] = None,
    user: User = Depends(get_current_user),
):
    f: dict = {"is_active": True}
    if estate_id:
        f["estate"] = ObjectId(estate_id)
    if search:
        f["$or"] = [
            {"tenant_name": {"$regex": search, "$options": "i"}},
            {"tenant_email": {"$regex": search, "$options": "i"}},
            {"tenant_phone": {"$regex": search, "$options": "i"}},
        ]

    q = (quarter or "").upper()
    is_valid_quarter = q in ("Q1", "Q2", "Q3", "Q4")
    is_quarterly = view == "quarterly" or is_valid_quarter

    if is_quarterly:
        coll = Tenant.get_motor_collection()
        docs = await coll.find(f).sort("next_due_date", 1).to_list(None)

        quarters: dict = {
            "Q1": {"Jan": [], "Feb": [], "Mar": []},
            "Q2": {"Apr": [], "May": [], "Jun": []},
            "Q3": {"Jul": [], "Aug": [], "Sep": []},
            "Q4": {"Oct": [], "Nov": [], "Dec": []},
        }
        month_names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
        total_monthly = 0

        for doc in docs:
            t = Tenant.model_validate(doc)
            computed = process_tenant(t)
            due = computed["next_due_date"]
            if not due:
                continue
            mi    = due.month - 1
            mn    = month_names[mi]
            qk    = f"Q{mi // 3 + 1}"
            if quarters[qk].get(mn) is not None:
                quarters[qk][mn].append({**doc, **computed})
                total_monthly += computed["total_monthly_fees"]

        return {"success": True,
                "data": quarters[q] if is_valid_quarter else quarters,
                "summary": {"tenant_count": len(docs), "total_monthly_rent": total_monthly, "currency": "NGN"}}

    # Paginated list
    coll  = Tenant.get_motor_collection()
    total = await coll.count_documents(f)
    skip  = (page - 1) * limit
    docs  = await coll.find(f).sort("next_due_date", 1).skip(skip).limit(limit).to_list(limit)

    items = []
    for doc in docs:
        t = Tenant.model_validate(doc)
        items.append({**doc, **process_tenant(t)})

    return {"success": True, "data": items,
            "pagination": {"currentPage": page, "totalPages": -(-total // limit), "totalItems": total}}


# ── Tenant-self routes (/me) ──────────────────────────────────────────────────

@router.get("/me")
async def get_my_tenant(user: User = Depends(get_current_user)):
    tenant = await Tenant.find_one({"user": user.id, "is_active": True})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant record not found for this user")
    computed = process_tenant(tenant)
    return {"success": True, "data": {**tenant.model_dump(), **computed}}


@router.get("/me/history")
async def list_my_history(user: User = Depends(get_current_user)):
    tenant = await Tenant.find_one({"user": user.id, "is_active": True})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant record not found")
    return {"success": True, "data": list(reversed(tenant.history or []))}


@router.get("/me/billing")
async def get_my_billing_items(user: User = Depends(get_current_user)):
    tenant = await Tenant.find_one({"user": user.id, "is_active": True})
    recurring, one_time, optional_items = [], [], []

    if tenant:
        unit = await Unit.get(str(tenant.unit)) if tenant.unit else None
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
            pcoll = Payment.get_motor_collection()
            if unit.caution_fee > 0:
                paid = await pcoll.find_one({"tenant": tenant.id, "payment_status": "completed",
                                              "payment_type": "caution_fee"})
                if not paid:
                    one_time.append({"code": "caution_fee", "label": "Caution Fee", "amount": unit.caution_fee,
                                      "type": "one_time", "frequency": "once"})
            if unit.legal_fee > 0:
                paid = await pcoll.find_one({"tenant": tenant.id, "payment_status": "completed",
                                              "payment_type": "legal_fee"})
                if not paid:
                    one_time.append({"code": "legal_fee", "label": "Legal Fee", "amount": unit.legal_fee,
                                      "type": "one_time", "frequency": "once"})

    return {"success": True, "data": {"recurring": recurring, "one_time": one_time, "optional": optional_items}}


@router.post("/me/billing/pay")
async def pay_billing_items(body: PayBillingItemsRequest, user: User = Depends(get_current_user)):
    if body.duration_months not in (6, 12):
        raise HTTPException(status_code=400, detail="Payment duration must be 6 or 12 months")

    tenant = await Tenant.find_one({"user": user.id, "is_active": True})
    wallet = await Wallet.find_one({"user_id": user.id})
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")

    items_to_process, total_amount = [], 0.0
    origin = tenant.entry_date if tenant else datetime.utcnow()

    for item_id in body.item_ids:
        # predefined codes
        if item_id == "rent" and tenant and tenant.rent_amount > 0:
            result = calculate_effective_rent(tenant.rent_amount, tenant.entry_date or datetime.utcnow(),
                                               body.duration_months, False, origin)
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

    # Deduct from wallet
    wallet.balance    -= total_amount
    wallet.total_spent += total_amount
    wallet.updated_at  = datetime.utcnow()
    await wallet.save()

    # Record payment
    payment = Payment(
        tenant=tenant.id if tenant else None,
        amount=total_amount,
        payment_type="bundle" if len(items_to_process) > 1 else items_to_process[0]["code"],
        payment_status="completed",
    )
    await payment.insert()

    # Advance nextDueDate
    if tenant:
        has_rent_payment = any(i["code"] == "rent" for i in items_to_process)
        if has_rent_payment:
            base = tenant.next_due_date or tenant.entry_date or datetime.utcnow()
            new_due = base
            for _ in range(body.duration_months):
                m = (new_due.month % 12) + 1
                y = new_due.year + (1 if new_due.month == 12 else 0)
                new_due = new_due.replace(year=y, month=m)
            tenant.next_due_date = new_due
            await tenant.save()

        # Clear outstanding if paid
        if any(i["code"] == "outstanding_rent" for i in items_to_process):
            tenant.rent_outstanding = 0
            await tenant.save()
        if any(i["code"] == "outstanding_service_charge" for i in items_to_process):
            tenant.service_charge_outstanding = 0
            await tenant.save()

    return {"success": True, "message": "Payment processed successfully",
            "data": {"total_paid": total_amount, "items": items_to_process, "wallet_balance": wallet.balance}}


@router.post("/me/avatar")
async def upload_my_avatar(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    tenant = await Tenant.find_one({"user": user.id, "is_active": True})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant record not found")
    data   = await file.read()
    result = cloudinary.uploader.upload(data, folder="bamihustle/avatars", resource_type="image")
    tenant.profile_image_url       = result["secure_url"]
    tenant.profile_image_public_id = result["public_id"]
    tenant.updated_at              = datetime.utcnow()
    await tenant.save()
    return {"success": True, "data": {"url": tenant.profile_image_url}}


# ── Single tenant CRUD ────────────────────────────────────────────────────────

@router.get("/{tenant_id}")
async def get_tenant(
    tenant_id: str,
    expand:    Optional[str] = None,
    page:      int = 1,
    limit:     int = 10,
    user: User = Depends(get_current_user),
):
    tenant = await _get_tenant_or_404(tenant_id)
    unit   = await Unit.get(str(tenant.unit)) if tenant.unit else None

    origin      = tenant.entry_date or tenant.created_at
    rent_base   = tenant.base_rent or tenant.rent_amount
    svc_base    = tenant.base_service_charge or tenant.service_charge_amount or 0
    is_new      = tenant.tenant_type == "new"

    current_rent    = get_current_rent(rent_base, origin, False)
    current_service = get_current_rent(svc_base, origin, False)
    current_caution = get_current_rent(unit.caution_fee if unit else 0, origin, False) if is_new else 0
    current_legal   = get_current_rent(unit.legal_fee if unit else 0, origin, False) if is_new else 0

    # Payment summary
    pcoll = Payment.get_motor_collection()
    pay_agg = await pcoll.aggregate([
        {"$match": {"tenant": tenant.id, "payment_status": "completed"}},
        {"$group": {"_id": "$payment_type", "total": {"$sum": "$amount"}, "count": {"$sum": 1},
                    "last_payment": {"$max": "$created_at"}}}
    ]).to_list(None)

    breakdown: dict = {}
    total_paid = 0.0
    for row in pay_agg:
        breakdown[row["_id"]] = {"total": row["total"], "count": row["count"], "last_payment": row.get("last_payment")}
        total_paid += row["total"]

    final_caution = current_caution if is_new and not breakdown.get("caution_fee") else 0
    final_legal   = current_legal   if is_new and not breakdown.get("legal_fee")   else 0

    # nextDueDate projection
    corrected = await _reconcile_next_due_date(tenant)
    if corrected:
        tenant.next_due_date = corrected

    now = datetime.utcnow()
    renewal_start = project_next_due_date(tenant) or tenant.next_due_date

    # Yearly breakdown
    billing_start = renewal_start.replace(year=renewal_start.year - 1)
    y1_rent   = calculate_effective_rent(rent_base, billing_start, 12, False, origin)
    y1_svc    = calculate_effective_rent(svc_base,  billing_start, 12, False, origin)
    y2_rent   = calculate_effective_rent(rent_base, renewal_start, 12, False, origin)
    y2_svc    = calculate_effective_rent(svc_base,  renewal_start, 12, False, origin)

    lease_months = max(0,
        (renewal_start.year - (tenant.entry_date or tenant.created_at).year) * 12 +
        (renewal_start.month - (tenant.entry_date or tenant.created_at).month)
    ) if tenant.entry_date else 0

    overview = {
        "rent":              current_rent,
        "service_charge":    current_service,
        "caution_fee":       final_caution,
        "legal_fee":         final_legal,
        "lease_duration_months": lease_months,
        "next_due":          renewal_start,
        "entry_date":        tenant.entry_date,
        "status":            tenant.status,
        "tenant_type":       tenant.tenant_type,
        "rent_outstanding":  tenant.rent_outstanding or 0,
        "service_charge_outstanding": tenant.service_charge_outstanding or 0,
        "total_outstanding": (tenant.rent_outstanding or 0) + (tenant.service_charge_outstanding or 0),
        "yearly_breakdown": {
            "year1": {
                "label": "Current Year",
                "billing_start": billing_start,
                "billing_end":   renewal_start,
                "annual_rent":   y1_rent["total_amount"],
                "annual_service": y1_svc["total_amount"],
                "monthly_rent":  y1_rent["final_rent"],
                "monthly_service": y1_svc["final_rent"],
                "one_time_fees": final_caution + final_legal,
                "total": y1_rent["total_amount"] + y1_svc["total_amount"] + final_caution + final_legal,
            },
            "year2": {
                "label": "Renewal Year",
                "billing_start": renewal_start,
                "annual_rent":   y2_rent["total_amount"],
                "annual_service": y2_svc["total_amount"],
                "monthly_rent":  y2_rent["final_rent"],
                "monthly_service": y2_svc["final_rent"],
                "total": y2_rent["total_amount"] + y2_svc["total_amount"],
                "rent_increased": y2_rent["final_rent"] > y1_rent["final_rent"],
            }
        }
    }

    response_data: dict = {"tenant": tenant.model_dump(), "overview": overview,
                            "financial_summary": {"total_paid": total_paid, "breakdown": breakdown}}

    if expand and "history" in expand:
        response_data["history"] = list(reversed(tenant.history or []))[-limit:]
    if expand and "transactions" in expand:
        tcoll = Transaction.get_motor_collection()
        txs   = await tcoll.find({"tenant": tenant.id}).sort("created_at", -1).skip((page-1)*limit).limit(limit).to_list(limit)
        response_data["transactions"] = txs

    return {"success": True, "data": response_data}


@router.put("/{tenant_id}")
@router.patch("/{tenant_id}")
async def update_tenant(tenant_id: str, body: TenantUpdate, user: User = Depends(get_current_user)):
    tenant = await _get_tenant_or_404(tenant_id)

    if body.unit_label is not None:  tenant.unit_label = body.unit_label
    # Build name
    new_name = (body.tenant_name or "").strip() or " ".join(
        filter(None, [body.first_name, body.other_names, body.surname])
    ).strip()
    if new_name: tenant.tenant_name = new_name

    if body.tenant_email or body.email:
        tenant.tenant_email = (body.tenant_email or body.email)
    if body.tenant_phone or body.whatsapp:
        tenant.tenant_phone = (body.tenant_phone or body.whatsapp)

    history_meta: dict = {}
    if body.rent_amount is not None:
        if body.rent_amount != tenant.rent_amount:
            history_meta["old_rent"] = tenant.rent_amount
            history_meta["new_rent"] = body.rent_amount
        tenant.rent_amount = body.rent_amount
        # sync unit
        if tenant.unit:
            await Unit.get_motor_collection().update_one(
                {"_id": tenant.unit}, {"$set": {"monthly_price": body.rent_amount}}
            )

    if body.service_charge_amount is not None:
        tenant.service_charge_amount = body.service_charge_amount
        if tenant.unit:
            await Unit.get_motor_collection().update_one(
                {"_id": tenant.unit}, {"$set": {"service_charge_monthly": body.service_charge_amount}}
            )

    if body.tenant_type is not None: tenant.tenant_type = body.tenant_type
    if body.status is not None:
        tenant.status = body.status
        if tenant.user:
            await User.get_motor_collection().update_one(
                {"_id": tenant.user},
                {"$set": {"is_active": body.status == "occupied"}}
            )
    if body.electric_meter_number is not None: tenant.electric_meter_number = body.electric_meter_number
    if body.entry_date   is not None: tenant.entry_date    = parse_flexible_date(body.entry_date)
    if body.next_due_date is not None: tenant.next_due_date = parse_flexible_date(body.next_due_date)
    if body.rent_outstanding          is not None: tenant.rent_outstanding           = max(0, body.rent_outstanding)
    if body.service_charge_outstanding is not None: tenant.service_charge_outstanding = max(0, body.service_charge_outstanding)

    if history_meta:
        tenant.history.append(TenantHistory(event="note", note="Tenant information updated",
                                             meta=history_meta, created_by=str(user.id)))
    tenant.updated_by = user.id
    tenant.updated_at = datetime.utcnow()
    await tenant.save()
    return {"success": True, "message": "Tenant updated successfully", "data": tenant.model_dump()}


@router.delete("/{tenant_id}")
async def delete_tenant(tenant_id: str, user: User = Depends(get_current_user)):
    coll = Tenant.get_motor_collection()
    result = await coll.find_one_and_update(
        {"_id": ObjectId(tenant_id), "is_active": True},
        {"$set": {"is_active": False, "updated_by": user.id}},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if result.get("user"):
        await User.get_motor_collection().update_one(
            {"_id": result["user"]}, {"$set": {"is_active": False}}
        )
    return {"success": True, "message": "Tenant deleted successfully"}


# ── History / Transactions / Billing ─────────────────────────────────────────

@router.get("/{tenant_id}/history")
async def list_history(tenant_id: str, user: User = Depends(get_current_user)):
    tenant = await _get_tenant_or_404(tenant_id)
    return {"success": True, "data": list(reversed(tenant.history or []))}


@router.post("/{tenant_id}/history", status_code=status.HTTP_201_CREATED)
async def add_history(tenant_id: str, body: HistoryCreate, user: User = Depends(get_current_user)):
    tenant = await _get_tenant_or_404(tenant_id)
    h = TenantHistory(event=body.event, note=body.note, meta=body.meta, created_by=str(user.id))
    tenant.history.append(h)
    await tenant.save()
    return {"success": True, "message": "History added", "data": h.model_dump()}


@router.get("/{tenant_id}/billing")
async def list_billing_items(tenant_id: str, user: User = Depends(get_current_user)):
    tenant = await _get_tenant_or_404(tenant_id)
    unit   = await Unit.get(str(tenant.unit)) if tenant.unit else None
    items  = []
    if tenant.rent_amount > 0:
        items.append({"code": "rent", "label": "Rent", "amount": tenant.rent_amount, "type": "recurring"})
    if unit and unit.service_charge_monthly > 0:
        items.append({"code": "service_charge", "label": "Service Charge", "amount": unit.service_charge_monthly, "type": "recurring"})
    if unit and unit.caution_fee > 0:
        pcoll = Payment.get_motor_collection()
        paid  = await pcoll.find_one({"tenant": tenant.id, "payment_status": "completed", "payment_type": "caution_fee"})
        if not paid:
            items.append({"code": "caution_fee", "label": "Caution Fee (one-time)", "amount": unit.caution_fee, "type": "one_time"})
    if unit and unit.legal_fee > 0:
        pcoll = Payment.get_motor_collection()
        paid  = await pcoll.find_one({"tenant": tenant.id, "payment_status": "completed", "payment_type": "legal_fee"})
        if not paid:
            items.append({"code": "legal_fee", "label": "Legal Fee (one-time)", "amount": unit.legal_fee, "type": "one_time"})
    return {"success": True, "data": {"tenant": {"id": str(tenant.id), "name": tenant.tenant_name}, "items": items}}


@router.get("/{tenant_id}/transactions")
async def list_transactions(tenant_id: str, page: int = 1, limit: int = 20, user: User = Depends(get_current_user)):
    tenant = await _get_tenant_or_404(tenant_id)
    coll   = Transaction.get_motor_collection()
    total  = await coll.count_documents({"tenant": tenant.id})
    items  = await coll.find({"tenant": tenant.id}).sort("created_at", -1).skip((page-1)*limit).limit(limit).to_list(limit)
    return {"success": True, "data": items, "pagination": {"currentPage": page, "totalPages": -(-total//limit), "totalItems": total}}


@router.post("/{tenant_id}/transactions", status_code=status.HTTP_201_CREATED)
async def add_transaction(tenant_id: str, body: TransactionCreate, user: User = Depends(get_current_user)):
    tenant = await _get_tenant_or_404(tenant_id)
    tx_doc = {
        "tenant": tenant.id, "estate": tenant.estate, "amount": body.amount,
        "type": body.type, "method": body.method, "status": body.status,
        "reference": body.reference, "created_by": user.id, "created_at": datetime.utcnow()
    }
    result = await Transaction.get_motor_collection().insert_one(tx_doc)

    if body.type in ("rent", "service_charge") and body.status == "paid":
        months = body.duration_months or (12 if tenant.tenant_type == "new" else 6)
        base   = tenant.next_due_date or tenant.entry_date or datetime.utcnow()
        new_due = base
        for _ in range(months):
            m = (new_due.month % 12) + 1
            y = new_due.year + (1 if new_due.month == 12 else 0)
            new_due = new_due.replace(year=y, month=m)
        tenant.next_due_date = new_due
        await tenant.save()

    return {"success": True, "message": "Transaction recorded", "data": {"id": str(result.inserted_id)}}


@router.post("/{tenant_id}/avatar")
async def upload_tenant_avatar(
    tenant_id: str, file: UploadFile = File(...), user: User = Depends(get_current_user)
):
    tenant = await _get_tenant_or_404(tenant_id)
    is_admin = user.role in ("admin", "super_admin")
    is_owner = tenant.user and str(tenant.user) == str(user.id)
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
    await tenant.save()
    return {"success": True, "data": {"url": tenant.profile_image_url}}
