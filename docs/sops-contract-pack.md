# SOPs / Runbooks — contract extraction pack for Claude Design

**#1493** (Portal New Design: SOPs), following the method fixed by **#1577** (contract extraction
pack, run per module as step 3 of **#1578**), under **#1485** (EPIC: Portal New Design).
Sub-issues **#1556–#1560, all DONE since the prior pack.**

**Architected jointly with #1488 (Runbooks).** Both modules are covered in this one pack — see
§0 for why they are two objects, not one. Read-only. Every field below is extracted verbatim from
the two routes' own `Wire*` interfaces and the Drizzle schema — cited to file:line. **Nothing here
is authored or invented.**

**The prior pack's "known-wrong / known-thin" table is now mostly resolved. Restated, updated:**

| Contract | Prior pack | Now |
|---|---|---|
| `msp_sops` / `portal_runbooks` as two tables | Flagged as possibly the wrong boundary | **Settled, unchanged as two objects** (§0) — the #1556 unification gave each side its own correct shape rather than merging them |
| `portal_runbook_steps.checked` per-runbook, not per-run | Known-wrong | **FIXED (#1557)** — see the Runbooks pack §1.1/§1.2 |
| No route writes `msp_sop_runs` | Known-wrong — 13 GET / 1 POST, execution hook never connected | **FIXED (#1559)** — `POST /api/msp/sops/:sopId/run`, real, CR-gated, Workflow-Engine-executed (§2) |
| `SOP_KINDS` seed content — only 3 kinds | Known-thin | **Widened (#1560)**, but narrower than named — 4 lifecycle SOPs added to `msp_sops` (IAM-04–07); the *runbook*-side `SOP_KINDS`/`RUNBOOK_CATALOGUE` catalogue is untouched and still exactly 3 Oversharing-specific kinds (see the Runbooks pack §7) |

Backend routes: `artifacts/api-server/src/routes/portal-sops.ts` (SOPs library + runs, customer-
scoped), `artifacts/api-server/src/routes/portal-runbooks.ts` (Active Runbooks + hold windows,
customer-scoped)
MSP-side writer (context only, not a portal surface): `artifacts/api-server/src/routes/msp-sops.ts`
— **now includes the real execution hook**, `POST /msp/sops/:sopId/run` (§2)
Pure derivations: `artifacts/api-server/src/lib/portal-sops.ts`, `.../lib/portal-hold-windows.ts`,
`.../lib/portal-runbook-cycles.ts` (new, cycle math — see the Runbooks pack)
Execution machinery (MSP-side, context only): `artifacts/api-server/src/lib/sop-execution.ts` (new)
**Portal wire/model/live files — CORRECTION vs. the prior pack:** the prior pack cited
`artifacts/msp-portal/src/components/portal-v2/{sopHubData.ts,sopHubModel.ts,useSops.ts,sopCreate.ts}`.
**None of these files exist any more.** `artifacts/msp-portal` was retired for `artifacts/portal`
in `f40438cdc` (#1921), and **not one of the four SOPs-side wire/hook files was carried over.**
Confirmed by direct search: `find artifacts/portal/src -iname '*sop*'` returns nothing. There is
currently **no SOPs consumer anywhere in the live portal codebase** — see §0.1.
Schema: `lib/db/src/schema/msp.ts:5395-5588` (`mspSopsTable`, `mspSopRunsTable`,
`portalSopCustomStepsTable` — new), `:6858-7102` (`portalRunbooksTable`, `portalRunbookRunsTable`
— new, `portalRunbookStepsTable`, `portalHoldWindowsTable`, `portalHoldWindowEventsTable`)

**Real DB state at pack time** (local `DATABASE_URL`, `psql`): `msp_sops` — **15 rows** for the one
real testbed MSP (`msp_id = 1`): 3 original Oversharing-independent seeds (IR-01, IR-02, GOV-01,
DATA-01, IAM-01, IAM-02, IAM-03 — the pre-#1560 catalogue), 4 new lifecycle seeds from #1560
(IAM-04 Mover, IAM-05 Promote, IAM-06 Demote, IAM-07 De-VIP propagation), 1 admin-authored test row
(`SOP-CUSTOM-592`), 3 customer-authored rows via `POST /portal/sops` (`SOP-CUST-*`). `msp_sop_runs`
— **0 rows** (the execution hook is real and built, but nothing has fired a run against this
environment yet). `portal_sop_custom_steps` — **0 rows**.

---

## 0. Two modules, one pack — why, and exactly where the line falls

Unchanged from the prior pack; restated for completeness because the unification it describes is
now built, not merely settled:

**`msp_sops` + `msp_sop_runs` — a procedure DEFINITION plus an EXECUTION against a target.**
MSP-scoped (`msp_id`), versioned (`version`, `version_status`), authored (`last_updated_by`). The
"correct shape" the prior pack called for.

**`portal_runbooks` + `portal_runbook_runs` + `portal_runbook_steps` — a SCHEDULE that spawns
RUNS.** Customer-scoped (`customer_id`). Not a procedure, a recurrence — see the Runbooks pack §1.4
for the full #1557 cycle model.

**The unification (#1556, DONE):** `msp_sop_runs.origin` (`policy | lifecycle | remediation |
manual`) is now a real column (`msp.ts:5440-5441, 5458`), making every procedure invocation —
policy-enacted (#1548), lifecycle (#1552), remediation (#1539), or hand-started — the same run
object distinguished by provenance, not a different table. The two tables (`msp_sops`/
`msp_sop_runs` vs. `portal_runbooks`/`portal_runbook_runs`) were **not merged into one** — the
settled architecture kept them as two objects (definition+execution vs. schedule+cycle) and gave
each its own missing piece (`origin` for the execution side, run history for the schedule side).

**Two complications, both resolved and BUILT (were "resolved with precedent" in the prior pack;
now real tables):**

- **Customer-authored steps as a per-tenant overlay (#1558, DONE):** `portal_sop_custom_steps`
  (`msp.ts:5557-5588`) — never writes `msp_sops.steps`, landing instead in its own table that the
  read layer appends after the base definition's own steps. `basedOnVersion` freezes which version
  of the base definition the overlay was added against.
- **Hold windows survive unchanged as a gate on a run**, and gained cycle affinity of their own
  (#1940) — see the Runbooks pack §1.3. Not folded into the unification, as the prior pack said.

---

## 0.1 The endpoints and their real consumers — a corrected picture

**The prior pack's endpoint table assumed `useSops`/`sopCreate.ts` in `artifacts/msp-portal` were
live consumers.** That package is retired. Re-verified against the actual current tree:

| Endpoint | Method | Route file:line | Consumed by (verified) | Orphaned? |
|---|---|---|---|---|
| `/api/portal/sops` | GET | `portal-sops.ts:342-496` | **Nothing in `artifacts/portal/src`** | **Yes** |
| `/api/portal/sop-runs` | GET | `portal-sops.ts:510-663` | **Nothing in `artifacts/portal/src`** | **Yes** |
| `/api/portal/sops` | POST | `portal-sops.ts:687-761` | **Nothing in `artifacts/portal/src`** | **Yes** |
| `/api/portal/sops/:sopId/custom-steps` | POST | `portal-sops.ts:780-865` | **Nothing in `artifacts/portal/src`** — new endpoint (#1558), never had a consumer to lose | **Yes** |

**Every route in this file is orphaned from a page's perspective.** This is a wider finding than
the prior pack's single-orphaned-endpoint framing (which was itself scoped to the Runbooks side,
`#1619`/`#1620`). Root cause is the same one already tracked project-wide: `Design/portal/` has
produced no export for this module (confirmed empty at pack time — `find Design -iname '*.dc.html'`
returns nothing for the whole epic, not just this module), and the #1485 standing convention is
explicit that no export means no page gets built yet. **Not filed as a new sub-issue** — it is the
expected, correct state for a module ahead of its own Design step, not a bug; the existing #1619
(Runbooks) / #1620 (SOPs) sub-issues already recorded the identical root cause for one endpoint,
and this pack extends that same finding to the rest rather than re-filing four more near-duplicates.
A future build wires these four routes into whatever page Design produces, same as planned for the
Runbooks side.

**MSP-side, for context (not a customer-portal surface, not scored above):**
`POST /api/msp/sops/:sopId/run` (`msp-sops.ts:219-277`) — the real, built, CR-gated execution hook
(#1559). Consumed by whatever MSP-console UI calls it (out of scope for this pack, which covers the
customer portal's own `/api/portal/*` surface only, matching the prior pack's own scoping).

---

## 1. Wire contract — SOPs (`portal-sops.ts`)

`CURRENT` = the field serves real data from this table today.
`DECIDED` = architecture is settled but not built; the issue number is given.
`DONE` = was DECIDED-not-built in the prior pack; now built and CURRENT.

### 1.1 Library — `GET /api/portal/sops`

Returns `WireSopsPayload` (`portal-sops.ts:190-196`), built per-row at `:377-458`. Reads
`mspSopsTable` scoped by `mspId` only, `mspSopRunsTable` scoped by `(mspId, tenantId)`, and — new
since the prior pack — `portalSopCustomStepsTable` scoped by `customerId` directly (`:360-366`).

```ts
// portal-sops.ts:121-196 — verbatim, current shape (origin/sopVersion/steps[].isCustom are new)
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
  readonly origin: MspSopRunOrigin;      // NEW — #1556
  readonly sopVersion: string;           // NEW — #1558
}
interface WireSopStep {
  readonly text: string;
  readonly isCustom: boolean;            // NEW — #1558
}
interface WireSopLibraryItem {
  readonly id: string;
  readonly title: string;
  readonly source: WireSopSource;
  readonly category: string;
  readonly purpose: string;
  readonly forWho: string;
  readonly updated: string;
  readonly author: string;
  readonly reviewCadence: string;
  readonly runnable: boolean;
  readonly finding: string | null;
  readonly steps: readonly WireSopStep[];    // CHANGED — was readonly string[]
  readonly runs: readonly WireSopRunSummary[];
  readonly owner: WireOwner;
}
interface WireSopMeta { /* unchanged from the prior pack */ }
interface WireSopStats { /* unchanged from the prior pack */ }
interface WireSopsPayload {
  readonly library: readonly WireSopLibraryItem[];
  readonly meta: Readonly<Record<string, WireSopMeta>>;
  readonly catOptions: readonly string[];
  readonly tagOptions: readonly string[];
  readonly stats: WireSopStats;
}
```

| Wire field | Source column / derivation | Status |
|---|---|---|
| `library[].steps` | **CHANGED SHAPE**: the base definition's own steps (`isCustom: false`) followed by this tenant's overlay from `portal_sop_custom_steps` (`isCustom: true`) — one ordered list (`:411-417`) | **DONE (#1558)** — was `readonly string[]`; now `readonly WireSopStep[]` carrying `isCustom` |
| `library[].runs[].origin` | `origin` (`msp.ts:5458`), raw enum value, page owns any label | **DONE (#1556)** |
| `library[].runs[].sopVersion` | `sop_version` (`msp.ts:5478`), captured at run-start time, `""` if not recorded | **DONE (#1558)** |
| `library[].runnable` / `meta[id].auto` | `sopRunnable(steps)` / per-step `graphEndpoint` — **computed from the BASE `steps` only**, deliberately excluding the custom overlay (`:408-410` comment) | CURRENT — a customer's own note can never make a procedure executable, matching how `POST /portal/sops` forces non-runnable by construction (§1.3) |
| every other field (`id`, `title`, `source`, `category`, `purpose`, `forWho`, `updated`, `author`, `reviewCadence`, `finding`, `owner`; `meta[id].{code,level,tags,avg,execs}`; every `stats.*`; `catOptions`/`tagOptions`) | unchanged derivations from the prior pack — see that pack's §1.1 table for the full column-by-column mapping, still accurate | CURRENT, unchanged |

`library[].reviewCadence` and `.finding` remain permanently `"Not recorded"` / `null` — no column
stores either, unchanged from the prior pack (§7.3 there, restated in §7 below).

### 1.2 Runs — `GET /api/portal/sop-runs`

Returns `WireSopRunsPayload` (`portal-sops.ts:233-236`), built at `:537-657`.

```ts
// portal-sops.ts:198-236 — verbatim (origin/sopVersion on WireSopQueueItem are new)
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
  readonly origin: MspSopRunOrigin;      // NEW — #1556
  readonly sopVersion: string;           // NEW — #1558
  readonly steps: readonly WireQueueStep[];
}
interface WireSopAuditItem { /* unchanged from the prior pack */ }
interface WireSopRunsPayload {
  readonly queue: readonly WireSopQueueItem[];
  readonly audit: readonly WireSopAuditItem[];
}
```

| Wire field | Source column / derivation | Status |
|---|---|---|
| `queue[].origin` | `origin` (`msp.ts:5458`), raw enum value (`:569`) | **DONE (#1556)** |
| `queue[].sopVersion` | `sop_version` (`msp.ts:5478`) (`:570`) | **DONE (#1558)** |
| every other `queue[]`/`audit[]` field | unchanged derivations from the prior pack (`queueStateFor`, `runModeLabel`, `progressPct`, `relativeSince`, `personLabel`, `stepStates`, `auditResult`, `evidenceHash` — none of these functions changed) | CURRENT, unchanged |

### 1.3 Author a SOP — `POST /api/portal/sops`

Unchanged from the prior pack. Request body (`authorSopSchema`, `portal-sops.ts:679-685`): `title`,
`description`, `category`, `estimatedMinutes?`, `steps` (1-60 entries). Server-forced: `sopId`
(`SOP-CUST-<uuid>`), `code` (`CUST-<uuid4>`), `version: "v1.0"`, `automationType: "manual"`, every
step `type: "manual"` with no `graphEndpoint` — `sopRunnable()` stays `false` by construction.
Success `201`: `{ id, sopId, code }` (`:755`).

### 1.4 Add a custom step to an EXISTING SOP — `POST /api/portal/sops/:sopId/custom-steps`

**New endpoint since the prior pack (#1558).** Request body (`addCustomStepSchema`,
`portal-sops.ts:775-778`): `title` (1-200 chars), `description?` (≤2000 chars). The base SOP must
exist for the caller's own MSP (`:814-822`) — 404 reads as "not in your library", not a hint about
other tenants' data. Guarded at `MAX_CUSTOM_STEPS_PER_SOP = 60` (`:773`), `409` once reached.
Position is `max(existing position for this customer+sopId) + 1` (`:824-842`). `basedOnVersion` is
the base SOP's `version` **at the moment of insert** (`:851`), never updated afterward — this
overlay row's own record of which definition version it was layered onto. Success `201`:
`{ position, title, basedOnVersion }` (`:859`).

**Never touches `msp_sops.steps`.** Direct precedent: `POST /portal/runbooks/:runbookId/steps`
(Runbooks pack §1.6) does the identical thing for a runbook's own checklist; this is that pattern
applied to the versioned SOP library, landing in a separate table (`portal_sop_custom_steps`) so a
base-definition version bump can never silently discard a tenant's overlay (schema comment,
`msp.ts:5540-5543`).

---

## 2. The execution hook — `POST /api/msp/sops/:sopId/run` (#1559, DONE)

**Context only — this is an MSP-console route (`requireRole("MSPOperator")`), not a customer-portal
surface, and out of this pack's own `/api/portal/*` scope per the prior pack's own stated
boundary.** Recorded here because the prior pack's known-wrong-contract table flagged this as
entirely unbuilt, and it now genuinely exists.

`artifacts/api-server/src/lib/sop-execution.ts` (549 lines, new) is the IO half of
`sop-workflow-graph.ts`'s pure materialization — loads the SOP + customer, enforces the #1497
Change Control authorization gate, fires the automated step prefix through the Workflow Engine, and
writes the `msp_sop_runs` row. Deliberately mirrors `config-pack-orchestrator.ts`'s
`runConfigPackForCustomer` — same authorization posture, same reused gate functions — "because
#1559 is explicit that this must never become a second execution path" (file header).

**What it does NOT do:** a hybrid SOP's manual steps still close out through the pre-existing
`PATCH /api/msp/sop-runs/:runId`, unchanged. A run whose automated steps all complete but which
still has open manual steps settles to `Blocked`, not `Completed` — matching what that status
already means on the portal's own read side (`queueStateFor`/`runStateLabel`, §1.2).

**Policy enactment (#1548) and the CR-flood resolution (#1550), both real:** a caller may pass
`standingPolicyId`; the function verifies the policy belongs to this MSP, is active, and names
exactly this `sopId`, then forces `origin: "policy"`. A policy-enacted run with no explicit CR
auto-raises its own `changeClass: "standard"` CR from the policy's bound, currently-approved
`change_catalog_items` row rather than flooding the approval queue with one CR per enactment —
"approve once, execute many," live-checked at every call, never cached.

**Reconciliation, not a live callback:** `settleSopRuns` (wired in `index.ts`) is a periodic sweep
reading real `wf_runs`/`wf_run_node_outputs` rows for every still-`In Progress` run, reading the
run's own frozen `automated_step_map` snapshot rather than the SOP's live (possibly since-edited)
`steps`.

**Two related, already-closed hardening issues, both real and both cited because they touch the
same execution surface:**

- **#1938** — `POST /api/msp/sop-runs` (the older, hand-entry insert path predating #1559) now
  forces `origin: "manual"` unconditionally, and does not accept `standingPolicyId`, so it can never
  fabricate a `"policy"`-origin row the portal's audit view would render identically to a real,
  CR-authorized enactment.
- **#1773** — the #1497 CR-authorization gate now verifies the claimed CR authorizes the *specific*
  pack/SOP being executed, closing a gap where any approved CR could authorize any execution.

---

## 3. Real enum unions (and where each is actually enforced)

Unchanged from the prior pack for every vocabulary except `origin`, which is new:

| Vocabulary | Values | Where fixed | Status |
|---|---|---|---|
| SOP run `origin` (`msp_sop_runs.origin`) | `policy`, `lifecycle`, `remediation`, `manual` | `msp.ts:5440-5441` — real `text({ enum })` column, default `"manual"` | **NEW (#1556)**. `POST /api/msp/sops/:sopId/run` sets it from the caller's `origin`/`standingPolicyId` (§2); `POST /api/msp/sop-runs` (the older hand-entry path) forces it to `"manual"` unconditionally (#1938) |
| SOP `automation_type` | `automated`, `hybrid`, `manual` | `msp-sops.ts:36` (`z.enum`, MSP-side writer) | CURRENT, unchanged |
| SOP step `type` | `manual`, `automated` | `msp-sops.ts:20` | CURRENT, unchanged |
| SOP step `status` | `pending`, `running`, `success`, `failed` | `msp-sops.ts:24` | CURRENT, unchanged — still not read on the portal wire |
| SOP run `status` (`msp_sop_runs.status`) | `In Progress`, `Completed`, `Blocked`, `Failed` | `msp-sops.ts:97` (`z.enum`, patch schema) | CURRENT, unchanged mapping (`queueStateFor`/`runStateLabel`/`auditResult`) |
| SOP `source` (derived, not stored) | `baseline`, `ours` | `portal-sops.ts:34` | CURRENT, unchanged |
| Portal runbook `status` | see the Runbooks pack §3 | — | see the Runbooks pack — schedule-level vs. cycle-level distinction is new |
| Hold `state` / `scan_verdict` / event `kind` / decision / primary-action / notification kind | see the Runbooks pack §3 | — | unchanged from that pack except `runId` (#1940) |

---

## 4. Cross-surface edges

| Edge | Column | Points at | Served today? | Notes |
|---|---|---|---|---|
| Hold decision → Change Request | `portal_hold_window_events.change_request_id` | `msp_change_requests.id` | Yes | Unchanged — see the Runbooks pack §4; that CR-creation path now also materializes approvals (#1775) |
| SOP → Run | `msp_sop_runs.sop_id` | `msp_sops.sop_id` (no FK) | Yes | Unchanged — a run whose definition was since deleted still renders |
| SOP → Custom step overlay | `portal_sop_custom_steps.sop_id` | `msp_sops.sop_id` (no FK) | Yes | **NEW (#1558)** |
| Run → standing policy | `msp_sop_runs.standing_policy_id` (`msp.ts:5467`) | `standing_policies.id`, real FK, `SET NULL` on delete | Yes, MSP-side only (§2) | **NEW (#1556/#1548)** — not on the customer-portal wire |
| Run → Workflow Engine run | `msp_sop_runs.wf_run_id` (`msp.ts:5494`) | `wf_runs.id`, no FK (matches `msp_change_requests.executor_run_id`'s convention) | Yes, MSP-side only (§2) | **NEW (#1559)** — not on the customer-portal wire |
| Oversharing catalogue → Runbook | `portal_runbooks.runbook_key` | `RUNBOOK_CATALOGUE[sopKind].runbookKey` | Yes | See the Runbooks pack §0/§4 |
| SOP author identity | `msp_sops.last_updated_by` | `users.email` within the caller's tenant | Yes | Unchanged |
| Runnability gate | `steps[].graphEndpoint` (jsonb, no column) | — | Yes | Unchanged — customer-authored SOPs can never satisfy it |

---

## 5. What was "settled architecture, not yet built" in the prior pack — now built

The prior pack's §5 table is superseded wholesale. Every row in it now has a real, cited
implementation:

| Decision | Prior status | Now |
|---|---|---|
| Unify: one definition, one run record, across both table pairs | DECIDED | **DONE — #1556** |
| Recurrence as a schedule that spawns runs | DECIDED | **DONE — #1557** (Runbooks pack §1.4) |
| Per-tenant custom-step overlay | DECIDED | **DONE — #1558** (§1.1, §1.4) |
| Execution hook, CR-gated | DECIDED | **DONE — #1559** (§2) |
| Seed the lifecycle procedure set | DECIDED | **DONE, narrower than named — #1560** (header table; IAM-04–07 on `msp_sops` only, not on the runbook catalogue — Runbooks pack §7) |
| Policy-invoked run, same object distinguished by `origin` | DECIDED | **DONE — #1548** (§2's policy-enactment paragraph) |
| Standard runbooks: permanent approval, auto-approved CR per execution, revocation as the only control | DECIDED | **DONE, the "CR-flood resolution" — #1550** (§2) |
| Lifecycle runbooks as the deliberate-change mechanism | DECIDED | **Partially done** — IAM-04–07 exist as `msp_sops` rows (#1560); the invocation wiring from a "told" event (e.g. a de-VIP decision) to auto-firing the matching lifecycle SOP is **still #1548's territory and not yet built** per #1560's own bookend — this remains a real, open piece, not fully closed by #1560 |
| Tenant with denied write consent renders step-by-step instructions with a pointed check as proof | DECIDED | **Not verified built in this pass** — no route/UI change found implementing this specific behaviour; flag as still open, do not assume it exists |
| A runbook is wholly standard or wholly non-standard, never mixed | recorded, no sub-issue | **Still unresolved — see §7** |

---

## 6. Open gaps — NOT decided (do not resolve; flag)

Carried forward from the prior pack, re-verified still true:

1. **Hold-window notification transport still does not exist.** `dueHoldNotifications()` correctly
   computes what is owed; nothing calls it and nothing sends anything. Re-checked at pack time: no
   caller of `dueHoldNotifications` exists outside `portal-hold-windows.ts` itself and its own test
   file. Genuinely still open.
2. **The "wholly standard or wholly non-standard" runbook-classification rule still has no
   sub-issue.** Unchanged.
3. **Only three seeded runbook *kinds* exist on the runbook side** (`RUNBOOK_CATALOGUE`,
   Oversharing Sites' own producer) — unchanged; the lifecycle widening (#1560) landed on the SOP
   library side only. See the Runbooks pack §7 for the full restatement.
4. **`portal_runbooks.status` (schedule-level) is stored but never read on that wire.** Unchanged;
   see the Runbooks pack §7 for the new schedule-vs-cycle nuance since #1557.
5. **New since the prior pack: the #1548 invocation wiring from a "told" lifecycle event to
   auto-firing the matching SOP is still not built**, per #1560's own bookend (§5 above). Flag for
   Design: do not assume IAM-04–07 fire themselves from anything yet — they are library rows,
   reachable today only via the MSP-side `POST /msp/sops/:sopId/run` hand-invocation.
6. **New since the prior pack: the "denied write consent → step-by-step instructions with a pointed
   check" behaviour (#1539) was not found built** in this pass. Not verified either way with
   certainty by a read-only pack (a targeted route/UI search found nothing implementing it) — flag
   as open rather than asserting it doesn't exist at all.

---

## 7. Honest-empty contract & the tri-state

| State | Wire behaviour | Hook signal |
|---|---|---|
| Loading / Live-empty / Read-failed | Unchanged shape from the prior pack — `200` with empty arrays for a genuinely empty tenant, non-2xx surfaced as a fixed sentence | **No live hook to check** — see §0.1; the consumer hooks that would set these signals do not currently exist in `artifacts/portal/src` |

**Confirmed live-empty at pack time for the run-history side:** `msp_sop_runs` — 0 rows;
`portal_sop_custom_steps` — 0 rows (header). `msp_sops` itself is **not** empty — 15 real rows for
the one testbed MSP (header) — so `GET /api/portal/sops`'s `library` array would return real content
today if a page called it; `GET /api/portal/sop-runs`'s `queue`/`audit` would both return empty
arrays for the run-execution side (no runs exist yet) but the `audit` array would still show
"Version published" entries for all 15 SOPs (`portal-sops.ts:635-647` — a real, dated, attributable
event independent of execution history).

**Unchanged nuances from the prior pack, still true:**

1. `library[].reviewCadence` / `.finding` are permanently `"Not recorded"` / `null` — no column
   stores either.
2. `msp_sop_runs.psa_ticket_id` is shown as the raw stored string, not a guaranteed CR — the
   client's own `/^CR-/` test decides link rendering.

---

## 8. The forbidden list — declared, not merely absent

Unchanged from the prior pack, all still true and re-verified:

1. **No customer-facing route executes anything.** Still zero write paths in `portal-sops.ts` that
   touch `msp_sop_runs` — the real execution hook (§2) lives exclusively on the MSP-console side,
   `requireRole("MSPOperator")`, never reachable from a customer JWT.
2. **A customer-authored SOP can never become runnable.** Unchanged, re-verified (`:719-724`).
3. **Releasing a gated step does not execute it.** Unchanged — Runbooks pack §1.8.
4. **`waitDays` is never rewritten by an extension.** Unchanged.
5. **An id in a URL path is never trusted as a permission.** Unchanged.
6. **Close-early is re-guarded server-side.** Unchanged.
7. **No fabricated review cadence or finding text.** Unchanged.
8. **Insider-risk detection/enforcement stays an epic-level non-goal.** Unchanged.
9. **New: no second execution path, now actively enforced, not just stated.** #1938 forces
   `origin: "manual"` on the one route (`POST /api/msp/sop-runs`) that could otherwise fabricate a
   policy-authorized-looking row; #1773 verifies a claimed CR actually authorizes the specific
   SOP/pack being executed, not merely that some approved CR exists.

---

## 9. Provenance

Extracted 2026-09-03 against branch `agent/1728-q1347`, regenerating the prior pack (`3b6b14b7f`,
2026-08-29). Real drift verified via: git log against `portal-sops.ts`, `msp-sops.ts`,
`portal-runbooks.ts`, `lib/portal-sops.ts`, `lib/portal-hold-windows.ts`, `lib/db/src/schema/msp.ts`,
and a direct `find`/`grep` sweep of `artifacts/portal/src` confirming the prior pack's cited
`artifacts/msp-portal` consumer files no longer exist anywhere. New source read in full:
`artifacts/api-server/src/lib/sop-execution.ts` (549 lines). Live DB state confirmed via direct
`psql` against local `DATABASE_URL` (header) — 15 `msp_sops` rows, 0 `msp_sop_runs`, 0
`portal_sop_custom_steps`. Architecture deltas cited to GitHub issues #1493, #1488, #1556–#1560 (all
DONE), #1548, #1550, #1539, #1552, #1554, #1555, #1938, #1773, #1775, #1940, under epic #1485 and
method issues #1577/#1578. No new sub-issue filed — the widened orphaned-endpoint finding (§0.1) and
every open gap (§6) share root causes already tracked on #1619/#1620/#1560's own bookend, not new
findings. Read-only pass: no product code, schema, or UI was changed.
