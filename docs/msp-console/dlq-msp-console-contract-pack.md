# DLQ (Dead Letter Queue) — MSP Console — contract extraction pack

**For Claude Design. Extracted, not authored — every claim below is cited to file:line against
the code on `main`.** Read-only build: no product code, no schema, no UI were changed to produce
this document. Per #3371's own body: "extract per the #1642 pattern — read-only, every field
cited to file:line, cross-checked live against local Postgres."

Module: **DLQ (MSP Console)**, leaf issue **#3371**, parented directly to **#1571** (EPIC: Portal
Admin — MSP-side operator surface) — #3371 has no Feature-tier parent to check for. Target file:
`artifacts/api-server/src/routes/msp-dlq.ts` (253 lines, 4 routes). No genuine
incompleteness marker (`TODO`/`FIXME`/stub) exists in the file — but §7 below documents two real,
live-verified bugs found by this audit that make two of its four routes effectively broken, which
is a different thing from "incomplete," and the issue body's own instruction ("confirm real
completeness as part of the audit — if any route is genuinely half-built, say so") is answered
honestly there rather than papered over.

**No UI consumes any of these four routes today** — grep-confirmed, zero references to `msp/dlq`
or `bulk-replay` anywhere under `artifacts/*/src` outside the route file itself. This pack is the
input to that screen once one is built, same as #1642's own precedent.

---

## 0. The three surfaces sharing `msp_dlq_store` — read this before designing anything

`msp_dlq_store` (`lib/db/src/schema/msp.ts:785-806`) is one table with **three independent Express
routers** over it, each with a different scope and a different idea of what's safe to replay.
This pack covers surface **A** (#3371's own module) in full; **B** and **C** exist only as far as
needed to explain why A's own bugs (§7) are real and not hypothetical.

| # | Surface | File | Mount | Audience | Scope filter |
|---|---|---|---|---|---|
| **A** | `msp-dlq.ts` (**this issue**) | `routes/msp-dlq.ts` | `/api/msp/dlq*` (via `routes/index.ts:577`) | MSP operator/admin, own MSP only | **none** — every `eventType`, `mspId`-fenced only |
| B | `admin-dlq.ts` | `routes/admin-dlq.ts` | `/api/admin/dlq*` | PlatformAdmin, cross-MSP | none — unfenced by design (file header, `admin-dlq.ts:8-15`) |
| C | `portal-wf-api.ts`'s `/dlq` block | `routes/portal-wf-api.ts:512-574` | `/api/msp/v1/portal-wf/dlq*` (via `routes/msp-v1.ts:64` → `routes/index.ts:636`) | MSP operator/admin, own MSP (session JWT via the `msp-v1` chain) | **`eventType LIKE 'portal_wf.%'` only** (`:516`) |

All three read/write the same rows; a row written by the job-queue drainers (§1, §5) is visible
through A and B, never through C (its own `LIKE` filter excludes it). **Only B (`admin-dlq.ts`)
implements a replayability guard before calling `replayDlqItem`** — its own `isReplayable()`
helper (`:42-46`) checks `payload.workflowKey` and returns a plain 400 for anything else. C never
needs the guard because its own listing filter already excludes anything that could fail it. **A
(this issue's module) has neither the filter nor the guard** — see §7.

---

## 1. Per-route wire contract — `msp-dlq.ts`

Every route: `requireAuth` + a role floor via `requireRole` (ladder-checked,
`middlewares/requireAuth.ts:271-303`), then `resolveMspIdStrict(req)`
(`lib/resolve-msp-id.ts:75-77`) — the caller's own `mspId` straight off the JWT, **no `?mspId=`/
`?slug=` override, not even for PlatformAdmin** (unlike `resolveMspId`, used elsewhere for
cross-MSP admin views). A PlatformAdmin session carries no `mspId` claim, so `resolveMspIdStrict`
returns `null` for one and every route below **403s** with `"MSP context required"` — not an
empty list. (`admin-dlq.ts:10-13`'s own file-header comment claims "the MSP route returns an
empty list for them" — that description is stale relative to this file's actual `if (mspId ===
null)` branch, `:33-36` etc.; the real behavior is the 403 documented here, cited to `admin-dlq.ts`
only to flag the mismatch, not restated as this pack's own claim.)

### 1a. `GET /msp/dlq` (`:26-69`)

No query params read. `resolveMspIdStrict` → 403 if null (`:32-36`). Otherwise:

```ts
db.select({ ...all 14 mspDlqStoreTable columns..., tenantId: tenantsTable.tenantId,
            tenantName: tenantsTable.customerName })
  .from(mspDlqStoreTable)
  .leftJoin(tenantsTable, eq(mspDlqStoreTable.customerId, tenantsTable.id))
  .where(eq(mspDlqStoreTable.mspId, mspId))
  .orderBy(desc(mspDlqStoreTable.createdAt))
```
(`:38-60`) — **every row for the caller's MSP, unresolved or not, any `eventType`** (contrast
surface C, §0). No pagination, no `limit`, no `resolved=` filter — the caller always gets the
full history back in one response (§6: 32 rows live, so not yet a real problem, but no ceiling
exists in the code either).

**Response**: a bare array (`res.json(rows)`, `:62`) — not `{ items, total }` like surface B's
`GET /admin/dlq` (`admin-dlq.ts:94-98`) or surface C's `paginatedResponse` (`portal-wf-api.ts:530`).
Each row is the raw `mspDlqStoreTable.$inferSelect` shape (`lib/db/src/schema/msp.ts:785-806`)
plus `tenantId`/`tenantName` from the join — **no `replayable` field** the way surface B computes
one (`admin-dlq.ts:95`); the client has no signal from this response about whether Replay will
actually succeed for a given row (§7).

| Field | Type | Nullability | Line (schema) |
|---|---|---|---|
| `id` | `number` (serial PK) | never null | `786` |
| `dlqId` | `string` (uuid) | never null, unique | `787` |
| `sourceEventId` | `string \| null` (uuid) | null unless a writer sets it (§5) | `788` |
| `eventType` | `string` | never null | `789` |
| `payload` | `Record<string, unknown>` | never null, defaults `{}` | `790` |
| `errorMessage` | `string` | never null | `791` |
| `errorStack` | `string \| null` | null if not captured | `792` |
| `attemptCount` | `number` | never null, default `1` | `793` |
| `lastAttemptAt` | `Date` (timestamptz) | never null, default now | `794` |
| `resolvedAt` | `Date \| null` | null until resolved | `795` |
| `resolution` | `"replayed" \| "discarded" \| "manual" \| null` | null until resolved | `796` |
| `mspId` | `number \| null` | **nullable** — see §5, §6 (2/32 live rows null) | `797` |
| `customerId` | `number \| null` | **nullable** — 32/32 live rows null today (§6) | `798` |
| `createdAt` | `Date` (timestamptz) | never null, default now | `799` |
| `tenantId` | `string \| null` | joined; null whenever `customerId` is null (always, live) | `tenantsTable.tenantId` |
| `tenantName` | `string \| null` | joined; same as above | `tenantsTable.customerName` |

### 1b. `POST /msp/dlq/:dlqId/replay` (`:73-119`)

`resolveMspIdStrict` → 403 (`:79-83`). Reads the row scoped `(dlqId, mspId)` together (`:88-92`) —
404 if absent (`:94-97`), 409 if `resolvedAt` already set (`:99-102`). Otherwise calls
`replayDlqItem(dlqIdStr)` (`lib/portal-workflow-engine.ts:836-869`) **unconditionally — no
`payload.workflowKey` precheck** (contrast surface B's `isReplayable()` gate, §0/§7).

**Response** (`:107-111`): `{ ok: true, dlqId, newRunId, message }`. `newRunId` is the string
run-id `replayDlqItem` returns (`createRun`'s own id, `portal-workflow-engine.ts:854-858`).

**Failure path**: `replayDlqItem` throws a plain `Error` for four preconditions — not found,
already resolved (both already guarded above, so unreachable here in practice), **`"DLQ item has
no workflowKey in payload"`** (`:847`) whenever `payload.workflowKey` is absent, or the target
workflow simply not existing. The route's `catch` (`:113-117`) turns **any** of these into a bare
**500** via `apiError(res, 500, ApiErrorCode.INTERNAL, msg)` — including the workflowKey case,
which surface B instead heads off with a **400** before ever calling `replayDlqItem` (§7, finding
1).

### 1c. `PATCH /msp/dlq/:dlqId` (`:123-185`)

Body: `patchDlqSchema` (`:15-18`) — `{ resolution?: "discarded" | "manual", payload?:
Record<string, any> }`, both optional, zod-validated (400 on failure, `:137-141`). Note the DB
column's own resolution enum also allows `"replayed"` (`msp.ts:796`) but this route's zod schema
**can never write it** — matches surface B's own deliberate omission for the identical reason
(`admin-dlq.ts:150-151`'s comment: only the replay route may claim a job was actually re-run).

Row scoped `(dlqId, mspId)` (`:144-153`) — 404 if absent. If `resolution` is supplied: 409 if
already resolved (`:158-161`), else sets `resolution` + `resolvedAt = new Date()` (`:162-163`). If
`payload` is supplied: overwrites the column outright (`:166-168`) — **not merged**, a full
replace of the jsonb value; both fields may be set in the same call (mutually independent branches,
`:157` and `:166` are two separate `if`s, not an `else`). At least one of the two being present
isn't enforced — an empty `{}` body validates and performs a real, silent no-op update
(`db.update(...).set({})`, `:170-173`) that still returns 200 `"DLQ item updated successfully"`.

**Response** (`:175-178`): `{ dlqId, message }` — no updated row returned (contrast surface B's
`PATCH /admin/dlq/:dlqId`, which responds `{ ok: true, dlqId, resolution }`, and surface C's own
PATCH, which responds `{ entry: updated }` with the full row).

### 1d. `POST /api/msp/dlq/bulk-replay` — **unreachable at its documented path** (`:189-251`)

Body: `bulkReplaySchema` (`:20-22`) — `{ dlqIds: string[] }`. Empty array short-circuits to `{
replayedCount: 0, messages: [] }` (`:207-211`) before any DB access. Otherwise re-validates
membership: `inArray(dlqId, dlqIds) AND mspId = <caller's>` (`:213-222`) — **any id in the request
that doesn't belong to the caller's MSP is silently dropped**, not reported as an error; the route
never distinguishes "not found" from "not yours" for a bulk id, unlike the single-item PATCH/replay
routes' explicit 404s.

For each surviving id, calls `replayDlqItem(id)` independently inside `Promise.all`, catching each
one's own rejection into `{ dlqId, success: false, error }` (`:230-239`) rather than failing the
whole batch — the same `"...no workflowKey..."` throw from §1b applies **per item** here.

**Response** (`:241-244`): `{ replayedCount: number, results: Array<{ dlqId, success, newRunId? }
| { dlqId, success: false, error }> }`.

**The bug**: this route is registered as `router.post("/api/msp/dlq/bulk-replay", ...)` (`:190`)
— a full `/api/...` path — inside a router that is itself mounted at `/api` already
(`routes/index.ts:577` → `app.ts:127`'s `app.use("/api", ..., router)`). Every sibling route in
this same file (`:26`, `:74`, `:124`) is registered with the correct relative path (`/msp/dlq...`,
no leading `/api`). The real, live-mounted path for this one route is therefore
**`/api/api/msp/dlq/bulk-replay`**, not the `/api/msp/dlq/bulk-replay` its own comment (`:187-188`)
and every natural client expectation would assume. **Confirmed live against the running local dev
server** (`localhost:8080`, no auth needed to observe the routing outcome):

```
POST /api/msp/dlq/bulk-replay      → 404 (Express finds no matching route)
POST /api/api/msp/dlq/bulk-replay  → 401 (route exists — reached requireAuth, rejected for no token)
```

Filed as **#3445** (finding 1, §7).

---

## 2. Real enum unions

```ts
// lib/db/src/schema/msp.ts:796 — msp_dlq_store.resolution (real DB CHECK-backed enum)
DLQ_RESOLUTION = "replayed" | "discarded" | "manual"

// artifacts/api-server/src/routes/msp-dlq.ts:16 — patchDlqSchema's own zod enum,
// a strict SUBSET of the above — "replayed" is deliberately excluded (§1c)
PATCH_DLQ_RESOLUTION (client-writable) = "discarded" | "manual"

// live data (msp_dlq_store.event_type, §6) — NOT a DB CHECK constraint, bare text()
// (lib/db/src/schema/msp.ts:789) — this is the only vocabulary observed today
msp_dlq_store.event_type (observed) = "zoho_upsert_lead" | "zoho_books_create_expense"
                                     | "zoho_desk_create_ticket"
// the portal workflow engine's own convention (currently 0 live rows, §6):
// `portal_wf.run.failed:<workflowKey>` (lib/portal-workflow-engine.ts:499)
```

---

## 3. Where rows actually come from — every writer of `msp_dlq_store`

Four independent writers, all funneling into the same table, none aware of each other:

| Writer | File:line | `eventType` written | `payload` shape | Has `workflowKey`? |
|---|---|---|---|---|
| Portal workflow engine (exhausted retries) | `lib/portal-workflow-engine.ts:497-510` (`routeToDlq`) | `` `portal_wf.run.failed:${workflowKey}` `` | `{ runId, workflowKey, inputPayload }` | **yes** — the only writer that sets it |
| Generic job queue (`msp_job_queue`, unhandled type) | `lib/msp-jobs.ts:184-192` | `row.job_type` (raw) | `row.payload` (raw job payload, whatever shape the producer used) | no |
| Generic job queue (exhausted retries) | `lib/msp-jobs.ts:228-237` | `row.job_type` | same | no |
| Zoho batch drain (no handler / exhausted) | `lib/zoho-batch-drain.ts:229-239, 271-281` | `row.job_type` (e.g. `zoho_upsert_lead`) | raw Zoho job payload | no |
| EngageBay batch drain (no handler / exhausted) | `lib/engagebay-batch-drain.ts:170-180, 211-221` | `row.job_type` | raw EngageBay job payload | no |
| `lib/dlq.ts`'s own `enqueueDlq()` helper | `:50-76` | caller-supplied | caller-supplied | only if the caller happens to pass one |

**Only the first writer ever produces a row `replayDlqItem` can actually process.** The other three
(and any caller of the generic `enqueueDlq()` that doesn't happen to pass a `workflowKey`) produce
rows that are permanently non-replayable through *any* of the three surfaces in §0 — surface A and
B both let a caller try anyway (A has no guard at all; B's `isReplayable()` catches it before the
call). This is not a defect in those three writers — a Zoho lead-sync failure has no "workflow run"
to recreate, `replayDlqItem`'s model just doesn't fit it — but it means `msp-dlq.ts`'s own Replay
button is a real, evidenced trap for exactly the kind of row this MSP-facing surface is most likely
to show a technician (§6).

`lib/dlq.ts` additionally exports `listDlqItems()` (`:83-93`) and `incrementDlqAttempt()`
(`:119-127`) — **both grep-confirmed dead code, zero call sites anywhere in
`artifacts/api-server/src`.** `msp-dlq.ts` builds its own inline `db.select` (§1a) rather than
calling `listDlqItems()`, and nothing anywhere calls `incrementDlqAttempt()` — `attemptCount` is
only ever set at insert time (defaults to `1`, or an explicit value from a writer) and never
incremented again by any live code path, contradicting `docs/runbooks/dlq-replay.md`'s own
description of the replay step (see §7, finding 3).

---

## 4. Object/table map

| Concept | Table | Scoped by | Line (schema) |
|---|---|---|---|
| A parked failed item | `msp_dlq_store` | `mspId` (nullable), `customerId` (nullable) | `msp.ts:785-806` |
| The MSP the item belongs to | `msps` | `mspDlqStoreTable.mspId` | referenced, no FK declared |
| The customer/tenant the item concerns | `tenants` | `mspDlqStoreTable.customerId` ⋈ `tenants.id` | join in `:57-58` |
| Where retryable jobs actually live before landing here | `msp_job_queue` | `mspId`, `customerId` | `msp.ts:1083-1103` |

`mspDlqStoreTable.mspId`/`.customerId` are plain nullable `integer` columns — **no FK constraint
declared** on either (confirmed by the schema block, `msp.ts:785-806`, no `.references()` call
present, unlike `msp_job_queue.mspId` at `:1088` which does reference `mspsTable.id`). A row can
carry any integer in either column, or null, with nothing at the DB level to catch a stale/deleted
reference — consistent with this being a diagnostic/ops table, not a transactional one.

---

## 5. Cross-surface and structural facts

- **`replayDlqItem` never touches `attemptCount` or `lastAttemptAt`.** Its only writes are the new
  run's own `createRun` insert and, on the DLQ row itself, `resolvedAt` + `resolution: "replayed"`
  (`lib/portal-workflow-engine.ts:854-864`). The atomic-increment helper that *would* update those
  two fields (`lib/dlq.ts:119-127`, `incrementDlqAttempt`) is never called from this path — or
  from anywhere (§3).
- **A replay creates a brand-new workflow run; it does not retry the failed thing in place.**
  `replayDlqItem` calls `createRun({ workflowKey, tenantContext, inputPayload })`
  (`portal-workflow-engine.ts:854-858`) — a fresh `portal_wf_runs` row with its own new id, then
  fires `executeRunAsync(newRunId)` (`:866`) and marks the *original* DLQ row resolved. The
  original run (if one ever existed for a `portal_wf.*` failure) is not itself re-executed; a new
  one is, whose only link back to the DLQ item is the returned `newRunId` in the response body.
- **`PATCH /msp/dlq/:dlqId`'s two optional fields are independent, not exclusive** — a single call
  can both resolve the item and rewrite its `payload` (§1c). No route in any of the three surfaces
  offers a way to edit `payload` and *then* replay with the edited value — `replayDlqItem` always
  re-reads whatever is currently stored at call time, so a technician wanting to "fix and retry" a
  bad payload must PATCH first, then separately POST replay, in two calls with no atomicity between
  them.
- **This route never calls the shared `lib/dlq.ts` helpers for its own reads or resolves** — it
  reimplements the `SELECT`/`UPDATE` inline (`:38-60`, `:170-173`) rather than calling
  `listDlqItems()`/`resolveDlqItem()`, which surface B (`admin-dlq.ts:32`, `:180`) does use. Not a
  bug — the inline queries are correct and add the tenant join `listDlqItems()` doesn't have — but
  it means a future change to `lib/dlq.ts`'s resolve semantics would not automatically apply here.

---

## 6. The honest-empty contract, confirmed against live data this session

Queried directly against local `DATABASE_URL` (PostgreSQL 18), all counts real and current as of
this session:

| Query | Result |
|---|---|
| `msp_dlq_store` total rows | **32** |
| `event_type` distribution | `zoho_upsert_lead`: 29, `zoho_books_create_expense`: 2, `zoho_desk_create_ticket`: 1 |
| Rows with `resolution` set (any value) | **0 of 32** — every row is still unresolved |
| Rows with `resolved_at` non-null | **0 of 32** |
| Rows with `payload ? 'workflowKey'` (i.e., replayable via `replayDlqItem`) | **0 of 32** |
| `mspId` null vs. set | null: 2, set: 30 |
| `customerId` null vs. set | **null: 32 of 32** — every row today is MSP-scoped only, no customer attached |
| `attemptCount` distribution | all 32 rows at exactly `3` (the retry ceiling, `msp-jobs.ts`'s `maxAttempts` default) |

**Every single live row in `msp_dlq_store` today is a Zoho job-queue failure, and none of them are
replayable through this module's own Replay/bulk-replay routes** — not a hypothetical from §3's
writer-shape analysis, but the actual current state of the table this issue's route reads from. A
technician who opens this surface, sees 32 unresolved items, and clicks Replay on any one of them
today gets a bare 500 (§1b) with no better error text than `"DLQ item has no workflowKey in
payload"`. This is a genuinely different honest-empty than "nothing has failed yet" — 32 real
failures exist and are visible, the visible action on them is the one that's broken.

---

## 7. Open questions and genuine gaps found this session

Three new, concrete, live-verified gaps, filed as sibling sub-issues of **#1571** (the fallback
area epic — #3371 has no Feature-tier parent, checked via `gh issue view 3371 --json parent`):

- **#3445 — `POST /api/msp/dlq/bulk-replay` is mounted at a double-prefixed path and is 404 at the
  path every sibling route in the same file, and any reasonable client, would expect.** §1d.
  Live-verified: `POST /api/msp/dlq/bulk-replay` → 404, `POST /api/api/msp/dlq/bulk-replay` → 401
  (route exists one level deeper than intended). One-line fix (drop the `/api` prefix in the route
  string at `msp-dlq.ts:190` to match `:26`/`:74`/`:124`), left to whoever picks this up rather than
  applied here, per this pack's read-only scope.
- **#3446 — `msp-dlq.ts`'s Replay and Bulk Replay routes have no replayability precheck, unlike
  their sibling `admin-dlq.ts` routes, and every live row hits the failure case.** §1b, §1d, §6.
  `replayDlqItem` throws `"DLQ item has no workflowKey in payload"` for any row not written by the
  portal workflow engine; `admin-dlq.ts`'s `isReplayable()` (`:42-46`) checks for this before ever
  calling it and returns an actionable 400. `msp-dlq.ts` has no equivalent check on either its
  single-item or bulk replay route, and — confirmed live — **0 of the 32 real rows in the table
  today would pass it**, so the Replay action this module exposes fails for literally everything a
  technician could currently click it on.
- **#3447 — `docs/runbooks/dlq-replay.md` describes replay mechanics that don't match any real
  code path.** Step 3 of that runbook states replay "increments `attemptCount` and sets
  `lastAttemptAt` atomically" and "re-dispatches the original payload to the event handler." Neither
  is true of `replayDlqItem` (`portal-workflow-engine.ts:836-869`), which creates an entirely new
  workflow run via `createRun` and never touches `attemptCount`/`lastAttemptAt` (§5) — the helper
  that *would* do the increment the runbook describes, `lib/dlq.ts:119-127`'s
  `incrementDlqAttempt()`, is dead code with zero call sites anywhere (§3). The runbook's stated API
  paths (`/api/msp/v1/portal-wf/dlq...`) do correctly match surface C, so this isn't a
  wrong-surface mixup — it's the mechanics description on an otherwise-correctly-targeted doc that
  no longer matches what the code it points at actually does.

Not filed, self-documented/moot instead:
- `admin-dlq.ts:10-13`'s file-header comment claiming the MSP route (this module) "returns an
  empty list" for a PlatformAdmin is inaccurate (the real behavior is a 403, §1) — noted in §1's own
  text rather than filed separately; it's a one-line rationale comment in a *different* file with
  no behavioral consequence of its own, not a gap in this module.
- The lack of a `replayable` flag or any `eventType` filter on `GET /msp/dlq` (§1a) is the direct
  cause a technician would ever reach the broken Replay button in the first place, but it's the
  same root cause as #3446, not a second, independent gap — fixing #3446 properly (surfacing
  *why* a row can't be replayed) would naturally also address this.
