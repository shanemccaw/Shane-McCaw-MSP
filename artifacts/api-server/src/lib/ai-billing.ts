/**
 * ai-billing.ts
 *
 * AI Cost Governance & Billing service for the MSP Platform.
 *
 * All monetary amounts are stored and calculated in integer CENTS (USD).
 * Dollars / decimal fractions appear only at display/formatting time.
 *
 * Ledger design:
 *   balance = SUM(amountCents) WHERE mspId = ? AND txnType IN
 *     ('monthly_grant', 'purchase', 'period_reset', 'consumption')
 *
 *   Positive entries: monthly_grant, purchase
 *   Negative entries: consumption, period_reset
 *
 * Consumption order (enforced in the ledger narrative; balance is just a sum):
 *   1. Included monthly allowance first (monthly_grant balance)
 *   2. Then oldest purchased block
 *
 * Admission gate (called once per workflow run at the first AI-dependent node):
 *   - balance > 0  → admitted — run proceeds unconditionally for all further AI nodes
 *   - balance <= 0 → blocked  — node returns { aiBlocked: true, outcome: "ai_blocked" }
 *                               even if mid-run overage would bill to negative balance
 *
 * Alert thresholds: 80%, 90%, 95%, 100% of the period allowance consumed.
 */

import { db } from "@workspace/db";
import {
  aiUsageEventsTable,
  aiBalanceLedgerTable,
  mspAiPurchasesTable,
  mspSubscriptionsTable,
  servicesTable,
  type AiCostOwner,
  type AiLedgerTxnType,
} from "@workspace/db";
import { eq, and, sum, desc, gte, sql, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "./logger";
const log = logger.child({ channel: "billing" });

// ── Billing MSP resolution ─────────────────────────────────────────────────────

/**
 * Resolve the MSP that should be billed for an AI action from an authenticated
 * request context (or any object that carries the JWT claims).
 *
 * During impersonation sessions a PlatformAdmin acts on behalf of a target MSP.
 * The `impersonatedMspId` claim identifies that MSP and takes precedence over
 * the actor's own `mspId` (which is null for PlatformAdmins) so costs are always
 * attributed to the correct tenant — never left unattributed or charged to the
 * wrong account.
 *
 * Use this helper everywhere an mspId needs to be passed to `checkAiAdmission`
 * or `recordAiUsage` in a request-scoped context.
 */
export function resolveBillingMspId(
  user: { mspId?: number; impersonatedMspId?: number } | undefined | null,
): number | null {
  if (!user) return null;
  return user.impersonatedMspId ?? user.mspId ?? null;
}

// ── Token cost rates ───────────────────────────────────────────────────────────
// Cost per 1M tokens in cents. Used when callers provide token counts.
// These are conservative estimates; update as model pricing changes.
export const TOKEN_COST_PER_MILLION_CENTS: Record<string, { input: number; output: number }> = {
  "claude-3-haiku-20240307":    { input:  25, output:  125 },
  "claude-haiku-4-5":           { input:  25, output:  125 },
  "claude-3-5-sonnet-20241022": { input: 300, output: 1500 },
  "claude-3-opus-20240229":     { input: 1500, output: 7500 },
  "claude-opus-4-5":            { input: 1500, output: 7500 },
  "gpt-4o":                     { input: 250, output: 1000 },
  "gpt-4o-mini":                { input:  15, output:   60 },
  default:                      { input:  25, output:  125 },
};

/** Compute cost in cents from token counts and model name. */
export function computeTokenCostCents(opts: {
  promptTokens: number;
  completionTokens: number;
  model?: string;
}): number {
  const rates =
    TOKEN_COST_PER_MILLION_CENTS[opts.model ?? "default"] ??
    TOKEN_COST_PER_MILLION_CENTS["default"]!;
  const inputCents  = Math.ceil((opts.promptTokens    / 1_000_000) * rates.input);
  const outputCents = Math.ceil((opts.completionTokens / 1_000_000) * rates.output);
  return inputCents + outputCents;
}

// ── Balance computation ────────────────────────────────────────────────────────

export interface AiBalanceSummary {
  mspId: number;
  /** Sum of all credits and debits in cents — current spendable balance */
  balanceCents: number;
  /** Credits from monthly_grant transactions in the current period */
  monthlyGrantCents: number;
  /** Credits from purchased blocks (never expire) */
  purchasedCents: number;
  /** Total spent (consumption) across all time for this MSP */
  totalConsumedCents: number;
  /** Current period key (e.g. "2026-07") */
  periodKey: string;
  /** How much was granted this period (from msp_subscriptions.aiCreditAllowance) */
  periodAllowanceCents: number;
  /** Cents consumed in the current period only */
  periodConsumedCents: number;
  /** Percentage of this period's allowance consumed (0–100+) */
  periodUsagePct: number;
  /** Alert threshold breached: null | 80 | 90 | 95 | 100 */
  alertThreshold: null | 80 | 90 | 95 | 100;
}

/** ISO period key for the given date, e.g. "2026-07" */
export function periodKeyFor(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Fetch the MSP's current AI credit allowance per period in cents from msp_subscriptions → services. */
async function fetchMspPeriodAllowanceCents(mspId: number): Promise<number> {
  try {
    const [sub] = await db
      .select({ serviceId: mspSubscriptionsTable.serviceId })
      .from(mspSubscriptionsTable)
      .where(eq(mspSubscriptionsTable.mspId, mspId))
      .limit(1);

    if (!sub) return 0;

    const [svc] = await db
      .select({ typeAttributes: servicesTable.typeAttributes })
      .from(servicesTable)
      .where(eq(servicesTable.id, sub.serviceId))
      .limit(1);

    // aiCreditAllowancePlatformValue lives in typeAttributes (moved from flat column)
    const attrs = (svc?.typeAttributes ?? {}) as Record<string, unknown>;
    const allowanceCents = Number(attrs.aiCreditAllowancePlatformValue ?? 0);
    return allowanceCents;
  } catch {
    return 0;
  }
}

/** Compute the MSP's current AI balance summary. */
export async function getAiBalance(mspId: number): Promise<AiBalanceSummary> {
  const periodKey = periodKeyFor();

  // Total balance across all time
  const [totalRow] = await db
    .select({ total: sum(aiBalanceLedgerTable.amountCents) })
    .from(aiBalanceLedgerTable)
    .where(eq(aiBalanceLedgerTable.mspId, mspId));

  const balanceCents = Number(totalRow?.total ?? 0);

  // Monthly grant credits this period
  const [grantRow] = await db
    .select({ total: sum(aiBalanceLedgerTable.amountCents) })
    .from(aiBalanceLedgerTable)
    .where(
      and(
        eq(aiBalanceLedgerTable.mspId, mspId),
        eq(aiBalanceLedgerTable.txnType, "monthly_grant"),
        eq(aiBalanceLedgerTable.periodKey, periodKey),
      ),
    );
  const monthlyGrantCents = Number(grantRow?.total ?? 0);

  // Purchased block credits (all time, non-expiring)
  const [purchaseRow] = await db
    .select({ total: sum(aiBalanceLedgerTable.amountCents) })
    .from(aiBalanceLedgerTable)
    .where(
      and(
        eq(aiBalanceLedgerTable.mspId, mspId),
        eq(aiBalanceLedgerTable.txnType, "purchase"),
      ),
    );
  const purchasedCents = Number(purchaseRow?.total ?? 0);

  // Total consumed across all time
  const [consumedAllRow] = await db
    .select({ total: sum(aiBalanceLedgerTable.amountCents) })
    .from(aiBalanceLedgerTable)
    .where(
      and(
        eq(aiBalanceLedgerTable.mspId, mspId),
        eq(aiBalanceLedgerTable.txnType, "consumption"),
      ),
    );
  const totalConsumedCents = Math.abs(Number(consumedAllRow?.total ?? 0));

  // Consumption this period
  const periodStart = new Date(`${periodKey}-01T00:00:00Z`);
  const [consumedPeriodRow] = await db
    .select({ total: sum(aiBalanceLedgerTable.amountCents) })
    .from(aiBalanceLedgerTable)
    .where(
      and(
        eq(aiBalanceLedgerTable.mspId, mspId),
        eq(aiBalanceLedgerTable.txnType, "consumption"),
        gte(aiBalanceLedgerTable.createdAt, periodStart),
      ),
    );
  const periodConsumedCents = Math.abs(Number(consumedPeriodRow?.total ?? 0));

  const periodAllowanceCents = await fetchMspPeriodAllowanceCents(mspId);

  const periodUsagePct =
    periodAllowanceCents > 0
      ? Math.round((periodConsumedCents / periodAllowanceCents) * 100)
      : 0;

  let alertThreshold: null | 80 | 90 | 95 | 100 = null;
  if (periodUsagePct >= 100) alertThreshold = 100;
  else if (periodUsagePct >= 95) alertThreshold = 95;
  else if (periodUsagePct >= 90) alertThreshold = 90;
  else if (periodUsagePct >= 80) alertThreshold = 80;

  return {
    mspId,
    balanceCents,
    monthlyGrantCents,
    purchasedCents,
    totalConsumedCents,
    periodKey,
    periodAllowanceCents,
    periodConsumedCents,
    periodUsagePct,
    alertThreshold,
  };
}

// ── Admission gate ─────────────────────────────────────────────────────────────

/**
 * Admission result for a workflow run at its first AI-dependent node.
 * Once admitted, the run stays admitted until completion (no re-check).
 */
export interface AdmissionResult {
  admitted: boolean;
  balanceCents: number;
  reason?: string;
}

/**
 * Check whether this MSP's run should be admitted to use AI resources.
 *
 * Rules:
 *   - costOwner = "platform" → always admitted (never touches MSP balance)
 *   - costOwner = "msp"      → check MSP balance; positive → admit, else block
 *
 * This should be called ONCE per run at the first AI-dependent node.
 * The returned `admitted` flag must be persisted on the run record and
 * reused for all subsequent AI-dependent nodes in the same run.
 */
export async function checkAiAdmission(
  mspId: number | null,
  costOwner: AiCostOwner,
): Promise<AdmissionResult> {
  if (costOwner === "platform") {
    return { admitted: true, balanceCents: Infinity, reason: "platform-funded" };
  }

  if (mspId == null) {
    log.warn({}, "ai-billing: admission check with null mspId — blocking");
    return { admitted: false, balanceCents: 0, reason: "no mspId" };
  }

  const [row] = await db
    .select({ total: sum(aiBalanceLedgerTable.amountCents) })
    .from(aiBalanceLedgerTable)
    .where(eq(aiBalanceLedgerTable.mspId, mspId));

  const balanceCents = Number(row?.total ?? 0);

  if (balanceCents > 0) {
    log.info({ mspId, balanceCents }, "ai-billing: MSP admitted (positive balance)");
    return { admitted: true, balanceCents };
  }

  log.warn({ mspId, balanceCents }, "ai-billing: MSP blocked (zero/negative balance)");
  return {
    admitted: false,
    balanceCents,
    reason: `balance is ${balanceCents} cents`,
  };
}

// ── Usage recording ────────────────────────────────────────────────────────────

export interface RecordAiUsageOpts {
  mspId: number | null;
  nodeType: string;
  feature?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costCents?: number;
  costOwner: AiCostOwner;
  runId?: string;
  model?: string;
}

/**
 * Record an AI usage event and, for MSP-owned usage, debit the balance ledger.
 *
 * For platform-owned usage: records the event but does NOT touch any MSP ledger.
 * For MSP-owned usage: records the event and creates a consumption ledger entry.
 *
 * Returns the recorded usage event row.
 */
export async function recordAiUsage(opts: RecordAiUsageOpts): Promise<void> {
  const {
    mspId,
    nodeType,
    feature,
    promptTokens = 0,
    completionTokens = 0,
    costOwner,
    runId,
    model,
  } = opts;

  // Compute cost if not provided
  let costCents = opts.costCents ?? 0;
  if (!costCents && (promptTokens || completionTokens)) {
    costCents = computeTokenCostCents({ promptTokens, completionTokens, model });
  }

  const totalTokens = opts.totalTokens ?? promptTokens + completionTokens;

  try {
    // Insert usage event
    const [usageEvent] = await db
      .insert(aiUsageEventsTable)
      .values({
        mspId: mspId ?? undefined,
        nodeType,
        feature: feature ?? nodeType,
        promptTokens: promptTokens || undefined,
        completionTokens: completionTokens || undefined,
        totalTokens: totalTokens || undefined,
        costCents,
        costOwner,
        runId: runId ?? undefined,
        model: model ?? undefined,
      })
      .returning({ eventId: aiUsageEventsTable.eventId });

    // Only debit the MSP's ledger for MSP-owned usage
    if (costOwner === "msp" && mspId != null && costCents > 0) {
      // Compute running balance before this entry
      const [balanceRow] = await db
        .select({ total: sum(aiBalanceLedgerTable.amountCents) })
        .from(aiBalanceLedgerTable)
        .where(eq(aiBalanceLedgerTable.mspId, mspId));

      const balanceBefore = Number(balanceRow?.total ?? 0);
      const balanceAfter = balanceBefore - costCents;

      await db.insert(aiBalanceLedgerTable).values({
        mspId,
        txnType: "consumption",
        amountCents: -costCents,
        description: `AI usage: ${feature ?? nodeType}${model ? ` (${model})` : ""}`,
        referenceId: runId ?? undefined,
        usageEventId: usageEvent?.eventId,
        balanceAfterCents: balanceAfter,
        periodKey: periodKeyFor(),
      });

      log.info(
        { mspId, nodeType, costCents, balanceBefore, balanceAfter },
        "ai-billing: MSP usage recorded and debited",
      );
    } else if (costOwner === "platform") {
      log.debug({ nodeType, costCents }, "ai-billing: platform usage recorded (no MSP debit)");
    }
  } catch (err) {
    // Non-fatal — usage recording failures must never break the workflow
    log.error({ err, mspId, nodeType }, "ai-billing: failed to record usage event (non-fatal)");
  }
}

// ── Monthly grant management ───────────────────────────────────────────────────

/**
 * Credit an MSP's monthly AI allowance for the given period.
 * Idempotent: if a grant for this mspId + periodKey already exists, this is a no-op.
 */
export async function creditMonthlyGrant(opts: {
  mspId: number;
  grantCents: number;
  periodKey?: string;
  description?: string;
  createdByUserId?: number;
}): Promise<boolean> {
  const pk = opts.periodKey ?? periodKeyFor();

  // Check if grant already exists for this period
  const [existing] = await db
    .select({ id: aiBalanceLedgerTable.id })
    .from(aiBalanceLedgerTable)
    .where(
      and(
        eq(aiBalanceLedgerTable.mspId, opts.mspId),
        eq(aiBalanceLedgerTable.txnType, "monthly_grant"),
        eq(aiBalanceLedgerTable.periodKey, pk),
      ),
    )
    .limit(1);

  if (existing) {
    log.info({ mspId: opts.mspId, periodKey: pk }, "ai-billing: monthly grant already exists — skipping");
    return false;
  }

  const [balanceRow] = await db
    .select({ total: sum(aiBalanceLedgerTable.amountCents) })
    .from(aiBalanceLedgerTable)
    .where(eq(aiBalanceLedgerTable.mspId, opts.mspId));

  const balanceBefore = Number(balanceRow?.total ?? 0);

  await db.insert(aiBalanceLedgerTable).values({
    mspId: opts.mspId,
    txnType: "monthly_grant",
    amountCents: opts.grantCents,
    description: opts.description ?? `Monthly AI allowance for period ${pk}`,
    periodKey: pk,
    balanceAfterCents: balanceBefore + opts.grantCents,
    createdByUserId: opts.createdByUserId,
  });

  log.info(
    { mspId: opts.mspId, grantCents: opts.grantCents, periodKey: pk },
    "ai-billing: monthly grant credited",
  );
  return true;
}

/**
 * Expire (reset) unused monthly allowance at period end.
 * Creates a period_reset transaction that zeros out unused monthly credits.
 * Purchased blocks are never expired.
 */
export async function expireMonthlyGrant(opts: {
  mspId: number;
  periodKey: string;
  createdByUserId?: number;
}): Promise<void> {
  // Calculate how much of the monthly grant remains unused in the given period
  const periodStart = new Date(`${opts.periodKey}-01T00:00:00Z`);
  const nextMonth = new Date(periodStart);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);

  const [grantRow] = await db
    .select({ total: sum(aiBalanceLedgerTable.amountCents) })
    .from(aiBalanceLedgerTable)
    .where(
      and(
        eq(aiBalanceLedgerTable.mspId, opts.mspId),
        eq(aiBalanceLedgerTable.txnType, "monthly_grant"),
        eq(aiBalanceLedgerTable.periodKey, opts.periodKey),
      ),
    );

  const grantCents = Number(grantRow?.total ?? 0);
  if (grantCents <= 0) return;

  // Consumption in the period
  const [consumedRow] = await db
    .select({ total: sum(aiBalanceLedgerTable.amountCents) })
    .from(aiBalanceLedgerTable)
    .where(
      and(
        eq(aiBalanceLedgerTable.mspId, opts.mspId),
        eq(aiBalanceLedgerTable.txnType, "consumption"),
        gte(aiBalanceLedgerTable.createdAt, periodStart),
        sql`${aiBalanceLedgerTable.createdAt} < ${nextMonth.toISOString()}`,
      ),
    );

  const consumedCents = Math.abs(Number(consumedRow?.total ?? 0));
  const unusedCents = Math.max(0, grantCents - consumedCents);

  if (unusedCents <= 0) return;

  const [balanceRow] = await db
    .select({ total: sum(aiBalanceLedgerTable.amountCents) })
    .from(aiBalanceLedgerTable)
    .where(eq(aiBalanceLedgerTable.mspId, opts.mspId));

  const balanceBefore = Number(balanceRow?.total ?? 0);

  await db.insert(aiBalanceLedgerTable).values({
    mspId: opts.mspId,
    txnType: "period_reset",
    amountCents: -unusedCents,
    description: `Monthly allowance expiry for period ${opts.periodKey} (no rollover)`,
    periodKey: opts.periodKey,
    referenceId: opts.periodKey,
    balanceAfterCents: balanceBefore - unusedCents,
    createdByUserId: opts.createdByUserId,
  });

  log.info(
    { mspId: opts.mspId, periodKey: opts.periodKey, unusedCents },
    "ai-billing: monthly grant expired (no rollover)",
  );
}

// ── Purchase recording ─────────────────────────────────────────────────────────

/**
 * Record a successful AI credit block purchase and credit the MSP's ledger.
 * Called from the Stripe webhook handler after payment confirmation.
 */
export async function activateAiPurchase(opts: {
  mspId: number;
  purchaseId: string;
  creditGrantedCents: number;
  stripePaymentIntentId?: string;
  activatedByUserId?: number;
}): Promise<void> {
  const [balanceRow] = await db
    .select({ total: sum(aiBalanceLedgerTable.amountCents) })
    .from(aiBalanceLedgerTable)
    .where(eq(aiBalanceLedgerTable.mspId, opts.mspId));

  const balanceBefore = Number(balanceRow?.total ?? 0);

  await db.insert(aiBalanceLedgerTable).values({
    mspId: opts.mspId,
    txnType: "purchase",
    amountCents: opts.creditGrantedCents,
    description: `AI credit block purchase (${(opts.creditGrantedCents / 100).toFixed(2)} USD)`,
    referenceId: opts.stripePaymentIntentId ?? opts.purchaseId,
    balanceAfterCents: balanceBefore + opts.creditGrantedCents,
    createdByUserId: opts.activatedByUserId,
  });

  await db
    .update(mspAiPurchasesTable)
    .set({ status: "active", activatedAt: new Date(), updatedAt: new Date() })
    .where(eq(mspAiPurchasesTable.purchaseId, opts.purchaseId));

  log.info(
    { mspId: opts.mspId, purchaseId: opts.purchaseId, creditGrantedCents: opts.creditGrantedCents },
    "ai-billing: AI credit block activated",
  );
}

// ── Alert helpers ──────────────────────────────────────────────────────────────

export type AlertThreshold = 80 | 90 | 95 | 100;
export const ALERT_THRESHOLDS: AlertThreshold[] = [80, 90, 95, 100];

/**
 * Cross-MSP alert summary for the admin view.
 * Returns the alert threshold breached (or null) for each MSP.
 */
export async function getCrossMspAlertSummary(): Promise<
  Array<{
    mspId: number;
    periodKey: string;
    periodAllowanceCents: number;
    periodConsumedCents: number;
    periodUsagePct: number;
    alertThreshold: null | AlertThreshold;
  }>
> {
  // Find all MSPs that have any ledger activity this period
  const periodKey = periodKeyFor();
  const periodStart = new Date(`${periodKey}-01T00:00:00Z`);

  const rows = await db
    .select({
      mspId: aiBalanceLedgerTable.mspId,
    })
    .from(aiBalanceLedgerTable)
    .where(
      and(
        eq(aiBalanceLedgerTable.txnType, "monthly_grant"),
        eq(aiBalanceLedgerTable.periodKey, periodKey),
      ),
    )
    .groupBy(aiBalanceLedgerTable.mspId);

  const results = await Promise.all(
    rows.map(async (row) => {
      const summary = await getAiBalance(row.mspId!);
      return {
        mspId: row.mspId!,
        periodKey: summary.periodKey,
        periodAllowanceCents: summary.periodAllowanceCents,
        periodConsumedCents: summary.periodConsumedCents,
        periodUsagePct: summary.periodUsagePct,
        alertThreshold: summary.alertThreshold,
      };
    }),
  );

  // Sort by alert severity (highest first)
  return results.sort((a, b) => (b.alertThreshold ?? 0) - (a.alertThreshold ?? 0));
}

// ── Recent usage events for dashboards ────────────────────────────────────────

export async function getRecentUsageEvents(mspId: number, limit = 50) {
  return db
    .select()
    .from(aiUsageEventsTable)
    .where(eq(aiUsageEventsTable.mspId, mspId))
    .orderBy(desc(aiUsageEventsTable.occurredAt))
    .limit(limit);
}

export async function getLedgerHistory(mspId: number, limit = 100) {
  return db
    .select()
    .from(aiBalanceLedgerTable)
    .where(eq(aiBalanceLedgerTable.mspId, mspId))
    .orderBy(desc(aiBalanceLedgerTable.createdAt))
    .limit(limit);
}
