# Sales Offers and Sales Bundles — MSP Console contract extraction pack

**#3357**, parented directly under #1571 (EPIC: Portal Admin) — #3357 itself has no more
specific Feature-tier parent (`gh issue view 3357 --json parent` returns #1571 directly).

Real, confirmed backend, no pack existed for this surface until now. `docs/msp-console/
offers-and-sow-acceptance-msp-console-contract-pack.md` (#2641) documents `msp-sow.ts`'s own
offer-acceptance/SOW pipeline and only incidentally references `salesOffersTable`; it explicitly
does not cover `msp-sales-offers.ts` or `msp-sales-bundles.ts`'s own routes. This pack is that gap,
extracted to the same standard: read-only, every field cited to file:line, cross-checked live
against local PostgreSQL. **Nothing here is authored or invented.**

Backend: two files, all 20 routes live and mounted (`artifacts/api-server/src/routes/index.ts:238,
240, 602, 604` — `import mspSalesBundlesRouter from "./msp-sales-bundles"; ... import
mspSalesOffersRouter from "./msp-sales-offers"; ... router.use(mspSalesBundlesRouter); ...
router.use(mspSalesOffersRouter);`):

- `artifacts/api-server/src/routes/msp-sales-offers.ts` (425 lines) — MSP-scoped Sales Offer
  Engine surface: generate/list/get/patch/transition/delete an offer, plus an SSE stream.
- `artifacts/api-server/src/routes/msp-sales-bundles.ts` (836 lines) — MSP Sales Bundle Builder:
  compose/price/assign platform-authored Monitoring Packages under an MSP's own branded bundles.

Schema: `lib/db/src/schema/index.ts:3384` (`SALES_OFFER_STATES`), `:3397` (`salesOffersTable`),
`:3471` (`salesOfferEventsTable`), `:3493` (`salesOfferConfigTable`); `lib/db/src/schema/msp.ts:2228`
(`monitoringPackagesTable`), `:3529` (`MSP_SALES_BUNDLE_STATUS`), `:3532` (`mspSalesBundlesTable`),
`:3563` (`MSP_BUNDLE_ASSIGNMENT_STATUS`), `:3566` (`mspSalesBundleAssignmentsTable`). Verified live
against local PostgreSQL (`psql "$DATABASE_URL" -c '\d sales_offers'` / `'\d msp_sales_bundles'` /
`'\d msp_sales_bundle_assignments'` / `'\d monitoring_packages'`) — every FK and column cited below
confirmed present on the running schema, not just the Drizzle source. §6c's finding was **only
discoverable live**, cross-referencing a third file (a manual migration) neither route file
touches.

Sources read in full: `msp-sales-offers.ts` (425 lines, no test file exists for it — a real gap,
see §9), `msp-sales-bundles.ts` (836 lines) + `msp-sales-bundles.test.ts` (295 lines, pure-logic
unit tests — read to confirm real, currently-asserted behavior, not as a source of new facts),
`sales-offer-engine.ts` (534 lines, every exported function), `resolve-msp-id.ts` (all 4 exports),
`requireAuth.ts` (`requireRole`, `requireMspScope`, `assertCustomerAccess`,
`isCustomerBlockedByStaffScope`), `msp-entitlement.ts` (`requirePlanFeature`, `PLAN_FEATURE_DEFS`),
`sse-channels.ts` (the `engine.offer` channel, both MSP- and customer-scoped sub-channels). Cross-
referenced for cross-surface edges: `msp-sow.ts` §1.1 (via the existing SOW pack, re-verified against
current line numbers), `portal-offers.ts` (`POST /portal/offers/:id/accept` and `/reject`),
`lib/db/migrations/manual/2026-07-19-customer-dashboard-category-tabs.sql` (§6c).

---

## 0. The surface and its consumers

### 0.1 Consumer map

| Endpoint | Method | Line | Consumer today | Status |
|---|---|---|---|---|
| `/api/msp/:mspId/sales-offers` | GET | `msp-sales-offers.ts:70` | none | live, zero UI callers |
| `/api/msp/sales-offers/sse` | GET | `:108` | none | live, zero UI callers |
| `/api/msp/sales-offers/generate` | POST | `:160` | none | live, zero UI callers |
| `/api/msp/:mspId/sales-offers/expire-stale` | POST | `:210` | none | live, zero UI callers |
| `/api/msp/:mspId/sales-offers/:id` | GET | `:231` | none | live, zero UI callers |
| `/api/msp/sales-offers/:id/events` | GET | `:260` | none | live, zero UI callers |
| `/api/msp/sales-offers/:id` | PATCH | `:294` | none | live, zero UI callers |
| `/api/msp/sales-offers/:id/state` | PATCH | `:344` | none | live, zero UI callers |
| `/api/msp/sales-offers/:id` | DELETE | `:392` | none | live, zero UI callers |
| `/api/msp/monitoring-packages` | GET | `msp-sales-bundles.ts:152` | none | live, zero UI callers |
| `/api/msp/sales-bundles/pricing-preview` | GET | `:187` | none | live, zero UI callers |
| `/api/msp/sales-bundles` | GET | `:237` | none | live, zero UI callers |
| `/api/msp/sales-bundles` | POST | `:281` | none | live, zero UI callers |
| `/api/msp/sales-bundles/:bundleId` | GET | `:361` | none | live, zero UI callers |
| `/api/msp/sales-bundles/:bundleId` | PATCH | `:412` | none | live, zero UI callers |
| `/api/msp/sales-bundles/:bundleId` | DELETE | `:504` | none | live, zero UI callers |
| `/api/msp/sales-bundles/:bundleId/assignments` | GET | `:557` | none | live, zero UI callers |
| `/api/msp/sales-bundles/:bundleId/assignments` | POST | `:613` | none | live, zero UI callers |
| `/api/msp/sales-bundles/:bundleId/assignments/:assignmentId` | DELETE | `:711` | none | live, zero UI callers |
| `/api/msp/customers/:customerId/bundle-assignments` | GET | `:781` | none | live, zero UI callers |

**All 20 are genuinely unconsumed today** (§7) — the expected pre-Design/pre-wire state.
`artifacts/msp-console` exists as a real, running, registered Vite app (unlike the SOW pack's own
#2568-era finding that it didn't exist yet), but it is still the bare #2668 scaffold: its one real
page (`artifacts/msp-console/src/pages/index.tsx`) is an explicit placeholder ("no chrome or pages
built yet... real surfaces land under Epic #1571 and Feature #2667"). No route in either file has
ever had a live frontend caller anywhere in the tree — not `artifacts/msp-console`, not
`artifacts/admin-panel`, not `artifacts/portal`, not the retired `portal-v2` archive.

### 0.2 Two structurally different route-shape conventions inside one issue's own scope

`msp-sales-offers.ts`'s header comment itself distinguishes two shapes: `GET
/api/msp/:mspId/sales-offers`, `GET .../:id`, and `POST .../expire-stale` are **path-scoped**
(`:mspId` in the URL, gated by `requireMspScope("params")`, `requireAuth.ts:245-281`) — the
correct pattern per `resolveMspIdStrict()`'s own doc comment (`resolve-msp-id.ts:64-77`) for
admin-facing cross-MSP access. The other 5 routes (`generate`, `:id/events`, `PATCH :id`, `PATCH
:id/state`, `DELETE :id`) are **session-scoped** (no `:mspId` in the URL) but resolve via
`resolveMspId(req)` (`resolve-msp-id.ts:28-53`) instead of the strict variant — which still allows
a `PlatformAdmin`/`admin` `?mspId=` override on a route shape `resolveMspIdStrict()`'s own comment
says should never allow one. `msp-sales-bundles.ts` doesn't use either shared helper at all — its
own private `getMspId()` (`:56-65`) does the same query-override resolution, and **none** of its 11
routes has a `:mspId` path segment to justify it. Filed as **#3387** (§6b).

---

## 1. Wire contract — `msp-sales-offers.ts`

### 1.1 `GET /api/msp/:mspId/sales-offers` (`:70-102`) — list

`requireRole("MSPOperator")`, `requireMspScope("params")`. Filters: `state` (validated against
`SALES_OFFER_STATES`, silently ignored if not a member — no 400), `customerId`, `limit` (default
200, capped 500), `offset`. Ordered `score DESC, createdAt DESC` (`:92`) — highest-relevance offers
surface first, not newest-first. Returns the **entire raw row set** — no curated `Wire*` shape,
same as the SOW pack's §0.2 finding for its own file. Response: `{offers, limit, offset}`.

### 1.2 `GET /api/msp/sales-offers/sse` (`:108-156`) — real-time offer-change stream

No `requireRole`/`requireAuth` middleware at all on the route itself — auth is done **entirely
inline** (`:108-129`) because `EventSource` cannot set an `Authorization` header, so the JWT is
accepted via `?token=` instead. Verifies with `jwt.verify(token, process.env["JWT_SECRET"])`
(`:118`), then re-derives the effective role and checks it against a **hand-rolled role-order
array** (`ROLE_ORDER`, `:125`) rather than importing `requireRole`'s own comparison — a second,
independent copy of the same MSP role hierarchy (`Assessment < Free < CustomerUser <
ServiceAccount < MSPOperator < MSPAdmin < PlatformAdmin`). `mspId` resolution here (`:131-133`) is
its own third variant: admin/PlatformAdmin reads `?mspId=` with **no fallback** to the caller's own
`mspId` if absent (unlike `msp-sales-bundles.ts`'s `getMspId()`, §0.2) — an admin with no
`?mspId=` gets a `400` here, not their own MSP's stream. Registers via
`registerMspOfferSSEClient(mspId, res, ...)` (`sse-channels.ts:253-255`) on the shared
`"engine.offer"` hub channel; a 30s heartbeat (`:148-150`) keeps the connection alive.

### 1.3 `POST /api/msp/sales-offers/generate` (`:160-206`) — run engine + persist

`requireRole("MSPOperator")`, `requirePlanFeature("sales_offers")` (`msp-entitlement.ts:96-154` —
gated per-tier via `tier.tierCapabilities`, defined in `PLAN_FEATURE_DEFS`,
`msp-entitlement.ts:229-232`; missing key = not gated). `mspId` via `resolveMspId(req)` (§0.2).
Body: `customerId` (required, numeric). **Ownership check runs before the engine fires**
(`:178-181`, `assertCustomerAccess(req.user!, customerId)`, `requireAuth.ts:306-335`) — the route's
own comment (`:175-177`) states this replaced an earlier version that "trusted `body.customerId`
and relied solely on the engine's `mspId` scoping," a real, acknowledged prior gap now closed.
Calls `runSalesOfferEngineForTenant()` then `persistSalesOfferCandidates()` (§2). Broadcasts
`broadcastMspOfferChange()` only if `insertedIds.length > 0` — a re-run that produces zero new
offers (all idempotency keys already exist) emits **no** SSE event, correctly distinguishing "ran,
nothing new" from "ran, something changed." Response `201`: `{insertedOfferIds, candidateCount,
firedSignals}`.

### 1.4 `POST /api/msp/:mspId/sales-offers/expire-stale` (`:210-227`)

`requireRole("MSPOperator")`, `requireMspScope("params")`, `requirePlanFeature("sales_offers")`.
Calls `expireStaleSalesOffers(mspId)` (§2, scoped sweep). This is the **MSP-scoped** counterpart to
`sales-offers.ts`'s own `requireAdmin`-gated, path-less `POST /api/sales-offers/expire-stale`
(`sales-offers.ts:244-263`), which calls `expireStaleSalesOffers()` with **no** argument — the
unscoped, platform-wide sweep `expireStaleSalesOffers()`'s own doc comment
(`sales-offer-engine.ts:512-515`) says is "intended solely for the platform-admin sweep route."
Two real, separate entry points into the same sweep function, correctly scoped to their respective
callers — not a bug, a documented split. **No scheduled job calls either** — unlike the SOW pack's
own `sow-expiry-sweep.ts`, there is no equivalent cron/scheduler for stale sales offers in this
codebase (`grep -rn "expireStaleSalesOffers"` outside routes/ returns only `sales-offer-engine.ts`
itself, the function's own definition). A `"sent"` offer whose `expiresAt` has passed simply sits
stale until one of these two routes is called by hand — not filed (no live caller exists to call
either route today, same pre-wire state as everything else in §0.1), flagged for whoever wires this
Feature's real UI.

### 1.5 `GET /api/msp/:mspId/sales-offers/:id` (`:231-256`) — get single offer

`requireRole("MSPOperator")`, `requireMspScope("params")`. `(id, mspId)` lookup, 404 otherwise.
Full raw row, wrapped `{offer}` (unlike §1.1's bare `{offers}` array — a real, minor shape
asymmetry between the list and detail responses of the same resource, not filed).

### 1.6 `GET /api/msp/sales-offers/:id/events` (`:260-290`) — event log

`requireRole("MSPOperator")`. `mspId` via `resolveMspId(req)` (§0.2). Confirms the offer belongs to
the resolved `mspId` first (`:271-276`, 404 otherwise), then returns every
`salesOfferEventsTable` row for that offer, ordered `createdAt ASC` (oldest first — a true
chronological audit trail, unlike some other list endpoints in this codebase that default to
newest-first). See §6a — this table is not a complete acceptance record.

### 1.7 `PATCH /api/msp/sales-offers/:id` (`:294-340`) — edit title/rationale

`requireRole("MSPOperator")`, `requirePlanFeature("sales_offers")`. `mspId` via `resolveMspId(req)`
(§0.2). **422 unless `state === "draft"`** (`:318-321`) — an offer that has ever been sent can
never have its title/rationale edited again, by design. Trims both fields; empty-string
`rationale` is stored as `null` (`:325`), not an empty string. Broadcasts
`broadcastMspOfferChange()` unconditionally on success.

### 1.8 `PATCH /api/msp/sales-offers/:id/state` (`:344-388`) — transition offer state

`requireRole("MSPOperator")`, `requirePlanFeature("sales_offers")`. `mspId` via `resolveMspId(req)`
(§0.2). Body: `newState` (must be a member of `SALES_OFFER_STATES`, 400 otherwise),
`rejectionReason` (optional). Calls the shared `transitionOfferState()` (§2) — the **same**
function `portal-offers.ts`'s customer-facing accept/reject routes call. **This is the most
severe real finding in this pack — §6a, filed as #3386**: this generic transition endpoint has no
knowledge of `services.serviceClass` and performs **zero fulfillment** — an MSPOperator can move an
offer straight to the terminal `"accepted"` state with no SOW created, no Stripe charge, no
Monitoring-Tier gate, and (per `VALID_TRANSITIONS`, §2) no way back out. Broadcasts to both the
MSP's own channel and, if `existing.customerId` is set, the customer's channel too
(`broadcastCustomerOfferChange`, `:373-375`) — a real cross-tenant-facing side effect from an
MSP-console-only action, correctly scoped to the specific customer, not broadcast platform-wide.

### 1.9 `DELETE /api/msp/sales-offers/:id` (`:392-423`)

`requireRole("MSPOperator")`, `requirePlanFeature("sales_offers")`. `mspId` via `resolveMspId(req)`
(§0.2). **422 unless `state === "draft"`** — matches §1.7's edit gate exactly; once an offer has
ever been sent, it can be transitioned or left alone, but never deleted or edited. Combined with
§1.8's finding: an offer stuck in `"accepted"` via the generic transition route cannot be cleaned
up here either (only `"draft"` is deletable) — there is genuinely no recovery path in this file for
that state.

---

## 2. Internal contract — `sales-offer-engine.ts`

Not routes — the shared library both `msp-sales-offers.ts` and the platform-admin
`sales-offers.ts` import from directly (two separate route files, one real implementation, same
discipline the SOW pack's §1.7 noted for `triggerMspCharge()`).

- **`computeSalesOfferEngine()`** (`:113-234`) — pure, deterministic. Reads eligibility/pricing/
  scoring/bundling/expiration rule groups (`salesOfferRuleGroupsTable`), computes
  `adjustedPriceCents` from `services.basePrice`/`.price` (Product Catalog, never a hardcoded
  price table — confirmed, `priceToCents()` at `:245-249` only parses the catalog's own string
  price column), scores 0-100, caps at `config.maxOffersPerGenerate`. `idempotencyKey` is a SHA-256
  of `customerId:serviceId:sortedFiredSignals` (`:251-254`) — deterministic re-runs against
  unchanged signals never produce a duplicate row.
- **`runSalesOfferEngineForTenant()`** (`:301-336`) — the async wrapper `generate` (§1.3) calls.
  Loads tenant signal profile, rule groups, full Product Catalog, and MSP-level engine config in
  parallel (`Promise.all`, `:306-322`), then delegates to the pure function above.
  `buildSignalLabelMap()` (`:285-297`) humanizes fired-signal keys for the offer's `rationale`
  text, preferring `signal_derivation_rules.description` then `signal_rule_groups.label` — the same
  precedence documented elsewhere in this codebase for the admin-engines portal-snapshot breakdown.
- **`persistSalesOfferCandidates()`** (`:352-425`) — `onConflictDoNothing({target:
  salesOffersTable.idempotencyKey})` (`:385`) makes the whole insert idempotent at the DB level, not
  just in application logic. For each **newly inserted** offer: emits `offer.generated`
  (`emitOfferEvent`, §below) and, if the customer has an active portal user
  (`resolveCustomerPortalUserId`), pushes a real Notification Center entry (category `"offer"`,
  deep-linked to `/customer-offers`) — non-fatal (`createNotification` swallows its own errors),
  and correctly skipped (not faked) when there is no active portal user for that customer.
- **`emitOfferEvent()`** (`:429-452`) — the one write path for `sales_offer_events`. Idempotency-key
  gated when a key is supplied (checks for an existing row with that key before inserting) — used
  by the generation path, not by state transitions (which pass no idempotency key and can
  legitimately fire the same `eventName` more than once, e.g. re-`draft`→`sent`→... across offers).
- **`transitionOfferState()`** (`:464-504`) — the shared state-machine writer. `VALID_TRANSITIONS`
  (`:456-462`, verbatim):
  ```ts
  const VALID_TRANSITIONS: Record<SalesOfferState, SalesOfferState[]> = {
    draft:    ["sent", "expired"],
    sent:     ["accepted", "rejected", "expired"],
    accepted: [],
    rejected: [],
    expired:  [],
  };
  ```
  `"sent"` stamps a fresh `expiresAt` from `config.defaultExpirationDays` (`:481-489`);
  `"accepted"`/`"rejected"`/`"expired"` stamp `closedAt`; `rejectionReason` only persists on
  rejection. Emits `offer.${newState}` unconditionally on success. **No branch here ever reads
  `serviceClass`** — this function has no concept of project vs. add_on vs. subscription, which is
  exactly why §1.8/§6a's finding is real: any caller of this function bypasses fulfillment by
  construction, not by a bug in this function itself (this function was never meant to fulfill
  anything — the bug is that §1.8's route exposes it as if it were a complete accept action).
- **`expireStaleSalesOffers()`** (`:516-534`) — `mspId` optional; omitted = platform-wide sweep
  (§1.4). Raw SQL fragment for the date comparison (`sql\`expires_at IS NOT NULL AND expires_at <
  NOW()\``, `:519`) rather than a Drizzle date-comparison helper — functionally equivalent, just a
  different idiom than most of this codebase's Drizzle-native comparisons.

---

## 3. Wire contract — `msp-sales-bundles.ts`

### 3.1 `GET /api/msp/monitoring-packages` (`:152-181`) — list platform-authored packages

`requireRole("MSPOperator")`. **No plan gate** (the file's own header comment, `:8-10`, states this
deliberately: "Does not gate on plan — the UI uses `requiredPlanFeature` to inform the user, and
bundle creation gates on `custom_bundle_composition`"). Filters `status = "active"` only — a
platform admin's draft/deprecated packages never leak into an MSP's own bundle-builder list.
Returns the curated 10-field projection (`:160-171`), including each package's own
`requiredPlanFeature` string (informational — the client is expected to grey out a package the
MSP's tier doesn't cover, since the server itself doesn't block *listing* it).

### 3.2 `GET /api/msp/sales-bundles/pricing-preview` (`:187-233`) — no-side-effect cost calculator

`requireRole("MSPOperator")`. Query: `packageKeys[]` (repeatable). Empty input → `{packageKeys: [],
internalCostCents: 0, breakdown: []}` — a real, deliberate empty-state, not an error. For a
non-empty set, looks up matching `monitoring_packages` rows and returns a per-package
`{key, label, platformCostCents, engines, requiredPlanFeature, available}` breakdown
(`available: pkg.status === "active"`) plus the summed `internalCostCents`. **Unknown keys are
silently dropped** — a `packageKeys` array containing a key that doesn't exist in
`monitoring_packages` at all produces a shorter `breakdown` array with no error and no signal that
anything was omitted (contrast the create/update routes, §3.3/§3.5, which explicitly 400 on unknown
keys). Not filed — this route's own purpose is a non-committal preview, and the create/update paths
are where an unknown key is actually rejected — but worth Design awareness: a client that builds
its "here's what you selected" UI purely from this response's `breakdown` array would silently drop
an invalid selection with no error surfaced to the operator.

### 3.3 `GET /api/msp/sales-bundles` (`:237-275`) — list MSP's bundles

`requireRole("MSPOperator")`. `mspId` via the file's own `getMspId()` (§0.2). Optional `status`
filter (cast directly to the enum type with no membership validation — same pattern the SOW pack's
§1.3 flagged for `msp-sow.ts`'s own list route: an invalid string produces zero matching rows via
Drizzle's typed `eq`, not a 400). Two parallel queries (`Promise.all`, `:255-267`) for the page plus
a separate `count()` for `total`. Ordered `createdAt DESC`.

### 3.4 `POST /api/msp/sales-bundles` (`:281-357`) — create bundle

`requireRole("MSPAdmin")` — **stricter than every other route in this file** (all others are
`MSPOperator`). This is the one real role-tier asymmetry in the bundles surface: an ordinary
MSPOperator can list/preview/view bundles and assignments but cannot create, edit, delete, assign,
or revoke — those five mutating routes (§3.4, §3.6, §3.7, §3.8, §3.9) all require `MSPAdmin`.
Contrast `msp-sales-offers.ts`, where every mutating route (§1.3, §1.7, §1.8, §1.9) only requires
`MSPOperator` — the two surfaces this issue covers do not share a role-gating convention with each
other. Not filed (plausibly deliberate — bundles carry real pricing/margin decisions an operator
shouldn't set unilaterally — but flagged since nothing in either file's comments states the
asymmetry is intentional).

Validates body via `createBundleSchema` (Zod, `:124-131`: `name` 1-120 chars, `monitoringPackageKeys`
1-20 entries, `resalePriceCents` ≥0 integer, `trialDays` 1-365 or null, `status` draft/active
default draft). **Plan-gate is inline, not middleware-declarative** (`:295-305`): because gating
depends on the parsed body (`monitoringPackageKeys.length > 1`), the route manually invokes
`requirePlanFeature("custom_bundle_composition")` as a plain function inside a `new Promise`,
checking `res.headersSent` to detect whether the gate already responded — a real, unusual pattern
compared to every other `requirePlanFeature` call in this codebase (all of which are declared
declaratively in the route's own middleware chain). Functionally correct (confirmed by
`msp-sales-bundles.test.ts`'s own plan-gating suite, `:112-173`, though those tests exercise the
tier-capability logic directly, not this inline-invocation wrapper itself). Every submitted key is
validated against real `monitoring_packages` rows — unknown (`:314-319`) or inactive (`:320-324`)
keys 400 the whole request, no partial bundle is ever created. `internalCostCents` computed
server-side from real `platformCostCents` sums — never trusts a client-supplied cost.

### 3.5 `GET /api/msp/sales-bundles/:bundleId` (`:361-408`) — detail

`requireRole("MSPOperator")`. `(bundleId, mspId)` lookup, 404 otherwise. Enriches with the full
package objects for every key in `bundle.monitoringPackageKeys` (`:378-392`) and a live
`activeAssignmentCount` (`:394-400`, filtered `status = "active"`). **§6c's finding lives here**:
for the one real MSP whose bundle references non-existent package keys, this enrichment silently
returns `packages: []` — no error, no partial match, nothing to signal the mismatch to whoever
built the UI against this response.

### 3.6 `PATCH /api/msp/sales-bundles/:bundleId` (`:412-499`) — update

`requireRole("MSPAdmin")`. Same `createBundleSchema`-adjacent Zod validation (`updateBundleSchema`,
all fields optional), same inline plan-gate pattern (re-evaluated against `newKeys = body.
monitoringPackageKeys ?? existing.monitoringPackageKeys` — so shrinking a bundle from 3 packages to
1 does **not** re-check the gate, only a resulting multi-package count triggers it), same
unknown/inactive key validation re-run if `monitoringPackageKeys` is part of the patch. `status`
can move `draft → active → archived` — no state-machine validation of the transition itself (any
of the three enum values is accepted from any current status, unlike the offers surface's
`VALID_TRANSITIONS`); nothing here prevents un-archiving a bundle back to `active`, and nothing
prevents that either — the schema simply permits the full three-value enum unconditionally.

### 3.7 `DELETE /api/msp/sales-bundles/:bundleId` (`:504-553`)

`requireRole("MSPAdmin")`. **409 if any active assignment exists** (`:521-531`) — a bundle
currently in use by even one customer cannot be deleted; the operator must revoke every assignment
first. Real guard against silently orphaning a customer's active monitoring coverage.

### 3.8 `GET /api/msp/sales-bundles/:bundleId/assignments` (`:557-605`) — list a bundle's customers

`requireRole("MSPOperator")`. Left-joins `tenantsTable` for `customerName`/`customerDomain`
(`:592-595`, with an inline comment noting these are aliased to keep the HTTP field names frozen
across the `msp_customers` → `customerName` rename, #92 Phase 4 — the same rename discipline the
SOW pack's assignment routes reference). **Not scoped by `mspId` in its own query** (`:596` filters
only `bundleId`) — but the bundle itself was already confirmed to belong to the caller's `mspId`
two lines earlier (`:565-572`), so cross-MSP leakage would require a bundle ID belonging to another
MSP to somehow pass that check, which it cannot. Not a gap.

### 3.9 `POST /api/msp/sales-bundles/:bundleId/assignments` (`:613-707`) — assign to customer

`requireRole("MSPAdmin")`. Body: `customerId` (required), `tenantId` (optional override). Bundle
must belong to the caller's MSP and be `status === "active"` (`:637-641`, 409 otherwise — a draft or
archived bundle cannot be assigned, matching the create-route's "activate first" comment). Customer
must belong to the same MSP (`:644-651`, 404 otherwise). `resolvedTenantId` prefers the request
body's explicit `tenantId`, falling back to the customer's own `tenantsTable.tenantId`
(`:653`). Trial expiry computed server-side from `bundle.trialDays` (`:656-658`). **Fan-out**:
`emitBundleActivationEvents()` (`sse-channels.ts`-adjacent helper defined in this same file,
`:78-99`) writes one `mspEventStoreTable` row per package key (not one row for the whole bundle) —
the file's own comment (`:609-611`) explains this is deliberate: "Mixed-frequency packages are
fanned out as individual events — each package's engine (Monitoring Package Engine or Live Monitor
Engine) picks up the event matching its frequency." §6c's live bundle would fan out 10 real
`bundle.package.activated` events carrying package keys that match nothing in `monitoring_packages`
— harmless only because that specific bundle's packages have zero `monitoring_package_checks` rows
attached (dashboard-tab containers, per the migration's own Part A comment) and so no engine is
listening for them regardless.

### 3.10 `DELETE /api/msp/sales-bundles/:bundleId/assignments/:assignmentId` (`:711-773`) — revoke

`requireRole("MSPAdmin")`. 409 if already `"revoked"` — not silently a no-op. Sets `status:
"revoked"`, `revokedAt`, then emits one `bundle.package.deactivated` event per package key
(`:745-758`) — the deactivation-side mirror of §3.9's fan-out. **Assignment is looked up scoped to
`(assignmentId, bundleId, mspId)`** (`:720-727`) — correctly triple-scoped, no cross-MSP leakage
possible even with a guessed `assignmentId`.

### 3.11 `GET /api/msp/customers/:customerId/bundle-assignments` (`:781-834`) — a customer's own assignments

`requireRole("MSPOperator")`. The file's own header comment (`:19-22`) frames this as "the
customer-centric complement" to §3.8 — same underlying table, filtered by `customerId` instead of
`bundleId`, inner-joined with `mspSalesBundlesTable` for `bundleName`/`bundleStatus`. **Per-staff
customer scoping is checked here** (`isCustomerBlockedByStaffScope`, `:800-802`,
`requireAuth.ts:380-383`) — a scoped MSP staff member with no assigned relationship to this
customer gets the same 404 as "customer not found in this MSP," fencing a scoped operator out of an
unassigned customer's bundle data. **§3.8 (the bundle-centric list) has no equivalent staff-scope
check** — a scoped MSPOperator can list every customer assigned to a bundle they can see, including
customers outside their own assigned scope, via §3.8, even though the customer-centric mirror route
here would 404 them for the exact same customer if queried directly. Not filed (bounded — this
requires the operator to already know/guess a real `bundleId`, and it leaks only customer
name/domain/assignment metadata, not the customer's own data), flagged as a real, live asymmetry
for whoever wires per-staff scoping onto this Feature's real UI.

---

## 4. Cross-surface edges

| Edge | Mechanism | Notes |
|---|---|---|
| `sales_offers` / `sales_offer_events` shared with `sales-offers.ts` | Two separate route files (`msp-sales-offers.ts`, MSP-scoped vs. `sales-offers.ts`, `requireAdmin`, unscoped/`?mspId=`-filterable) both import `sales-offer-engine.ts` directly | One real implementation, two real entry points — same discipline the SOW pack's §1.7 documented for `triggerMspCharge()` |
| Three real paths to `sales_offers.state = "accepted"` | (1) `msp-sow.ts:141-407`'s dedicated project/add_on/subscription accept route (real fulfillment, raw `UPDATE` — bypasses `transitionOfferState()` entirely, so **no** `sales_offer_events` row is ever written for this path); (2) `portal-offers.ts:214-281`'s customer-facing accept (calls `transitionOfferState()` **and** `fulfillAcceptedProjectOffer()` — real fulfillment, real event row); (3) `msp-sales-offers.ts:344-388`'s generic `PATCH .../state` (calls `transitionOfferState()` only — **no** fulfillment, but **does** write an event row) | §6a's finding (filed #3386): only path (3) produces an "accepted" offer with zero fulfillment, and it is the only MSP-console-native way to do it. Path (1) leaves the fullest fulfillment trail but the thinnest event-log trail; paths (2) and (3) are the reverse — `sales_offer_events` is not, by itself, a complete acceptance audit trail across all three |
| Offer generation → Notification Center | `persistSalesOfferCandidates()` → `createNotification()` (`sales-offer-engine.ts:396-411`) | Real, live, non-fatal — matches the customer-portal's own notification bell, deep-linked to `/customer-offers` |
| `custom_bundle_composition` / `sales_offers` plan features | `PLAN_FEATURE_DEFS` (`msp-entitlement.ts:212-238`) | Both real, registered entries — not invented gate strings; the same registry backs `GET /api/admin/plan-features` for the Admin Panel's tier editor |
| `msp_sales_bundle_assignments` → dashboard category tabs | `lib/db/migrations/manual/2026-07-19-customer-dashboard-category-tabs.sql` | §6c — the one live bundle exists specifically to drive this mechanism, and its stored keys don't match live `monitoring_packages` rows, so it cannot |
| `engine.offer` SSE channel | `sse-channels.ts:245-267` — namespaced so an MSP's numeric id and a customer's numeric id (both start at 1) can never cross-talk (`registerMspOfferSSEClient` vs. `registerCustomerOfferSSEClient`, the latter keyed `"customer:<id>"`) | Real, deliberate isolation, not an incidental prefix |

---

## 5. Real enum unions

| Vocabulary | Values | Where fixed | Enforced by |
|---|---|---|---|
| `sales_offers.state` | `draft`, `sent`, `accepted`, `rejected`, `expired` | `SALES_OFFER_STATES`, `index.ts:3384` | `VALID_TRANSITIONS` (`sales-offer-engine.ts:456-462`) inside `transitionOfferState()` only — no DB CHECK constraint (confirmed live: no `sales_offers_state_check` in `\d sales_offers`) |
| `msp_sales_bundles.status` | `draft`, `active`, `archived` | `MSP_SALES_BUNDLE_STATUS`, `msp.ts:3529` | Zod enum on create/update only (`createBundleSchema`/`updateBundleSchema`) — no transition-order enforcement (§3.6) and no DB CHECK (confirmed live) |
| `msp_sales_bundle_assignments.status` | `active`, `suspended`, `revoked` | `MSP_BUNDLE_ASSIGNMENT_STATUS`, `msp.ts:3563` | **`suspended` is declared but never written anywhere in either route file** — only `active` (on create) and `revoked` (on the one revoke route) are ever set. A real, unused third member of a live enum — not filed (harmless, no code path is missing because of it — just an unimplemented lifecycle state), flagged for Design awareness |
| `monitoring_packages.status` | inherits `MONITOR_CHECK_STATUS` (defined elsewhere; `"active"` is the only value either file ever queries for, `msp.ts:2235`) | Read-only in both files | — |

---

## 6. Findings

### 6a. `PATCH /api/msp/sales-offers/:id/state` can accept an offer with zero fulfillment, and the result is permanently stuck

See §1.8/§2/§4 above for the full mechanism. Filed as **#3386**, parented under #1571, labeled
`bug`.

### 6b. `msp-sales-offers.ts` and `msp-sales-bundles.ts` allow a `PlatformAdmin` `?mspId=` cross-MSP override on session-scoped routes

See §0.2 above for the full mechanism — the same class of finding as `msp-sow.ts`'s own #2731, two
fresh instances. Filed as **#3387**, parented under #1571, labeled `bug`.

### 6c. The one live "Customer Dashboard Category Tabs" bundle references package keys that exist nowhere in `monitoring_packages`

Confirmed live (`psql`): `msp_sales_bundles` has exactly one row (`bundle_id
2d9dc63f-1c05-4e21-a7af-32a7defedc44`, `msp_id 1`, `name "Customer Dashboard Category Tabs"`),
`monitoring_package_keys = ["executive","identity-access","security-posture",
"compliance-governance","collaboration-sharing","licensing-cost","configuration-drift",
"intune-devices","usage-adoption","operational-maturity"]` — a `SELECT key FROM
monitoring_packages WHERE key = ANY(...)` against that exact array returns **zero rows**. All 21
real `monitoring_packages` rows are prefixed (`cat-executive`, `assess:copilot-readiness`,
`core:security-baseline`, `detail:full-item-collection`).

The migration that created this row (`lib/db/migrations/manual/2026-07-19-customer-dashboard-
category-tabs.sql`) defines its 10 category keys WITH the `cat-` prefix throughout — `_dash_cat`
(lines 76-217) and Parts A/B/C (lines 219-253) all read the same temp-table column inside one
transaction, so a single run of the file as it exists today cannot produce the live split actually
seen: `monitoring_packages.key` (Part A) is correctly `cat-executive` etc. (10 real rows, confirmed
live), while `dashboard_templates.target_key` (Part B, `template_type='monitoring_package'`) and
this bundle's own `monitoring_package_keys` (Part C) are both the **unprefixed** `executive` etc. —
live-confirmed on all three tables. `git log --follow` on the migration file shows its SQL body has
not changed since its original commit — whatever produced the live split traces to how/when it was
actually executed, not a later edit this repo has a record of.

Real, live consequence: `msp-sales-bundles.ts`'s own `GET /:bundleId` package-enrichment join
(§3.5) returns `packages: []` for this bundle today, and per the migration's own header comment
this bundle is the intended mechanism for surfacing the 10 real customer-dashboard category tabs —
which, per its own live `dashboard_templates` rows (also unprefixed), cannot ever match a real
`monitoring_packages.key` via this path as currently seeded.

Filed as **#3389**, parented under #1571, labeled `bug`.

---

## 7. Orphaned-endpoint check

```
grep -rn "msp/sales-offers\|msp/.*/sales-offers\|msp/sales-bundles\|msp/monitoring-packages\|msp/customers/.*/bundle-assignments\|msp/customers/.*/clickwrap\|sales-offers/sse\|sales-bundles/pricing-preview" \
  --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v "routes/msp-sales-offers.ts\|routes/msp-sales-bundles.ts\|\.test\.ts"
```

Real result: **zero live frontend callers of any of this pack's 20 routes**, anywhere in the tree —
not `artifacts/msp-console` (which exists and runs, but is still the bare #2668 scaffold with no
real pages), not `artifacts/admin-panel`, not `artifacts/portal`, not the retired `portal-v2`
archive. The only tree hit outside the two route files themselves is a comment cross-reference in
`msp-sow.ts`'s own header, naming its **different**, similarly-shaped `/msp/customers/:customerId/
clickwrap` route — not a caller of anything in this pack. This is the expected pre-#1571-wire
state, the same shape the SOW pack (#2641) and the RBD pack (#2580) both independently found for
their own Features under this Epic — not a gap to file.

---

## 8. Honest-empty / partial-data contract

- **`GET /api/msp/:mspId/sales-offers`**: an MSP with zero offers gets `{offers: [], limit,
  offset}` — a real empty state.
- **Live data today**: 5 real `sales_offers` rows (all `mspId 1`, all `state: "draft"`, real
  catalog-priced service pairings — Identity & Access Hardening, Sharing Exposure Remediation, Data
  Protection Baseline, Drift Baseline & Handover, White-Glove Copilot Adoption — Micro), 5 matching
  `sales_offer_events` rows (one `offer.generated` per offer, from `persistSalesOfferCandidates()`),
  1 `msp_sales_bundles` row (§6c), 0 `msp_sales_bundle_assignments` rows, 21 `monitoring_packages`
  rows (all `status: "active"`, **all with `platform_cost_cents = 0` and `required_plan_feature:
  NULL`** — confirmed live). That last point means `computeInternalCost()` (§3, `msp-sales-
  bundles.ts:68-75`) and every bundle's `internalCostCents` field genuinely compute to `0` for every
  real package that exists today — the "MSP internal cost" concept is fully live and correctly
  wired, but numerically inert against current catalog data. Not a bug — an honest reflection of
  the platform's own current cost data, not a fixture standing in for it.
- **`GET .../:bundleId`**: `activeAssignmentCount` for a bundle with no assignments is a real `0`,
  not omitted. `packages: []` for a bundle whose keys match nothing live (§6c) looks identical to a
  bundle that legitimately has zero packages — the response shape cannot distinguish "empty by
  design" from "orphaned reference," which is exactly why §6c was only catchable by cross-checking
  the DB directly rather than reading either route file's response contract alone.
- **`GET /api/msp/sales-bundles/pricing-preview`** with no `packageKeys`: `{packageKeys: [],
  internalCostCents: 0, breakdown: []}` — real empty state (§3.2).

---

## 9. The forbidden list — declared, not merely absent

1. **No cross-MSP read/write via the normal path** for a non-admin caller — every route in both
   files scopes strictly to the caller's own `mspId` once resolved. §6b's finding is bounded to
   already-privileged `PlatformAdmin`/`admin` callers on routes whose path shape says it shouldn't
   allow an override, not a privilege-escalation path for an unprivileged one.
2. **Draft-only edit/delete on offers.** §1.7/§1.9 both gate on `state === "draft"` — once sent, an
   offer's content is frozen and it can only move forward through the state machine (or get stuck,
   per §6a) or via the notification/broadcast side channel, never edited or deleted.
3. **No fabricated pricing.** `internalCostCents` is always computed server-side from real
   `monitoring_packages.platformCostCents` sums (§3.4/§3.6/§3.2); `basePriceCents`/
   `adjustedPriceCents` on offers always derive from `services.basePrice`/`.price` via the Product
   Catalog (§2) — never a hardcoded price table, matching this codebase's standing no-hardcoding
   rule.
4. **A bundle cannot be deleted while a customer is actively assigned to it** (§3.7's 409 guard) —
   revoke every assignment first, no force-delete path exists.

---

## 10. Not covered by this pack

`document-engine-sow.ts` (the AI SOW-pricing pipeline `msp-sow.ts`'s own accept route and
`portal-offers.ts`'s `fulfillAcceptedProjectOffer()` both hand off into) is out of scope here —
already documented by the existing SOW pack (#2641) and referenced only to establish §4/§6a's
cross-surface finding, not opened further. `sales-offer-engine.ts`'s rule-group scoring/eligibility
internals (which signals map to which services, and how `salesOfferRuleGroupsTable`/
`salesOfferConfigTable` rows are authored) are read only to the extent needed to confirm §2's
mechanics — the platform-admin authoring surface for those rule groups (if one exists) is a
separate surface, not opened. `dashboard-resolvers.ts` / the dashboard-tab resolution mechanism
itself (only its `target_key` matching behavior, needed to confirm §6c) is out of scope — the
dashboard Feature's own contract is a separate surface.

---

## 11. Provenance

Written 2026-09-10 against `main` (branch `agent/3357-q2093`), for #3357. Read in full: `msp-sales-
offers.ts` (425 lines, no test file exists), `msp-sales-bundles.ts` (836 lines) + `msp-sales-
bundles.test.ts` (295 lines, all suites), `sales-offer-engine.ts` (534 lines, every export).
Cross-referenced in full or in relevant part: `resolve-msp-id.ts` (all 4 exports), `requireAuth.ts`
(`requireRole`, `requireMspScope`, `assertCustomerAccess`, `isCustomerBlockedByStaffScope`),
`msp-entitlement.ts` (`requirePlanFeature`, `PLAN_FEATURE_DEFS`), `sse-channels.ts` (the
`engine.offer` channel), `sales-offers.ts` (the platform-admin sibling surface, for §4's cross-
reference), `msp-sow.ts` and `portal-offers.ts` (both re-read for §4/§6a's three-accept-paths
finding), `lib/db/migrations/manual/2026-07-19-customer-dashboard-category-tabs.sql` (full read,
for §6c). Verified live against local PostgreSQL — `sales_offers`, `sales_offer_events`,
`msp_sales_bundles`, `msp_sales_bundle_assignments`, `monitoring_packages`, and
`dashboard_templates` schemas and row contents all queried directly; §6c's finding was only
discoverable this way, not from any single file's source alone.

Three real findings filed as sibling sub-issues of #1571 (this issue's own direct EPIC parent — no
more specific Feature-tier parent exists for #3357): **#3386** (§6a, the accept-with-zero-
fulfillment stuck-state bug), **#3387** (§6b, the cross-MSP `?mspId=` override on two files'
session-scoped routes), **#3389** (§6c, the live bundle/migration key-prefix mismatch) — all
milestone v1.1, board status "AI Batter Up." Zero orphaned-endpoint sub-issues filed — every route
in this pack is pre-#1571-wire unconsumed, the expected state. No product code, schema, or UI was
changed by this pass.
