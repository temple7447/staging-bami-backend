"""Bami-Wash — car wash business line. Modeled on estates.py (own tables, own
authz, own endpoint file — there is no generic "business line" concept on this
platform, see core/authz.py's module docstring). Customer payments reuse the
platform's existing Wallet/Transaction ledger (see wallet.py, meters.py's
topup_my_meter for the debit pattern this file's QR-scan mirrors) rather than
a separate wallet system — top-ups happen through the existing bank-deposits
flow in misc.py, nothing new needed there."""
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from pydantic import BaseModel
from jose import JWTError, jwt

from models.carwash import (
    CarWashStation, CarWashVehicle, CarWashService, CarWashAddon,
    CarWashOrder, CarWashOrderItem, CarWashStatusEvent, CarWashQrPayment,
    CarWashSupportTicket,
)
from models.user import User
from models.wallet import Wallet
from models.transaction import Transaction
from models.notification import Notification
from core.security import get_current_user, hash_password
from core.database import get_db
from core.authz import (
    STATION_ROLES, station_role, has_station_role, require_station_role,
    require_station_access, accessible_station_ids,
)
from core.db_helpers import find_one, find_all, save, count, sum_col
from core.config import settings
from models.base import gen_uuid
from utils.tenant_helpers import generate_temp_password
from utils.email_service import send_welcome_email
from utils.time_utils import utcnow
from utils import sms_service

router = APIRouter(prefix="/carwash", tags=["Car Wash"])
ADMIN_ROLES = {"super_admin", "admin", "super_manager", "business_owner"}

_QR_TYP = "carwash_qr"
_FORWARD_TRANSITIONS = {
    "scheduled": {"queued", "cancelled"},
    "queued": {"in_wash", "cancelled"},
    "in_wash": {"drying", "cancelled"},
    "drying": {"ready", "cancelled"},
    "ready": {"completed"},
}


# ── serializers ────────────────────────────────────────────────────────────────

def _station(s: CarWashStation, user: Optional[User] = None) -> dict:
    return {
        "id": s.id, "name": s.name, "slug": s.slug, "description": s.description,
        "address": s.address, "owner": s.owner, "members": s.members or [],
        "opens_at": s.opens_at, "closes_at": s.closes_at,
        "is_active": s.is_active, "created_at": s.created_at, "updated_at": s.updated_at,
        "my_role": station_role(s, user) if user is not None else None,
    }


def _vehicle(v: CarWashVehicle) -> dict:
    return {
        "id": v.id, "user_id": v.user_id, "make": v.make, "model": v.model,
        "year": v.year, "color": v.color, "plate": v.plate, "is_default": v.is_default,
        "is_active": v.is_active, "created_at": v.created_at, "updated_at": v.updated_at,
    }


def _service(sv: CarWashService) -> dict:
    return {
        "id": sv.id, "station_id": sv.station_id, "name": sv.name,
        "description": sv.description, "base_price": sv.base_price,
        "duration_min": sv.duration_min, "kind": sv.kind, "is_active": sv.is_active,
        "created_at": sv.created_at, "updated_at": sv.updated_at,
    }


def _addon(a: CarWashAddon) -> dict:
    return {
        "id": a.id, "station_id": a.station_id, "service_id": a.service_id,
        "name": a.name, "price": a.price, "is_active": a.is_active,
        "created_at": a.created_at, "updated_at": a.updated_at,
    }


def _order(o: CarWashOrder) -> dict:
    return {
        "id": o.id, "ref": o.ref, "station_id": o.station_id, "user_id": o.user_id,
        "vehicle_id": o.vehicle_id, "service_id": o.service_id, "status": o.status,
        "total": o.total, "scheduled_at": o.scheduled_at, "queued_at": o.queued_at,
        "slot_start": o.slot_start, "paid_at": o.paid_at, "staff_id": o.staff_id,
        "cancelled_reason": o.cancelled_reason,
        "created_at": o.created_at, "updated_at": o.updated_at,
    }


def _status_event(e: CarWashStatusEvent) -> dict:
    return {"id": e.id, "order_id": e.order_id, "status": e.status,
            "note": e.note, "actor_id": e.actor_id, "at": e.at}


def _order_item(i: CarWashOrderItem) -> dict:
    return {"id": i.id, "order_id": i.order_id, "addon_id": i.addon_id,
            "name": i.name, "price": i.price, "created_at": i.created_at}


def _qr(q: CarWashQrPayment) -> dict:
    return {
        "id": q.id, "order_id": q.order_id, "amount": q.amount,
        "expires_at": q.expires_at, "status": q.status,
        "staff_id": q.staff_id, "paid_at": q.paid_at, "created_at": q.created_at,
    }


def _ticket(t: CarWashSupportTicket) -> dict:
    return {
        "id": t.id, "station_id": t.station_id, "user_id": t.user_id,
        "order_id": t.order_id, "subject": t.subject, "description": t.description,
        "status": t.status, "resolution_note": t.resolution_note,
        "refund_amount": t.refund_amount, "refund_transaction_id": t.refund_transaction_id,
        "resolved_by": t.resolved_by, "resolved_at": t.resolved_at,
        "created_at": t.created_at, "updated_at": t.updated_at,
    }


async def _accessible_station_ids(db: AsyncSession, user: User) -> list[str]:
    ids = await accessible_station_ids(db, user)
    if ids is None:
        result = await db.execute(select(CarWashStation.id).where(CarWashStation.is_active == True))
        return [r[0] for r in result.all()]
    return list(ids)


async def _get_station_or_404(db: AsyncSession, station_id: str) -> CarWashStation:
    station = await find_one(db, CarWashStation, CarWashStation.id == station_id, CarWashStation.is_active == True)
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")
    return station


async def _get_order_or_404(db: AsyncSession, order_id: str) -> CarWashOrder:
    order = await find_one(db, CarWashOrder, CarWashOrder.id == order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


# ── stations: overview + CRUD ───────────────────────────────────────────────────

@router.get("/overview/all")
async def get_carwash_overview_all(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Feeds the cross-business portfolio card — real numbers, not mock data."""
    ids = await _accessible_station_ids(db, user)
    if not ids:
        return {"success": True, "data": {
            "stations": 0, "orders_today": 0, "revenue_30d": 0, "open_tickets": 0,
        }}
    now = utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    thirty_ago = now - timedelta(days=30)

    orders_today = await count(db, CarWashOrder, CarWashOrder.station_id.in_(ids),
                               CarWashOrder.created_at >= today_start)
    revenue_30d = await sum_col(db, Transaction, Transaction.amount,
                                Transaction.type == "car_wash_payment", Transaction.status == "completed",
                                Transaction.created_at >= thirty_ago)
    open_tickets = await count(db, CarWashSupportTicket, CarWashSupportTicket.station_id.in_(ids),
                               CarWashSupportTicket.status == "open")

    return {"success": True, "data": {
        "stations": len(ids), "orders_today": orders_today,
        "revenue_30d": revenue_30d or 0, "open_tickets": open_tickets,
    }}


@router.get("/stations")
async def list_stations(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ids = await _accessible_station_ids(db, user)
    if not ids:
        return {"success": True, "count": 0, "data": []}
    items = await find_all(db, CarWashStation, CarWashStation.id.in_(ids), CarWashStation.is_active == True,
                           order_by=CarWashStation.created_at.desc())
    return {"success": True, "count": len(items), "data": [_station(s, user) for s in items]}


class StationCreate(BaseModel):
    name: str
    description: Optional[str] = None
    address: Optional[str] = None
    opens_at: Optional[str] = None
    closes_at: Optional[str] = None


class StationUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    address: Optional[str] = None
    opens_at: Optional[str] = None
    closes_at: Optional[str] = None


@router.post("/stations", status_code=201)
async def create_station(
    body: StationCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in {"super_admin", "business_owner"}:
        raise HTTPException(status_code=403, detail="Not authorized to create a station")
    station = CarWashStation(id=gen_uuid(), **body.model_dump(exclude_none=True),
                             owner=user.id, created_by=user.id)
    await save(db, station)
    return {"success": True, "data": _station(station, user)}


@router.get("/stations/{station_id}")
async def get_station(
    station_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    station = await _get_station_or_404(db, station_id)
    await require_station_access(db, user, station_id, "staff")
    return {"success": True, "data": _station(station, user)}


@router.put("/stations/{station_id}")
async def update_station(
    station_id: str,
    body: StationUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    station = await _get_station_or_404(db, station_id)
    await require_station_access(db, user, station_id, "admin")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(station, k, v)
    station.updated_by = user.id
    station.updated_at = utcnow()
    await save(db, station)
    return {"success": True, "data": _station(station, user)}


@router.delete("/stations/{station_id}")
async def delete_station(
    station_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    station = await _get_station_or_404(db, station_id)
    await require_station_access(db, user, station_id, "admin")
    station.is_active = False
    station.updated_by = user.id
    station.updated_at = utcnow()
    await save(db, station)
    return {"success": True, "message": "Station deleted"}


@router.get("/stations/{station_id}/overview")
async def get_station_overview(
    station_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    station = await _get_station_or_404(db, station_id)
    await require_station_access(db, user, station_id, "staff")

    now = utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    thirty_ago = now - timedelta(days=30)

    queue_len = await count(db, CarWashOrder, CarWashOrder.station_id == station_id,
                            CarWashOrder.status.in_(("queued", "in_wash", "drying")))
    orders_today = await count(db, CarWashOrder, CarWashOrder.station_id == station_id,
                               CarWashOrder.created_at >= today_start)
    completed_today = await count(db, CarWashOrder, CarWashOrder.station_id == station_id,
                                  CarWashOrder.status == "completed", CarWashOrder.updated_at >= today_start)
    revenue_today = await sum_col(db, Transaction, Transaction.amount,
                                  Transaction.type == "car_wash_payment", Transaction.status == "completed",
                                  Transaction.created_at >= today_start)
    revenue_30d = await sum_col(db, Transaction, Transaction.amount,
                                Transaction.type == "car_wash_payment", Transaction.status == "completed",
                                Transaction.created_at >= thirty_ago)
    open_tickets = await count(db, CarWashSupportTicket, CarWashSupportTicket.station_id == station_id,
                               CarWashSupportTicket.status == "open")

    return {"success": True, "data": {
        "station": {"id": station.id, "name": station.name},
        "queue_length": queue_len,
        "orders_today": orders_today,
        "completed_today": completed_today,
        "revenue_today": revenue_today or 0,
        "revenue_30d": revenue_30d or 0,
        "open_tickets": open_tickets,
    }}


# ── station staff ────────────────────────────────────────────────────────────

class StaffAssign(BaseModel):
    name: str
    email: str
    role: str = "staff"   # staff | admin
    phone: Optional[str] = None
    sendCredentials: bool = True


class StaffUpdate(BaseModel):
    role: str


@router.get("/stations/{station_id}/staff")
async def list_station_staff(
    station_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    station = await _get_station_or_404(db, station_id)
    await require_station_access(db, user, station_id, "staff")
    owner = await db.get(User, station.owner) if station.owner else None
    out = []
    for m in (station.members or []):
        if not isinstance(m, dict):
            continue
        u = await db.get(User, m.get("user_id")) if m.get("user_id") else None
        out.append({
            "userId": m.get("user_id"), "email": (u.email if u else m.get("email")),
            "name": (u.name if u else None), "role": m.get("role"),
            "isActive": (u.is_active if u else None),
        })
    return {
        "success": True,
        "owner": ({"userId": owner.id, "email": owner.email, "name": owner.name, "role": "admin"} if owner else None),
        "members": out,
    }


@router.post("/stations/{station_id}/staff", status_code=201)
async def add_station_staff(
    station_id: str,
    body: StaffAssign,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    """Mirrors add_estate_member in estates.py, scoped to a station. Gated to
    the station's own admin (owner) or a platform admin — deliberately looser
    than Estate's require_super_admin-only gate, since this is a single-owner
    business and routing every staff hire through platform support has no
    upside here."""
    station = await _get_station_or_404(db, station_id)
    await require_station_access(db, actor, station_id, "admin")

    role = (body.role or "").strip().lower()
    if role not in STATION_ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {', '.join(STATION_ROLES)}")
    email = (body.email or "").strip().lower()
    name = (body.name or "").strip()
    if not email or not name:
        raise HTTPException(status_code=400, detail="Name and email are required")
    if station.owner and (owner := await db.get(User, station.owner)) and owner.email.lower() == email:
        raise HTTPException(status_code=409, detail="This email is already the station owner (admin)")

    user = await find_one(db, User, func.lower(User.email) == email)
    created = False
    password = None
    if not user:
        password = generate_temp_password(8)
        user = User(id=gen_uuid(), name=name, email=email, phone=(body.phone or None),
                    password=hash_password(password), role="wash_staff",
                    created_by=actor.id, email_verified=True)
        await save(db, user)
        await save(db, Wallet(id=gen_uuid(), user_id=user.id, balance=0, currency="NGN"))
        created = True
    elif body.sendCredentials:
        password = generate_temp_password(8)
        user.password = hash_password(password)
        user.email_verified = True
        await save(db, user)

    members = [m for m in (station.members or [])
               if not (isinstance(m, dict) and m.get("user_id") == user.id)]
    members.append({"user_id": user.id, "email": email, "role": role})
    station.members = members
    station.updated_by = actor.id
    station.updated_at = utcnow()
    await save(db, station)

    credentials_sent = False
    if body.sendCredentials and password:
        try:
            await send_welcome_email(email, user.name, password)
            credentials_sent = True
        except Exception:
            pass

    return {"success": True, "message": "Staff assigned",
            "data": {"userId": user.id, "email": email, "name": user.name,
                     "role": role, "accountCreated": created, "credentialsSent": credentials_sent}}


@router.put("/stations/{station_id}/staff/{user_id}")
async def update_station_staff(
    station_id: str,
    user_id: str,
    body: StaffUpdate,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    station = await _get_station_or_404(db, station_id)
    await require_station_access(db, actor, station_id, "admin")
    role = (body.role or "").strip().lower()
    if role not in STATION_ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {', '.join(STATION_ROLES)}")
    found = False
    new_members = []
    for m in (station.members or []):
        if isinstance(m, dict) and m.get("user_id") == user_id:
            new_members.append({**m, "role": role})
            found = True
        else:
            new_members.append(m)
    if not found:
        raise HTTPException(status_code=404, detail="Staff member not found on this station")
    station.members = new_members
    station.updated_by = actor.id
    station.updated_at = utcnow()
    await save(db, station)
    return {"success": True, "message": "Staff role updated"}


@router.delete("/stations/{station_id}/staff/{user_id}")
async def remove_station_staff(
    station_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    actor: User = Depends(get_current_user),
):
    station = await _get_station_or_404(db, station_id)
    await require_station_access(db, actor, station_id, "admin")
    station.members = [m for m in (station.members or [])
                       if not (isinstance(m, dict) and m.get("user_id") == user_id)]
    station.updated_by = actor.id
    station.updated_at = utcnow()
    await save(db, station)
    return {"success": True, "message": "Staff removed"}


# ── services & addons ────────────────────────────────────────────────────────

class ServiceCreate(BaseModel):
    name: str
    description: Optional[str] = None
    base_price: float
    duration_min: int = 30
    kind: str = "queue"   # queue | slot


class ServiceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    base_price: Optional[float] = None
    duration_min: Optional[int] = None
    kind: Optional[str] = None


@router.get("/stations/{station_id}/services")
async def list_station_services(
    station_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Any authenticated user may browse — customers need this to book."""
    await _get_station_or_404(db, station_id)
    items = await find_all(db, CarWashService, CarWashService.station_id == station_id,
                           CarWashService.is_active == True, order_by=CarWashService.name.asc())
    return {"success": True, "count": len(items), "data": [_service(s) for s in items]}


@router.post("/stations/{station_id}/services", status_code=201)
async def create_station_service(
    station_id: str,
    body: ServiceCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _get_station_or_404(db, station_id)
    await require_station_access(db, user, station_id, "staff")
    if body.kind not in ("queue", "slot"):
        raise HTTPException(status_code=400, detail="kind must be 'queue' or 'slot'")
    service = CarWashService(id=gen_uuid(), station_id=station_id, **body.model_dump())
    await save(db, service)
    return {"success": True, "data": _service(service)}


@router.put("/services/{service_id}")
async def update_service(
    service_id: str,
    body: ServiceUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    service = await find_one(db, CarWashService, CarWashService.id == service_id, CarWashService.is_active == True)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    await require_station_access(db, user, service.station_id, "staff")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(service, k, v)
    service.updated_at = utcnow()
    await save(db, service)
    return {"success": True, "data": _service(service)}


@router.delete("/services/{service_id}")
async def delete_service(
    service_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    service = await find_one(db, CarWashService, CarWashService.id == service_id, CarWashService.is_active == True)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    await require_station_access(db, user, service.station_id, "staff")
    service.is_active = False
    service.updated_at = utcnow()
    await save(db, service)
    return {"success": True, "message": "Service deleted"}


class AddonCreate(BaseModel):
    service_id: Optional[str] = None
    name: str
    price: float


class AddonUpdate(BaseModel):
    name: Optional[str] = None
    price: Optional[float] = None


@router.get("/stations/{station_id}/addons")
async def list_station_addons(
    station_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _get_station_or_404(db, station_id)
    items = await find_all(db, CarWashAddon, CarWashAddon.station_id == station_id,
                           CarWashAddon.is_active == True, order_by=CarWashAddon.name.asc())
    return {"success": True, "count": len(items), "data": [_addon(a) for a in items]}


@router.post("/stations/{station_id}/addons", status_code=201)
async def create_station_addon(
    station_id: str,
    body: AddonCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _get_station_or_404(db, station_id)
    await require_station_access(db, user, station_id, "staff")
    addon = CarWashAddon(id=gen_uuid(), station_id=station_id, **body.model_dump())
    await save(db, addon)
    return {"success": True, "data": _addon(addon)}


@router.put("/addons/{addon_id}")
async def update_addon(
    addon_id: str,
    body: AddonUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    addon = await find_one(db, CarWashAddon, CarWashAddon.id == addon_id, CarWashAddon.is_active == True)
    if not addon:
        raise HTTPException(status_code=404, detail="Add-on not found")
    await require_station_access(db, user, addon.station_id, "staff")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(addon, k, v)
    addon.updated_at = utcnow()
    await save(db, addon)
    return {"success": True, "data": _addon(addon)}


@router.delete("/addons/{addon_id}")
async def delete_addon(
    addon_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    addon = await find_one(db, CarWashAddon, CarWashAddon.id == addon_id, CarWashAddon.is_active == True)
    if not addon:
        raise HTTPException(status_code=404, detail="Add-on not found")
    await require_station_access(db, user, addon.station_id, "staff")
    addon.is_active = False
    addon.updated_at = utcnow()
    await save(db, addon)
    return {"success": True, "message": "Add-on deleted"}


# ── vehicles (customer self-service) ─────────────────────────────────────────

class VehicleCreate(BaseModel):
    make: str
    model: str
    year: Optional[int] = None
    color: Optional[str] = None
    plate: str
    is_default: Optional[bool] = None


class VehicleUpdate(BaseModel):
    make: Optional[str] = None
    model: Optional[str] = None
    year: Optional[int] = None
    color: Optional[str] = None
    plate: Optional[str] = None
    is_default: Optional[bool] = None


async def _clear_other_defaults(db: AsyncSession, user_id: str, except_id: str) -> None:
    others = await find_all(db, CarWashVehicle, CarWashVehicle.user_id == user_id,
                            CarWashVehicle.is_active == True, CarWashVehicle.id != except_id,
                            CarWashVehicle.is_default == True)
    for v in others:
        v.is_default = False
        await save(db, v)


@router.get("/vehicles/my")
async def list_my_vehicles(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    items = await find_all(db, CarWashVehicle, CarWashVehicle.user_id == user.id,
                           CarWashVehicle.is_active == True, order_by=CarWashVehicle.created_at.desc())
    return {"success": True, "count": len(items), "data": [_vehicle(v) for v in items]}


@router.post("/vehicles", status_code=201)
async def create_vehicle(
    body: VehicleCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    existing_count = await count(db, CarWashVehicle, CarWashVehicle.user_id == user.id,
                                 CarWashVehicle.is_active == True)
    data = body.model_dump()
    is_default = data.pop("is_default", None)
    is_default = True if existing_count == 0 else bool(is_default)
    vehicle = CarWashVehicle(id=gen_uuid(), user_id=user.id, is_default=is_default, **data)
    await save(db, vehicle)
    if is_default:
        await _clear_other_defaults(db, user.id, vehicle.id)
    return {"success": True, "data": _vehicle(vehicle)}


async def _get_vehicle_or_404(db: AsyncSession, vehicle_id: str) -> CarWashVehicle:
    vehicle = await find_one(db, CarWashVehicle, CarWashVehicle.id == vehicle_id, CarWashVehicle.is_active == True)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return vehicle


@router.get("/vehicles/{vehicle_id}")
async def get_vehicle(
    vehicle_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    vehicle = await _get_vehicle_or_404(db, vehicle_id)
    if vehicle.user_id != user.id and user.role not in ADMIN_ROLES and user.role != "wash_staff":
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return {"success": True, "data": _vehicle(vehicle)}


@router.put("/vehicles/{vehicle_id}")
async def update_vehicle(
    vehicle_id: str,
    body: VehicleUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    vehicle = await _get_vehicle_or_404(db, vehicle_id)
    if vehicle.user_id != user.id:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(vehicle, k, v)
    vehicle.updated_at = utcnow()
    await save(db, vehicle)
    if body.is_default:
        await _clear_other_defaults(db, user.id, vehicle.id)
    return {"success": True, "data": _vehicle(vehicle)}


@router.delete("/vehicles/{vehicle_id}")
async def delete_vehicle(
    vehicle_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    vehicle = await _get_vehicle_or_404(db, vehicle_id)
    if vehicle.user_id != user.id:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    vehicle.is_active = False
    vehicle.updated_at = utcnow()
    await save(db, vehicle)
    return {"success": True, "message": "Vehicle removed"}


# ── orders ────────────────────────────────────────────────────────────────────

class OrderCreate(BaseModel):
    station_id: str
    vehicle_id: str
    service_id: str
    addon_ids: list[str] = []
    scheduled_at: Optional[datetime] = None


@router.post("/orders", status_code=201)
async def create_order(
    body: OrderCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _get_station_or_404(db, body.station_id)
    vehicle = await _get_vehicle_or_404(db, body.vehicle_id)
    if vehicle.user_id != user.id:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    service = await find_one(db, CarWashService, CarWashService.id == body.service_id,
                             CarWashService.station_id == body.station_id, CarWashService.is_active == True)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found at this station")

    addons = []
    if body.addon_ids:
        addons = await find_all(db, CarWashAddon, CarWashAddon.id.in_(body.addon_ids),
                                CarWashAddon.station_id == body.station_id, CarWashAddon.is_active == True)
        if len(addons) != len(set(body.addon_ids)):
            raise HTTPException(status_code=400, detail="One or more add-ons were not found at this station")

    total = service.base_price + sum(a.price for a in addons)
    now = utcnow()
    status = "scheduled" if body.scheduled_at else "queued"
    order_id = gen_uuid()
    order = CarWashOrder(
        id=order_id, ref=f"BW-{order_id[:8].upper()}", station_id=body.station_id, user_id=user.id,
        vehicle_id=body.vehicle_id, service_id=body.service_id, status=status,
        total=total, scheduled_at=body.scheduled_at,
        queued_at=(None if body.scheduled_at else now),
    )
    await save(db, order)

    for a in addons:
        await save(db, CarWashOrderItem(id=gen_uuid(), order_id=order.id, addon_id=a.id, name=a.name, price=a.price))

    await save(db, CarWashStatusEvent(id=gen_uuid(), order_id=order.id, status=status, actor_id=user.id))
    return {"success": True, "data": _order(order)}


@router.get("/orders/my")
async def list_my_orders(
    status_filter: Optional[str] = Query(None, alias="status"),
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conditions = [CarWashOrder.user_id == user.id]
    if status_filter:
        conditions.append(CarWashOrder.status == status_filter)
    skip = (page - 1) * limit
    total = await count(db, CarWashOrder, *conditions)
    items = await find_all(db, CarWashOrder, *conditions, order_by=CarWashOrder.created_at.desc(), skip=skip, limit=limit)
    return {"success": True, "count": len(items), "total": total, "data": [_order(o) for o in items]}


@router.get("/stations/{station_id}/orders")
async def list_station_orders(
    station_id: str,
    status_filter: Optional[str] = Query(None, alias="status"),
    page: int = 1,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Staff live-queue view. `status` accepts a comma-separated list."""
    await _get_station_or_404(db, station_id)
    await require_station_access(db, user, station_id, "staff")
    conditions = [CarWashOrder.station_id == station_id]
    if status_filter:
        statuses = [s.strip() for s in status_filter.split(",") if s.strip()]
        if statuses:
            conditions.append(CarWashOrder.status.in_(statuses))
    skip = (page - 1) * limit
    total = await count(db, CarWashOrder, *conditions)
    items = await find_all(db, CarWashOrder, *conditions, order_by=CarWashOrder.created_at.asc(), skip=skip, limit=limit)

    # Denormalized display fields for the staff queue screen (mobile + web) —
    # small enough scale for a single station that per-row lookups are fine.
    data = []
    for o in items:
        customer = await db.get(User, o.user_id)
        vehicle = await db.get(CarWashVehicle, o.vehicle_id)
        service = await db.get(CarWashService, o.service_id)
        data.append({
            **_order(o),
            "customer_name": customer.name if customer else None,
            "vehicle_label": f"{vehicle.make} {vehicle.model} · {vehicle.plate}" if vehicle else None,
            "service_name": service.name if service else None,
        })
    return {"success": True, "count": len(items), "total": total, "data": data}


async def _require_order_access(db: AsyncSession, user: User, order: CarWashOrder, min_role: str = "staff"):
    if order.user_id == user.id:
        return
    await require_station_access(db, user, order.station_id, min_role)


@router.get("/orders/{order_id}")
async def get_order(
    order_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    order = await _get_order_or_404(db, order_id)
    await _require_order_access(db, user, order)
    events = await find_all(db, CarWashStatusEvent, CarWashStatusEvent.order_id == order_id,
                            order_by=CarWashStatusEvent.at.asc())
    items = await find_all(db, CarWashOrderItem, CarWashOrderItem.order_id == order_id)
    return {"success": True, "data": {**_order(order), "timeline": [_status_event(e) for e in events],
                                      "items": [_order_item(i) for i in items]}}


class OrderStatusUpdate(BaseModel):
    status: str
    note: Optional[str] = None


@router.patch("/orders/{order_id}/status")
async def update_order_status(
    order_id: str,
    body: OrderStatusUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    order = await _get_order_or_404(db, order_id)
    await require_station_access(db, user, order.station_id, "staff")

    new_status = (body.status or "").strip().lower()
    allowed = _FORWARD_TRANSITIONS.get(order.status, set())
    if new_status not in allowed:
        raise HTTPException(status_code=400,
                            detail=f"Cannot move from '{order.status}' to '{new_status}'")

    order.status = new_status
    order.staff_id = user.id
    if new_status == "queued" and not order.queued_at:
        order.queued_at = utcnow()
    order.updated_at = utcnow()
    await save(db, order)
    await save(db, CarWashStatusEvent(id=gen_uuid(), order_id=order.id, status=new_status,
                                      note=body.note, actor_id=user.id))

    if new_status == "ready":
        customer = await db.get(User, order.user_id)
        message = "Your car is ready for pickup at Bami-Wash!"
        await save(db, Notification(id=gen_uuid(), user=order.user_id,
                                    title="Car Ready", message=message, type="car_wash_ready"))
        if customer and customer.phone and sms_service.is_configured():
            try:
                await sms_service.send_sms(customer.phone, message)
            except Exception:
                pass

    return {"success": True, "data": _order(order)}


class OrderCancel(BaseModel):
    reason: Optional[str] = None


@router.post("/orders/{order_id}/cancel")
async def cancel_order(
    order_id: str,
    body: OrderCancel,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    order = await _get_order_or_404(db, order_id)
    is_customer = order.user_id == user.id
    if not is_customer:
        await require_station_access(db, user, order.station_id, "staff")
    if order.status not in _FORWARD_TRANSITIONS or "cancelled" not in _FORWARD_TRANSITIONS.get(order.status, set()):
        raise HTTPException(status_code=400, detail=f"Cannot cancel an order that is '{order.status}'")
    if is_customer and order.status not in ("scheduled", "queued"):
        raise HTTPException(status_code=400, detail="Contact the station to cancel an order already in progress")

    order.status = "cancelled"
    order.cancelled_reason = body.reason
    order.updated_at = utcnow()
    await save(db, order)
    await save(db, CarWashStatusEvent(id=gen_uuid(), order_id=order.id, status="cancelled",
                                      note=body.reason, actor_id=user.id))
    return {"success": True, "data": _order(order)}


# ── QR payment (the debit core) ──────────────────────────────────────────────

@router.post("/orders/{order_id}/qr/issue", status_code=201)
async def issue_order_qr(
    order_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    order = await _get_order_or_404(db, order_id)
    await require_station_access(db, user, order.station_id, "staff")
    if order.status not in ("scheduled", "queued"):
        raise HTTPException(status_code=400, detail="QR can only be issued before the wash starts")

    # Void any prior issued QR for this order — only one live QR at a time.
    prior = await find_all(db, CarWashQrPayment, CarWashQrPayment.order_id == order_id,
                           CarWashQrPayment.status == "issued")
    for p in prior:
        p.status = "void"
        await save(db, p)

    nonce = uuid.uuid4().hex
    expires_at = utcnow() + timedelta(minutes=10)
    qr = CarWashQrPayment(id=gen_uuid(), order_id=order_id, nonce=nonce, amount=order.total,
                          expires_at=expires_at, status="issued", staff_id=user.id)
    await save(db, qr)

    # order ref + staff name are embedded so the customer's app can show
    # "Pay ₦X to Bami-Wash" straight off the decoded token, no extra round trip.
    token = jwt.encode(
        {"typ": _QR_TYP, "order_id": order_id, "order_ref": order.ref, "qr_id": qr.id,
         "amount": order.total, "staff_name": user.name, "jti": nonce, "exp": expires_at},
        settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM,
    )
    return {"success": True, "data": {"qrToken": token, "qrId": qr.id, "amount": order.total,
                                      "expiresAt": expires_at}}


@router.get("/qr/{qr_id}")
async def get_qr_status(
    qr_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    qr = await find_one(db, CarWashQrPayment, CarWashQrPayment.id == qr_id)
    if not qr:
        raise HTTPException(status_code=404, detail="QR payment not found")
    order = await _get_order_or_404(db, qr.order_id)
    await _require_order_access(db, user, order)
    return {"success": True, "data": _qr(qr)}


class QrScan(BaseModel):
    qrToken: str


@router.post("/qr/scan")
async def scan_qr(
    body: QrScan,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Customer confirm+debit. Mirrors meters.py's topup_my_meter debit pattern.
    Race-condition note: no row-locking (matches the rest of this codebase's
    wallet-debit code — meters.py, wallet.py transfer/deduct do the same); two
    cheap guards close the realistic risk instead: a fresh status re-check here,
    and a deterministic Transaction.reference used as an idempotency key. True
    concurrent-request TOCTOU is a pre-existing platform-wide gap, not fixed here."""
    try:
        payload = jwt.decode(body.qrToken, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=400, detail="Invalid or expired QR code")
    if payload.get("typ") != _QR_TYP:
        raise HTTPException(status_code=400, detail="Invalid QR code")

    qr = await find_one(db, CarWashQrPayment, CarWashQrPayment.id == payload.get("qr_id"))
    if not qr:
        raise HTTPException(status_code=404, detail="QR payment not found")
    if qr.expires_at < utcnow():
        if qr.status == "issued":
            qr.status = "expired"
            await save(db, qr)
        raise HTTPException(status_code=400, detail="This QR code has expired")
    if qr.status != "issued":
        raise HTTPException(status_code=400, detail=f"This QR code is already {qr.status}")

    order = await _get_order_or_404(db, qr.order_id)
    if order.user_id != user.id:
        raise HTTPException(status_code=403, detail="This order does not belong to you")

    reference = f"CARWASH-QR-{qr.id}"
    existing_tx = await find_one(db, Transaction, Transaction.reference == reference,
                                 Transaction.type == "car_wash_payment")
    if existing_tx:
        # Already processed (double-tap) — return the prior result, don't double-debit.
        wallet = await find_one(db, Wallet, Wallet.user_id == user.id)
        return {"success": True, "message": "Already paid",
                "data": {"amountPaid": existing_tx.amount,
                         "newWalletBalance": wallet.balance if wallet else None,
                         "transactionId": existing_tx.id}}

    wallet = await find_one(db, Wallet, Wallet.user_id == user.id)
    if not wallet or wallet.balance < qr.amount:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance")

    wallet.balance -= qr.amount
    wallet.total_spent += qr.amount
    wallet.updated_at = utcnow()
    await save(db, wallet)

    tx = Transaction(
        id=gen_uuid(), user=user.id, wallet_id=wallet.id, amount=qr.amount,
        type="car_wash_payment", status="completed", method="wallet", reference=reference,
        description=f"Bami-Wash payment — order {order.id[:8]}", created_by=user.id,
    )
    await save(db, tx)

    qr.status = "paid"
    qr.paid_at = utcnow()
    await save(db, qr)

    order.paid_at = qr.paid_at
    order.updated_at = utcnow()
    await save(db, order)

    return {"success": True, "message": "Payment successful",
            "data": {"amountPaid": qr.amount, "newWalletBalance": wallet.balance, "transactionId": tx.id}}


# ── support tickets ───────────────────────────────────────────────────────────

class TicketCreate(BaseModel):
    station_id: str
    order_id: Optional[str] = None
    subject: str
    description: str


@router.post("/support-tickets", status_code=201)
async def create_support_ticket(
    body: TicketCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _get_station_or_404(db, body.station_id)
    ticket = CarWashSupportTicket(id=gen_uuid(), user_id=user.id, **body.model_dump())
    await save(db, ticket)
    return {"success": True, "data": _ticket(ticket)}


@router.get("/support-tickets/my")
async def list_my_tickets(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    items = await find_all(db, CarWashSupportTicket, CarWashSupportTicket.user_id == user.id,
                           order_by=CarWashSupportTicket.created_at.desc())
    return {"success": True, "count": len(items), "data": [_ticket(t) for t in items]}


@router.get("/stations/{station_id}/support-tickets")
async def list_station_tickets(
    station_id: str,
    status_filter: Optional[str] = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await _get_station_or_404(db, station_id)
    await require_station_access(db, user, station_id, "staff")
    conditions = [CarWashSupportTicket.station_id == station_id]
    if status_filter:
        conditions.append(CarWashSupportTicket.status == status_filter)
    items = await find_all(db, CarWashSupportTicket, *conditions, order_by=CarWashSupportTicket.created_at.desc())
    return {"success": True, "count": len(items), "data": [_ticket(t) for t in items]}


@router.get("/support-tickets/{ticket_id}")
async def get_ticket(
    ticket_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ticket = await find_one(db, CarWashSupportTicket, CarWashSupportTicket.id == ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.user_id != user.id:
        await require_station_access(db, user, ticket.station_id, "staff")
    return {"success": True, "data": _ticket(ticket)}


class TicketResolve(BaseModel):
    resolution_note: Optional[str] = None
    refund: bool = False
    refund_amount: Optional[float] = None


@router.patch("/support-tickets/{ticket_id}/resolve")
async def resolve_ticket(
    ticket_id: str,
    body: TicketResolve,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ticket = await find_one(db, CarWashSupportTicket, CarWashSupportTicket.id == ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    await require_station_access(db, user, ticket.station_id, "staff")
    if ticket.status in ("resolved", "refunded"):
        raise HTTPException(status_code=400, detail="This ticket has already been resolved")

    if body.refund:
        if not body.refund_amount or body.refund_amount <= 0:
            raise HTTPException(status_code=400, detail="refund_amount must be positive")
        if ticket.refund_transaction_id:
            raise HTTPException(status_code=400, detail="A refund has already been issued for this ticket")

        wallet = await find_one(db, Wallet, Wallet.user_id == ticket.user_id)
        if not wallet:
            raise HTTPException(status_code=404, detail="Customer wallet not found")
        wallet.balance += body.refund_amount
        wallet.total_earnings += body.refund_amount
        wallet.updated_at = utcnow()
        await save(db, wallet)

        tx = Transaction(
            id=gen_uuid(), user=ticket.user_id, wallet_id=wallet.id, amount=body.refund_amount,
            type="car_wash_refund", status="completed", method="internal",
            reference=f"CARWASH-REFUND-{ticket.id}",
            description=f"Bami-Wash refund — ticket {ticket.id[:8]}", created_by=user.id,
        )
        await save(db, tx)

        ticket.status = "refunded"
        ticket.refund_amount = body.refund_amount
        ticket.refund_transaction_id = tx.id
    else:
        ticket.status = "resolved"

    ticket.resolution_note = body.resolution_note
    ticket.resolved_by = user.id
    ticket.resolved_at = utcnow()
    ticket.updated_at = utcnow()
    await save(db, ticket)
    return {"success": True, "data": _ticket(ticket)}
