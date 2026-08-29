# SOPs / Runbooks — contract extraction pack for Claude Design

**#1493** (Portal New Design: SOPs), following the method fixed by **#1577** (contract extraction
pack, run per module as step 3 of **#1578**), under **#1485** (EPIC: Portal New Design).
Sub-issues **#1556–#1560**.

**Architected jointly with #1488 (Runbooks).** Both modules are covered in this one pack — see
§0 for why they are two objects, not one, and exactly where the boundary between them actually
sits. Read-only. Every field below is extracted verbatim from the two routes' own `Wire*`
interfaces and the Drizzle schema — cited to file:line. **Nothing here is authored or invented.**

**Known-wrong / known-thin, carried in deliberately and marked:**

| Contract | Problem | Issue |
|---|---|---|
| `msp_sops` / `portal_runbooks` as two tables | Both are "procedure definition + execution", but the boundary is drawn in the wrong place — see §0 | #1493, #1488, #1556 |
| `portal_runbook_steps.checked` is per-runbook, not per-run | Cycle reset wipes last cycle's completion; no run history exists | #1557 |
| No route writes `msp_sop_runs` | 13 GET / 1 POST across the two files; the execution hook has never been connected | #1559 |
| `SOP_KINDS` seed content | Three kinds only (`convert`, `reduceAdmins`, `manageGuests`); the lifecycle set (joiner/mover/leaver/promote/demote/de-VIP) does not exist | #1560 |

Backend routes: `artifacts/api-server/src/routes/portal-sops.ts` (SOPs library + runs, customer-
scoped), `artifacts/api-server/src/routes/portal-runbooks.ts` (Active Runbooks + hold windows,
customer-scoped)
MSP-side writer (context only, not a portal surface): `artifacts/api-server/src/routes/msp-sops.ts`
Pure derivations: `artifacts/api-server/src/lib/portal-sops.ts`, `.../lib/portal-hold-windows.ts`
Portal wire/model/live files: `artifacts/msp-portal/src/components/portal-v2/sopHubData.ts`,
`sopHubModel.ts`, `useSops.ts`, `sopCreate.ts`, `holds/useRunbooks.ts`
Schema: `lib/db/src/schema/msp.ts:3840-3901` (`mspSopsTable`, `mspSopRunsTable`),
`:4359-4543` (`portalRunbooksTable`, `portalRunbookStepsTable`, `portalHoldWindowsTable`,
`portalHoldWindowEventsTable`)

---

## 0. Two modules, one pack — why, and exactly where the line falls

`#1493`'s own comment thread settles this jointly with `#1488`, and it is the spine of everything
below:

**`msp_sops` + `msp_sop_runs` — a procedure DEFINITION plus an EXECUTION against a target.**
MSP-scoped (`msp_id`), versioned (`version`, `version_status`), authored (`last_updated_by`).
**Correct shape** — a library object, reusable across tenants, with a real run record.

**`portal_runbooks` + `portal_runbook_steps` — NOT a procedure.** Customer-scoped
(`customer_id`), carrying `started_on` (date) + `cycle_days` (integer). That is a
**recurrence**, and `portal_runbook_steps.checked` is per-runbook rather than per-run — when the
cycle resets, last cycle's completion is gone entirely (#1557).

**The finding:** every procedure origin identified across #1493/#1488 — policy-invoked
enactment (#1548), a lifecycle runbook (offboard, de-VIP, #1552), a remediation fix (#1539) — is
**SOP-shaped** (definition + run against a target). None of them is a recurrence. What
`portal_runbooks` actually models is a **recurring review cycle** (review guest access every 90
days, check it off, cycle resets), which is much closer to the review-clock split on #1507 (see
the Risk Register pack) than to a procedure.

**Settled unification (#1556):** one procedure definition, one run record. Recurrence becomes a
**property of a schedule that spawns runs**, rather than a row that gets wiped — which also
restores the missing run history for free. Origin becomes a property of the run:
`policy | lifecycle | remediation | manual`.

**Two complications, both resolved with precedent:**

- **Customer-authored steps** (`portal_runbook_steps.is_custom`) vs. MSP-authored, versioned SOPs
  — resolved as **definition-plus-per-tenant-overlay** (#1558), the same pattern
  `portal_ownership_assignments` already uses to layer a customer's saved edits over a computed
  base RACI.
- **Hold windows survive unchanged.** `portal_hold_windows` (`wait_days`, `scan_verdict`,
  `scan_cadence`, `HoldDecision = "close_early" | "release" | "prepare_cr"`) is a **gate on a
  run**, not a competing procedure model, and does not get folded into the unification.

**What this means for this pack:** §1 and §2 below extract the two CURRENT wire contracts as
they actually serve data today — that has not changed. §5 gives the settled unified model as
DECIDED, cited to its own sub-issues, so Design draws toward the target shape rather than the
two-table split it will read as the live payload.

---

## 0.1 The five surfaces and their consumers

| Endpoint | Method | Route file:line | Consumed by | Orphaned? |
|---|---|---|---|---|
| `/api/portal/sops` | GET | `portal-sops.ts:282-421` | `useSops` (`useSops.ts:94-95`) → SOP hub / library view | No |
| `/api/portal/sop-runs` | GET | `portal-sops.ts:435-586` | `useSops` (`useSops.ts:94-96`) → execution queue / audit history view | No |
| `/api/portal/sops` | POST | `portal-sops.ts:608-682` | `postSop` (`sopCreate.ts:75-107`) → New menu "Procedure" | No |
| `/api/portal/runbooks` | GET | `portal-runbooks.ts:235-354` | `useRunbooks` (`holds/useRunbooks.ts:154`) → Active Runbooks page; also polled by `useSops` (`useSops.ts:133`) for the hold-summary banner | No |
| `/api/portal/runbooks/:runbookId/steps/:position` | PUT | `portal-runbooks.ts:412-479` | `setStepChecked` (`holds/useRunbooks.ts:211`) | No |
| `/api/portal/runbooks/:runbookId/steps` | POST | `portal-runbooks.ts:484-543` | `addStep` (`holds/useRunbooks.ts:234`) | No |
| `/api/portal/hold-windows/:holdId/extend` | POST | `portal-runbooks.ts:555-617` | `extendHold` (`holds/useRunbooks.ts:250`) | No |
| `/api/portal/hold-windows/:holdId/close-early` | POST | `portal-runbooks.ts:844` (`decisionRoute`) | `decideHold` (`holds/useRunbooks.ts:272`) | No |
| `/api/portal/hold-windows/:holdId/release` | POST | `portal-runbooks.ts:845` | `decideHold` | No |
| `/api/portal/hold-windows/:holdId/prepare-cr` | POST | `portal-runbooks.ts:846` | `decideHold` | No |
| `/api/portal/hold-windows/:holdId/events` | GET | `portal-runbooks.ts:849-892` | **Nothing.** No page or hook calls this route anywhere in `artifacts/msp-portal/src`. | **Yes** |

**One orphaned live endpoint: `GET /api/portal/hold-windows/:holdId/events`.** It serves a real,
already-working per-window audit trail — `kind`, `daysDelta`, `reason`,
`changeRequestCode`, `createdAt`, newest-first (`portal-runbooks.ts:878-885`) — and nothing draws
it. Per the #1485 standing convention ("for every real live endpoint no page currently calls,
file a sub-issue under this module at pack time"), **sub-issue filed at pack time: #1620**
("SOPs/Runbooks: `GET /portal/hold-windows/:holdId/events` — live per-window audit trail, no
page calls it").

**A related producer worth naming, not orphaned:** `POST /api/portal/oversharing/runbooks/:sopKind`
(`portal-oversharing-sites.ts:201-272`, a different feature area) writes directly into
`portal_runbooks` / `portal_runbook_steps` — an ensure-or-fetch that creates one of three
catalogue runbooks (`convert` / `reduceAdmins` / `manageGuests`, `portal-oversharing-sites.ts:127-168`)
the first time a customer opens a site-fix drawer. It **is** consumed
(`govOversharingRunbooksLive.ts:62`). It is the real source of the "three kinds" thinness #1493's
own body flags — see §6.

---

## 1. Wire contract — SOPs (`portal-sops.ts`)

`CURRENT` = the field serves real data from this table today.
`DECIDED` = architecture is settled but not built; the issue number is given.
`DECIDED-wrong` = the field exists and serves today, but the settled architecture says its
current shape is wrong.

### 1.1 Library — `GET /api/portal/sops`

Returns `WireSopsPayload` (`portal-sops.ts:158-164`), built per-row in the handler
(`:282-421`). Reads `mspSopsTable` scoped by `mspId` only (the library is MSP-wide, not
per-tenant) and `mspSopRunsTable` scoped by `(mspId, tenantId)` (header, `portal-sops.ts:19-33`).

```ts
// portal-sops.ts:122-164 — WireSopLibraryItem / WireSopMeta / WireSopStats / WireSopsPayload (verbatim)
interface WireOwner {
  readonly init: string;
  readonly name: string;
  readonly tone: string;
  readonly unassigned: boolean;
}
interface WireSopRunSummary {
  readonly when: string;
  readonly who: string;
  readonly outcome: string;
  readonly state: string;
}
interface WireSopLibraryItem {
  readonly id: string;
  readonly title: string;
  readonly source: WireSopSource;        // "baseline" | "ours"
  readonly category: string;
  readonly purpose: string;
  readonly forWho: string;
  readonly updated: string;
  readonly author: string;
  readonly reviewCadence: string;
  readonly runnable: boolean;
  readonly finding: string | null;
  readonly steps: readonly string[];
  readonly runs: readonly WireSopRunSummary[];
  readonly owner: WireOwner;
}
interface WireSopMeta {
  readonly code: string;
  readonly level: string;
  readonly tags: readonly string[];
  readonly avg: string;
  readonly execs: number;
  readonly auto: Readonly<Record<number, string>>;
}
interface WireSopStats {
  readonly totalCount: number;
  readonly baselineCount: number;
  readonly oursCount: number;
  readonly automatedCount: number;
  readonly totalExecs: number;
  readonly avgExecTime: string;
  readonly execsThisMonth: string;
}
interface WireSopsPayload {
  readonly library: readonly WireSopLibraryItem[];
  readonly meta: Readonly<Record<string, WireSopMeta>>;
  readonly catOptions: readonly string[];
  readonly tagOptions: readonly string[];
  readonly stats: WireSopStats;
}
```

| Wire field | Source column / derivation | DB type | Status |
|---|---|---|---|
| `library[].id` | `sop_id` (`msp.ts:3843`) | text, notNull | CURRENT |
| `library[].title` | `title` (`msp.ts:3845`) | text, notNull | CURRENT |
| `library[].source` | `"ours"` when `last_updated_by` matches an email in the caller's own tenant, else `"baseline"` (`tenantAuthorEmails`, `portal-sops.ts:237-243, 323`) | derived | CURRENT — a real relationship, not a stored flag |
| `library[].category` | `category` (`msp.ts:3847`) | text, notNull | CURRENT |
| `library[].purpose` | `description` (`msp.ts:3846`) | text, notNull | CURRENT |
| `library[].forWho` | `whoRunsIt(automation_type, stepCount)` (`lib/portal-sops.ts:124-136`) | derived | CURRENT |
| `library[].updated` | `formatUpdated(last_updated_at, version)` (`lib/portal-sops.ts:153-157`) | derived from `msp.ts:3855, 3848` | CURRENT |
| `library[].author` | `personLabel(last_updated_by, resolvedName)` (`lib/portal-sops.ts:297-310`) | derived | CURRENT |
| `library[].reviewCadence` | hardcoded `"Not recorded"` (`portal-sops.ts:341`) | — | **NOT STORED** — no column holds this; deliberately not guessed from `version_status` (see the honest-mapping rule, `lib/portal-sops.ts:10-20`) |
| `library[].runnable` | `sopRunnable(steps)` = at least one step has a non-empty `graphEndpoint` (`lib/portal-sops.ts:116-118`) | derived from `steps` jsonb | CURRENT |
| `library[].finding` | hardcoded `null` (`portal-sops.ts:343`) | — | **NOT STORED** — no column, no derivation exists |
| `library[].steps` | `steps[].{title,description}` → `stepText()` (`lib/portal-sops.ts:73-78`), from `steps` jsonb (`msp.ts:3853`) | jsonb, notNull default `[]` | CURRENT |
| `library[].runs` | `msp_sop_runs` rows for this `sop_id`, newest first (`portal-sops.ts:328, 345-353`) | derived | CURRENT |
| `library[].owner` | `toOwner(last_updated_by, resolvedName)` (`portal-sops.ts:205-223`) — initials + a **stable-but-arbitrary** colour from `ownerTone()` (`lib/portal-sops.ts:319-334`), never a stored colour | derived | CURRENT (colour is deterministic, not authored) |
| `meta[id].code` | `code` (`msp.ts:3844`) | text, notNull | CURRENT |
| `meta[id].level` | `sopLevel(automation_type, stepCount)` (`lib/portal-sops.ts:96-108`) | derived | CURRENT |
| `meta[id].tags` | `compliance_tags` (`msp.ts:3851`) | jsonb, notNull default `[]` | CURRENT — **workload_tags is a separate axis, not merged in** (`portal-sops.ts:376-378`) |
| `meta[id].avg` | mean of real completed-run durations, else `"{estimated_minutes}m estimated"` labelled as an estimate (`portal-sops.ts:359-365`) | derived from `msp_sop_runs.started_at/completed_at` or `msp_sops.estimated_minutes` (`msp.ts:3850`) | CURRENT |
| `meta[id].execs` | count of this SOP's runs (`portal-sops.ts:380`) | derived | CURRENT |
| `meta[id].auto` | `{ [stepIndex]: graphEndpoint }` for every step that carries one (`portal-sops.ts:367-371`) | derived from `steps` jsonb | CURRENT |
| `stats.totalCount` | `sopRows.length` | derived | CURRENT |
| `stats.baselineCount` / `oursCount` | count by `source` | derived | CURRENT |
| `stats.automatedCount` | SOPs with ≥1 automated step (`portal-sops.ts:394-396`) | derived | CURRENT |
| `stats.totalExecs` | `runRows.length` | derived | CURRENT |
| `stats.avgExecTime` | mean of all real durations across the tenant's runs, `"—"` if none (`portal-sops.ts:406-410`) | derived | CURRENT — **not** an estimate fallback at this level (unlike per-SOP `meta.avg`) |
| `stats.execsThisMonth` | runs started in the current UTC calendar month (`isSameUtcMonth`, `lib/portal-sops.ts:337-341`) | derived | CURRENT |
| `catOptions` / `tagOptions` | first-seen-order dedupe of what the tenant's own library actually has (`portal-sops.ts:388-392, 424-431`) | derived | CURRENT — **not** a fixed design vocabulary; the prototype's sample values are deliberately not reproduced (comment `:385-387`) |

### 1.2 Runs — `GET /api/portal/sop-runs`

Returns `WireSopRunsPayload` (`portal-sops.ts:197-200`), built at `:435-586`.

```ts
// portal-sops.ts:166-200 — WireQueueStep / WireSopQueueItem / WireSopAuditItem / WireSopRunsPayload (verbatim)
interface WireQueueStep {
  readonly t: string;
  readonly s: "done" | "now" | "todo";
  readonly by: string;
}
interface WireSopQueueItem {
  readonly code: string;
  readonly title: string;
  readonly mode: string;
  readonly step: string;
  readonly pct: number;
  readonly started: string;
  readonly who: string;
  readonly state: "Running" | "Queued";
  readonly owner: WireOwner;
  readonly cr: string;
  readonly svc: string;
  readonly steps: readonly WireQueueStep[];
}
interface WireSopAuditItem {
  readonly when: string;
  readonly code: string;
  readonly action: string;
  readonly actor: string;
  readonly detail: string;
  readonly result: "Success" | "Partial" | "Failure";
  readonly hash: string;
}
interface WireSopRunsPayload {
  readonly queue: readonly WireSopQueueItem[];
  readonly audit: readonly WireSopAuditItem[];
}
```

| Wire field | Source column / derivation | Status |
|---|---|---|
| `queue[]` | one row per `msp_sop_runs` row whose `status` maps to `"Running"`/`"Queued"` via `queueStateFor()` (`lib/portal-sops.ts:205-210`); a finished run is excluded (goes to `audit` instead) | CURRENT |
| `queue[].code` | `msp_sops.code` for this run's `sop_id`, else the raw `sop_id` if the definition is gone (`portal-sops.ts:475`) | CURRENT |
| `queue[].title` | `sop_title` (`msp.ts:3878`) — the run's **own copy** of the title, not a live join | CURRENT |
| `queue[].mode` | `runModeLabel(total_steps, sop.steps.length)` — `"Automated steps only"` when the run's scope is narrower than the SOP's full step count, else `"Full execution"` (`lib/portal-sops.ts:218-223`) | CURRENT |
| `queue[].step` | current step number + title, or `"Queued · N steps in scope"` (`portal-sops.ts:478-482`) | CURRENT |
| `queue[].pct` | `progressPct(passed_steps_count, total_steps)` (`lib/portal-sops.ts:246-249`) | CURRENT — zero-safe |
| `queue[].started` | `relativeSince(started_at, now, verb)` (`lib/portal-sops.ts:186-197`) | CURRENT |
| `queue[].who` | `personLabel(operator, resolvedName)` | CURRENT |
| `queue[].state` | `queueStateFor(status)` — `"In Progress"` → `Running`, `"Blocked"` → `Queued` | CURRENT · enum §3 |
| `queue[].owner` | same `toOwner()` derivation as the library | CURRENT |
| `queue[].cr` | `psa_ticket_id` (`msp.ts:3889`) verbatim, or `"Not recorded"` — shown as-is; the design's `/^CR-/` test decides whether it renders as a CR link (`portal-sops.ts:488-492`) | CURRENT — **not** re-badged as a guaranteed change request |
| `queue[].svc` | first entry of `sop.workload_tags`, or `"—"` (`portal-sops.ts:469, 493`) | CURRENT |
| `queue[].steps[]` | per-step done/now/todo from `stepStates()` (`lib/portal-sops.ts:231-243`), `by` = `"Automated"` / operator name / progress string depending on state (`portal-sops.ts:494-505`) | CURRENT |
| `audit[]` | **two real merged sources**, newest-first by real timestamp: every run's start (+ completion, if any) event, and every SOP's "Version published" event (`portal-sops.ts:509-572`) | CURRENT |
| `audit[].action` | `"Execution started"` / `"Execution completed"` / `"Execution failed"` / `"Version published"` | CURRENT — fixed vocabulary, not stored |
| `audit[].result` | `auditResult(status, passed, total)` → `"Success" | "Partial" | "Failure"` (`lib/portal-sops.ts:269-279`) | CURRENT |
| `audit[].hash` | `evidenceHash(...)` — a **real SHA-256** over the entry's own canonical fields, shown first4…last4 (`lib/portal-sops.ts:286-289`) | CURRENT — reproducible from the record, not a random-looking placeholder |

### 1.3 Author a SOP — `POST /api/portal/sops`

**Request body** (`authorSopSchema`, `portal-sops.ts:600-606`):

| Field | Rule |
|---|---|
| `title` | `z.string().trim().min(1).max(200)` |
| `description` | `z.string().trim().min(1).max(2_000)` |
| `category` | `z.string().trim().min(1).max(120)` |
| `estimatedMinutes` | `z.number().int().min(0).max(100_000)`, optional |
| `steps` | array of `{ title (1-200 chars), description? (≤2000 chars) }`, 1–60 entries |

**Server-forced, not client-supplied** (`portal-sops.ts:634-668`): `sopId` (`SOP-CUST-<uuid>`),
`code` (`CUST-<uuid4>`), `version` (always `"v1.0"`), `automationType` (**always** `"manual"`),
every step's `type: "manual"` with **no `graphEndpoint`** — so `sopRunnable()` stays `false` on
anything authored here by construction (see §4). `lastUpdatedBy` is the caller's own email,
`versionStatus` is always `"Published / Active"`.

**Success `201`:** `{ id, sopId, code }` (`portal-sops.ts:676`).

---

## 2. Wire contract — Runbooks & Hold Windows (`portal-runbooks.ts`)

### 2.1 Runbooks — `GET /api/portal/runbooks`

Returns `{ runbooks: WireRunbook[], holds: WireHoldWindow[], summary }`
(`portal-runbooks.ts:348`), scoped by `customer_id` **directly** from the JWT claim — simpler
than the SOPs scoping because these tables were built for the portal, not adapted from the MSP
console (header, `:12-18`).

```ts
// portal-runbooks.ts:103-159 — WireStep / WireHoldWindow / WireRunbook (verbatim)
interface WireStep {
  readonly position: number;
  readonly text: string;
  readonly checked: boolean;
  readonly isCustom: boolean;
  readonly checkedAt: string | null;
}
interface WireHoldWindow {
  readonly id: number;
  readonly holdKey: string;
  readonly title: string;
  readonly gates: string;
  readonly gatesStepPosition: number | null;
  readonly pillar: string;
  readonly why: string;
  readonly state: string;          // "running" | "closing" | "due" | "early"
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
  readonly scanVerdict: string;    // "clear" | "signals" | "watch"
  readonly scanLabel: string;
  readonly scanTone: string;
  readonly scanLine: string;
  readonly scanProvenance: string;
  readonly primaryAction: { readonly kind: string; readonly label: string };
  readonly notificationsDue: readonly string[];
}
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

| Wire field | Source column / derivation | Status |
|---|---|---|
| `runbookKey` | `runbook_key` (`msp.ts:4367`) — stable catalogue key, e.g. `"gov-manage-guests"` or `"oversharing-convert-to-private"` | CURRENT |
| `title` / `context` | `title` / `context` (`msp.ts:4368, 4370`) | CURRENT |
| `pillar` | `pillar` (`msp.ts:4372`) — one of journeyTokens' six `PILLAR_KEYS`, stored as lowercase text | CURRENT · enum §3 |
| `startedOn` | `started_on` (`msp.ts:4378`), a DATE column — whole-day arithmetic done at UTC midnight, not against `now` (`wholeDaysSince`, `portal-runbooks.ts:171-176`) | CURRENT |
| `cycleDays` | `cycle_days` (`msp.ts:4380`) | CURRENT |
| `daysElapsed` / `daysLeft` | derived from `startedOn` + `cycleDays` against UTC today | CURRENT |
| `checkedSteps` / `totalSteps` / `pct` | counted from `portal_runbook_steps.checked` for this runbook (`msp.ts:4398`) | CURRENT |
| `statusLabel` | precedence: `complete` → `Complete`; else an **open** hold decorates it via `runbookStatusFromHold()`; else `overdue` → `Overdue`; else `On track` (`portal-runbooks.ts:318-327`) | CURRENT — a **closed** hold stops overriding the runbook forever (`:301-304`) |
| `steps[].checked` | `checked` (`msp.ts:4398`) | CURRENT — **per-runbook, not per-run** — see §0, DECIDED-wrong |
| `steps[].isCustom` | `is_custom` (`msp.ts:4406`) | CURRENT |
| `steps[].checkedAt` | `checked_at` (`msp.ts:4408`) — cleared to `null` on un-tick, never left stale (`portal-runbooks.ts:448-458`) | CURRENT |
| `hold` | the **open** (`closed_at IS NULL`) hold window for this runbook, or `null` (`portal-runbooks.ts:296-304, 316`) | CURRENT — a runbook can have zero or one currently-decorating hold; closed holds remain in the top-level `holds` array but stop attaching here |

**Hold window fields**, all derived by `lib/portal-hold-windows.ts` (pure, `now`-parameterised —
see the header there for the four prototype defects it fixes and does not carry over):

| Wire field | Source column / derivation | Status |
|---|---|---|
| `holdKey` / `title` / `gates` / `pillar` / `why` | stored verbatim (`msp.ts:4438-4449, 4476`) | CURRENT |
| `gatesStepPosition` | `gates_step_position` (`msp.ts:4448`) — a **real** reference into `portal_runbook_steps.position`, not only prose; the prototype had only the sentence, so nothing machine-readable told a release what to unblock | CURRENT |
| `state` | `deriveHoldState()` — proximity tested before scan verdict (fix for prototype DEFECT 1) | CURRENT · enum §3 |
| `tone` / `badge` / `tMinus` | `HOLD_TONE[state]`, `holdBadge()`, `holdTMinus()` — a single 24h threshold shared by both (fix for DEFECT 4) | CURRENT |
| `daysLeft` / `daysSaved` / `hoursLeft` / `totalDays` | `deriveHoldWindow()` — `Math.floor`/`Math.trunc`, never rounds up (fix for DEFECT 2) | CURRENT |
| `waitDays` / `extendedDays` | `wait_days` / `extended_days` (`msp.ts:4452, 4462`) — **never merged**; the agreed wait stays visible next to the accumulated extension | CURRENT |
| `startedAt` / `closesAt` / `closedAt` | `started_at` (`msp.ts:4450`) / derived / `closed_at` (`msp.ts:4478`) | CURRENT |
| `ticks` | `holdDayTicks()` — one entry per day of the effective wait | CURRENT |
| `scanVerdict` / `scanLabel` / `scanTone` / `scanLine` | `scan_verdict` (`msp.ts:4463`) + derived label/tone, `scan_line` (`msp.ts:4465`) verbatim | CURRENT · enum §3 |
| `scanProvenance` | composed from `scan_source` / `scan_cadence` / `scan_at` (`msp.ts:4472-4474`), **not** stored as finished prose so the timestamp is never stale | CURRENT |
| `primaryAction` | `holdPrimaryAction()` — one of `release` / `decide` / `close_early` / `prepare_cr`, per the README's decision table | CURRENT |
| `notificationsDue` | `dueHoldNotifications()` against `notified_t24_at` / `notified_t0_at` / `notified_early_clear_at` (`msp.ts:4491-4493`) | CURRENT **derivation**, but see §6 — nothing sends these yet; the columns and the pure "what's due" logic exist, the transport does not |

### 2.2 Step actions

| Endpoint | Body | Server-forced | Effect |
|---|---|---|---|
| `PUT /portal/runbooks/:id/steps/:position` | `{ checked: boolean }` (`putStepSchema`) | `checkedByUserId`, `checkedAt` (cleared on un-tick) | Toggles `portal_runbook_steps.checked` |
| `POST /portal/runbooks/:id/steps` | `{ text: string, 1-500 chars }` (`addStepSchema`) | `isCustom: true`, `position = max+1` | Appends a customer step, capped at `MAX_STEPS_PER_RUNBOOK = 200` (`:88`) |

Both re-read the runbook with the `customerId` predicate before writing — an id in the URL path
is a request, not a permission (header, `:16-18`). A runbook belonging to someone else 404s,
never 403s, so it is indistinguishable from one that does not exist (`:437-438`).

### 2.3 Hold-window actions

| Endpoint | Effect |
|---|---|
| `POST /hold-windows/:id/extend` | `{ days: 1-90, reason (required, 1-2000 chars) }`. Adds to `extended_days` (never rewrites `wait_days`); **clears `notified_t24_at`/`notified_t0_at`** so the moved deadline re-fires both alerts; inserts a `portal_hold_window_events` row, `kind: "extended"` |
| `POST /hold-windows/:id/close-early` | Guarded: 409 unless `deriveHoldState() === "early"` server-side too, not only in the UI (`:777-793`). Raises a real `msp_change_requests` row and **closes the window** |
| `POST /hold-windows/:id/release` | Raises a CR; **closes the window**. Does **not** execute the gated step — the CR does, after approval (header, `:38-44`) |
| `POST /hold-windows/:id/prepare-cr` | Raises a CR; does **NOT** close the window — the paperwork is ready, the wait continues (`:820-822`) |
| `GET /hold-windows/:id/events` | The decisions taken on one window, newest-first. **Orphaned — see §0.1, sub-issue #1620.** |

All three decision routes share `decisionRoute()` (`:742-842`) and `raiseHoldChangeRequest()`
(`:639-740`), which writes a real `msp_change_requests` row (see §4 for the full field mapping)
and records the link in a `portal_hold_window_events` row (`kind`: `closed_early` / `released` /
`cr_prepared`, `changeRequestId` set).

---

## 3. Real enum unions (and where each is actually enforced)

**Honesty note, same as the Risk Register pack:** most of these are plain `text` columns, not
Postgres `pgEnum`. The value set is the real vocabulary — Design must use exactly these strings
and invent none — but several are enforced only by a zod validator on the **write** path (which
lives in `msp-sops.ts`, not the portal route that reads them) or by convention/comment.

| Vocabulary | Values | Where fixed | Status |
|---|---|---|---|
| SOP `automation_type` | `automated`, `hybrid`, `manual` | `msp-sops.ts:35` (`z.enum`, MSP-side writer) | CURRENT — portal's own `POST /portal/sops` always forces `manual` |
| SOP step `type` | `manual`, `automated` | `msp-sops.ts:19` (`z.enum`, MSP-side writer) | CURRENT |
| SOP step `status` | `pending`, `running`, `success`, `failed` | `msp-sops.ts:23` (`z.enum`, MSP-side writer) | CURRENT — **not read anywhere on the portal wire**, per-step run state is derived instead from `stepStates()` on the run's own counters |
| SOP run `status` (`msp_sop_runs.status`) | `In Progress`, `Completed`, `Blocked`, `Failed` | `msp-sops.ts:52` (`z.enum`, MSP-side writer) | CURRENT — mapped on the portal wire via `queueStateFor()` / `runStateLabel()` / `auditResult()` |
| SOP `source` (derived, not stored) | `baseline`, `ours` | `portal-sops.ts:34` | CURRENT — a real relationship (author's tenant membership), not a column |
| Portal runbook `status` (`portal_runbooks.status`) | `active`, `complete`, `abandoned` | `msp.ts:4359` (`pgEnum`-style `text` with `{ enum: [...] }`) | CURRENT column, but **not read on the wire at all** — `statusLabel` is entirely re-derived from steps/hold/cycle (`portal-runbooks.ts:318-327`); flag for Design: the stored `status` and the shown `statusLabel` are two different things |
| Hold `state` (derived, not stored) | `running`, `closing`, `due`, `early` | `lib/portal-hold-windows.ts:74-75` (`HOLD_STATES`) | CURRENT |
| Hold `scan_verdict` (`portal_hold_windows.scan_verdict`) | `clear`, `signals`, `watch` | `msp.ts:4428` (`PORTAL_HOLD_SCAN_VERDICT`, real `{ enum }` column) | CURRENT |
| Hold event `kind` (`portal_hold_window_events.kind`) | `extended`, `closed_early`, `released`, `cr_prepared` | `msp.ts:4512-4517` (`PORTAL_HOLD_EVENT_KIND`, real `{ enum }` column) | CURRENT |
| Hold decision (route selector, not stored) | `close_early`, `release`, `prepare_cr` | `portal-runbooks.ts:629` (`HoldDecision` type) | CURRENT |
| Hold primary-action kind (derived) | `release`, `decide`, `close_early`, `prepare_cr` | `lib/portal-hold-windows.ts:286` | CURRENT |
| Hold notification kind (derived) | `t24`, `t0`, `early_clear` | `lib/portal-hold-windows.ts:314-315` (`HOLD_NOTIFICATIONS`) | CURRENT derivation; **transport unbuilt**, see §6 |
| Runbook `pillar` | one of journeyTokens' six `PILLAR_KEYS` | comment only, `msp.ts:4371` | CURRENT; no validator enforces it — plain text |

---

## 4. Cross-surface edges

| Edge | Column | Points at | Served today? | Notes |
|---|---|---|---|---|
| Hold decision → Change Request | `portal_hold_window_events.change_request_id` (`msp.ts:4536`) | `msp_change_requests.id` | Yes — surfaced as `changeRequestCode` in the 201 response and in the (orphaned) events feed | Every early-close / release / prepare-cr writes a real CR; `linked_finding` on the CR is `"{Pillar} · {hold.title}"` (`portal-runbooks.ts:735`) — see the Change Control pack for the CR's own full shape |
| CR risk computation | — | `computeRiskLevel()` / `deriveWorkload()` (`lib/portal-change-control.ts`, shared) | Yes | Hold-raised CRs use the **same server-side risk rule** every other CR uses — not a separate, hand-set risk level |
| Gated step | `portal_hold_windows.gates_step_position` (`msp.ts:4448`) | `portal_runbook_steps.position` | Yes, as a real integer reference | Machine-readable which step a hold blocks — the prototype had only the prose sentence |
| Runbook → Hold | `portal_hold_windows.runbook_id` (`msp.ts:4436`) | `portal_runbooks.id`, nullable, cascades | Yes | A hold with no runbook link still belongs to the tenant and still appears in the top-level `holds` array (`portal-runbooks.ts:275-276`) |
| SOP → Run | `msp_sop_runs.sop_id` (`msp.ts:3877`) | `msp_sops.sop_id` (no FK — free text match) | Yes | A run whose SOP definition has since been deleted still renders — `code` falls back to the raw `sop_id` (`portal-sops.ts:475`) |
| Oversharing catalogue → Runbook | `portal_runbooks.runbook_key` (`msp.ts:4367`) | `RUNBOOK_CATALOGUE[sopKind].runbookKey` (`portal-oversharing-sites.ts:134-168`) | Yes, ensure-or-fetch | A **different feature area** (Oversharing Sites, not one of the nine #1485 modules) is the real producer of every `portal_runbooks` row that exists in the seed data today — see §0.1 and §6 |
| SOP author identity | `msp_sops.last_updated_by` | `users.email` within the caller's tenant (`tenantAuthorEmails`, `portal-sops.ts:237-243`) | Yes | Drives the `baseline`/`ours` source split; **not** a stored FK, a real query join |
| Runnability gate | `steps[].graphEndpoint` (jsonb, no column) | — | Yes | `sopRunnable()` — the sole thing standing between "reference only" and "the change-control-gated Execute path"; customer-authored SOPs can never satisfy it (§1.3) |

**DECIDED edges not yet built (see §5 for the full unification):**

- **Origin edge** — a run's `origin: policy | lifecycle | remediation | manual` does not exist as
  a column anywhere. #1556.
- **Schedule → spawned runs** — no schedule object exists; recurrence is currently the runbook
  row itself. #1557.
- **RACI / ownership edge** — per the Risk Register pack's own open gap (§7 there, #1523): do
  SOPs/RBDs inherit RACI from a service, or carry their own rows? **Unresolved for this module
  too** — `msp_sops` has no owner column beyond `last_updated_by`, and `portal_runbooks` has none
  at all. Flagged, not resolved, here as well.

---

## 5. Settled architecture not yet built (DECIDED — every row carries an issue)

| Decision | Issue |
|---|---|
| Unify: one procedure definition, one run record, across `msp_sops`/`msp_sop_runs` and `portal_runbooks`/`portal_runbook_steps` | **#1556** |
| Recurrence becomes a property of a schedule that spawns runs, not a row that gets wiped | **#1557** |
| Per-tenant custom steps as an overlay on a versioned MSP definition (precedent: `portal_ownership_assignments`) | **#1558** |
| Connect the execution hook — a real write path for `msp_sop_runs`, routed through the change-control gate (#1497) | **#1559** |
| Seed the lifecycle procedure set — joiner / mover / leaver / promote / demote / de-VIP, as ITIL standard changes (#1554, #1555) | **#1560** |
| Run is invocable by the policy engine, not only by a human; a policy-triggered run is the same object as a hand-triggered one, distinguished by `origin` | **#1548** (constraint recorded on #1493's own thread) |
| Where a tenant has denied write consent, the same SOP renders as step-by-step instructions with a pointed check as proof | **#1539** |
| Lifecycle runbooks are the mechanism by which a customer deliberately changes a user's state in the tool (offboard, de-VIP) rather than that state drifting via direct Entra edits | **#1552** |
| Standard runbooks are catalog items with permanent approval — approved once, run unattended indefinitely; every execution still produces an auto-approved CR + verification check; revocation is the only control | **#1554**, **#1555** |
| A runbook is classified wholly standard or wholly non-standard, never mixed — a non-standard step gets its own sequenced runbook with its own approval | recorded on #1488's own thread, no separate sub-issue yet — treat as **OPEN GAP**, §7 |

---

## 6. Open gaps — NOT decided (do not resolve; flag)

Per the #1493/#1487 instruction: every DECIDED row needs an issue number; anything without one is
an OPEN GAP, not decided.

1. **Hold-window notification transport does not exist.** `dueHoldNotifications()` correctly
   computes what is owed (T-24, T-0, the early-clear finding) and the three `notified_*_at`
   columns exist to stamp against — but nothing calls it and nothing sends anything
   (`lib/portal-hold-windows.ts:302-313`, explicitly noted as out of round one). **No issue
   currently owns wiring the transport itself** — #1513 (Risk Register pack) is a different
   alerting path (`msp_alert_rules`/`msp_alert_events` for overdue RBD *reviews*), not this one.
   Genuinely open.

2. **The "wholly standard or wholly non-standard" runbook-classification rule has no sub-issue.**
   It is stated firmly on #1488's own thread ("A runbook is standard or it is not... two
   runbooks, sequenced") but is not represented in #1556-#1560. Flag for Design: do not draw a UI
   that lets one runbook mix standard and non-standard steps.

3. **Only three seeded SOP kinds exist, and all three come from a different feature area.**
   `RUNBOOK_CATALOGUE` (`portal-oversharing-sites.ts:134-168`) is Oversharing Sites' own producer,
   not something authored inside the SOPs/Runbooks module itself. #1560 covers seeding the
   *lifecycle* set; it does not cover whether the *oversharing* catalogue should move, be joined,
   or stay a separate producer writing into these same two tables. Genuinely open — do not assume
   an answer.

4. **`portal_runbooks.status` (`active`/`complete`/`abandoned`) is stored but never read on the
   wire.** `statusLabel` is entirely re-derived from steps/hold/cycle state instead (§3). Whether
   the stored column should drive anything, or be dropped as dead weight once the #1556
   unification lands, is not decided.

---

## 7. Honest-empty contract & the tri-state

| State | Wire behaviour | Hook signal |
|---|---|---|
| Loading | — | `loaded = false` until the first response resolves (`useSops.ts:85`, `useRunbooks.ts:139`) |
| Live, genuinely empty | `200` with `{ library: [], ... }` / `{ runbooks: [], holds: [], summary: emptySummary() }` (`portal-runbooks.ts:254-257`) | `loaded = true`, `error = null`, empty arrays |
| Read failed | non-2xx or thrown | `error` set to a fixed user-facing sentence — `"Your procedure library could not be loaded."` / `"Your runbooks could not be loaded."` (`useSops.ts:101, 125`; `useRunbooks.ts:157, 172`) — never a raw server message |

**Two nuances Design must not paper over:**

1. **The hold-summary banner on the SOP hub is deliberately failure-tolerant, independently of
   the page it decorates.** `useSops`'s `loadHolds()` swallows its own error and resolves
   `holds` to `null` rather than surfacing a second error state — "a missing banner is a far
   better failure than an error state over a working library" (`useSops.ts:21-23, 145-147`). A
   `null` holds value means *render nothing*, not *render zero*.

2. **`msp_sop_runs.psa_ticket_id` is shown as the raw stored string, not a guaranteed CR.**
   Empty renders `"Not recorded"`; a non-empty value is shown verbatim and the **client's own**
   `/^CR-/` pattern test decides whether it renders as a change-request link
   (`portal-sops.ts:488-492`). Design must not assume every queue row has a real, clickable CR.

3. **`library[].reviewCadence` and `library[].finding` are permanently `"Not recorded"` / `null`
   today** — not because the tenant's data is empty, but because **no column stores either
   value anywhere in the schema** (§1.1). This is a stronger statement than "live, empty": it is
   a field the current architecture cannot ever populate without a schema change. Do not design a
   filter or sort control against either field expecting it to vary.

---

## 8. The forbidden list — declared, not merely absent

1. **No customer-facing route executes anything.** `routes/portal-sops.ts` has **zero** write
   paths that touch `msp_sop_runs` — the New menu's only write authors a non-runnable
   *definition* (header, `:46-59`; §1.3). Starting a real procedure without passing the
   change-control gate is the exact thing the gate exists to prevent.
2. **A customer-authored SOP can never become runnable.** Forced `automationType: "manual"`,
   every step forced `type: "manual"` with no `graphEndpoint` — `sopRunnable()` provably stays
   `false` on anything the New menu writes (`portal-sops.ts:637-646`).
3. **Releasing a gated step does not execute it.** `POST /hold-windows/:id/release` raises the CR
   that *asks* for the step to be released and closes the window; it does not tick the step or
   touch the tenant (header, `:38-44`).
4. **`waitDays` is never rewritten by an extension.** Only `extendedDays` accumulates — the
   originally agreed wait stays visible next to the total (`portal-runbooks.ts:588-589`).
5. **An id in a URL path is never trusted as a permission.** Every runbook/hold mutation re-reads
   the row with the `customerId` predicate; a foreign id 404s exactly like a nonexistent one
   (`portal-runbooks.ts:391-407, 437-438`).
6. **Close-early is re-guarded server-side, not only in the UI.** `decisionRoute()` recomputes
   `deriveHoldState()` and 409s unless it is genuinely `"early"` — the UI's own gating is not
   trusted as the enforcement (`:775-793`).
7. **No fabricated review cadence or finding text.** Both render `"Not recorded"` / `null` rather
   than a plausible-looking guess, because neither is stored anywhere (§7.3).
8. **Insider-risk detection and enforcement machinery are recorded epic-level non-goals**
   (#1485's own thread) and apply here exactly as everywhere else in the epic: SOPs/Runbooks
   surface a procedure and its evidence, never a judgment about a person, and never a block/lockout.

---

## 9. Provenance

Extracted 2026-08-29 against branch `agent/1493-q787`. Sources cited inline by file:line:
`portal-sops.ts`, `lib/portal-sops.ts`, `portal-runbooks.ts`, `lib/portal-hold-windows.ts`,
`msp-sops.ts`, `portal-oversharing-sites.ts`, `lib/db/src/schema/msp.ts`, and the portal
wire/live/hook files under `artifacts/msp-portal/src/components/portal-v2/`. Architecture deltas
cited to GitHub issues #1493, #1488, #1556–#1560, #1548, #1539, #1552, #1554, #1555, under epic
#1485 and method issues #1577 / #1578. Orphaned-endpoint sub-issue filed at pack time: **#1620**.
Read-only pass: no product code, schema, or UI was changed.
