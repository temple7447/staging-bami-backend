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


# ── Payment receipt (classic letterhead-table layout) ─────────────────────────
# Faithful to the original paper receipt: company name top-left with a logo
# box top-right, "RECEIPT + DATE" title bar, then ONE continuous bordered
# two-column table — blue labels/values, red outstanding rows, green current
# tenancy rate, gold next tenancy rate — and the red adjustment notice below.
# Everything is dynamic per estate (name, address, increase %, cycle, dates).

R_BLUE  = HexColor("#4472c4")
R_GREEN = HexColor("#70ad47")
R_GOLD  = HexColor("#bf9000")
R_RED   = HexColor("#ff0000")
R_GREY  = HexColor("#e7e6e6")

_CO_NAME = ParagraphStyle("co",   fontName="Helvetica-Bold", fontSize=20, textColor=R_BLUE, leading=24)
_CO_SUB  = ParagraphStyle("cos",  fontName="Helvetica",      fontSize=11, textColor=INK, leading=15)
_LOGO_TX = ParagraphStyle("lg",   fontName="Helvetica-Bold", fontSize=10, textColor=white, alignment=1, leading=13)
_NOTICE_T = ParagraphStyle("rnt", fontName="Helvetica-Bold", fontSize=11, textColor=R_RED, leading=14)
_NOTICE_B = ParagraphStyle("rnb", fontName="Helvetica",      fontSize=10, textColor=R_RED, leading=13)


def generate_receipt_pdf(receipt_data: dict, tenant_info: dict, estate_info: dict) -> bytes:
    """Classic tenancy receipt.

    tenant_info:  tenant_name, phone, meter_no, bedroom_type, flat_type,
                  move_in_date, expiry_date
    receipt_data: payment_date, reference, amount, rent, rent_outstanding,
                  service_charge, service_charge_outstanding, caution_fee, legal_fee,
                  outstanding_balance, current_total, next_total, current_year,
                  next_year, tenancy_duration, tenant_total_stay, year_duration,
                  next_increase_date, next_rent_increase,
                  next_service_charge_increase, total_increase
    estate_info:  name, address, phone, increase_percent, increase_cycle_years
    """
    rd, ti, ei = receipt_data or {}, tenant_info or {}, estate_info or {}
    cw = content_width()
    name = (ei.get("name") or "BamiHost").upper()
    initials = "".join(w[0] for w in name.split()[:2]).upper() or "BH"

    # Letterhead: name/address/tel left, logo box right
    left_lines = [Paragraph(name, _CO_NAME)]
    if ei.get("address"):
        left_lines.append(Paragraph(str(ei["address"]).upper(), _CO_SUB))
    if ei.get("phone"):
        left_lines.append(Paragraph(f"Tel: {ei['phone']}", _CO_SUB))
    logo = Table([[Paragraph(initials, _LOGO_TX)]], colWidths=[70], rowHeights=[70])
    logo.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HexColor("#0056b3")),
        ("BOX",        (0, 0), (-1, -1), 1.2, HexColor("#2c5aa0")),
        ("VALIGN",     (0, 0), (-1, -1), "MIDDLE"),
    ]))
    header = Table([[left_lines, logo]], colWidths=[cw - 90, 90])
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN",  (1, 0), (1, 0), "RIGHT"),
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))

    # RECEIPT title (grey highlight) + date
    title = Table(
        [["RECEIPT", f"DATE: {_fmt_date(rd.get('payment_date'))}"]],
        colWidths=[cw * 0.5, cw * 0.5])
    title.setStyle(TableStyle([
        ("FONTNAME",  (0, 0), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE",  (0, 0), (-1, -1), 13),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("BACKGROUND", (0, 0), (0, 0), R_GREY),
        ("ALIGN",     (1, 0), (1, 0), "RIGHT"),
        ("LEFTPADDING",   (0, 0), (0, 0), 6),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))

    # The one continuous table. Each row: (label, value, color)
    rows = [
        ("TENANT FULL NAME:", ti.get("tenant_name") or "", R_BLUE),
        ("PHONE NUMBER:",     ti.get("phone") or "", R_BLUE),
        ("Meter No:",         ti.get("meter_no") or "", R_BLUE),
    ]
    if ti.get("bedroom_type"):
        rows.append(("BEDROOM TYPE:", str(ti["bedroom_type"]).upper(), R_BLUE))
    rows += [
        ("FLAT TYPE:",     str(ti.get("flat_type") or "").upper(), R_BLUE),
        ("MOVE IN DATE:",  _fmt_date(ti.get("move_in_date")).upper(), R_BLUE),
        ("EXPIRY DATE:",   _fmt_date(ti.get("expiry_date")).upper(), R_BLUE),
        ("AMOUNT PAID:",   fmt_naira(rd.get("amount")), R_GREEN),
        ("RENT:",          fmt_naira(rd.get("rent")), R_BLUE),
        ("RENT OUTSTANDING:", fmt_naira(rd.get("rent_outstanding")), R_RED),
        ("SERVICE CHARGE:",   fmt_naira(rd.get("service_charge")), R_BLUE),
        ("SERVICE CHARGE OUTSTANDING:", fmt_naira(rd.get("service_charge_outstanding")), R_RED),
        ("1 TIME CAUTION FEE:", fmt_naira(rd.get("caution_fee")), R_BLUE),
        ("1 TIME LEGAL FEE:",   fmt_naira(rd.get("legal_fee")), R_BLUE),
        ("OUTSTANDING BALANCE:", fmt_naira(rd.get("outstanding_balance")), R_RED),
        (f"CURRENT TOTAL TENANCY RATE: {rd.get('current_year') or ''}",
         fmt_naira(rd.get("current_total")), R_GREEN),
        (f"NEXT TOTAL TENANCY RATE {rd.get('next_year') or ''}:",
         fmt_naira(rd.get("next_total")), R_GOLD),
        ("TENANCY DURATION:",  rd.get("tenancy_duration") or "", R_BLUE),
        ("TENANT TOTAL STAY:", rd.get("tenant_total_stay") or "", R_BLUE),
        ("YEAR DURATION:",     rd.get("year_duration") or "", R_BLUE),
    ]

    pct = ei.get("increase_percent") or 0
    cyc = int(ei.get("increase_cycle_years") or 0)
    inc_date = _fmt_date(rd.get("next_increase_date")).upper()
    if pct and cyc > 0 and rd.get("next_increase_date"):
        rows += [
            (f"NEXT RENTAL INCREASE BY ({pct:g}%) ON {inc_date}:",
             fmt_naira(rd.get("next_rent_increase")), R_RED),
            (f"NEXT SERVICE CHARGE INCREASE BY ({pct:g}%) ON {inc_date}:",
             fmt_naira(rd.get("next_service_charge_increase")), R_RED),
            (f"TOTAL TENANCY RATE INCREASE BY ({pct:g}%) ON {inc_date}:",
             fmt_naira(rd.get("total_increase")), R_RED),
        ]

    label_style = ParagraphStyle("rl", fontName="Helvetica-Bold", fontSize=10, leading=12)
    value_style = ParagraphStyle("rv", fontName="Helvetica",      fontSize=10, leading=12)
    data, styles = [], [
        ("GRID",          (0, 0), (-1, -1), 0.75, INK),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",    (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
        ("LEFTPADDING",   (0, 0), (-1, -1), 6),
    ]
    for idx, (label, value, color) in enumerate(rows):
        ls = ParagraphStyle(f"rl{idx}", parent=label_style, textColor=color)
        vs = ParagraphStyle(f"rv{idx}", parent=value_style, textColor=color)
        data.append([Paragraph(label, ls), Paragraph(str(value), vs)])
    tbl = Table(data, colWidths=[cw * 0.5, cw * 0.5], repeatRows=0)
    tbl.setStyle(TableStyle(styles))

    story = [header, Spacer(1, 8), title, tbl]

    if pct and cyc > 0:
        yrs = f"every {'two (2)' if cyc == 2 else f'{cyc}'} year{'s' if cyc != 1 else ''}"
        story += [
            Spacer(1, 10),
            Paragraph("Important Notice Regarding Rent Adjustment", _NOTICE_T),
            Paragraph(
                f"Please be advised that there will be a {pct:g}% increase in the combined Rent "
                f"and Service Charge applicable {yrs} of continuous tenancy. We appreciate "
                "your understanding and continued residency.", _NOTICE_B),
        ]

    ref = rd.get("reference") or ""
    story += [
        Spacer(1, 8),
        Paragraph(f"BamiHost Property Management System{' • Ref: ' + ref if ref else ''} • "
                  f"Generated {utcnow().strftime('%d %b %Y')}", _FOOT),
    ]
    return build_document(story)
