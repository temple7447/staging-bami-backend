"""Paystack checkout: wallet top-ups and direct bill payment.

Flow
  1. POST /paystack/initialize   — server fixes the amount (top-ups: the amount
     asked for; bills: priced server-side from the billing rules), records a
     hidden *pending intent*, and returns Paystack's checkout link.
  2. The user pays on Paystack's page.
  3. Paystack tells us twice — the signed webhook, and the client calling
     GET /paystack/verify/{reference} when it returns. Both go through
     `_settle`, which re-verifies the payment with Paystack and applies it
     exactly once, so a replay or a race can't credit twice.

Money is credited to the wallet first; a bill is then paid *from the wallet*
by the same code path as an ordinary wallet payment. If that second step is
refused (e.g. the bill changed while the user was paying) the money simply
stays in their wallet.

The pending intent is a `transactions` row (type "paystack_intent",
is_active False so it never shows in a statement) — no schema change.
"""
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.database import get_db
from core.db_helpers import find_one, save
from core.security import get_current_user
from models.base import gen_uuid
from models.tenant import Tenant
from models.transaction import Transaction
from models.user import User
from models.wallet import Wallet
from schemas.paystack import InitializePaystackRequest
from utils import paystack
from utils.time_utils import utcnow

router = APIRouter(prefix="/paystack", tags=["Paystack"])

INTENT_TYPE = "paystack_intent"
MIN_TOPUP = 100.0
MAX_TOPUP = 5_000_000.0


async def _wallet_for(db: AsyncSession, user_id: str) -> Wallet:
    wallet = await find_one(db, Wallet, Wallet.user_id == user_id)
    if not wallet:
        wallet = Wallet(id=gen_uuid(), user_id=user_id, balance=0.0, currency="NGN")
        await save(db, wallet)
    return wallet


@router.post("/initialize")
async def initialize(
    body: InitializePaystackRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not settings.PAYSTACK_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Online payments are not available right now.")
    if not user.email:
        raise HTTPException(status_code=400, detail="Add an email address to your profile to pay online.")

    wallet = await _wallet_for(db, user.id)
    tenant = await find_one(db, Tenant, Tenant.user == user.id, Tenant.is_active == True)
    intent = {"purpose": body.purpose}

    if body.purpose == "topup":
        amount = float(body.amount or 0)
        if amount < MIN_TOPUP or amount > MAX_TOPUP:
            raise HTTPException(status_code=400,
                                detail=f"Enter an amount between ₦{MIN_TOPUP:,.0f} and ₦{MAX_TOPUP:,.0f}.")
        description = "Paystack wallet top-up"
    else:  # bill
        from api.v1.endpoints.tenants import price_billing_items
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant record not found")
        if not body.item_ids:
            raise HTTPException(status_code=400, detail="Select at least one item to pay")
        if body.duration_months not in (6, 12):
            raise HTTPException(status_code=400, detail="Payment duration must be 6 or 12 months")
        _, _, amount = await price_billing_items(db, tenant, body.item_ids, body.duration_months)
        intent.update(item_ids=body.item_ids, duration_months=body.duration_months)
        description = "Paystack bill payment"

    reference = f"PSK-{gen_uuid()[:12].upper()}"
    callback_url = f"{settings.FRONTEND_URL.rstrip('/')}/payment/verify"
    try:
        checkout = await paystack.initialize_transaction(
            email=user.email, amount_naira=amount, reference=reference,
            callback_url=callback_url, metadata={"user_id": user.id, "purpose": body.purpose},
        )
    except paystack.PaystackError as e:
        raise HTTPException(status_code=502, detail=f"Could not start the payment: {e}")

    await save(db, Transaction(
        id=gen_uuid(), user=user.id, tenant=tenant.id if tenant else None,
        wallet_id=wallet.id, amount=amount, type=INTENT_TYPE, method="paystack",
        status="pending", reference=reference, description=description,
        notes=json.dumps(intent), is_active=False, created_by=user.id,
    ))
    return {"success": True, "data": {
        "authorization_url": checkout["authorization_url"],
        "reference": reference, "amount": amount,
        "callback_url": callback_url,
    }}


async def _settle(db: AsyncSession, reference: str, user_id: str | None = None) -> dict:
    """Apply a Paystack payment exactly once. `user_id`, when given, must own it."""
    intent = await find_one(db, Transaction, Transaction.reference == reference,
                            Transaction.method == "paystack")
    if not intent or (user_id and intent.user != user_id):
        raise HTTPException(status_code=404, detail="Payment not found")

    if intent.status == "completed":
        wallet = await db.get(Wallet, intent.wallet_id)
        return {"status": "completed", "already_applied": True, "balance": wallet.balance if wallet else None}
    if intent.status != "pending":
        return {"status": intent.status, "already_applied": False}

    try:
        result = await paystack.verify_transaction(reference)
    except paystack.PaystackError as e:
        raise HTTPException(status_code=502, detail=f"Payment could not be verified yet: {e}")
    if not result["success"]:
        return {"status": "pending", "message": "Payment has not been completed."}
    if result["currency"] != "NGN" or abs(result["amount"] - intent.amount) > 0.01:
        # Paid something other than what we asked for — never auto-credit that.
        await db.execute(update(Transaction).where(Transaction.id == intent.id, Transaction.status == "pending")
                         .values(status="mismatch", notes=f"{intent.notes} | paid {result['amount']} {result['currency']}"))
        await db.commit()
        raise HTTPException(status_code=409, detail="The amount paid does not match this payment. "
                            "Contact support with your reference: " + reference)

    # Claim it atomically so the webhook and the client verify can't both apply it.
    claimed = await db.execute(update(Transaction)
                               .where(Transaction.id == intent.id, Transaction.status == "pending")
                               .values(status="processing"))
    await db.commit()
    if claimed.rowcount != 1:
        return {"status": "processing", "already_applied": True}

    try:
        wallet = await db.get(Wallet, intent.wallet_id)
        wallet.balance += intent.amount
        wallet.total_earnings += intent.amount
        wallet.updated_at = utcnow()
        intent.type, intent.status, intent.is_active = "credit", "completed", True
        await db.commit()
    except Exception:
        await db.rollback()
        await db.execute(update(Transaction).where(Transaction.id == intent.id).values(status="pending"))
        await db.commit()
        raise

    out = {"status": "completed", "already_applied": False, "balance": wallet.balance, "bill": None}
    plan = json.loads(intent.notes or "{}")
    if plan.get("purpose") == "bill":
        from api.v1.endpoints.tenants import execute_billing_payment
        tenant = await find_one(db, Tenant, Tenant.user == intent.user, Tenant.is_active == True)
        try:
            bill = await execute_billing_payment(db, tenant, wallet, plan["item_ids"],
                                                 plan["duration_months"], intent.user, source="paystack")
            out["bill"] = {"paid": True, **bill}
            out["balance"] = bill["wallet_balance"]
        except HTTPException as e:
            # Money is safely in the wallet; the bill just wasn't applied.
            out["bill"] = {"paid": False, "reason": e.detail}
    return out


@router.get("/verify/{reference}")
async def verify(reference: str, db: AsyncSession = Depends(get_db),
                 user: User = Depends(get_current_user)):
    return {"success": True, "data": await _settle(db, reference, user_id=user.id)}


@router.post("/webhook")
async def webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Paystack server-to-server notification. Believed only if correctly signed,
    and even then the payment is re-verified with Paystack before anything moves."""
    raw = await request.body()
    if not paystack.valid_webhook_signature(raw, request.headers.get("x-paystack-signature")):
        raise HTTPException(status_code=401, detail="Invalid signature")
    try:
        event = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Bad payload")
    reference = (event.get("data") or {}).get("reference")
    if event.get("event") == "charge.success" and reference:
        try:
            await _settle(db, reference)
        except HTTPException:
            # Unknown reference or Paystack unreachable: answer non-2xx so
            # Paystack retries later (an unknown reference simply keeps 404ing).
            raise
    return {"success": True}
