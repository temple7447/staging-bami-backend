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
from middleware.logging import logging_middleware

# ── Logging setup ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("bamihustle")

# ── Rate limiter ──────────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address, default_limits=["200/15minutes"])


# ── Lifespan (startup / shutdown) ─────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db(app)
    logger.info("BamiHustle FastAPI server started")
    yield
    await disconnect_db()
    logger.info("BamiHustle FastAPI server stopped")


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.API_VERSION,
    docs_url="/api-docs",
    redoc_url="/api-redoc",
    lifespan=lifespan,
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
        "message": "BamiHustle Backend API (FastAPI)",
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
