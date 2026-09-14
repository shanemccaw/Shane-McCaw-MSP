# Scope and SLA (Portal) — contract extraction pack

**Issue:** #2452, part of #1661 ("Feature: Scope and SLA (Portal)"), part of #1485 (EPIC:
Portal). Method per #1642. Extracted, not authored — every field below traces to one of the
files listed, cited to file:line. This is Phase 2 of the Portal build order (architect → build
the endpoints → regenerate the contract pack → Design → wire) — no page/UI-shape decisions are
made here.

Both endpoints named in #2452's Step 1 were confirmed real and live in the current codebase
before any of this was written:

- `GET /api/portal/customer/sla-status` — `portal-customer-engines.ts:173`
- `GET /api/portal/customer/scope-status` — `portal-customer-engines.ts:209`

Both routes live in the same file, which also serves `rescoring-status` and `dashboard` — those
two are **not** named in #2452's Step 1 and are out of scope for this pack (see "Not covered by
this pack").

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/portal-customer-engines.ts` — the two named routes and their
  friendly-translation helper functions (`slaOverall`, `slaHeadline`, `slaSubtext`,
  `slaComplianceLabel`, `responsePerformanceLabel`, `friendlySlaPerformance`, `scopeOverall`,
  `scopeHeadline`, `scopeSubtext`, `driftStatus`/`expansionStatus`/`timelineStatus`,
  `driftMessage`/`expansionMessage`/`timelineMessage`)
- `artifacts/api-server/src/lib/sla-engine.ts` — `SlaEngineOutput`, `SlaTimerEvaluation`,
  `evaluateTimer()`, `computeSlaEngine()`, `runSlaEngineForTenant()`
- `artifacts/api-server/src/lib/scope-creep-engine.ts` — `ScopeCreepEngineOutput`,
  `ScopeCreepDetectionEvaluation`, `evaluateDetection()`, `computeScopeCreepEngine()`,
  `runScopeCreepEngineForTenant()`
- `artifacts/api-server/src/middlewares/requireAuth.ts` — `AuthUser` shape, `requireRole()`
- `artifacts/api-server/src/index.ts:930-975` — `sla_policies` / `sla_timers` / `msp_sla_weights`
  `CREATE TABLE` statements (these two engines are **not** Drizzle-schema tables — every read is
  raw `db.execute(sql...)`, so the `CREATE TABLE` statements are the only real column source)
- `artifacts/api-server/src/lib/scope-creep-engine.ts:738-860` — `scope_creep_policies` /
  `scope_creep_detections` / `scope_creep_violations` `CREATE TABLE` statements
- Local `psql` against the real `DATABASE_URL` — `\d scope_creep_detections`, `\d
  scope_creep_policies`, `\d scope_creep_violations`, and row samples of `users`/`tenants` — used
  to confirm the real, current column set/constraints and to verify the Finding in §5

---

## 1. Wire contract — `GET /api/portal/customer/sla-status`

Auth: `requireRole("CustomerUser")` (`:175`). 400 `{ error: "No customer account associated
with this user" }` if the JWT carries no `customerId` claim (`:178-181`).

No query params. Response (`:188-199`) — a friendly, translated summary, never the raw
`SlaTimerEvaluation[]` breakdown or policy internals:

| Field | Type | Nullability | Source |
|---|---|---|---|
| `overall` | `"on_track" \| "attention_needed" \| "action_required"` | not null | `slaOverall()` — `"action_required"` if `activeBreaches > 0`, else `"attention_needed"` if `warningTimers > 0`, else `"on_track"` (`:49-53`) |
| `headline` | `string` | not null | `slaHeadline(overall)` — one of 3 fixed strings (`:55-64`) |
| `subtext` | `string` | not null | `slaSubtext(output, overall)` — interpolates real counts (`:66-76`) |
| `complianceLabel` | `string` | not null | `slaComplianceLabel(output)` — `"No open requests"` if `runningTimers === 0`, else `"100% on time"` if `compliancePct === 100`, else `"<pct>% resolved within target this period"` (`:78-83`) |
| `activeWarnings` | `number` | not null | `output.warningTimers` |
| `activeIssues` | `number` | not null | `output.activeBreaches` |
| `openRequests` | `number` | not null | `output.runningTimers` |
| `responsePerformance` | `"well_within" \| "approaching_limit" \| "overdue"` | not null | `responsePerformanceLabel(output)` (`:85-90`) |
| `responsePerformanceLabel` | `string` | not null | `friendlySlaPerformance(performance)` — one of 3 fixed strings (`:92-98`) |
| `updatedAt` | `string` (ISO) | not null | `output.timestamp` — the evaluation timestamp, not a DB-persisted "last updated" column (this engine computes live on each call, see §3) |

500 `{ error: "Unable to load your service status right now. Please try again shortly." }` on
any thrown error (`:200-203`).

**`SlaEngineOutput` fields this route does NOT surface** (`sla-engine.ts:104-116`):
`slaSignalScore`, `slaTimerScore` (the two weighted sub-scores `score`/`compliancePct` are
blended from), `breakdown` (per-timer `SlaTimerEvaluation[]` — ticket refs, elapsed/threshold
minutes), `policies` (id/name/priority), `rawSignals` (internal signal keys like
`"sla:breach_detected"`).

---

## 2. Wire contract — `GET /api/portal/customer/scope-status`

Auth: `requireRole("CustomerUser")` (`:211`). Same 400 shape as §1 if no `customerId` claim
(`:214-217`).

No query params. Response (`:231-257`):

| Field | Type | Nullability | Source |
|---|---|---|---|
| `overall` | `"on_track" \| "attention_needed" \| "action_required"` | not null | `scopeOverall()` — `"action_required"` if `score.openViolations > 0`, else `"attention_needed"` if `score.openDetections > 0`, else `"on_track"` (`:102-106`) |
| `headline` | `string` | not null | `scopeHeadline(overall)` — one of 3 fixed strings (`:108-117`) |
| `subtext` | `string` | not null | `scopeSubtext(output, overall)` — interpolates real counts (`:119-128`) |
| `openItems` | `number` | not null | `output.score.openDetections + output.score.openViolations` |
| `areas` | `ScopeArea[]`, always exactly 3 entries | not null | see below |
| `updatedAt` | `string` (ISO) | not null | `output.timestamp` |

`areas[]` is a fixed 3-entry array, one per `detectionType`, never fewer/more (`:236-255`):

| `key` | `label` | `status` | `message` |
|---|---|---|---|
| `"deliverables"` | `"Deliverable Changes"` | `driftStatus(output)` | `driftMessage(status, driftItems.length)` |
| `"scope"` | `"Scope Additions"` | `expansionStatus(output)` | `expansionMessage(status, expansionItems.length)` |
| `"timeline"` | `"Timeline"` | `timelineStatus(output)` | `timelineMessage(status, timelineItems.length)` |

Each area's `status` is `ItemStatus = "ok" | "notice" | "alert"` (`:130`), derived per-type from
`output.breakdown` (`:132-151`): `"ok"` if no `exceeded` detection of that `detectionType`
exists; else `"alert"` if `output.score.openViolations > 0` (**any** open violation escalates
**every** exceeded area to `"alert"`, not just the area the violation belongs to — the violation
count is composite-scored, not per-detection-type); else `"notice"`. Each area's `message` is one
of 3 fixed templates per type, count-interpolated (`:153-169`).

500 `{ error: "Unable to load your project status right now. Please try again shortly." }` on
any thrown error (`:258-261`).

**`ScopeCreepEngineOutput` fields this route does NOT surface**
(`scope-creep-engine.ts:145-160`): `score.compositeScore`, `score.driftScore`,
`score.expansionScore`, `score.timelineSlipScore`, `score.compliancePct` (a numeric % counterpart
to `complianceLabel` in §1 — scope-status has no equivalent numeric/label field at all, only the
3-state `areas[].status`), `breakdown` (per-detection `changePct`/`threshold`/`contribution`),
`policies` (id/name), `rawSignals`.

---

## 3. Both engines compute live on every call — nothing is DB-persisted per request

Neither route reads a cached/precomputed score. Both call the engine's `runXForTenant()`
directly in-request (`sla-engine.ts:276-305`, `scope-creep-engine.ts:337-347`), which fetches
the tenant's currently-open timers/detections + active policies and recomputes the full output
synchronously, every call. `updatedAt`/`timestamp` in both responses is therefore always "now",
not a "last engine run" timestamp — there is no async engine-run cadence to represent for either
of these two routes (contrast with `rescoring-status`, out of scope here, which does read a
persisted `msp_diagnostic_runs` row).

---

## 4. Real DB tables and enums behind both engines

Neither engine's tables are Drizzle-schema-defined — every read in both `sla-engine.ts` and
`scope-creep-engine.ts` is a raw `db.execute(sql...)` call. Column/constraint source is each
file's own `CREATE TABLE IF NOT EXISTS` (`index.ts:930-975` for SLA, `scope-creep-engine.ts:738-
860` for scope creep), confirmed live against the real local DB via `psql \d`.

**`sla_timers`** (`index.ts:951-969`): `status` is unconstrained `TEXT DEFAULT 'active'` — no
CHECK constraint enforces the `"running" | "paused" | "stopped" | "breached"` union the TS
`SlaTimer.status` type claims (`sla-engine.ts:53`). Both the engine's own row-fetch (`WHERE
status = 'running'`, `sla-engine.ts:256`) and the table's own column default (`'active'`) use
different literal strings — a timer inserted at its column default would never be picked up by
the engine's own query. No live `sla_timers` rows exist in the local DB today to confirm this in
practice (0 rows, any status) — flagged as an internal consistency note, not filed as a bug,
since nothing observed contradicts it and no live caller creates timers through this pack's two
read-only routes.

**`scope_creep_detections`** / **`scope_creep_policies`** / **`scope_creep_violations`**: real
enum CHECK constraints confirmed via `psql \d` — `detection_type IN ('drift', 'expansion',
'timeline_slip')`, `status IN ('open', 'acknowledged', 'resolved')`,
`fulfillment_type IN ('assessment', 'monitoring', 'project', 'retainer')` (nullable — NULL means
"applies to all types"), `severity IN ('low', 'medium', 'high', 'critical')`. `customer_id` on
all three is a plain `INTEGER NOT NULL` with no FK constraint to `tenants.id`, but is used as a
tenant id throughout `scope-creep-engine.ts` (see §5).

---

## 5. Finding — `sla-status` always reads empty (`runSlaEngineForTenant()` resolves the wrong id space)

`runSlaEngineForTenant(customerId)` does **not** treat its `customerId` argument as a tenant id.
Its own code comment says so explicitly (`sla-engine.ts:277-281`): *"`customerId` here is a
users.id despite the name... Resolve the owning tenant through users.tenantId."* The function's
first query is `eq(usersTable.id, customerId)` inner-joined to `tenantsTable` (`:282-287`); only
if that resolves does it fetch timers/policies for the real tenant id.

But the route calls it with `req.user!.customerId` — the JWT's `customerId` claim
(`portal-customer-engines.ts:177, 184`), which is a **tenant id**
([[user-tenantid-is-jwt-customerid-bridge]], and confirmed by this same file's own sibling
routes: `/portal/dashboard` reads `tenantsTable.id, customerId` directly at `:596`, `/portal/
customer/offboard` writes `tenantsTable` keyed on the same `customerId` at `:868` — every other
route in this file treats it as a tenant id, only this one function disagrees).

Confirmed live against the real local DB, not just by reading the code: `tenants.id` values are
low single digits (`1`, `3` sampled); `users.id` values start at `37`+ for every real customer
login sampled, with the sole low-numbered exception `users.id = 1` — Shane McCaw's own
`PlatformAdmin` row, which has `tenant_id IS NULL`. Passing a real customer's `customerId` (e.g.
`1` or `3`) into `runSlaEngineForTenant()` looks up a `users.id` that either doesn't exist or (for
`id = 1`) belongs to a platform-admin login with no tenant — the inner join returns nothing
either way, `resolvedCustomerId` stays `null` (`sla-engine.ts:288`), and the function
short-circuits to `computeSlaEngine([], [], ...)` (`:291-293`) — an empty engine run.

**The practical effect**: every real customer's `sla-status` call returns `overall: "on_track"`,
`headline: "Your service is running smoothly"`, `complianceLabel: "No open requests"`, and
`openRequests: 0` — regardless of how many SLA timers are actually running or breached for that
customer. This is not a "no data yet" empty state; it is a **silently wrong** one, since the
route's own 400 guard already confirmed `customerId` is present and valid — the mismatch is
entirely internal to `runSlaEngineForTenant()`'s own id resolution, invisible to the caller. The
local DB currently has 0 `sla_timers` rows of any status, so no live customer today sees a
false-positive "all clear" that contradicts a real breach — but the bug is real and would
silently mask one the moment a timer is created, and the sibling `runScopeCreepEngineForTenant()`
(§2/§4) proves the tenant-id-direct scoping this function should be using: it takes the exact
same route-supplied `customerId` and applies it straight to `scope_creep_detections.customer_id`
/ `scope_creep_violations.customer_id` with no user-table bridge at all
(`scope-creep-engine.ts:341-345`).

Filed as **#2513**, sibling of this issue's own Feature parent #1661, labeled `bug`.

---

## 6. Honest-empty / partial-data contract

- **`GET /api/portal/customer/sla-status`**: a customer with zero running SLA timers and zero
  policies gets a real `overall: "on_track"` / `openRequests: 0` / `complianceLabel: "No open
  requests"` response (`computeGroupCompliance([])` returns `100` for an empty group,
  `sla-engine.ts:186`) — this is the same shape §5's bug silently forces for every customer, so
  today there is no way to distinguish "genuinely zero timers" from "the id-resolution bug fired"
  by looking at the response alone.
- **`GET /api/portal/customer/scope-status`**: a customer with zero open detections and zero open
  violations gets a real `overall: "on_track"`, all 3 `areas[].status: "ok"` — a genuine empty
  state, not a bug-masked one, since this route's scoping is correct (§5).
- Both routes: any thrown error (DB connection failure, etc.) is a caught 500 with a
  customer-facing plain-language message (§1/§2) — never a raw stack trace or DB error string.

---

## 7. Cross-surface edges

- **`rescoring-status`** and **`dashboard`** share this same route file and the same
  `requireRole`/`customerId`-claim pattern, but are not named in #2452's Step 1 and are not
  analyzed here beyond noting their presence (see "Not covered by this pack").
- **`sla_policies` / `scope_creep_policies` / `msp_sla_weights` / `scope_creep_assignments`
  management** — no MSP-side authoring routes for these tables were read as part of this pack;
  only the two customer-facing read routes and the engine functions they call.
- **`/portal/dashboard`**'s `scores.sla` / `scores.scope_creep` fields
  (`portal-customer-engines.ts:685-686`) read from `tenantEngineSnapshotsTable` — a
  **different**, Drizzle-schema, persisted-snapshot data source entirely from the live
  `runSlaEngineForTenant()` / `runScopeCreepEngineForTenant()` calls this pack's two routes make.
  A customer could see a stale `dashboard` SLA score and a live (bug-masked, per §5)
  `sla-status` "all clear" disagree with each other — not analyzed further here since `dashboard`
  is out of #2452's named scope, flagged for Design's awareness only.

---

## Orphaned-endpoint check

```
grep -rn "scope-status\|sla-status" artifacts/portal artifacts/msp-website artifacts/shane-mccaw-consulting
```

Real result: **zero live callers**, in any of the three checked trees. Neither the new `#1485`
portal scaffold (`artifacts/portal` — no page exists for this Feature yet, no `Design/portal/`
export either) nor the marketing site nor the deleted-but-still-referenced old portal-v2 tree
(already retired, not part of this check) calls either route today. This is real, current state —
Design should build against these 2 real, live, unexercised endpoints, not treat the absence of a
caller as evidence something is broken.

---

## Not covered by this pack

Per #2452 Step 3, no page/UI-shape decisions are made here. `rescoring-status` (Git #1048) and
`/portal/dashboard` (Git #327/#1397/#2500), both served by the same route file, are named in the
file's own header doc comment as sharing it with this Feature's two routes but are **not** in
#2452's Step 1 endpoint list and are not analyzed beyond the one-line mentions in §7. The
MSP/admin-side SLA and Scope Creep policy-authoring surfaces (wherever `sla_policies` /
`scope_creep_policies` rows are actually created/edited) were not located or analyzed — this pack
covers only the two named customer-facing read routes and the engine code they call.
