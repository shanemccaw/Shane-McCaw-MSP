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

- `read_transport` — `graph` · `powershell` · `sharepoint-admin` · `dns` · `azure-rm` ·
  `power-platform` · `unknown`. The first four mirror `MONITOR_CHECK_EXECUTOR_TYPES` so
  the model and the monitor catalog stay on one vocabulary. The rest are real transports
  Microsoft365DSC uses that this platform has **no executor for at all** — which is itself
  part of the measured answer to "what can we not collect".
- `graph_version` + `graph_path` + `graph_container_kind` — the addressable read.
- `read_cmdlets` — the PowerShell read path where there is one.
- `availability` — see below.
- `verification_status` — `verified_live` · `failed_live` · `not_attempted` ·
  `derived_not_verified`.
- `check_coverage_count` — how many `monitor_checks` rows touch this resource. `0` means
  entirely uncovered.

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
- **`ps_capability_survey_results` was empty at extraction time**, so PowerShell resources
  are not reconciled against real cmdlet availability. #1793 is the sibling survey that
  fills it; re-running `build-resource-model.mjs` afterwards will pick it up.
- **The sample is 29 resources.** It was chosen to be representative across surfaces, not
  exhaustive. Everything else is labelled accordingly.
