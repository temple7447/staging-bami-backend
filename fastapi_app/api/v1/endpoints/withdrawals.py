from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime
from typing import Optional
from pydantic import BaseModel

from models.withdrawal import Withdrawal
from models.wallet import Wallet
from models.user import User
from core.security import get_current_user
from core.database import get_db
from core.db_helpers import find_all, find_one, save, count
from models.base import gen_uuid
from utils.time_utils import utcnow

router = APIRouter(prefix="/withdrawals", tags=["Withdrawals"])


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
    wallet = await find_one(db, Wallet, Wallet.user_id == user.id)
    if not wallet or wallet.balance < body.amount:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance")

    bank_details = body.bank_details or {
        "bank_name": body.bank_name, "account_number": body.account_number, "account_name": body.account_name
    }
    w = Withdrawal(
        id=gen_uuid(),
        user=user.id,
        amount=body.amount,
        bank_details=bank_details,
        notes=body.notes or body.reason,
        status="pending",
    )
    await save(db, w)
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
    w.status = body.get("status", w.status)
    w.reviewed_by = user.id
    w.reviewed_at = utcnow()
    w.updated_at = utcnow()
    await save(db, w)
    return {"success": True, "data": _w(w)}


def _w(w: Withdrawal) -> dict:
    return {
        "id": w.id, "user": w.user, "amount": w.amount,
        "bank_details": w.bank_details, "status": w.status,
        "notes": w.notes, "reviewed_by": w.reviewed_by,
        "reviewed_at": w.reviewed_at, "created_at": w.created_at,
    }
