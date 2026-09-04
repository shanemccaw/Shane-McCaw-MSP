# Scope and SLA (MSP Console) — contract extraction pack

**Issue:** #2898, part of #2572 ("Feature: Scope and SLA (MSP Console)"), part of #1571 (EPIC:
Portal Admin). Method per #1642. Full line-by-line regeneration against the current, live
backend — not an incremental patch of the prior version. **Supersedes the version extracted for
#2654** (dated before #2726/#2728/#2729/#2811/#2812 landed, all of which are real fixes to the
routes/engines this pack covers). Extracted, not authored — every field below traces to one of
the files listed, cited to file:line. Read-only: no product code, schema or UI changes made
while writing this pack.

Both route files named in the dispatch were confirmed real and live in the current codebase
before any of this was written — **12 routes** in `msp-scope-creep.ts`, **14 routes** in
`msp-sla.ts`, 26 total (unchanged route count from the #2654 extraction; only route *bodies*
changed):

- `artifacts/api-server/src/routes/msp-scope-creep.ts` — mounted at `/api` via
  `routes/index.ts:124,459` (`import mspScopeCreepRouter from "./msp-scope-creep"` /
  `router.use(mspScopeCreepRouter)`)
- `artifacts/api-server/src/routes/msp-sla.ts` — `routes/index.ts:125,460`
- `artifacts/api-server/src/lib/scope-creep-engine.ts` — pure computation + DB helpers +
  mutating helpers the routes call
- `artifacts/api-server/src/lib/sla-engine.ts` — same, for SLA
- `artifacts/api-server/src/middlewares/requireAuth.ts` — `AuthUser`, `requireRole()`
  (`:206-222`, role order `:81-94`), `resolveStaffScopedCustomerIds()` (`:348`),
  `isCustomerBlockedByStaffScope()` (`:368`)
- `artifacts/api-server/src/lib/sse-channels.ts` — `registerMspEngineEventClient()` (`:150`),
  `broadcastMspEngineEvent()` (`:154`)
- `artifacts/api-server/src/index.ts:981-1109` — `sla_policies` / `sla_timers` / `sla_breaches`
  / `sla_escalations` / `sla_compliance_records` / `sla_signal_policy_map` /
  `msp_sla_weights` `CREATE TABLE` statements (not Drizzle-schema tables; every read here is a
  raw `db.execute(sql...)`, same pattern §4 of `docs/scope-and-sla-contract-pack.md` already
  documented for the customer-facing surface)
- `artifacts/api-server/src/lib/scope-creep-engine.ts:736-901` — `scope_creep_policies` /
  `scope_creep_assignments` / `scope_creep_detections` / `scope_creep_scores` /
  `scope_creep_violations` / `scope_creep_escalations` / `scope_creep_compliance`
  `CREATE TABLE` statements
- `artifacts/api-server/src/routes/msp-sla-scope-creep.test.ts` (712 lines) — the mock-only test
  suite for both route files; every test mocks `db.execute` directly, so it never runs against a
  real Postgres connection — **26/26 pass**, real-run confirmed this session
- `artifacts/api-server/src/routes/msp-sla-operator-tasks.live-db.test.ts` (102 lines) — a real
  Postgres-backed regression test added by #2729's fix, seeding a synthetic msp/tenant/breach/
  violation and hitting the live router end-to-end — **1/1 pass**, real-run confirmed this
  session (`27/27` combined)
- Local `psql` against the real `DATABASE_URL` — used to confirm live table row counts and the
  `sla_policies.priority` column's actual stored type (see the honesty note at the end of this
  section for a real, repeated interruption during this)

**Distinct from, and not a re-run of, `docs/scope-and-sla-contract-pack.md`** — that pack (from
#2452) covers the two **customer-facing read routes** in `portal-customer-engines.ts`
(`GET /api/portal/customer/sla-status`, `GET /api/portal/customer/scope-status`). This pack
covers the **MSP-side authoring + operator surface** (policy CRUD, raw detection/timer/breach/
violation feeds, manual evaluate/resolve/escalate actions, the SSE event stream) — the very
routes that customer pack's §7 flagged as "not located or analyzed." The two surfaces share the
same two underlying engines (`scope-creep-engine.ts`, `sla-engine.ts`) but read/write them
through entirely separate route files with different scoping (`mspId`-fenced here vs.
`customerId`-fenced there).

**What changed since the #2654 extraction, in one place:**

| Finding (old §) | Issue | Real fix landed |
|---|---|---|
| §5.1 — portfolio score fires a per-customer violation, `customerId` falls back to `mspId` | #2726 | `POST /msp/scope-creep/evaluate` now **requires** `customerId` (400 if missing), verifies tenant ownership (404) + staff scope (403), and scores/fires via `runScopeCreepEngineForTenant(customerId)` — never the MSP-portfolio aggregate |
| §5.2 — `sla_timers.status` default `'active'` never matched by any reader | #2728 | Column default changed to `'running'`; `startSlaTimer()` now lists `status='running'` explicitly; `GET /msp/sla/summary`'s `activeTimers` reads `status = 'running'` |
| §5.4 — `escalations`/`compliance` GETs skip staff scoping | #2728 (folded in) | Both scope-creep GETs now apply `resolveStaffScopedCustomerIds()` post-filtering, matching every sibling GET |
| §5.5 — `operator-tasks` joins dropped `msp_customers` table, 500s every call | #2729 | Both joins repointed at `tenants`, `c.customer_name` in place of the old `c.name`; a real live-Postgres regression test now exists for this exact route |
| (new, found while fixing #2728) `warningTimers` in `/msp/sla/summary` structurally always 0 | #2811 | `fireSlaWarning()` added — sets `status='warning'` + `warning_fired_at` once, mirroring `fireSlaBreachRecord`'s `'breached'` transition; every `status = 'running'` reader updated to also accept `'warning'` so a warned timer doesn't drop out of active polling |
| (new, found while fixing #2726) `msp-sla-scope-creep.test.ts` mocks silently failed 19/23 tests | #2814 | Fixed as part of #2726's own commit (missing `logger.child` + `drizzle-orm` `eq`/table-export mocks) |
| (new, found while fixing #2729) `POST /msp/customers/bulk` `"tag"` action joins dropped `msp_customers`, no `tenants.tags` column either | #2812 | Real product decision: dead legacy feature, removed entirely rather than resurrected — out of scope for `msp-sla.ts`/`msp-scope-creep.ts` (lives in `msp-portal.ts`), noted here only as a resolved cross-reference |

All six are closed. **Zero open findings carry over from the prior extraction.** New findings
from this regeneration pass, if any, are in §5 below.

**Honest DB-verification note**: local Postgres returned real results for every row-count query
in §0 below and the `sla_policies.priority` column-type check, but went unresponsive mid-session
(one `timeout 20 psql ... SELECT 1` genuinely hung the full 20s with no output — a real,
repeatable failure, not one blind try) before a planned `\d tenants` check could complete; it
recovered on its own later in the same session (a `vitest run` against the live DB, `27/27`,
succeeded afterward) — almost certainly load from other concurrent build sessions against the
same shared local instance, per this repo's own concurrent-session conventions. The one query
lost to this (`tenants.customer_name`'s exact column existence) is instead confirmed via a grep
of an already-shipped, unrelated route (`admin-customer-alert-rules.ts:179`) that reads the same
column — unambiguous on its own.

---

## 0. Live data snapshot (queried this session)

Real MSP rows, local `DATABASE_URL`: **2** rows in `msps` — `id=1` "Shane McCaw Consulting",
`id=1626` "Regression Testbed MSP (billing lifecycle)" — unchanged from the #2654 extraction.
All 3 engine-backing tables queried are still **empty**: `sla_timers` — 0 rows (any status),
`scope_creep_detections` — 0 rows, `scope_creep_violations` — 0 rows. No MSP-side policy has
ever fired a violation, timer, or breach in the local environment. Every route below is real,
live, and reachable, but every list/detail response an operator would see today is the
honest-empty shape.

---

## 1. `msp-scope-creep.ts` — 12 routes, all `requireRole("MSPOperator")` (`MSPOperator` or above:
`MSPAdmin`, `PlatformAdmin` also pass — `requireAuth.ts:81-94` role order, `:206-222`
`requireRole()`)

All 12 read `req.user!.mspId` first and 400 `{ error: "mspId required" }` if absent (every route,
first two lines). Staff scoping (`resolveStaffScopedCustomerIds()`) now applies to **all four**
customer-data-bearing GETs — `detections`, `violations`, `escalations`, `compliance` — as of
#2728; policies are still MSP-wide, not customer-scoped, so no scoping applies there.

| # | Method + path | Auth extras | Purpose | Notes |
|---|---|---|---|---|
| 1 | `GET /msp/scope-creep/policies` | — | List active policies: own MSP's + global (`msp_id IS NULL`) (`:33-55`) | — |
| 2 | `GET /msp/scope-creep/policies/:id` | — | Single policy by id, same MSP-or-global fence (`:59-88`) | — |
| 3 | `POST /msp/scope-creep/policies` | — | Create a new MSP-owned policy, defaults per field (`:92-125`) | — |
| 4 | `PATCH /msp/scope-creep/policies/:id` | — | **Copy-on-write**: editing a global (`msp_id IS NULL`) policy INSERTs a new MSP-owned override row instead of mutating the shared default; editing an already-MSP-owned policy UPDATEs in place (`:129-206`) | see §5's dead-code note (was §5.3) |
| 5 | `DELETE /msp/scope-creep/policies/:id` | — | Same copy-on-write split, but "delete" = deactivate (`is_active = false`); editing a global row creates an inactive MSP-owned override rather than touching the shared default (`:210-260`) | — |
| 6 | `GET /msp/scope-creep/detections` | `resolveStaffScopedCustomerIds` fence + optional `?customerId`/`?status` (default `"open"`) | Open (or filtered-status) detections for this MSP, capped 200 (`:265-304`) | — |
| 7 | `GET /msp/scope-creep/violations` | `resolveStaffScopedCustomerIds` fence + optional `?customerId` | Violations for this MSP's portfolio, capped 100 (200 unfiltered) (`:309-345`) | — |
| 8 | `GET /msp/scope-creep/escalations` | ✅ `resolveStaffScopedCustomerIds` (fixed by #2728) | Pending/in-progress escalations, level-desc then recency (`:350-375`) | — |
| 9 | `GET /msp/scope-creep/compliance` | ✅ `resolveStaffScopedCustomerIds` (fixed by #2728) | Monthly compliance history, optional `?customerId` (`:380-416`) | — |
| 10 | `POST /msp/scope-creep/evaluate` | ownership check (`tenants.id = customerId AND msp_id = mspId`) + `isCustomerBlockedByStaffScope` | `customerId` is now **required** in the body (400 if absent); runs `runScopeCreepEngineForTenant(customerId)` for that ONE customer, never the MSP-portfolio aggregate; optional `autoFireViolations: true` fires a violation + escalations for that customer alone if their own score breaches a policy's threshold (`:418-515`) | Fixed by #2726 — see the "what changed" table above |
| 11 | `POST /msp/scope-creep/violations/:violationId/resolve` | ownership check (`msp_id = mspId`) before resolving | Resolves a violation + cascades its escalations to `'resolved'` (`resolveScopeCreepViolation`, `scope-creep-engine.ts:638-660`) | — |
| 12 | `POST /msp/scope-creep/escalations` | ownership check on the target violation | Manually create an escalation for an existing violation (`:549-580`) | — |

---

## 2. `msp-sla.ts` — 14 routes, all `requireRole("MSPOperator")`

Same 400-on-missing-`mspId` guard on every route. A shared helper,
`scopeSlaRows<T>(rows, scopedIds)` (`:30-33`), applies `resolveStaffScopedCustomerIds()` as an
**in-memory post-filter** (not a SQL predicate) to every route that returns customer-bearing
rows — `timers`, `breaches`, `escalations`, `compliance`, `operator-tasks`; result sets are
already capped (≤200) so the memory cost is bounded, per the function's own doc comment
(`:23-29`).

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
| 10 | `POST /msp/sla/evaluate` | n/a — returns the raw aggregate | `runSlaEngineForMsp(mspId)` (`:410-420`) — still portfolio-wide; see §5's asymmetry note (a per-tenant `runSlaEngineForTenant()` exists and is now used by three other real callers, but this route was not changed to use it) |
| 11 | `POST /msp/sla/timers/:timerId/resolve` | ownership check | Resolve a timer belonging to this MSP; now accepts `'running'`, `'paused'`, `'warning'`, or `'breached'` as valid source states (`:425-448`, `resolveSlaTimer`, `sla-engine.ts:459-487`) |
| 12 | `GET /msp/sla/summary` | n/a — MSP-wide counts, no per-customer breakdown | Dashboard header stats: `activeTimers`/`warningTimers`/`breachedTimers`/`openBreaches`/`avgCompliancePct` — all three timer buckets are now genuinely mutually exclusive real counts (`status = 'running'` / `'warning'` / `'breached'`) after #2728 + #2811 (`:453-494`) |
| 13 | `GET /msp/operator-tasks` | ✅ | Virtual task queue merging unresolved SLA breaches + scope-creep violations, deep-linked to Admin Panel — now joins `tenants` (fixed by #2729, `:500-554`) |
| 14 | `GET /msp/sla/events/stream` | n/a | SSE — heartbeat every 30s, subscribes via `registerMspEngineEventClient(mspId, ...)` (`:561-583`) | — |

`/msp/operator-tasks` is mounted from `msp-sla.ts` (not `msp-scope-creep.ts`) despite aggregating
both engines' data — the file's own header comment says so explicitly (`:496-499`).

---

## 3. Both engines' MSP-portfolio compute path — real formulas, cited

### Scope Creep (`computeScopeCreepEngine`, `scope-creep-engine.ts:195-249`)

Unchanged formula from the #2654 extraction. For every **open** detection whose `policyId`
resolves to a known policy: `threshold` = the policy's per-type threshold
(`driftThresholdPct` / `expansionThresholdPct` / `timelineSlipDays`), `weight` = the matching
per-type weight; `exceeded = changePct >= threshold`; `contribution = exceeded ? min(100,
round(changePct / threshold * weight)) : 0` (`evaluateDetection`, `:164-193`). Per-type totals
sum contributions across all open detections of that type. `compositeScore = min(100,
round((driftTotal + expansionTotal + timelineSlipTotal) / 3))` (`:219`) — **not** weighted by
the policy's own `driftWeight`/`expansionWeight`/`timelineSlipWeight` a second time at this
level; those weights are already folded into each detection's own `contribution`, so the `/3`
divisor here is a flat average of the three running totals, not itself policy-configurable.
`compliancePct = (openDetections + openViolations) === 0 ? 100 : max(0, round(100 -
compositeScore))` (`:220-223`).

`runScopeCreepEngineForTenant(customerId, ctx?)` (`:337-347`) — the function `POST
/msp/scope-creep/evaluate` now calls (§1.10, fixed by #2726) — fetches only that customer's own
open detections (`fetchOpenDetections(undefined, customerId)`), all currently-active policies
(own-MSP or global; no `mspId` filter applied at this call site since the route has already
verified ownership), and that customer's own open-violation count
(`countOpenViolations(customerId)`). `runScopeCreepEngineForMsp(mspId, ctx?)` (`:349-359`) still
exists and is unchanged — it fetches **every** open detection for the MSP across **all** its
customers, **every** active policy for the MSP (own + global), and counts open violations
MSP-wide — but as of #2726 no route in this pack calls it anymore for a per-customer action;
`POST /msp/sla/evaluate`'s SLA-side sibling (§2.10) is the only remaining MSP-portfolio-scoped
`evaluate` action left in either file.

### SLA (`computeSlaEngine`, `sla-engine.ts:166-225`)

**Running and warning** timers are both evaluated as of #2811 (`t.status === "running" ||
t.status === "warning"`, `:177`) — previously only `"running"`; a timer that has crossed the
warning threshold (and so had its own status flipped to `'warning'` by the new
`fireSlaWarning()`, see §4) must keep being evaluated so it can still progress to `'breached'`.
Each evaluated timer's evaluation (`evaluateTimer`, `:121-162`) computes `elapsedMinutes` from
`now - startedAt`, picks `thresholdMinutes`/`warningThresholdPct` by `phase` (`"response"` vs
`"resolution"`), and derives `status: "ok" | "warning" | "breached"`. Evaluations split into two
groups by `ticketType === "signal_compliance"` vs. everything else (`:186-187`); each group's
compliance is `round((group.length - breachedInGroup) / group.length * 100)`, defaulting to 100
for an empty group (`computeGroupCompliance`, `:189-193`). The overall `score` blends the two
group scores by the MSP's own `w_signal`/`w_timer` weights from `msp_sla_weights` (default 50/50
if the MSP has no row — `:302`), falling back to a straight average only if `totalWeight === 0`
(`:198-201`) — an edge case that cannot occur with the table's own NUMERIC-with-DEFAULT-50
columns unless both are explicitly zeroed.

---

## 4. Real DB tables and enums

Neither engine's tables are Drizzle-schema-defined; every column/constraint source below is each
file's own `CREATE TABLE IF NOT EXISTS`.

**SLA** (`index.ts:981-1109`):
- `sla_policies` — `msp_id` nullable INTEGER FK to `msps(id) ON DELETE CASCADE` (NULL = global
  default), `priority` is plain `INTEGER NOT NULL DEFAULT 0` (`index.ts:992`) — **still not**
  the `"low" | "standard" | "high" | "critical"` string union `SlaPolicy.priority` claims in TS
  (`sla-engine.ts:34`); the route's own POST default is the **string** `"standard"`
  (`msp-sla.ts:112`), so the column is effectively TEXT-shaped-as-INTEGER-by-migration-drift —
  no CHECK constraint enforces either reading. Unchanged since #2654's extraction; live-confirmed
  this session via `\d sla_policies` (0 policies exist locally to observe the actual stored
  runtime value, but the column definition itself is confirmed real). Not filed as a new bug —
  same real, confirmed schema/type mismatch already on record, not re-filed to avoid a duplicate.
- `sla_timers` — `status TEXT NOT NULL DEFAULT 'running'` (`index.ts:1007`, changed from
  `'active'` by #2728), plus `sla_timers_status_idx` on the column (`:1020`). See §3's SLA
  formula section and §2 row 12 — `'running'`/`'warning'`/`'breached'`/`'stopped'` are now all
  real, reachable, mutually-consistent states across every reader and writer in `sla-engine.ts`.
- `sla_breaches` — `breach_type TEXT NOT NULL DEFAULT 'breach'`, no CHECK — the TS union is
  `"threshold_exceeded" | "warning_only"` (`sla-engine.ts:78`), neither of which is the column's
  own default string. Unchanged, not filed (same reasoning as the priority mismatch above — a
  real but narrow schema/TS drift, no live row has ever exercised it).
- `sla_escalations` / `sla_compliance_records` / `sla_signal_policy_map` / `msp_sla_weights` — no
  further mismatches found; `msp_sla_weights.msp_id` is `UNIQUE`, confirming one weights row per
  MSP is the intended shape `runSlaEngineForMsp`'s `LIMIT 1` read relies on.

**Scope Creep** (`scope-creep-engine.ts:736-901`):
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

**New this session** — `sla-engine.ts`'s `fireSlaWarning()` (`:407-419`, added by #2811): sets
`status = 'warning'` + `warning_fired_at = NOW()`, guarded `WHERE status = 'running' AND
warning_fired_at IS NULL` so it fires exactly once per timer and only from `'running'` (never
pulls a `'breached'`/`'stopped'` timer back to `'warning'`). Called from
`workflow-executor.ts`'s `sla_warning` node (not one of this pack's 26 routes, but the one real,
non-test caller — replacing that node's prior raw `UPDATE` which only ever touched
`warning_fired_at` and never `status`, per #2811's own fix).

---

## 5. Findings

**No open findings.** Every finding from the #2654 extraction (§5.1 evaluate-portfolio-score,
§5.2 sla_timers status-default, §5.3 dead-code note, §5.4 missing staff scoping, §5.5 dropped
`msp_customers` join) is now fixed and verified — see the "what changed" table in this pack's
intro. Two items are carried forward as **notes**, not findings, because neither is new,
neither has a live consequence today, and re-filing either would duplicate an already-tracked
gap:

- **§1.4/§2.4 copy-on-write `mspId === 0` dead branch** (was §5.3) — both files still branch on
  `original.mspId === null || original.mspId === 0` (`msp-scope-creep.ts:154`,
  `msp-sla.ts:148`) to detect "this is a global default policy." No live writer inserts
  `msp_id = 0` in either table (`POST` always supplies the caller's real `mspId`), so the branch
  is harmless defensive code with no observed effect. Design/future-authoring awareness only.
- **`sla_policies.priority`/`sla_breaches.breach_type` schema-vs-TS-union mismatches** (§4) —
  unchanged, real, and already effectively documented at §4 rather than re-filed as new bugs;
  neither has a live row to demonstrate the mismatch in practice (0 policies, 0 breaches
  locally), and filing a third near-duplicate finding for a column-type drift class already on
  record elsewhere in this repo's history would not surface anything new for Design or a future
  build to act on.

**One real architectural asymmetry, worth Design's awareness rather than a filed bug:**
`POST /msp/scope-creep/evaluate` (§1.10) was moved to a genuinely per-customer call
(`runScopeCreepEngineForTenant`) by #2726, but `POST /msp/sla/evaluate` (§2.10) was not — it
still calls `runSlaEngineForMsp(mspId)`, the MSP-portfolio aggregate. This is not a bug: SLA has
no "fire a violation" action analogous to scope-creep's `autoFireViolations` (breaches are
detected by a separate background evaluation path, not by this route), so there is no
customer-misattribution consequence to the portfolio-wide score the way #2726 found for
scope-creep. But the two sibling `/evaluate` routes in this pack now have genuinely different
scoping models, and a future SLA-side "evaluate one customer" UI action would need
`runSlaEngineForTenant()` (which already exists and has three other real callers —
`dashboard-resolvers.ts:286`, `engine-registry.ts:270`, `admin-sla.ts:463,482`,
`portal-customer-engines.ts:184` — just never wired into this route) rather than assuming
`msp-sla.ts` already has the same shape `msp-scope-creep.ts` does.

---

## 6. Honest-empty / partial-data contract

- Every list-shaped route (`policies`, `detections`, `violations`, `escalations`, `compliance`,
  `timers`, `breaches`) returns `{ <plural>: [] }` for a portfolio with no matching rows — real
  empty arrays, not a wrapped "no data" sentinel, matching §0's actual live state today for
  every MSP in the local DB.
- `GET /msp/sla/summary` returns real zeros / `avgCompliancePct: null` (not `0`) when
  `sla_compliance_records` has no rows in the trailing-90-day window (`msp-sla.ts:486-488`) —
  the one route in this pack that distinguishes "never computed" (`null`) from "computed as
  zero." `warningTimers` is now a genuinely reachable non-zero value (per #2811), not a
  structurally-dead counter the way it was at the #2654 extraction.
- `POST /msp/scope-creep/evaluate` returns a real per-customer engine output now (fixed by
  #2726) — `compositeScore: 0`, empty `breakdown`/`rawSignals` for a customer with no open
  detections of their own, the same honest zero-signal
  `computeScopeCreepEngine([], policies, 0)` pure-function path any populated customer runs
  through. `POST /msp/sla/evaluate` is unchanged — still the MSP-portfolio
  `computeSlaEngine([], policies, ...)` path for an MSP with no running/warning timers.
- `GET /msp/operator-tasks` now reaches its honest-empty state correctly (fixed by #2729) —
  previously every call 500'd (old §5.5).

---

## 7. Cross-surface edges

- **Customer-facing counterpart**: `docs/scope-and-sla-contract-pack.md` (#2452) — the read-only
  friendly-translated views a `CustomerUser` sees (`sla-status`/`scope-status`). That pack's own
  §5 finding (`runSlaEngineForTenant()`'s id-space bug, filed as #2513) is about the
  **tenant-scoped** engine entry point on the customer-facing route
  (`portal-customer-engines.ts:184`) — separate from, and already resolved independently of, this
  pack's own former §5.1 (`runScopeCreepEngineForMsp` + the route's own auto-fire loop, fixed by
  #2726).
- **Admin-side counterpart**: both route files' own header comments explicitly contrast
  themselves with `/api/admin/scope-creep/*` and `/api/admin/sla/*`, which require
  `PlatformAdmin`/`requireAdmin` rather than `MSPOperator` (`msp-scope-creep.ts:10`,
  `msp-sla.ts:9`, `admin-sla.ts:15`, `requireAdmin` import). Those admin routes
  (`routes/admin-sla.ts`, `routes/admin-scope-creep.ts`) were read only as far as needed to
  confirm `startSlaTimer()`'s and `runSlaEngineForTenant()`'s real call sites — a full admin-side
  audit is out of scope for this pack.
- **`/msp/operator-tasks`' `deepLink`** fields (`/admin-panel/#/sla`, `/admin-panel/#/scope-creep`)
  point into the Admin Panel, not the MSP Console — the only concrete UI-routing signal found in
  either file, and now materially relevant to Design's awareness: **`artifacts/msp-console` now
  exists** (scaffolded by commit `68ae2c22b`, 2026-09-03 — after the #2654 extraction was
  written), with real `src/pages/index.tsx` and `src/lib` directories, but **zero wiring to
  either of this pack's 26 routes yet** — see the orphaned-endpoint check below.
- **SSE**: `GET /msp/sla/events/stream` subscribes to channel `"engine.alert"` scoped by `mspId`
  (`sse-channels.ts:150-152`). Still no real emitter for this exact channel/scope pair was
  located within either route file or engine lib read for this pack —
  `broadcastMspEngineEvent(mspId, event)` exists (`sse-channels.ts:154-156`) but a repo-wide grep
  for real (non-test, non-definition) call sites this session found **zero** — unchanged from the
  #2654 extraction. Noted for Design as an open question, not asserted as broken.

---

## Orphaned-endpoint check

```
grep -rln "scope-creep\|msp/sla\|admin/scope-creep\|admin/sla" artifacts/admin-panel/src
grep -rn "operator-tasks\|/msp/sla\|scope-creep" artifacts/msp-console/src artifacts/portal 2>/dev/null
```

Real result: **zero matches** in `artifacts/admin-panel/src`, and **zero matches** in
`artifacts/msp-console/src` either — the directory now exists (see §7) but its only real content
is scaffolding (`src/pages/index.tsx`, `src/pages/not-found.tsx`, `components.json`,
`package.json`, `tsconfig.json`; `node_modules` junctioned in). `ls artifacts/` today:
`admin-panel`, `api-server`, `mcp-server`, `msp-console`, `msp-website`, `portal`,
`shane-mccaw-consulting` — `msp-console` is the real successor to what the #2654 extraction
called "doesn't exist yet," but it is still pre-wiring: all 26 routes in this pack remain real,
live, and callable via `curl`/Postman today, with **zero UI anywhere in this repo calling any of
them**. Design should build against these 26 real, unexercised endpoints into the now-scaffolded
`msp-console`; their absence of a caller is the honest current state, not evidence something is
broken.

---

## Not covered by this pack

The admin-side `/api/admin/scope-creep/*` and `/api/admin/sla/*` route files
(`PlatformAdmin`/`requireAdmin`-gated) were not read beyond the call sites cited in §3/§7.
`scope_creep_scores` and `scope_creep_compliance`'s snapshot-writer job
(`computeScopeCreepCompliance` / `computeAndPersistScore`, §4) were read for their formulas but
their real trigger/scheduler was not located — out of scope for a pack limited to the 26 routes
named in #2898's dispatch. `sla_signal_policy_map`'s real reader/writer was not located either.
`workflow-executor.ts`'s `sla_warning` node (the one real caller of the new `fireSlaWarning()`,
§4) was read only as far as confirming that one call site.
