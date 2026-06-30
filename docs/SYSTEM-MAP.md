# Bami Host — Full System Map & Roadmap

A grounded audit (from the live codebase) of **everything we have**, how it connects,
and **what to build next**. Use this as the single source of truth.

---

## The system in one sentence
Bami Host is **three pillars** — 🏠 Property Management, 📊 Finance/Portfolio, 🚀 Entrepreneur Growth (Level 7) — wired together by an **AI layer** (Coach + 6 Agents) that plans, measures, and automates the business.

```
        PLAN ───────────► MEASURE ───────────► EXECUTE
  Scalable Impact      Scale · 7 Levels      AI Agent team
   Planner (L7 UI)     (live diagnosis)      (automate the OS)
        └──────────────► COACH (teaches + guides from live data) ◄──────────────┘
```

---

## PILLAR 1 — 🏠 Property Management (BamiHost core) — **MATURE**
| Area | Backend | Frontend | Status |
|------|---------|----------|--------|
| Estates / Units | estates (21), units (6) | Estate Management | ✅ |
| Tenants | tenants (19) | tenant pages | ✅ |
| Payments / Billing | payments (9), billing (5), Paystack | wallet, deposits | ✅ |
| Issues / Service requests | issues (5), service_requests (3) | — (via agents) | ✅ |
| Enquiries + lead scoring | enquiries (3) | manager dashboard | ✅ |
| Smart meters (Tuya IoT) | meters (12) | Smart Meters | ✅ |
| Filling station / Equipment rental | distribution (9) | Filling Station, Equipment | ✅ |
| Wallets / Withdrawals | wallet (11), withdrawals (5) | Wallet | ✅ |
| Telegram bots (tenant + admin) | coach (6), tenant_bot, admin_bot | n/a | ✅ |

## PILLAR 2 — 📊 Finance / Portfolio — **MOSTLY UI (localStorage)**
| Area | Backend | Frontend | Status |
|------|---------|----------|--------|
| Investment Portfolio | — | Investment Portfolio | ⚠️ local only |
| 50/30/20 Split tracker | — | 50/30/20 Split | ⚠️ local only |
| Financial Goals | — | Financial Goals | ⚠️ local only |
| Accounting | — | Accounting Mgmt | ⚠️ local only |
| Personal Life portfolios | — | Personal Life | ⚠️ local only |
| Owner finance plan (pay-yourself-first) | scale (NEW) | Scale page | ✅ persisted |

## PILLAR 3 — 🚀 Entrepreneur Growth (Level 7) — **RICH UI, NOT PERSISTED**
| Tool | Where | Backend? | Status |
|------|-------|----------|--------|
| **Scalable Impact Planner** (Your Number, Why, Start/End game, Level confirm, How) | `scalable-impact/` (20 components) | ❌ localStorage | ⚠️ **not saved** |
| L1 First 10 Customers | Level1FirstTenCustomers | ❌ | ⚠️ |
| L2 Growth Flywheel builder | GrowthFlywheelBuilder | ❌ | ⚠️ |
| L3 Operating System builder (8 tabs: value engines, comms, outputs, install…) | operating-system-tabs/ | ❌ | ⚠️ |
| L4 Double Your Take-Home | DoubleYourTakeHome | ❌ | ⚠️ |
| L5 Build Your Board | BuildYourBoard | ❌ | ⚠️ |
| L6 Expand Through Acquisition | ExpandThroughAcquisition | ❌ | ⚠️ |
| Billionaire OS (missions, time-blocks, king's audit, time-value) | billionaire (18) | ✅ persisted | ✅ |

## THE AI LAYER (the glue) — **NEW THIS CYCLE**
| Piece | What it does | Status |
|-------|--------------|--------|
| **AI Coach** | Teaches the Level 7 + Scalable OS curriculum, diagnoses level from live data | ✅ (curriculum embedded) |
| **6 AI Agents** (Designer, Marketer, Sales, Finance, Operations, HR) | Automate the "power stages" of the property business | ✅ |
| **Scale · 7 Levels** page | Live level diagnosis, NPS/promoters (L1), growth scorecard (L2), pay-yourself-first (L4) | ✅ persisted |
| Designer image gen (Nano Banana) | Branded marketing graphics | ✅ (needs GEMINI_API_KEY) |
| Course library (95 videos) | Transcribed + distilled into the Coach | ✅ |

---

## 🔑 The key finding
The **Level 7 framework is already built as beautiful UI** (the Scalable Impact Planner + Operating System builder — 28 components matching the course exactly). **But none of it saves to the backend** — it lives only in the browser's localStorage. So:
- A user fills in their Number, Why, value engines, board… and it's **lost on another device / cleared cache**.
- The rich plan is **disconnected** from the live data (my new Scale page measures reality, but doesn't know the user's stated plan).

**This is the highest-leverage gap.** Everything else exists.

---

## 📋 ROADMAP — what to build, in priority order

### 🥇 P1 — Persist + connect the Level 7 system (biggest value, least new UI)
1. **Backend `scalable_plan` store** — one JSON-per-owner endpoint (`GET/PUT /api/growth/plan`) to persist the whole Scalable Impact Planner + Operating System builder.
2. **Wire the existing UI** (`scalable-impact/`) to it (replace localStorage with the API).
3. **Connect plan ↔ live data:** the Scale page's level diagnosis should read the user's *stated* number/level from the plan and compare to live reality; the Coach should cite the user's actual plan.

### 🥈 P2 — Make the Scalable OS tools real (not just content)
4. **Value Engine builder** → persist value-engine maps (the agents already automate power stages — let users *see* the map).
5. **Company Scorecard** → 3 evergreen + 3 North Star + 3/team, fed by live data.
6. **High Output Team Canvas** → connect to the HR agent + candidates.

### 🥉 P3 — Persist Pillar 2 (finance/portfolio)
7. Back the Investment Portfolio / 50-30-20 / Goals with real endpoints (currently localStorage).

### P4 — Automation polish
8. Auto-trigger the NPS ask after first confirmed payment (fully automate L1).
9. Per-agent on/off toggles; real social posting (Meta/IG API) for the Marketer.
10. Alembic migrations (stop the `create_all` schema-drift pattern).

---

## How the pieces should click together (target state)
1. Owner opens **Scalable Impact Planner** → defines Number, Why, level → **saved to backend**.
2. **Scale page** shows live level vs. the plan; **Coach** references both.
3. **AI Agents** execute the power stages; their output (NPS, posts, reminders) feeds the **scorecard**.
4. **Billionaire OS** drives the owner's daily execution.
Everything persisted, connected, and coached.
