# Microsoft Changes — contract extraction pack

**For Claude Design. Extracted, not authored — every claim below is cited to file:line.**
Produced per #1577's method (contract pack = step 3 of #1578's five-step sequence), scoped to
this module only, as corrected on #1577's own comment. Read-only build: no product code, no
schema changes, no UI were touched to produce this document.

Module: **Microsoft Changes** (#1494, epic #1485). Schema + honest read (steps 1-2) shipped as
#1530 (roadmap ingestion), #1532 (interpretation layer), #1533 (resolution layer), #1531
(roadmap↔Message Center join) — all four merged to `main` and their manual migrations run by
Shane. This pack is step 3: the requirements document Design draws against next.

---

## 1. Per-surface wire contract

Three live HTTP surfaces make up this module. Each field below is copied verbatim from the
route's own response-shaping code, cited to file:line.

### 1a. `GET /api/portal/message-center` — the customer-facing surface

Source: `artifacts/api-server/src/routes/portal-message-center.ts:227-422`. Customer-scoped
(`requireRole("CustomerUser")`, `resolveCustomerId(req)` off the JWT only — no `customerId`
param exists on this route to accept, `portal-message-center.ts:22-26`). Read-only: no writes of
any kind (`portal-message-center.ts:61-65`).

**Top-level response shape**, `portal-message-center.ts:381-416`:

| Field | Type | Nullability | Line |
|---|---|---|---|
| `scoped` | `boolean` | never null | `247`, `382` |
| `itemCount` | `number` | never null — 0 when `scoped:false` | `247`, `384` |
| `onAxisCount` | `number` | never null | `386` |
| `postsTruncated` | `boolean` | never null | `387` |
| `lastSyncedAt` | `string \| null` (ISO) | null when no rows | `388` |
| `scanAt` | `string \| null` | null when no rows | `389` |
| `buckets` | `Bucket[]` (11 entries, see §1a-buckets) | never null | `390` |
| `waveShort` | `Record<string,string>` | never null | `391` |
| `posts` | `WirePost[]` (each carrying `analysis`, see below) | never null, may be `[]` | `392` |
| `density` | `DensityRow[]` | never null, may be `[]` | `393` |
| `stats` | `StatDef[]` (6 entries) | never null | `394` |
| `workloads` | `{wl,name,found}[]` | never null | `395` |
| `provenance` | object, see §4 | never null | `400-415` |

When `scoped:false` (`portal-message-center.ts:242-249`, no resolvable tenant row): every array
field is `[]`, `itemCount:0`, and `buckets`/`waveShort` are still computed (the axis is a
function of the clock, not the tenant) so the page can render the empty grid honestly rather
than a blank screen.

**`WirePost`** (`portal-message-center.ts:135-156`, one entry per post, capped per wave — see
§6 "POSTS_PER_WAVE" note below):

| Field | Type | Nullability | Line |
|---|---|---|---|
| `id` | `string` (= `graphMessageId`) | never null | `136`, `200` |
| `title` | `string` | never null | `137`, `201` |
| `wl` | `string` (workload key) | never null | `138`, `202` |
| `workload` | `string` (readable) | never null | `139`, `203` |
| `kind` | `string` (readable kind label) | never null | `140`, `204` |
| `hard` | `boolean` (true iff kind === "b", "breaks something") | never null | `141`, `205` |
| `month` | `number` (calendar-month offset from now) | never null | `142`, `207` |
| `when` | `string` ("1 October 2026") | never null | `143`, `208` |
| `countdown` | `string` ("in 6 weeks" / "today" / "2 weeks ago") | never null | `144`, `209` |
| `score` | `number` 0-100 | never null | `145`, `210` |
| `impact` | `string` ("Hits you" / "Might hit you" / "No impact") | never null | `146`, `211` |
| `bucket` | `number` (index into `buckets`, always ≥0 in a served post — off-axis posts are filtered out before shaping) | never null | `147`, `212` |
| `ms` | `string` (Microsoft's body, HTML flattened to text) | never null, may be `""` | `148`, `213` |
| `plain` | `string` | **always `""`** — see §5 forbidden list | `149`, `217` |
| `msSays` | `string` (first line of `ms`) | never null, may be `""` | `150`, `218` |
| `services` | `string[]` (Microsoft's own `services[]`) | never null, may be `[]` | `151`, `219` |
| `tags` | `string[]` (Microsoft's own `tags[]`) | never null, may be `[]` | `152`, `220` |
| `publishedAt` | `string` (ISO; `startDateTime ?? lastModifiedDateTime`) | never null | `153`, `221` |
| `lastModifiedAt` | `string` (ISO) | never null | `154`, `222` |
| `actionRequiredBy` | `string \| null` (ISO) | **often null** — see #1536, §7 | `155`, `223` |
| `analysis` | `WireAnalysis \| null` | null when no confirmed interpretation exists for this post | `362` |

**`WireAnalysis`** (`portal-message-center.ts:169-180`, the #1532/#1533 tenant reading — join
described in §4 cross-module edges):

| Field | Type | Nullability | Line |
|---|---|---|---|
| `summary` | `string \| null` | from `m365ChangeInterpretationsTable.summary` | `170`, `346` |
| `changeClass` | `string` | never null when `analysis` is non-null | `171`, `347` |
| `whoActs` | `string` (`"microsoft"` \| `"admin"`) | never null | `172`, `348` |
| `controllable` | `string` (`"yes"` \| `"no"` \| `"unknown"`) | never null | `173`, `349` |
| `controlMethod` | `string \| null` | null unless `controllable === "yes"` (schema-level invariant, §3) | `174`, `350` |
| `measured` | `boolean` | never null; true iff resolution `status === "measured"` **and** `affectedCount !== null` | `175`, `344`, `351` |
| `affectedCount` | `number \| null` | **null unless `measured`** — never a guessed zero | `176`, `352` |
| `measuredAt` | `string \| null` (ISO) | null unless `measured` | `177`, `353` |
| `basis` | `string \| null` (`"monitor_check"` \| `"license_snapshot"`) | null unless `measured` | `178`, `354` |
| `noise` | `boolean` | true iff `measured && affectedCount === 0` — the suppression signal, §4 | `179`, `355` |

**`Bucket`** (`artifacts/api-server/src/lib/portal-message-center.ts:186-194`):

| Field | Type | Line |
|---|---|---|
| `label` | `string` | `187` |
| `sub` | `string` | `188` |
| `wave` | `string` (band name, shared by 1-3 consecutive buckets) | `189` |
| `from` | `string` (ISO, inclusive) | `191` |
| `to` | `string` (ISO, exclusive) | `193` |

Fixed 11-bucket / 5-band shape (1 fortnight×3, month×6, quarter×2 — the last quarter open-ended
into the far future), because the page's wave URLs are positional (`portal-message-center.ts:180-184`
in the lib file). **Only the labels move with the clock; the band count never does.**

**`DensityRow`** (`portal-message-center.ts` lib file `:355-359`): `{ wl: string, name: string,
cells: [number,number,number,number][] }` — one row per workload that has ≥1 post on the axis
(rows with a Microsoft-service Copilot the tenant never triggered are omitted entirely, not
zero-filled — `:380-387`), one `[breaks,decides,visible,silent]` tuple per bucket.

**`StatDef`** (`portal-message-center.ts` lib file `:496-502`): `{ key, label, value: string,
sub: string, tone: string }` — 6 fixed cards (`decisions`, `hits`, `soon`, `reversed`, `seen`,
`none`), built in `:535-542`.

### 1b. `admin-m365-interpretations.ts` — the authoring/resolution surface (AdminV2 only)

Source: `artifacts/api-server/src/routes/admin-m365-interpretations.ts`. `requireAdmin`-gated
(`:54`), never customer-reachable. Resolved against one MSP server-side (`resolveDefaultMspId`,
`:67-78`), never from the request body.

| Route | Method | Purpose | Line | AdminV2 caller |
|---|---|---|---|---|
| `/admin/m365/interpretations` | GET | library + counts | `110` | `m365ChangesStore.ts:232` |
| `/admin/m365/interpretations/candidates` | GET | roadmap/MC sources with no interpretation yet | `140` | `m365ChangesStore.ts:260` |
| `/admin/m365/interpretations/propose` | POST | AI proposes (unsaved) | `258` | `m365ChangesStore.ts:287` |
| `/admin/m365/interpretations` | POST | create (default `status:'proposed'`) | `361` | `m365ChangesStore.ts:334` |
| `/admin/m365/interpretations/:id` | PATCH | edit | `429` | `m365ChangesStore.ts:368` |
| `/admin/m365/interpretations/:id/confirm` | POST | → `status:'confirmed'` | `481` | `m365ChangesStore.ts:387` |
| `/admin/m365/interpretations/:id/reject` | POST | → `status:'rejected'` | `486` | `m365ChangesStore.ts:387` |
| `/admin/m365/interpretations/:id` | DELETE | remove | `527` | `m365ChangesStore.ts:411` |
| `/admin/m365/interpretations/:id/resolve` | POST | run count now across tenants (confirmed-only, 409 otherwise) | `564` | **none — see §"orphaned endpoints" below** |
| `/admin/m365/interpretations/:id/resolutions` | GET | stored per-tenant answers | `622` | **none — see below** |

**`toWire(row: M365ChangeInterpretation)`** (`admin-m365-interpretations.ts:81-107`):

| Field | Type | Nullability | Line |
|---|---|---|---|
| `id` | `number` | never null | `83` |
| `mspId` | `number` | never null | `84` |
| `featureId` | `string \| null` | null for a hand-authored interpretation with no roadmap source | `85` |
| `graphMessageId` | `string \| null` | null for a roadmap-only or hand-authored interpretation | `86` |
| `sourceKind` | `string` (`"roadmap"` \| `"message_center"` \| `"manual"`) | never null | `87` |
| `title` | `string` | never null | `88` |
| `summary` | `string \| null` | `89` |
| `changeClass` | `string` (real enum, §3) | never null | `90` |
| `touches` | `M365Touches` object (§3) | never null (schema default) | `91` |
| `whoActs` | `string` (`"microsoft"` \| `"admin"`) | never null | `92` |
| `controllable` | `string` (`"yes"` \| `"no"` \| `"unknown"`) | never null | `93` |
| `controlMethod` | `string \| null` | `94` |
| `probe` | `M365Probe` object (§3) | never null (schema default) | `95` |
| `status` | `string` (`"proposed"` \| `"confirmed"` \| `"rejected"`) | never null | `96` |
| `proposedBy` | `string` (`"ai"` \| `"human"`) | never null | `97` |
| `aiModel` | `string \| null` | `98` |
| `aiRationale` | `string \| null` | `99` |
| `confirmedBy` | `string \| null` | null unless confirmed | `100` |
| `confirmedAt` | `string \| null` (ISO) | null unless confirmed | `101` |
| `notes` | `string \| null` | `102` |
| `createdBy` | `string \| null` | `103` |
| `createdAt` | `string` (ISO) | never null | `104` |
| `updatedAt` | `string` (ISO) | never null | `105` |

**`GET .../candidates`** response (`:242`): `{ roadmap: RoadmapCandidate[], messageCenter:
MCCandidate[] }`. `RoadmapCandidate` carries `crossedOver: boolean` (`:172-185`, the #1531 join
— has this roadmap item landed in any tenant's Message Center feed yet). `MCCandidate` carries
`roadmapFeatureIds: string[]` (`:216-238`), `[]` when the #1531 migration column isn't present
(never thrown — `hasRoadmapFeatureIdsColumn()` gate, `:193`).

**`POST .../:id/resolve`** response (`:600-611`): `{ interpretationId, results:
[{customerId, tenantName, status, affectedCount, basis, basisDetail, errorMessage, measuredAt}] }`
— one entry per tenant the interpretation was run against.

**`GET .../:id/resolutions`** response (`:657-671`): `{ interpretationId, resolutions:
[{id, customerId, tenantName, status, affectedCount, basis, basisDetail, errorMessage,
measuredAt, updatedAt}] }` — the stored current answer per tenant, tenant name left-joined from
`tenantsTable`.

### 1c. `message-center-sync.ts` / `m365-roadmap-sync.ts` — the writers (no HTTP surface)

Not routes — visible Workflow Engine nodes. Included here because Design needs to know these
exist and what they write, not because they carry a wire contract of their own.

- `syncMessageCenterForTenant` (`artifacts/api-server/src/lib/message-center-sync.ts:71-174`) —
  per-tenant, writes `msp_message_center_items`. Called for every tenant with `consent.graph.status
  === "granted"` (`:233-241`) on a daily schedule wired in `index.ts:272-284`.
- `syncM365RoadmapSnapshot` / `syncM365RoadmapTargeted`
  (`artifacts/api-server/src/lib/m365-roadmap-sync.ts:245-386`) — global, unauthenticated, writes
  `m365_roadmap_items` + `m365_roadmap_sync_state`. Fired by the seeded `__system__: M365 Roadmap
  Sync` Workflow Engine node (`seed-system-workflows.ts:2432-2457`, node type `m365_roadmap_sync`
  registered in `node-type-registry.ts:765` and dispatched in `workflow-executor.ts:6396`) — not a
  bare scheduler, per the standing rule.
- `runM365ResolutionSweep` (`artifacts/api-server/src/lib/m365-change-resolver.ts:497-527`) —
  every confirmed interpretation × every resolvable tenant, from **stored data only**
  (`allowLive: false`, `:513`); wired in `index.ts:292-299`.

---

## 2. CURRENT vs DECIDED table

| Surface / field | Status | Issue | Notes |
|---|---|---|---|
| `GET /portal/message-center` — Microsoft-sourced fields (`title`, `wl`, `kind`, `hard`, `when`, `countdown`, `score`, `impact`, `bucket`, `ms`, `msSays`, `services`, `tags`, `publishedAt`, `lastModifiedAt`, `actionRequiredBy`, `advisoryDateText`, `dateConfidence`) | **CURRENT** | shipped pre-#1494 (base route); `advisoryDateText`/`dateConfidence` added by #1536 | Real, served today, from `msp_message_center_items` |
| `dateUnclearCount` / `dateUnclearPosts[]` (posts with no structural date at all) | **CURRENT** | #1536 | Empty in the live corpus today — every real post carries at least `endDateTime` — but wired and honest, not a placeholder |
| `posts[].analysis` (interpretation + measured count) | **CURRENT** | #1532, #1533 | Shipped, live, but see "unconsumed" note below |
| Roadmap ingestion (`m365_roadmap_items`, `m365_roadmap_sync_state`) | **CURRENT** | #1530 | Migration run by Shane; sync workflow live |
| Roadmap ↔ Message Center join (`roadmap_feature_ids`, crossover) | **CURRENT** | #1531 | Migration run; join live in candidates + `analysisByMessageId` is separate — see §4 |
| Interpretation authoring (AdminV2 screen, propose/confirm/reject) | **CURRENT** | #1532 | Migration run; live |
| Resolution layer (`m365_change_resolutions`, resolver, sweep) | **CURRENT** | #1533 | Migration run; live; daily sweep active |
| `POST .../:id/resolve`, `GET .../:id/resolutions` (endpoints exist, work, tested) | **CURRENT but orphaned** | #1615 (filed at pack time, this session) | No AdminV2 caller — see §6 |
| Automatic routing to Change Control / Risk on a resolved, non-zero, dated change | **DECIDED** (shape) | #1534 | Auto-creates a CR; **intake shape** (informed / approval / advisory) determined by `whoActs`+`controllable`. **Not built** — no code implements this routing yet |
| A fourth `StoredChangeClass` value for "informed" CRs, or reuse `standard` with Microsoft as implementer | **OPEN**, not decided | #1534 | Explicitly unresolved in #1534's own comment |
| Timeline UI shape (primary visual variable: affected-count vs action-required vs time-to-deadline) | **OPEN**, not decided | #1535 | Explicit open question for Design — do not invent an answer |
| Date-quality handling for null `actionRequiredByDateTime` | **CURRENT** | #1536 | Built: `advisory_date_text` (prose, never a Date, never bucket-driving) + `DATE_UNCLEAR` first-class bucket for a post with neither `actionRequiredByDateTime` nor `endDateTime`. See §7 |
| Cloud-instance / GCC filtering as a first-class dimension | **OPEN** (data exists, filter UI/behaviour undecided) | #1537 | `cloudInstances` is CURRENT on `m365_roadmap_items`; the *use* of it as an exclusion/extraction dimension is not built |
| `plain` (human write-up in "Shane's words") | **Forbidden for now** (stated absence) | none filed | See §5 |
| `youSay`, `evidence`, `seats`(real), `crCode`, `crState`, `phases`, `roadmapId`, `toldYou`, `history`, `decisions`, `thread` on `MsPost` | **Forbidden** — no backend | none filed (design fixture only) | See §5 |

**Every DECIDED row above carries its issue number, per the pack requirement.** Where no issue
number is listed, it is an open gap, not a decision — do not treat it as settled.

---

## 3. Real enum unions only

All pulled verbatim from `lib/db/src/schema/msp.ts`, cited to file:line. **Design must not invent
a status vocabulary outside these lists.**

```ts
// lib/db/src/schema/msp.ts:2474-2480
M365_CHANGE_CLASSES = ["retirement", "default_flip", "new_feature", "breaking_change", "licensing"]

// lib/db/src/schema/msp.ts:2483
M365_INTERPRETATION_STATUSES = ["proposed", "confirmed", "rejected"]

// lib/db/src/schema/msp.ts:2487 — who has to act for the change to take effect
M365_ACTORS = ["microsoft", "admin"]

// lib/db/src/schema/msp.ts:2491 — "unknown" is the honest default, never omitted
M365_CONTROLLABILITY = ["yes", "no", "unknown"]

// lib/db/src/schema/msp.ts:2588 — resolution outcome
M365_RESOLUTION_STATUSES = ["measured", "not_measured", "error"]

// lib/db/src/schema/msp.ts:2592 — which existing probe infra produced a measured number
M365_RESOLUTION_BASES = ["monitor_check", "license_snapshot"]

// lib/db/src/schema/msp.ts:2601-2610 — why a resolution is not_measured (structured, not vague)
M365_NOT_MEASURED_REASONS = [
  "no_probe", "check_not_found", "no_stored_profile", "sku_not_mapped",
  "no_sku_data", "license_gap", "consent_revoked", "requires_script",
]
```

**Post `kind`** — not a DB enum, a derived classification (`portal-message-center.ts` lib
file `:126-146`): `"b" | "d" | "v" | "s"` — breaks-something / needs-a-decision / your-people-
will-see-it / silent. Priority ladder over Microsoft's own `category`+`tags`, never a reading of
the tenant (`:120-125`).

**Roadmap item `status`** (`m365_roadmap_items.status`, `lib/db/src/schema/msp.ts:2398`) —
**free text from Microsoft**, not a closed enum this platform defines: `"In development" |
"Rolling out" | "Launched"` is Microsoft's own `publicRoadmapStatus` string, kept verbatim. Do
not treat this as a fixed union to build a status pill against without a fallback for an
unrecognized value.

**`M365Touches`** (`lib/db/src/schema/msp.ts:2501-2506`) and **`M365Probe`**
(`lib/db/src/schema/msp.ts:2516-2521`) are structured objects, not enums — reproduced here for
completeness:

```ts
interface M365Touches { services: string[]; protocols: string[]; skus: string[]; settings: string[]; }
interface M365Probe { description: string; monitorCheckKey?: string | null; powershell?: string | null; graphEndpoint?: string | null; }
```

---

## 4. The honest-empty contract, and the tri-state Design must not collapse

Two independent honest-empty mechanisms exist in this module, at two different layers. Design
must render **both**, not merge them into one "no data" state.

### 4a. Post-level: "your tenant has not been read against this notice"

Constant, verbatim (`portal-message-center.ts:191-192`):

> "Your tenant has not been read against this notice. What Microsoft published is above; the
> count of what it touches in your estate is not something this page has measured."

This is `posts[].analysis === null` **or** `analysis.measured === false`
(`portal-message-center.ts:359-363`, `:175`, `:344-356`). It is per-post, and it is the
**default** — a post only escapes it when a **confirmed** interpretation exists for that
specific `graphMessageId` **and** the resolution layer actually measured a count for this
tenant. `measured: false` still serves the interpretation's `summary`/`whoActs`/`controllable`
fields when one exists (`portal-message-center.ts:175` comment) — "do I have to act" and "can I
turn it off" are real answers even before the estate is counted; only the numeric half stays
stated-absent.

### 4b. Route-level: `scoped: false`

`portal-message-center.ts:242-249` — an account with no resolvable tenant row (no `tenants` row,
missing `mspId`, or blank `tenantId` per `portal-customer-scope.ts:70-75`) gets `scoped:false`
and every array field empty, **not an error**. The frontend (`useMessageCenter.ts:204-213`) reads
`!body.scoped` and falls back to the design fixture rather than rendering an empty grid that
reads as "a clear twelve months" — the honest distinction is "never connected" vs "connected and
genuinely clear."

### 4c. The tri-state Design must build, explicitly

The real states a reader can be in, which the current frontend does **not** yet fully
distinguish (it currently has only two: fixture-vs-live, `useMessageCenter.ts:179-185`,
`204-213`):

1. **Loading** — fetch in flight, nothing decided yet (`loaded: false`, `useMessageCenter.ts:182`).
2. **Live, genuinely empty** — `scoped: true` and `posts.length === 0` because Microsoft has
   genuinely posted nothing on this tenant's axis. **Currently indistinguishable from "never
   connected" in the frontend** — both paths fall to `FIXTURE_DATASET`
   (`useMessageCenter.ts:204-213`, the condition is `!body.scoped || posts.length === 0`, which
   conflates the two). This is a real gap for Design to close: a tenant that is genuinely quiet
   should not be shown the design's fixture tenant as if it were their own data.
3. **Read-failed** — the fetch threw or returned non-200 (`useMessageCenter.ts:194-197`,
   `236-239`), rendered as `error: "Your Microsoft Message Center could not be loaded."` This is
   already distinct from the other two in the hook's return shape (`error: string | null`), but
   the page must not visually collapse it into the same "empty" treatment as case 2.

**Design must not treat "no posts" as one state.** The three above are genuinely different facts
about the world (nothing checked yet / checked and clear / checking failed) and read very
differently to an MSP ("I'm not connected" vs "I'm connected and it's quiet" vs "something broke").

---

## 5. The forbidden list

Fields on the design's `MsPost` (`artifacts/msp-portal/src/components/portal-v2/msChangesData.ts:75-115`)
that this module has **no backend for**, stated plainly rather than silently fixture-filled.
Cited to `useMessageCenter.ts`'s own `toPost` mapper (`:112-161`), which is the single place
every one of these is decided:

| Field | What the code does | Line |
|---|---|---|
| `plain` | Falls back to `msSays` (Microsoft's own first line) — **not** a human write-up. There is no write-up source; paraphrasing Microsoft with a regex would be a worse lie than reusing its own words. | `132` |
| `youSay` | Set to the literal `notReadAgainstTenant` stated-absence string, always. | `135` |
| `evidence` | Always `[]`. | `136` |
| `evidenceNote` | Always `""`. | `137` |
| `ignore` | Always `""` — "what happens if nobody acts" is not derivable from Microsoft's fields. | `138` |
| `seats` | `services.join(" · ")` (a category list) **or** `"Not measured against your tenant"` — never a real seat count. | `139` |
| `optOut` | Either `"Microsoft has published a deadline"` (if `actionRequiredBy` is set) or `"Not stated in the post"` — **never** the real opt-out procedure, because that is prose inside `bodyContent`, not a structured Graph field. | `142-143` |
| `optOutNote` | Always `""`. | `144` |
| `owned` | Always `""` — no ownership/RACI join exists for Message Center posts. | `145` |
| `crCode`, `crState`, `crNote` | Always `""` — **nothing links a Message Center post to a Change Request yet.** This is exactly the gap #1534 exists to close (see §6, and the CURRENT/DECIDED table). | `148-150` |
| `phases` | Always `[]` — Graph does not return per-tenant rollout-ring breakdown. | `153` |
| `roadmapId` | Always `""` **on this specific wire shape** — note this is a real gap: the roadmap↔MC join (#1531) exists server-side (`roadmapFeatureIds` on the MC item, `analysisByMessageId` via `graphMessageId`) but is not threaded through to this specific field on `MsPost`. | `154` |
| `toldYou` | Always `""` — no customer-notification-sent tracking exists for these posts. | `156` |
| `history` | Always `[]`. | `157` |
| `decisions` | Always `[]` — note this is a different `decisions` than the routing/CR decision described in #1534; no code path populates either onto this field. | `158` |
| `thread` | Always `[]`. | `160` |

**Additionally forbidden at the module level** (not fields on `MsPost`, but capabilities Design
must not assume exist): a human-authored "Shane's words" paraphrase of any post; a per-tenant
rollout-ring/phase view; any write path on this module other than the sync jobs (see §6).

---

## 6. Cross-module edges

This module is **read-only by design** (`portal-message-center.ts:61-65`, `:8-27`). The daily
sync is its **sole writer**:

- `message-center-sync.ts` → `msp_message_center_items` (per-tenant Microsoft posts)
- `m365-roadmap-sync.ts` → `m365_roadmap_items`, `m365_roadmap_sync_state` (global roadmap feed)
- `m365-change-resolver.ts`'s daily sweep → `m365_change_resolutions` (stored-data-only re-count)

**The page's own actions do not write to this module's tables at all.** Per the route header
(`portal-message-center.ts:62-65`): snooze, record-a-decision, and brief-the-wave are named
explicitly as writing to **change control and hold windows** — separate tables this module never
touches. Design must not draw a "save"/"snooze" affordance on this page that implies a write
lands here; it lands elsewhere, and #1534 (not yet built) is what will formalize that write path
as an automatic CR.

**Other real edges, extracted from the shipped code:**

- **Roadmap → Message Center**, on the Microsoft roadmap **feature ID** (`m365-roadmap-mc-link.ts:1-34`).
  `extractRoadmapFeatureIds()` parses `msp_message_center_items.body.content` once, at sync time
  (`message-center-sync.ts:131-137`), and persists to `msp_message_center_items.roadmap_feature_ids`
  (a GIN-indexed jsonb array). Read side: `findMessageCenterPostsForFeatureId`,
  `getCrossedOverFeatureIds`, `withCrossoverFlag` (`m365-roadmap-mc-link.ts:193-246`) — used
  today only by the AdminV2 candidates endpoint (`admin-m365-interpretations.ts:172-185`), **not**
  by the customer-facing route. See the `roadmapId` forbidden-field note in §5 for the
  consequence: the join exists, but is not threaded onto the customer wire shape yet.
- **Interpretation → Message Center post**, on `graphMessageId`
  (`portal-message-center.ts:312-339`) — the join that produces `posts[].analysis`. **Confirmed
  interpretations only** (`eq(status, "confirmed")`, `:336`) — a `proposed` (AI, unverified)
  reading never reaches a customer. This is the #1532 confirmation gate enforced at the read
  layer, not just the write layer.
- **Interpretation → Resolution**, on `interpretationId` + `customerId`
  (`portal-message-center.ts:326-332`, left join) — one current resolution row per pair
  (`m365_change_resolutions_interp_customer_uidx`, `lib/db/src/schema/msp.ts:2658`), overwritten
  on re-measure, not appended.
- **Resolution → probe infrastructure** (no second probe mechanism, `m365-change-resolver.ts:12-26`):
  `probe.monitorCheckKey` → `monitor_checks` / `tenant_monitor_profiles` (falls back to a live
  `executeMonitorCheck` dispatch through the check's own `executorType` — Graph, the
  `ca-ps-execution` PowerShell container, sharepoint-admin, or dns); `touches.skus` →
  `license_assignment_snapshots`. Live resolution runs use `persistProfile: false`
  (`m365-change-resolver.ts:219`, `:209-212`) — a resolution pass deliberately does not become
  the score (#543's correctness rule), so Design should not assume "resolving a change" changes
  a tenant's general monitoring health numbers anywhere else in the portal.
- **`noise: true`** (`portal-message-center.ts:355`) — a **measured** zero. This is the
  suppression signal named in #1533's own issue ("zero affected objects = the post is noise for
  that customer") and is the field the future routing/CR work (#1534) and any "hide noise"
  affordance in the timeline UI (#1535) should key off — **not** `analysis === null` or
  `measured === false`, both of which mean "not counted," a different fact from "counted and
  irrelevant."

**Orphaned live endpoints (found at pack time, filed as #1615, sub-issue of #1494):**
`POST /api/admin/m365/interpretations/:id/resolve` and `GET
/api/admin/m365/interpretations/:id/resolutions` are real, tested, working endpoints with **no
caller anywhere in `artifacts/admin-panel`** (`m365ChangesStore.ts`'s `adminFetchRef` calls are
fully accounted for at lines 232, 260, 287, 334, 368, 387, 411 — neither `/resolve` nor
`/resolutions` appears). The daily sweep populates `m365_change_resolutions` on its own schedule
regardless, so the data is not entirely inert, but there is currently no on-demand "resolve now"
or "show me the per-tenant numbers" affordance in AdminV2. Design should be aware this UI does
not exist yet if asked to design an admin-side view of resolution data — it would be new
ground, not a re-skin of something already wired.

---

## 7. Open questions carried forward (unchanged by this pack — these are Product decisions, not extraction gaps)

- **#1534 — auto-create vs propose, and the fourth intake shape.** Auto-create is settled
  (`#1534`'s own comment: "Routing auto-creates a CR in every case"); the CR's **intake**
  (informed / approval / advisory) varies by `whoActs` + `controllable`. **Still open:** whether
  "informed" becomes a fourth `StoredChangeClass` value or reuses `standard` with Microsoft named
  as implementer. No code implements any part of this routing yet — `crCode`/`crState`/`crNote`
  are hard-forbidden (`0`, §5) until it does.
- **#1535 — timeline UI's primary visual variable.** Explicitly undecided between affected-object
  count, action-required, and time-to-deadline; "only one can be primary" per the issue's own
  closing line. Design owns this decision; this pack does not pre-empt it.
- **#1536 — `actionRequiredByDateTime` is often null. Built.** Two independent pieces, per the
  issue's own decision (an honest `date unclear` bucket is first-class; prose dates are extracted
  into a separate advisory field, never the deadline field, never bucket-driving):
  - **Advisory prose date** — `advisory_date_text` on `msp_message_center_items`, parsed ONCE at
    sync time by `m365-message-center-date-quality.ts`'s `extractAdvisoryDateText()` from the
    post's own `[Rollout Schedule]` section (validated against all 567 real posts carrying that
    section in the local corpus; 549 produced a genuine date-bearing phrase). Served on the wire
    as `WirePost.advisoryDateText` — rendered as the prose it came from, never parsed into a
    `Date`, never substituted into `actionRequiredBy`, and never read by bucket placement.
  - **`DATE_UNCLEAR` first-class bucket** — `placementForPost()` (`portal-message-center.ts` lib)
    is now the ONLY function that decides bucket placement; it returns the `DATE_UNCLEAR`
    sentinel for a post with neither `actionRequiredByDateTime` nor `endDateTime` set, rather
    than falling back to `startDateTime`/`lastModifiedDateTime` (publish/edit timestamps, not a
    landing date). `effectiveDate()`'s fallback chain is unchanged and still used for display
    once a structural date exists. Surfaced on the wire as `dateUnclearCount` /
    `dateUnclearPosts[]` (a distinct, smaller shape than `WirePost` — no `bucket`/`when`/
    `countdown`, since computing those would mean the same fallback this bucket exists to avoid;
    `lastUpdated` is offered instead, honestly labelled). Empty in the live corpus today — every
    real post carries at least `endDateTime` — so this is defensive-but-real architecture, not
    presently load-bearing; the timeline UI (#1535) still owns how (or whether) either surface is
    drawn.
- **#1537 — GCC exclusion and the NASA extraction.** The data exists and is CURRENT:
  `m365_roadmap_items.cloud_instances` (`lib/db/src/schema/msp.ts:2403`, GIN-indexable for
  containment queries). **Not built:** any actual filter/exclusion behavior using it — this
  platform does not yet enforce the gov/GCC exclusion from this data, and the NASA
  GCC-High/DoD-only filter is unbuilt. Treat `cloudInstances` as available raw material, not as
  an already-applied business rule.
