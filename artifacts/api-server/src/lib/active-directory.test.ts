import { describe, it, expect } from "vitest";
import {
  buildMspTree,
  buildGroupNodes,
  searchDirectory,
  DIRECTORY_GROUP_ROLES,
  buildMspDetail,
  deriveEntitlements,
  buildGroupDetail,
  filterGroupMembers,
  buildCustomerDetail,
  buildOuNodes,
  type OuRow,
  type MspRow,
  type CustomerRow,
  type SearchableUser,
  type MspProfileRow,
  type MspSubscriptionRow,
  type MspDetailCustomer,
  type MspDetailUser,
  type MspAgreementAcceptanceRow,
  type GroupMember,
  type CustomerProfileRow,
  type CustomerOwningMsp,
  type CustomerDetailUser,
  type CustomerConsentStatus,
  type CustomerPurchasedService,
  type CustomerDiagnosticRunSummary,
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
  it("returns exactly the 7 real MSP roles, in order, even with no counts", () => {
    const groups = buildGroupNodes([]);
    expect(groups.map((g) => g.role)).toEqual([...DIRECTORY_GROUP_ROLES]);
    expect(groups.every((g) => g.count === 0)).toBe(true);
  });

  it("fills in real counts by role and defaults missing roles to 0", () => {
    const groups = buildGroupNodes([
      { role: "MSPAdmin", count: 4 },
      { role: "CustomerUser", count: 57 },
      { role: "Assessment", count: 12 },
    ]);
    expect(groups.find((g) => g.role === "MSPAdmin")?.count).toBe(4);
    expect(groups.find((g) => g.role === "CustomerUser")?.count).toBe(57);
    expect(groups.find((g) => g.role === "Assessment")?.count).toBe(12);
    expect(groups.find((g) => g.role === "PlatformAdmin")?.count).toBe(0);
    expect(groups.find((g) => g.role === "ServiceAccount")?.count).toBe(0);
    expect(groups.find((g) => g.role === "Free")?.count).toBe(0);
  });

  it("includes Free with a live count", () => {
    const groups = buildGroupNodes([{ role: "Free", count: 900 }]);
    expect(groups.find((g) => g.role === "Free")?.count).toBe(900);
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

// ── MSP Object detail pane (Phase 2) ─────────────────────────────────────────

const MSP_PROFILE: MspProfileRow = {
  id: 1,
  name: "Acme Consulting",
  slug: "acme-consulting",
  domain: "acme.com",
  logoUrl: null,
  status: "active",
  trialEndsAt: null,
  suspendedAt: null,
  offboardingState: null,
  isDirectBusiness: false,
  isTestbed: false,
  writeBackEnabled: false,
  automatedCustomerEmailsEnabled: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const SUBSCRIPTION: MspSubscriptionRow = {
  status: "active",
  tierName: "Professional",
  billingInterval: "month",
  currentPeriodStart: new Date("2026-07-01T00:00:00Z"),
  currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
  dunningState: null,
  paymentFailedAt: null,
  tenantCountSnapshot: 12,
  contactEmail: "billing@acme.com",
  typeAttributes: {
    tenantAllowance: 25,
    aiCreditAllowancePlatformValue: 5000,
    overageRateCents: 200,
    tierCapabilities: { advanced_signals: true, custom_workflows: false },
  },
};

const CUSTOMERS_DETAIL: MspDetailCustomer[] = [
  { id: 10, name: "Contoso Ltd", domain: "contoso.com", tenantId: "tenant-contoso", status: "active" },
];

const USERS_DETAIL: MspDetailUser[] = [
  { id: 100, email: "admin@acme.com", name: "Alex Admin", mspRole: "MSPAdmin", isActive: true, lastLoginAt: null },
];

const ACCEPTANCES: MspAgreementAcceptanceRow[] = [
  { agreementVersion: "2026-01", acceptedAt: new Date("2026-01-02T00:00:00Z"), checkboxConfirmed: true },
];

describe("deriveEntitlements", () => {
  it("returns null when there is no subscription", () => {
    expect(deriveEntitlements(null)).toBeNull();
  });

  it("extracts tenantAllowance/aiCreditAllowance/overageRateCents/tierCapabilities from typeAttributes", () => {
    expect(deriveEntitlements(SUBSCRIPTION)).toEqual({
      tenantAllowance: 25,
      aiCreditAllowance: 5000,
      overageRateCents: 200,
      tierCapabilities: { advanced_signals: true, custom_workflows: false },
    });
  });

  it("falls back to the plain aiCreditAllowance key when the platform-value key is absent", () => {
    const sub: MspSubscriptionRow = { ...SUBSCRIPTION, typeAttributes: { aiCreditAllowance: 1000 } };
    expect(deriveEntitlements(sub)?.aiCreditAllowance).toBe(1000);
  });

  it("defaults every field to null/empty when typeAttributes is missing or empty", () => {
    const sub: MspSubscriptionRow = { ...SUBSCRIPTION, typeAttributes: {} };
    expect(deriveEntitlements(sub)).toEqual({
      tenantAllowance: null,
      aiCreditAllowance: null,
      overageRateCents: null,
      tierCapabilities: {},
    });
  });
});

describe("buildMspDetail", () => {
  it("assembles the full MSP detail payload from real rows, including a real customer/user count", () => {
    const detail = buildMspDetail({
      msp: MSP_PROFILE,
      subscription: SUBSCRIPTION,
      customers: CUSTOMERS_DETAIL,
      users: USERS_DETAIL,
      agreementAcceptances: ACCEPTANCES,
      currentAgreementVersion: "2026-01",
    });

    expect(detail.msp).toEqual(MSP_PROFILE);
    expect(detail.customerCount).toBe(1);
    expect(detail.userCount).toBe(1);
    expect(detail.subscription).toMatchObject({ status: "active", tierName: "Professional", dunningState: null });
    expect(detail.entitlements).toEqual({
      tenantAllowance: 25,
      aiCreditAllowance: 5000,
      overageRateCents: 200,
      tierCapabilities: { advanced_signals: true, custom_workflows: false },
    });
    expect(detail.hasAcceptedCurrentAgreement).toBe(true);
  });

  it("renders honest empty states for an MSP with zero customers/users/acceptances — real empty arrays, not placeholders", () => {
    const detail = buildMspDetail({
      msp: MSP_PROFILE,
      subscription: null,
      customers: [],
      users: [],
      agreementAcceptances: [],
      currentAgreementVersion: "2026-01",
    });

    expect(detail.customers).toEqual([]);
    expect(detail.customerCount).toBe(0);
    expect(detail.users).toEqual([]);
    expect(detail.userCount).toBe(0);
    expect(detail.subscription).toBeNull();
    expect(detail.entitlements).toBeNull();
    expect(detail.agreementAcceptances).toEqual([]);
    expect(detail.hasAcceptedCurrentAgreement).toBe(false);
  });

  it("flags hasAcceptedCurrentAgreement false when the MSP only accepted an older version", () => {
    const detail = buildMspDetail({
      msp: MSP_PROFILE,
      subscription: SUBSCRIPTION,
      customers: [],
      users: [],
      agreementAcceptances: ACCEPTANCES,
      currentAgreementVersion: "2026-06",
    });
    expect(detail.hasAcceptedCurrentAgreement).toBe(false);
    expect(detail.agreementAcceptances).toEqual(ACCEPTANCES);
  });

  it("treats a null currentAgreementVersion (no published agreement yet) as not accepted", () => {
    const detail = buildMspDetail({
      msp: MSP_PROFILE,
      subscription: null,
      customers: [],
      users: [],
      agreementAcceptances: ACCEPTANCES,
      currentAgreementVersion: null,
    });
    expect(detail.hasAcceptedCurrentAgreement).toBe(false);
    expect(detail.currentAgreementVersion).toBeNull();
  });
});

// ── RBAC/Group Object detail pane (Phase 4) ─────────────────────────────────

const GROUP_MEMBERS: GroupMember[] = [
  {
    id: 100,
    email: "jane@contoso.com",
    name: "Jane Doe",
    mspId: 1,
    mspName: "Acme Consulting",
    customerId: 10,
    customerName: "Contoso Ltd",
    isActive: true,
    lastLoginAt: new Date("2026-07-01T00:00:00Z"),
  },
  {
    id: 101,
    email: "admin@acme.com",
    name: "Alex Admin",
    mspId: 1,
    mspName: "Acme Consulting",
    customerId: null,
    customerName: null,
    isActive: false,
    lastLoginAt: null,
  },
];

describe("buildGroupDetail", () => {
  it("carries through the role and members, with a live count matching the list length", () => {
    const detail = buildGroupDetail("CustomerUser", GROUP_MEMBERS);
    expect(detail.role).toBe("CustomerUser");
    expect(detail.members).toEqual(GROUP_MEMBERS);
    expect(detail.memberCount).toBe(2);
  });

  it("returns a real empty member list (honest empty state) for a role with zero accounts", () => {
    const detail = buildGroupDetail("ServiceAccount", []);
    expect(detail.members).toEqual([]);
    expect(detail.memberCount).toBe(0);
  });
});

describe("filterGroupMembers", () => {
  it("returns every member for a blank query", () => {
    expect(filterGroupMembers("  ", GROUP_MEMBERS)).toEqual(GROUP_MEMBERS);
  });

  it("matches a member by name", () => {
    expect(filterGroupMembers("Jane", GROUP_MEMBERS).map((m) => m.id)).toEqual([100]);
  });

  it("matches a member by email", () => {
    expect(filterGroupMembers("admin@acme.com", GROUP_MEMBERS).map((m) => m.id)).toEqual([101]);
  });

  it("requires every whitespace-separated term to match (AND, not OR)", () => {
    expect(filterGroupMembers("Jane Doe", GROUP_MEMBERS).map((m) => m.id)).toEqual([100]);
    expect(filterGroupMembers("Jane Smith", GROUP_MEMBERS)).toEqual([]);
  });

  it("returns nothing when no member matches", () => {
    expect(filterGroupMembers("nonexistent", GROUP_MEMBERS)).toEqual([]);
  });
});

// ── Customer Object detail pane (Phase 3) ───────────────────────────────────

const CUSTOMER_PROFILE: CustomerProfileRow = {
  id: 10,
  mspId: 1,
  name: "Contoso Ltd",
  domain: "contoso.com",
  industry: "Manufacturing",
  tenantId: "tenant-contoso",
  status: "active",
  ownerType: "customer",
  isTestbed: false,
  createdAt: new Date("2026-02-01T00:00:00Z"),
};

const OWNING_MSP: CustomerOwningMsp = { id: 1, name: "Acme Consulting", slug: "acme-consulting" };

const CUSTOMER_USERS: CustomerDetailUser[] = [
  { id: 100, email: "jane@contoso.com", name: "Jane Doe", mspRole: "CustomerUser", isActive: true, lastLoginAt: null },
];

const GRAPH_CONSENT: CustomerConsentStatus = {
  tenantId: "tenant-contoso",
  consentStatus: "granted",
  consentedAt: new Date("2026-03-01T00:00:00Z"),
  revokedAt: null,
  adminEmail: "admin@contoso.com",
};

const PURCHASED_SERVICES: CustomerPurchasedService[] = [
  { id: 1, serviceName: "Managed Security", status: "active", billingInterval: "month", purchasedAt: new Date("2026-04-01T00:00:00Z") },
];

const DIAGNOSTIC_RUNS: CustomerDiagnosticRunSummary[] = [
  {
    runId: "11111111-1111-1111-1111-111111111111",
    packageKey: "core:security-baseline",
    status: "completed",
    startedAt: new Date("2026-07-01T00:00:00Z"),
    completedAt: new Date("2026-07-01T00:05:00Z"),
  },
];

describe("buildCustomerDetail", () => {
  it("assembles the full customer detail payload from real rows, including a real user count", () => {
    const detail = buildCustomerDetail({
      customer: CUSTOMER_PROFILE,
      owningMsp: OWNING_MSP,
      users: CUSTOMER_USERS,
      graphConsent: GRAPH_CONSENT,
      sharePointConsent: null,
      writeConsent: null,
      purchasedServices: PURCHASED_SERVICES,
      recentDiagnosticRuns: DIAGNOSTIC_RUNS,
    });

    expect(detail.customer).toEqual(CUSTOMER_PROFILE);
    expect(detail.owningMsp).toEqual(OWNING_MSP);
    expect(detail.userCount).toBe(1);
    expect(detail.users).toEqual(CUSTOMER_USERS);
    expect(detail.graphConsent).toEqual(GRAPH_CONSENT);
    expect(detail.purchasedServices).toEqual(PURCHASED_SERVICES);
    expect(detail.recentDiagnosticRuns).toEqual(DIAGNOSTIC_RUNS);
  });

  it("renders honest empty/null states for a customer with no consent/services/runs/users — real empty arrays and nulls, not placeholders", () => {
    const detail = buildCustomerDetail({
      customer: CUSTOMER_PROFILE,
      owningMsp: OWNING_MSP,
      users: [],
      graphConsent: null,
      sharePointConsent: null,
      writeConsent: null,
      purchasedServices: [],
      recentDiagnosticRuns: [],
    });

    expect(detail.users).toEqual([]);
    expect(detail.userCount).toBe(0);
    expect(detail.graphConsent).toBeNull();
    expect(detail.sharePointConsent).toBeNull();
    expect(detail.writeConsent).toBeNull();
    expect(detail.purchasedServices).toEqual([]);
    expect(detail.recentDiagnosticRuns).toEqual([]);
  });

  it("carries a null owningMsp through rather than throwing, for a customer whose MSP row is missing", () => {
    const detail = buildCustomerDetail({
      customer: CUSTOMER_PROFILE,
      owningMsp: null,
      users: [],
      graphConsent: null,
      sharePointConsent: null,
      writeConsent: null,
      purchasedServices: [],
      recentDiagnosticRuns: [],
    });
    expect(detail.owningMsp).toBeNull();
  });

  it("keeps Graph, SharePoint, and write consent independent of one another", () => {
    const sharePointConsent: CustomerConsentStatus = { ...GRAPH_CONSENT, consentStatus: "pending" };
    const detail = buildCustomerDetail({
      customer: CUSTOMER_PROFILE,
      owningMsp: OWNING_MSP,
      users: [],
      graphConsent: GRAPH_CONSENT,
      sharePointConsent,
      writeConsent: null,
      purchasedServices: [],
      recentDiagnosticRuns: [],
    });
    expect(detail.graphConsent?.consentStatus).toBe("granted");
    expect(detail.sharePointConsent?.consentStatus).toBe("pending");
    expect(detail.writeConsent).toBeNull();
  });
});

describe("buildOuNodes", () => {
  const OUS: OuRow[] = [
    { id: 2, name: "Zebra Unit", createdAt: new Date("2026-07-01"), updatedAt: new Date("2026-07-01") },
    { id: 1, name: "Acme Unit", createdAt: new Date("2026-07-02"), updatedAt: new Date("2026-07-02") },
  ];

  it("sorts OU nodes by name", () => {
    const nodes = buildOuNodes(OUS);
    expect(nodes.map((o) => o.name)).toEqual(["Acme Unit", "Zebra Unit"]);
  });

  it("carries through id and name only — no policy fields", () => {
    const nodes = buildOuNodes(OUS);
    expect(nodes[0]).toEqual({ id: 1, name: "Acme Unit" });
  });

  it("returns an empty array when there are no OUs", () => {
    expect(buildOuNodes([])).toEqual([]);
  });
});
