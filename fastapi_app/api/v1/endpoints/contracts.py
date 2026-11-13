import secrets
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from core.contact_unique import ensure_unique_contact
from core.database import get_db
from core.db_helpers import find_all, find_one, save
from core.security import get_current_user, hash_password
from models.base import gen_uuid
from models.contract import Contract
from models.notification import Notification
from models.user import User
from utils import contract_pdf, email_service
from utils.time_utils import utcnow

router = APIRouter(prefix="/contracts", tags=["Contracts"])

OWNER_ROLES = {"super_admin", "admin"}     # the paying side: sees and manages every contract
DEVELOPER_ROLE = "developer"               # the person owed: sees only their own contracts
CURRENCIES = ("NGN", "USD")
DUE_SOON_DAYS = 7
LOGIN_URL = "https://www.bamihost.com"
PAGE_LINK = "/dashboard/contracts"


# ── money / date helpers ──────────────────────────────────────────────────────

def format_money(amount: float, currency: str = "NGN") -> str:
    if currency == "USD":
        return f"${amount:,.2f}"
    return f"₦{amount:,.2f}" if abs(amount % 1) > 0 else f"₦{amount:,.0f}"


def _date(v) -> Optional[date]:
    if not v:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return datetime.fromisoformat(str(v).replace("Z", "")).date()
    except ValueError:
        return None


def _currency(v, default: str = "NGN") -> str:
    v = (v or default).upper()
    if v not in CURRENCIES:
        raise HTTPException(status_code=422, detail=f"currency must be one of: {', '.join(CURRENCIES)}")
    return v


def _status_of(p: dict) -> str:
    """confirmed | pending | rejected. Payments saved before confirmation existed count as confirmed."""
    return p.get("status") or "confirmed"


def calc_contract(c: Contract, today: Optional[date] = None) -> dict:
    """Everything derived from a contract: what is paid, what is left, and which
    instalments are covered. Only CONFIRMED payments count; pending ones are shown
    separately. Payments are applied to the earliest-due instalment first."""
    today = today or utcnow().date()
    total = c.total_amount or 0.0
    payments = c.payments or []
    paid = round(sum(p.get("amount") or 0 for p in payments if _status_of(p) == "confirmed"), 2)
    pending = [p for p in payments if _status_of(p) == "pending"]
    pending_amount = round(sum(p.get("amount") or 0 for p in pending), 2)
    balance = round(max(total - paid, 0), 2)

    inst = sorted((dict(i) for i in (c.instalments or [])),
                  key=lambda i: (_date(i.get("due_date")) is None, _date(i.get("due_date")) or date.max))
    scheduled = round(sum(i.get("amount") or 0 for i in inst), 2)
    # The part of the total that has no instalment is treated as paid up front (a deposit), so
    # payments fill that first; only what is left is applied to the instalments, earliest first.
    upfront = max(round(total - scheduled, 2), 0)
    remaining = max(round(paid - upfront, 2), 0)
    overdue_amount, overdue_count, due_soon_count = 0.0, 0, 0
    for i in inst:
        amount = i.get("amount") or 0
        covered = round(min(amount, remaining), 2)
        remaining = round(remaining - covered, 2)
        i["paid"] = covered
        i["outstanding"] = round(amount - covered, 2)
        i["status"] = "paid" if i["outstanding"] <= 0.005 else ("partial" if covered > 0 else "unpaid")
        due = _date(i.get("due_date"))
        i["days_until_due"] = (due - today).days if due else None
        i["overdue"] = bool(due and due < today and i["status"] != "paid")
        i["due_soon"] = bool(due and 0 <= (due - today).days <= DUE_SOON_DAYS and i["status"] != "paid")
        if i["overdue"]:
            overdue_amount += i["outstanding"]
            overdue_count += 1
        if i["due_soon"]:
            due_soon_count += 1

    next_due = next((i for i in inst if i["status"] != "paid"), None)
    if c.status == "cancelled":
        payment_status = "cancelled"
    elif total > 0 and balance <= 0.005:
        payment_status = "paid"
    elif overdue_count:
        payment_status = "overdue"
    elif paid > 0:
        payment_status = "partial"
    else:
        payment_status = "unpaid"

    return {
        "paid": paid, "balance": balance,
        "pending_amount": pending_amount, "pending_count": len(pending),
        "percent_paid": round(min(paid / total * 100, 100), 1) if total else 0,
        "instalments": inst,
        "scheduled_total": scheduled,
        "overdue_amount": round(overdue_amount, 2), "overdue_count": overdue_count,
        "due_soon_count": due_soon_count,
        "next_due": next_due,
        "payment_status": payment_status,
    }


def _serialize(c: Contract, names: dict) -> dict:
    return {
        "id": c.id, "title": c.title, "description": c.description,
        "client_name": c.client_name, "developer_id": c.developer_id,
        "developer_name": names.get(c.developer_id),
        "total_amount": c.total_amount, "currency": c.currency or "NGN",
        "status": c.status,
        "payments": [{**p, "status": _status_of(p)} for p in (c.payments or [])],
        "created_at": c.created_at, "updated_at": c.updated_at,
        **calc_contract(c),
    }


async def _names(db: AsyncSession, contracts) -> dict:
    ids = {c.developer_id for c in contracts if c.developer_id}
    if not ids:
        return {}
    users = await find_all(db, User, User.id.in_(list(ids)), limit=1000)
    return {u.id: u.name for u in users}


async def _notify(db: AsyncSession, user_id: Optional[str], title: str, message: str, type_: str) -> None:
    if user_id:
        await save(db, Notification(id=gen_uuid(), user=user_id, title=title, message=message,
                                    type=type_, link=PAGE_LINK))


def _is_owner(user) -> bool:
    return user.role in OWNER_ROLES


async def _get_visible(db: AsyncSession, user: User, contract_id: str) -> Contract:
    c = await find_one(db, Contract, Contract.id == contract_id, Contract.is_active == True)
    allowed = c and (_is_owner(user) or (user.role == DEVELOPER_ROLE and c.developer_id == user.id))
    if not allowed:
        raise HTTPException(status_code=404, detail="Contract not found")   # same answer for "not yours"
    return c


def _require_staff(user: User) -> None:
    if not (_is_owner(user) or user.role == DEVELOPER_ROLE):
        raise HTTPException(status_code=403, detail="Not allowed")


def _require_developer_of(user: User, c: Contract) -> None:
    if user.id != c.developer_id:
        raise HTTPException(status_code=403, detail="Only the developer who is owed this money can do that")


# ── schemas ───────────────────────────────────────────────────────────────────

class InstalmentIn(BaseModel):
    model_config = {"populate_by_name": True}
    label: str = Field(..., min_length=1, max_length=120)
    amount: float = Field(..., gt=0)
    due_date: Optional[str] = Field(default=None, alias="dueDate")


class PaymentIn(BaseModel):
    model_config = {"populate_by_name": True}
    amount: float = Field(..., gt=0)
    paid_on: Optional[str] = Field(default=None, alias="paidOn")
    method: Optional[str] = Field(default=None, max_length=60)
    note: Optional[str] = Field(default=None, max_length=300)


class RejectIn(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=300)


class ContractCreate(BaseModel):
    model_config = {"populate_by_name": True}
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    client_name: Optional[str] = Field(default=None, alias="clientName")
    total_amount: float = Field(..., gt=0, alias="totalAmount")
    currency: Optional[str] = None
    developer_id: Optional[str] = Field(default=None, alias="developerId")
    instalments: list[InstalmentIn] = []
    received: list[PaymentIn] = []          # payments already received before this contract was entered


class ContractUpdate(BaseModel):
    model_config = {"populate_by_name": True}
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    client_name: Optional[str] = Field(default=None, alias="clientName")
    total_amount: Optional[float] = Field(default=None, gt=0, alias="totalAmount")
    currency: Optional[str] = None
    status: Optional[str] = None
    developer_id: Optional[str] = Field(default=None, alias="developerId")
    instalments: Optional[list[InstalmentIn]] = None


class DeveloperCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    email: str = Field(..., min_length=5, max_length=255)
    phone: Optional[str] = None


def _make_payments(items: list[PaymentIn], user: User, developer_id: Optional[str]) -> list[dict]:
    """The person receiving the money is the authority on it: a payment the developer
    records is confirmed at once; one recorded by anyone else waits for the developer."""
    confirmed = user.id == developer_id
    now = utcnow().isoformat()
    out = []
    for p in items:
        paid_on = _date(p.paid_on) or utcnow().date()
        out.append({
            "id": gen_uuid(), "paid_on": paid_on.isoformat(), "amount": round(p.amount, 2),
            "method": p.method, "note": p.note,
            "status": "confirmed" if confirmed else "pending",
            "confirmed_by": user.id if confirmed else None,
            "confirmed_at": now if confirmed else None,
            "recorded_by": user.id, "recorded_by_name": user.name,
        })
    return out


def _make_instalments(items: list[InstalmentIn], total: float) -> list[dict]:
    out = [{"id": gen_uuid(), "label": i.label.strip(), "amount": round(i.amount, 2),
            "due_date": (_date(i.due_date).isoformat() if _date(i.due_date) else None)} for i in items]
    if sum(i["amount"] for i in out) > total + 0.01:
        raise HTTPException(status_code=422, detail="The instalments add up to more than the contract total")
    return out


async def _tell_developer_of_pending(db: AsyncSession, c: Contract, payments: list[dict], recorder: User) -> None:
    pend = [p for p in payments if p["status"] == "pending"]
    if not pend:
        return
    total = round(sum(p["amount"] for p in pend), 2)
    await _notify(db, c.developer_id, "Payment waiting for your confirmation",
                  f"{recorder.name} recorded {format_money(total, c.currency)} paid towards \"{c.title}\". "
                  "Open Contracts & Payments to confirm that you received it.", "contract_payment_pending")


# ── onboarding a developer (owner side) ───────────────────────────────────────
# NB: fixed paths are declared before "/{contract_id}" so they are not swallowed by it.

@router.get("/developers")
async def list_developers(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """People who can be named as the developer on a contract."""
    if not _is_owner(user):
        raise HTTPException(status_code=403, detail="Admins only")
    users = await find_all(db, User, User.is_active == True,
                           User.role.in_([DEVELOPER_ROLE, *OWNER_ROLES]), order_by=User.name, limit=500)
    return {"success": True, "data": [
        {"id": u.id, "name": u.name, "email": u.email, "role": u.role} for u in users]}


@router.post("/developers", status_code=201)
async def onboard_developer(body: DeveloperCreate, db: AsyncSession = Depends(get_db),
                            user: User = Depends(get_current_user)):
    """Create a login for a developer who can see only the contracts they are owed on."""
    if not _is_owner(user):
        raise HTTPException(status_code=403, detail="Admins only")
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    await ensure_unique_contact(db, email=email, phone=body.phone)

    temp_password = secrets.token_urlsafe(9)
    dev = User(id=gen_uuid(), name=body.name.strip(), email=email, password=hash_password(temp_password),
               role=DEVELOPER_ROLE, phone=(body.phone or None), created_by=user.id, email_verified=True)
    await save(db, dev)

    email_sent = False
    try:
        result = await email_service.send_email(
            email, "You have been added to Bami Host",
            html=(f"<p>Hello {dev.name},</p>"
                  f"<p>You have been added to Bami Host as a developer, so you can track your contracts and payments.</p>"
                  f"<p>Sign in at <a href='{LOGIN_URL}'>{LOGIN_URL}</a><br>"
                  f"Email: <b>{email}</b><br>Temporary password: <b>{temp_password}</b></p>"
                  f"<p>Please change your password after you sign in.</p>"),
            name=dev.name)
        email_sent = bool(result.get("success"))
    except Exception:
        email_sent = False

    return {"success": True, "message": "Developer added", "data": {
        "id": dev.id, "name": dev.name, "email": dev.email,
        "temp_password": temp_password,      # shown once so it can be passed on if the email did not arrive
        "email_sent": email_sent}}


# ── contracts ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_contracts(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    _require_staff(user)
    conds = [Contract.is_active == True]
    if not _is_owner(user):
        conds.append(Contract.developer_id == user.id)
    contracts = await find_all(db, Contract, *conds, order_by=Contract.created_at.desc(), limit=500)
    names = await _names(db, contracts)
    rows = [_serialize(c, names) for c in contracts]

    # Totals per currency over live contracts (cancelled ones are not owed).
    summary: dict[str, dict] = {}
    for r in rows:
        if r["status"] == "cancelled":
            continue
        s = summary.setdefault(r["currency"], {"contracted": 0.0, "received": 0.0, "outstanding": 0.0,
                                               "overdue": 0.0, "pending": 0.0})
        s["contracted"] = round(s["contracted"] + r["total_amount"], 2)
        s["received"] = round(s["received"] + r["paid"], 2)
        s["outstanding"] = round(s["outstanding"] + r["balance"], 2)
        s["overdue"] = round(s["overdue"] + r["overdue_amount"], 2)
        s["pending"] = round(s["pending"] + r["pending_amount"], 2)
    live = [r for r in rows if r["status"] != "cancelled"]
    return {"success": True, "data": rows, "summary": summary,
            "overdue_count": sum(r["overdue_count"] for r in live),
            "due_soon_count": sum(r["due_soon_count"] for r in live),
            "pending_count": sum(r["pending_count"] for r in live)}


@router.post("", status_code=201)
async def create_contract(body: ContractCreate, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    _require_staff(user)
    if _is_owner(user):
        if not body.developer_id:
            raise HTTPException(status_code=422, detail="Choose the developer this contract belongs to")
        dev = await find_one(db, User, User.id == body.developer_id, User.is_active == True)
        if not dev or dev.role not in {DEVELOPER_ROLE, *OWNER_ROLES}:
            raise HTTPException(status_code=422, detail="That developer was not found")
        developer_id = dev.id
    else:
        developer_id = user.id          # a developer can only create contracts for themself

    total = round(body.total_amount, 2)
    received = _make_payments(body.received, user, developer_id)
    if sum(p["amount"] for p in received) > total + 0.01:
        raise HTTPException(status_code=422, detail="The payments received are more than the contract total")
    c = Contract(
        id=gen_uuid(), title=body.title.strip(), description=body.description,
        client_name=(body.client_name or "").strip() or None, developer_id=developer_id,
        total_amount=total, currency=_currency(body.currency),
        instalments=_make_instalments(body.instalments, total), payments=received,
        created_by=user.id)
    await save(db, c)
    await _tell_developer_of_pending(db, c, received, user)
    return {"success": True, "data": _serialize(c, await _names(db, [c]))}


@router.get("/{contract_id}")
async def get_contract(contract_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    _require_staff(user)
    c = await _get_visible(db, user, contract_id)
    return {"success": True, "data": _serialize(c, await _names(db, [c]))}


@router.put("/{contract_id}")
async def update_contract(contract_id: str, body: ContractUpdate, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    _require_staff(user)
    c = await _get_visible(db, user, contract_id)
    paid = calc_contract(c)["paid"]

    if body.title is not None:
        c.title = body.title.strip()
    if body.description is not None:
        c.description = body.description
    if body.client_name is not None:
        c.client_name = body.client_name.strip() or None
    if body.currency is not None:
        c.currency = _currency(body.currency)
    if body.status is not None:
        if body.status not in {"active", "completed", "cancelled"}:
            raise HTTPException(status_code=422, detail="status must be active, completed or cancelled")
        c.status = body.status
    if body.developer_id is not None:
        if not _is_owner(user):
            raise HTTPException(status_code=403, detail="Only an admin can change the developer")
        dev = await find_one(db, User, User.id == body.developer_id, User.is_active == True)
        if not dev or dev.role not in {DEVELOPER_ROLE, *OWNER_ROLES}:
            raise HTTPException(status_code=422, detail="That developer was not found")
        c.developer_id = dev.id
    if body.total_amount is not None:
        if body.total_amount + 0.01 < paid:
            raise HTTPException(status_code=422, detail="The total cannot be lower than what has already been paid")
        c.total_amount = round(body.total_amount, 2)
    if body.instalments is not None:
        c.instalments = _make_instalments(body.instalments, c.total_amount)
    elif sum(i.get("amount") or 0 for i in (c.instalments or [])) > c.total_amount + 0.01:
        raise HTTPException(status_code=422, detail="The existing instalments add up to more than the new total — edit them too")
    c.updated_at = utcnow()
    await save(db, c)
    return {"success": True, "data": _serialize(c, await _names(db, [c]))}


@router.delete("/{contract_id}")
async def delete_contract(contract_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if not _is_owner(user):
        raise HTTPException(status_code=403, detail="Admins only")
    c = await _get_visible(db, user, contract_id)
    c.is_active = False
    c.updated_at = utcnow()
    await save(db, c)
    return {"success": True, "message": "Contract removed"}


# ── payments ──────────────────────────────────────────────────────────────────

@router.post("/{contract_id}/payments", status_code=201)
async def add_payment(contract_id: str, body: PaymentIn, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """Record a payment. If the developer records it, it counts straight away; if anyone
    else does, it is 'pending' until the developer confirms they received it."""
    _require_staff(user)
    c = await _get_visible(db, user, contract_id)
    calc = calc_contract(c)
    open_amount = round(calc["balance"] - calc["pending_amount"], 2)   # not already claimed by a pending payment
    if body.amount > open_amount + 0.01:
        extra = (f" ({format_money(calc['pending_amount'], c.currency)} more is already waiting for confirmation)"
                 if calc["pending_amount"] else "")
        raise HTTPException(
            status_code=422,
            detail=f"That is more than the {format_money(max(open_amount, 0), c.currency)} still open{extra}. "
                   "If the total has changed, raise the contract total first.")
    new = _make_payments([body], user, c.developer_id)
    c.payments = [*(c.payments or []), *new]
    if calc_contract(c)["balance"] <= 0.005 and c.status == "active":
        c.status = "completed"
    c.updated_at = utcnow()
    await save(db, c)
    await _tell_developer_of_pending(db, c, new, user)
    return {"success": True,
            "message": "Payment recorded" if new[0]["status"] == "confirmed" else "Payment recorded — waiting for the developer to confirm",
            "data": _serialize(c, await _names(db, [c]))}


def _find_payment(c: Contract, payment_id: str) -> dict:
    p = next((p for p in (c.payments or []) if p.get("id") == payment_id), None)
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    return p


def _replace_payment(c: Contract, payment_id: str, patch: dict) -> None:
    c.payments = [{**p, **patch} if p.get("id") == payment_id else p for p in (c.payments or [])]


@router.post("/{contract_id}/payments/{payment_id}/confirm")
async def confirm_payment(contract_id: str, payment_id: str, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    """The developer says: yes, I received this. Only then does it count."""
    _require_staff(user)
    c = await _get_visible(db, user, contract_id)
    _require_developer_of(user, c)
    p = _find_payment(c, payment_id)
    if _status_of(p) != "pending":
        raise HTTPException(status_code=409, detail="That payment is not waiting for confirmation")
    if calc_contract(c)["paid"] + p["amount"] > (c.total_amount or 0) + 0.01:
        raise HTTPException(status_code=422, detail="Confirming this would take the paid amount above the contract total")
    _replace_payment(c, payment_id, {"status": "confirmed", "confirmed_by": user.id,
                                     "confirmed_at": utcnow().isoformat(), "reject_reason": None})
    if calc_contract(c)["balance"] <= 0.005 and c.status == "active":
        c.status = "completed"
    c.updated_at = utcnow()
    await save(db, c)
    await _notify(db, p.get("recorded_by"), "Payment confirmed",
                  f"{user.name} confirmed receiving {format_money(p['amount'], c.currency)} for \"{c.title}\".",
                  "contract_payment_confirmed")
    return {"success": True, "message": "Payment confirmed", "data": _serialize(c, await _names(db, [c]))}


@router.post("/{contract_id}/payments/{payment_id}/reject")
async def reject_payment(contract_id: str, payment_id: str, body: RejectIn, db: AsyncSession = Depends(get_db),
                         user: User = Depends(get_current_user)):
    """The developer says: no, I did not receive this. It stays in the history, marked rejected."""
    _require_staff(user)
    c = await _get_visible(db, user, contract_id)
    _require_developer_of(user, c)
    p = _find_payment(c, payment_id)
    if _status_of(p) != "pending":
        raise HTTPException(status_code=409, detail="That payment is not waiting for confirmation")
    _replace_payment(c, payment_id, {"status": "rejected", "reject_reason": (body.reason or "").strip() or None,
                                     "rejected_at": utcnow().isoformat()})
    c.updated_at = utcnow()
    await save(db, c)
    reason = f" Reason: {body.reason.strip()}" if (body.reason or "").strip() else ""
    await _notify(db, p.get("recorded_by"), "Payment not confirmed",
                  f"{user.name} did not confirm {format_money(p['amount'], c.currency)} for \"{c.title}\".{reason}",
                  "contract_payment_rejected")
    return {"success": True, "message": "Payment rejected", "data": _serialize(c, await _names(db, [c]))}


@router.delete("/{contract_id}/payments/{payment_id}")
async def delete_payment(contract_id: str, payment_id: str, db: AsyncSession = Depends(get_db),
                         user: User = Depends(get_current_user)):
    """Remove a mistaken payment. A confirmed payment is the developer's record, so only the
    developer can remove it; unconfirmed ones can also be removed by whoever entered them."""
    _require_staff(user)
    c = await _get_visible(db, user, contract_id)
    p = _find_payment(c, payment_id)
    is_developer = user.id == c.developer_id
    if _status_of(p) == "confirmed":
        if not is_developer:
            raise HTTPException(status_code=403, detail="Only the developer can remove a confirmed payment")
    elif not (is_developer or p.get("recorded_by") == user.id):
        raise HTTPException(status_code=403, detail="Only the person who entered it or the developer can remove this payment")
    c.payments = [x for x in (c.payments or []) if x.get("id") != payment_id]
    if c.status == "completed" and calc_contract(c)["balance"] > 0.005:
        c.status = "active"
    c.updated_at = utcnow()
    await save(db, c)
    return {"success": True, "message": "Payment removed", "data": _serialize(c, await _names(db, [c]))}


# ── PDFs ──────────────────────────────────────────────────────────────────────

async def _developer_info(db: AsyncSession, c: Contract) -> dict:
    dev = await find_one(db, User, User.id == c.developer_id) if c.developer_id else None
    return {"name": dev.name if dev else None, "email": dev.email if dev else None,
            "phone": dev.phone if dev else None}


def _pdf(content: bytes, filename: str) -> Response:
    return Response(content=content, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/{contract_id}/invoice.pdf")
async def contract_invoice(contract_id: str, db: AsyncSession = Depends(get_db),
                           user: User = Depends(get_current_user)):
    """An invoice for what is still owed (or a paid-in-full statement)."""
    _require_staff(user)
    c = await _get_visible(db, user, contract_id)
    data = _serialize(c, await _names(db, [c]))
    pdf = contract_pdf.generate_invoice_pdf(data, await _developer_info(db, c))
    safe = "".join(ch if ch.isalnum() else "-" for ch in c.title).strip("-")[:40] or "contract"
    return _pdf(pdf, f"invoice-{safe}.pdf")


@router.get("/{contract_id}/payments/{payment_id}/receipt.pdf")
async def payment_receipt(contract_id: str, payment_id: str, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    """A receipt for one confirmed payment, showing what was still owed after it."""
    _require_staff(user)
    c = await _get_visible(db, user, contract_id)
    p = _find_payment(c, payment_id)
    if _status_of(p) != "confirmed":
        raise HTTPException(status_code=409, detail="A receipt is only available once the developer has confirmed the payment")
    # what was still owed right after this payment, taking confirmed payments in the order they were received
    ordered = sorted(((x.get("paid_on") or "", idx, x) for idx, x in enumerate(c.payments or [])
                      if _status_of(x) == "confirmed"), key=lambda t: (t[0], t[1]))
    running = 0.0
    for _, _, x in ordered:
        running += x.get("amount") or 0
        if x.get("id") == payment_id:
            break
    balance_after = round(max((c.total_amount or 0) - running, 0), 2)
    data = _serialize(c, await _names(db, [c]))
    pdf = contract_pdf.generate_receipt_pdf(data, {**p, "status": "confirmed"}, await _developer_info(db, c), balance_after)
    return _pdf(pdf, f"receipt-{payment_id[:8]}.pdf")
