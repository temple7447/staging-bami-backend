from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime
from typing import Optional
import hashlib, hmac, os
from pydantic import BaseModel

from models.user import User
from models.payment import Payment
from models.tenant import Tenant
from models.wallet import Wallet
from models.transaction import Transaction
from models.wallet_account import WalletAccount
from core.security import get_current_user
from core.database import get_db
from core.db_helpers import find_one, find_all, save, count, sum_col
from core.config import settings
from models.base import gen_uuid
from utils.pdf_service import generate_receipt_pdf
from utils.email_service import send_payment_confirmation, send_rent_reminder

router = APIRouter(prefix="/payments", tags=["Payments"])


class PaymentCreate(BaseModel):
    tenant: str
    estate: Optional[str] = None
    amount: float
    payment_type: str
    reference: Optional[str] = None


@router.post("", status_code=201)
async def create_payment(
    body: PaymentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    payment = Payment(id=gen_uuid(), **body.model_dump(), payment_status="pending", created_by=user.id)
    await save(db, payment)
    return {"success": True, "data": _p(payment)}


@router.get("")
async def list_payments(
    tenant_id: Optional[str] = None,
    estate_id: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conditions = []
    # Tenants only see their own payments
    if user.role == "tenant":
        tenant = await find_one(db, Tenant, Tenant.user == user.id, Tenant.is_active == True)
        if tenant:
            conditions.append(Payment.tenant == tenant.id)
    else:
        if tenant_id:
            conditions.append(Payment.tenant == tenant_id)
        if estate_id:
            conditions.append(Payment.estate == estate_id)
    if status:
        conditions.append(Payment.payment_status == status)
    skip = (page - 1) * limit
    total = await count(db, Payment, *conditions)
    items = await find_all(db, Payment, *conditions, order_by=Payment.created_at.desc(), skip=skip, limit=limit)
    return {
        "success": True, "total": total, "count": len(items),
        "page": page, "total_pages": -(-total // limit),
        "data": [_p(p) for p in items],
    }


@router.get("/{pid}")
async def get_payment(pid: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    payment = await find_one(db, Payment, Payment.id == pid)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    return {"success": True, "data": _p(payment)}


@router.put("/{pid}/status")
async def update_status(
    pid: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in {"super_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Admins only")
    payment = await find_one(db, Payment, Payment.id == pid)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    payment.payment_status = body.get("status", payment.payment_status)
    payment.updated_at = datetime.utcnow()
    await save(db, payment)
    return {"success": True, "data": _p(payment)}


@router.get("/{pid}/download")
async def download_receipt(pid: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    from fastapi.responses import Response
    payment = await find_one(db, Payment, Payment.id == pid)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    tenant = await find_one(db, Tenant, Tenant.id == payment.tenant)
    receipt_data = {
        "payment_id": payment.id, "reference": payment.reference,
        "amount": payment.amount, "payment_type": payment.payment_type,
        "payment_status": payment.payment_status, "created_at": payment.created_at,
    }
    tenant_info = {"tenant_name": tenant.tenant_name if tenant else "N/A",
                   "tenant_email": tenant.tenant_email if tenant else ""}
    estate_info = {"estate_name": "BamiHustle Estate"}
    pdf_bytes = generate_receipt_pdf(receipt_data, tenant_info, estate_info)
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename=receipt-{pid}.pdf"})


@router.post("/{pid}/receipt")
async def send_receipt(pid: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    payment = await find_one(db, Payment, Payment.id == pid)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    tenant = await find_one(db, Tenant, Tenant.id == payment.tenant)
    await send_payment_confirmation(
        to_email=tenant.tenant_email if tenant else "",
        tenant_name=tenant.tenant_name if tenant else "Tenant",
        amount=payment.amount,
        reference=payment.reference or payment.id,
        payment_type=payment.payment_type,
    )
    return {"success": True, "message": "Receipt sent"}


@router.post("/tenant/{tid}/receipt")
async def send_rent_reminder_email(tid: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    tenant = await find_one(db, Tenant, Tenant.id == tid)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    await send_rent_reminder(
        to_email=tenant.tenant_email or "",
        tenant_name=tenant.tenant_name,
        amount_due=tenant.rent_amount,
        due_date=tenant.next_due_date,
    )
    return {"success": True, "message": "Reminder sent"}


@router.post("/callback")
async def payment_callback(request: Request, db: AsyncSession = Depends(get_db)):
    secret = os.getenv("PAYSTACK_SECRET_KEY", "")
    raw_body = await request.body()
    sig = request.headers.get("x-paystack-signature", "")
    if secret:
        expected = hmac.new(secret.encode(), raw_body, hashlib.sha512).hexdigest()
        if not hmac.compare_digest(expected, sig):
            raise HTTPException(status_code=400, detail="Invalid Paystack signature")

    import json
    try:
        payload = json.loads(raw_body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid payload")

    event = payload.get("event")
    data  = payload.get("data", {})

    if event == "charge.success":
        ref = data.get("reference")
        payment = await find_one(db, Payment, Payment.reference == ref)
        if payment and payment.payment_status == "pending":
            payment.payment_status = "completed"
            payment.paystack_response = data
            payment.updated_at = datetime.utcnow()
            await save(db, payment)
            tenant = await find_one(db, Tenant, Tenant.id == payment.tenant)
            if tenant:
                wallet_account = await find_one(db, WalletAccount, WalletAccount.estate == payment.estate)
                if not wallet_account:
                    wallet_account = WalletAccount(id=gen_uuid(), estate=payment.estate)
                wallet_account.distribute_amount(payment.amount, payment.id, payment.payment_type)
                await save(db, wallet_account)

    elif event in ("transfer.success", "transfer.failed"):
        ref = data.get("reference")
        payment = await find_one(db, Payment, Payment.reference == ref)
        if payment:
            payment.payment_status = "completed" if event == "transfer.success" else "failed"
            payment.updated_at = datetime.utcnow()
            await save(db, payment)

    return {"status": "ok"}


def _p(p: Payment) -> dict:
    return {
        "id": p.id, "tenant": p.tenant, "estate": p.estate,
        "amount": p.amount, "payment_type": p.payment_type,
        "payment_status": p.payment_status, "reference": p.reference,
        "created_at": p.created_at,
    }
