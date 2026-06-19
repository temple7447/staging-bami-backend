"""
Python port of utils/rentCalculator.js — identical business logic.
26% increase every 2 years for occupied, every 1 year for vacant.
All date arithmetic uses UTC to stay consistent with MongoDB storage.
"""
from datetime import datetime, timezone
from math import floor, pow as fpow


INCREASE_RATE = 1.26
CYCLE_YEARS_OCCUPIED = 2
CYCLE_YEARS_VACANT   = 1


def calculate_effective_rent(
    base_amount: float,
    start_date:  datetime,
    months:      int,
    is_vacant:   bool,
    origin_date: datetime,
) -> dict:
    """
    Total rent for `months` months starting at `start_date`.
    Origin date is the tenant's entry date — used to determine which
    increase cycle each month falls in.

    Returns: {"total_amount": float, "final_rent": float}
    """
    cycle_months = (CYCLE_YEARS_VACANT if is_vacant else CYCLE_YEARS_OCCUPIED) * 12

    start  = start_date  if isinstance(start_date,  datetime) else datetime.fromisoformat(str(start_date))
    origin = origin_date if isinstance(origin_date, datetime) else datetime.fromisoformat(str(origin_date))

    # Use UTC to match the anchor projection (getUTC* in JS)
    start_y, start_m, start_d   = start.year,  start.month - 1,  start.day   # 0-indexed month
    origin_y, origin_m, origin_d = origin.year, origin.month - 1, origin.day

    # Fractional-month offset so a nextDueDate a few days before the anniversary
    # still rounds into the correct cycle (same fix as JS side, commit da3ed0b).
    day_offset = (start_d - origin_d) / 30

    total_amount = 0.0
    current_rent = base_amount

    for i in range(months):
        abs_month = start_m + i
        cur_y     = start_y + abs_month // 12
        cur_m     = abs_month % 12

        months_since_origin = (cur_y - origin_y) * 12 + (cur_m - origin_m) + day_offset
        cycles = floor(max(0, round(months_since_origin)) / cycle_months)

        monthly_rent = round(base_amount * (INCREASE_RATE ** cycles))
        total_amount += monthly_rent
        current_rent  = monthly_rent

    return {"total_amount": total_amount, "final_rent": current_rent}


def get_current_rent(base_amount: float, origin_date: datetime, is_vacant: bool) -> float:
    """Current rent RIGHT NOW based on anniversaries since origin_date."""
    now    = datetime.now(timezone.utc).replace(tzinfo=None)
    origin = origin_date if isinstance(origin_date, datetime) else datetime.fromisoformat(str(origin_date))

    if now < origin:
        return base_amount

    years_diff = (
        (now.year - origin.year)
        + (now.month - origin.month) / 12
        + (now.day - origin.day) / 365
    )
    cycle_years = CYCLE_YEARS_VACANT if is_vacant else CYCLE_YEARS_OCCUPIED
    cycles = floor(max(0, years_diff) / cycle_years)
    return round(base_amount * (INCREASE_RATE ** cycles))
