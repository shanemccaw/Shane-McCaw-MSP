/**
 * policy-engine.ts
 *
 * Signal Policy Engine — matches active policy rules (signal-prefix or
 * engine-score-threshold conditions) against a customer's current state,
 * and fires a workflow event for anything that qualifies, subject to a
 * per-rule cooldown/dedup window.
 *
 * Design:
 *  - Each rule evaluated independently — one rule's failure never blocks others.
 *  - Cooldown enforced via policyRuleFiringsTable so repeated evaluations
 *    don't spam the same event for the same customer.
 */

import { db, policyRulesTable, policyRuleFiringsTable, tenantEngineSnapshotsTable, mspCustomersTable } from "@workspace/db";
import { sql, eq, and, or, isNull, desc } from "drizzle-orm";
import { getStabilizedSignals } from "./tenant-signals";
import { emitWorkflowEvent } from "./workflow-executor";
import { logger } from "./logger";
const log = logger.child({ channel: "engine.policy" });

async function evaluatePoliciesForCustomer(
  customerId: number,
  mspId: number,
): Promise<{ fired: number; checked: number }> {
  const stabilizedSignals = await getStabilizedSignals(customerId);

  const rules = await db
    .select()
    .from(policyRulesTable)
    .where(
      and(
        eq(policyRulesTable.isActive, true),
        or(eq(policyRulesTable.mspId, mspId), isNull(policyRulesTable.mspId)),
      ),
    )
    .orderBy(sql`${policyRulesTable.mspId} NULLS LAST`);

  // Collapse overlapping MSP-specific / platform-default rules down to just
  // the MSP-specific one. Rules are already ordered mspId NULLS LAST, so the
  // first rule seen for a given condition key is always the MSP-specific
  // override (if one exists) — any later rule for the same key is the
  // platform default and gets suppressed.
  const seenConditionKeys = new Set<string>();
  const dedupedRules = rules.filter(rule => {
    const conditionKey =
      rule.conditionType === "signal"
        ? `signal:${rule.signalKeyPrefix}`
        : rule.conditionType === "score_threshold"
          ? `score_threshold:${rule.engineKey}`
          : null;

    if (conditionKey === null) return true;
    if (seenConditionKeys.has(conditionKey)) return false;
    seenConditionKeys.add(conditionKey);
    return true;
  });

  let fired = 0;
  let checked = 0;

  for (const rule of dedupedRules) {
    checked++;
    try {
      let conditionMet = false;

      if (rule.conditionType === "signal") {
        if (!rule.signalKeyPrefix) {
          log.warn({ ruleId: rule.id }, "policy-engine: signal rule missing signalKeyPrefix — skipping");
          continue;
        }
        conditionMet = [...stabilizedSignals].some(signalKey => signalKey.startsWith(rule.signalKeyPrefix!));
      } else if (rule.conditionType === "score_threshold") {
        if (!rule.engineKey || !rule.scoreOperator || rule.scoreThreshold == null) {
          log.warn({ ruleId: rule.id }, "policy-engine: score_threshold rule missing engineKey/scoreOperator/scoreThreshold — skipping");
          continue;
        }

        const [snapshot] = await db
          .select({ score: tenantEngineSnapshotsTable.score })
          .from(tenantEngineSnapshotsTable)
          .where(
            and(
              eq(tenantEngineSnapshotsTable.customerId, customerId),
              eq(tenantEngineSnapshotsTable.engineKey, rule.engineKey),
            ),
          )
          .orderBy(desc(tenantEngineSnapshotsTable.capturedAt))
          .limit(1);

        if (!snapshot) continue;

        conditionMet =
          rule.scoreOperator === "lt"
            ? snapshot.score < rule.scoreThreshold
            : snapshot.score > rule.scoreThreshold;
      } else {
        log.warn({ ruleId: rule.id, conditionType: rule.conditionType }, "policy-engine: unknown conditionType — skipping");
        continue;
      }

      if (!conditionMet) continue;

      const recentFiring = await db.execute(sql`
        SELECT id FROM policy_rule_firings
        WHERE rule_id = ${rule.id} AND customer_id = ${customerId}
          AND fired_at > NOW() - (${rule.cooldownMinutes} || ' minutes')::interval
        LIMIT 1
      `);
      if (recentFiring.rows.length > 0) continue;

      await emitWorkflowEvent(rule.eventName, {
        customerId,
        mspId,
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        conditionType: rule.conditionType,
      });

      await db.insert(policyRuleFiringsTable).values({
        ruleId: rule.id,
        customerId,
        mspId,
        firedAt: new Date(),
      });

      fired++;
      log.info({ ruleId: rule.id, ruleName: rule.name, customerId, mspId }, "policy-engine: rule fired");
    } catch (err) {
      log.warn({ err, ruleId: rule.id, customerId, mspId }, "policy-engine: rule evaluation failed — continuing");
    }
  }

  return { fired, checked };
}

export async function evaluateAllPolicies(): Promise<{ customersChecked: number; totalFired: number }> {
  const customerRows = await db.execute(sql`
    SELECT DISTINCT customer_id AS "customerId" FROM tenant_signal_history WHERE resolved_at IS NULL
  `);
  const customerIds = (customerRows.rows as { customerId: number }[]).map(r => r.customerId);

  let customersChecked = 0;
  let totalFired = 0;

  for (const customerId of customerIds) {
    try {
      const [customer] = await db
        .select({ mspId: mspCustomersTable.mspId })
        .from(mspCustomersTable)
        .where(eq(mspCustomersTable.id, customerId))
        .limit(1);

      if (!customer) {
        log.warn({ customerId }, "policy-engine: no mspId found for customer — skipping");
        continue;
      }

      const { fired } = await evaluatePoliciesForCustomer(customerId, customer.mspId);
      totalFired += fired;
      customersChecked++;
    } catch (err) {
      log.warn({ err, customerId }, "policy-engine: customer evaluation failed — continuing");
    }
  }

  log.info({ customersChecked, totalFired }, "policy-engine: evaluateAllPolicies complete");
  return { customersChecked, totalFired };
}
