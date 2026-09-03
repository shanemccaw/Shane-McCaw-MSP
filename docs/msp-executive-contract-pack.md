# MSP Dashboard / Executive View — contract extraction pack

**For Claude Design. Extracted, not authored — every claim below is cited to file:line against
the code on `main`.** Read-only build: no product code, no schema, no UI were changed to produce
this document (one genuine backend bug was found while extracting §4 and is documented there and
filed separately, not fixed in this pass).

Module: **MSP Dashboard / Executive View** (leaf issue #2657, Feature #2573, epic #1571 EPIC:
Portal Admin). MSP-only concept — **no Portal counterpart** (see #2573's own body: "no direct
1:1 Portal Feature... not derived from a single customer-facing surface"). There is **no prior
pack** for this module; this is the first.

**The MSP Console UI that will call these routes does not exist yet.** `artifacts/msp-console`
was never scaffolded (#1680, closed as superseded — scaffolding itself is still open work under
#1571). All three routes below are registered and live on `main`, reachable today by any
authenticated MSP-role bearer token, but **orphaned** — no frontend calls them. See §6.

> **A real backend bug was found during this extraction, not fixed here (read-only pack).** The
> `topOpportunities` list and the opportunity half of `rollup` are **silently empty on every real
> MSP book right now**, even when open pipeline genuinely exists, because
> `gatherExecutiveBook()`'s customer→opportunity bridge resolves `sales_offers.customer_id`
> through the wrong table. See §4 for the full trace and citations. Filed as **#2722** (sibling
> sub-issue of Feature #2573).

---

## 0. The three surfaces of this module

| # | Surface | File | Audience | Writes? |
|---|---|---|---|---|
| A | `GET /api/msp/executive` | `artifacts/api-server/src/routes/msp-executive.ts:37-52` | MSPOperator+ | no |
| B | `GET /api/msp/executive/qbr` | `artifacts/api-server/src/routes/msp-executive.ts:55-69` | MSPAdmin+ | no (cache read only) |
| C | `POST /api/msp/executive/qbr/generate` | `artifacts/api-server/src/routes/msp-executive.ts:72-95` | MSPAdmin+ | yes (`msp_partner_qbrs` row; Anthropic API call) |

Router mounted at `router.use(mspExecutiveRouter)` in
`artifacts/api-server/src/routes/index.ts:546`, itself mounted at `app.use("/api", router)`
(`artifacts/api-server/src/app.ts:112`) — so the three paths above are the real, full paths.

Two shared library modules back all three routes:

- **`artifacts/api-server/src/lib/msp-executive-data.ts`** — `gatherExecutiveBook()`, the single
  source of truth for the ranked lists (A) and the QBR's grounding data (C). Header states the
  intent explicitly (`:5-8`): "Both the GET /api/msp/executive route... and the Partner QBR
  generator... call `gatherExecutiveBook()`, so the QBR can never drift from what the lists show."
- **`artifacts/api-server/src/lib/partner-qbr-generator.ts`** — the AI document generator (B/C)
  and its cache.

---

## 1. Per-surface wire contract

### 1a. `GET /api/msp/executive` — top risks + top opportunities + roll-up (A)

Source: `msp-executive.ts:37-52`. Auth: `requireRole("MSPOperator")` (`:37`) — MSPOperator or
above (MSPAdmin, PlatformAdmin via legacy `role: "admin"`) per the `ROLE_ORDER` hierarchy in
`middlewares/requireAuth.ts:80-88`. Read-only.

`mspId` is `resolveMspIdStrict(req)` (`:39`, `resolve-msp-id.ts:76`) — `req.user?.mspId ?? null`,
**never a request param or query override**. `null` → `403 { error: "MSP context required" }`
(`:40-43`) — this is the one non-generic error shape this module defines itself; every other 401/403
below is the shared `requireAuth`/`requireRole` middleware shape.

Staff scoping: `resolveStaffScopedCustomerIds(req.user!)` (`:45`,
`middlewares/requireAuth.ts:349-361`) — for an MSPOperator/MSPAdmin with rows in
`msp_staff_customer_scopes`, returns that customer-id array (restricted to those); with **zero**
rows, returns `null` (unrestricted — full book). Folded into `gatherExecutiveBook(mspId,
scopedIds)` at the DB level (`msp-executive-data.ts:106-110`), same pattern `msp-alerts.ts` uses.

**Response body — the full `ExecutiveBook` shape** (`msp-executive-data.ts:70-85`), returned
verbatim as `res.json(book)` (`msp-executive.ts:47`):

| Field | Type | Nullability | Line |
|---|---|---|---|
| `mspId` | `number` | never null | `71` |
| `customerCount` | `number` (size of the scoped book) | never null | `72` |
| `topRisks` | `RiskTenant[]` (§2, capped at `topN`, default 5) | never null, may be `[]` | `73` |
| `topOpportunities` | `OpportunityTenant[]` (§2, capped at `topN`, default 5) | never null, may be `[]` | `74` |
| `rollup.avgGoodnessPercent` | `number \| null` | **null when no customer has a health snapshot** | `77` |
| `rollup.atRiskCount` | `number` (goodness < 60) | never null | `79` |
| `rollup.totalOpenOpportunityCents` | `number` (whole book, not just top N) | never null | `81` |
| `rollup.openOfferCount` | `number` (whole book, not just top N) | never null | `83` |

`topN` is a function parameter (`opts.topN`, `:98`) with a hard-coded default of **5**
(`DEFAULT_TOP_N`, `:46`) — **the route never passes `opts`**, so it is always 5 and there is
**no query param to change it**. Design must treat 5 as fixed, not configurable, unless a future
build adds a `?topN=` passthrough.

**Empty-book shape** (`:115-121`, returned when the scoped book has zero customers): every field
present, `topRisks: []`, `topOpportunities: []`, `rollup.avgGoodnessPercent: null`, all other
rollup fields `0`. Never throws for an empty book (function header, `:91-94`).

### 1b. `GET /api/msp/executive/qbr` — current quarter's cached QBR (B)

Source: `msp-executive.ts:55-69`. Auth: `requireRole("MSPAdmin")` (`:55`) — **strictly higher**
than surface A; a plain MSPOperator gets `403 { error: "Insufficient privileges — MSPAdmin or
above required" }` (the generic `requireRole` shape, `requireAuth.ts:215-217`), confirmed by
`msp-executive.test.ts:140-145`. Same `mspId`-required-403 guard as A (`:57-61`).

**Never triggers generation** — comment states this explicitly (`:54`) and the handler calls only
`getCurrentPartnerQbr(mspId)` (`:63`, `partner-qbr-generator.ts:165-169`), a pure cache read.

Response (`:64`): `{ quarterKey: string, qbr: PartnerQbrResult | null }`. `quarterKey` is
`currentQuarterKey()` (`:66-69` in the generator) — **server-computed from `new Date()` at
call time**, not the QBR row's own `quarterKey` (they will agree whenever a QBR exists for the
current quarter, but the field is independently derived, not copied off `qbr`). `qbr` is `null`
when no row exists yet for `(mspId, currentQuarterKey())` — a real, expected first-view state,
not an error (confirmed live: 0 rows in `msp_partner_qbrs` locally, §5).

**`PartnerQbrResult`** (`partner-qbr-generator.ts:54-62`, §3 for the enum):

| Field | Type | Nullability | Line |
|---|---|---|---|
| `status` | `"generating" \| "ready" \| "failed"` | never null | `55` |
| `quarterKey` | `string` (e.g. `"2026-Q3"`) | never null | `56` |
| `title` | `string` (e.g. `"{mspName} — Partner QBR — {quarter}"`, `:205`) | never null, may be `""` pre-generation | `57` |
| `htmlContent` | `string` (semantic HTML fragment, no wrapper) | never null, `""` until ready | `58` |
| `model` | `string \| null` (e.g. `"claude-opus-4-8"`) | null until a generation attempt completes | `59` |
| `generatedAt` | `string \| null` (ISO) | null until `status: "ready"` | `60` |
| `errorMessage` | `string \| null` | null except `status: "failed"` | `61` |

### 1c. `POST /api/msp/executive/qbr/generate` — generate/regenerate (C)

Source: `msp-executive.ts:72-95`. Auth: `requireRole("MSPAdmin")` (`:72`), same 403 shape as B.
Body: `{ force?: boolean }` — `req.body?.force === true` (`:80`), any other value (including
absent) is treated as `false`. **No other input** — the route accepts no free-text prompt
override, no model override; both are fixed server-side (§3).

Calls `getOrGeneratePartnerQbr(mspId, { force })` (`:81`, generator `:184-295`). Three response
shapes, all real and reachable:

| Condition | Status | Body | Line |
|---|---|---|---|
| Existing `status: "ready"` row for the current quarter, `force` falsy | `200` | `{ qbr }` (cache hit — generator returns without calling the model) | generator `:191-194` |
| Empty book (`customerCount === 0`) | **`422`** | `{ error: "No customers in your book to review yet." }` | route `:82-85` |
| Model call succeeds | `200` | `{ qbr }` with `status: "ready"` | `:90` |
| Model call throws, or `extractAiHtml` returns empty | **`502`** | `{ error: qbr.errorMessage ?? "QBR generation failed", qbr }` | route `:86-89`, generator `:276-294` |

Confirmed by `msp-executive.test.ts:169-198` (200/422/502 all asserted, `502` body's `error`
field asserted `=== "boom"` — the route echoes `qbr.errorMessage`, not a generic string).

**Whole-book, not staff-scoped** (generator `:196-197`, doc comment `:178-180`): `force` aside,
this route calls `gatherExecutiveBook(mspId, null)` — always the **unrestricted** book, even if
the calling MSPAdmin is themselves staff-scoped in `msp_staff_customer_scopes`. The route-level
gate to MSPAdmin+ is the only access control; there is no additional staff-scope check on this
specific call. Design should not assume a scoped MSPAdmin's QBR reflects only their assigned
customers — it never does.

---

## 2. `ExecutiveBook` row shapes

**`RiskTenant`** (`msp-executive-data.ts:48-56`) — one entry per customer with at least one
`health`-engine snapshot, sorted worst-first (highest raw score = worst), sliced to `topN`:

| Field | Type | Nullability | Line |
|---|---|---|---|
| `customerId` | `number` (`tenants.id`) | never null | `49` |
| `name` | `string` (`tenants.customer_name`) | never null | (join, `:104-112`) |
| `healthScore` | `number` (raw engine score, **higher = worse**) | never null | `51` |
| `goodnessPercent` | `number` 0–100, `100 − healthScore` clamped, **higher = better** | never null | `53`, `:149` |
| `capturedAt` | `string \| null` (ISO, when the snapshot was taken) | null only if the stored timestamp itself is null | `55`, `:158` |

`goodnessPercent < 60` is the "at risk" cut (`AT_RISK_GOODNESS_THRESHOLD`, `:45`) — **the same
threshold the customer-facing Executive Mode / Mission Control red-ring uses** (comment `:44`),
so this module's "at risk" reads identically to what a customer sees on their own dashboard.

**`OpportunityTenant`** (`:58-68`) — one entry per customer with ≥1 open (`draft`/`sent`) sales
offer, sorted by `totalValueCents` descending, sliced to `topN`:

| Field | Type | Nullability | Line |
|---|---|---|---|
| `customerId` | `number` (`tenants.id`) | never null | `59` |
| `name` | `string` | never null | (join) |
| `openOfferCount` | `number` | never null | `61` |
| `totalValueCents` | `number` (USD cents, summed) | never null | `63` |
| `topOfferTitle` | `string \| null` (title of the single highest-value open offer) | null only if somehow zero offers reached this row (should not occur in practice) | `65` |
| `topScore` | `number` 0–100 (highest relevance score across this tenant's open offers) | never null | `67` |

Value preference: `adjustedPriceCents > 0 ? adjustedPriceCents : basePriceCents` (`:219`) — the
engine-adjusted, customer-facing price is preferred; base price is the fallback only when
adjusted is zero/unset.

---

## 3. Real enum unions — no invented vocabulary

- **QBR `status`** (`mspPartnerQbrsTable.status`, `lib/db/src/schema/msp.ts:4227`):
  `"generating" | "ready" | "failed"`. Default `"generating"` at row creation (§4's insert,
  generator `:210-216`) — a claimed/refreshed row exists in `generating` state for the whole
  duration of the Anthropic call, so a concurrent request for the same `(mspId, quarterKey)`
  during generation reads `generating`, not a stale `ready`/absent row. **There is no `generating`
  branch in the route's response-shape table above** because no route currently *returns* a
  `generating` status to the caller in a way distinct from "keep polling `GET .../qbr`" — B simply
  echoes whatever status the row currently holds, which can genuinely be `generating` if hit mid-flight.
- **Open offer states, for the opportunity roll-up**: `OPEN_OFFER_STATES = ["draft", "sent"]`
  (`msp-executive-data.ts:43`) — a *subset* of `salesOffersTable.state`'s real enum. `accepted`,
  `rejected`, `expired` (and any other real offer state) are deliberately excluded from this
  module's opportunity math; only unrealised, still-open offers count.
- **QBR model**: hard-coded `"claude-opus-4-8"` (`QBR_MODEL`, generator `:50`) — not
  user-selectable from either route. `max_tokens` is hard-coded `8000` (`:51`).

---

## 4. CONFIRMED BUG — the opportunity bridge resolves the wrong table (filed as #2722)

**`gatherExecutiveBook()`'s own comment is wrong, and the code it justifies silently zeroes the
opportunity side of every real book.**

The comment (`msp-executive-data.ts:19-21`) states: *"`sales_offers.customerId` is a `users.id`,
so it's resolved back to a `tenants.id` through the user's own `users.tenantId` FK."* The code
implements exactly that: it builds a `users.id → tenants.id` bridge (`:174-184`) and only keeps a
`sales_offers` row whose `customer_id` matches a **user id** present in that bridge (`:212-217`).

That premise is false. Tracing the actual write path:

1. `persistSalesOfferCandidates(candidates, customerId, mspId, ...)`
   (`lib/sales-offer-engine.ts:352-357`) inserts `customerId` **directly** into
   `salesOffersTable.customerId` (`:371`) — no user resolution happens at write time.
2. That `customerId` parameter is the **engine customerId**, i.e. `tenants.id` — confirmed by
   `computeSalesOfferEngine(customerId, ...)` (`sales-offer-engine.ts:302`) sourcing it from
   `buildTenantProfile(customerId)` (`:308`), and `tenant-signals.ts:120-122`'s own doc comment
   naming the parameter explicitly: *"an engine customerId (`tenantsTable.id`)"*.
3. Every **other** real consumer of `salesOffersTable.customerId` in the codebase agrees with this:
   `dashboard-resolvers.ts:1367` compares it directly against `ctx.customerId` (a tenant-scoped
   portal context, no user bridge); `project-sow-fulfillment.ts:97` selects it as a bare
   `customerId` field with no bridge either.

So `sales_offers.customer_id` **is a `tenants.id`**, and `gatherExecutiveBook()` is the one
consumer that bridges it through `users.tenantId` as though it were a `users.id` — a bridge that
only accidentally passes when a tenant's id happens to equal one of its own portal users' ids.

**Confirmed against the live local DB** (queried this session, `DATABASE_URL`, `2026-09-03`):

```
sales_offers: 5 rows, all customer_id = 1, mspId = 1, state = 'draft',
  total open value = 800000+850000+600000+500000+1500000 = 4,250,000 cents ($42,500)
tenants: id=1 "Jane Jane" (mspId 1), id=3 "Test Me" (mspId 1)
users: id=1 role='admin', tenant_id = NULL   ← this is who customer_id=1 is bridged against
users with tenant_id in (1,3): ids 37,39,42,50,55,56,57,103 — none is id 1
```

`customer_id = 1` on every real offer row is `tenants.id = 1` ("Jane Jane") — a real tenant with
real open pipeline. But `gatherExecutiveBook`'s bridge looks for a **user** whose `id` is 1, finds
the PlatformAdmin login (`tenant_id: NULL`, not a customer at all), and — because that user isn't
in `userIdToCustomerId` — silently drops all 5 offers. The result, live, right now: **`GET
/api/msp/executive` returns `topOpportunities: []` and `rollup.totalOpenOpportunityCents: 0`,
`openOfferCount: 0`, even though $42,500 of real open pipeline exists for that exact MSP's book.**
The same zeroed figures then feed straight into the QBR's "Growth Opportunities" section (§ Partner
QBR prompt, `partner-qbr-generator.ts:96-106`) — the AI document would say "(none — no open sales
offers)" on a book that genuinely has open offers.

**topRisks is separately, honestly empty** — zero `tenant_engine_snapshots` rows exist locally at
`engine_key = 'health'` (confirmed, live count `0`), so that half of the module renders its real
empty state correctly; the bug is confined to the opportunity side.

**Design implication**: draw the top-opportunity list and non-zero opportunity roll-up fields as
real, reachable UI, not a permanently-empty one — the bug is a data-bridge defect, not a "this
never has data" module characteristic. #2722 (filed against this issue's own Feature #2573,
`bug` label) carries the fix: drop the `users` bridge entirely and match
`salesOffersTable.customerId` straight against `bookCustomerIds` the way every other real
consumer of that column already does.

---

## 5. Live-data snapshot (queried this session, local `DATABASE_URL`, 2026-09-03)

| Table / condition | Count | Note |
|---|---|---|
| `msps` | 2 | |
| `tenants` | 2 (`id 1` "Jane Jane", `id 3` "Test Me", both `msp_id = 1`) | |
| `tenant_engine_snapshots` where `engine_key = 'health'` | **0** | `topRisks` is honestly `[]` on every real book today |
| `sales_offers` where `state in ('draft','sent')` | 5 (all `customer_id = 1`, `msp_id = 1`) | real $42,500 open pipeline, currently invisible to this module — §4 |
| `msp_partner_qbrs` | **0** | no QBR has ever been generated for any MSP; `GET .../qbr` returns `qbr: null` for every real caller today |

So, as of this pack: a real call to `GET /api/msp/executive` for `mspId=1` returns
`customerCount: 2, topRisks: [], topOpportunities: [], rollup: { avgGoodnessPercent: null,
atRiskCount: 0, totalOpenOpportunityCents: 0, openOfferCount: 0 }` — every list and every number
is honestly reachable as **empty/zero right now**, and `topOpportunities`/`rollup.*Opportunity*`
would be non-zero (real $42,500) the moment #2722 lands. Design must draw both states.

---

## 6. Orphaned surfaces — no caller yet

**All three routes (A, B, C) are orphaned.** `artifacts/msp-console` does not exist in the repo
(confirmed: no such directory under `artifacts/`) — Feature #2573's own body states this plainly
("`artifacts/msp-console` doesn't exist yet... scaffolding is itself the first real piece of work
needed here"), and a repo-wide search for `msp/executive` or `msp-executive` outside
`artifacts/api-server` returns nothing. The backend (routes + both library modules + the
`msp_partner_qbrs` table + tests) is finished and live; the console that will render it is not
scaffolded. Nothing here is DECIDED UI yet — every field above is CURRENT (real, shipped,
queryable) but has no consumer.

---

## 7. Cross-surface edges

- **A ↔ C, same grounding data.** `gatherExecutiveBook()` is the single function both the ranked
  lists (A) and the QBR prompt (C, via `formatBookForPrompt()`, generator `:76-108`) are built
  from — by construction, the QBR's "TOP RISK CUSTOMERS" / "TOP OPPORTUNITY CUSTOMERS" sections
  can never name a tenant or figure that A's own lists don't also show (module header, data lib
  `:5-8`). This also means **#2722's fix changes both A and C's numbers identically** — there is
  no separate opportunity computation to fix twice.
- **A does not read `msp_partner_qbrs`; B/C do not call `gatherExecutiveBook` with staff scope.**
  These are genuinely separate data paths sharing one gathering function, not one combined query.
- **No edge to Change Control, Risk Register, or any customer-facing portal surface.** This module
  reads `tenant_engine_snapshots` and `sales_offers` only — it does not read or write
  `msp_change_requests`, `msp_risk_decisions`, or any table another module (e.g. Microsoft
  Changes, #1642) owns. Confirmed by the full grep of both library files' imports
  (`msp-executive-data.ts:29-37`, `partner-qbr-generator.ts:39-46`) — no cross-module table names
  appear.
- **QBR generation reuses two disciplines from `dashboard-executive-summary.ts`** (generator
  header `:23-31`): `recordAiUsage()` cost telemetry (`ai-billing.ts`, called `:240-248`,
  fire-and-forget `void`) and the quarter-keyed cache. It reuses the **consolidated-SOW**
  generation convention, not the Haiku-summarizer one: streaming Opus via the shared `anthropic`
  client, `getPrompt()` with a DB-editable template and hard-coded fallback (`QBR_PROMPT_FALLBACK`,
  `:110-129`), and `extractAiHtml()` (`./sow-pricing`) for output extraction.

---

## 8. Forbidden list — do not draw, do not invent

- **No per-offer line-item breakdown in the wire contract.** `OpportunityTenant` exposes only an
  aggregate (`openOfferCount`, `totalValueCents`) plus the single top offer's title/score — there
  is no array of individual offers on this surface. A UI wanting the full offer list must call a
  different, real endpoint (the Sales Offer Engine's own routes, out of scope for this pack); do
  not invent an `offers[]` array here.
- **No `topN` query parameter exists.** Do not design a "show more than 5" control against this
  endpoint without a corresponding backend change — today it is always exactly 5 (or fewer, if the
  book has fewer qualifying customers), hard-coded.
- **No QBR editing/versioning surface.** There is one row per `(mspId, quarterKey)`
  (`msp_partner_qbrs_msp_quarter_idx` unique index, schema `:4240`) — regenerating with `force`
  **overwrites the existing row in place** (generator `:250-263`); there is no history of prior
  QBR drafts for a quarter, no diff view, nothing to design against.
- **No customer-initiated QBR request.** All three routes are staff-role-gated
  (MSPOperator+/MSPAdmin+); no customer-facing route in this codebase reads or triggers a Partner
  QBR.
- **Do not draw a live-generation progress indicator beyond the plain `generating` status value.**
  There is no SSE/websocket/polling-interval contract published by this module for the generation
  in flight — B is a plain cache read a UI would have to poll manually if it wants to detect
  `generating → ready` transitions; nothing in the code defines a recommended interval.

---

## Sources

- `artifacts/api-server/src/routes/msp-executive.ts` (routes A/B/C)
- `artifacts/api-server/src/routes/msp-executive.test.ts` (behavioral confirmation of every status code/shape in §1)
- `artifacts/api-server/src/lib/msp-executive-data.ts` (`gatherExecutiveBook`, §2, §4)
- `artifacts/api-server/src/lib/msp-executive-data.test.ts`
- `artifacts/api-server/src/lib/partner-qbr-generator.ts` (§1b/1c, §3, §7)
- `artifacts/api-server/src/lib/sales-offer-engine.ts` (§4 trace)
- `artifacts/api-server/src/lib/tenant-signals.ts` (§4 trace — `customerId` = `tenants.id` convention)
- `artifacts/api-server/src/lib/dashboard-resolvers.ts`, `project-sow-fulfillment.ts` (§4 corroboration)
- `artifacts/api-server/src/middlewares/requireAuth.ts` (role hierarchy, generic 401/403 shapes)
- `lib/db/src/schema/msp.ts:4222-4245` (`msp_partner_qbrs` schema)
- `artifacts/api-server/src/routes/index.ts:210,546`, `artifacts/api-server/src/app.ts:112` (mount path)
- Live local PostgreSQL (`DATABASE_URL`), queried 2026-09-03 (§4, §5)
