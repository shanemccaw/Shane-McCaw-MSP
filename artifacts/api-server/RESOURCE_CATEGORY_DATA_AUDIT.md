# Resource Category Data Audit

Read-only audit. No computation logic modified. All line numbers verified against the working tree as of this audit. Builds on [MRR_CANONICAL_SOURCE_AUDIT.md](MRR_CANONICAL_SOURCE_AUDIT.md) and [MRR_METRIC_SEPARATION_AUDIT.md](MRR_METRIC_SEPARATION_AUDIT.md) (same aggregator file), and on the Factory Floor design doc's locked 5-belt-type list. The zoomed-colony per-resource-type belt view (design doc §4) is confirmed still a future task — `FactoryFloorLab.tsx:1-9` states colonies currently render one generic revenue belt each, not a per-category breakdown.

## 1. What each of the 4 existing categories actually sums

All four live in `aggregateMspTelemetry()`, `artifacts/api-server/src/lib/msp-financial-aggregator.ts:58-257`.

### `monitoringMrr` (lines 64-93) — confirmed as understood

`mspSubscriptionsTable` ⋈ `servicesTable`, filtered to `mspId` + status `active`/`trialing`/`past_due`. Sums subscription-list-price via `resolveCatalogPricing()`.

**One caveat not previously flagged:** the join does not filter on `servicesTable.deliveryType`. Anything attached to the MSP through `mspSubscriptionsTable` counts here regardless of whether the underlying product's `deliveryType` is `bundle_subscription` (monitoring tier) or something else — it's "MSP subscription-mechanism revenue," monitoring-only by catalog convention today, not by a schema constraint. Low risk in practice (this is the well-established path for monitoring-tier products) but worth knowing before leaning on it as a hard guarantee.

### `projectRevenue` (lines 96-119) — **not cleanly "consulting"**

Query: `invoicesTable` inner-joined only to `mspUsersTable` (on `clientUserId`), filtered to `status = "paid"`. **No join to `projectsTable` or `servicesTable` at all.**

This sums *every paid invoice* for the MSP's customers, full stop — there is no filter distinguishing a consulting engagement from any other kind of project. `invoicesTable.projectId` (`schema/index.ts:390`) is nullable and unused in this query; `projectsTable.projectType` (`schema/index.ts:259`) — which already distinguishes `"project"` / `"retainer"` / `"quick_win"` — is never consulted here either. So today, `projectRevenue` = "consulting" only insofar as most paid invoices happen to come from project-type engagements in practice; a retainer or quick-win invoice would land in the same bucket with no way to tell them apart from the query as written.

### `remediationRevenue` (lines 122-150) — narrower and differently-scoped than the name suggests

Query: `kanbanTasksTable` ⋈ `projectsTable` ⋈ `mspUsersTable` ⋈ `workflowStepsTable` ⋈ `clientServicesTable` ⋈ `servicesTable`, filtered to `column = "completed"`. Revenue = the linked `clientService`'s underlying `servicesTable` price, counted once per completed kanban task whose `workflowStep` has a non-null `clientServiceId`.

Two things this is **not**:
- It's not "amount actually invoiced for the fix" — it's the catalog price of whatever `servicesTable` product the client purchased (via `clientServicesTable`), attributed at task-completion time.
- It's not restricted to one-time quick fixes — the join reaches `servicesTable`, which carries `deliveryType` (`assessment` / `bundle_subscription` / `retainer` / `document_generation` / `none`). A completed kanban task tied to a *retainer's* workflow step, for instance, would also land in `remediationRevenue` today, because the query has no `deliveryType` filter. The name describes the common case (assessment/quick-fix follow-up work), not a hard boundary the query enforces.

Also note: `workflowStepsTable.clientServiceId` is nullable (`schema/index.ts:308`) — workflow steps attached only to a `projectId` (not a `clientServiceId`) are silently excluded by the inner join, so `remediationRevenue` undercounts completed remediation work that isn't tied to a purchased `client_service` row.

### `offerRevenue` (lines 152-176) — confirmed, with the same scope caveat

Query: `salesOffersTable` filtered to `mspId` + `state = "accepted"`. Confirmed: this is sales-offer-engine conversions — `salesOffersTable` (`schema/index.ts:2336-2385`) is explicitly "one generated offer... backed by a catalog product," populated by the signal-driven offer engine (fired-signal-key eligibility, scoring, engine snapshot).

Same caveat as `remediationRevenue`: `salesOffersTable.serviceId` references `servicesTable`, which carries `deliveryType`, but the query doesn't filter or group by it. An accepted offer for *any* product type — including a `retainer` or `bundle_subscription` product — counts as `offerRevenue`, not just one-time add-ons.

## 2. Do "Documents" and "Assessments" exist as separately trackable revenue today?

**Not in the current aggregator queries, but the underlying data model already carries the distinction** — this is the key finding.

`servicesTable.deliveryType` (`schema/index.ts:215-217`) is a real, actively-used enum: `"assessment" | "bundle_subscription" | "retainer" | "document_generation" | "none"`. It's not vestigial — `productTypeConfig.ts:28-43`'s `detectProductType()` maps it directly to product-type keys including `document_product` (from `deliveryType = "document_generation"`) and `assessment` (from `deliveryType = "assessment"`), and it's a live-edited field in the admin Product Catalog UI (`admin-services.ts` EDIT_FIELDS list).

So:
- `remediationRevenue` and `offerRevenue` **both already join through to `servicesTable`** (via `clientServicesTable.serviceId` and `salesOffersTable.serviceId` respectively) — meaning both could be split by `deliveryType` today with a query change, no new schema or new tracking required.
- `projectRevenue` (invoices) has **no** service join at all, so it can't be split by `deliveryType`. But it doesn't need new tracking either — `invoicesTable.projectId → projectsTable.projectType` (`"project" | "retainer" | "quick_win"`) is an existing, populated FK/column (confirmed live-used in `workflow-executor.ts:1761`, `fulfillment-queue.ts`, `opportunities.ts`) that the query simply never joins to.

Caveat: this audit can't confirm live data distribution (how many real rows have `deliveryType` populated vs. null, how consistently `projectType` is set) — no DB access in this environment. This is a schema/query-capability finding, not a confirmation that the resulting numbers will be well-populated on day one.

## 3. Recommended mapping

**Neither pure option (a) nor pure option (b) — a real split is achievable without new tracking, but it does require query changes, which is real (if small) work, not a free relabeling.**

Recommended path, in two tiers:

**Tier 1 — ship today with zero query changes (relabeling only):**
Map the 5 design-doc categories onto the 4 existing fields with one deliberate, disclosed merge:
- Monitoring → `monitoringMrr`
- Consulting → `projectRevenue`
- Subscriptions/Retainers → *(not cleanly isolated yet — see Tier 2)*
- Assessments/Quick Fixes + Documents → `remediationRevenue` + `offerRevenue` combined, visually split evenly or by a fixed ratio if a placeholder is needed — **not backed by a real Documents-vs-Assessments distinction today**, and callers should not present it as one.

**Tier 2 — real 5-way split, buildable now, no new schema:**
1. Add a join from `projectRevenue`'s invoice query to `projectsTable.projectType` and bucket: `"project"` → Consulting, `"retainer"` → Subscriptions/Retainers, `"quick_win"` → Assessments/Quick Fixes.
2. Add a `GROUP BY servicesTable.deliveryType` (or equivalent case-when bucketing) to both `remediationRevenue` and `offerRevenue`, mapping `"document_generation"` → Documents, `"assessment"` → Assessments/Quick Fixes, `"retainer"`/`"bundle_subscription"` → Subscriptions/Retainers, `"none"` → fold into whichever bucket the product's `serviceClass` suggests (or a residual "other" bucket, disclosed as such).
3. Resulting 5-way mapping:
   - **Monitoring** = `monitoringMrr` (unchanged)
   - **Consulting** = `projectRevenue WHERE project.projectType = 'project'`
   - **Subscriptions/Retainers** = `projectRevenue WHERE project.projectType = 'retainer'` + `(remediationRevenue + offerRevenue) WHERE service.deliveryType IN ('retainer','bundle_subscription')`
   - **Assessments/Quick Fixes** = `projectRevenue WHERE project.projectType = 'quick_win'` + `(remediationRevenue + offerRevenue) WHERE service.deliveryType = 'assessment'`
   - **Documents** = `(remediationRevenue + offerRevenue) WHERE service.deliveryType = 'document_generation'`

This is real, scoped follow-up work (three query edits plus a bucketing helper) — recommend it as its own separate task, not bundled into this read-only audit, consistent with the design doc's §4 zoomed-colony breakdown already being tracked as future work in `FactoryFloorLab.tsx`.
