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

        _scheduler.start()
        logger.info("[SCHEDULER] Started — reminders@08:00&20:00, report@1st/09:00, backup@02:00")
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
