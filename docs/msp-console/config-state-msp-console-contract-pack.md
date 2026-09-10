# Configuration State — MSP Console contract extraction pack

**Git #3355**, extracted 2026-09-09, per the #1642 pattern (re-read every route file, every
wire shape, and every live DB fact from scratch rather than trusting a prior document).
Parent: **#1571** (EPIC: Portal Admin — MSP-side operator surface); #3355 itself is a leaf
issue with zero sub-issues (verified via GraphQL `issue.subIssues.totalCount === 0`).

**No prior MSP-console-side pack existed for this module before this one.** The only existing
Configuration State pack is `docs/portal/configuration-state-contract-pack.md` (regenerated
under Git #2899, 2026-09-04) — the customer-facing half. That pack's own §0.2 already
distinguishes the module boundaries and documents the shared schema/enum layer; this pack does
not repeat that derivation, it cites it, and focuses on what is genuinely different on the
operator side: two dedicated route files serving the *book* rather than a single tenant, plus
five real capabilities the customer surface has no equivalent for at all (collection triggering,
the resource-type registry, and the baseline registry).

Backend routes (both live, both mounted — `artifacts/api-server/src/routes/index.ts:302-303`
import lines, `:589-590` mount lines):

- `artifacts/api-server/src/routes/msp-config-state.ts` (526 lines) — book-wide tenant coverage,
  snapshot history/detail/objects, collection triggering, the resource-type registry (**8
  routes**)
- `artifacts/api-server/src/routes/msp-config-state-diffs.ts` (781 lines) — comparison history/
  detail, the four-mode compute endpoint, the noise ruleset, the #2759 attribution pass, and the
  baseline registry (**8 routes**)

**16 routes total.** Scoping: `artifacts/api-server/src/lib/msp-config-state-scope.ts` (106
lines) — `resolveConfigStateBook`, the one function that turns a caller into the set of tenants
they may read. Schema: `lib/db/src/schema/config-snapshots.ts` (`tenantConfigSnapshotsTable`
`:455`, `configSnapshotResourceTypesTable` `:343`, `configSnapshotBaselinesTable` `:828`),
`lib/db/src/schema/config-diffs.ts` (`configDiffsTable` `:405`, `configDiffPropertyRulesTable`
`:319`), `lib/db/src/schema/config-attribution.ts` (`configChangeAttributionsTable` `:415`,
`configChangeScopesTable` `:201`, `configChangeLifecycleTable` `:334`),
`lib/db/src/schema/config-state.ts` (the read-transport/surface/availability vocabularies).
Verified live against local PostgreSQL (`\d tenant_config_snapshots` / `\d config_diffs` /
`\d config_snapshot_baselines` / `\d config_diff_property_rules`) — every column, CHECK
constraint and FK cited below is confirmed present on the running schema, not just in the
Drizzle source.

Original API build: **#1843** (closed) — "Config state: customer and MSP operator API surface
for snapshots, diffs and the resource registry." Both route files in this pack were built there,
under the same issue as the customer-facing `portal-config-state.ts`; no MSP-console-specific
follow-up issue built anything further on top of them. `docs/design-system.md` is the shared
visual foundation for whatever surface eventually renders this — not restated here; this
document is data only.

---

## 0. What is genuinely different from the customer-portal pack

### 0.1 The book, not a single tenant

The customer reads exactly one tenant, resolved trivially from the JWT's `customerId` claim —
`docs/portal/configuration-state-contract-pack.md` §1.1 covers this in one line because there is
nothing more to say. The operator side has no such trivial answer, because an operator
legitimately reads *across* customers, and "across customers" is exactly the shape in which a
cross-tenant leak hides (`msp-config-state-scope.ts:1-9`, its own file header). Every route in
both files in this pack takes `resolveConfigStateBook(req)` as an explicit predicate before
touching a row — there is no route here that reads a snapshot, diff, or baseline without first
resolving the caller's book.

**The book, precisely** (`msp-config-state-scope.ts:55-106`):

| Caller | Book |
|---|---|
| `PlatformAdmin` (`role === "admin"` or `mspRole === "PlatformAdmin"`) | Every tenant, unless `?mspId=`/`?slug=` narrows to one MSP (`resolveMspId`, `:68`) |
| `MSPAdmin` / `MSPOperator` | Every tenant of their own MSP, intersected with `resolveStaffScopedCustomerIds` when the staff member is scoped (`:80-86`) — a scoped operator never sees a customer outside their assignment |
| Anything below, or no resolvable `mspId` for MSP staff | **Empty book** — fails closed rather than widening (`:61-63,72-76`) |

An **empty book is a legitimate state** (a new MSP with no customers yet) and every list route
short-circuits to empty results on it, never "everything" (`msp-config-state-diffs.ts:167-170`
for diffs, `:555-558` for baselines are the two places this is done explicitly in-route; the
snapshot/registry routes rely on `resolveConfigStateBook`'s own empty `tenantIds` array producing
zero matches downstream in `config-state-views.ts`).

`?tenantId=` on any operator route can only ever **narrow** within the book, never widen it —
the opposite of the customer router, which has no `?tenantId=` parameter at all and must never
grow one (this pack's own scope file header, `:1-9`, restates the same rule the portal pack's
§1.1 states from the other side).

### 0.2 Five real capabilities with no customer-side equivalent

| Capability | Route | Why the customer has none |
|---|---|---|
| Book-wide coverage roll-up | `GET /tenants` | "Who has been collected, and how stale" is a book-level question; a customer already knows their own answer is one row |
| Trigger a collection | `POST /collections` | The **only producer path** in the whole subsystem (§2.6) — a customer has no write action anywhere in this module (portal pack §1's own row: "There is no customer-side write in this subsystem at all") |
| Follow a collection run | `GET /collections/:runId` | Follows from the above — nothing to follow if nothing can be triggered |
| The resource-type registry | `GET /registry`, `/registry/summary` | Platform-wide, not tenant data at all (`msp-config-state.ts:35-38`) — what this platform can read from Microsoft, identically for every customer; deliberately not tenant-scoped |
| The baseline registry | `GET/POST /baselines`, `PATCH /baselines/:id` | A known-good reference is an operator-declared object; nothing analogous exists on the customer side |

Every other capability (snapshot history/detail/objects, comparison history/detail, the four
diff modes, the noise ruleset, the attribution pass) has a customer-side counterpart, scoped to
one tenant instead of a book — see §1's consumer map.

### 0.3 No write-to-tenant path, same guarantee as the customer side

Stated in both route files' own headers (`msp-config-state.ts:45-50`,
`msp-config-state-diffs.ts:62-66`) and independently confirmed by direct read: `POST
/collections` starts a **READ** of a tenant — every call the collector makes is a GET or a
`Get-*` cmdlet, enforced in `config-snapshot-collector.ts` and in the ps-execution container's
own code-owned catalog (#209). `POST /diffs` with `mode: "promotion"` computes a difference only
and has no apply path — "joining the two is a separate product decision, recorded as an explicit
non-goal on both #1797 and #1843" (`msp-config-state-diffs.ts:62-66`). Confirmed structurally:
no route in either file calls a Graph write operation, `runSopForCustomer`, or raises a change
request.

---

## 1. Consumer map

Side-by-side with the customer surface (`docs/portal/configuration-state-contract-pack.md` §1),
restated here from the operator side's own routes:

| # | Operator route (`/api/msp/config-state/*`) | Method | File:line | Customer equivalent | Live consumer today |
|---|---|---|---|---|---|
| 1 | `/tenants` | GET | `msp-config-state.ts:125-167` | *(none — book-only question)* | none |
| 2 | `/snapshots` | GET | `msp-config-state.ts:171-198` | `/snapshots` (single-tenant) | none |
| 3 | `/registry/summary` | GET | `msp-config-state.ts:204-212` | *(none)* | none |
| 4 | `/registry` | GET | `msp-config-state.ts:214-253` | *(none)* | none |
| 5 | `/collections/:runId` | GET | `msp-config-state.ts:258-325` | *(none)* | none |
| 6 | `/collections` | POST | `msp-config-state.ts:345-426` | *(none — the only producer path)* | none |
| 7 | `/snapshots/:id` | GET | `msp-config-state.ts:430-481` | `/snapshots/:id` | none |
| 8 | `/snapshots/:id/objects` | GET | `msp-config-state.ts:485-524` | `/snapshots/:id/objects` | none |
| 9 | `/diffs` | GET | `msp-config-state-diffs.ts:163-224` | *(no book-wide list; customer reads `/changes`, computed not listed)* | none |
| 10 | `/diffs/rules` | GET | `msp-config-state-diffs.ts:229-266` | *(none)* | none |
| 11 | `/diffs` | POST | `msp-config-state-diffs.ts:280-424` | `/changes` (drift mode only, auto-computed) | none |
| 12 | `/diffs/:diffId` | GET | `msp-config-state-diffs.ts:428-512` | `/changes/:diffId` | none |
| 13 | `/diffs/:diffId/attribution` | POST | `msp-config-state-diffs.ts:531-547` | *(none — no customer-side write in this subsystem at all)* | none |
| 14 | `/baselines` | GET | `msp-config-state-diffs.ts:551-614` | *(none)* | none |
| 15 | `/baselines` | POST | `msp-config-state-diffs.ts:630-708` | *(none)* | none |
| 16 | `/baselines/:baselineId` | PATCH | `msp-config-state-diffs.ts:718-779` | *(none)* | none |

**Zero cross-surface reuse today**, re-grepped this pass: `artifacts/admin-panel/src`,
`artifacts/msp-console/src`, `artifacts/mcp-server/src` for `config-state`, `msp/config-state`,
`configState` — the one admin-panel match (`ConfigResourceModel.tsx:463,465`) cites the
*build scripts* (`scripts/config-state/fetch-sources.mjs` / `build-resource-model.mjs`) that
populate the registry table, not this pack's routes at all. **No orphaned-endpoint sub-issue
filed** — same precedent as the sibling Policy Decisions and Risk Register MSP Console packs:
every one of these 16 routes is the expected pre-Design/pre-wire state for a module whose API
build (#1843) precedes its MSP Console page by design.

**Both operator-surface app directories remain bare scaffolds.** `artifacts/msp-console/src`
holds exactly `App.tsx`, `main.tsx`, `index.css`, `pages/index.tsx`, `pages/not-found.tsx` —
re-confirmed this pass, unchanged from the sibling packs' own reads of the same directory. No
config-state page exists on either operator or admin surface.

### 1.1 Auth and roles — identical floor to every sibling MSP-console pack

`requireRole("MSPOperator")` on all 16 routes (MSPOperator, MSPAdmin, PlatformAdmin — the same
ordered ladder every other pack in this project documents:
`Assessment < Free < CustomerUser < ServiceAccount < MSPOperator < MSPAdmin < PlatformAdmin`). No
route in either file uses a stricter or looser floor. Tenant scoping is the book (§0.1), entirely
separate from the role floor — matching the pattern this project's other MSP-console packs
already establish (`msp-executive.ts`, `msp-ownership.ts`).

An out-of-scope id returns **404, not 403** on every route that names a specific resource — a
`403` would confirm the id names a real object outside the caller's book, which is itself
information leakage. Verified across all id-scoped routes in both files: `snapshots/:id`
(`msp-config-state.ts:435-437`), `collections/:runId` (`:268,274-277`, with the header's own
explanation of *why* 404 rather than 403 at `:274-276`), `diffs/:diffId`
(`msp-config-state-diffs.ts:433`), `baselines/:baselineId` PATCH (`:760-763`).

---

## 2. Wire contract — `msp-config-state.ts`

### 2.1 `GET /api/msp/config-state/tenants` (`:125-167`)

The one route with genuinely no analog anywhere on the customer side. Resolves the book, then
for each tenant looks up its **latest sealed snapshot only** (`latestSealedSnapshots`,
`config-state-views.ts`) — a `running`/`failed`/`abandoned` snapshot never displaces a real
sealed one as "latest," the same completeness discipline the portal pack's own §0.1 states as the
whole product's foundational rule.

```json
{
  "mspId": 1,
  "tenants": [
    {
      "tenantId": 1, "customerName": "Jane Jane", "domain": null,
      "entraTenantId": "…", "isTestbed": true, "status": "active",
      "latestSnapshot": null,
      "everCollected": false
    }
  ],
  "collectedCount": 0,
  "neverCollectedCount": 2
}
```

`latestSnapshot` is **`null`, never a zeroed-out placeholder** (`:143-145`, the route's own
comment) — "never collected" and "collected and found nothing" are different facts about a
customer, and this is the one view where an operator acts on that difference across their whole
book at once. When present, `latestSnapshot.ageHours` is computed server-side
(`Math.round(((now - capturedAt) / 3_600_000) * 10) / 10`, `:152`) — one decimal place, never
left for a client to derive from a raw timestamp.

**Live today: both real tenants (`id=1` "Jane Jane", `id=3` "Test Me") read `everCollected:
false`** — `tenant_config_snapshots` carries **zero rows** on the local database as of this
extraction (§9), a different live state than the sibling customer-portal pack recorded five days
earlier (its own snapshot row 110). This is not a regression in either pack; it reflects the
local dev database's own real, current, resettable state at read time — exactly the kind of fact
this pack's live cross-check exists to catch rather than assume.

### 2.2 `GET /api/msp/config-state/snapshots` (`:171-198`)

Book-scoped history, narrowable by `?tenantId=` (must resolve to an integer, 400 otherwise,
`:176-179`) and `?status=` (one of `SNAPSHOT_STATUSES`, 400 otherwise, `:180-184`). Delegates to
`listSnapshots({ allowedTenantIds: book.tenantIds, ... })` — the allowed-set predicate is passed
explicitly on every call, never implicit. Same paging envelope (`{ total, limit, offset, hasMore
}`) as the customer route, default/max page size unchanged from the portal pack's §4.5 table
(`SNAPSHOT_LIST_PAGE` = 25/200).

### 2.3 `GET /api/msp/config-state/registry/summary` and `/registry` (`:204-253`)

**Deliberately not tenant-scoped at all** — no book resolution happens on either route
(`_req: Request` on the summary handler, `:205`, never even reads `req.user`). The header states
why (`:35-38`): `config_snapshot_resource_types` describes what this platform can read from
Microsoft, identically for every customer, and contains no tenant's configuration or identifiers.
Any caller past the `requireRole("MSPOperator")` floor sees the same registry regardless of which
MSP or which book they belong to.

`/registry` accepts four independent filters, each validated against its own enum before the
query runs (`400` with the allowed-value list on a bad one): `transport` (`CONFIG_READ_TRANSPORTS`,
`:217-221`), `surface` (`CONFIG_SURFACES`, `:222-226`), `availability` (`CONFIG_AVAILABILITY`,
`:227-231`), plus a bare `collectable` boolean (`"true"`/`"false"` string only, 400 on anything
else, `:233-236`) and free-text `workload`/`q`. Delegates to `readResourceRegistry` /
`readResourceRegistrySummary` (`config-state-views.ts:803-871`) — the same functions and the same
20 `CONFIG_SURFACES` / 8 `CONFIG_READ_TRANSPORTS` / 5 `CONFIG_AVAILABILITY` values the portal
pack's §3 documents in full; not re-derived here.

**Re-measured live this pass, 2026-09-09 — moved since the portal pack's 2026-09-04 read:**

| | Portal pack (9/4) | **This pack (9/9)** |
|---|---|---|
| Registered resource types | 1,541 | **1,541** (unchanged) |
| Collectable | 1,092 | **1,063** |
| Not collectable | 449 | **478** |

The registered total is unchanged; the collectable/not-collectable split moved by 29 rows in five
days. This is the same shared, tenant-agnostic table the portal pack's §4.1 documents in full
historical detail (the #1960/#2841/#2010 corrections) — this pack does not re-derive that
history, only confirms the split kept moving after that regeneration and states the real number
as read today, per this issue's own instruction to cross-check live rather than copy a sibling
pack's figure. Whatever landed between 9/4 and 9/9 to move 29 rows is outside this pack's own
route files (nothing in `msp-config-state.ts`/`-diffs.ts` writes to
`config_snapshot_resource_types` — only the `scripts/config-state/build-resource-model.mjs`
build script referenced in `ConfigResourceModel.tsx` does), so it is not this pack's finding to
attribute; a reader wanting the exact commit should check that script's own recent history.

### 2.4 `GET /api/msp/config-state/collections/:runId` (`:258-325`)

Reads one `wf_runs` row plus its `wf_run_node_logs` (up to 200, ordered by `id` ascending,
`:279-287`) and, if the run got that far, the `tenant_config_snapshots` row it actually produced —
resolved by **`wf_run_id`, never "the newest snapshot for this tenant"** (`:290-292`, the route's
own comment), so a concurrent second run against the same tenant can never have its output
misattributed to this one.

**Entitlement is derived from the run's own payload, not a route parameter**: `targetTenantId =
Number(run.payload.tenantId)` (`:272`), then checked against the book (`:273`). A run whose
payload doesn't carry a resolvable `tenantId`, or whose tenant is outside the book, 404s
identically to a run that doesn't exist (`:274-277`) — the same non-leaking rule as every other
id-scoped route in this pack (§1.1).

### 2.5 `POST /api/msp/config-state/collections` (`:345-426`) — the only producer path

Body: `{ tenantId: number (required), maxResources?: number, reason?: string }`. `tenantId` must
resolve within the book (`404` otherwise, `:355-358`) — checked *after* basic shape validation,
*before* anything else. `maxResources`, when supplied, must be a positive integer (`:361-366`).

**Never calls the collector directly.** Fires the seeded `__system__: Tenant Configuration
Snapshot` workflow definition through `fireWorkflowForDefinition` (`:386-399`) — the route's own
header states the reasoning at length (`:329-343`): #1796 built the `config_snapshot_collect`
Workflow Engine node precisely so collection is a visible engine run rather than a bare scheduler
or a direct library call from a route, meaning every collection however started carries a
`wf_runs` row with logs, a concurrency limit and a visible node trace. Two distinct real failure
modes, both reported rather than silently retried:

- **`503`** if the workflow definition itself is not seeded in this environment (`:373-381`) —
  "there is no visible engine path to start a collection on."
- **`409 CONFLICT`** if `fireWorkflowForDefinition` returns `null` — no published version, or the
  workflow's own concurrency limit is already reached by runs in flight (`:401-409`).

Success is `202` (accepted, not synchronous): `{ runId, tenantId, definitionId, workflow,
maxResources, followUrl }` (`:414-421`) — `followUrl` is the exact path to §2.4's own route,
handed back so a caller never has to construct it.

### 2.6 `GET /api/msp/config-state/snapshots/:id` (`:430-481`)

`:id` accepts an integer row id or a uuid `snapshotId` (`loadScopedSnapshot`, book-checked).
Adds two fields the customer's own `/snapshots/:id` (portal pack §5.3) does not carry, because a
book spans multiple customers and the operator needs to know which one a given snapshot belongs
to: `tenantName` (joined from `tenantsTable.customerName`, `:446-447`) and `entraTenantId`
(`:463`). Also serves `triggerRef`, `wfRunId`, `requestedByUserId` (`:466-469`) — the full
provenance trail the customer's own document omits (the portal pack's §5.3 nullability table
does not list these three at all). Otherwise identical contract to the customer route: same
`workload`/`status`/`limit`/`offset` query params, same `completeness`/`workloads`/`resources`/
`paging` response shape, same `filtered` boolean (`:475`) stating whether any narrowing was
applied.

### 2.7 `GET /api/msp/config-state/snapshots/:id/objects` (`:485-524`)

Byte-for-byte the same contract as the customer's own `/snapshots/:id/objects` (portal pack
§5.4) — `resourceKey` required (400 otherwise, `:494-499`, with the same stated reason: "a
snapshot holds tens of thousands of objects across the whole tenant and is not servable in one
response"), `include=summary|full` (default `full`), same page caps (`OBJECT_PAGE` 25/100). The
only difference from the customer route is the book substituting for the single-tenant scope
check at `loadScopedSnapshot` (`:488-489`).

---

## 3. Wire contract — `msp-config-state-diffs.ts`

### 3.1 The four modes, and why they are one route (`:28-40`, the file's own header table)

| mode | means | entry point |
|---|---|---|
| `drift` | one tenant now, vs its own earlier state | `diffDrift` |
| `baseline_assessment` | one tenant vs a known-good reference | `diffAgainstBaseline` |
| `tenant_compare` | tenant A vs tenant B | `diffTenants` |
| `promotion` | Dev/Test source vs the target it promotes to | `diffPromotion` |

`config_diffs` carries a real CHECK constraint enforcing the mode/tenant-id coherence rule at the
database level, re-confirmed live this pass (`config_diffs_mode_tenant_coherence`: `mode =
'drift' AND base_tenant_id = head_tenant_id`, OR `mode IN ('tenant_compare','promotion') AND
base_tenant_id <> head_tenant_id`, OR `mode = 'baseline_assessment'` unconstrained on tenant
equality) — a `drift` comparison across two different tenants is rejected by Postgres itself, not
just the differ's own application-level check.

**The customer's own `/changes` route only ever computes `drift`, automatically, between the
tenant's two most recent sealed snapshots** (portal pack §5.5). This route is the only place in
the whole product any of the other three modes — or an explicitly-chosen pair of snapshots for
`drift` itself — can be invoked at all.

### 3.2 `GET /api/msp/config-state/diffs` (`:163-224`)

Book-scoped by requiring **both** `baseTenantId` and `headTenantId` to be in the caller's set
(`:182-185`) — the same two-sided rule §3.6's single-diff read applies, extended to a list so a
cross-tenant diff can never appear in a book that holds only one of its two tenants. An empty
book short-circuits to an empty list before any query runs (`:167-170`). Filterable by `mode`
(`CONFIG_DIFF_MODES`, 400 on a bad value, `:172-176`) and `?tenantId=` (narrows to
`headTenantId`, `:187-189`, matching the customer-facing side's own convention of describing a
diff by its head).

### 3.3 `GET /api/msp/config-state/diffs/rules` (`:229-266`)

**Not tenant-scoped** — the noise ruleset is platform-wide, same reasoning as §2.3's registry.
`includeInactive=true` includes retired rules (default excludes, `:232-234`). Every rule's
`evidence` field is `null` unless `basis === "observed_volatile"` (`:251-257`) — matching the
schema's own CHECK constraint (`config_diff_property_rules_observed_needs_evidence`, re-confirmed
live) that an `observed_volatile` rule cannot exist without its measurement. **Live today: 6
active rules, all `basis: "structural_annotation"` (re-confirmed via direct query,
`select action, basis, count(*) from config_diff_property_rules group by action, basis` →
`ignore | structural_annotation | 6`)** — the same "zero `observed_volatile`, zero
`operator_declared`" state the portal pack's §6.7 records, still true five days later.

### 3.4 `POST /api/msp/config-state/diffs` (`:280-424`) — one route, four capabilities

`mode` is required with no default (`:285-290`) — "it names which capability you are invoking,
and the answer is not interpretable without it," the route's own validation message. Two ways to
name the base side:

- **`baselineId`** (uuid) — only valid for `mode: "baseline_assessment"` or `"promotion"`
  (`:302-306`), resolved against the book **plus a synthetic `-1`** (`:310-315`, so a
  book's own tenant-id array is guaranteed non-empty for the `inArray` call regardless of book
  size — a defensive sentinel, not a value any real tenant can ever hold). A retired baseline 409s with its own `retiredReason` echoed (`:317-322`) — "past
  assessments against it remain readable; new ones are not started against a retired reference."
- **`baseSnapshotRowId`** — a plain integer, required whenever `baselineId` is absent
  (`:325-333`).

`headSnapshotRowId` is always required as a plain integer (`:335-339`). `resourceKeys`, when
supplied, must be a string array (`:344-350`) — the Git #2032 narrowing fix documented in the
file's own header (`:53-60`): `config_diffs` now carries `resource_keys_fingerprint` as part of
both its cache key and its unique constraint (re-confirmed live, `config_diffs_pair_uidx` on
`(base_snapshot_row_id, head_snapshot_row_id, mode, ruleset_fingerprint,
resource_keys_fingerprint)`), so a resource-scoped recompute and a full-tenant one land in
distinct rows instead of one silently overwriting the other. **Entitlement on both sides, before
the differ is ever reached** (`:354-359`) — both `base` and `head` are loaded through
`loadScopedSnapshot` against the book; either missing is a `404`, never a partial success.

`recompute: true` bypasses the cache (`useCache: body.recompute !== true`, `:369`) — sound
because a diff is derived from two immutable sealed snapshots under a recorded ruleset (the same
immutability the DB trigger on `tenant_config_snapshots` enforces). A refused pair
(`SnapshotNotDiffableError` — a still-running snapshot, a self-comparison, or a category-error
mode/tenant pairing) is a `400` naming exactly which invariant broke (`:415-419`), never a `500`.

### 3.5 `GET /api/msp/config-state/diffs/:diffId` (`:428-512`)

`:diffId` accepts row id or uuid, entitled on **both** sides via `loadScopedDiff` (`:432`) — the
file header's own reasoning (`:46-51`): a `tenant_compare` diff's `oldValue` column literally
contains the base tenant's own configuration, so head-side entitlement alone would leak it.
`view=changes` (default) or `view=resources` (`:435-438`).

`view=resources` returns the comparability report (`readDiffResourceReport`, filterable by
`comparability` — `CONFIG_DIFF_COMPARABILITY`, `:467-478`).

`view=changes` (default) is where **the #2759 attribution layer actually surfaces on the operator
side**: `ensureDiffAttributed(diff.id)` runs lazily and non-fatally before the change page is read
(`:490`), then `readDiffVerdictRollup(diff.id)` (`config-change-attribution.ts:975-1019`) is
spread onto the response alongside the change page itself (`:505-507`) — "340 changes read
without '312 of them are unexplained' is a confidently incomplete summary," the same reasoning
the customer's own `/changes` carries (portal pack §5.5), now confirmed identical on the operator
side by direct read of this route rather than assumed from the sibling pack.

```ts
// config-change-attribution.ts:955-968 — DiffVerdictRollup (verbatim)
interface DiffVerdictRollup {
  readonly attributed: boolean;
  readonly attributionVersion: string | null;
  readonly attributedAt: string | null;
  readonly counts: Readonly<Record<ConfigChangeVerdict, number>>;
  readonly changeRequests: readonly { readonly id: number; readonly ref: string | null; readonly changes: number }[];
  readonly riskDecisions: readonly { readonly id: number; readonly ref: string | null; readonly changes: number }[];
  readonly contestedCount: number;
}
```

Individual change rows returned by `readDiffChanges` (filterable by `resourceKey`, `changeKind` —
`CONFIG_DIFF_CHANGE_KINDS`, `workload`, `includeIgnored`) each carry their own per-row
`attribution` and `lifecycle` objects — same shape the portal pack's §5.6 documents verbatim for
the customer side (`attribution: null` when the pass hasn't run over the parent diff yet, never
flattened into a computed `"unattributed"` verdict; `lifecycle: null` for modes the 3-state
lifecycle table doesn't track). Not re-derived here field-by-field since the shape is identical
on both surfaces; this section confirms the operator route wires the same non-fatal, lazy,
idempotent attribution semantics.

### 3.6 `POST /api/msp/config-state/diffs/:diffId/attribution` (`:531-547`) — no customer equivalent

**The one write in this whole pack that is not a Config Pack apply and is not a collection
trigger.** Re-runs the #2759 attribution pass over one sealed, book-scoped comparison
(`attributeDiff`, `config-change-attribution.ts:599-849`). The route file's own extended header
(`:514-529`) states the invariant directly: "it reads Change Control and the Risk Register and
writes only its own tables. It never modifies a change request, never modifies a risk decision,
and never touches the sealed diff." Explicitly **re-runnable, not once-only** — a change request
approved after the diff was computed legitimately turns unattributed rows into attributed ones,
and a revoked risk acceptance legitimately turns them back; the pass is idempotent (an unchanged
world re-run produces the same verdicts, `advanceLifecycle`'s own guard). `409 CONFLICT` via
`DiffNotAttributableError` if the diff is not eligible (e.g. not `sealed` — `:541-542`).

**This route exists on the operator side and nowhere else.** The customer's own `/changes` and
`/changes/:diffId` read the attribution the operator (or the lazy `ensureDiffAttributed` call any
read triggers) already computed — but only an MSPOperator can force a fresh pass on demand. A
customer has no path to re-trigger their own attribution; they wait for the next lazy
computation, matching the "no customer-side write in this subsystem" rule (§1) as one specific,
confirmed instance of it.

### 3.7 The baseline registry — `GET`/`POST /baselines`, `PATCH /baselines/:baselineId` (`:551-779`)

**No customer-facing equivalent exists at all** — a baseline is an operator-declared reference
object, book-scoped, with no analog on `docs/portal/configuration-state-contract-pack.md`'s own
route list.

- **List** (`:551-614`): book-scoped via `inArray(tenantId, book.tenantIds)`; excludes retired
  baselines unless `?includeRetired=true` (`:561-563`); filterable by `purpose`
  (`CONFIG_BASELINE_PURPOSES` — `known_good` | `promotion_source`). Each row carries its
  **referenced snapshot's own completeness** (`:596-607`) — "a baseline is only as authoritative
  as the snapshot behind it, and assessing against a half-readable reference is a thing an
  operator must be able to see before doing it — not discover afterwards in the comparability
  report," the route's own comment.
- **Declare** (`:630-708`): writes a **pointer only** — "no configuration is copied, and the
  snapshot it names is immutable by database trigger — so a baseline cannot drift away from what
  was actually observed" (`:618-624`). The named snapshot must be book-scoped and `sealed`
  (`409` otherwise, `:656-664` — a `running` snapshot's object set is still growing, a `failed`
  one recorded not reading the tenant; neither is a valid reference). `mspId` is taken from the
  **tenant's own** `tenants.msp_id` (`:666-671`), not the caller's claim, "so a PlatformAdmin
  declaring a baseline for someone else's customer records the right owner instead of a null"
  (`:626-628`). Duplicate name within one MSP is a real DB-enforced `409`
  (`config_snapshot_baselines_msp_name_uidx`, re-confirmed live, caught via `violatesConstraint`
  walking the Drizzle error's `cause` chain, `:151-159` — the route's own comment explains *why*
  that walk is necessary: Drizzle wraps the driver error and the constraint name lives on the pg
  error underneath, so matching the wrapper's own message alone silently never matches).
- **Retire** (`:718-779`): **the only supported mutation is retirement** — `isActive: false` with
  a required, non-blank `retiredReason` (`:727-739`, matching the schema's own
  `config_snapshot_baselines_retired_needs_reason` CHECK, re-confirmed live). "A baseline's
  snapshot is immutable evidence, so repointing one at different evidence under the same name
  would rewrite history — declare a new baseline instead" (`:730-733`, the route's own rejection
  message for any other body shape). The `UPDATE` itself is guarded `WHERE ... isActive = true`
  (`:753-757`) — a second concurrent retire attempt gets a genuine `404` ("not found, or already
  retired," `:760-763`), not a silent overwrite.

**No DELETE route for a baseline at all** — re-confirmed this pass (`grep -c "router.delete"
msp-config-state-diffs.ts` → 0). Retired, never deleted, by explicit design (§0's own reasoning:
an assessment run months ago against a now-unused baseline still has to be explainable).

---

## 4. Cross-surface edges

| Edge | Column | Points at | Notes |
|---|---|---|---|
| Snapshot ↔ tenant | `tenant_config_snapshots.tenant_id` | `tenants.id`, cascade | Book-scoped on every read in this pack |
| Snapshot ↔ workflow run | `tenant_config_snapshots.wf_run_id` | `wf_runs.id` | Resolved by this exact id in §2.4/§2.6, never "the newest snapshot for this tenant" |
| Diff ↔ snapshots (both sides) | `config_diffs.base_snapshot_row_id` / `head_snapshot_row_id` | `tenant_config_snapshots.id`, cascade | Entitlement re-checked on both before the differ runs (§3.4) and on every stored-diff read (§3.5) |
| Diff ↔ tenants (both sides) | `config_diffs.base_tenant_id` / `head_tenant_id` | `tenants.id`, cascade | DB-enforced mode/tenant coherence CHECK (§3.1) |
| Baseline ↔ snapshot | `config_snapshot_baselines.snapshot_row_id` | `tenant_config_snapshots.id` (no cascade — no `ON DELETE` clause at all, confirmed live) | A baseline pointer does not disappear if its snapshot were ever deleted through some other path; nothing in this pack deletes a snapshot |
| Baseline ↔ MSP | `config_snapshot_baselines.msp_id` | `msps.id`, cascade | Uniqueness (`name`) is scoped per-MSP, not globally |
| Noise rule ↔ evidence diff | `config_diff_property_rules.evidence_diff_id` | `config_diffs.id`, set-null | Only populated for `basis = 'observed_volatile'` rows; currently none exist (§3.3) |
| Attribution ↔ diff | `config_change_attributions.diff_row_id` | `config_diffs.id`, cascade | Read via `readDiffVerdictRollup`/`readDiffChanges`, written only via `attributeDiff`/`ensureDiffAttributed` — never by any route directly |
| Attribution ↔ Change Control / Risk Register | via `config_change_scopes` (out of this pack's own two route files) | `msp_change_requests`, `msp_risk_decisions` | The bridge itself lives in `config-change-attribution.ts`, a library this pack's routes call but do not implement — full derivation is the portal pack's §6.9 and this pack does not re-derive it |
| Registry ↔ everything | `config_snapshot_resource_types` | — | Tenant-agnostic; joined implicitly by resource key across every snapshot/diff row, never by a direct FK |

---

## 5. Real enum unions actually reachable on these 16 routes

All values re-read from schema this pass, 2026-09-09 — identical set to the portal pack's own §3
(the two surfaces share one schema layer), restated here only where a route in *this* pack
actually validates against it:

| Vocabulary | Values | Enforced where, in this pack |
|---|---|---|
| `SNAPSHOT_STATUSES` | `running` · `sealed` · `failed` · `abandoned` | `?status=` on `GET /snapshots` (`msp-config-state.ts:180-184`) |
| `SNAPSHOT_RESOURCE_STATUSES` | `collected` · `empty` · `partial` · `skipped` · `failed` | `?status=` on `GET /snapshots/:id` (`:440-444`) |
| `CONFIG_READ_TRANSPORTS` | `graph` · `powershell` · `sharepoint-admin` · `dns` · `azure-rm` · `azure-devops` · `power-platform` · `unknown` | `?transport=` on `GET /registry` (`:217-221`) |
| `CONFIG_SURFACES` | 20 values, unchanged from portal pack §3 | `?surface=` on `GET /registry` (`:222-226`) |
| `CONFIG_AVAILABILITY` | `available_now` · `needs_additional_scope` · `needs_license` · `unavailable` · `unknown` | `?availability=` on `GET /registry` (`:227-231`) |
| `CONFIG_DIFF_MODES` | `drift` · `baseline_assessment` · `tenant_compare` · `promotion` | Required `mode` on `POST /diffs` (`msp-config-state-diffs.ts:285-290`); `?mode=` on `GET /diffs` (`:172-176`) |
| `CONFIG_DIFF_COMPARABILITY` | `comparable` · `partially_comparable` · `not_comparable` | `?comparability=` on `GET /diffs/:diffId?view=resources` (`:467-471`) |
| `CONFIG_DIFF_CHANGE_KINDS` | 10 values, unchanged from portal pack §3 | `?changeKind=` on `GET /diffs/:diffId` (`:483-487`) |
| `CONFIG_BASELINE_PURPOSES` | `known_good` · `promotion_source` | `?purpose=` on `GET /baselines` (`:564-568`); required `purpose` on `POST /baselines` (`:639-643`) |
| `CONFIG_CHANGE_VERDICTS` | `attributed_change` · `accepted_risk` · `contested` · `unattributed` · `ignored` | Not directly validated by any route in this pack (read-only, computed by the attribution library) — surfaced via `readDiffVerdictRollup`'s `counts` (§3.5) |

**DB-enforced vs application-only, re-confirmed live this pass:** `config_diffs_mode_valid`,
`config_diffs_status_valid`, `config_diffs_trigger_valid`,
`config_snapshot_baselines_purpose_valid` all exist as real CHECK constraints. `tenant_config_snapshots`
carries no CHECK on `status`, `trigger`, or any skip-reason column — those enums are
application-layer only (the collector's own validation), consistent with this codebase's general
pattern the sibling Policy Decisions/RBD packs already document.

---

## 6. Field status — CURRENT vs DECIDED

Unlike the Policy Engine or Policy Decisions modules (still landing features across several
issues), **this module has had no functional change since #1843 built it.** Every route in both
files in this pack is CURRENT — built, mounted, and unchanged in shape since #1843 closed. The
one real evolution since then is entirely on the **customer-portal side** (#2759's attribution
layer, §5.5/§5.6 of the portal pack) — and this pack confirms in §3.5/§3.6 above that the
operator routes already wire the identical attribution contract, non-fatally and lazily, plus the
one operator-only capability to force a fresh pass (§3.6) that the customer side does not have.

| Surface | Status | Issue |
|---|---|---|
| Book-wide tenant coverage, snapshot history/detail/objects | CURRENT — built, unchanged | #1843 |
| Collection triggering via the Workflow Engine (the only producer path) | CURRENT — built, unchanged | #1843, #1796 (the engine node) |
| The resource-type registry (platform-wide, not tenant-scoped) | CURRENT — built; underlying row counts still shift as the build-resource-model script is corrected (§2.3) | #1843; registry corrections #1960/#2841/#2010 (customer-side pack's own history) |
| Four-mode comparison compute + book-scoped history/detail | CURRENT — built, unchanged | #1843, #1797 (the differ) |
| The noise ruleset (data-driven, zero `observed_volatile` rows in practice) | CURRENT — built; real behavior matches the portal pack's own §6.7 read | #1797 |
| The #2759 attribution layer, wired on the operator side | CURRENT — confirmed by direct route read this pass, not assumed from the sibling pack | #2759 |
| The baseline registry (declare/list/retire, no delete) | CURRENT — built, unchanged | #1843 |
| An MSP Console page consuming any of these 16 routes | **Not built** — `artifacts/msp-console` remains a bare scaffold (§1) | No tracking issue found specific to a config-state MSP Console page |

---

## 7. Open gaps and notes — not decided, flagged for whoever wires this next

### 7.1 Zero route-level test coverage on either file in this pack

`grep` confirms no `msp-config-state.test.ts` or `msp-config-state-diffs.test.ts` exists anywhere
in the repo. This is **not unique to the operator side** — `portal-config-state.ts` (the
customer route file) has no route-level test file either. The underlying business logic is
tested at the library level (`config-snapshot-differ.test.ts`,
`config-snapshot-differ.live-db.test.ts`, `config-snapshot-collector.test.ts`,
`config-change-attribution.live-db.test.ts` all exist and exercise the differ/collector/
attribution engines directly), so this is an HTTP-contract test gap on top of tested business
logic, not an untested subsystem. Flagged, not filed — the gap is repo-wide across this whole
module's route layer (both customer and operator sides), not something introduced or specific to
either of this pack's two files.

### 7.2 Registry counts keep moving under a table neither route file in this pack writes to

§2.3 documents a real 29-row shift in the collectable/not-collectable split in the five days
since the portal pack's own read. Nothing in `msp-config-state.ts` or `msp-config-state-diffs.ts`
writes to `config_snapshot_resource_types` — only the external
`scripts/config-state/build-resource-model.mjs` build script does. Worth whoever wires a registry
page against `GET /registry` knowing the underlying numbers are not static even between two close
reads; not a bug in either route, and not this pack's own finding to attribute to a specific
commit.

### 7.3 The double-`/api`-prefix bug on the *admin* siblings is real, tracked, and NOT in this pack's own two files

Both route files' headers (`msp-config-state.ts:52-59`, `msp-config-state-diffs.ts:68-75`) flag
that the sibling `admin-config-snapshots.ts`/`admin-config-diffs.ts` repeat the `/api` mount
prefix and are therefore unreachable at the path their own admin-panel pages fetch. Re-confirmed
this pass: `artifacts/api-server/src/routes/index.ts:295-296` imports
`adminConfigSnapshotsRouter`/`adminConfigDiffsRouter` — **already tracked as its own issue, #2099,
still OPEN** (`Config snapshot/diff admin routes are served at /api/api/admin/config-* — both
#1798 admin-panel pages 404`). Not re-filed here — this pack's own two route files
(`msp-config-state.ts`/`-diffs.ts`) do **not** repeat the prefix and are mounted correctly
(`routes/index.ts:589-590`); the bug belongs entirely to the separate `admin-config-*.ts` pair,
which this pack does not otherwise cover.

### 7.4 No baseline read on the customer side at all — restated from §0.2/§3.7, not a gap

A customer cannot see what baseline their own tenant is assessed against, nor that one even
exists — the whole baseline registry is operator-only by design, per #1843's own scope. Stated
plainly here because a future Design pass on the customer portal side might otherwise assume a
"my baseline" read exists somewhere; it does not, on either surface's current route list.

---

## 8. The forbidden list — declared, not merely absent

1. **No cross-tenant/cross-MSP read or write.** All 16 routes resolve the caller's book
   (`resolveConfigStateBook`) before touching a row; every id-scoped route re-verifies book
   membership before returning anything, and returns `404` (never `403`) for an out-of-scope id
   (§1.1). Verified across every route in both files, no exception.
2. **The resource-type registry and the noise ruleset are the only two reads in this pack with no
   tenant scoping at all** — confirmed deliberate, both by explicit code comment (§2.3, §3.3) and
   by the fact neither table carries a `tenant_id` column that could scope it.
3. **`POST /collections` is a read of the tenant, never a write.** Structurally confirmed: the
   route hands off entirely to the Workflow Engine and imports no collector or Graph-write
   function directly (§2.5).
4. **`POST /diffs` with `mode: "promotion"` computes a difference only.** No apply path exists in
   either file — confirmed by direct read of every route; applying configuration is out of
   scope, recorded as an explicit non-goal on #1797/#1843 (§0.3).
5. **The attribution pass never writes outside its own tables.** `POST
   /diffs/:diffId/attribution` reads Change Control and the Risk Register and writes only
   `config_change_attributions`/`config_change_scopes`/`config_change_lifecycle` — confirmed by
   direct read of `attributeDiff`'s own call sites; it never issues an `UPDATE` against
   `msp_change_requests`, `msp_risk_decisions`, or `config_diffs` itself (§3.6).
6. **A baseline cannot be repointed, only retired.** `PATCH /baselines/:id` rejects any body
   other than `{ isActive: false, retiredReason }` — confirmed by direct read of the route's own
   validation (§3.7); "declare a new baseline instead" is the route's own stated alternative.
7. **No DELETE route exists for a snapshot, a diff, a baseline, or a noise rule anywhere in
   either file** — re-confirmed this pass (`grep -c "router.delete"` on both files → 0 each).
   Sealed/immutable-by-trigger snapshots and diffs, and retire-only baselines, are the only
   lifecycle this module supports.

---

## 9. Honest-empty contract

Verified live against the local Postgres instance, 2026-09-09:

| Table | Real row count |
|---|---|
| `tenant_config_snapshots` | **0** |
| `config_diffs` | **0** |
| `config_snapshot_baselines` | **0** |
| `config_diff_property_rules` | 6 (all `ignore`/`structural_annotation`, §3.3) |
| `config_snapshot_resource_types` | 1,541 (1,063 collectable / 478 not collectable, §2.3) |
| `config_change_attributions` | **0** |
| `config_change_scopes` | **0** |
| `config_change_lifecycle` | **0** |
| `tenants` | 2 (`id=1` "Jane Jane", testbed; `id=3` "Test Me") |

**Every data-dependent table this pack's routes read from is empty today** — a materially
different live state than the customer-portal pack recorded on 2026-09-04 (its own snapshot row
110, diff row 221). This is the honest, current state of the local development database at
extraction time, not a defect in either pack: the local Postgres install is a real, resettable
instance (see `CLAUDE.md`'s own Database section), and nothing about this subsystem's schema or
routes prevents it from being repopulated by a fresh `POST /collections` call followed by a
`POST /diffs`. `GET /tenants` (§2.1), `GET /snapshots` (§2.2), and `GET /diffs` (§3.2) will
genuinely return `everCollected: false` / empty arrays for **every real customer today** — the
honest current state of a module whose backend has simply had nothing collected against it since
whatever last reset this local database, not a read failure.

---

## Real findings filed this pack

**None filed.** Every gap surfaced during this extraction is either:
- already tracked under its own issue and re-confirmed still open (#2099, §7.3), or
- a flagged-not-filed design note consistent with how this project's sibling MSP-console packs
  already handle the same class of observation (route-level test coverage, §7.1; a registry
  count that moved under a script this pack's own routes do not touch, §7.2; a by-design
  operator-only scope with no customer equivalent, §7.4).

No orphaned-endpoint issue was filed for the zero-consumer state recorded in §1 — same rationale
as every prior MSP-console pack: these 16 routes are the expected pre-Design/pre-wire state for a
module whose API build (#1843) intentionally precedes its MSP Console page.

---

## Appendix — files read for this pack

- `artifacts/api-server/src/routes/msp-config-state.ts` (526 lines, read in full)
- `artifacts/api-server/src/routes/msp-config-state-diffs.ts` (781 lines, read in full)
- `artifacts/api-server/src/lib/msp-config-state-scope.ts` (106 lines, read in full)
- `artifacts/api-server/src/lib/config-state-views.ts` (`snapshotCompleteness`,
  `diffCompleteness`, `diffSides`, `readResourceRegistry`, `readResourceRegistrySummary`
  signatures and bodies)
- `artifacts/api-server/src/lib/config-change-attribution.ts` (`DiffVerdictRollup`,
  `readDiffVerdictRollup`, `attributeDiff`, `ensureDiffAttributed`, `DiffNotAttributableError`)
- `artifacts/api-server/src/routes/index.ts` (import + mount lines, re-verified this pass:
  `:301-303` / `:588-590`; `admin-config-*` import lines `:295-296` for §7.3)
- `lib/db/src/schema/config-snapshots.ts` (`tenantConfigSnapshotsTable`,
  `configSnapshotResourceTypesTable`, `configSnapshotBaselinesTable`, all enum exports)
- `lib/db/src/schema/config-diffs.ts` (`configDiffsTable`, `configDiffPropertyRulesTable`, all
  enum exports)
- `lib/db/src/schema/config-attribution.ts` (`configChangeAttributionsTable`,
  `configChangeScopesTable`, `configChangeLifecycleTable`, all enum exports)
- `lib/db/src/schema/config-state.ts` (`CONFIG_READ_TRANSPORTS`, `CONFIG_SURFACES`,
  `CONFIG_AVAILABILITY`)
- `docs/portal/configuration-state-contract-pack.md` (cross-reference throughout — the customer
  half of this module, not edited by this pack)
- Direct query, local Postgres (`shanemccawmsp`), this pass: row counts for all tables in §9;
  `\d tenant_config_snapshots`, `\d config_diffs`, `\d config_snapshot_baselines`,
  `\d config_diff_property_rules` (columns, CHECK constraints, FKs); registry
  collectable/not-collectable split (§2.3); `config_diff_property_rules` action/basis breakdown
  (§3.3); `tenants` table contents
- Repo-wide grep, this pass: `config-state`/`configState` in `artifacts/msp-console/src`,
  `artifacts/admin-panel/src`, `artifacts/mcp-server/src` (one non-matching hit, §1); `router.delete`
  in both route files (zero matches each, §8); test file existence for both route files and the
  sibling `portal-config-state.ts` (none exist, §7.1)
- GitHub, this pass: #3355 (this issue — confirmed leaf via GraphQL `subIssues.totalCount: 0`,
  parent #1571 via GraphQL `issue.parent`), #1843 (CLOSED, the original API build), #2099 (OPEN,
  the double-`/api`-prefix bug on the admin siblings), #1642 (the extraction-pattern precedent),
  #1571 (EPIC: Portal Admin)
