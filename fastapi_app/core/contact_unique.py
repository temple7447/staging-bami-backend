"""One email and one phone number belong to one person.

Used wherever an account or a tenant record is created or its email / phone is
changed, so the same contact can't end up on two people. Phone numbers are
stored as typed ("+234 903 278 3640", "0903 278 3640"), so they are compared by
their last 10 digits.

What counts as taken:
  * an email: any account (deactivated ones too — the column is unique) and any
    active tenant record;
  * a phone number: any ACTIVE account and any ACTIVE tenant record. A tenant who
    moved out has a deactivated account and an inactive record, so their number
    is free to be used again.

Edits pass the ids of the account(s) and tenant record(s) being edited so a
person is never in conflict with themselves."""
import re
from typing import Iterable

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.tenant import Tenant
from models.user import User


def phone_key(raw: str | None) -> str:
    """Last 10 digits of a phone number — the same notion login uses."""
    digits = re.sub(r"\D", "", raw or "")
    return digits[-10:] if len(digits) >= 10 else digits


def _norm_email(raw: str | None) -> str:
    return (raw or "").strip().lower()


async def find_contact_conflict(
    db: AsyncSession, *, email: str | None = None, phone: str | None = None,
    exclude_user_ids: Iterable[str] = (), exclude_tenant_ids: Iterable[str] = (),
) -> tuple[str, str] | None:
    """Return ("email" | "phone", who) for the first clash, or None if it's free."""
    skip_users, skip_tenants = {u for u in exclude_user_ids if u}, {t for t in exclude_tenant_ids if t}

    em = _norm_email(email)
    if em:
        q = select(User.id, User.name).where(func.lower(User.email) == em)
        for uid, name in (await db.execute(q)).all():
            if uid not in skip_users:
                return "email", name or "another account"
        q = select(Tenant.id, Tenant.tenant_name, Tenant.user).where(
            func.lower(Tenant.tenant_email) == em, Tenant.is_active == True)
        for tid, name, uid in (await db.execute(q)).all():
            if tid not in skip_tenants and uid not in skip_users:
                return "email", name or "another tenant"

    key = phone_key(phone)
    if len(key) >= 7:
        # Narrow in SQL on the last 4 digits (they stay contiguous however the
        # number was spaced), then compare the full digits in Python.
        tail = f"%{key[-4:]}%"
        q = select(User.id, User.name, User.phone).where(
            User.is_active == True, User.phone.isnot(None), User.phone.like(tail))
        for uid, name, ph in (await db.execute(q)).all():
            if uid not in skip_users and phone_key(ph) == key:
                return "phone", name or "another account"
        q = select(Tenant.id, Tenant.tenant_name, Tenant.user, Tenant.tenant_phone).where(
            Tenant.is_active == True, Tenant.tenant_phone.isnot(None), Tenant.tenant_phone.like(tail))
        for tid, name, uid, ph in (await db.execute(q)).all():
            if tid not in skip_tenants and uid not in skip_users and phone_key(ph) == key:
                return "phone", name or "another tenant"
    return None


async def ensure_unique_contact(
    db: AsyncSession, *, email: str | None = None, phone: str | None = None,
    exclude_user_ids: Iterable[str] = (), exclude_tenant_ids: Iterable[str] = (),
    reveal_owner: bool = True,
) -> None:
    """Raise 409 when the email or phone already belongs to someone else.

    `reveal_owner=False` for public endpoints (sign-up), which must not tell a
    stranger whose number it is."""
    clash = await find_contact_conflict(
        db, email=email, phone=phone,
        exclude_user_ids=exclude_user_ids, exclude_tenant_ids=exclude_tenant_ids)
    if not clash:
        return
    kind, who = clash
    label = "email address" if kind == "email" else "phone number"
    if reveal_owner:
        detail = f"This {label} is already used by {who}. Each person needs their own {label}."
    else:
        detail = f"This {label} is already registered."
    raise HTTPException(status_code=409, detail=detail)
