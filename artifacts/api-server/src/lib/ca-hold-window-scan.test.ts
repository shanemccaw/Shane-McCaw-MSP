/**
 * ca-hold-window-scan.test.ts — Git #4550.
 *
 * `deriveHoldScanFromImpact` turns a real `evaluateCaPolicyImpact` result
 * into the verdict/evidence sentence the customer-facing hold-window card
 * shows — every number in the assertions below flows from the fixture, none
 * is a canned string. `handleCaPolicyHoldWindowScan` is the DB write: real
 * evaluator (mocked here, the same discipline msp-ca-policy-promotion.test.ts
 * already uses — the evaluator itself is covered by ca-policy-impact.test.ts),
 * real `portal_hold_windows` update asserted via the mocked db chain.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaPolicyImpact } from "./ca-policy-promotion.ts";

const POLICY = "6f2a1b0e-2c1d-4d8e-9a55-0b7f1c3e9d21";
const TENANT_GUID = "c4c814d4-3afe-441e-9145-62461d0a4fd3";

let selectRows: Array<{ hold: Record<string, unknown>; tenantId: string | null }> = [];
let updateCalls: Array<{ id: number; values: Record<string, unknown> }> = [];

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: async () => selectRows,
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async (predicate: { holdId: number }) => {
          updateCalls.push({ id: predicate.holdId, values });
        },
      }),
    }),
  },
  portalHoldWindowsTable: {
    id: "id",
    policyId: "policy_id",
    closedAt: "closed_at",
    customerId: "customer_id",
    scanVerdict: "scan_verdict",
    scanLine: "scan_line",
    scanSource: "scan_source",
    scanAt: "scan_at",
    updatedAt: "updated_at",
  },
  tenantsTable: { id: "id", tenantId: "tenant_id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: string, value: unknown) => (column === "id" ? { holdId: value } : { eq: [column, value] }),
  and: (...args: unknown[]) => ({ and: args.filter((a) => a !== undefined) }),
  isNotNull: (column: string) => ({ isNotNull: column }),
  isNull: (column: string) => ({ isNull: column }),
}));

vi.mock("./logger.ts", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

const evaluateCaPolicyImpact = vi.fn();
vi.mock("./ca-policy-promotion.ts", () => ({
  evaluateCaPolicyImpact: (...a: unknown[]) => evaluateCaPolicyImpact(...a),
}));

const { deriveHoldScanFromImpact, handleCaPolicyHoldWindowScan } = await import("./ca-hold-window-scan.ts");

function impact(over: Partial<CaPolicyImpact> = {}): CaPolicyImpact {
  return {
    status: "ok",
    detail: null,
    evaluatedAt: "2026-09-17T12:00:00.000Z",
    policy: { id: POLICY, displayName: "Baseline MFA (report-only)", state: "enabledForReportingButNotEnforced", createdDateTime: null, modifiedDateTime: "2026-09-10T09:00:00Z" },
    window: { from: "2026-09-10T09:00:00.000Z", to: "2026-09-17T12:00:00.000Z", reportOnlySince: "2026-09-10T09:00:00.000Z", reportOnlyDays: 7, clampedToRetention: false },
    complete: true,
    pagesRead: 1,
    oldestSignInRead: "2026-09-10T10:00:00Z",
    summary: { signInsScanned: 10, evaluated: 5, wouldBlock: 0, wouldInterrupt: 0, wouldSatisfy: 5, notApplied: 0, affectedUserCount: 0, affectedUsers: [], impactEvents: [] },
    readiness: { eligible: true, ineligibleReason: null, requiresAcknowledgement: false, acknowledgementReasons: [] },
    fingerprint: "f".repeat(64),
    coverageNote: "note",
    ...over,
  };
}

describe("deriveHoldScanFromImpact", () => {
  it("writes 'watch' with the real reason when the read itself failed — never silently dropped", () => {
    const r = deriveHoldScanFromImpact(impact({ status: "consent_revoked", detail: "Admin consent revoked.", summary: null, window: null }));
    expect(r.verdict).toBe("watch");
    expect(r.scanLine).toContain("consent_revoked");
    expect(r.scanLine).toContain("Admin consent revoked.");
  });

  it("'signals' when sign-ins would have been blocked, with the real counts in the sentence", () => {
    const r = deriveHoldScanFromImpact(impact({
      summary: { signInsScanned: 40, evaluated: 12, wouldBlock: 2, wouldInterrupt: 0, wouldSatisfy: 10, notApplied: 0, affectedUserCount: 2, affectedUsers: [], impactEvents: [] },
    }));
    expect(r.verdict).toBe("signals");
    expect(r.scanLine).toBe("2 sign-ins would have been blocked in the last 7 days across 2 users. Enforcing today breaks this.");
  });

  it("singular phrasing for exactly one blocked sign-in / one user", () => {
    const r = deriveHoldScanFromImpact(impact({
      summary: { signInsScanned: 5, evaluated: 1, wouldBlock: 1, wouldInterrupt: 0, wouldSatisfy: 0, notApplied: 0, affectedUserCount: 1, affectedUsers: [], impactEvents: [] },
    }));
    expect(r.scanLine).toBe("1 sign-in would have been blocked in the last 7 days across 1 user. Enforcing today breaks this.");
  });

  it("'watch' when sign-ins would only have been interrupted (no block)", () => {
    const r = deriveHoldScanFromImpact(impact({
      summary: { signInsScanned: 20, evaluated: 3, wouldBlock: 0, wouldInterrupt: 3, wouldSatisfy: 0, notApplied: 0, affectedUserCount: 2, affectedUsers: [], impactEvents: [] },
    }));
    expect(r.verdict).toBe("watch");
    expect(r.scanLine).toBe("3 sign-ins would have been interrupted for a grant control in the last 7 days, affecting 2 users. Worth a look before the window closes.");
  });

  it("'watch' when nothing has been evaluated yet — no evidence, not fabricated as clear", () => {
    const r = deriveHoldScanFromImpact(impact({
      summary: { signInsScanned: 0, evaluated: 0, wouldBlock: 0, wouldInterrupt: 0, wouldSatisfy: 0, notApplied: 0, affectedUserCount: 0, affectedUsers: [], impactEvents: [] },
    }));
    expect(r.verdict).toBe("watch");
    expect(r.scanLine).toContain("no evidence of its impact so far");
  });

  it("'clear' when evaluated sign-ins exist and none would have blocked or interrupted", () => {
    const r = deriveHoldScanFromImpact(impact());
    expect(r.verdict).toBe("clear");
    expect(r.scanLine).toBe("No sign-in would have been blocked or interrupted in the last 7 days (5 sign-ins evaluated). Clear to close early.");
  });

  it("notes an incomplete read rather than presenting a partial scan as final", () => {
    const r = deriveHoldScanFromImpact(impact({ complete: false }));
    expect(r.scanLine).toContain("Not every sign-in in the period could be read");
  });
});

describe("handleCaPolicyHoldWindowScan", () => {
  beforeEach(() => {
    selectRows = [];
    updateCalls = [];
    evaluateCaPolicyImpact.mockReset();
  });

  it("scans every open CA-gated window and writes the derived verdict", async () => {
    selectRows = [
      { hold: { id: 501, policyId: POLICY, customerId: 2080 }, tenantId: TENANT_GUID },
    ];
    evaluateCaPolicyImpact.mockResolvedValue(impact({
      summary: { signInsScanned: 4, evaluated: 2, wouldBlock: 2, wouldInterrupt: 0, wouldSatisfy: 0, notApplied: 0, affectedUserCount: 1, affectedUsers: [], impactEvents: [] },
    }));

    const summary = await handleCaPolicyHoldWindowScan({}, {});

    expect(evaluateCaPolicyImpact).toHaveBeenCalledWith(TENANT_GUID, POLICY);
    expect(summary).toMatchObject({ windowsConsidered: 1, signals: 1, clear: 0, watch: 0, errors: 0 });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.id).toBe(501);
    expect(updateCalls[0]!.values["scanVerdict"]).toBe("signals");
    expect(updateCalls[0]!.values["scanSource"]).toBe("Report-only sign-in logs");
    expect(updateCalls[0]!.values["scanAt"]).toBeInstanceOf(Date);
  });

  it("records an error and keeps going rather than dropping the row silently", async () => {
    selectRows = [{ hold: { id: 501, policyId: POLICY, customerId: 2080 }, tenantId: TENANT_GUID }];
    evaluateCaPolicyImpact.mockRejectedValue(new Error("graph timeout"));

    const summary = await handleCaPolicyHoldWindowScan({}, {});

    expect(summary.errors).toBe(1);
    expect(updateCalls).toHaveLength(0);
  });

  it("scopes to one tenant when payload.customerId is set (event-triggered rescan)", async () => {
    selectRows = [{ hold: { id: 501, policyId: POLICY, customerId: 2080 }, tenantId: TENANT_GUID }];
    evaluateCaPolicyImpact.mockResolvedValue(impact());

    const summary = await handleCaPolicyHoldWindowScan({}, { customerId: 2080 });

    expect(summary.scopedCustomerId).toBe(2080);
  });
});
