# Customer Home and Timeline — contract extraction pack

**Issue:** #2446, part of #1655 ("Feature: Customer Home and Timeline (Portal)"), part of
#1485 (EPIC: Portal). Method per #1642. Extracted, not authored — every field below traces
to one of the files listed, cited to file:line. This is Phase 2 of the Portal build order
(architect → build the endpoints → regenerate the contract pack → Design → wire) — no
page/UI-shape decisions are made here.

**Regenerated 2026-09-05 for #2922** (also under #1655): `GET /api/portal/dashboard`
gained a real `overviewCounts` object — six cross-Feature roll-up counts (RBD waiting/
active, Microsoft Changes this week, change schedule this week, remediation steps in
progress, policies expiring soon) pulled from Risk Register, Message Center, Change
Control's maintenance calendar, Remediation Tracker and Policy Decisions, none of which
had a queryable aggregate before. Section 2's field table, source list, enum list and
honest-empty notes below are updated for it; the timeline endpoint (§1) is unchanged by
this pass.

Both cited endpoints were confirmed real and live in the current codebase before any of
this was written (Step 1 of #2446's own body):

- `GET /api/portal/customer/timeline` — `portal-customer-timeline.ts`
- `GET /api/portal/dashboard` — `portal-customer-engines.ts`

**Both are currently orphaned — no live frontend consumer.** `artifacts/msp-portal` (the
old portal-v2 codebase that used to call these) was retired wholesale on 2026-08-29
(`f40438cdc`, preserved at tag `portal-archive-2026-08-29`); the replacement
`artifacts/portal` scaffold under #1485 has no page calling either route yet, and no
`Design/portal/` export exists for Customer Home/Timeline. That is real, current state,
not a gap this pack invents — Design has a real, live backend to design against, with
zero frontend debt to carry over.

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/portal-customer-timeline.ts` — the timeline endpoint
- `artifacts/api-server/src/routes/portal-customer-engines.ts` — the dashboard endpoint
  (`GET /api/portal/dashboard`, lines 413-882)
- `artifacts/api-server/src/lib/doc-gate-coverage.ts` — `evaluateDocGateCoverage()`
- `artifacts/api-server/src/lib/engine-registry.ts` — `ENGINE_DEFS` (engine key → label)
- `artifacts/api-server/src/lib/tenant-signals.ts` — `resolveCustomerUserIds()` /
  `resolveSiblingUserIds()`, the multi-login scoping bridge
- `artifacts/api-server/src/lib/portal-customer-scope.ts` — `resolveTenantScope()`, the
  `(mspId, tenantId)` scoping pair `overviewCounts` (#2922) reads against
- `artifacts/api-server/src/lib/portal-addon-entitlements.ts` — `hasAddOnEntitlement()`,
  gating `changeScheduleThisWeek`
- `artifacts/api-server/src/lib/portal-change-maintenance.ts` — `windowOverlapsRange()`,
  the recurrence-cadence walk behind `changeScheduleThisWeek`
- `artifacts/api-server/src/lib/portal-message-center.ts` — `effectiveDate()`, behind
  `microsoftChangesThisWeek`
- `artifacts/api-server/src/lib/remediation-tracker-terminal-state.ts` —
  `remediationTerminalState()`, behind `remediationInProgress`
- `lib/db/src/schema/msp.ts` — `msp_diagnostic_runs`, `msp_diagnostic_findings` (real
  enum sources), plus `msp_risk_decisions` (`RISK_ACCEPTANCE_STATUSES`) and
  `policy_decisions` (`reviewState`) for `overviewCounts`
- `lib/db/src/schema/index.ts` — `tenant_engine_snapshots`, `insights_generated_documents`,
  `sales_offers`, `projects`, `client_services`, `kanban_tasks`, `invoices`, `reports`,
  `notifications`, `messages`, `services`, `tenants` (real column/enum sources)
- `artifacts/api-server/src/routes/portal-documents.ts` — comparison surface for §4's
  scoping finding (the sibling-login bridge this pack's endpoint doesn't use)

---

## 1. Wire contract — `GET /api/portal/customer/timeline`

Auth: `requireRole("CustomerUser")` (`portal-customer-timeline.ts:80`). 400s with
`{ error: "No customer account associated with this user" }` if the JWT carries no
`customerId` claim (`:84-87`).

Query params: `limit` (default 30, clamped 1-100, `:57-58, 89`), `before` (ISO date
cursor, invalid/missing dates silently ignored — `:90-91`).

Response shape:

| Field | Type | Nullability | Source |
|---|---|---|---|
| `events` | `TimelineEventDto[]` | not null (can be `[]`) | merged + re-sorted across 5 sources, sliced to `limit` (`:202-301`) |
| `nextCursor` | `string \| null` | nullable | last page item's timestamp, only set if **any** source hit its own fetch cap (`:303-308`) — see §4 |

Each `TimelineEventDto` (`:63-70`):

| Field | Type | Nullability | Source |
|---|---|---|---|
| `id` | `string` | not null | `"<source>:<rowId>"`, e.g. `"run:<uuid>"`, `"finding:<uuid>"`, `"score:<int>"`, `"document:<int>"`, `"offer:<int>"` |
| `type` | `"scan_completed" \| "scan_failed" \| "finding" \| "score_change" \| "document" \| "offer"` | not null | `:60` |
| `title` | `string` | not null | per-source, see below |
| `description` | `string \| undefined` | optional | per-source; `undefined` is dropped by `JSON.stringify` (absent from the wire, not `null`) |
| `status` | `"default" \| "success" \| "warning" \| "error" \| "info"` | not null | `:61` |
| `timestamp` | `string` (ISO) | not null | the event's real occurred-at time, per-source |

### The 5 sources, merged (`Promise.all`, `:94-200`)

1. **`msp_diagnostic_runs`** (`mspDiagnosticRunsTable`, scoped `customerId = tenants.id`,
   status `in ("completed", "partial", "failed")`, `:95-119`). "partial" is included
   deliberately — a partial run is graded via `evaluateDocGateCoverage()` (real
   `checksOk`/`checksLicenseGap`/`checksTotal` counts, `:210-215`) rather than excluded,
   since many tenants' runs never literally reach `"completed"`. Emits `scan_completed`
   (title varies by whether coverage was sufficient, `:216-224`) or `scan_failed`
   (`:225-233`). Timestamp: `completedAt ?? createdAt` (`:205`).
2. **`msp_diagnostic_findings`** (`mspDiagnosticFindingsTable`, scoped `customerId`,
   severity `in ("warning", "critical")` — `"ok"`/`"info"` are excluded as routine noise,
   `:121-138`). Emits `finding`, `status: "error"` for critical / `"warning"` otherwise
   (`:236-245`). Timestamp: `createdAt`.
3. **`tenant_engine_snapshots`** (`tenantEngineSnapshotsTable`, scoped `customerId`,
   over-fetched at `limit * 2` since most rows are filtered client-side, `:140-157`).
   Only snapshots with `|delta| >= 5` (`SCORE_DELTA_SIGNIFICANCE_THRESHOLD`, `:56`) become
   events — an arbitrary-but-documented bar for "worth telling the customer" on a 0-100
   score. Emits `score_change`, title `"<Engine Label> score improved/declined"` (engine
   label resolved via `ENGINE_DEFS`, falling back to a title-cased raw key if unknown,
   `:72-74`). Timestamp: `capturedAt`.
4. **`insights_generated_documents`** (`insightsGeneratedDocumentsTable`, scoped
   `customerId = userId` — **not** `mspCustomerId` or a multi-login bridge, see §4 —
   status `in ("delivered", "approved")`, `:159-178`). Emits `document`, always
   `status: "success"`, title `"New document ready: <title>"`. Timestamp:
   `deliveredAt ?? approvedAt ?? createdAt` (`:262`).
5. **`sales_offers`** (`salesOffersTable`, scoped `customerId = userId` — same
   single-login scoping as source 4, see §4 — state `in ("sent", "accepted", "rejected",
   "expired")`, i.e. `"draft"` offers are excluded, `:180-199`). Emits `offer`, title/status
   per state (`accepted` → success, `rejected`/`expired` → default, `sent` → info,
   `:272-297`). Timestamp: the first non-null of the state-appropriate date fields, falling
   back to `sentAt ?? createdAt`.

All 5 are merged into one array, sorted descending by `timestamp` string comparison
(`:300` — lexicographic on ISO-8601, which is timestamp-order-correct), then sliced to
`limit` (`:301`).

---

## 2. Wire contract — `GET /api/portal/dashboard`

Auth: `requireAuth` (not `requireRole("CustomerUser")`) — deliberate, per the route's own
header comment (`portal-customer-engines.ts:402-411`): the Assessment role sits below
CustomerUser in `ROLE_ORDER`, and both the War Room and the free Copilot Assessment
dashboard (Assessment-tier surfaces) call this route, so gating one tier higher 403'd
them. Consequence: Assessment/Free-tier customers now receive the full engine payload
(`scores`, `results.summary.compositeScore`, per-pillar `score`, `telemetryStatus`,
`type_attributes`) — the #164 paywall below still redacts findings/recommendation TEXT
for unpaid customers, keyed on SOW agreement status, never on role. Same 400 shape as
§1 if the JWT carries no `customerId` claim (`:417-420`).

**This is THE single handler for this path** (`:391-400`) — a second, now-deleted
`portal-dashboard.ts` handler registered the identical path until #327; Express matches
registration order and this router mounts first, so the deleted handler never executed
for any real request. Nothing was lost deleting it; it was a strict subset of this
route's payload, one field short (`customerName`).

**#2922 adds one more resolved value before the try block**: `tenantScope` —
`resolveTenantScope(customerId)` (`:440`), the `(mspId, tenantId)` pair every one of the
six `overviewCounts` reads below is scoped by. `null` for an account whose tenant row
carries no resolvable M365 identifier, in which case every `overviewCounts` field reads
as a true `0` rather than erroring — the same "unresolvable scope is an honest empty
register" contract `portal-risk-register.ts` / `portal-change-control.ts` /
`portal-message-center.ts` already follow for their own reads of these same tables.

Response shape (`:829-875`):

| Field | Type | Nullability | Source |
|---|---|---|---|
| `scores` | `Record<string, number>` | not null | 6 named keys (`security`, `health`, `governance`, `drift`, `sla`, `scope_creep`) defaulted to `0`, spread with every other real `engineKey` from `tenant_engine_snapshots` (`:831-839`) |
| `telemetryStatus` | `"in_progress" \| "completed"` | not null | `"in_progress"` iff `tenants.status === "onboarding"` (`:616`) |
| `type_attributes` | `string[]` | not null | union of `dashboardModules`/`enabledModules` JSON arrays off active `client_services` → `services.typeAttributes` (`:574-604`); falls back to `["priority-health", "security", "copilot", "cost"]` if the tenant has no active service carrying either array |
| `results.status` | `"running" \| "complete"` | not null | mirrors `telemetryStatus` (`:843`) |
| `results.runId` | `string \| null` | nullable | first snapshot's `runId` (`:488`) |
| `results.generatedAt` | `string \| null` (ISO) | nullable | first snapshot's `capturedAt` (`:489`) |
| `results.summary.compositeScore` | `number \| null` | nullable | mean of one score per distinct `engineKey`, rounded; `null` if zero snapshots exist (`:847`) |
| `results.summary.priorityItems` | `PriorityItem[]` | not null (`[]` if none) | real query (#2500) over the customer's most recent `msp_diagnostic_findings` run, critical/warning only, worst-severity-first, top 5; title/description null for an unpaid customer (`:517-565`) — see §5 for this row's correction to the pack's original #2446 text |
| `results.pillars` | `Record<string, PillarEntry>` | not null (`{}` if no snapshots) | one entry per distinct `engineKey`, see below |
| `projects` | `EnrichedProject[]` | not null (`[]`) | active `projects` rows across the customer's linked logins (`resolveCustomerUserIds`), top 5 by `updatedAt`, each enriched with `currentTask` (the row in its `kanban_tasks.column === "in_progress"`, plus 1-based step number and total task count) or `null` |
| `clientServices` | `{ cs: ClientService, service: { name, billingType, price } }[]` | not null (`[]`) | active or paused `client_services` joined to `services`, top 6 by `purchasedAt` |
| `invoices` | `Invoice[]` (full row) | not null (`[]`) | top 5 by `createdAt`; `amount` is integer cents (Git #1610) — no consumer renders it as money in this payload, rides through as cents |
| `reports` | `Report[]` (full row) | not null (`[]`) | top 3 by `createdAt` |
| `unreadNotifications` | `number` | not null | count of `notifications` where `userId = req.user.id` (this one login, NOT bridged — deliberate, notifications are genuinely per-login) and `read = false` |
| `unreadMessages` | `number` | not null | count of `messages` where `readByClient = false`, bridged across the customer's linked logins |
| `customerStatus` | `string \| null` | nullable, explicit | `tenants.status`, coalesced to `null` (not `undefined`) so the key never vanishes from the JSON payload |
| `customerName` | `string \| null` | nullable, explicit | `tenants.customerName`, same `?? null` treatment |
| `mspId` | `number \| null` | nullable | `req.user.mspId` from the JWT |
| `overviewCounts` | `OverviewCounts` | not null | #2922 — six cross-Feature roll-up counts, see below (`:865-872`) |

Each `results.pillars[engineKey]` entry (`:508-510`):

- Paid tier (`isPaidTier`, see below): `{ score, status: "complete", findings: string[], recommendations: string[] }` — real text extracted from the snapshot's `breakdown` JSONB (`finding`/`message`/`label` → findings; `recommendation`/`action` → recommendations, `:496-506`).
- Unpaid tier: `{ score, status: "complete", findingsCount, recommendationsCount }` — counts only, no text.

`isPaidTier` (`:463-473`, the #164 paywall): true iff the customer (across
`resolveCustomerUserIds`) has any `assessment_sow_agreements` row with
`status in ("paid", "free_activated")`. **Scores/status are never gated by this — only
the finding/recommendation strings themselves.**

`EnrichedProject.currentTask` (`:623-657`): `{ stepNumber, totalSteps, title } | null`,
computed from that project's `kanban_tasks` ordered by `order` — `stepNumber` is the
1-based index of the first task whose `column === "in_progress"` within that ordered
list, `totalSteps` is the project's total task count. `null` if no task is
`in_progress`.

### `overviewCounts` (#2922) — cross-Feature roll-up counts

All six are `0` when `tenantScope` (`:440`) is null — no resolvable tenant identifier is
an honest, real `0` for every count, not an error. None of these five source tables had
a queryable aggregate before this build.

| Field | Type | Source |
|---|---|---|
| `rbdWaiting` | `number` | `msp_risk_decisions` rows scoped `(mspId, tenantId)` with `status = "pending_signature"` (`:715-731`) |
| `rbdActive` | `number` | same table/scope, `status = "active"` (`:715-731`) — the third `RISK_ACCEPTANCE_STATUSES` value, `"revoked"`, counts toward neither |
| `microsoftChangesThisWeek` | `number` | `msp_message_center_items` rows scoped `(customerId, mspId)`, filtered by the same `effectiveDate()` (`actionRequiredByDateTime ?? endDateTime ?? startDateTime ?? lastModifiedDateTime`, `portal-message-center.ts:171-172`) the Microsoft Changes page itself uses, falling in `[now, now + 7 days)` (`:738-755`) |
| `changeScheduleThisWeek` | `number` | `change_maintenance_windows` rows scoped identically to `portal-change-control.ts`'s own `GET /change-control/maintenance-windows` read (global scope, matching-tenant scope, or any workload scope), gated on the same `change_control` add-on entitlement that route requires (`hasAddOnEntitlement`, `0` and no query at all when unentitled) — then `windowOverlapsRange()` (`portal-change-maintenance.ts`) walks each window's own recurrence cadence to find whether an occurrence falls in `[now, now + 7 days)`, so a recurring window anchored months ago still counts (`:764-787`) |
| `remediationInProgress` | `number` | `remediation_tracker_steps` rows scoped `customerId`, counted where `remediationTerminalState(status, verificationState) === "outstanding"` (`remediation-tracker-terminal-state.ts`) — a customer claim (`completed` / `already_handled` / `deferred` / `shane_handles`) neither re-verified by a scan nor exited to the risk register. Reuses the tracker route's own three-state model rather than re-deriving it, so the two can never disagree (`:796-805`) |
| `policiesExpiringSoon` | `number` | `policy_decisions` rows scoped `(mspId, tenantId)`, counted where `reviewState` (#2518) is `"due"` or `"overdue"` — the same operational review clock `alert-engine.ts`'s `advancePolicyReviewClock` already advances on a schedule (`RISK_REVIEW_DUE_LEAD_DAYS = 14`-day lead window for `"due"`). A dependency-based decision (#1526) has a null `reviewState` and is correctly excluded — there is no "soon" for a condition with no date (`:814-826`) |

---

## 3. Real enum unions

- **Diagnostic run status** — `msp_diagnostic_runs.status`:
  `"pending" | "running" | "completed" | "failed" | "partial"` (`MSP_DIAGNOSTIC_RUN_STATUS`,
  `msp.ts:3241`). The timeline route only surfaces `"completed" | "partial" | "failed"`
  as events — `"pending"`/`"running"` runs are structurally excluded (nothing to tell the
  customer about an in-flight scan yet).
- **Diagnostic finding severity** — `msp_diagnostic_findings.severity`:
  `"ok" | "info" | "warning" | "critical"` (`MSP_DIAGNOSTIC_FINDING_SEVERITY`, `msp.ts:3294`).
  The timeline route only surfaces `"warning" | "critical"`.
- **Sales offer state** — `sales_offers.state`:
  `"draft" | "sent" | "accepted" | "rejected" | "expired"` (`SALES_OFFER_STATES`,
  `index.ts:3182`). The timeline route only surfaces `"sent" | "accepted" | "rejected" |
  "expired"` (`"draft"` excluded — not yet a real customer-facing event).
- **Generated document status** — `insights_generated_documents.status`:
  `"draft" | "approved" | "delivered" | "archived" | "generating" | "failed"`
  (`index.ts:2445`). The timeline route only surfaces `"delivered" | "approved"`.
- **Engine key** — `tenant_engine_snapshots.engine_key` is free `text`, no DB-level enum.
  The real, current vocabulary is `ENGINE_DEFS` (`engine-registry.ts`): `priority`,
  `pricing`, `health`, `security`, `drift`, `forecasting`, `crm`, `msp`, `sla`,
  `scope_creep`, `monitoring`, `sales_offer`. Both endpoints handle an unrecognized key
  gracefully — the timeline route title-cases the raw key as a label fallback (`:72-74`);
  the dashboard route just spreads whatever keys are present into `scores`/`pillars`
  without validating against this list.
- **Timeline event type** — `TimelineEventType`: `"scan_completed" | "scan_failed" |
  "finding" | "score_change" | "document" | "offer"` (`portal-customer-timeline.ts:60`) —
  an application-level union, not a DB enum; every value is actually emitted (traced
  above), none is dead.
- **Timeline event status (badge tone)** — `TimelineStatus`: `"default" | "success" |
  "warning" | "error" | "info"` (`:61`) — same, application-level, all 5 values reachable.
- **Project status** — `projects.status`: `"active" | "on_hold" | "completed"`
  (`index.ts:603`). The dashboard route only reads `status = "active"`.
- **Client service status** — `client_services.status`: `"active" | "completed" |
  "paused"` (`index.ts:634`). The dashboard route reads `"active"` (for module
  derivation) and `"active" | "paused"` (for the `clientServices` list).
- **Kanban column** — `kanban_tasks.column`: `"backlog" | "in_progress" |
  "waiting_on_customer" | "review" | "completed"` (`index.ts:681`). Only `"in_progress"`
  is consumed (for `currentTask`).
- **Risk acceptance status** (#2922) — `msp_risk_decisions.status`: `"pending_signature" |
  "active" | "revoked"` (`RISK_ACCEPTANCE_STATUSES`, `msp.ts:6204`). `overviewCounts`
  reads `"pending_signature"` as `rbdWaiting` and `"active"` as `rbdActive`; `"revoked"`
  counts toward neither.
- **Review clock state** (#2922) — `msp_risk_decisions.reviewState` /
  `policy_decisions.reviewState`: `"on_track" | "due" | "overdue"`, or `null` for a
  dependency-based policy decision (#1526) with no date clock at all. `overviewCounts`'
  `policiesExpiringSoon` reads `policy_decisions.reviewState in ("due", "overdue")`,
  advanced on a schedule by `alert-engine.ts`'s `advancePolicyReviewClock`
  (`RISK_REVIEW_DUE_LEAD_DAYS = 14` days).

---

## 4. Finding — timeline's documents/offers sub-queries scope to one login, not the customer

**`portal-customer-timeline.ts` filters `insights_generated_documents` and `sales_offers`
by `eq(..., userId)` — the single logged-in user's own `users.id` (`:172, 193`) — instead
of `resolveCustomerUserIds()`/`resolveSiblingUserIds()`, the multi-login bridge this
exact file's sibling `GET /api/portal/dashboard` route already uses four times in the
same file (`portal-customer-engines.ts:429, 580, 620, 671, 678, 682`) for `projects`,
`clientServices`, `invoices`, and `reports`.**

This is not a style inconsistency — `insights_generated_documents.customerId`'s own
schema comment (`index.ts:2416-2425`) states plainly that scoping by this column alone
"made a document unfindable if that particular login was ever unlinked," which is
exactly why `mspCustomerId` (the tenant-owning column) and the `resolveCustomerUserIds`/
`resolveSiblingUserIds` bridge (`tenant-signals.ts:156-175`, filed under #1397) exist.
`portal-documents.ts` — the real documents-list surface — already uses this bridge
(`resolveSiblingUserIds`, `portal-documents.ts:59, 77`) for this exact table. A customer
with more than one linked login who receives a document or a sales offer against a
*different* login than the one they're timeline-browsing from will not see that event —
the timeline will read as quieter than it really is, with no error and no indication
anything was excluded.

`msp_diagnostic_runs`, `msp_diagnostic_findings`, and `tenant_engine_snapshots` do not
have this problem — all three are scoped by `customerId` = `tenants.id` directly (the
tenant-owning id, not a per-login one), matching how `GET /api/portal/dashboard` scopes
its own `tenant_engine_snapshots` read (`:435`).

Filed as #2499 (sibling of this issue's own parent #1655), labeled `bug`.

---

## 5. Honest-empty / partial-data contract

- **Timeline `events`**: a genuinely empty result is a real `[]`, never a fixture
  substitution — there is no fixture branch in this router at all; a 200 with `events: []`
  is the honest "nothing to show yet" state. A failed read is a `500` with
  `{ error: "Unable to load your activity timeline right now. Please try again shortly." }`
  (`:311-314`) — a caller must distinguish these two states itself (empty-but-200 vs.
  errored-500); there is no third "still loading" state server-side (that's a client
  concern once a UI exists).
- **`nextCursor`**: only non-`null` when at least one of the 5 sources returned a full
  page at its own fetch cap (`runs`/`findings`/`documents`/`offers` at `limit`,
  `snapshots` at `limit * 2`, `:306-307`) — i.e. it is a genuine "there may be more,"
  never a blind "always offer a next page." A tenant with fewer than `limit` total real
  events across all 5 sources gets `nextCursor: null` even on a full first page.
- **Dashboard `results.summary.priorityItems`**: **UPDATE (this pass) — no longer
  hardcoded.** #2500 (filed by the original #2446 extraction below) shipped since this
  pack was first written: `priorityItems` is now a real query over the customer's most
  recent `msp_diagnostic_findings` run, worst-severity-first, gated by the same #164
  paywall as `results.pillars` (title/description null for an unpaid customer; severity/
  checkKey always visible) — see `portal-customer-engines.ts:517-565`. A genuinely empty
  array now means "no critical/warning findings on the latest run," a real honest-empty
  state, not the always-`[]` literal this line originally flagged. #2500 is closed.
- **Dashboard `results.pillars`**: `{}` when the tenant has zero `tenant_engine_snapshots`
  rows — a genuinely never-scanned tenant, not a read failure. There is no separate
  read-failed branch in this route; a DB error 500s the whole request
  (`portal-customer-engines.ts:876-879`, generic `catch`), same two-state contract as the
  timeline route above.
- **Dashboard `customerStatus`/`customerName`**: both explicitly `?? null` (`:863-864`)
  rather than left `undefined`, specifically so the keys never vanish from the JSON
  payload for a customer with no `tenants` row match — called out in the route's own
  comment as a deliberate shape guarantee for `app-shell`'s inactive banner and
  `CustomerDashboardExtras`' promo gate.
- **Dashboard `overviewCounts`** (#2922): every one of the six fields is a real `0`, not
  an omitted key or an error, in two distinct honest-empty cases — (1) `tenantScope` is
  null (no resolvable M365 tenant identifier: all six read `0`), and (2)
  `changeScheduleThisWeek` specifically when the tenant has no active `change_control`
  add-on entitlement (`0`, no query issued at all — the same 402 that route gives a
  direct caller, just folded into an honest `0` here rather than surfaced as an error on
  a payload with five other real fields).

---

## 6. Cross-surface edges

- **Timeline vs. Dashboard `tenant_engine_snapshots` reads**: both routes query the same
  table, scoped identically (`customerId = tenants.id`, no login-bridge needed — this
  table's `customerId` already IS the tenant id, not a users.id). The timeline route's
  read is a `|delta| >= 5` significance filter over recent snapshots (an event feed); the
  dashboard route's read is "the latest snapshot per `engineKey`, always" (a current-state
  summary). No divergent scoping to flag here — they agree on what a "customer" is for
  this table.
- **Timeline vs. Dashboard `insights_generated_documents`/`sales_offers` scoping**:
  diverge exactly as described in §4 — dashboard's own reads never touch these two
  tables at all, so there is no cross-route inconsistency to point to as evidence beyond
  the pattern from `projects`/`clientServices`/`invoices`/`reports`, which *is* bridged.
- **`unreadNotifications` vs. `unreadMessages` scoping**: deliberately asymmetric within
  the same response — notifications stay per-login (`req.user.id` only), messages are
  bridged across the customer's linked logins. Both are commented in-line as intentional
  (`:609-618`), not an oversight; noted here only so Design doesn't "fix" the asymmetry
  by mistake — a per-login notification badge is the intended behavior.
- **`portal/customer/rescoring-status`, `portal/customer/sla-status`,
  `portal/customer/scope-status`** — three sibling routes in the same
  `portal-customer-engines.ts` file, out of scope for this pack (not cited in #2446's
  Step 1 endpoint list) but worth noting for Design: they exist, are `CustomerUser`/
  `Assessment`-gated, and are candidate data sources if Customer Home's design later
  wants SLA/scope-creep tiles alongside the timeline — not designed here.

---

## Orphaned-endpoint check

Neither endpoint has a live frontend caller anywhere in the current tree:

```
grep -rn "portal/customer/timeline\|portal/dashboard" artifacts/portal/src artifacts/msp-website artifacts/shane-mccaw-consulting
```

returns no matches. This is expected, current state — `artifacts/msp-portal` (the only
prior caller) was retired 2026-08-29, and no `Design/portal/` export exists yet for
Customer Home/Timeline. Both routes are real, both are exercised by nothing today; that
is the honest state Design should build against, not a gap this pack needs to close.

---

## Not covered by this pack

Per #2446 Step 3, no page/UI-shape decisions are made here. This pack extracts what
exists on the two named endpoints; it does not decide what Customer Home should look
like, which fields it draws, or how the timeline and dashboard payloads should be
combined into one page.
