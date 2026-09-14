# Training Sessions — MSP Console contract extraction pack

**#4079**, part of Feature #3768 ("Projects/Milestones + Communications/Training/
Workflows/Agents nav placement"). Real, confirmed backend, no pack existed for this
module anywhere in `docs/msp-console/` before this pass, and it is on the "Not yet
covered" route list in `Design/MSP_Console/design_handoff_msp_console/github.md`
(`:166`, `:188`). This pack is a prerequisite for a future Design pass under #3768 —
no design or UI work happens in this issue, read-only extraction only.

Method per #1642. Read-only. Every field below is extracted verbatim from the
route's own logic and the Drizzle schema, cited to file:line, cross-checked live
against local PostgreSQL. **Nothing here is authored or invented.** No product
code, schema, or UI was touched to produce this document.

Backend route (one file, five routes — all real, all reachable):

- `msp-training-sessions.ts` (290 lines), registered `routes/index.ts:141,487`
  (`import mspTrainingSessionsRouter from "./msp-training-sessions.ts"` /
  `router.use(mspTrainingSessionsRouter)`).

Schema: `lib/db/src/schema/msp.ts:9858-9890` (`trainingSessionsTable` /
`training_sessions`). Re-verified live against local PostgreSQL
(`psql "$DATABASE_URL" -c '\d training_sessions'`): the live table matches the
Drizzle source exactly — same 10 columns, same three indexes
(`training_sessions_msp_id_idx`, `training_sessions_customer_id_idx`,
`training_sessions_customer_date_idx`), same `session_type` CHECK constraint, same
two FKs (`logged_by_user_id → users.id`, `msp_id → msps.id ON DELETE CASCADE`).

---

## 0. Same shape family, same auth pattern as `msp-status-reports.ts`

The route's own header comment states this is "same shape family as
`msp_status_reports` (#3762)" (`:9852`), and the code confirms it: every route
gates on `requireCapability("ladder.msp-operator")` (admits MSPOperator, MSPAdmin,
PlatformAdmin) plus `assertCustomerAccess` on every `:customerId`-scoped route
(`:27-33`). The two `:id`-only routes resolve the row first, then run the exact
same `assertCustomerAccess` check against the row's own stored `customerId` — a
session belonging to another MSP's customer 404s, never confirming existence
(`:200-202`, `:228-230`, `:276-278`). This is the identical floor-plus-ownership
pattern already documented for `msp-status-reports.ts`
(`docs/msp-console/status-reports-msp-console-contract-pack.md` §0) and
`msp-retainer.ts` (`docs/msp-console/retainer-hours-msp-console-contract-pack.md`
§1) — not a one-off invented for this module.

**One real difference from `msp-status-reports.ts`:** there is no `state` machine
here at all — no draft/published, no lock, no irreversible transition. Every field
on a session remains editable via `PATCH` for the life of the row (§1.4), and
`DELETE` is unconditional once ownership is confirmed (§1.5). This module is a
simple append/edit/delete log, not a workflow.

---

## 1. Wire contract — the five routes, verified against current code

Source: `msp-training-sessions.ts`, read in full on `main` at pack time
(2026-09-14).

Auth floor on **every** route: `requireCapability("ladder.msp-operator")`
(`:86`, `:130`, `:189`, `:219`, `:267`) — same capability as
`msp-status-reports.ts`, `msp-break-glass.ts`, `msp-retainer.ts`. Every
`:customerId`-scoped route additionally calls `assertCustomerAccess`
(`:95`, `:136`). The two `:id`-only routes (§1.3–§1.5) resolve the session row
first, then run the exact same `assertCustomerAccess` check against
`row.customerId`/`existing.customerId` (`:200`, `:228`, `:276`).

### 1.1 `POST /msp/customers/:customerId/training-sessions` — log a session

`:84-123`. `customerId` parsed from the URL param, 400 if not numeric (`:88-89`).
`mspId` resolved via `resolveMspIdStrict(req)` (`:92`) — the caller's own session
`mspId` claim, **not** a route param and **not** query-overridable, even for
PlatformAdmin (`resolve-msp-id.ts:76-78`) — 403s `{ error: "MSP context required" }`
if absent (`:93`), before `assertCustomerAccess` even runs (`:95-97`).

Body (`createSchema`, `:67-72`):

| Field | Type | Constraint |
|---|---|---|
| `sessionType` | `string` | one of `TRAINING_SESSION_TYPES` (§3), required |
| `sessionDate` | `string` | ISO datetime, offset required (`z.string().datetime({ offset: true })`) |
| `topic` | `string` | trimmed, 1–500 chars |
| `notes` | `string` | optional, trimmed, max 10,000 chars |

400 with `{ error: "Invalid request body", details: <zod flatten> }` on schema
failure (`:100-102`). On success, inserts with `loggedByUserId: req.user!.id`
(`:113`) — the logged-by identity is always the calling session's own `users.id`,
never client-supplied, exactly `msp-status-reports.ts`'s `authoredByUserId`
discipline. Returns `201 { session: <wire shape, §2> }` (`:117`), with
`loggedByName` populated inline from `req.user!.name` (`:117`) rather than a
follow-up query — the only route in this file that skips the batched/single
name-lookup pattern §1.2/§1.3/§1.4 use, since the creating user's own name is
already on the request.

### 1.2 `GET /msp/customers/:customerId/training-sessions` — list, paginated

`:128-182`. `assertCustomerAccess` first (`:136-138`). Pagination (`:140-143`):
`?limit=` clamped to `[1,200]`, default `50`; `?offset=` clamped to `>= 0`, default
`0` — both fall back to their default on a non-finite parse rather than erroring,
identical clamp logic to `msp-status-reports.ts:137-140`.

Query: `where customerId = :customerId`, `orderBy desc(sessionDate)`
(`:145-151`) — ordered by the session's own `sessionDate`, **not** `createdAt`, so
a late-logged session for an earlier date sorts by the date it actually covers
(same discipline as status reports' `asOfDate` ordering).

`loggedByName` for every row is resolved in one batched follow-up query
(`inArray(usersTable.id, loggedByIds)`, `:153-159`) — not one query per row, same
pattern as `msp-status-reports.ts:150-157`.

Every list call additionally writes a privileged-read audit entry
(`auditPrivilegedRead`, `:162-170`) with `actionType:
"training_session.list_viewed"`, `entityType: "training_session"`, `tenantId:
customerId`, `metadata: { count: rows.length }`. **This is new relative to
`msp-status-reports.ts`, which has no audit call anywhere in its file** — a real,
one-directional divergence between these two otherwise-identical-pattern sibling
modules, not a bug on either side.

Response (`:172-176`):

| Field | Type | Source |
|---|---|---|
| `sessions` | array | see wire shape below |
| `limit` | `number` | the clamped/defaulted value actually applied |
| `offset` | `number` | the clamped/defaulted value actually applied |

Real empty state: a customer with zero sessions returns `{ sessions: [], limit,
offset }` — an honest empty array, not a fixture (confirmed live, §4).

### 1.3 `GET /msp/training-sessions/:id` — one session

`:187-212`. `id` parsed from the URL param, `404 { error: "Not found" }` if not
numeric (`:192`) — a malformed id 404s rather than 400ing, matching
`msp-status-reports.ts:179`. Row-then-ownership check: fetches by `id` first, 404
if no row (`:196`), then `assertCustomerAccess` against `row.customerId`, 404 (not
403) if it fails (`:200-202`) — "not found" and "not yours" are the same response,
per the file header's own stated discipline (`:198-199`). `loggedByName` resolved
by a single one-off lookup (`:204`) — the one-row case doesn't need the batched
`inArray` §1.2 uses.

### 1.4 `PATCH /msp/training-sessions/:id` — edit any field

`:217-260`. Same row-then-ownership resolution as §1.3 (`:225-230`).

Body (`patchSchema`, `:74-79`) — all four fields optional, same per-field
constraints as `createSchema`, plus `notes` accepts explicit `null` to clear it
(`.nullable().optional()`, `:78`):

| Field | Type | Constraint |
|---|---|---|
| `sessionType` | `string` | optional, one of `TRAINING_SESSION_TYPES` |
| `sessionDate` | `string` | optional, ISO datetime, offset required |
| `topic` | `string` | optional, trimmed, 1–500 chars |
| `notes` | `string \| null` | optional; `null` clears, `undefined` leaves untouched |

400 on schema failure (`:233-235`); 400 `{ error: "No fields to update" }` if the
parsed body is an empty object (`:236-238`) — an empty PATCH is rejected, not a
silent no-op 200, identical to `msp-status-reports.ts:227-229`. Only the fields
actually present in the body are set in the `UPDATE` (`:242-247`); `updatedAt` is
always bumped (`:247`). **Unlike `msp-status-reports.ts`, there is no `state` to
gate on** — every field remains editable regardless of the session's age or
whether it's already been logged and reviewed; this module has no
draft/published-style lock at all (§0).

### 1.5 `DELETE /msp/training-sessions/:id` — delete a session

`:265-288`. Same row-then-ownership resolution as §1.3–§1.4 (`:273-278`).
Unconditional hard delete once ownership is confirmed (`:280`) — no soft-delete
column, no audit call on this route (unlike §1.2's list-view audit), success
`204` with an empty body (`:282`). **This is the one route in this file with no
counterpart anywhere in `msp-status-reports.ts`**, which has no delete route at
all — a status report can be edited or published but never removed, while a
training session can be removed outright. A real, deliberate divergence between
the two sibling modules, not an oversight on either side (status reports' own
pack, §6 item 4, documents its own lack of an unpublish/delete path as
deliberate for v1).

---

## 2. Wire shape — `sessionToWire()` (`:52-65`)

Every route above returns this same shape, either as `{ session: {...} }` (§1.1,
1.3–1.5) or as `sessions: [...]` (§1.2):

| Field | Type | Source |
|---|---|---|
| `id` | `number` | `row.id` |
| `customerId` | `number` | `row.customerId` |
| `sessionType` | `"lunch_and_learn" \| "how_to" \| "prompt_a_thon" \| "ask_me_anything"` | `row.sessionType` — real enum, §3 |
| `sessionDate` | `string` (ISO) | `row.sessionDate.toISOString()` |
| `topic` | `string` | `row.topic` |
| `notes` | `string \| null` | `row.notes` |
| `loggedByUserId` | `number` | `row.loggedByUserId` |
| `loggedByName` | `string \| null` | resolved `usersTable.name` for `loggedByUserId`; `null` if the join found no name — same no-fallback discipline as `msp-status-reports.ts`'s `authoredByName` (that pack's §2), not the `#<id>` synthesized-string fallback `msp-break-glass.ts` uses |
| `createdAt` | `string` (ISO) | `row.createdAt.toISOString()` |
| `updatedAt` | `string` (ISO) | `row.updatedAt.toISOString()` |

---

## 3. Real enum union

Pulled verbatim from the schema (`lib/db/src/schema/msp.ts:9858-9863`), verified
live via the table's own CHECK constraint (§4):

```ts
// msp.ts:9858 — training_sessions.session_type
TRAINING_SESSION_TYPES = [
  "lunch_and_learn",
  "how_to",
  "prompt_a_thon",
  "ask_me_anything",
] as const
```

A real, closed 4-value enum — the DB's own `text(..., { enum: TRAINING_SESSION_TYPES })`
column type plus the live CHECK constraint (`training_sessions_session_type_check`)
make an out-of-set value unreachable in practice; `entryToWire`-style code has no
`?? row.sessionType` raw-value fallback anywhere in this file because none is
needed (unlike `admin-retainer.ts`'s `entryToWire`, which does carry one for a
looser column).

---

## 4. Live-data state — honest, confirmed empty, and why

```
psql "$DATABASE_URL" -c "SELECT count(*) FROM training_sessions;"
```

**0 rows**, confirmed live 2026-09-14. A true, honest "never happened" state, not
a bug: no design export nor any page in `artifacts/msp-console/src` or
`artifacts/portal/src` calls any training-sessions endpoint yet (confirmed —
`artifacts/msp-console/src/api/` has no `training-sessions-api.ts`, and no `.tsx`
anywhere under `artifacts/msp-console/src` or `artifacts/portal/src` references
`/training-sessions`). This module's own Design phase has no issue number yet —
it is explicitly blocked on #3768's real nav placement (route header, `:34-36`),
which is this issue's own parent Feature. Every route in §1 therefore reads as
genuinely empty for every real tenant in this database today (`{ sessions: [] }`
for §1.2; a bare 404 for §1.3–1.5 against any id, since no row exists to resolve)
— the real query result, not a fixture fallback.

Live schema cross-check, same pass: `\d training_sessions` matches the Drizzle
source exactly — column set, types, defaults, both FKs, all three indexes, and the
`session_type` CHECK constraint all confirmed live (§ header above).

No reverse foreign key references `training_sessions.id` anywhere in the schema
(`pg_constraint` query against `confrelid = 'training_sessions'::regclass`
returns zero rows) — this table is a leaf, not a parent of any other row.

---

## 5. Cross-surface edges

- **Data-rights / retention purger, already wired.** `training_sessions` is one of
  five targets in `mspConsoleTrackingPurger`
  (`artifacts/api-server/src/lib/retention/purgers/modules.ts:449-459`), purged by
  `customer_id` alongside `msp_status_reports`, `kanban_buckets`,
  `communications_pushes`, and `automation_registry` when a tenant's data-rights
  erasure runs. This is real and CURRENT — not a gap this pack needs to file.
- **Same shape family as `msp_status_reports` (#3762)**, per the schema's own
  comment (`:9850-9852`) — a real, operator-authored narrative record scoped by
  `mspId`, with `customerId` as `tenants.id` and deliberately no FK, matching the
  "successor id-space, no FK by design" convention `msp_status_reports` and
  `kanban_buckets` already use. A Design pass for #3768 can reasonably treat this
  module's card/list affordances as siblings of the status-reports list, rather
  than inventing a new pattern.
- **No relationship to `msp_change_requests`, `retainer_work_log`, or any other
  MSP-console narrative table.** Confirmed by the full file read:
  `msp-training-sessions.ts` imports only `trainingSessionsTable` and
  `usersTable` (plus `TRAINING_SESSION_TYPES`), no join to any other MSP-console
  table. Unlike change controls/remediation items, there is no
  `logRetainerWorkFromTracker`-style byproduct hook anywhere in the codebase for
  training sessions (`grep -rn "trainingSessionsTable" artifacts/api-server/src`
  matches only this route file and its own schema import) — logging a training
  session never writes a retainer-hours ledger row as a side effect, and nothing
  else writes into `training_sessions` either.
- **`loggedByName` can legitimately be `null`** on any row where the logger's
  `usersTable.name` is unset — same no-fallback discipline as
  `msp-status-reports.ts`'s `authoredByName` (§2). A Design/wiring session should
  treat `loggedByName: null` as a real, reachable case to render, not an edge case
  that can't occur.
- **Sibling uncovered modules from the same build wave** (`Design/MSP_Console/design_handoff_msp_console/github.md:166,188`):
  `msp-kanban.ts` and `msp-communications-push.ts` are also still uncovered by any
  contract pack as of this pass — out of scope for #4079, noted here only so a
  future session picking up either doesn't need to re-discover that context.

---

## 6. The forbidden list — declared, not merely absent

1. **No cross-customer read.** Every `:customerId`-scoped route resolves through
   `assertCustomerAccess` before any query runs; the two `:id`-only routes
   additionally re-check `assertCustomerAccess` against the resolved row's own
   `customerId`. A session belonging to another MSP's customer 404s, never a
   distinguishable 403 (§1.3–1.5).
2. **No route in this module fabricates a training session.** Every read is a
   real, derived query; a customer with zero sessions returns an honest empty
   array (§4), never a fixture.
3. **`loggedByUserId` is never client-supplied.** It is always `req.user!.id`
   from the authenticated session at creation time (§1.1) and is never accepted
   as a PATCH field (§1.4's schema has no such field).
4. **No workflow/state lock exists on this surface.** Every field remains
   editable via PATCH for the life of the row, and delete is unconditional once
   ownership is confirmed — there is no draft/published, no approval, no
   irreversible transition anywhere in this file (§0, §1.4, §1.5).
5. **No AdminV2 or customer-Portal counterpart exists for this table.** Confirmed
   by repo-wide grep: `trainingSessionsTable`/`TRAINING_SESSION_TYPES`/
   `training_sessions` appear only in `msp-training-sessions.ts`, the schema file,
   the migration file, and the retention purger (§5) — no `admin-training*.ts`,
   no `portal-training*.ts` exists anywhere in `artifacts/api-server/src/routes/`.
   This is a single-surface module, MSP-console-operator-only, unlike
   retainer hours or status reports' broader surface families.

---

## 7. Provenance

Written 2026-09-14 against `main` (branch `agent/4079-q2754`), for #4079, part of
Feature #3768. Read in full, not sampled: `msp-training-sessions.ts` (290 lines),
the schema block in `lib/db/src/schema/msp.ts:9858-9890`, the migration
`lib/db/migrations/manual/2026-09-12-training-sessions-3770.sql`, and
`resolve-msp-id.ts` (109 lines, for the `resolveMspIdStrict` citation in §1.1).
Verified live against local PostgreSQL: the `training_sessions` table's real
schema confirmed to match the Drizzle source exactly (columns, indexes, FKs, CHECK
constraint), confirmed to hold 0 rows (§4), and confirmed to have zero reverse
foreign-key references. Confirmed via repo-wide grep that no UI consumer, no
AdminV2 route, and no customer-Portal route exists anywhere for this table (§4,
§6 item 5). `docs/msp-console/status-reports-msp-console-contract-pack.md` used as
the format precedent per the standing per-module contract-pack convention, since
`msp-training-sessions.ts`'s own header comment states it is the same shape family
— no content duplicated from it beyond the shared auth-pattern and shape-family
citations in §0/§5. No product code, schema, or UI was changed by this pass.

**Completeness confirmed, no half-built routes found.** All five routes are fully
implemented, error-handled, and reachable — no route in this file returns a stub,
a TODO, or an unimplemented branch. The only real gap is the complete absence of a
UI consumer (§4), which is the expected, correct state at this point in the
Feature's build order (architect → endpoints #3770 → **this pack** → Design →
wire), not a defect.
