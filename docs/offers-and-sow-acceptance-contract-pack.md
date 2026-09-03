# Offers and SOW Acceptance (Portal) — contract extraction pack

**Issue:** #2448, part of #1657 ("Feature: Offers and SOW Acceptance (Portal)"), part of
#1485 (EPIC: Portal). Method per #1642. Extracted, not authored — every field below
traces to one of the files listed, cited to file:line. This is Phase 2 of the Portal
build order (architect → build the endpoints → regenerate the contract pack → Design →
wire) — no page/UI-shape decisions are made here.

All 7 endpoints named in #2448's Step 1 were confirmed real and live in the current
codebase before any of this was written:

- `GET /api/platform/agreement/current` — `platform-agreements.ts:30`
- `GET /api/portal/offers` — `portal-offers.ts:133`
- `GET /api/portal/offers/:id` — `portal-offers.ts:166`
- `GET /api/portal/offers/sse` — `portal-offers.ts:91`
- `GET /api/portal/presentations/:id` — `portal-presentations.ts:423`
- `GET /api/portal/presentations/:id/sow-document` — `portal-presentations.ts:672`
- `POST /api/portal/presentations/:id/sign` — `portal-presentations.ts:775`

Two adjacent routes not in #2448's named list are pulled in because they feed the same
customer-facing flow and this pack would otherwise document `:id` in isolation from its
own siblings:

- `POST /api/portal/offers/:id/accept`, `POST /api/portal/offers/:id/reject` —
  `portal-offers.ts:214, 285` (the only two state-changing actions the offers list/detail
  routes lead to)
- `GET /api/portal/presentations/latest` — `portal-presentations.ts:398` (the entry point
  a caller uses to resolve *which* presentation id to fetch; it has one confirmed live
  caller today, see the Orphaned-endpoint check)

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/portal-offers.ts` — all 5 routes
- `artifacts/api-server/src/routes/portal-presentations.ts` — the 3 named routes plus
  `latest`, and the shared helpers `deriveEffectiveSowData()`, `resolveScopeAwarePrice()`,
  `computeSignalDrivenAdjustments()`
- `artifacts/api-server/src/routes/platform-agreements.ts` — all 6 routes (public,
  MSP-authenticated, and admin tiers), read in full because §4's finding depends on
  understanding who this endpoint actually authenticates and scopes for
- `artifacts/api-server/src/lib/sales-offer-engine.ts` — `persistSalesOfferCandidates()`,
  `transitionOfferState()` (confirms `salesOffersTable.customerId`'s real semantics, see §5)
- `artifacts/api-server/src/lib/sow-pricing.ts` — `stripStagedForReviewBanner()`,
  `stripTierDetectionText()`, `WORKSTREAM_ADJ_MAP`, `ADJ_SIGNAL_PATTERNS`
- `artifacts/api-server/src/lib/tenant-signals.ts` — `resolveSiblingUserIds()`,
  `computeTenantSignals()`, `getAdjustmentSignalDefinitions()`
- `artifacts/api-server/src/lib/sse-channels.ts` — `registerCustomerOfferSSEClient()`,
  `broadcastCustomerOfferChange()`, `broadcastMspOfferChange()`
- `artifacts/api-server/src/lib/project-sow-fulfillment.ts` — `fulfillAcceptedProjectOffer()`
- `artifacts/api-server/src/middlewares/requireAuth.ts` — `AuthUser` shape, `requireRole()`
- `lib/db/src/schema/index.ts` — `salesOffersTable`, `quickWinPresentationsTable`,
  `insightsGeneratedDocumentsTable`, `presentationDocViewsTable` (real column/enum sources)
- `lib/db/src/schema/msp.ts` — `platformAgreementsTable`, `mspAgreementAcceptancesTable`
- `artifacts/shane-mccaw-consulting/src/hooks/usePersonalizationData.ts` — the one
  confirmed live caller of `GET /portal/presentations/latest` (§7)
- Archived old portal-v2 (`git show portal-archive-2026-08-29:artifacts/msp-portal/src/pages/customer-offers.tsx`)
  — read once, for §4's finding only, to establish what the retired page actually did
  with `platform/agreement/current`. Not used as a source of field shapes or vocabulary
  anywhere else in this pack, per the standing rule that the old page is a signal about
  which endpoints exist, not a design target.

---

## 1. Wire contract — `GET /api/portal/offers`

Auth: `requireRole("CustomerUser")` (`:135`).

No query params. Response: `{ offers: CustomerOffer[] }` (`:156`) — a projected,
customer-safe shape (`:44-56`), never the raw `salesOffersTable` row (no
`firedSignalKeys`, `engineSnapshot`, `score`, `basePriceCents`, `internalCostCents`,
`priceCents`, `idempotencyKey`, `serviceId`, or `mspId` — all internal-only):

| Field | Type | Nullability | Source |
|---|---|---|---|
| `id` | `number` | not null | `sales_offers.id` |
| `title` | `string` | not null | `sales_offers.title` |
| `rationale` | `string \| null` | nullable | `sales_offers.rationale` |
| `adjustedPriceCents` | `number` | not null, default `0` | `sales_offers.adjusted_price_cents` — the real, engine-adjusted USD-cents price; the customer never sees `basePriceCents` or `priceCents` |
| `state` | `"sent" \| "accepted" \| "rejected" \| "expired"` | not null (a customer never sees `"draft"`, see §2/§6) | `sales_offers.state` |
| `expiresAt` | `string \| null` (ISO) | nullable | `sales_offers.expires_at` |
| `sentAt` | `string \| null` (ISO) | nullable | `sales_offers.sent_at` |
| `acceptedAt` | `string \| null` (ISO) | nullable | `sales_offers.accepted_at` |
| `closedAt` | `string \| null` (ISO) | nullable | `sales_offers.closed_at` |
| `rejectionReason` | `string \| null` | nullable | `sales_offers.rejection_reason` |
| `createdAt` | `string` (ISO) | not null | `sales_offers.created_at` |

Scoping (`:150`): `eq(salesOffersTable.customerId, customerId)` where `customerId =
req.user.customerId` off the JWT (`:81-84`). **This is a single `eq`, not the
`resolveSiblingUserIds()` bridge** — but that is correct here, not a gap: per
§5, `sales_offers.customer_id` is always written as the *tenant*-level id (the same
value carried in the JWT's `customerId` claim), never a specific `users.id` login row,
so there is no per-login fan-out to bridge across in the first place. This is a
different, and correctly-simpler, scoping shape than the sibling-login bridge that
`portal-presentations.ts` and `portal-documents.ts` need for their `users.id`-keyed
tables.

Row filter (`:144, 151`): `state IN ("sent", "accepted", "rejected", "expired")` — a
`"draft"` offer (not yet sent by the MSP) is never visible to the customer.

Sort: `desc(sentAt), desc(createdAt)` — newest-sent first, no pagination.

---

## 2. Wire contract — `GET /api/portal/offers/:id`

Auth: `requireRole("CustomerUser")`. 400 on non-numeric `:id` (`:178`). 404 if no row
matches `(id, customerId)` (`:194`) or if the row's `state` isn't one of the 4
customer-visible states (`:199`, a second, independent check after the ownership
lookup — a `"draft"` offer 404s here exactly as it's filtered from the list, not merely
hidden from it). Response: `{ offer: CustomerOffer }`, same projected shape as §1.

---

## 3. Wire contract — `POST /api/portal/offers/:id/accept` and `/reject`

Both: auth `requireRole("CustomerUser")`, 400 on non-numeric `:id`, 404 if no row
matches `(id, customerId)`, 422 `{ error: "Only sent offers can be accepted/rejected
(current state: <state>)" }` if `state !== "sent"` (`:247, 320`) — acceptance/rejection
is only legal from `"sent"`, matching `transitionOfferState()`'s own state-machine
guard (re-surfaced as a 422 here, `:273-274, 335-336`, if the engine itself throws
`"Invalid transition..."`).

`/reject` body: `{ rejectionReason?: string }`, trimmed, `undefined` if blank
(`:302`) — free text, no enum.

On success both return `{ offer: CustomerOffer }` (the updated row, re-shaped through
the same customer-safe projection).

Side effects, `/accept` only:
- Broadcasts `offer_changed` on both the customer's and (if `mspId` is set) the MSP's
  SSE channel (`:256-257`) — see §4 for the channel mechanics.
- **Project offers get a real engagement fired off, fire-and-forget** (`:259-268`): for
  a `service_class = "project"` offer, `fulfillAcceptedProjectOffer()` creates the
  `projects` row and kicks off AI-priced SOW generation via the existing
  `document-engine-sow.ts` pipeline — not a flat catalog price, not a second SOW
  engine. A failure here is logged (`log.error`) and never turns the already-committed
  `accept` response into an error; the offer stays `"accepted"` regardless. A
  non-`"project"` offer no-ops inside the helper (out of scope for this pack — see
  `document-engine-sow.ts` for that pipeline's own contract).

`/reject` broadcasts the same two SSE channels with `state: "rejected"` and has no
further side effect.

---

## 4. Wire contract — `GET /api/portal/offers/sse`

**No `requireRole` gate** — auth is done by hand inside the handler (`:91-129`), because
`EventSource` cannot set an `Authorization` header: the JWT is read from `?token=`
instead (`:92`), verified against `JWT_SECRET` (401 if missing/invalid, `:94-105`), and
the stream is keyed by `user.customerId` off that token (403 if absent, `:107-111`).

Response: a `text/event-stream` connection. First frame:
`data: {"type":"connected","customerId":<id>}\n\n` (`:119`). A 30-second `: heartbeat`
comment keeps intermediate proxies from closing the connection (`:121-123`). Subsequent
frames are pushed by `broadcastCustomerOfferChange(customerId, payload)` from
`sse-channels.ts` — the same helper §3's accept/reject routes call — with payload shape
`{ offerId: number, state: "accepted" | "rejected" }` (the two states this codebase
actually broadcasts; `sse-channels.ts` itself is a generic per-customerId client
registry, not a payload-shape enforcer, so this is the real, current, complete set of
event shapes this route ever emits, not a schema guarantee).

---

## 5. Wire contract — `GET /api/portal/presentations/:id`

**No `requireRole` gate** — either JWT ownership or a valid `?token=` share token
authorizes the request (`:434-451`), because this route also serves the
unauthenticated share-link flow. 400 on non-numeric `:id`. 404 if no
`quick_win_presentations` row matches. 403 `{ error: "Access denied" }` unless
`isOwner` (JWT's `id` claim equals `pres.clientUserId` exactly, **not**
sibling-bridged — see the Finding in §9) or `isValidToken` (`token === pres.shareToken`).

Response (`:639-665`) is large and computed, not a straight row projection:

| Field | Type | Nullability | Source |
|---|---|---|---|
| `id` | `number` | not null | `quick_win_presentations.id` |
| `projectId` | `number \| null` | nullable | `.project_id` |
| `clientUserId` | `number \| null` | nullable | `.client_user_id` |
| `shareToken` | `string \| null` | nullable | `.share_token` |
| `documents` | `Document[]` | `[]` if none | merged snapshot (`.documents_included`) + live approved/delivered docs for the same project/customer (`:456-511`), each with `htmlContent` run through `stripTierDetectionText(stripStagedForReviewBanner(...))` (`:513`) |
| `sowPhases` | `SowPhaseObj[]` | `[]` if none | `deriveEffectiveSowData()` — see the 3-priority derivation below |
| `selectedPhaseIds` | `string[]` | `[]` if none | same derivation |
| `totalPrice` | `number` (dollars, **not** cents) | not null (`0` if empty) | same derivation — see the Finding in §9 for why this unit matters |
| `adjustmentsTotal` | `number` (dollars) | not null | signal-driven, see below |
| `adjustmentLines` | `Array<{title, description, price}>` | `[]` if none | same |
| `sowVersion` | `string` | not null | `computeSowVersion()` — `"<phaseId>:<price>\|..."` fingerprint, not a semantic version |
| `signatureData` | `string \| null` | nullable | `.signature_data` |
| `signedAt` | `string \| null` (ISO, raw column, not re-serialized) | nullable | `.signed_at` |
| `signerName` | `string \| null` | nullable | `.signer_name` |
| `paymentPlan` | `"full" \| "phased" \| null` | nullable | `.payment_plan` |
| `status` | `"draft" \| "signed" \| "paid"` | not null, default `"draft"` | `.status`, auto-synced from Stripe first if a session exists and isn't already `paid`/`signed` (`:563-580`, terminal-state guard: signing is never regressed back to `paid` by a replayed webhook) |
| `projectTitle` | `string \| null` | nullable | `.project_title` ?? joined `projects.title` |
| `clientName` | `string \| null` | nullable | joined `users.name` |
| `contractBody` | `string \| null` | nullable | service-linked `contract_templates.body` with `{{client_name}}` / `{{service_name}}` / `{{price}}` / `{{date}}` / `{{selections_summary}}` placeholders interpolated (`:538-558`); `null` if no service-linked template exists |
| `workflowName` | `string \| null` | nullable | joined `workflow_templates.name` |
| `scopedSowHtml` | `string \| null` | nullable | `.scoped_sow_html`, returned only if the stored scoped SOW still passes the drift check below; otherwise `null` even if the column is populated |
| `scopedTotalPrice` | `number \| null` (dollars) | nullable | `.scoped_total_price / 100` (the column itself is integer **cents** — this is the one field in this response that is genuinely cents-stored and dollar-converted) |
| `scopedPhaseIds` | `string[] \| null` | nullable | `.scoped_phase_ids`, same validity gate |
| `discountedTotalCents` | `number \| null` | nullable | `.discounted_total_cents` — the one field in this whole response whose name correctly says "Cents" and means cents |
| `phaseGenCompleted` | `boolean` | not null | `true` iff `.sow_phases` is a non-empty array (`:636-637`) — deliberately **not** derived from `sowPhases.length` in the response, because that field can be non-empty from the always-present fallback path even when AI phase generation hasn't run |

**`sowPhases`/`totalPrice` 3-priority derivation** (`deriveEffectiveSowData()`,
`:113-340`), all three converging on the same `SowPhaseObj[]` + dollar-total shape:

1. **AI-generated phases** (`:184-220`) — if `quick_win_presentations.sow_phases` holds
   entries whose `id` all start with `"sow-"`, those are authoritative. Selected-phase
   total + signal-driven adjustments (below) = `effectiveTotalPrice`.
2. **SOW document pricing lines** (`:222-316`) — else, if a `consolidated_sow`/`sow`
   `insights_generated_documents` row (from the presentation's own docs, or the
   project's latest approved/delivered one) has non-empty `sowPricingLines`, each
   non-`"adjustment"`-tagged line becomes a synthetic phase `id: "sow-{i}"`.
   Adjustment total: **signal-driven when available** (see below), else a legacy
   fallback that scopes adjustment lines by which workstream types are present
   (`WORKSTREAM_ADJ_MAP`) and strips accidental subtotal/grand-total rows.
3. **Creation-time snapshot fallback** (`:318-339`) — else, the presentation's own
   `.sow_phases` as originally stored, with adjustments hardcoded to `0` (no line-level
   detail exists at this priority).

**Signal-driven adjustments** (`computeSignalDrivenAdjustments()`, `:39-111`): the
client's *currently fired* tenant signals (recomputed live from `client_m365_profiles`
+ the last 50 completed `script_run_results`, the same evaluation used when the SOW was
generated) decide *which* `ADJ_SIGNAL_PATTERNS`-mapped adjustment lines count toward
the total — never a hardcoded or stale set. A DB error here is a caught failure
(`success: false`), not a thrown exception — callers fall back to the legacy
workstream-scoped method and log a warning; a **successful** computation that fires
zero adjustment signals is `adjustmentsTotal: 0` by design, not a failure state.

**Scoped-SOW drift guard** (`:582-623`): a previously-generated `scopedSowHtml` /
`scopedTotalPrice` / `scopedPhaseIds` is only trusted if it still matches the *live*
SOW pricing, checked two ways — primary: `scopedSowVersion` string equality against the
freshly computed `sowVersion`; secondary (for legacy rows with no stored version):
total-price arithmetic re-derivation within `$0.005`. Either mismatch wipes the stale
scoped columns to `null` in the DB and the response returns `scopedSowHtml: null` etc.
for that request — the client must regenerate.

Side effect: on a caller's **first** visit (`isOwner && !pres.firstVisitedAt`),
`firstVisitedAt` is stamped (`:626-630`) — the anchor for a 72-hour "pay today" discount
window elsewhere in the checkout flow (not itself part of this endpoint's response).

---

## 6. Wire contract — `GET /api/portal/presentations/:id/sow-document`

Same id/token/ownership pattern as §5, plus an **admin** carve-out
(`isAdmin`, a separate `users.role === "admin"` lookup, `:691-695`) not present on §5.

**Response is raw HTML, not JSON** (`Content-Type: text/html`) — a full standalone
document (inline `<style>`, page title from the resolved SOW's own title) meant to open
directly in a new tab, not to be consumed as a structured API response.

Content resolution order (`:697-745`):
1. The presentation's own `scoped_sow`-typed `insights_generated_documents` row
   (matched by `projectId` if known, else `clientUserId`).
2. Else, the latest `sow`/`consolidated_sow`-typed row for the same `clientUserId`.
3. Else, `pres.scopedSowHtml` stored directly on the presentation row.
4. Else, 404 `<p>Scope of Work document not available.</p>` (HTML body, not a JSON
   error — this route never returns JSON on any path).

`htmlContent` (from an `insights_generated_documents` row) is run through
`stripStagedForReviewBanner()` only — **not** `stripTierDetectionText()`, unlike §5's
`documents` array. `pres.scopedSowHtml` (path 3) is served completely raw, through
neither strip function.

---

## 7. Wire contract — `POST /api/portal/presentations/:id/sign`

Auth: `requireAuth` (any authenticated login, not role-gated to `CustomerUser`). Body:
`{ signatureData: string, signerName: string }`, 400 if either is missing (`:781-783`).

Ownership (`:788-792`): **`resolveSiblingUserIds()`-bridged**, unlike §5/§6's exact-id
match — signing is explicitly allowed from *any* login of the customer account
(`#1397`, the recreated-login case), while viewing (§5) is not. 404 if no presentation
matches `(id, clientUserId ∈ siblingIds)`.

The binding price is resolved via `resolveScopeAwarePrice()` (`:797`) — **not**
`deriveEffectiveSowData()` directly — because a scope reduction changes the price that
must be signed for. `resolveScopeAwarePrice()` re-runs the same drift check as §5's
scoped-SOW guard and returns the *scoped* total only if it's still valid; otherwise the
full consolidated total.

Writes `signatureData`, `signerName`, `signedAt = now()`, `status: "signed"` (`:804-812`)
unconditionally — there is no state-machine guard here: a `"paid"` presentation can be
re-signed back to `"signed"` by this route with no check, and the code comment at
`:801` describes an `"active"` status this table's own enum (`"draft" | "signed" |
"paid"`, `msp.ts` schema) does not contain — see the Finding in §9.

Response: `{ ok: true, signedAt: <ISO>, effectivePriceCents: <the dollar total>,
scopedPhaseIds: pres.scopedPhaseIds ?? null }` — **the field named
`effectivePriceCents` is not cents**, see the Finding in §9.

No workflow event is emitted at signing (`:814-818`, deliberate — `agreement_signed`
fires later from the Stripe webhook once a payment method is confirmed, so signing
alone never races `create_phased_invoices`).

---

## 8. Wire contract — `GET /api/platform/agreement/current`

**Public, no auth** (`:30`). Response: `{ agreement: PlatformAgreement | null }` — `null`
is a real, valid state (`:38-41`, no agreement has ever been published), not an error.

| Field | Type | Nullability | Source |
|---|---|---|---|
| `id` | `number` | not null | `platform_agreements.id` |
| `version` | `string` | not null | `.version` — free text, no enum |
| `title` | `string` | not null, default `"Platform MSA + DPA"` | `.title` |
| `body` | `string` | not null | `.body` — full agreement text, plain string, no markdown/HTML contract implied by the schema |
| `publishedAt` | `string \| null` (ISO) | nullable | `.published_at` |
| `isCurrentVersion` | `boolean` | not null | `.is_current_version` — the row this route filters on (`eq(..., true)`) |
| `createdAt` / `updatedAt` | `string` (ISO) | not null | `.created_at` / `.updated_at` |

**This endpoint's real scope is Shane ↔ MSP, not customer ↔ offer** — see the Finding
in §9. Two sibling routes exist on the same router but are out of #2448's named list
and are noted here only for completeness: `GET /api/platform/agreement/acceptance-status`
and `POST /api/platform/agreement/accept`, both `requireAuth`-gated and both operating
on `msp_agreement_acceptances` keyed by `(userId, agreementVersion)` with `mspId` off
`user.mspId` — an MSP-tenant concept a `CustomerUser` login does not carry (see §9).

---

## 9. Findings

### 9a. `POST /portal/presentations/:id/sign` returns a field named `effectivePriceCents` whose value is dollars, not cents

`resolveScopeAwarePrice()` → `deriveEffectiveSowData()` computes its total by summing
`SowPhaseObj.price` values, which are dollar amounts throughout the file — confirmed by
the scoped-SOW drift check at `:385, 610` (`storedDollars = pres.scopedTotalPrice /
100`, i.e. the *only* genuinely-cents column in this flow is divided by 100 before
being compared against `deriveEffectiveSowData`'s output on equal footing). The `/sign`
route destructures that same dollar value and renames it `effectivePriceCents`
(`:797, 823`) with no `* 100` conversion anywhere in between.

Every other cents-named field this pack documents — `adjustedPriceCents` (§1),
`discountedTotalCents` (§5) — genuinely holds cents. `effectivePriceCents` is the one
exception: any caller that trusts its own name and feeds this value into a cents-typed
API (e.g. a Stripe `amount` parameter, or anything alongside `discountedTotalCents`)
would be off by a factor of 100. No live frontend caller of `/sign` exists today (§10),
so nothing is currently mis-billed by this — but the response contract itself is wrong,
not just a naming quibble, since the field name is the only signal a future caller has
for which unit to expect.

Filed as **#2511**, sibling of this issue's own Feature parent #1657, labeled `bug`.

### 9b. `platform/agreement/current` is an MSP-tenant agreement, not an offer/SOW-acceptance concept — the old page's use of it does not generalize

The retired portal-v2's `customer-offers.tsx` fetched this route to show a "Review &
Accept Platform Agreement" dialog before a customer proceeded to pay for an accepted
offer (confirmed via `git show portal-archive-2026-08-29:...customer-offers.tsx:623`).
But `platform_agreements` / `msp_agreement_acceptances` are, by the route file's own
header comment (`platform-agreements.ts:1-16`) and schema comments
(`msp.ts:1147-1150, 1169-1171`), Shane's platform MSA/DPA that an **MSP** accepts once
per account — `POST .../accept` records `mspAgreementAcceptancesTable` keyed to
`(user.mspId, user.id, agreementVersion)`. A `CustomerUser` login has no `mspId` in the
MSP sense this table means (`platform-agreements.ts:134-135` reads `user.mspRole`/
`user.mspId`, both MSP-account concepts).

The old page never actually called `POST .../accept` from the customer flow (confirmed:
only the `GET .../current` display-and-checkbox gate is wired, no accept call anywhere
in that file) — the checkbox was UI-only, gating a client-side "Continue to Payment"
button, never persisted anywhere. So this was not a live data-corruption bug in
portal-v2; it was a display-only reuse of the wrong agreement's text as a stand-in for
"terms the customer must accept before paying," with no real per-customer,
per-offer acceptance record ever created. **This Feature has no endpoint today that
records a customer's own acceptance of a specific offer's terms** — flagged for Design
awareness, since if a genuine "customer accepts these terms for this offer" record is
needed (as distinct from the presentation `sign` flow in §7, which does record a
signature+name+timestamp), it does not yet exist and `platform_agreements` is the wrong
table to reach for. Not filed as a bug — there is no current live customer-facing
consumer of `platform/agreement/current` to be actively broken by this (see §10).

### 9c. Stale code comment names a `"active"` status the enum doesn't have

`portal-presentations.ts:801`'s comment reads "Signing is allowed when status is
'active' (normal) or 'signed' (re-sign idempotency)" — but
`quick_win_presentations.status`'s real enum is `"draft" | "signed" | "paid"`
(`index.ts:2749`); there is no `"active"` value and, as noted in §7, the route in fact
applies no status check at all before signing. Low severity — the comment is simply
wrong/stale, not a behavioral gap — flagged for awareness, not filed.

---

## 10. Honest-empty / partial-data contract

- **`GET /api/portal/offers`**: a customer with zero visible offers gets a real `[]`
  (`:156`) — no fixture branch. Caught DB errors return `500 { error: "Failed to load
  offers" }` (`:158-159`).
- **`GET /api/portal/offers/:id`**, **`/accept`**, **`/reject`**: 404 with an explicit
  `{ error: "Offer not found" }` for both "doesn't exist" and "not yours" — the route
  never distinguishes those two cases in its response, by design (no ownership-leak
  signal).
- **`GET /api/platform/agreement/current`**: `{ agreement: null }` is the real,
  intentional "nothing published yet" state (`:38-41`), not an error — a caller must
  render an actual empty/no-agreement state, not assume a network failure.
- **`GET /api/portal/presentations/:id`**: no "genuinely empty" state exists for the
  presentation itself (404 if missing) — `documents: []` and `sowPhases: []` are the
  real empty states for those sub-fields when a presentation exists but has no linked
  documents/pricing yet (the fallback-of-fallbacks bottoms out at truly empty arrays,
  `:326-339`).
- **`GET /api/portal/presentations/:id/sow-document`**: the 404 path returns an HTML
  `<p>` string, not a JSON error body — this route never returns JSON on any path (§6).

---

## 11. Cross-surface edges

- **`insights_generated_documents` reads, again** — this pack's §5/§6 read the same
  table the Documents pack (`docs/documents-contract-pack.md` §2) and Customer Home
  pack (`docs/customer-home-and-timeline-contract-pack.md` §1) already document, each
  scoping it differently: this pack's `:id` route scopes by `projectId` when known,
  else a single `eq(customerId, pres.clientUserId)` (`:461-465`) — **not**
  sibling-bridged, same shape as the Customer Home Dashboard's own flagged gap (#2499)
  — a document visible via a sibling login might not surface into a presentation
  resolved under a different login's `clientUserId`. Not filed as a new bug here since
  it is the same already-tracked pattern as #2499, not a new instance to duplicate —
  noted for Design's awareness that this is a systemic scoping inconsistency across
  three packs now, not isolated to one route.
- **`document-engine-sow.ts` pipeline** (§3): offer acceptance kicks off the same
  AI-priced SOW generation pipeline that presumably populates the
  `insights_generated_documents` rows §5/§6 read — this pack does not open that
  pipeline's own contract, only confirms the hand-off point exists.
- **Stripe webhook** (§5, §7): `agreement_signed` and payment-status sync both live
  outside this pack's named routes (in the Stripe webhook handler) — §5's auto-sync
  read is the only Stripe-adjacent logic actually inside a route this pack documents.

---

## Orphaned-endpoint check

```
grep -rn "platform/agreement\|portal/offers\|portal/presentations" artifacts/portal/src artifacts/msp-website artifacts/shane-mccaw-consulting
```

Real result: **one live caller**, and it is not in `artifacts/portal` (the new #1485
scaffold has no page for this Feature yet — no `Design/portal/` export exists for
Offers/SOW Acceptance either):

- `artifacts/shane-mccaw-consulting/src/hooks/usePersonalizationData.ts:291` calls
  `GET /api/portal/presentations/latest` from the **marketing site**, gated to
  `tier === "assessment"` — an assessment-tier visitor's "does a priced deliverable
  already exist for me" check, per that hook's own header comment (`:264-274`). This is
  a real, live, currently-exercised caller of one of this pack's endpoints, sitting
  outside the customer portal entirely.

Every other route in this pack — `platform/agreement/current`, all 5 `portal/offers*`
routes, and `portal/presentations/:id` / `/sow-document` / `/sign` — has **no** current
frontend caller anywhere in the tree. That is real, current state (the only prior
caller, old portal-v2, was retired 2026-08-29) — Design should build against these 7 (+
2 pulled-in sibling) real, live, unexercised endpoints, not treat the absence of a
caller as evidence something is broken.

---

## Not covered by this pack

Per #2448 Step 3, no page/UI-shape decisions are made here. `msp-sow.ts` (the
MSP/admin-side SOW authoring surface, 1261 lines, a separate router entirely) and
`document-engine-sow.ts` (the AI SOW-generation pipeline §3/§11 hand off into) are not
analyzed beyond the hand-off points noted above — they are not part of this Feature's
named endpoint list. The admin tier of `platform-agreements.ts`
(`/admin/platform-agreements*`, `PlatformAdmin`-only CRUD) is documented in §8 only to
the extent needed to establish §9b's finding; it is not a customer-facing surface and
is out of scope for Design under this Feature.
