# Architecture Overview — Shane McCaw Consulting Platform

This document is written for engineers picking up this codebase for the first time. It explains how the subsystems fit together, what each major component owns, and what the key data flows are.

---

## High-Level Structure

```
pnpm monorepo
├── artifacts/
│   ├── shane-mccaw-consulting/   Public marketing website (React + Vite, path: /)
│   ├── api-server/               Shared Express.js API (path: /api)
│   ├── admin-panel/              Internal business ops (React + Vite, path: /admin-panel)
│   ├── crm/                      Client portal (React + Vite, path: /crm)
│   ├── msp-portal/               MSP operator portal (React + Vite, path: /portal)
│   └── shane-mobile/             Expo mobile companion (path: /shane-mobile)
├── lib/
│   ├── db/                       Drizzle ORM schema + migrations (PostgreSQL)
│   ├── api-spec/                 OpenAPI 3 contract + Orval codegen
│   ├── api-client-react/         Generated React Query hooks
│   ├── api-zod/                  Generated Zod validation schemas
│   ├── integrations/             Shared integration adapters
│   └── integrations-anthropic-ai/ Anthropic AI client helpers
└── scripts/                      One-off operational scripts (migrate, seed, sync-webhooks)
```

All traffic enters through a **Replit reverse proxy** that routes by path prefix (most-specific-first). Each artifact binds to its own `PORT` environment variable.

---

## Artifacts in Detail

### Public Website (`artifacts/shane-mccaw-consulting`, path `/`)

**Purpose:** Marketing front-door and lead capture.

**Key flows:**
- Visitor reads service pages → clicks CTA → lands on quiz or contact form
- Pain-point quiz (`/quick-wins`) collects answers and derives signals → creates a `leads` record via `POST /api/leads`
- `/book` embeds a calendar powered by MS Graph (Exchange Online free/busy lookup)
- `/admin` is a password-protected article editor backed by Markdown files in `src/content/articles/`

**No backend** — purely Vite-built React. API calls go to `artifacts/api-server` via the shared proxy.

---

### API Server (`artifacts/api-server`, path `/api`)

**Purpose:** The central brain. All business logic, AI orchestration, third-party integrations, and database writes live here.

**Tech stack:** Express.js + TypeScript, Drizzle ORM, PostgreSQL.

**Route namespaces:**

| Prefix | Purpose |
|---|---|
| `/api/admin/*` | Internal admin operations (requires `Authorization: Bearer <ADMIN_PASSWORD>`) |
| `/api/portal/*` | Client portal operations (requires portal session cookie / JWT) |
| `/api/msp/*` | MSP operator operations (requires MSP JWT) |
| `/api/leads`, `/api/booking`, `/api/contact` | Public-facing unauthenticated endpoints |

**Core libraries (all in `src/lib/`):**

| File | What it owns |
|---|---|
| `workflow-executor.ts` | DAG-based workflow engine — runs node graphs step by step |
| `tenant-signals.ts` | Rule-based telemetry derivation → business signals |
| `consolidated-sow-generator.ts` | AI-powered Statement of Work generation |
| `sow-pricing.ts` | Signal-driven pricing adjustments |
| `engine-registry.ts` | Registry of 7 intelligence analysis engines |
| `kanban-auto-fire.ts` | Automated Kanban card advancement + runbook triggering |
| `event-bus.ts` | Internal pub/sub for cross-subsystem events |
| `dlq.ts` | Dead-letter queue for failed async operations |
| `stripe.ts` | Stripe payment flows (checkout, webhooks, invoices) |
| `azure-automation.ts` | Triggers Azure Automation Runbooks via ARM REST API |
| `azure-keyvault.ts` | Reads/writes client credentials from Key Vault |
| `graph.ts` | Microsoft Graph API client (mail, calendar, SharePoint) |
| `mailer.ts` | Resend-backed transactional email with DB templates |
| `sms.ts` | Twilio SMS for order alerts |
| `push.ts` | Web Push (VAPID) for browser notifications |
| `audit.ts` | Structured audit log writes |
| `monitor-executor.ts` | Evaluates live-monitor alert rules |
| `sales-offer-engine.ts` | Manages time-limited sales offers (PAY-TODAY discount) |
| `msp-engine.ts` | MSP-tier logic (plan gating, entitlements, RBAC) |
| `portal-workflow-engine.ts` | Workflow execution scoped to the client portal |

---

### Admin Panel (`artifacts/admin-panel`, path `/admin-panel`)

**Purpose:** Internal business operations — sales, fulfillment, finance, marketing, and platform configuration.

**Key sections:**
- **Dashboard / Overview** — KPIs, recent activity
- **CRM / Leads** — lead pipeline from quiz submission to signed client
- **Fulfillment / Kanban** — delivery project boards; cards auto-advance via `kanban-auto-fire.ts`
- **Workflows** — visual workflow editor (DAG), run history, stuck-run remediation
- **Intelligence Engines** — 7 AI analysis engines surfaced via `engine-registry.ts`
- **Tenant Signals** — view, toggle, and test derivation rules
- **Finance** — invoices, Stripe reconciliation, coupon management
- **Marketing** — SEO rankings, social post workflow nodes, quiz config
- **Script Runner** — trigger Azure Automation Runbooks, view results
- **Observability** — DLQ, audit log, live monitor, API health
- **Settings / Prompts** — edit AI generation prompts stored in the DB

**Auth:** Password stored in `sessionStorage`. Every API call includes `Authorization: Bearer <ADMIN_PASSWORD>`.

**Real-time:** SSE connections to `GET /api/admin/sse` for live Kanban updates, workflow run progress, and notification drawer.

---

### CRM / Client Portal (`artifacts/crm`, path `/crm`)

**Purpose:** Client-facing portal for project tracking, document signing, and payment.

**Key flows:**
1. Client registers / logs in (email + password, rate-limited)
2. Client views their engagement: active services, project Kanban stage, SOW, contract
3. Client views presentations → signs agreement → pays via Stripe
4. Client watches live SOW generation (SSE progress bar)
5. Client downloads PDF artefacts

**Auth:** Session cookie (Replit-managed). Each endpoint verifies the client owns the resource.

**Real-time:** SSE to `GET /api/portal/sse` — broadcasts SOW generation progress, Kanban changes, notifications.

**Guest path:** Guest provides name + email before contract signing (no account required for the initial handoff step).

---

### MSP Portal (`artifacts/msp-portal`, path `/portal`)

**Purpose:** White-label portal for Managed Service Providers who resell or operate this platform for their own clients.

**Auth:** 15-minute JWT + 7-day refresh token. Role hierarchy enforced by `ROLE_ORDER` constant in `msp-rbac.ts`.

**Key capabilities:**
- View and manage their customer roster
- Trigger and monitor workflow runs for customers
- View customer diagnostics, SLA, SOW, and documents
- Manage sales bundles and time-limited offers
- View reports and audit events scoped to their tenant
- Configure custom domains for their white-label instance
- Manage MSP-tier billing and plan features

**Feature gating:** `requirePlanFeature(featureName)` middleware enforces plan-based access. Gated features return `403` with a clear plan-upgrade message when the MSP's plan does not include them.

---

### Shane Mobile (`artifacts/shane-mobile`)

**Purpose:** Expo (React Native) mobile companion for Shane to manage the platform on-the-go. Uses AsyncStorage (not SecureStore) for credential persistence on web/cross-platform. Session expiry is signalled via `sessionExpired` flag in `AuthState`, not user-object diffing.

---

## Key Data Flows

### 1. Lead → Client Onboarding

```
Visitor → Quiz (/quick-wins)
  → POST /api/leads           (creates leads record)
  → Admin sees lead in CRM
  → Admin creates engagement_project
  → Tenant signals derived from M365 telemetry
  → SOW generated via AI (consolidated-sow-generator.ts)
  → SOW sent to client portal
  → Client reviews → signs agreement → pays via Stripe
  → client_services.status → "active"
  → SharePoint site provisioned (graph.ts / sharepoint-connector.ts)
  → Kanban card created for delivery
```

### 2. Workflow Execution

```
Trigger (event_bus event, admin manual, kanban-auto-fire, scheduled)
  → workflow-executor.ts loads wf_definition graph (DAG of WfNodes)
  → Executes nodes in topological order
  → Each node type has a handler in node-type-registry.ts
  → Results written to wf_runs / wf_run_steps tables
  → Failed nodes → DLQ (dlq.ts) for replay
  → SSE broadcast to connected admin/client frontends
```

### 3. Tenant Signal Derivation

```
Client M365 telemetry (client_m365_profiles JSON)
  + Script run results (script_run_results text)
  → tenant-signals.ts evaluates signal_derivation_rules
  → Disabled signals skipped (signal_enabled_state table)
  → Fired signals → sow-pricing.ts applies adjustments
  → Fired signals → kanban-auto-fire.ts may trigger next runbook
```

### 4. Stripe Payment Cycle

```
Client clicks "Pay" in portal
  → POST /api/portal/checkout  (creates Stripe PaymentIntent or Checkout Session)
  → Client completes Stripe-hosted payment
  → Stripe sends webhook → POST /api/stripe/webhook
  → processStripeEvent() in stripe.ts
  → Updates invoices + client_services tables
  → Sends SMS to Shane (sms.ts, if Twilio configured)
  → Fires event_bus event → may trigger fulfillment workflow
```

### 5. Azure Runbook Execution

```
Admin Panel → Script Runner → "Run"
  OR Kanban auto-fire triggers next runbook in sequence
  → azure-automation.ts calls Azure REST API to start runbook job
  → Job status polled (or webhook received) → result stored in script_run_results
  → parse-m365-script-output.ts extracts structured findings
  → Findings feed back into tenant signal derivation
```

---

## Database

**Engine:** PostgreSQL (Replit-provisioned).
**ORM:** Drizzle ORM — schema in `lib/db/src/schema/`, migrations in `lib/db/drizzle/`.

**Key table groups:**

| Group | Tables |
|---|---|
| Users / Auth | `users`, `sessions`, `mfa_challenges` |
| Sales funnel | `leads`, `opportunities`, `presentations`, `coupons` |
| Services | `services`, `fulfillment_types`, `client_services` |
| Delivery | `engagement_projects`, `kanban_boards`, `kanban_cards` |
| Workflows | `wf_definitions`, `wf_runs`, `wf_run_steps`, `dlq_items` |
| Signals | `signal_derivation_rules`, `signal_enabled_state` |
| Documents | `client_documents`, `sow_pricing_lines` |
| Finance | `invoices`, `stripe_events` |
| M365 | `client_m365_profiles`, `script_run_results`, `client_health_history` |
| MSP | `msps`, `msp_customers`, `msp_plans`, `msp_audit_log` |
| Observability | `audit_log`, `monitor_checks`, `monitor_alert_events` |
| Content | `ai_prompts`, `email_templates`, `articles` |

**Migrations:** Run `pnpm --filter @workspace/scripts run migrate-prod` after every deploy to apply pending migrations idempotently.

---

## Third-Party Integrations

| Service | Purpose | Secrets |
|---|---|---|
| **Stripe** | Payments, checkout, subscriptions | `STRIPE_SECRET_KEY`, `STRIPE_SECRET_KEY_PROD`, `STRIPE_WEBHOOK_SECRET*` |
| **Azure Automation** | PowerShell runbook execution against client tenants | `AZURE_*` secrets |
| **Azure Key Vault** | Secure client credential storage | `AZURE_KEY_VAULT_URL` |
| **Microsoft Graph** | Mail, calendar, SharePoint provisioning | `GRAPH_*` secrets |
| **Anthropic** | SOW generation, AI analysis | Replit AI Integration (no direct API key needed) |
| **OpenAI** | Alternative AI provider | Replit AI Integration |
| **Resend** | Transactional email | Replit Integration |
| **Twilio** | SMS order alerts | `TWILIO_*` secrets |
| **Google Search Console** | SEO keyword data sync | `GOOGLE_SEARCH_CONSOLE_*` secrets |
| **LinkedIn / Twitter / Facebook** | Social post workflow nodes | Social secrets |

---

## Observability

- **Health endpoint:** `GET /api/health` — unauthenticated liveness check
- **DB status:** `GET /api/admin/db-status` — connectivity + migration state
- **DLQ:** `GET /api/admin/dlq` — failed async operations awaiting replay
- **Monitor checks:** `GET /api/admin/monitor-checks` — live alert rules and their last-evaluated state
- **Audit log:** `GET /api/admin/audit-logs` — structured history of admin actions
- **SSE:** `/api/admin/sse` and `/api/portal/sse` — real-time push to connected browser clients

---

## Conventions & Gotchas

- **Never use `console.log` in server code** — use `req.log` in route handlers and the singleton `logger` elsewhere.
- **`db.execute()` returns a `QueryResult`, not an array.** Use the `execRows()` helper in `api-helpers.ts`.
- **AI responses from Claude Haiku include prose preamble** — use `extractJson()` to parse structured output, not a `^`-anchored regex.
- **Anthropic `messages.create()` times out at 10 minutes** — any high-token generation must use `messages.stream()` + `finalMessage()`.
- **`drizzle-kit push` requires a TTY** — run schema changes via `executeSql()` in the code_execution sandbox when non-interactive.
- **PORT injection** — every artifact's dev script must export `PORT=${PORT:-<fallback>}` because the Replit workflow system does not always inject `PORT` before the process starts.
- **`expo-secure-store` is a no-op on web** — use `AsyncStorage` for cross-platform credential storage in the mobile artifact.
- **Published workflow version** — version lookups must `ORDER BY versionNumber DESC`; archive-old and publish-new must be one DB transaction.
- **Workflow start node** — must spread the run's payload into its output so `{{steps.<startId>.*}}` resolves correctly.
- **`interp()` always stringifies** — use `resolveExprNative()` when a field must preserve native type (e.g., `run_workflow` inputMapping).
