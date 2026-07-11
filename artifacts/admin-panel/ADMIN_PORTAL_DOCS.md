# Admin Portal — Feature Reference

**Artifact:** `artifacts/admin-panel` · **Preview path:** `/admin-panel/`

**Authentication model:**
- On load, `AuthProvider` calls `POST /api/auth/refresh` with `credentials: "include"` (HTTP-only refresh cookie) to silently restore the session.
- The access token returned from login or refresh is held entirely in **React in-memory state** (`useState` + `useRef`) — it is never written to `localStorage` or `sessionStorage`.
- All API calls use `Authorization: Bearer <access-token>` header. On a `401`, `fetchWithAuth` automatically calls refresh and retries once before forcing logout.
- `sessionStorage` is used only for `adminReturnTo` — the URL the user tried to visit before being redirected to login.

**Login page:** `/admin-panel/login` — Email + Password form. On success, redirects to the stored `adminReturnTo` destination or falls back to `/overview`.

---

## Complete Route Inventory

All routes declared in `src/App.tsx`. Every route requires `RequireAdmin` except `/login` and `/`.

| Route | Component | Notes |
|---|---|---|
| `/login` | `LoginPage` | Public — shows login form; if already authenticated redirects to `/overview` |
| `/` | — | Redirect: admin → `/overview`, unauthenticated → `/login` |
| `/overview` | `OverviewPage` | Dashboard command centre |
| `/analytics` | `AnalyticsPage` | First-party traffic analytics |
| `/articles` | `ArticlesPage` | Blog article management |
| `/services` | `ServicesPage` | Service offering management |
| `/workflows` | `WorkflowsPage` | Workflow template builder |
| `/contract-templates` | `ContractTemplatesPage` | Per-service contract body editor |
| `/engagement-projects` | `EngagementProjectsPage` | Service-page project templates |
| `/email-templates` | `EmailTemplatesPage` | Transactional email template editor |
| `/coupons` | `CouponsPage` | Stripe coupon management |
| `/service-page-triggers` | `ServicePageTriggersPage` | Service-page keyword trigger config |
| `/script-runner` | `ScriptRunnerPage` | Azure script executor |
| `/crm/leads` | `LeadsPage` | Lead list |
| `/crm/leads/:id` | `LeadDetailPage` | Lead detail and AI scoring |
| `/crm/clients` | `ClientsPage` | Client list |
| `/crm/clients/:id` | `ClientDetailPage` | Client 360° detail |
| `/crm/projects` | `ProjectsPage` | Project list |
| `/crm/projects/:id` | `ProjectDetailPage` | Project Kanban + status reports |
| `/crm/opportunities` | `OpportunitiesPage` | Opportunity pipeline |
| `/crm/opportunities/:id` | `OpportunityDetailPage` | Opportunity detail |
| `/crm/quiz-leads` | `QuizLeadsPage` | Quiz submission inbox |
| `/crm/m365-intelligence` | `M365IntelligencePage` | Copilot readiness dashboard |
| `/crm/quiz-pain-config` | `QuizPainConfigPage` | Signal mapping config |
| `/crm/invoices` | `InvoicesPage` | Manual invoice management |
| `/crm/purchases` | `PurchasesPage` | Stripe self-service purchase list |
| `/crm/purchases/:id` | `PurchaseDetailPage` | Purchase detail (read-only) |
| `/crm/contracts` | `ContractsPage` | Signed contract log |
| `/crm/messages` | `MessagesPage` | Portal messaging (Shane ↔ client) |
| `/crm/reports` | `ReportsPage` | Admin-uploaded client reports |
| `/crm/documents` | `DocumentsPage` | Cross-project document repository |
| `/crm/status-reports` | `StatusReportsPage` | Status report list (all projects) |
| `/crm/testimonials` | `TestimonialsPage` | Signed project closures |
| `/inbox` | `InboxPage` | M365 email client (Microsoft Graph) |
| `/email-activity` | — | **Legacy redirect → `/inbox`** |
| `/activity-log` | `ActivityLogPage` | Admin audit trail |
| `/sharepoint` | `SharePointPage` | SharePoint hub browser |
| `/templates/library` | `TemplateLibraryPage` | SharePoint template library |
| `/asset-library/instruction-sets` | `InstructionSetsPage` | Asset library — instruction sets |
| `/asset-library/checklists` | `ChecklistsPage` | Asset library — checklists |
| `/asset-library/artifact-sets` | `ArtifactSetsPage` | Asset library — artifact sets |
| `/asset-library/deliverable-sets` | `DeliverableSetsPage` | Asset library — deliverable sets |
| `/asset-library/categories` | `CategoriesPage` | Asset library — category manager |
| `/security` | `AdminSecurity` | MFA enrollment (passkeys + TOTP) |
| `*` (catch-all) | — | Redirect to `/login` |

---

## Table of Contents

1. [Global Shell (DashboardShell)](#1-global-shell)
2. [Command Group](#2-command-group)
   - [Overview (`/overview`)](#21-overview)
   - [Messages (`/crm/messages`)](#22-messages)
   - [Projects (`/crm/projects`)](#23-projects)
   - [Script Runner (`/script-runner`)](#24-script-runner)
   - [Analytics (`/analytics`)](#25-analytics)
3. [Clients Group](#3-clients-group)
   - [Clients (`/crm/clients`)](#31-clients)
   - [Client Detail (`/crm/clients/:id`)](#32-client-detail)
   - [Leads (`/crm/leads`)](#33-leads)
   - [Lead Detail (`/crm/leads/:id`)](#34-lead-detail)
   - [Opportunities (`/crm/opportunities`)](#35-opportunities)
   - [Quiz Leads (`/crm/quiz-leads`)](#36-quiz-leads)
   - [M365 Intelligence (`/crm/m365-intelligence`)](#37-m365-intelligence)
4. [Finance Group](#4-finance-group)
   - [Invoices (`/crm/invoices`)](#41-invoices)
   - [Purchases (`/crm/purchases`)](#42-purchases)
   - [Contracts (`/crm/contracts`)](#43-contracts)
   - [Coupons (`/coupons`)](#44-coupons)
5. [Content Group](#5-content-group)
   - [Articles (`/articles`)](#51-articles)
   - [Services (`/services`)](#52-services)
   - [Service Triggers (`/service-page-triggers`)](#53-service-triggers)
   - [Engagement Projects (`/engagement-projects`)](#54-engagement-projects)
   - [Email Templates (`/email-templates`)](#55-email-templates)
   - [Contract Templates (`/contract-templates`)](#56-contract-templates)
6. [System Group](#6-system-group)
   - [Signal Mappings (`/crm/quiz-pain-config`)](#61-signal-mappings)
   - [Hub Storage / SharePoint (`/sharepoint`)](#62-hub-storage--sharepoint)
   - [Inbox (`/inbox`)](#63-inbox)
   - [Activity Log (`/activity-log`)](#64-activity-log)
   - [Workflows (`/workflows`)](#65-workflows)
   - [Template Library (`/templates/library`)](#66-template-library)
   - [Asset Library (`/asset-library/*`)](#67-asset-library)
   - [Security (`/security`)](#68-security)
7. [Additional Detail Routes](#7-additional-detail-routes)
   - [Project Detail (`/crm/projects/:id`)](#71-project-detail)
   - [Reports (`/crm/reports`)](#72-reports)
   - [Documents (`/crm/documents`)](#73-documents)
   - [Status Reports (`/crm/status-reports`)](#74-status-reports)
   - [Testimonials (`/crm/testimonials`)](#75-testimonials)
   - [Opportunity Detail (`/crm/opportunities/:id`)](#76-opportunity-detail)
   - [Purchase Detail (`/crm/purchases/:id`)](#77-purchase-detail)
8. [Dialogs & Modals](#8-dialogs--modals)
   - [Qualification Modal](#81-qualification-modal)
   - [Generate Assets Dialog](#82-generate-assets-dialog)
   - [JSON Import Modal](#83-json-import-modal)
   - [M365 Profile Wizard](#84-m365-profile-wizard)
9. [Public & Redirect Routes](#9-public--redirect-routes)
   - [Login (`/login`)](#91-login)
   - [Root Redirect (`/`)](#92-root-redirect)
   - [Legacy Redirect (`/email-activity`)](#93-legacy-redirect-email-activity)
   - [Catch-all (`*`)](#94-catch-all)
10. [Route Traceability Checklist](#10-route-traceability-checklist)

---

## 1. Global Shell

**Component:** `src/components/DashboardShell.tsx`

The `DashboardShell` wraps every authenticated page. It renders a collapsible sidebar on the left and a fixed top header bar.

> **Security page exception:** `/security` is wrapped by `RequireAdmin` in `App.tsx` without an outer `DashboardShell`, but `AdminSecurity.tsx` itself renders `<DashboardShell>` as its root element, so the full sidebar and header still appear.

### 1.1 Sidebar

| Element | Description |
|---|---|
| **Collapse / Expand toggle** | Icon-only button at the top of the sidebar. Collapses the nav to icon-only mode (tooltips appear on hover). State persists to `localStorage` key `admin_sidebar_collapsed`. |
| **Group header chevrons** | Each of the five nav groups has a collapse chevron. Clicking it hides/shows all items in that group. State persists to `localStorage` key `admin_collapsed_groups`. |
| **Inbox badge** | A red numeric pill on the "Inbox" nav item and on the group header when the sidebar is collapsed. Shows the count of unread M365 emails polled via `EmailBadgeContext`. Capped at `99+`. |
| **Active item highlight** | The current page item is highlighted with a blue background and blue text (`bg-[#0078D4]/15 text-[#58A6FF]`). |

#### Nav Groups and Items

| Group | Item | Route |
|---|---|---|
| **Command** | Overview | `/overview` |
| | Messages | `/crm/messages` |
| | Projects | `/crm/projects` |
| | Script Runner | `/script-runner` |
| | Analytics | `/analytics` |
| **Clients** | Clients | `/crm/clients` |
| | Leads | `/crm/leads` |
| | Opportunities | `/crm/opportunities` |
| | Quiz Leads | `/crm/quiz-leads` |
| | M365 Intelligence | `/crm/m365-intelligence` |
| **Finance** | Invoices | `/crm/invoices` |
| | Purchases | `/crm/purchases` |
| | Contracts | `/crm/contracts` |
| | Coupons | `/coupons` |
| **Content** | Articles | `/articles` |
| | Services | `/services` |
| | Service Triggers | `/service-page-triggers` |
| | Engagement Projects | `/engagement-projects` |
| | Email Templates | `/email-templates` |
| | Contract Templates | `/contract-templates` |
| **System** | Signal Mappings | `/crm/quiz-pain-config` |
| | Hub Storage | `/sharepoint` |
| | Inbox | `/inbox` |
| | Activity Log | `/activity-log` |
| | Workflows | `/workflows` |
| | Template Library | `/templates/library` |
| | Asset Library | `/asset-library/instruction-sets` |
| | Security | `/security` |

### 1.2 Top Header Bar

| Element | Description |
|---|---|
| **Hamburger toggle** (mobile) | Visible only on small screens (`lg:hidden`). Opens the sidebar as an overlay drawer. |
| **Breadcrumb** (desktop) | Shows `Group › Page` derived from the current URL, e.g. `Command › Overview`. Falls back to "Admin Panel" for unknown routes. |
| **Global search** | A read-only input showing `⌘K` shortcut hint. Placeholder "Search…". Currently decorative — triggers command palette when implemented. |
| **Notification bell** | Links to `/inbox`. Shows a red badge with unread email count (capped at `99+`). |
| **Identity chip** | Displays avatar initial, name **"Shane McCaw"**, and role **"Administrator"**. |
| **Sign Out button** | Calls `logout()` from `AuthContext`, clearing the JWT and redirecting to `/login`. |

---

## 2. Command Group

### 2.1 Overview

**Route:** `/overview` · **Component:** `src/pages/Overview.tsx`

The command centre for the entire business. Loads multiple data sections in parallel.

#### KPI Cards (top ribbon)

| Card | Metric | Trend indicator |
|---|---|---|
| Revenue MTD | Current month total (invoices + purchases) | vs previous month % badge |
| Revenue YTD | Year-to-date total | — |
| MRR | Monthly recurring revenue | — |
| ARR | Annual recurring revenue | — |
| Active Clients | Total client count | — |
| Open Leads | Leads not yet converted or archived | — |
| Pipeline Velocity | Avg. deal size × qualified-to-won conversion | — |

#### AI Insights Panel

| Element | Description |
|---|---|
| **Panel header** | "AI Insights" title with subtitle "Claude-generated · live pipeline, health & project data". |
| **Refresh button** | Re-calls the AI endpoint; spinner animates during generation. Disabled while loading. |
| **Insight cards (×4)** | Claude-generated narrative cards, each showing: icon, title, narrative paragraph, and a key metric pill. Color-coded by index (blue, purple, emerald, amber). |
| **Expand/collapse** | Individual cards show full narrative inline; no separate expand toggle — all text is visible. |

#### Revenue Trends Section

| Chart | Description |
|---|---|
| **Monthly Revenue** (line chart) | Trailing 12-month total revenue (one-time + recurring) per month. Recharts `LineChart`. Shows MTD, YTD, and peak-month callout. AI callout compares MTD vs 12-month avg with colour-coded phrasing. |
| **Invoice Revenue by Service Type** (horizontal bar chart) | Paid invoice revenue attributed to each service. Shows MRR and ARR below. AI callout flags concentration risk if top service > 60%. |

#### Pipeline & Lead Funnel

| Element | Description |
|---|---|
| **Stage funnel** | Five stage bars (Lead / Qualified / Proposal / Negotiation / Won) with colour-coded counts. |
| **Velocity Trend** (area chart) | Monthly qualified vs total leads. |
| **"View All" links** | Quick links to `/crm/leads`, `/crm/clients`, and `/crm/projects`. |

#### Project & Task Section

| Element | Description |
|---|---|
| **Engagement Burndown** (area chart) | Completed vs remaining tasks over time. |
| **Weekly Task Completion** (bar chart) | Last 7 weeks of completed tasks. |
| **Active Projects list** | Cards showing project title, client, status badge, phase, and progress bar. |
| **Task stats** | Completed this week, created this week, overdue project count, avg duration, velocity score, avg progress. |

#### Client Health Heatmap

Radar-style grid with rows per client and columns for 8 M365 health categories: Governance, Security, Compliance, Copilot, Power Platform, Sharing Risk, Shadow IT, Identity. Each cell is coloured green (≥70), amber (40–69), or red (<40) based on the stored score.

#### Recent Activity Log

Timestamped feed of recent events (leads, purchases, messages, projects, runbooks, tasks, assessments, workflows). Each entry shows a colour-coded icon, title, and relative timestamp. Events with `linkPath` are clickable.

#### Database Status Panel

Shows migration status for dev and prod databases: applied count, last applied tag, and pending migration count. Shown at the bottom of the overview for operational awareness.

#### Expiring Credentials Panel

Lists any client Azure credentials expiring within 30 days, linking to the relevant client detail page.

---

### 2.2 Messages

**Route:** `/crm/messages` · **Component:** `src/pages/crm/Messages.tsx`

An internal messaging thread between Shane and individual clients (portal messages, not email).

| Element | Description |
|---|---|
| **Client list** (left pane) | All clients who have sent at least one message, sorted by most recent. Shows name/email, last message **date** (`toLocaleDateString()`), and **unread badge** (red pill). Clicking a row opens that client's thread. |
| **Message thread** (right pane) | Chronological message bubbles. Shane's messages appear on the right; client messages on the left. |
| **Reply input** | Single-line `<input>` at the bottom of the thread with placeholder "Type a message…". |
| **Send button** | Submits the reply via `POST /api/portal/messages`. Disabled while sending. |
| **Auto-refresh** | Thread polls every 8 seconds while a client is selected. |

> **Note:** This page handles portal messages only. For full M365 email, see [Inbox](#63-inbox).

---

### 2.3 Projects

**Route:** `/crm/projects` · **Component:** `src/pages/crm/Projects.tsx`

List view of all client projects across all engagement types.

| Element | Description |
|---|---|
| **Project list table** | Columns: Title, Client, Status badge, Phase, Progress bar (0–100 %), Type, Start/End dates, Created date. Clicking a row navigates to `/crm/projects/:id`. |
| **Create Project button** | Opens an inline form with fields: Title, Client (dropdown), Project Type (project / retainer), Start Date, End Date, Workflow Template (optional dropdown of available templates). Submits via `POST /api/admin/projects`. |
| **Status badges** | `active` (blue), `on_hold` (amber), `completed` (green). |
| **Delete button** (per row) | Triggers an `AlertDialog` confirmation before deleting via `DELETE /api/admin/projects/:id`. |

---

### 2.4 Script Runner

**Route:** `/script-runner` · **Component:** `src/pages/ScriptRunner.tsx`

Executes Azure scripts against client tenants directly from the admin panel.

#### Configuration Panel (left column)

| Element | Description |
|---|---|
| **Customer dropdown** | Lists registered Azure credentials (client tenants). Select one to load that tenant's scripts. |
| **Script dropdown** | Populated from Azure after a customer is selected. Shows script name; description appears below when selected. Disabled until a customer is chosen. |
| **Governance Areas picker** | `GovernanceAreasPicker` component — optional multi-select of governance focus areas passed as parameters to the runbook (e.g. Security, Compliance). When left empty, the runbook uses its own defaults. |
| **Run Runbook button** | Disabled until both customer and runbook are selected (and governance areas valid). Sends `POST /api/admin/runbook-jobs`. Shows animated spinner while running. |
| **Customers sidebar** | Below the form, lists all registered credentials with credential type. Includes a "Manage in CRM →" link to `/crm/clients` and per-row link to the client's detail page. |

#### Live Output Panel (right two-thirds)

| Element | Description |
|---|---|
| **Live Output / Replayed Output** | Header label switches based on whether output is live or replayed from history. |
| **Status badge** | Shows current job state: Never run / New / Activating / Running / Completed / Failed / Stopped / Suspended. |
| **Log console** | Scrollable dark terminal pane. Lines stream in real-time via 3-second polling of `/api/admin/runbook-jobs/output`. Auto-scrolls to bottom on each new line. |
| **Analyze with AI button** | Active after a job completes. Sends the full log output to `/api/admin/scripts/analyze` and renders the AI analysis. |
| **AI Analysis tabs** | Four tabs: Summary / Risks / Recommendations / Next Steps. Each tab shows the corresponding section of the Claude-generated analysis. |
| **Job History table** | Below the output panel. Lists past 50 jobs: runbook name, customer, status, duration, started time. Each row has a **Replay** button to load that job's output into the console panel. |

#### Azure Not Configured Banner

When the Azure secrets are absent, an amber warning panel lists the required secrets (`AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_KEY_VAULT_URL`) with descriptions and the required RBAC roles.

---

### 2.5 Analytics

**Route:** `/analytics` · **Component:** `src/pages/Analytics.tsx`

First-party traffic analytics for the Shane McCaw Consulting public website.

#### Range Selector

| Control | Description |
|---|---|
| **Preset buttons** | Today / 7d / 30d / 90d. Active preset is highlighted blue. Changing preset triggers immediate data reload. |
| **Custom button** | Switches to custom date-range mode. Pre-fills start to 30 days ago and end to today. |
| **Start date / End date inputs** | `<input type="date">` fields shown when Custom is active. Start is capped at End; End is capped at today. |
| **Apply button** | Loads data for the custom date range. Disabled if either date is empty. |
| **Live badge** | Green pulsing dot with "N live now" count, polled every 30 seconds from `/api/admin/analytics/live`. |

#### KPI Ribbon

Four cards: **Unique Visitors**, **Page Views**, **Avg. Time on Page**, **Bounce Rate** (red if > 70 %).

#### Charts & Tables

| Section | Description |
|---|---|
| **Page Views Over Time** (line chart) | Daily page views for the selected range. Empty state shown if no data. |
| **Top Pages** (sortable table) | Columns: Page, Views, Avg Time, Bounce Rate. Click any column header to sort ascending/descending. |
| **Traffic Sources** (progress bar list) | Shows referrer source, session count, and percentage share with a horizontal bar. |
| **CTA & Click Events** | Grouped by event type (CTA Click, Nav Click, Outbound, Form Submit, Scroll). Shows top 5 labels per type with counts. |
| **Outbound Link Clicks** | Table of external URLs clicked, with label and count. Href is sanitised — only `http(s)://` links are rendered as actual anchors. |
| **CTA Performance** (sortable table) | Columns: CTA label, Page, Clicks, Views, CTR %. Sortable. |

---

## 3. Clients Group

### 3.1 Clients

**Route:** `/crm/clients` · **Component:** `src/pages/crm/Clients.tsx`

Master list of all client accounts.

| Element | Description |
|---|---|
| **Search input** | "Search clients…" — filters by name, email, or company client-side. |
| **New Client button** | Opens a slide-in form with fields: Name, Email, Phone, Company. Submits via `POST /api/admin/clients`. |
| **Export CSV button** | Downloads all clients as a CSV file. |
| **Client rows** | Each row shows: Name/Email, Company, Quiz Score badge, Quiz Tier badge, AI Risk Level, AI Opportunity Level, active project count, last activity date, SharePoint site indicator. Clicking navigates to `/crm/clients/:id`. |
| **M365 Profile Wizard button** (per row) | Opens the [M365 Profile Wizard](#84-m365-profile-wizard) dialog for that client. |
| **Delete button** (per row) | Shows a preview dialog listing how many projects, invoices, contracts, messages, and services will be affected. Warns if there is an active Stripe subscription. Requires confirmation before deletion. |
| **Unread email badge** | The client row shows an unread message count if there are linked unread M365 emails. Clicking the badge opens an assign-email picker. |

---

### 3.2 Client Detail

**Route:** `/crm/clients/:id` · **Component:** `src/pages/crm/ClientDetail.tsx`

Full 360° view of a single client.

#### Header

Client name, email, company, and avatar initial. Links back to `/crm/clients`.

#### Edit Fields

| Field | Description |
|---|---|
| Name | Text input — client display name. |
| Email | Text input — primary email. |
| Phone | Text input — phone number. |
| Company | Text input — company name. |
| Address, City, State | Text inputs for postal address. |
| **Save button** | Persists changes via `PUT /api/admin/clients/:id`. |

#### Tabs

| Tab | Content |
|---|---|
| **Overview** | Summary cards: active projects, open tasks, total projects, quiz score. Recent tasks list (status, priority, due date) and recent emails (subject, sender, preview). |
| **Projects** | Project cards with title, status badge, phase, progress bar, type, dates, and task counts. **Create Project** button opens an inline form. |
| **M365 Profile** | Displays the client's stored M365 intelligence profile (license SKUs, security settings, Copilot readiness, etc.). **Edit M365 Profile** button opens the [M365 Profile Wizard](#84-m365-profile-wizard). |
| **Azure Credentials** | Lists the client's registered Azure credential entries (used by Script Runner). Each entry shows display name, credential type, Key Vault secret name. **Add Credential** form with: Display Name, Tenant ID, Client ID, Credential Type (secret / certificate), Key Vault Secret Name. |
| **Quiz History** | All quiz submissions linked to this client. Shows score, tier, quiz type, category score breakdown, and AI "What This Means" text. |

#### M365 Link button

Opens the client's SharePoint site or M365 admin profile in a new tab if `sharepointSiteUrl` is set.

---

### 3.3 Leads

**Route:** `/crm/leads` · **Component:** `src/pages/crm/Leads.tsx`

Inbound leads from the contact form and lead magnets on the consulting website.

#### Stat Cards (top)

Total leads · New this week · From contact form · From lead magnet.

#### Filters

There is **no search input** on this page. Filtering is done entirely through the tab bar and source dropdown.

| Control | Description |
|---|---|
| **Status tab bar** | Pill-button tabs: All · New · Contacted · Qualified · Converted · Archived. Clicking a tab refetches the list filtered by that status. Active tab highlighted in Electric Blue. |
| **Source dropdown** | `<select>` on the right side of the filter bar: All Sources · Contact Form · Lead Magnet. |
| **Pagination** | Prev / Next buttons. Shown only when `totalPages > 1`. Shows "Showing X–Y of Z". Page size: 20. |

#### Lead List

Table columns: Name (bold), Email, Company (hidden below medium breakpoint), Source badge (`Contact Form` blue / `Lead Magnet` teal), Status badge (colour-coded pill), Date (hidden below large breakpoint). Every row is clickable and navigates to `/crm/leads/:id`.

Mobile view (below `sm`): Card list showing name, email, status badge, and source badge only.

**Qualification Modal trigger:** A review indicator appears if there are pending qualification records needing review. The [Qualification Modal](#81-qualification-modal) opens automatically when pending records exist.

---

### 3.4 Lead Detail

**Route:** `/crm/leads/:id` · **Component:** `src/pages/crm/LeadDetail.tsx`

Deep-dive view for a single lead with qualification tools and AI analysis.

#### Edit Fields

| Field | Description |
|---|---|
| Name, Email, Company | Text inputs. |
| Company Size | Text input (e.g. "50–200 employees"). |
| Service Area | Text input (e.g. "Copilot AI"). |
| Source | Dropdown: Contact Form / Lead Magnet. |
| Status | Dropdown: New / Contacted / Qualified / Converted / Archived. |
| Industry | Text input. |
| How Found | Text input ("How did they find Shane?"). |
| **Save button** | Persists changes via `PUT /api/admin/leads/:id`. |
| **Convert to Client button** | Promotes the lead to a client account via `POST /api/admin/leads/:id/convert`. Navigates to the new client's detail page on success. |
| **Send Email button** | Opens the user's mail client with the lead's email pre-filled. |

#### AI Scoring Panel

| Element | Description |
|---|---|
| **Score History sparkline** | Area chart of qualification score over time (from `leadQualifications` records). |
| **AI Suggest Score button** | Calls `/api/leads/:id/suggest-score` (Claude). Populates the qualification sub-scores (Fit / Pain / Maturity / Intent / Urgency) with AI-recommended values and evidence bullets. |
| **Sub-score bars** | Visual bars for each of the 5 dimensions (0–20 each, total 0–100). |
| **Stage badge** | AQL (score ≥ 60) or SQL (score ≥ 75). |

#### Quiz Results Panel

Shown when the lead has a linked quiz submission. Displays:
- Quiz type badge (Copilot / Security / SharePoint / etc.)
- Total score and tier (Beginner / Developing / Emerging / Advanced / Ready)
- Category score breakdown
- **AI "What This Means"** — Claude-generated analysis panel with sections: What This Means, Why This Fits, ROI Projection.

#### Engagement Analysis AI Panel

Pulls signals from the lead's quiz answers and contact form data. Shows auto-detected pain points, maturity indicators, engagement signals, and urgency signals as tag clouds.

#### Signal Auto-Fill note

Displayed when signals have been automatically populated from quiz results via the signal-mapping configuration.

#### Linked Emails

List of M365 emails linked to this lead (by email address match). Shows subject, sender, received time, and body preview.

#### Qualification History

Timeline of past qualification records showing score, stage, recommended next step, and evidence bullets per entry.

---

### 3.5 Opportunities

**Route:** `/crm/opportunities` · **Component:** `src/pages/crm/Opportunities.tsx`

Opportunities are qualification records promoted from leads. Each opportunity has five sub-scores plus an overall snapshot score.

| Element | Description |
|---|---|
| **Opportunity list** | Rows: Lead name, email, company, overall score badge (SQL ≥75 / AQL ≥60 / Lead), sub-score mini-bars (Fit / Pain / Maturity / Intent / Urgency), task count, created date. Clicking navigates to `/crm/opportunities/:id`. |
| **Create Opportunity button** | Links to lead detail where the conversion happens. |
| **Score badges** | Purple "SQL", blue "AQL", or grey "Lead" labels next to the numeric score. |
| **Pagination** | Page size 20. |

**Opportunity Detail (`/crm/opportunities/:id`):** Shows the full qualification record: evidence bullets, recommended next step, workflow type, linked lead details, and sub-score breakdowns.

---

### 3.6 Quiz Leads

**Route:** `/crm/quiz-leads` · **Component:** `src/pages/crm/QuizLeads.tsx`

Inbound quiz submissions from the public website's AI-powered assessment tools.

#### Stat Cards

Total submissions · Contacted · New this week · Downloads by quiz type · Selector tool usage by slug.

#### Filters

| Control | Description |
|---|---|
| **Quiz type filter** | Dropdown of all quiz types detected in the data (Copilot, SharePoint, Security, etc.). |
| **Tier filter** | Dropdown: All / Beginner / Developing / Emerging / Advanced / Ready. |
| **Contacted filter** | All / Contacted / Not contacted. |
| **Search input** | Filters by name, email, or company. |
| **Pagination** | Page size 20. |

#### Quiz Lead Rows

Each row: Name, Email, Company, Quiz Type badge, Tier badge, Score, Contacted status, Created date. Clicking opens an expanded panel (not a new route) showing:
- Category score breakdown
- AI analysis text (What This Means / Why This Fits / ROI Projection)
- Full conversation transcript
- **Mark as Contacted** button — sets `contactedAt` timestamp via `PUT /api/admin/quiz-leads/:id/contacted`.
- **Create Lead** button — promotes the quiz submission to a lead record.

---

### 3.7 M365 Intelligence

**Route:** `/crm/m365-intelligence` · **Component:** `src/pages/crm/M365Intelligence.tsx`

Aggregated Microsoft 365 readiness dashboard across all clients.

| Element | Description |
|---|---|
| **Client table** | Rows: Client name, company, Copilot Readiness Score badge (1–5 scale), primary blocker (auto-derived from profile flags), last updated. |
| **Sort controls** | Sort by: Score / Name / Company / Updated. Ascending or descending. |
| **Score filter** | Dropdown: All / 1 / 2 / 3 / 4 / 5 (readiness score). |
| **Score badges** | Colour-coded: 5 = green (Ready), 4 = blue, 3 = yellow, 2 = orange, 1 = red (Not Ready). |
| **Blocker column** | Shows the first failing prerequisite (e.g. "No Copilot licenses", "MFA not enforced"). |
| **View Profile link** | Links to that client's detail page (M365 Profile tab). |
| **M365 Profile Wizard button** | Opens the [M365 Profile Wizard](#84-m365-profile-wizard) for that client to update their profile data. |

---

## 4. Finance Group

### 4.1 Invoices

**Route:** `/crm/invoices` · **Component:** `src/pages/crm/Invoices.tsx`

Manual invoice management (separate from Stripe purchases).

| Element | Description |
|---|---|
| **Invoice list table** | Columns: Invoice #, Client, Description, Amount, Currency, Status badge, Due Date, Paid Date. |
| **Status badges** | Draft (grey) · Due (amber) · Paid (green) · Overdue (red). |
| **Create Invoice button** | Opens an inline form with fields: Client (dropdown), Invoice Number, Description, Amount, Currency (default USD), Due Date, PDF attachment (optional file picker). |
| **Upload PDF** | File input for attaching a PDF invoice document. Uploads via `multipart/form-data`. |
| **Download PDF link** | If a PDF is attached, a download link appears on the invoice row. |

---

### 4.2 Purchases

**Route:** `/crm/purchases` · **Component:** `src/pages/crm/Purchases.tsx`

Stripe self-service purchases from the public checkout flow.

| Element | Description |
|---|---|
| **Purchase list table** | Columns: Invoice #, Client name/email/company, Description, Amount, Status badge, Paid At, Created date. Clicking a row navigates to `/crm/purchases/:id`. |
| **Total count** | Shown in the header ("N total"). |
| **Status badges** | `paid` (green), `pending` (amber), `failed` (red). |

**Purchase Detail (`/crm/purchases/:id`):** Shows: Invoice #, Client info, Service description, Amount, Stripe session ID, Paid timestamp, full Stripe event data. Read-only view.

---

### 4.3 Contracts

**Route:** `/crm/contracts` · **Component:** `src/pages/crm/Contracts.tsx`

Signed service contracts from the client onboarding flow.

| Element | Description |
|---|---|
| **Contract list table** | Columns: Signer (name bold + email below), Service (hidden below medium breakpoint), Version (blue pill badge), Project (green "Project #N" badge or "Pending payment" text, hidden below medium breakpoint), Signed date (hidden below large breakpoint), Delete button. |
| **Delete button** (per row, Trash2 icon) | Triggers `AlertDialog` with message "This will permanently delete the [version] contract signed by [signer]. This action cannot be undone." Confirms via `DELETE /api/admin/contracts/:id`. Shows success/error toast. |

> **Note:** There is no ID column, no Stripe Session ID column, and no client email column visible in the table. The `stripeSessionId` field is in the data model but is not rendered in the UI table.

> Contracts are created automatically when a client signs during onboarding. There is no manual "Create Contract" button on this page.

---

### 4.4 Coupons

**Route:** `/coupons` · **Component:** `src/pages/Coupons.tsx`

Stripe discount coupon management.

| Element | Description |
|---|---|
| **Coupon list** | Each row: Code, Discount (formatted as `$N` or `N%`), Uses (`N / max` or `N / ∞`), Active toggle, Expiry date, Created date, History button, Edit button, Delete button. |
| **Active toggle** | Toggle switch that enables/disables the coupon via `PATCH /api/admin/coupons/:id`. |
| **New Coupon button** | Opens the create/edit dialog. Dialog title is "Create Coupon" for new records. Fields: Code (text), Discount Type (Fixed / Percentage dropdown), Discount Value (number), Max Uses (number, leave blank for unlimited), Active toggle, Expires At (date picker). Submits via `POST /api/admin/coupons`. |
| **Edit button** | Opens the same form pre-filled with the coupon's current values. |
| **Delete button** | Triggers `AlertDialog` confirmation. Deletes via `DELETE /api/admin/coupons/:id`. |
| **History button** | Expands an inline panel showing a table of all redemptions for that coupon: User, Email, Checkout Session ID, Purchase Amount, Discount Amount, Redeemed At. |

---

## 5. Content Group

### 5.1 Articles

**Route:** `/articles` · **Component:** `src/pages/Articles.tsx`

Manages blog/resource articles published on the consulting website.

#### List View

| Element | Description |
|---|---|
| **Article list table** | Columns: Title, Category, Date, LinkedIn Shares, X (Twitter) Shares, Total Shares. |
| **Share Analytics button** | Switches to the "Shares" view showing detailed share counts per article and a grand total. |
| **Create Article button** | Switches to the editor view with a blank form. |
| **Edit button** (per row) | Switches to the editor pre-filled with that article's data. |
| **Delete button** (per row) | Triggers `AlertDialog` confirmation. Deletes the Markdown file via `DELETE /api/admin/articles/:slug`. |

#### Editor View (Create / Edit)

| Field | Description |
|---|---|
| **Title** | Text input. Auto-generates the slug on change when creating new articles. |
| **Slug** | Text input (URL-safe, auto-slugified from title). |
| **Category** | Text input (e.g. "Microsoft 365", "Copilot AI"). |
| **Date** | Date picker (`YYYY-MM-DD` format). |
| **Summary** | Textarea — short description shown in article cards. |
| **Content** | Large textarea — full article body in Markdown. |
| **Save button** | `POST /api/admin/articles` (create) or `PUT /api/admin/articles/:slug` (update). |
| **Cancel button** | Returns to the list view without saving. |

#### Share Analytics View

Shows a table of LinkedIn and X share counts per article slug, sourced from the `/api/shares` endpoint. Displays total shares across all articles.

---

### 5.2 Services

**Route:** `/services` · **Component:** `src/pages/Services.tsx`

Manages service offerings and their associated order wizards.

#### Service List

| Element | Description |
|---|---|
| **Service cards** | Each card shows: icon, name, category badge, price range, billing type, tagline, inclusions count, and public/private status. |
| **Expand/collapse** | Each service card can be expanded to show all editable fields inline. |
| **Create Service button** | Opens a new blank service card in edit mode. |
| **Offer Card Preview** | Live preview panel shown next to the editor, updating in real time as fields change. |

#### Service Editor Fields

| Field | Description |
|---|---|
| **Name** | Text input. |
| **Slug** | Text input (URL path for the service). Validated against known consulting site routes; warns if the route doesn't exist. |
| **Base Price** | Number input — lower bound of the price range. |
| **Max Price** | Number input — upper bound of the price range. |
| **Price (single)** | Number input — flat price if not using a range. |
| **Billing Type** | Dropdown: One-time / Recurring Monthly. |
| **Tagline** | Text input — short marketing hook. |
| **Category** | Text input (e.g. "Microsoft 365", "Governance"). |
| **Description** | Textarea — full description shown on the offer card. |
| **Target Audience** | Text input — "Best for:" line on the offer card. |
| **Turnaround** | Text input (e.g. "5–7 business days"). |
| **Duration Days** | Number input. |
| **Icon** | Dropdown of 30+ Lucide icon names (Cloud, Bot, Shield, Zap, etc.). |
| **Badge** | Text input (Popular / New / Best Value / Featured — renders coloured pill). |
| **Highlighted** | Checkbox — marks service as featured. |
| **Is Public** | Checkbox — controls whether the service is shown in the client portal. |
| **Sort Order** | Number input — display order on the pricing page. |
| **Inclusions** | Tag input — "What's Included" bullet list on the card. |
| **Features** | Tag input — secondary feature list. |
| **Deliverables** | Tag input — deliverables list. |
| **Page Href** | Text input — consulting site route this service links to. Validated against known routes. |
| **Workflow Template** | Dropdown of available workflow templates to link to this service. |
| **Save button** | `POST /api/admin/services` (create) or `PUT /api/admin/services/:id` (update). |
| **Delete button** | Triggers `AlertDialog`. `DELETE /api/admin/services/:id`. |

#### Order Workflow button

Opens the **WorkflowBuilder** panel inline below the service card.

- **WorkflowBuilder panel:** Multi-step wizard questionnaire editor.
  - **Steps list:** Each step has a title input, description textarea, and up/down order arrows, trash delete button.
  - **Add Step button:** Adds a blank step.
  - **Options (per step):** Each step has option rows with: label input, `+$` price adjustment input, delete button. **Add option** link adds more rows.
  - **Copy From… button:** Dropdown of other services. Copies their workflow steps (replace or append mode). Confirm with "Copy steps" button.
  - **Save Workflow button:** `PUT /api/admin/services/:id/workflow`.
  - **Close button:** Collapses the builder panel.

#### Generate PDF Overview button

Triggers AI generation of a branded PDF service overview document. Available per service.

---

### 5.3 Service Triggers

**Route:** `/service-page-triggers` · **Component:** `src/pages/ServicePageTriggers.tsx`

Maps keyword trigger keys to consulting site service pages, controlling which Engagement Projects appear on each page.

| Element | Description |
|---|---|
| **Page list** | One card per service page: Microsoft 365, Copilot AI, SharePoint, Power Platform, Governance, Cloud Migration. |
| **Trigger Keys tag editor** | Tag-pill input per page. Type a keyword and press Enter (or click Add) to add a trigger key. Click the ✕ on a tag to remove it. |
| **Save button** (per page) | `PUT /api/admin/service-page-triggers/:pageSlug` — saves the trigger key list for that page. |
| **Last updated timestamp** | Shown below each page's trigger key editor if the mapping has been saved before. |

---

### 5.4 Engagement Projects

**Route:** `/engagement-projects` · **Component:** `src/pages/EngagementProjects.tsx`

Project templates surfaced on consulting site service pages when a visitor's quiz answers match trigger keys.

#### Project List

| Element | Description |
|---|---|
| **Project cards** | Show: title, price range, pages (service page badges), triggered by (trigger key tags), SOW items count, visibility toggle. |
| **Visibility toggle** | `isVisible` switch — hides/shows the project on the consulting site without deleting it. |
| **Sort order controls** | Up/down arrows to reorder projects within the list. Saved via `PUT /api/admin/engagement-projects/:id`. |
| **Create button** | Opens a slide-in editor form. |
| **Edit button** (per card) | Opens the editor pre-filled. |
| **Delete button** | `AlertDialog` confirmation before `DELETE /api/admin/engagement-projects/:id`. |

#### Engagement Project Editor

| Field | Description |
|---|---|
| **Title** | Text input. |
| **Price Range** | Text input (e.g. "$5,000–$15,000"). |
| **Description** | Textarea. |
| **Triggered By** | Array editor — list of trigger keys that activate this project on service pages. |
| **SOW Items** | Array editor — Statement of Work bullet points. |
| **Pages** | Multi-checkbox — which service pages this project appears on (Copilot AI, M365, SharePoint, Power Platform, Governance, Cloud Migration). |
| **Sort Order** | Number input. |
| **Is Visible** | Checkbox. |
| **Save / Cancel** | Saves via `POST` or `PUT` depending on create/edit mode. |

---

### 5.5 Email Templates

**Route:** `/email-templates` · **Component:** `src/pages/EmailTemplates.tsx`

Manages transactional email templates sent via Resend (welcome emails, invoice notifications, etc.).

#### Template List

| Element | Description |
|---|---|
| **Filter tabs** | All / Client / Admin — filters by `recipientType`. |
| **Template rows** | Show: Name, Subject, Recipient type badge (Client / Admin), last updated relative time. Clicking selects the template for editing. |
| **New Template button** | Creates a blank template entry and opens the editor. |

#### Template Editor

| Field | Description |
|---|---|
| **Name** | Text input — internal label. |
| **Subject** | Text input — email subject line. Supports variable tokens. |
| **Recipient Type** | Toggle: Client / Admin. |
| **Body (HTML editor)** | Full-height textarea for raw HTML email body. Supports variable token insertion. |
| **Live Preview pane** | Rendered HTML preview in an `<iframe>` (sandboxed). Updates on blur. |
| **Variable Token Reference** | Chip list of available template variables (e.g. `{{client_name}}`, `{{service_name}}`), each with a description. |
| **Save button** | `PUT /api/admin/email-templates/:slug`. |
| **Delete button** | `AlertDialog` confirmation. `DELETE /api/admin/email-templates/:slug`. |

---

### 5.6 Contract Templates

**Route:** `/contract-templates` · **Component:** `src/pages/ContractTemplates.tsx`

Per-service contract body templates. Each service has one contract template. Clients sign these during onboarding.

| Element | Description |
|---|---|
| **Service selector** (left pane) | List of all services. Click a service to load its contract template. Shows category badge and last updated date. |
| **Clause editor** (right pane) | Full-height Markdown/text textarea for the contract body. Includes standard variable tokens (e.g. `{{client_name}}`, `{{service_name}}`, `{{price}}`). |
| **Preview toggle** | Switches the right pane between raw text and rendered Markdown preview. |
| **Save button** | `PUT /api/admin/contracts/templates/:serviceId`. |
| **Delete button** | Removes the template with `AlertDialog` confirmation. |

---

## 6. System Group

### 6.1 Signal Mappings

**Route:** `/crm/quiz-pain-config` · **Component:** `src/pages/crm/QuizPainConfig.tsx`

Configures how quiz type answers and category scores map to pain-point signal labels, which feed the lead scoring engine.

| Element | Description |
|---|---|
| **Quiz Type → Pain Map** | Table with one row per quiz type (sharepoint, migration, security-compliance, copilot, teams, power-platform, governance, m365-health). Each row has a tag editor for the pain-point labels that quiz type generates. |
| **Category → Pain Map** | Table of keyword → pain label pairs. Keyword is a text input; pain label is a text input. |
| **Add row button** | Adds a new keyword/label pair to the Category Pain Map. |
| **Delete row button** | Removes a mapping row. |
| **Save Configuration button** | `PUT /api/admin/quiz-pain-config` — persists both maps. |
| **Recalculate All Signals button** | Triggers `POST /api/admin/quiz-pain-config/recalculate` — re-runs signal derivation across all leads using the new config. Shows "Updated N / Total M" result. |
| **Reset to Defaults button** | Restores the built-in default mapping (shown when a custom config exists). |
| **Last updated / "Using defaults" indicator** | Shows when the config was last saved, or confirms defaults are active. |

---

### 6.2 Hub Storage / SharePoint

**Route:** `/sharepoint` · **Component:** `src/pages/SharePoint.tsx`

Connects the admin panel to a SharePoint hub site and browses its document library.

| Element | Description |
|---|---|
| **Hub Site URL input** | Text input — full SharePoint hub URL (e.g. `https://contoso.sharepoint.com/sites/hub`). |
| **Save button** | Persists the hub URL via `PUT /api/admin/sharepoint/config`. Also resolves the site ID from Microsoft Graph. |
| **Refresh button** | Reloads the folder tree from the Graph API. |
| **Folder tree** | Hierarchical tree of folders and files from the SharePoint document library root. |
| **Expand/Collapse chevrons** | Per-folder. Clicking fetches and shows child items lazily. |
| **Open (external link) button** | Per file/folder. Opens the item's SharePoint URL in a new browser tab. |
| **File size / Last modified** | Shown per file row. |
| **Graph not configured banner** | Shown when Microsoft Graph credentials are absent. Explains what is needed. |

---

### 6.3 Inbox

**Route:** `/inbox` · **Component:** `src/pages/inbox/Inbox.tsx`

Full M365-integrated email client powered by Microsoft Graph.

#### Left: Folder Pane (`InboxFolderPane`)

| Element | Description |
|---|---|
| **Folder list** | Standard M365 mail folders: Inbox, Sent Items, Drafts, Deleted Items. Plus any user-created folders. |
| **Unread counts** | Red badge per folder. |
| **Folder click** | Loads messages for that folder in the message list pane. |

#### Centre: Message List (`InboxMessageList`)

| Element | Description |
|---|---|
| **Search input** | "Search messages…" — submits to `/api/inbox/search?q=`. Shows Clear button when a query is active. |
| **Compose button** | Opens the compose drawer. |
| **Message rows** | Show: sender name, subject, body preview, received time. Unread messages are bold. Clicking opens the message in the detail pane. |
| **Read / Unread indicator** | Blue dot on unread messages. |

#### Right: Message Detail (`InboxMessageDetail`)

| Element | Description |
|---|---|
| **Message header** | Subject, From, To, CC, received timestamp. |
| **Message body** | Rendered HTML or plain text body. |
| **Reply button** | Opens compose drawer pre-filled with Re: subject and quoted body. |
| **Forward button** | Opens compose drawer pre-filled with Fwd: subject and body. |
| **Archive button** | Moves the message to Deleted Items via Graph API. |
| **AI Draft Reply button** | Calls Claude to generate a contextual reply draft. Inserts into the compose drawer body. |
| **Summarize Thread button** | Calls Claude to summarize the conversation thread. Result shown inline below the message. |
| **Convert to Task button** | Creates a Kanban task linked to the message subject. Requires selecting a project. |
| **Link to Opportunity button** | Associates the email with a CRM opportunity record. |

#### Compose Drawer

| Field | Description |
|---|---|
| **To** | Email address input with auto-complete from contacts. |
| **CC / BCC** | Optional email inputs. |
| **Subject** | Text input. |
| **Body** | Textarea. Pre-filled by Reply/Forward or AI Draft Reply. |
| **Send button** | `POST /api/inbox/send` via Graph. |
| **Discard button** | Closes the compose drawer without saving. |

> **Dependency:** Inbox requires Microsoft Graph credentials (`GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_TENANT_ID`, `GRAPH_MAIL_USER_ID`). If unavailable, a placeholder message is shown.

---

### 6.4 Activity Log

**Route:** `/activity-log` · **Component:** `src/pages/ActivityLog.tsx`

Timestamped audit trail of admin actions across the portal.

| Element | Description |
|---|---|
| **Log table** | Columns: Entity type badge (colour-coded), Action verb, Entity title, Actor role dot (admin / client), Client name (if applicable), Timestamp (relative + absolute on hover). |
| **Entity type filter** | Dropdown of entity types: kanban_task, invoice, contract, service, project, workflow_step, status_report, lead, user, document, etc. |
| **Date range pickers** | Start and End date inputs to narrow the log to a specific period. |
| **Client filter** | Dropdown of clients to filter log entries to a specific client's activity. |
| **Pagination** | Previous / Next page. Page size configurable. |
| **Empty state** | "No activity yet" illustration shown when the log is empty. |

---

### 6.5 Workflows

**Route:** `/workflows` · **Component:** `src/pages/Workflows.tsx`

Reusable delivery workflow templates linked to services. Each template defines an ordered set of Steps; each Step contains an ordered set of Tasks.

#### Workflow List (left column)

| Element | Description |
|---|---|
| **Workflow rows** | Show: name, description, linked service name. Clicking a row loads that workflow's steps in the step panel. |
| **Create Workflow button** | Form slide-in with: Name, Description, Linked Service (optional dropdown). Submits via `POST /api/admin/workflow-templates`. |
| **Edit Workflow name/description** | Inline pencil edit on the workflow row. |
| **Delete Workflow button** | `AlertDialog` confirmation. `DELETE /api/admin/workflow-templates/:id`. |

#### Steps Panel (centre column)

| Element | Description |
|---|---|
| **Step cards** | Show: step number, title, task count badge, missing-assets warning badge (amber). Clicking a step loads its tasks. |
| **Drag handles** | Six-dot grip icon on each step card for drag-and-drop reordering via `@dnd-kit`. |
| **Step title inline edit** | Pencil button on each step reveals an input field. Saving renames the step. |
| **Move Up / Move Down buttons** | Arrow buttons on each step as alternative to drag-and-drop. |
| **Delete Step button** | Trash icon. Confirms and deletes the step. |
| **Add Step button** | `POST /api/admin/workflow-templates/:id/steps`. |

#### Task Panel (right column)

Shown when a step is selected.

| Element | Description |
|---|---|
| **Task rows** | Show: drag handle, task title, group name badge, task type label, asset-link indicators (instruction set / checklist / artifact set / deliverable set). Amber highlight if any asset set is unlinked. |
| **Drag-and-drop reorder** | Tasks within a step can be dragged to reorder via `@dnd-kit`. |
| **Add Task button** | Opens the task editor sheet. |
| **Edit Task** | Clicking a task row opens the editor sheet. |
| **Delete Task button** | Trash icon per row. |

#### Task Editor Sheet

| Field | Description |
|---|---|
| **Title** | Text input. |
| **Group** | Dropdown: Engineer Tasks / Artifacts Produced / Client Deliverables. |
| **Task Type** | Dropdown: Discovery / Training / Environment Health Check / Governance Setup / Automation Build / Document Delivery. |
| **Description** | Textarea. |
| **Instructions** | `StringListEditor` — ordered list of instruction text items with move-up/move-down/delete controls. |
| **Checklist** | `ChecklistEditor` — ordered list of checkbox items with move-up/move-down/delete controls. |
| **Instruction Set** | Dropdown of Asset Library instruction sets. Linking replaces inline instructions at runtime. |
| **Checklist (Library)** | Dropdown of Asset Library checklists. |
| **Artifact Set** | Dropdown of Asset Library artifact sets. |
| **Deliverable Set** | Dropdown of Asset Library deliverable sets. |
| **Save / Cancel** | Persists via `POST` or `PUT`. |

#### Generate Assets Dialog button

Per workflow. Opens the [Generate Assets Dialog](#82-generate-assets-dialog).

---

### 6.6 Template Library

**Route:** `/templates/library` · **Component:** `src/pages/templates/TemplateLibrary.tsx`

Browse-only view of document templates stored in a SharePoint site dedicated to templates.

| Element | Description |
|---|---|
| **Template Site URL input** | Text input to configure the SharePoint template site URL (separate from the Hub Storage site). |
| **Save button** | `PUT /api/admin/sharepoint/template-config`. |
| **Refresh button** | Reloads the folder tree from Graph. |
| **Folder tree** | Hierarchical tree identical to Hub Storage. Folders expand/collapse lazily. |
| **File type icons** | Word (blue W), Excel (green X), PowerPoint (orange P), PDF (red), image, or generic file icon based on MIME type. |
| **Open file link** | Opens the file's SharePoint URL in a new tab. |
| **Graph not configured notice** | Shown when credentials are absent. |

---

### 6.7 Asset Library

**Routes:** `/asset-library/*` · **Components:** `src/pages/asset-library/`

Four inter-linked tabs of reusable content assets used by the Workflows engine. Each tab shares the same editor sheet pattern.

#### Navigation

The Asset Library sidebar item links to `/asset-library/instruction-sets`. The four sub-routes are:

| Route | Tab | Asset type |
|---|---|---|
| `/asset-library/instruction-sets` | Instruction Sets | Ordered instruction lists for workflow tasks |
| `/asset-library/checklists` | Checklists | Ordered checkbox-item lists |
| `/asset-library/artifact-sets` | Artifact Sets | Named sets of deliverable artifacts |
| `/asset-library/deliverable-sets` | Deliverable Sets | Named client-facing deliverable descriptions |
| `/asset-library/categories` | Categories | Category management sub-page |

#### Common UI per tab

| Element | Description |
|---|---|
| **Search input** | Filters the list by title or category. |
| **Category filter** | Dropdown of all categories. |
| **Asset list** | Rows showing: title, category badge, item count. |
| **New button** | Opens the editor sheet with a blank form. |
| **Edit button** (per row) | Opens the editor sheet pre-filled. |
| **Delete button** (per row) | `AlertDialog` confirmation before deletion. |
| **JSON Import button** | Opens the [JSON Import Modal](#83-json-import-modal) to bulk-import assets. |
| **Export All button** | Downloads all assets of that type as a `.json` file. |

#### Editor Sheet fields

| Field | Description |
|---|---|
| **Title** | Text input. |
| **Description** | Textarea (optional). |
| **Category** | Dropdown of existing categories, plus a "Create new category" inline input. |
| **Items list** | Ordered list of text items (instructions, checklist labels, artifact names, or deliverable descriptions). Each item has: move-up / move-down / delete buttons, and a multi-line text area. |
| **Add item** | Input + Enter or Add button adds a new item to the bottom of the list. |
| **Save / Cancel** | Persists via the API spec-generated React Query mutation hooks. |

#### Category Manager (`/asset-library/categories`)

| Element | Description |
|---|---|
| **Category list** | All asset library categories with item counts per type. |
| **Create Category button** | Text input + Save. |
| **Delete Category button** | Removes category. Assets in that category become uncategorised. |

---

### 6.8 Security

**Route:** `/security` · **Component:** `src/pages/AdminSecurity.tsx`

> `App.tsx` mounts `<AdminSecurity />` without an outer shell wrapper, but the component renders `<DashboardShell>` as its root element, so the full sidebar and header bar are present — the page looks identical to every other admin page.

> **This page manages MFA second factors only. There is no security audit log table on this page.**

#### Passkey / WebAuthn Card

Card header: "Passkey (Biometric / Hardware Key)" · subtitle: "Fingerprint, Face ID, or security key".

**When `passkeyCount === 0` (unenrolled state):**

| Element | Description |
|---|---|
| **No-passkey text** | "No passkeys registered. Enroll one to add a second factor to your admin login." |
| **Enroll Passkey button** | Calls `POST /api/auth/mfa/passkey/admin-registration-options`, invokes `startRegistration({ optionsJSON })` from `@simplewebauthn/browser`, then `POST /api/auth/mfa/passkey/verify-registration`. On success shows "Passkey registered! You will be prompted to use it on next login." |

**When `passkeyCount > 0` (enrolled state):**

| Element | Description |
|---|---|
| **Enrolled count badge** | Green "N key(s)" pill in the card header. |
| **Enrolled text** | "You have N passkey(s) registered. You are prompted after password entry on each login." |
| **Add another button** | Same WebAuthn enrollment flow as above. |
| **Remove all button** (red) | Browser `confirm()`: "Remove all N admin passkey(s)?" then `DELETE /api/auth/mfa/passkey`. On success shows "All passkeys removed." |

**Alert banner:** Single shared green (success) / red (error) banner at the top of the page, not per-card.

#### TOTP / Authenticator App Card

Card header: "Authenticator App" · subtitle: "Google Authenticator, Authy, or any TOTP app".

**When `totpEnrolled = true`:**

| Element | Description |
|---|---|
| **"Active" badge** | Green "Active" pill in the card header. |
| **Enrolled text** | "An authenticator app is enrolled. You will be prompted for a 6-digit code on login." |
| **Remove button** (red) | Browser `confirm()`: "Remove authenticator app enrollment?" then `DELETE /api/auth/mfa/totp`. On success shows "Authenticator app removed." |

**When `totpEnrolled = false` and setup not started:**

| Element | Description |
|---|---|
| **Unenrolled text** | "No authenticator app enrolled. Set one up to use a TOTP code as a second factor." |
| **Set up authenticator button** | Calls `POST /api/auth/mfa/totp/setup`. Server returns `{ secret, qrDataUrl }`. Transitions to QR-scan state. |

**During QR-scan state (`totpSetup` present):**

| Element | Description |
|---|---|
| **Instruction text** | "Scan this QR code with your authenticator app, then enter the 6-digit code to confirm." |
| **QR code image** | `<img>` from `qrDataUrl` (base64 data URI). CSS size: `w-44 h-44` (176 × 176 px). |
| **Verification code input** | Numeric-only text input, max 6 characters, placeholder "000000". Only digits accepted (non-digits stripped on input). |
| **Confirm enrollment button** | Enabled only when code is ≥ 6 digits. `POST /api/auth/mfa/totp/verify-setup` with `{ secret, code }`. On success shows "Authenticator app enrolled! Use it as a second factor on next login." |
| **Cancel button** | Clears `totpSetup` and `totpCode` — returns to unenrolled state without API call. |

#### "How it works" Info Box

Static numbered list at the bottom of the page (always visible):
1. Enter your email and password as usual.
2. If a passkey or authenticator app is enrolled, you will be prompted for a second factor.
3. On success, you are logged in. No second factor enrolled = no extra step.

---

## 7. Additional Detail Routes

### 7.1 Project Detail

**Route:** `/crm/projects/:id` · **Component:** `src/pages/crm/ProjectDetail.tsx`

Full project management view with Kanban board, documents, status reports, and AI actions.

#### Project Header

| Element | Description |
|---|---|
| **Project Title** | Inline editable text. |
| **Status dropdown** | Active / On Hold / Completed. Changes saved via `PUT /api/admin/projects/:id`. |
| **Phase input** | Text input (e.g. "Discovery", "Implementation"). |
| **Progress** | Numeric input (0–100 %) or auto-calculated from task completion. |
| **Type badge** | Project / Retainer. |
| **Start Date / End Date** | Date pickers. |
| **Client link** | Links to `/crm/clients/:clientId`. |
| **SharePoint folder link** | Opens the project's SharePoint folder in a new tab (if provisioned). |

#### Tabs

| Tab | Content |
|---|---|
| **Board** | Kanban board (see below). |
| **Status Reports** | List of status reports for this project (see below). |
| **Documents** | File upload and document list (see below). |
| **Audit Log** | Timeline of all changes to this project, formatted by `auditFormatter`. |

#### Kanban Board

Four columns: **Backlog · In Progress · Waiting on Customer · Completed**.

| Element | Description |
|---|---|
| **Task cards** | Show: title, task type icon, priority badge, due date, assignee, checklist progress (N/M items). |
| **Drag and drop** | Cards are draggable between columns via `@dnd-kit` (`useDraggable` / `useDroppable`). Dropping a card on a column updates its `column` field via `PUT /api/admin/kanban-tasks/:id`. |
| **Add Task button** | Per column. Opens `KanbanCardModal` to create a new task in that column. |
| **Task card click** | Opens `KanbanCardModal` for viewing/editing the full task detail. |
| **`KanbanCardModal`** | Shows: title, description, task type (typed content via `TypedCardContent`), status/priority dropdowns, due date, instructions list, checklist items with checkboxes, artifacts produced, client deliverables, links to asset-library sets. |

#### AI Actions

| Button | Description |
|---|---|
| **Generate Status Update** | Calls Claude with project data to draft a status report. Inserts the result into the status report form. |
| **Request Closure Sign-off** | Sends the client a closure request email/link via `POST /api/admin/projects/:id/request-closure`. |

#### Status Reports Tab

| Element | Description |
|---|---|
| **Status report list** | Shows: title, period, status badge, sent date, client name. |
| **Create Status Report** | Inline form via `StatusReportForm` component: Period (Weekly / Monthly / Executive Summary), Title, Report body (rich text). |
| **Send button** | Emails the report to the client via Resend. |
| **Download PDF** | Generates and downloads a PDF version of the status report. |

#### Documents Tab

| Element | Description |
|---|---|
| **Document list** | Shows: file name, MIME type, size, uploaded date. Download link per file. |
| **Upload button** | File picker dialog. Uploads via `multipart/form-data` to `POST /api/admin/projects/:id/documents`. |
| **Delete button** | Per document. `AlertDialog` confirmation. |

---

### 7.2 Reports

**Route:** `/crm/reports` · **Component:** `src/pages/crm/Reports.tsx`

Admin-uploaded client reports (PDF/Word documents sent to specific clients).

| Element | Description |
|---|---|
| **Report list table** | Columns: Title, Client, Period badge (Weekly/Monthly/Executive Summary/Other), Report Date, File size, Uploaded date. Download link per row. |
| **Upload Report button** | Opens an inline form: Client (dropdown), Title, Period (dropdown), Report Date, File picker. Uploads via `multipart/form-data` to `POST /api/admin/reports`. |

---

### 7.3 Documents

**Route:** `/crm/documents` · **Component:** `src/pages/crm/Documents.tsx`

Cross-project document repository — all uploaded documents across all projects in one place.

| Element | Description |
|---|---|
| **Document list table** | Columns: Document name, Project title, File name, MIME type, Size, Uploaded date. Download link per row. |
| **Upload Document button** | Inline form: Project (dropdown), Document Name, File picker. Uploads via `multipart/form-data` to `POST /api/admin/documents`. |

---

### 7.4 Status Reports

**Route:** `/crm/status-reports` · **Component:** `src/pages/crm/StatusReports.tsx`

Read-only list of all status reports across all projects.

| Element | Description |
|---|---|
| **Report list table** | Columns: Title, Period badge, Status badge (Draft/Sent), Client name, Project title, Sent At, Updated At. |
| **Row link** | Clicking a row navigates to the parent project's Status Reports tab (`/crm/projects/:id`). |

---

### 7.5 Testimonials

**Route:** `/crm/testimonials` · **Component:** `src/pages/crm/Testimonials.tsx`

Signed project closure records and client testimonials.

| Element | Description |
|---|---|
| **Published section** | Testimonials where `permissionGranted = true` and feedback text is present. These appear on the public consulting website. Shows: client name, project title, project type badge, feedback text, signed date. |
| **Signed Off – No Testimonial section** | Closures where the client did not grant permission or provided no feedback. Shows same fields minus feedback. |
| **Project type badges** | Retainer (purple) · Project (blue) · Micro-Offer (teal). |

---

### 7.6 Opportunity Detail

**Route:** `/crm/opportunities/:id` · **Component:** `src/pages/crm/OpportunityDetail.tsx`

Full detail view for a single qualification-derived opportunity. Loaded from `GET /api/opportunities/:id`.

| Element | Description |
|---|---|
| **← Opportunities breadcrumb** | Back link that navigates to `/crm/opportunities`. |
| **Stage badge** | AQL (blue) or SQL (purple) derived from `scoreSnapshot` (SQL ≥ 75). |
| **Score ring / percentage** | SVG radial gauge displaying the `scoreSnapshot` value. |
| **Sub-score bars** | Fit / Pain / Maturity / Intent / Urgency bars with max values and percentage fill. |
| **Evidence bullets** | AI-generated supporting evidence items. |
| **Recommended Next Step** | Blue call-out box with the AI-recommended action. |
| **Workflow Type** | Label for the assigned workflow type (e.g. "Copilot Readiness"). |
| **Lead info card** | Name, email, company of the originating lead. |
| **Tasks section** | List of workflow tasks (if any). Each task has a status dropdown (Todo / In Progress / Done). Status updates via `PATCH /api/opportunities/:id/tasks/:taskId`. |
| **"N of M done" progress** | Task completion counter derived from tasks with `status = "done"`. |

---

### 7.7 Purchase Detail

**Route:** `/crm/purchases/:id` · **Component:** `src/pages/crm/PurchaseDetail.tsx`

Read-only detail view for a single Stripe self-service purchase. Loaded from `GET /api/admin/purchases/:id`.

| Element | Description |
|---|---|
| **← Purchases breadcrumb** | Back link that navigates to `/crm/purchases`. |
| **Invoice number** | Displayed as the page title (e.g. `INV-0001`). |
| **Status badge** | Colour-coded: `paid` (green), `pending` (amber), `failed` (red), etc. |
| **Client card** | Client name and email. |
| **Service description** | Service name or description purchased. |
| **Amount** | `CURRENCY $N.NN` — currency is upper-cased from Stripe data (defaults to USD). |
| **Stripe session ID** | Checkout session ID (monospace). |
| **Paid at** | Localised timestamp of payment confirmation. |
| **Wizard selections** | If the purchase was made via a multi-step order wizard, each step's selected option and any price adjustment is listed. Shown only when selections are present. |
| **Contracts** | List of any contract records generated for this purchase. |
| **No actions** | This page is purely read-only — no edit or delete controls. |

---

## 8. Dialogs & Modals

### 8.1 Qualification Modal

**Component:** `src/components/QualificationModal.tsx`

Floating modal that automatically appears whenever there are pending AI-generated qualification records that require a decision. Polls `/api/leads/qualification/pending` every 30 seconds and on window focus. The modal **cannot be dismissed** without choosing an action (no backdrop click, no Escape).

| Element | Description |
|---|---|
| **Stage badge** | AQL or SQL label derived from `newScore` (SQL ≥ 75, AQL ≥ 60), coloured purple or blue. |
| **Lead header** | Lead name, company, and "Lead Qualification" subtitle. |
| **Pending count** | "N pending" pill shown when more than one record is queued. |
| **Circular score gauge** | SVG radial ring showing the numerical qualification score (0–100) and a previous-score delta badge (green if up, red if down). |
| **Sub-score bars** | Five horizontal progress bars with actual score / max: Fit (0–25), Pain (0–30), Maturity (0–20), Intent (0–15), Urgency (0–10). |
| **Evidence bullets** | Dot-list of AI-generated evidence items supporting the score. Shown only when evidence array is non-empty. |
| **Recommended Next Step** | Blue call-out box with a lightning bolt icon and the recommended action text. Shown only when present. |
| **Approve & Create Opportunity button** | `POST /api/leads/qualification/:id/approve`. On success, creates an Opportunity record and navigates to `/crm/opportunities/:newId`. |
| **Reject — Return to Nurture button** | `POST /api/leads/qualification/:id/reject`. Dismisses this record and loads the next pending one. |
| **Decide Later (24h) button** | `POST /api/leads/qualification/:id/snooze`. Snoozes this record for 24 hours; loads next pending. |

---

### 8.2 Generate Assets Dialog

**Component:** `src/components/GenerateAssetsDialog.tsx`

AI-powered bulk generation of workflow asset sets (instruction sets, checklists, artifact sets, deliverable sets) for all tasks in a workflow template.

> **Blocking dialog:** The dialog is not closable while generation is in progress. The ✕ button, Escape key, and clicking outside are all suppressed until `state.done` is true. Cancelling before completion aborts the SSE stream via `ReadableStream.cancel()`.

| Element | Description |
|---|---|
| **Trigger** | "Generate Asset Sets" button on the Workflows page, per workflow template. |
| **Dialog header** | "Generate Asset Sets" title with a purple lightning bolt icon. |
| **SSE stream** | Starts immediately when the dialog opens: `POST /api/admin/workflow-templates/:id/generate-asset-sets` with `Accept: text/event-stream`. |
| **Progress bar** | Fills as tasks are processed. Shows "N of M" counter. Visible while `!state.done && state.total > 0`. |
| **"Now generating" call-out** | Purple box showing: current step title, current task title, and sub-step label — Step 1 · Instructions / Step 2 · Checklist / Step 3 · Artifacts & Deliverables. |
| **"Starting generation…" spinner** | Shown while `state.total === 0` (waiting for first SSE event). |
| **Log feed** | Scrolling list of completed task entries. Each row shows a ✓ (green) or ✗ (red) icon, task title, step title, and sets-created count. Auto-scrolls to the bottom on each new entry. |
| **Summary panel** | Shown after completion. Green if fully successful ("Generation complete"), amber if partial errors ("Completed with some errors"), blue if nothing to generate ("All tasks already have asset sets linked"). Shows "N tasks processed · M asset sets created · K failed". |
| **Error panel** | Red panel shown if a fatal error occurs mid-stream. |
| **Close button** | Labelled "Running…" and disabled during generation; changes to "Close" and becomes enabled when `state.done = true`. |

---

### 8.3 JSON Import Modal

**Component:** `src/components/JsonImportModal.tsx`

Bulk-creates or bulk-updates asset library records from JSON. There is no file picker — all input is via the embedded editor.

#### Left pane — CodeMirror JSON editor

| Element | Description |
|---|---|
| **CodeMirror editor** | Full-featured JSON editor with syntax highlighting (One Dark theme), line numbers, fold gutter, and active-line highlight. Validation is **automatic and reactive** — no separate "Validate" button. |
| **Border colour** | Updates live: red = JSON syntax error, amber = at least one record fails schema validation, green = all records valid, grey = empty. |
| **Load Example button** | Populates the editor with an example JSON snippet for the current asset type. |
| **Format button** | Pretty-prints the current JSON (`JSON.stringify` with 2-space indent). Disabled if JSON is invalid. |
| **Status bar** | Shows line count and character count. Shows the syntax error message if JSON cannot be parsed. |

#### Right pane — Live preview

| Element | Description |
|---|---|
| **Record count pill** | "N records ready" (green) or "M ok · K errors" (amber). |
| **RecordPreviewCard (per record)** | Collapsible card per parsed record. Shows a ✓ (green) or ✗ (red) icon, record title, and "new" vs "update #N" label. Expanded view shows all field values (with array items condensed to `[N items]`). First 5 records are expanded by default. |
| **Syntax error card** | Red error box shown when JSON cannot be parsed at all. |

#### Footer

| Element | Description |
|---|---|
| **Create/Update note** | "Records with an `id` field are updated; without one, a new record is created." |
| **Cancel button** | Closes the modal without importing. |
| **Import button** | Enabled only when `allValid` — all records pass the Zod schema. Sends individual `POST` (no id) or `PUT` (with id) calls to `/api/admin/asset-library/:collection`. Disabled while saving. Shows "Importing…" label with spinner. |
| **Network error display** | Inline list of per-record errors if any API calls fail mid-import. On partial success, shows a toast and calls `onImported`. |

---

### 8.4 M365 Profile Wizard

**Component:** `src/components/M365ProfileWizard.tsx`

Multi-step form for capturing or updating a client's Microsoft 365 environment profile. Used on the Clients list, Client Detail (M365 Profile tab), and M365 Intelligence page.

The wizard is organised into six thematic steps:

| Step | Fields |
|---|---|
| **1. Organisation** | Org Name, Industry, Employee Count, Licensed User Count, IT Contact Name, IT Contact Email, Tenant Domain, Is Microsoft Partner toggle. |
| **2. Licensing & Usage** | License SKUs (tag input), All Users Licensed toggle, Active User %, Uses Exchange / Teams / SharePoint / OneDrive / Yammer toggles, SharePoint Site Count, Team Count, Security Group Count. |
| **3. Identity & Access** | External Sharing Enabled, Guest Users Present, Auth Method (dropdown), Is Hybrid toggle, Has On-Prem Exchange, Uses AAD Connect, MFA Enforced, Conditional Access Enabled. |
| **4. Security & Compliance** | Intune Enabled, Has Azure AD P1/P2, Has Defender, Has DLP, Uses Compliance Center, Sensitivity Labels Configured, Has Retention Policies, Has Insider Risk. |
| **5. Copilot & AI** | Has Copilot Licenses, Copilot License Count, Copilot Use Case, Current AI Tools, Data Governance Concerns, Copilot Readiness Score (1–5), Copilot Blocked By. |
| **6. Review** | Read-only summary of all entered values before saving. |

| Button | Description |
|---|---|
| **Next** | Advances to the next step. Validates required fields for the current step. |
| **Back** | Returns to the previous step. |
| **Save** (step 6) | `PUT /api/admin/clients/:id/m365-profile` — persists all profile data and closes the dialog. Shows success/error toast. |
| **Cancel / Close (✕)** | Dismisses the dialog without saving. |

---

## 9. Public & Redirect Routes

These routes exist in `src/App.tsx` but render no `DashboardShell` and require no authentication.

### 9.1 Login

**Route:** `/login` · **Component:** `src/pages/LoginPage.tsx`

Public entry point. If the user is already authenticated (valid refresh token), the page redirects immediately to `/overview` without showing the form.

| Element | Description |
|---|---|
| **Email input** | Standard text input for the admin email address. |
| **Password input** | Password input with visibility toggle. |
| **Sign In button** | `POST /api/auth/login` with email + password. On success, stores the access token in `AuthContext` state and navigates to the `adminReturnTo` URL (from `sessionStorage`) or falls back to `/overview`. On failure, shows an inline error message. |
| **Error message** | Shown below the form on invalid credentials or server error. |

---

### 9.2 Root Redirect

**Route:** `/` · No component rendered.

Pure client-side redirect declared in `App.tsx`:
- If `isAdmin` (authenticated) → navigate to `/overview`.
- Otherwise → navigate to `/login`.

No visible UI is rendered — the redirect fires synchronously on mount.

---

### 9.3 Legacy Redirect — `/email-activity`

**Route:** `/email-activity` · No component rendered.

Static redirect that forwards to `/inbox`. Exists only to prevent broken bookmarks or links from older versions of the admin panel. No UI is displayed.

---

### 9.4 Catch-all

**Route:** `*` · No component rendered.

Any unmatched path is silently redirected to `/login`. Unauthenticated users hitting a deep link are first sent to `/login`; `RequireAdmin` stores the intended path in `sessionStorage` as `adminReturnTo` so they are returned there after logging in.

---

## 10. Route Traceability Checklist

Maps every route declared in `src/App.tsx` to its documentation section. Confirm full coverage here.

| Route | Doc Section |
|---|---|
| `/login` | [§9.1 Login](#91-login) |
| `/` | [§9.2 Root Redirect](#92-root-redirect) |
| `/overview` | [§2.1 Overview](#21-overview) |
| `/analytics` | [§2.5 Analytics](#25-analytics) |
| `/articles` | [§5.1 Articles](#51-articles) |
| `/services` | [§5.2 Services](#52-services) |
| `/workflows` | [§6.5 Workflows](#65-workflows) |
| `/contract-templates` | [§5.6 Contract Templates](#56-contract-templates) |
| `/engagement-projects` | [§5.4 Engagement Projects](#54-engagement-projects) |
| `/email-templates` | [§5.5 Email Templates](#55-email-templates) |
| `/coupons` | [§4.4 Coupons](#44-coupons) |
| `/service-page-triggers` | [§5.3 Service Triggers](#53-service-triggers) |
| `/script-runner` | [§2.4 Script Runner](#24-script-runner) |
| `/crm/leads` | [§3.3 Leads](#33-leads) |
| `/crm/leads/:id` | [§3.4 Lead Detail](#34-lead-detail) |
| `/crm/clients` | [§3.1 Clients](#31-clients) |
| `/crm/clients/:id` | [§3.2 Client Detail](#32-client-detail) |
| `/crm/projects` | [§2.3 Projects](#23-projects) |
| `/crm/projects/:id` | [§7.1 Project Detail](#71-project-detail) |
| `/crm/opportunities` | [§3.5 Opportunities](#35-opportunities) |
| `/crm/opportunities/:id` | [§7.6 Opportunity Detail](#76-opportunity-detail) |
| `/crm/quiz-leads` | [§3.6 Quiz Leads](#36-quiz-leads) |
| `/crm/m365-intelligence` | [§3.7 M365 Intelligence](#37-m365-intelligence) |
| `/crm/quiz-pain-config` | [§6.1 Signal Mappings](#61-signal-mappings) |
| `/crm/invoices` | [§4.1 Invoices](#41-invoices) |
| `/crm/purchases` | [§4.2 Purchases](#42-purchases) |
| `/crm/purchases/:id` | [§7.7 Purchase Detail](#77-purchase-detail) |
| `/crm/contracts` | [§4.3 Contracts](#43-contracts) |
| `/crm/messages` | [§2.2 Messages](#22-messages) |
| `/crm/reports` | [§7.2 Reports](#72-reports) |
| `/crm/documents` | [§7.3 Documents](#73-documents) |
| `/crm/status-reports` | [§7.4 Status Reports](#74-status-reports) |
| `/crm/testimonials` | [§7.5 Testimonials](#75-testimonials) |
| `/inbox` | [§6.3 Inbox](#63-inbox) |
| `/email-activity` | [§9.3 Legacy Redirect](#93-legacy-redirect-email-activity) |
| `/activity-log` | [§6.4 Activity Log](#64-activity-log) |
| `/sharepoint` | [§6.2 Hub Storage / SharePoint](#62-hub-storage--sharepoint) |
| `/templates/library` | [§6.6 Template Library](#66-template-library) |
| `/asset-library/instruction-sets` | [§6.7 Asset Library — Instruction Sets](#67-asset-library) |
| `/asset-library/checklists` | [§6.7 Asset Library — Checklists](#67-asset-library) |
| `/asset-library/artifact-sets` | [§6.7 Asset Library — Artifact Sets](#67-asset-library) |
| `/asset-library/deliverable-sets` | [§6.7 Asset Library — Deliverable Sets](#67-asset-library) |
| `/asset-library/categories` | [§6.7 Asset Library — Categories](#67-asset-library) |
| `/security` | [§6.8 Security](#68-security) |
| `*` (catch-all) | [§9.4 Catch-all](#94-catch-all) |
