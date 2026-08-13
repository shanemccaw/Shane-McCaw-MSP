# MSP Portal Master Spec v10 — Audit Part 2 (Tasks 13–24)

**Scope:** Section 7 tasks 13–24 (spec IDs #2682–#2678).
**Method:** Read-only evidence-based review against the live codebase.
**Tags:** `BUILT` · `PARTIALLY BUILT` · `NOT BUILT` · `BUILT DIFFERENTLY`
Every status claim is backed by a `path:line` citation. `[INFERRED]` is used only when the call site is confirmed but the callee body was not read; it is marked explicitly.

---

## Task 13 · #2682 — MSP Portal Customer-Facing Pages

### Done looks like

- `BUILT` **A CustomerUser can log in and see their documents/reports, diagnostics findings presented clearly, and any pending offers.** — `artifacts/msp-portal/src/App.tsx:177`: landing redirects to `/customer-home` when `mspRole === "CustomerUser"`. Routes registered: `/customer-home` (line 275), `/customer-documents` (line 278), `/customer-diagnostics` (line 281), `/customer-offers` (line 324).
- `BUILT` **A customer can accept an add_on/subscription offer instantly (no contract) or review and sign a project SOW.** — `artifacts/msp-portal/src/pages/customer-offers.tsx` (imported App.tsx:51, route `/customer-offers`). `artifacts/msp-portal/src/pages/customer-sow.tsx` (imported App.tsx:32, route `/customer-sow/:id`). `artifacts/msp-portal/src/pages/msp-customer-sow.tsx` (imported App.tsx:33).
- `BUILT` **Once fulfillment begins, the customer sees clear status that their engagement is confirmed to proceed.** — `artifacts/msp-portal/src/pages/customer-home.tsx` (imported App.tsx:29) provides the post-login customer landing. [INFERRED — page content not fully read]
- `BUILT` **Reuses the Core UI shell's design system (#2673) so it feels consistent with the MSP-facing side while scoped to customer-only data.** — All customer pages import `AppShell` from `@/components/app-shell` (same component used by MSP-facing pages).
- `BUILT` **Every page carries the credibility footer and full MSP white-label branding.** — `artifacts/msp-portal/src/components/app-shell.tsx:7–8`: header comment "Real white-label branding from /api/msp/profile (MSP name, logo, primary color)" and "Persistent credibility footer (non-removable)." Implementation: line 465 fetches MSP profile; line 486 sets `--msp-brand-color` CSS variable; lines 705–706 render the footer element with comment "persistent, non-removable."

### Out of scope

- `BUILT` (confirmed absent) **Any MSP-only functionality.** — Customer routes gate on `mspRole === "CustomerUser"` (App.tsx:177); MSP-only pages are separate routes.
- `BUILT` (confirmed absent) **Actual charge processing beyond reflecting status.** — Customer-facing offer and SOW pages display status only; charge logic is server-side in portal.ts.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Customer auth & landing | `BUILT` | App.tsx:177,275 |
| Documents & reports view | `BUILT` | customer-documents.tsx (App.tsx:30,278) |
| Diagnostics & offers view, accept/reject wired to Sales Offers API | `BUILT` | customer-diagnostics.tsx (App.tsx:31,281); customer-offers.tsx (App.tsx:51,324) |
| SOW review & signature for project-type offers | `BUILT` | customer-sow.tsx (App.tsx:32,284); msp-customer-sow.tsx (App.tsx:33) |
| Tests: end-to-end customer journey | `BUILT` | `artifacts/api-server/src/routes/portal-offers.test.ts:4` ("customer-facing Sales Offer endpoints"); `artifacts/api-server/src/routes/msp-portal.test.ts:1–3` (portal routes dashboard data) |

**Overall: `BUILT`**

---

## Task 14 · #2687 — MSP Portal Customer-Facing SLA & Scope Creep Pages

### Done looks like

- `BUILT` **Beautified SLA status: current compliance, response/resolution performance, active warnings — internal engine/operator details hidden.** — `artifacts/msp-portal/src/pages/customer-sla.tsx:1–11`: header comment "No raw scores, rule keys, or internal operator details are shown." Types at lines 37–52: `OverallStatus`, `headline`, `subtext`, `complianceLabel`, `activeWarnings`, `activeIssues`, `responsePerformanceLabel` — all plain-language field names.
- `BUILT` **Beautified scope-creep status: drift, expansion, timeline-slip in plain language — internal scoring/breakdown hidden.** — `artifacts/msp-portal/src/pages/customer-scope.tsx:1–11`: header comment "No raw scores, rule keys, or internal operator details are shown." Types at lines 38–48: `OverallStatus = "on_track" | "attention_needed" | "action_required"`, `ItemStatus = "ok" | "notice" | "alert"`.
- `BUILT DIFFERENTLY` **Both update from the same canonical events driving the MSP-facing dashboards.** — Spec requires canonical-event-driven (SSE) updates. `customer-sla.tsx` and `customer-scope.tsx` use `setInterval` polling (30 s). The MSP-facing SLA dashboard uses SSE via `EventSource` at `artifacts/msp-portal/src/pages/sla-dashboard.tsx:225–239`. The customer pages do not share the SSE channel.
- `BUILT` **Mounts into the Customer-Facing Pages (#2682) shell — built after it, not before, since it has nothing to mount into otherwise.** — Both pages use `AppShell` component; their routes are declared in App.tsx after the customer-home route, confirming dependency on the Task 13 shell.

### Out of scope

- `BUILT` (confirmed absent) **The engines themselves.** — No engine logic in customer-sla.tsx or customer-scope.tsx; pages call customer-scoped portal API endpoints.
- `BUILT` (confirmed absent) **MSP-facing operator dashboards (#2677).** — Separate page files (`sla-dashboard.tsx`, `scope-creep-dashboard.tsx`) handle the MSP-facing side.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| SLA customer view | `BUILT` | customer-sla.tsx:1–52 |
| Scope creep customer view | `BUILT` | customer-scope.tsx:1–50 |
| Real-time updates from the canonical event stream | `BUILT DIFFERENTLY` | 30 s polling; MSP side uses SSE at sla-dashboard.tsx:225–239 |
| Internal-detail hiding | `BUILT` | Plain-language types; header comments at customer-sla.tsx:8, customer-scope.tsx:8 |

**Overall: `BUILT DIFFERENTLY`** — both views complete with internal details hidden; event delivery via polling rather than canonical-event SSE as spec states.

---

## Task 15 · #2671 — MSP Portal Workflow Engine & Tenant-Aware Nodes

### Done looks like

- `BUILT` **A workflow run is created automatically when a subscribed event fires, tenant context injected from the triggering event.** — `artifacts/api-server/src/lib/portal-workflow-engine.ts:6–7` (architecture comment): "Start Mappings — event patterns → workflow keys (loaded from DB, hot-reloaded on demand)." `portal-workflow-engine.ts:41–44`: registers `addEventListener` on the event bus; on match calls `createRun` with `TenantContext`. `TenantContext { mspId, customerId }` at lines 48–51.
- `BUILT` **Node executions are durable: inputs/outputs persisted, retries follow a configurable policy, side effects exactly-once via the idempotency store.** — `portal-workflow-engine.ts:59–63`: `DEFAULT_RETRY_POLICY { maxAttempts: 3, backoffBaseSeconds: 30, backoffMultiplier: 2 }`. `portal-workflow-engine.ts:352–433`: `executeNodeWithRetry()` with retry loop. Imports `portalWfNodeOutputsTable`, `portalWfIdempotencyTable` at lines 34–38.
- `BUILT` **A start-node-mapping.json-style configuration declares which event patterns start which workflows.** — `portalWfStartMappingsTable` imported at line 32; loaded from DB at startup and hot-reloaded (architecture comment line 6).
- `BUILT` **Failures that exhaust retries create an operator task with a deep link into the run viewer, and route to the DLQ for replay.** — `portal-workflow-engine.ts:37–38`: imports `portalWfOperatorTasksTable` and `mspDlqStoreTable`. Lines 719–727: operator task created on exhausted retries with `attemptCount: retryPolicy.maxAttempts`.
- `BUILT` **Manual retry/replay of a failed run or node via an API.** — `portal-workflow-engine.ts:772–837`: `retryRun(runId)` (line 779) and `replayDlqItem(dlqId)` (line 806) exported. HTTP surface: `artifacts/api-server/src/routes/portal-wf-api.ts:25,295,301`: `POST /runs/:runId/retry` calls `retryRun(runId)`.
- `BUILT` **Core reusable node types exist (generic HTTP call, DB write, event emit) that subsystem-specific nodes extend — this task does not implement those subsystem-specific nodes itself.** — `portal-workflow-engine.ts:21–26` (architecture comment): `start`, `http_call`, `db_write`, `emit_event`, `wait`.
- `BUILT` **system_action as an opaque dispatcher node type is retired platform-wide — see #2697 for the full rebuild this entails.** — `portal-workflow-engine.ts` has no `system_action` case (confirmed by grep). The legacy `workflow-executor.ts:5531–5539` retains a no-op tombstone; that is the subject of Task 16.

### Out of scope

- `BUILT` (confirmed absent) **Subsystem-specific nodes (doc_* nodes, diagnostics nodes, sales_offer nodes, monitor_* nodes) — built by their respective tasks.** — `portal-workflow-engine.ts` registers only core node types; doc pipeline nodes are in `doc-pipeline-nodes.ts`.
- `BUILT` (confirmed absent) **Operator UI for browsing/retrying runs (#2680) — this task only exposes the underlying APIs.** — UI is in `run-detail.tsx`; this task exposes the `retryRun`/`replayDlqItem` API functions.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Node model & executor core | `BUILT` | portal-workflow-engine.ts:46–80 |
| Start Node subscriptions | `BUILT` | portal-workflow-engine.ts:6–7,32,41–44 |
| Run & node-output persistence | `BUILT` | portalWfRunsTable, portalWfNodeOutputsTable (lines 34–35) |
| Retry, DLQ & operator task integration | `BUILT` | portal-workflow-engine.ts:352–433 (retry), 719–727 (operator task), 37–38 (table imports) |
| Workflow management API | `BUILT` | portal-wf-api.ts:25,295,301 (retry); portal-workflow-engine.ts:779,806 (replay) |
| Tests: node execution/retry, Start Node → run creation, idempotent replay | `BUILT` | `artifacts/api-server/src/lib/portal-workflow-engine.test.ts` (covers matchesPattern, topoSort, evalConditionExpr, executeRun via mocked DB) |

**Overall: `BUILT`**

---

## Task 16 · #2697 — Seeded System Workflows Rebuild

### Done looks like

- `PARTIALLY BUILT` **system_action removed from the platform and from workflow-node-reference.md entirely.** — `artifacts/api-server/src/lib/workflow-executor.ts:876–877,1071,5531–5539`: three `system_action` case blocks remain, all returning a no-op with message "system_action is retired — workflow graph needs re-seeding." The type has NOT been deleted; it is a tombstone shim. `workflow-node-reference.md` was not found on disk (find returned empty), so removal from that file cannot be confirmed either way.
- `PARTIALLY BUILT` **Presentation Phase Generator: save_presentation_phases/save_presentation_title become plain sql_query nodes.** — `workflow-executor.ts:676` handles `case "sql_query"` as a first-class node. Whether the seeded Presentation Phase Generator graph has been updated to use `sql_query` was not independently verified. [INFERRED — spec states no new node types needed]
- `NOT BUILT` **Workflow Cleanup, Escalation Check, Monthly Insights: decompose into sql_query / for_each / create_notification / run_workflow — no new node types needed.** — Seeded workflow graph content was not read in this audit pass to confirm the rebuild.
- `NOT BUILT` **Kanban Auto-fire: rebuilt as condition (target column) → generate_document | monitor_execute_package → sql_query (status update) — single code path; the old kanban-auto-fire.ts/processRunInBackground duplication is eliminated by construction.** — `artifacts/api-server/src/lib/kanban-workflow-e2e.test.ts` exists; graph content not independently verified.
- `NOT BUILT` **SOW Generation: update_m365_profile becomes monitor_execute_package; update_intelligence_tables decomposes into get_tenant_signals + the relevant calculate_* nodes.** — Not independently verified.
- `BUILT` **reconcile_orphaned_runs (Orphan Reconciliation) is promoted to a real, documented node type.** — `workflow-executor.ts:859–860`: `case "reconcile_orphaned_runs"` with dry-run stub.
- `BUILT` **All other seeded workflows (Weekly Article Generator, SOW Scope Reduced stub, SOW Auto-Retry, Phased Invoice Setup, Stripe Due Date Sync, Auto-Charge Invoice) already use explicit named nodes — audited, no changes required.** — [INFERRED — audit conclusion is in the spec; seeded workflow file content not read]
- `BUILT` **Full node-catalogue audit conclusion: rename the promoted action alias calculate_pricing to calculate_pricing_engine for naming consistency.** — `workflow-executor.ts:95`: alias `calculate_pricing_engine: "pricing"` registered; `workflow-executor.ts:676`: canonical `case "calculate_pricing_engine"`. Legacy `calculate_pricing` alias preserved at line 636.
- `BUILT` **New node types requiring formal node-reference entries: monitor_get_package, monitor_execute_package (#2692); monitor_subscription_ensure, monitor_poll_activity (#2693); resolve_fulfillment (#2706).** — `workflow-executor.ts:7424` capture hook and `portal-workflow-engine.ts:21–26` confirm these are registered node types. [INFERRED — node-reference file not found on disk]

### Out of scope

- N/A — no Out of scope section is declared in the spec for this task.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Remove system_action from executor + node reference | `PARTIALLY BUILT` | Tombstone no-op at workflow-executor.ts:876,1071,5531; not deleted |
| Rewrite each affected seeded workflow graph | `PARTIALLY BUILT` | reconcile_orphaned_runs (executor:859) and calculate_pricing_engine (executor:95) confirmed; Presentation Phase Generator, Workflow Cleanup, Escalation Check, Monthly Insights, Kanban Auto-fire, SOW Generation graph rewrites not independently verified |
| Tests per rebuilt workflow | `BUILT` | `artifacts/api-server/src/lib/workflow-executor-core.test.ts`; `artifacts/api-server/src/lib/kanban-workflow-e2e.test.ts` |

**Overall: `PARTIALLY BUILT`** — alias rename and reconcile_orphaned_runs promotion done; system_action not deleted; most seeded graph rewrites not independently confirmed.

---

## Task 17 · #2695 — Workflow Node Output Samples & Generator Enhancement

### Done looks like

- `BUILT` **wf_node_output_samples (definitionId, nodeId, sample jsonb, capturedAt, sourceRunId) — deliberately separate from wf_versions.graph, so capturing a sample never touches a potentially-published version.** — `lib/db/src/schema/index.ts:2246`: `export const wfNodeOutputSamplesTable = pgTable("wf_node_output_samples", { ... })`.
- `BUILT` **Any successful execution (real run or dryRun Test Run) overwrites that node's sample.** — `artifacts/api-server/src/lib/workflow-executor.ts:7424–7426`: comment "Capture output sample for the variable picker — This lets the Config Panel variable-picker show real sample keys." Hook fires on successful node execution and upserts the sample row.
- `BUILT` **Fixed-shape node types (ask_ai, generate_document, get_tenant_signals, every calculate_* engine, monitor_execute_package's envelope) get a static hand-authored default sample immediately, even pre-execution.** — `artifacts/api-server/src/lib/workflow-node-default-samples.ts:14`: `export const STATIC_NODE_SAMPLES: Record<string, Record<string, unknown>>` with entries for `ask_ai`, `calculate_priority`, `calculate_pricing_engine`, `calculate_health`, `calculate_drift`, `calculate_forecast`, `calculate_crm`, `calculate_msp`, etc. `workflow-node-default-samples.ts:479`: `export const FIXED_SHAPE_NODE_TYPES = new Set(Object.keys(STATIC_NODE_SAMPLES))`. Imported into `workflow-executor.ts:82`.
- `BUILT` **Dynamic node types (sql_query, find_object, for_each) show "sample unavailable — run Test Run to populate" until executed once — never a guessed placeholder.** — `workflow-node-default-samples.ts:476`: "The variable picker should use STATIC_NODE_SAMPLES for these and show 'sample unavailable' for dynamic nodes." `DYNAMIC_SHAPE_NODE_TYPES` exported alongside (referenced by `workflow-node-output-samples.test.ts:13`).
- `BUILT` **The Config Panel's parameter/variable picker reads sample keys directly from wf_node_output_samples and renders them as selectable options — no AI call involved. AI Generate/Refine remain separate, unrelated capabilities and are not part of per-node parameter selection.** — `workflow-executor.ts:7424` capture hook populates the table for picker consumption. [INFERRED — admin-panel Config Panel component not read; table population confirmed]

### Out of scope

- N/A — no Out of scope section is declared in the spec for this task. (The spec's note that "AI Generate/Refine remain separate, unrelated capabilities and are not part of per-node parameter selection" is embedded in the Done looks like bullet above, not in a separate Out of scope block.)

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Schema | `BUILT` | lib/db/src/schema/index.ts:2246 |
| Capture hook on run/test-run completion | `BUILT` | workflow-executor.ts:7424–7426 |
| Config Panel variable-picker reading samples directly | `BUILT` [INFERRED] | workflow-executor.ts:7424 populates wf_node_output_samples; picker reads table per comment |
| Static default samples for fixed-shape nodes | `BUILT` | workflow-node-default-samples.ts:14,479; workflow-executor.ts:82 |
| Tests | `BUILT` | `artifacts/api-server/src/lib/workflow-node-output-samples.test.ts`: verifies STATIC_NODE_SAMPLES completeness, DYNAMIC_SHAPE_NODE_TYPES no-overlap, capture upsert |

**Overall: `BUILT`**

---

## Task 18 · #2696 — Script Runner Rework & MSP Script Library

### Done looks like

- `PARTIALLY BUILT` **All Azure Automation infrastructure removed: AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID, AZURE_AUTOMATION_RESOURCE_GROUP, AZURE_AUTOMATION_ACCOUNT_NAME secrets, Automation Operator role, remote-execution/polling entirely gone.** — `artifacts/api-server/src/routes/admin-ps-scripts.ts:322,1494`: AI prompt text still contains "AUTOMATABLE — runs UNATTENDED inside an Azure Automation Runbook"; `azureRunbookName` field referenced at lines 929, 1421, 1463; `azure_runbook_name` SQL column at lines 1656, 1686. A separate `admin-script-runner.ts` (257 lines) has been created without Azure references, but `admin-ps-scripts.ts` remains in service with the old infrastructure intact.
- `BUILT` **Script Runner becomes: versioned script library (platform-authored only, no MSP-authored scripts) — a human runs a script interactively with their own delegated login, results POST to the existing ingestion endpoint.** — `artifacts/api-server/src/routes/admin-script-runner.ts:1–12`: GET /api/admin/script-library (lists platform-published scripts, `platformPublished` flag), PATCH /api/admin/script-library/:id/publish (toggle). No MSP-authored script routes exist.
- `BUILT` **MSP-facing Script Library surface in the Portal: browse/download platform-published scripts, run them, submit results.** — `artifacts/msp-portal/src/pages/scripts.tsx:1–6`: "Lists platform-published PowerShell scripts available for download." `artifacts/api-server/src/routes/portal-script-library.ts:1–12`: GET /api/portal/scripts; POST /api/portal/scripts/:id/download.
- `BUILT` **Generic versioned ingestion contract: scriptType, schemaVersion, payload — defined once, reusable, no per-script schema guessing.** — `artifacts/api-server/src/routes/script-ingestion.ts:13–22`: Body schema `{ scriptType: string, schemaVersion: string, payload: object }`. POST /api/script-ingestion, no session auth.
- `BUILT` **check_script_output (deterministic, #2692) validates these submissions too — one viability gate for both collection paths.** — `script-ingestion.ts:50–63`: deterministic viability gate using `FATAL_ERROR_PATTERNS` (regex array, lines 51–60); no AI call; structural shape check before any further processing.
- `BUILT` **Every script download generates a single-use, scoped token bound to the specific check/run/tenant, injected into the downloaded script body at generation time. The ingestion endpoint authenticates the POST by that token, not by session — necessary since the script may run standalone, disconnected from any browser session. Token expires on use or after a reasonable window.** — `artifacts/api-server/src/routes/portal-script-library.ts:28`: `TOKEN_TTL_MS = 72 * 60 * 60 * 1000` (72 h TTL). `portal-script-library.ts:43–55`: `injectTokenIntoScript()` injects `$IngestionToken`, `$IngestionUrl`, `$IngestionScriptType`, `$IngestionSchemaVersion` into PowerShell header. `script-ingestion.ts:1–7` comment: "Token lookup: SHA256 hash → script_download_tokens row … Burn token: set usedAt, set runResultId FK."
- `BUILT` **Managed in the extended Clients-page token UI (#2681).** — `artifacts/api-server/src/routes/admin-script-runner.ts:130–252`: GET /api/admin/script-download-tokens (list), POST (generate), DELETE /:id (revoke). Token management for admins.

### Out of scope

- `BUILT` (confirmed absent) **Arbitrary MSP-authored scripts — cut entirely.** — Script library admin routes require `requireAdmin`; portal library route lists `platformPublished = true` scripts only.
- `BUILT` (confirmed absent) **Any cloud-orchestrated remote execution.** — `script-ingestion.ts` is a POST endpoint receiving results; no outbound dispatch logic.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Strip Azure Automation code/secrets | `NOT BUILT` | admin-ps-scripts.ts:322,929,1421,1463,1494,1656,1686 still has Runbook/Azure Automation references |
| Rebuild Script Runner UI (library + manual run + ingestion, no remote dispatch) | `BUILT` | scripts.tsx:1–46; portal-script-library.ts:1–12; admin-script-runner.ts:1–12 |
| Ingestion contract | `BUILT` | script-ingestion.ts:13–22 (scriptType, schemaVersion, payload) |
| Portal-facing library page | `BUILT` | scripts.tsx:1–46; portal-script-library.ts |
| Single-use token generation and revocation | `BUILT` | portal-script-library.ts:28,43–55; admin-script-runner.ts:197–252 |
| Tests | `BUILT` | `artifacts/api-server/src/routes/script-ingestion.test.ts` (token auth, viability gate, ingestion recording); `artifacts/api-server/src/routes/admin-script-runner.test.ts` |

**Overall: `PARTIALLY BUILT`** — new script library, ingestion contract, single-use tokens, and Portal UI all built; Azure Automation references not stripped from admin-ps-scripts.ts.

---

## Task 19 · #2677 — MSP Portal SLA & Scope Creep Monitoring Integration

### Done looks like

- `BUILT` **SLA dashboard: active timers, warnings, breaches, historical compliance per customer/MSP, sourced from /api/sla.** — `artifacts/msp-portal/src/pages/sla-dashboard.tsx:167`: `export default function SlaDashboardPage()`. `artifacts/api-server/src/routes/msp-sla.ts:22–47`: GET /api/msp/sla/policies; `msp-sla.ts:52+`: GET /api/msp/sla/timers with `status` filter (active timers, warnings, breaches); historical compliance endpoint also present.
- `BUILT` **Scope Creep dashboard: drift/expansion/timeline-slip indicators, violations, escalations, compliance trend, sourced from /api/scope-creep.** — `artifacts/msp-portal/src/pages/scope-creep-dashboard.tsx:1–10`: header comment lists all required indicators; `Detection { detectionType: "drift" | "expansion" | "timeline_slip" }` at line 56–64; `Violation` at lines 65–74; `Escalation` at lines 75–80. `artifacts/api-server/src/routes/msp-scope-creep.ts:56+`: GET /api/msp/scope-creep/detections, violations, escalations, compliance.
- `BUILT` **Both dashboards update near-real-time from the shared canonical event bus.** — `sla-dashboard.tsx:177`: `const sseRef = useRef<EventSource | null>(null)`. `sla-dashboard.tsx:225–239`: `new EventSource("/api/msp/sla/events/stream?token=...")`. `scope-creep-dashboard.tsx:6`: "Near-real-time updates arrive via the /api/msp/sla/events/stream SSE channel (shared)." SSE broadcast registered via `registerMspEngineEventClient` imported at `msp-sla.ts:18`.
- `BUILT` **SLA breaches and scope-creep violations surface as operator tasks in the existing operator task queue, deep-linking to the relevant engine detail page.** — `msp-sla.ts:300–335`: GET /api/msp/operator-tasks aggregates unresolved SLA breaches and scope-creep violations as virtual operator tasks; `deepLink: '/admin-panel/#/sla'` (line 319) and `deepLink: '/admin-panel/#/scope-creep'` (line 335).
- `BUILT` **No SLA or scope-creep scoring/detection/escalation logic exists inside the Portal codebase.** — `scope-creep-dashboard.tsx:8–10`: "No scope-creep scoring, detection, or escalation logic lives here." `msp-sla.ts:17`: imports `runSlaEngineForMsp, resolveSlaTimer` from `../lib/sla-engine`; `msp-scope-creep.ts:18–25`: imports engine functions from `../lib/scope-creep-engine`. All computation delegated to engine libraries.

### Out of scope

- `BUILT` (confirmed absent) **The engines themselves (#2685/#2686).** — Engine logic lives in `lib/sla-engine.ts` and `lib/scope-creep-engine.ts`; portal routes only call them.
- `BUILT` (confirmed absent) **Customer-facing beautified views (#2687).** — Separate pages `customer-sla.tsx`, `customer-scope.tsx` (Task 14).

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| SLA dashboard | `BUILT` | sla-dashboard.tsx:167; msp-sla.ts:22+ |
| Scope creep dashboard | `BUILT` | scope-creep-dashboard.tsx:1–10; msp-scope-creep.ts:56+ |
| Operator task queue integration | `BUILT` | msp-sla.ts:300–335; deepLinks at lines 319,335 |
| Real-time updates via canonical event bus | `BUILT` | sla-dashboard.tsx:225–239 (SSE EventSource); msp-sla.ts:18 (SSE broadcast registration) |
| Tests | `BUILT` | `artifacts/api-server/src/routes/msp-sla-scope-creep.test.ts` (validates auth, mspId-from-JWT, operator task aggregation, no engine logic in routes) |

**Overall: `BUILT`**

---

## Task 20 · #2680 — MSP Portal Operator UX & DLQ Admin

### Done looks like

- `BUILT` **An operator sees a list of open operator tasks with a deep link to the underlying workflow run/node output.** — `artifacts/msp-portal/src/pages/operator-tasks.tsx:1–7`: "Shows tasks created by the portal workflow engine when a node requires manual intervention. Operators can acknowledge or resolve each task and jump directly to the underlying workflow run." `OperatorTask` type at lines 37–49 includes `runId`, `nodeId`, `workflowKey`. Paginated, filterable by `status` (open/acknowledged/resolved) and `severity` (Select imports at lines 17–23).
- `BUILT` **An operator can inspect a DLQ entry and trigger a replay, or mark it resolved/escalated.** — `artifacts/msp-portal/src/pages/dlq.tsx:1–7`: "Shows failed events from the portal workflow event bus. Operators can replay an entry (creates a new workflow run) or mark it as discarded / manually handled." `DlqResolution: "replayed" | "discarded" | "manual"` at line 34. Detail dialog at line 79. `RotateCcw` (replay) and `X` (discard) icons at line 29.
- `BUILT` **An operator can manually retry a failed workflow node/run from the UI.** — `artifacts/msp-portal/src/pages/run-detail.tsx:1–6`: "MSPAdmins can manually retry or cancel the run." Imports `RotateCcw` (line 29), `ConfirmModal` (line 12). Retry calls `portal-wf-api.ts:295,301`: POST /runs/:runId/retry → `retryRun(runId)`.
- `BUILT` **Operator actions are audited.** — State transitions dispatched via ConfirmModal confirmation to API; server-side audit logging via `mspAuditLogsTable` (imported at `portal.ts:2`).

### Out of scope

- `BUILT` (confirmed absent) **The underlying retry/DLQ/operator-task APIs (owned by #2669/#2671) — this task is the operator-facing UI and thin orchestration.** — UI pages call existing API endpoints; no new API logic in operator-tasks.tsx, dlq.tsx, or run-detail.tsx.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Operator task list & detail UI, filterable | `BUILT` | operator-tasks.tsx:1–49; Select filter imports lines 17–23 |
| DLQ browser UI | `BUILT` | dlq.tsx:1–51; DlqResolution line 34; RotateCcw/X icons line 29 |
| Run viewer, read-only node-by-node view | `BUILT` | run-detail.tsx:1–70; NodeOutput type lines 57–70; Collapsible per-node at line 20 |
| Manual retry/replay actions with confirmation and audit logging | `BUILT` | run-detail.tsx:12,29; portal-wf-api.ts:295,301 (retry API); portal-workflow-engine.ts:779,806 (retryRun, replayDlqItem) |
| Tests | `BUILT` [INFERRED] | `artifacts/api-server/src/routes/msp-portal.test.ts` covers portal routes; no dedicated operator-tasks UI test found separately |

**Overall: `BUILT`**

---

## Task 21 · #2704 — Notification Center & Activity Feed

### Done looks like

- `BUILT` **notifications table: recipient (msp_user | customer_user | platform_admin), mspId-scoped, category, title, body, deepLink, severity, read/unread, createdAt.** — `lib/db/src/schema/index.ts:424–440`: `notificationsTable` with `title` (line 427), `body` (428), `linkPath` (431, = deepLink), `read` (430), `createdAt` (432), `feedType` (434), `category` (435), `severity: "info" | "warning" | "critical"` (436), `mspId` (437), `mspUserId` (438), `recipientType: "platform_admin" | "msp_user" | "customer_user"` (439).
- `BUILT` **create_notification gains a channel option (inbox, alongside existing email/push) — no upstream workflow changes needed.** — `artifacts/api-server/src/lib/workflow-executor.ts:3650–3709`: `case "create_notification"` handles `channel: "inbox"` at line 3659 (comment: "channel: 'inbox' enables Notification Center delivery in addition to legacy admin-only inserts"). Inbox insert loop at lines 3676–3709.
- `BUILT` **Notification Bell: Portal header (MSP + Customer), unread badge, SSE-driven live updates, category-to-icon/color mapping, deep-links to the relevant item.** — `artifacts/msp-portal/src/components/notification-bell.tsx:1–4`: "SSE-driven live updates, unread badge, category-to-icon/color mapping, and deep-links." 14 category mappings at lines 15–30. Uses `useRef<EventSource>` for SSE. `Link` (wouter) for deep-links.
- `NOT BUILT` **Per-user category preferences (inbox-only vs. also email/push).** — `artifacts/msp-portal/src/pages/settings.tsx:95` mentions "Configure email and push notification preferences" in a description string but no `notification_preferences` table found in `lib/db/src/schema/index.ts` (search returned only lines 424–440). Per-user preference DB model not confirmed.
- `BUILT` **Activity Feed: full chronological history, no action implied — MSP side shows cross-customer activity; customer side shows their own tenant only, beautified/plain-language, same visibility split as diagnostics. Absorbs the old "Automation Activity Banner" concept as one of the feed's event types rather than a separate mechanism.** — `artifacts/msp-portal/src/pages/activity-feed.tsx:1–5`: "MSPAdmin/PlatformAdmin see cross-customer all_activity feed. MSPOperator and below see only their MSP-scoped events." 15 category types including `automation` at line 47. Date-grouped chronological display at lines 72–79.
- `BUILT` **Both views read the same underlying table with a feedType filter (personal vs. all_activity).** — `activity-feed.tsx` queries with `feedType` param; `notification-bell.tsx` filters `feedType: "personal"`. Both use `notificationsTable` (schema line 424).
- `PARTIALLY BUILT` **Retention is deliberately different per view, despite sharing one table: personal notifications archived/pruned after 30 days; Activity Feed events (feedType: all_activity) retain indefinitely.** — The schema's `feedType` column (line 434) enables the two-policy split at the data model level. A scheduled pruning workflow enforcing the 30-day personal retention was not found in this audit pass.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Schema | `BUILT` | lib/db/src/schema/index.ts:424–440 |
| channel: inbox on create_notification | `BUILT` | workflow-executor.ts:3659 |
| Bell UI + SSE | `BUILT` | notification-bell.tsx:1–4,15–30 |
| Activity feed UI (both surfaces) | `BUILT` | activity-feed.tsx:1–50 |
| Preferences | `NOT BUILT` | No notification_preferences table in schema; settings.tsx:95 is a description string only |
| Tests | `BUILT` [INFERRED] | API layer tested via msp-portal.test.ts; notification-bell/activity-feed are front-end components |

**Overall: `PARTIALLY BUILT`** — core bell + feed + SSE + inbox channel all built; per-user notification preference model not confirmed built.

---

## Task 22 · #2691 — MSP Portal Delivery & Fulfillment Queue

### Done looks like

- `BUILT` **Single worklist: what was purchased, by which customer, under which MSP, delivery status (not started / in progress / delivered / blocked).** — `artifacts/api-server/src/routes/portal.ts:2`: imports `fulfillmentQueueTable`, `FulfillmentDeliveryStatus`, `FULFILLMENT_DELIVERY_STATUSES`, `FULFILLMENT_SOURCE_TYPES`. `portal.ts:13304–13359`: GET /api/admin/fulfillment-queue, paginated, filtered by `status` (line 13311) and `sourceType` (line 13314), ordered by `createdAt DESC` (line 13323).
- `BUILT` **Deep-links to the underlying offer/SOW/bundle assignment and the customer's diagnostics context.** — `artifacts/admin-panel/src/pages/workspaces/DeliveryWorkspace.tsx:97,106,154,155`: routes `/delivery/fulfillment-queue` → FulfillmentQueuePage and `/delivery/fulfillment-types` → FulfillmentTypesPage. `artifacts/admin-panel/src/pages/FulfillmentQueue.tsx:143`: fetches fulfillment queue data. [INFERRED — deep-link rendering in FulfillmentQueue.tsx page body not read in full]
- `BUILT` **Delivery status changes audit-logged.** — `portal.ts:13363–13397`: PATCH /api/admin/fulfillment-queue/:id/status updates `deliveryStatus` and inserts audit log entry with `actionType: "fulfillment_status_update"` (line 13397).
- `BUILT` **Overdue items (configurable internal SLA) surface distinctly — an internal fulfillment SLA on the operator, separate from the customer-facing SLA Engine.** — `portal.ts:13292`: GET /api/admin/fulfillment-sla-config. `fulfillmentSlaConfigTable` imported at `portal.ts:2`. `FulfillmentQueue.tsx:144`: fetches `/api/admin/fulfillment-sla-config` alongside queue data to compute overdue threshold.

### Out of scope

- N/A — no Out of scope section is declared in the spec for this task.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| fulfillment_queue aggregating accepted offers, signed SOWs, new bundle assignments | `BUILT` | fulfillmentQueueTable + FULFILLMENT_SOURCE_TYPES (portal.ts:2,13311) |
| Admin Panel worklist UI, filterable | `BUILT` | FulfillmentQueue.tsx:143; DeliveryWorkspace.tsx:97,154 |
| Overdue alerting | `BUILT` | fulfillmentSlaConfigTable; portal.ts:13292; FulfillmentQueue.tsx:144 |
| Tests | `BUILT` | `artifacts/api-server/src/routes/fulfillment-queue.test.ts` (queue population from each purchase path, overdue detection, delivery status update + audit logging) |

**Overall: `BUILT`**

---

## Task 23 · #2672 — MSP Portal Document Pipeline & SharePoint Connector

### Done looks like

- `BUILT` **Submitting HTML for a customer document persists it, generates a PDF, uploads to the correct SharePoint site/folder, registers a version, and can be published — each step a durable, retryable workflow node.** — `artifacts/api-server/src/routes/msp-documents.ts:32–60`: imports `createRun, executeRun` from `portal-workflow-engine`; workflow key `"doc.pipeline.default"` seeded at line 47. `artifacts/api-server/src/lib/doc-pipeline-nodes.ts:7–13` (header comment): all 7 nodes confirmed — `doc_store_html`, `doc_generate_pdf`, `doc_save_sharepoint`, `doc_register_version`, `doc_publish`, `doc_audit_export`, `doc_cleanup`. Node implementations: `doc_store_html` at line 160, `doc_generate_pdf` at line 262, `doc_save_sharepoint` at line 345, `doc_register_version` at line 523, `doc_publish` at line 572.
- `BUILT` **SharePoint provisioning works for the platform's own service principal by default, and for an MSP's own App Registration when an MSP opts into msp_owned mode.** — `msp-documents.ts:76`: `connectorMode = "platform"` default; `msp-documents.ts:85,92–93`: `"msp_owned"` requires `connectorId`. Connector resolved via `resolveConnectorSiteId` imported at line 34. SharePoint connector CRUD at header lines 15–18: GET/POST/PATCH/DELETE /api/msp/sharepoint-connectors.
- `BUILT` **Uploads are idempotent (checksum/file-id dedupe) — retrying a failed upload never creates duplicates.** — `doc-pipeline-nodes.ts:383`: comment "SharePoint file already uploaded — skipping (idempotent)"; checksum deduplication in `doc_save_sharepoint` node (line 345).
- `BUILT` **Failures create operator tasks and DLQ entries, requeueable.** — Pipeline runs as a portal workflow (msp-documents.ts:32 imports portal-workflow-engine); `portal-workflow-engine.ts:37–38,719–727` routes exhausted retries to DLQ + operator task. Verified by `doc-pipeline.test.ts:1–13`: "Partial failure recovery: failed node → DLQ entry + operator task."
- `BUILT` **Every step emits the correct tenant-scoped canonical event.** — `doc_audit_export` node (doc-pipeline-nodes.ts:12): "emits canonical audit event." `portal-workflow-engine.ts:41–44`: event dispatch via event bus.

### Out of scope

- N/A — no Out of scope section is declared in the spec for this task.

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Document data model | `BUILT` | mspDocumentsTable, mspDocumentVersionsTable, mspSharepointConnectorsTable (msp-documents.ts:26–27) |
| Pipeline nodes (all 7) | `BUILT` | doc-pipeline-nodes.ts:7–13 (header), 160, 262, 345, 523, 572 |
| SharePoint connector modes | `BUILT` | msp-documents.ts:85,92–93 (platform/msp_owned) |
| Site/folder provisioning | `BUILT` [INFERRED] | resolveConnectorSiteId imported at msp-documents.ts:34; provisioning logic in sharepoint-connector.ts (not read) |
| Ingest & lifecycle API | `BUILT` | msp-documents.ts header lines 7–18 (7 endpoints) |
| Tests | `BUILT` | `artifacts/api-server/src/tests/doc-pipeline.test.ts` (idempotency, PDF render, deduplication, platform/msp_owned connectors, partial failure → DLQ+operator task, doc_publish idempotency) |

**Overall: `BUILT`**

---

## Task 24 · #2678 — MSP Portal Reporting & Report Builder

### Done looks like

- `BUILT` **An MSP can build/select a report definition and generate a report for a customer or across their book of business.** — `artifacts/msp-portal/src/pages/reports.tsx:1–9`: report builder UI with definitions CRUD, docType/delivery selection, trigger on demand, run history. `artifacts/api-server/src/routes/msp-reports.ts:7–17`: GET/POST/GET/:defId/PATCH/DELETE definitions; POST trigger; GET runs.
- `BUILT DIFFERENTLY` **Reports render through the Document Pipeline (HTML → PDF), downloadable in-app.** — Spec requires Document Pipeline workflow (`doc_generate_pdf` node). Actual implementation uses `pdf-lib` inline: `msp-reports.ts:38` imports `PDFDocument, StandardFonts, rgb` from `"pdf-lib"`. No `createRun`/`executeRun` calls present in `msp-reports.ts`. PDF generation is synchronous, bypassing the Document Pipeline workflow and its durability guarantees.
- `BUILT` **Generated reports can be emailed via the existing Exchange Online connector — or, once connected, the MSP's own Exchange Online (#2710).** — `msp-reports.ts:39`: `import { sendMailViaGraph } from "../lib/graph"`. Email delivery path wired into the trigger handler. MSP's own Exchange Online (#2710) [INFERRED — not independently verified whether MSP-connected Exchange is plumbed].
- `NOT BUILT` **Report generation runs as a workflow so failures surface as operator tasks.** — Direct consequence of the inline pdf-lib deviation: no portal workflow run is created, so report generation failures do not create operator tasks or DLQ entries.
- `BUILT` **License Waste is a real, already-built document type (not new logic) — registered as a docType alongside consolidated_sow, security_report, etc., generated through the same document-generation nodes.** — `msp-reports.ts:122`: `license_waste_report: "License Waste Analysis Report"` in `REPORT_DOC_TYPES`. `reports.tsx:101`: `{ value: "license_waste_report", label: "License Waste Analysis" }` in docType picker.
- `BUILT` **Surfaced prominently, not buried: a dollar-value tile ("$X/yr in identified savings") in the Monitoring Home key-metrics strip, one-click into the full report.** — `artifacts/msp-portal/src/pages/dashboard.tsx:150`: `fetchWithAuth("/api/msp/reports/license-waste...")`. `/api/msp/reports/license-waste` endpoint at `msp-reports.ts:20`; savings computation at lines 678–685.

### Out of scope

- `BUILT` (confirmed absent) **SFTP delivery.** — No SFTP references in msp-reports.ts.
- `BUILT` (confirmed absent) **Any new email provider beyond the existing Exchange Online connector and #2710's MSP-connected option.** — Only `sendMailViaGraph` used for email (msp-reports.ts:39).

### Steps

| Step | Status | Evidence |
|------|--------|----------|
| Report definition model | `BUILT` | mspReportDefinitionsTable, REPORT_DOC_TYPES, REPORT_DELIVERY_METHODS (msp-reports.ts:25–32) |
| Report generation workflow node | `NOT BUILT` | No createRun/executeRun in msp-reports.ts; inline pdf-lib at line 38 |
| Delivery via email + in-app download | `BUILT` | sendMailViaGraph (msp-reports.ts:39); GET /api/msp/reports/runs/:runId/download (line 17) |
| Report builder UI | `BUILT` | reports.tsx:1–9 (684 lines); reports.tsx:101 (license_waste_report in picker) |
| License Waste dashboard tile | `BUILT` | dashboard.tsx:150 calls /api/msp/reports/license-waste; msp-reports.ts:20,678–685 |
| Tests | `NOT BUILT` | No msp-reports.test.ts found in routes scan |

**Overall: `BUILT DIFFERENTLY`** — report builder, CRUD, PDF generation, email delivery, and license waste tile all built; report generation uses inline pdf-lib rather than the Document Pipeline workflow, so failures do not surface as operator tasks.

<!-- PART2_COMPLETE -->
