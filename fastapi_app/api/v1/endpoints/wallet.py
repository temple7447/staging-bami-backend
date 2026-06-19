from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import datetime
from bson import ObjectId
import time

from models.user import User
from models.wallet import Wallet
from models.wallet_account import WalletAccount
from models.transaction import Transaction
from models.withdrawal import Withdrawal
from models.estate import Estate
from schemas.wallet import (
    CreateWalletRequest, AddFundsRequest, DeductFundsRequest,
    WalletTransactionRequest, AdminCreditRequest
)
from core.security import get_current_user
from core.config import settings

router = APIRouter(prefix="/wallet", tags=["Wallet"])

ADMIN_ROLES = {"admin", "super_admin", "super_manager", "business_owner"}


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_or_create_wallet(user_id: ObjectId) -> Wallet:
    wallet = await Wallet.find_one({"user_id": user_id})
    if not wallet:
        wallet = Wallet(user_id=user_id, balance=0.0, currency="NGN")
        await wallet.insert()
    return wallet


async def _record_transaction(user_id, wallet_id, amount: float, tx_type: str,
                               method: str = "other", reference: str = "",
                               description: str = "", created_by=None) -> Transaction:
    tx = Transaction(
        user=user_id,
        wallet_id=wallet_id,
        amount=amount,
        type=tx_type,
        method=method,
        status="completed",
        reference=reference or f"{tx_type.upper()[:3]}-{int(time.time() * 1000)}",
        description=description,
        created_by=created_by or user_id,
    )
    await tx.insert()
    return tx


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/")
async def get_wallet(user: User = Depends(get_current_user)):
    wallet = await _get_or_create_wallet(user.id)
    return {"success": True, "data": {**wallet.model_dump(), "currency_symbol": "₦", "currency": "NGN"}}


@router.post("/")
async def create_wallet(body: CreateWalletRequest, user: User = Depends(get_current_user)):
    target_user = await User.get(body.user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    existing = await Wallet.find_one({"user_id": ObjectId(body.user_id)})
    if existing:
        raise HTTPException(status_code=400, detail="Wallet already exists for this user")

    wallet = Wallet(user_id=ObjectId(body.user_id), balance=0.0, currency="NGN")
    await wallet.insert()
    return {"success": True, "message": "Wallet created successfully", "data": wallet.model_dump()}


@router.post("/add-funds")
async def add_funds(body: AddFundsRequest, user: User = Depends(get_current_user)):
    if body.amount < 100:
        raise HTTPException(status_code=400, detail="Minimum deposit is ₦100")

    # Initiate Paystack payment (Phase 6 will wire real Paystack calls)
    # For now: return the structure that the frontend expects
    callback_url = f"{settings.FRONTEND_URL}/wallet/verify"
    paystack_payload = {
        "email":        user.email,
        "amount":       int(body.amount * 100),
        "callback_url": callback_url,
        "metadata": {
            "user_id":      str(user.id),
            "payment_type": "wallet_deposit",
        }
    }

    # TODO (Phase 6): call Paystack API here
    # import httpx
    # async with httpx.AsyncClient() as client:
    #     resp = await client.post("https://api.paystack.co/transaction/initialize",
    #                              json=paystack_payload,
    #                              headers={"Authorization": f"Bearer {settings.PAYSTACK_SECRET_KEY}"})
    #     return {"success": True, "data": resp.json()["data"]}

    return {
        "success": True,
        "message": "Paystack integration pending (Phase 6)",
        "data": {"amount": body.amount, "currency": "NGN"}
    }


@router.post("/deduct-funds")
async def deduct_funds(body: DeductFundsRequest, user: User = Depends(get_current_user)):
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0")

    wallet = await _get_or_create_wallet(user.id)
    if wallet.balance < body.amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")

    wallet.balance    -= body.amount
    wallet.total_spent += body.amount
    wallet.updated_at  = datetime.utcnow()
    await wallet.save()

    # TODO (Phase 6): send withdrawal email notification

    return {"success": True, "message": "Funds deducted successfully",
            "data": {**wallet.model_dump(), "currency_symbol": "₦"}}


@router.get("/transactions")
async def get_transaction_history(user: User = Depends(get_current_user)):
    coll  = Transaction.get_motor_collection()
    items = await coll.find({"user": user.id, "is_active": True}).sort("created_at", -1).to_list(200)
    return {"success": True, "count": len(items), "data": items}


@router.get("/transactions/list")
async def list_all_transactions(
    page:       int = 1,
    limit:      int = 20,
    type:       str | None = None,
    status_:    str | None = Query(None, alias="status"),
    search:     str | None = None,
    start_date: str | None = None,
    end_date:   str | None = None,
    user: User = Depends(get_current_user),
):
    role = user.role
    f: dict = {"is_active": True}

    if role == "super_admin":
        pass  # see all
    elif role in ("admin", "super_manager"):
        ecoll = Estate.get_motor_collection()
        estates = await ecoll.find({"managers": user.id, "is_active": True}, {"_id": 1}).to_list(None)
        f["estate"] = {"$in": [e["_id"] for e in estates]}
    elif role == "business_owner":
        estate_ids = getattr(user, "assigned_estates", []) or []
        f["estate"] = {"$in": estate_ids}
    else:
        f["user"] = user.id

    if type:    f["type"]   = type
    if status_: f["status"] = status_
    if start_date or end_date:
        f["created_at"] = {}
        if start_date: f["created_at"]["$gte"] = datetime.fromisoformat(start_date)
        if end_date:   f["created_at"]["$lte"] = datetime.fromisoformat(end_date)
    if search:
        f["$or"] = [
            {"description": {"$regex": search, "$options": "i"}},
            {"reference":   {"$regex": search, "$options": "i"}},
        ]

    coll  = Transaction.get_motor_collection()
    total = await coll.count_documents(f)
    skip  = (page - 1) * limit
    items = await coll.find(f).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)

    return {"success": True, "count": len(items), "total": total,
            "page": page, "pages": -(-total // limit), "data": items}


@router.post("/transaction")
async def process_wallet_transaction(body: WalletTransactionRequest, user: User = Depends(get_current_user)):
    wallet = await _get_or_create_wallet(user.id)

    if body.type == "deposit":
        wallet.balance        += body.amount
        wallet.total_earnings += body.amount
        wallet.updated_at      = datetime.utcnow()
        await wallet.save()

        tx = await _record_transaction(
            user.id, wallet.id, body.amount, "deposit",
            description=body.description or "Wallet deposit",
        )
        return {"success": True, "message": "Deposit successful",
                "data": {"transaction": str(tx.id), "amount": body.amount,
                          "new_balance": wallet.balance, "type": "deposit"}}

    elif body.type == "withdraw":
        if wallet.balance < body.amount:
            raise HTTPException(status_code=400, detail="Insufficient balance")

        bank = body.bank_details
        withdrawal = Withdrawal(
            user=user.id,
            amount=body.amount,
            bank_details=bank.model_dump() if bank else {},
            status="pending",
            reference=f"WD-{int(time.time() * 1000)}",
        )
        await withdrawal.insert()

        wallet.balance    -= body.amount
        wallet.total_spent += body.amount
        wallet.updated_at  = datetime.utcnow()
        await wallet.save()

        tx = await _record_transaction(
            user.id, wallet.id, body.amount, "withdrawal", method="bank",
            reference=withdrawal.reference,
            description=body.description or "Wallet withdrawal",
        )
        return {"success": True, "message": "Withdrawal request submitted",
                "data": {"withdrawal": str(withdrawal.id), "amount": body.amount,
                          "new_balance": wallet.balance, "status": "pending", "type": "withdraw"}}

    elif body.type == "transfer":
        if wallet.balance < body.amount:
            raise HTTPException(status_code=400, detail="Insufficient balance")

        if body.recipient_type == "estate":
            estate_id = body.recipient_id or body.recipient_email
            if not estate_id:
                raise HTTPException(status_code=400, detail="Estate ID required for estate transfers")
            estate_wallet = await WalletAccount.find_one({"estate": ObjectId(estate_id)})
            if not estate_wallet:
                raise HTTPException(status_code=404, detail="Estate wallet not found")

            wallet.balance    -= body.amount
            wallet.total_spent += body.amount
            wallet.updated_at  = datetime.utcnow()
            await wallet.save()

            # TODO: call estate_wallet.distribute_amount(body.amount)
            estate_wallet.total_received = (estate_wallet.total_received or 0) + body.amount
            await estate_wallet.save()
        else:
            # User-to-user transfer
            recipient_user = None
            if body.recipient_email:
                recipient_user = await User.find_one({"email": body.recipient_email})
            elif body.recipient_id:
                recipient_user = await User.get(body.recipient_id)

            if not recipient_user:
                raise HTTPException(status_code=404, detail="Recipient not found")
            if str(recipient_user.id) == str(user.id):
                raise HTTPException(status_code=400, detail="Cannot transfer to yourself")

            recipient_wallet = await _get_or_create_wallet(recipient_user.id)
            wallet.balance         -= body.amount
            wallet.total_spent      += body.amount
            wallet.updated_at       = datetime.utcnow()
            await wallet.save()

            recipient_wallet.balance        += body.amount
            recipient_wallet.total_earnings += body.amount
            recipient_wallet.updated_at      = datetime.utcnow()
            await recipient_wallet.save()

            await _record_transaction(
                recipient_user.id, recipient_wallet.id, body.amount, "deposit", method="transfer",
                description=f"Transfer received from {user.name}",
            )

        tx = await _record_transaction(
            user.id, wallet.id, body.amount, "transfer", method="transfer",
            description=body.description or "Wallet transfer",
        )
        return {"success": True, "message": "Transfer successful",
                "data": {"transaction": str(tx.id), "amount": body.amount,
                          "new_balance": wallet.balance, "type": "transfer"}}

    raise HTTPException(status_code=400, detail="Invalid transaction type (deposit | withdraw | transfer)")


@router.get("/admin/lookup")
async def admin_lookup_user(email: str = Query(...), user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized")

    target = await User.find_one({"email": email.lower().strip()})
    if not target:
        raise HTTPException(status_code=404, detail="No user found with that email address")

    wallet = await Wallet.find_one({"user_id": target.id})
    return {"success": True, "data": {
        "user_id":       str(target.id),
        "name":          target.name,
        "email":         target.email,
        "role":          target.role,
        "wallet_balance": wallet.balance if wallet else 0,
        "currency":      "NGN",
    }}


@router.post("/admin/credit")
async def admin_credit_wallet(body: AdminCreditRequest, user: User = Depends(get_current_user)):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized to credit wallets")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be a positive number")

    recipient = await User.find_one({"email": body.email.lower().strip()})
    if not recipient:
        raise HTTPException(status_code=404, detail="User not found")

    wallet = await _get_or_create_wallet(recipient.id)
    wallet.balance        += body.amount
    wallet.total_earnings += body.amount
    wallet.updated_at      = datetime.utcnow()
    await wallet.save()

    tx = await _record_transaction(
        recipient.id, wallet.id, body.amount, "deposit", method="other",
        reference=f"ADM-{int(time.time() * 1000)}",
        description=body.reason or f"Admin wallet credit by {user.name or user.email}",
        created_by=user.id,
    )

    # TODO (Phase 6): send credit notification email

    return {"success": True,
            "message": f"Successfully credited ₦{body.amount:,.0f} to {recipient.name or recipient.email}'s wallet",
            "data": {
                "transaction_id": str(tx.id),
                "recipient":      {"id": str(recipient.id), "name": recipient.name, "email": recipient.email},
                "amount_credited": body.amount,
                "new_balance":    wallet.balance,
            }}
