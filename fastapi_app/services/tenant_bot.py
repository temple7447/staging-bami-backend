import logging
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from models.tenant import Tenant
from models.user import User
from models.issue import Issue
from models.payment import Payment
from models.billing_item import BillingItem
from models.notification import Notification
from models.service_request import ServiceRequest
from models.wallet import Wallet
from models.tenant_telegram import TenantTelegramSession
from core.security import verify_password

logger = logging.getLogger(__name__)

TENANT_ROLES = {"tenant", "user"}


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


# ─── Lookups ──────────────────────────────────────────────────────────────────

async def get_tenant(db: AsyncSession, tenant_id: str) -> Tenant | None:
    result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    return result.scalar_one_or_none()


async def find_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email.strip().lower()))
    return result.scalar_one_or_none()


async def find_tenant_by_user(db: AsyncSession, user_id: str) -> Tenant | None:
    result = await db.execute(
        select(Tenant).where(Tenant.user == user_id, Tenant.is_active == True)  # noqa: E712
    )
    return result.scalar_one_or_none()


# ─── Data fetchers ────────────────────────────────────────────────────────────

async def get_open_issues(db: AsyncSession, tenant_id: str) -> list[Issue]:
    result = await db.execute(
        select(Issue).where(Issue.tenant == tenant_id, Issue.status != "closed")
        .order_by(desc(Issue.created_at)).limit(5)
    )
    return result.scalars().all()


async def get_recent_payments(db: AsyncSession, tenant_id: str) -> list[Payment]:
    result = await db.execute(
        select(Payment).where(Payment.tenant == tenant_id)
        .order_by(desc(Payment.created_at)).limit(5)
    )
    return result.scalars().all()


async def get_pending_bills(db: AsyncSession, user_id: str) -> list[BillingItem]:
    result = await db.execute(
        select(BillingItem).where(
            BillingItem.user == user_id,
            BillingItem.is_paid == False,  # noqa: E712
            BillingItem.is_active == True,  # noqa: E712
        ).order_by(BillingItem.due_date.asc()).limit(10)
    )
    return result.scalars().all()


async def get_notifications(db: AsyncSession, user_id: str) -> list[Notification]:
    result = await db.execute(
        select(Notification).where(
            Notification.user == user_id,
            Notification.is_active == True,  # noqa: E712
        ).order_by(desc(Notification.created_at)).limit(8)
    )
    return result.scalars().all()


async def get_service_requests(db: AsyncSession, tenant_id: str) -> list[ServiceRequest]:
    result = await db.execute(
        select(ServiceRequest).where(ServiceRequest.tenant == tenant_id)
        .order_by(desc(ServiceRequest.created_at)).limit(5)
    )
    return result.scalars().all()


async def get_wallet(db: AsyncSession, user_id: str) -> Wallet | None:
    result = await db.execute(select(Wallet).where(Wallet.user_id == user_id))
    return result.scalar_one_or_none()


# ─── Message builders ─────────────────────────────────────────────────────────

def main_menu(tenant: Tenant) -> str:
    outstanding = tenant.rent_outstanding + tenant.service_charge_outstanding
    icon = "🔴" if outstanding > 0 else "🟢"
    return (
        f"🏠 *{tenant.tenant_name}* — {tenant.unit_label}\n"
        f"{icon} Outstanding: *₦{outstanding:,.0f}*\n\n"
        "*What would you like to do?*\n\n"
        "📊 /dashboard — Full overview\n"
        "💰 /balance — Rent & service charge\n"
        "📋 /payments — Payment history\n"
        "🧾 /billing — Pending bills\n"
        "🔧 /issues — My maintenance issues\n"
        "📝 /report — Report a new issue\n"
        "🔨 /requests — Service requests\n"
        "🔔 /notifications — My notifications\n"
        "👛 /wallet — Wallet balance\n"
        "🚪 /logout — Log out"
    )


def dashboard_text(tenant: Tenant, wallet: Wallet | None, bills: list[BillingItem]) -> str:
    outstanding = tenant.rent_outstanding + tenant.service_charge_outstanding
    icon = "🔴" if outstanding > 0 else "🟢"
    pending_bills = sum(b.amount for b in bills)
    due_str = tenant.next_due_date.strftime("%d %b %Y") if tenant.next_due_date else "N/A"
    return (
        f"📊 *Dashboard — {tenant.tenant_name}*\n"
        f"━━━━━━━━━━━━━━━━━\n"
        f"🏠 Unit: *{tenant.unit_label}*\n"
        f"📅 Next Due: *{due_str}*\n\n"
        f"💰 *Financials*\n"
        f"  Rent: ₦{tenant.rent_amount:,.0f}/mo\n"
        f"  Service Charge: ₦{tenant.service_charge_amount:,.0f}/mo\n"
        f"  {icon} Outstanding: ₦{outstanding:,.0f}\n"
        f"  🧾 Pending Bills: ₦{pending_bills:,.0f}\n"
        f"  👛 Wallet: ₦{wallet.balance:,.0f}\n\n"
        f"Quick actions:\n"
        f"/balance · /payments · /billing · /issues · /requests"
    )


def balance_text(tenant: Tenant) -> str:
    due_str = tenant.next_due_date.strftime("%d %b %Y") if tenant.next_due_date else "N/A"
    return (
        f"💰 *Rent & Charges — {tenant.tenant_name}*\n"
        f"━━━━━━━━━━━━━━━━━\n"
        f"Monthly Rent:       ₦{tenant.rent_amount:,.0f}\n"
        f"Rent Outstanding:   ₦{tenant.rent_outstanding:,.0f}\n\n"
        f"Service Charge:     ₦{tenant.service_charge_amount:,.0f}\n"
        f"S/C Outstanding:    ₦{tenant.service_charge_outstanding:,.0f}\n"
        f"━━━━━━━━━━━━━━━━━\n"
        f"*Total Due: ₦{tenant.rent_outstanding + tenant.service_charge_outstanding:,.0f}*\n"
        f"Next Due: {due_str}"
    )


def payments_text(payments: list[Payment]) -> str:
    if not payments:
        return "📋 No payment records found."
    lines = ["📋 *Recent Payments*\n"]
    for p in payments:
        icon = "✅" if p.payment_status in ("success", "completed") else "⏳"
        lines.append(
            f"{icon} ₦{p.amount:,.0f} — {p.payment_type}\n"
            f"   {p.created_at.strftime('%d %b %Y')} | {p.payment_status.title()}"
        )
    return "\n".join(lines)


def billing_text(bills: list[BillingItem]) -> str:
    if not bills:
        return "🧾 No pending bills."
    total = sum(b.amount for b in bills)
    lines = [f"🧾 *Pending Bills* — Total: ₦{total:,.0f}\n"]
    for b in bills:
        overdue = b.due_date and b.due_date < datetime.utcnow()
        flag = "🔴" if overdue else "🟡"
        due = b.due_date.strftime("%d %b") if b.due_date else "No due date"
        lines.append(f"{flag} {b.label} — ₦{b.amount:,.0f} (due {due})")
    return "\n".join(lines)


def issues_text(issues: list[Issue]) -> str:
    if not issues:
        return "✅ No open maintenance issues."
    lines = ["🔧 *Open Issues*\n"]
    for i, iss in enumerate(issues, 1):
        p_icon = {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(iss.priority, "⚪")
        lines.append(
            f"{i}. {p_icon} *{iss.title}*\n"
            f"   Status: {iss.status.title()} · {iss.created_at.strftime('%d %b')}"
        )
    return "\n".join(lines)


def service_requests_text(requests: list[ServiceRequest]) -> str:
    if not requests:
        return "🔨 No service requests found."
    lines = ["🔨 *Service Requests*\n"]
    for r in requests:
        s_icon = {"completed": "✅", "pending": "⏳", "in_progress": "🔄"}.get(r.status, "⚪")
        lines.append(
            f"{s_icon} *{r.title}*\n"
            f"   {r.status.title()} · {r.created_at.strftime('%d %b %Y')}"
        )
    return "\n".join(lines)


def notifications_text(notifs: list[Notification]) -> str:
    if not notifs:
        return "🔔 No notifications."
    unread = sum(1 for n in notifs if not n.is_read)
    lines = [f"🔔 *Notifications* ({unread} unread)\n"]
    for n in notifs:
        dot = "🔵" if not n.is_read else "⚪"
        lines.append(
            f"{dot} *{n.title}*\n"
            f"   {n.message[:80]}{'...' if len(n.message) > 80 else ''}\n"
            f"   {n.created_at.strftime('%d %b %Y')}"
        )
    return "\n".join(lines)


def wallet_text(wallet: Wallet | None) -> str:
    if not wallet:
        return "👛 No wallet found for your account."
    return (
        f"👛 *Wallet Balance*\n"
        f"━━━━━━━━━━━━━━━━━\n"
        f"Balance: *₦{wallet.balance:,.2f}* {wallet.currency}\n\n"
        f"Use /payments to see your payment history."
    )


# ─── State machine ────────────────────────────────────────────────────────────

async def handle(db: AsyncSession, telegram_id: str, text: str, first_name: str | None) -> str:
    session = await get_or_create_session(db, telegram_id)
    text = text.strip()
    cmd = text.lower()

    # ── Global logout ─────────────────────────────────────────────────────────
    if cmd in ("/logout", "logout"):
        await update_session(db, session, state="idle", user_id=None, tenant_id=None,
                             role=None, temp_email=None, context=None)
        return "👋 Logged out. Send /tenant to login again."

    # ── Logged in — dispatch commands ─────────────────────────────────────────
    if session.state == "logged_in" and session.tenant_id:
        tenant = await get_tenant(db, session.tenant_id)
        if not tenant:
            await update_session(db, session, state="idle", tenant_id=None)
            return "Session expired. Send /tenant to login again."

        if cmd in ("/dashboard", "dashboard"):
            wallet = await get_wallet(db, session.user_id) if session.user_id else None
            bills = await get_pending_bills(db, session.user_id) if session.user_id else []
            return dashboard_text(tenant, wallet, bills)

        if cmd in ("/balance", "balance"):
            return balance_text(tenant)

        if cmd in ("/payments", "payments"):
            p = await get_recent_payments(db, tenant.id)
            return payments_text(p)

        if cmd in ("/billing", "billing"):
            bills = await get_pending_bills(db, session.user_id) if session.user_id else []
            return billing_text(bills)

        if cmd in ("/issues", "issues"):
            iss = await get_open_issues(db, tenant.id)
            return issues_text(iss)

        if cmd in ("/report", "report"):
            await update_session(db, session, state="tenant:report_issue")
            return (
                "📝 *Report a Maintenance Issue*\n\n"
                "Describe the problem in detail (location, what happened, urgency).\n\n"
                "Send /cancel to go back."
            )

        if cmd in ("/requests", "requests"):
            reqs = await get_service_requests(db, tenant.id)
            return service_requests_text(reqs)

        if cmd in ("/notifications", "notifications"):
            notifs = await get_notifications(db, session.user_id) if session.user_id else []
            return notifications_text(notifs)

        if cmd in ("/wallet", "wallet"):
            wallet = await get_wallet(db, session.user_id) if session.user_id else None
            return wallet_text(wallet)

        if cmd in ("/menu", "menu", "/start", "/help"):
            return main_menu(tenant)

        return main_menu(tenant)

    # ── Tenant: reporting issue ───────────────────────────────────────────────
    if session.state == "tenant:report_issue":
        if cmd in ("/cancel", "cancel"):
            await update_session(db, session, state="logged_in")
            tenant = await get_tenant(db, session.tenant_id)
            return main_menu(tenant) if tenant else "Send /menu for options."

        tenant = await get_tenant(db, session.tenant_id)
        if tenant:
            issue = Issue(
                title=text[:100],
                description=text,
                category="general",
                priority="medium",
                status="open",
                stage="review",
                estate=tenant.estate,
                unit=tenant.unit,
                tenant=tenant.id,
                reporter=session.user_id,
            )
            db.add(issue)
            await db.commit()
            await update_session(db, session, state="logged_in")
            return (
                "✅ *Issue Reported!*\n\n"
                f"_{text[:100]}_\n\n"
                "Status: Open · Priority: Medium\n"
                "Management has been notified. Track with /issues."
            )
        return "Something went wrong. Try again."

    # ── Awaiting password ─────────────────────────────────────────────────────
    if session.state == "awaiting_password":
        if cmd in ("/cancel", "cancel"):
            await update_session(db, session, state="idle", temp_email=None)
            return "Login cancelled. Send /tenant to try again."

        email = session.temp_email
        if not email:
            await update_session(db, session, state="idle")
            return "Session lost. Send /tenant to start over."

        user = await find_user_by_email(db, email)
        if not user or not verify_password(text, user.password):
            return "❌ Incorrect password. Try again or /cancel."

        if not user.is_active:
            await update_session(db, session, state="idle", temp_email=None)
            return "❌ Your account has been deactivated. Contact management."

        tenant = await find_tenant_by_user(db, user.id)
        if not tenant:
            await update_session(db, session, state="idle", temp_email=None)
            return "❌ No active tenancy linked to this account.\nContact management if this is wrong."

        tenant.telegram_id = telegram_id
        await db.commit()
        await update_session(db, session, state="logged_in", user_id=user.id,
                             tenant_id=tenant.id, role=user.role, temp_email=None)
        return "✅ *Login successful!*\n\n" + main_menu(tenant)

    # ── Awaiting email ────────────────────────────────────────────────────────
    if session.state == "awaiting_email":
        if cmd in ("/cancel", "cancel"):
            await update_session(db, session, state="idle")
            return "Login cancelled."

        if "@" not in text:
            return "Please enter a valid email address."

        user = await find_user_by_email(db, text)
        if not user:
            return (
                "❌ No account found with that email.\n"
                "Use the email registered with management.\n\n"
                "Try again or /cancel."
            )

        await update_session(db, session, state="awaiting_password", temp_email=text.lower())
        return f"✉️ Account found: *{user.name}*\n\nPlease send your password:"

    # ── Idle / entry ──────────────────────────────────────────────────────────
    await update_session(db, session, state="awaiting_email")
    return (
        "🏠 *BamiHustle Tenant Portal*\n\n"
        "Enter your registered email address to login.\n\n"
        "/cancel to go back."
    )
