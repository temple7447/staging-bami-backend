from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from core.config import settings
from models.base import Base
import logging
import ssl

logger = logging.getLogger(__name__)

def _normalize_db_url(raw: str) -> str:
    """Accept raw Postgres/Neon connection strings and make them async-driver ready.

    - `postgres://` / `postgresql://`  ->  `postgresql+asyncpg://`
    - strips `sslmode` / `channel_binding` query params (asyncpg rejects them;
      SSL is supplied via connect_args below instead).
    """
    url = raw.strip()
    if url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]

    if "+asyncpg" in url and "?" in url:
        base, query = url.split("?", 1)
        kept = [
            kv for kv in query.split("&")
            if kv and kv.split("=", 1)[0].lower() not in ("sslmode", "channel_binding")
        ]
        url = base + ("?" + "&".join(kept) if kept else "")
    return url


DATABASE_URL = _normalize_db_url(settings.DATABASE_URL)

# Build engine kwargs based on the driver
_is_postgres = DATABASE_URL.startswith("postgresql")

if _is_postgres:
    # Verified TLS: check the server cert and hostname. certifi supplies the
    # CA bundle because the interpreter may lack a wired-up system store.
    import certifi
    _ssl_ctx = ssl.create_default_context(cafile=certifi.where())
    engine = create_async_engine(
        DATABASE_URL,
        echo=False,
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,
        connect_args={"ssl": _ssl_ctx},
    )
else:
    engine = create_async_engine(DATABASE_URL, echo=False)

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def connect_db(app=None):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # One-time, idempotent backfill: business-owner access is now strictly
        # Estate.owner-based, so any legacy estate with no owner must inherit its
        # creator or it would vanish from that owner's dashboard. A no-op once done.
        from sqlalchemy import text
        await conn.execute(text(
            "UPDATE estates SET owner = created_by "
            "WHERE owner IS NULL AND created_by IS NOT NULL"
        ))
    db_type = "PostgreSQL (Neon)" if _is_postgres else "SQLite"
    logger.info(f"{db_type} database ready — tables created/verified")


async def disconnect_db():
    await engine.dispose()
    logger.info("Database connection closed")


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
