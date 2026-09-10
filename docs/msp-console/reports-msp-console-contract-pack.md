# Reports (MSP Console) — contract extraction pack

**For Claude Design. Extracted, not authored — every claim below is cited to file:line against
the code on `main`.** Read-only build: no product code, no schema, no UI were changed to produce
this document. No genuinely-half-built route was found (see §0 completeness audit); one real
naming/pagination gap was found in §7 and filed separately, not fixed in this pass.

Module: **Reports (MSP Console)**, leaf issue #3369, parented directly to **#1571 EPIC: Portal
Admin — MSP-side operator surface** (no Feature-tier issue exists between #3369 and #1571; the
`gh issue list --search "Feature: Reports"` sweep run for this pack returned nothing). There is
**no prior pack** for this module — a repo-wide search of `docs/msp-console/` found the module
named only incidentally, as a pattern example, inside other packs' prose (never a real,
comprehensive extraction of its own routes).

Source file: **`artifacts/api-server/src/routes/msp-reports.ts`** — 979 lines, 19 routes (all real
and reachable; counted below). Mounted `router.use(mspReportsRouter)`
(`artifacts/api-server/src/routes/index.ts:558`, import `:224`), itself mounted at
`app.use("/api", subscriptionGate, router)` (`artifacts/api-server/src/app.ts:127`) — so every
path in §1 below is the real, full path, gated by `subscriptionGate` ahead of the router-level
`requireRole` checks.

**This module is not orphaned — it is genuinely, partially wired.** Unlike the msp-executive
module (#2657's pack), a real caller exists today:
**`artifacts/admin-panel/src/pages/MspReports.tsx`**, registered at admin-panel route `/msp/reports`
(`App.tsx:415`, nav entry `workspaceNav.tsx:227`, `AdminRoute`-gated). It calls exactly **4 of the
19 routes** — see §6 for the live/orphaned split by route.

---

## 0. The 19 routes, grouped, with a completeness verdict

| Group | Routes | Auth | Live UI caller? |
|---|---|---|---|
| **Report Definitions** (CRUD) | `GET .../definitions`, `POST .../definitions`, `GET .../definitions/:defId`, `PATCH .../definitions/:defId`, `DELETE .../definitions/:defId` | MSPOperator (DELETE: **MSPAdmin**) | list: yes; create/get-one/patch/delete: no |
| **Report Runs** | `POST .../definitions/:defId/trigger`, `GET .../runs`, `GET .../runs/:runId`, `GET .../runs/:runId/download` | MSPOperator | trigger, list, download: yes; get-one-by-id: no |
| **License Waste** | `GET .../license-waste` | MSPOperator | no |
| **Custom Canvases** | `GET .../canvases`, `POST .../canvases`, `PUT .../canvases/:id`, `DELETE .../canvases/:id`, `POST .../canvases/:id/send-test` | MSPOperator | no |
| **Canvas Schedules** | `GET .../schedules`, `POST .../schedules`, `PUT .../schedules/:id`, `DELETE .../schedules/:id` | MSPOperator | no |

5 + 4 + 1 + 5 + 4 = **19**, matching the file header's own count (`msp-reports.ts:6-21`).

**Completeness verdict: every route is fully implemented, not a stub.** Each has a real DB
read/write, real validation (`REPORT_DOC_TYPES`/`REPORT_DELIVERY_METHODS` enum checks on create,
`404`/`400` on missing rows/fields), and a real `try/catch` → `log.error` → `500` fallback. Nothing
in the file is a `TODO`, a `NotImplementedError`, or a route that only echoes its input. The one
real gap found (§7) is a response-shape naming issue, not an unfinished route.

---

## 1. Report Definitions — CRUD

### 1a. `GET /api/msp/reports/definitions` — list (`:144-174`)

Auth: `requireRole("MSPOperator")` (`:146`) — MSPOperator or above per `ROLE_ORDER`
(`middlewares/requireAuth.ts:81-88`: `MSPOperator` < `MSPAdmin` < `PlatformAdmin`; legacy
`role: "admin"` users are treated as `PlatformAdmin`, `:105`). `mspId` is
`resolveMspIdStrict(req)` (`:149`, `resolve-msp-id.ts:75-77`) — **`req.user?.mspId ?? null`,
never a query override, not even for PlatformAdmin** (this is the "session-only" resolver; a
`?mspId=` override exists only on the separate `resolveMspId`/`resolveMspIdOrZero` helpers, not
used anywhere in this file). `null` → `403 { error: "MSP context required" }` (`:150-153`) — this
exact shape recurs verbatim at every other route in the Definitions/Runs/License-Waste groups;
the Canvases/Schedules groups use the equivalent `403 { error: "No MSP context" }` (a different
literal string — see §7).

Optional `?customerId=` narrows to one customer within the MSP (`:154-160`). Returns the **full
raw row** (`db.select().from(mspReportDefinitionsTable)`, `:162-166`) — every column in the schema
(§2) is on the wire, ordered `desc(createdAt)`.

**Response**: `{ definitions: MspReportDefinition[], total: number }` (`:168`) — `total` here is
accurate (`defs.length`, no pagination limit on this route) but see §7 for the *inconsistent*
sibling on Runs.

### 1b. `POST /api/msp/reports/definitions` — create (`:178-234`)

Auth: MSPOperator. Body: `{ name (required), description?, docType = "executive_summary",
deliveryMethod = "in_app", deliveryEmail?, customerId?, fieldMappings = {}, scheduleConfig = {} }`
(`:189-197`). Validation, in order: `name` required → `400` (`:199`); `docType` must be one of
**8 real values** (§3) → `400` with the valid list echoed in the message (`:200-203`);
`deliveryMethod` must be one of 3 real values → same shape (`:204-207`). `createdByUserId` is
`user.id ?? 0` (`:209`) — **falls back to `0`, not a caller error**, if the authenticated user
somehow has no `id` (should not occur in practice; no route/schema constraint enforces
`createdByUserId` as a real FK — see schema note in §2). Returns `201 { definition }` (`:228`).

### 1c. `GET /api/msp/reports/definitions/:defId` (`:238-267`), `PATCH .../:defId` (`:271-306`),
`DELETE .../:defId` (`:310-339`)

GET/PATCH: MSPOperator. **DELETE requires `requireRole("MSPAdmin")`** (`:312`) — the one route in
this whole file with a stricter gate than its siblings; deleting a definition is a strictly
higher-privilege action than creating or editing one.

- GET: `defId` + `mspId` scoped lookup, `404 { error: "Report definition not found" }` on miss
  (`:260`).
- PATCH: allow-listed field set — `["name", "description", "docType", "deliveryMethod",
  "deliveryEmail", "fieldMappings", "scheduleConfig", "isActive", "customerId"]` (`:283`), any
  other body key is silently dropped (not a `400`), `updatedAt` always bumped (`:284`). **No
  server-side re-validation of `docType`/`deliveryMethod` on PATCH** — unlike POST (`:200-207`),
  an update can set either field to an arbitrary string with no enum check; the Postgres column's
  own `text(..., { enum: [...] })` constraint (schema, §2) is the only backstop, and Drizzle's
  `enum` option is a **TypeScript-only** narrowing, not a Postgres `CHECK` constraint — an invalid
  value would only fail if the underlying column type enforces it, which a plain `text` column
  does not. Design should not assume PATCH is validated identically to POST.
- DELETE: **soft delete** — `UPDATE ... SET isActive = false` (`:322-324`), never a real row
  delete. Returns `{ ok: true }` (`:333`), not the deleted row.

All three share the same `404 { error: "Report definition not found" }` shape on a scope/id miss.

---

## 2. Schema — the four real tables

### `msp_report_definitions` (`lib/db/src/schema/msp.ts:3414-3438`)

| Column | Type | Nullability | Note |
|---|---|---|---|
| `id` | `serial` | PK | internal only, never the wire id |
| `definitionId` | `uuid`, unique, `defaultRandom()` | never null | **the real wire id** (`:defId` param) |
| `mspId` | `integer`, FK → `msps.id` `ON DELETE CASCADE` | never null | |
| `customerId` | `integer` | **nullable** | `tenants.id`, **no FK by design** — comment (`:3419`) cites the Phase 7 audit: successor id-space after Phase 0 absorbed `msp_customers`; null = "across all customers" |
| `name` | `text` | never null | |
| `description` | `text` | nullable | doubles as the AI prompt override text (`report-nodes.ts:261`) |
| `docType` | `text` enum (§3) | never null, default `"executive_summary"` | |
| `deliveryMethod` | `text` enum (§3) | never null, default `"in_app"` | |
| `deliveryEmail` | `text` | nullable | to-address for email delivery |
| `fieldMappings` | `jsonb` | never null, default `{}` | free-form AI prompt context, no fixed shape |
| `scheduleConfig` | `jsonb` | never null, default `{}` | **defined on the schema but never read anywhere in `msp-reports.ts` or `report-nodes.ts`** — see §7 |
| `isActive` | `boolean` | never null, default `true` | DELETE flips this false |
| `createdByUserId` | `integer` | never null | **no FK** — see §1b |
| `createdAt` / `updatedAt` | `timestamp tz` | never null | |

### `msp_report_runs` (`:3450-3486`)

| Column | Type | Nullability | Note |
|---|---|---|---|
| `id` | `serial` | PK | internal |
| `runId` | `uuid`, unique | never null | **the real wire id** |
| `definitionId` | `uuid`, FK → `msp_report_definitions.definitionId` `ON DELETE CASCADE` | never null | |
| `mspId` | `integer`, FK → `msps.id` `CASCADE` | never null | |
| `customerId` | `integer` | nullable | same no-FK convention as above |
| `title` | `text` | never null | computed at trigger/generation time, not user-supplied |
| `docType` | `text` enum (§3) | never null | copied from the definition at trigger time |
| `status` | `text` enum — `ReportRunStatus` (§3) | never null, default `"pending"` | |
| `htmlContent` | `text` | nullable | never returned by list/get routes — only `download` selects it |
| `pdfBase64` | `text` | nullable | same — download-only |
| `pdfSizeBytes` | `integer` | nullable | |
| `deliveredAt` | `timestamp tz` | nullable | |
| `deliveryEmail` | `text` | nullable | actual send-to, may differ from the definition's configured `deliveryEmail` if overridden mid-flow |
| `errorMessage` | `text` | nullable | non-null only when `status = "failed"`, or (real edge case, §4) when email delivery failed but the run is still `"generated"` |
| `workflowRunId` | `uuid` | nullable | **defined on schema, never set anywhere** — `report-nodes.ts` never writes it despite running through `createRun`/`executeRun`; see §7 |
| `triggeredByUserId` | `integer` | nullable | |
| `generatedAt` | `timestamp tz` | nullable | |
| `rbdVersionUid` | `uuid` | nullable | **#1512-only** — set only for `docType = "risk_decision_document"` runs; see §5 |
| `createdAt` / `updatedAt` | `timestamp tz` | never null | |

`htmlContent`/`pdfBase64`/`workflowRunId`/`rbdVersionUid` are **never on the `GET runs` or
`GET runs/:runId` wire response** — both routes use an explicit column list (`:447-462`,
`:491-506`) that omits all four. Only `GET runs/:runId/download` selects `pdfBase64`/`htmlContent`
(`:539-547`), and neither of those two heavy fields is ever returned as JSON — only as the binary
PDF body.

### `msp_report_canvases` (`:4393-4404`) / `msp_report_schedules` (`:4410-4424`)

Both `uuid` primary keys (`defaultRandom()`), both scoped by `mspId` FK `CASCADE`. Canvas:
`canvasLayout` (`jsonb`, shape in §4), `deliveryConfig` (`jsonb`, typed
`{ sendAsHtmlEmail: boolean; attachPdf: boolean; recipientType: "msp_admin" | "customer_contacts" }`,
default `{ sendAsHtmlEmail: false, attachPdf: true, recipientType: "msp_admin" }`). Schedule:
`canvasId` FK → `msp_report_canvases.id` `CASCADE`, `cadence` enum `"daily" | "weekly" | "monthly"`,
`recipientEmails` (`text[]`, default `[]`), `enabled` (default `true`), `lastRunAt`/`nextRunAt`
(both nullable, **written nowhere in this file** — no cron/scheduler consumer exists yet; see §7).

---

## 3. Real enum unions — no invented vocabulary

- **`REPORT_DOC_TYPES`** (`msp.ts:3394-3408`) — **8 real values**: `executive_summary`,
  `full_readiness_report`, `security_posture_report`, `governance_maturity_report`,
  `data_exposure_risk_report`, `license_optimization_report`, `license_waste_report`,
  `risk_decision_document`. The last is #1512's RBD render type — its own comment (`:3402-3406`)
  states it is "never an AI generation," a deterministic template render stored through the same
  table for machinery reuse only (§5).
- **`REPORT_DELIVERY_METHODS`** (`:3411`) — `in_app | email | both`.
- **`ReportRunStatus`** (`REPORT_RUN_STATUSES`, `:3447`) — 6 values: `pending`, `generating`,
  `generated`, `delivering`, `delivered`, `failed`. `msp-reports.ts`'s own download route only
  special-cases 3 of the 6 explicitly (`pending`/`generating` → `409`, `failed` → `422`, `:557-564`);
  `generated`, `delivering`, `delivered` all fall through to "serve whatever content exists," which
  is correct for `generated`/`delivered` (content exists) but means a run caught mid-`delivering`
  (content already written before the email-send step, per `report-nodes.ts:293-304`) is also
  downloadable — not a bug, `delivering` genuinely has content by that point in the flow.
- **`DOC_TYPE_LABELS`** — defined **identically** in three places: `msp-reports.ts:132-140`,
  `report-nodes.ts:145-153`, and `admin-panel/.../MspReports.tsx:129-137` (the last one's
  `license_waste_report` label reads `"License Waste Analysis"` vs. the other two's `"License
  Waste Analysis Report"` — a one-word display-string drift between server and client copies of
  the same map; cosmetic only, not a wire contract mismatch since the client always uses its own
  copy to render).
- **Canvas widget `type`** (`compileReportToHtml.ts:187-198`) — exactly 4 real values:
  `billing`, `open_items`, `telemetry`, `rich_text`. Anything else renders a visible
  `"Unknown Widget Type: {type}"` box (`:197`) rather than erroring — **do not invent a 5th widget
  type** in Design without a corresponding `renderWidget` branch.
- **Canvas `deliveryConfig.recipientType`** — `"msp_admin" | "customer_contacts"` (schema type
  only; **no route reads or branches on this field** — `send-test` always resolves the recipient
  from the request body/query or the caller's own JWT email, never from `deliveryConfig`; see §7).

---

## 4. Trigger → async generation flow (the module's real spine)

`POST /api/msp/reports/definitions/:defId/trigger` (`:343-421`), MSPOperator. Loads the
definition scoped to `mspId`; `404` if missing, `400 { error: "Report definition is inactive" }`
if `isActive` is false (`:367`) — **the one route that checks `isActive` before acting**; nothing
stops a caller from `PATCH`ing a definition back to `isActive: true` and re-triggering, by design.

Title is computed server-side (`:369-374`): `"{docTypeLabel} — {customerName}"` if scoped to a
customer, else `"{docTypeLabel} — Portfolio"` — **never client-supplied**, so any UI showing a
run's title is always showing this exact server-derived string.

**Response is `202`, fired before the real work happens** (`:394`) — `{ runId, title, status:
"pending" }`. The `msp_report_runs` row is inserted (status `"pending"`) *before* the response is
sent (`:378-391`); everything after `res.status(202).json(...)` (`:394`) runs in a fire-and-forget
`void (async () => {...})()` IIFE (`:398-415`) — **any error inside it is only logged
(`log.error`, `:413`), never surfaces to the original caller**, who has already received `202`.
The only way a client learns of a downstream failure is by polling `GET .../runs/:runId` (or
`.../runs`) and observing `status: "failed"`.

That async block:
1. `ensureReportGenWorkflow()` (`:53-61`) — idempotent upsert of the `msp.report.generation`
   workflow row into `portal_wf_workflows`, called on **every** trigger (not once at boot) —
   confirmed live: 0 rows currently exist in `portal_wf_workflows` (§8), because no trigger has
   ever fired against local dev data.
2. `createRun()` + `executeRun()` (Portal Workflow Engine) with `inputPayload: { reportRunId,
   definitionId, triggeredByUserId }` — `reportRunId` is exactly the UUID from the row inserted in
   step (`:378-391`)'s `run.runId`, which is how `report-nodes.ts`'s handler (§5) knows to
   **update** that row rather than insert a second one.
3. The actual generation, retry policy, and DLQ/operator-task routing on exhaustion all live in
   `report-nodes.ts` + the shared Portal Workflow Engine (`portal-workflow-engine.ts`) — out of
   this file, documented in §5.

---

## 5. `generate_report` node handler — what actually produces the PDF

Source: `artifacts/api-server/src/lib/report-nodes.ts`, registered as node type
`"generate_report"` (`registerReportNodes()`, `:397-399`). Two operating modes (module header,
`:170-176`): **(a)** pre-created run — the API trigger path above, updates the existing `pending`
row; **(b)** self-created run — an event-driven/direct workflow invocation with no
`reportRunId`, inserts a fresh row at `status: "generating"`. `msp-reports.ts`'s trigger route
only ever exercises mode (a).

Flow once dispatched (`:177-378`): load definition → resolve customer/MSP names → flip row to
`"generating"` → build an AI prompt (contextBlock includes `fieldMappings` verbatim, or a
canned "generate from general M365 best practices" fallback line when empty, `:253-256`) → call
**`claude-haiku-4-5`**, `max_tokens: 4096` (`:272-277`, matching this codebase's standard Haiku
convention used across `ai-analyzer.ts`, `classify-task-type.ts`, `workflow-executor.ts`, etc. —
not a stale/one-off model string) → strip an optional ```` ```html ```` code fence if present
(`:285-286`) → `stripHtml()` → build a real PDF via `pdf-lib` (`generatePdfBuffer`, `:96-141`,
byte-for-byte the same text-wrapping/pagination approach as `msp-reports.ts`'s own `buildPdf`
helper, `:100-130` — two independent copies of the same PDF renderer, one for fresh generation,
one for the download route's HTML-fallback regeneration path) → persist `status: "generated"` +
`htmlContent` + `pdfBase64` + `pdfSizeBytes` + `generatedAt` (`:293-304`).

**Delivery branch** (`:306-352`):
- `deliveryMethod` is `"email"`/`"both"` **and** both `def.deliveryEmail` and
  `process.env.GRAPH_MAIL_USER_ID` are set → flips to `"delivering"`, sends via
  `sendMailViaGraph()` (Exchange Online / Graph — this codebase never uses Resend, confirmed no
  such import anywhere in this file or `report-nodes.ts`), then `"delivered"` with
  `deliveredAt`/`deliveryEmail` set.
- Email send throws → **caught, non-fatal** (`:331-338`): run is set back to `"generated"` (not
  `"failed"`) with `errorMessage: "Email delivery failed: {err}"` — **the PDF remains
  downloadable in-app even though the configured email delivery silently failed.** A UI polling
  for `status` alone would show a *successful*-looking `"generated"` state with no visible signal
  that the email leg failed unless it also surfaces `errorMessage` on a non-`"failed"` row —
  today's Admin Panel page (§6) only shows `errorMessage` in the `status === "failed"` branch
  (`MspReports.tsx:424-434`), so **this specific failure mode is invisible in the current UI.**
  Real, reachable gap — filed as a finding (§8).
- Otherwise (`in_app`, or `email`/`both` missing a required config value) → straight to
  `"delivered"` with no email sent.

**On any unhandled error** (`:363-377`): if a `runId` was ever resolved, the row is set to
`"failed"` with `errorMessage: String(err)`; the error is always re-thrown so the Workflow Engine
applies its retry policy and, on exhaustion, writes a DLQ entry (`mspDlqStoreTable`) and an
operator task (`portalWfOperatorTasksTable`) — confirmed by real, non-mocked-outcome assertions in
`msp-reports.test.ts:365-512` (`describe("executeRun failure path — DLQ + operator task writes")`)
that call the real engine `executeRun()`, not just check the handler's return shape.

**The `risk_decision_document` doc type is a second, independent writer of these same two
tables** — `artifacts/api-server/src/lib/rbd-document-render.ts` (#1512), never routed through
`msp-reports.ts`'s trigger endpoint or the workflow engine at all:

- `ensureRbdDocumentDefinition()` (`rbd-document-render.ts:148-168`) lazily finds-or-creates **one**
  `msp_report_definitions` row per MSP with `docType: "risk_decision_document"`, attributed to
  whichever real MSP staff user first triggers an RBD render — its own comment states plainly
  (`:144-147`) this definition is "never user-facing on its own," though nothing prevents
  `msp-reports.ts`'s `GET .../definitions` from listing it like any other row (it has no special
  marker distinguishing it beyond `docType`).
- `renderAndPersistRbdVersionDocument()` (`:184-237`) renders deterministically (HTML template +
  `htmlToPdf`, **not** `pdf-lib`/AI) and **UPDATEs the existing run row in place** if one already
  exists for that `rbdVersionUid` (`:200-215`), rather than appending a new run each time — one
  `msp_report_runs` row per RBD **version**, so re-rendering after a signature is applied reflects
  the version's current signed state rather than serving a stale pre-signature snapshot. Only
  inserts a new run (`:220-233`) the first time a given version is rendered.
- The customer/public read paths (`msp-rbd-versions.ts`, out of scope for this pack) only ever
  call `getPersistedRbdVersionDocument()` (`:241-`) — a pure read, never triggering a render.

**Design implication**: `GET /api/msp/reports/runs` for an MSP that has ever rendered an RBD
document will include `risk_decision_document` rows mixed in among AI-generated report runs,
always at `status: "generated"` (never `"pending"`/`"generating"`/`"delivering"`/`"failed"` — RBD
rendering is synchronous and has no email-delivery leg), with `rbdVersionUid` populated (though
never surfaced on the wire — §2). Do not design the Runs list as if every row came from the
trigger/AI-generation flow in §4.

---

## 6. Live vs. orphaned — route-by-route

**Wired today**, via `artifacts/admin-panel/src/pages/MspReports.tsx` (route `/msp/reports`,
`App.tsx:415`, nav `workspaceNav.tsx:227`):

| Route | Caller usage |
|---|---|
| `GET .../definitions` | `fetchDefinitions()` on mount + manual Refresh (`MspReports.tsx:158-169`) |
| `POST .../definitions/:defId/trigger` | `triggerReport()` / `retryRun()` — both call the exact same endpoint, "retry" is just re-triggering the same definition (`:210-246`) |
| `GET .../runs` | `fetchRuns()` on mount + manual Refresh + a **4-second poll** while any run is non-terminal (`:191-206`, `STATUS_TERMINAL = {delivered, generated, failed}`) |
| `GET .../runs/:runId/download` | `downloadPdf()`, client-side blob download (`:250-267`) |

The page's own header copy states this plainly: *"Reports are built asynchronously via the
workflow engine — failures land in the DLQ and create an operator task automatically"*
(`MspReports.tsx:280-281`) — matching §5 exactly.

**Real user identity behind this page**: `useAdminFetch()` forwards to `AuthContext`'s
platform-admin `fetchWithAuth` (`useAdminFetch.ts`) — the one seeded `role: "admin"` user
(`users.id = 1`, `shane@shanemccaw.com`) carries `msp_id = 1` on the `users` row itself
(confirmed live, §8), so `resolveMspIdStrict` resolves real MSP 1 (Shane McCaw Consulting) scope
for this page **without any `?mspId=` override** — the strict resolver ignores query params even
for PlatformAdmin (§1a). A PlatformAdmin login whose own `users.mspId` were ever null would get a
`403 { error: "MSP context required" }` on every one of this page's calls; that is real,
reachable behavior of this resolver, not specific to this module.

**Never called by any UI in this repo** (confirmed: a repo-wide search of `artifacts/admin-panel`
and `artifacts/msp-portal` for `reports/definitions/:defId` (GET one/PATCH/DELETE, beyond list),
`reports/license-waste`, `reports/canvases`, and `reports/schedules` returns nothing outside
`msp-reports.ts` itself and its test file):

- `POST/GET-one/PATCH/DELETE .../definitions` — creating, inspecting, editing or deleting a
  single definition has no UI; the Admin Panel page only ever lists and triggers. The page's own
  empty-state copy (`MspReports.tsx:306-308`) says as much: *"No report definitions found. Create
  one via the API or the MSP Portal"* — an aspirational cross-reference to an MSP Portal surface
  that, per §0/§6, does not itself call any of these routes either.
- `GET .../runs/:runId` — the single-run detail route is real and correct (§2) but nothing reads
  it; the Admin Panel always re-fetches the whole `GET .../runs` list instead.
- `GET .../license-waste` — a fully-built KPI query (real SQL join across `tenants` →
  `client_m365_profiles`, `:600-679`) with **zero UI consumer anywhere in the repo.** Live data:
  `client_m365_profiles` has 0 rows locally (§8) — this route would honestly return `hasData:
  false` today even if wired.
- **All 5 Custom Canvas routes and all 4 Canvas Schedule routes** — fully built (real CRUD,
  real Exchange Online test-send via `compileReportToHtml()`, §7's `send-test` behavioral tests
  pass against the real route), **zero UI anywhere calls any of them.** This is the module's
  largest orphaned surface by route count (9 of 19).

---

## 7. Real gaps found during extraction (documented, not fixed here)

1. **`total` on `GET .../runs` is not a real total — filed as a finding.** `GET .../definitions`
   applies no limit, so its `total: defs.length` (`:168`) is accurate. `GET .../runs` caps at
   `Math.min(Number(query.limit ?? 50), 100)` (`:435`) with **no `offset`/page param at all**, yet
   returns `total: runs.length` (`:468`) — literally the count of the page just returned, capped
   at the same limit. An MSP with more matching runs than the active limit sees `total` silently
   equal the limit, with no field anywhere on the response indicating more rows exist beyond it.
   Currently latent (0 real runs exist anywhere, §8) but a real, reachable naming/shape defect the
   moment volume exists — Design should not treat `total` on this endpoint as the count of all
   matching rows.
2. **`scheduleConfig` (definitions) and `lastRunAt`/`nextRunAt` (schedules) are schema-only,
   write-nowhere fields.** No route in this file ever sets `scheduleConfig` beyond accepting it
   opaquely on create/patch, and nothing reads it to actually schedule anything — the "Workflow
   schedule/trigger config" comment on the column (`msp.ts:3429`) describes an intent no code
   implements. Symmetrically, `msp_report_schedules.lastRunAt`/`nextRunAt` are defined for a
   cron-style consumer that does not exist in this codebase yet — the 4 Schedule routes are pure
   CRUD with no execution engine behind the `cadence` value. Do not design a "next scheduled send"
   display against `nextRunAt` — it is never populated.
3. **`deliveryConfig.recipientType` is typed but unused.** `send-test` (`:794-863`) always
   resolves its recipient from `req.body.customerId`/`.recipientEmail`/`.email`/query params, or
   the caller's own JWT `email` — never from the canvas's own `deliveryConfig.recipientType`
   (`"msp_admin" | "customer_contacts"`). A real production send flow keyed off that field (e.g.
   an actual scheduled `weekly` cadence run) does not exist to consult it either (see point 2) —
   the field currently has no code path that reads it at all.
4. **Silent email-delivery failure is invisible in the current UI** — traced in full in §5. Not a
   route bug (the API shape is honest: `status: "generated"` + a populated `errorMessage` is a
   real, distinguishable state), but the one live consumer of this data (`MspReports.tsx`) only
   ever surfaces `errorMessage` when `status === "failed"`, so a `"generated"`-with-error row shows
   as a plain success today.

Per this repo's finding-filing convention, items 1 and 4 above (real, currently-live-reachable UX
gaps) are filed as GitHub issues against #1571 (this issue's own parent — no Feature-tier issue
exists between #3369 and #1571, confirmed by an issue-search sweep) — see the completion comment
on #3369 for the real issue numbers. Items 2 and 3 are recorded here as honest schema/behavior
facts for Design to route around, not filed separately — they describe capability that was never
built (no scheduler, no recipient-type branching) rather than a built feature behaving wrong, and
nothing today asks a user to configure either field expecting it to do something.

---

## 8. Live-data snapshot (queried this session, local `DATABASE_URL`, 2026-09-10)

| Table / condition | Count | Note |
|---|---|---|
| `msp_report_definitions` | **0** | no definition has ever been created on this local DB — the wired Admin Panel page's own empty state (§6) is what a real call returns today |
| `msp_report_runs` | **0** | no trigger, and no RBD render (§5), has ever run locally |
| `msp_report_canvases` | **0** | |
| `msp_report_schedules` | **0** | |
| `portal_wf_workflows` where `workflow_key = 'msp.report.generation'` | **0** | `ensureReportGenWorkflow()` (§4) has never fired — it only upserts on a real trigger call, and none has happened |
| `client_m365_profiles` where `(profile->>'hasLicensingWaste')::boolean = true` | **0** | `GET .../license-waste` would honestly return `hasData: false, estimatedAnnualSavings: 0` for MSP 1 right now |
| `client_m365_profiles` (all rows) | **0** | no M365 profile data has been ingested locally at all |
| `users` with `role = 'admin'` | 1 (`id 1`, `shane@shanemccaw.com`, `msp_id = 1`) | the real identity behind the wired Admin Panel page, §6 |
| `tenants` | 2 (`id 1` "Jane Jane", `id 3` "Test Me", both `msp_id = 1`) | real customers a definition could be scoped to |
| `msps` | 2 (`id 1` "Shane McCaw Consulting", `id 1626` "Regression Testbed MSP (billing lifecycle)") | |

So, as of this pack: every route in this module returns its honest empty state on a real call
today — `{ definitions: [], total: 0 }`, `{ runs: [], total: 0 }`, `{ canvases: [], total: 0 }`,
`{ schedules: [], total: 0 }`, and the license-waste zeroed shape — not because any route is
broken, but because no report has ever been defined, triggered, or rendered against this local
database. Design must draw both the populated and empty states for every list.

---

## 9. Forbidden list — do not draw, do not invent

- **No pagination on any list route beyond Runs' single `limit` cap.** Definitions, Canvases, and
  Schedules return every matching row, always — do not design a "load more" control for those
  three without a corresponding backend change. Runs has a `limit` (default 50, max 100) but **no
  offset** — see §7's finding; do not design a page-2 control against it as it exists today.
- **No canvas versioning, no schedule history, no run retry-count.** Canvases/Schedules are
  overwritten in place on `PUT`; there is no prior-version list to design against. A "Retry" in
  the Admin Panel UI is literally a brand-new `trigger` call, not a re-run of the same failed
  attempt — there is no concept of "attempt 2 of run X" anywhere in the schema or routes.
- **No customer-facing surface for any of this.** Every route in this file is
  MSPOperator/MSPAdmin-gated; nothing here is reachable from `artifacts/msp-portal`
  (a customer-facing app) at all, confirmed by the same repo-wide search in §6.
- **Do not invent a scheduled-send display.** `cadence`/`recipientEmails`/`enabled` on a Schedule
  are real, persisted columns — but nothing executes them (§7 point 2). A "Next report: {date}"
  UI element has no `nextRunAt` value to read from in practice.
- **Do not design against `workflowRunId`.** The column exists on the schema (§2) specifically so
  a run row could point back at its workflow-engine run, but `report-nodes.ts` never writes it —
  it is always `null` in practice.

---

## Sources

- `artifacts/api-server/src/routes/msp-reports.ts` (all 19 routes)
- `artifacts/api-server/src/tests/msp-reports.test.ts` (real `executeRun`/DLQ/operator-task
  assertions; the only 3 route-level HTTP tests that exist, all for `send-test`)
- `artifacts/api-server/src/lib/report-nodes.ts` (`generate_report` node handler, §5)
- `artifacts/api-server/src/lib/compileReportToHtml.ts` (canvas widget rendering, §3/§6)
- `artifacts/api-server/src/lib/resolve-msp-id.ts` (`resolveMspIdStrict`, §1a/§6)
- `artifacts/api-server/src/lib/rbd-document-render.ts` (#1512's independent writer, §5)
- `artifacts/api-server/src/middlewares/requireAuth.ts` (role hierarchy)
- `artifacts/admin-panel/src/pages/MspReports.tsx` (the one real live caller, §6)
- `artifacts/admin-panel/src/App.tsx:415`, `.../components/shell/workspaceNav.tsx:227` (route/nav registration)
- `lib/db/src/schema/msp.ts:3390-3489,4390-4429` (all four report tables + both enum unions)
- `artifacts/api-server/src/routes/index.ts:224,558`, `artifacts/api-server/src/app.ts:127` (mount path)
- Live local PostgreSQL (`DATABASE_URL`), queried 2026-09-10 (§5, §8)
