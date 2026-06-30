import logging
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc

from models.user import User
from models.tenant import Tenant
from models.estate import Estate
from models.unit import Unit
from models.payment import Payment
from models.issue import Issue
from models.notification import Notification
from models.service_request import ServiceRequest
from models.billing_item import BillingItem
from models.enquiry import Enquiry
from models.rental_application import RentalApplication
from models.wallet import Wallet
from models.tenant_telegram import TenantTelegramSession
from core.security import verify_password
from models.base import gen_uuid

logger = logging.getLogger(__name__)

ADMIN_ROLES = {"admin", "super_admin", "business_owner", "manager", "super_manager"}


# ─── Session helpers ──────────────────────────────────────────────────────────

async def get_or_create_session(db: AsyncSession, telegram_id: str) -> TenantTelegramSession:
    result = await db.execute(
        select(TenantTelegramSession).where(TenantTelegramSession.telegram_id == telegram_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        session = TenantTelegramSession(telegram_id=telegram_id)
        db.add(session)
        await db.commit()
        await db.refresh(session)
    return session


async def update_session(db: AsyncSession, session: TenantTelegramSession, **fields) -> None:
    for k, v in fields.items():
        setattr(session, k, v)
    session.updated_at = datetime.utcnow()
    await db.commit()


# ─── Core lookups ─────────────────────────────────────────────────────────────

async def get_user(db: AsyncSession, user_id: str) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_my_estates(db: AsyncSession, user: User) -> list[Estate]:
    if user.role == "super_admin":
        result = await db.execute(select(Estate).where(Estate.is_active == True))  # noqa: E712
    else:
        estate_ids = user.assigned_estates or []
        if estate_ids:
            result = await db.execute(select(Estate).where(Estate.id.in_(estate_ids), Estate.is_active == True))  # noqa: E712
        else:
            result = await db.execute(select(Estate).where(Estate.owner == user.id, Estate.is_active == True))  # noqa: E712
    return result.scalars().all()


async def search_tenants(db: AsyncSession, estate_ids: list[str], query: str) -> list[Tenant]:
    q = query.strip().lower()
    result = await db.execute(
        select(Tenant).where(
            Tenant.estate.in_(estate_ids),
            Tenant.is_active == True,  # noqa: E712
            (
                Tenant.tenant_name.ilike(f"%{q}%") |
                Tenant.tenant_email.ilike(f"%{q}%") |
                Tenant.tenant_phone.ilike(f"%{q}%") |
                Tenant.unit_label.ilike(f"%{q}%")
            ),
        ).limit(8)
    )
    return result.scalars().all()


async def list_tenants(db: AsyncSession, estate_ids: list[str], page: int = 0) -> list[Tenant]:
    result = await db.execute(
        select(Tenant).where(Tenant.estate.in_(estate_ids), Tenant.is_active == True)  # noqa: E712
        .order_by(Tenant.tenant_name).limit(8).offset(page * 8)
    )
    return result.scalars().all()


async def get_tenant_by_id(db: AsyncSession, tenant_id: str) -> Tenant | None:
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    return result.scalar_one_or_none()


# ─── Message builders ─────────────────────────────────────────────────────────

def admin_menu(user: User, estates: list[Estate]) -> str:
    estate_names = ", ".join(e.name for e in estates[:3])
    if len(estates) > 3:
        estate_names += f" +{len(estates)-3} more"
    return (
        f"👋 *{user.name}* — {user.role.replace('_', ' ').title()}\n"
        f"🏢 _{estate_names or 'No estates assigned'}_\n\n"
        "*── Dashboard ──*\n"
        "📊 /dashboard — Overview & stats\n"
        "📈 /report — Quick performance report\n\n"
        "*── Tenants ──*\n"
        "👥 /tenants — List all tenants\n"
        "🔍 /search — Search a tenant\n"
        "📋 /profile — Full tenant profile\n\n"
        "*── Manager Skills ──*\n"
        "💰 /collect — Record a rent payment\n"
        "🧾 /addbill — Add billing charge to tenant\n"
        "📝 /note — Add note to tenant record\n"
        "🔔 /remind — Send rent reminder\n"
        "🔧 /resolve — Update issue status\n"
        "📬 /applications — Rental applications\n"
        "📩 /enquiries — Property enquiries\n\n"
        "*── Estates ──*\n"
        "🏢 /estates — Estate overview\n"
        "🔑 /vacancies — All vacant units\n"
        "🔧 /issues — Open issues\n"
        "💳 /payments — Recent payments\n"
        "🔔 /notify — Send notification to tenant\n\n"
        "🚪 /logout"
    )


def tenant_summary_line(t: Tenant) -> str:
    outstanding = t.rent_outstanding + t.service_charge_outstanding
    flag = "🔴" if outstanding > 0 else "🟢"
    return f"{flag} *{t.tenant_name}* — {t.unit_label} | ₦{outstanding:,.0f} due"


async def full_tenant_profile(db: AsyncSession, tenant: Tenant) -> str:
    outstanding = tenant.rent_outstanding + tenant.service_charge_outstanding
    flag = "🔴" if outstanding > 0 else "🟢"

    payments = (await db.execute(
        select(Payment).where(Payment.tenant == tenant.id)
        .order_by(desc(Payment.created_at)).limit(5)
    )).scalars().all()

    issues = (await db.execute(
        select(Issue).where(Issue.tenant == tenant.id, Issue.status != "closed")
        .order_by(desc(Issue.created_at)).limit(3)
    )).scalars().all()

    bills = (await db.execute(
        select(BillingItem).where(BillingItem.tenant == tenant.id, BillingItem.is_paid == False, BillingItem.is_active == True)  # noqa: E712
    )).scalars().all()

    total_paid = sum(p.amount for p in payments if p.payment_status in ("success", "completed"))

    lines = [
        f"📋 *Tenant Profile — {tenant.tenant_name}*",
        f"━━━━━━━━━━━━━━━━━━━━━",
        f"🏠 Unit: {tenant.unit_label}",
        f"📞 Phone: {tenant.tenant_phone or 'N/A'}",
        f"✉️ Email: {tenant.tenant_email or 'N/A'}",
        f"📅 Entry: {tenant.entry_date.strftime('%d %b %Y') if tenant.entry_date else 'N/A'}",
        f"📅 Next Due: {tenant.next_due_date.strftime('%d %b %Y') if tenant.next_due_date else 'N/A'}",
        f"",
        f"💰 *Financials*",
        f"  Rent: ₦{tenant.rent_amount:,.0f}/mo",
        f"  Service Charge: ₦{tenant.service_charge_amount:,.0f}/mo",
        f"  {flag} Outstanding: ₦{outstanding:,.0f}",
        f"  Total Paid (shown): ₦{total_paid:,.0f}",
    ]

    if bills:
        lines.append(f"\n🧾 *Pending Bills ({len(bills)})*")
        for b in bills:
            lines.append(f"  • {b.label} — ₦{b.amount:,.0f}")

    if payments:
        lines.append(f"\n💳 *Recent Payments*")
        for p in payments:
            icon = "✅" if p.payment_status in ("success", "completed") else "⏳"
            lines.append(f"  {icon} ₦{p.amount:,.0f} | {p.payment_type} | {p.created_at.strftime('%d %b %Y')}")

    if issues:
        lines.append(f"\n🔧 *Open Issues*")
        for i in issues:
            p_icon = {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(i.priority, "⚪")
            lines.append(f"  {p_icon} {i.title} | {i.status}")

    return "\n".join(lines)


def tenants_list_text(tenants: list[Tenant], page: int = 0) -> str:
    if not tenants:
        return "👥 No tenants found."
    lines = [f"👥 *Tenants* (page {page + 1})\n"]
    for t in tenants:
        lines.append(tenant_summary_line(t))
    lines.append("\n/tenants — next page | /search — search | /profile — full profile")
    return "\n".join(lines)


def estates_overview(estates: list[Estate], stats_list: list[dict]) -> str:
    lines = ["🏢 *Estates Overview*\n"]
    for e, s in zip(estates, stats_list):
        occ_pct = round(s["occupied"] / s["total"] * 100, 1) if s["total"] else 0
        lines.append(
            f"*{e.name}*\n"
            f"  Units: {s['occupied']}/{s['total']} occupied ({occ_pct}%)\n"
            f"  Overdue: {s['overdue']} | Outstanding: ₦{s['outstanding']:,.0f}\n"
            f"  Revenue (30d): ₦{s['revenue_30d']:,.0f}"
        )
    return "\n\n".join(lines)


# ─── State machine ────────────────────────────────────────────────────────────
# States prefix: admin:*

async def handle(db: AsyncSession, telegram_id: str, text: str, first_name: str | None) -> str:
    session = await get_or_create_session(db, telegram_id)
    raw = text.strip()
    cmd = raw.lower().split()[0] if raw else ""
    rest = raw[len(cmd):].strip()  # everything after the first word

    # ── Global logout ─────────────────────────────────────────────────────────
    if cmd in ("/logout", "logout"):
        await update_session(db, session, state="idle", user_id=None, tenant_id=None,
                             role=None, temp_email=None, context=None)
        return "👋 Logged out. Send /admin to login again."

    # ─────────────────────────────────────────────────────────────────────────
    # LOGGED IN
    # ─────────────────────────────────────────────────────────────────────────
    if session.state == "admin:logged_in" and session.user_id:
        user = await get_user(db, session.user_id)
        if not user:
            await update_session(db, session, state="idle", user_id=None)
            return "Session expired. Send /admin to login again."

        estates = await get_my_estates(db, user)
        estate_ids = [e.id for e in estates]

        # ── Menu / help ───────────────────────────────────────────────────────
        if cmd in ("/menu", "/help", "/start", "menu", "help"):
            return admin_menu(user, estates)

        # ── Dashboard ─────────────────────────────────────────────────────────
        if cmd in ("/dashboard", "dashboard"):
            return await _dashboard(db, user, estates, estate_ids)

        # ── Quick report ──────────────────────────────────────────────────────
        if cmd in ("/report", "report"):
            return await _quick_report(db, estate_ids)

        # ── Tenant list ───────────────────────────────────────────────────────
        if cmd in ("/tenants", "tenants"):
            ctx = session.context or {}
            page = ctx.get("tenant_page", 0)
            tenants = await list_tenants(db, estate_ids, page)
            await update_session(db, session, context={**ctx, "tenant_page": page + 1})
            return tenants_list_text(tenants, page)

        # ── Search tenant ─────────────────────────────────────────────────────
        if cmd in ("/search", "search"):
            if rest:
                tenants = await search_tenants(db, estate_ids, rest)
                if not tenants:
                    return f"No tenant found for '{rest}'."
                return tenants_list_text(tenants)
            await update_session(db, session, state="admin:search")
            return "🔍 Send the tenant name, phone, email, or unit number:"

        # ── Full tenant profile ───────────────────────────────────────────────
        if cmd in ("/profile", "profile"):
            if rest:
                tenants = await search_tenants(db, estate_ids, rest)
                if not tenants:
                    return f"No tenant found for '{rest}'."
                if len(tenants) == 1:
                    return await full_tenant_profile(db, tenants[0])
                lines = ["Found multiple. Be more specific:\n"]
                for t in tenants:
                    lines.append(tenant_summary_line(t))
                return "\n".join(lines)
            await update_session(db, session, state="admin:profile_search")
            return "📋 Search tenant for full profile (name, phone, unit):"

        # ─── SKILL: Collect Rent ──────────────────────────────────────────────
        if cmd in ("/collect", "collect"):
            await update_session(db, session, state="admin:collect_search")
            return (
                "💰 *Collect Rent — Step 1 of 3*\n\n"
                "Search for the tenant (name, phone, or unit):\n\n"
                "/cancel to go back."
            )

        # ─── SKILL: Add Billing Item ──────────────────────────────────────────
        if cmd in ("/addbill", "addbill"):
            await update_session(db, session, state="admin:bill_search")
            return (
                "🧾 *Add Billing Charge — Step 1 of 3*\n\n"
                "Search for the tenant to bill (name, phone, or unit):\n\n"
                "/cancel to go back."
            )

        # ─── SKILL: Add Note ──────────────────────────────────────────────────
        if cmd in ("/note", "note"):
            await update_session(db, session, state="admin:note_search")
            return (
                "📝 *Add Tenant Note — Step 1 of 2*\n\n"
                "Search for the tenant (name, phone, or unit):\n\n"
                "/cancel to go back."
            )

        # ─── SKILL: Send Reminder ─────────────────────────────────────────────
        if cmd in ("/remind", "remind"):
            return await _send_reminders(db, estate_ids, session)

        # ─── SKILL: Resolve Issue ─────────────────────────────────────────────
        if cmd in ("/resolve", "resolve"):
            await update_session(db, session, state="admin:resolve_search")
            return (
                "🔧 *Resolve Issue — Step 1 of 2*\n\n"
                "Search for the issue by title or tenant name:\n\n"
                "/cancel to go back."
            )

        # ─── SKILL: Rental Applications ───────────────────────────────────────
        if cmd in ("/applications", "applications"):
            return await _list_applications(db, estate_ids, session)

        # ─── SKILL: Enquiries ─────────────────────────────────────────────────
        if cmd in ("/enquiries", "enquiries"):
            return await _list_enquiries(db, estate_ids)

        # ── Estates ───────────────────────────────────────────────────────────
        if cmd in ("/estates", "estates"):
            stats_list = [await _estate_stats(db, e.id) for e in estates]
            return estates_overview(estates, stats_list)

        # ── Vacancies ─────────────────────────────────────────────────────────
        if cmd in ("/vacancies", "vacancies"):
            return await _vacancies(db, estate_ids)

        # ── Issues ────────────────────────────────────────────────────────────
        if cmd in ("/issues", "issues"):
            return await _list_issues(db, estate_ids)

        # ── Payments ──────────────────────────────────────────────────────────
        if cmd in ("/payments", "payments"):
            return await _recent_payments(db, estate_ids)

        # ── Send notification ─────────────────────────────────────────────────
        if cmd in ("/notify", "notify"):
            await update_session(db, session, state="admin:notify_search")
            return "🔔 *Send Notification*\n\nSearch for the tenant (name, phone, or unit):"

        return admin_menu(user, estates)

    # ─────────────────────────────────────────────────────────────────────────
    # SKILL STATES
    # ─────────────────────────────────────────────────────────────────────────

    if session.state.startswith("admin:") and session.user_id:
        user = await get_user(db, session.user_id)
        if not user:
            await update_session(db, session, state="idle")
            return "Session lost. Send /admin to login."
        estates = await get_my_estates(db, user)
        estate_ids = [e.id for e in estates]

        # Cancel always works
        if cmd in ("/cancel", "cancel"):
            await update_session(db, session, state="admin:logged_in", context=None)
            return admin_menu(user, estates)

        state = session.state
        ctx = session.context or {}

        # ── General search ────────────────────────────────────────────────────
        if state == "admin:search":
            tenants = await search_tenants(db, estate_ids, raw)
            await update_session(db, session, state="admin:logged_in")
            return tenants_list_text(tenants) if tenants else f"No tenant found for '{raw}'."

        # ── Profile search ────────────────────────────────────────────────────
        if state == "admin:profile_search":
            tenants = await search_tenants(db, estate_ids, raw)
            await update_session(db, session, state="admin:logged_in")
            if not tenants:
                return f"No tenant found for '{raw}'."
            if len(tenants) == 1:
                return await full_tenant_profile(db, tenants[0])
            lines = ["Found multiple:\n"] + [tenant_summary_line(t) for t in tenants]
            return "\n".join(lines)

        # ─── SKILL: Collect Rent ──────────────────────────────────────────────
        if state == "admin:collect_search":
            tenants = await search_tenants(db, estate_ids, raw)
            if not tenants:
                return f"No tenant found for '{raw}'. Try again or /cancel."
            if len(tenants) > 1:
                lines = ["Multiple matches — be more specific:\n"] + [tenant_summary_line(t) for t in tenants]
                return "\n".join(lines)
            t = tenants[0]
            outstanding = t.rent_outstanding + t.service_charge_outstanding
            await update_session(db, session, state="admin:collect_amount",
                                 context={"tenant_id": t.id, "tenant_name": t.tenant_name, "unit": t.unit_label})
            return (
                f"💰 *Collect Rent — Step 2 of 3*\n\n"
                f"Tenant: *{t.tenant_name}* — {t.unit_label}\n"
                f"Outstanding: ₦{outstanding:,.0f}\n\n"
                f"Enter the amount collected (₦):\n\n"
                f"/cancel to go back."
            )

        if state == "admin:collect_amount":
            try:
                amount = float(raw.replace(",", "").replace("₦", "").strip())
                if amount <= 0:
                    raise ValueError
            except ValueError:
                return "❌ Enter a valid amount (e.g. 150000). /cancel to go back."
            await update_session(db, session, state="admin:collect_type",
                                 context={**ctx, "amount": amount})
            return (
                f"💰 *Collect Rent — Step 3 of 3*\n\n"
                f"Amount: ₦{amount:,.0f}\n\n"
                f"Payment type?\n"
                f"1️⃣ rent\n"
                f"2️⃣ service_charge\n"
                f"3️⃣ bundle (rent + service charge)\n\n"
                f"Reply with: rent, service_charge, or bundle"
            )

        if state == "admin:collect_type":
            ptype_map = {"1": "rent", "2": "service_charge", "3": "bundle",
                         "rent": "rent", "service_charge": "service_charge", "bundle": "bundle"}
            ptype = ptype_map.get(raw.lower())
            if not ptype:
                return "Reply with rent, service_charge, or bundle. /cancel to go back."

            tenant = await get_tenant_by_id(db, ctx["tenant_id"])
            if not tenant:
                await update_session(db, session, state="admin:logged_in", context=None)
                return "Tenant not found. Try again."

            amount = ctx["amount"]
            payment = Payment(
                tenant=tenant.id,
                estate=tenant.estate,
                amount=amount,
                payment_type=ptype,
                payment_status="completed",
                created_by=session.user_id,
            )
            db.add(payment)

            # Reduce outstanding
            if ptype == "rent":
                tenant.rent_outstanding = max(0, tenant.rent_outstanding - amount)
            elif ptype == "service_charge":
                tenant.service_charge_outstanding = max(0, tenant.service_charge_outstanding - amount)
            elif ptype == "bundle":
                # Split evenly or clear outstanding
                total = tenant.rent_outstanding + tenant.service_charge_outstanding
                if total > 0:
                    rent_ratio = tenant.rent_outstanding / total
                    tenant.rent_outstanding = max(0, tenant.rent_outstanding - amount * rent_ratio)
                    tenant.service_charge_outstanding = max(0, tenant.service_charge_outstanding - amount * (1 - rent_ratio))

            # Notify tenant if they have a user account
            if tenant.user:
                notif = Notification(
                    user=tenant.user,
                    title="Payment Recorded",
                    message=f"A payment of ₦{amount:,.0f} ({ptype}) has been recorded for your account.",
                    type="payment",
                )
                db.add(notif)

            await db.commit()
            await update_session(db, session, state="admin:logged_in", context=None)
            remaining = tenant.rent_outstanding + tenant.service_charge_outstanding
            return (
                f"✅ *Payment Recorded!*\n\n"
                f"Tenant: {tenant.tenant_name} — {tenant.unit_label}\n"
                f"Amount: ₦{amount:,.0f} ({ptype})\n"
                f"Remaining Outstanding: ₦{remaining:,.0f}\n\n"
                f"Tenant has been notified in-app."
            )

        # ─── SKILL: Add Billing Item ──────────────────────────────────────────
        if state == "admin:bill_search":
            tenants = await search_tenants(db, estate_ids, raw)
            if not tenants:
                return f"No tenant found for '{raw}'. Try again or /cancel."
            if len(tenants) > 1:
                lines = ["Multiple matches:\n"] + [tenant_summary_line(t) for t in tenants]
                return "\n".join(lines)
            t = tenants[0]
            await update_session(db, session, state="admin:bill_label",
                                 context={"tenant_id": t.id, "tenant_name": t.tenant_name, "unit": t.unit_label})
            return (
                f"🧾 *Add Bill — Step 2 of 3*\n\n"
                f"Tenant: *{t.tenant_name}* — {t.unit_label}\n\n"
                f"What is the bill for? (e.g. Generator Levy, Security Fee, Water)\n\n"
                f"/cancel to go back."
            )

        if state == "admin:bill_label":
            await update_session(db, session, state="admin:bill_amount",
                                 context={**ctx, "label": raw})
            return (
                f"🧾 *Add Bill — Step 3 of 3*\n\n"
                f"Label: {raw}\n\n"
                f"Enter the amount (₦):\n\n"
                f"/cancel to go back."
            )

        if state == "admin:bill_amount":
            try:
                amount = float(raw.replace(",", "").replace("₦", "").strip())
                if amount <= 0:
                    raise ValueError
            except ValueError:
                return "❌ Enter a valid amount. /cancel to go back."

            tenant = await get_tenant_by_id(db, ctx["tenant_id"])
            if not tenant:
                await update_session(db, session, state="admin:logged_in", context=None)
                return "Tenant not found."

            bill = BillingItem(
                user=tenant.user,
                tenant=tenant.id,
                estate=tenant.estate,
                label=ctx["label"],
                amount=amount,
                item_type="other",
                created_by=session.user_id,
            )
            db.add(bill)

            if tenant.user:
                notif = Notification(
                    user=tenant.user,
                    title="New Billing Charge",
                    message=f"A new charge of ₦{amount:,.0f} has been added: {ctx['label']}.",
                    type="billing",
                )
                db.add(notif)

            await db.commit()
            await update_session(db, session, state="admin:logged_in", context=None)
            return (
                f"✅ *Bill Added!*\n\n"
                f"Tenant: {tenant.tenant_name} — {tenant.unit_label}\n"
                f"Charge: {ctx['label']}\n"
                f"Amount: ₦{amount:,.0f}\n\n"
                f"Tenant notified in-app."
            )

        # ─── SKILL: Add Note ──────────────────────────────────────────────────
        if state == "admin:note_search":
            tenants = await search_tenants(db, estate_ids, raw)
            if not tenants:
                return f"No tenant found for '{raw}'. Try again or /cancel."
            if len(tenants) > 1:
                lines = ["Multiple matches:\n"] + [tenant_summary_line(t) for t in tenants]
                return "\n".join(lines)
            t = tenants[0]
            await update_session(db, session, state="admin:note_write",
                                 context={"tenant_id": t.id, "tenant_name": t.tenant_name})
            return (
                f"📝 *Add Note — Step 2 of 2*\n\n"
                f"Tenant: *{t.tenant_name}* — {t.unit_label}\n\n"
                f"Write your note (it will be saved to their history record):\n\n"
                f"/cancel to go back."
            )

        if state == "admin:note_write":
            tenant = await get_tenant_by_id(db, ctx["tenant_id"])
            if not tenant:
                await update_session(db, session, state="admin:logged_in", context=None)
                return "Tenant not found."
            history = list(tenant.history or [])
            history.append({
                "date": datetime.utcnow().isoformat(),
                "note": raw,
                "added_by": user.name,
                "type": "manager_note",
            })
            tenant.history = history
            await db.commit()
            await update_session(db, session, state="admin:logged_in", context=None)
            return (
                f"✅ *Note Saved!*\n\n"
                f"Tenant: {tenant.tenant_name}\n"
                f"Note: _{raw}_\n"
                f"Recorded by: {user.name}"
            )

        # ─── SKILL: Resolve Issue ─────────────────────────────────────────────
        if state == "admin:resolve_search":
            q = raw.lower()
            result = await db.execute(
                select(Issue).where(
                    Issue.estate.in_(estate_ids),
                    Issue.status != "closed",
                    Issue.title.ilike(f"%{q}%"),
                ).limit(5)
            )
            issues = result.scalars().all()
            if not issues:
                # Also try by tenant name
                tenant_matches = await search_tenants(db, estate_ids, raw)
                if tenant_matches:
                    tenant_ids = [t.id for t in tenant_matches]
                    result2 = await db.execute(
                        select(Issue).where(Issue.tenant.in_(tenant_ids), Issue.status != "closed").limit(5)
                    )
                    issues = result2.scalars().all()
            if not issues:
                return f"No open issues found for '{raw}'. Try again or /cancel."
            if len(issues) == 1:
                i = issues[0]
                await update_session(db, session, state="admin:resolve_status",
                                     context={"issue_id": i.id, "issue_title": i.title})
                return (
                    f"🔧 *Resolve Issue — Step 2 of 2*\n\n"
                    f"Issue: *{i.title}*\n"
                    f"Current status: {i.status} | Priority: {i.priority}\n\n"
                    f"New status?\n"
                    f"1️⃣ in_progress\n"
                    f"2️⃣ resolved\n"
                    f"3️⃣ closed\n\n"
                    f"Reply with the status or number. /cancel to go back."
                )
            lines = ["Multiple issues found:\n"]
            for idx, i in enumerate(issues, 1):
                lines.append(f"{idx}. *{i.title}* | {i.status} | {i.priority}")
            lines.append("\nBe more specific or /cancel.")
            return "\n".join(lines)

        if state == "admin:resolve_status":
            status_map = {
                "1": "in_progress", "2": "resolved", "3": "closed",
                "in_progress": "in_progress", "resolved": "resolved", "closed": "closed",
            }
            new_status = status_map.get(raw.lower())
            if not new_status:
                return "Reply with: in_progress, resolved, or closed. /cancel to go back."

            result = await db.execute(select(Issue).where(Issue.id == ctx["issue_id"]))
            issue = result.scalar_one_or_none()
            if not issue:
                await update_session(db, session, state="admin:logged_in", context=None)
                return "Issue not found."

            old_status = issue.status
            issue.status = new_status
            issue.updated_at = datetime.utcnow()

            # Notify tenant
            if issue.tenant:
                tenant = await get_tenant_by_id(db, issue.tenant)
                if tenant and tenant.user:
                    notif = Notification(
                        user=tenant.user,
                        title="Issue Status Update",
                        message=f"Your issue '{issue.title}' has been updated to: {new_status}.",
                        type="issue",
                    )
                    db.add(notif)

            await db.commit()
            await update_session(db, session, state="admin:logged_in", context=None)
            return (
                f"✅ *Issue Updated!*\n\n"
                f"Issue: {issue.title}\n"
                f"{old_status} → *{new_status}*\n\n"
                f"Tenant has been notified."
            )

        # ─── SKILL: Notify ────────────────────────────────────────────────────
        if state == "admin:notify_search":
            tenants = await search_tenants(db, estate_ids, raw)
            if not tenants:
                return f"No tenant found for '{raw}'. Try again or /cancel."
            if len(tenants) > 1:
                lines = ["Multiple matches:\n"] + [tenant_summary_line(t) for t in tenants]
                return "\n".join(lines)
            t = tenants[0]
            await update_session(db, session, state="admin:notify_message",
                                 context={"notify_user_id": t.user, "tenant_name": t.tenant_name, "unit": t.unit_label})
            return (
                f"🔔 Sending to: *{t.tenant_name}* — {t.unit_label}\n\n"
                f"Type the message to send:\n\n"
                f"/cancel to go back."
            )

        if state == "admin:notify_message":
            notify_user_id = ctx.get("notify_user_id")
            if notify_user_id:
                notif = Notification(
                    user=notify_user_id,
                    title="Message from Management",
                    message=raw,
                    type="management",
                )
                db.add(notif)
                await db.commit()
            await update_session(db, session, state="admin:logged_in", context=None)
            return f"✅ Notification sent to *{ctx.get('tenant_name', 'tenant')}*."

        # ─── Applications: approve/reject ─────────────────────────────────────
        if state == "admin:application_action":
            action_map = {"1": "approved", "2": "rejected", "approved": "approved", "rejected": "rejected"}
            action = action_map.get(raw.lower())
            if not action:
                return "Reply with: approved, rejected, 1, or 2. /cancel to go back."
            result = await db.execute(select(RentalApplication).where(RentalApplication.id == ctx["app_id"]))
            app = result.scalar_one_or_none()
            if not app:
                await update_session(db, session, state="admin:logged_in", context=None)
                return "Application not found."
            app.status = action
            app.updated_by = session.user_id
            await db.commit()
            await update_session(db, session, state="admin:logged_in", context=None)
            return (
                f"✅ Application *{action.title()}*\n\n"
                f"Applicant: {ctx.get('app_name')}\n"
                f"Status updated to: {action}"
            )

    # ─────────────────────────────────────────────────────────────────────────
    # LOGIN FLOW
    # ─────────────────────────────────────────────────────────────────────────

    if session.state == "admin:awaiting_password":
        if cmd in ("/cancel", "cancel"):
            await update_session(db, session, state="idle", temp_email=None)
            return "Login cancelled. Send /admin to try again."
        email = session.temp_email
        if not email:
            await update_session(db, session, state="idle")
            return "Session lost. Send /admin to start over."
        user = await _find_user_by_email(db, email)
        if not user or not verify_password(raw, user.password):
            return "❌ Incorrect password. Try again or /cancel."
        if not user.is_active:
            await update_session(db, session, state="idle", temp_email=None)
            return "❌ Account deactivated. Contact the system administrator."
        if user.role not in ADMIN_ROLES:
            await update_session(db, session, state="idle", temp_email=None)
            return "❌ This login is for management accounts only.\nSend /tenant to login as a tenant."
        await update_session(db, session, state="admin:logged_in", user_id=user.id,
                             role=user.role, temp_email=None)
        # Remember this Telegram ↔ account link so the AI coach auto-recognises
        # them in future /coach chats without needing to log in again.
        if user.telegram_id != telegram_id:
            user.telegram_id = telegram_id
            await db.commit()
        estates = await get_my_estates(db, user)
        return "✅ *Login successful!*\n\n" + admin_menu(user, estates)

    if session.state == "admin:awaiting_email":
        if cmd in ("/cancel", "cancel"):
            await update_session(db, session, state="idle")
            return "Login cancelled."
        if "@" not in raw:
            return "Please enter a valid email address."
        user = await _find_user_by_email(db, raw)
        if not user:
            return "❌ No account found with that email. Try again or /cancel."
        await update_session(db, session, state="admin:awaiting_password", temp_email=raw.lower())
        return f"✉️ Account found: *{user.name}* ({user.role.replace('_', ' ').title()})\n\nSend your password:"

    # Entry point
    await update_session(db, session, state="admin:awaiting_email")
    return (
        "🔐 *Management Login*\n\n"
        "Enter your email address:\n\n"
        "/cancel to go back."
    )


# ─── Skill helpers ────────────────────────────────────────────────────────────

async def _dashboard(db: AsyncSession, user: User, estates: list[Estate], estate_ids: list[str]) -> str:
    if not estate_ids:
        return "No estates assigned."
    now = datetime.utcnow()
    thirty_ago = now - timedelta(days=30)

    total_units = (await db.execute(select(func.count()).where(Unit.estate.in_(estate_ids), Unit.is_active == True))).scalar() or 0  # noqa: E712
    occupied = (await db.execute(select(func.count()).where(Unit.estate.in_(estate_ids), Unit.status == "occupied"))).scalar() or 0
    total_tenants = (await db.execute(select(func.count()).where(Tenant.estate.in_(estate_ids), Tenant.is_active == True))).scalar() or 0  # noqa: E712
    overdue = (await db.execute(select(func.count()).where(Tenant.estate.in_(estate_ids), Tenant.is_active == True, Tenant.next_due_date < now))).scalar() or 0  # noqa: E712
    outstanding = (await db.execute(select(func.coalesce(func.sum(Tenant.rent_outstanding + Tenant.service_charge_outstanding), 0)).where(Tenant.estate.in_(estate_ids), Tenant.is_active == True))).scalar() or 0  # noqa: E712
    revenue_30d = (await db.execute(select(func.coalesce(func.sum(Payment.amount), 0)).where(Payment.estate.in_(estate_ids), Payment.payment_status.in_(["success", "completed"]), Payment.created_at >= thirty_ago))).scalar() or 0
    open_issues = (await db.execute(select(func.count()).where(Issue.estate.in_(estate_ids), Issue.status != "closed"))).scalar() or 0
    occ_pct = round(occupied / total_units * 100, 1) if total_units else 0

    return (
        f"📊 *Dashboard — {user.name}*\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"🏢 Estates: {len(estates)}\n"
        f"🏠 Units: {total_units} | {occupied} occupied | {occ_pct}% occupancy\n"
        f"👥 Tenants: {total_tenants} | 🔴 {overdue} overdue\n"
        f"💰 Revenue (30d): ₦{revenue_30d:,.0f}\n"
        f"📛 Outstanding: ₦{outstanding:,.0f}\n"
        f"🔧 Open Issues: {open_issues}\n\n"
        f"/report · /tenants · /vacancies · /issues"
    )


async def _quick_report(db: AsyncSession, estate_ids: list[str]) -> str:
    if not estate_ids:
        return "No estates to report on."
    now = datetime.utcnow()
    thirty_ago = now - timedelta(days=30)

    overdue_tenants = (await db.execute(
        select(Tenant).where(Tenant.estate.in_(estate_ids), Tenant.is_active == True, Tenant.next_due_date < now)  # noqa: E712
        .order_by(Tenant.next_due_date.asc()).limit(10)
    )).scalars().all()

    total_tenants = (await db.execute(select(func.count()).where(Tenant.estate.in_(estate_ids), Tenant.is_active == True))).scalar() or 0  # noqa: E712
    vacant_count = (await db.execute(select(func.count()).where(Unit.estate.in_(estate_ids), Unit.status == "vacant", Unit.is_active == True))).scalar() or 0  # noqa: E712
    revenue_30d = (await db.execute(select(func.coalesce(func.sum(Payment.amount), 0)).where(Payment.estate.in_(estate_ids), Payment.payment_status.in_(["success", "completed"]), Payment.created_at >= thirty_ago))).scalar() or 0
    monthly_roll = (await db.execute(select(func.coalesce(func.sum(Tenant.rent_amount + Tenant.service_charge_amount), 0)).where(Tenant.estate.in_(estate_ids), Tenant.is_active == True, Tenant.status == "occupied"))).scalar() or 0  # noqa: E712
    collection_rate = round(revenue_30d / monthly_roll * 100, 1) if monthly_roll > 0 else 0
    pending_apps = (await db.execute(select(func.count()).where(RentalApplication.estate.in_(estate_ids), RentalApplication.status == "pending"))).scalar() or 0

    lines = [
        "📈 *Quick Performance Report*",
        f"━━━━━━━━━━━━━━━━━━━━━",
        f"👥 Tenants: {total_tenants} | 🔑 Vacancies: {vacant_count}",
        f"💰 Revenue (30d): ₦{revenue_30d:,.0f}",
        f"📊 Collection Rate: {collection_rate}%",
        f"📬 Pending Applications: {pending_apps}",
    ]
    if overdue_tenants:
        lines.append(f"\n🔴 *Overdue Tenants ({len(overdue_tenants)})*")
        for t in overdue_tenants:
            outstanding = t.rent_outstanding + t.service_charge_outstanding
            lines.append(f"  • {t.tenant_name} — {t.unit_label} | ₦{outstanding:,.0f} | {t.tenant_phone or 'no phone'}")
    else:
        lines.append("\n✅ No overdue tenants!")
    return "\n".join(lines)


async def _send_reminders(db: AsyncSession, estate_ids: list[str], session: TenantTelegramSession) -> str:
    now = datetime.utcnow()
    overdue = (await db.execute(
        select(Tenant).where(Tenant.estate.in_(estate_ids), Tenant.is_active == True, Tenant.next_due_date < now)  # noqa: E712
    )).scalars().all()

    if not overdue:
        return "✅ No overdue tenants to remind."

    count = 0
    for t in overdue:
        if t.user:
            outstanding = t.rent_outstanding + t.service_charge_outstanding
            notif = Notification(
                user=t.user,
                title="Rent Reminder",
                message=(
                    f"Dear {t.tenant_name}, your rent payment of ₦{outstanding:,.0f} is overdue. "
                    f"Please make payment as soon as possible to avoid penalties. "
                    f"Contact management if you have any questions."
                ),
                type="reminder",
            )
            db.add(notif)
            count += 1

    await db.commit()
    return (
        f"🔔 *Reminders Sent!*\n\n"
        f"Sent in-app reminders to {count} of {len(overdue)} overdue tenants.\n\n"
        f"Tenants without a user account did not receive a notification.\n"
        f"Use /notify to send to specific tenants manually."
    )


async def _list_issues(db: AsyncSession, estate_ids: list[str]) -> str:
    issues = (await db.execute(
        select(Issue).where(Issue.estate.in_(estate_ids), Issue.status != "closed")
        .order_by(Issue.priority.desc(), desc(Issue.created_at)).limit(15)
    )).scalars().all()
    if not issues:
        return "✅ No open maintenance issues."
    lines = [f"🔧 *Open Issues ({len(issues)})*\n"]
    for i in issues:
        p_icon = {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(i.priority, "⚪")
        lines.append(f"{p_icon} *{i.title}*\n   {i.status.title()} | {i.created_at.strftime('%d %b')}")
    lines.append("\n/resolve to update an issue status.")
    return "\n".join(lines)


async def _recent_payments(db: AsyncSession, estate_ids: list[str]) -> str:
    payments = (await db.execute(
        select(Payment).where(Payment.estate.in_(estate_ids))
        .order_by(desc(Payment.created_at)).limit(10)
    )).scalars().all()
    if not payments:
        return "💳 No payment records found."
    lines = ["💳 *Recent Payments*\n"]
    for p in payments:
        icon = "✅" if p.payment_status in ("success", "completed") else "⏳"
        lines.append(f"{icon} ₦{p.amount:,.0f} | {p.payment_type} | {p.created_at.strftime('%d %b %Y')}")
    lines.append("\n/collect to record a new payment.")
    return "\n".join(lines)


async def _vacancies(db: AsyncSession, estate_ids: list[str]) -> str:
    from models.estate import Estate as EstateModel
    estate_map = {e.id: e.name for e in (await db.execute(select(EstateModel).where(EstateModel.id.in_(estate_ids)))).scalars().all()}
    units = (await db.execute(
        select(Unit).where(Unit.estate.in_(estate_ids), Unit.status == "vacant", Unit.is_active == True)  # noqa: E712
        .order_by(Unit.estate, Unit.label)
    )).scalars().all()
    if not units:
        return "✅ No vacant units — fully occupied!"
    lines = [f"🔑 *Vacant Units ({len(units)})*\n"]
    for u in units:
        lines.append(
            f"*{u.label}* [{estate_map.get(u.estate, '')}]\n"
            f"  {u.category} | {u.bedrooms}bed/{u.bathrooms}bath | ₦{u.monthly_price:,.0f}/mo"
        )
    lines.append("\n/applications to review pending rental applications.")
    return "\n".join(lines)


async def _list_applications(db: AsyncSession, estate_ids: list[str], session: TenantTelegramSession) -> str:
    apps = (await db.execute(
        select(RentalApplication).where(RentalApplication.estate.in_(estate_ids))
        .order_by(desc(RentalApplication.created_at)).limit(10)
    )).scalars().all()
    if not apps:
        return "📬 No rental applications found."
    lines = [f"📬 *Rental Applications ({len(apps)})*\n"]
    pending = [a for a in apps if a.status == "pending"]
    for a in apps:
        status_icon = {"pending": "🟡", "approved": "✅", "rejected": "❌"}.get(a.status, "⚪")
        lines.append(
            f"{status_icon} *{a.first_name} {a.last_name}*\n"
            f"   {a.email} | {a.phone or 'no phone'}\n"
            f"   Move-in: {a.move_in_date or 'TBD'} | Status: {a.status} | {a.created_at.strftime('%d %b')}"
        )
    if pending:
        lines.append(f"\n{len(pending)} pending. To approve/reject, send:\n/approve [applicant name] or /reject [applicant name]")
    return "\n".join(lines)


async def _list_enquiries(db: AsyncSession, estate_ids: list[str]) -> str:
    enquiries = (await db.execute(
        select(Enquiry).where(Enquiry.estate.in_(estate_ids), Enquiry.is_active == True)  # noqa: E712
        .order_by(desc(Enquiry.created_at)).limit(10)
    )).scalars().all()
    if not enquiries:
        return "📩 No enquiries found."
    lines = [f"📩 *Property Enquiries ({len(enquiries)})*\n"]
    for e in enquiries:
        status_icon = {"pending": "🟡", "contacted": "🔵", "converted": "✅", "closed": "❌"}.get(e.status, "⚪")
        lines.append(
            f"{status_icon} *{e.name}*\n"
            f"   {e.phone or e.email} | {e.enquiry_type} | {e.status}\n"
            f"   {(e.message or '')[:80]} | {e.created_at.strftime('%d %b')}"
        )
    return "\n".join(lines)


async def _estate_stats(db: AsyncSession, estate_id: str) -> dict:
    now = datetime.utcnow()
    thirty_ago = now - timedelta(days=30)
    total = (await db.execute(select(func.count()).where(Unit.estate == estate_id, Unit.is_active == True))).scalar() or 0  # noqa: E712
    occupied = (await db.execute(select(func.count()).where(Unit.estate == estate_id, Unit.status == "occupied"))).scalar() or 0
    overdue = (await db.execute(select(func.count()).where(Tenant.estate == estate_id, Tenant.is_active == True, Tenant.next_due_date < now))).scalar() or 0  # noqa: E712
    outstanding = (await db.execute(select(func.coalesce(func.sum(Tenant.rent_outstanding + Tenant.service_charge_outstanding), 0)).where(Tenant.estate == estate_id, Tenant.is_active == True))).scalar() or 0  # noqa: E712
    revenue_30d = (await db.execute(select(func.coalesce(func.sum(Payment.amount), 0)).where(Payment.estate == estate_id, Payment.payment_status.in_(["success", "completed"]), Payment.created_at >= thirty_ago))).scalar() or 0
    return {"total": total, "occupied": occupied, "overdue": overdue, "outstanding": round(outstanding, 0), "revenue_30d": round(revenue_30d, 0)}


async def _find_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email.strip().lower()))
    return result.scalar_one_or_none()
