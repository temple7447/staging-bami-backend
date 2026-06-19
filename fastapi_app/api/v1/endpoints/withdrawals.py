from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime
from bson import ObjectId
from pydantic import BaseModel
from typing import Optional

from models.user import User
from models.withdrawal import Withdrawal
from models.wallet import Wallet
from core.security import get_current_user

router = APIRouter(prefix="/withdrawals", tags=["Withdrawals"])

ADMIN_ROLES = {"super_admin", "admin"}


class WithdrawalRequest(BaseModel):
    amount:       float
    bank_details: Optional[dict] = None
    notes:        Optional[str] = None


class StatusUpdate(BaseModel):
    status: str  # approved | rejected | completed
    notes:  Optional[str] = None


@router.post("/request", status_code=201)
async def request_withdrawal(body: WithdrawalRequest, user: User = Depends(get_current_user)):
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")

    wallet = await Wallet.find_one({"user_id": user.id})
    if not wallet or wallet.balance < body.amount:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance")

    import time
    w = Withdrawal(
        user=user.id,
        amount=body.amount,
        bank_details=body.bank_details or {},
        status="pending",
        reference=f"WD-{int(time.time() * 1000)}",
        notes=body.notes,
    )
    await w.insert()
    return {"success": True, "message": "Withdrawal request submitted", "data": w.model_dump()}


@router.get("/my")
async def get_my_withdrawals(user: User = Depends(get_current_user)):
    coll  = Withdrawal.get_motor_collection()
    items = await coll.find({"user": user.id, "is_active": True}).sort("created_at", -1).to_list(50)
    return {"success": True, "count": len(items), "data": items}


@router.put("/{withdrawal_id}/status")
async def update_withdrawal_status(
    withdrawal_id: str, body: StatusUpdate, user: User = Depends(get_current_user)
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    coll   = Withdrawal.get_motor_collection()
    result = await coll.find_one_and_update(
        {"_id": ObjectId(withdrawal_id), "is_active": True},
        {"$set": {"status": body.status, "notes": body.notes,
                  "reviewed_by": user.id, "reviewed_at": datetime.utcnow(),
                  "updated_at": datetime.utcnow()}},
        return_document=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Withdrawal not found")
    return {"success": True, "message": f"Withdrawal {body.status}", "data": result}
