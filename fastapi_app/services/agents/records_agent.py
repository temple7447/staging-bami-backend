"""Records agent — the team's document controller / records manager.

Every company that survives an audit has someone whose whole job is the files:
complete records, a clean payment trail, and a register where anything can be
found in under a minute. Most BamiHost owners have no such person. This agent
plays that role with the document controller's three core skills:

  1. Meticulous accuracy  → inspects every tenant file for missing critical
     fields (phone, email, entry date, due date, unit, meter number).
  2. Audit-trail discipline → flags payments that break the money trail:
     stuck in "pending" for days, or completed with no reference.
  3. Fast retrieval → compiles the filing register — a per-estate index of
     what is on file, what is expired, and what is simply missing.
"""
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.tenant import Tenant
from models.estate import Estate
from models.payment import Payment
from models.user import User
from models.autopilot_action import AutopilotAction
from services.agents.base import AgentMeta, ai_text, make_action, owner_estate_ids
from utils.time_utils import utcnow

META = AgentMeta(
    key="records",
    name="Records",
    emoji="🗂️",
    description="The document controller — keeps every tenant file complete, the payment trail auditable, and a filing register the owner can trust.",
    # The register is an internal report that never leaves the business, so it
    # is safe to auto-execute. Fixing files and reconciling payments change
    # records, so they always wait for a human.
    auto_safe=["document_register"],
)

# A payment still "pending" after this long has broken the audit trail — it
# either failed silently or was confirmed outside the system.
STALE_PENDING_HOURS = 48

# The fields a tenant file must carry to count as complete, with the label a
# document controller would write on the missing-item slip.
CRITICAL_FIELDS = [
    ("tenant_phone", "phone number"),
    ("tenant_email", "email"),
    ("entry_date", "move-in date"),
    ("next_due_date", "next due date"),
    ("unit_label", "unit"),
    ("electric_meter_number", "meter number"),
]

COMPLETED = ("completed", "confirmed", "success")


def _missing_fields(tenant: Tenant) -> list[str]:
    return [label for attr, label in CRITICAL_FIELDS if not getattr(tenant, attr, None)]


async def scan(db: AsyncSession, user: User) -> list[AutopilotAction]:
    uid = str(user.id)
    estate_ids = await owner_estate_ids(db, user)
    if not estate_ids:
        return []

    now = utcnow()
    rows = (await db.execute(
        select(Tenant, Estate).join(Estate, Tenant.estate == Estate.id).where(
            Tenant.estate.in_(estate_ids),
            Tenant.is_active == True,  # noqa: E712
        )
    )).all()
    if not rows:
        return []

    actions: list[AutopilotAction] = []

    # ── Skill 1: file completeness ────────────────────────────────────────
    incomplete = [(t, e, _missing_fields(t)) for t, e in rows if _missing_fields(t)]
    # A tenant with neither phone nor email is unreachable — that file is not
    # just untidy, it is a tenant the owner cannot contact in an emergency.
    unreachable = [t.tenant_name for t, _, miss in incomplete
                   if "phone number" in miss and "email" in miss]

    if incomplete:
        slips = [f"{t.tenant_name} ({t.unit_label or 'no unit'} @ {e.name}): missing {', '.join(miss)}"
                 for t, e, miss in incomplete[:10]]
        extra = len(incomplete) - 10
        if extra > 0:
            slips.append(f"…and {extra} more file(s)")

        guidance = await ai_text(
            "You are a records manager for a Nigerian property business. In under 100 words, explain "
            "why incomplete tenant files (missing phone, email, dates, meter numbers) cost real money "
            "when a dispute, emergency, or audit comes, and give a 3-step plan to complete them this "
            "week. Practical and calm.",
            f"{len(incomplete)} of {len(rows)} tenant files are incomplete. "
            f"Missing-item slips: {'; '.join(slips)}. "
            f"Unreachable tenants (no phone AND no email): {', '.join(unreachable) or 'none'}.")

        actions.append(make_action(
            uid, "records", "incomplete_file",
            f"Tenant files incomplete — {len(incomplete)} of {len(rows)} need attention",
            "These tenant files are missing critical details. Complete them so every tenant is "
            "reachable and every record stands up in a dispute.",
            guidance + "\n\nMISSING-ITEM SLIPS\n" + "\n".join(f"• {s}" for s in slips),
            "internal", "records_review",
            {"incomplete_count": len(incomplete), "total_files": len(rows),
             "unreachable": unreachable, "as_of": now.strftime("%Y-%m-%d")},
            priority="high" if unreachable else "medium"))

    # ── Skill 2: payment audit trail ──────────────────────────────────────
    stale_cutoff = now - timedelta(hours=STALE_PENDING_HOURS)
    payments = (await db.execute(
        select(Payment).where(Payment.estate.in_(estate_ids))
    )).scalars().all()

    stale = [p for p in payments if p.payment_status == "pending" and p.created_at
             and p.created_at < stale_cutoff]
    unreferenced = [p for p in payments if p.payment_status in COMPLETED and not p.reference]

    if stale or unreferenced:
        tenant_names = {str(t.id): t.tenant_name for t, _ in rows}

        def _line(p: Payment) -> str:
            who = tenant_names.get(str(p.tenant), "unknown tenant")
            when = p.created_at.strftime("%d %b %Y") if p.created_at else "no date"
            return f"₦{(p.amount or 0):,.0f} — {who}, {p.payment_type or 'payment'}, {when}"

        details = []
        if stale:
            details.append("STUCK IN PENDING (>48h)\n" + "\n".join(f"• {_line(p)}" for p in stale[:8]))
        if unreferenced:
            details.append("COMPLETED WITHOUT REFERENCE\n" + "\n".join(f"• {_line(p)}" for p in unreferenced[:8]))

        guidance = await ai_text(
            "You are a records manager auditing a Nigerian property business's payment trail. In under "
            "90 words, explain the risk of payments stuck in pending or completed without a reference "
            "(money that cannot be traced or proven), and give a short reconciliation checklist: "
            "confirm with the bank, attach the reference, mark failed ones failed.",
            f"Stale pending payments (>{STALE_PENDING_HOURS}h): {len(stale)}. "
            f"Completed payments with no reference: {len(unreferenced)}.")

        actions.append(make_action(
            uid, "records", "payment_audit",
            f"Payment trail needs reconciling — {len(stale)} stuck, {len(unreferenced)} unreferenced",
            "These payments break the audit trail. Reconcile each one so every naira can be traced "
            "and proven.",
            guidance + "\n\n" + "\n\n".join(details),
            "internal", "payment_audit",
            {"stale_pending": len(stale), "unreferenced": len(unreferenced),
             "as_of": now.strftime("%Y-%m-%d")},
            priority="high"))

    # ── Skill 3: the filing register ──────────────────────────────────────
    # The register itself is deterministic — a document controller's index is
    # only useful if it says the same thing every time the facts are the same.
    # The AI writes just the cover note on top.
    month_ago = now - timedelta(days=30)
    register_lines: list[str] = []
    for eid in estate_ids:
        e_rows = [(t, e) for t, e in rows if str(t.estate) == str(eid)]
        if not e_rows:
            continue
        estate = e_rows[0][1]
        complete = sum(1 for t, _ in e_rows if not _missing_fields(t))
        current = sum(1 for t, _ in e_rows if t.lease_end_date and t.lease_end_date >= now)
        expired = sum(1 for t, _ in e_rows if t.lease_end_date and t.lease_end_date < now)
        no_agreement = len(e_rows) - current - expired
        e_pays = [p for p in payments if str(p.estate) == str(eid)
                  and p.payment_status in COMPLETED and p.created_at and p.created_at >= month_ago]
        register_lines.append(
            f"{estate.name}\n"
            f"  Tenant files: {len(e_rows)} ({complete} complete, {len(e_rows) - complete} incomplete)\n"
            f"  Agreements: {current} current, {expired} expired, {no_agreement} not on file\n"
            f"  Payments (last 30 days): {len(e_pays)} totalling ₦{sum(p.amount or 0 for p in e_pays):,.0f}")

    if register_lines:
        cover = await ai_text(
            "You are a records manager presenting the monthly filing register to a Nigerian property "
            "owner. In 2-3 sentences, state the single most important thing the register shows and "
            "what to do about it first. No greetings, no fluff.",
            "Register:\n" + "\n".join(register_lines))

        actions.append(make_action(
            uid, "records", "document_register",
            f"Filing register — {now.strftime('%d %b %Y')}",
            "Your filing index: what is on file, what is expired, and what is missing — across every "
            "estate, in one place.",
            cover + "\n\nFILING REGISTER — " + now.strftime("%d %b %Y").upper()
            + "\n\n" + "\n\n".join(register_lines),
            "internal", "filing_register",
            {"estates": len(register_lines), "files": len(rows),
             "as_of": now.strftime("%Y-%m-%d")},
            priority="low", auto_execute=True))

    return actions
