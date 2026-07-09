# Admin Panel — Internal Reference

> **Audience:** Shane (operator), developers maintaining the platform, and AI agents operating on this codebase.
> **Last updated:** 2026-07-09
> **Source of truth for node details:** [workflow-node-reference.md](./workflow-node-reference.md)
> **Scope:** This document is a complete, precise technical reference for the Admin Panel (`artifacts/admin-panel`) and its API surface (`artifacts/api-server/src/routes/admin-*.ts`). It is written to be precise enough to serve as an AI system prompt — every endpoint, table, and configuration value referenced here reflects the current codebase and live database state.

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
10. [Workflow Builder](#10-workflow-builder)
11. [Workflow Node Reference](#11-workflow-node-reference)
12. [Workflow API Reference](#12-workflow-api-reference)
13. [Workflow Database Schema](#13-workflow-database-schema)
14. [Workflow Triggers Reference](#14-workflow-triggers-reference)
15. [Workflow Events Catalog](#15-workflow-events-catalog)
16. [Seeded System Workflows](#16-seeded-system-workflows)
17. [Script Runner](#17-script-runner)
18. [System Settings](#18-system-settings)

---

## 1. Overview & Authentication

The Admin Panel is a React + Vite SPA served at `/admin-panel/`. It communicates with the API server at `/api/` via JWT-authenticated `fetchWithAuth()` calls. Access tokens are 15-minute short-lived JWTs; a refresh token in `localStorage` exchanges for a new access token automatically.

**Authentication flow:**
1. POST `/api/auth/admin/login` with `{ email, password }` → `{ accessToken, refreshToken }`.
2. All subsequent requests include `Authorization: Bearer <accessToken>`.
3. Expired access tokens trigger an automatic silent refresh via `POST /api/auth/admin/refresh`.

**Session context:** `AuthContext` (`artifacts/admin-panel/src/contexts/AuthContext.tsx`) exposes `user`, `token`, `fetchWithAuth`, and `logout`. All data-fetching components call `fetchWithAuth` rather than raw `fetch` — critical because SSE/long-polling connections also need fresh tokens. `fetchWithAuth` must never set `Content-Type` unconditionally: `FormData` uploads rely on the browser setting the header (with the multipart boundary) itself.

**Admin roles:** `admin` (full access) and `viewer` (read-only; UI hides mutating controls).

**Note on the Marketing Command Center:** its routes (`/api/admin/marketing/...`) use a separate, simpler `Authorization: Bearer <password>` scheme validated against the `CRM_ADMIN_PASSWORD` environment variable, rather than the JWT scheme described above. This is a distinct auth path from the rest of the Admin Panel — see [Section 8](#8-marketing-command-center).

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

Note: the CRM artifact (`artifacts/crm`) serves the client-facing portal, not the admin views above. Admins who navigate to `/crm` are redirected to `/admin-panel/` via `window.location`.

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

> **Note:** This is a distinct KPI/dashboard implementation from the Marketing Command Center's own KPI tile set (see [8.1](#81-daily-command-panel--kpi-tiles)); the two share only 4 overlapping metric names and are backed by different endpoints (`/api/admin/dashboard/kpis` vs. `/api/admin/marketing/kpi`).

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
**Component:** `MarketingCommandCenter.tsx` (`artifacts/admin-panel/src/pages/MarketingCommandCenter.tsx`)
**API routes:** `artifacts/api-server/src/routes/admin-marketing.ts`
**Access:** Every route under `/api/admin/marketing/...` is protected by `requireAdmin` middleware, which validates `Authorization: Bearer <password>` against `CRM_ADMIN_PASSWORD`. Unauthenticated requests receive `401 Unauthorized`. This is a distinct auth scheme from the JWT-based scheme used by the rest of the Admin Panel (Section 1).

The MCC is the primary marketing operations workspace. It renders a horizontal tab bar; each tab maps to a section component. Only the active tab renders — others are unmounted, so each section re-fetches its data on mount.

| Tab Label | Component | Nav Key |
|---|---|---|
| AI Leads | `RecommendedLeadsSection` | `ai_leads` |
| KPIs | `KPIStrip` | `kpis` |
| Lead Finder | `LeadFinderSection` | `lead_finder` |
| Outreach | `OutreachAutomationSection` | `outreach` |
| Content | `ContentHubSection` | `content` |
| Analytics | `TrafficAnalyticsSection` | `analytics` |
| Tasks | `MarketingTasksKanban` | `tasks` |
| Campaigns | `CampaignBuilderWizard` | `campaigns` |

> KPIs (live count tiles) and Analytics (charts & email stats) are two distinct tabs. KPIs is a lightweight strip of four real-time numbers; Analytics is a full chart dashboard.

### 8.1 Daily Command Panel / KPI Tiles

Rendered at the top of every MCC tab / as the `kpis` tab (`KPIStrip` component). Four summary tiles:

| Tile | Description |
|---|---|
| Visitors Today | Count of `analytics_sessions` rows where `startedAt >= today's midnight (UTC local)` |
| Leads This Week | Count of `leads` rows where `createdAt >= 7 days ago` |
| Conversion Rate | Count of `analytics_site_events` with `event_type = "cta_click"` and `createdAt >= 7 days ago` ÷ Visitors Today × 100, one decimal place (returned as a **string**, e.g. `"3.7"`) |
| Active Campaigns | Count of `campaigns` with `status = "active"` |

Data source: `GET /api/admin/marketing/kpi` → `{ visitorsToday, leadsThisWeek, conversionRate, activeCampaigns }`. While loading, tiles show a skeleton; on error, tiles show `"—"`.

Also shows a persistent **Social Token Health** status bar: green = secret present/non-empty, red = missing, for `LINKEDIN_ACCESS_TOKEN`, `TWITTER_*`, `FACEBOOK_PAGE_ACCESS_TOKEN`. Clicking a red indicator links to the Replit Secrets guide.

### 8.2 Tab: AI Leads (`RecommendedLeadsSection`)

Generates a batch of AI-recommended prospects matched to Shane's Ideal Customer Profile (ICP), lets the admin review each one, and take direct action (add to CRM, send outreach, dismiss).

**Auto-generate on mount:** fetches `GET /api/admin/marketing/recommended-leads`; if no `status = "pending"` leads exist, automatically calls `generate()` (guarded via `useRef` to prevent re-trigger on re-render).

**Generating leads:** `POST /api/admin/marketing/recommended-leads/generate`. Uses `buildICPContext()` (see [8.9](#89-ai-integration)) and asks Claude (`claude-haiku-4-5`, max 2000 tokens) for 7 recommended leads. The prompt includes a compliance constraint: Shane is a full-time federal NASA employee and is prohibited from recommending companies with known NASA/federal prime-or-sub contract relationships — only private-sector, commercially-focused companies are suggested.

Each lead object: `name`, `company`, `role`, `email`, `industry`, `companySize`, `location`, `painPoints[]`, `whyFit`, `recommendedService`, `confidence` (0–100 int). Parsed via `parseAiJson`, inserted into `recommended_leads`.

**Lead cards:** responsive grid; only `status = "pending"` shown. Confidence badge colour: green ≥80, yellow ≥60, grey <60. Clicking the card (outside action buttons) opens `RecommendedLeadSlideOver`.

**Card / slide-over actions:** Add to Leads (`convert`), Email / LinkedIn / Follow-Up Seq. (open `OutreachModal` with the matching `templateType`), Add Task (`AddTaskModal`), Add to Campaign (`AddToCampaignModal`), Dismiss.

**Convert to CRM lead:** `POST /api/admin/marketing/recommended-leads/{id}/convert` — body `{ outreachDraft: string | null }`. Creates a `leads` record with `source = "ai_recommended"`, `status = "contacted"`, `stage = "AQL"`, a generated email fallback (`firstname.lastname@company.com`) if none provided, and `notes` containing `whyFit`/`recommendedService`/`confidence`/draft. Updates the `recommended_leads` row to `status = "converted"` with `convertedLeadId`.

**Dismiss & undo:** optimistic `status = "dismissed"`. If a saved draft exists, shows an undo toast and defers the `PATCH .../dismiss` call for 5 seconds (cancellable). Without a draft, the PATCH fires immediately.

**`AddTaskModal`:** prefilled Title `"Outreach: {name} @ {company}"`, Description = `whyFit`. Saves via `POST /api/admin/marketing/tasks` with `status = "ideas"`.

**`AddToCampaignModal`:** lists campaigns (`GET /api/admin/marketing/campaigns`); saving calls `POST /api/admin/marketing/campaign-assets` with `assetType = "follow_up_task"` — creates a campaign asset, does not tag the lead record.

### 8.3 Tab: Lead Finder (`LeadFinderSection`)

A searchable, filterable table over CRM lead records. Data: `GET /api/leads?limit=100` (the shared CRM leads endpoint, not marketing-specific).

**Filters** (all AND'd, client-side): Search (name/company/email/industry substring), Status (`new`/`contacted`/`qualified`/`converted`/`archived`), Source (`ai_suggested`/`ai_recommended`/`contact_form`/`lead_magnet`), Industry, Company Size, Location (dynamically built from loaded data). Up to 50 matches shown.

**Table columns:** Name/Email · Company/Location · Industry/Size · Source (badge) · Status (badge) · Stage (MQL/SQL/AQL) · Score · Actions.

**Row actions:** Email / LinkedIn / Follow-Up (open `OutreachModal` with matching type + `leadId`), Call Script (`cold_call` type), History (`LeadEmailHistoryModal`).

**`OutreachModal`:** accepts `leadId` or `recommendedLeadId`; 4 type tabs (Cold Email / LinkedIn / Follow-Up Seq. / Cold Call Script). **Generate/Regenerate** calls `POST /api/admin/marketing/generate/outreach` with `{ leadId?, recommendedLeadId?, name, templateType }` → `{ content }`. Footer: Save Template (`POST /api/admin/marketing/outreach-templates`) and Send Email (shown only for `cold_email`/`followup`/`newsletter`, opens `SendEmailModal`). When generated for a `recommendedLeadId`, the draft auto-saves to `recommended_leads.last_outreach_draft`.

**`SendEmailModal`:** "Send via Exchange Online" — To/Subject/Body all editable (Subject pre-extracted via `SUBJECT: …` regex), optional Campaign dropdown. `POST /api/admin/marketing/send-outreach`. Success: green ✓, auto-close after 1.8s. Failure: amber panel for 503/401/403 config errors, red for other errors.

**`LeadEmailHistoryModal`:** `GET /api/admin/marketing/leads/{id}/emails` — chronological `email_events` list.

### 8.4 Tab: Outreach (`OutreachAutomationSection`)

Generates personalised outreach copy, saves reusable templates, and sends email via Exchange Online, independent of a specific CRM lead record.

**Tabs:** Cold Email (`cold_email`), LinkedIn (`linkedin`), Follow-Up Seq. (`followup`), Cold Call Script (`cold_call`).

**Prospect fields:** Name, Company, Role, Industry (manual or AI-suggested).

**✦ Suggest:** `POST /api/admin/marketing/generate/outreach-suggest` → `{ name, company, role, industry }`. After suggesting, a **+ Add to Leads** button calls `POST /api/admin/leads` (admin lead creation endpoint) with `source: "ai_suggested"`.

**✦ Generate:** `POST /api/admin/marketing/generate/outreach` with `{ templateType, name, company, role, industry }` → `{ content }`.

**Campaign tagging:** dropdown from `GET /api/admin/marketing/campaigns`; selected `campaignId` passed at send time.

**Save Template:** `POST /api/admin/marketing/outreach-templates`; saved templates browsable/loadable/deletable in a collapsible panel.

**Send Email:** opens `SendEmailModal` (see 8.3), pre-filled, with the tagged `campaignId` passed through.

### 8.5 Tab: Content Hub (`ContentHubSection`)

Generates marketing content across five formats and manages a saved-asset library.

**Content type tabs:** Blog Post (`blog_post`), LinkedIn (`linkedin_post`), Newsletter (`newsletter`), Social Posts (`social_post`), SEO Keywords (`seo_keywords`).

**Input fields:** Topic (required), Tone (optional), Keywords (optional, comma-separated).

**✦ Suggest:** `POST /api/admin/marketing/generate/content-suggest` → `{ topic, tone, keywords }`.
**✦ Generate:** `POST /api/admin/marketing/generate/content` with `{ contentType, topic, tone, keywords }` → `{ content }`.

**Save Asset:** `POST /api/admin/marketing/campaign-assets` with `{ assetType, title: topic, content }` (no `campaignId` — standalone).

**Saved Assets List:** `GET /api/admin/marketing/campaign-assets?assetType=<type>`. Actions: Expand/Collapse, Copy, Delete (`DELETE /api/admin/marketing/campaign-assets/{id}`).

### 8.6 Tab: Analytics (`TrafficAnalyticsSection`)

Visualises website traffic, conversions, email sends, campaign ROI, and SEO rankings from first-party Postgres data. Loads `GET /api/admin/marketing/analytics` and `GET /api/admin/marketing/email-stats` independently on mount.

| Panel | Chart Type | Data |
|---|---|---|
| Visitors (Last 7 Days) | Line chart | 7-day daily visitor counts from `analytics_sessions` |
| Traffic Sources | Pie chart | 30-day sessions grouped by `utm_source` or Direct/Referral |
| Conversion Funnel (30 Days) | Funnel chart | Visitors → Contact Page → Leads → Converted |
| Revenue per Lead by Campaign | Ranked bar list, inline-editable | All campaigns sorted by `revenueAttributed ÷ leadsGenerated` desc; 0-lead campaigns show `—` |
| Top Pages (Last 30 Days) | Horizontal bar chart | Top 10 pages by view count, `analytics_pageviews` |
| Email Stats | Summary card | 30-day `email_events` totals |
| SEO Rankings | Keyword list | All rows in `seo_rankings` |

**Revenue per Lead inline edit:** pencil icon expands "Leads Generated" / "Revenue Attributed ($)" inputs; saves via `PATCH /api/admin/marketing/campaigns/{id}`, then reloads analytics.

**Email Stats Card:** `GET /api/admin/marketing/email-stats` → `{ totalSent, hasData, dailyTrend: [{ day, sent }] }`. Only tracks `sent` events — open/click/bounce counts are not included unless recorded separately.

**SEO Rankings Card:** rows colour-coded by position (emerald ≤3, blue ≤10, amber ≤20, grey >20); shows keyword, URL, monthly volume, and position-change delta vs. `previousPosition`. Add/Edit form: Keyword (required), Position 1–100 (required), Monthly Volume (optional), Ranking URL (optional) — `POST` to create, `PATCH /{id}` to update (server stores old position as `previousPosition`).

**↻ Sync Search Console:** `POST /api/admin/marketing/seo-rankings/sync-search-console`. Uses `GOOGLE_SEARCH_CONSOLE_KEY_JSON` service account to pull the top 100 queries for the last 28 days from Google Search Console, upserting each into `seo_rankings` (sets `notes = "Last synced from Search Console (N clicks, M impressions)"`). Returns `{ synced, inserted, updated }`.
- Missing `GOOGLE_SEARCH_CONSOLE_SITE_URL` → `400` with explicit error message.
- Missing/invalid `GOOGLE_SEARCH_CONSOLE_KEY_JSON` → `500` (thrown inside `fetchTopQueries`, no named-secret message).

### 8.7 Tab: Tasks (`MarketingTasksKanban`)

A Kanban board for marketing activities, drag-and-drop or dropdown-driven. Backed by `marketing_tasks`, pre-filtered (distinct from the general Kanban module's `kanban_tasks`).

| Column | Status Value |
|---|---|
| Ideas | `ideas` |
| In Progress | `in_progress` |
| Scheduled | `scheduled` |
| Published | `published` |
| Completed | `completed` |

Implemented with `@dnd-kit/core` + `@dnd-kit/sortable`. Cross-column drop and same-column reorder both call `PATCH /api/admin/marketing/tasks/{id}` with `{ status: newStatus }` — **the `order` field is never sent**, so intra-column visual reordering is client-side only and not persisted.

**Status dropdown:** per-card ▾ dropdown, same PATCH call, no drag required.

**Add Task:** inline form (Title required, Description optional) → `POST /api/admin/marketing/tasks` with `status = "ideas"`.

**✦ AI Suggest Tasks:** `POST /api/admin/marketing/generate/task-suggestions` → 6 `{ title, description }` items in a checkbox modal (all pre-checked); **Add N Tasks** batch-creates the selected ones via individual `POST` calls.

**Delete:** `DELETE /api/admin/marketing/tasks/{id}`.

### 8.8 Tab: Campaigns (`CampaignBuilderWizard`)

A guided 5-step wizard to define, preview, save, and track campaigns.

| Step | Label | Content |
|---|---|---|
| 1 | Goal | Free-text campaign goal |
| 2 | Audience | Target audience description |
| 3 | Offer | Compelling offer description |
| 4 | Review | Preview of 4 AI-generated assets |
| 5 | Saved | Campaign saved — view & edit metrics |

**Campaign Name:** optional field spanning all steps; defaults to `"Campaign <today's date>"`.

**✦ AI Fill (steps 1–3):** `POST /api/admin/marketing/generate/campaign-suggest` with `{ field: "goal"|"audience"|"offer", name, goal, audience }` → `{ value }`.

**Step 3 → 4 (Preview Campaign):** `POST /api/admin/marketing/campaigns/preview-assets` with `{ name, goal, audience, offer }`. Claude (`claude-haiku-4-5`, max 3000 tokens) returns 4 keys mapped to `assetType`:

| Claude JSON Key | `assetType` |
|---|---|
| `landing_copy` | `landing_copy` |
| `email_sequence` | `email_sequence` |
| `social_posts` | `social_post` |
| `follow_up_tasks` | `follow_up_task` |

No DB write at this stage — assets are shown as expandable preview cards.

**Step 4 → 5 (Confirm & Save):** (1) `POST /api/admin/marketing/campaigns` creates the campaign (`status = "draft"`); (2) `POST /api/admin/marketing/campaigns/save-assets` bulk-inserts the 4 preview assets (Zod-validated), linked to the new campaign ID.

**Saved Campaigns list:** `GET /api/admin/marketing/campaigns` (includes `emailsSentAuto`, a join aggregate of `sent`-type `email_events`). Clicking selects a campaign and opens `CampaignMetricsPanel`.

**`CampaignMetricsPanel`:** tiles for Leads Generated, Emails Sent, Revenue. Emails Sent tile has 3 display modes depending on `emailsSentAuto` vs. manual `emailsSent` (auto-tracked / override / manual badges). Inline edit (3 number inputs) saves via `PATCH /api/admin/marketing/campaigns/{id}`.

**Statuses:** `draft` | `active` | `paused` | `completed`. **Types:** `email`, `sms`, `linkedin`, `twitter`, `facebook`, `mixed`.

**Create Another Campaign:** resets wizard state and returns to step 1.

### 8.9 AI Integration

**Model:** all AI routes in `admin-marketing.ts` use **`claude-haiku-4-5`**. Token budgets: 400 (suggest endpoints), 1000–1200 (outreach generation), 1800 (content generation), 2000 (lead generation), 3000 (campaign preview assets).

**ICP Context (`buildICPContext()`):** assembled before every AI request from four sources:
1. `settings` table keys: `icp_description`, `target_industries`, `ideal_company_size`, `value_proposition`, `differentiators`.
2. `services` table — up to 8 public services (name, description, target audience).
3. `leads` table — top 10 industry + company_size combinations by frequency.
4. `quiz_pain_signal_config` table — up to 8 category pain signal names.

If all four are empty, falls back to: "Microsoft 365 consulting, mid-market (50-2000 employees), IT decision-makers in healthcare, government, finance, or technology sectors".

**JSON parsing/validation:** `parseAiJson<T>(text, zodSchema)` strips markdown code fences, parses JSON, validates against a Zod schema. Throws `AiResponseError`; routes catch this and return `422` with `{ error: "AI returned an unreadable response — please try again" }` or `"AI returned unexpected format — please try again"`.

### 8.10 Email Delivery

Outreach emails send via **Microsoft Graph API** (Exchange Online), not SMTP. `sendMessage()` (`lib/graphEmail.ts`) is called with: `userId` (from `GRAPH_MAIL_USER_ID`), `to` (single-recipient array), `subject`/`body`, `bodyType` (`"text"` default or `"html"`), `saveToSentItems: true`.

Error cases: `GRAPH_MAIL_USER_ID` missing → `503`; Graph API rejects → `502`; Zod validation failure → `400` with the first error message.

On success: (1) inserts an `email_events` row (`eventType = "sent"`, `recipient`, `subject`, optional `campaignId`/`leadId`; `emailId = outreach-{timestamp}-{random}`); (2) if `leadId` present, appends a timestamped entry to the lead's `notes`.

### 8.11 Data Persistence

| Table | Purpose |
|---|---|
| `recommended_leads` | AI-generated prospects with status, confidence, ICP fields, `last_outreach_draft` |
| `outreach_templates` | Saved outreach message templates (all four types) |
| `marketing_tasks` | Kanban cards: `status`, `order`, `relatedLeadId`, `relatedCampaignId` |
| `campaigns` | Campaign records: goal, audience, offer, `emails_sent` (manual), `leads_generated`, `revenue_attributed` |
| `campaign_assets` | Content pieces linked to a campaign; `assetType`: `landing_copy`, `email_sequence`, `social_post`, `follow_up_task`, `blog_post`, `linkedin_post`, `newsletter`, `seo_keywords` |
| `seo_rankings` | `position`, `previousPosition`, `searchVolume`, `url`, `notes`, `checkedAt` |
| `email_events` | Every sent email: `eventType`, `recipient`, `subject`, `campaignId`, `leadId`, `occurredAt`, `metadata` |
| `analytics_sessions` | Website sessions: `startedAt`, `utm_source`, `referrer` |
| `analytics_site_events` | In-session events including `cta_click` (used for conversion-rate KPI) |
| `analytics_pageviews` | Per-page view records: `page`, `enteredAt`, linked to session |

### 8.12 API Reference

All routes require `Authorization: Bearer <CRM_ADMIN_PASSWORD>`. Errors return `{ error: string }`.

**KPI**

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/marketing/kpi` | `{ visitorsToday, leadsThisWeek, conversionRate, activeCampaigns }` |

**Recommended Leads**

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/marketing/recommended-leads` | List up to 40, ordered by `generatedAt` desc |
| POST | `/api/admin/marketing/recommended-leads` | Create manually |
| POST | `/api/admin/marketing/recommended-leads/generate` | AI-generate 7 leads; inserts and returns them |
| PATCH | `/api/admin/marketing/recommended-leads/{id}` | Update any field |
| PATCH | `/api/admin/marketing/recommended-leads/{id}/dismiss` | Sets `status = "dismissed"` |
| POST | `/api/admin/marketing/recommended-leads/{id}/convert` | Creates CRM lead, sets `status = "converted"` |
| DELETE | `/api/admin/marketing/recommended-leads/{id}` | Hard delete |

**Outreach Templates**

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/marketing/outreach-templates` | List all, `createdAt` desc |
| POST | `/api/admin/marketing/outreach-templates` | `{ name, templateType, subject?, body, leadId? }` |
| PATCH | `/api/admin/marketing/outreach-templates/{id}` | Update any field |
| DELETE | `/api/admin/marketing/outreach-templates/{id}` | Delete |

**Marketing Tasks**

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/marketing/tasks` | List all, `order` then `createdAt` desc |
| POST | `/api/admin/marketing/tasks` | `{ title, description?, status?, dueDate?, relatedLeadId?, relatedCampaignId? }` |
| PATCH | `/api/admin/marketing/tasks/{id}` | Update status, order, or any field |
| DELETE | `/api/admin/marketing/tasks/{id}` | Delete |

**Campaigns**

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/marketing/campaigns` | List with `emailsSentAuto` join count |
| POST | `/api/admin/marketing/campaigns` | `{ name, goal, audience, offer, status? }` (defaults `draft`) |
| PATCH | `/api/admin/marketing/campaigns/{id}` | Update any field incl. `leadsGenerated`, `emailsSent`, `revenueAttributed` |
| DELETE | `/api/admin/marketing/campaigns/{id}` | Delete |
| GET | `/api/admin/marketing/campaigns/{id}/assets` | List assets for a campaign |

**Campaign Assets**

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/marketing/campaign-assets` | Optional `?campaignId=N&assetType=X` |
| POST | `/api/admin/marketing/campaign-assets` | Create one asset |
| PATCH | `/api/admin/marketing/campaign-assets/{id}` | Update title, content, or assetType |
| DELETE | `/api/admin/marketing/campaign-assets/{id}` | Delete |
| POST | `/api/admin/marketing/campaigns/preview-assets` | AI-generate 4 preview assets (no DB write) |
| POST | `/api/admin/marketing/campaigns/save-assets` | `{ campaignId, assets: [{ assetType, title, content }] }` |

**Email & Outreach**

| Method | Path | Description |
|---|---|---|
| POST | `/api/admin/marketing/send-outreach` | `{ to, subject, body, leadId?, campaignId?, bodyType? }` |
| GET | `/api/admin/marketing/leads/{id}/emails` | Sent email history for a CRM lead |
| GET | `/api/admin/marketing/email-stats` | `{ totalSent, hasData, dailyTrend: [{ day, sent }] }` (30 days) |

**Analytics**

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/marketing/analytics` | `{ dailyVisitors, topPages, trafficSources, conversionFunnel, campaignPerformance }` |

**SEO Rankings**

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/marketing/seo-rankings` | List all, `position` asc |
| POST | `/api/admin/marketing/seo-rankings` | `{ keyword, position, url?, searchVolume?, notes? }` (Zod-validated) |
| PATCH | `/api/admin/marketing/seo-rankings/{id}` | Update; stores old position as `previousPosition` on change |
| DELETE | `/api/admin/marketing/seo-rankings/{id}` | Delete |
| POST | `/api/admin/marketing/seo-rankings/sync-search-console` | Pull from GSC, upsert top 100 queries (28-day window) |

**AI Generation**

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/api/admin/marketing/generate/outreach` | `{ leadId?, recommendedLeadId?, name?, company?, role?, industry?, painPoints?, templateType }` | Generate outreach copy |
| POST | `/api/admin/marketing/generate/outreach-suggest` | `{ templateType? }` | Suggest `{ name, company, role, industry }` |
| POST | `/api/admin/marketing/generate/content` | `{ contentType, topic, tone?, keywords? }` | Generate long-form content |
| POST | `/api/admin/marketing/generate/content-suggest` | `{ contentType? }` | Suggest `{ topic, tone, keywords }` |
| POST | `/api/admin/marketing/generate/task-suggestions` | (none) | Suggest 6 tasks `[{ title, description }]` |
| POST | `/api/admin/marketing/generate/campaign-suggest` | `{ field, name?, goal?, audience? }` | Suggest one campaign field; `{ value }` |

**Admin Lead Creation (Outreach Tab)**

| Method | Path | Description |
|---|---|---|
| POST | `/api/admin/leads` | Create CRM lead from AI-suggested prospect; `source = "ai_suggested"`, `status = "new"` |

### 8.13 Configuration & Secrets

| Secret / Env Var | Required By | Effect if Missing |
|---|---|---|
| `CRM_ADMIN_PASSWORD` | All MCC routes | All routes return 401 |
| Anthropic API key (via integration) | All AI features | AI generation fails at runtime |
| `GRAPH_MAIL_USER_ID` | Email delivery | Send Outreach returns 503 |
| `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_TENANT_ID` | Email delivery | Graph API auth fails |
| `GOOGLE_SEARCH_CONSOLE_KEY_JSON` | SEO Rankings sync | Sync returns 400/500; manual entry still works |
| `GOOGLE_SEARCH_CONSOLE_SITE_URL` | SEO Rankings sync | Sync returns 400; manual entry still works |

The Microsoft Graph secrets are shared with the calendar booking feature on the public website; the Google Search Console secrets are shared with the same-named integration described in `replit.md`.

---

## 9. Tenant Signals

**Path:** `/admin-panel/tenant-signals`
**Component:** `TenantSignals.tsx`
**Engine implementation:** `artifacts/api-server/src/lib/tenant-signals.ts`

Tenant Signals is a rule engine that maps M365 tenant profile data and audit-findings text to named **pain signals** (boolean-valued keys such as `hasGovernanceGaps`, `adj:tenant-size`). Each signal, when true, can drive downstream SOW phase adjustments, engagement-project triggers, and workflow automations. The page has two views toggled by the `pageView` state: `"rules"` and `"simulate"`.

### 9.1 Rule Evaluation Model

A signal fires when **any rule in any of its rule groups evaluates true**, or — for signals with a single ungrouped rule set — when any of its individual rules evaluate true (all current top-level, ungrouped signal keys use implicit OR across their rules). Grouped signals (the `signal_rule_groups` rows) additionally support an explicit `logic` field (`"AND"` or `"OR"`) per group; every group currently seeded in the live database uses `OR`.

**Rule types** (`rule_type` column on `signal_derivation_rules`):

| Rule Type | Semantics |
|---|---|
| `profile_key_truthy` | `profile[sourceKey]` is truthy |
| `profile_key_falsy` | `profile[sourceKey]` is falsy |
| `profile_key_eq` | `profile[sourceKey] == compareValue` (string-compared) |
| `profile_key_gt` | `Number(profile[sourceKey]) > Number(compareValue)` |
| `profile_key_lt` | `Number(profile[sourceKey]) < Number(compareValue)` |
| `findings_keyword` | The tenant's audit findings text contains `compareValue` as a substring (case-insensitive) |

### 9.2 Database Schema

**`signal_rule_groups`**

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | |
| `signal_key` | `text` not null | Canonical signal identifier this group belongs to |
| `logic` | `text` enum `AND`\|`OR`, default `OR` | Combination logic across the group's rules |
| `label` | `text` | Human-readable group label |
| `sort_order` | `integer` default 0 | |
| `created_at` | `timestamp` default now | |

**`signal_derivation_rules`**

| Column | Type | Notes |
|---|---|---|
| `id` | `serial` PK | |
| `signal_key` | `text` not null | Canonical signal identifier |
| `group_id` | `integer` FK → `signal_rule_groups.id`, `ON DELETE SET NULL` | Null for ungrouped (legacy) rules |
| `rule_type` | `text` not null | One of the rule types in [9.1](#91-rule-evaluation-model) |
| `source_key` | `text` not null | Profile field name (for `profile_key_*` types) or unused placeholder (for `findings_keyword`) |
| `compare_value` | `text` | Threshold / match string; null for `truthy`/`falsy` |
| `description` | `text` | Human-readable rationale |
| `sort_order` | `integer` default 0 | |
| `created_at` / `updated_at` | `timestamp` | |

Supporting tables: `signal_rule_audit_log` (before/after snapshots of every rule mutation, keyed by `admin_user_id`), `signal_rule_versions` (named full-ruleset snapshots for rollback), `signal_simulation_profiles` (saved hypothetical M365 profiles for the Simulate view, including `last_run_result` and `last_run_project_diff`).

### 9.3 Live Rule Groups (Production Database)

The following groups exist in `signal_rule_groups` as of this writing. All use `OR` logic — the signal fires if any one member rule is true.

| Group ID | Signal Key | Logic | Label |
|---|---|---|---|
| 1 | `adj:governance-complexity` | OR | Governance Complexity Conditions |
| 2 | `adj:tenant-size` | OR | Tenant Size Conditions |
| 3 | `adj:security-compliance` | OR | Security/Compliance Conditions |
| 4 | `adj:copilot-readiness` | OR | Copilot Readiness Conditions |
| 8 | `identity-modernization` | OR | Identity Modernization Conditions |
| 9 | `external-governance` | OR | External Sharing & Guest Governance Conditions |
| 10 | `teams-lifecycle` | OR | Teams Lifecycle & Sprawl Conditions |
| 11 | `exchange-hygiene` | OR | Exchange Online Hygiene Conditions |
| 12 | `data-classification` | OR | Data Classification & Labeling Conditions |

### 9.4 Live Derivation Rules (Production Database)

**Grouped rules** (belong to one of the groups in 9.3):

| Rule ID | Signal Key | Group ID | Rule Type | Source Key | Compare Value | Description |
|---|---|---|---|---|---|---|
| 61 | `adj:governance-complexity` | 1 | `profile_key_lt` | `governanceScore` | `60` | Governance score below 60 indicates material complexity. |
| 62 | `adj:governance-complexity` | 1 | `profile_key_truthy` | `hasGovernanceGaps` | — | Script explicitly flags governance gaps when critical controls are absent. |
| 63 | `adj:tenant-size` | 2 | `profile_key_gt` | `totalUserCount` | `250` | Tenants with more than 250 users have materially higher project overhead. |
| 64 | `adj:security-compliance` | 3 | `profile_key_falsy` | `mfaEnforced` | — | MFA not enforced is a critical gap that substantially increases security work. |
| 65 | `adj:security-compliance` | 3 | `profile_key_eq` | `conditionalAccessPolicyCount` | `0` | Zero Conditional Access policies means no identity perimeter controls. |
| 66 | `adj:security-compliance` | 3 | `profile_key_eq` | `dlpPoliciesCount` | `0` | Zero DLP policies means data loss prevention is absent. |
| 67 | `adj:copilot-readiness` | 4 | `profile_key_gt` | `copilotLicenseCount` | `0` | Any Copilot licenses present means readiness overhead is required. |
| 86 | `identity-modernization` | 8 | `profile_key_falsy` | `conditionalAccessEnabled` | — | Conditional Access is not enabled, leaving no identity perimeter controls. |
| 87 | `identity-modernization` | 8 | `profile_key_eq` | `mfaMethodCount` | `1` | Users rely on only one MFA method, reducing resilience and increasing phishing exposure. |
| 88 | `identity-modernization` | 8 | `findings_keyword` | (findings text) | `Legacy Authentication` | Legacy authentication protocols (POP/IMAP/Basic Auth) are still enabled or in use. |
| 89 | `identity-modernization` | 8 | `profile_key_falsy` | `hasBreakGlassAccount` | — | No dedicated emergency access account exists for tenant recovery. |
| 90 | `identity-modernization` | 8 | `profile_key_falsy` | `hasIdentityLifecycleAutomation` | — | Joiner/mover/leaver identity processes are manual or missing. |
| 91 | `identity-modernization` | 8 | `findings_keyword` | (findings text) | `Risky Sign-ins` | Authentication logs show risky sign-ins, insecure MFA patterns, or anomalous access. |
| 92 | `external-governance` | 9 | `profile_key_truthy` | `externalSharingEnabled` | — | External sharing is enabled across workloads without governance controls. |
| 93 | `external-governance` | 9 | `profile_key_gt` | `guestUserCount` | `0` | Guest accounts exist but lack lifecycle, ownership, or access review processes. |
| 94 | `external-governance` | 9 | `findings_keyword` | (findings text) | `Anonymous Link` | Anonymous or org-wide links exist and are ungoverned. |
| 95 | `external-governance` | 9 | `profile_key_falsy` | `guestLifecycleEnabled` | — | No expiration, access review, or ownership model for guest accounts. |
| 96 | `external-governance` | 9 | `findings_keyword` | (findings text) | `External Access Misconfiguration` | External collaboration settings are inconsistent or unsafe across workloads. |
| 97 | `teams-lifecycle` | 10 | `profile_key_gt` | `teamsCount` | `0` | High volume of Teams relative to user count or activity indicates unmanaged growth. |
| 98 | `teams-lifecycle` | 10 | `findings_keyword` | (findings text) | `Inactive Team` | Teams with no recent activity remain active and unmanaged. |
| 99 | `teams-lifecycle` | 10 | `findings_keyword` | (findings text) | `Ownerless Team` | Teams lack active owners, creating governance and compliance risk. |
| 100 | `teams-lifecycle` | 10 | `profile_key_falsy` | `teamsNamingConventionEnabled` | — | Teams are created without consistent naming or provisioning standards. |
| 101 | `teams-lifecycle` | 10 | `profile_key_falsy` | `teamsLifecycleAutomationEnabled` | — | No expiration, archival, or automated lifecycle rules exist. |
| 102 | `exchange-hygiene` | 11 | `findings_keyword` | (findings text) | `Legacy Transport Rule` | Old or redundant transport rules remain active and unmanaged. |
| 103 | `exchange-hygiene` | 11 | `findings_keyword` | (findings text) | `Unsafe Mail Flow` | Mail routing or connectors are configured in insecure or non-standard ways. |
| 104 | `exchange-hygiene` | 11 | `profile_key_falsy` | `antiPhishConfigured` | — | Anti-phish or anti-spam policies are missing or improperly configured. |
| 105 | `exchange-hygiene` | 11 | `findings_keyword` | (findings text) | `Shared Mailbox Misconfiguration` | Shared mailboxes have incorrect licensing, permissions, or configuration. |
| 106 | `exchange-hygiene` | 11 | `findings_keyword` | (findings text) | `Non-Standard Routing` | Mail routing deviates from Microsoft best practices or introduces risk. |
| 107 | `data-classification` | 12 | `profile_key_falsy` | `dataClassificationModelExists` | — | No formal data classification model exists for the organization. |
| 108 | `data-classification` | 12 | `profile_key_eq` | `sensitivityLabelsCount` | `0` | Sensitivity labels are absent or not aligned to business data categories. |
| 109 | `data-classification` | 12 | `profile_key_falsy` | `autoLabelingEnabled` | — | Auto-labeling rules are not configured for high-value or high-risk data. |
| 110 | `data-classification` | 12 | `profile_key_lt` | `labelCoveragePercent` | `50` | Labels exist but are not applied broadly across workloads. |
| 111 | `data-classification` | 12 | `profile_key_falsy` | `classificationGovernanceEnabled` | — | No governance model exists for maintaining classification and labeling. |

**Ungrouped (legacy) rules** — `group_id` is null; these predate the group-based model and remain in `OR` combination per `signal_key`:

| Rule ID | Signal Key | Rule Type | Source Key | Compare Value |
|---|---|---|---|---|
| 35 | `hasExchangeOnPrem` | `findings_keyword` | (findings text) | `Exchange On-Premises` |
| 36 | `hasExchangeOnPrem` | `findings_keyword` | (findings text) | `hybrid connector` |
| 37 | `hasExchangeOnPrem` | `findings_keyword` | (findings text) | `mailbox migration` |
| 38 | `hasExchangeOnPrem` | `profile_key_truthy` | `hasOnPremExchange` | — |
| 39 | `hasPowerPlatformUsage` | `findings_keyword` | (findings text) | `Power Automate` |
| 40 | `hasPowerPlatformUsage` | `findings_keyword` | (findings text) | `Power Apps` |
| 41 | `hasPowerPlatformUsage` | `profile_key_truthy` | `hasPowerPlatformUsage` | — |
| 42 | `hasGovernanceGaps` | `profile_key_eq` | `sensitivityLabelsCount` | `0` |
| 43 | `hasGovernanceGaps` | `profile_key_eq` | `retentionLabelsCount` | `0` |
| 44 | `hasGovernanceGaps` | `profile_key_eq` | `dlpPoliciesCount` | `0` |
| 45 | `hasGovernanceGaps` | `profile_key_eq` | `trainableClassifiersCount` | `0` |
| 46 | `hasGovernanceGaps` | `profile_key_falsy` | `conditionalAccessEnabled` | — |
| 47 | `hasGovernanceGaps` | `profile_key_eq` | `conditionalAccessPoliciesCount` | `0` |
| 48 | `hasGovernanceGaps` | `profile_key_falsy` | `sharePointAccessible` | — |
| 49 | `hasSecurityGaps` | `profile_key_falsy` | `mfaEnforced` | — |
| 50 | `hasSecurityGaps` | `profile_key_eq` | `conditionalAccessPoliciesCount` | `0` |
| 51 | `hasSecurityGaps` | `profile_key_lt` | `securityScore` | `60` |
| 52 | `hasCopilotLicenses` | `profile_key_gt` | `copilotLicenseCount` | `0` |
| 53 | `hasSharePointIssues` | `profile_key_gt` | `sharepointSiteCount` | `0` |
| 54 | `hasSharePointIssues` | `findings_keyword` | (findings text) | `SharePoint` |
| 55 | `hasLicensingWaste` | `findings_keyword` | (findings text) | `unlicensed` |
| 57 | `hasDLPGaps` | `profile_key_eq` | `dlpPoliciesCount` | `0` |
| 58 | `hasDLPGaps` | `profile_key_falsy` | `sensitivityLabelsConfigured` | — |
| 59 | `alwaysInclude` | `profile_key_truthy` | `alwaysInclude` | — (virtual signal, always true) |
| 60 | `hasLicensingWaste` | `profile_key_lt` | `activeUserPercent` | `70` |

> **Note on IDs:** rule IDs 35–60 are the original seed set (`scripts/src/seed-signal-rules.ts`, insert-only via `ON CONFLICT DO NOTHING` — editing the seeder does not change a live row; use the admin UI or a direct SQL update). Rule IDs 61–111 (and groups 1–4, 8–12) were added directly to the live database after the initial seed and are **not** all present in the seed script — this table reflects the authoritative live state, not the seed defaults.

### 9.5 Rules View (UI)

Lists all signal derivation rules (grouped and ungrouped), grouped visually by `signal_key`. Each row/group shows:

| Field | Description |
|---|---|
| Signal Key | Canonical identifier, e.g. `hasGovernanceGaps`, `adj:tenant-size` |
| Group Logic | `AND` \| `OR` (grouped rules only) |
| Rule Type | One of the six types in [9.1](#91-rule-evaluation-model) |
| Source Key / Compare Value | The profile field and threshold/match value |
| Description | Human-readable explanation |

**CRUD:** Create, edit, delete rules and groups inline. Every mutation writes a before/after snapshot to `signal_rule_audit_log`. Signal keys referenced in `engagement_projects.triggered_by` are canonical — renaming a signal key here requires a migration to backfill existing rows (see `replit.md` Gotchas, `0012_engagement_project_signal_keys`).

### 9.6 Simulate View

Tests a hypothetical M365 profile snapshot (and/or findings text) against all active rules. Inputs are stored as reusable `signal_simulation_profiles` rows (`profileUpdates`, `parsedFindings`, `tags`). Output: a ranked list of matched signals, with the evaluated rules and a brief explanation of why each fired; the result and any downstream project diff are persisted back onto the profile as `lastRunResult` / `lastRunProjectDiff`.

---

## 10. Workflow Builder

**Path prefix:** `/admin-panel/workflows`

### 10.1 Workflow List (`/workflows/list`)

Lists all workflow definitions with:
- Name, description, category tag.
- Published version label and version number.
- Trigger summary (type icons, event names).
- Last run status and timestamp.
- **System** badge for seeded workflows (no delete button).
- **Trigger activity** — runs-today badge sourced from `GET /api/admin/workflows/trigger-activity-summary`.
- Actions: Run Now, Duplicate, Edit Triggers, Open Builder, Delete, Publish to Prod.

Workflows can be grouped by the `metadata.category` field (editable via `PUT /api/admin/workflows/definitions/:id`).

### 10.2 Run History (`/workflows/runs`)

Table of all workflow run records. Filterable by definition, status (`pending` | `running` | `completed` | `failed` | `cancelled` | `awaiting_approval`), date range, trigger type, and `triggerRef` event name. Supports comma-separated `triggerRefs` for category-level filtering.

Columns: Run ID, Workflow name, Trigger type, Status, Started, Duration.

Clicking a run opens the **Run Detail** page.

### 10.3 Run Detail (`/workflows/runs/:id`)

Shows the full node execution log for a completed or in-progress run:
- Per-node status chips: `ok` (green), `error` (red), `skipped` (grey).
- Node input/output payloads (expandable JSON).
- Log messages per node.
- For-each / parallel iteration indexed records (`node-104[0]`, `node-104[1]`, …) show per-iteration detail.
- **Active node** indicator: while status is `running`, the viewer highlights the most recently started node that has not yet written an output record. Sourced from `activeNodeId` in `GET /api/admin/workflows/runs/:id`.
- Real-time streaming via SSE for in-progress runs.

### 10.4 Workflow Builder Canvas (`/workflows/builder/:id`)

The drag-and-drop visual canvas for designing workflow graphs.

**Canvas mechanics:**
- Workflows are stored as `{ nodes: WfNode[], edges: WfEdge[] }` in `wf_versions.graph` (JSONB).
- Nodes carry `{ id, type, position: { x, y }, data }`. Edges carry `{ id, source, target, sourceHandle? }`.
- Canvas uses React Flow for rendering. Node types map to visual components in the node palette.
- Nodes are configured via a right-side **Config Panel** that adapts to the selected node type.
- The start node's output payload is spread from the run's trigger payload (not a hardcoded `{started:true}` stub), so `{{steps.<startNodeId>.*}}` references and the run viewer both reflect real trigger data from the very first node.

**Versioning:**
- Each definition can have multiple versions stored in `wf_versions`.
- Only one version may be in `"published"` status at a time, enforced at the database level by a partial unique index (`wf_versions_one_published_per_def`, `WHERE status = 'published'`) — not just application logic.
- Editing a published version auto-creates a new `"draft"` version (original untouched).
- `is_default = true` marks the system-seeded v1; exposes a **Revert to Default** action.
- Archive-old + publish-new runs atomically in a single DB transaction, and published-version lookups always order by `versionNumber DESC` to avoid resolving a stale published row.

**AI generation:** The **AI Generate** button (`POST /api/admin/workflows/ai-generate`) accepts a natural-language description and calls Claude Haiku to produce a valid graph. The **AI Refine** button (`POST /api/admin/workflows/ai-refine`) accepts a refinement instruction and the current graph, returning the full updated graph. Both endpoints validate uniqueness, referential integrity, and node counts before returning.

**AI expression helper:** The Config Panel for `condition` and `switch_case` nodes has an inline "Write with AI" button (`POST /api/admin/workflows/expression-helper`) that converts a natural-language description into a workflow expression string, using the upstream variables currently available to the node.

**AI narrative:** The **Explain** button in the builder toolbar (`POST /api/admin/workflows/definitions/:id/explain`) sends the current canvas graph (including unsaved edits) to Claude Haiku and returns a 3–7 sentence plain-English narrative of what the workflow does.

**Draft test-run:** The **Test Run** button (`POST /api/admin/workflows/definitions/:id/test-run`) executes the live canvas graph without requiring a publish step. Uses `dryRun: true` by default. The submitted `nodes`/`edges` are passed as an `inlineGraph` override to the executor; no new version record is created.

**Publish to production:** The **Push to Prod** button (`POST /api/admin/workflows/definitions/:id/publish-to-prod`) upserts the definition, published version, and triggers into the production database (requires `DATABASE_URL_PROD` secret). Returns `503` if the secret is absent.

### 10.5 Variable Interpolation

All node text fields support `{{variable}}` syntax at runtime:

| Syntax | Resolves To |
|---|---|
| `{{fieldName}}` | Shorthand for `payload.fieldName` |
| `{{payload.fieldName}}` | Direct access to trigger payload |
| `{{steps.nodeId.outputField}}` | Output from a previously-executed node |
| `{{steps.ask.aiResponse}}` | Nested example |
| Arrays/objects | Emitted as compact JSON strings |

`interp()` always stringifies arrays/objects. Use `resolveExprNative()` (instead of `interp()`) when a field must preserve native type — e.g. a `run_workflow` `inputMapping` value that should pass an integer or object, not a string.

### 10.6 Condition Expression Syntax

Conditions are evaluated without `eval`. The expression parser supports:

```
path op literal       →  status == 'paid'
boolean path          →  isQualified
logical operators     →  score >= 80 && status != 'closed_lost'
contains operator     →  message contains 'urgent'
template reference    →  {{stripeInvoiceId}} && paymentPlan == 'phased'
```

Operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`. Logical: `&&`, `||`.

### 10.7 BFS Execution Model

The workflow executor (`workflow-executor.ts`) uses **breadth-first traversal** with a convergence-safe algorithm: nodes are only executed once all of their required incoming edges have resolved, so diamond-shaped graphs (branch then re-converge) execute the converging node exactly once rather than once per incoming branch.

**Run Workflow node (child isolation):** the `run_workflow` node's child run does **not** inherit the parent's full payload — the child payload starts clean, receiving only the explicit `inputMapping` keys plus internal bookkeeping fields `_parentRunId` and `_depth` (used for `maxRunDepth` enforcement).

**Dry Run mode:** All DB-writing nodes are stubbed with realistic synthetic outputs. Structural nodes (`start`, `end`, `condition`, `switch_case`, etc.) still execute normally so condition branches can be traced. The `delay` node always skips in dry-run mode.

**Empty child graphs:** A draft sub-workflow with no real action nodes (only `start`→`end`) "completes" instantly and reports success — callers wired into such a stub via `run_workflow` or the kanban auto-fire path will appear to succeed even though no real work occurred. Verify a child workflow has action nodes before relying on its completion status.

**Concurrency & depth limits:** Each definition has `concurrencyLimit` (1–50, default 5) and `maxRunDepth` (1–10, default 5) to prevent runaway recursion from `emit_event` → self-trigger loops.

### 10.8 Trigger Configuration (`/workflows/triggers/:id`)

Allows adding, editing, enabling/disabling, and deleting triggers for a definition without opening the full builder. Shows trigger type, config (CRON, event name, webhook token), enabled state, and last-fired timestamp.

**Webhook token rotation:** `POST /api/admin/workflows/definitions/:id/triggers/:tid/rotate-token` generates a new 32-byte hex token and invalidates the old one.

**Trigger activity stats:** `GET /api/admin/workflows/definitions/:id/triggers/:tid/stats` returns 30-day daily buckets of fire counts, error counts, and average duration.

**Pending Approvals:** `GET /api/admin/workflows/pending-approvals` lists all runs paused at an `approval_gate` node. Approving resumes the run; rejecting marks it `failed`.

### 10.9 Execution Trend Analytics

`GET /api/admin/workflows/definitions/:id/trends?days=30` returns:
- `daily[]` — per-day counts of total / success / failure runs and average duration.
- `durations[]` — per-day p50 and p95 node execution latencies.
- `topFailingNodes[]` — the three node IDs with the highest error count.

---

## 11. Workflow Node Reference

The full catalogue of node types available in the Workflow Builder canvas — including exact `data` field shapes, output fields, and per-node behavior — is documented in a **dedicated reference file**: [`workflow-node-reference.md`](./workflow-node-reference.md). That file is the single source of truth for node-level detail; definitions are **not duplicated here** to avoid drift between the two documents.

### 11.1 Category Summary

The node reference is organized into the following categories:

| Category | Purpose |
|---|---|
| Structural / Control Flow | `start`, `end`, `condition`, `switch_case`, `for_each`, `parallel`, `delay`, `approval_gate` — graph shape and branching |
| AI & Content | `ask_ai`, `generate_article`, `generate_document`, `compose` — Claude-backed generation and JSON extraction |
| CRM / Diagnostics / M365 Actions | Lead/opportunity mutation, M365 profile refresh, intelligence table updates |
| Communication | Email (Graph API), SMS (Twilio), push notifications, in-app notifications |
| M365 & Azure | `update_m365_profile`, `save_to_sharepoint`, Azure Automation runbook execution |
| Finance (Stripe) | Invoice creation/editing/charging, coupon creation, phased-payment orchestration |
| Social Media | `post_linkedin`, `post_twitter`, `post_facebook` |
| Data & Variables | `sql_query`, `find_object`, variable set/transform nodes |
| Internal / System | `system_action`, `emit_event`, `reconcile_orphaned_runs`, `cleanup_old_runs` |
| Promoted Action Types | Aliases of the generic `action` node exposed as first-class palette entries for discoverability (e.g. specific Stripe or CRM actions) |

### 11.2 How to Use the Node Reference

When building or auditing a workflow graph:
1. Identify the node's `type` string from the graph JSON (`wf_versions.graph.nodes[].type`).
2. Look up that exact `type` in `workflow-node-reference.md` for its required/optional `data` fields and the output fields it writes to `wf_run_node_outputs.output` (addressable at runtime as `{{steps.<nodeId>.<outputField>}}`).
3. Cross-reference [Section 10.5](#105-variable-interpolation) for how upstream node outputs are interpolated into downstream node fields, and [Section 10.6](#106-condition-expression-syntax) for condition/switch expression syntax.
4. For any node with an "on error" branch (e.g. the `generate_document` retry pattern in [16.13](#1613-sow-generation)), consult the node reference for exactly which output field signals failure — do not assume all nodes throw on failure; several (e.g. `charge_stripe_invoice`) return a status field instead so downstream conditions can branch explicitly.

---

## 12. Workflow API Reference

All admin endpoints require `Authorization: Bearer <accessToken>` and the `admin` role (the JWT scheme from [Section 1](#1-overview--authentication) — distinct from the Marketing Command Center's password-bearer scheme). The public webhook endpoint has no auth but validates a per-trigger token. Route file: `artifacts/api-server/src/routes/admin-workflows.ts`.

### 12.1 Definitions

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/workflows/definitions` | List all definitions. Returns latest published version label and last run summary per definition. |
| `POST` | `/api/admin/workflows/definitions` | Create a new definition. Body: `{ name, description?, concurrencyLimit?, maxRunDepth?, metadata? }`. |
| `GET` | `/api/admin/workflows/definitions/:id` | Get a single definition with its versions. |
| `PUT` | `/api/admin/workflows/definitions/:id` | Update definition metadata. Body: `{ name?, description?, concurrencyLimit?, maxRunDepth?, metadata? }`. |
| `DELETE` | `/api/admin/workflows/definitions/:id` | Delete definition, all versions, triggers, and runs. Blocked if `metadata.system = true`. |

### 12.2 Versions

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/workflows/definitions/:id/versions` | List all versions for a definition. |
| `POST` | `/api/admin/workflows/definitions/:id/versions` | Create a new draft version. Body: `{ graph: { nodes, edges }, label? }`. |
| `GET` | `/api/admin/workflows/definitions/:id/versions/:vid` | Get a specific version including its graph. |
| `PUT` | `/api/admin/workflows/definitions/:id/versions/:vid` | Update a draft version's graph or label. If the version is published, auto-creates a new draft version and updates that instead. |
| `POST` | `/api/admin/workflows/definitions/:id/versions/:vid/publish` | Publish a version. Archives the current published version atomically in a DB transaction. |
| `POST` | `/api/admin/workflows/definitions/:id/revert-to-default` | Re-publishes the pinned v1 default version (system workflows only). |

### 12.3 Triggers

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

### 12.4 Manual Trigger & Test Runs

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/workflows/definitions/:id/run` | Fire the published version manually. Body: `{ payload?, versionId?, inputValues? }`. Returns `202 { runId }`. |
| `POST` | `/api/admin/workflows/definitions/:id/test-run` | Execute the live canvas graph (without publishing). Body: `{ nodes, edges, triggerPayload?, inputValues?, dryRun? }`. Defaults to `dryRun: true`. Returns `202 { runId }`. |

### 12.5 Runs

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/workflows/runs` | List runs. Query params: `definitionId`, `status`, `from`, `to`, `triggerType`, `triggerRef`, `triggerRefs` (comma-separated), `limit` (max 200), `offset`. |
| `GET` | `/api/admin/workflows/runs/:id` | Get full run detail: `graph`, `logs`, `nodeOutputs`, `nodeResultMap`, `activeNodeId`, `durationMs`. |
| `POST` | `/api/admin/workflows/runs/:id/cancel` | Cancel a `pending` or `running` run. Returns `409` if not in a cancellable state. |
| `POST` | `/api/admin/workflows/runs/:id/rerun` | Re-run a `failed`, `cancelled`, or `completed` run using the same payload and version. Sets `retriggeredFromRunId` on the new run. |

### 12.6 Pending Approvals

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/workflows/pending-approvals` | List all runs paused at an `approval_gate` node. |
| `POST` | `/api/admin/workflows/pending-approvals/:id/decide` | Approve or reject. Body: `{ decision: "approved"\|"rejected", note? }`. Approved → resumes run via `resumeWorkflowRun`. Rejected → marks run `failed`. |

### 12.7 Webhook (Public)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/webhooks/workflow/:token` | Fire a webhook-triggered workflow. Token must match an enabled trigger. Body becomes the run payload. Returns `202 { runId }`. No auth header required. |

### 12.8 AI Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/workflows/ai-generate` | Generate a new graph from a natural-language description. Body: `{ description, triggerContext? }`. Uses Claude Haiku. Returns `{ nodes, edges, unsupportedFeatures?, replitPrompt? }`. |
| `POST` | `/api/admin/workflows/ai-refine` | Refine an existing graph. Body: `{ instruction, graph: { nodes, edges } }`. Returns `{ nodes, edges }`. |
| `POST` | `/api/admin/workflows/expression-helper` | Generate a condition/value expression from plain English. Body: `{ userPrompt, availableVariables[], expressionType: "boolean"\|"value" }`. Returns `{ expression, explanation }`. |
| `POST` | `/api/admin/workflows/synthesise-sound` | Generate Web Audio API synthesis parameters from a description. Body: `{ description }`. Returns `{ params }` (waveform, notes, envelope). Browser synthesises audio client-side. |
| `POST` | `/api/admin/workflows/definitions/:id/explain` | AI narrative of the workflow (accepts unsaved canvas graph in body). Returns `{ narrative }`. |

### 12.9 Analytics

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/workflows/definitions/:id/trends` | Execution trend data. Query: `days` (1–90, default 30). Returns `{ daily[], durations[], topFailingNodes[] }`. |

### 12.10 SSE Stream

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/workflows/sound-events` | SSE stream for real-time `play_sound` events (browser target). Admin panel tabs subscribe on mount. Requires `fetchWithAuth` (not a raw `fetch`/`EventSource`) since the token can expire mid-stream on long-lived connections. |

### 12.11 Production Sync

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/workflows/definitions/:id/publish-to-prod` | Upserts definition, published version, and triggers into the production DB. Requires `DATABASE_URL_PROD` secret. Returns `503` if not configured. |

---

## 13. Workflow Database Schema

All workflow tables live in the primary application database (`lib/db/src/schema/index.ts`) and are managed via Drizzle ORM migrations. This section documents every table backing the workflow engine.

### 13.1 `wf_definitions`

One row per workflow (a named, reusable automation).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | PK | |
| `name` | `text` | not null | |
| `description` | `text` | | |
| `concurrency_limit` | `integer` | not null, default `5` | 1–50 in practice, enforced by the executor |
| `max_run_depth` | `integer` | not null, default `5` | 1–10 in practice; caps `run_workflow` recursion |
| `metadata` | `jsonb` | not null, default `{}` | `{ system?: boolean, category?: string, ... }` |
| `created_at` | `timestamp` | not null, default now | |
| `updated_at` | `timestamp` | not null, default now | |

### 13.2 `wf_versions`

Every saved graph revision for a definition. Exactly one row per `definition_id` may have `status = 'published'`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | PK | |
| `definition_id` | `integer` | not null, FK → `wf_definitions.id` ON DELETE CASCADE | |
| `version_number` | `integer` | not null, default `1` | |
| `label` | `text` | | |
| `status` | `text` | enum `draft`\|`published`\|`archived`, not null, default `draft` | |
| `graph` | `jsonb` | not null, default `{ nodes: [], edges: [] }` | `WfGraph = { nodes: WfNode[], edges: WfEdge[] }` |
| `is_default` | `boolean` | not null, default `false` | Marks the pinned system-seeded v1 |
| `created_at` / `updated_at` | `timestamp` | not null, default now | |

**Constraint:** `wf_versions_one_published_per_def` — a partial unique index on `(definition_id)` `WHERE status = 'published'`. Postgres itself rejects any insert/update that would create a second published row for the same definition, independent of application-level guards.

### 13.3 `wf_runs`

One row per workflow execution.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | PK | |
| `version_id` | `integer` | not null, FK → `wf_versions.id` ON DELETE CASCADE | The exact graph revision executed |
| `definition_id` | `integer` | not null, FK → `wf_definitions.id` ON DELETE CASCADE | Denormalized for fast filtering |
| `trigger_type` | `text` | enum `manual`\|`schedule`\|`webhook`\|`event`, not null, default `manual` | |
| `trigger_ref` | `text` | | Event name / trigger identifier that fired this run |
| `status` | `text` | enum `pending`\|`running`\|`completed`\|`failed`\|`cancelled`\|`awaiting_approval`, not null, default `pending` | |
| `payload` | `jsonb` | not null, default `{}` | Trigger payload; root of `{{payload.*}}` interpolation |
| `branch_path` | `jsonb` (`string[]`) | not null, default `[]` | Records which condition/switch branches were taken |
| `started_at` / `finished_at` | `timestamp` | nullable | |
| `error_message` | `text` | | |
| `retriggered_from_run_id` | `integer` | FK → `wf_runs.id` ON DELETE SET NULL (self-reference) | Set when created via the "Rerun" action |
| `created_at` | `timestamp` | not null, default now | |

### 13.4 `wf_run_node_outputs`

One row per node execution within a run — the primary record consumed by `{{steps.nodeId.field}}` interpolation and the Run Detail viewer.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | PK | |
| `run_id` | `integer` | not null, FK → `wf_runs.id` ON DELETE CASCADE | |
| `node_id` | `text` | not null | Matches the node's `id` in the graph; indexed iterations use `nodeId[i]` notation in the UI, not the raw column |
| `input` | `jsonb` | not null, default `{}` | Resolved input payload for the node |
| `output` | `jsonb` | not null, default `{}` | Node's output fields, addressable via `{{steps.<nodeId>.<field>}}` |
| `duration_ms` | `integer` | | |
| `status` | `text` | enum `ok`\|`error`\|`skipped`, not null, default `ok` | |
| `error_message` | `text` | | |
| `timestamp` | `timestamp` | not null, default now | |

### 13.5 `wf_run_node_logs`

Free-form log lines emitted by nodes during execution (separate from the structured input/output record).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | PK | |
| `run_id` | `integer` | not null, FK → `wf_runs.id` ON DELETE CASCADE | |
| `node_id` | `text` | not null | |
| `level` | `text` | enum `info`\|`warn`\|`error`\|`progress`, not null, default `info` | `progress` powers SSE progress-percentage UI (e.g. phase generation) |
| `message` | `text` | not null | |
| `metadata` | `jsonb` | nullable | |
| `timestamp` | `timestamp` | not null, default now | |

### 13.6 `wf_triggers`

Configured triggers for a definition. A definition can have any number of triggers of any type.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | PK | |
| `definition_id` | `integer` | not null, FK → `wf_definitions.id` ON DELETE CASCADE | |
| `type` | `text` | enum `manual`\|`schedule`\|`webhook`\|`event`\|`startup`, not null | |
| `config` | `jsonb` | not null, default `{}` | Shape depends on `type` — see [Section 14](#14-workflow-triggers-reference) |
| `webhook_token` | `text` | unique | Only populated for `type = 'webhook'` |
| `next_run_at` | `timestamp` | nullable | Only populated/maintained for `type = 'schedule'`, via `computeNextCronRun(cron)` |
| `enabled` | `boolean` | not null, default `true` | |
| `created_at` | `timestamp` | not null, default now | |

### 13.7 `wf_trigger_events`

Observability log — one row per trigger fire attempt (fired, skipped, or errored), independent of whether a run was created.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | PK | |
| `trigger_id` | `integer` | not null, FK → `wf_triggers.id` ON DELETE CASCADE | |
| `run_id` | `integer` | FK → `wf_runs.id` ON DELETE SET NULL | Null if concurrency-skipped or errored before run creation |
| `fired_at` | `timestamp` | not null, default now | |
| `status` | `text` | enum `fired`\|`skipped`\|`error`, not null, default `fired` | |
| `duration_ms` | `integer` | | Time from trigger receipt to run creation |
| `payload` | `jsonb` | nullable | Request body (webhook) or event payload |
| `error_message` | `text` | | |

### 13.8 `pending_approvals`

One row per run paused at an `approval_gate` node, awaiting a human decision.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `serial` | PK | |
| `run_id` | `integer` | not null, FK → `wf_runs.id` ON DELETE CASCADE | |
| `node_id` | `text` | not null | The `approval_gate` node where execution is paused |
| `approver_role` | `text` | not null, default `admin` | |
| `timeout_seconds` | `integer` | not null, default `3600` | |
| `status` | `text` | enum `pending`\|`approved`\|`rejected`\|`timed_out`, not null, default `pending` | |
| `decided_by` | `text` | | |
| `decision_note` | `text` | | |
| `context` | `jsonb` | not null, default `{}` | Snapshot of relevant run/payload data shown in the approval UI |
| `created_at` | `timestamp` | not null, default now | |
| `decided_at` | `timestamp` | nullable | |
| `expires_at` | `timestamp` | nullable | |

### 13.9 Entity Relationship Summary

```
wf_definitions 1──* wf_versions 1──* wf_runs 1──* wf_run_node_outputs
      │                                   │  1──* wf_run_node_logs
      │                                   │  1──* pending_approvals
      └──* wf_triggers 1──* wf_trigger_events *──1 wf_runs (nullable)
```

- Deleting a `wf_definitions` row cascades through all its versions, triggers, and runs (and transitively through node outputs/logs and pending approvals).
- `wf_runs.retriggered_from_run_id` self-references `wf_runs.id`, forming a re-run lineage chain.
- `wf_trigger_events.run_id` can be null (a skipped or pre-run-creation error), so it must be treated as optional when joining.

---

## 14. Workflow Triggers Reference

### 14.1 Trigger Types

| Type | Config | Description |
|---|---|---|
| `manual` | — | "Run Now" button in the UI. Supports `ask_for_input` fields collected in a modal before the run starts. |
| `schedule` | `cron` (5-field CRON string) | Fires at the next computed UTC time. `computeNextCronRun(cron)` calculates the next run and writes it to `wf_triggers.next_run_at`. |
| `event` | `eventName` string | Subscribes to the internal event bus. Fires whenever `broadcastAdminWorkflowEvent(name, payload)` is called with a matching name. |
| `webhook` | Auto-generated token | `POST /api/webhooks/workflow/:token`. Token is 24 random bytes hex. Rotate via the UI. |
| `startup` | — | Fires once per server boot. Used for orphan recovery and one-time init tasks. |

### 14.2 Schedule Fan-out

A schedule trigger with `perRecord: true` creates a separate run for each matching record (e.g., one run per active client). Without the flag, a single run fires with aggregate data.

### 14.3 Trigger Event Observability

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

### 14.4 Built-in Schedules

| Workflow | CRON | UTC Time | Purpose |
|---|---|---|---|
| Weekly Article Generator | `0 9 * * 1` | Monday 09:00 | Generates and saves a draft M365 article |
| `__system__: Workflow Cleanup` | `0 3 * * *` | Daily 03:00 | Deletes workflow runs older than 90 days |
| `__system__: Escalation Check` | `0 8 * * *` | Daily 08:00 | Flags script cards stalled in "Waiting on Customer" |
| `__system__: Monthly Insights` | `0 9 1 * *` | 1st of month 09:00 | Runs all enabled insights automations |

---

## 15. Workflow Events Catalog

Events are emitted by server-side handlers and workflow nodes. Any enabled workflow with a matching event trigger will fire. Payload fields marked `?` are optional.

### 15.1 Presentation & SOW Events

| Event | Emitted By | Key Payload Fields | Common Use |
|---|---|---|---|
| `presentation.phases_requested` | Client advances past SOW step | `projectTitle`, `totalPrice`, `selectedPhases`, `sowHtml`, `presentationId`, `clientName` | Fire Presentation Phase Generator |
| `sow.generate` | Server when presentation enters `pending_sow` | `clientUserId`, `projectId`, `title`, `presentationId` | Trigger SOW Generation |
| `sow.generation_stalled` | Portal client after 2 min on `pending_sow` with no document | `projectId`, `presentationId`, `customerId` | Trigger SOW Generation Auto-Retry |
| `sow.generation_retried` | SOW Auto-Retry on successful retry | `presentationId` | Audit trail; chain to notifications |
| `sow.scope_reduced` | Server when client deselects phases | `presentationId`, `projectId`, `clientUserId`, `previousTotal`, `newTotal` | Re-engagement automations (disabled by default) |
| `document.generated` | Server after document saved | `documentId`, `docType`, `category`, `clientId`, `projectId?` | Notify admin; chain to PDF/SharePoint |

### 15.2 Agreement & Payment Events

| Event | Emitted By | Key Payload Fields | Common Use |
|---|---|---|---|
| `agreement_signed` | Server on contract signature | `presentationId`, `projectId`, `clientEmail`, `clientName`, `paymentPlan`, `stripeSessionId`, `contractId` | Create phased invoices; send welcome email |
| `contract.signed` | Alias for `agreement_signed` | Same as above | Interchangeable |
| `payment.received` | Stripe webhook handler | `sessionId`, `customerId`, `amountTotal`, `serviceType`, `clientEmail` | SMS alert, create client account |
| `onboarding.complete` | Portal onboarding wizard submitted | `clientId`, `projectId?` | Trigger project provisioning |

### 15.3 Phase & Project Events

| Event | Emitted By | Key Payload Fields | Common Use |
|---|---|---|---|
| `phase_completed` | Admin marks phase complete | `projectId`, `phaseId`, `clientName`, `stripeInvoiceId?`, `paymentPlan` | Auto-charge phased invoice |
| `phase.delivery_date_changed` | Admin updates phase delivery date | `projectId`, `phaseId`, `newDueDate`, `paymentPlan`, `stripeInvoiceId?` | Sync Stripe invoice due date |
| `milestone.delivery_date_changed` | Admin updates milestone date | `projectId`, `milestoneId`, `newDueDate` | Calendar event update; notification |

### 15.4 Kanban Events

| Event | Emitted By | Key Payload Fields | Common Use |
|---|---|---|---|
| `kanban.card_moved` | Kanban card drag-and-drop | `cardId`, `boardId`, `fromColumn`, `toColumn`, `clientId?` | Fire `__system__: Kanban Auto-fire` |

### 15.5 Workflow Chaining Events

The `emit_event` node broadcasts any arbitrary named event on the internal bus. This enables workflow-to-workflow chaining without direct coupling. The `presentation.phase_gen.progress` and `presentation.phase_gen.complete` events are consumed by the client portal's SSE listener to show real-time phase generation progress.

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

---

## 17. Script Runner

**Path:** `/admin-panel/scripts`

Interface for browsing the Script Library and executing Azure Automation runbooks.

### 17.1 Script Library

Scripts are grouped by category (e.g., `Workflow Generated`, `M365 Governance`, `Security`). Each script has:
- Title, description, category, created date.
- PowerShell source code viewer.
- "Run" button — opens the parameter input modal.

### 17.2 Running a Script

1. Click **Run** on a script card.
2. Fill in required runbook parameters (sourced from the script's parameter schema).
3. Click **Execute** → calls `POST /api/admin/scripts/:id/run`.
4. Progress is streamed via SSE; the output panel shows stdout/stderr in real time.
5. On completion, the run is logged to `script_runs` and a notification is created.

**Required secrets:** `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_KEY_VAULT_URL`, `AZURE_SUBSCRIPTION_ID`, `AZURE_AUTOMATION_RESOURCE_GROUP`, `AZURE_AUTOMATION_ACCOUNT_NAME`.

The service principal needs **Key Vault Secrets User** and **Key Vault Certificates User** on the vault, and **Automation Operator** on the Automation account.

### 17.3 Runbook Parameter Injection

Customer credentials are fetched from Azure Key Vault at run time by name — they are never stored in the DB. The vault name pattern is configured via `AZURE_KEY_VAULT_URL`. The `clientId` parameter is resolved from the linked client record and injected as `ClientId` into the runbook parameters automatically when using `update_m365_profile` nodes.

Note: the Azure Automation SDK's `runbookDraft.replaceContent` call is treated by the SDK as a long-running operation and will attempt to JSON-parse the PowerShell script body as its response — this fails for real PowerShell content. The Script Runner bypasses this by issuing a raw authenticated `fetch` with a bearer token rather than using the SDK method directly.

---

## 18. System Settings

**Path prefix:** `/admin-panel/system`

### 18.1 Profile & Security (`/system/profile`)

- **Change password** — updates the admin account credential.
- **MFA settings** — enrol or remove TOTP authenticator; register or remove passkeys (WebAuthn). SMS MFA is blocked for admins.
- **Active sessions** — view and revoke active refresh token sessions.
- **Admin accounts** — view and manage all admin users (email, role, password status).

### 18.2 Signal Mappings (`/system/signal-mappings`)

Maps M365 tenant profile data and audit findings to named pain signals and workflow trigger keys. Same data as the Tenant Signals rules view (see [Section 9](#9-tenant-signals) for the full schema and live rule set), accessible from the System menu for configuration without leaving system settings.

Signal keys in `engagement_projects.triggered_by` are canonical — the `0012_engagement_project_signal_keys` migration backfills legacy plan-name strings.

### 18.3 Integrations (`/system/integrations`)

View and manage connected Replit integrations (Stripe, Resend, etc.). Shows connection status, last-tested timestamp, and a **Test** button that calls a lightweight ping endpoint for each integration.

### 18.4 Environment Settings (`/system/environment`)

Read-only view of critical environment variable status (present/missing). Never displays secret values. Covers: Twilio, VAPID keys, Azure credentials, Google Search Console, LinkedIn, Twitter, Facebook, and Stripe keys.
