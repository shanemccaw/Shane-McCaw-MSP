# Runbooks (MSP Console) — contract extraction pack for Claude Design

**#2583**, step 3 of **#1683** (Feature: Runbooks, MSP Console — the operator half of
#1488/#1493), under **#1571** (EPIC: Portal Admin). Follows the **#1642 pattern**:
per-surface wire contracts extracted verbatim and cited to file:line, CURRENT vs
DECIDED marked on every field, real enum unions only, cross-surface edges, honest
tri-state, forbidden list, orphaned endpoints listed explicitly. Read-only — no
product code, schema, or UI changed.

**This is a different surface from `docs/runbooks-contract-pack.md`, not a re-run of
it.** That pack (regenerated 2026-09-03 under #1728) is scoped to `artifacts/portal`'s
customer-facing `/api/portal/*` runbook routes (`portal-runbooks.ts`). This pack is the
MSP-console **operator** surface built for #2669: a strict subset of the customer
route's own actions, reused verbatim through a shared library, never a second
implementation.

Backend route file: `artifacts/api-server/src/routes/msp-runbooks.ts` (343 lines, all
four routes real, all built in one commit for #2669).
Shared wire/read/ownership/mutation library (extracted out of `portal-runbooks.ts` so
both surfaces read off one implementation, #2669): `artifacts/api-server/src/lib/portal-runbook-wire.ts`.
Pure derivation libraries this reuses unmodified: `artifacts/api-server/src/lib/portal-hold-windows.ts`
(hold-window math), `artifacts/api-server/src/lib/portal-runbook-cycles.ts` (cycle-completion /
next-cycle-spawn math).
Schema: `lib/db/src/schema/msp.ts:6858-7102` (`portalRunbooksTable`, `portalRunbookRunsTable`,
`portalRunbookStepsTable`, `portalHoldWindowsTable`, `portalHoldWindowEventsTable`) — identical
tables to the customer-portal pack; this surface writes the same rows from the operator side.

**Real DB state at pack time** (local `DATABASE_URL`, `psql`, 2026-09-04): `portal_runbooks` —
0 rows. `portal_runbook_runs` — 0 rows. `portal_hold_windows` — 0 rows. `portal_hold_window_events`
— 0 rows. Every table this surface touches is genuinely, currently empty on this environment —
the same live-empty state the customer-portal pack recorded a day earlier (§7).

---

## 0. What this surface is, and what it deliberately is not

**Not a second implementation.** Every route in `msp-runbooks.ts` delegates its
read/derive/mutate logic to `portal-runbook-wire.ts` — the exact functions
`portal-runbooks.ts` (customer side) itself now imports from, after #2669 extracted
them out. An MSP operator viewing or acting on a customer's runbooks sees the same
derived state (status label precedence, hold decoration, run history) the customer
sees, and a step tick or hold extension taken from the console runs the identical
cycle-advance and audit-trail side effects a customer-initiated one does
(`portal-runbook-wire.ts` header, `msp-runbooks.ts:1-52`).

**Scoped to `requireRole("MSPOperator")` + `resolveMspIdStrict` + explicit
`customerId`, never a JWT `customerId` claim.** `portal_runbooks` / `portal_hold_windows`
carry no `mspId` column of their own — the same customer-only-keyed shape every
portal-era table uses. An MSP caller therefore always supplies the target
`customerId` explicitly (query param on GET, body field on PUT/POST,
`msp-runbooks.ts:80-84`), and every route re-verifies that `customerId` actually
belongs to the caller's own MSP via `customerBelongsToMsp()` (`:70-78`, a direct
`tenants` row check) before touching anything — the same
`requireRole("MSPOperator")` + `resolveMspIdStrict` + MSP-ownership-check pattern
every other MSP-scoped route in this repo follows (e.g. `msp-vip-classifications.ts`,
cited in the route's own header). Once that check passes, the underlying
customer-scoped ownership queries (`ownedRunbook` / `ownedHold` / `currentRunFor`) are
the identical ones `portal-runbooks.ts` uses — an id in the path or body is still a
request, not a permission, re-read with the customer predicate either way.

**Deliberately, honestly incomplete — per #1683's own NOT ARCHITECTED guard.** #1683
names five operator actions: "Author the runbook definition · manage step order ·
mark a step complete on a live run · extend a hold window · record the run outcome."
Only the middle two exist as real routes today:

| #1683-named action | Built? | Why / why not |
|---|---|---|
| Author the runbook definition | **No** | Needs its own architecture pass — no proven route to mirror; inventing one here would be guessing at a shape #1683 explicitly did not settle |
| Manage step order | **No** | Same — no `position`-reorder route exists on the customer side either to mirror |
| Mark a step complete on a live run | **Yes** — `PUT /msp/runbooks/:runbookId/steps/:position` | Mirrors the customer route's own proven implementation exactly |
| Extend a hold window | **Yes** — `POST /msp/hold-windows/:holdId/extend` | Same — mirrors the proven customer route |
| Record the run outcome | **No** | No customer-side route records an explicit "outcome" separate from cycle completion to mirror |

**The three CR-raising hold-window decisions are deliberately NOT mirrored, either** —
`close-early` / `release` / `prepare-cr` exist on the customer side
(`portal-runbooks.ts`, see the customer pack §1.8) but have no MSP-console
equivalent. This is a **stated product decision, not a missing route**
(`msp-runbooks.ts:29-35`): those are the customer's own decision about their own
tenant's change, and #1683 does not name them as an operator action. Giving MSP
staff a button that unilaterally closes a customer's hold window and raises a CR on
their behalf would be a real, undecided product call — out of scope for this build,
and out of scope for this pack to invent.

This pack documents the two real routes plus the two read routes fully, and marks the
above gaps openly in §5 rather than glossing over them as "coming later" with no
record of what specifically is missing.

---

## 0.1 The endpoints and their real consumers

| Endpoint | Method | Route file:line | Consumed by (verified) | Orphaned? |
|---|---|---|---|---|
| `/api/msp/runbooks` | GET | `msp-runbooks.ts:87-116` | **Nothing found** | **Yes** |
| `/api/msp/runbooks/:runbookId/steps/:position` | PUT | `msp-runbooks.ts:127-205` | **Nothing found** | **Yes** |
| `/api/msp/hold-windows/:holdId/extend` | POST | `msp-runbooks.ts:217-289` | **Nothing found** | **Yes** |
| `/api/msp/hold-windows/:holdId/events` | GET | `msp-runbooks.ts:292-341` | **Nothing found** | **Yes** |

**Root cause, verified directly, not assumed:** `artifacts/msp-console` **does** exist
today (#1680 is closed — `ls artifacts/`: `admin-panel`, `api-server`, `mcp-server`,
`msp-console`, `msp-website`, `portal`, `shane-mccaw-consulting`) — a real change from
the sibling SOPs-MSP-console pack (`docs/sops-msp-console-contract-pack.md`, extracted
the same day this pack's backend was built), which recorded `artifacts/msp-console`
as not yet existing. But the scaffold itself is intentionally empty: its own
`pages/index.tsx` states plainly "This app is scaffolded and running, with no chrome
or pages built yet. Real surfaces land under Epic #1571 ... and Feature #2667 (MSP
Console Shell)." `Design/msp-console/` has no `.dc.html` export for Runbooks or any
other module — confirmed via `find Design -iname '*.dc.html'`, which returns nothing
outside `Design/portal/`. A repo-wide grep for `msp/runbooks` or `msp/hold-windows`
outside the two files that define them (`portal-runbook-wire.ts`, `msp-runbooks.ts`
itself) returns nothing — no UI page, no `mcp-server` tool (unlike the SOPs sibling
surface, which has a real machine consumer in `get_running_sops`), no test manifest.
**Not filed as a new finding** — this is the expected pre-Design, pre-Shell state
#1683's own body already names ("Blocked on the `artifacts/msp-console` scaffolding
(#1680)" — now cleared — and #2667/MSP Console Shell, still open), not a bug.

---

## 1. Wire contract — the four routes, verbatim

Every response shape below is byte-identical to the corresponding customer-portal
route's own shape (`docs/runbooks-contract-pack.md` §1.1–§1.9), because both surfaces
call the exact same `portal-runbook-wire.ts` functions. Fields are not re-derived
here; only what differs — the request surface (MSP-scoped params, `customerId`
required explicitly) and the authorization layer — is new.

### 1.1 Read — `GET /api/msp/runbooks` (`msp-runbooks.ts:87-116`)

Query param: `customerId` (required, positive integer — `parseCustomerId`, `:80-84`).
`400 VALIDATION` if missing/invalid. `403 FORBIDDEN` ("That customer is not in this
MSP's book") if `customerId` does not belong to the caller's own `mspId`
(`customerBelongsToMsp`, `:104-107`). On success, delegates to
`loadRunbooksForCustomer(customerId)` (`portal-runbook-wire.ts:239-402`) and returns
its result verbatim:

```ts
// portal-runbook-wire.ts:239-241 — the exact return shape, unchanged by this route
{ runbooks: WireRunbook[]; holds: WireHoldWindow[]; summary: RunbooksSummary }
```

Every `WireRunbook` / `WireHoldWindow` / `WireRunbookRunSummary` field, its source
column, and its CURRENT/CHANGED/NEW status is identical to the customer pack's §1.1,
§1.2, §1.3, §1.4 — restated by reference, not copied, because a second copy would
drift the moment either pack is regenerated alone. **The one operationally relevant
difference from the customer route:** this GET is **not** scoped to "my own tenant" —
an MSP operator can request any customer in their own book by passing a different
`customerId`, one request at a time. There is no "all my customers' runbooks in one
call" endpoint; a console page listing a book's runbook health would need one call
per customer, or a new aggregate route this pack does not document because none
exists.

### 1.2 Mark a step complete on a live run — `PUT /api/msp/runbooks/:runbookId/steps/:position` (`msp-runbooks.ts:127-205`)

Body: `{ customerId: number (positive int), checked: boolean }` (`putStepSchema`,
`:122-125`). Path params `:runbookId` / `:position` parsed as integers, `400
VALIDATION` if either is not finite (`:141-144`). Order of checks, all real:

1. `resolveMspIdStrict` — `403 FORBIDDEN` ("MSP context required") if the caller has
   no resolvable MSP context (`:133-137`).
2. Body validated against `putStepSchema` — `400 VALIDATION` with the flattened Zod
   error on failure (`:146-150`).
3. `customerBelongsToMsp(customerId, mspId)` — `403 FORBIDDEN` if the named customer
   is not in this MSP's book (`:153-156`).
4. `ownedRunbook(customerId, runbookId)` (`portal-runbook-wire.ts:408-415`) — `404 NOT_FOUND`
   ("Runbook not found") if the runbook does not exist for that customer.
   **Deliberately 404, not 403** — a runbook belonging to a different customer must
   read identically to one that does not exist at all (`msp-runbooks.ts:159-161`,
   same "no id-in-path trust" rule the customer route follows).
5. `currentRunFor(runbookId)` (`portal-runbook-wire.ts:431-439`) — `404 NOT_FOUND`
   ("This runbook has no active cycle") if the schedule somehow has no cycle yet.
6. The actual write: `UPDATE portal_runbook_steps SET checked, checkedAt, checkedByUserId,
   updatedAt WHERE (run_id, position)` — scoped to the **current cycle's** run id, not the
   schedule id (`:178-187`), same `(run_id, position)` targeting the customer route uses.
   `404 NOT_FOUND` ("Step not found") if the update matched zero rows.
7. On `checked: true`, calls `maybeAdvanceCycle({ runbook, run, userId, now })`
   (`portal-runbook-wire.ts:448-489`) — the same cycle-completion / next-cycle-spawn
   side effect the customer route triggers (see the customer pack §1.4).

`checkedByUserId` is written as the **MSP operator's own** `users.id`
(`req.user?.id`, `:173`) — not the customer's, and not a distinct "acted on behalf
of" column (see §4's new cross-surface note). Un-ticking clears `checkedAt` to
`null` rather than leaving a stale timestamp (`:182`), matching the customer route.
Success: `200 { ok: true, position, checked }` (`:199`), logged
(`log.info({ mspId, customerId, runbookId, runId, position, checked, userId }, "runbook
step toggled from MSP console")`, `:198`) — a distinct log line from the customer
route's own, so an operator-initiated tick is distinguishable in logs from a
customer-initiated one even though the row it writes is not itself tagged.

### 1.3 Extend a hold window — `POST /api/msp/hold-windows/:holdId/extend` (`msp-runbooks.ts:217-289`)

Body: `{ customerId: number (positive int), days: 1-90, reason: string 1-2000 chars
(required) }` (`extendSchema`, `:211-215`) — identical constraints to the customer
route's own `extendSchema` (customer pack §1.7). Order of checks: `resolveMspIdStrict`
→ body validation (`400`, joined Zod issue messages) → path `holdId` finite-int check
→ `customerBelongsToMsp` (`403`) → `ownedHold(customerId, holdId)`
(`portal-runbook-wire.ts:417-424`, `404 NOT_FOUND` if not owned) → `409 CONFLICT`
("This window has already closed") if `hold.closedAt` is already set. The write
itself is byte-identical to the customer route's: `extendedDays` accumulates (never
overwrites `waitDays`), `notifiedT24At` / `notifiedT0At` reset to `null` so both
alerts fire again against the new deadline, and a `portal_hold_window_events` row is
inserted with `kind: "extended"`, `actorUserId` set to the **operator's** own
`users.id` (`:258-280`). Success: `201 { extendedDays }` (`:283`).

### 1.4 Hold window events (audit trail) — `GET /api/msp/hold-windows/:holdId/events` (`msp-runbooks.ts:292-341`)

Query params: `customerId` (required) and path `:holdId`. Same
`resolveMspIdStrict` → `customerBelongsToMsp` → `ownedHold` ownership chain as §1.3,
all `403`/`404` as appropriate. Returns events newest-first:

```ts
// msp-runbooks.ts:327-334 — the exact shape, verbatim
{
  events: Array<{
    kind: string;                     // PORTAL_HOLD_EVENT_KIND, see §3
    daysDelta: number;
    reason: string;
    changeRequestCode: string | null; // formatChangeRequestCode(e.changeRequestId) or null
    createdAt: string;                // ISO
  }>;
}
```

Byte-identical shape to the customer route's own `GET .../events` (customer pack
§1.9) — same query, same `formatChangeRequestCode` mapping, same ordering
(`desc(id)`). The one difference is the ownership gate above it, not the payload.

---

## 2. Real enum unions (and where each is actually enforced)

Every enum this surface reads or writes is the same one the customer-portal pack's
§3 already documents in full — this surface introduces no new vocabulary. Restated
briefly, by reference:

| Vocabulary | Values | Enforced where, on THIS surface | Status |
|---|---|---|---|
| Cycle status (`portal_runbook_runs.status`) | `active`, `complete`, `abandoned` | Read via `currentRunFor`/`maybeAdvanceCycle`, never written directly by this route file (the shared library writes it) | CURRENT, unchanged from the customer pack's §3 |
| Hold window event `kind` | `extended`, `closed_early`, `released`, `cr_prepared` | This surface writes only `"extended"` (`:276`) — it has no route that can write any of the other three (§0's stated scope decision) | CURRENT column, **narrower live range on this surface than the customer route's, by design** |
| Hold decision (route param) | `close_early`, `release`, `prepare_cr` | **Not reachable from this surface at all** — no `decisionRoute` equivalent exists here | N/A on this surface — listed to make the absence explicit, not to imply it is enforced here |

---

## 3. Cross-surface edges

| Edge | Column | Points at | Served on this surface? | Notes |
|---|---|---|---|---|
| Hold window event → Change Request | `portal_hold_window_events.change_request_id` | `msp_change_requests.id`, loose integer, no FK | Yes — `changeRequestCode` on the events read (§1.4) | Same no-FK convention the customer pack's §4 already documents; this surface never writes this column (it can only ever be non-null via a customer-initiated `decisionRoute`, unreachable here) |
| Runbook step → user (operator identity) | `portal_runbook_steps.checked_by_user_id` | `users.id`, no FK | Written (as the operator's own id), never read back on this route's own responses | **New nuance versus the customer pack's own §1.2 open-gap note**: on this surface, `checkedByUserId` genuinely can be an MSP staff member's id, not the customer's — and there is no column anywhere distinguishing "the customer checked this" from "an MSP operator checked this on the customer's behalf." A future audit view reading this column back cannot tell the two apart. Not previously true on the customer-only surface; true now that a second actor class writes the same column |
| Hold window event → user (operator identity) | `portal_hold_window_events.actor_user_id` | `users.id`, no FK | Written (operator's own id), never read back on this route's own responses | Same new nuance as above — an extension raised from the MSP console is stored indistinguishably from one a customer raised themselves |
| Customer → MSP | `tenants.msp_id` (`customerBelongsToMsp`, `msp-runbooks.ts:71-78`) | `msps.id` (implied by the `tenantsTable.mspId` column) | Yes — the entire authorization gate for every route on this surface | Not a runbook-table edge at all, but the one edge that makes every other check on this surface meaningful; re-verified on every single request, never cached |

---

## 4. Notes on how this surface's authorization differs from the customer route's

Restating `msp-vip-classifications.ts`'s established pattern (cited in the route's own
header) as it applies concretely here, since Design needs to know the failure shape,
not just that "auth exists":

1. **`403 FORBIDDEN` ("MSP context required")** if the caller's own session cannot
   resolve an `mspId` at all — this is a different, earlier failure than "wrong
   customer," and happens before `customerId` is even parsed from the body/query on
   the two POST/PUT routes (it happens after path/body parsing on those two routes
   only because `resolveMspIdStrict` is called first in code order — the two 403s
   are for logically different reasons even though both routes eventually 403 for
   the same missing-context case: `msp-runbooks.ts:133-137, 224-227, 299-302`).
2. **`403 FORBIDDEN` ("That customer is not in this MSP's book")** if `mspId`
   resolves fine but the named `customerId` belongs to a different MSP (or does not
   exist as a tenant at all — `customerBelongsToMsp` treats "row not found" and
   "row found, different MSP" identically, both `false`). This is the one check
   unique to this surface; the customer route has no equivalent because a customer's
   JWT can only ever name itself.
3. **`404`, never `403`, once ownership within the MSP's own book is established.**
   A runbook/hold that exists but belongs to a *different customer within the same
   MSP's own book* still 404s, not 403s — the ownership re-read (`ownedRunbook` /
   `ownedHold`) does not know or care which MSP called it, only which customer
   owns the row, so cross-customer-within-book leakage is closed the same way
   cross-MSP leakage is (§0).

---

## 5. Open gaps — NOT decided (do not resolve; flag)

1. **No column distinguishes an operator-initiated action from a customer-initiated
   one.** `checkedByUserId` / `actorUserId` are the same columns either surface
   writes into, with the same `users.id` shape (§3). Whether a future audit trail
   needs to show "MSP staff did this on the customer's behalf" is a real, undecided
   product question this pack surfaces but does not resolve — not filed as a new
   issue, because it is a design question (what should the audit view show), not a
   confirmed defect.
2. **No aggregate "all of my book's runbooks" read exists.** `GET /api/msp/runbooks`
   is strictly one-customer-per-call (§1.1). If the eventual MSP Console Runbooks
   page needs a cross-customer health rollup (e.g. "3 customers have an overdue
   runbook"), that is new route work, not something this pack's existing endpoint
   can be asked to do differently.
3. **Three of #1683's five named operator actions have no route at all** (§0's
   table: author, reorder, record-outcome) and the three CR-raising hold decisions
   are deliberately excluded. This is the pack's own honest restatement of #2669's
   own scope decision, not a new finding — no sub-issue filed, because #1683 itself
   already tracks the Feature's full scope and is the right place a future
   architecture pass picks this up from, not a sibling issue this pack would create
   ahead of that architecture.
4. **This surface is completely unconsumed today** (§0.1) — a fact, not a defect,
   given `artifacts/msp-console` has no chrome yet and `Design/msp-console/` has no
   export. Restated here so a future build does not assume any UI already exists to
   extend.

No new finding meets this project's bar for filing a sibling sub-issue of #1683 —
every item above is either a genuine open design question (#1) or the expected,
already-tracked pre-Design/pre-Shell state (#2, #3, #4), not a confirmed defect in
the code that was actually built for #2669.

---

## 6. The forbidden list — declared, not merely absent

Restating the customer pack's §9, as it applies to this surface (items with no
equivalent route here are noted as such rather than silently dropped):

1. **No execution on release/close.** N/A on this surface — it has no
   release/close route at all (§0, §2).
2. **No id-in-path trust.** Enforced — `ownedRunbook`/`ownedHold` re-read with the
   customer predicate on every write, exactly as the customer route does (§1.2 step
   4, §1.3).
3. **No 403 that reveals another customer's (or another MSP's) row exists.**
   Enforced, and extended one level further than the customer pack's own version:
   both "wrong MSP" and "right MSP, wrong customer within it" collapse to
   404/403 without distinguishing "exists elsewhere" from "does not exist" (§4.3).
4. **No un-guarded early close.** N/A — no close route exists here.
5. **No stale `waitDays` rewrite.** Enforced — `extendedDays` accumulates,
   `waitDays` is never touched (§1.3), identical to the customer route.
6. **No second execution path for anything.** Enforced by construction — every
   route on this surface delegates to the exact same `portal-runbook-wire.ts`
   functions the customer route uses; there is no second, hand-copied
   implementation to drift.

---

## 7. Honest-empty contract & the tri-state

Identical to the customer pack's §8 — this surface calls the same
`loadRunbooksForCustomer` / `emptySummary()` functions and inherits their behavior
verbatim, including the genuinely-empty-today confirmation (this pack's own header).
Not re-derived here; see the customer pack §8 for the full tri-state table.

---

## 8. Provenance

Extracted 2026-09-04 against branch `agent/2583-q1535`, a new pack (no prior version
of this MSP-console-scoped surface existed). Full read of `msp-runbooks.ts` (343
lines, all four routes), `portal-runbook-wire.ts` (490 lines, the full shared
library), and the relevant sections of `portal-hold-windows.ts` / `portal-runbook-cycles.ts`
cited by reference where their behavior is unchanged from the customer pack's own
extraction of them. Cross-checked against `docs/runbooks-contract-pack.md`
(2026-09-03, `agent/1728-q1347`) field-by-field to confirm every wire shape is
byte-identical, not independently re-derived. Live DB state confirmed via direct
`psql` against local `DATABASE_URL`: 0 rows in every table this surface touches.
Consumer sweep: `grep -rln` for `msp/runbooks|msp/hold-windows` across the whole repo
(excluding `node_modules`) found exactly the two files that define the surface and
nothing that calls it — no UI page, no `mcp-server` tool, no test manifest — and
confirmed `artifacts/msp-console` exists but is an intentionally chrome-less scaffold
(#1680, closed) with no export yet in `Design/msp-console/`. Architecture deltas
cited to #1488, #1493, #2669 (the backend build this pack extracts), #1683 (Feature,
NOT ARCHITECTED for the full operator surface), #1680 (scaffolding, closed), #2667
(MSP Console Shell, still open), under epic #1571 and method issues #1577/#1578/#1642.
No new sub-issue filed — every open item in §5 is either a genuine undecided design
question or the expected, already-tracked pre-Design/pre-Shell state, not a
confirmed defect meeting this project's finding bar. Read-only pass: no product
code, schema, or UI was changed.
