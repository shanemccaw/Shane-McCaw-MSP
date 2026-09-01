/**
 * policy-compliance-evaluator.ts — orchestrates one on-demand policy
 * compliance pass and writes its real result into `msp_diagnostic_findings`
 * (#1553).
 *
 * ONE PASS = ONE msp_diagnostic_runs ROW
 * ────────────────────────────────────────
 * `msp_diagnostic_findings.run_id` is a required FK, so a policy evaluation
 * pass gets its own `msp_diagnostic_runs` row (`package_key:
 * "policy:compliance"`) the same way any other scan does — the checklist
 * (#1538) already reads "the tenant's latest run" generically, so this rides
 * that machinery unmodified rather than inventing a parallel read path.
 *
 * WHAT MAKES A FINDING
 * ─────────────────────
 * Only real, observed non-compliance. `not_evaluable` members (no reader for
 * this target kind yet, or no mailbox-usage row yet) never produce a finding
 * — silence, not a fabricated verdict. `compliant` members never produce a
 * finding either — a finding is a problem, not a clean bill of health.
 *
 * THE POLICY'S SOP AS THE NAMED FIX (#1553's own "consequence" text)
 * ─────────────────────────────────────────────────────────────────
 * #1548 names the enacting SOP on `standing_policies.sop_id`. The checklist
 * (#1538) reads a finding's `title`/`description` only — no schema change
 * there — so the SOP is surfaced by naming it directly in the finding's
 * `description`, and carried structurally in `recommendation.action` for any
 * future reader that wants it as data rather than prose.
 */

import { eq } from "drizzle-orm";
import {
  db,
  standingPoliciesTable,
  activeDirectoryOusTable,
  tenantsTable,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
} from "@workspace/db";
import { evaluateMailboxAttributeCompliance, evaluateGroupMembershipCompliance, isEvaluableTargetKind, isGroupMembershipTargetState } from "./policy-compliance";
import { observeOuMailboxSizes, observeOuGroupMemberships } from "./policy-compliance-graph";
import { logger } from "./logger";

const log = logger.child({ channel: "engine.dashboard" });

export interface PolicyEvaluationSummary {
  readonly runId: string | null;
  readonly membersObserved: number;
  readonly compliant: number;
  readonly nonCompliant: number;
  readonly findingsCreated: readonly string[];
  readonly notEvaluableReason: string | null;
}

/**
 * Evaluates one standing policy against one customer's real tenant state and
 * writes a finding for every real, observed divergence. Returns a summary
 * covering the whole pass — never throws for "nothing to evaluate", only for
 * a genuine transport/auth failure the caller should see.
 */
export async function evaluateStandingPolicyForCustomer(policyId: number, customerId: number): Promise<PolicyEvaluationSummary> {
  const [policy] = await db.select().from(standingPoliciesTable).where(eq(standingPoliciesTable.id, policyId)).limit(1);
  if (!policy) {
    return { runId: null, membersObserved: 0, compliant: 0, nonCompliant: 0, findingsCreated: [], notEvaluableReason: `Standing policy ${policyId} does not exist` };
  }

  const [customer] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, customerId)).limit(1);
  if (!customer) {
    return { runId: null, membersObserved: 0, compliant: 0, nonCompliant: 0, findingsCreated: [], notEvaluableReason: `Customer ${customerId} does not exist` };
  }
  if (customer.mspId !== policy.mspId) {
    return { runId: null, membersObserved: 0, compliant: 0, nonCompliant: 0, findingsCreated: [], notEvaluableReason: `Customer ${customerId} does not belong to this policy's MSP` };
  }
  if (!policy.isActive) {
    return { runId: null, membersObserved: 0, compliant: 0, nonCompliant: 0, findingsCreated: [], notEvaluableReason: "Policy is not active — #1549's default-off gate" };
  }
  if (!isEvaluableTargetKind(policy.targetKind)) {
    return {
      runId: null,
      membersObserved: 0,
      compliant: 0,
      nonCompliant: 0,
      findingsCreated: [],
      notEvaluableReason: `No compliance reader is wired for target kind '${policy.targetKind}' yet — mailbox_attribute is the only real evaluator so far`,
    };
  }

  const [ou] = await db.select().from(activeDirectoryOusTable).where(eq(activeDirectoryOusTable.id, policy.ouId)).limit(1);
  if (!ou) {
    return { runId: null, membersObserved: 0, compliant: 0, nonCompliant: 0, findingsCreated: [], notEvaluableReason: `Policy's OU ${policy.ouId} does not exist` };
  }

  if (policy.targetKind === "group_membership" && !isGroupMembershipTargetState(policy.targetState)) {
    return {
      runId: null,
      membersObserved: 0,
      compliant: 0,
      nonCompliant: 0,
      findingsCreated: [],
      notEvaluableReason: `Policy target_state is not a recognized group_membership declaration: ${JSON.stringify(policy.targetState)}`,
    };
  }

  const groupTargetState = policy.targetKind === "group_membership" && isGroupMembershipTargetState(policy.targetState) ? policy.targetState : null;
  const mailboxObservations = policy.targetKind === "mailbox_attribute" ? await observeOuMailboxSizes(customer.tenantId, ou.name, ou.id, customerId) : null;
  const groupObservations = groupTargetState ? await observeOuGroupMemberships(customer.tenantId, ou.name, ou.id, customerId, groupTargetState.groupIds) : null;
  const membersObservedCount = mailboxObservations?.length ?? groupObservations?.length ?? 0;

  if (membersObservedCount === 0) {
    return {
      runId: null,
      membersObserved: 0,
      compliant: 0,
      nonCompliant: 0,
      findingsCreated: [],
      notEvaluableReason:
        policy.targetKind === "mailbox_attribute"
          ? `No members of this tenant's real directory are manually assigned to or carry department = '${ou.name}' with a real mailbox usage row`
          : `No members of this tenant's real directory are manually assigned to or carry department = '${ou.name}'`,
    };
  }

  const [run] = await db
    .insert(mspDiagnosticRunsTable)
    .values({
      mspId: policy.mspId,
      customerId,
      tenantId: customer.tenantId,
      packageKey: "policy:compliance",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      checksTotal: membersObservedCount,
      checksOk: 0,
      checksError: 0,
      checksRequiresScript: 0,
      checksLicenseGap: 0,
    })
    .returning();

  let compliant = 0;
  let nonCompliant = 0;
  const findingsCreated: string[] = [];
  const sopNote = policy.sopId ? ` Fix via SOP '${policy.sopId}' — the enacting procedure this policy names (#1548).` : " No enacting SOP is named on this policy yet (#1548).";

  if (mailboxObservations) {
    for (const observation of mailboxObservations) {
      const result = evaluateMailboxAttributeCompliance(policy.targetState, observation);
      if (result.verdict === "compliant") {
        compliant++;
        continue;
      }
      if (result.verdict === "not_evaluable") {
        continue;
      }

      nonCompliant++;
      const [finding] = await db
        .insert(mspDiagnosticFindingsTable)
        .values({
          runId: run.runId,
          mspId: policy.mspId,
          customerId,
          checkKey: `policy:${policy.id}:mailbox_attribute`,
          checkLabel: `Standing policy: ${policy.title}`,
          severity: "warning",
          title: `${observation.displayName ?? observation.userPrincipalName}'s mailbox is ${observation.observedSizeMb}MB — policy '${policy.title}' caps it at ${result.targetValue}MB`,
          description: `${result.reason}.${sopNote}`,
          recommendation: {
            category: "policy",
            action: policy.sopId ?? undefined,
            priority: 2,
          },
          extractedProperties: { userPrincipalName: observation.userPrincipalName, observedSizeMb: observation.observedSizeMb, targetSizeMb: result.targetValue },
          checkStatus: "ok",
          findingSource: "policy",
          standingPolicyId: policy.id,
        })
        .returning({ findingId: mspDiagnosticFindingsTable.findingId });
      findingsCreated.push(finding.findingId);
    }
  } else if (groupObservations) {
    for (const observation of groupObservations) {
      const result = evaluateGroupMembershipCompliance(policy.targetState, observation);
      if (result.verdict === "compliant") {
        compliant++;
        continue;
      }
      if (result.verdict === "not_evaluable") {
        continue;
      }

      nonCompliant++;
      const [finding] = await db
        .insert(mspDiagnosticFindingsTable)
        .values({
          runId: run.runId,
          mspId: policy.mspId,
          customerId,
          checkKey: `policy:${policy.id}:group_membership`,
          checkLabel: `Standing policy: ${policy.title}`,
          severity: "warning",
          title: `${observation.displayName ?? observation.userPrincipalName} does not meet policy '${policy.title}''s group-membership requirement`,
          description: `${result.reason}.${sopNote}`,
          recommendation: {
            category: "policy",
            action: policy.sopId ?? undefined,
            priority: 2,
          },
          extractedProperties: { userPrincipalName: observation.userPrincipalName, memberGroupIds: observation.memberGroupIds, requiredGroupIds: groupTargetState?.groupIds ?? [] },
          checkStatus: "ok",
          findingSource: "policy",
          standingPolicyId: policy.id,
        })
        .returning({ findingId: mspDiagnosticFindingsTable.findingId });
      findingsCreated.push(finding.findingId);
    }
  }

  log.info(
    { policyId, customerId, runId: run.runId, membersObserved: membersObservedCount, compliant, nonCompliant, findingsCreated: findingsCreated.length },
    "standing policy compliance evaluated",
  );

  return { runId: run.runId, membersObserved: membersObservedCount, compliant, nonCompliant, findingsCreated, notEvaluableReason: null };
}
