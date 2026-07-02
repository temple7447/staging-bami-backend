"""Single source of "now" for the app.

The database stores naive UTC datetimes, and `datetime.utcnow()` is
deprecated since Python 3.12. Use `utcnow()` everywhere instead — it keeps
the naive-UTC storage convention while using the supported API.
"""
from datetime import datetime, timezone


def utcnow() -> datetime:
    """Naive UTC now — matches the DB's naive-UTC storage convention."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
