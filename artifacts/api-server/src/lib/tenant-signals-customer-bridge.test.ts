/**
 * tenant-signals-customer-bridge.test.ts
 *
 * Unit tests for the two bridge resolvers the tenant-first document generation
 * signature depends on (Document Generator IDE Phase 8):
 *   resolveCustomerIdForPortalUser() — users.id -> msp_customers.id, the
 *     translation the document engines used to do privately and internally.
 *     Now exported once and called at each CALLER's boundary instead.
 *   resolveDocumentOwnerUserId()     — msp_customers.id -> the users.id stamped
 *     on a generated document's `insights_generated_documents.customerId` FK
 *     (which is users.id-shaped, so a customer-first request still has to name
 *     an owner).
 *
 * Covers:
 *   - a bridged user resolves to its customer; an unbridged user resolves to
 *     null (a real state for a direct-business/unclaimed user, not an error) so
 *     callers can report it rather than the engine silently generating against
 *     an empty tenant profile
 *   - document ownership prefers the canonical ACTIVE portal user
 *   - it FALLS BACK to a deactivated linked login rather than returning null,
 *     since a NULL FK would make the document unfindable by every
 *     customer-scoped read (`inArray(customerId, resolveCustomerUserIds(...))`)
 *   - only a customer with no linked portal user at all yields null
 *
 * Run: pnpm --filter @workspace/api-server run test -- tenant-signals-customer-bridge
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", () => {
  const sqlFn = (strings: TemplateStringsArray, ...vals: unknown[]) => ({ type: "sql", strings, vals });
  (sqlFn as unknown as { raw: (s: string) => unknown }).raw = (s: string) => ({ type: "sql.raw", s });
  return {
    eq: (...args: unknown[]) => ({ type: "eq", args }),
    and: (...args: unknown[]) => ({ type: "and", args }),
    asc: (...args: unknown[]) => ({ type: "asc", args }),
    desc: (...args: unknown[]) => ({ type: "desc", args }),
    inArray: (...args: unknown[]) => ({ type: "inArray", args }),
    sql: sqlFn,
  };
});

vi.mock("./logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

vi.mock("./sla-engine", () => ({ startSlaTimer: vi.fn() }));

// Chainable + thenable stub — mirrors drizzle's builder being awaitable at any
// link in the chain. Same harness tenant-signals-stabilization.test.ts uses.
function chainStub(rows: unknown[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    from: () => obj,
    innerJoin: () => obj,
    where: () => obj,
    orderBy: () => obj,
    limit: () => obj,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return obj;
}

// The two resolvers issue differently-SHAPED selects, which is how this harness
// tells them apart without a real DB:
//   { customerId } only -> resolveCustomerIdForPortalUser's bridge lookup
//   { userId }     only -> resolveCustomerPortalUserId / resolveCustomerUserIds
let bridgeRows: Array<{ customerId: number | null }> = [];
let activeUserRows: Array<{ userId: number }> = [];
let allUserRows: Array<{ userId: number }> = [];
// resolveDocumentOwnerUserId calls the active-only query FIRST, then (only on a
// miss) the include-deactivated query. Both select { userId }, so they're
// disambiguated by call order.
let userSelectCallCount = 0;

const { mockSelect, mockExecute } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockExecute: vi.fn(),
}));

mockSelect.mockImplementation((shape?: Record<string, unknown>) => {
  const keys = shape ? Object.keys(shape) : [];
  if (keys.length === 1 && keys[0] === "customerId") return chainStub(bridgeRows);
  if (keys.length === 1 && keys[0] === "userId") {
    userSelectCallCount += 1;
    return chainStub(userSelectCallCount === 1 ? activeUserRows : allUserRows);
  }
  return chainStub([]);
});

vi.mock("@workspace/db", () => ({
  db: { select: mockSelect, execute: mockExecute },
  clientM365ProfilesTable: {},
  scriptRunResultsTable: {},
  tenantsTable: { id: "id", tenantId: "tenantId", mspId: "mspId" },
  usersTable: { id: "id", tenantId: "tenantId", isActive: "isActive", mspRole: "mspRole", createdAt: "createdAt" },
  tenantMonitorProfilesTable: {},
  signalDerivationRulesTable: { signalKey: "signalKey", sourceKey: "sourceKey" },
  monitorChecksTable: { key: "key", frequency: "frequency" },
}));

import { resolveCustomerIdForPortalUser, resolveDocumentOwnerUserId } from "./tenant-signals.ts";

beforeEach(() => {
  bridgeRows = [];
  activeUserRows = [];
  allUserRows = [];
  userSelectCallCount = 0;
  mockSelect.mockClear();
  mockExecute.mockReset();
});

describe("resolveCustomerIdForPortalUser", () => {
  it("resolves a bridged portal user to its engine customer", async () => {
    bridgeRows = [{ customerId: 77 }];
    expect(await resolveCustomerIdForPortalUser(21)).toBe(77);
  });

  it("returns null for a user with no msp_users bridge row (direct-business / unclaimed)", async () => {
    bridgeRows = [];
    expect(await resolveCustomerIdForPortalUser(21)).toBeNull();
  });

  it("returns null when the bridge row exists but its customerId is NULL", async () => {
    bridgeRows = [{ customerId: null }];
    expect(await resolveCustomerIdForPortalUser(21)).toBeNull();
  });
});

describe("resolveDocumentOwnerUserId", () => {
  it("prefers the canonical ACTIVE portal user", async () => {
    activeUserRows = [{ userId: 42 }];
    allUserRows = [{ userId: 9 }, { userId: 42 }];
    expect(await resolveDocumentOwnerUserId(77)).toBe(42);
  });

  it("does not fall through to the deactivated-inclusive query when an active user exists", async () => {
    activeUserRows = [{ userId: 42 }];
    allUserRows = [{ userId: 9 }];
    await resolveDocumentOwnerUserId(77);
    // Exactly one { userId } select — the active-only one.
    expect(userSelectCallCount).toBe(1);
  });

  it("falls back to the canonical-order first linked login when every login is deactivated", async () => {
    // A NULL FK here would make the generated document unfindable by every
    // customer-scoped read, so owning it by a deactivated login is the honest
    // direction — the customer keeps its documents.
    activeUserRows = [];
    allUserRows = [{ userId: 9 }, { userId: 31 }];
    expect(await resolveDocumentOwnerUserId(77)).toBe(9);
  });

  it("returns null only when the customer has no linked portal user at all", async () => {
    activeUserRows = [];
    allUserRows = [];
    expect(await resolveDocumentOwnerUserId(77)).toBeNull();
  });
});
