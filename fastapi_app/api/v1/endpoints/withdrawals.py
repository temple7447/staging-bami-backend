from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime
from typing import Optional
from pydantic import BaseModel

from models.withdrawal import Withdrawal
from models.wallet import Wallet
from models.user import User
from models.transaction import Transaction
from core.security import get_current_user
from core.database import get_db
from core.db_helpers import find_all, find_one, save, count
from models.base import gen_uuid
from utils.time_utils import utcnow

router = APIRouter(prefix="/withdrawals", tags=["Withdrawals"])

REFUND_STATES = {"rejected", "declined", "cancelled", "canceled", "failed"}


def _hold_ref(wid: str) -> str:
    return f"WDL-HOLD-{wid}"


def _refund_ref(wid: str) -> str:
    return f"WDL-REFUND-{wid}"


class WithdrawalRequest(BaseModel):
    amount: float
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    account_name: Optional[str] = None
    bank_details: Optional[dict] = None
    reason: Optional[str] = None
    notes: Optional[str] = None


@router.post("", status_code=201)
@router.post("/request", status_code=201)
async def request_withdrawal(
    body: WithdrawalRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    wallet = await find_one(db, Wallet, Wallet.user_id == user.id)
    if not wallet or wallet.balance < body.amount:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance")

    bank_details = body.bank_details or {
        "bank_name": body.bank_name, "account_number": body.account_number, "account_name": body.account_name
    }
    wid = gen_uuid()
    # Place a HOLD: debit the wallet now so the same balance can't be
    # requested for withdrawal twice. Refunded if the request is rejected.
    wallet.balance -= body.amount
    wallet.total_spent += body.amount
    wallet.updated_at = utcnow()
    w = Withdrawal(
        id=wid,
        user=user.id,
        amount=body.amount,
        bank_details=bank_details,
        notes=body.notes or body.reason,
        status="pending",
    )
    hold_tx = Transaction(
        id=gen_uuid(), user=user.id, wallet_id=wallet.id, amount=body.amount,
        type="withdrawal_hold", method="bank_transfer", status="pending",
        reference=_hold_ref(wid), description="Withdrawal request (held)", created_by=user.id,
    )
    db.add_all([wallet, w, hold_tx])
    await db.commit()
    await db.refresh(w)
    return {"success": True, "message": "Withdrawal request submitted", "data": _w(w)}


@router.get("/my")
async def my_withdrawals(
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    skip = (page - 1) * limit
    total = await count(db, Withdrawal, Withdrawal.user == user.id)
    items = await find_all(db, Withdrawal, Withdrawal.user == user.id,
                           order_by=Withdrawal.created_at.desc(), skip=skip, limit=limit)
    return {"success": True, "count": total, "total": total,
            "total_pages": -(-total // limit), "page": page,
            "data": [_w(w) for w in items]}


@router.put("/{wid}/status")
@router.patch("/{wid}/status")
async def update_status(
    wid: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in {"super_admin", "admin"}:
        raise HTTPException(status_code=403, detail="Admins only")
    w = await find_one(db, Withdrawal, Withdrawal.id == wid)
    if not w:
        raise HTTPException(status_code=404, detail="Withdrawal not found")

    new_status = (body.get("status") or w.status or "").lower()
    to_add = [w]

    # Rejecting a held request returns the money. Tie the refund to the actual
    # hold transaction (and guard against a second refund) so it can never
    # credit money that was not previously debited.
    if new_status in REFUND_STATES:
        hold = await find_one(db, Transaction, Transaction.reference == _hold_ref(wid),
                              Transaction.type == "withdrawal_hold")
        already = await find_one(db, Transaction, Transaction.reference == _refund_ref(wid),
                                 Transaction.type == "withdrawal_refund")
        if hold and not already:
            wallet = await find_one(db, Wallet, Wallet.user_id == w.user)
            if wallet:
                wallet.balance += w.amount
                wallet.total_spent -= w.amount  # reverse the hold
                wallet.updated_at = utcnow()
                to_add.append(wallet)
                to_add.append(Transaction(
                    id=gen_uuid(), user=w.user, wallet_id=wallet.id, amount=w.amount,
                    type="withdrawal_refund", method="bank_transfer", status="completed",
                    reference=_refund_ref(wid), description="Withdrawal rejected — refunded",
                    created_by=user.id,
                ))

    w.status = new_status
    w.reviewed_by = user.id
    w.reviewed_at = utcnow()
    w.updated_at = utcnow()
    db.add_all(to_add)
    await db.commit()
    await db.refresh(w)
    return {"success": True, "data": _w(w)}


def _w(w: Withdrawal) -> dict:
    return {
        "id": w.id, "user": w.user, "amount": w.amount,
        "bank_details": w.bank_details, "status": w.status,
        "notes": w.notes, "reviewed_by": w.reviewed_by,
        "reviewed_at": w.reviewed_at, "created_at": w.created_at,
    }
