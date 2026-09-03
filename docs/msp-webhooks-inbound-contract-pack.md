# MSP Inbound Webhooks (`msp-webhooks.ts`) — contract extraction pack

**For Claude Design. Extracted, not authored — every claim below is cited to file:line against
the code on this branch (based on `main` commit `152ca0acf`).** Read-only build: no product code,
schema, or UI were changed to produce this document; the one live query run is stated in §6.

Dispatched as #2610 ("Webhooks: regenerate the contract pack from the finished backend, #1642
pattern"), parented under **#1693** (Feature: Webhooks (MSP Console)). **Read §0 before drawing
anything from this pack — it does not cover what #1693 asks for.**

---

## 0. Scope correction — `msp-webhooks.ts` is not #1693's backend

#1693's own issue body describes the MSP-console operator half of **outbound** webhooks: *"Customer
configures their own webhook endpoints. The MSP can see, manage and disable them"* — see every
customer endpoint, disable one, read the delivery log, see subscribed events. That module's real
backend is `artifacts/api-server/src/routes/webhooks.ts` (`/api/portal/webhooks/*` +
`/api/admin/webhooks/*`), already fully extracted in `docs/webhooks-contract-pack.md` (#1597). That
pack's own §9 already lists *"Rotate / Edit / Delete buttons render but are unwired despite real
backend support"* as an open gap — but **no MSP-console-side read or disable route exists anywhere
in the codebase.** Confirmed by direct search: no route in `artifacts/api-server/src` selects from
or writes to `outboundWebhooksTable`/`outbound_webhooks` other than `webhooks.ts` itself (portal +
admin only); `artifacts/msp-console` **does not exist** as a directory in this repo at all.

**`msp-webhooks.ts` is a different, unrelated module**, confirmed by reading it end to end: it is
the MSP platform's own **inbound** webhook *receiver* — Stripe billing callbacks and internal
app-to-app HMAC callbacks arriving *into* the platform, at `/api/msp/v1/webhooks/*`
(`msp-webhooks.ts:2`, mounted `msp-v1.ts:61`). It has no relationship to a customer's outbound
webhook endpoints, no `outbound_webhooks` row, and nothing an MSP operator would see, manage or
disable through a UI — it has no UI surface at all; it is a pure server-to-server ingress path. The
build dispatch explicitly warned "verify real behavior don't assume from the filename," and that
warning was correct: the filename pattern-matches #1693's module name, the actual code does not
serve it.

This pack extracts `msp-webhooks.ts` honestly, as real, finished, tested backend code (it is real —
see §6) — but **it answers a different question than the one #1693 asks**, and does not close the
gap that Feature has. §7 states that gap and its filed issue number.

---

## 1. The two surfaces

| # | Route | Purpose | Auth |
|---|---|---|---|
| A | `POST /api/msp/v1/webhooks/stripe` | Inbound Stripe billing events for the MSP's own subscription/billing (checkout, invoice, dunning) | none — HMAC signature only |
| B | `POST /api/msp/v1/webhooks/app-signature` | Inbound platform-to-platform callbacks (provisioning runbooks, async workers, cross-service integrations calling back in) | none — HMAC signature only |

Both are mounted on `msp-v1.ts`'s router (`msp-webhooks.ts` default export, imported
`msp-v1.ts:41`, mounted `router.use("/webhooks", webhooksRouter)` at `msp-v1.ts:61`) **before**
`requireAuth` — `msp-v1.ts`'s own header comment states this explicitly (`msp-v1.ts:9,56`:
*"requireAuth is NOT applied globally — /health is intentionally public"*; the webhook sub-router
is mounted at line 61, ahead of any route that does apply `requireAuth`). This is correct, not an
oversight: Stripe and other external/internal callers cannot present a platform JWT, so signature
verification is the only gate — exactly the same pattern the portal's own outbound-webhook secret
(`docs/webhooks-contract-pack.md` §6) protects deliveries with, mirrored for the inbound direction.

Both routes require the **raw, unparsed** request body for signature verification. `app.ts`
registers `express.raw({ type: "application/json" })` for `/api/msp/v1/webhooks` (`app.ts:106`)
ahead of the global `express.json()` — confirmed live in `app.ts`, matching the route file's own
header comment (`msp-webhooks.ts:21-24`). A request whose body did not arrive as a `Buffer` (i.e.
this raw-body wiring was bypassed or the route reached without it) is rejected `400` at both
handlers (`msp-webhooks.ts:136-140`, `246-250`) rather than crashing on a non-Buffer `.toString()`
call — a defensive check, not dead code: `msp-api-foundation.test.ts:117` independently re-registers
the same raw-body middleware for its own test app, so this guard is exercised by that suite, not
just a route mounted once at boot.

---

## 2. `POST /webhooks/stripe` — wire contract (A)

Source: `msp-webhooks.ts:127-169`. Handles Stripe's own webhook envelope, not a platform-defined
request shape.

**Preconditions, in order, each a distinct failure mode:**

| Check | Failure | Line |
|---|---|---|
| `STRIPE_MSP_WEBHOOK_SECRET` env var set | `503 { code: INTERNAL, message: "Webhook endpoint not configured" }` | `128-133` |
| Body arrived as `Buffer` (raw body) | `400 { code: VALIDATION, message: "Webhook requires raw body — check Content-Type" }` | `135-140` |
| `verifyStripeSignature` passes | `400 { code: WEBHOOK_INVALID_SIGNATURE, message: "Webhook signature verification failed" }` | `142-149` |

**Signature verification** (`verifyStripeSignature`, `:46-96`) reimplements Stripe's own
`t=<ts>,v1=<hmac>[,v1=<hmac>...]` scheme rather than importing the Stripe SDK, stated in the
function's own comment as a deliberate choice to avoid SDK init latency on the webhook path
(`:41-44`):
- Parses every `t=`/`v1=` pair from the header (`:54-64`); **any one** of possibly-multiple `v1=`
  signatures matching is accepted (`:81-87`, Stripe rotates signing secrets by sending both old and
  new signatures during a rotation window — this correctly honours that).
- **Replay protection: rejects an event whose `t=` timestamp is more than 300 seconds (5 minutes)
  from now**, either direction (`Math.abs`, `:69-73`) — logs a `warn` and returns `null` (surfaces
  as the same generic `WEBHOOK_INVALID_SIGNATURE` 400 the caller sees for a bad signature; the two
  failure reasons are not distinguishable from the response alone, only from server logs).
- HMAC-SHA256 over `"${timestamp}.${rawBody}"`, compared with `crypto.timingSafeEqual` (`:76-87`) —
  constant-time comparison, not `===`, so a forged signature cannot be timed to leak how many bytes
  matched. The `try/catch` around `timingSafeEqual` (`:82-86`) exists because it throws on
  mismatched buffer lengths (an attacker-supplied signature of the wrong length would otherwise
  crash the request instead of failing closed) — genuinely defensive, not incidental.
- On success, `JSON.parse`s the raw body (`:91-95`) — a parse failure (malformed JSON despite a
  valid signature) also returns `null`, surfacing as the same `WEBHOOK_INVALID_SIGNATURE` 400.

**Idempotency** (`:151-158`): keyed `` `stripe-msp:${event.id}` `` against `mspId: null` — see §5,
this is a **platform-global** dedup key, not per-tenant. On a cache hit, the exact previously-stored
`statusCode`/`responseBody` is replayed verbatim (`:156`), not re-derived.

**Dispatch** (`handleStripeEvent`, `:102-125`) — **entirely stubbed.** Every one of the five
switch-cased Stripe event types (`checkout.session.completed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`,
`invoice.payment_failed`) does nothing but fall through a `// TODO (Billing task): ...` /
`// TODO (Platform Subscription task): ...` comment (`:106-121`) — **no code path in this function
writes to any table, calls any other subsystem, or has any observable side effect beyond the
`log.info` on line 103.** Any other event type falls to the `default` branch, which only logs
`"unhandled event type (no-op)"` (`:122-123`) — the same effective no-op as every explicitly-named
case. This is genuinely dispatchable and reachable (verified: `handleStripeEvent` is `await`ed at
`:161` before the success response is built) — the gap is that the switch bodies are empty, not that
the wiring is missing.

**Response, success (`200`):** `{ received: true, eventId: string, eventType: string }`
(`:162-164`) — built and returned identically whether the event type matched a named case or fell to
`default`; the caller (Stripe) cannot tell from the response whether anything real happened, because
today nothing does.

**Response, handler error (`500`):** `{ code: INTERNAL, message: "Webhook processing failed" }`
(`:165-168`) — currently unreachable in practice since `handleStripeEvent` cannot throw (no
awaited call, no table write inside it that could reject); the `try/catch` is future-proofing for
when the TODOs are filled in, not exercising a real path today.

---

## 3. `POST /webhooks/app-signature` — wire contract (B)

Source: `msp-webhooks.ts:237-288`. Platform-defined envelope (not third-party), so this is the one
surface in this module with a genuine request/response shape this codebase controls.

**Preconditions, in order:**

| Check | Failure | Line |
|---|---|---|
| `APP_WEBHOOK_SECRET` env var set | `503 { code: INTERNAL, message: "Webhook endpoint not configured" }` | `238-243` |
| Body arrived as `Buffer` (raw body) | `400 { code: VALIDATION, message: "Webhook requires raw body — check Content-Type" }` | `245-250` |
| `verifyAppSignature` passes | `400 { code: WEBHOOK_INVALID_SIGNATURE, message: "Webhook signature verification failed" }` | `255-259` |
| Body parses as JSON with both `eventId` and `eventType` present | `400 { code: VALIDATION, message: "Invalid webhook payload — expected { eventId, eventType, payload }" }` | `261-268` |

**Signature verification** (`verifyAppSignature`, `:182-213`) — this module's own scheme, not
Stripe's: two required headers, `X-App-Signature: sha256=<hex>` and `X-App-Timestamp: <unix-seconds>`
(function doc comment `:176-180`). Same 300-second replay window as §2 (`:193-197`), same
HMAC-SHA256-over-`"${timestamp}.${rawBody}"` construction (`:202-206`), same
`crypto.timingSafeEqual` constant-time compare wrapped in `try/catch` for length-mismatch safety
(`:208-212`). A missing `sha256=` prefix on the signature header fails immediately (`:199`) before
any HMAC computation runs.

**Request body shape** (not a named `interface`, inferred at the `JSON.parse` cast, `:261-268`):

| Field | Type | Required | Line |
|---|---|---|---|
| `eventId` | `string` | yes — 400 if falsy | `264` |
| `eventType` | `string` | yes — 400 if falsy | `264` |
| `payload` | `Record<string, unknown>` | typed in the cast, **never read or validated** — passed through to `handleAppCallback` (§ below) but nothing inside that function inspects it | `219`, `261` |

**Idempotency** (`:270-277`): keyed `` `app:${event.eventId}` `` against `mspId: null` — same
platform-global dedup space as the Stripe path (see §5); distinct key prefix (`app:` vs.
`stripe-msp:`) means the two surfaces' event IDs can never collide with each other in the store even
though both use a `null` `mspId`.

**Dispatch** (`handleAppCallback`, `:219-235`) — **also entirely stubbed**, same shape as §2:
`provisioning.completed`, `provisioning.failed`, `health.scan.completed` are the three named cases
(`:223-230`), each a bare `// TODO (...)` comment with no body; `default` logs
`"unhandled callback type (no-op)"` (`:232-233`). `payload` is passed into the function signature
(`:219`) but the function never reads it — confirmed by reading the full function body, no reference
to the `payload` parameter anywhere inside it.

**Response, success (`200`):** `{ received: true, eventId: string, eventType: string }`
(`:281-283`) — `payload` is never echoed back or persisted anywhere.

**Response, handler error (`500`):** same shape and same "currently unreachable" caveat as §2
(`:284-287`) — `handleAppCallback` cannot throw today for the same reason.

---

## 4. Real enum unions

Neither route is backed by a DB `enum` or Drizzle `text(..., { enum: [...] })` column — both are
plain TypeScript `switch` statements over a `string`, so "enum" here means the literal set of cases
each dispatcher actually branches on, not a schema constraint. **Neither list is enforced against
the incoming event** — any string reaches the `default` no-op branch without error.

```ts
// msp-webhooks.ts:106-122 — Stripe event types this route branches on by name
// (Stripe itself defines dozens more; only these five have a named case here)
"checkout.session.completed" | "customer.subscription.created" |
"customer.subscription.updated" | "customer.subscription.deleted" |
"invoice.paid" | "invoice.payment_failed"

// msp-webhooks.ts:223-230 — app-signature callback types this route branches on by name
"provisioning.completed" | "provisioning.failed" | "health.scan.completed"
```

Both lists are **route-local constants embedded in a `switch`**, not exported, not shared with any
other file — confirmed by search: neither list of strings appears anywhere else in
`artifacts/api-server/src`. There is no canonical source of truth for "what Stripe/app event types
this platform recognizes" the way `EVENT_TYPES` (`event-bus.ts:241-277`, cited in
`docs/webhooks-contract-pack.md` §4) is for outbound webhook subscriptions.

**Error codes used** (`api-helpers.ts`, `ApiErrorCode`): `INTERNAL`, `VALIDATION`,
`WEBHOOK_INVALID_SIGNATURE` (`api-helpers.ts:26`) — the same signature-failure code both this module
and the outbound-webhook delivery path would use for an equivalent failure, confirmed as one shared
constant, not a module-local duplicate.

---

## 5. Cross-surface edges and structural facts

- **Shares the idempotency store table with every other `withIdempotency`/`checkIdempotency` caller
  in the codebase** — `mspIdempotencyStoreTable` / `msp_idempotency_store` (schema: `id`,
  `idempotency_key`, `msp_id` nullable, `request_hash`, `status_code`, `response_body` jsonb,
  `processed_at`, `expires_at`; unique index on `(idempotency_key, msp_id)`). Both routes in this
  module pass `mspId: null` explicitly (`msp-webhooks.ts:153,272`, not omitted — an explicit design
  choice since neither Stripe nor an internal callback carries an MSP identity at the point
  signature verification succeeds). This means the dedup key space for both surfaces is
  **platform-global**, keyed only by the caller-chosen key string (`stripe-msp:<id>` /
  `app:<id>`) — collision-safe against every other `null`-mspId idempotency user elsewhere in the
  codebase only because each caller's key prefix is unique by convention, not by any DB constraint
  enforcing prefix namespacing.
- **24-hour default TTL** (`idempotency.ts:20`, `DEFAULT_TTL_SECONDS`) applies to both surfaces —
  neither route passes a custom `ttlSeconds` to `recordIdempotency`. A retried Stripe/app event
  outside that 24-hour window is processed as new, not deduplicated — Stripe's own retry schedule
  (documented externally as up to 3 days for some failure classes) can exceed this window, meaning a
  very late Stripe retry could re-execute `handleStripeEvent` a second time. Not a bug in the code
  read here — a real operational fact worth carrying into any future gap analysis of the (currently
  no-op) dispatch handlers, once they do real work.
- **Idempotency-check failures fail open, not closed** (`idempotency.ts:74-77`,
  `checkIdempotency`'s own `catch`): a DB error while checking for a duplicate returns `null` (i.e.
  "not a duplicate, proceed") rather than rejecting the request — the route logs the error but still
  processes the event. Same for `recordIdempotency`'s `catch` (`idempotency.ts:105-107`) — a failure
  to *record* the dedup entry is silently swallowed, meaning a DB outage during idempotency writes
  degrades this module to "no deduplication," not "reject all webhooks."
- **No relationship to `outbound_webhooks`/`outbound_webhook_deliveries`** (the table pair
  `docs/webhooks-contract-pack.md` documents) — confirmed by search, this file does not import
  `outboundWebhooksTable` or any symbol from `webhook-delivery.ts`. The two modules are entirely
  separate data paths that happen to share the word "webhook."
- **No relationship to the platform event bus** (`event-bus.ts` / `EVENT_TYPES` /
  `dispatchEvent`/`dispatchUnsafe`) either — confirmed by search, `msp-webhooks.ts` does not import
  from `event-bus.ts`. An inbound Stripe event landing here does not, today, trigger the platform's
  own outbound webhook fan-out or any `customer_tenant_alert_rules` condition — the two "event"
  concepts in this codebase (inbound webhook payload vs. platform-internal dispatched event) do not
  connect through this file.

---

## 6. Honest-empty / live-verified state

**Live-queried against the local Postgres instance this session** (`DATABASE_URL` from
`.env.local`): `msp_idempotency_store` = **0 rows** — genuinely empty, not a query error; neither
webhook path has ever fired against local dev. Table schema (columns, the `(idempotency_key,
msp_id)` unique index) confirmed via `\d msp_idempotency_store` in the same session.

**Both required secrets are unset in local dev** — `STRIPE_MSP_WEBHOOK_SECRET` and
`APP_WEBHOOK_SECRET` do not appear in `.env.local` (grepped directly, zero matches for either
name). This means **both routes 503 unconditionally in this environment today** (`:128-133`,
`:238-243`) — not a hypothetical, the first precondition check in both handlers fails before any
signature or body logic runs. `msp-api-foundation.test.ts` (§ next) exercises both routes'
signature/idempotency logic under a test-only secret it sets itself, independent of this
environment's real (absent) configuration — the test suite is not evidence the routes are
reachable in local dev as currently configured.

**Real test coverage exists and is not a stub of its own** —
`msp-api-foundation.test.ts:231-`(Stripe) and `:309-`(app-signature) register the same raw-body
middleware the real app uses (`:116-117`) and drive both routes through real HMAC signing, replay-
window, and idempotency-hit assertions against an actual test-DB-backed idempotency store — this is
genuine behavioral test coverage of the signature verification and dedup logic, even though the
*dispatch* functions it invokes (`handleStripeEvent`/`handleAppCallback`) are stubs.

---

## 7. The forbidden list — what this module deliberately does NOT do

- **Does not touch `outbound_webhooks` or any customer-configured endpoint.** Confirmed §0/§5 — this
  is not the module #1693 asks for.
- **Does not act on any Stripe or app-signature event today.** Both dispatch functions are complete
  no-ops for every named case (§2, §3) — an event can be signature-verified, deduplicated, and
  200'd, with zero observable effect on any table, subscription, or provisioning state.
- **Does not validate `eventType`/Stripe `type` against any list before accepting it as `200`.** Any
  string reaches `default` and is accepted the same as a named case (§4).
- **Does not read or persist the `payload` field of an app-signature callback.** Typed, accepted,
  never inspected (§3).
- **Does not distinguish a stale/replayed timestamp from a bad signature in its HTTP response** —
  both fail identically as `WEBHOOK_INVALID_SIGNATURE` (§2, §3); only the server log line differs.
- **Does not scope idempotency per-MSP** — both routes explicitly pass `mspId: null` (§5); dedup is
  platform-global, not per-tenant, because neither caller carries a platform tenant identity.
- **Has no UI surface anywhere in this codebase.** Pure server-to-server ingress; nothing in
  `artifacts/msp-portal`, `artifacts/admin-panel`, or any other frontend package references this
  route's path or response shape.

---

## 8. Open questions and the real gap for #1693

- **#1693 has no real backend yet — filed as its own finding, see below.** This pack's extraction of
  `msp-webhooks.ts` does not close it; the customer-outbound-webhook operator surface (list a
  customer's endpoints, disable one, read the delivery log, see subscribed events, cross-referenced
  against the real event catalog per #1607) has zero server-side route today. `docs/webhooks-
  contract-pack.md` §9 already lists the *portal-side* wiring gaps (Rotate/Edit/Delete unwired,
  Replay unbuilt); this pack adds the observation that there is no MSP-console-side reader/writer at
  all, not even an unwired one — nothing in `artifacts/api-server/src/routes` exposes
  `outbound_webhooks` to an `MSPOperator`/`MSPAdmin` caller.
- **Both dispatch handlers in this module are stubs with no target issue number attached in code.**
  The `// TODO (Billing task)` / `// TODO (Platform Subscription task)` / `// TODO (Provisioning
  task)` / `// TODO (Diagnostics task)` comments (§2, §3) name a *subsystem*, not a tracked issue —
  whether real billing/provisioning work already covers filling these in, or whether this is its own
  open gap, was not determined by this pack (out of scope for a read-only extraction of one file);
  noted here so a future session doesn't have to re-discover that the TODOs exist.
- **No rate limiting specific to these two routes was found** beyond the router-wide `mspRateLimit`
  applied to all of `/api/msp/v1/*` (`msp-v1.ts:58`) — an unauthenticated, signature-gated endpoint
  is a natural target for a signature-guessing/flood attempt; whether the shared 300/min limit is
  adequate for an endpoint two external systems (Stripe + internal callers) share is a product
  judgment call, not restated as a finding here since it was not concretely demonstrated as
  insufficient.

---

## 9. Summary — CURRENT vs. gap

| Item | Status | Where |
|---|---|---|
| Both routes' signature verification, replay protection, idempotency dedup | CURRENT — real, tested, live-verifiable (currently 503s locally on missing secrets) | §2, §3, §6 |
| Both routes' event dispatch (`handleStripeEvent`, `handleAppCallback`) | Stubbed no-op for every named case | §2, §3, §7 |
| `outbound_webhooks` visibility/disable for an MSP operator (#1693's actual ask) | **No backend exists** — not this file, not any file | §0, §8 |
| Shared idempotency store, platform-global (not per-MSP) scoping | CURRENT, by explicit design choice | §5 |

## 10. Verification ledger

- Every file:line citation above was read directly from `artifacts/api-server/src/routes/
  msp-webhooks.ts`, `msp-v1.ts`, `app.ts`, `lib/idempotency.ts`, `lib/api-helpers.ts`, and
  `msp-api-foundation.test.ts` in this worktree, this session.
- Live Postgres query run against the local dev instance (`DATABASE_URL`, `.env.local`), this
  session: `SELECT count(*) FROM msp_idempotency_store` → **0**; `\d msp_idempotency_store` for the
  real column/index list quoted in §5/§6.
- `.env.local` grepped directly for `STRIPE_MSP_WEBHOOK_SECRET` and `APP_WEBHOOK_SECRET` — zero
  matches for either, this session.
- "No other file touches `outboundWebhooksTable`" and "no other file references this module's event
  name lists" are each a literal-string/symbol search across `artifacts/api-server/src`, not an
  inference — per the extracted-not-authored rule.
- `artifacts/msp-console` was confirmed absent as a directory in this repo, this session (a plain
  directory listing, not a search that could miss a differently-cased path).
