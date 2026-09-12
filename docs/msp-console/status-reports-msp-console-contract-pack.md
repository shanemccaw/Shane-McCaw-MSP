# Status Reports — MSP Console contract extraction pack

**#3763**, under Feature #3434 phase 2 of 4 ("Contract pack") — the standing
sequence for #3434's work is fixed: **architect → build the endpoints → regenerate
the contract pack from the real code → Design → wire.** Phase 1 (the endpoints) is
#3762, confirmed shipped and merged to `main` (`build-journal/3762.md`, commit
`02d8db7f8`) before this pack was started, per this issue's own `--blocked-by 3762`.
Phase 3 (Design, #3764) and phase 4 (portal wiring, #3765) are both explicitly
blocked on this pack, per the schema header comment (`msp.ts:9475-9479`).

Method per #1642. Read-only. Every field below is extracted verbatim from the
route's own logic and the Drizzle schema, cited to file:line, cross-checked live
against local PostgreSQL. **Nothing here is authored or invented.** No product
code, schema, or UI was touched to produce this document.

Backend route (one file, five routes — all real, all reachable):

- `msp-status-reports.ts` (291 lines), registered `routes/index.ts:129,460`
  (`import mspStatusReportsRouter from "./msp-status-reports"` /
  `router.use(mspStatusReportsRouter)`).

Schema: `lib/db/src/schema/msp.ts:9475-9526` (`mspStatusReportsTable` /
`msp_status_reports`). Re-verified live against local PostgreSQL
(`psql "$DATABASE_URL" -c '\d msp_status_reports'`): the live table matches the
Drizzle source exactly — same 11 columns, same three indexes
(`msp_status_reports_msp_id_idx`, `msp_status_reports_customer_id_idx`,
`msp_status_reports_customer_state_idx`), same `state` CHECK constraint, same two
FKs (`authored_by_user_id → users.id`, `msp_id → msps.id ON DELETE CASCADE`).

---

## 0. Deviation from the originally-specified auth pattern — real, documented

Whatever earlier planning referenced a `requireMspScope`-style call for this
module, **the shipped code does not use one.** Every route in `msp-status-reports.ts`
gates on `requireCapability("ladder.msp-operator")` (file header, `:29-32`) plus
`assertCustomerAccess` on every `:customerId`-scoped route and, on the two
`:id`-only routes, the identical check re-run against the row's own stored
`customerId` once it's resolved (`:33-35`) — this pack documents that real,
as-shipped pattern, not the originally-specified one. It is the same
floor-plus-ownership pattern `msp-break-glass.ts` and `msp-diagnostics.ts` already
use (see `docs/msp-console/break-glass-msp-console-contract-pack.md` §1/§3 for the
precedent), not a one-off invented for this module.

---

## 1. Wire contract — the five routes, verified against current code

Source: `msp-status-reports.ts`, read in full on `main` at pack time (2026-09-12).

Auth floor on **every** route: `requireCapability("ladder.msp-operator")` — admits
`MSPOperator`, `MSPAdmin`, `PlatformAdmin` (same capability as
`msp-break-glass.ts`, `msp-remediation-tracker-scores.ts`, `msp-engine-history.ts`).
Every `:customerId`-scoped route additionally calls `assertCustomerAccess`. The two
`:id`-only routes (§1.3–§1.5) resolve the report row first, then run the exact same
`assertCustomerAccess` check against `existing.customerId`/`row.customerId` — a
report belonging to another MSP's customer 404s, never confirming existence
(`:187-189`, `:215-217`, `:266-268`).

### 1.1 `POST /msp/customers/:customerId/status-reports` — create a draft

`:81-120`. `customerId` parsed from the URL param, 400 if not numeric (`:85-86`).
`mspId` resolved via `resolveMspIdStrict(req)` (`:89`) — the caller's own session
`mspId` claim, **not** a route param and **not** query-overridable even for
PlatformAdmin (`resolve-msp-id.ts:76-78`) — 403s `{ error: "MSP context required" }`
if absent (`:90`), before `assertCustomerAccess` even runs.

Body (`createSchema`, `:66-70`):

| Field | Type | Constraint |
|---|---|---|
| `periodLabel` | `string` | trimmed, 1–200 chars |
| `asOfDate` | `string` | ISO datetime, offset required (`z.string().datetime({ offset: true })`) |
| `content` | `string` | trimmed, non-empty, no max |

400 with `{ error: "Invalid request body", details: <zod flatten> }` on schema
failure (`:97-99`). On success, inserts with `state: "draft"`,
`authoredByUserId: req.user!.id` (`:101-112`) — the authored-by identity is always
the calling session's own `users.id`, never client-supplied. Returns `201
{ report: <wire shape, §1 below the table> }` (`:114`).

### 1.2 `GET /msp/customers/:customerId/status-reports` — list, paginated

`:125-169`. `assertCustomerAccess` first (`:133-135`). Pagination (`:137-140`):
`?limit=` clamped to `[1,200]`, default `50`; `?offset=` clamped to `>= 0`, default
`0` — both fall back to their default on a non-finite parse rather than erroring.

Query: `where customerId = :customerId`, `orderBy desc(asOfDate)` (`:142-148`) —
ordered by the report's own `asOfDate`, **not** `createdAt`, so a late-entered
report for an earlier period sorts by the period it actually covers.

Author names are resolved in one batched follow-up query
(`inArray(usersTable.id, authorIds)`, `:150-157`) — not one query per row.

Response (`:159-163`):

| Field | Type | Source |
|---|---|---|
| `reports` | array | see wire shape below |
| `limit` | `number` | the clamped/defaulted value actually applied |
| `offset` | `number` | the clamped/defaulted value actually applied |

Real empty state: a customer with zero reports returns `{ reports: [], limit, offset }`
— an honest empty array, not a fixture (confirmed live, §4).

### 1.3 `GET /msp/status-reports/:id` — one report

`:174-199`. `id` parsed from the URL param, `404 { error: "Not found" }` if not
numeric (`:179`) — a malformed id 404s rather than 400ing, deliberately
indistinguishable from a real missing id. Row-then-ownership check: fetches by
`id` first, 404 if no row, then `assertCustomerAccess` against `row.customerId`,
404 (not 403) if it fails (`:182-189`) — "not found" and "not yours" are the same
response, per the file header's own stated discipline (`:33-35`).

### 1.4 `PATCH /msp/status-reports/:id` — edit while draft only

`:204-250`. Same row-then-ownership resolution as §1.3 (`:212-217`). **409 if the
existing row's `state === "published"`** (`:219-221`,
`{ error: "Published status reports cannot be edited" }`) — checked before the
body is even parsed, so a published report's content/period/asOfDate can never be
edited regardless of what the request body contains (file header, `:20-22`).

Body (`patchSchema`, `:72-76`) — all three fields optional, same per-field
constraints as `createSchema`:

| Field | Type | Constraint |
|---|---|---|
| `periodLabel` | `string` | optional, trimmed, 1–200 chars |
| `asOfDate` | `string` | optional, ISO datetime, offset required |
| `content` | `string` | optional, trimmed, non-empty |

400 on schema failure (`:224-226`); 400 `{ error: "No fields to update" }` if the
parsed body is an empty object (`:227-229`) — an empty PATCH is rejected, not a
silent no-op 200. Only the fields actually present in the body are set in the
`UPDATE` (`:233-237`); `updatedAt` is always bumped. `state` and `publishedAt` are
never touched by this route — publishing is exclusively §1.5's job.

### 1.5 `POST /msp/status-reports/:id/publish` — irreversible in v1

`:255-288`. Same row-then-ownership resolution as §1.3–§1.4 (`:263-268`). **409 if
already published** (`:270-272`, `{ error: "Status report is already published" }`)
— publishing an already-published report is a no-op 409, not a second
`publishedAt` stamp (file header, `:26-27`). On success: `state: "published"`,
`publishedAt: new Date()`, `updatedAt: new Date()` (`:274-277`) — `publishedAt` is
stamped exactly once, at first publish, and this route has no unpublish
counterpart anywhere in the file (confirmed by full read — the file defines
exactly these five routes, no sixth).

---

## 2. Wire shape — `reportToWire()` (`:50-64`)

Every route above returns this same shape, either as `{ report: {...} }` (§1.1,
1.3–1.5) or as `reports: [...]` (§1.2):

| Field | Type | Source |
|---|---|---|
| `id` | `number` | `row.id` |
| `customerId` | `number` | `row.customerId` |
| `periodLabel` | `string` | `row.periodLabel` |
| `asOfDate` | `string` (ISO) | `row.asOfDate.toISOString()` |
| `content` | `string` | `row.content` |
| `state` | `"draft" \| "published"` | `row.state` — real enum, §3 |
| `authoredByUserId` | `number` | `row.authoredByUserId` |
| `authoredByName` | `string \| null` | resolved `usersTable.name` for `authoredByUserId`; `null` if the join found no name (never a synthesized fallback string like the `#<id>` pattern `msp-break-glass.ts` uses for its audit author) |
| `createdAt` | `string` (ISO) | `row.createdAt.toISOString()` |
| `updatedAt` | `string` (ISO) | `row.updatedAt.toISOString()` |
| `publishedAt` | `string` (ISO) `\| null` | `row.publishedAt`, `null` while draft |

---

## 3. Real enum union

Pulled verbatim from the schema (`lib/db/src/schema/msp.ts:9488-9489,9508`),
verified live via the table's own CHECK constraint (§ live-data check above):

```ts
// msp.ts:9488 — msp_status_reports.state
STATUS_REPORT_STATES = ["draft", "published"] as const
```

One direction only: `draft → published`. Deliberately minimal for v1 — no
`archived`, no `superseded`, no reject/reopen state (schema comment, `:9483-9486`).
There is no unpublish route anywhere in `msp-status-reports.ts` (confirmed §1.5) —
the enum's second value, once reached for a given row, is permanent.

---

## 4. Live-data state — honest, confirmed empty, and why

```
psql "$DATABASE_URL" -c "SELECT count(*) FROM msp_status_reports;"
```

**0 rows**, confirmed live 2026-09-12. A true, honest "never happened" state, not a
bug: no design export nor any page in `artifacts/msp-console/src` or
`artifacts/portal/src` calls any status-reports endpoint yet — this module's own
Design phase (#3764) and portal-wiring phase (#3765) are both still pending,
blocked on this pack per the schema header comment (`msp.ts:9477-9478`). Every
route in §1 therefore reads as genuinely empty for every real tenant in this
database today (`{ reports: [] }` for §1.2; a bare 404 for §1.3–1.5 against any id,
since no row exists to resolve) — the real query result, not a fixture fallback.

Live schema cross-check, same pass: `\d msp_status_reports` matches the Drizzle
source in §0's schema citation exactly — column set, types, defaults, both FKs,
all three indexes, and the `state` CHECK constraint all confirmed live.

---

## 5. Cross-surface edges

- **Same shape family as `retainerWorkLogTable` (#1293)** per the schema's own
  comment (`:9479`) — a real narrative record of MSP work scoped by `mspId`, not a
  metrics rollup. A Design pass for #3764 can reasonably treat this module's
  card/list affordances as siblings of the retainer-hours ledger's own, rather than
  inventing a new pattern.
- **No relationship to `msp_change_requests` or any other MSP-console narrative
  table** — confirmed by the full file read: `msp-status-reports.ts` imports only
  `mspStatusReportsTable` and `usersTable`, no join to any other MSP-console
  table. A status report is a standalone record; nothing else in the schema
  references `msp_status_reports.id` today (no reverse FK found in
  `lib/db/src/schema/msp.ts`).
- **`authoredByName` can legitimately be `null`** on any row where the author's
  `usersTable.name` is unset — unlike `msp-break-glass.ts`'s audit trail, which
  falls back through `name ?? email ?? "user #<id>"` to guarantee a displayable
  string (that pack's §1.5), this module's `reportToWire()` has no such fallback.
  A Design/wiring session should treat `authoredByName: null` as a real, reachable
  case to render (e.g. "Unknown operator"), not an edge case that can't occur.

---

## 6. The forbidden list — declared, not merely absent

1. **No cross-customer read.** Every `:customerId`-scoped route resolves through
   `assertCustomerAccess` before any query runs; the two `:id`-only routes
   additionally re-check `assertCustomerAccess` against the resolved row's own
   `customerId`. A report belonging to another MSP's customer 404s, never a
   distinguishable 403 (§1.3–1.5).
2. **No route in this module fabricates a status report.** Every read is a real,
   derived query; a customer with zero reports returns an honest empty array
   (§4), never a fixture.
3. **No route allows editing a published report's content, period, or asOfDate.**
   `PATCH` 409s on `state === "published"` before the body is even parsed (§1.4).
4. **No unpublish path exists anywhere in this file.** `publishedAt` is stamped
   exactly once and never cleared; publishing an already-published report is a
   409 no-op, never a second stamp (§1.5).
5. **`authoredByUserId` is never client-supplied.** It is always
   `req.user!.id` from the authenticated session at creation time (§1.1) and is
   never accepted as a PATCH field (§1.4's schema has no such field).

---

## 7. Provenance

Written 2026-09-12 against `main` (branch `agent/3763-q2398`), for #3763, under
Feature #3434 phase 2 of 4, real-blocked on #3762 (phase 1, the endpoints —
confirmed merged, `build-journal/3762.md`, commit `02d8db7f8`) per this issue's own
`--blocked-by 3762`. Read in full, not sampled: `msp-status-reports.ts` (291
lines), the schema block in `lib/db/src/schema/msp.ts:9475-9526`, and
`resolve-msp-id.ts` (109 lines, for the `resolveMspIdStrict` citation in §1.1).
Verified live against local PostgreSQL: the `msp_status_reports` table's real
schema confirmed to match the Drizzle source exactly (columns, indexes, FKs, CHECK
constraint), and confirmed to hold 0 rows (§4). `docs/msp-console/break-glass-
msp-console-contract-pack.md` used as the format precedent per the standing
per-module contract-pack convention; no content duplicated from it beyond the
shared auth-pattern citation in §0. No product code, schema, or UI was changed by
this pass.
