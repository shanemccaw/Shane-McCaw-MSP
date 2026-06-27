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

The Marketing Command Center is a single-page section within the Admin Panel that consolidates all outbound marketing operations for Shane McCaw Consulting. It covers lead intelligence, outreach automation, content creation, traffic analytics, task management, and campaign planning — all with AI assistance powered by Claude (Anthropic) via `@workspace/integrations-anthropic-ai`.

The component (`MarketingCommandCenter`) is mounted inside the Admin Panel and uses a shared `fetchWithAuth` helper from `AuthContext` that automatically attaches the `Authorization: Bearer <password>` header to every API call.

---

## Authentication & Access

Every API route under `/api/admin/marketing/...` is protected by the `requireAdmin` middleware, which validates the `Authorization: Bearer <password>` header against the `CRM_ADMIN_PASSWORD` environment variable. Unauthenticated requests receive `401 Unauthorized`.

---

## Navigation Structure

The command center renders a horizontal tab bar. Each tab maps to a React section component:

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

The active tab is stored in local `useState`. Only the active section renders — others are unmounted, so each section re-fetches its data on mount.

---

## Section 0 — AI Leads

**Component:** `RecommendedLeadsSection`

### Purpose
Generates a batch of AI-recommended prospects matched to Shane's Ideal Customer Profile (ICP), lets the admin review each one, and take direct action (add to CRM, send outreach, dismiss).

### Auto-Generate on Mount

On mount, the component fetches existing leads from `GET /api/admin/marketing/recommended-leads`. If no leads with `status = "pending"` exist, it automatically calls `generate()` without requiring the admin to click a button. This `hasFetched` guard (via `useRef`) prevents re-triggering on re-renders.

### Generating Leads

The **Generate Leads** button calls `POST /api/admin/marketing/recommended-leads/generate`. New leads are prepended to the existing list (`setLeads(prev => [...newLeads, ...prev])`). The server uses all of `buildICPContext()` (see [AI Integration](#ai-integration)) and asks Claude (`claude-haiku-4-5`, max 2000 tokens) to produce 7 recommended leads.

The Claude prompt includes a compliance constraint:

> Shane McCaw is a full-time federal employee (NASA). He is legally prohibited from contracting with: (1) other federal agencies, government departments, national laboratories, DoD components, or any other government entity; (2) any commercial company that holds, pursues, or is known to be a prime or subcontractor on NASA contracts. Only recommend private-sector, commercially-focused companies with NO known NASA or federal prime/sub contract relationships.

Each lead returned by Claude is a JSON object with: `name`, `company`, `role`, `email`, `industry`, `companySize`, `location`, `painPoints` (string array), `whyFit` (one-sentence explanation), `recommendedService` (service name), `confidence` (integer 0–100).

The server parses the JSON array with `parseAiJson`, inserts all rows into `recommended_leads`, and returns the inserted records.

### Lead Cards

The lead list renders as a responsive grid (1-2-3 columns at sm/md/xl). Only leads with `status = "pending"` are shown. Each card displays:

- Name, role, company, email (if present)
- `confidence` badge (colour-coded: green ≥80, yellow ≥60, grey <60)
- Industry, company size, location, `recommendedService` badges
- `whyFit` text (truncated to 2 lines via `line-clamp-2`)
- Up to 2 `painPoints` as red tags
- A green "Draft saved" indicator if a generated outreach draft exists in `generatedDrafts[lead.id]` or `lead.lastOutreachDraft`

**The entire card is clickable** — clicking anywhere (outside the action buttons) opens the `RecommendedLeadSlideOver`. Action buttons along the bottom of the card (described below) use `e.stopPropagation()` to avoid triggering the slide-over when clicked directly.

### Card Action Buttons (on the card itself)

| Button | Action |
|--------|--------|
| Add to Leads | Calls `convert(lead.id)` — see Convert below |
| Email | Opens `OutreachModal` with `cold_email` type, passing `recommendedLeadId` |
| LinkedIn | Opens `OutreachModal` with `linkedin` type |
| Follow-Up Seq. | Opens `OutreachModal` with `followup` type |
| Add Task | Opens `AddTaskModal` |
| Add to Campaign | Opens `AddToCampaignModal` |
| Dismiss | Calls `dismiss(lead.id)` — see Dismiss & Undo below |

### Slide-Over Panel (`RecommendedLeadSlideOver`)

Title: **"AI Lead Details"**. Fixed full-height panel on the right side with a dark scrim on the left. Clicking the scrim closes it.

Content displayed:
- Name, role, company, email (clickable `mailto:` link), industry badge, company size badge, location badge
- **Recommended Service** block (if present)
- **Why They Fit** block (labelled "Why They Fit" in Electric Blue) containing `whyFit`
- **Pain Points** list — each item preceded by a red dot
- A green "Outreach draft saved" banner if a draft exists in `generatedDrafts[lead.id]`

Action buttons in the slide-over footer:

| Button | Action |
|--------|--------|
| Add to Leads | `convert(lead.id)` then closes slide-over |
| Email | Opens `OutreachModal` with `cold_email` type, closes slide-over |
| LinkedIn | Opens `OutreachModal` with `linkedin` type, closes slide-over |
| Follow-Up Seq. | Opens `OutreachModal` with `followup` type, closes slide-over |
| Add Task | Opens `AddTaskModal`, closes slide-over |
| Add to Campaign | Opens `AddToCampaignModal`, closes slide-over |
| Dismiss Lead | Calls `dismiss(lead.id)`, closes slide-over |

### Convert to CRM Lead

`POST /api/admin/marketing/recommended-leads/{id}/convert`

The body includes `{ outreachDraft: string | null }` — if a draft exists in `generatedDrafts[id]`, it is sent along.

The server creates a `leads` record with:
- `source = "ai_recommended"`, `status = "contacted"`, `stage = "AQL"`
- A generated email fallback (`firstname.lastname@company.com`) if no email was provided
- `notes` containing a timestamped entry plus `whyFit`, `recommendedService`, `confidence`, and the outreach draft (if any)
- `painPoints` copied from the recommended lead

Then the `recommended_leads` row is updated to `status = "converted"` with `convertedLeadId` pointing to the new lead.

The frontend marks the card as `status = "converted"` immediately (optimistic update), hiding it from the pending list.

### Dismiss & Undo

Dismissing a lead hides it from the list immediately (optimistic `status = "dismissed"` update).

**With a saved draft** (`generatedDrafts[id]` or `lead.lastOutreachDraft`): A fixed-position undo toast appears at the bottom of the screen showing "{leadName} dismissed — saved draft will be lost" with an **Undo** button. The actual `PATCH /api/admin/marketing/recommended-leads/{id}/dismiss` call is deferred for 5 seconds. If the admin clicks Undo within that window, the timer is cleared, the card is restored to `status = "pending"`, and no PATCH is sent.

**Without a saved draft**: The PATCH call fires immediately. No toast is shown.

### Supporting Modals

**`AddTaskModal`**: Prepopulates Title with `"Outreach: {name} @ {company}"` and Description with `lead.whyFit`. Saving calls `POST /api/admin/marketing/tasks` with `status = "ideas"`.

**`AddToCampaignModal`**: Shows a list of all campaigns (fetched from `GET /api/admin/marketing/campaigns`). Selecting one and saving calls `POST /api/admin/marketing/campaign-assets` with `assetType = "follow_up_task"` and `content` containing the lead's fields (name, company, role, email, whyFit, painPoints, recommendedService). This creates a campaign asset linked to the selected campaign — it does not tag the lead record itself.

---

## Section 1 — KPIs

**Component:** `KPIStrip`

### Purpose
Four summary tiles showing at-a-glance marketing health.

### Metrics

| Tile | Icon | Description |
|------|------|-------------|
| Visitors Today | 👁 | Count of `analytics_sessions` rows where `startedAt >= today's midnight (UTC local)` |
| Leads This Week | 🎯 | Count of `leads` rows where `createdAt >= 7 days ago` |
| Conversion Rate | 📈 | Count of `analytics_site_events` with `event_type = "cta_click"` and `createdAt >= 7 days ago` ÷ Visitors Today × 100, formatted to one decimal place (e.g. `"3.7"`) |
| Active Campaigns | 🚀 | Count of `campaigns` with `status = "active"` |

### Data Loading

On mount: `GET /api/admin/marketing/kpi` — returns `{ visitorsToday, leadsThisWeek, conversionRate, activeCampaigns }`. While loading, all four tiles show an animated skeleton placeholder. On error, tiles show `"—"`.

The `conversionRate` is returned as a **string** (e.g. `"3.7"`) by the server, not a number. The frontend renders it as `${kpi.conversionRate}%`.

---

## Section 2 — Lead Finder

**Component:** `LeadFinderSection`

### Purpose
A searchable, filterable table over CRM lead records for quickly finding a lead and launching outreach or checking email history.

### Data Loading

`GET /api/leads?limit=100` — fetches the latest 100 CRM leads. This is the shared CRM leads endpoint (not a marketing-specific one).

### Search & Filters

| Control | Behaviour |
|---------|-----------|
| Search box | Client-side filter on `name`, `company`, `email`, `industry` (case-insensitive substring) |
| Status dropdown | `new` / `contacted` / `qualified` / `converted` / `archived` |
| Source dropdown | `ai_suggested` / `ai_recommended` / `contact_form` / `lead_magnet` |
| Industry dropdown | Dynamically built from unique `industry` values in the loaded set |
| Company Size dropdown | Dynamically built from unique `companySize` values |
| Location dropdown | Dynamically built from unique `location` values; only rendered when ≥1 location exists |

All filters apply simultaneously (AND logic). Up to 50 matched leads are shown; a footer shows "Showing N of M leads" when M > 50.

### Table Columns

`Name / Email` · `Company / Location` · `Industry / Size` · `Source` (colour-coded badge) · `Status` (badge) · `Stage` (MQL/SQL/AQL badge) · `Score` (mono number) · `Actions`

Source badge colours: violet for `ai_recommended`, teal for `lead_magnet`, blue for `contact_form`, grey for all others.

### Row Actions

| Button | Behaviour |
|--------|-----------|
| Email | Opens `OutreachModal` with `cold_email` type, passing `leadId` |
| LinkedIn | Opens `OutreachModal` with `linkedin` type |
| Follow-Up | Opens `OutreachModal` with `followup` type |
| Call Script | Opens `OutreachModal` with `cold_call` type |
| History | Opens `LeadEmailHistoryModal` |

### Outreach Modal (`OutreachModal`)

A full-screen dialog (z-50) for generating and managing outreach content for a specific lead. It accepts either `leadId` (CRM lead) or `recommendedLeadId` (recommended lead); the server uses whichever is present to pre-fill lead data from the database.

The modal header shows "Generate Outreach — {leadName}". Four type tabs at the top: **Cold Email** / **LinkedIn** / **Follow-Up Seq.** / **Cold Call Script**. Switching tabs clears the content area and sets a new `selectedType`.

Clicking **Generate** (or **Regenerate** if content already exists) calls `POST /api/admin/marketing/generate/outreach` with `{ leadId?, recommendedLeadId?, name, templateType }`. The response `{ content }` is displayed in a `<pre>` block with a **Copy** button in the top-right corner.

When content is present, a footer row appears with:
- A text input for a template name + **Save Template** button (calls `POST /api/admin/marketing/outreach-templates` then closes the modal)
- A **Send Email** button — only shown for `cold_email`, `followup`, and `newsletter` types (not for `linkedin` or `cold_call`). Clicking this opens the `SendEmailModal`.

When a draft is generated for a `recommendedLeadId`, the server saves it to `recommended_leads.last_outreach_draft` automatically. The component fires the `onGenerated` callback (if provided) so the parent can track the draft.

### Send Email Modal (`SendEmailModal`)

A modal (z-60, above the Outreach Modal) titled **"Send via Exchange Online"** with subtitle "Sends from Shane's Exchange mailbox via Microsoft Graph".

All three fields are editable:
- **To** — editable text input (pre-filled with lead email)
- **Subject** — editable text input (pre-filled by extracting `SUBJECT: …` from the generated content via regex)
- **Body** — editable 10-row monospace textarea (pre-filled with the full generated content)

There is also a **Campaign (optional)** dropdown, populated from `GET /api/admin/marketing/campaigns`, to attribute the send to a campaign.

Clicking **Send Email** calls `POST /api/admin/marketing/send-outreach`. On success, the modal shows a green ✓ confirmation and closes after 1.8 seconds. On failure, an error panel appears (amber for 503/401/403 config errors; red for other errors).

### Email History Modal (`LeadEmailHistoryModal`)

Title: "Email History — {lead.name}". Fetches `GET /api/admin/marketing/leads/{id}/emails` and displays a chronological list of `email_events` records. Each row shows subject, recipient ("To: …"), event type badge, and sent timestamp. Footer shows "N email(s) in history".

---

## Section 3 — Outreach

**Component:** `OutreachAutomationSection`

### Purpose
Generates personalised outreach copy for a prospect, saves reusable templates, and sends email directly via Exchange Online.

### Tabs

| Tab Label | `templateType` |
|-----------|----------------|
| Cold Email | `cold_email` |
| LinkedIn | `linkedin` |
| Follow-Up Seq. | `followup` |
| Cold Call Script | `cold_call` |

### Prospect Fields

Four text inputs: **Name**, **Company**, **Role**, **Industry**. Filled manually or via ✦ Suggest.

### ✦ Suggest (AI Prospect Suggestion)

`POST /api/admin/marketing/generate/outreach-suggest` — sends the active template type. Claude returns `{ name, company, role, industry }` for an ICP-matched prospect. All four fields are auto-filled.

After suggestion, an **+ Add to Leads** button appears. Clicking it calls `POST /api/admin/leads` (the admin lead creation endpoint, not `/api/leads`) with `{ name, company, role, industry, source: "ai_suggested" }`. The button transitions to "✓ Added" after success to prevent duplicates.

### ✦ Generate (AI Copy Generation)

`POST /api/admin/marketing/generate/outreach` — sends `{ templateType, name, company, role, industry }`. Returns `{ content }` loaded into an editable textarea.

### Campaign Tagging

A dropdown (populated from `GET /api/admin/marketing/campaigns`) lets the admin tag the current content to a campaign. The selected `campaignId` is passed when sending.

### Save Template

A name input + **Save Template** button — calls `POST /api/admin/marketing/outreach-templates`. Saved templates appear in a collapsible **Saved Templates** panel below the editor. Each template can be loaded back into the editor or deleted.

### Send Email

The **Send Email** button opens the `SendEmailModal` (see [above](#send-email-modal-sendemailmodal)) pre-filled with the lead email and generated content. The `campaignId` from the tag dropdown is passed through.

---

## Section 4 — Content Hub

**Component:** `ContentHubSection`

### Purpose
Generates marketing content across five formats, saves assets, and manages a library of saved content.

### Content Type Tabs

| Tab | `contentType` |
|-----|--------------|
| Blog Post | `blog_post` |
| LinkedIn | `linkedin_post` |
| Newsletter | `newsletter` |
| Social Posts | `social_post` |
| SEO Keywords | `seo_keywords` |

### Input Fields

| Field | Purpose |
|-------|---------|
| Topic | Required — the subject of the content |
| Tone | Optional (e.g. "authoritative", "conversational") |
| Keywords | Optional — comma-separated keywords |

### ✦ Suggest

`POST /api/admin/marketing/generate/content-suggest` — sends the active `contentType`. Claude returns `{ topic, tone, keywords }`. All three fields are auto-filled.

### ✦ Generate

`POST /api/admin/marketing/generate/content` — sends `{ contentType, topic, tone, keywords }`. Returns `{ content }` displayed in a preview area.

### Saving Assets

**Save Asset** calls `POST /api/admin/marketing/campaign-assets` with `{ assetType, title: topic, content }`. No `campaignId` is attached (standalone asset).

### Saved Assets List

Filtered by active content type (`GET /api/admin/marketing/campaign-assets?assetType=<type>`). Each item shows title and a truncated preview.

Actions per saved asset:

| Button | Behaviour |
|--------|-----------|
| Expand / Collapse | Toggles full content view |
| Copy | Copies content to clipboard |
| Delete | `DELETE /api/admin/marketing/campaign-assets/{id}` |

---

## Section 5 — Analytics

**Component:** `TrafficAnalyticsSection`

### Purpose
Visualises website traffic, conversions, email sends, campaign ROI, and SEO rankings from first-party PostgreSQL data.

### Data Loading

On mount: `GET /api/admin/marketing/analytics` (all chart data) and `GET /api/admin/marketing/email-stats` (email totals) are fetched. Both are independent fetches within the component.

### Charts & Panels

The section renders in a 2-column grid (full-width at mobile, 2-column at lg):

| Panel | Chart Type | Data Window |
|-------|-----------|-------------|
| Visitors (Last 7 Days) | `LineChart` (Recharts) | 7-day daily visitor counts from `analytics_sessions` |
| Traffic Sources | `PieChart` | 30-day sessions grouped by `utm_source` or Direct/Referral |
| Conversion Funnel (30 Days) | `FunnelChart` | 4 stages: Visitors → Contact Page → Leads → Converted |
| Revenue per Lead by Campaign | Ranked bar list with inline edit | All campaigns sorted by `revenueAttributed ÷ leadsGenerated` descending; campaigns with 0 leads show `—` |
| Top Pages (Last 30 Days) | Horizontal `BarChart` | Top 10 pages by view count from `analytics_pageviews` |
| Email Stats | Summary card (`EmailStatsCard`) | 30-day `email_events` totals |
| SEO Rankings | Keyword list (`SeoRankingsCard`) | All tracked keywords from `seo_rankings` |

The Revenue per Lead panel uses a full-width `lg:col-span-2` layout. The top campaign gets an Electric Blue `★ Top` badge and a highlighted progress bar. The next panel (Top Pages) is also `lg:col-span-2`.

### Revenue per Lead — Inline Edit

Clicking the pencil icon on any campaign row expands two inline inputs: **Leads Generated** and **Revenue Attributed ($)**. Saving calls `PATCH /api/admin/marketing/campaigns/{id}` then reloads the analytics data.

### Email Stats Card (`EmailStatsCard`)

`GET /api/admin/marketing/email-stats` returns:
```json
{ "totalSent": 42, "hasData": true, "dailyTrend": [{ "day": "2025-06-15", "sent": 5 }, ...] }
```

When `hasData` is false, the card shows a placeholder. When true, it displays `totalSent` as a large number and renders `dailyTrend` as a sparkline (7-day view of sent-per-day counts). Note: The endpoint only tracks `sent` events from `email_events` — open/click/bounce event data is only present if those events are recorded separately; the response does not include those counts.

### SEO Rankings Card (`SeoRankingsCard`)

See [SEO Rankings](#seo-rankings) under the API Reference for endpoint details.

**Keyword list:** Each row shows position number (colour-coded: emerald ≤3, blue ≤10, amber ≤20, grey >20), keyword, optional ranking URL, monthly search volume, and position-change indicator (▲ or ▼ + delta vs. `previousPosition`).

**Add / Edit Keyword:** Collapsible inline form: Keyword (required), Position 1–100 (required), Monthly Volume (optional), Ranking URL (optional). Submits `POST` to create or `PATCH /{id}` to update. On `PATCH`, the server stores the old position as `previousPosition` before updating.

**↻ Sync Search Console:** Calls `POST /api/admin/marketing/seo-rankings/sync-search-console`. The server calls the Google Search Console API (service account via `GOOGLE_SEARCH_CONSOLE_KEY_JSON`) to pull the top 100 queries for the last 28 days, then upserts each into `seo_rankings`. On upsert, the `notes` field is set to "Last synced from Search Console (N clicks, M impressions)". Returns `{ synced, inserted, updated }`. The UI shows a green success banner for 6 seconds. If either `GOOGLE_SEARCH_CONSOLE_KEY_JSON` or `GOOGLE_SEARCH_CONSOLE_SITE_URL` is missing, the response is `400` with an error message naming the missing secret.

---

## Section 6 — Tasks

**Component:** `MarketingTasksKanban`

### Purpose
A Kanban board for planning and tracking marketing activities via drag-and-drop or dropdown status changes.

### Columns

| Column Label | Status Value | Colour |
|--------------|-------------|--------|
| Ideas | `ideas` | Grey |
| In Progress | `in_progress` | Amber |
| Scheduled | `scheduled` | Blue |
| Published | `published` | Emerald |
| Completed | `completed` | (default) |

### Drag-and-Drop

Implemented with `@dnd-kit/core` (`DndContext`, `PointerSensor`, `KeyboardSensor`) and `@dnd-kit/sortable` (`SortableContext`, `useSortable`). Each column is a `DroppableColumn` using `useDroppable`. Dropping a card into a different column calls `PATCH /api/admin/marketing/tasks/{id}` with the new `status`. Reordering within a column uses `arrayMove` on the local state and patches the `order` field.

### Status Dropdown

Each card has a ▾ Status dropdown showing all five column values. Changing it fires the same PATCH call. No drag required.

### Add Task (Inline Form)

The **+ Add Task** button toggles an inline form with two fields:
- **Title** (required text input)
- **Description** (optional text input)

Submitting calls `POST /api/admin/marketing/tasks` with `status = "ideas"`. No due date or priority fields exist in this form.

### ✦ AI Suggest Tasks

`POST /api/admin/marketing/generate/task-suggestions` — Claude produces 6 prioritised marketing tasks as `[{ title, description }]`.

A modal opens listing all 6 as checkboxes (all pre-checked). The footer shows "N of 6 selected". The **Add N Tasks** button batch-creates the selected ones via individual `POST /api/admin/marketing/tasks` calls, each with `status = "ideas"`. The button is disabled if 0 are selected.

### Delete Task

A × button on each card calls `DELETE /api/admin/marketing/tasks/{id}` and removes the card from state.

---

## Section 7 — Campaigns

**Component:** `CampaignBuilderWizard`

### Purpose
A guided 5-step wizard to define, preview, and save marketing campaigns, then track performance metrics.

### Wizard Steps

| Step | Label | Content |
|------|-------|---------|
| 1 | Goal | Free-text campaign goal |
| 2 | Audience | Target audience description |
| 3 | Offer | Compelling offer description |
| 4 | Review | Preview of 4 AI-generated assets |
| 5 | Saved | Campaign saved — view & edit metrics |

A horizontal stepper shows progress. Steps completed or current are shown in Electric Blue (#0078D4); future steps are grey. A connector line between steps is blue if the previous step is complete.

### Campaign Name

An optional **Campaign Name** field spans all steps. Defaults to `"Campaign <today's date>"` if left blank.

### ✦ AI Fill (Per Step)

Each of steps 1–3 has a **✦ AI Fill** button next to its field. Clicking calls `POST /api/admin/marketing/generate/campaign-suggest` with `{ field: "goal"|"audience"|"offer", name, goal, audience }`. The server returns `{ value: string }` and populates the field. The button shows a spinner and is disabled during generation.

### Step 3 → Step 4: Preview Campaign

**Preview Campaign** calls `POST /api/admin/marketing/campaigns/preview-assets` with `{ name, goal, audience, offer }`. Claude (`claude-haiku-4-5`, max 3000 tokens) returns a JSON object with four keys, which the server maps to `assetType` values:

| JSON Key from Claude | `assetType` stored |
|---------------------|-------------------|
| `landing_copy` | `landing_copy` |
| `email_sequence` | `email_sequence` |
| `social_posts` | `social_post` |
| `follow_up_tasks` | `follow_up_task` |

The response is an array of `{ assetType, title, content }`. Each is displayed as an expandable card on step 4. No database write occurs at this point.

### Step 4 → Step 5: Confirm & Save

**Confirm & Save**:
1. `POST /api/admin/marketing/campaigns` — creates the campaign with `status = "draft"`, returns the new campaign record
2. `POST /api/admin/marketing/campaigns/save-assets` — bulk-inserts all four preview assets linked to the new campaign ID (validated with Zod on the server)

After saving, the wizard advances to step 5. The new campaign is prepended to the **Saved Campaigns** list.

### Saved Campaigns List

Right-column panel (desktop) populated by `GET /api/admin/marketing/campaigns` on mount. Includes `emailsSentAuto` (a join aggregate of `email_events` with `event_type = "sent"`). Clicking a campaign selects it and opens `CampaignMetricsPanel`.

### Campaign Metrics Panel (`CampaignMetricsPanel`)

Three display tiles: **Leads Generated** (emerald) · **Emails Sent** (blue) · **Revenue** (amber, dollar-formatted).

The Emails Sent tile has three display modes based on the data:
- `emailsSentAuto > 0` and `emailsSent = 0` → shows auto count with a blue "auto-tracked" badge
- `emailsSent > 0` and `emailsSentAuto > 0` → shows manual override value with amber "override (N auto)" badge
- `emailsSent > 0` and `emailsSentAuto = 0` → shows manual value with grey "manual" badge

**Inline edit form** (three number inputs): Leads, Emails Sent (labeled "Emails (manual override)" when `emailsSentAuto > 0`), Revenue ($). Saving calls `PATCH /api/admin/marketing/campaigns/{id}`. The button shows "✓ Saved" for 2 seconds after success.

### Starting a New Campaign

A **+ New Campaign** button (shown on step 5) resets all wizard state (`step`, `goal`, `audience`, `offer`, `name`, `previewAssets`, `savedCampaignId`) and returns to step 1.

---

## AI Integration

### Model

All AI generation routes in `admin-marketing.ts` use **`claude-haiku-4-5`** (no route in this file uses a larger model). Token budgets vary by endpoint: 400 for suggest endpoints, 1000–1200 for outreach generation, 1800 for content generation, 2000 for lead generation, 3000 for campaign preview assets.

### ICP Context (`buildICPContext()`)

Called before every AI request. Assembles a context string from four database sources:

1. **Settings table** — keys: `icp_description`, `target_industries`, `ideal_company_size`, `value_proposition`, `differentiators`
2. **Services table** — up to 8 public services with name, description, and target audience
3. **Leads table** — top 10 industry + company\_size combinations by frequency
4. **`quiz_pain_signal_config` table** — up to 8 category pain signal names

If all four sources return empty, the context defaults to a hardcoded fallback: "Microsoft 365 consulting, mid-market (50-2000 employees), IT decision-makers in healthcare, government, finance, or technology sectors".

### JSON Parsing & Validation

`parseAiJson<T>(text, zodSchema)` — strips markdown code fences, parses JSON, and validates against a Zod schema. Throws `AiResponseError` if either step fails. Routes catch this and return `422 Unprocessable Entity` with `{ error: "AI returned an unreadable response — please try again" }` or `"AI returned unexpected format — please try again"`. This prevents silent bad data from reaching the frontend.

---

## Email Delivery

Outreach emails are sent via **Microsoft Graph API** (Exchange Online), not SMTP.

The `sendMessage()` helper (`lib/graphEmail.ts`) is called with:
- `userId` — from `GRAPH_MAIL_USER_ID` env var (Shane's M365 mailbox UPN or object ID)
- `to` — array with one recipient address
- `subject`, `body` — from the submitted form
- `bodyType` — `"text"` (default) or `"html"`
- `saveToSentItems: true` — appears in Shane's Sent Items folder

Error cases:
- `GRAPH_MAIL_USER_ID` not set → `503 Service Unavailable`
- Graph API rejects the send → `502 Bad Gateway`
- `z.ZodError` on input validation → `400 Bad Request` with the first Zod error message

After a successful send:
1. An `email_events` row is inserted with `eventType = "sent"`, `recipient`, `subject`, and optional `campaignId` and `leadId` linkage. The `emailId` is generated as `outreach-{timestamp}-{random}`.
2. If `leadId` was provided, the lead's `notes` field is appended with a timestamped entry: `[Jun 15, 2025, 02:30 PM] Outreach email sent to: {email} — Subject: "{subject}"`.

---

## Data Persistence

All data lives in the shared PostgreSQL database via Drizzle ORM.

| Table | Purpose |
|-------|---------|
| `recommended_leads` | AI-generated prospects with status, confidence, ICP fields, and `last_outreach_draft` |
| `outreach_templates` | Saved outreach message templates (all four types) |
| `marketing_tasks` | Kanban cards with `status`, `order`, `relatedLeadId`, `relatedCampaignId` |
| `campaigns` | Campaign records with goal, audience, offer, `emails_sent` (manual), `leads_generated`, `revenue_attributed` |
| `campaign_assets` | Content pieces linked to a campaign; valid `assetType` values: `landing_copy`, `email_sequence`, `social_post`, `follow_up_task`, `blog_post`, `linkedin_post`, `newsletter`, `seo_keywords` |
| `seo_rankings` | Keyword → `position`, `previousPosition`, `searchVolume`, `url`, `notes`, `checkedAt` |
| `email_events` | Every sent email with `eventType`, `recipient`, `subject`, `campaignId`, `leadId`, `occurredAt`, `metadata` |
| `analytics_sessions` | Website sessions with `startedAt`, `utm_source`, `referrer` |
| `analytics_site_events` | In-session events including `cta_click` (used for KPI conversion rate) |
| `analytics_pageviews` | Per-page view records with `page`, `enteredAt`, linked to session |

---

## API Reference

All routes require `Authorization: Bearer <password>`. Errors return `{ error: string }`.

### KPI

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/marketing/kpi` | Returns `{ visitorsToday, leadsThisWeek, conversionRate, activeCampaigns }` |

### Recommended Leads

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/marketing/recommended-leads` | List up to 40 recommended leads ordered by `generatedAt` desc |
| POST | `/api/admin/marketing/recommended-leads` | Create a lead manually |
| POST | `/api/admin/marketing/recommended-leads/generate` | AI-generate 7 leads; inserts and returns them |
| PATCH | `/api/admin/marketing/recommended-leads/{id}` | Update any field (name, company, role, status, etc.) |
| PATCH | `/api/admin/marketing/recommended-leads/{id}/dismiss` | Sets `status = "dismissed"` |
| POST | `/api/admin/marketing/recommended-leads/{id}/convert` | Creates CRM lead, updates status to `converted` |
| DELETE | `/api/admin/marketing/recommended-leads/{id}` | Hard delete |

### Outreach Templates

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/marketing/outreach-templates` | List all, ordered by `createdAt` desc |
| POST | `/api/admin/marketing/outreach-templates` | Create: `{ name, templateType, subject?, body, leadId? }` |
| PATCH | `/api/admin/marketing/outreach-templates/{id}` | Update any field |
| DELETE | `/api/admin/marketing/outreach-templates/{id}` | Delete |

### Marketing Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/marketing/tasks` | List all, ordered by `order` then `createdAt` desc |
| POST | `/api/admin/marketing/tasks` | Create: `{ title, description?, status?, dueDate?, relatedLeadId?, relatedCampaignId? }` |
| PATCH | `/api/admin/marketing/tasks/{id}` | Update status, order, or any field |
| DELETE | `/api/admin/marketing/tasks/{id}` | Delete |

### Campaigns

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/marketing/campaigns` | List with `emailsSentAuto` (join count of sent email events) |
| POST | `/api/admin/marketing/campaigns` | Create: `{ name, goal, audience, offer, status? }` (defaults to `draft`) |
| PATCH | `/api/admin/marketing/campaigns/{id}` | Update any field including `leadsGenerated`, `emailsSent`, `revenueAttributed` |
| DELETE | `/api/admin/marketing/campaigns/{id}` | Delete |
| GET | `/api/admin/marketing/campaigns/{id}/assets` | List all assets for a campaign |

### Campaign Assets

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/marketing/campaign-assets` | List assets; optional `?campaignId=N&assetType=X` filters |
| POST | `/api/admin/marketing/campaign-assets` | Create one asset |
| PATCH | `/api/admin/marketing/campaign-assets/{id}` | Update title, content, or assetType |
| DELETE | `/api/admin/marketing/campaign-assets/{id}` | Delete |
| POST | `/api/admin/marketing/campaigns/preview-assets` | AI-generate 4 preview assets (no DB write) |
| POST | `/api/admin/marketing/campaigns/save-assets` | Bulk-insert assets: `{ campaignId, assets: [{ assetType, title, content }] }` |

### Email & Outreach

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/marketing/send-outreach` | Send via Exchange Online; body: `{ to, subject, body, leadId?, campaignId?, bodyType? }` |
| GET | `/api/admin/marketing/leads/{id}/emails` | Sent email history for a CRM lead |
| GET | `/api/admin/marketing/email-stats` | Returns `{ totalSent, hasData, dailyTrend: [{ day, sent }] }` for last 30 days |

### Analytics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/marketing/analytics` | Returns `{ dailyVisitors, topPages, trafficSources, conversionFunnel, campaignPerformance }` |

### SEO Rankings

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/marketing/seo-rankings` | List all, ordered by `position` asc |
| POST | `/api/admin/marketing/seo-rankings` | Create: `{ keyword, position, url?, searchVolume?, notes? }` (Zod-validated) |
| PATCH | `/api/admin/marketing/seo-rankings/{id}` | Update; stores old position as `previousPosition` on position change |
| DELETE | `/api/admin/marketing/seo-rankings/{id}` | Delete |
| POST | `/api/admin/marketing/seo-rankings/sync-search-console` | Pull from Google Search Console; upserts top 100 queries (28-day window) |

### AI Generation

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/admin/marketing/generate/outreach` | `{ leadId?, recommendedLeadId?, name?, company?, role?, industry?, painPoints?, templateType }` | Generate outreach copy; fetches lead data from DB if ID provided |
| POST | `/api/admin/marketing/generate/outreach-suggest` | `{ templateType? }` | Suggest prospect `{ name, company, role, industry }` |
| POST | `/api/admin/marketing/generate/content` | `{ contentType, topic, tone?, keywords? }` | Generate long-form content |
| POST | `/api/admin/marketing/generate/content-suggest` | `{ contentType? }` | Suggest `{ topic, tone, keywords }` |
| POST | `/api/admin/marketing/generate/task-suggestions` | (none) | Suggest 6 tasks as `[{ title, description }]` |
| POST | `/api/admin/marketing/generate/campaign-suggest` | `{ field, name?, goal?, audience? }` | Suggest value for one campaign field; returns `{ value }` |

### Admin Lead Creation (Outreach Tab)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/leads` | Create a CRM lead from AI-suggested prospect; `source = "ai_suggested"`, `status = "new"` |

---

## Configuration & Secrets

| Secret / Env Var | Required By | Effect if Missing |
|------------------|-------------|-------------------|
| `CRM_ADMIN_PASSWORD` | All routes | All routes return 401 |
| (Anthropic API key via integration) | All AI features | AI generation fails at runtime |
| `GRAPH_MAIL_USER_ID` | Email delivery | Send Outreach returns 503 |
| `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_TENANT_ID` | Email delivery | Graph API auth fails |
| `GOOGLE_SEARCH_CONSOLE_KEY_JSON` | SEO Rankings sync | Sync returns 400; manual entry still works |
| `GOOGLE_SEARCH_CONSOLE_SITE_URL` | SEO Rankings sync | Same as above |

The Google Search Console secrets are documented in `replit.md` under "Google Search Console Secrets". The Microsoft Graph secrets are shared with the calendar booking feature on the public website.
