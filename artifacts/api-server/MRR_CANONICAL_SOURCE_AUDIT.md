# MRR Canonical Source Audit

Read-only audit. No computation logic was modified. All line numbers verified against the working tree as of this audit.

## Summary of what actually exists

The request named three sources, but the codebase actually contains **five** distinct "MRR"/recurring-revenue computations, plus one dead-looking field. They diverge in scope, timeframe, and even in which entity's revenue they're describing (MSP-facing vs. platform-facing).

| # | Source | Scope | Consumer |
|---|--------|-------|----------|
| 1 | `aggregateMspTelemetry()` → `monitoringMrr` | Per-MSP subscription revenue | MSP Portal dashboard |
| 2 | `msp-portal.ts:203-216` raw event-store sum | Per-MSP payment events, this month | MSP Portal dashboard (fetched, **not rendered**) |
| 3a | `admin-overview.ts` `/admin/overview` (lines 288-301) | Platform-wide client-services MRR | Admin Panel Overview page |
| 3b | `admin-overview.ts` `/admin/insights` (lines 589-591) | Platform-wide client-services MRR (recomputed) | Fed into an AI prompt string only, not returned as JSON |
| 4 | `admin-finance.ts` `/admin/finance/summary` (lines 142-146) | Platform-wide retainer-invoice MRR | **No frontend consumer found** — orphaned |
| 5 | `/api/admin/analytics/kpis` (`analytics.ts:292`) | Expected: platform KPIs incl. `mrr`/`arr` | Mobile app home screen — **route returns visitor analytics instead; mrr/arr always undefined** |

---

## 1. `aggregateMspTelemetry()` — `artifacts/api-server/src/lib/msp-financial-aggregator.ts:55-249`

**Tables/columns summed** (Category A, "monitoringMrr", lines 61-85):
- `mspSubscriptionsTable` inner-joined to `servicesTable` on `serviceId`
- Filters: `mspSubscriptionsTable.mspId = mspId` AND `status IN ("active", "trialing", "past_due")`
- Sums `servicesTable.priceCents` (retail) and `servicesTable.internalCostCents` (wholesale) per row, run through `resolveCatalogPricing()` (`catalog-pricing.ts:78-91`), which defaults wholesale to 70% of retail when `internalCostCents` is null.

**Includes:**
- Trialing subscriptions (non-paying) — counted at full price as if already paying.
- Past-due subscriptions — still counted as if being paid.

**Excludes:**
- `canceled` and `unpaid` subscriptions (schema: `MSP_SUBSCRIPTION_STATUSES = ["trialing","active","past_due","canceled","unpaid"]`, `lib/db/src/schema/msp.ts:999`).
- No proration logic — this is a point-in-time snapshot of "would-be" full-month revenue for currently-attached subscriptions, not billed amounts.
- No refunds/failed-charge handling — there's no Stripe-charge-status join at all; it's purely subscription-status-driven, not payment-driven.
- No one-time revenue mixed in — `monitoringMrr` is isolated; one-time revenue lives in the separate `projectRevenue`/`remediationRevenue`/`offerRevenue` categories in the same payload (summed independently, not part of "MRR").

**Timeframe logic:** None, for this category specifically. The function accepts an optional `startDate` parameter, but `startDate` is only applied to `projectRevenue` (line 98), `remediationRevenue` (line 129), `offerRevenue` (line 155), and `activeSignalsCount` (line 193). **`monitoringMrr` ignores `startDate` entirely** — it always reflects "sum of currently active/trialing/past_due subscription prices," irrespective of the month being viewed. This means calling it with `monthStart` (as `msp-portal.ts:332` does) does not scope monitoringMrr to that month at all; it's always "right now."

**Consumer:** Only caller is `GET /api/msp/dashboard` (`msp-portal.ts:125`, calls aggregator at line 332). Frontend: `artifacts/msp-portal/src/pages/dashboard.tsx` reads `telemetry.financials.monitoringMrr.grossRevenueUsd` (lines 199, 363) and `telemetry.financials.total` (lines 198, 327, 335) to render the MSP-facing dashboard's revenue/margin cards.

---

## 2. Raw event-store sum — `artifacts/api-server/src/routes/msp-portal.ts:203-216`

```sql
SELECT COALESCE(SUM((payload->>'amountCents')::bigint), 0) AS total_cents
FROM msp_event_store
WHERE msp_id = ${mspId} AND event_type = 'payment.completed' AND occurred_at >= ${monthStart}
```

**Table/columns summed:** `mspEventStoreTable.payload->>'amountCents'` where `eventType = 'payment.completed'`, `mspId` matches, `occurredAt >= monthStart`.

**Includes:** Only events explicitly emitted with `event_type = 'payment.completed'`. This is presumably fired by a Stripe webhook handler (not reviewed in this audit — out of scope of the three named files, but worth checking if it fires for one-time charges, subscription renewals, or both).

**Excludes:** Trial MSPs by construction (no payment event exists until a real charge succeeds). No explicit refund/failed-charge subtraction — depends entirely on whether the emitting webhook code also emits a negative/offsetting event for refunds (not verified here). No proration visibility — whatever cents figure the webhook payload carries is taken as-is.

**Timeframe logic:** Calendar-month-aligned via `startOfMonth()` (`msp-portal.ts:49-54`), UTC date-truncated to the 1st. This is the only one of the three named sources using a real calendar-month boundary tied to a floor, not a rolling window.

**Consumer:** Computed into `revenueCentsThisMonth` / `revenueUsdThisMonth` (`msp-portal.ts:307, 355-356`) and included in the `/api/msp/dashboard` JSON response. **Frontend note:** `dashboard.tsx` declares these two fields in its `DashboardData` interface (lines 88-89) but I found no place in the component that actually renders `revenueCentsThisMonth` or `revenueUsdThisMonth` — the visible revenue tiles all read `telemetry.financials.*` instead. This field appears to be fetched but currently dead in the UI.

---

## 3a/3b. Admin-overview.ts platform-wide sums

**3a — `/admin/overview` handler, `admin-overview.ts:288-301`:**
- Table: `clientServicesTable` inner-joined to `servicesTable`.
- Filter: `clientServicesTable.status === "active"` AND `servicesTable.billingType === "recurring_monthly"`.
- Sums `servicesTable.basePrice ?? servicesTable.price` (dollars, `numeric(10,2)`, parsed via `parseFloat`).
- Also computes `mrrThreeMonthsAgo` (lines 294-301): same filter, plus `clientServicesTable.purchasedAt <= threeMonthsAgo` — a retrospective "what MRR looked like 3 months ago" using **current** status, not historical status (i.e., if a service was active 3 months ago but has since been canceled, it's excluded from both `mrr` and `mrrThreeMonthsAgo` because the filter checks *current* `status === "active"` only — this is a look-back on purchase date, not a true historical snapshot).

**Includes:** Only recurring_monthly billing type. No trial concept exists in this schema path (there's no `trialing` state for `clientServicesTable` — its statuses are `["active","completed","paused"]`).

**Excludes:** `paused`/`completed` client-services. No refunds/proration — raw `basePrice`/`price` field, no linkage to actual invoice/payment status at all. This is catalog list-price, not billed amount.

**Timeframe logic:** None (a live snapshot of "currently active recurring services' prices"), except for the `mrrThreeMonthsAgo` comparison point described above.

**Consumer:** `artifacts/admin-panel/src/pages/Overview.tsx` — fetches `/api/admin/overview` (line 1006), renders `data.mrr`/`data.arr` as KPI tiles (lines 1576-1577) and `mrrTrend.current`/`.threeMonthsAgo` (lines 1203-1204).

**3b — `/admin/insights` handler, `admin-overview.ts:589-591`:**
- Identical filter logic to 3a (`clientServicesTable.status === "active"` AND `billingType === "recurring_monthly"`), recomputed independently from a separately-fetched `allClientServices` array rather than reusing 3a's result (these are two different route handlers, not shared state, so this isn't a caching bug — just duplicated logic).
- **Not returned as a JSON field.** Only used to build a natural-language string fed to Claude (`fmtN(mrr)` interpolated into the AI prompt at line 678) for generating insight-card narratives. The AI's *prose* about MRR reaches the frontend; the raw number does not.

**Consumer:** `Overview.tsx` also calls `/admin/insights` but only consumes the returned insight-card text/narrative fields, never a raw `mrr` number from that endpoint.

---

## 4. `admin-finance.ts` `/admin/finance/summary` — lines 136-179

**Table/columns summed:** `invoicesTable`, filtered to `invoiceType === "retainer"` AND (`status === "due"` OR `status === "paid"`) (lines 142-144). Sums `invoicesTable.amount` (dollars).

**Includes:** Both due (unpaid, invoiced) and paid retainer invoices in the same MRR bucket — i.e., this counts money not yet collected as if it were recurring revenue, which is a materially different inclusion rule than sources 1/3a/3b (which are keyed off subscription/service *status*, not invoice *payment* status).

**Excludes:** `overdue` and `draft` invoices. Non-retainer (`instant`) invoice types entirely, regardless of recurrence. No proration/refund handling — raw `amount` field.

**Timeframe logic:** None — a live snapshot of all retainer invoices currently in `due`/`paid` state, with no date bound at all (this could include a retainer invoice from years ago still sitting in `due` status, which would be double-counted every time this endpoint is hit — actually worse than a timeframe bug, it's an omitted timeframe filter).

**Consumer:** **None found.** Searched `artifacts/admin-panel` (including `FinanceWorkspace.tsx`) and `artifacts/shane-mobile` for any call to `/admin/finance/summary`, `finance/summary`, or similar — no matches. This endpoint's `mrr`/`arr` fields appear to be computed and shipped over the wire to nobody. `GET /admin/invoices/:id` and the AI invoice-summary endpoint in the same file *are* consumed elsewhere, but the `/summary` route's MRR figure specifically looks orphaned.

---

## Bonus finding: a fifth, broken source (not in the original three, but directly relevant)

`artifacts/shane-mobile/app/(tabs)/index.tsx` (lines 27-31, 92-95, 140-143) fetches `/api/admin/analytics/kpis` expecting a `KPIs` shape with `revenueMtd`, `revenueYtd`, `mrr`, `arr`, `activeClients`, `openLeads`, and renders "MRR"/"ARR" tiles from it (lines 142-143).

The actual route registered at that path — `artifacts/api-server/src/routes/analytics.ts:292-322` — is a **visitor-analytics** endpoint (session counts, pageviews, avg time on page, bounce rate). It returns `{ visitors, pageviews, avgTimeOnPage, bounceRate }` and nothing resembling `mrr`/`arr`/`revenueMtd`. There is only one route registered at `/admin/analytics/kpis` (confirmed via search — no collision/override elsewhere).

**This means the mobile app's MRR/ARR home-screen tiles are permanently rendering "—" (undefined)** — not a divergence-in-value bug like the other four, but a complete absence of a working backend for that specific consumer. This wasn't one of the three named computations, but it consumes the *concept* of "platform MRR" and currently gets nothing, so it belongs in the reconciliation conversation.

---

## Would the numbers actually diverge in practice, or coincidentally agree?

They would **not** agree, even under clean data, for structural reasons — not edge cases:

- **1 vs. 3a/3b/4 are answering different questions entirely.** #1 is *per-MSP* wholesale/retail monitoring revenue keyed off `mspSubscriptionsTable`. #3a/3b/4 are *platform-wide* and keyed off completely different tables (`clientServicesTable`, `invoicesTable`) that represent Shane's direct client relationships, not the MSP-tenant subscription layer. These aren't measuring overlapping populations — #1 could be nonzero while #3/#4 are computed from unrelated rows. They're not really "three views of the same MRR"; they're MRR for two different sides of the business (platform-tenant SaaS fees vs. Shane's own consulting client base), which happens to make "reconcile them into one canonical number" a more fundamental question than a bug fix.
- **3a vs. 3b** use identical filter logic today (both: active + recurring_monthly, summed from basePrice/price) so they'd agree with each other *right now* purely because they're copy-pasted, not because they're the same computation path — any future edit to one and not the other silently reintroduces drift. This is real duplication risk, not a coincidence of data.
- **4 vs. 3a** diverge unconditionally: #4 counts unpaid (`due`) retainer invoice amounts as MRR; #3a only counts services with active status regardless of any invoice ever being generated. A retainer client who's active but hasn't been invoiced yet this cycle contributes to #3a but not #4; an overdue-but-still-"due" retainer invoice for a client whose service was since paused contributes to #4 but not #3a.
- **1's `monitoringMrr` ignoring `startDate`** means it never actually varies by the month parameter passed to it — this isn't a divergence between sources so much as a latent bug: the "this month" framing implied by passing `monthStart` is misleading, since monitoringMrr is always "right now," full stop.

---

## Which is closest to correct in scope/logic?

None is a clean canonical candidate as-is:

- **#1 (`monitoringMrr`)** has the most defensible *per-tenant* logic (status-based, wholesale/retail split is genuinely useful for margin reporting) but the `startDate` no-op is a latent bug that should be fixed or documented regardless of any canonicalization decision, and it only ever answers "MSP-tenant subscription MRR," not "Shane's own business MRR."
- **#3a (`/admin/overview` mrr)** is closest to a *platform-wide, business-facing* MRR (Shane's own recurring client revenue) but ignores actual payment/invoice reality — a service marked "active" contributes to MRR even if the client has never actually paid for it or is delinquent. It should probably be truth-checked against invoice status, which is exactly what #4 attempts (badly — no timeframe, wrong status set) and #3a doesn't attempt at all.
- **#4 (`/admin/finance/summary` mrr)** has the right *instinct* (tie MRR to actual invoicing) but the wrong status set (`due` OR `paid` conflates billed-but-uncollected with collected) and no timeframe bound at all, and currently has no consumer to even notice it's wrong.

**A new reconciled function looks more appropriate than picking one of the four as-is** — specifically for the platform-wide (#3a/3b/4) side, which all purport to measure the same thing (Shane's own recurring revenue) yet disagree on status filters, timeframe, and payment-reality. The per-MSP side (#1) is a separate concern (tenant subscription monitoring, not Shane's business MRR) and probably shouldn't be merged into the same "canonical MRR" function at all — conflating "MRR the platform charges MSP tenants" with "MRR Shane's consultancy earns" would itself be a scope error, not a fix.

---

## What depends on each non-canonical source (deprecation blast radius)

| Source | Depends on it | Breaks if removed/changed |
|---|---|---|
| #1 `monitoringMrr` | MSP Portal dashboard (`dashboard.tsx:199,363`) | MSP-facing revenue card goes blank/wrong for every MSP tenant |
| #2 raw event-store sum | Fetched by `dashboard.tsx` type but not rendered anywhere found | Likely safe to change/remove without visible UI impact — verify with a text search before deleting, this audit didn't exhaustively check for dynamic/computed field access |
| #3a `/admin/overview` mrr/arr/mrrTrend | Admin Panel `Overview.tsx` (KPI tiles + trend chart, lines 434-435, 1203-1204, 1576-1577) | Admin's main dashboard MRR/ARR tiles and trend chart break |
| #3b `/admin/insights` mrr | Only the AI insight-narrative prompt | AI-generated insight text would lose one input number; no structured-data break |
| #4 `/admin/finance/summary` mrr/arr | No consumer found | Zero UI blast radius — safe to change or fold into a reconciled function first, as a low-risk place to prototype |
| #5 `/admin/analytics/kpis` (expected mrr/arr) | Mobile app home screen tiles | Already broken (undefined) — fixing this requires either wiring the mobile app to a real MRR source or adding mrr/arr to this route; no regression risk since nothing currently works |

---

## Proposed path (for Shane's decision — not implemented)

1. Treat "MSP-tenant subscription MRR" (#1) and "Shane's consultancy MRR" (#3a/3b/4/#5) as two genuinely separate metrics, not one canonical number — merging them would misrepresent the business.
2. For the consultancy-MRR side, a reconciled function should pick one clear inclusion rule (recommend: active recurring_monthly services AND has at least one paid-or-due invoice in the current cycle, to combine #3a's status-based intent with #4's payment-reality intent) and one clear timeframe (calendar-month, matching #2's approach, the only source using a real month boundary).
3. Fix the #1 `startDate` no-op on `monitoringMrr` independently of any canonicalization work — it's a bug regardless of what else happens.
4. Decide whether #2 (`revenueCentsThisMonth`) is truly dead in the MSP Portal UI (confirm with a broader search before deleting) or whether it was meant to replace `monitoringMrr` and never got wired to the UI.
5. Wire #5 (mobile `/api/admin/analytics/kpis`) to whatever the reconciled consultancy-MRR source becomes, since it's currently pointed at a route that can't answer its question.
6. #4 has no consumer, so it's the lowest-risk place to either delete or rebuild as the new canonical function without touching any live UI.
