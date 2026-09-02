/**
 * portal-change-control.test.ts — the Change Control derivations.
 *
 * These are worth testing rather than eyeballing for one reason: two of them
 * decide authority. `computeRiskLevel` sets how many approvals a change needs,
 * and `deriveWorkload`'s clause ORDER decides which workload a change is filed
 * under. Both were ported from the design prototype's own logic class, so the
 * cases below are pinned to the prototype's real seed rows — if a future edit
 * reorders the workload clauses or relaxes a risk threshold, a named example
 * from the design breaks rather than a synthetic one.
 */

import { describe, it, expect } from "vitest";

import {
  CHANGE_REQUEST_STORED_STATUSES,
  approvalLines,
  canApprove,
  canRollback,
  categoryForWorkload,
  computeRiskLevel,
  deriveWorkload,
  deriveWorkloadFromTouches,
  displayChangeClass,
  displayRiskLevel,
  displayStatus,
  formatChangeRequestCode,
  formatSnapshotJson,
  isOpenStatus,
  storedChangeClass,
  workloadForCheckKey,
  workloadForCategory,
} from "./portal-change-control";

describe("displayStatus", () => {
  it("is total over every stored status — no row can render a blank chip", () => {
    for (const stored of CHANGE_REQUEST_STORED_STATUSES) {
      expect(displayStatus(stored, null)).toBeTruthy();
      expect(displayStatus(stored, "someone@example.com")).toBeTruthy();
    }
  });

  it("derives Approved from pending_approval + a recorded approver", () => {
    expect(displayStatus("pending_approval", null)).toBe("Pending approval");
    expect(displayStatus("pending_approval", "it-lead@example.com")).toBe("Approved");
  });

  it("treats a blank or whitespace approver as no approver", () => {
    expect(displayStatus("pending_approval", "")).toBe("Pending approval");
    expect(displayStatus("pending_approval", "   ")).toBe("Pending approval");
  });

  it("maps the remaining stored values to the prototype's labels", () => {
    expect(displayStatus("scheduled", null)).toBe("Scheduled");
    expect(displayStatus("in_progress", null)).toBe("In window");
    expect(displayStatus("completed", null)).toBe("Implemented");
    expect(displayStatus("rejected", null)).toBe("Rejected");
    expect(displayStatus("rolled_back", null)).toBe("Rolled back");
  });

  it("never overstates what happened when the stored value is unknown", () => {
    // The column is free text at the database level. An unrecognised value must
    // not read as "Implemented" to a customer looking at their own tenant.
    expect(displayStatus("something_new", null)).toBe("Pending approval");
  });
});

describe("computeRiskLevel", () => {
  it("rates every emergency change High regardless of blast radius", () => {
    expect(
      computeRiskLevel({ changeClass: "Emergency", targetResource: "anything", impactedUsersCount: 1 }),
    ).toBe("High");
  });

  it("rates the prototype's own seed targets the way the prototype does", () => {
    // CR-2026-0183 — enable CA001, 1240 accounts.
    expect(
      computeRiskLevel({
        changeClass: "Normal",
        targetResource: "PATCH /v1.0/identity/conditionalAccess/policies/{id}",
        impactedUsersCount: 1240,
      }),
    ).toBe("High");

    // CR-2026-0181 — disable SMTP AUTH. Only THREE accounts in scope, so the
    // High rating comes entirely from the TransportConfig pattern. This is the
    // case that proves the pattern match is doing real work.
    expect(
      computeRiskLevel({
        changeClass: "Normal",
        targetResource: "Exchange Online · Set-TransportConfig -SmtpClientAuthenticationDisabled $true",
        impactedUsersCount: 3,
      }),
    ).toBe("High");

    // CR-2026-0179 — Preservation Lock, immutable retention.
    expect(
      computeRiskLevel({
        changeClass: "Normal",
        targetResource: "Purview · Set-RetentionCompliancePolicy -RestrictiveRetention $true",
        impactedUsersCount: 1240,
      }),
    ).toBe("High");

    // CR-2026-0176 — KFM pilot ring, 20 devices.
    expect(
      computeRiskLevel({
        changeClass: "Standard",
        targetResource: "POST /v1.0/deviceManagement/deviceConfigurations",
        impactedUsersCount: 20,
      }),
    ).toBe("Low");
  });

  it("honours the prototype's exact 50 / 500 boundaries", () => {
    const at = (n: number) =>
      computeRiskLevel({ changeClass: "Normal", targetResource: "/v1.0/groups", impactedUsersCount: n });
    expect(at(50)).toBe("Low"); // > 50, not >=
    expect(at(51)).toBe("Medium");
    expect(at(500)).toBe("Medium"); // > 500, not >=
    expect(at(501)).toBe("High");
  });

  it("matches the risk patterns case-insensitively, as the prototype's /i does", () => {
    expect(
      computeRiskLevel({
        changeClass: "Normal",
        targetResource: "patch /v1.0/identity/CONDITIONALACCESS/policies",
        impactedUsersCount: 1,
      }),
    ).toBe("High");
  });
});

describe("deriveWorkload", () => {
  it("classifies the prototype's own seed targets", () => {
    expect(deriveWorkload("PATCH /v1.0/identity/conditionalAccess/policies/{id}")).toBe(
      "Conditional Access",
    );
    expect(deriveWorkload("Exchange Online · Set-TransportConfig -SmtpClientAuthenticationDisabled $true")).toBe(
      "Exchange / mail",
    );
    expect(deriveWorkload("POST /v1.0/deviceManagement/deviceConfigurations")).toBe("Intune");
    expect(deriveWorkload("Purview · Set-RetentionCompliancePolicy -RestrictiveRetention $true")).toBe(
      "Purview",
    );
    expect(deriveWorkload("SharePoint · Set-SPOTenant -DefaultSharingLinkType Direct")).toBe("SharePoint");
    expect(deriveWorkload("PATCH /v1.0/policies/authorizationPolicy")).toBe("Identity");
  });

  it("keeps the prototype's clause ORDER — Purview wins over SharePoint", () => {
    // A retention change scoped to a SharePoint site matches BOTH the
    // /Retention|Compliance/ and /SPO|SharePoint/ patterns. The prototype tests
    // Purview first, so it files as Purview. Reordering the clauses silently
    // reclassifies changes, which is exactly what this case exists to catch.
    expect(deriveWorkload("Set-RetentionCompliancePolicy -SharePointLocation https://x.sharepoint.com")).toBe(
      "Purview",
    );
  });
});

describe("workloadForCheckKey", () => {
  it("classifies real remediation_knowledge_base check_key prefixes (#1941)", () => {
    expect(workloadForCheckKey("exchange:mail-flow-rule-review")).toBe("Exchange / mail");
    expect(workloadForCheckKey("sharepoint:orgwide-links")).toBe("SharePoint");
    expect(workloadForCheckKey("onedrive:external-sharing")).toBe("SharePoint");
    expect(workloadForCheckKey("devices:stale-duplicate-records")).toBe("Intune");
    expect(workloadForCheckKey("security:secure-score")).toBe("Defender");
    expect(workloadForCheckKey("compliance:zero-dlp-policies")).toBe("Purview");
    expect(workloadForCheckKey("teams:external-access")).toBe("Teams");
    expect(workloadForCheckKey("identity:ca-mfa-coverage")).toBe("Identity");
  });

  it("falls through to Identity for a prefix with no unambiguous workload — the same 'no better answer' default deriveWorkload itself uses", () => {
    expect(workloadForCheckKey("governance:guest-count")).toBe("Identity");
    expect(workloadForCheckKey("copilot:adoption-rate")).toBe("Identity");
    expect(workloadForCheckKey("m365:license-waste")).toBe("Identity");
  });

  it("is case-insensitive on the prefix and tolerates a key with no colon", () => {
    expect(workloadForCheckKey("SharePoint:orgwide-links")).toBe("SharePoint");
    expect(workloadForCheckKey("no-prefix-here")).toBe("Identity");
  });

  it("falls back to Identity for a target it cannot classify", () => {
    expect(deriveWorkload("something entirely unrecognised")).toBe("Identity");
  });
});

describe("deriveWorkloadFromTouches — Git #1700", () => {
  it("classifies CR-2026-183's real touches as Exchange, not Identity", () => {
    // interpretation id 4 / MC1287370 — "Auto upgrade of shared calendars from
    // legacy MAPI model to modern REST model". deriveWorkload(targetResource)
    // fell through to Identity because the flattened display string
    // ("Exchange Online, Outlook, MAPI, REST, Shared calendars") matches none
    // of its cmdlet/endpoint patterns. Reading touches.services directly fixes it.
    expect(
      deriveWorkloadFromTouches({ services: ["Exchange Online", "Outlook"], settings: ["Shared calendars"] }),
    ).toBe("Exchange / mail");
  });

  it("classifies Conditional Access, Purview, Intune, Defender, Teams and SharePoint from services", () => {
    expect(deriveWorkloadFromTouches({ services: ["Azure AD Conditional Access"], settings: [] })).toBe(
      "Conditional Access",
    );
    expect(deriveWorkloadFromTouches({ services: ["Microsoft Purview"], settings: [] })).toBe("Purview");
    expect(deriveWorkloadFromTouches({ services: ["Microsoft Intune"], settings: [] })).toBe("Intune");
    expect(deriveWorkloadFromTouches({ services: ["Microsoft Defender for Office 365"], settings: [] })).toBe(
      "Defender",
    );
    expect(deriveWorkloadFromTouches({ services: ["Microsoft Teams"], settings: [] })).toBe("Teams");
    expect(deriveWorkloadFromTouches({ services: ["SharePoint Online"], settings: [] })).toBe("SharePoint");
  });

  it("keeps clause ORDER — Purview wins over SharePoint, same reasoning as deriveWorkload", () => {
    expect(
      deriveWorkloadFromTouches({ services: ["SharePoint Online"], settings: ["Retention policy"] }),
    ).toBe("Purview");
  });

  it("falls back to Identity when touches carry no recognisable workload signal", () => {
    expect(deriveWorkloadFromTouches({ services: [], settings: [] })).toBe("Identity");
    expect(deriveWorkloadFromTouches({ services: ["Azure AD"], settings: [] })).toBe("Identity");
  });
});

describe("workload ⟷ category", () => {
  it("round-trips every one of the eight workloads", () => {
    const workloads = [
      "Conditional Access",
      "Exchange / mail",
      "Identity",
      "Intune",
      "Defender",
      "SharePoint",
      "Purview",
      "Teams",
    ] as const;
    for (const w of workloads) {
      expect(workloadForCategory(categoryForWorkload(w))).toBe(w);
    }
  });

  it("renders an unknown stored category rather than throwing", () => {
    // The column is free text; a row written before the mapping existed still
    // has to appear in the customer's register.
    expect(workloadForCategory("SomethingElse")).toBe("Identity");
  });
});

describe("change class", () => {
  it("round-trips the three classes", () => {
    for (const c of ["Standard", "Normal", "Emergency"] as const) {
      expect(displayChangeClass(storedChangeClass(c))).toBe(c);
    }
  });

  it("defaults an unrecognised stored class to Normal", () => {
    expect(displayChangeClass("weird")).toBe("Normal");
  });
});

describe("displayRiskLevel", () => {
  it("surfaces a stored critical rather than softening it", () => {
    // The prototype has no colour for Critical and falls through to slate; what
    // matters is that a critical change never renders as something milder.
    expect(displayRiskLevel("critical")).toBe("Critical");
    expect(displayRiskLevel("high")).toBe("High");
    expect(displayRiskLevel("medium")).toBe("Medium");
    expect(displayRiskLevel("low")).toBe("Low");
  });

  it("defaults an unrecognised stored level to High, never to Low", () => {
    expect(displayRiskLevel("")).toBe("High");
  });
});

describe("approvalLines", () => {
  it("does not invent an approver that nothing recorded", () => {
    expect(approvalLines({ status: "pending_approval", approvedBy: null, changeClass: "Normal" })).toEqual([
      "Awaiting approval",
    ]);
  });

  it("reports a standard change as pre-approved, matching the prototype", () => {
    expect(approvalLines({ status: "pending_approval", approvedBy: null, changeClass: "Standard" })).toEqual([
      "Pre-approved — standard change",
    ]);
  });

  it("names the approver when one is recorded", () => {
    expect(approvalLines({ status: "scheduled", approvedBy: "it-lead@example.com", changeClass: "Normal" })).toEqual(
      ["Approved by it-lead@example.com"],
    );
  });

  it("says rejected, not approved, for a rejected change carrying an approver value", () => {
    expect(approvalLines({ status: "rejected", approvedBy: "it-lead@example.com", changeClass: "Normal" })).toEqual([
      "Rejected by it-lead@example.com",
    ]);
  });
});

describe("action flags", () => {
  it("offers approve only while pending and rollback only once implemented", () => {
    expect(canApprove("Pending approval")).toBe(true);
    expect(canApprove("Approved")).toBe(false);
    expect(canApprove("Implemented")).toBe(false);
    expect(canRollback("Implemented")).toBe(true);
    expect(canRollback("Rolled back")).toBe(false);
    expect(canRollback("Pending approval")).toBe(false);
  });
});

describe("isOpenStatus", () => {
  it("counts the prototype's four open statuses and nothing else", () => {
    expect(isOpenStatus("Pending approval")).toBe(true);
    expect(isOpenStatus("Approved")).toBe(true);
    expect(isOpenStatus("Scheduled")).toBe(true);
    expect(isOpenStatus("In window")).toBe(true);
    expect(isOpenStatus("Implemented")).toBe(false);
    expect(isOpenStatus("Rejected")).toBe(false);
    expect(isOpenStatus("Rolled back")).toBe(false);
  });
});

describe("formatChangeRequestCode", () => {
  it("matches the MSP console's formatter exactly, so one row has one code", () => {
    expect(formatChangeRequestCode(1)).toBe("CR-2026-101");
    expect(formatChangeRequestCode(84)).toBe("CR-2026-184");
  });
});

describe("formatSnapshotJson", () => {
  it("renders jsonb with the prototype's two-space indent", () => {
    expect(formatSnapshotJson({ SmtpClientAuthenticationDisabled: false })).toBe(
      '{\n  "SmtpClientAuthenticationDisabled": false\n}',
    );
  });

  it("renders an empty object for a null or absent snapshot", () => {
    expect(formatSnapshotJson(null)).toBe("{}");
    expect(formatSnapshotJson(undefined)).toBe("{}");
  });

  it("does not throw on a circular value", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatSnapshotJson(circular)).toBe("{}");
  });
});
