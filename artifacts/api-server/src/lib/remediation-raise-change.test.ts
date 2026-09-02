/**
 * remediation-raise-change.test.ts — turning ONE checklist item into a
 * `raiseChangeRequest` input (#1941). Pure function, no database: the real-DB
 * half (a raised CR actually landing with `remediationCheckKey` set) is
 * covered by `remediation-reveal-gate.test.ts`'s existing real-DB fixtures,
 * which already assert on rows carrying that column.
 */

import { describe, it, expect } from "vitest";

import { buildRaiseChangeRequestInputForChecklistItem } from "./remediation-raise-change";
import type { RemediationChecklistItem } from "./remediation-checklist";

function makeItem(overrides: Partial<RemediationChecklistItem> = {}): RemediationChecklistItem {
  return {
    checkKey: "identity:ca-mfa-coverage",
    findingId: "finding-1",
    severity: "critical",
    title: "MFA not enforced for 12 admins",
    description: "12 privileged accounts have no MFA requirement.",
    fixRoute: "manual",
    affordance: "copy",
    hasVerifiedContent: true,
    summary: "Require MFA for all users via Conditional Access.",
    remediationSteps: [],
    adminCenterPath: "Microsoft Entra admin center → Protection → Conditional Access",
    adminCenterUrl: null,
    validationCommand: "Get-MgIdentityConditionalAccessPolicy -All",
    status: "not_started",
    completedAt: null,
    verificationState: "unverified",
    verifiedAt: null,
    ...overrides,
  };
}

describe("buildRaiseChangeRequestInputForChecklistItem", () => {
  it("carries the finding's own checkKey as both the target and remediationCheckKey", () => {
    const item = makeItem();
    const input = buildRaiseChangeRequestInputForChecklistItem(item);
    expect(input.target).toBe("identity:ca-mfa-coverage");
    expect(input.remediationCheckKey).toBe("identity:ca-mfa-coverage");
  });

  it("titles the change from the finding's own fact, not a generic label", () => {
    const input = buildRaiseChangeRequestInputForChecklistItem(makeItem());
    expect(input.title).toBe("Fix: MFA not enforced for 12 admins");
  });

  it("a critical finding raises a Normal change; a warning finding raises a pre-approved Standard change", () => {
    expect(buildRaiseChangeRequestInputForChecklistItem(makeItem({ severity: "critical" })).changeClass).toBe(
      "Normal",
    );
    expect(buildRaiseChangeRequestInputForChecklistItem(makeItem({ severity: "warning" })).changeClass).toBe(
      "Standard",
    );
  });

  it("does not fabricate an impacted-user count — 0 is the honest 'unspecified' value", () => {
    expect(buildRaiseChangeRequestInputForChecklistItem(makeItem()).impactedUsersCount).toBe(0);
  });

  it("derives the workload from the checkKey prefix, not the free-text target", () => {
    const item = makeItem({ checkKey: "sharepoint:orgwide-links", title: "2,940 anonymous links found" });
    expect(buildRaiseChangeRequestInputForChecklistItem(item).workloadOverride).toBe("SharePoint");
  });

  it("packs the finding's real content into the proposed payload — no invented fields", () => {
    const item = makeItem();
    const input = buildRaiseChangeRequestInputForChecklistItem(item);
    expect(input.post).toMatchObject({
      checkKey: item.checkKey,
      findingId: item.findingId,
      severity: item.severity,
      description: item.description,
      summary: item.summary,
      adminCenterPath: item.adminCenterPath,
      validationCommand: item.validationCommand,
    });
  });
});
