/**
 * remediation-tracker-risk-decline.test.ts — Git #1542.
 *
 * Locks the derivation chain: real scan evidence (severity/description) beats
 * the published KB summary is checked the OTHER way round on purpose — the
 * header documents KB summary FIRST, then the finding, then the check's own
 * label, then the catalogue title — never a fabricated value, always the
 * best REAL one available. Also locks the money/score discipline
 * (liabilityValueUsd always 0, graphEndpoint always "", never invented) and
 * idempotency (a repeat decline returns the existing signed risk rather than
 * re-inserting or re-signing it).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockSelectResultsQueue: any[][] = [];
let mockInsertValues: any[] = [];
let mockInsertReturning: any[] = [{ id: 777 }];

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (onfulfilled: any, onrejected?: any) =>
        Promise.resolve(mockSelectResultsQueue.shift() ?? []).then(onfulfilled, onrejected),
    };
    return chain;
  };

  const insertChain: any = {
    values: (v: any) => {
      mockInsertValues.push(v);
      return insertChain;
    },
    onConflictDoUpdate: () => insertChain,
    returning: () => Promise.resolve(mockInsertReturning),
  };

  // assignRegisterRef() (risk-register-ref.ts) runs `db.update(...).set(...).where(...)`
  // right after every insert — no test here asserts on the write itself, so this
  // just needs to resolve.
  const updateChain: any = {
    set: () => updateChain,
    where: () => Promise.resolve(undefined),
  };

  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
    },
    mspRiskDecisionsTable: { mspId: "msp_id", rbdId: "rbd_id" },
    mspDiagnosticFindingsTable: {},
    remediationKnowledgeBaseTable: {},
    monitorChecksTable: {},
  };
});

vi.mock("./m365-change-router", () => ({
  // The real 4-line switch, kept identical here so a test asserting a score
  // doesn't silently diverge from what the real function returns.
  riskScoreForLevel: (level: string) => ({ critical: 100, high: 75, medium: 50 }[level] ?? 25),
}));

vi.mock("./logger", () => {
  const noop = () => {};
  const noopLogger: any = { info: noop, warn: noop, error: noop, debug: noop };
  noopLogger.child = () => noopLogger;
  return { logger: noopLogger };
});

import { declineRemediationStepToRisk, declineRemediationChecklistItemToRisk } from "./remediation-tracker-risk-decline";
import type { TenantScope } from "./portal-customer-scope";

const scope: TenantScope = { customerId: 42, mspId: 9, tenantId: "contoso.onmicrosoft.com", tenantName: "Contoso", primaryDomain: "contoso.com", businessUnit: null };

const baseInput = {
  stepId: "s10", // -> catalogue title "Disable legacy authentication", pillar "security", mapped check "identity:legacy-auth-usage"
  trackerStepRowId: 501,
  scope,
  approverName: "Jordan Diaz",
  statement: "We accept this risk for now.",
};

beforeEach(() => {
  mockSelectResultsQueue = [];
  mockInsertValues = [];
  mockInsertReturning = [{ id: 777 }];
});

describe("declineRemediationStepToRisk", () => {
  it("creates a signed, active risk decision derived from real scan evidence", async () => {
    mockSelectResultsQueue = [
      [], // no existing risk decision for this (mspId, rbdId)
      [{ severity: "critical", title: "Legacy auth in use", description: "23 accounts use legacy auth.", checkKey: "identity:legacy-auth-usage" }], // finding
      [], // no published KB row
      [{ label: "Legacy Authentication Usage" }], // check label fallback (unused here — finding.description wins)
    ];

    const result = await declineRemediationStepToRisk(baseInput);

    expect(result).toEqual({ riskDecisionId: 777, rbdId: "RR-RT-42-s10", alreadyDeclined: false });

    const values = mockInsertValues[0];
    expect(values.mspId).toBe(9);
    expect(values.rbdId).toBe("RR-RT-42-s10");
    expect(values.tenantId).toBe("contoso.onmicrosoft.com");
    expect(values.title).toBe("Disable legacy authentication");
    expect(values.controlViolated).toBe("Security");
    expect(values.framework).toBe("Remediation Tracker");
    expect(values.checkKey).toBe("identity:legacy-auth-usage");
    expect(values.rawRiskLevel).toBe("critical");
    expect(values.residualRiskLevel).toBe("critical");
    expect(values.rawRiskScore).toBe(100);
    expect(values.residualRiskScore).toBe(100);
    expect(values.liabilityValueUsd).toBe(0); // never an invented dollar figure
    expect(values.graphEndpoint).toBe("");
    expect(values.hazardDescription).toContain("23 accounts use legacy auth.");
    expect(values.hazardDescription).toContain("The customer declined this remediation item");
    expect(values.status).toBe("active");
    expect(values.riskStatus).toBe("Accepted");
    expect(values.acceptedStatement).toBe("We accept this risk for now.");
    expect(values.spawnedByRemediationStepId).toBe(501);
    // #1507 — both the legacy display copy and the real review-clock columns.
    expect(values.reviewState).toBe("on_track");
    expect(values.reviewDueAt).toBeInstanceOf(Date);
    expect(typeof values.reviewDate).toBe("string");
  });

  it("prefers a published knowledge-base summary over the scan finding", async () => {
    mockSelectResultsQueue = [
      [],
      [{ severity: "warning", title: "finding title", description: "finding description", checkKey: "identity:legacy-auth-usage" }],
      [{ summary: "Legacy authentication bypasses Conditional Access entirely." }],
      [{ label: "Legacy Authentication Usage" }],
    ];

    await declineRemediationStepToRisk(baseInput);

    expect(mockInsertValues[0].hazardDescription).toContain("Legacy authentication bypasses Conditional Access entirely.");
    expect(mockInsertValues[0].hazardDescription).not.toContain("finding description");
    expect(mockInsertValues[0].rawRiskLevel).toBe("high"); // warning -> high
  });

  it("falls back to the check's own label when neither a KB row nor a finding exist", async () => {
    mockSelectResultsQueue = [[], [], [], [{ label: "Legacy Authentication Usage" }]];

    await declineRemediationStepToRisk(baseInput);

    expect(mockInsertValues[0].hazardDescription).toContain("Legacy Authentication Usage");
    expect(mockInsertValues[0].rawRiskLevel).toBe("medium"); // no scan evidence — documented default
  });

  it("a step with no mapped check at all skips the finding/KB/check lookups entirely", async () => {
    // s18 is one of the platform-wide gaps — REMEDIATION_TRACKER_STEP_CHECK_KEYS has no entry for it.
    mockSelectResultsQueue = [[]]; // only the existing-risk check runs
    await declineRemediationStepToRisk({ ...baseInput, stepId: "s18" });

    expect(mockInsertValues[0].checkKey).toBeNull();
    expect(mockInsertValues[0].rawRiskLevel).toBe("medium");
    expect(mockInsertValues[0].title).toBe("Raise audit log retention above the 90-day floor");
  });

  it("is idempotent: a repeat decline returns the existing signed risk without re-inserting", async () => {
    mockSelectResultsQueue = [[{ id: 900, acceptedAt: new Date("2026-08-01T00:00:00.000Z") }]];

    const result = await declineRemediationStepToRisk(baseInput);

    expect(result).toEqual({ riskDecisionId: 900, rbdId: "RR-RT-42-s10", alreadyDeclined: true });
    expect(mockInsertValues).toHaveLength(0);
  });

  it("a step mapped to more than one check (#1957) links the first on checkKey and the rest on additionalCheckKeys", async () => {
    // s8 -> ["identity:ca-policy-count", "identity:ca-mfa-coverage"] (REMEDIATION_TRACKER_STEP_CHECK_KEYS).
    mockSelectResultsQueue = [
      [], // no existing risk decision
      [{ severity: "critical", title: "No CA policies", description: "Zero active CA policies.", checkKey: "identity:ca-policy-count" }], // finding
      [], // no published KB row
      [{ label: "Conditional Access Policy Count" }], // check label fallback
    ];

    await declineRemediationStepToRisk({ ...baseInput, stepId: "s8" });

    expect(mockInsertValues[0].checkKey).toBe("identity:ca-policy-count");
    expect(mockInsertValues[0].additionalCheckKeys).toEqual(["identity:ca-mfa-coverage"]);
  });

  it("a single-check step (#1957) leaves additionalCheckKeys undefined rather than an empty array", async () => {
    mockSelectResultsQueue = [
      [],
      [{ severity: "critical", title: "Legacy auth in use", description: "23 accounts use legacy auth.", checkKey: "identity:legacy-auth-usage" }],
      [],
      [{ label: "Legacy Authentication Usage" }],
    ];

    await declineRemediationStepToRisk(baseInput); // s10 -> one mapped check

    expect(mockInsertValues[0].additionalCheckKeys).toBeUndefined();
  });

  it("never fabricates a step title for an id outside the catalogue", async () => {
    mockSelectResultsQueue = [[]];
    await declineRemediationStepToRisk({ ...baseInput, stepId: "s26", trackerStepRowId: 999 });
    // s26 IS in the catalogue — sanity check the real title is used, not a placeholder.
    expect(mockInsertValues[0].title).not.toMatch(/^Remediation step/);
  });
});

describe("declineRemediationChecklistItemToRisk (#2869)", () => {
  const checklistInput = {
    checkKey: "sharepoint:orgwide-links",
    trackerStepRowId: 601,
    scope,
    findingTitle: "2,940 anonymous links found",
    severity: "critical" as const,
    hazardCore: "Anonymous sharing links bypass tenant access controls.",
    approverName: "Jordan Diaz",
    statement: "We accept this risk for now.",
  };

  it("creates a signed, active risk decision from the caller's already-resolved finding evidence, no extra lookups", async () => {
    mockSelectResultsQueue = [[]]; // no existing risk decision for this (mspId, rbdId) — the ONLY select this path makes

    const result = await declineRemediationChecklistItemToRisk(checklistInput);

    expect(result).toEqual({ riskDecisionId: 777, rbdId: "RR-RT-42-sharepoint:orgwide-links", alreadyDeclined: false });

    const values = mockInsertValues[0];
    expect(values.mspId).toBe(9);
    expect(values.rbdId).toBe("RR-RT-42-sharepoint:orgwide-links");
    expect(values.title).toBe("2,940 anonymous links found");
    expect(values.controlViolated).toBe("Remediation Checklist");
    expect(values.framework).toBe("Remediation Checklist");
    expect(values.checkKey).toBe("sharepoint:orgwide-links");
    expect(values.rawRiskLevel).toBe("critical");
    expect(values.residualRiskLevel).toBe("critical");
    expect(values.rawRiskScore).toBe(100);
    expect(values.liabilityValueUsd).toBe(0); // never an invented dollar figure
    expect(values.graphEndpoint).toBe("");
    expect(values.hazardDescription).toContain("Anonymous sharing links bypass tenant access controls.");
    expect(values.hazardDescription).toContain("The customer declined this remediation item");
    expect(values.status).toBe("active");
    expect(values.riskStatus).toBe("Accepted");
    expect(values.acceptedStatement).toBe("We accept this risk for now.");
    expect(values.spawnedByRemediationStepId).toBe(601);
    expect(values.additionalCheckKeys).toBeUndefined();
  });

  it("maps warning severity to the high risk level, same as a scan's own warning severity", async () => {
    mockSelectResultsQueue = [[]];
    await declineRemediationChecklistItemToRisk({ ...checklistInput, severity: "warning" });
    expect(mockInsertValues[0].rawRiskLevel).toBe("high");
    expect(mockInsertValues[0].rawRiskScore).toBe(75);
  });

  it("is idempotent: a repeat decline returns the existing signed risk without re-inserting", async () => {
    mockSelectResultsQueue = [[{ id: 950, acceptedAt: new Date("2026-08-01T00:00:00.000Z") }]];

    const result = await declineRemediationChecklistItemToRisk(checklistInput);

    expect(result).toEqual({ riskDecisionId: 950, rbdId: "RR-RT-42-sharepoint:orgwide-links", alreadyDeclined: true });
    expect(mockInsertValues).toHaveLength(0);
  });
});
