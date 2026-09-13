/**
 * msp-customer-directory-metrics.ts — Git #3666.
 *
 * Real per-tenant metrics for the MSP Console's book-wide "Managed Tenants"
 * directory list (`GET /api/msp/customers`): seats, people, the last
 * completed scan, and the count of currently-open signals.
 *
 * Confirmed via #3665's audit: the design's root directory screen
 * (`sel.kind === "root"` in `Design/MSP_Console/design_handoff_msp_console/MSP
 * Console.dc.html`) renders these four fields from a static `tenantData` mock
 * array with no `wire:` claim and no backing route. `GET /api/msp/customers`
 * already exists (msp-portal.ts) but returns only
 * `{id, name, domain, status, tenantId, mspId, createdAt}` — nothing
 * seats/people/lastScan/openSignals-shaped. This module is the additive
 * resolver the route wires in; nothing here is invented, every figure is
 * sourced from a real, already-collected table:
 *
 *   - seats:       `license-waste-source.ts`'s `resolvePaidSeatFigures`
 *                   (`.provisioned`) — the tenant's real PAID seat count off
 *                   its latest stored `/subscribedSkus` page. Deliberately
 *                   NOT the unfiltered `totalEnabledSeats`/`unusedSeatsFrom-
 *                   SubscribedSkus` total: live-verified against this repo's
 *                   own testbed tenant (mccawsoft2), whose real
 *                   `POWER_BI_STANDARD` and `FLOW_FREE` SKUs report
 *                   `prepaidUnits.enabled` of 1,000,000 and 10,000
 *                   respectively — Microsoft's own convention for a
 *                   free/trial SKU, not a real purchased-seat count. Summing
 *                   every SKU unfiltered put this tenant's directory row at
 *                   "1,020,001 seats" for a 2-person tenant. Paid-only
 *                   (excludes zero-priced and no-price-on-file SKUs) is the
 *                   only honest answer to "how many seats does this tenant
 *                   have" a directory row can show; null when nothing on the
 *                   page has a price on file — real absence, not a fabricated
 *                   zero.
 *   - people:      `identity:department-directory`'s real `totalUserCount`
 *                   (Entra `/users` headcount) off the tenant's latest
 *                   collected row.
 *   - lastScanAt:  the most recent `msp_diagnostic_runs.completedAt` among
 *                   this customer's COMPLETED or PARTIAL runs — a run that
 *                   never finished (pending/running/failed) didn't produce a
 *                   scan result worth dating.
 *   - openSignals: count of this customer's `tenant_signal_history` rows with
 *                   `resolvedAt IS NULL` — the same "currently open" test the
 *                   whole-book `activeSignalsCount` in
 *                   msp-financial-aggregator.ts already applies, narrowed to
 *                   one customer at a time.
 *   - criticalSignals: the subset of the above whose `signal_key` resolves to
 *                   `severity: "critical"` — Git #3746. This is the field the
 *                   MSP Console's tree sidebar needs to render its 4th, red
 *                   status dot (README "Tree sidebar": healthy/warnings/
 *                   critical/never-scanned); before this, `openSignals` alone
 *                   only distinguished "some open signal" from "none", so the
 *                   design's critical state was unreachable. Chose a plain
 *                   count over a `worstSeverity` enum: `statusDotColor` only
 *                   ever needs "is any open signal critical", which a count
 *                   answers as directly as an enum would while staying the
 *                   same shape as `openSignals` beside it — no `warningSignals`
 *                   counterpart, since `openSignals - criticalSignals` already
 *                   tells the UI whether a non-critical open signal exists and
 *                   a second count would duplicate that arithmetic.
 *
 *                   `tenant_signal_history` itself carries no severity column
 *                   (a fired signal is just a key + timestamps) — severity is
 *                   a property of the *signal definition*, resolved by
 *                   joining `signal_key` against `signal_derivation_rules` /
 *                   `signal_rule_groups` (both carry `severity` via the
 *                   shared `SIGNAL_INTELLIGENCE_FIELDS`, exactly like
 *                   `fetchSignalRulesAndGroups` in priority-engine.ts already
 *                   reads them for signal evaluation). Scoped to platform-
 *                   default rows (`msp_id IS NULL`) only, the same scope
 *                   `fetchSignalRulesAndGroups(null)` uses — confirmed via the
 *                   local DB that zero MSP-specific severity overrides exist
 *                   today; if that changes, this needs the same per-customer
 *                   `mspId` scoping `fetchSignalRulesAndGroups` already does.
 *
 * openSignals+criticalSignals are now one combined GROUP BY query (a raw SQL
 * join, since the severity resolution needs a CTE the query builder doesn't
 * express cleanly) across the whole requested page, keyed by customerId —
 * still one query for both fields, not a second query per tenant. lastScanAt
 * is its own batched GROUP BY query. people is one batched "latest row per
 * tenantId" query. seats runs `resolvePaidSeatFigures` per tenant (it does
 * its own per-SKU price lookups internally, exactly like every other real
 * caller of that function) — one call per page row, in parallel; acceptable
 * at the route's existing page-size cap (100).
 *
 * A tenant with no M365 `tenantId` on file, or no stored data yet for a given
 * metric, gets `null` (seats/people/lastScanAt) or `0` (openSignals/
 * criticalSignals — "no open signals" IS the honest answer for a
 * never-scanned tenant), never a fabricated figure.
 */

import {
  db,
  tenantMonitorProfilesTable,
  mspDiagnosticRunsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, max, sql } from "drizzle-orm";
import { resolvePaidSeatFigures } from "./license-waste-source.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "tenant.portal" });

/** Runs that actually produced a dated result — see the module header. */
const SCANNED_RUN_STATUSES = ["completed", "partial"] as const;

const DEPARTMENT_DIRECTORY_CHECK_KEY = "identity:department-directory";

export interface CustomerDirectoryMetrics {
  /** Real PAID seat count off the tenant's latest `/subscribedSkus` page. Null = never collected, or nothing priced. */
  seats: number | null;
  /** Real Entra `/users` headcount from the latest `identity:department-directory` row. Null = never collected. */
  people: number | null;
  /** ISO 8601 timestamp of the most recent completed/partial diagnostic run. Null = never scanned. */
  lastScanAt: string | null;
  /** Count of this customer's currently-unresolved `tenant_signal_history` rows. */
  openSignals: number;
  /** The subset of `openSignals` whose signal definition carries `severity: "critical"` (Git #3746). */
  criticalSignals: number;
}

const EMPTY_METRICS: CustomerDirectoryMetrics = {
  seats: null, people: null, lastScanAt: null, openSignals: 0, criticalSignals: 0,
};

function toNullableNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * Directory metrics for a page of customers. `customers` carries each row's
 * `id` (tenants.id, the key the returned map is keyed by) and its `tenantId`
 * (the M365 Graph tenant id — nullable, an unclaimed/pre-consent customer has
 * none), exactly what `GET /api/msp/customers` already selects.
 */
export async function fetchCustomerDirectoryMetrics(
  customers: readonly { id: number; tenantId: string | null }[],
): Promise<Map<number, CustomerDirectoryMetrics>> {
  const result = new Map<number, CustomerDirectoryMetrics>();
  if (customers.length === 0) return result;
  for (const c of customers) result.set(c.id, { ...EMPTY_METRICS });

  const customerIds = customers.map((c) => c.id);
  const tenantIdToCustomerId = new Map<string, number>();
  for (const c of customers) {
    if (c.tenantId) tenantIdToCustomerId.set(c.tenantId, c.id);
  }
  const tenantIds = [...tenantIdToCustomerId.keys()];

  // ── openSignals + criticalSignals — one combined GROUP BY over the whole page,
  // keyed by customerId. Raw SQL (not the query builder) because resolving each
  // row's severity needs a CTE joined against `signal_key` — see the module
  // header for why this is still one query, not a second query per tenant.
  const openSignalsQuery = db.execute<{ customerId: number; openCount: string; criticalCount: string }>(sql`
    WITH signal_severity AS (
      SELECT DISTINCT ON (signal_key) signal_key, severity
      FROM (
        SELECT signal_key, severity, 0 AS source_priority
        FROM signal_derivation_rules
        WHERE msp_id IS NULL
        UNION ALL
        SELECT signal_key, severity, 1 AS source_priority
        FROM signal_rule_groups
        WHERE msp_id IS NULL
      ) combined
      ORDER BY signal_key, source_priority
    )
    SELECT
      h.customer_id AS "customerId",
      COUNT(*) AS "openCount",
      COUNT(*) FILTER (WHERE ss.severity = 'critical') AS "criticalCount"
    FROM tenant_signal_history h
    LEFT JOIN signal_severity ss ON ss.signal_key = h.signal_key
    WHERE h.customer_id IN (${sql.join(customerIds.map((id) => sql`${id}`), sql`, `)})
      AND h.resolved_at IS NULL
    GROUP BY h.customer_id
  `).then((r) => r.rows);

  // ── lastScanAt — one GROUP BY over the whole page, keyed by customerId ──────
  const lastScanQuery = db
    .select({ customerId: mspDiagnosticRunsTable.customerId, lastScanAt: max(mspDiagnosticRunsTable.completedAt) })
    .from(mspDiagnosticRunsTable)
    .where(
      and(
        inArray(mspDiagnosticRunsTable.customerId, customerIds),
        inArray(mspDiagnosticRunsTable.status, [...SCANNED_RUN_STATUSES]),
      ),
    )
    .groupBy(mspDiagnosticRunsTable.customerId);

  // ── people — latest identity:department-directory row per tenantId ─────────
  const peopleQuery =
    tenantIds.length === 0
      ? Promise.resolve([])
      : db
          .selectDistinctOn([tenantMonitorProfilesTable.tenantId], {
            tenantId: tenantMonitorProfilesTable.tenantId,
            extractedProperties: tenantMonitorProfilesTable.extractedProperties,
          })
          .from(tenantMonitorProfilesTable)
          .where(
            and(
              inArray(tenantMonitorProfilesTable.tenantId, tenantIds),
              eq(tenantMonitorProfilesTable.checkKey, DEPARTMENT_DIRECTORY_CHECK_KEY),
            ),
          )
          .orderBy(tenantMonitorProfilesTable.tenantId, desc(tenantMonitorProfilesTable.collectedAt));

  // ── seats — real PAID seat figures per tenant, in parallel (see header) ────
  const seatsQuery = Promise.all(
    tenantIds.map(async (tenantId) => {
      try {
        const figures = await resolvePaidSeatFigures(tenantId);
        return { tenantId, provisioned: figures?.provisioned ?? null };
      } catch (err) {
        log.warn({ err, tenantId }, "fetchCustomerDirectoryMetrics: resolvePaidSeatFigures failed — seats omitted for this tenant");
        return { tenantId, provisioned: null };
      }
    }),
  );

  const [openSignalsRows, lastScanRows, peopleRows, seatsRows] = await Promise.all([
    openSignalsQuery,
    lastScanQuery,
    peopleQuery,
    seatsQuery,
  ]);

  for (const row of openSignalsRows) {
    if (row.customerId === null) continue;
    const metrics = result.get(row.customerId);
    if (metrics) {
      metrics.openSignals = Number(row.openCount ?? 0);
      metrics.criticalSignals = Number(row.criticalCount ?? 0);
    }
  }

  for (const row of lastScanRows) {
    if (row.customerId === null) continue;
    const metrics = result.get(row.customerId);
    if (metrics && row.lastScanAt) metrics.lastScanAt = new Date(row.lastScanAt).toISOString();
  }

  for (const row of peopleRows) {
    const customerId = tenantIdToCustomerId.get(row.tenantId);
    if (customerId === undefined) continue;
    const metrics = result.get(customerId);
    if (!metrics) continue;
    const props = (row.extractedProperties as Record<string, unknown> | null) ?? {};
    metrics.people = toNullableNumber(props.totalUserCount);
  }

  for (const row of seatsRows) {
    const customerId = tenantIdToCustomerId.get(row.tenantId);
    if (customerId === undefined) continue;
    const metrics = result.get(customerId);
    if (metrics) metrics.seats = row.provisioned;
  }

  return result;
}
