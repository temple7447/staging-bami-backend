from fastapi import APIRouter
from api.v1.endpoints import auth, estates, units

api_router = APIRouter(prefix="/api")

api_router.include_router(auth.router)
api_router.include_router(estates.router)
api_router.include_router(units.router)

# ── Remaining routers — uncomment as each phase is complete ──────────────────
# from api.v1.endpoints import tenants, payments, billing
# from api.v1.endpoints import wallet, dashboard, notifications, issues
# from api.v1.endpoints import subscriptions, service_requests, withdrawals
# from api.v1.endpoints import rental_applications, enquiries, bank_deposits
# from api.v1.endpoints import business_types, upload, vendor_manager_payout

# api_router.include_router(estates.router)
# api_router.include_router(units.router)
# api_router.include_router(tenants.router)
# api_router.include_router(payments.router)
# api_router.include_router(billing.router)
# api_router.include_router(wallet.router)
# api_router.include_router(dashboard.router)
# api_router.include_router(notifications.router)
# api_router.include_router(issues.router)
