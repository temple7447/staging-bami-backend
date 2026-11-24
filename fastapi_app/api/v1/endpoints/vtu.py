"""Airtime and electricity, bought through QuickPin and paid from the user's Bami wallet.

Money rules (the whole point of this file):
  * The wallet is debited first, atomically (`UPDATE ... WHERE balance >= total`),
    so two taps can't spend the same naira twice.
  * Each order is a Transaction row whose id is the QuickPin `client_reference`,
    so a retry can never buy twice.
  * QuickPin clearly refused  -> refund the wallet.
  * QuickPin unreachable / unclear -> keep the order "pending" and ask QuickPin
    again later (on the next orders fetch). We never refund an order that might
    have been delivered, and never leave one pending forever without checking.
"""
import json
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from core.contact_unique import is_valid_phone
from core.database import get_db
from core.db_helpers import find_all, find_one, save
from core.security import get_current_user
from models.base import gen_uuid
from models.notification import Notification
from models.transaction import Transaction
from models.user import User
from models.wallet import Wallet
from utils import quickpin
from utils.quickpin import QuickPinError
from utils.time_utils import utcnow

router = APIRouter(prefix="/vtu", tags=["Airtime & Electricity"])

AIRTIME, ELECTRICITY = "vtu_airtime", "vtu_electricity"
REFUND = "vtu_refund"
NETWORKS = {"mtn": "MTN", "airtel": "Airtel", "glo": "Glo", "9mobile": "9mobile"}

_cache: dict = {"at": 0.0, "data": None}


async def _catalog() -> dict:
    """QuickPin's catalog, cached for 5 minutes (their docs recommend it)."""
    if _cache["data"] and time.time() - _cache["at"] < 300:
        return _cache["data"]
    data = await quickpin.catalog()
    _cache.update(at=time.time(), data=data)
    return data


def _unavailable() -> HTTPException:
    return HTTPException(status_code=503, detail="This service isn't available right now. You have not been charged. Please try again later.")


# ── Wallet movement ─────────────────────────────────────────────────────────

async def _debit(db: AsyncSession, user_id: str, total: float) -> Wallet:
    wallet = await find_one(db, Wallet, Wallet.user_id == user_id)
    if not wallet:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance")
    res = await db.execute(
        update(Wallet)
        .where(Wallet.id == wallet.id, Wallet.balance >= total)
        .values(balance=Wallet.balance - total, total_spent=Wallet.total_spent + total, updated_at=utcnow())
    )
    await db.commit()
    if res.rowcount == 0:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance")
    return wallet


async def _refund(db: AsyncSession, tx: Transaction, reason: str) -> None:
    """Idempotent: a transaction that is already failed is never refunded twice."""
    res = await db.execute(
        update(Transaction).where(Transaction.id == tx.id, Transaction.status == "pending").values(status="failed", notes=_meta_with(tx, error=reason))
    )
    await db.commit()
    if res.rowcount == 0:
        return
    await db.execute(
        update(Wallet)
        .where(Wallet.id == tx.wallet_id)
        .values(balance=Wallet.balance + tx.amount, total_spent=Wallet.total_spent - tx.amount, updated_at=utcnow())
    )
    await db.commit()
    await save(db, Transaction(
        id=gen_uuid(), user=tx.user, wallet_id=tx.wallet_id, amount=tx.amount, type=REFUND, status="completed",
        method="wallet", reference=f"{tx.reference}-REFUND", description=f"Refund – {tx.description}", created_by=tx.user,
    ))
    await _notify(db, tx.user, "Order refunded", f"We could not complete “{tx.description}”. ₦{tx.amount:,.0f} is back in your wallet.")
    await db.refresh(tx)


async def _notify(db: AsyncSession, user_id: str, title: str, message: str) -> None:
    await save(db, Notification(id=gen_uuid(), user=user_id, title=title, message=message, type="vtu"))


# ── Order bookkeeping ───────────────────────────────────────────────────────

def _meta(tx: Transaction) -> dict:
    try:
        return json.loads(tx.notes or "{}")
    except ValueError:
        return {}


def _meta_with(tx: Transaction, **extra) -> str:
    m = _meta(tx)
    m.update({k: v for k, v in extra.items() if v is not None})
    return json.dumps(m)


def _order_dict(tx: Transaction) -> dict:
    m = _meta(tx)
    return {
        "id": tx.id, "kind": "airtime" if tx.type == AIRTIME else "electricity",
        "status": {"completed": "completed", "failed": "failed"}.get(tx.status, "pending"),
        "amount": tx.amount, "description": tx.description, "reference": tx.reference,
        "token": m.get("token"), "meter_number": m.get("meter_number"), "phone": m.get("phone"),
        "customer_name": m.get("customer_name"), "created_at": tx.created_at.isoformat() if tx.created_at else None,
    }


async def _complete(db: AsyncSession, tx: Transaction, data: dict) -> None:
    token = data.get("token")
    tx.status = "completed"
    tx.notes = _meta_with(tx, token=token, qp_reference=data.get("reference"))
    await save(db, tx)
    if tx.type == ELECTRICITY and token:
        await _notify(db, tx.user, "Electricity token ready", f"{tx.description}. Token: {token}")
    else:
        await _notify(db, tx.user, "Purchase successful", f"{tx.description} — ₦{tx.amount:,.0f}.")


async def _settle(db: AsyncSession, tx: Transaction) -> None:
    """Ask QuickPin what became of a pending order and book the answer."""
    if tx.status != "pending":
        return
    try:
        code, data = await quickpin.order_status(tx.id)
    except QuickPinError as e:
        if e.status == 404 or e.code == "not_found":
            await _refund(db, tx, "never reached the provider")   # order was not placed
        elif e.status == 422:
            await _refund(db, tx, e.message[:200])                  # provider failed it (and refunded us)
        return                                                       # unclear -> stay pending, try again later
    if code == 200:
        m = _meta(tx)
        if tx.type == ELECTRICITY and not data.get("token"):
            # The status call doesn't always carry the token — replaying the same
            # client_reference returns the original order (never buys twice).
            try:
                _, full = await quickpin.buy_electricity(
                    m["disco"], m["meter_type"], m["meter_number"], int(m["units"]), m["phone"], tx.id)
                data = {**data, **full}
            except (QuickPinError, KeyError):
                pass
        await _complete(db, tx, data)


# ── Schemas ─────────────────────────────────────────────────────────────────

class AirtimeBody(BaseModel):
    network: Literal["mtn", "airtel", "glo", "9mobile"]
    amount: int = Field(..., ge=1)
    phone: str | None = None


class MeterBody(BaseModel):
    disco: str = Field(..., min_length=2, max_length=60)
    meter_type: Literal["prepaid", "postpaid"]
    meter_number: str = Field(..., min_length=5, max_length=20, pattern=r"^\d+$")


class ElectricityBody(MeterBody):
    amount: int = Field(..., ge=1)
    phone: str | None = None


def _phone(body_phone: str | None, user: User) -> str:
    phone = (body_phone or user.phone or "").strip()
    if not is_valid_phone(phone):
        raise HTTPException(status_code=400, detail="Enter a valid phone number")
    return phone


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/catalog")
async def get_catalog(user: User = Depends(get_current_user)):
    if not quickpin.configured():
        return {"success": True, "data": {"available": False}}
    try:
        cat = await _catalog()
    except QuickPinError:
        return {"success": True, "data": {"available": False}}
    air, el = cat.get("airtime") or {}, cat.get("electricity") or {}
    return {"success": True, "data": {
        "available": True,
        "airtime": {"available": bool(air.get("available", True)), "min": air.get("min", 100), "max": air.get("max", 10000),
                    "networks": [{"id": n["id"], "name": n["name"]} for n in cat.get("networks", []) if n.get("id") in NETWORKS]},
        "electricity": {"available": bool(el.get("discos")), "min": el.get("min", 1000), "max": el.get("max", 200000),
                        "service_fee": el.get("service_fee", 0), "discos": el.get("discos", [])},
    }}


@router.post("/electricity/verify")
async def verify_meter(body: MeterBody, user: User = Depends(get_current_user)):
    if not quickpin.configured():
        raise _unavailable()
    try:
        r = await quickpin.verify_meter(body.disco, body.meter_type, body.meter_number)
    except QuickPinError as e:
        if e.code == "invalid_meter":
            raise HTTPException(status_code=422, detail="We couldn't find that meter. Check the number, type and company.")
        raise _unavailable()
    return {"success": True, "data": {
        "valid": bool(r.get("valid", True)), "customer_name": r.get("customer_name"), "address": r.get("address"),
        "minimum_amount": r.get("minimum_amount"), "service_fee": r.get("service_fee"),
    }}


async def _place(db: AsyncSession, user: User, *, kind: str, total: float, description: str, meta: dict, call) -> dict:
    """Debit -> record -> buy -> book. `call(tx_id)` performs the QuickPin purchase."""
    wallet = await _debit(db, user.id, total)
    tx = Transaction(
        id=gen_uuid(), user=user.id, wallet_id=wallet.id, amount=total, type=kind, status="pending",
        method="wallet", description=description, created_by=user.id, notes=json.dumps(meta),
    )
    tx.reference = f"VTU-{tx.id[:8].upper()}"
    await save(db, tx)
    try:
        code, data = await call(tx.id)
    except QuickPinError as e:
        if e.definite:
            await _refund(db, tx, e.message[:200])
            if e.code in ("insufficient_balance", "missing_api_key", "invalid_api_key", "account_suspended", "not_configured"):
                raise HTTPException(status_code=503, detail="This service isn't available right now. Your wallet has been refunded.")
            raise HTTPException(status_code=502, detail="We couldn't complete that purchase. Your wallet has been refunded.")
        return {"success": True, "message": "Your order is being processed. We'll update it here shortly.", "data": _order_dict(tx)}
    if code == 200 and data.get("status") == "success":
        await _complete(db, tx, data)
        return {"success": True, "message": "Purchase successful", "data": _order_dict(tx)}
    return {"success": True, "message": "Your order is being processed. We'll update it here shortly.", "data": _order_dict(tx)}


@router.post("/airtime")
async def buy_airtime(body: AirtimeBody, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if not quickpin.configured():
        raise _unavailable()
    phone = _phone(body.phone, user)
    try:
        air = (await _catalog()).get("airtime") or {}
    except QuickPinError:
        raise _unavailable()
    if not air.get("available", True):
        raise _unavailable()
    lo, hi = air.get("min", 100), air.get("max", 10000)
    if not lo <= body.amount <= hi:
        raise HTTPException(status_code=400, detail=f"Airtime must be between ₦{lo:,} and ₦{hi:,}")
    return await _place(
        db, user, kind=AIRTIME, total=float(body.amount),
        description=f"{NETWORKS[body.network]} airtime for {phone}",
        meta={"network": body.network, "phone": phone, "units": body.amount},
        call=lambda ref: quickpin.buy_airtime(body.network, body.amount, phone, ref),
    )


@router.post("/electricity")
async def buy_electricity(body: ElectricityBody, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if not quickpin.configured():
        raise _unavailable()
    phone = _phone(body.phone, user)
    try:
        el = (await _catalog()).get("electricity") or {}
    except QuickPinError:
        raise _unavailable()
    lo, hi, fee = el.get("min", 1000), el.get("max", 200000), float(el.get("service_fee", 0))
    if body.disco not in {d.get("id") for d in el.get("discos", [])}:
        raise HTTPException(status_code=400, detail="Choose your electricity company")
    if not lo <= body.amount <= hi:
        raise HTTPException(status_code=400, detail=f"Electricity must be between ₦{lo:,} and ₦{hi:,}")
    # Check the meter before taking money.
    try:
        info = await quickpin.verify_meter(body.disco, body.meter_type, body.meter_number)
    except QuickPinError as e:
        if e.code == "invalid_meter":
            raise HTTPException(status_code=422, detail="We couldn't find that meter. Check the number, type and company.")
        raise _unavailable()
    name = next((d.get("name") for d in el.get("discos", []) if d.get("id") == body.disco), body.disco)
    return await _place(
        db, user, kind=ELECTRICITY, total=body.amount + fee,
        description=f"{name} {body.meter_type} · {body.meter_number}",
        meta={"disco": body.disco, "meter_type": body.meter_type, "meter_number": body.meter_number, "phone": phone,
              "units": body.amount, "fee": fee, "customer_name": info.get("customer_name")},
        call=lambda ref: quickpin.buy_electricity(body.disco, body.meter_type, body.meter_number, body.amount, phone, ref),
    )


@router.get("/orders")
async def my_orders(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = await find_all(db, Transaction, Transaction.user == user.id, Transaction.type.in_([AIRTIME, ELECTRICITY]),
                          order_by=Transaction.created_at.desc(), limit=50)
    for tx in [t for t in rows if t.status == "pending"][:5]:
        await _settle(db, tx)
    return {"success": True, "data": [_order_dict(t) for t in rows]}
