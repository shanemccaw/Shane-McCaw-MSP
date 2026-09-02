/**
 * remediation-raise-change.ts — turns ONE checklist item (#1538) into the
 * input `raiseChangeRequest` (#1941, `portal-change-control-raise.ts`) needs
 * to raise a real CR FROM it, with `remediationCheckKey` populated. This is
 * the structured backend counterpart to a future "Raise a change to fix
 * this" UI affordance — see #1941's own header for why the gate #1541 built
 * had no real row to authorize until this existed.
 *
 * Everything here is a pure, total function over a `RemediationChecklistItem`
 * — no fabricated fields. Where the item genuinely doesn't carry a value a
 * real change needs (an impacted-user count), the honest answer is 0
 * ("unspecified"), not a guessed number.
 */

import type { RemediationChecklistItem } from "./remediation-checklist";
import { workloadForCheckKey, type ChangeClass } from "./portal-change-control";
import type { RaiseChangeRequestInput } from "./portal-change-control-raise";

/**
 * `critical` findings raise a `Normal` change (needs real review before
 * anything touches the tenant); `warning` findings raise a `Standard` one
 * (pre-approved, per `materializeApprovalsForChange`'s own `stages === 0`
 * rule for Standard changes) — the same severity split the checklist itself
 * already sorts by (`resolveRemediationChecklist`'s critical-first ordering).
 */
function changeClassForSeverity(severity: RemediationChecklistItem["severity"]): ChangeClass {
  return severity === "critical" ? "Normal" : "Standard";
}

/** A free-text window label until a real scheduling affordance exists — the same "label, not an instant" shape `scheduledFor` already is on every wizard-raised CR. */
const DEFAULT_WINDOW_LABEL = "Next available maintenance window";

export function buildRaiseChangeRequestInputForChecklistItem(item: RemediationChecklistItem): RaiseChangeRequestInput {
  return {
    title: `Fix: ${item.title}`,
    target: item.checkKey,
    post: {
      checkKey: item.checkKey,
      findingId: item.findingId,
      severity: item.severity,
      description: item.description,
      summary: item.summary,
      remediationSteps: item.remediationSteps,
      adminCenterPath: item.adminCenterPath,
      adminCenterUrl: item.adminCenterUrl,
      validationCommand: item.validationCommand,
    },
    changeClass: changeClassForSeverity(item.severity),
    // Not fabricated — the checklist item carries no user-impact count, and
    // 0 ("unspecified") is the honest value rather than a guess. See the
    // header.
    impactedUsersCount: 0,
    window: DEFAULT_WINDOW_LABEL,
    remediationCheckKey: item.checkKey,
    workloadOverride: workloadForCheckKey(item.checkKey),
  };
}
