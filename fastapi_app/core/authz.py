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


def is_platform_admin(user) -> bool:
    return user.role == "super_admin"


async def accessible_estate_ids(db, user) -> set | None:
    """Estate ids the user may act on; None means unrestricted (platform admin)."""
    if is_platform_admin(user):
        return None
    if user.role == "business_owner":
        # Strictly the estates they own. Ownership is the single source of truth
        # (onboarding/reassignment moves Estate.owner); created_by is deliberately
        # NOT honoured, so a reassigned estate stops being visible to its creator.
        result = await db.execute(
            select(Estate.id).where(Estate.is_active == True, Estate.owner == user.id)
        )
        return {r[0] for r in result.all()}
    if user.role in {"admin", "manager", "super_manager"}:
        assigned = getattr(user, "assigned_estates", None) or []
        if not assigned:
            return set()
        result = await db.execute(
            select(Estate.id).where(Estate.is_active == True, Estate.id.in_(assigned))
        )
        return {r[0] for r in result.all()}
    return set()


async def require_estate_access(db, user, estate_id):
    allowed = await accessible_estate_ids(db, user)
    if allowed is not None and estate_id not in allowed:
        raise HTTPException(status_code=404, detail="Not found")


async def require_tenant_access(db, user, tenant, write: bool = False):
    """Staff of the tenant's estate always pass; the tenant themself passes
    for read-only access to their own record."""
    if not write and tenant.user and tenant.user == user.id:
        return
    await require_estate_access(db, user, tenant.estate)
