from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from datetime import datetime, timedelta

from models.user import User
from models.tenant import Tenant
from models.estate import Estate
from models.unit import Unit
from models.payment import Payment
from models.wallet import Wallet
from models.billing_item import BillingItem
from core.security import get_current_user
from core.database import get_db
from core.db_helpers import find_one, find_all, count, sum_col
from utils.tenant_helpers import project_next_due_date, estate_config_for
from utils.rent_calculator import calculate_effective_rent, get_current_rent, resolve_increase_start
from utils.time_utils import utcnow

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/overview")
async def get_overview(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    role = user.role
    if role in ("tenant", "user"):
        data = await _tenant_overview(db, user.id)
    elif role in ("business_owner", "admin"):
        data = await _business_owner_overview(db, user.id)
    elif role in ("vendor", "super_vendor"):
        data = await _vendor_overview(db, user.id)
    elif role in ("manager", "super_manager"):
        data = await _manager_overview(db, user.id)
    elif role == "super_admin":
        data = await _super_admin_overview(db)
    else:
        data = await _tenant_overview(db, user.id)

    return {
        "success": True,
        "message": f"{role} overview retrieved successfully",
        "data": {
            "role": role,
            "user": {"id": user.id, "name": user.name, "email": user.email,
                     "role": user.role, "profile_image_url": user.profile_image_url},
            "timestamp": utcnow(),
            "data": data,
        }
    }


async def _tenant_overview(db: AsyncSession, user_id: str) -> dict:
    tenant = await find_one(db, Tenant, Tenant.user == user_id, Tenant.is_active == True)
    overview = {
        "section": "TENANT_OVERVIEW",
        "apartment": None,
        "billing": {"total_pending": 0, "total_paid": 0, "upcoming_due": [], "overdue": []},
        "payments": {"recent_payments": [], "total_paid": 0},
        "yearly_payment": None,
        "wallet": {"balance": 0, "currency": "NGN"},
    }
    if not tenant:
        return overview

    projected_due = project_next_due_date(tenant)
    unit   = await db.get(Unit, tenant.unit) if tenant.unit else None
    estate = await db.get(Estate, tenant.estate) if tenant.estate else None

    overview["apartment"] = {
        "id": tenant.id, "tenant_name": tenant.tenant_name,
        "tenant_email": tenant.tenant_email, "tenant_phone": tenant.tenant_phone,
        "unit": unit.label if unit else "N/A",
        "unit_type": unit.category if unit else "N/A",
        "bedrooms": unit.bedrooms if unit else 0,
        "bathrooms": unit.bathrooms if unit else 0,
        "area": unit.area if unit else 0,
        "images": [{"url": i.get("url")} for i in (unit.images if unit else [])],
        "estate": estate.name if estate else "N/A",
        "rent_amount": tenant.rent_amount,
        "service_charge_amount": tenant.service_charge_amount,
        "entry_date": tenant.entry_date, "next_due_date": projected_due,
        "status": tenant.status, "tenant_type": tenant.tenant_type,
        "rent_outstanding": tenant.rent_outstanding or 0,
        "service_charge_outstanding": tenant.service_charge_outstanding or 0,
        "meter_number": (unit.meter_number if unit else None) or tenant.electric_meter_number or None,
    }

    bills = await find_all(db, BillingItem, BillingItem.user == user_id,
                           BillingItem.is_active == True, BillingItem.is_paid == False)
    overview["billing"]["total_pending"] = sum(b.amount for b in bills)
    now = utcnow()
    for b in bills:
        entry = {"id": b.id, "label": b.label, "amount": b.amount}
        if b.due_date and b.due_date < now:
            overview["billing"]["overdue"].append(entry)
        else:
            overview["billing"]["upcoming_due"].append({**entry, "due_date": b.due_date})

    recent_payments = await find_all(db, Payment,
                                     Payment.tenant == tenant.id, Payment.payment_status == "completed",
                                     order_by=Payment.created_at.desc(), limit=5)
    total_paid = await sum_col(db, Payment, Payment.amount,
                               Payment.tenant == tenant.id, Payment.payment_status == "completed")
    overview["payments"]["recent_payments"] = [
        {"id": p.id, "amount": p.amount, "type": p.payment_type, "date": p.created_at}
        for p in recent_payments
    ]
    overview["payments"]["total_paid"] = total_paid
    overview["billing"]["total_paid"]  = total_paid

    wallet = await find_one(db, Wallet, Wallet.user_id == user_id)
    if wallet:
        overview["wallet"]["balance"] = wallet.balance

    if projected_due and tenant.entry_date:
        origin = tenant.entry_date
        rent_base = tenant.base_rent or tenant.rent_amount
        svc_base  = tenant.base_service_charge or tenant.service_charge_amount or 0
        renewal_start = projected_due
        billing_start = renewal_start.replace(year=renewal_start.year - 1)
        _r, _c, _s = await estate_config_for(db, tenant.estate)
        _s = resolve_increase_start(tenant, _s)          # tenant override wins over estate
        cy_rent_proj = calculate_effective_rent(rent_base, billing_start, 12, False, origin, _r, _c, _s)
        cy_svc_proj  = calculate_effective_rent(svc_base, billing_start, 12, False, origin, _r, _c, _s)
        ny_rent_proj = calculate_effective_rent(rent_base, renewal_start, 12, False, origin, _r, _c, _s)
        ny_svc_proj  = calculate_effective_rent(svc_base, renewal_start, 12, False, origin, _r, _c, _s)

        # Paid this calendar year, broken down by type (billing_items metadata wins)
        year_start = datetime(now.year, 1, 1)
        year_end   = datetime(now.year + 1, 1, 1)
        cy_payments = await find_all(db, Payment,
                                     Payment.tenant == tenant.id, Payment.payment_status == "completed",
                                     Payment.created_at >= year_start, Payment.created_at < year_end)
        cy_rent = cy_svc = cy_other = 0.0
        for p in cy_payments:
            items = (((p.paystack_response or {}).get("data") or {}).get("metadata") or {}).get("billing_items") or []
            if items:
                for item in items:
                    code = item.get("code") or item.get("type") or ""
                    if code == "rent":              cy_rent  += item.get("amount") or 0
                    elif code == "service_charge":  cy_svc   += item.get("amount") or 0
                    else:                           cy_other += item.get("amount") or 0
            elif p.payment_type == "rent":            cy_rent  += p.amount
            elif p.payment_type == "service_charge":  cy_svc   += p.amount
            elif p.payment_type in ("caution_fee", "legal_fee", "deposit", "other"): cy_other += p.amount
            else:                                     cy_rent  += p.amount  # bundle / initial — covers rent
        cy_paid_total = cy_rent + cy_svc + cy_other

        # One-time fees (new tenants, year 1 only, if not yet paid)
        is_first_time = tenant.tenant_type == "new"
        fee_payments = await find_all(db, Payment,
                                      Payment.tenant == tenant.id, Payment.payment_status == "completed",
                                      Payment.payment_type.in_(["caution_fee", "legal_fee", "initial", "bundle"]))
        paid_fees = set()
        for p in fee_payments:
            if p.payment_type in ("caution_fee", "legal_fee"):
                paid_fees.add(p.payment_type)
            items = (((p.paystack_response or {}).get("data") or {}).get("metadata") or {}).get("billing_items") or []
            for item in items:
                code = item.get("code") or item.get("type") or ""
                if code in ("caution_fee", "legal_fee"):
                    paid_fees.add(code)

        cy_other_proj = 0.0
        cy_other_breakdown = []
        if is_first_time and unit:
            if "caution_fee" not in paid_fees and (unit.caution_fee or 0) > 0:
                cy_other_proj += unit.caution_fee
                cy_other_breakdown.append({"code": "caution_fee", "label": "Caution Fee", "amount": unit.caution_fee})
            if "legal_fee" not in paid_fees and (unit.legal_fee or 0) > 0:
                cy_other_proj += unit.legal_fee
                cy_other_breakdown.append({"code": "legal_fee", "label": "Legal Fee", "amount": unit.legal_fee})

        cy_proj_total = cy_rent_proj["total_amount"] + cy_svc_proj["total_amount"] + cy_other_proj
        ny_total      = ny_rent_proj["total_amount"] + ny_svc_proj["total_amount"]

        # What the tenant still owes = the ADMIN-TRACKED arrears (payable in-app
        # via the outstanding_rent / outstanding_service_charge billing items) —
        # NOT "year total minus in-app payments". Most existing tenants paid
        # offline before the platform, so they have no Payment rows and the old
        # computation wrongly showed their whole year as outstanding. Only a
        # new tenant who hasn't completed their first payment genuinely owes
        # the year up front.
        tracked_out = (tenant.rent_outstanding or 0) + (tenant.service_charge_outstanding or 0)
        first_payment_pending = is_first_time and not await find_one(
            db, Payment, Payment.tenant == tenant.id, Payment.payment_status == "completed",
            Payment.payment_type.in_(["initial", "rent", "bundle"]))
        if first_payment_pending:
            cy_outstanding  = max(0, cy_proj_total - cy_paid_total)
            cy_paid_display = cy_paid_total
        else:
            cy_outstanding  = tracked_out
            cy_paid_display = min(cy_proj_total, max(cy_paid_total, cy_proj_total - tracked_out))

        overview["yearly_payment"] = {
            "current_year": {
                "year": billing_start.year,
                "is_first_time": is_first_time,
                "rent": cy_rent_proj["total_amount"],
                "service_charge": cy_svc_proj["total_amount"],
                **({"other": cy_other_proj, "other_breakdown": cy_other_breakdown} if cy_other_proj > 0 else {}),
                "total": cy_proj_total,
                "paid": {"rent": cy_rent, "service_charge": cy_svc,
                         **({"other": cy_other} if cy_other > 0 else {}), "total": cy_paid_display},
                "outstanding": cy_outstanding,
            },
            "next_year": {
                "year": renewal_start.year,
                "is_first_time": False,
                "renewal_start_date": renewal_start,
                "monthly_rent": ny_rent_proj["final_rent"],
                "monthly_service_charge": ny_svc_proj["final_rent"],
                "projected_rent": ny_rent_proj["total_amount"],
                "projected_service_charge": ny_svc_proj["total_amount"],
                "projected_total": ny_total,
                "rent_increased": ny_rent_proj["final_rent"] > cy_rent_proj["final_rent"],
            }
        }
    return overview


async def _business_owner_overview(db: AsyncSession, user_id: str) -> dict:
    result = await db.execute(
        select(Estate.id, Estate.name).where(Estate.owner == user_id, Estate.is_active == True)
    )
    estates = result.all()
    estate_ids = [e[0] for e in estates]

    if not estate_ids:
        return {"section": "BUSINESS_OWNER_OVERVIEW", "estates": {"total": 0},
                "units": {}, "tenants": {}, "revenue": {"monthly": 0}, "outstanding": {}}

    total_units    = await count(db, Unit, Unit.estate.in_(estate_ids), Unit.is_active == True)
    occupied_units = await count(db, Unit, Unit.estate.in_(estate_ids), Unit.is_active == True, Unit.status == "occupied")
    total_tenants  = await count(db, Tenant, Tenant.estate.in_(estate_ids), Tenant.is_active == True, Tenant.status == "occupied")

    from datetime import timedelta
    thirty_ago = utcnow() - timedelta(days=30)
    monthly_revenue = await sum_col(db, Payment, Payment.amount,
                                    Payment.estate.in_(estate_ids), Payment.payment_status == "completed",
                                    Payment.created_at >= thirty_ago)

    rent_out = await sum_col(db, Tenant, Tenant.rent_outstanding, Tenant.estate.in_(estate_ids), Tenant.is_active == True)
    svc_out  = await sum_col(db, Tenant, Tenant.service_charge_outstanding, Tenant.estate.in_(estate_ids), Tenant.is_active == True)
    now = utcnow()
    overdue_tenants = await count(db, Tenant, Tenant.estate.in_(estate_ids), Tenant.is_active == True,
                                  Tenant.status == "occupied", Tenant.next_due_date < now)

    return {
        "section": "BUSINESS_OWNER_OVERVIEW",
        "estates": {"total": len(estates), "names": [e[1] for e in estates]},
        "units": {"total": total_units, "occupied": occupied_units, "vacant": total_units - occupied_units,
                  "occupancy_rate": round(occupied_units / total_units * 100, 1) if total_units else 0},
        "tenants": {"total": total_tenants, "overdue": overdue_tenants},
        "revenue": {"monthly": monthly_revenue, "currency": "NGN"},
        "outstanding": {"rent": rent_out, "service_charge": svc_out, "total": rent_out + svc_out},
    }


async def _manager_overview(db: AsyncSession, user_id: str) -> dict:
    from datetime import timedelta
    from models.issue import Issue
    from models.billing_item import BillingItem

    # Resolve assigned estates (from user.assigned_estates or estate.managers)
    assigned = (await db.execute(select(User.assigned_estates).where(User.id == user_id))).scalar_one_or_none() or []
    if not assigned:
        result = await db.execute(
            select(Estate.id, Estate.name).where(
                Estate.is_active == True,
                or_(Estate.owner == user_id, Estate.managers.contains(user_id))
            )
        )
        rows = result.all()
        assigned = [r[0] for r in rows]
        estate_names = {r[0]: r[1] for r in rows}
    else:
        result = await db.execute(select(Estate.id, Estate.name).where(Estate.id.in_(assigned), Estate.is_active == True))
        estate_names = {r[0]: r[1] for r in result.all()}

    if not assigned:
        return {
            "section": "MANAGER_OVERVIEW",
            "managed_estates": 0,
            "estate_names": [],
            "units": {"total": 0, "occupied": 0, "vacant": 0, "occupancy_rate": 0},
            "tenants": {"total": 0, "overdue": 0},
            "revenue": {"monthly": 0, "currency": "NGN"},
            "outstanding": {"rent": 0, "service_charge": 0, "total": 0},
            "collection_rate": 0,
            "skills": {},
        }

    now = utcnow()
    thirty_ago = now - timedelta(days=30)

    # Units
    total_units    = await count(db, Unit, Unit.estate.in_(assigned), Unit.is_active == True)
    occupied_units = await count(db, Unit, Unit.estate.in_(assigned), Unit.is_active == True, Unit.status == "occupied")

    # Tenants
    total_tenants   = await count(db, Tenant, Tenant.estate.in_(assigned), Tenant.is_active == True)
    overdue_tenants = await count(db, Tenant, Tenant.estate.in_(assigned), Tenant.is_active == True, Tenant.next_due_date < now)

    # Financial
    monthly_revenue = await sum_col(db, Payment, Payment.amount,
                                    Payment.estate.in_(assigned),
                                    Payment.payment_status.in_(["completed", "success"]),
                                    Payment.created_at >= thirty_ago)
    rent_out = await sum_col(db, Tenant, Tenant.rent_outstanding, Tenant.estate.in_(assigned), Tenant.is_active == True)
    svc_out  = await sum_col(db, Tenant, Tenant.service_charge_outstanding, Tenant.estate.in_(assigned), Tenant.is_active == True)

    # Monthly rent roll (potential income)
    monthly_roll = await sum_col(db, Tenant, Tenant.rent_amount + Tenant.service_charge_amount,
                                 Tenant.estate.in_(assigned), Tenant.is_active == True, Tenant.status == "occupied")
    collection_rate = round(monthly_revenue / monthly_roll * 100, 1) if monthly_roll else 0

    # Issues
    open_issues  = await count(db, Issue, Issue.estate.in_(assigned), Issue.status != "closed", Issue.is_active == True)
    high_issues  = await count(db, Issue, Issue.estate.in_(assigned), Issue.status != "closed", Issue.priority == "high", Issue.is_active == True)

    # Overdue tenant list (top 5)
    from sqlalchemy import select as sa_select
    overdue_rows = (await db.execute(
        sa_select(Tenant).where(Tenant.estate.in_(assigned), Tenant.is_active == True, Tenant.next_due_date < now)
        .order_by(Tenant.next_due_date.asc()).limit(5)
    )).scalars().all()
    overdue_list = [
        {
            "id": t.id,
            "name": t.tenant_name,
            "unit": t.unit_label,
            "outstanding": round(t.rent_outstanding + t.service_charge_outstanding, 0),
            "due_date": t.next_due_date.isoformat() if t.next_due_date else None,
            "phone": t.tenant_phone,
            "email": t.tenant_email,
        }
        for t in overdue_rows
    ]

    # Per-estate breakdown
    estate_breakdown = []
    for eid in assigned:
        eu = await count(db, Unit, Unit.estate == eid, Unit.is_active == True)
        eo = await count(db, Unit, Unit.estate == eid, Unit.is_active == True, Unit.status == "occupied")
        et = await count(db, Tenant, Tenant.estate == eid, Tenant.is_active == True)
        eov = await count(db, Tenant, Tenant.estate == eid, Tenant.is_active == True, Tenant.next_due_date < now)
        erev = await sum_col(db, Payment, Payment.amount, Payment.estate == eid,
                             Payment.payment_status.in_(["completed", "success"]), Payment.created_at >= thirty_ago)
        estate_breakdown.append({
            "id": eid,
            "name": estate_names.get(eid, "Estate"),
            "units": {"total": eu, "occupied": eo, "vacant": eu - eo,
                      "occupancy_rate": round(eo / eu * 100, 1) if eu else 0},
            "tenants": et,
            "overdue": eov,
            "revenue_30d": erev,
        })

    # Pending billing items (unpaid)
    pending_bills = await count(db, BillingItem, BillingItem.estate.in_(assigned), BillingItem.is_paid == False, BillingItem.is_active == True)

    return {
        "section": "MANAGER_OVERVIEW",
        "managed_estates": len(assigned),
        "estate_names": list(estate_names.values()),
        "estate_breakdown": estate_breakdown,
        "units": {
            "total": total_units,
            "occupied": occupied_units,
            "vacant": total_units - occupied_units,
            "occupancy_rate": round(occupied_units / total_units * 100, 1) if total_units else 0,
        },
        "tenants": {
            "total": total_tenants,
            "overdue": overdue_tenants,
            "overdue_list": overdue_list,
        },
        "revenue": {"monthly": monthly_revenue, "currency": "NGN"},
        "outstanding": {"rent": rent_out, "service_charge": svc_out, "total": round(rent_out + svc_out, 0)},
        "collection_rate": collection_rate,
        "monthly_rent_roll": monthly_roll,
        "skills": {
            "open_issues": open_issues,
            "high_priority_issues": high_issues,
            "pending_bills": pending_bills,
        },
    }


async def _vendor_overview(db: AsyncSession, user_id: str) -> dict:
    wallet = await find_one(db, Wallet, Wallet.user_id == user_id)
    return {
        "section": "VENDOR_OVERVIEW",
        "wallet": {"balance": wallet.balance if wallet else 0, "currency": "NGN"},
        "service_requests": {"pending": 0, "completed": 0},
    }


async def _super_admin_overview(db: AsyncSession) -> dict:
    """BamiHost is a MULTI-BUSINESS platform — Real Estate is only ONE line, and
    more will be added over time. This overview is deliberately structured as
    company-wide numbers (apply to the whole business, whatever lines exist)
    PLUS one section per ACTIVE business line — never a single estate-shaped
    grid presented as if it were the whole system. A future business line adds
    a new entry to `lines`; it does not require reshaping this response."""
    from models.issue import Issue
    from models.enquiry import Enquiry
    from models.meter_device import MeterDevice
    from models.autopilot_action import AutopilotAction

    now = utcnow()
    thirty_ago = now - timedelta(days=30)

    total_users   = await count(db, User, User.is_active == True)
    total_revenue = await sum_col(db, Payment, Payment.amount, Payment.payment_status == "completed")
    revenue_30d   = await sum_col(db, Payment, Payment.amount,
                                  Payment.payment_status == "completed", Payment.created_at >= thirty_ago)

    # A real pulse of what the AI team has been doing — no placeholder content.
    recent = (await db.execute(
        select(AutopilotAction.skill, AutopilotAction.title, AutopilotAction.priority, AutopilotAction.created_at)
        .order_by(AutopilotAction.created_at.desc()).limit(8)
    )).all()
    recent_activity = [
        {"skill": r.skill, "title": r.title, "priority": r.priority, "created_at": r.created_at}
        for r in recent
    ]

    company = {
        "users": total_users,
        "revenue": {"all_time": total_revenue, "last_30_days": revenue_30d, "currency": "NGN"},
    }

    lines: dict = {}

    # ── Real Estate ──────────────────────────────────────────────────────────
    total_estates = await count(db, Estate, Estate.is_active == True)
    if total_estates:
        total_units    = await count(db, Unit, Unit.is_active == True)
        occupied_units = await count(db, Unit, Unit.is_active == True, Unit.status == "occupied")
        total_tenants  = await count(db, Tenant, Tenant.is_active == True)
        rent_out       = await sum_col(db, Tenant, Tenant.rent_outstanding, Tenant.is_active == True)
        svc_out        = await sum_col(db, Tenant, Tenant.service_charge_outstanding, Tenant.is_active == True)
        overdue_tenants = await count(db, Tenant, Tenant.is_active == True, Tenant.next_due_date < now)
        open_issues = await count(db, Issue, Issue.is_active == True, Issue.status.in_(["open", "pending", "in_progress"]))
        high_priority_issues = await count(db, Issue, Issue.is_active == True,
                                           Issue.status.in_(["open", "pending", "in_progress"]), Issue.priority == "high")
        pending_enquiries = await count(db, Enquiry, Enquiry.status == "pending")

        lines["Real Estate"] = {
            "estates": total_estates, "units": total_units, "occupied": occupied_units,
            "vacant": total_units - occupied_units, "tenants": total_tenants,
            "occupancy_rate": round(occupied_units / total_units * 100, 1) if total_units else 0,
            "outstanding": {"rent": rent_out, "service": svc_out, "total": rent_out + svc_out},
            "overdue_tenants": overdue_tenants,
            "open_issues": open_issues, "high_priority_issues": high_priority_issues,
            "pending_enquiries": pending_enquiries,
        }

    # ── Smart Metering ───────────────────────────────────────────────────────
    total_meters = await count(db, MeterDevice, MeterDevice.is_active == True)
    if total_meters:
        online_meters = await count(db, MeterDevice, MeterDevice.is_active == True, MeterDevice.is_online == True)
        low_credit = (await db.execute(
            select(func.count()).select_from(MeterDevice).where(
                MeterDevice.is_active == True, MeterDevice.prepaid_mode == True,
                MeterDevice.credit_balance <= MeterDevice.low_balance_threshold,
            )
        )).scalar() or 0
        lines["Smart Metering"] = {
            "meters": total_meters, "online": online_meters, "offline": total_meters - online_meters,
            "low_credit": low_credit,
        }

    return {
        "section": "SUPER_ADMIN_OVERVIEW",
        "business_lines": list(lines.keys()),
        "company": company,
        "lines": lines,
        "recent_activity": recent_activity,
    }


# ── AI Business Health Score ───────────────────────────────────────────────────

@router.get("/health-score")
async def get_health_score(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns a 0-100 AI business health score with dimension breakdown and action tips."""
    import json, re
    from services import llm
    from models.tenant import Tenant
    from models.unit import Unit
    from models.estate import Estate
    from models.enquiry import Enquiry
    from models.issue import Issue
    from sqlalchemy import func, extract

    uid = str(current_user.id)
    now = utcnow()
    thirty_days_ago = now - timedelta(days=30)

    # ── Gather metrics ────────────────────────────────────────────────────────
    tenants = (await db.execute(
        select(Tenant).where(Tenant.owner_id == uid, Tenant.is_active == True)
    )).scalars().all()

    units = (await db.execute(
        select(Unit).where(Unit.owner_id == uid, Unit.is_active == True)
    )).scalars().all()

    active_count   = len(tenants)
    total_units    = len(units)
    vacant_count   = total_units - active_count
    occupancy_rate = round((active_count / total_units * 100) if total_units else 0, 1)

    overdue   = [t for t in tenants if (t.rent_outstanding or 0) > 0]
    total_out = sum((t.rent_outstanding or 0) + (t.service_charge_outstanding or 0) for t in tenants)
    rent_roll = sum((t.rent_amount or 0) + (t.service_charge_amount or 0) for t in tenants)
    collection_rate = round(((rent_roll - total_out) / rent_roll * 100) if rent_roll else 0, 1)

    open_issues = (await db.execute(
        select(func.count(Issue.id)).where(
            Issue.owner_id == uid if hasattr(Issue, 'owner_id') else Issue.reporter == uid,
            Issue.status.notin_(["closed", "resolved"]),
            Issue.is_active == True,
        )
    )).scalar() or 0

    new_enquiries = (await db.execute(
        select(func.count(Enquiry.id)).where(
            Enquiry.owner_id == uid,
            Enquiry.created_at >= thirty_days_ago,
        )
    )).scalar() or 0

    expiring_leases = len([
        t for t in tenants if t.lease_end_date and
        now <= t.lease_end_date <= now + timedelta(days=60)
    ])

    snapshot = (
        f"Occupancy: {occupancy_rate}% ({active_count}/{total_units} units), "
        f"Collection rate: {collection_rate}%, "
        f"Overdue tenants: {len(overdue)}, "
        f"Total outstanding: ₦{total_out:,.0f}, "
        f"Open maintenance issues: {open_issues}, "
        f"New enquiries last 30 days: {new_enquiries}, "
        f"Leases expiring in 60 days: {expiring_leases}"
    )

    # ── Ask AI for scored breakdown ──────────────────────────────────────────
    text = await llm.text(
        (
            "You are a Nigerian property business analyst. Score this property business and return ONLY JSON. "
            "Format: {\"overall\": 78, \"dimensions\": [{\"name\": \"Occupancy\", \"score\": 85, \"max\": 100, \"comment\": \"...\"},"
            "{\"name\": \"Cash Collection\", \"score\": 70, \"max\": 100, \"comment\": \"...\"},"
            "{\"name\": \"Maintenance\", \"score\": 80, \"max\": 100, \"comment\": \"...\"},"
            "{\"name\": \"Lead Pipeline\", \"score\": 60, \"max\": 100, \"comment\": \"...\"},"
            "{\"name\": \"Lease Stability\", \"score\": 75, \"max\": 100, \"comment\": \"...\"}],"
            "\"summary\": \"...\", \"top_actions\": [\"...\", \"...\", \"...\"]}"
        ),
        f"Business snapshot: {snapshot}. Score it.",
        tier=llm.FAST, max_tokens=600,
    ) or "{}"
    try:
        result = json.loads(text)
    except Exception:
        match = re.search(r'\{.*\}', text, re.DOTALL)
        result = json.loads(match.group()) if match else {}

    return {
        "metrics": {
            "occupancy_rate": occupancy_rate,
            "collection_rate": collection_rate,
            "active_tenants": active_count,
            "total_units": total_units,
            "vacant_units": vacant_count,
            "overdue_tenants": len(overdue),
            "total_outstanding": total_out,
            "open_issues": open_issues,
            "new_enquiries_30d": new_enquiries,
            "expiring_leases_60d": expiring_leases,
        },
        "score": result,
    }
