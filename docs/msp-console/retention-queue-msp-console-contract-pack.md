# Retention Queue (MSP Console operator side) — contract extraction pack

**#3372**, under **#1571** (EPIC: Portal Admin — MSP-side operator surface). No Feature-tier
issue sits between them (confirmed via the GitHub API — #3372's parent is #1571 directly, same
as #3356/customer-timeline before it). Follows the **#1642 pattern**: the wire contract extracted
verbatim and cited to file:line, real enum unions only, cross-surface edges, honest-empty
contract, orphaned-endpoint check. Read-only — no product code, schema, or UI changed by this
session; every field below is cross-checked live against local Postgres (`shanemccawmsp`,
`DATABASE_URL`).

**Real, confirmed backend, no pack existed for it yet.** `msp-retention-queue.ts` is 188 lines
(189 counting the trailing newline), 3 routes: `GET /api/msp/retention/queue`, `POST
/api/msp/retention/queue/:deletionId/decide`, `POST /api/msp/retention/queue/:deletionId/discuss`.
No genuine incompleteness marker (`TODO`/`FIXME`/stub) exists in the file. **But completeness is
not the same question as adoption** — §4 below documents that the queue this route reads is now
genuinely reachable (Git #3451 registered a real record class and wired real callers), but is
still empty in this environment today because no customer has exercised that path here yet.

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/msp-retention-queue.ts` — the route itself (all line refs
  below are into this file unless stated otherwise)
- `artifacts/api-server/src/routes/msp-retention-queue.test.ts` — confirms the real
  request/response shape, the 401/403/404 scoping behavior, and the decide/discuss composition
  asserted here
- `artifacts/api-server/src/lib/retention/lifecycle.ts` — `listAccelerationQueue`,
  `getDeletionById`, `decideAcceleration`, `restore`, `purgeNow`, `RetentionError`,
  `RetentionActor`, `AccelerationQueueItem`
- `artifacts/api-server/src/lib/retention/registry.ts` — `registerRetainedRecordType`,
  `requireRetainedRecordType`, `RetainedRecordType` — the per-record-class plug-in point §4 is
  about
- `artifacts/api-server/src/lib/retention/clock.ts` — `isRunningStage`, `RUNNING_STAGES`
- `lib/db/src/schema/retention.ts` — `recordDeletionsTable`, `RETENTION_STAGES`,
  `RETENTION_DELETE_SIDES`, `RETENTION_ACCELERATION_STATES`, `RETENTION_ACCELERATION_REASONS`
  (real enum/column sources)
- `artifacts/api-server/src/middlewares/requireAuth.ts` — `requireRole`,
  `resolveStaffScopedCustomerIds`, `isCustomerBlockedByStaffScope`
- `artifacts/api-server/src/middlewares/rbac-ladder.ts` — the live decision source behind
  `requireRole` since #2458 (this branch's own immediately-preceding history)
- `artifacts/api-server/src/lib/resolve-msp-id.ts` — `resolveMspIdStrict`
- `artifacts/api-server/src/lib/retention/subscription-gate.ts` — `gatedTenantIdFor`,
  `evaluateSubscriptionGate` — confirms this route's ordering relative to the platform-wide
  subscription gate
- `artifacts/api-server/src/routes/index.ts:226,560` — router mount; `artifacts/api-server/src/app.ts:127`
  — confirms the real, live path is under `app.use("/api", subscriptionGate, router)`
- Local Postgres (`shanemccawmsp`) — live row counts for `record_deletions` and
  `msp_staff_customer_scopes`, queried directly

---

## 1. Wire contract — `GET /api/msp/retention/queue`

Auth: `requireRole("MSPOperator")` (`:87`) — MSPOperator, MSPAdmin, or PlatformAdmin. **The
comparison itself no longer comes from a fixed `ROLE_ORDER` array index** — as of #2458 (the two
commits immediately preceding this pack's own base on `main`), `requireRole` is a thin HTTP
wrapper over `rbac-ladder.ts`'s `evaluateCapability`, a DB-backed evaluator seeded so the allow
set is identical to the old array-index comparison by construction. The one behavioral
consequence worth knowing: if the seed migration behind it has not run in some environment, this
route (like all 616 other `requireRole(...)` call sites) answers `503` rather than `403` —
"unavailable," not "denied" (`rbac-ladder.ts`'s own header). A missing/invalid bearer token is
still `401` (`requireAuth`), confirmed by the test file's first case (`msp-retention-queue.test.ts:145-148`);
below `MSPOperator` is `403` (`:150-155`).

`mspId` comes from `resolveMspIdStrict(req)` (`:89`) — reads `req.user.mspId` off the session JWT
only, no `?mspId=` override even for a PlatformAdmin. A `null` mspId 403s with `{ error: "MSP
context required" }` (`:90-93`).

Per-staff scoping: `resolveStaffScopedCustomerIds(req.user!)` (`:94`) reads
`msp_staff_customer_scopes` for the caller's `staffUserId`. **Zero scope rows means
unrestricted** (`requireAuth.ts:442` — `rows.length === 0` returns `null`), not "sees nothing" —
an unscoped staff member sees the whole MSP's queue; a scoped member (≥1 row) is passed as
`{ tenantIds: scopedIds }` into `listAccelerationQueue` (`:95`), which filters the query with
`inArray(recordDeletionsTable.tenantId, options.tenantIds)` (`lifecycle.ts:861`). **This route
does its own scoping filter directly in the DB query** — unlike the customer-timeline pack's
route, there is no separate "customerId param narrows within scope" query param here; the whole
queue is always pre-filtered to the caller's assigned set.

No query parameters at all — no paging, no `limit`, no `before` cursor. The whole pending-queue
is returned in one response, ordered newest-request-first (`lifecycle.ts:864` —
`orderBy(desc(accelerationRequestedAt))`), using `record_deletions_acceleration_queue_idx`
(`retention.ts:456-458`), the partial index built for exactly this read (`WHERE
acceleration_state = 'pending'`).

Response shape (`:106-109`):

| Field | Type | Nullability | Source |
|---|---|---|---|
| `queue` | `(AccelerationQueueItem & { tenantName: string \| null })[]` | not null (`[]` is real) | `listAccelerationQueue()` result, each row augmented with a resolved tenant name (`:107`) |
| `total` | `number` | not null | `items.length` (`:108`) — **not** a separate count query, and **not** the true total if a future version ever pages this; today it is always the exact size of `queue` |

Each `AccelerationQueueItem` (`lifecycle.ts:822-840`), plus the route's own `tenantName` addition:

| Field | Type | Nullability | Source |
|---|---|---|---|
| `deletionId` | `number` | not null | `record_deletions.id` |
| `recordType` | `string` | not null | `record_deletions.record_type` — free text, registry key convention (see §3) |
| `recordId` | `string` | not null | `record_deletions.record_id` — text, not uniformly an integer across record classes |
| `recordLabel` | `string \| null` | nullable | `record_deletions.record_label` — captured at delete time so it survives a later purge |
| `tenantId` | `number` | not null | `record_deletions.tenant_id` |
| `tenantName` | `string \| null` | nullable | **added by this route, not `listAccelerationQueue()` itself** (`:100-104,107`) — a batched `SELECT id, customerName FROM tenants WHERE id IN (...)` over the distinct tenant ids in the page, `null` only if a tenant id somehow isn't found (should not happen given the FK) |
| `stage` | `"soft" \| "semi_hard" \| "purged" \| "restored"` | not null | `record_deletions.stage` — **in practice always `"soft"` or `"semi_hard"` for a queue row**: `requestAcceleration()` refuses to set `accelerationState: "pending"` unless `isRunningStage(stage)` is true (`lifecycle.ts:422-424`), and once a decision is made the row leaves `accelerationState = "pending"` before it could ever reach `"purged"`/`"restored"` — so the full 4-value union is the type, but only 2 values are reachable here |
| `deletedAt` | `Date` (ISO on the wire) | not null | `record_deletions.deleted_at` |
| `deletedBy` | `string` | not null | `record_deletions.deleted_by` — display identity captured at delete time, survives the deleter being removed |
| `deletedBySide` | `"customer" \| "operator" \| "system"` | not null | `record_deletions.deleted_by_side` |
| `deleteReason` | `string` | not null | `record_deletions.delete_reason` — the **original** delete reason, deliberately distinct from the acceleration reason below (`lifecycle.ts:813-820`'s own doc comment: *"'superseded by the new CA policy' and 'we don't agree with this finding' need completely different responses"*) |
| `accelerationState` | `"none" \| "pending" \| "approved" \| "declined"` | not null | always `"pending"` for a row in this response — the query itself filters on it (`lifecycle.ts:859`) |
| `accelerationRequestedAt` | `Date` (ISO) | not null | non-null by construction per the query's own `WHERE`, not by the column's nullability |
| `accelerationRequestedBy` | `string` | not null | same non-null-by-construction note |
| `accelerationReasonKind` | `"superseded_by" \| "no_longer_needed"` | not null | same |
| `accelerationReason` | `string` | not null | same — the free-text half of the acceleration request |
| `supersededByRecordType` | `string \| null` | nullable | only set when `accelerationReasonKind === "superseded_by"` |
| `supersededByRecordId` | `string \| null` | nullable | same |

A `500` on any DB failure returns `{ error: "Failed to fetch the accelerated-delete review
queue" }` (`:111-112`).

---

## 2. Wire contract — the two write routes

Both share the same auth/scope preamble as §1 (`requireRole("MSPOperator")`,
`resolveMspIdStrict`, then `loadScopedDeletion()` — see §3 below for exactly what that function
checks), and both act on `:deletionId` from the URL, parsed with `Number(...)` and rejected `400`
`{ error: "Invalid deletion id" }` if not an integer (`:123-127`, `:152-156`).

### `POST /api/msp/retention/queue/:deletionId/decide`

Body: `{ approve: boolean, note?: string }`. `approve` is read as `req.body?.["approve"] ===
true` (`:130`) — **anything other than the literal boolean `true` is treated as `approve:
false`**, including a truthy string `"true"` or a missing field; there is no 400 for a malformed
body, it silently reads as a decline. `note` is read only if it is already a `string`, else `null`
(`:131`).

Calls `decideAcceleration({ deletionId, approve, note, actor })` (`:133`,
`lifecycle.ts:474-515`):
- `actor` is built by `actorFrom(req)` (`:49-57`) — `{ name: user.name ?? user.email, role:
  "admin", userId: user.id, side: "operator" }`. **`role` is hardcoded to `"admin"`
  regardless of the caller's real MSP role** (MSPOperator or MSPAdmin both become `role: "admin"`
  here) — `RetentionActor.role` is only ever `"admin" | "client"` (`lifecycle.ts:76`), a coarser
  axis than the MSP role ladder, and every operator-side caller of this lifecycle collapses onto
  `"admin"` by design; this is not a bug, just a narrower vocabulary than the route's own auth
  check.
- Throws `RetentionError` (`404` "does not exist", `409` "no acceleration request awaiting
  review") when the row isn't actually pending — confirmed by the test file
  (`msp-retention-queue.test.ts:230-242`).
- `approve: true` → **also calls `purgeNow()` internally** (`lifecycle.ts:514`) — approving is not
  a two-step "approve, then separately purge" flow; the record is destroyed synchronously inside
  this one request. §4 explains why this branch cannot succeed against any record type today.
- `approve: false` → re-reads and returns the row with `accelerationState: "declined"`
  (`lifecycle.ts:510-513`). *"Nothing is lost"* (the function's own comment) — the record simply
  resumes its normal clock.

Response: `{ deletion: RecordDeletion }` (`:134`) — the full ledger row as Drizzle returns it,
unmapped (unlike the `AccelerationQueueItem` shape in §1). `RecordDeletion = typeof
recordDeletionsTable.$inferSelect` (`retention.ts:465`), so the keys are the schema's own
camelCase JS property names (Drizzle maps `snake_case` columns to camelCase object keys, not the
raw column names) — e.g. `deletedByUserId`/`stageEnteredAt`/`stageRemainingSeconds`/
`frozenAt`/`totalFrozenSeconds`/`bypassUsed` are all present on the wire here, none of them
present on the narrower §1 shape.

A `RetentionError` maps to its own real `httpStatus` (`:136-139`); anything else is a generic
`500` `{ error: "Failed to record the acceleration decision" }` (`:140-141`).

### `POST /api/msp/retention/queue/:deletionId/discuss`

Body: `{ reason: string }`. Read as `typeof req.body?.["reason"] === "string" ? ... : ""` (`:160`)
— a non-string or missing `reason` becomes an empty string, not a 400; the emptiness is caught
downstream by `restore()`'s own `400` "A restore reason is required." (`lifecycle.ts:328-330`),
confirmed by the test file (`msp-retention-queue.test.ts:280-292`).

This is **#1944 part 4's third outcome** — *decline-if-pending, then restore* — composed exactly
as `decideAcceleration`'s own doc comment names it (`lifecycle.ts:470-472`):

1. If `existing.accelerationState === "pending"` (`:168`), calls `decideAcceleration({ approve:
   false, note: "Discussed with customer; restoring instead of purging.", actor })` (`:169-174`)
   first — a fixed, hardcoded note, not derived from the request body.
2. Always then calls `restore({ deletionId, reason, actor })` (`:176`), which enforces the
   required reason, clears the record's own soft-delete triple, sets `stage: "restored"`, and
   fires `notifyRetentionRestore()` (`lifecycle.ts:381-386`) — best-effort, never throws, so a
   notification delivery failure cannot make this route report the restore itself as failed.

If nothing was actually pending (an operator restoring a record that was never accelerated),
step 1 is skipped entirely and only `restore()` runs (`msp-retention-queue.test.ts:265-278`
confirms this exact branch).

Response: `{ deletion: RecordDeletion }` (`:177`) — same raw-row shape as `decide`.
`RetentionError` maps to its own status (`404` deletion doesn't exist, `410` already purged, `409`
already restored, `400` no reason); anything else is a generic `500` `{ error: "Failed to restore
the record" }` (`:183-184`).

---

## 3. `loadScopedDeletion()` — the shared authorization gate for both write routes (`:59-85`)

Both write routes call this before doing anything else. It:

1. Loads the row via `getDeletionById(deletionId)` (`lifecycle.ts:754-757`, a plain `SELECT ...
   WHERE id = ...`).
2. **404s** `{ error: "Deletion <id> does not exist." }` if the row is missing, *or* if it exists
   but `existing.mspId !== mspId` — a deletion belonging to a different MSP reads identically to
   one that doesn't exist (`:73-76`), confirmed by the test file
   (`msp-retention-queue.test.ts:205-215`).
3. Re-resolves `resolveStaffScopedCustomerIds(req.user!)` **a second time** (once per write route
   call, independent of the `GET` route's own resolution) and, for a scoped caller whose set
   doesn't include `existing.tenantId`, returns the **same 404** — not a 403 (`:77-83`). The
   function's own comment states the reason directly: *"a scoped operator must not learn a queue
   item exists on a customer they're not assigned to."* Confirmed by
   `msp-retention-queue.test.ts:217-228` (decide) — no equivalent test exists for `discuss`
   specifically, but the code path is identical (`:157-158`).

**A live, pre-existing caveat this pack did not introduce, restated because this route depends on
it exactly as every other MSP-operator route already documented does:**
`resolveStaffScopedCustomerIds`'s own doc comment (`requireAuth.ts:416-421`, citing Phase 1 / #94)
states `msp_staff_customer_scopes.customerId` is a now-orphaned `msp_customers.id` whose FK went
with that dropped table, flagged for repoint/removal in Phase 7 — "until then a scoped staff
member's set will not line up with the tenant ids [this route] compares against." Local Postgres
confirms `msp_staff_customer_scopes` has **0 rows** in this environment today (queried directly),
so every caller currently takes the unrestricted `null` path in practice; the gap is real but
dormant, exactly the state the diagnostics/msp-executive/msp-settings/msp-staff-roles packs
already recorded for this same shared helper. Not filed again here — already tracked, cited above.

---

## 4. Finding — the queue is genuinely reachable now; it's just empty in this environment today

**Superseded 2026-09-13 (#3909).** This section originally claimed the queue was *structurally*
unreachable — "no path exists anywhere in the current tree for `record_deletions` to ever gain a
row." That premise went stale when Git #3451 (POA&M soft delete) landed: a real record class is
now registered and real callers exist. The corrected claim is narrower: **the queue is empty in
this environment right now, but the code path that would populate it is real and reachable.**

Evidence, each independently verified live against the current tree (2026-09-13):

1. **A record class is now registered.** `artifacts/api-server/src/lib/retention/wiring/msp-poams.ts:47`
   calls `registerRetainedRecordType({ recordType: "msp_poams", ... })`. Confirmed live:
   ```
   grep -rln "registerRetainedRecordType" --include=*.ts .
   ./artifacts/api-server/src/lib/retention/registry.ts        (definition)
   ./artifacts/api-server/src/lib/retention/wiring/msp-poams.ts (a real caller)
   ```
   `registerPoamRetention()` is imported for its registration side effect from both
   `routes/msp-poams.ts` and `routes/portal-poams.ts` (either import alone is sufficient; the
   registries are process-wide singletons).
2. **Real routes call `softDelete()` and `requestAcceleration()`.** Confirmed live at the exact
   call sites:
   ```
   artifacts/api-server/src/routes/msp-poams.ts:695      softDelete({ ... })
   artifacts/api-server/src/routes/portal-poams.ts:644   softDelete({ ... })
   artifacts/api-server/src/routes/portal-poams.ts:721   requestAcceleration({ ... })
   ```
   The customer-portal "request early purge" route (`portal-poams.ts:721`) is the real producer
   for this queue: a customer soft-deletes a POA&M, then asks for it purged early, and that
   request is what would land as a `record_deletions` row with `acceleration_state: "pending"`.
3. **Confirmed live**: local Postgres `record_deletions` still has **0 rows**, queried directly
   (`SELECT count(*) FROM record_deletions` → `0`, re-confirmed 2026-09-13). This is now an
   honest "hasn't happened yet in this environment" empty state, not a structural impossibility —
   no customer has actually run a POA&M through soft-delete + accelerated-purge-request locally.

**Concrete, current consequences for this route's own three endpoints:**

- `GET /api/msp/retention/queue` returns `{ queue: [], total: 0 }` against local dev today — a
  real, honest empty state (§6) that *can* become non-empty the moment a customer soft-deletes a
  POA&M and requests early purge through `portal-poams.ts`.
- `POST .../decide` and `POST .../discuss` will **404** for any `deletionId` today, simply because
  no row exists yet — not because the record-class lookup would fail. For a pending row whose
  `recordType` is `"msp_poams"`, approving it (`decideAcceleration({ approve: true })` →
  `purgeNow()` → `requireRetainedRecordType("msp_poams")`) and restoring it (`discuss` → `restore()`
  → the same lookup) both now **succeed**, because `"msp_poams"` is a registered type.
- The failure mode described in the prior version of this section — `requireRetainedRecordType()`
  throwing for *any* `recordType`, surfaced only as a generic uninformative `500` — is now real
  only for a `recordType` other than `"msp_poams"` (e.g. a hand-inserted test row using
  `"msp_risk_decisions"`, which remains unregistered). That is no longer "the only possible
  outcome" — it's "the outcome for an unregistered type," a materially different and much
  narrower claim.

This was never a defect in `msp-retention-queue.ts` — the route correctly implements the contract
`lifecycle.ts` exposes. What changed is platform *adoption*: one product module (POA&Ms, Git
#3451) has now actually plugged a record type and real callers into the retention mechanism, so
this operator surface has something it can genuinely operate on — it just hasn't yet, in this
environment. Other record classes (e.g. `msp_risk_decisions`) remain unregistered and would still
hit the original failure mode if a row for one were ever manually inserted. Tracked as #3909
(sibling under #1571, no Feature-tier parent), listed in this build's DONE bookend.

---

## 5. Real enum unions

- **Deletion stage** — `record_deletions.stage`: `"soft" | "semi_hard" | "purged" | "restored"`
  (`RETENTION_STAGES`, `retention.ts:115`). Text column, no DB `CHECK`. This route's queue rows are
  only ever `"soft"`/`"semi_hard"` in practice (see §1).
- **Delete side** — `record_deletions.deleted_by_side`: `"customer" | "operator" | "system"`
  (`RETENTION_DELETE_SIDES`, `retention.ts:119`).
- **Acceleration state** — `record_deletions.acceleration_state`: `"none" | "pending" | "approved"
  | "declined"` (`RETENTION_ACCELERATION_STATES`, `retention.ts:127`). This route's `GET` only
  ever surfaces `"pending"` rows; `decide` moves a row to `"approved"` or `"declined"`.
- **Acceleration reason kind** — `record_deletions.acceleration_reason_kind`: `"superseded_by" |
  "no_longer_needed"` (`RETENTION_ACCELERATION_REASONS`, `retention.ts:136`).
- **Record type** — `record_deletions.record_type` is free `text`, no DB-level enum, "conventionally
  its real table name" (`retention.ts:287`). Real, current vocabulary is whatever
  `registerRetainedRecordType()` has been called with — as of #3451, that's **`"msp_poams"`** (§4),
  the one real registered type. There is, as of this pack, still no live example of a real
  `recordType` value actually flowing through this route's DB rows (`record_deletions` remains 0
  rows, §4/§6), but the value it would carry if one appeared today is a confirmed live constant
  (`msp-poams.ts:26`), not merely illustrative; the test file's own fixture
  (`"msp_risk_decisions"`, `msp-retention-queue.test.ts:118`) remains unregistered and would still
  fail record-class lookup.
- **MSP role floor for these 3 routes** — `requireRole("MSPOperator")` admits MSPOperator,
  MSPAdmin, PlatformAdmin, via the #2458 RBAC ladder evaluator (§1) rather than a raw array-index
  comparison, though the allow set is unchanged.

---

## 6. Honest-empty / partial-data contract

- **`queue`**: a genuinely empty result is a real `[]` — no fixture branch exists in this router.
  Confirmed against local Postgres: `record_deletions` is **0 rows** in the local dev DB right
  now, so a real call against local dev returns a real, honestly-empty queue — not a fixture. See
  §4: this is a today-there's-no-data state, not a structural impossibility — the `msp_poams`
  record class and its callers are real and reachable, no customer has just exercised them here.
- **`total`**: always exactly `queue.length` — there is no separate "how many total exist across
  every stage/state" count; a `total: 0` here says only "zero pending accelerations," not "zero
  deletions of any kind" for the MSP.
- **A scoped staff member with no assigned customers reaching for a queue item**: 404s, not a
  403 and not the unscoped book — same honest-absence discipline the customer-timeline pack (§5)
  and the diagnostics pack document for their own scoped routes.
- **A `500`** on any of the three routes is a real DB/lifecycle failure, always distinguishable
  from the honest-empty/404 paths above by status code and by the fixed, generic error strings
  quoted in §§1-2 — a caller cannot mistake one for the other.

---

## 7. Cross-surface edges

- **vs. `lifecycle.ts`'s other write paths (`softDelete`, `requestAcceleration`)**: this route
  touches only the **read** and **decide/restore** ends of the lifecycle — it is the operator's
  half of a loop whose customer/system half (delete, request acceleration) now has a real caller,
  `portal-poams.ts` (§4, Git #3451). This route required no change to start actually serving real
  rows once that landed — it was built ahead of its own inputs existing, which is explicit in the
  file's own header comment. It just hasn't served a non-empty result yet in this environment,
  because no customer has exercised the POA&M soft-delete + accelerated-purge-request path here.
- **vs. `msp-alerts.ts` / `msp-customer-timeline.ts`** (sibling cross-tenant MSP-operator
  surfaces): same `requireRole("MSPOperator")` + `resolveMspIdStrict` +
  `resolveStaffScopedCustomerIds` shape (this file's own header names `msp-alerts.ts` as the
  pattern it followed), but neither of those surfaces has any awareness of the retention queue —
  an operator with 15 pending acceleration requests sees nothing about them on either surface.
  Not a bug (different, stated purposes) but worth Design knowing if a unified operator "needs
  attention" view is ever built.
- **vs. the platform subscription gate** (`subscription-gate.ts`, mounted `app.ts:127` ahead of
  all routing): `gatedTenantIdFor()` returns `null` for any principal whose effective role is in
  `OPERATOR_ROLES` (`subscription-gate.ts:158`), so an MSP-operator caller is structurally
  exempt from the gate regardless of any customer's lapsed subscription — confirmed by reading
  the gate's own decision function, not inferred. This route's `requireRole("MSPOperator")` floor
  guarantees every caller who reaches it is such a principal.
- **vs. `RetentionActor.role`** (§2): every caller of this route — MSPOperator or MSPAdmin —
  collapses to the same `role: "admin"` on the audit trail (`createAuditLog` calls inside
  `decideAcceleration`/`restore`) and the customer-facing restore notification. An MSP's own
  finer-grained staff role distinction is invisible past this point in the pipeline.

---

## Orphaned-endpoint check

```
grep -rn "retention/queue\|msp-retention-queue" artifacts/ --include=*.ts --include=*.tsx | grep -v '\.test\.ts'
```

**Superseded 2026-09-13 (#3909).** This section originally reported no frontend caller anywhere in
the tree. That's now stale: `artifacts/msp-console/src/api/retention-api.ts` calls all three
routes, and `artifacts/msp-console/src/modules/retention/RetentionQueue.tsx` (Git #3817, mounted
by `ConsoleShell` at `/ops/retention`) is a real, shipped MSP-console page that renders them. The
endpoint is real, live, mounted (`app.ts:127` → `routes/index.ts:560`), and now genuinely
exercised by a real UI — it just has nothing to show yet in this environment, per §4, because
`record_deletions` is still 0 rows locally.

---

## Not covered by this pack

Per the #1642 pattern, no page/UI-shape decisions are made here. This pack extracts what exists on
the 3 routes as built; it does not decide what an MSP-console Retention Queue page should look
like, nor does it design the (still entirely separate, still unbuilt) product work of actually
wiring a module's deletes through `softDelete()`/`requestAcceleration()` — that is §4's filed
finding's own scope, not this pack's.
