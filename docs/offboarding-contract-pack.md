# Offboarding (Portal) — contract extraction pack

**Issue:** #2444, part of #1653 ("Feature: Offboarding (Portal)"), part of #1485 (EPIC:
Portal). Method per #1642. Extracted, not authored — every field below traces to one
of the files listed, cited to file:line. This is Phase 2 of the Portal build order
(architect → build the endpoints → regenerate the contract pack → Design → wire) — no
page/UI-shape decisions are made here.

All 4 endpoints named in #2444's Step 1 were confirmed real and live in the current
codebase before any of this was written, across two route files:

- `GET /api/msp/dashboard` — `msp-portal.ts:127`
- `POST /api/msp/offboarding/request` — `msp-portal.ts:378`
- `POST /api/msp/offboarding/export` — `msp-portal.ts:459`
- `GET /api/portal/customer/export` — `portal-customer-engines.ts:905`

One sibling endpoint on the same state machine, in the same file, is also in scope —
the archived page's Step 1 list did not name it (only MSPAdmin drives the first two
steps; this one is PlatformAdmin-only and has no caller in the archived page at all),
but it is the terminal transition the other two exist to feed and cannot be honestly
documented without it:

- `POST /api/msp/offboarding/archive` — `msp-portal.ts:601`

Two more endpoints the archived page actually called are also in scope, since they
are the CustomerUser-side half of the same Feature (a customer offboarding themselves
directly, vs. an MSP offboarding its whole book):

- `POST /api/portal/customer/offboard` — `portal-customer-engines.ts:777`
- `GET /api/portal/dashboard` (read-only, for `customerStatus`) — already fully
  documented in `docs/customer-home-and-timeline-contract-pack.md` §2; not
  re-documented here beyond the one field this Feature reads (see §6).

Sources this pack is built against, and nothing else:

- `artifacts/api-server/src/routes/msp-portal.ts` — `/msp/dashboard`,
  `/msp/offboarding/request`, `/msp/offboarding/export`, `/msp/offboarding/archive`,
  `/msp/events` (severity derivation, §4 finding)
- `artifacts/api-server/src/routes/portal-customer-engines.ts` —
  `/portal/customer/offboard`, `/portal/customer/export`
- `artifacts/api-server/src/lib/resolve-msp-id.ts` — `resolveMspIdStrict()`
- `artifacts/api-server/src/lib/tenant-signals.ts` — `resolveCustomerUserIds()`
- `artifacts/api-server/src/lib/msp-financial-aggregator.ts` — `aggregateMspTelemetry()`
  return shape (`TelemetryPayload`, `FinancialBreakdown`, `CategoryBreakdown`)
- `artifacts/api-server/src/middlewares/requireAuth.ts` — `requireRole()`,
  `ROLE_ORDER`
- `lib/db/src/schema/msp.ts` — `mspsTable` (`MSP_OFFBOARDING_STATES`), `tenantsTable`
- `lib/db/src/schema/index.ts` — `MSP_ROLES`, `clientServicesTable`, `servicesTable`,
  `projectsTable`, `reportsTable`, `tenantEngineSnapshotsTable`
- `artifacts/api-server/src/routes/msp-portal.test.ts`,
  `artifacts/api-server/src/routes/portal-customer-offboard.test.ts` — confirm the
  real behaviour cited below is under test, not just read from source
- `artifacts/portal/src/App.tsx` — comparison surface for the orphaned-endpoint check
- Archived page: `git show portal-archive-2026-08-29:artifacts/msp-portal/src/pages/offboarding.tsx`
  — read per #1653's own instruction, for real request/response shape and error
  states; not used as a layout/vocabulary source

---

## 1. Wire contract — `GET /api/msp/dashboard`

Auth: `requireRole("MSPOperator")` (`:129`) — MSPOperator or above (MSPAdmin,
PlatformAdmin also pass, per `ROLE_ORDER`, `requireAuth.ts:80-88`).

No query params — `resolveMspIdStrict(req)` (`:132`) reads `mspId` straight off the
session, no `?mspId=`/`?slug=` override even for PlatformAdmin. 403
`{ error: "MSP context required" }` if the session carries no `mspId` (`:133-136`).

This is the broadest endpoint in this pack — a general MSP KPI dashboard, of which
offboarding state is one field. Full response shape (`:351-367`):

| Field | Type | Nullability | Source |
|---|---|---|---|
| `msp` | `object \| null` | see below | `msps` row for the session's `mspId`, single-row select |
| `customers` | `{ total, active, inactive, onboarding }` (all `number`) | not null | `tenants` grouped by `status`, counted (`:280-288`) |
| `signalsFiredThisMonth` | `number` | not null | count of `msp_event_store` rows where `eventType LIKE 'signal.%'`, this month (`:164-176`) |
| `offerAcceptanceRate` | `number` (0–100) | not null | `offersAccepted / offersSent * 100`, or a fallback of `active/total customers * 100` when no offer events exist yet this month (`:296-303`) |
| `offersSent` | `number` | not null | count of `msp_event_store` rows, `eventType = 'offer.sent'`, this month |
| `offersAccepted` | `number` | not null | count of `msp_event_store` rows, `eventType = 'offer.accepted'`, this month |
| `revenueCentsThisMonth` | `number` | not null | `SUM((payload->>'amountCents')::bigint)` over `msp_event_store` rows, `eventType = 'payment.completed'`, this month (raw SQL, `:206-219`) |
| `revenueUsdThisMonth` | `string` | not null | `revenueCentsThisMonth / 100`, `.toFixed(2)` |
| `periodStart` | `string` (ISO) | not null | UTC start of the current calendar month |
| `unacceptedOffersCents` | `number` | not null | `SUM(adjustedPriceCents)` over `sales_offers` rows, `state = 'sent'`, this MSP |
| `unacceptedOffersCount` | `number` | not null | matching row count |
| `idleBundles` | `Array<{ bundleId, name, daysIdle }>` | not null, `[]` when none | active `msp_sales_bundles` with no non-revoked assignment in 30+ days, raw SQL, max 5, ordered by `daysIdle desc` (`:256-273`) |
| `aiAlertThreshold` | `number \| null` | nullable | `getAiBalance(mspId)`, errors silently swallowed to `null` (`:277`, `:331`) |
| `aiPeriodUsagePct` | `number \| null` | nullable | same call, `:332` |
| `telemetry` | `TelemetryPayload` | not null | `aggregateMspTelemetry(mspId, monthStart)` (`msp-financial-aggregator.ts:107`) — see §3 for the shape; out of this Feature's own scope beyond honest citation, since the dashboard KPI surface is a separate Feature |

`msp` object fields (`:224-234`, `null` only if the `msps` row is somehow gone for a
resolved `mspId` — not a state this route can otherwise reach given `resolveMspIdStrict`
already requires a session `mspId`):

| Field | Type | Nullability | Source |
|---|---|---|---|
| `id` | `number` | not null | `msps.id` |
| `name` | `string` | not null | `msps.name` |
| `status` | `"active" \| "suspended" \| "trial"` | not null | `msps.status` |
| `offboardingState` | `"cancellation_requested" \| "export_ready" \| "archival_flagged" \| null` | nullable — `null` is the real, pre-offboarding default | `msps.offboarding_state` |
| `offboardingRequestedAt` | `Date \| null` (serialises ISO) | nullable | `msps.offboarding_requested_at` |
| `exportReadyAt` | `Date \| null` (serialises ISO) | nullable | `msps.export_ready_at` |

This is the field the archived page's `OffboardingPage` reads (`d.msp.offboardingState`
etc, archived `offboarding.tsx:308-317`) to drive its 3-step state machine UI — the
rest of the dashboard payload above is real but belongs to a different Feature's
concern (general MSP KPIs), not this one.

---

## 2. Wire contract — `POST /api/msp/offboarding/request`

Auth: `requireRole("MSPAdmin")` (`:380`) — MSPAdmin or PlatformAdmin only (one tier
above the dashboard read). No body params (archived page posts `{}`, `:378` handler
ignores the body entirely).

State transition: `null → cancellation_requested`. 400 `{ error: "mspId required" }`
if no session `mspId` (`:384-387`). 404 `{ error: "MSP not found" }` if the `msps` row
is gone (`:395-398`). **409** `{ error: "Offboarding already in progress (state:
<state>)", offboardingState: <state> }` if `offboardingState` is already non-null
(`:400-406`) — this is a hard guard, not idempotent; calling it twice is a real 409,
unlike `/export` below.

On success (`:408-446`): sets `offboardingState = "cancellation_requested"`,
`offboardingRequestedAt = now`; inserts an `msp_event_store` row
(`eventType: "msp.cancellation_requested"`, `source: "msp-portal"`, `ownerType: "msp"`,
`:419-430`); inserts an `msp_audit_logs` row (`actionType: "msp.offboarding.request"`,
`:433-443`). Response: `{ ok: true, offboardingState: "cancellation_requested",
requestedAt: <ISO> }`.

---

## 3. Wire contract — `POST /api/msp/offboarding/export`

Auth: `requireRole("MSPAdmin")` (`:461`). No body params.

State transition: `cancellation_requested → export_ready` (**not** gated on the
caller having actually called `/request` first — see §5 honest-state note). 400
`{ error: "mspId required" }` (`:465-468`). 404 `{ error: "MSP not found" }`
(`:476-479`). 409 `{ error: "MSP is already archived" }` if `offboardingState ===
"archival_flagged"` (`:481-484`) — the only state this route refuses to run against;
every other state (including `null`) proceeds.

Builds a full customer data export package (`:486-547`) — every `tenants` row for
this `mspId`, plus per-customer `msp_event_store` event counts:

| Field | Type | Source |
|---|---|---|
| `exportedAt` | `string` (ISO) | generation time |
| `exportVersion` | `string` | hardcoded `"1.0"` |
| `msp.id`, `.name`, `.slug`, `.domain`, `.status`, `.createdAt` | — | `msps` row |
| `customers[]` | `Array<{ id, name, domain, industry, tenantId, status, tenantUrl, createdAt, eventCount }>` | `tenants` rows for this `mspId`, `name` = `tenants.customerName`; `eventCount` = per-customer `msp_event_store` row count (`:507-521`), `0` for a customer with no events |
| `summary.totalCustomers` | `number` | `customers.length` |
| `summary.activeCustomers` | `number` | count where `status === "active"` |
| `summary.totalEvents` | `number` | sum of all `eventCount` values |
| `notice` | `string` | fixed disclosure text: customer owns the data, re-onboard under a new MSP independently, "Direct MSP-to-MSP transfer is not supported in v1." (`:543-546`) |

`customers[]` deliberately omits an `ownerType` field the pre-restructure
`msp_customers` table carried — dropped, not synthesised, per the code comment
(`:495-498`): `tenants` has no successor column, and every `tenants` row already IS a
customer, so the field carries no information here.

State advance is **idempotent by design** (`:550`, comment: "idempotent — ok if
already `export_ready`") — re-calling `/export` while already `export_ready`
regenerates and returns a fresh export package (current data, not a cached one) but
does **not** re-write `exportReadyAt`, re-insert the `msp.export_ready` event, or
re-insert the audit log row (`:550-586` only runs `if (msp.offboardingState !==
"export_ready")`). Response: `{ ok: true, offboardingState: "export_ready", export:
<package above> }` on every successful call, cached-timestamp or not.

---

## 4. Wire contract — `POST /api/msp/offboarding/archive`

Auth: `requireRole("PlatformAdmin")` (`:603`) — the one route in this pack no
MSPAdmin, however privileged, can call; only the platform side confirms archival.
**Not `mspId`-scoped from session** — takes `mspId` as a request-body parameter
(`:606-611`), since a PlatformAdmin is confirming archival for a specific MSP,
not their own. 400 `{ error: "mspId required in request body" }` if missing or
non-numeric.

State transition: `export_ready → archival_flagged`. 404 `{ error: "MSP not found" }`
(`:619-622`). **Genuinely idempotent** (unlike the other two): if already
`archival_flagged`, returns `200 { ok: true, offboardingState: "archival_flagged",
alreadyArchived: true }` (`:624-627`) rather than an error. 409 `{ error: "Cannot
archive — expected state export_ready, got: <state>", offboardingState: <state> }`
for every other state, including `null` and `cancellation_requested` (`:629-635`) —
this route cannot be used to skip the export step.

On success (`:637-675`): sets `offboardingState = "archival_flagged"`, **also sets
`msps.status = "suspended"` and `suspendedAt = now`** (`:641-645`) — archival is not
purely an offboarding-state change, it also suspends the MSP record itself, the same
`status` field the dashboard's `msp.status` (§1) and `msp-portal.ts`'s own
7-day-suspended-banner threshold (schema comment, `msp.ts:43-44`) both read. Inserts
an `msp_event_store` row (`eventType: "msp.archival_flagged"`, `ownerType:
"platform"`, actor role hardcoded `"PlatformAdmin"` rather than read off
`req.user!.mspRole`, `:648-659`); inserts an `msp_audit_logs` row (`actionType:
"msp.offboarding.archive"`, `entityLabel: msp.name`, `:661-672`). Response: `{ ok:
true, offboardingState: "archival_flagged", archivedAt: <ISO> }`.

The MSP record is **retained, never deleted** — the route comment says so explicitly
(`:598-599`), and the code confirms it: no `DELETE` anywhere in this pack, only
`UPDATE`.

---

## 5. Wire contract — `POST /api/portal/customer/offboard`

Auth: `requireRole("CustomerUser")` (`:779`) — CustomerUser or above. No body.

Reads `req.user!.customerId` / `.mspId` / `.id` from session (`:781-783`). 400
`{ error: "Missing customer or MSP association on session" }` if either is missing
(`:785-788`). **403** `{ error: "Customer offboarding is only available for Shane
McCaw Consulting customers." }` if `mspId !== 1` (`:790-793`) — a hardcoded direct-
business MSP id, the same convention `portal-retainer-billing.ts`'s own header
comment documents (`mspId === 1, platform-billed`); this route is unreachable for
every brokered/white-labeled MSP's customers, by design — a brokered customer's
cancellation flow goes through their own MSP, not this platform-level route.

For an eligible customer (`:800-899`), scoped across every linked login via
`resolveCustomerUserIds(customerId)` (§1397 bridge — correct usage, `customerId`
here is a `tenants.id`, the exact input shape the function expects):

1. Finds every `client_services` row across the sibling set with `status` in
   `("active", "paused")`.
2. If Stripe is configured (`getStripeKey()`, swallowed to a warn-log if not,
   `:814-819`) and there are matching services, cancels each row's
   `stripeSubscriptionId` via `stripe.subscriptions.cancel()` — per-row errors are
   caught and logged, **not** aborting the rest of the loop or the request (`:826-836`).
3. Sets every matched `client_services` row to `status = "paused"` (not
   `"cancelled"` — `"paused"` is the terminal status this route lands on, `:838-849`).
4. Revokes every `msp_sales_bundle_assignments` row for this `customerId`
   (`status: "revoked"`, `revokedAt: now`, `:852-859`) — bundle assignments are
   `customerId`-scoped directly, not sibling-login-scoped (a `tenants.id` FK, no
   bridge needed).
5. Sets `tenants.status = "inactive"` for this `customerId` (`:862-868`) — **not**
   `"archived"`; the archived page's own `isCustomerInactive` check
   (`customerStatus === "inactive" || customerStatus === "archived"`) already treats
   both as the same UI state, so this is consistent, just worth knowing only one of
   the two values is ever actually written by this route.
6. Writes a `createAuditLog()` legacy audit row (`actionType: "retainer_cancelled"`)
   **and** an `msp_audit_logs` row (`actionType: "customer.offboarding.deactivate"`,
   `:871-892`) — two separate audit systems written for the same action, both real.

Response: `{ ok: true, customerStatus: "inactive" }`. 500
`{ error: "Failed to complete offboarding process" }` on any thrown error.

---

## 6. Wire contract — `GET /api/portal/customer/export`

Auth: `requireRole("CustomerUser")` (`:907`). No query params. 400
`{ error: "No customer account associated with this user" }` if
`req.user!.customerId` is missing (`:911-914`).

Scoped across every linked login via `resolveCustomerUserIds(customerId)` (`:920`,
same correct bridge as §5). Response (`:962-984`):

| Field | Type | Source |
|---|---|---|
| `exportedAt` | `string` (ISO) | generation time |
| `customer.name` | `string \| undefined` | `tenants.customerName` |
| `customer.domain` | `string \| null \| undefined` | `tenants.domain` |
| `customer.industry` | `string \| null \| undefined` | `tenants.industry` |
| `customer.tenantId` | `string \| undefined` | `tenants.tenantId` |
| `customer.status` | `"active" \| "inactive" \| "onboarding" \| "archived"` \| undefined | `tenants.status` |
| `services[]` | `Array<{ id, status, purchasedAt, serviceName, billingType, price }>` | `client_services` inner-joined to `services`, sibling-scoped by `clientUserId` |
| `projects[]` | `Array<{ title, status, progress, createdAt }>` | `projects`, sibling-scoped by `clientUserId` |
| `reports[]` | `Array<{ title, period, createdAt }>` | `reports`, sibling-scoped by `clientUserId` |
| `diagnostics[]` | `Array<{ engineKey, score, breakdown, capturedAt }>` | `tenant_engine_snapshots`, scoped directly by `customerId` (a `tenants.id` FK, no bridge needed — same non-sibling pattern as §5's bundle-assignment revoke) |

`customer` is built from a single un-scoped `tenants` row lookup by `id`
(`:923-927`) — `customer` is `undefined`-safe via optional chaining
(`customer?.customerName` etc, `:965-969`) rather than a 404, so a customer whose
`tenants` row is somehow gone still gets a `200` with an empty `customer` object
rather than an error.

`services[].price` reads `services.price` (legacy numeric-string column) rather than
the canonical `services.priceCents` this codebase otherwise standardizes on for
checkout — real, current behaviour for this historical-record export, not filed as a
bug (an export snapshot of what a customer once purchased, not a live billing
computation the `price`-vs-`priceCents` drift memo is really about).

500 `{ error: "Failed to generate data export" }` on any thrown error.

---

## 7. Real enum unions

- **Offboarding state** — `msps.offboarding_state`
  (`MSP_OFFBOARDING_STATES`, `msp.ts:31`): `"cancellation_requested" |
  "export_ready" | "archival_flagged"`, nullable — `null` is the real pre-offboarding
  default, not a 4th named state. Forward-only in practice: every route in §2-§4
  either refuses to move a state backward or refuses to skip a step; there is no
  route anywhere in this codebase that resets `offboardingState` back to `null`
  once set (confirmed by grep — `offboardingState:` is only ever assigned one of the
  3 non-null values across the whole `artifacts/api-server` tree).
- **MSP status** — `msps.status` (`msp.ts:41`): `"active" | "suspended" | "trial"`.
  `/msp/offboarding/archive` (§4) is the only route in this pack that writes it
  (`→ "suspended"`).
- **MSP role hierarchy** — `MSP_ROLES` (`index.ts:37`): `["PlatformAdmin",
  "MSPAdmin", "MSPOperator", "CustomerUser", "ServiceAccount", "Free",
  "Assessment"]` — the array's declared order is NOT the privilege order used for
  gating. The real privilege order is `ROLE_ORDER` (`requireAuth.ts:80-88`), lowest
  to highest: `Assessment < Free < CustomerUser < ServiceAccount < MSPOperator <
  MSPAdmin < PlatformAdmin`. Every `requireRole(x)` call in this pack is a
  minimum-tier gate against `ROLE_ORDER`, not `MSP_ROLES`.
- **Tenant (customer) status** — `tenants.status` (`msp.ts:218`): `"active" |
  "inactive" | "onboarding" | "archived"`, default `"onboarding"`. §5 writes
  `"inactive"` only; `"archived"` exists in the enum but no route in this pack ever
  writes it (a real, unused-by-this-Feature value — see the archived page's own
  `isCustomerInactive` check treating both as equivalent UI state, §5).
- **Client service status** — `client_services.status` (`index.ts:634`):
  `"active" | "completed" | "paused"`. §5 transitions matched rows to `"paused"`
  only; `"completed"` is never touched by offboarding.
- **Bundle assignment status** — `msp_sales_bundle_assignments.status`: §5 writes
  `"revoked"` only; the full enum is out of this pack's scope (owned by the Sales
  Bundles Feature).
- **Billing type** — `services.billing_type` (`index.ts:477`): `"one_time" |
  "recurring_monthly"`, surfaced read-only in §6's export.
- **Report period** — `reports.period` (`index.ts:725`): `"weekly" | "monthly" |
  "executive_summary" | "other"`, surfaced read-only in §6's export — same enum
  `docs/documents-contract-pack.md` §3 already documents for `/portal/reports`.

---

## 8. Finding — two of the three offboarding lifecycle events are misclassified as low-severity in the MSP events feed

**`msp-portal.ts:729`'s severity-derivation branch for `GET /api/msp/events`
checks `r.eventType.startsWith("msp.offboarding")` to assign `severity: "warning"`.**
No event this Feature actually writes matches that prefix:

- `/msp/offboarding/request` writes `eventType: "msp.cancellation_requested"`
  (`:420`) — matches the *other* branch, `startsWith("msp.cancellation")` (`:727`),
  and correctly gets `severity: "critical"`.
- `/msp/offboarding/export` writes `eventType: "msp.export_ready"` (`:562`) —
  matches neither branch.
- `/msp/offboarding/archive` writes `eventType: "msp.archival_flagged"` (`:649`) —
  matches neither branch.

Consequence: an MSP's export-ready and archival-flagged transitions — real,
consequential lifecycle events an operator monitoring `/msp/events` would want
flagged — render at the default `severity: "info"` (`:726`) alongside routine
activity, indistinguishable from noise. Only the very first step
(`cancellation_requested`) gets elevated severity; the two steps that actually
finish the process do not. This is a real, live bug in shipped code, not a gap in
this pack's own coverage — filed as #2510, sibling of this issue's own Feature
parent #1653, labeled `bug`.

---

## 9. Honest-empty / partial-data contract

- **`GET /api/msp/dashboard`**: every count/sum defaults to `0` via
  `Number(x ?? 0)` coercion (`:290-292, 310`) — a brand-new MSP with zero of
  everything gets real zeros, not a fixture. `idleBundles` is a real `[]` when
  none qualify. `aiAlertThreshold`/`aiPeriodUsagePct` are the one pair of fields
  with a genuine third state (`null`) distinguishable from `0` — `getAiBalance()`
  failure is silently swallowed to `null` rather than surfaced as an error
  (`:277`), so a caller cannot currently tell "AI billing not configured for this
  MSP" apart from "AI billing lookup failed" — both collapse to `null`. Not filed;
  low-severity, and the route's own inline comment (`:275-276`) documents this as a
  deliberate choice ("this widget is optional").
- **`POST /api/msp/offboarding/request`**: the 409-on-already-in-progress (§2) is
  itself the honest signal — a caller cannot double-request by accident and get a
  silently-ignored no-op; it gets a real, distinguishable error naming the current
  state.
- **`POST /api/msp/offboarding/export`**: genuinely idempotent-feeling but not
  fully idempotent (§3) — every call regenerates a real, current-data export
  package (never a stale cached one), but only the *first* call while
  `cancellation_requested` writes the state-advance event/audit rows. A caller
  re-exporting after `export_ready` gets a real package every time, just without a
  second audit trail entry — an honest trade-off (avoids audit-log spam from
  repeated downloads), not a fixture.
- **`GET /api/portal/customer/export`**: a customer with zero services/projects/
  reports/diagnostics gets real `[]` arrays for each (`:929-960`), not a fixture
  branch. `customer` degrades to an object of `undefined` fields rather than a 404
  if the `tenants` row is gone (§6) — an honest degrade, not a fake customer
  record.

---

## 10. Cross-surface edges

- **`msps.status` is shared, not offboarding-exclusive**: `/msp/offboarding/archive`
  (§4) writes `status = "suspended"` — the exact same field/value the 7-day
  suspended-banner threshold (schema comment, `msp.ts:43-44`) and `/msp/dashboard`'s
  own `msp.status` field (§1) both read. Archiving an MSP and suspending it for
  non-payment are two different real code paths that land on the identical
  `status` value; Design should know an `archival_flagged` MSP is indistinguishable
  from a suspended-for-other-reasons MSP by `status` alone — `offboardingState`
  is the field that actually disambiguates.
- **`tenants.status` vs. Customer Home's `customerStatus`**: §5's `"inactive"`
  write is the exact field `docs/customer-home-and-timeline-contract-pack.md` §2
  documents as `GET /api/portal/dashboard`'s `customerStatus` (`tenants.status`,
  coalesced to `null`) — a customer who self-offboards via §5 will see that
  reflected on `/portal/dashboard` immediately, no separate sync needed, since
  both routes read/write the same column.
- **`resolveCustomerUserIds` vs. `resolveSiblingUserIds`**: §5/§6 both call
  `resolveCustomerUserIds(customerId)` directly (`tenants.id` entry point,
  correct — this route already has the `tenants.id` from session). This is a
  sibling function to `resolveSiblingUserIds(userId)` (`users.id` entry point,
  used by `docs/documents-contract-pack.md` §1/§2) — same underlying bridge,
  different entry shape; not a scoping inconsistency, just two legitimate
  entry points into the one real fix (#1397).
- **`msp_event_store` write pattern**: all three of §2/§3/§4's lifecycle events
  (`msp.cancellation_requested`, `msp.export_ready`, `msp.archival_flagged`) land
  in the same table `/msp/events` (§8) reads — the misclassification in §8 is a
  read-side bug, not a write-side gap; all three events are genuinely there to be
  read.
- **Two audit systems, one action**: §5 writes both the legacy
  `createAuditLog()` helper (`actionType: "retainer_cancelled"`) and
  `msp_audit_logs` (`actionType: "customer.offboarding.deactivate"`) for the same
  customer-offboard action — both real, both fire, not a duplicate-vs-canonical
  situation this pack found evidence to resolve either way.

---

## Orphaned-endpoint check

None of the 6 routes in this pack has a live frontend caller anywhere in the
current tree:

```
grep -rn "msp/dashboard\|msp/offboarding\|portal/customer/export\|portal/customer/offboard" artifacts/portal/src artifacts/msp-website artifacts/shane-mccaw-consulting
```

returns no matches. This is expected, current state — `artifacts/msp-portal` (the
only prior caller, via the archived `offboarding.tsx`) was retired 2026-08-29, and
no `Design/portal/` export exists yet for Offboarding (`ls Design/portal/` has no
offboarding `.dc.html`). All 6 routes are real, under test
(`msp-portal.test.ts`, `portal-customer-offboard.test.ts`), and none is exercised by
any live surface today — that is the honest state Design should build against, not
a gap this pack needs to close.

---

## Not covered by this pack

Per #2444 Step 3, no page/UI-shape decisions are made here. This pack extracts what
exists on the 4 endpoints named in #2444's own Step 1, plus the 2 real siblings
(`/msp/offboarding/archive`, `/portal/customer/offboard`) needed to honestly
describe the same state machine and Feature. `GET /api/msp/dashboard`'s `telemetry`
sub-object (§1, `aggregateMspTelemetry`) is real but belongs to a separate MSP KPI
dashboard Feature, not Offboarding — cited here only far enough to be honest about
the endpoint's full shape, not analyzed field-by-field. `GET /api/portal/dashboard`
is fully covered by its own pack (`docs/customer-home-and-timeline-contract-pack.md`)
and only its `customerStatus` field is cited here (§6/§10), since that is the one
field this Feature's archived page actually read from it.
