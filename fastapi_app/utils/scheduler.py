"""
Background scheduler — APScheduler port of the Node.js scheduler.js.

Jobs:
  - Daily 08:00:  reminders + rent increase check
  - Daily 20:00:  overdue reminders (second run)
  - Monthly 1st 09:00: monthly report
  - Monthly 1st 10:00: vendor/manager payout
  - Daily 02:00:  DB backup

Call start_scheduler() from app lifespan; stop_scheduler() on shutdown.
"""
import os
import asyncio
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

_scheduler = None


async def _check_rent_reminders():
    try:
        from models.tenant import Tenant
        from utils.email_service import send_rent_reminder
        from utils.tenant_helpers import process_tenant

        tenants = await Tenant.find({"status": "active", "is_active": True}).to_list()
        sent = 0
        for t in tenants:
            info = process_tenant(t)
            days = info.get("days_until_due", 999)
            if days in (7, 3, 1) or days < 0:
                if t.email:
                    await send_rent_reminder(
                        recipient_email = t.email,
                        name            = f"{t.first_name} {t.last_name}".strip(),
                        amount          = info.get("current_effective_rent", 0),
                        due_date        = str(info.get("next_due_date", "")),
                    )
                    sent += 1
        logger.info("[SCHEDULER] Rent reminders sent: %d", sent)
    except Exception as e:
        logger.error("[SCHEDULER] Rent reminder check failed: %s", e)


async def _check_rent_increases():
    try:
        from models.tenant import Tenant
        from utils.rent_calculator import calculate_effective_rent
        from bson import ObjectId
        from datetime import datetime

        now = datetime.utcnow()
        tenants = await Tenant.find({"status": "active", "is_active": True}).to_list()
        updated = 0
        for t in tenants:
            if not t.entry_date:
                continue
            result = calculate_effective_rent(t.rent_amount or 0, t.entry_date, now)
            new_rent = result.get("effective_rent", t.rent_amount)
            if new_rent and t.rent_amount and new_rent != t.rent_amount:
                t.rent_amount = new_rent
                t.updated_at  = now
                await t.save()
                updated += 1
        logger.info("[SCHEDULER] Rent increases applied: %d", updated)
    except Exception as e:
        logger.error("[SCHEDULER] Rent increase check failed: %s", e)


async def _send_monthly_report():
    try:
        from models.tenant import Tenant
        from models.transaction import Transaction
        from utils.email_service import send_email
        import calendar

        now        = datetime.utcnow()
        month_name = calendar.month_name[now.month]
        year       = now.year

        tenants = await Tenant.find({"is_active": True}).to_list()
        coll    = Transaction.get_motor_collection()
        month_start = datetime(year, now.month, 1)
        payments    = await coll.count_documents({
            "created_at": {"$gte": month_start}, "type": "rent", "status": "completed"
        })

        admin_email = os.getenv("ADMIN_REPORT_EMAIL", os.getenv("MAILTRAP_SENDER_EMAIL", ""))
        if admin_email:
            await send_email(
                email   = admin_email,
                subject = f"BamiHustle Monthly Report — {month_name} {year}",
                html    = f"""
                <h2>Monthly Report — {month_name} {year}</h2>
                <ul>
                  <li>Total active tenants: {len(tenants)}</li>
                  <li>Rent payments this month: {payments}</li>
                </ul>""",
            )
        logger.info("[SCHEDULER] Monthly report sent for %s %d", month_name, year)
    except Exception as e:
        logger.error("[SCHEDULER] Monthly report failed: %s", e)


async def _backup_database():
    try:
        import json
        from pathlib import Path
        from core.database import get_db

        ts        = datetime.utcnow().strftime("%Y-%m-%dT%H-%M-%S")
        backup_dir = Path(__file__).parent.parent.parent / "backups" / f"backup_{ts}"
        backup_dir.mkdir(parents=True, exist_ok=True)

        db          = get_db()
        collections = await db.list_collection_names()
        master      = {"timestamp": ts, "collections": {}}

        for col_name in collections:
            docs = await db[col_name].find({}).to_list(None)
            # Convert ObjectId to str for JSON serialisability
            for d in docs:
                d["_id"] = str(d["_id"])
            (backup_dir / f"{col_name}.json").write_text(json.dumps(docs, default=str, indent=2))
            master["collections"][col_name] = len(docs)

        (backup_dir / "summary.json").write_text(json.dumps(master, indent=2))
        logger.info("[SCHEDULER] Backup completed: %s (%d collections)", backup_dir, len(collections))
    except Exception as e:
        logger.error("[SCHEDULER] Backup failed: %s", e)


async def _sync_meters():
    """Every 30 min: pull live readings from all active Tuya meters, store snapshot, check low balance."""
    try:
        from core.database import async_session
        from models.meter_device import MeterDevice
        from models.meter_reading import MeterReading
        from models.notification import Notification
        from core.db_helpers import find_all, save
        from models.base import gen_uuid
        import utils.tuya as tuya
        from core.config import settings

        if not settings.TUYA_CLIENT_ID:
            return  # Tuya not configured — skip silently

        async with async_session() as db:
            meters = await find_all(db, MeterDevice, MeterDevice.is_active == True)
            synced = 0
            for meter in meters:
                try:
                    raw = await tuya.get_device_status(meter.device_id)
                    parsed = tuya.parse_status(raw)
                    now = datetime.utcnow()

                    meter.last_kwh = parsed["kwh"]
                    meter.last_voltage = parsed["voltage"]
                    meter.last_current = parsed["current"]
                    meter.last_power = parsed["power"]
                    meter.last_power_factor = parsed["power_factor"]
                    meter.is_online = True
                    meter.last_synced_at = now
                    meter.raw_status = parsed.get("raw", {})
                    await save(db, meter)

                    # Store reading snapshot
                    reading = MeterReading(
                        id=gen_uuid(),
                        meter_device=meter.id,
                        unit=meter.unit,
                        estate=meter.estate,
                        tenant=meter.tenant,
                        kwh=parsed["kwh"],
                        voltage=parsed["voltage"],
                        current=parsed["current"],
                        power=parsed["power"],
                        power_factor=parsed["power_factor"],
                        credit_balance=meter.credit_balance,
                        rate_per_kwh=meter.rate_per_kwh,
                        period_month=now.month,
                        period_year=now.year,
                        recorded_at=now,
                    )
                    await save(db, reading)

                    # Low balance alert (once per threshold cross)
                    if (meter.prepaid_mode and meter.tenant
                            and meter.credit_balance <= meter.low_balance_threshold
                            and meter.credit_balance > 0):
                        notif = Notification(
                            id=gen_uuid(), user=meter.tenant,
                            title="Low Electricity Balance",
                            message=(
                                f"Your electricity balance is low: ₦{meter.credit_balance:,.0f} remaining. "
                                "Top up now to avoid disconnection."
                            ),
                            type="meter_low_balance",
                        )
                        await save(db, notif)

                    # Auto-disconnect at zero balance
                    if meter.prepaid_mode and meter.credit_balance <= 0 and meter.is_connected:
                        try:
                            await tuya.set_switch(meter.device_id, False)
                            meter.is_connected = False
                            await save(db, meter)
                            if meter.tenant:
                                notif = Notification(
                                    id=gen_uuid(), user=meter.tenant,
                                    title="Power Disconnected — Zero Balance",
                                    message="Your electricity has been disconnected. Top up your meter to restore power.",
                                    type="meter_disconnect",
                                )
                                await save(db, notif)
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
        from core.database import async_session
        from models.meter_device import MeterDevice
        from models.transaction import Transaction
        from models.notification import Notification
        from core.db_helpers import find_all, save
        from models.base import gen_uuid
        import time as _time

        async with async_session() as db:
            meters = await find_all(db, MeterDevice, MeterDevice.is_active == True)
            now = datetime.utcnow()
            billed = 0
            for meter in meters:
                if not meter.tenant:
                    continue
                kwh_used = max(0.0, meter.last_kwh - meter.baseline_kwh)
                if kwh_used <= 0:
                    continue
                amount = round(kwh_used * meter.rate_per_kwh, 2)

                tx = Transaction(
                    id=gen_uuid(), user=meter.tenant,
                    amount=amount, type="electricity_bill", status="pending",
                    method="wallet",
                    reference=f"BILL-ELEC-{int(_time.time()*1000)}",
                    description=(
                        f"Electricity bill — {now.strftime('%B %Y')} "
                        f"({kwh_used:.2f} kWh × ₦{meter.rate_per_kwh}/kWh)"
                    ),
                    estate=meter.estate, created_by="system",
                    period_month=now.month, period_year=now.year,
                )
                await save(db, tx)

                # Reset baseline for next month
                meter.baseline_kwh = meter.last_kwh
                meter.baseline_date = now
                await save(db, meter)

                notif = Notification(
                    id=gen_uuid(), user=meter.tenant,
                    title=f"Electricity Bill — {now.strftime('%B %Y')}",
                    message=f"Your electricity bill for {now.strftime('%B %Y')} is ₦{amount:,.2f} ({kwh_used:.2f} kWh). It will be deducted from your wallet.",
                    type="electricity_bill",
                )
                await save(db, notif)
                billed += 1

            logger.info("[METERS] Monthly bills generated for %d meters", billed)
    except Exception as e:
        logger.error("[METERS] Monthly bill job failed: %s", e)


def _wrap(coro_fn):
    def job():
        asyncio.get_event_loop().create_task(coro_fn())
    return job


def start_scheduler():
    global _scheduler
    try:
        from apscheduler.schedulers.background import BackgroundScheduler

        _scheduler = BackgroundScheduler()

        # Daily 08:00 — reminders + rent increases
        _scheduler.add_job(_wrap(_check_rent_reminders),  "cron", hour=8,  minute=0, id="reminders_am")
        _scheduler.add_job(_wrap(_check_rent_increases),  "cron", hour=8,  minute=0, id="rent_increase")

        # Daily 20:00 — overdue reminders second run
        _scheduler.add_job(_wrap(_check_rent_reminders),  "cron", hour=20, minute=0, id="reminders_pm")

        # Monthly 1st 09:00 — monthly report
        _scheduler.add_job(_wrap(_send_monthly_report),   "cron", day=1, hour=9,  minute=0, id="monthly_report")

        # Daily 02:00 — backup
        _scheduler.add_job(_wrap(_backup_database),       "cron", hour=2,  minute=0, id="db_backup")

        # Every 30 min — sync Tuya meter readings
        _scheduler.add_job(_wrap(_sync_meters), "interval", minutes=30, id="meter_sync")

        # Monthly 1st 03:00 — generate electricity bills
        _scheduler.add_job(_wrap(_generate_monthly_electricity_bills), "cron",
                           day=1, hour=3, minute=0, id="electricity_bills")

        _scheduler.start()
        logger.info("[SCHEDULER] Started — reminders@08:00&20:00, report@1st/09:00, backup@02:00, meters@30min")
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
    jobs = [
        {"id": j.id, "next_run": str(j.next_run_time)}
        for j in _scheduler.get_jobs()
    ]
    return {"running": _scheduler.running, "jobs": jobs}
