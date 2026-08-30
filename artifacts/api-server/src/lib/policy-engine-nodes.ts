/**
 * policy-engine-nodes.ts — the Policy Engine's continuous-evaluation
 * reconciliation loop (#1549), wired as a real Workflow Engine node type
 * ("Promoted node type", same convention as m365-health-sample.ts /
 * msp-dunning-advance) so the loop is a visible workflow node rather than a
 * bare scheduler.
 *
 * #1549 SETTLED: two triggers, one node.
 *   EVENT      — something changed for ONE tenant right now (today: a
 *                standing policy was just switched on — see
 *                msp-standing-policies.ts's fireWorkflowsForEvent call).
 *                `payload.customerId` is set — scope is that one tenant.
 *   DIVERGENCE — a periodic sweep (the seeded "__system__: Policy Engine —
 *                Continuous Evaluation" schedule workflow) that re-checks
 *                every active policy across every opted-in tenant, so drift
 *                introduced by hand between events is eventually caught.
 *                `payload.customerId` is absent — scope is every tenant.
 *
 * Gated by BOTH a per-policy switch (`standing_policies.is_active`, #1547)
 * AND the per-customer opt-in checkbox this issue adds
 * (`tenants.policy_engine_opt_in`, default OFF) — "the platform does not
 * evaluate or act against tenants that have not opted in." That gate
 * (policy-engine-evaluator.ts's `decideEvaluationGate`) is THIS issue's own
 * job; #1553's real evaluator (`evaluateStandingPolicyForCustomer`,
 * policy-compliance-evaluator.ts) has no opt-in concept — it's an on-demand,
 * human-supplied-customerId route, always human-authorized per call. This
 * automatic loop is the one place the opt-in gate has to be enforced BEFORE
 * that real evaluator (or any Graph read) is ever reached.
 *
 * The real comparison and finding-writing is #1553's job, reused here
 * unchanged — this node does not duplicate it, does not execute an SOP
 * (#1548's job), and only records the reconciliation loop's own trigger/
 * outcome history in `policy_evaluation_runs`.
 */

import { db, standingPoliciesTable, activeDirectoryOusTable, tenantsTable, policyEvaluationRunsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";
import { decideEvaluationGate } from "./policy-engine-evaluator";
import { evaluateStandingPolicyForCustomer } from "./policy-compliance-evaluator";

const log = logger.child({ channel: "engine.policy" });

export interface PolicyEvaluateDueSummary {
  triggerKind: "event" | "schedule";
  triggerEventType: string | null;
  scopedCustomerId: number | null;
  policiesConsidered: number;
  compliant: number;
  divergent: number;
  notEvaluable: number;
  skippedNotOptedIn: number;
  errors: number;
}

/**
 * The `policy_evaluate_due` node handler. `nodeData` is the workflow graph
 * node's own static config (unused today — no per-node tuning yet). `payload`
 * is the run's input: an event-triggered run carries `customerId` (tenants.id,
 * NOT the Azure AD tenant GUID — see active-directory.ts's own note on that
 * distinction) and `eventName`; a schedule-triggered run carries neither.
 */
export async function handlePolicyEvaluateDue(
  _nodeData: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<PolicyEvaluateDueSummary> {
  const scopedCustomerId = typeof payload.customerId === "number" ? payload.customerId : null;
  const triggerKind: "event" | "schedule" = scopedCustomerId !== null ? "event" : "schedule";
  const triggerEventType = typeof payload.eventName === "string" ? payload.eventName : null;

  const rows = await db
    .select({
      policy: standingPoliciesTable,
      tenantId: activeDirectoryOusTable.tenantId,
      policyEngineOptIn: tenantsTable.policyEngineOptIn,
    })
    .from(standingPoliciesTable)
    .innerJoin(activeDirectoryOusTable, eq(activeDirectoryOusTable.id, standingPoliciesTable.ouId))
    .leftJoin(tenantsTable, eq(tenantsTable.id, activeDirectoryOusTable.tenantId))
    .where(
      scopedCustomerId !== null
        ? and(eq(standingPoliciesTable.isActive, true), eq(activeDirectoryOusTable.tenantId, scopedCustomerId))
        : eq(standingPoliciesTable.isActive, true),
    );

  const summary: PolicyEvaluateDueSummary = {
    triggerKind,
    triggerEventType,
    scopedCustomerId,
    policiesConsidered: rows.length,
    compliant: 0,
    divergent: 0,
    notEvaluable: 0,
    skippedNotOptedIn: 0,
    errors: 0,
  };

  for (const row of rows) {
    try {
      const gate = decideEvaluationGate({ tenantId: row.tenantId, policyEngineOptIn: row.policyEngineOptIn ?? false });

      if (!gate.proceed) {
        await db.insert(policyEvaluationRunsTable).values({
          standingPolicyId: row.policy.id,
          mspId: row.policy.mspId,
          tenantId: row.tenantId,
          triggerKind,
          triggerEventType,
          outcome: gate.outcome,
          detail: gate.detail,
        });
        if (gate.outcome === "not_evaluable") summary.notEvaluable++;
        else summary.skippedNotOptedIn++;
        continue;
      }

      // Gate passed — reuse #1553's real evaluator unchanged. `row.tenantId`
      // is non-null here (the gate only proceeds once it is resolved).
      const result = await evaluateStandingPolicyForCustomer(row.policy.id, row.tenantId as number);

      const outcome = result.notEvaluableReason !== null ? "not_evaluable" : result.nonCompliant > 0 ? "divergent" : "compliant";
      const detail: Record<string, unknown> = result.notEvaluableReason !== null
        ? { reason: result.notEvaluableReason }
        : {
            runId: result.runId,
            membersObserved: result.membersObserved,
            compliant: result.compliant,
            nonCompliant: result.nonCompliant,
            findingsCreated: result.findingsCreated,
          };

      await db.insert(policyEvaluationRunsTable).values({
        standingPolicyId: row.policy.id,
        mspId: row.policy.mspId,
        tenantId: row.tenantId,
        triggerKind,
        triggerEventType,
        outcome,
        detail,
      });

      switch (outcome) {
        case "compliant": summary.compliant++; break;
        case "divergent": summary.divergent++; break;
        case "not_evaluable": summary.notEvaluable++; break;
      }
    } catch (err) {
      summary.errors++;
      log.error({ err, standingPolicyId: row.policy.id }, "policy-engine: evaluation pass failed for this policy");
      try {
        await db.insert(policyEvaluationRunsTable).values({
          standingPolicyId: row.policy.id,
          mspId: row.policy.mspId,
          tenantId: row.tenantId,
          triggerKind,
          triggerEventType,
          outcome: "error",
          detail: { reason: err instanceof Error ? err.message : String(err) },
        });
      } catch (insertErr) {
        log.error({ err: insertErr, standingPolicyId: row.policy.id }, "policy-engine: failed to record the error outcome itself");
      }
    }
  }

  log.info({ ...summary }, "policy-engine: continuous evaluation pass complete");
  return summary;
}
