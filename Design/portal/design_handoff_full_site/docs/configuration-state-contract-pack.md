# Configuration State — Contract Pack and Design Brief

**Git #1844.** Parent epic #1096 (Application Core), with the customer half landing in the
portal (#1485) and the operator half in the MSP operator surface (#1571).

**Written after the code, deliberately.** The chain is #1793 (resource model) → #1795
(snapshot store) → #1796 (collector) → #1797 (differ) → #1843 (the API surface) → this
document. Thirteen contract packs on this platform were written before their endpoints
existed; they documented absence, and the designs drawn from them produced empty-state UI.
Everything below was extracted on **2026-08-31** from the route files, the Drizzle schema,
and the real local PostgreSQL database. Where a capability is absent it says so plainly and
names the issue, rather than describing what ought to be there.

**Visual foundation is [`docs/design-system.md`](design-system.md).** Colours, severity
ramp, glass/glow vocabulary and the six-pillar identity system all live there and are not
restated or forked here. This document is data only.

**`Design/portal/` is the live design source, and it is empty.** As of 2026-08-31 it
contains only `.gitkeep`. No page in this pack has a `.dc.html` export, so no page in it has
a design yet. That is the expected state at this point in the order — this pack is the input
to Claude Design, not the output of it.

---

## 0. How to read this document

### 0.1 The one distinction the whole product rests on

Every screen described here has to keep four facts apart that a naive design collapses into
one:

| Fact | Means | Never renders as |
|---|---|---|
| **collected** | We read it and there are objects | — |
| **empty** | We read it and the tenant genuinely has zero of these | "unavailable", "error" |
| **skipped / failed** | We could not read it | `0`, "none", red |
| **no snapshot at all** | Nobody has looked yet | an empty document |

A count of `0` on a `failed` resource is not a statement about the customer. It is a
statement about our own reach. **A missing value renders as unavailable — never as zero,
never as red.** The API never omits the unreadable half: every response in this subsystem
carries a `completeness` object precisely so this distinction survives to the screen.

### 0.2 Two subsystems that sound alike and are not

- **Configuration state** (this pack): `tenant_config_snapshots` / `config_diffs`. A
  whole-tenant, point-in-time snapshot of ~1,359 resource types, and structural comparison
  between two of them. Served on `/api/portal/config-state/*` and `/api/msp/config-state/*`.
- **Drift domains** (`drift.*` metrics, `drift_events`, `drift_collection_status`): a
  separate, much narrower monitor-check-driven subsystem with 18 named domains. **5 have a
  producer today; 13 do not** — see §8. It is not served by any endpoint in this pack.

Do not merge them in a design. They have different tables, different keying (config state is
keyed on `tenants.id`, drift is keyed on the text M365 tenant GUID), and very different
coverage.

---

## 1. Audience split, endpoint by endpoint

The customer reads their own tenant. The operator reads across their book and holds every
management action. **There is no customer-side write in this subsystem at all** — not a
trigger, not a baseline, not a rule.

| # | Customer read (`/api/portal/config-state/*`) | Matching operator capability (`/api/msp/config-state/*`) |
|---|---|---|
| 1 | `GET /snapshots` — my snapshot history | `GET /snapshots?tenantId=` — history across the book; `GET /tenants` — who has been collected at all, and how stale |
| 2 | `GET /snapshots/current` — my configuration now | `GET /tenants` gives the same header for every customer at once |
| 3 | `GET /snapshots/:id` — one snapshot as a completeness document | `GET /snapshots/:id` — same document plus `tenantName`, `entraTenantId`, `triggerRef`, `wfRunId`, `requestedByUserId` |
| 4 | `GET /snapshots/:id/objects?resourceKey=` — the real stored objects | `GET /snapshots/:id/objects?resourceKey=` — identical, book-scoped |
| 5 | `GET /changes` — what changed since last time | `POST /diffs` — four named comparison modes, not just drift |
| 6 | `GET /changes/:diffId` — one comparison | `GET /diffs`, `GET /diffs/:diffId` — comparison history and detail across the book |
| 7 | *(none)* | `POST /collections` — **trigger a collection.** The only producer path. |
| 8 | *(none)* | `GET /collections/:runId` — follow that run, with real workflow node logs |
| 9 | *(none)* | `GET /registry`, `GET /registry/summary` — what this platform can read at all, and what it cannot and why |
| 10 | *(none)* | `GET /baselines`, `POST /baselines`, `PATCH /baselines/:id` — declare / list / retire a known-good reference |
| 11 | *(none)* | `GET /diffs/rules` — the noise ruleset, with the measurement behind each suppression |

**The operator surface has no app directory yet.** `artifacts/msp-console` — named in #1844 —
does not exist in this repository. `artifacts/portal` exists but contains only `index.tsx`
and `not-found.tsx`. Both surfaces are endpoints-only today. Filed as a finding (§11).

### 1.1 Auth and roles

Both routers sit behind `requireRole` (`artifacts/api-server/src/middlewares/requireAuth.ts`),
which is an **ordered ladder**, not a set:

```
Assessment < Free < CustomerUser < ServiceAccount < MSPOperator < MSPAdmin < PlatformAdmin
```

A legacy `role === "admin"` user is treated as `PlatformAdmin`.

- **Portal routes: `requireRole("CustomerUser")`.** Higher than the neighbouring
  `portal-change-control.ts` / `portal-remediation-tracker.ts`, deliberately: those serve
  findings *about* a tenant, this serves the tenant's actual configuration — every
  conditional access policy, every service principal, every transport rule. `Free` and
  `Assessment` are excluded.
- **MSP routes: `requireRole("MSPOperator")`** — MSPOperator, MSPAdmin, PlatformAdmin.

**Tenant scoping is separate from the role floor.**

- Customer: `resolveCustomerId(req)` — the JWT's own `customerId` claim, which **is**
  `tenants.id`. **There is no `?tenantId=` parameter on the portal router and there must
  never be one.**
- Operator: `resolveConfigStateBook(req)`
  (`artifacts/api-server/src/lib/msp-config-state-scope.ts`) resolves the caller to a set of
  tenant ids. `?tenantId=` can only ever **narrow** within that set. An **empty book is a
  legitimate state** (a new MSP with no customers) and returns empty results, never
  everything.

Every diff is entitled on **both** sides: a `tenant_compare` diff's `oldValue` column
literally contains the base tenant's configuration, so head-side entitlement alone would leak
it. In practice a customer is never entitled to both sides of a cross-tenant diff, so those
simply do not resolve on the portal.

An out-of-scope id returns **404, not 403** — a 403 would confirm the id names a real object.

---

## 2. Error responses — two different shapes on the same endpoints

This matters for design because the two shapes are not interchangeable and a client that
only parses one will show a blank error for the other.

**Shape A — the route handlers' own errors** (`apiError`, `lib/api-helpers.ts`):

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": {}, "traceId": "…" } }
```

`details` and `traceId` are both optional and frequently absent. Codes in use on these
routes: `VALIDATION_ERROR` (400), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409),
`INTERNAL_SERVER_ERROR` (500 and the 503 case).

**Shape B — the auth middleware's errors**, which fire *before* the handler:

```json
{ "error": "Insufficient privileges — CustomerUser or above required" }
```

`error` is a bare **string** here. 401 (`"Missing or invalid Authorization header"`,
`"Invalid or expired token"`) and 403 both use this shape.

**Design consequence:** an error renderer must handle `error` being either an object or a
string. Filed as a finding (§11).

### 2.1 Every non-200 in this subsystem

| Status | Code / shape | When |
|---|---|---|
| 401 | Shape B | No/non-Bearer header; expired or invalid token |
| 403 | Shape B | Role below the floor |
| 403 | `FORBIDDEN` | Authenticated but no `customerId` claim on the session (portal only) |
| 400 | `VALIDATION_ERROR` | Bad enum value; missing `resourceKey`; non-integer `tenantId`/`runId`; bad `view`; non-uuid `baselineId`; missing/blank `name`, `retiredReason`; `baselineId` on the wrong mode; a differ refusal (see §6.6) |
| 404 | `NOT_FOUND` | Snapshot/diff/baseline/run/customer not found **or not in scope** |
| 409 | `CONFLICT` | Baseline name already taken for this MSP; baseline snapshot not `sealed`; baseline retired; collection workflow has no published version or hit its concurrency limit |
| 503 | `INTERNAL_SERVER_ERROR` | The `__system__: Tenant Configuration Snapshot` workflow definition is not seeded in this environment |
| 500 | `INTERNAL_SERVER_ERROR` | Unhandled failure; message is per-endpoint prose |

**A refused snapshot pair on `GET /changes` is a 200, not an error** — see §5.5.

---

## 3. The real enums, in full

Every value below is in the code today. There is no display vocabulary here.

**`SNAPSHOT_STATUSES`** — `running` · `sealed` · `failed` · `abandoned`
`sealed` says the snapshot is immutable (enforced by database trigger). It says **nothing**
about completeness — `isComplete` answers that separately. `failed` runs are kept, because a
record of a failed collection is evidence. `abandoned` is set by a later sweep for a run whose
process died (`sweepAbandonedSnapshots`, 6-hour default cut-off) — visible on purpose so a gap
in history has a stated cause.

**`SNAPSHOT_RESOURCE_STATUSES`** — `collected` · `empty` · `partial` · `skipped` · `failed`
The `collected`/`empty` split is the point of the whole table. `partial` means the objects
stored are real but the *set* is not whole (paging truncated or budget exhausted) — a diff
must treat a partial resource's absences as unknown, never as deletions.

**`SNAPSHOT_SKIP_REASONS`** (11) — `permission_denied` · `license_required` ·
`service_not_configured` · `no_executor` · `transport_error` · `cmdlet_unavailable` ·
`not_supported_app_only` · `identity_unresolved` · `not_collectable` · `budget_exhausted` ·
`unknown_error`
Populated on both `skipped` and `failed` rows. `transport_error` is explicitly *not* a
statement about the tenant.

**`SNAPSHOT_TRIGGERS`** — `manual` · `scheduled` · `workflow` · `api`

**`SNAPSHOT_IDENTITY_STRATEGIES`** — `graph-id` · `graph-singleton` · `dsc-identity` ·
`composite-key` · `content-hash` · `unresolved`
`content-hash` is a labelled last resort: a modified object pairs with nothing and reads as a
delete plus an add, which is why `object_unpairable` exists. `unresolved` means the type is
not collectable at all.

**`SNAPSHOT_SHAPE_PROVENANCE`** — `observed_live` · `derived_from_graph_metadata` ·
`derived_from_dsc` · `none`

**`SNAPSHOT_HASH_ALGORITHMS`** — `jcs-sha256` (RFC 8785 canonicalisation, then SHA-256, hex)

**`CONFIG_DIFF_MODES`** — `drift` · `baseline_assessment` · `tenant_compare` · `promotion`

**`CONFIG_DIFF_STATUSES`** — `computing` · `sealed` · `failed`

**`CONFIG_DIFF_TRIGGERS`** — `manual` · `scheduled` · `workflow` · `api`

**`CONFIG_DIFF_COMPARABILITY`** — `comparable` · `partially_comparable` · `not_comparable`

**`CONFIG_DIFF_CHANGE_KINDS`** (10) — `property_changed` · `property_added` ·
`property_removed` · `array_member_added` · `array_member_removed` · `array_reordered` ·
`object_added` · `object_removed` · `object_indeterminate` · `object_unpairable`
`object_removed` is the **only** row that ever means "this was deleted", and it is reachable
only when both sides read successfully. `object_indeterminate` (the resource is only partially
comparable, so the absence is unknown) and `object_unpairable` (a `content-hash` identity, so
a modification is indistinguishable from a delete-plus-add) exist so an absence is never
overstated.

**`CONFIG_DIFF_RULE_ACTIONS`** — `ignore` · `always_report`
**`CONFIG_DIFF_RULE_BASIS`** — `observed_volatile` · `structural_annotation` ·
`operator_declared`

**`CONFIG_BASELINE_PURPOSES`** — `known_good` · `promotion_source`

**`CONFIG_READ_TRANSPORTS`** — `graph` · `powershell` · `sharepoint-admin` · `dns` ·
`azure-rm` · `power-platform` · `unknown`

**`CONFIG_SURFACES`** (20) — `identity` · `directory` · `policy` · `applications` · `groups` ·
`teams` · `collaboration` · `device-management` · `sharing` · `exchange` · `security` ·
`compliance` · `licensing` · `reporting` · `integration` · `copilot` · `power-platform` ·
`azure` · `tooling` · `other`

**`CONFIG_AVAILABILITY`** — `available_now` · `needs_additional_scope` · `needs_license` ·
`unavailable` · `unknown`

**Workload** is *not* a locked enum — it is free text on the registry row. The 17 values
present today are listed in §4.3. A resource key with no registry match is labelled
**`"unregistered"`** by the view layer rather than dropped; a design must render that string.

---

## 4. Real volume and fan-out — measured, not estimated

All figures below were read from the local PostgreSQL database on **2026-08-31**, from the
testbed tenant `tenants.id = 1` (`mccawsoft2.onmicrosoft.com`, `is_testbed = true`). This is
the only tenant that has ever been collected.

### 4.1 The registry — what the platform can read at all

| | Count |
|---|---|
| Registered resource types | **1,539** |
| Collectable | **1,359** |
| Not collectable | **180** |

Not-collectable reasons: `not_collectable` 124 · `no_executor` 28 · `identity_unresolved` 28.

By transport: `graph` 1,125 collectable / 152 not · `powershell` 211 collectable ·
`sharepoint-admin` 23 collectable · `azure-rm` 22 **all** not collectable · `power-platform` 6
**all** not collectable.

By availability: `available_now` 654 · `needs_additional_scope` 502 · `unknown` 357 ·
`unavailable` 22 · `needs_license` 4.

By shape provenance: `derived_from_graph_metadata` 991 · `derived_from_dsc` 351 ·
`observed_live` 152 · `none` 45.

By identity strategy: `graph-id` 697 · `graph-singleton` 552 · `dsc-identity` 234 ·
`unresolved` 28 · `composite-key` 28. **No type uses `content-hash` today**, so no
`object_unpairable` change row is currently reachable.

### 4.2 A real full snapshot — the headline numbers

Snapshot row **10** (`f7ab3e50-f055-435d-85e1-e185db40a8e1`), captured 2026-08-30, the largest
real collection to date:

| | |
|---|---|
| Resource types targeted | **1,359** |
| collected | **93** |
| empty | **62** |
| partial | **1** |
| skipped | **425** |
| failed | **778** |
| Objects stored | **50,176** |
| Distinct resource types actually holding objects | **94** |
| `object_json` total | **34 MB** |
| Largest single object | **173,626 bytes** |
| Mean object | **701 bytes** |
| Wall-clock (captured → sealed) | **3 m 43 s** |
| `readableFraction` | **0.11405445180279618** |

**This is the number a design must be built around: 11.4% of the model is readable on a real,
consented tenant today.** A screen that renders the snapshot as "your configuration" without
foregrounding the other 88.6% is confidently wrong about the customer. (#1848's earlier
"62 of 1,539" figure is superseded: the current split is 93 collected + 62 empty = 155
answered of 1,359 targeted.)

The immediately preceding full snapshot (row 8, same day) had **identical** status counts —
93/62/1/425/778 — and 50,124 objects. The status split is stable run to run; the object count
is not.

**Skip/fail reasons on snapshot 10:**

| Status | Reason | Count |
|---|---|---|
| failed | `unknown_error` | 304 |
| failed | `permission_denied` | 272 |
| skipped | `no_executor` | 228 |
| skipped | `not_collectable` | 197 |
| failed | `license_required` | 174 |
| collected | *(null)* | 93 |
| empty | *(null)* | 62 |
| failed | `transport_error` | 27 |
| partial | `budget_exhausted` | 1 |
| failed | `cmdlet_unavailable` | 1 |

**Real HTTP evidence on the failures** (top of the distribution): `400 BadRequest` 141 ·
`503 intune-backend-iis-503` 79 · `404 UnknownError` 79 · `403 UnknownError` 65 ·
`401 intune-legacy-devicefe-401` 64 · `401 UnknownError` 59 · `403 accessDenied` 36 ·
*(null status, null code)* 32 · `400 UnknownError` 26 · `403 NoLicense` 21 ·
`403 Authorization_RequestDenied` 20 · `403 Forbidden` 17 · `400 AuthenticationError` 15 ·
`500 UnknownError` 15 · `403 AADB2C` 12.

Note the 32 rows with **both `httpStatus` and `errorCode` null** — a failure with no wire
evidence at all. `reasonDetail` is the only thing that explains those.

### 4.3 Per-workload roll-up, snapshot 10

This is exactly what `workloads[]` returns. Sixteen workloads appear on this snapshot; the
registry holds 17.

| Workload | Types | Objects | collected | empty | partial | skipped | failed |
|---|---|---|---|---|---|---|---|
| MicrosoftGraph | 854 | 49,357 | 73 | 45 | 1 | 0 | 735 |
| ExchangeOnline | 99 | 515 | 4 | 0 | 0 | 95 | 0 |
| Microsoft365Admin | 7 | 104 | 1 | 0 | 0 | 6 | 0 |
| SharePointOnline | 23 | 99 | 1 | 0 | 0 | 22 | 0 |
| AzureAD | 96 | 76 | 12 | 15 | 0 | 61 | 8 |
| Teams | 64 | 25 | 2 | 0 | 0 | 62 | 0 |
| Intune | 162 | 0 | 0 | 0 | 0 | 128 | 34 |
| SecurityCompliance | 39 | 0 | 0 | 2 | 0 | 36 | 1 |
| Other | 4 | 0 | 0 | 0 | 0 | 4 | 0 |
| Planner | 3 | 0 | 0 | 0 | 0 | 3 | 0 |
| Defender | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| Microsoft365DSC | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| Azure | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| Commerce | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| Fabric | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| OneDriveForBusiness | 1 | 0 | 0 | 0 | 0 | 1 | 0 |

**Intune is the shape to design for.** 162 resource types, **zero objects**, 128 skipped and
34 failed. The real `reasonDetail` on those rows reads:

> Microsoft Intune is not licensed on this tenant. The only Intune-family entitlement is
> INTUNE_O365 (ENTERPRISEPACK, PendingActivation) — Mobile Device Management for Office 365,
> which is a basic MDM capability and does not include Intune. The Intune endpoints refuse
> with the intune-backend-iis-503 signature. Subscribed SKUs: ENTERPRISEPACK, FLOW_FREE,
> POWER_BI_STANDARD, Power_Pages_vTrial_for_Makers.

A whole workload rendering as "0" with no explanation is the failure this subsystem exists to
prevent. **The workload card must be able to say "unavailable — not licensed", with that
sentence available on drill-down.** This is Git #1847's exact finding, made unrepresentable.

### 4.4 Fan-out — where a single resource type explodes

Object counts are extremely skewed. Three resource types hold **94%** of the 50,176 objects:

| Resource key | Status | Objects | Pages | Duration |
|---|---|---|---|---|
| `graph:v1.0:/applicationTemplates` | collected | **39,089** | 14 | 55,970 ms |
| `graph:v1.0:/schemaExtensions` | **partial** | **4,949** | **50** | 11,023 ms |
| `graph:beta:/auditLogs/auditActivityTypes` | collected | 3,371 | 1 | 3,263 ms |
| `graph:v1.0:/servicePrincipals` | collected | 504 | 6 | 3,628 ms |
| `graph:v1.0:/security/secureScoreControlProfiles` | collected | 460 | 3 | 2,401 ms |
| `graph:v1.0:/admin/serviceAnnouncement/issues` | collected | 214 | 3 | 2,160 ms |
| `graph:beta:/reports/servicePrincipalSignInActivities` | collected | 200 | 1 | 2,893 ms |
| `graph:v1.0:/auditLogs/directoryAudits` | collected | 156 | 1 | 1,513 ms |
| `graph:v1.0:/directoryRoleTemplates` | collected | 145 | 1 | 1,320 ms |
| `graph:v1.0:/roleManagement/directory/roleDefinitions` | collected | 145 | 1 | 577 ms |
| `graph:v1.0:/security/attackSimulation/trainings` | collected | 130 | 3 | 10,496 ms |
| `graph:v1.0:/groups` | collected | 104 | 2 | 557 ms |
| `graph:v1.0:/sites` | collected | 99 | 1 | 616 ms |
| `graph:v1.0:/security/secureScores` | collected | 90 | 1 | 1,374 ms |
| `graph:v1.0:/oauth2PermissionGrants` | collected | 39 | 1 | 412 ms |
| `graph:v1.0:/users` | collected | 24 | 1 | 178 ms |
| `graph:v1.0:/identity/conditionalAccess/templates` | collected | 23 | 1 | 337 ms |

**`graph:v1.0:/schemaExtensions` is the live proof that the truncation this platform has been
bitten by before is real here too.** It hit the collector's page cap at **50 pages** and is
recorded `partial` / `budget_exhausted` — one resource type, one row, silently 5,000 objects
deep. It is exactly the `POSTS_PER_WAVE = 60` failure shape in a different subsystem. A
resource row must show `partial` distinctly from `collected`, or a customer will read a
truncated list as complete.

Note also the long tail: only **94 of 1,359** targeted types hold any object at all, and 24
users / 104 groups / 99 sites means **the objects a customer would actually recognise are a
rounding error next to 39,089 Microsoft-published application templates.** A design that ranks
resource types by object count puts platform noise at the top of the page.

**Collector budgets, from `config-snapshot-collector.ts`:**
`DEFAULT_TIME_BUDGET_MS = 45 min` · `DEFAULT_MAX_PAGES_PER_RESOURCE = 20` (the underlying
`graphFetchPaginated` has its own `NEXT_LINK_MAX_PAGES = 50` safety cap, which is the one
`/schemaExtensions` hit) · `DEFAULT_CONCURRENCY = 4` · `DEFAULT_THROTTLE_RETRIES = 6` at
`2,000 ms` base backoff · `INSERT_BATCH = 250` · `EVIDENCE_BODY_CHARS = 2000` (error bodies
are truncated at 2,000 characters inside `reasonDetail`).

**Object identity distribution on snapshot 10:** `graph-id` 50,108 · `graph-singleton` 50 ·
`dsc-identity` 18. Only **50 singletons** across the entire tenant — the "one object, whole
resource" case that a card layout needs a different treatment for.

### 4.5 Page-size caps — derived from those byte counts

From `config-state-views.ts`. These are not round numbers; each is derived from a measured
byte count.

| Constant | Default | Max | Why |
|---|---|---|---|
| `SNAPSHOT_LIST_PAGE` | 25 | 200 | |
| `RESOURCE_PAGE` | 200 | 1,000 | The completeness document is 1,359 rows — servable in one page, still paginated because 1,359 rows on screen is not a document |
| `OBJECT_PAGE` | **25** | **100** | 100 × the largest observed object (173,626 B) is **17 MB** |
| `CHANGE_PAGE` | 100 | 500 | |
| `REGISTRY_PAGE` | 200 | 1,000 | |

`limit` and `offset` are **clamped, never rejected**: a non-numeric or ≤0 `limit` silently
becomes the default, and a bad `offset` becomes 0. **No endpoint returns a whole snapshot.
34 MB is not a response.**

`?include=summary` on the objects endpoint drops `objectJson` entirely — and is selected
*conditionally in SQL*, not fetched-and-stripped, because on `/applicationTemplates` the JSON
is 27 MB for that one resource.

Every paged response carries the same `paging` object: `{ total, limit, offset, hasMore }`,
where `hasMore` is `offset + limit < total`.

### 4.6 Comparison volume and cost

Four real diffs exist. The one full-vs-full comparison:

**Diff row 9** (`179d15e3-b582-4e90-bb45-f86b2f545ae1`, mode `drift`, snapshot 8 → 10):

| | |
|---|---|
| Resource types compared | **155** |
| partially comparable | **1** |
| not comparable | **1,203** |
| `comparableFraction` | **0.11405445180279618** |
| Objects paired | **50,121** |
| added / removed / indeterminate / unpairable | **52 / 3 / 3 / 0** |
| Changes total / significant / ignored | **340 / 340 / 0** |
| Duration | **32,181 ms** |

Every one of the 1,203 not-comparable rows is `failed`/`failed` (778) or `skipped`/`skipped`
(425) — no mixed pair occurred. **"340 changes" read without "1,203 resource types could not
be compared" is a confidently wrong summary of the tenant**, which is why `GET /changes`
carries `notComparable` at the top level rather than behind a second request.

**Change kinds actually emitted on diff 9:** `property_removed` 162 · `property_changed` 116 ·
`object_added` 52 · `object_indeterminate` 3 · `object_removed` 3 · `property_added` 2 ·
`array_reordered` 2. **Zero ignored.** No `array_member_added`, `array_member_removed` or
`object_unpairable` row has ever been produced on real data.

**Changes are extremely concentrated:** `graph:v1.0:/security/secureScores` alone produced
**273 of 340** (80%). Then `/auditLogs/directoryAudits` 50, `/applications` 8,
`/schemaExtensions` 5, `/admin/serviceAnnouncement/issues` 2, `/servicePrincipals` 1,
`/organization` 1. **Seven resource types produced every change in the tenant.** A flat change
list will be 273 rows of one telemetry resource; grouping by `resourceKey` is not cosmetic
here.

The other three diffs are the degenerate cases and are just as important to design for:

| Diff | Mode | Pair | compared | not comparable | changes | Duration |
|---|---|---|---|---|---|---|
| 7 | `drift` | 8 → 9 | **0** | **1,359** | 0 | 782 ms |
| 10 | `drift` | 9 → 10 | **0** | **1,359** | 0 | 2,630 ms |
| 11 | `baseline_assessment` | 10 → 8 | 155 | 1,203 | 340 | 9,230 ms |

Diffs 7 and 10 pair a full snapshot with a 2-resource smoke snapshot: **nothing was
comparable, and the honest answer is "we could not look", not "no changes".** `changesTotal`
is 0 and `comparableFraction` is 0 in both. A design that renders `changesTotal === 0` as a
green all-clear is wrong for two of the four real diffs on this platform.

Diff 11 is the mirror of diff 9 with base and head swapped: added and removed invert
(3/52 vs 52/3) while `changesTotal` stays 340. Direction is meaningful and must be labelled.

**This is the live state right now.** `latestSealedPair(1)` returns head = snapshot **11**
(2 resource types targeted, both failed) and base = snapshot **10** (1,359 targeted). So a
customer calling `GET /api/portal/config-state/changes` today gets `available: true` with
**0 comparable, 1,359 not comparable, 0 changes.** That is the correct answer and the screen
must read as "we could not compare", not "you're all clear".

### 4.7 Cost of a comparison, and the stampede guard

`GET /api/portal/config-state/changes` computes the diff on first request. The measured cost
of a full comparison over ~50,000 objects is **3.5–4.7 s** in #1797's own live run; the stored
diff 9 recorded **32.2 s** including the write of 340 change rows and 1,359 status rows. Long
enough that a stampede matters and short enough that a queue is the wrong shape — so the route
keeps a per-tenant in-flight `Map` and a page mounting three components starts **one** diff.

`?compute=false` returns only an already-stored comparison, for a caller that would rather
render "not computed yet" than wait. **A design should use it for anything above the fold**
and let the user ask for the computation explicitly.

The result is cached on `(base, head, mode, rulesetFingerprint)`. The current ruleset
fingerprint is `d246a9e1d6dec32b16c22f497e218021a66ae1835c0631ca60dad5430af09151` over 6
active rules; **changing the ruleset invalidates every cached diff**, by design.

`resourceKeys` is deliberately **not** exposed on any route in this pack — Git #2032 found a
resource-scoped recompute silently overwrites a full diff, because `resourceKeys` is not part
of the cache key.

---

## 5. Customer endpoints — full contracts

Mount prefix: `app.use("/api", router)` (`app.ts:115`), routers registered at
`routes/index.ts:531–533`. All paths below are the externally-visible paths.

### 5.1 `GET /api/portal/config-state/snapshots`

Role `CustomerUser`. Scope: JWT `customerId` only.

**Query:** `status?` (one of `SNAPSHOT_STATUSES`, else 400) · `limit?` (def 25, max 200) ·
`offset?`

**Response 200** — real, from the testbed:

```json
{
  "snapshots": [
    {
      "id": 11,
      "snapshotId": "a6e52f60-4161-4b11-8ddf-a6a2eccd4c10",
      "tenantId": 1,
      "tenantName": "Jane Jane",
      "capturedAt": "2026-08-31T12:21:59.727Z",
      "status": "sealed",
      "trigger": "workflow",
      "completeness": {
        "isComplete": false,
        "status": "sealed",
        "capturedAt": "2026-08-31T12:21:59.727Z",
        "resourceTypesTargeted": 2,
        "resourceTypesCollected": 0,
        "resourceTypesEmpty": 0,
        "resourceTypesPartial": 0,
        "resourceTypesSkipped": 0,
        "resourceTypesFailed": 2,
        "objectCount": 0,
        "readableFraction": 0,
        "collectorVersion": "1796.1",
        "error": null
      }
    }
  ],
  "paging": { "total": 7, "limit": 2, "offset": 0, "hasMore": true }
}
```

Ordered by `capturedAt` descending.

Note `readableFraction: 0` above — 2 targeted, 0 answered. **`0` means "we could read none of
it" and must render as unavailable, not as a 0% score.** `null` means nothing was targeted at
all. Neither is renderable as a percentage bar without a caption.

`tenantName` is `string | null` (left join; null if the tenant row vanished).
`collectorVersion` is `string | null`; the real value today is `"1796.1"`. `error` is
`string | null` and is null on all 7 real snapshots.

### 5.2 `GET /api/portal/config-state/snapshots/current`

Role `CustomerUser`. Registered **before** `/:id` so the literal path is not swallowed.

Returns the most recent **sealed** snapshot. `running`, `failed` and `abandoned` are excluded
— a running snapshot's object set is still growing, so serving it would report a
not-yet-collected resource as absent.

**Response 200, no snapshot yet** — a first-class state, not an error:

```json
{
  "snapshot": null,
  "collected": false,
  "reason": "no_sealed_snapshot",
  "detail": "No sealed configuration snapshot exists for this tenant yet. A snapshot is captured by the Tenant Configuration Snapshot workflow; until one has run and sealed, there is nothing to report — which is not the same as reporting that the tenant has no configuration."
}
```

**This is the state of every tenant except `id = 1` today.** `tenants.id = 3`
(`shanemccaw.onmicrosoft.com`) has never been collected. Design this screen first, not last.

**Response 200, snapshot present:**

```json
{
  "snapshot": { "id": 0, "snapshotId": "…", "tenantId": 0, "capturedAt": "…",
                "status": "sealed", "trigger": "manual" },
  "collected": true,
  "completeness": { … },
  "workloads": [ … ],
  "resources": [ … ],
  "paging": { … }
}
```

`?limit`/`?offset` page the `resources` array (def 200, max 1,000). **`workloads` is always
the whole-snapshot roll-up, never the page** — a summary counting only page 1 would say the
tenant had 200 resource types when it targeted 1,359.

### 5.3 `GET /api/portal/config-state/snapshots/:id`

Role `CustomerUser`. `:id` accepts **either** the integer row id **or** the uuid `snapshotId`
— an id pasted out of a log line resolves without translation. Anything that is neither
returns 404.

**Query:** `workload?` (free text) · `status?` (one of `SNAPSHOT_RESOURCE_STATUSES`) ·
`limit?` · `offset?`

Same envelope as §5.2's populated case, minus `collected`, plus **`filtered: boolean`** — true
when `workload` or `status` was supplied, so the reader can see the roll-up covers more than
the rows on screen.

`resources[]` is ordered by `workload` asc, then `resourceKey` asc.

**Real `resources[]` rows** (a 2-row page off snapshot 10):

```json
[
  {
    "resourceKey": "m365dsc:AzureVerifiedIdFaceCheck",
    "displayName": "AzureVerifiedIdFaceCheck",
    "surface": "azure",
    "workload": "Azure",
    "readTransport": "powershell",
    "status": "skipped",
    "skipReason": "no_executor",
    "reasonDetail": "No ps-execution catalog entry invokes this resource's read cmdlet unfiltered — needs Get-AzResourceGroup. cmdletKey resolves only to a code-owned entry in services/ps-execution/cmdlet-catalog.ps1 (#209), so this is unreachable until an unfiltered entry for that cmdlet is added to the container.",
    "objectCount": 0,
    "pageCount": null,
    "httpStatus": null,
    "errorCode": null,
    "durationMs": 0,
    "attemptedAt": "2026-08-31T01:54:58.611Z"
  },
  {
    "resourceKey": "graph:beta:/directory/certificateAuthorities/certificateBasedApplicationConfigurations",
    "displayName": "/directory/certificateAuthorities/certificateBasedApplicationConfigurations",
    "surface": "directory",
    "workload": "AzureAD",
    "readTransport": "graph",
    "status": "failed",
    "skipReason": "permission_denied",
    "reasonDetail": "Authorization_RequestDenied: {\"error\":{\"code\":\"Authorization_RequestDenied\",\"message\":\"Insufficient privileges to complete the operation.\",\"innerError\":{\"date\":\"2026-08-31T01:52:42\",\"request-id\":\"9232b35b-da82-4064-b0f4-94fbe25f39f3\",\"client-request-id\":\"9232b35b-da82-4064-b0f4-94fbe25f39f3\"}}}",
    "objectCount": 0,
    "pageCount": null,
    "httpStatus": 403,
    "errorCode": "Authorization_RequestDenied",
    "durationMs": 119,
    "attemptedAt": "2026-08-31T01:54:57.956Z"
  }
]
```

**`reasonDetail` is long, raw, and often contains a full JSON error body.** It is the honest
answer to "why is this missing" and is the single most important string on the page — but it
is not a caption. It needs a disclosure, not a table cell.

Note `displayName` for a Graph resource is just the path, and `m365dsc:` keys carry a bare
cmdlet-ish name. Neither is a human title; a design that needs one must compose it from
`surface` + `workload` + the key.

**Nullability on a `SnapshotResourceRow`:**

| Field | Type | `null` means |
|---|---|---|
| `surface` | `string \| null` | No registry match for this key |
| `skipReason` | `string \| null` | Null on `collected` and `empty` — the read succeeded |
| `reasonDetail` | `string \| null` | Null on `collected`/`empty`; also null on some skips where the reason alone is the whole answer |
| `pageCount` | `number \| null` | The read never paged (a singleton, or it failed before the first page) |
| `httpStatus` | `number \| null` | Non-HTTP transport, or a failure with no response at all — **32 real rows** |
| `errorCode` | `string \| null` | Same |
| `durationMs` | `number \| null` | Not timed; `0` on a skip that never attempted a call |
| `displayName` · `workload` | `string` | **Never null** — fall back to the raw `resourceKey` and the literal `"unregistered"` |

**Real `workloads[]` entry:**

```json
{ "workload": "AzureAD", "resourceTypes": 96, "objectCount": 76,
  "totals": { "collected": 12, "empty": 15, "partial": 0, "skipped": 61, "failed": 8 } }
```

`totals` always carries all five keys, always numeric, never null. Sorted by `workload` asc.

### 5.4 `GET /api/portal/config-state/snapshots/:id/objects`

Role `CustomerUser`. **`?resourceKey=` is required** — 400 with
*"resourceKey is required — a snapshot holds tens of thousands of objects across the whole
tenant and is not servable in one response"*.

**Query:** `resourceKey` (required) · `include?` = `summary` | `full` (default **`full`**;
anything other than the literal `"summary"` is treated as `full`) · `limit?` (def **25**, max
**100**) · `offset?`. Ordered by `objectIdentity` asc.

**Response 200, `include=summary`, real:**

```json
{
  "snapshotId": "f7ab3e50-f055-435d-85e1-e185db40a8e1",
  "resourceKey": "graph:v1.0:/policies/authorizationPolicy",
  "include": "summary",
  "resourceStatus": {
    "resourceKey": "graph:v1.0:/policies/authorizationPolicy",
    "displayName": "/policies/authorizationPolicy",
    "surface": "policy", "workload": "AzureAD", "readTransport": "graph",
    "status": "collected", "skipReason": null, "reasonDetail": null,
    "objectCount": 1, "pageCount": 1, "httpStatus": null, "errorCode": null,
    "durationMs": 219, "attemptedAt": "2026-08-31T01:54:57.369Z"
  },
  "objects": [
    {
      "objectIdentity": "singleton",
      "identityStrategy": "graph-singleton",
      "displayName": "Authorization Policy",
      "objectHash": "76a940be3ff6f52e873f71aa87e959eff6b103c8abc7506a66777baee09f34d6",
      "propertyCount": 12,
      "odataType": null,
      "sourceRef": "v1.0/policies/authorizationPolicy",
      "collectedAt": "2026-08-31T01:51:23.430Z"
    }
  ],
  "paging": { "total": 1, "limit": 2, "offset": 0, "hasMore": false }
}
```

With `include=full` each object additionally carries **`objectJson`** — the verbatim Microsoft
object. Real head of the one above:

```json
{ "id": "authorizationPolicy",
  "description": "Used to manage authorization related settings across the company.",
  "displayName": "Authorization Policy",
  "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#policies/authorizationPolicy/$entity",
  "guestUserRoleId": "10dae51f-b6af-4016-8d66-8c2a99b929b3",
  "allowInvitesFrom": "everyone",
  "allowedToUseSSPR": true,
  "blockMsolPowerShell": false,
  "defaultUserRolePermissions": {
    "allowedToCreateApps": true,
    "allowedToCreateTenants": true,
    "allowedToReadOtherUsers": true,
    "allowedToCreateSecurityGroups": true,
    "permissionGrantPoliciesAssigned": [
      "ManagePermissionGrantsForSelf.microsoft-user-default-recommended",
      "ManagePermissionGrantsForSelf.microsoft-user-default-allow-consent-apps",
      "ManagePermissionGrantsForOwnedResource.microsoft-dynamically-managed-permissions-for-team"
    ]
  } }
```

**`objectJson` has no schema.** It is whatever Microsoft returned, including `@odata.*`
annotations, arbitrarily nested. A design must render it as a structured JSON viewer, not as
named fields. `propertyCount` (12 above) is the top-level property count and is the only
size hint available without fetching the body.

`displayName` is `string | null` (the object has no display-name property);
`odataType` is `string | null`; `sourceRef` is `string | null`.

**The unreadable case returns 200 with an empty list, not a 404** — this is the shape a design
must get right:

```json
{
  "snapshotId": "f7ab3e50-f055-435d-85e1-e185db40a8e1",
  "resourceKey": "graph:v1.0:/deviceManagement/deviceConfigurations",
  "include": "full",
  "resourceStatus": {
    "resourceKey": "graph:v1.0:/deviceManagement/deviceConfigurations",
    "displayName": "/deviceManagement/deviceConfigurations",
    "surface": "device-management", "workload": "MicrosoftGraph", "readTransport": "graph",
    "status": "failed", "skipReason": "license_required",
    "reasonDetail": "Microsoft Intune is not licensed on this tenant. …",
    "objectCount": 0, "pageCount": null, "httpStatus": 503,
    "errorCode": "intune-backend-iis-503", "durationMs": 358,
    "attemptedAt": "2026-08-31T01:54:57.956Z"
  },
  "objects": [],
  "paging": { "total": 0, "limit": 2, "offset": 0, "hasMore": false }
}
```

**`objects: []` with `resourceStatus.status === "failed"` must NOT render as "no items".** The
resource status row travels with the objects precisely so a page of 25 out of a `partial` read
does not look identical to a page out of a complete one.

**`resourceStatus` is `null`** when the `resourceKey` has no status row in this snapshot at
all — a key that was never targeted, or a typo. That is a third state distinct from empty and
failed, and it also returns 200.

### 5.5 `GET /api/portal/config-state/changes`

Role `CustomerUser`. Resolves the tenant's two most recent sealed snapshots and returns the
`drift` comparison between them. Computes on first call; cached thereafter (see §4.7).

**Query:** `compute?=false` (return only a stored comparison) · `limit?` (pages the
`notComparable.resources` array, def 200, max 1,000). `offset` is fixed at 0 on this endpoint.

**Five distinct 200 responses. Four of them are not "changes".**

**(a) No snapshot at all**

```json
{ "comparison": null, "available": false, "reason": "no_sealed_snapshot",
  "detail": "No sealed configuration snapshot exists for this tenant yet, so there is no 'before' or 'after' to compare." }
```

**(b) Exactly one snapshot** — a change report needs two points in time:

```json
{ "comparison": null, "available": false, "reason": "only_one_snapshot",
  "detail": "Only one sealed configuration snapshot exists for this tenant. A change report needs two points in time; there is nothing to compare this one against yet.",
  "currentSnapshot": { "id": 0, "snapshotId": "…", "capturedAt": "…", "completeness": { … } } }
```

**(c) Not computed yet** — only reachable with `?compute=false`:

```json
{ "comparison": null, "available": false, "reason": "not_yet_computed",
  "detail": "The comparison between these two snapshots has not been computed yet. Request this endpoint without compute=false to compute it.",
  "base": { "id": 0, "snapshotId": "…", "capturedAt": "…" },
  "head": { "id": 0, "snapshotId": "…", "capturedAt": "…" } }
```

**(d) A refused pair** — `{ "comparison": null, "available": false, "reason": "not_diffable",
"detail": "<the differ's own sentence>" }`. **HTTP 200, not an error.** The sentences are
listed in §6.6.

**(e) A comparison**

```json
{
  "comparison": {
    "diffId": "179d15e3-b582-4e90-bb45-f86b2f545ae1",
    "diffRowId": 9,
    "mode": "drift",
    "base": { "id": 8, "snapshotId": "…", "capturedAt": "…", "completeness": { … } },
    "head": { "id": 10, "snapshotId": "…", "capturedAt": "…", "completeness": { … } }
  },
  "available": true,
  "completeness": {
    "isComplete": false, "status": "sealed",
    "resourceTypesCompared": 155, "resourceTypesPartial": 1,
    "resourceTypesNotComparable": 1203,
    "comparableFraction": 0.11405445180279618,
    "objectsPaired": 50121, "objectsAdded": 52, "objectsRemoved": 3,
    "objectsIndeterminate": 3, "objectsUnpairable": 0,
    "changesTotal": 340, "changesSignificant": 340, "changesIgnored": 0,
    "differVersion": "1797.1",
    "rulesetFingerprint": "d246a9e1d6dec32b16c22f497e218021a66ae1835c0631ca60dad5430af09151",
    "error": null
  },
  "notComparable": { "count": 1203, "resources": [ … ], "paging": { … } },
  "byWorkload": [ … ]
}
```

`comparableFraction` is `number | null` — null only when nothing was considered on either
side. `differVersion` and `rulesetFingerprint` are **non-null strings** on every diff.
`error` is `string | null`.

`byWorkload` entries are `{ workload, comparability, resourceTypes, changesSignificant }` —
**one row per (workload, comparability) pair, not per workload.** Real, from diff 9:
`MicrosoftGraph` appears three times — `comparable` 118 types / 325 significant,
`not_comparable` 735 / 0, `partially_comparable` 1 / 5. Likewise `AzureAD` appears as
`comparable` 27 / 9 and `not_comparable` 69 / 0. **A design that keys a chart on `workload`
alone will collide rows.**

### 5.6 `GET /api/portal/config-state/changes/:diffId`

Role `CustomerUser`. `:diffId` accepts row id or uuid. Entitled on **both** sides.

**Query:** `view?` = `changes` (default) | `resources` — anything else is a 400.

Both views share:

```json
{ "diffId": "…", "diffRowId": 9, "mode": "drift", "completeness": { … },
  "snapshots": { "base": { "id": 0, "snapshotId": "…", "capturedAt": "…", "completeness": { … } },
                 "head": { … } } }
```

**`snapshots.base` and `snapshots.head` are both nullable** — the header rows are looked up
separately and would be null if a snapshot row were removed. Design for it.

#### `view=changes`

Extra query: `resourceKey?` · `changeKind?` (one of the 10) · `workload?` ·
`includeIgnored?=true` · `limit?` (def 100, max 500) · `offset?`

Returns `{ …shared, changes: [...], byKind: [...], paging }`. **Ordering is the stored
`sequence`, always** — the total order *is* the result (#1797 rule 3), so re-sorting would
discard the property being guaranteed. Ignored changes are **stored, never dropped**, but
excluded by default.

**Real object-level change row, diff 9:**

```json
{
  "sequence": 1,
  "resourceKey": "graph:v1.0:/admin/serviceAnnouncement/issues",
  "resourceDisplayName": "/admin/serviceAnnouncement/issues",
  "workload": "MicrosoftGraph",
  "objectIdentity": "MV1243442",
  "objectDisplayName": "Users may be unable to access the Suite navigation bar within Microsoft Viva Engage",
  "identityStrategy": "graph-id",
  "changeKind": "object_removed",
  "propertyPath": null,
  "oldValue": { "objectHash": "c240fa844fbdb242e688e70ea99d02b0c3ceb071aba4b9cb111df67b83f9937c",
                "displayName": "Users may be unable to access the Suite navigation bar within Microsoft Viva Engage" },
  "newValue": null,
  "oldValuePresent": true,
  "newValuePresent": false,
  "isIgnored": false,
  "ignoredByRuleId": null
}
```

**Real property-level change row, diff 9:**

```json
{
  "sequence": 3,
  "resourceKey": "graph:v1.0:/applications",
  "resourceDisplayName": "/applications",
  "workload": "MicrosoftGraph",
  "objectIdentity": "45f13636-58b1-4e70-ba5c-c239d9ba4157",
  "objectDisplayName": "MSP Platform — Multi-Tenant Consent",
  "identityStrategy": "graph-id",
  "changeKind": "property_changed",
  "propertyPath": "web.redirectUriSettings[0].uri",
  "oldValue": "https://ba888680-2595-412d-84fe-4e9aefc2688b-00-22rhgh0krunr4.picard.replit.dev/api/consent/callback",
  "newValue": "https://www.shanemccaw.com/api/admin/sharepoint-consent/callback",
  "oldValuePresent": true,
  "newValuePresent": true,
  "isIgnored": false,
  "ignoredByRuleId": null
}
```

An `array_reordered` row on the same object carries the whole array on both sides
(`propertyPath: "web.redirectUris"`, `oldValue`/`newValue` each a full string array) — these
rows are large, and there is no truncation on the wire.

**Nullability that will break a screen if got wrong:**

| Field | Type | `null` means |
|---|---|---|
| `propertyPath` | `string \| null` | **null on all four object-level kinds.** Present on the six property-level kinds. |
| `oldValue` / `newValue` | `unknown \| null` | Arbitrary JSON: a scalar, an array, an object, or (on object-level rows) a `{objectHash, displayName}` stub. `null` is **ambiguous** — either "absent on that side" or "genuinely the JSON value `null`". |
| `oldValuePresent` / `newValuePresent` | `boolean` | **This is the field that disambiguates the above. Use it, never `oldValue !== null`.** |
| `objectDisplayName` | `string \| null` | The object has no display-name property. Fall back to `objectIdentity`. |
| `ignoredByRuleId` | `number \| null` | Null unless `isIgnored` is true. Null on **every** real row today. |
| `resourceDisplayName` / `workload` | `string` | Never null — falls back to the raw `resourceKey` / the literal `"unregistered"`. |

`byKind` is `[{ changeKind, isIgnored, count }]` over the **whole** diff, unfiltered by the
page or by the query.

#### `view=resources`

Extra query: `comparability?` (one of the 3) · `workload?` · `limit?` (def 200, max 1,000) ·
`offset?`. Returns `{ …shared, resources, byWorkload, paging }`.

Each `resources[]` row is the raw `config_diff_resource_status` row plus `displayName`,
`surface`, `workload`. Real:

```json
{
  "id": 9130,
  "diffRowId": 9,
  "resourceKey": "m365dsc:AzureVerifiedIdFaceCheck",
  "comparability": "not_comparable",
  "notComparableReason": "base snapshot status \"skipped\" (no_executor): No ps-execution catalog entry invokes this resource's read cmdlet unfiltered — needs Get-AzResourceGroup. … ; head snapshot status \"skipped\" (no_executor): … . At least one side did not successfully read this resource, so no object-level or property-level difference can be asserted. This is explicitly NOT a report that anything was added or removed.",
  "baseStatus": "skipped", "baseSkipReason": "no_executor", "baseReasonDetail": "…", "baseObjectCount": 0,
  "headStatus": "skipped", "headSkipReason": "no_executor", "headReasonDetail": "…", "headObjectCount": 0,
  "objectsPaired": 0, "objectsAdded": 0, "objectsRemoved": 0,
  "objectsIndeterminate": 0, "objectsUnpairable": 0, "changesTotal": 0,
  "displayName": "AzureVerifiedIdFaceCheck", "surface": "azure", "workload": "Azure"
}
```

`notComparableReason` is `null` on `comparable` rows and a long composed sentence otherwise.
It **restates both sides' reasons in full**, so it is frequently 400+ characters and can
exceed 800. `baseSkipReason` / `headSkipReason` / `baseReasonDetail` / `headReasonDetail` are
each nullable independently — one side can be readable while the other is not.

---

## 6. Operator endpoints — full contracts

Everything below is `requireRole("MSPOperator")` and book-scoped.

### 6.1 `GET /api/msp/config-state/tenants`

The "who has been collected, and how well" answer. No customer-side equivalent.

**Real response, both testbed tenants:**

```json
{
  "mspId": 1,
  "tenants": [
    { "tenantId": 3, "customerName": "Test Me", "domain": "shanemccaw.onmicrosoft.com",
      "entraTenantId": "0a361ab2-9e85-4bbf-8b75-c1ebf042dfba",
      "isTestbed": false, "status": "active",
      "latestSnapshot": null, "everCollected": false },
    { "tenantId": 1, "customerName": "Jane Jane", "domain": "mccawsoft2.onmicrosoft.com",
      "entraTenantId": "c4c814d4-3afe-441e-9145-62461d0a4fd3",
      "isTestbed": true, "status": "active",
      "latestSnapshot": {
        "id": 11, "snapshotId": "a6e52f60-4161-4b11-8ddf-a6a2eccd4c10",
        "capturedAt": "2026-08-31T12:21:59.727Z", "trigger": "workflow",
        "ageHours": 5.1,
        "completeness": { "isComplete": false, "status": "sealed",
          "capturedAt": "2026-08-31T12:21:59.727Z",
          "resourceTypesTargeted": 2, "resourceTypesCollected": 0, "resourceTypesEmpty": 0,
          "resourceTypesPartial": 0, "resourceTypesSkipped": 0, "resourceTypesFailed": 2,
          "objectCount": 0, "readableFraction": 0,
          "collectorVersion": "1796.1", "error": null } },
      "everCollected": true }
  ],
  "collectedCount": 1,
  "neverCollectedCount": 1
}
```

`latestSnapshot` is **`null`, never a zeroed placeholder**, for a never-collected customer —
"never collected" and "collected and found nothing" are different facts about a customer, and
this is the view where that difference gets acted on. `ageHours` is rounded to one decimal.
`mspId` is `number | null` (null for a PlatformAdmin who named no MSP). `domain` is
`string | null`. Tenants are ordered by `customerName` ascending.

**Half the book has never been collected today.** The never-collected row is the common case
at launch, not an edge case. An empty book returns
`{ mspId, tenants: [], collectedCount: 0, neverCollectedCount: 0 }`.

### 6.2 `GET /api/msp/config-state/snapshots` · `/snapshots/:id` · `/snapshots/:id/objects`

Same shapes as §5.1, §5.3, §5.4. Differences:

- `/snapshots` accepts `?tenantId=` (integer; non-integer → 400 *"tenantId must be an integer
  tenants.id"*). It **narrows within** the book; it cannot widen it. A `tenantId` outside the
  book yields an empty list, not a 403.
- `/snapshots/:id` adds to the `snapshot` object: `tenantName` (nullable), `entraTenantId`,
  `triggerRef` (nullable free text — the real one on snapshot 11 is
  `"msp:config-state:collect:tenant=1:1843-live-verify"`), `wfRunId` (nullable),
  `requestedByUserId` (nullable).
- `/snapshots/:id/objects` adds `tenantId` to the envelope.

### 6.3 `POST /api/msp/config-state/collections` — the only producer path

**Operator-only. There is no customer trigger and there must not be one.**

**Body:** `{ tenantId: number (required), maxResources?: number (positive int), reason?: string }`

Fires the seeded `__system__: Tenant Configuration Snapshot` workflow definition. The route
**does not import the collector at all** — #1796 built the `config_snapshot_collect` node
precisely so collection is a visible Workflow Engine run with logs, a concurrency limit and a
node trace, rather than a bare scheduler or a direct library call from a route.

**Response 202:**

```json
{ "runId": 34415, "tenantId": 1, "definitionId": 0,
  "workflow": "__system__: Tenant Configuration Snapshot",
  "maxResources": 2,
  "followUrl": "/api/msp/config-state/collections/34415" }
```

`maxResources` is `number | null` — null means every collectable type (1,359, and ~3m43s).

**Live-verified.** Run **34415** was fired through this endpoint on 2026-08-31 with
`triggerRef` `msp:config-state:collect:tenant=1:1843-live-verify` and payload
`{"tenantId": 1, "maxResources": 2, "requestedByUserId": 1}`; it completed in 3.5 s and
produced snapshot row 11.

**Errors:** 400 bad `tenantId`/`maxResources` · 404 tenant outside the book · **409** the
workflow has no published version **or** its concurrency limit is already reached by runs in
flight (two real conditions with different fixes, both reported rather than retried behind the
caller's back) · **503** the definition is not seeded in this environment, with the message
*"Run the system-workflow seed before triggering collection."* — a statable blocker rather
than a silent fallback to calling the collector directly.

**READ of a tenant, not a write.** Every call the collector makes is a GET or a `Get-*`
cmdlet; the ps-execution container will not resolve a write cmdlet at all (#209).

### 6.4 `GET /api/msp/config-state/collections/:runId`

`:runId` must be a positive integer `wf_runs.id`, else 400. A run whose target tenant is
outside the book returns **404, not 403**.

**Response 200:**

```json
{
  "run": { "id": 34415, "status": "completed", "triggerType": "manual",
           "triggerRef": "msp:config-state:collect:tenant=1:1843-live-verify",
           "tenantId": 1, "startedAt": "2026-08-31T12:21:59.454Z",
           "finishedAt": "2026-08-31T12:22:02.965Z",
           "errorMessage": null, "createdAt": "…" },
  "snapshot": { "id": 11, "snapshotId": "a6e52f60-4161-4b11-8ddf-a6a2eccd4c10",
                "status": "sealed", "capturedAt": "…", "completeness": { … } },
  "logs": [ { "nodeId": "collect", "level": "info", "message": "…", "timestamp": "…" } ]
}
```

`snapshot` is **`null` while the run has not reached the collect node yet, and after a run
that failed before sealing.** It is resolved by `wf_run_id` stamped on the snapshot header —
not by "the newest snapshot for this tenant", which would attribute a concurrent run's output
to this one. `logs` is capped at **200 rows**, ordered ascending by id. `finishedAt` and
`errorMessage` are null on a live run; `triggerRef` is nullable.

### 6.5 `GET /api/msp/config-state/registry` and `/registry/summary`

**Deliberately not tenant-scoped** — the registry describes what this *platform* can read from
Microsoft, identically for every customer. It holds no tenant configuration and no tenant
identifiers.

**`/registry` query:** `collectable?` = `"true"` | `"false"` (any other string → 400) ·
`transport?` · `surface?` · `availability?` (each one of its enum, else 400) · `workload?`
(free text) · `q?` (case-insensitive substring over `resourceKey` and `displayName`) ·
`limit?` (def 200, max 1,000) · `offset?`

Ordered by `collectionOrder` asc, then `resourceKey` asc.

**Real row:**

```json
{
  "resourceKey": "graph:beta:/deviceManagement/androidAppConfigurationSchema",
  "displayName": "/deviceManagement/androidAppConfigurationSchema",
  "surface": "device-management",
  "workload": "MicrosoftGraph",
  "readTransport": "graph",
  "graphVersion": "beta",
  "graphPath": "/deviceManagement/androidAppConfigurationSchema",
  "isCollection": false,
  "readCmdlets": [],
  "identityStrategy": "graph-singleton",
  "identityPropertyNames": [],
  "identityBasis": "single-object Graph path; the path is the identity",
  "requiredAppPermissions": [],
  "graphReadPermissionOptions": [
    "DeviceManagementApps.Read.All", "DeviceManagementApps.ReadWrite.All",
    "DeviceManagementConfiguration.Read.All", "DeviceManagementConfiguration.ReadWrite.All",
    "DeviceManagementManagedDevices.Read.All", "DeviceManagementManagedDevices.ReadWrite.All",
    "DeviceManagementRBAC.Read.All", "DeviceManagementRBAC.ReadWrite.All",
    "DeviceManagementServiceConfig.Read.All", "DeviceManagementServiceConfig.ReadWrite.All"
  ],
  "isCollectable": true,
  "notCollectableReason": null,
  "collectionOrder": 100,
  "lastKnownAvailability": "available_now",
  "availabilityRefreshedAt": "2026-08-30T09:55:31.280Z",
  "shapeProvenance": "derived_from_graph_metadata",
  "notes": null
}
```

**`requiredAppPermissions` and `graphReadPermissionOptions` are two different things and
merging them misreports availability in both directions** (#1794). `required` is
Microsoft365DSC's **ALL-OF** set; `graphReadOptions` is Microsoft's **ANY-OF** set. Both are
arrays, frequently empty, never null.

`graphVersion` / `graphPath` are null for non-Graph transports; `readCmdlets` is empty for
Graph resources and populated for `powershell` ones. `notCollectableReason` is **NOT NULL by
CHECK constraint for every non-collectable type** — this read cannot return a gap without its
cause, which is the whole reason the registry is served. `notes` is nullable and usually null.
`identityPropertyNames` is empty except for the 28 `composite-key` types.
`availabilityRefreshedAt` is nullable.

**`/registry/summary`** returns:

```json
{ "total": 1539, "collectable": 1359, "notCollectable": 180,
  "byTransport": [ { "readTransport": "graph", "isCollectable": true, "count": 1125 }, … ],
  "bySurface": [ { "surface": "device-management", "count": 400 }, … ],
  "byAvailability": [ { "lastKnownAvailability": "available_now", "count": 654 }, … ],
  "notCollectableReasons": [ { "notCollectableReason": "not_collectable", "count": 124 }, … ],
  "byShapeProvenance": [ { "shapeProvenance": "derived_from_graph_metadata", "count": 991 }, … ] }
```

Real values in full in §4.1. **`byTransport` is keyed on the *pair* `(readTransport,
isCollectable)` — 6 rows, not 6 transports.** `bySurface` returns all 20 surfaces.
`byAvailability` returns all 5. Note that `dns` and `unknown` transports have **zero** rows
and therefore do not appear at all — a design must not assume every enum member is present in
a group-by result.

### 6.6 `GET /api/msp/config-state/diffs` and `POST /api/msp/config-state/diffs`

**`GET`** — query `mode?` · `tenantId?` (matches `headTenantId`) · `limit?` (def 25, max 200)
· `offset?`. Both sides must be in the book. Ordered by `createdAt` desc.

Empty book short-circuits to `{ "diffs": [], "paging": { "total": 0, "limit": 0, "offset": 0,
"hasMore": false } }` — note **`limit: 0`**, not the default 25. A client rendering "showing
0 of 0 per page" must tolerate it.

Each row: `{ diffId, diffRowId, mode, baseSnapshotRowId, headSnapshotRowId, baseTenantId,
headTenantId, trigger, triggerRef, createdAt, sealedAt, durationMs, completeness }`.
`sealedAt`, `durationMs` and `triggerRef` are all nullable (a `computing` or `failed` diff).

**`POST`** — one route, four named capabilities:

| `mode` | Means | Entry point |
|---|---|---|
| `drift` | one tenant now, vs its own earlier state | `diffDrift` |
| `baseline_assessment` | one tenant vs a known-good reference | `diffAgainstBaseline` |
| `tenant_compare` | tenant A vs tenant B | `diffTenants` |
| `promotion` | Dev/Test source vs the target it promotes to | `diffPromotion` |

**Body:**

| Field | Required | Notes |
|---|---|---|
| `mode` | **yes** | One of the four. *"It names which capability you are invoking, and the answer is not interpretable without it."* |
| `headSnapshotRowId` | **yes** | Positive integer `tenant_config_snapshots.id` |
| `baseSnapshotRowId` | yes, unless `baselineId` | Positive integer |
| `baselineId` | alternative to the above | uuid; **only** valid for `baseline_assessment` and `promotion`, else 400 |
| `recompute` | no | `true` **replaces** the stored diff for this pair |
| `triggerRef` | no | Free text; defaults to `msp:config-state:<mode>[:baseline=<name>]` |

**Response 200:** `{ diff: DiffSnapshotsResult, baseline: string | null, base: {id,
snapshotId, tenantId, capturedAt, completeness}, head: {…} }`. `diff` carries
`fromCache: boolean` and `truncated: boolean` alongside the same counters as
`DiffCompleteness`.

**Mode/tenant coherence is validated in the engine *and* enforced by a database CHECK
constraint**, so a `drift` across two tenants is rejected by the database as well as by the
engine. Real refusal sentences, returned as **400 `VALIDATION_ERROR`** here (and as a **200**
`reason: "not_diffable"` on the portal's `GET /changes`):

- *"base and head are the same snapshot: the answer is trivially 'no changes' and storing it would put a meaningless all-clear in the cache."*
- *"base snapshot &lt;n&gt; does not exist"* / *"head snapshot &lt;n&gt; does not exist"*
- *"&lt;side&gt; snapshot &lt;n&gt; is still running. Its object set is incomplete by definition, so every not-yet-collected object would read as absent and be reported as a deletion. Seal it first."*
- *"mode \"drift\" compares a tenant with itself, but base is tenant &lt;a&gt; and head is tenant &lt;b&gt;. Use \"tenant_compare\" or \"promotion\"."*
- *"mode \"&lt;m&gt;\" compares two different tenants, but both snapshots belong to tenant &lt;n&gt;. Use \"drift\" or \"baseline_assessment\"."*

**`promotion` computes the difference only. There is no apply path anywhere in this
subsystem, and none may be added here** — applying configuration is the Config Pack write path
with its consent gates, break-glass gate and approval steps. Joining the two is a separate
product decision, recorded as an explicit non-goal on #1797 and #1843.

### 6.7 `GET /api/msp/config-state/diffs/rules`

The noise ruleset. `?includeInactive=true` to see retired rules. Ordered by `specificity`
desc, then `resourceKey` asc.

**All 6 active rules, real and complete** — every one is `resourceKey: "*"`, action `ignore`,
basis `structural_annotation`, `isActive: true`:

| `specificity` | `propertyPathPattern` | `rationale` |
|---|---|---|
| 217 | `*@odata.deltaLink` | OData delta cursor. A property of the read, not of the object. |
| 216 | `*@odata.nextLink` | OData paging cursor. A property of the read, not of the object. |
| 215 | `*@odata.context` | OData response-envelope annotation naming the metadata document, not tenant configuration. Varies with the request URL and the Graph version the collector reached the resource on. |
| 213 | `*@odata.count` | OData collection-size annotation. Derived from the collection the read returned, not stored tenant configuration. |
| 212 | `*@odata.etag` | OData concurrency token. Changes on every server-side write regardless of whether any configuration value changed, and carries no configuration meaning of its own. |
| 210 | `*@odata.id` | OData canonical-URL annotation. Restates the object identity the differ already pairs on. |

Wire shape per rule: `{ id, resourceKey, propertyPathPattern, action, basis, specificity,
rationale, isActive, evidence, declaredByUserId, createdAt }`.

**There are zero `observed_volatile` and zero `operator_declared` rules today**, so `evidence`
is `null` on every rule and `declaredByUserId` is null on every rule. `evidence` is populated
**only** for `observed_volatile` and then carries `{ diffRowId, objectCount, observedAt }` —
the measurement behind the suppression, because a suppression whose grounds are not readable
is indistinguishable from hiding a real finding.

**The rules produce no visible effect on real data yet**: diff 9 recorded `changesIgnored: 0`.
A "N suppressed" affordance will render `0` on every real diff today. That is correct and
should not be designed away.

### 6.8 Baselines

**`GET /baselines`** — `?includeRetired=true` · `?purpose=`. Ordered by `name` asc. Empty book
returns `{ "baselines": [] }`.

**The one real baseline on the platform:**

```json
{
  "baselineId": "dd2f157d-fbb3-495f-ad2e-131661337937",
  "name": "Testbed known-good 2026-08-31",
  "description": "Full testbed collection, 1359 targeted.",
  "purpose": "known_good",
  "tenantId": 1,
  "tenantName": "Jane Jane",
  "snapshotRowId": 10,
  "isActive": true,
  "retiredAt": null,
  "retiredReason": null,
  "declaredByUserId": 1,
  "createdAt": "2026-08-31T12:19:13.593Z",
  "snapshot": { "snapshotId": "f7ab3e50-f055-435d-85e1-e185db40a8e1",
                "capturedAt": "2026-08-31T01:51:15.437Z", "status": "sealed",
                "completeness": { "resourceTypesTargeted": 1359, "resourceTypesCollected": 93,
                                  "readableFraction": 0.11405445180279618, "…": "…" } }
}
```

**The referenced snapshot's own completeness travels with the baseline.** A baseline is only
as authoritative as the snapshot behind it — and the only real one on this platform is 11.4%
readable. An operator must see that *before* assessing against it, not afterwards in the
comparability report. `snapshot`, `tenantName`, `description`, `retiredAt`, `retiredReason`
and `declaredByUserId` are all nullable.

**`POST /baselines`** — body `{ name (required, non-blank), purpose (required, one of the 2),
snapshotRowId (required int), description? }`. Writes a **pointer**, nothing else: no
configuration is copied, the snapshot it names is immutable by database trigger, and it does
not touch Microsoft at all. `mspId` is taken from the tenant's own `tenants.msp_id` rather
than the caller's claim, so a PlatformAdmin declaring a baseline for someone else's customer
records the right owner instead of a null. **201.**

Errors: 409 if the snapshot is not `sealed` — *"Only a sealed snapshot is immutable, and a
baseline that can still change is not a baseline."* · 409 on a duplicate name within the MSP —
*"Names are the way a baseline is referred to, so they are unique within a book."*

**`PATCH /baselines/:baselineId`** — **retirement is the only supported change.** Body must be
`{ isActive: false, retiredReason: "<non-blank>" }`; anything else is a 400:

> The only supported change is retirement: { isActive: false, retiredReason: '…' }. A
> baseline's snapshot is immutable evidence, so repointing one at different evidence under the
> same name would rewrite history — declare a new baseline instead.

A blank `retiredReason` is a 400 — *"a retired baseline that does not say why is a gap with no
stated cause"*, and the database enforces the same thing with a CHECK constraint. Retired,
never deleted: an assessment run months ago against a baseline nobody uses now still has to be
explainable, and a deleted row explains nothing. Starting a new assessment against a retired
baseline is a **409** naming the retirement reason; past assessments against it stay readable.
Retiring an already-retired baseline is a 404.

**Response 200:** `{ baseline: { baselineId, name, isActive, retiredAt, retiredReason } }`.

---

## 7. Empty, partial and unavailable — the states to design first

Ranked by how often they occur on real data today.

| # | State | How it arrives on the wire | Frequency, measured |
|---|---|---|---|
| 1 | **Resource unreadable** | resource row `status: skipped\|failed` + `skipReason` + `reasonDetail`; on drill-down `objects: []` with a non-`collected` `resourceStatus` | **1,203 of 1,359 types** (88.6%) |
| 2 | **Nothing comparable** | `available: true`, `changesTotal: 0`, `comparableFraction: 0`, `notComparable.count === targeted` | **2 of 4 real diffs** |
| 3 | **Never collected** | `snapshots/current` → `collected: false, reason: "no_sealed_snapshot"`; `/tenants` → `latestSnapshot: null, everCollected: false` | **1 of 2 tenants** |
| 4 | **Genuinely empty** | resource row `status: "empty"`, `objectCount: 0`, `skipReason: null` | **62 of 1,359** |
| 5 | **Only one snapshot** | `reason: "only_one_snapshot"` + `currentSnapshot` | every tenant's first change-report view |
| 6 | **Partial / truncated** | `status: "partial"`, `skipReason: "budget_exhausted"`, real objects present but the set is not whole | **1 of 1,359** — `/schemaExtensions`, 4,949 objects at the 50-page cap |
| 7 | **Not diffable** | `available: false, reason: "not_diffable"` + the differ's sentence, **HTTP 200** | reachable whenever a snapshot is `running` |
| 8 | **Not computed yet** | `reason: "not_yet_computed"` — only under `?compute=false` | every first view under that flag |
| 9 | **Empty book** | `{ tenants: [], collectedCount: 0 }` / `{ diffs: [], paging.limit: 0 }` / `{ baselines: [] }` | a new MSP |
| 10 | **Unregistered resource** | `workload: "unregistered"`, `displayName` falls back to the raw key | 0 today; happens when a type is retired or renamed after collection |
| 11 | **No status row for the key** | `resourceStatus: null` on the objects endpoint, HTTP 200 | a mistyped `resourceKey` |
| 12 | **Abandoned snapshot** | `status: "abandoned"` with `error: "No completion recorded; marked abandoned by the sweep after …"` | 0 today; the sweep runs at a 6-hour cut-off |

**None of these is an error.** Cases 1–6 and 9–12 are the normal condition of this product.
Case 1 is the *majority* of every screen.

**Rules that follow directly from the measured data:**

1. **Never render a missing value as `0`.** `objectCount: 0` on a `failed` row is not zero
   objects; it is no answer. `0` and "unavailable" occupy the same slot in the payload and are
   separated only by `status` / `skipReason`.
2. **Never render `readableFraction` or `comparableFraction` as a bare percentage.** `0` means
   "none readable"; `null` means "nothing targeted". Both need a caption, and neither is a
   quality score for the customer's configuration — it is a measure of **our** reach. Rendering
   11.4% next to a customer's name, unlabelled, says something false about them.
3. **`isComplete` is `false` on every snapshot and every diff that exists today.** A design
   gated on `isComplete === true` renders nothing, ever.
4. **`status: "sealed"` does not mean complete.** They are separate fields answering separate
   questions, and both are always present.
5. **`changesTotal: 0` is only an all-clear when `comparableFraction` is high.** Pair them, or
   the summary lies. Two of the four real diffs have `changesTotal: 0` and `comparableFraction: 0`.
6. **A whole workload can be legitimately absent.** Intune: 162 types, 0 objects, and a real
   sentence explaining why. The explanation must be reachable from wherever the zero appears.

---

## 8. Retention, cadence and the drift-domain producer count

Three facts #1851 asked this pack to record, read out of the code as it stands.

**Cadence: there is none. Collection is manual-trigger-only.** The seeded workflow's
`triggerType` is `"manual"`, no trigger row is created, and nothing fires it on its own. The
seed's own comment states the reason: *"the collector must be a visible Workflow Engine node
rather than a bare scheduler, but the cadence at which snapshots should be taken is a separate
question with its own issue."* Every one of the 7 real snapshots was started by hand or by an
operator API call. **A design must not show a "next scheduled collection" affordance — there
is no scheduler.** The only automation anywhere in the store is `sweepAbandonedSnapshots`
(6-hour default cut-off), and it marks dead runs; it does not start new ones.

**Retention: there is none.** No pruning, expiry, TTL or row cap exists anywhere in the
snapshot or diff store. Snapshots and their objects accumulate indefinitely. At **34 MB of
`object_json` and 50,176 object rows per full snapshot**, this is a real growth curve — two
full snapshots already account for ~68 MB on a single testbed tenant. Filed as a finding
(§11). The only lifecycle transition in code is `running → abandoned`; nothing is ever
deleted, and `config_diffs` rows are removed only by an explicit `recompute: true` replacing
one.

**Drift domains: 5 of 18 have a producer; 13 do not.** #1794's number is still current at pack
time. The 18 `drift:*` metrics are declared in `lib/dashboard-registry/src/metrics.ts`; the
producers are the 5 entries in `DRIFT_CHECK_SPECS`
(`artifacts/api-server/src/lib/drift-check-specs.ts`).

| Has a producer | No producer |
|---|---|
| `ca-policy` · `public-teams-discoverable` · `eeeu-site-sharing` · `tenant-sharing-capability` · `email-authentication` | `directory-settings` · `license-assignment` · `mailbox-config` · `role-assignment` · `security-defaults` · `sharepoint-admin` · `teams-policy` · `app-config` · `redirect-uri` · `secret` · `certificate` · `permission` · `tenant-config` |

Real `drift_collection_status` rows on the testbed (keyed on the text M365 tenant GUID
`c4c814d4-3afe-441e-9145-62461d0a4fd3`, **not** `tenants.id`):

| `domain_key` | `status` |
|---|---|
| `ca-policy` | `tracked` |
| `email-authentication` | `tracked` |
| `public-teams-discoverable` | `tracked` |
| `tenant-sharing-capability` | `tracked` |
| `eeeu-site-sharing` | **`not_comparable`** |

Four `drift_baseline_snapshots` rows exist (`eeeu-site-sharing` has none).
**`drift_events` is empty — zero rows, ever.**

`DRIFT_COLLECTION_STATUSES` = `tracked` · `baseline_captured` · `not_comparable` · `error`.
A `not_comparable` row carries a real `reason` string and an optional `coverage` JSON blob —
this is where a fan-out truncation surfaces. The schema's own worked example is
*"site scan truncated at the fan-out cap (500/812 eligible sites scanned)"*, and
`eeeu-site-sharing` is the per-site fan-out domain: the testbed has **99 sites**
(`graph:v1.0:/sites`, collected), so that domain fans out 99 ways on this tenant and is
currently `not_comparable`.

**Do not design 18 drift tiles.** Thirteen would be permanently blank, and a blank tile is the
fabricated-absence failure this whole chain exists to prevent. Five tiles, one of which is
`not_comparable` and none of which has ever produced an event, is the honest picture.

---

## 9. Evidence discipline — what is measured, and what is not

| Claim | How verified |
|---|---|
| Endpoint paths, methods, roles, request/response shapes, error codes | Read from `routes/portal-config-state.ts`, `routes/msp-config-state.ts`, `routes/msp-config-state-diffs.ts`, `lib/config-state-views.ts`, `lib/msp-config-state-scope.ts`, `lib/portal-customer-scope.ts`, `middlewares/requireAuth.ts`, `lib/api-helpers.ts` |
| Route mounting | `routes/index.ts:531–533` under `app.use("/api", router)` at `app.ts:115` — confirmed, no double `/api` prefix on any route in this pack |
| Every enum and its full value set | Read from `lib/db/src/schema/config-snapshots.ts`, `config-diffs.ts`, `config-state.ts`, `msp.ts` |
| Every volume, fan-out, coverage, duration and byte figure in §4 and §8 | `psql` against the local `DATABASE_URL` on 2026-08-31 |
| Every sample payload in §5 and §6 | **Executed** — the real `config-state-views.ts` functions run against the real database, output captured verbatim, then trimmed for length only. Not hand-composed |
| `POST /collections` behaviour | Real `wf_runs` row 34415, fired through the endpoint by #1843's own live verification, which produced snapshot row 11 |

**Not verified live, with the exact blocker:** no HTTP request was made against a running
api-server in this session. Ports 3000, 4000, 5000, 5173, 8080 and 8787 all refused connection
— no local dev server was running. Consequently the **HTTP status codes, the auth middleware's
error shapes, and the exact `res.json` envelopes as serialised over the wire** are read from
the route source rather than observed on a socket. Everything below the route handler — the
view functions, the SQL, the real rows and the real payload shapes — was executed against the
real database, so a payload shown here is what the handler passes to `res.json`.

`snapshotCompleteness` and `diffCompleteness` in every sample are the genuine functions'
output, not transcriptions.

**Names in this document.** `Jane Jane`, `Test Me`, `mccawsoft2.onmicrosoft.com`,
`shanemccaw.onmicrosoft.com`, `MSP Platform — Multi-Tenant Consent` and every GUID, hash and
error string are **real rows in the real database**, not invented examples. Nothing here was
fabricated to read nicely and no example was softened. The testbed tenant
`mccawsoft2.onmicrosoft.com` is simultaneously Shane's real production Microsoft 365 tenant,
which is why the collector is read-only end to end and why every skip reason in §4.2 is a real
production condition rather than a lab artefact.

---

## 10. Explicit non-goals of these endpoints

- **No apply path.** Nothing in this subsystem writes configuration to a tenant. `promotion`
  computes the difference and stops. Joining comparison to the Config Pack write path is a
  separate product decision, recorded as an explicit non-goal on #1797 and #1843.
- **No customer-side write of any kind** — no trigger, no baseline, no rule, no
  acknowledgement, no suppression.
- **No `resourceKeys` parameter** on any route, until Git #2032 is fixed.
- **No `?tenantId=` on the portal router**, ever.
- **No scheduler.** Collection is operator-triggered through the Workflow Engine.
- **This document does no design work**, defines no components, and does not restate
  `docs/design-system.md`.

---

## 11. Gaps found while extracting this pack

Recorded here and filed as their own issues, per the standing rule. **Nothing in this list is
described as if it existed.**

1. **`artifacts/msp-console` does not exist.** #1844 names it as the operator surface
   directory; the repository has no such package. `artifacts/portal` exists but contains only
   `index.tsx` and `not-found.tsx`. Both surfaces in this pack are endpoints-only.
2. **`Design/portal/` is empty** (`.gitkeep` only). No page in this pack has a `.dc.html`
   export, therefore no page in it has a design. Expected at this point in the fixed order —
   recorded so nobody reads a missing export as an oversight.
3. **Two incompatible error envelopes on the same endpoints.** `apiError` returns
   `{ error: { code, message } }`; `requireAuth` / `requireRole` return
   `{ error: "<string>" }` for 401 and 403. A client parsing only one shows a blank error for
   the other.
4. **No retention policy anywhere in the snapshot or diff store.** 34 MB and 50,176 object
   rows per full snapshot, accumulating without bound, with no pruning path in code.
5. **`admin-config-snapshots.ts` / `admin-config-diffs.ts` repeat the `/api` prefix** and are
   therefore served at `/api/api/admin/config-*`, unreachable at the paths their own
   admin-panel pages fetch. Noted in all three #1843 route headers as confirmed live on
   2026-08-31; not touched by this pack.
6. **`unknown_error` is the single largest failure class** on a real snapshot — 304 of 778
   failures, plus 32 rows carrying neither `httpStatus` nor `errorCode`. The largest single
   thing we can say about why a tenant is unreadable is that we do not know.

---

## 12. Source files, for a reader who does need the code

| Concern | File |
|---|---|
| Customer routes | `artifacts/api-server/src/routes/portal-config-state.ts` |
| Operator snapshot / collection / registry routes | `artifacts/api-server/src/routes/msp-config-state.ts` |
| Operator diff / baseline / rule routes | `artifacts/api-server/src/routes/msp-config-state-diffs.ts` |
| All wire shapes, paging, completeness, scoped reads | `artifacts/api-server/src/lib/config-state-views.ts` |
| Operator book resolution | `artifacts/api-server/src/lib/msp-config-state-scope.ts` |
| Customer scope resolution | `artifacts/api-server/src/lib/portal-customer-scope.ts` |
| Role ladder, 401/403 shapes | `artifacts/api-server/src/middlewares/requireAuth.ts` |
| `apiError` envelope and codes | `artifacts/api-server/src/lib/api-helpers.ts` |
| Collector, budgets, abandoned sweep | `artifacts/api-server/src/lib/config-snapshot-collector.ts` |
| Differ, modes, cache key, refusal sentences | `artifacts/api-server/src/lib/config-snapshot-differ.ts` |
| Snapshot store schema + enums | `lib/db/src/schema/config-snapshots.ts` |
| Diff store schema + enums | `lib/db/src/schema/config-diffs.ts` |
| Resource model enums | `lib/db/src/schema/config-state.ts` |
| Seeded collection workflow | `artifacts/api-server/src/lib/seed-system-workflows.ts` |
| Drift domains (separate subsystem) | `lib/dashboard-registry/src/metrics.ts`, `artifacts/api-server/src/lib/drift-check-specs.ts`, `lib/db/src/schema/msp.ts` |

Logging on both routers uses `logger.child({ channel: … })` from the locked taxonomy —
`tenant.portal` for the customer router, `tenant.config-state` for both operator routers.
