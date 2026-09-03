# SOPs (MSP Console) — contract extraction pack for Claude Design

**#2595**, step 3 of **#1687** (Feature: SOPs, MSP Console — the operator half of #1493),
under **#1571** (EPIC: Portal Admin). Follows the **#1642 pattern**: per-surface wire
contracts extracted verbatim and cited to file:line, CURRENT vs DECIDED marked on every
field, real enum unions only, cross-surface edges, honest tri-state, forbidden list,
orphaned endpoints listed explicitly. Read-only — no product code, schema, or UI changed.

**This is a different surface from `docs/sops-contract-pack.md`, not a re-run of it.**
That pack (regenerated today under #1728, `59f07eda5`) is scoped explicitly to
`artifacts/portal`'s customer-facing `/api/portal/*` routes — `portal-sops.ts` +
`portal-runbooks.ts` — and treats `msp-sops.ts` as "context only, not a portal surface."
#1687 is the other half: the MSP-console **operator** surface that authors and runs SOPs.
This pack is that surface's own #1642-pattern extraction, all six of its real routes, not
a footnote.

Backend route file: `artifacts/api-server/src/routes/msp-sops.ts` (438 lines, all six
routes real).
Execution machinery: `artifacts/api-server/src/lib/sop-execution.ts` (549 lines, the
`runSopForCustomer` write path + `settleSopRuns` reconciliation sweep — #1559),
`artifacts/api-server/src/lib/sop-workflow-graph.ts` (pure `graphEndpoint` →
`WfGraph` materializer, no DB, no executor imports).
Shared pure derivations (read-side sentence-building, borrowed by the portal pack too):
`artifacts/api-server/src/lib/portal-sops.ts`.
Schema: `lib/db/src/schema/msp.ts:5657-5796` (`mspSopsTable`, `mspSopRunsTable`,
`MSP_SOP_RUN_ORIGIN`), `:5140-` (`standingPoliciesTable`, cross-surface only).

**Real DB state at pack time** (local `DATABASE_URL`, `psql`, 2026-09-03): `msp_sops` —
**15 rows** for the one real testbed MSP (`msp_id = 1`): `SOP-CUSTOM-592` (an admin test
row, `hybrid`), 11 seeded procedures (`IR-01`, `IR-02`, `GOV-01`, `DATA-01`, `IAM-01`
through `IAM-07`), 3 customer-authored rows (`SOP-CUST-*`, all `manual`, created via the
**customer-portal's** `POST /portal/sops` — see below). `msp_sop_runs` — **0 rows**. The
execution hook (`POST /msp/sops/:sopId/run`) is real, built, and CR-gated, but nothing has
fired a run against this environment yet, so `origin` has no live distribution to report.

---

## 0. What this surface is, and what it is not

**`msp_sops` + `msp_sop_runs` are one procedure-definition-plus-execution object,
MSP-scoped.** Unchanged from the portal pack's own §0 — restated here because this pack's
routes are the writer for the same two tables that pack's routes only read:

- `msp_sops`: a versioned, authored procedure definition (`mspId`, `sopId`, `version`,
  `versionStatus`, `lastUpdatedBy`).
- `msp_sop_runs`: one execution against a customer's tenant, distinguished from every
  other invocation only by `origin` (`policy | lifecycle | remediation | manual`,
  `MSP_SOP_RUN_ORIGIN`, `msp.ts:5702-5703`) — the #1556 unification. A policy enactment
  (#1548), a lifecycle operation (#1552), a remediation fix (#1539), and a hand-started
  run are the same row shape, provenance-tagged, not four different tables.

**Not the customer portal.** Every route in `msp-sops.ts` is `requireRole("MSPOperator")`
and scoped by `resolveMspIdStrict(req)` (the caller's own MSP), never a customer JWT's
`customerId`. `portal-sops.ts`'s customer-facing routes (`GET /portal/sops`,
`GET /portal/sop-runs`, `POST /portal/sops`, `POST /portal/sops/:sopId/custom-steps`) read
the SAME two tables from the opposite side — a customer reads/authors non-runnable notes;
the operator here authors runnable procedures and fires them. `portal_sop_custom_steps`
(the customer-authored-step overlay, #1558) is **never written by this surface** — it is
customer-side only, out of scope here.

**Not built yet, on the frontend.** `artifacts/msp-console` — the app these routes are
meant to serve — does not exist (blocked on the scaffolding issue, #1680, confirmed via
direct `ls artifacts/`: `admin-panel`, `api-server`, `mcp-server`, `msp-website`, `portal`,
`shane-mccaw-consulting` — no `msp-console`). §0.1 below is the honest orphaned-consumer
picture for that reason.

---

## 0.1 The endpoints and their real consumers

| Endpoint | Method | Route file:line | Consumed by (verified) | Orphaned? |
|---|---|---|---|---|
| `/api/msp/sops` | GET | `msp-sops.ts:106-131` | `get_running_sops` (mcp-server tool, `artifacts/mcp-server/src/tools/get-running-sops.ts`) | No — real consumer, but not a UI page |
| `/api/msp/sops` | POST | `msp-sops.ts:135-188` | **Nothing found** — no route/test/tool calls it | **Yes** |
| `/api/msp/sops/:sopId/run` | POST | `msp-sops.ts:219-277` | `runSopForCustomer` is the real execution path; the HTTP route itself has **no verified UI/tool caller** today | **Yes**, as an HTTP surface — the underlying function is real and exercised via direct call sites elsewhere in the codebase (e.g. any future policy/lifecycle trigger), but nothing currently POSTs to this route |
| `/api/msp/sop-runs` | GET | `msp-sops.ts:281-306` | `get_running_sops` (mcp-server tool) | No |
| `/api/msp/sop-runs` | POST | `msp-sops.ts:310-377` | **Nothing found** — the hand-entry insert path (#1938 hardened it, but no caller located) | **Yes** |
| `/api/msp/sop-runs/:runId` | PATCH | `msp-sops.ts:381-435` | **Nothing found** | **Yes** |

**Root cause, same one already tracked project-wide:** `Design/msp-console/` has no export
yet (this pack's own sibling sub-issue, #2596, is exactly that step, still pending), and
`artifacts/msp-console` itself has no scaffolding (#1680). This is the expected state
ahead of #1687's own architecture/design/wire sequence, not a bug — **not filed as a new
finding**, it restates the same root cause #1687's own body already names ("Blocked on
the `artifacts/msp-console` scaffolding (#1680)"). The one genuinely new fact this pack
adds is that `get_running_sops` is a REAL, already-wired consumer of two of the six routes
— the surface is not 100% orphaned, it has a machine consumer today and zero UI consumers.

---

## 1. Wire contract — the six routes, verbatim

`CURRENT` = the field serves real data from this table today. No `Wire*` interface exists
anywhere in `msp-sops.ts` — every GET returns Drizzle's raw `$inferSelect` row shape
directly (`res.json(rows)`), unlike the portal side's hand-shaped `WireSopLibraryItem`
etc. That is a real, load-bearing difference this pack records rather than glosses over:
whatever consumes this surface (today: `get_running_sops`; eventually: the MSP-console UI)
receives the DB row's own camelCase field names one-to-one, not a curated wire shape.

### 1.1 Library — `GET /api/msp/sops` (`msp-sops.ts:106-131`)

Returns `MspSop[]` (`typeof mspSopsTable.$inferSelect`, `msp.ts:5682`), ordered
`desc(mspSopsTable.id)`, scoped to `mspId` only (no customer scoping — this is the MSP's
own library across every customer). Every column is `CURRENT`:

```ts
// msp.ts:5657-5679, the raw row shape this route returns as-is
{
  id: number;
  mspId: number;
  sopId: string;
  code: string;
  title: string;
  description: string;
  category: string;
  version: string;
  automationType: string;        // "automated" | "hybrid" | "manual" — see §3
  estimatedMinutes: number;
  complianceTags: unknown[];     // jsonb, string[] by convention, no runtime check
  workloadTags: unknown[];       // jsonb, string[] by convention, no runtime check
  steps: unknown[];              // jsonb — see StoredSopStep, portal-sops.ts:37-43
  lastUpdatedBy: string;
  lastUpdatedAt: string;         // free text (e.g. "2026-01-15"), NOT a timestamp column
  versionStatus: string;         // free text (e.g. "Published / Active"), no enum
  createdAt: string;             // real timestamptz
  updatedAt: string;             // real timestamptz
}
```

| Field | Status | Note |
|---|---|---|
| `steps` | CURRENT, but **untyped on this wire** | `msp-sops.ts` validates `steps` shape on write (`sopStepSchema`, `:16-27`) but this GET returns the stored jsonb verbatim — a reader gets `unknown[]`, not the validated shape, until it re-parses with `readSteps()` (`portal-sops.ts:67-70`) itself |
| `automationType` / `versionStatus` | CURRENT | plain `text`, no DB CHECK constraint on either — `automationType` is enum-shaped only by the POST-side Zod schema (`:36`), `versionStatus` has **no enum anywhere**, free text (§3) |
| every other field | CURRENT | direct column passthrough |

### 1.2 Author a SOP — `POST /api/msp/sops` (`msp-sops.ts:135-188`)

Request body: `createSopSchema` (`:29-42`) — `sopId`, `code`, `title`, `description`,
`category`, `version`, `automationType` (enum, §3), `estimatedMinutes`, `complianceTags`
(`string[]`), `workloadTags` (`string[]`), `steps` (`sopStepSchema[]`, `:16-27`),
`versionStatus` (free string, **caller-supplied**, no default forced server-side — unlike
the customer-authored path in `portal-sops.ts`, this route does not force `version: "v1.0"`
or `automationType: "manual"`; the operator's own values are trusted as typed). Server-set:
`mspId` (from auth context), `lastUpdatedBy` (`req.user?.email`, falls back to the literal
string `"unknown@mspplatform.com"` if absent — `:153`), `lastUpdatedAt` (today's date,
`YYYY-MM-DD`, `:154`). Success `201`: `{ id, sopId, message }` (`:177-181`).

**No uniqueness pre-check surfaced to the caller.** The schema has a real DB unique
constraint (`msp_sops_msp_id_sop_id_uidx`, `msp.ts:5678`) on `(mspId, sopId)`, but this
route does not catch that constraint violation specially — a duplicate `sopId` for this
MSP falls through to the generic `500 INTERNAL` catch block (`:182-186`) with the raw
Postgres error message, not a `409`. Flag for Design: an author retrying a duplicate
`sopId` sees a generic server error, not "this SOP ID already exists."

### 1.3 Run a SOP — `POST /api/msp/sops/:sopId/run` (`msp-sops.ts:219-277`)

**The real execution hook (#1559).** Request body: `runSopSchema` (`:44-60`) —
`customerId` (required), `targetEntity?` (substituted for `{id}`/`{upn}` placeholders),
`variables?` (`Record<string,string>`, any other named placeholder), `operator?` (falls
back to `req.user?.email` then `"unknown"`), `origin?` (`MSP_SOP_RUN_ORIGIN`, §3),
`changeRequestId?` (an already-approved CR authorizing this write, #1497), `standingPolicyId?`
(#1548 — attribute this run to a standing policy; forces `origin: "policy"`).

Delegates entirely to `runSopForCustomer` (`sop-execution.ts:140-426`). What it actually
does, in order:

1. **Load + validate.** `sopId` must exist for this `mspId` (`sop_not_found`). Its `steps`
   are materialized via `buildSopWorkflowGraph` (`sop-workflow-graph.ts`); zero automatable
   steps → `sop_not_runnable` (a step is automatable only if its `graphEndpoint` parses as
   a `POST|PATCH|PUT|DELETE` write or a `GET` read — manual-only steps never materialize).
2. **Policy binding (#1548), if `standingPolicyId` given.** Verified: belongs to this
   `mspId`, `isActive`, and its own `sopId` column matches the one being run
   (`standing_policy_not_found` / `_inactive` / `_sop_mismatch` / a mismatched explicit
   `origin` → `standing_policy_requires_policy_origin`).
3. **Customer resolution + ownership.** `customer_not_found`, `customer_wrong_msp` (a
   cross-tenant guard — the customer row belongs to a *different* MSP than the caller's),
   `customer_not_connected` (no `tenantId` on the tenant row).
4. **Variable binding.** `targetEntity` → `{id}`/`{upn}`; anything the graph still needs
   after that → `missing_variables` with the specific list.
5. **Authorization — skipped entirely if every materialized step is a read (#1939,
   `hasWrites` false).** Otherwise, in priority order: an explicit `changeRequestId` is
   claimed via `claimChangeRequestForWrite` (scoped `targetKey: sop:<sopId>`, #1773) →
   `change_request_not_authorized` if the claim fails; else a `standingPolicyId` with no
   explicit CR auto-raises its own approved CR from the policy's bound, currently-approved
   catalog item (#1550's "approve once, execute many") →
   `standing_policy_catalog_item_not_approved` if that catalog item is missing/draft/
   revoked; else the customer must be `isTestbed` → `customer_not_testbed`.
6. **Fire.** Materializes/reuses a `wf_definitions` version (`persistMaterializedWorkflow`)
   and fires it (`fireWorkflowForDefinition`, trigger `"manual"`) → `concurrency_limit` if
   the definition's own concurrency cap blocks it.
7. **Write the run.** Inserts `msp_sop_runs` with `origin`, `standingPolicyId`,
   `status: "In Progress"`, `totalSteps` = the SOP's full step count (not just the
   automated ones), `psaTicketId` = `formatChangeRequestCode(claimedChangeRequestId)` if a
   CR authorized it, else `""`, and `automatedStepMap` — the node-id→step-index snapshot
   `settleSopRuns` later reads back.

Success `202`: `{ id, runId, wfRunId, definitionId, versionId, reusedVersion, sopId,
customerId, automatedStepCount, totalSteps, authorizingChangeRequestId, standingPolicyId }`
(`:253-266`). Error mapping is exhaustive per `SopExecutionErrorCode` (`SOP_RUN_ERROR_STATUS`,
`:198-217`) — every code in `sop-execution.ts` has a real HTTP status, no fallthrough
`?? 422` is ever actually reached today because the map is complete.

**A hybrid SOP's manual steps are NOT closed by this route.** They close out through
`PATCH /msp/sop-runs/:runId` (§1.6) by hand — a run whose automated steps all finish but
which still has open manual steps settles to `Blocked`, not `Completed` (`settleSopRuns`,
`sop-execution.ts:512-523`).

### 1.4 Run history — `GET /api/msp/sop-runs` (`msp-sops.ts:281-306`)

Returns `MspSopRun[]` (`typeof mspSopRunsTable.$inferSelect`, `msp.ts:5795`), `desc(id)`,
scoped to `mspId` — across every customer, unlike the portal-side `GET /portal/sop-runs`
which is single-customer. Raw row shape, every column `CURRENT`:

```ts
// msp.ts:5705-5776, the raw row shape this route returns as-is
{
  id: number; mspId: number; runId: string; sopId: string; sopTitle: string;
  tenantId: string; tenantName: string; targetEntity: string; operator: string;
  origin: "policy" | "lifecycle" | "remediation" | "manual";
  standingPolicyId: number | null;
  sopVersion: string;             // "" = not recorded (#1558 captured-at-run-start)
  startedAt: string; completedAt: string | null;
  status: string;                 // free text, see §3 — "In Progress"|"Completed"|"Blocked"|"Failed" by convention only
  currentStepIndex: number; totalSteps: number; passedStepsCount: number;
  psaTicketId: string;            // "" if no CR authorized the run
  logs: unknown[];                // jsonb string[] by convention
  wfRunId: number | null;         // null = hand-entered/legacy row, never actually fired
  automatedStepMap: unknown[];    // jsonb, SopRunAutomatedStep[] by convention, no runtime check
  createdAt: string; updatedAt: string;
}
```

### 1.5 Hand-entry insert — `POST /api/msp/sop-runs` (`msp-sops.ts:310-377`)

**A raw, MSPOperator-scoped INSERT with no CR and no Workflow Engine run behind it** — the
route's own header comment (`:62-78`) is explicit this must never become a second
execution path. Request body: `createSopRunSchema` (`:79-94`) — every field the caller
supplies directly (`runId`, `sopId`, `sopTitle`, `tenantId`, `tenantName`, `targetEntity`,
`operator`, `startedAt`, `status: "In Progress"` literal — cannot be born already
Completed/Blocked/Failed, `currentStepIndex`, `totalSteps`, `passedStepsCount`,
`psaTicketId`, `logs`).

**Server-forced, never client-settable, per #1938:**

| Field | Forced value | Why |
|---|---|---|
| `origin` | `"manual"`, unconditionally (`:354`) | Prevents this hand-entry path from fabricating a `"policy"`-origin row the portal's audit view would render identically to a real, CR-authorized enactment |
| `sopVersion` | Read live from `mspSopsTable.version` for this `(mspId, sopId)` at insert time (`:334-338, 355`), `""` if no matching definition exists | Same #1558 "captured now, not trusted from the caller" rule the execution hook follows |

`wf_run_id` / `automated_step_map` are absent from `createSopRunSchema` entirely — never
client-settable here, exclusively `runSopForCustomer`'s to write. Success `201`:
`{ id, runId, message }` (`:366-370`).

### 1.6 Update a run — `PATCH /api/msp/sop-runs/:runId` (`msp-sops.ts:381-435`)

Looks the run up by `(runId, mspId)` first — `404` if not found or not this MSP's
(`:396-405`). Request body: `patchSopRunSchema` (`:96-102`), all optional: `status`
(`"In Progress"|"Completed"|"Blocked"|"Failed"`, real Zod enum here — the only place this
vocabulary is enforced, §3), `currentStepIndex`, `passedStepsCount`, `completedAt`
(nullable), `logs` (full-array replacement, not append). Only fields present in the body
are written (`updateData` built field-by-field, `:413-418`) — an absent field leaves the
stored value untouched. This is the route a human uses to close out a hybrid SOP's
remaining manual steps, and the only writer of `status`/`completedAt` other than
`settleSopRuns`'s own reconciliation sweep.

**No guard preventing an operator from PATCHing a run `settleSopRuns` is also managing.**
Both this route and the reconciliation sweep can write `status`/`currentStepIndex`/
`passedStepsCount` to the same row with no version/lock coordination between them — a
human closing out manual steps at the same moment the sweep advances the automated ones
could race. Not verified as a live bug (no concurrent-write test exists), flagged as an
open gap in §6.

---

## 2. Real enum unions (and where each is actually enforced)

| Vocabulary | Values | Where enforced | Status |
|---|---|---|---|
| SOP run `origin` | `policy`, `lifecycle`, `remediation`, `manual` | Real `text({ enum })` DB column (`msp.ts:5720`); Zod-validated on `POST /msp/sops/:sopId/run`'s optional `origin` (`msp-sops.ts:52`); **forced, not accepted**, on `POST /msp/sop-runs` (`:354`, #1938) | CURRENT |
| SOP `automationType` | `automated`, `hybrid`, `manual` | Zod `z.enum` on `POST /msp/sops` only (`:36`) | **DECIDED, not DB-enforced** — the column itself is plain `text`, no CHECK; a row inserted any other way (a future migration, a script) is not blocked from storing an arbitrary string |
| SOP step `type` | `manual`, `automated` | Zod `z.enum` inside `sopStepSchema` (`:20`), `POST /msp/sops` only | Same caveat — plain jsonb, not a DB enum |
| SOP step `status` | `pending`, `running`, `success`, `failed` | Zod `z.enum` inside `sopStepSchema` (`:24`), `POST /msp/sops` only | CURRENT but **never read anywhere on this surface's own GETs** — accepted on write, not surfaced back out distinctly from the rest of `steps` jsonb |
| SOP run `status` | `In Progress`, `Completed`, `Blocked`, `Failed` | Zod `z.enum` on `patchSopRunSchema` (`:97`) — **the only enforcement point**; `POST /msp/sop-runs` accepts only the literal `"In Progress"` (`z.literal`, `:88`); the column itself is plain `text`, no DB CHECK | CURRENT |
| `versionStatus` | none — free text, e.g. `"Published / Active"` | Nowhere | **No enum exists.** Every live value happens to be `"Published / Active"` (confirmed, all 15 rows) but nothing in code or schema constrains it |

---

## 3. Cross-surface edges

| Edge | Column | Points at | Served on this surface? | Notes |
|---|---|---|---|---|
| Run → standing policy | `msp_sop_runs.standing_policy_id` (`msp.ts:5729`) | `standing_policies.id`, real FK, `SET NULL` on delete | Yes — accepted on `POST .../run`, returned in the run row | Set only via the policy-enactment path (§1.3 step 2); `POST /msp/sop-runs` never accepts it (#1938) |
| Run → Workflow Engine run | `msp_sop_runs.wf_run_id` | `wf_runs.id`, no FK (same no-FK convention `msp_change_requests.executor_run_id` follows) | Yes, in the raw row (`GET /msp/sop-runs`) | Null for every hand-entered/legacy row — a real, honest signal that a given run never actually fired anything |
| Run → Change Request | `msp_sop_runs.psa_ticket_id` | `msp_change_requests` via the `/^CR-/` string convention the portal side's `auditResult`/link-rendering already relies on | Yes, raw string | This route stores the CR **code** (`formatChangeRequestCode`), not the CR id — the same convention the portal pack's §7 nuance #2 already documents for the read side |
| SOP → Run | `msp_sop_runs.sop_id` | `msp_sops.sop_id`, no FK | Yes | A run whose definition was since deleted still renders — same as the portal pack's §4 |
| SOP author identity | `msp_sops.last_updated_by` | `users.email` within the caller's tenant, **or the literal fallback string `"unknown@mspplatform.com"`** | Yes, raw | Not a real email lookup/validation — whatever `req.user?.email` happens to be, or the hardcoded fallback |
| Run → materialized workflow definition | `msp_sop_runs` (via `wf_run_id` → `wf_runs.definition_id`) | `wf_definitions`, named `sopDefinitionName(sopId)` (`"SOP: <sopId>"`) | Indirect (not a column on this table) | Regenerated on every run request when the SOP's automated steps change — "edit the SOP, not this definition" (`sop-execution.ts:332`) |

---

## 4. The forbidden list — declared, not merely absent

1. **No second execution path.** `POST /msp/sops/:sopId/run` is the only writer that fires
   anything through the Workflow Engine; `POST /msp/sop-runs` is hardened (#1938) to force
   `origin: "manual"` and reject `standingPolicyId`/`wfRunId`/`automatedStepMap` so it can
   never fabricate a row that reads as a real, authorized enactment.
2. **A read-only materialized step never touches the CR gate.** #1939's `hasWrites` check
   means an all-read SOP run skips authorization entirely — by design, not an oversight;
   confirmed the code path exists and is intentional (`sop-execution.ts:211-215, 260-264`).
3. **A claimed Change Request must name the specific SOP, not just be "approved."**
   `targetKey: sop:<sopId>` (#1773) — a CR scoped to a different pack/SOP at raise time
   cannot authorize this one.
4. **`sopVersion` on a run is never client-supplied.** Always read live from the base
   definition at insert time (§1.5), same rule the portal pack's #1558 precedent set.
5. **This surface never writes `portal_sop_custom_steps`.** That table is the customer
   overlay, exclusively `portal-sops.ts`'s to write — no route here touches it, confirmed
   by grep (`portal_sop_custom_steps`/`portalSopCustomStepsTable` do not appear anywhere in
   `msp-sops.ts` or `sop-execution.ts`).
6. **An id in a URL path is never trusted as a permission.** `PATCH /msp/sop-runs/:runId`
   re-checks `(runId, mspId)` before allowing any write (`:396-401`).

---

## 5. Open gaps — NOT decided (do not resolve; flag)

1. **`POST /msp/sops` has no duplicate-`sopId` handling.** A retry or a race hits the DB's
   real unique constraint and surfaces as a generic `500`, not a `409` (§1.2). Not filed as
   a new issue — recorded here for whoever builds the MSP-console authoring UI to design
   around (a client-side pre-check, or the route itself should be hardened when that UI
   lands).
2. **No version/lock coordination between `PATCH /msp/sop-runs/:runId` and
   `settleSopRuns`'s reconciliation sweep** (§1.6). Not verified as a live bug — flagged
   as an open concern for Design/architecture, not a confirmed defect.
3. **`versionStatus` has no enum anywhere** (§2) — every live row happens to agree on one
   value, but nothing enforces that going forward. If the MSP-console UI needs a status
   picker, this is a real gap to close before that UI ships, not an assumption to build on.
4. **The HTTP route `POST /msp/sops/:sopId/run` itself has no verified caller today**
   (§0.1) — the underlying `runSopForCustomer` function is real and complete, but nothing
   currently reaches it over HTTP. This is the expected pre-Design state (§0.1), not a
   defect, but Design should know the wiring from a future UI action to this exact route
   is still to be built, not "already connected to something."
5. **`get_running_sops` (mcp-server) is the one real, live consumer of this surface today**
   — not a finding, a fact worth recording so a future MSP-console build does not assume
   it is inventing the first consumer; there is prior art for what "the operator's SOP
   library and its run record" should look like, in that tool's own field selection
   (`sops-msp-console-contract-pack.md`'s own §0.1 table cites the file directly).

---

## 6. Provenance

Extracted 2026-09-03 against branch `agent/2595-q1406`, a new pack (no prior version of
this MSP-console-scoped surface existed — the existing `docs/sops-contract-pack.md`,
regenerated today under #1728/`59f07eda5`, is a different, customer-portal-scoped surface,
not superseded or replaced by this one). Full read of `msp-sops.ts` (438 lines),
`sop-execution.ts` (549 lines), `sop-workflow-graph.ts` (materializer header + parsing
logic), relevant slices of `portal-sops.ts` (shared pure derivations,
`StoredSopStep`/`readSteps`), and the Drizzle schema (`lib/db/src/schema/msp.ts:5140-5796`
for `standingPoliciesTable`/`mspSopsTable`/`mspSopRunsTable`). Live DB state confirmed via
direct `psql` against local `DATABASE_URL`: 15 `msp_sops` rows (real titles/codes/automation
types listed in the header), 0 `msp_sop_runs`. Consumer sweep: `grep -rn` for
`msp/sops|msp/sop-runs` across `artifacts/*/src` found exactly one real caller
(`artifacts/mcp-server/src/tools/get-running-sops.ts`) and confirmed
`artifacts/msp-console` does not exist. Architecture deltas cited to #1556, #1548, #1550,
#1552, #1558, #1559, #1773, #1938, #1939, under Feature #1687 and epic #1571. No new
sub-issue filed — every gap in §5 is either a design note for the not-yet-built UI or an
unconfirmed concern, not a verified defect meeting this project's finding bar. Read-only
pass: no product code, schema, or UI was changed.
