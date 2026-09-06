# Webhooks — contract extraction pack for Claude Design (#1597)

Method: #1577 (contract extraction pack, per-module, step 3 of #1578's
schema → honest read → contract → Design → wire sequence). Standing rules
inherited from #1485 / #1577: **extracted, not authored**; every field cited
to file:line; fields marked `CURRENT` (serves real data today) or `DECIDED`
(architecture settled, not built, with an issue number) — anything else is an
**open architecture question**, not a decision, and is labelled as such;
real enum unions only; honest-empty contract; forbidden list; no
`drizzle-kit push`.

**Scope correction applied:** per #1577's 2026-08-28 comment, this pack
covers Webhooks only — not a platform-wide sweep. #1597 itself records a
2026-08-28 sequencing correction: the backend already exists, so this module
skips #1578 steps 1–2 (schema, honest read) and starts at step 3.

## 1. Files extracted

| File | What it holds |
|---|---|
| `artifacts/api-server/src/routes/webhooks.ts` | The only outbound-webhooks route file. Portal endpoints (`/api/portal/webhooks/*`) and Admin endpoints (`/api/admin/webhooks/*`). Registered at `artifacts/api-server/src/routes/index.ts:407` (`router.use(webhooksRouter)`, imported line 126). |
| `artifacts/api-server/src/lib/webhook-delivery.ts` | Delivery engine: secret generation/signing, HTTP delivery + retry, fan-out from the event bus, and `getDeliveryLog` (the actual query behind the deliveries endpoint). |
| `lib/db/src/schema/msp.ts:998-1045` | `outboundWebhooksTable` (`outbound_webhooks`) and `outboundWebhookDeliveriesTable` (`outbound_webhook_deliveries`) — the real Drizzle schema, source of truth for column types/nullability/enums. |
| `artifacts/api-server/src/lib/event-bus.ts` | `EVENT_TYPES` canonical event constant (line 241) and `dispatchUnsafe` (line 162), which is what actually triggers webhook fan-out (line 195: `void fanOutWebhooks(...)`). |
| `artifacts/portal/src/components/webhooksWire.ts` (path corrected from `artifacts/msp-portal/src/components/portal-v2/webhooksWire.ts`; NOT carried over in the `f40438cdc` rename — this file does not exist in `artifacts/portal`) | The **Design page's own** (consumer-side) reconstruction of the wire shapes it expects — `WireWebhook` (line 29), `WireDelivery` (line 44) — plus the live-mapping functions. Not authoritative; included because it is the closest thing to a named `Wire*` interface for this module and is useful to cross-check against what the route actually returns. |
| `artifacts/portal/src/components/webhooksLive.ts` (path corrected from `artifacts/msp-portal/src/components/portal-v2/webhooksLive.ts`; NOT carried over in the `f40438cdc` rename — this file does not exist in `artifacts/portal`) | `useWebhooksLive()` — the hook #1463 audited. |
| `artifacts/portal/src/components/webhooksData.ts` (path corrected from `artifacts/msp-portal/src/components/portal-v2/webhooksData.ts`; NOT carried over in the `f40438cdc` rename — this file does not exist in `artifacts/portal`) | The Design fixture: `WEBHOOK_EVENTS` (11-row event catalogue) and `WEBHOOKS` (4-row fixture endpoint list), still rendered whenever `dataState === "fixture"`. |
| `artifacts/portal/src/pages/portal-v2-webhooks.tsx` (path corrected from `artifacts/msp-portal/src/pages/portal-v2-webhooks.tsx`; NOT carried over in the `f40438cdc` rename — this file does not exist in `artifacts/portal`) | The page under design in this epic. |
| `artifacts/portal/src/pages/webhooks.tsx` (path corrected from `artifacts/msp-portal/src/pages/webhooks.tsx`; NOT carried over in the `f40438cdc` rename — this file does not exist in `artifacts/portal`) | A separate, **older, fully-wired** webhooks page (not portal-v2) — its own `Webhook`/`Delivery` interfaces (lines 48, 62) match the route's real fields exactly and it has working create/edit/delete/rotate against the real endpoints. Included because it is real, working, consumer-verified evidence of the wire shape; it is not the page in scope for this Design pass. |

**Important, and stated plainly up front:** `webhooks.ts` declares **no
`interface Wire*`** anywhere in the file — unlike `portal-change-control.ts:157`,
`portal-message-center.ts:135`, `portal-runbooks.ts:103-143`, etc. Every
response is an inline Drizzle `.select({ ... })` projection object built at
the call site. Section 2 below extracts those projections directly, cited to
their own file:line, as the real wire contract — there is no named
server-side interface to extract from instead. `getDeliveryLog`'s
`DeliveryLogEntry` (`webhook-delivery.ts:310-322`) is the one genuine named
interface in the delivery path, and the deliveries route (`webhooks.ts:407-408`)
returns it verbatim (`res.json({ deliveries })`, no reshaping).

## 2. Wire contract, per endpoint

All portal endpoints sit behind `requireAuth` and `resolveOwner()`
(`webhooks.ts:71-97`), which scopes every read/write to the caller's own
`mspId`/`customerId` — `CustomerUser` → `customerId`; `MSPAdmin`/`MSPOperator`
→ `mspId`; `PlatformAdmin`/`role: "admin"` → whichever of the two is present
on the token. A caller `resolveOwner()` can't classify gets `403`
(`webhooks.ts:117,148,211,254,313,346,387`), not an empty list.

### `GET /api/portal/webhooks` — `webhooks.ts:114-141`

Response: `{ webhooks: Row[] }`, `Row` = the `.select({...})` at
`webhooks.ts:123-134`:

| Field | Type | Nullability | Status |
|---|---|---|---|
| `webhookId` | `string` (uuid) | not null | CURRENT |
| `label` | `string` | not null | CURRENT |
| `url` | `string` | not null | CURRENT |
| `secretPrefix` | `string` | not null | CURRENT — **never the full secret; see §6** |
| `eventTypes` | `string[]` | not null, default `[]` | CURRENT |
| `isActive` | `boolean` | not null, default `true` | CURRENT |
| `ownerType` | `"msp" \| "customer" \| "platform"` | not null | CURRENT — see §3, the route itself never produces `"platform"` |
| `mspId` | `number \| null` | nullable | CURRENT |
| `customerId` | `number \| null` | nullable | CURRENT |
| `createdAt` | `Date`/ISO string | not null, default now | CURRENT |
| `updatedAt` | `Date`/ISO string | not null, default now | CURRENT |

No pagination, no `limit`/`offset` — every owned row is returned in one
response, ordered `desc(createdAt)` (`webhooks.ts:138`).

### `GET /api/portal/webhooks/:webhookId` — `webhooks.ts:208-247`

Same row shape as above (identical `.select()` at `webhooks.ts:219-230`),
wrapped `{ webhook: Row }`. `404 { error: "Webhook not found" }` if the id
doesn't exist or isn't owned by the caller (`webhooks.ts:241-244`) — **not
distinguishable from "doesn't exist" vs "exists but belongs to someone
else"; both return an identical 404.**

### `POST /api/portal/webhooks` — `webhooks.ts:145-204`

Request body (`createWebhookSchema`, `webhooks.ts:47-54`):

| Field | Type | Validation |
|---|---|---|
| `label` | `string` | 1–120 chars, required |
| `url` | `string` | must be a valid URL starting `http://` or `https://` (the zod `.url()` check plus a redundant `.refine`, `webhooks.ts:49-52`) |
| `eventTypes` | `string[]` | defaults to `[]`; **any string accepted — not validated against `SUBSCRIBABLE_EVENT_TYPES`** (see §4) |

Response `201`: `{ webhook: {...} }` (`webhooks.ts:189-202`) — same fields as
the list row, **plus `secret: string` (the full plaintext secret, once)**.
`secret` is generated by `generateWebhookSecret()` (`webhook-delivery.ts:33-35`,
`"whsec_" + 32 random bytes hex`) and stored in the DB **in plaintext**
(`outboundWebhooksTable.secret`, `msp.ts:1006` — `text("secret").notNull()`,
no hash column). `secretPrefix` is `secret.slice(0, 14)` (`webhooks.ts:160`).

### `PATCH /api/portal/webhooks/:webhookId` — `webhooks.ts:251-306`

Request body (`updateWebhookSchema`, `webhooks.ts:56-61`): `label`, `url`,
`eventTypes`, `isActive` — all optional, only supplied fields are updated
(`webhooks.ts:282-285`). **`ownerType`, `mspId`, `customerId` are not
patchable** — no code path can move a webhook between owners once created.
Response: `{ webhook: Row }`, same shape, re-selected post-update
(`webhooks.ts:291-303`).

### `DELETE /api/portal/webhooks/:webhookId` — `webhooks.ts:310-336`

`204` empty body on success. `404` if not found/owned. Hard delete
(`db.delete(...)`, `webhooks.ts:331-333`) — no soft-delete/archive column on
the table, so a deleted webhook's delivery history is also gone (`ON DELETE
CASCADE` on `outbound_webhook_deliveries.webhook_id`, `msp.ts:1027`).

### `POST /api/portal/webhooks/:webhookId/rotate-secret` — `webhooks.ts:340-377`

No request body. Response: `{ secret: string, secretPrefix: string }`
(`webhooks.ts:375`) — **the new full plaintext secret, once**, same
constraint as create (§6). Old secret is destructively overwritten
(`webhooks.ts:367-370`) — **no rotation history, no grace-period overlap
where both old and new secrets validate.** `webhooksLive.ts`'s
`toLiveEndpoint` hardcodes `rotated: "Rotation history not tracked"`
(`webhooksWire.ts:137`) — that string is the live-mapper's own honest
admission, not data from the route.

### `GET /api/portal/webhooks/:webhookId/deliveries?limit=N` — `webhooks.ts:381-410`

`limit` clamped `Math.min(Number(req.query.limit) || 50, 200)`
(`webhooks.ts:393`; default 50, hard ceiling 200 — no cursor/offset, so a
webhook with more than 200 logged deliveries has no way to page past the
most recent 200). Ownership-checked before querying (`webhooks.ts:396-405`,
`404` if not owned). Response: `{ deliveries: DeliveryLogEntry[] }`
(`webhook-delivery.ts:310-322`, verbatim, no reshaping):

| Field | Type | Nullability | Status |
|---|---|---|---|
| `deliveryId` | `string` (uuid) | not null | CURRENT |
| `webhookId` | `string` (uuid) | not null | CURRENT |
| `eventId` | `string \| null` (uuid) | nullable | CURRENT |
| `eventType` | `string` | not null | CURRENT |
| `attempt` | `number` | not null, default `1` | CURRENT |
| `status` | `string` (real enum below) | not null, default `"pending"` | CURRENT |
| `statusCode` | `number \| null` | nullable | CURRENT |
| `responseSnippet` | `string \| null` | nullable, truncated to 500 chars (`webhook-delivery.ts:25,124,128`) | CURRENT |
| `nextRetryAt` | `Date \| null` (timestamptz) | nullable | CURRENT |
| `deliveredAt` | `Date \| null` (timestamptz) | nullable | CURRENT |
| `createdAt` | `Date` (timestamptz) | not null, default now | CURRENT |

`requestBodySnapshot` (the JSONB column that stores the actual outgoing
payload per delivery, `msp.ts:1034`) exists in the table and is written on
every fan-out (`webhook-delivery.ts:291`) but is **not selected by
`getDeliveryLog`** (`webhook-delivery.ts:329`, plain `db.select()` mapped to
the fields above) and so **never reaches this or any route response** — a
real, replay-relevant field that is stored but not currently servable. No
issue number exists for this gap; it is an open item, not `DECIDED`.

### `GET /api/portal/webhooks/event-types` — `webhooks.ts:108-110`

Response: `{ eventTypes: SUBSCRIBABLE_EVENT_TYPES }` — see §4.

### Frontend never calls this endpoint

The Design page (`portal-v2-webhooks.tsx`) never fetches
`/portal/webhooks/event-types`; the older, fully-wired `pages/webhooks.tsx`
also doesn't — it hardcodes its own `ALL_EVENT_TYPES` (`webhooks.tsx:76-97`,
20 entries), which is a **stale partial copy** of the real
`SUBSCRIBABLE_EVENT_TYPES` list (missing, among others,
`auth.logout`/`auth.token.refresh`/`auth.token.revoked`/`auth.role.changed`,
`document.version.added`, `idempotency.hit`, both `dlq.*` types, both
`auth.impersonation.*` types, and `invoice.created`/`invoice.paid`/`contract.signed`
from the additional hardcoded set). No page in the codebase today reads the
canonical list live.

## 3. Real enum unions

Only enums that are genuinely `text(..., { enum: [...] })` columns or
literal unions in code — nothing invented.

- **Delivery status** (`outbound_webhook_deliveries.status`, `msp.ts:1031`):
  `"pending" | "success" | "failed" | "retrying"`. This is the only real
  status enum in the module. `webhook-delivery.ts:145-178` is the only writer:
  `success` on a 2xx response; `retrying` while `attempt < MAX_ATTEMPTS` (3,
  `webhook-delivery.ts:22`); `failed` once attempts are exhausted.
- **Webhook owner type** (`outbound_webhooks.owner_type`, `msp.ts:1001`):
  schema declares `"msp" | "customer" | "platform"`, but `resolveOwner()`
  (`webhooks.ts:71-97`) — the only function that ever sets `ownerType` on
  create — **can only produce `"msp"` or `"customer"`**. No code path ever
  writes `"platform"`. The value exists in the DB enum but is currently
  unreachable through the portal route.
- **Endpoint health state** (`healthy | failing | degraded | paused`,
  `webhooksData.ts:86`) is **not a stored value anywhere** — it is a
  purely client-computed aggregate. `deriveState()` (`webhooksWire.ts:79-87`):
  `isActive === false` → `paused`, regardless of history; otherwise a
  rolling failure rate over the fetched delivery page decides `failing`
  (rate < 0.7), `degraded` (rate < 0.98), else `healthy`. Because it's
  computed only from whatever page of deliveries was fetched (`limit=20` from
  `webhooksLive.ts:22`), the label can shift if an older, differently-shaped
  page is read. There is no `state` column and no server-side notion of
  "endpoint health."
- `SUBSCRIBABLE_EVENT_TYPES` (`webhooks.ts:27-43`) is **not an enum
  constraint** — `createWebhookSchema.eventTypes` (`webhooks.ts:53`) accepts
  `z.array(z.string().min(1))` with no `.refine`/`.enum` against it. A
  webhook can be created today subscribing to any non-empty string, including
  one that will never be dispatched. The list returned by `GET
  /portal/webhooks/event-types` is advisory only; nothing in the route layer
  enforces it.

## 4. The event catalog question — three vocabularies, not one

#1597's own body asks whether webhooks ride the #1278 alert catalog or
define their own. **Verified: webhooks define their own, and it does not
match either the real dispatchable event list or the #1278 catalog.** There
are three distinct, non-overlapping string vocabularies live in the codebase
today.

### (A) What a webhook can actually be subscribed to — `SUBSCRIBABLE_EVENT_TYPES`, `webhooks.ts:27-43`

`Object.values(EVENT_TYPES)` (28 values, `event-bus.ts:241-277`: `auth.*`,
`msp.*`, `customer.*`, `user.*`, `service_account.*`, `document.*`,
`idempotency.hit`, `dlq.*`, `auth.impersonation.*`) plus 13 more hardcoded
directly in the route: `signal.fired`, `fulfillment.item.created`,
`fulfillment.item.updated`, `offer.accepted`, `offer.rejected`,
`monitoring.run.completed`, `service.activated`, `service.deactivated`,
`project.created`, `project.completed`, `invoice.created`, `invoice.paid`,
`contract.signed` — **41 strings total.**

This is the only one of the three lists confirmed as **currently
dispatchable** — canonical `EVENT_TYPES` events are emitted via
`dispatchEvent`/`dispatchUnsafe` (`event-bus.ts:162-205`) from call sites
including `routes/auth.ts` (confirmed live: `EVENT_TYPES.AUTH_LOGIN` etc. are
called from there); most of the 13 extra strings are also dispatched from
real call sites (`portal-offers.ts` for `offer.accepted`/`offer.rejected`,
`project-sow-fulfillment.ts` for the `fulfillment.*`/`project.*` events,
`stripe.ts`/`invoice-sharepoint.ts` for the invoice events). **One
exception, verified by direct search: `signal.fired` appears nowhere in the
codebase except its own declaration at `webhooks.ts:30`** — it is
subscribable today but has no dispatch call site anywhere, so a webhook
subscribed to it will never receive an event. No issue number covers this;
it is an open gap, not `DECIDED`.

Every event dispatched through `dispatchUnsafe` triggers `fanOutWebhooks`
unconditionally (`event-bus.ts:195-202`) — **this is a fixed side effect of
the event bus itself, not a Workflow Engine node.** The real Workflow Engine
(`portal-workflow-engine.ts`, `portal-workflow-nodes.ts`) is a separate
caller of `dispatchEvent` alongside everything else that dispatches a
canonical event; it does not sit between an event and webhook fan-out. This
is the concrete code fact behind #1597's open question ("does a webhook
firing count as an automated process requiring a visible Workflow Engine
node?") — it answers what exists today, not what Design should show; that
call is Shane's.

### (B) What the Design fixture's catalogue shows — `WEBHOOK_EVENTS`, `webhooksData.ts:72-84`

11 rows: `finding.created`, `drift.detected`, `drift.resolved`,
`fix.verified`, `score.changed`, `risk.accepted`, `risk.review_due`,
`scan.completed`, `phase.gate_verified`, `billing.event`, `ticket.updated`.
The page's own subtitle claims these are "Same event categories as your
alert preferences — one taxonomy, two delivery surfaces" and that "what you
see here is what arrives in the payload" (`webhooksData.ts:18-19`).

**Verified false on both counts.** A direct search of the entire API server
source for each of these 11 literal strings returns **zero matches outside
the fixture file itself** — none is ever passed to `dispatchEvent`,
`dispatchUnsafe`, or anywhere else. None of the 11 appears in list (A). None
of the 11 exactly matches a list (C) `conditionType` string either (closest
near-misses: `finding.created` vs. `finding.new_critical`; `drift.detected`
vs. `drift.unapproved`; `scan.completed` vs. `remediation.scan_complete`;
`ticket.updated` vs. `support.ticket_updated` — same category, different
literal wire string). **This is fixture content with no real backing at
all** — not a stale copy of a real list, an invented one.

### (C) The #1278 alert-condition catalog — `CUSTOMER_ALERT_CONDITION_TYPES`, `msp.ts:5033-5064`

23 condition types across the 7-category `CUSTOMER_ALERT_CATEGORIES`
(`msp.ts:5019-5027`: `findings, drift, progress, reviews, remediation,
billing, support`) — the same 7 names the design fixture's `WEBHOOK_EVENTS`
`from` column groups its 11 rows under (`webhooksData.ts:73-83`), which is
almost certainly why the page's copy claims a shared taxonomy — **the
category names line up; the event wire strings inside them do not.**

**Live-queried against the local Postgres instance, 2026-08-28** (`SELECT
detector_status, count(*) FROM customer_tenant_alert_rules GROUP BY
detector_status`): all **23 rows are seeded with `detector_status = 'live'`
— zero rows are `pending_detector'`**, despite `msp.ts:5039,5045,5059`
carrying inline `// pending_detector` comments on `finding.global_admin_added`,
`drift.regression`, and `billing.license_change` respectively (3 of the 23,
not the "4" #1597's own body quotes from #1278). **This contradicts #1597's
stated "19 live, 4 pending_detector" split** — that split does not match
what is in the database right now. Stated as observed, not as an accusation
that #1278 was wrong at the time it was written; something changed the seed
data (or #1278's counts described a different table/moment) between then and
this query. Full per-row detail:

```
alert_category | count
----------------+-------
billing         |     5
drift           |     3
findings        |     7
progress        |     2
remediation     |     3
reviews         |     2
support         |     1
                       (23 total, all detector_status = 'live')
```

**None of the 23 `condition_type` strings in (C) is ever passed to
`dispatchEvent` under that exact literal either** — this table drives
`customer_tenant_alert_events`/the in-portal alert feed and Alert
Preferences notification routing, a parallel and currently entirely separate
system from outbound webhook fan-out. **Recommendation left to Shane, not
decided here:** webhooks today ride neither the alert catalog nor a
dedicated, dispatched event vocabulary of their own — they ride the generic
platform event bus (A), which is real but has no relationship to "alerts" as
a concept at all.

## 5. Honest-empty contract

Verified live against the local Postgres instance, 2026-08-28
(`SELECT count(*) FROM outbound_webhooks` / `outbound_webhook_deliveries`):
**both tables are genuinely empty — zero rows, real state, not a query
error.** This is not a hypothetical; it is the current state of local dev.

- **No webhooks configured (real, empty):** `GET /api/portal/webhooks`
  returns `200 { webhooks: [] }` (`webhooks.ts:140`, `rows` is a genuine
  empty array, not a sentinel). `useWebhooksLive` (`webhooksLive.ts:38-89`)
  sets `endpoints` to `[]` (not `null`) on this response, so
  `dataState` resolves to `"live"` (`webhooksLive.ts:85`,
  `endpoints !== null ? "live" : "fixture"`) and the page renders `0
  endpoints` (`portal-v2-webhooks.tsx:329`) with an empty endpoint list —
  **honest, not fixture.** There is, however, **no explicit "you haven't
  configured a webhook yet" message** — the endpoints panel just renders
  nothing between the header and the event catalogue; this is a real UI gap
  in the current Design page, not a backend one.
- **Failed/pending read:** `useWebhooksLive` sets `endpoints` to `null` on
  any thrown error or non-2xx response (`webhooksLive.ts:71-72`), which also
  resolves `dataState` to `"fixture"` — **the same value as "still
  loading."** While `loading` is `true` the page shows a skeleton
  (`PortalV2LoadingState`, `portal-v2-webhooks.tsx:353-358`) instead of the
  fixture, so in practice a user never sees fixture rows mid-load — only
  after `loading` goes `false` with `endpoints` still `null` (a genuine
  fetch failure) does the page fall back to `WEBHOOKS`'s 4 fixture endpoints,
  labelled `"fixture"` via the `pv2-wh-source` badge
  (`portal-v2-webhooks.tsx:330`). This exact `endpoints !== null` pattern is
  the one #1463 confirmed as correct and is the same fix #1463 had to apply
  to `billingLive.ts` elsewhere — webhooks needed no fix because it already
  used this pattern.
- **No delivery history for a real, configured endpoint:** `GET
  .../deliveries` returns `200 { deliveries: [] }`; `toLiveEndpoint`
  (`webhooksWire.ts:113-148`) renders `lastDelivery: "No deliveries yet"`
  (`webhooksWire.ts:132`) and `state: "healthy"` (`deriveState` with zero
  deliveries returns `healthy` unconditionally, `webhooksWire.ts:81`) — a
  genuinely untested endpoint reads as healthy, not as unknown/untested.
  This is a real, code-verifiable behavior, not a hypothesis.

## 6. Secret handling — hard UI constraint

**The full webhook secret is returned by the API in exactly two places, and
each only once:**

1. `POST /api/portal/webhooks` response, on creation (`webhooks.ts:193`,
   `secret` field, full plaintext).
2. `POST /api/portal/webhooks/:webhookId/rotate-secret` response
   (`webhooks.ts:375`, `secret` field, full plaintext).

**Every other read of a webhook — the list, the single-item GET, and after
any PATCH — returns only `secretPrefix`** (14 chars: `whsec_` + 8 hex chars,
`webhooks.ts:160`), never the full value (confirmed: `secret` does not
appear in the `.select()` projections at `webhooks.ts:123-134`, `219-230`,
or `291-303`). There is no "reveal secret" endpoint and cannot be one without
either storing/returning the plaintext again (it already is stored in
plaintext, `msp.ts:1006`, so this is a policy choice already made, not a
technical one) or hashing it going forward.

**This directly contradicts the current Design prototype.** The expanded
endpoint row renders a `WH_REVEAL` ("Reveal") button next to the secret hint
(`portal-v2-webhooks.tsx:218`, `webhooksData.ts:37`) as if a previously
created secret can be re-fetched and shown again on demand. **It cannot.**
Once the create/rotate response has been read and dismissed, the plaintext
secret is gone from every API surface — only `secretPrefix` remains
reachable, forever. Design must either drop "Reveal" for an existing
endpoint (only make it available in the create/rotate success moment) or
Shane must decide to add a genuinely new capability (server-side plaintext
storage already exists, so "reveal" is possible to build — it is simply not
built today).

## 7. Forbidden list

**`webhooks.ts` carries no `"What this route deliberately does NOT serve"`
header section** — unlike `portal-pii-governance.ts:32-40`, which is the
precedent example #1577 asked to be included verbatim:

> ── What this route deliberately does NOT serve ─────────────────────────────
> The design fixture's per-document findings, named sources, matched patterns,
> access matrix and drift feed have no collected backing (there is no
> content-inspection PII discovery scan) — see portal-pii-governance.ts (the
> lib) for the full accounting. This route serves only what is real: the four
> aggregate compliance signals as `findings` when they genuinely fired, and a
> `coverage` block naming every backing check's real status so the page can say
> WHY it is empty (today, for the testbed tenant, all four report a Security &
> Compliance session error — a true, honest not-collected state).

Webhooks has no equivalent block, and no `coverage` block shape either. The
closest genuine "does not do this" declarations that do exist, from the
files actually in scope, stated plainly and attributed to their real source
rather than invented as a route-header list:

- **From the Design page's own header comment** (`portal-v2-webhooks.tsx:12-16`,
  not the route): *"Row expansion, the docs disclosure and the per-endpoint
  'test event sent' confirmation are the design's own local state and are
  wired. The mutating buttons (rotate secret, edit, delete, replay) render
  verbatim but are inert; wiring delivery is a later pass."* — i.e. Rotate,
  Edit endpoint, Delete, and Replay all render on `portal-v2-webhooks.tsx`
  but have no `onClick` (verified: none of the four buttons at
  `portal-v2-webhooks.tsx:219,261-262,343` carry an `onClick` handler),
  despite every one of those actions having a real, working backend endpoint
  today (rotate-secret, PATCH, DELETE — replay has no backend at all, see
  next point). This is a wiring gap in the Design page, not a backend
  limitation.
- **Replay has no backend at all.** `WH_REPLAY`-style labels
  (`liveReplayLabel`, `webhooksWire.ts:198-200`; `whReplayLabel`,
  referenced from `webhooksModel.ts`) render a "Replay N dropped" button, but
  there is no `POST .../replay` route anywhere in `webhooks.ts` and no
  function anywhere in `webhook-delivery.ts` that re-attempts a `failed`
  delivery. Once `attempt >= MAX_ATTEMPTS` (3) a delivery is terminal — its
  `status` becomes `failed` and nothing in the codebase ever transitions it
  back to `pending`/`retrying`. This is a real, unbuilt capability with no
  issue number yet.
- **No admin-facing "why is this route CustomerUser vs MSP" scoping note**
  exists in `webhooks.ts` the way other modules document their role floor —
  `resolveOwner()` (§2) is the only scoping logic and is undocumented beyond
  its own inline comments.

## 8. Cross-surface edges

None of #1485's tracked edges (`linkedFinding`,
`portal_hold_window_events.change_request_id`, `drift_events.cr_ref` +
`baseline_snapshot_id`, `msp_risk_decisions.check_key`/`register_ref`, shared
`psa_ticket_id`) touch this module — webhooks has no foreign key into any of
those tables. The one real, verified cross-surface relationship this module
has is the **category-name overlap with #1278's alert taxonomy** described in
§4 — worth carrying into the epic's accumulating edge map as: *"Webhooks'
design-fixture event catalogue groups its (fictional) events under the same
7 category names as `customer_tenant_alert_rules.alert_category` — the
grouping is shared, the underlying event/condition wire strings are not."*
No other real edge exists to record for this module today.

## 9. Summary — CURRENT vs. open (no `DECIDED` items exist yet for this module)

Every gap below is a genuine open architecture question with **no issue
number filed against it yet** — per #1577's own rule, that means none of
these can be marked `DECIDED`; they are listed here so Shane can turn them
into sub-issues before Design builds against them, the same discipline
already applied to Change Control / Risk Register.

| Gap | Where verified |
|---|---|
| Design fixture's 11-event catalogue has zero backing — invented wire names | §4(B) |
| `signal.fired` is subscribable but never dispatched | §4(A) |
| Webhook event subscription is unvalidated against any real list | §3 |
| `ownerType: "platform"` is schema-legal but unreachable from the route | §3 |
| `requestBodySnapshot` is stored per-delivery but never served | §2 (deliveries) |
| Secret "Reveal" button has no backing endpoint after creation/rotation | §6 |
| Rotate / Edit / Delete buttons render but are unwired (`onClick`-less) despite real backend support | §7 |
| Replay has no backend at all — not just unwired, unbuilt | §7 |
| No pagination past the most recent 200 deliveries | §2 (deliveries) |
| Webhook health "state" is a client-side heuristic, not a stored/served value | §3 |
| #1597's quoted "19 live / 4 pending_detector" split does not match the live DB (23/0 today) | §4(C) |

Everything else documented above under §2 (every listed field, every
endpoint) is `CURRENT` — real, wired, and reads/writes actual rows in
`outbound_webhooks` / `outbound_webhook_deliveries` today.

## 10. Verification ledger

- Live Postgres queries run directly against the local dev instance
  (`DATABASE_URL` from the main checkout's `.env.local`, per this repo's
  worktree convention), 2026-08-28:
  - `outbound_webhooks`: 0 rows.
  - `outbound_webhook_deliveries`: 0 rows.
  - `customer_tenant_alert_rules`: 23 rows, all `detector_status = 'live'`,
    category breakdown as shown in §4(C).
- Every file:line citation above was read directly from
  `artifacts/api-server/src/routes/webhooks.ts`,
  `artifacts/api-server/src/lib/webhook-delivery.ts`,
  `artifacts/api-server/src/lib/event-bus.ts`,
  `lib/db/src/schema/msp.ts`, and the `artifacts/portal/src/components/webhooks*`
  / `artifacts/portal/src/pages/webhooks*.tsx` files (paths corrected from
  `artifacts/msp-portal/src/components/portal-v2/webhooks*` /
  `artifacts/msp-portal/src/pages/webhooks*.tsx`; NOT carried over in the `f40438cdc`
  rename — none of these files exist in `artifacts/portal`) in this worktree at
  commit `895b76f3a` (the bookend commit this session started from) plus this
  session's own read-only investigation — no product code was changed.
- The "zero occurrences" claims in §4 (fixture event strings never dispatched;
  `signal.fired` never dispatched; alert-condition strings never dispatched)
  are each a literal-string search across `artifacts/api-server/src`, not an
  inference from a type signature — stated as observed, per the
  extracted-not-authored rule.
- Nothing in this pack was inferred from a TypeScript type and presented as
  runtime-observed; every `CURRENT` claim traces to either a live query
  result or a direct code read of the exact function that produces the
  response.
