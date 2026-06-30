import json
import logging

import anthropic
import cloudinary
import cloudinary.uploader
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import Optional
from pydantic import BaseModel
from datetime import datetime

from models.user import User
from models.brand_asset import BrandAsset
from core.security import get_current_user
from core.database import get_db
from core.config import settings
from models.base import gen_uuid

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/brand", tags=["Brand & Design"])

SONNET = "claude-sonnet-4-6"


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
    is_active: Optional[bool] = None


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
        select(BrandAsset).where(BrandAsset.owner_id == current_user.id, BrandAsset.is_active == True)  # noqa: E712
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


# ─── AI Brand Studio ──────────────────────────────────────────────────────────

class BrandGenerateRequest(BaseModel):
    business_description: str
    vibe: Optional[str] = None   # e.g. "premium", "friendly", "modern"


BRAND_SYSTEM = (
    "You are an expert brand designer for Nigerian businesses, especially property "
    "and real-estate brands. Given a business description, design a complete, cohesive "
    "brand identity. Respond with STRICT JSON only — no markdown, no commentary.\n\n"
    "JSON shape:\n"
    "{\n"
    '  "brand_name_ideas": [3 short name ideas as strings],\n'
    '  "tagline": "one memorable tagline",\n'
    '  "colors": [\n'
    '    {"name": "Primary", "hex": "#RRGGBB", "use": "short usage note"},\n'
    '    {"name": "Accent", "hex": "#RRGGBB", "use": "..."},\n'
    '    {"name": "Neutral", "hex": "#RRGGBB", "use": "..."}\n'
    "  ],\n"
    '  "fonts": {"heading": "Font Name", "body": "Font Name", "note": "why this pairing"},\n'
    '  "voice": [3 brand-voice adjectives],\n'
    '  "logo_concepts": [2 short text descriptions of logo directions]\n'
    "}\n\n"
    "Rules: choose real, web-safe / Google Fonts. Hex codes must be valid 6-digit. "
    "Colours must work together (1 primary, 1 accent, 1 light neutral). Keep all text concise."
)


@router.post("/generate")
async def generate_brand_identity(
    body: BrandGenerateRequest,
    current_user: User = Depends(get_current_user),
):
    """Use AI to generate a complete brand identity from a business description."""
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(503, "AI is not configured")

    vibe = f" The desired vibe is: {body.vibe}." if body.vibe else ""
    prompt = (
        f"Business: {body.business_description}.{vibe}\n"
        "Design the complete brand identity now. Return JSON only."
    )

    try:
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        resp = await client.messages.create(
            model=SONNET,
            max_tokens=1024,
            system=BRAND_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.content[0].text.strip()
        # Strip accidental code fences
        if raw.startswith("```"):
            raw = raw.split("```", 2)[1].lstrip("json").strip()
        identity = json.loads(raw)
    except json.JSONDecodeError:
        logger.error("Brand AI returned non-JSON: %s", raw[:300])
        raise HTTPException(502, "AI returned an unexpected format. Try again.")
    except Exception as e:
        logger.error("Brand generation error: %s", e)
        raise HTTPException(502, f"AI generation failed: {e}")

    return {"identity": identity}


class SaveIdentityRequest(BaseModel):
    tagline: Optional[str] = None
    colors: list[dict] = []          # [{name, hex, use}]
    fonts: Optional[dict] = None     # {heading, body, note}
    voice: list[str] = []


@router.post("/save-identity", status_code=201)
async def save_brand_identity(
    body: SaveIdentityRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Persist an AI-generated identity as individual brand assets in one click."""
    created = 0

    for c in body.colors:
        hexval = (c.get("hex") or "").strip()
        if not hexval:
            continue
        db.add(BrandAsset(
            id=gen_uuid(), owner_id=current_user.id, asset_type="color",
            name=c.get("name") or hexval, description=c.get("use"),
            extra_data={"hex": hexval}, category="ai-generated",
        ))
        created += 1

    if body.fonts:
        for role in ("heading", "body"):
            fam = (body.fonts.get(role) or "").strip()
            if not fam:
                continue
            db.add(BrandAsset(
                id=gen_uuid(), owner_id=current_user.id, asset_type="font",
                name=fam, description=f"{role.title()} font — {body.fonts.get('note', '')}".strip(" —"),
                category=role,
            ))
            created += 1

    if body.tagline:
        db.add(BrandAsset(
            id=gen_uuid(), owner_id=current_user.id, asset_type="tagline",
            name=body.tagline, description="AI-generated tagline",
            extra_data={"voice": body.voice}, category="ai-generated",
        ))
        created += 1

    await db.commit()
    return {"message": "Brand identity saved", "created": created}


# ─── AI Logo generation (Google Gemini "Nano Banana") ─────────────────────────

GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image"
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_IMAGE_MODEL}:generateContent"
)


class LogoGenerateRequest(BaseModel):
    business_description: str
    brand_name: Optional[str] = None
    vibe: Optional[str] = None
    colors: list[dict] = []          # [{name, hex, use}]
    style: Optional[str] = "minimal vector emblem"   # mark style hint


def _logo_prompt(body: LogoGenerateRequest) -> str:
    palette = ", ".join(
        f"{c.get('name', '')} {c.get('hex', '')}".strip() for c in body.colors if c.get("hex")
    ) or "a cohesive, professional palette"
    name = body.brand_name or "the business"
    return (
        f"A professional, modern logo for '{name}', a Nigerian business: {body.business_description}. "
        f"Style: {body.style}, {body.vibe or 'premium'}, clean, memorable, scalable. "
        f"Use this colour palette: {palette}. "
        "Centered icon/emblem on a plain white background, high contrast, no photographic elements, "
        "no watermark, flat vector look. If text is included, render the brand name cleanly and correctly spelled."
    )


@router.post("/generate-logo")
async def generate_logo(
    body: LogoGenerateRequest,
    current_user: User = Depends(get_current_user),
):
    """Generate a logo image with Google Gemini 2.5 Flash Image (Nano Banana),
    then store it on Cloudinary and return the URL."""
    if not settings.GEMINI_API_KEY:
        raise HTTPException(503, "Image generation is not configured (missing GEMINI_API_KEY)")

    import base64
    import httpx

    payload = {
        "contents": [{"parts": [{"text": _logo_prompt(body)}]}],
        # Ask Gemini to return an image
        "generationConfig": {"responseModalities": ["IMAGE"]},
    }

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                GEMINI_URL,
                params={"key": settings.GEMINI_API_KEY},
                json=payload,
            )
        if resp.status_code != 200:
            logger.error("Gemini logo error %s: %s", resp.status_code, resp.text[:400])
            raise HTTPException(502, "Image model rejected the request. Try a simpler description.")
        data = resp.json()

        # Pull the first inline image part out of the response
        img_b64 = None
        for cand in data.get("candidates", []):
            for part in cand.get("content", {}).get("parts", []):
                inline = part.get("inlineData") or part.get("inline_data")
                if inline and inline.get("data"):
                    img_b64 = inline["data"]
                    break
            if img_b64:
                break
        if not img_b64:
            logger.error("Gemini returned no image: %s", json.dumps(data)[:400])
            raise HTTPException(502, "No image was returned. Try again.")

        img_bytes = base64.b64decode(img_b64)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Logo generation failed: %s", e)
        raise HTTPException(502, f"Logo generation failed: {e}")

    # Store on Cloudinary so the URL is permanent
    if not settings.CLOUDINARY_CLOUD_NAME:
        raise HTTPException(503, "File storage is not configured")
    cloudinary.config(
        cloud_name=settings.CLOUDINARY_CLOUD_NAME,
        api_key=settings.CLOUDINARY_API_KEY,
        api_secret=settings.CLOUDINARY_API_SECRET,
    )
    try:
        result = cloudinary.uploader.upload(
            img_bytes, folder=f"bamihustle/brand/{current_user.id}/logos", resource_type="image",
        )
    except Exception as e:
        logger.error("Logo upload failed: %s", e)
        raise HTTPException(502, "Generated the logo but could not store it. Try again.")

    return {"url": result["secure_url"], "public_id": result["public_id"], "file_type": result.get("format")}


# ─── File upload (Cloudinary) ─────────────────────────────────────────────────

@router.post("/upload")
async def upload_brand_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Upload a logo/image/document to Cloudinary and return its URL."""
    if not settings.CLOUDINARY_CLOUD_NAME:
        raise HTTPException(503, "File storage is not configured")

    cloudinary.config(
        cloud_name=settings.CLOUDINARY_CLOUD_NAME,
        api_key=settings.CLOUDINARY_API_KEY,
        api_secret=settings.CLOUDINARY_API_SECRET,
    )
    try:
        buffer = await file.read()
        result = cloudinary.uploader.upload(
            buffer, folder=f"bamihustle/brand/{current_user.id}", resource_type="auto",
        )
    except Exception as e:
        logger.error("Brand upload failed: %s", e)
        raise HTTPException(502, "Upload failed. Try a different file.")

    return {
        "url": result["secure_url"],
        "public_id": result["public_id"],
        "file_type": result.get("format"),
    }
