"""
Shared image generation — Google Gemini 2.5 Flash Image ("Nano Banana") + Cloudinary.

Used by both the Brand Studio (logo generation) and the background Designer agent
(marketing graphics). Fails soft: returns None when not configured or on error, so
callers can degrade gracefully (e.g. post text-only).
"""
import base64
import logging

import httpx
import cloudinary
import cloudinary.uploader

from core.config import settings

logger = logging.getLogger(__name__)

GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image"
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_IMAGE_MODEL}:generateContent"
)


def is_image_gen_configured() -> bool:
    return bool(settings.GEMINI_API_KEY and settings.CLOUDINARY_CLOUD_NAME)


async def generate_image_bytes(prompt: str) -> bytes | None:
    """Generate an image from a text prompt via Gemini. Returns raw bytes or None."""
    if not settings.GEMINI_API_KEY:
        logger.warning("[IMAGE_GEN] GEMINI_API_KEY not set — skipping image generation")
        return None

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["IMAGE"]},
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                GEMINI_URL, params={"key": settings.GEMINI_API_KEY}, json=payload,
            )
        if resp.status_code != 200:
            logger.error("[IMAGE_GEN] Gemini %s: %s", resp.status_code, resp.text[:300])
            return None
        data = resp.json()
        for cand in data.get("candidates", []):
            for part in cand.get("content", {}).get("parts", []):
                inline = part.get("inlineData") or part.get("inline_data")
                if inline and inline.get("data"):
                    return base64.b64decode(inline["data"])
        logger.error("[IMAGE_GEN] Gemini returned no image part")
        return None
    except Exception as e:
        logger.error("[IMAGE_GEN] generation failed: %s", e)
        return None


def upload_image_bytes(img_bytes: bytes, folder: str) -> dict | None:
    """Upload image bytes to Cloudinary. Returns {url, public_id, file_type} or None."""
    if not settings.CLOUDINARY_CLOUD_NAME:
        logger.warning("[IMAGE_GEN] Cloudinary not configured — cannot store image")
        return None
    cloudinary.config(
        cloud_name=settings.CLOUDINARY_CLOUD_NAME,
        api_key=settings.CLOUDINARY_API_KEY,
        api_secret=settings.CLOUDINARY_API_SECRET,
    )
    try:
        result = cloudinary.uploader.upload(img_bytes, folder=folder, resource_type="image")
        return {
            "url": result["secure_url"],
            "public_id": result["public_id"],
            "file_type": result.get("format"),
        }
    except Exception as e:
        logger.error("[IMAGE_GEN] upload failed: %s", e)
        return None


async def generate_and_store(prompt: str, folder: str) -> dict | None:
    """Generate an image and store it on Cloudinary in one call. Returns {url,...} or None."""
    img = await generate_image_bytes(prompt)
    if not img:
        return None
    return upload_image_bytes(img, folder)
