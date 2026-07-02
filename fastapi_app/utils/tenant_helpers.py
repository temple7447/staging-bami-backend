"""
Shared tenant projection logic — Python port of the nextDueDate projection
and processTenant helpers used across tenantController.js and dashboardController.js.
"""
from datetime import datetime, timezone, timedelta
from math import floor
from utils.rent_calculator import get_current_rent, estate_rent_config


async def estate_config_for(db, estate_id):
    """Return (rate, cycle_years, increase_start) for an estate id — the per-estate
    rent-increase policy. db.get is identity-map cached, so repeated calls are cheap."""
    from models.estate import Estate
    est = await db.get(Estate, estate_id) if estate_id else None
    return estate_rent_config(est)


def project_next_due_date(tenant) -> datetime | None:
    """
    Port of the legacy-default nextDueDate projection used in getTenants and
    getTenantOverview.  Rules (in order):
      1. No nextDueDate and no entryDate → None
      2. No nextDueDate but has entryDate → entry + 1 year
      3. nextDueDate before entryDate (data error) → treat as case 2
      4. nextDueDate == entryDate day+month (legacy onboarding default) AND
         no outstanding balance → advance to next future anniversary
      5. Past but not legacy-default → genuine overdue, keep as-is
    """
    now = datetime.utcnow()
    entry = tenant.entry_date if hasattr(tenant, "entry_date") else None
    stored = tenant.next_due_date if hasattr(tenant, "next_due_date") else None

    projected = stored

    # Case 1 & 2: derive from entry if missing or before entry
    if (not projected or (entry and projected < entry)) and entry:
        projected = datetime(
            entry.year + 1, entry.month, entry.day,
            tzinfo=entry.tzinfo
        )

    if not projected:
        return None

    # Case 4: legacy-default check
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if projected < today and entry:
        outstanding = (getattr(tenant, "rent_outstanding", 0) or 0) + \
                      (getattr(tenant, "service_charge_outstanding", 0) or 0)
        is_legacy = (
            projected.month == entry.month and
            projected.day   == entry.day
        )
        if is_legacy and outstanding == 0:
            anchor = datetime(entry.year, entry.month, entry.day)
            while anchor <= today:
                anchor = anchor.replace(year=anchor.year + 1)
            projected = anchor

    return projected


def process_tenant(tenant, paid_fees: dict | None = None, estate_config=None) -> dict:
    """
    Annotate a tenant dict/object with computed fields:
    current rent, days until due, status colour, etc.
    Mirrors processTenant() in tenantController.js.
    """
    if paid_fees is None:
        paid_fees = {"caution": set(), "legal": set()}

    tid = str(getattr(tenant, "id", getattr(tenant, "_id", "")))
    origin = getattr(tenant, "entry_date", None) or getattr(tenant, "created_at", datetime.utcnow())

    _rate, _cycle, _start = estate_config or (None, None, None)
    # Escalate from base_* so a stored, already-escalated amount is never
    # escalated a second time (rent_amount is scheduler-maintained).
    rent_base = getattr(tenant, "base_rent", None) or getattr(tenant, "rent_amount", 0)
    svc_base  = getattr(tenant, "base_service_charge", None) or getattr(tenant, "service_charge_amount", 0)
    current_rent    = get_current_rent(rent_base, origin, False, _rate, _cycle, _start)
    current_service = get_current_rent(svc_base, origin, False, _rate, _cycle, _start)
    total_monthly   = current_rent + current_service
    total_outstanding = (getattr(tenant, "rent_outstanding", 0) or 0) + \
                        (getattr(tenant, "service_charge_outstanding", 0) or 0)

    projected_due = project_next_due_date(tenant)
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    days_until_due = int((projected_due - today).days) if projected_due else None
    arrears_months = floor(abs(days_until_due) / 30) if days_until_due is not None and days_until_due < 0 else 0

    status = getattr(tenant, "status", "occupied")
    if status == "evicted":
        color = "#9c27b0"
    elif status == "pending":
        color = "#2196f3"
    elif days_until_due is not None and days_until_due < 0:
        color = "#ff0000"
    elif total_outstanding > 0:
        color = "#ff9800"
    elif days_until_due is not None and days_until_due <= 7:
        color = "#ff9800"
    else:
        color = "#4caf50"

    return {
        "current_effective_rent":    current_rent,
        "is_rent_increased":         current_rent > getattr(tenant, "rent_amount", 0),
        "current_effective_service": current_service,
        "total_monthly_fees":        total_monthly,
        "total_outstanding":         total_outstanding,
        "has_outstanding":           total_outstanding > 0,
        "arrears_months":            arrears_months,
        "days_until_due":            days_until_due,
        "next_due_date":             projected_due,
        "status_color":              color,
    }


def parse_flexible_date(value) -> datetime | None:
    """Accept ISO string, timestamp, or dd/mm/yyyy — mirrors parseFlexibleDate in JS."""
    if not value:
        return None
    import re
    if isinstance(value, str):
        m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})$", value)
        if m:
            d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if y < 100:
                y += 2000
            return datetime(y, mo, d)
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            pass
    if isinstance(value, datetime):
        return value
    return None


def generate_temp_password(length: int = 6) -> str:
    import random, string
    letters = string.ascii_letters
    digits  = string.digits
    pwd = [random.choice(letters), random.choice(digits)]
    pwd += [random.choice(letters + digits) for _ in range(length - 2)]
    random.shuffle(pwd)
    return "".join(pwd)
