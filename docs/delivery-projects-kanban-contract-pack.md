# Delivery Projects Kanban — contract extraction pack

**Issue:** #4245, part of #3433 (Feature: Move Delivery Projects + live Kanban board to
MSP Console), parent #1571 (EPIC: Portal Admin). Extracted, not authored — every field
below traces to `artifacts/api-server/src/routes/admin-projects.ts` at the commit this
pack was written against, cited to line number. This pack documents the route set
*after* #4245's re-gate landed (`requireAdmin` → `requireCapability("ladder.msp-operator")`
on every route, and the SSE route's inline role check → the same ladder evaluator) — it
is the real, current backend, not the pre-#4245 shape. #4246 (frontend relocation) is
the direct consumer: it moves `ProjectDetail.tsx`, `Projects.tsx`, `KanbanCardModal.tsx`
and `components/kanban/*` from `artifacts/admin-panel/src` into `artifacts/msp-console/src`
and wires them against exactly the routes below.

Source: `artifacts/api-server/src/routes/admin-projects.ts` (1073 lines) — the whole file,
audited route by route for #4245. No route in this file was found to be genuinely
platform-administration-only; every route operates on `projectsTable` / `workflowStepsTable`
/ `kanbanTasksTable` / `projectClosuresTable`, all scoped to one customer's delivery
project, matching #3433's own framing ("project management for a specific customer
belongs [in MSP Console], not Admin Panel"). All 20 HTTP routes plus the one SSE route
moved to the same gate.

**Explicitly out of scope, and not documented here** — two other real systems share
adjacent territory and are deliberately untouched:
- `artifacts/api-server/src/routes/msp-kanban.ts` — the Simple Kanban board (#3773),
  backed by `kanban_buckets`/`kanban_cards`, no shared table with this system.
- `artifacts/api-server/src/routes/portal-delivery-kanban.ts` — the customer-portal
  admin+customer view onto the **same** `kanbanTasksTable` this file uses, but a
  separate route surface (`requireAdmin`/`requireAuth`, not re-gated by #4245) for
  the portal's own UI. Coexists with this file; #4245's scope was admin-projects.ts only.

---

## 1. Auth gate

Every route: `requireCapability("ladder.msp-operator")` (`admin-projects.ts`, all 20
`router.*` registrations). Per `requireAuth.ts`'s `effectiveLegacyRole` promotion, a
legacy `role: "admin"` session still clears this — the gate change is additive (MSP
operators can now reach these routes too), not a narrowing of who already could.

`GET /admin/projects/:id/kanban-events` (SSE, `admin-projects.ts:90-111`) cannot use the
middleware — `EventSource` sends no `Authorization` header, so it verifies a `?token=`
query-param JWT itself, then asks the same evaluator directly:
`userClearsLadderCapability(user, LADDER.mspOperator)` (`admin-projects.ts:106`) — the
identical pattern `msp-sales-offers.ts`'s own SSE route uses for the same capability.
Responses: `401` missing/invalid token, `503` `{ "error": "Authorization is temporarily
unavailable" }` if the RBAC model can't be consulted (fail-closed, not a denial), `403`
`{ "error": "Insufficient privileges" }` if the caller doesn't clear the rung.

Audit rows written by these routes (`auditPrivilegedRead`/`createAuditLog`) now compute
`actorRole` via `resolveAuditActorRole(req.user!)` (was hardcoded `"admin"` /
`"platform_admin"` before #4245 — accurate only while admin was the sole possible
caller; now that MSP operators can reach these routes too, the hardcode would have
misattributed their actions in the audit trail, so it was fixed in the same commit as
the gate change).

## 2. Routes

### Projects

| Method | Path | Line | Notes |
|---|---|---|---|
| GET | `/admin/projects` | 113 | List all projects, `orderBy(desc(createdAt))`. No pagination, no filter. |
| GET | `/admin/projects/:id` | 118 | 404 if not found. Writes `auditPrivilegedRead` (`admin_project_detail_viewed`). |
| POST | `/admin/projects` | 138 | Creates a project; `title`/`clientUserId` required (400 otherwise). If `workflowTemplateId` given, provisions `workflow_steps` + seeds Kanban tasks for the first step from the template (non-fatal on failure, logged). Auto-creates a SharePoint folder if the client has a `sharepointSiteId` (non-fatal). Notifies the client user. Writes `createAuditLog` (`project_created`). Returns 201. |
| PATCH | `/admin/projects/:id` | 293 | Partial update (only defined fields applied). Marking `status: "completed"` auto-revokes all active `client_callback_tokens` for the project (non-fatal on failure). 404 if not found. |
| DELETE | `/admin/projects/:id` | 335 | Cascades: deletes `kanban_tasks`, `workflow_steps`, `documents`, `project_updates` for the project; nulls `project_id` on `client_services`, `contracts`, `invoices`, `reports`; then deletes the project row. 204 on success, 404 if not found, 500 on any failure (whole handler wrapped in try/catch). |
| POST | `/admin/projects/:id/sharepoint-folder` | 259 | Manual folder creation for a project that has none yet. 409 if a folder already exists, 400 if no client assigned or client has no SharePoint site, 502 if Graph creation fails. |
| GET | `/admin/projects/:id/report-autofill` | 918 | **No live frontend caller found anywhere in the repo (grepped `artifacts/**` for `report-autofill` and `autofill`)** — filed as a finding, see §4. Returns project/client summary + completed/pending steps + completed tasks (optionally since a `?since=` date) for status-report drafting. Writes `auditPrivilegedRead` (`admin_project_report_autofill_viewed`). |
| POST | `/admin/projects/:id/closure-request` | 1018 | Only valid when `project.status === "completed"` (422 otherwise). 409 if a closure already exists for the project. Creates a `project_closures` row and emails the client the `closure-request` template. |
| GET | `/admin/projects/:id/closure` | 1054 | 404 if no closure row exists yet. Writes `auditPrivilegedRead` (`admin_project_closure_viewed`). |

### Workflow steps (project phases)

| Method | Path | Line | Notes |
|---|---|---|---|
| GET | `/admin/workflow-steps` | 362 | Filter by `?projectId=` or `?clientServiceId=` (mutually exclusive precedence: projectId wins if both given), `orderBy(order)`. |
| POST | `/admin/workflow-steps` | 412 | Ad-hoc single-step create. `title` required. |
| POST | `/admin/workflow-steps/bulk` | 379 | Bulk-create steps for a project; appends after existing max `order`. 400 if `projectId` missing or any step lacks a `title`. |
| PATCH | `/admin/workflow-steps/:id` | 430 | Partial update. Setting `status: "completed"` stamps `completedAt`. Side effects: emits `phase.delivery_date_changed` when `dueDate` changes, `phase_completed` when status becomes `"completed"` (both non-fatal, best-effort), and calls `seedKanbanCardsForPhase()` when status becomes `"in_progress"` (auto-populates that phase's template tasks into the Kanban backlog). Writes `createAuditLog` (`workflow_step_changed`) when `status` is part of the patch. |
| DELETE | `/admin/workflow-steps/:id` | 372 | Unconditional delete, no existence check before delete (returns `{ deleted: id }` regardless). |

### Kanban tasks (the live board)

| Method | Path | Line | Notes |
|---|---|---|---|
| GET | `/admin/kanban-tasks` | 533 | `?projectId=` required (400 otherwise). Enriches each task's `taskMetadata.linkedRunbook` on the fly by best-effort title-similarity match (Jaccard ≥ 0.30) against the originating workflow-template-step's tasks, resolving `runbookId` against `powershell_scripts` then `script_modules` (§3 — not persisted, computed per-request). Writes `auditPrivilegedRead` (`admin_project_kanban_viewed`). |
| POST | `/admin/kanban-tasks` | 661 | `projectId` + `title` required. Recomputes the project's `progress` (`syncProjectProgress`). Writes `createAuditLog` (`kanban_task_created`). Broadcasts `{ action: "created", task }` over SSE to the project's channel. Returns 201. |
| PATCH | `/admin/kanban-tasks/:id` | 701 | Partial update; `taskMetadata` is **deep-merged** with the existing value (`deepMerge`, `admin-projects.ts:69-88`), not replaced — pass `taskMetadata: null` to clear it entirely. Moving `column` to `"completed"` triggers `advancePhaseIfComplete()` (may spawn follow-on tasks, each separately broadcast). Always recomputes project progress. Audit action varies by which field changed: `kanban_task_closed`/`kanban_task_moved` (column), `kanban_task_due_date_set` (dueDate — also emits `milestone.delivery_date_changed` if the value actually changed), or `kanban_task_updated` (title/description/priority) — **only one** of these fires per request, whichever branch matches first (column → dueDate → title/description/priority), so a request that changes both e.g. `column` and `title` in one PATCH audits only the column change. Always broadcasts `{ action: "updated", task }`. |
| DELETE | `/admin/kanban-tasks/:id` | 908 | No 404 if the task doesn't exist — silently no-ops the delete and skips progress-sync/broadcast (only runs `if (existing?.projectId)`). Returns `{ deleted: id }` either way. |
| POST | `/admin/kanban-tasks/:id/checklist/:itemId/completion-schema` | 805 | AI-generated closure-question schema (Claude Haiku 4.5, `@workspace/integrations-anthropic-ai`) for one checklist item on a task. 404 if task or checklist item not found. On any AI/parse failure, returns `{ fields: [] }` (200, never surfaces the failure as an error status) — logged as a `warn`. |
| PATCH | `/admin/kanban-tasks/:id/checklist/:itemId` | 863 | Sets `taskMetadata.checklistState[itemId] = checked` (boolean, required in body). If `closureData` is given, also stores `taskMetadata.checklistItemData[itemId] = { schema, answers, capturedAt }`. Returns only `{ taskMetadata: updated.taskMetadata }`, not the full task. |

## 3. Real gaps and known-fragile behavior (as-built, not changed by #4245)

- **`linkedRunbook` resolution is fuzzy, not a stored link.** `GET /admin/kanban-tasks`
  (`admin-projects.ts:536-646`) recomputes this on every request by matching task titles
  against template-task titles with a word-Jaccard similarity threshold of 0.30 — a
  coincidental title match above that bar attaches a wrong runbook; below it, a real
  linked runbook silently doesn't show. Nothing persists the match once computed.
- **`DELETE /admin/kanban-tasks/:id` never reports "not found."** It always returns
  `{ deleted: id }`, even for a nonexistent id.
- **`PATCH /admin/kanban-tasks/:id`'s audit action is "whichever branch matches
  first,"** not "every field that changed" — see the table row above.
- **`DELETE /admin/workflow-steps/:id`** has no existence check either.

## 4. Finding filed

`GET /admin/projects/:id/report-autofill` (`admin-projects.ts:918`) has no caller
anywhere in the repo — verified by grepping `artifacts/**/*.{ts,tsx}` for both
`report-autofill` and the looser `autofill` (only hits: this route's own file, and two
unrelated marketing/purchase-flow files using "autofill" in an unrelated sense). It is a
live, working endpoint (project/client summary + completed/pending steps + tasks for
status-report drafting) with zero UI wired to it. Filed as #4248, sibling sub-issue of
#3433, labeled `bug`.
