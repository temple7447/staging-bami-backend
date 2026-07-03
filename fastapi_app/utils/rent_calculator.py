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


def resolve_increase_start(tenant, estate_start):
    """Anchor for a tenant's rent increases, most specific first:
    the tenant's own override, else the estate default. When both are None the
    calculators fall back to the tenant's entry date. Rate/cycle stay estate-wide."""
    return getattr(tenant, "rent_increase_start", None) or estate_start


def _resolve(rate, cycle_years, is_vacant):
    # No configured policy => NO increase. Escalation is opt-in per estate, so
    # a missing/None policy must never silently apply the old +26%/2yr default.
    cy = 0 if cycle_years is None else cycle_years
    r = 1.0 if rate is None else rate
    return r, cy


def _to_dt(v):
    return v if isinstance(v, datetime) else datetime.fromisoformat(str(v))


def _cycles_at(at: datetime, anchor: datetime, cycle_years: int) -> int:
    """Completed escalation cycles as of `at`, counting from `anchor`."""
    if at < anchor:
        return 0
    years_diff = (
        (at.year - anchor.year)
        + (at.month - anchor.month) / 12
        + (at.day - anchor.day) / 365
    )
    return floor(max(0, years_diff) / cycle_years)


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
    """Total rent for `months` months starting at `start_date`.

    The whole span is priced FLAT at the rate in effect on `start_date`:
    rent is agreed at the start of a term and held for that term, so an
    increase whose cycle boundary falls mid-term only applies from the
    next term. Returns {"total_amount", "final_rent"}."""
    r, cy = _resolve(rate, cycle_years, is_vacant)

    # No escalation configured -> flat rent for the whole span.
    if not cy or cy <= 0:
        amt = round(base_amount)
        return {"total_amount": amt * months, "final_rent": amt}

    start  = _to_dt(start_date)
    anchor = _to_dt(increase_start) if increase_start else _to_dt(origin_date)
    monthly = round(base_amount * (r ** _cycles_at(start, anchor, cy)))
    return {"total_amount": monthly * months, "final_rent": monthly}


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
    return round(base_amount * (r ** _cycles_at(now, anchor, cy)))
