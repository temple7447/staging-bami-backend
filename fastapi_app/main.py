import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from core.config import settings
from core.database import connect_db, disconnect_db
from api.v1.router import api_router

# Import all models so SQLAlchemy registers them before create_all
import models.user, models.estate, models.unit, models.tenant  # noqa: F401
import models.payment, models.wallet, models.wallet_account, models.transaction  # noqa: F401
import models.notification, models.issue, models.billing_item  # noqa: F401
import models.subscription, models.service_request, models.rental_application  # noqa: F401
import models.enquiry, models.bank_deposit, models.withdrawal  # noqa: F401
import models.business_type, models.visit, models.reminder_log, models.setting  # noqa: F401
import models.meter_device, models.meter_reading, models.billionaire  # noqa: F401
import models.coach  # noqa: F401
import models.tenant_telegram  # noqa: F401
import models.brand_asset, models.campaign, models.deal  # noqa: F401
import models.vendor, models.candidate  # noqa: F401
import models.autopilot_action, models.autopilot_settings  # noqa: F401
import models.owner_finance_plan  # noqa: F401
import models.growth_plan  # noqa: F401
import models.personal_finance  # noqa: F401
import models.playbook  # noqa: F401
import models.instruction, models.voice_note  # noqa: F401
import models.model10_entry  # noqa: F401
import models.lead_page, models.lead  # noqa: F401
import models.ops_thread, models.ops_report, models.integration  # noqa: F401
from middleware.logging import logging_middleware
from middleware.camelize import camelize_response_middleware

# ── Logging setup ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("bamihost")

# ── Rate limiter ──────────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address, default_limits=["200/15minutes"])


# ── Lifespan (startup / shutdown) ─────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db(app)
    from utils.scheduler import start_scheduler, stop_scheduler
    start_scheduler()
    logger.info("BamiHost FastAPI server started")
    yield
    stop_scheduler()
    await disconnect_db()
    logger.info("BamiHost FastAPI server stopped")


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.API_VERSION,
    docs_url="/api-docs",
    redoc_url="/api-redoc",
    lifespan=lifespan,
    redirect_slashes=False,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With", "Accept", "X-Request-ID"],
)

# Request logging
app.middleware("http")(logging_middleware)

# Convert all JSON response keys from snake_case to camelCase
app.middleware("http")(camelize_response_middleware)

# Routes
app.include_router(api_router)


# ── Health endpoints ──────────────────────────────────────────────────────────
@app.get("/health", tags=["Health"])
async def health():
    return {"success": True, "status": "healthy", "version": settings.API_VERSION}


@app.get("/health/ready", tags=["Health"])
async def ready():
    return {"ready": True}


@app.get("/health/live", tags=["Health"])
async def live():
    return {"alive": True}


@app.get("/", tags=["Root"])
async def root():
    return {
        "success": True,
        "message": "BamiHost Backend API (FastAPI)",
        "version": settings.API_VERSION,
        "documentation": "/api-docs",
        "endpoints": {
            "auth":   "/api/auth",
            "health": "/health",
        },
    }


# ── Global error handler ──────────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"success": False, "message": "An unexpected error occurred"},
    )
