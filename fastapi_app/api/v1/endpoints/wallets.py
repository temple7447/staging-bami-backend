from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from models.user import User
from models.wallet import Wallet
from models.wallet_account import WalletAccount
from core.security import get_current_user
from core.database import get_db
from core.db_helpers import find_all, find_one

router = APIRouter(prefix="/wallets", tags=["Wallets"])
ADMIN_ROLES = {"super_admin", "admin", "super_manager", "business_owner"}


@router.get("/global-summary")
async def get_global_wallet_summary(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    accounts = await find_all(db, WalletAccount, WalletAccount.is_active == True)

    g_mkt = sum(a.growth_engine_marketing_balance for a in accounts)
    g_ops = sum(a.growth_engine_operations_balance for a in accounts)
    g_sav = sum(a.growth_engine_savings_balance for a in accounts)
    g_tot = g_mkt + g_ops + g_sav

    f_mkt = sum(a.fulfillment_engine_marketing_balance for a in accounts)
    f_ops = sum(a.fulfillment_engine_operations_balance for a in accounts)
    f_sav = sum(a.fulfillment_engine_savings_balance for a in accounts)
    f_tot = f_mkt + f_ops + f_sav

    i_mkt = sum(a.innovation_engine_marketing_balance for a in accounts)
    i_ops = sum(a.innovation_engine_operations_balance for a in accounts)
    i_sav = sum(a.innovation_engine_savings_balance for a in accounts)
    i_tot = i_mkt + i_ops + i_sav

    total_balance = g_tot + f_tot + i_tot
    total_received = sum(a.total_received for a in accounts)
    total_marketing = g_mkt + f_mkt + i_mkt
    total_operations = g_ops + f_ops + i_ops
    total_savings = g_sav + f_sav + i_sav

    return {
        "success": True,
        "data": {
            # snake_case — middleware converts to camelCase for frontend
            "growth_engine": {
                "marketing": {"name": "Growth Marketing", "balance": g_mkt, "percentage": 50},
                "operations": {"name": "Growth Operations", "balance": g_ops, "percentage": 30},
                "savings": {"name": "Growth Savings", "balance": g_sav, "percentage": 20},
                "total": g_tot,
                "percentage": 50,
            },
            "fulfillment_engine": {
                "marketing": {"name": "Fulfillment Marketing", "balance": f_mkt, "percentage": 50},
                "operations": {"name": "Fulfillment Operations", "balance": f_ops, "percentage": 30},
                "savings": {"name": "Family Savings", "balance": f_sav, "percentage": 20},
                "total": f_tot,
                "percentage": 30,
            },
            "innovation_engine": {
                "marketing": {"name": "Innovation Marketing", "balance": i_mkt, "percentage": 50},
                "operations": {"name": "Innovation Operations", "balance": i_ops, "percentage": 30},
                "savings": {"name": "Innovation Savings", "balance": i_sav, "percentage": 20},
                "total": i_tot,
                "percentage": 20,
            },
            "summary": {
                "total_balance": total_balance,
                "total_received": total_received,
                "total_marketing": total_marketing,
                "total_operations": total_operations,
                "total_savings": total_savings,
            },
        },
    }


@router.get("/{user_id}")
async def get_wallet_by_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES and user.id != user_id:
        raise HTTPException(status_code=403, detail="Access denied")
    wallet = await find_one(db, Wallet, Wallet.user_id == user_id)
    if not wallet:
        raise HTTPException(status_code=404, detail="Wallet not found")
    return {"success": True, "data": {
        "id": wallet.id, "user_id": wallet.user_id,
        "balance": wallet.balance, "total_earnings": wallet.total_earnings,
        "total_spent": wallet.total_spent, "currency": wallet.currency,
    }}
