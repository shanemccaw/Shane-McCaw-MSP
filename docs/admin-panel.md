# Admin Panel — Complete Reference Documentation

> **Audience:** Shane McCaw (day-to-day operations) and future developers / contractors.  
> **Scope:** Admin Panel artifact only. Public website internals → `docs/website.md`. Client portal internals → `docs/crm.md`. Full API schema → OpenAPI spec in `artifacts/api-server`.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Authentication & Security](#2-authentication--security)
3. [Shell Structure (DashboardShell)](#3-shell-structure-dashboardshell)
4. [Command Workspace](#4-command-workspace)
5. [Pipeline Workspace](#5-pipeline-workspace)
6. [Delivery Workspace](#6-delivery-workspace)
7. [Finance Workspace](#7-finance-workspace)
8. [Content & Offers Workspace](#8-content--offers-workspace)
9. [System Workspace](#9-system-workspace)
10. [Workflows Module — Overview & Builder](#10-workflows-module--overview--builder)
11. [Workflows Module — Node Type Reference](#11-workflows-module--node-type-reference)
12. [Workflow Triggers Reference](#12-workflow-triggers-reference)
13. [Workflow Events Catalog](#13-workflow-events-catalog)
14. [Notification & Push System](#14-notification--push-system)
15. [Azure Automation Integration](#15-azure-automation-integration)
16. [Google Search Console Integration](#16-google-search-console-integration)

---

## 1. Architecture Overview

| Property | Value |
|---|---|
| Artifact path | `artifacts/admin-panel/` |
| Package name | `@workspace/admin-panel` |
| Preview path | `/admin-panel/` |
| Stack | React 18, Vite, TypeScript, Tailwind CSS v4, Wouter (routing) |
| UI library | shadcn/ui + Lucide React |
| State | TanStack Query v5 (staleTime: 30 s, retry: 1) |
| Auth context | `src/contexts/AuthContext.tsx` |
| Entry router | `src/App.tsx` |
| Shell | `src/components/DashboardShell.tsx` |
| Service worker | `public/sw.js` (handles Web Push) |
| API target | All requests go to `/api/…` (routed by the shared reverse proxy to `artifacts/api-server`) |

### Route Map

| URL Pattern | Workspace / Component |
|---|---|
| `/admin-panel/login` | `LoginPage` |
| `/admin-panel/command/:section` | `CommandWorkspace` |
| `/admin-panel/pipeline/:section` | `PipelineWorkspace` |
| `/admin-panel/delivery/:section` | `DeliveryWorkspace` |
| `/admin-panel/finance/:section` | `FinanceWorkspace` |
| `/admin-panel/content/:section` | `ContentWorkspace` |
| `/admin-panel/system/:section` | `SystemWorkspace` |
| `/admin-panel/workflows/list` | `WorkflowsWorkspace` (list) |
| `/admin-panel/workflows/builder/:id` | `WorkflowsWorkspace` (builder) |
| `/admin-panel/workflows/triggers/:id` | `WorkflowsWorkspace` (trigger config) |
| `/admin-panel/workflows/runs/:id` | `WorkflowsWorkspace` (run detail) |
| `/admin-panel/crm/leads/:id` | `LeadDetailPage` |
| `/admin-panel/crm/clients/:id` | `ClientDetailPage` |
| `/admin-panel/crm/projects/:id` | `ProjectDetailPage` |
| `/admin-panel/crm/invoices/:id` | `InvoiceDetailPage` |
| `/admin-panel/crm/purchases/:id` | `PurchaseDetailPage` |
| `/admin-panel/crm/opportunities/:id` | `OpportunityDetailPage` |
| `/admin-panel/prompt-center/:id` | `PromptCenterEditPage` |

All routes enforce `RequireAdmin`, which redirects to `/login` (saving `adminReturnTo` in `sessionStorage`) if the user is not authenticated or does not have `role === "admin"`.

---

## 2. Authentication & Security

### 2.1 Login Flow

1. User visits `/admin-panel/login`.
2. `POST /api/auth/login` — sends `{ email, password }`.
3. Rate limiter: **10 attempts per IP per 15 minutes** (relaxed to 200 in development).
4. Server looks up user by email, verifies `bcrypt` password hash.
5. **If MFA is enrolled:** server returns `{ mfaRequired: true, mfaToken, methods }`. The `mfaToken` is a short-lived JWT (10 minutes) used to identify the pending session without issuing a full access token.
6. **If no MFA:** server issues full tokens immediately (step 7).
7. Server sets an `httpOnly` `refreshToken` cookie and returns `{ accessToken, user }` in the response body.
8. `AuthContext` stores `accessToken` in React state (in-memory only; never written to `localStorage`).
9. Router redirects to `adminReturnTo` (if set) or `/command/overview`.

### 2.2 MFA Mandate

Admins are **prohibited** from using SMS-OTP for MFA. Attempting to set up SMS MFA while logged in as an admin returns HTTP 403 (`"Admins must use passkey or authenticator app authentication"`).

| MFA Method | Admin | Client |
|---|---|---|
| TOTP (authenticator app) | ✅ Allowed | ✅ Allowed |
| WebAuthn / Passkey | ✅ Allowed | ✅ Allowed |
| SMS OTP | ❌ Blocked | ✅ Allowed |

**TOTP secret storage:** encrypted with AES-256-GCM. Key is derived from `TOTP_ENCRYPTION_KEY` (32-byte hex) or falls back to `SHA-256(JWT_SECRET)`.

**MFA endpoints:**
- `POST /api/auth/mfa/totp/setup` — generates secret + QR code
- `POST /api/auth/mfa/totp/verify-setup` — confirms enrollment
- `POST /api/auth/mfa/totp/challenge` — validates code during login
- `POST /api/auth/mfa/passkey/registration-options` — WebAuthn registration
- `POST /api/auth/mfa/passkey/authentication-options` — WebAuthn login challenge
- `POST /api/auth/mfa/passkey/verify-authentication` — completes WebAuthn login

### 2.3 JWT Dual-Token Architecture

| Token | TTL | Storage | Scope |
|---|---|---|---|
| Access token | **8 hours** | React in-memory state | `Authorization: Bearer <token>` header on every API call |
| Refresh token | **30 days** | `httpOnly` cookie (`/api/auth` path only) | Used to obtain new access tokens silently |

**Proactive refresh:** `AuthContext` decodes the access token's `exp` claim and schedules a `setTimeout` to call `POST /api/auth/refresh` **5 minutes before** expiry. This means the admin never receives a 401 mid-session during normal use.

**Retry-on-401:** `fetchWithAuth()` automatically retries any 401 response once after attempting a token refresh. If the refresh itself fails with a 401 (server confirmed session dead), the user is redirected to `/login`. Transient network errors (502, 503 during restart) do not clear the session.

**`fetchWithAuth` content-type rule:** `Content-Type: application/json` is set automatically only when the request body is a `string`. FormData uploads must not pre-set this header; the browser sets it with the multipart boundary.

### 2.4 Audit Logging & Session Management

Every admin action is visible in the Activity Logs section (`/delivery/activity-logs`). The audit trail includes the acting user ID, timestamp, entity type, entity ID, and action.

Logout (`POST /api/auth/logout`) clears the `refreshToken` cookie and performs a hard redirect to `/login`, killing all in-flight SSE connections and TanStack Query subscriptions.

### 2.5 Impersonation Flow

Admins can view the client portal as a specific client without knowing their password.

1. Admin generates an impersonation token from the Client Detail page.
2. Server inserts a one-time-use `impersonation_tokens` row (expires in 30 minutes).
3. Admin's browser is redirected to the CRM portal with `?impersonate=<token>`.
4. CRM portal calls `POST /api/auth/impersonate-exchange` with the token.
5. Server marks the token used and returns a short-lived access token (30 minutes) with `{ role: "client", impersonatedBy: adminUserId }`.
6. **Impersonated sessions are read-only:** all non-GET requests return HTTP 403 (`"This action is not available in admin preview mode"`).

### 2.6 Password Management

| Endpoint | Behaviour |
|---|---|
| `POST /api/auth/register` | Always 403 — accounts are created via purchase flow only |
| `POST /api/auth/forgot-password` | Always returns 200 (prevents email enumeration); sends reset link or setup link silently |
| `POST /api/auth/reset-password` | Validates token (1 hour TTL), sets new password hash |
| `POST /api/auth/setup-password` | First-time setup after purchase; uses `account_setup_tokens` (72-hour TTL) |

---

## 3. Shell Structure (DashboardShell)

`DashboardShell` wraps every authenticated admin page. It renders:

### 3.1 Persistent Sidebar

The sidebar lists all 7 workspace entries. It can be collapsed to icon-only mode; state is persisted to `localStorage` under the key `admin_sidebar_collapsed`.

| Workspace | Default Path | Description |
|---|---|---|
| Command | `/command/overview` | Overview, analytics & AI tools |
| Pipeline | `/pipeline/leads` | Leads, clients & opportunities |
| Delivery | `/delivery/projects` | Projects, workflows & activity |
| Finance | `/finance/invoices` | Invoices, purchases & contracts |
| Content & Offers | `/content/articles` | Articles, services & templates |
| System | `/system/inbox` | Inbox, security & settings (badge for unread email) |
| Workflows | `/workflows/list` | Design, automate & monitor |

Tooltips appear on hover when the sidebar is collapsed, showing the workspace label and description.

### 3.2 Top Header

The header (`h-14`, `bg-[#161B22]`) contains:

| Element | Description |
|---|---|
| Mobile hamburger | Opens sidebar drawer on `< lg` viewports |
| Breadcrumb | `Workspace > Section` label (desktop only); computed from the current path against `SECTION_LABELS` and `PREFIX_LABELS` maps |
| Live visitors badge | Green pulsing dot with count when `liveVisitors > 0`; grey "0 live now" otherwise. Polled from `/api/admin/analytics/live` |
| Campaign badges | Amber pulsing dot per active campaign with live visitor count; shown for campaigns with `liveCount > 0` |
| Global search | Placeholder `⌘K` search bar (not yet implemented) |
| Sound mute toggle | Mutes / unmutes purchase alert sounds; state stored in component |
| Notification bell | Opens `NotificationDrawer`; red badge shows unread count |
| Identity chip | Avatar initial, "Shane McCaw / Administrator", sign-out button |

### 3.3 Development Banner

When `import.meta.env.DEV` is true, an amber banner reading **"DEVELOPMENT ENVIRONMENT — changes here do not affect production"** appears above the header.

---

## 4. Command Workspace

**Path prefix:** `/command`  
**Default section:** `overview`

### 4.1 Overview (`/command/overview`)

The command centre dashboard. Contains:

- **AI Insights panel** — AI-generated summary of recent activity, hot leads, and suggested next actions.
- **Pipeline funnel** — Visual kanban-style funnel showing lead → opportunity → client conversion counts.
- **Revenue sparklines** — MRR trend and monthly revenue charts.
- **Active projects** — Count of in-flight client projects with status indicators.

### 4.2 Messages (`/command/messages`)

Unified CRM communications hub. Shows all email threads and messages associated with leads and clients. Allows composing and sending emails directly from the admin panel. Unread email count feeds the System workspace badge in the sidebar.

### 4.3 Analytics (`/command/analytics`)

Traffic and conversion analytics. Includes:

- Site visitor traffic charts (pageviews, sessions, bounce rate).
- Conversion funnel from landing page visit → lead form submission → qualified lead.
- Campaign performance by landing page slug.

### 4.4 M365 Scripts (`/command/scripts`)

Two sub-sections:

**PowerShell Generator:** Input a natural-language description; AI generates a PowerShell script targeting Microsoft 365, Entra ID, or SharePoint. Generated scripts appear in the Script Library under the `Workflow Generated` category in Azure Automation.

**Running Scripts / Runbook Monitor (`/command/scripts` → running tab):** Real-time monitor for Azure Automation runbook jobs. Shows job ID, runbook name, status, start time, and output stream. Status is polled or streamed via SSE.

### 4.5 AI Prompts (`/command/prompts`)

Prompt library management. Lists all AI prompt templates stored in the `ai_prompts` DB table. Each prompt has a `key`, a `body` (the prompt text with `{{variable}}` placeholders), and an optional description.

**Edit:** Navigate to `/prompt-center/:id` for full-page editing with syntax highlighting. Changes apply immediately to all subsequent AI calls that use that prompt key (prompts are loaded at runtime by `getPrompt(key, fallback)`).

**Important:** `seedAiPrompts()` uses `ON CONFLICT DO NOTHING` — changing a prompt's code constant has zero effect on an existing row. Use `UPDATE ai_prompts SET body = '...' WHERE key = '...'` to change a live prompt.

### 4.6 Marketing Command Center (`/command/marketing`)

Four sub-tabs:

| Tab | Purpose |
|---|---|
| Hot Leads | AI-ranked leads with intent signals and recommended next action |
| Campaign Performance | CTR, conversion, and revenue attribution per campaign / landing page |
| Landing Page Builder | Visual builder for creating and publishing campaign landing pages |
| Daily Command | AI-generated daily briefing with suggested actions; "Run Now" button executes queued marketing tasks |

### 4.7 Insights (`/command/insights` or via Presentations)

Repository of AI-generated intelligence documents (Executive Summaries, Readiness Reports, SOWs, etc.) for all clients. Documents can be filtered by client, type, and status. Supports previewing HTML content and marking documents as `approved` or `delivered`.

### 4.8 Presentations (`/command/presentations`)

SOW / proposal management. Lists all client presentations (interactive SOW flows). Shows status (e.g. `pending_sow`, `pending_payment`, `signed`, `paid`). Admin can view a presentation's full detail, approve phases, monitor PAY-TODAY discount status, and check payment plan.

---

## 5. Pipeline Workspace

**Path prefix:** `/pipeline`  
**Default section:** `leads`

### 5.1 Leads (`/pipeline/leads`)

Master list of inbound leads. Supports both **Kanban** (column per status) and **List** (sortable table) views.

**Status progression:**
```
new → contacted → qualified → proposal_sent → negotiation → closed_won / closed_lost
```

**Actions:** Edit lead details, add notes, convert to opportunity, delete. Each lead can be clicked to open `LeadDetailPage` (`/crm/leads/:id`) which shows full contact info, conversation history, qualification score, and associated opportunities.

### 5.2 Quiz Leads (`/pipeline/quiz-leads`)

Leads sourced from the diagnostic quiz on the public website. Each record includes:

- Quiz response data (all answers stored in JSONB).
- Computed score, tier (Beginner / Intermediate / Advanced), and recommended service.
- Signals extracted from quiz answers (mapped via Signal Mappings).

Clicking a quiz lead opens its detail view which shows the full quiz answer breakdown alongside standard lead fields.

### 5.3 Opportunities (`/pipeline/opportunities`)

Deal pipeline in Kanban view. Columns represent deal stages. Each card shows client name, estimated value, and age.

**Stages:** Discovery Call → Proposal → Negotiation → Closed Won / Closed Lost.

Clicking an opportunity opens `OpportunityDetailPage` (`/crm/opportunities/:id`) with full deal notes, linked lead, and activity timeline.

### 5.4 Clients (`/pipeline/clients`)

Master directory of all client accounts (users with `role = "client"`). Searchable and filterable by company and status.

Clicking a client opens `ClientDetailPage` (`/crm/clients/:id`) which shows:
- Contact info and address
- All associated projects
- Invoices and purchase history
- Documents and status reports
- M365 Intelligence profile
- Impersonation button (launches portal as this client)

### 5.5 M365 Intelligence (`/pipeline/m365-intelligence`)

Technical profile cards for each client's Microsoft 365 tenant. Data is populated by Azure Automation runbook results stored in `client_m365_profiles`. Each card shows:

- Tenant health scores (Security, Compliance, Copilot Readiness, Governance, Productivity — each 0–100).
- Key metrics: total users, SharePoint sites, licensed services, MFA status.
- Last assessment date and runbook job count.

### 5.6 Diagnostic Shares (`/pipeline/diagnostic-shares`)

Shared assessment links generated for prospects. Each share has a unique token, expiry, and access log showing when the prospect viewed their results.

---

## 6. Delivery Workspace

**Path prefix:** `/delivery`  
**Default section:** `projects`

### 6.1 Projects (`/delivery/projects`)

Kanban delivery boards for all active client projects. Each board represents one project. Cards represent phases / tasks. Card columns are customisable per project.

Clicking a project opens `ProjectDetailPage` (`/crm/projects/:id`) which includes:
- Project overview and status
- Phase breakdown with delivery dates
- SOW documents (generated by `generate_document` node or manually)
- Client timeline and milestones
- Linked invoices and payments
- Activity log specific to this project

### 6.2 Engagement Projects (`/delivery/engagement-projects`)

Long-term retainer delivery tracks. An engagement project groups ongoing work across multiple months or quarters. Each engagement project has:

- A linked client and primary service.
- A series of monthly or milestone-based deliverables.
- An automated insights schedule (Monthly Insights system workflow).
- A `triggered_by` field (signal key) that links the project to the quiz or service interaction that started it.

### 6.3 Workflows (Delivery mirror) (`/delivery/workflows`)

Shows a filtered view of active workflow runs for projects and deliveries. This is a read-only mirror of the Workflows module, filtered to delivery-relevant run types.

### 6.4 Activity Logs (`/delivery/activity-logs`)

Full audit trail across all entities. Searchable and filterable by date range, entity type, and acting user. Captures admin actions, system events, and workflow side-effects. Records include timestamp, user, action string, entity type, entity ID, and optional metadata JSON.

### 6.5 Hub Storage (`/delivery/hub-storage`)

SharePoint document integration. Lists client SharePoint sites provisioned by the system. For each site:

- Browse document libraries and folders.
- Upload files (via `save_to_sharepoint` node or manually).
- View SharePoint web URLs.
- Check site provisioning status and owner assignment.

**Note:** `SHAREPOINT_OWNER_UPN` in Replit Secrets auto-assigns Shane as group owner on newly-provisioned sites. If absent, provisioning continues without the owner assignment.

### 6.6 Tenant Signals (`/delivery/tenant-signals`)

Real-time environment health signals from client tenants. Populated by Azure Automation runbook results via the `m365.health_check_complete` event. Shows current signal state, trend, and timestamp per client.

---

## 7. Finance Workspace

**Path prefix:** `/finance`  
**Default section:** `invoices`

### 7.1 Invoices (`/finance/invoices`)

Billing management for all client invoices. Filterable by status: `draft`, `open`, `paid`, `void`, `uncollectible`.

Clicking an invoice opens `InvoiceDetailPage` (`/crm/invoices/:id`) showing:
- Line items and totals
- Stripe invoice ID and direct link to Stripe Dashboard
- Payment status and payment intent
- Associated project and client

**Side-effect:** Marking an invoice as paid can trigger the `payment.received` event, which may fire downstream workflows.

### 7.2 Purchases (`/finance/purchases`)

One-time micro-offer transactions. Each purchase record corresponds to a completed Stripe Checkout Session for a fixed-price service.

Clicking a purchase opens `PurchaseDetailPage` (`/crm/purchases/:id`) showing:
- Product purchased, amount, Stripe session ID
- Account created status (auto-created on purchase completion)
- SMS alert sent status (Twilio)
- Linked client and onboarding status

### 7.3 Contracts (`/finance/contracts`)

Signed SOW tracking. Lists all engagement agreements that have been signed by clients via the presentation flow. Columns: client name, project, signed date, payment plan, and total value.

Clicking a contract shows the signed HTML content and the linked presentation.

### 7.4 Coupons (`/finance/coupons`)

Discount code management. Coupons are stored in the `coupons` DB table and can be created or edited here.

**PAY-TODAY special logic:**
- The coupon with `code = 'PAY-TODAY'` drives the 72-hour discount offer shown to clients on the presentation payment step.
- `discountValue` is the discount percentage (e.g. `10` = 10% off).
- The `firstVisitedAt` timestamp is recorded when a client first views the payment step, starting the 72-hour window.
- At checkout, the server computes the discount in cents and creates a one-time Stripe coupon with `amount_off` so the discount appears as a named line item in Stripe reporting.
- Both the offer display and the Stripe charge use the same cents-based arithmetic — there is no displayed-vs-charged discrepancy.

### 7.5 Reports (`/finance/reports`)

Revenue forecasting and financial analytics. Includes:
- Monthly recurring revenue (MRR) and one-time revenue trends.
- Outstanding vs. collected receivables.
- Projected revenue from active phased payment plans.

---

## 8. Content & Offers Workspace

**Path prefix:** `/content`  
**Default section:** `articles`

### 8.1 Articles (`/content/articles`)

CMS for the public consulting site blog / knowledge base. Articles are stored as Markdown files in `artifacts/shane-mccaw-consulting/src/content/articles/`.

**Actions:**
- Create new article (opens WYSIWYG Markdown editor).
- Edit existing article (title, body, category, slug, published date, summary).
- Delete article (removes the `.md` file).
- Preview rendered article in a side panel.

Changes appear immediately in the Vite dev server via HMR. A production deploy is required to surface new articles to the live public site.

### 8.2 Services (`/content/services`)

Product catalog editor. Lists all consulting services offered. Each service has:
- Name, slug, description, price (or price range).
- Icon, category.
- Associated engagement project template.
- Service triggers configuration.

### 8.3 Engagement Projects (Content) (`/content/engagement-projects`)

Template editor for engagement project definitions. These templates drive the automated project setup when a client purchases a service. Each template specifies:
- Default phases, deliverables, and timelines.
- Which Azure Automation runbooks to run at each phase.
- AI document generation steps.

### 8.4 Service Triggers (`/content/service-triggers`)

Automated service-page interaction configuration. Defines conditions under which a visitor interacting with a specific service page triggers a workflow (e.g., "if visitor views the Microsoft 365 Assessment page and downloads a checklist, qualify them as a lead").

### 8.5 Email Templates (`/content/email-templates`)

Outreach and system email library. Templates are used by the `send_email` and `send_campaign_email` workflow nodes. Each template has:
- Slug (used as the template key in workflow config).
- Subject line.
- HTML body with `{{variable}}` placeholders.
- Category (transactional, marketing, onboarding, etc.).

### 8.6 Contract Templates (`/content/contract-templates`)

Reusable legal templates for engagement agreements. Templates are rendered as the agreement step in the client presentation flow. Each template has:
- A name and optional version number.
- An HTML body with `{{clientName}}`, `{{projectTitle}}`, `{{totalPrice}}`, and other placeholders.
- A service association (determines which template is used for which service type).

### 8.7 Template Library (`/content/template-library`)

Additional document and proposal templates not covered by contract templates. Used for generating standard consulting deliverables (project briefs, status reports, etc.).

### 8.8 Asset Library (`/content/asset-library`)

Three sub-sections accessible from this section and also at legacy paths:

| Asset Type | Legacy Path | Description |
|---|---|---|
| Checklists | `/asset-library/checklists` | Pre-built Microsoft 365 implementation checklists delivered to clients |
| Instruction Sets | `/asset-library/instruction-sets` (→ `/content/asset-library`) | Step-by-step technical guides for M365 configuration tasks |
| Artifact Sets | `/asset-library/artifact-sets` | Bundled deliverable packages (e.g., "SharePoint Governance Pack") |
| Deliverable Sets | `/asset-library/deliverable-sets` | Collections of related deliverables for a service offering |
| Categories | `/asset-library/categories` | Tag/category management for the asset library |

---

## 9. System Workspace

**Path prefix:** `/system`  
**Default section:** `inbox`

### 9.1 Inbox (`/system/inbox`)

System alerts and email hub. Aggregates:
- Incoming emails from leads and clients (via Resend inbound webhook or Resend tracking events).
- System notifications generated by workflows and server events.
- Unread count drives the red badge on the System workspace sidebar entry.

### 9.2 Security (`/system/security`)

Admin credential management. Sections:

- **Change password** — Update the admin account password.
- **MFA settings** — Enroll or remove TOTP authenticator; register or remove passkeys (WebAuthn). SMS MFA is blocked for admins.
- **Active sessions** — View and revoke active refresh token sessions.
- **Admin accounts** — View and manage admin user accounts (email, role, password status).

### 9.3 Signal Mappings (`/system/signal-mappings`)

Maps quiz answers and tenant environment data to named **pain signals** and **workflow trigger keys**.

Each signal mapping defines:
- A signal key (e.g. `needs_governance_review`, `copilot_not_ready`).
- Matching criteria (quiz answer values or M365 profile thresholds that activate the signal).
- Associated workflow trigger (which workflow fires when this signal is detected).
- Severity level and description.

Signal keys in `engagement_projects.triggered_by` are canonical — the `0012_engagement_project_signal_keys` migration backfills any legacy plan-name strings.

### 9.4 Integrations (`/system/integrations`)

View and manage connected Replit integrations (Stripe, Resend, etc.). Shows connection status, configuration, and links to test each integration.

### 9.5 Environment Settings (`/system/environment`)

Read-only view of critical environment variable status (whether required secrets are present). Never displays secret values. Used to diagnose missing-secret failures (Twilio, VAPID keys, Azure credentials, etc.).

---

## 10. Workflows Module — Overview & Builder

**Path prefix:** `/workflows`

### 10.1 Workflow List (`/workflows/list`)

Lists all workflow definitions. Each row shows:
- Name, description, category tag.
- Published version label and number.
- Trigger summary (type icons, event names).
- Last run status and time.
- "System" badge for seeded system workflows (these have no delete button).
- Actions: Run Now, Duplicate, Edit Triggers, Open Builder, Delete.

**Filtering / grouping:** Workflows can be grouped by category (editable via the `PATCH /api/admin/workflows/definitions/:id` endpoint using the `category` field in `metadata`).

### 10.2 Run History (`/workflows/runs`)

Table of all workflow run records. Filterable by definition, status, and date. Columns: Run ID, Workflow name, Trigger type, Status, Started, Duration.

Clicking a run opens the **Run Detail** page (`/workflows/runs/:id`) showing the full node execution log — every node's status, output, duration, and log messages — streamed in real time via SSE while the run is active.

### 10.3 Workflow Builder (`/workflows/builder/:id`)

The drag-and-drop visual canvas for designing workflows.

**Canvas mechanics:**
- Workflows are defined as **directed graphs** stored as `{ nodes: WfNode[], edges: WfEdge[] }` in the `wf_versions.graph` JSONB column.
- Nodes are positioned with `{ x, y }` coordinates. Edges connect a `source` node (and optional `sourceHandle`, e.g. `"true"`, `"false"`, `"branch_1"`) to a `target` node.
- The canvas uses React Flow for rendering.

**Versioning:**
- Each definition can have multiple versions.
- Only one version can be in `"published"` status at a time. Publishing a version archives all previous published versions.
- Editing a published version auto-creates a new `"draft"` version from it (the original published version is untouched).
- The `is_default = true` flag marks the original system-seeded v1 (enables "Revert to default" in the UI).

**Variable interpolation:** All node text fields support `{{variable}}` syntax at runtime:
- `{{payload.fieldName}}` — direct access to the trigger payload.
- `{{fieldName}}` — shorthand for `payload.fieldName`.
- `{{steps.nodeId.outputField}}` — output from a previously-executed node (accumulated in the run's payload map).
- Nested paths: `{{steps.ask.aiResponse}}`, `{{client.email}}`.
- Arrays and objects are emitted as compact JSON strings.

**Condition expression syntax (no `eval`):**
```
path op literal       →  status == 'paid'
boolean path          →  isQualified
logical operators     →  score >= 80 && status != 'closed_lost'
contains operator     →  message contains 'urgent'
template reference    →  {{stripeInvoiceId}} && paymentPlan == 'phased'
```
Operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`. Logical: `&&`, `||`.

### 10.4 BFS Execution Model

The executor uses **breadth-first traversal** with a convergence-safe algorithm:

- `resolvedCount[node]` — how many predecessor edges have been resolved.
- `activeCount[node]` — how many of those predecessors were non-skipped.
- A node is **ready** when `resolvedCount == inDegree`.
- A node is **skipped** when ready and `activeCount == 0` (all predecessors were themselves skipped).
- This correctly handles converging branches (nodes with multiple incoming edges from an `if/else` or parallel split).

**Run statuses:** `running` → `completed` | `failed` | `cancelled`.

**Dry Run mode:** All DB-writing nodes are stubbed with realistic synthetic outputs. Structural nodes (`start`, `end`, `condition`, `switch_case`, etc.) still execute normally so condition branches can be traced.

**Concurrency & depth limits:** Each definition has `concurrencyLimit` (1–50, default 5) and `maxRunDepth` (1–10, default 5) to prevent runaway recursion from `emit_event` → self-trigger loops.

### 10.5 Trigger Configuration (`/workflows/triggers/:id`)

The trigger configuration page for a specific workflow definition. Allows adding, editing, enabling/disabling, and deleting triggers without opening the full builder.

---

## 11. Workflows Module — Node Type Reference

### Category: Structural / Control Flow

| Node Key | Description | Key Inputs | Key Outputs |
|---|---|---|---|
| `start` | Entry point of every workflow. Exactly one per graph. | — | `{ started: true }` |
| `end` | Terminal node. Multiple allowed. | `label` | `{ finished: true, label }` |
| `condition` | Evaluates a boolean expression. Routes to `true` or `false` output edge. | `expression` | Sets `conditionResult`; routes `true`/`false` handles |
| `switch_case` | Multi-branch router. Evaluates `switchExpr` against a list of `cases`; routes to matching case handle or `default`. | `switchExpr`, `cases[]` (`{ id, matchValue, label }`) | `{ switchValue, chosenBranch, matchedCaseId }` |
| `foreach` | Iterates over an array. Executes the sub-graph once per element. | `arrayPath`, `itemAlias` | `{ item, [alias], itemIndex, itemsTotal, collectedResults }` |
| `parallel` | Splits execution into N simultaneous branches. | `branchCount`, `branchLabels[]`, `branchWait[]` | Branch handle outputs |
| `join` | Synchronises parallel branches before continuing. | — | `{ joined: true }` |
| `delay` | Pauses execution for a fixed or random duration. | `mode` (fixed/random), `duration`, `unit` | `{ skipped }` (dry-run always skips) |
| `retry` | Retries a failed upstream node up to N times. | `maxAttempts`, `delaySeconds` | Pass-through |
| `report_progress` | Broadcasts an SSE progress event to listening clients. | `progress` (0–100), `message`, `phase` | SSE broadcast (no output node) |
| `approval_gate` | Pauses the run until a human approves or rejects. Creates a `pending_approvals` DB row. | `approverRole`, `label`, `expiresInHours` | `{ approvalId, approverRole, expiresAt }` (run paused) |
| `ask_for_input` | Pauses run and presents a form to the admin ("Run Now" flows). | `fields[]` (`{ variableName, label, type, required, options, multi }`) | One output key per declared variable |

### Category: AI & Content

| Node Key | Description | Key Inputs | Key Outputs |
|---|---|---|---|
| `ask_ai` | Calls Claude (Anthropic) with a user prompt and optional system prompt. Model is configurable. | `promptExpr`, `systemExpr`, `model` (e.g. `claude-haiku-4-5`, `claude-opus-4-5`) | `{ aiResponse, model }` |
| `compose` | Interpolates a template string; optionally parses the result as JSON. Can validate against a JSON Schema. | `inputs` (template), `parseAsJson`, `jsonSchema` | `{ value }` |
| `generate_document` | Generates an AI consulting document or report using client M365 data, health scores, and SOW content. Delegates to `generateConsolidatedSowDocument` for `consolidated_sow` type. | `clientId`, `projectId`, `docType`, `docCategory`, `title`, `sowHtml`, `sowDocumentId` | `{ documentId, docType, category, title, clientId }` |
| `generate_script` | Generates a PowerShell runbook from a service or document using AI. Saved to the Script Library under `Workflow Generated` category. | `sourceMode` (service/document), `targetId`, `customInstructions`, `outputMode` | `{ scriptId, packageId, title }` |
| `generate_article` | Generates a full blog article via Claude Haiku. Saves to disk only when the `publish_article` node runs. | `topic`, `category`, `tone`, `wordCount` | `{ articleTitle, articleSlug, articleCategory, articleSummary, articleDate, articleContent }` |
| `publish_article` | Saves a generated article to `src/content/articles/` as a `.md` file. `draftOnly: true` saves without publishing date. | `titleExpr`, `draftOnly` | `{ published, slug, articleId, title }` |
| `topic_picker` | Uses Claude to select the best article topic from a focus area. | `focusArea`, `category` | `{ articleTopic, topicCategory }` |
| `generate_image` | Generates an image via OpenAI `gpt-image-1`. Saves to `/data/uploads/generated-images/`. | `promptExpr`, `aspectRatio` (square/landscape/portrait/wide) | `{ imageUrl, revisedPrompt }` |
| `generate_pdf` | Converts HTML to a PDF via a rendering service. | `htmlTemplate`, `fileName` | `{ pdfBase64, pdfDataUri, fileName }` |
| `fetch_news_headlines` | Fetches M365-related news headlines and produces a campaign brief via Claude. | `topic`, `targetSector` | `{ newsHeadlines[], newsTopic, newsContext, newsArticleSuggestion, hotScore, isHot, campaignBrief, campaignId }` |

### Category: CRM & Project

| Node Key | Description | Key Inputs | Key Outputs |
|---|---|---|---|
| `create_lead` | Inserts a new lead row. | `name`, `email`, `company`, `serviceArea`, `message` | `{ leadId, leadEmail, leadName }` |
| `convert_to_opportunity` | Creates an opportunity record linked to a lead. | `leadId`, `workflowType` | `{ opportunityId, leadId }` |
| `create_client` | Creates a user with `role = "client"`. | `name`, `email` | `{ clientId, clientEmail }` |
| `create_project` | Creates a project. Broadcasts `project_ready` SSE to linked presentation if `contractId` or `presentationId` is in payload. | `title`, `description`, `projectType`, `clientUserId` | `{ projectId, projectTitle }` |
| `score_lead` | Runs the lead qualification scoring algorithm. | `leadId` | `{ leadId, score, scoreLabel, qualified }` |
| `assign_pipeline_stage` | Moves a lead or opportunity to a new pipeline stage. | `leadId` / `opportunityId`, `stage`, `targetType` | `{ targetType, leadId/opportunityId, stage }` |
| `create_opportunity` | Creates a new opportunity. | `leadId` | `{ opportunityId, leadId }` |
| `parse_quiz_results` | Parses a quiz lead's answers into a structured assessment. | `quizLeadId` | `{ totalScore, tier, recommendedService, leadName, leadEmail, company, categoryScores }` |
| `generate_readiness_score` | Computes an M365 readiness score. | `clientId` | `{ readinessScore, readinessLabel, recordId }` |
| `attach_quiz_insights` | Attaches quiz-derived AI insights to a document. | `quizLeadId`, `documentId` | `{ insightsAttached, documentId }` |
| `create_kanban_task` | Creates a task card on a kanban board. | `boardId`, `columnId`, `titleExpr`, `descriptionExpr`, `priority`, `phaseId` | `{ taskId, boardId, columnId, title }` |
| `get_phases` | Fetches SOW phases for a presentation or project. | `presentationId`, `projectId` | `{ phases[], phaseCount, presentationId }` |
| `create_phase` | Creates a project phase / workflow step. | `projectId`, `title`, `description`, `order`, `sowPhaseId` | `{ phaseId, phaseTitle }` |
| `save_presentation_phases` | Saves AI-generated phase array back to the presentation. | _(payload context)_ | `{ saved, phaseCount, resolvedPhases }` |
| `build_presentation` | Generates the full proposal/SOW HTML presentation for a client. | `clientId`, `projectId`, `templateId` | `{ presentationHtml, presentationUrl, presentationId }` |
| `find_object` | Finds an existing DB or Stripe record by field value. | `objectType` (lead, client, project, article, stripe_invoice, insights_document, presentation), `fieldName`, `fieldValueExpr` | `{ found, objectId, objectType, ...objectDetails }` |

### Category: Communication & Notification

| Node Key | Description | Key Inputs | Key Outputs |
|---|---|---|---|
| `send_email` _(promoted)_ | Sends a transactional email via Resend using a named template or inline HTML. | `to`, `templateSlug` / `subject` + `htmlBody`, template variables | `{ sent, messageId }` |
| `send_sms` _(promoted)_ | Sends an SMS to Shane's phone via Twilio (`sendAdminSms`). | `body` | `{ sent }` |
| `send_campaign_email` | Sends a marketing email from an asset or template to a specific recipient. | `recipientExpr`, `assetId` / `templateSlug` | `{ sent, recipient, subject, sourceRef }` |
| `create_notification` | Inserts a notification record into the DB (shows in notification drawer). | `title`, `body`, `linkPath`, `type` | `{ notificationCount }` |
| `send_browser_notification` | Sends a Web Push notification to all subscribed admin browsers via VAPID. | `title`, `body`, `linkPath` | `{ notificationSent }` |
| `send_mobile_push` | Sends a push notification to the Expo mobile app (all enrolled admin device tokens). | `title`, `body` | `{ sent, sentCount }` |
| `play_sound` | Plays an audio alert. Targets: `browser` (SSE to open tab) or `desktop` (Web Push → service worker → postMessage). | `target`, `sound` (ping/chime/etc.), `url` (custom audio), `synthParams` | `{ soundPlayed, soundTarget }` |

### Category: M365 & Azure

| Node Key | Description | Key Inputs | Key Outputs |
|---|---|---|---|
| `execute_runbook` _(promoted)_ | Submits an Azure Automation runbook job. Requires Azure secrets to be configured. | `runbookName`, `runbookParams` (JSON string) | `{ jobId, jobStatus, runbookName }` |
| `update_m365_profile` _(promoted)_ | Same as `execute_runbook` but also passes `ClientId` as a runbook parameter from `node.data.clientId`. | `runbookName`, `clientId` | `{ jobId, jobStatus, runbookName }` |
| `validate_m365_permissions` | Verifies that required Graph API permissions are present for a tenant. | `clientId` | `{ permissionsValid, missingCount, jobId }` |
| `update_intelligence_tables` | Refreshes the M365 intelligence tables from the latest profile data. | `clientId` | `{ updated, recordId, jobId }` |
| `generate_diff_report` | Generates a diff report comparing current vs. previous M365 profile state. | `clientId` | `{ documentId, changesFound, changeCount }` |
| `notify_major_changes` | Sends an alert when significant M365 configuration changes are detected. | `clientId`, `changeCount` | `{ notified, skipped }` |
| `save_to_sharepoint` | Uploads a file to a SharePoint document library via Graph API. | `siteId`, `driveId`, `folderPath`, `fileName`, `fileContentBase64`/`fileContentText`, `contentType` | `{ sharePointItemId, sharePointWebUrl, sharePointDownloadUrl }` |
| `get_from_sharepoint` | Downloads a file from SharePoint via Graph API. | `siteId`, `driveId`, `itemId`/`itemPath` | `{ fileContentBase64, fileName, mimeType, sharePointWebUrl }` |
| `check_exchange_calendar_availability` | Checks free/busy status on a mailbox via Graph API. | `userUpn`, `startDateTime`, `endDateTime` | `{ isBusy, availableSlots[], busySlots[] }` |
| `create_exchange_calendar_event` | Creates a calendar event via Graph API. | `userUpn`, `subject`, `body`, `startDateTime`, `endDateTime`, `attendees` | `{ eventId, eventUrl, eventWebLink }` |

### Category: Finance (Stripe)

| Node Key | Description | Key Inputs | Key Outputs |
|---|---|---|---|
| `generate_invoice_stripe_payment` | Creates a Stripe invoice and finalises it for manual payment. | `customerEmail`, `customerName`, `daysUntilDue`, `lineItems` (JSON array) | `{ invoiceId, invoiceUrl, invoicePdfUrl, amountDue, currency }` |
| `generate_stripe_payment_link` | Creates a Stripe Payment Link for a product. | `productName`, `amount`, `currency`, `quantity`, `metadata` | `{ paymentLinkId, paymentLinkUrl }` |
| `create_phased_invoices` | Creates one draft Stripe invoice per SOW phase (for phased payment plans). Stores the deposit payment method as the customer default. | `projectId`, `clientEmail`, `clientName`, `depositSessionId` | `{ invoiceIds[], phaseCount, totalScheduled }` |
| `charge_stripe_invoice` | Finalises and immediately charges a draft Stripe invoice. | `invoiceId` (`stripeInvoiceId`) | `{ chargeStatus, amountCharged, stripePaymentIntentId }` |
| `edit_stripe_invoice` | Updates a draft Stripe invoice's due date, description, or footer. | `stripeInvoiceIdExpr`, `dueDateExpr`, `descriptionExpr`, `footerExpr` | `{ invoiceId, status, dueDate }` |

### Category: Social Media

| Node Key | Description | Key Inputs | Key Outputs |
|---|---|---|---|
| `post_linkedin` | Posts to LinkedIn as an organisation via UGC Posts API. Requires `LINKEDIN_ACCESS_TOKEN` and `LINKEDIN_ORG_ID`. | `postBody`, `imageUrl` (optional), `orgId` (per-node override) | `{ linkedinPostId, linkedinPostUrl, preview }` |
| `post_twitter` | Posts a tweet via Twitter API v2 (OAuth 1.0a HMAC-SHA1). Requires 4 Twitter secrets. | `postBody`, `imageUrl` (optional) | `{ twitterTweetId, twitterTweetUrl, preview }` |
| `post_facebook` | Posts to a Facebook Page via Graph API v19. Requires `FACEBOOK_PAGE_ACCESS_TOKEN` and `FACEBOOK_PAGE_ID`. | `postBody`, `imageUrl` (optional), `pageId` (per-node override) | `{ facebookPostId, facebookPostUrl, preview }` |

### Category: Data & Variables

| Node Key | Description | Key Inputs | Key Outputs |
|---|---|---|---|
| `set_variable` | Declares a new variable with a value and optional type coercion. | `variableName`, `valueExpr`, `variableType` (string/int/float/boolean/null/array/object/json) | `{ value, variables, [variableName] }` |
| `update_variable` | Updates an existing variable in the payload. Same inputs as `set_variable`. | (same as above) | (same as above) |
| `http_request` _(promoted)_ | Makes an outbound HTTP request. | `url`, `method`, `headers`, `body` | `{ status, ok, errorDetail }` |
| `sql_query` _(promoted)_ | Executes a raw SQL SELECT against the database. Results are merged into the payload. | `query` (parameterised with `{{variable}}`) | Columns from the result row merged into payload |
| `run_workflow` _(promoted)_ | Fires another workflow definition synchronously (within max-depth limit). | `definitionId`, extra payload fields | Output of the target workflow |
| `emit_event` _(promoted as dedicated node)_ | Emits a named event to the workflow event bus. Can chain workflows. | `eventName`, `extraPayload` (JSON) | Broadcasts event; no direct output |
| `cancel_workflow` _(promoted)_ | Cancels the current workflow run. | — | `{ cancelled: true }` |
| `create_marketing_campaign` | Creates a new marketing campaign record. | `nameExpr`, `campaignType` | `{ campaignId, campaignName, campaignStatus }` |
| `publish_landing_page` | Publishes a landing page draft to live. | `landingPageId` / `slugExpr` | `{ landingPageId, slug, published }` |
| `generate_landing_page` | AI-generates a full landing page for a campaign. | `campaignBrief`, `targetAudience`, `service` | `{ landingPageId, slug, headline, subheadline, published }` |

### Promoted Action Types (Shorthand)

The following node `type` values are first-class aliases for the generic `action` node with a matching `actionType`. They behave identically to their `action` counterpart but can be placed directly in the graph:

```
http_request, sql_query, send_email, send_sms, emit_event,
cancel_workflow, create_lead, convert_to_opportunity, create_client,
create_project, update_m365_profile, execute_runbook, generate_document,
calculate_pricing, run_workflow
```

---

## 12. Workflow Triggers Reference

### Trigger Types

| Type | Configured By | Description |
|---|---|---|
| `event` | `eventName` string | Subscribes to a named system event. Fires whenever `broadcastAdminWorkflowEvent(name, payload)` is called with a matching event name. |
| `schedule` | 5-field CRON (`minute hour day month weekday`) | Fires at the computed next run time. `computeNextCronRun(cron)` calculates the next UTC datetime. |
| `startup` | (no config) | Fires once per server boot, used for orphan recovery and one-time init tasks. |
| `manual` | — | Triggered by clicking "Run Now" in the UI (`POST /api/admin/workflows/definitions/:id/run`). Supports `ask_for_input` fields pre-collected via a modal. |
| `webhook` | Auto-generated token | Triggered by `POST /api/webhooks/workflow/:token`. The token is generated by the server and stored in `wf_triggers.config.token`. |
| `per_record` fan-out | Schedule trigger config | When a schedule trigger has `perRecord: true`, a separate run is created for each matching record (e.g., one run per active client). |
| `batched` | Schedule trigger config | Default behaviour: one single run per schedule fire, payload contains aggregate data. |

### Built-in System Schedules

| Workflow Name | CRON | UTC Time | Purpose |
|---|---|---|---|
| Weekly Article Generator | `0 9 * * 1` | Monday 09:00 | Generates and saves a new M365 article as a draft |
| `__system__: Workflow Cleanup` | `0 3 * * *` | Daily 03:00 | Deletes workflow runs older than 90 days |
| `__system__: Escalation Check` | `0 8 * * *` | Daily 08:00 | Flags manual script cards stalled in "Waiting on Customer" |
| `__system__: Monthly Insights` | `0 9 1 * *` | 1st of month 09:00 | Runs all enabled insights automations for active engagements |

### Built-in Startup Workflows

| Workflow Name | Trigger | Purpose |
|---|---|---|
| `__system__: Orphan Reconciliation` | `startup` | Recovers kanban cards orphaned by a mid-run server restart; detects stalled phases |
| `__system__: Kanban Auto-fire` | `event: kanban.card_moved` | Auto-fires Azure runbook scripts and document generation when a kanban card moves columns |

### `emit_event` Node (Workflow Chaining)

The `emit_event` node (and the promoted `emit_event` action type) broadcasts a named event on the internal event bus. Any other workflow with a matching event trigger will fire. This enables **workflow-to-workflow chaining** without direct coupling.

Example: a phase completion workflow calls `emit_event { eventName: "sow.generation_retried" }` to notify monitoring workflows without knowing which ones exist.

---

## 13. Workflow Events Catalog

Events are emitted by server code and workflow nodes. Any workflow with a matching event trigger will fire. Payload fields marked with `?` are optional.

### Presentation & SOW Events

| Event Name | Emitted By | Typical Payload Fields | Common Use |
|---|---|---|---|
| `presentation.phases_requested` | Client advances past SOW step in the portal | `projectTitle`, `totalPrice`, `selectedPhases`, `sowHtml`, `presentationId`, `clientName` | Fire Phase Generator workflow to produce AI-proposed project phases |
| `sow.generate` | Server when a presentation enters `pending_sow` state | `clientUserId`, `projectId`, `title`, `presentationId` | Trigger SOW Generation workflow |
| `sow.generation_stalled` | Portal client after 2 minutes on `pending_sow` with no document | `projectId`, `presentationId`, `customerId` | Trigger SOW Generation Auto-Retry |
| `sow.generation_retried` | SOW Auto-Retry workflow on successful retry | `presentationId` | Audit trail; can chain to notification workflows |
| `sow.scope_reduced` | Server when a client deselects phases and regenerates a lower-value SOW | `presentationId`, `projectId`, `clientUserId`, `previousTotal`, `newTotal` | Re-engagement automations (disabled by default) |
| `document.generated` | Server after a document is saved successfully | `documentId`, `docType`, `category`, `clientId`, `projectId?` | Notify admin, chain to PDF generation or SharePoint upload |

### Agreement & Payment Events

| Event Name | Emitted By | Typical Payload Fields | Common Use |
|---|---|---|---|
| `agreement_signed` | Server on contract signature | `presentationId`, `projectId`, `clientEmail`, `clientName`, `paymentPlan`, `stripeSessionId`, `contractId` | Create phased Stripe invoices; send welcome email; provision project |
| `contract.signed` | Alias — same flow as `agreement_signed` | Same as above | Interchangeable |
| `payment.received` | Stripe webhook handler (`processStripeEvent`) | `sessionId`, `customerId`, `amountTotal`, `serviceType`, `clientEmail` | Send SMS alert, create client account, send welcome email |
| `onboarding.complete` | Portal when onboarding wizard is submitted | `clientId`, `projectId?` | Trigger project provisioning or kickoff workflow |

### Phase & Project Events

| Event Name | Emitted By | Typical Payload Fields | Common Use |
|---|---|---|---|
| `phase_completed` | Admin marks a project phase complete | `projectId`, `phaseId`, `clientName`, `stripeInvoiceId?`, `paymentPlan` | Auto-charge phased invoice; update project status |
| `phase.delivery_date_changed` | Admin updates a phase delivery date | `projectId`, `phaseId`, `newDueDate`, `paymentPlan`, `stripeInvoiceId?` | Sync Stripe invoice due date |
| `milestone.delivery_date_changed` | Admin updates a milestone date | `projectId`, `milestoneId`, `newDueDate` | Calendar event update; notification |
| `project.created` | `create_project` node or admin API | `projectId`, `projectTitle`, `clientUserId` | Provision SharePoint site; send kickoff email |
| `project.phase_changed` | Admin changes project phase/status | `projectId`, `fromPhase`, `toPhase` | Status report generation; client notification |

### CRM & Lead Events

| Event Name | Emitted By | Typical Payload Fields | Common Use |
|---|---|---|---|
| `lead.qualified` | Lead scoring workflow after threshold met | `leadId`, `leadEmail`, `leadName`, `score`, `scoreLabel` | Convert to opportunity; send notification |
| `opportunity.created` | `convert_to_opportunity` node | `opportunityId`, `leadId` | Trigger discovery call booking workflow |
| `client.created` | `create_client` node or purchase flow | `clientId`, `clientEmail`, `clientName` | Send account setup email |
| `quiz.lead_submitted` | Portal quiz submission endpoint | `quizLeadId`, `leadEmail`, `leadName`, `totalScore`, `tier`, `recommendedService` | Score lead; trigger re-engagement workflow |

### M365 & Azure Events

| Event Name | Emitted By | Typical Payload Fields | Common Use |
|---|---|---|---|
| `m365.health_check_complete` | Azure Automation runbook result handler | `clientId`, `jobId`, `scores`, `findings[]`, `recommendations[]` | Update intelligence tables; generate diff report |
| `m365.diagnostic_failed` | Azure runbook failure handler | `clientId`, `jobId`, `errorMessage` | Admin alert; retry logic |
| `customer.script_result` | Script result received from runbook | `clientId`, `jobId`, `scriptTitle`, `category`, `scoreImpact` | Update M365 profile; notify admin |
| `quick_wins_selector_result` | Quick Wins selector UI action | `clientId`, `selectedWins[]`, `totalValue` | Generate SOW for selected quick wins |

### Kanban Events

| Event Name | Emitted By | Typical Payload Fields | Common Use |
|---|---|---|---|
| `kanban.card_moved` | Admin moves a kanban card | `cardId`, `boardId`, `fromColumn`, `toColumn`, `clientId?`, `phaseId?` | Auto-fire Azure runbook for client delivery cards; trigger phase automations |

---

## 14. Notification & Push System

### 14.1 In-App Notification Drawer

The bell icon in the top header opens a slide-out `NotificationDrawer`. Notifications are stored in the `notifications` DB table.

- **Unread badge:** red count badge on the bell, updated by polling the notification count endpoint.
- **Mark as read:** clicking a notification or clicking "Mark all read".
- **Navigation:** notifications with a `linkPath` navigate to that admin panel path when clicked.

### 14.2 Browser Web Push (VAPID)

Delivers OS-level notifications even when the Admin Panel tab is closed (as long as the browser is running).

**Setup:**
1. Generate VAPID keys: `node -e "const wp=require('web-push'); console.log(wp.generateVAPIDKeys())"`
2. Set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in Replit Secrets.
3. Admin subscribes their browser from the notification settings panel; the subscription is stored in `device_tokens` with `platform = "web"`.

**Server helper:** `sendWebPushToAdmins(payload)` in `artifacts/api-server/src/lib/web-push.ts` — sends to all admin web subscriptions. Silently skipped (with a warning log) if VAPID secrets are missing.

**Service worker** (`artifacts/admin-panel/public/sw.js`):
- Handles `push` event — shows an OS notification with title, body, icon, badge.
- `soundPayload` in the push message: broadcasts `PLAY_WORKFLOW_SOUND` to all open admin panel windows via `clients.postMessage`.
- `playSound: true` (legacy purchase alert): broadcasts `PLAY_PURCHASE_SOUND`.
- `notificationclick` event: focuses existing admin panel tab or opens a new one, then sends `NAVIGATE` postMessage if `linkPath` is set.

### 14.3 Mobile Push (Expo)

Admin mobile app push notifications via Expo Push Service.

**Server helper:** `sendPushNotifications(tokens, payload)` — sends to all Expo push tokens stored in `device_tokens` with `platform = "expo"`.

**Workflow node:** `send_mobile_push` sends to all enrolled admin device tokens simultaneously.

### 14.4 SMS Alerts (Twilio)

One-directional SMS to Shane's phone for high-priority alerts (e.g. Stripe payment received).

**Server helper:** `sendAdminSms(body)` in `artifacts/api-server/src/lib/sms.ts`.

**Required secrets:**

| Secret | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | From [console.twilio.com](https://console.twilio.com) |
| `TWILIO_AUTH_TOKEN` | From Twilio Console |
| `TWILIO_FROM_NUMBER` | Your Twilio number in E.164 format (e.g. `+12025551234`) |
| `SHANE_PHONE_NUMBER` | Destination number in E.164 format |

Silently no-ops (warning logged) if any secret is missing.

**Hooked into:** `processStripeEvent` in `portal.ts` for both `service_purchase` and `onboarding_purchase` event types.

**Workflow node:** `send_sms` calls `sendAdminSms` with the interpolated `body` field.

### 14.5 Sound Alerts

Purchase sounds and workflow sounds play in the browser tab.

- **Purchase sound:** triggered by `usePurchaseSound` hook (listens for `PLAY_PURCHASE_SOUND` postMessages from the service worker).
- **Workflow sound:** triggered by the `play_sound` node; `target = "browser"` sends an SSE event to open admin tabs; `target = "desktop"` uses Web Push → service worker → `PLAY_WORKFLOW_SOUND` postMessage.
- **Mute toggle:** the speaker icon in the top header mutes / unmutes all sounds. State is stored in component (not persisted across sessions).

---

## 15. Azure Automation Integration

### 15.1 Required Secrets

All 7 secrets must be set in Replit Secrets to enable the Script Runner and runbook execution:

| Secret | Description |
|---|---|
| `AZURE_CLIENT_ID` | App Registration (service principal) client ID |
| `AZURE_CLIENT_SECRET` | App Registration client secret |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_KEY_VAULT_URL` | Full Key Vault URL (e.g. `https://my-vault.vault.azure.net`) |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription containing the Automation account |
| `AZURE_AUTOMATION_RESOURCE_GROUP` | Resource group of the Automation account |
| `AZURE_AUTOMATION_ACCOUNT_NAME` | Name of the Automation account |

**Required permissions for the service principal:**
- **Key Vault Secrets User** + **Key Vault Certificates User** on the vault.
- **Automation Operator** on the Automation account.

### 15.2 Key Vault Credential Storage

Customer-specific credentials (e.g. tenant IDs, admin usernames) are stored in Azure Key Vault by name, never in the database. The API server retrieves them at runbook execution time. This means no sensitive customer data is ever stored in the Replit PostgreSQL DB.

### 15.3 Runbook Execution Flow

1. Admin clicks "Run Script" or a workflow reaches an `execute_runbook` node.
2. `createRunbookJob({ runbookName, parameters })` in `artifacts/api-server/src/lib/azure-automation.ts` authenticates with Azure AD using the service principal.
3. Job is submitted to Azure Automation via the ARM REST API.
4. The job ID is stored in the `script_run_results` table.
5. Result polling: the server checks job status via ARM API; when complete, output streams are fetched.
6. Results (findings, recommendations, profile updates, score impact) are stored in `script_run_results`.
7. The `customer.script_result` event is emitted, which may trigger intelligence table updates and M365 profile refresh.

### 15.4 Script Library & `Workflow Generated` Category

Scripts in the Script Library (visible in the M365 Scripts section of the Command Workspace) are categorised:

| Category | Source |
|---|---|
| Core Assessment | Seeded / manually uploaded runbooks |
| Client Specific | Runbooks generated for a specific client |
| **Workflow Generated** | Scripts produced by the `generate_script` workflow node |

The `generate_script` node calls `generateScriptFromService` or `generateScriptFromDocument` (in `ps-script-gen.ts`) to produce the PowerShell content, then uploads it to Azure Automation using a **raw fetch with bearer token** (not the ARM SDK). This bypass is necessary because the ARM SDK treats `runbookDraft.replaceContent` as a long-running operation (LRO) and attempts to JSON-parse the PowerShell script body, causing a crash.

---

## 16. Google Search Console Integration

### 16.1 Required Secrets

| Secret | Description |
|---|---|
| `GOOGLE_SEARCH_CONSOLE_KEY_JSON` | Full contents of the Google service account JSON key file. The service account must have **Full** permission on the site in Google Search Console. |
| `GOOGLE_SEARCH_CONSOLE_SITE_URL` | Exact site URL as registered in Search Console (e.g. `https://shanemccawconsulting.com/` — include the trailing slash). |

### 16.2 SEO Rankings Sync

Located in the Marketing Command Center section (`/command/marketing` → Marketing → SEO Rankings).

**"Sync Search Console" action:**
1. Calls `GET /api/admin/seo/sync-search-console`.
2. Server authenticates using the service account JSON key.
3. Fetches keyword performance data from the Search Console API.
4. Upserts keyword ranking records into the `seo_keywords` table.
5. Returns updated rankings to the UI.

**Fallback:** If either secret is missing, clicking "Sync Search Console" displays a clear error message in the card (no crash). Manual keyword entry is always available as a fallback.

**Rankings display:** Keyword position, clicks, impressions, CTR, and trend vs. previous period. Sortable and filterable.

---

*End of Admin Panel Reference Documentation.*
