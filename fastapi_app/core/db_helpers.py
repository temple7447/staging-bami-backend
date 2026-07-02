from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, and_
from typing import Type, TypeVar, Optional, List, Any
from datetime import datetime
from utils.time_utils import utcnow

T = TypeVar("T")


async def get_by_id(db: AsyncSession, model: Type[T], id: str) -> Optional[T]:
    return await db.get(model, str(id))


async def find_one(db: AsyncSession, model: Type[T], *conditions) -> Optional[T]:
    result = await db.execute(select(model).where(*conditions))
    return result.scalar_one_or_none()


async def find_all(
    db: AsyncSession,
    model: Type[T],
    *conditions,
    order_by=None,
    skip: int = 0,
    limit: Optional[int] = None,
) -> List[T]:
    stmt = select(model)
    if conditions:
        stmt = stmt.where(*conditions)
    if order_by is not None:
        stmt = stmt.order_by(order_by)
    if skip:
        stmt = stmt.offset(skip)
    if limit is not None:
        stmt = stmt.limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def count(db: AsyncSession, model: Type[T], *conditions) -> int:
    stmt = select(func.count()).select_from(model)
    if conditions:
        stmt = stmt.where(*conditions)
    result = await db.execute(stmt)
    return result.scalar() or 0


async def sum_col(db: AsyncSession, model: Type[T], column, *conditions) -> float:
    stmt = select(func.coalesce(func.sum(column), 0)).select_from(model)
    if conditions:
        stmt = stmt.where(*conditions)
    result = await db.execute(stmt)
    return float(result.scalar() or 0)


async def save(db: AsyncSession, obj: T) -> T:
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


async def soft_delete(db: AsyncSession, obj: T, user_id: str = None) -> T:
    obj.is_active = False
    obj.updated_at = utcnow()
    if user_id and hasattr(obj, "updated_by"):
        obj.updated_by = user_id
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


def to_dict(obj) -> dict:
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}
