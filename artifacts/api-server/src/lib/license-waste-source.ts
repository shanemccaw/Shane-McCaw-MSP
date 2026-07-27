/**
 * license-waste-source.ts
 *
 * Computes the REAL per-SKU unused-seat counts for a tenant, so cost-engine.ts
 * has something honest to price.
 *
 * ── What the live catalog actually contains (audited 2026-07-26) ─────────────
 * The registry's declared source, `cost:license-waste-estimate`, DOES NOT EXIST
 * in `monitor_checks`. The seven real `cost:*` checks are:
 *
 *   cost:duplicate-assignments            /users           countDuplicates(skuId)
 *   cost:entra-license-tier-distribution  /subscribedSkus  groupByCount(skuPartNumber)
 *   cost:group-based-licensing-adoption   /groups          count(assignedLicenses)
 *   cost:license-count-by-sku             /subscribedSkus  groupByCount(skuPartNumber)
 *   cost:underutilized-premium            /users           count(assignedLicenses)
 *   cost:unused-unassigned-licenses       /subscribedSkus  count(consumedUnits)
 *   cost:utilization-by-sku               /subscribedSkus  groupByCount(skuPartNumber)
 *
 * NONE of them produces a per-SKU wasted-SEAT count, and two traps follow:
 *
 *   1. `cost:unused-unassigned-licenses` is misnamed relative to its mapping.
 *      `count` on `consumedUnits` counts SKU ROWS that have a consumedUnits
 *      value — so `unusedLicenseCount: 4` means "this tenant subscribes to 4
 *      SKUs", not "4 seats are wasted".
 *   2. Every `groupByCount(skuPartNumber)` over `/subscribedSkus` yields
 *      `{ ENTERPRISEPACK: 1, ... }` — ONE ROW PER SKU. Those maps are SKU-keyed
 *      and numeric, so they look exactly like a seat-count breakdown. Pricing
 *      one would report `1 × $23 = $23/month` of waste that does not exist.
 *
 * So this module deliberately does NOT infer waste from any extractedProperties
 * count map. It computes the real figure from the one place it genuinely lives:
 * the stored `/subscribedSkus` Graph response, where each SKU carries
 * `prepaidUnits.enabled` (seats bought) and `consumedUnits` (seats assigned).
 * Unused seats = enabled − consumed, floored at zero. That is a real,
 * arithmetically-defined quantity, not a name-matching guess.
 *
 * Candidate checks are chosen by ENDPOINT (`/subscribedSkus`), not by key name,
 * because the key names in this catalog have already proven unreliable.
 *
 * Safety rules, all "return null rather than a plausible number":
 *   • The stored rawResponse is only the FIRST Graph page. If it carries an
 *     `@odata.nextLink`, the snapshot is truncated and is refused outright —
 *     a partial estate would silently underreport waste.
 *   • A SKU missing either `prepaidUnits.enabled` or `consumedUnits` is skipped,
 *     never defaulted.
 *   • Zero unused seats across every SKU returns null (no waste is a real,
 *     honest answer — not a $0 figure dressed up as a finding).
 *
 * NB: the latest-row query is re-implemented here rather than imported from
 * dashboard-resolvers.ts — dashboard-resolvers imports THIS module, and the
 * reverse import would close a cycle.
 */

import { db, monitorChecksTable, tenantMonitorProfilesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "engine.dashboard" });

/** The registry's declared source for licensing.wasteEstimateBreakdown. */
export const DEFAULT_LICENSE_WASTE_CHECK_KEY = "cost:license-waste-estimate";

/**
 * The one Graph endpoint that carries bought-vs-assigned seat counts. Matched as
 * a substring so `/subscribedSkus`, `/subscribedSkus?$select=...` and an
 * absolute-URL variant all qualify.
 */
const SUBSCRIBED_SKUS_ENDPOINT = "subscribedskus";

/**
 * Preferred candidate when several checks hit /subscribedSkus — the one whose
 * name is about unused licences, so the provenance we report reads sensibly.
 */
const PREFERRED_SUBSCRIBED_SKUS_CHECK = "cost:unused-unassigned-licenses";

export interface LicenseWasteCounts {
  /** monitor_checks.key whose stored Graph response the counts were computed from. */
  checkKey: string;
  /** { skuPartNumber: unusedSeatCount } — the input to computeSkuCostBreakdown. */
  counts: Record<string, number>;
  /** Per-SKU detail behind `counts`, so callers can show the arithmetic. */
  lines: { skuPartNumber: string; enabled: number; consumed: number; unused: number }[];
  /** Total seats bought across every SKU with complete data. */
  totalEnabledSeats: number;
  collectedAt: Date | null;
  /** True when the preferred (registry-declared) check key was NOT the one used. */
  fallback: boolean;
}

function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Pull real unused-seat counts out of a stored `/subscribedSkus` Graph page.
 * Returns null when the page is truncated or carries no usable SKU at all.
 */
export function unusedSeatsFromSubscribedSkus(
  rawResponse: unknown,
): { counts: Record<string, number>; lines: LicenseWasteCounts["lines"]; totalEnabledSeats: number } | null {
  if (!rawResponse || typeof rawResponse !== "object") return null;
  const page = rawResponse as Record<string, unknown>;

  // Only the FIRST page is persisted. A nextLink means we are looking at a
  // partial estate, which would underreport waste — refuse it.
  const nextLink = page["@odata.nextLink"];
  if (typeof nextLink === "string" && nextLink.length > 0) return null;

  const items = Array.isArray(page.value)
    ? page.value
    : Array.isArray(rawResponse)
      ? (rawResponse as unknown[])
      : null;
  if (!items) return null;

  const counts: Record<string, number> = {};
  const lines: LicenseWasteCounts["lines"] = [];
  let totalEnabledSeats = 0;

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const sku = item as Record<string, unknown>;
    const skuPartNumber = typeof sku.skuPartNumber === "string" ? sku.skuPartNumber : null;
    const prepaid = sku.prepaidUnits;
    const enabled =
      prepaid && typeof prepaid === "object" ? toNum((prepaid as Record<string, unknown>).enabled) : null;
    const consumed = toNum(sku.consumedUnits);
    // Incomplete SKU rows are skipped, never defaulted to zero — a missing
    // consumedUnits would otherwise read as "every seat is wasted".
    if (!skuPartNumber || enabled == null || consumed == null) continue;

    totalEnabledSeats += enabled;
    const unused = Math.max(0, enabled - consumed);
    lines.push({ skuPartNumber, enabled, consumed, unused });
    if (unused > 0) counts[skuPartNumber] = (counts[skuPartNumber] ?? 0) + unused;
  }

  if (lines.length === 0) return null;
  return { counts, lines, totalEnabledSeats };
}

/** Active checks whose endpoint hits /subscribedSkus, preferred one first. */
async function subscribedSkusCheckKeys(): Promise<string[]> {
  const rows = await db
    .select({ key: monitorChecksTable.key, endpoint: monitorChecksTable.endpoint })
    .from(monitorChecksTable)
    .where(eq(monitorChecksTable.status, "active"));
  const keys = rows
    .filter(
      (r) => typeof r.endpoint === "string" && r.endpoint.toLowerCase().includes(SUBSCRIBED_SKUS_ENDPOINT),
    )
    .map((r) => r.key)
    .filter((k): k is string => typeof k === "string")
    .sort();
  // Stable, meaningful provenance: prefer the unused-licences-named check.
  return keys.sort((a, b) =>
    a === PREFERRED_SUBSCRIBED_SKUS_CHECK ? -1 : b === PREFERRED_SUBSCRIBED_SKUS_CHECK ? 1 : 0,
  );
}

/** Latest stored Graph page + collectedAt for one (tenant, check). */
async function latestRawResponseFor(
  tenantId: string,
  checkKey: string,
): Promise<{ rawResponse: unknown; collectedAt: Date | null } | null> {
  const [row] = await db
    .select({
      rawResponse: tenantMonitorProfilesTable.rawResponse,
      collectedAt: tenantMonitorProfilesTable.collectedAt,
    })
    .from(tenantMonitorProfilesTable)
    .where(
      and(
        eq(tenantMonitorProfilesTable.tenantId, tenantId),
        eq(tenantMonitorProfilesTable.checkKey, checkKey),
      ),
    )
    .orderBy(desc(tenantMonitorProfilesTable.collectedAt))
    .limit(1);
  if (!row) return null;
  return { rawResponse: row.rawResponse, collectedAt: row.collectedAt ?? null };
}

/**
 * Resolve the tenant's real per-SKU unused-seat counts, or null when no
 * /subscribedSkus check has a complete stored response with genuine unused
 * seats. Never guesses a count, and never prices a SKU-row tally as waste.
 */
export async function resolveLicenseWasteCounts(
  tenantId: string,
  preferredCheckKey: string = DEFAULT_LICENSE_WASTE_CHECK_KEY,
): Promise<LicenseWasteCounts | null> {
  const discovered = await subscribedSkusCheckKeys().catch((err) => {
    log.warn({ err, tenantId }, "license-waste-source: /subscribedSkus check discovery failed");
    return [] as string[];
  });
  // The registry's declared key is tried first when it is itself a
  // /subscribedSkus check; otherwise it is not a usable source at all and is
  // simply not a candidate (today it does not exist in the catalog).
  const candidates = discovered.includes(preferredCheckKey)
    ? [preferredCheckKey, ...discovered.filter((k) => k !== preferredCheckKey)]
    : discovered;

  if (candidates.length === 0) {
    log.warn(
      { tenantId },
      "license-waste-source: no active check queries /subscribedSkus — seat data cannot be sourced",
    );
    return null;
  }

  for (const checkKey of candidates) {
    const latest = await latestRawResponseFor(tenantId, checkKey);
    if (!latest) continue;
    const computed = unusedSeatsFromSubscribedSkus(latest.rawResponse);
    if (!computed) continue;
    // Zero unused seats everywhere is a real answer, but it is "no waste", not
    // a $0 finding — let the caller render its honest empty state.
    if (Object.keys(computed.counts).length === 0) {
      log.info(
        { tenantId, checkKey, skusInspected: computed.lines.length },
        "license-waste-source: every subscribed SKU is fully assigned — no unused seats",
      );
      return null;
    }
    return {
      checkKey,
      counts: computed.counts,
      lines: computed.lines,
      totalEnabledSeats: computed.totalEnabledSeats,
      collectedAt: latest.collectedAt,
      fallback: checkKey !== preferredCheckKey,
    };
  }

  log.warn(
    { tenantId, candidates },
    "license-waste-source: no /subscribedSkus check has a complete stored Graph page for this tenant",
  );
  return null;
}
