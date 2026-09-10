# Marketplace Purchase (MSP Console) — contract extraction pack

**#3367**, parented directly under #1571 (EPIC: Portal Admin — MSP-side operator surface) —
#3367 itself has no more specific Feature-tier parent (`gh issue view 3367 --json parent` returns
#1571 directly).

Real, confirmed backend, no pack existed for this surface until now — `docs/msp-console/` has 25
other packs, none of which cover `msp-marketplace-purchase.ts`; it is mentioned nowhere in that
directory except as a cross-referenced sibling file name. Extracted to the same standard as the
existing packs (§11 lists the one most structurally similar, the Sales Offers and Sales Bundles
pack, #3357): read-only, every field cited to file:line, cross-checked live against local
PostgreSQL. **Nothing here is authored or invented.**

Backend: one file, 2 routes, both live and mounted (`artifacts/api-server/src/routes/index.ts:243,
607` — `import mspMarketplacePurchaseRouter from "./msp-marketplace-purchase"; ... router.use
(mspMarketplacePurchaseRouter);`):

- `artifacts/api-server/src/routes/msp-marketplace-purchase.ts` (451 lines) — MSP-staff-initiated
  purchase of a catalog item on a specific customer's behalf, reusing the customer-safe catalog
  shape from `portal-marketplace.ts` and the Card-on-File billing mechanics proven in
  `portal-checkout.ts`.

The issue's own body asks for a completeness check, "don't assume from line count alone." Ran it:
**not** genuinely half-built as a surface (both routes are complete, tested, reachable, and
mounted) — but real completeness auditing surfaced four confirmed, live-reachable bugs (§5), one
of them severe. The file is not incomplete; parts of what it calls are.

Schema: `lib/db/src/schema/index.ts:471` (`servicesTable`), `:3384` (`SALES_OFFER_STATES`), `:3397`
(`salesOffersTable`); `lib/db/src/schema/msp.ts:199` (`tenantsTable`), `:599`
(`mspStaffCustomerScopesTable`), `:1564` (`mspSubscriptionsTable`), `:1672`
(`TENANT_SUBSCRIPTION_BILLING_PARTIES`), `:1684` (`TENANT_SUBSCRIPTION_SOURCES`), `:1687`
(`tenantSubscriptionsTable`). Verified live against local PostgreSQL (`psql "$DATABASE_URL"`
against `services`, `sales_offers`, `msp_subscriptions`, `fulfillment_types`) — every claim in §4
and §5 below was confirmed against real rows, not just the Drizzle source; §5a/§5b/§5c were **only
discoverable live**, cross-referencing catalog data and the `fulfillment_types` table neither route
file itself displays.

Sources read in full: `msp-marketplace-purchase.ts` (451 lines) + `msp-marketplace-purchase.test.ts`
(336 lines, all 9 suites — real, comprehensive coverage of the two routes' own logic; it does not
and could not catch §5's findings, which are about behavior the route's own contract never asserts
against, not behavior the tests get wrong). Cross-referenced for cross-surface edges:
`portal-marketplace.ts` (`CUSTOMER_SERVICE_TYPES`, `toMarketplaceService`, `MarketplaceService`),
`requireAuth.ts` (`requireRole`, `assertCustomerAccess`, `isCustomerBlockedByStaffScope`,
`resolveStaffScopedCustomerIds`), `catalog-pricing.ts` (`resolveCatalogPricing`,
`DEFAULT_WHOLESALE_MARGIN`), `resolve-fulfillment.ts` (full read, both exported types + the
resolver body), `tenant-billing-state.ts` (`recordTenantSubscription`, the billing-party/source
enums), `stripe.ts` (`getStripeKey`, `getMspDefaultPaymentMethod`), `audit.ts` (`createAuditLog`),
`sse-channels.ts` (`broadcastCustomerOfferChange`, `broadcastMspOfferChange`), `portal-checkout.ts`
(re-read for §5's cross-file comparison of the same `resolveFulfillment` call and the
`allowFreeCheckout` gate), the Sales Offers and Sales Bundles pack (#3357, for §3's cross-surface
"paths to accepted" table this pack extends).

---

## 0. The surface and its consumers

### 0.1 Consumer map

| Endpoint | Method | Line | Consumer today | Status |
|---|---|---|---|---|
| `/api/msp/customers/:customerId/marketplace/catalog` | GET | `:99` | none | live, zero UI callers |
| `/api/msp/customers/:customerId/marketplace/checkout` | POST | `:134` | none | live, zero UI callers |

**Both routes are genuinely unconsumed today** (§6) — but not because they were never wired.
`git log --oneline --follow` on this file's own history shows its introducing commit
(`1b0cbefe6`, "MSP Purchase-for-Customer") *also* added 157 lines to
`artifacts/msp-portal/src/pages/customer-detail.tsx` — a real UI caller existed once. That whole
app was later retired wholesale (`f40438cdc`, "Portal scaffolding: create artifacts/portal, retire
artifacts/msp-portal") and its pages, including that caller, went with it — not a case of "never
wired," but "wired, then its consumer app was deleted out from under it." The Epic #1571 surface
these routes actually belong to is `artifacts/msp-console`, which — same as the Sales Offers and
Sales Bundles pack (#3357) and the RBD pack (#2580) independently found for their own Features —
is still the bare #2668 scaffold: its one real page
(`artifacts/msp-console/src/pages/index.tsx`) is an explicit placeholder ("no chrome or pages
built yet... real surfaces land under Epic #1571 and Feature #2667"). No route in this file has a
live caller anywhere in the tree today — not `artifacts/msp-console`, not `artifacts/portal` (the
current customer-facing app, unrelated to the retired `artifacts/msp-portal`), not
`artifacts/admin-panel`, not the retired `portal-v2` archive.

### 0.2 Scoping shape — correctly narrow, no `:mspId` override surface

Unlike the two files the Sales Offers and Sales Bundles pack (#3357 §0.2/§6b) found allowing a
`PlatformAdmin` `?mspId=` cross-MSP override on session-scoped routes, **neither route in this file
has an `mspId` anywhere in its own request surface** — no path segment, no query param, no body
field. `targetMspId` is resolved exclusively from the target customer's own row
(`tenantsTable.mspId`, `resolveScopedCustomer`, `:70-92`), and `resolveScopedCustomer` gates every
call through `assertCustomerAccess(req.user!, customerId)` (`requireAuth.ts:306-335`) — which for
an MSPAdmin/MSPOperator caller re-derives the tenant's `mspId` from the DB and compares it against
`user.mspId` independently (`requireAuth.ts:312-322`), then applies per-staff scoping
(`isCustomerBlockedByStaffScope`, `:326`). There is no code path in this file by which a caller
supplies or overrides the resolved `mspId` directly. Not a finding — a real, positive contrast to
the pattern §3357 flagged elsewhere in this same Epic.

One real inefficiency, not a bug: `resolveScopedCustomer`'s own `tenantsTable` lookup (`:75-79`)
and `assertCustomerAccess`'s internal ownership lookup (`requireAuth.ts:314-321`) both query the
same row for the same `customerId` on every request that reaches either route's handler body — 2
selects doing the same ownership check, plus a 3rd for the staff-scope check (the test file's own
header comment at `msp-marketplace-purchase.test.ts:10-13` documents this exactly: "3 selects
total for every request that reaches the handler body"). Acknowledged in the test file's own
comments, not filed.

---

## 1. Wire contract — `GET /api/msp/customers/:customerId/marketplace/catalog` (`:99-128`)

`requireRole("MSPOperator")`. `customerId` parsed from the path (`:104-105`, 400 on non-numeric),
then `resolveScopedCustomer` (`:70-92`, §0.2). Query: same `visibility = "public"` +
`serviceType ∈ CUSTOMER_SERVICE_TYPES` filter `portal-marketplace.ts`'s own catalog route uses
(`portal-marketplace.ts:52-57` — `assessment`, `monitoring_tier`, `micro_offer`, `retainer`),
ordered `sortOrder ASC, name ASC` (`:119`). **Always the fuller CustomerUser+ set, never narrowed
to `ASSESSMENT_SERVICE_TYPES`** — the file's own header comment (`:13-15`) states this is
deliberate: staff act on the customer's behalf, not as the customer, so the target customer's own
role tier never gates what an MSP operator can browse for them. Maps every row through the shared
`toMarketplaceService()` (`portal-marketplace.ts:99-154`) — the exact same customer-safe shape
`GET /api/portal/marketplace/catalog` returns, so this pack does not re-document that shape's own
legacy-price/per-seat resolution logic (already covered by that route's own comments, re-verified
current at `portal-marketplace.ts:99-154` for this pack). Response: `{services}`.

---

## 2. Wire contract — `POST /api/msp/customers/:customerId/marketplace/checkout` (`:134-448`)

`requireRole("MSPOperator")`. Body: `{serviceId: number}`. `customerId`/`serviceId` parsed and
400'd on non-numeric (`:138-142`), then `resolveScopedCustomer` (§0.2). No Zod schema — informal
`parseInt`/`isNaN` validation throughout, same tolerance for hand-rolled parsing the rest of this
codebase's MSP routes carry.

### 2.1 Catalog lookup and eligibility gates (`:148-190`)

Re-queries `servicesTable` scoped to the same `visibility = "public"` + `CUSTOMER_SERVICE_TYPES`
filter as §1 (`:148-158`) — 404 if the service doesn't resolve, so a `serviceId` outside the
customer-safe catalog (e.g. a private/internal-only service) can't be checked out through this
route even with a guessed id. Three real gates, all pre-existing `422`s with no bypass:

- **`serviceClass === "project"`** (`:163-170`) — rejected with a message directing the customer
  to complete it themselves, because project-class items require a signed Statement of Work
  through the *customer's own* signature flow (`portal-checkout.ts`), which an MSP staffer cannot
  complete on the customer's behalf. Declared, not silent — the file's own header comment
  (`:26-30`) states this is an explicit boundary, not a gap.
- **`marketplaceShape.priceCents === null`** (`:172-176`) — "priced on consultation," no fixed
  checkout price.
- **`marketplaceShape.perSeat`** (`:177-189`) — rejected with a comment (`:177-181`) explaining
  exactly why: a per-seat rate (e.g. a $8.00/mo monitoring-tier per-user price) would otherwise be
  charged as if it were the total for the whole subscription. Real, deliberate, and — per §4 below
  — the one class boundary in this file that actually is airtight for the catalog rows it's meant
  to catch.

### 2.2 Offer recording (`:195-231`)

Inserts a real `sales_offers` row (`:200-222`) — `state: "accepted"`, `sentAt`/`acceptedAt` both
stamped `now`, `engineSnapshot: {initiatedBy: "msp_staff", staffUserId, staffEmail}` — a **raw
insert**, not a call through `transitionOfferState()` (the Sales Offers pack's §2/§4, #3357). This
is a fourth real path to `sales_offers.state = "accepted"`, alongside that pack's own
three-path table (`msp-sow.ts`'s raw `UPDATE`, `portal-offers.ts`'s
`transitionOfferState()` + fulfillment, `msp-sales-offers.ts`'s `transitionOfferState()`-only PATCH)
— this one a raw `INSERT` rather than `UPDATE`, and (like `msp-sow.ts`'s path) it never writes a
`sales_offer_events` row, since `emitOfferEvent()` is never called. **Immediately after the insert,
both SSE channels are broadcast unconditionally** (`:230-231`,
`broadcastCustomerOfferChange`/`broadcastMspOfferChange`) — **before any payment has been
attempted**. This ordering is the root cause of §5a, the most severe finding in this pack.

### 2.3 Free (`$0`) path (`:234-264`)

Skips Stripe entirely. Calls `resolveFulfillment()` if `svc.fulfillmentTypeKey` is set (`:235-247`,
return value discarded — see §5c), writes a real `createAuditLog` row
(`actionType: "msp.marketplace.purchase_for_customer"`, `:249-259`), responds `201`
`{outcome: "free_activated", offerId, message}`. **No `allowFreeCheckout` check** — see §5d.

### 2.4 Paid path (`:266-446`)

`getStripeKey()` (`:268-274`) — 503 if Stripe isn't configured for the environment. Looks up the
target MSP's own `mspSubscriptionsTable.stripeCustomerId` (`:280-290`, 400 if absent) and its
default payment method via `getMspDefaultPaymentMethod()` (`:292-296`, 400 if absent — every real
error branch here returns before touching Stripe, the safe half of this route). `resolveCatalogPricing()`
(`catalog-pricing.ts:70-...`, `DEFAULT_WHOLESALE_MARGIN = 0.70`) computes the wholesale charge from
`svc.internalCostCents`, defaulting to 70% of retail when unset (§6, live data).

- **`serviceClass === "subscription"`** (`:305-375`) — creates a real Stripe Product + Subscription
  against the MSP's saved card, 402s on a non-`active`/`trialing` result, then (Git #2847,
  `:348-375`) calls `recordTenantSubscription()` (`tenant-billing-state.ts:419-...`,
  `billingParty: "msp"`, `source: "msp_marketplace"` — a real, first-class, documented member of
  `TENANT_SUBSCRIPTION_SOURCES`, `msp.ts:1678-1679`: *"`msp_marketplace` —
  `routes/msp-marketplace-purchase.ts`, staff-initiated card-on-file purchase made for a
  customer"* — this route is a named, intended caller of that table, not an incidental one).
  Wrapped in its own `try/catch` (`:348-375`) that only logs on failure — correctly non-fatal,
  since the charge has already succeeded by that point.
- **Else** (`:376-399`) — a one-time `stripe.paymentIntents.create()`, `off_session: true`,
  `confirm: true`. 402s on a non-`succeeded` result. **This is the only billing branch a
  `serviceClass: "retainer"` item can reach — see §5b.**

Both branches converge on a shared `resolveFulfillment()` call (`:401-417`, return value discarded
— §5c), a `createAuditLog` row (`:419-429`), and a `201` response (`:436-442`) reporting
`outcome: "payment_processed"`. The outer `catch` (`:443-446`) logs and 500s on any thrown
exception from the whole paid-path `try` block (`:279-442`) — **it, like every `apiErr(...); return;`
inside that block, never touches the `sales_offers` row created in §2.2.** See §5a.

---

## 3. Cross-surface edges

| Edge | Mechanism | Notes |
|---|---|---|
| Fourth real path to `sales_offers.state = "accepted"` | Raw `INSERT` (`:200-222`), bypassing `transitionOfferState()` entirely | Extends the Sales Offers and Sales Bundles pack's own three-path table (#3357 §4) to four; like `msp-sow.ts`'s path, writes no `sales_offer_events` row |
| `msp_marketplace` billing source | `tenant-billing-state.ts` (`TENANT_SUBSCRIPTION_SOURCES`, `msp.ts:1678-1679`) | This route is the enum's own named, documented origin — real, intentional wiring, not incidental |
| `resolveFulfillment()` shared with `portal-checkout.ts` | Same function, two call sites | `portal-checkout.ts:930-955` captures the return value and logs it (`log.info({result, ...})`); this file's two call sites (`:236`, `:402`) discard it entirely — see §5c |
| Catalog reuse | `CUSTOMER_SERVICE_TYPES` / `toMarketplaceService()` from `portal-marketplace.ts` | Not forked — imported directly (`:59`), confirmed identical shape for both files |
| Retired UI caller | `artifacts/msp-portal/src/pages/customer-detail.tsx` (deleted with the whole app, `f40438cdc`) | §0.1 — a real, historical consumer, not a "never wired" gap |

---

## 4. Real enum unions — declared vs. live

| Vocabulary | Declared | Where fixed | Live values (`SELECT DISTINCT service_class FROM services`) | Enforced by |
|---|---|---|---|---|
| `services.service_class` | `project`, `add_on`, `subscription` | `index.ts:545-547` | `add_on`, `project`, `subscription`, **`assessment`**, **`retainer`**, `NULL` (default `'standard'` never actually written) | Nothing — plain `text` column, **no DB CHECK constraint** (confirmed live: no check constraint listed in `\d services`), TS enum is compile-time only and is silently violated by real rows |

Live counts (public, customer-safe catalog only): 19 `assessment`-type rows carry
`service_class = "assessment"` (+1 with `service_class` `NULL`, itself outside the declared
union), 6 `retainer`-type rows carry `service_class = "retainer"`, 12 `monitoring_tier` rows
correctly carry `subscription`. **Both off-enum values are real, live, and reachable through this
route's own catalog** — `assessment` and `retainer` are both members of `CUSTOMER_SERVICE_TYPES`
(§1), so both are returned by the GET route and checkoutable by the POST route today. Neither 422s
at the `serviceClass === "project"` gate (§2.1) since neither equals `"project"` — they fall
through as if they were `"add_on"`, which is where §5b/§5c's findings originate.

---

## 5. Findings

### 5a. A failed or unconfigured paid checkout leaves a permanently `"accepted"` sales offer, already broadcast to the customer, with no charge collected and no audit trail

**The most severe finding in this pack.** §2.2's `sales_offers` insert (`:200-222`,
`state: "accepted"`) and its unconditional SSE broadcast (`:230-231`) both run **before** the paid
path (§2.4) makes any attempt to charge Stripe. Every one of that path's five real failure exits —
Stripe not configured (`:268-274`, 503), no saved Stripe customer id (`:287-290`, 400), no default
payment method on file (`:293-296`, 400), a non-`active`/`trialing` subscription result
(`:325-328`, 402), a non-`succeeded` PaymentIntent result (`:394-397`, 402) — plus the outer
`catch` covering any thrown exception (`:443-446`, 500), all `return`/fall through **without ever
touching the `sales_offers` row again.** Confirmed by a full read of the file: there is exactly one
`.insert(salesOffersTable)` call in this file (`:201`) and zero `.update(salesOffersTable)` calls.

Concrete consequence: an MSP whose saved card has expired (or whose `STRIPE_SECRET_KEY` is briefly
misconfigured, or whose subscription/PaymentIntent Stripe call fails for any reason) sees the
customer's own `/customer-offers` and `GET /api/portal/offers` surfaces show the item as
**accepted** — because `broadcastCustomerOfferChange` already fired and the row's `state` genuinely
is `"accepted"` — with **zero money ever collected** and **zero audit-log entry** (`createAuditLog`
is only called on the two success paths, `:249` and `:419`; the only trace of the failure is a
server-side `log.error`/`log.warn`, never written to `audit_logs`). Per the Sales Offers pack's own
engine documentation (#3357 §2, `VALID_TRANSITIONS.accepted = []`), `"accepted"` is terminal —
there is no code path anywhere in this codebase that transitions a `sales_offers` row back out of
`"accepted"`. The only fix at that point is a hand-run SQL correction, not anything either route
here or the generic `PATCH /msp/sales-offers/:id/state` endpoint can do.

Filed as **#3400**, parented under #1571, labeled `bug`.

### 5b. `serviceClass: "retainer"` catalog items (6 live rows) are charged once via a one-time PaymentIntent instead of a recurring Stripe Subscription

§2.4's branch selection is `if (serviceClass === "subscription") {...} else {...}` (`:305`) — the
`else` is a one-time `stripe.paymentIntents.create()` (§2.4). Per §4, 6 real, live, public catalog
rows (`Architect Essentials/Growth/Enterprise/Advisory Retainer`, `vCISO / Governance Retainer`,
`Copilot Governance Retainer` — ids 115–119, 168) carry `service_class = "retainer"` and
`billing_type = "recurring_monthly"`, priced $900–$5,500/mo (confirmed live,
`price_cents` 90000–550000). None of them equal `"subscription"`, so every one of them is routed
through the one-time branch: charged once, no Stripe Subscription ever created, and
`recordTenantSubscription()` — only called inside the `serviceClass === "subscription"` branch
(`:348-375`) — never runs, so no `tenant_subscriptions` row is ever written for this billing
party/source either. An MSP staffer buying a $4,500/mo vCISO retainer for a customer through this
route charges the MSP's card $4,500 exactly once and never again — the platform records no ongoing
subscription anywhere.

The same narrow `serviceClass === "subscription"` check (not widened to also catch
`billingType === "recurring_monthly"`) exists in `portal-checkout.ts:654` and `msp-sow.ts:347` —
this is not unique to this file. `portal-checkout-direct.ts:164` shows the platform already has the
wider, correct check elsewhere (`s.billingType === "recurring_monthly" || s.serviceClass ===
"subscription"`) — so a working pattern exists in this codebase, just not reused here. Not
cross-filed against those other two files (out of this pack's scope), but the missing case is real
and live-reachable through this specific route today.

Filed as **#3403**, parented under #1571, labeled `bug`.

### 5c. `fulfillmentTypeKey: "assessment"` (20 live catalog rows) matches no real `fulfillment_types` row — fulfillment silently never fires, and this route discards the signal that would say so

Live `fulfillment_types` has exactly 3 rows: `config_pack`, `monitoring_subscription`,
`project_sow` (confirmed, `psql`). Live `services.fulfillment_type_key` values among this route's
own reachable catalog (§4's `CUSTOMER_SERVICE_TYPES` set) are `assessment` (20 rows),
`monitoring_subscription` (12 rows — matches), `retainer` (6 rows — matches nothing, compounding
§5b). **20 of the 38 catalog rows reachable through this route's own GET/POST pair have a
`fulfillmentTypeKey` that resolves to `resolveFulfillment()`'s own `"unknown_type"` result**
(`resolve-fulfillment.ts:73-78`) every single time — no workflow event ever fires, nothing
provisions.

`resolveFulfillment()`'s own contract returns this outcome precisely so a caller can react to it —
`portal-checkout.ts:930-955` does react, at least minimally: it captures the result and logs it
(`log.info({result, offerId, ...}, "...resolveFulfillment completed...")`), so a silent no-op is at
least visible in that route's own logs as `status: "unknown_type"` rather than `"emitted"`. This
file's two call sites (`:236`, `:402`) call `resolveFulfillment()` with a bare `await` and never
inspect the return value at all — an MSP staffer purchasing any of the 20 `assessment`-typed
catalog items (including real, priced rows like "M365 Tenant Health Audit" at $3,500 or
"Compliance Framework Mapping Audit — ISO 27001" at $7,000) on a customer's behalf gets a `201`
response claiming success, a real charge on the MSP's card, an "accepted" offer — and, per this
route's own code, no signal anywhere (not a log line referencing the result, not the response body,
not the audit-log row) that the fulfillment step silently did nothing.

Filed as **#3404**, parented under #1571, labeled `bug`.

### 5d. The free (`$0`) path ignores `services.allow_free_checkout`

`portal-checkout.ts:326` gates its own free-activation branch on `amountCents === 0 &&
allowFreeCheckout` — a real, live Platform Admin control (`services.allow_free_checkout`, boolean,
default `true`) that lets an admin mark a `$0`-priced catalog row as *not* eligible for silent free
activation. §2.3's free path here checks only `amountCents === 0` (`:234`) — `allowFreeCheckout` is
never read anywhere in this file. Live today: all 3 real public `$0` rows (`Tenant Governance
Snapshot`, `Copilot Readiness Snapshot`, the `Free` platform tier) already have
`allow_free_checkout = true`, so no live purchase is affected right now — but the gate itself is
structurally absent from this route, not merely redundant, so the moment any future `$0` catalog
row is flagged `allow_free_checkout = false`, an MSP staffer can free-activate it for a customer
through this route with no block, bypassing a control the customer-facing path enforces. The file's
own header comment (`:19-21`) explains deliberately skipping the *rate-limiting* half of
`portal-checkout.ts`'s free path (a reasonable call — this is an authenticated staff action, not an
anonymous public one) but says nothing about the `allowFreeCheckout` catalog flag, which is a
distinct, product-level control rather than an anti-abuse one.

Filed as **#3405**, parented under #1571, labeled `bug`.

---

## 6. Orphaned-endpoint check

```
grep -rn "marketplace/catalog\|marketplace/checkout" --include="*.ts" --include="*.tsx" . \
  | grep -v node_modules | grep -v "routes/msp-marketplace-purchase.ts\|routes/portal-marketplace.ts\|\.test\.ts"
```

Real result: **zero live frontend callers of either route**, anywhere in the tree today — see §0.1
for why (a real caller existed once, in the now-retired `artifacts/msp-portal` app). This is the
same pre-#1571-wire state the Sales Offers and Sales Bundles pack (#3357) and the RBD pack (#2580)
both independently found for their own Features under this Epic.

---

## 7. Honest-empty / partial-data contract

- **`GET /api/msp/customers/:customerId/marketplace/catalog`**: an MSP with a real, in-scope
  customer and a catalog with rows always returns `{services: [...]}` — with 95 real public
  `services` rows live today and 38 of them matching `CUSTOMER_SERVICE_TYPES`, this is never
  observed empty in practice, but an empty `{services: []}` would be a real, honest empty state
  (the query has no fallback).
- **Live data today**: 95 public `services` rows total; 38 within this route's own
  `CUSTOMER_SERVICE_TYPES` filter (19 `assessment`-class assessments + 1 `NULL`-class assessment,
  6 `retainer`-class retainers, 12 `subscription`-class monitoring tiers); 0 `micro_offer`-typed
  rows exist at all (live, confirmed — the fourth member of `CUSTOMER_SERVICE_TYPES` is currently
  unpopulated, not a bug, just an empty category); exactly 1 real `msp_subscriptions` row with a
  non-null `stripe_customer_id` — the one MSP that could actually complete a paid checkout through
  this route today; 0 `sales_offers` rows exist yet with `engine_snapshot->>'initiatedBy' =
  'msp_staff'` — this route has never actually been exercised against live data (consistent with
  §6's zero-callers finding).
- **`POST .../checkout`**'s three `422` gates (§2.1) are real, deterministic rejections, not
  partial data — a `project`-class item, a consultation-priced item, and a per-seat item all
  produce a clear error with no side effect (confirmed by the test suite's own coverage,
  `msp-marketplace-purchase.test.ts:240-292`).

---

## 8. The forbidden list — declared, not merely absent

1. **No cross-MSP access.** §0.2 — neither route accepts an `mspId` from the caller at all; the
   target MSP is always derived from the target customer's own row, and per-staff scoping applies
   on every call.
2. **No self-serve purchase of a `project`-class item.** §2.1's first gate is airtight — a
   signature-gated SOW item can never be checked out through this route, only rejected with a
   clear message.
3. **No fabricated pricing.** `wholesaleCostCents`/`retailPriceCents` are always computed
   server-side via `resolveCatalogPricing()` from real `svc.internalCostCents`/catalog price
   columns (§2.4) — never a hardcoded price table, matching this codebase's standing
   no-hardcoding rule.
4. **No per-seat rate charged as a flat total.** §2.1's third gate exists specifically to prevent
   this — the one boundary in this file that fully covers what it's meant to (unlike §5b/§5c's
   `serviceClass`/`fulfillmentTypeKey` gaps).

---

## 9. Not covered by this pack

`portal-marketplace.ts`'s own `GET /api/portal/marketplace/catalog` route and
`toMarketplaceService()`'s internal legacy-price/per-seat resolution logic are read only to the
extent this file reuses them directly (§1) — that route's own contract (role-scoped catalog
narrowing for a customer's own self-serve browsing) is a separate surface with its own header
comment already documenting it, not re-derived here. `portal-checkout.ts`'s own full checkout
contract (Stripe Checkout Session flow, webhook completion, rate-limiting) is out of scope beyond
the two specific comparisons in §5c/§5d. `resolve-fulfillment.ts`'s own internal idempotency
mechanics beyond what's needed to confirm §5c (the `unknown_type` result path) are not
re-documented — already fully commented in that file itself. `catalog-pricing.ts`'s full pricing
resolver beyond `resolveCatalogPricing()` (the one function this file calls) is not opened further.

---

## 10. Provenance

Written 2026-09-10 against `main` (branch `agent/3367-q2100`), for #3367. Read in full:
`msp-marketplace-purchase.ts` (451 lines) + `msp-marketplace-purchase.test.ts` (336 lines, all 9
suites). Cross-referenced in full or in relevant part: `portal-marketplace.ts`, `requireAuth.ts`
(`requireRole`, `assertCustomerAccess`, `isCustomerBlockedByStaffScope`), `catalog-pricing.ts`,
`resolve-fulfillment.ts` (full read), `tenant-billing-state.ts` (`recordTenantSubscription` + the
billing-party/source enums), `stripe.ts` (`getStripeKey`, `getMspDefaultPaymentMethod`),
`audit.ts` (`createAuditLog`), `sse-channels.ts`, `portal-checkout.ts` (re-read for §5c/§5d),
`portal-checkout-direct.ts` (re-read for §5b's cross-reference to the wider, correct
`serviceClass`/`billingType` check), the Sales Offers and Sales Bundles pack (#3357, for §2.2/§3's
cross-surface "paths to accepted" extension). Verified live against local PostgreSQL — `services`,
`sales_offers`, `msp_subscriptions`, and `fulfillment_types` schemas and row contents all queried
directly; §5a's finding follows directly from the file's own control flow (confirmed by a full
read finding exactly one `.insert(salesOffersTable)` and zero `.update(salesOffersTable)` calls),
§5b/§5c/§5d were only discoverable by cross-referencing live catalog data against the file's own
branch conditions.

Four real findings filed as sibling sub-issues of #1571 (this issue's own direct EPIC parent — no
more specific Feature-tier parent exists for #3367): **#3400** (§5a, the accepted-but-uncharged
stuck-offer bug — the most severe), **#3403** (§5b, retainer items billed once instead of as a
recurring subscription), **#3404** (§5c, silent fulfillment no-op for 20 assessment-class catalog
rows with a discarded result), **#3405** (§5d, the missing `allowFreeCheckout` gate on the free
path) — all milestone v1.1, board status "AI Batter Up." Zero orphaned-endpoint sub-issues filed —
both routes in this pack are pre-#1571-wire unconsumed, the expected state. No product code,
schema, or UI was changed by this pass.
