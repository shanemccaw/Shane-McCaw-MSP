# Dashboard (Portal) — customer-Portal contract extraction pack for Claude Design

**#4056**, step 3 of **#1578** (contract extraction pack, run per module as step 3 of the
architect → build → document → Design → wire order), for **#1943** ("Feature: Dashboard
(Portal)"), under **#1485** (EPIC: Portal New Design). Real trigger: every module #1943 names as
rolling up into this page has now shipped — POA&Ms (#1935, 2026-09-14), Risk Register (#1487),
SOPs (#1493), Change Control (#1486), Microsoft Changes (#1494), Remediation Tracking (#1489) —
so #1943's own sequencing note ("architect now; the Design export waits on the modules it
summarises") is satisfied.

Read-only. Every field below is extracted verbatim from the route file, its inline `res.json()`
shape, the client-side `DashboardResponseWire` mirror, and the export routes, cited to
file:line where a line number was directly confirmed. **Nothing here is authored or invented.**

Backend: `artifacts/api-server/src/routes/portal-customer-engines.ts:430-947` — the single
`GET /api/portal/dashboard` handler (its own header comment, `:406-429`, documents that a second,
now-deleted implementation in `portal-dashboard.ts` was removed under #327 as dead code that
Express's registration-order matching had already made unreachable). Export surface:
`artifacts/api-server/src/routes/dashboard-export.ts` (189 lines, 4 routes).

---

## 0. The surface and its consumers

### 0.1 Consumer map — **not orphaned**, and this corrects a now-stale sibling-pack claim

**This endpoint has a real, live, wired consumer today.** `artifacts/portal/src/pages/index.tsx`
(`OverviewPage`, #2921) calls it through `useOverviewDashboard()`
(`artifacts/portal/src/components/overview/useOverviewDashboard.ts`), which fetches
`/api/portal/dashboard` with `requireAuth`-scoped `fetchWithAuth`, and renders `NEEDS YOU`,
`COMING UP`, `WORK IN FLIGHT`, `PORTAL COUNTS`, and `REPORTS` panels straight from the response.
A second real page, `artifacts/portal/src/pages/index.tsx`'s sibling read
`useOverviewTimeline()`, consumes the separate `GET /api/portal/customer/timeline` route side by
side on the same page.

| Endpoint | Method | Route file:line | Consumer today |
|---|---|---|---|
| `/api/portal/dashboard` | GET | `portal-customer-engines.ts:430-947` | `artifacts/portal/src/pages/index.tsx` (`OverviewPage`, #2921), via `useOverviewDashboard.ts`; also `dashboard-export.ts`'s three read routes (§5) |
| `/api/portal/dashboard/pdf` | GET | `dashboard-export.ts` | not yet called from any `artifacts/portal` page (no "Export PDF" button wired) |
| `/api/portal/dashboard/ppt` | GET | `dashboard-export.ts` | not yet called from any `artifacts/portal` page |
| `/api/portal/dashboard/share` | GET/POST | `dashboard-export.ts` | not yet called from any `artifacts/portal` page |

**This corrects `docs/portal/customer-home-and-timeline-contract-pack.md`**, which as of its own
2026-09-06 regeneration for #3049 states *"Both are currently orphaned — no live frontend
consumer... the replacement `artifacts/portal` scaffold under #1485 has no page calling either
route yet."* That was accurate on 2026-09-06. **#2921 landed after that pack's last regeneration
and wired both routes** — confirmed by reading `index.tsx`'s own header comment, which names the
same contract pack file as its own source and cites `GET /api/portal/dashboard` and
`GET /api/portal/customer/timeline` by path. §8 restates this as a correction rather than
re-deriving the sibling pack's own §1/§2 field tables, which remain the accurate reference for
the timeline endpoint and are not duplicated here.

**The three export routes remain genuinely unconsumed** — real, live, gated routes with no page
button calling any of them yet. Per the standing rule ("If a real, live endpoint has no page
consumer, file it as a sub-issue at pack time, parented to #1943") this is filed — see §7.

### 0.2 Role floor — `requireAuth`, not a capability floor, and why (verbatim from the route's own header)

`GET /api/portal/dashboard` gates on bare `requireAuth`, not `requireCapability("ladder.customer-
user")` — a deliberate choice recorded in the route's own header comment (`:419-429`): the
`Assessment`/Free-tier rung sits below `Customer` in `ROLE_ORDER`, and the old floor 403'd the War
Room and the assessment dashboard, both `Assessment`-tier surfaces that call this same route.
**Real, live consequence:** a Free-tier caller receives the full engine payload (`scores`,
`results.summary.compositeScore`, per-pillar `score`, `telemetryStatus`, `type_attributes`) —
pillar *scores* are not gated by tier at all. The `#164` paywall (findings/recommendations text
only) is unaffected and keys on the SOW agreement, never the role (`isPaidTier`, `:480-490`). A
token carrying no `customerId` claim (every MSP-side role) still gets the `400`
`{ error: "No customer account associated with this user" }` (`:434-438`), unchanged from the old
floor.

### 0.3 Scoping — every read is per-customer-account, not per-login

`resolveCustomerUserIds(customerId)` (`:446`, `lib/tenant-signals.ts`) scopes every
customer-owned-data read (`projects`, `clientServices`, `invoices`, `reports`) across every login
linked to the account, per #1397 — a second login or a recreated account sees the same data.
`resolveTenantScope(customerId)` (`:457`, `lib/portal-customer-scope.ts`) separately resolves the
`(mspId, tenantId)` pair the seven `overviewCounts` fields (§2) are scoped by — `null` for an
account whose tenant row carries no resolvable M365 identifier, in which case every
tenant-scoped count in `overviewCounts` reads as a true `0`, not an error (§4).

---

## 1. Wire contract — `GET /api/portal/dashboard`

Full response shape (`:885-941`), cross-checked against the client-side mirror
(`artifacts/portal/src/components/overview/types.ts:82-113`, `DashboardResponseWire`):

| Field | Source | Type | CURRENT / DECIDED | Notes |
|---|---|---|---|---|
| `scores` | `tenant_engine_snapshots`, one row per `engineKey`, most-recent-first (`:460-470`, `:492-503`) | `Record<string, number>` | **CURRENT** | `security`/`health`/`drift`/`sla`/`scope_creep` explicitly `?? 0` (`:886-892`) even when the engine has never run for this tenant — see §4.1, a real, live conflict with #1943's own "never zero" constraint |
| `telemetryStatus` | `customer.status === "onboarding" ? "in_progress" : "completed"` (`:639`) | `"in_progress" \| "completed"` | **CURRENT** | two-value enum, no third "never onboarded" state exists |
| `type_attributes` | purchased services' `typeAttributes.dashboardModules`/`enabledModules`, falling back to a hardcoded 4-item default (`:608-627`) | `string[]` | **CURRENT** | see §4.3 — the fallback is a real, live default-module list, not itself invented display data (§4.3 explains why this is not the same class of problem as the `?? 0` finding) |
| `results.status` | `telemetryStatus === "in_progress" ? "running" : "complete"` (`:897`) | `"running" \| "complete"` | **CURRENT** | derived, not separately stored |
| `results.runId` / `results.generatedAt` | first snapshot with a non-null `runId`/`capturedAt` (`:505-506`) | `string \| null` | **CURRENT** | |
| `results.summary.compositeScore` | `compositeCount > 0 ? Math.round(compositeScore / compositeCount) : null` (`:901`) | `number \| null` | **CURRENT** | this field, correctly, uses `null` for "no engine has ever run" rather than `0` — the pattern §4.1 says `scores` should also follow |
| `results.summary.priorityItems` | latest `msp_diagnostic_findings` run, `critical`/`warning` only, worst-first, top 5 (`:544-593`) | `PriorityItemWire[]` | **CURRENT** | `title`/`description` null on the unpaid tier (`:591-592`), same #164 paywall |
| `results.pillars` | per-`engineKey` breakdown, findings/recommendations text gated by `isPaidTier` (`:525-527`) | `Record<string, PillarEntryWire>` | **CURRENT** | keyed by raw `engineKey` string, not `PILLAR_SUMMARY_KEYS` (§2.7 — a different, narrower vocabulary than `/api/portal/pillars`) |
| `projects` | active projects, most-recently-updated, limit 5, enriched with `currentTask` (`:651-692`) | `EnrichedProjectWire[]` | **CURRENT** | |
| `clientServices` | active/paused services, limit 6 (`:694-704`) | array of `{cs, service: {name, billingType, price}}` | **CURRENT, but not in the client-side type mirror** — see §8.2 | |
| `invoices` | all invoices for the account, limit 5, amount in integer cents (`:709-711`) | array | **CURRENT, but not in the client-side type mirror** — see §8.2 | |
| `reports` | limit 3 (`:713-715`) | `ReportWire[]` | **CURRENT** | |
| `unreadNotifications` | per-login unread count (`:720-721`) | number | **CURRENT** | the one field scoped to the login, not the account (#1397's own carve-out) |
| `unreadMessages` | per-account unread count (`:725-726`) | number | **CURRENT** | |
| `customerStatus` / `customerName` | `tenants` row, `?? null` (`:918-919`) | `string \| null` | **CURRENT** | `?? null` deliberate — a bare `undefined` is dropped by `JSON.stringify`, so this is a shape fix, not new behavior (`:912-917`'s own comment) |
| `mspId` | `req.user.mspId ?? null` (`:920`) | `number \| null` | **CURRENT** | |
| `mspName` | servicing MSP's display name, for Offboarding's "served by <name>" copy (Git #4002, `:641-648`, `:921`) | `string \| null` | **CURRENT** | |
| `tenantScopeResolved` | `tenantScope !== null` (`:929`) | boolean | **CURRENT** | Git #3344's own disambiguator — lets a consumer tell "six counts are a true 0" apart from "tenant scope itself is unresolvable" |
| `overviewCounts` | seven cross-Feature roll-up counts, §2 | `OverviewCountsWire` | **CURRENT, incomplete against #1943** | the core subject of this pack — see §2 |

---

## 2. Cross-Feature roll-up audit — what `overviewCounts` actually serves versus what #1943 asked for

#1943's own "What rolls up here" list, read against the live `overviewCounts` object
(`:736-941`) and the four other modules it names. This is the real deliverable of this
regeneration: confirming, module by module, whether the now-shipped backends are actually
reachable through this one roll-up surface.

| #1943's bullet | Real backend that now exists | What `/portal/dashboard` currently serves | Verdict |
|---|---|---|---|
| POA&Ms — overdue plans, approaching-expiry ladder | `GET /portal/poams` (`isOverdue` boolean per plan, no ladder bucketing — confirmed by direct read of `portal-poams.ts`) | **Nothing.** No `mspPoamsTable` read anywhere in `portal-customer-engines.ts` | **MISSING** — filed, §7.1 |
| Open risks, and which have a POA&M behind them | `GET /portal/risk-register` (`status`, `reviewState`, no `poamId`/`hasActivePlan` field — risk↔POA&M linkage is only implicit via shared `checkKey`, confirmed by direct read of both route files) | `overviewCounts.rbdWaiting`/`rbdActive` — these are **risk-acceptance decisions** (`msp_risk_decisions`, `RISK_ACCEPTANCE_STATUSES`), a narrower concept than "open risk" on the Risk Register itself (`WireRisk.status`: `Open/Mitigating/Accepted/Closed/Expired`). No count of open risks exists, and no risk↔POA&M linkage is surfaced anywhere | **MISSING** — filed, §7.2 |
| SOP runs — what's running, what's waiting on the customer | `GET /api/portal/sop-runs` (`queue[].state`: `"Running" \| "Queued"`; no "waiting on customer" state exists in the backend at all) | **Nothing.** No `sop`/`sopRun` read anywhere in this route | **MISSING** — filed, §7.3 |
| Change requests awaiting customer approval, any active freeze | `GET /portal/change-control` (`stats.awaitingApproval`, a real server-computed count); `GET /portal/change-control/freeze-windows` (`windows[].activeNow`) | `overviewCounts.changeScheduleThisWeek` — this is the **maintenance calendar** (`portal-change-control.ts`'s `maintenance-windows` route, a schedule of expected work), not approval status and not freeze state. Neither `stats.awaitingApproval` nor any freeze flag is read | **MISSING** — filed, §7.4 |
| Microsoft Changes requiring action | `GET /api/portal/message-center` — "requiring action" is `kindForPost() === "d"` (needs a decision) or `"b"` (breaks something), a real per-post classification, not a date filter | `overviewCounts.microsoftChangesThisWeek` counts **every** message-center item whose `effectiveDate()` falls in the next 7 days (`:794-811`), regardless of `kind` — a message with no action required at all still counts if its date falls this week, and a message requiring action with a date outside this window is never counted | **MISMATCHED** — filed, §7.5 |
| Remediation items awaiting the customer | `remediationTerminalState(status, verificationState)` classifies every non-`verified`, non-`accepted_risk` step as `"outstanding"` (`remediation-tracker-terminal-state.ts`) | `overviewCounts.remediationInProgress` — counts exactly the `"outstanding"` steps for this customer (`:852-861`) | **COVERED** — this is a reasonable, direct match; no finding |
| Pillar scores | `GET /api/portal/pillars` (`buildPillarSummary()`, richer per-pillar shape) | `scores{}` and `results.pillars{}` on this route (§1) — a real, live, narrower pillar view keyed by engine key rather than `PILLAR_SUMMARY_KEYS` | **COVERED**, different shape — not a gap, just a narrower vocabulary than `/api/portal/pillars` itself (documented, not filed) |
| Copilot Gate | `computeCopilotGate()` is served on `GET /api/portal/remediation-tracker/pillar-scores` (`copilotGate: CopilotGateResult`, `status: "go"\|"no_go"\|null`) — **not** on `/api/portal/pillars` | **Nothing.** No `copilotGate`/gate status field anywhere on this route, despite #1943's own text describing it as "already real, `/portal/pillars`" | **MISSING, and #1943's own premise about where it lives is stale** — filed, §7.6 |

**Net result: of #1943's seven named roll-up items, one is fully covered (Remediation), one is
covered under a narrower vocabulary (pillar scores), and five are either entirely missing or
serving the wrong concept under a same-sounding field name.** `overviewCounts` (#2922/#3049) is a
real, working roll-up of a different five signals (RBD, Microsoft Changes-by-date, maintenance
schedule, remediation, policy review) than the five-plus #1943 itself asks for — it predates
#1943 being written against the now-shipped modules, and nothing has reconciled the two since.

---

## 3. Real enum unions

- `telemetryStatus` (`:639`): `"in_progress" | "completed"` — two values only, no third state for
  "never began onboarding."
- `results.status` (`:897`): `"running" | "complete"` — derived from `telemetryStatus`, not
  independently stored.
- `PillarEntryWire.status` (`:526-527`): the literal string `"complete"` only — no other value is
  ever written to this field by this route (a pillar with no snapshot is simply absent from the
  `pillars` map, not present with a different status).
- `PriorityItemWire.severity` (`:546`, `:577`): `"critical" | "warning"` only — the query itself
  filters to `inArray(severity, ["critical", "warning"])` (`:577`), so `info`/other severities on
  `msp_diagnostic_findings` (if any exist) are never returned here.
- `EnrichedProjectWire.status` (client mirror, `types.ts:54`): `"active" | "on_hold" | "completed"`
  — not independently re-verified against the `projects` table's own real column enum in this
  pass (out of scope; the route's own query filters to `status = "active"` at `:652`, so
  `on_hold`/`completed` values are never actually returned by *this* route regardless of what the
  column itself allows).
- `ReportWire.period` (client mirror, `types.ts:65`): `"weekly" | "monthly" | "executive_summary"
  | "other"` — not independently re-verified against the schema in this pass.

---

## 4. Zero-state honesty audit against #1943's own explicit constraint

#1943's own words: *"Zero of everything is a real, good state and must read as calm... Never
invent data to display... A missing value renders unavailable — never zero, never red."*

### 4.1 `scores.{security,health,drift,sla,scope_creep}` collapse "never scanned" into a literal `0` — a real, live conflict with #1943's own constraint

`:886-892`:
```
scores: {
  security: scores.security ?? 0,
  health: scores.health ?? 0,
  drift: scores.drift ?? 0,
  sla: scores.sla ?? 0,
  scope_creep: scores.scope_creep ?? 0,
  ...scores
},
```
An engine that has never produced a `tenant_engine_snapshots` row for this customer reads back as
a **literal `0`**, not `null`/absent. This is the exact ambiguity `results.summary.compositeScore`
on the very same response correctly avoids one field below (`:901`, `compositeCount > 0 ? ... :
null`) — the route already has the right pattern in hand and doesn't apply it here. **Confirmed
this field is not currently rendered by `OverviewPage`** (`index.tsx` reads `results.pillars` and
`results.summary.compositeScore`, never the top-level `scores` map directly), so there is no live
UI symptom today — but the wire contract itself is wrong, any future consumer (the PDF/PPT export
routes, §5, or a future Design surface) reading `scores` directly would render a real "0/100
security score" for a tenant that has simply never been scanned, which is precisely the "zero
reading as a bad state" #1943's constraint exists to prevent. Filed, §7.7.

### 4.2 `tenantScopeResolved` is the correct pattern, done right

`:922-929`'s own comment states the real intent directly, and the implementation matches it:
`overviewCounts`'s six tenant-scoped fields are genuinely `0` (not withheld) when the tenant
scope resolves to zero real rows, and `tenantScopeResolved: false` is the one honest signal that
distinguishes that from "tenant identity itself is unresolvable." `OverviewPage` reads this
correctly (`noTenantScope`, `index.tsx:82`) to show *"Tenant identifier unresolvable — six counts
are a real 0"* rather than presenting the zeros as a clean bill of health. No finding.

### 4.3 `type_attributes`' hardcoded fallback is a real default, not invented display data

`:625-627`: `["priority-health", "security", "copilot", "cost"]` fires only when the customer has
**zero** active services carrying either `dashboardModules` or `enabledModules` in their
`typeAttributes` — i.e., an account with no purchased services at all. This is a real, decided
default module set for that state (a plausible reading: "assume the free/base modules" rather
than "render nothing"), not a fabricated row of *data* the way a hardcoded finding or invoice row
would be — no invented numbers, names, or content ride on this list, only which UI modules mount.
Stated for completeness, not filed as a violation of the "never invent data" rule, since no
inspectable data is invented — but flagged for Design/wire to know this is a real, live default
rather than an empty/absent state, in case a genuinely empty `type_attributes: []` is what a
"customer purchased nothing yet" state should instead render.

---

## 5. Export routes — `dashboard-export.ts` (189 lines, 4 routes, all `requireAuth`)

| Route | Method | What it actually does |
|---|---|---|
| `/portal/dashboard/pdf` | GET | Renders the same frozen snapshot HTML (`renderDashboardSnapshotHtml()`, `lib/dashboard-snapshot.ts`) through the existing Chromium pipeline (`buildHtmlDoc` + `htmlToPdf`) and streams a PDF attachment — not an independent re-derivation of the live JSON payload |
| `/portal/dashboard/ppt` | GET | `renderDashboardPpt()` (`lib/dashboard-ppt.ts`), a separate real pptxgenjs slide builder over the same underlying data path (`resolveCallerScope`/`resolveMetric`), not a screenshot of the PDF |
| `/portal/dashboard/share` | GET | Looks up an existing, non-expired share (`quickWinResultSharesTable` joined to `insightsGeneratedDocumentsTable`, `docType: "dashboard_snapshot"`); `{ share: null }` if none |
| `/portal/dashboard/share` | POST | Renders the same snapshot HTML, inserts a new `insightsGeneratedDocumentsTable` row (`category: "report"`, `status: "approved"`), generates a 32-byte hex `shareToken`, sets `expiresAt` = now + 30 days, reuses the pre-existing `/portal/documents/:id/share` token/public-view pattern verbatim. `409` if the caller's `mspCustomerId` can't resolve |

Real enum values confirmed: `docType: "dashboard_snapshot"`, `category: "report"`,
`status: "approved"` (on `insights_generated_documents`), `shareKind: "document"`. No persisted
"export type" enum exists — pdf/ppt/share is purely which route was called.

**None of these three routes has a page consumer today** — no "Export PDF"/"Share" button exists
anywhere in `artifacts/portal`. Filed per the standing "unconsumed live endpoint" rule, §7.8.

---

## 6. The forbidden list — declared, not merely absent

1. **No cross-tenant read.** Every read in `GET /api/portal/dashboard` scopes through either
   `resolveCustomerUserIds(customerId)` (customer-owned tables) or `resolveTenantScope(customerId)`
   (`(mspId, tenantId)`-keyed tables) — both session-derived, never client-suppliable. Verified on
   every query in the handler.
2. **No invented rows.** Every array field (`projects`, `clientServices`, `invoices`, `reports`,
   `results.summary.priorityItems`) is a real query result, `[]` when empty — no fixture/mock
   fallback exists anywhere in this file.
3. **The `#164` paywall is content-only, never structural.** An unpaid tier still receives real
   `findingsCount`/`recommendationsCount` numbers and real `severity`/`checkKey` strings — only
   the finding/recommendation *text* itself is withheld (`:525-527`, `:591-592`).

---

## 7. Open gaps and findings — filed as new issues, parented to #1943

Eight real, live findings from this pass. Per the Feature-first rule, all are sub-issues of
**#1943** ("Feature: Dashboard (Portal)"), since #4056 (this build's own issue) is itself a direct
sub-issue of #1943 — not the #1485 epic. All labeled `bug`, milestone v1.1, board status "AI
Batter Up."

1. **#4062, §2 — POA&Ms never rolled up.** No overdue count, no approaching-expiry signal, despite
   #1935 shipping and #1943 naming this first in its own list.
2. **#4063, §2 — Open risks never rolled up, and risk↔POA&M linkage doesn't exist as data
   anywhere.** `rbdWaiting`/`rbdActive` cover risk-*acceptance decisions*, a different, narrower
   concept than an open Risk Register entry. Building this roll-up correctly will also require
   adding the linkage itself (§2's own note: neither `WireRisk` nor `WirePoam` carries a
   cross-reference today, only an implicit shared `checkKey`).
3. **#4064, §2 — SOP runs never rolled up.** No "what's running" or "what's waiting on the
   customer" signal from `GET /api/portal/sop-runs` reaches this route at all (and note: the
   backend itself has no "waiting on customer" state distinct from `"Queued"` — that may itself
   need a real state addition on the SOPs side, not just a new read here).
4. **#4065, §2 — Change requests awaiting approval and active-freeze state never rolled up.**
   `changeScheduleThisWeek` is the maintenance calendar, a different concept; neither
   `stats.awaitingApproval` nor `freeze-windows[].activeNow` is read.
5. **#4066, §2 — `microsoftChangesThisWeek` counts the wrong thing.** It's a 7-day date-window
   count over every message-center item, not the "requiring action" (`kind: "b"|"d"`)
   classification #1943 explicitly names.
6. **#4067, §2 — Copilot Gate never rolled up, and #1943's own text about where it lives is
   stale.** `computeCopilotGate()` lives on `GET /api/portal/remediation-tracker/pillar-scores`,
   not `/api/portal/pillars` as #1943's body states — worth a one-line correction on #1943 itself
   when this is picked up.
7. **#4068, §4.1 — `scores.{security,health,drift,sla,scope_creep}` render a never-scanned engine as a
   literal `0`**, contradicting #1943's own explicit "never zero for a missing value" constraint.
   `results.summary.compositeScore`'s existing `null`-when-unscanned pattern on the same response
   is the fix shape already proven correct one field over.
8. **#4069, §0.1/§5 — the three `dashboard-export.ts` routes (`/pdf`, `/ppt`, `/share`) have no
   page consumer.** Real, live, gated routes with zero UI entry point today.

No product code, schema, or UI was changed by this pass.

---

## 8. Corrections to the sibling pack (`docs/portal/customer-home-and-timeline-contract-pack.md`)

### 8.1 The "orphaned, no consumer" claim is stale as of #2921

Restated from §0.1: that pack's last regeneration (2026-09-06, for #3049) correctly stated both
`/api/portal/dashboard` and `/api/portal/customer/timeline` had zero frontend consumers. #2921
landed after that and wired both into `OverviewPage`. Not re-litigating that pack's own field
tables for the timeline endpoint (§1 there remains the accurate reference) — only this one
now-stale consumer claim.

### 8.2 The client-side wire mirror (`types.ts`) omits two fields the backend actually sends

`DashboardResponseWire` (`artifacts/portal/src/components/overview/types.ts:82-113`) has no
`clientServices` or `invoices` field, though `portal-customer-engines.ts` emits both (§1). Not
currently a defect — `OverviewPage` doesn't read either field today — but a real, live drift
between the documented client type and the actual wire payload, worth knowing if either field is
wired into a future panel (e.g. an "Active Services" or "Recent Invoices" card).

---

## 9. Provenance

Extracted 2026-09-14 for **#4056**, under **#1943** ("Feature: Dashboard (Portal)"), itself under
**#1485** (EPIC: Portal New Design). Read in full: `portal-customer-engines.ts:380-947` (the
`/portal/dashboard` handler and its immediately preceding rescoring-status route, for shared
context), `dashboard-export.ts` (189 lines, all 4 routes), `artifacts/portal/src/pages/index.tsx`
(442 lines, the real `OverviewPage` consumer), `useOverviewDashboard.ts`, `types.ts`. Cross-read
via targeted extraction (not sampled — each file below was read in full by a dedicated pass):
`portal-poams.ts` (757 lines), `portal-risk-register.ts` (741 lines), `portal-sops.ts` (872
lines), `portal-change-control.ts` (1526 lines) plus `lib/portal-change-control.ts`,
`portal-message-center.ts`, `portal-remediation-tracker.ts` plus
`remediation-tracker-terminal-state.ts`, `portal-assessment.ts`'s `/portal/pillars` route plus
`lib/pillar-summary-stats.ts` and `lib/copilot-gate.ts`, and `docs/portal/customer-home-and-
timeline-contract-pack.md` (for §8's corrections). #4056's own issue body and #1943's own issue
body were both read in full before any of this was written.

**Eight real, live findings — filed as #4062, #4063, #4064, #4065, #4066, #4067, #4068, #4069, all
`bug`-labeled sub-issues of #1943 (§7).** No product code, schema, or UI was changed by this pass.
