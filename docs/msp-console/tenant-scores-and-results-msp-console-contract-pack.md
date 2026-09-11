# Tenant Scores and Results — MSP Console contract extraction pack

**#3619**, for **Feature #3557** (Tenant Scores and Results, MSP Console — operator visibility
into customer scores), under Epic #1571 (Portal Admin) / Epic #1485 (Portal)'s standing sequence:
**architect → build the endpoints → regenerate the contract pack from the real code → Design →
wire.** The backend this pack documents was built and merged under **#3558**
(`799c9c01f`, 4/4 tests passing, `msp-customer-scores.ts` + `msp-customer-scores.test.ts`).

Read-only. Every field below is extracted verbatim from the route's own logic and the Drizzle
schema, cited to file:line, cross-checked live against local PostgreSQL. **Nothing here is
authored or invented.** No product code, schema or UI was touched to produce this document.

This is the **first contract pack for this route** — no prior pack exists for it under
`docs/msp-console/` or anywhere else. It documents the operator-facing mirror of the score/results
slice of `GET /portal/dashboard` (`portal-customer-engines.ts`), which is itself already
partially described (its projects/services/invoices/counts half, not its scores half) by
`docs/portal/customer-home-and-timeline-contract-pack.md`. This pack does not duplicate that one —
it documents only the new MSP-side route and cites the customer route's scores/results logic by
line wherever the two are shared.

Backend route (one file, one route — the smallest surface any pack in this directory has
documented to date):

- `msp-customer-scores.ts` (217 lines) — `GET /api/msp/customers/:customerId/scores` (1 route)

Mounted: `routes/index.ts:124` imports `mspCustomerScoresRouter`; `routes/index.ts:456`
`router.use(mspCustomerScoresRouter)`; the combined router is mounted at `/api` by
`app.ts:127` (`app.use("/api", subscriptionGate, router)`) — live and reachable, same
chokepoint every other route in this codebase mounts through.

Schema: `lib/db/src/schema/index.ts:3905-3922` (`tenantEngineSnapshotsTable`,
`tenant_engine_snapshots`), `lib/db/src/schema/msp.ts:3667-3700` (`mspDiagnosticFindingsTable`,
`msp_diagnostic_findings`), `lib/db/src/schema/msp.ts:200-260` (`tenantsTable`, `tenants`).
Verified live against local PostgreSQL (`psql "$DATABASE_URL" -c '\d tenant_engine_snapshots'`) —
every column matches the Drizzle source exactly.

---

## 0. The surface, its consumer, and what "MSP-side mirror" actually means

### 0.1 Consumer today

| Endpoint | Method | Route file:line | Consumer today | Status |
|---|---|---|---|---|
| `/api/msp/customers/:customerId/scores` | GET | `msp-customer-scores.ts:69-214` | none | live, staged |

**Confirmed against the real consumer, not assumed:** `artifacts/msp-console/src` exists but
holds only 6 files today (`App.tsx`, `index.css`, `lib/utils.ts`, `main.tsx`,
`pages/index.tsx`, `pages/not-found.tsx`) — none reference `scores` or `customers`. No design
export exists yet for this Feature under `Design/portal/` (searched, none found). This is the
expected pre-Design/pre-wire state per this module's own standing sequence, not a gap this pack
invents — no orphaned-endpoint sub-issue filed for it.

### 0.2 "MSP-side mirror" — what it copies from `/portal/dashboard`, and what it deliberately does not

`msp-customer-scores.ts`'s own header (`:1-31`) states it re-uses the identical
`tenantEngineSnapshotsTable` read `/portal/dashboard` (`portal-customer-engines.ts:415-923`)
already performs — verified true by reading both side by side. The scores/pillars/priorityItems
block (`msp-customer-scores.ts:76-174`) is line-for-line the same query shape, same loop logic,
same derived fields as `portal-customer-engines.ts:445-579`. What differs:

1. **Customer-id resolution & auth.** Portal: `req.user.customerId` (the JWT claim,
   `portal-customer-engines.ts:419`), `requireAuth` (any authenticated role with a customerId
   claim). MSP: `resolveAuthorizedCustomerId(req, res)` (`msp-customer-scores.ts:56-67`) parses
   `:customerId` from the URL and calls `assertCustomerAccess(req.user!, customerId)`
   (`requireAuth.ts:393-415`) — 400 on a non-numeric id before any ownership check (proven by
   `msp-customer-scores.test.ts:98-102`), 404 (never a distinguishable error) on a customer
   outside the caller's MSP book or blocked by per-staff scoping
   (`isCustomerBlockedByStaffScope`, `requireAuth.ts:411`). Gated by
   `requireCapability("ladder.msp-operator")` (`msp-customer-scores.ts:71`) — confirmed against
   `legacy-ladder.ts:243` (`MSPOperator: "ladder.msp-operator"`) this is the same capability
   `msp-remediation-tracker-scores.ts` and `msp-engine-history.ts` gate on; role-order semantics
   mean MSPAdmin and PlatformAdmin clear it too, matching the file header's own "MSPOperator+"
   claim.
2. **No paywall gate, on BOTH findings text AND priority-item text** — a real, confirmed
   product decision (`msp-customer-scores.ts:23-30`), not a guess. The customer route redacts
   two independent things behind the #164 paid-SOW gate: (a) `pillars[engineKey]`'s
   `findings`/`recommendations` arrays collapse to `findingsCount`/`recommendationsCount` for an
   unpaid customer (`portal-customer-engines.ts:510-512`), and (b) `priorityItems[].title`/
   `.description` null out for an unpaid customer (`portal-customer-engines.ts:576-577`). The
   MSP route's pillar block (`msp-customer-scores.ts:124`) and its priorityItems block
   (`msp-customer-scores.ts:168-173`) never apply either gate — full text, unconditionally, for
   every customer regardless of their own paid status. Verified live in test:
   `msp-customer-scores.test.ts:159-173` is the load-bearing assertion the test file's own
   header calls out.
3. **Response is a deliberate SUBSET of `/portal/dashboard`'s payload, not a full mirror.**
   Feature #3557's own scope (§ its body, item 1) asked for "the same scores... and all the same
   results as the customer" — this route delivers exactly the scores/results slice
   (`customerId`, `customerName`, `customerStatus`, `telemetryStatus`, `scores`, `results`) and
   nothing else. It does **not** carry `/portal/dashboard`'s `type_attributes`, `projects`,
   `clientServices`, `invoices`, `reports`, `unreadNotifications`, `unreadMessages`, `mspId`,
   `tenantScopeResolved`, or `overviewCounts` (`portal-customer-engines.ts:861-917`) — none of
   which #3557 asked for. This is scope, not a gap.

---

## 1. Wire contract — `GET /api/msp/customers/:customerId/scores`

Source: `msp-customer-scores.ts:69-214`.

**Request:** `:customerId` path param, integer. 400 `{ error: "Invalid customerId" }` if
non-numeric (`:57-60`, proven by test). 404 `{ error: "Customer not found" }` if the caller's
`assertCustomerAccess` check fails (`:62-65`, proven by test) — the same never-disclose-existence
convention every other single-customer `/api/msp/*` route in this codebase uses.

**Response `WireCustomerScores`** (`:184-208`):

| Field | Type | Nullability | Line | Source |
|---|---|---|---|---|
| `customerId` | `number` | never null | `185` | the resolved `:customerId` |
| `customerName` | `string \| null` | null if no tenant row | `186` | `tenants.customer_name` |
| `customerStatus` | `string \| null` (tenant status enum, §2) | null if no tenant row | `187` | `tenants.status` |
| `telemetryStatus` | `"in_progress" \| "completed"` | never null | `182`, `188` | derived: `"in_progress"` iff `tenants.status === "onboarding"`, else `"completed"` |
| `scores` | `Record<string, number>` | never null, always carries 6 named keys | `189-197` | derived from `tenant_engine_snapshots`, see §1a — **`governance` is a phantom key, §3** |
| `results.status` | `"running" \| "complete"` | never null | `199` | `telemetryStatus === "in_progress" ? "running" : "complete"` |
| `results.runId` | `string \| null` | null if zero snapshots | `93`, `200` | first non-null `tenant_engine_snapshots.run_id` seen, newest-first |
| `results.generatedAt` | `string \| null` (ISO) | null if zero snapshots | `94`, `201` | first non-null `tenant_engine_snapshots.captured_at`, newest-first |
| `results.summary.compositeScore` | `number \| null` | null if zero snapshots with a non-null score | `203` | `Math.round(sum(score) / count(score))` across the newest snapshot per distinct `engine_key` |
| `results.summary.priorityItems` | `PriorityItem[]` | `[]` if no findings run exists for this customer | `133-173` | see §1b — **never redacted**, unlike the customer route |
| `results.pillars` | `Record<string, WirePillar>` | `{}` if zero snapshots | `124` | one entry per distinct `engine_key` seen, see §1a |

### 1a. `scores` / `results.pillars` derivation (`:76-126`)

One query: `SELECT engine_key, score, breakdown, run_id, captured_at FROM
tenant_engine_snapshots WHERE customer_id = :customerId ORDER BY captured_at DESC` (`:77-87`).
The loop (`:96-126`) keeps only the **first (newest) row seen per distinct `engine_key`** —
`if (scores[snap.engineKey] === undefined && snap.score !== null)` (`:97`) — so an engine with
multiple historical snapshots contributes only its latest score to both `scores` and
`results.pillars`, and a `null` score is silently skipped (never overwrites, never zeroes) rather
than counted. `compositeScore` averages only the engine keys that pass that filter (`:100-101`,
divided at `:203`).

Each pillar entry: `breakdown` (a jsonb array on the row) is walked once to build `findings[]`
(from `item.finding` ?? `item.message` ?? `item.label`, `:112-115`) and `recommendations[]`
(from `item.recommendation` ?? `item.action`, `:116-117`); the pillar object is always
`{ score, status: "complete", findings, recommendations }` (`:124`) — `status` is a hardcoded
literal, not derived from anything (matches the customer route's own hardcoded `"complete"`,
`portal-customer-engines.ts:511`).

`scores` itself (`:189-197`) is built as six named defaults (`security`, `health`, `governance`,
`drift`, `sla`, `scope_creep`, each `?? 0`) with the real `scores` map spread over the top
(`...scores`) — so any engine key beyond those six that actually has a snapshot rides along too,
keyed by its own real `engine_key` string. Byte-identical shape to `portal-customer-engines.ts:
862-870`.

### 1b. `results.summary.priorityItems` derivation (`:128-174`)

Two-step, both scoped by `customerId` directly (defense-in-depth against `msp_diagnostic_
findings.run_id` alone never being trusted to imply tenant scope, per the `:154` comment,
identical rationale to `portal-customer-engines.ts:556-560`'s #3102 note):

1. Find this customer's most recent finding row by `created_at` and take its `run_id`
   (`:134-139`).
2. Pull every row for that exact `(run_id, customerId)` pair whose `severity` is `critical` or
   `warning` (`:141-159`) — `ok`/`info` rows are never candidates.

Sort: `critical` before `warning` (`severityRank`, `:161`), then newest-`createdAt`-first within
a severity (`:162-166`) — a **stable** sort, so rows with an identical `createdAt` (the normal
case: one scan run typically writes every finding in the same transaction/instant) keep their
original DB read order as the tiebreak. Sliced to the top 5 (`:168`). Each item:
`{ checkKey, severity, title, description }` — `title`/`description` are **never** conditionally
nulled (`:169-172`), unlike the customer route's `isPaidTier ? row.title : null`
(`portal-customer-engines.ts:576-577`).

---

## 2. Real enum unions

All pulled verbatim from the schema, verified live.

```ts
// lib/db/src/schema/msp.ts:229 — tenants.status
TENANT_STATUS = ["active", "inactive", "onboarding", "archived"]
// telemetryStatus derivation (msp-customer-scores.ts:182) treats every non-"onboarding"
// value identically as "completed" — "inactive" and "archived" tenants read exactly the
// same as "active" ones on this field. Copied unchanged from the customer route
// (portal-customer-engines.ts:624); not a new gap introduced by this route.

// lib/db/src/schema/msp.ts:3675 — msp_diagnostic_findings.severity
MSP_DIAGNOSTIC_FINDING_SEVERITY = ["ok", "info", "warning", "critical"]
// priorityItems only ever surfaces "critical" | "warning" (msp-customer-scores.ts:157) —
// the other two values exist in the DB (confirmed live, see §4) but are never candidates.

// engine-registry.ts:183-293 — the FULL, real set of engine keys any tenant snapshot can
// ever carry (writeEngineSnapshot(def.key, ...) at :482 is the only writer of
// tenant_engine_snapshots.engine_key in the codebase):
REAL_ENGINE_KEYS = [
  "priority", "pricing", "health", "security", "drift", "forecasting",
  "crm", "msp", "sla", "scope_creep", "monitoring", "sales_offer",
]
// "governance" is NOT in this list. See §3 — the response's own `scores.governance`
// default can never be replaced by a real value from any engine that exists today.
```

`engine_key` and `severity` are both plain `text` columns with no DB-level CHECK constraint
(confirmed live: `psql \d tenant_engine_snapshots` / `\d msp_diagnostic_findings` show none) —
validation, such as it is, lives entirely in application code.

---

## 3. FINDING — `scores.governance` is a phantom key; no engine ever writes it

**Live-confirmed, not inferred.** `writeEngineSnapshot()` (`engine-registry.ts:324-403`) is the
only function anywhere in `artifacts/api-server/src` that inserts into
`tenant_engine_snapshots` (`grep -rn "insert(tenantEngineSnapshotsTable)"` — one hit), and its
only caller passes `def.key` (`engine-registry.ts:482`) from the registered `ENGINE_DEFS` array
(`:178-301`), whose full, real key set is exactly the twelve strings in §2's
`REAL_ENGINE_KEYS`. **`"governance"` is not one of them** — grepped for any literal
`engineKey: "governance"` anywhere in the route/lib tree: zero hits.

`msp-customer-scores.ts:190` (and its identical twin, `portal-customer-engines.ts:864`) both
hardcode `governance: scores.governance ?? 0` as one of six named defaults in the response. Since
no engine can ever produce a `tenant_engine_snapshots` row with `engine_key = 'governance'`, that
default is not "0 until a scan runs" — it is **permanently and structurally 0**, indistinguishable
on the wire from a real, scored, healthy governance pillar. A consumer building a scorecard UI
against this field (customer-side or MSP-side) would show a governance tile that can never move,
with no way to tell "no engine scores this yet" from "this tenant scores perfectly on governance."

This predates #3558/#3619 — it was copied verbatim from the already-live customer route
(`portal-customer-engines.ts:864`, itself unchanged since at least the #315/#327 history that
route's own comments reference) into the new MSP mirror, so it is not a defect this Feature's own
build introduced, but it is a real, live, user-facing gap this audit could not avoid surfacing
while extracting the six-key `scores` contract. **Filed as its own issue, parented under Feature
#3557 per this build's standing rules — see the DONE bookend for the issue number.** Labeled
`bug` (not `security`).

---

## 4. Live-data state — the honest, confirmed empty-scan gap (and what real data DOES exist)

Per this issue's own body: *"local `tenant_engine_snapshots` has 0 rows right now, so
live-eyeball verification against real populated data isn't possible until a real scan runs —
document that honestly rather than fabricating sample data."* Confirmed exactly true, live,
2026-09-11:

```
psql "$DATABASE_URL" -c "SELECT count(*) FROM tenant_engine_snapshots;"
 count
-------
     0
```

So for **every** real tenant in this database today, `scores` reads as all-zero and
`results.pillars`/`compositeScore`/`runId`/`generatedAt` read as empty/null — a true, honest
"never scanned" state per this route's own logic (§1a), not a bug and not something this pack can
show populated without inventing a row, which it will not do.

**`results.summary.priorityItems` is a different story — real data exists for it already**, because
it is sourced from `msp_diagnostic_findings`, a separate table with real rows:

```
psql "$DATABASE_URL" -c "SELECT customer_id, severity, count(*) FROM msp_diagnostic_findings GROUP BY customer_id, severity ORDER BY customer_id, severity;"
 customer_id | severity | count
-------------+----------+-------
           1 | critical |     9
           1 | info     |    40
           1 | ok       |   127
           1 | warning  |    22
           3 | critical |     4
           3 | info     |    23
           3 | ok       |    60
           3 | warning  |    11
```

Both real tenants (`tenants.id` 1 "Jane Jane", 3 "Test Me", both `mspId = 1`, both
`status = active`) have real, non-trivial finding sets. Reproducing this route's exact §1b query
by hand against customer 1's real latest run (`run_id = 7e1d3a8a-a36c-4dbf-8606-bcfff0b44ec5`,
`created_at = 2026-09-06 19:07:08`) returns 31 real critical/warning rows; the route's own
top-5-after-sort slice would be the 5 real criticals it lists first by insertion order (stable
sort, all sharing one `created_at`):

```
compliance:zero-dlp-policies        critical  "No DLP policies exist — data loss prevention is absent on this tenant"
appgov:risky-permission-grants      critical  "26 of 39 OAuth consent grant(s) are tenant-wide (consentType AllPrincipals)..."
appgov:stale-app-registrations      critical  "5 app registration(s) over a year old, unreviewed"
appgov:unreviewed-consents          critical  "13 of 39 OAuth consent grant(s) were self-consented..."
identity:break-glass-health         critical  "No enabled break-glass account — real risk of total tenant lockout"
```

So calling this route today for `customerId = 1` or `3` returns a real, non-fabricated,
non-empty `priorityItems` array (unredacted, per §0.2) sitting alongside an honestly-empty
`scores`/`pillars`/`compositeScore` — both states are simultaneously true and both are correct
per this route's own logic, not a contradiction.

---

## 5. Cross-surface edges

- **Same table, two consumers, one write path.** `tenant_engine_snapshots` is read by this
  route, by `/portal/dashboard` (`portal-customer-engines.ts:445-455`), by
  `/portal/customer/export` (`portal-customer-engines.ts:1153-1161`), and by `admin-engines.ts`
  (`:556`); written only by `writeEngineSnapshot()` (§3). A future real scan populating this
  table makes all four surfaces move together — there is no separate MSP-side copy to
  independently backfill.
- **Same table, two consumers, one write path (findings).** `msp_diagnostic_findings` backs
  this route's `priorityItems` (§1b) and the identical block in `/portal/dashboard`
  (`portal-customer-engines.ts:536-579`) — same query shape, same customer-scoping defense
  (#3102), same severity filter. Neither route writes to this table; it is written by the
  diagnostic-run pipeline (`msp_diagnostic_runs` → `msp_diagnostic_findings`, outside this
  pack's scope).
- **`assertCustomerAccess` is the identical chokepoint** every other single-customer
  `/api/msp/*` route in this codebase resolves ownership through (`msp-remediation-tracker-
  scores.ts`, `msp-engine-history.ts`, `msp-diagnostics.ts`) — this route adds no new
  authorization mechanism, it reuses the one already proven correct elsewhere.

---

## 6. The forbidden list — declared, not merely absent

1. **No cross-customer read.** `resolveAuthorizedCustomerId` (`:56-67`) resolves `customerId`
   through `assertCustomerAccess` before any query runs — an MSPAdmin/MSPOperator whose `mspId`
   does not own the target tenant, or who is blocked by per-staff scoping, gets 404, never a
   distinguishable 403. Proven by test (`msp-customer-scores.test.ts:104-110`).
2. **No route in this pack redacts findings/recommendation or priority-item text for any
   reason.** §0.2 — verified true by direct line comparison against the customer route's two
   independent gates, and by the test file's own load-bearing assertion.
3. **No route in this pack fabricates a score, a pillar, or a priority item.** Every read is a
   real, derived query — a tenant with zero snapshots and zero findings returns an honest empty/
   zero/null shape (proven by test: `msp-customer-scores.test.ts:176-189`), never a fixture or a
   placeholder row.
4. **No route in this pack writes anything.** The entire file is a single `GET` handler; there
   is no mutation path to declare forbidden beyond "does not exist."

---

## 7. Provenance

Written 2026-09-11 against `main` (branch `agent/3619-q2285`), for #3619 (contract-pack step of
Feature #3557, Tenant Scores and Results MSP Console). Read in full, not sampled:
`msp-customer-scores.ts` (217 lines), `msp-customer-scores.test.ts` (191 lines),
`portal-customer-engines.ts` (1,196 lines, the customer-facing counterpart this route mirrors),
`requireAuth.ts`'s `assertCustomerAccess` and its staff-scope helper, `legacy-ladder.ts`'s
capability map, and the relevant sections of `lib/db/src/schema/index.ts` /
`lib/db/src/schema/msp.ts` (the three tables this route touches). Verified live against local
PostgreSQL: `tenant_engine_snapshots` schema confirmed to match the Drizzle source exactly and
confirmed to hold 0 rows; `msp_diagnostic_findings` confirmed to hold 296 real rows across the
database's 2 real tenants, and this route's exact §1b query logic reproduced by hand against
customer 1's real latest run to confirm real, non-fabricated `priorityItems` output. `engine-
registry.ts`'s full `ENGINE_DEFS` array read to enumerate every real, live engine key an engine
snapshot can ever carry, which is what surfaced §3's finding. `artifacts/msp-console/src`
confirmed to have zero consumers of this route today (expected pre-Design state). One real
finding made and filed (§3) — issue number recorded in `build-journal/3619.md`. No product code,
schema, or UI was changed by this pass.
