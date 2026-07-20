/**
 * msp-executive-data.ts
 *
 * Shared "book of business" data-gathering for MSP Executive Mode — the single
 * source of truth for the top-risk and top-opportunity tenant lists. Both the
 * GET /api/msp/executive route (which renders the two lists) and the Partner QBR
 * generator (which grounds an AI document on the same numbers) call
 * gatherExecutiveBook(), so the QBR can never drift from what the lists show.
 *
 * Reuses real, already-proven data — nothing is computed fresh here:
 *   - Risk ranking: the latest stored `health` engine score per customer from
 *     tenant_engine_snapshots (the same snapshots the customer-facing Executive
 *     Mode / Mission Control read). The raw score is a higher-is-worse risk sum,
 *     so the worst (highest) scores are the top risks; we also expose the same
 *     `100 - raw` goodness inversion the portal uses for display.
 *   - Opportunity ranking: the real Sales Offer Engine output (sales_offers) —
 *     open (draft/sent) offers, summed by their customer-facing adjusted price.
 *     We do NOT invent a new opportunity score. sales_offers.customerId is a
 *     users.id, so it's bridged back to msp_customers.id via msp_users (the same
 *     bridge omg-card-extractor.ts uses for billing attribution).
 *
 * Scoping: gatherExecutiveBook takes a pre-resolved scopedIds (from
 * resolveStaffScopedCustomerIds) and folds it into every query at the DB level,
 * exactly like msp-alerts.ts — a scoped MSPOperator never loads a customer
 * outside their assignment. `scopedIds === null` = unrestricted (whole book).
 */

import {
  db,
  mspCustomersTable,
  mspUsersTable,
  salesOffersTable,
  tenantEngineSnapshotsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { logger } from "./logger";

const log = logger.child({ channel: "engine.dashboard" });

const HEALTH_ENGINE_KEY = "health";
/** Open offers still represent unrealised opportunity; accepted/rejected/expired do not. */
const OPEN_OFFER_STATES = ["draft", "sent"] as const;
/** Matches the customer-facing Executive Mode red-ring threshold (goodness < 60). */
const AT_RISK_GOODNESS_THRESHOLD = 60;
const DEFAULT_TOP_N = 5;

export interface RiskTenant {
  customerId: number;
  name: string;
  /** Raw health-engine risk sum (higher = worse). */
  healthScore: number;
  /** 0–100, higher = healthier — the same 100−raw inversion the portal renders. */
  goodnessPercent: number;
  capturedAt: string | null;
}

export interface OpportunityTenant {
  customerId: number;
  name: string;
  openOfferCount: number;
  /** Summed customer-facing value of this tenant's open offers, in USD cents. */
  totalValueCents: number;
  /** Title of the single most valuable open offer, for a one-line label. */
  topOfferTitle: string | null;
  /** Highest relevance score across this tenant's open offers [0–100]. */
  topScore: number;
}

export interface ExecutiveBook {
  mspId: number;
  customerCount: number;
  topRisks: RiskTenant[];
  topOpportunities: OpportunityTenant[];
  rollup: {
    /** Average goodness across customers that have a health snapshot; null if none do. */
    avgGoodnessPercent: number | null;
    /** Customers whose goodness is below the at-risk threshold. */
    atRiskCount: number;
    /** Total open-offer value across the WHOLE book (not just the top N), in USD cents. */
    totalOpenOpportunityCents: number;
    /** Total open offers across the whole book. */
    openOfferCount: number;
  };
}

function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/**
 * Gather the risk + opportunity picture for one MSP's book, honouring staff
 * scoping. Read-only; never throws for an empty book (returns zeros).
 */
export async function gatherExecutiveBook(
  mspId: number,
  scopedIds: number[] | null,
  opts: { topN?: number } = {},
): Promise<ExecutiveBook> {
  const topN = opts.topN ?? DEFAULT_TOP_N;

  // ── The book of customers (scoped at the DB level) ──────────────────────────
  const customers = await db
    .select({ id: mspCustomersTable.id, name: mspCustomersTable.name })
    .from(mspCustomersTable)
    .where(
      scopedIds === null
        ? eq(mspCustomersTable.mspId, mspId)
        : and(eq(mspCustomersTable.mspId, mspId), inArray(mspCustomersTable.id, scopedIds)),
    );

  const nameById = new Map(customers.map((c) => [c.id, c.name]));
  const bookCustomerIds = customers.map((c) => c.id);

  const empty: ExecutiveBook = {
    mspId,
    customerCount: customers.length,
    topRisks: [],
    topOpportunities: [],
    rollup: { avgGoodnessPercent: null, atRiskCount: 0, totalOpenOpportunityCents: 0, openOfferCount: 0 },
  };
  if (bookCustomerIds.length === 0) return empty;

  // ── Risk: latest health snapshot per customer (one row per customer) ─────────
  // selectDistinctOn keyed on customerId, ordered so the newest capturedAt wins.
  const healthRows = await db
    .selectDistinctOn([tenantEngineSnapshotsTable.customerId], {
      customerId: tenantEngineSnapshotsTable.customerId,
      score: tenantEngineSnapshotsTable.score,
      capturedAt: tenantEngineSnapshotsTable.capturedAt,
    })
    .from(tenantEngineSnapshotsTable)
    .where(
      and(
        eq(tenantEngineSnapshotsTable.engineKey, HEALTH_ENGINE_KEY),
        inArray(tenantEngineSnapshotsTable.customerId, bookCustomerIds),
      ),
    )
    .orderBy(tenantEngineSnapshotsTable.customerId, desc(tenantEngineSnapshotsTable.capturedAt));

  const risks: RiskTenant[] = [];
  let goodnessSum = 0;
  let goodnessCount = 0;
  let atRiskCount = 0;
  for (const row of healthRows) {
    if (row.customerId === null) continue;
    const name = nameById.get(row.customerId);
    if (name === undefined) continue; // snapshot for a customer outside the scoped book
    const goodnessPercent = clampPercent(100 - row.score);
    goodnessSum += goodnessPercent;
    goodnessCount += 1;
    if (goodnessPercent < AT_RISK_GOODNESS_THRESHOLD) atRiskCount += 1;
    risks.push({
      customerId: row.customerId,
      name,
      healthScore: row.score,
      goodnessPercent,
      capturedAt: row.capturedAt ? row.capturedAt.toISOString() : null,
    });
  }
  // Worst first = highest raw risk score (lowest goodness).
  risks.sort((a, b) => b.healthScore - a.healthScore);
  const topRisks = risks.slice(0, topN);

  // ── Opportunity: open sales offers, bridged users.id → msp_customers.id ───────
  // Build the userId → msp_customers.id bridge, restricted to this MSP + book.
  const bridgeRows = await db
    .select({ userId: mspUsersTable.userId, customerId: mspUsersTable.customerId })
    .from(mspUsersTable)
    .where(and(eq(mspUsersTable.mspId, mspId), isNotNull(mspUsersTable.customerId)));

  const userIdToCustomerId = new Map<number, number>();
  for (const b of bridgeRows) {
    if (b.customerId !== null && nameById.has(b.customerId)) {
      userIdToCustomerId.set(b.userId, b.customerId);
    }
  }
  const offerUserIds = [...userIdToCustomerId.keys()];

  const opportunityByCustomer = new Map<number, OpportunityTenant>();
  // Parallel tracking of the value of each tenant's most-valuable single offer,
  // so topOfferTitle reflects the biggest open offer rather than the last-seen.
  const topOfferValueByCustomer = new Map<number, number>();
  let totalOpenOpportunityCents = 0;
  let totalOpenOfferCount = 0;

  if (offerUserIds.length > 0) {
    const offerRows = await db
      .select({
        customerUserId: salesOffersTable.customerId,
        title: salesOffersTable.title,
        adjustedPriceCents: salesOffersTable.adjustedPriceCents,
        basePriceCents: salesOffersTable.basePriceCents,
        score: salesOffersTable.score,
      })
      .from(salesOffersTable)
      .where(
        and(
          eq(salesOffersTable.mspId, mspId),
          inArray(salesOffersTable.state, [...OPEN_OFFER_STATES]),
          inArray(salesOffersTable.customerId, offerUserIds),
        ),
      );

    for (const offer of offerRows) {
      if (offer.customerUserId === null) continue;
      const customerId = userIdToCustomerId.get(offer.customerUserId);
      if (customerId === undefined) continue;
      const name = nameById.get(customerId);
      if (name === undefined) continue;
      // Prefer the engine-adjusted (customer-facing) price; fall back to base.
      const valueCents = offer.adjustedPriceCents > 0 ? offer.adjustedPriceCents : offer.basePriceCents;

      totalOpenOpportunityCents += valueCents;
      totalOpenOfferCount += 1;

      const existing = opportunityByCustomer.get(customerId);
      if (existing) {
        existing.openOfferCount += 1;
        existing.totalValueCents += valueCents;
        if (offer.score > existing.topScore) existing.topScore = offer.score;
        if (valueCents > (topOfferValueByCustomer.get(customerId) ?? 0)) {
          existing.topOfferTitle = offer.title;
          topOfferValueByCustomer.set(customerId, valueCents);
        }
      } else {
        opportunityByCustomer.set(customerId, {
          customerId,
          name,
          openOfferCount: 1,
          totalValueCents: valueCents,
          topOfferTitle: offer.title,
          topScore: offer.score,
        });
        topOfferValueByCustomer.set(customerId, valueCents);
      }
    }
  }

  const opportunities = [...opportunityByCustomer.values()].sort((a, b) => b.totalValueCents - a.totalValueCents);
  const topOpportunities = opportunities.slice(0, topN);

  log.debug(
    { mspId, customerCount: customers.length, riskCount: risks.length, opportunityCount: opportunities.length },
    "msp-executive-data: gathered book",
  );

  return {
    mspId,
    customerCount: customers.length,
    topRisks,
    topOpportunities,
    rollup: {
      avgGoodnessPercent: goodnessCount > 0 ? Math.round(goodnessSum / goodnessCount) : null,
      atRiskCount,
      totalOpenOpportunityCents,
      openOfferCount: totalOpenOfferCount,
    },
  };
}
