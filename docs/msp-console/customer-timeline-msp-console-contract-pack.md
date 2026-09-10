# Customer Timeline (MSP Console operator side) — contract extraction pack

**#3356**, under **#1571** (EPIC: Portal Admin — MSP-side operator surface). No Feature-tier
issue sits between them (confirmed via the GitHub API — #3356's parent is #1571 directly).
Follows the **#1642 pattern**: the wire contract extracted verbatim and cited to file:line,
real enum unions only, cross-surface edges, honest-empty contract, orphaned-endpoint check.
Read-only — no product code, schema, or UI changed by this session; every field below is
cross-checked live against local Postgres (`shanemccawmsp`, `DATABASE_URL`).

**Real, confirmed backend, no pack existed for it yet.** `msp-customer-timeline.ts` is one
real route, `GET /api/msp/timeline` — 418 lines of route code (the file itself is 419 lines
counting the trailing newline). The only prior pack covering timeline data is
`docs/portal/customer-home-and-timeline-contract-pack.md` §1, which documents the
**customer-facing**, single-tenant `GET /api/portal/customer/timeline`. This pack covers the
separate **MSP-console, cross-tenant** operator view — same event model, deliberately mirrored
per this file's own header comment, extended across an MSP's whole book instead of one
tenant. That portal pack is left untouched.

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/msp-customer-timeline.ts` — the route itself (all line
  refs below are into this file unless stated otherwise)
- `artifacts/api-server/src/routes/msp-customer-timeline.test.ts` — confirms the real
  request/response shape and the 401/403/scoping behavior asserted here
- `artifacts/api-server/src/routes/portal-customer-timeline.ts` — the customer-facing sibling
  this route mirrors (event sources, thresholds, sort/paging logic)
- `artifacts/api-server/src/routes/msp-documents-hub.ts` — comparison surface for the
  documents-table scoping bridge (§4)
- `artifacts/api-server/src/routes/msp-alerts.ts` — sibling cross-tenant MSP surface, cited
  for the cross-surface edge in §6
- `artifacts/api-server/src/middlewares/requireAuth.ts` — `requireRole`, `ROLE_ORDER`,
  `resolveStaffScopedCustomerIds`
- `artifacts/api-server/src/lib/resolve-msp-id.ts` — `resolveMspIdStrict`
- `artifacts/api-server/src/lib/engine-registry.ts` — `ENGINE_DEFS` (engine key → label)
- `artifacts/api-server/src/lib/doc-gate-coverage.ts` — `evaluateDocGateCoverage()`,
  `DOC_GATE_MIN_COVERAGE_PCT`
- `artifacts/api-server/src/routes/index.ts:229,593` — router mount; `artifacts/api-server/src/app.ts:107-127`
  — confirms the real, live path is `GET /api/msp/timeline` under `app.use("/api", subscriptionGate, router)`
- `lib/db/src/schema/msp.ts` — `msp_diagnostic_runs`, `msp_diagnostic_findings`,
  `msp_staff_customer_scopes` (real enum/column sources)
- `lib/db/src/schema/index.ts` — `tenant_engine_snapshots`, `insights_generated_documents`,
  `sales_offers`, `tenants`, `users` (real enum/column sources)

---

## 1. Wire contract — `GET /api/msp/timeline`

Auth: `requireRole("MSPOperator")` (`:117`) — MSPOperator, MSPAdmin, or PlatformAdmin
(`ROLE_ORDER`, `requireAuth.ts:81-89`); anything below (`CustomerUser`/`Free`/`Assessment`/
`ServiceAccount`) is rejected `403` (`requireAuth.ts:227-229`), and a missing/invalid bearer
token is `401` (`requireAuth.ts:112-115`) — both confirmed by the test file's first two cases
(`msp-customer-timeline.test.ts:205-215`).

`mspId` comes from `resolveMspIdStrict(req)` (`:119`, `resolve-msp-id.ts:75-77`) — reads
`req.user.mspId` off the session JWT only. **There is no `?mspId=` override** — unlike some
sibling MSP routes' `requireMspScope`, this route has no query-param path for a PlatformAdmin
to cross into another MSP's book; a `null` `mspId` (a caller whose JWT carries none) 403s with
`{ error: "MSP context required" }` (`:120-123`).

Per-staff scoping: `resolveStaffScopedCustomerIds(req.user!)` (`:125`,
`requireAuth.ts:360-372`) reads `msp_staff_customer_scopes` for the caller's `staffUserId`.
**Zero scope rows means unrestricted** (`requireAuth.ts:370` — `rows.length === 0` returns
`null`, read downstream as "no restriction"), not "sees nothing" — a staff member with no
scope rows assigned sees the whole MSP's book. A scoped member (≥1 row) sees only their
assigned `tenants.id` set.

Query params:

| Param | Type | Behavior |
|---|---|---|
| `customerId` | integer | Narrows to one customer — but only within the caller's own staff scope (`:127-136`); a scoped staff member passing a `customerId` outside their assignment gets **zero results**, not the unscoped default and not a 403 — the filter narrows, it never overrides scope. |
| `limit` | integer | Default 30, clamped 1-100 (`DEFAULT_LIMIT`/`MAX_LIMIT`, `:62-63, 138`) |
| `before` | ISO date string | Cursor; invalid or missing dates are silently ignored (`:139-140`) |

Response shape (`:411`):

| Field | Type | Nullability | Source |
|---|---|---|---|
| `events` | `CrossTenantTimelineEventDto[]` | not null (`[]` is real) | merged across 5 sources, re-sorted, sliced to `limit` (`:288-402`) |
| `nextCursor` | `string \| null` | nullable | last page item's timestamp, only set if **any** source hit its own fetch cap — see §5 (`:404-409`) |

Each `CrossTenantTimelineEventDto` (`:68-78`):

| Field | Type | Nullability | Source |
|---|---|---|---|
| `id` | `string` | not null | `"<source>:<rowId>"` — `"run:<uuid>"`, `"finding:<uuid>"`, `"score:<int>"`, `"document:<int>"`, `"offer:<int>"` |
| `type` | `"scan_completed" \| "scan_failed" \| "finding" \| "score_change" \| "document" \| "offer"` | not null | `TimelineEventType`, `:65` |
| `title` | `string` | not null | per-source, see §2 |
| `description` | `string \| undefined` | optional | per-source; `undefined` is dropped by `JSON.stringify` (absent from the wire, never `null`) |
| `status` | `"default" \| "success" \| "warning" \| "error" \| "info"` | not null | `TimelineStatus`, `:66` |
| `timestamp` | `string` (ISO) | not null | the event's real occurred-at time, per-source |
| `customerId` | `number \| null` | nullable | `tenants.id`, via the `customerFor()` helper (`:279-286`) |
| `customerName` | `string \| null` | nullable | `tenants.customerName`, resolved from the `customers` query's in-memory map (`:150`); `null` if the id isn't in the caller's own MSP-scoped customer set |
| `deepLink` | `string \| null` | nullable | `` `/customers/${customerId}` `` (`:284`), or `null` when `customerId` is `null` |

This is a **wider DTO than the portal timeline's own `TimelineEventDto`** (`docs/portal/customer-home-and-timeline-contract-pack.md` §1) — the three customer-attribution fields (`customerId`/`customerName`/`deepLink`) exist here because this is a cross-tenant merge; the single-tenant portal version has no need to say which customer an event belongs to.

---

## 2. The 5 sources, merged (`Promise.all`, `:157-277`)

Identical event model to `portal-customer-timeline.ts` (same thresholds, same status
mapping), scoped by `mspId` (+ staff scope) instead of one `customerId`:

1. **`msp_diagnostic_runs`** (`:158-184`), scoped `mspId` + (if scoped) `customerId IN
   effectiveCustomerIds`, status `IN ("completed", "partial", "failed")` (`:178` —
   `"pending"`/`"running"` runs are structurally excluded, nothing to tell an operator about
   an in-flight scan yet). `"partial"` is included deliberately — graded via
   `evaluateDocGateCoverage()` (real `checksOk`/`checksLicenseGap`/`checksTotal` counts,
   `DOC_GATE_MIN_COVERAGE_PCT = 50`, `doc-gate-coverage.ts:52`) rather than excluded, per the
   route's own comment (`:174-177`) — a run that never literally reaches `"completed"` (a
   tenant with permanently-unrunnable checks) still surfaces. Emits `scan_completed` (title
   varies on whether coverage was sufficient, `:304-312`) or `scan_failed` (`:313-322`,
   always `status: "warning"`, never `"error"`). Timestamp: `completedAt ?? createdAt`
   (`:291`).
2. **`msp_diagnostic_findings`** (`:186-205`), scoped `mspId` + (if scoped) `customerId`,
   severity `IN ("warning", "critical")` (`"ok"`/`"info"` excluded as routine noise, `:199`).
   Emits `finding`, `status: "error"` for critical / `"warning"` otherwise (`:325-335`).
   Timestamp: `createdAt`.
3. **`tenant_engine_snapshots`** (`:207-226`), scoped `mspId` + (if scoped) `customerId`,
   over-fetched at `limit * 2` (`:226` — most rows get filtered client-side below the
   threshold). Only `|delta| >= 5` (`SCORE_DELTA_SIGNIFICANCE_THRESHOLD`, `:61`) becomes an
   event. Emits `score_change`, title `"<Engine Label> score improved/declined"` (label via
   `ENGINE_DEFS`, title-cased raw key fallback for an unrecognized `engineKey`, `:80-82`).
   Timestamp: `capturedAt`.
4. **`insights_generated_documents`** (`:228-250`), status `IN ("delivered", "approved")`,
   scoped via `eligibleUserIds` — **every `users.id` bridged from `usersTable.tenantId` for
   every tenant in the caller's effective customer set** (`loadCustomerBridge`, `:97-113`;
   the query joins `usersTable` to `tenantsTable` on `tenantId`, filtered `tenants.mspId =
   mspId`, so it covers **every login** under every eligible tenant, not just one). Skipped
   entirely (`Promise.resolve([])`) when `eligibleUserIds.length === 0` (`:228-229`). Emits
   `document`, always `status: "success"`, title `"New document ready: <title>"`. Timestamp:
   `deliveredAt ?? approvedAt ?? createdAt` (`:353`).
5. **`sales_offers`** (`:252-276`), scoped `mspId` + (if scoped) `customerId IN
   effectiveCustomerIds` **directly** — `sales_offers.customer_id` is a real FK straight to
   `tenants.id` (`index.ts:3400`), not a `users.id` needing a bridge, per the route's own
   comment (`:268-271`). State `IN ("sent", "accepted", "rejected", "expired")` — `"draft"`
   excluded (`:267`, not yet a real event). Emits `offer`, title/status per state (`accepted`
   → success, `rejected`/`expired` → default, `sent` → info, `:365-389`). Timestamp: the
   first non-null of the state-appropriate date field, falling back to `sentAt ?? createdAt`.

All 5 are merged into one array, sorted descending by `timestamp` string comparison (`:401`
— lexicographic on ISO-8601, timestamp-order-correct), then sliced to `limit` (`:402`).

---

## 3. Real enum unions

- **Diagnostic run status** — `msp_diagnostic_runs.status`: `"pending" | "running" |
  "completed" | "failed" | "partial"` (`MSP_DIAGNOSTIC_RUN_STATUS`, `msp.ts:3602`). This
  route surfaces `"completed" | "partial" | "failed"` as events.
- **Diagnostic finding severity** — `msp_diagnostic_findings.severity`: `"ok" | "info" |
  "warning" | "critical"` (`MSP_DIAGNOSTIC_FINDING_SEVERITY`, `msp.ts:3655`). This route
  surfaces `"warning" | "critical"`.
- **Sales offer state** — `sales_offers.state`: `"draft" | "sent" | "accepted" | "rejected" |
  "expired"` (`SALES_OFFER_STATES`, `index.ts:3384`). This route surfaces `"sent" |
  "accepted" | "rejected" | "expired"`.
- **Generated document status** — `insights_generated_documents.status`: `"draft" |
  "approved" | "delivered" | "archived" | "generating" | "failed"` (`index.ts:2633`). This
  route surfaces `"delivered" | "approved"`.
- **Engine key** — `tenant_engine_snapshots.engine_key` is free `text`, no DB-level enum.
  Real, current vocabulary is `ENGINE_DEFS` (`engine-registry.ts:181-`): `priority`,
  `pricing`, `health`, `security`, `drift`, `forecasting`, `crm`, `msp`, `sla`,
  `scope_creep`, `monitoring`, `sales_offer`. An unrecognized key title-cases gracefully
  (`:80-82`), same fallback the portal route uses — no crash on a stale/unregistered key.
- **Timeline event type** — `TimelineEventType`: `"scan_completed" | "scan_failed" |
  "finding" | "score_change" | "document" | "offer"` (`:65`) — application-level, all 6
  values actually emitted, none dead.
- **Timeline event status (badge tone)** — `TimelineStatus`: `"default" | "success" |
  "warning" | "error" | "info"` (`:66`) — application-level. All 5 are reachable except
  `"default"`, which only the offer source ever emits (`rejected`/`expired` states, `:377,
  382`) — no other source reaches it.
- **MSP role floor for this route** — `MspRole` ordering (`ROLE_ORDER`, `requireAuth.ts:81-89`):
  `Assessment < Free < CustomerUser < ServiceAccount < MSPOperator < MSPAdmin <
  PlatformAdmin`. `requireRole("MSPOperator")` admits the top 3.

---

## 4. Finding — the header docblock misdescribes `sales_offers.customerId`

**The file's own top-of-file comment (`:22-24`) states:**

> `insights_generated_documents.customerId` and `sales_offers.customerId` are both
> `users.id`, NOT `msp_customers.id` — bridged via `msp_users` the same way
> `msp-documents-hub.ts` already does.

That is **true for `insights_generated_documents`** (`index.ts:2603` — `.references(() =>
usersTable.id)`) but **false for `sales_offers`**: its `customerId` column is a direct FK to
`tenantsTable.id` (`index.ts:3400`), confirmed by both the schema and the route's own later,
correct inline comment 250 lines further down in the **same file**:

> `sales_offers.customerId` is a `tenants.id` (#2730) — filter directly against
> `effectiveCustomerIds`, not the `users.id`-shaped `eligibleUserIds` bridge that documents
> (above) genuinely needs. (`:268-271`)

The code itself is correct — the offers query filters `salesOffersTable.customerId` directly
against `effectiveCustomerIds` (`:271`) and never touches the `eligibleUserIds` bridge, and
the offers-loop's post-hoc `bridge.get(offer.customerId)` (`:390`) is dead-on-arrival for this
column (a tenant id will essentially never collide with a `users.id` key in that map, so it
resolves to `undefined` in practice — harmless only because `customerFor(null)` still renders
a null-attributed event correctly, `:279-280`). Only the **header docblock's own prose** is
stale — a leftover from before #2730 moved `sales_offers.customerId` to point at tenants
directly. A reader trusting the header over the code would misunderstand the real scoping
model for this table.

Filed as its own issue (`bug`, parented to #1571 — no Feature-tier parent exists for #3356),
listed in this build's DONE bookend.

---

## 5. Honest-empty / partial-data contract

- **`events`**: a genuinely empty result is a real `[]` — no fixture branch exists in this
  router. A read failure is a `500` with `{ error: "Unable to load the activity timeline
  right now. Please try again shortly." }` (`:412-415`); a caller must distinguish
  empty-but-200 from errored-500 itself — there is no third "still loading" state
  server-side. Confirmed against local Postgres: `tenant_engine_snapshots` and
  `insights_generated_documents` are genuinely empty tables in the local dev DB right now (0
  rows each) while `msp_diagnostic_runs` (2), `msp_diagnostic_findings` (296), and
  `sales_offers` (5) are not — so a real call against local dev returns a real, partial
  3-source timeline, not an all-or-nothing fixture.
- **`nextCursor`**: only non-`null` when at least one of the 5 sources hit its own fetch cap
  (`runs`/`findings`/`documents`/`offers` at `limit`, `snapshots` at `limit * 2`, `:407-408`)
  — a genuine "there may be more," never a blind "always offer a next page." An MSP book with
  fewer than `limit` total events across all 5 sources gets `nextCursor: null` even on a full
  first page.
- **A scoped staff member with a `customerId` query param outside their own scope**: gets an
  honest empty `events: []`, not an error and not the unscoped book (`:131-136` —
  `effectiveCustomerIds` resolves to `[]` in that case, and every downstream query is
  filtered against an empty `inArray`).
- **Documents source specifically**: when `eligibleUserIds.length === 0` (an MSP book with no
  bridgeable logins at all, or a staff scope resolving to zero eligible customers), the
  documents query is skipped outright — `Promise.resolve([])` (`:228-229`) — rather than
  issuing a query with an empty `inArray`, which some SQL dialects/ORMs mishandle
  differently; that this route special-cases it is worth Design/QA knowing, not a bug.

---

## 6. Cross-surface edges

- **vs. `portal-customer-timeline.ts`** (the customer-facing sibling): same 5 sources, same
  significance thresholds (`SCORE_DELTA_SIGNIFICANCE_THRESHOLD = 5`, `DEFAULT_LIMIT = 30`,
  `MAX_LIMIT = 100` — identical constants in both files), same status/title mapping per
  source. The real divergence is scope and the documents/offers bridge: the portal route
  scopes `insights_generated_documents`/`sales_offers` by `eq(customerId, userId)` — the
  single logged-in user's own id, not even bridged across that customer's other logins
  (documented as a real bug there, `docs/portal/customer-home-and-timeline-contract-pack.md`
  §4, filed as #2499). **This MSP-console route does not reproduce that bug for documents** —
  `eligibleUserIds` is built from every login under every eligible tenant (`:97-113`), so a
  document delivered against any of a customer's linked logins surfaces here. For offers it's
  moot either way since `sales_offers.customerId` is already a direct tenant id (§4 above).
- **vs. `msp-alerts.ts`** (the sibling cross-tenant MSP surface, `GET /api/msp/alerts`): both
  routes independently re-implement "`msp_diagnostic_findings` restricted to
  `warning`/`critical`, on a coverage-sufficient run, graded via `evaluateDocGateCoverage()`"
  for the same `mspId` + `resolveStaffScopedCustomerIds` scoping model — but `msp-alerts.ts`
  additionally merges `policy_rule_incidents` (open Signal Policy Engine incidents), which
  this timeline route has no source for at all. An operator can see an open policy incident
  on the Alerts view with **no corresponding event** on this Timeline view — not a bug (the
  two surfaces have different, stated purposes: one is a triage queue, the other a
  chronological feed) but a real content gap between two surfaces an operator may expect to
  agree, worth Design knowing.
- **`msp_diagnostic_runs`/`msp_diagnostic_findings`/`tenant_engine_snapshots` scoping**: all
  three are scoped by `customerId = tenants.id` directly, no bridge needed — matching the
  portal route's own equivalent reads for the same three tables.

---

## Orphaned-endpoint check

```
grep -rn "msp/timeline" artifacts/ --include=*.ts --include=*.tsx | grep -v '\.test\.ts'
```

returns only the route file's own definition and its own header/comment lines — no frontend
caller anywhere in the current tree. This is expected, current state, not a gap this pack
invents: no `artifacts/portal` MSP-console page exists yet for a cross-tenant activity
timeline, and no `Design/portal/` export names one. The endpoint is real, live, and
mounted (`app.ts:127` → `routes/index.ts:593`) but exercised by nothing today.

---

## Not covered by this pack

Per the #1642 pattern, no page/UI-shape decisions are made here. This pack extracts what
exists on `GET /api/msp/timeline` as built; it does not decide what an MSP-console Timeline
page should look like or how it should be laid out alongside `GET /api/msp/alerts`.
