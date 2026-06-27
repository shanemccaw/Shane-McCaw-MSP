# Marketing Command Center — Specification

**File:** `artifacts/admin-panel/src/pages/MarketingCommandCenter.tsx`  
**API routes:** `artifacts/api-server/src/routes/admin-marketing.ts`  
**Access:** Admin Panel → "Marketing" nav item (requires session password)

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication & Access](#authentication--access)
3. [Navigation Structure](#navigation-structure)
4. [Section 0 — AI Leads](#section-0--ai-leads)
5. [Section 1 — KPIs](#section-1--kpis)
6. [Section 2 — Lead Finder](#section-2--lead-finder)
7. [Section 3 — Outreach](#section-3--outreach)
8. [Section 4 — Content Hub](#section-4--content-hub)
9. [Section 5 — Analytics](#section-5--analytics)
10. [Section 6 — Tasks](#section-6--tasks)
11. [Section 7 — Campaigns](#section-7--campaigns)
12. [AI Integration](#ai-integration)
13. [Email Delivery](#email-delivery)
14. [Data Persistence](#data-persistence)
15. [API Reference](#api-reference)
16. [Configuration & Secrets](#configuration--secrets)

---

## Overview

The Marketing Command Center is a single-page section within the Admin Panel that consolidates all outbound marketing operations for Shane McCaw Consulting into one interface. It covers lead intelligence, outreach automation, content creation, traffic analytics, task management, and campaign planning — all with AI assistance powered by Claude (Anthropic).

The component (`MarketingCommandCenter`) is mounted at the `/admin-panel/marketing` route and uses a shared `fetchWithAuth` helper that automatically attaches the admin `Authorization: Bearer <password>` header to every API call.

---

## Authentication & Access

Every API route under `/api/admin/marketing/...` is protected by the `requireAdmin` middleware. The middleware validates the `Authorization: Bearer <password>` header against the `CRM_ADMIN_PASSWORD` environment variable. Unauthenticated requests receive `401 Unauthorized`.

In the frontend, `fetchWithAuth` (from `AuthContext`) wraps every `fetch` call, injecting the stored session password.

---

## Navigation Structure

The command center renders a horizontal tab bar. Each tab is a string label mapped to a React section component:

| Tab Label | Component | Nav Key |
|-----------|-----------|---------|
| AI Leads | `RecommendedLeadsSection` | `ai_leads` |
| KPIs | `KPIStrip` | `kpis` |
| Lead Finder | `LeadFinderSection` | `lead_finder` |
| Outreach | `OutreachAutomationSection` | `outreach` |
| Content | `ContentHubSection` | `content` |
| Analytics | `TrafficAnalyticsSection` | `analytics` |
| Tasks | `MarketingTasksKanban` | `tasks` |
| Campaigns | `CampaignBuilderWizard` | `campaigns` |

The active tab is stored in local `useState`. Only the active section renders; others are unmounted (no lazy loading — each section re-fetches its data on mount).

---

## Section 0 — AI Leads

**Component:** `RecommendedLeadsSection`

### Purpose
Generates a batch of AI-recommended prospects that match Shane's Ideal Customer Profile (ICP), lets the admin review each one in detail, and then take action (add to CRM, send outreach, dismiss).

### Generating Leads

- On mount, the component fetches existing recommended leads from the database: `GET /api/admin/marketing/recommended-leads`
- The **✦ Generate Leads** button calls `POST /api/admin/marketing/recommended-leads/generate`
- The server asks Claude (via `buildICPContext()`) to produce **7 recommended leads** as a JSON array. The ICP context is derived from the live CRM — it includes industry distributions, average deal size, top company sizes, and existing lead sources actually present in the database.
- A compliance note is injected into the Claude prompt: suggested contacts must not work at NASA, federal agencies, or other organisations that could create conflicts of interest with Shane's government employment.
- Each returned lead has: `name`, `company`, `role`, `industry`, `companySize`, `location`, `fitScore` (0–100), `reasoning` (one-sentence explanation), and `suggestedOutreach` (recommended first message).
- The leads are saved to the `recommended_leads` table with `source = "ai_recommended"` and `status = "pending"`.

### Lead Cards

Each lead renders as a card showing:
- Name, role, company, industry, company size, location
- A fit score badge (colour-coded: green ≥ 80, yellow ≥ 60, red < 60)
- `reasoning` text
- A **View Details** button that opens the `RecommendedLeadSlideOver`

### Slide-Over Panel (`RecommendedLeadSlideOver`)

Clicking a card opens a slide-over panel (fixed overlay, right-aligned) showing all lead fields plus the `suggestedOutreach` message.

Action buttons available inside the slide-over:

| Button | Behaviour |
|--------|-----------|
| Add to Leads | `POST /api/admin/marketing/recommended-leads/{id}/convert` — creates a real CRM lead record from the recommended lead and marks it `converted` |
| Email | Opens the `OutreachModal` pre-filled with `cold_email` type |
| LinkedIn | Opens the `OutreachModal` pre-filled with `linkedin` type |
| Follow-Up Seq. | Opens the `OutreachModal` pre-filled with `followup` type |
| Add Task | Creates a marketing task linked to the lead |
| Add to Campaign | Opens a campaign selector and tags the lead to a campaign |
| Dismiss | `PATCH /api/admin/marketing/recommended-leads/{id}` sets `status = "dismissed"` |

### Dismiss & Undo

Dismissing a lead shows a toast with an **Undo** link. If the admin clicks Undo within 5 seconds, the card is restored (status patched back to `pending`). After 5 seconds the undo option disappears and the lead stays dismissed.

### Filtering

Dismissed leads are hidden from the list by default. Only leads with `status = "pending"` or `status = "converted"` are shown.

---

## Section 1 — KPIs

**Component:** `KPIStrip`

### Purpose
Provides a at-a-glance summary of four key marketing metrics, displayed as tiles in a 2×2 (mobile) or 1×4 (desktop) grid.

### Metrics

| Tile | Icon | Data Source |
|------|------|-------------|
| Visitors Today | 👁 | `visitorsToday` from KPI endpoint |
| Leads This Week | 🎯 | `leadsThisWeek` |
| Conversion Rate | 📈 | `conversionRate` (%) |
| Active Campaigns | 🚀 | `activeCampaigns` |

### Data Loading

On mount: `GET /api/admin/marketing/kpi` — returns a single JSON object with the four fields above. While loading, each tile shows an animated skeleton placeholder. On error the tile shows `—`.

### API
`GET /api/admin/marketing/kpi` — computes values from the live database:
- `visitorsToday` — count of `analytics_sessions` rows started today (UTC)
- `leadsThisWeek` — count of `leads` created in the last 7 days
- `conversionRate` — percentage of total leads with `status = "converted"` (0 decimal places)
- `activeCampaigns` — count of `campaigns` with `status = "active"`

---

## Section 2 — Lead Finder

**Component:** `LeadFinderSection`

### Purpose
A searchable, filterable table over the CRM's lead records. Designed for quickly finding a specific lead and launching outreach or checking history.

### Data Loading

`GET /api/leads?limit=100` — fetches the latest 100 CRM leads. (Note: this is the shared leads endpoint, not a marketing-specific one.)

### Search & Filters

| Control | Behaviour |
|---------|-----------|
| Search box | Client-side filter on `name`, `company`, `email`, `industry` (case-insensitive) |
| Status dropdown | Filters by `status`: new / contacted / qualified / converted / archived |
| Source dropdown | Filters by `source`: AI Suggested, AI Recommended, Contact Form, Lead Magnet |
| Industry dropdown | Dynamically built from unique values in the loaded lead set |
| Company Size dropdown | Dynamically built from unique values |
| Location dropdown | Dynamically built from unique values (only shown if ≥1 location exists) |

All filters are applied simultaneously (AND logic). Up to 50 matched leads are displayed in the table; a footer note shows "Showing N of M leads" when the full set exceeds 50.

### Table Columns

`Name / Email` · `Company / Location` · `Industry / Size` · `Source` (badge) · `Status` (badge) · `Stage` (MQL/SQL/AQL badge) · `Score` (numeric) · `Actions`

Source badges use distinct colours: violet for AI Recommended, teal for Lead Magnet, blue for Contact Form, grey for everything else.

### Actions per Row

| Button | Behaviour |
|--------|-----------|
| Email | Opens `OutreachModal` with `cold_email` type |
| LinkedIn | Opens `OutreachModal` with `linkedin` type |
| Follow-Up | Opens `OutreachModal` with `followup` type |
| Call Script | Opens `OutreachModal` with `cold_call` type |
| History | Opens `LeadEmailHistoryModal` showing all sent emails for this lead |

### Outreach Modal (`OutreachModal`)

A dialog that wraps the outreach generation flow for a specific lead. It pre-populates the lead's name and email, generates outreach copy via the AI endpoint, and allows the admin to review, edit, and send directly from this modal. Saving a template is also available inside this modal.

### Email History Modal (`LeadEmailHistoryModal`)

Fetches `GET /api/admin/marketing/leads/{id}/emails` and displays a chronological list of all `email_events` records linked to this lead — subject line, recipient, sent timestamp, and linked campaign.

---

## Section 3 — Outreach

**Component:** `OutreachAutomationSection`

### Purpose
Generates personalised outreach copy for a named prospect, allows editing and saving as a reusable template, and can send the message directly via Exchange Online (Microsoft Graph API).

### Tabs

| Tab | Template Type |
|-----|---------------|
| Cold Email | `cold_email` |
| LinkedIn | `linkedin` |
| Follow-Up Seq. | `followup` |
| Call Script | `cold_call` |

Switching tabs clears the current content area (the content is per-type, not shared).

### Prospect Fields

Four text inputs: **Name**, **Company**, **Role**, **Industry**. These can be filled manually or auto-populated by the ✦ Suggest button.

### ✦ Suggest (AI Prospect Suggestion)

`POST /api/admin/marketing/generate/outreach-suggest` — sends the active template type to Claude, which returns a realistic ICP-matched prospect as `{ name, company, role, industry }`. The four fields are filled automatically and the admin can then click **✦ Generate** to write the outreach copy.

After suggestion, an **+ Add to Leads** button appears. Clicking it creates a new CRM lead from the suggested prospect (`POST /api/leads`), and the button transitions to "✓ Added" to prevent duplicates.

### ✦ Generate (AI Copy Generation)

`POST /api/admin/marketing/generate/outreach` — sends the template type plus all four prospect fields to Claude. Returns `{ content: string }` — the full outreach message. The content is loaded into an editable textarea.

### Campaign Tagging

A dropdown populated from `GET /api/admin/marketing/campaigns` lets the admin associate the current message with a campaign. When the email is sent, the `campaignId` is recorded against the email event.

### Save Template

The admin can give the content a name and click **Save Template** (`POST /api/admin/marketing/outreach-templates`). Saved templates appear in a collapsible **Saved Templates** panel below, grouped by type. Each saved template can be loaded back into the editor or deleted.

### Send Email

The **Send Email** button opens a `SendDialog` modal. The modal shows:
- **To** — email address (editable)
- **Subject** — prefilled, editable
- **Body** — the generated content (read-only preview)

Clicking **Send** fires `POST /api/admin/marketing/send-outreach`. On success, a green toast confirms delivery. On failure, the error message is displayed inline. After sending, the lead's CRM `notes` field is automatically updated with a timestamped entry (handled server-side).

---

## Section 4 — Content Hub

**Component:** `ContentHubSection`

### Purpose
Generates long-form and short-form marketing content (blog posts, LinkedIn updates, newsletters, social posts, SEO keywords), allows saving assets, and manages a library of saved content.

### Content Type Tabs

| Tab | Content Type |
|-----|-------------|
| Blog Post | `blog_post` |
| LinkedIn | `linkedin_post` |
| Newsletter | `newsletter` |
| Social Posts | `social_posts` |
| SEO Keywords | `seo_keywords` |

### Input Fields

| Field | Purpose |
|-------|---------|
| Topic* | Required — the subject of the content |
| Tone | Optional — e.g. "authoritative", "conversational" |
| Keywords | Optional — comma-separated keywords to weave in |

The asterisk on Topic indicates it is required before generating.

### ✦ Suggest (AI Topic Suggestion)

`POST /api/admin/marketing/generate/content-suggest` — sends the active content type to Claude, which returns `{ topic, tone, keywords }`. All three fields are filled automatically.

### ✦ Generate (AI Content Generation)

`POST /api/admin/marketing/generate/content` — sends the content type, topic, tone, and keywords to Claude. Returns `{ content: string }` — the full piece. Content loads into a scrollable preview area.

### Saving Assets

Clicking **Save Asset** persists the generated content: `POST /api/admin/marketing/campaign-assets` with `assetType` mapped from the tab, `title` (from the Topic field), and `content`. No `campaignId` is set when saved from here (it's a standalone asset).

### Saved Assets List

A panel below the generator lists previously saved assets filtered by the active content type (`GET /api/admin/marketing/campaign-assets?assetType=<type>`). Each item shows its title and a truncated preview.

Actions per saved asset:

| Button | Behaviour |
|--------|-----------|
| Expand / Collapse | Toggles the full content view |
| Copy | Copies the content to the clipboard |
| Delete | `DELETE /api/admin/marketing/campaign-assets/{id}` |

---

## Section 5 — Analytics

**Component:** `TrafficAnalyticsSection`

### Purpose
Visualises website traffic patterns, lead conversion funnels, email send rates, per-campaign revenue, and SEO keyword rankings — all sourced from first-party data stored in the PostgreSQL database.

### Data Loading

On mount: `GET /api/admin/marketing/analytics` and `GET /api/admin/marketing/email-stats` are both called. The analytics endpoint returns a single response object covering all chart data.

### Charts & Panels

| Panel | Type | Window |
|-------|------|--------|
| Visitors | Line chart (Recharts `LineChart`) | Last 7 days, one point per day |
| Traffic Sources | Pie chart (`PieChart`) | Last 30 days, grouped by `utm_source` or Direct/Referral |
| Conversion Funnel | Horizontal bar / funnel | Last 30 days: Visitors → Contact Page Views → Leads → Converted |
| Revenue per Lead | Ranked bar list | All campaigns, sorted by revenue ÷ leadsGenerated (descending) |
| Top Pages | Bar chart | Last 30 days, top 10 pages by view count |
| Email Stats | Summary card | Last 30 days (`EmailStatsCard`) |
| SEO Rankings | Ranked keyword list | All tracked keywords (`SeoRankingsCard`) |

### Revenue per Lead — Inline Edit

Each campaign row in the Revenue per Lead panel has an **Edit** icon. Clicking it expands two inline number inputs: **Leads Generated** and **Revenue ($)**. Saving fires `PATCH /api/admin/marketing/campaigns/{id}` with the updated values, then refreshes the analytics data.

### Email Stats Card (`EmailStatsCard`)

`GET /api/admin/marketing/email-stats` returns aggregate counts for the last 30 days: total emails sent, delivered, opened, clicked, bounced. Displayed as a simple stat grid. (Note: open/click/bounce tracking requires inbound webhook events; without them these counts will show zero.)

### SEO Rankings Card (`SeoRankingsCard`)

A self-contained card with its own data fetching (`GET /api/admin/marketing/seo-rankings`). Features:

**Keyword list:** Each row shows position number (colour-coded: emerald ≤3, blue ≤10, amber ≤20, grey >20), keyword, optional ranking URL, monthly search volume, and a position-change indicator (▲ or ▼ delta vs. `previousPosition`).

**Add / Edit Keyword:** A collapsible inline form with fields: Keyword (required), Position 1–100 (required), Monthly Volume (optional), Ranking URL (optional). Submits `POST` to create or `PATCH /{id}` to update.

**Sync Search Console:** The **↻ Sync Search Console** button calls `POST /api/admin/marketing/seo-rankings/sync-search-console`. The server uses the Google Search Console API (service account) to pull real position data and upserts all keywords. The button shows a spinner during sync; on completion a green banner reports "Synced N keywords — X new, Y updated". If `GOOGLE_SEARCH_CONSOLE_KEY_JSON` or `GOOGLE_SEARCH_CONSOLE_SITE_URL` is missing, the banner shows a clear configuration error with the secret names.

---

## Section 6 — Tasks

**Component:** `MarketingTasksKanban`

### Purpose
A Kanban board for planning and tracking marketing activities. Tasks move through columns by drag-and-drop or via a status dropdown.

### Columns

| Column | Status Value |
|--------|-------------|
| Ideas | `ideas` |
| In Progress | `in_progress` |
| Scheduled | `scheduled` |
| Published | `published` |
| Completed | `completed` |

### Drag-and-Drop

Implemented with `@dnd-kit/core` and `@dnd-kit/sortable`. Dragging a task card from one column and dropping it into another calls `PATCH /api/admin/marketing/tasks/{id}` with the new `status`. The `order` field is also patched to reflect position within the column.

### Status Dropdown

Each card has a ▾ Status dropdown that allows changing the column without dragging. This fires the same PATCH call.

### Add Task

The **+ Add Task** button reveals an inline form with **Title** (required) and **Description** (optional) fields. Submitting calls `POST /api/admin/marketing/tasks` with `status = "ideas"` (new tasks always land in the Ideas column).

### ✦ AI Suggest Tasks

`POST /api/admin/marketing/generate/task-suggestions` — asks Claude to produce **6 prioritised, actionable marketing tasks** tailored to Shane's services and ICP. Returns a JSON array of `{ title, description }` objects.

A modal opens showing all 6 suggestions as checkboxes (all pre-checked). The admin can deselect any they don't want, then click **Add N Tasks** to batch-create the selected ones. Each selected task is created via `POST /api/admin/marketing/tasks`.

### Delete Task

A × button on each card calls `DELETE /api/admin/marketing/tasks/{id}` and removes the card immediately.

---

## Section 7 — Campaigns

**Component:** `CampaignBuilderWizard`

### Purpose
A guided 5-step wizard to define and save a marketing campaign, generate a preview of four AI-written campaign assets, and then track performance metrics over time.

### Wizard Steps

| Step | Label | Field |
|------|-------|-------|
| 1 | Goal | Campaign goal (free text) |
| 2 | Audience | Target audience description |
| 3 | Offer | Compelling offer description |
| 4 | Review | Preview generated assets |
| 5 | Saved | Campaign saved — view metrics |

A horizontal stepper displays progress. Completed steps are shown in Electric Blue (#0078D4); future steps are grey.

### Campaign Name

An optional **Campaign Name** field is available throughout all steps. If left blank, it defaults to `"Campaign <today's date>"`.

### ✦ AI Fill (Per Step)

Each of steps 1–3 has a **✦ AI Fill** button:

`POST /api/admin/marketing/generate/campaign-suggest` with `{ field, name, goal, audience }`.

The server uses the current campaign context plus ICP data to suggest a value for the specific field. The response is `{ value: string }` and populates the field automatically. The button shows a spinner and is disabled while generating.

### Step 3 → Step 4: Preview Campaign

After filling all three fields, **Preview Campaign** calls `POST /api/admin/marketing/campaigns/preview-assets` with `{ name, goal, audience, offer }`. The server uses Claude to generate four campaign assets in one request:

| Asset Type | Description |
|------------|-------------|
| `landing_copy` | Landing page / hero copy |
| `email_sequence` | Cold email sequence (multi-step) |
| `social_post` | Social media post |
| `follow_up_task` | A concrete follow-up action |

The response is an array of `{ assetType, title, content }` objects. Each asset is displayed as an expandable card on step 4.

### Step 4 → Step 5: Confirm & Save

**Confirm & Save**:
1. `POST /api/admin/marketing/campaigns` — creates the campaign record with `status = "draft"`
2. `POST /api/admin/marketing/campaigns/save-assets` — bulk-inserts all four preview assets linked to the new campaign ID

After saving, the wizard advances to step 5. The new campaign is prepended to the **Saved Campaigns** list.

### Saved Campaigns List

Displayed alongside the wizard (right column on desktop). Populated by `GET /api/admin/marketing/campaigns` on mount. Each campaign shows name, status badge, creation date, and an asset count. Clicking a campaign selects it and opens its `CampaignMetricsPanel`.

### Campaign Metrics Panel (`CampaignMetricsPanel`)

A details panel rendered for the selected campaign showing:

**Display tiles:** Leads Generated · Emails Sent · Revenue

The Emails Sent tile has three display modes:
- **Auto-tracked** — `emailsSentAuto` (count from `email_events`) is shown with a blue "auto-tracked" badge
- **Manual override** — if `emailsSent` > 0, the manual value is shown with an amber "override (N auto)" badge
- **Manual only** — if no auto data exists, the manual value is shown with a grey "manual" badge

**Inline edit form:** Three number inputs for Leads Generated, Emails Sent (manual override), and Revenue ($). Saving calls `PATCH /api/admin/marketing/campaigns/{id}` and updates both the panel and the Saved Campaigns list.

### Starting a New Campaign

A **+ New Campaign** button (shown on step 5) resets all wizard state and returns to step 1.

---

## AI Integration

All AI features use **Anthropic Claude** via the `@anthropic-ai/sdk`. The model is:
- `claude-opus-4-5` for the heavy generation endpoints (full outreach copy, full content pieces, campaign preview assets)
- `claude-haiku-4-5` for lightweight suggestion endpoints (prospect suggestions, content idea suggestions, task suggestions, campaign field suggestions, recommended leads)

### ICP Context (`buildICPContext()`)

A helper function queried before every AI call that enriches prompts with live CRM data:
- Top industries by lead count
- Most common company sizes
- Most common lead sources
- Average lead score (if available)
- Lead-to-conversion rate

This ensures AI suggestions are grounded in Shane's actual client base rather than generic personas.

### JSON Parsing & Validation

All Claude responses that return structured JSON are parsed with `parseAiJson<T>(text, zodSchema)`. If the response is not valid JSON or fails Zod validation, the helper throws an `AiResponseError`. The route returns `422 Unprocessable Entity` in this case. This prevents silent bad data from reaching the frontend.

### Compliance Constraint

The recommended-leads prompt explicitly excludes NASA employees, federal government employees, and anyone at organisations that could create a conflict of interest with Shane's primary employment at NASA.

---

## Email Delivery

Outreach emails are sent via **Microsoft Graph API** (Exchange Online), not SMTP or a transactional email service.

The `sendMessage()` helper (in `lib/graph-mail.ts`) is called with:
- `userId` — from `GRAPH_MAIL_USER_ID` environment variable (Shane's Microsoft 365 mailbox UPN or ID)
- `to` — array with the recipient email address
- `subject` and `body` — from the outreach content
- `bodyType` — `"text"` (default) or `"html"`
- `saveToSentItems: true` — the sent message appears in Shane's Sent Items folder

If `GRAPH_MAIL_USER_ID` is not set, the endpoint returns `503 Service Unavailable` with a descriptive message. If the Graph API rejects the send, the endpoint returns `502`.

After a successful send:
1. An `email_events` record is inserted (`eventType = "sent"`) linked to the `leadId` and `campaignId` if provided.
2. The associated lead's `notes` field is updated with a timestamped entry: `[Jun 15, 2025, 02:30 PM] Outreach email sent to: name@example.com — Subject: "..."`.

---

## Data Persistence

All marketing data lives in the shared PostgreSQL database (accessed via `@workspace/db` and Drizzle ORM).

| Table | Purpose |
|-------|---------|
| `recommended_leads` | AI-generated lead suggestions with status and fit scores |
| `outreach_templates` | Saved outreach message templates (all four types) |
| `marketing_tasks` | Kanban task cards with status and order |
| `campaigns` | Campaign records with goal, audience, offer, and metrics |
| `campaign_assets` | Content pieces linked to a campaign |
| `seo_rankings` | Keyword → position → volume → URL mappings |
| `email_events` | Record of every sent email with lead/campaign linkage |
| `analytics_sessions` | Website session records (source, referrer, UTM, start time) |
| `analytics_pageviews` | Per-page view records linked to sessions |

The `campaigns` table includes both `emails_sent` (manual override field) and an auto-computed `emails_sent_auto` column (a join aggregate over `email_events` with `event_type = "sent"`).

---

## API Reference

All routes require `Authorization: Bearer <password>` and return JSON. Errors return `{ error: string }`.

### KPI

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/marketing/kpi` | Four KPI values |

### Recommended Leads

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/marketing/recommended-leads` | List all recommended leads |
| POST | `/api/admin/marketing/recommended-leads/generate` | Generate 7 AI-recommended leads |
| POST | `/api/admin/marketing/recommended-leads/{id}/convert` | Convert to CRM lead |
| PATCH | `/api/admin/marketing/recommended-leads/{id}` | Update status (e.g. dismiss) |
| DELETE | `/api/admin/marketing/recommended-leads/{id}` | Hard delete |

### Outreach Templates

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/marketing/outreach-templates` | List all saved templates |
| POST | `/api/admin/marketing/outreach-templates` | Save a new template |
| PATCH | `/api/admin/marketing/outreach-templates/{id}` | Update template |
| DELETE | `/api/admin/marketing/outreach-templates/{id}` | Delete template |

### Marketing Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/marketing/tasks` | List all tasks (ordered by `order`, then `createdAt` desc) |
| POST | `/api/admin/marketing/tasks` | Create a task |
| PATCH | `/api/admin/marketing/tasks/{id}` | Update status, order, or fields |
| DELETE | `/api/admin/marketing/tasks/{id}` | Delete task |

### Campaigns

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/marketing/campaigns` | List campaigns with `emailsSentAuto` join count |
| POST | `/api/admin/marketing/campaigns` | Create campaign (status defaults to `draft`) |
| PATCH | `/api/admin/marketing/campaigns/{id}` | Update any campaign field or metrics |
| DELETE | `/api/admin/marketing/campaigns/{id}` | Delete campaign |
| GET | `/api/admin/marketing/campaigns/{id}/assets` | List assets for one campaign |

### Campaign Assets

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/marketing/campaign-assets` | List assets (`?campaignId=N&assetType=X`) |
| POST | `/api/admin/marketing/campaign-assets` | Create one asset |
| PATCH | `/api/admin/marketing/campaign-assets/{id}` | Update asset |
| DELETE | `/api/admin/marketing/campaign-assets/{id}` | Delete asset |
| POST | `/api/admin/marketing/campaigns/save-assets` | Bulk-insert assets for a campaign |
| POST | `/api/admin/marketing/campaigns/preview-assets` | AI-generate 4 preview assets |

### Email & Outreach

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/marketing/send-outreach` | Send email via Exchange Online |
| GET | `/api/admin/marketing/leads/{id}/emails` | Email history for a lead |
| GET | `/api/admin/marketing/email-stats` | 30-day email aggregate stats |

### Analytics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/marketing/analytics` | All chart data (visitors, sources, funnel, campaign perf, top pages) |

### SEO Rankings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/marketing/seo-rankings` | List all tracked keywords |
| POST | `/api/admin/marketing/seo-rankings` | Add a keyword |
| PATCH | `/api/admin/marketing/seo-rankings/{id}` | Update position / volume / URL |
| DELETE | `/api/admin/marketing/seo-rankings/{id}` | Remove keyword |
| POST | `/api/admin/marketing/seo-rankings/sync-search-console` | Pull live positions from Google Search Console |

### AI Generation

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/marketing/generate/outreach` | Generate outreach copy for a prospect |
| POST | `/api/admin/marketing/generate/outreach-suggest` | Suggest a prospect (name/company/role/industry) |
| POST | `/api/admin/marketing/generate/content` | Generate long-form content |
| POST | `/api/admin/marketing/generate/content-suggest` | Suggest a content topic, tone, and keywords |
| POST | `/api/admin/marketing/generate/task-suggestions` | Suggest 6 prioritised marketing tasks |
| POST | `/api/admin/marketing/generate/campaign-suggest` | Suggest a value for one campaign field |

---

## Configuration & Secrets

| Secret / Env Var | Section | Effect if Missing |
|------------------|---------|-------------------|
| `CRM_ADMIN_PASSWORD` | All | All routes return 401 |
| `ANTHROPIC_API_KEY` | All AI features | AI generation fails at runtime |
| `GRAPH_MAIL_USER_ID` | Email delivery | Send Outreach returns 503 |
| `GRAPH_CLIENT_ID` + `GRAPH_CLIENT_SECRET` + `GRAPH_TENANT_ID` | Email delivery | Graph API calls fail (auth error) |
| `GOOGLE_SEARCH_CONSOLE_KEY_JSON` | SEO Rankings sync | Sync returns an error; manual entry still works |
| `GOOGLE_SEARCH_CONSOLE_SITE_URL` | SEO Rankings sync | Same as above |

The Google Search Console secrets are documented in `replit.md` under "Google Search Console Secrets". The Microsoft Graph secrets are shared with the calendar booking feature on the public website.
