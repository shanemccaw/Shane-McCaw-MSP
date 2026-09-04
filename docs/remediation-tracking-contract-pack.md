# Remediation Tracking — contract extraction pack

**For Claude Design. Extracted, not authored — every claim below is cited to file:line.**
Regenerated for #1719, per the #1642/#2586 extraction method: read the real, current code in
full, cite it, and treat the prior pack as prior art to replace wholesale, not edit.

Module: **Remediation Tracking** (#1489, epic #1485). This is the customer-portal half of the
module's two surfaces; `docs/remediation-tracking-msp-console-contract-pack.md` (#2586) is the
operator-facing mirror under `/api/msp/customers/:customerId/remediation*` — same tables, same
business logic, different caller and auth, documented there rather than duplicated here.

## Why this pack exists — the prior one was wrong within 24 hours of shipping

The pack this replaces (`07f169258`, 2026-08-29) listed nine items in its §2 CURRENT/DECIDED
table as "DECIDED, not built": #1538–#1546. **#2828 confirmed eight of those nine are now closed
and built** — found during #2586's MSP-console audit, one day after the pack shipped, because
#1542 closed the very next day. Checked again today, against `main`, independently:

| Issue | Prior pack's claim | Reality (verified today) |
|---|---|---|
| #1538 (checklist derived from findings) | DECIDED, not built | **CLOSED** — `portal-remediation-checklist.ts` live, 3 routes |
| #1539 (fix route as first-class dimension) | DECIDED, not built | **CLOSED** — `portal-remediation-fix-routes.ts` live, `REMEDIATION_FIX_ROUTE` enum real |
| #1540 (pointed re-verification scan) | DECIDED, not built | **CLOSED** — `POST .../steps/:stepId/verify` live |
| #1541 (CR gate — diff before approval) | DECIDED, not built | **CLOSED** — `portal-remediation-reveal.ts` + checklist `raise-change` live |
| #1542 (exit to risk register on decline) | DECIDED, not built | **CLOSED** — `POST .../decline-to-risk` live, `accepted_risk` is a real 7th enum value, `WireTrackerStep` grew `terminalState` |
| #1543 (fixed-outside-CR coexistence) | DECIDED, not built | **CLOSED** — `portal-remediation-bypass-resolutions.ts` live |
| #1544 (unauthorized-change notification) | DECIDED, not built | **CLOSED** — `customer_tenant-alert-engine.ts`'s drift-alert path |
| #1545 (Shadow IT governance) | DECIDED, not built | **CLOSED** — `shadow-it-governance.ts` live, called from `drift-collector.ts:37` |
| #1546 (insider risk detection) | NON-GOAL | still correctly not built — no change |

Also confirmed stale on its own terms, independent of #2828's issue-by-issue table: the prior
pack's §1 documented **2 endpoints on the tracker route** (GET + PUT) where the file now holds
**5** (adding `POST .../verify`, `GET .../verification-guide`, `POST .../decline-to-risk`), and
**6 endpoints total** where **15** now exist across all 7 route files. Its §4c coverage-gap claim
("four steps have no mapped check: 18, 28, 27, 30") is also now wrong in a way #2828 didn't
name: `s28` gained a real check mapping (`onedrive:sync-errors`) under #753/#1956, so the real
gap today is three steps (18, 27, 30), not four — see §4c below.

**Also required by #1719's own blocking comment** (added 2026-08-30, now resolved): the module's
two content tables were near-empty when that comment was written —
`remediation_knowledge_base` had 1 row (draft, 0 published) and only 3 of 92
`config_pack_templates` rows were check-keyed. Verified live today (`psql "$DATABASE_URL"`,
2026-09-04):

| Table | State at #1719's blocking comment (2026-08-30) | State today (2026-09-04) |
|---|---|---|
| `remediation_knowledge_base` | 1 row, `draft`, 0 published | **153 rows, all `published`, 153 distinct `check_key`s** |
| `config_pack_templates` (check-keyed, template-mapped, pack `active`) | 1 execution-ready | **28 execution-ready, active `we_can_run` packs** |
| Fix-route item set (published KB ∪ execution-ready pack check keys) | effectively empty | **153 items** (the pack union equals the KB set — every execution-ready pack's check key already has a published KB row) |

The fix-route dimension (`REMEDIATION_FIX_ROUTE`) now resolves against real, populated content
for every item, not a near-empty table. This pack documents that real state.

---

## 1. Per-surface wire contract

**15 live HTTP surfaces** across 7 route files, all customer-scoped off the JWT's `customerId`
claim (`resolveCustomerId()`, repeated per-file, or `resolveTenantScope()` for the two surfaces
that also need the M365 tenant id — see §1g), all gated at least `requireRole("Assessment")` (the
lowest role carrying a `customerId` claim) except `decline-to-risk`, which floors at
`requireRole("CustomerUser")` (§1f).

### 1a. `portal-remediation-tracker.ts` (629 lines) — the s1–s30 legacy tracker

#### `GET /api/portal/remediation-tracker` (`:188-229`)

Read-only. Returns every stored step row for the calling customer plus a computed `pricing`
block. **Response shape** (`:223`): `{ steps: WireTrackerStep[], pricing: RemediationTrackerPricing }`.

**`WireTrackerStep`** (`:140-150`, built by `toWire()` `:161-180`):

| Field | Type | Nullability | Line |
|---|---|---|---|
| `stepId` | `string` (`"s1"`…`"s30"`, gap at s24/s25) | never null | `141` |
| `status` | `string` (real 7-value enum, §3) | never null | `142` |
| `completedAt` | `string \| null` (ISO) | null unless `status === "completed"` | `143` |
| `updatedAt` | `string \| null` (ISO) | null only for a synthesized fallback row (`:345-356`) | `144` |
| `verificationState` | `string` (`"unverified"` \| `"verified"` \| `"drift"`) | never null | `146` |
| `verifiedAt` | `string \| null` (ISO) | null while `unverified` | `147` |
| `terminalState` | `"verified" \| "accepted" \| "outstanding"` (derived, `remediationTerminalState()` `:133-137`) | never null | `149` |

`terminalState` is **new since the prior pack** (#1542) — **not persisted**, computed on every
read: `verified` wins if `verificationState === "verified"`; else `accepted` if
`status === "accepted_risk"`; else `outstanding` (`:133-137`).

A step with no stored row is not served at all — absence is the "not started" state (`:184-186`).
**This route never returns a `total` or a step catalogue** (route header `:49-60`) — that lives in
`artifacts/portal`'s own `previewRemediationGuide.ts`/`remediationLiveGuide.ts`.

**`pricing`** (`RemediationTrackerPricing`, `remediation-tracker-pricing.ts:164-167`), computed
live from the same rows (`:221`), not a second query:

| Field | Type | Line |
|---|---|---|
| `phases` | `RemediationTrackerPhasePricing[]` (exactly 3) | `remediation-tracker-pricing.ts:164` |
| `phases[].phase` | `1 \| 2 \| 3` | `145` |
| `phases[].pillars` | `RemediationTrackerPillar[]` (2 per phase, fixed grouping §3) | `146` |
| `phases[].ready` | `boolean` — every step across both the phase's pillars is `READY_STATUSES` | `148`, `181-186` |
| `phases[].fee` | `number` — flat `PILLAR_FEE` sum while not ready; formula-derived once ready | `150`, `196-210` |
| `phases[].feeDisplay` | `string` (`"$9,800"` format) | `151` |
| `hire` | `RemediationTrackerHirePricing` — `{ price, was, wasShow, saved, savedShow, cta, note }` | `154-162` |

`PILLAR_FEE`/`PHASE_PILLARS`/`FULL_PROGRAMME_FEE` are the design's own literal dollar figures
(`remediation-tracker-pricing.ts:83-93`, `:96-100`) — not re-derived. **`READY_STATUSES` now
includes `accepted_risk`** (`:115`) alongside `completed`/`already_handled`/`not_applicable`/
`deferred` — a declined-to-risk item counts as resolved for phase pricing, same as any other
terminal decision. `shane_handles` stays deliberately excluded (a hand-off blocks phase-ready
until resolved to something else).

#### `PUT /api/portal/remediation-tracker/steps/:stepId` (`:237-363`)

Body: `{ status: <7-value enum, §3> }` (Zod-parsed, `:114-116`). 400 for an unknown `stepId`
(`:248-251`) or a status outside the enum (`:253-257`). Idempotent upsert (`:280-297`).

**`accepted_risk` is explicitly rejected on this route** (`:265-268`):
`{ error: "accepted_risk cannot be set directly — use POST .../decline-to-risk" }` — a real,
new-since-the-prior-pack guard (#1542). Every write resets verification to `unverified`
(`:278`, `:296`) — a changed claim invalidates whatever the last scan confirmed. `completedAt` is
server-derived, never accepted from the client (`:271`).

**Response**: `{ step: WireTrackerStep }` — read back from the DB rather than trusted off
`.returning()` (`:301-318`, `:345-356`).

**Side effect, not on the wire contract but real**: when the actor is an MSP/admin role
(`RETAINER_MSP_ACTOR_ROLES`, `:86`) and the write lands `status: "completed"`, a retainer-work
entry is logged (`logRetainerWorkFromTracker`, `:333-343`) — never for a customer's own tick.

#### `POST /api/portal/remediation-tracker/steps/:stepId/verify` (`:378-431`) — new since the prior pack (#1540)

**Not documented at all by the prior pack**, whose §2 listed #1540 as "DECIDED, not built". Real,
live, fire-and-forget pointed re-verification: 400 if the step has no mapped check
(`stepCheckKeysFor()`, `:394-398`), 400 if nothing is claimed yet (`:407-410`), 400 if no
connected M365 tenant (`:412-416`). On success, fires `emitWorkflowEvent("remediation.verify_requested",
{ customerId, stepId })` (`:418`) through the Workflow Engine — never a bare function call, so the
run is a real, auditable `workflow_runs` row. Response `202`: `{ message, stepId, checkKeys }`
(`:421-425`). The verdict lands on the row `GET /remediation-tracker` already serves; the client
re-polls rather than awaiting a synchronous result.

#### `GET /api/portal/remediation-tracker/steps/:stepId/verification-guide` (`:443-483`) — new since the prior pack (#1540)

Also entirely undocumented by the prior pack. Read-only: surfaces
`remediation_knowledge_base.validationStep`/`.validationCommand`/`.expectedOutcome` for a step's
mapped check(s), **published rows only** (`fetchPublishedKnowledgeBaseRows`, `:466`). 400 for an
unknown step (`:454-457`), 404 if the step has no mapped check (`:460-463`). Response: `{ stepId,
checkKeys, guidance: [{ checkKey, validationStep, validationCommand, expectedOutcome }] }`
(`:467-477`).

#### `POST /api/portal/remediation-tracker/steps/:stepId/decline-to-risk` (`:504-626`) — new since the prior pack (#1542)

**The single largest gap in the prior pack** — #1542 was its own §2 row marked "DECIDED, not
built" and its exit shows up nowhere in the old §1. Role floor **`CustomerUser`** (`:506`), not
`Assessment` — this creates a signed liability record, matching `portal-risk-register.ts`'s own
floor for the same reason.

**Body** (`declineToRiskSchema`, `:495-499`): `{ fullName: string (2-200 chars), confirmed: true,
statement: string (1-2000 chars) }`. 400 on an unknown step (`:515-518`) or a failed parse
(`:520-524`). Ensures a tracker row exists via the same upsert idiom the PUT handler uses
(`:542-549`), then **409s if the step is already `accepted_risk`** (`:556-560`, permanent, same
guarantee the Risk Register's own accept endpoint carries).

Calls `declineRemediationStepToRisk()` (§6) to create the signed risk record, then a second
upsert flips the tracker row to `status: "accepted_risk"`, resetting verification the same way
every other write does (`:573-597`).

**Response `201`** (`:604-620`): `{ step: WireTrackerStep, rbdId: string, accepted: { by, on,
statement } }`.

### 1b. `PUT /api/portal/remediation/checklist/:checkKey` and its 2 siblings — `portal-remediation-checklist.ts` (242 lines) — entirely new since the prior pack (#1538/#1941)

**Zero routes in this file existed in the prior pack's world.** All 3 undocumented by it.

#### `GET /portal/remediation/checklist` (`:66-84`)

Resolves the calling customer's **latest scan's real adverse findings** (`critical`/`warning`,
`CHECKLIST_FINDING_SEVERITIES`, `remediation-checklist.ts:74`) into checklist items via
`resolveRemediationChecklist()` (§6). Response: `{ runId: string | null, items:
RemediationChecklistItem[] }` (`remediation-checklist.ts:103-107`).

**`RemediationChecklistItem`** (`remediation-checklist.ts:76-101`):

| Field | Type | Meaning |
|---|---|---|
| `checkKey` | `string` | the finding's stable identity — also the tracker claim's key |
| `findingId` | `string` | `msp_diagnostic_findings.finding_id` for this scan's instance — evidence, not identity |
| `severity` | `"critical" \| "warning"` | the finding's real severity |
| `title`, `description` | `string`, `string \| null` | the tenant-specific fact from the finding itself |
| `fixRoute` | `RemediationFixRoute` | §1539's resolved shape for this tenant (§3/§6) |
| `affordance` | `"execute" \| "copy" \| "link"` | derived from `fixRoute` |
| `hasVerifiedContent` | `boolean` | a `published` KB row exists for this check |
| `summary`, `remediationSteps`, `adminCenterPath`, `adminCenterUrl`, `validationCommand` | KB fields, null/`[]` when no KB row | verified content, when it exists |
| `status`, `completedAt`, `verificationState`, `verifiedAt` | the customer's existing tracker claim, keyed by `checkKey`; defaults `not_started`/`unverified` when no row exists yet | same vocabulary as §1a |

An untouched or clean-scanning tenant gets `{ runId: null | <uuid>, items: [] }` — no fixture,
no fabricated row (module header, `remediation-checklist.ts:39-45`).

#### `PUT /portal/remediation/checklist/:checkKey` (`:87-198`)

Same idempotent-upsert, same status vocabulary, same verification-reset-on-write rule as §1a's
PUT — writes the identical `remediation_tracker_steps` table with `step_id` holding the
`checkKey` string instead of an `s`-id (module header, `:21-30`). 400 for an unknown `checkKey`
(`isKnownCheckKey()` against `monitor_checks.key`, `:104-107`).

**No guard against `accepted_risk`** on this route — see §7 (already filed, #2827).

Response: `{ item: { checkKey, status, completedAt, updatedAt, verificationState, verifiedAt } }`
(`:174-191`) — note this shape has **no `terminalState`** field, unlike §1a's `WireTrackerStep`.

#### `POST /portal/remediation/checklist/:checkKey/raise-change` (`:208-239`) — #1941

Raises a real `msp_change_requests` row from a checklist item. 404 if the item names no open
finding for the tenant's latest scan (`resolveRemediationChecklistItem()`, `:221-225`) — a
resolved or never-real finding cannot have a change raised against it (fail-closed, #1941).
Otherwise calls `raiseChangeRequest()` (`portal-change-control-raise.ts:114`, the SAME function
the wizard's `POST /portal/change-control` uses) via
`buildRaiseChangeRequestInputForChecklistItem()` (§6). Response `201`:
`{ code, risk, workload, freezeException, riskDischarged, checkKey }`
(`portal-change-control-raise.ts:80-93`, route `:229`).

### 1c. `GET /api/portal/remediation/fix-routes` — `portal-remediation-fix-routes.ts` (162 lines) — new since the prior pack (#1539)

For the calling customer's tenant, every remediation item with a known fix route, resolved to
one of the three shapes. **The item set is the union of** (a) checks with a **published**
knowledge-base row and (b) checks a live, execution-ready config pack maps (`:96-120`) — verified
today to be **153 items**, all with published KB content (§ header table above).

**`WireFixRouteItem`** (`:48-64`):

| Field | Type | Meaning |
|---|---|---|
| `checkKey` | `string` | the finding's stable identity |
| `title` | `string` | KB `title` override, else `monitor_checks.label`, else the key |
| `fixRoute` | `RemediationFixRoute` | the resolved shape for THIS tenant (§3/§6) |
| `findingCapability` | `RemediationFixRoute \| null` | the finding-side authored ceiling before tenant consent; null when no KB row exists |
| `affordance` | `"execute" \| "copy" \| "link"` | derived from `fixRoute` |
| `hasWritePack` | `boolean` | a live, execution-ready config pack maps this check |
| `adminCenterPath`, `adminCenterUrl`, `validationCommand` | `string \| null` | affordance payload — only what the shape actually renders |

Response: `{ tenantWriteCeiling: RemediationFixRoute, items: WireFixRouteItem[] }` (`:153`), items
sorted by title (`:151`). 404 if the tenant row itself is missing (`:90-93`).

### 1d. `POST /api/portal/remediation/fix-routes/:checkKey/reveal` — `portal-remediation-reveal.ts` (134 lines) — new since the prior pack (#1541)

**This is #1541's CR gate on the wire** — the prior pack's §2 marked #1541 "DECIDED, not built"
with zero endpoint documented. Resolves whether a Change Request raised for this exact
`(mspId, tenantId, checkKey)` has cleared approval (`findRevealCandidates()` +
`evaluateRevealAuthorization()`, §6). **Fail-closed**: no CR at all, or every CR still
pending/rejected, withholds the script — 403 with the real reason (`:86-93`).

409 if the account has no connected M365 tenant (`:78-82`). On authorization, 404 if the CR is
genuinely approved but no published KB content exists yet for the check (`:97-103`) — distinct
from the 403: the gate passed, the content doesn't exist. Records the reveal as a `cr_events` row
(`recordScriptReveal`, `:107-114`, non-fatal — logged and continues on failure, `:113-114`
implied by the try/catch scope).

**`WireRevealedFix`** (`:46-54`): `{ checkKey, changeRequestCode, remediationSteps: {text, code?,
language?}[], prerequisites: string[], expectedOutcome, validationStep, validationCommand }`.

### 1e. `GET /api/portal/remediation/bypass-resolutions` — `portal-remediation-bypass-resolutions.ts` (55 lines) — new since the prior pack (#1543)

**#1543's entire gap, made concrete** — the prior pack's §2/§5 named this as the checklist's
biggest fixture-only gap (`rtDriftItems()`, a pure function over a fixture array with zero
arguments). The real route calls `resolveBypassResolutionsForCustomer()` (§6): a same-run join
between a `verified` tracker step and a `drift_events` row with verdict
`attributed_unapproved`/`unattributed` (never `approved`) on a domain that step's mapped checks
drift-track. **Purely observational** — zero writes, zero enforcement, zero scoring (module
header, `remediation-bypass-resolutions.ts:39-45`). Response: `{ items: BypassResolution[] }`
(`:46`).

### 1f. `GET /api/portal/remediation-tracker/pillar-scores` — `portal-remediation-tracker-scores.ts` (179 lines) — unchanged from the prior pack

Real numbers, replacing what was, before Git #1381, a hardcoded fixture. **Response shape**
(`PillarScoresResponse`, `:79-87`):

| Field | Type | Nullability | Line |
|---|---|---|---|
| `pillars` | `Record<string, PillarScore>` — six tracker pillar keys (§3) | never null; a pillar with no snapshot is present with all-null fields, not omitted | `80` |
| `copilotGate` | `CopilotGateResult` (`computeCopilotGate()`, `copilot-gate.ts`) | never throws — degrades to no-score | `81` |
| `taskPoints` | `Record<string, TaskPoint>` — only steps with a real finding this run | steps with no finding data are omitted, not zero-filled | `82` |
| `meta.hasAnyHistory` | `boolean` | never null | `84` |
| `meta.latestRunId` | `string \| null` (uuid) | null if no run exists | `85` |

**`PillarScore`** (`remediation-pillar-scores.ts:45-53`): `{ before, now, dayOne, delta, status,
capturedAt, scanCount }` — `status` is `PillarScoreStatus` (§3), the honesty gate (§4a).
**`TaskPoint`** (`:55-58`): `{ severity: string, weight: number }` via `SEVERITY_WEIGHT`
(critical 3 / warning 2 / info 1 / ok 0, `:36-41`).

### 1g. `portal-remediation-tracker-export.ts` (412 lines) — unchanged from the prior pack

#### `GET /portal/remediation-tracker/export.csv` / `.pdf` (`:313-374`)

Every catalogue step (all 28), joined against whatever the customer has stored — a step with no
row serves as `"not_started"` (`:92-104`). Deliberately reads only `stepId`/`status`/
`completedAt`/`updatedAt` (file header, `:11-15`) — "a record of the claim", not proof.
`ExportRow` fields (`:61-69`): `stepLabel`, `title`, `pillar`, `status`, `statusLabel` (via
`REMEDIATION_TRACKER_STATUS_LABELS`, §3 — **no `accepted_risk` entry exists, see §7**),
`completedAt`, `updatedAt`.

#### `GET /portal/remediation-tracker/evidence-pack.pdf` (`:378-409`)

Only steps with `verificationState === "verified"` (`:146-151`). `EvidenceRow` fields
(`:116-124`): `stepLabel`, `title`, `pillar`, `statusLabel`, `verifiedAt`, `verifiedBy` (resolved
to the MSP's name for staff roles or the customer's own name, `:206-212`, `MSP_STAFF_ROLES`
`:49`), `findingSummary` (the mapped check's real clean finding titles, or "Confirmed clean on
re-scan" when none carried a title, `:199-204`). Empty response renders "nothing verified yet"
(`:285-291`).

---

## 2. CURRENT vs DECIDED table — corrected

| Surface / capability | Status | Issue | Notes |
|---|---|---|---|
| `GET /portal/remediation-tracker` — step state + `pricing` + `terminalState` | **CURRENT** | Git #730/#731/#734, #1542 | `terminalState` is new since the prior pack |
| `PUT .../steps/:stepId` (5-status write, `accepted_risk` rejected) | **CURRENT** | #730, #1542 | |
| `POST .../steps/:stepId/verify` — pointed on-demand re-verification | **CURRENT** | #1540 | Prior pack listed this DECIDED; it is live |
| `GET .../steps/:stepId/verification-guide` | **CURRENT** | #1540 | Prior pack didn't document this route at all |
| `POST .../steps/:stepId/decline-to-risk` — signed exit to Risk Register | **CURRENT** | #1542 | The prior pack's single largest documentation gap — zero mention |
| `GET .../pillar-scores` | **CURRENT** | #1381 | Unchanged |
| `GET .../export.csv`, `.../export.pdf` | **CURRENT** | #733 | Unchanged |
| `GET .../evidence-pack.pdf` | **CURRENT** | #742 | Unchanged |
| `GET /remediation/checklist` — findings-derived checklist | **CURRENT** | #1538 | Prior pack listed this DECIDED; 3 real routes now exist |
| `PUT /remediation/checklist/:checkKey` | **CURRENT** | #1538 | No `accepted_risk` guard — filed, see §7 (#2827) |
| `POST /remediation/checklist/:checkKey/raise-change` | **CURRENT** | #1941 | Not itself named on #1538–#1546; the CR-raise counterpart to #1541's gate |
| `GET /remediation/fix-routes` — tenant-resolved fix-route dimension | **CURRENT** | #1539 | Prior pack listed this DECIDED; 153-item real catalogue today |
| `POST /remediation/fix-routes/:checkKey/reveal` — CR-gated script reveal | **CURRENT** | #1541 | Prior pack listed this DECIDED; fail-closed gate confirmed live |
| `GET /remediation/bypass-resolutions` — CR-bypass-but-resolved correlation | **CURRENT** | #1543 | Prior pack listed this DECIDED, called it the checklist's biggest fixture gap; now a real, purely-observational read |
| Unauthorized-change notification | **CURRENT** | #1544 | `customer_tenant-alert-engine.ts`'s drift-alert path, on `msp_alert_rules`/`msp_alert_events` |
| Shadow IT as an accumulating governance risk | **CURRENT** | #1545 | `shadow-it-governance.ts`, called from `drift-collector.ts:37` |
| **Insider risk detection** (naming a person as a subject) | **NON-GOAL, deliberately not building** | #1546 | Unchanged — recorded so it is not re-proposed |
| Three-way boundary against Project (#1570) and Retainer (#1569) work | **DECIDED** (boundary, not code) | #1570 | Unchanged, see §8 |

**Every DECIDED/NON-GOAL row above carries its issue number.** Eight of the nine architecture
threads the prior pack tracked (#1538–#1545) are now CURRENT; only #1546 remains a deliberate
non-goal. #1941 (checklist → raise-change) is new CURRENT work the original nine-issue set never
named.

---

## 3. Real enum unions only

All pulled verbatim from `lib/db/src/schema/msp.ts`, verified against the live schema
(`psql "$DATABASE_URL" -c '\d remediation_tracker_steps'` — no CHECK constraint on either
enum-carrying column; both are plain `text`, Zod-validated at the route layer only).

```ts
// lib/db/src/schema/msp.ts:7194-7202 — the customer's own claim about a step
// SEVEN values today, not six — the prior pack's §3 (written before #1542
// landed) listed only the first six.
REMEDIATION_TRACKER_STEP_STATUS = [
  "not_started", "completed", "already_handled",
  "not_applicable", "deferred", "shane_handles",
  "accepted_risk",   // #1542, 2026-08-30 — SIGNED, never settable by a bare PUT on the s1-s30 route
]

// lib/db/src/schema/msp.ts:7230 — whether a real re-scan has checked that claim
REMEDIATION_TRACKER_VERIFICATION_STATE = ["unverified", "verified", "drift"]

// lib/db/src/schema/msp.ts:7004 — remediation_knowledge_base row status
REMEDIATION_KB_STATUS = ["draft", "published"]  // only "published" renders as verified

// lib/db/src/schema/msp.ts:7035 — the fix-route dimension (#1539) — ENTIRELY
// ABSENT from the prior pack's §3, despite being real, live, and referenced
// by name in that same pack's own §2/§6.
REMEDIATION_FIX_ROUTE = ["we_can_run", "you_must_run", "admin_center_only"]

// remediation-fix-route.ts:51-55 — rank order the whole min()/max() resolution depends on
FIX_ROUTE_RANK = { we_can_run: 2, you_must_run: 1, admin_center_only: 0 }

// remediation-fix-route.ts:124-128 — the affordance a shape maps to
FIX_ROUTE_AFFORDANCE = { we_can_run: "execute", you_must_run: "copy", admin_center_only: "link" }

// remediation-checklist.ts:74 — the adverse-severity set a checklist item can be
CHECKLIST_FINDING_SEVERITIES = ["critical", "warning"]

// remediation-tracker-catalogue.ts:65-72 — display labels for the s1-s30 world.
// SIX entries only — no "accepted_risk" label. See §7: a step exported while
// accepted_risk renders the raw string "accepted_risk" as statusLabel.
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

// remediation-tracker-pricing.ts:72 — the tracker's six pillar keys
RemediationTrackerPillar = "governance" | "security" | "compliance" |
                            "licensing" | "adoption" | "health"

// remediation-tracker-pricing.ts:96-100 — fixed phase→pillar grouping (3 phases, 2 pillars each)
PHASE_PILLARS = { 1: ["governance","security"], 2: ["compliance","licensing"], 3: ["adoption","health"] }

// remediation-tracker-pricing.ts:115 — statuses that count as "resolved" for phase pricing.
// GREW BY ONE since the prior pack: "accepted_risk" now counts as resolved
// (a declined-to-risk item is a terminal decision, same as the other four).
READY_STATUSES = new Set(["completed", "already_handled", "not_applicable", "deferred", "accepted_risk"])
// "shane_handles" stays deliberately EXCLUDED — a hand-off blocks phase-ready
// until resolved to something else (Shane's own 2026-08-11 call, unchanged).
```

**Cross-module enums this module's CURRENT work touches** (owned by other modules' packs,
reproduced here only because §6 depends on them):

```ts
// lib/db/src/schema/msp.ts:4435 — msp_change_requests.change_class
["standard", "normal", "emergency"]

// lib/db/src/schema/msp.ts:4480 — msp_change_requests.status
["pending_approval", "scheduled", "in_progress", "completed", "rolled_back", "rejected"]

// lib/db/src/schema/msp.ts:8206-8212 — drift_events.verdict
DRIFT_EVENT_VERDICTS = ["approved", "attributed_unapproved", "unattributed", "informational"]

// lib/db/src/schema/msp.ts:8225 — drift_events.status (lifecycle, #1290)
DRIFT_EVENT_STATUSES = ["open", "resolved", "reopened"]
```

**`msp_risk_decisions.status`** remains plain `text("status")` with no enum array in code — free
text today, unchanged from the prior pack's note. This pack does not invent a union for it;
Risk Register's own pack (#1487) owns that correction.

---

## 4. The honest-empty contract, and the tri-state Design must not collapse

### 4a. Pillar-cell level — three real states, never a fabricated number

Unchanged from the prior pack: `remediation-pillar-scores.ts:100-130` produces one of
`insufficient_data` / `single_scan` / `scored`, never a guess. See §1f.

### 4b. Step level — verification is a claim's proof, not the claim itself

Unchanged in mechanism, **now a three-way read model per #1542's `terminalState`** (§1a):
`status` (the claim), `verificationState` (whether a scan agreed), and `terminalState` (the
checklist's derived resolution — `verified`/`accepted`/`outstanding`) are three related but
distinct facts:

- `not_started` / `unverified` / `outstanding` — nothing claimed.
- any claimed status / `unverified` / `outstanding` — a claim exists, unconfirmed.
- any claimed status / `verified` / `verified` — a real scan found every mapped check clean.
- any claimed status / `drift` / `outstanding` — a real scan found a real problem despite the
  claim ("Drifted — verification withdrawn", schema comment `msp.ts:7218-7223`).
- `accepted_risk` / `unverified` (always, per §1a's PUT rejection) / `accepted` — a SIGNED
  decision to accept the residual risk, distinct from both a clean scan and an unresolved claim.

### 4c. Coverage gaps are real and permanent, not a loading state — corrected

**Three** of the 28 catalogue steps have no mapped check at all, not four as the prior pack
claimed: **s18, s27, s30** (`remediation-tracker-verification.ts:102-127`, `STEP_CHECK_KEYS`).
`s28` — one of the prior pack's four — **gained a real mapping** (`onedrive:sync-errors`) under
#753/#1956; the prior pack's own §4c predates that fix. Steps 24/25 remain removed from the
catalogue entirely (#757, `portal-remediation-tracker.ts:93-98`) and are not resurrectable — a
write to either 400s. **Design must render "no automated check exists for this step" as a fourth,
permanent state distinct from "not yet scanned"** for s18/s27/s30 specifically.

### 4d. Evidence-pack level

Unchanged: zero verified rows renders "nothing verified yet..." (`portal-remediation-tracker-
export.ts:285-291`) rather than a blank/broken PDF. See §1g.

### 4e. Checklist level — new, #1538

An untouched or clean-scanning tenant's checklist is `{ runId: null | <uuid>, items: [] }`
(`remediation-checklist.ts:126-128`, `:146-148`) — never a fabricated item list. A checklist item
with no published KB row still appears (`hasVerifiedContent: false`, all content fields null) —
the item is real (a real finding exists), the content is honestly absent.

### 4f. Bypass-resolutions level — new, #1543

An empty result is the expected common case: no verified steps, no drift-tracked steps among the
verified ones, or no same-run out-of-change-control drift event — `resolveBypassResolutionsForCustomer()`
returns `[]` at any of these gates rather than fabricating a correlation
(`remediation-bypass-resolutions.ts:187-217`).

---

## 5. The forbidden list — declared, not merely absent

1. **No cross-customer read.** Every route resolves `customerId` off the JWT
   (`resolveCustomerId()`) or the tenant scope derived from it (`resolveTenantScope()`,
   `portal-customer-scope.ts:38`, `:59`) — never a client-supplied id.
2. **No route may set `accepted_risk` directly on the s1-s30 tracker.** §1a's PUT explicitly
   400s it (`:265-268`). The sibling checklist PUT does **not** carry the same guard — a real,
   already-filed gap (§7).
3. **No route executes a `you_must_run` fix's script without an approved Change Request.** §1d's
   reveal route is the fail-closed gate; `we_can_run` execution itself is `change-control-write-
   gate.ts` (#1497), out of this pack's scope entirely.
4. **No route fabricates a checklist item, a pillar score, a fix-route item, or a bypass
   resolution.** Every read is a real, derived query — an untouched tenant returns an empty
   array/object, never a fixture (§4e/§4f).
5. **This route set never labels a person as a subject** — #1546 (Insider risk detection) is a
   deliberate non-goal (§2).
6. **The evidence pack never counts a tick as evidence** — only `verificationState === "verified"`
   rows qualify (§1g).

**Additionally forbidden at the module level** (unchanged from the prior pack, still true): any
server-side "run this check right now" action outside the pointed-verify route (§1a); any
per-tenant finding catalogue for the s1-s30 world that varies from the fixed 28-step list; any
`Design/portal/` page today, since none exists yet (§8).

---

## 6. Cross-module edges

- **Finding → checklist item** (#1538, **CURRENT**): `resolveRemediationChecklist()`
  (`remediation-checklist.ts:117-244`) joins the tenant's latest scan's real adverse findings
  (`msp_diagnostic_findings`, `critical`/`warning`) against `remediation_knowledge_base.check_key`
  and the config-pack write-path, keyed by `checkKey` throughout.
- **Tenant write-consent → fix-route shape** (#1539, **CURRENT**): `resolveTenantWriteCeiling()`
  (`remediation-fix-route.ts:80-82`) reads `tenants.consent.writeBack.status` — `granted` permits
  `we_can_run`, anything else caps at `you_must_run`. Combined with the finding-side ceiling via
  `resolveFixRoute()`'s `min(findingCeiling, tenantCeiling)` (`:105-113`); the finding ceiling
  itself is raised to `we_can_run` by a live execution-ready pack regardless of the authored
  column (`resolveFindingCeiling()`, `:90-98`).
- **`remediation_knowledge_base.validationCommand` → pointed re-scan** (#1540, **CURRENT**):
  §1a's `POST .../verify` fires `emitWorkflowEvent("remediation.verify_requested", ...)`; the
  guide route (§1a's `GET .../verification-guide`) surfaces the same column's human-readable
  form for the customer to read.
- **`msp_change_requests.preChangeSnapshot`/`.proposedPayload` → CR gate** (#1541, **CURRENT**):
  `msp-remediation-reveal.ts`'s portal twin (§1d) requires an approved CR raised for the exact
  `(mspId, tenantId, checkKey)` via `findRevealCandidates()`/`evaluateRevealAuthorization()`
  (`remediation-reveal-gate.ts:104-123`, `:85-96`) — fail-closed, same underlying
  `msp_change_requests` rows the wizard's CR flow uses. `msp_change_requests.remediation_check_key`
  (`lib/db/src/schema/msp.ts:4580`, indexed `:4675`) is the real back-pointer a checklist-raised
  CR populates (§1b's `raise-change`, via `buildRaiseChangeRequestInputForChecklistItem()`,
  `remediation-raise-change.ts:33-57`).
- **Rejected finding → Risk Register** (#1542, **CURRENT**): `declineRemediationStepToRisk()`
  (`remediation-tracker-risk-decline.ts:144-289`) creates a SIGNED, active `msp_risk_decisions`
  row — `checkKey`/`additionalCheckKeys` (`lib/db/src/schema/msp.ts:6119`, `:6135`) carry every
  one of a step's mapped check keys (#1957, not just the first), `spawnedByRemediationStepId`
  (`:6340`, indexed `:6349`) is the real back-pointer to the declined tracker row. Never a
  fabricated dollar figure or Graph endpoint — `liabilityValueUsd: 0`, `graphEndpoint: ""`,
  explicitly documented absences, not guesses (`remediation-tracker-risk-decline.ts:41-44`).
  `reviewDueAt`/`reviewState` (`msp.ts:6192-6193`) are set per #1507's real review-clock model,
  not just the legacy display string.
- **`drift_events.crRef` → "fixed outside CR" reconciliation** (#1543, **CURRENT**):
  `resolveBypassResolutionsForCustomer()` (`remediation-bypass-resolutions.ts:168-259`) correlates
  a `verified` tracker step against a same-run `drift_events` row with verdict
  `attributed_unapproved`/`unattributed` on a domain the step's checks drift-track
  (`domainsForStep()`, `:109-118`, via `driftSpecForCheck()`). Purely observational — zero
  writes, zero enforcement (§4f).
- **Unauthorized-change notification** (#1544, **CURRENT**): `customer_tenant-alert-engine.ts`'s
  drift-alert path fires off `msp_alert_rules`/`msp_alert_events`
  (`lib/db/src/schema/msp.ts:3782`, `:3816`) — the real, pre-existing mechanism, no new table.
- **Shadow IT risk** (#1545, **CURRENT**): `shadow-it-governance.ts`, called directly from
  `drift-collector.ts:37` (`recordShadowItDrift`/`isUnauthorizedVerdict`) — fits the RBD
  container-plus-line-items shape, same `msp_risk_decisions` table.
- **Shared `psa_ticket_id`** (`msp_change_requests.psaTicketId`, `lib/db/src/schema/msp.ts:4453` —
  same cross-surface key #1577 names generically) — relevant here via §1b's CR-raise path.
- **The three-way boundary against Project (#1570) and Retainer (#1569) work** — unchanged from
  the prior pack, see §8.

---

## 7. Open gaps found by this audit — flagged here, cross-referenced where already filed

### 7.1 Already filed — `PUT .../remediation/checklist/:checkKey` accepts `accepted_risk` directly, with nothing behind it

**Confirmed live today, same as #2586's own audit found it**: `portal-remediation-checklist.ts:87-198`
validates its write body against the full 7-value `REMEDIATION_TRACKER_STEP_STATUS` enum
(`putItemSchema`, `:55-57`) with **no guard excluding `accepted_risk`** — unlike the sibling
s1-s30 route (§1a), which explicitly 400s that exact value. A bare
`PUT /remediation/checklist/:checkKey { "status": "accepted_risk" }`, reachable by any
`Assessment`-tier customer, sets an item to `accepted_risk` with no `msp_risk_decisions` row, no
typed name, no confirmation — the exact claim-vs-proof collapse `accepted_risk` exists to
prevent. **Already filed as #2827** (`bug` + `security`, parented under Feature #1684) during
#2586's build, which found the identical gap on the MSP-console mirror at the same time. Not
re-filed here — cited so this pack's own §5/§2 don't silently omit it.

### 7.2 Noted, not filed — `REMEDIATION_TRACKER_STATUS_LABELS` has no `accepted_risk` entry

Per §3: a step exported via `.../export.csv`/`.../export.pdf` while its status is `accepted_risk`
renders `statusLabel` as the raw string `"accepted_risk"` (the `?? status` fallback,
`portal-remediation-tracker-export.ts:100`) rather than a human label. Purely cosmetic on an
export document; below this pack's filing threshold, same bar #2586's own pack used for the
identical gap on its side.

### 7.3 Noted, not filed — s18/s27/s30 coverage gap correction

§4c above corrects the prior pack's own claim (which named s28 as a fourth gap, no longer true).
Not a product gap — a documentation-accuracy correction this pack itself makes; no issue needed.

---

## 8. Cross-surface consumer map — every route here is currently unconsumed, and that is the expected pre-Design state

**Confirmed against every real caller in `artifacts/portal`** (the live app; `artifacts/msp-portal`
was retired for `artifacts/portal` in `f40438cdc`, #1921) — not assumed:

| Endpoint | Real consumer today |
|---|---|
| `GET /remediation-tracker` | `useRemediationTracker.ts:199` — a real hook, genuinely calls this route |
| `PUT .../steps/:stepId` | `useRemediationTracker.ts:261` — same hook, genuinely calls this route |
| `POST .../steps/:stepId/verify` | none |
| `GET .../steps/:stepId/verification-guide` | none |
| `POST .../steps/:stepId/decline-to-risk` | none |
| `GET .../pillar-scores` | none |
| `GET .../export.csv`, `.../export.pdf`, `.../evidence-pack.pdf` | none |
| `GET /remediation/checklist`, `PUT .../checklist/:checkKey`, `POST .../checklist/:checkKey/raise-change` | none |
| `GET /remediation/fix-routes` | none |
| `POST /remediation/fix-routes/:checkKey/reveal` | none |
| `GET /remediation/bypass-resolutions` | none |

**`useRemediationTracker.ts` is real and wired** (genuinely calls `GET`/`PUT` through
`fetchWithAuth`, `:199`, `:261`) **but has zero page/component consumer of its own** — confirmed
by grep across `artifacts/portal/src` for any import of the hook outside its own file and its
sibling `previewRemediationGuide.ts`/`remediationLiveGuide.ts`/`remediationLive.ts`, all of which
are themselves guide/catalogue data modules, not page components that call the hook. This matches
the standing convention (#1485's 2026-08-29 comment: file an orphaned-endpoint sub-issue at pack
time) **except that it is the expected pre-Design state, not a gap**: no `Design/portal/` export
exists yet for Remediation Tracking (`ls Design/portal/ | grep -i remediat` — zero hits, checked
today), so no page can consume any of these 15 routes yet, by the module sequence
(architect → build the endpoints → contract pack → Design → wire) this pack is itself step 3 of.
**No orphaned-endpoint sub-issue filed** — same posture #2586's MSP-console pack established for
its own 14-of-14-unconsumed routes.

---

## 9. Open questions carried forward (unchanged by this pack — Product decisions, not extraction gaps)

- **Whether "informed" CRs need a fourth `changeClass` value** — not this module's question
  (owned by #1534, Microsoft Changes), but §1b's `raise-change` path hits the same
  `msp_change_requests` enum (§3) it already resolves against (`Normal`/`Standard` by severity,
  `remediation-raise-change.ts:26-28`).
- **Project vs Remediation content overlap** — genuinely unresolved which module "wins" when a
  remediation engagement's finding set is large enough to look like a Project; #1570 leaves this
  open for whichever builds second. Unchanged from the prior pack.
- **#1518 — whether C (Consulted) carries the acceptance gate** — referenced by #1544's original
  dependency list, now built; owned by Ownership/RACI's own pack (#1491), not re-litigated here.

---

## 10. Provenance

Written 2026-09-04 against `main` (branch `agent/1719-q1596`), for #1719, replacing the pack
written 2026-08-29 against `07f169258`. Read in full, not sampled: all 7 route files (1,806
lines total, `wc -l`: `portal-remediation-tracker.ts` 628, `-checklist.ts` 241, `-fix-routes.ts`
161, `-reveal.ts` 133, `-bypass-resolutions.ts` 54, `-tracker-scores.ts` 178, `-tracker-export.ts`
411), plus `remediation-checklist.ts`, `remediation-fix-route.ts`,
`remediation-reveal-gate.ts`, `remediation-bypass-resolutions.ts`, `remediation-tracker-risk-
decline.ts`, `remediation-raise-change.ts`, `remediation-tracker-catalogue.ts`,
`remediation-tracker-verification.ts`, `retainer-work-logger.ts`, `portal-customer-scope.ts`,
`portal-change-control-raise.ts`, and the relevant `lib/db/src/schema/msp.ts` sections (both
enum-carrying tables, `msp_change_requests`, `msp_risk_decisions`, `msp_alert_rules`/`_events`,
`drift_events`). Cross-referenced throughout against `docs/remediation-tracking-msp-console-
contract-pack.md` (#2586, one day old, documenting the identical business logic on the MSP-side
mirror) rather than re-deriving shared logic from zero. Verified live against local
PostgreSQL: `remediation_knowledge_base` (153 rows, all published), `config_pack_templates`
(28 execution-ready active packs), `remediation_tracker_steps` (4 real rows in the local
testbed, 0 `accepted_risk`). Confirmed no `Design/portal/` export exists yet for this module and
`useRemediationTracker.ts` has zero page consumer — the expected pre-Design state, not a gap.
One live gap re-confirmed, already filed as #2827 (not re-filed, §7.1). No product code, schema,
or UI was changed by this pass.
