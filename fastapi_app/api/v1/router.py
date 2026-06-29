from fastapi import APIRouter
from api.v1.endpoints import auth, estates, units, tenants, dashboard
from api.v1.endpoints import wallet, billing, payments
from api.v1.endpoints import notifications, issues, service_requests, enquiries
from api.v1.endpoints import subscriptions, withdrawals, misc, distribution, wallets, meters, billionaire
from api.v1.endpoints import coach

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
api_router.include_router(subscriptions.router)
api_router.include_router(withdrawals.router)
api_router.include_router(misc.router)
api_router.include_router(distribution.router)
api_router.include_router(wallets.router)
api_router.include_router(meters.router)
api_router.include_router(billionaire.router)
api_router.include_router(coach.router)
