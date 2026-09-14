/**
 * msp-consent.test.ts — Git #4077.
 *
 * `msp-consent.ts`'s 4 write routes (invite, write-invite, sharepoint-invite,
 * revoke) are all gated `requireCapability("ladder.msp-operator")` — no portal
 * customer session can ever reach them — but each `createAuditLog` call
 * hardcoded `actorRole: "client"` rather than deriving the real actor, unlike
 * the file's own read-audit call (line ~153) which already used
 * `resolveAuditActorRole(req.user!)`. This proves the fix on the simplest of
 * the 4 write routes (PATCH .../consent/revoke): a real MSP-operator session
 * must produce `actorRole: "msp"` in the resulting audit log call, never
 * `"client"`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("@workspace/db", () => ({
  db: {},
  tenantsTable: { id: "id", tenantId: "tenant_id", mspId: "msp_id" },
  consentInviteTokensTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ op: "eq", a, b })),
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
}));

vi.mock("../lib/graph.ts", () => ({
  buildAdminConsentUrl: vi.fn(),
  mtAppCredentialsPresent: vi.fn().mockReturnValue(true),
  REQUIRED_MT_SCOPES: [],
}));

vi.mock("../lib/sharepoint-admin.ts", () => ({
  REQUIRED_SHAREPOINT_APP_PERMISSIONS: [],
}));

const mockStampConsent = vi.fn();
vi.mock("./consent.ts", () => ({
  getCallbackUrl: vi.fn(),
  getHostBase: vi.fn(),
  stampConsent: (...args: unknown[]) => mockStampConsent(...args),
  consentRow: vi.fn(),
  signWriteConsentState: vi.fn(),
  signSharePointConsentState: vi.fn(),
  CONSENT_REVOKE_KEYS: ["graph", "writeBack", "sharepoint"],
}));

vi.mock("../lib/logger.ts", () => {
  const child = vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

// Real resolveAuditActorRole (pure — see lib/db/rbac/legacy-ladder.ts), only
// createAuditLog/auditPrivilegedRead mocked — the whole point is to prove the
// real mapping, not a stubbed one.
const mockCreateAuditLog = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/audit.ts", async () => {
  const actual = await vi.importActual<typeof import("../lib/audit.ts")>("../lib/audit.ts");
  return {
    ...actual,
    createAuditLog: (...args: unknown[]) => mockCreateAuditLog(...args),
    auditPrivilegedRead: vi.fn().mockResolvedValue(undefined),
  };
});

const mockAssertCustomerAccess = vi.fn();
let currentUser: Record<string, unknown> = {
  id: 1,
  email: "operator@test.com",
  role: "client",
  mspRole: "MSPOperator",
  mspId: 9,
};
vi.mock("../middlewares/requireAuth.ts", () => ({
  requireCapability: () => (req: any, _res: any, next: () => void) => {
    req.user = currentUser;
    next();
  },
  assertCustomerAccess: (...args: unknown[]) => mockAssertCustomerAccess(...args),
}));

import router from "./msp-consent.ts";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

beforeEach(() => {
  mockCreateAuditLog.mockClear();
  mockAssertCustomerAccess.mockReset();
  mockStampConsent.mockReset();
  currentUser = { id: 1, email: "operator@test.com", role: "client", mspRole: "MSPOperator", mspId: 9 };
});

describe("PATCH /msp/customers/:customerId/consent/revoke — audit actorRole", () => {
  it("writes actorRole 'msp' (never 'client') for a real MSP-operator session", async () => {
    mockAssertCustomerAccess.mockResolvedValue(true);
    mockStampConsent.mockResolvedValue({ id: 42 });

    const res = await request(buildApp())
      .patch("/api/msp/customers/42/consent/revoke")
      .send({ key: "graph" });

    expect(res.status).toBe(200);
    expect(mockCreateAuditLog).toHaveBeenCalledOnce();
    const call = mockCreateAuditLog.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.actionType).toBe("tenant_consent_revoked");
    expect(call.actorRole).toBe("msp");
    expect(call.actorRole).not.toBe("client");
  });

  it("writes actorRole 'msp' for an MSPAdmin session too", async () => {
    currentUser = { id: 2, email: "admin@test.com", role: "client", mspRole: "MSPAdmin", mspId: 9 };
    mockAssertCustomerAccess.mockResolvedValue(true);
    mockStampConsent.mockResolvedValue({ id: 42 });

    const res = await request(buildApp())
      .patch("/api/msp/customers/42/consent/revoke")
      .send({ key: "graph" });

    expect(res.status).toBe(200);
    const call = mockCreateAuditLog.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.actorRole).toBe("msp");
  });

  it("writes actorRole 'platform_admin' for a legacy admin session, still never 'client'", async () => {
    currentUser = { id: 3, email: "root@test.com", role: "admin", mspRole: null, mspId: 9 };
    mockAssertCustomerAccess.mockResolvedValue(true);
    mockStampConsent.mockResolvedValue({ id: 42 });

    const res = await request(buildApp())
      .patch("/api/msp/customers/42/consent/revoke")
      .send({ key: "graph" });

    expect(res.status).toBe(200);
    const call = mockCreateAuditLog.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.actorRole).toBe("platform_admin");
    expect(call.actorRole).not.toBe("client");
  });
});
