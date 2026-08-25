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
import { lookupSkuMonthlyPriceCents } from "./cost-engine.ts";
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
 * REMOVED in #441: a name-based preference for `cost:unused-unassigned-licenses`.
 *
 * When several active checks hit /subscribedSkus, this module used to try that
 * one first "so the provenance we report reads sensibly". Two things were wrong
 * with sorting provenance by how the name reads. First, this file's own header
 * establishes that the name is a lie — its mapping is `count(consumedUnits)`,
 * which counts SKU rows, not unused seats. Second, and what surfaced it: that
 * check was removed from the `assess:copilot-readiness` package on 2026-08-05,
 * so the scan no longer runs it — but `tenant_monitor_profiles` keeps the last
 * row per check forever, so it kept winning the preference and the Copilot
 * Readiness Report kept citing a retired check as the source of the tenant's
 * live licence figures, over an arbitrarily old stored Graph page.
 *
 * Candidates are now ordered by how recently each one's page was actually
 * collected, so the reported `checkKey` is the row the number genuinely came
 * from. An explicit `preferredCheckKey` argument is still honoured first — that
 * is a caller stating which check it means, not a guess from a string.
 */

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
  // Alphabetical only — a deterministic tiebreak, not a claim about which check
  // is the better source. Recency decides that (see resolveLicenseWasteCounts).
  return keys;
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

  // An explicit preferredCheckKey stays first; everything else is ordered by how
  // recently it was collected, newest first, so the reported provenance names
  // the row the figure genuinely came from rather than the nicest-sounding key
  // with any stored page at all (#441). Collected up front because the ordering
  // is a property of the whole candidate set, not of the first usable one.
  const withCollectedAt: { checkKey: string; latest: Awaited<ReturnType<typeof latestRawResponseFor>> }[] = [];
  for (const checkKey of candidates) {
    withCollectedAt.push({ checkKey, latest: await latestRawResponseFor(tenantId, checkKey) });
  }
  const ordered = withCollectedAt.sort((a, b) => {
    if (a.checkKey === preferredCheckKey) return -1;
    if (b.checkKey === preferredCheckKey) return 1;
    const at = a.latest?.collectedAt?.getTime() ?? -Infinity;
    const bt = b.latest?.collectedAt?.getTime() ?? -Infinity;
    // Equal (or both absent) timestamps fall back to the alphabetical order the
    // candidate list already carries, so two runs can never disagree.
    return bt - at;
  });

  for (const { checkKey, latest } of ordered) {
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

// ── Paid seats (#333) ─────────────────────────────────────────────────────────
//
// `totalEnabledSeats` and `lines[].unused` above count EVERY subscribed SKU,
// which is right for the question they were written for ("what did the estate
// look like") but wrong for any figure presented as a SEAT the tenant provisioned
// or PAID for.
//
// Microsoft reports free / viral / self-service SKUs through the same
// `/subscribedSkus` shape as purchased ones, with `prepaidUnits.enabled` set to a
// sentinel CAPACITY rather than a bought quantity — 1,000,000 for
// POWER_BI_STANDARD, 10,000 for FLOW_FREE and the viral trial SKUs, and so on.
// Nobody bought those seats and nobody is billed for the unassigned ones, so
// summing them produces a number that is not wrong by a few percent but by
// several orders of magnitude: a real tenant with three such SKUs and five active
// users reports 1,020,000 seats provisioned / 1,019,995 unassigned (#333).
//
// The authority on whether a seat was paid for is the same one the dollar figures
// already use: `sku_price_reference`. A SKU with no price row, or a row priced at
// zero, is not a paid seat — which is exactly why the waste total stayed silent
// on the tenant above while the two counts went to seven figures. Restricting the
// counts to the priced estate makes all three licensing numbers describe the SAME
// set of SKUs, instead of two of them describing an estate the third refuses to
// price.
//
// Excluded SKUs are returned, not silently dropped, so a caller (or a log line)
// can say WHAT was left out rather than presenting a quietly narrowed number.

/** Why a SKU's seats are not counted as paid. */
export type UnpaidSkuReason = "no_price_on_file" | "zero_price";

export interface PaidSeatFigures {
  /** Seats bought across SKUs with a known, non-zero price. */
  provisioned: number;
  /** Paid seats nobody is assigned to — the real recoverable figure. */
  unassigned: number;
  /** { skuPartNumber: unusedSeatCount } over priced SKUs only — what to price. */
  paidCounts: Record<string, number>;
  /** SKUs deliberately left out, with the capacity each was claiming. */
  excluded: { skuPartNumber: string; enabled: number; reason: UnpaidSkuReason }[];
}

/**
 * Pure: reduce per-SKU seat lines to the PAID estate, given each SKU's real
 * monthly price. `null` in the map means "no price on file" (the lookup's own
 * "never fabricate a price" answer); `0` means a row exists and says the SKU is
 * free. Both are excluded, and both are reported.
 *
 * Exported separately from the async resolver so the arithmetic is testable
 * without a database — the same split `unusedSeatsFromSubscribedSkus` uses.
 */
export function paidSeatFiguresFromLines(
  lines: readonly LicenseWasteCounts["lines"][number][],
  monthlyPriceCentsBySku: ReadonlyMap<string, number | null>,
): PaidSeatFigures {
  const paidCounts: Record<string, number> = {};
  const excluded: PaidSeatFigures["excluded"] = [];
  let provisioned = 0;
  let unassigned = 0;

  for (const line of lines) {
    const price = monthlyPriceCentsBySku.get(line.skuPartNumber) ?? null;
    if (price == null || price <= 0) {
      excluded.push({
        skuPartNumber: line.skuPartNumber,
        enabled: line.enabled,
        reason: price == null ? "no_price_on_file" : "zero_price",
      });
      continue;
    }
    provisioned += line.enabled;
    unassigned += line.unused;
    if (line.unused > 0) paidCounts[line.skuPartNumber] = (paidCounts[line.skuPartNumber] ?? 0) + line.unused;
  }

  return { provisioned, unassigned, paidCounts, excluded };
}

/**
 * The tenant's real PAID seat figures, or null when no SKU on the stored page
 * has a price on file at all — in which case there is no honest seat count to
 * show, and a caller must omit the figure rather than fall back to the
 * every-SKU total that produced #333.
 */
export async function resolvePaidSeatFigures(
  tenantId: string,
): Promise<(PaidSeatFigures & { checkKey: string; collectedAt: Date | null }) | null> {
  const waste = await resolveLicenseWasteCounts(tenantId);
  if (!waste) return null;

  const priceBySku = new Map<string, number | null>();
  for (const line of waste.lines) {
    if (priceBySku.has(line.skuPartNumber)) continue;
    const { priceCents } = await lookupSkuMonthlyPriceCents({ skuPartNumber: line.skuPartNumber });
    priceBySku.set(line.skuPartNumber, priceCents);
  }

  const figures = paidSeatFiguresFromLines(waste.lines, priceBySku);
  if (figures.excluded.length > 0) {
    log.info(
      {
        tenantId,
        checkKey: waste.checkKey,
        excluded: figures.excluded,
        paidProvisioned: figures.provisioned,
      },
      "license-waste-source: unpriced/free SKUs excluded from the paid seat counts",
    );
  }

  // Every SKU unpriced → we know nothing about what this tenant pays for.
  if (figures.provisioned === 0 && Object.keys(figures.paidCounts).length === 0) {
    log.warn(
      { tenantId, checkKey: waste.checkKey, skusInspected: waste.lines.length },
      "license-waste-source: no subscribed SKU has a price on file — paid seat counts cannot be sourced",
    );
    return null;
  }

  return { ...figures, checkKey: waste.checkKey, collectedAt: waste.collectedAt };
}

// ── Per-SKU ledger (Git #1230) ─────────────────────────────────────────────────
//
// The Licensing pillar dashboard's per-SKU table needs real purchased / assigned
// / unassigned counts and real dollar figures, one row per SKU — not the
// aggregate `PaidSeatFigures` totals above. This is the same PAID estate those
// totals already restrict to (a free/unpriced SKU is excluded here too, for the
// same #333 reason: an unpriced SKU's "unassigned" count is not a dollar the
// tenant is failing to recover), just kept at row granularity instead of summed.
//
// What this deliberately does NOT attempt: which of a SKU's unassigned/idle
// seats are recoverable TODAY versus only AT RENEWAL. That split needs the
// SKU's billing commitment term (monthly vs. annual), which is not a field
// Microsoft returns on `/subscribedSkus` and is not stored anywhere in this
// platform's schema today. It also does not attempt an "active" (in-use) count
// distinct from "assigned" — that needs a usage-report check
// (getOffice365ActiveUserDetail / getMicrosoft365CopilotUsageUserDetail /
// getM365AppUserDetail), and no such check's output is stored per-user in a
// place this resolver can join against. Both gaps are real product work, not
// this function's job to paper over with a guess.

export interface LicenseSkuLedgerRow {
  skuPartNumber: string;
  displayName: string;
  /** `prepaidUnits.enabled` — seats bought. */
  purchased: number;
  /** `consumedUnits` — seats assigned to someone. */
  assigned: number;
  /** purchased − assigned, floored at zero — assigned to nobody. */
  unassigned: number;
  unitMonthlyPriceCents: number;
  /** unassigned * unitMonthlyPriceCents. Zero when every seat is assigned. */
  monthlyWasteCents: number;
  annualWasteCents: number;
}

export interface LicenseSkuLedger {
  rows: LicenseSkuLedgerRow[];
  totalPurchased: number;
  totalAssigned: number;
  totalUnassigned: number;
  totalMonthlyWasteCents: number;
  totalAnnualWasteCents: number;
  /** SKUs left out because no price is on file, or the row prices at $0. */
  excluded: { skuPartNumber: string; purchased: number; reason: UnpaidSkuReason }[];
  checkKey: string;
  collectedAt: Date | null;
}

/**
 * Pure: build ledger rows from real per-SKU lines and a price map, mirroring
 * `paidSeatFiguresFromLines`'s exclusion rule exactly so the two never disagree
 * about which SKUs count as "paid". Exported separately so the row-building
 * arithmetic is unit-tested without a database.
 */
export function licenseSkuLedgerRowsFromLines(
  lines: readonly LicenseWasteCounts["lines"][number][],
  monthlyPriceCentsBySku: ReadonlyMap<string, number | null>,
  displayNameBySku: ReadonlyMap<string, string>,
): { rows: LicenseSkuLedgerRow[]; excluded: LicenseSkuLedger["excluded"] } {
  const rows: LicenseSkuLedgerRow[] = [];
  const excluded: LicenseSkuLedger["excluded"] = [];

  for (const line of lines) {
    const price = monthlyPriceCentsBySku.get(line.skuPartNumber) ?? null;
    if (price == null || price <= 0) {
      excluded.push({
        skuPartNumber: line.skuPartNumber,
        purchased: line.enabled,
        reason: price == null ? "no_price_on_file" : "zero_price",
      });
      continue;
    }
    rows.push({
      skuPartNumber: line.skuPartNumber,
      displayName: displayNameBySku.get(line.skuPartNumber) ?? line.skuPartNumber,
      purchased: line.enabled,
      assigned: line.consumed,
      unassigned: line.unused,
      unitMonthlyPriceCents: price,
      monthlyWasteCents: line.unused * price,
      annualWasteCents: line.unused * price * 12,
    });
  }

  // Money at the top, same ordering rule `computeSkuCostBreakdown`'s callers
  // already apply — the highest-waste SKU is the one worth reading first.
  rows.sort((a, b) => b.monthlyWasteCents - a.monthlyWasteCents);
  return { rows, excluded };
}

/**
 * The tenant's real per-SKU ledger, restricted to the priced estate, or null
 * when no /subscribedSkus check has a complete stored response for this tenant
 * at all (the same "nothing to source from" case `resolveLicenseWasteCounts`
 * itself returns null for). Unlike `resolvePaidSeatFigures`, an ALL-unpriced
 * result still returns an empty-rows ledger rather than null — an empty table
 * with its `excluded` list populated is a more honest UI than hiding the whole
 * section, since the caller can say exactly which SKUs it could not price.
 */
export async function resolveLicenseSkuLedger(tenantId: string): Promise<LicenseSkuLedger | null> {
  const waste = await resolveLicenseWasteCounts(tenantId);
  if (!waste) return null;

  const priceBySku = new Map<string, number | null>();
  const nameBySku = new Map<string, string>();
  for (const line of waste.lines) {
    if (priceBySku.has(line.skuPartNumber)) continue;
    const { priceCents, displayName } = await lookupSkuMonthlyPriceCents({
      skuPartNumber: line.skuPartNumber,
    });
    priceBySku.set(line.skuPartNumber, priceCents);
    nameBySku.set(line.skuPartNumber, displayName);
  }

  const { rows, excluded } = licenseSkuLedgerRowsFromLines(waste.lines, priceBySku, nameBySku);
  if (excluded.length > 0) {
    log.info(
      { tenantId, checkKey: waste.checkKey, excluded },
      "license-waste-source: unpriced/free SKUs excluded from the per-SKU ledger",
    );
  }

  return {
    rows,
    totalPurchased: rows.reduce((s, r) => s + r.purchased, 0),
    totalAssigned: rows.reduce((s, r) => s + r.assigned, 0),
    totalUnassigned: rows.reduce((s, r) => s + r.unassigned, 0),
    totalMonthlyWasteCents: rows.reduce((s, r) => s + r.monthlyWasteCents, 0),
    totalAnnualWasteCents: rows.reduce((s, r) => s + r.annualWasteCents, 0),
    excluded,
    checkKey: waste.checkKey,
    collectedAt: waste.collectedAt,
  };
}
