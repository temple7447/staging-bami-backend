from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import event
from core.config import settings
from models.base import Base
import logging

logger = logging.getLogger(__name__)

DB_PATH = "bamihustle.db"
DATABASE_URL = f"sqlite+aiosqlite:///{DB_PATH}"

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def connect_db(app=None):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("SQLite database ready — tables created/verified")


async def disconnect_db():
    await engine.dispose()
    logger.info("Database connection closed")


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
