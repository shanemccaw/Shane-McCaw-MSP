/**
 * lead-offer-engine.ts
 *
 * Converts quiz category scores (confidence-weighted inferred signals) + product
 * catalog into priced, scored candidate offers for pre-customer leads, via the
 * same configurable-rule-group shape as sales-offer-engine.ts — but standalone.
 *
 * This file has ZERO code coupling to sales-offer-engine.ts by design: leads are
 * scored from inferred, confidence-weighted signals (quiz answers), not fired
 * telemetry, so idempotency keys, rationale copy, and confidence handling must
 * never collide with or borrow from the real-signal engine.
 *
 * Core invariants:
 *  - Pricing always reads from servicesTable (the Product Catalog), never a
 *    separate hardcoded price table.
 *  - computeLeadOfferEngine is pure and deterministic given identical inputs.
 *  - Idempotency keys are namespaced ("lead:" prefix) so they can never collide
 *    with sales-offer-engine's idempotency keys, even by coincidence.
 */

import { db, leadOfferInferenceRulesTable, type LeadOfferRuleGroup } from "@workspace/db";
import { eq, and, isNull, or, sql } from "drizzle-orm";
import { createHash } from "crypto";
import { logger } from "./logger";
const log = logger.child({ channel: "engine.offer" });

// ── Types ───────────────────────────────────────────────────────────────────

export interface LeadOfferCandidate {
  serviceId: number;
  serviceName: string;
  title: string;
  rationale: string;
  inferredSignalKeys: string[];
  avgConfidence: number;
  bundledOfferIds: number[];
  basePriceCents: number;
  adjustedPriceCents: number;
  score: number;
  expirationDays: number;
  idempotencyKey: string;
}

export interface LeadOfferEngineOutput {
  engine: "lead_offer";
  leadId: number;
  inferredSignals: { signalKey: string; confidence: number }[];
  candidates: LeadOfferCandidate[];
  timestamp: string;
}

// ── Signal inference ─────────────────────────────────────────────────────────

/**
 * Translates quiz category scores into confidence-weighted inferred signals by
 * evaluating active leadOfferInferenceRulesTable rows against the score. When
 * multiple satisfied rules produce the same signal key, the highest confidence
 * value wins.
 */
export async function inferSignalsFromQuizScores(
  categoryScores: Record<string, number>,
  mspId: number | null,
): Promise<Map<string, number>> {
  const rules = await db
    .select()
    .from(leadOfferInferenceRulesTable)
    .where(
      and(
        eq(leadOfferInferenceRulesTable.isActive, true),
        mspId != null
          ? or(eq(leadOfferInferenceRulesTable.mspId, mspId), isNull(leadOfferInferenceRulesTable.mspId))
          : isNull(leadOfferInferenceRulesTable.mspId),
      ),
    )
    .orderBy(sql`${leadOfferInferenceRulesTable.mspId} NULLS LAST`);

  const inferredSignals = new Map<string, number>();

  for (const rule of rules) {
    const score = categoryScores[rule.quizCategorySlug];
    if (score === undefined) continue;

    const threshold = Number(rule.scoreThreshold);
    const satisfied = rule.scoreOperator === "lt" ? score < threshold : score > threshold;
    if (!satisfied) continue;

    const confidence = Number(rule.confidence);
    const existing = inferredSignals.get(rule.inferredSignalKey);
    if (existing === undefined || confidence > existing) {
      inferredSignals.set(rule.inferredSignalKey, confidence);
    }
  }

  log.debug(
    { mspId, ruleCount: rules.length, inferredCount: inferredSignals.size },
    "lead-offer-engine: inferred signals from quiz scores",
  );

  return inferredSignals;
}

// ── Pure engine function ─────────────────────────────────────────────────────

/**
 * computeLeadOfferEngine — pure function, no DB writes.
 *
 * Given confidence-weighted inferred signals, the rule groups, product catalog
 * entries, and engine config, produces a ranked list of offer candidates.
 */
export function computeLeadOfferEngine(
  leadId: number,
  inferredSignals: Map<string, number>,
  ruleGroups: LeadOfferRuleGroup[],
  services: Array<{ id: number; name: string; price: string | null; basePrice: string | null }>,
  config: { minScore: number; maxCandidates: number; defaultExpirationDays: number; bundlingThreshold: number },
): LeadOfferEngineOutput {
  const inferredSignalKeyArray = [...inferredSignals.keys()];
  const serviceMap = new Map(services.map(s => [s.id, s]));

  // Index rule groups by type
  const byType = (type: string) => ruleGroups.filter(g => g.ruleType === type);

  const eligibilityGroups = byType("eligibility");
  const pricingGroups = byType("pricing");
  const scoringGroups = byType("scoring");
  const bundlingGroups = byType("bundling");
  const expirationGroups = byType("expiration");

  // Collect eligible service IDs — those where at least one eligibility rule group fires
  const eligibleServiceIds = new Set<number>();
  for (const group of eligibilityGroups) {
    if (group.serviceId == null) continue;
    const fires = leadGroupFires(group, inferredSignals);
    if (fires) eligibleServiceIds.add(group.serviceId);
  }

  const candidates: LeadOfferCandidate[] = [];

  for (const serviceId of eligibleServiceIds) {
    const service = serviceMap.get(serviceId);
    if (!service) continue;

    const basePriceCents = priceToCentsLead(service.basePrice ?? service.price);
    const inferredForService = inferredSignalKeyArray.filter(sig =>
      eligibilityGroups.some(g => g.serviceId === serviceId && g.requiredSignalKeys.includes(sig)),
    );
    const avgConfidence =
      inferredForService.length === 0
        ? 0
        : inferredForService.reduce((sum, sig) => sum + (inferredSignals.get(sig) ?? 0), 0) / inferredForService.length;

    // ── Pricing adjustment ────────────────────────────────────────────────
    let totalAdjPct = 0;
    for (const pg of pricingGroups) {
      if (pg.serviceId != null && pg.serviceId !== serviceId) continue;
      if (leadGroupFires(pg, inferredSignals)) totalAdjPct += pg.pricingAdjustmentPct;
    }
    const adjustedPriceCents = Math.max(0, Math.round(basePriceCents * (1 + totalAdjPct / 100)));

    // ── Scoring ────────────────────────────────────────────────────────────
    let score = 0;
    for (const sg of scoringGroups) {
      if (sg.serviceId != null && sg.serviceId !== serviceId) continue;
      if (leadGroupFires(sg, inferredSignals)) score += sg.scoreContribution;
    }
    score = Math.min(100, Math.max(0, score));

    // ── Bundling ───────────────────────────────────────────────────────────
    const bundledServiceIds: number[] = [];
    for (const bg of bundlingGroups) {
      if (bg.serviceId != null && bg.serviceId !== serviceId) continue;
      if (leadGroupFires(bg, inferredSignals) && inferredSignalKeyArray.length >= config.bundlingThreshold) {
        bundledServiceIds.push(...bg.bundleWithServiceIds);
      }
    }
    const bundledOfferIds: number[] = [...new Set(bundledServiceIds)].filter(id => id !== serviceId);

    // ── Expiration ─────────────────────────────────────────────────────────
    let expirationDays = config.defaultExpirationDays;
    for (const eg of expirationGroups) {
      if (eg.serviceId != null && eg.serviceId !== serviceId) continue;
      if (leadGroupFires(eg, inferredSignals) && eg.expirationDays > 0) expirationDays = eg.expirationDays;
    }

    if (score < config.minScore) continue;

    const idempotencyKey = buildLeadIdempotencyKey(leadId, serviceId, inferredSignalKeyArray);

    candidates.push({
      serviceId,
      serviceName: service.name,
      title: `${service.name} — a possible fit based on your quiz`,
      rationale: buildLeadRationale(inferredForService),
      inferredSignalKeys: inferredForService,
      avgConfidence,
      bundledOfferIds,
      basePriceCents,
      adjustedPriceCents,
      score,
      expirationDays,
      idempotencyKey,
    });
  }

  // Sort by score descending, cap at maxCandidates
  candidates.sort((a, b) => b.score - a.score);
  const capped = config.maxCandidates > 0 ? candidates.slice(0, config.maxCandidates) : candidates;

  return {
    engine: "lead_offer",
    leadId,
    inferredSignals: inferredSignalKeyArray.map(signalKey => ({
      signalKey,
      confidence: inferredSignals.get(signalKey) ?? 0,
    })),
    candidates: capped,
    timestamp: new Date().toISOString(),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function leadGroupFires(
  group: { requiredSignalKeys: string[]; logic: string; minConfidence: string },
  inferredSignals: Map<string, number>,
): boolean {
  const required = group.requiredSignalKeys;
  if (required.length === 0) return true;
  const meetsConfidence = (k: string) => (inferredSignals.get(k) ?? 0) >= Number(group.minConfidence);
  if (group.logic === "AND") return required.every(meetsConfidence);
  return required.some(meetsConfidence);
}

function priceToCentsLead(price: string | null | undefined): number {
  if (!price) return 0;
  const n = parseFloat(price);
  return isNaN(n) ? 0 : Math.round(n * 100);
}

function buildLeadIdempotencyKey(leadId: number, serviceId: number, signals: string[]): string {
  const sorted = [...signals].sort().join(",");
  return createHash("sha256").update(`lead:${leadId}:${serviceId}:${sorted}`).digest("hex").slice(0, 32);
}

function buildLeadRationale(inferredSignalKeys: string[]): string {
  if (inferredSignalKeys.length === 0) {
    return "Based on your quiz answers, this may be a good fit for your environment.";
  }
  return `Based on your quiz answers, this may address a gap in your environment related to: ${inferredSignalKeys.join(", ")}.`;
}
