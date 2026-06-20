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
from schemas.wallet import (
    CreateWalletRequest, AddFundsRequest, DeductFundsRequest,
    WalletTransactionRequest, AdminCreditRequest,
)
from core.security import get_current_user
from core.database import get_db
from core.db_helpers import find_one, find_all, save, count
from core.config import settings
from models.base import gen_uuid

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


@router.get("/")
async def get_wallet(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    wallet = await _get_or_create_wallet(db, user.id)
    return {"success": True, "data": {
        "id": wallet.id, "user_id": wallet.user_id,
        "balance": wallet.balance, "total_earnings": wallet.total_earnings,
        "total_spent": wallet.total_spent, "currency": wallet.currency,
        "currency_symbol": "₦",
    }}


@router.post("/")
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
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    target_user = await db.get(User, str(body.user_id)) if hasattr(body, "user_id") else user
    wallet = await _get_or_create_wallet(db, target_user.id)
    wallet.balance += body.amount
    wallet.total_earnings += body.amount
    wallet.updated_at = datetime.utcnow()
    await save(db, wallet)
    await _record_transaction(db, target_user.id, wallet.id, body.amount, "credit",
                              description=getattr(body, "description", "Admin credit"),
                              created_by=user.id)
    return {"success": True, "message": "Funds added", "balance": wallet.balance}


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
    wallet.updated_at = datetime.utcnow()
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
    wallet.updated_at = datetime.utcnow()
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
    skip = (page - 1) * limit
    items = await find_all(db, Transaction, Transaction.user == user.id, Transaction.is_active == True,
                           order_by=Transaction.created_at.desc(), skip=skip, limit=limit)
    return {"success": True, "count": len(items), "data": [_tx(t) for t in items]}


@router.post("/admin-credit")
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
    wallet.updated_at = datetime.utcnow()
    await save(db, wallet)
    await _record_transaction(db, target.id, wallet.id, body.amount, "admin_credit",
                              description=getattr(body, "reason", "Admin credit"), created_by=user.id)
    return {"success": True, "message": "Credit applied", "balance": wallet.balance}


def _tx(t: Transaction) -> dict:
    return {
        "id": t.id, "amount": t.amount, "type": t.type, "method": t.method,
        "status": t.status, "reference": t.reference, "description": t.description,
        "created_at": t.created_at,
    }
