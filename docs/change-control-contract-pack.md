# Change Control — Contract Extraction Pack

**Module:** Change Control (`#1486`, part of `#1485` EPIC: Portal New Design)
**Regenerated:** 2026-09-06, per `#2989` — the previous pack (`020d46dcb`, 2026-08-29) was deleted under
`9f24302c0` on 2026-09-03 because real backend work (#1496–#1506's remaining sub-issues, #1554,
#1555, #1759, #1761, #1762) landed after it was written, making it describe dead architecture. This
is a **full re-extraction against the current, real code**, not a restoration of that file's content
— follows the `#1642` pattern, same as `docs/microsoft-changes-contract-pack.md`.

**Status of this document:** extracted, not authored. Every field below is cited to `file:line`.
Nothing here is invented; where a value does not exist in code it is marked **OPEN GAP**, not
filled in.

## 0. How to read this pack

| Marker | Meaning |
|---|---|
| **CURRENT** | The field/behaviour exists and serves real data today. Design draws against it as-is. |
| **DECIDED** | The architecture is settled in an issue but **not built**. Design may draw the target, but must know it is not wired. Every DECIDED row carries its issue number. |
| **OPEN GAP** | Wanted, but **no issue decides it yet**. Not decided. Do not design a finished answer for it. |
| **MSP-ONLY** | Real, live, and finished — but an MSP-console surface, not exposed to the customer portal. Out of this module's design scope; noted for completeness. |

**What changed since the last pack (headline):** the module went from 2 routes (`GET`/`POST` on the
register only, everything after create dead) to **11 real customer-portal routes** plus a **3-route
customer settings surface**. Nearly every row that was **DECIDED** in the old pack is now
**CURRENT**. Only #1502 (PIR/close codes) shipped as an MSP-console-only surface with no customer
route — correctly so, per its own scope. Three real gaps were found during this re-extraction and
filed as new issues (§14).

**Source of truth for shapes:** the routes' own `Wire*` interfaces, not the design fixtures.
Primary sources:
- Register + approve/reject/decline/timeline/metrics route:
  `artifacts/api-server/src/routes/portal-change-control.ts` (1470 lines; `WireChangeRequest` at
  **:174–275**).
- Standard change catalog route: `artifacts/api-server/src/routes/portal-change-catalog.ts`.
- Customer settings route: `artifacts/api-server/src/routes/portal-settings-change-control.ts`.
- Pure derivations: `artifacts/api-server/src/lib/portal-change-control.ts`.
- Stored rows + enums: `lib/db/src/schema/msp.ts` (`mspChangeRequestsTable` at **:4601**, plus 13
  more Change-Control tables — full map in §13).
- Client seam: `artifacts/portal/src/components/settingsChangeControlWire.ts` and
  `settingsChangeControlLive.ts`. **Note the path correction**: the module lives at
  `artifacts/portal`, not `artifacts/msp-portal` (which does not exist in this repo) — the old
  pack's Appendix and this issue's own body both point at the wrong package name.

---

## 1. The live surface — all 14 customer-portal routes

All under `artifacts/api-server/src/routes/portal-change-control.ts` unless noted. Gating is
`requireRole("CustomerUser")` + `requireAddOnEntitlement(CHANGE_CONTROL_FEATURE_KEY)`
(`CHANGE_CONTROL_FEATURE_KEY = "change_control"`, `portal-change-control.ts:483`) for every read
and every action route, with the sole exception of the register's own `POST` (raise), which is
"creation unconditional, gate visibility only" (`:76–81`) — every real change produces a real CR
regardless of add-on entitlement.

| # | Method | Path | Role floor | Entitlement | State | Line |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/portal/change-control` | `CustomerUser` | `change_control` | **CURRENT** | :507 |
| 2 | POST | `/api/portal/change-control` | `Assessment` | none (unconditional) | **CURRENT** | :679 |
| 3 | GET | `/api/portal/change-control/freeze-windows` | `CustomerUser` | `change_control` | **CURRENT** (#1500) | :770 |
| 4 | GET | `/api/portal/change-control/maintenance-windows` | `CustomerUser` | `change_control` | **CURRENT** (#1504) | :850 |
| 5 | POST | `/api/portal/change-control/:code/decline` | `CustomerUser` | `change_control` | **CURRENT** (#1534/#1514) | :915 |
| 6 | POST | `/api/portal/change-control/:code/approve` | `CustomerUser` + live `canApproveChanges` | `change_control` | **CURRENT** (#1496) | :1056 |
| 7 | POST | `/api/portal/change-control/:code/reject` | `CustomerUser` + live `canApproveChanges` | `change_control` | **CURRENT** (#1496) | :1108 |
| 8 | GET | `/api/portal/change-control/:code/timeline` | `CustomerUser` | `change_control` | **CURRENT** (#1503) | :1208 |
| 9 | POST | `/api/portal/change-control/:code/comments` | `CustomerUser` | `change_control` | **CURRENT** (#1503) | :1279 |
| 10 | POST | `/api/portal/change-control/:code/attachments` | `CustomerUser` | `change_control` | **CURRENT** (#1503) | :1339 |
| 11 | GET | `/api/portal/change-control/metrics` | `CustomerUser` | `change_control` | **CURRENT** (#1506) | :1446 |
| 12 | GET | `/api/portal/change-catalog` | `CustomerUser` | `change_control` | **CURRENT** (#1498) | catalog.ts:60 |
| 13 | POST | `/api/portal/change-catalog/:id/execute` | `CustomerUser` | `change_control` | **CURRENT** (#1498), see §14 finding #3044 | catalog.ts:108 |
| 14 | POST | `/api/portal/remediation/checklist/:checkKey/raise-change` | `CustomerUser` (assumed same floor as the checklist route) | — | **CURRENT** (Finding→CR edge) | portal-remediation-checklist.ts:239 |

**Customer settings** (separate surface, not the register — see §10):

| Method | Path | Role floor | State |
|---|---|---|---|
| GET | `/api/portal/settings/change-control` | `CustomerUser` | **CURRENT** |
| PUT | `/api/portal/settings/change-control/policy` | `CustomerUser` | **CURRENT** |
| PUT | `/api/portal/settings/change-control/notifications/:eventKey` | `CustomerUser` | **CURRENT** |

**Scoping (CURRENT, `portal-change-control.ts:17–47`)** — unchanged model from the old pack, still
the single most load-bearing piece of the file. The JWT `customerId` claim is a `tenants.id`. It is
resolved via `resolveTenantScope` (aliased `resolveScope`, `:172`) to `(tenants.mspId,
tenants.tenantId)`, and every query filters on **both** — `mspId` alone is MSP-wide, `tenantId`
alone trusts an unconstrained free-text column (`msp_change_requests.tenant_id` has no FK, no
unique constraint; live data has two different synthetic conventions, `'t-contoso'` vs
`'contoso-01'`, cited at `:34–36`). A **blank** tenant identifier fails closed — `resolveScope`
returns `null`, and handlers answer with an empty/blocked result rather than a query
(`:41–47`, the file's own "single most important line" comment). Every actual DB read/write
additionally applies `and(eq(mspId, scope.mspId), eq(tenantId, scope.tenantId))` at the query site,
not centralized (e.g. `:563–568`, `:946–955`, `:1021–1027`).

**Fail-closed-scope behavior is not uniform across the 11 register-file routes** — a real,
deliberate split, not an inconsistency to fix:
- Register GET, freeze GET, maintenance GET → `200` with an empty/zero payload and `scoped: false`
  (register only) or `{ windows: [] }` (freeze/maintenance, no `scoped` flag at all).
- Decline, approve, reject, timeline GET, comments POST, attachments POST, metrics GET → `409
  {"error": "This account has no connected Microsoft 365 tenant"}`.
- `customerId === null` (no customer identity on the JWT at all — a distinct, earlier check from
  "no resolvable scope") is `403 {"error": "No customer identity on token"}` on every route.

**Role-floor note (`:49–65`):** the role floor decides which **tier** of customer may open the
page — it is explicitly *not* what prevents a cross-tenant read; the JWT-derived scope above does
that, identically regardless of role floor.

---

## 2. `GET /api/portal/change-control` — register + stats

### 2.1 Envelope

`{ requests: WireChangeRequest[], stats: <object, §2.3>, scoped: boolean }` — `:525` (unscoped),
`:611` (scoped).

Server-side reads per call: the CR rows (`:529–569`), all `cr_approvals` for those CRs
(`:576–589`), and — in parallel (`:594–599`) — `callerCanApproveChanges(req)`,
`loadApprovalPolicy(customerId)` (#1759), and `dependencyEdgesForMany(crIds, scope.mspId)` (#1504).

### 2.2 `WireChangeRequest` — one change request, full field list

Declared `portal-change-control.ts:174–275` ("Deliberately narrower than the row," `:174`).
**35 fields** — more than triple the old pack's 18.

| Field | Type | Null? | Marker | Source |
|---|---|---|---|---|
| `code` | `string` | no | **CURRENT** | `formatChangeRequestCode(id)` = `` `CR-2026-${100+id}` `` (lib:411–413) |
| `title` | `string` | no | **CURRENT** | `row.title` |
| `changeClass` | `"Standard"\|"Normal"\|"Emergency"` | no | **CURRENT** | `displayChangeClass` (lib:178–187) |
| `status` | `ChangeRequestDisplayStatus` (7 labels) | no | **CURRENT** | `displayStatus(status, approvedBy)` (lib:149–172). `Approved` is still derived, not stored — `pending_approval` + non-blank `approvedBy` |
| `workload` | `string` (8-value union) | no | **CURRENT** | `workloadForCategory` (lib:136–138), unknown category falls back to `"Identity"` |
| `target` | `string` | no | **CURRENT** | `row.targetResource` |
| `ticket` | `string` | no | **CURRENT** | `row.psaTicketId` |
| `requester` | `string` | no | **CURRENT** | `row.requestedBy` |
| `window` | `string` | no | **CURRENT (free text)** | `row.scheduledFor` — still prose, cannot be date-ordered alone |
| `scheduledStart` | `string \| null` (ISO) | yes | **CURRENT** — new since old pack | `row.scheduledStart?.toISOString()` (#1762) |
| `scheduledEnd` | `string \| null` (ISO) | yes | **CURRENT** — new since old pack | `row.scheduledEnd?.toISOString()` (#1762) |
| `risk` | `"Low"\|"Medium"\|"High"\|"Critical"` | no | **CURRENT** | `displayRiskLevel` (lib:258–269); server recomputes on create, client value ignored |
| `impactedUsersCount` | `number` | no | **CURRENT** | `row.impactedUsersCount` |
| `rationale` | `string` | no | **CURRENT** | `row.description` |
| `pre` | `string` | no | **CURRENT (may be `{}`)** | `formatSnapshotJson(preChangeSnapshot)` |
| `post` | `string` | no | **CURRENT (may be `{}`)** | `formatSnapshotJson(proposedPayload)` |
| `approvals` | `readonly string[]` | no | **CURRENT** | `approvalLines(...)` (lib:437–449) — display-only summary lines; the real ledger is `approvalRecords` below |
| `canApprove` | `boolean` | no | **CURRENT (show-flag)** | `status === "Pending approval"` (lib:485–487) |
| `canRollback` | `boolean` | no | **CURRENT (show-flag, no mutation exists)** | `status === "Implemented"` (lib:489–491) — still no `/rollback` HTTP endpoint anywhere |
| `executedAt` | `string \| null` | yes | **CURRENT (free text)** | `row.executedAt` — still nullable free text, no `cr_executions` join here (execution detail is MSP-console-only, §8) |
| `backupVerified` | `boolean` | no | **CURRENT** | portal creates write `false`, never the MSP route's fabricated hash |
| `linkedFinding` | `string \| null` | yes | **CURRENT (free text, still no FK)** | `row.linkedFinding` — deliberately loose, "a finding is not one row in one table" |
| `remediationCheckKey` | `string \| null` | yes | **CURRENT** — new since old pack | `row.remediationCheckKey` (#1541); the real Finding→CR edge, see §9 |
| `intake` | `string \| null` | yes | **CURRENT** — new since old pack | `displayIntake(row.intake)` (lib:216–227); `null` for every wizard-/drift-raised CR |
| `implementer` | `string \| null` | yes | **CURRENT** — new since old pack | `displayImplementer(row.implementer)` (lib:235–246) |
| `sourceGraphMessageId` | `string \| null` | yes | **CURRENT** | `row.sourceGraphMessageId` — loose text, no FK |
| `sourceInterpretationId` | `number \| null` | yes | **CURRENT, real FK** | `row.sourceInterpretationId` → `m365_change_interpretations.id` (converted from loose int under #1505) |
| `sourceResolutionId` | `number \| null` | yes | **CURRENT, real FK** | → `m365_change_resolutions.id` (#1505) |
| `linkedHoldWindowId` | `number \| null` | yes | **CURRENT, real FK** | → `portal_hold_windows.id` (#1505) |
| `executorRunId` | `number \| null` | yes | **CURRENT (loose int, deliberate)** | soft link to `wf_runs.id`, "the same discipline `tenant_id` follows" — the #1497 write-gate binding |
| `createdAt` | `string` (ISO) | no | **CURRENT** | `row.createdAt.toISOString()` |
| `approvalRecords` | `readonly WireApprovalRecord[]` | no (may be `[]`) | **CURRENT** — new, #1496 | full per-stage ledger, see §4.2 |
| `approvalState` | `ApprovalState` | no | **CURRENT** — new, #1496 | `summarizeApprovals(approvals, required, now)`, see §4.1 |
| `canApproveNow` | `boolean` | no | **CURRENT (real gate, not a show-flag)** | see formula below — this is the one flag with an actual live mutation behind it |
| `blockedBy` | `readonly WireDependencyRef[]` | no (may be `[]`) | **CURRENT** — new, #1504 | `{code, status}` per unresolved blocker; `status` is the RAW stored status, not display-formatted (the store doesn't load the other side's `approvedBy`) |
| `blocks` | `readonly WireDependencyRef[]` | no (may be `[]`) | **CURRENT** — new, #1504 | same shape, inverse direction |

**`canApproveNow` formula** (`:346–354`):
```
requesterEmail = (row.requestedBy ?? "").trim().toLowerCase()
isRequester = requesterEmail.length > 0 && requesterEmail === callerEmail.trim().toLowerCase()
blockedAsRequester = requireSeparateApprover && isRequester   // #1759 tenant policy
canApproveNow = callerCanApprove && approvalState.nextStage !== null && !approvalState.rejectedTerminal && !blockedAsRequester
```
The store re-checks all of this server-side on the actual `/approve` call; this field only decides
whether the client shows the affordance.

**Absent from the wire on purpose, unchanged from the old pack:** `rollbackScriptSnippet` — stored,
never serialized (`:100–102`, "a stored rollback command is the last field to ship to a browser out
of habit"). There is still no `/rollback` mutation endpoint of any kind on the customer portal.

**⚠ Stale header, worth knowing before reading the file directly:** the route file's own header
(`:83–101`) and the lib file's doc comment on `canApprove`/`canRollback` (lib:475–484) both still say
"no approve, no reject, no rollback... the route exposes no approve/reject/rollback mutation" — this
was true when written, but is **contradicted by the same file's own `/approve`, `/reject`, and
`/decline` routes added later** (routes #5, #6, #7 in §1). Read the routes, not the header, for
current truth. (Not filed as a separate issue — noted here as the fix; see the pack's own §14 for
what *was* filed.)

### 2.3 `WireChangeControlStats`

`buildStats`, `:414–480`. **8 fields**, one new since the old pack (`nextWindowDateOrdered`):

| Field | Marker | Source |
|---|---|---|
| `open` | **CURRENT** | count of `OPEN_DISPLAY_STATUSES` (Pending approval, Approved, Scheduled, In window) |
| `awaitingApproval` | **CURRENT** | count `status === "Pending approval"` |
| `nextWindowCount` | **CURRENT (dual-path)** | see below |
| `nextWindowLabel` | **CURRENT** | see below |
| `nextWindowDateOrdered` | **CURRENT — new since old pack** | `true` iff computed from real `scheduledStart` instants (#1762), `false` if fallen back to free-text grouping |
| `emergencyCount` | **CURRENT** | Emergency changes within `EMERGENCY_LOOKBACK_DAYS` (90), measured off `createdAt` |
| `emergencyLookbackDays` | **CURRENT const** = 90 | |
| `snapshotsHeld` | **CURRENT (substitute metric)** | executed rows within `SNAPSHOT_RETENTION_DAYS` (90), off `createdAt` since `executedAt` is free text |
| `snapshotRetentionDays` | **CURRENT const** = 90 | |

**`nextWindow*` dual-path logic (`:418–450`, order load-bearing):**
1. If any open CR has a real `scheduledStart >= now` (#1762 real-instant path): group by the exact
   earliest instant, `nextWindowDateOrdered: true`.
2. Else, fall back to grouping **open** CRs by trimmed free-text `window` string (the pre-#1762
   behavior), `nextWindowDateOrdered: false`.

---

## 3. `POST /api/portal/change-control` — raise a new change request

Zod `createSchema` (`:626–656`), unchanged core fields from the old pack plus three new optional
ones:

| Field | Type | Required | Note |
|---|---|---|---|
| `title` | string 1–200 | yes | |
| `target` | string 1–500 | yes | |
| `ticket` | string ≤120 | no | |
| `pre` | string ≤20 000 | no | |
| `post` | string 1–20 000 | yes | |
| `changeClass` | `"Standard"\|"Normal"\|"Emergency"` | yes | |
| `impactedUsersCount` | int 0–10 000 000 | yes | |
| `window` | string 1–200 | yes | |
| `scheduledStart` / `scheduledEnd` | ISO datetime (offset required) | no | **new, #1762** — `.refine()` requires `scheduledEnd > scheduledStart` when both present |
| `freezeException` | `{ justification: string 1–2000 }` | no | **new, #1500** — the *only* way through an active freeze |
| `remediationCheckKey` | string 1–200 | no | **new, #1541** — comment notes "nothing in this codebase sends it yet" *at the route-schema level*; it IS sent today by the real raise-from-remediation route (§9) |

**Computed server-side, never accepted from the body** (`:696–699`, delegated into
`raiseChangeRequest`, `lib/portal-change-control-raise.ts:114–310`): `risk` (`computeRiskLevel`),
`workload` (`deriveWorkload`), `status` always `pending_approval`, tenant scope from resolved scope
(not the body), `requestedBy` from JWT email, `backupVerified: false` + empty hash.

**Real server-side gate sequence inside `raiseChangeRequest`** (new since the old pack — none of
this existed when the register was 2 routes):
1. **Freeze check** (`raise.ts:142–165`), policy-gated (`portal_change_control_policy.enforceFreezeCalendar`)
   — `activeFreezeForSubmit` (is a freeze active *now*) and, if `scheduledStart` given,
   `freezeForBookedWindow` (does the booked span overlap one). Hard `409` unless a
   `freezeException` was supplied, in which case the CR is created anyway and an *additional*
   MSP-only approval stage is appended (`portal-change-freeze-store.ts:80–125`).
2. **Maintenance-window check** (`raise.ts:169–180`), policy-gated
   (`enforceMaintenanceWindows`), only when `scheduledStart` is present —
   `maintenanceCoverageForBookedSpan` requires the booked span be **fully contained** in an active
   window (strictly stronger than freeze's overlap test). No exception path exists; `409
   {maintenanceWindowRequired: true}` with no way through except an MSP-defined covering window.
3. **Collision check** (`raise.ts:182–201`), unconditional (not policy-gated) — `targetResource`
   equality (case-insensitive) + span overlap against other open CRs. `409 {collidesWith: <code>}`.
4. Insert, `raised` timeline event, approval materialization (§4.1), optional freeze-exception
   stage, and — when `remediationCheckKey` is set — risk discharge (§9).

**Response:** `201 <raiseChangeRequest() result>`. `RaiseChangeRequestError` maps to
`res.status(err.status).json({error, ...err.body})`.

---

## 4. Approval, rejection, decline — the #1496/#1514 model, now fully built

### 4.1 Approval model

- **Capability flag:** `users.canApproveChanges` (boolean). MSP staff/PlatformAdmin bypass by role;
  everyone else needs the DB flag `true`. Checked live via `callerCanApproveChanges(req)`
  (`:491–504`) — **never trusted from the JWT**.
- **Required stages** (`requiredStages`, `portal-change-approvals.ts:63–71`):
  `standard → 0` (pre-approved, no human stage) · `emergency → 1` · `normal` + low/medium `→ 1` ·
  `normal` + high/critical `→ 2`. Tenant policy (`portal_change_control_policy.requiredSignatures`,
  #1759) can only **raise** this floor via `Math.max(policy, riskDerived)`.
- **Stage model is quorum-1 today** — the `cr_approvals` schema can hold true quorum (multiple rows
  per stage) but nothing populates more than one row per stage yet (schema comment,
  `msp.ts:5049–5053`). **OPEN GAP**, no issue owns widening this.
- **Separation of duties** (`violatesSeparationOfDuties`, case-insensitive email compare) — enforced
  in `recordApproval` when tenant policy `requireSeparateApprover` is on (default `true`), and in
  `recordRejection` **only when the approver's role is `"customer"`** — an MSP self-rejection is
  never subject to it (by design; see §4.3).
- **Freeze-exception stages are a stricter, separate bar**: a stage created because a CR was raised
  inside an active freeze (`cr_approvals.freezeWindowId` non-null) can only be
  decided by `approverRole === "msp"`, overriding ordinary separation-of-duties.
- **Delegation:** `portal_ownership_delegations` → `resolveDelegatedAuthority`; recorded as
  `onBehalfOfPersonId`, "never used to bypass separation of duties."
- **SLA:** `slaDaysFor` — standard=none, emergency=1, critical=1, high=2, medium=5, low=7 days.
  `dueAt` stamped at creation. **`escalateBreachedApprovals()` exists and is unit-tested but has
  zero live callers anywhere in the codebase — filed as #3046** (§14).

### 4.2 `WireApprovalRecord` — the real per-stage ledger

Backing table `cr_approvals` (`msp.ts:5036`). `toWireApproval(a, now)` populates
`WireChangeRequest.approvalRecords[]` (route `:174` area, type from `portal-change-approvals.ts`).
Real enum: `decision: "pending"|"approved"|"rejected"|"superseded"`,
`approverRole: "customer"|"msp"|"catalog_inherited"|"microsoft_forced"`.

### 4.3 Rejection — the two-terminal-state model, confirmed implemented

`recordRejection()` (`portal-change-rejection.ts:43–182`), branch that decides terminal state
(`:137–175`):

- **Routed change (`sourceKind === "microsoft_change"`), any rejector** → delegates to
  `declineRoutedChangeToRisk()` (`m365-change-router.ts:656–727`), which itself forks:
  - MSP declines → CR `rejected`, routing ledger `declined_risk`, **no risk record** (#1514).
  - Customer declines → `createAcceptedRiskFromDecline()` creates the risk.
- **Non-routed change, customer rejects** → `createAssignedRiskFromRejection()`
  (`:212–278`) inserts an `msp_risk_decisions` row, `riskStatus: "Accepted"`,
  `spawnedByChangeRequestId: cr.id` — the risk becomes the customer's.
- **Non-routed change, MSP rejects its own proposed change** → status flips to `rejected`, **no
  risk record created** (the `if (approver.role === "customer")` guard at `:172` is false) — the
  finding stays open, unremediated and unaccepted, exactly as #1486 describes.

This model is consistently applied on both the routed and non-routed customer-facing paths. The
MSP-console's own generic `PATCH /msp/change-requests/:id` (`msp-changes.ts:341+`) can also set
`status: "rejected"` directly, bypassing this file entirely — but its own code comment
(`:386–388`) confirms this is intentional, not an oversight: "rejecting never required an approval
to begin with," and since that endpoint's rejections are always MSP-actor, the "no risk created"
outcome is the *same* terminal state this file would produce for an MSP rejection anyway. Not a
gap; noted for completeness only.

### 4.4 Decline — the Microsoft-routed path (#1534/#1514)

`POST .../:code/decline` — **only** for `sourceKind === "microsoft_change"` CRs (`409` otherwise,
"a wizard-raised CR has no risk-acceptance semantics"). Body `{fullName, statement}`. Delegates to
`declineRoutedChangeToRisk`. Distinct from `/reject`, which is the general #1496 ledger path.

---

## 5. Write-gate (#1497) — fail-closed authorization on the write path

`change-control-write-gate.ts:101–143`, `evaluateChangeRequestAuthorization()` — starts from "no,"
every branch that is not an unambiguous "yes" returns `authorized: false`. Order:

1. CR not found → not authorized
2. status is terminal (`completed`/`rolled_back`/`rejected`) → not authorized
3. `executorRunId !== null` (already consumed) → not authorized
4. status not claimable (`pending_approval`/`scheduled`) → not authorized
5. **`!approvalComplete`** (the actual "approved CR required" check, folding `requiredStages`/
   `summarizeApprovals`) → not authorized
6. unresolved `blocked_by` dependency (#1504) → not authorized
7. `authorizedTargetKey` mismatch (CR scoped to a specific pack/SOP, #1773) → not authorized
8. else → `authorized: true`

`claimChangeRequestForWrite()` does an **atomic** UPDATE gated on
`status IN (pending_approval, scheduled) AND executor_run_id IS NULL` — 0 rows updated means a
race, and the caller treats that as failure. This makes `execute_write_pack`
(`artifacts/mcp-server/src/tools/execute-write-pack.ts:163–174`, requires `changeRequestId` for any
non-`planOnly` call) and every SOP-execution write **fail-closed on no approved CR**, exactly the
inversion #1486 called for.

Companions: `bindChangeRequestToRun`, `releaseChangeRequestClaim`, and
`settleAuthorizedChangeRequests()` (the reconciliation sweep, scheduled from `index.ts:236–238` —
this one IS wired, unlike `escalateBreachedApprovals`).

**Callers confirmed:** `admin-config-pack-run.ts:139` (backing the MCP `execute_write_pack` tool),
`sop-execution.ts:266,302`.

---

## 6. Risk discharge — the durable-object half of the architecture

`dischargeRisksForNewChangeRequest()` (`change-request-risk-discharge.ts:76–104`) — an `UPDATE
msp_risk_decisions SET dischargedByChangeRequestId = <new CR>, riskStatus = 'Closed' WHERE (mspId,
tenantId, checkKey) AND status = 'active' AND dischargedByChangeRequestId IS NULL`. Fires **at
capture time** (the moment a fresh CR with a matching `remediationCheckKey` exists), not once
anything executes. `isNull(dischargedByChangeRequestId)` doubles as the "not already discharged"
filter and the concurrency guard against two racing CRs. Wired from `POST /portal/change-control`.
Confirms #1486's "CRs are short-lived; the risk is the durable object... discharged by a fresh CR
that supersedes it" is real, not aspirational.

---

## 7. Standard change catalog (#1498)

- **GET `/api/portal/change-catalog`** — `{ items: [{id, title, description, category, riskLevel,
  approvedByName, approvedAt}], scoped }`. Only `status = "approved"` rows for the caller's own
  `mspId`. No resolvable scope → `{items: [], scoped: false}`, not an error.
- **POST `/api/portal/change-catalog/:id/execute`** — raises a `changeClass: "standard"` CR with
  `approvedBy: item.approvedByName` (**never** "the system," per #1486's architecture decision),
  `requiredStages() = 0`. `201 {code, catalogItemId, title}`.
- **Revocation is checked live, every call** (#1555) — `execute` re-reads `status` from the DB on
  every invocation; no cached/JWT-carried "pre-approved" flag. Revocation blocks only *future*
  executions — nothing retroactive to CRs already raised.
- **⚠ Real gap found this session, filed as #3044** (§14): `execute` inserts the CR directly
  (`portal-change-catalog.ts:162–193`) and **skips the freeze/maintenance/collision checks** that
  the ordinary `raiseChangeRequest` path runs (§3). A standard change can execute during an active
  freeze window with zero enforcement.
- **MSP-side (out of scope, noted):** `msp-change-catalog.ts` — author draft (`POST
  /api/msp/change-catalog`), approve (`POST .../:id/approve`), revoke (`POST .../:id/revoke`), all
  `MSPAdmin`/`MSPOperator`.

**Enum:** `CHANGE_CATALOG_ITEM_STATUS = ["draft","approved","revoked"]` (`msp.ts:5369`).

---

## 8. Execution, CAB, PIR — confirmed MSP-console-only, no customer surface

All three are **real, finished, and MSP-only by explicit design** — each route file's own header
says "There is no UI to wire: `artifacts/portal` has no pages and `Design/portal/` carries no export
for this surface." Verified negatively: no `portal-*.ts` route imports any of these stores.

| Capability | Table(s) | MSP route | Customer route |
|---|---|---|---|
| Execution record, planned-vs-actual, rollback-as-inverse-CR (#1499) | `cr_executions` | `msp-change-executions.ts` — 6 endpoints under `/api/msp/change-control/...` | **none** |
| CAB — membership, meetings, agenda, ECAB (#1501) | `cab_members`, `cab_meetings`, `cab_agenda_items` | `msp-change-control-cab.ts` — full CRUD | **none** |
| PIR / close codes (#1502) | `cr_pirs` | `msp-change-pir.ts` — POST/GET `.../executions/:id/pir`, GET `.../pirs` | **none** |

**Close codes, real and shipped** (correcting #1502's stale still-open framing found elsewhere):
`CR_PIR_CLOSE_CODES = ["successful","successful_with_issues","failed","rolled_back"]`
(`msp.ts:5278`), column `cr_pirs.closeCode` (`msp.ts:5307`). One PIR per execution (real FK +
UNIQUE), append-only. Drift re-scan on close is real but scoped: `categoryHasDriftRescanPath`
restricts it to `category === "ConditionalAccess"` only; every other category is honestly
`drift_rescan_status: "not_applicable"`, never a fabricated clean result.

**crRef writeback — two separate mechanisms, do not conflate:**
- `cr_executions.crRef` — written by `settleChangeExecutions` when a bound `wf_run` completes, or at
  attest time for a human action. Scoped to `cr_executions`, not `drift_events`.
- `drift_events.crRef` — written by `buildCaChangeRequestAttribution`
  (`monitor-executor.ts:135–170`), triggered from a monitor scan, looking for the most recent
  `completed` CR in category `ConditionalAccess` within a 30-day window. **Never reads
  `cr_executions` at all** — driven off the CR's own `status` column.

**The old pack's "live bug underneath this" (§6 there) — status: format bug FIXED, blanket-attribution limitation still live.**
`deriveVerdict` (`drift-collector.ts:78–88`) is unchanged and correct: `crRef` truthy → `approved`.
The bug was that the only real-world populator used to hand-roll `` `CR-${cr.id}` `` instead of the
canonical `formatChangeRequestCode`, so a stamped `crRef` could never be parsed back by
`parseChangeRequestCode`. **This is fixed** — `monitor-executor.ts:159–169` now calls
`formatChangeRequestCode(cr.id)` directly, per its own #1505 comment. What's still true, by design,
not a bug: `buildCaChangeRequestAttribution` is coarse — one qualifying CR attributes **every**
drifted setting in that scan the same way ("a CR describes an intended change, not a JSON path").
A newer, more precise join-based engine exists (`config-change-attribution.ts`, #2759) but operates
on an entirely separate table lineage (`config_diff_changes`/`configChangeAttributionsTable`, fed by
`config-snapshot-differ.ts`) — it is **not** wired into the `drift_events` pipeline described above.
The two systems coexist rather than one calling the other. **OPEN GAP**, no issue currently tracks
porting the #2759 precision model onto the older `drift_events.cr_ref` path.

---

## 9. Cross-surface edges — the five from the old pack, now mostly real FKs (#1505)

| Edge | Column(s) | State |
|---|---|---|
| Finding → CR | `msp_change_requests.linkedFinding` | **CURRENT (free text, still no FK, deliberate)** — "a finding is not one row in one table" |
| Finding (remediation) → CR | `msp_change_requests.remediationCheckKey` | **CURRENT (free text, deliberate)**, real customer route: `POST /api/portal/remediation/checklist/:checkKey/raise-change` → `buildRaiseChangeRequestInputForChecklistItem` → `raiseChangeRequest` |
| Hold window → CR | `portal_hold_window_events.changeRequestId` | **CURRENT, real FK** — converted from loose int under #1505 |
| Drift → CR | `drift_events.crRef` (display) + `drift_events.changeRequestId` (real FK) + `baselineSnapshotId` (real FK) | **CURRENT** — real FK added alongside the retained display string (§8) |
| Risk ↔ CR | `msp_risk_decisions.spawnedByChangeRequestId` / `.dischargedByChangeRequestId` | **CURRENT, real FKs** — converted from bare ints under #1505; forward AND back pointers now exist, closing the old pack's explicit gap ("neither `registerRef` nor `checkKey` carries this today") |
| Risk ↔ CR (legacy) | `msp_risk_decisions.checkKey` / `.registerRef` | **CURRENT (free text, deliberate)** — `checkKey` is a real union-of-sources join key by design, not an oversight |
| SOP run ↔ CR | `msp_sop_runs.psaTicketId` ↔ CR `psaTicketId` | **CURRENT (soft join, unchanged)** — shared free text, not a key |

**Still loose/no-FK, flagged but not filed (all pre-existing, documented-as-deliberate design, not
new gaps):** `msp_change_requests.tenantId`/`.psaTicketId`/`.executorRunId`/`.sourceGraphMessageId`;
`m365_change_routings.changeRequestId`/`.riskDecisionId`/`.resolutionId` (plain `integer()`, no
`.references()` — the one genuinely un-converted pair from the #1505 pass, distinct from the fully
converted `msp_change_requests`/`msp_risk_decisions` columns above); `cr_executions.wfRunId`/
`.packKey`; `msp_risk_decisions.checkKey`/`.spawnedByRemediationStepId`; `drift_events.crRef` (kept
deliberately alongside its real FK sibling); `cab_meetings.chairPersonId` (deliberately unFK'd so a
removed member doesn't orphan history); `change_freeze_windows.workload` /
`change_maintenance_windows.workload` (free text; the vocabulary they're supposed to match,
`CHANGE_REQUEST_WORKLOADS`, isn't even defined in the schema file, only in application code).

---

## 10. Customer settings surface (`portal-settings-change-control`) — real, and NOT what the issue body assumed

**Correction to this issue's own body:** "no wire code exists yet for Change Control in
artifacts/portal" is no longer accurate. `artifacts/portal/src/components/settingsChangeControlWire.ts`
(pure shapes/normalizers) and `settingsChangeControlLive.ts` (`useChangeControlSettingsLive()` hook)
both exist, dated to #1592/#1759. **No page imports the hook yet** — it is real, backend-ready,
unconsumed client code, not a HARD RULE violation (no fixture fallback anywhere in the file; on
fetch failure it sets an `error` string and leaves state at its honest wire-level defaults).

**Endpoints (§1 table above).** Policy shape (`WireCcPolicy`): `on`, `gated: Record<string,
boolean>` (normalized against a fixed gate-key catalogue so an unset gate reads `false`, not
`undefined`), `approvals.requiredSignatures` (min 1, default 1), `separate.requireSeparateApprover`
(default `true`), `freeze.enforceFreezeCalendar` (real — read by the CR-raise path, §3),
`emergency.allowEmergencyPath`.

**Notification rules (`portal_change_control_notifications`):** 7 fixed event keys —
`ms_enforcement_approaching`, `message_center_impact`, `cr_raised`, `cr_awaiting_signature`,
`cr_window_opening`, `cr_deployed_or_rolled_back`, `freeze_declared_or_lifted`. Defaults name no
real people (`to: ""` or generic role text) — deliberate, to avoid the retired design fixture's
fictional names.

**Eligible approvers are computed live**, never a stored set — the exact same
`users.canApproveChanges = true` flag the approve/reject routes enforce, so settings and the actual
approval gate cannot disagree (#1759). **No PUT for approvers exists, deliberately** — the former
`portal_change_control_approvers` table and its `normal`/`emergency` band concept were a second
eligibility store the approval path never actually read; #1759 dropped all three.

---

## 11. Change metrics (#1506)

`GET /api/portal/change-control/metrics` — `{ metrics: WireChangeMetrics }`:
`changeSuccessRate`/`failedChangeRate`/`emergencyChangeRatio` (`WireRateMetric: {available, rate,
numerator, denominator}`), `leadTime` (`WireDurationMetric: {available, averageHours, medianHours,
sampleSize}`), `cabThroughput` (`WireCabThroughputMetric: {available, meetingsHeld, itemsDecided,
itemsDeferred, averageDecisionLatencyHours}`).

**"Unavailable, never zero" rule — confirmed implemented, not just documented.** `rate()` returns
`{available: false, rate: null, numerator: 0, denominator: 0}` whenever the denominator is `≤ 0`;
same pattern for duration and CAB-throughput sentinels. A metric with no qualifying events never
silently reads as `0%`.

**⚠ Real gap found this session, filed as #3045** (§14): `computeChangeMetrics` derives
success/failure from `cr_executions.outcome` / `cr_events` terminal events — its own header still
says #1502 (PIR close codes) "is still OPEN," which is stale (#1502 shipped, §8). The file was never
updated to prefer `cr_pirs.closeCode`, so `successful_with_issues` — a real, human-reviewed
distinction — is invisible to every success/failure metric today.

**Formulas** (`portal-change-metrics.ts`): success/failure prefers the most-recently-settled
`cr_executions.outcome`, falls back to the CR's own terminal `cr_events` row; emergency ratio counts
`raised` events on `changeClass === "emergency"` CRs; lead time is `(executedAt - requestedAt)` in
hours off real ISO columns (never the free-text `scheduledFor`); CAB throughput aggregates
`cab_meetings`/`cab_agenda_items` touched by this scope's agenda.

---

## 12. Real enum unions (from the Drizzle schema — no `pgEnum`, all TS-level `text` unions)

`grep -n "pgEnum" lib/db/src/schema/msp.ts` returns **zero matches** — every "enum" in this file is a
plain `text` column typed via `.$type<...>()` or `{enum:[...]}`, backed by an exported `as const`
array, with **no CHECK constraint in the actual DB** for most of them (several columns carry an
explicit comment saying so, e.g. `msp_change_requests.category`).

| Column | Union | Line |
|---|---|---|
| `msp_change_requests.change_class` | `standard \| normal \| emergency` | `msp.ts:4609` |
| `msp_change_requests.risk_level` | `critical \| high \| medium \| low` | `:4610` |
| `msp_change_requests.category` | `ConditionalAccess \| Exchange \| Identity \| Intune \| Defender \| SharePoint \| Purview \| Teams` | `:4619` |
| `msp_change_requests.status` | `pending_approval \| scheduled \| in_progress \| completed \| rolled_back \| rejected` | `:4654` |
| `msp_change_requests.intake` | `informed \| approval \| advisory` | `:4767` |
| `msp_change_requests.implementer` | `microsoft \| customer \| msp` | `:4768` |
| `msp_change_requests.source_kind` | `microsoft_change` (nullable) | `:4769` |
| `cr_approvals.decision` | `pending \| approved \| rejected \| superseded` | `:5058` |
| `cr_approvals.approver_role` | `customer \| msp \| catalog_inherited \| microsoft_forced` | `:5076` |
| `change_freeze_windows.scope` | `global \| tenant \| workload` | `:4892` |
| `change_freeze_windows.recurrence` | `none \| weekly \| monthly \| quarterly \| annually` | `:4895` |
| `change_maintenance_windows.scope` / `.recurrence` | same two unions as freeze | `:4939`,`:4942` |
| `change_catalog_items.status` | `draft \| approved \| revoked` | `:5369` |
| `cr_executions.executor_kind` | `runbook_run \| write_action \| human_action` | `:5157` |
| `cr_executions.outcome` | `pending \| succeeded \| failed \| rolled_back` | `:5161` |
| `cr_executions.rollback_outcome` | `pending \| verified \| failed` | `:5165` |
| `cr_pirs.close_code` | `successful \| successful_with_issues \| failed \| rolled_back` | `:5278` |
| `cr_pirs.drift_rescan_status` | `not_applicable \| ran \| error` | (adjacent) |
| `cr_events.event_type` | `raised \| approved \| rejected \| superseded \| scheduled \| in_progress \| completed \| rolled_back \| script_revealed \| pir_recorded` | `:5859` area |
| `cr_events.actor_role` | `customer \| msp \| microsoft \| system` | (adjacent) |
| `cr_comments.author_role` / `cr_attachments.uploaded_by_role` | `customer \| msp` | (adjacent) |
| `cr_attachments.kind` | `evidence \| test_result \| approval_email \| other` | (adjacent) |
| `cab_members.role` | `chair \| voting \| advisory \| secretary` | `:5665` area |
| `cab_members.side` | `msp \| customer` | (adjacent) |
| `cab_meetings.meeting_type` | `cab \| ecab` | `:5707` area |
| `cab_meetings.status` | `scheduled \| in_progress \| completed \| cancelled` | (adjacent) |
| `cab_agenda_items.recommendation` | `approve \| reject \| defer` | `:5747` area |
| `change_request_dependencies` | no enum — directed edge table | `:4997` |
| `drift_events.verdict` | `approved \| attributed_unapproved \| unattributed \| informational` | `msp.ts:8286` area |
| `drift_events.status` | `open \| resolved \| reopened` | (adjacent) |

**Derived display vocabularies** (`lib/portal-change-control.ts`, unchanged shape from the old pack,
now with two additional derivation functions):

| Union | Values | Line |
|---|---|---|
| `ChangeRequestDisplayStatus` | 7 labels, §2.2 | lib:64–73 |
| `ChangeRequestWorkload` (8) | `Conditional Access \| Exchange / mail \| Identity \| Intune \| Defender \| SharePoint \| Purview \| Teams` | lib:76–86 |
| `RiskLevel` (display) | `Low \| Medium \| High \| Critical` | lib:255–256 — note `computeRiskLevel` can never itself *produce* `Critical`; only a stored literal `"critical"` written elsewhere can surface it |

**Four separate workload-derivation functions now exist** (was one in the old pack) — each keyed
off different input shapes with independently load-bearing match order, and each documented as
deliberately *not* sharing logic with the others (a real mis-categorization bug, CR-2026-183,
resulted from running one function's patterns against another's input shape):
`deriveWorkload` (from `targetResource`, cmdlet/endpoint strings), `workloadForCheckKey` (from a
remediation `checkKey` prefix), `deriveWorkloadFromTouches` (from Microsoft-routed `touches`
human-readable service/setting names).

---

## 13. Full schema table map (14 Change-Control tables, `lib/db/src/schema/msp.ts`)

| Table | Line | Role |
|---|---|---|
| `msp_change_requests` | 4601 | the hub — every other table hangs off `changeRequestId` |
| `change_freeze_windows` | 4898 | #1500 |
| `change_maintenance_windows` | 4945 | #1504 |
| `change_request_dependencies` | 4997 | #1504, `blocked_by` edges, unique (changeRequestId, blocksChangeRequestId) |
| `cr_approvals` | 5036 | #1496 |
| `cr_executions` | 5168 | #1499, MSP-only |
| `cr_pirs` | 5293 | #1502, MSP-only, unique on `executionId` |
| `change_catalog_items` | 5372 | #1498 |
| `cab_members` | 5665 | #1501, MSP-only |
| `cab_meetings` | 5707 | #1501, MSP-only |
| `cab_agenda_items` | 5747 | #1501, MSP-only |
| `cr_events` | 5859 | #1503, append-only, no update/delete code path anywhere |
| `cr_comments` | 5910 | #1503, append-only |
| `cr_attachments` | 5944 | #1503, append-only |

Plus three adjacent tables read/written by Change Control but not owned by it:
`m365_change_interpretations` (3167), `m365_change_resolutions` (3281), `m365_change_routings`
(3346) — the Microsoft-change routing pipeline (#1534) that feeds `sourceKind: "microsoft_change"`
CRs; `msp_risk_decisions` (6262) — the risk register; `drift_events` (8286) — drift detection;
`portal_change_control_policy` (8003) and `portal_change_control_notifications` (8138) — customer
settings (§10).

---

## 14. Findings filed this session (new sub-issues of #1486)

Three real, code-confirmed gaps found during this re-extraction, each filed as its own issue, sibling
sub-issues of #1486, labeled `bug`, milestone v1.1, board status "AI Batter Up":

- **#3044** — Standard-catalog `execute` skips freeze/maintenance/collision enforcement that the
  ordinary CR-raise path runs (§7).
- **#3045** — Change metrics still compute success/failure without `cr_pirs.closeCode`; the file's
  own header comment falsely claims #1502 is still open (§11).
- **#3046** — `escalateBreachedApprovals()` is a real, tested function with zero live callers —
  approval SLA breaches are computed (`dueAt`) but never escalated (§4.1).

---

## 15. The honest tri-state — client-side, still unconsumed

No page in `artifacts/portal` currently imports the Change Control settings hook (§10), and — per
this issue's premise and confirmed by grep — no page imports a register/dashboard hook for Change
Control at all. There is therefore **no live tri-state (loading/live-empty/read-failed) to audit on
the client today**, unlike Microsoft Changes' pack, because there is no consuming page yet. The
settings hook that does exist has no fixture fallback (§10) — when a consuming page is built, it
inherits an honest seam already, not a violation to fix.

---

## 16. Orphaned-endpoint check (`#1485` standing convention)

**Result: no orphan found.** Every one of the 14 customer-portal endpoints in §1 has a real,
identified caller path today except the settings surface (§10), which is unconsumed *client* code
(not an orphaned *endpoint* — the route itself is real and correctly shaped; nothing is calling it
yet because no settings page under `Design/portal/` has landed). This is the inverse of an orphan
(a route with no caller because the caller hasn't been built) rather than dead API surface, and is
already tracked implicitly by `#1716` (Design export, blocked on this pack) and `#1717` (wire).

**MSP-side surfaces noted, not filed** (same posture as the old pack's §11): `msp-change-executions.ts`,
`msp-change-control-cab.ts`, `msp-change-pir.ts`, `msp-change-catalog.ts`,
`msp-change-freeze-windows.ts`, `msp-change-maintenance-windows.ts`, `msp-change-dependencies.ts`
are all real, MSP-console-only surfaces, each with its own file-header "SCOPE STOP — no UI to wire"
statement. Out of this module's design scope by their own explicit design, not overlooked.

---

## Appendix — source index

| Concern | File | Key lines |
|---|---|---|
| Register + approve/reject/decline/timeline/comments/attachments/metrics route | `artifacts/api-server/src/routes/portal-change-control.ts` | `:174` (Wire), `:414` (stats), `:507–1468` (11 routes) |
| Pure derivations, enums, show-flags | `artifacts/api-server/src/lib/portal-change-control.ts` | enums, display maps, `computeRiskLevel`/`deriveWorkload` family, `canApprove`/`canRollback` |
| Raise pipeline (freeze/maintenance/collision/insert/discharge) | `artifacts/api-server/src/lib/portal-change-control-raise.ts` | `:114–310` |
| Approval ledger + policy | `artifacts/api-server/src/lib/portal-change-approvals.ts`, `-store.ts` | quorum, SLA, separation of duties, delegation |
| Rejection two-terminal-state model | `artifacts/api-server/src/lib/portal-change-rejection.ts` | `:43–182` |
| Write-gate (#1497) | `artifacts/api-server/src/lib/change-control-write-gate.ts` | `:101–143` (rule), `:175–263` (claim) |
| Risk discharge | `artifacts/api-server/src/lib/change-request-risk-discharge.ts` | `:76–104` |
| Standard change catalog (customer) | `artifacts/api-server/src/routes/portal-change-catalog.ts` | full 224 lines |
| Freeze / maintenance windows (pure + store) | `artifacts/api-server/src/lib/portal-change-freeze*.ts`, `portal-change-maintenance*.ts` | |
| CR dependencies (customer read-only) | `artifacts/api-server/src/lib/portal-change-dependencies-store.ts` | |
| Timeline (append-only) | `artifacts/api-server/src/lib/portal-change-timeline-store.ts` | `:10–20`, `:60–178` |
| Metrics | `artifacts/api-server/src/lib/portal-change-metrics.ts` | |
| Customer settings | `artifacts/api-server/src/routes/portal-settings-change-control.ts`, `lib/portal-settings-change-control.ts` | |
| Client seam (unconsumed) | `artifacts/portal/src/components/settingsChangeControlWire.ts`, `settingsChangeControlLive.ts` | |
| Drift verdict + crRef writeback | `artifacts/api-server/src/lib/drift-collector.ts`, `artifacts/api-server/src/lib/monitor-executor.ts` | `deriveVerdict` :78, `buildCaChangeRequestAttribution` :135 |
| Newer, unwired precision attribution engine | `artifacts/api-server/src/lib/config-change-attribution.ts` | #2759 |
| Finding→CR (remediation) edge | `artifacts/api-server/src/lib/remediation-raise-change.ts`, `artifacts/api-server/src/routes/portal-remediation-checklist.ts:239` | |
| Stored rows + enums | `lib/db/src/schema/msp.ts` | full table map, §13 |
| MSP-only execution/CAB/PIR routes (out of scope) | `artifacts/api-server/src/routes/msp-change-executions.ts`, `msp-change-control-cab.ts`, `msp-change-pir.ts`, `msp-change-catalog.ts`, `msp-change-freeze-windows.ts`, `msp-change-maintenance-windows.ts`, `msp-change-dependencies.ts` | |
