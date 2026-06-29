"""
Event hooks — called after key mutations to trigger AI autopilot actions.
Every important business event flows through fire_event().
"""
import logging
import asyncio
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from models.autopilot_action import AutopilotAction
from models.user import User
from models.base import gen_uuid

logger = logging.getLogger(__name__)


async def _ai_content(system: str, prompt: str, max_tokens: int = 300) -> str:
    """Generate AI content using Claude Haiku for speed."""
    try:
        import anthropic
        from core.config import settings
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        resp = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.content[0].text.strip() if resp.content else ""
    except Exception as e:
        logger.warning(f"[EVENT_HOOK] AI content failed: {e}")
        return ""


def _make_action(owner_id: str, skill: str, action_type: str, title: str,
                 description: str, content: str | None, platform: str | None,
                 event: str, context: dict, priority: str = "medium",
                 recipients: list | None = None) -> AutopilotAction:
    return AutopilotAction(
        id=gen_uuid(),
        owner_id=owner_id,
        skill=skill,
        action_type=action_type,
        title=title,
        description=description,
        content=content,
        platform=platform,
        trigger_event=event,
        trigger_context=context,
        priority=priority,
        recipients=recipients or [],
        auto_execute=False,
        created_at=datetime.utcnow(),
    )


async def fire_event(event: str, owner_id: str, context: dict, db: AsyncSession) -> None:
    """
    Fire an AI event. Generates autopilot actions asynchronously.
    Never raises — failures are logged silently so they don't break the main request.
    """
    try:
        actions = await _handle_event(event, owner_id, context, db)
        for a in actions:
            db.add(a)

        # Push in-app notifications for high-priority actions
        if owner_id:
            from models.notification import Notification
            EVENT_LABELS = {
                "new_enquiry": "New Enquiry",
                "issue_reported": "Issue Reported",
                "tenant_overdue": "Overdue Rent",
                "lease_expiring": "Lease Expiring",
                "vacancy_opened": "Vacancy Opened",
                "new_property_listed": "Property Listed",
            }
            label = EVENT_LABELS.get(event, event.replace("_", " ").title())
            high_actions = [a for a in actions if a.priority == "high"]
            for a in high_actions:
                db.add(Notification(
                    id=gen_uuid(),
                    user=owner_id,
                    title=f"AI Action: {a.title[:80]}",
                    message=a.description[:255] if a.description else label,
                    type="autopilot",
                    link="/dashboard/autopilot",
                ))

        await db.commit()
        logger.info(f"[EVENT_HOOK] {event} → {len(actions)} action(s) queued for {owner_id}")
    except Exception as e:
        logger.error(f"[EVENT_HOOK] fire_event({event}) failed: {e}")


async def _handle_event(event: str, owner_id: str, context: dict, db: AsyncSession | None = None) -> list[AutopilotAction]:
    """Route event to the right handler and return generated actions."""

    handlers = {
        "new_tenant":           (_on_new_tenant, False),
        "vacancy_opened":       (_on_vacancy_opened, False),
        "new_enquiry":          (_on_new_enquiry, True),      # needs db to save lead score
        "issue_reported":       (_on_issue_reported, True),   # needs db for vendor lookup
        "payment_received":     (_on_payment_received, False),
        "tenant_overdue":       (_on_tenant_overdue, False),
        "new_property_listed":  (_on_new_property_listed, False),
        "lease_expiring":       (_on_lease_expiring, False),
    }

    entry = handlers.get(event)
    if not entry:
        logger.warning(f"[EVENT_HOOK] No handler for event: {event}")
        return []

    handler, needs_db = entry
    if needs_db:
        return await handler(owner_id, context, db)
    return await handler(owner_id, context)


# ─── Event Handlers ────────────────────────────────────────────────────────────

async def _on_new_tenant(owner_id: str, ctx: dict) -> list[AutopilotAction]:
    name     = ctx.get("tenant_name", "New tenant")
    unit     = ctx.get("unit_label", "")
    estate   = ctx.get("estate_name", "")

    welcome_msg = await _ai_content(
        "You are a Nigerian property manager. Write a short, warm WhatsApp welcome message to a new tenant. "
        "Max 3 sentences. Be friendly, professional. Mention their unit.",
        f"Tenant: {name}, Unit: {unit}, Estate: {estate}. Write welcome message."
    )
    return [
        _make_action(owner_id, "sales", "welcome_message",
                     f"Welcome {name} to {unit}",
                     "Send a warm welcome message to your new tenant.",
                     welcome_msg, "telegram", "new_tenant", ctx, "high",
                     recipients=[{"name": name, "phone": ctx.get("phone", ""), "email": ctx.get("email", "")}]),
        _make_action(owner_id, "finance", "internal_note",
                     f"Finance: {name} move-in recorded",
                     "Update your cash flow projection — new recurring revenue added.",
                     f"New tenant {name} at {unit} ({estate}). Monthly rent: {ctx.get('rent', 'TBD')}. "
                     "Update your revenue forecast and confirm first payment due date.",
                     "internal", "new_tenant", ctx, "medium"),
    ]


async def _on_vacancy_opened(owner_id: str, ctx: dict) -> list[AutopilotAction]:
    unit   = ctx.get("unit_label", "unit")
    estate = ctx.get("estate_name", "estate")
    price  = ctx.get("price", "")

    wa_blast = await _ai_content(
        "You are a Nigerian property marketer. Write a 3-line WhatsApp broadcast message for a vacant property. "
        "Plain text. Conversational. Add urgency.",
        f"Unit: {unit}, Estate: {estate}, Price: {price}. Write the broadcast."
    )
    ig_caption = await _ai_content(
        "Write an Instagram caption for a Nigerian property listing. Use emojis. Add 5 hashtags. CTA at end. Max 100 words.",
        f"Unit: {unit}, Estate: {estate}, Price: {price}."
    )
    return [
        _make_action(owner_id, "marketer", "whatsapp_blast",
                     f"Vacancy alert — {unit}, {estate}",
                     "Blast your contacts about this vacant unit immediately.",
                     wa_blast, "telegram", "vacancy_opened", ctx, "high"),
        _make_action(owner_id, "marketer", "instagram_post",
                     f"Instagram post — {unit}, {estate}",
                     "Post this caption on Instagram with property photos.",
                     ig_caption, "instagram", "vacancy_opened", ctx, "medium"),
    ]


async def _on_new_enquiry(owner_id: str, ctx: dict, db: AsyncSession | None = None) -> list[AutopilotAction]:
    prospect    = ctx.get("name", "Prospect")
    interest    = ctx.get("unit_interest", "") or ctx.get("subject", "a property")
    phone       = ctx.get("phone", "")
    enquiry_id  = ctx.get("enquiry_id")

    follow_up, score_text = await asyncio.gather(
        _ai_content(
            "You are a Nigerian property sales consultant. Write a warm WhatsApp follow-up to a property enquiry. "
            "Max 3 sentences. Offer to schedule a viewing. Be friendly and professional.",
            f"Prospect: {prospect}, interested in: {interest}. Write follow-up message."
        ),
        _ai_content(
            "You are a sales expert. Score this lead 1-10 for likelihood to convert. "
            "Reply with ONLY a JSON object: {\"score\": 7, \"reason\": \"...\"}",
            f"Enquiry from: {prospect}, interest: {interest}, phone: {'yes' if phone else 'no'}.",
            max_tokens=80
        ),
    )

    # Parse score and save back to the enquiry record
    if enquiry_id and db is not None and score_text:
        try:
            import json, re
            raw = score_text.strip()
            match = re.search(r'\{.*\}', raw, re.DOTALL)
            if match:
                parsed = json.loads(match.group())
                score_val = float(parsed.get("score", 0))
                score_reason = parsed.get("reason", "")
                from models.enquiry import Enquiry
                enq = (await db.execute(
                    select(Enquiry).where(Enquiry.id == enquiry_id)
                )).scalars().first()
                if enq:
                    enq.lead_score = score_val
                    enq.lead_score_reason = score_reason
                    # commit happens in fire_event after all actions are added
        except Exception as e:
            logger.warning("[LEAD_SCORE] Failed to save score for enquiry %s: %s", enquiry_id, e)

    return [
        _make_action(owner_id, "sales", "follow_up",
                     f"Follow up with {prospect}",
                     f"New enquiry from {prospect}. Send a follow-up within the hour to maximise conversion.",
                     follow_up, "telegram", "new_enquiry", ctx, "high",
                     recipients=[{"name": prospect, "phone": phone, "email": ctx.get("email", "")}]),
        _make_action(owner_id, "sales", "lead_score",
                     f"Lead score — {prospect}",
                     "AI scored this lead for conversion likelihood.",
                     score_text, "internal", "new_enquiry", ctx, "low"),
    ]


async def _on_issue_reported(owner_id: str, ctx: dict, db: AsyncSession | None = None) -> list[AutopilotAction]:
    title    = ctx.get("title", "issue")
    priority = ctx.get("priority", "medium")
    estate   = ctx.get("estate", "")
    category = ctx.get("category", "general")

    # Auto-assign best vendor by matching category and highest rating
    vendor_name: str | None = None
    vendor_phone: str | None = None
    vendor_hint = ""
    if db is not None:
        try:
            from models.vendor import Vendor
            # Map issue category to vendor category keywords
            CAT_MAP = {
                "plumbing": "plumber", "electrical": "electrician",
                "cleaning": "cleaner", "security": "security",
                "landscaping": "landscaper", "it": "it", "carpentry": "contractor",
            }
            vcat = CAT_MAP.get(category.lower(), category.lower())
            result = await db.execute(
                select(Vendor)
                .where(Vendor.owner_id == owner_id, Vendor.status == "active",
                       Vendor.category.ilike(f"%{vcat}%"))
                .order_by(Vendor.rating.desc(), Vendor.jobs_completed.desc())
                .limit(1)
            )
            best = result.scalars().first()
            if best:
                vendor_name = best.name
                vendor_phone = best.phone
                vendor_hint = f"Auto-assigned to {best.name} (⭐ {best.rating:.1f}, {best.jobs_completed} jobs)."
        except Exception as e:
            logger.warning("[VENDOR_ASSIGN] Failed: %s", e)

    ops_plan = await _ai_content(
        "You are a Nigerian property operations manager. Give a 3-step action plan to resolve this maintenance issue. "
        "Be specific about vendor type needed and SLA to maintain. Max 80 words.",
        f"Issue: {title}, Category: {category}, Priority: {priority}, Estate: {estate}. "
        + (f"Assigned vendor: {vendor_name}." if vendor_name else "No vendor on file for this category.")
    )

    enriched_description = "Operations AI has created an action plan."
    if vendor_hint:
        enriched_description += f" {vendor_hint}"
    if vendor_phone:
        enriched_description += f" Call: {vendor_phone}"

    actions = [
        _make_action(owner_id, "operations", "maintenance_plan",
                     f"{'⚠️ URGENT' if priority == 'high' else 'Issue'}: {title}",
                     enriched_description,
                     ops_plan, "internal", "issue_reported", ctx,
                     "high" if priority == "high" else "medium"),
    ]

    # If high priority and vendor has phone, queue a WhatsApp notification to vendor
    if priority == "high" and vendor_name and vendor_phone:
        msg = await _ai_content(
            "You write brief WhatsApp messages to property vendors in Nigeria. Max 60 words.",
            f"Notify vendor {vendor_name} of urgent issue: {title}. Estate: {estate}. "
            "Ask them to call back immediately. Professional but direct."
        )
        actions.append(_make_action(
            owner_id, "operations", "vendor_notification",
            f"Notify Vendor: {vendor_name} — {title}",
            f"Urgent WhatsApp to {vendor_name} ({vendor_phone})",
            msg, "telegram", "issue_reported", ctx, "high",
            recipients=[{"name": vendor_name, "phone": vendor_phone, "email": ""}]
        ))

    return actions


async def _on_payment_received(owner_id: str, ctx: dict) -> list[AutopilotAction]:
    tenant  = ctx.get("tenant_name", "Tenant")
    amount  = ctx.get("amount", 0)
    unit    = ctx.get("unit_label", "")

    receipt_msg = await _ai_content(
        "Write a short WhatsApp message confirming a rent payment. Professional and warm. Max 2 sentences.",
        f"Tenant: {tenant}, Amount: ₦{amount:,.0f}, Unit: {unit}. Confirm receipt."
    )
    return [
        _make_action(owner_id, "finance", "payment_receipt",
                     f"Payment receipt — {tenant} ₦{amount:,.0f}",
                     "Send a payment confirmation to the tenant.",
                     receipt_msg, "telegram", "payment_received", ctx, "medium",
                     recipients=[{"name": tenant, "phone": ctx.get("phone", ""), "email": ctx.get("email", "")}]),
    ]


async def _on_tenant_overdue(owner_id: str, ctx: dict) -> list[AutopilotAction]:
    tenant      = ctx.get("tenant_name", "Tenant")
    outstanding = ctx.get("outstanding", 0)
    days_late   = ctx.get("days_late", 0)
    phone       = ctx.get("phone", "")

    reminder = await _ai_content(
        "Write a polite but firm WhatsApp payment reminder for an overdue Nigerian tenant. "
        "Max 3 sentences. Professional, not aggressive. Mention amount and urgency.",
        f"Tenant: {tenant}, Overdue: ₦{outstanding:,.0f}, Days late: {days_late}. Write reminder."
    )
    return [
        _make_action(owner_id, "finance", "payment_reminder",
                     f"Overdue reminder — {tenant} (₦{outstanding:,.0f})",
                     f"{tenant} is {days_late} days late on ₦{outstanding:,.0f}. Send reminder now.",
                     reminder, "telegram", "tenant_overdue", ctx, "high",
                     recipients=[{"name": tenant, "phone": phone, "email": ctx.get("email", "")}]),
    ]


async def _on_new_property_listed(owner_id: str, ctx: dict) -> list[AutopilotAction]:
    unit   = ctx.get("unit_label", "unit")
    estate = ctx.get("estate_name", "estate")
    price  = ctx.get("price", "")

    launch_post = await _ai_content(
        "Write a Facebook launch post for a new Nigerian property listing. "
        "Include features, price, and how to enquire. 120 words max. Enthusiastic but professional.",
        f"Unit: {unit}, Estate: {estate}, Price: {price}. New listing launch post."
    )
    checklist = await _ai_content(
        "List 5 things a Nigerian property manager must do before marketing a new listing. "
        "Number them. Be specific. Max 80 words.",
        f"Unit: {unit}, Estate: {estate}. Pre-launch checklist."
    )
    return [
        _make_action(owner_id, "marketer", "facebook_post",
                     f"New listing launch — {unit}, {estate}",
                     "Share this Facebook post to announce the new listing.",
                     launch_post, "facebook", "new_property_listed", ctx, "high"),
        _make_action(owner_id, "designer", "checklist",
                     f"Pre-launch checklist — {unit}",
                     "Complete this before marketing the listing.",
                     checklist, "internal", "new_property_listed", ctx, "medium"),
    ]


async def _on_lease_expiring(owner_id: str, ctx: dict) -> list[AutopilotAction]:
    tenant   = ctx.get("tenant_name", "Tenant")
    days     = ctx.get("days_remaining", 30)
    unit     = ctx.get("unit_label", "")
    phone    = ctx.get("phone", "")

    renewal_msg = await _ai_content(
        "Write a WhatsApp message to a tenant whose lease is expiring soon. "
        "Offer renewal. Be warm and give a reason to stay. Max 4 sentences. Professional.",
        f"Tenant: {tenant}, Unit: {unit}, Days remaining: {days}. Write renewal offer."
    )
    priority = "high" if days <= 14 else ("medium" if days <= 30 else "low")
    return [
        _make_action(owner_id, "sales", "lease_renewal",
                     f"Lease renewal — {tenant} ({days} days left)",
                     f"{tenant}'s lease at {unit} expires in {days} days. Send renewal offer now.",
                     renewal_msg, "telegram", "lease_expiring", ctx, priority,
                     recipients=[{"name": tenant, "phone": phone, "email": ctx.get("email", "")}]),
    ]
