# Partner Revenue (MSP Console) — contract extraction pack for Claude Design

**#3368**, sub-issue of **#1571** (EPIC: Portal Admin — MSP-side operator surface). No
Feature-tier parent exists directly above #3368 in GitHub (its own parent is the Epic), but
**#1692** (Feature: Billing, MSP Console) is the real Feature this surface belongs to — the
sibling Billing pack (#2607, `msp-plan-self-service-contract-pack.md`) is parented there, and
this surface's own genuine "no UI yet" gap is already tracked as **#2609** ("Billing: wire the
MSP Console UI to the real endpoints"), itself blocked on **#2608** (Design export), both `Part
of #1692`. See §0.2. Follows the **#1642 pattern**: per-surface wire contract extracted verbatim
and cited to file:line, CURRENT vs DECIDED marked, real enum unions only, cross-surface edges,
honest tri-state, forbidden list, orphaned endpoints listed explicitly. Read-only — no product
code, schema, or UI changed.

Backend route file: `artifacts/api-server/src/routes/msp-partner-revenue.ts` (132 lines, 1
route, real, confirmed complete — see §0.1).
Schema: `lib/db/src/schema/msp.ts:1564-1606` (`mspSubscriptionsTable`), `msp.ts:3529-3557`
(`mspSalesBundlesTable`), `msp.ts:3563-3592` (`mspSalesBundleAssignmentsTable`),
`lib/db/src/schema/index.ts:471-497+` (`servicesTable`).
Money helper: `artifacts/api-server/src/lib/msp-plan-pricing.ts:39-43` (`monthlyPriceCentsOf`,
re-imported here, not re-implemented).
MSP-id resolution: `artifacts/api-server/src/lib/resolve-msp-id.ts:75-77`
(`resolveMspIdStrict`).
Sibling surface (real writer of the fields this route reads):
`artifacts/api-server/src/routes/msp-sales-bundles.ts` — see §3.

**Real DB state at pack time** (local `DATABASE_URL`, `psql`, 2026-09-10): `msp_subscriptions`
— **1 row**, `msp_id=1626` → `service_id=131`. Same synthetic regression-test fixture the
sibling Billing pack (#2607, §Real DB state) already documented (`contact_email=
'regression-testbed@example.com'`, Stripe ids `sub_regression_testbed`/`cus_regression_testbed`)
— **not a real customer's tier subscription**, and `service_id=131` ("M365 Launch Control —
Plus Add-On") is a non-tier add-on with `price` and `annual_price_cents` both **NULL**. There
are 3 real platform tiers (Free `120`, Growth `121`, Pro `122`), but **zero live subscriptions
point at any of them** — see §7. `msp_sales_bundles` — **1 row**, `msp_id=1` (Shane's own real
org, "Shane McCaw Consulting"), status `active`, `internal_cost_cents=0`,
`resale_price_cents=0`. `msp_sales_bundle_assignments` — **0 rows, system-wide** — see §7.2.

---

## 0. What this surface is, and what it is not

**One MSP's own view of its own money, split into two clearly separated, never-conflated
sections** (the route file's own header, `:1-19`, states this explicitly and is the actual
spec, not paraphrased here):

- **`wholesaleSpend`** — real, Stripe-verified: what *this* MSP pays the platform
  (`mspSubscriptionsTable`, scoped to the caller's own `mspId` only, via `resolveMspIdStrict`).
- **`pricingWorksheet`** — the MSP's own self-declared resale prices on their Sales Bundles
  (`mspSalesBundlesTable.resalePriceCents`). **Never charged via this platform, never
  reconciled against a real invoice.** Returned only as a clearly-labeled worksheet
  (`disclaimer` string, `:105-108`), never presented as verified revenue.

**Why the split exists at all — a locked architectural fact, not a gap this surface papers
over.** The route's own header (`:5-9`) states the investigation finding directly: this
platform's architecture has MSPs invoice their own end customers entirely **outside** the
platform. There is no Stripe-verified or invoiced record anywhere in this codebase of what an
MSP actually charges its own customers. So `pricingWorksheet` is deliberately never called
"revenue" on the wire or in its own disclaimer text — it is a planning worksheet built from
numbers the MSP typed in, not a verified financial record.

**Role gate is `requireRole("MSPAdmin")`** (`:43`), the same floor as the sibling Billing
surface (#2607 pack, §0) — `PlatformAdmin` can call this route too (role hierarchy is a floor,
not an exact match, per `requireAuth.ts:81-89`), `MSPOperator` cannot.

### 0.1 Completeness — confirmed, not assumed from line count

Read in full (132 lines, 1 route, `:43-130`). No genuine incompleteness markers found: no
`TODO`, no stub branch, no unimplemented conditional. Both queries execute fully, both result
shapes are fully built, both are returned in one `res.json()` call (`:125`). The one `try/catch`
wraps the whole handler and 500s cleanly on any DB/unexpected error (`:126-129`) — no swallowed
failure, no partial-success path. **Genuinely complete**, same conclusion the issue body asked
this pack to confirm rather than assume.

Git history confirms it: one commit ever touched this file — `9a3f159d8` ("MSP Partner Revenue
View", 2026-07-20), the route's origin commit, never modified since. No test file exists for
`msp-partner-revenue.ts` — not a completeness defect (the route works and is read end-to-end
by this pack against live data), but noted honestly rather than left implicit.

### 0.2 The endpoint and its real consumer — a former one, deleted, not a never-built one

| Endpoint | Method | Route file:line | Consumed by (verified) | Orphaned? |
|---|---|---|---|---|
| `/api/msp/billing/revenue` | GET | `msp-partner-revenue.ts:43-130` | **Nothing found, today** | **Yes — but see below** |

`grep -rn "billing/revenue\|partner-revenue\|PartnerRevenue\|wholesaleSpend\|pricingWorksheet"`
across every `artifacts/*/src` finds only the route file itself and its `routes/index.ts`
mount (`:156,486`). **This is a different shape of orphan than the sibling Billing pack's
(#2607 §0.1) "no consumer ever existed."** The origin commit `9a3f159d8` shipped this route
**together with a real 232-line consuming page**: `artifacts/msp-portal/src/pages/revenue.tsx`,
wired into `artifacts/msp-portal/src/App.tsx` (+4 lines) and touching
`artifacts/msp-portal/src/pages/settings-billing.tsx` (+8/-2), per the commit's own message
("plus a msp-portal /settings/revenue page") and its real diffstat (5 files, 378 insertions).
That page was never ported forward — it was deleted wholesale when `artifacts/msp-portal` was
retired in favor of `artifacts/portal` (commit `f40438cdc`, "Portal scaffolding: create
artifacts/portal, retire artifacts/msp-portal", #1673). `artifacts/msp-console`
(today's real home for an MSP-operator-role page like this one, since the route requires
`MSPAdmin`, not `CustomerUser`) exists as a scaffolded app but its `src/pages/` holds only
`index.tsx` and `not-found.tsx` — no page has been rebuilt there for this route.

**This is not a new finding to file.** The rebuild is already tracked: **#2609** ("Billing:
wire the MSP Console UI to the real endpoints", open, blocked on **#2608**'s Design export,
`Part of #1692` Feature: Billing MSP Console) exists precisely to wire this and its sibling
Billing routes into the new `artifacts/msp-console` app once Design produces the export. The
deleted `revenue.tsx`'s own 232 lines are real prior art for whoever picks up #2609/#2608 (the
disclaimer copy for the pricing worksheet, and the CURRENT/DECIDED-relevant split it rendered),
but are not resurrectable as-is — `artifacts/msp-portal` no longer exists and the page targeted
an app shape #1673 retired.

---

## 1. Wire contract — the one route, verbatim

### 1.1 `GET /api/msp/billing/revenue` (`:43-130`)

No query parameters, no request body. `mspId` resolved via `resolveMspIdStrict(req)` — 400
`"No MSP context"` if absent (`:46`).

```ts
// Response shape, res.json() call site msp-partner-revenue.ts:125 — reconstructed
// field-by-field: wholesaleSpend built :49-79, pricingWorksheet built :84-123. Not a
// named interface in the source.
interface WirePartnerRevenue {
  wholesaleSpend: {
    tierName: string;                    // services.name, via inner join on serviceId
    status: MspSubscriptionStatus;       // see §2
    dunningState: MspDunningState | null;
    billingInterval: "month" | "year";
    monthlyCostCents: number | null;     // derived, see §4 — monthlyPriceCentsOf(services.price)
    annualPriceCents: number | null;     // services.annual_price_cents, raw cents, no conversion
    currentPeriodStart: string | null;   // ISO
    currentPeriodEnd: string | null;     // ISO
    activeTenantCount: number;           // msp_subscriptions.tenant_count_snapshot
  } | null;                              // null when the caller's mspId has no msp_subscriptions row at all — see §5
  pricingWorksheet: {
    disclaimer: string;                  // fixed string, :105-108 — see §0
    bundles: Array<{
      bundleId: string;                  // uuid
      name: string;
      status: "active";                  // this route only ever selects status='active' bundles — see §6
      activeAssignmentCount: number;     // count(*) filter (where assignment.status = 'active')
      resalePriceCentsPerUnit: number;
      internalCostCentsPerUnit: number;
      worksheetMonthlyResaleCents: number;   // resalePriceCentsPerUnit * activeAssignmentCount
      worksheetMonthlyCostCents: number;     // internalCostCentsPerUnit * activeAssignmentCount
      worksheetMonthlyMarginCents: number;   // (resale - internalCost) * activeAssignmentCount
    }>;
  };
}
```

**`wholesaleSpend` query** (`:49-79`): `mspSubscriptionsTable` inner-joined to `servicesTable`
on `servicesTable.id = mspSubscriptionsTable.serviceId`, filtered to the caller's own `mspId`,
`.limit(1)` (the schema-level `.unique()` on `mspId`, `msp.ts:1567`, makes this at-most-one row
by construction, not just by the query). **No `fulfillmentType`/`fulfillmentTypeKey` filter
anywhere in this query** — unlike the sibling Billing surface's `/msp/plan/available` and
`/msp/plan/change` (#2607 pack §7), this route joins on `serviceId` alone, so it is **not**
subject to that surface's confirmed `fulfillmentType` vs `fulfillmentTypeKey` bug (#2701). It
will correctly resolve whatever `serviceId` the subscription row actually points at, tier or
not — which is exactly why it surfaces the *fact* that the one live row points at a non-tier
add-on (§7) rather than silently 404ing or filtering it out.

**`pricingWorksheet` query** (`:84-102`): `mspSalesBundlesTable` left-joined to
`mspSalesBundleAssignmentsTable` on `bundleId`, filtered to the caller's own `mspId` **and**
`mspSalesBundlesTable.status = 'active'` (`:98-101`), grouped by bundle, with
`activeAssignmentCount` computed via a SQL `filter (where assignment.status = 'active')`
aggregate (`:91`) — draft and archived bundles never appear in the worksheet at all, and a
bundle's *revoked*/*suspended* assignments are counted in the join but excluded from the
`activeAssignmentCount` aggregate (they still exist as rows, just filtered out of the count).

---

## 2. Real enum unions

| Vocabulary | Values | DB-enforced? | Status |
|---|---|---|---|
| `MspSubscriptionStatus` | `trialing`, `active`, `past_due`, `canceled`, `unpaid` | Yes — `text({ enum: MSP_SUBSCRIPTION_STATUSES })`, `msp.ts:1585` | CURRENT — read-only on this surface |
| `MspBillingInterval` | `month`, `year` | Yes — `text({ enum: MSP_BILLING_INTERVALS })`, `msp.ts:1577` | CURRENT — read-only on this surface |
| `MspDunningState` | `reminder_sent`, `suspended`, `access_revoked`, `archival_flagged`, or `null` = fully operational (`msp.ts:1588-1589` comment) | Yes — `text({ enum: MSP_DUNNING_STATES })`, `msp.ts:1590` | CURRENT — read-only |
| `MspSalesBundleStatus` | `draft`, `active`, `archived` | Yes — `text({ enum: MSP_SALES_BUNDLE_STATUS })`, `msp.ts:3529,3544` | CURRENT — this route only ever reads the `active` slice (§1.1, §6) |
| `MspBundleAssignmentStatus` | `active`, `suspended`, `revoked` | Yes — `text({ enum: MSP_BUNDLE_ASSIGNMENT_STATUS })`, `msp.ts:3563,3574` | CURRENT — this route only counts the `active` slice into `activeAssignmentCount` |

No "revenue category," "currency," or "billing period" enum exists on this surface beyond the
above — `monthlyCostCents`/`annualPriceCents`/the worksheet's per-bundle cents fields are all
plain integers, not tagged with a period or currency code (see §4).

---

## 3. Cross-surface edges

### 3.1 `msp-sales-bundles.ts` is the real writer of every field this route reads on the worksheet side

This route **never writes** `mspSalesBundlesTable` or `mspSalesBundleAssignmentsTable` — it is
purely a read. The actual CRUD surface, itself real, complete, and also currently
UI-orphaned (same §0.2 shape — `grep -rln "sales-bundles" artifacts/*/src` finds no consumer
outside its own route/test files), is `artifacts/api-server/src/routes/msp-sales-bundles.ts`:

| Endpoint | Method | Line | Relevance to this pack |
|---|---|---|---|
| `/msp/sales-bundles` | POST | `:281` | Creates a bundle; computes `internalCostCents` (`:326`) as the sum of `platformCostCents` across the bundle's `monitoringPackageKeys` — never hand-entered by the MSP |
| `/msp/sales-bundles/:bundleId` | PATCH | `:412` | Updates a bundle; recomputes `internalCostCents` (`:450-468`) only when `monitoringPackageKeys` changes, otherwise leaves `existing.internalCostCents` as-is — `resalePriceCents` is the one field the MSP actually sets by hand |
| `/msp/sales-bundles/:bundleId/assignments` | POST | `:613` | Creates an `active` assignment — the row this pack's `activeAssignmentCount` aggregate counts |
| `/msp/sales-bundles/:bundleId/assignments/:assignmentId` | DELETE | `:711` | Revokes an assignment (moves it out of the `active` count) |

So `internalCostCents` is **platform-computed, not MSP-declared** — only `resalePriceCents` is
the MSP's own number. This route's `pricingWorksheet.disclaimer` (§0) covers the resale side
explicitly; it does not separately call out that the cost side is platform-derived, though the
field name (`internalCostCentsPerUnit`) makes the distinction legible on the wire.

### 3.2 `msp-plan-pricing.ts` — money-unit helper shared with the sibling Billing surface, not re-implemented

`monthlyPriceCentsOf()` (`msp-plan-pricing.ts:39-43`) is imported here (`:32`), not
copy-pasted — the exact same function the sibling `/msp/plan/current` and `/msp/plan/available`
routes use (#2607 pack §4). Same behavior: `Math.round(parseFloat(price) * 100)`, and only when
the parsed result is finite and `> 0` — a `0`/negative/unparseable price becomes `null`, not
`0`. One shared implementation, two call sites; a future change to rounding/units behavior
would move both surfaces together.

### 3.3 `msp-financial-aggregator.ts` — a different, platform-wide revenue surface, not this one

Confirmed by name collision risk only (#2857, closed: "msp-financial-aggregator.ts:
invoice-derived revenue off by 100x") — that file and this route are unrelated. This route is
strictly **per-MSP, self-scoped** (`resolveMspIdStrict`); the aggregator and
`admin-panel/src/pages/Analytics.tsx`'s `/api/analytics/revenue/forecast` are
platform-operator-facing, cross-MSP views. No shared code, no shared query, cited here only so
Design does not conflate "MSP's own revenue view" with "platform's revenue analytics" — they
are built by different teams of routes entirely.

---

## 4. Money contract

Same units split as the sibling Billing surface, because the same underlying `servicesTable`
columns are read (#2607 pack §4, restated here for this surface's own field list):
`servicesTable.price` is a legacy `numeric(10,2)` in **dollars**; `annualPriceCents` is
integer **cents**. `monthlyCostCents` is always normalized to cents via `monthlyPriceCentsOf()`
(§3.2); `annualPriceCents` passes through raw, already cents, no conversion. The worksheet's
four bundle money fields (`resalePriceCentsPerUnit`, `internalCostCentsPerUnit`,
`worksheetMonthlyResaleCents`, `worksheetMonthlyCostCents`, `worksheetMonthlyMarginCents`) are
all integer cents natively at rest (`msp.ts:3541,3543`) — no unit conversion happens on this
side of the response at all. There is no currency field anywhere on this surface; every value
is implicitly USD, matching the rest of the platform's Stripe integration (`currency: "usd"`
hardcoded in `msp-plan-pricing.ts:120`, per #2607 pack §4).

---

## 5. Honest-empty / tri-state contract

- **No `msp_subscriptions` row for the caller's `mspId`**: `wholesaleSpend` is the JSON literal
  `null` (`:67-79`, the ternary's false branch) — HTTP 200, not 404, not `{}`. Confirmed as the
  real live state for `mspId=1` (Shane's own org) today: it has 0 `msp_subscriptions` rows (the
  one live row belongs to `mspId=1626`, the regression-testbed org) — so calling this route as
  `mspId=1` returns `wholesaleSpend: null` on real data, not a synthetic example.
- **No active sales bundles for the caller's `mspId`**: `pricingWorksheet.bundles` is `[]`, not
  omitted — the `disclaimer` string is still always present even when `bundles` is empty.
- **`dunningState: null`** means "fully operational," the same tri-state semantics as the
  sibling Billing surface (#2607 pack §5) — not one of the four enum strings plus a separate
  boolean.
- **`activeAssignmentCount: 0`**: on live data today this is **every** bundle's real count
  system-wide (§7.2) — a genuinely-zero worksheet and "no bundle has ever had an assignment
  created against it yet" are indistinguishable on the wire; there is no separate signal for
  "this bundle type has never been assigned" vs. "every assignment was revoked."

---

## 6. The forbidden list — declared, not merely absent

1. **This route never writes anything.** No `INSERT`, `UPDATE`, or `DELETE` anywhere in the
   file — purely a two-query read, confirmed by full read of all 132 lines.
2. **Draft and archived bundles never appear in the worksheet, even to their owning MSP**
   (§1.1) — the `status = 'active'` filter is unconditional; there is no query parameter or
   role-based override to see a draft bundle's worksheet numbers through this endpoint.
3. **`pricingWorksheet` numbers are never presented as verified revenue** — the `disclaimer`
   string is a fixed part of every response, not conditional on any flag.
4. **No cross-MSP aggregation, ever.** Both queries filter to the caller's own `mspId`; there
   is no code path on this route that returns another MSP's `wholesaleSpend` or bundles, and no
   `PlatformAdmin`-only "view any MSP's revenue" variant exists on this file.
5. **No pagination, filtering, or date-range parameter of any kind.** The route accepts no
   query string at all — `wholesaleSpend` is always the single current-state row (or `null`),
   `pricingWorksheet.bundles` is always the full active-bundle set for the MSP, unfiltered by
   time.

---

## 7. Confirmed live-data facts — not filed as findings (see reasoning per item)

**The one live `msp_subscriptions` row does not point at a real platform tier, so
`wholesaleSpend.tierName` on live data today reads `"M365 Launch Control — Plus Add-On"`, and
`monthlyCostCents`/`annualPriceCents` are both `null`.** Verified directly:

```
psql> SELECT id, msp_id, service_id, status, billing_interval FROM msp_subscriptions;
 id | msp_id | service_id | status | billing_interval
----+--------+------------+--------+-------------------
  1 |   1626 |        131 | active | month

psql> SELECT id, name, price, annual_price_cents, fulfillment_type FROM services WHERE id = 131;
 id  |               name                | price | annual_price_cents | fulfillment_type
-----+-----------------------------------+-------+---------------------+-------------------
 131 | M365 Launch Control — Plus Add-On |       |                     | standard
```

**Not a bug in this route, and not filed.** This is the exact same live row the sibling Billing
pack (#2607) already documented and traced to a known cause: `mspId=1626` is the
`regression-testbed-msp` org (per #2607 pack, created for billing-lifecycle regression testing),
not a real customer, and `service_id=131` is a non-tier add-on service (`fulfillmentType=
"standard"`), not one of the platform's 3 real tiers. This route's own query has no
`fulfillmentType` filter (§1.1) and so is not exposed to #2607's own filed bug (#2701) — it
correctly reports whatever the row actually points at. The `null` cost fields are the honest
consequence of that add-on service having no `price`/`annual_price_cents` set, not a defect in
this route's normalization logic (§4's `monthlyPriceCentsOf` correctly returns `null` for an
unparseable/absent price by design).

### 7.2 Zero live bundle assignments, system-wide — an honest-empty state, not a bug

```
psql> SELECT count(*) FROM msp_sales_bundle_assignments;
 count
-------
     0
```

Every bundle's `activeAssignmentCount` is `0` on live data today, for every MSP, because no
assignment row has ever been created anywhere in this database. This is §5's honest-empty
contract working as designed, not a query defect — confirmed by reading the aggregate SQL
(`:91`) directly rather than inferring it from the empty result.

### 7.3 The one live sales bundle's own numbers are also both zero

```
psql> SELECT bundle_id, msp_id, name, status, internal_cost_cents, resale_price_cents
      FROM msp_sales_bundles;
              bundle_id               | msp_id |               name               | status | internal_cost_cents | resale_price_cents
--------------------------------------+--------+-----------------------------------+--------+----------------------+---------------------
 2d9dc63f-1c05-4e21-a7af-32a7defedc44 |      1 | Customer Dashboard Category Tabs | active |                    0 |                   0
```

`msp_id=1` is Shane's own real MSP org ("Shane McCaw Consulting"), not a synthetic fixture — so
this is the one row that would render if `wholesaleSpend`'s caller and this bundle's owner were
the same request. Both cost fields are genuinely `0` on this row (not `null` — the columns
default to `0`, `msp.ts:3541,3543`), which the route's own math handles correctly (every
`worksheetMonthly*Cents` field would compute to `0`, not throw or divide). Not flagged as a
defect: `0`/`0` produces `worksheetMonthlyMarginCents = 0`, a mathematically honest "no margin
configured yet," not a wrong number. The bundle's own name — "Customer Dashboard Category
Tabs" — reads like a UI-feature name rather than a monitoring-package sales bundle name; noted
here as an observation for whoever next touches `msp_sales_bundles` seed/test data, not filed
as a finding (no code defect, just an odd-looking but real row).

---

## 8. Open gaps — NOT decided (do not resolve; flag)

1. **No UI exists yet for this route** (§0.2) — already tracked by open #2609 (blocked on
   #2608's Design export), `Part of #1692`. Design should treat the deleted
   `artifacts/msp-portal/src/pages/revenue.tsx` (232 lines, commit `9a3f159d8`, git history
   only — not present on any current branch) as historical color, not a resurrectable
   artifact: the app shape it targeted no longer exists (#1673).
2. **No test file exists for `msp-partner-revenue.ts`** (§0.1) — not filed as a finding per
   this project's own bar (a missing test is not one of the enumerated finding categories), but
   noted honestly since every other route this pack cites (`msp-sales-bundles.ts`,
   `msp-plan-self-service.ts`) does have one.
3. **The worksheet's `internalCostCentsPerUnit` being platform-computed vs. `resalePriceCentsPerUnit`
   being MSP-declared (§3.1) is not distinguished anywhere in the wire response itself** — only
   in `msp-sales-bundles.ts`'s own write-side logic. A future UI (#2609) would need to either
   duplicate that distinction in its own copy or accept that both numbers look equally
   "the MSP's own" on this route's response shape alone.

---

## 9. Provenance

Extracted 2026-09-10 against branch `agent/3368-q2101`, a new pack — no prior version of this
surface's contract existed (confirmed: `docs/msp-console/` has no `partner-revenue*` or
`revenue*` file before this one). Full read of `msp-partner-revenue.ts` (132 lines, its one
route), `msp-sales-bundles.ts` (contrast/writer surface, all 11 route declarations located and
line-cited), `msp-plan-pricing.ts` (`monthlyPriceCentsOf`, shared not reimplemented), and the
Drizzle schema (`lib/db/src/schema/msp.ts:1564-1606,3529-3592`, `index.ts:471-497+`). Live DB
state confirmed via direct `psql` against local `DATABASE_URL`: 1 `msp_subscriptions` row
(`msp_id=1626`, regression-testbed org, pointed at a non-tier add-on, `price`/
`annual_price_cents` both NULL), 3 real platform tiers (120/121/122, none subscribed-to), 1
`msp_sales_bundles` row (`msp_id=1`, Shane's real org, both cost fields genuinely `0`), 0
`msp_sales_bundle_assignments` rows system-wide. Consumer sweep:
`grep -rn "billing/revenue\|partner-revenue\|PartnerRevenue\|wholesaleSpend\|pricingWorksheet"`
across `artifacts/*/src` found zero live callers; git history traced the route's origin commit
(`9a3f159d8`) to confirm it originally shipped with a real 232-line consuming page
(`artifacts/msp-portal/src/pages/revenue.tsx`) that was deleted, not never-built, when
`artifacts/msp-portal` was retired (`f40438cdc`, #1673) — the rebuild is already tracked by open
#2609/#2608 under #1692, so no new issue was filed for the orphan itself. No other genuine
defect was found; §7's live-data facts are the honest consequence of known, already-documented
fixture state (#2607's regression-testbed org), not new bugs in this route. Zero new issues
filed — every gap found either has an existing open issue already covering it (#2609/#2608/
#1692) or does not meet this project's finding bar (§8). Read-only pass: no product code,
schema, or UI was changed.
