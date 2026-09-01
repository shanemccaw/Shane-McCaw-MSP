# Pillar Mapping — every real backend data source, its pillar, and its real shape

**Issue:** #1841 (regeneration of #1481; parent epic #1096) · **Investigated:** 2026-09-01 · **Author:** Claude Code build session (read-only investigation) · **Supersedes:** the 2026-08-28 edition, whose headline finding is now false.

This document is written for **Claude Design**, which has **no access to this repository or its database**. Everything needed to act on it is in this file. Its purpose: state, with evidence, exactly which platform data sources are real, which are partially real, and which are absent — so a portal UI can be built to render what genuinely exists at its true shape, and UI elements with nothing real behind them can be left unbuilt.

**Why this is a full regeneration, not an edit (read this).** The prior edition's single most consequential finding — *"the entire PowerShell execution layer is PARTIAL today — all 17 checks,"* 14 of them erroring with `"The request-handling child process produced malformed output."` — **is no longer true.** That was the #1400 container child-process bug, since fixed (`13658fc4f` / `790971b38` / `04d0b8b3c`) and confirmed by #1766, with the failure set re-baselined on #1786. Its scan-count headline (109 ok / 18 error) and its 29-scope permission inventory are likewise stale (#1786, #1811, #1830). Everything below was re-derived from scratch against the live database and code at commit `7a46c5d9`, not carried forward.

**Evidence discipline.** Every claim below traces to one of: (a) a live SQL query against the platform's PostgreSQL database (`shanemccawmsp`, local PostgreSQL 18), run 2026-09-01; (b) a real file path + line in this repo, pinned at commit `7a46c5d9`; (c) a real, recent scan run recorded in that database. Where something could not be verified live, it is labelled as such with the exact blocker — never presented as observed. §10 is the full evidence log; §11 the explicit unknowns. Both are real sections, not vestigial.

**Environment caveat, stated once so every claim inherits it:** all live observations are against the **local dev platform** (local PostgreSQL 18 on `DATABASE_URL`, dev api-server, dev ps-execution container `ca-ps-execution-dev`, container revision `ca-ps-execution-dev--dev20260830030636` per #1786) and the **testbed** Microsoft 365 tenant `mccawsoft2.onmicrosoft.com` (`tenants.id = 1`, Entra tenant `c4c814d4-3afe-441e-9145-62461d0a4fd3`, `is_testbed = true`). Per the project's hard rule, **production was never touched** — no SSH, no credential, no read-only count. A second real tenant id (`shanemccaw.onmicrosoft.com`, `tenants.id = 3`) carries older observations (2026-08-09) and was **not** re-scanned this session; nothing here classifies a check REAL on its evidence alone. A third `tenant_id` appears in the observation table (synthetic E2E harness); its rows are excluded from all REAL evidence. Gov/GCC tenants are out of platform scope and are not mapped.

**The canonical re-baseline scan.** The freshest full-package run against the testbed is `core:premier` diagnostics run `82015d75-ca18-42f3-94d1-c2edf4d61aea` (2026-08-30 09:32): **151 checks — 115 ok · 23 license_gap · 11 service_not_configured · 2 partial · 0 error.** The recurring monitoring workflow reproduced it the next day (`wf-run-34320`, 2026-08-31 03:34) at 114 ok / 1 error — the single error being a transient `terminated` on the Graph report check `adoption:sharepoint-onedrive-trend`, which is `ok` in every other recent run. **Zero systemic errors.** The prior edition's 18 errors — 15 PowerShell/Teams-session failures, the SharePoint-admin cert, `adoption:planner-usage`, `platform:branding-config` — are all resolved.

**Scanning is being extended (in flight — do not read this map as final).** A separate config-state effort (#1793 → #1798) is building a **whole-configuration snapshot store** beside the check catalog, plus a differ that turns drift/baseline-assessment/tenant-compare/promotion into one engine. It is **not built into scanning yet** and this document does not describe it as if it were (see §12 for its real, partial current footprint). When that chain lands, this map is regenerated a second time under **#1845** — the snapshot resource model, which of the 18 drift domains gain a producer, and the app-only PowerShell surface survey all belong to that pass, not this one.

---

## 1. Executive summary

The platform's backend check catalog is a **database table, not code**: `monitor_checks`, **157 rows** (live count, 2026-09-01). Each row is one check with its own executor type, Graph endpoint or PowerShell cmdlet, extraction mapping, severity rules, and engine (pillar) tags.

| Executor type | Active | Inactive | Total |
|---|---|---|---|
| `graph` (Microsoft Graph REST) | 136 | 2 | 138 |
| `powershell` (EXO / Purview / Teams cmdlet via the ps-execution container) | 17 | 0 | 17 |
| `dns` (public DNS TXT lookups) | 1 | 0 | 1 |
| `sharepoint-admin` (SharePoint admin API, app-only cert) | 1 | 0 | 1 |
| **Total** | **155** | **2** | **157** |

**Three-state classification of the 157 catalog checks: 152 REAL · 5 PARTIAL · (ABSENT applies to referenced-but-nonexistent checks, §8).** A check is **REAL** if it was observed executing against the testbed with a genuine outcome — `ok` with data, or an honest `license_gap` / `service_not_configured` / `partial` state; **PARTIAL** if it is wired but has never been invoked by a real run; ABSENT covers registry keys that name no catalog check at all.

Headline findings, most consequential first:

1. **The PowerShell execution layer is REAL, not partial. This is the biggest change from the prior edition.** All 17 PowerShell checks resolve their cmdlet container-side and execute app-only; **14 of the 15 that run in a scoring package now return `ok` with real data** — real transport rules, mailboxes, DLP policies, anti-spam policies, Teams phone provisioning — and the 15th (`compliance:audit-log-retention`) returns an honest `license_gap` (this tenant lacks the Purview add-on). The two remaining PowerShell checks are PARTIAL only because they sit in packages that never run (`diagnostics:ps-execution-test` in the collection-only package; `exchange:auto-forwarding-rules` in no package at all), not because the pipeline is broken. Live proof: `exchange:mail-flow-rule-review` and `exchange:transport-rule-count` both return `items=7` (the 7 real transport rules #1786 verified); `exchange:archive-mailbox-rate` and `exchange:litigation-hold-coverage` return `items=8`. The prior edition's "malformed output" error appears **nowhere** in the current observation data.

2. **There is a new honest status, `service_not_configured` (#1847), and Design must render it.** Eleven checks — the ten Intune `devices:*` checks plus `teams:rooms-device-health` — no longer report `ok items=0` on a tenant that has no Intune. They report `service_not_configured` with a human reason (*"Microsoft Intune is not licensed on this tenant."*) and a distinct extraction shape (`_serviceKey`, `_serviceName`, `_serviceState`, `_serviceUnavailable`, `_serviceDetectionSignature`). This is why the architecture/Health pillar score sits at 54 today, not the transiently-inflated 63 the prior edition recorded from a run that still counted those checks as `ok`-with-zero. The full observed status set is now `ok | error | license_gap | partial | consent_revoked | requires_script | service_not_configured | azure_no_rbac | azure_no_subscriptions` (monitor-executor.ts:352) — the last three did not exist when the prior edition was written.

3. **The permission inventory changed: 35 declared scopes, not 29.** `REQUIRED_MT_SCOPES` (graph.ts:66-119) now holds **35 entries** — 32 Microsoft Graph resource scopes plus `Exchange.ManageAsApp` + `Exchange.ManageAsAppV2` (Exchange Online resource) + `ActivityFeed.Read` (O365 Management API). #1811 added four that were live in Entra but absent from the code (`Tasks.Read.All`, `DeviceManagementApps.Read.All`, `TeamworkDevice.Read.All`, `Exchange.ManageAsAppV2`) — the `Tasks.Read.All` grant is what took `adoption:planner-usage` from 403-on-all-groups to `ok`. Note two live caveats: the code still spells `BitLockerKey.Read.All` where Microsoft's registered value is `BitlockerKey.Read.All` (#1830, open, same GUID so functionally correct), and the **testbed's persisted `consent.graph.grants` snapshot still holds only 29 scopes** (consented 2026-08-17, before #1811) — the re-consent drift #1811 flagged. §3 gives the full list.

4. **The dashboard registry still names 67 checks that do not exist** (§8). Unchanged: the registry (`lib/dashboard-registry/src/metrics.ts`, 198 metrics) is versioned independently of the catalog, and 67 of its `monitor_profile` `sourceKey`s match no `monitor_checks.key`. They resolve to the literal `unknown_check_key` outcome. Some are pure naming drift where a real check exists under another key (e.g. `intune:non-compliant-devices` vs real `devices:compliant-vs-noncompliant`); most have no counterpart. This is a registry-vs-catalog fact, independent of any UI.

5. **The pillar model still has three vocabularies, and they do not line up 1:1** (§2). Design should treat the **7 display pillars** as canonical: `governance, compliance, adoption, copilot, architecture (labelled "Health"), licensing, security`. The catalog tags checks with **engine tags** (`security, governance, adoption, health, compliance, cost, copilot, licensing, architecture, monitoring, priority`) where `health` ≈ the architecture pillar, `cost` feeds licensing, and `priority` is a ranking weight, not a pillar.

6. **Pillar scores are real and stable; the raw engine layer is still empty.** `tenant_pillar_snapshots` holds 35 rows for the testbed; the latest set (2026-08-30, `core:premier`) is: adoption 82 · architecture 54 · compliance 70 · copilot 49 · governance 53 · licensing 50 · security 55, all `delta 0 / flat` — repeated same-package runs have converged. `tenant_engine_snapshots` is still **0 rows** (only Mission Control / admin engine runs write it — not scans), so all 16 `engine_snapshot` registry metrics resolve `no_snapshot`.

7. **Config-drift is real, populated, and slightly fuller than before.** The testbed now has **4 drift baselines** (`ca-policy`, `email-authentication`, `public-teams-discoverable`, and — newly, since the SharePoint cert was fixed — `tenant-sharing-capability`, all `tracked`), with `eeeu-site-sharing` honestly `not_comparable`. `drift_events` = 0 (nothing changed since baseline). Only **5 of the 18** registry drift domains have a collection spec (`drift-check-specs.ts`); the other 13 have no producer until the config-state differ lands (#1794/#1797).

8. **What is genuinely REAL is now nearly the whole catalog**: 152 of 157 checks observed executing against the testbed with a genuine outcome — the identity/CA family, secure score, Teams governance, SharePoint site facts, licensing SKU truth, adoption activity reports, app governance, DNS email-auth, **and the full PowerShell EXO/Purview/Teams surface** — plus a real findings pipeline, real per-item evidence (`tenant_check_item_details`, 142 distinct checks for the testbed), honest `license_gap` for the ~23 checks the testbed's SKUs can't feed (no AAD P1/P2, no Defender for Office 365, no Purview add-on), and honest `service_not_configured` for the 11 Intune checks on this un-enrolled tenant.

Per-pillar totals for the 157 catalog checks (a check tagged with two pillar engines counts once per pillar; "architecture/Health" merges the `health` + `architecture` tags; "licensing/cost" merges `licensing` + `cost`; `priority`/`monitoring`/untagged listed separately):

| Pillar (from engine tags) | REAL | PARTIAL | Total |
|---|---|---|---|
| Security | 60 | 2 | 62 |
| Governance | 42 | 2 | 44 |
| Compliance | 14 | 1 | 15 |
| Adoption | 16 | 0 | 16 |
| Copilot Readiness | 9 | 0 | 9 |
| Health (architecture) | 26 | 0 | 26 |
| Licensing & Cost | 14 | 0 | 14 |
| priority (ranking engine, cross-cutting) | 16 | 1 | 17 |
| monitoring (engine-internal) | 1 | 0 | 1 |
| (untagged) | 2 | 1 | 3 |


## 2. The pillar model — three vocabularies and who persists what

**(a) Display pillars — canonical for Design.** `RADAR_PILLARS` = the 6 `HEALTH_PILLARS` + `security` (`artifacts/api-server/src/lib/health-engine.ts:52`, `pillar-coverage.ts:111`):

| pillar key | UI label | note |
|---|---|---|
| `governance` | Governance | |
| `compliance` | Compliance | |
| `adoption` | Adoption | |
| `copilot` | Copilot Readiness | |
| `architecture` | **Health** | the aliasing trap: snapshot/pillar key `architecture`, war-room payload key `health`, UI label "Health" |
| `licensing` | Licensing | |
| `security` | Security | radar/7th pillar; deliberately NOT in `HEALTH_PILLARS` (Git #1098/#1137) — never add it there |

**(b) Engine tags on checks** — `monitor_checks.engines` (jsonb array). Live single-tag counts: `security` (34), `governance` (24), `adoption` (12), `health` (12), `compliance` (11), `cost` (5), `copilot` (3), `architecture` (1), `licensing` (1), `monitoring` (1); plus two-tag combinations, and 3 checks with no tags (`m365:message-center`, `m365:service-health`, `diagnostics:ps-execution-test`). `priority` is always paired — a ranking weight for the Priority engine, not a display pillar.

**(c) Scoring engines** — `ENGINE_DEFS` (`engine-registry.ts`): `priority, pricing, health ("Architecture Health Engine"), security, drift, forecasting, crm, msp, sla, scope_creep, monitoring, sales_offer`. These produce raw scores (unbounded "risk points") distinct from the 0-100 display scores.

**Who persists what — verified live 2026-09-01:**

| Table | Written by | State observed |
|---|---|---|
| `tenant_monitor_profiles` | every check execution (`persistCheckProfile`, monitor-executor.ts:1873) | 1,717 rows across 3 tenant ids; the per-check observation store (status, extracted_properties, severity, raw_response) |
| `tenant_pillar_snapshots` | `capturePillarDisplaySnapshots` on `diagnostics.run_completed`, gated on graded coverage (`pillar-snapshot.ts`) | 35 rows for customer 1; latest set 2026-08-30, all `delta 0 / flat` (converged across repeated `core:premier` runs) |
| `tenant_engine_snapshots` | ONLY the wrapped `runForTenant` (engine-registry.ts), reached via Mission Control / admin engine routes — **not** by scans | **0 rows** |
| `msp_diagnostic_runs` / `msp_diagnostic_findings` | diagnostics-runner.ts | latest testbed run `82015d75` (`core:premier`, 151 checks, 0 error); several earlier `core:premier` runs same day |
| `tenant_check_item_details` | item-detail-collector.ts (the `detail:full-item-collection` collection mode) | 142 distinct checks' full item lists for customer 1 |
| `drift_baseline_snapshots` / `drift_events` / `drift_collection_status` | `collectDriftForCompletedCheck` (monitor-executor.ts:179) per completed check with a spec in `drift-check-specs.ts` | 4 baselines; 0 events; 5 status rows (ca-policy / email-authentication / public-teams-discoverable / tenant-sharing-capability `tracked`; eeeu-site-sharing `not_comparable`) |

**How a pillar score is computed:** `getPillarCoverage(packageKey, customerId)` (`pillar-coverage.ts`) evaluates intelligence signals over the tenant's `tenant_monitor_profiles` rows, producing a 0-100 display score per pillar with an evaluation record (`evaluableSignalCount`, `minRequiredSignals`, `theoreticalMax`, `status`, `reason`). A pillar with too few evaluable signals returns `status !== "scored"` and the UI must render its unscored state — a real state, not an error.

## 3. How a check executes

One dispatcher: `executeMonitorCheck` (`monitor-executor.ts:3159`), branching on `executor_type` (powershell → `runPowerShellCheck` :1896; sharepoint-admin → `runSharePointAdminCheck` :2115; dns → `runDnsCheck` :2481; default Graph). All paths share the identical downstream contract: items → `applyMapping` (:1073) → output-schema validation → `classifySeverity` (:909) → persistence to `tenant_monitor_profiles` (`persistCheckProfile` :1873), and each calls `collectDriftForCompletedCheck` (:179) if the check has a drift spec.

- **Graph path**: builds the request from the check row's own `endpoint`/`method`/`select_params`/`filter_params`/`request_body`, app-only token, `@odata.nextLink` pagination (`graphFetchPaginated` :1618), CSV report parsing for `/reports/*` endpoints. Endpoint placeholders like `{itemId}` are resolved per fan-out item.
- **Fan-out checks** (`fan_out_source` set): a collection endpoint feeds a per-item endpoint up to `fan_out_max_items` (`runFanOutCheck` :2896). A partial failure returns status **`partial`** with a coverage note observed live as *"Fan-out coverage: 93/94 items succeeded, 1 failed, 5 excluded"* — and a `partial` check makes the whole run `partial_failure`. Observed live: `compliance:eeeu-site-sharing` and `copilot:data-exposure-risk` (both `partial`, 93 items), `adoption:planner-usage`, `teams:channel-sprawl`, `teams:guest-settings-governance` (all `ok`).
- **PowerShell path**: `runPowerShellCheck` → Azure Container App (`ca-ps-execution-dev` for dev, `ca-ps-execution` for prod, selected by environment — #1385). The container resolves `ps_cmdlet_key` against a **code-owned catalog** (`services/ps-execution/cmdlet-catalog.ps1`) — never a script from the request — spawns a fresh child `pwsh` per request (#1400), connects app-only with a cert (`Connect-IPPSSession` for `compliance`, `Connect-ExchangeOnline` for `exchange`, `Connect-MicrosoftTeams` for `teams`), invokes the one cmdlet, applies an optional code-owned `PostFilter`, returns JSON. **This path now works end to end** (§4.1).
- **DNS path** (`runDnsCheck` :2481): resolves the tenant's mail domain from `tenants.domain`, then TXT lookups — SPF at `<domain>`, DMARC at `_dmarc.<domain>`, DKIM at `selector1`/`selector2._domainkey.<domain>` (default selectors only — a custom-selector tenant reads as not-found, and the field says so honestly). One item per run.
- **SharePoint-admin path** (`runSharePointAdminCheck` :2115): app-only cert auth (`MT_APP_CLIENT_ID` / `MT_APP_CERT_PRIVATE_KEY` / thumbprint) against the tenant's SharePoint admin endpoint; the single check's `sp_operation` = `tenant-sharing-capability`. **Now returns `ok`** — the corrupted local cert PEM was fixed (#1786).
- **License gates**: checks needing AAD P1/P2, Defender for Office 365, or Purview probe the tenant's SKUs first and return status **`license_gap`** with a precise reason (observed literals in §7.2) — honest and renderable; `license_gap` never makes a run `partial_failure`.
- **Service gates (`service_not_configured`, #1847)**: a newer honest state, distinct from `license_gap`. When a whole Microsoft service is absent/unlicensed (observed: Intune on this un-enrolled tenant), the check returns `service_not_configured` with `_serviceName`/`_serviceState`/`_serviceUnavailable`/`_serviceKey`/`_serviceDetectionSignature` (monitor-executor.ts:3494, filtered at :3818) rather than a misleading `ok items=0`.
- **Check statuses** (full declared set, monitor-executor.ts:352): `ok | error | license_gap | partial | consent_revoked | requires_script | service_not_configured | azure_no_rbac | azure_no_subscriptions`. `azure_no_rbac` / `azure_no_subscriptions` are Azure-ARM-executor states (scaffolding — no `arm` executor row is active yet; see §12). Observed distribution in the canonical run `82015d75`: **115 ok · 23 license_gap · 11 service_not_configured · 2 partial · 0 error**.

**What actually triggers real runs** (all callers of `executeMonitoringPackage` :3671, verified by grep + live trigger ids):
1. **Assessment/diagnostics scan** — `diagnostics-runner.ts` (trigger ids `diag-run-<uuid>`). Observed: `assess:copilot-readiness`, `core:premier`.
2. **Recurring monitoring workflow** — `workflow-executor.ts` `execute_pkg` node (trigger ids `wf-run-<n>-node-execute_pkg`). The most recent recurring run (`wf-run-34320`, 2026-08-31) executed a 151-check `core:premier`-equivalent set.
3. **Item-detail collection** — `item-detail-collector.ts` (runs alongside scoring scans; never contributes to scoring).
4. **Simulator Studio single-check run** — `admin-monitor-check-runs.ts`. A check runnable only here is PARTIAL by definition (#1386) — an operator tool, not a scan.

**Monitoring packages** (`monitoring_packages` + `monitoring_package_checks`, live counts): `core:premier` (151), `core:growth` (146), `detail:full-item-collection` (145, collection-mode), `core:enhanced-monitoring` (124), `assess:copilot-readiness` (101), `core:foundation` (32), `core:security-baseline` (24), `assess:adoption-maturity` (5), `assess:license-cost-optimization` (3), `assess:teams-governance` (3), plus **10 legacy `cat-*` packages with 0 member checks** (structurally cannot contribute). Packages with a real testbed run this cycle: `core:premier` and `assess:copilot-readiness`.

**Graph permission scopes — the current picture, three distinct numbers.**
- **The code declares 35** in `REQUIRED_MT_SCOPES` (graph.ts:66-119): `Directory.Read.All, SecurityEvents.Read.All, Exchange.ManageAsApp, Sites.Read.All, Reports.Read.All, Policy.Read.All, DeviceManagementConfiguration.Read.All, DeviceManagementManagedDevices.Read.All, BitLockerKey.Read.All, AuditLog.Read.All, ActivityFeed.Read, IdentityRiskyUser.Read.All, IdentityRiskEvent.Read.All, RoleEligibilitySchedule.Read.Directory, AccessReview.Read.All, TeamSettings.Read.All, ServiceMessage.Read.All, ServiceHealth.Read.All, Agreement.Read.All, Application.Read.All, Community.Read.All, DelegatedPermissionGrant.Read.All, IdentityRiskyServicePrincipal.Read.All, InformationProtectionPolicy.Read.All, SensitivityLabels.Read.All, RealTimeActivityFeed.Read.All, RecordsManagement.Read.All, SharePointTenantSettings.Read.All, Team.ReadBasic.All, Organization.Read.All, Domain.Read.All, Tasks.Read.All, DeviceManagementApps.Read.All, TeamworkDevice.Read.All, Exchange.ManageAsAppV2`. Of these, 32 are Graph-resource scopes; `Exchange.ManageAsApp`/`Exchange.ManageAsAppV2` are on the Exchange Online resource and `ActivityFeed.Read` on the O365 Management API. Plus SharePoint `Sites.FullControl.All` in the separate `REQUIRED_SHAREPOINT_APP_PERMISSIONS`.
- **The testbed's persisted grant snapshot holds 29** (`tenants.consent.graph.grants`, consented 2026-08-17, before #1811) — it lacks the six scopes added since (`Organization.Read.All`, `Domain.Read.All`, `Tasks.Read.All`, `DeviceManagementApps.Read.All`, `TeamworkDevice.Read.All`, `Exchange.ManageAsAppV2`). #1811 confirmed both testbed and the second tenant predate the grant; whether to force re-consent for `adoption:planner-usage` on already-consented tenants is a product decision left to Shane.
- **The live Entra registration actually grants ≥35** — #1811's two-way audit (`az ad app permission list`) verified `Tasks.Read.All` granted 2026-08-30 and the other three present, with zero code-array entries lacking a live counterpart (other than the `BitLockerKey`/`BitlockerKey` casing, #1830 — same GUID).
- The catalog does **not** store a per-check required-scope column; per-endpoint scope attribution beyond the granted set would be inference and is deliberately not tabulated (see §11).

## 4. Master check inventory — all 157, classified

Columns: check key · executor · Graph endpoint (or cmdlet / operation) · engine tags · packages · classification · evidence note. Every row's classification derives from live observation data for the testbed (`tenants.id = 1`) plus package-run reality; the generating query is in §10. `freq` is `daily` for every check except `m365:service-health` (`hourly`).

**Package legend:** SB=core:security-baseline · F=core:foundation · G=core:growth · P=core:premier · EM=core:enhanced-monitoring · CR=assess:copilot-readiness · LCO/TG/AM=the three small assess scans · DC=detail:full-item-collection (collection mode). P and CR have real testbed runs this cycle; the recurring workflow executes a P-equivalent set.

| Check | Exec | Endpoint / cmdlet | Engine tags | Pkgs | Class | Evidence note |
|---|---|---|---|---|---|---|
| `adoption:email-activity-trend` | graph | /reports/getEmailActivityUserDetail(period='D7') | ["adoption"] | CR EM G P DC | **REAL** | observed ok items=1 |
| `adoption:m365-mobile-app-usage` | graph | /reports/getM365AppUserDetail(period='D7') | ["adoption"] | EM G P DC | **REAL** | observed ok items=1 |
| `adoption:overall-active-rate` | graph | /reports/getOffice365ActiveUserDetail(period='D7') | ["adoption"] | CR EM F G P DC | **REAL** | observed ok items=7 |
| `adoption:planner-usage` | graph | /groups/{itemId}/planner/plans | ["adoption"] | EM G P DC | **REAL** | observed ok items=0 |
| `adoption:sharepoint-onedrive-trend` | graph | /reports/getSharePointSiteUsageDetail(period='D7') | ["adoption"] | CR EM G P DC | **REAL** | observed error items=0 |
| `adoption:sharepoint-user-activity` | graph | /reports/getSharePointActivityUserDetail(period='D7') | ["adoption"] | EM G P DC | **REAL** | observed ok items=1 |
| `adoption:teams-activity-trend` | graph | /reports/getTeamsUserActivityUserDetail(period='D7') | ["adoption"] | CR EM G P DC | **REAL** | observed ok items=1 |
| `adoption:teams-phone-provisioning` | powershell | cmdlet get-cs-online-user | ["adoption"] | EM G P DC | **REAL** | observed ok items=0 |
| `adoption:viva-engage-health` | graph | /employeeExperience/communities | ["adoption"] | EM G P DC | **REAL** | observed ok items=1 |
| `adoption:viva-engage-user-activity` | graph | /reports/getYammerActivityUserDetail(period='D7') | ["adoption"] | EM G P DC | **REAL** | observed ok items=8 |
| `appgov:cert-secret-expiration` | graph | /applications | ["health"] | CR EM G P DC | **REAL** | observed ok items=14 |
| `appgov:consent-policy-status` | graph | /policies/authorizationPolicy | ["security", "governance"] | CR EM G P DC | **REAL** | observed ok items=1 |
| `appgov:dormant-service-principals` | graph | /servicePrincipals?$expand=appRoleAssignedTo($select=id)&$... | ["governance"] | EM G P DC | **REAL** | observed ok items=504 |
| `appgov:enterprise-app-count` | graph | /servicePrincipals | ["security"] | EM G P DC | **REAL** | observed ok items=504 |
| `appgov:enterprise-app-registration-list` | graph | servicePrincipals | ["monitoring"] | CR DC | **REAL** | observed ok items=1 |
| `appgov:risky-permission-grants` | graph | /oauth2PermissionGrants | ["security", "priority"] | CR EM F G P SB DC | **REAL** | observed ok items=39 |
| `appgov:stale-app-registrations` | graph | /applications | ["governance"] | CR EM G P DC | **REAL** | observed ok items=14 |
| `appgov:unreviewed-consents` | graph | /oauth2PermissionGrants | ["security"] | CR EM G P DC | **REAL** | observed ok items=39 |
| `appgov:workload-identity-risk` | graph | /identityProtection/riskyServicePrincipals | ["security"] | CR EM G P DC | **REAL** | observed license_gap items=0 |
| `compliance:audit-log-retention` | powershell | cmdlet get-audit-retention-policy | ["compliance"] | P | **REAL** | observed license_gap items=0 |
| `compliance:dlp-incidents` | powershell | cmdlet get-dlp-incidents | ["compliance"] | CR P DC | **REAL** | observed ok items=0 |
| `compliance:eeeu-site-sharing` | graph | /sites/{itemId}/drive/root/permissions | ["compliance"] | CR F G P DC | **REAL** | observed partial items=93 |
| `compliance:label-errors` | powershell | cmdlet get-label-policies | ["compliance"] | CR P | **REAL** | observed ok items=0 |
| `compliance:missing-labels` | powershell | cmdlet get-labels | ["compliance"] | CR F G P DC | **REAL** | observed ok items=0 |
| `compliance:weak-dlp-policies` | powershell | cmdlet get-dlp-policies | ["compliance"] | CR G P DC | **REAL** | observed ok items=0 |
| `compliance:zero-dlp-policies` | powershell | cmdlet get-all-dlp-policies | ["compliance"] | CR G P DC | **REAL** | observed ok items=0 |
| `copilot:active-usage-rate` | graph | /copilot/reports/getMicrosoft365CopilotUsageUserDetail(per... | ["copilot", "adoption"] | CR EM G P DC | **REAL** | observed ok items=0 |
| `copilot:data-exposure-risk` | graph | /sites/{itemId}/drive/root/permissions | ["copilot", "security"] | CR EM F G P DC | **REAL** | observed partial items=93 |
| `copilot:license-vs-total-users` | graph | /subscribedSkus | ["copilot", "cost"] | CR EM G P DC | **REAL** | observed ok items=4 |
| `copilot:licensed-but-inactive` | graph | /copilot/reports/getMicrosoft365CopilotUsageUserDetail(per... | ["copilot"] | AM CR G P DC | **REAL** | observed ok items=0 |
| `copilot:readiness-prerequisite` | graph | /subscribedSkus | ["copilot"] | CR EM F G P DC | **REAL** | observed ok items=4 |
| `copilot:sensitivity-labels-exist` | graph | /security/dataSecurityAndGovernance/sensitivityLabels | ["copilot", "governance"] | CR G P DC | **REAL** | observed ok items=0 |
| `copilot:usage-activity` | graph | /copilot/reports/getMicrosoft365CopilotUsageUserDetail(per... | ["copilot", "priority"] | AM CR G P DC | **REAL** | observed ok items=0 |
| `copilot:usage-by-app` | graph | /copilot/reports/getMicrosoft365CopilotUserCountTrend(peri... | ["copilot", "adoption"] | CR EM G P DC | **REAL** | observed ok items=0 |
| `cost:duplicate-assignments` | graph | /users | ["cost"] | CR EM G P DC | **REAL** | observed ok items=24 |
| `cost:entra-license-tier-distribution` | graph | /subscribedSkus | ["cost", "security"] | CR EM G P DC | **REAL** | observed ok items=4 |
| `cost:group-based-licensing-adoption` | graph | /groups | ["cost", "governance"] | CR EM G P DC | **REAL** | observed ok items=104 |
| `cost:license-count-by-sku` | graph | /subscribedSkus | ["cost"] | G P | **REAL** | observed ok items=4 |
| `cost:underutilized-premium` | graph | /users | ["cost"] | CR EM G P DC | **REAL** | observed ok items=24 |
| `cost:unused-unassigned-licenses` | graph | /subscribedSkus | ["cost", "priority"] | F G P | **REAL** | observed ok items=4 |
| `cost:utilization-by-sku` | graph | /subscribedSkus | ["cost"] | G P | **REAL** | observed ok items=4 |
| `devices:app-protection-coverage` | graph | /deviceAppManagement/managedAppPolicies | ["security"] | EM G P DC | **REAL** | observed service_not_configured items=0 |
| `devices:autopilot-coverage` | graph | /deviceManagement/windowsAutopilotDeploymentProfiles | ["health"] | EM G P DC | **REAL** | observed service_not_configured items=0 |
| `devices:bitlocker-key-escrow` | graph | /informationProtection/bitlocker/recoveryKeys | ["security"] | EM F G P SB DC | **REAL** | observed ok items=0 |
| `devices:compliance-policy-coverage` | graph | /deviceManagement/deviceCompliancePolicies | ["security", "health"] | EM F G P DC | **REAL** | observed service_not_configured items=0 |
| `devices:compliant-vs-noncompliant` | graph | /deviceManagement/managedDevices | ["security", "priority"] | EM G P DC | **REAL** | observed service_not_configured items=0 |
| `devices:encryption-status` | graph | /deviceManagement/managedDevices | ["security"] | EM G P DC | **REAL** | observed service_not_configured items=0 |
| `devices:enrollment-status` | graph | /deviceManagement/managedDevices | ["health"] | EM G P DC | **REAL** | observed service_not_configured items=0 |
| `devices:kfm-configuration` | graph | /deviceManagement/deviceConfigurations | ["health", "adoption"] | EM G P DC | **REAL** | observed service_not_configured items=0 |
| `devices:os-patch-compliance` | graph | /deviceManagement/managedDevices | ["security", "health"] | EM G P DC | **REAL** | observed service_not_configured items=0 |
| `devices:stale-duplicate-records` | graph | /devices?$select=id,displayName,deviceId,approximateLastSi... | ["health"] | EM G P DC | **REAL** | observed ok items=8 |
| `devices:unassigned-intune-profiles` | graph | /deviceManagement/deviceConfigurations?$expand=assignments... | ["health"] | EM G P DC | **REAL** | observed service_not_configured items=0 |
| `devices:update-rings-config` | graph | /deviceManagement/deviceConfigurations | ["health"] | EM G P DC | **REAL** | observed service_not_configured items=0 |
| `diagnostics:ps-execution-test` | powershell | cmdlet get-connection-info | [] | DC | **PARTIAL** | collection-mode package only (DC) - never invoked by a scoring run |
| `exchange:antispam-policy-coverage` | powershell | cmdlet get-antispam-policies | ["security"] | EM G P DC | **REAL** | observed ok items=2 |
| `exchange:archive-mailbox-rate` | powershell | cmdlet get-archive-mailbox-gap | ["cost", "health"] | EM G P DC | **REAL** | observed ok items=8 |
| `exchange:auto-forwarding-rules` | powershell | cmdlet get-auto-forward-risk-policies | ["security", "priority"] | (none) | **PARTIAL** | in no package - never invoked by a real run |
| `exchange:connector-health` | powershell | cmdlet get-inbound-connector-tls-gap | ["security"] | EM G P DC | **REAL** | observed ok items=1 |
| `exchange:distribution-list-count` | graph | /groups?$filter=mailEnabled eq true and securityEnabled eq... | ["governance"] | EM G P DC | **REAL** | observed ok items=17 |
| `exchange:dkim-spf-dmarc-status` | dns | TXT: SPF/_dmarc/DKIM | ["security"] | CR F G P | **REAL** | observed ok items=1 |
| `exchange:litigation-hold-coverage` | powershell | cmdlet get-litigation-hold-gap | ["compliance"] | EM P DC | **REAL** | observed ok items=8 |
| `exchange:mail-flow-rule-review` | powershell | cmdlet get-transport-rules | ["security", "governance"] | EM G P DC | **REAL** | observed ok items=7 |
| `exchange:mailbox-quota-utilization` | powershell | cmdlet get-mailbox-quota-utilization | ["cost", "health"] | EM G P DC | **REAL** | observed ok items=0 |
| `exchange:shared-mailbox-licensing` | powershell | cmdlet get-shared-mailboxes | ["cost"] | EM G P DC | **REAL** | observed ok items=2 |
| `exchange:transport-rule-count` | powershell | cmdlet get-transport-rules | ["security"] | EM G P DC | **REAL** | observed ok items=7 |
| `governance:access-review-completion` | graph | /identityGovernance/accessReviews/definitions | ["governance", "compliance"] | CR EM G P DC | **REAL** | observed ok items=0 |
| `governance:auto-labeling-coverage` | graph | /security/dataSecurityAndGovernance/sensitivityLabels | ["governance"] | CR EM G P DC | **REAL** | observed ok items=0 |
| `governance:dynamic-group-usage` | graph | /groups | ["governance"] | CR EM G P DC | **REAL** | observed ok items=104 |
| `governance:empty-security-groups` | graph | /groups?$filter=securityEnabled eq true and mailEnabled eq... | ["governance"] | EM G P DC | **REAL** | observed ok items=9 |
| `governance:group-expiration-policy` | graph | /groupSettings | ["governance"] | CR EM G P DC | **REAL** | observed ok items=0 |
| `governance:guest-access-reviews` | graph | /identityGovernance/accessReviews/definitions | ["governance", "compliance"] | CR EM G P DC | **REAL** | observed ok items=0 |
| `governance:guest-count` | graph | /users | ["governance"] | CR EM F G P DC | **REAL** | observed ok items=24 |
| `governance:guest-staleness` | graph | /users | ["governance", "security"] | CR EM G P DC | **REAL** | observed ok items=24 |
| `governance:overdue-access-reviews` | graph | /identityGovernance/accessReviews/definitions | ["governance"] | CR EM G P DC | **REAL** | observed ok items=0 |
| `governance:ownerless-groups` | graph | /groups?$expand=owners($select=id) | ["governance"] | CR EM F G P DC | **REAL** | observed ok items=104 |
| `governance:public-groups-discoverable` | graph | /groups?$filter=groupTypes/any(c:c eq 'Unified')&$select=i... | ["governance"] | G P DC | **REAL** | observed ok items=78 |
| `governance:public-teams-discoverable` | graph | /groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Te... | ["governance"] | G P DC | **REAL** | observed ok items=18 |
| `governance:retention-label-adoption` | graph | /security/labels/retentionLabels | ["compliance"] | CR EM G P DC | **REAL** | observed license_gap items=0 |
| `governance:retention-policy-coverage` | graph | /security/labels/retentionLabels | ["compliance", "governance"] | CR F G P | **REAL** | observed license_gap items=0 |
| `governance:sensitivity-label-adoption` | graph | /security/dataSecurityAndGovernance/sensitivityLabels | ["governance", "compliance"] | CR EM G P DC | **REAL** | observed ok items=0 |
| `identity:b2b-collaboration-settings` | graph | /policies/authorizationPolicy | ["governance"] | CR EM G P DC | **REAL** | observed ok items=1 |
| `identity:break-glass-health` | graph | /users | ["security"] | CR EM F G P SB DC | **REAL** | observed ok items=24 |
| `identity:ca-device-compliance` | graph | /identity/conditionalAccess/policies | ["security"] | CR EM G P DC | **REAL** | observed ok items=0 |
| `identity:ca-legacy-auth-block` | graph | /identity/conditionalAccess/policies | ["security"] | CR EM F G P SB DC | **REAL** | observed ok items=0 |
| `identity:ca-mfa-coverage` | graph | /identity/conditionalAccess/policies | ["security"] | CR EM F G P SB DC | **REAL** | observed ok items=0 |
| `identity:ca-policy-count` | graph | /identity/conditionalAccess/policies | ["security", "health"] | CR EM F G P SB DC | **REAL** | observed ok items=0 |
| `identity:ca-report-only` | graph | /identity/conditionalAccess/policies | ["security"] | CR EM G P DC | **REAL** | observed ok items=0 |
| `identity:continuous-access-evaluation` | graph | /identity/conditionalAccess/policies?$select=id,displayNam... | ["security"] | CR EM G P SB DC | **REAL** | observed ok items=0 |
| `identity:cross-tenant-access` | graph | /policies/crossTenantAccessPolicy | ["governance", "security"] | CR EM G P DC | **REAL** | observed ok items=1 |
| `identity:department-directory` | graph | /users?$select=id,userPrincipalName,department,accountEnab... | ["adoption"] | EM G P DC | **REAL** | observed ok items=24 |
| `identity:global-admin-count` | graph | /directoryRoles(roleTemplateId='62e90394-69f5-4237-9190-01... | ["security", "priority"] | CR EM F G P SB DC | **REAL** | observed ok items=6 |
| `identity:guest-mfa-enforcement` | graph | /identity/conditionalAccess/policies | ["security", "governance"] | CR EM G P DC | **REAL** | observed ok items=0 |
| `identity:hybrid-sync-health` | graph | /organization | ["architecture", "health"] | EM G P DC | **REAL** | observed ok items=1 |
| `identity:legacy-auth-usage` | graph | /auditLogs/signIns | ["security", "priority"] | CR EM F G P SB DC | **REAL** | observed license_gap items=0 |
| `identity:mfa-method-breakdown` | graph | /reports/authenticationMethods/userRegistrationDetails | ["security"] | CR EM G P DC | **REAL** | observed license_gap items=0 |
| `identity:mfa-registration` | graph | /reports/authenticationMethods/userRegistrationDetails | ["priority", "security"] | AM CR EM F G P SB DC | **REAL** | observed license_gap items=0 |
| `identity:named-locations` | graph | /identity/conditionalAccess/namedLocations | ["security"] | CR EM G P DC | **REAL** | observed ok items=0 |
| `identity:password-expiration-policy` | graph | /domains | ["security"] | EM G P DC | **REAL** | observed ok items=9 |
| `identity:pim-eligible-roles` | graph | /roleManagement/directory/roleEligibilitySchedules?$expand... | ["security", "health"] | CR EM G P DC | **REAL** | observed license_gap items=0 |
| `identity:pim-groups` | graph | /identityGovernance/privilegedAccess/group/eligibilitySche... | ["security"] | CR EM G P DC | **REAL** | observed license_gap items=0 |
| `identity:pim-permanent-roles` | graph | /roleManagement/directory/roleAssignments | ["security", "priority"] | CR EM F G P SB DC | **REAL** | observed ok items=19 |
| `identity:privileged-mfa-gap` | graph | /reports/authenticationMethods/userRegistrationDetails | ["priority", "security"] | CR EM F G P SB DC | **REAL** | observed license_gap items=0 |
| `identity:risky-signins` | graph | /identityProtection/riskDetections?$filter=activity eq 'si... | ["security"] | CR EM G P SB DC | **REAL** | observed license_gap items=0 |
| `identity:risky-users` | graph | /identityProtection/riskyUsers | ["security", "priority"] | CR EM F G P SB DC | **REAL** | observed license_gap items=0 |
| `identity:signin-risk-policy` | graph | /identity/conditionalAccess/policies | ["security"] | CR EM G P DC | **REAL** | observed ok items=0 |
| `identity:sspr-config` | graph | /policies/authorizationPolicy | ["security"] | CR EM F G P SB DC | **REAL** | observed ok items=1 |
| `identity:stale-accounts` | graph | /users | ["governance", "security"] | AM CR EM G P SB DC | **REAL** | observed ok items=24 |
| `identity:terms-of-use` | graph | /identityGovernance/termsOfUse/agreements | ["compliance"] | CR EM G P DC | **REAL** | observed ok items=0 |
| `identity:user-risk-policy` | graph | /identity/conditionalAccess/policies | ["security"] | CR EM G P DC | **REAL** | observed ok items=0 |
| `license:copilot-assignment` | graph | /subscribedSkus | ["copilot"] | CR LCO G P DC | **REAL** | observed ok items=4 |
| `license:sku-utilization` | graph | /subscribedSkus | ["priority", "governance"] | CR LCO G P DC | **REAL** | observed ok items=4 |
| `license:unused-assigned` | graph | /users?$select=id,accountEnabled,assignedLicenses,signInAc... | ["priority", "governance"] | CR LCO F G P DC | **REAL** | observed license_gap items=0 |
| `licensing:project-online-detection` | graph | /subscribedSkus | ["licensing"] | EM G P DC | **REAL** | observed ok items=4 |
| `m365:message-center` | graph | /admin/serviceAnnouncement/messages?$orderby=lastModifiedD... | [] | CR EM G P DC | **REAL** | observed ok items=419 |
| `m365:service-health` | graph | /admin/serviceAnnouncement/healthOverviews | [] | CR EM F G P DC | **REAL** | observed ok items=25 |
| `onedrive:active-users` | graph | /reports/getOneDriveUsageAccountDetail(period='D7') | ["adoption"] | EM G P DC | **REAL** | observed ok items=1 |
| `onedrive:departed-user-access` | graph | /users?$expand=manager($select=id)&$select=id,accountEnabl... | ["governance"] | CR EM G P DC | **REAL** | observed license_gap items=0 |
| `onedrive:external-sharing-settings` | graph | /sites | ["governance"] | G P | **REAL** | observed ok items=99 |
| `onedrive:overshared-files` | graph | /sites/{itemId}/drive/root/permissions | ["compliance"] | DC | **PARTIAL** | collection-mode package only (DC) - never invoked by a scoring run |
| `onedrive:storage-utilization` | graph | /reports/getOneDriveUsageAccountDetail(period='D7') | ["cost", "health"] | EM G P DC | **REAL** | observed ok items=1 |
| `onedrive:sync-errors` | graph | /reports/getOneDriveUsageAccountDetail(period='D30') | ["health"] | G P DC | **REAL** | observed ok items=1 |
| `platform:branding-config` | graph | /organization/{id}/branding | ["governance"] | EM G P DC | **REAL** | observed ok items=0 |
| `platform:multi-geo-status` | graph | /admin/sharepoint/settings | ["architecture"] | EM G P DC | **REAL** | observed ok items=1 |
| `platform:tenant-password-expiration` | graph | /domains | ["security"] | G P | **REAL** | observed ok items=9 |
| `security:alert-count-by-severity` | graph | /security/alerts_v2 | ["security", "priority"] | CR EM G P SB DC | **REAL** | observed license_gap items=0 |
| `security:antiphishing-coverage` | graph | /security/alerts_v2 | ["security"] | CR EM F G P SB DC | **REAL** | observed license_gap items=0 |
| `security:automated-investigation` | graph | /security/incidents | ["security"] | CR EM G P DC | **REAL** | observed license_gap items=0 |
| `security:azure-roleDefinitions-compliance` | graph | /roleManagement/directory/roleDefinitions | ["security"] | CR G P DC | **REAL** | observed ok items=145 |
| `security:dlp-true-positive-rate` | graph | /security/alerts_v2 | ["security"] | EM G P DC | **REAL** | observed license_gap items=0 |
| `security:dlp-violations` | graph | /security/alerts_v2 | ["security", "priority"] | CR EM G P SB DC | **REAL** | observed license_gap items=0 |
| `security:insider-risk-alerts` | graph | /security/alerts_v2?$filter=detectionSource eq 'microsoftI... | ["security"] | CR EM P DC | **REAL** | observed license_gap items=0 |
| `security:open-incidents` | graph | /security/incidents | ["security", "priority"] | CR EM F G P SB DC | **REAL** | observed license_gap items=0 |
| `security:password-protection-policy` | graph | /domains | ["security"] | CR EM G P DC | **REAL** | observed ok items=9 |
| `security:safe-attachments-coverage` | graph | /security/alerts_v2 | ["security"] | CR EM F G P SB DC | **REAL** | observed license_gap items=0 |
| `security:safe-links-coverage` | graph | /security/alerts_v2 | ["security"] | CR EM F G P SB DC | **REAL** | observed license_gap items=0 |
| `security:secure-score` | graph | /security/secureScores | ["health", "priority"] | CR EM F G P SB DC | **REAL** | observed ok items=90 |
| `security:secure-score-by-category` | graph | /security/secureScores | ["health"] | CR EM G P DC | **REAL** | observed ok items=90 |
| `sharepoint:anonymous-links (INACTIVE)` | graph | /sites | ["security", "governance"] | (none) | **PARTIAL** | inactive - structurally cannot run |
| `sharepoint:inactive-sites` | graph | /sites | ["governance"] | CR EM G P DC | **REAL** | observed ok items=99 |
| `sharepoint:orgwide-links (INACTIVE)` | graph | /sites | ["governance"] | (none) | **PARTIAL** | inactive - structurally cannot run |
| `sharepoint:site-count` | graph | /sites | ["health"] | CR EM G P DC | **REAL** | observed ok items=99 |
| `sharepoint:site-label-coverage` | graph | /sites | ["governance"] | CR EM G P DC | **REAL** | observed ok items=99 |
| `sharepoint:storage-near-limit` | graph | /sites | ["health"] | EM G P DC | **REAL** | observed ok items=99 |
| `sharepoint:storage-utilization` | graph | /sites | ["health", "cost"] | EM G P DC | **REAL** | observed ok items=99 |
| `sharepoint:tenant-sharing-capability` | sharepoint-admin | SP admin: tenant-sharing-capability | ["governance", "security"] | CR EM F G P SB DC | **REAL** | observed ok items=1 |
| `teams:app-permission-policy` | graph | /teams | ["security"] | CR EM G P DC | **REAL** | observed ok items=18 |
| `teams:channel-sprawl` | graph | /teams/{itemId}/channels | ["governance"] | CR TG G P DC | **REAL** | observed ok items=27 |
| `teams:external-access-settings` | graph | /teams | ["governance", "security"] | CR EM G P DC | **REAL** | observed ok items=18 |
| `teams:guest-membership` | graph | /teams | ["governance"] | CR EM G P DC | **REAL** | observed ok items=18 |
| `teams:guest-settings-governance` | graph | /teams/{itemId} | ["governance", "security"] | CR TG G P DC | **REAL** | observed ok items=18 |
| `teams:inactive-teams` | graph | /teams | ["governance", "adoption"] | CR EM G P DC | **REAL** | observed ok items=18 |
| `teams:inventory-count` | graph | /groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Te... | ["governance", "health"] | AM CR TG G P DC | **REAL** | observed ok items=18 |
| `teams:meeting-policy-coverage` | graph | /teams | ["governance"] | CR EM G P DC | **REAL** | observed ok items=18 |
| `teams:messaging-policy-coverage` | graph | /teams | ["governance"] | CR EM G P DC | **REAL** | observed ok items=18 |
| `teams:ownerless-teams` | graph | /groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Te... | ["governance"] | CR EM G P DC | **REAL** | observed ok items=18 |
| `teams:rooms-device-health` | graph | /deviceManagement/managedDevices | ["health"] | EM G P DC | **REAL** | observed service_not_configured items=0 |
| `teams:team-count` | graph | /teams | ["health"] | CR EM G P DC | **REAL** | observed ok items=18 |

### 4.1 The PowerShell seventeen — now REAL (the prior edition's central error)

Cmdlet resolution is container-side from `services/ps-execution/cmdlet-catalog.ps1`; session type per `child-worker.ps1` (`compliance` = `Connect-IPPSSession`, `exchange` = `Connect-ExchangeOnline`, `teams` = `Connect-MicrosoftTeams`; all app-only certificate auth). **All 15 PowerShell checks that a scoring package runs executed successfully against the testbed** — 14 `ok` with real data, 1 honest `license_gap`. The prior edition's *"The request-handling child process produced malformed output"* is absent from every current observation.

| Check | cmdletKey | Real cmdlet | Session | Latest observed on testbed |
|---|---|---|---|---|
| `adoption:teams-phone-provisioning` | get-cs-online-user | Get-CsOnlineUser | teams | **ok** items=0 (Teams session now establishes) |
| `compliance:audit-log-retention` | get-audit-retention-policy | Get-UnifiedAuditLogRetentionPolicy | compliance | **license_gap** (Purview add-on absent — honest, reached container) |
| `compliance:dlp-incidents` | get-dlp-incidents | Export-ActivityExplorerData | compliance | **ok** items=0 (date-range fix #1786) |
| `compliance:label-errors` | get-label-policies | Get-LabelPolicy | compliance | **ok** items=0 |
| `compliance:missing-labels` | get-labels | Get-Label | compliance | **ok** items=0 |
| `compliance:weak-dlp-policies` | get-dlp-policies | Get-DlpCompliancePolicy (PostFilter) | compliance | **ok** items=0 |
| `compliance:zero-dlp-policies` | get-all-dlp-policies | Get-DlpCompliancePolicy | compliance | **ok** items=0 |
| `diagnostics:ps-execution-test` | get-connection-info | Get-ConnectionInformation | compliance | never run (collection-only package) — **PARTIAL** |
| `exchange:antispam-policy-coverage` | get-antispam-policies | Get-HostedContentFilterPolicy | exchange | **ok** items=2 |
| `exchange:archive-mailbox-rate` | get-archive-mailbox-gap | Get-Mailbox | exchange | **ok** items=8 |
| `exchange:auto-forwarding-rules` | get-auto-forward-risk-policies | Get-HostedOutboundSpamFilterPolicy | exchange | in no package — never run — **PARTIAL** |
| `exchange:connector-health` | get-inbound-connector-tls-gap | Get-InboundConnector | exchange | **ok** items=1 |
| `exchange:litigation-hold-coverage` | get-litigation-hold-gap | Get-Mailbox | exchange | **ok** items=8 |
| `exchange:mail-flow-rule-review` | get-transport-rules | Get-TransportRule | exchange | **ok** items=7 |
| `exchange:mailbox-quota-utilization` | get-mailbox-quota-utilization | Get-Mailbox (+stats) | exchange | **ok** items=0 (null-ref fix #1786) |
| `exchange:shared-mailbox-licensing` | get-shared-mailboxes | Get-Mailbox | exchange | **ok** items=2 |
| `exchange:transport-rule-count` | get-transport-rules | Get-TransportRule | exchange | **ok** items=7 |

The only two PARTIAL PowerShell checks are so classified purely by package membership: `diagnostics:ps-execution-test` sits only in the collection-mode package `detail:full-item-collection`, and `exchange:auto-forwarding-rules` sits in no package. Both would execute if invoked — the pipeline they depend on is proven healthy by the 15 above.

## 5. Findings, items, and the assessment run shape

A real run writes `msp_diagnostic_runs`. Canonical run `82015d75` (`core:premier`): `{status:"partial", run_status:"partial_failure", checks_total:151, checks_ok:115, checks_error:0, checks_license_gap:23}` — the run is `partial_failure` **only** because 2 fan-out checks are `partial`; `license_gap` and `service_not_configured` deliberately never make a run partial, and there are no errors. Per-check findings land in `msp_diagnostic_findings`. Observed finding shape:

```json
{"severity":"warning","checkKey":"governance:ownerless-groups",
 "title":"Groups exist with no owner — nobody is accountable for membership or lifecycle",
 "rankWeight":10,
 "description":"...",
 "recommendation":{"action":"...","category":"governance","priority":2,"signalKey":"governance:ownerless-groups"},
 "evidence":null,"obligation":null,"whyItMatters":null}
```

`evidence`/`obligation`/`whyItMatters` are commonly null — Design must not assume they are populated. Severity literals: `critical | warning | info` (finding side); check-side `severity_matched`: `critical | warning | info | (null)` with long human-readable `severity_label` strings.

Full per-item evidence (every affected object) lives in `tenant_check_item_details` (142 distinct checks for the testbed, `items` jsonb + `items_omitted` flag) and is served to the portal via `GET /api/portal/tenant-check-items`.

## 6. The dashboard registry and the `/api/dashboard/resolve` seam

`lib/dashboard-registry/src/metrics.ts` declares **198 metrics**: 151 `monitor_profile` (a claim that `sourceKey` names a real `monitor_checks` row), 16 `engine_snapshot`, 31 `platform_table`; statuses 168 `available`, 9 `needs_aggregation`, 21 `not_collected` (an explicit honesty sentinel — resolves to `not_available("not_collected")` always). These counts are unchanged from the prior edition.

Resolution outcomes a UI must render (literal, from `dashboard-resolvers.ts`): `ok` · `not_available` with reason ∈ `not_collected | missing_customer_scope | no_tenant_id | license_gap | no_data | unknown_check_key | no_snapshot | no_sku_prices | not_comparable | no_transform | no_source` · `error`.

- **`engine_snapshot` metrics (16)**: read `tenant_engine_snapshots` → currently ALL resolve `no_snapshot` (table empty). `sla.*` compute live instead; `engine.mspIntelligenceScore` is permanently `no_source`.
- **`drift:*` metrics (18)**: routed to the real `drift_events` store — NOT to monitor_checks. Live state: baselines for `ca-policy`, `email-authentication`, `public-teams-discoverable`, `tenant-sharing-capability` (`tracked`); `eeeu-site-sharing` `not_comparable`. **Specs exist for only 5 domains** (`drift-check-specs.ts`): `ca-policy, public-teams-discoverable, eeeu-site-sharing, tenant-sharing-capability, email-authentication`. The other 13 registry drift domains (`directory-settings, license-assignment, mailbox-config, role-assignment, security-defaults, sharepoint-admin, teams-policy, app-config, redirect-uri, secret, certificate, permission, tenant-config`) have **no producer** — they resolve `no_data` until the config-state differ writes one (#1794/#1797). Classification: 4 REAL-with-empty-history, 1 spec'd-but-not-comparable, 13 ABSENT-as-collection.
- **`platform_table` metrics (31)**: resolve from real platform tables (alerts, projects, financial, SLA, AI usage, benchmarks). MSP-side operational data, not tenant scan data.

### The 21 `not_collected` sentinels (honest by design — render as "not collected", never fake)

Unchanged from the prior edition — 21 metrics carry `status: "not_collected"`, a deliberate honesty sentinel: the platform genuinely does not collect these today, and the registry says so rather than pointing at a near-miss check. The full list (registry metric → sentinel sourceKey): `collaboration.activeEmailUserCount` → `not_collected:active-email-users`; `collaboration.activeOneDriveUserCount` → `not_collected:active-onedrive-users`; `collaboration.activeSharePointUserCount` → `not_collected:active-sharepoint-users`; `collaboration.activeTeamsUserCount` → `not_collected:active-teams-users`; `collaboration.fileActivity` → `not_collected:onedrive-file-activity`; `collaboration.meetingsOrganized` → `not_collected:meetings-organized`; `compliance.labelPolicyDriftCount` → `not_collected:label-policy-drift`; `compliance.retentionDriftCount` → `not_collected:retention-drift`; `copilot.usagePerUser` → `not_collected:copilot-usage`; `governance.accessReviewDriftCount` → `not_collected:access-review-drift`; `identity.caFailureCount` → `not_collected:conditional-access-failures`; `identity.failedSigninCount` → `not_collected:failed-signins`; `identity.impossibleTravelCount` → `not_collected:impossible-travel`; `identity.privilegedRoleChangeCount` → `not_collected:privileged-role-changes`; `licensing.costTrend` → `not_collected:license-cost`; `security.lowScoreControlCount` → `not_collected:low-score-controls`; `serviceHealth.uptimeStatus` → `not_collected:service-health-overview`; `usage.exchangeUsageCount` → `not_collected:exchange-adoption-score`; `usage.oneDriveUsageCount` → `not_collected:onedrive-adoption-score`; `usage.sharePointUsageCount` → `not_collected:sharepoint-adoption-score`; `usage.teamsUsageCount` → `not_collected:teams-adoption-score`.

## 7. Data shape appendix — real envelopes, real examples

### 7.1 `tenant_monitor_profiles` row (the per-check observation)

Columns (live schema): `profile_id uuid, tenant_id text (Entra GUID), check_key, check_schema_version int, trigger_id text, idempotency_key, status text, raw_response jsonb, extracted_properties jsonb, severity_matched text, severity_label text, error_message text, item_count int, page_count int, collected_at timestamptz`. One row per check per execution; consumers read latest per check.

### 7.2 The extraction grammar (what `extracted_properties` looks like)

`applyMapping` produces a flat object per check combining:
- `_itemCount` — present on success; the fetched item count.
- Named aggregates per mapping rule — the check's real headline numbers, e.g. `caPolicyCount`, `globalAdminCount`, `secureScoreCurrent`/`secureScoreMax`, `ownerlessGroupCount`, `transportRuleCount`.
- Per-property triplets `<prop>_count`, `<prop>_first`, `<prop>_values` for each captured source property.
- Fan-out extras: `_fanOut: true` + coverage fields (e.g. `sitesScanned`, `oversharedSiteCount`).
- License-gap shape (no items): `{_licenseGap: true, _licenseGapCode, _licenseGapFeature}` (+ capability flags `hasAADP1orP2`, `hasDefender`).
- **Service-not-configured shape (new, #1847):** `{_serviceUnavailable, _serviceKey, _serviceName, _serviceState, _serviceDetectionSignature}` — no `_itemCount`, no item data.
- Error shape: `extracted_properties` **null**, `error_message` set. Observed license_gap reason literals (2026-09-01): *"Requires Microsoft Entra ID Premium (P1/P2)"* · *"Requires Microsoft Entra ID P2 or Microsoft Entra ID Governance"* · *"Requires Microsoft Defender for Office 365"* · *"Requires Microsoft Purview compliance features"* · *"Requires Microsoft Purview retention/eDiscovery capabilities"* · *"Requires a required Microsoft 365 add-on license"*. Observed service_not_configured reason: *"Microsoft Intune is not licensed on this tenant."*

Real example, `exchange:dkim-spf-dmarc-status` on the testbed:

```json
{"_itemCount":1,"domain":"mccawsoft2.onmicrosoft.com",
 "spfRecord":"v=spf1 include:spf.protection.outlook.com -all","spfConfigured":true,
 "dmarcRecord":null,"dmarcConfigured":false,
 "dkimCheckedSelectors":["selector1","selector2"],
 "dkimFoundAtDefaultSelectors":[],"dkimConfiguredAtDefaultSelectors":false}
```

### 7.3 Per-check observed shapes — latest observation per check for the testbed (152 checks)

For every check with any observation on the testbed (`tenants.id = 1`): latest status, item count, and the real `extracted_properties` field names (long lists truncated with `...`; per §7.2 every base property `p` also carries `p_count`/`p_first`/`p_values`). This is observation, not declaration. A check not listed here (the 5 PARTIAL) has never been executed against this tenant.

| Check | Status | Items | Observed extracted_properties fields |
|---|---|---|---|
| `adoption:email-activity-trend` | ok | 1 | _itemCount, emailActiveUserCount, emailLicensedUserCount, lastActivityDate_count, lastActivityDate_first, la... |
| `adoption:m365-mobile-app-usage` | ok | 1 | _itemCount, mobileActiveUserCount, mobileLicensedUserCount |
| `adoption:overall-active-rate` | ok | 7 | _itemCount, hasExchangeLicense_count, hasExchangeLicense_first, hasExchangeLicense_values, overallActiveUser... |
| `adoption:planner-usage` | ok | 0 | _fanOut, _itemCount, id_count, id_first, id_values, plannerPlanCount, title_count, title_first, title_values |
| `adoption:sharepoint-onedrive-trend` | error | 0 | (none) |
| `adoption:sharepoint-user-activity` | ok | 1 | _itemCount, sharepointUserActiveCount, sharepointUsersScannedCount |
| `adoption:teams-activity-trend` | ok | 1 | _itemCount, lastActivityDate_count, lastActivityDate_first, lastActivityDate_values, teamsActiveUserCount, t... |
| `adoption:teams-phone-provisioning` | ok | 0 | _itemCount, teamsPhoneProvisionedUserPrincipalNames |
| `adoption:viva-engage-health` | ok | 1 | _itemCount, displayName_count, displayName_first, displayName_values, id_count, id_first, id_values, vivaEng... |
| `adoption:viva-engage-user-activity` | ok | 8 | _itemCount, vivaEngageUserActiveCount, vivaEngageUsersScannedCount |
| `appgov:cert-secret-expiration` | ok | 14 | _itemCount, expiredKeyCredentialCount, expiredPasswordCredentialCount, id_count, id_first, id_values, keyCre... |
| `appgov:consent-policy-status` | ok | 1 | _itemCount, defaultUserRolePermissions_count, defaultUserRolePermissions_first, defaultUserRolePermissions_v... |
| `appgov:dormant-service-principals` | ok | 504 | _itemCount, accountEnabled_count, accountEnabled_first, accountEnabled_values, displayName_count, displayNam... |
| `appgov:enterprise-app-count` | ok | 504 | _itemCount, displayName_count, displayName_first, displayName_values, enterpriseAppCount, id_count, id_first... |
| `appgov:enterprise-app-registration-list` | ok | 1 | _itemCount, appId_count, appId_first, appId_values, displayName_count, displayName_first, displayName_values... |
| `appgov:risky-permission-grants` | ok | 39 | _itemCount, id_count, id_first, id_values, riskyPermissionGrantCount, scope_count, scope_first, scope_values... |
| `appgov:stale-app-registrations` | ok | 14 | _itemCount, appId_count, appId_first, appId_values, appRegistrationsOver180dCount, appRegistrationsOver365dC... |
| `appgov:unreviewed-consents` | ok | 39 | _itemCount, consentType_count, consentType_first, consentType_values, id_count, id_first, id_values, totalCo... |
| `appgov:workload-identity-risk` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature |
| `compliance:audit-log-retention` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature |
| `compliance:dlp-incidents` | ok | 0 | _itemCount, dlpIncidentActivityTypes, dlpIncidentPolicyNames |
| `compliance:eeeu-site-sharing` | partial | 93 | _fanOut, _itemCount, anonymousLinkSiteCount, eeeuSiteCount, everyoneSiteCount, organizationLinkSiteCount, ov... |
| `compliance:label-errors` | ok | 0 | _itemCount, labelErrorPolicyNames |
| `compliance:missing-labels` | ok | 0 | _itemCount, disabledLabelNames |
| `compliance:weak-dlp-policies` | ok | 0 | _itemCount, weakPolicyModes, weakPolicyNames |
| `compliance:zero-dlp-policies` | ok | 0 | _itemCount, dlpPoliciesCount |
| `copilot:active-usage-rate` | ok | 0 | _itemCount, copilotActiveUserCount, lastActivityDate_count, lastActivityDate_first, lastActivityDate_values,... |
| `copilot:data-exposure-risk` | partial | 93 | _fanOut, _itemCount, copilotAnonymousLinkSiteCount, copilotEeeuSiteCount, copilotEveryoneSiteCount, copilotE... |
| `copilot:license-vs-total-users` | ok | 4 | _itemCount, consumedUnits_count, consumedUnits_first, consumedUnits_values, copilotLicenseCount, skuPartNumb... |
| `copilot:licensed-but-inactive` | ok | 0 | _itemCount, lastActivityDate_count, lastActivityDate_first, lastActivityDate_values, neverActiveCount, userP... |
| `copilot:readiness-prerequisite` | ok | 4 | _itemCount, copilotSkuCount, skuPartNumber_count, skuPartNumber_first, skuPartNumber_values |
| `copilot:sensitivity-labels-exist` | ok | 0 | _itemCount, id_count, id_first, id_values, isActive_count, isActive_first, isActive_values, labelCount, name... |
| `copilot:usage-activity` | ok | 0 | _itemCount, copilotChatLastActivityDate_count, copilotChatLastActivityDate_first, copilotChatLastActivityDat... |
| `copilot:usage-by-app` | ok | 0 | _itemCount, appActivity_count, appActivity_first, appActivity_values, copilotUsageByApp, userPrincipalName_c... |
| `cost:duplicate-assignments` | ok | 24 | _itemCount, assignedLicenses_count, assignedLicenses_first, assignedLicenses_values, duplicateLicenseAssignm... |
| `cost:entra-license-tier-distribution` | ok | 4 | _itemCount, licenseInventory, skuPartNumber_count, skuPartNumber_first, skuPartNumber_values |
| `cost:group-based-licensing-adoption` | ok | 104 | _itemCount, assignedLicenses_count, assignedLicenses_first, assignedLicenses_values, groupBasedLicensingGrou... |
| `cost:license-count-by-sku` | ok | 4 | _itemCount, consumedUnits_count, consumedUnits_first, consumedUnits_values, licenseSkuCount, prepaidUnits_co... |
| `cost:underutilized-premium` | ok | 24 | _itemCount, assignedLicenses_count, assignedLicenses_first, assignedLicenses_values, id_count, id_first, id_... |
| `cost:unused-unassigned-licenses` | ok | 4 | _itemCount, consumedUnits_count, consumedUnits_first, consumedUnits_values, prepaidUnits_count, prepaidUnits... |
| `cost:utilization-by-sku` | ok | 4 | _itemCount, licenseUtilizationBySku, skuPartNumber_count, skuPartNumber_first, skuPartNumber_values |
| `devices:app-protection-coverage` | service_not_configured | 0 | _serviceDetectionSignature, _serviceKey, _serviceName, _serviceState, _serviceUnavailable |
| `devices:autopilot-coverage` | service_not_configured | 0 | _serviceDetectionSignature, _serviceKey, _serviceName, _serviceState, _serviceUnavailable |
| `devices:bitlocker-key-escrow` | ok | 0 | _itemCount, bitlockerKeysEscrowedCount, deviceId_count, deviceId_first, deviceId_values, id_count, id_first,... |
| `devices:compliance-policy-coverage` | service_not_configured | 0 | _serviceDetectionSignature, _serviceKey, _serviceName, _serviceState, _serviceUnavailable |
| `devices:compliant-vs-noncompliant` | service_not_configured | 0 | _serviceDetectionSignature, _serviceKey, _serviceName, _serviceState, _serviceUnavailable |
| `devices:encryption-status` | service_not_configured | 0 | _serviceDetectionSignature, _serviceKey, _serviceName, _serviceState, _serviceUnavailable |
| `devices:enrollment-status` | service_not_configured | 0 | _serviceDetectionSignature, _serviceKey, _serviceName, _serviceState, _serviceUnavailable |
| `devices:kfm-configuration` | service_not_configured | 0 | _serviceDetectionSignature, _serviceKey, _serviceName, _serviceState, _serviceUnavailable |
| `devices:os-patch-compliance` | service_not_configured | 0 | _serviceDetectionSignature, _serviceKey, _serviceName, _serviceState, _serviceUnavailable |
| `devices:stale-duplicate-records` | ok | 8 | _itemCount, approximateLastSignInDateTime_count, approximateLastSignInDateTime_first, approximateLastSignInD... |
| `devices:unassigned-intune-profiles` | service_not_configured | 0 | _serviceDetectionSignature, _serviceKey, _serviceName, _serviceState, _serviceUnavailable |
| `devices:update-rings-config` | service_not_configured | 0 | _serviceDetectionSignature, _serviceKey, _serviceName, _serviceState, _serviceUnavailable |
| `exchange:antispam-policy-coverage` | ok | 2 | _itemCount, antiSpamPolicyCount, Name_count, Name_first, Name_values |
| `exchange:archive-mailbox-rate` | ok | 8 | _itemCount, archiveMailboxEnabledCount, ArchiveStatus_count, ArchiveStatus_first, ArchiveStatus_values, Iden... |
| `exchange:connector-health` | ok | 1 | _itemCount, connectorMisconfigurationCount, Enabled_count, Enabled_first, Enabled_values, Identity_count, Id... |
| `exchange:distribution-list-count` | ok | 17 | _itemCount, distributionListCount, Name_count, Name_first, Name_values |
| `exchange:dkim-spf-dmarc-status` | ok | 1 | _itemCount, dkimCheckedSelectors, dkimConfiguredAtDefaultSelectors, dkimFoundAtDefaultSelectors, dmarcConfig... |
| `exchange:litigation-hold-coverage` | ok | 8 | _itemCount, Identity_count, Identity_first, Identity_values, LitigationHoldEnabled_count, LitigationHoldEnab... |
| `exchange:mail-flow-rule-review` | ok | 7 | _itemCount, mailFlowRulesForReviewCount, Name_count, Name_first, Name_values, Priority_count, Priority_first... |
| `exchange:mailbox-quota-utilization` | ok | 0 | _itemCount, DisplayName_count, DisplayName_first, DisplayName_values, mailboxesNearQuotaCount, TotalItemSize... |
| `exchange:shared-mailbox-licensing` | ok | 2 | _itemCount, Identity_count, Identity_first, Identity_values, RecipientTypeDetails_count, RecipientTypeDetail... |
| `exchange:transport-rule-count` | ok | 7 | _itemCount, Name_count, Name_first, Name_values, State_count, State_first, State_values, transportRuleCount |
| `governance:access-review-completion` | ok | 0 | _itemCount, accessReviewCompletedCount, id_count, id_first, id_values, status_count, status_first, status_va... |
| `governance:auto-labeling-coverage` | ok | 0 | _itemCount, autoLabelingPolicyExists, id_count, id_first, id_values |
| `governance:dynamic-group-usage` | ok | 104 | _itemCount, dynamicGroupCount, groupTypes_count, groupTypes_first, groupTypes_values, id_count, id_first, id... |
| `governance:empty-security-groups` | ok | 9 | _itemCount, createdDateTime_count, createdDateTime_first, createdDateTime_values, displayName_count, display... |
| `governance:group-expiration-policy` | ok | 0 | _itemCount, groupExpirationPolicyConfigured, id_count, id_first, id_values, values_count, values_first, valu... |
| `governance:guest-access-reviews` | ok | 0 | _itemCount, guestAccessReviewExists, id_count, id_first, id_values, scope_count, scope_first, scope_values |
| `governance:guest-count` | ok | 24 | _itemCount, guestAccountCount, id_count, id_first, id_values, userType_count, userType_first, userType_values |
| `governance:guest-staleness` | ok | 24 | _itemCount, id_count, id_first, id_values, signInActivity_count, signInActivity_first, signInActivity_values... |
| `governance:overdue-access-reviews` | ok | 0 | _itemCount, id_count, id_first, id_values, overdueAccessReviewCount, status_count, status_first, status_values |
| `governance:ownerless-groups` | ok | 104 | _itemCount, displayName_count, displayName_first, displayName_values, id_count, id_first, id_values, ownerle... |
| `governance:public-groups-discoverable` | ok | 78 | _itemCount, displayName_count, displayName_first, displayName_values, groupsScanned, id_count, id_first, id_... |
| `governance:public-teams-discoverable` | ok | 18 | _itemCount, displayName_count, displayName_first, displayName_values, id_count, id_first, id_values, publicT... |
| `governance:retention-label-adoption` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature |
| `governance:retention-policy-coverage` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature |
| `governance:sensitivity-label-adoption` | ok | 0 | _itemCount, id_count, id_first, id_values, name_count, name_first, name_values, sensitivityLabelCount |
| `identity:b2b-collaboration-settings` | ok | 1 | _itemCount, allowInvitesFrom_count, allowInvitesFrom_first, allowInvitesFrom_values, guestInviteRestriction |
| `identity:break-glass-health` | ok | 24 | _itemCount, accountEnabled_count, accountEnabled_first, accountEnabled_values, breakGlassAccountsHealthy, id... |
| `identity:ca-device-compliance` | ok | 0 | _itemCount, caDeviceCompliancePolicyExists, grantControls_count, grantControls_first, grantControls_values, ... |
| `identity:ca-legacy-auth-block` | ok | 0 | _itemCount, caLegacyAuthBlockExists, conditions_count, conditions_first, conditions_values, id_count, id_fir... |
| `identity:ca-mfa-coverage` | ok | 0 | _itemCount, caMfaPolicyExists, grantControls_count, grantControls_first, grantControls_values, id_count, id_... |
| `identity:ca-policy-count` | ok | 0 | _itemCount, caPolicyCount, displayName_count, displayName_first, displayName_values, id_count, id_first, id_... |
| `identity:ca-report-only` | ok | 0 | _itemCount, caReportOnlyPolicyCount, id_count, id_first, id_values, state_count, state_first, state_values |
| `identity:continuous-access-evaluation` | ok | 0 | _itemCount, caeConfiguredPolicyCount, caeDisabledPolicyCount, caePolicyTotal, displayName_count, displayName... |
| `identity:cross-tenant-access` | ok | 1 | _itemCount, crossTenantAccessConfigured, id_count, id_first, id_values |
| `identity:department-directory` | ok | 24 | _itemCount, accountEnabled_count, accountEnabled_first, accountEnabled_values, department_count, department_... |
| `identity:global-admin-count` | ok | 6 | @odata.type_count, @odata.type_first, @odata.type_values, _itemCount, displayName_count, displayName_first, ... |
| `identity:guest-mfa-enforcement` | ok | 0 | _itemCount, conditions_count, conditions_first, conditions_values, guestMfaPolicyExists, id_count, id_first,... |
| `identity:hybrid-sync-health` | ok | 1 | _itemCount, hybridSyncEnabled, id_count, id_first, id_values, lastSyncDateTime, onPremisesLastSyncDateTime_c... |
| `identity:legacy-auth-usage` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature, hasAADP1orP2 |
| `identity:mfa-method-breakdown` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature, hasAADP1orP2 |
| `identity:mfa-registration` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature, hasAADP1orP2 |
| `identity:named-locations` | ok | 0 | _itemCount, displayName_count, displayName_first, displayName_values, id_count, id_first, id_values, namedLo... |
| `identity:password-expiration-policy` | ok | 9 | _itemCount, id_count, id_first, id_values, passwordExpirationDays, passwordValidityPeriodInDays_count, passw... |
| `identity:pim-eligible-roles` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature, hasAADP1orP2 |
| `identity:pim-groups` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature, hasAADP1orP2 |
| `identity:pim-permanent-roles` | ok | 19 | _itemCount, id_count, id_first, id_values, permanentRoleAssignmentCount, principalId_count, principalId_firs... |
| `identity:privileged-mfa-gap` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature, hasAADP1orP2 |
| `identity:risky-signins` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature |
| `identity:risky-users` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature |
| `identity:signin-risk-policy` | ok | 0 | _itemCount, conditions_count, conditions_first, conditions_values, id_count, id_first, id_values, signInRisk... |
| `identity:sspr-config` | ok | 1 | _itemCount, adminSsprAllowed, id_count, id_first, id_values |
| `identity:stale-accounts` | ok | 24 | _itemCount, id_count, id_first, id_values, signInActivity_count, signInActivity_first, signInActivity_values... |
| `identity:terms-of-use` | ok | 0 | _itemCount, displayName_count, displayName_first, displayName_values, id_count, id_first, id_values, termsOf... |
| `identity:user-risk-policy` | ok | 0 | _itemCount, conditions_count, conditions_first, conditions_values, id_count, id_first, id_values, userRiskPo... |
| `license:copilot-assignment` | ok | 4 | _itemCount, consumedUnits_count, consumedUnits_first, consumedUnits_values, copilotSkuData, skuPartNumber_co... |
| `license:sku-utilization` | ok | 4 | _itemCount, consumedUnits_count, consumedUnits_first, consumedUnits_values, prepaidUnits_count, prepaidUnits... |
| `license:unused-assigned` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature, hasAADP1orP2 |
| `licensing:project-online-detection` | ok | 4 | _itemCount, capabilityStatus_count, capabilityStatus_first, capabilityStatus_values, projectPlanFiveCount, p... |
| `m365:message-center` | ok | 419 | _itemCount, category_count, category_first, category_values, id_count, id_first, id_values, majorChangeCount... |
| `m365:service-health` | ok | 25 | _itemCount, id_count, id_first, id_values, operationalServiceCount, service_count, service_first, service_va... |
| `onedrive:active-users` | ok | 1 | _itemCount, oneDriveAccountsScanned, oneDriveActiveUserCount |
| `onedrive:departed-user-access` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature, hasAADP1orP2 |
| `onedrive:external-sharing-settings` | ok | 99 | _itemCount, id_count, id_first, id_values, onedriveExternalSharingEnabled |
| `onedrive:storage-utilization` | ok | 1 | _itemCount, onedriveStorageUsedBytes, ownerPrincipalName_count, ownerPrincipalName_first, ownerPrincipalName... |
| `onedrive:sync-errors` | ok | 1 | _itemCount, oneDriveAccountsScanned, oneDriveStaleSyncAccountCount |
| `platform:branding-config` | ok | 0 | _itemCount, brandingConfigured, id_count, id_first, id_values |
| `platform:multi-geo-status` | ok | 1 | _itemCount, id_count, id_first, id_values, multiGeoEnabled |
| `platform:tenant-password-expiration` | ok | 9 | _itemCount, id_count, id_first, id_values, passwordValidityPeriodInDays_count, passwordValidityPeriodInDays_... |
| `security:alert-count-by-severity` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature, hasDefender |
| `security:antiphishing-coverage` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature, hasDefender |
| `security:automated-investigation` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature, hasDefender |
| `security:azure-roleDefinitions-compliance` | ok | 145 | _itemCount, id_count, id_first, id_values |
| `security:dlp-true-positive-rate` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature, hasDefender |
| `security:dlp-violations` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature, hasDefender |
| `security:insider-risk-alerts` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature, hasDefender |
| `security:open-incidents` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature, hasDefender |
| `security:password-protection-policy` | ok | 9 | _itemCount, id_count, id_first, id_values, passwordProtectionPolicyExists |
| `security:safe-attachments-coverage` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature, hasDefender |
| `security:safe-links-coverage` | license_gap | 0 | _licenseGap, _licenseGapCode, _licenseGapFeature, hasDefender |
| `security:secure-score` | ok | 90 | _itemCount, currentScore_count, currentScore_first, currentScore_values, id_count, id_first, id_values, maxS... |
| `security:secure-score-by-category` | ok | 90 | _itemCount, controlScores_count, controlScores_first, controlScores_values, secureScoreByCategory |
| `sharepoint:inactive-sites` | ok | 99 | _itemCount, id_count, id_first, id_values, inactiveSiteCount, lastModifiedDateTime_count, lastModifiedDateTi... |
| `sharepoint:site-count` | ok | 99 | _itemCount, id_count, id_first, id_values, sharepointSiteCount, webUrl_count, webUrl_first, webUrl_values |
| `sharepoint:site-label-coverage` | ok | 99 | _itemCount, id_count, id_first, id_values, sitesWithLabelCount |
| `sharepoint:storage-near-limit` | ok | 99 | _itemCount, id_count, id_first, id_values, sitesNearStorageLimitCount |
| `sharepoint:storage-utilization` | ok | 99 | _itemCount, id_count, id_first, id_values, sharepointStorageUsagePercent |
| `sharepoint:tenant-sharing-capability` | ok | 1 | _itemCount, anonymousSharingEnabled, externalSharingEnabled, sharingCapability, sharingCapabilityName |
| `teams:app-permission-policy` | ok | 18 | _itemCount, appPermissionPolicyAssignedCount, id_count, id_first, id_values |
| `teams:channel-sprawl` | ok | 27 | _fanOut, _itemCount, channelCount, displayName_count, displayName_first, displayName_values, id_count, id_fi... |
| `teams:external-access-settings` | ok | 18 | _itemCount, externalAccessEnabled, id_count, id_first, id_values |
| `teams:guest-membership` | ok | 18 | _itemCount, id_count, id_first, id_values, teamsWithGuestsCount |
| `teams:guest-settings-governance` | ok | 18 | _fanOut, _itemCount, guestSettings_count, guestSettings_first, guestSettings_values, guestSettingsData |
| `teams:inactive-teams` | ok | 18 | _itemCount, id_count, id_first, id_values, inactiveTeamCount |
| `teams:inventory-count` | ok | 18 | _itemCount, displayName_count, displayName_first, displayName_values, id_count, id_first, id_values, publicT... |
| `teams:meeting-policy-coverage` | ok | 18 | _itemCount, id_count, id_first, id_values, meetingPolicyAssignedCount |
| `teams:messaging-policy-coverage` | ok | 18 | _itemCount, id_count, id_first, id_values, messagingPolicyAssignedCount |
| `teams:ownerless-teams` | ok | 18 | _itemCount, displayName_count, displayName_first, displayName_values, id_count, id_first, id_values, ownerle... |
| `teams:rooms-device-health` | service_not_configured | 0 | _serviceDetectionSignature, _serviceKey, _serviceName, _serviceState, _serviceUnavailable |
| `teams:team-count` | ok | 18 | _itemCount, displayName_count, displayName_first, displayName_values, id_count, id_first, id_values, teamCount |

### 7.4 The portal pillar payload — RETIRED endpoint (not re-verifiable)

The prior edition documented `GET /api/portal/assessment/war-room-pillars` and a live authenticated capture of its `PillarCard[]` shape. **That endpoint no longer exists in the codebase** (grep at commit `7a46c5d9` finds no `war-room-pillars` route anywhere), and the entire portal-v2 surface that consumed it has been removed (§9). The pillar *scores* it exposed are still real and computed by `getPillarCoverage` (§2), and `tenant_pillar_snapshots` (§7.5) is their real store — but the specific HTTP envelope in the prior edition is stale and is not reproduced here as observed. Any new portal endpoint that surfaces pillar cards will be a fresh contract under the #1485 rebuild.

### 7.5 `tenant_pillar_snapshots` row (pillar history)

`{customer_id, msp_id, pillar_key, score int 0-100, previous_score, delta, trend_direction "up"|"down"|"flat"|null, package_key, run_id, captured_at}` — one row per scored pillar per coverage-sufficient run. Real latest rows (customer 1, 2026-08-30, `core:premier`): adoption 82 · architecture 54 · compliance 70 · copilot 49 · governance 53 · licensing 50 · security 55 — all `delta 0 / flat` (repeated same-package runs converged; the deltas the prior edition showed were the first post-cleanup transient). A dark/partial run writes nothing (the coverage gate), so absence of history = "not enough history yet", never zero.

### 7.6 Drift shapes

`drift_baseline_snapshots`: per (tenant, domain) approved-state snapshot (4 live). `drift_events`: itemized, id-keyed setting deviations `{domain_key, verdict: approved|attributed_unapproved|unattributed|informational, …}` (0 rows — no deviation since baseline). `drift_collection_status`: per-domain honest status, observed literals `tracked` (4 domains) and `not_comparable` (1: `eeeu-site-sharing`). The resolver serves: baseline+events → `ok{events:[…]}`; baseline+none → `ok{events:[]}` (genuinely clean); no baseline → `not_available(no_data)`; not comparable → `not_available(not_comparable + reason)`.

## 8. ABSENT — registry sourceKeys with no catalog check (67)

Every row below is a `monitor_profile` registry metric whose `sourceKey` names **no row in `monitor_checks`** — a registry-vs-catalog diff, verified unchanged against the 157-key catalog. Per the resolver each resolves to `unknown_check_key` and can never produce data until the registry key matches a real catalog key or the check is built. The ⚠ rows are near-miss naming drift where a semantically-similar real check exists under a different key — a rename/re-point decision, not a build decision. (The 18 `drift:*` keys are excluded — they route to the real drift store, §6.)

**67 phantom sourceKeys, unchanged from the 2026-08-28 edition** (the registry has not been re-versioned): the `audit:*` identity-event family (3, no counterpart); the `collaboration:*` mailbox/teams family (7, no counterpart); the `compliance:*` family (`compliance:guest-users` ⚠ `governance:guest-count`; `compliance:overshared-sites`, `compliance:public-channels`, `compliance:sharepoint-sites`, `compliance:orphaned-sites/teams`, `compliance:external-invites`, `compliance:active-ediscovery`, `compliance:onedrive-external`, `compliance:missing-retention-tags` — no counterpart); `copilot:overshare-exposure` and `copilot:license-readiness` (no counterpart); `cost:license-waste-estimate` (no counterpart); the entire `dynamics:*` (7) and `power-platform:*` (2) families (no counterpart); `identity:disabled-accounts`, `identity:passwordless-adoption` (no counterpart); the `intune:*` device family (`intune:non-compliant-devices` ⚠ `devices:compliant-vs-noncompliant`, `intune:outdated-devices` ⚠ `devices:os-patch-compliance`, `intune:unencrypted-devices` ⚠ `devices:encryption-status`, `intune:unenrolled-devices` ⚠ `devices:enrollment-status`; `intune:config-drift`, `intune:high-threat-devices`, `intune:jailbroken-devices`, `intune:rooted-devices` — no counterpart); the `licensing:*` family (`licensing:duplicate-assignments` ⚠ `cost:duplicate-assignments`, `licensing:inactive-user-licenses` ⚠ `license:unused-assigned`, `licensing:sku-utilization` ⚠ `license:sku-utilization`); the `platform:*` operational family (8, no counterpart); the `security:*` alert family (`security:secure-score-controls` ⚠ `security:secure-score-by-category`; `security:active-alerts`, `security:high-severity-alerts`, `security:malware-alerts`, `security:phishing-alerts`, `security:risk-detections`, `security:attack-simulation`, `security:secure-score-drift` — no counterpart); the `workflow:*` family (7, no counterpart).

**Note the ⚠ Intune re-point candidates now resolve differently:** `devices:compliant-vs-noncompliant`, `devices:os-patch-compliance`, `devices:encryption-status`, `devices:enrollment-status` are all REAL checks but return `service_not_configured` on this un-enrolled testbed (§4). A tenant with Intune would return real device counts. Re-pointing a phantom `intune:*` key to its `devices:*` counterpart gives the metric a real check whose state is honest, not a fabricated number.

## 9. Portal surface — RETIRED (portal-v2 removed; the rebuild is #1485)

The prior edition's §9 was a page-by-page reverse map of the **portal-v2** customer portal, with a live-captured hero-tile backing map. **That surface no longer exists.** At commit `7a46c5d9`: `artifacts/msp-portal/src/pages/` contains **0 page files**, the `war-room-pillars` endpoint is gone, and `Design/portal/` (the live design source named by CLAUDE.md) carries **0 `.dc.html` exports**. `portal-v2` and `Design/design_handoff_customer_portal/` are retired per CLAUDE.md / Epic #1485 and are explicitly **not** a fallback. Carrying that reverse-map forward would document a dead UI as if it were a rebuild target, so it is deliberately dropped rather than presented as current.

What remains real on the server side, for whoever builds the new portal: the `/api/portal/*` route family is largely intact (verified present at `artifacts/api-server/src/routes/`: `portal-assessment.ts`, `portal-change-control.ts`, `portal-risk-register.ts`, `portal-compliance-obligations.ts`, `portal-alert-preferences.ts`, `portal-billing.ts`, `portal-checkout*.ts`, `portal-customer-*.ts`, and a newer `portal-config-state.ts` — see §12). The durable value of this document for the #1485 rebuild is §1–§8 and §10–§11: which checks are real, at what shape, with what honest empty states. The design order fixed by CLAUDE.md still holds — architect → build endpoints → regenerate the contract pack from real code → Design → wire — and a page has no design until its `.dc.html` exists in `Design/portal/`.

## 10. Evidence log

Live DB queries (2026-09-01, database `shanemccawmsp`, local PostgreSQL 18 via `psql "$DATABASE_URL"`): `monitor_checks` executor×status and total counts; `tenants` id/domain/`is_testbed`; `msp_diagnostic_runs` recent rows; per-run status distribution for `82015d75` and `wf-run-34320` via `trigger_id`; latest-status-per-check for the testbed (152 rows, the input to §4 and §7.3); the 5 never-observed catalog checks; PowerShell-check latest status; engine-tag×class aggregation (the §1 pillar totals); `tenant_pillar_snapshots` latest-per-pillar + row count; `tenant_engine_snapshots` count (0); `drift_baseline_snapshots`/`drift_events`/`drift_collection_status`; `tenant_check_item_details` distinct-check count; `monitoring_packages`/`monitoring_package_checks` membership; `tenants.consent` for tenant 1. The §4 master table and §7.3 shape table are machine-generated from the latest-per-check query joined to `monitor_checks` and package membership, to eliminate transcription error.

Cross-referenced issue evidence (pulled 2026-09-01): #1766 (PS pipeline re-baseline, Global Reader grant, closed superseded by #2161); #1786 (the 5 error-check fixes + the `151/126 ok/0 error` re-baseline and container redeploy `ca-ps-execution-dev--dev20260830030636`); #1811 (two-way permission audit, `REQUIRED_MT_SCOPES` 31→35); #1830 (`BitlockerKey` casing + this doc's stale scope count); #1793/#1794/#1795/#1797/#1798 and #1845 (config-state chain and the second-pass follow-up).

Key code citations at commit `7a46c5d9`: `artifacts/api-server/src/lib/monitor-executor.ts` (:179 collectDriftForCompletedCheck, :352 status union, :909 classifySeverity, :1073 applyMapping, :1618 graphFetchPaginated, :1873 persistCheckProfile, :1896 runPowerShellCheck, :2115 runSharePointAdminCheck, :2481 runDnsCheck, :2896 runFanOutCheck, :3159 executeMonitorCheck dispatch, :3494/:3818 service_not_configured, :3628 loadOrderedPackageChecks, :3671 executeMonitoringPackage) · `graph.ts` (:66-119 REQUIRED_MT_SCOPES) · `health-engine.ts` (:52 HEALTH_PILLARS) · `pillar-coverage.ts` (:111 RADAR_PILLARS) · `drift-check-specs.ts` (:246-270 the 5 domain specs) · `lib/dashboard-registry/src/metrics.ts` (198 metrics) · `diagnostics-runner.ts`, `workflow-executor.ts`, `item-detail-collector.ts`, `admin-monitor-check-runs.ts` (the four run triggers) · `services/ps-execution/cmdlet-catalog.ps1` + `child-worker.ps1`.

## 11. Explicit unknowns — what could not be verified, and why

1. **The war-room pillar payload HTTP shape is no longer verifiable** — the `war-room-pillars` endpoint and the whole portal-v2 surface have been removed (§7.4/§9). The pillar scores behind it remain real (`tenant_pillar_snapshots`, `getPillarCoverage`); the specific card envelope is not reproduced here as observed.
2. **Second-tenant (`tenants.id = 3`) state was not re-scanned** this session; its observations date to 2026-08-09. No check is classified REAL on its evidence alone — the testbed (`id = 1`) is the sole basis for §4/§7.3.
3. **`tenant_engine_snapshots` / Mission Control engine runs** were not exercised (table stayed empty). The 16 `engine_snapshot` registry metrics' `no_snapshot` behaviour is code-read plus the empty-table observation, not an observed engine run.
4. **Per-check Graph permission scopes** are not recorded per-check anywhere; only the tenant-level granted consent set (§3) is real data. Attributing an exact scope to each of the 138 Graph endpoints would be inference, so it was not done.
5. **`consent_revoked`, `requires_script`, `azure_no_rbac`, `azure_no_subscriptions` statuses** were not observed live this session — the canonical run had none. Their semantics are code-declared (monitor-executor.ts:352 and the Azure-ARM scaffolding, §12).
6. **The single `error` in the newest recurring run** (`adoption:sharepoint-onedrive-trend`, "terminated") is treated as transient: the same check is `ok` in every diagnostics run of this cycle. It is not evidence of a systemic Graph-report failure, but it is a real, un-root-caused transient and is labelled as such rather than smoothed over.
7. **Trend series** (`pillar.trend`, ≥5 checkpoints) is not verifiable — the testbed has repeated same-package runs but the trend requires distinct checkpoints, and its consuming UI (portal-v2) is gone.
8. **The config-state snapshot store's runtime behaviour** is not observed because it is not yet wired into scanning (§12). Its docs exist; its production of data does not, and this document does not claim otherwise.
9. **`BitLockerKey.Read.All` vs `BitlockerKey.Read.All`** — the code array and the persisted grant both use the capital-L spelling; Microsoft's registered appRole value is lower-case `Bitlocker`. Same GUID, functionally correct, but the string shown to a buyer differs from Microsoft's own consent screen (#1830, open).

## 12. Config-state extension — in flight, NOT built into scanning (do not read as present)

The platform today is **check-centric**: `tenant_monitor_profiles` stores the answer to a question (a status, a handful of extracted properties, a severity). A separate effort is building a **state-centric** layer beside it — a whole-configuration snapshot store, where each resource holds its full property set, from which a differ derives drift, baseline assessment, tenant compare, and Dev→Test→Prod promotion as one engine over different input pairs. This document maps the check-centric world as it exists; the state-centric world is **not yet what scanning produces**, and nothing above should be read as if it were.

The chain, named so the second pass can be traced: **#1793** (app-only PowerShell capability survey — the real exported cmdlet surface, not the 17 wired checks), **#1794** (Graph resource model from `$metadata` + Microsoft365DSC's resource map), **#1795** (the snapshot store itself), **#1796/#1797** (the differ and the unified engine), **#1798** (chain end). What has *begun* landing as scaffolding — and is why some new artifacts already exist — is real but partial: survey/model documents (`docs/powershell-capability-survey.md`, `docs/graph-resource-model.md`, `docs/configuration-state-contract-pack.md`), a `portal-config-state.ts` route, the `azure_no_rbac`/`azure_no_subscriptions` statuses and the unused `pp_operation`/`arm_operation` catalog columns. None of that constitutes a populated whole-configuration snapshot store feeding pillars, and this map does not describe one.

**This map is regenerated a second time when the chain lands, under #1845** — which will add the snapshot resource model beside the check catalog, re-count which of the 18 drift domains gain a producer (13 have none today), and fold in the PowerShell surface survey. Also flagged for that pass: `drift.regression` is a `pending_detector` alert rule whose recorded blocker is *"drift_events has no resolved→reopened lifecycle"* — a snapshot store plus a differ is exactly what could make that lifecycle expressible; if the build set takes that rule from can-never-fire to live, the detector work is filed as its own issue rather than silently flipped, and this document is corrected then, not now.

---
*Regenerated for issue #1841 (supersedes the 2026-08-28 #1481 edition). §4 and §7.3 tables are machine-generated from the live query results named in §10 to eliminate transcription error. Second pass tracked by #1845, after the config-state chain (#1793 → #1798) lands.*
