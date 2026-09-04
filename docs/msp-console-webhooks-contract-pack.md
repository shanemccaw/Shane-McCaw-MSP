# MSP Console Webhooks — contract extraction pack

**For Claude Design. Extracted, not authored — every claim below is cited to file:line against
the code on `main`.** Read-only build: no product code, no schema, no UI were changed to produce
this document.

Module: **Webhooks (MSP Console)**, the operator half of Webhooks (leaf issue #2738, Feature
#1693, portal-admin epic #1571). Real backend exists as of #2704: `msp-console-webhooks.ts`,
against the same `outbound_webhooks`/`outbound_webhook_deliveries` tables the customer/owner side
(`webhooks.ts`, extracted at `docs/webhooks-contract-pack.md`, #1597) already writes.

**This pack replaces `docs/msp-webhooks-inbound-contract-pack.md` (#2610) for this Feature.** That
earlier pack extracted the wrong file — `msp-webhooks.ts`, an unrelated inbound Stripe/billing
receiver with zero MSP-operator surface over outbound webhooks (see #2700's own finding, restated
in #2704's body). Do not consult it for this module; it documents a different route entirely.

**Frontend: none yet.** `artifacts/msp-console` does not exist — #1693 is blocked on #1680, which
scaffolds it. Per this module's own file header (`msp-console-webhooks.ts:30-33`), this is
backend-only, same order-of-work as every other #1485/#1571 module: architect → build the
endpoints → contract pack (this document) → Design → wire. The routes below are real and callable
today; nothing renders them yet.

**Live-data fact, stated up front because it decides how Design should read every field below:**
queried this session against the local `DATABASE_URL` (2026-09-04), `outbound_webhooks` = **0**
rows and `outbound_webhook_deliveries` = **0** rows, platform-wide. There is currently no customer
or MSP anywhere in this database with a registered outbound webhook. **Every screen this module
draws is the honest-empty state today** — Design must draw the populated state from the shapes
below, but the state a live operator sees right now, for any customer, is empty.

---

## 0. The two surfaces of this module

| # | Surface | File | Audience | Writes? |
|---|---|---|---|---|
| A (owner) | `/api/portal/webhooks/*` | `artifacts/api-server/src/routes/webhooks.ts` | Customer/MSP as **owner** of their own endpoint (create/edit/delete/rotate/list/deliveries) | yes |
| B (operator) | `/api/msp/webhooks/event-types`, `/api/msp/customers/:customerId/webhooks*` | `artifacts/api-server/src/routes/msp-console-webhooks.ts` | MSP operator, reaching into a **specific customer's** book | yes (disable/enable only) |

**This pack covers B only.** A is already fully extracted at `docs/webhooks-contract-pack.md`
(#1597) and is cited here only where B's own fields depend on it (the event catalog, the
disable/enable reset behavior). Registered at `artifacts/api-server/src/routes/index.ts:459`
(`router.use(mspConsoleWebhooksRouter)`, imported line 127), mounted under `/api`
(`artifacts/api-server/src/app.ts:112`, `app.use("/api", router)`).

**Deliberately narrower than A.** Per #1693's own body, quoted in the module's file header
(`msp-console-webhooks.ts:4-20`): *"Customer configures their own webhook endpoints. The MSP can
see, manage and disable them."* B never writes `label`/`url`/`eventTypes`/`secret` — those stay
owner-only via A. #1693 explicitly leaves "can the operator create or edit an endpoint on the
customer's behalf?" **undecided** (`msp-console-webhooks.ts:17-20`): *"Disable is clearly right;
create is less obviously so."* So create/edit/delete/rotate-secret have **no operator-side route
at all** — not a gap, a deliberate scope line. See §6 (forbidden list) and §7 (open questions).

---

## 1. Per-endpoint wire contract (surface B)

Every route requires `requireRole("MSPOperator")` (`msp-console-webhooks.ts:139,149,182,224,283,338`
— MSPOperator or above per the real role order, `requireAuth.ts:80-88`:
`Assessment < Free < CustomerUser < ServiceAccount < MSPOperator < MSPAdmin < PlatformAdmin`) and,
on every `:customerId`-scoped route, `assertCustomerAccess(req.user!, customerId)`
(`requireAuth.ts:295-...`) — `PlatformAdmin` always passes; `MSPAdmin`/`MSPOperator` must have the
target customer's `tenants.mspId` match `user.mspId`, and additionally must not be blocked by a
per-staff-member customer-scope row (`isCustomerBlockedByStaffScope`). A 403 with
`{ error: "Not authorized for this customer" }` is returned on failure
(`msp-console-webhooks.ts:159-162`, repeated identically at every scoped route). This is
deliberately different from A's own `resolveOwner()` scoping (caller owns the webhook); here the
operator is reaching into a customer's book they don't own themselves, so the check is
MSP-owns-this-tenant, not caller-owns-this-webhook (`msp-console-webhooks.ts:22-28`).

### 1a. `GET /api/msp/webhooks/event-types` — `msp-console-webhooks.ts:137-143`

Not customer-scoped. Returns the same real, currently-dispatchable catalog A's own
`/api/portal/webhooks/event-types` serves (`webhooks.ts:108-110`), re-exported verbatim
(`SUBSCRIBABLE_EVENT_TYPES`, imported `msp-console-webhooks.ts:58`) so the future console doesn't
need portal-scoped auth just to read it.

```
{ eventTypes: string[] }   // SUBSCRIBABLE_EVENT_TYPES, webhooks.ts:27-43 — see §3
```

### 1b. `GET /api/msp/customers/:customerId/webhooks` — `msp-console-webhooks.ts:147-176`

List every webhook the customer owns, newest first (`orderBy(desc(createdAt))`, `:168`).

```
{ webhooks: WebhookRow[] }   // never null, may be []
```

### 1c. `GET /api/msp/customers/:customerId/webhooks/:webhookId` — `msp-console-webhooks.ts:180-216`

Single row, scoped to `webhookId` **and** `customerId` together (`:201`) — a webhook id that
exists but belongs to a different customer 404s exactly like one that doesn't exist at all; the
route never leaks cross-customer existence.

```
{ webhook: WebhookRow }   // 404 { error: "Webhook not found" } if absent/wrong customer
```

### 1d. `POST /api/msp/customers/:customerId/webhooks/:webhookId/disable` — `msp-console-webhooks.ts:222-276`

Reversible — sets `isActive: false` and records who/when/why on the MSP side; never touches
`label`/`url`/`eventTypes`/`secret` (`:20`, `:219-220`).

**Request body**, optional: `{ reason?: string }` — trimmed, capped to 500 chars, empty/whitespace
treated as absent → `null` (`:240-242`).

```
{ webhook: WebhookRow | null }   // null only if the row vanished between the ownership
                                  // check and the UPDATE...RETURNING (race, not a normal path)
```

On success sets, in the same UPDATE (`:255-264`): `isActive = false`,
`disabledByMspUserId = req.user!.id`, `disabledAt = now()`, `disabledReason = <reason or null>`,
`updatedAt = now()`. Logged at `info` (`comms.webhook` channel, `:61`) with `webhookId`,
`customerId`, `mspUserId` (`:267`).

### 1e. `POST /api/msp/customers/:customerId/webhooks/:webhookId/enable` — `msp-console-webhooks.ts:281-332`

The reversal. Sets `isActive = true` and **clears** all three disable-tracking columns
(`disabledByMspUserId`, `disabledAt`, `disabledReason` → `null`, `:314-317`) — it does not merely
flip `isActive`; there is no state where `isActive === true` and the disable-tracking columns are
still populated.

```
{ webhook: WebhookRow | null }   // same null caveat as disable
```

### 1f. `GET /api/msp/customers/:customerId/webhooks/:webhookId/deliveries?limit=N` — `msp-console-webhooks.ts:336-374`

`limit` query param, default 50, hard-capped at 200 (`Math.min(Number(...) || 50, 200)`, `:354`).
Ownership verified against `webhookId` + `customerId` before querying deliveries (`:356-365`) — a
customer-mismatched `webhookId` 404s without ever calling `getDeliveryLog`.

```
{ deliveries: DeliveryLogEntry[] }   // webhook-delivery.ts:310-322, verbatim — no reshaping
```

**`DeliveryLogEntry`** (`webhook-delivery.ts:310-322`), one row per HTTP delivery attempt (retries
produce multiple rows for the same `eventId` — §3 for `status`):

| Field | Type | Nullability |
|---|---|---|
| `deliveryId` | `string` (uuid) | never null |
| `webhookId` | `string` (uuid) | never null |
| `eventId` | `string \| null` (uuid) | may be null |
| `eventType` | `string` | never null |
| `attempt` | `number` (1-based) | never null |
| `status` | `string` — real union `"pending" \| "success" \| "failed" \| "retrying"` (§3) | never null |
| `statusCode` | `number \| null` (HTTP status from the target) | null until an attempt completes |
| `responseSnippet` | `string \| null` | null until an attempt completes |
| `nextRetryAt` | `Date \| null` | null unless `status === "retrying"` |
| `deliveredAt` | `Date \| null` | null until `status === "success"` |
| `createdAt` | `Date` | never null |

---

## 2. `WebhookRow` — the shared per-endpoint shape (1b/1c/1d/1e)

Built from `WEBHOOK_ROW_COLUMNS` (`msp-console-webhooks.ts:72-87`, a literal Drizzle column-select
map — there is no named server-side `interface Wire*`, same situation A's own pack already noted
for `webhooks.ts`), then passed through `shapeRows()` (`:107-125`) before serialization, which adds
two computed fields not present in the DB row itself.

| Field | Type | Nullability | Source |
|---|---|---|---|
| `webhookId` | `string` (uuid) | never null | `outbound_webhooks.webhook_id` |
| `label` | `string` | never null | owner-set (A only) |
| `url` | `string` | never null | owner-set (A only) |
| `secretPrefix` | `string` | never null | owner-set at creation (A only) — the **full** `secret` column is never selected here (`WEBHOOK_ROW_COLUMNS` omits it entirely, `:72-87`); B cannot read or display the real secret, only its prefix |
| `eventTypes` | `string[]` | never null, may be `[]` | owner-set (A only) |
| `unrecognizedEventTypes` | `string[]` | never null, may be `[]` | **computed**, `shapeRows()` `:122` — subset of `eventTypes` not in `SUBSCRIBABLE_EVENT_TYPES` (§3). Not a DB column. |
| `isActive` | `boolean` | never null | `outbound_webhooks.is_active` |
| `ownerType` | `"msp" \| "customer" \| "platform"` | never null | `outbound_webhooks.owner_type` (real DB `text` enum, `msp.ts:1082`) |
| `mspId` | `number \| null` | null unless `ownerType === "msp"` | `outbound_webhooks.msp_id` |
| `customerId` | `number \| null` | null unless `ownerType === "customer"` | `outbound_webhooks.customer_id` — tenants.id space, no FK by design (`msp.ts:1084`) |
| `disabledByMspUserId` | `number \| null` | null unless MSP-disabled | `outbound_webhooks.disabled_by_msp_user_id` |
| `disabledByName` | `string \| null` | null unless MSP-disabled | **computed**, `shapeRows()` `:106-118` — batch-resolved display name (`usersTable.name`, falls back to `email` if `name` is blank/whitespace); `null` when `disabledByMspUserId` is null. Not a DB column. |
| `disabledAt` | `string \| null` (ISO, JSON-serialized `Date`) | null unless MSP-disabled | `outbound_webhooks.disabled_at` |
| `disabledReason` | `string \| null` | null unless MSP-disabled AND a reason was given | `outbound_webhooks.disabled_reason` |
| `createdAt` | `string` (ISO) | never null | `outbound_webhooks.created_at` |
| `updatedAt` | `string` (ISO) | never null | `outbound_webhooks.updated_at` |

**Never present in this shape:** the full `secret`. B has no route that returns it, ever — not
even to re-display; that stays A-only (owner's own `POST .../rotate-secret`,
`webhooks-contract-pack.md §6`), and B's disable action doesn't touch it either.

---

## 3. Real enum unions only

**`WebhookRow.ownerType`** — real DB `text` enum (`outbound_webhooks.owner_type`, `msp.ts:1082`):
`"msp" | "customer" | "platform"`. Per §1693's scope, B is dispatched for the customer-facing case
(`:customerId` route param), but the schema and `WEBHOOK_ROW_COLUMNS` projection do not filter out
`msp`/`platform`-owned rows structurally — the `WHERE customerId = :customerId` clause is what
actually scopes every query (`:167`, `:201`, `:247`, `:303`, `:359`); a row with `ownerType !==
"customer"` simply never matches a `customerId` filter in practice, since `customerId` is only
populated for `ownerType === "customer"` rows (§2, `msp.ts:1084`).

**`DeliveryLogEntry.status`** — real DB `text` enum (`outbound_webhook_deliveries.status`,
`msp.ts:1123`): `"pending" | "success" | "failed" | "retrying"`. Confirmed against actual write
sites in `webhook-delivery.ts`: `"success"` on a 2xx response (`:149`), `"failed"` when
`isLastAttempt` and it wasn't (`:173`), `"retrying"` for a non-final failed attempt (also `:173`
branch — the ternary's other arm), `"pending"` on initial enqueue (`:290`) and reset on manual
retry (`:211`). No fifth value exists anywhere in the write path.

**`SUBSCRIBABLE_EVENT_TYPES`** (`webhooks.ts:27-43`) — the one real, currently-dispatchable event
catalog, re-exported by B verbatim (`msp-console-webhooks.ts:58,65`), not a second vocabulary:
`Object.values(EVENT_TYPES)` (the canonical `event-bus.ts:241` constant — `auth.login`,
`customer.created`, `msp.suspended`, etc., dozens of entries) **plus** thirteen
platform-specific literals appended in `webhooks.ts` itself: `signal.fired`,
`fulfillment.item.created`, `fulfillment.item.updated`, `offer.accepted`, `offer.rejected`,
`monitoring.run.completed`, `service.activated`, `service.deactivated`, `project.created`,
`project.completed`, `invoice.created`, `invoice.paid`, `contract.signed`. **`signal.fired` is
subscribable but has no dispatch call site anywhere** (`webhooks-contract-pack.md §4(A)`, restated
in this module's own file header `:38-42`). Because `signal.fired` **is** in
`SUBSCRIBABLE_EVENT_TYPES` (line 30), a subscription to it does **not** appear in
`unrecognizedEventTypes` (§2) even though it will never fire —
`unrecognizedEventTypes` only flags event strings absent from the catalog entirely (a typo, a
retired name, a value from a different vocabulary), not catalog entries that are
subscribable-but-dead. That distinction is real and Design should not conflate the two: a webhook
can look fully healthy (`unrecognizedEventTypes: []`) while being subscribed to an event that will
never fire, and B currently has no field that surfaces *that* fact.

---

## 4. The disable/enable ↔ owner-PATCH cross-surface edge

`webhooks.ts`'s own owner-facing `PATCH /api/portal/webhooks/:webhookId` (`webhooks.ts:251-315`),
whenever the request body includes `isActive` (either direction), unconditionally clears all three
MSP-disable-tracking columns in the same UPDATE (`webhooks.ts:285-294`, comment: *"The owner
(customer or MSP) touching isActive directly always clears any MSP-console disable tracking...
the current disabled state (if any) is the owner's own now, not the MSP operator's prior
action."*). So:

- Operator disables via B → `disabledByMspUserId`/`disabledAt`/`disabledReason` populated.
- Owner later flips `isActive` either way via A's PATCH → those three columns are wiped, even if
  the owner's new value happens to also be `false` — the schema's own invariant (`msp.ts:1096`)
  is that the three columns are populated **only** while `isActive === false` **and** the disable
  was MSP-initiated; an owner-driven `false` is a different fact and the columns must not survive
  it.
- Operator re-enables via B's own `enable` route → same three columns cleared (`§1e`).

**Whether the owner is shown, anywhere in A's own UI, that an MSP operator disabled their
endpoint is #1693's own open question, explicitly not decided** (`msp.ts:1096-1098`): *"Whether
the owner is shown this in their own webhook view is #1693's own open question — not decided, not
built here; this only makes the fact recordable."* B makes the fact queryable
(`disabledByName`/`disabledAt`/`disabledReason` on `WebhookRow`); nothing in A's own wire contract
(`docs/webhooks-contract-pack.md`) currently surfaces it to the owner. Real product decision for
Design/Shane, not an extraction gap — see §7.

---

## 5. The honest-empty contract

Confirmed against the real local DB (2026-09-04, `DATABASE_URL`): **zero** rows in
`outbound_webhooks` and **zero** rows in `outbound_webhook_deliveries`, across every owner type.
So for any real customer today:

- `GET .../webhooks` → `{ webhooks: [] }` — never null, an empty array, not an omitted key.
- `GET .../webhooks/:webhookId` → `404 { error: "Webhook not found" }` for every id (there are no
  ids).
- `GET .../webhooks/:webhookId/deliveries` → unreachable today (404s first at the ownership check,
  §1f) — there is no live delivery data to inspect yet at all, not even for a webhook that exists,
  because no webhook exists.
- `GET /api/msp/webhooks/event-types` → the one route in this module **not** dependent on live
  data — always returns the full static catalog (§3), non-empty regardless of tenant state.

Design must draw the populated list/detail/delivery-log states from §§1–3 above, but the state a
real MSP operator sees today, for any customer they open this console against, is the empty list.

---

## 6. The forbidden list — what this module deliberately does NOT serve

- **No create.** No `POST /api/msp/customers/:customerId/webhooks` exists. An operator cannot
  register a new endpoint on a customer's behalf — undecided per #1693 (§0, §7).
- **No edit.** No route lets the operator change `label`/`url`/`eventTypes`. Only `isActive`
  (via disable/enable) is operator-writable.
- **No delete.** No operator-side delete route. Deletion stays owner-only (`webhooks.ts` DELETE).
- **No secret read or rotate.** `WEBHOOK_ROW_COLUMNS` never selects `secret` (§2); there is no
  operator-side rotate-secret route (owner-only, A's own `POST .../rotate-secret`).
- **No cross-customer list.** Every route requires an explicit `:customerId`; there is no
  "list every webhook across all my MSP's customers" endpoint. An operator wanting that view today
  would need to call 1b once per customer.
- **No write to `outbound_webhook_deliveries`.** B is read-only over delivery history — disable/
  enable touch only `outbound_webhooks`; nothing in this module retries a delivery, cancels a
  pending one, or writes a new delivery row.

---

## 7. Open questions for Design — genuine product decisions, not extraction gaps

1. **Should the owner ever see, in their own webhook view, that an MSP operator disabled their
   endpoint (and why)?** #1693 asks this explicitly and does not answer it (§4). B makes the fact
   recordable (`disabledByName`/`disabledAt`/`disabledReason`) but A's own wire contract does not
   currently surface it to the owner — that is a decision for Shane/Design, not something this
   pack can resolve by reading code, since A deliberately doesn't serve it today.
2. **Should an operator ever be able to create or edit an endpoint on a customer's behalf?** #1693
   raises it and leaves it open (§0): *"Disable is clearly right; create is less obviously so."*
   Nothing in B's routes or schema depends on the answer — this is purely a scope decision for a
   future issue if the answer becomes yes.
3. **Should `unrecognizedEventTypes` distinguish "not in the catalog at all" from "in the catalog
   but has no live dispatch call site" (e.g. `signal.fired`, §3)?** Both currently render as
   "healthy" (`unrecognizedEventTypes: []`) despite one of them being effectively dead. Not decided
   anywhere; #1607 (the still-open event-catalog issue referenced in the module's own header) is
   the natural home if Design wants this distinguished.
