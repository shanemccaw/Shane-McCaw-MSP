# Tenant Permission / Role Model

**Issue:** #2161 (re-baseline; redo of #1766). **Epic:** #1096 Application Core.
**Authored:** 2026-09-01. **All state below re-verified live via Microsoft Graph on
2026-09-01** against the testbed tenant, except where explicitly marked
"catalog-derived" or "not live-verified this session."

This document is the authoritative map of *which principal holds which role/permission
at which scope, why, and what breaks without it* for the monitoring/scan surface. It
supersedes the permission-failure narrative in `docs/pillarmapping.md` (dated
2026-08-28), which predates the #1400 / #1483 / #1614 / #1793 remediations and is
**stale** for permission state — see "Why pillarmapping.md is stale" below.

---

## 0. The tenant

| | |
|---|---|
| Testbed tenant | `mccawsoft2.onmicrosoft.com` |
| Tenant id | `c4c814d4-3afe-441e-9145-62461d0a4fd3` (confirmed via OIDC discovery) |
| Local DB `tenants.id` | **1** (`domain = mccawsoft2.onmicrosoft.com`) |
| Also present | `tenants.id = 3` → `shanemccaw.onmicrosoft.com` (`0a361ab2-…`) |

`mccawsoft2` is **simultaneously the testbed and Shane's real production M365 tenant**
(see CLAUDE.md production-change gate). Reads are freely allowed; the write plane is
gated per the app-registration boundary (§8).

---

## 1. The four principals

There are **four distinct Entra app registrations** in play. The single most important
and most error-prone fact in this whole model:

> **The env var name `MT_APP_CLIENT_ID` holds two *different* app registrations in two
> different runtimes.** The api-server process and the ps-execution container each read
> an env var of that name, but they are configured with different values. This caused
> the Gap 3 bug (§7) and must be kept in mind everywhere.

| # | Purpose | appId | per-tenant SP (in `mccawsoft2`) | displayName | Secret/cred in api-server `.env.local` |
|---|---|---|---|---|---|
| A | **READ app** — api-server `graph`-executor checks (`graphFetchForTenant`) and other api-server Graph reads | `4743b130-0379-41bf-b863-ec8de96d915a` | `6bae4b49-d1e5-470d-9cae-fef901b57f9a` | "MSP Platform - Multi-Tenant Consent (DEV)" | `MT_APP_CLIENT_ID` (+ `MT_APP_CLIENT_SECRET`, `MT_APP_CERT_THUMBPRINT`) |
| B | **ps-execution app** — the `ca-ps-execution` container's tenant identity for `powershell` + `sharepoint-admin` checks (Exchange/Purview/Teams/SharePoint, app-only **cert** auth) | `9ea2e409-d1b9-422a-8451-02fa0b98d1c3` | `1c640fe8-1c23-4510-8235-9ee6938d8f8b` | "MSP Platform — Multi-Tenant Consent" | none in api-server — configured **inside the container** as *its own* `MT_APP_CLIENT_ID` (`services/ps-execution/entrypoint.ps1:71`, `README.md:186`). Add `PS_EXECUTION_APP_CLIENT_ID` to the api-server env to make provisioning target it (§7/§9). |
| C | **WRITE / DEV app** — elevated write-plane consent used to *assign* directory roles / write back to tenants | `9f6f4772-b5be-421f-815e-b392336c373a` | (not enumerated this session) | — | `MT_APP_WRITE_CLIENT_ID` (+ `MT_APP_WRITE_CLIENT_SECRET`). This is the DEV app-registration named in CLAUDE.md's production-change gate (agent-modifiable). |
| D | **GRAPH / AZURE app** — single-tenant app for the platform's own Azure/Graph housekeeping | `16959be3-40b9-4cc0-b256-3fa771db3533` | (not enumerated) | — | `GRAPH_CLIENT_ID` / `AZURE_CLIENT_ID` (+ secrets). Live check: this app **cannot** read `/servicePrincipals` (403 `Authorization_RequestDenied`) — it holds a narrower grant than A/B. |

---

## 2. Application-permission surface (live, 2026-09-01)

Both the READ app (A, SP `6bae4b49`) and the ps-execution app (B, SP `1c640fe8`) carry
the **identical** application-permission grant — **32 Microsoft Graph app-roles** plus
four non-Graph resource app-roles:

**Graph app-roles (32, both A and B):**
`AccessReview.Read.All, Agreement.Read.All, Application.Read.All, AuditLog.Read.All,
BitlockerKey.Read.All, Community.Read.All, DelegatedPermissionGrant.Read.All,
DeviceManagementApps.Read.All, DeviceManagementConfiguration.Read.All,
DeviceManagementManagedDevices.Read.All, Directory.Read.All, Domain.Read.All,
IdentityRiskEvent.Read.All, IdentityRiskyServicePrincipal.Read.All,
IdentityRiskyUser.Read.All, InformationProtectionPolicy.Read.All, Organization.Read.All,
Policy.Read.All, RealTimeActivityFeed.Read.All, RecordsManagement.Read.All,
Reports.Read.All, RoleEligibilitySchedule.Read.Directory, SecurityEvents.Read.All,
SensitivityLabels.Read.All, ServiceHealth.Read.All, ServiceMessage.Read.All,
SharePointTenantSettings.Read.All, Sites.Read.All, Tasks.Read.All, Team.ReadBasic.All,
TeamSettings.Read.All, TeamworkDevice.Read.All`

**Non-Graph resource app-roles (both A and B):**
- Office 365 Exchange Online — `Exchange.ManageAsApp` + `Exchange.ManageAsAppV2` (app-only EXO / IPPS PowerShell)
- Office 365 SharePoint Online — `Sites.FullControl.All` (the `sharepoint-admin` executor)
- Office 365 Management APIs — `ActivityFeed.Read`

> **Consequence:** application-consent permissions are NOT the axis that distinguishes
> the two apps. The distinguishing axis is the **directory role** (§3). Any check that
> only needs an app-only *Graph read* is covered by both apps' identical 32-role grant.

---

## 3. Directory role: Global Reader

| | |
|---|---|
| Role | **Global Reader** (built-in) |
| roleTemplateId / roleDefinitionId | `f2ef992c-3afb-46b9-b7cf-a126ee74c451` (same GUID for both — built-in role) |
| Scope | `/` (tenant-wide directory) |
| **Holder (live, 2026-09-01)** | **ps-execution app B, SP `1c640fe8`** — `memberOf` returns Global Reader ✓ |
| **NOT held by** | READ app A, SP `6bae4b49` — `memberOf` returns **no directory roles** |

**Why the ps-execution SP needs it.** Certain app-only *PowerShell admin* cmdlets — most
concretely `Get-CsOnlineUser` via `Connect-MicrosoftTeams` — perform a directory-level
RBAC check that the 32 application app-roles do **not** satisfy; they require the caller
to hold a directory role such as Global Reader. #1483 hit exactly this ("Access Denied"
on `Get-CsOnlineUser`) and resolved it by granting Global Reader to SP `1c640fe8`; after
which the check returned `ok:true`. That grant is the one this model automates (§7).

**What breaks without it.** The container `powershell` checks that call Teams/directory
admin cmdlets fail with access-denied, exactly as an unprovisioned tenant would — which
is the entire failure mode #1130's provisioning module exists to prevent for every newly
onboarded tenant.

**Why the READ app does NOT need it.** The api-server `graph`-executor checks only issue
app-only Graph REST reads, fully covered by the 32 app-roles (live-probed: CA policies,
secure scores, subscribedSkus, directoryRoles all return 200 as the READ app). Granting
Global Reader to the READ app SP would be harmless but useless — and, critically, it is
**not** the SP that runs the checks that actually need the role.

---

## 4. Execution paths → identity map

One dispatcher, `executeMonitorCheck` (`artifacts/api-server/src/lib/monitor-executor.ts`),
branches on `monitor_checks.executor_type`. For the **`core:premier`** package (151 active
member checks, live count 2026-09-01):

| `executor_type` | count in core:premier | Runs where | Authenticates as | Cred |
|---|---|---|---|---|
| `graph` | **134** | api-server, direct Graph REST | **READ app A** (`4743b130` / SP `6bae4b49`) | client secret |
| `powershell` | **15** | `ca-ps-execution` container, child `pwsh` | **ps-execution app B** (`9ea2e409` / SP `1c640fe8`) | `mt-app-cert` |
| `sharepoint-admin` | **1** | SharePoint admin API | **ps-execution app B** (cert / `Sites.FullControl.All`) | `mt-app-cert` |
| `dns` | **1** | public TXT lookups | none (no tenant auth) | — |

**The 15 `powershell` + 1 `sharepoint-admin` checks and their admin surface:**
`get-cs-online-user` (Teams — needs Global Reader), and the Exchange Online set
(`transport-rule-count`, `mail-flow-rule-review`, `mailbox-quota-utilization`,
`shared-mailbox-licensing`, `litigation-hold-coverage`, `connector-health`,
`archive-mailbox-rate`, `antispam-policy-coverage`) via `Connect-ExchangeOnline`
(`Exchange.ManageAsApp`), and the Purview/IPPS set (`zero-dlp-policies`,
`weak-dlp-policies`, `missing-labels`, `label-errors`, `dlp-incidents`,
`audit-log-retention`) via `Connect-IPPSSession`. `sharepoint:tenant-sharing-capability`
uses the SharePoint admin API.

**Container → tenant auth details:** api-server `callPsExecution()` POSTs to the container
with a Key-Vault bearer token (a *gate*, not a tenant credential); the container connects
to the tenant as app B via the `mt-app-cert` certificate
(`services/ps-execution/child-worker.ps1` `-AppId $mtAppClientId -Certificate …`). The
container's Azure Managed Identity is used **only** to read Key Vault, never to connect to
a customer tenant.

---

## 5. The WRITE/DEV app (C) and the write-back consent gate

Assigning a directory role (Global Reader) or writing back to a tenant requires
`RoleManagement.ReadWrite.Directory` — a permission the READ/ps-exec apps deliberately do
**not** hold. That write is performed by **app C** (`MT_APP_WRITE_CLIENT_ID`,
`9f6f4772-…`) through `graphWriteForTenant`, gated on the tenant's separate **`writeBack`**
consent grant (not the `graph` read consent). This is why role provisioning fires from the
write-consent callback, and why a `WriteBackNotEnabledError` / `WriteConsentRequiredError`
is treated as an expected "blocked" (retry later), never an error. See
`global-reader-role-provisioning.ts` and `dlp-role-group-provisioning.ts`.

---

## 6. Application permission vs directory role vs license — the three independent axes

A check can only return data when **all three** are satisfied for its execution identity:

1. **Application permission** (app-role / consent) — e.g. `Policy.Read.All`. Both A and B
   have the same 32-role surface (§2).
2. **Directory role** — e.g. Global Reader, only needed by the container admin-cmdlet
   checks, held only by B (§3).
3. **License / tenant tier** — the *tenant* must be licensed for the feature the data
   describes, independent of the app's permissions.

These are orthogonal. A 403 on `AuditLog.Read.All` data despite holding the app-role is a
license axis failure, not a permission axis failure — see §7 classification.

---

## 7. Gap 3 — the provisioning module targeted the wrong SP (fixed this session)

`global-reader-role-provisioning.ts` (#1130) automates the §3 grant on tenant onboarding.
The bug: it ran `resolveMtAppServicePrincipalId()` → `process.env.MT_APP_CLIENT_ID`, but
because that module executes **in the api-server**, `MT_APP_CLIENT_ID` there is the READ
app `4743b130` / SP `6bae4b49` — which is neither the SP that runs the checks needing
Global Reader nor the SP #1483 elevated. It therefore granted Global Reader to the wrong
principal and left every freshly-onboarded tenant's container PowerShell checks failing.

**Fix (committed this session):** resolve the target SP via a new
`PS_EXECUTION_APP_CLIENT_ID` env var (the container's own `MT_APP_CLIENT_ID` value,
`9ea2e409-…`), falling back to `MT_APP_CLIENT_ID` only for a unified deployment where both
are the same app. The resolved appId + which env var supplied it is recorded in the step
detail and audit metadata so a mis-target is visible, not silent.

**Sibling with the identical bug — also fixed (#2166, 2026-09-04):**
`dlp-role-group-provisioning.ts` (#249) added `MT_APP_CLIENT_ID`'s SP (`6bae4b49`) to the
Entra security group that is assigned to the Purview DLP role group, but the DLP
`powershell` checks (`compliance:zero-dlp-policies`, `weak-dlp-policies`,
`missing-labels`, `label-errors`, `dlp-incidents`, `audit-log-retention`) run in the
container as B (`1c640fe8`) — so the role-group membership landed on a principal that
never runs them. Fixed with the same `resolveTargetServicePrincipalId` shape:
`PS_EXECUTION_APP_CLIENT_ID` first, `MT_APP_CLIENT_ID` only as a unified-deployment
fallback, with the resolved appId + source env var recorded in the step detail, on the
returned result (`targetAppId` / `targetAppIdSource`), in the `dlp_role_group_provisioning`
audit metadata, and surfaced in the admin panel's DLP provisioning card.
`getDlpProvisioningState`'s live membership read resolves the same target, so the panel
cannot report "member: yes" for a principal the chain no longer targets.

**Both modules now depend on `PS_EXECUTION_APP_CLIENT_ID` being set** — see §9.

---

## 8. Failure classification (grounded in live evidence, 2026-09-01)

Every check failure falls into exactly one of four categories. **A genuinely fresh
full 151-check scan could not be run this session** — the local api-server is down
(bounded check: ports 8080/3000/5173 all timed out), the `ca-ps-execution-dev` container
is not reachable (bounded check: 8s timeout), and the local `simulator_check_runs` table
is empty (Postgres 18 was freshly installed, #1209 — run 453's data is gone). Rather than
fabricate a per-check table that was not actually executed, the categories below are keyed
to the executor classes and **each carries a real, live-probed example**:

| Category | Meaning | Live evidence this session |
|---|---|---|
| **permission gap** | execution identity lacks a required app-role or directory role | Largely **CLOSED**. READ app graph surface live-probed OK (CA policies, secure scores, subscribedSkus, directoryRoles → 200). Container's Global Reader dependency live-confirmed present on SP `1c640fe8`. The pre-#1483 "PowerShell layer permission-broken" narrative in pillarmapping.md is **stale**. |
| **license gap** | app has the permission but the *tenant* isn't licensed for the feature | **Dominant category, live-confirmed.** Tenant SKUs = `ENTERPRISEPACK` (E3), `FLOW_FREE`, `POWER_BI_STANDARD`, `Power_Pages_vTrial` — **no E5, no AAD Premium, no Purview/Defender add-ons**. Concrete: `GET /auditLogs/signIns` → **403 `Authentication_RequestFromNonPremiumTenantOrB2CTenant`** (needs AAD Premium P1/P2). The premier compliance checks (DLP, sensitivity labels, insider-risk, litigation hold, audit-log retention, Copilot) are E5/Purview-gated → license_gap on this E3 tenant. This is the ~22–23 `license_gap` bucket run 453 reported, and it is **expected, not a defect**. |
| **missing detector** | no implemented executor path can deliver the check's data | The IPPS/Purview `powershell` checks are blocked by the `Connect-IPPSSession` MSAL child-process defect (#1389 / #1481) — the executor exists but cannot currently complete, so those checks deliver no data regardless of permission/license. |
| **code defect** | executor bug, not permission/license/detector | Container child-process "malformed output" (#1482) and the #1389/#1481 IPPS MSAL child-process regression are code defects in the ps-execution layer that block `powershell` checks independent of the above. (Not re-reproduced this session — container down.) |

**How to reproduce the full scan when the stack is up:** start the api-server + the
`ca-ps-execution-dev` container, then for each `core:premier` member run the check
(`POST /api/admin/monitor-checks/:key/run` per check, or `…/bulk-run` per domain). Results
land in `simulator_check_runs` (`result_status`, `error_message`, `license_feature`).
Classify each row: `license_feature` set / 403-not-premium → license gap; access-denied
with the app lacking the role → permission gap; executor-absent/child-process failure →
missing detector or code defect per the container logs.

---

## 9. Required environment configuration

| Env var | Where | Value | Status |
|---|---|---|---|
| `PS_EXECUTION_APP_CLIENT_ID` | **api-server** environment | `9ea2e409-d1b9-422a-8451-02fa0b98d1c3` | **Added #2161; now also required by #2166.** Makes **both** `global-reader-role-provisioning.ts` (Global Reader) and `dlp-role-group-provisioning.ts` (Purview DLP role group) target the correct (ps-execution) SP. If unset, both modules fall back to `MT_APP_CLIENT_ID` and record that they did so — which in the split-app dev/prod config is the wrong app. |

- **Local dev:** add `PS_EXECUTION_APP_CLIENT_ID=9ea2e409-…` to `.env.local` (agent-modifiable; DEV/testbed scope).
- **Staging / production api-server env:** setting this is a deployment config change and
  belongs to the **#1281** release gate, not an in-session apply (production-change gate,
  CLAUDE.md §"Production-change gate"). Without it in prod, onboarding provisioning will
  fall back and mis-target unless the prod api-server's `MT_APP_CLIENT_ID` is already the
  `9ea2e409` app. This applies to the Purview DLP chain (#2166) exactly as it does to the
  Global Reader chain (#2161) — one env var, two provisioning modules.

---

## Why `docs/pillarmapping.md` is stale (for permission state)

`pillarmapping.md` is dated **2026-08-28** and its headline ("run 445 … 109 ok / 18 error
/ 22 license_gap", "the entire PowerShell execution layer is PARTIAL … every live
execution errors") predates:

- **#1483** (2026-08-29/30) — fixed the `9ea2e409` cert trust-drift and granted Global
  Reader to SP `1c640fe8`; `get-cs-online-user` then returned HTTP 200.
- **#1614 / #1793** (2026-08-29/30) — re-verified live container calls returning real
  EXO/Teams data as `AppId 9ea2e409`, cert auth true.

The Global-Reader-and-cert permission failures it describes are **remediated**. Its
executor→identity taxonomy remains accurate; its live pass/fail counts and its permission-
failure conclusion do not. This document is the current source of truth for permission
state; run a fresh scan (§8) for current pass/fail counts.
