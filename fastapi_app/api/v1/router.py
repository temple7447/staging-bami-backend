from fastapi import APIRouter
from api.v1.endpoints import auth, estates, units, tenants, dashboard
from api.v1.endpoints import wallet, billing, payments
from api.v1.endpoints import notifications, issues, service_requests, enquiries, feedback
from api.v1.endpoints import subscriptions, withdrawals, misc, distribution, wallets, meters, billionaire
from api.v1.endpoints import coach
from api.v1.endpoints import brand, marketing, sales, operations, finance, hr
from api.v1.endpoints import autopilot
from api.v1.endpoints import scale
from api.v1.endpoints import growth
from api.v1.endpoints import personal_finance
from api.v1.endpoints import lead_capture
from api.v1.endpoints import ops_manager
from api.v1.endpoints import head_office
from api.v1.endpoints import google
from api.v1.endpoints import google_workspace
from api.v1.endpoints import integrations

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
api_router.include_router(feedback.router)
api_router.include_router(subscriptions.router)
api_router.include_router(withdrawals.router)
api_router.include_router(misc.router)
api_router.include_router(distribution.router)
api_router.include_router(wallets.router)
api_router.include_router(meters.router)
api_router.include_router(billionaire.router)
api_router.include_router(coach.router)
# ── Business Skills ────────────────────────────────────────────────────────────
api_router.include_router(brand.router)
api_router.include_router(marketing.router)
api_router.include_router(sales.router)
api_router.include_router(operations.router)
api_router.include_router(finance.router)
api_router.include_router(hr.router)
api_router.include_router(autopilot.router)
api_router.include_router(scale.router)
api_router.include_router(growth.router)
api_router.include_router(personal_finance.router)
api_router.include_router(lead_capture.router)
api_router.include_router(lead_capture.public_router)
api_router.include_router(ops_manager.router)
api_router.include_router(head_office.router)
api_router.include_router(google.router)
api_router.include_router(google_workspace.router)
api_router.include_router(integrations.router)
