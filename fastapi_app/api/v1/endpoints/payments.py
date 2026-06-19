"""
Phase 4 — Payments endpoint.
Non-Paystack operations (list, manual record, status, receipts) are fully
implemented.  Paystack-initialised payment flows are stubbed and will be wired
in Phase 6 (Paystack webhooks / email / PDF).
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from datetime import datetime
from bson import ObjectId
from typing import Optional

from models.user import User
from models.payment import Payment, PaymentStatus
from models.tenant import Tenant
from models.estate import Estate
from models.wallet import Wallet
from schemas.billing import ManualPaymentRequest
from core.security import get_current_user
from utils.tenant_helpers import project_next_due_date
from utils.rent_calculator import get_current_rent, calculate_effective_rent

router = APIRouter(prefix="/payments", tags=["Payments"])

ADMIN_ROLES = {"super_admin", "admin", "super_manager", "business_owner", "manager"}


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_tenant_or_400(tenant_id: str) -> Tenant:
    t = await Tenant.find_one({"_id": ObjectId(tenant_id), "is_active": True})
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return t


async def _estate_filter_for_user(user: User) -> dict:
    """Build a MongoDB filter scoped to estates this user may view."""
    role = user.role
    if role == "super_admin":
        return {}
    elif role in ("admin", "super_manager"):
        ecoll = Estate.get_motor_collection()
        estates = await ecoll.find({"managers": user.id, "is_active": True}, {"_id": 1}).to_list(None)
        return {"estate": {"$in": [e["_id"] for e in estates]}}
    elif role == "business_owner":
        ids = getattr(user, "assigned_estates", []) or []
        return {"estate": {"$in": ids}}
    else:
        return {"tenant": None}  # non-admin, non-tenant: no access by default


# ── Paystack-initialised payment endpoints (stubs) ────────────────────────────
# Full implementation in Phase 6.

def _paystack_stub(label: str):
    return {"success": True, "message": f"{label} — Paystack integration pending (Phase 6)",
            "data": {"note": "Wire PAYSTACK_SECRET_KEY and call paystackService in Phase 6"}}


@router.post("/initial")
async def initiate_initial_payment(body: dict, user: User = Depends(get_current_user)):
    return _paystack_stub("Initial payment")


@router.post("/deposit")
async def initiate_deposit_payment(body: dict, user: User = Depends(get_current_user)):
    return _paystack_stub("Deposit payment")


@router.post("/rent")
async def initiate_rent_payment(body: dict, user: User = Depends(get_current_user)):
    return _paystack_stub("Rent payment")


@router.post("/service-charge")
async def initiate_service_charge_payment(body: dict, user: User = Depends(get_current_user)):
    return _paystack_stub("Service charge payment")


@router.post("/caution-fee")
async def initiate_caution_fee_payment(body: dict, user: User = Depends(get_current_user)):
    return _paystack_stub("Caution fee payment")


@router.post("/legal-fee")
async def initiate_legal_fee_payment(body: dict, user: User = Depends(get_current_user)):
    return _paystack_stub("Legal fee payment")


@router.get("/verify/{reference}")
async def verify_payment(reference: str, user: User = Depends(get_current_user)):
    return _paystack_stub(f"Verify payment {reference}")


@router.post("/callback")
async def payment_callback(request: Request):
    """
    Paystack webhook — verifies HMAC-SHA512 signature then processes event.
    Supported events: charge.success, transfer.success, transfer.failed
    """
    import hashlib, hmac, os

    secret   = os.getenv("PAYSTACK_SECRET_KEY", "")
    raw_body = await request.body()
    sig      = request.headers.get("x-paystack-signature", "")

    if secret:
        expected = hmac.new(secret.encode(), raw_body, hashlib.sha512).hexdigest()
        if not hmac.compare_digest(expected, sig):
            raise HTTPException(status_code=400, detail="Invalid Paystack signature")

    try:
        payload    = await request.json()
    except Exception:
        import json
        payload = json.loads(raw_body)

    event = payload.get("event", "")
    data  = payload.get("data", {})

    if event == "charge.success":
        reference = data.get("reference", "")
        amount    = data.get("amount", 0) / 100  # Paystack sends kobo
        coll      = Payment.get_motor_collection()
        await coll.update_one(
            {"reference": reference},
            {"$set": {"payment_status": "completed", "amount": amount, "updated_at": datetime.utcnow()}},
            upsert=False,
        )
    elif event in ("transfer.success", "transfer.failed"):
        reference = data.get("reference", "")
        status    = "completed" if event == "transfer.success" else "failed"
        coll      = Payment.get_motor_collection()
        await coll.update_one(
            {"reference": reference},
            {"$set": {"payment_status": status, "updated_at": datetime.utcnow()}},
        )

    return {"success": True, "event": event}


# ── Manual payment recording (Admin) ─────────────────────────────────────────

@router.post("/manual-record")
async def record_manual_payment(body: ManualPaymentRequest, user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    tenant = await _get_tenant_or_400(body.tenant_id)
    payment_date = body.payment_date or datetime.utcnow()

    payment = Payment(
        tenant=tenant.id,
        estate=tenant.estate,
        amount=body.amount,
        payment_type=body.payment_type,
        payment_status=PaymentStatus.completed,
        reference=body.reference or f"MAN-{int(datetime.utcnow().timestamp()*1000)}",
        created_by=user.id,
        created_at=payment_date,
    )
    await payment.insert()

    # Advance nextDueDate for rent payments
    if body.payment_type in ("rent", "service_charge", "bundle", "initial"):
        months = body.duration_months or 12
        base   = tenant.next_due_date or tenant.entry_date or datetime.utcnow()
        new_due = base
        for _ in range(months):
            m = (new_due.month % 12) + 1
            y = new_due.year + (1 if new_due.month == 12 else 0)
            new_due = new_due.replace(year=y, month=m)
        tenant.next_due_date = new_due
        await tenant.save()

    return {"success": True, "message": "Payment recorded successfully", "data": payment.model_dump()}


# ── Payment listing ───────────────────────────────────────────────────────────

@router.get("/")
async def get_all_payments(
    page:      int = 1,
    limit:     int = 20,
    status_:   Optional[str] = Query(None, alias="status"),
    type_:     Optional[str] = Query(None, alias="type"),
    estate_id: Optional[str] = None,
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    estate_scope = await _estate_filter_for_user(user)
    f: dict = {**estate_scope}
    if estate_id: f["estate"] = ObjectId(estate_id)
    if status_:   f["payment_status"] = status_
    if type_:     f["payment_type"]   = type_

    coll  = Payment.get_motor_collection()
    total = await coll.count_documents(f)
    skip  = (page - 1) * limit
    items = await coll.find(f).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)

    return {"success": True, "data": items,
            "pagination": {"current_page": page, "total_pages": -(-total // limit), "total_items": total}}


@router.get("/receipts")
async def get_tenant_receipts(user: User = Depends(get_current_user)):
    tenant = await Tenant.find_one({"user": user.id, "is_active": True})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant record not found")

    coll  = Payment.get_motor_collection()
    items = await coll.find(
        {"tenant": tenant.id, "payment_status": "completed"}
    ).sort("created_at", -1).to_list(50)
    return {"success": True, "data": items}


@router.get("/tenant/{tenant_id}")
async def get_tenant_payments(
    tenant_id: str,
    page: int = 1, limit: int = 20,
    user: User = Depends(get_current_user),
):
    tenant = await _get_tenant_or_400(tenant_id)
    coll   = Payment.get_motor_collection()
    total  = await coll.count_documents({"tenant": tenant.id})
    skip   = (page - 1) * limit
    items  = await coll.find({"tenant": tenant.id}).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"success": True, "data": items,
            "pagination": {"current_page": page, "total_pages": -(-total // limit), "total_items": total}}


@router.get("/estate/{estate_id}")
async def get_estate_payments(
    estate_id: str,
    page: int = 1, limit: int = 20,
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    coll  = Payment.get_motor_collection()
    f     = {"estate": ObjectId(estate_id)}
    total = await coll.count_documents(f)
    skip  = (page - 1) * limit
    items = await coll.find(f).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    return {"success": True, "data": items,
            "pagination": {"current_page": page, "total_pages": -(-total // limit), "total_items": total}}


@router.get("/{payment_id}/download")
async def download_payment_receipt(payment_id: str, user: User = Depends(get_current_user)):
    return {"success": True, "message": "PDF receipt generation pending (Phase 6)", "payment_id": payment_id}


@router.post("/{payment_id}/receipt")
async def send_payment_receipt(payment_id: str, user: User = Depends(get_current_user)):
    return {"success": True, "message": "Email receipt pending (Phase 6)", "payment_id": payment_id}


@router.post("/tenant/{tenant_id}/receipt")
async def send_tenant_receipt(tenant_id: str, user: User = Depends(get_current_user)):
    return {"success": True, "message": "Email receipt pending (Phase 6)", "tenant_id": tenant_id}


@router.post("/{payment_id}/refund")
async def refund_deposit(payment_id: str, user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    coll = Payment.get_motor_collection()
    p    = await coll.find_one({"_id": ObjectId(payment_id)})
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    if p.get("payment_status") != "completed":
        raise HTTPException(status_code=400, detail="Only completed payments can be refunded")

    await coll.update_one({"_id": ObjectId(payment_id)},
                           {"$set": {"payment_status": "refunded", "updated_at": datetime.utcnow()}})
    return {"success": True, "message": "Payment marked as refunded"}


@router.get("/{payment_id}")
async def get_payment_status(payment_id: str, user: User = Depends(get_current_user)):
    coll = Payment.get_motor_collection()
    p    = await coll.find_one({"_id": ObjectId(payment_id)})
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    return {"success": True, "data": p}
