from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime
from typing import Optional
import time

from models.user import User
from models.wallet import Wallet
from models.wallet_account import WalletAccount
from models.transaction import Transaction
from models.withdrawal import Withdrawal
from models.estate import Estate
from models.tenant import Tenant
from schemas.wallet import (
    CreateWalletRequest, AddFundsRequest, DeductFundsRequest,
    WalletTransactionRequest, AdminCreditRequest,
)
from core.security import get_current_user
from core.database import get_db
from core.db_helpers import find_one, find_all, save, count
from core.config import settings
from models.base import gen_uuid
from utils.time_utils import utcnow

router = APIRouter(prefix="/wallet", tags=["Wallet"])
ADMIN_ROLES = {"admin", "super_admin", "super_manager", "business_owner"}


async def _get_or_create_wallet(db: AsyncSession, user_id: str) -> Wallet:
    wallet = await find_one(db, Wallet, Wallet.user_id == user_id)
    if not wallet:
        wallet = Wallet(id=gen_uuid(), user_id=user_id, balance=0.0, currency="NGN")
        await save(db, wallet)
    return wallet


async def _record_transaction(
    db: AsyncSession, user_id: str, wallet_id: str, amount: float,
    tx_type: str, method: str = "other", reference: str = "",
    description: str = "", created_by: str = None,
) -> Transaction:
    tx = Transaction(
        id=gen_uuid(), user=user_id, wallet_id=wallet_id, amount=amount,
        type=tx_type, method=method, status="completed",
        reference=reference or f"{tx_type.upper()[:3]}-{int(time.time()*1000)}",
        description=description, created_by=created_by or user_id,
    )
    await save(db, tx)
    return tx


@router.get("")
async def get_wallet(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    wallet = await _get_or_create_wallet(db, user.id)
    return {"success": True, "data": {
        "id": wallet.id, "user_id": wallet.user_id,
        "balance": wallet.balance, "total_earnings": wallet.total_earnings,
        "total_spent": wallet.total_spent, "currency": wallet.currency,
        "currency_symbol": "₦",
    }}


@router.post("/create")
async def create_wallet(
    body: CreateWalletRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    existing = await find_one(db, Wallet, Wallet.user_id == user.id)
    if existing:
        return {"success": True, "message": "Wallet already exists", "data": {"id": existing.id}}
    wallet = Wallet(id=gen_uuid(), user_id=user.id, balance=0.0, currency=getattr(body, "currency", "NGN"))
    await save(db, wallet)
    return {"success": True, "data": {"id": wallet.id}}


@router.post("/add-funds")
async def add_funds(
    body: AddFundsRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Admins can credit any user; tenants can only top up their own wallet (test/demo mode)
    if user.role in ADMIN_ROLES:
        target_user = await db.get(User, str(body.user_id)) if (hasattr(body, "user_id") and getattr(body, "user_id", None)) else user
    else:
        target_user = user
    if not target_user:
        raise HTTPException(status_code=404, detail="Target user not found")
    wallet = await _get_or_create_wallet(db, target_user.id)
    wallet.balance += body.amount
    wallet.total_earnings += body.amount
    wallet.updated_at = utcnow()
    await save(db, wallet)
    await _record_transaction(db, target_user.id, wallet.id, body.amount, "credit",
                              description=getattr(body, "description", None) or "Wallet top-up",
                              created_by=user.id)
    return {"success": True, "message": "Funds added", "data": {"balance": wallet.balance}}


@router.post("/transaction")
async def wallet_transaction(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Unified transaction endpoint: type = deposit | withdrawal | transfer."""
    from pydantic import BaseModel
    tx_type   = (body.get("type") or "").lower()
    amount    = float(body.get("amount") or 0)
    desc      = body.get("description") or ""
    ref       = body.get("reference") or ""

    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    wallet = await _get_or_create_wallet(db, user.id)

    if tx_type == "deposit":
        wallet.balance += amount
        wallet.total_earnings += amount
        wallet.updated_at = utcnow()
        await save(db, wallet)
        await _record_transaction(db, user.id, wallet.id, amount, "deposit",
                                  method="bank_transfer", description=desc or "Deposit",
                                  reference=ref, created_by=user.id)
        return {"success": True, "message": "Deposit recorded", "data": {"balance": wallet.balance}}

    elif tx_type == "withdrawal":
        if wallet.balance < amount:
            raise HTTPException(status_code=400, detail="Insufficient balance")
        wallet.balance -= amount
        wallet.total_spent += amount
        wallet.updated_at = utcnow()
        await save(db, wallet)
        await _record_transaction(db, user.id, wallet.id, amount, "withdrawal",
                                  method="bank_transfer", description=desc or "Withdrawal",
                                  reference=ref, created_by=user.id)
        return {"success": True, "message": "Withdrawal initiated", "data": {"balance": wallet.balance}}

    elif tx_type == "transfer":
        recipient_email = body.get("recipientEmail") or body.get("recipient_email")
        recipient_id    = body.get("recipientId")    or body.get("recipient_id")
        if wallet.balance < amount:
            raise HTTPException(status_code=400, detail="Insufficient balance")
        # Resolve recipient
        recipient = None
        if recipient_email:
            from sqlalchemy import select as _select
            res = await db.execute(_select(User).where(User.email == recipient_email))
            recipient = res.scalar_one_or_none()
        elif recipient_id:
            recipient = await db.get(User, str(recipient_id))
        if not recipient:
            raise HTTPException(status_code=404, detail="Recipient not found")
        # Debit sender
        wallet.balance -= amount
        wallet.total_spent += amount
        wallet.updated_at = utcnow()
        await save(db, wallet)
        await _record_transaction(db, user.id, wallet.id, amount, "transfer",
                                  method="internal", description=desc or f"Transfer to {recipient.email}",
                                  reference=ref, created_by=user.id)
        # Credit recipient
        r_wallet = await _get_or_create_wallet(db, recipient.id)
        r_wallet.balance += amount
        r_wallet.total_earnings += amount
        r_wallet.updated_at = utcnow()
        await save(db, r_wallet)
        await _record_transaction(db, recipient.id, r_wallet.id, amount, "deposit",
                                  method="internal", description=desc or f"Transfer from {user.email}",
                                  reference=ref, created_by=user.id)
        return {"success": True, "message": "Transfer successful", "data": {"balance": wallet.balance}}

    else:
        raise HTTPException(status_code=400, detail=f"Unknown transaction type: {tx_type}")


@router.post("/deduct-funds")
async def deduct_funds(
    body: DeductFundsRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    wallet = await _get_or_create_wallet(db, user.id)
    if wallet.balance < body.amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")
    wallet.balance -= body.amount
    wallet.total_spent += body.amount
    wallet.updated_at = utcnow()
    await save(db, wallet)
    await _record_transaction(db, user.id, wallet.id, body.amount, "debit",
                              description=getattr(body, "description", "Deduction"), created_by=user.id)
    return {"success": True, "message": "Funds deducted", "balance": wallet.balance}


@router.post("/transfer")
async def transfer_funds(
    body: WalletTransactionRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    wallet = await _get_or_create_wallet(db, user.id)
    if wallet.balance < body.amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")
    wallet.balance -= body.amount
    wallet.total_spent += body.amount
    wallet.updated_at = utcnow()
    await save(db, wallet)
    await _record_transaction(db, user.id, wallet.id, body.amount, "transfer",
                              description=getattr(body, "description", "Transfer"), created_by=user.id)
    return {"success": True, "message": "Transfer successful", "balance": wallet.balance}


@router.get("/transactions")
async def get_transactions(
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conditions = [Transaction.is_active == True]
    if user.role not in ADMIN_ROLES:
        conditions.append(Transaction.user == user.id)
    skip = (page - 1) * limit
    total = await count(db, Transaction, *conditions)
    items = await find_all(db, Transaction, *conditions,
                           order_by=Transaction.created_at.desc(), skip=skip, limit=limit)
    return {"success": True, "data": await _enrich(db, items),
            "total": total, "page": page, "limit": limit,
            "total_pages": -(-total // limit)}


@router.get("/transactions/list")
async def list_transactions_filtered(
    type: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    start_date: Optional[str] = Query(None, alias="startDate"),
    end_date: Optional[str] = Query(None, alias="endDate"),
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from sqlalchemy import and_
    from datetime import datetime as dt

    conditions = [Transaction.is_active == True]
    if user.role not in {"super_admin", "admin"}:
        conditions.append(Transaction.user == user.id)
    if type:
        conditions.append(Transaction.type == type)
    if status:
        conditions.append(Transaction.status == status)
    if start_date:
        try: conditions.append(Transaction.created_at >= dt.fromisoformat(start_date))
        except: pass
    if end_date:
        try: conditions.append(Transaction.created_at <= dt.fromisoformat(end_date))
        except: pass

    skip = (page - 1) * limit
    total = await count(db, Transaction, *conditions)
    items = await find_all(db, Transaction, *conditions,
                           order_by=Transaction.created_at.desc(), skip=skip, limit=limit)
    return {"success": True, "data": await _enrich(db, items),
            "total": total, "page": page, "limit": limit,
            "total_pages": -(-total // limit)}


@router.get("/admin/lookup")
async def admin_lookup_user(
    email: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in {"super_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Admins only")
    target = await find_one(db, User, User.email == email)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    wallet = await _get_or_create_wallet(db, target.id)
    return {"success": True, "data": {
        "userId": target.id, "name": target.name, "email": target.email,
        "role": target.role, "phone": target.phone,
        "walletBalance": wallet.balance, "currency": wallet.currency,
    }}


@router.post("/admin-credit")
@router.post("/admin/credit")
async def admin_credit(
    body: AdminCreditRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in {"super_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Admins only")
    if body.user_id:
        target = await db.get(User, str(body.user_id))
    elif body.email:
        target = await find_one(db, User, User.email == body.email)
    else:
        raise HTTPException(status_code=400, detail="Provide user_id or email")
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    wallet = await _get_or_create_wallet(db, target.id)
    wallet.balance += body.amount
    wallet.total_earnings += body.amount
    wallet.updated_at = utcnow()
    await save(db, wallet)
    tx = await _record_transaction(db, target.id, wallet.id, body.amount, "admin_credit",
                                   description=body.reason or "Admin credit", created_by=user.id)
    return {"success": True, "message": "Credit applied",
            "balance": wallet.balance,
            "data": {
                "transactionId": tx.id,
                "recipient": {"id": target.id, "name": target.name, "email": target.email},
                "amountCredited": body.amount,
                "newBalance": wallet.balance,
            }}


def _tx(t: Transaction, users: dict = None, tenants: dict = None, estates: dict = None) -> dict:
    u = (users or {}).get(t.user)
    tn = (tenants or {}).get(t.tenant)
    e = (estates or {}).get(t.estate)
    return {
        "id": t.id, "amount": t.amount, "type": t.type, "method": t.method,
        "status": t.status, "reference": t.reference, "description": t.description,
        "created_at": t.created_at,
        "user": {"id": u.id, "name": u.name, "email": u.email} if u else None,
        "tenant": {"id": tn.id, "tenant_name": tn.tenant_name, "unit": tn.unit} if tn else None,
        "estate": {"id": e.id, "name": e.name} if e else None,
    }


async def _enrich(db: AsyncSession, items: list[Transaction]) -> list[dict]:
    user_ids = {t.user for t in items if t.user}
    tenant_ids = {t.tenant for t in items if t.tenant}
    estate_ids = {t.estate for t in items if t.estate}

    users = {}
    tenants = {}
    estates = {}

    if user_ids:
        rows = await find_all(db, User, User.id.in_(list(user_ids)))
        users = {r.id: r for r in rows}
    if tenant_ids:
        rows = await find_all(db, Tenant, Tenant.id.in_(list(tenant_ids)))
        tenants = {r.id: r for r in rows}
    if estate_ids:
        rows = await find_all(db, Estate, Estate.id.in_(list(estate_ids)))
        estates = {r.id: r for r in rows}

    return [_tx(t, users, tenants, estates) for t in items]
