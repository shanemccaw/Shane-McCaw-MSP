/**
 * sales-offer-engine.ts
 *
 * Converts diagnostics findings (fired signals + product catalog) into priced,
 * scored candidate offers via configurable rule groups — no hardcoded formulas.
 *
 * Core invariants:
 *  - Pricing always reads from servicesTable (the Product Catalog), never a
 *    separate hardcoded price table.
 *  - The engine is pure and deterministic given identical inputs.
 *  - Idempotency keys prevent duplicate offer rows for the same signal set.
 */

import { db } from "@workspace/db";
import {
  salesOffersTable,
  salesOfferEventsTable,
  salesOfferConfigTable,
  salesOfferRuleGroupsTable,
  servicesTable,
  mspUsersTable,
  type SalesOffer,
  type SalesOfferRuleGroup,
  type SalesOfferConfig,
  type SalesOfferState,
} from "@workspace/db";
import { eq, and, inArray, isNull, or, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { createHash } from "crypto";
import { logger } from "./logger";
const log = logger.child({ channel: "engine.offer" });
import { buildTenantProfileAndFindings, fetchSignalRulesAndGroups } from "./priority-engine";
import { computeTenantSignals, getDisabledSignalKeys } from "./tenant-signals";
import { createNotification } from "./notification-center";

// ── Types ───────────────────────────────────────────────────────────────────

export interface SalesOfferCandidate {
  serviceId: number;
  serviceName: string;
  title: string;
  rationale: string;
  firedSignalKeys: string[];
  bundledOfferIds: number[];
  basePriceCents: number;
  adjustedPriceCents: number;
  score: number;
  expirationDays: number;
  idempotencyKey: string;
}

export interface SalesOfferEngineOutput {
  engine: "sales_offer";
  customerId: number | null;
  firedSignals: string[];
  candidates: SalesOfferCandidate[];
  config: Pick<SalesOfferConfig, "minScore" | "maxOffersPerGenerate" | "defaultExpirationDays" | "bundlingThreshold">;
  timestamp: string;
}

// ── Config loader ────────────────────────────────────────────────────────────

export async function loadSalesOfferConfig(mspId: number | null): Promise<SalesOfferConfig> {
  const defaults: SalesOfferConfig = {
    id: 0,
    mspId: null,
    scoringWeights: {},
    minScore: 40,
    maxOffersPerGenerate: 5,
    defaultExpirationDays: 30,
    bundlingThreshold: 2,
    extra: {},
    updatedAt: new Date(),
  };

  const rows = await db
    .select()
    .from(salesOfferConfigTable)
    .where(
      mspId != null
        ? or(eq(salesOfferConfigTable.mspId, mspId), isNull(salesOfferConfigTable.mspId))
        : isNull(salesOfferConfigTable.mspId),
    )
    .orderBy(desc(salesOfferConfigTable.mspId));

  if (rows.length === 0) return defaults;
  const mspRow = mspId != null ? rows.find(r => r.mspId === mspId) : null;
  return mspRow ?? rows[0] ?? defaults;
}

// ── Rule group loader ────────────────────────────────────────────────────────

export async function loadSalesOfferRuleGroups(): Promise<SalesOfferRuleGroup[]> {
  return db.select().from(salesOfferRuleGroupsTable).where(eq(salesOfferRuleGroupsTable.isActive, true));
}

// ── Pure engine function ─────────────────────────────────────────────────────

/**
 * computeSalesOfferEngine — pure function, no DB writes.
 *
 * Given a set of fired signals, the rule groups, product catalog entries,
 * and engine config, produces a ranked list of offer candidates.
 */
export function computeSalesOfferEngine(
  customerId: number | null,
  firedSignals: Set<string>,
  ruleGroups: SalesOfferRuleGroup[],
  services: Array<{ id: number; name: string; price: string | null; basePrice: string | null }>,
  config: Pick<SalesOfferConfig, "minScore" | "maxOffersPerGenerate" | "defaultExpirationDays" | "bundlingThreshold">,
  ctx?: { evaluationTimestamp?: Date },
): SalesOfferEngineOutput {
  const firedSignalArray = [...firedSignals];
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
    const fired = groupFires(group, firedSignals);
    if (fired) eligibleServiceIds.add(group.serviceId);
  }

  const candidates: SalesOfferCandidate[] = [];

  for (const serviceId of eligibleServiceIds) {
    const service = serviceMap.get(serviceId);
    if (!service) continue;

    const basePriceCents = priceToCents(service.basePrice ?? service.price);
    const firedForService = firedSignalArray.filter(sig =>
      eligibilityGroups.some(g => g.serviceId === serviceId && g.requiredSignalKeys.includes(sig)),
    );

    // ── Pricing adjustment ────────────────────────────────────────────────
    let totalAdjPct = 0;
    for (const pg of pricingGroups) {
      if (pg.serviceId != null && pg.serviceId !== serviceId) continue;
      if (groupFires(pg, firedSignals)) totalAdjPct += pg.pricingAdjustmentPct;
    }
    const adjustedPriceCents = Math.max(0, Math.round(basePriceCents * (1 + totalAdjPct / 100)));

    // ── Scoring ────────────────────────────────────────────────────────────
    let score = 0;
    for (const sg of scoringGroups) {
      if (sg.serviceId != null && sg.serviceId !== serviceId) continue;
      if (groupFires(sg, firedSignals)) score += sg.scoreContribution;
    }
    score = Math.min(100, Math.max(0, score));

    // ── Bundling ───────────────────────────────────────────────────────────
    const bundledServiceIds: number[] = [];
    for (const bg of bundlingGroups) {
      if (bg.serviceId != null && bg.serviceId !== serviceId) continue;
      if (groupFires(bg, firedSignals) && firedSignalArray.length >= config.bundlingThreshold) {
        bundledServiceIds.push(...bg.bundleWithServiceIds);
      }
    }
    const bundledOfferIds: number[] = [...new Set(bundledServiceIds)].filter(id => id !== serviceId);

    // ── Expiration ─────────────────────────────────────────────────────────
    let expirationDays = config.defaultExpirationDays;
    for (const eg of expirationGroups) {
      if (eg.serviceId != null && eg.serviceId !== serviceId) continue;
      if (groupFires(eg, firedSignals) && eg.expirationDays > 0) expirationDays = eg.expirationDays;
    }

    if (score < config.minScore) continue;

    const idempotencyKey = buildIdempotencyKey(customerId, serviceId, firedSignalArray);

    candidates.push({
      serviceId,
      serviceName: service.name,
      title: `${service.name} — recommended for your environment`,
      rationale: buildRationale(firedForService),
      firedSignalKeys: firedForService,
      bundledOfferIds,
      basePriceCents,
      adjustedPriceCents,
      score,
      expirationDays,
      idempotencyKey,
    });
  }

  // Sort by score descending, cap at maxOffersPerGenerate
  candidates.sort((a, b) => b.score - a.score);
  const capped = config.maxOffersPerGenerate > 0 ? candidates.slice(0, config.maxOffersPerGenerate) : candidates;

  return {
    engine: "sales_offer",
    customerId,
    firedSignals: firedSignalArray,
    candidates: capped,
    config,
    timestamp: (ctx?.evaluationTimestamp || new Date()).toISOString(),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupFires(group: SalesOfferRuleGroup, firedSignals: Set<string>): boolean {
  const required = group.requiredSignalKeys;
  if (required.length === 0) return true;
  if (group.logic === "AND") return required.every(k => firedSignals.has(k));
  return required.some(k => firedSignals.has(k));
}

function priceToCents(price: string | null | undefined): number {
  if (!price) return 0;
  const n = parseFloat(price);
  return isNaN(n) ? 0 : Math.round(n * 100);
}

function buildIdempotencyKey(customerId: number | null, serviceId: number, signals: string[]): string {
  const sorted = [...signals].sort().join(",");
  return createHash("sha256").update(`${customerId}:${serviceId}:${sorted}`).digest("hex").slice(0, 32);
}

function buildRationale(firedSignals: string[]): string {
  if (firedSignals.length === 0) return "This offering matches your environment profile.";
  return `Triggered by signals: ${firedSignals.join(", ")}.`;
}

// ── Tenant-scoped runner (async, reads DB) ────────────────────────────────────

export async function runSalesOfferEngineForTenant(
  customerId: number,
  mspId: number | null = null,
  ctx?: { evaluationTimestamp?: Date },
): Promise<SalesOfferEngineOutput> {
  const [{ mergedProfile, findings, customerId: fetchedCustomerId, mspId: resolvedMspId }, { rules, groups }, disabledSignalKeys, ruleGroups, services, config] =
    await Promise.all([
      buildTenantProfileAndFindings(customerId),
      fetchSignalRulesAndGroups(),
      getDisabledSignalKeys(),
      loadSalesOfferRuleGroups(),
      db.select({ id: servicesTable.id, name: servicesTable.name, price: servicesTable.price, basePrice: servicesTable.basePrice }).from(servicesTable),
      loadSalesOfferConfig(mspId),
    ]);

  const { firedSignals } = computeTenantSignals(
    mergedProfile,
    findings,
    rules,
    groups,
    disabledSignalKeys,
    fetchedCustomerId != null && resolvedMspId != null ? { customerId: fetchedCustomerId, mspId: resolvedMspId } : undefined,
  );

  return computeSalesOfferEngine(customerId, firedSignals, ruleGroups, services, config, ctx);
}

// ── Offer persistence ─────────────────────────────────────────────────────────

/**
 * Resolve the active portal user (usersTable.id) for an engine customerId
 * (mspCustomersTable.id) via the msp_users bridge. Mirrors the resolution the
 * admin-engines routes use for the same testbed→portal-user mapping. Returns
 * null when the customer has no active portal user to notify.
 */
async function resolveCustomerPortalUserId(customerId: number): Promise<number | null> {
  const [row] = await db
    .select({ userId: mspUsersTable.userId })
    .from(mspUsersTable)
    .where(and(eq(mspUsersTable.customerId, customerId), eq(mspUsersTable.isActive, true)))
    .limit(1);
  return row?.userId ?? null;
}

/**
 * Persist generated candidates as draft sales_offers rows.
 * Idempotent — skips offers whose idempotencyKey already exists.
 * Returns array of inserted (new) offer IDs.
 *
 * Side effect: for each *newly inserted* offer, notify the customer's portal
 * user via the Notification Center (category "offer", deep-linked to the
 * customer offers page). Idempotency is inherited from the insert itself — a
 * re-run produces the same idempotencyKey, the offer insert is skipped, so this
 * block never re-enters for the same offer and no duplicate notification fires.
 * This is the same new-row-only guard that gates the offer.generated event.
 */
export async function persistSalesOfferCandidates(
  candidates: SalesOfferCandidate[],
  customerId: number | null,
  mspId: number | null,
  engineSnapshot: Record<string, unknown>,
): Promise<number[]> {
  const inserted: number[] = [];

  // Resolve the notification recipient once for this customer. Null when there
  // is no active portal user (e.g. an unclaimed customer) — offers still
  // persist; they're just not pushed to a bell that no one is watching.
  const recipientUserId =
    customerId != null ? await resolveCustomerPortalUserId(customerId) : null;

  for (const c of candidates) {
    try {
      const result = await db
        .insert(salesOffersTable)
        .values({
          customerId,
          serviceId: c.serviceId,
          mspId,
          title: c.title,
          rationale: c.rationale,
          firedSignalKeys: c.firedSignalKeys,
          bundledOfferIds: c.bundledOfferIds,
          basePriceCents: c.basePriceCents,
          adjustedPriceCents: c.adjustedPriceCents,
          score: c.score,
          state: "draft" as SalesOfferState,
          idempotencyKey: c.idempotencyKey,
          engineSnapshot,
        })
        .onConflictDoNothing({ target: salesOffersTable.idempotencyKey })
        .returning({ id: salesOffersTable.id });

      if (result.length > 0 && result[0]) {
        const offerId = result[0].id;
        inserted.push(offerId);
        await emitOfferEvent(offerId, "offer.generated", { candidate: c }, null);

        // Notify the customer that a new offer is available. Non-fatal:
        // createNotification swallows its own errors and returns null, and the
        // offer has already been persisted regardless.
        if (recipientUserId != null) {
          await createNotification({
            title: "New offer available",
            body: `New offer: ${c.title}`,
            category: "offer",
            severity: "info",
            linkPath: "/customer-offers",
            feedType: "personal",
            notifType: "general",
            recipient: { type: "customer_user", userId: recipientUserId },
            ...(mspId != null ? { mspId } : {}),
          });
          log.info(
            { offerId, customerId, recipientUserId },
            "sales-offer-engine: notified customer of new offer",
          );
        } else if (customerId != null) {
          log.debug(
            { offerId, customerId },
            "sales-offer-engine: no active portal user for customer — offer notification skipped",
          );
        }
      }
    } catch (err) {
      log.error({ err, idempotencyKey: c.idempotencyKey }, "sales-offer-engine: failed to persist candidate");
    }
  }

  return inserted;
}

// ── Event emission ────────────────────────────────────────────────────────────

export async function emitOfferEvent(
  offerId: number,
  eventName: string,
  payload: Record<string, unknown>,
  actorUserId: number | null,
  idempotencyKey?: string,
): Promise<{ alreadyExisted: boolean }> {
  if (idempotencyKey) {
    const [existing] = await db
      .select({ id: salesOfferEventsTable.id })
      .from(salesOfferEventsTable)
      .where(eq(salesOfferEventsTable.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existing) return { alreadyExisted: true };
  }
  await db.insert(salesOfferEventsTable).values({
    offerId,
    eventName,
    payload: { offerId, eventName, ...payload },
    actorUserId,
    idempotencyKey: idempotencyKey ?? null,
  });
  return { alreadyExisted: false };
}

// ── State transition ─────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<SalesOfferState, SalesOfferState[]> = {
  draft:    ["sent", "expired"],
  sent:     ["accepted", "rejected", "expired"],
  accepted: [],
  rejected: [],
  expired:  [],
};

export async function transitionOfferState(
  offerId: number,
  newState: SalesOfferState,
  actorUserId: number | null,
  opts: { rejectionReason?: string } = {},
): Promise<SalesOffer> {
  const [existing] = await db.select().from(salesOffersTable).where(eq(salesOffersTable.id, offerId)).limit(1);
  if (!existing) throw new Error(`Sales offer ${offerId} not found`);

  const allowed = VALID_TRANSITIONS[existing.state as SalesOfferState] ?? [];
  if (!allowed.includes(newState)) {
    throw new Error(`Invalid transition: ${existing.state} → ${newState}`);
  }

  const now = new Date();
  const updates: Partial<typeof salesOffersTable.$inferInsert> = { state: newState, updatedAt: now };

  if (newState === "sent") {
    const config = await loadSalesOfferConfig(existing.mspId);
    const days = config.defaultExpirationDays;
    updates.sentAt = now;
    if (days > 0) {
      const exp = new Date(now);
      exp.setDate(exp.getDate() + days);
      updates.expiresAt = exp;
    }
  } else if (newState === "accepted") {
    updates.acceptedAt = now;
  } else if (newState === "rejected" || newState === "expired") {
    updates.closedAt = now;
    if (opts.rejectionReason) updates.rejectionReason = opts.rejectionReason;
  }

  const [updated] = await db.update(salesOffersTable).set(updates).where(eq(salesOffersTable.id, offerId)).returning();
  if (!updated) throw new Error(`Failed to update offer ${offerId}`);

  const eventName = `offer.${newState}` as const;
  await emitOfferEvent(offerId, eventName, { previousState: existing.state, newState, ...opts }, actorUserId);

  return updated;
}

// ── Expiration sweep ─────────────────────────────────────────────────────────

/**
 * Mark sent offers whose expiresAt has passed as expired.
 * Safe to call on a schedule — all updates are idempotent.
 *
 * @param mspId When provided, scopes the sweep to that MSP's offers only.
 *   When omitted, sweeps every MSP's overdue offers platform-wide — this
 *   unscoped mode is intended solely for the platform-admin sweep route.
 */
export async function expireStaleSalesOffers(mspId?: number): Promise<number> {
  const conditions = [
    eq(salesOffersTable.state, "sent"),
    sql`expires_at IS NOT NULL AND expires_at < NOW()`,
  ];
  if (mspId != null) conditions.push(eq(salesOffersTable.mspId, mspId));

  const rows = await db
    .update(salesOffersTable)
    .set({ state: "expired", closedAt: new Date(), updatedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: salesOffersTable.id });

  for (const row of rows) {
    await emitOfferEvent(row.id, "offer.expired", { reason: "TTL exceeded" }, null).catch(() => undefined);
  }

  return rows.length;
}
