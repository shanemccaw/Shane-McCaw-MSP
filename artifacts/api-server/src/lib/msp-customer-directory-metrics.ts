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
 *
 * openSignals/lastScanAt are batched into one GROUP BY query each across the
 * whole requested page (keyed by customerId). people is one batched
 * "latest row per tenantId" query. seats runs `resolvePaidSeatFigures` per
 * tenant (it does its own per-SKU price lookups internally, exactly like
 * every other real caller of that function) — one call per page row, in
 * parallel; acceptable at the route's existing page-size cap (100).
 *
 * A tenant with no M365 `tenantId` on file, or no stored data yet for a given
 * metric, gets `null` (seats/people/lastScanAt) or `0` (openSignals — "no open
 * signals" IS the honest answer for a never-scanned tenant), never a
 * fabricated figure.
 */

import {
  db,
  tenantMonitorProfilesTable,
  tenantSignalHistoryTable,
  mspDiagnosticRunsTable,
} from "@workspace/db";
import { and, count, desc, eq, inArray, isNull, max } from "drizzle-orm";
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
}

const EMPTY_METRICS: CustomerDirectoryMetrics = { seats: null, people: null, lastScanAt: null, openSignals: 0 };

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

  // ── openSignals — one GROUP BY over the whole page, keyed by customerId ──────
  const openSignalsQuery = db
    .select({ customerId: tenantSignalHistoryTable.customerId, openCount: count() })
    .from(tenantSignalHistoryTable)
    .where(and(inArray(tenantSignalHistoryTable.customerId, customerIds), isNull(tenantSignalHistoryTable.resolvedAt)))
    .groupBy(tenantSignalHistoryTable.customerId);

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
    if (metrics) metrics.openSignals = Number(row.openCount ?? 0);
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
