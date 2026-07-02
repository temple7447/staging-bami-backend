from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime
from pydantic import BaseModel
from typing import Optional

from models.user import User
from models.wallet_account import WalletAccount
from models.estate import Estate
from core.security import get_current_user
from core.database import get_db
from core.db_helpers import find_one, find_all, save
from models.base import gen_uuid
from utils.time_utils import utcnow

router = APIRouter(prefix="/distribution", tags=["Distribution"])
ADMIN_ROLES = {"super_admin", "admin", "super_manager", "business_owner"}


async def _get_or_create_wallet(db: AsyncSession, estate_id: str) -> WalletAccount:
    wa = await find_one(db, WalletAccount, WalletAccount.estate == estate_id, WalletAccount.is_active == True)
    if not wa:
        wa = WalletAccount(id=gen_uuid(), estate=estate_id)
        await save(db, wa)
    return wa


@router.get("/global-summary")
async def get_global_summary(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    accounts = await find_all(db, WalletAccount, WalletAccount.is_active == True)
    total_balance = sum(a.total_balance for a in accounts)
    return {
        "success": True,
        "data": {
            "total_accounts": len(accounts),
            "total_balance": total_balance,
            "total_marketing": sum(a.total_marketing for a in accounts),
            "total_operations": sum(a.total_operations for a in accounts),
            "total_savings": sum(a.total_savings for a in accounts),
        }
    }


@router.get("/{estate_id}/wallet/balance")
async def get_wallet_balance(estate_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    wa = await _get_or_create_wallet(db, estate_id)
    return {"success": True, "data": {"total_balance": wa.total_balance, "currency": wa.currency}}


@router.get("/{estate_id}/wallet/history")
async def get_wallet_history(estate_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    wa = await _get_or_create_wallet(db, estate_id)
    return {"success": True, "data": wa.distribution_log or []}


@router.get("/{estate_id}/wallet/preview")
async def preview_distribution(estate_id: str, amount: float = 0, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    g = amount * 0.50; f = amount * 0.30; i = amount * 0.20
    return {"success": True, "data": {
        "amount": amount,
        "growthEngine":      {"total": g, "marketing": g*0.50, "operations": g*0.30, "savings": g*0.20},
        "fulfillmentEngine": {"total": f, "marketing": f*0.50, "operations": f*0.30, "savings": f*0.20},
        "innovationEngine":  {"total": i, "marketing": i*0.50, "operations": i*0.30, "savings": i*0.20},
    }}


@router.get("/{estate_id}/wallet/growth-engine")
async def get_growth_engine(estate_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    wa = await _get_or_create_wallet(db, estate_id)
    return {"success": True, "data": {
        "marketing": wa.growth_engine_marketing_balance,
        "operations": wa.growth_engine_operations_balance,
        "savings": wa.growth_engine_savings_balance,
        "total": wa.growth_engine_marketing_balance + wa.growth_engine_operations_balance + wa.growth_engine_savings_balance,
    }}


@router.get("/{estate_id}/wallet/fulfillment-engine")
async def get_fulfillment_engine(estate_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    wa = await _get_or_create_wallet(db, estate_id)
    return {"success": True, "data": {
        "marketing": wa.fulfillment_engine_marketing_balance,
        "operations": wa.fulfillment_engine_operations_balance,
        "savings": wa.fulfillment_engine_savings_balance,
        "total": wa.fulfillment_engine_marketing_balance + wa.fulfillment_engine_operations_balance + wa.fulfillment_engine_savings_balance,
    }}


@router.get("/{estate_id}/wallet/innovation-engine")
async def get_innovation_engine(estate_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    wa = await _get_or_create_wallet(db, estate_id)
    return {"success": True, "data": {
        "marketing": wa.innovation_engine_marketing_balance,
        "operations": wa.innovation_engine_operations_balance,
        "savings": wa.innovation_engine_savings_balance,
        "total": wa.innovation_engine_marketing_balance + wa.innovation_engine_operations_balance + wa.innovation_engine_savings_balance,
    }}


class WithdrawRequest(BaseModel):
    engine: str
    bucket: str
    amount: float
    reason: Optional[str] = None


@router.post("/{estate_id}/wallet/withdraw")
async def withdraw_from_bucket(
    estate_id: str, body: WithdrawRequest,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    wa = await _get_or_create_wallet(db, estate_id)
    field = f"{body.engine}_{body.bucket}_balance"
    current = getattr(wa, field, None)
    if current is None:
        raise HTTPException(status_code=400, detail=f"Invalid engine/bucket: {body.engine}/{body.bucket}")
    if current < body.amount:
        raise HTTPException(status_code=400, detail="Insufficient balance in this bucket")
    setattr(wa, field, current - body.amount)
    wa.total_disbursed += body.amount
    wa.updated_at = utcnow()
    await save(db, wa)
    return {"success": True, "message": "Withdrawal successful", "remaining": getattr(wa, field)}


@router.post("/{estate_id}/wallet/family-withdraw")
async def family_withdraw(
    estate_id: str, body: dict,
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    wa = await _get_or_create_wallet(db, estate_id)
    amount = body.get("amount", 0)
    if wa.fulfillment_engine_savings_balance < amount:
        raise HTTPException(status_code=400, detail="Insufficient fulfillment savings balance")
    wa.fulfillment_engine_savings_balance -= amount
    wa.total_disbursed += amount
    wa.updated_at = utcnow()
    await save(db, wa)
    return {"success": True, "message": "Family withdrawal successful"}
