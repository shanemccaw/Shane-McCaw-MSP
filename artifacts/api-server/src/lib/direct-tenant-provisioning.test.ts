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
    set: vi.fn().mockImplementation(() => updateChain),
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
// The level fns are hoisted and shared so a test can assert on `log.error`
// after vi.clearAllMocks() (which wipes `child`'s recorded results).
const mockLog = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("./logger.ts", () => {
  const child = vi.fn(() => ({ ...mockLog, child }));
  return { logger: { child, ...mockLog } };
});

import {
  ensureClientMspUser,
  PENDING_TO_CONSENTED_ROLE,
  isPendingProspectRole,
  consentedRoleForPending,
  pendingRoleForCategory,
} from "./direct-tenant-provisioning.ts";
import { db, usersTable } from "@workspace/db";
import { LEGACY_ROLE, LEGACY_ROLE_ORDER } from "@workspace/db/rbac/legacy-ladder";

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
      [{ existingCustomerId: null, existingMspId: 89, existingRole: LEGACY_ROLE.customer }],
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
      [{ existingCustomerId: null, existingMspId: 89, existingRole: LEGACY_ROLE.customer }],
    ];

    await ensureClientMspUser(92, "tenant-ok");

    // No conflict → the tenant-link patch proceeds on the user's own row.
    expect(db.update).toHaveBeenCalledWith(usersTable);
  });

  it("does not patch (nothing to do) when the user is already tenant-linked", async () => {
    mockSelectResultsQueue = [
      [{ id: 5, mspId: 89 }],
      // already linked → no patch regardless of MSP
      [{ existingCustomerId: 5, existingMspId: 89, existingRole: LEGACY_ROLE.customer }],
    ];

    await ensureClientMspUser(92, "tenant-ok");

    expect(db.update).not.toHaveBeenCalled();
  });
});

// #3973 (step 3 of #3970) — the real RetainerPending -> RetainerConsented
// role swap at the point a tenant actually gets connected. Same function,
// same single UPDATE that links tenant_id/mspId — the contract is that the
// role flips in that exact statement, never as a separate write, and never
// only sometimes (it must NOT depend on the caller's desiredRole, which
// carries product-type defaults unrelated to this ladder transition).
describe("ensureClientMspUser — RetainerPending -> RetainerConsented swap (#3973)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResultsQueue = [];
    mockDefaultSelectResult = [];
  });

  it("swaps RetainerPending to RetainerConsented in the SAME update that links the tenant, ignoring desiredRole", async () => {
    mockSelectResultsQueue = [
      // 1. explicitCustomerId → tenants lookup: tenant 7 under msp 3
      [{ id: 7, mspId: 3 }],
      // 2. the user's own row: RetainerPending, no tenant/msp yet
      [{ existingCustomerId: null, existingMspId: null, existingRole: LEGACY_ROLE.retainerPending }],
    ];

    // desiredRole passed as Customer (the caller's product-type default) to
    // prove the retainer swap wins regardless — it is not a desiredRole path.
    await ensureClientMspUser(50, "guid-123", 7, LEGACY_ROLE.customer);

    expect(db.update).toHaveBeenCalledWith(usersTable);
    const updateChainInstance = (db.update as any).mock.results[0].value;
    expect(updateChainInstance.set).toHaveBeenCalledWith({
      tenantId: 7,
      mspId: 3,
      mspRole: LEGACY_ROLE.retainerConsented,
      updatedAt: expect.any(Date),
    });
  });

  it("does not touch mspRole for a role that is neither the unbridged-Free default nor RetainerPending", async () => {
    mockSelectResultsQueue = [
      [{ id: 7, mspId: 3 }],
      [{ existingCustomerId: null, existingMspId: null, existingRole: LEGACY_ROLE.mspOperator }],
    ];

    await ensureClientMspUser(51, "guid-456", 7);

    const updateChainInstance = (db.update as any).mock.results[0].value;
    expect(updateChainInstance.set).toHaveBeenCalledWith({
      tenantId: 7,
      mspId: 3,
      updatedAt: expect.any(Date),
    });
  });

  it("still applies desiredRole for the unbridged-Free default (unchanged pre-#3973 behavior)", async () => {
    mockSelectResultsQueue = [
      [{ id: 7, mspId: 3 }],
      [{ existingCustomerId: null, existingMspId: null, existingRole: LEGACY_ROLE.free }],
    ];

    await ensureClientMspUser(52, "guid-789", 7, LEGACY_ROLE.customer);

    const updateChainInstance = (db.update as any).mock.results[0].value;
    expect(updateChainInstance.set).toHaveBeenCalledWith({
      tenantId: 7,
      mspId: 3,
      mspRole: LEGACY_ROLE.customer,
      updatedAt: expect.any(Date),
    });
  });
});

// #4373 (issue 3 of #4370) — the #3973 swap generalized per product. Same
// contract, three rungs: whatever `*Pending` rung the row is sitting in
// becomes its OWN `*Consented` rung in the single UPDATE that links
// tenant_id/mspId. Keyed on the row's existing role — never on desiredRole,
// which carries whatever product is being bought now.
describe("ensureClientMspUser — per-product *Pending -> *Consented swap (#4373)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResultsQueue = [];
    mockDefaultSelectResult = [];
  });

  it.each([
    [LEGACY_ROLE.monitoringPending, LEGACY_ROLE.monitoringConsented],
    [LEGACY_ROLE.packPending, LEGACY_ROLE.packConsented],
    [LEGACY_ROLE.retainerPending, LEGACY_ROLE.retainerConsented],
  ])("swaps %s to %s in the SAME update that links the tenant, ignoring desiredRole", async (pending, consented) => {
    mockSelectResultsQueue = [
      [{ id: 7, mspId: 3 }],
      [{ existingCustomerId: null, existingMspId: null, existingRole: pending }],
    ];

    await ensureClientMspUser(60, "guid-4373", 7, LEGACY_ROLE.customer);

    expect(db.update).toHaveBeenCalledTimes(1);
    const updateChainInstance = (db.update as any).mock.results[0].value;
    expect(updateChainInstance.set).toHaveBeenCalledWith({
      tenantId: 7,
      mspId: 3,
      mspRole: consented,
      updatedAt: expect.any(Date),
    });
  });

  it("keys the swap on the row's EXISTING rung, not on the product being bought now (desiredRole = another product's *Pending)", async () => {
    mockSelectResultsQueue = [
      [{ id: 7, mspId: 3 }],
      [{ existingCustomerId: null, existingMspId: null, existingRole: LEGACY_ROLE.monitoringPending }],
    ];

    await ensureClientMspUser(61, "guid-4373", 7, LEGACY_ROLE.packPending);

    const updateChainInstance = (db.update as any).mock.results[0].value;
    expect(updateChainInstance.set).toHaveBeenCalledWith({
      tenantId: 7,
      mspId: 3,
      mspRole: LEGACY_ROLE.monitoringConsented,
      updatedAt: expect.any(Date),
    });
  });

  it("never touches mspRole for a *Consented row — only *Pending rungs have a consent transition", async () => {
    mockSelectResultsQueue = [
      [{ id: 7, mspId: 3 }],
      [{ existingCustomerId: null, existingMspId: null, existingRole: LEGACY_ROLE.packConsented }],
    ];

    await ensureClientMspUser(62, "guid-4373", 7, LEGACY_ROLE.customer);

    const updateChainInstance = (db.update as any).mock.results[0].value;
    expect(updateChainInstance.set).toHaveBeenCalledWith({
      tenantId: 7,
      mspId: 3,
      updatedAt: expect.any(Date),
    });
  });

  it.each([LEGACY_ROLE.monitoringPending, LEGACY_ROLE.packPending, LEGACY_ROLE.retainerPending])(
    "with no tenant resolvable, a %s desiredRole is the by-design pre-consent case: no update, no error",
    async (pending) => {
      mockSelectResultsQueue = [
        // users-row read only — no tenantId/explicitCustomerId given, so no tenants lookup runs
        [{ existingCustomerId: null, existingMspId: null, existingRole: pending }],
      ];

      await ensureClientMspUser(63, null, null, pending);

      expect(db.update).not.toHaveBeenCalled();
      expect(mockLog.error).not.toHaveBeenCalled();
    },
  );

  it("with no tenant resolvable, a Customer desiredRole is still the consent-first-skipped defect: no update, error logged (unchanged)", async () => {
    mockSelectResultsQueue = [
      [{ existingCustomerId: null, existingMspId: null, existingRole: LEGACY_ROLE.free }],
    ];

    await ensureClientMspUser(64, null, null, LEGACY_ROLE.customer);

    expect(db.update).not.toHaveBeenCalled();
    expect(mockLog.error).toHaveBeenCalledTimes(1);
  });

  it("the cross-MSP backstop still refuses the patch for a *Pending row — the swap never bypasses it", async () => {
    mockSelectResultsQueue = [
      // tenant 1 lives under mspId 1
      [{ id: 1, mspId: 1 }],
      // a MonitoringPending row somehow carrying mspId 89
      [{ existingCustomerId: null, existingMspId: 89, existingRole: LEGACY_ROLE.monitoringPending }],
    ];

    await ensureClientMspUser(65, "tenant-conflict", null, LEGACY_ROLE.customer);

    expect(db.update).not.toHaveBeenCalled();
  });

  it("is idempotent: an already tenant-linked *Consented row is never re-swapped or re-pointed", async () => {
    mockSelectResultsQueue = [
      [{ id: 7, mspId: 3 }],
      [{ existingCustomerId: 7, existingMspId: 3, existingRole: LEGACY_ROLE.monitoringConsented }],
    ];

    await ensureClientMspUser(66, "guid-4373", 7, LEGACY_ROLE.customer);

    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("Pending/Consented rung helpers (#4373)", () => {
  it("PENDING_TO_CONSENTED_ROLE pairs every *Pending rung with its own product's *Consented rung", () => {
    expect(PENDING_TO_CONSENTED_ROLE).toEqual({
      [LEGACY_ROLE.monitoringPending]: LEGACY_ROLE.monitoringConsented,
      [LEGACY_ROLE.packPending]: LEGACY_ROLE.packConsented,
      [LEGACY_ROLE.retainerPending]: LEGACY_ROLE.retainerConsented,
    });
  });

  it("isPendingProspectRole is true for exactly the three *Pending rungs", () => {
    for (const role of LEGACY_ROLE_ORDER) {
      expect(isPendingProspectRole(role)).toBe(role.endsWith("Pending"));
    }
    expect(isPendingProspectRole(null)).toBe(false);
    expect(isPendingProspectRole(undefined)).toBe(false);
    expect(isPendingProspectRole("toString")).toBe(false); // own-property check, not prototype
  });

  it("consentedRoleForPending returns the partner rung for a *Pending role and null for everything else", () => {
    expect(consentedRoleForPending(LEGACY_ROLE.monitoringPending)).toBe(LEGACY_ROLE.monitoringConsented);
    expect(consentedRoleForPending(LEGACY_ROLE.packPending)).toBe(LEGACY_ROLE.packConsented);
    expect(consentedRoleForPending(LEGACY_ROLE.retainerPending)).toBe(LEGACY_ROLE.retainerConsented);
    for (const role of LEGACY_ROLE_ORDER.filter((r) => !r.endsWith("Pending"))) {
      expect(consentedRoleForPending(role)).toBeNull();
    }
    expect(consentedRoleForPending(null)).toBeNull();
  });

  it("pendingRoleForCategory maps the three real self-service categories and falls back to RetainerPending", () => {
    expect(pendingRoleForCategory("monitoring")).toBe(LEGACY_ROLE.monitoringPending);
    expect(pendingRoleForCategory("config_pack")).toBe(LEGACY_ROLE.packPending);
    expect(pendingRoleForCategory("retainer")).toBe(LEGACY_ROLE.retainerPending);
    expect(pendingRoleForCategory(null)).toBe(LEGACY_ROLE.retainerPending);
    expect(pendingRoleForCategory("assessment")).toBe(LEGACY_ROLE.retainerPending);
  });
});
