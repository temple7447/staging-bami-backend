from fastapi import APIRouter, Depends
from datetime import datetime
from bson import ObjectId

from models.user import User
from models.tenant import Tenant
from models.estate import Estate
from models.unit import Unit
from models.payment import Payment
from models.wallet import Wallet
from models.billing_item import BillingItem
from core.security import get_current_user
from utils.tenant_helpers import project_next_due_date
from utils.rent_calculator import calculate_effective_rent, get_current_rent

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


# ── Role-dispatched overview ──────────────────────────────────────────────────

@router.get("/overview")
async def get_overview(user: User = Depends(get_current_user)):
    role = user.role

    if role in ("tenant", "user"):
        data = await _tenant_overview(user.id)
    elif role in ("business_owner", "admin"):
        data = await _business_owner_overview(user.id)
    elif role in ("vendor", "super_vendor"):
        data = await _vendor_overview(user.id)
    elif role in ("manager", "super_manager"):
        data = await _manager_overview(user.id)
    elif role == "super_admin":
        data = await _super_admin_overview()
    else:
        data = await _tenant_overview(user.id)

    return {
        "success": True,
        "message": f"{role} overview retrieved successfully",
        "data": {
            "role": role,
            "user": {
                "id":              str(user.id),
                "name":            user.name,
                "email":           user.email,
                "role":            user.role,
                "profile_image_url": getattr(user, "profile_image_url", None),
            },
            "timestamp": datetime.utcnow(),
            "data":      data,
        }
    }


# ── Tenant Overview ───────────────────────────────────────────────────────────

async def _tenant_overview(user_id) -> dict:
    tenant = await Tenant.find_one({"user": user_id, "is_active": True})

    overview: dict = {
        "section":    "TENANT_OVERVIEW",
        "apartment":  None,
        "billing":    {"total_pending": 0, "total_paid": 0, "upcoming_due": [], "overdue": []},
        "payments":   {"recent_payments": [], "total_paid": 0},
        "yearly_payment": None,
        "wallet":     {"balance": 0, "currency": "NGN"},
        "notifications": [],
    }

    if not tenant:
        return overview

    # Reconcile nextDueDate
    next_due = await _reconcile_next_due_for_overview(tenant)
    if next_due:
        tenant.next_due_date = next_due

    # Project legacy-default nextDueDate
    projected_due = project_next_due_date(tenant)

    # Apartment section
    unit = await Unit.get(str(tenant.unit)) if tenant.unit else None
    estate = await Estate.get(str(tenant.estate)) if tenant.estate else None

    overview["apartment"] = {
        "id":              str(tenant.id),
        "tenant_name":     tenant.tenant_name,
        "tenant_email":    tenant.tenant_email,
        "tenant_phone":    tenant.tenant_phone,
        "profile_image_url": getattr(tenant, "profile_image_url", None),
        "unit":            unit.label if unit else "N/A",
        "unit_type":       unit.category if unit else "N/A",
        "bedrooms":        unit.bedrooms if unit else 0,
        "bathrooms":       unit.bathrooms if unit else 0,
        "area":            unit.area if unit else 0,
        "description":     unit.description if unit else None,
        "images":          [{"url": i.get("url"), "caption": i.get("caption")} for i in (unit.images if unit else [])],
        "estate":          estate.name if estate else "N/A",
        "estate_address":  estate.address if estate else None,
        "rent_amount":     tenant.rent_amount,
        "service_charge_amount": tenant.service_charge_amount,
        "entry_date":      tenant.entry_date,
        "next_due_date":   projected_due,
        "status":          tenant.status,
        "tenant_type":     tenant.tenant_type,
        "meter_number":    tenant.electric_meter_number,
        "rent_outstanding": tenant.rent_outstanding or 0,
        "service_charge_outstanding": tenant.service_charge_outstanding or 0,
    }

    # Billing items
    billing_items = await BillingItem.find({"user": user_id, "is_active": True, "is_paid": False}).to_list()
    total_pending = sum(b.amount for b in billing_items)
    overview["billing"]["total_pending"] = total_pending
    now = datetime.utcnow()
    for b in billing_items:
        if b.due_date and b.due_date < now:
            overview["billing"]["overdue"].append({"id": str(b.id), "label": b.label, "amount": b.amount})
        else:
            overview["billing"]["upcoming_due"].append({"id": str(b.id), "label": b.label, "amount": b.amount, "due_date": b.due_date})

    # Payments
    pcoll = Payment.get_motor_collection()
    recent_payments = await pcoll.find(
        {"tenant": tenant.id, "payment_status": "completed"},
        sort=[("created_at", -1)]
    ).limit(5).to_list(5)
    total_paid_agg = await pcoll.aggregate([
        {"$match": {"tenant": tenant.id, "payment_status": "completed"}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    total_paid = total_paid_agg[0]["total"] if total_paid_agg else 0
    overview["payments"]["recent_payments"] = recent_payments
    overview["payments"]["total_paid"]      = total_paid
    overview["billing"]["total_paid"]       = total_paid

    # Wallet
    wallet = await Wallet.find_one({"user_id": user_id})
    if wallet:
        overview["wallet"]["balance"] = wallet.balance

    # Yearly payment breakdown
    if projected_due and tenant.entry_date:
        origin    = tenant.entry_date
        rent_base = tenant.base_rent or tenant.rent_amount
        svc_base  = tenant.base_service_charge or tenant.service_charge_amount or 0

        renewal_start  = projected_due
        billing_start  = renewal_start.replace(year=renewal_start.year - 1)

        y1_rent = calculate_effective_rent(rent_base, billing_start, 12, False, origin)
        y1_svc  = calculate_effective_rent(svc_base,  billing_start, 12, False, origin)
        y2_rent = calculate_effective_rent(rent_base, renewal_start, 12, False, origin)
        y2_svc  = calculate_effective_rent(svc_base,  renewal_start, 12, False, origin)

        lease_months = max(0,
            (renewal_start.year - origin.year) * 12 + (renewal_start.month - origin.month)
        )

        overview["yearly_payment"] = {
            "lease_duration_months": lease_months,
            "year1": {
                "label":        "Current Year",
                "billing_start": billing_start,
                "billing_end":   renewal_start,
                "annual_rent":   y1_rent["total_amount"],
                "annual_service": y1_svc["total_amount"],
                "monthly_rent":  y1_rent["final_rent"],
                "monthly_service": y1_svc["final_rent"],
                "total": y1_rent["total_amount"] + y1_svc["total_amount"],
            },
            "year2": {
                "label":        "Renewal Year",
                "billing_start": renewal_start,
                "annual_rent":   y2_rent["total_amount"],
                "annual_service": y2_svc["total_amount"],
                "monthly_rent":  y2_rent["final_rent"],
                "monthly_service": y2_svc["final_rent"],
                "total": y2_rent["total_amount"] + y2_svc["total_amount"],
                "rent_increased": y2_rent["final_rent"] > y1_rent["final_rent"],
            }
        }

    return overview


async def _reconcile_next_due_for_overview(tenant: Tenant) -> datetime | None:
    """Return reconciled nextDueDate from payments (same as tenants.py helper)."""
    coll = Payment.get_motor_collection()
    payments = await coll.find(
        {"tenant": tenant.id, "payment_status": "completed",
         "payment_type": {"$in": ["rent", "service_charge", "bundle", "initial"]}},
        sort=[("created_at", -1)]
    ).to_list(100)
    if not payments:
        return None
    latest = tenant.next_due_date
    for p in payments:
        meta     = (p.get("paystack_response") or {}).get("data", {}).get("metadata", {})
        duration = meta.get("duration_months", 12)
        base     = p.get("created_at") or datetime.utcnow()
        candidate = base.replace(day=tenant.entry_date.day if tenant.entry_date else base.day)
        for _ in range(duration):
            m = (candidate.month % 12) + 1
            y = candidate.year + (1 if candidate.month == 12 else 0)
            candidate = candidate.replace(year=y, month=m)
        if not latest or candidate > latest:
            latest = candidate
    return latest


# ── Business Owner Overview ───────────────────────────────────────────────────

async def _business_owner_overview(user_id) -> dict:
    ecoll = Estate.get_motor_collection()
    estates = await ecoll.find({"owner": user_id, "is_active": True}).to_list(None)
    estate_ids = [e["_id"] for e in estates]

    ucoll = Unit.get_motor_collection()
    tcoll = Tenant.get_motor_collection()
    pcoll = Payment.get_motor_collection()

    total_units    = await ucoll.count_documents({"estate": {"$in": estate_ids}, "is_active": True})
    occupied_units = await ucoll.count_documents({"estate": {"$in": estate_ids}, "is_active": True, "status": "occupied"})
    vacant_units   = total_units - occupied_units
    total_tenants  = await tcoll.count_documents({"estate": {"$in": estate_ids}, "is_active": True, "status": "occupied"})

    # Revenue (last 30 days)
    thirty_ago = datetime.utcnow().replace(day=max(1, datetime.utcnow().day - 30))
    rev_agg = await pcoll.aggregate([
        {"$match": {"estate": {"$in": estate_ids}, "payment_status": "completed",
                    "created_at": {"$gte": thirty_ago}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    monthly_revenue = rev_agg[0]["total"] if rev_agg else 0

    # Outstanding balances
    outstanding_agg = await tcoll.aggregate([
        {"$match": {"estate": {"$in": estate_ids}, "is_active": True}},
        {"$group": {"_id": None,
                    "rent": {"$sum": "$rent_outstanding"},
                    "service": {"$sum": "$service_charge_outstanding"}}}
    ]).to_list(1)
    outstanding = outstanding_agg[0] if outstanding_agg else {"rent": 0, "service": 0}

    # Rent overdue tenants
    now = datetime.utcnow()
    overdue_tenants = await tcoll.count_documents({
        "estate": {"$in": estate_ids}, "is_active": True, "status": "occupied",
        "next_due_date": {"$lt": now}
    })

    # Recent payments
    recent_payments = await pcoll.find(
        {"estate": {"$in": estate_ids}, "payment_status": "completed"},
        sort=[("created_at", -1)]
    ).limit(5).to_list(5)

    return {
        "section": "BUSINESS_OWNER_OVERVIEW",
        "estates": {
            "total": len(estates),
            "names": [e["name"] for e in estates],
        },
        "units": {
            "total": total_units,
            "occupied": occupied_units,
            "vacant": vacant_units,
            "occupancy_rate": round(occupied_units / total_units * 100, 1) if total_units else 0,
        },
        "tenants": {
            "total": total_tenants,
            "overdue": overdue_tenants,
        },
        "revenue": {
            "monthly": monthly_revenue,
            "currency": "NGN",
        },
        "outstanding": {
            "rent": outstanding.get("rent", 0),
            "service_charge": outstanding.get("service", 0),
            "total": (outstanding.get("rent", 0) + outstanding.get("service", 0)),
        },
        "recent_payments": recent_payments,
    }


# ── Manager Overview ──────────────────────────────────────────────────────────

async def _manager_overview(user_id) -> dict:
    ecoll = Estate.get_motor_collection()
    estates = await ecoll.find({
        "$or": [{"owner": user_id}, {"managers": user_id}],
        "is_active": True
    }).to_list(None)
    estate_ids = [e["_id"] for e in estates]

    tcoll   = Tenant.get_motor_collection()
    ucoll   = Unit.get_motor_collection()
    now     = datetime.utcnow()

    total_units     = await ucoll.count_documents({"estate": {"$in": estate_ids}, "is_active": True})
    occupied_units  = await ucoll.count_documents({"estate": {"$in": estate_ids}, "is_active": True, "status": "occupied"})
    total_tenants   = await tcoll.count_documents({"estate": {"$in": estate_ids}, "is_active": True})
    overdue_tenants = await tcoll.count_documents({
        "estate": {"$in": estate_ids}, "is_active": True, "next_due_date": {"$lt": now}
    })

    return {
        "section": "MANAGER_OVERVIEW",
        "managed_estates": len(estates),
        "units":   {"total": total_units, "occupied": occupied_units, "vacant": total_units - occupied_units},
        "tenants": {"total": total_tenants, "overdue": overdue_tenants},
    }


# ── Vendor Overview ───────────────────────────────────────────────────────────

async def _vendor_overview(user_id) -> dict:
    wallet = await Wallet.find_one({"user_id": user_id})
    return {
        "section": "VENDOR_OVERVIEW",
        "wallet":  {"balance": wallet.balance if wallet else 0, "currency": "NGN"},
        "service_requests": {"pending": 0, "completed": 0},
    }


# ── Super Admin Overview ──────────────────────────────────────────────────────

async def _super_admin_overview() -> dict:
    ecoll  = Estate.get_motor_collection()
    ucoll  = Unit.get_motor_collection()
    tcoll  = Tenant.get_motor_collection()
    uscoll = User.get_motor_collection()
    pcoll  = Payment.get_motor_collection()

    total_estates  = await ecoll.count_documents({"is_active": True})
    total_units    = await ucoll.count_documents({"is_active": True})
    occupied_units = await ucoll.count_documents({"is_active": True, "status": "occupied"})
    total_tenants  = await tcoll.count_documents({"is_active": True})
    total_users    = await uscoll.count_documents({"is_active": True})

    # All-time revenue
    rev_agg = await pcoll.aggregate([
        {"$match": {"payment_status": "completed"}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    total_revenue = rev_agg[0]["total"] if rev_agg else 0

    # Outstanding
    out_agg = await tcoll.aggregate([
        {"$match": {"is_active": True}},
        {"$group": {"_id": None,
                    "rent": {"$sum": "$rent_outstanding"},
                    "service": {"$sum": "$service_charge_outstanding"}}}
    ]).to_list(1)
    outstanding = out_agg[0] if out_agg else {"rent": 0, "service": 0}

    now = datetime.utcnow()
    overdue_tenants = await tcoll.count_documents({"is_active": True, "next_due_date": {"$lt": now}})

    return {
        "section": "SUPER_ADMIN_OVERVIEW",
        "totals": {
            "estates":  total_estates,
            "units":    total_units,
            "occupied": occupied_units,
            "vacant":   total_units - occupied_units,
            "tenants":  total_tenants,
            "users":    total_users,
        },
        "occupancy_rate": round(occupied_units / total_units * 100, 1) if total_units else 0,
        "revenue": {
            "all_time": total_revenue,
            "currency": "NGN",
        },
        "outstanding": {
            "rent":    outstanding.get("rent", 0),
            "service": outstanding.get("service", 0),
            "total":   outstanding.get("rent", 0) + outstanding.get("service", 0),
        },
        "overdue_tenants": overdue_tenants,
    }
