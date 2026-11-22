"""Apology sent to a user whose withdrawal took longer than it should have to pay out.

When an admin marks a withdrawal as paid and at least DELAY_THRESHOLD_DAYS have passed since the user
requested it, the user gets the same apology as an in-app notification and as an email.
"""
import logging
from datetime import datetime
from html import escape
from typing import Optional

from core.db_helpers import save
from models.base import gen_uuid
from models.notification import Notification
from models.user import User
from models.withdrawal import Withdrawal
from utils import email_service

logger = logging.getLogger(__name__)

DELAY_THRESHOLD_DAYS = 3
# Statuses that mean the money is being / has been paid out.
PAID_STATES = {"approved", "completed", "paid"}


def delay_days(requested_at: Optional[datetime], paid_at: Optional[datetime]) -> Optional[int]:
    """Whole days between the request and the payout (None when either date is missing)."""
    if not requested_at or not paid_at:
        return None
    return max(int((paid_at - requested_at).total_seconds() // 86400), 0)


def _date(d: datetime) -> str:
    return f"{d.day} {d.strftime('%B %Y')}"


def _bank(details: Optional[dict]) -> tuple[str, str, str]:
    """(bank name, account name, masked account number) from however the details were saved."""
    d = details or {}
    bank = d.get("bank_name") or d.get("bankName") or ""
    holder = d.get("account_name") or d.get("accountName") or ""
    number = str(d.get("account_number") or d.get("accountNumber") or "")
    masked = f"ending {number[-4:]}" if len(number) >= 4 else ""
    return bank, holder, masked


def build_delay_apology(*, name: str, amount: float, requested_at: datetime, paid_at: datetime,
                        days: int, bank_details: Optional[dict], paid_state: str) -> dict:
    """The apology text: a short version for the notification box and a full HTML email."""
    first = (name or "there").split()[0]
    money = email_service.format_currency(amount)
    bank, holder, masked = _bank(bank_details)
    where = " ".join(x for x in (f"your {bank} account" if bank else "your bank account", masked) if x)
    is_paid = paid_state != "approved"
    day_text = f"{days} day{'s' if days != 1 else ''}"

    if is_paid:
        status_short = f"Your payment has now been made to {where}."
        status_long = "We are pleased to confirm that your payment has now been made."
        paid_label = "Date paid"
    else:
        status_short = f"Your withdrawal has now been approved and is being paid to {where}. Please allow a short time for the funds to reflect."
        status_long = "Your withdrawal has now been approved and is being paid to your account."
        paid_label = "Date approved"

    title = "Our apologies for the delay in your withdrawal"
    message = (
        f"Dear {first}, we sincerely apologise for the delay in processing your withdrawal. "
        f"Your request for {money} on {_date(requested_at)} took {day_text}, which is longer than it should have. "
        f"{status_short} Thank you for your patience and for trusting BamiHost."
    )

    rows = [("Amount", money), ("Date requested", _date(requested_at)), (paid_label, _date(paid_at)),
            ("Time taken", day_text)]
    if bank or masked:
        rows.append(("Paid to", " · ".join(x for x in (bank, holder, masked.replace("ending ", "account ending ")) if x)))
    table = "".join(
        f"<tr><td style='padding:8px 12px;color:#6b7280;border-bottom:1px solid #e5e7eb'>{escape(k)}</td>"
        f"<td style='padding:8px 12px;font-weight:600;border-bottom:1px solid #e5e7eb'>{escape(v)}</td></tr>"
        for k, v in rows)
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#111827;line-height:1.55">
      <h2 style="color:#0d5936;margin-bottom:4px">Our apologies for the delay</h2>
      <p>Dear {escape(first)},</p>
      <p>We sincerely apologise for the delay in processing your withdrawal. Your request for
         <strong>{escape(money)}</strong>, made on {escape(_date(requested_at))}, took <strong>{escape(day_text)}</strong>
         to complete. That is longer than it should have taken, and we understand how inconvenient and concerning
         this can be.</p>
      <p>{escape(status_long)}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px">
        {table}
      </table>
      <p>Depending on your bank, the funds may take a short while to reflect. If you do not see them, please contact
         us through the Support section of the BamiHost app and we will look into it straight away.</p>
      <p>Thank you for your patience and understanding. We are working to make sure withdrawals are processed
         promptly in future.</p>
      <p>Yours sincerely,<br/><strong>The BamiHost Team</strong></p>
    </div>"""
    return {"title": title, "message": message, "subject": title, "html": html}


async def send_delay_apology(db, w: Withdrawal, recipient: User, paid_state: str, paid_at: datetime, days: int) -> dict:
    """Send the apology to the user's notification box and email. Failures never raise: the payout
    status change that triggered this must not be undone because a message could not be sent."""
    content = build_delay_apology(
        name=recipient.name, amount=w.amount, requested_at=w.created_at, paid_at=paid_at, days=days,
        bank_details=w.bank_details, paid_state=paid_state)
    result = {"notification": False, "email": None, "days": days}
    try:
        await save(db, Notification(id=gen_uuid(), user=recipient.id, title=content["title"],
                                    message=content["message"], type="withdrawal_delay_apology"))
        result["notification"] = True
    except Exception as e:  # noqa: BLE001
        logger.error("Withdrawal apology notification failed for %s: %s", w.id, e)
    if recipient.email:
        try:
            sent = await email_service.send_email(recipient.email, content["subject"], html=content["html"], name=recipient.name)
            result["email"] = bool(sent.get("success"))
        except Exception as e:  # noqa: BLE001
            logger.error("Withdrawal apology email failed for %s: %s", w.id, e)
            result["email"] = False
    return result
