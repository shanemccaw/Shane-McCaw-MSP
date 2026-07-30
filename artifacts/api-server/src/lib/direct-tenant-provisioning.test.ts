import { describe, it, expect, vi, beforeEach } from "vitest";

// Top level variables prefixed with 'mock' to bypass hoisting checks.
// mockSelectResults is consumed in FIFO order by successive db.select() chains,
// falling back to [] once exhausted.
let mockSelectResultsQueue: any[][] = [];
let mockDefaultSelectResult: any[] = [];

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: () => chain,
      then: (onfulfilled: any, onrejected?: any) => {
        const result = mockSelectResultsQueue.length > 0
          ? mockSelectResultsQueue.shift()!
          : mockDefaultSelectResult;
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
    };
    return chain;
  };

  const updateChain: any = {
    set: () => updateChain,
    where: () => updateChain,
    then: (onfulfilled: any) => Promise.resolve({}).then(onfulfilled),
  };

  const insertChain: any = {
    values: () => insertChain,
    onConflictDoNothing: () => insertChain,
    onConflictDoUpdate: () => insertChain,
    returning: () => Promise.resolve([]),
    then: (onfulfilled: any) => Promise.resolve({}).then(onfulfilled),
  };

  const mockDb = {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    update: vi.fn().mockImplementation(() => updateChain),
    insert: vi.fn().mockImplementation(() => insertChain),
  };

  const table = (name: string) => ({ __table: name });

  // Trimmed to exactly the tables direct-tenant-provisioning.ts imports from
  // @workspace/db — not the full portal.ts table list this mock originally
  // carried. usersTable keeps the same shape as the original mock (the
  // assertions only ever check object identity via toHaveBeenCalledWith).
  return {
    db: mockDb,
    tenantsTable: table("tenants"),
    mspsTable: table("msps"),
    usersTable: { id: "id", email: "email", role: "role", name: "name", tenantId: "tenant_id", mspId: "msp_id", mspRole: "msp_role" },
    notificationsTable: table("notifications"),
  };
});

vi.mock("./sms.ts", () => ({
  sendAdminSms: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./crm-pipeline.ts", () => ({
  convertLeadForClient: vi.fn(),
}));

// direct-tenant-provisioning.ts does `const log = logger.child(...)` at module scope.
vi.mock("./logger.ts", () => {
  const child = vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child,
  }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import { ensureClientMspUser } from "./direct-tenant-provisioning.ts";
import { db, usersTable } from "@workspace/db";

// Cross-MSP tenant boundary backstop in ensureClientMspUser. This is the
// post-payment defense-in-depth half of "Reject cross-MSP tenant consent
// conflicts" (the consent-time check in routes/consent.ts is the primary gate).
// When a tenantId resolves to a tenants row under a DIFFERENT MSP than the
// user's own msp_id, the tenant-link patch must be REFUSED so the user is
// never cross-linked to another MSP's tenant (which would leak that MSP's
// engine history / findings / SOWs — confirmed live pre-refactor for user 92).
// Post-#92 the "existing msp_users row" is the user's own row: the second
// mocked select is the users-row read (tenantId/mspId/mspRole projection).
describe("ensureClientMspUser — cross-MSP customerId patch backstop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResultsQueue = [];
    mockDefaultSelectResult = [];
  });

  it("REFUSES to patch the tenant link when the tenantId tenant is under a different MSP", async () => {
    mockSelectResultsQueue = [
      // 1. tenantId → tenants lookup: tenant 1 lives under mspId 1
      [{ id: 1, mspId: 1 }],
      // 2. the user's own row: under mspId 89, not tenant-linked yet
      [{ existingCustomerId: null, existingMspId: 89, existingRole: "CustomerUser" }],
    ];

    await ensureClientMspUser(92, "tenant-conflict");

    // The buggy patch must NOT run — leave the user's tenant link untouched.
    expect(db.update).not.toHaveBeenCalled();
  });

  it("patches the tenant link when the tenantId tenant is under the SAME MSP", async () => {
    mockSelectResultsQueue = [
      // 1. tenantId → tenants lookup: tenant 5 under mspId 89 (matches the user's MSP)
      [{ id: 5, mspId: 89 }],
      // 2. the user's own row: under mspId 89, not tenant-linked → safe to patch
      [{ existingCustomerId: null, existingMspId: 89, existingRole: "CustomerUser" }],
    ];

    await ensureClientMspUser(92, "tenant-ok");

    // No conflict → the tenant-link patch proceeds on the user's own row.
    expect(db.update).toHaveBeenCalledWith(usersTable);
  });

  it("does not patch (nothing to do) when the user is already tenant-linked", async () => {
    mockSelectResultsQueue = [
      [{ id: 5, mspId: 89 }],
      // already linked → no patch regardless of MSP
      [{ existingCustomerId: 5, existingMspId: 89, existingRole: "CustomerUser" }],
    ];

    await ensureClientMspUser(92, "tenant-ok");

    expect(db.update).not.toHaveBeenCalled();
  });
});
