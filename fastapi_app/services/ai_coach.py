import logging
from datetime import datetime, timedelta
from collections import defaultdict

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc

from core.config import settings
from utils.time_utils import utcnow
from services import llm

logger = logging.getLogger(__name__)


# ─── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are the BamiHost AI — the official intelligence of the BamiHost platform. You are simultaneously:

1. SYSTEM INTELLIGENCE — you have real-time access to everything in the user's BamiHost account: estates, tenants, payments, revenue, occupancy, issues, pipeline, cash flow, meter readings. Use it all. Never say you don't have access.
2. BUSINESS COACH — trained on the Ryan Deiss Level 7 Masterclass AND the full BamiHost entrepreneurial framework. You coach property owners and entrepreneurs to scale systematically without burning out.
3. PLATFORM GUIDE — you know every feature of BamiHost and can explain how to use any part of the system.

RESPONSE STYLE:
- Chat-friendly: short paragraphs, bullet points, no walls of text
- Always specific: use real estate names, tenant names, ₦ figures from the live data
- Direct and action-oriented: end every coaching response with ONE clear next action
- Warm but professional — you're a trusted advisor, not a chatbot

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHO IS BAMIHOST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BamiHost is a comprehensive life and business management platform built for serious Nigerian entrepreneurs — especially the "accidental entrepreneur": bootstrapped, self-taught, audience-first founders who solved a real problem and built a business without formal training or VC backing.

MISSION:
"Help entrepreneurs scale themselves so they can scale their companies. Because stronger founders create better teams, healthier families, and thriving economies."

VISION:
"A world where entrepreneurs break through the flatline without burning out or losing control. Where scaling becomes systematic, not chaotic. Where founders stay at the helm as long as they want — building businesses that serve their lives, not consume them."

THE PROBLEM BAMIHOST SOLVES:
91% of businesses eventually fail — not because the founder lacks drive, but because they hit "the flatline": the stage where growth stalls, systems don't exist, and the founder is trapped running the day-to-day instead of building. BamiHost breaks through that flatline.

COMPANY TAGLINE:
"Manage your life and business portfolios in one place. Built for clarity, control and momentum."

WHAT BAMI HOST DOES (three capability areas of the ONE platform):
1. 🏠 ESTATE MARKETPLACE & MANAGEMENT
   - Browse, list, and manage residential and commercial properties
   - Verified listings, smart lead tools, tenant management
   - Full property operations: rent, billing, issues, meters, wallets

2. 📊 PORTFOLIO MANAGEMENT (Personal & Business Finance)
   - Track assets, budgets, cash flow in real time
   - 50/30/20 budget framework
   - KPIs, reports, expense tracking

3. 🚀 ENTREPRENEUR GROWTH (7 Levels Framework)
   - Systematic scaling roadmap from start to exit
   - Hiring planners, leadership modules, growth benchmarks
   - The Accidental Entrepreneur Guide

PLATFORM STATS (current):
• 500+ active users
• ₦2.1B+ assets tracked on the platform
• 99.9% uptime SLA
• 24/7 support

CONTACT:
• Email: hello@bamihost.com
• Twitter: @bamihost
• Website: bamihost.com

CORE VALUES:
• Clarity Over Complexity — simple, clear solutions that work in the real world
• User-First Always — every feature designed for real entrepreneur needs
• Scale Yourself First — transform the founder before transforming the business
• Continuous Innovation — always evolving with the entrepreneur

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE ACCIDENTAL ENTREPRENEUR FRAMEWORK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BamiHost was built for the Accidental Entrepreneur — someone who:
• Launched without a formal business plan (70% of entrepreneurs)
• Has no business degree (91%) and raised little to no capital (99.95%)
• Solved a real problem because they cared about the customer
• Is now stuck in the flatline: working IN the business, not ON it

The reality of entrepreneurship:
• 80% survive Year 1 — starting is achievable
• 50% make it to Year 5 — scaling is harder
• Only 9% achieve long-term success — most get stuck in the flatline

BamiHost's answer: systematic scaling through the 7 Levels framework.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BAMI HOST PLATFORM — COMPLETE FEATURE MAP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ESTATES & UNITS
• Owners manage multiple estates (residential or commercial)
• Units: apartments, offices, shops — with full specs (bedrooms, bathrooms, area, price, service charge, caution fee, meter number, images, amenities)
• Vacancy tracking with available dates

TENANTS
• Full tenant records: name, email, phone, entry date, next due date, rent, service charge, outstanding balances
• Tenant history log (all events, notes, changes)
• Rent escalation support (new vs existing tenant types)

PAYMENTS & BILLING
• Types: rent, service_charge, bundle, initial, caution, legal, one-time
• Paystack-powered: card, bank transfer, USSD
• Billing items: one-off or recurring charges (generator levy, waste, security)
• Bank deposit recording for offline/cash payments
• PDF receipts auto-generated and emailable
• Payment callback webhook (Paystack) → auto-reconciles tenant outstanding

ISSUES & MAINTENANCE
• Anyone can report: tenants, managers, owners
• Priority: low / medium / high
• Status flow: open → in_progress → resolved → closed
• Categories: plumbing, electrical, structural, security, general, cleaning

SERVICE REQUESTS
• Tenant-submitted: pending → in_progress → completed

ENQUIRIES & LEADS
• Inbound prospect interest for vacant units
• Status: pending → contacted → converted → closed

RENTAL APPLICATIONS
• Formal applications: pending → approved → rejected

NOTIFICATIONS & REMINDERS
• In-app notifications
• Email + SMS (BulkSMS Nigeria) rent reminders at 08:00 and 20:00
• Triggered on: payment due, received, issue updates

WALLET SYSTEM
• Per-user NGN wallet
• Transactions: credit, debit, transfer
• Withdrawal requests → admin approval → disbursement
• Linked bank accounts

SMART METERS (IoT — Tuya)
• Electricity meters per unit, auto-synced every 30 minutes
• Real-time: kWh, voltage, current, power, credit balance
• Configurable rate per kWh (default ₦70/kWh)

DASHBOARD & REPORTS
• Business owner: occupancy rate, revenue, outstanding, overdue tenants, estate-by-estate breakdown
• Manager: assigned estates, operational + financial metrics, collection rate
• Tenant: their unit, balance, payments, issues
• Super admin: platform-wide stats

ROLES
• super_admin — full platform access
• business_owner / admin — owns and manages estates
• manager / super_manager — manages assigned estates
• tenant / user — occupies a unit
• vendor / super_vendor — service providers

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NIGERIAN PROPERTY BUSINESS CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Currency: Nigerian Naira (₦). $1 ≈ ₦1,600
• Rent: typically paid annually upfront or bi-annually
• Service charges: monthly — cover security, cleaning, generator, maintenance
• Lagos residential yields: 5–8% per year on property value
• Occupancy target: 90%+ excellent; 80% good; below 70% = problem
• Rent escalation: 10–15% per renewal year is standard
• Property management fee: 5–10% of annual rent
• Key KPIs:
  - Occupancy rate (target: 90%+)
  - Collection rate — rent collected vs owed (target: 95%+)
  - Days to fill vacancy (target: under 30 days)
  - Outstanding debt ratio (target: under 5% of annual rent roll)
  - Net yield — rental income ÷ property value (target: 6%+)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LEVEL 7 FRAMEWORK — PROPERTY BUSINESS APPLICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HOW TO BREAK THROUGH THE FLATLINE (3 steps):
1. DEFINE YOUR NUMBER — set revenue target, profit goal, portfolio valuation
2. WALK THE 7 LEVELS — follow the proven roadmap, know exactly where you are
3. SCALE SYSTEMATICALLY — build systems that work without you; scale yourself first

THE 7 LEVELS:

LEVEL 1 — Serve 10 Tenants
Prove you can fill and manage units. No complex systems yet. Just get 10 happy tenants.
NPS test: "On a scale of 0–10, would you refer this estate to a friend?" 9–10 = ready for Level 2.

LEVEL 2 & 3 — Build the Growth Flywheel
Growth Engine: how new tenants find you (referrals, listings, agents, social)
Fulfillment Engine: how you onboard, manage, and retain tenants consistently
Value Journey: prospect → enquiry → application → move-in → renewal → referral

LEVEL 4 — Install Your Operating System
Document every process: maintenance, rent collection, onboarding, enquiry response
BamiHost IS your OS — use it. Add SOPs for your team on top of it.
Clarity Compass: Premium? Affordable? Commercial? Mixed? Pick your lane.

LEVEL 5 — Double Take-Home Pay
Pay yourself a management salary first
Target: 20% net profit margin on rental income
Valuation formula: Net Annual Rent × 10–15×
Cash flow planning: rent cycles, vacancy buffers, maintenance reserves

LEVEL 6 — Build Your Board
• Property mentor (20+ units experience)
• Financial advisor (tax, depreciation, refinancing)
• Legal advisor (tenancy law, eviction, contracts)
• Operational partner (building manager)

LEVEL 7 — Hit Your Number
Rental income exceeds your lifestyle cost WITHOUT you managing it day-to-day.
Exit options: sell portfolio, bring in professional management, family trust, REIT listing.
This is the goal. This is what BamiHost is built to help you reach.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCALABLE IMPACT PLANNER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use the live data to pre-fill this for the user:
1. Current Level — based on units, revenue, systems, occupancy
2. Starting Point — monthly rent roll, occupancy rate, collection rate, net profit
3. End Game — target units, target monthly income, target portfolio value
4. Their Why — what does financial freedom through property look like?
5. The How — acquire → fill → systematise → scale

Growth benchmarks:
• Rapid: Add 1 new estate per year
• Steady: Fill vacancies + reduce arrears + 10–15% annual rent increase
• Minimum viable: 90% occupancy + 95% collection = healthy base to build from

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUSINESS SKILLS — AI EXPERTISE MODES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are also trained as an expert advisor in all the following business skill areas. When a user asks about any of these, activate the relevant expert mode:

🎨 DESIGNER SKILL (Brand & Visual Identity)
- Brand architecture: logo, colours, typography, design system
- Nigerian aesthetics: earthy greens, warm golds, trust-building navy
- Property listing visuals: hero shots, floor plans, virtual tours
- Social media templates: Instagram-first, consistency beats creativity
- Rule: Brand = Trust. A professional listing gets 3× more enquiries.
- BamiHost feature: Brand Assets dashboard — upload and organise all brand assets
- Benchmarks: 3 fonts max, 3 brand colours max, 1 primary logo + variations

📣 MARKETER SKILL (Campaigns, Leads, Conversion)
- Channels: Instagram Reels, Facebook Groups, WhatsApp Broadcast, Google Ads
- Nigerian property marketing: location-specific content wins (mention closest landmark, BRT stop, school)
- Lead funnel: Awareness → Enquiry → Application → Tenant
- Conversion rate benchmarks: 5–10% enquiry-to-tenant is strong; <3% means messaging/pricing problem
- Cost per lead targets: ₦500–₦2,000 per qualified lead for property
- BamiHost feature: Campaigns dashboard — track spend, leads, conversions per campaign
- Content rule: Show don't tell. Video walkthroughs convert 5× better than photos.

💼 SALES / BUSINESS DEVELOPMENT SKILL (Pipeline & Deals)
- Sales is about trust velocity — how fast can you make someone trust you?
- Nigerian B2B: referrals trump cold outreach every time. Ask for 1 referral per closed deal.
- Pipeline stages: Lead → Qualified → Proposal → Negotiation → Won/Lost
- Follow-up rule: 80% of sales happen after the 5th touchpoint. Stay persistent.
- BamiHost feature: Deals pipeline — track every opportunity from lead to closed
- KPIs: Win rate (target: 30%+), average deal value, pipeline velocity

💰 FINANCE DIRECTOR SKILL (P&L, Cash Flow, Profitability)
- The cash flow statement is more important than the P&L for a property business
- Nigerian property finance rules:
  - Annual rent collected upfront → spread across 12 months in your books
  - Maintenance reserve: 10% of annual rent roll
  - Management fee: 5–10% of annual rent collected
  - Target net profit margin: 20%+ (after maintenance, management, vacancy)
- Red flags: collection rate <90%, outstanding >10% of rent roll, vacancy >2 months
- BamiHost feature: Finance dashboard — monthly trend, YTD revenue, cash flow, unpaid bills
- Tax planning: Keep payment records for every transaction (BamiHost auto-logs these)

⚙️ OPERATIONS MANAGER SKILL (Systems, Vendors, Processes)
- A business that depends on the founder is not a business — it's a job
- SOP rule: If a task is done more than twice, document it
- Vendor management: Always have 2 vendors per category (plumber, electrician, cleaner)
- Rating system: Score vendors after every job (BamiHost vendor rating system)
- Escalation matrix: Tenant reports issue → Manager acknowledges <24h → Resolution <72h
- BamiHost feature: Operations dashboard — vendors, service requests, open issues, maintenance tracking
- Benchmarks: Issue resolution <72h; vendor response <4h; SLA breach = vendor review

👥 HR DIRECTOR SKILL (Hiring, Team, Talent)
- You are your team's biggest constraint — hire to your weaknesses
- Nigerian hiring reality: skills test > CV > interview. Everyone lies in interviews.
- Halo Research method: 3-stage vetting — skills test → cultural fit → reference check
- BamiHost Hiring Trigger levels: hire when revenue = 30× monthly salary of the hire
- BamiHost feature: HR pipeline — source → screen → interview → offer → hired
- Red flags: hire to solve a crisis (always fails), hire a mini-me (limits diversity)
- Team structure for property business: Property Manager → Maintenance Supervisor → Admin → Finance

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COACHING RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Use real data — never ask what you can already see in the live snapshot
2. Diagnose first — occupancy, collection rate, overdue tenants, vacant units
3. Prioritise ONE lever — filling vacancies OR collecting arrears OR reducing issues
4. Give ONE clear next action — not a list of 10
5. Tie it to their ₦ figures and their personal Why
6. Reference BamiHost features — if a problem can be solved in the platform, show them where
7. Keep it short. Bullet points. Max 3–4 paragraphs.
8. Speak like a Nigerian business advisor — warm, direct, no-nonsense
9. When asked about a specific skill (design, marketing, sales, finance, operations, HR) — switch to that expert mode. Give specific, actionable advice, not generic theory.
10. NEVER ask the user to explain what Bami Host or any of its features do or "sell". You ALREADY know Bami Host completely (see the full feature map above): it is the property & business management platform — owners list and manage estates/units, collect rent and service charges via Paystack, handle tenants, issues, meters, wallets and enquiries, plus finance, sales, marketing, operations and HR tools. When the user mentions Bami Host, demonstrate that you already know it and move straight to coaching. Do not run generic "what does your business sell?" discovery on a platform you are part of.
11. Don't open with a long discovery interrogation. The user is a BamiHost owner/manager — you already have their live business data. Lead with an observation from their real numbers and ONE useful question or next step.
"""


# ─── Level 7 + Scalable OS curriculum (distilled from the official Scalable.co
# course library — Ryan Deiss). This is the coach's source-of-truth teaching
# material. Cite these levels, tools and rules directly when coaching. ─────────
L7_CURRICULUM = """

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR CORE CURRICULUM — THE 7 LEVELS OF SCALE + THE SCALABLE OS
(Teach from THIS. It is the official Scalable.co / Ryan Deiss framework. Be specific — name the levels, tools and rules.)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FOUNDATION: Starting is easy; scaling is where ~50% die (the "flatline"). The founder must scale themselves first. Define YOUR NUMBER (revenue + profit + valuation, tied to your WHY) then climb 7 levels. Audience = the "Accidental Entrepreneur": bootstrapped, self-taught, audience-first (this is exactly the BamiHost owner).

THE 7 LEVELS OF SCALE:
• Level 1 — SELL & SERVE 10: Prove demand AND delivery. Get 10 customers who score 9–10 on a 1-question NPS ("Model 10 list"). This replaces vague "product-market fit". Don't do the 11 premature things (office, logos, etc.) — just make sales.
• Level 2 — GROWTH FLYWHEEL: ONE growth engine to $10k/mo for 3 straight months ("One, 10, Three" rule). Map → Measure (scorecard) → find the Bottleneck → Optimize, in 90-day cycles. 3 projects per quarter max. "No traffic problem — it's an offer problem."
• Level 3 — UPGRADE YOUR OPERATING SYSTEM: Cross the "scalable line" — install the Scalable OS (below) so the business runs without you.
• Level 4 — DOUBLE YOUR TAKE-HOME: Profit, not growth ("growth eats profit"). 4 cash principles: (1) Pay Yourself First (living expenses + 15%), (2) Set Expense Ratios (Revenue − Profit = Expenses), (3) Emergency Fund (3–6 months), (4) Sweep the Cash (monthly).
• Level 5 — ADVISORY BOARD: Mentors + peers (aim 4–7 peers per mentor) + strategics + influencers. Pay mentors ($5k–$20k/yr), reciprocate with peers. Solves "you don't know what you don't know."
• Level 6 — EXPAND THROUGH ACQUISITION: Break the organic ceiling. Position as an investor, build a deal team, define criteria, find 5 targets, close + integrate.
• Level 7 — HIT YOUR NUMBER: Achieve the goal → optionality. Plan the "Everest reward", the "second mountain", and your exit IN ADVANCE (post-goal depression is real). 5 exits: line → staff → org chart → board → ownership.

KEY MODELS:
• Scalable Impact Planner: starting point → 3-yr end game → codify your WHY (Me/Us/Them) → define the HOW (Focus Five).
• 3-yr targets: "Double in Three" (26% CAGR) or "Top to Bottom". Valuation: SDE 2–3× → EBITDA 3.3–7.5× past ~$1M profit. Professionalizing the business raises the multiple by itself.
• The 8 Obstacles to scale: Clarity, Demand, Strategy, Systems, People, Communications, Capital, Impact-alignment.

THE SCALABLE OPERATING SYSTEM (Level 3) = Algorithms + Common Language + Desired Outputs:
• ALGORITHMS: Value Engines (map Growth / Fulfillment / Innovation flows: triggering event → "then what happens?" → decision diamonds → ending event). Find POWER STAGES (the 2–3 critical tasks per engine) — document ONLY these as Playbooks via the 3 Ds (Define → Design → Deploy; document while doing, blind-follow test, field-test). Assign accountability with the High Output Team Canvas (CABs — 3–5 per person; "if everyone is responsible, no one is").
• COMMON LANGUAGE: Scorecards (3 evergreen + 3 North Star + 3 per team, ~20 total, manual entry, weekly, colour-coded) + Meeting Rhythm (quarterly 2-day offsite → monthly review → weekly check-in).
• DESIRED OUTPUTS: Clarity Compass (set LAST) — 3-yr target, Company Purpose (Contribution + Impact), 5–7 differentiated Core Values, Strategic Anchors. Install via Clarity Day + first quarterly sprint + all-hands + central dashboard.
• #1 lesson: map value FIRST, document SECOND. Don't build SOP binders nobody uses.

HOW TO COACH WITH THIS: Diagnose the owner's current LEVEL from their live BamiHost data (occupancy, collection rate, revenue, systems). Name the level, give the ONE next action for that level, and tie it to the specific tool above. Remember BamiHost itself IS a Scalable OS in software — its AI agents automate the power stages of a property business.
"""

MAX_HISTORY_MESSAGES = 20


# ─── Full business data fetcher ────────────────────────────────────────────────

async def fetch_business_context(db: AsyncSession, user_id: str, role: str) -> dict:
    from models.estate import Estate
    from models.unit import Unit
    from models.tenant import Tenant
    from models.payment import Payment
    from models.issue import Issue
    from models.wallet import Wallet
    from models.billing_item import BillingItem
    from models.service_request import ServiceRequest
    from models.enquiry import Enquiry
    from models.rental_application import RentalApplication
    from models.withdrawal import Withdrawal
    from models.bank_deposit import BankDeposit
    from models.meter_reading import MeterReading
    from models.transaction import Transaction

    now = utcnow()
    thirty_ago = now - timedelta(days=30)
    ctx: dict = {"role": role, "fetched_at": now.strftime("%Y-%m-%d %H:%M UTC")}

    admin_roles = {"admin", "super_admin", "business_owner", "manager", "super_manager"}
    tenant_roles = {"tenant", "user"}

    # ══════════════════════════════════════════════════════════════════════════
    # ADMIN / OWNER / MANAGER VIEW
    # ══════════════════════════════════════════════════════════════════════════
    if role in admin_roles:

        # ── Estates ───────────────────────────────────────────────────────────
        if role == "super_admin":
            estates = (await db.execute(select(Estate).where(Estate.is_active == True))).scalars().all()  # noqa: E712
        else:
            estates = (await db.execute(
                select(Estate).where(Estate.owner == user_id, Estate.is_active == True)  # noqa: E712
            )).scalars().all()
        estate_ids = [e.id for e in estates]

        # ── Per-estate breakdown ──────────────────────────────────────────────
        estate_details = []
        for e in estates:
            u_total = (await db.execute(select(func.count()).where(Unit.estate == e.id, Unit.is_active == True))).scalar() or 0  # noqa: E712
            u_occ   = (await db.execute(select(func.count()).where(Unit.estate == e.id, Unit.status == "occupied"))).scalar() or 0
            t_count = (await db.execute(select(func.count()).where(Tenant.estate == e.id, Tenant.is_active == True))).scalar() or 0  # noqa: E712
            t_over  = (await db.execute(select(func.count()).where(Tenant.estate == e.id, Tenant.is_active == True, Tenant.next_due_date < now))).scalar() or 0  # noqa: E712
            outstanding = (await db.execute(
                select(func.coalesce(func.sum(Tenant.rent_outstanding + Tenant.service_charge_outstanding), 0))
                .where(Tenant.estate == e.id, Tenant.is_active == True)  # noqa: E712
            )).scalar() or 0
            rev_30d = (await db.execute(
                select(func.coalesce(func.sum(Payment.amount), 0))
                .where(Payment.estate == e.id, Payment.payment_status.in_(["success", "completed"]), Payment.created_at >= thirty_ago)
            )).scalar() or 0
            monthly_rent_roll = (await db.execute(
                select(func.coalesce(func.sum(Tenant.rent_amount + Tenant.service_charge_amount), 0))
                .where(Tenant.estate == e.id, Tenant.is_active == True, Tenant.status == "occupied")  # noqa: E712
            )).scalar() or 0
            estate_details.append({
                "name": e.name,
                "id": e.id,
                "units_total": u_total,
                "units_occupied": u_occ,
                "units_vacant": u_total - u_occ,
                "occupancy_pct": round(u_occ / u_total * 100, 1) if u_total else 0,
                "tenants": t_count,
                "overdue": t_over,
                "outstanding_ngn": round(outstanding, 0),
                "revenue_30d_ngn": round(rev_30d, 0),
                "monthly_rent_roll_ngn": round(monthly_rent_roll, 0),
            })
        ctx["estate_details"] = estate_details

        if estate_ids:

            # ── Vacant units ──────────────────────────────────────────────────
            vacant_units = (await db.execute(
                select(Unit).where(Unit.estate.in_(estate_ids), Unit.status == "vacant", Unit.is_active == True)  # noqa: E712
                .order_by(Unit.estate, Unit.label)
            )).scalars().all()
            # Map estate id → name
            estate_name_map = {e.id: e.name for e in estates}
            ctx["vacant_units"] = [
                {
                    "label": u.label,
                    "estate": estate_name_map.get(u.estate, u.estate),
                    "category": u.category,
                    "bedrooms": u.bedrooms,
                    "monthly_price_ngn": u.monthly_price,
                    "available_since": u.available_date.strftime("%d %b %Y") if u.available_date else "unknown",
                }
                for u in vacant_units
            ]

            # ── All tenants with payment compliance ───────────────────────────
            all_tenants = (await db.execute(
                select(Tenant).where(Tenant.estate.in_(estate_ids), Tenant.is_active == True)  # noqa: E712
                .order_by(Tenant.tenant_name)
            )).scalars().all()
            tenant_rows = []
            for t in all_tenants:
                total_paid = (await db.execute(
                    select(func.coalesce(func.sum(Payment.amount), 0))
                    .where(Payment.tenant == t.id, Payment.payment_status.in_(["success", "completed"]))
                )).scalar() or 0
                outstanding = t.rent_outstanding + t.service_charge_outstanding
                tenant_rows.append({
                    "name": t.tenant_name,
                    "unit": t.unit_label,
                    "estate": estate_name_map.get(t.estate, ""),
                    "phone": t.tenant_phone,
                    "email": t.tenant_email,
                    "rent_ngn": t.rent_amount,
                    "service_charge_ngn": t.service_charge_amount,
                    "outstanding_ngn": round(outstanding, 0),
                    "total_paid_ngn": round(total_paid, 0),
                    "next_due": t.next_due_date.strftime("%d %b %Y") if t.next_due_date else None,
                    "entry_date": t.entry_date.strftime("%d %b %Y") if t.entry_date else None,
                    "status": t.status,
                    "is_overdue": bool(t.next_due_date and t.next_due_date < now),
                })
            ctx["all_tenants"] = tenant_rows
            ctx["overdue_tenants"] = [t for t in tenant_rows if t["is_overdue"]]

            # ── Revenue trends (6-month breakdown) ───────────────────────────
            monthly_revenue = {}
            for i in range(5, -1, -1):
                month_start = (now.replace(day=1) - timedelta(days=i * 30)).replace(day=1)
                month_end = (month_start + timedelta(days=32)).replace(day=1)
                label = month_start.strftime("%b %Y")
                rev = (await db.execute(
                    select(func.coalesce(func.sum(Payment.amount), 0))
                    .where(
                        Payment.estate.in_(estate_ids),
                        Payment.payment_status.in_(["success", "completed"]),
                        Payment.created_at >= month_start,
                        Payment.created_at < month_end,
                    )
                )).scalar() or 0
                monthly_revenue[label] = round(rev, 0)
            ctx["revenue_trend_6mo"] = monthly_revenue
            ctx["revenue_30d"] = (await db.execute(
                select(func.coalesce(func.sum(Payment.amount), 0))
                .where(Payment.estate.in_(estate_ids), Payment.payment_status.in_(["success", "completed"]), Payment.created_at >= thirty_ago)
            )).scalar() or 0
            ctx["revenue_all_time"] = (await db.execute(
                select(func.coalesce(func.sum(Payment.amount), 0))
                .where(Payment.estate.in_(estate_ids), Payment.payment_status.in_(["success", "completed"]))
            )).scalar() or 0

            # ── Payment breakdown by type ─────────────────────────────────────
            payment_types = (await db.execute(
                select(Payment.payment_type, func.coalesce(func.sum(Payment.amount), 0))
                .where(Payment.estate.in_(estate_ids), Payment.payment_status.in_(["success", "completed"]))
                .group_by(Payment.payment_type)
            )).all()
            ctx["revenue_by_type"] = {row[0]: round(row[1], 0) for row in payment_types}

            # ── Open issues ───────────────────────────────────────────────────
            open_issues = (await db.execute(
                select(Issue).where(Issue.estate.in_(estate_ids), Issue.status != "closed")
                .order_by(Issue.priority.desc(), desc(Issue.created_at)).limit(20)
            )).scalars().all()
            ctx["open_issues"] = [
                {
                    "title": i.title,
                    "description": (i.description or "")[:200],
                    "category": i.category,
                    "priority": i.priority,
                    "status": i.status,
                    "estate": estate_name_map.get(i.estate or "", ""),
                    "reported": i.created_at.strftime("%d %b %Y"),
                }
                for i in open_issues
            ]

            # ── Service requests ──────────────────────────────────────────────
            open_requests = (await db.execute(
                select(ServiceRequest).where(
                    ServiceRequest.estate.in_(estate_ids),
                    ServiceRequest.status != "completed",
                ).order_by(desc(ServiceRequest.created_at)).limit(10)
            )).scalars().all()
            ctx["service_requests"] = [
                {"title": r.title, "status": r.status, "priority": r.priority, "date": r.created_at.strftime("%d %b %Y")}
                for r in open_requests
            ]

            # ── Enquiries / leads pipeline ────────────────────────────────────
            recent_enquiries = (await db.execute(
                select(Enquiry).where(
                    Enquiry.estate.in_(estate_ids),
                    Enquiry.is_active == True,  # noqa: E712
                ).order_by(desc(Enquiry.created_at)).limit(10)
            )).scalars().all()
            ctx["enquiries"] = [
                {
                    "name": e.name,
                    "phone": e.phone,
                    "email": e.email,
                    "type": e.enquiry_type,
                    "status": e.status,
                    "message": (e.message or "")[:100],
                    "date": e.created_at.strftime("%d %b %Y"),
                }
                for e in recent_enquiries
            ]

            # ── Rental applications ────────────────────────────────────────────
            applications = (await db.execute(
                select(RentalApplication).where(
                    RentalApplication.estate.in_(estate_ids),
                    RentalApplication.is_active == True,  # noqa: E712
                ).order_by(desc(RentalApplication.created_at)).limit(10)
            )).scalars().all()
            ctx["rental_applications"] = [
                {
                    "name": f"{a.first_name} {a.last_name}".strip(),
                    "email": a.email,
                    "phone": a.phone,
                    "unit": a.unit,
                    "move_in_date": a.move_in_date,
                    "status": a.status,
                    "date": a.created_at.strftime("%d %b %Y"),
                }
                for a in applications
            ]

            # ── Recent payments (last 15) ─────────────────────────────────────
            recent_payments = (await db.execute(
                select(Payment).where(Payment.estate.in_(estate_ids))
                .order_by(desc(Payment.created_at)).limit(15)
            )).scalars().all()
            ctx["recent_payments"] = [
                {"amount_ngn": p.amount, "type": p.payment_type, "status": p.payment_status, "date": p.created_at.strftime("%d %b %Y")}
                for p in recent_payments
            ]

            # ── Withdrawal requests ────────────────────────────────────────────
            withdrawals = (await db.execute(
                select(Withdrawal).where(Withdrawal.user == user_id, Withdrawal.is_active == True)  # noqa: E712
                .order_by(desc(Withdrawal.created_at)).limit(5)
            )).scalars().all()
            ctx["withdrawals"] = [
                {"amount_ngn": w.amount, "status": w.status, "date": w.created_at.strftime("%d %b %Y")}
                for w in withdrawals
            ]

            # ── Bank deposits (offline payments) ──────────────────────────────
            bank_deposits = (await db.execute(
                select(BankDeposit).where(BankDeposit.submitted_by == user_id, BankDeposit.is_active == True)  # noqa: E712
                .order_by(desc(BankDeposit.created_at)).limit(5)
            )).scalars().all()
            ctx["bank_deposits"] = [
                {"amount_ngn": b.amount, "bank": b.bank_name, "status": b.status, "for": b.paid_for, "date": b.created_at.strftime("%d %b %Y")}
                for b in bank_deposits
            ]

            # ── Monthly rent roll (potential vs collected) ─────────────────────
            monthly_rent_roll = (await db.execute(
                select(func.coalesce(func.sum(Tenant.rent_amount + Tenant.service_charge_amount), 0))
                .where(Tenant.estate.in_(estate_ids), Tenant.is_active == True, Tenant.status == "occupied")  # noqa: E712
            )).scalar() or 0
            ctx["monthly_rent_roll_ngn"] = round(monthly_rent_roll, 0)
            ctx["collection_rate_pct"] = round(
                ctx["revenue_30d"] / monthly_rent_roll * 100, 1
            ) if monthly_rent_roll > 0 else 0

            # ── Portfolio summary ─────────────────────────────────────────────
            total_units = sum(e["units_total"] for e in estate_details)
            total_occ = sum(e["units_occupied"] for e in estate_details)
            total_tenants = sum(e["tenants"] for e in estate_details)
            total_overdue = sum(e["overdue"] for e in estate_details)
            total_outstanding = sum(e["outstanding_ngn"] for e in estate_details)
            ctx["summary"] = {
                "estates": len(estates),
                "units_total": total_units,
                "units_occupied": total_occ,
                "units_vacant": total_units - total_occ,
                "occupancy_pct": round(total_occ / total_units * 100, 1) if total_units else 0,
                "tenants_total": total_tenants,
                "tenants_overdue": total_overdue,
                "total_outstanding_ngn": round(total_outstanding, 0),
                "monthly_rent_roll_ngn": round(monthly_rent_roll, 0),
                "collection_rate_pct": ctx["collection_rate_pct"],
                "open_issues": len(open_issues),
                "high_priority_issues": sum(1 for i in open_issues if i["priority"] == "high"),
                "pending_enquiries": sum(1 for e in ctx["enquiries"] if e["status"] == "pending"),
                "pending_applications": sum(1 for a in ctx["rental_applications"] if a["status"] == "pending"),
                "revenue_30d_ngn": round(ctx["revenue_30d"], 0),
                "revenue_all_time_ngn": round(ctx["revenue_all_time"], 0),
            }

        # ── Wallet ────────────────────────────────────────────────────────────
        wallet = (await db.execute(select(Wallet).where(Wallet.user_id == user_id))).scalar_one_or_none()
        if wallet:
            ctx["wallet_balance_ngn"] = round(wallet.balance, 2)

        # ── Business Skills data ──────────────────────────────────────────────
        try:
            from models.campaign import Campaign
            from models.deal import Deal
            from models.candidate import Candidate
            from models.vendor import Vendor
            from models.brand_asset import BrandAsset

            campaigns = (await db.execute(
                select(Campaign).where(Campaign.owner_id == user_id)
                .order_by(desc(Campaign.created_at)).limit(10)
            )).scalars().all()
            ctx["marketing_campaigns"] = [
                {
                    "name": c.name,
                    "channel": c.channel,
                    "status": c.status,
                    "budget_ngn": c.budget,
                    "spend_ngn": c.spend,
                    "leads": c.leads,
                    "conversions": c.conversions,
                    "ctr": round(c.clicks / c.impressions * 100, 1) if c.impressions else 0,
                }
                for c in campaigns
            ]

            deals = (await db.execute(
                select(Deal).where(Deal.owner_id == user_id)
                .order_by(desc(Deal.created_at)).limit(10)
            )).scalars().all()
            active_deals = [d for d in deals if d.stage not in ("won", "lost")]
            ctx["sales_pipeline"] = {
                "total": len(deals),
                "active": len(active_deals),
                "pipeline_value_ngn": round(sum(d.value for d in active_deals), 0),
                "won_value_ngn": round(sum(d.value for d in deals if d.stage == "won"), 0),
                "deals": [
                    {"title": d.title, "client": d.client_name, "stage": d.stage, "value_ngn": d.value}
                    for d in active_deals[:5]
                ],
            }

            candidates = (await db.execute(
                select(Candidate).where(Candidate.owner_id == user_id)
            )).scalars().all()
            ctx["hr_pipeline"] = {
                "total": len(candidates),
                "active": len([c for c in candidates if c.stage not in ("hired", "rejected", "withdrawn")]),
                "hired": len([c for c in candidates if c.stage == "hired"]),
                "by_stage": {
                    stage: len([c for c in candidates if c.stage == stage])
                    for stage in ["sourced", "screened", "interview", "offer", "hired"]
                },
            }

            vendors = (await db.execute(
                select(Vendor).where(Vendor.owner_id == user_id, Vendor.status == "active")
            )).scalars().all()
            ctx["vendors"] = {
                "total_active": len(vendors),
                "categories": list({v.category for v in vendors}),
                "total_paid_ngn": round(sum(v.total_paid for v in vendors), 0),
            }

            brand_assets = (await db.execute(
                select(BrandAsset).where(BrandAsset.owner_id == user_id, BrandAsset.is_active == True)  # noqa: E712
            )).scalars().all()
            ctx["brand"] = {
                "total_assets": len(brand_assets),
                "has_logo": any(a.asset_type == "logo" for a in brand_assets),
                "has_color_palette": any(a.asset_type == "color" for a in brand_assets),
                "has_typography": any(a.asset_type == "font" for a in brand_assets),
            }
        except Exception:
            pass  # Skills data is supplemental — never break the main coach

    # ══════════════════════════════════════════════════════════════════════════
    # TENANT VIEW
    # ══════════════════════════════════════════════════════════════════════════
    elif role in tenant_roles:
        from models.notification import Notification

        tenant = (await db.execute(
            select(Tenant).where(Tenant.user == user_id, Tenant.is_active == True)  # noqa: E712
        )).scalar_one_or_none()

        if tenant:
            ctx["tenancy"] = {
                "name": tenant.tenant_name,
                "unit": tenant.unit_label,
                "rent_ngn": tenant.rent_amount,
                "service_charge_ngn": tenant.service_charge_amount,
                "rent_outstanding_ngn": tenant.rent_outstanding,
                "service_charge_outstanding_ngn": tenant.service_charge_outstanding,
                "total_outstanding_ngn": round(tenant.rent_outstanding + tenant.service_charge_outstanding, 0),
                "next_due_date": tenant.next_due_date.strftime("%d %b %Y") if tenant.next_due_date else None,
                "entry_date": tenant.entry_date.strftime("%d %b %Y") if tenant.entry_date else None,
                "status": tenant.status,
                "tenant_type": tenant.tenant_type,
                "electric_meter": tenant.electric_meter_number,
            }

            # Payment history
            my_payments = (await db.execute(
                select(Payment).where(Payment.tenant == tenant.id)
                .order_by(desc(Payment.created_at)).limit(12)
            )).scalars().all()
            ctx["my_payments"] = [
                {"amount_ngn": p.amount, "type": p.payment_type, "status": p.payment_status, "date": p.created_at.strftime("%d %b %Y")}
                for p in my_payments
            ]
            ctx["total_paid_ngn"] = round(
                sum(p.amount for p in my_payments if p.payment_status in ("success", "completed")), 0
            )

            # My issues
            my_issues = (await db.execute(
                select(Issue).where(Issue.tenant == tenant.id)
                .order_by(desc(Issue.created_at)).limit(10)
            )).scalars().all()
            ctx["my_issues"] = [
                {"title": i.title, "status": i.status, "priority": i.priority, "date": i.created_at.strftime("%d %b %Y")}
                for i in my_issues
            ]

            # Pending bills
            bills = (await db.execute(
                select(BillingItem).where(
                    BillingItem.user == user_id, BillingItem.is_paid == False, BillingItem.is_active == True  # noqa: E712
                ).order_by(BillingItem.due_date.asc())
            )).scalars().all()
            ctx["pending_bills"] = [
                {"label": b.label, "amount_ngn": b.amount, "due_date": b.due_date.strftime("%d %b %Y") if b.due_date else None,
                 "overdue": bool(b.due_date and b.due_date < now)}
                for b in bills
            ]

            # Service requests
            my_reqs = (await db.execute(
                select(ServiceRequest).where(ServiceRequest.tenant == tenant.id)
                .order_by(desc(ServiceRequest.created_at)).limit(5)
            )).scalars().all()
            ctx["my_service_requests"] = [
                {"title": r.title, "status": r.status, "date": r.created_at.strftime("%d %b %Y")}
                for r in my_reqs
            ]

            # Notifications (unread)
            notifs = (await db.execute(
                select(Notification).where(Notification.user == user_id, Notification.is_read == False, Notification.is_active == True)  # noqa: E712
                .order_by(desc(Notification.created_at)).limit(5)
            )).scalars().all()
            ctx["unread_notifications"] = [
                {"title": n.title, "message": n.message[:100], "date": n.created_at.strftime("%d %b %Y")}
                for n in notifs
            ]

            # Latest meter reading
            latest_meter = (await db.execute(
                select(MeterReading).where(MeterReading.tenant == tenant.id)
                .order_by(desc(MeterReading.recorded_at)).limit(1)
            )).scalar_one_or_none()
            if latest_meter:
                ctx["meter"] = {
                    "kwh": latest_meter.kwh,
                    "credit_balance_ngn": latest_meter.credit_balance,
                    "rate_per_kwh": latest_meter.rate_per_kwh,
                    "recorded_at": latest_meter.recorded_at.strftime("%d %b %Y %H:%M"),
                }

        wallet = (await db.execute(select(Wallet).where(Wallet.user_id == user_id))).scalar_one_or_none()
        if wallet:
            ctx["wallet_balance_ngn"] = round(wallet.balance, 2)

    return ctx


# ─── Formatter ─────────────────────────────────────────────────────────────────

def _format_context(ctx: dict) -> str:
    if not ctx:
        return ""

    role = ctx.get("role", "unknown")
    lines = [
        "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        f"LIVE BAMIHOST DATA — {role.upper()}",
        f"Snapshot: {ctx.get('fetched_at')}",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ]

    # ── Admin/Owner ───────────────────────────────────────────────────────────
    if "summary" in ctx:
        s = ctx["summary"]
        lines += [
            "PORTFOLIO SUMMARY",
            f"  Estates: {s['estates']}",
            f"  Units: {s['units_total']} total | {s['units_occupied']} occupied | {s['units_vacant']} vacant | {s['occupancy_pct']}% occupancy",
            f"  Tenants: {s['tenants_total']} active | {s['tenants_overdue']} overdue",
            f"  Monthly Rent Roll (potential): ₦{s['monthly_rent_roll_ngn']:,.0f}",
            f"  Revenue (last 30 days): ₦{s['revenue_30d_ngn']:,.0f}",
            f"  Collection Rate: {s['collection_rate_pct']}%",
            f"  Total Outstanding Debt: ₦{s['total_outstanding_ngn']:,.0f}",
            f"  All-Time Revenue: ₦{s['revenue_all_time_ngn']:,.0f}",
            f"  Open Issues: {s['open_issues']} ({s['high_priority_issues']} high priority)",
            f"  Pending Enquiries: {s['pending_enquiries']} | Pending Applications: {s['pending_applications']}",
        ]

    if ctx.get("revenue_trend_6mo"):
        lines.append("\n6-MONTH REVENUE TREND")
        for month, rev in ctx["revenue_trend_6mo"].items():
            lines.append(f"  {month}: ₦{rev:,.0f}")

    if ctx.get("revenue_by_type"):
        lines.append("\nREVENUE BREAKDOWN BY TYPE")
        for ptype, amount in ctx["revenue_by_type"].items():
            lines.append(f"  {ptype}: ₦{amount:,.0f}")

    if ctx.get("estate_details"):
        lines.append("\nESTATE-BY-ESTATE BREAKDOWN")
        for e in ctx["estate_details"]:
            lines.append(
                f"  [{e['name']}] {e['units_occupied']}/{e['units_total']} units ({e['occupancy_pct']}%) | "
                f"{e['overdue']} overdue | ₦{e['outstanding_ngn']:,.0f} outstanding | "
                f"₦{e['revenue_30d_ngn']:,.0f} revenue (30d) | Rent roll: ₦{e['monthly_rent_roll_ngn']:,.0f}/mo"
            )

    if ctx.get("vacant_units"):
        lines.append(f"\nVACANT UNITS ({len(ctx['vacant_units'])})")
        for u in ctx["vacant_units"]:
            lines.append(
                f"  {u['label']} [{u['estate']}] — {u['category']}, {u['bedrooms']}bed | "
                f"₦{u['monthly_price_ngn']:,.0f}/mo | Available: {u['available_since']}"
            )

    if ctx.get("overdue_tenants"):
        lines.append(f"\nOVERDUE TENANTS ({len(ctx['overdue_tenants'])})")
        for t in ctx["overdue_tenants"]:
            lines.append(
                f"  {t['name']} | {t['unit']} [{t['estate']}] | ₦{t['outstanding_ngn']:,.0f} due | "
                f"Due: {t['next_due']} | {t['phone'] or t['email'] or 'no contact'}"
            )

    if ctx.get("all_tenants"):
        lines.append(f"\nALL TENANTS ({len(ctx['all_tenants'])})")
        for t in ctx["all_tenants"]:
            flag = "🔴" if t["is_overdue"] else "✓"
            lines.append(
                f"  {flag} {t['name']} | {t['unit']} [{t['estate']}] | "
                f"Rent: ₦{t['rent_ngn']:,.0f} | Outstanding: ₦{t['outstanding_ngn']:,.0f} | "
                f"Total paid: ₦{t['total_paid_ngn']:,.0f} | Next due: {t['next_due'] or 'N/A'} | "
                f"{t['phone'] or t['email'] or 'no contact'}"
            )

    if ctx.get("open_issues"):
        lines.append(f"\nOPEN MAINTENANCE ISSUES ({len(ctx['open_issues'])})")
        for i in ctx["open_issues"]:
            lines.append(f"  [{i['priority'].upper()}] {i['title']} | {i['status']} | {i['estate']} | {i['reported']}")
            if i.get("description"):
                lines.append(f"    → {i['description'][:150]}")

    if ctx.get("service_requests"):
        lines.append(f"\nOPEN SERVICE REQUESTS ({len(ctx['service_requests'])})")
        for r in ctx["service_requests"]:
            lines.append(f"  {r['title']} | {r['status']} | {r['date']}")

    if ctx.get("enquiries"):
        lines.append(f"\nENQUIRIES / LEADS ({len(ctx['enquiries'])})")
        for e in ctx["enquiries"]:
            lines.append(f"  {e['name']} | {e['phone'] or e['email']} | {e['type']} | {e['status']} | {e['date']}")
            if e.get("message"):
                lines.append(f"    → {e['message']}")

    if ctx.get("rental_applications"):
        lines.append(f"\nRENTAL APPLICATIONS ({len(ctx['rental_applications'])})")
        for a in ctx["rental_applications"]:
            lines.append(f"  {a['name']} | {a['phone'] or a['email']} | Status: {a['status']} | Move-in: {a['move_in_date'] or 'TBD'} | {a['date']}")

    if ctx.get("recent_payments"):
        lines.append(f"\nRECENT PAYMENTS (last {len(ctx['recent_payments'])})")
        for p in ctx["recent_payments"]:
            lines.append(f"  ₦{p['amount_ngn']:,.0f} | {p['type']} | {p['status']} | {p['date']}")

    if ctx.get("withdrawals"):
        lines.append("\nWITHDRAWAL REQUESTS")
        for w in ctx["withdrawals"]:
            lines.append(f"  ₦{w['amount_ngn']:,.0f} | {w['status']} | {w['date']}")

    if ctx.get("bank_deposits"):
        lines.append("\nBANK DEPOSITS (offline payments)")
        for b in ctx["bank_deposits"]:
            lines.append(f"  ₦{b['amount_ngn']:,.0f} | {b['bank']} | {b['status']} | For: {b['for'] or 'N/A'} | {b['date']}")

    if "wallet_balance_ngn" in ctx:
        lines.append(f"\nWALLET BALANCE: ₦{ctx['wallet_balance_ngn']:,.2f}")

    # ── Business Skills data ──────────────────────────────────────────────────
    if ctx.get("marketing_campaigns"):
        campaigns = ctx["marketing_campaigns"]
        active_c = [c for c in campaigns if c["status"] == "active"]
        total_spend = sum(c["spend_ngn"] for c in campaigns)
        total_leads = sum(c["leads"] for c in campaigns)
        lines.append(f"\nMARKETING CAMPAIGNS ({len(campaigns)} total | {len(active_c)} active)")
        lines.append(f"  Total spend: ₦{total_spend:,.0f} | Total leads: {total_leads}")
        for c in campaigns[:5]:
            lines.append(
                f"  [{c['status'].upper()}] {c['name']} ({c['channel']}) | "
                f"₦{c['spend_ngn']:,.0f} spent of ₦{c['budget_ngn']:,.0f} | "
                f"{c['leads']} leads | {c['conversions']} conversions | CTR: {c['ctr']}%"
            )

    if ctx.get("sales_pipeline"):
        sp = ctx["sales_pipeline"]
        lines.append(f"\nSALES PIPELINE — {sp['active']} active deals | Pipeline value: ₦{sp['pipeline_value_ngn']:,.0f} | Won: ₦{sp['won_value_ngn']:,.0f}")
        for d in sp.get("deals", []):
            lines.append(f"  [{d['stage'].upper()}] {d['title']} ({d['client']}) | ₦{d['value_ngn']:,.0f}")

    if ctx.get("hr_pipeline"):
        hr = ctx["hr_pipeline"]
        lines.append(f"\nHR PIPELINE — {hr['total']} candidates | {hr['active']} in pipeline | {hr['hired']} hired")
        if hr.get("by_stage"):
            stage_str = " | ".join(f"{k}: {v}" for k, v in hr["by_stage"].items() if v > 0)
            if stage_str:
                lines.append(f"  By stage: {stage_str}")

    if ctx.get("vendors"):
        v = ctx["vendors"]
        lines.append(f"\nVENDORS — {v['total_active']} active | Categories: {', '.join(v['categories'])} | Total paid: ₦{v['total_paid_ngn']:,.0f}")

    if ctx.get("brand"):
        b = ctx["brand"]
        has = []
        if b["has_logo"]: has.append("Logo ✓")
        if b["has_color_palette"]: has.append("Colors ✓")
        if b["has_typography"]: has.append("Fonts ✓")
        lines.append(f"\nBRAND ASSETS — {b['total_assets']} assets | {', '.join(has) if has else 'No assets yet'}")

    # ── Tenant view ───────────────────────────────────────────────────────────
    if "tenancy" in ctx:
        ten = ctx["tenancy"]
        lines += [
            f"MY TENANCY — {ten['name']}",
            f"  Unit: {ten['unit']} | Status: {ten['status']} | Type: {ten['tenant_type']}",
            f"  Entry Date: {ten.get('entry_date', 'N/A')} | Next Due: {ten.get('next_due_date', 'N/A')}",
            f"  Monthly Rent: ₦{ten['rent_ngn']:,.0f} | Service Charge: ₦{ten['service_charge_ngn']:,.0f}",
            f"  Rent Outstanding: ₦{ten['rent_outstanding_ngn']:,.0f}",
            f"  Service Charge Outstanding: ₦{ten['service_charge_outstanding_ngn']:,.0f}",
            f"  TOTAL OUTSTANDING: ₦{ten['total_outstanding_ngn']:,.0f}",
        ]
        if ten.get("electric_meter"):
            lines.append(f"  Meter Number: {ten['electric_meter']}")

    if ctx.get("meter"):
        m = ctx["meter"]
        lines.append(
            f"\nSMART METER (as of {m['recorded_at']}): "
            f"{m['kwh']} kWh | Credit: ₦{m['credit_balance_ngn']:,.2f} | Rate: ₦{m['rate_per_kwh']}/kWh"
        )

    if ctx.get("my_payments"):
        lines.append(f"\nMY PAYMENT HISTORY (last {len(ctx['my_payments'])})")
        for p in ctx["my_payments"]:
            lines.append(f"  ₦{p['amount_ngn']:,.0f} | {p['type']} | {p['status']} | {p['date']}")
        if "total_paid_ngn" in ctx:
            lines.append(f"  TOTAL PAID (all time): ₦{ctx['total_paid_ngn']:,.0f}")

    if ctx.get("my_issues"):
        lines.append(f"\nMY MAINTENANCE ISSUES ({len(ctx['my_issues'])})")
        for i in ctx["my_issues"]:
            lines.append(f"  [{i['priority'].upper()}] {i['title']} | {i['status']} | {i['date']}")

    if ctx.get("pending_bills"):
        lines.append(f"\nPENDING BILLS ({len(ctx['pending_bills'])})")
        for b in ctx["pending_bills"]:
            flag = " ⚠️ OVERDUE" if b["overdue"] else ""
            lines.append(f"  {b['label']} | ₦{b['amount_ngn']:,.0f} | Due: {b['due_date'] or 'N/A'}{flag}")

    if ctx.get("my_service_requests"):
        lines.append(f"\nMY SERVICE REQUESTS")
        for r in ctx["my_service_requests"]:
            lines.append(f"  {r['title']} | {r['status']} | {r['date']}")

    if ctx.get("unread_notifications"):
        lines.append(f"\nUNREAD NOTIFICATIONS ({len(ctx['unread_notifications'])})")
        for n in ctx["unread_notifications"]:
            lines.append(f"  {n['title']}: {n['message']}")

    lines.append(
        "\n[INSTRUCTION FOR AI] This is the user's complete live business data. "
        "Reference specific names, ₦ figures, dates, and units in your response. "
        "Never ask for data you can already see. Never say you don't have access."
    )
    return "\n".join(lines)


# ─── Coach reply ──────────────────────────────────────────────────────────────

async def _format_active_instructions(db: AsyncSession, owner_id: str, group_ids: list[str]) -> str:
    """Build the 'ground truth' block for the Project Space groups the user has
    toggled on — instructed to override general knowledge (see SYSTEM_PROMPT)."""
    from models.instruction import InstructionGroup, InstructionItem

    groups = (await db.execute(
        select(InstructionGroup).where(
            InstructionGroup.owner_id == owner_id,
            InstructionGroup.id.in_(group_ids),
        )
    )).scalars().all()
    if not groups:
        return ""

    items = (await db.execute(
        select(InstructionItem).where(InstructionItem.group_id.in_([g.id for g in groups]))
        .order_by(InstructionItem.group_id, InstructionItem.sort_order)
    )).scalars().all()
    items_by_group: dict[str, list] = {}
    for it in items:
        items_by_group.setdefault(it.group_id, []).append(it)

    lines = [
        "\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "ACTIVE INSTRUCTION GROUPS (Project Space — your ground truth for this conversation)",
        "Treat this as the source of truth. It overrides your general knowledge. "
        "If something here conflicts with what the user just said, point out the drift. "
        "If you're missing context to answer well, ask ONE focused question instead of guessing.",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ]
    for g in groups:
        lines.append(f"\n=== GROUP: {g.name} ===")
        if g.description:
            lines.append(g.description)
        for it in items_by_group.get(g.id, []):
            label = {"text": "TEXT", "url": "URL", "file": "FILE"}.get(it.kind, it.kind.upper())
            suffix = f" ({it.source_url})" if it.kind == "url" and it.source_url else ""
            lines.append(f"[{label}] {it.title}{suffix}")
            if it.content:
                lines.append(it.content)
    return "\n".join(lines)


async def build_coach_context(
    user_profile: dict,
    conversation_history: list[dict],
    new_message: str,
    db: AsyncSession | None = None,
    user_id: str | None = None,
    role: str | None = None,
    active_group_ids: list[str] | None = None,
) -> tuple[list[dict], list[dict]]:
    """Assemble the (system_blocks, messages) pair shared by the non-streaming
    and streaming coach chat paths."""
    # The SYSTEM_PROMPT + curriculum is large and identical for every user and
    # every turn, so it's cached as a stable prefix; the per-user profile and
    # live business data (which change every request) go in a separate,
    # uncached block AFTER it so they never invalidate the cache.
    static_system = SYSTEM_PROMPT + L7_CURRICULUM
    dynamic_system = _build_coach_profile(user_profile)

    if db and user_id and active_group_ids:
        try:
            dynamic_system += await _format_active_instructions(db, user_id, active_group_ids)
        except Exception as e:
            logger.warning(f"Could not fetch active instructions for {user_id}: {e}")

    if db and user_id and role:
        try:
            biz_ctx = await fetch_business_context(db, user_id, role)
            dynamic_system += _format_context(biz_ctx)
        except Exception as e:
            logger.warning(f"Could not fetch business context for {user_id}: {e}")
        # The owner's OWN stated Level 7 plan (Scalable Impact Planner) — cite it.
        try:
            from models.growth_plan import GrowthPlan
            from sqlalchemy import select as _select
            gp = (await db.execute(
                _select(GrowthPlan).where(GrowthPlan.owner_id == str(user_id))
            )).scalars().first()
            if gp:
                parts = []
                if gp.target_revenue:
                    parts.append(f"3-yr revenue target ₦{gp.target_revenue:,.0f}")
                if gp.target_profit:
                    parts.append(f"profit target ₦{gp.target_profit:,.0f}")
                if gp.target_valuation:
                    parts.append(f"valuation target ₦{gp.target_valuation:,.0f}")
                if gp.why_summary:
                    parts.append(f"their WHY: {gp.why_summary}")
                if gp.current_step:
                    parts.append(f"currently on planner step {gp.current_step}/7")
                if parts:
                    dynamic_system += ("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nTHE OWNER'S STATED PLAN "
                               "(from their Scalable Impact Planner — reference it directly)\n"
                               "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" + " · ".join(parts))
        except Exception as e:
            logger.warning(f"Could not fetch growth plan for {user_id}: {e}")

    trimmed = conversation_history[-MAX_HISTORY_MESSAGES:]
    messages = trimmed + [{"role": "user", "content": new_message}]

    system_blocks = [
        {"type": "text", "text": static_system, "cache_control": {"type": "ephemeral"}},
        {"type": "text", "text": dynamic_system},
    ]
    return system_blocks, messages


async def get_coach_reply(
    user_profile: dict,
    conversation_history: list[dict],
    new_message: str,
    db: AsyncSession | None = None,
    user_id: str | None = None,
    role: str | None = None,
    active_group_ids: list[str] | None = None,
) -> str:
    system_blocks, messages = await build_coach_context(
        user_profile, conversation_history, new_message, db, user_id, role, active_group_ids,
    )
    result = await llm.complete(system_blocks, messages, tier=llm.DEEP, max_tokens=1024)
    return result.text


def _build_coach_profile(profile: dict) -> str:
    if not profile:
        return ""
    lines = ["\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", "COACHING SESSION PROFILE", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"]
    if profile.get("first_name"):
        lines.append(f"Name: {profile['first_name']}")
    lines.append(f"Level: {profile.get('current_level', 1)}")
    if profile.get("current_revenue"):
        lines.append(f"Self-reported Revenue: ₦{profile['current_revenue']:,.0f}/yr")
    if profile.get("target_revenue"):
        lines.append(f"3-Year Target: ₦{profile['target_revenue']:,.0f}")
    if profile.get("their_why"):
        lines.append(f"Their Why: {profile['their_why']}")
    if profile.get("completed_levels"):
        lines.append(f"Completed Levels: {', '.join(str(l) for l in profile['completed_levels'])}")
    return "\n".join(lines)
