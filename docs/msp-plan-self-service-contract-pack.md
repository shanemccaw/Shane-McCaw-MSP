# MSP Plan Self-Service — contract extraction pack for Claude Design

**#2607**, sub-issue of **#1692** (Feature: Billing, MSP Console — the operator half of
#1598), under **#1571** (EPIC: Portal Admin). Follows the **#1642 pattern**: per-surface
wire contracts extracted verbatim and cited to file:line, CURRENT vs DECIDED marked on
every field, real enum unions only, cross-surface edges, honest tri-state, forbidden list,
orphaned endpoints listed explicitly. Read-only — no product code, schema, or UI changed.

Backend route file: `artifacts/api-server/src/routes/msp-plan-self-service.ts` (455 lines,
all 4 routes real).
Pricing/schedule mechanics: `artifacts/api-server/src/lib/msp-plan-pricing.ts` (Stripe
Price lookup-or-create + the two-phase Subscription Schedule builder).
Schedule-transition finalize/backstop: `artifacts/api-server/src/routes/msp-billing-webhook.ts:765-`
(`subscription_schedule.updated|completed|released|canceled`).
Tenant-allowance / tier gating shared code: `artifacts/api-server/src/lib/msp-entitlement.ts`
(`loadTier`, `checkTenantAllowance`, `requirePlanFeature`).
Schema: `lib/db/src/schema/msp.ts:1473-1524` (`mspSubscriptionsTable`,
`MSP_SUBSCRIPTION_STATUSES`, `MSP_BILLING_INTERVALS`, `MSP_DUNNING_STATES`),
`lib/db/src/schema/index.ts:458-596` (`servicesTable`).

**Real DB state at pack time** (local `DATABASE_URL`, `psql`, 2026-09-03): `msp_subscriptions`
— **1 row**, `msp_id=1626` → `service_id=131`. That row is a synthetic regression-test
fixture (per #2509's bookend: `contact_email='regression-testbed@example.com'`, Stripe ids
`sub_regression_testbed`/`cus_regression_testbed`), **not a real customer's tier
subscription** — and `service_id=131` is `"M365 Launch Control — Plus Add-On"`, not a
platform tier at all (`fulfillment_type='standard'` since #2509's fix). There are 3 real
platform tiers in the catalog — Free (`id=120`), Growth (`121`), Pro (`122`) — but **zero
live subscriptions point at any of them**. See §7 for what this means for this surface's
own two tier-lookup queries.

---

## 0. What this surface is, and what it is not

**One MSP has exactly one row in `msp_subscriptions`** (`mspId` is `.unique()`,
`msp.ts:1485`) — the platform tier *the MSP itself pays for*, keyed by their own `msp_id`.
This is a completely different axis from `tenantsTable`/monitoring-tier billing (what an
MSP charges *their own customers*) — the file header says so explicitly (`msp.ts:272`) and
this pack does not touch that axis at all.

**Self-service, not the pricing tool.** `msp-plan-self-service.ts`'s own header (`:1-16`)
states the boundary: this surface lets an `MSPAdmin` change **their own** tier/interval;
`msp-plan-management.ts` is the separate `PlatformAdmin`-only surface for defining tier
capability rules and migrating a subscriber's Stripe price when a tier's price changes
(§3.2). Confusing the two is the exact failure mode #3.2 documents both surfaces hitting.

**Every write here is a Stripe Subscription Schedule, never an immediate change.**
`msp-plan-pricing.ts`'s own doc comment states the rule the whole surface is built around:
"All changes take effect at the START of the next billing cycle — never mid-cycle, never
prorated." The DB row is not actually flipped by `POST /msp/plan/change` — it only records
*intent* (`stripeScheduleId` + `pendingServiceId`/`pendingBillingInterval`); the flip happens
later, driven entirely by webhook events (§3.1).

**Role gate is `requireRole("MSPAdmin")`, which is a floor, not an exact match.**
`ROLE_ORDER` (`requireAuth.ts:80-88`) is
`Assessment < Free < CustomerUser < ServiceAccount < MSPOperator < MSPAdmin < PlatformAdmin`
and `requireRole(min)` checks `roleIndex(effectiveRole) >= roleIndex(min)` (`:214`) — so
`PlatformAdmin` can call every route on this surface too, `MSPOperator` cannot.

---

## 0.1 The endpoints and their real consumers

| Endpoint | Method | Route file:line | Consumed by (verified) | Orphaned? |
|---|---|---|---|---|
| `/api/msp/plan/current` | GET | `msp-plan-self-service.ts:107-184` | **Nothing found** | **Yes** |
| `/api/msp/plan/available` | GET | `msp-plan-self-service.ts:188-220` | **Nothing found** | **Yes** |
| `/api/msp/plan/change` | POST | `msp-plan-self-service.ts:229-377` | **Nothing found** | **Yes** |
| `/api/msp/plan/cancel-pending-change` | POST | `msp-plan-self-service.ts:381-453` | **Nothing found** | **Yes** |

Confirmed by `grep -rn "msp/plan/"` across every `artifacts/*/src` app: zero hits outside
this route file and its own test file. `artifacts/msp-console` — the app these routes exist
to serve (per #1692/#1598) — does not exist yet (`ls artifacts/`: `admin-panel`,
`api-server`, `mcp-server`, `msp-website`, `portal`, `shane-mccaw-consulting`,
`shane-mccaw-consulting` — no `msp-console`). Same root cause and same shape as the
`msp-sops.ts` MSP-console pack's own §0.1 finding (#2595): the frontend has no home yet, not
a wiring gap in the backend itself.

---

## 1. Wire contract — the four routes, verbatim

### 1.1 Current plan — `GET /api/msp/plan/current` (`:107-184`)

Reads the caller's one `msp_subscriptions` row joined to its tier's `services` row.
Returns `null` (not `404`, not `{}`) when the MSP has no subscription row at all (`:134`) —
see §5's honest-empty contract.

```ts
// Response shape, built at msp-plan-self-service.ts:164-179 — not a named interface,
// reconstructed here field-by-field from the res.json() call site.
interface WireCurrentPlan {
  tier: {
    id: number;                        // services.id
    name: string;                      // services.name
    slug: string | null;               // services.slug
    monthlyPriceCents: number | null;  // derived, see §4
    annualPriceCents: number | null;   // services.annual_price_cents (raw, already cents)
    tenantAllowance: number | null;    // services.type_attributes.tenantAllowance (0/null = unlimited)
  };
  billingInterval: "month" | "year";               // msp_subscriptions.billing_interval
  status: MspSubscriptionStatus;                    // see §2
  dunningState: MspDunningState | null;             // see §2
  currentPeriodEnd: string | null;                  // ISO — msp_subscriptions.current_period_end
  tenantCountSnapshot: number;                      // msp_subscriptions.tenant_count_snapshot
  pendingChange: {
    serviceId: number;
    serviceName: string;
    billingInterval: "month" | "year";
    effectiveAt: string | null;        // ISO — always currentPeriodEnd, not a separately-stored date
  } | null;
}
```

`pendingChange` is built, not stored as a struct (`:138-162`): it is non-null only when
`stripeScheduleId` is set **and** either `pendingServiceId` or `pendingBillingInterval` is
non-null (`:145`). Its `serviceId` defaults to the *current* `serviceId` when only the
interval is pending (`:146`), and a second `SELECT` fires (`:149-154`) to resolve the
pending tier's `name` only when the pending `serviceId` differs from the current one — an
interval-only change never issues that second query. `effectiveAt` inside `pendingChange`
is always identical to the outer `currentPeriodEnd` — there is no independently-tracked
"when did I schedule this" timestamp anywhere on the row.

### 1.2 Available tiers — `GET /api/msp/plan/available` (`:188-220`)

No auth scoping beyond the role gate — same list for every MSP. Filters
`fulfillmentType = "msp_monthly_subscription" AND isPublic = true`, ordered by `price` ASC.
**Against live data this returns `[]` — see §7, a confirmed live bug, not a hypothetical.**

```ts
// Response shape, res.json() call site :207-215
type WireAvailableTiers = Array<{
  id: number;
  name: string;
  slug: string | null;
  description: string | null;
  monthlyPriceCents: number | null;  // §4
  annualPriceCents: number | null;   // raw column, cents
  tenantAllowance: number | null;    // typeAttributes.tenantAllowance
}>;
```

### 1.3 Change plan — `POST /api/msp/plan/change` (`:229-377`)

Request body: `{ targetServiceId: number; targetInterval: "month" | "year" }`
(Zod `changeSchema`, `:224-227` — no other fields accepted).

Order of checks, all real, all short-circuiting with a specific status:

1. `mspId` resolved via `resolveMspIdStrict(req)` — 400 `"No MSP context"` if absent.
2. Body validated — 400, the Zod issue messages joined with `"; "`.
3. Current subscription looked up (must have a `stripeSubscriptionId`) — 404
   `"No platform subscription found for this MSP"` if none.
4. `status` must be `"active"` or `"trialing"` — 409 otherwise, with copy explicitly telling
   the caller to resolve billing issues first.
5. No-op guard: identical `targetServiceId` + `targetInterval` **and** no pending change
   already in flight → 400 `"You are already on this plan and interval"`. Note: if a
   pending change already exists (`hasPendingChange`), re-submitting the *same* target is
   allowed through (re-schedules idempotently) — only the truly-no-change case is blocked.
6. Target tier looked up, same `fulfillmentType = "msp_monthly_subscription"` filter as
   §1.2, **plus** `isPublic OR id === currentServiceId` (`:290`) — a private tier is only
   reachable as a target if it's the tier you're already on. 404 `"Target tier not found"`
   otherwise. **Same live-data bug as §1.2 blocks every real tier from ever matching.**
7. Downgrade guardrail (`downgradeBlockReason`, pure, exported for testing, `:82-103`):
   computed from `countActiveTenants(mspId)` (active `tenantsTable` rows) against the
   target tier's `tenantAllowance`. Hard cap = `targetAllowance × 2` (mirrors
   `checkTenantAllowance`'s own semantics in `msp-entitlement.ts`). An upgrade, a move to
   an unlimited tier (`0`/`null` allowance), or staying under the cap are all allowed; only
   a genuine downgrade past the cap 409s, with the exact tenant count and cap in the
   message.
8. Stripe key must be configured — 503 `"Stripe not configured"` otherwise.
9. `getOrCreatePlanPrice(targetServiceId, targetInterval)` — throws `PlanPricingError` (400)
   if the target tier has no price configured for that interval. **Yearly interval is
   unreachable for every real tier today** — see §7.2.
10. `schedulePlanChangeAtPeriodEnd` (`msp-plan-pricing.ts:187-235`) creates or replaces the
    subscription's Stripe Subscription Schedule (§3.1).
11. DB row updated: `stripeScheduleId`, `pendingServiceId`, `pendingBillingInterval` set
    (never the live `serviceId`/`billingInterval` — those only change at finalize, §3.1).
12. Audit log written (`mspAuditLogsTable`, `actionType: "plan.self_service_change.scheduled"`,
    `entityType: "msp_subscription"`, `entityId: String(mspId)` — a string cast of an
    integer, see §6).

```ts
// Success response, :362-371
interface WireChangeResult {
  ok: true;
  effectiveAt: string;  // ISO — currentPeriodEnd of the (old) subscription at scheduling time
  pendingChange: {
    serviceId: number;
    serviceName: string;         // target.name, resolved in-request, not re-queried
    billingInterval: "month" | "year";
    effectiveAt: string;         // ISO, identical to the outer effectiveAt
  };
}
```

### 1.4 Cancel pending change — `POST /api/msp/plan/cancel-pending-change` (`:381-453`)

No body. 404 `"No pending plan change to cancel"` if `stripeScheduleId` is already null.
Calls `stripe.subscriptionSchedules.release()` — **failure here is swallowed** (`:414-423`,
`try/catch` with a `log.warn`, not a `throw`): the DB's pending columns are cleared
regardless, on the theory that a release failure most likely means "already released
outside the app," so the local state shouldn't be left dangling on Stripe's account. This is
a deliberate best-effort choice, not an oversight — but it means a *different* kind of
Stripe-side failure (permissions, network) would be silently treated the same way, leaving
the DB cleared while Stripe's schedule object may still exist and later re-fire an event
`findSubscriptionBySchedule` (§3.1) can no longer match (the row's `stripeScheduleId` is
already null) — an orphaned Stripe schedule with no DB owner. Not verified as having
happened; flagged in §8.

```ts
// Success response, :448
interface WireCancelResult { ok: true; }
```

---

## 2. Real enum unions

| Vocabulary | Values | DB-enforced? | Status |
|---|---|---|---|
| `MspSubscriptionStatus` | `trialing`, `active`, `past_due`, `canceled`, `unpaid` | Yes — `text({ enum: MSP_SUBSCRIPTION_STATUSES })`, `msp.ts:1473,1503` | CURRENT |
| `MspBillingInterval` | `month`, `year` | Yes — `text({ enum: MSP_BILLING_INTERVALS })`, `msp.ts:1476,1495,1501` | CURRENT |
| `MspDunningState` | `reminder_sent`, `suspended`, `access_revoked`, `archival_flagged` (or `null` = fully operational, `msp.ts:1507` comment) | Yes — `text({ enum: MSP_DUNNING_STATES })`, `msp.ts:1479,1508` | CURRENT — read-only on this surface; this surface never writes `dunningState` |
| `POST /msp/plan/change` body `targetInterval` | `month`, `year` | Zod `z.enum(["month", "year"])`, `:226` — matches the DB enum exactly | CURRENT |
| `services.fulfillmentType` | `standard`, `msp_monthly_subscription` | Yes — `text({ enum })`, `index.ts:514-516` | CURRENT, but see §7 — the real platform tiers do not use this value; `fulfillmentTypeKey` (plain `text`, **not** a DB enum) is the real live discriminator |

There is no separate "plan change reason" or "cancellation reason" enum anywhere on this
surface — a change or cancellation carries no free-text or categorized justification field,
by caller or by system.

---

## 3. Cross-surface edges

### 3.1 The webhook is the only writer of the live `serviceId`/`billingInterval` columns

`msp-billing-webhook.ts:765-` owns finalizing every schedule this surface creates — this
route file itself **never** updates `mspSubscriptionsTable.serviceId` or `.billingInterval`
directly; it only ever sets the `pending*`/`stripeScheduleId` columns. Four Stripe events
drive the state machine, each looked up by `stripeScheduleId` (idempotent — a schedule ID
already cleared from the row means "not ours / already handled", `:833`):

| Event | Handler | Effect |
|---|---|---|
| `subscription_schedule.updated` | `handleScheduleUpdated` (`:896-`) | Finalizes (`applyScheduledPlanChange`, `:831-870`) **only** once `finalPhaseStarted()` (`:799-807`) is true — i.e. Stripe has actually advanced into the target-price phase. Our own scheduling edit fires this event too, while phase 1 is still current, and is correctly ignored. |
| `subscription_schedule.completed` | — | Backstop finalize, same effect as above. |
| `subscription_schedule.released` | — | If pending state remains (our own cancel endpoint already cleared it before this normally arrives), finalizes if the target phase had already started, else clears stale pending state (`clearStalePendingPlanChange`, `:873-894`). |
| `subscription_schedule.canceled` | — | Clears stale pending state unconditionally, logs a warning. |

`applyScheduledPlanChange` also writes an `msp_event_store` row
(`eventType: "msp.subscription.plan_changed"`, `source: "msp-billing-webhook"`,
`actor: { type: "system" }`) — the only durable, queryable record of a plan change actually
having taken effect (as opposed to merely having been scheduled, which only the audit log
in §1.3 step 12 records).

### 3.2 `msp-plan-management.ts` — the PlatformAdmin contrast surface, same live bug

`GET /api/admin/plan-management/tiers` (`msp-plan-management.ts:74`) and
`POST /api/admin/plan-management/tiers/:id/migrate-subscriber`'s target lookup (`:116`) use
**the identical** `eq(servicesTable.fulfillmentType, "msp_monthly_subscription")` filter as
this surface's §1.2/§1.3 — and it is a **real, live-used** page:
`artifacts/admin-panel/src/pages/PlanManagement.tsx:96` calls
`GET /api/admin/plan-management/tiers` directly, mounted at `/msp/plans` in
`admin-panel/src/App.tsx:408-410`. This is not a second orphaned surface — it is the
platform's one existing UI that a `PlatformAdmin` uses today, and it is subject to the exact
same §7 bug: it shows zero tiers against the real catalog.

### 3.3 `msp-signup.ts` already carries the fix this surface is missing

`msp-signup.ts:42-87` documents (comment block, `:28-52`) precisely the failure this surface
has: "a genuine platform tier's `fulfillmentType`/`fulfillmentTypeKey` lifecycle value is
`msp_monthly_subscription` — but that value alone isn't sufficient." Its real WHERE clause
(`:84-86`) is `eq(fulfillmentType, "msp_monthly_subscription") OR eq(fulfillmentTypeKey,
"msp_monthly_subscription")` — the OR-arm this surface (§1.2, §1.3) and `msp-plan-
management.ts` (§3.2) both lack. This OR-arm was hardened further under #2509 (an add-on row
that had `fulfillmentType` incorrectly set to `msp_monthly_subscription` was leaking into
signup) with an additional `isGenuinePlatformTier()` exclusion filter
(`typeAttributes.addOnType`/`grantsCapabilityKey`) — that hardening also only touched
`msp-signup.ts`, not this surface or `msp-plan-management.ts`.

### 3.4 `msp-entitlement.ts` shares the join shape, not the code

`loadTier()` (`msp-entitlement.ts:39-61`) does the same `mspSubscriptionsTable` ⨝
`servicesTable` join this surface's `GET /msp/plan/current` does (§1.1), and
`checkTenantAllowance()`'s hard-cap formula (`allowance × 2`, `:193`) is exactly what
`downgradeBlockReason` (§1.3 step 7) mirrors — the comment at `msp-plan-self-service.ts:79`
says so directly. `loadTier` has **no** `fulfillmentType` filter at all — it joins on
`mspId` alone, so it is unaffected by the §7 bug (it would resolve the tier correctly no
matter what `fulfillmentType`/`fulfillmentTypeKey` says, since it never checks either
column). This is why the existing tier-gating machinery (`requirePlanFeature`, dunning,
overage) still works correctly today even though tier *shopping* (this surface) does not.

---

## 4. Money contract

`servicesTable.price` is a **legacy `numeric(10,2)` in DOLLARS** (monthly); `annual
PriceCents` is **integer CENTS** — the same units mismatch `msp-plan-pricing.ts`'s own
header comment calls out explicitly. Every value this surface actually returns to the wire
is normalized to integer cents via `monthlyPriceCentsOf()` (`msp-plan-pricing.ts:36-40`,
re-exported through `msp-plan-self-service.ts`'s import) — `Math.round(parseFloat(price) *
100)`, and only when the parsed result is finite and `> 0` (a `0`/negative/unparseable price
becomes `null`, not `0`). `annualPriceCents` is passed through raw with no conversion — it is
already cents at rest. There is no currency field or multi-currency handling anywhere on
this surface; `msp-plan-pricing.ts`'s Stripe Price creation hardcodes `currency: "usd"`
(`:120`).

`resolveUnitAmountCents()` (`msp-plan-pricing.ts:44-58`) is the one place a `year`-interval
price is required to exist (`service.annualPriceCents == null` → `PlanPricingError`,
surfaced as this route's 400) — see §7.2 for why that throws for every real tier today.

---

## 5. Honest-empty / tri-state contract

- **No subscription row at all**: `GET /msp/plan/current` returns the JSON literal `null`
  (`:134`, `res.json(null)`) — HTTP 200, not 404, not `{}`. A caller must check
  `response === null`, not just falsiness of a field inside it.
- **No pending change**: `pendingChange` is the JSON literal `null` inside a 200 response —
  never an empty object, never an omitted key.
- **`dunningState`**: `null` means "fully operational" per the schema comment (`msp.ts:1507`)
  — it is not one of the four enum strings plus a separate boolean; `null` *is* the
  "everything's fine" state.
- **`tenantAllowance`**: `0` and `null` are both "unlimited," collapsed to the same meaning
  by `tenantAllowanceOf()` (`:71-74`) and `downgradeBlockReason` (`:87-88`) — the wire never
  distinguishes *why* a tier is unlimited (explicit `0` vs. the attribute being absent).
- **`GET /msp/plan/available` empty array**: on live data today this is **always** `[]`
  (§7) — a genuinely empty catalog and "the fulfillmentType filter matched nothing" are
  indistinguishable on the wire; there is no separate signal for "the catalog has tiers but
  none matched this query's filter."

---

## 6. The forbidden list — declared, not merely absent

1. **No route on this surface ever sets the live `serviceId`/`billingInterval` columns
   directly.** Only the webhook (§3.1) does, and only once Stripe confirms the schedule's
   target phase is actually current — this surface can only ever *propose* a change via
   `pending*` + a schedule.
2. **No proration, ever.** `msp-plan-pricing.ts`'s `buildSchedulePhases` hardcodes
   `proration_behavior: "none"` on both phases (`:169,177`) — there is no code path on this
   surface that produces a prorated invoice.
3. **A private tier is never a reachable target unless it's the caller's current tier**
   (§1.3 step 6, `:290`) — `isPublic` is enforced at the change endpoint even though
   `GET /msp/plan/available` (§1.2) already filters to public tiers only, so the two routes
   agree, not just by coincidence of both filtering the same way.
4. **`entityId` on the audit log is always `String(mspId)`, never the subscription row's own
   `id`** (`writeAuditLog`, `:50-69`, called with `entityId: String(mspId)` at both call
   sites `:345` and `:441`) — a lookup by subscription row id would find nothing.
5. **This surface never reads or writes `msp_event_store`.** Only the webhook does
   (§3.1) — the audit log (`mspAuditLogsTable`) is this surface's own durable record of
   *intent*; `msp_event_store`'s `msp.subscription.plan_changed` is the webhook's own record
   of the change actually *landing*. Two different tables, two different moments, by design.
6. **A schedule-release failure never blocks clearing local pending state** (§1.4) —
   deliberate best-effort, not a bug, but flagged in §8 for the orphan-schedule edge case.

---

## 7. Confirmed live bug — filed as a finding, not fixed here (read-only pack)

**`GET /api/msp/plan/available` returns `[]` and `POST /api/msp/plan/change`'s target lookup
404s for every real platform tier, against live data, today.** Verified directly:

```
psql> SELECT id, name, fulfillment_type, fulfillment_type_key, is_public FROM services WHERE id IN (120,121,122);
 id  |  name  | fulfillment_type |   fulfillment_type_key   | is_public
-----+--------+------------------+---------------------------+-----------
 120 | Free   | manual           | msp_monthly_subscription | t
 122 | Pro    | manual           | msp_monthly_subscription | t
 121 | Growth | manual           | msp_monthly_subscription | t
```

The three real tiers were migrated to use `fulfillmentTypeKey` as the actual discriminator
(the #2509 precedent, §3.3) — their legacy `fulfillmentType` column is `"manual"`, not
`"msp_monthly_subscription"`. This surface's §1.2/§1.3 queries, and `msp-plan-management.ts`'s
identical queries (§3.2, which **is** live-used by `admin-panel`'s Plan Management page),
check only the legacy column. `msp-signup.ts` already carries the OR-arm fix (§3.3); this
surface and `msp-plan-management.ts` do not. This is a genuine, confirmed defect — filed as
**#2701**, sibling sub-issue of #1692, labeled `bug`.

### 7.2 Yearly interval is unreachable for every real tier today (not filed — self-documenting)

`annual_price_cents` is `NULL` on all three real tiers (`120`/`121`/`122`), confirmed by the
same query. `resolveUnitAmountCents()` (§4) throws `PlanPricingError` — surfaced as this
route's own clear 400 ("Tier ... has no annual price configured. Set it in Plan Management
first.") — for any `targetInterval: "year"` request against a real tier. This is not filed
as a separate defect: the code already handles the missing configuration honestly (a clear
400, not a crash or a silent wrong price), and the fix is an admin data-entry action (set
`annualPriceCents` via Plan Management), not a code change. Recorded here so Design knows a
yearly-billing toggle in a future MSP-console UI would 400 for every tier until that admin
step happens — not evidence the toggle itself is broken.

---

## 8. Open gaps — NOT decided (do not resolve; flag)

1. **An orphaned Stripe schedule is possible** if `stripe.subscriptionSchedules.release()`
   fails for a reason other than "already released" (§1.4) — the DB is cleared regardless,
   so a later webhook event for that schedule ID would find no owning row and silently
   no-op (`findSubscriptionBySchedule` returns `null`, both handlers early-return). Not
   verified as having happened in practice; flagged for whoever hardens this surface next.
2. **No UI exists yet for any of these four routes** (§0.1) — the expected pre-Design state
   for an MSP-console-scoped surface (#1680, the scaffolding issue, is still open per the
   #2595 SOPs pack's own finding) — not a defect, but Design should know nothing is wired
   to these routes today.
3. **The catalog-filter bug (§7) means this pack's own request/response examples (§1.1-1.3)
   are drawn from route code, not from a live successful `POST /msp/plan/change` call** —
   no such call can succeed against the current live tier catalog. The shapes are accurate
   to the code; they are not independently confirmed against a real 200 response for
   `/change` specifically (the `/current` and `/available` shapes ARE confirmed against live
   data — `/current` returns the real single row, `/available` returns the real, confirmed
   `[]`).

---

## 9. Provenance

Extracted 2026-09-03 against branch `agent/2607-q1409`, a new pack — no prior version of
this surface's contract existed (`docs/billing-contract-pack.md` is the customer-portal
`portal-billing.ts` surface, a different route file entirely; not superseded or replaced by
this one). Full read of `msp-plan-self-service.ts` (455 lines, all 4 routes),
`msp-plan-pricing.ts` (238 lines), `msp-plan-management.ts` (contrast surface, filter
clauses), `msp-billing-webhook.ts:765-` (schedule-transition finalize/backstop),
`msp-entitlement.ts` (`loadTier`, `checkTenantAllowance`, `requirePlanFeature`),
`msp-signup.ts` (`isGenuinePlatformTier`, the OR-arm precedent), and the Drizzle schema
(`lib/db/src/schema/msp.ts:1473-1524`, `index.ts:458-596`). Live DB state confirmed via
direct `psql` against local `DATABASE_URL`: 1 `msp_subscriptions` row (msp 1626, pointed at
a non-tier add-on per #2509), 3 real platform tiers (120/121/122), all three
`fulfillment_type='manual'` / `fulfillment_type_key='msp_monthly_subscription'`, all three
`annual_price_cents IS NULL`. Consumer sweep: `grep -rn "msp/plan/"` across
`artifacts/*/src` found zero callers of this surface's own four routes, and one real,
live-used caller of the sibling PlatformAdmin surface's identically-filtered query
(`admin-panel/src/pages/PlanManagement.tsx`) — confirming §7's bug is not merely latent.
Architecture cited to #1598, #2509. One new sub-issue filed for §7 (the confirmed
fulfillmentType/fulfillmentTypeKey mismatch, #2701, sibling sub-issue of #1692); §7.2 and
§8 are documented gaps, not filed —
neither meets this project's finding bar (self-documenting via existing error handling, or
unverified as a live occurrence). Read-only pass: no product code, schema, or UI was
changed.
