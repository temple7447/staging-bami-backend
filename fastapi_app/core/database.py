from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from core.config import settings
from models.base import Base
import logging
import ssl

logger = logging.getLogger(__name__)

DATABASE_URL = settings.DATABASE_URL

# Build engine kwargs based on the driver
_is_postgres = DATABASE_URL.startswith("postgresql")

if _is_postgres:
    _ssl_ctx = ssl.create_default_context()
    _ssl_ctx.check_hostname = False
    _ssl_ctx.verify_mode = ssl.CERT_NONE
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
    db_type = "PostgreSQL (Neon)" if _is_postgres else "SQLite"
    logger.info(f"{db_type} database ready — tables created/verified")


async def disconnect_db():
    await engine.dispose()
    logger.info("Database connection closed")


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
