# Microsoft Changes — contract extraction pack

**For Claude Design. Extracted, not authored — every claim below is cited to file:line against
the code on `main`.** Read-only build: no product code, no schema, no UI were changed to produce
this document.

Module: **Microsoft Changes** (leaf issue #1642, module epic #1494, portal epic #1485). This pack
**replaces the previous one wholesale** (#1494 / commit `4c5c5495e`). That earlier pack was written
when only #1530–#1533 had landed; it predated and therefore omitted the three layers that finish the
module — **#1534** (routing), **#1536** (date quality) and **#1537** (cloud instance) — and its line
numbers no longer match the current route. Do not consult the old version; it documented intent for
everything after #1533.

**Updated by #2598** to add surface F — `GET /api/msp/message-center`, the MSP-operator counterpart
of surface A, extracted per the same #1642 pattern. F is new ground, not a re-extraction of A–E.

**This is the first contract pack on the project generated from a module whose backend is actually
finished.** The whole interpret → resolve → route pipeline exists on `main`. The one caveat, stated
up front because it changes how Design should read every "measured"/"routed" field below, is a
**data** fact, not a code one:

> **The pipeline is built but currently DORMANT.** Live-DB counts (queried this session against the
> local `DATABASE_URL`, 2026-08-29): `m365_change_interpretations` = **0**, therefore
> `m365_change_resolutions` = **0**, `m365_change_routings` = **0**, and auto-routed change requests
> = **0**. There are **1159** Message Center items and **1795** roadmap items collected. So today
> **every post's `analysis` is `null`** and the whole "your tenant's counted answer" / auto-CR half
> of the module renders its honest-empty state for real, not as a placeholder. Design must draw both
> the populated and the empty states; the empty ones are what a live tenant sees right now.

---

## 0. The six surfaces of this module

| # | Surface | File | Audience | Writes? |
|---|---|---|---|---|
| A | `GET /api/portal/message-center` | `artifacts/api-server/src/routes/portal-message-center.ts` | Customer (the page) | no |
| B | AdminV2 interpretation + resolution routes | `artifacts/api-server/src/routes/admin-m365-interpretations.ts` | MSP admin (authoring) | yes |
| C | `POST /api/portal/change-control/:code/decline` | `artifacts/api-server/src/routes/portal-change-control.ts:539` | Customer (the decline action) | yes (CR + risk) |
| D | The routing engine (no HTTP surface) | `artifacts/api-server/src/lib/m365-change-router.ts` | Workflow node | yes (CRs, routings, risks) |
| E | The sync writers (no HTTP surface) | `message-center-sync.ts`, `m365-roadmap-sync.ts`, `m365-change-resolver.ts` | Workflow nodes | yes (the source tables) |
| F | `GET /api/msp/message-center` | `artifacts/api-server/src/routes/msp-message-center.ts` | MSP operator (the future console list, #1688) | no |

The **customer-facing Microsoft Changes page is surface A only.** B/D are the MSP-side machinery
that decides what a post *means* and what it *becomes*; C is the one write the page itself triggers,
and it posts to a *different* route (Change Control), not back to A. Design draws A, and must
understand B–E to render A's fields honestly. **F is added by #2598** — it is the MSP-operator
counterpart of A (same source table, no per-tenant interpretation shaping), and it is currently
**orphaned**: registered and live on `main`, but no `artifacts/msp-console` UI calls it yet (the
console itself is blocked on #1680; see §1g).

---

## 1. Per-surface wire contract

### 1a. `GET /api/portal/message-center` — the customer surface (A)

Source: `artifacts/api-server/src/routes/portal-message-center.ts:283-511`. Customer-scoped:
`requireRole("CustomerUser")` (`:285`); the customer is `resolveCustomerId(req)` off the JWT
(`:287`), never a request param — the route header (`:8-66`) explains at length why there is
deliberately no `customerId` input to accept. Read-only (`:61-66`).

**Two distinct top-level shapes** are returned, and Design must not assume the fuller one.

**Shape 1 — `scoped: false`** (`:298-305`), when the account has no resolvable tenant row:

```
{ scoped: false, itemCount: 0, posts: [], density: [], buckets, stats: [], workloads: [],
  dateUnclearCount: 0, dateUnclearPosts: [] }
```

Note `buckets` **is** still computed and returned even here (the axis is a function of the clock,
not the tenant), so the page can render the empty grid honestly. `waveShort`, `onAxisCount`,
`postsTruncated`, `lastSyncedAt`, `scanAt` and `provenance` are **absent** in this branch — Design
must treat them as optional and not read them when `scoped` is false.

**Shape 2 — `scoped: true`** (`:455-505`), the full payload:

| Field | Type | Nullability | Line |
|---|---|---|---|
| `scoped` | `true` | — | `456` |
| `itemCount` | `number` (whole corpus, incl. past rollouts) | never null | `458` |
| `onAxisCount` | `number` (subset inside the 11-bucket forward axis) | never null | `460` |
| `postsTruncated` | `boolean` (per-wave cap applied, see §"POSTS_PER_WAVE") | never null | `461` |
| `lastSyncedAt` | `string \| null` (ISO) | null when no rows | `462` |
| `scanAt` | `string \| null` ("21 August, 00:45") | null when no rows | `463` |
| `buckets` | `Bucket[]` (11 entries, §1e) | never null | `464` |
| `waveShort` | `Record<string,string>` (band → short label) | never null | `465` |
| `posts` | `(WirePost & { analysis })[]` | never null, may be `[]` | `466` |
| `density` | `DensityRow[]` | never null, may be `[]` | `467` |
| `stats` | `StatDef[]` (6 fixed cards) | never null | `468` |
| `workloads` | `{ wl, name, found }[]` | never null | `469` |
| `dateUnclearCount` | `number` (#1536, whole corpus) | never null | `476` |
| `dateUnclearPosts` | `WireDateUnclearPost[]` (#1536, capped) | never null, may be `[]` | `477` |
| `provenance` | object, §5 | never null | `482-504` |

**`WirePost`** (`portal-message-center.ts:136-169`, `toWirePost` at `:248-281`) — one entry per
post that landed on the dated axis, capped per wave:

| Field | Type | Nullability | Line |
|---|---|---|---|
| `id` | `string` (= `graphMessageId`) | never null | `138`, `254` |
| `title` | `string` | never null | `139`, `255` |
| `wl` | `string` (workload key, §3) | never null | `140`, `256` |
| `workload` | `string` (readable) | never null | `141`, `257` |
| `kind` | `string` (readable kind label, §3) | never null | `142`, `258` |
| `hard` | `boolean` (true iff kind === `"b"`) | never null | `143`, `259` |
| `month` | `number` (calendar-month offset from now, ≥0) | never null | `144`, `261` |
| `when` | `string` ("1 October 2026") | never null | `145`, `262` |
| `countdown` | `string` ("in 6 weeks" / "today" / "2 weeks ago") | never null | `146`, `263` |
| `score` | `number` 0–100 | never null | `147`, `264` |
| `impact` | `string` ("Hits you" / "Might hit you" / "No impact") | never null | `148`, `265` |
| `bucket` | `number` (index into `buckets`, always ≥0 in a served post) | never null | `149`, `266` |
| `ms` | `string` (Microsoft's body, HTML flattened) | never null, may be `""` | `150`, `267` |
| `plain` | `string` | **always `""`** — §6 | `151`, `271` |
| `msSays` | `string` (first line of `ms`) | never null, may be `""` | `152`, `272` |
| `services` | `string[]` (Microsoft's own) | never null, may be `[]` | `153`, `273` |
| `tags` | `string[]` (Microsoft's own) | never null, may be `[]` | `154`, `273` |
| `publishedAt` | `string` (ISO; `startDateTime ?? lastModifiedDateTime`) | never null | `155`, `275` |
| `lastModifiedAt` | `string` (ISO) | never null | `156`, `276` |
| `actionRequiredBy` | `string \| null` (ISO) | **often null** — §"date quality" | `157`, `277` |
| `advisoryDateText` | `string \| null` (**#1536**; Microsoft's own prose, never a Date) | null when none found | `166`, `278` |
| `dateConfidence` | `"dated"` (literal — a post only reaches `posts[]` once it has a structural date) | never null | `168`, `279` |
| `analysis` | `WireAnalysis \| null` | **null today for all posts** (0 interpretations); null whenever no confirmed interpretation exists | `427` |

**`WireDateUnclearPost`** (**#1536**, `portal-message-center.ts:180-192`, `toWireDateUnclearPost`
at `:194-210`) — a deliberately **smaller, distinct shape** for a post with no structural date at
all. It has **no** `bucket`/`when`/`countdown`/`score`/`impact`, because computing any of those
would mean falling back to `lastModifiedDateTime` (an edit timestamp) and presenting it as a
landing date — the exact failure this bucket exists to avoid:

| Field | Type | Line |
|---|---|---|
| `id` | `string` | `181`, `198` |
| `title` | `string` | `182`, `199` |
| `wl` | `string` | `183`, `200` |
| `workload` | `string` | `184`, `201` |
| `kind` | `string` | `185`, `202` |
| `ms` | `string` | `186`, `203` |
| `services` | `string[]` | `187`, `204` |
| `tags` | `string[]` | `188`, `205` |
| `lastUpdated` | `string` ("1 October 2026"; honestly labelled as the last-modified date, **not** a landing date) | `189`, `206` |
| `advisoryDateText` | `string \| null` | `190`, `207` |
| `dateConfidence` | `"unclear"` (literal) | `191`, `208` |

> **Live: `dateUnclearCount` is 0.** Every one of the 1159 real posts carries at least an
> `endDateTime`. This surface is defensive-but-real architecture, not presently load-bearing —
> but it is wired and honest, so Design should render it, styled for the rare/zero case.

**`WireAnalysis`** (`portal-message-center.ts:223-234`, built at `:406-422`) — the tenant's own
reading: the #1532 interpretation (WHAT the change is) plus, where the #1533 resolution layer
actually counted this tenant's estate, the NUMBER:

| Field | Type | Nullability | Line |
|---|---|---|---|
| `summary` | `string \| null` | interpretation summary | `224`, `411` |
| `changeClass` | `string` (real enum, §3) | never null when `analysis` present | `225`, `412` |
| `whoActs` | `string` (`"microsoft"` \| `"admin"`) | never null | `226`, `413` |
| `controllable` | `string` (`"yes"` \| `"no"` \| `"unknown"`) | never null | `227`, `414` |
| `controlMethod` | `string \| null` | null unless a control exists | `228`, `415` |
| `measured` | `boolean` | true iff resolution `status === "measured"` **and** `affectedCount !== null` | `229`, `409`, `416` |
| `affectedCount` | `number \| null` | **null unless `measured`** — never a guessed zero | `230`, `417` |
| `measuredAt` | `string \| null` (ISO) | null unless `measured` | `231`, `418` |
| `basis` | `string \| null` (`"monitor_check"` \| `"license_snapshot"`) | null unless `measured` | `232`, `419` |
| `noise` | `boolean` | true iff `measured && affectedCount === 0` — a counted zero, the suppression signal (§4) | `233`, `420` |

The analysis join (`:377-404`) is **confirmed interpretations only** (`eq(status,"confirmed")`,
`:401`) — a proposed (AI, unverified) reading never reaches a customer.

### 1b. AdminV2 interpretation + resolution routes (B)

Source: `artifacts/api-server/src/routes/admin-m365-interpretations.ts`. `requireAdmin`-gated,
never customer-reachable; the MSP is resolved server-side (`resolveDefaultMspId`, `:68-79`), never
from the body. **Not part of the customer page** — included because it is where interpretations are
authored and where cloud filtering (#1537) actually lives.

| Route | Method | Purpose | Line |
|---|---|---|---|
| `/admin/m365/interpretations` | GET | library + status counts | `111` |
| `/admin/m365/interpretations/candidates` | GET | roadmap/MC sources with no interpretation yet | `148` |
| `/admin/m365/interpretations/propose` | POST | AI proposes (unsaved) | `265`+ |
| `/admin/m365/interpretations` | POST | create (default `status: "proposed"`) | — |
| `/admin/m365/interpretations/:id` | PATCH | edit | — |
| `/admin/m365/interpretations/:id/confirm` | POST | → `status: "confirmed"` | — |
| `/admin/m365/interpretations/:id/reject` | POST | → `status: "rejected"` | — |
| `/admin/m365/interpretations/:id` | DELETE | remove | — |
| `/admin/m365/interpretations/:id/resolve` | POST | run count now across tenants (confirmed-only) | — |
| `/admin/m365/interpretations/:id/resolutions` | GET | stored per-tenant answers | — |

**`toWire(interpretation)`** (`admin-m365-interpretations.ts:82-108`): `id`, `mspId`, `featureId`
(`string \| null`), `graphMessageId` (`string \| null`), `sourceKind` (`"roadmap"` \|
`"message_center"` \| `"manual"`), `title`, `summary`, `changeClass`, `touches` (§3), `whoActs`,
`controllable`, `controlMethod`, `probe` (§3), `status`, `proposedBy` (`"ai"` \| `"human"`),
`aiModel`, `aiRationale`, `confirmedBy`, `confirmedAt`, `notes`, `createdBy`, `createdAt`,
`updatedAt`.

**`GET .../candidates`** (`:148-263`) — **this is where #1537's cloud dimension is a real wire
control.** Response (`:258`): `{ roadmap: RoadmapCandidate[], messageCenter: MCCandidate[],
cloudMode }`, plus `noMsp: true` when no MSP resolves (`:153`).

- `cloudMode` echoes the applied filter, parsed from **`?cloud=worldwide|gov|all`**
  (`parseCloudInstanceFilterMode(req.query.cloud)`, `:150`) — an unrecognized value degrades to
  `"worldwide"` (the platform default), never 500s.
- Each `RoadmapCandidate` (`:192-199`) carries `featureId`, `title`, `status`, `products`,
  **`cloudInstances: string[]`** (`:197` — Microsoft's own real tags), `msModified`, and
  `crossedOver: boolean` (the #1531 join — has this roadmap item landed in any tenant's Message
  Center feed yet).
- The cloud filter is applied **before** the 200-row cap (`:186-191`), so a gov-heavy result page
  cannot crowd out worldwide items in `"worldwide"` mode (or vice versa in `"gov"`).
- Each `MCCandidate` (`:246-254`) carries `graphMessageId`, `title`, `category`, `isMajorChange`,
  `services`, `roadmapFeatureIds: string[]` (`[]` when the #1531 column isn't present yet — the
  `hasRoadmapFeatureIdsColumn()` gate, `:209`, never throws), `lastModifiedDateTime`.

> **The customer page (A) does NOT expose `cloudInstances` or `cloudMode`.** #1537's filtering is
> an **admin-authoring-side** dimension today, applied when Shane picks what to interpret. Design
> must not draw a GCC/gov cloud toggle on the *customer* Microsoft Changes page — no such control
> exists on surface A, and the customer-facing posts are already tenant-scoped by Microsoft.

### 1c. `POST /api/portal/change-control/:code/decline` — the decline action (C)

Source: `artifacts/api-server/src/routes/portal-change-control.ts:539-614`.
`requireRole("CustomerUser")` + `requireAddOnEntitlement(CHANGE_CONTROL_FEATURE_KEY)` (`:541-542`).
This is the one write the Microsoft Changes experience triggers, and it lands on **Change Control**,
not on this module.

- `:code` is a CR code like `CR-2026-101`, parsed to the numeric id (`parseChangeRequestCode`,
  `:532-537`).
- Body (`declineSchema`, `:526-529`): `{ fullName: string(1..200), statement: string(1..2000) }`.
- Guards: the CR must belong to the caller's own resolved `(mspId, tenantId)` (`:571-585`) **and**
  have `sourceKind === "microsoft_change"` (`:586-589`) — **only an auto-routed Microsoft change
  can be declined here**; a wizard-raised CR is a 409.
- On success: `201` (or `200` if already rejected), body `{ code, declined: true, riskAccepted:
  boolean }` (`:604-608`). The write itself is `declineRoutedChangeToRisk` (surface D) — a
  customer decline drives the CR to terminal `rejected` **and** creates an accepted-risk record
  (#1514).

### 1d. The routing engine (D) — `m365-change-router.ts` (no HTTP surface)

The third pipeline stage, after interpretation (#1532) and resolution (#1533). It decides what a
resolved change **becomes** and records it durably. Wired as the `m365_route_changes` Workflow
Engine node, seeded "__system__: M365 Changes Routing", run daily **after** the resolution sweep.
See §2 (the gate) — this is the module's single most important behaviour for Design to understand,
because it is what turns a Message Center post into a Change Request the customer can decline.

Key exports: `decideRouting` (`:139-159`, the pure gate), `deriveIntake` (`:89-95`),
`deriveImplementer` (`:103-107`), `changeClassForIntake` (`:116-118`), `createRoutedChangeRequest`
(`:220-332`), `routeResolution` (`:409-493`), `runM365ChangeRoutingSweep` (`:508-537`),
`declineRoutedChangeToRisk` (`:586-638`).

### 1e. `Bucket`, `DensityRow`, `StatDef` (shared, from the lib)

Source: `artifacts/api-server/src/lib/portal-message-center.ts`.

- **`Bucket`** (`:188-196`): `{ label, sub, wave, from (ISO, inclusive), to (ISO, exclusive) }`.
  Fixed **11-bucket / 5-band** shape (3 fortnights, 6 months, 2 quarters; the last quarter is
  open-ended 100 years into the future, `:298`). The 1/2/3/3/2 band grouping is **fixed** because
  the page's wave URLs are positional (`applyWaves`, `:312-325`); only the labels move with the
  clock (`buildBuckets`, `:230-303`).
- **`DensityRow`** (`:404-408`): `{ wl, name, cells: [breaks,decides,visible,silent][] }` — one
  row per workload with ≥1 on-axis post (workloads with none are omitted, not zero-filled,
  `:435-439`), one 4-tuple per bucket.
- **`StatDef`** (`:548-554`): `{ key, label, value: string, sub, tone }` — 6 fixed cards
  (`decisions`, `hits`, `soon`, `reversed`, `seen`, `none`), built at `:587-594`.

### 1f. The sync writers (E)

Not routes — visible Workflow Engine nodes; the **sole writers** of this module's source tables:

- `syncMessageCenterForTenant` (`lib/message-center-sync.ts`) → `msp_message_center_items`,
  per-tenant, daily, for tenants with granted Graph consent. It also parses `advisory_date_text`
  (#1536) and `roadmap_feature_ids` (#1531) once at sync time.
- `syncM365RoadmapSnapshot` (`lib/m365-roadmap-sync.ts`) → `m365_roadmap_items` +
  `m365_roadmap_sync_state`, global; captures `cloud_instances` from Microsoft's feed (v1
  `tagsContainer.cloudInstances[].tagName`, v2 `availabilities.cloudInstance`, `:276`, `:344-357`).
- `runM365ResolutionSweep` (`lib/m365-change-resolver.ts`) → `m365_change_resolutions`, from
  **stored data only** (`allowLive: false`).

### 1g. `GET /api/msp/message-center` — the MSP-operator surface (F)

Source: `artifacts/api-server/src/routes/msp-message-center.ts:24-55`, 57 lines total, one route.
Own header (`:1-11`) states it plainly: **read-only** view of the same rows surface A/E write,
for the operator side, not the customer side. `requireRole("MSPOperator")` (`:24`) — the tiered
guard (`requireAuth.ts:205-223`), so `MSPOperator`/`MSPAdmin`/`PlatformAdmin`(legacy `role:
"admin"`) all pass; scope is the caller's own `mspId` via `resolveMspIdStrict(req)` (`:26`,
`resolve-msp-id.ts:75-77`, `req.user?.mspId ?? null`) — **403 `{ error: "MSP context required" }`**
(`:27-30`) if the caller has no `mspId` claim (e.g. a legacy PlatformAdmin with none set).

**Query parameters** (`:32-36`), all optional:

| Param | Type | Behavior | Line |
|---|---|---|---|
| `category` | string | exact match against `category` (§3 enum) | `32`, `39` |
| `customerId` | number | exact match against `customerId`; a non-numeric value is silently dropped (checked with `!isNaN`, not surfaced as a 400) | `33-34`, `40` |
| `limit` | number | `Math.min(Number(query.limit ?? 50), 200)` — default 50, hard cap 200 | `35` |
| `offset` | number | `Math.max(Number(query.offset ?? 0), 0)` — default 0, floor 0 | `36` |

**Response shape** (`:50`): `{ items, limit, offset }`. `items` is the **raw Drizzle row set** —
every `mspMessageCenterItemsTable` column (`lib/db/src/schema/msp.ts:2634-2678`), unfiltered and
unshaped. Unlike surface A's `toWirePost` (§1a), **F has no wire-shaping function** — there is no
narrower `WireMspMessageCenterItem` type, no `analysis`, no `provenance`, no bucket/density/stat
computation. This is a real, current design gap, not a citation gap: today F serves exactly what
the sync writer (E) wrote, nothing derived. `limit`/`offset` are echoed back verbatim, not the
actual row count returned or a total-matching count — a caller cannot tell from the response alone
whether more rows exist past the page (no `hasMore`/`total`).

Ordered `desc(lastModifiedDateTime)` (`:46`) — newest-first, matching A's own axis.

**Live data** (queried this session against local `DATABASE_URL`, 2026-09-03): **1157** rows, one
`mspId` (the only MSP in local dev), `customerId` **never** null on any row, `severity` is the
single literal `"normal"` on every row (Graph has not sent a differing value locally), `category`
distribution `stayInformed` 715 / `planForChange` 403 / `preventOrFixIssue` 39 — the same three-value
enum as surface A (§3).

**Orphaned today.** No route in `artifacts/msp-console` (or anywhere else) calls
`GET /api/msp/message-center` — `artifacts/msp-console` does not exist yet; #1688 (the Feature this
route exists for) is explicitly blocked on the console scaffold, #1680. This pack documents F as a
live, correctly-scoped, working endpoint with **zero UI consumers**, not as dead code to remove.

**Known defect (filed #2696, sub-issue of #1688):** `limit`/`offset` (`:35-36`) are not NaN-guarded
the way `customerId` two lines above already is — a non-numeric value reaches Postgres as
`LIMIT NaN`, which Postgres rejects (`ERROR: bigint out of range`, confirmed this session against
the real local `DATABASE_URL`), so a bad query param surfaces as the route's generic 500 rather
than a 400. Small, contained; not blocking on the console build.

---

## 2. The routing gate — as built (#1534)

This is the heart of the finished module and had no equivalent in the old pack. `decideRouting`
(`m365-change-router.ts:139-159`) is a pure function over four inputs
(`resolutionStatus`, `affectedCount`, `hasAnnouncement`, `hasStructuralDate`) that returns one of
four decisions. **This is the ONLY noise control in the module** — the customer route stays
read-only and never suppresses.

| Condition | Decision | Reason | What happens |
|---|---|---|---|
| not measured, or `affectedCount === null` | `none` | `not_measured` | Nothing routed; the honest "not read against this notice" state stands (`:142-144`) |
| measured, `affectedCount === 0` | `proposed` | `zero_affected` | A measured zero → surfaced for a human, never silently auto-created (`:148-150`) |
| measured, `> 0`, no tenant announcement | `proposed` | `no_announcement` | (`:152-154`) |
| measured, `> 0`, announced, **no structural date** | `proposed` | `undated` | (incl. #1536 "date unclear") (`:155-157`) |
| measured, `> 0`, announced, **dated** | `auto_created` | `auto_created` | **Auto-creates a Change Request**, Microsoft as implementer (`:158`) |
| a routed CR the customer later declines | `declined_risk` | (carried) | Becomes an accepted risk (#1514) — a *later* transition, never produced by the sweep (`:130-132`, `:586-638`) |

**The intake axis** (`deriveIntake`, `:89-95`) — derived from the interpretation's
`whoActs`/`controllable`, this is the axis #1494's timeline reads as "do I have to act", distinct
from the ITIL `change_class`:

- `controllable === "yes"` → **`approval`** (a control exists — a real decision to leave on or turn off)
- else `whoActs === "admin"` → **`advisory`** (requires the customer's own team to do work)
- else → **`informed`** (Microsoft acts, no opt-out; auto-approved from announcement, `:249`)

**Implementer** (`deriveImplementer`, `:103-107`): `whoActs === "admin"` → `customer`, else
`microsoft`. **Stored `change_class`** (`changeClassForIntake`, `:116-118`): `informed` →
`standard` (pre-approved), `approval`/`advisory` → `normal`. The "nobody pre-authorised this"
nuance rides the dedicated `intake` column, **not** an overloaded `change_class`.

**Idempotency:** one routing row per `(interpretation × customer)` (unique index
`m365_change_routings_interp_customer_uidx`), and a partial unique index on
`msp_change_requests(source_interpretation_id, tenant_id)` (declared in the manual migration —
schema note at `msp.ts:3967-3971`) guarantees a CR is created at most once. Terminal customer
states (`auto_created` with a CR, or `declined_risk`) are never rewound by a later sweep
(`:426-431`).

**Decline → risk** (`declineRoutedChangeToRisk`, `:586-638`): a **customer** decline drives the CR
to `rejected` and creates an accepted-risk record (`msp_risk_decisions`) back-linked via
`spawnedByChangeRequestId` (`msp.ts:4187`) — the rejection *is* the risk acceptance (#1514). An
**MSP** decline produces **no** risk record (`:613-621`). Idempotent (`:595-603`).

---

## 3. Real enum unions only

All verbatim from `lib/db/src/schema/msp.ts`, cited to line. **Design must not invent a status
vocabulary outside these lists.**

```ts
// msp.ts:2484-2490 — the interpretation's ITIL-ish class
M365_CHANGE_CLASSES = ["retirement", "default_flip", "new_feature", "breaking_change", "licensing"]

// msp.ts:2493
M365_INTERPRETATION_STATUSES = ["proposed", "confirmed", "rejected"]

// msp.ts:2497 — who must act for the change to take effect
M365_ACTORS = ["microsoft", "admin"]

// msp.ts:2501 — can it be turned off; "unknown" is the honest default, never omitted
M365_CONTROLLABILITY = ["yes", "no", "unknown"]

// msp.ts:2598 — resolution outcome
M365_RESOLUTION_STATUSES = ["measured", "not_measured", "error"]

// msp.ts:2602 — which probe infra produced a measured number
M365_RESOLUTION_BASES = ["monitor_check", "license_snapshot"]

// msp.ts:2611-2620 — why a resolution is not_measured (structured, not vague)
M365_NOT_MEASURED_REASONS = ["no_probe","check_not_found","no_stored_profile","sku_not_mapped",
                             "no_sku_data","license_gap","consent_revoked","requires_script"]

// ── The routing layer (#1534) — new since the old pack ──
// msp.ts:2697 — what a resolved change becomes
M365_ROUTING_DECISIONS = ["auto_created", "proposed", "declined_risk", "none"]

// msp.ts:2701-2707 — why it was proposed/skipped rather than auto-created
M365_ROUTING_REASONS = ["auto_created", "undated", "zero_affected", "not_measured", "no_announcement"]

// msp.ts:3864 — the intake axis on a routed CR ("do I have to act")
CHANGE_REQUEST_INTAKES = ["informed", "approval", "advisory"]

// msp.ts:3876 — who executes a routed change
CHANGE_REQUEST_IMPLEMENTERS = ["microsoft", "customer", "msp"]

// msp.ts:3880 — what spawned a CR; only microsoft_change is written; NULL = raised directly
CHANGE_REQUEST_SOURCE_KINDS = ["microsoft_change"]
```

**Post `kind`** — not a DB enum, a derived classification (`lib/portal-message-center.ts:128`,
`kindForPost` `:140-148`): `"b" | "d" | "v" | "s"` — breaks-something / needs-a-decision /
your-people-will-see-it / silent. A priority ladder over Microsoft's own `category` + `tags`, never
a reading of the tenant. Readable labels via `kindLabel` (`:155-163`): "Retirement", "Deferred
feature", "Feature update", "New feature", "Action required", "Plan for change", "Stay informed".

**Workload axis** (`lib/portal-message-center.ts:69-81`): `WORKLOAD_ORDER = ["Exchange", "Teams",
"SharePoint", "Entra", "Purview", "Copilot", "M365"]` — six named rows plus an explicit residual
"M365" row that catches everything else (it EXISTS rather than dropping unmapped services, so every
total on the page still sums the same corpus). Readable names in `WORKLOAD_NAMES`.

**Cloud instance vocabulary** (#1537) — **real strings only, verified live this session.** The
entire `m365_roadmap_items.cloud_instances` corpus (1795 items, 0 unclassified) contains exactly
four distinct values: **"Worldwide (Standard Multi-Tenant)"** (1605), **"GCC"** (514), **"GCC
High"** (441), **"DoD"** (400). The classifier does not enumerate these — it substring-matches the
gov family (`/\bGCC\b|\bDoD\b/i`, `m365-cloud-instance.ts:43`) so a new Microsoft tag degrades
sanely. Filter modes (`CloudInstanceFilterMode`, `:70`): `"worldwide"` (default; keeps everything
except gov-only items, and keeps unclassified), `"gov"` (GCC/GCC-High/DoD only; drops
unclassified), `"all"` (unfiltered).

**Roadmap item `status`** (`m365_roadmap_items.status`) — **free text from Microsoft**, not a closed
enum: "In development" / "Rolling out" / "Launched" is Microsoft's own `publicRoadmapStatus` kept
verbatim. Do not build a fixed-union status pill without a fallback for an unrecognized value.

**`M365Touches`** (`msp.ts:2511`) and **`M365Probe`** — structured objects, not enums:
```ts
interface M365Touches { services: string[]; protocols: string[]; skus: string[]; settings: string[]; }
interface M365Probe { description: string; monitorCheckKey?: string | null; powershell?: string | null; graphEndpoint?: string | null; }
```

---

## 4. Cross-surface edges

The module is read-only on surface A; writes happen on B/C/D/E. The edges Design must honour:

- **Roadmap → Message Center**, on Microsoft's roadmap **feature ID** (#1531). Parsed once at sync
  time from the MC post's body, persisted to `msp_message_center_items.roadmap_feature_ids`
  (GIN-indexed jsonb). Surfaced today only on the **admin candidates** endpoint's `crossedOver` /
  `roadmapFeatureIds`, **not** on the customer wire (see the `roadmapId` forbidden note, §6).
- **Interpretation → MC post**, on `graphMessageId` (`portal-message-center.ts:377-404`) — produces
  `posts[].analysis`. **Confirmed only** (`:401`).
- **Interpretation → Resolution**, on `interpretationId` + `customerId` (`:391-397`, left join) —
  one current resolution per pair, overwritten on re-measure.
- **Resolution → Routing** (D), on the same pair — the count is what trips the gate.
- **Routing → Change Control**, via `msp_change_requests.source*` columns (`msp.ts:3941-3960`):
  `intake`, `implementer`, `sourceKind = "microsoft_change"`, `sourceGraphMessageId`,
  `sourceInterpretationId`, `sourceResolutionId`. **All nullable** — every pre-routing CR leaves
  them null, and null reads as "raised directly, MSP implements". This is the link the customer's
  **decline** action (C) walks back.
- **Routing → Risk Register**, via `msp_risk_decisions.spawnedByChangeRequestId` (`msp.ts:4187`) —
  a declined routed CR becomes an accepted risk (#1514).
- **`noise: true`** (`portal-message-center.ts:420`) — a **measured** zero, the suppression signal.
  Any "hide noise" affordance keys off this, **not** `analysis === null` or `measured === false`
  (which mean "not counted" — a different fact from "counted and irrelevant").

---

## 5. The honest-empty contract per surface

The module has honest-empty mechanisms at three layers; Design must render them distinctly, not
collapse them into one "no data" state. **All three are live-relevant today** given the dormant
pipeline.

1. **Route-level `scoped: false`** (`:298-305`) — no resolvable tenant. The page must say "not
   connected", not draw a clear grid. Distinct shape (§1a Shape 1).
2. **Post-level `analysis === null` (or `measured === false`)** — "your tenant has not been read
   against this notice." The constant is served in `provenance.notReadAgainstTenant`
   (`:245-246`, `:488`). This is the **default and, today with 0 interpretations, the universal
   state** — every post shows it. When an interpretation is confirmed but not yet resolved,
   `analysis` is present with `measured: false` (the summary/whoActs/controllable answers are real;
   only the numeric half stays stated-absent).
3. **`dateUnclearCount` / `dateUnclearPosts`** (#1536) — posts with no structural date at all.
   Live count 0, but wired.

The **`provenance`** block (`:482-504`) is the page's honesty spine and must be shown, not skipped:

| Key | What it states | Line |
|---|---|---|
| `source` | "Microsoft 365 Message Center via Graph /admin/serviceAnnouncement/messages" | `483` |
| `impactBasis` | impact is Microsoft's own category/tags, **not** a read of the tenant's config | `484-485` |
| `scoreBasis` | score is Microsoft's prominence + how soon it lands, **not** a per-tenant impact measurement | `486-487` |
| `notReadAgainstTenant` | the stated-absence copy for the count half | `488` |
| `measuredCounts` | the exception: a measured count *was* counted from the tenant's own collected data; a measured zero = touches nothing | `495-496` |
| `advisoryDates` | `advisoryDateText` is Microsoft's own prose, never a computed date, never what placed a post on the grid | `502-503` |

---

## 6. The forbidden list — what the module deliberately does NOT serve

Swept from the route/lib headers themselves and named as forbidden, not merely absent. **The
retired `artifacts/msp-portal/src/components/portal-v2/msChangesData.ts` fixture is NOT a source of
truth** (portal-v2 is retired per CLAUDE.md) — these are the capabilities the *real backend*
declines to provide, so Design must not assume a field exists just because the old prototype drew
it:

- **`plain` — a human "in Shane's words" rewrite.** Always `""` (`portal-message-center.ts:271`).
  There is no write-up source; the lib header (`:16-19`) states paraphrasing Microsoft with a regex
  would be a worse lie than an empty string. The page falls back to Microsoft's own words.
- **Any per-tenant configuration read on the customer page.** `impact`, `score` and the
  per-workload `found` line are Microsoft's published signals only (lib header `:11-35`,
  `impactForPost` `:516-521`, `scoreForPost` `:532-544`, `workloadFound` `:612-619`). No "11
  accounts still using legacy auth" style figure is produced — that is what the *resolution* layer
  counts, and only for a confirmed interpretation, surfaced as `analysis.affectedCount`.
- **`affectedCount` as a guessed zero.** Null unless a probe genuinely measured (`:417`). A zero is
  only ever a *measured* zero.
- **`roadmapId` / roadmap crossover on the customer wire.** The #1531 join exists server-side but is
  **not threaded onto `WirePost`** — it lives only on the admin candidates endpoint (§4). Design
  must not draw a "matching roadmap item" link on the customer page.
- **Any write from surface A.** The route is read-only (`:61-66`); snooze / record-a-decision /
  brief-the-wave write to **change control and hold windows**, not here. The one real customer
  write is the **decline** action, which posts to surface C (`/portal/change-control/:code/decline`)
  and only for an already auto-routed CR.
- **A cloud/GCC toggle on the customer page.** #1537's cloud dimension is admin-authoring-side only
  (§1b). The customer's posts are already tenant-scoped.
- **A per-tenant rollout-ring / phase breakdown.** Graph does not return this; nothing computes it.

**The `portal-pii-governance.ts:32` precedent** (carried forward, still the clearest statement of
what this pack prevents): a prior Design pass invented per-document findings, named sources, matched
patterns, an access matrix and a drift feed for a PII page with no backing — and someone had to
write a whole route explaining why the page *cannot* serve them. That is the failure mode. Every
field above without a real source is named here so it is refused up front, not invented and then
retracted.

---

## 7. Open questions for Design — genuine product decisions, not extraction gaps

The backend is finished; these are the choices code cannot settle and Design owns:

- **#1535 — the timeline's primary visual variable.** Affected-object count vs action-required
  (intake) vs time-to-deadline: "only one can be primary." Now that routing exists, **`intake`
  (informed / approval / advisory) is a real, first-class axis** the timeline can lead with — but
  the choice is still open and this pack does not pre-empt it. Note the data reality: today every
  post is `analysis: null`, so a count-led timeline shows nothing until interpretations are
  authored, whereas a date-led timeline works against the 1159 real dated posts immediately. That
  is a live input to the decision, not the decision itself.
- **The routed-CR customer experience.** #1534 built the machinery (auto-create, intake, decline →
  risk). How the customer *sees* a routed Microsoft change on the Changes page — and how the
  "decline / accept the risk" action (surface C, with its `fullName` + `statement` signature) is
  presented — is a design surface that does not exist yet. It is new ground, not a re-skin.
- **The dormant-data reality.** Because the interpret/resolve/route pipeline currently holds zero
  rows, Design should treat the populated states (analysis, measured counts, routed CRs) as real
  and buildable but **draw the empty states as the primary/first-run experience** — that is what a
  live tenant sees today, and it must read as honest ("not yet read against this notice"), never as
  a broken or blank page.
- **Surface F's wire shape (§1g).** #1688's own architecture pass — settled against a real contract
  pack, per that Feature's own "do not build from it in this state" instruction — decides whether
  the future console list needs its own `WireMspMessageCenterItem` (narrower than the raw row set
  F serves today, and matching A's `analysis`/`workload`/`kind` shaping) or genuinely wants the raw
  columns. This pack does not pre-empt that; it names F's current raw shape as a fact, not a
  recommendation.
