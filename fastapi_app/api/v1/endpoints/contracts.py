import hashlib
import json
import secrets
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import or_
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
MANAGER_ROLES = {"manager", "super_manager"}   # may create contracts; see and manage only the ones they created
DEVELOPER_ROLE = "developer"               # a company contractor (developer, designer, ...)
CONTRACTOR_ROLES = {DEVELOPER_ROLE, "vendor", "super_vendor"}   # people who are paid; each sees only their own contracts
CATEGORIES = ("development", "legal", "maintenance", "design", "marketing", "other")
CURRENCIES = ("NGN", "USD")
DUE_SOON_DAYS = 7
LOGIN_URL = "https://www.bamihost.com"
PAGE_LINK = "/dashboard/contracts"
KINDS = ("project", "retainer")      # fixed-price job | monthly support
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August",
               "September", "October", "November", "December"]


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


def _retainer_instalments(c: Contract, today: date) -> list[dict]:
    """The monthly instalments of a monthly-support arrangement: one per month from the start
    date up to the next one that is not yet due (so there is always an upcoming month to remind
    about). An ended arrangement (completed/cancelled) keeps only the months already due."""
    monthly = c.monthly_amount or 0
    if monthly <= 0:
        return []
    day = min(max(c.billing_day or 1, 1), 28)
    start = _date(c.start_date) or (c.created_at.date() if c.created_at else today)
    end = _date(c.end_date)
    live = c.status == "active"
    y, m = start.year, start.month
    if start.day > day:                      # first billing day on or after the start date
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    out = []
    for _ in range(240):                     # 20 years is more than enough
        due = date(y, m, day)
        if end and due > end:
            break
        already_due = due <= today
        if not already_due and not live:
            break
        out.append({"id": f"m-{y}-{m:02d}", "label": f"{MONTH_NAMES[m - 1]} {y}",
                    "amount": round(monthly, 2), "due_date": due.isoformat()})
        if not already_due:
            break                            # one upcoming month is enough
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def calc_contract(c: Contract, today: Optional[date] = None) -> dict:
    """Everything derived from a contract: what is paid, what is left, and which
    instalments are covered. Only CONFIRMED payments count; pending ones are shown
    separately. Payments are applied to the earliest-due instalment first."""
    today = today or utcnow().date()
    retainer = (c.kind or "project") == "retainer"
    if retainer:
        inst0 = _retainer_instalments(c, today)
        total = round(sum(i["amount"] for i in inst0), 2)       # billed so far (incl. the next month)
    else:
        inst0 = c.instalments or []
        total = c.total_amount or 0.0
    payments = c.payments or []
    paid = round(sum(p.get("amount") or 0 for p in payments if _status_of(p) == "confirmed"), 2)
    pending = [p for p in payments if _status_of(p) == "pending"]
    pending_amount = round(sum(p.get("amount") or 0 for p in pending), 2)
    balance = round(max(total - paid, 0), 2)

    inst = sorted((dict(i) for i in inst0),
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

    if retainer:
        # for monthly support "owed" means what has fallen due and is unpaid; next month's is only upcoming
        balance = round(sum(i["outstanding"] for i in inst if (_date(i["due_date"]) or date.max) <= today), 2)

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
        "total_amount": total,
        "percent_paid": round(min(paid / total * 100, 100), 1) if (total and not retainer) else 0,
        "instalments": inst,
        "scheduled_total": scheduled,
        "overdue_amount": round(overdue_amount, 2), "overdue_count": overdue_count,
        "due_soon_count": due_soon_count,
        "next_due": next_due,
        "payment_status": payment_status,
    }


def _serialize(c: Contract, names: dict, viewer: Optional[User] = None) -> dict:
    state = _acceptance_state(c)
    a = c.acceptance or {}
    return {
        "id": c.id, "title": c.title, "description": c.description,
        "client_name": c.client_name, "developer_id": c.developer_id,
        "developer_name": names.get(c.developer_id),
        "total_amount": c.total_amount, "currency": c.currency or "NGN",
        "status": c.status, "kind": c.kind or "project",
        "monthly_amount": c.monthly_amount, "billing_day": c.billing_day,
        "start_date": c.start_date.date().isoformat() if c.start_date else None,
        "end_date": c.end_date.date().isoformat() if c.end_date else None,
        "payments": [{**p, "status": _status_of(p)} for p in (c.payments or [])],
        "created_at": c.created_at, "updated_at": c.updated_at,
        "created_by": c.created_by, "category": c.category, "terms": c.terms,
        "acceptance_status": state,
        "acceptance": {
            "typed_name": a.get("typed_name") if state in ("accepted", "changed") else None,
            "accepted_at": a.get("accepted_at") if state in ("accepted", "changed") else None,
            "how": a.get("how"),
            "decline_reason": a.get("decline_reason") if state == "declined" else None,
            "ip": a.get("ip") if (viewer is not None and _is_owner(viewer)) else None,     # audit detail, admins only
        },
        # what the viewer may do, so the screen can show the right buttons
        "can_edit": bool(viewer and _can_edit(viewer, c)),
        "can_accept": bool(viewer and viewer.id == c.developer_id and state != "accepted"),
        "can_delete": bool(viewer and _is_owner(viewer)),
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


def _is_manager(user) -> bool:
    return user.role in MANAGER_ROLES


def _is_creator(user) -> bool:
    """Admins and managers can set contracts up for contractors and vendors."""
    return _is_owner(user) or _is_manager(user)


async def _get_visible(db: AsyncSession, user: User, contract_id: str) -> Contract:
    c = await find_one(db, Contract, Contract.id == contract_id, Contract.is_active == True)
    allowed = c and (
        _is_owner(user)
        or (_is_manager(user) and c.created_by == user.id)                      # a manager sees what they set up
        or (user.role in CONTRACTOR_ROLES and c.developer_id == user.id)        # a contractor sees only their own
    )
    if not allowed:
        raise HTTPException(status_code=404, detail="Contract not found")   # same answer for "not yours"
    return c


def _require_staff(user: User) -> None:
    if not (_is_creator(user) or user.role in CONTRACTOR_ROLES):
        raise HTTPException(status_code=403, detail="Not allowed")


def _can_edit(user: User, c: Contract) -> bool:
    """Admins edit anything; a manager only what they created; a contractor only a contract
    they entered themself (they must not be able to change terms someone else set for them)."""
    if _is_owner(user):
        return True
    if _is_manager(user):
        return c.created_by == user.id
    return user.id == c.developer_id and c.created_by == user.id


def _require_edit(user: User, c: Contract) -> None:
    if not _can_edit(user, c):
        raise HTTPException(status_code=403, detail="Only the person who set this contract up (or an admin) can change it")


async def _validate_contractor(db: AsyncSession, user: User, person_id: str) -> User:
    person = await find_one(db, User, User.id == person_id, User.is_active == True)
    if not person or person.role not in {*CONTRACTOR_ROLES, *OWNER_ROLES}:
        raise HTTPException(status_code=422, detail="That person was not found")
    if _is_manager(user) and not (person.role in CONTRACTOR_ROLES and
                                  (person.manager == user.id or person.created_by == user.id)):
        raise HTTPException(status_code=422, detail="You can only create contracts for contractors and vendors you manage")
    return person


def _category(v):
    if v is None or v == "":
        return None
    v = str(v).lower()
    if v not in CATEGORIES:
        raise HTTPException(status_code=422, detail=f"category must be one of: {', '.join(CATEGORIES)}")
    return v


# ── acceptance: the contractor agrees to the terms ────────────────────────────

def _terms_hash(c: Contract) -> str:
    """Fingerprint of everything the contractor agrees to. If any of it changes after they
    accepted, the fingerprint no longer matches and they must accept again."""
    payload = {
        "title": c.title, "terms": c.terms, "kind": c.kind or "project", "currency": c.currency,
        "total": c.total_amount, "monthly": c.monthly_amount, "day": c.billing_day,
        "start": c.start_date.date().isoformat() if c.start_date else None,
        "end": c.end_date.date().isoformat() if c.end_date else None,
        "contractor": c.developer_id,
        "instalments": [[i.get("label"), i.get("amount"), i.get("due_date")] for i in (c.instalments or [])],
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def _acceptance_record(c: Contract, typed_name: str, how: str = "typed", ip: Optional[str] = None) -> dict:
    return {"status": "accepted", "typed_name": typed_name, "accepted_at": utcnow().isoformat(),
            "ip": ip, "how": how, "hash": _terms_hash(c)}


def _acceptance_state(c: Contract) -> str:
    """accepted | pending | changed (accepted earlier, edited since) | declined (changes requested)."""
    a = c.acceptance
    if not a:
        return "pending"
    if a.get("hash") != _terms_hash(c):
        return "changed" if a.get("status") == "accepted" else "pending"
    return a.get("status") or "pending"


def _client_ip(request: Request) -> Optional[str]:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else None)


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


class AcceptIn(BaseModel):
    model_config = {"populate_by_name": True}
    typed_name: str = Field(..., min_length=3, max_length=120, alias="typedName")


class DeclineIn(BaseModel):
    reason: str = Field(..., min_length=3, max_length=300)


class RejectIn(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=300)


class ContractCreate(BaseModel):
    model_config = {"populate_by_name": True}
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    client_name: Optional[str] = Field(default=None, alias="clientName")
    kind: Optional[str] = None                      # project (default) | retainer (monthly support)
    total_amount: Optional[float] = Field(default=None, gt=0, alias="totalAmount")     # projects
    monthly_amount: Optional[float] = Field(default=None, gt=0, alias="monthlyAmount")  # monthly support
    billing_day: Optional[int] = Field(default=None, alias="billingDay")
    start_date: Optional[str] = Field(default=None, alias="startDate")
    end_date: Optional[str] = Field(default=None, alias="endDate")
    currency: Optional[str] = None
    developer_id: Optional[str] = Field(default=None, alias="developerId")
    terms: Optional[str] = Field(default=None, max_length=8000)
    category: Optional[str] = None
    instalments: list[InstalmentIn] = []
    received: list[PaymentIn] = []          # payments already received before this contract was entered


class ContractUpdate(BaseModel):
    model_config = {"populate_by_name": True}
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    client_name: Optional[str] = Field(default=None, alias="clientName")
    total_amount: Optional[float] = Field(default=None, gt=0, alias="totalAmount")
    monthly_amount: Optional[float] = Field(default=None, gt=0, alias="monthlyAmount")
    billing_day: Optional[int] = Field(default=None, alias="billingDay")
    start_date: Optional[str] = Field(default=None, alias="startDate")
    end_date: Optional[str] = Field(default=None, alias="endDate")       # "" clears it
    currency: Optional[str] = None
    status: Optional[str] = None
    developer_id: Optional[str] = Field(default=None, alias="developerId")
    terms: Optional[str] = Field(default=None, max_length=8000)
    category: Optional[str] = None
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
    """People who can be named on a contract (contractors and vendors; for admins, admins too),
    with how many contracts each already has. Managers see only the people they manage."""
    if not _is_creator(user):
        raise HTTPException(status_code=403, detail="Admins and managers only")
    if _is_manager(user):
        conds = [User.is_active == True, User.role.in_(list(CONTRACTOR_ROLES)),
                 or_(User.manager == user.id, User.created_by == user.id)]
    else:
        conds = [User.is_active == True, User.role.in_([*CONTRACTOR_ROLES, *OWNER_ROLES])]
    users = await find_all(db, User, *conds, order_by=User.name, limit=500)
    counts: dict[str, int] = {}
    if users:
        rows = await find_all(db, Contract, Contract.is_active == True,
                              Contract.developer_id.in_([u.id for u in users]), limit=5000)
        for r in rows:
            counts[r.developer_id] = counts.get(r.developer_id, 0) + 1
    return {"success": True, "data": [
        {"id": u.id, "name": u.name, "email": u.email, "role": u.role, "contract_count": counts.get(u.id, 0)}
        for u in users]}


@router.post("/developers", status_code=201)
async def onboard_developer(body: DeveloperCreate, db: AsyncSession = Depends(get_db),
                            user: User = Depends(get_current_user)):
    """Create a login for a contractor who can see only the contracts they are paid on."""
    if not _is_creator(user):
        raise HTTPException(status_code=403, detail="Admins and managers only")
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
    if _is_manager(user):
        conds.append(Contract.created_by == user.id)          # a manager sees what they set up
    elif not _is_owner(user):
        conds.append(Contract.developer_id == user.id)        # a contractor sees only their own
    contracts = await find_all(db, Contract, *conds, order_by=Contract.created_at.desc(), limit=500)
    names = await _names(db, contracts)
    rows = [_serialize(c, names, user) for c in contracts]

    # Totals per currency over live contracts (cancelled ones are not owed).
    summary: dict[str, dict] = {}
    for r in rows:
        if r["status"] == "cancelled":
            continue
        s = summary.setdefault(r["currency"], {"contracted": 0.0, "received": 0.0, "outstanding": 0.0,
                                               "overdue": 0.0, "pending": 0.0})
        if r["kind"] == "project":
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
    if _is_creator(user):
        if not body.developer_id:
            raise HTTPException(status_code=422, detail="Choose who this contract is with")
        developer_id = (await _validate_contractor(db, user, body.developer_id)).id
    elif user.role == DEVELOPER_ROLE:
        developer_id = user.id          # a developer can record their own contract
    else:
        raise HTTPException(status_code=403, detail="Vendors cannot create contracts — ask the company to set one up")

    kind = (body.kind or "project").lower()
    if kind not in KINDS:
        raise HTTPException(status_code=422, detail="kind must be project or retainer")
    received = _make_payments(body.received, user, developer_id)
    extra: dict = {}
    if kind == "project":
        if not body.total_amount:
            raise HTTPException(status_code=422, detail="Enter the total amount agreed")
        total = round(body.total_amount, 2)
        if sum(p["amount"] for p in received) > total + 0.01:
            raise HTTPException(status_code=422, detail="The payments received are more than the contract total")
        instalments = _make_instalments(body.instalments, total)
    else:
        if not body.monthly_amount:
            raise HTTPException(status_code=422, detail="Enter the monthly amount")
        day = body.billing_day or 1
        if not 1 <= day <= 28:
            raise HTTPException(status_code=422, detail="The day of the month must be between 1 and 28")
        start, end = _date(body.start_date) or utcnow().date(), _date(body.end_date)
        if end and end < start:
            raise HTTPException(status_code=422, detail="The end date is before the start date")
        total, instalments = 0.0, []
        extra = {"monthly_amount": round(body.monthly_amount, 2), "billing_day": day,
                 "start_date": datetime(start.year, start.month, start.day),
                 "end_date": datetime(end.year, end.month, end.day) if end else None}
    c = Contract(
        id=gen_uuid(), title=body.title.strip(), description=body.description,
        client_name=(body.client_name or "").strip() or None, developer_id=developer_id,
        kind=kind, total_amount=total, currency=_currency(body.currency),
        terms=(body.terms or "").strip() or None, category=_category(body.category),
        instalments=instalments, payments=received, created_by=user.id, **extra)
    await save(db, c)
    if user.id == developer_id:
        c.acceptance = _acceptance_record(c, user.name, how="own contract")      # they made it themself
        await save(db, c)
    else:
        await _notify(db, developer_id, "New contract to review",
                      f"{user.name} set up \"{c.title}\" for you. Open Contracts & Payments to read the terms and accept them.",
                      "contract_acceptance_requested")
    await _tell_developer_of_pending(db, c, received, user)
    return {"success": True, "data": _serialize(c, await _names(db, [c]), user)}


@router.get("/{contract_id}")
async def get_contract(contract_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    _require_staff(user)
    c = await _get_visible(db, user, contract_id)
    return {"success": True, "data": _serialize(c, await _names(db, [c]), user)}


@router.put("/{contract_id}")
async def update_contract(contract_id: str, body: ContractUpdate, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    _require_staff(user)
    c = await _get_visible(db, user, contract_id)
    _require_edit(user, c)
    state_before = _acceptance_state(c)
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
        if not _is_creator(user):
            raise HTTPException(status_code=403, detail="Only an admin or manager can change who the contract is with")
        c.developer_id = (await _validate_contractor(db, user, body.developer_id)).id
    if body.terms is not None:
        c.terms = body.terms.strip() or None
    if body.category is not None:
        c.category = _category(body.category)
    if (c.kind or "project") == "retainer":
        if body.monthly_amount is not None:
            c.monthly_amount = round(body.monthly_amount, 2)      # re-prices every month of the arrangement
        if body.billing_day is not None:
            if not 1 <= body.billing_day <= 28:
                raise HTTPException(status_code=422, detail="The day of the month must be between 1 and 28")
            c.billing_day = body.billing_day
        if body.start_date is not None and _date(body.start_date):
            d = _date(body.start_date)
            c.start_date = datetime(d.year, d.month, d.day)
        if body.end_date is not None:
            d = _date(body.end_date)                              # "" clears the end date
            c.end_date = datetime(d.year, d.month, d.day) if d else None
        if c.start_date and c.end_date and c.end_date < c.start_date:
            raise HTTPException(status_code=422, detail="The end date is before the start date")
    else:
        if body.total_amount is not None:
            if body.total_amount + 0.01 < paid:
                raise HTTPException(status_code=422, detail="The total cannot be lower than what has already been paid")
            c.total_amount = round(body.total_amount, 2)
        if body.instalments is not None:
            c.instalments = _make_instalments(body.instalments, c.total_amount)
        elif sum(i.get("amount") or 0 for i in (c.instalments or [])) > c.total_amount + 0.01:
            raise HTTPException(status_code=422, detail="The existing instalments add up to more than the new total — edit them too")
    if user.id == c.developer_id:
        c.acceptance = _acceptance_record(c, user.name, how="own contract")      # editing their own contract
    elif state_before == "accepted" and _acceptance_state(c) == "changed":
        await _notify(db, c.developer_id, "Contract changed — please review",
                      f"{user.name} changed \"{c.title}\" after you accepted it. Open Contracts & Payments and accept the new terms.",
                      "contract_acceptance_requested")
    c.updated_at = utcnow()
    await save(db, c)
    return {"success": True, "data": _serialize(c, await _names(db, [c]), user)}


@router.post("/{contract_id}/accept")
async def accept_contract(contract_id: str, body: AcceptIn, request: Request,
                          db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """The contractor accepts the contract as it stands now by typing their full name."""
    _require_staff(user)
    c = await _get_visible(db, user, contract_id)
    _require_developer_of(user, c)
    if _acceptance_state(c) == "accepted":
        raise HTTPException(status_code=409, detail="You have already accepted this contract")
    c.acceptance = _acceptance_record(c, body.typed_name.strip(), ip=_client_ip(request))
    c.updated_at = utcnow()
    await save(db, c)
    if c.created_by and c.created_by != user.id:
        await _notify(db, c.created_by, "Contract accepted",
                      f"{user.name} accepted \"{c.title}\" (signed as {body.typed_name.strip()}).", "contract_accepted")
    return {"success": True, "message": "Contract accepted", "data": _serialize(c, await _names(db, [c]), user)}


@router.post("/{contract_id}/decline")
async def decline_contract(contract_id: str, body: DeclineIn, db: AsyncSession = Depends(get_db),
                           user: User = Depends(get_current_user)):
    """The contractor asks for changes instead of accepting. The person who set it up is told why."""
    _require_staff(user)
    c = await _get_visible(db, user, contract_id)
    _require_developer_of(user, c)
    c.acceptance = {"status": "declined", "decline_reason": body.reason.strip(), "declined_at": utcnow().isoformat(),
                    "declined_by_name": user.name, "hash": _terms_hash(c)}
    c.updated_at = utcnow()
    await save(db, c)
    if c.created_by and c.created_by != user.id:
        await _notify(db, c.created_by, "Changes requested on a contract",
                      f"{user.name} did not accept \"{c.title}\". Reason: {body.reason.strip()}", "contract_declined")
    return {"success": True, "message": "Changes requested", "data": _serialize(c, await _names(db, [c]), user)}


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
    retainer = (c.kind or "project") == "retainer"
    open_amount = round(calc["balance"] - calc["pending_amount"], 2)   # not already claimed by a pending payment
    if retainer:
        # no fixed total: allow paying ahead, but catch a slipped decimal (more than a year at once)
        cap = 12 * (c.monthly_amount or 0)
        if body.amount > cap + 0.01:
            raise HTTPException(status_code=422, detail=f"That is more than 12 months of support ({format_money(cap, c.currency)}). Please check the amount.")
    elif body.amount > open_amount + 0.01:
        extra = (f" ({format_money(calc['pending_amount'], c.currency)} more is already waiting for confirmation)"
                 if calc["pending_amount"] else "")
        raise HTTPException(
            status_code=422,
            detail=f"That is more than the {format_money(max(open_amount, 0), c.currency)} still open{extra}. "
                   "If the total has changed, raise the contract total first.")
    new = _make_payments([body], user, c.developer_id)
    c.payments = [*(c.payments or []), *new]
    if not retainer and calc_contract(c)["balance"] <= 0.005 and c.status == "active":
        c.status = "completed"
    c.updated_at = utcnow()
    await save(db, c)
    await _tell_developer_of_pending(db, c, new, user)
    return {"success": True,
            "message": "Payment recorded" if new[0]["status"] == "confirmed" else "Payment recorded — waiting for the developer to confirm",
            "data": _serialize(c, await _names(db, [c]), user)}


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
    retainer = (c.kind or "project") == "retainer"
    if not retainer and calc_contract(c)["paid"] + p["amount"] > (c.total_amount or 0) + 0.01:
        raise HTTPException(status_code=422, detail="Confirming this would take the paid amount above the contract total")
    _replace_payment(c, payment_id, {"status": "confirmed", "confirmed_by": user.id,
                                     "confirmed_at": utcnow().isoformat(), "reject_reason": None})
    if not retainer and calc_contract(c)["balance"] <= 0.005 and c.status == "active":
        c.status = "completed"
    c.updated_at = utcnow()
    await save(db, c)
    await _notify(db, p.get("recorded_by"), "Payment confirmed",
                  f"{user.name} confirmed receiving {format_money(p['amount'], c.currency)} for \"{c.title}\".",
                  "contract_payment_confirmed")
    return {"success": True, "message": "Payment confirmed", "data": _serialize(c, await _names(db, [c]), user)}


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
    return {"success": True, "message": "Payment rejected", "data": _serialize(c, await _names(db, [c]), user)}


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
    if (c.kind or "project") == "project" and c.status == "completed" and calc_contract(c)["balance"] > 0.005:
        c.status = "active"
    c.updated_at = utcnow()
    await save(db, c)
    return {"success": True, "message": "Payment removed", "data": _serialize(c, await _names(db, [c]), user)}


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
    data = _serialize(c, await _names(db, [c]), user)
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
    balance_after = None if (c.kind or "project") == "retainer" else round(max((c.total_amount or 0) - running, 0), 2)
    data = _serialize(c, await _names(db, [c]), user)
    pdf = contract_pdf.generate_receipt_pdf(data, {**p, "status": "confirmed"}, await _developer_info(db, c), balance_after)
    return _pdf(pdf, f"receipt-{payment_id[:8]}.pdf")
