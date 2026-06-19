from fastapi import APIRouter
from api.v1.endpoints import auth, estates, units, tenants, dashboard
from api.v1.endpoints import wallet, billing, payments
from api.v1.endpoints import notifications, issues, service_requests, enquiries

api_router = APIRouter(prefix="/api")

api_router.include_router(auth.router)
api_router.include_router(estates.router)
api_router.include_router(units.router)
api_router.include_router(tenants.router)
api_router.include_router(dashboard.router)
api_router.include_router(wallet.router)
api_router.include_router(billing.router)
api_router.include_router(payments.router)
api_router.include_router(notifications.router)
api_router.include_router(issues.router)
api_router.include_router(service_requests.router)
api_router.include_router(enquiries.router)

# ── Remaining routers — uncomment as each phase is complete ──────────────────
# from api.v1.endpoints import subscriptions, withdrawals
# from api.v1.endpoints import rental_applications, bank_deposits
# from api.v1.endpoints import business_types, upload, vendor_manager_payout
