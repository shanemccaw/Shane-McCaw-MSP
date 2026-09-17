/**
 * security-defaults-compensation.ts
 *
 * Git #4529 — decide whether a finished workflow run left a tenant with Security
 * Defaults switched off and nothing enforcing MFA in its place.
 *
 * #4513 refuses a pack before it starts unless the same pack creates an enforcing
 * (state "enabled") MFA-for-all Conditional Access policy. That cannot catch a
 * RUNTIME failure: quickstart-v1 disables Security Defaults (sort 5) and only then
 * creates the CA policy (sort 6), because Graph refuses an enabled CA policy while
 * Security Defaults is on. A throttle, a 5xx, a consent change or a cancellation
 * between the two leaves the tenant with neither. The run path
 * (security-defaults-compensation-run.ts) re-enables Security Defaults when this
 * planner says so.
 *
 * Pure: reads only the steps the run actually recorded (wf_run_node_outputs +
 * their baseline_action_templates rows), so it is unit-testable without db or Graph.
 */

import {
  enforcingPolicyShapeGap,
  isConditionalAccessPolicyCreate,
  securityDefaultsWriteEffect,
} from "./config-pack-preconditions.ts";

/** One execute_baseline_template step the run recorded, in execution order. */
export interface ExecutedTemplateStep {
  nodeId: string;
  templateId: string;
  /** The template row's method/endpoint/body, unresolved. */
  method: string;
  endpoint: string;
  bodyTemplate: Record<string, unknown>;
  /** The payload the node ran with (wf_run_node_outputs.input). */
  input: Record<string, unknown>;
  /** The node's persisted output (success, data, skippedExisting, tenantId, customerId). */
  output: Record<string, unknown>;
}

export type SecurityDefaultsCompensationPlan =
  | { needed: false; reason: string }
  | {
      needed: true;
      reason: string;
      disableNodeId: string;
      disableTemplateId: string;
      tenantId: string | null;
      customerId: number | null;
      /** CA creates that ran after the disable, and why none of them counts. */
      unconfirmedPolicies: Array<{ nodeId: string; templateId: string; gap: string }>;
    };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function customerIdOf(step: ExecutedTemplateStep): number | null {
  for (const raw of [step.output.customerId, step.input.customerId]) {
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseInt(raw, 10) : NaN;
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

/**
 * Why a successful CA-create step does not confirm an enforcing policy, or null
 * when it does. Judged on the policy Graph returned (a 201 body, or the existing
 * policy a #4514 skip reported) — never on what the template intended to send.
 */
function confirmationGap(step: ExecutedTemplateStep): string | null {
  const policy = asRecord(step.output.data);
  if (!policy) return "Graph returned no policy object to confirm";
  return enforcingPolicyShapeGap(policy);
}

export function planSecurityDefaultsCompensation(steps: ExecutedTemplateStep[]): SecurityDefaultsCompensationPlan {
  let openDisable: ExecutedTemplateStep | null = null;
  let unconfirmed: Array<{ nodeId: string; templateId: string; gap: string }> = [];

  for (const step of steps) {
    if (step.output.success !== true) continue;

    const effect = securityDefaultsWriteEffect(step, step.input);
    if (effect === "disable" && step.output.skippedExisting !== true) {
      openDisable = step;
      unconfirmed = [];
      continue;
    }
    if (effect === "enable") {
      openDisable = null;
      unconfirmed = [];
      continue;
    }

    if (openDisable && isConditionalAccessPolicyCreate(step, step.input)) {
      const gap = confirmationGap(step);
      if (gap === null) {
        openDisable = null;
        unconfirmed = [];
      } else {
        unconfirmed.push({ nodeId: step.nodeId, templateId: step.templateId, gap });
      }
    }
  }

  if (!openDisable) {
    return { needed: false, reason: "no Security Defaults disable is left without an enforcing Conditional Access policy" };
  }

  const tenantId = typeof openDisable.output.tenantId === "string" && openDisable.output.tenantId
    ? openDisable.output.tenantId
    : null;
  const why = unconfirmed.length === 0
    ? "no Conditional Access policy was created after it"
    : unconfirmed.map((u) => `${u.templateId}: ${u.gap}`).join("; ");
  return {
    needed: true,
    reason: `${openDisable.templateId} turned Security Defaults off and the run ended before an enforcing ` +
      `Conditional Access policy was confirmed — ${why}`,
    disableNodeId: openDisable.nodeId,
    disableTemplateId: openDisable.templateId,
    tenantId,
    customerId: customerIdOf(openDisable),
    unconfirmedPolicies: unconfirmed,
  };
}
