# POA&Ms (MSP Console operator side) — real contract pack extraction

**#3373**, under **#1571** (EPIC: Portal Admin — MSP-side operator surface). `msp-poams.ts` is
real, live, mounted (Git #3080, Phase 1a of #1935) — the MSP-console-authored half of the POA&M
object; the customer-facing signature ceremony lives on the portal side (`portal-poams.ts`,
already documented from the customer's own vantage — this pack covers the MSP-console vantage on
the same underlying table, matching the split the Risk Register pack already established between
its own MSP-console and customer-portal packs).

Read-only. Every field below is extracted verbatim from the route file and the Drizzle schema,
cited to file:line, and cross-checked live against local PostgreSQL. **Nothing here is authored or
invented.** No `Feature:`-titled issue sits directly above #3373 (`gh issue view 3373 --json
parent` resolves straight to #1571, the EPIC) — #1935 ("Feature: POA&Ms (Portal)") is a sibling
Feature over the same underlying object, not this issue's own parent (`gh api
.../issues/1935/sub_issues` lists #3080/#3081/#3094/#3104, not #3373) — so any finding below files
against the #1571 fallback, per this repo's own Feature-first rule.

Backend: `artifacts/api-server/src/routes/msp-poams.ts` — 462 lines, 8 routes, all live, all
mounted (`artifacts/api-server/src/routes/index.ts:288,579`):

- `GET    /api/msp/poams`                               — list this MSP's POA&Ms
- `POST   /api/msp/poams`                                — create one
- `GET    /api/msp/poams/:poamId`                        — one, with its milestones
- `PATCH  /api/msp/poams/:poamId`                         — edit narrative/schedule/status
- `PATCH  /api/msp/poams/:poamId/cancel`                  — mark cancelled
- `POST   /api/msp/poams/:poamId/milestones`              — add a milestone
- `PATCH  /api/msp/poams/:poamId/milestones/:milestoneId` — edit / mark complete
- `DELETE /api/msp/poams/:poamId/milestones/:milestoneId` — remove a milestone

Schema: `lib/db/src/schema/msp.ts:7188` (`mspPoamsTable`), `:7268` (`mspPoamMilestonesTable`).
Verified live against local PostgreSQL (`psql "$DATABASE_URL" -c '\d msp_poams'` / `'\d
msp_poam_milestones'` / a full `pg_constraint` dump) — every column, index, FK and NOT NULL cited
below is confirmed present on the running schema exactly as the Drizzle source declares it. No
`CHECK` constraint exists on either table (both tables' `status` columns are plain `text`) —
confirmed by reading the live constraint list, not assumed from the Drizzle type.

---

## 0. The surface and its consumers

### 0.1 Consumer map — genuinely zero, on either side of this table

`grep -rn "msp/poams" artifacts/ lib/ --include=*.ts --include=*.tsx` returns **only
`msp-poams.ts` itself** — no MCP tool, no AdminV2 store, no test manifest, no other route file
references any `/api/msp/poams*` path. Every one of the 8 routes below is real, live, and
genuinely unconsumed — this is the expected pre-Design/pre-wire state (#1571's fixed 4-step order:
API build-out → Document (this pack) → Design → Implement & wire), not a completeness gap, exactly
like the Risk Register pack's own §0.1 states for its own then-unconsumed rows.

| Endpoint | Method | Route file:line | Consumer today |
|---|---|---|---|
| `/api/msp/poams` | GET | `msp-poams.ts:66-90` | none |
| `/api/msp/poams` | POST | `msp-poams.ts:93-148` | none |
| `/api/msp/poams/:poamId` | GET | `msp-poams.ts:160-190` | none |
| `/api/msp/poams/:poamId` | PATCH | `msp-poams.ts:210-255` | none |
| `/api/msp/poams/:poamId/cancel` | PATCH | `msp-poams.ts:258-291` | none |
| `/api/msp/poams/:poamId/milestones` | POST | `msp-poams.ts:301-343` | none |
| `/api/msp/poams/:poamId/milestones/:milestoneId` | PATCH | `msp-poams.ts:354-417` | none |
| `/api/msp/poams/:poamId/milestones/:milestoneId` | DELETE | `msp-poams.ts:420-460` | none |

`available-checks` / `available-obligations` catalogs are **not duplicated in this file** — the
module's own header (`:25-28`) states `msp-rbd.ts` already serves the identical
`monitor_checks`/`compliance_obligations` catalogs (`msp-rbd.ts:81,111`) and nothing about either
list is POA&M-specific. Confirmed: no `available-checks` or `available-obligations` route exists in
`msp-poams.ts`.

### 0.2 No `Wire*` shape at all — every route returns (or partially returns) the bare row

Unlike `msp-rbd-instances.ts`/`msp-rbd-versions.ts` (which define curated `Wire*` interfaces) and
unlike this same table's **own customer-portal sibling** (`portal-poams.ts:137-153`'s real
`WirePoam`/`WirePoamMilestone`/`WirePoamSignature` shapes), **`msp-poams.ts` defines no wire
interface whatsoever**:

- `GET /api/msp/poams` (`:78-84`) returns a bare array of `mspPoamsTable.$inferSelect` rows — every
  column on the table, unfiltered, unformatted, camelCased only by Drizzle's own inference.
- `GET /api/msp/poams/:poamId` (`:178-184`) returns `{ ...existing, milestones }` — same bare row,
  spread, plus a bare array of `mspPoamMilestonesTable.$inferSelect` rows.
- Every mutating route (`POST`, both `PATCH`s, `DELETE`) returns only a small literal
  `{id/poamId, message}` ack (§1.2–§1.6) — never the updated row.

Concretely, this means an MSP-console UI reading `GET /api/msp/poams` gets `signedAt`/`signedBy`/
`signedStatement` as raw `timestamptz`/`jsonb` values with no `isSigned` boolean and no `isOverdue`
derived flag — both of which `portal-poams.ts`'s `toWirePoam` (`:155-192`) computes for the
customer side of the exact same table. Whoever builds the Design/wire step for this module either
needs a curated `Wire*` shape added to `msp-poams.ts` (matching the discipline `msp-rbd-instances.ts`
already uses) or has to re-derive `isOverdue`/`isSigned` client-side from the raw row — this pack
states the fact, the choice is that later step's to make, not this pack's.

---

## 1. Wire contract — `msp-poams.ts`

### 1.1 List — `GET /api/msp/poams`

`requireAuth, requireRole("MSPOperator")` (`:66-69`). Scoped by `resolveMspIdStrict(req)`
(`:72`, session-derived `req.user.mspId`, never the request body or a query param — contrast
`resolveMspId`'s admin `?mspId=`/`?slug=` override path in `resolve-msp-id.ts:29-52`, which this
route does not use). `403 { error: "MSP context required" }` if unresolved (`:73-76`) — note this
error shape is a bare `{error}` object, not the module's own `apiError`/`ApiErrorCode` helper used
everywhere else in the file; every one of this route's 5 sibling routes repeats the identical
inconsistency (`:100-103`, `:167-170`, `:217-220`, `:265-268`, `:307-310`, `:361-364`, `:427-430`).

Returns every `msp_poams` row for that `mspId`, newest-`id`-first (`:78-82`). Every DB column is on
the wire, verbatim:

| Wire field | DB column | Type | Nullable | Notes |
|---|---|---|---|---|
| `id` | `id` | serial | no | |
| `mspId` | `msp_id` | integer, FK → `msps.id` cascade | no | |
| `poamId` | `poam_id` | text | no | unique per `(mspId, poamId)`; **always server-generated** (§1.2, §4) — never client-supplied on this route |
| `tenantId` | `tenant_id` | text | no | free-text, not a hard FK — same `checkKey`-adjacent reasoning `msp_risk_decisions` already uses |
| `tenantName` | `tenant_name` | text | no | |
| `primaryDomain` | `primary_domain` | text | no | |
| `title` | `title` | text | no | |
| `weaknessDescription` | `weakness_description` | text | no | the real narrative — plays the same role `hazardDescription` does on `msp_risk_decisions` |
| `checkKey` | `check_key` | text | yes | `monitor_checks.key`, deliberately no hard FK |
| `additionalCheckKeys` | `additional_check_keys` | jsonb `string[]` | yes | mirrors `msp_risk_decisions.additionalCheckKeys`'s own multi-check-suppression shape; **no route in this file writes it** — `createPoamSchema`/`updatePoamSchema` both accept it (`:54`, `:196`) and pass it straight through, so it IS writable here, unlike the Risk Register's sibling column which has no writer in that module at all |
| `scheduledCompletionDate` | `scheduled_completion_date` | date | no | the current, live target — may move (§1.4) |
| `originalScheduledCompletionDate` | `original_scheduled_completion_date` | date | no | set identical to the above at creation (`:127-128`), **no route in this file ever writes it again** — `updatePoamSchema` (`:192-207`) has no field for it at all, confirmed by its own inline comment (`:198-199`) |
| `interimCompensatingControl` | `interim_compensating_control` | text | no | |
| `resourcesRequired` | `resources_required` | text | no | |
| `status` | `status` | text | no | `PoamStatus` — `draft \| pending_signature \| active \| completed \| cancelled` (`msp.ts:7185`). **No DB CHECK constraint** — confirmed live, enforcement is entirely at the zod layer, and see §6 for a real gap in that enforcement |
| `authorizingWorkloadId` / `authorizingWorkloadLabel` / `authorizingHolderPersonIds` / `signedByPersonId` | text / text / jsonb `string[]` / text | all yes | the #1511-shaped role-based-accountability audit trail — **written exclusively by `portal-poams.ts`'s sign route** (`:508-511`); no route in `msp-poams.ts` ever touches these four columns, always null for an MSP-authored-and-never-signed-by-a-customer plan |
| `signedAt` / `signedBy` / `signedStatement` | `signed_at` (timestamptz) / `signed_by` (jsonb `ClientApprover`) / `signed_statement` (text) | all yes | same note — the real customer signature ceremony (`portal-poams.ts:501-522`) is the only writer of all three; `msp-poams.ts` only ever reads them back via this list/get route |
| `sowId` | `sow_id` | uuid, FK → `msp_sows.sow_id` set-null | yes | writable at create (`:132`) and edit (`updatePoamSchema` accepts it, `:203`) |
| `createdAt` / `updatedAt` | `created_at` / `updated_at` | timestamptz | no | |

### 1.2 Create — `POST /api/msp/poams`

`requireAuth, requireRole("MSPOperator")` (`:93-96`). Body (`createPoamSchema`, `:47-63`):

| Field | Rule | Notes |
|---|---|---|
| `tenantId`, `tenantName`, `title`, `weaknessDescription`, `interimCompensatingControl`, `resourcesRequired` | `z.string().min(1)` | all required |
| `primaryDomain` | `z.string()` | required, no `.min(1)` guard (unlike the six fields above) — an empty string passes |
| `checkKey` | `z.string().nullable().optional()` | |
| `additionalCheckKeys` | `z.array(z.string()).nullable().optional()` | |
| `scheduledCompletionDate` | `isoDate` (`^\d{4}-\d{2}-\d{2}$`, `:45`) | required |
| `status` | `z.enum(["draft", "pending_signature"])` | **narrower than the column's own `POAM_STATUSES`** — this route can only ever start a plan in one of these two states, by construction, matching the header's own stated intent (`:58-60`) |
| `sowId` | `z.string().uuid().nullable().optional()` | |

No `poamId` field on this schema at all — the caller cannot supply one. Server-derived: `mspId`
(session), `originalScheduledCompletionDate` (set identical to `scheduledCompletionDate`, `:127-
128`), and `poamId` itself — via `randomPlaceholder()` (`poam-ref.ts:24-26`, a
`__pending_<uuid>` value reserved for the single insert so two concurrent creates for the same MSP
can never collide on the real `(mspId, poamId)` unique index) followed by `assignPoamId`
(`poam-ref.ts:32-39`, formats `POAM-2026-<id, zero-padded ≥3 digits>` and swaps it in, guarded
`WHERE poam_id = <placeholder>` so it is safe even if somehow called twice). **This is a real,
deliberate fix over the Risk Register's own historical gap** — `poam-ref.ts`'s own header (`:6-13`)
states it directly: `msp_risk_decisions.rbdId` was client-supplied text and needed a later patch
(#2529) to backfill `registerRef` server-side after the fact; POA&Ms start from that lesson instead
of repeating it, so **no duplicate-`poamId`-collision gap exists here** the way the Risk Register
pack's own §7.3 flags for `rbdId`.

Success `201`: `{id, poamId, message}` (`:138-142`) — the real assigned code, not a placeholder,
since `assignPoamId` runs and resolves before the response is built.

### 1.3 Get one — `GET /api/msp/poams/:poamId`

`requireAuth, requireRole("MSPOperator")` (`:160-163`). Scoped lookup via `loadOwnScoped`
(`:150-157`, `(mspId, poamId)` both required to match — cross-MSP probing 404s exactly like a
nonexistent id, same anti-probing discipline the Risk Register pack documents for its own routes).
Returns `{...existing, milestones}` — milestones ordered `sortOrder` then `id` ascending
(`:178-182`).

### 1.4 Edit — `PATCH /api/msp/poams/:poamId`

`requireAuth, requireRole("MSPOperator")` (`:210-213`). Body (`updatePoamSchema`, `:192-207`) —
every field optional: `title`, `weaknessDescription`, `checkKey`, `additionalCheckKeys`,
`scheduledCompletionDate`, `interimCompensatingControl`, `resourcesRequired`, `sowId`, `status`
(`z.enum(POAM_STATUSES)` — the **full** enum here, wider than create's).

Two guards, in this order:
1. `parsed.data.status === "active"` → `409 CONFLICT`, "A POA&M only becomes active through the
   customer signature ceremony" (`:234-237`) — correctly refuses the one transition that must go
   through `portal-poams.ts`'s sign route.
2. `existing.status === "cancelled" || existing.status === "completed"` → `409 CONFLICT`,
   `"POA&M is {status} and cannot be edited"` (`:238-241`) — refuses editing an already-terminal
   plan.

**Neither guard blocks the incoming `status` value itself from being `"cancelled"` or
`"completed"`** — see §6, a real live finding.

Success: `{poamId, message}` (`:249`) — not the updated row (§0.2).

### 1.5 Cancel — `PATCH /api/msp/poams/:poamId/cancel`

`requireAuth, requireRole("MSPAdmin")` (`:258-261`) — the higher role floor, matching the module
header's own stated intent: "cancelling a plan is the same weight as revoking an RBD" (`:22-23`).
Refuses if already `cancelled`/`completed` (`409 CONFLICT`, `:275-278`); otherwise sets
`status = "cancelled"` only (`:280-283`) — leaves every other column, including `signedAt`/
`signedBy`, untouched. Success: `{poamId, message}` (`:285`).

### 1.6 Milestones — create / edit / delete

All three gated `requireAuth, requireRole("MSPOperator")` (`:301-304`, `:354-357`, `:420-423`) —
**no elevated role for any milestone mutation**, including marking one complete, unlike the
parent's own cancel route.

- **Create** (`createMilestoneSchema`, `:293-298`): `title` (required), `description`
  (nullable/optional), `dueDate` (required `isoDate`), `sortOrder` (`z.number().int().optional()`,
  defaults to `0`, `:332`). Requires the parent to resolve via `loadOwnScoped` first (`:313-317`,
  `404` otherwise). `status` is always server-set to `"pending"` on insert (`:333`) — not accepted
  from the body at all. Success `201`: `{id, message}` (`:337`).
- **Edit / complete** (`updateMilestoneSchema`, `:345-351`): `title`, `description`, `dueDate`,
  `sortOrder` all optional; `status: z.enum(POAM_MILESTONE_STATUSES)` optional (`pending` |
  `completed`). Resolves the parent first, then the specific milestone scoped to that parent
  (`:378-382`, `404 NOT_FOUND` "Milestone not found" if the id doesn't belong to this `poamId`).
  **Genuinely write-once, correctly enforced**: an already-`completed` milestone 409s before the
  update runs at all (`:396-399`, `"This milestone is already completed and cannot be changed"`),
  *and* the actual `UPDATE` statement independently guards `WHERE completed_at IS NULL` (`:409`) —
  belt-and-suspenders against a concurrent double-complete race, matching the same discipline the
  Risk Register pack documents for its own per-line accept/per-version sign guards. Setting
  `status: "completed"` additionally stamps `completedAt: new Date()` (`:406`) server-side; there is
  no path to un-complete a milestone through this route. Success: `{id, message}` (`:411`).
- **Delete**: scoped the same way (parent via `loadOwnScoped`, then the child row filtered on both
  `id` and `poamId`, `:444-446`) — `404 NOT_FOUND` if the milestone doesn't exist or belongs to a
  different parent (`:449-452`, `deleted.length === 0`). No status guard at all — **a `completed`
  milestone can be deleted outright**, unlike a `completed` milestone being un-editable via `PATCH`.
  This is a real, live asymmetry: the write-once discipline that protects a completed milestone
  from being *edited* does not extend to protecting it from being *removed*. Flagged (§7.1) rather
  than filed — deleting a completed milestone is a real-world-plausible correction path (a plan
  gets restructured), and nothing in #3080's own scope or #1935's settled architecture states
  deletion should be blocked once complete; a genuine open design question for whoever builds the
  MSP-console UI, not a stated defect.

---

## 2. Cross-surface edges — the same `msp_poams` / `msp_poam_milestones` tables, two route files

| Edge | Column(s) | Written by | Read by |
|---|---|---|---|
| POA&M identity | `poam_id` | **either side** — `msp-poams.ts:136` (MSP-authored) or `portal-poams.ts:371` (customer-authored, "raise a POA&M to disable the service", #1933) — both via the same `randomPlaceholder`/`assignPoamId` pair (`poam-ref.ts`) | both |
| Real customer signature | `signed_at`, `signed_by`, `signed_statement`, `status → "active"` | **`portal-poams.ts` only** (`:501-522`) — no route in `msp-poams.ts` ever sets these | `msp-poams.ts`'s list/get routes read them back verbatim (§0.2 — no derived `isSigned`/`isOverdue` on this side, unlike the portal side's own `toWirePoam`) |
| Role-based accountability audit (#1511-shape) | `authorizing_workload_id/_label`, `authorizing_holder_person_ids`, `signed_by_person_id` | **`portal-poams.ts` only** (`:508-511`, via `risk-authority.ts`'s `resolveRiskWorkload`/`currentAHolderPersonIds`, reused verbatim, never re-implemented for POA&Ms) | same, read-only on the MSP-console side |
| Cancel | `status → "cancelled"` | `msp-poams.ts`'s dedicated cancel route (`MSPAdmin`, §1.5) — **and, as of this audit, also reachable through `msp-poams.ts`'s own generic PATCH at the lower `MSPOperator` floor (§6)** | both list/get routes |
| Milestone container | `msp_poam_milestones.poam_id` → `msp_poams.id` | real hard FK, `ON DELETE CASCADE` — the one FK-enforced relationship in this module (confirmed live, `msp_poam_milestones_poam_id_fkey`) | both route files' milestone reads |
| SOW tie-in | `sow_id` → `msp_sows.sow_id` | `msp-poams.ts` create/edit (§1.2, §1.4) and `portal-poams.ts` create (`:367`) | both |
| Check key | `check_key` | either side's create/edit | `msp-rbd.ts`'s own `available-checks`/`available-obligations` catalogs are the shared lookup source (§0.1) — no join applied to the `msp_poams` row itself on either side |

---

## 3. Real enum unions and where each is actually enforced

Neither table has a Postgres `pgEnum` type or `CHECK` constraint — confirmed live via
`pg_constraint`. Both status columns are plain `text`, enforced only by whichever zod schema
happens to validate a given write.

| Vocabulary | Values | Where fixed | Enforced by |
|---|---|---|---|
| POA&M `status` | `draft`, `pending_signature`, `active`, `completed`, `cancelled` | `POAM_STATUSES`, `msp.ts:7185` | `createPoamSchema` (`msp-poams.ts:61`, narrowed to `draft`\|`pending_signature`), `updatePoamSchema` (`:206`, full enum, **but see §6 — its acceptance is broader than its own route's stated guarantees**), `portal-poams.ts` (writes `pending_signature` at create, `:366`, and `active` at sign, `:507`, both as literals, not via a shared schema) |
| Milestone `status` | `pending`, `completed` | `POAM_MILESTONE_STATUSES`, `msp.ts:7265` | `createMilestoneSchema` (always `"pending"` on insert, never client-set), `updateMilestoneSchema` (`msp-poams.ts:350`) |

---

## 4. Completeness audit — one real live gap found, everything else genuinely complete

Per this issue's own instruction, all 8 routes were read in full and checked for genuine
incompleteness rather than assumed complete from line count. Result: **7 of 8 routes are
complete and internally consistent with their own documented intent. One is not.**

### 4.1 Live finding — `PATCH /api/msp/poams/:poamId` lets an `MSPOperator` reach `status =
"cancelled"`, bypassing the dedicated cancel route's `MSPAdmin` floor (real, live, confirmed)

The module's own header states the intended role floor directly: *"`MSPOperator` reads and
authors, `MSPAdmin` cancels — cancelling a plan is the same weight as revoking an RBD"*
(`msp-poams.ts:22-23`), and the dedicated `PATCH /api/msp/poams/:poamId/cancel` route enforces
exactly that (`requireRole("MSPAdmin")`, `:261`).

But the generic `PATCH /api/msp/poams/:poamId` route — gated only `requireRole("MSPOperator")`
(`:213`) — accepts `status: z.enum(POAM_STATUSES)` (`updatePoamSchema:206`), which includes both
`"cancelled"` and `"completed"`. Its only two guards (`:234-241`, quoted in full in §1.4) block (a)
the incoming value being `"active"`, and (b) the row's *existing* status already being terminal.
**Neither guard blocks the incoming value being `"cancelled"`.** A plain `MSPOperator` — a role
this same file's header explicitly says should not be able to cancel a plan — can call this route
with `{"status": "cancelled"}` and produce the identical DB state the dedicated, more-privileged
cancel route produces, with no `MSPAdmin` check anywhere on that path. This is not a theoretical
reading: the schema literally validates the value, the row lookup succeeds, and the `UPDATE`
executes it (`:244-247`) — traced end to end, not inferred.

**`"completed"` is affected the same way, with an added wrinkle: it is the *only* path to that
status anywhere in either route file.** No dedicated "mark complete" route exists (contrast
`cancel`'s own dedicated route) — grepping both `msp-poams.ts` and `portal-poams.ts` for the
literal `"completed"` (done above, §1.6) shows it appears only in the milestone-complete guard
clauses, never as a parent-status writer outside this one generic `PATCH`. Whether reaching
`completed` should require an elevated role, a distinct dedicated route, or some other completion
condition (e.g. all milestones complete) was never decided — because, per §0.1, nothing has
consumed this route yet, so nothing has forced the question. That half is a genuine open design
gap, not a confirmed violation the way `cancelled` is.

Filed as **#3452** (see Provenance) against **#1571** — a real, live role-floor bypass, `bug` +
`security`.

### 4.2 Everything else: no half-built markers found

- Both create routes correctly refuse client-supplied `poamId` (§1.2) — no collision-on-insert gap
  exists, unlike the historical `rbdId` case this table's own author explicitly built around
  (`poam-ref.ts:6-13`).
- The milestone write-once discipline (§1.6) is genuinely belt-and-suspenders — a pre-check 409 AND
  an independently-guarded `UPDATE`, not just one or the other.
- `originalScheduledCompletionDate` truly has no rewrite path anywhere in either route file —
  confirmed by reading `updatePoamSchema`'s own field list, not merely trusting its comment.
- Container-scoped mutations (`loadOwnScoped`, milestone create/edit/delete) all correctly re-verify
  `(mspId, poamId)` before touching a child row — no cross-MSP reach found on any of the 8 routes.
- The one inconsistent error shape found (§1.1 — bare `{error}` instead of `apiError`/
  `ApiErrorCode` on the `mspId === null` branch, repeated on all 6 routes that have that branch) is
  real but cosmetic — it still 403s, it just doesn't carry the module's usual structured error
  envelope. Flagged in §1.1, not filed — same "flag, don't file" threshold the Risk Register pack
  applies to its own minor error-shape gaps (that pack's own §7.3).

---

## 5. Open gaps and notes — flagged, not filed

### 5.1 No curated `Wire*` shape (§0.2)

Restated from §0.2: whoever designs/wires the MSP-console UI for this module needs to either add a
`Wire*` shape to `msp-poams.ts` (computing `isOverdue`/`isSigned` server-side, matching the
customer-portal sibling's own `toWirePoam`) or re-derive them client-side from the bare row. Not a
defect — this route file was built with no consumer yet, same reasoning the Risk Register pack
applies to `msp-rbd.ts`'s own missing `Wire*` shape.

### 5.2 Deleting a completed milestone is unguarded (§1.6)

Restated: `DELETE .../milestones/:milestoneId` has no status check, so a `completed` milestone —
otherwise write-once against edits — can be removed outright. A real, live asymmetry; not filed,
since nothing in #3080's scope states this should be blocked.

### 5.3 `additionalCheckKeys` IS writable here, unlike the Risk Register's own version of this column

Noted in §1.1's own table: `msp_risk_decisions.additionalCheckKeys` has no writer anywhere in that
module (the Risk Register pack's own §7.1 finding); this table's equivalent column IS accepted by
both `createPoamSchema` and `updatePoamSchema` on this side, and by `portal-poams.ts`'s own create
schema on the other. Stated as a fact for whoever compares the two modules later, not a gap in
either.

---

## 6. The forbidden list — declared, not merely absent

1. **No cross-MSP read.** All 8 routes scope by `resolveMspIdStrict(req)` (session-derived only,
   never the request body or a query param) — verified on every route, no exception.
2. **Container-scoped milestone mutations re-verify ownership.** Every milestone route resolves the
   parent POA&M via `loadOwnScoped(mspId, poamId)` before touching `msp_poam_milestones`, and the
   milestone's own row is additionally filtered on `poam_id = <parent.id>` — a milestone id that
   exists but belongs to a different parent 404s exactly like one that doesn't exist at all.
3. **No second signature/completion on a milestone.** Both a pre-check 409 and an independently
   guarded `UPDATE ... WHERE completed_at IS NULL` protect against a concurrent double-complete —
   confirmed by reading both the guard clause and the actual `.where()` (§1.6).
4. **`originalScheduledCompletionDate` must never move after creation.** True on every route
   audited — no schema in either file accepts it after insert.
5. **`active` is reachable only through the customer signature ceremony.** True on `msp-poams.ts`'s
   generic PATCH (explicitly refused, `:234-237`) — **but see §4.1: `cancelled` and `completed` are
   NOT held to the same discipline this list's own item 5 implies for the module as a whole.** This
   list item is stated as intended, with §4.1 as the one place that intent is not actually met.

---

## 7. Provenance

Extracted 2026-09-10 for **#3373**, under the reset #1571 EPIC (Portal Admin — MSP-side operator
surface), following the #1642/#2897 (Risk Register) pack's own extraction standard. Read in full,
not sampled: `msp-poams.ts` (462 lines, all 8 routes), `portal-poams.ts` (569 lines, all 4 routes,
for the cross-surface §2 comparison), `poam-ref.ts` (40 lines), the `msp_poams`/
`msp_poam_milestones` Drizzle schema and its own header comment (`lib/db/src/schema/msp.ts:7169-
7289`), and the manual migration that created both tables
(`lib/db/migrations/manual/2026-09-07-poams-schema-3080.sql`). Verified live against local
PostgreSQL — both tables' full column/index/FK/NOT-NULL list re-confirmed to match the Drizzle
source exactly, and confirmed neither table carries a `CHECK` constraint. Confirmed via repo-wide
grep that zero consumers exist for any `/api/msp/poams*` route.

**One real, live finding — filed, not merely noted:** §4.1, a role-floor bypass letting
`MSPOperator` reach `status = "cancelled"` through the generic `PATCH` route despite the module's
own documented `MSPAdmin`-only cancel intent. Filed as **#3452** ("msp-poams.ts generic PATCH lets
MSPOperator bypass the MSPAdmin-gated cancel route"), `bug` + `security`, parented to **#1571**
(no Feature-tier parent exists above #3373 itself), board status set to **AI Batter Up**. No other
route across either file showed a genuine completeness gap (§4.2). No product code, schema, or UI
was changed by this pass.
