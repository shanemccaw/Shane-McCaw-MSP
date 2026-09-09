# M365 Launch Control — contract extraction pack

**For Claude Design. Extracted, not authored — every claim below is cited to file:line against
the code on `main`.** Read-only build: no product code, no schema, no UI were changed to produce
this document.

Module: **M365 Launch Control**, Feature **#2494** (Feature: M365 Launch Control (MSP Console)),
under **#1571** (EPIC: Portal Admin — MSP-side operator surface). Leaf issue: **#2613** (the #1642
pattern). `msp-launch-control.ts` was confirmed real in #2494's own body — 3 routes, no UI yet.
This pack is the first line-by-line audit of the whole module, done with the extra care the
dispatch called for: **this is real, live tenant-write-execution code**, not a read surface.

**Read this before drawing anything: the execute and rollback routes are real, live, and
correctly gated — but neither has ever fired a real write through this console.** §7 documents
two concrete, verified backend gaps (filed as #2702 and #2703) that make both POST routes
unreachable end-to-end today, independent of and in addition to the deliberate
`isTestbed`-only restriction the route already states for itself. Do not design the execute/
confirm/rollback screens assuming either path currently completes — they 409 / throw for every
real input right now, for reasons documented below, not because of a design gap.

---

## 0. The three surfaces of this module

| # | Surface | File | Audience | Writes? |
|---|---|---|---|---|
| A | `GET /api/msp/:mspId/launch-control/actions?customerId=:customerId` | `artifacts/api-server/src/routes/msp-launch-control.ts:134-180` | MSP operator (action picker) | no |
| B | `POST /api/msp/:mspId/launch-control/execute` | same file, `:184-301` | MSP operator (the actual write) | **yes — a real Graph write** |
| C | `POST /api/msp/:mspId/launch-control/rollback/:auditLogId` | same file, `:305-351` | MSP operator (undo one prior execution) | **yes — a real Graph write** |

No UI consumes any of these three today — #1571's own structured index and #2494's Phase 4
("UI: tenant picker, action picker with availability labeling, confirm flow, live status, audit
history") are both still open/unchecked. This pack is the direct input to that screen once it is
architected; do not treat its absence as this pack's scope creeping into UI work.

All three: `requireRole("MSPOperator")` (admits MSPOperator, MSPAdmin, PlatformAdmin — role
hierarchy, `middlewares/requireAuth.ts:205-223`) + `requireMspScope("params")` (path `:mspId`
must equal the caller's own `mspId`, PlatformAdmin bypasses — `:234-270`). B and C additionally
call `assertCustomerAccess(req.user!, customerId)` (`:295-324`) once the request's own customerId
is known — the single source of truth also used across the platform (Ownership/RACI's D surface,
Change Control, etc.), not a bespoke check for this module.

---

## 1. Per-surface wire contract

### 1a. `GET /msp/:mspId/launch-control/actions` — the action picker (A)

Source: `msp-launch-control.ts:134-180`. `customerId` is a **required query param** (400 if
missing/non-numeric, `:142-143`) — unlike Ownership's surface A, this route has no JWT-derived
customer scope of its own to fall back on; the technician is always acting cross-tenant from the
MSP side, so the customer must always be named explicitly, then re-validated via
`assertCustomerAccess` (`:146-149`).

**Response shape** (`:174`, not a named type — assembled inline):

| Field | Type | Nullability | Line |
|---|---|---|---|
| `actions` | `WriteActionCatalog[] & { availability: Availability; requiredVariables: string[] }` | never null, always the full 123-row catalog | `168-172` |
| `customerTier` | `string \| null` — the resolved Monitoring tier (`resolveCustomerMonitoringTier`) | null if the customer has no active `client_services` row joined to a `services` row | `174`, `89-102` |

**Each `actions[]` entry** is a `write_action_catalog` row (`lib/db/src/schema/msp.ts:3911-3936`,
verbatim spread `:169`) plus two computed fields:

| Field | Type | Nullability | Line |
|---|---|---|---|
| `id`, `domain`, `actionName`, `surface` | as stored | never null | `3912-3915` |
| `requiredPermission` | `string \| null` | may be null | `3916` |
| `safeOrGated` | `"safe" \| "gated" \| null` | null for the 7 `blocked_no_workaround` rows | `3920`, §2 |
| `minBundledTier` | `string \| null` | null for 7 rows (§6 live count) | `3921` |
| `requiredCapabilityKey` | `string \| null` | **null on all 123 rows today** (§6) — stored but never read by `computeAvailability` | `3922` |
| `snapshotNotes`, `blockedReason` | `string \| null` | may be null | `3923`, `3925` |
| `status` | `string` | `"metadata_pending" \| "endpoint_design_pending" \| "blocked_no_workaround"` today (§3, §6 live count) — **no execution-ready value exists in the live data** | `3924` |
| `sortOrder` | `number` | never null | `3926` |
| `templateId` | `string \| null` | **null on all 123 rows today** (§7 — #2702) — once set, the real key into `baseline_action_templates.templateId` | `3933` |
| `availability` | `Availability` = `"included" \| "billable_upsell" \| "a_la_carte"` | never null, computed fresh per request (§3) | `170`, `112-130` |
| `requiredVariables` | `string[]` | **always `[]` today** — only populated when `templateId` is non-null (`:171`), and no row has one (§7) | `171` |

### 1b. `POST /msp/:mspId/launch-control/execute` — the write (B)

Source: `:184-301`. Body: `{ catalogActionId: number, customerId: number, variables?:
Record<string, string> }` (`:192`) — `catalogActionId` is the **catalog row's own `id`**, never
`templateId` or `actionName` (the route header comment is explicit that `actionName` and
`templateId` can never match — one is human-readable, the other a machine key, `:206-210`).

**The gate sequence, in order, all fail-closed:**

1. `assertCustomerAccess` (`:201-204`) — 403 if the caller can't reach this customer.
2. Catalog row must exist (`:211-219`) — 404 if `catalogActionId` doesn't resolve.
3. **`catalogRow.templateId` must be non-null** (`:220-223`) — 409 `"This action isn't wired to a
   real executable template yet"` otherwise. **Every one of the 123 live rows fails this gate
   today** (§7 — #2702): the execute route is currently unreachable past step 3 for any real
   catalog action, regardless of which one a technician picks.
4. **Re-validated availability** (`:226-234`) — the route never trusts a client-sent
   `availability` label; it recomputes `computeAvailability` from scratch against the caller's own
   MSP tier and the target customer's own Monitoring tier, and 402s (with the real `availability`
   value in the body) if the recomputed result isn't `"included"`.
5. Customer row re-read, **scoped by `(id, mspId)` together** (`:242-251`), not just `id` — an
   explicit re-scoping even though `assertCustomerAccess` already fenced this, because this is the
   read that authorizes a real Graph write (`:236-241` comment). 400 if the customer has no
   `tenantId` (never connected).
6. **`isTestbed` gate** (`:256-266`) — 403 `"Launch Control is only available for a customer
   flagged isTestbed"` unless `tenants.is_testbed = true`. Stated in the route's own file header
   as a **TEMPORARY STAGING RESTRICTION** (`:24-26`) — lifting it for live customer tenants is
   explicitly out of scope for this route as written, a separate later task. `is_testbed` is `NOT
   NULL DEFAULT false`, so any tenant created without setting it explicitly fails closed here, not
   open.
7. Template row must exist for `templateId` (`:268-276`) — 404 `"...has no runnable template yet"`
   if the catalog's `templateId` points at a template row that isn't actually there (defensive;
   with gate 3 in force this branch is presently unreachable, since no catalog row ever reaches
   here — see §7).
8. `runBaselineTemplateAgainstTenant(templateId, tenantId, customerId, {...variables,
   customerId}, "launch_control")` (`lib/workflow-executor.ts:745-802`) — the **one real
   execution implementation**, shared verbatim with the Simulator's admin Testing endpoint and the
   `execute_baseline_template` Workflow Engine node (`workflow-executor.ts:9629`), so a confirmed
   Launch Control request executes byte-for-byte what `resolveBaselineTemplateRequest` (`:692-736`)
   previews. Inside this call, **`graphWriteForTenant`** (`lib/graph.ts:1023-1135`) enforces two
   more independent gates before any bytes reach Microsoft: `msps.write_back_enabled` must be true
   (`:1031-1049`, throws `WriteBackNotEnabledError`), and `tenants.consent.writeBack.status` must
   be `"granted"` (`:1051-1069`, throws `WriteConsentRequiredError`) — **six total independent
   gates** stand between a technician's click and a live Graph write: role/scope auth →
   `assertCustomerAccess` → catalog→template link → recomputed entitlement → `isTestbed` →
   write-back-enabled+consent.

**Response** (`:292-295`):

| Field | Type | Line |
|---|---|---|
| `result` | `BaselineTemplateExecutionResult & { reversible: boolean }` — `reversible` is `result.success && template.reversible` (never advertises reversibility for a failed call) | `293`, `646-658` |
| `tenant` | `{ customerId: number, name: string }` | `294` |

`BaselineTemplateExecutionResult` (`workflow-executor.ts:646-658`): `success`, `status`, `data`,
`errorType?: "insufficient_privilege" \| "conflict" \| "bad_request" \| "unexpected"`, `endpoint`,
`method`, `label`, `missingVariables?: string[]` (present only when required variables didn't
resolve — no Graph call fired), `auditLogId?: number` (present only if the audit insert itself
succeeded — a non-fatal failure there, `:794-796`, still returns the real execution result).

### 1c. `POST /msp/:mspId/launch-control/rollback/:auditLogId` — the undo (C)

Source: `:305-351`. No request body — `:auditLogId` is the only input besides `:mspId`.

**Gate sequence:**

1. Audit row must exist for `auditLogId` (`:318-326`) — 404 otherwise. **This read is not scoped
   by `mspId`** — any valid `auditLogId` across any MSP can be read at this step (contrast gate 5
   of the execute route, which explicitly re-scopes by `(id, mspId)` together with a comment
   explaining why). The following `assertCustomerAccess` check (step 3) still denies cross-MSP
   access before any write can happen, so this is not a data-leak — only a same-shaped 404-vs-403
   response that reveals whether *some* audit log id exists, not what it contains.
2. `afterSnapshot.customerId` must be a `number` (`:327-331`) — 400 if the audit row carries no
   recoverable customer context (a row from a caller that predates or bypasses this convention).
3. `assertCustomerAccess` (`:333-336`) — 403 if the caller can't reach this row's customer.
4. `rollbackExecution(auditLogId)` (`workflow-executor.ts:825-913`) — see §4 for its own real
   internal gates (action must be `"executed"`, template must exist and be `reversible` with a
   `reverseTemplateId`). **Every one of these throws today** (§7 — #2703): 0 of 102 live
   `baseline_action_templates` rows have `reversible = true`, so this call throws
   `"Template '<id>' is not reversible"` for any `auditLogId` a caller could legitimately supply.

**Response:** `{ result: RollbackExecutionResult }` (`:345`) — same shape as
`BaselineTemplateExecutionResult` plus `rollbackAuditLogId?: number` (the **rollback call's own**
audit row id, distinct from the original execution's). Errors here return **400**, not 500
(`:348`) — a rollback failure is treated as a client-actionable outcome (wrong id, not
reversible), not a server fault.

---

## 2. `Availability` — the honest tri-state (§3 real enum)

```ts
// msp-launch-control.ts:104
type Availability = "included" | "billable_upsell" | "a_la_carte";
```

`computeAvailability` (`:112-130`) — the single source of truth, called identically by both the
GET listing (informational) and the POST execute re-validation (authoritative, never trusts a
client-supplied label):

1. `row.safeOrGated === null` (the 7 `blocked_no_workaround` rows) → **always `"a_la_carte"`**,
   unconditionally — no safe/gated classification exists for these, so the code deliberately never
   falls through to the more permissive "safe" capability check for them (`:117-122` comment).
2. Otherwise, the required capability key is `"launch_control_gated_write"` if `safeOrGated ===
   "gated"`, else `"launch_control_safe_write"` (`:123`) — checked via `tierAllowsFeature(tier,
   capabilityKey)` (`msp-entitlement.ts:77-82`, the MSP's own platform-tier
   `services.typeAttributes.tierCapabilities` map). Fails `"a_la_carte"` if the MSP's tier doesn't
   carry the capability, or if `tier` is `null` (no subscription row at all — `tierAllowsFeature`
   returns `false` for `null`), or if `dunningState` is `access_revoked`/`archival_flagged`
   (`msp-entitlement.ts:79`).
3. If the MSP-side capability check passes: `resolveTierRank(row.minBundledTier)` — `null` for an
   unrecognized/missing tier name, which **short-circuits to `"included"`** (`:126-127`) — an
   action with no stated `minBundledTier` requires no further customer-side purchase check at all.
4. Otherwise, compare `customerTierRank` (from `resolveCustomerMonitoringTier`, §4) against the
   required rank: `>=` → `"included"`, else → `"billable_upsell"`.

**`MONITORING_TIER_RANK`** (`:65-69`, real enum): `{ basic: 0, enhanced: 1, premium: 2 }` — case
insensitive lookup (`.toLowerCase()`, `:73`); an unrecognized tier name resolves to `null` and
**fails closed** (never grants coverage it can't justify), never silently treated as the lowest or
highest rank.

**Note (self-documented in the route file's own header, `:14-22`):** `requiredCapabilityKey` on
`write_action_catalog` is a **separate, distinct** mechanism from `MONITORING_TIER_RANK`/
`minBundledTier` — intended as an add-on-purchase capability grant, backed by a real
`msp_plan_capabilities` table (`lib/db/src/schema/msp.ts:1637-1653`) with one live row today
(`service_id 131` → the "M365 Launch Control — Plus Add-On" service, `capability_key:
"launch_control_plus"`, `enabled: true`) that an MSP admin can already manage via
`routes/msp-admin-settings.ts:395-469` (a real CRUD surface). **`msp-launch-control.ts` never
reads `msp_plan_capabilities` or `requiredCapabilityKey` at all** — grep-confirmed, no reference
in this file. This matches the file's own stated scope ("no add-on/capability-grant mechanism
exists yet"), and is moot in the live data regardless: `requiredCapabilityKey` is null on all 123
catalog rows (§6), so there is nothing for that mechanism to match even once wired.

---

## 3. Real enum unions

All verbatim, cited to line.

```ts
// msp-launch-control.ts:104 — the three things a listed action can be for a given MSP+customer pair
Availability = "included" | "billable_upsell" | "a_la_carte"

// lib/db/src/schema/msp.ts:3920 — write_action_catalog.safe_or_gated (nullable — see §1a)
SAFE_OR_GATED = "safe" | "gated"

// msp-launch-control.ts:65-69 — the only three Monitoring tier names this route understands
MONITORING_TIER_RANK keys = "basic" | "enhanced" | "premium"   // case-insensitive match

// live data (write_action_catalog.status, §6) — NOT a DB CHECK constraint (schema types it as
// bare `text()`, lib/db/src/schema/msp.ts:3924), these are simply the only 3 values present today
write_action_catalog.status (observed) = "metadata_pending" | "endpoint_design_pending" | "blocked_no_workaround"

// lib/db/src/schema/msp.ts:3847 — baseline_action_templates.method, a real DB enum
BASELINE_TEMPLATE_METHOD = "POST" | "PATCH" | "PUT" | "DELETE"

// lib/db/src/schema/msp.ts:3856, referencing MONITOR_CHECK_STATUS — baseline_action_templates.status
// (shared enum with monitor_checks; archived rows are grandfathered, never hard-deleted)

// workflow-executor.ts:650, 808 — the only 4 failure classifications a Graph write result carries
GraphWriteErrorType = "insufficient_privilege" | "conflict" | "bad_request" | "unexpected"

// baseline_action_template_audit_log.action (workflow-executor.ts:774) — not DB-enforced, but the
// only 2 values any code path writes
AUDIT_LOG_ACTION = "executed" | "failed"
```

---

## 4. Cross-surface edges and structural facts

- **One execution implementation, three callers.** `runBaselineTemplateAgainstTenant`
  (`workflow-executor.ts:745-802`) is called by Launch Control's own execute route (`source:
  "launch_control"`), the Simulator's admin Testing endpoint (`routes/admin-baseline-templates.ts`,
  confirmed by the file header comment `msp-launch-control.ts:9-22` and by every one of the 25
  live `baseline_action_template_audit_log` rows carrying `source: "simulator"`, §6), and the
  `execute_baseline_template` Workflow Engine node (`workflow-executor.ts:9629`). A confirmed
  request executes the exact same substitution `resolveBaselineTemplateRequest` (`:692-736`)
  already previewed — one implementation, not three that can drift.
- **The customer's Monitoring tier is resolved across every linked login, not one arbitrary
  user.** `resolveCustomerMonitoringTier` (`:89-102`) calls `resolveCustomerUserIds(customerId)`
  (`lib/tenant-signals.ts:156-163` — every `users` row sharing that `tenantId`) then joins
  `client_services` → `services` across the **whole set**, ordered by `client_services.id` and
  limited to 1 — the same "customer-scoped, not single-login" discipline the code comment states
  explicitly (`:85-88`), because the purchasing login and the login making the Launch Control
  request are not guaranteed to be the same person.
- **`computeAvailability` deliberately ignores `req.user.role === "admin"` / PlatformAdmin
  bypass.** Unlike `requirePlanFeature` middleware elsewhere in `msp-entitlement.ts` (`:100-104`,
  which explicitly bypasses tier gating for PlatformAdmin/legacy admin), `msp-launch-control.ts`
  calls `tierAllowsFeature` directly — there is **no PlatformAdmin bypass path** for the
  availability computation itself. A PlatformAdmin can reach any MSP's Launch Control routes
  (`requireMspScope`'s own bypass, `requireAuth.ts:245-248`) but is still subject to that target
  MSP's own real tier/capability gating once inside — a genuine, narrower bypass than the rest of
  the entitlement subsystem, not an oversight this pack invents a fix for.
- **`rollbackExecution`'s reverse-pairing is explicit, not generic** (`workflow-executor.ts:816-
  913`). Three distinct code paths, in priority order: (1) **self-paired** — `reverseTemplateId
  === templateId` (the sign-in-toggle shape) inverts the captured boolean variable(s) in
  `requestVariables` rather than replaying the same call; (2) **`teams.add_member` /
  `teams.remove_member`** — a hardcoded special case that performs a **live Graph read**
  (`GET /teams/{teamId}/members`) immediately before the reverse call, because Teams' remove
  operation needs the conversation-membership id, not the user id captured at add time; (3) **all
  other pairs** — replay `reverseTemplateId` with the exact same `requestVariables` the original
  execution captured. One level only: `rollbackExecution`'s only caller
  (`routes/msp-launch-control.ts`) never passes a rollback's own audit log id back in — rolling
  back a rollback is not supported.
- **Rollback recovers body-only variables the endpoint string alone can't.** The audit log's
  `requestVariables` column (`lib/db/src/schema/msp.ts:3883-3890`) exists specifically because
  values like `accountEnabled`/`skuId` live only in the POST/PATCH body, not the endpoint path —
  without capturing them at execution time, a later rollback would have no way to know what to
  invert or replay.
- **`beforeSnapshot` is a real column, written nowhere.** `baseline_action_template_audit_log
  .beforeSnapshot` (`lib/db/src/schema/msp.ts:3883`) exists in the schema and is a real,
  independently-typed `jsonb` column — but `runBaselineTemplateAgainstTenant`'s insert
  (`workflow-executor.ts:772-792`) sets `action`, `templateId`, `requestVariables`, and
  `afterSnapshot` only. **Confirmed live: 0 of 25 audit log rows have a non-null
  `beforeSnapshot`** (§6). This is #2494's own already-named gap ("`beforeSnapshot` column exists
  but unpopulated (real rollback gap)") — this pack corroborates it against live data, it does not
  discover it.
- **Six independent gates stand between a click and a live Graph write** (§1b step 8) — role/scope
  auth, `assertCustomerAccess`, catalog→template link, recomputed entitlement, `isTestbed`,
  write-back-enabled+consent. Every one fails closed on missing/ambiguous data; none of the six
  degrade to "allow."

---

## 5. Object/table map

| Concept | Table | Scoped by | Line (schema) |
|---|---|---|---|
| The universe of possible write actions | `write_action_catalog` | none (global reference list, `mspId`/`customerId` never stored on it) | `msp.ts:3911-3936` |
| A real, runnable action | `baseline_action_templates` | none directly — reached only via `write_action_catalog.templateId` or the audit log's own `templateId` | `msp.ts:3840-3870` |
| One execution or rollback attempt | `baseline_action_template_audit_log` | `afterSnapshot.customerId`/`tenantId` (jsonb, not a real FK) | `msp.ts:3878-3895` |
| MSP-side capability add-on grants | `msp_plan_capabilities` | `serviceId` → `services.id` | `msp.ts:1637-1653` |
| MSP platform-tier subscription | `msp_subscriptions` ⋈ `services` | `mspId` | referenced via `loadTier`, `msp-entitlement.ts:39-65` |
| A customer's purchased Monitoring tier | `client_services` ⋈ `services` | every `users.id` sharing the customer's `tenantId` | `msp-launch-control.ts:89-102` |
| The write-back safety gates | `msps.write_back_enabled`, `tenants.consent.writeBack.status` | `mspId` / tenant GUID, independently | `lib/graph.ts:1031-1069` |

`write_action_catalog` and `baseline_action_templates` are **independent tables with no DB-level
FK** — the schema-definition-only comment on `write_action_catalog` (`msp.ts:3901-3910`) states
this was created via manual SQL with no migration file tracked in this repo, and its own
`templateId` column is a plain nullable `text`, matched at query time against
`baseline_action_templates.templateId` (also plain `text`, unique-indexed but not a foreign key,
`msp.ts:3842`). A promotion is therefore a data operation (setting the text value to match), not a
schema operation.

---

## 6. The honest-empty contract, confirmed against live data this session

Queried directly against local `DATABASE_URL` (PostgreSQL 18), all counts real and current as of
this session:

| Query | Result |
|---|---|
| `write_action_catalog` total rows | **123** |
| `write_action_catalog` rows with `template_id` set | **0** |
| `write_action_catalog` rows with `required_capability_key` set | **0** |
| `write_action_catalog.safe_or_gated` distribution | `safe`: 65, `gated`: 51, `null`: 7 |
| `write_action_catalog.status` distribution | `metadata_pending`: 72, `endpoint_design_pending`: 44, `blocked_no_workaround`: 7 |
| `write_action_catalog.min_bundled_tier` distribution | `enhanced`: 56, `premium`: 32, `basic`: 28, `null`: 7 |
| `baseline_action_templates` total rows | **102**, all `status = 'active'` |
| `baseline_action_templates` rows with `reversible = true` | **0** |
| `baseline_action_template_audit_log` total rows | **25** (executed: 9, failed: 16) |
| `baseline_action_template_audit_log` rows with `source: "launch_control"` | **0** — all 25 carry `source: "simulator"` |
| `baseline_action_template_audit_log` rows with a non-null `before_snapshot` | **0 of 25** |
| `msp_plan_capabilities` total rows | **1** (`service_id 131`, `capability_key: "launch_control_plus"`, `enabled: true`) |
| `tenants.is_testbed` distribution | `true`: 1, `false`: 1 |

**No `write_action_catalog` row has ever been reachable through this console's own execute path,
and no execution through this console's own audit trail exists** — every real execution against
the local dev database ran through the Simulator's admin Testing endpoint, not Launch Control.
This is a genuinely different honest-empty than "a fresh install with nothing scanned yet" — the
underlying execution mechanism is proven (25 real attempts, 9 successful, via the Simulator), but
Launch Control's own front door to it (the catalog→template link) has never been opened. See §7
for the two filed gaps this traces to.

---

## 7. Open questions and genuine gaps found this session

Two new, concrete, verified gaps were found and filed as sibling sub-issues of this issue's own
Feature (#2494), not re-discovered restatements of what #2494's body already named:

- **#2702 — `write_action_catalog.template_id` is 0/123 populated.** The execute route's gate 3
  (§1b) makes every one of the 123 live catalog rows fail with a 409 today, regardless of which
  action a technician picks — even though 102 real, `status: 'active'` `baseline_action_templates`
  rows exist and are independently proven runnable (25 real executions via the Simulator, §6).
  The catalog→template promotion step (#2494's own Phase 3: "insert as baseline_action_templates
  rows") produced the templates but never linked them back to the catalog rows that would let
  Launch Control's own routes reach them.
- **#2703 — Launch Control rollback is completely inert, and its root cause is a migration whose
  own tracking row says it ran but whose effect isn't in the live table.**
  `lib/db/migrations/manual/2026-07-21-launch-control-rollback.sql` sets `reversible = true` +
  `reverse_template_id` on 6 specific `template_id` values (`users.disable_enable_signin`,
  `licensing.assign_license`/`remove_license`, `groups.add_member`/`remove_member`,
  `teams.add_member`/`remove_member`) and is recorded in `simulator_migration_runs` as having run
  on 2026-08-06. **None of those 6 template_ids exist anywhere in the live `baseline_action_templates`
  table** — confirmed by direct query. The 102 live rows use an entirely different naming
  convention (`action.*`, `microrem.*`, `quickstart-v1.*`, `groups.*`, `roleManagement.*`), 92 of
  them created on 2026-07-20 (the same day the tracked phase3-templates migration's own 10
  differently-named rows were apparently superseded) through a mechanism not present in
  `lib/db/migrations/manual/`. Net effect: `POST /rollback/:auditLogId` throws `"Template '<id>'
  is not reversible"` for every audit log row that could ever be passed to it — the entire
  reverse-template-pairing implementation in `workflow-executor.ts` (self-pairing, the Teams
  live-membership-lookup special case, generic replay) is currently dead code, unreachable from
  any live data.

Neither gap is a product decision — both are exactly the "field/link the product plainly needs
and does not have" case, filed rather than fixed in this read-only pack per #2613's own scope.

Already-named, not re-filed:
- **`beforeSnapshot` unpopulated** (§4, §6) — #2494's own body already states this as a known real
  gap; this pack corroborates it against live data (0/25) rather than rediscovering it.
- **The `isTestbed`-only restriction** (§1b gate 6) is explicitly self-documented as temporary and
  out of scope for this route to lift — not a gap, a stated, deliberate boundary this pack does
  not second-guess.
- **`requiredCapabilityKey`/`msp_plan_capabilities` non-integration** (§2) is explicitly
  self-documented in the route file's own header as current, deliberate scope ("no add-on/
  capability-grant mechanism exists yet") — moot in the live data regardless, since no catalog row
  sets `requiredCapabilityKey` for that mechanism to match against even if wired.
- **#1074** (open, different milestone v1.2) tracks reviewing the remaining ~93 unsampled
  `write_action_catalog` rows for data-quality/completeness — a distinct concern from #2702/#2703
  above (which are about the catalog↔template *link*, not row content), not duplicated by this
  pack's findings.
