# Projects — contract extraction pack

**For Claude Design. Extracted, not authored — every claim below is cited to file:line against
the code on `main`.** Read-only build: no product code, schema or UI were changed to produce this
document. Method per #1642. Issue #1737, Feature #1570 ("Feature: Projects (Portal)"), part of
#1485 (EPIC: Portal).

**Read this before anything else: #1570 itself was retitled from "EPIC:" (structural fix, not a
scope change) and, on 2026-09-13, was deferred to v1.2 and cleared from the v1.1 milestone by
Shane's own decision — comment 6 on #1570. `Design/portal/` has no export for Projects. This pack
exists anyway because #1737 asked for it explicitly, read-only, as prep banked ahead of the v1.2
build — it is documentation, not a page-wiring commitment, and nothing here should be read as
"Design should build this for v1.1."**

---

## 0. This is not one feature — it is three separate subsystems sharing a `projects` table

#1570's own body names `portal-zoho-projects.ts` and `zoho-project-board.tsx` as live routes/pages.
**Neither exists on `main`.** `admin-project-templates.ts` still exists but is a deliberate
tombstone — every route on it 404s with `"project_templates has been removed. Use workflow
templates instead."` (`admin-project-templates.ts:6,10,14,18`). #1570's body is stale on all three
points; treat it as historical framing, not current fact.

What's actually live, and it is **three subsystems**, not one, that happen to converge on the same
`projects` row:

| # | Subsystem | Customer-facing? | Frontend today |
|---|---|---|---|
| A | **Project execution** — `projects`, `workflow_steps`, `kanban_tasks`, `project_updates`, `project_closures`, `documents`, `status_reports` (admin-authored, client-visible once sent) | Yes (view), MSP-authored (author) | Admin: `artifacts/admin-panel` (live). Customer: **no page anywhere** (§1a) |
| B | **MSP-operator SOW/offer lifecycle** — `msp_sows`, `msp_sow_events`, `msp_customer_clickwraps` | Yes (public share-link sign) | MSP: `artifacts/msp-console` Sales module (live). Customer: the public share-link page is **a different Feature's surface** (#1663, already packed — §4) |
| C | **Engagement Projects catalog** — `engagement_projects` (direct-consulting-customer marketing catalog, NOT an MSP-tenant table) | Yes, public/anonymous | `artifacts/shane-mccaw-consulting` (live) |

The glue between A and B is one function, `fulfillAcceptedProjectOffer()` (§3) — it is the only
code path that ever inserts a `projects` row from a signed/accepted offer.

---

## 1. Subsystem A — Project execution

### 1a. `GET /api/portal/projects/:id` — customer surface (ORPHANED, no page)

Source: `artifacts/api-server/src/routes/portal-projects.ts:65-168`. `requireAuth`; scoped to the
caller's own logins via `resolveSiblingUserIds()` (`:71-74`, the #1397 sibling-login bridge) unless
`role === "admin"`. 404 if no matching row.

Response (`:167`): `{ project, steps, tasks, previewTasks, documents, updates, statusReports,
pendingStatusReport, contract, contracts, appliedCoupon }`.

| Field | Type | Notes | Line |
|---|---|---|---|
| `project` | `Project` (raw row, §5) | never null (404 otherwise) | `73` |
| `steps` | `WorkflowStep[]` | ordered by `order`, raw rows | `77-79` |
| `tasks` | `KanbanTask[]` | ordered by `order`, raw rows | `81-83` |
| `previewTasks` | `{ stepId, title, groupName, description }[]` | **synthetic** — for a step with no seeded kanban tasks yet, the route projects the step's *template* tasks (`workflow_template_step_tasks`) as a read-only preview so the customer sees what's coming, not an empty column (`:85-104`) |
| `documents` | `Document[]` | raw rows, `desc(createdAt)` | `106-108` |
| `updates` | `ProjectUpdate[]` | raw rows, `desc(createdAt)` | `110-112` |
| `statusReports` | `StatusReport[]` | **only `reportStatus: "sent"`** (draft reports never leak), scoped by `status_reports.customerId` (#1923, authoritative) OR sibling-login `clientUserId` fallback for pre-#1923 rows (`:117-133`) | `125-133` |
| `pendingStatusReport` | `StatusReport \| null` | first report with `clientStatus` `"pending"` or `"has_questions"` — the only two states that keep a "review this" banner up; `"accepted"` clears it | `136` |
| `contracts` | `{ id, signedAt, signerName, pdfFilename, sharepointFileUrl, sharepointFileId, localFilePath, serviceName }[]` | joined to `services.name`, `desc(signedAt)` | `139-151` |
| `contract` | same shape or `null` | `contracts[0]` — the most recent | `153` |
| `appliedCoupon` | `{ couponCode, discountAmount } \| null` | summed... actually **not summed**, first row only (`limit(1)`, earliest invoice) despite the comment above it describing a sum (`:155-165`) — see the Finding below | `157-165` |

**Finding — `appliedCoupon`'s own code comment doesn't match its code.** The comment at `:155-156`
reads "sum all discount amounts across project invoices sharing the same coupon code" but the
query is `orderBy(createdAt).limit(1)` (`:161-162`) — it returns the **earliest single invoice's**
`discountAmount`, not a sum. If a project has two invoices under the same coupon with different
discount amounts, the response under-reports the total. Not filed — no live rows exist locally to
confirm impact (`invoices` scoped to a real `projectId` with a `couponCode` is untested territory
given `projects` is currently empty), flagged for Design/implementation awareness since the field
name promises more than the code delivers.

**`GET /api/portal/projects/:id/kanban-events`** (`:39-63`) — SSE, token via `?token=` query param
(EventSource can't set headers), same sibling-login bridge for a `role: "client"` token. Emits
`registerSSEClient` frames; payload shape lives in `sse-channels.ts` (not opened for this pack —
the microsoft-changes pack's §4 already documents that helper's generic client-registry shape).

**Orphaned, confirmed this session:**
```
grep -rn "portal/projects" artifacts/portal/src artifacts/shane-mccaw-consulting/src artifacts/msp-console/src
```
returns nothing. Neither `GET /api/portal/projects/:id` nor its SSE sibling has a frontend caller
anywhere in the tree. `portal-v2-projects.tsx`, the page #1570's body names, does not exist —
retired with the rest of portal-v2, never replaced. **Filed as #4024** (sub-issue of #1570, per
this issue's own standing rule).

### 1b. Admin project execution — `admin-projects.ts` (live, wired to `artifacts/admin-panel`)

21 routes total (`admin-projects.ts:88-1020`), all `requireAdmin`. Confirmed live callers:
`artifacts/admin-panel/src/pages/crm/ProjectDetail.tsx`, `Projects.tsx` call the closure,
closure-request and sharepoint-folder routes directly (grep-confirmed this session); the
kanban/workflow-step CRUD routes are the same shapes documented below and used by the same page
tree.

| Route | Method | Purpose | Line |
|---|---|---|---|
| `/admin/projects` | GET | all projects, `desc(createdAt)`, no pagination | `104` |
| `/admin/projects/:id` | GET | one row | `109` |
| `/admin/projects` | POST | create; optional `workflowTemplateId` provisions steps + seeds first-step kanban tasks; optional SharePoint folder auto-create; notifies the client; audit-logs `project_created` | `117-235` |
| `/admin/projects/:id/sharepoint-folder` | POST | manual SharePoint folder create (409 if one exists, 400 if no client/no SharePoint site) | `238` |
| `/admin/projects/:id` | PATCH | partial update; `status: "completed"` auto-revokes active `client_callback_tokens` | `272` |
| `/admin/projects/:id` | DELETE | hard delete; cascades kanban/steps/documents/updates, nulls the FK on `client_services`/`contracts`/`invoices`/`reports` rather than deleting them | `314` |
| `/admin/workflow-steps` | GET | by `projectId` or `clientServiceId` query param | `341` |
| `/admin/workflow-steps/:id` | DELETE | | `351` |
| `/admin/workflow-steps/bulk` | POST | batch-create ordered steps for a project | `358` |
| `/admin/workflow-steps` | POST | single create | `391` |
| `/admin/workflow-steps/:id` | PATCH | status/notes/title/description/dueDate; `completed` stamps `completedAt`, audit-logs, and — if the step belongs to a project — auto-seeds that step's template tasks into the kanban backlog when moved to `in_progress` (`seedKanbanCardsForPhase`, `:505-507`); emits `phase.delivery_date_changed` / `phase_completed` workflow events (fire-and-forget, non-fatal on failure) | `409` |
| `/admin/kanban-tasks` | GET | by `projectId` (required); **enriches** `taskMetadata.linkedRunbook` from the matching template task's `runbookId` via title-similarity match (Jaccard ≥ 0.30) against `powershell_scripts`/`script_modules` — a real, non-trivial derivation, not a straight row read (`:519-626`) | `512` |
| `/admin/kanban-tasks` | POST | create; recomputes `project.progress` (`syncProjectProgress`, `:53-65` — `round(completed/total*100)`); audit-logs; broadcasts `kanban_change` SSE | `631` |
| `/admin/kanban-tasks/:id` | PATCH | update; `deepMerge`s `taskMetadata` rather than replacing it (`:67-86, 696-703`); auto-advances the parent workflow step when a task completes (`advancePhaseIfComplete`); audit-logs by kind (moved/closed/updated/due-date-set); emits `milestone.delivery_date_changed`; broadcasts SSE | `671` |
| `/admin/kanban-tasks/:id/checklist/:itemId/completion-schema` | POST | AI-generated (Claude Haiku) closure-question fields for a just-completed checklist item — 2-5 fields, `{id,label,type,placeholder,required,hint}`; on any failure returns `{ fields: [] }`, never a 500 | `775` |
| `/admin/kanban-tasks/:id/checklist/:itemId` | PATCH | toggles `taskMetadata.checklistState[itemId]`, optionally records `checklistItemData[itemId]` (the AI-question answers, timestamped) | `833` |
| `/admin/kanban-tasks/:id` | DELETE | resyncs project progress + broadcasts | `878` |
| `/admin/projects/:id/report-autofill` | GET | assembles a status-report draft: completed tasks/steps (optionally `since` a date), pending steps, blocked-step count, last-report metadata | `888` |
| `/admin/projects/:id/closure-request` | POST | 422 unless `status === "completed"`; 409 if already requested; creates `project_closures` row; emails the client | `977` |
| `/admin/projects/:id/closure` | GET | 404 if none | `1013` |

**`Project` row shape** (`lib/db/src/schema/index.ts:645-666`): `id, title, description, status
("active"|"on_hold"|"completed"), phase (free text), progress (0-100 int), clientUserId,
startDate, endDate, projectType ("project"|"retainer"|"quick_win"), sharepointFolderUrl,
generatedArtifacts (jsonb array), signedOffAt, signedOffBy, quickWinElapsedSeconds, createdAt,
updatedAt`. **`phase` is free text, not an enum** — no DB constraint, no TS union; whatever the
last `PATCH` wrote stands.

**`KanbanTask.column` real enum is wider than the route's own TS cast.** The DB enum
(`kanbanTasksTable.column`, `index.ts:732`) is `["backlog", "in_progress", "waiting_on_customer",
"review", "completed"]` — **five** values. `POST`/`PATCH /admin/kanban-tasks` (`:642, 685`) cast
incoming `column` to `"backlog" | "in_progress" | "waiting_on_customer" | "completed"` — **four**
values, `"review"` silently missing from the TS union. There is no runtime validation (`as` cast
only), so a client that sends `"review"` today still writes it to a column whose Postgres CHECK
(driven by the same Drizzle enum) accepts it — the gap is compile-time-only, not a live bug, but
the TS type lies about what the column can legally hold. Flagged, not filed (no functional break).

### 1c. `project_closures` row shape

`lib/db/src/schema/index.ts:1612-1626`: `id, projectId (unique — one closure per project),
requestedAt, feedback, permissionGranted, signatureDataUrl, signedAt, signerUserId`. The **customer
signs this somewhere** — the route inventory above has no `POST` that a customer calls to actually
sign a closure (only the admin-side `closure-request`/`closure` GET exist in `admin-projects.ts`,
and §1a's customer route has no closure-sign action). Cross-check:

```
grep -rn "project_closures\|projectClosuresTable" artifacts/api-server/src/routes/portal-*.ts
```
returns nothing. **No customer-facing route writes `project_closures.signedAt` /
`signatureDataUrl` / `permissionGranted`.** The admin page's closure email links to
`${portalBase}/projects/${projectId}` (`admin-projects.ts:1003`) — a URL with no route behind it in
the current portal (§0/§1a: no Projects page exists in `artifacts/portal` at all). **Filed as
#4025** (sub-issue of #1570): the closure-request → client-signs-off loop has an admin half and an
email that links to a customer page, but the customer half (the sign action, and the page to land
on) does not exist anywhere in the current codebase.

---

## 2. Subsystem B — MSP-operator SOW / offer lifecycle (`msp-sow.ts`)

Source: `artifacts/api-server/src/routes/msp-sow.ts`, 1420+ lines, one router, 12 routes. Own
header (`:1-24`) states the model plainly: **platform bills the MSP, not the end customer** — "SOW
signed → charge MSP's Stripe card on file → fulfillment unlocked." Distinct from Subsystem C's
`fulfillAcceptedProjectOffer()` naming coincidence — **this file does not touch `sales_offers`
directly except at acceptance** (§2a); the ongoing SOW lifecycle after that is entirely
`msp_sows`-scoped.

**Confirmed live**, `artifacts/msp-console/src/api/sales-api.ts` (own header lists its exact
endpoint set) drives `artifacts/msp-console/src/console/modules/Sales.tsx` against:
`POST /msp/offers/:offerId/accept`, `GET /msp/sows` (list, filterable by `offerId` since #2643),
`GET /msp/sows/:sowId`, `GET /msp/sows/:sowId/document`, `POST /msp/sows/:sowId/charge`,
`POST /msp/sows/:sowId/expire`.

### 2a. `POST /api/msp/offers/:offerId/accept` — the MSP-operator accept path

`requireCapability("ladder.msp-operator")`. **This is a different accept flow from the
customer-facing `POST /api/portal/offers/:id/accept`** documented in
`docs/portal/offers-and-sow-acceptance-contract-pack.md` §3 — an MSP operator accepting an offer
*on the customer's behalf*, not the customer's own portal accept action. Both ultimately reach
`fulfillAcceptedProjectOffer()` for a project-class offer, but via different entry points
(`msp-sow.ts:183-478` here; `portal-offers.ts:259-268` there).

Branches on the offer's `service.serviceClass` (`:211-278`):
- **`"project"`** (`:270-345`): mints an `mspSowsTable` row directly — `status: "sent"`, real
  `shareToken`/30-day expiry, a locally-generated flat-price HTML document (`generateSowDocument()`
  in this file, `:1400`+ — **not** the AI-priced `document-engine-sow.ts` pipeline Subsystem C
  uses; see the Finding below). Returns `{ outcome: "sow_created", sowId, shareToken, message }`.
- **`"add_on"` / `"subscription"`** (default when no `serviceClass` configured): a free-checkout
  fast path (`amountCents === 0 && allowFreeCheckout`) or a real Stripe Checkout Session
  (`mode: "subscription"` for `billingType === "recurring_monthly"` OR `serviceClass ===
  "subscription"` — the #3634 fix widening a prior narrower check that silently dropped retainers
  into one-time `"payment"` mode). Returns `{ outcome: "checkout_required", checkoutUrl,
  sessionId }` or `{ outcome: "free_activated" }`.
- A **Monitoring Tier** service gates on `minMspPlanTier` (from `typeAttributes`) before either
  branch runs — 402 if the MSP's own platform-subscription tier doesn't qualify (`:196-206`).

**Finding — two different SOW documents exist for the same `service_class = "project"` shape, and
which one a customer sees depends on which accept path fired.** The customer-facing accept
(`portal-offers.ts` → `fulfillAcceptedProjectOffer()`, §3) generates an AI-priced SOW via
`document-engine-sow.ts`, bound to the tenant's real findings. The MSP-operator accept
(`msp-sow.ts:270-345`, and the standalone-SOW route §2b) generates a flat-price HTML document from
the offer's frozen `adjustedPriceCents`, with no engine pricing at all — a different document type
(`insights_generated_documents` vs `mspSowsTable.documentHtml`), a different pricing model, for the
same underlying `service_class = "project"` offer. Both are real, both are live, and #1570's
"SOW ↔ Project cardinality" open question (comment 1) is really two open questions: which
acceptance path a given offer travels, and whether the two document-generation pipelines should
ever converge. Not filed — this is the genuine, unresolved product-shape question #1570 already
named as unsettled, not a code defect either path introduces.

### 2b. Remaining `msp-sow.ts` routes

| Route | Method | Purpose | Wired? | Line |
|---|---|---|---|---|
| `/msp/sows` | POST | standalone SOW, no `offerId` — "used for manual project SOWs" per its own comment | **No frontend caller found** — filed as part of #4024 below | `481` |
| `/msp/sows` | GET | list, filters `status`/`customerId`/`offerId`, `{ items, total, limit, offset }` | Yes (Sales.tsx) | `545` |
| `/msp/sows/:sowId` | GET | full raw row | Yes | `603` |
| `/msp/sows/:sowId/document` | GET | raw HTML, `text/html`; access: MSP user OR the assigned `customerUserId` | Yes (MSP side only) | `625` |
| `/msp/sows/:sowId/sign` | POST | **authenticated** sign (vs the public share-link sign, §4) — same access rule (MSP operator or assigned customer); no frontend caller found anywhere | Part of #4024 | `670` |
| `/msp/sows/:sowId/charge` | POST | manual charge trigger; 409 unless `status` is `"signed"` or `"failed"` | Yes | `772` |
| `/msp/sows/:sowId/expire` | POST | manual expiry; 409 if `"paid"` | Yes | `811` |
| `/msp/customers/:customerId/clickwrap` | GET | `{ required, accepted, acceptedAt?, agreementText? }` — `required: false` when the MSP has no `customerAgreementTemplate` configured | No frontend caller found | `990` |
| `/msp/customers/:customerId/clickwrap` | POST | records acceptance, snapshotting the current template text | No frontend caller found | `1043` |

**Orphaned-endpoint check, this session:**
```
grep -rn "'/api/msp/sows'\|\"/api/msp/sows\"\|clickwrap" artifacts/msp-console/src artifacts/portal/src artifacts/admin-panel/src
```
`POST /msp/sows` (standalone), `POST /msp/sows/:sowId/sign` (authenticated), and both clickwrap
routes: zero matches. **Filed as #4024** (sub-issue of #1570, same issue as §1a's orphan — one
combined finding, four endpoints, all genuinely live and correctly scoped, none currently called
from any frontend).

### 2c. `msp_sows` real enum + status machine

`MSP_SOW_STATUSES = ["draft", "sent", "signed", "paid", "failed", "expired"]` (`msp.ts:3830`).
Transitions actually coded: `draft`/`sent` → `signed` (either sign route, §2b/§4) → (charge
succeeds, outside this file, presumably the Stripe webhook — not opened for this pack) → `paid`;
`signed`/`failed` → charge attempted; any non-`paid` status → `expired` (manual or auto-on-fetch,
`:706-711`, `:876-880`). **`draft` is directly signable** (`:693` accepts `"sent" || "draft"`) —
notably, a standalone SOW created via §2b's `POST /msp/sows` is inserted at `status: "draft"`
(`:517`) and is therefore immediately signable via the authenticated `/sign` route even though it
was never `"sent"` to anyone — there is no explicit "send" action anywhere in this file for a
standalone SOW (the offer-acceptance path inserts directly at `"sent"`, §2a, bypassing `"draft"`
entirely for that path).

`msp_sow_events.eventName` — free text, not a DB enum, per the schema's own comment
(`msp.ts:3916`): `sow.created | sow.sent | sow.signed | sow.charged | sow.paid | sow.failed |
sow.expired`. Confirmed values actually emitted in this file: `sow.created`, `sow.signed`,
`sow.expired` (`:236, 663, 749, 875`) — this pack did not open the charge-handling code
(`triggerMspCharge`, imported, not defined in this file) to confirm whether `sow.charged`/
`sow.paid` are emitted from there.

---

## 3. The glue — `fulfillAcceptedProjectOffer()` (`project-sow-fulfillment.ts`)

No HTTP surface — a plain async function, called fire-and-forget from **three** real call sites:
`portal-offers.ts` (customer accept, already packed), `msp-sow.ts:742` (authenticated sign), and
`msp-sow.ts:976` (public share-link sign). Full module header (`:1-37`) is worth reading verbatim
in the source — it explicitly states what this does NOT do: it does not build a second SOW engine,
and it is not the flat catalog-price HTML `msp-sow.ts`'s own `generateSowDocument()` produces
(§2a's Finding).

**Gate: only fires for `serviceClass === "project"` offers with an `offerId`.** Every early-return
status (`ProjectSowFulfillmentStatus`, `:53-67`): `not_a_project`, `no_service`, `no_customer`,
`no_owner`, `project_create_failed`, `offer_not_found` — each logged, never thrown; a fulfillment
failure must never turn an already-committed accept/sign into an error response (module header,
`:80-84`).

**Real steps when it does fire** (`:86-217`):
1. Resolve the offer's `serviceId` → confirm `serviceClass === "project"`.
2. Resolve the owning `users.id` — the accepting/signing user if known, else
   `resolveCustomerPortalUserId(mspCustomerId)` (the tenant's canonical portal contact).
3. **Insert a real `projects` row** — `title: service.name`, `projectType: "project"`, `status`
   defaults `"active"` (`:160-168`).
4. Kick off `generateSowDocument()` from `document-engine-sow.ts` (the AI-priced pipeline,
   **not** this file's own SOW generator despite the name collision) — narrowed to the one
   accepted candidate via `selectedWorkstreamTitles: [offer.title]`, `forceRegenerate: true`.
5. On success from the `msp-sow.ts` call sites, the resulting `projectId` is written back onto
   `msp_sows.project_id` (`msp-sow.ts:1299-1301`) — the only place that FK is ever populated.

**Standalone SOWs (§2b, no `offerId`) can never reach this function at all** —
`triggerProjectFulfillmentFromSignedSow` (`msp-sow.ts:1276-1287`) returns immediately if
`sow.offerId == null`, logging `"signed SOW has no offerId — no project-class offer to fulfill"`.
**A standalone SOW, once signed, never produces a `projects` row, by design** — the module header
calls this out as a deliberate no-op, not a gap (`msp-sow.ts:21-23`). Design should treat "sign a
standalone SOW" as an end state on its own (charge only), not an on-ramp into Subsystem A's project
execution board — there is currently no code path connecting the two for that specific case.

---

## 4. What's already covered elsewhere — do not re-document

- **`GET /api/public/sows/:shareToken`** and **`POST /api/public/sows/:shareToken/sign`** — fully
  contracted in `docs/portal/public-share-pages-contract-pack.md` §3-4 (Feature #1663), and
  **already wired**: `artifacts/portal/src/pages/msp-sow-public.tsx`, route `/sow/:shareToken`,
  live. This pack does not re-document those two routes; treat that pack as authoritative for them.
- **`GET /api/portal/offers*`, `GET /api/portal/presentations*`** — Feature #1657, fully contracted
  in `docs/portal/offers-and-sow-acceptance-contract-pack.md`. The customer-facing offer-accept
  path that calls `fulfillAcceptedProjectOffer()` (§3 above) lives there, not here.

---

## 5. Subsystem C — Engagement Projects catalog (`engagement_projects`)

**Not an MSP-tenant table.** No `mspId`/`customerId` column at all (`lib/db/src/schema/index.ts:
1177-1190`) — this is the direct-consulting-customer marketing catalog shown on
`artifacts/shane-mccaw-consulting`, unrelated to the MSP portal's tenant model. Confirmed live,
non-empty (**27 rows**, queried this session against the local `DATABASE_URL`) — the one genuinely
populated table this pack touches.

| Route | Method | Auth | Purpose | Line |
|---|---|---|---|---|
| `/public/engagement-projects` | GET | none | `is_visible = true` rows, `sortOrder, createdAt` | `public-engagement-projects.ts:7` |
| `/admin/engagement-projects` | GET | admin | all rows, same order | `admin-engagement-projects.ts:9` |
| `/admin/engagement-projects/signals` | GET | admin | every project-tier signal definition, cross-referenced against which visible projects it `unlocksProjects` (via `triggeredBy` containment) and whether the signal itself is enabled | `24` |
| `/admin/engagement-projects/:id` | GET/POST/PUT/DELETE | admin | CRUD | `55-150` |
| `/admin/engagement-projects/publish-to-prod` | POST | admin | title-keyed upsert-and-prune sync from dev DB → prod DB (requires `DATABASE_URL_PROD`); `?dryRun=true` returns an `{added, updated, removed}` diff without writing | `156-280` |

**Row shape** (`EngagementProject`): `id, title, priceRange (free text, e.g. "$2,000-$5,000"),
description, meaning, triggeredBy (string[], signal keys), sowItems (string[]), pages (string[]),
sortOrder, isVisible, createdAt, updatedAt`. No `sowItems`/`pages` vocabulary is a closed enum —
both are free-text arrays the admin UI populates.

Confirmed live consumer: `artifacts/shane-mccaw-consulting/src/hooks/useEngagementProjects.ts:20`
calls `GET /api/public/engagement-projects` directly. `admin-panel`'s `EngagementProjects.tsx`,
`ServiceEditorDialog.tsx`, `TenantSignals.tsx` and the signal-rules conflict panel all reference the
admin routes (grep-confirmed this session) — this subsystem has no orphan.

---

## 6. Real enum unions only

```ts
// index.ts:649 — projects.status
["active", "on_hold", "completed"]

// index.ts:655 — projects.project_type
["project", "retainer", "quick_win"]

// index.ts:712 — workflow_steps.status
["pending", "in_progress", "completed", "blocked"]

// index.ts:732 — kanban_tasks.column (5 values — see §1b's TS-cast gap)
["backlog", "in_progress", "waiting_on_customer", "review", "completed"]

// index.ts:928 — project_updates.type
["update", "milestone", "message", "file"]

// msp.ts:3830 — msp_sows.status
["draft", "sent", "signed", "paid", "failed", "expired"]

// msp.ts:3916 — msp_sow_events.event_name (free text, not a DB enum; documented values only)
"sow.created" | "sow.sent" | "sow.signed" | "sow.charged" | "sow.paid" | "sow.failed" | "sow.expired"
```

`kanban_tasks.priority` (`index.ts:743`) and `workflow_steps.phase`/`projects.phase` are **plain
text, no DB enum, no TS union** — whatever string the last write sent stands. Do not draw a closed
priority/phase picklist without confirming the actual value set in live data first (none exists
locally to check against — `kanban_tasks` is 0 rows).

---

## 7. Honest-empty / current live-data contract

**Queried this session against the local `DATABASE_URL`:**

| Table | Rows | Subsystem |
|---|---|---|
| `projects` | **0** | A — the #1573 fixture rows (6 ownerless service-named rows) are gone; nothing has replaced them |
| `workflow_steps` (not queried directly, but seeded only from `workflow_template_steps`) | — | A |
| `kanban_tasks` | **0** | A |
| `workflow_template_steps` | **0** | A — the work catalog itself; #1572's "content, not code" finding still stands |
| `workflow_template_step_tasks` | **0** | A |
| `msp_sows` | **0** | B |
| `msp_sow_events` | **0** | B |
| `assessment_sow_agreements` | **1** | (named in #1570's body; not part of either subsystem's live route surface found this session) |
| `engagement_offer_rules` | **3** | (Sales Offer Engine input, out of scope for this pack) |
| `engagement_offer_firings` | **0** | (same) |
| `engagement_projects` | **27** | C — real, live, populated |

**Every route in Subsystem A/B that lists or fetches a project/SOW today returns a real empty
result (`[]`/`404`/`{ items: [], total: 0 }`), not a fixture fallback** — confirmed by reading
every route in §1-2, none contains a hardcoded fallback array. The "content problem, not a code
problem" framing from #1570's own comment 2 still holds: the code paths are real, tested by shape,
and currently exercising against zero live rows because no interpretation/offer/SOW has actually
been authored end-to-end in this environment yet.

---

## 8. Cross-surface edges

- **`msp_sows.project_id → projects.id`** (`msp.ts:3892`) — nullable, populated only by
  `fulfillAcceptedProjectOffer()`'s callback (§3 step 5). A standalone SOW's `project_id` stays
  permanently null (§3).
- **`msp_sows.offer_id → sales_offers.id`** (`msp.ts:3838`, no FK constraint declared, just an
  indexed int column) — null for a standalone SOW, set for both accept-path-created SOWs (§2a).
- **`fulfillment_queue`, sourceType `"msp_sow"`** — written by `unlockFulfillment()`
  (`msp-sow.ts:1324-1385`, called from the charge-success path, not opened in this pack) as a
  dedicated id-space, **disjoint from** the legacy `sourceType: "sow"` rows the
  Copilot-Readiness/`quickWinPresentationsTable` sync writes (the #3803 finding named in this
  issue's own dispatch — already fixed on `main`, confirmed by the code at `:1315-1323` describing
  its own prior bug and the corrected upsert). Do not conflate the two `sourceType` values if
  Design ever surfaces a unified fulfillment queue view.
- **`workflow_template_step_tasks.runbook_id → powershell_scripts.id`** — the chain §1b's
  `linkedRunbook` enrichment walks (`kanban_task.workflow_step_id → workflow_steps
  .workflow_template_step_id → workflow_template_step_tasks.runbook_id`). Currently unreachable
  end-to-end (`workflow_template_step_tasks` is 0 rows).
- **`document-engine-sow.ts`** — the AI-priced pipeline both Subsystem A's real SOW documents (§3)
  and the customer-accept path (§4, Feature #1657) depend on. Not opened by this pack beyond the
  hand-off point, same discipline as the Offers/SOW-Acceptance pack's own §11.

---

## 9. Findings summary (filed)

- **#4024** — four live, correctly-scoped, currently-uncalled endpoints: `GET
  /api/portal/projects/:id` + its kanban-events SSE (§1a), `POST /api/msp/sows` standalone,
  `POST /api/msp/sows/:sowId/sign` authenticated, and `GET`/`POST
  /api/msp/customers/:customerId/clickwrap` (§2b). One combined issue, per the "trigger for filing
  sub-issues" rule — each is a real gap between a working backend and a missing/incomplete
  frontend, not five unrelated bugs.
- **#4025** — the project-closure customer sign-off loop has no customer-facing route or page:
  `admin-projects.ts`'s closure-request email links to a portal URL that doesn't route to anything,
  and no `portal-*.ts` route ever writes `project_closures.signedAt`/`signatureDataUrl` (§1c).

Both parented to #1570 (this issue's own Feature parent — no Feature-tier parent above #1570 itself
exists per `gh issue view 1737`, so #1570 is the correct target per the dispatch's standing rule).
Not filed as bugs (code defects); filed as `bug`-labeled per the standing convention for "a live
endpoint the surface does not call" / "a gap explicitly out of scope that's nonetheless proven
broken."

Two items flagged but **not** filed (no functional break, or already the genuinely-unsettled
product question #1570 itself named): the `appliedCoupon` sum-vs-single-row comment mismatch
(§1a), the `kanban_tasks.column` TS-union missing `"review"` (§1b), and the two-SOW-document-engine
question (§2a) — that last one is #1570's own "SOW ↔ Project cardinality" question restated with
the actual code evidence behind it, for whoever settles it.
