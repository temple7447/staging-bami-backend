"""PDF invoices/statements and payment receipts for contracts.

Built on the shared design system in utils.pdf_service (same letterhead, blue
section bars and zebra rows as the rent receipts). Helvetica has no naira glyph,
so amounts print as "NGN 100,000" / "USD 27.49".
"""
from xml.sax.saxutils import escape

from reportlab.lib.colors import white
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import HRFlowable, Paragraph, Spacer, Table, TableStyle

from utils.pdf_service import (
    BORDER, BRAND_BLUE, GREEN, INK, MUTED, RED, ZEBRA, _FOOT,
    build_document, content_width, section_table, total_row,
)

# Own header styles (explicit leading) so the name, contact line and title never overlap.
_NAME = ParagraphStyle("cn", fontName="Helvetica-Bold", fontSize=18, textColor=BRAND_BLUE, alignment=1, leading=22)
_CONTACT = ParagraphStyle("cc", fontName="Helvetica", fontSize=9, textColor=MUTED, alignment=1, leading=12)
_TITLE = ParagraphStyle("ct", fontName="Helvetica-Bold", fontSize=13, textColor=INK, alignment=1, leading=17)
from utils.time_utils import utcnow


def money(amount, currency: str = "NGN") -> str:
    try:
        amount = float(amount or 0)
    except (TypeError, ValueError):
        amount = 0.0
    if currency == "USD":
        return f"USD {amount:,.2f}"
    return f"NGN {amount:,.2f}" if abs(amount % 1) > 0 else f"NGN {amount:,.0f}"


def _date(v) -> str:
    if not v:
        return "-"
    try:
        from datetime import datetime
        return datetime.fromisoformat(str(v).replace("Z", "")).strftime("%d %b %Y")
    except ValueError:
        return str(v)


def _header(name: str, contact: str, title: str, when) -> list:
    out = [Paragraph(escape((name or "Bami Host").upper()), _NAME)]
    if contact:
        out.append(Paragraph(contact, _CONTACT))
    out += [Spacer(1, 8), HRFlowable(width="100%", thickness=2.5, color=BRAND_BLUE), Spacer(1, 8),
            Paragraph(escape(title.upper()), _TITLE), Spacer(1, 2),
            Paragraph(f"DATE: {_date(when) if when else _date(utcnow().isoformat())}", _CONTACT), Spacer(1, 12)]
    return out


def _grid(headers: list, rows: list, widths: list, content_w: float) -> Table:
    """Header bar + zebra rows for multi-column lists (schedule, payments)."""
    tbl = Table([headers] + rows, colWidths=[content_w * w for w in widths], repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BRAND_BLUE),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 1), (-1, -1), INK),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, ZEBRA]),
    ]))
    return tbl


def _footer(reference: str) -> list:
    return [
        Spacer(1, 16),
        HRFlowable(width="100%", thickness=0.5, color=BORDER),
        Spacer(1, 6),
        Paragraph(f"Ref: {escape(reference)} - Generated {utcnow().strftime('%d %b %Y %H:%M')} UTC - Bami Host", _FOOT),
    ]


def _issuer_lines(developer: dict) -> str:
    return " - ".join(escape(x) for x in (developer.get("email"), developer.get("phone")) if x)


def generate_invoice_pdf(contract: dict, developer: dict) -> bytes:
    """Invoice for what is still owed (or a 'paid in full' statement when nothing is)."""
    cur = contract["currency"]
    w = content_width()
    balance = contract["balance"]
    number = f"INV-{contract['id'][:6].upper()}-{utcnow():%Y%m%d}"
    confirmed = [p for p in contract["payments"] if p.get("status") == "confirmed"]
    pending = [p for p in contract["payments"] if p.get("status") == "pending"]

    story = _header(developer.get("name"), _issuer_lines(developer),
                    "INVOICE" if balance > 0.005 else "STATEMENT - PAID IN FULL", None)
    story += [
        section_table("Invoice details", [
            ("Invoice number", number),
            ("Contract", contract["title"]),
            ("Bill to", contract.get("client_name") or "-"),
            ("Currency", "US Dollar (USD)" if cur == "USD" else "Naira (NGN)"),
        ], w),
        Spacer(1, 10),
        section_table("Summary", [
            ("Agreed total", money(contract["total_amount"], cur)),
            ("Received so far", money(contract["paid"], cur), GREEN),
            ("Still owed", money(balance, cur), RED if balance > 0.005 else GREEN),
        ], w),
        total_row("BALANCE DUE" if balance > 0.005 else "BALANCE", money(balance, cur), w,
                  RED if balance > 0.005 else GREEN),
        Spacer(1, 12),
    ]

    nxt = contract.get("next_due")
    if nxt and balance > 0.005:
        story += [Paragraph(
            f"<b>Next payment:</b> {escape(nxt['label'])} - {money(nxt['outstanding'], cur)}"
            + (f" - due {_date(nxt.get('due_date'))}" if nxt.get("due_date") else ""),
            _FOOT.clone("np", alignment=0, textColor=INK, fontSize=10)), Spacer(1, 10)]

    if contract["instalments"]:
        status = {"paid": "Paid", "partial": "Part paid", "unpaid": "To pay"}
        rows = [[i["label"], _date(i.get("due_date")) if i.get("due_date") else "-", money(i["amount"], cur),
                 "Overdue" if i.get("overdue") else status.get(i["status"], i["status"])]
                for i in contract["instalments"]]
        story += [_grid(["PAYMENT", "DUE", "AMOUNT", "STATUS"], rows, [0.38, 0.2, 0.24, 0.18], w), Spacer(1, 12)]

    if confirmed:
        rows = [[_date(p["paid_on"]), money(p["amount"], cur),
                 " - ".join(x for x in (p.get("method"), p.get("note")) if x) or "-"] for p in confirmed]
        story += [_grid(["DATE RECEIVED", "AMOUNT", "HOW / NOTE"], rows, [0.25, 0.25, 0.5], w), Spacer(1, 8)]

    if pending:
        story.append(Paragraph(
            f"{len(pending)} payment(s) totalling {money(sum(p['amount'] for p in pending), cur)} "
            "are awaiting confirmation and are not included above.",
            _FOOT.clone("pn", alignment=0, textColor=MUTED, fontSize=8)))
    story += _footer(number)
    return build_document(story)


def generate_receipt_pdf(contract: dict, payment: dict, developer: dict, balance_after: float) -> bytes:
    cur = contract["currency"]
    w = content_width()
    number = f"RCT-{contract['id'][:6].upper()}-{payment['id'][:6].upper()}"

    story = _header(developer.get("name"), _issuer_lines(developer), "PAYMENT RECEIPT", payment.get("paid_on"))
    story += [
        section_table("Receipt", [
            ("Receipt number", number),
            ("Date received", _date(payment.get("paid_on"))),
            ("Received from", contract.get("client_name") or "-"),
            ("Received by", developer.get("name") or "-"),
        ], w),
        Spacer(1, 10),
        section_table("Payment for", [
            ("Contract", contract["title"]),
            ("Agreed total", money(contract["total_amount"], cur)),
            ("How it was paid", payment.get("method") or "-"),
            ("Note", payment.get("note") or "-"),
        ], w),
        total_row("AMOUNT RECEIVED", money(payment["amount"], cur), w, GREEN),
        Spacer(1, 10),
        section_table("Balance", [
            ("Still owed after this payment", money(balance_after, cur),
             RED if balance_after > 0.005 else GREEN),
        ], w),
    ]
    story += _footer(number)
    return build_document(story)
