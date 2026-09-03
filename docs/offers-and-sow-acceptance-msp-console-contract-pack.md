# Offers and SOW Acceptance — MSP Console contract extraction pack

**#2641**, the Document step for **#2568** (Feature: Offers and SOW Acceptance, MSP Console — the
operator half of the customer-facing #1657), parented directly under #1571 (EPIC: Portal Admin)
per #2568's own status note that it is not yet a sub-issue of a more specific module epic.
`artifacts/msp-console` does not exist yet (#1680, closed superseded — the scaffold itself is
work #2568 still needs, not a blocker for this Document step: the backend this pack documents is
real, mature, and already mounted).

Read-only. Every field below is extracted verbatim from the route file, its Zod schemas, and the
Drizzle schema, cited to file:line, and cross-checked live against local PostgreSQL. **Nothing here
is authored or invented.**

This is a **separate module** from `docs/offers-and-sow-acceptance-contract-pack.md` (#2448, the
customer-portal pack for #1657). That pack documents the 7 customer-facing read/accept/sign routes
under `portal-offers.ts` / `portal-presentations.ts` / `platform-agreements.ts`, and explicitly
scopes `msp-sow.ts` as "not analyzed beyond the hand-off points" — this pack is that surface's own
wire contract, extracted to the same standard. The two modules share one hand-off point
(`document-engine-sow.ts`, the AI SOW-pricing pipeline both packs reference but neither opens) and
otherwise operate on entirely different backing tables (`quick_win_presentations`/`sales_offers` on
the customer side vs. `msp_sows`/`msp_sow_events`/`msp_charges` here).

Backend: one file, all 12 routes live and mounted (`artifacts/api-server/src/routes/index.ts:239,
575` — `import mspSowRouter from "./msp-sow"; router.use(mspSowRouter);`):

- `artifacts/api-server/src/routes/msp-sow.ts` (1261 lines) — offer acceptance, SOW
  create/list/detail/document/sign/charge/expire, public share-link viewer + sign, customer
  clickwrap get/record. Also exports `triggerMspCharge()`, a real internal function called from
  two other places in the codebase (§4).

Schema: `lib/db/src/schema/msp.ts:3447` (`mspSowsTable`), `:3519` (`mspSowEventsTable`), `:3544`
(`mspChargesTable`), `:3586` (`mspCustomerClickwrapsTable`); `lib/db/src/schema/index.ts:3202`
(`salesOffersTable`), `:458` (`servicesTable`). Verified live against local PostgreSQL
(`psql "$DATABASE_URL" -c '\d msp_sows'` / `'\d sales_offers'`) — every FK and column cited below
confirmed present on the running schema, not just the Drizzle source; §5's finding was **only
discoverable live**, not from the TypeScript source alone (see below).

Sources read in full: `msp-sow.ts` (1261 lines), `msp-sow.test.ts` (603 lines, 24 tests — read to
confirm real, currently-asserted behavior, not as a source of new facts), `sales-offer-engine.ts`
(`persistSalesOfferCandidates`, `runSalesOfferEngineForTenant`), `resolve-msp-id.ts` (all 4 exports,
for §6c), `sow-expiry-sweep.ts`, `productTypeConfig.ts` (`detectProductType`), `msp-entitlement.ts`
(`checkMspMinTierSatisfied`), `seed-system-workflows.ts` (the `__system__: MSP SOW Charge Approval`
definition), `workflow-executor.ts` (the `charge_msp_card` action handler and `approval_gate` node,
read for §4), `customer-tenant-alert-engine.ts` (the `billing.sow_signed` alert condition, §4),
`requireAuth.ts` (`AuthUser` shape, `assertCustomerAccess`'s own `customerId`-is-`tenants.id`
convention note, cited in §6b).

---

## 0. The surface and its consumers

### 0.1 Consumer map

| Endpoint | Method | Line | Consumer today | Status |
|---|---|---|---|---|
| `/api/msp/offers/:offerId/accept` | POST | `:142` | none | live, zero UI callers |
| `/api/msp/sows` | POST | `:422` | none | live, zero UI callers |
| `/api/msp/sows` | GET | `:486` | none | live, zero UI callers |
| `/api/msp/sows/:sowId` | GET | `:533` | none | live, zero UI callers |
| `/api/msp/sows/:sowId/document` | GET | `:555` | none | live, zero UI callers |
| `/api/msp/sows/:sowId/sign` | POST | `:600` | none | live, zero UI callers |
| `/api/msp/sows/:sowId/charge` | POST | `:684` | none | live, zero UI callers |
| `/api/msp/sows/:sowId/expire` | POST | `:723` | none | live, zero UI callers |
| `/api/public/sows/:shareToken` | GET | `:754` | none | live, zero UI callers |
| `/api/public/sows/:shareToken/sign` | POST | `:816` | none | live, zero UI callers |
| `/api/msp/customers/:customerId/clickwrap` | GET | `:894` | none | live, zero UI callers |
| `/api/msp/customers/:customerId/clickwrap` | POST | `:947` | none | live, zero UI callers |

**All 12 are genuinely unconsumed today** (§7 — this is the expected pre-Design/pre-wire state:
`artifacts/msp-console` doesn't exist, so there is nowhere for a caller to live yet). Not one of
these has ever had a live frontend caller — including the retired portal-v2, per the sibling
customer-portal pack's own §10, which found the same absence on its side of this Feature. Three
routes DO have real, live **backend** (non-HTTP) callers documented in §4 — `triggerMspCharge()`
(exported, called from `workflow-executor.ts`), `msp_sows` (queried directly by
`sow-expiry-sweep.ts` and by `customer-tenant-alert-engine.ts`'s `billing.sow_signed` condition) —
those are noted there, not counted as "consumers" of the HTTP routes themselves.

### 0.2 No curated `Wire*` shape anywhere in this file — every response is a raw row or a hand-built literal

Unlike the RBD MSP-console pack's `msp-rbd-instances.ts`/`msp-rbd-versions.ts` (which define real
`Wire*` interfaces), **no route in `msp-sow.ts` defines a curated response type**. Every response is
either:
- a hand-built object literal (`{outcome, sowId, shareToken, message}` at `:305-310`; `{ok, message}`
  shapes throughout), or
- the **entire raw `mspSowsTable` row**, unfiltered — `POST /msp/sows` (`res.status(201).json(sow)`,
  `:478`, from a full `.returning()`) and `GET /msp/sows/:sowId` (`res.json(sow)`, `:547`, from a
  bare `db.select()`) both return every column, **including `signatureData` (the base64 PNG blob)
  and `signedIp`** to any `MSPOperator` — contrast the public share viewer (§1.7), which explicitly
  curates its response and comments `// Don't expose signature data in public view` (`:784`). This
  is real, live, MSP-authenticated-only behavior (not customer-facing), and not necessarily wrong,
  but it means the two SOW-creation entry points in this same file return **structurally different
  shapes** for "the SOW that was just created" — `POST /msp/offers/:offerId/accept`'s project branch
  returns the 4-field curated literal above, while `POST /msp/sows` returns the full row. Flagged
  for #2582-equivalent wiring awareness, not filed — no caller exists today to be broken by it.

---

## 1. Wire contract — by route

### 1.1 `POST /api/msp/offers/:offerId/accept` (`:141-407`)

`requireRole("MSPOperator")`. Path param `offerId` (numeric, 400 otherwise, `:145-146`). `mspId`
resolved via this file's own `getMspIdFromRequest()` (`:66-73` — see §6c for why this is a real,
separate finding from the canonical helper).

Offer lookup (`:151-163`): `(id, mspId)` from `sales_offers`, 404 if none. **409** unless
`state IN ("sent", "draft")` (`:166-169`) — note `"draft"` is accepted here even though a draft
offer was never sent to anyone; this route has no separate "must have been sent first" gate, only
the state-machine floor.

Service resolution (`:178-211`, only if `offer.serviceId` is set): reads `servicesTable.serviceClass`
(default `"add_on"` if the joined service row itself has a null `serviceClass`, `:194`),
`.deliveryType`, `.allowFreeCheckout`, `.trialPeriodDays`, `.typeAttributes`. **Monitoring Tier
gate** (`:200-209`): if `detectProductType(serviceClass, deliveryType) === "monitoring_tier"` and
`typeAttributes.minMspPlanTier` is set, `checkMspMinTierSatisfied(mspId, minMspPlanTier)` must pass
or the whole accept fails **402** with the required-vs-current tier named in the message — this
runs before the offer is even marked accepted, so a failed tier check leaves the offer untouched at
its prior state. No `serviceId` on the offer → `serviceClass` defaults to `"add_on"` (`:214`).

Offer is unconditionally marked `state: "accepted"`, `acceptedAt: now()` (`:217-221`) **before** the
branch below runs — even the add_on/subscription branch's Stripe-checkout-session-creation failure
(`:402-405`, 500) does not roll this back; the offer stays `"accepted"` even if the actual checkout
session never got created. No compensating transition back to `"sent"` exists anywhere in this
route.

**Branch: `serviceClass === "project"`** (`:225-312`) — creates a `msp_sows` row:
- Customer resolution (`:226-243`): `offer.customerId` looked up against `tenantsTable` by
  `tenantId` (the M365 GUID) **OR** `id` (the serial PK), scoped to `tenantsTable.mspId = mspId`.
  This treats `offer.customerId` as tenant-shaped input — see §6b, a real, live contradiction with
  `sales_offers.customer_id`'s own declared FK target.
- Optional `mspConnectorConfigsTable.customerAgreementTemplate` is read and snapshotted
  (`:245-254`) into the new SOW's `customerAgreementSnapshotText` — the same "snapshot at creation,
  never re-read live" pattern §3's document generation relies on.
- `shareToken` (32-hex-char, `randomBytes(24).toString("hex")`, `:76-78`) and **two independent
  30-day timers** — `shareTokenExpiresAt` and `expiresAt` — both computed from `Date.now()` at
  creation, not derived from each other (`:257-259`).
- `documentHtml` generated inline (§3) and stored at creation time, `status: "sent"` from the
  start (not `"draft"` — a project-offer acceptance immediately produces a customer-ready,
  signable SOW with no separate "MSP reviews before sending" step).
- Insert returns only `{sowId, status}` (`:288-291`) — the fuller row shape isn't read back here.
- Two events fire on success: `sow.created` (`msp_sow_events`, `:295-297`) and `msp.sow.created`
  (`msp_event_store`, `:299-301`) — see §4 for both tables' real shapes.
- Response `201`: `{outcome: "sow_created", sowId, shareToken, message}` (`:305-310`).

**Branch: `serviceClass !== "project"`** (`:314-406`, add_on or subscription):
- `amountCents === 0 && allowFreeCheckout` → **no SOW, no Stripe** — emits `msp.offer.free_activated`
  and returns `{outcome: "free_activated", message}` (`:317-328`). Note: **this path never creates
  any `msp_sows` row at all** — the "free" outcome for a project-class offer would have gone through
  the branch above regardless of `amountCents`/`allowFreeCheckout` (a `$0` project SOW still gets a
  real `msp_sows` row and is settled for free later, inside `triggerMspCharge`, §2). The free-skip
  short-circuit here is add_on/subscription-only.
- Otherwise, a real Stripe Checkout Session is created directly from this route (`:330-405`) —
  `mode: "payment"` for add_on, and (see the code comment at `:379-381`) **`subscription` mode
  silently falls back to `"payment"` mode too** — there is no live Stripe Price ID wiring for
  recurring subscriptions in this route; a `trialPeriodDays`-bearing subscription offer gets a
  one-time `payment`-mode session with a `recurring: {interval: "month"}` fragment stitched into
  `price_data` that Stripe's one-time `payment` mode does not actually honor as a subscription —
  this is a real, live, stated gap in the route's own comment (`"Fall back to payment mode if no
  Stripe price ID available"`), not something this pack is inferring. `success_url`/`cancel_url`
  point at `${baseUrl}/portal/customer-home` — a customer-portal deep link, confirming this
  checkout flow was written to resolve into the **customer** portal, not an MSP Console surface.
- `getStripeKey()` failure → `503` (Stripe not configured), not a 500 (`:332-337`).

### 1.2 `POST /api/msp/sows` (`:412-480`) — standalone SOW creation

`requireRole("MSPOperator")`. Body (`createSowSchema`, `:412-419`): `mspId` (required — see below),
`customerId?`, `serviceId?`, `title` (1-300 chars), `description?` (≤2000 chars), `amountCents`
(≥0). **`mspId` is required in the body schema, but `getMspIdFromRequest(req) ?? data.mspId`**
(`:429`) means an ordinary MSP session's own `mspId` always wins over whatever the body supplied —
the body's `mspId` is only ever actually used as a fallback for a `PlatformAdmin`/`admin` caller
with no `?mspId=` query override. Same snapshot-template / share-token / dual-30-day-timer pattern
as §1.1's project branch. `status: "draft"` (not `"sent"` — the one real difference from an
offer-originated SOW, `:468`). Returns the **entire inserted row** (§0.2), `201`.

### 1.3 `GET /api/msp/sows` (`:485-527`) — list

`requireRole("MSPOperator")`. `limit` (default 20, capped at 100), `offset` (default 0),
optional `status` filter (cast straight to the enum type with no validation against
`MSP_SOW_STATUSES` — an invalid string silently produces zero matching rows via Drizzle's typed
`eq`, not a 400), optional `customerId` filter. Scoped to `mspId` only (`:497`). Two parallel
queries (`Promise.all`, `:505-523`) — a curated 9-field projection for the list rows plus a
separate `count()` for `total`. Response: `{items, total, limit, offset}` (`:525`).

### 1.4 `GET /api/msp/sows/:sowId` (`:532-549`) — detail

`requireRole("MSPOperator")`. `(sowId, mspId)` lookup, 404 otherwise. Returns the full raw row
(§0.2).

### 1.5 `GET /api/msp/sows/:sowId/document` (`:554-588`)

`requireAuth` (not role-gated — any authenticated login). Looks up the SOW by `sowId` alone (no
`mspId`/`customerId` filter in the query itself — the scoping happens entirely in the access-control
check below). Access: `isMspUser = user.mspId === sow.mspId || user.role === "admin"`, OR
`isCustomerUser = user.id === sow.customerUserId` (`:575-576`) — **exact match on
`sow.customerUserId`, no sibling-login bridge** (contrast the customer-portal pack's own
`resolveSiblingUserIds()`-bridged sign route). 403 if neither. 404 if `documentHtml` is null
(distinct from "SOW not found," `:581-583`). Response is raw `text/html`, not JSON (`:585-587`) —
same non-JSON-on-any-path shape as the customer-portal pack's own `sow-document` route.

### 1.6 `POST /api/msp/sows/:sowId/sign` (`:594-678`)

`requireAuth`. Body (`signSowSchema`, `:594-597`): `signerName` (1-200 chars), `signatureData`
(≥10 chars — no real base64/PNG validation, just a length floor). Ownership: same exact-match
`isMspUser`/`isAssignedCustomer` pattern as §1.5 (`:624-626`), **not** sibling-bridged. 409 unless
`status IN ("sent", "draft")` (`:618-621`) — note `"draft"` is signable here, an MSP-created
standalone SOW (§1.2) never has to pass through `"sent"` first. Expiry check runs and, if tripped,
**writes `status: "expired"` before returning the 410** (`:632-637`) — a real side effect on a
read-adjacent guard, not a pure check.

On success (`:644-654`): `status: "signed"`, `signerName`, `signatureData`, `signedAt`, `signedIp`
(from `x-forwarded-for`, falling back to `req.socket.remoteAddress`, `:640-642` — correctly proxy-
aware, not naive `req.ip`), and **`expiresAt` is re-stamped to a fresh 30 days from now**
(`:652`) — the signed-but-unpaid clock, which is what `sow-expiry-sweep.ts` (§4) polls.

Two events fire (`sow.signed` / `msp.sow.signed`, `:656-662`). **No auto-charge fires directly from
this route** — a comment (`:666-668`) explains the charge now requires MSP approval per
`MSP_Full_Catalog_Purchase_Charging_Spec_v1`: `emitWorkflowEvent("sow.signed", ...)` (`:669-674`)
is fired instead, which the seeded `__system__: MSP SOW Charge Approval` workflow listens for (§4).
Response: `{ok: true, status: "signed", message: "...Awaiting MSP approval to charge."}` (`:676`).

### 1.7 `POST /api/msp/sows/:sowId/charge` (`:683-717`) — manual/operator re-trigger

`requireRole("MSPOperator")`. `(sowId, mspId)` lookup, 404 otherwise. 409 unless
`status IN ("signed", "failed")` (`:704-707`) — this is the **operator's manual retry** path for a
charge the approval-gated workflow already attempted and failed, or a direct trigger if the
workflow path is bypassed entirely. Calls `triggerMspCharge()` directly (§2) — the exact same
function the workflow's `charge_msp_card` node calls (§4), so both paths share one real
implementation, not two.

### 1.8 `POST /api/msp/sows/:sowId/expire` (`:722-748`) — manual operator expiry

`requireRole("MSPOperator")`. 409 if `status === "paid"` (the only blocked state — a `"draft"` or
`"sent"` SOW can be manually killed with no further guard). Emits `sow.expired` with
`{manual: true}` (`:744`) — the one field distinguishing an operator-initiated expiry from
`sow-expiry-sweep.ts`'s own `{auto: true, sweep: "sow-expiry-sweep"}` payload for the same event
name (§4).

### 1.9 `GET /api/public/sows/:shareToken` (`:753-799`) — public, unauthenticated viewer

No auth of any kind — the `shareToken` itself is the credential. 404 if no row matches
(`:777` — message doesn't distinguish "never existed" from "wrong token"). 410 if
`shareTokenExpiresAt` has passed (`:780-782` — this is a **separate** clock from `expiresAt`; a
share link can 410 while the SOW itself is still legally signable via some other channel, or vice
versa — the route only checks the share-token clock here, not `expiresAt`). Response
(`:785-797`) is a hand-curated object that deliberately omits `signatureData`/`signedIp`/`mspId` —
the one route in this file with an explicit "don't leak this" comment (`:784`).

### 1.10 `POST /api/public/sows/:shareToken/sign` (`:801-888`) — public sign

Rate-limited (`express-rate-limit`, `:807-813`): 15-minute window, limit **10** in production,
**500** in non-production (an explicit `NODE_ENV` branch, not an env var — a real, live behavioral
difference between environments baked into the route file itself). Same `signSowSchema` as §1.6.
Checks, in order: share-token existence (404) → share-token expiry (410) → status must be
`"sent"`/`"draft"` (409, with a friendlier `"already been signed"` message specifically for
`"signed"`/`"paid"`, `:844-848`) → `expiresAt` expiry (410, and — same as §1.6 — writes
`status: "expired"` as a side effect of the check, `:850-854`). On success: identical
sign-field writes as §1.6, event actor is `null`/`"customer_via_share_link"` instead of a real
`user.id`/role (`:871`), and **this path auto-fires `triggerMspCharge()` directly**
(`void triggerMspCharge(...)`, `:882-884`) — **no approval-gate workflow runs for a public-share
signature**, unlike §1.6's authenticated-session sign route. This is a real, live asymmetry: the
`MSP_Full_Catalog_Purchase_Charging_Spec_v1` approval requirement (§1.6's own comment) is bypassed
entirely when the customer signs via the unauthenticated public link instead of an authenticated
session — see §6a, filed.

### 1.11 `GET /api/msp/customers/:customerId/clickwrap` (`:893-944`)

`requireAuth`. `mspId = user.mspId ?? getMspIdFromRequest(req)` (`:901`). Looks up
`tenantsTable.mspId` for the given `customerId` (404 if none), then **403 unless**
`!mspId || customer.mspId === mspId || user.role === "admin"` (`:911-913` — read as a positive
condition; the code is the negated guard). If the MSP has no `customerAgreementTemplate` configured,
short-circuits to `{required: false, accepted: true}` (`:922-925`) with **no clickwrap row ever
checked or created for that MSP** — an MSP that never configures a template can never accumulate
clickwrap records at all, which is correct given the table's own header comment ("Only created when
the MSP has customerAgreementTemplate set"). Otherwise looks up an existing
`mspCustomerClickwrapsTable` row keyed `(mspId, customerUserId)` — **not** `customerId`, `:928-935`
— and returns `{required: true, accepted, acceptedAt, agreementText}`.

### 1.12 `POST /api/msp/customers/:customerId/clickwrap` (`:946-995`) — record acceptance

`requireAuth`. **This route performs no ownership/scope check at all** — see §6a, the most
severe finding in this pack, filed as its own issue.

---

## 2. Internal contract — `triggerMspCharge()` (`:999-1138`, exported)

Not an HTTP route — a real, exported async function, the shared charge implementation §1.7 and §4
both call.

```ts
// msp-sow.ts:999-1004 — MspChargeResult (verbatim)
export interface MspChargeResult {
  success: boolean;
  status: "paid" | "pending_action" | "failed";
  stripePaymentIntentId?: string;
  error?: string;
}
```

- **`amountCents === 0`** (`:1012-1026`): skips Stripe entirely, sets `status: "paid"` directly,
  emits `sow.paid`/`msp.sow.paid` with `{amountCents: 0, free: true}`, and unlocks fulfillment
  (below) — this is how a `$0` **project** SOW settles (the add_on/subscription free-skip in §1.1
  is a different, earlier short-circuit that never reaches this function at all).
- **Stripe not configured** (`:1028-1039`): `status: "failed"`, `failureReason: "Stripe not
  configured"` written directly to `msp_sows` — no event emitted on this specific path (contrast
  every other failure branch, which does emit `sow.failed`).
- **Real charge attempt** (`:1041-1112`): resolves the MSP's saved Stripe customer id
  (`getMspStripeCustomerId`, `mspSubscriptionsTable.stripeCustomerId` — the platform-tier billing
  subscription, not a per-SOW customer object) and, if present, its default payment method
  (`getMspDefaultPaymentMethod`, `:1140-1157` — tries `invoice_settings.default_payment_method`
  first, falls back to the first card on `paymentMethods.list`). Creates a Stripe `PaymentIntent`
  with `confirm: true` only if a saved payment method was found — **if the MSP has no saved
  Stripe customer/payment method at all, the PaymentIntent is created unconfirmed
  (`confirm: false`) and never auto-confirmed by this function** — it will sit in
  `requires_payment_method`/`requires_confirmation` indefinitely unless something else confirms it,
  which nothing in this file does. Records the attempt in `msp_charges` regardless of outcome.
  `pi.status === "succeeded"` → SOW `status: "paid"`, `sow.paid`/`msp.sow.paid` events, fulfillment
  unlocked, returns `{success: true, status: "paid"}`. Any other Stripe status (3DS pending, the
  never-confirmed case above, etc.) → `sow.charge_pending` event, returns
  `{success: false, status: "pending_action"}` — **this is a real "success" as far as the calling
  workflow node is concerned** (§4: `workflow-executor.ts` only treats `status === "failed"` as a
  node error, not `"pending_action"`), so the "Charge MSP Card" workflow step proceeds to send the
  "SOW charge processed" confirmation email (with `{{status}}` interpolated into the body) even
  when the charge is, in plain terms, still pending — not filed (the email body does state the real
  status via interpolation), but worth Design/ops awareness before anyone builds a UI that reads
  `pending_action` as a terminal state.
- **Thrown Stripe error** (`:1113-1137`): `status: "failed"`, `failureReason` set to the real error
  message, a `msp_charges` row inserted with `status: "failed"` (insert failure itself swallowed,
  `:1132`), `sow.failed`/`msp.sow.payment_failed` events fired, `{success: false, status: "failed",
  error}` returned.

`unlockFulfillment()` (`:1159-1176`): dynamically imports `fulfillmentQueueTable` and updates the
row matching `(sourceType: "sow", sourceId: sowId)` to `deliveryStatus: "not_started"` — a
**non-fatal, best-effort** call (caught and logged, never surfaces back to the caller) that is this
file's only touch point into the fulfillment system; the fulfillment queue row itself is created
elsewhere, out of this pack's scope.

---

## 3. SOW document generation — `generateSowDocument()` (`:1180-1259`)

A pure function, not a route — inlined HTML string generation, no external template engine, no
call to `document-engine-sow.ts` (the AI-priced pipeline the customer-portal pack's §11 references)
or any AI call at all. Takes `{title, description, amountCents, customerAgreementText, mspId}` and
returns a complete standalone HTML document: fixed CSS, a single "Project Fee" line item (never
itemized into phases — no `sowPhases`/`SowPhaseObj` concept exists anywhere in this file, unlike
the customer-portal pack's `quick_win_presentations.sow_phases` model), and either the MSP's own
`customerAgreementText` verbatim or a **hardcoded 5-clause fallback terms block**
(`:1236-1251`, Scope/Payment/Confidentiality/Limitation of Liability/Governing Law) when no
MSP-specific template is configured. `mspId` is accepted as a parameter but never actually used
inside the function body — dead parameter, harmless, not filed (no observable effect either way).

---

## 4. Cross-surface edges

| Edge | Mechanism | Notes |
|---|---|---|
| `charge_msp_card` workflow action → `triggerMspCharge()` | `workflow-executor.ts:3432-3460` dynamically imports `triggerMspCharge` from this route file and calls it with `sowId`/`mspId`/`amountCents`/`actorUserId` interpolated from the workflow payload | Only `status === "failed"` trips a workflow node error (`:3452`) — `"pending_action"` is treated as a non-error output, see §2 |
| `sow.signed` event → `__system__: MSP SOW Charge Approval` workflow | `seed-system-workflows.ts:42-49`, `eventNames: ["sow.signed"]` | `emitWorkflowEvent("sow.signed", ...)` at `:669` (§1.6) is the only route that fires this — §1.10's public-sign path bypasses the whole workflow and calls `triggerMspCharge()` directly, so this workflow **never runs at all** for a customer who signs via the public share link |
| Approval gate | `approval_gate` node, `approverRole: "msp_approver"` (a display label only), `timeoutSeconds: 259200` (72h) | Real eligible-approver resolution is `or(mspRole = "MSPAdmin", canApprovePurchases = true)` (`workflow-executor.ts:7413`) — matches the seed definition's own stated intent, not a mismatch |
| `sow-expiry-sweep.ts` | Scheduled sweep, queries `msp_sows` directly (`status IN (sent, signed)` AND `expires_at < now()`), flips to `"expired"`, writes its own `sow.expired` event, then fires a diagnostics rescan per affected customer | Confirms the schema comment's promised "auto-expires... via a scheduled workflow transition" is real and implemented — **not** by this route file, by a separate sweep job |
| `billing.sow_signed` alert condition | `customer-tenant-alert-engine.ts:457-464`, raw SQL `SELECT COUNT(*) FROM msp_sows WHERE msp_id = $1 AND status = 'signed' AND signed_at > NOW() - ...` | An independent poll of `msp_sows` state, not driven by this file's own `sow.signed` event emission — a customer-tenant alert can fire even if `emitSowEvent`/`emitMspEvent` both failed on a given sign call (both are caught-and-logged, non-fatal) |
| `document-engine-sow.ts` | Referenced by the customer-portal pack (#2448 §3/§11) as the pipeline offer-acceptance hands off into | **Not called anywhere in `msp-sow.ts`** — this file's own project-offer acceptance (§1.1) generates its SOW document entirely inline via §3, with no AI pricing step. The two packs' Feature areas each own a structurally different SOW-creation path; they are not the same pipeline |

---

## 5. Real enum unions

| Vocabulary | Values | Where fixed | Enforced by |
|---|---|---|---|
| `msp_sows.status` | `draft`, `sent`, `signed`, `paid`, `failed`, `expired` | `MSP_SOW_STATUSES`, `msp.ts:3444` | Zod-typed only at the one place the app writes it as a query-string cast (§1.3) — no DB CHECK constraint (confirmed live: no `msp_sows_status_check` in `\d msp_sows`) |
| `msp_charges.status` | `pending`, `succeeded`, `failed`, `cancelled` | `MSP_CHARGE_STATUSES`, `msp.ts:3541` | Same — no DB CHECK, plain `text` column |
| `sales_offers.state` | `draft`, `sent`, `accepted`, `rejected`, `expired` | `SALES_OFFER_STATES`, `index.ts:3189` | This route's own accept handler checks membership in `{"sent","draft"}` inline (`:166`) rather than importing the canonical const — harmless today since both values are real members, but a second hand-typed copy of part of this vocabulary, same pattern the RBD pack's §5 flagged elsewhere in this codebase |
| `services.serviceClass` | `project`, `add_on`, `subscription` | `index.ts:532-534` | Read-only in this file (never written) — governs the three-way branch in §1.1 |
| `services.deliveryType` | `assessment`, `bundle_subscription`, `retainer`, `document_generation`, `none` | `index.ts:543-544` | Read-only, feeds `detectProductType()` |

---

## 6. Findings

### 6a. `POST /api/msp/customers/:customerId/clickwrap` has no ownership check at all — filed, `bug` + `security`

Its sibling `GET` route (§1.11, `:911-913`) explicitly checks
`if (mspId && customer.mspId !== mspId && user.role !== "admin") apiErr(res, 403, ...)`. The `POST`
route (`:946-995`) does not: it resolves `customer.mspId` from the path's `customerId` alone
(`:955-959`), then unconditionally inserts a `msp_customer_clickwraps` row attributing acceptance
to `req.user.id` for that MSP's agreement (`:980-990`) — **no comparison against the caller's own
`mspId`, `customerId`, or role anywhere in the route.** Any `requireAuth`'d login — an MSP staff
member of a *different* MSP, or a `CustomerUser` with no relationship to the target `customerId` at
all — can call this route with an arbitrary `customerId` and it will succeed, writing a permanent
`agreementTextSnapshot` + `ipAddress` + `userAgent` + `acceptedAt` record that reads exactly like a
genuine customer-agreement acceptance for an account the caller has no relationship to. This is a
legally-relevant compliance record (a clickwrap acceptance), forgeable cross-tenant with no
authorization check, by any authenticated session in the system. Confirmed live: the `GET` route's
403 guard has no counterpart anywhere in the `POST` handler's control flow.

Filed as **#2725**, parented under #2568 (this pack's own Feature), labeled `bug` + `security`.

### 6b. `sales_offers.customer_id`'s live FK targets `users.id`; every real consumer treats its value as a `tenants.id`

Confirmed live (`psql \d sales_offers`): `"sales_offers_tenant_id_fkey" FOREIGN KEY (customer_id)
REFERENCES users(id) ON DELETE SET NULL` — the constraint is real and named
`..._tenant_id_fkey` despite pointing at `users`, not `tenants`. The column's own Drizzle comment
(`index.ts:3204`) states this is deliberate: *"Despite the historical column name, this is NOT the
M365 tenant GUID — it's a numeric FK to usersTable.id."*

But every real, live consumer of this column disagrees with that comment:
- **This route's own accept handler** (§1.1, `:226-243`) resolves `offer.customerId` by looking it
  up against `tenantsTable.tenantId` (the M365 GUID) OR `tenantsTable.id` — never `usersTable`.
- **`persistSalesOfferCandidates()`** (`sales-offer-engine.ts:369-378`) writes the `customerId`
  argument straight through from `runSalesOfferEngineForTenant(customerId: number, ...)`, which
  resolves a tenant's `buildTenantProfile(customerId)` — the same `customerId`-means-`tenants.id`
  convention `requireAuth.ts:291` states outright for the platform generally ("Phase 1 (#94):
  `customerId` here is a `tenants.id`").
- **The customer-portal pack's own §1** (`docs/offers-and-sow-acceptance-contract-pack.md`) states
  the same thing from the read side: `GET /api/portal/offers` scopes by
  `eq(salesOffersTable.customerId, customerId)` where `customerId` is the JWT's tenant-level
  `customerId` claim, explicitly noting this is correct *because* "`sales_offers.customer_id` is
  always written as the tenant-level id... never a specific `users.id` login row."

Live data doesn't yet expose the conflict: all 5 current `sales_offers` rows carry
`customer_id = 1`, which happens to satisfy both interpretations (the testbed tenant's `tenants.id`
and `users.id` are coincidentally both `1`). The FK is a real landmine, not a live incident: the
first tenant whose `tenants.id` does not also happen to exist as a `users.id` will hit a hard FK
violation on offer insert — `persistSalesOfferCandidates()`'s own `try/catch` (`:419-420`) will
swallow it as a logged, silent failure (**the offer is simply never created**, with no surfaced
error), and the first tenant whose `tenants.id` *does* coincidentally collide with an unrelated
`users.id` gets an offer that inserts successfully but is FK-anchored to the wrong person's login
row.

Filed as **#2730** (schema/FK correction: repoint the FK at `tenants.id`, or correct the stale
comment if `users.id` was in fact the intent and every consumer is wrong instead), parented under
#2568, labeled `bug`.

### 6c. `getMspIdFromRequest()` duplicates, and reproduces the wrong half of, the canonical `resolve-msp-id.ts` contract

`msp-sow.ts` does not import from `resolve-msp-id.ts` at all — it has its own private
`getMspIdFromRequest()` (`:66-73`):

```ts
// msp-sow.ts:66-73 (verbatim)
function getMspIdFromRequest(req: Request): number | null {
  const user = req.user!;
  if (user.role === "admin" || user.mspRole === "PlatformAdmin") {
    const q = parseInt(p(req.query["mspId"] as string | undefined), 10);
    return isNaN(q) ? null : q;
  }
  return user.mspId ?? null;
}
```

This is functionally a re-implementation of `resolveMspId()` (`resolve-msp-id.ts:28-53`) — it
allows a `?mspId=` query override for `admin`/`PlatformAdmin` callers. But every route in this file
that calls it (`/msp/sows`, `/msp/sows/:sowId`, `/msp/sows/:sowId/charge`,
`/msp/sows/:sowId/expire`, `/msp/offers/:offerId/accept`) is shaped exactly as
`resolveMspIdStrict()`'s own doc comment (`resolve-msp-id.ts:64-77`) describes as the case that
helper exists for: *"session-scoped `/msp/...` routes (no `:mspId` in the URL) that must only ever
operate on the caller's own MSP... For admin-facing cross-MSP access, use a `/msps/:mspId/...`
route with `requireMspScope` instead."*

Concretely: a `PlatformAdmin` calling `GET /api/msp/sows?mspId=<any other MSP's id>` (or
`.../offers/:offerId/accept?mspId=...`) gets that other MSP's data/action scope through a route
whose own path shape is exactly the one the codebase's own documented convention says must not
allow this. In practice this is bounded by `PlatformAdmin` already being a platform-wide role, so
this is not a privilege escalation for an unprivileged caller — but it is a real, live deviation
from a convention the codebase states explicitly and enforces via a purpose-built helper elsewhere,
on a route file that instead hand-rolled its own copy without either helper. Filed as **#2731**
(swap to `resolveMspIdStrict()` on the 5 affected routes), parented under #2568, labeled `bug`.

### 6d. Stale header comment names a route that does not exist

The file's own header (`:23`) lists `POST /api/msp/checkout/add-on — direct Stripe checkout
(add_on / subscription)` as one of its routes. **No such route is registered anywhere in this file
or the codebase** (`grep -rn "checkout/add-on"` across `artifacts/` returns only this one comment
line). The real behavior the comment is describing already happens inline inside
`POST /msp/offers/:offerId/accept`'s add_on/subscription branch (§1.1) — there was never a separate
`/checkout/add-on` endpoint. Low severity, header-comment-only — not filed, flagged for awareness
(same threshold the RBD pack's own §9c used for a stale code comment).

### 6e. `msp_sow_events.event_name`'s own schema comment lists a value no code path ever emits

`msp.ts:3523`'s inline comment enumerates `sow.created | sow.sent | sow.signed | sow.charged |
sow.paid | sow.failed | sow.expired` as the real event names. This file emits `sow.created`,
`sow.signed`, `sow.paid`, `sow.charge_pending`, `sow.failed`, `sow.expired` — **never `sow.sent`
and never `sow.charged`** (the actual event name at the equivalent lifecycle point is
`sow.charge_pending`, not `sow.charged`). Low severity, comment-only mismatch — not filed.

---

## 7. Orphaned-endpoint check

```
grep -rn "msp/sows\|msp/offers/.*accept\|public/sows\|customers/.*clickwrap\|msp/checkout" \
  --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v "routes/msp-sow"
```

Real result: **zero live frontend callers of any of this pack's 12 routes**, anywhere in the tree —
not `artifacts/portal`, not the retired `portal-v2` archive, not `artifacts/msp-website`, not
`artifacts/shane-mccaw-consulting`. The only tree hits are comment cross-references in three
unrelated route files (`sow-expiry-sweep.ts`, `live-document-shares.ts`, `portal-documents.ts`,
`public-rbd-document.ts`) citing this module's public-share pattern as prior art for their own,
different share-link routes — not calls. This is the expected pre-#2568-scaffold state (§0.1), the
same shape the RBD MSP-console pack (#2580) and the customer-portal Offers/SOW pack (#2448) both
independently found for their own Features — not a gap to file.

---

## 8. Honest-empty / partial-data contract

- **`GET /api/msp/sows`**: an MSP with zero SOWs gets `{items: [], total: 0, limit, offset}` — a
  real empty state, not a fixture.
- **`GET /api/msp/sows/:sowId`**, **`.../document`**, **`.../charge`**, **`.../expire`**,
  **`.../sign`**: all 404 `{error: "SOW not found"}` for a missing/wrong-`mspId` row — never
  distinguishes "doesn't exist" from "not yours," same no-ownership-leak-signal discipline the
  customer-portal pack documents for its own offer routes.
- **`GET /api/public/sows/:shareToken`**: 404 for an unknown token, 410 for an expired one — two
  distinct codes, not conflated.
- **`GET /api/msp/customers/:customerId/clickwrap`**: `{required: false, accepted: true}` is a
  real, intentional "no agreement configured" state (§1.11), not an error and not a fixture.
- **`documentHtml: null`** on a `msp_sows` row is a real, reachable state (a standalone SOW created
  outside the normal offer-accept path could theoretically have this null, though §1.2's route
  itself always generates one) — §1.5 serves a distinct 404 for it rather than an empty body.

---

## 9. The forbidden list — declared, not merely absent

1. **No cross-MSP read/write via the normal path.** Every route except §6c's flagged deviation
   scopes strictly to the caller's own `mspId`.
2. **Public share-token routes never leak signature data.** §1.9's response is hand-curated
   specifically to omit `signatureData`/`signedIp`/`mspId` (`:784`) — the one place in this file
   with an explicit anti-leak comment.
3. **A charge is never double-recorded as succeeded.** `triggerMspCharge()` is idempotent in effect
   (re-running it against an already-`"paid"` SOW would attempt a second real Stripe charge — see
   the note below) but every real call site (§1.7 manual retry, §4 workflow node, §1.10 auto-fire)
   gates on `status IN ("signed","failed")` or a fresh sign event before calling it, so no live path
   in this file re-charges a `"paid"` SOW today. **Not enforced inside `triggerMspCharge()` itself**
   — the guard is entirely the caller's responsibility, unlike the RBD pack's guarded-`UPDATE`
   pattern. Not filed as a bug (no live path reaches it), flagged as a design note for whoever wires
   #2582-equivalent: a future caller must not skip the status gate.
4. **Free ($0) offers never hit Stripe.** Both the add_on/subscription short-circuit (§1.1) and
   `triggerMspCharge()`'s own `amountCents === 0` branch (§2) bypass Stripe entirely — two separate
   real code paths for the two different SOW/non-SOW shapes, not one shared free-check.

---

## 10. Not covered by this pack

Per this Document step's own scope, no page/UI-shape decisions are made here. `document-engine-sow.ts`
(the AI SOW-pricing pipeline the customer-portal pack's §3/§11 hand off into) is confirmed, by this
pack's own read of the full file, to be **never called by any route in `msp-sow.ts`** — it is not
analyzed further here since it is out of this Feature's actual code path, not merely out of scope.
`workflow-executor.ts`'s `approval_gate`/general workflow-run mechanics are documented only to the
extent §4 needed to confirm the approval flow's real shape; the workflow engine's own contract is a
separate surface. `sales-offer-engine.ts`'s scoring/rule-matching internals (which candidates get
generated in the first place) are out of scope — only `persistSalesOfferCandidates()`'s write shape
(§6b) was opened, because it was needed to confirm that finding.

---

## 11. Provenance

Written 2026-09-03 against `main` (branch `agent/2641-q1414`), for #2641 (Document step of #2568,
Feature: Offers and SOW Acceptance, MSP Console). Read in full, not sampled: `msp-sow.ts` (1261
lines), `msp-sow.test.ts` (603 lines, all 24 tests). Cross-referenced in full or in relevant part:
`sales-offer-engine.ts`, `resolve-msp-id.ts` (all 4 exports), `sow-expiry-sweep.ts`,
`productTypeConfig.ts`, `msp-entitlement.ts`, `seed-system-workflows.ts`, `workflow-executor.ts`
(the `charge_msp_card` and `approval_gate` handlers), `customer-tenant-alert-engine.ts` (the
`billing.sow_signed` condition), `requireAuth.ts`. Verified live against local PostgreSQL —
`msp_sows`, `sales_offers`, `msp_charges`, `msp_customer_clickwraps` schemas all confirmed to match
the Drizzle source exactly, including the real FK constraints (§6b's finding was only visible via
the live `\d sales_offers` FK listing, not the TypeScript source's `.references()` call alone — both
say the same thing, but the live check is what confirmed no migration since had quietly repointed
it).

Three real findings filed as sibling sub-issues of #2568: **#2725** (§6a, `bug`+`security`),
**#2730** (§6b, `bug`), **#2731** (§6c, `bug`) — all milestone v1.1, board status "AI Batter Up".
§6d–e flagged, not filed, as comment-only mismatches below the filing threshold this project's
other contract packs use. Zero orphaned-endpoint sub-issues filed — every route in this pack is
pre-#2568-scaffold unconsumed, the expected state. No product code, schema, or UI was changed by
this pass.
