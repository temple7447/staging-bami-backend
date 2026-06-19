"""
Distribution endpoints — 50/30/20 estate wallet management.
Mirrors distributionController.js exactly.
"""
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime
from bson import ObjectId
from pydantic import BaseModel
from typing import Optional

from models.user import User
from models.wallet_account import WalletAccount
from models.estate import Estate
from core.security import get_current_user

router = APIRouter(prefix="/distribution", tags=["Distribution"])

ADMIN_ROLES = {"super_admin", "admin", "super_manager", "business_owner"}


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_or_create_wallet(estate_id) -> WalletAccount:
    wa = await WalletAccount.find_one({"estate": ObjectId(str(estate_id)), "is_active": True})
    if not wa:
        wa = WalletAccount(estate=ObjectId(str(estate_id)))
        await wa.insert()
    return wa


def _wallet_snapshot(wa: WalletAccount) -> dict:
    return {
        "growthEngine": {
            "marketing":  wa.growth_engine_marketing_balance,
            "operations": wa.growth_engine_operations_balance,
            "savings":    wa.growth_engine_savings_balance,
            "total":      (wa.growth_engine_marketing_balance +
                           wa.growth_engine_operations_balance +
                           wa.growth_engine_savings_balance),
        },
        "fulfillmentEngine": {
            "marketing":  wa.fulfillment_engine_marketing_balance,
            "operations": wa.fulfillment_engine_operations_balance,
            "savings":    wa.fulfillment_engine_savings_balance,
            "total":      (wa.fulfillment_engine_marketing_balance +
                           wa.fulfillment_engine_operations_balance +
                           wa.fulfillment_engine_savings_balance),
        },
        "innovationEngine": {
            "marketing":  wa.innovation_engine_marketing_balance,
            "operations": wa.innovation_engine_operations_balance,
            "savings":    wa.innovation_engine_savings_balance,
            "total":      (wa.innovation_engine_marketing_balance +
                           wa.innovation_engine_operations_balance +
                           wa.innovation_engine_savings_balance),
        },
        "total":          wa.total_balance,
        "totalMarketing": wa.total_marketing,
        "totalOperations":wa.total_operations,
        "totalSavings":   wa.total_savings,
        "totalReceived":  wa.total_received,
        "totalDisbursed": wa.total_disbursed,
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/global-summary")
async def get_global_wallet_summary(user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    wallets = await WalletAccount.find({"is_active": True}).to_list()
    totals  = {
        "totalBalance":    sum(w.total_balance   for w in wallets),
        "totalMarketing":  sum(w.total_marketing  for w in wallets),
        "totalOperations": sum(w.total_operations for w in wallets),
        "totalSavings":    sum(w.total_savings    for w in wallets),
        "totalReceived":   sum(w.total_received   for w in wallets),
        "totalDisbursed":  sum(w.total_disbursed  for w in wallets),
        "estateCount":     len(wallets),
    }
    return {"success": True, "data": totals}


@router.get("/{estate_id}/wallet/balance")
async def get_estate_wallet_balance(estate_id: str, user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    wa = await _get_or_create_wallet(estate_id)
    return {"success": True, "estateId": estate_id, "data": _wallet_snapshot(wa)}


@router.get("/{estate_id}/wallet/history")
async def get_estate_distribution_history(
    estate_id: str, page: int = 1, limit: int = 20, user: User = Depends(get_current_user)
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    wa = await WalletAccount.find_one({"estate": ObjectId(estate_id), "is_active": True})
    if not wa:
        return {"success": True, "data": [], "pagination": {"currentPage": page, "totalItems": 0}}

    log   = list(reversed(wa.distribution_log))
    total = len(log)
    page_data = log[(page-1)*limit : page*limit]
    return {
        "success": True, "data": page_data,
        "pagination": {"currentPage": page, "totalPages": -(-total // limit), "totalItems": total},
    }


@router.get("/{estate_id}/wallet/preview")
async def preview_distribution(estate_id: str, amount: float = 0, user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    g = amount * 0.50
    f = amount * 0.30
    i = amount * 0.20
    return {
        "success": True,
        "data": {
            "amount": amount,
            "growthEngine":      {"marketing": g*0.50, "operations": g*0.30, "savings": g*0.20, "total": g},
            "fulfillmentEngine": {"marketing": f*0.50, "operations": f*0.30, "savings": f*0.20, "total": f},
            "innovationEngine":  {"marketing": i*0.50, "operations": i*0.30, "savings": i*0.20, "total": i},
        },
    }


@router.get("/{estate_id}/wallet/growth-engine")
async def get_growth_engine_details(estate_id: str, user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    wa = await _get_or_create_wallet(estate_id)
    return {"success": True, "data": {
        "marketing":  wa.growth_engine_marketing_balance,
        "operations": wa.growth_engine_operations_balance,
        "savings":    wa.growth_engine_savings_balance,
        "total":      (wa.growth_engine_marketing_balance +
                       wa.growth_engine_operations_balance +
                       wa.growth_engine_savings_balance),
    }}


@router.get("/{estate_id}/wallet/fulfillment-engine")
async def get_fulfillment_engine_details(estate_id: str, user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    wa = await _get_or_create_wallet(estate_id)
    return {"success": True, "data": {
        "marketing":  wa.fulfillment_engine_marketing_balance,
        "operations": wa.fulfillment_engine_operations_balance,
        "savings":    wa.fulfillment_engine_savings_balance,
        "total":      (wa.fulfillment_engine_marketing_balance +
                       wa.fulfillment_engine_operations_balance +
                       wa.fulfillment_engine_savings_balance),
    }}


@router.get("/{estate_id}/wallet/innovation-engine")
async def get_innovation_engine_details(estate_id: str, user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    wa = await _get_or_create_wallet(estate_id)
    return {"success": True, "data": {
        "marketing":  wa.innovation_engine_marketing_balance,
        "operations": wa.innovation_engine_operations_balance,
        "savings":    wa.innovation_engine_savings_balance,
        "total":      (wa.innovation_engine_marketing_balance +
                       wa.innovation_engine_operations_balance +
                       wa.innovation_engine_savings_balance),
    }}


class WithdrawRequest(BaseModel):
    amount:   float
    reason:   Optional[str] = None
    wallet:   Optional[str] = None  # e.g. "fulfillmentEngine.savings" for family savings


@router.post("/{estate_id}/wallet/family-withdraw")
async def withdraw_family_savings(
    estate_id: str, body: WithdrawRequest, user: User = Depends(get_current_user)
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    wa = await _get_or_create_wallet(estate_id)
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    if wa.fulfillment_engine_savings_balance < body.amount:
        raise HTTPException(status_code=400, detail="Insufficient family savings balance")

    wa.fulfillment_engine_savings_balance -= body.amount
    wa.total_disbursed += body.amount
    wa.updated_at = datetime.utcnow()
    await wa.save()
    return {"success": True, "message": "Family savings withdrawn", "data": _wallet_snapshot(wa)}


@router.post("/{estate_id}/wallet/withdraw")
async def withdraw_from_wallet(
    estate_id: str, body: WithdrawRequest, user: User = Depends(get_current_user)
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    wa      = await _get_or_create_wallet(estate_id)
    target  = body.wallet  # e.g. "growth_engine_savings_balance"
    field   = target.replace(".", "_").replace("Engine", "_engine").lower() + "_balance" if target else None

    if field and hasattr(wa, field):
        current = getattr(wa, field)
        if current < body.amount:
            raise HTTPException(status_code=400, detail=f"Insufficient balance in {field}")
        setattr(wa, field, current - body.amount)
    else:
        # Deduct from total across all savings wallets
        if wa.total_savings < body.amount:
            raise HTTPException(status_code=400, detail="Insufficient total savings balance")
        ratio = body.amount / wa.total_savings if wa.total_savings else 0
        wa.growth_engine_savings_balance      -= wa.growth_engine_savings_balance * ratio
        wa.fulfillment_engine_savings_balance -= wa.fulfillment_engine_savings_balance * ratio
        wa.innovation_engine_savings_balance  -= wa.innovation_engine_savings_balance * ratio

    wa.total_disbursed += body.amount
    wa.updated_at = datetime.utcnow()
    await wa.save()
    return {"success": True, "message": "Withdrawal processed", "data": _wallet_snapshot(wa)}
