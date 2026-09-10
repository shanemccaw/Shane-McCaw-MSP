# Active Directory / OU Assignment (MSP Console) — contract extraction pack

**#3374**, under **#1571** (EPIC: Portal Admin — MSP-side operator surface). No Feature-tier
issue sits between them (confirmed via the GitHub API — #3374's parent is #1571 directly).
Follows the **#1642 pattern**: the wire contract extracted verbatim and cited to file:line,
real enum unions only, cross-surface edges, honest-empty contract, orphaned-endpoint check.
Read-only — no product code, schema, or UI changed by this session; every field below is
cross-checked live against local Postgres (`shanemccawmsp`, `DATABASE_URL`) and against the
real, passing test suite (`npx vitest run src/routes/msp-active-directory.test.ts` — 27/27
pass, run this session).

**Real, confirmed backend, no pack existed for it yet.** `msp-active-directory.ts` is 526
lines, 6 real routes, all fully implemented — no `TODO`/`FIXME`/stub markers anywhere in the
file (grepped this session), no half-built route. Confirming the issue body's own instruction
to check completeness rather than assume it from line count: every route below has a
passing test in `msp-active-directory.test.ts` covering its auth floor, its ownership/staff
scoping, its validation, and its success path.

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/msp-active-directory.ts` — the route file itself (all
  bare line refs below are into this file unless stated otherwise)
- `artifacts/api-server/src/routes/msp-active-directory.test.ts` — confirms the real
  request/response shape and the 401/403/404/409 behavior asserted here (27 tests, all
  passing, run this session)
- `artifacts/api-server/src/routes/admin-active-directory.ts:1235-1268` —
  `resolveAssignmentCustomer`/`resolveGraphUserByUpn`, the shared tenant-resolution +
  Graph-verification helpers this file imports and reuses rather than duplicating
- `artifacts/api-server/src/routes/portal-active-directory.ts` — the customer-facing sibling
  (read + raise-a-request only; never sets an assignment directly)
- `artifacts/api-server/src/lib/policy-compliance-graph.ts:1-120` — the real consumer of
  `active_directory_ou_assignments`: manual-assignment-first, department-match-guess-second
  resolution order for standing-policy compliance evaluation
- `artifacts/api-server/src/middlewares/requireAuth.ts` — `requireRole`, `ROLE_ORDER`,
  `assertCustomerAccess`, `resolveStaffScopedCustomerIds`, `isCustomerBlockedByStaffScope`
- `artifacts/api-server/src/middlewares/rbac-ladder.ts:280-322` — `userClearsLadderFloor`,
  the real (as of #2458, merged immediately ahead of this build) RBAC-ladder evaluator
  `requireRole` now delegates its decision to
- `artifacts/api-server/src/lib/resolve-msp-id.ts:63-77` — `resolveMspIdStrict`
- `artifacts/api-server/src/lib/audit.ts` — `createAuditLog`, `AuditEvent`
- `artifacts/api-server/src/middlewares/subscriptionGate.ts`,
  `artifacts/api-server/src/lib/retention/subscription-gate.ts:154-160` — confirms this
  surface is never behind the billing retention wall
- `artifacts/api-server/src/routes/index.ts:274,565`; `artifacts/api-server/src/app.ts:107-127`
  — router mount; confirms the real, live path prefix is `/api/msp/active-directory/*` under
  `app.use("/api", subscriptionGate, router)`
- `lib/db/src/schema/index.ts:4484-4643` — `activeDirectoryOusTable`,
  `activeDirectoryOuAssignmentsTable`, `activeDirectoryOuAssignmentRequestsTable`,
  `ACTIVE_DIRECTORY_OU_ASSIGNMENT_REQUEST_STATUSES` (real column/enum sources)

---

## 1. Wire contracts

### 1a. Auth floor and scoping, common to all 6 routes

`requireRole("MSPOperator")` (MSPAdmin and PlatformAdmin clear that floor too,
`ROLE_ORDER`, `requireAuth.ts:115-123`). As of #2458 (merged the commit immediately before
this pack), the actual allow/deny decision no longer comes from that array comparison
directly — `requireRole` (`requireAuth.ts:271-306`) delegates to
`userClearsLadderFloor`/`roleClearsLadderFloor` (`rbac-ladder.ts:280-322`), the seeded
`ladder.*` role→capability model. A missing/invalid bearer token is `401`
(`requireAuth.ts:152-207`); a role below the floor is `403`
("Insufficient privileges — MSPOperator or above required"); an unseeded/unreadable ladder
model is a `503` ("Authorization is temporarily unavailable") — a genuine "can't decide,"
never silently read as an allow or a deny.

`mspId` comes from `resolveMspIdStrict(req)` (`resolve-msp-id.ts:63-77`) — the caller's own
session JWT claim only, **no `?mspId=` override, not even for PlatformAdmin** (matching
`msp-customer-timeline.ts`'s equivalent route, per the sibling pack). A `null` mspId 403s
`{ error: "MSP context required" }` on every one of the 6 routes below — including a real
PlatformAdmin session, if that session's own JWT happens to carry no `mspId` claim. This
surface is also never behind the subscription/retention wall: `gatedTenantIdFor` returns
`null` for any operator-role principal (`subscription-gate.ts:154-160`), so `subscriptionGate`
(`app.ts:127`) always calls `next()` before `requireAuth` even runs for these routes.

Per-target ownership is `assertCustomerAccess(req.user!, customerId)`
(`requireAuth.ts:378-407`) — PlatformAdmin always passes; MSPAdmin/MSPOperator pass only if
the target `tenants.id` belongs to their own `mspId` AND (if the staff member is scoped via
`msp_staff_customer_scopes`) is in their assigned set; CustomerUser/Free/Assessment can never
pass this route's floor at all. A target outside the caller's book **404s** — "OU not found"
or "Assignment not found" — never a distinguishable 403, so its existence is never disclosed.
27/27 tests in `msp-active-directory.test.ts` confirm this for every one of the 6 routes.

### 1b. `GET /api/msp/active-directory/ou/:id/assignments` (`:90-128`)

Lists every real manual assignment pointed at one OU. A **tenant-less OU (`tenantId ===
null`) is refused before any ownership lookup even runs** — `:112` short-circuits
`!ou || ou.tenantId === null || !(await assertCustomerAccess(...))` left-to-right, so a
null-tenant OU costs exactly one `db.select` (confirmed by the test asserting
`mockSelect` called exactly once, `:201`). This is the MSP-side restriction the file's own
header explains (`:34-42`): a tenant-less OU is a platform/MSP-level grouping node with no
`mspId` column of its own on `active_directory_ous`, so it cannot be proven to belong to any
one MSP — allowing it here would let one MSP's staff read into a node another MSP's customer
might also share. Only PlatformAdmin, via the separate `admin-active-directory.ts` route
(no such restriction there), can read a tenant-less OU's assignments.

Response: a raw `ActiveDirectoryOuAssignment[]` (`:122`, no wrapper object), ordered
`asc(objectUpn)`. Real row shape (`lib/db/src/schema/index.ts:4537-4564`):

| Field | Type | Nullability | Source |
|---|---|---|---|
| `id` | `number` | not null | serial PK |
| `mspId` | `number` | not null | FK → `msps.id` |
| `ouId` | `number` | not null | FK → `active_directory_ous.id` |
| `customerId` | `number` | not null | `tenants.id` — no FK (matches `msp_diagnostic_runs.customerId` convention) |
| `tenantId` | `string` | not null | the real Graph tenant id (`tenants.tenantId`), denormalized |
| `objectId` | `string` | not null | real Graph AAD object guid, resolved via Graph at assign time |
| `objectUpn` | `string` | not null | real Graph UPN, captured at assign time |
| `objectDisplayName` | `string \| null` | nullable | convenience label, never re-derived or trusted as authoritative |
| `assignedByUserId` | `number \| null` | nullable | FK → `users.id`, `ON DELETE SET NULL` |
| `createdAt` / `updatedAt` | `string` (ISO, via JSON serialization) | not null | timestamptz |

### 1c. `POST /api/msp/active-directory/ou/:id/assignments` (`:134-230`)

Body: `{ customerId: number, objectUpn: string }`. `objectUpn` is trimmed; empty after
trim is `400`. Order of checks (`:139-188`, all confirmed by tests): mspId session check →
`ouId` param validity → `objectUpn` non-empty → OU exists (`404` if not) →
`resolveAssignmentCustomer(customerId)` (`admin-active-directory.ts:1235-1248`, `400` if the
customer id isn't a real `tenants.id`) → `assertCustomerAccess` ownership (`404` if the
customer belongs to a different MSP or is outside the staff member's scope — **never
discloses the customer exists**, confirmed `:271-273`) → the MSP-side null-tenant / OU-must-
match-customer restriction (`400` if `ou.tenantId === null` or `ou.tenantId !== customerId`,
confirmed the test at `:275-288` — this check runs **before** any Graph call, so a
wrong-tenant OU never even reaches `resolveGraphUserByUpn`) → real Graph lookup via
`resolveGraphUserByUpn(graphTenantId, objectUpn)` (`400` with Graph's own error text if the
object can't be resolved — **never trusted from client input alone**).

On success: `INSERT ... ON CONFLICT (customerId, objectId) DO UPDATE` (`:191-213`) — the
real DB-level upsert target is the `active_directory_ou_assignments_customer_object_idx`
unique index (confirmed live in Postgres: `UNIQUE CONSTRAINT, btree (customer_id,
object_id)`). Re-assigning an already-assigned object **moves** it (updates `ouId` in place)
rather than creating a second row — real AD's one-object-one-OU semantics, not a
soft/display-only rule. Audits `active_directory.ou_assignment.set` with
`actorSurface: "msp"` metadata (`:215-221`) — best-effort: `createAuditLog` itself
swallows and only logs its own failures (`audit.ts:18-35`), so an audit-write failure never
fails the request or rolls back the assignment. Responds `201` with the raw inserted/updated
row (same shape as §1b's table).

### 1d. `PATCH /api/msp/active-directory/ou-assignments/:id` (`:234-305`)

Body: `{ ouId: number }`. Moves an **existing** assignment to a different OU — this route
resolves ownership off the **assignment's own `customerId`** (looked up first, `:257-265`),
not off any customer id in the request body (there is none). `404`s if the assignment
doesn't exist or its customer is out of the caller's book. The new OU is validated the same
way as the POST route (`400` if it doesn't exist, or if `tenantId === null` or `tenantId !==
existing.customerId`, `:274-282`) — the MSP-side restriction applies identically here.
Updates `ouId` + `updatedAt` only — `objectId`/`objectUpn`/`objectDisplayName` are untouched
(this is a move, not a re-verification against Graph). Audits
`active_directory.ou_assignment.move` with `fromOuId`/`toOuId` (`:290-296`). Responds `200`
with the raw updated row.

### 1e. `DELETE /api/msp/active-directory/ou-assignments/:id` (`:309-365`)

No body. Same ownership resolution as PATCH (off the assignment's own `customerId`,
`404` if out of book, never disclosing existence). Hard-deletes the row (`:341-344`) — there
is no soft-delete/history table for this surface (matches the schema's own "current-state
only, no history" design note, `index.ts:4529-4530`). The object simply reverts to the
department-match guess in `policy-compliance-graph.ts` (§2 below) — clearing the row is not
itself a Graph write. Audits `active_directory.ou_assignment.clear` with the deleted row's
`objectId`/`customerId` (`:350-356`, captured from the `.returning()` result, so the audit
log still has the real values even though the row is gone). Responds `204 No Content`.

### 1f. `GET /api/msp/active-directory/ou-assignment-requests` (`:372-402`)

Every real customer-raised request against the caller's MSP book (Git #2524's
`active_directory_ou_assignment_requests` table), most recent first
(`desc(createdAt)`). This is the one route of the 6 that uses
`resolveStaffScopedCustomerIds` directly (`:386`) rather than `assertCustomerAccess` per-row
— a **list** route, scoped by folding an `inArray(customerId, scopedCustomerIds)` condition
in when the caller is a scoped staff member (`null` = unrestricted, full MSP book, per
`requireAuth.ts:409-444`). Optional `?status=` narrows to one real status
(`ACTIVE_DIRECTORY_OU_ASSIGNMENT_REQUEST_STATUSES` — all 4, including `"pending"`) — an
**unrecognised value is silently ignored** (`:383`, `.find` returns `undefined`, the
condition is never pushed), not a `400` — this is a display filter, not a write, so a typo'd
query param just returns the unfiltered list rather than erroring.

Response: a raw `ActiveDirectoryOuAssignmentRequest[]` (`:396`, no wrapper). Real row shape
(`index.ts:4598-4640`):

| Field | Type | Nullability | Source |
|---|---|---|---|
| `id` | `number` | not null | serial PK |
| `mspId` | `number` | not null | FK → `msps.id` |
| `customerId` | `number` | not null | `tenants.id`, no FK |
| `tenantId` | `string` | not null | real Graph tenant id, denormalized |
| `objectUpn` | `string` | not null | the object the request is about — free text, not FK'd to a live Graph resolution at request time |
| `objectDisplayName` | `string \| null` | nullable | captured from Graph at request-raise time |
| `currentOuId` | `number \| null` | nullable, FK `SET NULL` | the object's known OU **at request time** — never re-derived later |
| `requestedOuId` | `number \| null` | nullable, FK `SET NULL` | a real target OU, when one exists |
| `requestedOuName` | `string \| null` | nullable | free-text fallback when no real OU matches; route-level validation on the raise side requires at least one of `requestedOuId`/`requestedOuName` |
| `note` | `string` | not null | the customer's own reason — required |
| `status` | `"pending" \| "approved" \| "rejected" \| "fulfilled"` | not null, default `"pending"` | `ACTIVE_DIRECTORY_OU_ASSIGNMENT_REQUEST_STATUSES` — declared via Drizzle's `text(..., {enum:...})`, **no DB-level CHECK constraint** (confirmed live: `\d` shows a plain `text` column with a literal default, no constraint) — the enum is a TypeScript-level guarantee for code going through this route, not a DB-enforced one |
| `requestedByUserId` / `resolvedByUserId` | `number \| null` | nullable, FK `SET NULL` | `users.id` |
| `resolvedAt` | `string \| null` (ISO) | nullable | set only when moved off `pending` |
| `resolutionNote` | `string \| null` | nullable | the MSP's own reply |
| `createdAt` / `updatedAt` | `string` (ISO) | not null | timestamptz |

### 1g. `PATCH /api/msp/active-directory/ou-assignment-requests/:id` (`:415-524`)

Body: `{ status: "approved" | "rejected" | "fulfilled", resolutionNote?: string }` —
`RESOLVABLE_STATUSES` (`:404`) is a **separate, narrower** 3-value constant than the full
4-value `ACTIVE_DIRECTORY_OU_ASSIGNMENT_REQUEST_STATUSES` used for the GET route's filter —
`"pending"` is never a valid *target* status here (you can't resolve a request back to
pending). An unrecognised status is `400`. `404`s if the request doesn't exist or is out of
the caller's book (via `assertCustomerAccess` on `existing.customerId`). `409`s
`"Request is already '<status>'"` if the request is not currently `"pending"` — a
terminal-state request can never be re-resolved.

**The real-assignment side effect**, only when `status` is `"approved"` or `"fulfilled"`
**and** `existing.requestedOuId !== null` (`:458-501`):
1. Re-validates the requested OU still belongs to this customer (`400` "no longer belongs to
   this customer — resolve manually first" if the OU was reassigned/deleted since the
   request was raised — a real, live re-check, not trusting the request row's stale
   snapshot).
2. Re-resolves the Graph object via `resolveGraphUserByUpn(existing.tenantId,
   existing.objectUpn)` (`400` with Graph's error if it no longer resolves).
3. Performs the **identical** `INSERT ... ON CONFLICT (customerId, objectId) DO UPDATE`
   the POST route in §1c uses — so "approved"/"fulfilled" **always** means the real
   `active_directory_ou_assignments` row was actually written, never a status flip that
   leaves the real assignment stale. Confirmed by the test at `:454-478`.
4. Uses `existing.mspId`/`existing.tenantId` (the request row's own **denormalized** values
   captured at request-raise time, `:472-475`) for the insert — not a fresh
   `resolveAssignmentCustomer` call. In the overwhelmingly normal case this is identical to
   the caller's own resolved `mspId` (ownership was already re-confirmed a step earlier via
   `assertCustomerAccess` against the tenant's **current** `mspId`); it would only diverge if
   a customer's owning MSP changed between the request being raised and being resolved — no
   such MSP-transfer feature was found in this codebase, so this is a documented contract
   detail, not a proven-reachable bug.

A request with only a free-text `requestedOuName` (no real `requestedOuId`) still moves to
the chosen status — the assignment table is left untouched; the MSP does the actual
OU creation/assignment through the §1c/§1d routes first, in that case (confirmed by test,
`:499-516`).

Response: `200` with `{ request: ActiveDirectoryOuAssignmentRequest, appliedAssignment:
ActiveDirectoryOuAssignment | null }` (`:518`) — the one route of the 6 whose response is a
wrapper object rather than a raw row/array. `appliedAssignment` is non-null **only** on the
approved/fulfilled-with-real-OU path; `null` for rejections and for name-only approvals.
Audits both `active_directory.ou_assignment.set` (when applied) and
`active_directory.ou_assignment_request.resolved` (always) — two real audit rows for one
approve-with-a-real-OU request, confirmed by test (`:476-477`).

---

## 2. Cross-surface edges

- **vs. `policy-compliance-graph.ts`** (`:68-120`) — the real consumer of this data. Standing
  policies (`standingPoliciesTable.ouId`, `lib/db/src/schema/msp.ts:5466`) evaluate OU
  membership as: every object with a manual `active_directory_ou_assignments` row for *this*
  OU, **plus** every Graph `/users` object matching `department eq '<ouName>'` **that has no
  manual row anywhere else in this customer's book** (`resolveManuallyAssignedObjectIds`
  excludes them from every *other* OU's department guess — an object can only really belong
  to one OU at a time). A manual row always wins over the department guess for its own
  object; an object with no manual row falls through to the department guess unchanged. This
  file's DELETE route is the only way to make an object fall back to the guess once manually
  placed.
- **vs. `admin-active-directory.ts`** (the PlatformAdmin-only mirror, same 4 CRUD routes
  under `/api/admin/active-directory/ou*`) — genuinely the same table and the same
  Graph-verification discipline (this file's `POST`/`PATCH` call the admin file's own
  exported `resolveAssignmentCustomer`/`resolveGraphUserByUpn` rather than duplicating them),
  but the admin route has **no** MSP-side null-tenant restriction and **no**
  `assertCustomerAccess`/staff-scoping — a real, intentional widening for PlatformAdmin only
  (`requireAdmin`, not `requireRole("MSPOperator")`).
- **vs. `portal-active-directory.ts`** (the customer-facing sibling, Git #2524) — the
  customer can only **read** its own OUs/assignments and **raise** a request; it can never
  call any of this file's write routes. This file's §1f/§1g routes are the only way a raised
  request is ever seen or resolved — without them the request would be a write with no read,
  a black hole (the file's own header comment, `:47-49`). The request table is a deliberate
  **separate table**, not routed through `msp_change_requests`, because these routes never
  issue a real Graph *write* (only a Graph *read* to verify the object) — see
  `index.ts:4575-4588`'s full reasoning, cited verbatim in both route files' headers.
- **`active_directory_ous.tenantId` has no FK-level connection to `mspId` at all** — an OU's
  only path to an MSP is transitively, through `tenants.mspId`. This is exactly why a
  tenant-less OU (§1b/§1c/§1d's shared restriction) cannot be scoped to any one MSP by this
  route: there is no column to check.

---

## 3. Real enum unions

- **OU assignment request status** — `activeDirectoryOuAssignmentRequestsTable.status`:
  `"pending" | "approved" | "rejected" | "fulfilled"`
  (`ACTIVE_DIRECTORY_OU_ASSIGNMENT_REQUEST_STATUSES`, `index.ts:4595`) — declared at the
  Drizzle/TypeScript level only; confirmed live against Postgres that the column itself
  carries **no DB-level CHECK constraint**, so this vocabulary is enforced by the two route
  files (`msp-active-directory.ts`'s `RESOLVABLE_STATUSES` gate and `portal-
  active-directory.ts`'s default-`"pending"` insert), not by the database.
- **Resolvable target statuses** (this file's `PATCH .../ou-assignment-requests/:id` only) —
  `RESOLVABLE_STATUSES = ["approved", "rejected", "fulfilled"]` (`:404`) — a real subset of
  the above; `"pending"` is a valid *filter* value (§1f) but never a valid *target* value
  here.
- **MSP role floor for this whole file** — `ROLE_ORDER`
  (`requireAuth.ts:115-123`): `Assessment < Free < CustomerUser < ServiceAccount <
  MSPOperator < MSPAdmin < PlatformAdmin`. `requireRole("MSPOperator")` admits the top 3 —
  same floor on all 6 routes, no route in this file requires more than `MSPOperator`.
- **Audit `actorRole`** — `AuditEvent.actorRole: "admin" | "client"` (`audit.ts:8`) — this
  file's `auditActor()` helper (`:82-85`) passes `req.user!.role` straight through
  unconverted; every MSP-staff principal in this codebase carries `role: "client"` (the
  `mspRole` claim, not `role`, is what actually distinguishes MSPOperator/MSPAdmin/
  PlatformAdmin — see `requireAuth.ts:144-146`'s `effectiveMspRole`), so every audit row this
  file writes carries `actorRole: "client"` even for an `MSPAdmin`/`PlatformAdmin` actor. The
  real distinguishing signal for "who did this" on an audit row is `actorName` +
  `metadata.actorSurface: "msp"`, not `actorRole`.

---

## 4. Honest-empty / partial-data contract

- All three real tables backing this surface (`active_directory_ous`,
  `active_directory_ou_assignments`, `active_directory_ou_assignment_requests`) are
  genuinely **empty in the local dev database right now** (0 rows each, queried live this
  session) — not a fixture default, a real empty product state. Every list route (§1b, §1f)
  returns a real `[]`, not a fabricated placeholder row; there is no fixture branch anywhere
  in this file.
- A `404` from any of the 4 single-target routes is **structurally indistinguishable**
  between "genuinely doesn't exist" and "exists but belongs to another MSP / is outside this
  staff member's scope" — by design (§1a), matching every other `/api/msp/*` route's
  ownership-check convention in this repo.
- An audit-log write failure (`createAuditLog` catching its own error, `audit.ts:32-34`)
  never fails the request and never rolls back the real assignment/request write that
  preceded it — the audit trail is best-effort, not transactional with the data change.
- `objectDisplayName` is `null`-able everywhere it appears and is explicitly documented
  (`index.ts:4553-4555`) as "convenience only, never re-derived or trusted as authoritative"
  — a caller must not use it as a uniqueness or identity key; `objectId` (the real Graph AAD
  guid) is the only trustworthy identity field.

---

## Finding — a stale, already-failing test discovered while cross-checking this file's siblings (not part of this pack's own scope)

Running this file's own test suite in isolation is clean: `npx vitest run
src/routes/msp-active-directory.test.ts` — **27/27 pass**. While cross-checking the wider
Active Directory surface for this pack (`portal-active-directory.test.ts`,
`admin-active-directory-delete.test.ts`, `admin-active-directory-user-actions.test.ts`,
`admin-active-directory-credential-ops.test.ts`), one of those sibling files failed:

```
FAIL  src/routes/admin-active-directory-delete.test.ts > DELETE /admin/active-directory/user/:id
      — successful full wipe (acceptance b) > deletes from every audited explicit table in
      dependency-safe order, users last, and never touches DB-handled tables
AssertionError: expected [] to have a length of 1 but got +0
 ❯ src/routes/admin-active-directory-delete.test.ts:425:99
```

Root cause: `admin-active-directory-delete.test.ts:425` still asserts an explicit
`UPDATE customer_alert_settings` op that #2984's original code-level workaround issued. That
workaround was removed by #3105 (`9ae068e10`), which fixed the real FK constraint itself to
`ON DELETE SET NULL` and moved the column into `user-hard-delete.ts`'s DB-handled census-only
list (`user-hard-delete.ts:559-562`). #3105's own commit touched only `user-hard-delete.ts` —
it never updated this test file, leaving the assertion pointing at behavior that no longer
exists. Genuinely unrelated to `msp-active-directory.ts` or this pack's own scope — no code
in this session touches `user-hard-delete.ts` or that test file. Filed as its own issue
(`bug`), parented to #1944 (Feature: Soft Delete and Retention Policy — the same Feature
#2984 and #3105 are already sub-issues of), listed in this build's DONE bookend.

---

## Orphaned-endpoint check

```
grep -rn "msp/active-directory" artifacts/ --include=*.ts --include=*.tsx | grep -v '\.test\.ts'
```

returns only this route file's own definition, its own header comment, and
`admin-active-directory.ts`'s cross-reference comment about the routes it exports for reuse
— **no frontend caller anywhere in the current tree**. Confirmed separately that the admin
panel's `ActiveDirectoryTree.tsx`/`adApi.ts` only call the **different**
`/api/admin/active-directory/ou*` routes (`admin-active-directory.ts`), never this file's
`/api/msp/*` routes. This is expected, current state, not a gap this pack invents: no
`Design/portal/` export names an MSP-console OU-assignment page (confirmed —
`find Design -iname "*active*director*"` returns nothing), and `portal-active-directory.ts`'s
own header states explicitly that the one `.dc.html` export that mentions this area (Policy
Decisions) deliberately excludes it — *"Target settings your MSP holds for you... are
operated on their console"* — with no export actually building that console page yet. All 6
routes are real, live, and mounted (`app.ts:127` → `routes/index.ts:565`) but exercised by no
frontend today.

---

## Not covered by this pack

Per the #1642 pattern, no page/UI-shape decisions are made here. This pack extracts what
exists on the 6 `/api/msp/active-directory/*` routes as built; it does not decide what an
MSP-console OU Assignment page should look like or how it should be laid out. The
department-match Graph-read machinery itself (`policy-compliance-graph.ts`'s
`resolveOuMembers`/mailbox-size/group-membership observation functions) is out of scope
beyond the resolution-order fact cited in §2 — that machinery backs the `mailbox_attribute`/
`group_membership` compliance evaluators, a different surface with its own contract.
