# Admin Panel — Internal Reference

> **Audience:** Shane (operator) and developers maintaining the platform.  
> **Last updated:** 2026-07-09  
> **Source of truth for node details:** [workflow-node-reference.md](./workflow-node-reference.md)

---

## Contents

1. [Overview & Authentication](#1-overview--authentication)
2. [Workspaces & URL Structure](#2-workspaces--url-structure)
3. [Dashboard](#3-dashboard)
4. [CRM Module](#4-crm-module)
5. [Projects & Engagements](#5-projects--engagements)
6. [Kanban](#6-kanban)
7. [Insights & Documents](#7-insights--documents)
8. [Marketing Command Center](#8-marketing-command-center)
9. [Tenant Signals](#9-tenant-signals)
10. [Script Runner](#10-script-runner)
11. [System Settings](#11-system-settings)
12. [Workflows — Overview & Builder](#12-workflows--overview--builder)
13. [Workflow Triggers Reference](#13-workflow-triggers-reference)
14. [Workflow Events Catalog](#14-workflow-events-catalog)
15. [Workflow API Reference](#15-workflow-api-reference)
16. [Seeded System Workflows](#16-seeded-system-workflows)

---

## 1. Overview & Authentication

The Admin Panel is a React + Vite SPA served at `/admin-panel/`. It communicates with the API server at `/api/` via JWT-authenticated `fetchWithAuth()` calls. Access tokens are 15-minute short-lived JWTs; a refresh token in `localStorage` exchanges for a new access token automatically.

**Authentication flow:**
1. POST `/api/auth/admin/login` with `{ email, password }` → `{ accessToken, refreshToken }`.
2. All subsequent requests include `Authorization: Bearer <accessToken>`.
3. Expired access tokens trigger an automatic silent refresh via `POST /api/auth/admin/refresh`.

**Session context:** `AuthContext` (`artifacts/admin-panel/src/contexts/AuthContext.tsx`) exposes `user`, `token`, `fetchWithAuth`, and `logout`. All data-fetching components call `fetchWithAuth` rather than raw `fetch` — critical because SSE/long-polling connections also need fresh tokens.

**Admin roles:** `admin` (full access) and `viewer` (read-only; UI hides mutating controls).

---

## 2. Workspaces & URL Structure

The Admin Panel is path-mounted at `/admin-panel/` and uses Wouter for client-side routing. All routes are prefixed with `/admin-panel/`.

| Section | Base Path | Notes |
|---|---|---|
| Dashboard | `/admin-panel/` | KPI strip + activity feed |
| CRM — Leads | `/admin-panel/crm/leads` | |
| CRM — Clients | `/admin-panel/crm/clients` | |
| CRM — Opportunities | `/admin-panel/crm/opportunities` | |
| CRM — Pipeline | `/admin-panel/crm/pipeline` | Kanban board |
| Projects | `/admin-panel/projects` | |
| Project Detail | `/admin-panel/projects/:id` | Phases, docs, timeline |
| Kanban | `/admin-panel/kanban` | Client delivery boards |
| Insights | `/admin-panel/insights` | AI-generated documents |
| Marketing | `/admin-panel/marketing` | Marketing Command Center |
| Tenant Signals | `/admin-panel/tenant-signals` | Rule engine |
| Script Runner | `/admin-panel/scripts` | Azure Automation |
| System | `/admin-panel/system` | Settings, integrations |
| Workflows List | `/admin-panel/workflows/list` | |
| Workflow Runs | `/admin-panel/workflows/runs` | Run history |
| Run Detail | `/admin-panel/workflows/runs/:id` | Live node-by-node viewer |
| Workflow Builder | `/admin-panel/workflows/builder/:id` | Visual canvas |
| Trigger Config | `/admin-panel/workflows/triggers/:id` | |

---

## 3. Dashboard

**Component:** `DashboardPage.tsx`  
**Data source:** `GET /api/admin/dashboard/kpis`

The dashboard KPI strip (`KPIStrip`) fetches 11 metrics and renders the four most prominent:

| KPI Key | Meaning |
|---|---|
| `visitorsToday` | Unique site visitors today |
| `leadsThisWeek` | New leads created in the last 7 days |
| `conversionRate` | Lead-to-client conversion % |
| `activeCampaigns` | Campaigns with status `active` |
| `hotLeadsCount` | Leads with intent score ≥ threshold |
| `intentSignalsToday` | Intent events recorded today |
| `followUpsDue` | Overdue lead follow-up tasks |
| `activeOffers` | Pay-Today offers still within 72-hour window |
| `revenueThisMonth` | Stripe revenue collected this calendar month |
| `revenueOpportunity` | Open pipeline value |
| `offerConversionRate` | % of viewed Pay-Today offers that converted |

The activity feed below the KPI strip shows a reverse-chronological stream of platform events (new leads, completed phases, signed agreements, etc.) drawn from `GET /api/admin/dashboard/activity`.

---

## 4. CRM Module

### 4.1 Leads (`/crm/leads`)

The leads table shows all rows from the `leads` DB table. Columns: Name, Email, Company, Service Area, Stage, Score, Created.

**Lead scoring algorithm** (`score_lead` node and `scoreLead()` helper):
- Base score: **20** (every lead starts here)
- Company name present: **+20**
- Service area set: **+20**
- Message > 50 characters: **+20**
- Stage ≠ `Cold`: **+20**
- **Maximum: 100**

Score labels: `< 40` → Cold | `40–59` → Warm | `60–79` → Hot | `≥ 80` → Qualified.

**Intent scoring** is a separate mechanism layered on top. Each tracked event adds to an `intentScore` accumulator:

| Event Type | Points |
|---|---|
| `email_open` | 1 |
| `link_click` | 3 |
| `cta_click` | 5 |
| `site_visit` | 2 |
| `form_submit` | 10 |
| `reply` | 15 |

High-value page visits (any of `/services`, `/services/microsoft-365`, `/services/copilot-ai`, `/services/sharepoint`, `/services/power-platform`, `/services/governance`, `/services/cloud-migration`, `/pricing`, `/quick-wins`, `/book`, `/contact`) automatically emit a `site_visit` intent event.

### 4.2 Lead Detail

Clicking a lead opens a slide-over showing: timeline of events, AI-suggested follow-up, intent signal history, linked opportunities, and quick actions (Convert to Opportunity, Score Lead, Send Email).

### 4.3 Clients (`/crm/clients`)

Lists all users with `role = "client"`. Each row links to the client's portal presentation and active project. Actions: View Portal, Open Project, Send Email, Resend Onboarding.

### 4.4 Opportunities (`/crm/opportunities`)

Opportunity records linked to leads. Fields: title, stage, value estimate, linked lead, linked project. Stages are fully customisable.

### 4.5 Pipeline Board (`/crm/pipeline`)

A Kanban-style view grouping opportunities by stage. Cards are draggable; dropping a card on a column fires `PATCH /api/admin/crm/opportunities/:id` to update the stage and emits a workflow event.

---

## 5. Projects & Engagements

### 5.1 Project List (`/projects`)

All projects from the `projects` DB table. Filterable by status (`active`, `completed`, `on_hold`). Columns: Client, Project Title, Type, Status, Phase Progress, Revenue.

### 5.2 Project Detail (`/projects/:id`)

Tabs:

| Tab | Content |
|---|---|
| Overview | Status, client, dates, total value, description |
| Phases | List of `workflow_steps` rows with status, delivery date, linked Stripe invoice |
| Documents | AI-generated documents for this project (SOW, diff reports, etc.) |
| Timeline | Chronological event log |
| Kanban | Mini kanban board filtered to this project's cards |
| Notes | Free-form internal notes |

**Phase actions:** Mark Complete (emits `phase_completed`), Change Delivery Date (emits `phase.delivery_date_changed`), Link Stripe Invoice.

### 5.3 Engagement Projects

Engagement projects are auto-created from `engagement_projects` DB rows when a quiz lead is processed or a signal key fires an automation. They are linked to a `triggered_by` signal key (canonical string, e.g. `needs_governance_review`). The `0012_engagement_project_signal_keys` migration backfills legacy plan-name strings to canonical keys.

---

## 6. Kanban

### 6.1 Kanban Boards (`/kanban`)

Multi-board view with per-client lanes. Each board has columns representing delivery stages. Cards represent individual tasks or automated runbook items.

**Card auto-fire:** When a card is moved to certain columns, the `__system__: Kanban Auto-fire` workflow fires and may execute an Azure runbook or document-generation action automatically. Post-run side effects (e.g. updating card status) must be handled in `kanban-auto-fire.ts`; the `processRunInBackground` path also exists but lacks the auto-fire side effects — keep both in sync when modifying.

### 6.2 Card States

| State | Meaning |
|---|---|
| `todo` | Not started |
| `in_progress` | Being worked on |
| `waiting_on_customer` | Blocked on client input |
| `done` | Completed |
| `cancelled` | Cancelled |

The `__system__: Escalation Check` workflow flags cards stalled in `waiting_on_customer` beyond the configured threshold.

---

## 7. Insights & Documents

**Path:** `/admin-panel/insights`  
**DB table:** `insights_generated_documents`

Lists all AI-generated documents. Filterable by `docType` and `clientId`. Document types include:

| Doc Type | Description |
|---|---|
| `consolidated_sow` | Full Statement of Work generated from M365 profile + services |
| `security_report` | Security posture assessment |
| `governance_report` | Governance gap analysis |
| `diff_report` | Changes detected vs. previous M365 profile snapshot |
| `readiness_report` | M365 adoption readiness score narrative |
| `custom` | Any AI-generated document not fitting a standard type |

Clicking a document opens a full-screen HTML viewer with a download-as-PDF option (triggers `generate_pdf` workflow node inline) and a SharePoint upload button (triggers `save_to_sharepoint`).

**Document generation flow:**
1. Trigger via the `generate_document` workflow node or the "Generate" button in the UI.
2. Document status transitions: `pending` → `generating` → `ready` | `failed`.
3. A `document.generated` event is emitted on success for downstream chaining.

---

## 8. Marketing Command Center

**Path:** `/admin-panel/marketing`  
**Component:** `MarketingCommandCenter.tsx` (~8 600 lines)  
**Data source prefix:** `GET /api/admin/marketing/`

The MCC is the primary marketing operations workspace. It has eight tabs plus a Daily Command panel and a Social Token Health section.

### 8.1 Daily Command Panel

Rendered at the top of every MCC tab. Shows:
- Today's date and a one-sentence AI daily briefing.
- Quick-action buttons: New Campaign, Generate Content, Find Leads, Post to Social.
- `KPIStrip` (4 headline tiles derived from the same 11-metric endpoint as the Dashboard).

### 8.2 Social Token Health

A persistent status bar showing the configured state of each social connector (`LINKEDIN_ACCESS_TOKEN`, `TWITTER_*`, `FACEBOOK_PAGE_ACCESS_TOKEN`). Green = secret present and non-empty; red = missing. Clicking a red indicator links to the Replit Secrets guide.

### 8.3 Tab: AI Leads

Combines lead finder, intent signals, and follow-up queue into a unified view.

**Lead Finder sub-panel:**
- Calls `POST /api/admin/marketing/leads/find` with `{ industry, size, painPoint, location }`.
- Returns a list of AI-suggested prospect companies with suggested outreach hooks.
- "Add as Lead" inserts a new `leads` row.

**Intent Signals feed:**
- `GET /api/admin/marketing/intent-signals` returns today's tracked events.
- Each row shows: lead name, event type, page/context, timestamp, cumulative score.
- "Follow Up Now" pre-fills the outreach composer with the lead's context.

**Follow-up Queue:**
- Leads with `followUpDue` ≤ today, sorted by intent score descending.
- Quick actions: Send Email, Mark Done, Snooze (sets `followUpDue` to tomorrow).

### 8.4 Tab: KPIs

Full-width view of all 11 KPI metrics with sparkline trend charts. Date-range picker controls the comparison window (`GET /api/admin/marketing/kpis?from=&to=`).

### 8.5 Tab: Lead Finder

Dedicated lead prospecting panel (same as AI Leads sub-panel, full-screen layout). Allows bulk export of results to CSV.

### 8.6 Tab: Outreach

Email and SMS campaign composer.

- Compose from a template slug (`GET /api/admin/marketing/templates`) or inline.
- Recipient targeting: select from leads by stage, intent score range, or service area.
- Send via `POST /api/admin/marketing/campaigns/:id/send`.
- Preview pane renders the email HTML in an iframe.

### 8.7 Tab: Content Hub

AI content generation workspace.

**Actions available:**
- **Generate Article** — opens the topic picker; calls `POST /api/admin/marketing/content/generate-article`.
- **Generate Social Post** — AI drafts a LinkedIn/Twitter/Facebook post from an article or topic.
- **Fetch News Headlines** — calls `POST /api/admin/marketing/content/news` to surface M365 news and a campaign brief.
- **Publish to Site** — saves article as Markdown via `POST /api/admin/marketing/content/publish`.
- **Draft Scheduler** — sets a future publish date; the scheduler emits an event at the appointed time.

**Asset library:** All generated images, articles, and PDFs are stored in `content_assets` and browsable in a grid below the composer.

### 8.8 Tab: Analytics

Site and campaign analytics dashboard.

- **Traffic** — daily unique visitors, page views, top landing pages (sourced from `analytics_events` table).
- **Campaign Performance** — open rate, click rate, conversion per campaign.
- **SEO Rankings** — keyword rankings table synced from Google Search Console (`GET /api/admin/marketing/seo/rankings`). "Sync Search Console" button calls `POST /api/admin/marketing/seo/sync` (requires `GOOGLE_SEARCH_CONSOLE_KEY_JSON` and `GOOGLE_SEARCH_CONSOLE_SITE_URL` secrets).

### 8.9 Tab: Tasks

Marketing task board. Tasks are stored in `kanban_tasks` filtered to `board_id = "marketing"`. The same drag-and-drop kanban interface as the Kanban module, pre-filtered.

### 8.10 Tab: Campaigns

Campaign list view.

- **Status:** `draft` | `active` | `paused` | `completed`.
- **Campaign types:** `email`, `sms`, `linkedin`, `twitter`, `facebook`, `mixed`.
- Each campaign has: name, type, status, recipient count, scheduled date, linked content assets, and performance metrics.
- CRUD via `GET|POST|PATCH|DELETE /api/admin/marketing/campaigns`.

---

## 9. Tenant Signals

**Path:** `/admin-panel/tenant-signals`  
**Component:** `TenantSignals.tsx` (~2 800 lines)

Tenant Signals is a rule engine that maps quiz answers and M365 environment data to named **pain signals** and **workflow trigger keys**. The page has two views toggled by the `pageView` state: `"rules"` and `"simulate"`.

### 9.1 Rules View

Lists all signal mappings from the `signal_mappings` table. Each row shows:

| Field | Description |
|---|---|
| Signal Key | Canonical identifier, e.g. `needs_governance_review` |
| Trigger | Workflow trigger key this signal fires |
| Severity | `low` \| `medium` \| `high` \| `critical` |
| Matching Criteria | Quiz answer values or M365 profile thresholds that activate the signal |
| Description | Human-readable explanation |

**CRUD:** Create, edit, and delete signal mappings inline. Signal keys in `engagement_projects.triggered_by` are canonical — changing a key here requires the migration to backfill existing rows (see replit.md Gotchas).

### 9.2 Simulate View

Tests a hypothetical quiz response or M365 profile snapshot against all active rules. Shows which signals would fire and which workflows would be triggered.

Inputs:
- Quiz answer JSON (paste or type).
- M365 profile fields (tenant size, licensed products, governance score, etc.).

Output: A ranked list of matched signals sorted by severity, with the triggered workflow name and a brief explanation.

---

## 10. Script Runner

**Path:** `/admin-panel/scripts`

Interface for browsing the Script Library and executing Azure Automation runbooks.

### 10.1 Script Library

Scripts are grouped by category (e.g., `Workflow Generated`, `M365 Governance`, `Security`). Each script has:
- Title, description, category, created date.
- PowerShell source code viewer.
- "Run" button — opens the parameter input modal.

### 10.2 Running a Script

1. Click **Run** on a script card.
2. Fill in required runbook parameters (sourced from the script's parameter schema).
3. Click **Execute** → calls `POST /api/admin/scripts/:id/run`.
4. Progress is streamed via SSE; the output panel shows stdout/stderr in real time.
5. On completion, the run is logged to `script_runs` and a notification is created.

**Required secrets:** `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_KEY_VAULT_URL`, `AZURE_SUBSCRIPTION_ID`, `AZURE_AUTOMATION_RESOURCE_GROUP`, `AZURE_AUTOMATION_ACCOUNT_NAME`.

The service principal needs **Key Vault Secrets User** and **Key Vault Certificates User** on the vault, and **Automation Operator** on the Automation account.

### 10.3 Runbook Parameter Injection

Customer credentials are fetched from Azure Key Vault at run time by name — they are never stored in the DB. The vault name pattern is configured via `AZURE_KEY_VAULT_URL`. The `clientId` parameter is resolved from the linked client record and injected as `ClientId` into the runbook parameters automatically when using `update_m365_profile` nodes.

---

## 11. System Settings

**Path prefix:** `/admin-panel/system`

### 11.1 Profile & Security (`/system/profile`)

- **Change password** — updates the admin account credential.
- **MFA settings** — enrol or remove TOTP authenticator; register or remove passkeys (WebAuthn). SMS MFA is blocked for admins.
- **Active sessions** — view and revoke active refresh token sessions.
- **Admin accounts** — view and manage all admin users (email, role, password status).

### 11.2 Signal Mappings (`/system/signal-mappings`)

Maps quiz answers and tenant environment data to named pain signals and workflow trigger keys. Same data as the Tenant Signals rules view, accessible from the System menu for configuration without leaving system settings.

Signal keys in `engagement_projects.triggered_by` are canonical — the `0012_engagement_project_signal_keys` migration backfills legacy plan-name strings.

### 11.3 Integrations (`/system/integrations`)

View and manage connected Replit integrations (Stripe, Resend, etc.). Shows connection status, last-tested timestamp, and a **Test** button that calls a lightweight ping endpoint for each integration.

### 11.4 Environment Settings (`/system/environment`)

Read-only view of critical environment variable status (present/missing). Never displays secret values. Covers: Twilio, VAPID keys, Azure credentials, Google Search Console, LinkedIn, Twitter, Facebook, and Stripe keys.

---

## 12. Workflows — Overview & Builder

**Path prefix:** `/admin-panel/workflows`

### 12.1 Workflow List (`/workflows/list`)

Lists all workflow definitions with:
- Name, description, category tag.
- Published version label and version number.
- Trigger summary (type icons, event names).
- Last run status and timestamp.
- **System** badge for seeded workflows (no delete button).
- **Trigger activity** — runs-today badge sourced from `GET /api/admin/workflows/trigger-activity-summary`.
- Actions: Run Now, Duplicate, Edit Triggers, Open Builder, Delete, Publish to Prod.

Workflows can be grouped by the `metadata.category` field (editable via `PUT /api/admin/workflows/definitions/:id`).

### 12.2 Run History (`/workflows/runs`)

Table of all workflow run records. Filterable by definition, status (`pending` | `running` | `completed` | `failed` | `cancelled`), date range, trigger type, and `triggerRef` event name. Supports comma-separated `triggerRefs` for category-level filtering.

Columns: Run ID, Workflow name, Trigger type, Status, Started, Duration.

Clicking a run opens the **Run Detail** page.

### 12.3 Run Detail (`/workflows/runs/:id`)

Shows the full node execution log for a completed or in-progress run:
- Per-node status chips: `ok` (green), `error` (red), `skipped` (grey).
- Node input/output payloads (expandable JSON).
- Log messages per node.
- For-each / parallel iteration indexed records (`node-104[0]`, `node-104[1]`, …) show per-iteration detail.
- **Active node** indicator: while status is `running`, the viewer highlights the most recently started node that has not yet written an output record. Sourced from `activeNodeId` in `GET /api/admin/workflows/runs/:id`.
- Real-time streaming via SSE for in-progress runs.

### 12.4 Workflow Builder (`/workflows/builder/:id`)

The drag-and-drop visual canvas for designing workflow graphs.

**Canvas mechanics:**
- Workflows are stored as `{ nodes: WfNode[], edges: WfEdge[] }` in `wf_versions.graph` (JSONB).
- Nodes carry `{ id, type, position: { x, y }, data }`. Edges carry `{ id, source, target, sourceHandle? }`.
- Canvas uses React Flow for rendering. Node types map to visual components in the node palette.
- Nodes are configured via a right-side **Config Panel** that adapts to the selected node type.

**Versioning:**
- Each definition can have multiple versions stored in `wf_versions`.
- Only one version may be in `"published"` status at a time. Archive-old + publish-new runs atomically in a DB transaction.
- Editing a published version auto-creates a new `"draft"` version (original untouched).
- `is_default = true` marks the system-seeded v1; exposes a **Revert to Default** action.

**AI generation:** The **AI Generate** button (`POST /api/admin/workflows/ai-generate`) accepts a natural-language description and calls Claude Haiku to produce a valid graph. The **AI Refine** button (`POST /api/admin/workflows/ai-refine`) accepts a refinement instruction and the current graph, returning the full updated graph. Both endpoints validate uniqueness, referential integrity, and node counts before returning.

**AI expression helper:** The Config Panel for `condition` and `switch_case` nodes has an inline "Write with AI" button (`POST /api/admin/workflows/expression-helper`) that converts a natural-language description into a workflow expression string, using the upstream variables currently available to the node.

**AI narrative:** The **Explain** button in the builder toolbar (`POST /api/admin/workflows/definitions/:id/explain`) sends the current canvas graph (including unsaved edits) to Claude Haiku and returns a 3–7 sentence plain-English narrative of what the workflow does.

**Draft test-run:** The **Test Run** button (`POST /api/admin/workflows/definitions/:id/test-run`) executes the live canvas graph without requiring a publish step. Uses `dryRun: true` by default. The submitted `nodes`/`edges` are passed as an `inlineGraph` override to the executor; no new version record is created.

**Publish to production:** The **Push to Prod** button (`POST /api/admin/workflows/definitions/:id/publish-to-prod`) upserts the definition, published version, and triggers into the production database (requires `DATABASE_URL_PROD` secret). Returns `503` if the secret is absent.

### 12.5 Variable Interpolation

All node text fields support `{{variable}}` syntax at runtime:

| Syntax | Resolves To |
|---|---|
| `{{fieldName}}` | Shorthand for `payload.fieldName` |
| `{{payload.fieldName}}` | Direct access to trigger payload |
| `{{steps.nodeId.outputField}}` | Output from a previously-executed node |
| `{{steps.ask.aiResponse}}` | Nested example |
| Arrays/objects | Emitted as compact JSON strings |

Use `resolveExprNative()` (instead of `interp()`) when a field must preserve native type (e.g., a `run_workflow` `inputMapping` that should pass an integer, not a string).

### 12.6 Condition Expression Syntax

Conditions are evaluated without `eval`. The expression parser supports:

```
path op literal       →  status == 'paid'
boolean path          →  isQualified
logical operators     →  score >= 80 && status != 'closed_lost'
contains operator     →  message contains 'urgent'
template reference    →  {{stripeInvoiceId}} && paymentPlan == 'phased'
```

Operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`. Logical: `&&`, `||`.

### 12.7 BFS Execution Model

The workflow executor (`workflow-executor.ts`) uses **breadth-first traversal** with a convergence-safe algorithm:

- `resolvedCount[node]` — how many predecessor edges have been resolved.
- `activeCount[node]` — how many of those predecessors were non-skipped.
- A node is **ready** when `resolvedCount == inDegree`.
- A node is **skipped** when ready and `activeCount == 0` (all predecessors were themselves skipped).

This correctly handles converging branches (nodes with multiple incoming edges from `if/else` or parallel splits).

**Run lifecycle:** `pending` → `running` → `completed` | `failed` | `cancelled` | `awaiting_approval`.

**Dry Run mode:** All DB-writing nodes are stubbed with realistic synthetic outputs. Structural nodes (`start`, `end`, `condition`, `switch_case`, etc.) still execute normally so condition branches can be traced. The `delay` node always skips in dry-run mode.

**Concurrency & depth limits:** Each definition has `concurrencyLimit` (1–50, default 5) and `maxRunDepth` (1–10, default 5) to prevent runaway recursion from `emit_event` → self-trigger loops.

### 12.8 Trigger Configuration (`/workflows/triggers/:id`)

Allows adding, editing, enabling/disabling, and deleting triggers for a definition without opening the full builder. Shows trigger type, config (CRON, event name, webhook token), enabled state, and last-fired timestamp.

**Webhook token rotation:** `POST /api/admin/workflows/definitions/:id/triggers/:tid/rotate-token` generates a new 32-byte hex token and invalidates the old one.

**Trigger activity stats:** `GET /api/admin/workflows/definitions/:id/triggers/:tid/stats` returns 30-day daily buckets of fire counts, error counts, and average duration.

**Pending Approvals:** `GET /api/admin/workflows/pending-approvals` lists all runs paused at an `approval_gate` node. Approving resumes the run; rejecting marks it `failed`.

### 12.9 Execution Trend Analytics

`GET /api/admin/workflows/definitions/:id/trends?days=30` returns:
- `daily[]` — per-day counts of total / success / failure runs and average duration.
- `durations[]` — per-day p50 and p95 node execution latencies.
- `topFailingNodes[]` — the three node IDs with the highest error count.

---

## 13. Workflow Triggers Reference

### 13.1 Trigger Types

| Type | Config | Description |
|---|---|---|
| `manual` | — | "Run Now" button in the UI. Supports `ask_for_input` fields collected in a modal before the run starts. |
| `schedule` | `cron` (5-field CRON string) | Fires at the next computed UTC time. `computeNextCronRun(cron)` calculates the next run and writes it to `wf_triggers.next_run_at`. |
| `event` | `eventName` string | Subscribes to the internal event bus. Fires whenever `broadcastAdminWorkflowEvent(name, payload)` is called with a matching name. |
| `webhook` | Auto-generated token | `POST /api/webhooks/workflow/:token`. Token is 24 random bytes hex. Rotate via the UI. |
| `startup` | — | Fires once per server boot. Used for orphan recovery and one-time init tasks. |

### 13.2 Schedule Fan-out

A schedule trigger with `perRecord: true` creates a separate run for each matching record (e.g., one run per active client). Without the flag, a single run fires with aggregate data.

### 13.3 Trigger Event Observability

Every trigger fire writes a row to `wf_trigger_events`:

| Field | Description |
|---|---|
| `triggerId` | FK to `wf_triggers` |
| `runId` | The `wf_runs` row created (null if concurrency-skipped) |
| `status` | `fired` \| `skipped` \| `error` |
| `durationMs` | Time from trigger receipt to run creation |
| `payload` | Request body (webhook) or event payload |
| `firedAt` | Timestamp |

The trigger detail panel in the UI charts these events as a 30-day bar chart.

### 13.4 Built-in Schedules

| Workflow | CRON | UTC Time | Purpose |
|---|---|---|---|
| Weekly Article Generator | `0 9 * * 1` | Monday 09:00 | Generates and saves a draft M365 article |
| `__system__: Workflow Cleanup` | `0 3 * * *` | Daily 03:00 | Deletes workflow runs older than 90 days |
| `__system__: Escalation Check` | `0 8 * * *` | Daily 08:00 | Flags script cards stalled in "Waiting on Customer" |
| `__system__: Monthly Insights` | `0 9 1 * *` | 1st of month 09:00 | Runs all enabled insights automations |

---

## 14. Workflow Events Catalog

Events are emitted by server-side handlers and workflow nodes. Any enabled workflow with a matching event trigger will fire. Payload fields marked `?` are optional.

### 14.1 Presentation & SOW Events

| Event | Emitted By | Key Payload Fields | Common Use |
|---|---|---|---|
| `presentation.phases_requested` | Client advances past SOW step | `projectTitle`, `totalPrice`, `selectedPhases`, `sowHtml`, `presentationId`, `clientName` | Fire Presentation Phase Generator |
| `sow.generate` | Server when presentation enters `pending_sow` | `clientUserId`, `projectId`, `title`, `presentationId` | Trigger SOW Generation |
| `sow.generation_stalled` | Portal client after 2 min on `pending_sow` with no document | `projectId`, `presentationId`, `customerId` | Trigger SOW Generation Auto-Retry |
| `sow.generation_retried` | SOW Auto-Retry on successful retry | `presentationId` | Audit trail; chain to notifications |
| `sow.scope_reduced` | Server when client deselects phases | `presentationId`, `projectId`, `clientUserId`, `previousTotal`, `newTotal` | Re-engagement automations (disabled by default) |
| `document.generated` | Server after document saved | `documentId`, `docType`, `category`, `clientId`, `projectId?` | Notify admin; chain to PDF/SharePoint |

### 14.2 Agreement & Payment Events

| Event | Emitted By | Key Payload Fields | Common Use |
|---|---|---|---|
| `agreement_signed` | Server on contract signature | `presentationId`, `projectId`, `clientEmail`, `clientName`, `paymentPlan`, `stripeSessionId`, `contractId` | Create phased invoices; send welcome email |
| `contract.signed` | Alias for `agreement_signed` | Same as above | Interchangeable |
| `payment.received` | Stripe webhook handler | `sessionId`, `customerId`, `amountTotal`, `serviceType`, `clientEmail` | SMS alert, create client account |
| `onboarding.complete` | Portal onboarding wizard submitted | `clientId`, `projectId?` | Trigger project provisioning |

### 14.3 Phase & Project Events

| Event | Emitted By | Key Payload Fields | Common Use |
|---|---|---|---|
| `phase_completed` | Admin marks phase complete | `projectId`, `phaseId`, `clientName`, `stripeInvoiceId?`, `paymentPlan` | Auto-charge phased invoice |
| `phase.delivery_date_changed` | Admin updates phase delivery date | `projectId`, `phaseId`, `newDueDate`, `paymentPlan`, `stripeInvoiceId?` | Sync Stripe invoice due date |
| `milestone.delivery_date_changed` | Admin updates milestone date | `projectId`, `milestoneId`, `newDueDate` | Calendar event update; notification |

### 14.4 Kanban Events

| Event | Emitted By | Key Payload Fields | Common Use |
|---|---|---|---|
| `kanban.card_moved` | Kanban card drag-and-drop | `cardId`, `boardId`, `fromColumn`, `toColumn`, `clientId?` | Fire `__system__: Kanban Auto-fire` |

### 14.5 Workflow Chaining Events

The `emit_event` node broadcasts any arbitrary named event on the internal bus. This enables workflow-to-workflow chaining without direct coupling. The `presentation.phase_gen.progress` and `presentation.phase_gen.complete` events are consumed by the client portal's SSE listener to show real-time phase generation progress.

---

## 15. Workflow API Reference

All admin endpoints require `Authorization: Bearer <accessToken>` and the `admin` role. The public webhook endpoint has no auth but validates a per-trigger token.

### 15.1 Definitions

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/workflows/definitions` | List all definitions. Returns latest published version label and last run summary per definition. |
| `POST` | `/api/admin/workflows/definitions` | Create a new definition. Body: `{ name, description?, concurrencyLimit?, maxRunDepth?, metadata? }`. |
| `GET` | `/api/admin/workflows/definitions/:id` | Get a single definition with its versions. |
| `PUT` | `/api/admin/workflows/definitions/:id` | Update definition metadata. Body: `{ name?, description?, concurrencyLimit?, maxRunDepth?, metadata? }`. |
| `DELETE` | `/api/admin/workflows/definitions/:id` | Delete definition, all versions, triggers, and runs. Blocked if `metadata.system = true`. |

### 15.2 Versions

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/workflows/definitions/:id/versions` | List all versions for a definition. |
| `POST` | `/api/admin/workflows/definitions/:id/versions` | Create a new draft version. Body: `{ graph: { nodes, edges }, label? }`. |
| `GET` | `/api/admin/workflows/definitions/:id/versions/:vid` | Get a specific version including its graph. |
| `PUT` | `/api/admin/workflows/definitions/:id/versions/:vid` | Update a draft version's graph or label. If the version is published, auto-creates a new draft version and updates that instead. |
| `POST` | `/api/admin/workflows/definitions/:id/versions/:vid/publish` | Publish a version. Archives the current published version atomically in a DB transaction. |
| `POST` | `/api/admin/workflows/definitions/:id/revert-to-default` | Re-publishes the pinned v1 default version (system workflows only). |

### 15.3 Triggers

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/workflows/definitions/:id/triggers` | List all triggers for a definition. |
| `POST` | `/api/admin/workflows/definitions/:id/triggers` | Create a trigger. Body: `{ type: "manual"\|"schedule"\|"webhook"\|"event", config?, enabled? }`. For `webhook` type, a 24-byte hex token is auto-generated. |
| `PATCH` | `/api/admin/workflows/definitions/:id/triggers/:tid` | Update trigger config or enabled state. |
| `DELETE` | `/api/admin/workflows/definitions/:id/triggers/:tid` | Delete a trigger. Returns `204`. |
| `GET` | `/api/admin/workflows/definitions/:id/triggers/:tid/events` | Fetch recent trigger event history. Query: `limit` (max 200). |
| `GET` | `/api/admin/workflows/definitions/:id/triggers/:tid/stats` | 30-day daily fire-count buckets, total fires, avg duration, last fired timestamp. |
| `POST` | `/api/admin/workflows/definitions/:id/triggers/:tid/test-fire` | Test-fire a trigger. Creates a manual run, records a `wf_trigger_events` row. Returns `{ runId, eventId }`. |
| `POST` | `/api/admin/workflows/definitions/:id/triggers/:tid/rotate-token` | Rotate webhook token (webhook triggers only). Returns the updated trigger row. |
| `GET` | `/api/admin/workflows/trigger-activity-summary` | Returns today's run counts and last-fired timestamps for all definitions in one query (used by the workflow list page). |

### 15.4 Manual Trigger & Test Runs

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/workflows/definitions/:id/run` | Fire the published version manually. Body: `{ payload?, versionId?, inputValues? }`. Returns `202 { runId }`. |
| `POST` | `/api/admin/workflows/definitions/:id/test-run` | Execute the live canvas graph (without publishing). Body: `{ nodes, edges, triggerPayload?, inputValues?, dryRun? }`. Defaults to `dryRun: true`. Returns `202 { runId }`. |

### 15.5 Runs

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/workflows/runs` | List runs. Query params: `definitionId`, `status`, `from`, `to`, `triggerType`, `triggerRef`, `triggerRefs` (comma-separated), `limit` (max 200), `offset`. |
| `GET` | `/api/admin/workflows/runs/:id` | Get full run detail: `graph`, `logs`, `nodeOutputs`, `nodeResultMap`, `activeNodeId`, `durationMs`. |
| `POST` | `/api/admin/workflows/runs/:id/cancel` | Cancel a `pending` or `running` run. Returns `409` if not in a cancellable state. |
| `POST` | `/api/admin/workflows/runs/:id/rerun` | Re-run a `failed`, `cancelled`, or `completed` run using the same payload and version. Sets `retriggeredFromRunId` on the new run. |

### 15.6 Pending Approvals

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/workflows/pending-approvals` | List all runs paused at an `approval_gate` node. |
| `POST` | `/api/admin/workflows/pending-approvals/:id/decide` | Approve or reject. Body: `{ decision: "approved"\|"rejected", note? }`. Approved → resumes run via `resumeWorkflowRun`. Rejected → marks run `failed`. |

### 15.7 Webhook (Public)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/webhooks/workflow/:token` | Fire a webhook-triggered workflow. Token must match an enabled trigger. Body becomes the run payload. Returns `202 { runId }`. No auth header required. |

### 15.8 AI Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/workflows/ai-generate` | Generate a new graph from a natural-language description. Body: `{ description, triggerContext? }`. Uses Claude Haiku. Returns `{ nodes, edges, unsupportedFeatures?, replitPrompt? }`. |
| `POST` | `/api/admin/workflows/ai-refine` | Refine an existing graph. Body: `{ instruction, graph: { nodes, edges } }`. Returns `{ nodes, edges }`. |
| `POST` | `/api/admin/workflows/expression-helper` | Generate a condition/value expression from plain English. Body: `{ userPrompt, availableVariables[], expressionType: "boolean"\|"value" }`. Returns `{ expression, explanation }`. |
| `POST` | `/api/admin/workflows/synthesise-sound` | Generate Web Audio API synthesis parameters from a description. Body: `{ description }`. Returns `{ params }` (waveform, notes, envelope). Browser synthesises audio client-side. |
| `POST` | `/api/admin/workflows/definitions/:id/explain` | AI narrative of the workflow (accepts unsaved canvas graph in body). Returns `{ narrative }`. |

### 15.9 Analytics

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/workflows/definitions/:id/trends` | Execution trend data. Query: `days` (1–90, default 30). Returns `{ daily[], durations[], topFailingNodes[] }`. |

### 15.10 SSE Stream

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/workflows/sound-events` | SSE stream for real-time `play_sound` events (browser target). Admin panel tabs subscribe on mount. |

### 15.11 Production Sync

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/workflows/definitions/:id/publish-to-prod` | Upserts definition, published version, and triggers into the production DB. Requires `DATABASE_URL_PROD` secret. Returns `503` if not configured. |

---

## 16. Seeded System Workflows

System workflows are seeded idempotently on server startup by `seedSystemWorkflows()` in `seed-system-workflows.ts`. They carry `metadata.system = true`, show a **System** badge in the UI, cannot be deleted, and expose a **Revert to Default** action that re-publishes the pinned v1 graph.

Upsert logic: definitions are identified by stable name; v1 is inserted once (`is_default = true`) and never overwritten; triggers are inserted only if none exist for the definition.

### 16.1 Presentation Phase Generator

| Field | Value |
|---|---|
| Trigger | `event: presentation.phases_requested` |
| Enabled | Yes |
| Purpose | Reads the scoped SOW HTML, asks Claude Haiku to propose 3–5 project phases with price weights, saves them back to the presentation, then generates and saves a professional project title. Streams SSE progress events to the client's browser in real time. |

**Node flow:** start → emit progress → ask_ai (generate phases) → emit progress → compose (parse JSON) → emit progress → system_action (save_presentation_phases) → ask_ai (generate title) → compose (parse title) → system_action (save_presentation_title) → emit complete → end

### 16.2 Weekly Article Generator

| Field | Value |
|---|---|
| Trigger | `schedule: 0 9 * * 1` (Monday 09:00 UTC) |
| Enabled | Yes |
| Purpose | Generates a new M365 article via `generate_article` and saves it as a draft (not published) via `publish_article` with `draftOnly: true`. The article appears in the Content Hub for review before publication. |

**Node flow:** start → generate_article → publish_article (draftOnly) → end

### 16.3 `__system__: Orphan Reconciliation`

| Field | Value |
|---|---|
| Trigger | `startup` |
| Enabled | Yes |
| Purpose | Recovers kanban cards orphaned by a mid-run server restart and detects stalled phases. Runs once per server boot. |

**Node flow:** start → system_action (reconcile_orphaned_runs) → end

### 16.4 `__system__: Workflow Cleanup`

| Field | Value |
|---|---|
| Trigger | `schedule: 0 3 * * *` (Daily 03:00 UTC) |
| Enabled | Yes |
| Purpose | Deletes workflow run records older than 90 days to keep the `wf_runs` table lean. |

**Node flow:** start → system_action (cleanup_old_runs) → end

### 16.5 `__system__: Escalation Check`

| Field | Value |
|---|---|
| Trigger | `schedule: 0 8 * * *` (Daily 08:00 UTC) |
| Enabled | Yes |
| Purpose | Flags manual script kanban cards that have been stalled in the "Waiting on Customer" column beyond the configured threshold. |

**Node flow:** start → system_action (check_escalations) → end

### 16.6 `__system__: Monthly Insights`

| Field | Value |
|---|---|
| Trigger | `schedule: 0 9 1 * *` (1st of month 09:00 UTC) |
| Enabled | Yes |
| Purpose | Fires all enabled insights automations whose `next_run_at` has arrived. |

**Node flow:** start → system_action (run_monthly_insights) → end

### 16.7 `__system__: Kanban Auto-fire`

| Field | Value |
|---|---|
| Trigger | `event: kanban.card_moved` |
| Enabled | Yes |
| Purpose | Handles kanban card move events to auto-execute Azure runbook scripts and document generation for client cards. Logic lives in `kanban-auto-fire.ts`; side effects must also be mirrored in the `processRunInBackground` path. |

**Node flow:** start → system_action (auto_fire_kanban) → end

### 16.8 SOW Scope Reduced — Re-engagement

| Field | Value |
|---|---|
| Trigger | `event: sow.scope_reduced` |
| Enabled | **No (disabled)** — starter skeleton only |
| Purpose | Triggered when a client deselects phases and regenerates a lower-value SOW. Add re-engagement actions (email, SMS, CRM update) and enable the trigger before going live. |

**Node flow:** start → end (stub — no action nodes)

### 16.9 SOW Generation Auto-Retry

| Field | Value |
|---|---|
| Trigger | `event: sow.generation_stalled` |
| Enabled | Yes |
| Purpose | When a client has been on the SOW-pending step for 2+ minutes with no document, checks the latest `consolidated_sow` row in `insights_generated_documents`. Retries generation if the row is absent, failed, or has been stuck in `generating` for > 5 minutes (`age_ms > 300000`). Then writes SOW pricing lines and emits `sow.generation_retried`. |

**Node flow:** start → sql_query (fetch latest SOW row, including `age_ms`) → condition (status != 'generating' \|\| age_ms > 300000) → [true] → generate_document (regenerate) → action (calculate_pricing) → emit_event (sow.generation_retried) → end | [false] → end (already generating)

> **Seeder patches:** Three idempotent SQL patches are applied to existing v1 graphs: (1) adds `age_ms` to the SELECT; (2) updates the condition expression and normalises `yes/no` edge handles to `true/false`; (3) inserts the `calc_pricing` node between generate and emit. Guards prevent re-applying.

### 16.10 Agreement Signed: Phased Invoice Setup

| Field | Value |
|---|---|
| Trigger | `event: agreement_signed` |
| Enabled | Yes |
| Purpose | When a client signs and selects a phased payment plan, creates one draft Stripe invoice per SOW phase (covering the 80% balance), stores the deposit payment method as the customer default for future auto-charges, and writes `stripeInvoiceId` back to each `workflow_steps` row. Sends an admin notification on success. |

**Node flow:** start → condition (paymentPlan == 'phased') → [yes] create_phased_invoices → create_notification → end | [no] end

### 16.11 Sync Stripe Invoice Due Date When Phase Delivery Shifts

| Field | Value |
|---|---|
| Trigger | `event: phase.delivery_date_changed` |
| Enabled | **No (disabled)** |
| Purpose | When an admin changes a phase delivery date, guards on phased payment plan, looks up the draft Stripe invoice for the project, and calls `edit_stripe_invoice` to sync the due date. Sends an admin notification on success. |

**Node flow:** start → condition (phased) → [yes] find_object (stripe_invoice by projectId) → condition (found) → [yes] edit_stripe_invoice → create_notification → end | [no] end

### 16.12 Phase Completed: Auto-Charge Invoice

| Field | Value |
|---|---|
| Trigger | `event: phase_completed` |
| Enabled | Yes |
| Purpose | When an admin marks a phase complete and the phase has a linked Stripe invoice and a phased payment plan, finalises and immediately charges the draft invoice. Sends a success or failure notification. Failed charges do not throw — a downstream condition branches to the failure notification. |

**Node flow:** start → condition (stripeInvoiceId && paymentPlan == 'phased') → [yes] charge_stripe_invoice → condition (chargeStatus == 'succeeded') → [yes] notify success → end | [no] notify failure → end | [no] end

### 16.13 SOW Generation

| Field | Value |
|---|---|
| Trigger | `event: sow.generate` |
| Enabled | **No (disabled)** — enable when `generate_document` credentials are configured |
| Purpose | Generates a Consolidated SOW document for a client engagement. On failure, refreshes the M365 profile and intelligence tables before retrying. Sends a failure notification if the retry also fails. |

**Node flow:** start → generate_document (consolidated_sow) → [success] end | [onError] update_m365_profile → update_intelligence_tables → generate_document (retry) → [success] end | [onError] create_notification → end

> **Seeder patch:** Renames `clientUserId` → `clientId` on `gen_sow`, `retry_sow`, `refresh_profile`, and `refresh_intel` nodes; adds `docCategory = "consulting"` and `runbookName = "Update-M365-Profile"`. Guard: fires only if the old field name is still present.
