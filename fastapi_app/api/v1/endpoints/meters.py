from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict

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
from core.authz import accessible_estate_ids, require_estate_access
from core.db_helpers import find_one, find_all, save, count
from core.config import settings
from models.base import gen_uuid
import utils.tuya as tuya
from api.v1.endpoints.settings import electricity_rate_per_kwh
import asyncio
import math
import time
from utils.time_utils import utcnow

router = APIRouter(prefix="/meters", tags=["Meters"])
ADMIN_ROLES = {"super_admin", "admin", "super_manager", "business_owner", "manager"}


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
        "balance_kwh": round(m.credit_balance / m.rate_per_kwh, 2) if m.rate_per_kwh else None,
        "price_per_unit": round(m.rate_per_kwh / 100, 4) if m.rate_per_kwh else None,   # ₦ per 0.01 kWh
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
    model_config = ConfigDict(populate_by_name=True)
    device_id:            str            = Field(..., alias="deviceId")
    device_name:          Optional[str]  = Field(None, alias="deviceName")
    unit_id:              str            = Field(..., alias="unitId")
    meter_number:         Optional[str]  = Field(None, alias="meterNumber")
    rate_per_kwh:         Optional[float]= Field(None, alias="ratePerKwh")
    prepaid_mode:         bool           = Field(True, alias="prepaidMode")
    low_balance_threshold:float          = Field(500.0, alias="lowBalanceThreshold")


class UpdateMeterSettings(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    device_name:           Optional[str]  = Field(None, alias="deviceName")
    rate_per_kwh:          Optional[float]= Field(None, alias="ratePerKwh")
    low_balance_threshold: Optional[float]= Field(None, alias="lowBalanceThreshold")
    prepaid_mode:          Optional[bool] = Field(None, alias="prepaidMode")


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
    await require_estate_access(db, user, unit.estate)

    existing = await find_one(db, MeterDevice, MeterDevice.device_id == body.device_id)
    if existing:
        raise HTTPException(status_code=409, detail="Device already registered")
    # One meter per apartment — the tenant's app resolves "their" meter by unit.
    unit_meter = await find_one(db, MeterDevice, MeterDevice.unit == body.unit_id,
                                MeterDevice.is_active == True)
    if unit_meter:
        raise HTTPException(status_code=409,
                            detail=f"{unit.label} already has a meter ({unit_meter.device_name or unit_meter.device_id}). "
                                   "Remove it first to register a different one.")

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
        rate_per_kwh=body.rate_per_kwh or await electricity_rate_per_kwh(db),
        prepaid_mode=body.prepaid_mode,
        low_balance_threshold=body.low_balance_threshold,
        baseline_date=utcnow(),
    )
    await save(db, meter)

    # Update unit's meter_number field
    if body.meter_number:
        unit.meter_number = body.meter_number
        await save(db, unit)

    # A tenant's record keeps its own copy of the meter number (taken when they
    # were added); keep it in step so the tenant pages don't show a stale one.
    if tenant and meter.meter_number and tenant.electric_meter_number != meter.meter_number:
        tenant.electric_meter_number = meter.meter_number
        tenant.updated_at = utcnow()
        await save(db, tenant)

    return {"success": True, "message": "Meter registered", "data": _meter_dict(meter)}


# ── admin: bulk-register meters for an estate ─────────────────────────────────

class BulkMeterRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    unit_label:   str            = Field(..., alias="unitLabel")
    device_id:    str            = Field(..., alias="deviceId")
    meter_number: Optional[str]  = Field(None, alias="meterNumber")
    rate_per_kwh: Optional[float]= Field(None, alias="ratePerKwh")


class BulkRegisterMeters(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    estate_id: str               = Field(..., alias="estateId")
    rows:      list[BulkMeterRow]
    dry_run:   bool              = Field(True, alias="dryRun")


@router.post("/bulk")
async def bulk_register_meters(
    body: BulkRegisterMeters,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Attach many meters to the apartments of ONE estate, matched by unit label.

    All-or-nothing: if any row has a problem nothing is written and every row's
    result says what is wrong, so the sheet can be fixed and re-sent. `dryRun`
    (the default) validates without writing."""
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    await require_estate_access(db, user, body.estate_id, "manager")   # this writes
    if not body.rows:
        raise HTTPException(status_code=400, detail="No rows provided")
    if len(body.rows) > 500:
        raise HTTPException(status_code=400, detail="At most 500 meters per import")

    def _key(label: str) -> str:
        return " ".join((label or "").split()).casefold()

    units = await find_all(db, Unit, Unit.estate == body.estate_id, Unit.is_active == True, limit=5000)
    by_label: dict[str, list[Unit]] = {}
    for u in units:
        by_label.setdefault(_key(u.label), []).append(u)

    metered_units = {m.unit for m in await find_all(db, MeterDevice, MeterDevice.estate == body.estate_id,
                                                    MeterDevice.is_active == True, limit=5000)}
    wanted_ids = [r.device_id.strip() for r in body.rows if r.device_id.strip()]
    taken_ids = set()
    if wanted_ids:
        rows = await find_all(db, MeterDevice, MeterDevice.device_id.in_(wanted_ids), limit=5000)
        taken_ids = {m.device_id for m in rows}

    results, seen_ids, seen_units, valid = [], set(), set(), []
    for i, r in enumerate(body.rows, start=1):
        label, device_id = r.unit_label.strip(), r.device_id.strip()
        error = None
        matches = by_label.get(_key(label), [])
        if not label or not device_id:
            error = "Unit label and device ID are both required"
        elif not matches:
            error = f"No apartment named '{label}' in this estate"
        elif len(matches) > 1:
            error = f"More than one apartment is named '{label}' — rename one first"
        elif device_id in taken_ids:
            error = "This device is already registered"
        elif device_id in seen_ids:
            error = "This device ID appears more than once in the file"
        elif matches[0].id in metered_units:
            error = f"{matches[0].label} already has a meter"
        elif matches[0].id in seen_units:
            error = f"{matches[0].label} appears more than once in the file"
        if r.rate_per_kwh is not None and r.rate_per_kwh <= 0:
            error = error or "Rate per kWh must be positive"
        seen_ids.add(device_id)
        if matches:
            seen_units.add(matches[0].id)
        results.append({"row": i, "unit_label": label, "device_id": device_id,
                        "status": "error" if error else "ok", "error": error})
        if not error:
            valid.append((matches[0], r, device_id))

    errors = sum(1 for x in results if x["status"] == "error")
    created = 0
    if not body.dry_run and errors == 0:
        tenants = await find_all(db, Tenant, Tenant.unit.in_([u.id for u, _, _ in valid]),
                                 Tenant.is_active == True, limit=5000)
        tenant_by_unit = {t.unit: t.id for t in tenants}
        tenant_obj_by_unit = {t.unit: t for t in tenants}
        platform_rate = await electricity_rate_per_kwh(db)
        for unit, r, device_id in valid:
            number = (r.meter_number or "").strip() or unit.meter_number
            db.add(MeterDevice(
                id=gen_uuid(), device_id=device_id, device_name=f"Meter – {unit.label}",
                unit=unit.id, estate=unit.estate, tenant=tenant_by_unit.get(unit.id),
                meter_number=number, rate_per_kwh=r.rate_per_kwh or platform_rate,
                baseline_date=utcnow(),
            ))
            if (r.meter_number or "").strip():
                unit.meter_number = number
            occupant = tenant_obj_by_unit.get(unit.id)
            if occupant and number and occupant.electric_meter_number != number:
                occupant.electric_meter_number = number      # keep the tenant's own copy in step
                occupant.updated_at = utcnow()
        await db.commit()
        created = len(valid)

    return {"success": errors == 0, "data": {
        "dry_run": body.dry_run, "total": len(results), "valid": len(results) - errors,
        "errors": errors, "created": created, "results": results,
    }}


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

    # Cross-business isolation: only meters in the caller's estates.
    allowed = await accessible_estate_ids(db, user)
    conditions = [MeterDevice.is_active == True]
    if allowed is not None:
        if not allowed:
            return {"success": True, "total": 0, "total_pages": 0, "page": page, "data": []}
        conditions.append(MeterDevice.estate.in_(allowed))
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
    await require_estate_access(db, user, meter.estate)

    for k, v in body.model_dump(exclude_none=True).items():
        setattr(meter, k, v)
    meter.updated_at = utcnow()
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
    await require_estate_access(db, user, meter.estate)
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

    # Permission: estate staff of this meter, or the tenant of this unit
    if user.role in ADMIN_ROLES:
        await require_estate_access(db, user, meter.estate)
    else:
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
            meter.last_synced_at = utcnow()
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
            info = await tuya.get_device_info(meter.device_id)
            meter.is_online = bool(info.get("online"))
            meter.last_kwh = live["kwh"]
            meter.last_voltage = live["voltage"]
            meter.last_current = live["current"]
            meter.last_power = live["power"]
            meter.is_connected = live.get("switch", True)
            if live.get("balance_kwh") is not None:
                # Breaker meters hold the prepaid credit themselves — show theirs.
                meter.credit_balance = round(live["balance_kwh"] * meter.rate_per_kwh, 2)
                meter.prepaid_mode = live["prepayment"]
            meter.last_synced_at = utcnow()
            await save(db, meter)
            live.pop("raw", None)
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
    since = utcnow() - timedelta(days=days)

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
    await require_estate_access(db, user, meter.estate)

    since = utcnow() - timedelta(days=days)
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
    """Buy electricity from the wallet and send it to the tenant's own meter.

    Money only leaves the wallet for electricity that is really delivered:
      1. the meter must be reachable (online) BEFORE anything is charged;
      2. if Tuya refuses the recharge, the wallet is refunded in full;
      3. after Tuya accepts, the meter's own balance is read back to confirm.
    If it is accepted but not yet confirmed we keep the money and say so
    (status "unconfirmed") rather than refund — a refund could give away power
    the meter then applies."""
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    if not settings.TUYA_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Electricity top-up is not available right now")

    meter = await _get_tenant_meter(db, user)
    rate = meter.rate_per_kwh or await electricity_rate_per_kwh(db)
    # The meter takes whole 0.01 kWh steps — round DOWN so nobody is credited more than they paid for.
    kwh = math.floor(body.amount / rate * 100 + 1e-9) / 100
    if kwh < 0.01:
        raise HTTPException(status_code=400, detail="Amount is too small to buy any electricity")

    # 1. Reachable before we take a naira.
    try:
        info = await tuya.get_device_info(meter.device_id)
        status_before = await tuya.get_device_status(meter.device_id)
        balance_before = tuya.parse_status(status_before)["balance_kwh"]
    except Exception:
        raise HTTPException(status_code=502, detail="We could not reach your meter. You have not been charged — please try again shortly.")
    if not info.get("online"):
        raise HTTPException(status_code=409, detail="Your meter is offline right now, so it can't be topped up. You have not been charged.")

    wallet = await find_one(db, Wallet, Wallet.user_id == user.id)
    if not wallet or wallet.balance < body.amount:
        raise HTTPException(status_code=400, detail="Insufficient wallet balance")

    # 2. Take the money (recorded as pending until the meter confirms).
    wallet.balance -= body.amount
    wallet.total_spent += body.amount
    wallet.updated_at = utcnow()
    await save(db, wallet)
    reference = f"ELEC-{int(time.time()*1000)}"
    label = meter.device_name or meter.meter_number
    tx = Transaction(
        id=gen_uuid(), user=user.id, wallet_id=wallet.id, amount=body.amount,
        type="electricity_topup", status="pending", method="wallet", reference=reference,
        description=f"Electricity top-up – {label} ({kwh:g} kWh)", created_by=user.id,
    )
    await save(db, tx)

    async def refund(reason: str):
        wallet.balance += body.amount
        wallet.total_spent -= body.amount
        wallet.updated_at = utcnow()
        tx.status = "failed"
        tx.notes = reason
        await save(db, wallet)
        await save(db, tx)
        await save(db, Transaction(
            id=gen_uuid(), user=user.id, wallet_id=wallet.id, amount=body.amount,
            type="electricity_refund", status="completed", method="wallet",
            reference=f"{reference}-REFUND", description=f"Refund – electricity top-up could not be delivered",
            created_by=user.id,
        ))

    # 3. Deliver, then verify.
    try:
        accepted = await tuya.recharge_meter(meter.device_id, kwh)
    except Exception as e:
        await refund(f"recharge error: {e}"[:250])
        raise HTTPException(status_code=502, detail="Your meter did not accept the top-up. Your wallet has been refunded.")
    if not accepted:
        await refund("meter rejected the recharge")
        raise HTTPException(status_code=502, detail="Your meter did not accept the top-up. Your wallet has been refunded.")

    # Two signs of delivery, whichever comes first:
    #  * the meter acknowledges the credit (its charge_energy now reads exactly
    #    what we sent) — seen within ~1 minute on breaker meters;
    #  * the balance rises by the amount — breaker meters can take ~5 minutes
    #    to report that.
    # The acknowledgement only counts if it changed, since a repeat of the same
    # amount would look identical to the last top-up.
    units = int(round(kwh * 100))
    charge_before = status_before.get("charge_energy")
    confirmed, balance_after = False, None
    for _ in range(15):
        await asyncio.sleep(4)
        try:
            status = await tuya.get_device_status(meter.device_id)
        except Exception:
            continue
        balance_after = tuya.parse_status(status)["balance_kwh"]
        if balance_before is None and balance_after is None and "charge_energy" not in status:
            confirmed = True          # older meter with nothing to read back; Tuya accepted it
            break
        if "charge_energy" in status and status["charge_energy"] == units and charge_before != units:
            confirmed = True
            break
        if balance_before is not None and balance_after is not None \
                and abs(balance_after - (balance_before + kwh)) <= 0.011:
            confirmed = True
            break

    tx.status = "completed" if confirmed else "unconfirmed"
    await save(db, tx)
    if confirmed and balance_before is not None and (balance_after is None or balance_after < balance_before + kwh - 0.011):
        # Delivered, but the meter's balance report lags — use what we know it holds.
        meter.credit_balance = round((balance_before + kwh) * rate, 2)
    elif balance_after is not None:
        meter.credit_balance = round(balance_after * rate, 2)
    elif confirmed:
        meter.credit_balance += body.amount          # older meters keep no balance of their own
    if confirmed and not meter.is_connected:
        try:
            await tuya.set_switch(meter.device_id, True)
            meter.is_connected = True
        except Exception:
            pass
    meter.updated_at = utcnow()
    await save(db, meter)

    await save(db, Notification(
        id=gen_uuid(), user=user.id,
        title="Electricity Top-Up Successful" if confirmed else "Electricity Top-Up Received",
        message=(f"₦{body.amount:,.0f} added — {kwh:g} kWh credited to your meter."
                 if confirmed else
                 f"We received ₦{body.amount:,.0f} for {kwh:g} kWh. Your meter hasn't confirmed it yet — it will update shortly."),
        type="meter_topup",
    ))

    return {
        "success": True,
        "message": "Top-up successful" if confirmed else "Top-up received — waiting for your meter to confirm",
        "data": {
            "amount_paid": body.amount,
            "kwh_purchased": kwh,
            "status": "completed" if confirmed else "unconfirmed",
            "new_balance": meter.credit_balance,
            "balance_kwh": round(meter.credit_balance / rate, 2) if rate else None,
            "new_wallet_balance": wallet.balance,
            "tuya_updated": confirmed,
            "transaction_id": tx.id,
        },
    }


# ── admin: remote disconnect/reconnect ────────────────────────────────────────

class PrepaymentRequest(BaseModel):
    enabled: bool
    confirm: bool = False      # required to switch ON when the balance is zero


@router.post("/{meter_id}/prepayment")
async def set_meter_prepayment(
    meter_id: str,
    body: PrepaymentRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Turn the meter's OWN prepaid mode on/off. ON means the meter itself cuts
    power the moment its balance hits zero, so switching it on for a meter with
    no credit cuts that apartment immediately — hence the explicit `confirm`."""
    if user.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admins only")
    meter = await find_one(db, MeterDevice, MeterDevice.id == meter_id, MeterDevice.is_active == True)
    if not meter:
        raise HTTPException(status_code=404, detail="Meter not found")
    await require_estate_access(db, user, meter.estate, "manager")

    try:
        balance = await tuya.read_balance_kwh(meter.device_id)
    except Exception:
        raise HTTPException(status_code=502, detail="Could not reach the meter")
    if balance is None:
        raise HTTPException(status_code=400, detail="This meter has no prepaid mode of its own")
    if body.enabled and balance <= 0 and not body.confirm:
        raise HTTPException(status_code=409,
                            detail="This meter has no credit, so turning prepaid mode on will cut its power immediately. "
                                   "Top it up first, or send confirm=true to go ahead.")
    try:
        ok = await tuya.set_prepayment(meter.device_id, body.enabled)
    except Exception:
        ok = False
    if not ok:
        raise HTTPException(status_code=502, detail="The meter did not accept the change")
    meter.prepaid_mode = body.enabled
    meter.updated_at = utcnow()
    await save(db, meter)
    return {"success": True, "data": _meter_dict(meter)}


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
    await require_estate_access(db, user, meter.estate)

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
    await require_estate_access(db, user, meter.estate)

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
    await require_estate_access(db, user, meter.estate)

    meter.baseline_kwh = meter.last_kwh
    meter.baseline_date = utcnow()
    meter.credit_balance = 0.0
    await save(db, meter)
    return {"success": True, "message": "Baseline reset — ready for new tenant",
            "data": {"baseline_kwh": meter.baseline_kwh, "baseline_date": meter.baseline_date}}
