# Bami Host — System Architecture & Flow

> A full map of how the platform operates: the apps, the AI agent team, the
> event/scan flows, data, and external services.
> Mermaid diagrams render as images on GitHub / VS Code (Markdown Preview Mermaid).

---

## 1. High-level system map

```mermaid
flowchart TB
    subgraph Clients
        WEB["🌐 Web App<br/>React + TypeScript + RTK Query<br/>(Vite :8080)"]
        TG["💬 Telegram<br/>Tenant bot · Admin bot · AI Coach"]
    end

    subgraph Edge
        CF["☁️ Cloudflare Tunnel<br/>public URL → localhost:4000<br/>(delivers Telegram webhooks)"]
    end

    subgraph Backend["⚙️ FastAPI Backend (Python 3.14, :4000) — managed by supervisor"]
        API["REST API  /api/*"]
        COACH["AI Coach + Webhook  /api/coach/*"]
        AUTO["Autopilot / AI Agents  /api/autopilot/*"]
        SCHED["⏰ APScheduler<br/>daily scans, reminders, meters"]
        EVENTS["🔔 Event Hooks  fire_event()"]
        AGENTS["🤖 Agent Team  services/agents/"]
    end

    DB[("🗄️ PostgreSQL — Neon<br/>SQLAlchemy async")]

    subgraph External["External Services"]
        ANTH["Anthropic Claude<br/>Sonnet · Haiku"]
        GEM["Gemini 2.5 Flash Image<br/>(Nano Banana)"]
        CLD["Cloudinary<br/>media storage"]
        PAY["Paystack<br/>payments"]
        TGAPI["Telegram Bot API"]
        MAIL["Mailtrap<br/>email"]
    end

    WEB -->|HTTPS JSON| API
    TG --> TGAPI --> CF --> COACH
    API --> DB
    COACH --> DB
    AUTO --> AGENTS --> DB
    SCHED --> AGENTS
    EVENTS --> AGENTS
    API --> EVENTS
    AGENTS --> ANTH
    AGENTS --> GEM --> CLD
    COACH --> ANTH
    API --> PAY
    API --> CLD
    AUTO --> TGAPI
    SCHED --> MAIL
```

---

## 2. The AI Agent Team (the core idea)

Six autonomous agents run in the **background**. There are no manual skill pages —
everything they do surfaces in the single **AI Agents hub** (`/dashboard/autopilot`).

```mermaid
flowchart LR
    subgraph Triggers
        SCAN["⏰ Scheduled scan<br/>(daily 07:00) + on-demand<br/>'Run Agents Now'"]
        EVT["🔔 Live events<br/>new listing, enquiry,<br/>issue, overdue rent"]
    end

    ORCH["🧠 Orchestrator<br/>run_all_agents(db, owner)"]

    subgraph Team["services/agents/"]
        D["🎨 Designer<br/>designs listing graphics"]
        M["📣 Marketer<br/>writes social posts"]
        S["💼 Sales<br/>lead scoring + follow-ups"]
        F["💰 Finance<br/>reminders + payment links"]
        O["🔧 Operations<br/>issue triage + vendors"]
        H["👥 HR<br/>hiring triggers"]
    end

    Q[["📋 Autopilot Action Queue<br/>(AutopilotAction rows)"]]
    SET{{"⚙️ Auto-execute settings<br/>'full auto where safe'"}}
    OUT["✅ Executed<br/>Telegram / posts / reminders"]

    SCAN --> ORCH
    EVT --> ORCH
    ORCH --> D --> Q
    ORCH --> M --> Q
    ORCH --> S --> Q
    ORCH --> F --> Q
    ORCH --> O --> Q
    ORCH --> H --> Q
    D -. graphic reused by .-> M
    Q --> SET
    SET -->|safe action| OUT
    SET -->|sensitive action| HUMAN["👤 Owner approves in hub"]
    HUMAN --> OUT
```

**Run order matters:** Designer runs first and caches a marketing graphic on each
vacant unit; the Marketer then reuses that graphic in every social post.

### Per-agent responsibility & autonomy

| Agent | Trigger | Produces | Auto-runs? |
|-------|---------|----------|-----------|
| 🎨 Designer | new listing / vacancy | branded marketing graphic (cached on unit) | ✅ safe |
| 📣 Marketer | vacant units | Telegram/Instagram/Facebook posts + daily briefing | ✅ briefing only |
| 💼 Sales | pending enquiries | lead score + warm follow-up message | ⛔ approval |
| 💰 Finance | overdue rent | payment reminder; (payment links manual) | ✅ reminders |
| 🔧 Operations | open issues | maintenance action plan + best-vendor match | ✅ plans |
| 👥 HR | portfolio > 15 tenants | "time to hire" recommendation + draft role | ⛔ approval |

---

## 3. Event-driven flow (real-time reactions)

When something happens in the business, `fire_event()` fans it out to the agents.

```mermaid
sequenceDiagram
    participant U as User / API
    participant EP as Endpoint (e.g. create enquiry)
    participant FE as fire_event()
    participant H as event handler
    participant AG as Agent logic
    participant AI as Claude / Gemini
    participant DB as PostgreSQL

    U->>EP: POST /api/enquiries
    EP->>DB: save enquiry
    EP->>FE: fire_event("new_enquiry", owner, ctx)
    FE->>H: route to _on_new_enquiry
    H->>AI: score lead + draft follow-up (Haiku)
    H->>DB: save lead_score back to enquiry
    H-->>FE: [AutopilotAction(s)]
    FE->>DB: insert actions + high-priority Notifications
    Note over FE,DB: Owner sees actions in the AI Agents hub
```

**Events handled:** `new_tenant`, `vacancy_opened`, `new_enquiry`, `issue_reported`,
`payment_received`, `tenant_overdue`, `new_property_listed`, `lease_expiring`.

---

## 4. Scheduled autopilot scan (daily + on-demand)

```mermaid
sequenceDiagram
    participant SCH as APScheduler (07:00)
    participant ORCH as run_all_agents
    participant DESQ as Designer
    participant MKT as Marketer
    participant GEM as Gemini (Nano Banana)
    participant CLD as Cloudinary
    participant DB as PostgreSQL

    SCH->>ORCH: scan(owner)
    ORCH->>DESQ: scan() → for each vacant unit
    DESQ->>GEM: design listing graphic
    GEM-->>DESQ: image bytes
    DESQ->>CLD: upload → URL
    DESQ->>DB: cache unit.listing_graphic_url
    ORCH->>MKT: scan() → reuse graphic
    MKT->>DB: insert telegram/ig/fb actions (with image_url)
    ORCH->>DB: + Sales / Finance / Operations / HR actions
    Note over ORCH,DB: auto-safe actions execute; rest await approval
```

---

## 5. Three ways to use the system (channels)

```mermaid
flowchart TB
    subgraph Owner / Manager
        A1["Web dashboard"] --> API
        A2["Telegram /admin"] --> COACH
        A3["Telegram /coach<br/>(AI Business Coach)"] --> COACH
    end
    subgraph Tenant
        B1["Web tenant portal"] --> API
        B2["Telegram /tenant<br/>(rent, issues, statement)"] --> COACH
    end
    API[("FastAPI")] --> DB[("PostgreSQL")]
    COACH --> DB
    COACH --> ANTH["Claude (live business data)"]
```

The **AI Coach** auto-recognises an owner by their Telegram ID (`User.telegram_id`)
and pulls their live business data (estates, tenants, revenue, overdue, occupancy)
into every reply — no login needed.

---

## 6. Core data model (simplified)

```mermaid
erDiagram
    USER ||--o{ ESTATE : owns
    ESTATE ||--o{ UNIT : has
    ESTATE ||--o{ TENANT : houses
    UNIT ||--o| TENANT : occupied_by
    ESTATE ||--o{ ISSUE : reported_in
    ESTATE ||--o{ ENQUIRY : received_for
    TENANT ||--o{ PAYMENT : makes
    USER ||--o{ BRAND_ASSET : "brand kit"
    USER ||--o{ AUTOPILOT_ACTION : "agent output"
    USER ||--o| AUTOPILOT_SETTINGS : configures
    USER ||--o{ COACH_MESSAGE : "AI chat history"

    USER { string id PK
           string role
           string telegram_id }
    ESTATE { string id PK
             string owner FK }
    UNIT { string id PK
           string estate FK
           string status
           string listing_graphic_url }
    TENANT { string id PK
             string estate FK
             float rent_outstanding }
    AUTOPILOT_ACTION { string id PK
                       string owner_id FK
                       string skill
                       string image_url
                       string status }
```

> Note: child records (unit, tenant, issue, enquiry) link to an **estate**;
> ownership is resolved through `Estate.owner` (super_admin sees all).

---

## 7. External services & what they power

| Service | Used for | Key/Config |
|---------|----------|-----------|
| **Anthropic Claude** | Coach, all agent text (Sonnet = deep, Haiku = fast) | `ANTHROPIC_API_KEY` |
| **Gemini 2.5 Flash Image** ("Nano Banana") | Logo + marketing graphics | `GEMINI_API_KEY` |
| **Cloudinary** | Stores generated/uploaded images | `CLOUDINARY_*` |
| **Paystack** | Rent/service-charge payments, payment links | `PAYSTACK_SECRET_KEY` |
| **Telegram Bot API** | Tenant/admin bots, coach, agent message delivery | `TELEGRAM_BOT_TOKEN` |
| **Mailtrap** | Transactional email, campaigns | `MAILTRAP_TOKEN` |
| **Neon** | Managed PostgreSQL | `DATABASE_URL` |

---

## 8. Runtime / deployment

```mermaid
flowchart LR
    SV["supervisord.conf<br/>(pure-Python process mgr)"] --> UV["uvicorn main:app :4000<br/>auto-restart"]
    UV --> APS["APScheduler thread<br/>(dispatches onto main loop)"]
    CF["cloudflared tunnel"] -->|public webhooks| UV
    UV --> NEON[("Neon PostgreSQL")]
```

- **Process manager:** `supervisor` (Python). Start: `fastapi_app/venv/bin/supervisord -c supervisord.conf`
- **Always-on + auto-restart**, logs in `logs/`.
- **Schema:** `create_all` on startup — new columns/type changes need a manual
  `ALTER TABLE` (no Alembic yet).

---

## 9. End-to-end example — "a new flat is listed"

```mermaid
sequenceDiagram
    participant Owner
    participant API
    participant Designer
    participant Marketer
    participant Hub as AI Agents Hub
    Owner->>API: list new unit (vacancy_opened)
    API->>Designer: design listing graphic
    Designer->>Designer: Gemini → Cloudinary → cache on unit
    API->>Marketer: draft posts (reuse graphic)
    Marketer->>Hub: Telegram + IG + FB actions (with image)
    Hub-->>Owner: review / auto-post safe items
```

This is the workflow the owner asked for: *a property is listed → the Designer
creates the image → the Marketer ships the posts carrying that image.*
