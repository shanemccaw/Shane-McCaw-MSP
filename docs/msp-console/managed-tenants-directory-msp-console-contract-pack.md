# Managed Tenants (MSP Console) — directory contract extraction pack

**#3695**, for the MSP Console's book-wide "Managed Tenants" root/directory screen. The backend
this pack documents was built under **#3666** and is already merged on `main` — the directory
resolver (`msp-customer-directory-metrics.ts`) wired additively into the existing
`GET /api/msp/customers` route.

Read-only. Every field below is extracted verbatim from the route's own logic, the resolver's
own logic, and the Drizzle schema, cited to file:line, cross-checked live against local
PostgreSQL and against a real, in-process call to the actual resolver function (not a
reimplementation) using both real tenants on this database. **Nothing here is authored or
invented.** No product code, schema or UI was touched to produce this document.

This is the **first contract pack for this route as a directory listing** — `GET
/api/msp/customers` is documented elsewhere only as the base customer-list shape (name, domain,
status, tenantId, mspId, createdAt); this pack documents the additive seats/people/lastScanAt/
openSignals slice #3666 layered on top of it, and its exact provenance.

Backend surface (two files):

- `msp-customer-directory-metrics.ts` (203 lines) — `fetchCustomerDirectoryMetrics()`, the
  resolver; not a route itself, called from one
- `msp-portal.ts:1055-1145` — `GET /api/msp/customers` (the route that calls it)

Mounted: `routes/index.ts:114` imports `mspPortalRouter`; `routes/index.ts:441`
`router.use(mspPortalRouter)`; the combined router is mounted at `/api` by
`app.ts:127` (`app.use("/api", subscriptionGate, router)`) — live and reachable, same
chokepoint every other route in this codebase mounts through.

Schema: `lib/db/src/schema/msp.ts:200` (`tenantsTable`, `tenants`),
`lib/db/src/schema/index.ts:1258` (`tenantSignalHistoryTable`, `tenant_signal_history`),
`lib/db/src/schema/msp.ts:2333` (`tenantMonitorProfilesTable`, `tenant_monitor_profiles`),
`lib/db/src/schema/msp.ts:3622` (`mspDiagnosticRunsTable`, `msp_diagnostic_runs`). Verified live
against local PostgreSQL — every table exists and every column this route reads matches the
Drizzle source exactly.

---

## 0. The surface, its consumer, and where this sits relative to the design

### 0.1 Consumer today

| Endpoint | Method | Route file:line | Consumer today | Status |
|---|---|---|---|---|
| `/api/msp/customers` | GET | `msp-portal.ts:1065-1144` | none | live, staged |

**Confirmed against the real consumer, not assumed:** `artifacts/msp-console/src` holds only 6
files today (`App.tsx`, `index.css`, `lib/utils.ts`, `main.tsx`, `pages/index.tsx`,
`pages/not-found.tsx`) — none reference `customers` or a directory fetch. This is the expected
pre-Design/pre-wire state per this module's own standing sequence (architect → build the
endpoints → regenerate the contract pack → Design → wire), not a gap this pack invents.

### 0.2 Why this backend exists — #3665 → #3666

#3665's design-freshness audit found the design's root nav screen
(`Design/MSP_Console/design_handoff_msp_console/MSP Console.dc.html`, `sel.kind === "root"`,
template `dc.html:182-205`) rendering a per-tenant directory (name, domain, seats, people, open
signals, last scan) entirely from a static mock array, `tenantData` (`dc.html:1562-1567`), with
no `wire:` annotation and no backing route anywhere in the codebase — filed as #3666 ("no real
backend for the 'Managed Tenants' directory screen"). #3666 built `fetchCustomerDirectoryMetrics`
and wired it additively into the pre-existing `GET /api/msp/customers` route (which already
served `id`/`name`/`domain`/`status`/`tenantId`/`mspId`/`createdAt` — this pack documents only
the four fields #3666 added on top).

**Design's exact row shape, confirmed by reading the template directly**
(`dc.html:186-201`, columns TENANT / SEATS / PEOPLE / OPEN SIGNALS / LAST SCAN):

```
directoryRows = this.tenantData.map((x, i) => Object.assign({}, x, {
  people: (this.rosters[i] || []).length, open: () => this.selectNode(i, null)
}));
// tenantData mock row shape (dc.html:1562):
{ name, domain, seats, people, dot, last, signals, signalColor }
```

The design's mock fields map 1:1 onto this route's real ones: `name`→`customers[].name`,
`domain`→`customers[].domain`, `seats`→`seats`, `people`→`people`, `last`→derived from
`lastScanAt`, `signals`/`signalColor`→derived from `openSignals`. The design mock also renders a
`dot` (status indicator) and `signalColor` that this route does not compute server-side — see §6.

---

## 1. Wire contract — `GET /api/msp/customers`

Source: `msp-portal.ts:1065-1144`. Gated `requireCapability("ladder.msp-operator")` (`:1067`) —
confirmed against `legacy-ladder.ts:251` (`MSPOperator: "ladder.msp-operator"`); role-order
semantics mean MSPAdmin and PlatformAdmin clear it too.

**Request:** query params `page` (1-based, default 1), `limit` (default 20, capped at 100),
`search` (matches `customerName`/`domain` via `ilike`), `status` (`active`/`inactive`/
`onboarding`, or `all`). Always scoped to the caller's own `mspId` (`:1084`), further narrowed
by per-staff customer scoping when the caller is scoped (`resolveStaffScopedCustomerIds`,
`:1088-1091`) — a scoped operator/admin only ever sees their assigned subset.

**Response** (`:1137-1142`):

```ts
{
  customers: WireCustomerDirectoryRow[],
  total: number,
  page: number,
  pageSize: number,
}
```

**`WireCustomerDirectoryRow`** — the base row (`:1113-1121`) plus the #3666 additive metrics
spread on top (`:1132-1135`):

| Field | Type | Nullability | Line | Source |
|---|---|---|---|---|
| `id` | `number` | never null | `1114` | `tenants.id` |
| `name` | `string` | never null | `1115` | `tenants.customer_name` |
| `domain` | `string \| null` | null if unset | `1116` | `tenants.domain` |
| `status` | `string` (tenant status enum, §2) | never null | `1117` | `tenants.status` |
| `tenantId` | `string \| null` | null for a pre-consent customer with no M365 tenant on file | `1118` | `tenants.tenant_id` |
| `mspId` | `number` | never null | `1119` | `tenants.msp_id` |
| `createdAt` | `Date` | never null | `1120` | `tenants.created_at` |
| `seats` | `number \| null` | null: no tenantId, no collected `/subscribedSkus` page, or nothing priced on it | `1134`, resolver `:79,159,199` | real **paid** seat count — see §1a |
| `people` | `number \| null` | null: no tenantId, or no collected `identity:department-directory` row | `1134`, resolver `:81,192` | real Entra `/users` headcount — see §1b |
| `lastScanAt` | `string \| null` (ISO) | null: never scanned to completion | `1134`, resolver `:83,183` | latest completed/partial diagnostic run — see §1c |
| `openSignals` | `number` | never null; `0` is a real answer, not an omission | `1134`, resolver `:86,177` | count of unresolved `tenant_signal_history` rows — see §1d |

A row with no metrics resolved at all (e.g. `directoryMetrics.get(c.id)` misses — cannot happen
given the resolver always pre-seeds every requested id, `:108`, but the route defends against it
anyway) falls back to the same honest defaults the resolver itself uses (`:1134`):
`{ seats: null, people: null, lastScanAt: null, openSignals: 0 }`.

### 1a. `seats` derivation (`msp-customer-directory-metrics.ts:154-165`, `:195-200`)

One call to `resolvePaidSeatFigures(tenantId)` (`license-waste-source.ts:437-473`) per tenant
with a `tenantId`, in parallel (`Promise.all`). This is a **deliberate, documented choice, not
the route's own invention** — the module header (`:18-34`) records that it is specifically the
tenant's **paid** seat count off its latest stored `/subscribedSkus` page, excluding zero-priced
and no-price-on-file SKUs, because summing every SKU unfiltered live-produced "1,020,001 seats"
for a 2-person testbed tenant whose `POWER_BI_STANDARD`/`FLOW_FREE` SKUs report
`prepaidUnits.enabled` of 1,000,000/10,000 — Microsoft's free/trial-SKU convention, not a real
purchased count. `null` when nothing on the tenant's page has a price on file — a real, honest
absence, not a fabricated zero. A `resolvePaidSeatFigures` throw is caught per-tenant and logged
(`:160-163`) — one tenant's failure never drops the whole page.

### 1b. `people` derivation (`:136-152`, `:186-193`)

One batched query: the **latest** `tenant_monitor_profiles` row per `tenantId` whose
`check_key = 'identity:department-directory'` (`selectDistinctOn` + `orderBy(...,
desc(collectedAt))`, `:141-152`), across every `tenantId` in the requested page at once.
`people` reads `extractedProperties.totalUserCount` off that row (`:192`), coerced through
`toNullableNumber` (`:91-95`) — non-finite or missing values become `null`, never `0` or `NaN`.

### 1c. `lastScanAt` derivation (`:124-134`, `:180-184`)

One batched `GROUP BY customerId` query: `MAX(completed_at)` over `msp_diagnostic_runs` rows
whose `status` is `completed` or `partial` (`SCANNED_RUN_STATUSES`, `:74`) — a run that never
finished (`pending`/`running`/`failed`) contributes nothing, so a tenant whose only runs failed
still reads `lastScanAt: null`, honestly distinct from "never attempted."

### 1d. `openSignals` derivation (`:117-122`, `:174-178`)

One batched `GROUP BY customerId` count: rows in `tenant_signal_history` where
`resolved_at IS NULL`, scoped to `customerId` (not `tenantId` — this table is keyed by the
tenants surrogate id per the table's own header comment). Same "currently open" test the
whole-book `activeSignalsCount` in `msp-financial-aggregator.ts` already applies, narrowed to
one customer. `0` is the default for every requested customer (`EMPTY_METRICS`, `:89`) and is a
real, meaningful answer — "no open signals" — not an unresolved/omitted state.

---

## 2. Real enum unions

```ts
// lib/db/src/schema/msp.ts:229 — tenants.status
TENANT_STATUS = ["active", "inactive", "onboarding", "archived"]

// lib/db/src/schema/msp.ts:3629 — msp_diagnostic_runs.status
MSP_DIAGNOSTIC_RUN_STATUS  // resolver only ever treats "completed"/"partial" as scanned
// (msp-customer-directory-metrics.ts:74); "pending"/"running"/"failed" all read as
// lastScanAt: null.
```

`msp_diagnostic_runs.status`'s full real value set (and `tenant_signal_history.resolved_at`'s
nullability) are plain application-enforced columns — the resolver does not attempt to enumerate
every status value beyond the two it filters on, since the filter itself (§1c) is the entire
contract this field needs to document.

---

## 3. Live-data state — real, non-fabricated output for both real tenants

Confirmed live, 2026-09-11, against local PostgreSQL (`tenants`: 2 real rows, both `mspId = 1`,
both `status = active`):

```
psql "$DATABASE_URL" -c "SELECT id, customer_name, tenant_id FROM tenants ORDER BY id;"
 id | customer_name |              tenant_id
----+---------------+---------------------------------------
  1 | Jane Jane     | c4c814d4-3afe-441e-9145-62461d0a4fd3
  3 | Test Me       | 0a361ab2-9e85-4bbf-8b75-c1ebf042dfba
```

`fetchCustomerDirectoryMetrics()` was called **in-process, unmodified, via `tsx`**, against both
real tenant ids — not a hand-reimplementation, the actual function:

```
1 Jane Jane {"seats":1,"people":25,"lastScanAt":"2026-09-06T23:07:08.981Z","openSignals":73}
3 Test Me   {"seats":25,"people":null,"lastScanAt":"2026-08-09T16:40:06.521Z","openSignals":50}
```

Cross-checked against the raw source tables directly:

```
psql "$DATABASE_URL" -c "SELECT customer_id, count(*) FROM tenant_signal_history
  WHERE resolved_at IS NULL GROUP BY customer_id ORDER BY customer_id;"
 customer_id | count
-------------+-------
           1 |    73
           3 |    50

psql "$DATABASE_URL" -c "SELECT customer_id, max(completed_at) FROM msp_diagnostic_runs
  WHERE status IN ('completed','partial') GROUP BY customer_id ORDER BY customer_id;"
 customer_id |            max
-------------+----------------------------
           1 | 2026-09-06 19:07:08.981-04
           3 | 2026-08-09 12:40:06.521-04

psql "$DATABASE_URL" -c "SELECT tenant_id, extracted_properties->'totalUserCount'
  FROM tenant_monitor_profiles WHERE check_key = 'identity:department-directory'
  ORDER BY tenant_id, collected_at DESC;"
-- customer 1 (c4c814d4...): 8 rows, latest totalUserCount = 25
-- customer 3 (0a361ab2...): ZERO rows — confirms the resolver's real people: null
```

`openSignals` and `lastScanAt` match the raw-table cross-check exactly for both tenants. `people`
is `25` for customer 1 (real, live `identity:department-directory` data) and honestly `null` for
customer 3, which has never had that check collected — proven directly by the absence of any row
in `tenant_monitor_profiles` for its `tenantId`, not inferred.

`seats` for customer 1 resolves to `1` (not a display bug — this tenant's own `cost:utilization-
by-sku` page genuinely has only one SKU priced on file; the resolver's own warning log fired live
during this verification: `FLOW_FREE` and `POWER_BI_STANDARD` excluded as `zero_price`,
`Power_Pages_vTrial_for_Makers` excluded as `no_price_on_file`, leaving `paidProvisioned: 1`) —
real behavior per §1a's documented rationale, not something this pack invented or should soften.
Customer 3 resolves to `25` real paid seats.

So calling this route today returns real, non-fabricated, non-uniform metrics for both real
tenants — no fixture, no placeholder row, and a real absence (`people: null` for customer 3)
sitting honestly alongside real populated figures for customer 1.

---

## 4. Cross-surface edges

- **Same resolver, one route today.** `fetchCustomerDirectoryMetrics` has exactly one caller
  (`msp-portal.ts:1129`) — no other route in this codebase invokes it. A future MSP-console-side
  per-tenant detail screen would read the identical four figures off `GET
  /api/msp/customers/:id` today's route does **not** carry them on (confirmed: `:1153-1194`, the
  single-customer detail route, selects only the base tenant fields, no seats/people/lastScanAt/
  openSignals) — worth flagging to whoever wires the detail drill-down, not a gap this pack
  fixes.
- **`seats`' source function is shared, not new.** `resolvePaidSeatFigures` is the same function
  the Licensing pillar dashboard's per-tenant seat figures already use elsewhere in the codebase
  (`license-waste-source.ts`'s own header, §1a) — this route is one more caller of an
  already-proven resolver, not a new seat-counting mechanism.
- **`openSignals`' source table is shared, not new.** `tenant_signal_history` backs both this
  route's per-customer count and `msp-financial-aggregator.ts`'s whole-book
  `activeSignalsCount` — same "resolved_at IS NULL" test, narrowed here to one customer.
- **`requireCapability`/`resolveStaffScopedCustomerIds` are the identical chokepoints** every
  other list-scoped `/api/msp/*` route in this codebase resolves MSP/staff scoping through —
  this route adds no new authorization mechanism.

---

## 5. The forbidden list — declared, not merely absent

1. **No cross-MSP read.** Every query in the route is scoped by `eq(tenantsTable.mspId, mspId)`
   (`:1084`) before any pagination or metric resolution runs; per-staff scoping narrows further
   when applicable (`:1088-1091`).
2. **No route in this pack fabricates a seat, person, scan date, or signal count.** Every
   figure is a real, derived read — a tenant with nothing collected yet returns the honest
   `null`/`null`/`null`/`0` shape (`EMPTY_METRICS`, resolver `:89`), never a fixture or
   placeholder row. Proven directly against both real tenants in §3, not merely asserted.
3. **No route in this pack writes anything.** `GET /api/msp/customers` is a read-only handler;
   `fetchCustomerDirectoryMetrics` itself issues only `SELECT`s (confirmed by direct read of all
   203 lines — zero `insert`/`update`/`delete` calls).
4. **`seats` is deliberately never the unfiltered total-enabled-seats figure.** §1a's rationale
   is a real, confirmed product decision (a live testbed-tenant bug this route's own predecessor
   would have shipped), not an oversight this pack should flag as a gap.

---

## 6. Fields the design mock carries that this route does not compute (not a gap — a UI concern)

The design's `tenantData` mock rows also carry `dot` (a status-indicator color) and
`signalColor` (a color keyed off signal severity) — both purely presentational derivations a
consumer would compute client-side from `status`/`openSignals` (and, if a severity breakdown is
ever needed beyond the raw count, from a richer signals shape this route does not currently
return — it returns only the unresolved **count**, not the underlying rows or their
severities). Nothing in #3666's scope or this route's own tests suggests server-side color
computation was ever intended; recorded here so a future wiring session doesn't mistake `dot`/
`signalColor`'s absence for a missing backend field.

---

## 7. Provenance

Written 2026-09-11 against `main` (branch `agent/3695-q2356`), for #3695. Read in full, not
sampled: `msp-customer-directory-metrics.ts` (203 lines), `msp-customer-directory-metrics.test.ts`
(189 lines), the relevant section of `msp-portal.ts` (`GET /api/msp/customers`,
`:1055-1144`, plus the single-customer detail route at `:1153-1194` for the cross-surface note
in §4), `license-waste-source.ts`'s `resolvePaidSeatFigures` and its module header, the design's
`MSP Console.dc.html` root-directory template (`:182-205`) and its `tenantData` mock
(`:1562-1567`), and the relevant `tenants`/`tenant_signal_history`/`tenant_monitor_profiles`/
`msp_diagnostic_runs` schema definitions. Verified live against local PostgreSQL: all four
source tables confirmed to exist with the columns this route/resolver read; `fetchCustomer-
DirectoryMetrics()` invoked in-process (unmodified, via `tsx`) against both of the database's 2
real tenants, and its output cross-checked field-by-field against direct raw-table queries — all
four figures matched exactly for both tenants, including one genuine `null` (`people` for
customer 3, confirmed by the literal absence of any `identity:department-directory` row for its
`tenantId`). No product code, schema, or UI was changed by this pass. No new finding was
surfaced during this extraction — §6 is a documentation note for a future wiring session, not a
backend gap requiring a filed issue.
