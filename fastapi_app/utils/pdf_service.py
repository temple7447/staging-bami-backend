"""
PDF receipt generator — Python port of emailService.js generateReceiptPdf().
Uses ReportLab (already in requirements.txt).
"""
import io
from datetime import datetime
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor
from utils.time_utils import utcnow

# Brand colours (matching JS original)
C_BLUE    = HexColor("#4472c4")
C_GREEN   = HexColor("#70ad47")
C_GOLD    = HexColor("#ffc000")
C_RED     = HexColor("#ff0000")
C_GREY    = HexColor("#e7e6e6")
C_BLACK   = HexColor("#000000")
C_WHITE   = HexColor("#ffffff")
C_DKBLUE  = HexColor("#0056b3")


def _fmt(amount) -> str:
    """Format a numeric amount as a PDF-safe Naira string."""
    try:
        return f"N {float(amount or 0):,.0f}"
    except (TypeError, ValueError):
        return "N 0"


def generate_receipt_pdf(receipt_data: dict, tenant_info: dict, estate_info: dict) -> bytes:
    """
    Build a PDF receipt in memory and return the raw bytes.

    receipt_data keys (all optional, will default to 0/""):
        paymentDate, moveInDate, expiryDate, currentYear, nextYear, yearDuration,
        tenancyDuration, tenantTotalStay, rentAmount, rentOutstanding, serviceCharge,
        serviceChargeOutstanding, cautionFee, legalFee, outstandingBalance,
        currentTotalTenancyRate, nextTotalTenancyRate, nextIncreaseDate,
        nextRentIncrease, nextServiceChargeIncrease, totalTenancyRateIncrease

    tenant_info keys: tenantName, unitLabel
    estate_info keys: name (unused, kept for parity)
    """
    buf = io.BytesIO()
    w, h = A4          # 595.28 x 841.89
    margin_l = margin_r = 30
    content_w = w - margin_l - margin_r

    c = canvas.Canvas(buf, pagesize=A4)

    # ── Header ────────────────────────────────────────────────────────────────
    c.setFont("Helvetica-Bold", 22)
    c.setFillColor(C_BLUE)
    c.drawString(margin_l, h - 50, "SAMFRED")
    c.setFont("Helvetica-Bold", 16)
    c.drawString(margin_l, h - 70, "GLOBAL RESOURCES LTD")

    c.setFont("Helvetica", 12)
    c.setFillColor(C_BLACK)
    c.drawString(margin_l, h - 90, "BALADO ESTATE MASON IFIE OFF MATRIX DEPOT")
    c.drawString(margin_l, h - 106, "Tel: 07052258160, 0905665358")

    # Logo box
    logo_x = w - margin_r - 80
    c.setFillColor(C_DKBLUE)
    c.setStrokeColor(HexColor("#2c5aa0"))
    c.rect(logo_x, h - 120, 80, 80, fill=1, stroke=1)
    c.setFillColor(C_WHITE)
    c.setFont("Helvetica-Bold", 10)
    c.drawCentredString(logo_x + 40, h - 75, "SAM FRED")
    c.drawCentredString(logo_x + 40, h - 88, "LOGO")

    c.setFillColor(C_BLACK)
    c.setFont("Helvetica", 10)
    for i, label in enumerate(["1 BED ROOM", "2 BED ROOMS", "3 BED ROOMS"]):
        c.drawRightString(w - margin_r, h - 140 - i * 12, label)

    # ── Receipt title + date ──────────────────────────────────────────────────
    title_y = h - 165
    c.setFillColor(C_GREY)
    c.rect(margin_l, title_y - 5, 100, 25, fill=1, stroke=0)
    c.setFillColor(C_BLACK)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(margin_l + 5, title_y, "RECEIPT")
    payment_date = receipt_data.get("paymentDate", utcnow().strftime("%d/%m/%Y"))
    c.drawRightString(w - margin_r, title_y, f"DATE: {payment_date}")

    # Horizontal rule
    rule_y = title_y - 12
    c.setStrokeColor(C_BLACK)
    c.setLineWidth(2)
    c.line(margin_l, rule_y, w - margin_r, rule_y)

    # ── Rows ──────────────────────────────────────────────────────────────────
    col1_w    = 260
    col2_w    = content_w - col1_w
    row_h     = 22
    current_y = rule_y - row_h

    def draw_row(label, value, label_color=C_BLUE, value_color=C_BLUE, bold=True):
        nonlocal current_y
        c.setStrokeColor(HexColor("#999999"))
        c.setLineWidth(0.5)
        c.rect(margin_l,          current_y, col1_w, row_h, fill=0)
        c.rect(margin_l + col1_w, current_y, col2_w, row_h, fill=0)
        c.setFillColor(label_color)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(margin_l + 8, current_y + 6, label)
        c.setFillColor(value_color)
        c.setFont("Helvetica-Bold" if bold else "Helvetica", 11)
        c.drawString(margin_l + col1_w + 8, current_y + 6, str(value or ""))
        current_y -= row_h

    rd = receipt_data
    draw_row("TENANT FULL NAME:",   tenant_info.get("tenantName", ""))
    draw_row("BEDROOM TYPE:",       tenant_info.get("unitLabel", "Standard"))
    draw_row("FLAT TYPE:",          tenant_info.get("unitLabel", ""))
    draw_row("MOVE IN DATE:",       rd.get("moveInDate", ""))
    draw_row("EXPIRY DATE:",        rd.get("expiryDate", ""))
    draw_row("RENT:",               _fmt(rd.get("rentAmount", 0)))
    draw_row("RENT OUTSTANDING:",   _fmt(rd.get("rentOutstanding", 0)), value_color=C_RED)
    draw_row("SERVICE CHARGE:",     _fmt(rd.get("serviceCharge", 0)))
    draw_row("SERVICE CHARGE OUTSTANDING:", _fmt(rd.get("serviceChargeOutstanding", 0)), value_color=C_RED)
    draw_row("1 TIME CAUTION FEE:", _fmt(rd.get("cautionFee", 0)))
    draw_row("1 TIME LEGAL FEE:",   _fmt(rd.get("legalFee", 0)))
    draw_row("OUTSTANDING BALANCE:", _fmt(rd.get("outstandingBalance", 0)), value_color=C_RED)
    draw_row(
        f"CURRENT TOTAL TENANCY RATE: {rd.get('currentYear', '')}",
        _fmt(rd.get("currentTotalTenancyRate", 0)),
        label_color=C_GREEN, value_color=C_GREEN,
    )
    draw_row(
        f"NEXT TOTAL TENANCY RATE {rd.get('nextYear', '')}:",
        _fmt(rd.get("nextTotalTenancyRate", 0)),
        label_color=C_GOLD, value_color=C_GOLD,
    )
    draw_row("TENANCY DURATION:",   rd.get("tenancyDuration", "1 YEAR"))
    draw_row("TENANT TOTAL STAY:",  rd.get("tenantTotalStay", "1st YEAR"))
    draw_row("YEAR DURATION",       rd.get("yearDuration", ""))

    inc_date = rd.get("nextIncreaseDate", "")
    draw_row(
        f"NEXT RENTAL INCREASE BY (26%) ON {inc_date}:",
        _fmt(rd.get("nextRentIncrease", 0)),
        label_color=C_RED, value_color=C_RED,
    )
    draw_row(
        f"NEXT SERVICE CHARGE INCREASE BY (26%) {inc_date}:",
        _fmt(rd.get("nextServiceChargeIncrease", 0)),
        label_color=C_RED, value_color=C_RED,
    )
    draw_row(
        f"TOTAL TENANCY RATE INCREASE BY (26%) ON {inc_date}:",
        _fmt(rd.get("totalTenancyRateIncrease", 0)),
        label_color=C_RED, value_color=C_RED,
    )

    # ── Footer notice ─────────────────────────────────────────────────────────
    footer_y = current_y - 20
    c.setFont("Helvetica-Bold", 12)
    c.setFillColor(C_RED)
    c.drawString(margin_l, footer_y, "Important Notice Regarding Rent Adjustment")
    c.setFont("Helvetica", 10)
    c.setFillColor(C_BLACK)
    notice = (
        "Please be advised that there will be a 26% increase in the combined Rent and "
        "Service Charge applicable every two (2) years of continuous tenancy. We appreciate "
        "your understanding and continued residency."
    )
    from reportlab.lib.utils import simpleSplit
    lines = simpleSplit(notice, "Helvetica", 10, content_w)
    text_y = footer_y - 16
    for line in lines:
        c.drawString(margin_l, text_y, line)
        text_y -= 14

    c.save()
    return buf.getvalue()
