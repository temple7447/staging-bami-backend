from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import Optional
from pydantic import BaseModel
from datetime import datetime

from models.user import User
from models.brand_asset import BrandAsset
from core.security import get_current_user
from core.database import get_db
from models.base import gen_uuid

router = APIRouter(prefix="/brand", tags=["Brand & Design"])


class BrandAssetCreate(BaseModel):
    asset_type: str
    name: str
    description: Optional[str] = None
    url: Optional[str] = None
    public_id: Optional[str] = None
    file_type: Optional[str] = None
    extra_data: dict = {}
    category: Optional[str] = None
    tags: list = []


class BrandAssetUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    url: Optional[str] = None
    extra_data: Optional[dict] = None
    category: Optional[str] = None
    tags: Optional[list] = None
    is_active: Optional[str] = None


@router.get("/assets")
async def list_brand_assets(
    asset_type: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = select(BrandAsset).where(BrandAsset.owner_id == current_user.id)
    if asset_type:
        q = q.where(BrandAsset.asset_type == asset_type)
    if category:
        q = q.where(BrandAsset.category == category)
    q = q.order_by(BrandAsset.asset_type, BrandAsset.created_at.desc())
    result = await db.execute(q)
    assets = result.scalars().all()

    # Group by asset_type for easier frontend consumption
    grouped: dict[str, list] = {}
    for a in assets:
        grouped.setdefault(a.asset_type, []).append({
            "id": a.id, "name": a.name, "description": a.description,
            "url": a.url, "file_type": a.file_type, "extra_data": a.extra_data,
            "category": a.category, "tags": a.tags, "is_active": a.is_active,
            "created_at": a.created_at.isoformat(),
        })

    return {"data": grouped, "total": len(assets)}


@router.post("/assets", status_code=201)
async def create_brand_asset(
    body: BrandAssetCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    asset = BrandAsset(
        id=gen_uuid(),
        owner_id=current_user.id,
        **body.model_dump(),
    )
    db.add(asset)
    await db.commit()
    return {"message": "Asset created", "id": asset.id}


@router.put("/assets/{asset_id}")
async def update_brand_asset(
    asset_id: str,
    body: BrandAssetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(BrandAsset).where(BrandAsset.id == asset_id, BrandAsset.owner_id == current_user.id)
    )
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(404, "Asset not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(asset, k, v)
    asset.updated_at = datetime.utcnow()
    await db.commit()
    return {"message": "Asset updated"}


@router.delete("/assets/{asset_id}")
async def delete_brand_asset(
    asset_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(BrandAsset).where(BrandAsset.id == asset_id, BrandAsset.owner_id == current_user.id)
    )
    asset = result.scalar_one_or_none()
    if not asset:
        raise HTTPException(404, "Asset not found")
    await db.delete(asset)
    await db.commit()
    return {"message": "Asset deleted"}


@router.get("/summary")
async def brand_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(BrandAsset).where(BrandAsset.owner_id == current_user.id, BrandAsset.is_active == "true")
    )
    assets = result.scalars().all()
    counts: dict[str, int] = {}
    for a in assets:
        counts[a.asset_type] = counts.get(a.asset_type, 0) + 1

    return {
        "total_assets": len(assets),
        "by_type": counts,
        "has_logo": counts.get("logo", 0) > 0,
        "has_color_palette": counts.get("color", 0) > 0,
        "has_typography": counts.get("font", 0) > 0,
    }
