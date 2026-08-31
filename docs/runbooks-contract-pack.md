# Runbooks — contract extraction pack for Claude Design

**#1488** (Portal New Design: Runbooks), following the method fixed by **#1577** (contract
extraction pack, run per module as step 3 of **#1578**), under **#1485** (EPIC: Portal New
Design). **Architected jointly with #1493** (SOPs / Runbooks) — this module has no separate
architecture; the resolution lives on #1493 and is restated in §2 below. Sub-issues **#1556–1560**.

Read-only. Every field below is extracted verbatim from the route's own wire interfaces, the
derivation library, and the Drizzle schema — cited to file:line. **Nothing here is authored or
invented.**

**Known-wrong contract, carried in deliberately and marked:** `portal_runbook_steps.checked` is
**per-runbook, not per-run.** There is no run history — a cycle reset wipes last cycle's
completion, so a customer cannot answer "did we do the guest access review last quarter, and who
signed it off?" Settled fix on **#1557**: recurrence becomes a **schedule that spawns runs**, each
with its own check-off state. Design must not treat the current per-runbook `checked` column as
permanent history.

Backend route: `artifacts/api-server/src/routes/portal-runbooks.ts` (customer-scoped)
Derivation library: `artifacts/api-server/src/lib/portal-hold-windows.ts`
Related route (writes the same tables, different file): `artifacts/api-server/src/routes/portal-oversharing-sites.ts`
Portal wire/hook files (path stale — `artifacts/msp-portal` was retired for `artifacts/portal` in
`f40438cdc`; see #1921): `artifacts/portal/src/components/holds/useRunbooks.ts` (carried over,
extended #1619), `holds/useHoldBadge.ts` (carried over); `holds/holdState.ts` was **not** carried
over and does not exist in `artifacts/portal`; `govOversharingRunbooksLive.ts` (carried over, under
`components/`, not `components/holds/`).
Page: none in `artifacts/portal` — `portal-v2-runbooks.tsx` was not carried over; `Design/portal/`
has no export for Active Runbooks yet.
Schema: `lib/db/src/schema/msp.ts:4358-4543` (`portalRunbooksTable`, `portalRunbookStepsTable`,
`portalHoldWindowsTable`, `portalHoldWindowEventsTable`)

---

## 0. The endpoints and their consumers

| Endpoint | Method | Route file:line | Consumed by | Orphaned? |
|---|---|---|---|---|
| `/api/portal/runbooks` | GET | `portal-runbooks.ts:235-354` | `useRunbooks` (`useRunbooks.ts:132-183`) → `portal-v2-runbooks.tsx` | No |
| `/api/portal/runbooks/:runbookId/steps/:position` | PUT | `portal-runbooks.ts:412-479` | `useRunbooks.setStepChecked` (`:187-230`), **also** `useOversharingRunbooksLive.toggleStep` (`govOversharingRunbooksLive.ts:91-115`) — the same generic toggle route, reused rather than duplicated | No |
| `/api/portal/runbooks/:runbookId/steps` | POST | `portal-runbooks.ts:484-543` | `useRunbooks.addStep` (`:232-245`) | No |
| `/api/portal/hold-windows/:holdId/extend` | POST | `portal-runbooks.ts:555-617` | `useRunbooks.extendHold` (`:247-263`) | No |
| `/api/portal/hold-windows/:holdId/close-early` | POST | `portal-runbooks.ts:844` (`decisionRoute`, `:742-841`) | `useRunbooks.decideHold("close-early")` (`:265-286`) | No |
| `/api/portal/hold-windows/:holdId/release` | POST | `portal-runbooks.ts:845` | `useRunbooks.decideHold("release")` | No |
| `/api/portal/hold-windows/:holdId/prepare-cr` | POST | `portal-runbooks.ts:846` | `useRunbooks.decideHold("prepare-cr")` | No |
| `/api/portal/hold-windows/:holdId/events` | GET | `portal-runbooks.ts:849-892` | `useRunbooks.loadHoldEvents` (`useRunbooks.ts`, added #1619) — **no page calls the hook yet** | **Yes (still no page)** |

**One real live endpoint with no page consumer: `GET /portal/hold-windows/:holdId/events`.** It
returns the per-window audit trail (`kind`, `daysDelta`, `reason`, `changeRequestCode`,
`createdAt` — `:878-885`), customer-scoped and re-read with the owning predicate, exactly the
event history the design's own copy promises ("Extending is recorded with a reason"). Filed at
pack time as **#1619**, see §6. #1619 wired the endpoint into the module's own data seam
(`useRunbooks.loadHoldEvents`) so it is reachable through the same hook every other hold-window
action uses — but stopped at the wire contract per the #1485 module order: `Design/portal/`
carries no export for Active Runbooks yet, so there is still no page anywhere in `artifacts/portal`
that calls `loadHoldEvents` or renders its result. The endpoint remains orphaned from a page's
perspective until Design produces that export and a future build wires it in.

**A related, out-of-module endpoint that writes into the same tables:**
`POST /api/portal/oversharing/runbooks/:sopKind` (`portal-oversharing-sites.ts:199-268`) ensures a
`portal_runbooks` row per SOP kind for the Overshared SharePoint drill-down (#1286), then reuses
this module's own generic step-toggle route rather than a second one. It is a real, consumed,
working endpoint — just not part of this route file, so it is noted here for completeness and not
re-specified.

---

## 1. Wire contract

### 1.1 Runbook list — `GET /api/portal/runbooks`

Returns `{ runbooks: WireRunbook[], holds: WireHoldWindow[], summary }`
(`portal-runbooks.ts:348`), customer-scoped by `eq(portalRunbooksTable.customerId, customerId)`
(`:251`) where `customerId` **is** the JWT's `customerId` claim directly — no MSP-era
`(mspId, tenantId)` resolution needed for these tables (header rationale `:12-18`). Steps and
holds are read in two extra queries and grouped in memory rather than N+1'd (`:261-273, :277-281`).

```ts
// portal-runbooks.ts:143-159 — WireRunbook (verbatim)
interface WireRunbook {
  readonly id: number;
  readonly runbookKey: string;
  readonly title: string;
  readonly context: string;
  readonly pillar: string;
  readonly startedOn: string;
  readonly cycleDays: number;
  readonly daysElapsed: number;
  readonly daysLeft: number;
  readonly checkedSteps: number;
  readonly totalSteps: number;
  readonly pct: number;
  readonly statusLabel: string;
  readonly steps: readonly WireStep[];
  readonly hold: WireHoldWindow | null;
}
```

| Wire field | Source column / derivation | DB type | Wire nullable | Status |
|---|---|---|---|---|
| `id` | `portal_runbooks.id` (`msp.ts:4363`) | serial, notNull | no | CURRENT |
| `runbookKey` | `runbook_key` (`msp.ts:4367`) | text, notNull | no | CURRENT |
| `title` | `title` (`msp.ts:4368`) | text, notNull | no | CURRENT |
| `context` | `context` (`msp.ts:4370`) | text, notNull | no | CURRENT |
| `pillar` | `pillar` (`msp.ts:4372`) | text, notNull | no | CURRENT · enum §3 (one of `journeyTokens`' six pillar keys, stored lowercase; **not** title-cased on this wire, unlike `linkedFinding`'s `titleCasePillar` at write time — §5 note 1) |
| `startedOn` | `started_on` (`msp.ts:4378`) — DATE column | text (`YYYY-MM-DD`), notNull | no | CURRENT |
| `cycleDays` | `cycle_days` (`msp.ts:4380`) | integer, notNull | no | CURRENT |
| `daysElapsed` | derived — `wholeDaysSince(startedOn, now)` (`:171-176, :312`), whole UTC-midnight days | derived integer | no | CURRENT — computed fresh per request, not stored |
| `daysLeft` | derived — `max(0, cycleDays - daysElapsed)` (`:313, :338`) | derived integer | no | CURRENT — floored at 0; a runbook past its cycle does not go negative |
| `checkedSteps` | derived — count of `steps[].checked === true` (`:310`) | derived integer | no | CURRENT |
| `totalSteps` | derived — `steps.length` (`:309`) | derived integer | no | CURRENT |
| `pct` | derived — `round(checkedSteps / totalSteps * 100)`, `0` if `totalSteps === 0` (`:311`) | derived integer | no | CURRENT |
| `statusLabel` | derived precedence — see below | derived string | no | CURRENT · enum §3 |
| `steps` | `portal_runbook_steps` rows for this runbook (`:283-294`) | array | no (may be empty) | CURRENT · see §1.2 |
| `hold` | the runbook's own **open** hold window, or `null` (`:296-305, :316`) | derived | yes | CURRENT · see §1.3 |

**`statusLabel` precedence, stated explicitly in the route's own comment (`:318-320`):**
`complete` wins, then an open hold window, then overdue, then on-track (`:321-327`):

```ts
// portal-runbooks.ts:321-327 (paraphrased)
complete ? "Complete"
  : hold ? runbookStatusFromHold(hold.state)   // "Decision due" | "Clear to close early" | "Holding"
  : overdue ? "Overdue"
  : "On track"
```

`complete` is `totalSteps > 0 && checkedSteps === totalSteps` (`:314`); `overdue` is
`daysLeftRaw < 0 && !complete` (`:315`) — a held runbook reads as held even when it is also past
its cycle, "because the hold is the reason" (`:319-320`).

### 1.2 Step — `WireRunbook.steps[]`

```ts
// portal-runbooks.ts:103-109 — WireStep (verbatim)
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
| `position` | `position` (`msp.ts:4396`) — 1-based render order, unique per runbook | integer, notNull | CURRENT |
| `text` | `text` (`msp.ts:4397`) | text, notNull | CURRENT |
| `checked` | `checked` (`msp.ts:4398`) | boolean, notNull, default `false` | **CURRENT — but see the known-wrong contract above (#1557): this is the ONLY completion record, and it is per-runbook, not per-run** |
| `isCustom` | `is_custom` (`msp.ts:4406`) | boolean, notNull, default `false` | CURRENT — `true` for a step the customer added through "Add a step or sub-step…"; the prototype renders custom steps with a different tick colour (schema comment `:4399-4405`) |
| `checkedAt` | `checked_at` (`msp.ts:4408`) | timestamptz, nullable | CURRENT — cleared to `null` on un-tick (`:454-455`), never left stale |

Not on the wire, but stored: `checkedByUserId` (`msp.ts:4410`) — `users.id` of whoever last
toggled the step, written on every PUT (`:456`) but never read back to the client. **Open gap, not
decided** — see §7.

### 1.3 Hold window — `WireRunbook.hold` / `WireHoldWindow[]` in `holds`

```ts
// portal-runbooks.ts:111-141 — WireHoldWindow (verbatim)
interface WireHoldWindow {
  readonly id: number;
  readonly holdKey: string;
  readonly title: string;
  readonly gates: string;
  readonly gatesStepPosition: number | null;
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

Built by `toWireHold` (`:178-232`), which composes stored columns with the **pure derivation
library** `portal-hold-windows.ts` — every derived field below is recomputed fresh from
`(startedAt, waitDays, extendedDays, scanVerdict, closedAt, now)` on each request, never stored.

| Wire field | Source | Status |
|---|---|---|
| `id`, `holdKey`, `title`, `gates`, `gatesStepPosition`, `pillar`, `why` | stored columns, verbatim (`msp.ts:4438-4449`) | CURRENT |
| `waitDays` | stored `wait_days` (`msp.ts:4452`) — the originally agreed wait, **never rewritten by an extension** | CURRENT |
| `extendedDays` | stored `extended_days` (`msp.ts:4462`) — running total of extensions, kept separate from `waitDays` so "agreed at 7 days, extended twice" stays visible | CURRENT |
| `startedAt`, `closedAt` | stored timestamps, ISO (`:208, :210`) | CURRENT |
| `scanVerdict` | stored `scan_verdict` (`msp.ts:4463`) | CURRENT · enum §3 |
| `scanLine` | stored `scan_line` (`msp.ts:4465`) — the evidence sentence, e.g. "2 sign-ins would have been blocked…" | CURRENT |
| `state`, `tone`, `daysLeft`, `daysSaved`, `hoursLeft`, `totalDays`, `closesAt` | `deriveHoldWindow()` (`portal-hold-windows.ts:171-195`) | CURRENT · derived, enum §3 |
| `badge` | `holdBadge()` (`:219-236`) | CURRENT · derived string, not a fixed enum — composes hours/day-word |
| `tMinus` | `holdTMinus()` (`:243-251`) | CURRENT · derived |
| `ticks` | `holdDayTicks()` (`:359-369`) — one tick per day of the effective wait | CURRENT · derived array of `"done" \| "partial" \| "todo"` |
| `scanLabel`, `scanTone` | `holdScanLabel()` / `holdScanTone()` (`:254-275`) — fixed text/colour per verdict | CURRENT · derived from enum §3 |
| `scanProvenance` | `holdScanProvenance()` (`:376-391`) — composes `scanSource` + `scanCadence` + `scanAt` into "{source}, scanned {cadence}, last {HH:MM} UTC" **at read time**, not stored as finished prose | CURRENT · derived |
| `primaryAction` | `holdPrimaryAction()` (`:283-300`) — `{ kind, label }`, kind one of `"release" \| "decide" \| "close_early" \| "prepare_cr"` | CURRENT · derived |
| `notificationsDue` | `dueHoldNotifications()` (`:323-352`) | CURRENT · derived array of `"t24" \| "t0" \| "early_clear"`, computed from the three `notified*At` stamps and never re-fired once sent |

**Four defects fixed here, not ported from the design prototype** (`portal-hold-windows.ts:11-71`,
each with its own pinned test in `portal-hold-windows.test.ts` **and** a client-side mirror
`holdState.ts` with its own `holdState.test.ts` guarding drift between the two copies):

1. `closing` was unreachable when the verdict was `clear` (proximity now tested before verdict).
2. `early` overstated days saved (`Math.ceil` → `Math.floor`, plus a "≥1 whole day" floor).
3. "closes tomorrow" was asserted from an hours threshold, not a UTC calendar date.
4. The badge and the T-minus readout switched at different thresholds (unified at 24h).

Design must draw the **fixed** behaviour, not the prototype's.

**Known limitation, stated in the library's own header (`portal-hold-windows.ts:198-206`):** every
comparison is UTC-to-UTC. A customer outside UTC reading "closes today" is being told about the
UTC day, not their own. Carrying tenant timezone would require a schema change nothing here does
yet — genuinely open, not decided (§7).

### 1.4 Tick / untick a step — `PUT /api/portal/runbooks/:runbookId/steps/:position`

Body: `{ checked: boolean }` (`putStepSchema`, `:410`). Re-reads the runbook with the customer
predicate before writing (`ownedRunbook`, `:391-398, :436-442`) — **404, not 403, for a runbook
belonging to someone else**, so existence cannot be probed (`:437-438` comment). On un-tick,
`checkedAt` is cleared to `null` rather than left stale (`:448-450, :454-455`) — the same rule
`portal-remediation-tracker.ts` uses for a customer-asserted tick. Success: `200
{ ok: true, position, checked }` (`:473`).

### 1.5 Add a custom step — `POST /api/portal/runbooks/:runbookId/steps`

Body: `{ text: string }`, 1–500 chars trimmed (`addStepSchema`, `:482`). Guarded at
`MAX_STEPS_PER_RUNBOOK = 200` (`:88`) — "a guard against an accidental loop, not a product limit"
— returning `409` once reached (`:521-524`). Position is `max(existing position) + 1` (`:513-526`);
always inserted `isCustom: true` (`:533`). Success: `201 { position, text }` (`:537`).

### 1.6 Extend a hold window — `POST /api/portal/hold-windows/:holdId/extend`

Body: `{ days: 1-90, reason: string (1-2000 chars, required) }` (`extendSchema`, `:550-553`). **A
reason is required by the schema, not merely by convention** — the design's own point: "a window
that keeps moving is visible rather than quietly permanent." `waitDays` is never rewritten;
`extendedDays` accumulates (`:590-599`). Extending resets `notifiedT24At` / `notifiedT0At` to
`null` (`:594-597`) — "a moved deadline invalidates the alerts already sent about the old one."
Writes a `portal_hold_window_events` row with `kind: "extended"`, `daysDelta`, `reason`
(`:602-608`). `409` if the window has already closed (`:580-583`). Success: `201
{ extendedDays }` (`:611`).

### 1.7 The three CR-raising decisions

`POST /api/portal/hold-windows/:holdId/close-early` · `/release` · `/prepare-cr`
(`decisionRoute()`, `:742-841`, wired at `:844-846`). Shared body:
`{ note?: string (max 2000), route?: string (max 200), window?: string (max 200) }`
(`decisionSchema`, `:621-627`).

**All three raise a real `msp_change_requests` row** via `raiseHoldChangeRequest()` (`:639-740`) —
this is the design's own rule stated for this page specifically: "closing a window early is a
change to an approved runbook, so it raises a change request with the scan evidence attached"
(header `:25-33`). The CR's description carries the scan evidence and any note/route the customer
gave (`:675-682`); its `preChangeSnapshot` carries the hold's state at decision time
(`:717-723`); its `linkedFinding` is `"{Title-cased pillar} · {hold title}"` (`:735`, via
`titleCasePillar` `:96-99`). Risk and category are computed by the **same server-side rule every
other CR uses** (`computeRiskLevel`, `deriveWorkload`, `categoryForWorkload` — shared with
`portal-change-control.ts`, `:688-693`). `psaTicketId` is always `"No ticket reference"` (`:708`);
`backupVerified: false`, `backupHash: ""` (`:714-716`) — "nothing has executed, so nothing has
been backed up."

`close_early` has an additional server-side guard, not just a UI one: the window's derived state
must actually be `"early"` at decision time, or `409` (`:777-794`) — "either the scan is not clear
or there is less than a day left to save."

Every decision writes a `portal_hold_window_events` row with `changeRequestId` set to the raised
CR's real id (`:812-818`) — this is what turns "every early close routes through a CR" from a
claim into a checkable query. `prepare_cr` **does not close the window** — "the paperwork is ready
and the wait continues" (`:820-822`); the other two set `closedAt` and a fixed `closedReason`
(`:823-832`). Success: `201 { changeRequestCode, decision }` (`:835`).

**What releasing does NOT do, stated explicitly in the file header (`:38-44`):** it does not
execute anything against the tenant and does not tick the gated step. It raises the CR that *asks*
for the step to be released; executing the step is the CR's job, after approval. Collapsing the
two "would be the portal quietly making a tenant change on a button press."

### 1.8 Hold window events (audit trail) — `GET /api/portal/hold-windows/:holdId/events`

**Orphaned from a page's perspective — see §0 and §6.** Returns `{ events: [{ kind, daysDelta,
reason, changeRequestCode, createdAt }] }` (`:878-885`), customer-scoped via `ownedHold`,
newest-first (`:872-876`). `changeRequestCode` is `formatChangeRequestCode(changeRequestId)` when
the event raised one, else `null` (`:883`) — `null` for every `extended` event, since extending a
window does not raise a CR (`:604-608`). #1619 wired this into `useRunbooks.loadHoldEvents(holdId)`,
which returns `readonly HoldWindowEvent[] | null` (`null` on a failed fetch, distinct from an empty
history). No page calls the hook yet.

---

## 2. Architected jointly with #1493 — the overlap, stated once

This module's issue body says plainly: **"This module does not have a separate architecture. The
answer lives on #1493."** The finding, in full (from #1493's settled architecture comment):

**`msp_sops` + `msp_sop_runs` is the correct shape** — a procedure **definition** (MSP-scoped,
versioned: `version`, `versionStatus`, `lastUpdatedBy`, `steps` jsonb — `msp.ts:3840-3866`) plus an
**execution** against a target (`runId`, `sopId`, `tenantId`, `targetEntity`, `operator`,
`currentStepIndex`, `totalSteps`, `passedStepsCount`, `psaTicketId`, `logs` —
`msp.ts:3873-3901`).

**`portal_runbooks` is NOT a procedure — it is a recurrence.** `startedOn` (date) + `cycleDays`
(integer) describe a cadence, not a definition-plus-run. And `portal_runbook_steps.checked` is
per-runbook, not per-run — the known-wrong contract this pack leads with.

**All three procedure origins named across #1488/#1490/#1489 are SOP-shaped, none is a
recurrence:**

| Origin | Issue | Target |
|---|---|---|
| Policy-invoked enactment | #1548 | a user, unattended |
| Lifecycle runbook (offboard, de-VIP, joiner/mover/leaver/promote/demote) | #1552 | a user, on demand |
| Remediation fix | #1539 | a finding |

**The unification (#1556):** one procedure definition, one run record. **Recurrence becomes a
property of a schedule that spawns runs** (#1557), not a row that gets wiped — which also
produces the missing run history for free. Origin becomes a property of the run: `policy |
lifecycle | remediation | manual`.

**Two complications, both resolved with existing precedent, not invented:**

- **Customer-authored steps** (`portal_runbook_steps.is_custom`) survive as a **per-tenant overlay
  on a versioned MSP definition** (#1558) — the same pattern `portal_ownership_assignments`
  already uses over computed base RACI.
- **Nothing writes `msp_sop_runs` today** (#1559) — `portal-sops.ts:47-51` states this directly:
  the design's "Execute this SOP" drawer is a client-side timer only. SOPs carry a `runnable` flag
  keyed on a step having a `graph_endpoint`; every SOP the New menu writes is forced
  `automationType: "manual"` with no `graph_endpoint`, so it is non-runnable by construction
  (`portal-sops.ts:54-59, :637-646`). The execution hook exists in shape (`msp_sop_runs`) and has
  never been connected.

**Seeded content is thin (#1560):** the only real runbook kinds live in this module's own sibling
route, `SOP_KINDS = ["convert", "reduceAdmins", "manageGuests"]`
(`govOversharingRunbooksLive.ts:25-27`, `portal-oversharing-sites.ts`). The lifecycle set from
#1552 — joiner, mover, leaver, promote, demote, de-VIP — does not exist as seeded data yet.

**What this means for THIS module's own wire contract (§1):** everything in §1 is the *current*,
real, working shape — a customer-scoped recurrence tracker with a hold-window state machine and a
real CR-raising path. Design should draw this module knowing it sits on the wrong side of the
#1556 unification line, and that the fix (definition/run split, per-cycle history) is settled but
not built. Do not invent a `runId` or per-run history field that isn't there yet — the honest
current shape is one `checked` boolean per step, full stop.

---

## 3. Real enum unions (and where each is actually enforced)

| Vocabulary | Values | Where fixed | Status |
|---|---|---|---|
| Runbook status (`portal_runbooks.status`) | `active`, `complete`, `abandoned` | `PORTAL_RUNBOOK_STATUS`, `msp.ts:4359` — a real Drizzle `text({ enum })`, unlike the risk-register module's plain-text columns | CURRENT — **not surfaced on the wire at all**; `WireRunbook.statusLabel` is a *derived display string* (`"Complete" \| "Decision due" \| "Clear to close early" \| "Holding" \| "Overdue" \| "On track"`, §1.1), computed from steps/hold/date, never read from this column. Open gap — see §7. |
| Hold scan verdict (`portal_hold_windows.scan_verdict`) | `clear`, `signals`, `watch` | `PORTAL_HOLD_SCAN_VERDICT`, `msp.ts:4428`; mirrored in the derivation lib as `HoldScanVerdict`, `portal-hold-windows.ts:77-78` | CURRENT |
| Hold window event kind (`portal_hold_window_events.kind`) | `extended`, `closed_early`, `released`, `cr_prepared` | `PORTAL_HOLD_EVENT_KIND`, `msp.ts:4512-4517` | CURRENT — written by `:602-608` (extend) and `:812-818` (the three decisions); read back only by the orphaned events endpoint (§0) |
| Hold state (derived, never stored) | `running`, `closing`, `due`, `early` | `HOLD_STATES`, `portal-hold-windows.ts:74-75`; mirrored client-side, `holdState.ts:35` | CURRENT — purely computed from `(startedAt, waitDays, extendedDays, scanVerdict, closedAt, now)`; there is no column to migrate if this changes |
| Hold decision (route param, not a column) | `close_early`, `release`, `prepare_cr` | `HoldDecision` type, `portal-runbooks.ts:629`; wired at `:844-846` | CURRENT |
| Primary action kind (derived) | `release`, `decide`, `close_early`, `prepare_cr` | `holdPrimaryAction()` return type, `portal-hold-windows.ts:286` | CURRENT — note this is a **different, four-value** vocabulary from the three-value `HoldDecision` above; `decide` has no corresponding POST route of its own — it means "show the decision UI", not a fourth server action |
| Runbook pillar / hold pillar | one of `journeyTokens`' six PILLAR_KEYS, stored lowercase | comment only, `msp.ts:4371` — **plain `text`, no enum constraint** | CURRENT by convention, not a validator; matches the Risk Register module's honesty note about the same pattern |

---

## 4. Cross-surface edges

| Edge | Column | Points at | Served today? | Notes |
|---|---|---|---|---|
| Hold window → Change Request | `portal_hold_window_events.change_request_id` (`msp.ts:4536`) | `msp_change_requests.id` | Yes — as `changeRequestCode` on `POST .../decision` responses (`:835`) and on the orphaned `GET .../events` (`:883`) | **Loose integer, no FK today.** The Change Control pack (`docs/change-control-contract-pack.md:264`) already records this exact edge as **CURRENT (loose int) → FK DECIDED #1505** — restated here rather than re-decided, per #1577's incremental cross-surface-edge-map instruction. |
| Change Request → hold window (reverse) | `msp_change_requests.linked_finding` (`msp.ts:3823`) | free text, e.g. `"Governance · <hold title>"` (`portal-runbooks.ts:735`) | Yes — one-directional, free text | Same FK plan (#1505) covers this direction; see the Change Control pack §7 for the full five-edge table. |
| Hold window → gated step | `portal_hold_windows.gates_step_position` (`msp.ts:4448`) | `portal_runbook_steps.position` — **a real machine-readable reference**, not only the `gates` prose | Yes — `WireHoldWindow.gatesStepPosition` (§1.3) | Schema comment (`:4442-4447`) notes the design prototype had only the sentence, so "which step is blocked" was not machine-readable and releasing a window could not unblock anything. This column is what fixed that. |
| Hold window → runbook | `portal_hold_windows.runbook_id` (`msp.ts:4436`) | `portal_runbooks.id`, **real FK**, cascade delete | Yes | Nullable — "holds are read by CUSTOMER, not by runbook id, so a window whose runbook link is null still belongs to its tenant and still appears" (`:275-276`). |
| Runbook step → user | `portal_runbook_steps.checked_by_user_id` (`msp.ts:4410`) | `users.id`, no FK | Written, **not on the wire** | See §1.2 — open gap, §7. |
| SOP run → CR (reference only, not a real link) | `msp_sop_runs.psa_ticket_id` | free text | Yes, on `/api/portal/sop-runs` (`portal-sops.ts:488-492`) | Shown as-is, "re-badged as a change request it may not be" only when it matches `/^CR-/` client-side — a genuinely different, weaker edge than the hold-window one above. Noted here as the #1493 sibling's own CR edge, for the eventual cross-module map (#1577). |

---

## 5. Notes on how the wire disagrees with its own storage

1. **Pillar casing is inconsistent within this one route file.** `WireRunbook.pillar` and
   `WireHoldWindow.pillar` are passed through verbatim, lowercase (`toWireHold` `:196`, runbook
   map `:334`) — but the same `pillar` value is **title-cased** the moment it is written into a
   change request's `linkedFinding` (`titleCasePillar()`, `:96-99, :735`), because "every
   customer-facing use of it in the design is title-cased." Design must title-case pillar keys
   itself when rendering the runbook/hold list; the wire does not do it for you there.
2. **`statusLabel` and `PORTAL_RUNBOOK_STATUS` are two unrelated vocabularies that happen to share
   a table.** The stored enum (`active`/`complete`/`abandoned`) is never read by the GET route at
   all — `statusLabel` is entirely re-derived per request from steps/hold/date (§1.1, §3). Nothing
   currently writes `complete` or `abandoned` into the stored column either (no route in this file
   ever sets `status`). Whether the stored column is meant to eventually gate something, or is
   dead, is an **open gap** — see §7.

---

## 6. Sub-issue filed at pack time

Per #1577 / the #1485 standing convention ("a contract pack that finds a real, live endpoint the
page does not call is a sub-issue, filed at pack time — it should never reach the Design step
still untracked"):

**`GET /api/portal/hold-windows/:holdId/events` is live, customer-scoped, fully built, and has
zero page consumers.** Filed as **#1619**, sub-issue of #1488, with an identical duplicate finding
filed from the SOPs/Runbooks side as **#1620**. #1619 wired the endpoint into
`useRunbooks.loadHoldEvents` (the module's own data seam) and stopped at that wire contract, per
the #1485 module order — no page exists to call it yet, since `Design/portal/` has no export for
Active Runbooks. #1620 confirmed the same wire contract already covers its own scope and required
no separate work. A customer told "extending is recorded with a reason" today still has no page
that shows them that record; that remains open until Design produces the export and a page wires
`loadHoldEvents` in.

---

## 7. Open gaps — NOT decided (do not resolve; flag)

Per the #1487-established convention this pack inherits: every DECIDED row needs an issue number;
anything without one is an OPEN GAP.

1. **`checkedByUserId` is written but never read back on the wire** (§1.2). No page can currently
   show "who ticked this step" even though the column exists. No issue owns exposing it — flag,
   do not resolve; it will likely fall out naturally once #1556/#1557 give steps a real per-run
   shape with an `operator`, matching `msp_sop_runs.operator`.
2. **`portal_runbooks.status` (the stored enum) is never written or read by this route file.**
   Genuinely unclear whether it is meant to gate something once the #1556 unification lands, or is
   dead schema. No issue owns this — flag.
3. **UTC-only day-word/close-day comparisons** (`portal-hold-windows.ts:198-206`) — a customer
   outside UTC sees "closes today" measured against the UTC day, not their own. Carrying tenant
   timezone is a real schema change nothing here does yet. No issue owns it — flag, do not fix as
   part of Design.
4. **Do SOPs / RBDs inherit RACI from a service, or carry their own rows?** Same open gap already
   flagged in the Risk Register pack (#1523) — restated here because it applies equally to the
   #1556 unified procedure object once it exists. Not resolved by this module either.

---

## 8. Honest-empty contract & the tri-state

| State | Wire behaviour | Hook signal |
|---|---|---|
| Loading | — | `loaded = false` until the first response resolves (`useRunbooks.ts:138, 169, 173`) |
| Live, genuinely empty | `200 { runbooks: [], holds: [], summary: emptySummary() }` when the customer has zero runbook rows (`portal-runbooks.ts:254-257`) | `loaded = true`, `error = null`, empty arrays; `emptySummary()` (`:356-358`) returns `"No hold windows"` as real text, not a blank |
| Read failed | non-2xx or thrown | `error` set to `"Your runbooks could not be loaded."` (`useRunbooks.ts:157, 172`) — the page must say so, not render zero runbooks as if that were the true count |

**No unresolvable-scope ambiguity in this module, unlike Risk Register's.** `resolveCustomerId`
either yields the JWT's own `customerId` or the route 403s outright (`:239-243` and equivalently
throughout) — there is no `scopeOrEmpty`-style collapse of "no tenant" into "empty" here, because
these tables are keyed directly on `customerId` with no MSP-era `(mspId, tenantId)` resolution
step to fail. The one route that *does* need `resolveTenantScope` — raising the CR
(`raiseHoldChangeRequest`, `:648-654`) — surfaces that failure as an explicit `409` with a stated
reason ("This account has no connected Microsoft 365 tenant to raise a change against"), not a
silent empty state.

**Summary line excludes closed windows entirely** (`summarise()`, `:365-385`): "the line answers
'what is waiting on you', and a window that has been decided is not." A customer with three closed
holds and zero open ones sees `"No hold windows"` — the honest statement, not a stale count of
history.

---

## 9. The forbidden list — declared, not merely absent

1. **No execution on release/close.** Stated explicitly in the file header (`:38-44`): these
   routes raise a CR and close the *window*; they never touch the tenant and never tick the gated
   step themselves. Executing the step is the CR's job, after approval.
2. **No id-in-path trust.** Every write re-reads the target row with the customer predicate
   (`ownedRunbook`, `ownedHold`) rather than trusting the id in the URL — "an id in a URL is a
   request, not a permission" (`:14-18`).
3. **No 403 that reveals another customer's row exists.** A runbook or hold belonging to someone
   else 404s exactly like one that does not exist (`:437-438` comment, same pattern on
   `ownedHold`).
4. **No un-guarded early close.** `close_early` re-derives the hold's state server-side and refuses
   with `409` unless it is genuinely `"early"` at decision time — "guarding here as well as in the
   UI, because the UI is not the gate" (`:775-776, :787-793`).
5. **No silent alert re-fire.** `dueHoldNotifications()` only reports a notification as due once,
   gated on the corresponding `notified*At` stamp being unset (`portal-hold-windows.ts:336,
   340, 347`); extending a window explicitly resets `notifiedT24At`/`notifiedT0At` because the
   deadline genuinely moved (`portal-runbooks.ts:594-597`), which is a deliberate re-arm, not a
   bug.
6. **No stale `waitDays` rewrite.** Extensions accumulate in `extendedDays`; the originally agreed
   `waitDays` is never mutated, so "agreed at 7 days, extended twice" stays visible rather than
   being absorbed into a single number (`msp.ts:4451-4462`).
7. **No second execution path for SOPs, ever** (#1493's own forbidden rule, restated here because
   it bears directly on where this module's unification lands): the eventual `msp_sop_runs` write
   path must route through the CR gate and the config-pack orchestrator — never a route that starts
   a real procedure against a tenant without passing change control (`portal-sops.ts:46-51` header).

---

## 10. Provenance

Extracted 2026-08-29 against branch `agent/1488-q788`. Sources cited inline by file:line:
`portal-runbooks.ts`, `portal-hold-windows.ts`, `portal-oversharing-sites.ts`, `portal-sops.ts`,
`lib/db/src/schema/msp.ts`, and the portal wire/hook files under
`artifacts/msp-portal/src/components/portal-v2/`. Architecture deltas cited to GitHub issues
#1488, #1493, #1548, #1552, #1539, #1556–1560, #1523, #1505, under epic #1485 and method issues
#1577 / #1578. Cross-checked against the already-shipped Change Control pack
(`docs/change-control-contract-pack.md`) and Risk Register pack
(`docs/risk-register-contract-pack.md`) for the shared hold-window↔CR edge and the shared #1523
open gap, per #1577's incremental cross-surface-edge-map instruction. Read-only pass: no product
code, schema, or UI was changed.
