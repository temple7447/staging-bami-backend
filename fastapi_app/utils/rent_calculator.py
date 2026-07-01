"""
Rent escalation logic — configurable PER ESTATE.

Defaults preserve the original behaviour: +26% every 2 years for occupied
tenants (every 1 year for vacant re-listing). Each estate can override:
  - rate         : e.g. 1.26 for +26%
  - cycle_years  : 0/None = NEVER increase, else 1, 2, 3 … years per step
  - increase_start: the date increases are counted from. When None, each
                    tenant's own entry (origin) date is the anchor.

All date arithmetic uses UTC to stay consistent with storage.
"""
from datetime import datetime, timezone
from math import floor


INCREASE_RATE = 1.26
CYCLE_YEARS_OCCUPIED = 2
CYCLE_YEARS_VACANT   = 1


def estate_rent_config(estate) -> tuple:
    """Return (rate, cycle_years, increase_start) from an Estate, or Nones for defaults."""
    if estate is None:
        return (None, None, None)
    pct = getattr(estate, "rent_increase_percent", None)
    rate = (1 + pct / 100.0) if pct is not None else None
    cycle = getattr(estate, "rent_increase_cycle_years", None)
    start = getattr(estate, "rent_increase_start", None)
    return (rate, cycle, start)


def _resolve(rate, cycle_years, is_vacant):
    r = INCREASE_RATE if rate is None else rate
    if cycle_years is None:
        cy = CYCLE_YEARS_VACANT if is_vacant else CYCLE_YEARS_OCCUPIED
    else:
        cy = cycle_years
    return r, cy


def _to_dt(v):
    return v if isinstance(v, datetime) else datetime.fromisoformat(str(v))


def calculate_effective_rent(
    base_amount: float,
    start_date:  datetime,
    months:      int,
    is_vacant:   bool,
    origin_date: datetime,
    rate=None,
    cycle_years=None,
    increase_start=None,
) -> dict:
    """Total rent for `months` months starting at `start_date`, applying the
    estate's escalation. Returns {"total_amount", "final_rent"}."""
    r, cy = _resolve(rate, cycle_years, is_vacant)

    # No escalation configured -> flat rent for the whole span.
    if not cy or cy <= 0:
        amt = round(base_amount)
        return {"total_amount": amt * months, "final_rent": amt}

    cycle_months = cy * 12
    start  = _to_dt(start_date)
    origin = _to_dt(increase_start) if increase_start else _to_dt(origin_date)

    start_y, start_m, start_d    = start.year,  start.month - 1,  start.day
    origin_y, origin_m, origin_d = origin.year, origin.month - 1, origin.day
    day_offset = (start_d - origin_d) / 30

    total_amount = 0.0
    current_rent = base_amount

    for i in range(months):
        abs_month = start_m + i
        cur_y     = start_y + abs_month // 12
        cur_m     = abs_month % 12
        months_since_origin = (cur_y - origin_y) * 12 + (cur_m - origin_m) + day_offset
        cycles = floor(max(0, round(months_since_origin)) / cycle_months)
        monthly_rent = round(base_amount * (r ** cycles))
        total_amount += monthly_rent
        current_rent  = monthly_rent

    return {"total_amount": total_amount, "final_rent": current_rent}


def get_current_rent(
    base_amount: float,
    origin_date: datetime,
    is_vacant: bool,
    rate=None,
    cycle_years=None,
    increase_start=None,
) -> float:
    """Current rent RIGHT NOW based on the estate's escalation policy."""
    r, cy = _resolve(rate, cycle_years, is_vacant)
    if not cy or cy <= 0:
        return round(base_amount)

    now    = datetime.now(timezone.utc).replace(tzinfo=None)
    anchor = _to_dt(increase_start) if increase_start else _to_dt(origin_date)
    if now < anchor:
        return round(base_amount)

    years_diff = (
        (now.year - anchor.year)
        + (now.month - anchor.month) / 12
        + (now.day - anchor.day) / 365
    )
    cycles = floor(max(0, years_diff) / cy)
    return round(base_amount * (r ** cycles))
