# Diagnostics — MSP Console contract extraction pack

**#3354**, under **#1571** (EPIC: Portal Admin — MSP-side operator surface), the same Epic
`artifacts/msp-console`'s eventual Diagnostics screen will be built against. No Feature-tier
issue sits between #3354 and #1571 today, so this pack parents directly to the Epic, matching
#1571's own fallback-table row ("MSP operator surface — `/api/msp/*`, per-customer delivery
work").

Read-only. Every field below is extracted from the route file's own `.select()` projections
(no curated `Wire*` interfaces exist anywhere in this file — see §0.3) and the two Drizzle
tables it owns, cited to file:line, and cross-checked live against local PostgreSQL. **Nothing
here is authored or invented.**

Backend: **one file**, `artifacts/api-server/src/routes/msp-diagnostics.ts` — 1264 lines, 14
routes, mounted at `router.use(mspDiagnosticsRouter)` (`routes/index.ts:618`) under the app-wide
`/api` prefix (`app.ts:127`, `app.use("/api", subscriptionGate, router)`). The file's own header
comment (`:1-46`) enumerates all 14 routes with their real paths; every one below was re-verified
against the route definition itself, not assumed from that comment.

**Real completeness, confirmed rather than assumed from line count:** all 14 routes are
genuinely built out — no route in this file is a stub, a `TODO`, or a placeholder. What line
count alone would have hidden (§0.1, §7) is that **7 of the 14 are live and mounted but have
zero real frontend consumer today** — a materially different situation from an unbuilt route,
and documented precisely below rather than papered over.

**Addendum, 2026-09-10 (#1770):** the 14th route, `GET /msp/monitoring-packages` (`:225-267`),
was added by this pass to fill a real, confirmed gap — the AdminV2 Active Directory screen's
"Run scan" button could trigger a run (§1.1 already accepted a `packageKey` override) but had no
endpoint listing which packages existed to choose from. Everything else in this pack (§0–§9,
1214-line/13-route era) describes the file exactly as a prior read-only pass (#3354) found it;
this addendum documents only what changed. No other route in this file was touched.

Schema: `lib/db/src/schema/msp.ts:3605` (`mspDiagnosticRunsTable` → `msp_diagnostic_runs`),
`:3666` (`mspDiagnosticFindingsTable` → `msp_diagnostic_findings`). Verified live against local
PostgreSQL (`psql "$DATABASE_URL" -c '\d msp_diagnostic_runs'` / `'\d msp_diagnostic_findings'`)
— every column below is confirmed present on the running schema, matching the Drizzle source
exactly except one default-value drift noted at §7.5. Live data as of this pass: 2 runs, 300
findings (187 `ok`, 63 `info`, 33 `warning`, 13 `critical`).

---

## 0. The surfaces, their consumers, and the real shape of the file

### 0.1 Consumer map

| Endpoint | Method | Route file:line | Real consumer(s) today | Status |
|---|---|---|---|---|
| `/api/msp/monitoring-packages` | GET | `:225-267` | `adApi.ts` (`fetchAdMonitoringPackages`) → `AdCustomerCanvas.tsx` run-scan picker | live, real consumer — added by #1770, this addendum |
| `/api/msp/customers/:customerId/diagnostics/run` | POST | `:273-386` | `adApi.ts:258` (`runAdCustomerDiagnostics`, now takes an optional `packageKey` per #1770) → `AdCustomerCanvas.tsx:125`; `ActiveDirectoryCustomerPane.tsx:709`; `SimulatorAssessmentCanvas.tsx:274` — all admin-panel (MSP Console AD-style screens) | live, real cross-screen reuse |
| `/api/msp/customers/:customerId/monitoring-package` | GET | `:392-447` | `adApi.ts` (`fetchAdCustomerMonitoringPackage`) → `AdCustomerCanvas.tsx` run-scan picker default-selection, added by #1770 | live, real consumer as of this addendum — was orphaned (§7.1) before it |
| `/api/msp/customers/:customerId/diagnostics` (paginated `{runs,total,limit,offset}`) | GET | `:451-495` | **none found** | live, mounted, genuinely unconsumed — §7.2 |
| `/api/msp/customers/:customerId/diagnostics/runs` (plain array) | GET | `:502-538` | `SimulatorAssessmentCanvas.tsx:212`; `SimulatorAssessmentRunHistory.tsx:180` | live, real reuse |
| `/api/msp/customers/:customerId/diagnostics/runs/:runId` | GET | `:542-590` | `ActiveDirectoryCustomerPane.tsx:531`; `SimulatorAssessmentCanvas.tsx:240`; `SimulatorAssessmentRunHistory.tsx:231-232` | live, real reuse |
| `/api/msp/customers/:customerId/diagnostics/runs/:runId/sse` | GET | `:596-691` | `SimulatorAssessmentCanvas.tsx:299` (admin-panel, MSPOperator JWT); `useScanState.ts:194` (**customer portal** `artifacts/portal`, CustomerUser JWT — Mission Control live-scan strip, per the route's own header note `:24-25`) | live, real reuse, genuinely dual-role |
| `/api/msp/customers/:customerId/scripts` | GET | `:707-806` | **none found** | live, mounted, genuinely unconsumed — §7.1. Live data has 0 `requires_script` findings today, so this route is also functionally untested against real data |
| `/api/msp/customers/:customerId/scripts/:checkKey/download` | GET | `:814-888` | **none found** | live, mounted, genuinely unconsumed — §7.1 |
| `/api/portal/diagnostics/latest` | GET | `:901-949` | **none found** | live, mounted, genuinely unconsumed — §7.3 |
| `/api/portal/scripts/:checkKey/download` | GET | `:958-1028` | **none found** (one doc-string mention only, `MonitorChecks.tsx:528`, not a call) | live, mounted, genuinely unconsumed — §7.1 |
| `/api/portal/health-benchmark` | GET | `:1036-1096` | **none found** | live, mounted, genuinely unconsumed — §7.3 |
| `/api/portal/diagnostics/runs/:runId` | GET | `:1101-1144` | **none found** | live, mounted, genuinely unconsumed — §7.3, §7.4 |
| `/api/portal/diagnostics/results/:serviceSlug` | GET | `:1149-1262` | `usePersonalizationData.ts:155` — **marketing site** (`artifacts/shane-mccaw-consulting`), personalized Assessment-tier content on topic pages | live, real, cross-app reuse |

**9 of 14 consumed, 5 of 14 orphaned** (updated by this addendum — was 6 of 13 / 7 of 13; #1770
gave two previously-orphaned routes their first real caller and added one new consumed route).
Line ranges for every pre-existing route shifted by the new route's insertion (`:225-267`); every
range above was re-read at its new location, not offset-calculated. Original consumer map
confirmed by direct grep of every `.ts`/`.tsx` file under
`artifacts/{admin-panel,portal,shane-mccaw-consulting,mcp-server}/src` for each route's literal
path fragment — not inferred from the route file's own comments, which in a few places (§7.3)
describe intent that the grep did not confirm.

### 0.2 The 5 orphaned customer-portal routes line up with the #1485 rebuild, not a gap

**`msp_diagnostic_runs`/`msp_diagnostic_findings` still hold this platform's only real
diagnostics data** — the four orphaned `/api/portal/*` routes here (`diagnostics/latest`,
`health-benchmark`, `diagnostics/runs/:runId`, plus the not-customer-portal-but-still-orphaned
`/api/portal/scripts/:checkKey/download`) are not unbuilt; they're this file's original,
pre-#1485 customer-facing surface. `artifacts/portal` — the live #1485 rebuild — reads the
same underlying data through its **own**, newer routes instead:

- Pillar health: `pillar.tsx:30` cites `GET /api/portal/pillars` (`portal-assessment.ts:691`),
  not this file's `GET /api/portal/health-benchmark`.
- `GET /api/portal/diagnostics/results` (no slug — `portal-customer-engines.ts:924-928`) is a
  **separate, later route in a separate file** with the same path prefix as this file's
  `GET /api/portal/diagnostics/results/:serviceSlug` (`:1149-1262`) — same name, different
  file, different shape, not a collision (Express dispatches by the presence/absence of the
  path segment) but a real naming trap for anyone grepping "diagnostics/results" expecting one
  answer.

This pack does not resolve which of the two is the one true "latest run" surface for
`artifacts/portal` going forward — that is a real design question for whoever next touches
Diagnostics in the #1485 rebuild, not something this read-only pass decides. It states the fact:
today, this file's four customer-portal routes have no live caller, and the #1485 portal reads
equivalent data elsewhere.

### 0.3 No `Wire*` interface anywhere in this file

Unlike some MSP Console packs (e.g. the Risk Register pack's `msp-rbd-instances.ts`/
`msp-rbd-versions.ts`), **no route in `msp-diagnostics.ts` defines a curated response type.**
Every response is either:
- a bare `mspDiagnosticRunsTable.$inferSelect` / `mspDiagnosticFindingsTable.$inferSelect` row
  (full table columns, e.g. `:524-529`, `:563-570`), or
- a hand-picked `.select({...})` projection inlined at the query site (e.g. the `scripts` route's
  `{findingId, checkKey, checkLabel, severity, title, createdAt}` at `:743-750`), or
- a small literal object assembled in the handler (e.g. the `run` POST's
  `{runId, status, message}` at `:346`).

§1–§3 below document each shape exactly as returned, route by route, rather than inventing a
`Wire*` name for shapes the file itself never names.

---

## 1. MSP-operator routes (`requireRole("MSPOperator")`, `assertCustomerAccess`)

Six of the seven routes in this group share the same ownership gate: look up the `tenants` row for
`customerId`, 404 if absent, then `assertCustomerAccess(req.user!, customerId)` (§4) — 404, not
403, on failure, so a customer id outside the caller's reach is indistinguishable from one that
doesn't exist. The seventh, §1.0 (added by #1770), is `requireRole("MSPOperator")` too but is
**not** customer-scoped at all — it lists the global package catalog, so it has no `customerId`
param and no `assertCustomerAccess` call to share.

### 1.0 New — `GET /msp/monitoring-packages` (`:225-267`, #1770)

No `customerId` param — lists the real, active `monitoring_packages` catalog an operator can pick
from before triggering §1.1's run. `SELECT key, label, count(monitoring_package_checks.id) AS
"checkCount" FROM monitoring_packages LEFT JOIN monitoring_package_checks ON package_key = key
WHERE status = 'active' GROUP BY key, label HAVING count(...) > 0 ORDER BY label` (`:248-259`,
`HAVING` itself at `:258`).

The `HAVING count(...) > 0` is deliberate, not incidental: 10 of the table's 21 `active` rows
(`cat-collaboration-sharing`, `cat-security-posture`, etc.) have zero linked checks — confirmed
live, they're dashboard-tab taxonomy from a different feature
(`lib/db/migrations/manual/2026-07-19-customer-dashboard-category-tabs.sql`) that reused this same
table, not a runnable scan bundle. Filed as its own finding, **#3453** (parented under #1571,
since #1770 itself has no Feature-tier parent — see #1770's own `gh issue view` result). Response,
`200`:

```json
{ "packages": Array<{ key: string, label: string, checkCount: number }> }
```

Live data as of this pass (re-run against local `DATABASE_URL`): **11** packages returned (of 21
active rows in the table), ranging `checkCount` 3 (`assess:teams-governance`) to 198
(`core:premier`). §7.1 is now **partly stale** for this route — see the addendum note there.

### 1.1 Trigger — `POST /msp/customers/:customerId/diagnostics/run` (`:273-386`)

Fire-and-forget. Request body: optional `{ packageKey?: string }` — "default" or empty is
treated as "not provided" (`:307-308`).

`packageKey` resolution when not supplied (`:308-326`): the customer's most-recent **active**
`monitoring_subscription`-type `client_services` row (joined `users` → `client_services` →
`services`, `services.type_attributes->>'packageKey'`), ordered by `clientServicesTable.id`
descending (deterministic tie-break, replacing a prior unordered `LIMIT 1` per the inline
comment). Falls back to `"core:security-baseline"` if the customer has none.

Response, `202`: `{ runId: string (uuid), status: "pending", message: "Diagnostics run started" }`
(`:346`). The actual scoring pipeline (`runDiagnostics`, `diagnostics-runner.ts`) and, in
parallel, `runItemDetailCollection` (`item-detail-collector.ts`, #339's per-check item detail
gather — its own package/trigger/table, cannot affect this run's scoring or findings, skipped
when the customer has no connected `tenantId`) both fire **after** the response is sent
(`:348-377`) — neither is awaited, both log-and-swallow their own errors.

Inserts one `msp_diagnostic_runs` row, `status: "pending"` (`:334-344`), passing `existingRunId`
to `runDiagnostics` so the pipeline updates this row rather than inserting a second one — the
route's own comment (`:331-333`) cites this as a fixed historical double-insert bug.

### 1.2 `GET /msp/customers/:customerId/monitoring-package` (`:392-447`)

Same resolution query as §1.1's fallback path, always run (no body override — this route has no
body). Response, `200`:

```json
{ "packageKey": string | null, "serviceId": number | null, "serviceName": string | null }
```

`null` for all three when the customer has no active monitoring subscription — never a fabricated
default. **Addendum, #1770: no longer orphaned** — `adApi.ts` (`fetchAdCustomerMonitoringPackage`)
now calls this to default the run-scan package picker's selection to the customer's real resolved
subscription, reusing this route exactly as originally built rather than duplicating its query.

### 1.3 `GET /msp/customers/:customerId/diagnostics` — paginated (`:451-495`)

Query params `limit` (default 20, capped 100) and `offset` (default 0). Response, `200`:

```json
{ "runs": MspDiagnosticRun[], "total": number, "limit": number, "offset": number }
```

`runs` is the bare `mspDiagnosticRunsTable` row shape (§2.1) — every column, unfiltered.
§7.2: no caller found; superseded in practice by §1.4's plain-array sibling.

### 1.4 `GET /msp/customers/:customerId/diagnostics/runs` — plain array (`:502-538`)

Query param `limit` (default 50, capped 100), no `offset`, no total count. Response, `200`: a
**bare array** of full `mspDiagnosticRunsTable` rows (§2.1) — **not** wrapped in an envelope,
unlike §1.3's near-identical sibling. This is the one the real admin-panel consumers actually
use (§0.1).

### 1.5 `GET /msp/customers/:customerId/diagnostics/runs/:runId` (`:542-590`)

Response, `200`:

```json
{
  "run": MspDiagnosticRun,
  "findings": Array<MspDiagnosticFinding & { classification: FailureClassification | null }>
}
```

`run` is the full row (404 `{error:"Run not found"}` if it doesn't belong to this `customerId`).
`findings` is every `msp_diagnostic_findings` row for the run, ordered by `severity`
(`:574-578` — text-column order, not severity-rank order; see §7.6), each one run through
`withFindingClassifications` (§3) — the **only** route in this file that attaches `classification`
to a finding.

### 1.6 `GET /msp/customers/:customerId/diagnostics/runs/:runId/sse` (`:596-691`)

The one route in this group with no `requireRole` middleware — auth is hand-rolled because
`EventSource` cannot send an `Authorization` header, so the JWT travels as `?jwt=` and is
verified inline (`jwt.verify`, `:611`) against `JWT_SECRET` (falls back to the literal string
`"dev-secret"` if unset, `:608` — a real, live default worth Design/Ops knowing about, not
flagged further here since it's a pre-existing env-var-hygiene fact, not a diagnostics-specific
gap).

Authorization branches on the decoded token's role (`:616-656`):
- `role === "admin"` → always allowed (legacy PlatformAdmin).
- `mspRole` is `CustomerUser` or `Assessment` → allowed only if the token's own `customerId`
  claim equals the `:customerId` param — the customer-portal Mission Control / assessment-wizard
  case (§0.1).
- `mspRole` is `MSPOperator`/`MSPAdmin`/`PlatformAdmin` → `assertCustomerBelongsToMsp` +
  a hand-rebuilt `AuthUser` run through `isCustomerBlockedByStaffScope` (§4), since this path has
  no `req.user` to hand `assertCustomerAccess` directly.
- Anything else → `403`.

On success: verifies the run exists for this `customerId` (404 otherwise), sets SSE headers
(`text/event-stream`, `no-cache`, `keep-alive`, `X-Accel-Buffering: no`), registers with
`registerDiagnosticsRunSSEClient` (`sse-channels.ts`), and holds a 25s heartbeat comment
(`: heartbeat\n\n`) until the client disconnects. Real event payloads (`diagnostics_progress` /
`diagnostics_complete` / `diagnostics_error`) are broadcast from `diagnostics-runner.ts`, not
this route — see `scanTypes.ts:59-93` for the shape, and §5.2 below for the values this pack
confirmed live against `diagnostics-runner.ts`'s broadcast call sites.

---

## 2. The two tables this file owns

### 2.1 `msp_diagnostic_runs` (`lib/db/src/schema/msp.ts:3605-3645`)

One row per triggered run. Every column below is on every MSP-operator response in §1 and on
`GET /portal/diagnostics/latest` / `GET /portal/diagnostics/runs/:runId` (§6) verbatim — none of
those routes filter it.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | serial | no | |
| `runId` | uuid, unique | no | the public id every route addresses by |
| `mspId` | integer, FK → `msps.id` cascade | no | |
| `customerId` | integer | **yes** | `tenants.id` — deliberately **no FK** (Phase 0/7 note in schema, `:3609`); null for a pre-purchase orphaned/pre-customer run |
| `tenantId` | text | yes | |
| `packageKey` | text | no, DB default `'default'` | see §7.5 — Drizzle's own default differs from the live column default |
| `status` | text, enum §5.1 | no, default `pending` | `pending → running → completed｜failed｜partial`, written only by `diagnostics-runner.ts` (§2.3) |
| `triggeredByUserId` | integer | yes | |
| `startedAt` / `completedAt` | timestamptz | yes | |
| `checksTotal` / `checksOk` / `checksError` / `checksRequiresScript` / `checksLicenseGap` | integer | no, default 0 | real counts from the executed package; `checksLicenseGap` tracked separately from `checksError` so a license-gapped tenant isn't penalized as a technical failure (schema comment, `:3620-3623`) |
| `runStatus` | text | yes | raw executor-level status string, echoed from `pkgResult.runStatus` — distinct from the coarser `status` column |
| `documentId` | uuid | yes | the generated report document, when one was created |
| `errorMessage` | text | yes | set only on the `failed` path, truncated to 1000 chars (`diagnostics-runner.ts:1183`) |
| `summary` | jsonb | yes | shape confirmed live: `{findingsCount, criticalCount, warningCount, licenseGapCount, licenseGapFeatures, enginesRecomputed}` — **no `compositeScore` key exists anywhere in the write path or live data, see §7.4** |
| `cioNarrativeStatus` | text | no, default `not_started` | `not_started → generating → ready｜failed` (`cio-narrative-generator.ts`), fired only for Assessment-triggered scans that clear the doc-gate coverage bar (§2.4) |
| `cioNarrativeHtml` | text | yes | |
| `cioNarrativeGeneratedAt` | timestamptz | yes | |
| `createdAt` / `updatedAt` | timestamptz | no | |

### 2.2 `msp_diagnostic_findings` (`lib/db/src/schema/msp.ts:3666-3699`)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | serial | no | |
| `findingId` | uuid, unique | no | |
| `runId` | uuid, FK → `msp_diagnostic_runs.run_id` cascade | no | |
| `mspId` | integer | no | no FK (matches the run row's own note) |
| `customerId` | integer | yes | |
| `checkKey` | text | no | joins to `monitor_checks.key` — no hard FK |
| `checkLabel` | text | no | |
| `severity` | text, enum §5.2 | no, default `info` | `ok｜info｜warning｜critical` — confirmed live distribution: 187 `ok`, 63 `info`, 33 `warning`, 13 `critical` (300 total) |
| `title` | text | no | |
| `description` | text | yes | |
| `recommendation` | jsonb `{signalKey?, action?, estimatedEffort?, priority?, category?}` | yes | consumed by the Sales Offer Engine (schema comment, `:3652-3653`) — out of this pack's scope |
| `extractedProperties` | jsonb | yes | raw per-check payload; carries `_rawGraphError` for #374 (§3) when present. **Never returned by any customer-portal route** — only the MSP-operator detail route (§1.5) and the classifier read it |
| `checkStatus` | text, no DB enum | yes | live values seen: `ok` (234), `license_gap` (38), `service_not_configured` (11), `error` (9), `partial` (4) — **`requires_script` and `consent_revoked` exist in code (§1's scripts routes, §3) but have zero live rows today**, so those two paths are real but functionally unexercised against current data |
| `findingSource` | text, enum §5.3 | no, default `baseline` | live: 100% `baseline` (296/296) — no `policy`-sourced finding exists yet in local data |
| `standingPolicyId` | integer, FK → `standing_policies.id` set-null | yes | null for every live row (matches 100% `baseline` above) |
| `createdAt` | timestamptz | no | |

### 2.3 Status lifecycle, confirmed against `diagnostics-runner.ts`

`pending` (insert, `:773-782` or the route's own `:334-344`) → `running` (`:790-792`, the
UPDATE happens instead of a second INSERT — the route's own comment cites the fixed
double-insert bug) → **either** `completed` (all checks in the executed package ran without a
runStatus other than `"completed"`) **or** `partial` (`pkgResult.runStatus !== "completed"`,
`:1049`) on success, **or** `failed` (`:1179-1186`, any thrown error, `errorMessage` captured,
truncated to 1000 chars) on failure. A `failed` run with a known `customerId` also gets a
`portal_wf_runs` stub + `portal_wf_operator_tasks` row so an MSP operator can see and acknowledge
it (`createFailureOperatorTask`, `:1191+` — schema/route for that table is out of this pack's
scope).

### 2.4 What actually fires the CIO narrative

`generateCioNarrative` (`cio-narrative-generator.ts`) fires fire-and-forget, **only** when the
run's `isAssessmentTriggered` flag is true (never for a routine MSPOperator manual re-check, a
5-minute Live Activity Monitor tick, an SOW-expiry sweep rescan, or a testbed debug-trigger) AND
`evaluateDocGateCoverage({checksOk, checksLicenseGap, checksError, checksTotal}).proceed` is true
(≥50% evaluable coverage, `doc-gate-coverage.ts:52,92-131`) AND `customerId` is known. It is
idempotent — guarded on `cioNarrativeStatus === "not_started"` before flipping to `generating`,
so a duplicate fire is a no-op.

---

## 3. #379 failure classification (`:82-184`) — MSP-operator only

`ClassifiableFinding`, `rawGraphErrorOf`, `isClassifiableFinding`, `classifyDiagnosticFindings`,
and `withFindingClassifications` are all exported pure functions (no I/O except the one
`monitor_checks` endpoint-lookup query batched per run, `:175-182`) that attach a `classification`
field to a finding — `null` unless the finding is a genuine failure worth triage.

A finding qualifies (`isClassifiableFinding`, `:126-135`) if **any** of:
- `extractedProperties._rawGraphError` is a non-empty string (#374's raw, untruncated Graph error
  text — findings written before #374 landed simply don't carry it, so they're never classified
  through this path even if they were real failures);
- `checkStatus === "license_gap"` or `"consent_revoked"` — already classified upstream by the
  executor against a documented Microsoft signature, so the classifier short-circuits rather than
  re-deriving from text (`monitor-failure-classifier.ts:395-425`, both explicitly "not a fault");
- `checkStatus === "service_not_configured"` — same short-circuit reasoning, #1847.

The classifier itself (`classifyMonitorFailure`, `monitor-failure-classifier.ts:385+`) returns a
`FailureClassification`:

```ts
{
  category: FailureCategory;   // §5.4
  title: string;
  summary: string;              // one line, what this means
  guidance: string;             // prose for a human, never UI-executed
  evidence: string[];           // the literal matched signatures, not a paraphrase
  statusCode: number | null;
  permissions: string[];        // real permission names pulled from the message
  action: { kind: "show_permission"|"edit_endpoint"|"retire_check"|"none"; label: string; focusField?: string };
}
```

`declaredScopes` is handed to the classifier as `REQUIRED_MT_SCOPES` (`../lib/graph`), **read-only**
— this route never writes to it or to any permission state (module header comment, `:90-95`).
This whole layer is applied to exactly one response in this file: §1.5's `findings` array. The
customer-portal findings arrays (§6.1) never carry `classification` or `extractedProperties` —
by design (customers get a plain summary, MSP operators get the full triage).

---

## 4. Access control (shared by all 6 MSP-operator routes)

`assertCustomerAccess(user, customerId)` (`middlewares/requireAuth.ts:306-331`):
- `PlatformAdmin` (including legacy `role === "admin"`) → always true.
- `MSPAdmin` / `MSPOperator` → true only if `tenants.id = customerId AND tenants.mspId = user.mspId`,
  **and** the caller is not blocked by per-staff scoping (`isCustomerBlockedByStaffScope`, below).
- `CustomerUser` / `Free` / `Assessment` → true only if `user.customerId === customerId` (not used
  by this file's MSP-operator group, which all require `MSPOperator` or above, but shared by the
  same function other files call).
- anything else → false.

**Per-staff scoping carries a live, pre-existing caveat this pack did not introduce but must
surface:** `resolveStaffScopedCustomerIds`'s own doc comment (`requireAuth.ts:339-347`, citing
Phase 1 / #94) states `msp_staff_customer_scopes.customerId` is a **now-orphaned** `msp_customers.id`
whose FK went with that dropped table, "flagged for repoint/removal in Phase 7," and that "until
then a scoped staff member's set will not line up with the tenant ids `assertCustomerAccess` now
compares against." Every MSP-operator route in this pack calls `assertCustomerAccess`, so every one
of them inherits this — a **scoped** MSP staff member (one with any `msp_staff_customer_scopes`
row at all) may see incorrect allow/deny behavior on every route in §1. An **unrestricted** staff
member (zero scope rows — the default) is unaffected. This is a pre-existing, already-documented
gap in the shared middleware, not something this pack found new; restated here because every route
in §1 depends on it and a pack that didn't mention it would understate real risk.

---

## 5. Real enum unions

### 5.1 Run status — `MSP_DIAGNOSTIC_RUN_STATUS`, `msp.ts:3602`
`pending`, `running`, `completed`, `failed`, `partial` — plain `text`, no DB CHECK constraint.
Enforced only by `diagnostics-runner.ts` only ever writing one of these five literals (§2.3).

### 5.2 Finding severity — `MSP_DIAGNOSTIC_FINDING_SEVERITY`, `msp.ts:3655`
`ok`, `info`, `warning`, `critical` — plain `text`, no DB CHECK. `classifyCheckSeverity`
(`diagnostics-runner.ts:56+`) is the one writer: `consent_revoked` → `critical`; a technical
`error` → **`info`**, deliberately not `warning` (#522's own comment: "a check-execution error is
a technical failure, not a real security finding... never a warning-severity row the customer
reads as genuine signal" — `checkStatus` still records `"error"` for MSP-side triage even though
`severity` reads `info`).

### 5.3 Finding source — `MSP_DIAGNOSTIC_FINDING_SOURCES`, `msp.ts:3663`
`baseline`, `policy` — #1553's addition; every finding until #1553 derived from a Microsoft/
best-practice baseline, `policy` marks one raised from `standing_policies.target_state`
non-compliance instead. Live: 100% `baseline` today (§2.2).

### 5.4 Failure classification category — `FAILURE_CATEGORIES`, `monitor-failure-classifier.ts:44-70`
`missing_scope`, `wrong_endpoint`, `bad_path`, `parameter_slot`, `wrong_api_pattern`, `dead_api`,
`license_gap`, `consent_revoked`, `service_not_configured`, `unclassified` — the last is
deliberate ("matched nothing known", per the module header), not a bug.

### 5.5 `checkStatus` — no fixed vocabulary, `msp_diagnostic_findings.check_status`
Plain `text`, no enum in Drizzle, no DB CHECK — whatever `monitor-executor.ts`'s `CheckResult.status`
produces. Live values seen (§2.2): `ok`, `license_gap`, `service_not_configured`, `error`,
`partial`. Known-but-unseen-live: `requires_script`, `consent_revoked`.

---

## 6. Customer-portal routes (`requireAuth`, not `requireRole`)

### 6.1 Shape shared by the three findings-returning routes

`GET /portal/diagnostics/latest` (§0.1), `GET /portal/diagnostics/runs/:runId` (§0.1), and (in a
different, plainer shape) `GET /portal/diagnostics/results/:serviceSlug` all return findings via
a **hand-picked projection**, never the raw `extractedProperties` or a `classification` field —
the file's own header comment states this explicitly (`:41`, "no raw extracted_properties"). The
first two share an identical shape:

```json
{
  "run": MspDiagnosticRun | null,
  "findings": Array<{
    findingId, checkKey, checkLabel, severity, title, description, checkStatus, createdAt
  }>
}
```

### 6.2 `resolveCallerCustomerId` is used by 3 of 4 routes — one is the odd one out

`resolveCallerCustomerId(user)` (`:215-223`) reads `user.customerId` from the JWT first, falling
back to a fresh `users.tenantId` DB lookup when the JWT claim is stale/absent — the function's own
comment calls out that it's deliberately `users.tenantId`, not `users.mspId`, since these are
tenant-scoped roles. `diagnostics/latest` (`:909`), `health-benchmark` (`:1048`), and
`diagnostics/results/:serviceSlug` (`:1157`) all use it, and all three degrade gracefully to an
empty-but-valid `200` when no customer id resolves (`{run:null, findings:[]}` /
`{pillars:[], asOfDate:null}` / `{score:0, status:"not_evaluated", findings:[], evaluatedAt:...}`).

**`GET /portal/diagnostics/runs/:runId` (`:1101-1144`) does not.** It reads `req.user!.customerId`
directly (`:1107`) with no DB fallback, and returns a hard `403 {error:"No customer context"}`
instead of an empty `200` when that claim is absent. This is a real, live asymmetry among four
routes that otherwise share the same auth pattern and the same stale-JWT risk the other three were
explicitly built to cover (§7.4) — not filed as its own issue since the route currently has zero
live callers (§0.1), but worth Design/whoever wires this route next knowing before they assume
uniform behavior across the four.

### 6.3 `GET /portal/health-benchmark` (`:1036-1096`)

Deliberately `requireAuth`, not `requireRole("CustomerUser")` — the route's own comment (`:1038-1042`)
cites #1157: the stricter floor 403'd Free-tier customers who already had real diagnostic data,
which the frontend couldn't distinguish from "no data yet."

Computes, in parallel: `calculateArchitectureHealthScore(customerId)` (`health-engine.ts`),
`fetchSignalRulesAndGroups()` (`priority-engine.ts`), and every row of
`industry_benchmark_reference` (`lib/db/src/schema/index.ts:3797-3803`, PK `pillar`). Restricts
each pillar's theoretical-max denominator to signals **this tenant's own scanned checks can
genuinely feed** via `fetchTenantEvaluableSignalKeys` (`pillar-coverage.ts`) — the route's own
comment (`:1061-1065`) cites #413: catalog-wide scoping previously measured the denominator over
checks the customer never ran while the numerator could only ever hold checks it did, an
unwinnable clamp. `computeDisplayHealth` (`health-display.ts:353-364`) turns that into
`{pillar: HealthPillar, displayScore: number|null}[]` — `HEALTH_PILLARS` is **6** pillars
(`governance, compliance, adoption, copilot, architecture, licensing`; `health-engine.ts:53-60`
— its own comment says "seven," a stale off-by-one in the comment text only, not in the array;
`security` is deliberately excluded platform-wide, unrelated to this file).

Response, `200`:

```json
{
  "pillars": Array<{ pillar, displayScore: number|null, industryAvgPct: number|null, msExcellencePct: number|null, source: string|null, asOfDate: string|null }>,
  "asOfDate": string | null   // the max asOfDate across all benchmark rows, or null
}
```

Never exposes raw risk scores or `breakdown.contributions` (route's own comment, `:1034`).

### 6.4 `GET /portal/diagnostics/results/:serviceSlug` (`:1149-1262`)

The one route in this file with a confirmed live cross-app consumer (marketing site's Assessment
personalization, §0.1). Response, `200`:

```json
{
  "serviceSlug": string,
  "score": number | null,
  "status": "healthy" | "warning" | "critical" | "not_evaluated",
  "findings": Array<{ id, title, severity, recommendation }>,
  "evaluatedAt": string (ISO)
}
```

`status` is derived purely from real findings on the latest run matching this `serviceSlug` as
`packageKey` (`hasCritical`/`hasWarning` flags over the findings actually returned, `:1208-1224`)
— never gated by coverage. `score` **is** coverage-gated (`evaluateDocGateCoverage`, §2.4's same
50% bar): `null` when coverage is insufficient, replacing what the route's own comment (`:1226-1233`)
says was a real prior bug — `score` defaulting to `100` ("healthy") whenever `checksTotal` was 0,
"the worst case of this class of bug, a fully-dark run reading as a clean bill of health."

**§7.4: the `score` calculation's primary branch is dead in practice.** When coverage clears the
bar, the route checks `summaryObj.compositeScore` first (`:1242-1244`) and falls back to
`Math.round((checksOk/checksTotal)*100)` (`:1245-1247`) only if that's absent. **No writer anywhere
in this codebase ever sets `summary.compositeScore`** on a `msp_diagnostic_runs` row (verified by
reading every `mspDiagnosticRunsTable` UPDATE call site in `diagnostics-runner.ts` and
`cio-narrative-generator.ts`, and confirmed live: `SELECT count(*) FROM msp_diagnostic_runs WHERE
summary ? 'compositeScore'` returns **0** against local data). The route always falls through to
the ratio-based fallback — real, working code, just via a branch the `if` implies is the common
case when it is actually unreachable. Not filed as its own issue: the fallback is correct and this
route has a real live consumer already getting a correct score from it, so nothing is
customer-visibly broken — but flagged here since a future editor reading `:1242-1244` in isolation
would reasonably assume that branch fires sometimes.

---

## 7. Open gaps and notes — flagged, not decided

### 7.1 Three routes are live, mounted, and have never had a caller (was four — #1770 gave one its first)

`GET .../scripts` (both MSP-operator and portal variants) and `GET .../scripts/:checkKey/download`
(both variants) — four route definitions across those, all real, all correctly scoped, none with
a confirmed frontend caller anywhere in this repo (§0.1). The scripts pair is additionally never
exercised against real data — 0 `requires_script` findings exist locally (§2.2) — so even a manual
test would need seeded data first. Not filed as bugs; these are built-ahead-of-consumer, same
standing as the Risk Register pack's "staged for #2582" rows — but that pack's orphaned rows had a
named future wire step (#2582) waiting on them. These don't yet; #3354 didn't create one, since
assigning a wire step is a scoping decision for #1571, not something a read-only pass can settle.

**Addendum, #1770:** `GET .../monitoring-package` (§1.2) — one of the original four — is no longer
in this list. It now has a real caller (`AdCustomerCanvas.tsx`'s run-scan picker, §0.1), reusing
the route exactly as originally built. This is real, organic consumption of a previously
built-ahead-of-consumer route, not a coincidence of scope: #1770's own picker needed exactly the
resolved-subscription-default behavior this route already provided.

### 7.2 The paginated `GET .../diagnostics` envelope has no known reason to exist alongside `.../diagnostics/runs`

Both return the same rows for the same customer; the only difference is the response envelope
(§1.3 vs §1.4) and pagination knobs (`offset` support, a `total` count). Every real consumer uses
the plain-array sibling. Not a bug — just noted so a future cleanup pass knows this is genuinely
redundant rather than assuming a caller exists that this audit missed.

### 7.3 The four orphaned `/api/portal/*` routes plausibly predate the #1485 rebuild

See §0.2 — `artifacts/portal`'s live pillar-health and diagnostics-results reads go through
different, newer routes (`portal-assessment.ts`, `portal-customer-engines.ts`). This pack does not
assert these four are dead code to be deleted — only that they are not, today, part of the live
customer-portal data path, and that whoever next works Diagnostics under #1485/#1571 should decide
deliberately whether to wire the #1485 portal to these or keep using the newer routes, rather than
discovering the duplication mid-build.

### 7.4 `GET /portal/diagnostics/runs/:runId`'s missing `resolveCallerCustomerId` fallback

See §6.2. Concrete because it's a real, reachable code-path difference among four otherwise
consistent siblings, not theoretical.

### 7.5 `packageKey` default drift — Drizzle vs. live column

Drizzle's schema (`msp.ts:3611`) declares `.default("core:security-baseline")`. The live column
default, confirmed via `\d msp_diagnostic_runs`, is `'default'::text`. Every real insert path in
this file and `diagnostics-runner.ts` always supplies an explicit `packageKey` (§1.1's own
resolution logic guarantees this), so the column default is never actually relied on in practice
— but it is real, live drift between the source-of-truth Drizzle file and the running schema,
worth a small follow-up migration whenever someone is already touching this table, not urgent
enough to justify one on its own.

### 7.6 Findings are ordered by `severity` as a **text** column, not a severity rank

Every findings query in this file (`:578`, `:756`, `:941`, `:1136`, `:1206`) orders
`ORDER BY mspDiagnosticFindingsTable.severity` with no `CASE`/rank mapping — so results sort
alphabetically (`critical`, `info`, `ok`, `warning`), not by real severity. `critical` happening
to sort first alphabetically make this look intentional; `warning` sorting **last**, after `ok`,
does not. This is a real, live, silently-wrong ordering, present identically on every route that
returns findings in this file. **This is a genuine defect, not a documentation note** — filed as
its own issue rather than merely flagged, per this file's own standing "file every finding" rule.

---

## 8. The forbidden list — declared, not merely absent

1. **No cross-MSP read.** Every MSP-operator route resolves ownership through
   `assertCustomerAccess` (§4), which is always seeded from the looked-up `tenants` row's own
   `mspId`, never the caller's claimed one for the tautology check it replaced (every route's own
   inline comment says so, e.g. `:292-294`) — verified on all 6 customer-scoped MSP-operator routes
   plus the SSE route's hand-rolled equivalent (§1.6). §1.0 (#1770) is the 7th MSP-operator route
   but reads no per-customer data at all, so it has nothing to scope by `mspId`.
2. **No customer can read another customer's run.** All four customer-portal routes scope by the
   caller's own resolved `customerId`, never a param — a customer cannot address another
   customer's `runId` by guessing it (`GET .../runs/:runId` and `GET .../latest` both filter
   `WHERE customer_id = <caller's own>` in the same query as the `runId` match, not as a
   post-filter).
3. **Classification never leaks to the customer surface.** `extractedProperties` (raw Graph error
   text) and `classification` (§3) are attached only inside the MSP-operator detail route
   (§1.5) — every customer-portal findings shape (§6.1) is a hand-picked projection that never
   includes either field.
4. **Script downloads are ownership-scoped, not just existence-scoped.** Both download routes
   (`:814-888` MSP-operator, `:958-1028` customer) require a **matching, live `requires_script`
   finding** for that exact `customerId` + `checkKey` before resolving a package — guessing an
   unrelated `checkKey` never leaks a script body a customer/operator shouldn't see (both routes'
   own comments state this explicitly, `:808-812`, `:951-956`).
5. **`compositeScore` is never client-suppliable.** It's not on any request body accepted by this
   file (no route in §1/§6 has a schema field for it) — the only place the string appears is the
   dead read branch at §6.4/§7.4, never a write path.

---

## 9. Provenance

**Generated 2026-09-09/10** against `main` (worktree `agent/3354-q2090`), for **#3354**, parented
directly to **#1571** (EPIC: Portal Admin — MSP-side operator surface; no Feature-tier issue sits
between them today). Read in full, not sampled: `msp-diagnostics.ts` (1214 lines, all 13 routes),
`diagnostics-runner.ts` (1217 lines — status lifecycle, summary shape, CIO-narrative trigger),
`monitor-failure-classifier.ts` (727 lines — category enum, `FailureClassification` shape),
`doc-gate-coverage.ts` (131 lines, in full), `cio-narrative-generator.ts` (every
`mspDiagnosticRunsTable` write site), `health-display.ts`/`health-engine.ts` (pillar shape/enum),
`requireAuth.ts` (`assertCustomerAccess`/`isCustomerBlockedByStaffScope`/`resolveStaffScopedCustomerIds`
in full), plus the two Drizzle table definitions in `lib/db/src/schema/msp.ts`.

Consumer mapping (§0.1) built by grepping every route's literal path fragment across
`artifacts/{admin-panel,portal,shane-mccaw-consulting,mcp-server}/src` (not sampled — every hit
was opened and read at its cited line, and near-miss hits on similarly-named-but-different routes
were traced to their own separate route files rather than assumed to be the same endpoint, e.g.
§0.2's two different `/api/portal/diagnostics/results*` routes and §0.2's distinct
`portal-script-library.ts` "Platform Script Library" surface).

Verified live against local PostgreSQL: both tables' full column sets re-confirmed against the
Drizzle source (one drift found, §7.5); real row counts and value distributions for `status`,
`severity`, `checkStatus`, `findingSource`, and `summary`'s actual keys (confirming the
`compositeScore` dead branch, §6.4/§7.4, with a live query, not just static analysis).

**One genuine defect found and filed as its own issue** (§7.6, ordering-by-text-not-rank on every
findings query in this file). No other route, in isolation, is broken — the "gaps" in §7 are
orphaned-consumer and drift notes, not defects, per this issue's own instruction to say so plainly
rather than paper over either direction (inventing problems that aren't there, or hiding ones that
are). No product code, schema, or UI was changed by this pass — read-only, as scoped.

### 9.1 Addendum provenance — 2026-09-10, #1770

Everything above this addendum documents the file as #3354's read-only pass found it (1214
lines, 13 routes). This addendum, done in the same session that built #1770's code (not a
separate read-only pass), documents the one route that pass added: `GET /msp/monitoring-packages`
(§1.0, `:225-267`). Every other pre-existing route's line citation throughout §0–§8 was
re-verified against the file's real current line numbers (worktree `agent/1770-q2116`, now 1264
lines / 14 routes) — the new route's insertion shifted every citation at or after the original
`POST .../diagnostics/run` (`:223` originally) by a flat `+50`; citations before that point (the
`#379` classification block, `resolveCallerCustomerId`, the file's own header doc comment) shifted
by smaller, individually-verified amounts (`grep -n` against the real function/comment text, not
arithmetic assumption). Citations into other files — `lib/db/src/schema/msp.ts`,
`diagnostics-runner.ts`, `monitor-failure-classifier.ts`, `requireAuth.ts`, `health-engine.ts`,
etc. — are untouched, since none of those files changed.

One genuine finding from this addendum, filed as its own issue and parented under #1571 (same as
#1770 itself, which has no Feature-tier parent): **#3453**, ten `active` `monitoring_packages`
rows (`cat-*`) that are dead dashboard-tab taxonomy reusing this table, not runnable scan bundles
— see §1.0. Two previously-orphaned facts from the original pass are now stale and corrected in
place rather than left to mislead a future reader: §0.1's consumer count (was 6/13 orphaned-7,
now 9/14 consumed-5-orphaned) and §7.1's "four orphaned routes" (now three — `GET
.../monitoring-package` has a real caller as of this build).
