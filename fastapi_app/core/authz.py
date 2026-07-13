"""Cross-business access control.

The platform hosts many businesses (estates). Anything reachable by id —
tenants, payments, units — must be scoped to the estates the caller can
access, mirroring the model estates.py already enforces:

  - super_admin                      : the whole platform
  - business_owner                   : estates they own or created
  - admin / manager / super_manager  : estates in user.assigned_estates
  - everyone else (tenant, vendor)   : none (tenants use the /me routes,
                                       plus read-only access to their own
                                       tenant record)

Out-of-scope ids raise 404 rather than 403 so resource ids cannot be
probed across businesses.
"""
from fastapi import HTTPException
from sqlalchemy import select

from models.estate import Estate


# ── Per-property roles ────────────────────────────────────────────────────────
# Each estate has a team (Estate.members) of {user_id, email, role}. The estate
# owner is the implicit "admin". Rank governs what a member may do on THAT estate:
#   admin   → edit everything (settings, fees, rent policy, members, delete)
#   manager → day-to-day ops (tenants, units, payments, issues) — NOT settings
#   viewer  → read-only
PROPERTY_ROLES = ("viewer", "manager", "admin")
_ROLE_RANK = {r: i for i, r in enumerate(PROPERTY_ROLES)}  # viewer=0 < manager=1 < admin=2


def is_platform_admin(user) -> bool:
    return user.role == "super_admin"


def property_role(estate, user) -> str | None:
    """The caller's effective role on THIS estate, or None if they have no access.

    Precedence: platform admin → owner (implicit admin) → explicit member entry →
    legacy back-compat (estate.managers / user.assigned_estates ⇒ manager)."""
    if is_platform_admin(user):
        return "admin"
    if estate.owner and estate.owner == user.id:
        return "admin"
    for m in (estate.members or []):
        if isinstance(m, dict) and m.get("user_id") == user.id:
            role = m.get("role")
            return role if role in _ROLE_RANK else "viewer"
    # Back-compat: users attached the old way keep day-to-day (manager) access.
    if user.id in (estate.managers or []):
        return "manager"
    if estate.id in (getattr(user, "assigned_estates", None) or []):
        return "manager"
    return None


def has_property_role(estate, user, min_role: str) -> bool:
    role = property_role(estate, user)
    return role is not None and _ROLE_RANK[role] >= _ROLE_RANK[min_role]


async def require_estate_role(db, user, estate_id, min_role: str = "viewer"):
    """Gate an estate-scoped action by the caller's role on that estate.
    Out-of-scope / insufficient-role both surface as 404 so ids can't be probed."""
    estate = await db.get(Estate, estate_id)
    if not estate or not estate.is_active:
        raise HTTPException(status_code=404, detail="Not found")
    if not has_property_role(estate, user, min_role):
        # A viewer trying to write gets 403 (they can see it); a non-member gets 404.
        if property_role(estate, user) is not None:
            raise HTTPException(status_code=403, detail="You do not have permission to edit this property")
        raise HTTPException(status_code=404, detail="Not found")
    return estate


async def accessible_estate_ids(db, user) -> set | None:
    """Estate ids the user may act on; None means unrestricted (platform admin).

    An estate is accessible if the user OWNS it, is a per-property MEMBER of it,
    or (back-compat) has it in assigned_estates. What they may DO there is then
    governed by property_role(); accessibility just means "may see/enter"."""
    if is_platform_admin(user):
        return None

    ids: set = set()

    # Owned estates (business owners / property admins).
    owned = await db.execute(
        select(Estate.id).where(Estate.is_active == True, Estate.owner == user.id)
    )
    ids.update(r[0] for r in owned.all())

    # Legacy attachment: assigned_estates (managers) still grants access.
    assigned = getattr(user, "assigned_estates", None) or []
    if assigned:
        res = await db.execute(
            select(Estate.id).where(Estate.is_active == True, Estate.id.in_(assigned))
        )
        ids.update(r[0] for r in res.all())

    # Per-property membership: scan active estates whose members include this user.
    # members is a small JSON list, so a Python-side filter is fine at this scale.
    member_rows = await db.execute(
        select(Estate.id, Estate.members, Estate.managers).where(Estate.is_active == True)
    )
    for eid, members, managers in member_rows.all():
        if any(isinstance(m, dict) and m.get("user_id") == user.id for m in (members or [])):
            ids.add(eid)
        elif user.id in (managers or []):
            ids.add(eid)

    return ids


async def require_estate_access(db, user, estate_id, min_role: str = "viewer"):
    """Gate estate-scoped access by the caller's per-property role.
    Default `viewer` = any member may read; pass `manager` for day-to-day
    writes and `admin` for property settings/delete/member changes."""
    await require_estate_role(db, user, estate_id, min_role)


async def require_tenant_access(db, user, tenant, write: bool = False):
    """Staff of the tenant's estate pass (managers+ for writes, any member for
    reads); the tenant themself passes for read-only access to their own record."""
    if not write and tenant.user and tenant.user == user.id:
        return
    await require_estate_access(db, user, tenant.estate, "manager" if write else "viewer")
