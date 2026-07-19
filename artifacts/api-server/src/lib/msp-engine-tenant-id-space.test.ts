/**
 * msp-engine-tenant-id-space.test.ts
 *
 * Regression test for fetchActiveTenants()/fetchAllActiveTenantsPlatformWide()
 * in msp-engine.ts.
 *
 * The bug (2026-07-18): commit 1690819 consolidated tenant profile resolution
 * into the shared buildTenantProfile(customerId), which strictly expects an
 * `msp_customers.id` — but fetchActiveTenants()/fetchAllActiveTenantsPlatformWide()
 * still selected `id: usersTable.id` (a portal user id). Every tenant in the
 * MSP/platform portfolio-risk views would resolve to empty profile/findings
 * unless a customer's numeric id happened to coincide with its portal user's
 * id — the exact failure mode buildTenantProfile's id-space fix was meant to
 * eliminate, reintroduced by omission in this one spot.
 *
 * This test proves the tenant `id` fed into buildTenantProfile is the
 * msp_customers.id, not the users.id, for a fixture where the two differ.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks (must precede the import of the code under test) ──────────
vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  usersTable: { __table: "users", id: "id", name: "name", role: "role" },
  mspUsersTable: { __table: "msp_users", userId: "userId", customerId: "customerId" },
  mspCustomersTable: { __table: "msp_customers", id: "id", mspId: "mspId" },
  mspsTable: { __table: "msps", id: "id", status: "status" },
  mspScoreHistoryTable: { __table: "msp_score_history" },
  mspEventStoreTable: { __table: "msp_event_store" },
}));

vi.mock("./logger.ts", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock("./tenant-signals.ts", async () => {
  const actual = await vi.importActual<typeof import("./tenant-signals.ts")>("./tenant-signals.ts");
  return {
    ...actual,
    buildTenantProfile: vi.fn(async (customerId: number) => ({
      mergedProfile: { customerId },
      findings: [],
    })),
    computeTenantSignals: vi.fn(() => ({ firedSignals: new Set<string>() })),
    getDisabledSignalKeys: vi.fn(async () => new Set<string>()),
  };
});

vi.mock("./health-engine.ts", () => ({
  computeHealthEngine: vi.fn(() => ({ score: 0, breakdown: [] })),
}));

vi.mock("./drift-engine.ts", () => ({
  computeDriftEngine: vi.fn(() => ({ score: 0, breakdown: [] })),
}));

vi.mock("./priority-engine.ts", () => ({
  fetchSignalRulesAndGroups: vi.fn(async () => ({ rules: [], groups: [] })),
  rankFiredSignals: vi.fn(() => []),
  sumPriorityScore: vi.fn(() => ({ score: 0, breakdown: [] })),
  getSignalWeights: vi.fn(async () => []),
}));

import { db } from "@workspace/db";
import { buildTenantProfile } from "./tenant-signals.ts";
import { calculateMspPortfolioRisk, calculatePlatformPortfolioRisk } from "./msp-engine.ts";

// The regression fixture: a portal user id that DIFFERS from the
// msp_customers.id it maps to. The old buggy code would select the former.
const PORTAL_USER_ID = 777;
const MSP_CUSTOMER_ID = 42;

function makeSelectMock() {
  const b: Record<string, unknown> = {
    from: vi.fn(() => b),
    innerJoin: vi.fn(() => b),
    where: vi.fn(() =>
      Promise.resolve([{ id: MSP_CUSTOMER_ID, name: "Acme" }]),
    ),
  };
  return b;
}

beforeEach(() => {
  vi.clearAllMocks();
  (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => makeSelectMock());
});

describe("msp-engine tenant id-space regression", () => {
  it("calculateMspPortfolioRisk feeds buildTenantProfile the msp_customers.id, not the users.id", async () => {
    const output = await calculateMspPortfolioRisk(1);

    expect(buildTenantProfile).toHaveBeenCalledWith(MSP_CUSTOMER_ID);
    expect(buildTenantProfile).not.toHaveBeenCalledWith(PORTAL_USER_ID);
    expect(output.breakdown[0]?.customerId).toBe(MSP_CUSTOMER_ID);
  });

  it("calculatePlatformPortfolioRisk feeds buildTenantProfile the msp_customers.id, not the users.id", async () => {
    const output = await calculatePlatformPortfolioRisk();

    expect(buildTenantProfile).toHaveBeenCalledWith(MSP_CUSTOMER_ID);
    expect(buildTenantProfile).not.toHaveBeenCalledWith(PORTAL_USER_ID);
    expect(output.breakdown[0]?.customerId).toBe(MSP_CUSTOMER_ID);
  });
});
