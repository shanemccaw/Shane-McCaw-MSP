# Remediation Tracking — contract extraction pack

**For Claude Design. Extracted, not authored — every claim below is cited to file:line.**
Produced per #1577's method (contract pack = step 3 of #1578's five-step sequence), scoped to
this module only, as corrected on #1577's own comment. Read-only build: no product code, no
schema changes, no UI were touched to produce this document.

Module: **Remediation Tracking** (#1489, epic #1485). Architecture settled on #1489's own
2026-08-28 comment, with nine sub-issues (#1538–#1546). This pack is step 3 — the requirements
document Design draws against next. Schema + honest read (steps 1–2) were **not run as a
separate phase for this module**: the six live endpoints below already predate this
architecture pass (Git #647/#730–#734, #1381) and already serve real per-customer rows or an
honest empty state — there is no unbuilt schema step to do first. What #1538–#1546 settled is
architecture for the work still to build on top of that real base; none of it is built yet (see
§2).

---

## 1. Per-surface wire contract

Six live HTTP surfaces, all customer-scoped off the JWT's `customerId` claim
(`resolveCustomerId()`, repeated per-file — `portal-remediation-tracker.ts:122-125`), all gated
`requireRole("Assessment")` — the same floor as the rest of the Copilot Readiness journey
(`portal-assessment.ts`).

### 1a. `GET /api/portal/remediation-tracker`

Source: `artifacts/api-server/src/routes/portal-remediation-tracker.ts:153-194`. Read-only —
returns every stored step row for the calling customer plus a computed `pricing` block.

**Response shape** (`:188`): `{ steps: WireTrackerStep[], pricing: RemediationTrackerPricing }`.

**`WireTrackerStep`** (`:108-116`, built by `toWire()` `:127-145`):

| Field | Type | Nullability | Line |
|---|---|---|---|
| `stepId` | `string` (`"s1"`…`"s30"`, gap at s24/s25) | never null | `109` |
| `status` | `string` (real enum, §3) | never null | `110` |
| `completedAt` | `string \| null` (ISO) | null unless `status === "completed"` | `111` |
| `updatedAt` | `string \| null` (ISO) | null only for a synthesized fallback row (`:306-310`) | `112` |
| `verificationState` | `string` (`"unverified"` \| `"verified"` \| `"drift"`) | never null | `114` |
| `verifiedAt` | `string \| null` (ISO) | null while `unverified` | `115` |

**A step with no stored row is not served at all** — absence, not a zero-valued row, is the
"not started" state (`:147-152`). The client resolves the gap against the catalogue it renders;
this route only ever answers "what state is stored" (route header, `:44-55`). **This route
never returns a `total` or a step catalogue** — that lives in msp-portal's own tested
`.ts` modules (`previewRemediationGuide.ts` / `remediationLiveGuide.ts`), by design (route
header, `:44-55`): a `total` served from here would be a second source of truth that could
disagree with the guide the customer is looking at.

**`pricing`** (`RemediationTrackerPricing`, `remediation-tracker-pricing.ts:156-159`) — **a real,
CURRENT, but so-far-undocumented-on-any-#1538–1546-issue field**, computed live from the same
rows, not a second query (`portal-remediation-tracker.ts:183-186`):

| Field | Type | Line |
|---|---|---|
| `phases` | `RemediationTrackerPhasePricing[]` (exactly 3) | `remediation-tracker-pricing.ts:157` |
| `phases[].phase` | `1 \| 2 \| 3` | `137` |
| `phases[].pillars` | `RemediationTrackerPillar[]` (2 per phase, fixed grouping §3) | `138` |
| `phases[].ready` | `boolean` — every step across both the phase's pillars is in a resolved status | `139-141`, `173-177` |
| `phases[].fee` | `number` — flat `PILLAR_FEE` sum while not ready; `(fee/total)×outstanding` once ready and re-scanned | `141-142`, `179-196` |
| `phases[].feeDisplay` | `string` (`"$9,800"` format) | `143` |
| `hire` | `RemediationTrackerHirePricing` — `{ price, was, wasShow, saved, savedShow, cta, note }`, three copy variants (fully priced / partially discounted / fully verified) | `146-154`, `222-251` |

`PILLAR_FEE`/`PHASE_PILLARS`/`FULL_PROGRAMME_FEE` are the design's own literal dollar figures,
confirmed against the design file 2026-08-11 (`remediation-tracker-pricing.ts:14-16`,
`:82-100`) — not re-derived. A phase's fee only actually drops once BOTH `status === "completed"`
AND `verificationState === "verified"` on a step (`:169-171`) — a tick alone never moves the
price.

### 1b. `PUT /api/portal/remediation-tracker/steps/:stepId`

Source: `portal-remediation-tracker.ts:202-317`. Body: `{ status: <real enum, §3> }` (Zod-parsed,
`:103-105`). 400 for an unknown `stepId` (`:212-216`) or a status outside the enum (`:218-222`).
Idempotent upsert (`:236-252`) — safe to send twice.

**Every write resets verification to `unverified`** (`:233`, `:245`, `:251`) — a changed claim
invalidates whatever the last scan confirmed or flagged about the old one. `completedAt` is
server-derived from `status`, never accepted from the client (`:226`, header `:196-201`) — set
only when `status === "completed"`, cleared otherwise.

**Response**: `{ step: WireTrackerStep }` — the row re-read from the DB rather than trusted off
`.returning()` (`:254-256`, `:300-310`).

**Side effect, not on the wire contract but real**: when the actor is an MSP/admin role
(`RETAINER_MSP_ACTOR_ROLES`, `:75`) and the write lands `status: "completed"`, a retainer-work
entry is logged (`logRetainerWorkFromTracker`, `:287-298`) — **never** for a customer's own tick
on their own tracker (route header, `:69-74`).

### 1c. `GET /api/portal/remediation-tracker/pillar-scores`

Source: `portal-remediation-tracker-scores.ts:95-176`. Read-only, real numbers replacing what
was, before Git #1381, a hardcoded fixture (route header, `:7-12`).

**Response shape** (`PillarScoresResponse`, `:79-87`):

| Field | Type | Nullability | Line |
|---|---|---|---|
| `pillars` | `Record<string, PillarScore>` — six tracker pillar keys (§3) | never null; a pillar with no snapshot is present with all-null fields, not omitted | `80`, `100-121` |
| `copilotGate` | `CopilotGateResult` (from `computeCopilotGate()`, `copilot-gate.ts`) | never throws — degrades to no-score (`:157`) | `81` |
| `taskPoints` | `Record<string, TaskPoint>` — only steps with a real finding this run | steps with no finding data are **omitted**, not zero-filled (`remediation-pillar-scores.ts:140`) | `82` |
| `meta.hasAnyHistory` | `boolean` | never null | `84`, `165` |
| `meta.latestRunId` | `string \| null` (uuid) | null if no run exists | `85`, `166` |

**`PillarScore`** (`remediation-pillar-scores.ts:45-53`):

| Field | Type | Nullability | Meaning |
|---|---|---|---|
| `before` | `number \| null` | null unless ≥2 scans exist | the prior scan's real score, per `pillar-snapshot.ts`'s own `previousScore` stamp — **not recomputed here** |
| `now` | `number \| null` | null only when zero snapshots exist | the latest scan's real score |
| `dayOne` | `number \| null` | null only when zero snapshots exist | the tenant's very first real score, kept forever |
| `delta` | `number \| null` | null unless `before` is non-null | `now - before` |
| `status` | `"scored" \| "single_scan" \| "insufficient_data"` | never null | the honesty gate — see §4 |
| `capturedAt` | `string \| null` (ISO) | null iff no snapshot | latest snapshot's capture time |
| `scanCount` | `number` | never null | how many snapshot rows exist for this pillar |

**`TaskPoint`** (`:55-58`): `{ severity: string, weight: number }` — the mapped check's worst
real finding severity this run, translated through `SEVERITY_WEIGHT` (critical 3 / warning 2 /
info 1 / ok 0, `:36-41`). A step whose mapped check(s) map to more than one finding takes the
worst (route header, `:37-42`).

### 1d. `GET /api/portal/remediation-tracker/export.csv` / `.pdf`

Source: `portal-remediation-tracker-export.ts:313-374`. Every catalogue step (all 28), joined
against whatever the customer has stored — a step with no row serves as `"not_started"`, same
absence convention as 1a (`:72-76`, `:92-104`). **Deliberately reads only `stepId`/`status`/
`completedAt`/`updatedAt`** — this is "a record of the claim", not proof (file header, `:11-15`).
`ExportRow` fields (`:61-69`): `stepLabel`, `title`, `pillar`, `status`, `statusLabel` (via
`REMEDIATION_TRACKER_STATUS_LABELS`, §3), `completedAt`, `updatedAt`.

### 1e. `GET /api/portal/remediation-tracker/evidence-pack.pdf`

Source: `portal-remediation-tracker-export.ts:378-409`. **Only steps with
`verificationState === "verified"`** (`:146-151`) — a tick on its own is not evidence, only a
real re-scan qualifies (file header, `:16-25`). `EvidenceRow` fields (`:116-124`): `stepLabel`,
`title`, `pillar`, `statusLabel`, `verifiedAt`, `verifiedBy` (resolved to "MSP team"/the MSP's
own name for staff roles, or the customer user's name — `:206-212`, `MSP_STAFF_ROLES` `:49`),
`findingSummary` (the mapped check's real clean finding titles this run, or "Confirmed clean on
re-scan" when none carried a title — `:199-204`). Empty response renders "nothing verified yet"
(`:285-291`) rather than an empty table.

---

## 2. CURRENT vs DECIDED table

| Surface / capability | Status | Issue | Notes |
|---|---|---|---|
| `GET /portal/remediation-tracker` — step state + `pricing` | **CURRENT** | Git #730 (Phase A), #731 (Phase B), #734 (Phase E, pricing) | Real, served today, from `remediation_tracker_steps` |
| `PUT .../steps/:stepId` | **CURRENT** | #730 | The whole write surface today — one step, one status |
| `GET .../pillar-scores` | **CURRENT** | #1381 | Real snapshot-derived scores, replacing a fixture |
| `GET .../export.csv`, `.../export.pdf` | **CURRENT** | #733 | Claim-only export, no verification gate |
| `GET .../evidence-pack.pdf` | **CURRENT** | #742 | Verification-gated evidence pack |
| Verification state machine (`verificationState`/`verifiedAt`/`verifiedByRunId`, `reverifyRemediationTrackerSteps()`) | **CURRENT** | #732 | Fires from inside every real `runDiagnostics()` scan; already wired |
| Portal V2 page reads real status/verification per task via `stepId` | **CURRENT** | Git #1476 | `useRemediationTracker`/`useRemediationPillarScores` are genuinely called and their mutators genuinely write (see §5 for what is NOT real on the same page) |
| **Checklist items derived from findings** (join on `checkKey`, not a static per-tenant task list) | **DECIDED**, not built | #1538 | Today the Portal V2 catalogue (`remediationData.ts`) is a hand-authored fixture identical for every tenant — see §5 |
| **Fix route as a first-class, tenant-resolved dimension** (`shape = min(finding capability, tenant write-consent)`) | **DECIDED**, not built | #1539 | `tenants.consent.writeBack.status` already exists (`lib/graph.ts:1040`, `config-pack-orchestrator.ts:402`) as the tenant-side input; nothing reads it for this module yet |
| **Pointed re-verification scan, on demand** (run `remediation_knowledge_base.validationCommand` against one finding, on request) | **DECIDED**, not built | #1540 | The column exists (`lib/db/src/schema/msp.ts:4144`) and is rendered into documents (§ remediation-knowledge-base.ts) but nothing *executes* it as an on-demand action; today verification only ever arrives passively, as a byproduct of *any* scan (#732) |
| **CR gate — diff before approval, executable after** | **DECIDED**, not built | #1541 | `msp_change_requests.preChangeSnapshot`/`.proposedPayload` exist (`lib/db/src/schema/msp.ts:3801-3802`) generically for Change Control; nothing on this module raises a CR from a checklist item yet. Depends on #1496/#1497 |
| **Items exit to the risk register when declined** (three terminal states: verified / accepted / outstanding) | **DECIDED**, not built | #1542 | Depends on #1514, #1507 (Risk Register's own acceptance path) |
| **Fixed-outside-CR coexistence** (tracker shows resolved, drift register shows unauthorized, both true) | **DECIDED**, not built | #1543 | `drift-collector.ts:77-81`'s `deriveVerdict()` already implements the "CR present → approved" half; nothing on the remediation side reads a drift verdict yet. **No enforcement machinery — observation and surfacing only, recorded as a deliberate non-goal** |
| **Unauthorized-change notification, both sides** | **DECIDED**, not built | #1544 | Depends on #1491 (RACI holder model), #1518 (cross-boundary notification). Mechanism is `msp_alert_rules`/`msp_alert_events` (`lib/db/src/schema/msp.ts:3182`, `:3216`) — no new table |
| **Shadow IT as an accumulating governance risk** (RBD container + line items) | **DECIDED**, not built | #1545 | Fits the #1509 RBD container-plus-line-items shape; depends on #1510 (signature on scope expansion) |
| **Insider risk detection** (naming a person as a subject) | **NON-GOAL, deliberately not building** | #1546 | Recorded so it is not re-proposed; see §6 |
| Three-way boundary against Project (#1570) work and Retainer (#1569) hourly work | **DECIDED** (boundary, not code) | #1570 (its own third and fourth comments) | See §6 |

**Every DECIDED row above carries its issue number, per the pack requirement.** Where no issue
number is listed, it is an open gap, not a decision — none found for this module; all nine
architecture threads (#1538–#1546) are covered above.

---

## 3. Real enum unions only

All pulled verbatim from `lib/db/src/schema/msp.ts`, cited to file:line, or from the
frontend/lib mirrors that the platform's own drift-guard tests enforce stay byte-identical to
them. **Design must not invent a status vocabulary outside these lists.**

```ts
// lib/db/src/schema/msp.ts:4237-4244 — the customer's own claim about a step
REMEDIATION_TRACKER_STEP_STATUS = [
  "not_started", "completed", "already_handled",
  "not_applicable", "deferred", "shane_handles",
]

// lib/db/src/schema/msp.ts:4272 — whether a real re-scan has checked that claim
REMEDIATION_TRACKER_VERIFICATION_STATE = ["unverified", "verified", "drift"]

// lib/db/src/schema/msp.ts:4109 — remediation_knowledge_base row status
REMEDIATION_KB_STATUS = ["draft", "published"]  // only "published" renders as verified

// artifacts/api-server/src/lib/remediation-tracker-catalogue.ts:65-72 — display labels
REMEDIATION_TRACKER_STATUS_LABELS = {
  not_started: "Not started",
  completed: "Completed",
  already_handled: "Already handled another way",
  not_applicable: "Not applicable to this tenant",
  deferred: "Deferring to a later phase",
  shane_handles: "Have Shane do this one",
}

// remediation-pillar-scores.ts:43 — a pillar cell's honesty gate
PillarScoreStatus = "scored" | "single_scan" | "insufficient_data"

// remediation-pillar-scores.ts:36-41 — finding severity → point weight
SEVERITY_WEIGHT = { critical: 3, warning: 2, info: 1, ok: 0 }

// remediation-tracker-pricing.ts:72-78 — the tracker's six pillar keys
RemediationTrackerPillar = "governance" | "security" | "compliance" |
                            "licensing" | "adoption" | "health"

// remediation-tracker-pricing.ts:96-100 — fixed phase→pillar grouping (3 phases, 2 pillars each)
PHASE_PILLARS = { 1: ["governance","security"], 2: ["compliance","licensing"], 3: ["adoption","health"] }

// remediation-tracker-pricing.ts:107 — statuses that count as "resolved" for phase pricing
READY_STATUSES = new Set(["completed", "already_handled", "not_applicable", "deferred"])
// NOTE: "shane_handles" is deliberately EXCLUDED — a hand-off blocks phase-ready until
// resolved to something else (remediation-tracker-pricing.ts:24-37, Shane's own 2026-08-11 call).

// remediationLive.ts:94-103 (msp-portal mirror) — the same status set bucketed for the UI
RT_FIXED_STATUSES = new Set(["completed", "already_handled"])       // resolved-and-fixed
RT_ACCEPTED_STATUSES = new Set(["not_applicable", "deferred"])       // resolved-by-decision
// "shane_handles" resolves neither bucket — a hand-off leaves the work outstanding.
```

**Cross-module enums this module's DECIDED work will touch** (owned by other modules' packs,
reproduced here only because #1541/#1543/#1545 depend on them):

```ts
// lib/db/src/schema/msp.ts:3775 — msp_change_requests.change_class
["standard", "normal", "emergency"]

// lib/db/src/schema/msp.ts:3798 — msp_change_requests.status
["pending_approval", "scheduled", "in_progress", "completed", "rolled_back", "rejected"]

// lib/db/src/schema/msp.ts:4830-4835 — drift_events.verdict
DRIFT_EVENT_VERDICTS = ["approved", "attributed_unapproved", "unattributed", "informational"]

// lib/db/src/schema/msp.ts:4849 — drift_events.status (lifecycle, #1290)
DRIFT_EVENT_STATUSES = ["open", "resolved", "reopened"]
```

**`msp_risk_decisions.status`** (`lib/db/src/schema/msp.ts:3959`) is declared as plain
`text("status")` with **no enum array in code** — free text today. #1577's own body flags this
exact column as a contract already known to be wrong (`expired` conflated onto an acceptance
that is a signed, non-expiring fact — see #1507/#1527); this pack does not invent a union for it
because Risk Register's own pack (#1487) owns that correction.

---

## 4. The honest-empty contract, and the tri-state Design must not collapse

### 4a. Pillar-cell level — three real states, never a fabricated number

`remediation-pillar-scores.ts:100-130` produces one of three states per pillar, never a guess:

1. **`insufficient_data`** — zero snapshot rows for that pillar. `before`/`now`/`dayOne`/`delta`/
   `capturedAt` all null, `scanCount: 0`. The tracker's own honesty rule (route header,
   `:44-48`): "the tracker stops inventing its own scores."
2. **`single_scan`** — exactly one snapshot. `now`/`dayOne` populated (same value), `before` and
   `delta` stay null — nothing to compare against yet.
3. **`scored`** — ≥2 snapshots. Full rolling before/now/delta plus the permanent day-one.

### 4b. Step level — verification is a claim's proof, not the claim itself

A step's `status` (the claim) and `verificationState` (whether a real scan agreed) are two
independent facts that must render as such (schema header, `lib/db/src/schema/msp.ts:4177-4186`,
`:4247-4271`). The UI must show all three real crossings, not collapse them:

- `not_started` / `unverified` — nothing claimed, nothing to verify.
- any claimed status / `unverified` — a claim exists, no scan has spoken to it yet (the default
  the instant any write lands, including right after a write that used to be `verified`).
- any claimed status / `verified` — a real scan found every mapped check clean.
- any claimed status / `drift` — a real scan found a real problem on at least one mapped check,
  **despite** the claim. This is "Drifted — verification withdrawn" (schema comment,
  `:4262-4265`), not merely "not yet granted."

### 4c. Coverage gaps are real and permanent, not a loading state

Four of the 28 catalogue steps have **no mapped check at all** and are therefore never eligible
for verification, ever: two platform-wide gaps (steps 18, 28) and two process-only steps (27,
30) — `remediation-tracker-verification.ts:56-61`. Steps 24/25 were removed from the catalogue
entirely by #757 (`portal-remediation-tracker.ts:84-88`) and must not be resurrectable — a
write to either 400s (`:212-216`, the `STEP_ID_SET` exclusion). **Design must render "no
automated check exists for this step" as a fourth, permanent state distinct from "not yet
scanned"** — the two must not be visually the same "grey/pending" treatment, because one will
resolve on the next scan and the other never will.

### 4d. Evidence-pack level

Zero verified rows renders "nothing verified yet. Entries appear once a phase is re-scanned. A
tick on its own is not evidence." (`portal-remediation-tracker-export.ts:285-291`) rather than a
blank/broken PDF.

---

## 5. The forbidden list

**Every field the Portal V2 Remediation Tracker page (`portal-v2-remediation.tsx`) renders that
this module's real schema has no counterpart for**, stated plainly per `remediationData.ts`'s
own header (`:19-61`) and `remediationLive.ts`'s own header (`:16-38`) — the two files that
between them decide, for every field on a task, whether it is real or fixture.

**Real (wired through `stepId`, per §1a/1c):** whether a task is DONE (`status`), whether a real
scan VERIFIED it (`verificationState`), and the pillar score cells / Copilot gate / tenant score
headline (§1c).

**Fixture for every tenant, live or not — no backend counterpart exists anywhere in this
platform's schema** (`remediationData.ts:40-61`):

| Field / surface | What it actually is | Why |
|---|---|---|
| `title` (`t`), `problem` (`pr`), `fix` (`fx`), severity (`sv`), effort/fee (`ef`/`fee`/`bill`) | Hand-transcribed from the design prototype, identical for every tenant | No table holds a per-tenant finding's title/prose/severity/fee at this granularity |
| CR-stage pipeline (`crs`, the 7-stage stepper, `crAdvance()`) | Session-only `RtOverrides` state, reset on reload | "nothing associates a specific `msp_change_requests` row with a specific one of these 31 task ids at this 7-stage granularity" (`remediationData.ts:50-52`) — this is exactly what #1541's CR gate is designed to close |
| Hold window (`hold`, `holdClose()`, `RtHoldSeed`) | Session-only | `portal_hold_windows` is real schema but backs a **different page** (Operate → Active Runbooks), not this catalogue (`remediationData.ts:52-54`) |
| Evidence (`ev`/`evst`, `evAct()`) | Session-only | No evidence table exists for this catalogue at all |
| Runbook execution (`runRunbook()`'s step-by-step "Calling GET /sites..." animation) | A timed `setTimeout` simulation | "no backend executes `task.gr`'s Graph calls on this page's behalf" (`portal-v2-remediation.tsx:320-323`) — only the underlying task's `stepId` write at the end is real |
| Re-scan-on-demand (`verify()`'s "Run the check now" form) | Session-only, sets `ov.verified` directly | "there is no real 'trigger a re-scan now' endpoint... nothing in this module... may promote a step to verified from a status, a tick, a filter or any other UI state" (`:273-281`) — this is #1540's gap |
| Dependency graph (`dep`) | Fixture, transcribed from the prototype | No table represents inter-task dependency for this catalogue |
| Drift items (`rtDriftItems()`) | Pure function over the fixture `RT_TASKS` array, filtered on a fixture `drift` field — **zero arguments, no wire read** | `remediationModel.ts:764-774`; this is #1543's entire gap made concrete — a real "fixed outside CR" / drift-vs-tracker reconciliation does not exist on this page today |
| Microsoft Message Center panel (`rtMc()`) | Pure function over a fixture `RT_MESSAGE_CENTER` array — **zero arguments, no wire read** | `remediationModel.ts:788-800`; the real Message Center module (#1494, see `docs/microsoft-changes-contract-pack.md`) is a wholly separate, already-shipped surface this page does not call |

**Additionally forbidden at the module level** (capabilities Design must not assume exist): any
server-side "run this check right now" action; any server-side CR raised from a checklist item;
any server-side evidence upload/approval for this catalogue; any per-tenant finding catalogue
that varies from the fixed 28-step list.

---

## 6. Cross-module edges

- **Finding → checklist item** (#1538, not built): the join surface is `checkKey` —
  `remediation_knowledge_base.checkKey` (unique FK to `monitor_checks.key`,
  `lib/db/src/schema/msp.ts:4127`) already keys "how to fix it" content per check; nothing yet
  joins a *finding* (`msp_diagnostic_findings`) into a *checklist item* the way #1538 requires.
- **Tenant write-consent → fix-route shape** (#1539, not built): `tenants.consent.writeBack.status`
  (enforced fail-closed at `lib/graph.ts:1040`, surfaced as `customer_write_consent_missing` by
  `config-pack-orchestrator.ts:402`) is the real, already-live tenant-side input the
  `shape = min(finding capability, tenant permission)` formula needs. Nothing in this module
  reads it yet.
- **`remediation_knowledge_base.validationCommand` → pointed re-scan** (#1540, not built): the
  column is real (`lib/db/src/schema/msp.ts:4144`) and is already rendered, verbatim, into
  customer documents by `remediation-knowledge-base.ts:298` (`renderVerifiedRemediationBlock`).
  What does not exist is any code path that *executes* it on demand against a live tenant.
- **`msp_change_requests.preChangeSnapshot`/`.proposedPayload` → CR gate** (#1541, not built):
  both columns are real and generic to Change Control (`lib/db/src/schema/msp.ts:3801-3802`), not
  specific to this module. `linkedFinding` (`:3823`, free text, "Governance · External Sharing
  Drift" style) is the existing "raised from" trace-back column a remediation-originated CR would
  populate. Depends on #1496 (approval model), #1497 (CR as authorization gate).
- **Rejected finding → Risk Register** (#1542, not built): `msp_risk_decisions.checkKey`
  (`lib/db/src/schema/msp.ts:3947`) and `.registerRef` (`:4002`) are the real columns an
  accepted-as-risk exit would populate. Same rejection-to-risk shape as #1514 (Risk Register's own
  sub-issue), arriving from the remediation side.
- **`drift_events.crRef` → "fixed outside CR" reconciliation** (#1543, not built):
  `deriveVerdict()` (`drift-collector.ts:77-81`) already implements "linked CR → approved, known
  actor no CR → attributed_unapproved, nothing known → unattributed" purely from attribution —
  this is the real logic #1543's "both are true and must coexist" state has to read against.
  `baselineSnapshotId` (`lib/db/src/schema/msp.ts:4900`) ties a drift event to the specific
  baseline it was diffed from.
- **Unauthorized-change notification** (#1544, not built): `msp_alert_rules`
  (`lib/db/src/schema/msp.ts:3182`) / `msp_alert_events` (`:3216`) are the real, already-existing
  mechanism — no new table. Depends on #1491's RACI holder model
  (`portal_ownership_assignments`, `:4714`) and #1518's cross-boundary notification work.
- **Shadow IT risk** (#1545, not built): fits the RBD container-plus-line-items shape from #1509
  exactly — same `msp_risk_decisions` table, no separate path. Depends on #1510 (signature on
  scope expansion).
- **Shared `psa_ticket_id`** (`msp_change_requests.psaTicketId`, `lib/db/src/schema/msp.ts:3793`)
  — the same cross-surface key #1577 names generically; relevant here once #1541's CR gate exists.
- **The three-way boundary against Project (#1570) and Retainer (#1569) work** — settled on
  #1570's own comments, not this module's: *"a Project is work that cannot be done via
  automation"* was corrected to *"scale and structure"* — one finding with a write pack or
  PowerShell command is a **checklist item** (this module); hundreds of findings needing phased
  work, decisions and deliverables is a **Project**; human judgment with no automatable artifact
  at all, billed hourly, is a **Retainer**. `workflow_template_step_tasks.requires_manual_run`
  (referenced on #1570, currently **0 rows in the live DB** — the project work catalogue was
  never authored) is the per-task automation flag Projects would use, but per #1570's own
  correction it does **not**, by itself, separate the two modules — three catalog service entries
  (#40, #54, #159) are Projects whose *content* is remediation at scale. **A large remediation
  engagement should draw from the same finding set as this checklist**, presented as phased
  project work, rather than the two modules holding duplicate copies of the same findings — an
  open design question for whichever of #1489/#1570 builds second.

---

## 7. Orphaned live endpoints — checked, none found

Per the epic's standing convention (recorded on #1485's 2026-08-29 comment): every real live
endpoint with no page consumer must be filed as a sub-issue at pack time, not left as a note.
**Checked all six of this module's endpoints against every caller in `artifacts/msp-portal`**
(path stale — `artifacts/msp-portal` was retired for `artifacts/portal` in `f40438cdc`, #1921;
the callers named below, e.g. `portal-v2-remediation.tsx`, were NOT carried over and do not
exist in `artifacts/portal` today):

| Endpoint | Caller(s) |
|---|---|
| `GET /portal/remediation-tracker` | `useRemediationTracker.ts:192` (both `portal-v2-remediation.tsx` and `copilot-readiness-remediation-tracker.tsx` use the hook) |
| `PUT .../steps/:stepId` | `useRemediationTracker.ts:254` (`toggleComplete`/`setAction`, both genuinely called from `portal-v2-remediation.tsx`'s `tick()`/`reopenForm()`/`skip()`/`handToShane()`/`runRunbook()`/`rollback()`, per Git #1476) |
| `GET .../pillar-scores` | `useRemediationPillarScores.ts:60`, consumed by `portal-v2-remediation.tsx`'s gate/pillar-cell rendering |
| `GET .../export.csv`, `.../export.pdf`, `.../evidence-pack.pdf` | `RemediationTrackerBody.tsx:777-786` (the Full Remediation Guide surface) |

**No orphaned endpoint exists for this module.** This matches the epic's verified state at
filing time (#1485 body: "24 governance endpoints exist across the ten modules... nothing is
orphaned on the API side").

---

## 8. Open questions carried forward (unchanged by this pack — these are Product decisions, not extraction gaps)

- **#1539's own open question, still open on its issue** (resolved by its own follow-up
  comment, reproduced in §2/§6): shape resolves at read time as
  `min(finding capability, tenant write-consent)` — settled, not open, but newly-settled and not
  yet built.
- **Whether "informed" CRs need a fourth `changeClass` value** — not this module's question
  (owned by #1534, Microsoft Changes), but #1541's CR gate will hit the same `msp_change_requests`
  enum (§3) once built.
- **Project vs Remediation content overlap** (§6, last bullet) — genuinely unresolved which module
  "wins" when a remediation engagement's finding set is large enough to look like a Project; #1570
  leaves this as a real open design question for whichever builds second.
- **#1518 — whether C (Consulted) carries the acceptance gate** — referenced by #1544's
  dependency list; owned by Ownership/RACI's own pack (#1491), not re-litigated here.
