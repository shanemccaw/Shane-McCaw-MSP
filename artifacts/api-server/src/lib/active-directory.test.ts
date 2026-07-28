import { describe, it, expect } from "vitest";
import {
  buildMspTree,
  buildGroupNodes,
  searchDirectory,
  DIRECTORY_GROUP_ROLES,
  type MspRow,
  type CustomerRow,
  type SearchableUser,
} from "./active-directory";

const MSPS: MspRow[] = [
  { id: 1, name: "Acme Consulting", slug: "acme-consulting", domain: "acme.com", status: "active" },
  { id: 2, name: "Beacon MSP", slug: "beacon-msp", domain: null, status: "trial" },
  { id: 3, name: "No Customers Yet", slug: "no-customers-yet", domain: null, status: "active" },
];

const CUSTOMERS: CustomerRow[] = [
  { id: 10, mspId: 1, name: "Contoso Ltd", domain: "contoso.com", tenantId: "tenant-contoso", status: "active" },
  { id: 11, mspId: 1, name: "Fabrikam Inc", domain: "fabrikam.com", tenantId: null, status: "onboarding" },
  { id: 12, mspId: 2, name: "Globex Corp", domain: "globex.com", tenantId: "tenant-globex", status: "active" },
];

describe("buildMspTree", () => {
  it("nests each customer under its owning MSP, never a flat parallel list", () => {
    const tree = buildMspTree(MSPS, CUSTOMERS);
    expect(tree).toHaveLength(3);

    const acme = tree.find((m) => m.id === 1)!;
    expect(acme.customers.map((c) => c.id)).toEqual([10, 11]);

    const beacon = tree.find((m) => m.id === 2)!;
    expect(beacon.customers.map((c) => c.id)).toEqual([12]);
  });

  it("keeps an MSP with zero customers in the tree with an empty array", () => {
    const tree = buildMspTree(MSPS, CUSTOMERS);
    const empty = tree.find((m) => m.id === 3)!;
    expect(empty.customers).toEqual([]);
  });

  it("carries through the MSP and customer summary fields", () => {
    const tree = buildMspTree(MSPS, CUSTOMERS);
    const acme = tree.find((m) => m.id === 1)!;
    expect(acme).toMatchObject({ name: "Acme Consulting", slug: "acme-consulting", domain: "acme.com", status: "active" });
    expect(acme.customers[0]).toMatchObject({ id: 10, name: "Contoso Ltd", domain: "contoso.com", tenantId: "tenant-contoso", status: "active" });
  });
});

describe("buildGroupNodes", () => {
  it("returns exactly the 5 locked RBAC roles, in order, even with no counts", () => {
    const groups = buildGroupNodes([]);
    expect(groups.map((g) => g.role)).toEqual([...DIRECTORY_GROUP_ROLES]);
    expect(groups.every((g) => g.count === 0)).toBe(true);
  });

  it("fills in real counts by role and defaults missing roles to 0", () => {
    const groups = buildGroupNodes([
      { role: "MSPAdmin", count: 4 },
      { role: "CustomerUser", count: 57 },
    ]);
    expect(groups.find((g) => g.role === "MSPAdmin")?.count).toBe(4);
    expect(groups.find((g) => g.role === "CustomerUser")?.count).toBe(57);
    expect(groups.find((g) => g.role === "PlatformAdmin")?.count).toBe(0);
    expect(groups.find((g) => g.role === "ServiceAccount")?.count).toBe(0);
  });

  it("ignores counts for a role outside the locked 5 (e.g. Free/Assessment)", () => {
    const groups = buildGroupNodes([{ role: "Free", count: 900 }]);
    expect(groups.map((g) => g.role)).not.toContain("Free");
  });
});

const USERS: SearchableUser[] = [
  {
    id: 100,
    email: "jane@contoso.com",
    name: "Jane Doe",
    mspRole: "CustomerUser",
    mspId: 1,
    mspName: "Acme Consulting",
    customerId: 10,
    customerName: "Contoso Ltd",
  },
  {
    id: 101,
    email: "admin@acme.com",
    name: "Alex Admin",
    mspRole: "MSPAdmin",
    mspId: 1,
    mspName: "Acme Consulting",
    customerId: null,
    customerName: null,
  },
  {
    id: 102,
    email: "svc-billing@platform.internal",
    name: null,
    mspRole: "ServiceAccount",
    mspId: null,
    mspName: null,
    customerId: null,
    customerName: null,
  },
];

describe("searchDirectory", () => {
  it("returns nothing for a blank query", () => {
    const result = searchDirectory("   ", { msps: MSPS, customers: CUSTOMERS, users: USERS });
    expect(result).toEqual({ msps: [], customers: [], users: [], roles: [] });
  });

  it("matches an MSP by name and by slug", () => {
    expect(searchDirectory("Acme", { msps: MSPS, customers: [], users: [] }).msps.map((m) => m.id)).toEqual([1]);
    expect(searchDirectory("beacon-msp", { msps: MSPS, customers: [], users: [] }).msps.map((m) => m.id)).toEqual([2]);
  });

  it("matches a customer by its own name and by its owning MSP's name", () => {
    const byOwn = searchDirectory("Fabrikam", { msps: MSPS, customers: CUSTOMERS, users: [] });
    expect(byOwn.customers.map((c) => c.id)).toEqual([11]);

    const byMsp = searchDirectory("Beacon", { msps: MSPS, customers: CUSTOMERS, users: [] });
    expect(byMsp.customers.map((c) => c.id)).toEqual([12]);
    expect(byMsp.customers[0].mspName).toBe("Beacon MSP");
  });

  it("matches a user by name, by email, and by role — all from one query", () => {
    expect(searchDirectory("Jane", { msps: [], customers: [], users: USERS }).users.map((u) => u.id)).toEqual([100]);
    expect(searchDirectory("admin@acme.com", { msps: [], customers: [], users: USERS }).users.map((u) => u.id)).toEqual([101]);
    expect(searchDirectory("ServiceAccount", { msps: [], customers: [], users: USERS }).users.map((u) => u.id)).toEqual([102]);
  });

  it("surfaces a matching role as a Groups result alongside any matching users", () => {
    const result = searchDirectory("MSPAdmin", { msps: [], customers: [], users: USERS });
    expect(result.roles).toEqual(["MSPAdmin"]);
    expect(result.users.map((u) => u.id)).toEqual([101]);
  });

  it("searches across MSP, customer, user, and role in a single call (universal search)", () => {
    const result = searchDirectory("Acme", { msps: MSPS, customers: CUSTOMERS, users: USERS });
    expect(result.msps.map((m) => m.id)).toEqual([1]);
    expect(result.users.map((u) => u.id).sort()).toEqual([100, 101]);
  });

  it("requires every whitespace-separated term to match (AND, not OR)", () => {
    const result = searchDirectory("Jane Doe", { msps: [], customers: [], users: USERS });
    expect(result.users.map((u) => u.id)).toEqual([100]);
    expect(searchDirectory("Jane Smith", { msps: [], customers: [], users: USERS }).users).toEqual([]);
  });
});
