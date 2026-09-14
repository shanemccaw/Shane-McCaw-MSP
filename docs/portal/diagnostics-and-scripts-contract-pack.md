# Diagnostics and Scripts — contract extraction pack

**For Claude Design. Extracted, not authored — every claim below is cited to file:line against
the code on `main`.** Read-only build: no product code, no schema, no UI were changed to produce
this document.

Module: **Diagnostics and Scripts** (leaf issue #2451, Feature #1660 "Feature: Diagnostics and
Scripts (Portal)", portal epic #1485). Phase 2 of the Portal build order
(BUILD_QUEUE_METHOD.md §2.1), following the #1642 pattern.

**Freshness re-check (2026-09-14, #2768): the headline gap this pack originally reported is
FIXED.** The wiring gap below was real at extraction (2026-09-03) but was closed the very next
day — **#2506, closed 2026-09-04 as COMPLETED** (`c93fc2517`): `PATCH /api/admin/monitor-checks/:key`
and `POST /api/admin/monitor-checks` now accept `scriptPackageId` (it was missing from the PATCH
`allowedFields` whitelist and the POST insert payload, `admin-monitor-checks.ts:152,197,201`), and
Admin-panel's `MonitorChecks.tsx` got a "Script package" picker. The three-piece mechanism §1c/§4
describe is now genuinely, verifiably wireable end to end — confirmed by #2506's own transactional
SQL harness proof, not just code inspection. **What has NOT changed: nobody has actually used the
new admin picker yet** — live counts below are still all-zero, so §1c's download route still 404s
for every real customer today. The honest distinction Design should carry forward: this is now
"genuinely empty, not yet configured" (§5's normal honest-empty contract), **not** "structurally
unreachable" (the pre-#2506 state). Live-DB counts (re-queried this session against the local
`DATABASE_URL`, 2026-09-14 — check-catalog scale has grown substantially since extraction, the
real trigger for this freshness pass: `monitor_checks` total is now 204 rows, and `config_resources`
— the PowerShell/DSC expansion #2768 was dispatched to check for — now carries 1,538 rows):

| Table | Live rows (2026-09-03) | Live rows (2026-09-14) |
|---|---|---|
| `msp_diagnostic_runs` | 6 (all `status = 'partial'`) | 2 (local dev reseed since — not a product signal) |
| `msp_diagnostic_findings` | 853 | 296 |
| `monitor_checks` (total) | not recorded | **204** |
| `monitor_checks` with `requires_customer_script = true` | 0 | **0** — still nothing flags a check as script-only |
| `script_packages` | 0 | **0** — mechanism is wireable (#2506); nobody has authored one yet |
| `script_modules` | 0 | **0** |
| `industry_benchmark_reference` | 0 | **0** |

`msp_diagnostic_findings.check_status` breakdown on the current corpus: `ok` 234, `license_gap` 38,
`service_not_configured` 11, `error` 9, `partial` 4. **`requires_script` still has zero live
findings** — consistent with zero checks being flagged `requires_customer_script`; this is
unaffected by the #2506 fix, which unblocked the *assignment* mechanism, not the flagging of any
check as script-only.

---

## 0. The surfaces of this module

| # | Surface | File | Audience | Writes? |
|---|---|---|---|---|
| A | `GET /api/portal/diagnostics/latest` | `artifacts/api-server/src/routes/msp-diagnostics.ts:929`* | Customer (the page) | no |
| B | `GET /api/portal/diagnostics/runs/:runId` | `artifacts/api-server/src/routes/msp-diagnostics.ts:1129`* | Customer (run detail) | no |
| C | `GET /api/portal/scripts/:checkKey/download` | `artifacts/api-server/src/routes/msp-diagnostics.ts:986`* | Customer (script download) | no |
| D | `GET /api/portal/health-benchmark` | `artifacts/api-server/src/routes/msp-diagnostics.ts:1064`* | Customer (benchmark widget) | no |
| E | `GET /api/portal/diagnostics/status` — `scan` fragment only (renamed from `/portal/assessment/status` by #1753, 2026-09-03) | `artifacts/api-server/src/routes/portal-assessment.ts:127,416-435` | Customer (assessment wizard's live-scan step) | no |
| F | MSP operator diagnostics routes (trigger/list/detail/SSE) | `artifacts/api-server/src/routes/msp-diagnostics.ts:300-717`* | MSP operator (customer-detail Diagnostics tab) | trigger only |
| F2 | MSP operator Scripts mirror (list + download, #2673) | `artifacts/api-server/src/routes/msp-diagnostics.ts:735-911`* | MSP operator (customer-detail Scripts tab) | no |
| G | Admin PS-Scripts authoring (packages/modules) | `artifacts/api-server/src/routes/admin-ps-scripts.ts` | Platform admin (authoring) | yes |

*Line ranges re-verified 2026-09-14 against current `main`. F/F2 shifted +89 from the original
extraction because `GET /msp/monitoring-packages/runnable` (#1770, `:270-292`) was inserted ahead
of the trigger route; A-D shifted +286 (the same +89, plus the new F2 Scripts-mirror block and a
new `findingSeverityRank` helper, both inserted ahead of the customer-facing routes). Content is
otherwise unchanged for A-D — verified line-for-line against the current file.

**A–D are the customer-facing Diagnostics and Scripts page's real surfaces.** E is a shared
fragment of the Assessment wizard's status-poll endpoint — the wizard's `scan` object is sourced
from the exact same `msp_diagnostic_runs` row this module scans, so it is documented here as a
cross-surface edge, not a fifth customer route to design independently. F/F2 are MSP-operator-side
(customer-detail tab, not the customer portal). **F2 is new since extraction** — added by #2673,
a real MSP-operator mirror of the customer Scripts surface: `GET /msp/customers/:customerId/scripts`
lists every `requires_script` finding on the customer's latest run with a per-check
`available: true/false` flag (honest, never invented — computed the same three-step resolution
§1c walks), and `GET /msp/customers/:customerId/scripts/:checkKey/download` mirrors §1c exactly but
scoped by `assertCustomerAccess` instead of "caller IS this customer." Its purpose is to let an
operator see *why* a customer's download would fail before they try it — it surfaces the gap, it
does not by itself fix it (fixing it was #2506, see the headline note above). G is the admin
authoring surface for script content — real and fully built; **as of #2506 (2026-09-04) it can
also be linked to a check**, closing what was previously a genuine missing-endpoint gap.

**Old portal-v2 endpoint list, verified against current code (per #2451 Step 1):**

| Old portal-v2 endpoint | Current status |
|---|---|
| `portal/assessment/status` | **Live, renamed to `portal/diagnostics/status` by #1753** — only the `scan` fragment belongs to this module (§0 row E); the rest (`documents`, `narrative`, `radar`, `mfa`, `docGeneration`) belongs to the Assessment/CIO-Report Feature, not Diagnostics and Scripts |
| `portal/diagnostics/latest` | **Live**, unchanged shape from what the name implies — §1a |
| `portal/health-benchmark` | **Live** — §1d |
| `portal/offers` | **Not part of this module.** Real and live (`artifacts/api-server/src/routes/portal-offers.ts:134`), but it is the Sales Offer engine's own customer surface, unrelated to diagnostics/scripts data. Not documented further here — see the Portal Admin (#1571) / offers module contract if one exists. |
| `portal/scripts` | **Never existed as a list endpoint.** No `router.get("/portal/scripts", ...)` anywhere in the codebase — confirmed by full-repo grep. The old page's list, if it rendered one, was never backed by a real list route. |
| `portal/scripts/` | Same as above — no trailing-slash variant exists either. |
| `portal/scripts/:id/download` | **Live**, real route, but the id is a `checkKey` (a `monitor_checks.key` string), not a numeric script id — §1c. |

---

## 1. Per-surface wire contract

### 1a. `GET /api/portal/diagnostics/latest` — customer surface (A)

Source: `msp-diagnostics.ts:928-976`* (was `:642-690` at extraction; +286 line drift, see §0's
note — content unchanged). Auth: `requireAuth` (`:930`) — any authenticated portal role, not gated
to `Customer` (formerly `CustomerUser`, renamed by #3590) specifically. Customer id resolution:
`resolveCallerCustomerId` (`:219-227`, was `:197-205`) reads `user.customerId` from the JWT,
falling back to a fresh `users.tenant_id` lookup for the stale-JWT window. Read-only.

Response shape:

```
{ run: MspDiagnosticRun | null, findings: FindingSummary[] }
```

| Field | Type | Nullability | Line |
|---|---|---|---|
| `run` | full `msp_diagnostic_runs` row (§2) | `null` when the customer has no `completed`/`partial` run yet, or no resolvable customerId (`:938`) | `940-951` |
| `findings` | `FindingSummary[]` (below) | `[]` in the same two no-run cases | `955-968` |

**`FindingSummary`** (`:956-965`) — deliberately narrower than the full findings row; no
`extractedProperties` (raw Graph payload) or `recommendation` object reach the customer here:

| Field | Type | Nullability | Line |
|---|---|---|---|
| `findingId` | `string` (uuid) | never null | `957` |
| `checkKey` | `string` | never null | `958` |
| `checkLabel` | `string` | never null | `959` |
| `severity` | `"ok" \| "info" \| "warning" \| "critical"` | never null | `960` |
| `title` | `string` | never null | `961` |
| `description` | `string \| null` | `962` |
| `checkStatus` | `string \| null` (§3 vocabulary) | `963` |
| `createdAt` | `Date` (serialized ISO) | never null | `964` |

`run` selects **only `completed` or `partial`** status rows (`:943-949`) — a `pending`/`running`
run in flight is invisible to this endpoint by design; the live scan strip that shows an
in-progress run reads `E` (`/portal/diagnostics/status`'s `scan` fragment) instead, which has no
such filter (`ACTIVE_RUN_STATUSES`, `portal-assessment.ts:136,181-182`).

*Line numbers in §1a re-verified 2026-09-14; +286 drift from extraction, content unchanged
(see §0's note).

### 1b. `GET /api/portal/diagnostics/runs/:runId` — customer run detail (B)

Source: `msp-diagnostics.ts:1128-1180`* (was `:842-885` at extraction; +286 line drift, content
unchanged except a real defense-in-depth addition, see below). Auth: `requireAuth` (`:1130`).
Customer id: **directly `user.customerId`** off the JWT (`:1134`), no DB fallback unlike 1a/1c/1d
— a stale JWT with no `customerId` claim gets a `403 { error: "No customer context" }` here rather
than the fallback lookup 1a/1c/1d use. Read-only.

```
{ run: MspDiagnosticRun, findings: FindingSummary[] }   // 200
{ error: "Run not found" }                              // 404 — wrong customer or unknown runId
```

`run` and `findings` (`:1150-1172`, was `:864-877`) are the **same shapes** as §1a — no additional
fields (no raw `extractedProperties`, no `recommendation`) even at single-run granularity.
Ownership is enforced by the query itself (`eq(runId) AND eq(customerId)`, `:1139-1146`, was
`:856-859`) — a `runId` belonging to another customer 404s rather than leaking. **New defense-in-
depth since extraction (#3362, same class as #3102):** the `findings` query now *also* scopes on
`eq(mspDiagnosticFindingsTable.customerId, customerId)` (`:1170`) — `customer_id` is denormalized
on the findings table with only an FK from `run_id`, not a constraint tying a finding's own
`customer_id` to its run's, so this reads by tenant on its own terms rather than relying solely on
the run-ownership check above. Does not change the response shape.

### 1c. `GET /api/portal/scripts/:checkKey/download` — script download (C)

Source: `msp-diagnostics.ts:985-1055`* (was `:699-769` at extraction; +286 line drift, content
unchanged). Auth: `requireAuth` (`:987`). Not a JSON endpoint — streams the raw script file.

Resolution chain, in order, each step 404-ing honestly if it fails (`:993-1041`):

1. `resolveCallerCustomerId(user)` → 404 `"No script available for this check"` if no customer.
2. The caller must have an actual `msp_diagnostic_findings` row for this exact `customerId` +
   `checkKey` with `checkStatus = 'requires_script'` (`:1000-1009`) — **not** just any finding for
   that check. This is the scoping the file header promises: guessing an unrelated `checkKey`
   never leaks script content the caller's own scan didn't surface.
3. `monitor_checks.script_package_id` for that `checkKey` must be non-null (`:1016-1025`) → 404
   `"No script has been assigned to this check yet"` otherwise.
4. The first `script_modules` row for that package (by `sort_order`, `:1027-1035`) must exist →
   same 404 otherwise.

Success response: `200`, `Content-Type: application/octet-stream`,
`Content-Disposition: attachment; filename="<module.filename or checkKey.ps1>"`, raw script text
as the body (`:1043-1055`).

**Because step 2 and 3 both require live data that does not currently exist anywhere in this
database (0 `requires_script` findings, 0 `script_package_id` assignments), every real call to
this endpoint today 404s at step 2.** See §6.

### 1d. `GET /api/portal/health-benchmark` — benchmark widget (D)

Source: `msp-diagnostics.ts:1063-1123`* (was `:777-837` at extraction — file grew ~200 lines
ahead of this route, see §0's F/F2 note). Auth: `requireAuth`, deliberately not
`requireCapability("ladder.customer-user")` (was `requireRole` at extraction — RBAC renamed by
#2460) — the route's own comment (`:1065-1069`) explains this was loosened for #1157 (a stricter
floor silently 403'd Free-tier customers with real data the frontend couldn't distinguish from
"no data"). Read-only. Never exposes raw risk scores or `breakdown.contributions`.

```
{ pillars: PillarBenchmark[], asOfDate: string | null }
```

No-customer-context shape: `{ pillars: [], asOfDate: null }` (`:1078`, was `:792`).

**`PillarBenchmark`** (`:1100-1110`, was `:814-824`):

| Field | Type | Nullability | Line |
|---|---|---|---|
| `pillar` | `string` (pillar key) | never null | `1103` |
| `displayScore` | `number` (0–100, higher = healthier) | never null | `1104` |
| `industryAvgPct` | `number \| null` | **always `null` today** — `industry_benchmark_reference` has 0 rows live | `1105` |
| `msExcellencePct` | `number \| null` | **always `null` today**, same reason | `1106` |
| `source` | `string \| null` | **always `null` today** | `1107` |
| `asOfDate` | `string \| null` (date) | **always `null` today** | `1108` |

`pillars` itself is computed from `calculateArchitectureHealthScore` + `computeDisplayHealth`
(`:1083,1096`, was `:797,810`) — real per-tenant scoring, unaffected by the empty benchmark-reference
table. Only the four benchmark-comparison fields per pillar are dark. Top-level `asOfDate`
(`:1112-1115`, was `:826-829`) is the most recent `industry_benchmark_reference.as_of_date` across
all rows — also `null` today for the same reason.

*Line numbers in §1d re-verified 2026-09-14; +286 drift from extraction, content unchanged.

### 1e. `GET /api/portal/diagnostics/status` — the `scan` fragment (E)

**Path renamed since extraction — real, breaking change (#1753, 2026-09-03).** This route was
`GET /api/portal/assessment/status` at extraction time; #1753 retired the whole `/portal/assessment/*`
prefix (14 dead SOW/checkout/documents/stripe routes deleted outright, 13 surviving routes renamed
to `/portal/diagnostics/*`) and this is one of the 13 survivors. Any Design or client reference to
the old path is stale.

Source: `portal-assessment.ts:127-454` (this pack documents only the `scan` sub-object, `:416-435`
— the rest of this endpoint's payload, `narrative`/`documents`/`mfa`/`docGeneration`/`radar`,
belongs to the Assessment/CIO-Report Feature). Auth: `requireCapability("ladder.free")` (`:132`) —
**also renamed since extraction**: the whole platform's RBAC layer moved from `requireRole`/string
role checks to `requireCapability`/capability-ladder checks (#2460), and the `Assessment` role
itself was folded into a `Free` capability rung with `CustomerUser` renamed to `Customer` (#3590).
`ladder.free` is still the lowest floor in the codebase, so `Customer`/paid tiers above it also
pass — same real behavior as before, new names.

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

Real and live, `requireCapability("ladder.msp-operator")` throughout (was `requireRole("MSPOperator")`
at extraction — RBAC renamed by #2460), all in `msp-diagnostics.ts`. Line numbers below re-verified
2026-09-14 — all shifted +89 from extraction because `GET /msp/monitoring-packages/runnable`
(#1770) was inserted ahead of this block:

| Route | Line | Behavior |
|---|---|---|
| `POST /api/msp/customers/:customerId/diagnostics/run` | `300-413` | Fire-and-forget trigger: inserts one `pending` run row, responds `202` immediately, runs `runDiagnostics()` async. `packageKey` resolves from the customer's active `monitoring_subscription` client service, falling back to `core:security-baseline`, or an operator override real-validated against `GET /msp/monitoring-packages/runnable` below. |
| `GET /api/msp/monitoring-packages/runnable` | `270-292` | **New since extraction (#1770).** Lists real, active, `kind = 'scan_bundle'` `monitoring_packages` rows with a real per-package check count, so the "Run scan" picker can offer a real choice instead of always defaulting silently. Excludes `kind = 'dashboard_category'` rows (a different table use, zero real checks) via a real `kind` filter, not just a check-count `HAVING` guard (Git #3453). |
| `GET /api/msp/customers/:customerId/monitoring-package` | `419-474` | Resolved `packageKey` + service name for the "Run Diagnostics" button gate. |
| `GET /api/msp/customers/:customerId/diagnostics` | `478-522` | Paginated `{ runs, total, limit, offset }`. |
| `GET /api/msp/customers/:customerId/diagnostics/runs` | `529-565` | Plain array, most recent first, **different envelope** than the route above — same data, two shapes coexist. |
| `GET /api/msp/customers/:customerId/diagnostics/runs/:runId` | `569-617` | `{ run, findings }` — **full** findings rows (not the narrower `FindingSummary` §1a uses), each carrying a computed `classification` (#379, see §3). Findings now sort by a real severity-rank `CASE` expression (`findingSeverityRank`, #3388) instead of alphabetically — alphabetical sort put `warning` after `ok`, last instead of near `critical`. |
| `GET /api/msp/customers/:customerId/diagnostics/runs/:runId/sse` | `623-717` | Live per-check progress stream, JWT via `?jwt=` query param (EventSource can't send headers). Full contract: `docs/portal/scan-progress-sse-contract-pack.md`. |
| `GET /api/msp/customers/:customerId/scripts` | `735-834` | **New since extraction (#2673, see §0 row F2).** |
| `GET /api/msp/customers/:customerId/scripts/:checkKey/download` | `842-911` | **New since extraction (#2673, see §0 row F2).** |

### 1g. Admin PS-Scripts authoring (G) — `admin-ps-scripts.ts`

Full CRUD surface exists and is real: `POST /admin/ps-scripts`, `POST /admin/ps-scripts/packages`,
`GET /admin/ps-scripts/packages`, `PATCH .../packages/:id`, `DELETE .../packages/:id`,
`POST .../packages/:id/modules`, `PUT /admin/ps-scripts/modules/:id`,
`DELETE /admin/ps-scripts/modules/:id` — all `requireAdmin`. This is a genuinely complete
authoring surface for `script_packages`/`script_modules` content, and **as of #2506
(2026-09-04) it can now be linked to a `monitor_checks` row** — the gap this pack originally
flagged in §6 is fixed; see the headline note at the top of this pack.

**AI-assisted generation routes — real staleness, two of three routes this pack originally listed
no longer exist.** #3957 (decommissioned 2026-09-14, same day as this freshness pass) removed
`POST /admin/ps-scripts/generate-from-service` and `POST /admin/ps-scripts/generate-from-document`
outright — both were live, unmetered `claude-haiku-4-5` calls with no `withAiAttribution`, and
Shane's decision was to remove the capability rather than fix the metering gap. Their Admin Panel
dialogs (`GenerateFromServiceDialog`/`GenerateFromDocumentDialog`, the "From Service"/"From
Document" buttons in `ScriptGeneratorPage.tsx`) were deleted too. **Still real and untouched:**
the freeform `POST /admin/ps-scripts/generate`, `POST /admin/ps-scripts/generate-from-task`,
`POST /admin/ps-scripts/:id/analyze-permissions`, `.../fix`, `.../explain`, `.../modularize` — all
`requireAdmin`. Design should not draw a "generate from service"/"generate from document" entry
point anywhere in this surface; it is gone, not merely unwired.

---

## 2. `msp_diagnostic_runs` — the shared row every customer-facing surface reads

`lib/db/src/schema/msp.ts:3664-3704`* (was `:3270-3310` at extraction — the schema file grew
~1,650 net lines from unrelated table additions ahead of this point; column shapes below are
unchanged, only citations moved). Selected in full (`SELECT *`) by every route above except
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

**`MspDiagnosticRunStatus`** (`msp.ts:3662`, was `:3267`): `"pending" | "running" | "completed" | "failed" | "partial"` — unchanged.
Live corpus 2026-09-14: 2 rows (local dev reseed since extraction), not a shape signal.

**`MspDiagnosticFindingSeverity`** (`msp.ts:3715`, was `:3320`): `"ok" | "info" | "warning" | "critical"` — unchanged.

**Finding `checkStatus`** — free `text`, not a DB enum, but a real closed vocabulary enforced by
the executor (`monitor-executor.ts:330`, was `:353`) — **unchanged**:
`"ok" | "error" | "consent_revoked" | "requires_script" | "license_gap" | "partial" | "service_not_configured" | "azure_no_rbac" | "azure_no_subscriptions" | "power_platform_not_registered"`.
Live corpus 2026-09-14 exercises five of these nine values (`ok` 234, `license_gap` 38,
`service_not_configured` 11, `error` 9, `partial` 4) — `requires_script`, `consent_revoked`,
`azure_no_rbac`, `azure_no_subscriptions`, `power_platform_not_registered` still have zero live
findings.

**`MspDiagnosticFindingSource`** (`msp.ts:3723`, was `:3328`): `"baseline" | "policy"` — every live finding is
`"baseline"` (the column default); no `standing_policies`-sourced finding exists yet in this
database, which is out of this module's scope to verify further.

**#379 failure `classification`** (MSP operator surface F only, `msp-diagnostics.ts:79-166`): a
finding is only ever classified (via `classifyMonitorFailure`) when it carries a real raw Graph
error (`extractedProperties._rawGraphError`) or its `checkStatus` is one of `license_gap` /
`consent_revoked` / `service_not_configured` — every other finding's `classification` is `null`,
by design, not by gap (`:108-117`).

## 4. Cross-surface edges

- **§1e (`/portal/diagnostics/status`, formerly `/portal/assessment/status` → `scan`) and
  §1a/§1b/§1f all read the same `msp_diagnostic_runs`/`msp_diagnostic_findings` tables**, but
  §1e's `latestRun` selector is unconditional on status while §1a/§1b filter to
  `completed`/`partial` only — an in-progress scan is visible to the wizard (E) before it is
  visible to the diagnostics page itself (A/B).
- **§1c (script download) depends on three independently-real pieces, now genuinely connectable
  (fixed by #2506, 2026-09-04 — see the headline note)**: a `msp_diagnostic_findings` row with
  `checkStatus = 'requires_script'` (produced only when `monitor_checks.requires_customer_script
  = true`, admin-settable per §1g's sibling `admin-monitor-checks.ts`), a non-null
  `monitor_checks.script_package_id` (now assignable via `PATCH /api/admin/monitor-checks/:key`
  and Admin-panel's `MonitorChecks.tsx` picker), and a `script_modules` row under that package
  (authored via §1g). All three are real, working mechanisms **and the third can now be wired to
  the first two** — none currently has live data (nobody has used the new picker yet), which is
  the ordinary honest-empty case (§5), not the pre-#2506 structural dead end.
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
| E `diagnostics/status.scan` (renamed from `assessment/status.scan` by #1753) | `403 "No customer identity on token"` (whole endpoint gates on customer identity, `:137`) | `{ active: false, runId: null, status: null, ..., everScanned: false }` | — |

## 6. Findings filed from this extraction — status re-verified 2026-09-14

**#2506 — CLOSED 2026-09-04 as COMPLETED (`c93fc2517`).** Original finding: `POST/PATCH` on
`admin-monitor-checks.ts` accepted `requiresCustomerScript` (settable), and `admin-ps-scripts.ts`
(§1g) was a complete, real CRUD surface for `script_packages`/`script_modules` — but no route
anywhere in the codebase wrote `monitor_checks.script_package_id`, so `GET
/api/portal/scripts/:checkKey/download` (§1c) was structurally unreachable for any customer. Real
fix, verified: `PATCH /api/admin/monitor-checks/:key` and `POST /api/admin/monitor-checks` now
accept `scriptPackageId` (`admin-monitor-checks.ts:152,197,201`), and Admin-panel's
`MonitorChecks.tsx` got a "Script package" picker. The fixing session's own transactional SQL
harness proved the full `key → script_package_id → module filename` resolution chain resolves
correctly. **No new unresolved wiring gap exists in this module as of this freshness pass** — the
remaining "all-zero" live counts (headline table above) are genuinely nobody-has-used-it-yet, not
structurally broken.

---

*Extraction performed 2026-09-03 against `main` (commit `79130e2ec` base). Freshness re-checked
2026-09-14 against `main` (commit `2ee6ac1cf` base, per #2768) via git-diff-against-extraction-commit
on every cited source file. Real changes found and reflected above: `/portal/assessment/status` →
`/portal/diagnostics/status` (#1753, breaking rename); RBAC `requireRole`/`CustomerUser` →
`requireCapability`/`Customer` throughout (#2460, #3590); two new MSP-operator Scripts routes
(#2673); two AI-generation admin routes decommissioned (#3957); the headline wiring gap (#2506)
fixed; live-DB counts refreshed; file:line citations updated for ~90-200 line drift from unrelated
insertions in `msp-diagnostics.ts`/`lib/db/src/schema/msp.ts`. Wire shapes, enum vocabularies, and
the honest-empty contract (§5) held unchanged throughout. Read-only: only this pack + the
session's own bookend changed.*
