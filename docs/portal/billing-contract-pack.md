# Billing — contract extraction pack for Claude Design

**#1598** (Portal New Design: Billing), following the method fixed by **#1577**, under
**#1485** (EPIC: Portal New Design). Read-only. Every field below is extracted verbatim
from the route's own `Wire*`/response-shape code and the Drizzle schema, cited to
file:line — nothing here is authored or invented. Per #1598's sequencing correction:
this surface's backend already existed before this pack, so it skips #1578 steps 1–2
(schema / honest read) and starts at step 3 (this pack) → Claude Design → wire.

Backend route: `artifacts/api-server/src/routes/portal-billing.ts`
Portal wire/model files (path stale — `artifacts/msp-portal` was retired for
`artifacts/portal` in `f40438cdc`; see #1921): `artifacts/portal/src/components/billingWire.ts`,
`billingLive.ts` (both carried over, but the `portal-v2/` subdir was dropped — real current
path is directly under `components/`); `billingData.ts`, `billingModel.ts`, `receiptWire.ts`,
`receiptLive.ts`, `receiptModel.ts`, `receiptData.ts` (NOT carried over — retired in
`f40438cdc`'s #1485 portal-v2 rebuild; these files do not exist in `artifacts/portal`)
Schema: `lib/db/src/schema/index.ts` (`invoicesTable`, `clientServicesTable`, `servicesTable`)

---

## 1. Wire contract

### 1.1 Invoices — `GET /api/portal/invoices`

Route: `portal-billing.ts:60-66`. Returns the raw `invoicesTable` rows (Drizzle
`$inferSelect`) for the calling customer, newest first. The portal never talks to this
shape directly — it narrows through `WireInvoice` (`billingWire.ts:18-28`), **extracted,
not the full row**:

```ts
// billingWire.ts:18-28 — WireInvoice (only the fields the Receipts row renders)
interface WireInvoice {
  readonly id?: unknown;
  readonly invoiceNumber?: unknown;
  readonly description?: unknown;
  readonly amount?: unknown;
  readonly status?: unknown;
  readonly invoiceType?: unknown;
  readonly pdfFilename?: unknown;
  readonly paidAt?: unknown;
  readonly createdAt?: unknown;
}
```

Every field arrives typed `unknown` deliberately — `billingWire.ts`'s `toReceiptRow`
(`billingWire.ts:73-84`) validates/coerces each one rather than trusting the wire. The
real column types, from `invoicesTable` (`lib/db/src/schema/index.ts:730-757`):

| Field | DB column | Type | Nullable | Status |
|---|---|---|---|---|
| `id` | `id` (serial) | `number` | no | CURRENT |
| `invoiceNumber` | `invoice_number` | `string` | no | CURRENT |
| `description` | `description` | `string \| null` | yes | CURRENT |
| `amount` | `amount` (numeric 10,2) | decimal string, e.g. `"1180.00"` — **dollars, not cents** (see §4) | no | CURRENT |
| `status` | `status` | enum, see §3 | no | CURRENT |
| `invoiceType` | `invoice_type` | enum, see §3 | no | CURRENT |
| `pdfFilename` | `pdf_filename` | `string \| null` | yes | CURRENT |
| `paidAt` | `paid_at` | `Date \| null` (ISO on the wire) | yes | CURRENT |
| `createdAt` | `created_at` | `Date` (ISO on the wire) | no | CURRENT |
| — (unused by this list view) | `currency`, `dueDate`, `stripeSessionId`, `sharepointFileUrl`, `couponCode`, `discountAmount`, `stripeInvoiceId`, `billingCycleStart/End`, `stripeSubscriptionId`, `zohoBooksInvoiceId`, `projectId`, `clientUserId`, `updatedAt` | — | — | CURRENT on the row, not surfaced through `WireInvoice` today |

`billingWire.ts`'s `toBillingReceipts` (`:89-92`) maps this to the render shape:

```ts
// billingWire.ts:30-38
interface BillingReceiptRow {
  readonly id: number;
  readonly date: string;    // fmtDate(paidAt ?? createdAt) — "29 Jul 2026" style, billingWire.ts:53-58
  readonly what: string;    // description, else a generic label by invoiceType — billingWire.ts:60-71
  readonly ref: string;     // invoiceNumber, else `inv_${id}` — billingWire.ts:80
  readonly amount: string;  // "$" + formatted amount — billingWire.ts:44-51
  readonly downloadable: boolean; // !!pdfFilename — billingWire.ts:82
}
```

A row with a non-numeric/missing `id` is dropped entirely (`billingWire.ts:74-75`) — an
id is what makes a receipt clickable, so an unusable one is not rendered as a dead row.

### 1.2 Invoice detail — `GET /api/portal/invoices/:id`

`portal-billing.ts:69-131`. Not currently consumed by any portal-v2 page (no
`portal-v2/*Wire.ts` narrows it) — **CURRENT on the route, unwired in portal-v2**. Real
response shape as served:

```ts
// portal-billing.ts:130
{ invoice: Invoice, project: { id: number; title: string } | null, contracts: Array<{
    id: number; serviceId: number; serviceName: string; signedAt: Date;
    signerName: string | null; contractVersion: string; finalPrice: string | null;
    wizardSelections: unknown; orderWorkflow: unknown;
  }>, client: { name, company, phone, address, addressCity, addressState, addressZip } | null }
```

### 1.3 Pay an invoice — `POST /api/portal/invoices/:id/pay`

`portal-billing.ts:133-186`. Creates a Stripe Checkout session (`mode: "payment"`), one
line item priced from `invoice.amount` converted to cents at the call boundary
(`portal-billing.ts:172` — see §4). Response: `{ url: string }` (`:185`). Unwired in
portal-v2 today (no pay button on `portal-v2-billing.tsx`'s receipt rows — the button
there triggers download, not pay).

### 1.4 Download a receipt PDF — `GET /api/portal/invoices/:id/download`

`portal-billing.ts:188-202`. 404 if `pdfFilename` is null or the file is missing on
disk. **CURRENT and wired** — `billingLive.ts`'s `downloadReceipt` (`:129-149`) drives
this from the Receipts row's "Receipt" button.

### 1.5 Stripe-sourced receipts — `GET /api/portal/billing/stripe-receipts`

`portal-billing.ts:204-262`. Resolves the caller's Stripe customer via any
`clientServicesTable` row carrying a `stripeSubscriptionId`, then lists that customer's
real Stripe invoices (`stripe.invoices.list`, limit 50). Returns `[]` (never an error
shape) if Stripe is unconfigured, there is no linked subscription, or the Stripe call
throws (`:208, :221-224, :258-261`) — **the empty array is overloaded**: it means "no
data" for three genuinely different reasons, none distinguished on the wire.

```ts
// receiptWire.ts:16-24 — StripeReceiptWire, one entry per Stripe invoice
interface StripeReceiptWire {
  readonly id: string;              // Stripe invoice id
  readonly number: string | null;   // Stripe's human invoice number
  readonly amount: number;          // portal-billing.ts:250 — inv.amount_paid, Stripe's own integer cents
  readonly currency: string;        // portal-billing.ts:251 — inv.currency, lowercase ISO code
  readonly status: string;          // portal-billing.ts:252 — Stripe's own status string, passed through raw
  readonly date: number;            // portal-billing.ts:253 — inv.created, Unix seconds
  readonly invoicePdf: string | null; // portal-billing.ts:254 — Stripe-hosted PDF URL
}
```

This is the **one field in the whole Billing contract that is genuinely integer
cents** — see §4.

### 1.6 Plan state — subscriptions — `GET /api/portal/billing/subscriptions`

`portal-billing.ts:265-330`. Real, built, **CURRENT on the route** — joins
`clientServicesTable` to `servicesTable` where `billingType = "recurring_monthly"`
(the enum's own DECIDED value, `servicesTable.billingType`,
`lib/db/src/schema/index.ts:466`), then for each row with a linked Stripe subscription,
fetches live Stripe subscription data:

```ts
// portal-billing.ts:316-326, stripeData shape at :286-294
{
  id: number;                    // client_services.id
  serviceId: number;
  serviceName: string;
  serviceSlug: string;
  status: "active" | "completed" | "paused"; // client_services.status enum, see §3
  startDate: Date | null;
  purchasedAt: Date;
  stripeSubscriptionId: string | null;
  stripe: {
    status: string;              // Stripe's own subscription-status vocabulary, passed through raw — see §3
    cancelAtPeriodEnd: boolean;
    cancelAt: number | null;           // Unix seconds
    billingCycleAnchor: number | null; // Unix seconds
    currentPeriodEnd: number | null;   // Unix seconds
    amount: number | null;             // Stripe's own integer cents (price.unit_amount), portal-billing.ts:308
    currency: string | null;
  } | null;                      // null when no stripeSubscriptionId or Stripe key unset — portal-billing.ts:282-283, :296-314
}
```

**This endpoint is real but is NOT what `portal-v2-billing.tsx` renders for the
Monitoring plan tiles today** — see §8/§9. `billingLive.ts`'s header
(`billingLive.ts:22-29`) states plainly why: there is today no `client_services` row
anywhere in `recurring_monthly` billing for any tenant to compute a real monitoring
plan-state view from, so reusing this endpoint for the tier cards would either render
empty or require inventing a monitoring/retainer/add-on categorization the schema does
not carry. **DECIDED not to wire it there yet — left alone rather than fabricated**,
tracked on #1594, blocked on #1128.

Sibling plan-state endpoints, real and CURRENT, also unwired into `portal-v2-billing.tsx`:

- `POST /portal/billing/subscriptions/:id/cancel` (`:332-384`) — sets
  `cancel_at_period_end: true`, sends an admin SMS + audit log.
- `POST /portal/billing/subscriptions/:id/resume` (`:387-451`) — clears it, sends admin
  SMS + audit log + a real customer email (`retainer-resumed` template) when
  `canSendAutomatedCustomerEmail` allows it.
- `POST /portal/billing/customer-portal` (`:454-498`) — opens a real Stripe Billing
  Portal session for the caller's resolved Stripe customer. **CURRENT and wired** — this
  is the one plan-state action `portal-v2-billing.tsx` actually calls
  (`billingLive.ts:110-127`, the "Manage payment in Stripe" button).
- `POST /portal/billing/subscriptions/:id/resubscribe` (`:501-566`) — new Checkout
  session, `mode: "subscription"`.

---

## 2. Field status — CURRENT vs DECIDED

| Surface | Field/behavior | Status | Issue |
|---|---|---|---|
| Receipts (invoices) | `WireInvoice` fields, `id`/`invoiceNumber`/`description`/`amount`/`status`/`invoiceType`/`pdfFilename`/`paidAt`/`createdAt` | CURRENT | #1237 |
| Receipts | `dataState` = `rows !== null ? "live" : "fixture"` (zero real rows is still `"live"`) | CURRENT (fixed) | #1463 |
| Receipt detail page | Stripe-sourced live match via `stripe-receipts` | CURRENT | #1242 |
| Receipt detail page | Fixture fallback on no route-id match | CURRENT (by design, not a gap) | #1242 |
| Manage payment in Stripe | `customer-portal` session | CURRENT | (pre-existing) |
| Download receipt PDF | `/invoices/:id/download` | CURRENT | (pre-existing) |
| Plan state — `subscriptions` list/cancel/resume/resubscribe endpoints | real, queryable today | CURRENT **on the route**, unwired in `portal-v2-billing.tsx` | — |
| Monitoring-plan tier cards, prices, "Switch to X" | fixture only (`billingData.ts` `BILL_TIER_CARDS`) | **DECIDED not-yet-wireable** — catalog rows for `monitoring-{tier}-{size}` carry no flat price (`price`/`price_cents` both null, seat-metered via `typeAttributes`) | #1594, blocked on #1128 |
| Third monitoring tier name | "Premier" (never "Command") | DECIDED | #1128 |
| Third monitoring tier price (1980 vs 2350 ladder conflict) | still open | **not yet DECIDED** — flagged for Shane, unresolved discrepancy between the shell's two ladders | #1128 |
| Interval / tier-switch / add-on toggles | fixture-only interactive repricing calculator, no real `client_services` row exists yet in `recurring_monthly` for any tenant to compute a real view from | DECIDED not-yet-wireable | #1594, blocked on #1128 |
| Invoice detail page (`GET /invoices/:id`), pay-invoice flow (`POST /invoices/:id/pay`), invoice pause | real endpoints, no portal-v2 consumer | CURRENT on the route, **not yet a Design surface** | — |
| My Architect billing-line dollar figure (`portal-v2-retainer.tsx:302-303,369`) | real, live, and rendered today | CURRENT, but see §7 for why this is a boundary problem, not a status gap | #1569 |

---

## 3. Real enum unions

```
invoicesTable.status:      draft | due | paid | overdue          (lib/db/src/schema/index.ts:738)
invoicesTable.invoiceType: instant | retainer                    (lib/db/src/schema/index.ts:746)
clientServicesTable.status: active | completed | paused          (lib/db/src/schema/index.ts:627)
servicesTable.billingType: one_time | recurring_monthly          (lib/db/src/schema/index.ts:466)
clientServicesTable.billingInterval /
  pendingBillingInterval:  month | year (CLIENT_BILLING_INTERVALS) (lib/db/src/schema/index.ts:618-619)
```

Two vocabularies on this surface are **not ours to define** — they are Stripe's own
enums, received and passed through raw, never re-declared by platform schema:

```
Stripe invoice status (receiptWire.ts's entry.status, portal-billing.ts:252):
  Stripe's own invoice-status vocabulary (e.g. "paid", "open", "void", "uncollectible",
  "draft"). The portal narrows this to a boolean at the point of use — receiptWire.ts:32
  `isPaid = entry.status === "paid"` — everything else renders as "Pending"
  (receiptWire.ts:43).

Stripe subscription status (portal-billing.ts:303, sub.status):
  Stripe's own subscription-status vocabulary (e.g. "active", "past_due", "canceled",
  "incomplete", "incomplete_expired", "trialing", "unpaid", "paused"). Passed through
  raw on the `stripe.status` field of §1.6's response — no platform narrowing today.
```

One vocabulary is **fixture-only**, not backed by any real column, and must not be
treated as a platform enum: `ReceiptStatus = "Paid" | "Pending"`
(`receiptData.ts:19`) — the design fixture's own status label for `BILL_ONETIME` rows.

---

## 4. Money contract

**Platform rule (stated in #1598, applies throughout): integer cents internally, single
platform Stripe account, no Stripe Connect.**

- **Single account confirmed by absence.** No `stripeAccount` header, no
  `connect.accounts.*` call, no `application_fee` anywhere under
  `artifacts/api-server/src` — every `new Stripe(stripeKey)` call resolves one of exactly
  two platform-wide secrets (`getStripeKey`, `artifacts/api-server/src/lib/stripe.ts:68-86`:
  `STRIPE_SECRET_KEY` in dev, `STRIPE_SECRET_KEY_PROD` in production). There is no
  per-tenant Stripe account anywhere in this surface.
- **The true integer-cents field on this surface is `StripeReceiptWire.amount: number`**
  (`receiptWire.ts:19`), sourced from Stripe's own `inv.amount_paid`
  (`portal-billing.ts:250`) and from `item?.price?.unit_amount` on the subscriptions
  endpoint (`portal-billing.ts:308`) — both are Stripe's own integer-cent values,
  untouched. `receiptWire.ts:33` converts it to a dollar float only at render time:
  `const amountDollars = Math.round(entry.amount) / 100`.
- **Honest exception, worth stating plainly for Design: `invoicesTable.amount` — the
  field the Receipts list itself actually renders — is NOT integer cents.** It is
  `numeric("amount", { precision: 10, scale: 2 })` (`lib/db/src/schema/index.ts:736`), a
  Postgres decimal that arrives on the wire as a **dollar string** (e.g. `"1180.00"`),
  not an integer. `billingWire.ts:47` parses it with `Number.parseFloat`, not integer
  cent math. The route itself only converts to cents at the Stripe API boundary, once,
  when actually calling Stripe: `Math.round(parseFloat(String(invoice.amount)) * 100)`
  (`portal-billing.ts:172`, inside `POST /invoices/:id/pay`'s `price_data.unit_amount`).
  **Design should not assume every money field on this page is integer cents** — the
  platform-wide cents rule holds for the services catalog
  (`servicesTable.priceCents`/`annualPriceCents`/`internalCostCents`, all
  `integer(...)`, `lib/db/src/schema/index.ts:457-462`) and for anything read straight
  off Stripe's own API, but the one real historical-invoice ledger this page reads is a
  decimal-dollar column, extracted as such.
- `services.price` / `services.basePrice` / `services.maxPrice` are also decimal
  dollars (`numeric(10,2)`, `lib/db/src/schema/index.ts:454-456`), not cents — used by
  the resubscribe/pay-invoice flows' own `parseFloat(...).toFixed(2)` /
  `Math.round(parseFloat(...) * 100)` conversions (`portal-billing.ts:545, :560`).

---

## 5. Honest-empty contract

`billingLive.ts`'s `BillingDataState` (`:49`) is exactly three states: `"loading" |
"live" | "fixture"`. The fix landed by #1463 (tracked further by #1594) is the contract
Design must render correctly:

```ts
// billingLive.ts:151-161
const dataState: BillingDataState = loading ? "loading" : rows !== null ? "live" : "fixture";
```

- `rows` is `null` **only** when the fetch itself failed or has not resolved yet — never
  because the resolved list was empty (`billingLive.ts:52-56`'s own doc comment states
  this explicitly).
- A tenant with **zero real invoices** is `dataState: "live"` with `receipts: []` — a
  distinct, real, renderable state from `dataState: "fixture"` (read never came back).
  Before #1463, `dataState` was computed from `rows.length > 0`, which collapsed these
  two into one bucket and rendered `BILL_RECEIPTS`'s fake seed rows
  (`billingData.ts:143-149`, the fictional "Halden Materials" tenant's receipts) as if
  they belonged to a real tenant that had genuinely never been billed. That bug is fixed;
  the corrected three-state contract above is what Design should build against.
- `pv2-bill-receipts-source` (`portal-v2-billing.tsx:349-351`) is a hidden DOM marker
  carrying the literal `dataState` string — the same "prove which source rendered"
  convention as `pv2-cmp-source` elsewhere in the portal. Design should preserve an
  equivalent hook.
- The loading state gets its own honest skeleton (`PortalV2LoadingState`,
  `portal-v2-billing.tsx:352-358`) rather than flashing the fixture rows before the real
  read lands (the Git #1343 flicker this pattern exists to prevent elsewhere in the
  portal).

The Receipt detail page (`receiptLive.ts`) has a simpler two-state contract —
`dataState: "live" | "fixture"`, no `"loading"` union member on the type itself (loading
is tracked as a separate `loading: boolean`, `receiptLive.ts:21-28`):

- `"live"`: the route `:id` matched a real Stripe invoice by id or human number
  (`stripeReceiptMatches`, `receiptWire.ts:27-29`).
- `"fixture"`: no match — including the case where the Stripe read itself failed
  (`receiptLive.ts:44-45` sets `receipts` to `null` on any fetch error, which then never
  matches, same code path as "no match").

---

## 6. The receipt page's legitimate fixture fallback

`portal-v2-receipt.tsx` / `receiptLive.ts` falling back to the design fixture is a **real,
allowed case, not a violation of the fixture/real-data rule** — worth stating plainly so
Design doesn't try to eliminate it. The route `:id` is a **per-item lookup key** the
customer arrived with (from a Receipts row link), matched client-side against up to 50
of the tenant's most recent real Stripe invoices (`stripe.invoices.list({ limit: 50 })`,
`portal-billing.ts:244`). A miss is expected and legitimate whenever:

- the id refers to an invoice outside that 50-row window,
- the id refers to a receipt from `invoicesTable` (the platform ledger) rather than a
  Stripe subscription invoice — the two receipt universes are not the same set,
- or the tenant has no Stripe subscription to resolve a customer from at all
  (`portal-billing.ts:221-224`).

None of these are "the read failed" in the honest-empty sense of §5 — they are "this
specific id was never going to be a Stripe subscription invoice." The fixture shown in
that case is real design content for a specific fictional charge
(`RC_DETAIL`/`BILL_ONETIME`, `receiptData.ts`), not a fabricated stand-in for missing
platform data.

---

## 7. Boundary with My Architect (#1569)

#1569's own architecture note states the intended boundary explicitly: My Architect "is
where retainer **money lives**... that surface shows time only, never money." Billing
(this pack) is the money surface; My Architect is the time surface. **Design should keep
that boundary — but it does not hold in the code as shipped today, and that
contradiction should be visible to Design rather than smoothed over:**

`portal-v2-retainer.tsx` (titled "My Architect" on-screen, `:309`) currently computes
and renders a real dollar figure in its header:

```ts
// portal-v2-retainer.tsx:302-304
const billingLabel = retainerConfigured && live.bucket && live.settings
  ? `$${Math.round((live.bucket.retainedHours * live.settings.hourlyRateCents) / 100).toLocaleString("en-US")}/mo`
  : null;
```

rendered at `portal-v2-retainer.tsx:369`. This is real, live money — `retainedHours ×
hourlyRateCents / 100` — sourced from the retainer ledger's own real
`retainer_settings.hourly_rate_cents` (an integer-cents field, correctly named per §4's
rule; see `admin-retainer.ts:61,208`, `portal-retainer.ts:85`). It is not fixture, not a
bug in the honest-empty sense of §5 — it is a real, working feature that currently
crosses the boundary #1569 says should not exist.

This pack does not resolve that — it is Billing's own read-only extraction and this
line lives on the My Architect surface, out of scope to change here. It is recorded so
Design, given both packs, does not design Billing to *also* show a retainer $/mo figure
under the assumption My Architect already owns none — and so the contradiction is on
record for whoever architects My Architect's own contract pack next.

---

## 8. Forbidden list

Swept from `billingLive.ts`'s own header (`:10-34`), the route's real
"deliberately does NOT serve" declarations for this page:

1. **Monitoring-plan tier cards and prices — NO-BACKEND-TO-WIRE.** The catalog's real
   Foundation/Growth/Premier rows (`services.slug` = `monitoring-{tier}-{size}`) carry no
   flat price at all — `price` and `price_cents` are both null; they are seat-metered via
   `typeAttributes` instead. There is no live number to wire the cards to, and the
   #1128 Premier price discrepancy (1980 vs 2350) is unresolved. **Status: DECIDED
   (stay fixture), tracked #1594, blocked on #1128 — not an open unknown, a named,
   tracked gap.**
2. **Interval / tier-switch / add-on toggles — NO-BACKEND-TO-WIRE.** These are the
   design's own interactive hypothetical-repricing calculator ("what would this cost if
   I picked X"), not "what does this tenant pay today." Also blocked structurally: there
   is, today, no `client_services` row anywhere in `recurring_monthly` billing for any
   tenant to compute a real view from; reusing `GET /portal/billing/subscriptions`
   (§1.6) here would either render empty or require inventing a
   monitoring/retainer/add-on categorization the schema does not carry. **Status:
   DECIDED (stay fixture), tracked #1594, blocked on #1128.**
3. **Receipts and the Stripe billing-portal link are different — explicitly wired, not
   forbidden.** `invoicesTable` is the platform's one real billing-history ledger, and
   `customer-portal` is a real, already-built Stripe action. Stated in the same header
   comment specifically to contrast with items 1–2.

No `portal-pii-governance.ts`-style dedicated "why this can't be served" route exists
for Billing — the forbidden declarations live entirely in `billingLive.ts`'s header
comment, as swept above.

---

## Appendix — files read for this pack

- `artifacts/api-server/src/routes/portal-billing.ts`
- `artifacts/portal/src/components/billingLive.ts` (carried over, but the `portal-v2/`
  subdir was dropped — real current path is directly under `components/`)
- `artifacts/portal/src/components/billingWire.ts` (carried over, but the `portal-v2/`
  subdir was dropped — real current path is directly under `components/`)
- `artifacts/portal/src/components/billingData.ts` (NOT carried over — retired in
  `f40438cdc`'s #1485 portal-v2 rebuild; this file does not exist in `artifacts/portal`)
- `artifacts/portal/src/components/billingModel.ts` (NOT carried over — retired in
  `f40438cdc`'s #1485 portal-v2 rebuild; this file does not exist in `artifacts/portal`)
- `artifacts/portal/src/pages/portal-v2-billing.tsx` (NOT carried over — retired in
  `f40438cdc`'s #1485 portal-v2 rebuild; this file does not exist in `artifacts/portal`)
- `artifacts/portal/src/components/receiptLive.ts` (NOT carried over — retired in
  `f40438cdc`'s #1485 portal-v2 rebuild; this file does not exist in `artifacts/portal`)
- `artifacts/portal/src/components/receiptWire.ts` (NOT carried over — retired in
  `f40438cdc`'s #1485 portal-v2 rebuild; this file does not exist in `artifacts/portal`)
- `artifacts/portal/src/components/receiptModel.ts` (NOT carried over — retired in
  `f40438cdc`'s #1485 portal-v2 rebuild; this file does not exist in `artifacts/portal`)
- `artifacts/portal/src/components/receiptData.ts` (NOT carried over — retired in
  `f40438cdc`'s #1485 portal-v2 rebuild; this file does not exist in `artifacts/portal`)
- `artifacts/portal/src/pages/portal-v2-receipt.tsx` (NOT carried over — retired in
  `f40438cdc`'s #1485 portal-v2 rebuild; this file does not exist in `artifacts/portal`)
- `artifacts/portal/src/pages/portal-v2-retainer.tsx` (boundary check only, §7; NOT
  carried over — retired in `f40438cdc`'s #1485 portal-v2 rebuild; this file does not
  exist in `artifacts/portal`)
- `artifacts/api-server/src/lib/stripe.ts`
- `lib/db/src/schema/index.ts` (`invoicesTable`, `clientServicesTable`, `servicesTable`)
- GitHub: #1598, #1485, #1577, #1463, #1594, #1128, #1569
