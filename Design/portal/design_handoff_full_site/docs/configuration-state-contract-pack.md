# Configuration State — Contract Pack and Design Brief

**Git #1844 (original), regenerated under Git #2899.** Parent epic #1096 (Application Core),
with the customer half landing in the portal (#1485) and the operator half in the MSP operator
surface (#1571).

**Written after the code, deliberately, and regenerated the same way.** The chain is #1793
(resource model) → #1795 (snapshot store) → #1796 (collector) → #1797 (differ) → #1843 (the API
surface) → #1844 (this document, first written 2026-08-31) → #2759 (change-attribution layer,
2026-09-04) → **#2899 (this regeneration, 2026-09-04)**. Thirteen contract packs on this platform
were written before their endpoints existed; they documented absence, and the designs drawn from
them produced empty-state UI. Everything below was re-extracted on **2026-09-04** from the route
files, the Drizzle schema, and the real local PostgreSQL database — including a fresh, live,
full collection run and a fresh comparison run against the real testbed tenant, triggered in this
session for this regeneration (see §9). Where a capability is absent it says so plainly and names
the issue, rather than describing what ought to be there.

**Why this regeneration happened.** #1844's pack (8/31) went stale within days: #2759 shipped a
whole new subsystem this pack said nothing about, the resource registry was corrected downward by
~20% (#1960/#2841 — a real, honest shrink, not noise), the failure classifier improved (#2115),
a real retention policy now exists where the pack said none did (#2114), and the error-envelope
split the pack documented as a defect is now fixed platform-wide (#2113). §9 states exactly what
changed and how each figure below was re-verified, not copy-edited.

**Visual foundation is [`docs/design-system.md`](design-system.md).** Colours, severity
ramp, glass/glow vocabulary and the six-pillar identity system all live there and are not
restated or forked here. This document is data only.

**`Design/portal/` is no longer empty, but still has no export for any page in this pack.** As of
2026-09-04 it holds one export, `design_handoff_ui_shell/` — the portal's **application shell
only** (top bar, pillar tabs, module nav, Tenant Status card, ShaneBot dock, Settings container).
Its own README states plainly: *"Page content is explicitly out of scope... Everywhere a module
page would render, the shell exposes a single content slot."* No page described in this pack —
snapshot list, snapshot detail, change report, registry, baselines — has a `.dc.html` export.
This pack remains the input to Claude Design for those pages, not proof anything downstream is
unblocked.

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

### 0.2 Three subsystems that sound alike and are not

- **Configuration state** (this pack, most of it): `tenant_config_snapshots` / `config_diffs`.
  A whole-tenant, point-in-time snapshot of the registry's collectable resource types (**1,092
  today**, re-measured — see §4.1), and structural comparison between two of them. Served on
  `/api/portal/config-state/*` and `/api/msp/config-state/*`.
- **Configuration change attribution** (Git #2759, new since the original pack — §6.9):
  `config_change_attributions` / `config_change_scopes` / `config_change_lifecycle`. Rides on
  top of `config_diffs`: for every changed setting a `config_diffs` comparison found, it answers
  *why* — a real Change Control record, a real accepted risk, both, or neither — by joining
  against `msp_change_requests` and `msp_risk_decisions`, never by guessing. It is **not** the
  same table as, and does not replace, `drift_events` (see below); the two are real, separate,
  coexisting systems today, and unifying them is an open decision recorded on #2759's own
  closing comment, not something this pack should imply is settled.
- **Drift domains** (`drift.*` metrics, `drift_events`, `drift_collection_status`): a
  separate, much narrower monitor-check-driven subsystem with 18 named domains, its own
  4-value verdict enum (`approved`/`attributed_unapproved`/`unattributed`/`informational`,
  distinct from #2759's 5-value one), and its own attribution logic
  (`buildCaChangeRequestAttribution` in `monitor-executor.ts`) that #2759's own file header
  explicitly calls out as the blunter, 30-day-blanket-window reasoning it improves on for the
  config-diff domain — without retiring it. **5 of 18 drift domains have a producer today; 13 do
  not** — re-verified this session, unchanged from #1794 — see §8. Neither `drift_events` nor
  the 18 drift domains are served by any endpoint in this pack.

Do not merge these three in a design. They have different tables, different keying (config state
and attribution are keyed on `tenants.id`; drift is keyed on the text M365 tenant GUID), and very
different coverage.

---

## 1. Audience split, endpoint by endpoint

The customer reads their own tenant. The operator reads across their book and holds every
management action. **There is no customer-side write in this subsystem at all** — not a
trigger, not a baseline, not a rule, not an attribution re-run.

| # | Customer read (`/api/portal/config-state/*`) | Matching operator capability (`/api/msp/config-state/*`) |
|---|---|---|
| 1 | `GET /snapshots` — my snapshot history | `GET /snapshots?tenantId=` — history across the book; `GET /tenants` — who has been collected at all, and how stale |
| 2 | `GET /snapshots/current` — my configuration now | `GET /tenants` gives the same header for every customer at once |
| 3 | `GET /snapshots/:id` — one snapshot as a completeness document | `GET /snapshots/:id` — same document plus `tenantName`, `entraTenantId`, `triggerRef`, `wfRunId`, `requestedByUserId` |
| 4 | `GET /snapshots/:id/objects?resourceKey=` — the real stored objects | `GET /snapshots/:id/objects?resourceKey=` — identical, book-scoped |
| 5 | `GET /changes` — what changed since last time, **with a verdict roll-up (#2759)** | `POST /diffs` — four named comparison modes, not just drift |
| 6 | `GET /changes/:diffId` — one comparison, **each change carrying its own verdict** | `GET /diffs`, `GET /diffs/:diffId` — comparison history and detail across the book, **verdict roll-up included** |
| 7 | *(none)* | `POST /collections` — **trigger a collection.** The only producer path. |
| 8 | *(none)* | `GET /collections/:runId` — follow that run, with real workflow node logs |
| 9 | *(none)* | `GET /registry`, `GET /registry/summary` — what this platform can read at all, and what it cannot and why |
| 10 | *(none)* | `GET /baselines`, `POST /baselines`, `PATCH /baselines/:id` — declare / list / retire a known-good reference |
| 11 | *(none)* | `GET /diffs/rules` — the noise ruleset, with the measurement behind each suppression |
| 12 | *(none, new since #1844)* | `POST /diffs/:diffId/attribution` — **run or re-run the #2759 attribution pass** over one sealed comparison |

**Both operator-surface app directories exist today, and both are still scaffold-only.**
`artifacts/msp-console` — named in #1844 as missing entirely, and closed `not_planned` on
2026-09-03 as a deliberate "reset, not carried forward" per Shane's own call — **now exists on
disk** (`App.tsx`, `main.tsx`, `pages/index.tsx`, `pages/not-found.tsx`), created since that
closure as part of the same #1571 epic reset, but is a bare scaffold with no config-state page.
`artifacts/portal` has grown from 2 files to 4 (`index.tsx`, `not-found.tsx`, `coming-soon.tsx`,
`support.tsx` — still no config-state page). Both surfaces in this pack remain endpoints-only.

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

## 2. Error responses — now ONE shape, platform-wide (fixed since #1844)

**This section changed completely since the original pack.** #1844 documented two structurally
different error envelopes on these same endpoints — the route handlers' own errors as
`{ error: { code, message } }` and the auth middleware's 401/403 as a bare
`{ error: "<string>" }` — filed as a finding (#2113) because a client parsing only one shape saw
a blank error on the other. **#2113 is now closed `complete`.** `requireAuth.ts` was rewritten to
call the same `apiError()` helper the route handlers use
(`artifacts/api-server/src/middlewares/requireAuth.ts:103`, `:153`, `:216`), so every failure on
every endpoint in this pack — middleware or handler — now returns the same shape:

```json
{ "error": { "code": "AUTHENTICATION_REQUIRED", "message": "…", "details": {}, "traceId": "…" } }
```

`details` and `traceId` are both optional and frequently absent. `code` is one of a fixed set
(`artifacts/api-server/src/lib/api-helpers.ts:17-27`):

```
VALIDATION_ERROR · AUTHENTICATION_REQUIRED · FORBIDDEN · NOT_FOUND · CONFLICT ·
RATE_LIMITED · IDEMPOTENCY_KEY_CONFLICT · INTERNAL_SERVER_ERROR · WEBHOOK_INVALID_SIGNATURE
```

Codes actually reachable on the routes in this pack: `AUTHENTICATION_REQUIRED` (401),
`FORBIDDEN` (403), `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `CONFLICT` (409),
`INTERNAL_SERVER_ERROR` (500 and the 503 case). `RATE_LIMITED`, `IDEMPOTENCY_KEY_CONFLICT` and
`WEBHOOK_INVALID_SIGNATURE` are real codes on other parts of the API, not this one.

**Design consequence, now simpler than the original pack stated:** an error renderer needs to
handle exactly one shape, always an object, `error.code` always one of the fixed set above.
There is no longer a bare-string case to special-case.

### 2.1 Every non-200 in this subsystem

| Status | Code | When |
|---|---|---|
| 401 | `AUTHENTICATION_REQUIRED` | No/non-Bearer header; expired or invalid token |
| 403 | `AUTHENTICATION_REQUIRED`\* | Role below the floor (`requireRole`'s own message uses the same code as the missing-token case — see below) |
| 403 | `FORBIDDEN` | Authenticated but no `customerId` claim on the session (portal only) |
| 400 | `VALIDATION_ERROR` | Bad enum value; missing `resourceKey`; non-integer `tenantId`/`runId`; bad `view`; non-uuid `baselineId`; missing/blank `name`, `retiredReason`; `baselineId` on the wrong mode; a differ refusal (see §6.6) |
| 404 | `NOT_FOUND` | Snapshot/diff/baseline/run/customer not found **or not in scope** |
| 409 | `CONFLICT` | Baseline name already taken for this MSP; baseline snapshot not `sealed`; baseline retired; collection workflow has no published version or hit its concurrency limit; **attribution run over a non-`sealed` diff (new, #2759)** |
| 503 | `INTERNAL_SERVER_ERROR` | The `__system__: Tenant Configuration Snapshot` workflow definition is not seeded in this environment |
| 500 | `INTERNAL_SERVER_ERROR` | Unhandled failure; message is per-endpoint prose |

\* Read `requireRole`'s call site directly: `apiError(res, 403, ApiErrorCode.FORBIDDEN, ...)` at
`requireAuth.ts:216` — the role-floor rejection uses `FORBIDDEN`, not `AUTHENTICATION_REQUIRED`.
The unified envelope means the two codes are now reliably distinguishable by `error.code` alone,
which was not true of the old two-shape split.

**A refused snapshot pair on `GET /changes` is a 200, not an error** — see §5.5. **A diff read
whose attribution pass has not run yet is also a 200**, with `attribution: { attributed: false,
... }` rather than an error — see §6.9.

---

## 3. The real enums, in full

Every value below is in the code today, re-read from the schema on 2026-09-04. Two families
grew since the original pack; both are called out.

**`SNAPSHOT_STATUSES`** — `running` · `sealed` · `failed` · `abandoned`
Unchanged. `sealed` says the snapshot is immutable (enforced by database trigger). It says
**nothing** about completeness — `isComplete` answers that separately. `failed` runs are kept,
because a record of a failed collection is evidence. `abandoned` is set by a later sweep for a
run whose process died (`sweepAbandonedSnapshots`, 6-hour default cut-off).

**`SNAPSHOT_RESOURCE_STATUSES`** — `collected` · `empty` · `partial` · `skipped` · `failed`
Unchanged. The `collected`/`empty` split is the point of the whole table.

**`SNAPSHOT_SKIP_REASONS` — 13 today, GREW BY 2 since #1844's 11 (Git #2115).**
`permission_denied` · `license_required` · `service_not_configured` · `no_executor` ·
`transport_error` · `cmdlet_unavailable` · `not_supported_app_only` ·
**`not_applicable_to_account_type`** (new) · **`endpoint_not_found`** (new) ·
`identity_unresolved` · `not_collectable` · `budget_exhausted` · `unknown_error`.
The two new values exist because #1844's own §11 filed the fact that `unknown_error` was the
single largest failure class (304 of 778, 39%) with real HTTP signal going unused. #2115 fixed
`classifySnapshotFailure()` (`config-snapshot-collector.ts:601`) to read that signal:
`endpoint_not_found` for a 404 the resource model shouldn't have targeted at this Graph version;
`not_applicable_to_account_type` for `AADSTS500011`/"not supported for AAD accounts" and similar
tenant-shape mismatches. Re-measured on a fresh full collection this session (§4.2):
`unknown_error` dropped from 39% of failures to **22%** (203 of 917) — a real, large
improvement, not a full resolution; some genuinely unclassifiable failures remain and always
will on a surface this wide.

**`SNAPSHOT_TRIGGERS`** — `manual` · `scheduled` · `workflow` · `api`. Unchanged.

**`SNAPSHOT_IDENTITY_STRATEGIES`** — `graph-id` · `graph-singleton` · `dsc-identity` ·
`composite-key` · `content-hash` · `unresolved`. Unchanged.
`content-hash` is a labelled last resort: a modified object pairs with nothing and reads as a
delete plus an add, which is why `object_unpairable` exists. **Still zero rows on `content-hash`
today** — re-verified this session — so `object_unpairable` remains unreachable on real data.

**`SNAPSHOT_SHAPE_PROVENANCE`** — `observed_live` · `derived_from_graph_metadata` ·
`derived_from_dsc` · `none`. Unchanged.

**`SNAPSHOT_HASH_ALGORITHMS`** — `jcs-sha256` (RFC 8785 canonicalisation, then SHA-256, hex).
Unchanged.

**`CONFIG_DIFF_MODES`** — `drift` · `baseline_assessment` · `tenant_compare` · `promotion`.
Unchanged.

**`CONFIG_DIFF_STATUSES`** — `computing` · `sealed` · `failed`. Unchanged.

**`CONFIG_DIFF_TRIGGERS`** — `manual` · `scheduled` · `workflow` · `api`. Unchanged.

**`CONFIG_DIFF_COMPARABILITY`** — `comparable` · `partially_comparable` · `not_comparable`.
Unchanged.

**`CONFIG_DIFF_CHANGE_KINDS`** (10) — `property_changed` · `property_added` ·
`property_removed` · `array_member_added` · `array_member_removed` · `array_reordered` ·
`object_added` · `object_removed` · `object_indeterminate` · `object_unpairable`. Unchanged.
`object_removed` is the **only** row that ever means "this was deleted", and it is reachable
only when both sides read successfully.

**`CONFIG_DIFF_RULE_ACTIONS`** — `ignore` · `always_report`. Unchanged.
**`CONFIG_DIFF_RULE_BASIS`** — `observed_volatile` · `structural_annotation` ·
`operator_declared`. Unchanged. Still zero `observed_volatile` and zero `operator_declared`
rules on real data (§6.7).

**`CONFIG_BASELINE_PURPOSES`** — `known_good` · `promotion_source`. Unchanged.

**`CONFIG_READ_TRANSPORTS` — 8 today, GREW BY 1 since #1844's 7.** `graph` · `powershell` ·
`sharepoint-admin` · `dns` · `azure-rm` · **`azure-devops`** (new) · `power-platform` ·
`unknown`. Real rows exist on `azure-devops` today (4, all `not_collectable`/`no_executor` — no
executor for this transport, same structural gap `azure-rm` and `power-platform` already
document, not a new kind of gap). `dns` has moved from **zero** real rows in the original pack
to **1 real collectable row** — see §4.1 and §4.4 for the live proof.

**`CONFIG_SURFACES`** (20) — unchanged, same 20 values as #1844: `identity` · `directory` ·
`policy` · `applications` · `groups` · `teams` · `collaboration` · `device-management` ·
`sharing` · `exchange` · `security` · `compliance` · `licensing` · `reporting` · `integration` ·
`copilot` · `power-platform` · `azure` · `tooling` · `other`.

**`CONFIG_AVAILABILITY`** — `available_now` · `needs_additional_scope` · `needs_license` ·
`unavailable` · `unknown`. Unchanged (5 values).

**Workload** is *not* a locked enum — free text on the registry row. **18 distinct workloads are
registered today** (was 17): `MicrosoftGraph` · `Intune` · `ExchangeOnline` · `AzureAD` ·
`Teams` · `SecurityCompliance` · `SharePointOnline` · `Other` · `Azure` · `Microsoft365Admin` ·
`PowerPlatform` · `Planner` · `Defender` · `Microsoft365DSC` · **`PublicDNS`** (new, backs the
new `dns` transport) · `OneDriveForBusiness` · `Fabric` · `Commerce`. A resource key with no
registry match is labelled **`"unregistered"`** by the view layer rather than dropped.

### 3.1 New this regeneration — the #2759 change-attribution enums

None of these existed at #1844's pack time. All four live in
`lib/db/src/schema/config-attribution.ts`, alongside the tables in §6.9.

**`CONFIG_CHANGE_VERDICTS`** (5) — the verdict on one `config_diff_changes` row, written for
**every** row including ignored ones:
`attributed_change` · `accepted_risk` · `contested` · `unattributed` · `ignored`.
`attributed_change` = a real, executed change request covers it (expected). `accepted_risk` = an
active risk decision covers it (known, deliberately carried). `contested` = **both** cover it —
a real state, not a tie the engine breaks for you; both edges are kept and a human resolves it.
`unattributed` = neither covers it — the honest "needs review" state. `ignored` = the diff row is
itself noise-suppressed (`is_ignored` true on `config_diff_changes`), kept as its own verdict
rather than folded into `unattributed` because noise and unexplained change are different
findings.

**`CONFIG_CHANGE_SCOPE_SOURCES`** (2) — `change_request` · `risk_decision`. The two real,
already-populated platform stores that can explain a change; neither is invented here.

**`CONFIG_CHANGE_SCOPE_BASES`** (5), ordered strongest evidence to weakest — the audit trail for
how a scope (the CR/risk-decision → resource-key bridge) was derived: `execution_record` (read
off `cr_executions`, the endpoint a CR *actually wrote*) · `template_endpoint` (walked from the
CR's config pack template, describes intent not outcome) · `graph_endpoint` (from
`msp_risk_decisions.graph_endpoint`) · `check_key` (from a risk decision's monitor check, only
when a real config-resource mapping exists) · `declared` (an operator stated it directly —
weakest as evidence, kept separate so a re-derivation never silently erases a human's claim).

**`CONFIG_CHANGE_MATCH_SCOPES`** (3) — `property` · `object` · `resource`, most to least
precise. A scope naming only a resource type covers every object and property under it; one
naming a property path covers exactly that.

**`CONFIG_CHANGE_LIFECYCLE_STATUSES`** (3) — `open` · `resolved` · `reopened`. Tracks one
`(tenant, resource, object, raw property path)` triple across successive `drift`-mode
comparisons only (not `baseline_assessment`/`tenant_compare`/`promotion`, which are not a time
series). **Resolution requires an OBSERVED return to the original value — absence from a later
diff is never resolution.** A `drift` diff compares consecutive snapshots; a setting that moved
once and then sat still emits no row on the next scan, and closing on absence would silently
mark every unfixed drift resolved on the very next scan.

---

## 4. Real volume and fan-out — measured, not estimated

**All figures in this section were re-measured on 2026-09-04**, most from a fresh, live, full
collection run triggered in this session (`collect-config-snapshot.ts`, real Graph/PowerShell
calls against the testbed tenant, producing snapshot row 110) and a fresh comparison run
(`verify-1797-differ.ts`, producing diff row 221) — not copied from the 8/31 pack. Historical
figures are kept only where explicitly labelled historical, for the specific comparisons that
need them (e.g. §4.2's before/after on the registry shrink).

### 4.1 The registry — what the platform can read at all, and how it changed

| | #1844 (8/31) | **Today (9/4)** |
|---|---|---|
| Registered resource types | 1,539 | **1,541** |
| Collectable | 1,359 | **1,092** |
| Not collectable | 180 | **449** |

**This is a real, honest 20% shrink in the collectable set, not drift or noise.** Three
corrections landed between the two pack dates and each is independently confirmed in code:

- **#1960** — `build-resource-model.mjs`'s `readTransportFor()` mislabelled any DSC resource
  with a `Get-Mg*` cmdlet or a bare `graph` permission workload as `graph` transport even when
  no literal REST path existed to call it. Fixed; migration
  `2026-09-04-config-resource-graph-transport-1960.sql` reclassified 193 rows `graph`→
  `powershell`, 2 to `unknown`.
- **#2841 — the single biggest driver.** `build-snapshot-registry.mjs` marked every
  `powershell`-transport row `is_collectable=true` just because the transport itself was
  executor-backed, without checking whether the specific cmdlet had a real ps-execution catalog
  entry. Fixed with `hasCatalogedPsCmdlet()` gating `is_collectable`; of 404 `powershell` rows
  previously `true`, only 88 remained `true` — **316 flipped to `false`/`no_executor`.**
- **#2010** added the real `dns` transport (§3), moving one resource
  (`dns:txt:email-authentication`) onto it as genuinely collectable — the one register-count
  increase in the mix.

Not-collectable reasons, re-measured: `no_executor` **292** (was 28) · `not_collectable` **127**
(was 124) · `identity_unresolved` **30** (was 28). The `no_executor` jump is #2841's honest
shrink made visible in the classification, not a regression — these resources were never really
reachable; the registry simply said so incorrectly before.

By transport (collectable / not collectable), re-measured:

| Transport | Collectable | Not collectable |
|---|---|---|
| `graph` | 926 | 156 |
| `powershell` | 142 | 263 |
| `sharepoint-admin` | 23 | 0 |
| `dns` | **1** | 0 |
| `azure-rm` | 0 | 18 |
| `azure-devops` | 0 | **4** |
| `power-platform` | 0 | 6 |
| `unknown` | 0 | 2 |

By availability: `available_now` 653 · `needs_additional_scope` 502 · `unknown` 357 ·
`unavailable` 24 · `needs_license` 5.

By shape provenance: `derived_from_graph_metadata` 991 · `derived_from_dsc` 352 ·
`observed_live` 153 · `none` 45.

By identity strategy: `graph-id` 697 · `dsc-identity` 415 · `graph-singleton` 355 ·
`composite-key` 44 · `unresolved` 30. **Still no type uses `content-hash`.**

By collectable workload (10 of the 18 registered workloads have at least one collectable type
today): `MicrosoftGraph` 852 · `ExchangeOnline` 59 · `Teams` 56 · `AzureAD` 35 · `Intune` 34 ·
`SecurityCompliance` 28 · `SharePointOnline` 23 · `Microsoft365Admin` 3 · `PublicDNS` 1 ·
`OneDriveForBusiness` 1.

A note on the metadata-only corrections (**not** registry-count drivers): **#1929** added an
`operation` coverage state for 129 bound Graph Functions in the *separate* `config_resources`
coverage-measurement table (`docs/graph-resource-model.md`'s 1,410-eligible figure) — functions
were already excluded from *this* registry (`config_snapshot_resource_types`) before #1844's
pack was written, so it does not move any number in this section. **#2839** fixed a fake
cmdlet-citation bug (`Get-MSCloudLoginConnectionProfile`, an M365DSC internal helper, wrongly
listed as a real read cmdlet) across 4 transports — `read_cmdlets` metadata correctness, not a
collectability flip.

### 4.2 A real full snapshot — the headline numbers, freshly collected 2026-09-04

Snapshot row **110** (`b125d2a4-44fa-4cb7-be3c-0028d1e0d952`), captured live in this session,
against the real testbed tenant, through `collectTenantConfigSnapshot()` — the exact production
path, not a simulation:

| | Row 10 (8/30, historical) | **Row 110 (9/4, live today)** |
|---|---|---|
| Resource types targeted | 1,359 | **1,092** |
| collected | 93 | **90** |
| empty | 62 | **61** |
| partial | 1 | **1** |
| skipped | 425 | **23** |
| failed | 778 | **917** |
| Objects stored | 50,176 | **50,464** |
| Wall-clock (captured → sealed) | 3 m 43 s | **2 m 19 s** |
| `readableFraction` | 0.11405445180279618 | **0.1382783882783883** |

**13.8% of the (now smaller, more honest) model is readable on a real, consented tenant today —
up from 11.4%, but read that rise correctly: the numerator (90+61=151 vs 93+62=155) barely
moved; the denominator shrank because #2841 removed resources that were never really reachable.
This is not the platform reading more of the tenant — it is the registry telling the truth about
what it could always read.** `skipped` fell sharply (425→23) for the same reason: most of what
used to be `skipped/no_executor` is no longer *targeted* at all, because the registry now
correctly marks those types `is_collectable=false` up front. `failed` rose in raw count (778→917)
because the targeted set shifted composition (fewer PowerShell-only long-tail types, more
Graph-reachable-but-license-gated ones) — see the reason breakdown below.

**Skip/fail reasons on snapshot 110** (13 real skip reasons possible; 7 actually occurred):

| Status | Reason | Count | vs row 10 |
|---|---|---|---|
| failed | `permission_denied` | 227 | was 272 |
| failed | `license_required` | 218 | was 174 |
| failed | `unknown_error` | 203 | **was 304 — #2115's fix, live** |
| failed | `endpoint_not_found` | **137** | new reason, #2115 |
| failed | `not_applicable_to_account_type` | **104** | new reason, #2115 |
| collected | *(null)* | 90 | was 93 |
| empty | *(null)* | 61 | was 62 |
| failed | `transport_error` | 27 | was 27 |
| skipped | `no_executor` | 23 | was 228 (registry now excludes most of these from targeting) |
| partial | `budget_exhausted` | 1 | was 1 |
| failed | `not_supported_app_only` | 1 | was 0 |

`unknown_error`'s share of all failures fell from **39% (304/778) to 22% (203/917)** — a real,
measured improvement from #2115, not a full resolution. Two real examples of the new reasons,
captured verbatim from row 110:

```json
{
  "resourceKey": "graph:beta:/deviceManagement/monitoring",
  "status": "failed", "skipReason": "endpoint_not_found",
  "httpStatus": 404, "errorCode": "UnknownError",
  "reasonDetail": "UnknownError: {\"error\":{\"code\":\"UnknownError\",\"message\":\"\",\"innerError\":{\"date\":\"2026-09-04T19:21:58\",\"request-id\":\"b885af8f-909f-4d15-a849-c0e41199125a\"}}}"
}
```

```json
{
  "resourceKey": "graph:beta:/deviceManagement/zebraFotaConnector",
  "status": "failed", "skipReason": "not_applicable_to_account_type",
  "httpStatus": 400, "errorCode": "BadRequest",
  "reasonDetail": "{\"error\":{\"code\":\"BadRequest\",\"message\":\"Request not applicable to target tenant.\",\"innerError\":{\"date\":\"2026-09-04T19:21:59\",\"request-id\":\"a9fe361c-e367-40ae-bb9a-a86960a925fe\"}}}"
}
```

**Real HTTP evidence on the failures**, re-measured: `400 BadRequest` 141 · `404 UnknownError` 79
· `503 intune-backend-iis-503` 79 · `403 UnknownError` 65 · `401 intune-legacy-devicefe-401` 64 ·
`401 intune-forbidden-envelope-401` 42 · `403 accessDenied` 36 · *(null status, null code)* **142**
· `400 UnknownError` 26 · `403 Forbidden` 22 · `403 NoLicense` 21 · `403
Authorization_RequestDenied` 20 · `500 UnknownError` 18 · `400 AuthenticationError` 15 · `401
UnknownError` 15. The no-wire-evidence class rose from 32 to **142** rows in raw count (still
proportionate — the targeted set is smaller) — `reasonDetail` remains the only explanation for
those.

### 4.3 Per-workload roll-up, snapshot 110

Ten workloads appear on this snapshot (was 16 on row 10) — a direct consequence of the
registry shrink: several workloads (`Planner`, `Defender`, `Microsoft365DSC`, `Azure`,
`Commerce`, `Fabric`, `PowerPlatform`) currently have zero collectable types after #2841's
correction, so they target nothing and cannot appear on a run. This is exactly what §4.1's
number says in a different shape — verify a workload roll-up's row count against the registry's
per-workload collectable count before treating a missing workload as a bug.

| Workload | Types | Objects | collected | empty | partial | skipped | failed |
|---|---|---|---|---|---|---|---|
| MicrosoftGraph | 852 | 49,627 | 73 | 45 | 1 | 0 | 733 |
| ExchangeOnline | 59 | 504 | 1 | 0 | 0 | 0 | 58 |
| Microsoft365Admin | 3 | 104 | 1 | 0 | 0 | 0 | 2 |
| SharePointOnline | 23 | 99 | 1 | 0 | 0 | 22 | 0 |
| AzureAD | 35 | 76 | 12 | 15 | 0 | 0 | 8 |
| **PublicDNS** | 1 | 36 | 1 | 0 | 0 | 0 | 0 |
| Teams | 56 | 18 | 1 | 0 | 0 | 0 | 55 |
| SecurityCompliance | 28 | 0 | 0 | 1 | 0 | 0 | 27 |
| OneDriveForBusiness | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| Intune | 34 | 0 | 0 | 0 | 0 | 0 | 34 |

**`PublicDNS` is new this session and is the live proof #2010 asked for.** One resource type,
`dns:txt:email-authentication`, collected 36 real TXT-record objects off the tenant's real public
DNS — the DNS transport genuinely works end to end, not just in the enum.

**Teams flipped from mostly-skipped to mostly-failed, and that is #2850 working as intended, not
a regression.** On row 10, Teams was 64 types / 25 objects / 62 `skipped(no_executor)` — the
ps-execution catalog had no entries for most Teams cmdlets at all. #1961/#2850 added 120
unfiltered catalog entries (63 Exchange/Purview + 57 Teams `Get-Cs*`), so those types are now
genuinely *attempted* — and the tenant's real answer to most of them is a permission/license
failure, not silence. Being told "yes, we tried, and you're not licensed for this" is strictly
more honest than "no executor exists," even though the raw failed-count looks worse.

**Intune remains the shape to design for.** 34 resource types (down from 162 — most Intune types
are no longer collectable after #1960/#2841), **zero objects**, all 34 failed. The tenant-level
service-state reasoning from Git #1847 is unchanged and is now surfaced through the collector's
own monitor-executor integration (`monitor-executor: Intune is not answering for this tenant
(#1847) — resolving to a tenant-level service state, not zero rows`, observed live this session).
**The workload card must still be able to say "unavailable — not licensed", with that sentence
available on drill-down.**

### 4.4 Fan-out — where a single resource type explodes

Re-measured on snapshot 110. Object counts remain extremely skewed — the same two resource types
that dominated row 10 still dominate:

| Resource key | Status | Objects | Pages | Duration |
|---|---|---|---|---|
| `graph:v1.0:/applicationTemplates` | collected | **39,089** | 14 | 41,352 ms |
| `graph:v1.0:/schemaExtensions` | **partial** | **5,000** | **50** | 6,528 ms |
| `graph:beta:/auditLogs/auditActivityTypes` | collected | 3,455 | 1 | 6,955 ms |
| `graph:v1.0:/servicePrincipals` | collected | 504 | 6 | 2,659 ms |
| `graph:v1.0:/security/secureScoreControlProfiles` | collected | 460 | 3 | 1,915 ms |
| `graph:v1.0:/auditLogs/directoryAudits` | collected | 281 | 1 | 2,545 ms |
| `graph:v1.0:/admin/serviceAnnouncement/issues` | collected | 224 | 3 | 2,957 ms |
| `graph:beta:/reports/servicePrincipalSignInActivities` | collected | 200 | 1 | 3,991 ms |
| `graph:v1.0:/directoryRoleTemplates` | collected | 145 | 1 | 927 ms |
| `graph:v1.0:/roleManagement/directory/roleDefinitions` | collected | 145 | 1 | 731 ms |
| `graph:v1.0:/security/attackSimulation/trainings` | collected | 130 | 3 | 15,346 ms |
| `graph:v1.0:/groups` | collected | 104 | 2 | 629 ms |
| `graph:beta:/reports/identityAnalytics/groups` | collected | 104 | 1 | 2,512 ms |
| `graph:v1.0:/sites` | collected | 99 | 1 | 689 ms |
| `graph:v1.0:/security/secureScores` | collected | 90 | 1 | 1,205 ms |
| `graph:v1.0:/roleManagement/directory/resourceNamespaces` | collected | 74 | 1 | 182 ms |
| `graph:v1.0:/oauth2PermissionGrants` | collected | 39 | 1 | 308 ms |
| **`dns:txt:email-authentication`** | collected | **36** | 1 | 747 ms |
| `graph:v1.0:/users` | collected | 24 | 1 | 275 ms |

**`graph:v1.0:/schemaExtensions` still hits the collector's page cap at 50 pages**, now 5,000
objects (was 4,949) and still `partial`/`budget_exhausted` — the live proof that truncation
remains real and current, not a one-time artefact. A resource row must show `partial` distinctly
from `collected`, or a customer will read a truncated list as complete.

**Object identity distribution on snapshot 110:** `graph-id` 50,378 · `graph-singleton` 50 ·
`dsc-identity` unchanged at effectively zero on this run · `composite-key` 36 (the DNS TXT
records, keyed by record content — a new, real user of `composite-key` beyond what #1844
observed). Still **50 singletons**, unchanged from row 10.

### 4.5 Page-size caps — unchanged, still real

From `config-state-views.ts`, re-verified byte-for-byte identical to #1844:

| Constant | Default | Max | Why |
|---|---|---|---|
| `SNAPSHOT_LIST_PAGE` | 25 | 200 | |
| `RESOURCE_PAGE` | 200 | 1,000 | |
| `OBJECT_PAGE` | **25** | **100** | 100 × the largest observed object is still tens of MB |
| `CHANGE_PAGE` | 100 | 500 | |
| `REGISTRY_PAGE` | 200 | 1,000 | |

`limit`/`offset` clamping, the `?include=summary` SQL-conditional field drop, and the uniform
`{ total, limit, offset, hasMore }` paging envelope are all unchanged from #1844.

### 4.6 Comparison volume and cost — a fresh real diff

**Diff row 221** (`d9cdfe2f-0630-4e5c-b99e-5a2ea445f5a0`, mode `drift`, snapshot **10 → 110**),
computed live in this session through the real `diffSnapshots()` path:

| | Diff 9 (8/30→8/31, historical) | **Diff 221 (8/30→9/4, live today)** |
|---|---|---|
| Resource types compared | 155 | **150** |
| partially comparable | 1 | **1** |
| not comparable | 1,203 | **1,210** |
| `comparableFraction` | 0.11405445180279618 | **0.11029411764705882** |
| Objects paired | 50,121 | **50,137** |
| added / removed / indeterminate / unpairable | 52 / 3 / 3 / 0 | **240 / 21 / 51 / 0** |
| Changes total / significant / ignored | 340 / 340 / 0 | **882 / 882 / 0** |
| Duration | 32,181 ms | **5,379 ms** |
| `differVersion` | 1797.1 | 1797.1 (unchanged) |
| `rulesetFingerprint` | `d246a9e1…af09151` | **identical — unchanged, 6 active rules** |
| `resourceKeysFingerprint` | *(field did not exist yet)* | **`*`** (unscoped, full-tenant — see §10 on Git #2032) |

The base side of this diff (snapshot 10) is the same historical row #1844 used; the head side
(110) is today's fresh collection — so this diff spans **five real days of the same tenant's
actual configuration drift**, not a same-day pair. **1,210 of 1,360 possible resource-type pairs
were not comparable** — still the dominant fact about every real comparison this platform has
ever produced. `comparableFraction` fell slightly (11.4%→11.0%) because the registry shrink
changed which pairs even have two sides to compare.

**Change kinds actually emitted on diff 221:** `property_changed` 326 · `object_added` 240 ·
`property_removed` 165 · `property_added` 79 · `object_indeterminate` 51 · `object_removed` 21.
Still **zero ignored**, still no `array_member_added`/`array_member_removed`/`array_unpairable`
row ever produced on real data.

**Changes remain concentrated, on a different resource than before:**
`graph:v1.0:/security/secureScores` 285 · `graph:v1.0:/auditLogs/directoryAudits` 149 ·
`graph:beta:/reports/identityAnalytics/groups` 108 · `graph:v1.0:/schemaExtensions` 100 ·
`graph:beta:/auditLogs/auditActivityTypes` 84 · `graph:v1.0:/admin/serviceAnnouncement/issues`
70 · `graph:beta:/reports/sla/azureADAuthentication` 59 · four more resources under 15 each.
Seven resource types again produce nearly every real change — the same shape #1844 found on a
different tenant snapshot pair, now re-confirmed across a genuinely different time window.

The historical diffs 7, 9, 10 and 11 from #1844's pack are unchanged rows in the store (retention
protects any snapshot referenced by a diff — see §8) and remain real, valid evidence of the
degenerate "nothing comparable" case documented there. Diff 221 is additive evidence, not a
replacement for what they showed.

### 4.7 Cost of a comparison, and the stampede guard

Unchanged mechanism from #1844. `GET /api/portal/config-state/changes` computes the diff on
first request; a per-tenant in-flight `Map` collapses concurrent callers onto one computation.
`?compute=false` returns only an already-stored comparison. The result is cached on `(base, head,
mode, rulesetFingerprint, resourceKeysFingerprint)` — the cache key **grew by one field since
#1844** (see §10 for why).

---

## 5. Customer endpoints — full contracts

Mount prefix: `app.use("/api", router)` (`app.ts:115`), routers registered at
`routes/index.ts`. All paths below are the externally-visible paths. Shapes below are unchanged
from #1844 except where called out — the route contracts themselves did not change this cycle,
only the error envelope (§2), the enum value sets feeding them (§3), and the new `attribution`
field on the two comparison endpoints (§5.5, §5.6, matching §6.9).

### 5.1 `GET /api/portal/config-state/snapshots`

Role `CustomerUser`. Scope: JWT `customerId` only. Unchanged contract.

**Query:** `status?` (one of `SNAPSHOT_STATUSES`, else 400) · `limit?` (def 25, max 200) ·
`offset?`

**Response 200** — real, from the testbed, snapshot 110 as the newest row:

```json
{
  "snapshots": [
    {
      "id": 110,
      "snapshotId": "b125d2a4-44fa-4cb7-be3c-0028d1e0d952",
      "tenantId": 1,
      "tenantName": "Jane Jane",
      "capturedAt": "2026-09-04T19:21:55.941Z",
      "status": "sealed",
      "trigger": "manual",
      "completeness": {
        "isComplete": false,
        "status": "sealed",
        "capturedAt": "2026-09-04T19:21:55.941Z",
        "resourceTypesTargeted": 1092,
        "resourceTypesCollected": 90,
        "resourceTypesEmpty": 61,
        "resourceTypesPartial": 1,
        "resourceTypesSkipped": 23,
        "resourceTypesFailed": 917,
        "objectCount": 50464,
        "readableFraction": 0.1382783882783883,
        "collectorVersion": "1796.1",
        "error": null
      }
    }
  ],
  "paging": { "total": 8, "limit": 2, "offset": 0, "hasMore": true }
}
```

Ordered by `capturedAt` descending. Nullability rules unchanged from #1844: `tenantName` is
`string | null`, `collectorVersion` is `string | null` (still `"1796.1"` — the collector's
version constant has not moved even though its classifier logic has), `error` is `string | null`.

### 5.2 `GET /api/portal/config-state/snapshots/current`

Role `CustomerUser`. Registered **before** `/:id`. Unchanged contract; returns the most recent
**sealed** snapshot (`running`/`failed`/`abandoned` excluded).

**Response 200, no snapshot yet** — still the real state of every tenant except `id = 1`:

```json
{
  "snapshot": null,
  "collected": false,
  "reason": "no_sealed_snapshot",
  "detail": "No sealed configuration snapshot exists for this tenant yet. A snapshot is captured by the Tenant Configuration Snapshot workflow; until one has run and sealed, there is nothing to report — which is not the same as reporting that the tenant has no configuration."
}
```

`tenants.id = 3` (`shanemccaw.onmicrosoft.com`) still has **zero** snapshots — re-confirmed this
session. Design this screen first, not last.

**Response 200, snapshot present** — same envelope shape as #1844 (`workloads[]` is always the
whole-snapshot roll-up, `resources[]` is the paged array).

### 5.3 `GET /api/portal/config-state/snapshots/:id`

Role `CustomerUser`. `:id` accepts integer row id or uuid `snapshotId`. Unchanged contract.

**Query:** `workload?` · `status?` (one of `SNAPSHOT_RESOURCE_STATUSES`) · `limit?` · `offset?`

**Real `resources[]` rows, from snapshot 110** (the two new #2115 skip reasons, real):

```json
[
  {
    "resourceKey": "graph:beta:/deviceManagement/monitoring",
    "displayName": "/deviceManagement/monitoring",
    "surface": "device-management", "workload": "MicrosoftGraph", "readTransport": "graph",
    "status": "failed", "skipReason": "endpoint_not_found",
    "reasonDetail": "UnknownError: {\"error\":{\"code\":\"UnknownError\",\"message\":\"\",\"innerError\":{\"date\":\"2026-09-04T19:21:58\",\"request-id\":\"b885af8f-909f-4d15-a849-c0e41199125a\"}}}",
    "objectCount": 0, "pageCount": null, "httpStatus": 404, "errorCode": "UnknownError",
    "durationMs": 165, "attemptedAt": "2026-09-04T19:24:14.568Z"
  },
  {
    "resourceKey": "dns:txt:email-authentication",
    "displayName": "email-authentication", "surface": "exchange", "workload": "PublicDNS",
    "readTransport": "dns", "status": "collected", "skipReason": null, "reasonDetail": null,
    "objectCount": 36, "pageCount": 1, "httpStatus": null, "errorCode": null,
    "durationMs": 747, "attemptedAt": "2026-09-04T19:23:47Z"
  }
]
```

Nullability table for `SnapshotResourceRow` is unchanged from #1844 (see §3 for the enum values
now filling `skipReason`).

### 5.4 `GET /api/portal/config-state/snapshots/:id/objects`

Role `CustomerUser`. **`?resourceKey=` is required** — 400 otherwise. `include?` = `summary` |
`full` (default `full`). `limit?` (def 25, max 100) · `offset?`. Unchanged contract from #1844.

**Real singleton object, re-read from snapshot 110 — byte-identical hash to the one #1844 showed
from snapshot 10, real proof this setting has not changed across 5 real days:**

```json
{
  "resourceKey": "graph:v1.0:/policies/authorizationPolicy",
  "resourceStatus": { "status": "collected", "skipReason": null, "objectCount": 1 },
  "objects": [
    {
      "objectIdentity": "singleton",
      "identityStrategy": "graph-singleton",
      "displayName": "Authorization Policy",
      "objectHash": "76a940be3ff6f52e873f71aa87e959eff6b103c8abc7506a66777baee09f34d6",
      "propertyCount": 12,
      "sourceRef": "v1.0/policies/authorizationPolicy",
      "collectedAt": "2026-09-04T19:22:…Z"
    }
  ],
  "paging": { "total": 1, "limit": 25, "offset": 0, "hasMore": false }
}
```

**The unreadable case still returns 200 with an empty list, not a 404** — same shape as #1844,
now backed by a fresh real example (the `endpoint_not_found` row from §5.3):

```json
{
  "resourceKey": "graph:beta:/deviceManagement/monitoring",
  "resourceStatus": { "status": "failed", "skipReason": "endpoint_not_found", "objectCount": 0 },
  "objects": [],
  "paging": { "total": 0, "limit": 25, "offset": 0, "hasMore": false }
}
```

`objects: []` with a non-`collected` `resourceStatus` must **not** render as "no items" — the
resource status row travels with the objects precisely so a truncated or failed read does not
look identical to a genuinely complete empty one. `resourceStatus: null` (a key with no status
row in this snapshot at all — never targeted, or a typo) remains a third, distinct, still-200
state, unchanged from #1844.

### 5.5 `GET /api/portal/config-state/changes`

Role `CustomerUser`. Resolves the tenant's two most recent sealed snapshots, returns the `drift`
comparison. Same five response shapes as #1844 — **plus `attribution` on shape (e), new since
#2759**:

```json
{
  "comparison": { "diffId": "…", "diffRowId": 0, "mode": "drift", "base": { … }, "head": { … } },
  "available": true,
  "completeness": { "…": "…" },
  "notComparable": { "count": 0, "resources": [ … ], "paging": { … } },
  "byWorkload": [ … ],
  "attribution": {
    "attributed": true,
    "attributionVersion": "attribution-1",
    "attributedAt": "2026-09-04T19:26:11.041Z",
    "counts": { "attributed_change": 0, "accepted_risk": 0, "contested": 0, "unattributed": 882, "ignored": 0 },
    "changeRequests": [],
    "riskDecisions": [],
    "contestedCount": 0
  }
}
```

`attribution` is computed **lazily and non-fatally** on first read (`ensureDiffAttributed`) — a
failure leaves `attribution: null` rather than failing the whole request. `attributed: false`
(pass never ran) is a genuinely different statement from `attributed: true` with every count at
`0` (pass ran, found nothing to attribute) — **the real state of every diff on this platform
today**, since zero change requests and zero tenant-1 risk decisions currently exist (see §6.9).
A customer reading "882 things changed" needs "and 0 of them are explained yet" in the same
breath.

### 5.6 `GET /api/portal/config-state/changes/:diffId`

Role `CustomerUser`. `:diffId` accepts row id or uuid. Entitled on both sides. `view=changes`
(default) | `view=resources`, same query params as #1844.

**Real object-level change row from diff 221, `view=changes`**, now carrying `attribution` and
`lifecycle` (both null in #1844 because #2759 did not exist yet):

```json
{
  "sequence": 107,
  "resourceKey": "graph:beta:/reports/identityAnalytics/groups",
  "objectIdentity": "130b3792-8f1c-4bfc-8595-6effe105004f",
  "changeKind": "property_changed",
  "propertyPath": "calculatedDateTime",
  "oldValuePresent": true, "newValuePresent": true,
  "isIgnored": false, "ignoredByRuleId": null,
  "attribution": {
    "verdict": "unattributed",
    "changeRequestId": null, "crRef": null,
    "riskDecisionId": null, "rbdRef": null,
    "matchScope": null, "matchCount": 0,
    "attributionVersion": "attribution-1",
    "attributedAt": "2026-09-04T19:26:11.041Z"
  },
  "lifecycle": { "status": "open", "firstDetectedAt": "2026-09-04T19:26:11.041Z", "reopenCount": 0 }
}
```

`attribution` is `null` when the pass has not run over the parent diff yet — never flattened
into `verdict: "unattributed"`, which is a real computed answer, not an absence. `lifecycle` is
`null` for change kinds and modes the lifecycle table does not track (§3.1). Every other field
and nullability rule in this response is unchanged from #1844's original §5.6.

---

## 6. Operator endpoints — full contracts

Everything below is `requireRole("MSPOperator")` and book-scoped.

### 6.1 `GET /api/msp/config-state/tenants`

Unchanged contract. **Real response, both testbed tenants, re-verified 2026-09-04:**

```json
{
  "mspId": 1,
  "tenants": [
    { "tenantId": 3, "customerName": "Test Me", "domain": "shanemccaw.onmicrosoft.com",
      "isTestbed": false, "status": "active",
      "latestSnapshot": null, "everCollected": false },
    { "tenantId": 1, "customerName": "Jane Jane", "domain": "mccawsoft2.onmicrosoft.com",
      "isTestbed": true, "status": "active",
      "latestSnapshot": {
        "id": 110, "snapshotId": "b125d2a4-44fa-4cb7-be3c-0028d1e0d952",
        "capturedAt": "2026-09-04T19:21:55.941Z", "trigger": "manual",
        "completeness": { "resourceTypesTargeted": 1092, "resourceTypesCollected": 90,
          "readableFraction": 0.1382783882783883, "objectCount": 50464, "collectorVersion": "1796.1" } },
      "everCollected": true }
  ],
  "collectedCount": 1,
  "neverCollectedCount": 1
}
```

**`tenants.id = 3` remains never-collected — still half the book, still the common case, not an
edge case.** `tenants` count is unchanged at 2 (no new tenant onboarded since #1844).

### 6.2 `GET /api/msp/config-state/snapshots` · `/snapshots/:id` · `/snapshots/:id/objects`

Unchanged contract from #1844, same shapes as §5.1/§5.3/§5.4 plus operator-only fields
(`tenantName`, `entraTenantId`, `triggerRef`, `wfRunId`, `requestedByUserId`).

### 6.3 `POST /api/msp/config-state/collections` — the only producer path

**Operator-only. There is no customer trigger and there must not be one.** Unchanged contract.

**Live-verified again this session** (not just re-read from #1844's prior verification): run
fired through the real `collectTenantConfigSnapshot()` path used by the `config_snapshot_collect`
workflow node, `triggerRef: "docs:2899-regen:full-live-verify"`, completed in 2 m 19 s and
produced snapshot row 110, the source of every number in §4.2–§4.4. **`maxResources` is `number
| null`** — omitted here, meaning "every collectable type", which today means **1,092**, not
1,359.

Errors, roles and the 503/409 conditions are unchanged from #1844.

### 6.4 `GET /api/msp/config-state/collections/:runId`

Unchanged contract.

### 6.5 `GET /api/msp/config-state/registry` and `/registry/summary`

**Deliberately not tenant-scoped.** Unchanged contract; §3 and §4.1 above carry the current real
value sets and counts. The one real registry row cited in #1844's original pack
(`graph:beta:/deviceManagement/androidAppConfigurationSchema`) was re-checked this session and
is **still `is_collectable: true`, unchanged in every field** — kept as the example.

**`/registry/summary`**, current real shape and totals:

```json
{ "total": 1541, "collectable": 1092, "notCollectable": 449,
  "byTransport": [ { "readTransport": "graph", "isCollectable": true, "count": 926 }, "… 8 rows total, not 6 …" ],
  "bySurface": [ "… all 20 surfaces …" ],
  "byAvailability": [ "… all 5 …" ],
  "notCollectableReasons": [ { "notCollectableReason": "no_executor", "count": 292 }, "…" ],
  "byShapeProvenance": [ "…" ] }
}
```

**`byTransport` now returns up to 8 `(readTransport, isCollectable)` pairs, not 6** — `dns` now
has a real collectable row and `azure-devops` is a new transport entirely. `power-platform` and
`unknown` are the transports that can still be entirely absent from a given summary depending on
live data — do not assume every enum member appears.

### 6.6 `GET /api/msp/config-state/diffs` and `POST /api/msp/config-state/diffs`

Unchanged contract and refusal sentences from #1844. **Mode/tenant coherence, cache key shape,
and the four named capabilities are all identical.** See §10 for the one real change to this
route's story — `resourceKeys` is now safe at the differ layer (Git #2032 fixed) but still not
exposed here, which is itself a new, filed finding (§11).

### 6.7 `GET /api/msp/config-state/diffs/rules`

Unchanged. **All 6 active rules, re-verified byte-identical to #1844** — same specificities,
same `*@odata.*` patterns, same `structural_annotation` basis, zero `observed_volatile` and zero
`operator_declared` rules today.

### 6.8 Baselines

Unchanged contract. **The one real baseline on the platform is unchanged** — still points at
snapshot row 10 (`f7ab3e50-…`, the last full snapshot at the pre-#2841 registry size), still
`isActive: true`. It survived the new retention prune (§8) precisely because retention
structurally protects any baseline-referenced snapshot — this baseline is the live proof that
protection works, not just a documented intention.

### 6.9 `GET /api/msp/config-state/diffs/:diffId` — now carries a verdict, and `POST .../attribution` — NEW since #1844 (Git #2759)

`GET /api/msp/config-state/diffs/:diffId` is otherwise unchanged from #1844, but every change row
now carries the same `attribution`/`lifecycle` shape shown in §5.6, and the response envelope
gains a top-level `attribution` roll-up identical in shape to §5.5's:

```json
{ "…shared fields…", "changes": [ "… each with attribution/lifecycle …" ], "byKind": [ … ],
  "attribution": {
    "attributed": true, "attributionVersion": "attribution-1",
    "attributedAt": "2026-09-04T19:26:11.041Z",
    "counts": { "attributed_change": 0, "accepted_risk": 0, "contested": 0, "unattributed": 882, "ignored": 0 },
    "changeRequests": [], "riskDecisions": [], "contestedCount": 0
  } }
```

**`POST /api/msp/config-state/diffs/:diffId/attribution`** — run or re-run the attribution pass
over one sealed diff. `requireRole("MSPOperator")`. No body. **A POST because it writes** —
explicitly re-runnable, because a change request approved after the diff was computed
legitimately turns an `unattributed` row into `attributed_change`, and a revoked risk acceptance
legitimately turns one back. Idempotent: a second run over an unchanged world reproduces the same
verdicts and cannot manufacture a lifecycle transition.

**No apply path here or anywhere in this subsystem.** This reads Change Control and the Risk
Register and writes only its own tables (`config_change_scopes`, `config_change_attributions`,
`config_change_attribution_matches`, `config_change_lifecycle`) — it never modifies a change
request, never modifies a risk decision, and never touches the sealed diff.

**Response 200:**

```json
{
  "diffId": "d9cdfe2f-0630-4e5c-b99e-5a2ea445f5a0",
  "diffRowId": 221, "tenantId": 1,
  "changesAttributed": 882, "scopesDerived": 0, "scopesEligible": 0,
  "verdicts": { "attributed_change": 0, "accepted_risk": 0, "contested": 0, "unattributed": 882, "ignored": 0 },
  "lifecycleOpened": 882, "lifecycleResolved": 0, "lifecycleReopened": 0,
  "window": { "from": "2026-08-31T00:51:15.437Z", "to": "2026-09-04T20:21:55.941Z" }
}
```

**This is real, live-run output from this session, not a hypothetical.** `scopesDerived: 0` and
`scopesEligible: 0` are the honest, currently-true state of the whole platform: **zero real
`msp_change_requests` rows exist anywhere**, and the one real `msp_risk_decisions` row that
exists is not for this tenant — re-confirmed by direct query this session. **Every real diff on
this platform reads 100% `unattributed` today**, not because the engine is broken, but because
nothing has ever been recorded for it to attribute against. A design must not read
`unattributed: 882` as a defect in the attribution engine; it is an honest reflection of zero
Change Control activity on the one tenant this platform has ever collected.

**Errors:** 404 diff not found or not in book. **409** `DiffNotAttributableError` — the diff is
not `status: "sealed"` (e.g. still `computing`) — *"a verdict over an unfinished comparison would
be a verdict over an incomplete set of changes."*

**The window.** The attribution pass bounds eligibility to the real time interval the change
could have happened in — ordered by actual timestamp, not by which snapshot is labelled `base`,
because a `baseline_assessment`'s reference snapshot is frequently *newer* than its subject (a
real, observed case on this platform: diff row 11's base was captured 11 hours after its head).
`WINDOW_TOLERANCE_MS` is **1 hour**, added to both ends.

**Precision and contested claims.** A scope may name a whole resource type, one object, or one
property path — `matchScope` records which. When both an executed change request and an active
accepted risk cover the same row, the verdict is `contested`, both edges are kept
(`config_change_attribution_matches`), and the resolution is a human call — the engine never
silently prefers one.

---

## 7. Empty, partial and unavailable — the states to design first

Ranked by how often they occur on real data today (re-measured 2026-09-04; one state added since
#1844).

| # | State | How it arrives on the wire | Frequency, measured today |
|---|---|---|---|
| 1 | **Resource unreadable** | resource row `status: skipped\|failed` + `skipReason` + `reasonDetail` | **940 of 1,092 types** (86.1%) |
| 2 | **Nothing / little comparable** | `available: true`, `comparableFraction` low, `notComparable.count` near `targeted` | most real comparisons |
| 3 | **Never collected** | `snapshots/current` → `collected: false`; `/tenants` → `everCollected: false` | **1 of 2 tenants, unchanged** |
| 4 | **Genuinely empty** | resource row `status: "empty"`, `objectCount: 0`, `skipReason: null` | **61 of 1,092** |
| 5 | **Only one snapshot** | `reason: "only_one_snapshot"` | every tenant's first change-report view |
| 6 | **Partial / truncated** | `status: "partial"`, `skipReason: "budget_exhausted"` | **1 of 1,092** — `/schemaExtensions`, 5,000 objects at the cap |
| 7 | **Not diffable** | `available: false, reason: "not_diffable"`, **HTTP 200** | reachable whenever a snapshot is `running` |
| 8 | **Not computed yet** | `reason: "not_yet_computed"` | only under `?compute=false` |
| 9 | **Empty book** | `{ tenants: [], collectedCount: 0 }` etc. | a new MSP |
| 10 | **Unregistered resource** | `workload: "unregistered"` | 0 today |
| 11 | **No status row for the key** | `resourceStatus: null` | a mistyped `resourceKey` |
| 12 | **Abandoned snapshot** | `status: "abandoned"` | 0 today |
| 13 | **Not yet attributed (NEW, #2759)** | `attribution: null` on a change row or roll-up | reachable until the lazy pass runs, or on a diff nobody has read yet |
| 14 | **Attributed but unexplained (NEW, #2759)** | `attribution.verdict: "unattributed"` | **100% of real changes today (882 of 882)** — see §6.9 |

**None of these is an error.** Cases 13 and 14 are new and are the current majority state of
every real diff on this platform — a design must distinguish "we have not looked yet" (13) from
"we looked, and nothing explains this" (14), the same discipline §0.1 already requires for
collection.

**Rules carried forward from #1844, still true, re-verified against fresh data:**

1. Never render a missing value as `0`.
2. Never render `readableFraction`/`comparableFraction` as a bare percentage — both need a
   caption, neither is a quality score for the customer.
3. `isComplete` is `false` on every snapshot and every diff that exists today, still.
4. `status: "sealed"` does not mean complete.
5. A low `changesTotal`-vs-`comparableFraction` pairing is the only honest summary; never one
   number alone.
6. A whole workload can be legitimately absent — now true at two levels: absent from a *snapshot*
   (Intune, licensing) and absent from the *registry's collectable set entirely* (Planner,
   Defender, Fabric, Commerce, PowerPlatform, Azure, Microsoft365DSC — zero collectable types
   today). A workload picker populated from the registry must not imply every listed workload
   will ever appear on a real snapshot.
7. **New: a `verdict: "unattributed"` count is not evidence the attribution engine failed.** It
   is evidence the underlying Change Control / Risk Register process has not recorded anything
   yet. Do not render it as a red "attribution broken" state.

---

## 8. Retention, cadence and the drift-domain producer count

### 8.1 Retention — REAL now, was "there is none" in #1844 (Git #2114, fixed)

**#1844's own §11 filed this as a finding** (#2114: "No retention policy for configuration
snapshots — 34 MB and 50,176 object rows per full snapshot, accumulating without bound"). **It is
now closed `complete`.** A real, automatic policy exists:

- **Mechanism: a per-tenant COUNT CAP, hard `DELETE`, not soft-delete or a TTL.** Keeps the most
  recent `keepPerTenant` (default **20**) non-`running` snapshots per tenant; deletes the rest.
  Implemented as one SQL statement in
  `artifacts/api-server/src/lib/config-snapshot-retention-nodes.ts:47-151`
  (`handleConfigSnapshotPrune`), backing a dedicated workflow node type
  (`config_snapshot_prune`).
- **Trigger: automatic, nightly.** Seeded system workflow `__system__: Tenant Configuration
  Snapshot Retention Prune`, cron `0 3 * * *` (`seed-system-workflows.ts`), `triggerType:
  "schedule"` — unlike collection itself (still manual-only, below), retention runs on its own.
- **Baseline- and diff-referenced snapshots are structurally protected.** Any snapshot named by
  `config_snapshot_baselines.snapshot_row_id`, or by any `config_diffs.base_snapshot_row_id` /
  `head_snapshot_row_id` (any diff, ever, not just active ones), is excluded from the deletable
  set before the cap is even applied. This is the real reason snapshot 10 — 5 days old,
  well past a naive "keep the last 20" if this tenant had run more collections — is still in the
  store: it is both the active baseline's snapshot and the base side of diff 221.
- **Audit trail:** every prune run is logged to `config_snapshot_prune_runs` (schema
  `lib/db/src/schema/config-snapshots.ts:880-943`) — tenants considered, candidates over cap,
  protected-by-diff count, protected-by-baseline count, snapshots actually deleted.
- **No dedicated API surface.** No route exposes prune status or a manual trigger; the only way
  to fire it manually is the generic `POST /admin/workflows/definitions/:id/run` against this
  seeded definition.
- **`config_diffs` has no independent pruning** — a diff is only removed as a side effect of its
  base/head snapshot being deleted (blocked while either side is protected), or via the
  pre-existing `recompute: true` cache-replacement path.

**A separate, unrelated retention system also landed since #1844 and does NOT apply here.**
Epic #1944 (#1947/#2764/#2765) shipped a generic per-customer-record soft-delete/purge framework
with its own review queue (`GET/POST /msp/retention/queue/*`) and a tenant-level 7-year
post-termination purge clock. Its record-type and tenant-purger registries **ship empty** — no
module has registered `tenant_config_snapshots` or `config_diffs` into it. Do not conflate the
two systems in a design; the count-cap prune above is the only retention mechanism that touches
this pack's data.

### 8.2 Cadence — unchanged, still manual-trigger-only

**Collection itself still has no scheduler.** The seeded `__system__: Tenant Configuration
Snapshot` workflow's `triggerType` is still `"manual"` — re-verified this session directly in
`seed-system-workflows.ts`, whose own comment is unchanged: *"Manual trigger only: collection
cadence is a separate decision, not made here."* Every one of the now **10** real snapshots
(rows 8, 9, 10, 11, 33, 34, 59, 66, plus this session's 109, 110 — see §9 for why row 109 is
excluded from this pack's headline numbers) was started by hand or by an operator/script call,
never by a scheduler. **A design must still not show a "next scheduled collection" affordance.**
Retention (§8.1) now runs on a real schedule; collection does not, and conflating the two would
misrepresent the product.

### 8.3 Drift domains — RE-VERIFIED, unchanged at 5 of 18

**#2899's own premise needed checking, and the check found it was already correct.** The issue
that requested this regeneration suspected Git #2010 (DNS transport) gave `email-authentication`
a new producer, moving the count. **It did not.** `email-authentication`'s producer
(`buildEmailAuthDriftConfig` in `drift-check-specs.ts`) was introduced by **#1287**
(`cc0dc05b7`), which is an ancestor of #2010 — confirmed via `git merge-base --is-ancestor`. #2010
added the `dns` **read transport to the unrelated config-snapshot-collector subsystem** (§4.1,
§4.3, §4.4's `dns:txt:email-authentication` resource type) and never touched
`drift-check-specs.ts` at all. The two "email-authentication" mentions are two different
subsystems that happen to share a name.

**5 of 18 drift domains have a producer; 13 do not — identical to #1844, re-verified against
current code and current `drift_collection_status` rows:**

| Has a producer | No producer |
|---|---|
| `ca-policy` · `public-teams-discoverable` · `eeeu-site-sharing` · `tenant-sharing-capability` · `email-authentication` | `directory-settings` · `license-assignment` · `mailbox-config` · `role-assignment` · `security-defaults` · `sharepoint-admin` · `teams-policy` · `app-config` · `redirect-uri` · `secret` · `certificate` · `permission` · `tenant-config` |

Real `drift_collection_status` rows, re-queried, unchanged from #1844: 4 `tracked` (`ca-policy`,
`email-authentication`, `public-teams-discoverable`, `tenant-sharing-capability`), 1
`not_comparable` (`eeeu-site-sharing`, the per-site fan-out domain, 99 real sites on the testbed).
4 `drift_baseline_snapshots` rows. **`drift_events` is still empty — zero rows, ever.**

**Do not design 18 drift tiles.** This remains unchanged, real, and current.

---

## 9. Evidence discipline — what is measured, and what is not

| Claim | How verified |
|---|---|
| Endpoint paths, methods, roles, request/response shapes, error codes | Re-read from `routes/portal-config-state.ts`, `routes/msp-config-state.ts`, `routes/msp-config-state-diffs.ts`, `lib/config-state-views.ts`, `lib/config-change-attribution.ts`, `middlewares/requireAuth.ts`, `lib/api-helpers.ts` on 2026-09-04 |
| Every enum and its full value set | Re-read from `lib/db/src/schema/config-snapshots.ts`, `config-diffs.ts`, `config-state.ts`, `config-attribution.ts`, `msp.ts` on 2026-09-04 |
| §4.1 registry counts | `psql` against the local `DATABASE_URL`, live, 2026-09-04 |
| §4.2–§4.4 full-snapshot volume, fan-out, skip/fail reasons | **A fresh, live, full collection run**, triggered in this session via `collect-config-snapshot.ts` against the real Microsoft Graph / PowerShell / DNS surface of the testbed tenant, producing snapshot row 110. Not simulated, not a replay. |
| §4.6 comparison volume and cost | **A fresh comparison run**, triggered in this session via `verify-1797-differ.ts` (snapshot 10 → 110, mode `drift`), producing diff row 221 |
| §6.9 attribution rollup, verdicts, window | **A fresh attribution run**, triggered in this session via `verify-2759-attribution.ts` against diff 221 |
| §8.3 drift domain producer count | Re-read `drift-check-specs.ts` and `lib/dashboard-registry/src/metrics.ts` directly, plus `git merge-base --is-ancestor` to settle the #2010 question |
| §8.1 retention mechanism | Re-read `config-snapshot-retention-nodes.ts`, `seed-system-workflows.ts`, the `#2114` migration, and the `config_snapshot_prune_runs` schema |

**Why row 109 is excluded from this pack's headline numbers.** The first live-collection attempt
this session (snapshot row 109, `b125d2a4-…`'s immediate predecessor) ran without
`MT_APP_CLIENT_ID`/`MT_APP_CLIENT_SECRET` loaded into the process environment — a real local
tooling gap in how this session invoked the collector script directly rather than through the
api-server's own bootstrap, not a product defect — and every one of its 1,092 targets failed
`unknown_error` with `reasonDetail: "MT_APP_CLIENT_ID / MT_APP_CLIENT_SECRET not configured"`.
Once the credentials were correctly loaded, the retry (row 110, used throughout §4–§8) collected
real data end to end. Row 109 is a real row, kept in the store (nothing here deletes evidence of
a failed run — same discipline §3 documents for `SNAPSHOT_STATUSES: failed`), but it is not cited
as evidence anywhere above because it measures a local credential-loading mistake, not the
tenant.

**Not verified live over HTTP, with the exact blocker — same limitation as #1844, re-checked
rather than assumed:** ports 3000, 4000, 5000, 5173, 8080 and 8787 were all probed with `curl`
(2 s timeout each) at the start of this session and every one refused/timed out (`curl` exit 28,
connection code `000`) — no local dev server was running. The HTTP status codes and the exact
`res.json` envelopes as serialised over a real socket are therefore still read from route source,
not observed on a connection. Everything below the route handler — the collector, the differ, the
attribution engine, the view functions, the SQL, the real rows and the real payload shapes — was
**executed live** this session against the real database and (for the collector) the real
tenant, so a payload shown here is what the handler passes to `res.json`, verified two layers
deeper than an HTTP probe would reach.

**Names in this document.** `Jane Jane`, `Test Me`, both domains, every GUID, hash and error
string are real rows in the real database — nothing fabricated to read nicely. The testbed
tenant `mccawsoft2.onmicrosoft.com` is simultaneously Shane's real production Microsoft 365
tenant; this regeneration's live collection and diff runs are exactly as read-only as #1844's
were (every call a GET or a `Get-*` cmdlet — re-confirmed by reading the executed run's own log,
which shows only Graph GETs and DNS TXT lookups).

---

## 10. Explicit non-goals of these endpoints

- **No apply path.** Unchanged. `promotion` computes the difference and stops. #2759's
  attribution pass explains changes; it never applies, approves, or reverses one.
- **No customer-side write of any kind.** Unchanged, and now explicitly includes: no customer
  trigger of an attribution re-run.
- **`resourceKeys` is fixed at the differ layer but STILL not exposed on these two routers —
  read this carefully, it is a genuine change from #1844's framing.** Git #2032 (a resource-scoped
  recompute silently overwriting a full-tenant diff) is **fixed**: `config_diffs` now carries
  `resource_keys_fingerprint` as part of its cache key and unique constraint
  (`config-snapshot-differ.ts:245-265`, migration
  `2026-09-04-config-diffs-resource-keys-fingerprint-2032.sql`), so a scoped and a full-tenant
  diff of the same pair can no longer collide. `admin-config-diffs.ts` already accepts
  `resourceKeys` in its request body as a result. **`msp-config-state-diffs.ts` and
  `portal-config-state.ts` — the two routers this pack documents — still do not**, and their own
  code comments still say "until that is fixed" even though it now is. This is filed as a finding
  (§11) rather than silently corrected here, because whether to expose it is a real product
  decision (should a customer or operator be able to narrow a comparison at all?), not just a
  stale-comment fix.
- **No `?tenantId=` on the portal router**, ever. Unchanged.
- **No scheduler for collection.** Unchanged (§8.2) — retention now has one; collection does not,
  deliberately.
- **This document does no design work**, defines no components, and does not restate
  `docs/design-system.md`.

---

## 11. Gaps found while extracting this pack

Recorded here per the standing rule. Findings from #1844's original §11 are re-stated with their
**current, re-verified status** rather than silently dropped — a stale "still open" claim would
itself be exactly the kind of drift this regeneration exists to catch.

1. **`artifacts/msp-console` — status changed since #1844.** #1844 filed this as #2112 ("does not
   exist"). Shane closed #2112 `not_planned` on 2026-09-03 as a deliberate epic reset, not a fix.
   **The directory now exists on disk anyway** (`App.tsx`, `main.tsx`, `pages/index.tsx`,
   `pages/not-found.tsx`), created separately as part of that same reset, but remains a bare
   scaffold with no config-state page — functionally the same "endpoints-only" state #1844
   documented, just with an extra empty folder. Not re-filed; #2112's history already covers it
   and Shane's own closing comment is the authoritative record of the decision.
2. **`Design/portal/` is no longer empty, but still has no page-specific export for this pack.**
   Corrected from #1844's "empty (`.gitkeep` only)" — one export now exists
   (`design_handoff_ui_shell/`), and it is explicitly shell-chrome-only by its own README ("Page
   content is explicitly out of scope"). No page described in this pack has a design. Not a
   defect — the expected state at this point in the fixed order — recorded so the distinction
   between "no export at all" and "an export that deliberately excludes page content" is not
   lost.
3. **Two incompatible error envelopes — RESOLVED.** #1844 filed this as #2113. **Closed
   `complete`.** Verified directly in `requireAuth.ts`: all three error sites now call the same
   `apiError()` helper the route handlers use. See §2 for the current, single shape.
4. **No retention policy — RESOLVED.** #1844 filed this as #2114. **Closed `complete`.** See §8.1
   for the real, now-live, automatic count-cap prune.
5. **`unknown_error` as the largest failure class — IMPROVED, not fully resolved.** #1844 filed
   this as #2115. **Closed `complete`** on the strength of two new skip reasons
   (`endpoint_not_found`, `not_applicable_to_account_type`) reclassifying real signal the old
   classifier ignored. Re-measured this session on fresh data: `unknown_error`'s share of
   failures fell from 39% to 22% — genuinely better, but 203 of 917 failures on the freshest real
   snapshot are still unclassified. Not re-filed as a new issue — the fix that landed is real and
   the remaining share is a smaller, different-shaped problem than what #2115 described, not
   evidence the fix didn't work.
6. **`/api/api/admin/config-*` double-prefix — STILL OPEN.** #2099, filed before #1844's pack,
   re-checked this session: **still open, unfixed.** `admin-config-snapshots.ts` and
   `admin-config-diffs.ts` still register routes with a leading `/api/` under a router already
   mounted at `/api`, so both #1798 admin-panel pages still 404 at their real fetch paths. Not
   touched by this pack's scope (customer/operator routers, not admin), carried forward as an
   open item rather than re-filed.
7. **NEW — `resourceKeys` narrowing is safe now but still withheld, and the code comments saying
   otherwise are now stale.** Git #2032 (silent overwrite on a resource-scoped recompute) was
   fixed 2026-09-04 (`501c9139e`) by widening `config_diffs`' cache key. The comment blocks at
   `artifacts/api-server/src/routes/msp-config-state-diffs.ts:53-58` and
   `artifacts/api-server/src/routes/portal-config-state.ts:334-338` still read *"Until that is
   fixed, no route added here accepts the parameter"* — that condition no longer holds, and the
   sibling admin route (`admin-config-diffs.ts:181-205`) already accepts `resourceKeys` in its
   body. Filed as a new issue: whether to expose `resourceKeys` on the customer/operator routers
   is a real product surface decision (a narrowed comparison changes what "the comparison" means
   to a caller), not something this pack should decide by itself — but the stale comments should
   at minimum be corrected to stop citing a closed bug as an open blocker.

---

## 12. Source files, for a reader who does need the code

| Concern | File |
|---|---|
| Customer routes | `artifacts/api-server/src/routes/portal-config-state.ts` |
| Operator snapshot / collection / registry routes | `artifacts/api-server/src/routes/msp-config-state.ts` |
| Operator diff / baseline / rule / attribution routes | `artifacts/api-server/src/routes/msp-config-state-diffs.ts` |
| All wire shapes, paging, completeness, scoped reads | `artifacts/api-server/src/lib/config-state-views.ts` |
| Operator book resolution | `artifacts/api-server/src/lib/msp-config-state-scope.ts` |
| Customer scope resolution | `artifacts/api-server/src/lib/portal-customer-scope.ts` |
| Role ladder, unified error envelope | `artifacts/api-server/src/middlewares/requireAuth.ts` |
| `apiError` envelope and codes | `artifacts/api-server/src/lib/api-helpers.ts` |
| Collector, budgets, abandoned sweep, DNS transport | `artifacts/api-server/src/lib/config-snapshot-collector.ts` |
| Differ, modes, cache key (incl. `resourceKeysFingerprint`), refusal sentences | `artifacts/api-server/src/lib/config-snapshot-differ.ts` |
| **Change attribution engine, scopes, lifecycle (#2759)** | `artifacts/api-server/src/lib/config-change-attribution.ts` |
| **Retention prune node (#2114)** | `artifacts/api-server/src/lib/config-snapshot-retention-nodes.ts` |
| Snapshot store schema + enums | `lib/db/src/schema/config-snapshots.ts` |
| Diff store schema + enums | `lib/db/src/schema/config-diffs.ts` |
| Resource model enums | `lib/db/src/schema/config-state.ts` |
| **Attribution store schema + enums (#2759)** | `lib/db/src/schema/config-attribution.ts` |
| Seeded collection + retention-prune workflows | `artifacts/api-server/src/lib/seed-system-workflows.ts` |
| ps-execution cmdlet catalog (144 distinct unfiltered cmdlets, 158 raw entries — #1961/#2850) | `services/ps-execution/cmdlet-catalog.ps1` |
| Live verification scripts used to produce this pack's real data | `artifacts/api-server/src/scripts/collect-config-snapshot.ts`, `verify-1797-differ.ts`, `verify-2759-attribution.ts` |
| Drift domains (separate subsystem) | `lib/dashboard-registry/src/metrics.ts`, `artifacts/api-server/src/lib/drift-check-specs.ts`, `lib/db/src/schema/msp.ts` |

Logging on all three routers uses `logger.child({ channel: … })` from the locked taxonomy —
`tenant.portal` for the customer router, `tenant.config-state` for both operator routers,
`engine.dashboard` for the differ, `engine.monitor` for the collector's tenant-level service-state
reasoning.
