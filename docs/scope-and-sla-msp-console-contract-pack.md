# Scope and SLA (MSP Console) — contract extraction pack

**Issue:** #2654, part of #2572 ("Feature: Scope and SLA (MSP Console)"), part of #1571 (EPIC:
Portal Admin). Method per #1642. Extracted, not authored — every field below traces to one of
the files listed, cited to file:line. Read-only: no product code, schema or UI changes made
while writing this pack, per #2654's step 3 scope.

Both route files named in the dispatch were confirmed real and live in the current codebase
before any of this was written — **12 routes** in `msp-scope-creep.ts`, **14 routes** in
`msp-sla.ts`, 26 total:

- `artifacts/api-server/src/routes/msp-scope-creep.ts` — mounted at `/api` via
  `routes/index.ts:122-123` (`import mspScopeCreepRouter from "./msp-scope-creep"`)
- `artifacts/api-server/src/routes/msp-sla.ts` — same mount point
- `artifacts/api-server/src/lib/scope-creep-engine.ts` — pure computation + DB helpers +
  mutating helpers the routes call
- `artifacts/api-server/src/lib/sla-engine.ts` — same, for SLA
- `artifacts/api-server/src/middlewares/requireAuth.ts` — `AuthUser`, `requireRole()`,
  `resolveStaffScopedCustomerIds()`
- `artifacts/api-server/src/lib/sse-channels.ts` — `registerMspEngineEventClient()`
- `artifacts/api-server/src/index.ts:935-1064` — `sla_policies` / `sla_timers` / `sla_breaches`
  / `sla_escalations` / `sla_compliance_records` / `sla_signal_policy_map` /
  `msp_sla_weights` `CREATE TABLE` statements (not Drizzle-schema tables; every read here is a
  raw `db.execute(sql...)`, same pattern §4 of `docs/scope-and-sla-contract-pack.md` already
  documented for the customer-facing surface)
- `artifacts/api-server/src/lib/scope-creep-engine.ts:736-899` — `scope_creep_policies` /
  `scope_creep_assignments` / `scope_creep_detections` / `scope_creep_scores` /
  `scope_creep_violations` / `scope_creep_escalations` / `scope_creep_compliance`
  `CREATE TABLE` statements
- `artifacts/api-server/src/routes/msp-sla-scope-creep.test.ts` — the existing test suite for
  both route files; every test mocks `db.execute` directly (`mockExecute`), so **none of these
  tests ever run against a real Postgres connection or catch a schema mismatch** — noted because
  it is load-bearing for Finding §5 below
- Local `psql` against the real `DATABASE_URL` (partial — see the honesty note at the end of
  this section) and `lib/db/migrations/manual/2026-07-28-tenant-user-refactor-phase0-schema-wipe.sql`
  — used to confirm real table existence/absence and live row counts

**Distinct from, and not a re-run of, `docs/scope-and-sla-contract-pack.md`** — that pack (from
#2452) covers the two **customer-facing read routes** in `portal-customer-engines.ts`
(`GET /api/portal/customer/sla-status`, `GET /api/portal/customer/scope-status`). This pack
covers the **MSP-side authoring + operator surface** (policy CRUD, raw detection/timer/breach/
violation feeds, manual evaluate/resolve/escalate actions, the SSE event stream) — the very
routes that customer pack's §7 flagged as "not located or analyzed." The two surfaces share the
same two underlying engines (`scope-creep-engine.ts`, `sla-engine.ts`) but read/write them
through entirely separate route files with different scoping (`mspId`-fenced here vs.
`customerId`-fenced there).

**Honest DB-verification note**: local Postgres was reachable and returned real results for the
row-count queries in §0 below, but went unresponsive (5 consecutive `psql` attempts each timed
out at 15-30s, evidence of a real, repeatable failure, not one blind try) partway through this
session — almost certainly load from other concurrent build sessions against the same shared
local instance, per this repo's own concurrent-session conventions. One live-DB check
(`msp_customers` table existence) that would have been the ideal direct confirmation for
Finding §5 could not be completed live; §5 is instead grounded in the migration file and an
exhaustive repo-wide grep, both cited, which are unambiguous on their own.

---

## 0. Live data snapshot (queried before the DB became unresponsive)

Real MSP rows, local `DATABASE_URL`: **2** rows in `msps` — `id=1` "Shane McCaw Consulting",
`id=1626` "Regression Testbed MSP (billing lifecycle)". All 3 engine-backing tables queried are
**empty**: `sla_timers` — 0 rows (any status), `scope_creep_detections` — 0 rows,
`scope_creep_violations` — 0 rows. No MSP-side policy has ever fired a violation, timer, or
breach in the local environment. Every route below is real, live, and reachable, but every
list/detail response an operator would see today is the honest-empty shape.

---

## 1. `msp-scope-creep.ts` — 12 routes, all `requireRole("MSPOperator")` (`MSPOperator` or above:
`MSPAdmin`, `PlatformAdmin` also pass — `requireAuth.ts:205-223` `roleIndex()` ordering)

All 12 read `req.user!.mspId` first and 400 `{ error: "mspId required" }` if absent (every route,
first two lines). None of the 12 apply `resolveStaffScopedCustomerIds()` to the **policies**
sub-resource (policies are MSP-wide, not customer-scoped); the 3 customer-data-bearing GETs
(`detections`, `violations`) do; `escalations`/`compliance` do not (see the per-route table).

| # | Method + path | Auth extras | Purpose | Real gap vs. sibling |
|---|---|---|---|---|
| 1 | `GET /msp/scope-creep/policies` | — | List active policies: own MSP's + global (`msp_id IS NULL`) (`:33-55`) | — |
| 2 | `GET /msp/scope-creep/policies/:id` | — | Single policy by id, same MSP-or-global fence (`:59-88`) | — |
| 3 | `POST /msp/scope-creep/policies` | — | Create a new MSP-owned policy, defaults per field (`:92-125`) | — |
| 4 | `PATCH /msp/scope-creep/policies/:id` | — | **Copy-on-write**: editing a global (`msp_id IS NULL`) policy INSERTs a new MSP-owned override row instead of mutating the shared default; editing an already-MSP-owned policy UPDATEs in place (`:129-206`) | see Finding §5.3 |
| 5 | `DELETE /msp/scope-creep/policies/:id` | — | Same copy-on-write split, but "delete" = deactivate (`is_active = false`); editing a global row creates an inactive MSP-owned override rather than touching the shared default (`:210-260`) | — |
| 6 | `GET /msp/scope-creep/detections` | `resolveStaffScopedCustomerIds` fence + optional `?customerId`/`?status` (default `"open"`) | Open (or filtered-status) detections for this MSP, capped 200 (`:265-304`) | — |
| 7 | `GET /msp/scope-creep/violations` | `resolveStaffScopedCustomerIds` fence + optional `?customerId` | Violations for this MSP's portfolio, capped 100 (200 unfiltered) (`:309-345`) | — |
| 8 | `GET /msp/scope-creep/escalations` | none applied | Pending/in-progress escalations, level-desc then recency (`:350-371`) | see Finding §5.4 — no staff scoping |
| 9 | `GET /msp/scope-creep/compliance` | none applied | Monthly compliance history, optional `?customerId` (`:376-405`) | see Finding §5.4 |
| 10 | `POST /msp/scope-creep/evaluate` | — | Runs `runScopeCreepEngineForMsp(mspId)` — **MSP-portfolio-wide** aggregate, not per-customer; optional `autoFireViolations: true` body flag fires violations/escalations for every active policy | see Finding §5.1 — customerId fallback and portfolio-vs-customer score mismatch |
| 11 | `POST /msp/scope-creep/violations/:violationId/resolve` | ownership check (`msp_id = mspId`) before resolving | Resolves a violation + cascades its escalations to `'resolved'` (`resolveScopeCreepViolation`, `scope-creep-engine.ts:638-660`) | — |
| 12 | `POST /msp/scope-creep/escalations` | ownership check on the target violation | Manually create an escalation for an existing violation (`:506-537`) | — |

---

## 2. `msp-sla.ts` — 14 routes, all `requireRole("MSPOperator")`

Same 400-on-missing-`mspId` guard on every route. A shared helper,
`scopeSlaRows<T>(rows, scopedIds)` (`:30-33`), applies `resolveStaffScopedCustomerIds()` as an
**in-memory post-filter** (not a SQL predicate) to every route that returns customer-bearing
rows — consistent across `timers`, `breaches`, `escalations`, `compliance`, `operator-tasks`;
result sets are already capped (≤200) so the memory cost is bounded, per the function's own doc
comment (`:23-29`).

| # | Method + path | Staff-scoped? | Purpose |
|---|---|---|---|
| 1 | `GET /msp/sla/policies` | n/a (policy-level) | Active own + global policies (`:38-60`) |
| 2 | `GET /msp/sla/policies/:id` | n/a | Single policy (`:64-90`) |
| 3 | `POST /msp/sla/policies` | n/a | Create MSP-owned policy (`:94-123`) |
| 4 | `PATCH /msp/sla/policies/:id` | n/a | Same copy-on-write-on-global-edit pattern as scope-creep §1.4 (`:127-192`) |
| 5 | `DELETE /msp/sla/policies/:id` | n/a | Same copy-on-write-on-global-edit "deactivate" pattern (`:196-239`) |
| 6 | `GET /msp/sla/timers` | ✅ `scopeSlaRows` | Timers, optional `?customerId`/`?status`, capped 200 (`:244-297`) |
| 7 | `GET /msp/sla/breaches` | ✅ | Breaches, optional `?customerId`/`?resolved`, capped 100-200 (`:302-345`) |
| 8 | `GET /msp/sla/escalations` | ✅ | Pending/in-progress escalations (`:350-370`) |
| 9 | `GET /msp/sla/compliance` | ✅ | Monthly compliance history, optional `?customerId` (`:375-405`) |
| 10 | `POST /msp/sla/evaluate` | n/a — returns the raw aggregate | `runSlaEngineForMsp(mspId)` (`:410-420`) — portfolio-wide, no auto-fire equivalent (SLA has no violation-fire action; breaches are detected by a separate background evaluation path, not by this route) |
| 11 | `POST /msp/sla/timers/:timerId/resolve` | ownership check | Resolve a timer belonging to this MSP (`:425-448`) |
| 12 | `GET /msp/sla/summary` | n/a — MSP-wide counts, no per-customer breakdown | Dashboard header stats: `activeTimers`/`warningTimers`/`breachedTimers`/`openBreaches`/`avgCompliancePct` (`:453-494`) | see Finding §5.2 — `status = 'active'` filter |
| 13 | `GET /msp/operator-tasks` | ✅ | Virtual task queue merging unresolved SLA breaches + scope-creep violations, deep-linked to Admin Panel (`:500-554`) | see Finding §5.5 — dropped table join |
| 14 | `GET /msp/sla/events/stream` | n/a | SSE — heartbeat every 30s, subscribes via `registerMspEngineEventClient(mspId, ...)` (`:561-583`) | — |

`/msp/operator-tasks` is mounted from `msp-sla.ts` (not `msp-scope-creep.ts`) despite aggregating
both engines' data — the file's own header comment says so explicitly (`:496-499`).

---

## 3. Both engines' MSP-portfolio compute path — real formulas, cited

### Scope Creep (`computeScopeCreepEngine`, `scope-creep-engine.ts:195-249`)

For every **open** detection whose `policyId` resolves to a known policy: `threshold` = the
policy's per-type threshold (`driftThresholdPct` / `expansionThresholdPct` /
`timelineSlipDays`), `weight` = the matching per-type weight; `exceeded = changePct >=
threshold`; `contribution = exceeded ? min(100, round(changePct / threshold * weight)) : 0`
(`evaluateDetection`, `:164-193`). Per-type totals sum contributions across all open detections
of that type. `compositeScore = min(100, round((driftTotal + expansionTotal +
timelineSlipTotal) / 3))` (`:219`) — **not** weighted by the policy's own
`driftWeight`/`expansionWeight`/`timelineSlipWeight` a second time at this level; those weights
are already folded into each detection's own `contribution`, so the `/3` divisor here is a flat
average of the three running totals, not itself policy-configurable.
`compliancePct = (openDetections + openViolations) === 0 ? 100 : max(0, round(100 -
compositeScore))` (`:220-223`).

`runScopeCreepEngineForMsp(mspId, ctx?)` (`:349-359`) fetches **every** open detection for the
MSP across **all** its customers (`fetchOpenDetections(mspId)`, no customerId filter), **every**
active policy for the MSP (own + global), and counts open violations MSP-wide
(`countOpenViolations(undefined, mspId)`). The resulting `compositeScore` is therefore a
**portfolio aggregate across every customer the MSP serves**, not any one customer's score —
load-bearing for Finding §5.1.

### SLA (`computeSlaEngine`, `sla-engine.ts:166-221`)

Only **running** timers (`status === "running"`) are evaluated (`:173`) — see Finding §5.2 for
why this status value may never be reached in practice. Each running timer's evaluation
(`evaluateTimer`, `:121-162`) computes `elapsedMinutes` from `now - startedAt`, picks
`thresholdMinutes`/`warningThresholdPct` by `phase` (`"response"` vs `"resolution"`), and derives
`status: "ok" | "warning" | "breached"`. Evaluations split into two groups by
`ticketType === "signal_compliance"` vs. everything else (`:182-183`); each group's compliance
is `round((group.length - breachedInGroup) / group.length * 100)`, defaulting to 100 for an
empty group (`computeGroupCompliance`, `:185-189`). The overall `score` blends the two group
scores by the MSP's own `w_signal`/`w_timer` weights from `msp_sla_weights`
(default 50/50 if the MSP has no row — `:298`), falling back to a straight average only if
`totalWeight === 0` (`:194-197`) — an edge case that cannot occur with the table's own
NUMERIC-with-DEFAULT-50 columns unless both are explicitly zeroed.

---

## 4. Real DB tables and enums

Neither engine's tables are Drizzle-schema-defined; every column/constraint source below is each
file's own `CREATE TABLE IF NOT EXISTS`.

**SLA** (`index.ts:935-1064`):
- `sla_policies` — `msp_id` nullable INTEGER FK to `msps(id) ON DELETE CASCADE` (NULL = global
  default), `priority` is plain `INTEGER DEFAULT 0` — **not** the `"low" | "standard" | "high" |
  "critical"` string union `SlaPolicy.priority` claims in TS (`sla-engine.ts:34`); the route's
  own POST default is the **string** `"standard"` (`msp-sla.ts:112`), so the column is
  effectively TEXT-shaped-as-INTEGER-by-migration-drift — no CHECK constraint enforces either
  reading. Not exercised live (0 policies exist locally to confirm the actual stored type at
  runtime), flagged as a real, confirmed schema/type mismatch regardless.
- `sla_timers` — `status TEXT NOT NULL DEFAULT 'active'`, no CHECK constraint. See Finding §5.2.
- `sla_breaches` — `breach_type TEXT NOT NULL DEFAULT 'breach'`, no CHECK — the TS union is
  `"threshold_exceeded" | "warning_only"` (`sla-engine.ts:78`), neither of which is the column's
  own default string.
- `sla_escalations` / `sla_compliance_records` / `sla_signal_policy_map` / `msp_sla_weights` — no
  further mismatches found; `msp_sla_weights.msp_id` is `UNIQUE`, confirming one weights row per
  MSP is the intended shape `runSlaEngineForMsp`'s `LIMIT 1` read relies on.

**Scope Creep** (`scope-creep-engine.ts:736-899`):
- `scope_creep_policies` — `msp_id` nullable INTEGER, **no FK** to `msps(id)` (contrast with
  `sla_policies.msp_id`, which does have one); `fulfillment_type` has a real CHECK
  (`'assessment','monitoring','project','retainer'`), added via a self-healing
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for pre-existing installs (`:761-763`) — the
  authoritative CHECK constraint itself lives in a separate manual migration, not this file.
- `scope_creep_assignments` — `client_service_id` FK to `client_services(id)`, a genuine
  engagement-type link the SLA side has no equivalent of; unique on
  `(msp_id, customer_id, client_service_id)`.
- `scope_creep_detections` — real CHECKs: `detection_type IN ('drift','expansion',
  'timeline_slip')`, `status IN ('open','acknowledged','resolved')`. `customer_id`/`msp_id` are
  `NOT NULL` but **no FK** to `tenants`/`msps`.
- `scope_creep_violations` — real CHECK `severity IN ('low','medium','high','critical')`,
  matching `deriveSeverity()`'s own bands exactly (`:475-480`: `>=85` critical, `>=65` high,
  `>=40` medium, else low).
- `scope_creep_escalations` — real CHECKs on `escalation_type` and `status`, matching the TS
  unions exactly.
- `scope_creep_compliance` — no CHECKs beyond NOT NULLs; `compliance_pct` computed by
  `computeScopeCreepCompliance()` (`:681-732`) using a **different formula** than the live-engine
  `compliancePct` in §3 — `max(0, 100 - (violationCount * 20 + avgCompositeScore/2))` — this is a
  monthly-snapshot formula, never called from either of this pack's 26 routes (only from an
  unlisted snapshot job), noted for completeness since it shares a table this pack does read from
  (`GET /msp/scope-creep/compliance`).

---

## 5. Findings

### 5.1 `POST /msp/scope-creep/evaluate` — MSP-portfolio score fires a violation attributed to one customer, and defaults that customer to the MSP's own id

`msp-scope-creep.ts:412-472`. When `autoFireViolations: true` is passed, the route loops every
active policy for the MSP and calls `fireScopeCreepViolation()` once per policy, using
`output.score.compositeScore` — the **MSP-wide aggregate across every customer's open
detections** (§3) — as the score being compared against that policy's own
`violationScoreThreshold`, and inserts the resulting violation row with:

```
customerId: b.customerId != null ? Number(b.customerId) : mspId
```

(`:444`, `:459` — both call sites). Two real, compounding problems:

1. **No customerId in the request body inserts `customer_id = mspId`.** `scope_creep_violations
   .customer_id` is `NOT NULL` with no FK (§4), so this silently succeeds and creates a
   violation row whose `customer_id` is actually an `msps.id` value — the same id-space
   confusion class `docs/scope-and-sla-contract-pack.md` §5 already documented for
   `runSlaEngineForTenant()`, but here it is the **route itself** doing the mixing, not a
   downstream engine function.
2. **Even with a real `customerId` supplied**, the `compositeScore` being compared against
   threshold is the whole MSP's portfolio score, not that customer's own. A single customer with
   zero open detections of their own can have a violation fired against them because a
   *different* customer of the same MSP is driving the aggregate score up — every policy that
   MSP has active fires (or skips) identically for every customerId an operator passes, since
   the loop body never re-scopes `output` per customer.

Not observed live (0 `scope_creep_detections`/`violations` rows exist locally, §0), so no
customer has been affected yet, but the code path is real, reachable by any `MSPOperator`, and
would misattribute or fabricate violations the moment real detections exist. Filed as **#2726**,
sibling of this issue's own Feature #2572, labeled `bug`.

### 5.2 `sla_timers.status` default (`'active'`) is never read by the engine, and never written by the route's own timer-creation path

`index.ts:960` — `status TEXT NOT NULL DEFAULT 'active'`. `startSlaTimer()`
(`sla-engine.ts:317-339`) INSERTs a new timer row without listing `status` in its column list at
all, so every timer created through it starts, and permanently stays, at `'active'` — a value:

- **never selected by `fetchRunningTimers()`**, which is hardcoded to `WHERE status = 'running'`
  (`:256`, `:264`, `:271`) — the SLA engine (`runSlaEngineForMsp`, `POST /msp/sla/evaluate`) will
  never see this timer, so it can never warn or breach through the normal evaluation path;
- **never reachable by `resolveSlaTimer()`**, whose UPDATE requires
  `status IN ('running','paused','breached')` (`sla-engine.ts:444`) — a timer stuck at `'active'`
  can never be resolved via `POST /msp/sla/timers/:timerId/resolve` either (the route's own
  ownership-check SELECT would find the row, but `resolveSlaTimer`'s UPDATE would affect 0 rows,
  silently returning `resolved: false` with no error);
- **is, however, what `GET /msp/sla/summary`'s `activeTimers` count actually reads**
  (`msp-sla.ts:460`: `COUNT(*) FILTER (WHERE status = 'active')`) — the one place in this whole
  pack's 26 routes that the DEFAULT value is ever queried for, and it is querying a state the
  rest of the engine treats as inert.

Two real callers of `startSlaTimer()` exist (`lib/tenant-signals.ts:1629`,
`routes/admin-sla.ts:266`), so this is not a theoretical dead path — every timer either of those
creates lands in this stuck state. 0 live `sla_timers` rows exist locally (§0) to show the effect
today, but the bug is real and structural, mirroring exactly the "internal consistency note"
`docs/scope-and-sla-contract-pack.md` §4 already flagged for this same table from the customer
side — this pack elevates it from a note to a filed finding because this side's summary route
(`activeTimers`) actively surfaces the mismatched value to an MSP operator, and two real,
non-test call sites exist. Filed as **#2728**, sibling of #2572, labeled `bug`.

### 5.3 Copy-on-write policy override — `mspId === 0` branch is dead code

`msp-scope-creep.ts:154` and `msp-sla.ts:148` both branch on
`original.mspId === null || original.mspId === 0` to decide "is this a global default policy."
`scope_creep_policies.msp_id` and `sla_policies.msp_id` are both nullable INTEGER columns with no
default value written by either the `CREATE TABLE` or any INSERT in either route file (`POST`
always supplies the caller's real `mspId`, never `0`) — so `msp_id = 0` can only occur if
something outside this pack's two files inserts it directly. Not filed as a bug (harmless
defensive code, and no live writer was found that would trigger it), but noted here since a
`mspId === 0` MSP operator (`msps.id` starting at 1, confirmed at §0) would otherwise be
indistinguishable from "global" under this check — worth Design/future-authoring awareness only.

### 5.4 `GET /msp/scope-creep/escalations` and `GET /msp/scope-creep/compliance` apply no staff scoping

Both routes (`msp-scope-creep.ts:350-371`, `:376-405`) return MSP-wide rows with no
`resolveStaffScopedCustomerIds()` filter — unlike every other customer-bearing GET in both files,
which apply it either as a SQL predicate guard (§1's `detections`/`violations`, which 400/empty
on an out-of-scope `?customerId`) or as `scopeSlaRows` post-filtering (all of §2's
customer-bearing GETs). A scoped `MSPOperator` (one with rows in
`msp_staff_customer_scopes`, per `requireAuth.ts:349-361`) would see every customer's
escalations and compliance history, not just their assigned subset — a real, if narrower,
staff-scoping gap. Not filed separately; folded into #2728's write-up since it is the same class
of "scoping applied inconsistently across sibling routes in this pack" and #2728 is already the
natural home for msp-sla.ts's own summary-route inconsistency (which, note, also applies no
staff-scoping — `msp-sla.ts:453-494` — an MSP-wide aggregate is arguably correct there by
design, unlike the two per-row GETs named here).

### 5.5 `GET /msp/operator-tasks` joins a table that was dropped

`msp-sla.ts:517` and `:533` — `LEFT JOIN msp_customers c ON c.id = b.customer_id` /
`... ON c.id = v.customer_id`. `msp_customers` was dropped by the Tenant/User Refactor:
`lib/db/migrations/manual/2026-07-28-tenant-user-refactor-phase0-schema-wipe.sql:544` —
`DROP TABLE IF EXISTS msp_customers CASCADE;`. A repo-wide grep of every `.ts` file under
`artifacts/api-server/src` for `msp_customers` (54 matches, enumerated in full while building
this pack) found these are the **only two live SQL references** to the table anywhere in the
codebase — every other one of the 54 hits is a comment describing the *old*, now-replaced id
space (`msp_customers.id` → `tenants.id`), consistent with every other route in the codebase
having already been migrated off this table. `msp-sla-scope-creep.test.ts`'s own
`operator-tasks` tests (`:250-359`) mock `db.execute` directly and never touch a real
connection, so this route has never been exercised against actual schema by its own test suite
(§ intro). Live confirmation via `psql` was attempted but the local DB became unresponsive
mid-session (see the honesty note at the top of this pack) — the migration-file + grep evidence
is unambiguous on its own: every real call to `GET /msp/operator-tasks` today would throw
`relation "msp_customers" does not exist` and return a 500 (caught by the route's own try/catch,
`msp-sla.ts:550-553`, so it degrades to `{ error: "Failed to load operator tasks" }` rather than
crashing the process — but the route's actual feature, task aggregation, is completely dead).
Filed as **#2729**, sibling of #2572, labeled `bug`, prefixed `URGENT:` — this is a currently-500
route with a live, non-test call path once any UI exists for it, and the fix (join `tenants`
instead, matching every other migrated route) is small and unambiguous.

---

## 6. Honest-empty / partial-data contract

- Every list-shaped route (`policies`, `detections`, `violations`, `escalations`, `compliance`,
  `timers`, `breaches`) returns `{ <plural>: [] }` for a portfolio with no matching rows — real
  empty arrays, not a wrapped "no data" sentinel, matching §0's actual live state today for
  every MSP in the local DB.
- `GET /msp/sla/summary` returns real zeros / `avgCompliancePct: null` (not `0`) when
  `sla_compliance_records` has no rows in the trailing-90-day window (`msp-sla.ts:486-488`) —
  the one route in this pack that distinguishes "never computed" (`null`) from "computed as
  zero."
- `POST /msp/scope-creep/evaluate` / `POST /msp/sla/evaluate` return a real, honest zero-signal
  engine output (`compositeScore: 0`, empty `breakdown`/`rawSignals`) for an MSP with no open
  detections/timers — not a fixture, the same `computeScopeCreepEngine([], policies, 0)` /
  `computeSlaEngine([], policies, ...)` pure-function path any populated portfolio runs through.
- `GET /msp/operator-tasks` cannot currently reach its honest-empty state or its populated state
  — every call 500s per Finding §5.5.

---

## 7. Cross-surface edges

- **Customer-facing counterpart**: `docs/scope-and-sla-contract-pack.md` (#2452) — the read-only
  friendly-translated views a `CustomerUser` sees (`sla-status`/`scope-status`). That pack's own
  §5 finding (`runSlaEngineForTenant()`'s id-space bug, filed as #2513) is about the
  **tenant-scoped** engine entry point; this pack's §5.1 is a **separate**, MSP-scoped bug in a
  different function (`runScopeCreepEngineForMsp` + the route's own auto-fire loop) — the two are
  not the same finding and do not share a fix.
- **Admin-side counterpart**: both route files' own header comments explicitly contrast
  themselves with `/api/admin/scope-creep/*` and `/api/admin/sla/*`, which require
  `PlatformAdmin` rather than `MSPOperator` (`msp-scope-creep.ts:10`, `msp-sla.ts:9`). Those
  admin routes (`routes/admin-sla.ts`, referenced at §5.2 as one of `startSlaTimer()`'s two real
  callers) were read only as far as needed to confirm that one call site — a full admin-side
  audit is out of scope for this pack.
- **`/msp/operator-tasks`' `deepLink`** fields (`/admin-panel/#/sla`, `/admin-panel/#/scope-creep`)
  point into the Admin Panel, not the (nonexistent) MSP Console — the only concrete UI-routing
  signal found in either file, worth Design's awareness for whichever surface Feature #2572
  ultimately builds.
- **SSE**: `GET /msp/sla/events/stream` subscribes to channel `"engine.alert"` scoped by `mspId`
  (`sse-channels.ts:150-152`). No emitter for this exact channel/scope pair was located within
  either route file or engine lib read for this pack — `broadcastMspEngineEvent(mspId, event)`
  exists (`sse-channels.ts:154-156`) but its real callers were not traced as part of this pack's
  scope; noted for Design as an open question, not asserted as broken.

---

## Orphaned-endpoint check

```
grep -rln "scope-creep\|msp/sla\|admin/scope-creep\|admin/sla" artifacts/admin-panel/src
grep -rn "operator-tasks\|/msp/sla\|scope-creep" artifacts/msp-portal/src artifacts/portal 2>/dev/null
```

Real result: **zero matches** in `artifacts/admin-panel/src`, and `artifacts/msp-portal` does
not exist in the current tree at all (`ls artifacts/` — `admin-panel`, `api-server`,
`mcp-server`, `msp-website`, `portal`, `shane-mccaw-consulting`; no `msp-console`, no
`msp-portal`). This matches Feature #2572's own body verbatim: *"`artifacts/msp-console` doesn't
exist yet ... scaffolding is itself the first real piece of work needed here."* All 26 routes in
this pack are real, live, and callable via `curl`/Postman today, but **zero UI anywhere in this
repo calls any of them** — Design should build against these 26 real, unexercised endpoints;
their absence of a caller is the honest current state, not evidence something is broken (except
where Finding §5.5 makes that literal for one specific route).

---

## Not covered by this pack

The admin-side `/api/admin/scope-creep/*` and `/api/admin/sla/*` route files
(`PlatformAdmin`-gated) were not read beyond the one `startSlaTimer()` call site cited in §5.2.
`scope_creep_scores` and `scope_creep_compliance`'s snapshot-writer job
(`computeScopeCreepCompliance` / `computeAndPersistScore`, §4) were read for their formulas but
their real trigger/scheduler was not located — out of scope for a pack limited to the 26 routes
named in #2654's dispatch. `sla_signal_policy_map`'s real reader/writer was not located either.
