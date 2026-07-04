import re
import logging
import secrets

import anthropic
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from typing import Optional
from pydantic import BaseModel

from models.user import User
from models.lead_page import LeadPage
from models.lead import Lead
from models.deal import Deal
from core.security import get_current_user
from core.database import get_db
from core.config import settings
from models.base import gen_uuid
from utils.time_utils import utcnow

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/lead-capture", tags=["Lead Capture"])
public_router = APIRouter(prefix="/public/lead-pages", tags=["Public Lead Pages"])

SONNET = "claude-sonnet-4-6"


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:80] or "page"


async def _unique_slug(db: AsyncSession, base: str) -> str:
    slug = base
    for _ in range(5):
        exists = (await db.execute(select(LeadPage.id).where(LeadPage.slug == slug))).scalar_one_or_none()
        if not exists:
            return slug
        slug = f"{base}-{secrets.token_hex(2)}"
    return f"{base}-{secrets.token_hex(4)}"


def _page_dict(p: LeadPage, *, include_private: bool) -> dict:
    d = {
        "id": p.id,
        "slug": p.slug,
        "title": p.title,
        "headline": p.headline,
        "subheadline": p.subheadline,
        "body": p.body,
        "cta_text": p.cta_text,
        "fields": p.fields,
        "thank_you_message": p.thank_you_message,
        "pixel_meta": p.pixel_meta,
        "pixel_google": p.pixel_google,
        "pixel_custom_html": p.pixel_custom_html,
        "published": p.published,
    }
    if include_private:
        d.update({
            "prompt": p.prompt,
            "deliverable_ai_prompt": p.deliverable_ai_prompt,
            "views": p.views,
            "submissions": p.submissions,
            "owner_id": p.owner_id,
            "created_at": p.created_at.isoformat(),
            "updated_at": p.updated_at.isoformat(),
        })
    return d


# ─── Owner-facing CRUD ──────────────────────────────────────────────────────────

class LeadPageCreate(BaseModel):
    title: str = "Untitled page"
    prompt: str = ""
    headline: str = ""
    subheadline: str = ""
    body: str = ""
    cta_text: str = "Get instant access"
    fields: list = [
        {"key": "name", "label": "Your name", "type": "text", "required": True},
        {"key": "email", "label": "Email", "type": "email", "required": True},
    ]
    deliverable_ai_prompt: Optional[str] = None
    thank_you_message: str = "Check your email — your resource is on the way."


class LeadPageUpdate(BaseModel):
    title: Optional[str] = None
    headline: Optional[str] = None
    subheadline: Optional[str] = None
    body: Optional[str] = None
    cta_text: Optional[str] = None
    fields: Optional[list] = None
    deliverable_ai_prompt: Optional[str] = None
    thank_you_message: Optional[str] = None
    pixel_meta: Optional[str] = None
    pixel_google: Optional[str] = None
    pixel_custom_html: Optional[str] = None
    published: Optional[bool] = None


@router.get("/pages")
async def list_lead_pages(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pages = (await db.execute(
        select(LeadPage).where(LeadPage.owner_id == str(current_user.id))
        .order_by(LeadPage.created_at.desc())
    )).scalars().all()
    return {"data": [_page_dict(p, include_private=True) for p in pages]}


@router.post("/pages", status_code=201)
async def create_lead_page(
    body: LeadPageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    slug = await _unique_slug(db, _slugify(body.title or body.prompt or "page"))
    page = LeadPage(id=gen_uuid(), owner_id=str(current_user.id), slug=slug, **body.model_dump())
    db.add(page)
    await db.commit()
    return {"message": "Page created", "id": page.id, "slug": page.slug}


@router.put("/pages/{page_id}")
async def update_lead_page(
    page_id: str,
    body: LeadPageUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    page = (await db.execute(
        select(LeadPage).where(LeadPage.id == page_id, LeadPage.owner_id == str(current_user.id))
    )).scalar_one_or_none()
    if not page:
        raise HTTPException(404, "Page not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(page, k, v)
    page.updated_at = utcnow()
    await db.commit()
    return {"message": "Page updated"}


@router.delete("/pages/{page_id}")
async def delete_lead_page(
    page_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    page = (await db.execute(
        select(LeadPage).where(LeadPage.id == page_id, LeadPage.owner_id == str(current_user.id))
    )).scalar_one_or_none()
    if not page:
        raise HTTPException(404, "Page not found")
    await db.delete(page)
    await db.commit()
    return {"message": "Page deleted"}


@router.get("/pages/{page_id}/leads")
async def list_leads_for_page(
    page_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    page = (await db.execute(
        select(LeadPage.id).where(LeadPage.id == page_id, LeadPage.owner_id == str(current_user.id))
    )).scalar_one_or_none()
    if not page:
        raise HTTPException(404, "Page not found")
    leads = (await db.execute(
        select(Lead).where(Lead.lead_page_id == page_id).order_by(Lead.created_at.desc())
    )).scalars().all()
    return {"data": [
        {"id": l.id, "data": l.data, "source": l.source, "utm": l.utm, "status": l.status,
         "created_at": l.created_at.isoformat()}
        for l in leads
    ]}


class LeadUpdate(BaseModel):
    status: str  # new | contacted | promoted | archived


@router.put("/leads/{lead_id}")
async def update_lead_status(
    lead_id: str,
    body: LeadUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lead = (await db.execute(
        select(Lead).where(Lead.id == lead_id, Lead.owner_id == str(current_user.id))
    )).scalar_one_or_none()
    if not lead:
        raise HTTPException(404, "Lead not found")

    lead.status = body.status

    # Promoting a lead creates a real Level 1 pipeline prospect from its
    # captured form data — the integration point the reference app never built.
    if body.status == "promoted" and not lead.promoted_deal_id:
        name = lead.data.get("name") or lead.data.get("email") or "Lead"
        deal = Deal(
            id=gen_uuid(), owner_id=str(current_user.id), pipeline="level1", stage="lead",
            client_name=name, client_email=lead.data.get("email"), client_phone=lead.data.get("phone"),
            title=f"From lead page: {name}", source="lead_page",
        )
        db.add(deal)
        lead.promoted_deal_id = deal.id

    await db.commit()
    return {"message": "Lead updated", "promoted_deal_id": lead.promoted_deal_id}


# ─── AI landing-page generation ─────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    prompt: str


GENERATE_TOOL = {
    "name": "generate_lead_page",
    "description": "Generate landing-page copy for a lead-capture page.",
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Internal page title, max 60 chars"},
            "headline": {"type": "string", "description": "Main headline, max 90 chars"},
            "subheadline": {"type": "string", "description": "Supporting subheadline, max 160 chars"},
            "body": {"type": "string", "description": "2-4 short paragraphs of persuasive body copy"},
            "cta_text": {"type": "string", "description": "Call-to-action button text, max 24 chars"},
            "fields": {
                "type": "array",
                "description": "Form fields, minimum name + email plus up to 2 qualifying questions",
                "items": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string"},
                        "label": {"type": "string"},
                        "type": {"type": "string", "enum": ["text", "email", "tel"]},
                        "required": {"type": "boolean"},
                    },
                    "required": ["key", "label", "type"],
                },
            },
            "deliverable_ai_prompt": {
                "type": "string",
                "description": "A prompt an AI could use to generate the promised deliverable for this lead magnet",
            },
        },
        "required": ["title", "headline", "subheadline", "body", "cta_text", "fields"],
    },
}


@router.post("/generate")
async def generate_lead_page(
    body: GenerateRequest,
    current_user: User = Depends(get_current_user),
):
    if not body.prompt or len(body.prompt) > 2000:
        raise HTTPException(400, "prompt must be 1-2000 characters")

    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    try:
        response = await client.messages.create(
            model=SONNET,
            max_tokens=1024,
            tools=[GENERATE_TOOL],
            tool_choice={"type": "tool", "name": "generate_lead_page"},
            messages=[{
                "role": "user",
                "content": (
                    "Write high-converting lead-capture landing page copy for this offer, "
                    "for a Nigerian small-business audience:\n\n" + body.prompt
                ),
            }],
        )
    except Exception as e:
        logger.error(f"generate_lead_page failed: {e}", exc_info=True)
        raise HTTPException(502, "AI generation failed — try again")

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if not tool_use:
        raise HTTPException(502, "AI did not return structured page content")

    page = tool_use.input
    page.setdefault("fields", [
        {"key": "name", "label": "Your name", "type": "text", "required": True},
        {"key": "email", "label": "Email", "type": "email", "required": True},
    ])
    return {"page": page}


# ─── Public: view + submit ──────────────────────────────────────────────────────

@public_router.get("/{slug}")
async def get_public_lead_page(slug: str, db: AsyncSession = Depends(get_db)):
    page = (await db.execute(
        select(LeadPage).where(LeadPage.slug == slug, LeadPage.published == True)  # noqa: E712
    )).scalar_one_or_none()
    if not page:
        raise HTTPException(404, "Page not found")
    await db.execute(
        update(LeadPage).where(LeadPage.id == page.id).values(views=LeadPage.views + 1)
    )
    await db.commit()
    return _page_dict(page, include_private=False)


class SubmitRequest(BaseModel):
    data: dict
    utm: dict = {}


@public_router.post("/{slug}/submit")
async def submit_lead(slug: str, body: SubmitRequest, request: Request, db: AsyncSession = Depends(get_db)):
    page = (await db.execute(
        select(LeadPage).where(LeadPage.slug == slug, LeadPage.published == True)  # noqa: E712
    )).scalar_one_or_none()
    if not page:
        raise HTTPException(404, "Page not available")

    # Sanitize: string values only, key/value length caps — no server-side
    # trust placed in anything the anonymous caller sends beyond this.
    clean_data = {}
    for k, v in (body.data or {}).items():
        if not isinstance(k, str) or len(k) > 60 or not isinstance(v, str):
            continue
        clean_data[k] = v[:500]
    clean_utm = {k: str(v)[:200] for k, v in (body.utm or {}).items() if isinstance(k, str)}

    lead = Lead(
        id=gen_uuid(),
        owner_id=page.owner_id,          # derived from the page — never from the request
        lead_page_id=page.id,
        data=clean_data,
        source="lead_page",
        utm=clean_utm,
        user_agent=request.headers.get("user-agent", "")[:500],
    )
    db.add(lead)
    await db.execute(
        update(LeadPage).where(LeadPage.id == page.id).values(submissions=LeadPage.submissions + 1)
    )
    await db.commit()
    return {"ok": True}
