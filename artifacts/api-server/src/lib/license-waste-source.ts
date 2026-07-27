/**
 * license-waste-source.ts
 *
 * Finds the REAL per-SKU wasted-seat counts for a tenant, so cost-engine.ts has
 * something to price.
 *
 * ── Why this module exists ───────────────────────────────────────────────────
 * Every consumer of the Cost Engine (the /assessment + /m365-health status
 * payload, the licensing.wasteEstimateBreakdown dashboard metric, the CIO
 * narrative) used to reach for ONE hardcoded monitor check key —
 * `cost:license-waste-estimate` — and give up silently when that check had no
 * row for the tenant. Monitor check keys are DATA (`monitor_checks.key`), not
 * code: the live catalog's real wasted-seat check can be, and is, keyed
 * differently. The result was a permanently null dollar figure on a tenant that
 * genuinely had waste collected under a different cost check key, with nothing
 * in the response saying which key had been looked for.
 *
 * So resolution is now data-driven and explicit about what it used:
 *   1. Try the caller's preferred key first (the registry's declared sourceKey),
 *      so nothing changes for a catalog where that key IS the collected one.
 *   2. Otherwise consider the `cost:` domain checks whose key names an
 *      unused/wasted-seat concept (waste / unused / unassigned / idle /
 *      inactive / orphan). Deliberately NARROW: `licensing:sku-utilization` and
 *      friends count the tenant's WHOLE license estate, and treating those as
 *      "waste" would massively over-report savings.
 *   3. Accept a candidate only when its extracted `{ label: count }` map is
 *      genuinely SKU-keyed — at least one key present in sku_price_reference.
 *      That is what makes step 2 safe: a cost check grouped by something other
 *      than skuPartNumber can't masquerade as a license-waste breakdown, and a
 *      map that survives is guaranteed to price to a real, non-zero figure.
 *
 * The chosen check key + field travel back with the counts so every surface can
 * state its provenance instead of presenting an unattributed number.
 *
 * NB: the latest-props query is re-implemented here rather than imported from
 * dashboard-resolvers.ts — dashboard-resolvers imports THIS module, and the
 * reverse import would close a cycle.
 */

import {
  db,
  monitorChecksTable,
  skuPriceReferenceTable,
  tenantMonitorProfilesTable,
} from "@workspace/db";
import { and, desc, eq, like } from "drizzle-orm";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "engine.dashboard" });

/** The registry's declared source for licensing.wasteEstimateBreakdown. */
export const DEFAULT_LICENSE_WASTE_CHECK_KEY = "cost:license-waste-estimate";

/**
 * Key-name tokens that mean "seats nobody is getting value from". A `cost:`
 * check has to name one of these to be considered a waste source, so a cost
 * check that inventories the full estate is never mistaken for waste.
 */
const WASTE_KEY_TOKENS = ["waste", "unused", "unassigned", "idle", "inactive", "orphan"];

export interface LicenseWasteCounts {
  /** monitor_checks.key the counts actually came from. */
  checkKey: string;
  /** extractedProperties field the SKU map was read out of. */
  field: string;
  /** { skuPartNumber: wastedSeatCount } — the input to computeSkuCostBreakdown. */
  counts: Record<string, number>;
  /** How many of the map's keys are real sku_price_reference SKUs. */
  pricedSkuCount: number;
  collectedAt: Date | null;
  /** True when the preferred (registry-declared) check key was NOT the one used. */
  fallback: boolean;
}

function toCount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Every `{ label: number }` map in a check's extractedProperties — plural, not
 * just the first one found. A check can legitimately carry several groupByCount
 * outputs (e.g. by SKU and by department); the caller decides which is the SKU
 * one by scoring against the real price catalog, rather than trusting key order.
 */
export function extractCountMaps(
  props: Record<string, unknown>,
): { field: string; counts: Record<string, number> }[] {
  const maps: { field: string; counts: Record<string, number> }[] = [];
  for (const [field, value] of Object.entries(props)) {
    // `_`/`__` prefixes are the executor's own reserved auto-keys (_itemCount)
    // and latestCheckProps' attachments (__rawResponse/__collectedAt/__status).
    if (field.startsWith("_")) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const counts: Record<string, number> = {};
    let found = false;
    for (const [label, raw] of Object.entries(value as Record<string, unknown>)) {
      const n = toCount(raw);
      if (n != null) {
        counts[label] = n;
        found = true;
      }
    }
    if (found) maps.push({ field, counts });
  }
  return maps;
}

/** Every SKU part number the platform can actually price (~35 rows). */
async function knownSkuPartNumbers(): Promise<Set<string>> {
  const rows = await db
    .select({ sku: skuPriceReferenceTable.skuPartNumber })
    .from(skuPriceReferenceTable);
  return new Set(rows.map((r) => r.sku).filter((s): s is string => typeof s === "string"));
}

/** Active `cost:` checks whose key names an unused/wasted-seat concept. */
async function costWasteCheckKeys(): Promise<string[]> {
  const rows = await db
    .select({ key: monitorChecksTable.key })
    .from(monitorChecksTable)
    .where(and(like(monitorChecksTable.key, "cost:%"), eq(monitorChecksTable.status, "active")));
  return rows
    .map((r) => r.key)
    .filter((k): k is string => typeof k === "string")
    .filter((k) => WASTE_KEY_TOKENS.some((t) => k.toLowerCase().includes(t)))
    .sort();
}

/** Latest extractedProperties + collectedAt for one (tenant, check). */
async function latestPropsFor(
  tenantId: string,
  checkKey: string,
): Promise<{ props: Record<string, unknown>; collectedAt: Date | null } | null> {
  const [row] = await db
    .select({
      extractedProperties: tenantMonitorProfilesTable.extractedProperties,
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
  return {
    props: (row.extractedProperties as Record<string, unknown> | null) ?? {},
    collectedAt: row.collectedAt ?? null,
  };
}

/**
 * Resolve the tenant's real per-SKU wasted-seat counts, or null when no cost
 * check has genuinely collected SKU-keyed seat data. Never guesses a count and
 * never widens into whole-estate licensing checks (see WASTE_KEY_TOKENS).
 */
export async function resolveLicenseWasteCounts(
  tenantId: string,
  preferredCheckKey: string = DEFAULT_LICENSE_WASTE_CHECK_KEY,
): Promise<LicenseWasteCounts | null> {
  const knownSkus = await knownSkuPartNumbers();
  if (knownSkus.size === 0) {
    // Nothing is priceable, so nothing could be reported as dollars anyway.
    log.warn({ tenantId }, "license-waste-source: sku_price_reference is empty — no SKU can be priced");
    return null;
  }

  const discovered = await costWasteCheckKeys().catch((err) => {
    log.warn({ err, tenantId }, "license-waste-source: cost-check discovery failed — preferred key only");
    return [] as string[];
  });
  const candidates = [preferredCheckKey, ...discovered.filter((k) => k !== preferredCheckKey)];

  for (const checkKey of candidates) {
    const latest = await latestPropsFor(tenantId, checkKey);
    if (!latest) continue;

    // Score every count map by how many of its keys are real, priceable SKUs;
    // a non-SKU grouping scores 0 and is rejected rather than priced as waste.
    let best: { field: string; counts: Record<string, number>; score: number } | null = null;
    for (const map of extractCountMaps(latest.props)) {
      const score = Object.keys(map.counts).filter((k) => knownSkus.has(k)).length;
      if (score > 0 && (best == null || score > best.score)) best = { ...map, score };
    }
    if (!best) continue;

    const fallback = checkKey !== preferredCheckKey;
    if (fallback) {
      log.info(
        { tenantId, checkKey, preferredCheckKey, field: best.field, pricedSkuCount: best.score },
        "license-waste-source: priced waste from a cost check other than the registry's declared sourceKey",
      );
    }
    return {
      checkKey,
      field: best.field,
      counts: best.counts,
      pricedSkuCount: best.score,
      collectedAt: latest.collectedAt,
      fallback,
    };
  }

  log.warn(
    { tenantId, candidates },
    "license-waste-source: no cost check has SKU-keyed seat data for this tenant",
  );
  return null;
}
