# Runbooks — contract extraction pack for Claude Design

**#1488** (Portal New Design: Runbooks), following the method fixed by **#1577** (contract
extraction pack, run per module as step 3 of **#1578**), under **#1485** (EPIC: Portal New
Design). **Architected jointly with #1493** (SOPs / Runbooks) — this module has no separate
architecture; the resolution lives on #1493 and is restated in §2 below. Sub-issues
**#1556–#1560, all DONE since the prior pack** — see §2. New since the prior pack (2026-08-29,
`3b6b14b7f`): **#1557** shipped for real (`portal_runbook_runs`, run history, cycle model,
`2026-08-30-runbook-cycles-1557.sql`), and **hold windows gained cycle affinity** (`run_id`,
`5ec915f0c`, "Runbooks: hold windows now carry cycle affinity" — tracked on **#1940**).

**Known-wrong contract from the prior pack is now FIXED, not carried forward.**
`portal_runbook_steps.checked` used to be per-runbook; it is now per-**cycle**
(`portal_runbook_runs`), so a cycle reset no longer wipes the last cycle's completion — run
history is a real, queryable list (`WireRunbook.runHistory`, §1.1). Do not design against the old
single-`checked`-boolean shape any more.

**New known-thin item, carried in deliberately and marked:** `portal_hold_windows.gates_step_position`
alone is ambiguous once a recurring runbook has spawned a second cycle — "step 4" could mean cycle
1's step 4 or cycle 2's. `run_id` (added with #1940) resolves this by pinning a window to the
specific cycle it gates; a legacy window with no `run_id` falls back to decorating whichever
runbook it names, matching pre-#1940 behaviour. See §1.3.

Backend route: `artifacts/api-server/src/routes/portal-runbooks.ts` (customer-scoped)
Derivation libraries: `artifacts/api-server/src/lib/portal-hold-windows.ts` (hold-window math, pure),
`artifacts/api-server/src/lib/portal-runbook-cycles.ts` (cycle-completion / next-cycle-spawn math,
pure — new since #1557)
Related route (writes the same tables, different file): `artifacts/api-server/src/routes/portal-oversharing-sites.ts`
Portal wire/hook files (path stale — `artifacts/msp-portal` was retired for `artifacts/portal` in
`f40438cdc`; see #1921): `artifacts/portal/src/components/holds/useRunbooks.ts` (carried over,
extended #1619 for `loadHoldEvents`), `holds/useHoldBadge.ts` (carried over);
`govOversharingRunbooksLive.ts` (carried over, under `components/`, not `components/holds/`).
**Confirmed at pack time: `useRunbooks` and `useHoldBadge` both have ZERO consumers anywhere in
`artifacts/portal/src`** — grepping for either hook name outside its own defining file returns
nothing. Both hooks are real, working, wired to real endpoints, and imported by no page or nav
component. See §0.
Page: none in `artifacts/portal` — `portal-v2-runbooks.tsx` was not carried over; `Design/portal/`
is empty — no export for Active Runbooks, or for any #1485 module, exists yet (verified at pack
time: `find Design -iname '*.dc.html'` returns nothing).
Schema: `lib/db/src/schema/msp.ts:6858-7102` (`portalRunbooksTable`, `portalRunbookRunsTable` —
new, `portalRunbookStepsTable`, `portalHoldWindowsTable`, `portalHoldWindowEventsTable`)

**Real DB state at pack time** (local `DATABASE_URL`, `psql`): `portal_runbooks` — 0 rows.
`portal_runbook_runs` — 0 rows. `portal_hold_windows` — 0 rows (0 with `run_id` set, of 0 total).
Every runbook/hold-window table is genuinely, currently empty on this environment — not a bug, a
live-empty state (§8).

---

## 0. The endpoints and their real consumers

| Endpoint | Method | Route file:line | Consumed by | Orphaned? |
|---|---|---|---|---|
| `/api/portal/runbooks` | GET | `portal-runbooks.ts:274-451` | `useRunbooks` (`useRunbooks.ts`) and, separately, `useHoldBadge` (`holds/useHoldBadge.ts:32,76`) — **both hooks have zero importers anywhere in `artifacts/portal/src`** | **Yes, from a page's perspective — see below** |
| `/api/portal/runbooks/:runbookId/steps/:position` | PUT | `portal-runbooks.ts:575-653` | `useRunbooks.setStepChecked` (no importer, as above) — **also** `govOversharingRunbooksLive.toggleStep` (`govOversharingRunbooksLive.ts:91-115`), which **is** a real, live, page-reachable consumer via the Overshared SharePoint drill-down | **No** — reachable through the Oversharing Sites feature even though `useRunbooks`'s own copy is not |
| `/api/portal/runbooks/:runbookId/steps` | POST | `portal-runbooks.ts:658-724` | `useRunbooks.addStep` (no importer) | **Yes** |
| `/api/portal/hold-windows/:holdId/extend` | POST | `portal-runbooks.ts:736-798` | `useRunbooks.extendHold` (no importer) | **Yes** |
| `/api/portal/hold-windows/:holdId/close-early` | POST | `portal-runbooks.ts:1063` (`decisionRoute`, `:961-1061`) | `useRunbooks.decideHold("close_early")` (no importer) | **Yes** |
| `/api/portal/hold-windows/:holdId/release` | POST | `portal-runbooks.ts:1064` | `useRunbooks.decideHold("release")` (no importer) | **Yes** |
| `/api/portal/hold-windows/:holdId/prepare-cr` | POST | `portal-runbooks.ts:1065` | `useRunbooks.decideHold("prepare_cr")` (no importer) | **Yes** |
| `/api/portal/hold-windows/:holdId/events` | GET | `portal-runbooks.ts:1068-1111` | `useRunbooks.loadHoldEvents` (added #1619; hook itself has no importer) | **Yes** |

**Re-scoped finding, superseding the prior pack's single-endpoint framing.** The prior pack (dated
`3b6b14b7f`, written against `artifacts/msp-portal`) named exactly one orphaned endpoint
(`GET .../events`, filed as #1619/#1620) on the premise that `portal-v2-runbooks.tsx` called the
rest through `useRunbooks`. **That premise is now false.** `artifacts/msp-portal` was retired
(`f40438cdc`, #1921) and `portal-v2-runbooks.tsx` was never carried into `artifacts/portal` — the
page that made the other six endpoints "consumed" no longer exists anywhere in the tree.
`useRunbooks` and `useHoldBadge` themselves survived the migration intact and still call every one
of these endpoints correctly, but **nothing imports either hook**. This is the expected, correct
state for a module with no `Design/portal/` export yet (per the #1485 standing convention: "no
export there means no design" — an agent must say so and stop, not wire a page against nothing),
not a new bug — restated here, not re-filed, because #1619/#1620 already exist and cover the same
root cause (no page for this module yet) for the one endpoint that had no *hook* either. No new
sub-issue: the six now-technically-orphaned-from-a-page endpoints are covered by the same "Design
has not produced an export yet" state #1619/#1620 already recorded, and will become reachable the
same way #1619 anticipated — a future build wiring the existing, correct hooks into whatever page
Design produces.

**A related, out-of-module endpoint that writes into the same tables, and IS consumed:**
`POST /api/portal/oversharing/runbooks/:sopKind` (`portal-oversharing-sites.ts:212-269`) ensures a
`portal_runbooks` row per SOP kind for the Overshared SharePoint drill-down (#1286), then reuses
this module's own generic step-toggle route rather than a second one. Updated for #1557: it now
resolves the runbook's current cycle (`portal_runbook_runs`, highest `cycleNumber`) before reading
steps (`loadRunbookWire`, `:190-210`) rather than assuming a direct `runbookId → step` link — this
route's own author correctly adapted it to the new cycle model. It is a real, consumed, working
endpoint; noted for completeness, not re-specified.

---

## 1. Wire contract

### 1.1 Runbook list — `GET /api/portal/runbooks`

Returns `{ runbooks: WireRunbook[], holds: WireHoldWindow[], summary }` (`:445`), customer-scoped by
`eq(portalRunbooksTable.customerId, customerId)` (`:290`) where `customerId` **is** the JWT's
`customerId` claim directly. Three queries, not N+1 — runbooks, then every cycle
(`portal_runbook_runs`) and every step across every cycle, then holds, all grouped in memory
(`:300-335`) — "#1557 added a query, not an N+1" (route comment `:300-303`).

```ts
// portal-runbooks.ts:184-209 — WireRunbook (verbatim, #1557 shape)
interface WireRunbook {
  readonly id: number;
  readonly runbookKey: string;
  readonly title: string;
  readonly context: string;
  readonly pillar: string;
  readonly recurring: boolean;
  readonly currentRunId: number | null;
  readonly cycleNumber: number;
  readonly startedOn: string | null;
  readonly cycleDays: number;
  readonly daysElapsed: number;
  readonly daysLeft: number;
  readonly checkedSteps: number;
  readonly totalSteps: number;
  readonly pct: number;
  readonly statusLabel: string;
  readonly steps: readonly WireStep[];
  readonly hold: WireHoldWindow | null;
  readonly runHistory: readonly WireRunbookRunSummary[];
}
// portal-runbooks.ts:174-182 — WireRunbookRunSummary (verbatim, new in #1557)
interface WireRunbookRunSummary {
  readonly id: number;
  readonly cycleNumber: number;
  readonly startedOn: string;
  readonly status: string;
  readonly completedAt: string | null;
  readonly checkedSteps: number;
  readonly totalSteps: number;
}
```

| Wire field | Source column / derivation | DB type | Wire nullable | Status |
|---|---|---|---|---|
| `id` | `portal_runbooks.id` (`msp.ts:6859`) | serial, notNull | no | CURRENT |
| `runbookKey` | `runbook_key` (`msp.ts:6863`) | text, notNull | no | CURRENT |
| `title` / `context` | `title` / `context` (`msp.ts:6864, 6866`) | text, notNull | no | CURRENT |
| `pillar` | `pillar` (`msp.ts:6868`) | text, notNull | no | CURRENT · enum §3, lowercase, not title-cased on this wire |
| `recurring` | `recurring` (`msp.ts:6884`) | boolean, notNull, default `false` | no | **NEW (#1557)** — whether finishing the current cycle spawns the next one automatically |
| `currentRunId` | the schedule's own current cycle's `id`, or `null` if it somehow has none (`:429`) | derived from `portal_runbook_runs`, highest `cycleNumber` | yes | **NEW (#1557)** |
| `cycleNumber` | current cycle's `cycle_number` (`msp.ts:6911`), or `1` if no run exists yet (`:430`) | integer | no | **NEW (#1557)** |
| `startedOn` | current cycle's `started_on` (`msp.ts:6913`) — **moved off the schedule row in #1557**, `null` if no current run | date | yes | **CHANGED (#1557)** — was `portal_runbooks.started_on` directly; now the CURRENT CYCLE's start, not the schedule's original start (which still exists on `portal_runbooks.started_on` as "when this procedure began" bookkeeping, but is no longer what this wire field reflects) |
| `cycleDays` | `cycle_days` (`msp.ts:6877`) — unchanged, stays on the schedule | integer, notNull | no | CURRENT |
| `daysElapsed` / `daysLeft` | `cycleProgress()` (`portal-runbook-cycles.ts`) against the current cycle's `startedOn` + `cycleDays`, UTC-midnight whole days | derived | no | CURRENT — logic moved from the route into `portal-runbook-cycles.ts` (#1557), same math |
| `checkedSteps` / `totalSteps` / `pct` | counted from the **current cycle's** steps only (`stepsByRun.get(currentRun.id)`, `:388-391`) | derived | no | **SCOPE-CHANGED (#1557)** — was all of a runbook's steps ever; now strictly the open cycle's steps, never history |
| `statusLabel` | precedence: `complete` → `"Complete"`; else an open hold decorates it (`runbookStatusFromHold`); else `overdue` → `"Overdue"`; else `"On track"` (`:401-407`) | derived | no | CURRENT — `complete` is now `run.status === "complete" \|\| isCycleComplete(steps)` (`:392`), not a bare step-count comparison |
| `steps` | the **current cycle's** steps only (§1.2) | array | no (may be empty) | CURRENT, scope-changed same as above |
| `hold` | this runbook's **open, cycle-matching** hold window, or `null` (§1.3) | derived | yes | **CHANGED (#1940)** — now also requires `run_id` match to the current cycle when the hold carries one |
| `runHistory` | **past cycles**, newest first, summary only — no step detail (`:386, :409-420`) | derived array of `WireRunbookRunSummary` | no (may be empty) | **NEW (#1557)** — this is the run-history the prior pack's known-wrong contract said did not exist; it exists now |

`runHistory[].checkedSteps` / `.totalSteps` are computed from that historical cycle's own frozen
step rows (`portal_runbook_steps` still keyed by `run_id`, never mutated after the cycle completes)
— a genuinely different, permanent record per cycle, not a live re-count of anything.

### 1.2 Step — `WireRunbook.steps[]`

```ts
// portal-runbooks.ts:131-137 — WireStep (verbatim, unchanged shape)
interface WireStep {
  readonly position: number;
  readonly text: string;
  readonly checked: boolean;
  readonly isCustom: boolean;
  readonly checkedAt: string | null;
}
```

| Wire field | Source column | DB type | Status |
|---|---|---|---|
| `position` | `position` (`msp.ts:6944`) — 1-based, **unique per CYCLE now, not per runbook** (`uniqueIndex` on `(run_id, position)`, `msp.ts:6963`) | integer, notNull | **RE-SCOPED (#1557)** — position is only unique within a run; the same position number exists once per cycle, by design |
| `text` | `text` (`msp.ts:6945`) | text, notNull | CURRENT |
| `checked` | `checked` (`msp.ts:6946`) | boolean, notNull, default `false` | **FIXED (#1557)** — this is now per-CYCLE, not per-runbook. The prior pack's known-wrong contract (a reset wiping the last cycle's completion) no longer applies; a finished cycle's steps are never mutated again, they become `runHistory` |
| `isCustom` | `is_custom` (`msp.ts:6954`) | boolean, notNull, default `false` | CURRENT — carries forward into every future cycle once the current one completes (`maybeAdvanceCycle` → `cloneStepsForNextCycle`, `portal-runbook-cycles.ts`) — "a customer's own note about how they run this procedure is part of the procedure now, not a one-cycle scratch pad" |
| `checkedAt` | `checked_at` (`msp.ts:6956`) | timestamptz, nullable | CURRENT — cleared to `null` on un-tick (`:625`), never left stale |

`portal_runbook_steps.runbook_id` (`msp.ts:6942`) is now an explicitly **DEPRECATED, nullable**
column per its own schema comment — pre-#1557 the required parent, now unused (no code reads or
writes it), left in place because dropping a column is a destructive migration and nothing here
needs it removed for correctness. Do not design against it.

Not on the wire, but stored: `checkedByUserId` (`msp.ts:6958`) — `users.id` of whoever last toggled
the step, written on every PUT but never read back. Still an **open gap, not decided** — see §7,
carried forward unchanged from the prior pack.

### 1.3 Hold window — `WireRunbook.hold` / `WireHoldWindow[]` in `holds`

```ts
// portal-runbooks.ts:139-171 — WireHoldWindow (verbatim; runId is new, #1940)
interface WireHoldWindow {
  readonly id: number;
  readonly holdKey: string;
  readonly title: string;
  readonly gates: string;
  readonly gatesStepPosition: number | null;
  readonly runId: number | null;
  readonly pillar: string;
  readonly why: string;
  readonly state: string;
  readonly tone: string;
  readonly badge: string;
  readonly tMinus: string;
  readonly daysLeft: number;
  readonly daysSaved: number;
  readonly hoursLeft: number;
  readonly totalDays: number;
  readonly waitDays: number;
  readonly extendedDays: number;
  readonly startedAt: string;
  readonly closesAt: string;
  readonly closedAt: string | null;
  readonly ticks: ReadonlyArray<"done" | "partial" | "todo">;
  readonly scanVerdict: string;
  readonly scanLabel: string;
  readonly scanTone: string;
  readonly scanLine: string;
  readonly scanProvenance: string;
  readonly primaryAction: { readonly kind: string; readonly label: string };
  readonly notificationsDue: readonly string[];
}
```

Built by `toWireHold` (`:216-271`), composing stored columns with the pure derivation library
`portal-hold-windows.ts` — every derived field is recomputed fresh from `(startedAt, waitDays,
extendedDays, scanVerdict, closedAt, now)` on each request, never stored. Unchanged from the prior
pack except for `runId`, below.

| Wire field | Source | Status |
|---|---|---|
| `id`, `holdKey`, `title`, `gates`, `gatesStepPosition`, `pillar`, `why` | stored columns, verbatim (`msp.ts:6996-7034`) | CURRENT |
| `runId` | `run_id` (`msp.ts:6994`) | **NEW (#1940)** — the specific CYCLE this window gates. `null` for a legacy window raised before this column existed |
| `waitDays` / `extendedDays` | stored `wait_days` / `extended_days` (`msp.ts:7010, 7020`) — never merged | CURRENT |
| `startedAt` / `closedAt` | stored timestamps, ISO | CURRENT |
| `scanVerdict` / `scanLine` | stored (`msp.ts:7021, 7023`) | CURRENT · enum §3 |
| `state`, `tone`, `daysLeft`, `daysSaved`, `hoursLeft`, `totalDays`, `closesAt` | `deriveHoldWindow()` | CURRENT · derived, enum §3 |
| `badge`, `tMinus`, `ticks`, `scanLabel`, `scanTone`, `scanProvenance`, `primaryAction`, `notificationsDue` | `holdBadge()` / `holdTMinus()` / `holdDayTicks()` / `holdScanLabel()` / `holdScanTone()` / `holdScanProvenance()` / `holdPrimaryAction()` / `dueHoldNotifications()` — all pure, all unchanged in this build | CURRENT · derived |

**Cycle-affinity gating, new in #1940 (`portal-runbooks.ts:360-381`):** an open hold window only
decorates `WireRunbook.hold` when it gates the runbook's **current** cycle — `h.runId !== null &&
(!currentRun || h.runId !== currentRun.id)` is `continue`d, not attached. **A window with no
`runId` (raised before #1940, or before #1557 existed at all) falls back to the pre-#1940 behaviour**
of decorating whichever runbook it names, regardless of cycle — this is the honest legacy path, not
a bug, and Design should know both codepaths exist. The top-level `holds` array (`allHolds`)
returned alongside `runbooks` is unaffected by this filter — it lists every hold for the customer,
open or closed, cycle-matched or not; only the per-runbook `.hold` attachment is gated.

**Four defects fixed vs. the design prototype, unchanged from the prior pack** — see
`portal-hold-windows.ts:11-71` and its own tests; not re-described here.

### 1.4 The cycle model itself (#1557) — new section

`portal_runbook_runs` (`msp.ts:6905-6926`) holds **one row per cycle**. A completed (or abandoned)
cycle is never mutated or deleted — the next cycle, if `recurring`, is a **new row** with
`cycleNumber + 1`. This is what makes "who completed cycle 3 and when" and a missed cycle readable
later instead of silently overwritten.

**Completion is derived, never asserted** (`isCycleComplete()`, `portal-runbook-cycles.ts`): a
cycle with zero steps is never "complete" — there is nothing to have finished, and treating an
empty checklist as done would spawn an infinite chain of empty next cycles for a recurring
schedule with no steps yet.

**`maybeAdvanceCycle()` (`portal-runbooks.ts:528-570`), run after every step-check that results in
`checked: true`:**
1. If the run is already `complete`, no-op.
2. If not every step in the current cycle is checked, no-op.
3. Otherwise: mark the cycle `status: "complete"`, `completedAt`, `completedByUserId`.
4. **Only if `runbook.recurring`:** insert the next cycle (`cycleNumber + 1`, `startedOn: today`,
   `status: "active"`), then clone every step from the just-finished cycle
   (`cloneStepsForNextCycle()`, position/text/isCustom preserved, all unchecked) into the new
   cycle's own `run_id`. A non-recurring schedule (e.g. every Oversharing Sites runbook — `recurring:
   false`, `portal-oversharing-sites.ts:257`) just stays complete; nothing spawns.

**`currentRunFor(runbookId)`** (`:511-519`) always resolves the highest `cycleNumber` row for a
schedule — every write route in this file (tick a step, add a step) acts on this cycle, never on
history. A `:runbookId` in every URL in this file always addresses the **schedule**; the specific
cycle it currently means is resolved server-side, so a caller never needs to know a run id exists.

### 1.5 Tick / untick a step — `PUT /api/portal/runbooks/:runbookId/steps/:position`

Body: `{ checked: boolean }` (`putStepSchema`, `:573`). Re-reads the runbook with the customer
predicate (`ownedRunbook`, `:488-495`) — 404, not 403, for someone else's runbook (`:602-605`).
**New in #1557:** resolves the runbook's current cycle first (`currentRunFor`, `:607`) and 404s
with `"This runbook has no active cycle"` if somehow none exists (`:608-611`) — this can only
happen for data written before a schedule always got a cycle 1 at creation. The write itself
targets `(run_id, position)`, not `(runbook_id, position)` (`:629-634`). On `checked: true`, calls
`maybeAdvanceCycle()` (§1.4). Success: `200 { ok: true, position, checked }` (`:647`).

### 1.6 Add a custom step — `POST /api/portal/runbooks/:runbookId/steps`

Body: `{ text: string }`, 1–500 chars (`addStepSchema`, `:656`). Guarded at
`MAX_STEPS_PER_RUNBOOK = 200` (`:116`), scoped **per cycle** now (`stepCount` counted against the
current run's steps, `:693-699`), `409` once reached. Position is `max(existing position in this
cycle) + 1`; always `isCustom: true`. Success: `201 { position, text }` (`:718`).

### 1.7 Extend a hold window — `POST /api/portal/hold-windows/:holdId/extend`

Unchanged from the prior pack: `{ days: 1-90, reason (required, 1-2000 chars) }`
(`extendSchema`, `:731-734`); `waitDays` never rewritten, `extendedDays` accumulates
(`:771-781`); resets `notifiedT24At`/`notifiedT0At`; writes a `portal_hold_window_events` row,
`kind: "extended"`. `409` if already closed. Success: `201 { extendedDays }` (`:792`).

### 1.8 The three CR-raising decisions

`POST /hold-windows/:holdId/close-early` · `/release` · `/prepare-cr` (`decisionRoute()`,
`:961-1061`, wired `:1063-1065`). Shared body: `{ note?, route?, window? }` (`decisionSchema`,
`:802-808`). Unchanged core behaviour from the prior pack — all three raise a real
`msp_change_requests` row via `raiseHoldChangeRequest()` (`:820-959`); `close_early` is re-guarded
server-side (`:996-1013`); `prepare_cr` does not close the window, the other two do.

**New since the prior pack: `raiseHoldChangeRequest()` now also materializes the approval ledger**
(`:938-956`, added by **#1775**, "Change Control: materialize approval ledger on msp-changes.ts and
portal-runbooks.ts CR-creation paths"). Before #1775, a CR raised from a hold-window decision had
**zero `cr_approvals` rows** — the same gap #1496 fixed for the MSP-console CR-creation door but
missed here. `loadApprovalPolicy()` + `materializeApprovalsForChange()` now run right after the CR
insert, non-fatally (a failure here logs and does not roll back the already-created CR — `:954`).
Every CR-creation path in the product now materializes approvals; this was the one that didn't
until #1775.

**Also new: #1503's `recordCrEvent()` "raised" event** (`:921-932`) fires on every hold-window CR
too, opening its timeline the same way every other CR-creation path does — present in the prior
pack's description already, restated here because it is now confirmed alongside the #1775 change
in the same function.

Success: `201 { changeRequestCode, decision }` (`:1054`).

### 1.9 Hold window events (audit trail) — `GET /api/portal/hold-windows/:holdId/events`

Unchanged shape from the prior pack. Returns `{ events: [{ kind, daysDelta, reason,
changeRequestCode, createdAt }] }` (`:1097-1105`), customer-scoped, newest-first. Still orphaned
from a page's perspective — see §0.

---

## 2. Architected jointly with #1493 — the overlap, now BUILT

The prior pack described the #1556 unification as **settled but not built**. It is now built.
Restating the finding briefly (full version in the SOPs pack §0):

**`msp_sops` + `msp_sop_runs` is the definition + execution object.** `portal_runbooks` +
`portal_runbook_runs` + `portal_runbook_steps` is a **schedule that spawns runs** — the
unification's actual shape for the recurrence half. Both are real now:

| Decision (prior pack: DECIDED, not built) | Status now |
|---|---|
| #1556 — one procedure definition, one run record, `origin` on the run | **DONE** — `msp_sop_runs.origin` (`policy \| lifecycle \| remediation \| manual`), `2026-08-30-sop-run-origin-1556.sql` |
| #1557 — recurrence becomes a schedule that spawns runs | **DONE** — `portal_runbook_runs`, this pack's §1.1/§1.4, `2026-08-30-runbook-cycles-1557.sql` |
| #1558 — per-tenant custom-step overlay on a versioned MSP definition | **DONE** — `portal_sop_custom_steps` (SOPs pack §2), `2026-08-30-sop-custom-steps-overlay-1558.sql` |
| #1559 — connect the execution hook, CR-gated | **DONE** — `POST /api/msp/sops/:sopId/run` (MSP-side, `sop-execution.ts`), `2026-08-30-sop-run-execution-hook-1559.sql` |
| #1560 — seed the lifecycle procedure set | **DONE, narrower than named** — IAM-04 (mover), IAM-05 (promote), IAM-06 (demote), IAM-07 (de-VIP propagation) added to `msp_sops`; IAM-01/IAM-02 (leaver/joiner) already existed. **Not** added to `portal_runbooks`/`RUNBOOK_CATALOGUE` — see §7 |

This module's own runbook/hold-window shape (§1 above) is **not itself the unified object** —
`portal_runbooks` remains the schedule-that-spawns-runs half; `msp_sops`/`msp_sop_runs` remains the
separate definition+execution half. The unification did not merge the two tables into one; it gave
each side of the split its own correct internal shape (a run history for the schedule side, an
`origin` for the execution side) per the settled #1556 architecture. See the SOPs pack §0 for why
they stay two objects.

**Two new, real cross-module facts since the prior pack, both landed on the execution (MSP) side
and worth noting here even though they are not in this route file:**

- **#1938** — `POST /api/msp/sop-runs` (the pre-#1559 hand-entry insert path) now forces
  `origin: "manual"` server-side unconditionally, closing a gap where that route could otherwise
  fabricate a `"policy"`-origin row indistinguishable from a real, CR-authorized enactment.
- **#1773** — the #1497 CR-authorization gate now verifies the claimed CR actually authorizes the
  *specific* pack/SOP being executed, not merely that *some* approved CR exists.

Neither changes this route file's own wire contract; both are cited because they close gaps the
prior pack's §5/§6 implicitly assumed were still open on the execution side.

---

## 3. Real enum unions (and where each is actually enforced)

| Vocabulary | Values | Where fixed | Status |
|---|---|---|---|
| Runbook status (`portal_runbooks.status`) | `active`, `complete`, `abandoned` | `PORTAL_RUNBOOK_STATUS`, `msp.ts:6886` | CURRENT column, **still not read on the schedule-level wire at all** — see §7, carried forward |
| Cycle status (`portal_runbook_runs.status`) | same three values, `PORTAL_RUNBOOK_STATUS` reused, `msp.ts:6915` | CURRENT — **this one IS read**: `run.status === "complete"` drives `WireRunbook.statusLabel`'s `complete` branch (`:392`) and `runHistory[].status` (`:415`) | **NEW distinction from the prior pack**: the schedule-level and cycle-level `status` columns share an enum definition but only the cycle-level one is live on the wire |
| Hold scan verdict (`portal_hold_windows.scan_verdict`) | `clear`, `signals`, `watch` | `PORTAL_HOLD_SCAN_VERDICT`, `msp.ts:6976` | CURRENT, unchanged |
| Hold window event kind (`portal_hold_window_events.kind`) | `extended`, `closed_early`, `released`, `cr_prepared` | `PORTAL_HOLD_EVENT_KIND`, `msp.ts:7071-7076` | CURRENT, unchanged |
| Hold state (derived, never stored) | `running`, `closing`, `due`, `early` | `HOLD_STATES`, `portal-hold-windows.ts:74-75` | CURRENT, unchanged |
| Hold decision (route param) | `close_early`, `release`, `prepare_cr` | `HoldDecision`, `portal-runbooks.ts:810` | CURRENT, unchanged |
| Runbook / hold pillar | one of `journeyTokens`' six PILLAR_KEYS, lowercase | comment only, `msp.ts:6868` | CURRENT by convention, plain text, unchanged |

---

## 4. Cross-surface edges

| Edge | Column | Points at | Served today? | Notes |
|---|---|---|---|---|
| Hold window → Change Request | `portal_hold_window_events.change_request_id` (`msp.ts:7095`) | `msp_change_requests.id` | Yes — as `changeRequestCode` on the decision response and the events feed | Loose integer, no FK — unchanged from the prior pack; FK plan is #1505, tracked in the Change Control pack |
| Hold window → gated CYCLE | `portal_hold_windows.run_id` (`msp.ts:6994`) | `portal_runbook_runs.id`, real FK, cascade delete | **NEW (#1940)** — `WireHoldWindow.runId` | Nullable for legacy rows; see §1.3's cycle-affinity gating |
| Hold window → gated step | `portal_hold_windows.gates_step_position` (`msp.ts:7006`) | `portal_runbook_steps.position`, **now scoped to the `run_id` above when present** | Yes | Unchanged column, newly disambiguated by the edge above |
| Hold window → runbook | `portal_hold_windows.runbook_id` (`msp.ts:6984`) | `portal_runbooks.id`, real FK, cascade delete | Yes | Unchanged from the prior pack |
| Cycle → schedule | `portal_runbook_runs.runbook_id` (`msp.ts:6907`) | `portal_runbooks.id`, real FK, cascade delete | Yes | **NEW (#1557)** |
| Step → cycle | `portal_runbook_steps.run_id` (`msp.ts:6934`) | `portal_runbook_runs.id`, real FK, cascade delete | Yes | **NEW (#1557)** — replaces the deprecated `runbook_id` link, §1.2 |
| Runbook step → user | `portal_runbook_steps.checked_by_user_id` (`msp.ts:6958`) | `users.id`, no FK | Written, not on the wire | Unchanged open gap, §7 |
| Oversharing catalogue → Runbook | `portal_runbooks.runbook_key` (`msp.ts:6863`) | `RUNBOOK_CATALOGUE[sopKind].runbookKey` (`portal-oversharing-sites.ts:140-166`) | Yes, ensure-or-fetch | Producer route correctly adapted to #1557's cycle model (`loadRunbookWire`, `:190-210`) — see §0 |

---

## 5. Notes on how the wire disagrees with its own storage

1. **Pillar casing is inconsistent within this one route file**, unchanged from the prior pack —
   verbatim lowercase on the runbook/hold list, title-cased only when written into a CR's
   `linkedFinding` (`titleCasePillar()`, `:124-127, :916`). Design must title-case itself when
   rendering the list.
2. **`portal_runbooks.status` (the SCHEDULE-level enum) is still never read by the GET route.**
   New nuance since the prior pack: `portal_runbook_runs.status` (the CYCLE-level column, same
   enum definition) *is* now read and drives `statusLabel`'s `complete` branch. Do not conflate the
   two — the schedule-level column remains apparently-dead weight (§7); the cycle-level column is
   live.

---

## 6. Sub-issues already filed — status unchanged

**`GET /api/portal/hold-windows/:holdId/events` is live, customer-scoped, fully built, wired into
`useRunbooks.loadHoldEvents` (#1619), and still has zero page consumers**, because `Design/portal/`
has produced no export for this module yet (confirmed empty at this pack's own extraction time —
see the pack header). #1619 (this module) / #1620 (the SOPs sibling) already cover this; no new
sub-issue filed. Per §0, this is now true of every endpoint in this route file, not only the events
one — but the root cause and the fix are identical (Design has not run yet), so it is one open
condition, not seven separate findings.

---

## 7. Open gaps — NOT decided (do not resolve; flag)

1. **`checkedByUserId` is written but never read back on the wire.** Unchanged from the prior pack.
   No issue owns exposing it.
2. **`portal_runbooks.status` (the schedule-level stored enum) is still never written or read by
   this route file's own logic** — genuinely unclear whether it's meant to gate something once a
   schedule is retired (`"abandoned"`), or is dead weight. Unchanged open gap; no issue owns it.
   Note the DIFFERENT, cycle-level `portal_runbook_runs.status` is now live (§3) — do not resolve
   this gap by assuming the schedule-level column works the same way.
3. **UTC-only day-word/close-day comparisons** (`portal-hold-windows.ts:198-206`). Unchanged open
   gap, no issue owns it.
4. **Do SOPs / RBDs inherit RACI from a service, or carry their own rows?** Unchanged open gap
   (#1523 territory), not resolved by this module.
5. **#1560's lifecycle seed landed on `msp_sops` (IAM-04 through IAM-07), not on
   `RUNBOOK_CATALOGUE`/`portal_runbooks`.** `SOP_KINDS` in this module's own producer
   (`portal-oversharing-sites.ts:133`, and its client mirror `govOversharingRunbooksLive.ts:25`)
   is still exactly `["convert", "reduceAdmins", "manageGuests"]` — three Oversharing-Sites-specific
   kinds, unrelated to the lifecycle set. #1560's own DONE bookend states this explicitly as
   deliberately out of scope ("the run-triggering UI/page for these SOPs — SCOPE STOP"). Restated
   here as a live open gap because Design must not assume the lifecycle SOPs have any runbook-side
   presence — they exist purely as `msp_sops` library rows today, reachable only via the MSP-side
   execution hook (§2), never via this route file's tables.

---

## 8. Honest-empty contract & the tri-state

| State | Wire behaviour | Hook signal |
|---|---|---|
| Loading | — | `loaded = false` until the first response resolves (`useRunbooks.ts`) |
| Live, genuinely empty | `200 { runbooks: [], holds: [], summary: emptySummary() }` (`:294, 453-455`) | `loaded = true`, `error = null`, empty arrays; `emptySummary()` returns `"No hold windows"` as real text |
| Read failed | non-2xx or thrown | `error` set to a fixed sentence, `useRunbooks.ts` |

**Confirmed live-empty at pack time, not merely a documented possibility:** `portal_runbooks` (0
rows), `portal_runbook_runs` (0 rows), `portal_hold_windows` (0 rows) are all genuinely empty on
this environment right now (header). A request against this environment today returns the
`emptySummary()` branch for real, not as a hypothetical.

**No unresolvable-scope ambiguity in this module**, unchanged from the prior pack:
`resolveCustomerId` either yields the JWT's own `customerId` or the route 403s outright — no
`scopeOrEmpty`-style collapse. The one route needing `resolveTenantScope` (raising the CR) 409s
explicitly rather than going silent.

**Summary line excludes closed windows entirely** (`summarise()`, `:462-482`), unchanged.

---

## 9. The forbidden list — declared, not merely absent

1. **No execution on release/close.** Unchanged, header `:38-44`.
2. **No id-in-path trust.** Unchanged — `ownedRunbook`/`ownedHold` re-read with the customer
   predicate on every write.
3. **No 403 that reveals another customer's row exists.** Unchanged — 404 either way.
4. **No un-guarded early close.** Unchanged — server-side `409` unless genuinely `"early"`.
5. **No silent alert re-fire.** Unchanged.
6. **No stale `waitDays` rewrite.** Unchanged.
7. **No second execution path for SOPs.** Unchanged in principle; now additionally enforced by
   #1938 forcing `origin: "manual"` on the one route that could otherwise fake a policy-origin row
   (§2).
8. **New: a hold window's cycle affinity is never assumed from `gatesStepPosition` alone once
   `runId` exists.** #1940's whole point — a position number is only unambiguous within the `run_id`
   it was raised against; do not design a client-side "which step does this gate" lookup that
   ignores `runId` when it is present.

---

## 10. Provenance

Extracted 2026-09-03 against branch `agent/1728-q1347`, regenerating the prior pack
(`3b6b14b7f`, 2026-08-29). Real drift verified via git log against
`artifacts/api-server/src/routes/portal-runbooks.ts`,
`artifacts/api-server/src/lib/portal-hold-windows.ts`,
`artifacts/api-server/src/lib/portal-runbook-cycles.ts` (new file), `lib/db/src/schema/msp.ts`, and
`artifacts/portal/src/components/holds/`, `artifacts/portal/src/components/govOversharingRunbooksLive.ts`.
Live DB state confirmed via direct `psql` against local `DATABASE_URL` (header). Architecture
deltas cited to GitHub issues #1488, #1493, #1556–#1560 (all DONE), #1940, #1938, #1773, #1775,
#1503, #1619/#1620, under epic #1485 and method issues #1577/#1578. Read-only pass: no product
code, schema, or UI was changed.
