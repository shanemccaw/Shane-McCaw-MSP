# MRR Metric Separation Audit

Read-only audit. No computation logic modified. Builds on [MRR_CANONICAL_SOURCE_AUDIT.md](MRR_CANONICAL_SOURCE_AUDIT.md) (commit `8b5109a4`). All findings below re-verified directly against the current working tree, not assumed from the prior audit.

## Addendum — startDate bug fixed after this audit was written

A concurrent session landed `Fix Monitoring MRR Date Scoping` (commit `b8598440`) while this audit was in progress, scoping `monitoringMrr` with `gte(mspSubscriptionsTable.createdAt, startDate)` (`msp-financial-aggregator.ts:76`). This resolves the bug described below in "Session-state correction" and referenced in §2/§3/§5 — those sections are left as originally written (accurate at time of investigation) but the `startDate` no-op they describe as open is now fixed. §5's "MSP-own MRR → thin wrapper" recommendation is unaffected and, if anything, now simpler to act on immediately since the prerequisite fix is already done.

## Session-state correction (important, as of when this audit was written)

PLATFORM_BUILD.md shows a task **"Fix Monitoring MRR Date Scoping" is still `⏳ IN FLIGHT`** (commit `90ccdd62`, no `✅ DONE` row exists). This audit's assignment assumed that fix had "landed" — it has not:

```
git log --oneline 90ccdd62..HEAD -- artifacts/api-server/src/lib/msp-financial-aggregator.ts
→ (no output — zero commits have touched this file since the IN FLIGHT marker)
```

Verified directly in source (`msp-financial-aggregator.ts:58-77`): `aggregateMspTelemetry(mspId, startDate?)` still computes `monitoringMrr` from a plain `mspSubscriptionsTable` join with **no reference to `startDate` anywhere in the Category A block**. The bug documented in the prior audit ("`monitoringMrr` ignores its `startDate` parameter") is unfixed today. Everything below is assessed against that unfixed reality.

---

## 1. Does anything today correctly compute the "overlord" platform-wide total?

**No.** Verified structurally, not just by inspection of query filters — the two candidates named in the task brief (`admin-overview.ts`, `admin-finance.ts`) are **architecturally incapable** of producing a platform-wide-across-all-MSPs number, because the tables they read from have no MSP dimension at all:

- `clientServicesTable` (`lib/db/src/schema/index.ts:279-299`) — the table `admin-overview.ts`'s `mrr`/`mrrThreeMonthsAgo` (lines 289-301, 589-591) sum — has no `mspId` column. It's keyed by `clientUserId → usersTable.id`. The schema comment above it (line 273-274) states outright: *"direct-customer channel independent of the MSP schema module."*
- `invoicesTable` (`lib/db/src/schema/index.ts:387-410`) — the table `admin-finance.ts`'s `/admin/finance/summary` `mrr` (lines 142-146) sums — is likewise keyed by `clientUserId → usersTable.id`, no `mspId` column.
- Grepped the full `api-server/src` tree for any `mspId`-grouped/aggregated sum touching `mspSubscriptionsTable` (the only table that *does* carry `monitoringMrr`-style per-MSP subscription revenue) — the only call site of `aggregateMspTelemetry()` is `msp-portal.ts:332`, invoked once per request with a single `mspId` from the authenticated session. There is no admin-side loop that calls it once per MSP and sums the results, and no raw SQL anywhere doing `GROUP BY msp_id` / `SUM(...) ... FROM msp_subscriptions` across the whole table.

So: `admin-overview.ts` and `admin-finance.ts` aren't a *wrong-but-close* overlord total — they're measuring **Shane's own direct consultancy revenue** (his `client_services`/`invoices` book), a population that structurally excludes every MSP tenant's subscription revenue. A true "MRR across ALL MSPs + ALL customers combined" query does not exist anywhere in the codebase today. This must be built new.

## 2. Does anything today correctly compute a single MSP's own MRR?

**Yes, with one live bug** — `aggregateMspTelemetry()` → `monitoringMrr` (`msp-financial-aggregator.ts:58-88`) is the only source keyed to a single MSP's own subscription/monitoring revenue (`mspSubscriptionsTable.mspId = mspId`, status `active`/`trialing`/`past_due`, retail/wholesale split via `resolveCatalogPricing()`). This is the right candidate and the right table.

**But it is not date-scoped**, contrary to what the task brief assumed. Per §"Session-state correction" above, this remains unfixed. Any "MSP-own MRR" wrapper built on top of it today inherits that bug: passing a `startDate`/`monthStart` param has zero effect on the returned `monitoringMrr` figure — it silently always reflects "right now," regardless of what period the caller asked for.

## 3. Remaining gaps if used as-is

**MSP-own MRR candidate (`monitoringMrr`):**
- The `startDate` no-op (above) — a genuine correctness bug carried over from the prior audit, still open.
- No proration, no refund/failed-charge handling, no linkage to actual Stripe payment status — it's a point-in-time "sum of currently active/trialing/past_due subscription list prices," not billed/collected revenue. `trialing` and `past_due` subscriptions are counted at full price as if paying. This may be an intentional product choice (forward-looking MRR rather than collected-cash MRR) but should be an explicit, documented decision if it's going to back a "MSP-own MRR" headline number, since it will read differently for MSPs with trial-heavy or delinquency-heavy books.

**Overlord total (no existing candidate):** not applicable — there's nothing to assess gaps in; it needs to be built from scratch. Any new overlord query should decide up front whether it wants the same "current subscription status" semantics `monitoringMrr` uses (consistent with the per-MSP number, easy to reconcile: overlord total should equal `Σ(monitoringMrr)` across all MSPs) or a stricter payment-verified definition — mixing philosophies between the per-MSP and platform-wide metrics would make them permanently unreconcilable, which defeats the point of having both.

## 4. Is Shane's consultancy MRR in scope for the overlord total, or a separate third metric?

**Correctly out of scope, and it's a separate third metric — not a subtraction adjustment.** This was correctly identified in the prior audit (§"Would the numbers actually diverge," point 1) and remains true on re-verification: `clientServicesTable`/`invoicesTable` (sources #3a/3b/4) are Shane's own direct client relationships, structurally disjoint from `mspSubscriptionsTable` (no shared foreign key, no overlapping row population — verified in §1 above). There's no "exclude Shane's consultancy rows from the overlord sum" step needed, because Shane's consultancy revenue was never going to be *in* a `mspSubscriptionsTable`-based overlord query in the first place — it lives in entirely different tables that an MSP-subscription-based overlord query would never touch.

Net: three metrics, not two-plus-an-exclusion-rule:
1. **Overlord total** — new query, `Σ monitoringMrr`-equivalent across all MSPs (`mspSubscriptionsTable`, no `mspId` filter, grouped or summed platform-wide).
2. **MSP-own MRR** — `aggregateMspTelemetry()`'s `monitoringMrr`, scoped to one `mspId` (once the `startDate` bug is fixed).
3. **Shane's consultancy MRR** — `#3a`/`#4`-derived, `clientServicesTable`/`invoicesTable`, no MSP dimension at all. Out of scope for this game/dashboard work, as the prior audit concluded — confirmed still correct.

## 5. Recommendation: thin wrappers vs. new queries

**Split recommendation — different answer for each metric:**

- **MSP-own MRR → thin wrapper.** `aggregateMspTelemetry()` already has the correct table, join, status filter, and pricing split. Do not reimplement it. Fix the `startDate` no-op on `monitoringMrr` first (small, isolated change — apply the same `gte(mspSubscriptionsTable.createdAt-or-equivalent, startDate)` pattern already used for `projectRevenue`/`remediationRevenue`/`offerRevenue` in the same function, or explicitly scope by subscription-active-during-period if there's no creation-date column suited to it — needs a look at `mspSubscriptionsTable`'s date columns before writing the fix, out of scope for this read-only audit). Then either expose `monitoringMrr` directly to the MSP's own dashboard (already happening) or add a one-line PlatformAdmin-impersonation-aware wrapper if the "Shane's own MSP #1 view" needs a different auth path than the existing `/api/msp/dashboard` route provides.

- **Overlord total → new query, not a wrapper.** There's nothing to wrap — no existing function loops across all MSPs. Build a new function (suggest colocating in `msp-financial-aggregator.ts` alongside `aggregateMspTelemetry`, e.g. `aggregatePlatformMonitoringMrr()`) that runs the same `mspSubscriptionsTable` ⋈ `servicesTable` join and `resolveCatalogPricing()` split as Category A of `aggregateMspTelemetry`, but without the `mspId` filter — summed (or optionally grouped by `mspId` if the admin panel wants a per-MSP breakdown table, not just one headline number). Reusing the exact same filter/pricing logic as the per-MSP function (rather than re-deriving it) is what will keep "overlord total" and "sum of every individual MSP's own MRR" reconcilable to the same number — that consistency guarantee is the main design goal here, more than DRY-for-its-own-sake.
  - Do **not** build the overlord total from `admin-overview.ts`/`admin-finance.ts` — confirmed in §1 those measure a structurally different, disjoint revenue population.
  - Gate the new endpoint PlatformAdmin-only per the task brief — it doesn't exist yet, so there's no existing auth check to audit; this is a build-time requirement to carry forward, not a finding.

---

## Summary for the follow-up build task

| Metric | Source | Action needed |
|---|---|---|
| Overlord total (all MSPs) | **None exists** | Build new: same query shape as `monitoringMrr`, no `mspId` filter, PlatformAdmin-gated |
| MSP-own MRR | `aggregateMspTelemetry()` → `monitoringMrr` | Fix open `startDate` no-op bug first, then thin-wrap/reuse as-is |
| Shane's consultancy MRR | `admin-overview.ts` / `admin-finance.ts` (#3a/3b/4) | Confirmed correctly out of scope — separate metric, do not touch for this work |
