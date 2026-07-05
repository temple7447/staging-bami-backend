"""
Unified PDF design system for every document BamiHost generates
(payment receipts, tenant statements, …).

One visual language everywhere:
  • Letterhead: the estate/business name (dynamic — never a hardcoded client),
    address lines, a blue rule, the document title and date.
  • Blue section bars, zebra rows, thin grey grid.
  • Red for outstanding amounts, green for paid/clear.
  • Amber notice box for the estate's rent-increase policy — only when the
    estate actually has one configured (cycle_years > 0).
  • Footer: "BamiHost Property Management System • Ref … • generated date".

Uses ReportLab platypus so content flows across pages.
"""
import io
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor, white
from reportlab.lib.units import cm
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable,
)
from utils.time_utils import utcnow

# ── Design tokens (matched to the frontend print template) ────────────────────
BRAND_BLUE  = HexColor("#1d4ed8")
LABEL_BLUE  = HexColor("#2563eb")
INK         = HexColor("#1e293b")
MUTED       = HexColor("#64748b")
RED         = HexColor("#dc2626")
GREEN       = HexColor("#16a34a")
ZEBRA       = HexColor("#f8fafc")
BORDER      = HexColor("#e2e8f0")
TOTAL_BG    = HexColor("#eff6ff")
AMBER_BG    = HexColor("#fffbeb")
AMBER_EDGE  = HexColor("#fde68a")
AMBER_INK   = HexColor("#92400e")

_TITLE   = ParagraphStyle("t",  fontName="Helvetica-Bold", fontSize=18, textColor=BRAND_BLUE, alignment=1)
_SUB     = ParagraphStyle("s",  fontName="Helvetica",      fontSize=9,  textColor=MUTED, alignment=1, leading=12)
_DOCT    = ParagraphStyle("d",  fontName="Helvetica-Bold", fontSize=13, textColor=INK, alignment=1, spaceBefore=6)
_NOTE_T  = ParagraphStyle("nt", fontName="Helvetica-Bold", fontSize=9,  textColor=AMBER_INK)
_NOTE_P  = ParagraphStyle("np", fontName="Helvetica",      fontSize=8,  textColor=HexColor("#78350f"), leading=11)
_FOOT    = ParagraphStyle("f",  fontName="Helvetica",      fontSize=8,  textColor=HexColor("#94a3b8"), alignment=1)


def fmt_naira(amount) -> str:
    """PDF-safe Naira string (Helvetica has no ₦ glyph)."""
    try:
        return f"NGN {float(amount or 0):,.0f}"
    except (TypeError, ValueError):
        return "NGN 0"


def _fmt_date(value) -> str:
    if isinstance(value, datetime):
        return value.strftime("%d %b %Y")
    return str(value or "")


def brand_header(business_name: str, address: str = "", doc_title: str = "RECEIPT",
                 doc_date=None) -> list:
    """Shared letterhead: business name, address, blue rule, title, date."""
    flows = [
        Paragraph((business_name or "BamiHost").upper(), _TITLE),
        Spacer(1, 4),
    ]
    if address:
        flows.append(Paragraph(address, _SUB))
    flows += [
        Spacer(1, 8),
        HRFlowable(width="100%", thickness=2.5, color=BRAND_BLUE),
        Paragraph(f"<font name='Helvetica-Bold'>{doc_title.upper()}</font>", _DOCT),
        Paragraph(f"DATE: {_fmt_date(doc_date or utcnow())}", _SUB),
        Spacer(1, 10),
    ]
    return flows


def section_table(title: str, rows: list, content_w: float) -> Table:
    """A titled section: blue header bar + label/value zebra rows.

    rows: list of (label, value) or (label, value, value_color).
    """
    data = [[title.upper(), ""]]
    styles = [
        ("SPAN",       (0, 0), (1, 0)),
        ("BACKGROUND", (0, 0), (1, 0), BRAND_BLUE),
        ("TEXTCOLOR",  (0, 0), (1, 0), white),
        ("FONTNAME",   (0, 0), (1, 0), "Helvetica-Bold"),
        ("FONTSIZE",   (0, 0), (-1, -1), 9),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("LINEBELOW",  (0, 0), (-1, -2), 0.4, BORDER),
        ("FONTNAME",   (0, 1), (0, -1), "Helvetica-Bold"),
        ("TEXTCOLOR",  (0, 1), (0, -1), LABEL_BLUE),
        ("TEXTCOLOR",  (1, 1), (1, -1), INK),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [white, ZEBRA]),
    ]
    for idx, r in enumerate(rows, start=1):
        label, value = r[0], r[1]
        data.append([label, str(value if value is not None else "")])
        if len(r) > 2 and r[2] is not None:
            styles.append(("TEXTCOLOR", (1, idx), (1, idx), r[2]))
            styles.append(("FONTNAME", (1, idx), (1, idx), "Helvetica-Bold"))
    tbl = Table(data, colWidths=[content_w * 0.55, content_w * 0.45])
    tbl.setStyle(TableStyle(styles))
    return tbl


def total_row(label: str, value: str, content_w: float, value_color=None) -> Table:
    """Emphasised single-row total, visually attached to the section above it."""
    tbl = Table([[label, value]], colWidths=[content_w * 0.55, content_w * 0.45])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), TOTAL_BG),
        ("FONTNAME",   (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE",   (0, 0), (-1, -1), 9),
        ("TEXTCOLOR",  (0, 0), (0, 0), INK),
        ("TEXTCOLOR",  (1, 0), (1, 0), value_color or INK),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("LINEABOVE",  (0, 0), (-1, 0), 0.4, BORDER),
    ]))
    return tbl


def increase_notice(percent: float, cycle_years: int, content_w: float) -> list:
    """Amber policy notice — only rendered when the estate has a cycle configured."""
    if not cycle_years or cycle_years <= 0 or not percent:
        return []
    yrs = f"every {cycle_years} year{'s' if cycle_years != 1 else ''}"
    body = (f"Please be advised that there is a {percent:g}% increase in the combined "
            f"Rent and Service Charge applicable {yrs} of continuous tenancy. "
            "We appreciate your understanding and continued residency.")
    inner = Table(
        [[Paragraph("Important Notice Regarding Rent Adjustment", _NOTE_T)],
         [Paragraph(body, _NOTE_P)]],
        colWidths=[content_w - 12],
    )
    inner.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), AMBER_BG),
        ("BOX",        (0, 0), (-1, -1), 0.8, AMBER_EDGE),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return [Spacer(1, 14), inner]


def brand_footer(reference: str = "") -> list:
    ref = f" • Ref: {reference}" if reference else ""
    return [
        Spacer(1, 16),
        HRFlowable(width="100%", thickness=0.5, color=BORDER),
        Spacer(1, 6),
        Paragraph(f"BamiHost Property Management System{ref} • "
                  f"Generated {utcnow().strftime('%d %b %Y %H:%M')} UTC", _FOOT),
    ]


def build_document(story: list) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, rightMargin=1.8 * cm, leftMargin=1.8 * cm,
                            topMargin=1.6 * cm, bottomMargin=1.6 * cm)
    doc.build(story)
    return buf.getvalue()


def content_width() -> float:
    w, _ = A4
    return w - 2 * (1.8 * cm)


# ── Payment receipt ────────────────────────────────────────────────────────────

def generate_receipt_pdf(receipt_data: dict, tenant_info: dict, estate_info: dict) -> bytes:
    """Build the standard BamiHost payment receipt.

    receipt_data: reference, payment_date, amount, payment_type, payment_status, method
    tenant_info:  tenant_name, phone, unit_label, meter_no, move_in_date, expiry_date,
                  rent, service_charge, rent_outstanding, service_charge_outstanding
    estate_info:  name, address, increase_percent, increase_cycle_years
    """
    rd, ti, ei = receipt_data or {}, tenant_info or {}, estate_info or {}
    cw = content_width()

    story = brand_header(ei.get("name") or "BamiHost", ei.get("address") or "",
                         "Payment Receipt", rd.get("payment_date"))

    story.append(section_table("Payment Details", [
        ("Reference",    rd.get("reference") or ""),
        ("Payment Date", _fmt_date(rd.get("payment_date"))),
        ("Payment Type", (rd.get("payment_type") or "").replace("_", " ").title()),
        ("Method",       (rd.get("method") or "wallet").replace("_", " ").title()),
        ("Status",       (rd.get("payment_status") or "").title(),
         GREEN if rd.get("payment_status") in ("completed", "success", "paid") else None),
    ], cw))
    story.append(total_row("Amount Paid", fmt_naira(rd.get("amount")), cw, GREEN))
    story.append(Spacer(1, 12))

    tenant_rows = [
        ("Tenant Full Name", ti.get("tenant_name") or ""),
        ("Phone Number",     ti.get("phone") or "—"),
        ("Unit",             ti.get("unit_label") or "—"),
    ]
    if ti.get("meter_no"):
        tenant_rows.append(("Meter No", ti["meter_no"]))
    tenant_rows += [
        ("Move In Date", _fmt_date(ti.get("move_in_date"))),
        ("Next Due Date", _fmt_date(ti.get("expiry_date"))),
    ]
    story.append(section_table("Tenant Information", tenant_rows, cw))
    story.append(Spacer(1, 12))

    rent_out = float(ti.get("rent_outstanding") or 0)
    svc_out  = float(ti.get("service_charge_outstanding") or 0)
    summary_rows = [
        ("Rent (annual)",           fmt_naira(ti.get("rent"))),
        ("Service Charge (annual)", fmt_naira(ti.get("service_charge"))),
    ]
    if rent_out > 0:
        summary_rows.append(("Rent Outstanding", fmt_naira(rent_out), RED))
    if svc_out > 0:
        summary_rows.append(("Service Charge Outstanding", fmt_naira(svc_out), RED))
    story.append(section_table("Account Summary", summary_rows, cw))
    outstanding = rent_out + svc_out
    story.append(total_row("Outstanding Balance", fmt_naira(outstanding), cw,
                           RED if outstanding > 0 else GREEN))

    story += increase_notice(ei.get("increase_percent") or 0,
                             int(ei.get("increase_cycle_years") or 0), cw)
    story += brand_footer(rd.get("reference") or "")
    return build_document(story)
