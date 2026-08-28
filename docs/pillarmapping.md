# Pillar Mapping — every real backend data source, its pillar, and its real shape

**Issue:** #1481 (parent #1202) · **Investigated:** 2026-08-28 · **Author:** Claude Code build session (read-only investigation)

This document is written for **Claude Design**, which has **no access to this repository or its database**. Everything needed to act on it is in this file. Its purpose: state, with evidence, exactly which portal data sources are real, which are partially real, and which are absent — so the portal-v2 UI can be rebuilt to render what genuinely exists at its true shape, and UI elements with nothing real behind them can be deleted.

**Evidence discipline.** Every claim below traces to one of: (a) a live SQL query against the platform's PostgreSQL database (`shanemccawmsp`), run 2026-08-28; (b) a real file path + line in this repo (pinned at commit `83519d8d`, re-based to `39a2a0ba` mid-session); (c) a live protocol call against the running platform (a fresh diagnostic scan of the testbed tenant, a live `shaneapp://executeCmdlet` PowerShell execution, and a live authenticated capture of the portal's own pillar payload). Where something could not be verified live, it is labelled as such with the exact blocker — never presented as observed. §10 is the full evidence log; §11 the explicit unknowns.

**Environment caveat, stated once so every claim inherits it:** all live observations are against the **local dev platform** (local PostgreSQL 18, dev api-server on `localhost:8080`, dev ps-execution container `ca-ps-execution-dev`) and two real Microsoft 365 tenants: the **testbed** `mccawsoft2.onmicrosoft.com` (customers table id 1, Entra tenant `c4c814d4-3afe-441e-9145-62461d0a4fd3`, `is_testbed=true`) and `shanemccaw.onmicrosoft.com` (id 3, `0a361ab2-…`, a real non-testbed tenant with observations dated 2026-08-09 → 2026-08-24). The owner cleaned old run/snapshot history from this database earlier on 2026-08-28 and then ran a **fresh full diagnostic scan** (run 437, package `assess:copilot-readiness`, 101 checks) against the testbed mid-investigation, so the freshest evidence in this file is from a scan a few hours old. A third tenant id (`e2e13170-…`) exists in the observation table; it is a **synthetic E2E-harness tenant**, and nothing in this document treats its rows as real-tenant evidence. Gov/GCC tenants are out of platform scope and are not mapped.

---

## 1. Executive summary

The platform's backend check catalog is a **database table, not code**: `monitor_checks`, 157 rows. Each row is one check with its own executor type, Graph endpoint or PowerShell cmdlet, extraction mapping, severity rules, and engine (pillar) tags. Live counts (2026-08-28):

| Executor type | Active | Inactive | Total |
|---|---|---|---|
| `graph` (Microsoft Graph REST) | 136 | 2 | 138 |
| `powershell` (EXO / Purview / Teams cmdlet via the ps-execution container) | 17 | 0 | 17 |
| `dns` (public DNS TXT lookups) | 1 | 0 | 1 |
| `sharepoint-admin` (SharePoint admin API, app-only cert) | 1 | 0 | 1 |
| **Total** | **155** | **2** | **157** |

**Three-state classification of the 157 catalog checks: 96 REAL · 61 PARTIAL · (ABSENT applies to referenced-but-nonexistent checks, §8).**

Headline findings, most consequential first:

1. **The entire PowerShell execution layer is PARTIAL today — all 17 checks.** They ARE genuinely invoked by real scan runs (the package runner does not filter them out — `artifacts/api-server/src/lib/monitor-executor.ts:2919-2951` filters only on `status='active'`), which settles #1386's open question. But every live execution observed on a real tenant errors with *"The request-handling child process produced malformed output."* This was proven end-to-end during this investigation with a live `shaneapp://executeCmdlet` call running the trivial `get-connection-info` cmdlet against the testbed: it failed with the same error (`kind: script_error`, container `ca-ps-execution-dev`, 4.8s round trip). The failure is in the container's child-process layer, before any cmdlet specifics — no PowerShell check can currently deliver data. Five compliance PS checks additionally license-gate honestly *before* reaching the container (the Graph-side SKU probe runs first), which is why customer 3 shows `license_gap` for them rather than `error`.
2. **A second large PARTIAL class is "wired but never once run": 34 active Graph checks have zero observations on any real tenant** — they belong only to packages (`core:growth`, `core:premier`, `core:enhanced-monitoring`, `core:foundation`, `detail:full-item-collection`, both `assess:*` scans other than copilot-readiness) that **no real run has ever executed**. The only packages ever observed running are `assess:copilot-readiness` (the assessment scan — runs 362 and 437) and `core:security-baseline` (the recurring monitoring workflow — every `wf-run-*` trigger's row set is exactly its membership, verified by join). Every `devices:*` check is in this never-run class: **the portal has never collected a single Intune device fact for any real tenant.**
3. **The dashboard registry names 67 checks that do not exist** (§8). These resolve — live-verified — to the resolver's literal `unknown_check_key` outcome. Eleven of them surface directly on the portal's pillar heroes today (captured live in the war-room payload, §9.1): every hero tile for oversharing/blast-radius (`copilot:overshare-exposure`, referenced by three different pillars), SharePoint inventory (`compliance:sharepoint-sites`, `compliance:overshared-sites`, `compliance:public-channels`), and the Health pillar's four device tiles (`intune:*` names that don't match the real `devices:*` catalog vocabulary). Some phantoms are pure naming drift — a same-meaning check exists under another key (`intune:non-compliant-devices` vs real `devices:compliant-vs-noncompliant`, `licensing:duplicate-assignments` vs real `cost:duplicate-assignments`); most have no counterpart at all (`dynamics:*`, `power-platform:*`, `collaboration:*`, the `security:*` alert family).
4. **The pillar model has three vocabularies, and they do not line up 1:1** (§2). Design should treat the **7 display pillars** as canonical: `governance, compliance, adoption, copilot, architecture (labelled "Health"), licensing, security`. The check catalog tags checks with **engine tags** (`security, governance, adoption, health, compliance, priority, cost, copilot, licensing, architecture, monitoring`) where `health` ≈ the architecture pillar and `cost` feeds licensing; `priority` is a ranking engine, not a pillar.
5. **Pillar scores are real and freshly proven.** Run 437 wrote one `tenant_pillar_snapshots` row per pillar for the testbed (security 54, licensing 54, architecture 8, copilot 50, adoption 89, compliance 73, governance 54), and the live authenticated portal payload returns exactly those scores with per-pillar evaluation metadata (`evaluableSignalCount`, `reason`). The **raw engine score layer is a different story**: `tenant_engine_snapshots` is written only when engines run through Mission Control or admin routes (`engine-registry.ts:478-482` wraps `runForTenant`); the scan path and the pillar payload never write it. It held 0 rows all session, so all 16 `engine.*` registry metrics resolve `not_available` right now.
6. **Config-drift is newly real but empty.** Run 437 captured the platform's first 2 drift baselines for the testbed (`ca-policy` and `email-authentication` `tracked`; `eeeu-site-sharing` honestly `not_comparable`). `drift_events` = 0 — nothing has changed since baseline. 5 of the 18 registry drift domains have a collection spec; the other 13 can never produce data until specs are written.
7. **What is genuinely REAL is substantial**: 96 checks observed executing against real tenants with real data — the identity/CA family, secure score, Teams governance, SharePoint site facts, licensing SKU truth, adoption activity reports, app governance, DNS email-auth — plus a real findings pipeline (98 findings on the testbed run), real per-item evidence (`tenant_check_item_details`, 98 checks' item lists for run 437), and honest `license_gap` states for the 21 checks the testbed's SKUs can't feed (it has no AAD P1/P2 and no Defender for Office 365).

Per-pillar totals for the 157 catalog checks (a check tagged with two pillar engines counts once per pillar; "architecture/Health" merges the `health` + `architecture` tags; "licensing/cost" merges `licensing` + `cost`; `priority`/`monitoring`/untagged listed separately):

| Pillar (from engine tags) | REAL | PARTIAL | Total |
|---|---|---|---|
| Security | 46 | 16 | 62 |
| Governance | 33 | 11 | 44 |
| Compliance | 7 | 8 | 15 |
| Adoption | 7 | 9 | 16 |
| Copilot Readiness | 9 | 0 | 9 |
| Health (architecture) | 8 | 17 | 25 |
| Licensing & Cost | 5 | 9 | 14 |
| priority (ranking engine, cross-cutting) | 14 | 3 | 17 |
| monitoring (engine-internal) | 1 | 0 | 1 |
| (untagged) | 2 | 1 | 3 |


## 2. The pillar model — three vocabularies and who persists what

**(a) Display pillars — canonical for Design.** `RADAR_PILLARS` = the 6 `HEALTH_PILLARS` + `security` (`artifacts/api-server/src/lib/health-engine.ts:53-61`, `pillar-coverage.ts:110-122`):

| pillar key | UI label | note |
|---|---|---|
| `governance` | Governance | |
| `compliance` | Compliance | |
| `adoption` | Adoption | |
| `copilot` | Copilot Readiness | |
| `architecture` | **Health** | the aliasing trap: snapshot/pillar key `architecture`, war-room payload key `health`, UI label "Health" |
| `licensing` | Licensing | |
| `security` | Security | radar/7th pillar; deliberately NOT in `HEALTH_PILLARS` (Git #1098/#1137) — never add it there |

**(b) Engine tags on checks** — `monitor_checks.engines` (jsonb array): `security` (34 single-tagged), `governance` (24), `adoption` (12), `health` (12), `compliance` (11), `cost` (5), `copilot` (3), plus two-tag combinations, `priority` (always paired, a ranking weight for the Priority engine — not a display pillar), `licensing`/`architecture` (1 each), `monitoring` (1), and 3 checks with no tags (`m365:message-center`, `m365:service-health`, `diagnostics:ps-execution-test`). The live war-room payload routes `m365:message-center` findings to the governance pillar (`checkKeyPillars` in the captured payload).

**(c) Scoring engines** — `ENGINE_DEFS` (`engine-registry.ts:181`): `priority, pricing, health ("Architecture Health Engine"), security, drift, forecasting, crm, msp, sla, scope_creep, monitoring, sales_offer`. These produce raw scores (unbounded "risk points", e.g. security rawRiskScore 197 alongside display score 54).

**Who persists what — verified live:**

| Table | Written by | State observed 2026-08-28 |
|---|---|---|
| `tenant_monitor_profiles` | every check execution (`persistCheckProfile`, monitor-executor.ts:1738) | 727 rows, 3 tenant ids; the per-check observation store (status, extracted_properties, severity, raw_response) |
| `tenant_pillar_snapshots` | `capturePillarDisplaySnapshots` on `diagnostics.run_completed`, gated on graded coverage (`pillar-snapshot.ts:51-109`, invoked diagnostics-runner.ts:1085) | 7 rows for customer 1, written by run 437 — scores match the live payload exactly |
| `tenant_engine_snapshots` | ONLY the wrapped `runForTenant` (engine-registry.ts:478-482), reached via `portal-mission-control.ts` / `admin-engines.ts` — **not** by scans, **not** by the war-room payload | **0 rows** all session, before and after both the scan and a live war-room fetch |
| `msp_diagnostic_runs` / `msp_diagnostic_findings` | diagnostics-runner.ts | 2 runs (362 customer-3 2026-08-09; 437 testbed today); 98 findings for 437 |
| `tenant_check_item_details` | item-detail-collector.ts (the `detail:full-item-collection` collection mode) | 98 distinct checks' full item lists for customer 1 |
| `drift_baseline_snapshots` / `drift_events` / `drift_collection_status` | `collectDriftForCompletedCheck` (monitor-executor.ts:153) per completed check with a spec in `drift-check-specs.ts` | 2 baselines + 3 status rows (from run 437); 0 events |
| `engine_baseline_history`, `engine_score_daily_rollup`, `engine_score_signal_deltas` | engine snapshot side-effects | 0 rows each |

**How a pillar score is computed:** `getPillarCoverage(packageKey, customerId)` (`pillar-coverage.ts`) — the same function the live dashboard calls — evaluates intelligence signals over the tenant's `tenant_monitor_profiles` rows, producing a 0-100 display score per pillar with an evaluation record. Observed live for the testbed: e.g. governance `{score: 54, evaluableSignalCount: 30, minRequiredSignals: 2, theoreticalMax: 154, status: "scored", reason: "scored from 30 evaluable governance signals"}`. A pillar with too few evaluable signals returns `status !== "scored"` and the UI must render its unscored state — this is a real state, not an error.

## 3. How a check executes

One dispatcher: `executeMonitorCheck` (`monitor-executor.ts:2532`), branching on `executor_type` at :2635 (powershell → `runPowerShellCheck` :1761), :2645 (sharepoint-admin → :1980), :2655 (dns → :2139); default Graph. All four paths share the identical downstream contract: items → `applyMapping` (:1029) → output-schema validation → `classifySeverity` (:865) → persistence to `tenant_monitor_profiles`.

- **Graph path**: builds the request from the check row's own `endpoint`/`method`/`select_params`/`filter_params`/`request_body`, app-only token, `@odata.nextLink` pagination (`graphFetchPaginated` :1504), CSV report parsing for `/reports/*` endpoints (:590-602). Endpoint placeholders like `{itemId}` are resolved per fan-out item (:491).
- **Fan-out checks** (7): `fan_out_source` lists a collection endpoint (e.g. `/sites/getAllSites`, `/groups?$select=id`), then the per-item endpoint runs per item up to `fan_out_max_items` (`runFanOutCheck` :2277). A fan-out that partially fails returns status **`partial`** with a coverage note observed live as: *"Fan-out coverage: 3/4 items succeeded, 1 failed"* — and a `partial` check makes the whole run `partial_failure` exactly like an error (:3073-3079). The 7: `adoption:planner-usage`, `compliance:eeeu-site-sharing`, `copilot:data-exposure-risk`, `identity:pim-groups`, `onedrive:overshared-files`, `teams:channel-sprawl`, `teams:guest-settings-governance`.
- **PowerShell path**: `runPowerShellCheck` → `callPsExecution()` → Azure Container App (`ca-ps-execution-dev` for dev, `ca-ps-execution` for prod, selected by environment — #1385). The container resolves `ps_cmdlet_key` against a **code-owned catalog** (`services/ps-execution/cmdlet-catalog.ps1`) — never a script from the request — spawns a fresh child `pwsh` per request (#1400), connects app-only with a cert (`Connect-IPPSSession` for `compliance` session type, `Connect-ExchangeOnline` for `exchange`, `Connect-MicrosoftTeams` for `teams` — `child-worker.ps1:86-125`), invokes the one cmdlet, applies an optional code-owned `PostFilter`, returns JSON.
- **DNS path** (`runDnsCheck` :2139): resolves the tenant's mail domain from `tenants.domain`, then three public TXT lookups — SPF at `<domain>`, DMARC at `_dmarc.<domain>`, DKIM at `selector1._domainkey.<domain>` and `selector2._domainkey.<domain>` (default selectors only — a custom-selector tenant reads as not-found, and the field name says so honestly). Produces exactly ONE item (shape in §7.3).
- **SharePoint-admin path** (:1980): app-only cert auth (`MT_APP_CLIENT_ID` / `MT_APP_CERT_PRIVATE_KEY` / thumbprint) against the tenant's SharePoint admin endpoint; the single check's `sp_operation` = `tenant-sharing-capability` (one tenant-wide setting, one item per run).
- **License gates**: checks needing AAD P1/P2, Defender for Office 365, or Purview probe the tenant's SKUs first and return status **`license_gap`** with a precise, human-readable reason (observed literals in §7.2) — an honest, renderable state, not a failure; `license_gap` never makes a run `partial_failure` (:3064-3068).
- **Check statuses** (the complete observed + declared set): `ok | error | license_gap | partial | consent_revoked | requires_script`. Observed distribution across all real-tenant rows on 2026-08-28: ok 234+, error, license_gap 78+, partial 4 (pre-cleanup counts), plus run 437's 72 ok / 6 error / 21 license_gap / 2 partial.

**What actually triggers real runs** (all callers of `executeMonitoringPackage`, verified by grep + live trigger ids):
1. **Assessment/diagnostics scan** — `diagnostics-runner.ts:736` (trigger ids `diag-run-<uuid>`). Observed packages: `assess:copilot-readiness` only.
2. **Recurring monitoring workflow** — `workflow-executor.ts:8354` `execute_pkg` node (trigger ids `wf-run-<n>-node-execute_pkg`). Observed package: `core:security-baseline` (verified: every row set of a wf-run trigger is exactly its 23-24 member checks).
3. **Item-detail collection** — `item-detail-collector.ts:244` (runs alongside scoring scans; never contributes to scoring).
4. **Simulator Studio single-check run** — `admin-monitor-check-runs.ts:184` (also reachable as `shaneapp://executeScan`). **A check runnable only here is PARTIAL by definition (#1386)** — this path is an operator tool, not a scan.

**Monitoring packages** (`monitoring_packages` + `monitoring_package_checks`, live): `core:security-baseline` (24 checks — the consent-time canonical + recurring monitoring set), `core:foundation` (32, entry tier), `core:growth` (146, daily managed tier), `core:premier` (151, compliance tier), `core:enhanced-monitoring` (124), `assess:copilot-readiness` (101), `assess:license-cost-optimization` (3), `assess:teams-governance` (3), `assess:adoption-maturity` (5), `detail:full-item-collection` (145, collection-mode), plus 10 legacy `cat-*` category packages with no observed runs. **Free-scan vs paying reality check:** only `assess:copilot-readiness` and `core:security-baseline` have ever run for a real tenant; every Growth/Premier/Enhanced/Foundation-only check is unexercised (finding #2 above).

**Graph permission scopes.** The platform's granted app consent is recorded per tenant in `tenants.consent` — observed live for both real tenants; the testbed's granted set is 29 Graph application scopes: `Directory.Read.All, SecurityEvents.Read.All, Exchange.ManageAsApp, Sites.Read.All, Reports.Read.All, Policy.Read.All, DeviceManagementConfiguration.Read.All, DeviceManagementManagedDevices.Read.All, BitLockerKey.Read.All, AuditLog.Read.All, ActivityFeed.Read, IdentityRiskyUser.Read.All, IdentityRiskEvent.Read.All, RoleEligibilitySchedule.Read.Directory, AccessReview.Read.All, TeamSettings.Read.All, ServiceMessage.Read.All, ServiceHealth.Read.All, Agreement.Read.All, Application.Read.All, Community.Read.All, DelegatedPermissionGrant.Read.All, IdentityRiskyServicePrincipal.Read.All, InformationProtectionPolicy.Read.All, SensitivityLabels.Read.All, RealTimeActivityFeed.Read.All, RecordsManagement.Read.All, SharePointTenantSettings.Read.All, Team.ReadBasic.All` plus SharePoint `Sites.FullControl.All` and a write-back consent. The catalog does **not** store a per-check required-scope column; per-endpoint scope attribution beyond this granted set would be inference and is deliberately not tabulated (see §11).

## 4. Master check inventory — all 157, classified

Columns: check key · executor · Graph endpoint (or cmdlet) · engine tags · packages · classification · evidence note. Every row's classification derives from live observation data (real tenants only — the synthetic e2e tenant excluded) plus package-run reality; the generation script and inputs are in the evidence log. `freq` is `daily` for every check except `m365:service-health` (`hourly`).

**Package legend:** SB=core:security-baseline · F=core:foundation · G=core:growth · P=core:premier · EM=core:enhanced-monitoring · CR=assess:copilot-readiness · LCO/TG/AM=the three small assess scans · DC=detail:full-item-collection (collection mode). **Bold packages have actually run for a real tenant** (CR, SB, DC only).

| Check | Exec | Endpoint / cmdlet | Engine tags | Pkgs | Class | Evidence note |
|---|---|---|---|---|---|---|
| `adoption:email-activity-trend` | graph | /reports/getEmailActivityUserDetail(period='D7') | ["adoption"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=1 |
| `adoption:m365-mobile-app-usage` | graph | /reports/getM365AppUserDetail(period='D7') | ["adoption"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `adoption:overall-active-rate` | graph | /reports/getOffice365ActiveUserDetail(period='D7') | ["adoption"] | **CR** EM F G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=8 |
| `adoption:planner-usage` | graph | /groups/{itemId}/planner/plans | ["adoption"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `adoption:sharepoint-onedrive-trend` | graph | /reports/getSharePointSiteUsageDetail(period='D7') | ["adoption"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=99 |
| `adoption:sharepoint-user-activity` | graph | /reports/getSharePointActivityUserDetail(period='D7') | ["adoption"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `adoption:teams-activity-trend` | graph | /reports/getTeamsUserActivityUserDetail(period='D7') | ["adoption"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=1 |
| `adoption:teams-phone-provisioning` | powershell | cmdlet get-cs-online-user | ["adoption"] | EM G P **DC** | **PARTIAL** | PowerShell; only in packages never run (core:enhanced-monitoring,core:growth,core:premier,detail:full-item-collection) — never invoked by any real … |
| `adoption:viva-engage-health` | graph | /employeeExperience/communities | ["adoption"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `adoption:viva-engage-user-activity` | graph | /reports/getYammerActivityUserDetail(period='D7') | ["adoption"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `appgov:cert-secret-expiration` | graph | /applications | ["health"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=11 |
| `appgov:consent-policy-status` | graph | /policies/authorizationPolicy | ["security", "governance"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=1 |
| `appgov:dormant-service-principals` | graph | /servicePrincipals?$expand=appRoleAssignedTo($select=id)&$select=id,di… | ["governance"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `appgov:enterprise-app-count` | graph | /servicePrincipals | ["security"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `appgov:enterprise-app-registration-list` | graph | servicePrincipals | ["monitoring"] | **CR** **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=1 |
| `appgov:risky-permission-grants` | graph | /oauth2PermissionGrants | ["security", "priority"] | **CR** EM F G P **SB** **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=37 |
| `appgov:stale-app-registrations` | graph | /applications | ["governance"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=11 |
| `appgov:unreviewed-consents` | graph | /oauth2PermissionGrants | ["security"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=37 |
| `appgov:workload-identity-risk` | graph | /identityProtection/riskyServicePrincipals | ["security"] | **CR** EM G P **DC** | **REAL** | observed license_gap (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `compliance:audit-log-retention` | powershell | cmdlet get-audit-retention-policy | ["compliance"] | P | **PARTIAL** | PowerShell; only in packages never run (core:premier) — never invoked by any real run; ps-execution pipeline also broken (live §9 proof) |
| `compliance:dlp-incidents` | powershell | cmdlet get-dlp-incidents | ["compliance"] | **CR** P **DC** | **PARTIAL** | PowerShell; IS invoked by real runs but every observed live execution errors (child process malformed output) or license-gates before reaching the c… |
| `compliance:eeeu-site-sharing` | graph | /sites/{itemId}/drive/root/permissions | ["compliance"] | **CR** F G P **DC** | **REAL** | observed partial (last 2026-08-28); run 437 testbed: partial items=93 |
| `compliance:label-errors` | powershell | cmdlet get-label-policies | ["compliance"] | **CR** P | **PARTIAL** | PowerShell; IS invoked by real runs but every observed live execution errors (child process malformed output) or license-gates before reaching the c… |
| `compliance:missing-labels` | powershell | cmdlet get-labels | ["compliance"] | **CR** F G P **DC** | **PARTIAL** | PowerShell; IS invoked by real runs but every observed live execution errors (child process malformed output) or license-gates before reaching the c… |
| `compliance:weak-dlp-policies` | powershell | cmdlet get-dlp-policies | ["compliance"] | **CR** G P **DC** | **PARTIAL** | PowerShell; IS invoked by real runs but every observed live execution errors (child process malformed output) or license-gates before reaching the c… |
| `compliance:zero-dlp-policies` | powershell | cmdlet get-all-dlp-policies | ["compliance"] | **CR** G P **DC** | **PARTIAL** | PowerShell; IS invoked by real runs but every observed live execution errors (child process malformed output) or license-gates before reaching the c… |
| `copilot:active-usage-rate` | graph | /copilot/reports/getMicrosoft365CopilotUsageUserDetail(period='D7') | ["copilot", "adoption"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `copilot:data-exposure-risk` | graph | /sites/{itemId}/drive/root/permissions | ["copilot", "security"] | **CR** EM F G P **DC** | **REAL** | observed partial (last 2026-08-28); run 437 testbed: partial items=93 |
| `copilot:license-vs-total-users` | graph | /subscribedSkus | ["copilot", "cost"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=4 |
| `copilot:licensed-but-inactive` | graph | /copilot/reports/getMicrosoft365CopilotUsageUserDetail(period='D30') | ["copilot"] | AM **CR** G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `copilot:readiness-prerequisite` | graph | /subscribedSkus | ["copilot"] | **CR** EM F G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=4 |
| `copilot:sensitivity-labels-exist` | graph | /security/dataSecurityAndGovernance/sensitivityLabels | ["copilot", "governance"] | **CR** G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `copilot:usage-activity` | graph | /copilot/reports/getMicrosoft365CopilotUsageUserDetail(period='D30') | ["copilot", "priority"] | AM **CR** G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `copilot:usage-by-app` | graph | /copilot/reports/getMicrosoft365CopilotUserCountTrend(period='D7') | ["copilot", "adoption"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `cost:duplicate-assignments` | graph | /users | ["cost"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=24 |
| `cost:entra-license-tier-distribution` | graph | /subscribedSkus | ["cost", "security"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=4 |
| `cost:group-based-licensing-adoption` | graph | /groups | ["cost", "governance"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=104 |
| `cost:license-count-by-sku` | graph | /subscribedSkus | ["cost"] | G P | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:growth,core:premier) |
| `cost:underutilized-premium` | graph | /users | ["cost"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=24 |
| `cost:unused-unassigned-licenses` | graph | /subscribedSkus | ["cost", "priority"] | F G P | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:foundation,core:growth,core:premier) |
| `cost:utilization-by-sku` | graph | /subscribedSkus | ["cost"] | G P | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:growth,core:premier) |
| `devices:app-protection-coverage` | graph | /deviceAppManagement/managedAppPolicies | ["security"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `devices:autopilot-coverage` | graph | /deviceManagement/windowsAutopilotDeploymentProfiles | ["health"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `devices:bitlocker-key-escrow` | graph | /informationProtection/bitlocker/recoveryKeys | ["security"] | EM F G P **SB** **DC** | **REAL** | observed ok (last 2026-08-24) |
| `devices:compliance-policy-coverage` | graph | /deviceManagement/deviceCompliancePolicies | ["security", "health"] | EM F G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:foundation,core:growth,core:premier,detail… |
| `devices:compliant-vs-noncompliant` | graph | /deviceManagement/managedDevices | ["security", "priority"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `devices:encryption-status` | graph | /deviceManagement/managedDevices | ["security"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `devices:enrollment-status` | graph | /deviceManagement/managedDevices | ["health"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `devices:kfm-configuration` | graph | /deviceManagement/deviceConfigurations | ["health", "adoption"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `devices:os-patch-compliance` | graph | /deviceManagement/managedDevices | ["security", "health"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `devices:stale-duplicate-records` | graph | /devices?$select=id,displayName,deviceId,approximateLastSignInDateTime… | ["health"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `devices:unassigned-intune-profiles` | graph | /deviceManagement/deviceConfigurations?$expand=assignments($select=id)… | ["health"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `devices:update-rings-config` | graph | /deviceManagement/deviceConfigurations | ["health"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `diagnostics:ps-execution-test` | powershell | cmdlet get-connection-info | [] | **DC** | **PARTIAL** | PowerShell; only in packages never run (detail:full-item-collection) — never invoked by any real run; ps-execution pipeline also broken (live §9 pr… |
| `exchange:antispam-policy-coverage` | powershell | cmdlet get-antispam-policies | ["security"] | EM G P **DC** | **PARTIAL** | PowerShell; only in packages never run (core:enhanced-monitoring,core:growth,core:premier,detail:full-item-collection) — never invoked by any real … |
| `exchange:archive-mailbox-rate` | powershell | cmdlet get-archive-mailbox-gap | ["cost", "health"] | EM G P **DC** | **PARTIAL** | PowerShell; only in packages never run (core:enhanced-monitoring,core:growth,core:premier,detail:full-item-collection) — never invoked by any real … |
| `exchange:auto-forwarding-rules` | powershell | cmdlet get-auto-forward-risk-policies | ["security", "priority"] | **NONE** | **PARTIAL** | PowerShell; only in packages never run ((none)) — never invoked by any real run; ps-execution pipeline also broken (live §9 proof) |
| `exchange:connector-health` | powershell | cmdlet get-inbound-connector-tls-gap | ["security"] | EM G P **DC** | **PARTIAL** | PowerShell; only in packages never run (core:enhanced-monitoring,core:growth,core:premier,detail:full-item-collection) — never invoked by any real … |
| `exchange:distribution-list-count` | graph | /groups?$filter=mailEnabled eq true and securityEnabled eq false and N… | ["governance"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `exchange:dkim-spf-dmarc-status` | dns | TXT: SPF/_dmarc/DKIM selectors | ["security"] | **CR** F G P | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=1 |
| `exchange:litigation-hold-coverage` | powershell | cmdlet get-litigation-hold-gap | ["compliance"] | EM P **DC** | **PARTIAL** | PowerShell; only in packages never run (core:enhanced-monitoring,core:premier,detail:full-item-collection) — never invoked by any real run; ps-exec… |
| `exchange:mail-flow-rule-review` | powershell | cmdlet get-transport-rules | ["security", "governance"] | EM G P **DC** | **PARTIAL** | PowerShell; only in packages never run (core:enhanced-monitoring,core:growth,core:premier,detail:full-item-collection) — never invoked by any real … |
| `exchange:mailbox-quota-utilization` | powershell | cmdlet get-mailbox-quota-utilization | ["cost", "health"] | EM G P **DC** | **PARTIAL** | PowerShell; only in packages never run (core:enhanced-monitoring,core:growth,core:premier,detail:full-item-collection) — never invoked by any real … |
| `exchange:shared-mailbox-licensing` | powershell | cmdlet get-shared-mailboxes | ["cost"] | EM G P **DC** | **PARTIAL** | PowerShell; only in packages never run (core:enhanced-monitoring,core:growth,core:premier,detail:full-item-collection) — never invoked by any real … |
| `exchange:transport-rule-count` | powershell | cmdlet get-transport-rules | ["security"] | EM G P **DC** | **PARTIAL** | PowerShell; only in packages never run (core:enhanced-monitoring,core:growth,core:premier,detail:full-item-collection) — never invoked by any real … |
| `governance:access-review-completion` | graph | /identityGovernance/accessReviews/definitions | ["governance", "compliance"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `governance:auto-labeling-coverage` | graph | /security/dataSecurityAndGovernance/sensitivityLabels | ["governance"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `governance:dynamic-group-usage` | graph | /groups | ["governance"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=104 |
| `governance:empty-security-groups` | graph | /groups?$filter=securityEnabled eq true and mailEnabled eq false&$sele… | ["governance"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `governance:group-expiration-policy` | graph | /groupSettings | ["governance"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `governance:guest-access-reviews` | graph | /identityGovernance/accessReviews/definitions | ["governance", "compliance"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `governance:guest-count` | graph | /users | ["governance"] | **CR** EM F G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=24 |
| `governance:guest-staleness` | graph | /users | ["governance", "security"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=24 |
| `governance:overdue-access-reviews` | graph | /identityGovernance/accessReviews/definitions | ["governance"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `governance:ownerless-groups` | graph | /groups?$expand=owners($select=id) | ["governance"] | **CR** EM F G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=104 |
| `governance:public-groups-discoverable` | graph | /groups?$filter=groupTypes/any(c:c eq 'Unified')&$select=id,displayNam… | ["governance"] | G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:growth,core:premier,detail:full-item-collection) |
| `governance:public-teams-discoverable` | graph | /groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Team')&$select… | ["governance"] | G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:growth,core:premier,detail:full-item-collection) |
| `governance:retention-label-adoption` | graph | /security/labels/retentionLabels | ["compliance"] | **CR** EM G P **DC** | **REAL** | observed license_gap (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `governance:retention-policy-coverage` | graph | /security/labels/retentionLabels | ["compliance", "governance"] | **CR** F G P | **REAL** | observed license_gap (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `governance:sensitivity-label-adoption` | graph | /security/dataSecurityAndGovernance/sensitivityLabels | ["governance", "compliance"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `identity:b2b-collaboration-settings` | graph | /policies/authorizationPolicy | ["governance"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=1 |
| `identity:break-glass-health` | graph | /users | ["security"] | **CR** EM F G P **SB** **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=24 |
| `identity:ca-device-compliance` | graph | /identity/conditionalAccess/policies | ["security"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `identity:ca-legacy-auth-block` | graph | /identity/conditionalAccess/policies | ["security"] | **CR** EM F G P **SB** **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `identity:ca-mfa-coverage` | graph | /identity/conditionalAccess/policies | ["security"] | **CR** EM F G P **SB** **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `identity:ca-policy-count` | graph | /identity/conditionalAccess/policies | ["security", "health"] | **CR** EM F G P **SB** **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `identity:ca-report-only` | graph | /identity/conditionalAccess/policies | ["security"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `identity:continuous-access-evaluation` | graph | /identity/conditionalAccess/policies?$select=id,displayName,sessionCon… | ["security"] | **CR** EM G P **SB** **DC** | **REAL** | observed error,ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `identity:cross-tenant-access` | graph | /policies/crossTenantAccessPolicy | ["governance", "security"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=1 |
| `identity:department-directory` | graph | /users?$select=id,userPrincipalName,department,accountEnabled&$top=999 | ["adoption"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `identity:global-admin-count` | graph | /directoryRoles(roleTemplateId='62e90394-69f5-4237-9190-012177145e10')… | ["security", "priority"] | **CR** EM F G P **SB** **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=6 |
| `identity:guest-mfa-enforcement` | graph | /identity/conditionalAccess/policies | ["security", "governance"] | **CR** EM G P **DC** | **REAL** | observed error,ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `identity:hybrid-sync-health` | graph | /organization | ["architecture", "health"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `identity:legacy-auth-usage` | graph | /auditLogs/signIns | ["security", "priority"] | **CR** EM F G P **SB** **DC** | **REAL** | observed license_gap,ok (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `identity:mfa-method-breakdown` | graph | /reports/authenticationMethods/userRegistrationDetails | ["security"] | **CR** EM G P **DC** | **REAL** | observed license_gap,ok (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `identity:mfa-registration` | graph | /reports/authenticationMethods/userRegistrationDetails | ["priority", "security"] | AM **CR** EM F G P **SB** **DC** | **REAL** | observed license_gap,ok (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `identity:named-locations` | graph | /identity/conditionalAccess/namedLocations | ["security"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `identity:password-expiration-policy` | graph | /domains | ["security"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `identity:pim-eligible-roles` | graph | /roleManagement/directory/roleEligibilitySchedules?$expand=principal | ["security", "health"] | **CR** EM G P **DC** | **REAL** | observed license_gap (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `identity:pim-groups` | graph | /identityGovernance/privilegedAccess/group/eligibilitySchedules?$filte… | ["security"] | **CR** EM G P **DC** | **REAL** | observed license_gap (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `identity:pim-permanent-roles` | graph | /roleManagement/directory/roleAssignments | ["security", "priority"] | **CR** EM F G P **SB** **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=18 |
| `identity:privileged-mfa-gap` | graph | /reports/authenticationMethods/userRegistrationDetails | ["priority", "security"] | **CR** EM F G P **SB** **DC** | **REAL** | observed license_gap (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `identity:risky-signins` | graph | /identityProtection/riskDetections?$filter=activity eq 'signin' | ["security"] | **CR** EM G P **SB** **DC** | **REAL** | observed error,license_gap (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `identity:risky-users` | graph | /identityProtection/riskyUsers | ["security", "priority"] | **CR** EM F G P **SB** **DC** | **REAL** | observed license_gap (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `identity:signin-risk-policy` | graph | /identity/conditionalAccess/policies | ["security"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `identity:sspr-config` | graph | /policies/authorizationPolicy | ["security"] | **CR** EM F G P **SB** **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=1 |
| `identity:stale-accounts` | graph | /users | ["governance", "security"] | AM **CR** EM G P **SB** **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=24 |
| `identity:terms-of-use` | graph | /identityGovernance/termsOfUse/agreements | ["compliance"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `identity:user-risk-policy` | graph | /identity/conditionalAccess/policies | ["security"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=0 |
| `license:copilot-assignment` | graph | /subscribedSkus | ["copilot"] | **CR** LCO G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=4 |
| `license:sku-utilization` | graph | /subscribedSkus | ["priority", "governance"] | **CR** LCO G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=4 |
| `license:unused-assigned` | graph | /users?$select=id,accountEnabled,assignedLicenses,signInActivity | ["priority", "governance"] | **CR** LCO F G P **DC** | **REAL** | observed license_gap,ok (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `licensing:project-online-detection` | graph | /subscribedSkus | ["licensing"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `m365:message-center` | graph | /admin/serviceAnnouncement/messages?$orderby=lastModifiedDateTime desc | [] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=486 |
| `m365:service-health` | graph | /admin/serviceAnnouncement/healthOverviews | [] | **CR** EM F G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=25 |
| `onedrive:active-users` | graph | /reports/getOneDriveUsageAccountDetail(period='D7') | ["adoption"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `onedrive:departed-user-access` | graph | /users?$expand=manager($select=id)&$select=id,accountEnabled,signInAct… | ["governance"] | **CR** EM G P **DC** | **REAL** | observed license_gap,ok (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `onedrive:external-sharing-settings` | graph | /sites | ["governance"] | G P | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:growth,core:premier) |
| `onedrive:overshared-files` | graph | /sites/{itemId}/drive/root/permissions | ["compliance"] | **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: detail:full-item-collection) |
| `onedrive:storage-utilization` | graph | /reports/getOneDriveUsageAccountDetail(period='D7') | ["cost", "health"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `onedrive:sync-errors` | graph | /reports/getOneDriveUsageAccountDetail(period='D30') | ["health"] | G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:growth,core:premier,detail:full-item-collection) |
| `platform:branding-config` | graph | /organization/{id}/branding | ["governance"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `platform:multi-geo-status` | graph | /admin/sharepoint/settings | ["architecture"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `platform:tenant-password-expiration` | graph | /domains | ["security"] | G P | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:growth,core:premier) |
| `security:alert-count-by-severity` | graph | /security/alerts_v2 | ["security", "priority"] | **CR** EM G P **SB** **DC** | **REAL** | observed license_gap (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `security:antiphishing-coverage` | graph | /security/alerts_v2 | ["security"] | **CR** EM F G P **SB** **DC** | **REAL** | observed license_gap (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `security:automated-investigation` | graph | /security/incidents | ["security"] | **CR** EM G P **DC** | **REAL** | observed license_gap (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `security:azure-roleDefinitions-compliance` | graph | /roleManagement/directory/roleDefinitions | ["security"] | **CR** G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=145 |
| `security:dlp-true-positive-rate` | graph | /security/alerts_v2 | ["security"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `security:dlp-violations` | graph | /security/alerts_v2 | ["security", "priority"] | **CR** EM G P **SB** **DC** | **REAL** | observed license_gap (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `security:insider-risk-alerts` | graph | /security/alerts_v2?$filter=detectionSource eq 'microsoftInsiderRiskMa… | ["security"] | **CR** EM P **DC** | **REAL** | observed license_gap (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `security:open-incidents` | graph | /security/incidents | ["security", "priority"] | **CR** EM F G P **SB** **DC** | **REAL** | observed license_gap (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `security:password-protection-policy` | graph | /domains | ["security"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=9 |
| `security:safe-attachments-coverage` | graph | /security/alerts_v2 | ["security"] | **CR** EM F G P **SB** **DC** | **REAL** | observed license_gap (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `security:safe-links-coverage` | graph | /security/alerts_v2 | ["security"] | **CR** EM F G P **SB** **DC** | **REAL** | observed license_gap (last 2026-08-28); run 437 testbed: license_gap items=0 |
| `security:secure-score` | graph | /security/secureScores | ["health", "priority"] | **CR** EM F G P **SB** **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=90 |
| `security:secure-score-by-category` | graph | /security/secureScores | ["health"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=90 |
| `sharepoint:anonymous-links` (INACTIVE) | graph | /sites | ["security", "governance"] | **NONE** | **PARTIAL** | inactive (status=inactive) and in no package — structurally cannot run |
| `sharepoint:inactive-sites` | graph | /sites | ["governance"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=99 |
| `sharepoint:orgwide-links` (INACTIVE) | graph | /sites | ["governance"] | **NONE** | **PARTIAL** | inactive (status=inactive) and in no package — structurally cannot run |
| `sharepoint:site-count` | graph | /sites | ["health"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=99 |
| `sharepoint:site-label-coverage` | graph | /sites | ["governance"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=99 |
| `sharepoint:storage-near-limit` | graph | /sites | ["health"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `sharepoint:storage-utilization` | graph | /sites | ["health", "cost"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `sharepoint:tenant-sharing-capability` | sharepoint-admin | SP admin: tenant-sharing-capability | ["governance", "security"] | **CR** EM F G P **SB** **DC** | **PARTIAL** | invoked by real runs; every observation errors on MT_APP_* SharePoint app-only cert config |
| `teams:app-permission-policy` | graph | /teams | ["security"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=18 |
| `teams:channel-sprawl` | graph | /teams/{itemId}/channels | ["governance"] | **CR** TG G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=27 |
| `teams:external-access-settings` | graph | /teams | ["governance", "security"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=18 |
| `teams:guest-membership` | graph | /teams | ["governance"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=18 |
| `teams:guest-settings-governance` | graph | /teams/{itemId} | ["governance", "security"] | **CR** TG G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=18 |
| `teams:inactive-teams` | graph | /teams | ["governance", "adoption"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=18 |
| `teams:inventory-count` | graph | /groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Team') | ["governance", "health"] | AM **CR** TG G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=18 |
| `teams:meeting-policy-coverage` | graph | /teams | ["governance"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=18 |
| `teams:messaging-policy-coverage` | graph | /teams | ["governance"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=18 |
| `teams:ownerless-teams` | graph | /groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Team')&$expand… | ["governance"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=18 |
| `teams:rooms-device-health` | graph | /deviceManagement/managedDevices | ["health"] | EM G P **DC** | **PARTIAL** | active Graph check with ZERO observations on any real tenant (only package: core:enhanced-monitoring,core:growth,core:premier,detail:full-item-colle… |
| `teams:team-count` | graph | /teams | ["health"] | **CR** EM G P **DC** | **REAL** | observed ok (last 2026-08-28); run 437 testbed: ok items=18 |


### 4.1 The PowerShell seventeen (all PARTIAL)

Cmdlet resolution is container-side from `services/ps-execution/cmdlet-catalog.ps1`; session type per `child-worker.ps1` (`compliance` = `Connect-IPPSSession`, `exchange` = `Connect-ExchangeOnline`, `teams` = `Connect-MicrosoftTeams`; all app-only certificate auth).

| Check | cmdletKey | Real cmdlet | Session | Invoked by a real run? |
|---|---|---|---|---|
| `adoption:teams-phone-provisioning` | get-cs-online-user | Get-CsOnlineUser | teams (Connect-MicrosoftTeams) | never (packages never run) |
| `compliance:audit-log-retention` | get-audit-retention-policy | Get-UnifiedAuditLogRetentionPolicy | compliance (Connect-IPPSSession) | never (packages never run) |
| `compliance:dlp-incidents` | get-dlp-incidents | Export-ActivityExplorerData | compliance (Connect-IPPSSession) | yes — errors (child-process failure) or license-gates first |
| `compliance:label-errors` | get-label-policies | Get-LabelPolicy | compliance (Connect-IPPSSession) | yes — errors (child-process failure) or license-gates first |
| `compliance:missing-labels` | get-labels | Get-Label | compliance (Connect-IPPSSession) | yes — errors (child-process failure) or license-gates first |
| `compliance:weak-dlp-policies` | get-dlp-policies | Get-DlpCompliancePolicy (PostFilter: Mode≠Enable or disabled) | compliance (Connect-IPPSSession) | yes — errors (child-process failure) or license-gates first |
| `compliance:zero-dlp-policies` | get-all-dlp-policies | Get-DlpCompliancePolicy (unfiltered) | compliance (Connect-IPPSSession) | yes — errors (child-process failure) or license-gates first |
| `diagnostics:ps-execution-test` | get-connection-info | Get-ConnectionInformation | compliance (Connect-IPPSSession) | never (packages never run) |
| `exchange:antispam-policy-coverage` | get-antispam-policies | Get-HostedContentFilterPolicy | exchange (Connect-ExchangeOnline) | never (packages never run) |
| `exchange:archive-mailbox-rate` | get-archive-mailbox-gap | Get-Mailbox | exchange (Connect-ExchangeOnline) | never (packages never run) |
| `exchange:auto-forwarding-rules` | get-auto-forward-risk-policies | Get-HostedOutboundSpamFilterPolicy | exchange (Connect-ExchangeOnline) | never (packages never run) |
| `exchange:connector-health` | get-inbound-connector-tls-gap | Get-InboundConnector | exchange (Connect-ExchangeOnline) | never (packages never run) |
| `exchange:litigation-hold-coverage` | get-litigation-hold-gap | Get-Mailbox | exchange (Connect-ExchangeOnline) | never (packages never run) |
| `exchange:mail-flow-rule-review` | get-transport-rules | Get-TransportRule | exchange (Connect-ExchangeOnline) | never (packages never run) |
| `exchange:mailbox-quota-utilization` | get-mailbox-quota-utilization | Get-Mailbox (+stats) | exchange (Connect-ExchangeOnline) | never (packages never run) |
| `exchange:shared-mailbox-licensing` | get-shared-mailboxes | Get-Mailbox | exchange (Connect-ExchangeOnline) | never (packages never run) |
| `exchange:transport-rule-count` | get-transport-rules | Get-TransportRule | exchange (Connect-ExchangeOnline) | never (packages never run) |


Live pipeline proof (this session): `shaneapp://executeCmdlet?cmdletKey=get-connection-info&tenantId=c4c814d4-…` → `{ok:false, error:"The request-handling child process produced malformed output.", kind:"script_error", containerErrorKind:"script_error", organization:"mccawsoft2.onmicrosoft.com", customerId:1, elapsedMs:4795}`. `get-connection-info` is the trivial no-tenant-data placeholder that exercises only connect→invoke→capture→disconnect — its failure means the container's child-process layer is broken for **every** cmdlet and session type, superseding the narrower #1389 MSAL diagnosis for current state.

## 5. Findings, items, and the assessment run shape

A real run writes `msp_diagnostic_runs` (observed run 437: `{status:"partial", run_status:"partial_failure", checks_total:101, checks_ok:72, checks_error:6, checks_requires_script:0, checks_license_gap:21}` — `license_gap` deliberately does not make a run partial; the 6 errors + 2 fan-out partials do). Per-check findings land in `msp_diagnostic_findings` (98 rows for run 437) and reach the portal inside the pillar payload. Real observed finding shape (§9.1 capture):

```json
{"severity":"warning","checkKey":"governance:ownerless-groups",
 "title":"Groups exist with no owner — nobody is accountable for membership or lifecycle",
 "rankWeight":10,
 "description":"This check flagged items that need review. A readable summary for this check isn't available yet.",
 "recommendation":{"action":"Review and remediate this finding","category":"governance","priority":2,"signalKey":"governance:ownerless-groups"},
 "evidence":null,"obligation":null,"whyItMatters":null}
```

Note the honest placeholder description and the commonly-null `evidence`/`obligation`/`whyItMatters` — Design must not assume those fields are populated. Severity literals observed: `critical | warning | info` (finding side); check-side `severity_matched` observed: `critical | warning | info | (null)` with long human-readable `severity_label` strings (real examples: *"No Conditional Access policy blocks legacy authentication — MFA can be bypassed entirely"*, *"Fewer than 2 Global Administrators — single point of failure risk…"*).

Full per-item evidence (every affected object, not a sample) lives in `tenant_check_item_details` (98 checks for run 437, `items` jsonb + `items_omitted` flag) and is served to the portal via `GET /api/portal/tenant-check-items` — this is what the CA-baseline and MFA drill-downs render.

## 6. The dashboard registry and the `/api/dashboard/resolve` seam

`lib/dashboard-registry/src/metrics.ts` declares **198 metrics**: 151 `monitor_profile` (a claim that `sourceKey` names a real `monitor_checks` row), 16 `engine_snapshot`, 31 `platform_table`; statuses 168 `available`, 9 `needs_aggregation` (custom transforms, dashboard-resolvers.ts:769-915), 21 `not_collected` (an explicit honesty sentinel — resolves to `not_available("not_collected")` always, :594-596).

Resolution outcomes a UI must render (all literal, from `dashboard-resolvers.ts`): `ok` · `not_available` with reason ∈ `not_collected | missing_customer_scope | no_tenant_id | license_gap (with the feature name) | no_data ("no monitor profile rows for check …") | unknown_check_key ("… is not a check in monitor_checks — this metric can never resolve until the registry sourceKey matches a real catalog key") | no_snapshot | no_sku_prices | not_comparable | no_transform | no_source` · `error`. The portal-v2 hooks that consume this seam are enumerated in §9.

- **`engine_snapshot` metrics (16)**: read `tenant_engine_snapshots` → currently ALL resolve `no_snapshot` (table empty; only Mission Control / admin engine runs write it). `sla.*` and `sla.scopeCreepStatus` compute live instead (:283-300); `engine.mspIntelligenceScore` is permanently `no_source` (:312-318).
- **`drift:*` metrics (18)**: routed to the real `drift_events` store (:614-616, resolver :678) — NOT to monitor_checks. Live state: baselines exist for `ca-policy` + `email-authentication` (`tracked`), `eeeu-site-sharing` `not_comparable`; **specs exist for only 5 domains** (`drift-check-specs.ts`; #1287): `ca-policy, eeeu-site-sharing, public-teams-discoverable, tenant-sharing-capability, email-authentication`. The other 13 registry drift domains (`directory-settings, license-assignment, mailbox-config, role-assignment, security-defaults, sharepoint-admin, teams-policy, app-config, redirect-uri, secret, certificate, permission, tenant-config`) have **no producer** — they resolve `no_data` forever until a spec is written. Classification: 2 domains REAL-with-empty-history, 3 PARTIAL (spec'd, no baseline/not comparable), 13 ABSENT-as-collection.
- **`platform_table` metrics (31)**: resolve from real platform tables (alerts, projects, financial, SLA, AI usage, benchmarks — :1014+). These are MSP-side operational data, not tenant scan data; portal-v2's Projects/overview widgets consume a subset via `/api/portal/dashboard` and `/api/portal/projects/*`.

### The 21 `not_collected` sentinels (honest by design — render as "not collected", never fake)

**21 metrics carry `status: "not_collected"`.** These are deliberate honesty sentinels (see metrics.ts:21-49 for the history — the retired phantom `usage:*` domain among them): the platform genuinely does not collect these today, and the registry says so rather than pointing at a near-miss check.

| Registry metric | sourceKey sentinel |
|---|---|
| `collaboration.activeEmailUserCount` | `not_collected:active-email-users` |
| `collaboration.activeOneDriveUserCount` | `not_collected:active-onedrive-users` |
| `collaboration.activeSharePointUserCount` | `not_collected:active-sharepoint-users` |
| `collaboration.activeTeamsUserCount` | `not_collected:active-teams-users` |
| `collaboration.fileActivity` | `not_collected:onedrive-file-activity` |
| `collaboration.meetingsOrganized` | `not_collected:meetings-organized` |
| `compliance.labelPolicyDriftCount` | `not_collected:label-policy-drift` |
| `compliance.retentionDriftCount` | `not_collected:retention-drift` |
| `copilot.usagePerUser` | `not_collected:copilot-usage` |
| `governance.accessReviewDriftCount` | `not_collected:access-review-drift` |
| `identity.caFailureCount` | `not_collected:conditional-access-failures` |
| `identity.failedSigninCount` | `not_collected:failed-signins` |
| `identity.impossibleTravelCount` | `not_collected:impossible-travel` |
| `identity.privilegedRoleChangeCount` | `not_collected:privileged-role-changes` |
| `licensing.costTrend` | `not_collected:license-cost` |
| `security.lowScoreControlCount` | `not_collected:low-score-controls` |
| `serviceHealth.uptimeStatus` | `not_collected:service-health-overview` |
| `usage.exchangeUsageCount` | `not_collected:exchange-adoption-score` |
| `usage.oneDriveUsageCount` | `not_collected:onedrive-adoption-score` |
| `usage.sharePointUsageCount` | `not_collected:sharepoint-adoption-score` |
| `usage.teamsUsageCount` | `not_collected:teams-adoption-score` |


## 7. Data shape appendix — real envelopes, real examples

### 7.1 `tenant_monitor_profiles` row (the per-check observation)

Columns (live schema): `profile_id uuid, tenant_id text (Entra GUID), check_key, check_schema_version int, trigger_id text, idempotency_key, status text, raw_response jsonb, extracted_properties jsonb, severity_matched text, severity_label text, error_message text, item_count int, page_count int, collected_at timestamptz`. Cardinality: one row per check per execution (history accumulates; consumers read latest per check).

### 7.2 The extraction grammar (what `extracted_properties` looks like)

`applyMapping` produces a flat object per check combining:
- `_itemCount` — always present on success; the fetched item count.
- Named aggregates per mapping rule — the check's real headline numbers, e.g. `caPolicyCount`, `globalAdminCount`, `secureScoreCurrent`/`secureScoreMax`, `ownerlessGroupCount`, `staleGuestCount`, `copilotLicenseCount`.
- Per-property triplets `<prop>_count`, `<prop>_first`, `<prop>_values` (sampled values array) for each captured source property, e.g. `displayName_count/_first/_values`.
- Fan-out extras: `_fanOut: true` + coverage fields (e.g. `sitesScanned`, `oversharedSiteCount`, `sitesByHighestSharingLevel`).
- License-gap shape (no items): `{_licenseGap: true, _licenseGapCode, _licenseGapFeature}` (+ capability flags observed: `hasAADP1orP2: false`, `hasDefender: false`).
- Error shape: `extracted_properties` **null**, `error_message` set. Observed error literals: `Graph API error 429: {"error":{"code":"TooManyRequests"…` · `Graph API error 403: … required scopes` · `The request-handling child process produced malformed output.` · `monitor check sharepoint:tenant-sharing-capability needs SharePoint app-only credentials — set MT_APP_CLIENT_ID, MT_APP_CERT_PRIVATE_KEY and MT_APP_CERT_THUMBPRINT` · `Requires Microsoft Purview Data Loss Prevention (DLP)` (license_gap reasons).

Real example, `exchange:dkim-spf-dmarc-status` on the testbed (run 437, redacted only in record values):

```json
{"_itemCount":1,"domain":"mccawsoft2.onmicrosoft.com",
 "spfRecord":"v=spf1 include:spf.protection.outlook.com -all","spfConfigured":true,
 "dmarcRecord":null,"dmarcConfigured":false,
 "dkimCheckedSelectors":["selector1","selector2"],
 "dkimFoundAtDefaultSelectors":[],"dkimConfiguredAtDefaultSelectors":false}
```

(The `spfRecord`/`dmarcRecord` values above are the shape as persisted; this tenant's observed severity was `warning` with label *"No DMARC record found at _dmarc.<domain>"*.)

### 7.3 Per-check observed shapes — testbed run 437 (all 101 checks)

For every check the fresh testbed run executed: status, item count, and the real `extracted_properties` field names observed. This is observation, not declaration — a check not listed here was not in that run's package (its evidence, if any, is the master table's dated note).

Convention reminder: for every listed base property `p`, the triplets `p_count`/`p_first`/`p_values` follow §7.2 — `_values` variants are omitted below for width.

| Check | Status | Items | Observed extracted_properties fields |
|---|---|---|---|
| `adoption:email-activity-trend` | ok | 1 | _itemCount, emailActiveUserCount, emailLicensedUserCount, lastActivityDate_count, lastActivityDate_first, userPrincipalName_count, userPrincipalName_first |
| `adoption:overall-active-rate` | ok | 8 | _itemCount, overallActiveUserCount, userPrincipalName_count, userPrincipalName_first, hasExchangeLicense_count, hasExchangeLicense_first |
| `adoption:sharepoint-onedrive-trend` | ok | 99 | _itemCount, lastActivityDate_count, lastActivityDate_first, sharepointSitesScanned, userPrincipalName_count, userPrincipalName_first, sharepointActiveUserCount |
| `adoption:teams-activity-trend` | ok | 1 | _itemCount, teamsActiveUserCount, lastActivityDate_count, lastActivityDate_first, teamsLicensedUserCount, userPrincipalName_count, userPrincipalName_first |
| `appgov:cert-secret-expiration` | ok | 11 | id_count, id_first, _itemCount, keyCredentialCount, keyCredentials_count, keyCredentials_first, passwordCredentialCount, expiredKeyCredentialCount, passwordCredent… |
| `appgov:consent-policy-status` | ok | 1 | id_count, id_first, _itemCount, userConsentAllowed, defaultUserRolePermissions_count, defaultUserRolePermissions_first |
| `appgov:enterprise-app-registration-list` | ok | 1 | id_count, id_first, _itemCount, appId_count, appId_first, displayName_count, displayName_first |
| `appgov:risky-permission-grants` | ok | 37 | id_count, id_first, _itemCount, scope_count, scope_first, totalConsentGrantCount, riskyPermissionGrantCount |
| `appgov:stale-app-registrations` | ok | 11 | id_count, id_first, _itemCount, appId_count, appId_first, displayName_count, displayName_first, createdDateTime_count, createdDateTime_first, appRegistrationsOver1… |
| `appgov:unreviewed-consents` | ok | 37 | id_count, id_first, _itemCount, consentType_count, consentType_first, totalConsentGrantCount, unreviewedConsentCount |
| `appgov:workload-identity-risk` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature |
| `compliance:dlp-incidents` | error | 0 | (null — error: The request-handling child process produced malformed output.…) |
| `compliance:eeeu-site-sharing` | partial | 93 | _fanOut, _itemCount, sitesScanned, eeeuSiteCount, everyoneSiteCount, oversharedSiteCount, anonymousLinkSiteCount, organizationLinkSiteCount, sitesByHighestSharingL… |
| `compliance:label-errors` | error | 0 | (null — error: The request-handling child process produced malformed output.…) |
| `compliance:missing-labels` | error | 0 | (null — error: The request-handling child process produced malformed output.…) |
| `compliance:weak-dlp-policies` | error | 0 | (null — error: The request-handling child process produced malformed output.…) |
| `compliance:zero-dlp-policies` | error | 0 | (null — error: The request-handling child process produced malformed output.…) |
| `copilot:active-usage-rate` | ok | 0 | _itemCount, copilotActiveUserCount, lastActivityDate_count, lastActivityDate_first, userPrincipalName_count, userPrincipalName_first |
| `copilot:data-exposure-risk` | partial | 93 | _fanOut, _itemCount, copilotSitesScanned, copilotEeeuSiteCount, copilotExposedSiteCount, copilotEveryoneSiteCount, copilotAnonymousLinkSiteCount, copilotOrganizati… |
| `copilot:license-vs-total-users` | ok | 4 | _itemCount, consumedUnits_count, consumedUnits_first, copilotLicenseCount, skuPartNumber_count, skuPartNumber_first |
| `copilot:licensed-but-inactive` | ok | 0 | _itemCount, neverActiveCount, lastActivityDate_count, lastActivityDate_first, userPrincipalName_count, userPrincipalName_first |
| `copilot:readiness-prerequisite` | ok | 4 | _itemCount, copilotSkuCount, skuPartNumber_count, skuPartNumber_first |
| `copilot:sensitivity-labels-exist` | ok | 0 | id_count, id_first, _itemCount, labelCount, name_count, name_first, isActive_count, isActive_first |
| `copilot:usage-activity` | ok | 0 | _itemCount, copilotUsageData, lastActivityDate_count, lastActivityDate_first, userPrincipalName_count, userPrincipalName_first, copilotChatLastActivityDate_count, … |
| `copilot:usage-by-app` | ok | 0 | _itemCount, appActivity_count, appActivity_first, copilotUsageByApp, userPrincipalName_count, userPrincipalName_first |
| `cost:duplicate-assignments` | ok | 24 | id_count, id_first, _itemCount, assignedLicenses_count, assignedLicenses_first, duplicateLicenseAssignmentCount |
| `cost:entra-license-tier-distribution` | ok | 4 | _itemCount, licenseInventory, skuPartNumber_count, skuPartNumber_first |
| `cost:group-based-licensing-adoption` | ok | 104 | id_count, id_first, _itemCount, assignedLicenses_count, assignedLicenses_first, groupBasedLicensingGroupCount |
| `cost:underutilized-premium` | ok | 24 | id_count, id_first, _itemCount, assignedLicenses_count, assignedLicenses_first, underutilizedPremiumLicenseCount |
| `exchange:dkim-spf-dmarc-status` | ok | 1 | domain, spfRecord, _itemCount, dmarcRecord, spfConfigured, dmarcConfigured, dkimCheckedSelectors, dkimFoundAtDefaultSelectors, dkimConfiguredAtDefaultSelectors |
| `governance:access-review-completion` | ok | 0 | id_count, id_first, _itemCount, status_count, status_first, accessReviewCompletedCount |
| `governance:auto-labeling-coverage` | ok | 0 | id_count, id_first, _itemCount, autoLabelingPolicyExists |
| `governance:dynamic-group-usage` | ok | 104 | id_count, id_first, _itemCount, groupTypes_count, groupTypes_first, dynamicGroupCount, membershipRule_count, membershipRule_first |
| `governance:group-expiration-policy` | ok | 0 | id_count, id_first, _itemCount, values_count, values_first, groupExpirationPolicyConfigured |
| `governance:guest-access-reviews` | ok | 0 | id_count, id_first, _itemCount, scope_count, scope_first, guestAccessReviewExists |
| `governance:guest-count` | ok | 24 | id_count, id_first, _itemCount, userType_count, userType_first, guestAccountCount |
| `governance:guest-staleness` | ok | 24 | id_count, id_first, _itemCount, userType_count, userType_first, staleGuestCount, signInActivity_count, signInActivity_first |
| `governance:overdue-access-reviews` | ok | 0 | id_count, id_first, _itemCount, status_count, status_first, overdueAccessReviewCount |
| `governance:ownerless-groups` | ok | 104 | id_count, id_first, _itemCount, displayName_count, displayName_first, ownerlessGroupCount |
| `governance:retention-label-adoption` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature |
| `governance:retention-policy-coverage` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature |
| `governance:sensitivity-label-adoption` | ok | 0 | id_count, id_first, _itemCount, name_count, name_first, sensitivityLabelCount |
| `identity:b2b-collaboration-settings` | ok | 1 | _itemCount, allowInvitesFrom_count, allowInvitesFrom_first, guestInviteRestriction |
| `identity:break-glass-health` | ok | 24 | id_count, id_first, _itemCount, accountEnabled_count, accountEnabled_first, breakGlassAccountsHealthy |
| `identity:ca-device-compliance` | ok | 0 | id_count, id_first, _itemCount, grantControls_count, grantControls_first, caDeviceCompliancePolicyExists |
| `identity:ca-legacy-auth-block` | ok | 0 | id_count, id_first, _itemCount, conditions_count, conditions_first, caLegacyAuthBlockExists |
| `identity:ca-mfa-coverage` | ok | 0 | id_count, id_first, _itemCount, caMfaPolicyExists, grantControls_count, grantControls_first |
| `identity:ca-policy-count` | ok | 0 | id_count, id_first, _itemCount, state_count, state_first, caPolicyCount, displayName_count, displayName_first |
| `identity:ca-report-only` | ok | 0 | id_count, id_first, _itemCount, state_count, state_first, caReportOnlyPolicyCount |
| `identity:continuous-access-evaluation` | ok | 0 | id_count, id_first, _itemCount, caePolicyTotal, displayName_count, displayName_first, caeDisabledPolicyCount, caeConfiguredPolicyCount |
| `identity:cross-tenant-access` | ok | 1 | id_count, id_first, _itemCount, crossTenantAccessConfigured |
| `identity:global-admin-count` | ok | 6 | id_count, id_first, _itemCount, mail_count, mail_first, globalAdminCount, @odata.type_count, @odata.type_first, displayName_count, displayName_first, globalAdminUs… |
| `identity:guest-mfa-enforcement` | ok | 0 | id_count, id_first, _itemCount, conditions_count, conditions_first, guestMfaPolicyExists |
| `identity:legacy-auth-usage` | license_gap | 0 | _licenseGap, hasAADP1orP2, _licenseGapCode, _licenseGapFeature |
| `identity:mfa-method-breakdown` | license_gap | 0 | _licenseGap, hasAADP1orP2, _licenseGapCode, _licenseGapFeature |
| `identity:mfa-registration` | license_gap | 0 | _licenseGap, hasAADP1orP2, _licenseGapCode, _licenseGapFeature |
| `identity:named-locations` | ok | 0 | id_count, id_first, _itemCount, displayName_count, displayName_first, namedLocationCount |
| `identity:pim-eligible-roles` | license_gap | 0 | _licenseGap, hasAADP1orP2, _licenseGapCode, _licenseGapFeature |
| `identity:pim-groups` | license_gap | 0 | _licenseGap, hasAADP1orP2, _licenseGapCode, _licenseGapFeature |
| `identity:pim-permanent-roles` | ok | 18 | id_count, id_first, _itemCount, principalId_count, principalId_first, roleDefinitionId_count, roleDefinitionId_first, permanentRoleAssignmentCount |
| `identity:privileged-mfa-gap` | license_gap | 0 | _licenseGap, hasAADP1orP2, _licenseGapCode, _licenseGapFeature |
| `identity:risky-signins` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature |
| `identity:risky-users` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature |
| `identity:signin-risk-policy` | ok | 0 | id_count, id_first, _itemCount, conditions_count, conditions_first, signInRiskPolicyExists |
| `identity:sspr-config` | ok | 1 | id_count, id_first, _itemCount, adminSsprAllowed |
| `identity:stale-accounts` | ok | 24 | id_count, id_first, _itemCount, staleAccountCount, signInActivity_count, signInActivity_first |
| `identity:terms-of-use` | ok | 0 | id_count, id_first, _itemCount, displayName_count, displayName_first, termsOfUseAgreementCount |
| `identity:user-risk-policy` | ok | 0 | id_count, id_first, _itemCount, conditions_count, conditions_first, userRiskPolicyExists |
| `license:copilot-assignment` | ok | 4 | _itemCount, copilotSkuData, consumedUnits_count, consumedUnits_first, skuPartNumber_count, skuPartNumber_first |
| `license:sku-utilization` | ok | 4 | skuData, _itemCount, prepaidUnits_count, prepaidUnits_first, consumedUnits_count, consumedUnits_first, skuPartNumber_count, skuPartNumber_first |
| `license:unused-assigned` | license_gap | 0 | _licenseGap, hasAADP1orP2, _licenseGapCode, _licenseGapFeature |
| `m365:message-center` | ok | 486 | id_count, id_first, _itemCount, title_count, title_first, category_count, category_first, severity_count, severity_first, majorChangeCount |
| `m365:service-health` | ok | 25 | id_count, id_first, _itemCount, status_count, status_first, service_count, service_first, totalServiceCount, operationalServiceCount |
| `onedrive:departed-user-access` | license_gap | 0 | _licenseGap, hasAADP1orP2, _licenseGapCode, _licenseGapFeature |
| `security:alert-count-by-severity` | license_gap | 0 | _licenseGap, hasDefender, _licenseGapCode, _licenseGapFeature |
| `security:antiphishing-coverage` | license_gap | 0 | _licenseGap, hasDefender, _licenseGapCode, _licenseGapFeature |
| `security:automated-investigation` | license_gap | 0 | _licenseGap, hasDefender, _licenseGapCode, _licenseGapFeature |
| `security:azure-roleDefinitions-compliance` | ok | 145 | id_count, id_first, _itemCount |
| `security:dlp-violations` | license_gap | 0 | _licenseGap, hasDefender, _licenseGapCode, _licenseGapFeature |
| `security:insider-risk-alerts` | license_gap | 0 | _licenseGap, hasDefender, _licenseGapCode, _licenseGapFeature |
| `security:open-incidents` | license_gap | 0 | _licenseGap, hasDefender, _licenseGapCode, _licenseGapFeature |
| `security:password-protection-policy` | ok | 9 | id_count, id_first, _itemCount, passwordProtectionPolicyExists |
| `security:safe-attachments-coverage` | license_gap | 0 | _licenseGap, hasDefender, _licenseGapCode, _licenseGapFeature |
| `security:safe-links-coverage` | license_gap | 0 | _licenseGap, hasDefender, _licenseGapCode, _licenseGapFeature |
| `security:secure-score` | ok | 90 | id_count, id_first, _itemCount, maxScore_count, maxScore_first, secureScoreMax, currentScore_count, currentScore_first, secureScoreCurrent |
| `security:secure-score-by-category` | ok | 90 | _itemCount, controlScores_count, controlScores_first, secureScoreByCategory |
| `sharepoint:inactive-sites` | ok | 99 | id_count, id_first, _itemCount, inactiveSiteCount, lastModifiedDateTime_count, lastModifiedDateTime_first |
| `sharepoint:site-count` | ok | 99 | id_count, id_first, _itemCount, webUrl_count, webUrl_first, sharepointSiteCount |
| `sharepoint:site-label-coverage` | ok | 99 | id_count, id_first, _itemCount, sitesWithLabelCount |
| `sharepoint:tenant-sharing-capability` | error | 0 | (null — error: monitor check sharepoint:tenant-sharing-capability needs SharePoint app-only cre…) |
| `teams:app-permission-policy` | ok | 18 | id_count, id_first, _itemCount, appPermissionPolicyAssignedCount |
| `teams:channel-sprawl` | ok | 27 | _fanOut, id_count, id_first, _itemCount, channelCount, displayName_count, displayName_first |
| `teams:external-access-settings` | ok | 18 | id_count, id_first, _itemCount, externalAccessEnabled |
| `teams:guest-membership` | ok | 18 | id_count, id_first, _itemCount, teamsWithGuestsCount |
| `teams:guest-settings-governance` | ok | 18 | _fanOut, _itemCount, guestSettingsData, guestSettings_count, guestSettings_first |
| `teams:inactive-teams` | ok | 18 | id_count, id_first, _itemCount, inactiveTeamCount |
| `teams:inventory-count` | ok | 18 | id_count, id_first, teamCount, _itemCount, publicTeamCount, visibility_count, visibility_first, displayName_count, displayName_first |
| `teams:meeting-policy-coverage` | ok | 18 | id_count, id_first, _itemCount, meetingPolicyAssignedCount |
| `teams:messaging-policy-coverage` | ok | 18 | id_count, id_first, _itemCount, messagingPolicyAssignedCount |
| `teams:ownerless-teams` | ok | 18 | id_count, id_first, _itemCount, displayName_count, displayName_first, ownerlessTeamCount |
| `teams:team-count` | ok | 18 | id_count, id_first, teamCount, _itemCount, displayName_count, displayName_first |


### 7.4 The portal pillar payload (`GET /api/portal/assessment/war-room-pillars`) — captured live, authenticated, 2026-08-28

Top-level: `{pillars: PillarCard[7], licenseSkuLedger, licenseGapPurchase, findingsRunId, findingsRunStatus, activeRunId, scannedPackageKeys, scannedCheckCount, scannedCheckKeys, checkKeyPillars, generatedAt}`. Observed: `scannedPackageKeys: ["assess:copilot-readiness"]`, `scannedCheckCount: 101`, `findingsRunStatus: "partial"`, `checkKeyPillars` = a real check→pillar routing map.

`PillarCard`: `{pillar, enginePillar, score (0-100 | null), evaluation {score, evaluableSignalCount, minRequiredSignals, theoreticalMax, status: "scored"|…, reason}, rawRiskScore, stats: StatTile[], findings: Finding[], findingCounts {critical, warning}, trend (null until ≥2 scans — observed null on this 1-scan tenant), licenseGapUpgrades}`.

`StatTile` — the hero tiles, self-describing provenance: `{id, label, unit, checkKey, replaces (the fixture string it supersedes), value (real | null), unavailableReason?, source}`. The full live tile map with real values is §9.1.

`licenseSkuLedger` — real, from `license:sku-utilization`: `{rows: [{skuPartNumber:"ENTERPRISEPACK", displayName:"Office 365 E3", purchased:1, assigned:1, unassigned:0, unitMonthlyPriceCents:2300, monthlyWasteCents:0, annualWasteCents:0}], totalPurchased, totalAssigned, totalUnassigned, totalMonthlyWasteCents, totalAnnualWasteCents, excluded: [{skuPartNumber:"FLOW_FREE", purchased:10000, reason:"zero_price"}, {skuPartNumber:"POWER_BI_STANDARD", purchased:1000000, reason:"zero_price"}, {skuPartNumber:"Power_Pages_vTrial_for_Makers", purchased:10000, reason:"no_price_on_file"}], checkKey:"license:sku-utilization", …}`. Money is integer **cents**; `excluded[]` with reasons is a real state to render.

### 7.5 `tenant_pillar_snapshots` row (pillar history)

`{customer_id, msp_id, pillar_key, score int 0-100, previous_score, delta, trend_direction "up"|"down"|"flat"|null, package_key, run_id, captured_at}` — one row per scored pillar per coverage-sufficient run. Real rows (run 437, customer 1): security 54 · licensing 54 · architecture 8 · copilot 50 · adoption 89 · compliance 73 · governance 54, all `previous_score` null (first post-cleanup scan). A dark/partial run writes nothing (the coverage gate), so absence of history = "not enough history yet", never zero.

### 7.6 Drift shapes

`drift_baseline_snapshots`: per (tenant, domain) approved-state snapshot. `drift_events`: itemized, id-keyed setting deviations `{domain_key, verdict: approved|attributed_unapproved|unattributed|informational, …}` (taxonomy per #1282/#1287; 0 rows live — no deviation since baseline). `drift_collection_status`: per-domain honest status, observed literals `tracked` and `not_comparable`. The resolver serves: baseline+events → `ok{events:[…]}`; baseline+none → `ok{events:[]}` (genuinely clean); no baseline → `not_available(no_data)`; not comparable → `not_available(not_comparable + the collector's own reason)`.

## 8. ABSENT — registry sourceKeys with no catalog check (67)

Every row below is a `monitor_profile` registry metric whose `sourceKey` names **no row in `monitor_checks`** — live-diffed against the 157-key catalog on 2026-08-28. Per the resolver (dashboard-resolvers.ts:629-635) each resolves to `unknown_check_key` and **can never produce data until the registry key matches a real catalog key or the check is built**. The ⚠ rows are near-miss naming drift where a semantically-similar real check exists under a different key — a rename/re-point decision, not a build decision. (The 18 `drift:*` keys are excluded here — they route to the real drift store, §6.)

**67 phantom sourceKeys.**

| Registry metric | Phantom sourceKey | Near-miss real check (⚠ rename/re-point candidate) |
|---|---|---|
| `identity.changeEventCount` | `audit:directory-audits` | (none) |
| `identity.provisioningEventCount` | `audit:provisioning` | (none) |
| `identity.signinActivity` | `audit:signins` | (none) |
| `collaboration.delegationGrantCount` | `collaboration:delegation-grants` | (none) |
| `collaboration.forwardingMailboxCount` | `collaboration:forwarding-mailboxes` | (none) |
| `collaboration.inboxRuleCount` | `collaboration:inbox-rules` | (none) |
| `collaboration.mailboxCount` | `collaboration:mailboxes` | (none) |
| `collaboration.sharedMailboxSigninEnabledCount` | `collaboration:shared-mailbox-signin` | (none) |
| `collaboration.teamsChannelCount` | `collaboration:teams-channels` | (none) |
| `compliance.activeEdiscoveryCount` | `compliance:active-ediscovery` | (none) |
| `compliance.externalInviteCount` | `compliance:external-invites` | (none) |
| `compliance.guestUserCount` | `compliance:guest-users` | ⚠ `governance:guest-count` |
| `compliance.missingRetentionTagCount` | `compliance:missing-retention-tags` | (none) |
| `compliance.oneDriveExternalCount` | `compliance:onedrive-external` | (none) |
| `compliance.orphanedSiteCount` | `compliance:orphaned-sites` | (none) |
| `compliance.orphanedTeamCount` | `compliance:orphaned-teams` | (none) |
| `compliance.oversharedSiteCount` | `compliance:overshared-sites` | (none) |
| `compliance.publicChannelCount` | `compliance:public-channels` | (none) |
| `compliance.sharePointSiteCount` | `compliance:sharepoint-sites` | (none) |
| `licensing.copilotLicenseBreakdown` | `copilot:license-readiness` | (none) |
| `copilot.overshareExposureCount` | `copilot:overshare-exposure` | (none) |
| `licensing.wasteEstimateBreakdown` | `cost:license-waste-estimate` | (none) |
| `dynamics.appPermissionCount` | `dynamics:app-permissions` | (none) |
| `dynamics.appRoleDriftCount` | `dynamics:app-role-drift` | (none) |
| `dynamics.consentChangeCount` | `dynamics:consent-changes` | (none) |
| `dynamics.orphanedSpCount` | `dynamics:orphaned-sps` | (none) |
| `dynamics.permissionGrantCount` | `dynamics:permission-grants` | (none) |
| `dynamics.roleAssignmentCount` | `dynamics:role-assignments` | (none) |
| `dynamics.spDriftCount` | `dynamics:sp-drift` | (none) |
| `identity.disabledAccountCount` | `identity:disabled-accounts` | (none) |
| `identity.passwordlessUserCount` | `identity:passwordless-adoption` | (none) |
| `intune.configDriftCount` | `intune:config-drift` | (none) |
| `intune.highThreatDeviceCount` | `intune:high-threat-devices` | (none) |
| `intune.jailbrokenDeviceCount` | `intune:jailbroken-devices` | (none) |
| `intune.nonCompliantDeviceCount` | `intune:non-compliant-devices` | ⚠ `devices:compliant-vs-noncompliant` |
| `intune.outdatedDeviceCount` | `intune:outdated-devices` | ⚠ `devices:os-patch-compliance` |
| `intune.rootedDeviceCount` | `intune:rooted-devices` | (none) |
| `intune.unencryptedDeviceCount` | `intune:unencrypted-devices` | ⚠ `devices:encryption-status` |
| `intune.unenrolledDeviceCount` | `intune:unenrolled-devices` | ⚠ `devices:enrollment-status` |
| `licensing.duplicateLicenseCount` | `licensing:duplicate-assignments` | ⚠ `cost:duplicate-assignments` |
| `licensing.inactiveLicenseCount` | `licensing:inactive-user-licenses` | ⚠ `license:unused-assigned` |
| `licensing.skuBreakdown` | `licensing:sku-utilization` | ⚠ `license:sku-utilization` |
| `platform.dbFailureCount` | `platform:db-failures` | (none) |
| `platform.expiringTokenCount` | `platform:expiring-tokens` | (none) |
| `platform.failedServiceCount` | `platform:failed-services` | (none) |
| `platform.failedEndpointCount` | `platform:graph-failed-endpoints` | (none) |
| `platform.rateLimitEventCount` | `platform:graph-rate-limits` | (none) |
| `platform.queueDepthCount` | `platform:queue-depth` | (none) |
| `platform.schedulerDelayCount` | `platform:scheduler-delays` | (none) |
| `powerPlatform.appCount` | `power-platform:app-inventory` | (none) |
| `powerPlatform.flowCount` | `power-platform:flow-inventory` | (none) |
| `security.activeAlertCount` | `security:active-alerts` | (none) |
| `security.alertsBySeverity` | `security:active-alerts` | (none) |
| `security.failedSimulationCount` | `security:attack-simulation` | (none) |
| `security.highSeverityAlertCount` | `security:high-severity-alerts` | (none) |
| `security.malwareAlertCount` | `security:malware-alerts` | (none) |
| `security.phishingAlertCount` | `security:phishing-alerts` | (none) |
| `security.riskDetectionCount` | `security:risk-detections` | (none) |
| `security.secureScoreControls` | `security:secure-score-controls` | ⚠ `security:secure-score-by-category` |
| `security.secureScoreDriftCount` | `security:secure-score-drift` | (none) |
| `workflow.dependencyFailureCount` | `workflow:dependency-failures` | (none) |
| `workflow.workflowFailureCount` | `workflow:failures` | (none) |
| `workflow.highLatencyNodeCount` | `workflow:high-latency-nodes` | (none) |
| `workflow.invalidSchemaNodeCount` | `workflow:invalid-schema-nodes` | (none) |
| `workflow.nodeTimeoutCount` | `workflow:node-timeouts` | (none) |
| `workflow.queueBacklogCount` | `workflow:queue-backlog` | (none) |
| `workflow.unhealthyNodeCount` | `workflow:unhealthy-nodes` | (none) |


## 9. Portal-v2 reverse map — what each rendered element is backed by

Scope: the portal-v2 customer portal (v1.1 scope: Assessments + Projects + portal). Route base `/portal-v2` (dev SPA at `/portal/<slug>`); pages in `artifacts/msp-portal/src/pages/portal-v2-*.tsx`, wiring in `src/components/portal-v2/`. The platform's own honesty convention helps here: every wired page exposes a visually-clipped `dataState` marker ("live" vs "fixture") and the fixture files document their own gaps with issue numbers — those statements were verified against the live payload/DB wherever cited below.

### 9.1 Pillar hero tiles — live-captured backing map (the authoritative version of "what's real on the heroes")

Captured from the authenticated live payload for the testbed. **value** = what a real tenant renders today; `UNBACKED` = the tile's checkKey does not exist (deletion/rename candidates in bold):

| Pillar | Tile (label) | checkKey | Live value / reason |
|---|---|---|---|
| governance | sites inventoried | `compliance:sharepoint-sites` | **UNBACKED — unknown_check_key** |
| governance | overshared sites | `compliance:overshared-sites` | **UNBACKED — unknown_check_key** |
| governance | items over-exposed | `copilot:overshare-exposure` | **UNBACKED — unknown_check_key** |
| governance | public channels | `compliance:public-channels` | **UNBACKED — unknown_check_key** |
| licensing | paid seats provisioned | `license:sku-utilization` | **1** (real) |
| licensing | paid, unassigned | `license:sku-utilization` | **0** (real) |
| licensing | annual waste | `license:sku-utilization` | null — `no_sku_prices` (honest; this tenant's SKUs lack price data) |
| licensing | inactive licences | `licensing:inactive-user-licenses` | **UNBACKED — unknown_check_key** |
| adoption | active Teams users | `adoption:teams-activity-trend` | **0** (real) |
| adoption | active SharePoint users | `adoption:sharepoint-onedrive-trend` | **0** (real) |
| adoption | active OneDrive users | `onedrive:active-users` | null — `not_in_scan_package` (check exists, wasn't in this run's package) |
| adoption | active email users | `adoption:email-activity-trend` | **1** (real) |
| compliance | missing sensitivity labels | `compliance:missing-labels` | null — `no_data` (PS check errored; real check, broken pipeline) |
| compliance | weak DLP policies | `compliance:weak-dlp-policies` | null — `no_data` (same) |
| compliance | guest users | `compliance:guest-users` | **UNBACKED — unknown_check_key** (real check exists as `governance:guest-count`) |
| health | non-compliant devices | `intune:non-compliant-devices` | **UNBACKED** (real: `devices:compliant-vs-noncompliant`, never run) |
| health | device config drift | `intune:config-drift` | **UNBACKED — no counterpart at all** |
| health | unencrypted devices | `intune:unencrypted-devices` | **UNBACKED** (real: `devices:encryption-status`, never run) |
| health | outdated OS devices | `intune:outdated-devices` | **UNBACKED** (real: `devices:os-patch-compliance`, never run) |
| security | MFA-registered users | `identity:mfa-registration` | null — `license_gap` (no AAD P1/P2 on testbed; real & ok on customer 3) |
| security | global administrators | `identity:global-admin-count` | **6** (real) |
| security | legacy auth sign-ins | `identity:legacy-auth-usage` | null — `license_gap` (same; 35 real items on customer 3) |
| security | items in blast radius | `copilot:overshare-exposure` | **UNBACKED — unknown_check_key** |
| copilot | readiness score | (composite) | **50** (real) |
| copilot | items Copilot could reach | `copilot:overshare-exposure` | **UNBACKED — unknown_check_key** |
| copilot | risky users | `identity:risky-users` | null — `license_gap` |
| copilot | duplicate licences | `licensing:duplicate-assignments` | **UNBACKED** (real: `cost:duplicate-assignments`, observed ok items=24) |

Stat-tile definitions live server-side in `artifacts/api-server/src/lib/copilot-readiness.ts`; scores/deltas/findings overlay client-side via `useLivePillarHero.ts` (fixture fallback below a real score, `dataState` marker for tests).

### 9.2 Per-page backing map

**Legend:** REAL = fetches a live server route whose backing data was verified above · GATED = real wiring, honest empty/gap state on tenants without the SKU/scan · FIXTURE = design fixture rendered as-is (documented in the file header cited) · UNBACKED = references data that exists nowhere (deletion candidate).

| Page (route → file) | Element | Backing | State |
|---|---|---|---|
| **Overview** `/portal-v2` → `portal-v2-overview.tsx` | 7 pillar cards (score, trend, findings) | war-room payload (§7.4) | REAL |
| | Risk register / policy decisions strips | `/api/portal/risk-register`, `/api/portal/policy-decisions` (`portal-risk-register.ts`) | REAL |
| | Runbooks / hold windows | `/api/portal/runbooks`, `/api/portal/hold-windows/*` | REAL |
| | Change control strip | `/api/portal/change-control` (`portal-change-control.ts`) | REAL |
| | Projects widget | `/api/portal/dashboard`, `/api/portal/projects/:id` | REAL |
| | Microsoft message center | `/api/portal/message-center` ← check `m365:message-center` (observed 486-577 items) | REAL |
| | Remediation tracker | `/api/portal/remediation-tracker/pillar-scores` (#1381: rolling before/now + permanent dayOne off `tenant_pillar_snapshots`) | REAL |
| **Health** `/portal-v2/health` → `portal-v2-health.tsx` + `hltDashboardData.ts` | Hero score/delta/pill | `useLivePillarHero("health")` → architecture pillar | REAL |
| | Debt items list | real pillar findings (`hltFindingRowFromLive`, #1442); fixture only pre-load | REAL |
| | Stale-object inventory (9 rows) | 3 rows live (#1340): `devices:stale-duplicate-records` ×2 (never run on real tenant → fixture fallback renders), `appgov:cert-secret-expiration` (real: expired creds counts); **6 rows FIXTURE** (no backing checks: ownerless app registrations, 30-day credential window, directory-sync rows) | PARTIAL |
| | Config-drift table + hero drift stat | 18 `drift:*` metrics via `/api/dashboard/resolve` (#1282) → real drift store; renders honest no-live-data / clean / events states | REAL (empty today) |
| | Department heat-map | none — prototype's fictional Halden Materials figures (`hltDashboardData.ts` header) | FIXTURE |
| | Trend chart (open debt) | design fixture series | FIXTURE |
| **Governance** `/portal-v2/governance` → `portal-v2-governance.tsx` + `govDashboardData.ts` | Hero ring/delta/sparkline/pill + "Global Administrators" & "Governance Findings" tiles | live payload | REAL |
| | "Overdue Access Reviews" hero tile | stated gap (no wiring) | UNBACKED |
| | 14 area cards | 13 live per-card value+delta+severity via `/api/portal/governance/areas` (`portal-governance-areas.ts:64-78`; each card's real checkKey named there) | REAL |
| | "External Sharing Drift" area card | spec'd domain, no comparable data yet (#1287) — renders honest no-data unconditionally | GATED |
| **Compliance** `/portal-v2/compliance` → `portal-v2-compliance.tsx` + `cmpDashboardData.ts` | Hero + "Open Gaps" tile | live payload | REAL |
| | "Retention Coverage" / "Audit Retention (days)" hero tiles | no producing check anywhere (`compliance:retention-drift` retired #1103) | UNBACKED |
| | Area cards status | `cmpAreaWiring.ts` → real checks (`governance:retention-*`, `compliance:audit-log-retention`, `exchange:litigation-hold-coverage`, …); those PS checks are PARTIAL so cards honestly show gap states | GATED |
| | Six area cards with NO producing check: Disposition Review, Preservation Lock, Records Declaration, Subject Requests, Audit Coverage, Stale Legal Holds (verified: litigation-hold does NOT cover it) | — | UNBACKED |
| | Finding rows / policy decisions / obligations | real findings + `/api/portal/policy-decisions` + `/api/portal/compliance-obligations` | REAL |
| **Adoption** `/portal-v2/adoption` → `portal-v2-adoption.tsx` + `adpDashboardData.ts` | Hero | live payload | REAL |
| | 10 workload rows | 4 live (#1252: Exchange, Teams, SharePoint per-site, OneDrive — via `usage.*` metrics off `adoption:*`/`onedrive:*` checks, independent per-row fixture fallback); **6 FIXTURE** (Teams channels, Copilot, Power BI, Teams Phone, Planner, Viva Engage — no per-item server feed) | PARTIAL |
| | Department matrix, adoption plays, park/accept drawers | prototype fixture; park state client-side | FIXTURE |
| **Licensing** `/portal-v2/licensing` → `portal-v2-licensing.tsx` + `licDashboardData.ts` | Hero score/delta | live payload | REAL |
| | Per-SKU ledger + waste totals + excluded list | `licenseSkuLedger` (§7.4) | REAL |
| | 3 recovery buckets (today/renewal/reassign) + timing chips | no billing-term or per-seat-activity data exists anywhere (#1230, reconfirmed #1446) | UNBACKED |
| | Department heat-map rows | fixture (`licDashboardData.ts` #1446 strict pass notes) | FIXTURE |
| **Security** `/portal-v2/security` → `portal-v2-security.tsx` | Hero + tiles | live payload (see §9.1 — blast-radius tile UNBACKED) | REAL |
| | Area link cards | 5 metrics via `/api/dashboard/resolve`: `governance.riskyPermissionGrantCount` (real), `security.emailAuthFindingCount` (real, DNS check), `identity.mfaGapCount` + `identity.legacyAuthCount` (license-gated on testbed), `security.secureScore` (real) | REAL/GATED |
| | CA baseline bands `/security/ca` | `/api/portal/tenant-check-items` ← `identity:ca-policy-count` items | REAL |
| | MFA drill-down `/security/mfa` | tenant-check-items ← `identity:mfa-registration` | GATED (license) |
| | Evidence pages (email-auth, legacy-auth, OAuth) | resolve-metrics per page (`useSecEvidence*.ts`) | REAL/GATED |
| | Security plan `/security/plan` | `/api/portal/security-plan` | REAL |
| **Copilot** `/portal-v2/copilot` → `portal-v2-copilot.tsx` | Journey/gate (82-gate per `computeCopilotGate`), documents, generation | `useCopilotJourney` + war-room; before→after projections render only when real (no fabricated projection — #1207 class) | REAL |
| **Remediation** `/portal-v2/remediation` | pillar score chips, day-one deltas | `/api/portal/remediation-tracker/pillar-scores` (#1381) | REAL |
| **Change Control** `/portal-v2/change-control` | CR list/create | `/api/portal/change-control`; FixPanel/SOP flows POST real CRs (#1168; no approve/execute route exists) | REAL |
| | Freeze-window / CAB staffing copy | fictional Halden staff names hardcoded (#1342 — confirmed leaking on live page) | UNBACKED (delete/replace) |
| **Risk register / decisions** | register + decisions | real routes | REAL |
| **SOPs** `/portal-v2/sops` | hub | `/api/portal/sops`, `/api/portal/sop-runs` | REAL |
| | `sop-category` pages | placeholders (only the hub is real) | FIXTURE |
| **MS Changes** `/portal-v2/ms-changes` | change feed | `/api/portal/message-center` ← `m365:message-center` | REAL |
| **Oversharing** `/portal-v2/governance/oversharing` | sites/items/runbooks | `/api/portal/oversharing/*` ← `compliance:eeeu-site-sharing` fan-out data | REAL |
| **Ownership** | ownership panels | `/api/portal/ownership` (`portal-ownership.ts`) — route exists; not live-executed this session | REAL (route) |
| **Webhooks / PII / Documents / Billing / Retainer / Account security / Alert prefs** | | `/api/portal/webhooks`, `/api/portal/pii-governance`, doc library, `/api/portal/invoices` + Stripe receipts, `/api/portal/retainer`, `/api/auth/*`, `/api/portal/alert-preferences` — all present server-side | REAL (routes) |

**Deletion-candidate summary for Design** (everything above marked UNBACKED): the four governance hero tiles' oversharing/site-inventory numbers, the Health hero's four `intune:*` device tiles (or re-point to the real `devices:*` checks once those packages actually run), Security's blast-radius tile, Copilot's exposure tile, Licensing's "inactive licences" tile and all three recovery buckets with their timing chips, Compliance's "Retention Coverage" + "Audit Retention (days)" tiles and six unproduced area cards, Governance's "Overdue Access Reviews" hero tile (note: the *check* `governance:overdue-access-reviews` is real — only this tile's wiring is absent), the Health department heat-map and debt-trend series, Adoption's six fixture workload rows + department matrix + plays, and Change Control's fictional CAB staffing. Fixture content that remains must keep its honest `dataState="fixture"` marker until deleted or wired.

## 10. Evidence log

Live DB queries (2026-08-28, database `shanemccawmsp`): via `shaneapp://executeSql` (BuildConsole → `POST /api/simulator/sql/execute`, ActivityLog channel `sql-runner.protocol`) for the first five batches — bt_build_queue lookup + schema introspection; monitoring tables enumeration; `monitor_checks` full dump; executor/status/package aggregations; tenants + trigger prefixes + table counts; latest-per-check with `extracted_properties`. Mid-session the owner authorized **direct psql** over `DATABASE_URL` for the remainder: per-check observation matrix for PS/DNS/SP-admin; run rows + PS error literals + package membership of never-observed checks + fresh pillar/engine snapshot reads; wf-run↔`core:security-baseline` membership join (23/23); package-membership dump; drift/item-detail counts; never-run-package check list; classification input dump. Raw result files preserved in the session scratchpad (`sql-*.result.json`, `*.tsv`, `testbed-run-437-observations.jsonl`, `classification.json`, `war-room-pillars.json`).

Live protocol/API calls: `shaneapp://executeCmdlet` (§9 contract, AGENT_PROTOCOLS.md) `get-connection-info` vs testbed → the §4.1 failure envelope. Authenticated portal capture: `POST /api/auth/login` (test portal account) → `GET /api/portal/assessment/war-room-pillars` (customer 1) → §7.4/§9.1. Fresh scan: run 437 was triggered by the owner during this investigation; its rows/snapshots/findings were read directly.

Key code citations: `artifacts/api-server/src/lib/monitor-executor.ts` (:1029 applyMapping, :1504 graphFetchPaginated, :1761 runPowerShellCheck, :1980 runSharePointAdminCheck, :2095-2184 DNS, :2277 runFanOutCheck, :2532/2635/2645/2655 dispatch, :2919 loadOrderedPackageChecks, :2962 executeMonitoringPackage, :153 drift collection) · `diagnostics-runner.ts` (:736 package execution, :1085 pillar snapshot capture) · `workflow-executor.ts` (:8354 execute_pkg) · `item-detail-collector.ts` (:244) · `admin-monitor-check-runs.ts` (:184 Simulator path) · `engine-registry.ts` (:181 ENGINE_DEFS, :324-353 writeEngineSnapshot, :478-482 wrap) · `pillar-snapshot.ts` (:51-109) · `pillar-coverage.ts` (:110-122 pillar vocabulary) · `health-engine.ts` (:53) · `dashboard-resolvers.ts` (:261, :271-353, :592-659, :678, :769-915) · `lib/dashboard-registry/src/metrics.ts` (registry + its own phantom-key history at :21-49) · `services/ps-execution/cmdlet-catalog.ps1` + `child-worker.ps1` (:86-130) · portal wiring files cited inline in §9.

## 11. Explicit unknowns — what could not be verified, and why

1. **No PowerShell check's real output shape has ever been observed.** The catalog declares cmdlets and mappings, but with the container's child-process layer broken (§4.1), no `extracted_properties` for any PS check exists anywhere. Their shapes in this document are **declared in code, never observed live**. Unblocks when the ps-execution container is fixed.
2. **The 34 never-run Graph checks' shapes are likewise declared-only** (mapping targetFields exist in the catalog rows) — no real run has included their packages. A single `core:premier` (or `core:growth`) run against the testbed would close most of this; the checks themselves look wired (same executor code path as the 96 proven ones), but per the standing rule they are not marked REAL on plumbing resemblance.
3. **`sharepoint:tenant-sharing-capability`** cannot be verified until valid `MT_APP_CERT_*` SharePoint app-only credentials are configured locally (every observation, including run 437, errors on cert parsing/absence).
4. **`tenant_engine_snapshots` / Mission Control engine runs** were not exercised (no Mission Control fetch was made; the table stayed empty). The engine-metric behavior in §6 is code-read plus the empty-table observation, not an observed engine run.
5. **Per-check Graph permission scopes** are not recorded per-check anywhere in the platform; only the tenant-level granted consent set (§3) is real data. Attributing an exact scope to each of the 138 Graph endpoints would be inference, so it was not done.
6. **`requires_script` and `consent_revoked` statuses** were never observed live this session (both runs had 0); their semantics are code-declared (monitor-executor.ts:3019-3030).
7. **Trend series** (`pillar.trend`, ≥5 checkpoints) could not be observed — the post-cleanup testbed has exactly one scan of history. Shape is declared (series of numbers, replayed score history).
8. **The `e2e13170-…` tenant's rows were deliberately excluded** from all REAL evidence as synthetic; if any future audit counts them, its numbers will differ from §4's.
9. **Progress reporting for this build** (`shaneapp://reportProgress`) was skipped: `bt_build_queue` has no row for issue #1481 (checked live), so there was no valid `buildId` to report against — reporting against another build's id would have corrupted its Build Watch panel.

---
*Generated for issue #1481. Sections 4/7.3/8 tables are machine-generated from the live query results named in §10 to eliminate transcription error; the generation script is `classify.mjs` + `build-doc.mjs` in the session scratchpad.*
