# Graph configuration resource model

**Git #1794.** The model that says what a tenant *configuration resource* is: its
properties and their types, the transport that reads it, and the permission that read
requires — reconciled against the scopes a tenant has actually granted.

This document explains the model and records what the first extraction measured. **It is
not the model itself.** The model is queryable data in Postgres; every number below is a
query anyone can re-run. If this file and the database disagree, the database is right.

---

## Why this exists

The platform is **check-centric**: `monitor_checks` + `tenant_monitor_profiles` store the
*answer to a question* about a tenant (a status, a few extracted properties, a severity).
Microsoft365DSC is **state-centric**: each resource holds a whole configuration object
with its full property set.

A check can be derived from a configuration snapshot. A snapshot can never be derived
from checks. Before #1794 there was no full-fidelity tenant configuration model anywhere
in this repo — `tenantConfigSnapshot`, `config_snapshot`, `desired_state` and `blueprint`
were all zero hits.

That single gap blocks four capabilities at once: whole-tenant diff, assessment against a
known-good baseline, configuration reporting, and Dev→Test→Prod promotion.

#1794 builds the **model**. #1795 builds the snapshot store on top of it.

## What this deliberately is not

It is **not a list of endpoints that returned 200**. No endpoint enumeration was
performed. Blind probing is thousands of calls, throttles hard (`429 TooManyRequests` is
an already-observed error literal on this platform), and produces a list of URLs, which
is not a model.

Everything here is derived from **published descriptions**, with a deliberately small
read-only live sample on top.

---

## Sources

| Source | What it supplies | Fetched from |
|---|---|---|
| **Graph CSDL `$metadata`** (v1.0 + beta) | The complete entity model: every entity/complex/enum type, its property set with EDM types, the EntityContainer that yields real addressable paths, and bound Functions | `https://graph.microsoft.com/{v1.0,beta}/$metadata` |
| **Microsoft's permissions reference** (Kibali schema) | Which app-only permissions grant a `GET` on which path | `microsoftgraph/microsoft-graph-devx-content` → `permissions/new/permissions.json` |
| **Microsoft365DSC resource map** | Configuration object → workload → read cmdlets → required app-only permissions → the DSC property set with allowed values | `Microsoft365DSC/Microsoft365DSC` (MIT), `Modules/Microsoft365DSC/DscResources/*` |

**Attribution.** Microsoft365DSC is community-maintained open source under MIT, developed
with Microsoft involvement but not a Microsoft first-party product. Only its factual
resource→transport→permission map is read. No code or content is copied into this product.

Three downloads total. `scripts/config-state/fetch-sources.mjs` caches them into the
gitignored `.cache/config-state/` and records the exact Microsoft365DSC commit in
`provenance.json`, so an extraction can be dated and re-derived.

---

## The data model

Seven tables and one view (`lib/db/src/schema/config-state.ts`, DDL in
`lib/db/migrations/manual/2026-08-30-config-state-resource-model-1794.sql`).

### `config_resources` — the deliverable

One row per tenant configuration resource. A row can come from Graph's metadata, from
Microsoft365DSC, or from **both** when the two were matched — and `link_basis` records
*how* they were matched, so a merge is never asserted without stating its evidence.

Key columns:

- `read_transport` — `graph` · `powershell` · `sharepoint-admin` · `dns` · `power-platform` ·
  `azure-rm` · `unknown`. The first **six** mirror `MONITOR_CHECK_EXECUTOR_TYPES` so
  the model and the monitor catalog stay on one vocabulary. Any that do not are real
  transports Microsoft365DSC uses that this platform has **no executor for at all** —
  which is itself part of the measured answer to "what can we not collect".

  That distinction is surfaced explicitly rather than left to be inferred (#1849 point 3,
  built in #1869 and #1871): `transportHasExecutor()` / `coverageStateFor()` in
  `lib/db/src/schema/config-state.ts` are **derived** from `MONITOR_CHECK_EXECUTOR_TYPES`,
  and `/api/admin/config-resources` returns a per-resource `coverageState` of
  `covered` / `uncovered` / `no_executor` plus a `resourcesWithNoExecutor` total — so
  "no code path could read this" never again reads the same as "nobody has written the
  check yet". Because it is derived, it cannot go stale as transports are added.

  Both transports #1849 flagged now have executors: `power-platform` in #1869, and
  `azure-rm` in #1871 (Azure Resource Manager REST — see
  `artifacts/api-server/src/lib/azure-rm.ts`). `resourcesWithNoExecutor` should therefore
  now read **0**.

  Caveat on the `azure-rm` grouping itself, found while building that executor: the
  transport was derived from Microsoft365DSC's permission *workload* names, and the rule
  folds `Azure DevOps` in with `Azure`/`Azure Service Management`
  (`scripts/config-state/build-resource-model.mjs`). The four `ADO*` resources are
  therefore labelled `azure-rm` but are **not** ARM at all — Microsoft365DSC reads them
  from `https://dev.azure.com/{org}/_apis/…` under a different token audience
  (`499b84ac-1321-427f-aa17-267ca6975798`) and Azure DevOps' own permission model, not
  Azure RBAC. 18 of the 22 are genuinely ARM.
- `graph_version` + `graph_path` + `graph_container_kind` — the addressable read.
- `read_cmdlets` — the PowerShell read path where there is one.
- `availability` — see below.
- `verification_status` — `verified_live` · `failed_live` · `not_attempted` ·
  `derived_not_verified`.
- `check_coverage_count` — how many `monitor_checks` rows touch this resource. `0` means
  entirely uncovered.
- **Coverage state** (computed, not stored — `coverageStateFor()` in
  `lib/db/src/schema/config-state.ts`, #1869) — `covered` · `uncovered` · `no_executor`.
  Computed rather than persisted so it cannot go stale when a new executor ships.
  `no_executor` is evaluated first and wins: a resource whose transport has no executor is
  **unreachable by any code path**, not merely "nobody has written the check yet", and
  conflating the two is what #1849 asked to end. Measured live 2026-08-30:
  **covered 62 · uncovered 1,455 · no_executor 22** (all 22 `azure-rm`).

### Two permission columns, on purpose

This is the subtlety most likely to be misread later, so it is two columns rather than one:

| Column | Semantics | Source |
|---|---|---|
| `required_app_permissions` | **ALL-OF** — the full set the resource's Get needs | Microsoft365DSC |
| `graph_read_permission_options` | **ANY-OF** — holding *one* is enough | Microsoft's permissions reference |

`/applications` lists `Application.Read.All`, `Application.ReadWrite.All`,
`Application.ReadWrite.OwnedBy` and `Directory.Read.All`; any one grants the read. A
Microsoft365DSC resource's list is different in kind: `AADConditionalAccessPolicy` needs
all seven of its permissions, because rendering a CA policy also resolves groups, roles
and applications. Treating either as the other would misreport availability in both
directions. `permission_source` records which one settled the verdict.

### `availability` — resolved against what is really granted

Read live from `tenants.consent` on the tenant being reconciled against, never assumed.

- `available_now` — every required (or any one qualifying) app-only permission is granted
- `needs_additional_scope` — readable app-only, with the exact missing scope named in
  `missing_permissions`
- `needs_license` — **only ever set from live evidence.** No source document states license
  requirements, so this verdict is written exclusively by `verify-sample.mjs` when Graph
  itself returns a license/feature gap
- `unavailable` — the source states a delegated read path only; no app-only read exists
- `unknown` — no source states a read permission either way

### Supporting tables

- `graph_entity_types` / `graph_entity_properties` — Graph's published entity model, scoped
  to the transitive closure the configuration surface actually reaches (not all ~11.6k
  declared types).
- `config_resource_properties` — the property model. `source` is `graph-metadata` or
  `m365dsc-mof`, because the two name the same object differently: Graph names the wire
  property (`displayName`, `Edm.String`), Microsoft365DSC names the DSC parameter
  (`DisplayName`, MOF `String`) and additionally publishes the allowed value set.
  `is_connection_parameter` flags the DSC parameters that configure the *connection*
  (`Credential`, `ApplicationId`, `TenantId`, `Ensure`, …) rather than the tenant — they
  appear on nearly every DSC resource and belong in no configuration snapshot.
- `config_resource_check_coverage` — every `monitor_checks` row mapped onto a resource,
  with `match_basis`, `confidence` and the exact string it `matched_on`.
- `config_resource_samples` — live read-only verification evidence. **Shape only:** property
  names and property→JSON-type. No tenant values are ever stored.
- `config_model_extractions` — provenance per run.
- `config_resource_property_model` (view) — one queryable property model per resource,
  unioning both sources and excluding connection parameters. This is the shape #1795
  should read.

---

## How the configuration surface is scoped

Graph v1.0 declares 3,864 types and 72 top-level container entries. Most of that is not
tenant configuration. The scope named by #1794 is identity, policy, device management,
groups, sharing and security — explicitly **not user data, mail content or files**.

`scripts/config-state/sources.mjs` encodes that as data rather than judgement:

- `CONFIG_SURFACE_ROOTS` — the container roots that are in scope, each mapped to its
  surface bucket.
- `EXCLUDED_ROOTS` — the roots excluded **with the reason recorded**, so the exclusion is
  auditable rather than a silent omission (`drives`/`shares` are file content; `chats` and
  `communications` are message and call records; `me` is a delegated-only shortcut an
  app-only collector never uses; `education` is out of platform scope; and so on).
- `EXCLUDED_PATH_SEGMENTS` — the per-user/per-item data planes that hang off configuration
  containers and are never expanded.

Paths are then walked from those roots through **containment** navigation properties.
Recursion continues only through single-valued containment (`/policies/crossTenantAccessPolicy/…`);
a collection-valued one *is* the resource, and recursing into it would only produce
per-item paths.

Bound OData **Functions** are included as read paths; **Actions** never are. OData draws
that line for us: a Function is side-effect-free and GET-addressable, an Action mutates and
is POST-only. That is what makes `/reports/getEmailActivityUserDetail` a first-class
resource instead of collapsing onto the bare `/reports` root — and it is a structural
guarantee that a "read the tenant's configuration" model can never suggest a write.

---

## What the first extraction measured

Extraction run of **2026-08-30**, Microsoft365DSC commit `f79f2971`, reconciled against
tenant `1` (`mccawsoft2.onmicrosoft.com`).

**Inputs**

| | |
|---|---|
| Graph v1.0 types | 3,864 |
| Graph beta types | 7,738 |
| Addressable configuration paths (v1.0 569 + beta 1,049) | 1,618 |
| Published Graph permissions | 818 (2,502 distinct app-only GET paths) |
| Microsoft365DSC resources | 536 |
| Granted app-only scopes on the testbed | 30 (29 Graph + `Sites.FullControl.All`) |

**Model**

| | |
|---|---|
| Configuration resources | **1,539** |
| Property definitions | 22,565 (17,548 excluding DSC connection parameters) |
| Origin: Graph metadata only / Microsoft365DSC only / both | 1,004 / 481 / 54 |

By read transport: `graph` 1,277 · `powershell` 211 · `sharepoint-admin` 23 ·
`azure-rm` 22 · `power-platform` 6.

By availability against the testbed's real grants: `available_now` **594** ·
`needs_additional_scope` 505 · `unknown` 414 · `unavailable` 22 · `needs_license` 4.

### Coverage — the measured answer to "are we missing checks"

All **157** `monitor_checks` rows were mapped onto the model:

| Match basis | Checks |
|---|---|
| `graph-path-exact` | 126 |
| `ps-cmdlet` | 15 |
| `graph-root` (matched only at the container root — low confidence) | 7 |
| `graph-path-prefix` | 5 |
| `sp-operation` | 1 |
| `dns` (public DNS; no Graph or DSC resource exists to map onto) | 1 |
| `unmatched` | 2 |

**62 of 1,539 resources (4.0%) are touched by at least one check. 1,477 are entirely
uncovered.**

**Since #1869 those 1,477 are split rather than lumped together: 1,455 `uncovered` (a
transport exists; nobody has written the check) and 22 `no_executor` (no transport
exists, so no check could read them whatever anyone writes).** All 22 are `azure-rm`.
Measured against the *reachable* model, coverage is 62 / 1,517 = **4.1%** — which is the
honest denominator, since the 22 cannot be closed by check authoring at all.

That headline number needs reading carefully rather than as a verdict: much of the
uncovered remainder is genuinely low-value (per-item Intune assignment sub-resources,
reporting functions). The actionable figure is **resources that are `available_now` *and*
uncovered** — readable today with permissions already granted, and asked about by nothing:

| Surface | available_now and uncovered |
|---|---|
| device-management | 191 |
| reporting | 143 |
| exchange | 93 |
| directory | 41 |
| compliance | 34 |
| policy | 21 |
| identity | 20 |
| security | 5 |

Coverage by surface (covered / total): applications 3/8 · groups 2/4 · licensing 1/2 ·
identity 9/189 · directory 9/198 · reporting 10/171 · device-management 6/400 ·
security 5/134 · exchange 5/98 · compliance 4/50 · teams 3/82 · policy 2/48 ·
sharing 2/33 · copilot 1/17 · **collaboration 0/58 · integration 0/14 · azure 0/12 ·
power-platform 0/7**.

Note on the last two since #1869: `power-platform` is still 0/7, but it is now 0/7
*reachable* — the transport exists, so those are ordinary closeable gaps. `azure` remains
0/12 with **no executor**, which is a different and larger problem, and deliberately still
open (see "Power Platform transport" below).

The most-covered resources are `/sites` (11 checks), `/groups` (10),
`/identity/conditionalAccess/policies` (9), `/subscribedSkus` (9), `/teams` (9),
`/users` (9).

---

## Live verification — read-only, on a sample

`scripts/config-state/verify-sample.mjs`, run against tenant 1
(`mccawsoft2.onmicrosoft.com`, Entra `c4c814d4-3afe-441e-9145-62461d0a4fd3`,
`is_testbed = true`) — **Shane's real production Microsoft 365 tenant**.

Safety is structural, not procedural:

- `GET` is the only method the file can produce.
- Only `read_transport = 'graph'` resources are attempted; every other transport is
  recorded `not_attempted` with the reason, never invoked speculatively.
- Only paths with no unresolved `{template}` segment are attempted — inventing an object
  id is exactly the probing this issue forbids.
- Bound Functions are excluded: they take required arguments, and calling them without
  would prove nothing about the model.
- `$top=1` on every collection read; requests serialised with a delay.
- The script refuses to run against a tenant not flagged `is_testbed`.
- Only **shape** is stored — property names and JSON types, never values.

**Result: 29 resources sampled across 11 surfaces; 21 returned 200, 8 failed.** Each
failure is recorded with its real Graph error code.

Of the 21 successes, observed properties matched the derived model exactly for 10 of the
12 resources that returned a body — strong evidence the derivation is correct.

### Finding: `$metadata` is not complete, and a snapshot store must not assume it is

Two resources returned properties the model did not predict:

| Path | Undeclared properties observed |
|---|---|
| `/devices` | `createdDateTime`, `domainName`, `extensionAttributes`, `externalSourceName`, `sourceType` |
| `/servicePrincipals` | `createdDateTime` |

`domainName` and `extensionAttributes` are declared in **beta** `$metadata` but returned by
the **v1.0** endpoint. `createdDateTime`, `externalSourceName` and `sourceType` are in
**neither** version's `$metadata`, yet Graph returns them live.

**Consequence for #1795:** a snapshot store typed strictly and closedly from `$metadata`
would silently drop real configuration data. It must preserve undeclared properties.

### Failures observed, with the real error

| Path | Status | Code | Reading |
|---|---|---|---|
| `/roleManagement/directory/roleEligibilitySchedules` | 400 | `AadPremiumLicenseRequired` | Real license gap — needs Entra ID P2 / ID Governance |
| `/auditLogs/signIns` | 403 | `Authentication_RequestFromNonPremiumTenantOrB2CTenant` | Real license gap |
| `/reports/authenticationMethods/userRegistrationDetails` | 403 | `Authentication_RequestFromNonPremiumTenantOrB2CTenant` | Real license gap |
| `/identityProtection/riskDetections` | 403 | `Forbidden` — "tenant is not licensed for this feature" | Real license gap |
| `/deviceManagement/managedDevices` | 401 | `UnknownError` wrapping `Forbidden` | **Not explained by permissions** — `DeviceManagementManagedDevices.Read.All` is granted |
| `/deviceManagement/deviceConfigurations` | 503 | `UnknownError` | Service-side; transient |
| `/informationProtection/policy/labels` (beta) | 404 | `itemNotFound` | Path modelled from beta metadata does not resolve on this tenant |
| `/employeeExperience/engagementAsyncOperations` | 404 | `UnknownError` | Path modelled from metadata does not resolve on this tenant |

The four license gaps are the **only** rows in the whole model carrying
`availability = 'needs_license'`, and each is backed by the live response that produced it.

Everything not sampled keeps `derived_not_verified` (1,119 rows) or, where the skip was
deliberate, `not_attempted` with the reason (391 rows). **No coverage is claimed for
anything that was not sampled.**

---

## #1865 — PowerShell reconciliation against the real capability survey (2026-08-30)

**This is a new section recording a reversal, not an edit of the numbers above.** The
"What the first extraction measured" and "Live verification" sections above are the
honest record of the **2026-08-30 initial extraction** (Git #1794) and are left as they
were written. Everything below is what changed when #1865 re-ran the pipeline against
real data #1794 didn't have yet.

### The claim this issue existed to check

#1794's own "Known limits" said: *"`ps_capability_survey_results` was empty at
extraction time... re-running `build-resource-model.mjs` afterwards will pick it up
automatically."* **That claim was false.** `build-resource-model.mjs` contained zero
references to `ps_capability_survey_results` or the survey tables at all — re-running it
as-is would have reproduced the exact same unreconciled 211 `powershell` resources,
forever. #1865 built the reconciliation that claim assumed already existed:
`scripts/config-state/reconcile-ps-survey.mjs`, wired into the pipeline as a new step
between building `config_resources` and mapping the check catalog. This is code, not a
schema change — no new tables or columns.

### `ps_capability_survey_results` was verified populated before anything else ran

`SELECT run_id, count(*) FROM ps_capability_survey_results GROUP BY run_id` returned
run 4 = **1,166 rows**, matching #1793's own reported per-session breakdown
(`compliance` 126, `exchange` 365, `teams` 675) exactly. #1793 did not fail; the table is
real. Run 4 (`ca-ps-execution-dev--survey1793d`, `status = 'completed'`) is the run
reconciled against — the same run #1793's own comment identifies as "the one rendered."

### Reconciliation rule (evidence discipline, not a heuristic upgrade)

For each of the 211 `powershell`-transport resources, its `read_cmdlets` (from
Microsoft365DSC) are matched against the survey's real per-cmdlet results:

- **≥1 cmdlet surveyed `ok`** → live proof the app-only read path genuinely works.
  Overrides a derived `unknown` / `needs_additional_scope` verdict UP to
  `available_now`, sets `verification_status = 'verified_live'`, and names the exact
  cmdlet(s) in `availability_reason`. Never downgrades an already-`available_now` row —
  it only adds live confirmation (`notes`).
- **≥1 cmdlet surveyed `access_denied` / `not_supported_app_only` / `cmdlet_unavailable`,
  none `ok`** → live proof it does *not* work app-only. Downgrades to `unavailable`,
  `verification_status = 'failed_live'`. (Zero resources hit this path against run 4 —
  logged for when a future run's results differ.)
- **Matched but only `error` / `not_attempted`** → inconclusive. Availability is left
  exactly as derived; `notes` records what the survey actually returned instead of
  silently looking reconciled.
- **None of the resource's cmdlets appear in the survey's cmdlet catalog at all** →
  labelled unreconciled in `notes`, availability untouched.

### The real before/after delta

Two real extraction runs in `config_model_extractions`: **run 6** (the last pre-#1865
state, captured live before this session changed anything) and **run 7** (post-#1865,
same Graph/DSC inputs — `m365dsc_commit f79f2971`, same 30 granted scopes, same 154/3
check mapping — with PS reconciliation now wired in).

| | Run 6 (pre-#1865) | Run 7 (post-#1865) | Δ |
|---|---:|---:|---:|
| `available_now` (all 1,539) | 594 | **658** | +64 |
| `needs_additional_scope` | 505 | 502 | −3 |
| `unknown` | 414 | 357 | −57 |
| `unavailable` | 22 | 22 | 0 |
| `needs_license` | 4 | **0** | −4 (see regression below — not a correction) |
| `available_now` AND uncovered (readable today, asked about by nothing) | 554 | **612** | +58 |

**PowerShell-transport only** (211 resources), the actual reconciliation:

| | Before | After | Δ |
|---|---:|---:|---:|
| `available_now` | 138 | **198** | **+60** |
| `needs_additional_scope` | 12 | 9 | −3 |
| `unknown` | 61 | 4 | −57 |

Exact reconciliation-function counts for the 211: **60 upgraded** to `available_now`
(from a mix of `unknown` and `needs_additional_scope` — the −57/−3 rows above are the
per-verdict breakdown), **105 confirmed** already-`available_now` with new live
evidence, **0 downgraded**, **14 inconclusive** (matched a survey cmdlet but got
`error`/`not_attempted`, left as derived), **32 not reconciled** (no cmdlet in the
survey's catalog at all — see finding below).

The `teams` surface moved from 0 `available_now`-and-uncovered (not listed in #1794's
table at all) to **58** — the single largest driver of the +58 uncovered-and-actionable
figure. Teams DSC resources use `Get-Cs*` cmdlets and declare no RBAC roles, so
#1794's derivation fell through to `unknown`; the survey proves 58 of them work
app-only. Updated `available_now`-and-uncovered by surface: device-management 191 ·
reporting 143 · exchange 93 · **teams 58** · directory 41 · compliance 36 · policy 21 ·
identity 20 · security 5 · groups 2 · sharing 1 · other 1.

### A regression this re-run caused, left uncorrected on purpose

`build-resource-model.mjs` does `DELETE FROM config_resource_samples` before rebuilding
`config_resources` from scratch — **every** re-run, not just this one. #1794's live
`verify-sample.mjs` sample (29 resources, 21 successes / 8 failures) lived only in that
table, and re-running the extraction per this issue's own instructions wiped it,
including the four real license-gap verdicts documented above in "Failures observed":
`/roleManagement/directory/roleEligibilitySchedules`, `/auditLogs/signIns`,
`/reports/authenticationMethods/userRegistrationDetails`,
`/identityProtection/riskDetections`. All four now read `available_now` in the live
model — **wrong**, per this same document's own recorded live evidence three sections
up. `resolveAvailability()` never emits `needs_license` itself; only `verify-sample.mjs`
does, from a real Graph response, and that evidence is gone until `verify-sample.mjs` is
re-run. **Re-running it is exactly "re-deriving the Graph half," which this issue's
scope explicitly forbids, so it was not run.** Filed as #1895 rather than worked around.

**Resolved 2026-08-30 (#1895).** `config_resource_samples` is no longer deleted by
`build-resource-model.mjs`, and no longer even reachable by cascade — it now keys on the
stable `resource_key` text column instead of the volatile `config_resources.id`,
matching the precedent `config_resource_property_divergence` and `config-snapshots.ts`
already set. Every rebuild now calls `reconcile-live-evidence.mjs` to re-apply
`verified_live` / `failed_live` / `needs_license` from the surviving samples onto the
freshly-derived rows. Live-verified after a real end-to-end rebuild run: all 29 sample
rows survived, and all four resources above correctly read `needs_license` again.

### Findings filed (milestone v1.1, board status "AI Batter Up")

- **#1895** → #1850 — `build-resource-model.mjs` wholesale-deletes
  `config_resource_samples` on every re-run with no safeguard, silently discarding
  `verify-sample.mjs`'s accumulated live evidence (including all `needs_license`
  verdicts, which only that script can set). Live-caused regression above is the
  evidence.
- **#1896** → #1850 — 12 of the 32 unreconciled `powershell` resources cite
  `Get-MSCloudLoginConnectionProfile` (an M365DSC-internal connection helper, not a
  real session cmdlet) as their `read_cmdlets` value. `parse-m365dsc.mjs`'s psm1-body
  fallback (used for the 142 DSC resources with no declared `commands` block) is
  picking up the connection-setup call instead of the real read cmdlet for at least
  these 12.

### Housekeeping fix (not a finding — fixed in this session)

`scripts/config-state/fetch-sources.mjs`'s `tar` invocation failed outright on this
Windows worktree (`Cannot connect to C: resolve failed`, then a raw MSYS argv-mangling
error) because the `tar` resolved on `PATH` is Git Bash's GNU tar, which needs a POSIX
path and misreads a bare Windows path's drive-letter colon as a remote-host prefix.
Fixed with `--force-local` plus a `toMsysPath()` conversion on the two path arguments.
Verified by deleting the extracted tree and re-running from scratch twice.

<!-- BEGIN: generated by scripts/config-state/render-property-divergence-doc.mjs (Git #1846) -->

## #1846 — Persisting the $metadata-vs-observed divergence (generated)

The "Finding" section above records what the 2026-08-30 extraction found; it is a point-in-time doc edit and is left as-is. This section is its durable twin: generated from `config_resource_property_divergence`, a table `scripts/config-state/detect-property-divergence.mjs` recomputes every time `verify-sample.mjs` runs, so a property Graph starts returning after this date shows up here on the next sample rather than needing someone to remember to re-run a query.

As of the last detection run (2026-08-30T08:52:31.286Z): **6 observed-but-undeclared properties** across the whole sampled surface — **2 version_gap**, **4 undeclared_anywhere**.

Two classes, because they carry different implications for #1795's snapshot store:

- **`version_gap`** — declared in the *other* Graph version's `$metadata` (in every case observed so far, beta declares it and v1.0 does not), just not the version this resource is actually read under. A versioning gap, not a surprise: Microsoft published it somewhere.
- **`undeclared_anywhere`** — declared in **neither** v1.0 nor beta `$metadata`. Graph is returning something no published CSDL document describes at all. This is the class nobody can anticipate from reading `$metadata`, and the reason this table exists.

### `version_gap` — declared elsewhere, not here

| Resource | Property | Declared in | Observed type | First seen | Last confirmed |
|---|---|---|---|---|---|
| `graph:v1.0:/devices` | `domainName` | beta | null | 2026-08-30T08:48:14.882Z | 2026-08-30T08:50:44.738Z |
| `graph:v1.0:/devices` | `extensionAttributes` | beta | object | 2026-08-30T08:48:14.885Z | 2026-08-30T08:50:44.742Z |

### `undeclared_anywhere` — Graph returning something no `$metadata` describes

| Resource | Property | Observed type | First seen | Last confirmed |
|---|---|---|---|---|
| `graph:v1.0:/devices` | `createdDateTime` | string | 2026-08-30T08:48:14.866Z | 2026-08-30T08:50:44.729Z |
| `graph:v1.0:/devices` | `externalSourceName` | null | 2026-08-30T08:48:14.888Z | 2026-08-30T08:50:44.746Z |
| `graph:v1.0:/devices` | `sourceType` | null | 2026-08-30T08:48:14.891Z | 2026-08-30T08:50:44.751Z |
| `graph:v1.0:/servicePrincipals` | `createdDateTime` | string | 2026-08-30T08:48:14.895Z | 2026-08-30T08:50:44.755Z |

**Not fixed, on purpose.** None of the properties above were added to `config_resource_properties` as though `$metadata` declared them — doing so would erase the very distinction this table exists to preserve. #1795's snapshot store is the place this changes behavior: it must stay open (store the real response object), never typed or filtered strictly to the declared property set.

Reproduce or extend the check:

```bash
node scripts/config-state/verify-sample.mjs          # live sample + detection, wired together
node scripts/config-state/detect-property-divergence.mjs   # re-detect only, from the existing sample
```

```sql
SELECT resource_key, property_name, divergence_class, declared_in_graph_versions,
       observed_json_type, observation_count, last_observed_at
  FROM config_resource_property_divergence
 ORDER BY divergence_class, resource_key, property_name;
```

<!-- END: generated by scripts/config-state/render-property-divergence-doc.mjs (Git #1846) -->

## Running it

```bash
# 1. Cache the three published sources (records the exact M365DSC commit)
node scripts/config-state/fetch-sources.mjs

# 2. Build the model, reconcile permissions, map the check catalog
node scripts/config-state/build-resource-model.mjs [--tenant 1]

# 3. Live read-only sample (testbed only; refuses a non-testbed tenant)
node scripts/config-state/verify-sample.mjs [--per-surface 3]
```

Steps 1 and 2 need no tenant credentials at all. Step 3 uses the read app
(`MT_APP_CLIENT_ID` / `MT_APP_CLIENT_SECRET`).

## Reading it

- **API:** `GET /api/admin/config-resources` (filterable list),
  `/summary` (roll-up + provenance), `/:id` (one resource with its property model, its
  mapped checks and its live samples). All `requireAdmin`, all read-only.
- **UI:** Admin panel → Delivery → Monitoring → **Config Resource Model**
  (`/delivery/config-resources`).
- **SQL:** the tables above, plus `config_resource_property_model`.

Useful queries:

```sql
-- Readable today, asked about by nothing — the actionable coverage gap
SELECT surface, workload, display_name, property_count
  FROM config_resources
 WHERE availability = 'available_now' AND check_coverage_count = 0
 ORDER BY surface, display_name;

-- What a snapshot of one resource has to be able to hold
SELECT property_name, data_type, is_collection, allowed_values
  FROM config_resource_property_model
 WHERE resource_key = 'graph:v1.0:/policies/authorizationPolicy'
 ORDER BY source, ordinal;

-- Exactly which scope is missing, and for how many resources
SELECT m.permission, count(*)
  FROM config_resources r, jsonb_array_elements_text(r.missing_permissions) AS m(permission)
 WHERE r.availability = 'needs_additional_scope'
 GROUP BY 1 ORDER BY 2 DESC;
```

## Known limits

- **55 of 536 Microsoft365DSC resources are linked to a Graph path.** The rest stand as
  their own rows. That is correct, not a shortfall: the unlinked majority are Exchange,
  Purview, Teams and Power Platform resources that have no Graph path to link *to*. A
  link is only recorded where the evidence supports it — a literal Graph URI in the
  resource's own module, or an exact entity-type-name match — and `link_basis` says which.
- **414 resources sit at `unknown` availability.** These are Graph-metadata-derived paths
  that neither Microsoft365DSC nor Microsoft's permissions reference documents a read
  permission for. Establishing those would need probing, which this issue forbids.
- ~~**`ps_capability_survey_results` was empty at extraction time**, so PowerShell
  resources are not reconciled against real cmdlet availability. #1793 is the sibling
  survey that fills it; re-running `build-resource-model.mjs` afterwards will pick it
  up.~~ **Superseded by #1865** — see the section below. That last sentence was untrue
  as written: nothing in `build-resource-model.mjs` referenced the survey table until
  #1865 built the reconciliation. It has now run against the real survey.
- **The sample is 29 resources.** It was chosen to be representative across surfaces, not
  exhaustive. Everything else is labelled accordingly.

---

## #1929 — excluding bound Graph Functions from the coverage denominator and property roll-up

**This is a new section, not an edit of the figures above.** Everything in "What the
first extraction measured" and "#1865 — PowerShell reconciliation" is left exactly as it
was written — the honest record of what each of those runs measured. This section
records what changed when #1929 corrected how the model is *counted*, not re-derived it.

### The problem

129 of the 1,539 `config_resources` rows are bound OData **Functions**
(`graph_container_kind = 'function'`) — `/reports/getPrinterArchivedPrintJobs`,
`/deviceManagement/getEffectivePermissions`, and similar. A Function is an *operation*
that computes an answer on demand, not persistent tenant configuration: there is no
stored object to snapshot or diff, no key to pair it across two points in time, and many
require parameters that make an unparameterized read meaningless. 44 of the 129 carry
zero property rows at all — the model's per-resource property model quietly averaged
over rows that describe nothing.

#1795's snapshot registry already excluded them (commit `80c07204a`,
`graph_container_kind = 'function'` registered non-collectable) — but `config_resources`
itself, and everything counting against it, did not.

### The fix

Taking the issue's first option — **keep, but mark** — matching the precedent #1795's
registry already set:

- `isOperationResource()` / a fifth `coverageState` value, `operation` (added to
  `coverageStateFor()` in `lib/db/src/schema/config-state.ts`, alongside `covered` /
  `uncovered` / `no_executor` / `unavailable`). `operation` is evaluated **first**, ahead
  of `no_executor` and `unavailable` — a bound Function is not configuration state at
  all, so no transport, availability or check-count fact about it can make it "covered"
  or "uncovered".
- `GET /api/admin/config-resources/summary` (`artifacts/api-server/src/routes/admin-config-resources.ts`)
  now returns `totals.resourcesOperations`, `totals.operationProperties` and
  `totals.resourcesCoverageEligible` (`resources − resourcesOperations`), and excludes
  function-kind rows from `resourcesCoveredByAtLeastOneCheck`, `resourcesEntirelyUncovered`,
  `resourcesWithNoExecutor`, `resourcesUnavailable` and `properties`.
- `GET /api/admin/config-resources` gained a fifth `coverage=operation` filter value, and
  every returned row's `coverageState` now reflects the new precedence.
- The Config Resource Model admin UI (`artifacts/admin-panel/src/pages/ConfigResourceModel.tsx`)
  gained an "Operations (excluded)" stat tile, an `operation` coverage badge, and computes
  its coverage percentage against `resourcesCoverageEligible` rather than the raw total.
- Functions are **not dropped** from `config_resources` — they remain real, queryable
  rows, discoverable as reachable read endpoints. Only the coverage/property-count math
  excludes them.

### The real, corrected denominator and property-count figures

Live query against local Postgres, 2026-09-04, against the same `run_id
5a714586-b19c-4675-84fe-e38da3ee1245` extraction the figures above were measured from
(154 checks mapped, 3 unmatched — unchanged by this fix, since it only changes what is
*counted*, not the model itself):

```sql
SELECT
  count(*)::int AS total_resources,
  count(*) filter (where graph_container_kind = 'function')::int AS operations,
  count(*) filter (where graph_container_kind is distinct from 'function'
    and read_transport in ('graph','powershell','sharepoint-admin','dns','azure-rm','power-platform')
    and availability != 'unavailable' and check_coverage_count > 0)::int AS covered,
  count(*) filter (where graph_container_kind is distinct from 'function'
    and read_transport in ('graph','powershell','sharepoint-admin','dns','azure-rm','power-platform')
    and availability != 'unavailable' and check_coverage_count = 0)::int AS uncovered,
  count(*) filter (where graph_container_kind is distinct from 'function'
    and read_transport not in ('graph','powershell','sharepoint-admin','dns','azure-rm','power-platform'))::int AS no_executor,
  count(*) filter (where graph_container_kind is distinct from 'function'
    and read_transport in ('graph','powershell','sharepoint-admin','dns','azure-rm','power-platform')
    and availability = 'unavailable')::int AS unavailable,
  coalesce(sum(property_count) filter (where graph_container_kind is distinct from 'function'), 0)::int AS total_properties,
  coalesce(sum(property_count) filter (where graph_container_kind = 'function'), 0)::int AS operation_properties
FROM config_resources;

 total_resources | operations | covered | uncovered | no_executor | unavailable | total_properties | operation_properties
------------------+------------+---------+-----------+-------------+-------------+------------------+----------------------
             1539 |        129 |      90 |      1296 |           6 |          18 |            17311 |                  237
```

(90 + 1,296 + 6 + 18 + 129 = 1,539 — every resource lands in exactly one bucket. This is
the real five-way split with both #1917's `unavailable` state and #1929's `operation`
exclusion live together. `no_executor` (6, not 4) and the newly-broken-out `unavailable`
(18) reflect #1917's own reclassification of specific `azure-rm` resources that happened
between the earlier query in this document and this one — not something #1929 changed;
this section only adds the `operation` exclusion on top.)

| | Including operations (old, wrong denominator) | Excluding operations (#1929, corrected) |
|---|---:|---:|
| Resources | 1,539 | **1,410** (`resourcesCoverageEligible`) |
| Property definitions (excl. DSC connection parameters) | 17,548 | **17,311** |
| Property definitions (raw, incl. connection parameters) | 22,565 | **22,328** |
| Covered by ≥1 check | 90 / 1,539 = 5.8% | **90 / 1,410 = 6.4%** |
| Covered against the *reachable* model (excludes `no_executor` and `unavailable` too) | 90 / 1,515 = 5.9% | **90 / 1,386 = 6.5%** |

This document's earlier "1,539 resources / 22,565 properties" and "62/1,539 (4.0%)" /
"62/1,517 (4.1%)" claims (from the 2026-08-30 initial extraction) were always counting
129 rows that describe an operation, not configuration — those percentages understated
real coverage and inflated the property-count claim on rows with nothing to model. (The
`covered` count has also independently moved from 62 to 90 between that extraction and
this query — a separate change in `check_coverage_count`/mapping, not something this
issue caused or investigated; this section only corrects what is *counted*, not why the
mapping changed.) **If this section and the database disagree, the database is right** — re-run the
query above.

44 of the 129 function rows carry zero property rows at all; `operation_properties`
(237) above is the property total the remaining 85 functions carry (e.g.
`getGroupArchivedPrintJobs`'s response shape). Neither figure is folded into the
corrected 17,311/22,328 property totals — they are reported separately, not dropped.

---

## Power Platform transport — how app-only auth actually works (#1869)

Established from Microsoft's published documentation and Microsoft365DSC's own
implementation, then **proven live against the testbed tenant, read-only, 2026-08-30**.
Nothing in this section is inferred.

### The facts

| | |
|---|---|
| Resource / audience | `https://service.powerapps.com/` |
| Scope | `https://service.powerapps.com/.default` |
| Token endpoint | `https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token` |
| Admin API host (commercial cloud) | `api.bap.microsoft.com` |
| DLP policy read | `GET /providers/Microsoft.BusinessAppPlatform/scopes/admin/apiPolicies?api-version=2016-11-01` |
| Environments read | `GET /providers/Microsoft.BusinessAppPlatform/scopes/admin/environments?api-version=2024-05-01` |
| Tenant settings read | `GET /providers/Microsoft.BusinessAppPlatform/scopes/admin/listTenantSettings?api-version=2020-10-01` |
| Credential type | **client secret is sufficient** |

Provenance: `MSCloudLoginAssistant/WorkloadEndpoints.psd1` → `PowerPlatformREST.default`;
`Workloads/PowerPlatformREST.ps1` → `SupportedAuthMethods` includes
`ServicePrincipalWithSecret`; `Microsoft365DSC/DscResources/MSFT_PPAdminDLPPolicy/MSFT_PPAdminDLPPolicy.psm1`
→ the `apiPolicies` read (both repos, `Dev` branch, read 2026-08-30).

### Two things that surprised the model, both load-bearing

**1. A client SECRET works — no certificate.** This is the opposite of
`sharepoint-admin`, which rejects secret-based app-only tokens outright and mandates a
certificate assertion. `power-platform-admin.ts` therefore requires only
`MT_APP_CLIENT_ID` + `MT_APP_CLIENT_SECRET`, and must not be "hardened" to demand the
cert env vars — that would gate the surface on a credential it does not use.

**2. The gate is not a permission — it is tenant-side enrolment.** The BAP admin API does
**not** authorise by Entra application permission. There is no `.default` scope, app role
or admin-consent grant that unlocks it, which is why no amount of Graph consent ever
reached these 6 resources. The service principal must be registered once per tenant as a
Power Platform *management application*, via either:

- PowerShell: `New-PowerAppManagementApp -ApplicationId <MT_APP_CLIENT_ID>`
- REST: `PUT https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/adminApplications/{clientId}?api-version=2020-10-01`

Microsoft documents that **a service principal cannot register itself** — "by design, an
administrator using username and password context must register the application". So the
platform structurally cannot automate this away.

### What was proven live

Against `mccawsoft2.onmicrosoft.com` (`tenants.id = 1`,
`c4c814d4-3afe-441e-9145-62461d0a4fd3`), read-only:

- **Token acquisition SUCCEEDS** with the *existing* multi-tenant app registration and its
  *existing* client secret — HTTP 200, `aud = https://service.powerapps.com`,
  `tid = c4c814d4-…`. **No new app registration and no new credential is required.**
- **Every BAP admin read then returns HTTP 403**, with the message *"The service principal
  with id … does not have permission to access the path … in tenant …"* — the
  unregistered-management-app signature, not a scope or credential fault. The write app
  (`MT_APP_WRITE_CLIENT_ID`) returns the identical 403, confirming it is not app-specific.
- Therefore **the tenant's real DLP posture is not yet observable**, and this document does
  not claim one. "No DLP policy exists" and "we cannot see the policies" are different
  statements; only the second is currently supported by evidence.

`PowerPlatformNotRegisteredError` carries this as its own error state so it is never
conflated with revoked consent, a licence gap, or an empty result — and, like
`SharePointAuthError`, it never flips the tenant's Graph consent rows.

Re-run the verification any time with:

    node artifacts/api-server/node_modules/.bin/tsx scripts/verify-power-platform-1869.mts

### Response shapes

The `PowerPlatformDlpPolicy` interface in `power-platform-admin.ts` mirrors the fields
Microsoft365DSC's own `MSFT_PPAdminDLPPolicy` reads (`properties.displayName`,
`properties.definition.constraints.environmentFilter1.parameters.{environments,filterType}`).
It is **sourced from that implementation, not from a captured payload** — the live shape
cannot be observed until the enrolment above is done, and the interface is labelled
accordingly rather than presented as verified.

### Scope boundary

`azure-rm` (22 resources) is **not** answered by #1869 and still has no executor. Its
scope question is genuinely open — it is a different resource (ARM), a different token
audience, and different RBAC roles (`Billing Reader` and siblings). It stays
`no_executor` in the coverage measurement, which is the accurate state.
