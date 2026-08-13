/**
 * license-waste-finding-639.test.ts
 *
 * Tests: #639 — a tenant with severe real license waste (24 of 25 paid seats
 * unassigned, in the confirmed live case) still scored a green Licensing pillar
 * with "no critical or warnings", because nothing ever turned
 * `resolveSeatFigures`'s already-correct arithmetic into a finding row. These
 * exercise the two pure functions diagnostics-runner.ts now uses to close that
 * gap: `classifyLicenseWasteSeverity` and `buildLicenseWasteFinding`.
 *
 * diagnostics-runner.ts pulls in the DB, the workflow executor, the narrative
 * generator, the SSE hub, and (since #639) `war-room-pillar-stats.ts` and
 * `license-waste-source.ts` at module load. None of them participate in this
 * arithmetic, so they are stubbed to the minimum that lets the import succeed —
 * same pattern as diagnostics-finding-title.test.ts.
 */

import { describe, it, expect, vi } from "vitest";
import type { SeatFigures } from "./war-room-pillar-stats";

vi.mock("@workspace/db", () => ({
  db: {},
  mspDiagnosticRunsTable: {},
  mspDiagnosticFindingsTable: {},
  tenantsTable: {},
  mspDocumentsTable: {},
  portalWfRunsTable: {},
  portalWfOperatorTasksTable: {},
}));

vi.mock("./monitor-executor", () => ({ executeMonitoringPackage: vi.fn() }));
vi.mock("./workflow-executor", () => ({ emitWorkflowEvent: vi.fn() }));
vi.mock("./cio-narrative-generator", () => ({ generateCioNarrative: vi.fn() }));
vi.mock("./doc-gate-coverage", () => ({ evaluateDocGateCoverage: vi.fn() }));
vi.mock("./war-room-pillar-stats", () => ({ resolveSeatFigures: vi.fn() }));
vi.mock("./license-waste-source", () => ({ DEFAULT_LICENSE_WASTE_CHECK_KEY: "cost:license-waste-estimate" }));
vi.mock("./sse-channels", () => ({
  broadcastDiagnosticsRunProgress: vi.fn(),
  broadcastDiagnosticsRunComplete: vi.fn(),
  broadcastDiagnosticsRunError: vi.fn(),
  clearDiagnosticsRunSSEState: vi.fn(),
}));
vi.mock("./logger", () => {
  const log: Record<string, unknown> = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  log["child"] = () => log;
  return { logger: log };
});

import { classifyLicenseWasteSeverity, buildLicenseWasteFinding } from "./diagnostics-runner";

function seats(over: Partial<SeatFigures>): SeatFigures {
  return {
    provisioned: 25,
    unassigned: 24,
    annualWasteDollars: 10368,
    checkKey: "cost:entra-license-tier-distribution",
    ...over,
  };
}

describe("#639 classifyLicenseWasteSeverity", () => {
  it("is critical when unassigned seats are half or more of provisioned — the confirmed 24/25 tenant", () => {
    expect(classifyLicenseWasteSeverity(24, 25)).toBe("critical");
    expect(classifyLicenseWasteSeverity(5, 10)).toBe("critical");
  });

  it("is warning for real but non-majority waste", () => {
    expect(classifyLicenseWasteSeverity(2, 10)).toBe("warning");
  });

  it("never divides by zero — a provisioned count of 0 is warning, not a crash", () => {
    expect(classifyLicenseWasteSeverity(0, 0)).toBe("warning");
  });
});

describe("#639 buildLicenseWasteFinding", () => {
  it("returns null for a genuinely clean estate — zero unassigned is a real result, not a gap", () => {
    expect(buildLicenseWasteFinding(seats({ unassigned: 0 }))).toBeNull();
  });

  it("builds a critical finding with the real dollar figure for the confirmed severe-waste tenant", () => {
    const finding = buildLicenseWasteFinding(seats({}));
    expect(finding).not.toBeNull();
    expect(finding!.severity).toBe("critical");
    expect(finding!.checkKey).toBe("cost:license-waste-estimate");
    expect(finding!.title).toContain("24 of 25 paid license seats unassigned");
    expect(finding!.title).toContain("$10,368/year");
    expect(finding!.extractedProperties).toMatchObject({
      unassignedPaidSeats: 24,
      provisionedPaidSeats: 25,
      annualWasteDollars: 10368,
      sourceCheckKey: "cost:entra-license-tier-distribution",
    });
  });

  it("never states a dollar figure the estate could not be priced for", () => {
    const finding = buildLicenseWasteFinding(seats({ annualWasteDollars: null }));
    expect(finding!.title).not.toContain("$");
    expect(finding!.title).toBe("24 of 25 paid license seats unassigned");
    expect(finding!.description).toContain("No dollar figure could be priced");
  });

  it("keeps the real /subscribedSkus provenance checkKey in extractedProperties rather than losing it", () => {
    const finding = buildLicenseWasteFinding(seats({ checkKey: "cost:unused-unassigned-licenses" }));
    expect(finding!.extractedProperties).toMatchObject({ sourceCheckKey: "cost:unused-unassigned-licenses" });
    // The finding's OWN checkKey is always the platform's declared identity for
    // this figure, never whichever real check happened to supply the raw page —
    // that is what lets it resolve to the Licensing pillar via the `cost:` domain
    // fallback regardless of which /subscribedSkus check ran this scan.
    expect(finding!.checkKey).toBe("cost:license-waste-estimate");
  });
});
