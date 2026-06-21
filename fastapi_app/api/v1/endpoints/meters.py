from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta
from typing import Optional
from pydantic import BaseModel

from models.user import User
from models.meter_device import MeterDevice
from models.meter_reading import MeterReading
from models.unit import Unit
from models.tenant import Tenant
from models.notification import Notification
from models.wallet import Wallet
from models.transaction import Transaction
from core.security import get_current_user
from core.database import get_db
from core.db_helpers import find_one, find_all, save, count
from core.config import settings
from models.base import gen_uuid
import utils.tuya as tuya
import time

router = APIRouter(prefix="/meters", tags=["Meters"])
ADMIN_ROLES = {"super_admin", "admin", "super_manager", "business_owner"}


# ── helpers ───────────────────────────────────────────────────────────────────

def _meter_dict(m: MeterDevice) -> dict:
    return {
        "id": m.id,
        "device_id": m.device_id,
        "device_name": m.device_name,
        "unit": m.unit,
        "estate": m.estate,
        "tenant": m.tenant,
        "meter_number": m.meter_number,
        "rate_per_kwh": m.rate_per_kwh,
        "prepaid_mode": m.prepaid_mode,
        "credit_balance": m.credit_balance,
        "low_balance_threshold": m.low_balance_threshold,
        "last_kwh": m.last_kwh,
        "last_voltage": m.last_voltage,
        "last_current": m.last_current,
        "last_power": m.last_power,
        "last_synced_at": m.last_synced_at,
        "is_online": m.is_online,
        "is_connected": m.is_connected,
        "is_active": m.is_active,
        "created_at": m.created_at,
    }


async def _get_tenant_meter(db: AsyncSession, user: User) -> MeterDevice:
    tenant = await find_one(db, Tenant, Tenant.user == user.id, Tenant.is_active == True)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant record not found")
    meter = await find_one(db, MeterDevice, MeterDevice.unit == tenant.unit,
                           MeterDevice.is_active == True)
    if not meter:
        raise HTTPException(status_code=404, detail="No meter assigned to your unit")
    return meter


# ── schemas ───────────────────────────────────────────────────────────────────

class RegisterMeter(BaseModel):
    device_id: str
    device_name: Optional[str] = None
    unit_id: str
    meter_number: Optional[str] = None
    rate_per_kwh: Optional[float] = None
    prepaid_mode: bool = True
    low_balance_threshold: float = 500.0


class UpdateMeterSettings(BaseModel):
    device_name: Optional[str] = None
    rate_per_kwh: Optional[float] = None
    low_balance_threshold: Optional[float] = None
    prepaid_mode: Optional[bool] = None


class TopUpRequest(BaseModel):
    amount: float          # ₦ amount to top up


# ── admin: register meter ─────────────────────────────────────────────────────

@router.post("", status_code=201)
async def register_meter(
    body: RegisterMeter,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    unit = await find_one(db, Unit, Unit.id == body.unit_id, Unit.is_active == True)
    if not unit:
        raise HTTPException(status_code=404, detail="Unit not found")

    existing = await find_one(db, MeterDevice, MeterDevice.device_id == body.device_id)
    if existing:
        raise HTTPException(status_code=409, detail="Device already registered")

    # Try to fetch device info from Tuya if credentials configured
    device_name = body.device_name
    if settings.TUYA_CLIENT_ID:
        try:
            info = await tuya.get_device_info(body.device_id)
            device_name = device_name or info.get("name")
        except Exception:
            pass

    tenant = await find_one(db, Tenant, Tenant.unit == body.unit_id, Tenant.is_active == True)

    meter = MeterDevice(
        id=gen_uuid(),
        device_id=body.device_id,
        device_name=device_name or f"Meter – {unit.label}",
        unit=body.unit_id,
        estate=unit.estate,
        tenant=tenant.id if tenant else None,
        meter_number=body.meter_number or unit.meter_number,
        rate_per_kwh=body.rate_per_kwh or settings.TUYA_ELECTRICITY_RATE,
        prepaid_mode=body.prepaid_mode,
        low_balance_threshold=body.low_balance_threshold,
        baseline_date=datetime.utcnow(),
    )
    await save(db, meter)

    # Update unit's meter_number field
    if body.meter_number:
        unit.meter_number = body.meter_number
        await save(db, unit)

    return {"success": True, "message": "Meter registered", "data": _meter_dict(meter)}


# ── admin: list all meters ────────────────────────────────────────────────────

@router.get("")
async def list_meters(
    estate_id: Optional[str] = Query(None, alias="estateId"),
    unit_id: Optional[str] = Query(None, alias="unitId"),
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")

    conditions = [MeterDevice.is_active == True]
    if estate_id:
        conditions.append(MeterDevice.estate == estate_id)
    if unit_id:
        conditions.append(MeterDevice.unit == unit_id)

    skip = (page - 1) * limit
    total = await count(db, MeterDevice, *conditions)
    items = await find_all(db, MeterDevice, *conditions,
                           order_by=MeterDevice.created_at.desc(), skip=skip, limit=limit)

    # Enrich with unit labels
    unit_ids = {m.unit for m in items if m.unit}
    units = {}
    if unit_ids:
        unit_rows = await find_all(db, Unit, Unit.id.in_(list(unit_ids)))
        units = {u.id: u for u in unit_rows}

    data = []
    for m in items:
        d = _meter_dict(m)
        u = units.get(m.unit)
        d["unit_label"] = u.label if u else None
        data.append(d)

    return {"success": True, "total": total, "total_pages": -(-total // limit),
            "page": page, "data": data}


# ── admin: update meter settings ──────────────────────────────────────────────

@router.patch("/{meter_id}")
async def update_meter(
    meter_id: str,
    body: UpdateMeterSettings,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    meter = await find_one(db, MeterDevice, MeterDevice.id == meter_id,
                           MeterDevice.is_active == True)
    if not meter:
        raise HTTPException(status_code=404, detail="Meter not found")

    for k, v in body.model_dump(exclude_none=True).items():
        setattr(meter, k, v)
    meter.updated_at = datetime.utcnow()
    await save(db, meter)
    return {"success": True, "data": _meter_dict(meter)}


# ── admin: delete/unassign meter ──────────────────────────────────────────────

@router.delete("/{meter_id}")
async def delete_meter(
    meter_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    meter = await find_one(db, MeterDevice, MeterDevice.id == meter_id)
    if not meter:
        raise HTTPException(status_code=404, detail="Meter not found")
    meter.is_active = False
    await save(db, meter)
    return {"success": True, "message": "Meter unassigned"}


# ── live status (admin or tenant of that unit) ────────────────────────────────

@router.get("/unit/{unit_id}/status")
async def get_unit_meter_status(
    unit_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    meter = await find_one(db, MeterDevice, MeterDevice.unit == unit_id,
                           MeterDevice.is_active == True)
    if not meter:
        raise HTTPException(status_code=404, detail="No meter for this unit")

    # Permission: admin or tenant of this unit
    if user.role not in ADMIN_ROLES:
        tenant = await find_one(db, Tenant, Tenant.user == user.id,
                                Tenant.unit == unit_id, Tenant.is_active == True)
        if not tenant:
            raise HTTPException(status_code=403, detail="Access denied")

    live = {}
    if settings.TUYA_CLIENT_ID:
        try:
            raw = await tuya.get_device_status(meter.device_id)
            live = tuya.parse_status(raw)
            # Update snapshot
            meter.last_kwh = live["kwh"]
            meter.last_voltage = live["voltage"]
            meter.last_current = live["current"]
            meter.last_power = live["power"]
            meter.last_power_factor = live["power_factor"]
            meter.is_connected = live.get("switch", True)
            meter.last_synced_at = datetime.utcnow()
            meter.raw_status = live.get("raw", {})
            await save(db, meter)
        except Exception as e:
            live = {"error": str(e)}

    return {
        "success": True,
        "data": {
            **_meter_dict(meter),
            "live": live,
            "kwh_this_month": round(meter.last_kwh - meter.baseline_kwh, 3),
            "cost_this_month": round(
                (meter.last_kwh - meter.baseline_kwh) * meter.rate_per_kwh, 2),
        },
    }


# ── tenant: my meter ──────────────────────────────────────────────────────────

@router.get("/my")
async def get_my_meter(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    meter = await _get_tenant_meter(db, user)

    live = {}
    if settings.TUYA_CLIENT_ID:
        try:
            raw = await tuya.get_device_status(meter.device_id)
            live = tuya.parse_status(raw)
            meter.last_kwh = live["kwh"]
            meter.last_voltage = live["voltage"]
            meter.last_current = live["current"]
            meter.last_power = live["power"]
            meter.is_connected = live.get("switch", True)
            meter.last_synced_at = datetime.utcnow()
            await save(db, meter)
        except Exception:
            pass

    return {
        "success": True,
        "data": {
            **_meter_dict(meter),
            "live": live,
            "kwh_this_month": round(meter.last_kwh - meter.baseline_kwh, 3),
            "cost_this_month": round(
                (meter.last_kwh - meter.baseline_kwh) * meter.rate_per_kwh, 2),
        },
    }


# ── tenant: usage history ─────────────────────────────────────────────────────

@router.get("/my/history")
async def get_my_meter_history(
    days: int = 7,
    page: int = 1,
    limit: int = 30,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    meter = await _get_tenant_meter(db, user)
    since = datetime.utcnow() - timedelta(days=days)

    conditions = [
        MeterReading.meter_device == meter.id,
        MeterReading.recorded_at >= since,
        MeterReading.is_active == True,
    ]
    skip = (page - 1) * limit
    total = await count(db, MeterReading, *conditions)
    readings = await find_all(db, MeterReading, *conditions,
                              order_by=MeterReading.recorded_at.desc(),
                              skip=skip, limit=limit)

    return {
        "success": True,
        "total": total,
        "total_pages": -(-total // limit),
        "page": page,
        "data": [{
            "id": r.id,
            "kwh": r.kwh,
            "voltage": r.voltage,
            "current": r.current,
            "power": r.power,
            "credit_balance": r.credit_balance,
            "recorded_at": r.recorded_at,
        } for r in readings],
    }


# ── admin: unit history ───────────────────────────────────────────────────────

@router.get("/unit/{unit_id}/history")
async def get_unit_meter_history(
    unit_id: str,
    days: int = 30,
    page: int = 1,
    limit: int = 48,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    meter = await find_one(db, MeterDevice, MeterDevice.unit == unit_id,
                           MeterDevice.is_active == True)
    if not meter:
        raise HTTPException(status_code=404, detail="No meter for this unit")

    since = datetime.utcnow() - timedelta(days=days)
    conditions = [MeterReading.meter_device == meter.id,
                  MeterReading.recorded_at >= since, MeterReading.is_active == True]
    skip = (page - 1) * limit
    total = await count(db, MeterReading, *conditions)
    readings = await find_all(db, MeterReading, *conditions,
                              order_by=MeterReading.recorded_at.asc(),
                              skip=skip, limit=limit)

    return {
        "success": True, "total": total, "page": page,
        "total_pages": -(-total // limit),
        "meter": _meter_dict(meter),
        "data": [{"kwh": r.kwh, "power": r.power, "voltage": r.voltage,
                  "credit_balance": r.credit_balance, "recorded_at": r.recorded_at}
                 for r in readings],
    }


# ── tenant: top-up / buy units ────────────────────────────────────────────────

@router.post("/my/topup")
async def topup_my_meter(
    body: TopUpRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    meter = await _get_tenant_meter(db, user)

    # Deduct from wallet
    wallet = await find_one(db, Wallet, Wallet.user_id == user.id)
    if not wallet or wallet.balance < body.amount:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance")

    wallet.balance -= body.amount
    wallet.total_spent += body.amount
    wallet.updated_at = datetime.utcnow()
    await save(db, wallet)

    # Record transaction
    tx = Transaction(
        id=gen_uuid(), user=user.id, wallet_id=wallet.id,
        amount=body.amount, type="electricity_topup", status="completed",
        method="wallet",
        reference=f"ELEC-{int(time.time()*1000)}",
        description=f"Electricity top-up – {meter.device_name or meter.meter_number}",
        created_by=user.id,
    )
    await save(db, tx)

    # Calculate kWh units purchased
    kwh_purchased = body.amount / meter.rate_per_kwh
    meter.credit_balance += body.amount

    # Push to Tuya if configured
    tuya_success = False
    if settings.TUYA_CLIENT_ID:
        try:
            tuya_success = await tuya.recharge_meter(meter.device_id, kwh_purchased)
            if tuya_success and not meter.is_connected:
                await tuya.set_switch(meter.device_id, True)
                meter.is_connected = True
        except Exception:
            pass

    meter.updated_at = datetime.utcnow()
    await save(db, meter)

    # Notify tenant
    notif = Notification(
        id=gen_uuid(), user=user.id,
        title="Electricity Top-Up Successful",
        message=(
            f"₦{body.amount:,.0f} added — {kwh_purchased:.1f} kWh units credited to your meter. "
            f"New balance: ₦{meter.credit_balance:,.0f}"
        ),
        type="meter_topup",
    )
    await save(db, notif)

    return {
        "success": True,
        "message": "Top-up successful",
        "data": {
            "amount_paid": body.amount,
            "kwh_purchased": round(kwh_purchased, 2),
            "new_balance": meter.credit_balance,
            "new_wallet_balance": wallet.balance,
            "tuya_updated": tuya_success,
            "transaction_id": tx.id,
        },
    }


# ── admin: remote disconnect/reconnect ────────────────────────────────────────

@router.post("/{meter_id}/disconnect")
async def disconnect_meter(
    meter_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    meter = await find_one(db, MeterDevice, MeterDevice.id == meter_id,
                           MeterDevice.is_active == True)
    if not meter:
        raise HTTPException(status_code=404, detail="Meter not found")

    if settings.TUYA_CLIENT_ID:
        await tuya.set_switch(meter.device_id, False)

    meter.is_connected = False
    await save(db, meter)

    # Notify tenant
    if meter.tenant:
        notif = Notification(
            id=gen_uuid(), user=meter.tenant,
            title="Power Disconnected",
            message="Your electricity has been disconnected by the estate manager. "
                    "Please contact them or top up your meter balance.",
            type="meter_disconnect",
        )
        await save(db, notif)

    return {"success": True, "message": "Meter disconnected"}


@router.post("/{meter_id}/reconnect")
async def reconnect_meter(
    meter_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    meter = await find_one(db, MeterDevice, MeterDevice.id == meter_id,
                           MeterDevice.is_active == True)
    if not meter:
        raise HTTPException(status_code=404, detail="Meter not found")

    if settings.TUYA_CLIENT_ID:
        await tuya.set_switch(meter.device_id, True)

    meter.is_connected = True
    await save(db, meter)

    if meter.tenant:
        notif = Notification(
            id=gen_uuid(), user=meter.tenant,
            title="Power Reconnected",
            message="Your electricity has been restored. Welcome back!",
            type="meter_reconnect",
        )
        await save(db, notif)

    return {"success": True, "message": "Meter reconnected"}


# ── admin: reset baseline (new tenant move-in) ────────────────────────────────

@router.post("/{meter_id}/reset-baseline")
async def reset_meter_baseline(
    meter_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    meter = await find_one(db, MeterDevice, MeterDevice.id == meter_id,
                           MeterDevice.is_active == True)
    if not meter:
        raise HTTPException(status_code=404, detail="Meter not found")

    meter.baseline_kwh = meter.last_kwh
    meter.baseline_date = datetime.utcnow()
    meter.credit_balance = 0.0
    await save(db, meter)
    return {"success": True, "message": "Baseline reset — ready for new tenant",
            "data": {"baseline_kwh": meter.baseline_kwh, "baseline_date": meter.baseline_date}}
