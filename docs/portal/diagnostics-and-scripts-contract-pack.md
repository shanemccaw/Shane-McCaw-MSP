# Diagnostics and Scripts — contract extraction pack

**For Claude Design. Extracted, not authored — every claim below is cited to file:line against
the code on `main`.** Read-only build: no product code, no schema, no UI were changed to produce
this document.

Module: **Diagnostics and Scripts** (leaf issue #2451, Feature #1660 "Feature: Diagnostics and
Scripts (Portal)", portal epic #1485). Phase 2 of the Portal build order
(BUILD_QUEUE_METHOD.md §2.1), following the #1642 pattern.

**Headline honesty finding, stated up front because it changes how Design should read the
"Scripts" half of this module below:** the scan/findings machinery is fully live and carries
real data, but **the customer-facing PowerShell-script download path is built and wired end to
end, yet structurally cannot succeed for any customer today** — not because of missing data, but
because of a genuine wiring gap between two otherwise-complete admin surfaces (see §6, and the
filed finding at the end of this pack). Live-DB counts (queried this session against the local
`DATABASE_URL`, 2026-09-03):

| Table | Live rows |
|---|---|
| `msp_diagnostic_runs` | 6 (all `status = 'partial'`) |
| `msp_diagnostic_findings` | 853 |
| `monitor_checks` with `requires_customer_script = true` | **0** |
| `script_packages` | **0** |
| `script_modules` | **0** |
| `industry_benchmark_reference` | **0** |

`msp_diagnostic_findings.check_status` breakdown on the live corpus: `ok` 662, `license_gap` 133,
`service_not_configured` 44, `partial` 12, `error` 2. **`requires_script` currently has zero live
findings** — consistent with zero checks being flagged `requires_customer_script`.

---

## 0. The surfaces of this module

| # | Surface | File | Audience | Writes? |
|---|---|---|---|---|
| A | `GET /api/portal/diagnostics/latest` | `artifacts/api-server/src/routes/msp-diagnostics.ts:643` | Customer (the page) | no |
| B | `GET /api/portal/diagnostics/runs/:runId` | `artifacts/api-server/src/routes/msp-diagnostics.ts:843` | Customer (run detail) | no |
| C | `GET /api/portal/scripts/:checkKey/download` | `artifacts/api-server/src/routes/msp-diagnostics.ts:700` | Customer (script download) | no |
| D | `GET /api/portal/health-benchmark` | `artifacts/api-server/src/routes/msp-diagnostics.ts:778` | Customer (benchmark widget) | no |
| E | `GET /api/portal/assessment/status` — `scan` fragment only | `artifacts/api-server/src/routes/portal-assessment.ts:147,434-454` | Customer (assessment wizard's live-scan step) | no |
| F | MSP operator diagnostics routes (trigger/list/detail/SSE) | `artifacts/api-server/src/routes/msp-diagnostics.ts:211-629` | MSP operator (customer-detail Diagnostics tab) | trigger only |
| G | Admin PS-Scripts authoring (packages/modules) | `artifacts/api-server/src/routes/admin-ps-scripts.ts` | Platform admin (authoring) | yes |

**A–D are the customer-facing Diagnostics and Scripts page's real surfaces.** E is a shared
fragment of the Assessment wizard's status-poll endpoint — the wizard's `scan` object is sourced
from the exact same `msp_diagnostic_runs` row this module scans, so it is documented here as a
cross-surface edge, not a fifth customer route to design independently. F is MSP-operator-side
(customer-detail tab, not the customer portal). G is the admin authoring surface for script
content — real and fully built, but (per §6) **never actually reachable from a live check**.

**Old portal-v2 endpoint list, verified against current code (per #2451 Step 1):**

| Old portal-v2 endpoint | Current status |
|---|---|
| `portal/assessment/status` | **Live**, but only the `scan` fragment belongs to this module (§0 row E) — the rest (`documents`, `narrative`, `radar`, `mfa`, `docGeneration`) belongs to the Assessment/CIO-Report Feature, not Diagnostics and Scripts |
| `portal/diagnostics/latest` | **Live**, unchanged shape from what the name implies — §1a |
| `portal/health-benchmark` | **Live** — §1d |
| `portal/offers` | **Not part of this module.** Real and live (`artifacts/api-server/src/routes/portal-offers.ts:134`), but it is the Sales Offer engine's own customer surface, unrelated to diagnostics/scripts data. Not documented further here — see the Portal Admin (#1571) / offers module contract if one exists. |
| `portal/scripts` | **Never existed as a list endpoint.** No `router.get("/portal/scripts", ...)` anywhere in the codebase — confirmed by full-repo grep. The old page's list, if it rendered one, was never backed by a real list route. |
| `portal/scripts/` | Same as above — no trailing-slash variant exists either. |
| `portal/scripts/:id/download` | **Live**, real route, but the id is a `checkKey` (a `monitor_checks.key` string), not a numeric script id — §1c. |

---

## 1. Per-surface wire contract

### 1a. `GET /api/portal/diagnostics/latest` — customer surface (A)

Source: `msp-diagnostics.ts:642-690`. Auth: `requireAuth` (`:644`) — any authenticated portal
role, not gated to `CustomerUser` specifically. Customer id resolution: `resolveCallerCustomerId`
(`:197-205`) reads `user.customerId` from the JWT, falling back to a fresh `users.tenant_id`
lookup for the stale-JWT window (documented at `:181-196`). Read-only.

Response shape:

```
{ run: MspDiagnosticRun | null, findings: FindingSummary[] }
```

| Field | Type | Nullability | Line |
|---|---|---|---|
| `run` | full `msp_diagnostic_runs` row (§2) | `null` when the customer has no `completed`/`partial` run yet, or no resolvable customerId (`:652`) | `654-665` |
| `findings` | `FindingSummary[]` (below) | `[]` in the same two no-run cases | `669-684` |

**`FindingSummary`** (`:670-679`) — deliberately narrower than the full findings row; no
`extractedProperties` (raw Graph payload) or `recommendation` object reach the customer here:

| Field | Type | Nullability | Line |
|---|---|---|---|
| `findingId` | `string` (uuid) | never null | `671` |
| `checkKey` | `string` | never null | `672` |
| `checkLabel` | `string` | never null | `673` |
| `severity` | `"ok" \| "info" \| "warning" \| "critical"` | never null | `674` |
| `title` | `string` | never null | `675` |
| `description` | `string \| null` | `676` |
| `checkStatus` | `string \| null` (§3 vocabulary) | `677` |
| `createdAt` | `Date` (serialized ISO) | never null | `678` |

`run` selects **only `completed` or `partial`** status rows (`:657-663`) — a `pending`/`running`
run in flight is invisible to this endpoint by design; the live scan strip that shows an
in-progress run reads `E` (`/portal/assessment/status`'s `scan` fragment) instead, which has no
such filter (`ACTIVE_RUN_STATUSES`, `portal-assessment.ts:136,181-182`).

### 1b. `GET /api/portal/diagnostics/runs/:runId` — customer run detail (B)

Source: `msp-diagnostics.ts:842-885`. Auth: `requireAuth` (`:844`). Customer id: **directly
`user.customerId`** off the JWT (`:848`), no DB fallback unlike 1a/1c/1d — a stale JWT with no
`customerId` claim gets a `403 { error: "No customer context" }` here rather than the fallback
lookup 1a/1c/1d use. Read-only.

```
{ run: MspDiagnosticRun, findings: FindingSummary[] }   // 200
{ error: "Run not found" }                              // 404 — wrong customer or unknown runId
```

`run` and `findings` (`:864-877`) are the **same shapes** as §1a — no additional fields (no raw
`extractedProperties`, no `recommendation`) even at single-run granularity. Ownership is enforced
by the query itself (`eq(runId) AND eq(customerId)`, `:856-859`) — a `runId` belonging to another
customer 404s rather than leaking.

### 1c. `GET /api/portal/scripts/:checkKey/download` — script download (C)

Source: `msp-diagnostics.ts:699-769`. Auth: `requireAuth` (`:701`). Not a JSON endpoint — streams
the raw script file.

Resolution chain, in order, each step 404-ing honestly if it fails (`:707-755`):

1. `resolveCallerCustomerId(user)` → 404 `"No script available for this check"` if no customer.
2. The caller must have an actual `msp_diagnostic_findings` row for this exact `customerId` +
   `checkKey` with `checkStatus = 'requires_script'` (`:714-723`) — **not** just any finding for
   that check. This is the scoping the file header (`:27-30`) promises: guessing an unrelated
   `checkKey` never leaks script content the caller's own scan didn't surface.
3. `monitor_checks.script_package_id` for that `checkKey` must be non-null (`:730-739`) → 404
   `"No script has been assigned to this check yet"` otherwise.
4. The first `script_modules` row for that package (by `sort_order`, `:741-749`) must exist → same
   404 otherwise.

Success response: `200`, `Content-Type: application/octet-stream`,
`Content-Disposition: attachment; filename="<module.filename or checkKey.ps1>"`, raw script text
as the body (`:757-763`).

**Because step 2 and 3 both require live data that does not currently exist anywhere in this
database (0 `requires_script` findings, 0 `script_package_id` assignments), every real call to
this endpoint today 404s at step 2.** See §6.

### 1d. `GET /api/portal/health-benchmark` — benchmark widget (D)

Source: `msp-diagnostics.ts:777-837`. Auth: `requireAuth`, deliberately not `requireRole` — the
route's own comment (`:779-783`) explains this was loosened for #1157 (a stricter floor silently
403'd Free-tier customers with real data the frontend couldn't distinguish from "no data").
Read-only. Never exposes raw risk scores or `breakdown.contributions` (`:775`).

```
{ pillars: PillarBenchmark[], asOfDate: string | null }
```

No-customer-context shape: `{ pillars: [], asOfDate: null }` (`:792`).

**`PillarBenchmark`** (`:814-824`):

| Field | Type | Nullability | Line |
|---|---|---|---|
| `pillar` | `string` (pillar key) | never null | `817` |
| `displayScore` | `number` (0–100, higher = healthier) | never null | `818` |
| `industryAvgPct` | `number \| null` | **always `null` today** — `industry_benchmark_reference` has 0 rows live | `819` |
| `msExcellencePct` | `number \| null` | **always `null` today**, same reason | `820` |
| `source` | `string \| null` | **always `null` today** | `821` |
| `asOfDate` | `string \| null` (date) | **always `null` today** | `822` |

`pillars` itself is computed from `calculateArchitectureHealthScore` + `computeDisplayHealth`
(`:797,810`) — real per-tenant scoring, unaffected by the empty benchmark-reference table. Only
the four benchmark-comparison fields per pillar are dark. Top-level `asOfDate` (`:826-829`) is the
most recent `industry_benchmark_reference.as_of_date` across all rows — also `null` today for the
same reason.

### 1e. `GET /api/portal/assessment/status` — the `scan` fragment (E)

Source: `portal-assessment.ts:146-454` (route header `:17-40`; this pack documents only the `scan`
sub-object, `:435-454` — the rest of this endpoint's payload, `narrative`/`documents`/`mfa`/
`docGeneration`/`radar`, belongs to the Assessment/CIO-Report Feature). Auth:
`requireRole("Assessment")` (`:151`) — the lowest role floor in the codebase, so `CustomerUser`/
`Free` above it also pass.

```
scan: {
  active: boolean,
  runId: string | null,
  status: MspDiagnosticRunStatus | null,
  startedAt: Date | null,
  checksTotal: number | null,
  checksOk: number | null,
  checksError: number | null,
  checksLicenseGap: number | null,
  licenseGapFeatures: string[],
  lastScanAt: Date | null,
  everScanned: boolean,
}
```

| Field | Nullability | Line |
|---|---|---|
| `active` | never null; `true` iff the customer's most recent run has status `pending`/`running` (`ACTIVE_RUN_STATUSES`, `:136,181-182`) | `436` |
| `runId` | `null` unless `active` | `437` |
| `status` | `null` only when the customer has never had any run | `438` |
| `startedAt` | `null` unless `active` | `439` |
| `checksTotal`/`checksOk`/`checksError`/`checksLicenseGap` | `null` only when no run has ever existed; otherwise real counts off the latest run row, never coverage-gated (unlike the sibling `docGeneration` block, `:496-506`) | `440-449` |
| `licenseGapFeatures` | `[]` when absent; read from `latestRun.summary.licenseGapFeatures` | `450-451` |
| `lastScanAt` | `null` until a `completed`/`partial` run exists (`lastCompleted`, `:169-180`); prefers `completedAt`, falls back to `createdAt` | `452` |
| `everScanned` | `true` iff any run row exists at all, active or not | `453` |

This is the field-for-field source the wizard's live-scan strip reads — a **different run
selector** than §1a/§1b (`latestRun`, unconditional on status, vs. §1a's completed-or-partial-only
`latestRun`), which is why an in-progress scan is visible here but invisible to §1a until it
finishes.

### 1f. MSP operator diagnostics routes (F) — customer-detail Diagnostics tab, not portal

Real and live, `requireRole("MSPOperator")` throughout, all in `msp-diagnostics.ts`:

| Route | Line | Behavior |
|---|---|---|
| `POST /api/msp/customers/:customerId/diagnostics/run` | `211-324` | Fire-and-forget trigger: inserts one `pending` run row, responds `202` immediately, runs `runDiagnostics()` async. `packageKey` resolves from the customer's active `monitoring_subscription` client service, falling back to `core:security-baseline` (`:245-264`). |
| `GET /api/msp/customers/:customerId/monitoring-package` | `330-385` | Resolved `packageKey` + service name for the "Run Diagnostics" button gate. |
| `GET /api/msp/customers/:customerId/diagnostics` | `389-433` | Paginated `{ runs, total, limit, offset }`. |
| `GET /api/msp/customers/:customerId/diagnostics/runs` | `440-476` | Plain array, most recent first, **different envelope** than the route above — same data, two shapes coexist. |
| `GET /api/msp/customers/:customerId/diagnostics/runs/:runId` | `480-528` | `{ run, findings }` — **full** findings rows (not the narrower `FindingSummary` §1a uses), each carrying a computed `classification` (#379, `:518-521`, see §3). |
| `GET /api/msp/customers/:customerId/diagnostics/runs/:runId/sse` | `534-629` | Live per-check progress stream, JWT via `?jwt=` query param (EventSource can't send headers). |

### 1g. Admin PS-Scripts authoring (G) — `admin-ps-scripts.ts`

Full CRUD surface exists and is real: `POST /admin/ps-scripts`, `POST /admin/ps-scripts/packages`,
`GET /admin/ps-scripts/packages`, `PATCH .../packages/:id`, `DELETE .../packages/:id`,
`POST .../packages/:id/modules`, `PUT /admin/ps-scripts/modules/:id`,
`DELETE /admin/ps-scripts/modules/:id`, plus AI-assisted generation routes
(`/admin/ps-scripts/generate`, `/generate-from-service`, `/generate-from-task`) — all
`requireAdmin`. This is a genuinely complete authoring surface for `script_packages`/
`script_modules` content. **What is missing is the link from this surface to a `monitor_checks`
row** — see §6.

---

## 2. `msp_diagnostic_runs` — the shared row every customer-facing surface reads

`lib/db/src/schema/msp.ts:3270-3310`. Selected in full (`SELECT *`) by every route above except
where noted.

| Column | Type | Notes |
|---|---|---|
| `runId` | `uuid`, unique | The public run identifier every route keys off, not `id` |
| `mspId` | `integer`, FK `msps.id` | |
| `customerId` | `integer` | `tenants.id` post-refactor id-space; deliberately **no FK** (Phase 7 audit note at `:3274`) |
| `tenantId` | `text` | M365 tenant GUID |
| `packageKey` | `text`, default `"core:security-baseline"` | Which monitoring package this run executed |
| `status` | `MspDiagnosticRunStatus` (§3) | |
| `triggeredByUserId` | `integer` | |
| `startedAt` / `completedAt` | `timestamp` | |
| `checksTotal` / `checksOk` / `checksError` / `checksRequiresScript` / `checksLicenseGap` | `integer`, default `0` | `checksLicenseGap` tracked separately from `checksError` so a license-gapped tenant isn't penalized as a technical failure (`:3285-3288`) |
| `runStatus` | `text` | free text, distinct from the enum `status` column |
| `documentId` | `uuid` | |
| `errorMessage` | `text` | |
| `summary` | `jsonb` | includes `criticalCount`/`warningCount`/`compositeScore`/`licenseGapFeatures` (read by `portal-assessment.ts`) |
| `cioNarrativeStatus`/`cioNarrativeHtml`/`cioNarrativeGeneratedAt` | — | belongs to the Assessment/CIO-Report Feature, not this module — listed for completeness since `SELECT *` returns them to every caller of §1a/§1b/§1f |

## 3. Real enum unions only

**`MspDiagnosticRunStatus`** (`msp.ts:3267`): `"pending" | "running" | "completed" | "failed" | "partial"`.
Live corpus today: 6 rows, all `partial`. Zero `completed`, `failed`, `pending`, or `running` rows exist.

**`MspDiagnosticFindingSeverity`** (`msp.ts:3320`): `"ok" | "info" | "warning" | "critical"`.

**Finding `checkStatus`** — free `text`, not a DB enum, but a real closed vocabulary enforced by
the executor (`monitor-executor.ts:353`):
`"ok" | "error" | "consent_revoked" | "requires_script" | "license_gap" | "partial" | "service_not_configured" | "azure_no_rbac" | "azure_no_subscriptions" | "power_platform_not_registered"`.
Live corpus today only exercises five of these nine values (`ok`, `license_gap`,
`service_not_configured`, `partial`, `error`) — `requires_script`, `consent_revoked`,
`azure_no_rbac`, `azure_no_subscriptions`, `power_platform_not_registered` have zero live findings.

**`MspDiagnosticFindingSource`** (`msp.ts:3328`): `"baseline" | "policy"` — every live finding is
`"baseline"` (the column default); no `standing_policies`-sourced finding exists yet in this
database, which is out of this module's scope to verify further.

**#379 failure `classification`** (MSP operator surface F only, `msp-diagnostics.ts:79-166`): a
finding is only ever classified (via `classifyMonitorFailure`) when it carries a real raw Graph
error (`extractedProperties._rawGraphError`) or its `checkStatus` is one of `license_gap` /
`consent_revoked` / `service_not_configured` — every other finding's `classification` is `null`,
by design, not by gap (`:108-117`).

## 4. Cross-surface edges

- **§1e (`/portal/assessment/status` → `scan`) and §1a/§1b/§1f all read the same
  `msp_diagnostic_runs`/`msp_diagnostic_findings` tables**, but §1e's `latestRun` selector is
  unconditional on status while §1a/§1b filter to `completed`/`partial` only — an in-progress
  scan is visible to the wizard (E) before it is visible to the diagnostics page itself (A/B).
- **§1c (script download) depends on three independently-real pieces that are not yet
  connected**: a `msp_diagnostic_findings` row with `checkStatus = 'requires_script'` (produced
  only when `monitor_checks.requires_customer_script = true`, admin-settable per §1g's sibling
  `admin-monitor-checks.ts:151`), a non-null `monitor_checks.script_package_id`, and a
  `script_modules` row under that package (authored via §1g). All three are real, working
  mechanisms; none currently has live data, and — see §6 — the third has no way to be wired to
  the first two.
- **§1d (health-benchmark) pillar scores are real and independent of the empty
  `industry_benchmark_reference` table** — a customer's own `displayScore` per pillar is live
  today; only the four benchmark-comparison columns are dark.
- `checksRequiresScript` on `msp_diagnostic_runs` (§2) is a real, populated counter column, but
  since 0 checks are flagged `requires_customer_script`, it is always `0` on every live run.

## 5. The honest-empty contract per surface

| Surface | No-customer-context | Customer exists, never scanned | Customer scanned, feature genuinely dark |
|---|---|---|---|
| A `diagnostics/latest` | `{ run: null, findings: [] }` | same (no completed/partial run) | — |
| B `diagnostics/runs/:runId` | `403 "No customer context"` | `404 "Run not found"` for any runId | — |
| C `scripts/:checkKey/download` | `404 "No script available for this check"` | same | `404` at whichever resolution step fails first (§1c) — three distinct messages, all real |
| D `health-benchmark` | `{ pillars: [], asOfDate: null }` | pillars still compute if any run exists (per-tenant score is run-derived, not "scanned" gated the same way) | benchmark columns individually `null` when `industry_benchmark_reference` has no matching row (true for 100% of rows today) |
| E `assessment/status.scan` | `403` (whole endpoint gates on customer identity, `:155-158`) | `{ active: false, runId: null, status: null, ..., everScanned: false }` | — |

## 6. Findings filed from this extraction

**Genuine wiring gap, not a data gap:** `POST/PATCH` on `admin-monitor-checks.ts` accepts
`requiresCustomerScript` (settable), and `admin-ps-scripts.ts` (§1g) is a complete, real CRUD
surface for `script_packages`/`script_modules` — but **no route anywhere in the codebase writes
`monitor_checks.script_package_id`.** Confirmed by a full-repo grep: the only *reads* of that
column are in `msp-diagnostics.ts` (the download route itself) and test fixtures; there is no
admin UI/route that assigns a package to a check. Even if an admin flags a check
`requiresCustomerScript = true` and authors a full script package via §1g, **the two can never be
linked**, so `GET /api/portal/scripts/:checkKey/download` (§1c) is structurally unreachable for
any customer today — not a "no data yet" empty state but a genuine missing endpoint. Filed as
**#2506**, sibling sub-issue of Feature #1660, labeled `bug`.

---

*Extraction performed 2026-09-03 against `main` (commit `79130e2ec` base). Read-only: only this
pack + the session's own bookend changed.*
