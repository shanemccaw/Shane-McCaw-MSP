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

import { db, policyRulesTable, policyRuleFiringsTable, policyRuleIncidentsTable, tenantEngineSnapshotsTable, mspCustomersTable } from "@workspace/db";
import { sql, eq, and, or, isNull, desc } from "drizzle-orm";
import { getStabilizedSignals } from "./tenant-signals";
import { emitWorkflowEvent } from "./workflow-executor";
import { logger } from "./logger";
const log = logger.child({ channel: "engine.policy" });

function computeRuleCategory(rule: { conditionType: string; signalKeyPrefix: string | null; engineKey: string | null }): string {
  if (rule.conditionType === "signal" && rule.signalKeyPrefix) {
    return rule.signalKeyPrefix.split(":")[0];
  }
  if (rule.conditionType === "score_threshold" && rule.engineKey) {
    return rule.engineKey;
  }
  return "uncategorized";
}

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
  const matchedRuleIds = new Set<number>();

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
      matchedRuleIds.add(rule.id);

      const activeSuppression = await db.execute(sql`
        SELECT id FROM policy_rule_suppressions
        WHERE rule_id = ${rule.id}
          AND msp_id = ${mspId}
          AND (customer_id = ${customerId} OR customer_id IS NULL)
          AND (expires_at IS NULL OR expires_at > NOW())
        LIMIT 1
      `);
      if (activeSuppression.rows.length > 0) {
        log.info({ ruleId: rule.id, customerId, mspId }, "policy-engine: rule suppressed — skipping firing/escalation");
        continue;
      }

      if (rule.escalationRules && rule.escalationRules.length > 0) {
        const [openIncident] = await db
          .select()
          .from(policyRuleIncidentsTable)
          .where(and(
            eq(policyRuleIncidentsTable.ruleId, rule.id),
            eq(policyRuleIncidentsTable.customerId, customerId),
            eq(policyRuleIncidentsTable.status, "open"),
          ))
          .limit(1);

        if (!openIncident) {
          const level1 = [...rule.escalationRules].sort((a, b) => a.level - b.level)[0];
          await emitWorkflowEvent(level1.eventName, {
            customerId, mspId, ruleId: rule.id, ruleName: rule.name, severity: rule.severity, level: level1.level, category: computeRuleCategory(rule),
          });
          await db.insert(policyRuleIncidentsTable).values({
            ruleId: rule.id, customerId, mspId, status: "open", currentLevel: level1.level, lastEscalatedAt: new Date(),
          });
          fired++;
          log.info({ ruleId: rule.id, level: level1.level, customerId, mspId }, "policy-engine: incident opened");
        } else {
          const nextLevel = rule.escalationRules.find(l => l.level === openIncident.currentLevel + 1);
          if (nextLevel) {
            const sinceLastEscalation = Date.now() - new Date(openIncident.lastEscalatedAt ?? openIncident.openedAt).getTime();
            const minutesSince = sinceLastEscalation / 60000;
            if (minutesSince >= nextLevel.afterMinutes) {
              await emitWorkflowEvent(nextLevel.eventName, {
                customerId, mspId, ruleId: rule.id, ruleName: rule.name, severity: rule.severity, level: nextLevel.level, category: computeRuleCategory(rule),
              });
              await db
                .update(policyRuleIncidentsTable)
                .set({ currentLevel: nextLevel.level, lastEscalatedAt: new Date() })
                .where(eq(policyRuleIncidentsTable.id, openIncident.id));
              fired++;
              log.info({ ruleId: rule.id, level: nextLevel.level, customerId, mspId }, "policy-engine: incident escalated");
            }
          }
        }
      } else {
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
          category: computeRuleCategory(rule),
        });

        await db.insert(policyRuleFiringsTable).values({
          ruleId: rule.id,
          customerId,
          mspId,
          firedAt: new Date(),
        });

        fired++;
        log.info({ ruleId: rule.id, ruleName: rule.name, customerId, mspId }, "policy-engine: rule fired");
      }
    } catch (err) {
      log.warn({ err, ruleId: rule.id, customerId, mspId }, "policy-engine: rule evaluation failed — continuing");
    }
  }

  try {
    const openIncidents = await db
      .select({
        incident: policyRuleIncidentsTable,
        resolvedEventName: policyRulesTable.resolvedEventName,
        conditionType: policyRulesTable.conditionType,
        signalKeyPrefix: policyRulesTable.signalKeyPrefix,
        engineKey: policyRulesTable.engineKey,
      })
      .from(policyRuleIncidentsTable)
      .innerJoin(policyRulesTable, eq(policyRuleIncidentsTable.ruleId, policyRulesTable.id))
      .where(and(
        eq(policyRuleIncidentsTable.customerId, customerId),
        eq(policyRuleIncidentsTable.status, "open"),
      ));
    for (const { incident, resolvedEventName, conditionType, signalKeyPrefix, engineKey } of openIncidents) {
      if (!matchedRuleIds.has(incident.ruleId)) {
        if (resolvedEventName) {
          await emitWorkflowEvent(resolvedEventName, {
            customerId, mspId, ruleId: incident.ruleId, incidentId: incident.id, category: computeRuleCategory({ conditionType, signalKeyPrefix, engineKey }),
          });
        }
        await db
          .update(policyRuleIncidentsTable)
          .set({ status: "resolved", resolvedAt: new Date() })
          .where(eq(policyRuleIncidentsTable.id, incident.id));
        log.info({ ruleId: incident.ruleId, incidentId: incident.id, customerId, firedResolvedEvent: !!resolvedEventName }, "policy-engine: incident auto-resolved");
      }
    }
  } catch (err) {
    log.warn({ err, customerId }, "policy-engine: incident resolution sweep failed");
  }

  return { fired, checked };
}

export async function evaluateAllPolicies(): Promise<{ customersChecked: number; totalFired: number }> {
  // tenant_signal_history.customer_id rows are written in users.id space (its
  // live FK targets users.id despite the column name — see tenant-signals.ts's
  // recordSignalTransitions). The policy engine's own queries (engine
  // snapshots, suppressions, firings) are all keyed by REAL msp_customers.id —
  // so bridge each open-history user through msp_users to the real customer it
  // belongs to, and evaluate per distinct customer. The old enumeration passed
  // the raw users.id straight into `WHERE msp_customers.id = ...`, which only
  // worked when the two id spaces happened to coincide numerically.
  const customerRows = await db.execute(sql`
    SELECT DISTINCT mu.customer_id AS "customerId"
    FROM tenant_signal_history tsh
    JOIN msp_users mu ON mu.user_id = tsh.customer_id
    WHERE tsh.resolved_at IS NULL AND mu.customer_id IS NOT NULL
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
