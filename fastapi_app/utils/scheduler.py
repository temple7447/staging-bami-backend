"""
Background scheduler — APScheduler jobs using SQLAlchemy (PostgreSQL/Neon).

Jobs:
  - Daily 08:00 & 20:00: rent reminders
  - Daily 08:00:          rent increase check
  - Monthly 1st 09:00:   monthly report
  - Daily 02:00:          DB backup (JSON snapshot)
  - Every 30 min:         Tuya meter sync
  - Monthly 1st 03:00:   electricity bill generation
"""
import os
import asyncio
import logging
from datetime import datetime
from utils.time_utils import utcnow

logger = logging.getLogger(__name__)

_scheduler = None
_loop = None  # main event loop, captured at startup
_lock_fd = None  # singleton lock file handle, held for process lifetime


async def _check_rent_reminders():
    try:
        from core.database import AsyncSessionLocal
        from models.tenant import Tenant
        from core.db_helpers import find_all
        from utils.email_service import send_rent_reminder

        now = utcnow()
        async with AsyncSessionLocal() as db:
            tenants = await find_all(db, Tenant, Tenant.is_active == True, Tenant.status == "occupied")

            sent = 0
            for t in tenants:
                if not t.next_due_date:
                    continue
                days = (t.next_due_date - now).days
                if not (days in (7, 3, 1) or days < 0):
                    continue

                due = str(t.next_due_date.date())

                if t.tenant_email:
                    await send_rent_reminder(
                        recipient_email=t.tenant_email,
                        name=t.tenant_name or "",
                        amount=t.rent_amount or 0,
                        due_date=due,
                    )
                    sent += 1

        logger.info("[SCHEDULER] Rent reminders — email: %d", sent)
    except Exception as e:
        logger.error("[SCHEDULER] Rent reminder check failed: %s", e)


async def _check_rent_increases():
    try:
        from core.database import AsyncSessionLocal
        from models.tenant import Tenant
        from models.estate import Estate
        from core.db_helpers import find_all, save
        from utils.rent_calculator import get_current_rent, estate_rent_config, resolve_increase_start

        now = utcnow()
        async with AsyncSessionLocal() as db:
            tenants = await find_all(db, Tenant, Tenant.is_active == True, Tenant.status == "occupied")
            estate_cfg: dict = {}
            updated = 0
            for t in tenants:
                if not t.entry_date or not t.base_rent:
                    continue
                if t.estate not in estate_cfg:
                    estate_cfg[t.estate] = estate_rent_config(await db.get(Estate, t.estate) if t.estate else None)
                _rate, _cycle, _start = estate_cfg[t.estate]
                _start = resolve_increase_start(t, _start)   # tenant override wins over estate
                new_rent = get_current_rent(t.base_rent, t.entry_date, False, _rate, _cycle, _start)
                svc_base = t.base_service_charge or 0
                new_svc  = get_current_rent(svc_base, t.entry_date, False, _rate, _cycle, _start) if svc_base else (t.service_charge_amount or 0)
                if new_rent != t.rent_amount or new_svc != t.service_charge_amount:
                    t.rent_amount = new_rent
                    t.service_charge_amount = new_svc
                    t.updated_at = now
                    await save(db, t)
                    updated += 1
            logger.info("[SCHEDULER] Rent increases applied (estate policy): %d", updated)
    except Exception as e:
        logger.error("[SCHEDULER] Rent increase check failed: %s", e)


async def _send_monthly_report():
    try:
        import calendar
        from core.database import AsyncSessionLocal
        from models.tenant import Tenant
        from models.transaction import Transaction
        from core.db_helpers import find_all, count
        from utils.email_service import send_email

        now = utcnow()
        month_name = calendar.month_name[now.month]
        year = now.year
        month_start = datetime(year, now.month, 1)

        async with AsyncSessionLocal() as db:
            total_tenants = await count(db, Tenant, Tenant.is_active == True)
            rent_payments = await count(
                db, Transaction,
                Transaction.type == "rent",
                Transaction.status == "completed",
                Transaction.created_at >= month_start,
            )

        admin_email = os.getenv("ADMIN_REPORT_EMAIL", os.getenv("MAILTRAP_SENDER_EMAIL", ""))
        if admin_email:
            await send_email(
                email=admin_email,
                subject=f"BamiHost Monthly Report — {month_name} {year}",
                html=f"""
                <h2>Monthly Report — {month_name} {year}</h2>
                <ul>
                  <li>Total active tenants: {total_tenants}</li>
                  <li>Rent payments this month: {rent_payments}</li>
                </ul>""",
            )
        logger.info("[SCHEDULER] Monthly report sent for %s %d", month_name, year)
    except Exception as e:
        logger.error("[SCHEDULER] Monthly report failed: %s", e)


async def _backup_database():
    try:
        import json
        from pathlib import Path
        from core.database import AsyncSessionLocal, engine
        from sqlalchemy import inspect, text

        ts = utcnow().strftime("%Y-%m-%dT%H-%M-%S")
        backup_dir = Path(__file__).parent.parent.parent / "backups" / f"backup_{ts}"
        backup_dir.mkdir(parents=True, exist_ok=True)

        async with AsyncSessionLocal() as db:
            # Get all table names
            def get_tables(conn):
                return inspect(conn).get_table_names()

            async with engine.connect() as conn:
                tables = await conn.run_sync(get_tables)

            master = {"timestamp": ts, "tables": {}}
            for table in tables:
                result = await db.execute(text(f"SELECT * FROM {table}"))
                rows = [dict(row._mapping) for row in result]
                (backup_dir / f"{table}.json").write_text(json.dumps(rows, default=str, indent=2))
                master["tables"][table] = len(rows)

        (backup_dir / "summary.json").write_text(json.dumps(master, indent=2))
        logger.info("[SCHEDULER] Backup completed: %s (%d tables)", backup_dir, len(master["tables"]))
    except Exception as e:
        logger.error("[SCHEDULER] Backup failed: %s", e)


async def _sync_meters():
    """Every 30 min: pull live readings from all active Tuya meters."""
    try:
        from core.database import AsyncSessionLocal
        from models.meter_device import MeterDevice
        from models.meter_reading import MeterReading
        from models.notification import Notification
        from core.db_helpers import find_all, save
        from models.base import gen_uuid
        from core.config import settings
        import utils.tuya as tuya

        if not settings.TUYA_CLIENT_ID:
            return

        async with AsyncSessionLocal() as db:
            meters = await find_all(db, MeterDevice, MeterDevice.is_active == True)
            synced = 0
            for meter in meters:
                try:
                    raw = await tuya.get_device_status(meter.device_id)
                    parsed = tuya.parse_status(raw)
                    now = utcnow()

                    meter.last_kwh = parsed["kwh"]
                    meter.last_voltage = parsed["voltage"]
                    meter.last_current = parsed["current"]
                    meter.last_power = parsed["power"]
                    meter.last_power_factor = parsed["power_factor"]
                    meter.is_online = True
                    meter.last_synced_at = now
                    meter.raw_status = parsed.get("raw", {})
                    await save(db, meter)

                    reading = MeterReading(
                        id=gen_uuid(), meter_device=meter.id,
                        unit=meter.unit, estate=meter.estate, tenant=meter.tenant,
                        kwh=parsed["kwh"], voltage=parsed["voltage"],
                        current=parsed["current"], power=parsed["power"],
                        power_factor=parsed["power_factor"],
                        credit_balance=meter.credit_balance,
                        rate_per_kwh=meter.rate_per_kwh,
                        period_month=now.month, period_year=now.year, recorded_at=now,
                    )
                    await save(db, reading)

                    if (meter.prepaid_mode and meter.tenant
                            and 0 < meter.credit_balance <= meter.low_balance_threshold):
                        await save(db, Notification(
                            id=gen_uuid(), user=meter.tenant,
                            title="Low Electricity Balance",
                            message=f"Your electricity balance is ₦{meter.credit_balance:,.0f}. Top up to avoid disconnection.",
                            type="meter_low_balance",
                        ))

                    if meter.prepaid_mode and meter.credit_balance <= 0 and meter.is_connected:
                        try:
                            await tuya.set_switch(meter.device_id, False)
                            meter.is_connected = False
                            await save(db, meter)
                            if meter.tenant:
                                await save(db, Notification(
                                    id=gen_uuid(), user=meter.tenant,
                                    title="Power Disconnected — Zero Balance",
                                    message="Your electricity has been disconnected. Top up to restore power.",
                                    type="meter_disconnect",
                                ))
                        except Exception:
                            pass

                    synced += 1
                except Exception as e:
                    logger.warning("[METERS] Sync failed for %s: %s", meter.device_id, e)
                    meter.is_online = False
                    await save(db, meter)

            logger.info("[METERS] Sync complete — %d/%d meters updated", synced, len(meters))
    except Exception as e:
        logger.error("[METERS] Sync job failed: %s", e)


async def _generate_monthly_electricity_bills():
    """Monthly 1st: generate electricity bill transactions for all meters."""
    try:
        import time as _time
        from core.database import AsyncSessionLocal
        from models.meter_device import MeterDevice
        from models.transaction import Transaction
        from models.notification import Notification
        from core.db_helpers import find_all, save
        from models.base import gen_uuid

        async with AsyncSessionLocal() as db:
            meters = await find_all(db, MeterDevice, MeterDevice.is_active == True)
            now = utcnow()
            billed = 0
            for meter in meters:
                if not meter.tenant:
                    continue
                kwh_used = max(0.0, meter.last_kwh - meter.baseline_kwh)
                if kwh_used <= 0:
                    continue
                amount = round(kwh_used * meter.rate_per_kwh, 2)

                await save(db, Transaction(
                    id=gen_uuid(), user=meter.tenant, amount=amount,
                    type="electricity_bill", status="pending", method="wallet",
                    reference=f"BILL-ELEC-{int(_time.time()*1000)}",
                    description=f"Electricity bill — {now.strftime('%B %Y')} ({kwh_used:.2f} kWh × ₦{meter.rate_per_kwh}/kWh)",
                    estate=meter.estate, created_by="system",
                ))

                meter.baseline_kwh = meter.last_kwh
                meter.baseline_date = now
                await save(db, meter)

                await save(db, Notification(
                    id=gen_uuid(), user=meter.tenant,
                    title=f"Electricity Bill — {now.strftime('%B %Y')}",
                    message=f"Your bill for {now.strftime('%B %Y')} is ₦{amount:,.2f} ({kwh_used:.2f} kWh).",
                    type="electricity_bill",
                ))
                billed += 1

            logger.info("[METERS] Monthly bills generated for %d meters", billed)
    except Exception as e:
        logger.error("[METERS] Monthly bill job failed: %s", e)


async def _daily_autopilot_scan():
    """7am daily: AI scans every business owner and queues actions for the day."""
    try:
        from core.database import AsyncSessionLocal
        from sqlalchemy import select
        from models.user import User
        from api.v1.endpoints.autopilot import generate_actions, _serialize
        from models.autopilot_action import AutopilotAction

        BUSINESS_ROLES = {"business_owner", "manager", "super_manager", "super_admin"}
        async with AsyncSessionLocal() as db:
            owners = (await db.execute(
                select(User).where(User.role.in_(BUSINESS_ROLES), User.is_active == True)
            )).scalars().all()

            total = 0
            for owner in owners:
                try:
                    # Clear old pending actions
                    old = (await db.execute(
                        select(AutopilotAction).where(
                            AutopilotAction.owner_id == str(owner.id),
                            AutopilotAction.status.in_(["pending"]),
                        )
                    )).scalars().all()
                    for a in old:
                        await db.delete(a)

                    actions = await generate_actions(db, owner)
                    for a in actions:
                        db.add(a)
                    total += len(actions)
                except Exception as e:
                    logger.warning("[AUTOPILOT] Scan failed for %s: %s", owner.email, e)

            await db.commit()
            logger.info("[AUTOPILOT] Daily scan complete — %d actions queued across %d owners", total, len(owners))

            # Auto-execute actions matching each owner's rules
            try:
                from models.autopilot_settings import AutopilotSettings
                auto_executed = 0
                for owner in owners:
                    settings_row = (await db.execute(
                        select(AutopilotSettings).where(
                            AutopilotSettings.owner_id == str(owner.id),
                            AutopilotSettings.enabled == True,
                            AutopilotSettings.daily_scan_enabled == True,
                        )
                    )).scalars().first()
                    if not settings_row or not settings_row.auto_execute_types:
                        continue
                    auto_types = set(settings_row.auto_execute_types)
                    pending = (await db.execute(
                        select(AutopilotAction).where(
                            AutopilotAction.owner_id == str(owner.id),
                            AutopilotAction.status == "pending",
                            AutopilotAction.action_type.in_(auto_types),
                        )
                    )).scalars().all()
                    for action in pending:
                        try:
                            action.status = "done"
                            action.executed_at = utcnow()
                            action.execution_result = {"auto_executed": True, "source": "daily_scan"}
                            auto_executed += 1
                        except Exception as ex:
                            logger.warning("[AUTO_EXEC] Action %s failed: %s", action.id, ex)
                await db.commit()
                logger.info("[AUTO_EXEC] %d actions auto-executed after daily scan", auto_executed)
            except Exception as e:
                logger.error("[AUTO_EXEC] Post-scan auto-execute failed: %s", e)
    except Exception as e:
        logger.error("[AUTOPILOT] Daily scan job failed: %s", e)


async def _check_lease_renewals():
    """7:30am daily: detect leases expiring in 60/30/14 days and queue renewal actions."""
    try:
        from datetime import timedelta
        from core.database import AsyncSessionLocal
        from sqlalchemy import select, and_
        from models.tenant import Tenant
        from models.estate import Estate
        from models.unit import Unit
        from utils.event_hooks import fire_event

        THRESHOLDS = [60, 30, 14]
        now = utcnow()

        async with AsyncSessionLocal() as db:
            for days in THRESHOLDS:
                target = now + timedelta(days=days)
                window_start = target.replace(hour=0, minute=0, second=0)
                window_end   = target.replace(hour=23, minute=59, second=59)

                rows = (await db.execute(
                    select(Tenant, Unit, Estate)
                    .join(Unit, Tenant.unit == Unit.id)
                    .join(Estate, Tenant.estate == Estate.id)
                    .where(
                        Tenant.is_active == True,
                        Tenant.lease_end_date >= window_start,
                        Tenant.lease_end_date <= window_end,
                    )
                )).all()

                for tenant, unit, estate in rows:
                    await fire_event("lease_expiring", str(estate.owner_id or ""), {
                        "tenant_name": tenant.tenant_name,
                        "unit_label": unit.label,
                        "estate_name": estate.name,
                        "days_remaining": days,
                        "phone": tenant.tenant_phone or "",
                        "email": tenant.tenant_email or "",
                    }, db)
                    logger.info("[LEASES] Renewal queued: %s (%d days)", tenant.tenant_name, days)
    except Exception as e:
        logger.error("[LEASES] Renewal check failed: %s", e)


async def _run_auto_payments():
    """Tenant-opt-in auto-pay: on/after the due date, pay rent + service charge
    (and any arrears / unpaid first-time fees) from the wallet when the balance
    covers the full amount. Runs before the 08:00 reminders so reminders
    reflect the post-auto-pay state."""
    try:
        from core.database import AsyncSessionLocal
        from models.tenant import Tenant
        from models.wallet import Wallet
        from core.db_helpers import find_all, find_one
        from utils.email_service import send_payment_confirmation

        now = utcnow()
        paid = skipped = 0
        async with AsyncSessionLocal() as db:
            tenants = await find_all(db, Tenant, Tenant.is_active == True,
                                     Tenant.status == "occupied",
                                     Tenant.auto_pay_enabled == True)
            for t in tenants:
                if not t.next_due_date or t.next_due_date > now or not t.user:
                    continue
                wallet = await find_one(db, Wallet, Wallet.user_id == t.user)
                if not wallet:
                    continue
                try:
                    from api.v1.endpoints.tenants import execute_billing_payment
                    # Pass every possible code — the executor keeps only what
                    # actually applies (and enforces the new-tenant full bundle).
                    result = await execute_billing_payment(
                        db, t, wallet,
                        ["rent", "service_charge", "outstanding_rent",
                         "outstanding_service_charge", "caution_fee", "legal_fee"],
                        12, t.user, source="auto_pay")
                    paid += 1
                    if t.tenant_email:
                        await send_payment_confirmation(
                            to_email=t.tenant_email, tenant_name=t.tenant_name or "Tenant",
                            amount=result["total_paid"], reference=result["reference"],
                            payment_type="auto_pay")
                except Exception as pe:
                    # Most commonly: insufficient balance. Leave it for reminders.
                    skipped += 1
                    logger.info("[SCHEDULER] Auto-pay skipped for %s: %s", t.id, pe)
        logger.info("[SCHEDULER] Auto-pay — paid: %d, skipped: %d", paid, skipped)
    except Exception as e:
        logger.error("[SCHEDULER] Auto-pay run failed: %s", e)


def _wrap(coro_fn):
    def job():
        # APScheduler runs jobs in a worker thread that has no event loop.
        # Dispatch the coroutine onto the main loop captured at startup.
        if _loop is None or _loop.is_closed():
            logger.error("[SCHEDULER] No event loop available for job %s", getattr(coro_fn, "__name__", coro_fn))
            return
        asyncio.run_coroutine_threadsafe(coro_fn(), _loop)
    return job


def _acquire_singleton_lock() -> bool:
    """Hold an exclusive OS file lock for the process lifetime so that only
    one process per host runs the jobs — with multiple uvicorn workers,
    every worker calls start_scheduler() and tenants would get duplicate
    reminder emails, double rent updates, and duplicate bills."""
    global _lock_fd
    import fcntl, tempfile
    lock_path = os.path.join(tempfile.gettempdir(), "bamihost_scheduler.lock")
    try:
        _lock_fd = open(lock_path, "w")
        fcntl.flock(_lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        _lock_fd.write(str(os.getpid()))
        _lock_fd.flush()
        return True
    except OSError:
        return False


def start_scheduler():
    global _scheduler, _loop
    try:
        from apscheduler.schedulers.background import BackgroundScheduler

        if not _acquire_singleton_lock():
            logger.info("[SCHEDULER] Another process holds the scheduler lock — not starting jobs in this worker")
            return

        # Capture the running event loop so worker threads can dispatch onto it.
        try:
            _loop = asyncio.get_running_loop()
        except RuntimeError:
            _loop = asyncio.get_event_loop()

        _scheduler = BackgroundScheduler()
        _scheduler.add_job(_wrap(_check_rent_reminders), "cron", hour=8,  minute=0, id="reminders_am")
        _scheduler.add_job(_wrap(_check_rent_increases), "cron", hour=8,  minute=0, id="rent_increase")
        _scheduler.add_job(_wrap(_check_rent_reminders), "cron", hour=20, minute=0, id="reminders_pm")
        _scheduler.add_job(_wrap(_send_monthly_report),  "cron", day=1, hour=9, minute=0, id="monthly_report")
        _scheduler.add_job(_wrap(_backup_database),      "cron", hour=2, minute=0, id="db_backup")
        _scheduler.add_job(_wrap(_sync_meters),          "interval", minutes=30, id="meter_sync")
        _scheduler.add_job(_wrap(_generate_monthly_electricity_bills), "cron",
                           day=1, hour=3, minute=0, id="electricity_bills")
        _scheduler.add_job(_wrap(_daily_autopilot_scan), "cron",
                           hour=7, minute=0, id="autopilot_daily")
        _scheduler.add_job(_wrap(_check_lease_renewals), "cron",
                           hour=7, minute=30, id="lease_renewals")
        _scheduler.add_job(_wrap(_run_auto_payments), "cron",
                           hour=7, minute=45, id="auto_pay")
        _scheduler.start()
        logger.info("[SCHEDULER] Started — reminders@08:00&20:00, report@1st/09:00, backup@02:00, meters@30min, autopilot@07:00, leases@07:30")
    except Exception as e:
        logger.error("[SCHEDULER] Failed to start: %s", e)


def stop_scheduler():
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("[SCHEDULER] Stopped")


def get_status() -> dict:
    if not _scheduler:
        return {"running": False, "jobs": []}
    return {
        "running": _scheduler.running,
        "jobs": [{"id": j.id, "next_run": str(j.next_run_time)} for j in _scheduler.get_jobs()],
    }
