# Billing (MSP Console) — contract extraction pack for Claude Design

**#4081**, sub-issue of **#1692** (Feature: Billing, MSP Console — the operator half of #1598,
the customer-facing Portal Billing page), under **#1571** (EPIC: Portal Admin). Follows the
**#1642 pattern**: per-surface wire contracts extracted verbatim and cited to file:line, CURRENT
vs DECIDED marked on every field, real enum unions only, cross-surface edges, honest tri-state,
forbidden list, orphaned endpoints listed explicitly. Read-only — no product code, schema, or UI
changed by this session.

**This pack does not re-derive the shared schema/routes.** `docs/portal/billing-contract-pack.md`
(the customer-facing `portal-billing.ts` surface: invoices, receipts, Stripe subscription
plan-state) is cited directly wherever this pack's operator-side surface touches the same
`invoicesTable`/`clientServicesTable`/`servicesTable` rows. This pack's own job is the
MSP-console-operator angle: what an `msp-*` route lets a staff member actually do on a
customer's billing, and where that diverges from what #1692's own body claims exists.

## 0. What #1692 claims, and what is actually real — read this before the rest of the pack

#1692's own scope line: **"Issue and adjust invoices · change plan and seats · manage add-ons
and one-offs · retainer interval switching."** It cites two things as the "real backend
confirmed and already packed": #2607 (`msp-plan-self-service-contract-pack.md`) and #3368
(`partner-revenue-msp-console-contract-pack.md`). A full sweep of every `msp-*` route file under
`artifacts/api-server/src/routes/` for anything touching a **customer's** invoice, plan, seats,
add-ons, one-offs, or retainer interval — not the MSP's own platform-tier subscription — finds
that most of #1692's own scope line describes work that has no `msp-*` backend at all. Stated
plainly, one clause at a time, because this is the load-bearing finding of this pack:

| #1692 clause | What's actually real | Verdict |
|---|---|---|
| "Issue and adjust invoices" | **No `msp-*` route exists.** The only code that inserts/patches an `invoicesTable` row is `admin-invoices.ts` (`POST`/`PATCH`/`DELETE /admin/invoices*`, all `requireAdmin` — PlatformAdmin-only, AdminV2, mounted `admin-invoices.ts:32,91,142,174`) and `portal-checkout-free.ts`/`seed-portal.ts` (system-generated, not operator-issued). §1.1. | **NOT BUILT for MSP Console** |
| "change plan and seats" | `msp-plan-self-service.ts` is real — but it is the **MSP's own** platform-tier subscription (Free/Growth/Pro), keyed by the caller's own `mspId`. It has no `customerId`/`tenantId` parameter anywhere and cannot act on a customer's plan. No `msp-*` route adjusts a **customer's** monitoring-tier plan or seat count at all — the only per-seat-priced purchase path (`msp-marketplace-purchase.ts`) explicitly 422s a per-seat item rather than accept a seat count. §1.2. | **"change plan" = MSP's own tier only (real, but not what the clause implies); "seats" = NOT BUILT for any customer** |
| "manage add-ons and one-offs" | **Real.** `msp-marketplace-purchase.ts`'s two routes let staff purchase a non-project catalog item (`add_on`/`subscription`/`retainer` serviceClass, one-time or Stripe-charged) on a specific customer's behalf, wholesale-charged to the MSP's own saved card. Already packed in full at `docs/msp-console/marketplace-purchase-msp-console-contract-pack.md` — cited here, not re-derived. §1.3. | **BUILT** |
| "retainer interval switching" | **Not an MSP-console-operator action.** The only `switch-interval`/`cancel-interval-switch` routes in the whole codebase are on `portal-retainer-billing.ts`, whose own header states plainly: *"lets a direct customer... switch an active retainer between monthly and yearly billing, self-service... Direct-customer channel ONLY."* No `msp-*` route calls `scheduleIntervalSwitchAtPeriodEnd` or touches `clientServicesTable.pendingBillingInterval` on a customer's behalf. §1.4. | **NOT BUILT for MSP Console — the clause describes a customer self-service feature, not an operator one** |

Two of #1692's four clauses have no real MSP-console-operator backend at all; a third ("change
plan") is real only for the MSP's own subscription, not a customer's. Only "add-ons and one-offs"
is genuinely built and operator-facing. This is filed as a real finding — see §9.

---

## 1. Wire contracts — each real (or absent) surface, in #1692's own clause order

### 1.1 Invoices — issue/adjust — NOT BUILT for MSP Console

Confirmed by a repo-wide sweep: `grep -rn "insert(invoicesTable)\|invoicesTable.*\.values" artifacts/api-server/src` matches exactly three call sites, none of them an `msp-*`/`requireCapability("ladder.msp-*")` route:

- `artifacts/api-server/src/routes/admin-invoices.ts:102` — `POST /admin/invoices`, `requireAdmin`
  (`admin-invoices.ts:35,91,142,174` — GET/POST/PATCH/DELETE, all PlatformAdmin-only). This is
  AdminV2, not the MSP console, per this project's own standing rule that per-customer delivery
  work lives in `artifacts/msp-console` and AdminV2 is platform administration only (#1692's own
  "Rules that apply when it is built" section states this explicitly).
- `artifacts/api-server/src/routes/portal-checkout-direct.ts` / `portal-checkout-free.ts:249` —
  system-generated at checkout time (a customer's own purchase), not an operator action.
- `artifacts/api-server/src/lib/seed-portal.ts:734` — dev/test seed data, not a route at all.

`docs/portal/billing-contract-pack.md` §1.2 (`GET /api/portal/invoices/:id`) and §1.3
(`POST /api/portal/invoices/:id/pay`) are both **customer-facing** reads/actions on the same
`invoicesTable` row — an MSP operator has no route anywhere that reaches either. **There is no
`msp-*` route that reads a single customer's invoice list either** — confirmed by the same sweep
(`grep -rn "invoicesTable" artifacts/api-server/src/routes/msp-*.ts` matches only
`msp-billing-webhook.ts:1120`, a comment, and `msp-financial-aggregator.ts` — an **aggregate**
sum across all of an MSP's customers for the `/msp/dashboard` revenue tile
(`msp-financial-aggregator.ts:152-183`, called from `msp-portal.ts:339`,
`requireCapability("ladder.msp-operator")`) — never a single customer's invoice row or list).

**Real DB state confirmed live** (`psql "$DATABASE_URL"`, 2026-09-14): `SELECT count(*) FROM
invoices` → **0 rows**, system-wide. There is no live invoice for this backend gap to be
exercised against today even in AdminV2.

### 1.2 Plan and seats

#### 1.2.1 "Change plan" — real, but it is the MSP's OWN tier, not a customer's

`msp-plan-self-service.ts` (4 routes: `GET /msp/plan/current`, `GET /msp/plan/available`,
`POST /msp/plan/change`, `POST /msp/plan/cancel-pending-change`) is real, `requireRole("MSPAdmin")`
(a floor — `PlatformAdmin` also passes), and fully documented in
`docs/msp-console/msp-plan-self-service-contract-pack.md` — cited here in full, not re-derived.
Its own header states the boundary directly: *"One MSP has exactly one row in
`msp_subscriptions`... the platform tier the MSP itself pays for, keyed by their own `msp_id`.
This is a completely different axis from `tenantsTable`/monitoring-tier billing (what an MSP
charges their own customers)."* No parameter on any of its 4 routes accepts a `customerId` or
`tenantId` — it structurally cannot act on a customer's plan.

**Real DB state, re-confirmed live 2026-09-14** (later than that pack's own 2026-09-03/09-12
snapshots — cited here because it has materially changed): `msp_subscriptions` now has **2**
rows, not 1 — `msp_id=1` (Shane's own real MSP, "Shane McCaw Consulting") → `service_id=122`
("Pro", a real, genuine platform tier) → `status='active'`, alongside the pre-existing synthetic
`msp_id=1626` → `service_id=131` fixture row both prior packs documented. **This is the first
real MSP's platform-tier subscription pointing at a genuine tier** — worth noting for whoever
next re-verifies that pack's own "zero live subscriptions point at any real tier" line, which is
now stale for the tier-lookup bug's own re-verification purposes (the bug itself, #2701, is
already fixed and unaffected by this).

#### 1.2.2 "Seats" — NOT BUILT for any customer

No `msp-*` route anywhere accepts or stores a seat count against a customer's monitoring
subscription. The only place a seat-priced item surfaces on the MSP-console-operator side is
`msp-marketplace-purchase.ts`'s checkout route, and it explicitly **rejects** a per-seat item
rather than accept a count:

```ts
// msp-marketplace-purchase.ts:215-227
// Per-seat-priced items (monitoring tiers): marketplaceShape.priceCents is
// the per-user/month RATE, not a chargeable total — this seat-less checkout
// would charge e.g. $8.00/mo for an entire 2000-seat monitoring subscription.
// Reject rather than silently undercharge; these products must be purchased
// through the seat-aware monitoring checkout flow.
if (marketplaceShape.perSeat) {
  apiErr(res, 422, "This item is priced per licensed user and requires a seat count. Purchase it through the monitoring checkout flow instead.");
  return;
}
```

The "monitoring checkout flow" this error message points to is the **customer's own**
onboarding/assessment checkout (`portal-onboarding.ts`, `portal-assessment.ts` — both compute a
`seatCount` client-side during the customer's own self-serve purchase, confirmed by
`grep -rn "seatCount" artifacts/api-server/src/routes"`, which matches only those two
customer-facing files plus this rejection message). **No MSP-console-operator equivalent of that
flow exists** — an operator cannot adjust an existing customer's seat count, nor purchase a
new seat-priced monitoring tier on a customer's behalf, from anywhere in `artifacts/msp-console`'s
real backend today.

### 1.3 Add-ons and one-offs — real, already packed

`msp-marketplace-purchase.ts`'s two routes (`GET /api/msp/customers/:customerId/marketplace/catalog`,
`POST /api/msp/customers/:customerId/marketplace/checkout`, `msp-marketplace-purchase.ts:130,172`,
both `requireCapability("ladder.msp-operator")`) are the real, live, staff-initiated purchase
mechanism for a non-project, non-seat-metered catalog item on a specific customer's behalf —
wholesale-charged to the MSP's own saved Stripe card-on-file, recorded as a `sales_offers` row so
it shows up through the same customer-facing `GET /api/portal/offers` surface a self-serve
purchase would.

**Fully documented — cite, don't re-derive:**
`docs/msp-console/marketplace-purchase-msp-console-contract-pack.md`. That pack's own §0.1
inventories both routes' wire shapes, its §2 the checkout request/response contract, and it
already covers: the `project`-serviceClass 422 (an MSP staffer cannot sign a SOW on the
customer's behalf), the `fulfillmentKnown`/`internalCostCents` staff-only fields Git #3819 added,
the free-vs-paid path split, and the `recordTenantSubscription` write (`billingParty: "msp"`,
Git #2847) for a recurring item. Nothing in this pack's own re-read of
`msp-marketplace-purchase.ts` (578 lines, current) found any drift from that pack's own account —
it remains accurate.

### 1.4 Retainer interval switching — a customer self-service feature, not an operator one

The **only** interval-switch mechanism in the codebase is `portal-retainer-billing.ts`
(`GET /api/portal/billing/retainer-intervals`, `POST .../subscriptions/:id/switch-interval`,
`POST .../subscriptions/:id/cancel-interval-switch`), and its own module header states the scope
directly: *"lets a direct customer (mspId === 1, platform-billed) switch an active retainer
between monthly and yearly billing, self-service... Direct-customer channel ONLY. The MSP
platform-tier equivalent is `msp-plan-self-service.ts` / `msp-billing-webhook.ts` — entirely
separate system."* Gated by `requireCustomerCapability("billing.manage")` — a customer-portal
capability, not `requireCapability("ladder.msp-operator")` or any MSP-console gate. Confirmed by
`grep -rn "switch-interval\|switchInterval" artifacts/api-server/src/routes/*.ts`: the only match
is this one file.

Mechanically it is the retainer-billing sibling of §1.2.1's plan-change flow — same two-phase
Stripe Subscription Schedule pattern (`getOrCreateRetainerPrice`/`scheduleIntervalSwitchAtPeriodEnd`,
`retainer-pricing.ts`), same `pendingBillingInterval`/`stripeScheduleId` columns on
`clientServicesTable` (not `mspSubscriptionsTable`), same webhook-driven finalize
(`handleRetainerScheduleUpdated`/`Completed`/`Released`/`Canceled`, `portal-retainer-billing.ts:417-440`,
mirroring `msp-billing-webhook.ts:765-` exactly per its own comment). **No MSP-console-operator
route reads or writes any of this** — an operator cannot see or trigger a customer's pending
interval switch from `artifacts/msp-console`'s real backend.

**Real DB state confirmed live** (2026-09-14): `client_services` has **1** row with a non-null
`billing_interval` — `id=50`, `service_id=12` ("Premier Monitoring — Enterprise"), `billing_interval='month'`,
`pending_billing_interval` null, `status='active'` — the one real retainer-billed row in the
system today, and it has no pending switch in flight.

---

## 2. Cross-surface edge: `/msp/billing/revenue` (Partner Revenue) is wholesale-only, never a customer invoice

`msp-partner-revenue.ts`'s own header states its scope limit as a confirmed architectural fact,
not an oversight: *"this platform's locked architecture has MSPs invoice their own end customers
entirely OUTSIDE the platform. There is no Stripe-verified or invoiced record anywhere in this
codebase of what an MSP actually charges its customers."* `GET /api/msp/billing/revenue`
(`msp-partner-revenue.ts:43`, `requireCapability("ladder.msp-admin")`) therefore returns exactly
two things, never conflated: `wholesaleSpend` (real, Stripe-verified — what the MSP itself pays
the platform, from `mspSubscriptionsTable`) and `pricingWorksheet` (the MSP's own self-declared
resale prices on Sales Bundles, `mspSalesBundlesTable.resalePriceCents` — never charged through
this platform, never reconciled against a real invoice). **Already fully packed** —
`docs/msp-console/partner-revenue-msp-console-contract-pack.md` — cited here as the reason this
Feature's "Billing" surface has no revenue-per-customer figure to show: the platform genuinely
has no record of what a customer is actually billed by their MSP outside it.

This is directly relevant to §1.1's finding: even if invoice issuance existed for MSP Console,
`msp-partner-revenue.ts`'s own header confirms the platform was deliberately architected with no
outside-the-platform customer-invoice record at all — so "issue and adjust invoices" (§1.1) would
be the *first* real per-customer invoicing surface on the MSP side, not an extension of an
existing one.

---

## 3. Money contract

Every money field cited in this pack inherits the platform-wide rule
`docs/portal/billing-contract-pack.md` §4 already states in full: **integer cents internally,
single platform Stripe account, no Stripe Connect** — not re-derived here. The two operator-side
surfaces this pack adds:

- `msp-plan-self-service.ts` (§1.2.1): `monthlyPriceCentsOf()` normalizes the legacy
  `numeric(10,2)`-dollars `services.price` column to integer cents at the wire boundary
  (`msp-plan-self-service-contract-pack.md` §4) — cited, not re-derived.
- `msp-marketplace-purchase.ts` (§1.3): wholesale/retail cents split via
  `resolveCatalogPricing()` — cited in full by `marketplace-purchase-msp-console-contract-pack.md`.

No new money-handling code exists on this surface for this pack to independently verify — the
gap in §1.1/§1.2.2 is precisely that no code exists there at all.

---

## 4. Real enum unions

Inherited, not re-declared: `MspSubscriptionStatus`, `MspDunningState`, `MspBillingInterval`
(`msp-plan-self-service-contract-pack.md` §2); `invoicesTable.status`/`.invoiceType`,
`clientServicesTable.status`, `servicesTable.billingType`, `clientServicesTable.billingInterval`
(`docs/portal/billing-contract-pack.md` §3). No surface documented in this pack introduces a new
enum.

---

## 5. Honest-empty / tri-state contract

There is no UI yet for any surface this pack documents as real (§1.2.1, §1.3) nor for the gaps
(§1.1, §1.2.2, §1.4) — `artifacts/msp-console/src/api/` has `msp-plan-api.ts` and
`marketplace-purchase-api.ts` (both real, wired per #3796's own resolution and the marketplace
pack's own account) but no `billing-api.ts`/`invoice-api.ts` of any kind (confirmed:
`ls artifacts/msp-console/src/api/` lists no billing/invoice file). There is therefore no
loading/live/fixture tri-state to evaluate for §1.1/§1.2.2/§1.4 — there is no read at all to be
honest or dishonest about yet. When a wire step for any of these eventually lands, the same HARD
RULE applies as every other Feature: no fixture fallback on a read failure or an unscoped MSP
context.

---

## 6. The forbidden list — declared, not merely absent

1. **No `msp-*` route issues, adjusts, or lists a single customer's invoice.** (§1.1) Only
   AdminV2's PlatformAdmin-only `admin-invoices.ts` touches `invoicesTable` from an operator
   action; the MSP console has an aggregate revenue *sum* (`/msp/dashboard`) but never a
   per-invoice read.
2. **No `msp-*` route manages a customer's seat count**, for a new purchase or an existing
   subscription. (§1.2.2) The one seat-aware code path that exists (customer-side onboarding
   checkout) has no MSP-console-operator equivalent; `msp-marketplace-purchase.ts` explicitly
   422s rather than guess a seat count.
3. **`msp-plan-self-service.ts` cannot act on a customer's plan, by design** — it is scoped to
   the caller's own `mspId` with no `customerId`/`tenantId` parameter anywhere on any of its 4
   routes. (§1.2.1) Design must not read "Change plan" in #1692's body as meaning this surface
   can change a *customer's* monitoring tier.
4. **No `msp-*` route reads or writes a customer's retainer-interval pending-switch state.**
   (§1.4) `portal-retainer-billing.ts` is customer-self-service only, by its own header's explicit
   statement — an operator cannot see or trigger it today.
5. **`msp-partner-revenue.ts` never reports a customer-facing dollar figure as verified revenue**
   (§2) — `pricingWorksheet` is explicitly labeled a self-declared worksheet, never reconciled
   against a real invoice, because none exists to reconcile against.

---

## 7. Orphan sweep

`msp-plan-self-service.ts`'s 4 routes and `msp-marketplace-purchase.ts`'s 2 routes are **not**
orphaned — both are wired into `artifacts/msp-console/src/api/` (`msp-plan-api.ts`,
`marketplace-purchase-api.ts`), confirmed live in this session's own read of both files (§1.2.1,
§1.3). This corrects the two source packs' own "zero UI callers" / "live, zero UI callers" lines
(`msp-plan-self-service-contract-pack.md` §0.1, `marketplace-purchase-msp-console-contract-pack.md`
§0.1 lines 61-62) — both were accurate when written and have since been wired, most recently by
#3796 for plan-self-service. Not re-filed as a finding since the state is now *better* than
those packs recorded, not worse; noted here so a reader of this pack doesn't need to
cross-reference dates to know the current wiring state. `msp-partner-revenue.ts`'s 1 route:
unchanged, still unwired per that pack's own §0.1/§8 (not re-verified independently in this
session — cited, not re-checked, per this project's standing "cite, don't re-investigate"
discipline for an already-filed gap).

---

## 8. Provenance

Extracted 2026-09-14 against `main`. Sources read in full for this pack: every `msp-*.ts` and
`portal-*billing*.ts`/`portal-retainer-billing.ts` route file under
`artifacts/api-server/src/routes/` (grep-swept for `invoice`, `seat`, `oneOff`/`one_off`,
`addOn`/`add_on`, `billingInterval`, `switch-interval`), `msp-plan-management.ts` (the separate
PlatformAdmin/AdminV2 surface, read to confirm it is out of MSP-console scope), `admin-invoices.ts`
(read in full to confirm its `requireAdmin` gate and that it is the only invoice-writing route in
the repo), `msp-marketplace-purchase.ts` (578 lines, re-read in full against the existing
marketplace pack — no drift found), `msp-financial-aggregator.ts` (read to confirm the
`/msp/dashboard` revenue tile is an aggregate sum, never a per-invoice read), and
`msp-portal.ts:131-350` (the `/msp/dashboard` route consuming it). Cross-checked against the four
existing MSP-console packs this one cites rather than re-derives:
`docs/msp-console/msp-plan-self-service-contract-pack.md` (#2607),
`docs/msp-console/partner-revenue-msp-console-contract-pack.md` (#3368),
`docs/msp-console/marketplace-purchase-msp-console-contract-pack.md`, and
`docs/msp-console/retainer-hours-msp-console-contract-pack.md` (read for convention, not cited
substantively — that pack covers the hours ledger, a genuinely different domain from money, per
`docs/portal/billing-contract-pack.md` §7's own stated My-Architect/Billing boundary). Live DB
state confirmed via direct `psql` against local `DATABASE_URL` (2026-09-14): `invoices` — 0 rows,
system-wide; `msp_subscriptions` — 2 rows (`msp_id=1`→`service_id=122` "Pro", real and active;
`msp_id=1626`→`service_id=131`, the pre-existing synthetic fixture both cited packs already
documented); `client_services` — 1 row with a non-null `billing_interval` (`id=50`,
`service_id=12` "Premier Monitoring — Enterprise", `month`, no pending switch). Read-only pass:
no product code, schema, or UI was changed by this session.

## 9. Finding filed

**#1692's own scope line overstates what is built for three of its four clauses** — no `msp-*`
route issues/adjusts a customer invoice, none manages a customer's seat count, and "retainer
interval switching" describes a customer self-service feature that has no MSP-console-operator
counterpart. Filed as **#4085**, a sibling sub-issue of #1692, labeled `bug`, milestone "v1.1 -
Monitoring & Launch Control", board status "AI Batter Up".
