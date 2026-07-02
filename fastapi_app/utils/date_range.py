"""Shared date-range helper — mirrors the period-filter logic in estateController.js."""
from datetime import datetime, timedelta
from typing import Optional, Tuple
from utils.time_utils import utcnow


def resolve_date_range(
    period:     Optional[str] = None,
    year:       Optional[int] = None,
    month:      Optional[int] = None,
    start_date: Optional[str] = None,
    end_date:   Optional[str] = None,
) -> Tuple[datetime, datetime]:
    now = utcnow()

    if year or month:
        target_year  = year or now.year
        target_month = (month or 1) - 1   # 0-indexed

        if month:
            import calendar
            last_day = calendar.monthrange(target_year, target_month + 1)[1]
            return (
                datetime(target_year, target_month + 1, 1),
                datetime(target_year, target_month + 1, last_day, 23, 59, 59, 999000),
            )
        return (
            datetime(target_year, 1, 1),
            datetime(target_year, 12, 31, 23, 59, 59, 999000),
        )

    if period == "custom" and start_date and end_date:
        end = datetime.fromisoformat(end_date).replace(hour=23, minute=59, second=59)
        return datetime.fromisoformat(start_date), end

    target_year = year or now.year
    period_map = {
        "today":    (datetime(now.year, now.month, now.day), now),
        "week":     (now - timedelta(days=7), now),
        "quarter":  (now - timedelta(days=90), now),
        "Q1":       (datetime(target_year, 1, 1),  datetime(target_year, 3, 31, 23, 59, 59)),
        "Q2":       (datetime(target_year, 4, 1),  datetime(target_year, 6, 30, 23, 59, 59)),
        "Q3":       (datetime(target_year, 7, 1),  datetime(target_year, 9, 30, 23, 59, 59)),
        "Q4":       (datetime(target_year, 10, 1), datetime(target_year, 12, 31, 23, 59, 59)),
        "6_months": (now - timedelta(days=180), now),
        "year":     (now - timedelta(days=365), now),
    }
    return period_map.get(period, (now - timedelta(days=30), now))
