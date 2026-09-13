/**
 * graph-write-license-gap.test.ts — Git #3937
 *
 * Real, live-confirmed evidence: `action.create-ca-signin-risk-policy` and
 * `action.create-ca-user-risk-policy` (write_action_catalog rows 139/140) both
 * returned a real 403 `{"error":{"code":"AccessDenied","message":"Your tenant is
 * not licensed for this feature. Please upgrade your subscription to access
 * it."}}` against the testbed tenant, which lacks Entra ID P1/P2. Before this
 * fix, `graphWriteForTenant` collapsed EVERY non-consent 401/403 to
 * `errorType: "insufficient_privilege"` — the read path (graphFetchForTenant)
 * already classified this exact body shape as a license gap via
 * `classifyGraphError`, but the write path had no equivalent, so a real license
 * shortfall was indistinguishable from an actual privilege failure.
 *
 * These tests exercise `graphWriteForTenant` itself (not just the underlying
 * classifier, which graph-consent-revoke.test.ts already covers in isolation)
 * so a regression that skips the new branch — or puts it in the wrong order
 * relative to the consent check — is caught here.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

process.env.MT_APP_WRITE_CLIENT_ID = "write-client-id";
process.env.MT_APP_WRITE_CLIENT_SECRET = "write-client-secret";
process.env.JWT_SECRET = "test-jwt-secret";

// ── DB mock — a minimal chainable `select` covering both real gate shapes
// graphWriteForTenant reads before it ever touches Graph:
//   Gate 1: db.select({...}).from(tenantsTable).innerJoin(mspsTable, eq(...)).where(...).limit(1)
//   Gate 2: db.select({...}).from(tenantsTable).where(...).limit(1)
// Both terminate in `.limit(1)`, so tests queue their two real rows via
// consecutive `mockResolvedValueOnce` calls in gate order.
const limitMock = vi.fn();
const whereMock = vi.fn(() => ({ limit: limitMock }));
const innerJoinMock = vi.fn(() => ({ where: whereMock }));
const fromMock = vi.fn(() => ({ innerJoin: innerJoinMock, where: whereMock }));
const selectMock = vi.fn(() => ({ from: fromMock }));

vi.mock("@workspace/db", () => ({
  db: { select: (_arg?: unknown) => selectMock() },
  tenantsTable: { mspId: "msp_id", tenantId: "tenant_id", consent: "consent" },
  mspsTable: { id: "id", writeBackEnabled: "write_back_enabled" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ op: "eq", a, b })),
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
}));

vi.mock("./logger.ts", () => {
  const child = vi.fn();
  const base = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child };
  child.mockReturnValue(base);
  return { logger: base };
});

import { graphWriteForTenant } from "./graph.ts";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const tokenOk = () => ({ ok: true, json: async () => ({ access_token: "write-tok", expires_in: 3600 }) });

// The exact real body captured live from the testbed tenant (#3937's own evidence).
const CA_LICENSE_GAP_BODY =
  '{"error":{"code":"AccessDenied","message":"Your tenant is not licensed for this feature. Please upgrade your subscription to access it."}}';

const graphLicenseGap403 = () => ({
  ok: false,
  status: 403,
  headers: new Headers(),
  text: async () => CA_LICENSE_GAP_BODY,
});

const graphPlain403 = () => ({
  ok: false,
  status: 403,
  headers: new Headers(),
  text: async () => '{"error":{"code":"Authorization_RequestDenied","message":"Insufficient privileges to complete the operation."}}',
});

const WRITE_BACK_GATE_ROW = { mspId: 1, writeBackEnabled: true };
const WRITE_CONSENT_GRANTED_ROW = { consent: { writeBack: { status: "granted" } } };

describe("graphWriteForTenant — license/feature gap classification (Git #3937)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitMock.mockReset();
  });

  it("classifies a real CA license-gap 403 as errorType:license_gap, not insufficient_privilege", async () => {
    limitMock.mockResolvedValueOnce([WRITE_BACK_GATE_ROW]).mockResolvedValueOnce([WRITE_CONSENT_GRANTED_ROW]);
    mockFetch.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(graphLicenseGap403());

    const result = await graphWriteForTenant(
      "tenant-ca-1",
      101,
      "/identity/conditionalAccess/policies",
      "POST",
      { displayName: "Require MFA for risky sign-ins" },
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe(403);
    expect(result.errorType).toBe("license_gap");
    expect(result.licenseFeature).toBe("a required Microsoft 365 add-on license");
    expect(result.data).toBe(CA_LICENSE_GAP_BODY);
  });

  it("still classifies a genuine (non-license) 403 as insufficient_privilege, unchanged", async () => {
    limitMock.mockResolvedValueOnce([WRITE_BACK_GATE_ROW]).mockResolvedValueOnce([WRITE_CONSENT_GRANTED_ROW]);
    mockFetch.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(graphPlain403());

    const result = await graphWriteForTenant("tenant-ca-2", 102, "/users", "POST", { displayName: "x" });

    expect(result.success).toBe(false);
    expect(result.status).toBe(403);
    expect(result.errorType).toBe("insufficient_privilege");
    expect(result.licenseFeature).toBeUndefined();
  });
});
