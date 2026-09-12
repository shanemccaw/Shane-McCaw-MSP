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

**Re-verified and refreshed by #3781** (2026-09-12), a full line-by-line re-audit prompted by #2696
landing after #2598 closed. Every citation below was re-checked against the current file; where a
file grew (`portal-message-center.ts` 511→596 lines, `admin-m365-interpretations.ts` →855 lines,
`m365-change-router.ts` →798 lines, `lib/db/src/schema/msp.ts`'s M365/CR enum block moved from the
~2400–4200 range to 3138–5230), line numbers were re-pinned, not assumed carried over. Real drift
found beyond the two deltas #3781 was opened to check:

- **`posts[].routing` (`WireRouting`) is a whole new wire field on surface A** that did not exist
  when this pack was last written — see the new §1a entry below. §7's old "routed-CR customer
  experience... does not exist yet" is now stale on the wire side.
- **Two admin routes are missing from §1b's table**: `POST .../:id/route` (fire an on-demand routing
  run) and `GET .../:id/routings` (#1701 — stored per-tenant routing decisions), both added since.
- **The #2696 fix is a silent default fallback, not a 400.** `limit`/`offset` on surface F now follow
  the exact same pattern `customerId` already used — an invalid value is silently replaced with the
  default (50/0) rather than surfaced as an error of any kind. There is **no 400 response** for a bad
  `limit`/`offset` today; #3781's own premise ("400, not the old 500") was itself already stale by
  the time it was opened. See the corrected §1g.
- **Auth middleware moved from `requireRole` to `requireCapability`** on both A and F (still the same
  effective tiers — see corrected §1a/§1g).

**This is the first contract pack on the project generated from a module whose backend is actually
finished.** The whole interpret → resolve → route pipeline exists on `main`. The one caveat, stated
up front because it changes how Design should read every "measured"/"routed" field below, is a
**data** fact, not a code one, and it has **changed since the last pack**:

> **The pipeline is no longer fully dormant — it has one real, live routed change.** Live-DB counts
> (queried this session against local `DATABASE_URL`, 2026-09-12): `m365_change_interpretations` =
> **1** (status `confirmed`), `m365_change_resolutions` = **9** (1 `measured`, 8 `not_measured`),
> `m365_change_routings` = **9** (1 `auto_created` / reason `auto_created`, 8 `none` / reason
> `not_measured`), and **1** auto-created Change Request exists off that routing row (no
> `declined_risk` yet — `risk_decision_id` is null on every routing row). `msp_message_center_items`
> now holds **1191** rows (`customer_id` never null, `severity` still the single literal `"normal"`
> on every row, `category` distribution `stayInformed` 738 / `planForChange` 414 /
> `preventOrFixIssue` 39), and `m365_roadmap_items` holds **1835**. So today **1 of 1191 posts**
> carries a non-null `analysis`, and its resolution actually measured a non-zero affected count and
> was auto-routed to a real CR — the "your tenant's counted answer" / auto-CR path is no longer a
> theoretical honest-empty case, it has one real, inspectable instance. The other **1190 posts**
> still render the honest-empty state described in §5. Design must draw both the populated and the
> empty states; both are now live-observable, not one real and one hypothetical.

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

Source: `artifacts/api-server/src/routes/portal-message-center.ts:309-594` (**re-pinned by #3781** —
the file grew from 511 to 596 lines; the old `:283-511` citation is stale). Customer-scoped:
`requireCapability("ladder.customer-user")` (`:311`) — **moved off `requireRole("CustomerUser")`
since the last pack**, same effective floor (paying customers + MSP staff, Free tier excluded, per
the route's own header at `:51-59`) but a capability string now, not a role literal; also gated by
`requireTierFeature(PORTAL_TIER_MODULE_KEYS.messageCenter)` (`:314`, #1168) — a customer without the
Monitoring tier bundle never reaches the handler at all. The customer is `resolveCustomerId(req)` off
the JWT (`:316`), never a request param — the route header (`:8-66`) explains at length why there is
deliberately no `customerId` input to accept. Read-only (`:61-65`).

**Two distinct top-level shapes** are returned, and Design must not assume the fuller one.

**Shape 1 — `scoped: false`** (`:327-334`), when the account has no resolvable tenant row:

```
{ scoped: false, itemCount: 0, posts: [], density: [], buckets, stats: [], workloads: [],
  dateUnclearCount: 0, dateUnclearPosts: [] }
```

Note `buckets` **is** still computed and returned even here (the axis is a function of the clock,
not the tenant), so the page can render the empty grid honestly. `waveShort`, `onAxisCount`,
`postsTruncated`, `lastSyncedAt`, `scanAt` and `provenance` are **absent** in this branch — Design
must treat them as optional and not read them when `scoped` is false.

**Shape 2 — `scoped: true`** (`:538-588`, re-pinned), the full payload:

| Field | Type | Nullability | Line |
|---|---|---|---|
| `scoped` | `true` | — | `539` |
| `itemCount` | `number` (whole corpus, incl. past rollouts) | never null | `541` |
| `onAxisCount` | `number` (subset inside the 11-bucket forward axis) | never null | `543` |
| `postsTruncated` | `boolean` (per-wave cap applied, see §"POSTS_PER_WAVE") | never null | `544` |
| `lastSyncedAt` | `string \| null` (ISO) | null when no rows | `545` |
| `scanAt` | `string \| null` ("21 August, 00:45") | null when no rows | `546` |
| `buckets` | `Bucket[]` (11 entries, §1e) | never null | `547` |
| `waveShort` | `Record<string,string>` (band → short label) | never null | `548` |
| `posts` | `(WirePost & { analysis, routing })[]` | never null, may be `[]` | `549` |
| `density` | `DensityRow[]` | never null, may be `[]` | `550` |
| `stats` | `StatDef[]` (6 fixed cards) | never null | `551` |
| `workloads` | `{ wl, name, found }[]` | never null | `552` |
| `dateUnclearCount` | `number` (#1536, whole corpus) | never null | `559` |
| `dateUnclearPosts` | `WireDateUnclearPost[]` (#1536, capped) | never null, may be `[]` | `560` |
| `provenance` | object, §5 | never null | `565-587` |

**`WirePost`** (`portal-message-center.ts:141-173`, `toWirePost` at `:274-307`, re-pinned) — one
entry per post that landed on the dated axis, capped per wave:

| Field | Type | Nullability | Line |
|---|---|---|---|
| `id` | `string` (= `graphMessageId`) | never null | `142`, `280` |
| `title` | `string` | never null | `143`, `281` |
| `wl` | `string` (workload key, §3) | never null | `144`, `282` |
| `workload` | `string` (readable) | never null | `145`, `283` |
| `kind` | `string` (readable kind label, §3) | never null | `146`, `284` |
| `hard` | `boolean` (true iff kind === `"b"`) | never null | `147`, `285` |
| `month` | `number` (calendar-month offset from now, ≥0) | never null | `148`, `287` |
| `when` | `string` ("1 October 2026") | never null | `149`, `288` |
| `countdown` | `string` ("in 6 weeks" / "today" / "2 weeks ago") | never null | `150`, `289` |
| `score` | `number` 0–100 | never null | `151`, `290` |
| `impact` | `string` ("Hits you" / "Might hit you" / "No impact") | never null | `152`, `291` |
| `bucket` | `number` (index into `buckets`, always ≥0 in a served post) | never null | `153`, `292` |
| `ms` | `string` (Microsoft's body, HTML flattened) | never null, may be `""` | `154`, `293` |
| `plain` | `string` | **always `""`** — §6 | `155`, `297` |
| `msSays` | `string` (first line of `ms`) | never null, may be `""` | `156`, `298` |
| `services` | `string[]` (Microsoft's own) | never null, may be `[]` | `157`, `299` |
| `tags` | `string[]` (Microsoft's own) | never null, may be `[]` | `158`, `300` |
| `publishedAt` | `string` (ISO; `startDateTime ?? lastModifiedDateTime`) | never null | `159`, `301` |
| `lastModifiedAt` | `string` (ISO) | never null | `160`, `302` |
| `actionRequiredBy` | `string \| null` (ISO) | **often null** — §"date quality" | `161`, `303` |
| `advisoryDateText` | `string \| null` (**#1536**; Microsoft's own prose, never a Date) | null when none found | `170`, `304` |
| `dateConfidence` | `"dated"` (literal — a post only reaches `posts[]` once it has a structural date) | never null | `172`, `305` |
| `analysis` | `WireAnalysis \| null` | null whenever no confirmed interpretation exists — **1 of 1191 live posts** carries a non-null value today (§ pipeline note above) | `508` |
| `routing` | `WireRouting \| null` (**new since the last pack** — §1a-routing below) | null whenever no routing decision (incl. `decision === "none"`) was taken for this post/customer | `510` |

**`WireDateUnclearPost`** (**#1536**, `portal-message-center.ts:184-196`, `toWireDateUnclearPost`
at `:198-214`, re-pinned) — a deliberately **smaller, distinct shape** for a post with no structural
date at all. It has **no** `bucket`/`when`/`countdown`/`score`/`impact`, because computing any of
those would mean falling back to `lastModifiedDateTime` (an edit timestamp) and presenting it as a
landing date — the exact failure this bucket exists to avoid:

| Field | Type | Line |
|---|---|---|
| `id` | `string` | `185`, `202` |
| `title` | `string` | `186`, `203` |
| `wl` | `string` | `187`, `204` |
| `workload` | `string` | `188`, `205` |
| `kind` | `string` | `189`, `206` |
| `ms` | `string` | `190`, `207` |
| `services` | `string[]` | `191`, `208` |
| `tags` | `string[]` | `192`, `209` |
| `lastUpdated` | `string` ("1 October 2026"; honestly labelled as the last-modified date, **not** a landing date) | `193`, `210` |
| `advisoryDateText` | `string \| null` | `194`, `211` |
| `dateConfidence` | `"unclear"` (literal) | `195`, `212` |

> **Live: `dateUnclearCount` is still 0** (re-verified by #3781 against local `DATABASE_URL`,
> 2026-09-12). Every one of the 1191 real posts carries at least an `endDateTime`. This surface is
> defensive-but-real architecture, not presently load-bearing — but it is wired and honest, so
> Design should render it, styled for the rare/zero case.

**`WireAnalysis`** (`portal-message-center.ts:227-238`, built at `:440-452`, re-pinned) — the
tenant's own reading: the #1532 interpretation (WHAT the change is) plus, where the #1533 resolution
layer actually counted this tenant's estate, the NUMBER. **Re-confirmed accurate by #3781** — the
shape is unchanged since #2598, only line numbers moved (the routing block, §1a-routing, was added
directly below this join in the route handler):

| Field | Type | Nullability | Line |
|---|---|---|---|
| `summary` | `string \| null` | interpretation summary | `228`, `441` |
| `changeClass` | `string` (real enum, §3) | never null when `analysis` present | `229`, `442` |
| `whoActs` | `string` (`"microsoft"` \| `"admin"`) | never null | `230`, `443` |
| `controllable` | `string` (`"yes"` \| `"no"` \| `"unknown"`) | never null | `231`, `444` |
| `controlMethod` | `string \| null` | null unless a control exists | `232`, `445` |
| `measured` | `boolean` | true iff resolution `status === "measured"` **and** `affectedCount !== null` | `233`, `439`, `446` |
| `affectedCount` | `number \| null` | **null unless `measured`** — never a guessed zero | `234`, `447` |
| `measuredAt` | `string \| null` (ISO) | null unless `measured` | `235`, `448` |
| `basis` | `string \| null` (`"monitor_check"` \| `"license_snapshot"`) | null unless `measured` | `236`, `449` |
| `noise` | `boolean` | true iff `measured && affectedCount === 0` — a counted zero, the suppression signal (§4) | `237`, `450` |

The analysis join (`:407-434`) is **confirmed interpretations only** (`eq(status,"confirmed")`,
`:431`) — a proposed (AI, unverified) reading never reaches a customer. **Live today** (§ pipeline
note above): exactly one row exists in this join (the one confirmed interpretation), it resolved
`measured: true` with a non-zero `affectedCount`, and it is the same post carrying the live
`routing.decision === "auto_created"` below — the analysis and routing halves of this pack's one
real example are the same post.

**`WireRouting`** (`portal-message-center.ts:264-272`, joined at `:459-483`, built into the map at
`:485-496`) — **new since the #2598 pack; not previously documented at all.** What the routing
engine (#1534, surface D) decided this post BECOMES for this customer — the missing link the wire
had no field for until this build landed. Attached to each served post as `posts[].routing` at
`:509-510`, alongside `analysis`:

| Field | Type | Nullability | Line |
|---|---|---|---|
| `decision` | `string` (real enum, §3 `M365_ROUTING_DECISIONS` minus `"none"`) | never `"none"` — rows with `decision === "none"` are filtered out before reaching the map (`:487`) | `265`, `489` |
| `reason` | `string` (real enum, §3 `M365_ROUTING_REASONS`) | never null | `266`, `490` |
| `intake` | `string \| null` (§3 `CHANGE_REQUEST_INTAKES`) | null iff the routing row itself has no intake stored | `267`, `491` |
| `changeRequestCode` | `string \| null` (`formatChangeRequestCode(crId)`, e.g. `CR-2026-101`) | null unless a real CR row resolved through the join — the FK is intentionally soft (`:466-471`), so a dangling `changeRequestId` formats no code rather than a code for a CR that no longer exists | `268`, `492` |
| `changeRequestStatus` | `string \| null` (a live `msp_change_requests.status`) | null under the same condition as `changeRequestCode` | `269`, `493` |
| `declined` | `boolean` | true once a customer or MSP decline turned this into an accepted risk (#1514) — `riskDecisionId !== null \|\| decision === "declined_risk" \|\| crStatus === "rejected"` | `271`, `494` |

The routing join (`:459-483`) is scoped by `(mspId, customerId)`, the same pair the analysis join
uses, left-joined to `mspChangeRequestsTable` for the real CR code/status. **Live today:** one
routing row reaches the wire (`decision: "auto_created"`, `reason: "auto_created"`), backed by a
real CR with a real code; the other 8 stored routing rows are `decision: "none"` and are correctly
filtered out before the customer ever sees them — a customer's `posts[]` today shows `routing: null`
on 1190 of 1191 posts and a real, populated object on exactly one.

### 1b. AdminV2 interpretation + resolution routes (B)

Source: `artifacts/api-server/src/routes/admin-m365-interpretations.ts`. `requireAdmin`-gated,
never customer-reachable; the MSP is resolved server-side (`resolveDefaultMspId`, `:68-79`), never
from the body. **Not part of the customer page** — included because it is where interpretations are
authored and where cloud filtering (#1537) actually lives.

**Re-pinned and extended by #3781** — the file grew from ~638 to 855 lines; the table below adds the
two routes that were genuinely missing from every prior version of this pack (`.../:id/route` and
`.../:id/routings`), not just moved line numbers:

| Route | Method | Purpose | Line |
|---|---|---|---|
| `/admin/m365/interpretations` | GET | library + status counts | `131` |
| `/admin/m365/interpretations/candidates` | GET | roadmap/MC sources with no interpretation yet | `168` |
| `/admin/m365/interpretations/propose` | POST | AI proposes (unsaved) | `294` |
| `/admin/m365/interpretations` | POST | create (default `status: "proposed"`) | `397` |
| `/admin/m365/interpretations/:id` | PATCH | edit | `465` |
| `/admin/m365/interpretations/:id/confirm` | POST | → `status: "confirmed"` | `517` |
| `/admin/m365/interpretations/:id/reject` | POST | → `status: "rejected"` | `522` |
| `/admin/m365/interpretations/:id` | DELETE | remove | `563` |
| `/admin/m365/interpretations/:id/resolve` | POST | run count now across tenants (confirmed-only) | `600` |
| `/admin/m365/interpretations/:id/resolutions` | GET | stored per-tenant answers | `658` |
| `/admin/m365/interpretations/:id/route` | POST | **new, not in prior pack** — fires an on-demand routing run for one confirmed interpretation (404 if not found, 409 if not `confirmed`, 503 if the `m365_route_changes` Workflow definition isn't seeded or the fire itself is rejected); `202 { interpretationId, runId, status: "queued" }` on success | `729` |
| `/admin/m365/interpretations/:id/routings` | GET | **new, not in prior pack** — #1701; stored per-tenant routing decisions for one interpretation, same read shape as `.../resolutions`, left-joined to `tenants` for a display name and to the real CR for `changeRequestCode`/status; populated by both the nightly sweep and the on-demand `/route` trigger above | `791` |

**`toWire(interpretation)`** (`admin-m365-interpretations.ts:102-124`, re-pinned): `id`, `mspId`,
`featureId` (`string \| null`), `graphMessageId` (`string \| null`), `sourceKind` (`"roadmap"` \|
`"message_center"` \| `"manual"`), `title`, `summary`, `changeClass`, `touches` (§3), `whoActs`,
`controllable`, `controlMethod`, `probe` (§3), `status`, `proposedBy` (`"ai"` \| `"human"`),
`aiModel`, `aiRationale`, `confirmedBy`, `confirmedAt`, `notes`, `createdBy`, `createdAt`,
`updatedAt`.

**`GET .../candidates`** (`:168-283`, re-pinned) — **this is where #1537's cloud dimension is a real
wire control.** Response (`:278`): `{ roadmap: RoadmapCandidate[], messageCenter: MCCandidate[],
cloudMode }`, plus `noMsp: true` when no MSP resolves (`:173`).

- `cloudMode` echoes the applied filter, parsed from **`?cloud=worldwide|gov|all`**
  (`parseCloudInstanceFilterMode(req.query.cloud)`, `:170`) — an unrecognized value degrades to
  `"worldwide"` (the platform default), never 500s.
- Each `RoadmapCandidate` (built inline, `:212-219`) carries `featureId`, `title`, `status`,
  `products`, **`cloudInstances: string[]`** (`:217` — Microsoft's own real tags, an array of the
  four §3 strings), `msModified`, and `crossedOver: boolean` (the #1531 join via
  `withCrossoverFlag`, `:206-221` — has this roadmap item landed in any tenant's Message Center feed
  yet).
- The cloud filter is applied **before** the 200-row cap (`:206-211`), so a gov-heavy result page
  cannot crowd out worldwide items in `"worldwide"` mode (or vice versa in `"gov"`).
- Each `MCCandidate` (built inline, `:266-274`) carries `graphMessageId`, `title`, `category`,
  `isMajorChange`, `services`, `roadmapFeatureIds: string[]` (`[]` when the #1531 column isn't
  present yet — the `hasRoadmapFeatureIdsColumn()` gate, `:229`, never throws), `lastModifiedDateTime`.

> **The customer page (A) does NOT expose `cloudInstances` or `cloudMode`.** #1537's filtering is
> an **admin-authoring-side** dimension today, applied when Shane picks what to interpret. Design
> must not draw a GCC/gov cloud toggle on the *customer* Microsoft Changes page — no such control
> exists on surface A, and the customer-facing posts are already tenant-scoped by Microsoft.

### 1c. `POST /api/portal/change-control/:code/decline` — the decline action (C)

Source: `artifacts/api-server/src/routes/portal-change-control.ts:960-1035` (**re-pinned by
#3781** — this route lives 400+ lines further into the file than the last pack cited; the file
itself grew to 1526 lines). `requireCapability("ladder.customer-user")` +
`requireAddOnEntitlement(CHANGE_CONTROL_FEATURE_KEY)` (`:962-963`) — same `requireCapability` move
as A/F, same effective floor. This is the one write the Microsoft Changes experience triggers, and
it lands on **Change Control**, not on this module.

- `:code` is a CR code like `CR-2026-101`, parsed to the numeric id (`parseChangeRequestCode`,
  `:953-957`).
- Body (`declineSchema`, `:947-950`): `{ fullName: string(1..200), statement: string(1..2000) }`.
- Guards: the CR must belong to the caller's own resolved `(mspId, tenantId)` (`:988-1002`) **and**
  have `sourceKind === "microsoft_change"` (`:1003-1006`) — **only an auto-routed Microsoft change
  can be declined here**; a wizard-raised CR is a 409.
- On success: `201` (or `200` if already rejected), body `{ code, declined: true, riskAccepted:
  boolean }` (`:1020-1024`). The write itself is `declineRoutedChangeToRisk` (surface D) — a
  customer decline drives the CR to terminal `rejected` **and** creates an accepted-risk record
  (#1514). **Re-confirmed accurate by #3781** — logic and status codes unchanged since #2598, only
  line numbers moved.

### 1d. The routing engine (D) — `m365-change-router.ts` (no HTTP surface)

The third pipeline stage, after interpretation (#1532) and resolution (#1533). It decides what a
resolved change **becomes** and records it durably. Wired as the `m365_route_changes` Workflow
Engine node, seeded "__system__: M365 Changes Routing", run daily **after** the resolution sweep —
and, **new since the last pack**, also triggerable on-demand for one interpretation via
`POST /admin/m365/interpretations/:id/route` (§1b). See §2 (the gate) — this is the module's single
most important behaviour for Design to understand, because it is what turns a Message Center post
into a Change Request the customer can decline — **and, live today, is the mechanism behind the one
real routed CR and the `posts[].routing` field described in §1a.**

Key exports (**re-pinned by #3781** — the file grew from 638 to 798 lines): `decideRouting`
(`:142-159`, the pure gate), `deriveIntake` (`:89-95`, unchanged), `deriveImplementer` (`:103-107`,
unchanged), `changeClassForIntake` (`:116-118`, unchanged), `createRoutedChangeRequest`
(`:223-332`), `routeResolution` (`:459-538` approx.), `runM365ChangeRoutingSweep` (`:566-620`
approx.), `declineRoutedChangeToRisk` (`:656-711` approx.). Also now has a real caller beyond the
nightly sweep: `admin-m365-interpretations.ts`'s new `POST .../:id/route` (§1b) fires
`fireWorkflowForDefinition` against the same `m365_route_changes` seeded Workflow definition
on-demand, for one interpretation.

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

Source: `artifacts/api-server/src/routes/msp-message-center.ts:24-57`, 59 lines total, one route
(**re-pinned by #3781** — grew 2 lines since #2598 as part of the #2696 fix; route content
re-verified line by line, not assumed unchanged). Own header (`:1-11`) states it plainly:
**read-only** view of the same rows surface A/E write, for the operator side, not the customer side.
`requireCapability("ladder.msp-operator")` (`:24`) — **moved off `requireRole("MSPOperator")` since
the last pack.** Same effective tier admitted (`MSPOperator`/`MSPAdmin`/`PlatformAdmin` and legacy
`role: "admin"`), now expressed as a capability string against the ladder rather than a role
literal — see the capability-model header at `requireAuth.ts:244-301` (`requireCapability`) for how
the mapping is resolved; scope is the caller's own `mspId` via `resolveMspIdStrict(req)` (`:26`,
`resolve-msp-id.ts:76-77`, `req.user?.mspId ?? null`) — **403 `{ error: "MSP context required" }`**
(`:27-30`) if the caller has no `mspId` claim (e.g. a legacy PlatformAdmin with none set).

**Query parameters** (`:32-38`, re-pinned), all optional:

| Param | Type | Behavior | Line |
|---|---|---|---|
| `category` | string | exact match against `category` (§3 enum) | `32`, `41` |
| `customerId` | number | exact match against `customerId`; a non-numeric value is silently dropped (checked with `!isNaN`, not surfaced as a 400) | `33-34`, `42` |
| `limit` | number | `Math.min(!isNaN(limitParam) ? limitParam : 50, 200)` — default 50, hard cap 200 | `35-36` |
| `offset` | number | `Math.max(!isNaN(offsetParam) ? offsetParam : 0, 0)` — default 0, floor 0 | `37-38` |

**Corrected finding (#3781): the #2696 fix is a silent default fallback, not a 400 response, and
this pack's own opening premise ("document the fixed 400 shape") was already stale by the time the
issue was opened.** #2696 made `limit`/`offset` follow the **exact same pattern `customerId` already
used two lines above** — an `isNaN` check that substitutes the default value (50/0) rather than
letting `NaN` reach Postgres. There is **no error response of any kind** for an invalid `limit`/
`offset` today: `?limit=abc` silently serves the default 50, `?offset=xyz` silently serves 0, same
as an unparseable `customerId` silently dropping its filter. The only way this route now emits a
non-200 for query-param reasons at all is the pre-existing `?mspId`-less 403 (`:27-30`) — there is
no 400 path on this route, before or after #2696. Design/any future console client should not expect
a 400 for a malformed `limit`/`offset`; it should expect the request to silently succeed against
defaults.

**Response shape** (`:52`): `{ items, limit, offset }`. `items` is the **raw Drizzle row set** —
every `mspMessageCenterItemsTable` column (`lib/db/src/schema/msp.ts:2963-3005`, re-pinned — the old
`:2634-2678` citation is stale; the schema file's line numbers moved substantially between packs,
see §3's note below), unfiltered and unshaped. Unlike surface A's `toWirePost` (§1a), **F has no
wire-shaping function** — there is no narrower `WireMspMessageCenterItem` type, no `analysis`, no
`routing`, no `provenance`, no bucket/density/stat computation. This is a real, current design gap,
not a citation gap: today F serves exactly what the sync writer (E) wrote, nothing derived.
`limit`/`offset` are echoed back verbatim, not the actual row count returned or a total-matching
count — a caller cannot tell from the response alone whether more rows exist past the page (no
`hasMore`/`total`).

Ordered `desc(lastModifiedDateTime)` (`:48`) — newest-first, matching A's own axis.

**Live data** (re-queried this session, 2026-09-12, against local `DATABASE_URL`): **1191** rows
(up from 1157 at #2598), one `mspId` (the only MSP in local dev), `customerId` **never** null on any
row, `severity` is still the single literal `"normal"` on every row (Graph has not sent a differing
value locally), `category` distribution `stayInformed` 738 / `planForChange` 414 /
`preventOrFixIssue` 39 — the same three-value enum as surface A (§3), row counts moved but the shape
of the distribution is unchanged.

**Orphaned today.** No route in `artifacts/msp-console` (or anywhere else) calls
`GET /api/msp/message-center` — `artifacts/msp-console` does not exist yet; #1688 (the Feature this
route exists for) is explicitly blocked on the console scaffold, #1680. This pack documents F as a
live, correctly-scoped, working endpoint with **zero UI consumers**, not as dead code to remove.

**#2696 — CLOSED, verified fixed by #3781.** The prior pack's "known defect" entry (non-NaN-guarded
`limit`/`offset` producing a generic 500 on `LIMIT NaN`) is fixed on `main` — confirmed directly
against the current file (`:35-38`, quoted above) and against `build-journal/2696.md`'s own DONE
record (commit `4b839cd4`, merged `ef46ada2`). No live defect remains on this parameter pair.

---

## 2. The routing gate — as built (#1534)

This is the heart of the finished module and had no equivalent in the old pack. `decideRouting`
(`m365-change-router.ts:142-159`, re-pinned; **the condition-level line citations below are
unchanged and re-verified correct**) is a pure function over four inputs
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
| a routed CR the customer later declines | `declined_risk` | (carried) | Becomes an accepted risk (#1514) — a *later* transition, never produced by the sweep (`:130-132`, `declineRoutedChangeToRisk` re-pinned `:656-711`) |

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
schema note at `msp.ts:4890-4895`, re-pinned) guarantees a CR is created at most once. Terminal customer
states (`auto_created` with a CR, or `declined_risk`) are never rewound by a later sweep
(`:426-431`).

**Decline → risk** (`declineRoutedChangeToRisk`, re-pinned `:656-711`): a **customer** decline drives
the CR to `rejected` and creates an accepted-risk record (`msp_risk_decisions`) back-linked via
`spawnedByChangeRequestId` (`msp.ts:6540`, re-pinned — the old `:4187` citation is far stale) — the
rejection *is* the risk acceptance (#1514). An **MSP** decline produces **no** risk record.
Idempotent.

---

## 3. Real enum unions only

All verbatim from `lib/db/src/schema/msp.ts`, cited to line. **Design must not invent a status
vocabulary outside these lists. All line numbers below re-pinned by #3781 — the schema file's
enum block moved from the ~2400–4200 range to ~3100–5300 as the file grew; values themselves are
unchanged.**

```ts
// msp.ts:3138-3144 — the interpretation's ITIL-ish class
M365_CHANGE_CLASSES = ["retirement", "default_flip", "new_feature", "breaking_change", "licensing"]

// msp.ts:3147
M365_INTERPRETATION_STATUSES = ["proposed", "confirmed", "rejected"]

// msp.ts:3151 — who must act for the change to take effect
M365_ACTORS = ["microsoft", "admin"]

// msp.ts:3155 — can it be turned off; "unknown" is the honest default, never omitted
M365_CONTROLLABILITY = ["yes", "no", "unknown"]

// msp.ts:3252 — resolution outcome
M365_RESOLUTION_STATUSES = ["measured", "not_measured", "error"]

// msp.ts:3256 — which probe infra produced a measured number
M365_RESOLUTION_BASES = ["monitor_check", "license_snapshot"]

// msp.ts:3265-3277 — why a resolution is not_measured (structured, not vague)
M365_NOT_MEASURED_REASONS = ["no_probe","check_not_found","no_stored_profile","sku_not_mapped",
                             "no_sku_data","license_gap","consent_revoked","requires_script"]

// ── The routing layer (#1534) ──
// msp.ts:3353 — what a resolved change becomes
M365_ROUTING_DECISIONS = ["auto_created", "proposed", "declined_risk", "none"]

// msp.ts:3357-3364 — why it was proposed/skipped rather than auto-created
M365_ROUTING_REASONS = ["auto_created", "undated", "zero_affected", "not_measured", "no_announcement"]

// msp.ts:4623 — the intake axis on a routed CR ("do I have to act")
CHANGE_REQUEST_INTAKES = ["informed", "approval", "advisory"]

// msp.ts:4635 — who executes a routed change
CHANGE_REQUEST_IMPLEMENTERS = ["microsoft", "customer", "msp"]

// msp.ts:4639 — what spawned a CR; only microsoft_change is written; NULL = raised directly
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

**Cloud instance vocabulary** (#1537) — **real strings only, re-verified live by #3781, 2026-09-12.**
The entire `m365_roadmap_items.cloud_instances` corpus (1835 items, 0 unclassified — up from 1795 at
#2598) still contains exactly four distinct atomic values: **"Worldwide (Standard Multi-Tenant)"**
(1640), **"GCC"** (529), **"GCC High"** (454), **"DoD"** (411) — items commonly carry more than one
tag, so these are per-tag counts across the jsonb array, not mutually exclusive item counts. The
classifier does not enumerate these — it substring-matches the
gov family (`/\bGCC\b|\bDoD\b/i`, `m365-cloud-instance.ts:43`) so a new Microsoft tag degrades
sanely. Filter modes (`CloudInstanceFilterMode`, `:70`): `"worldwide"` (default; keeps everything
except gov-only items, and keeps unclassified), `"gov"` (GCC/GCC-High/DoD only; drops
unclassified), `"all"` (unfiltered).

**Roadmap item `status`** (`m365_roadmap_items.status`) — **free text from Microsoft**, not a closed
enum: "In development" / "Rolling out" / "Launched" is Microsoft's own `publicRoadmapStatus` kept
verbatim. Do not build a fixed-union status pill without a fallback for an unrecognized value.

**`M365Touches`** (`msp.ts:3165`, re-pinned) and **`M365Probe`** — structured objects, not enums:
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
- **Interpretation → MC post**, on `graphMessageId` (`portal-message-center.ts:407-434`, re-pinned)
  — produces `posts[].analysis`. **Confirmed only** (`:431`).
- **Interpretation → Resolution**, on `interpretationId` + `customerId` (`:421-427`, re-pinned, left
  join) — one current resolution per pair, overwritten on re-measure.
- **Resolution → Routing** (D), on the same pair — the count is what trips the gate.
- **Routing → Change Control**, via `msp_change_requests.source*` columns (`msp.ts:4823-4840`
  approx., re-pinned): `intake`, `implementer`, `sourceKind = "microsoft_change"`,
  `sourceGraphMessageId`, `sourceInterpretationId`, `sourceResolutionId`. **All nullable** — every
  pre-routing CR leaves them null, and null reads as "raised directly, MSP implements". This is the
  link the customer's **decline** action (C) walks back — and, live today, the one real routed CR
  has these populated. **New since the last pack: this is also the exact join `posts[].routing`
  (§1a) exposes on the customer wire itself**, not just admin-side.
- **Routing → Risk Register**, via `msp_risk_decisions.spawnedByChangeRequestId` (`msp.ts:6540`,
  re-pinned) — a declined routed CR becomes an accepted risk (#1514). **Live today: 0** — the one
  real routing row is `auto_created`, not yet declined.
- **`noise: true`** (`portal-message-center.ts:450`, re-pinned) — a **measured** zero, the
  suppression signal. Any "hide noise" affordance keys off this, **not** `analysis === null` or
  `measured === false` (which mean "not counted" — a different fact from "counted and irrelevant").

---

## 5. The honest-empty contract per surface

The module has honest-empty mechanisms at three layers; Design must render them distinctly, not
collapse them into one "no data" state. **All three remain live-relevant today**, though the
pipeline is no longer fully dormant (§ opening note) — 1190 of 1191 posts still render state 2 below.

1. **Route-level `scoped: false`** (`:327-334`, re-pinned) — no resolvable tenant. The page must say
   "not connected", not draw a clear grid. Distinct shape (§1a Shape 1).
2. **Post-level `analysis === null` (or `measured === false`)** — "your tenant has not been read
   against this notice." The constant is served in `provenance.notReadAgainstTenant`
   (`:249-250`, `:571`, re-pinned). This is the default state and, live today, covers **1190 of 1191**
   posts — one post now carries a real, measured, non-null `analysis`. When an interpretation is
   confirmed but not yet resolved, `analysis` is present with `measured: false` (the
   summary/whoActs/controllable answers are real; only the numeric half stays stated-absent).
3. **`dateUnclearCount` / `dateUnclearPosts`** (#1536) — posts with no structural date at all.
   Live count 0, but wired.

The **`provenance`** block (`:565-587`, re-pinned) is the page's honesty spine and must be shown, not
skipped:

| Key | What it states | Line |
|---|---|---|
| `source` | "Microsoft 365 Message Center via Graph /admin/serviceAnnouncement/messages" | `566` |
| `impactBasis` | impact is Microsoft's own category/tags, **not** a read of the tenant's config | `567-568` |
| `scoreBasis` | score is Microsoft's prominence + how soon it lands, **not** a per-tenant impact measurement | `569-570` |
| `notReadAgainstTenant` | the stated-absence copy for the count half | `571` |
| `measuredCounts` | the exception: a measured count *was* counted from the tenant's own collected data; a measured zero = touches nothing | `578-579` |
| `advisoryDates` | `advisoryDateText` is Microsoft's own prose, never a computed date, never what placed a post on the grid | `585-586` |

---

## 6. The forbidden list — what the module deliberately does NOT serve

Swept from the route/lib headers themselves and named as forbidden, not merely absent. **The
retired `artifacts/portal/src/components/portal-v2/msChangesData.ts` fixture is NOT a source of
truth** (portal-v2 is retired per CLAUDE.md; this file was NOT carried over — retired in `f40438cdc`'s
#1485 portal-v2 rebuild, and does not exist anywhere in `artifacts/portal`) — these are the capabilities the *real backend*
declines to provide, so Design must not assume a field exists just because the old prototype drew
it:

- **`plain` — a human "in Shane's words" rewrite.** Always `""` (`portal-message-center.ts:297`,
  re-pinned). There is no write-up source; the lib header (`:16-19`) states paraphrasing Microsoft
  with a regex would be a worse lie than an empty string. The page falls back to Microsoft's own
  words.
- **Any per-tenant configuration read on the customer page.** `impact`, `score` and the
  per-workload `found` line are Microsoft's published signals only (lib header `:11-35`,
  `impactForPost` `:516-521`, `scoreForPost` `:532-544`, `workloadFound` `:612-619`). No "11
  accounts still using legacy auth" style figure is produced — that is what the *resolution* layer
  counts, and only for a confirmed interpretation, surfaced as `analysis.affectedCount`.
- **`affectedCount` as a guessed zero.** Null unless a probe genuinely measured (`:447`, re-pinned).
  A zero is only ever a *measured* zero.
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
  the choice is still open and this pack does not pre-empt it. Note the data reality: **almost**
  every post is still `analysis: null` (1190 of 1191, live-queried), so a count-led timeline shows
  almost nothing until more interpretations are authored, whereas a date-led timeline works against
  the ~1191 real dated posts immediately. That remains the live input to the decision.
- **The routed-CR customer experience — corrected by #3781: the wire field now exists.** §1a's
  `posts[].routing` (`WireRouting`) shipped since the last pack — the decision/reason/intake/CR
  code+status/`declined` fields the routing engine produces are already on the customer wire, and
  one real post carries a populated, non-null `routing` object today. **What is still a genuinely
  open design surface**: how the customer *sees* this on the Changes page UI, and how the
  "decline / accept the risk" action (surface C, with its `fullName` + `statement` signature) is
  presented — the wire contract exists, the screen does not. This is new ground for Design, not a
  re-skin, but it is no longer blocked on a missing backend field.
- **The data reality has moved past fully dormant.** The interpret/resolve/route pipeline now holds
  1 confirmed interpretation, 9 resolutions and 9 routings (1 `auto_created`) rather than zero rows
  of each. Design should still **draw the empty state as the overwhelmingly common experience**
  (1190 of 1191 posts) but can now also draw the populated states — analysis, measured count, routed
  CR, decline flow — against one real, inspectable live example rather than a purely hypothetical
  one. Both states must read as honest, neither as broken or blank.
- **Surface F's wire shape (§1g).** #1688's own architecture pass — settled against a real contract
  pack, per that Feature's own "do not build from it in this state" instruction — decides whether
  the future console list needs its own `WireMspMessageCenterItem` (narrower than the raw row set
  F serves today, and matching A's `analysis`/`workload`/`kind` shaping) or genuinely wants the raw
  columns. This pack does not pre-empt that; it names F's current raw shape as a fact, not a
  recommendation.
