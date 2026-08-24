/**
 * project-sow-fulfillment.test.ts (vitest)
 *
 * Tests for fulfillAcceptedProjectOffer (Git #1171) — the accepted-offer ->
 * real engagement wiring. Proves:
 *   1. A project-class offer creates a projects row and drives the PROVEN
 *      document-engine-sow.ts engine with the accepted offer as a title
 *      narrowing (never a fixed price), scoped to the tenant.
 *   2. A non-project (add_on) offer is a no-op — no project, no SOW.
 *   3. The soft-failure outcomes (no offer / no serviceId / no tenant / no
 *      portal-user owner) return a typed status and never generate a SOW.
 *   4. The clientUserId owner is the accepting login when provided, else the
 *      customer's canonical portal user — never the tenant id crossed in.
 *
 * Run: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────
// These fns are referenced inside the vi.mock factories below. vitest hoists
// both the vi.mock calls AND the SUT's ES imports above plain top-level `const`s,
// so a bare `const mockSelect = vi.fn()` is still uninitialized when the SUT's
// own `import "@workspace/db"` triggers the factory ("Cannot access 'mockSelect'
// before initialization"). Creating them in vi.hoisted() is the repo's standard
// fix (cf. war-room-pillar-stats.test.ts) — they exist before any import runs.
const { mockSelect, mockInsert, generateSowDocumentMock, resolveCustomerPortalUserIdMock } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  generateSowDocumentMock: vi.fn(),
  resolveCustomerPortalUserIdMock: vi.fn(),
}));

// ── DB mock ───────────────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  db: { select: mockSelect, insert: mockInsert },
  salesOffersTable: { id: "id", serviceId: "service_id", customerId: "customer_id", title: "title" },
  servicesTable: { id: "id", name: "name", description: "description", serviceClass: "service_class" },
  projectsTable: { id: "id", title: "title", clientUserId: "client_user_id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (_c: unknown, _v: unknown) => ({ eq: [_c, _v] }),
}));

// ── The proven SOW engine — mocked; we assert HOW it is called, not run it ─────
vi.mock("./document-engine-sow", () => ({
  generateSowDocument: generateSowDocumentMock,
}));

// ── Customer -> portal-user resolver ──────────────────────────────────────────
vi.mock("./tenant-signals", () => ({
  resolveCustomerPortalUserId: resolveCustomerPortalUserIdMock,
}));

vi.mock("./logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// ── Fluent-chain helpers ──────────────────────────────────────────────────────
function selectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}
function insertChain(rows: unknown[]) {
  return {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  };
}

import { fulfillAcceptedProjectOffer } from "./project-sow-fulfillment";

const PROJECT_OFFER = { id: 7, serviceId: 34, customerId: 1, title: "BCDR Implementation — recommended for your environment" };
const PROJECT_SERVICE = { name: "BCDR Implementation", description: "Business continuity project.", serviceClass: "project" };

beforeEach(() => {
  vi.clearAllMocks();
  // Default SOW engine behaviour: announce the placeholder row, then resolve.
  generateSowDocumentMock.mockImplementation((params: { onRowCreated?: (id: number) => void }) => {
    params.onRowCreated?.(555);
    return Promise.resolve({ documentId: 555, htmlContent: "", costCents: 0, costStatus: "no-ai-call", reused: false });
  });
});

describe("fulfillAcceptedProjectOffer", () => {
  it("1. project offer: creates a project and drives the SOW engine, scoped + narrowed", async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([PROJECT_OFFER])) // offer lookup
      .mockReturnValueOnce(selectChain([PROJECT_SERVICE])); // service lookup
    mockInsert.mockReturnValue(insertChain([{ id: 909 }]));

    const result = await fulfillAcceptedProjectOffer({ offerId: 7, acceptedByUserId: 39 });

    expect(result.status).toBe("sow_generating");
    expect(result.projectId).toBe(909);
    expect(result.documentId).toBe(555);

    // Project row created with the CLEAN service name + accepting login as owner.
    const insertedValues = mockInsert.mock.results[0]?.value.values.mock.calls[0]?.[0];
    expect(insertedValues).toMatchObject({ title: "BCDR Implementation", clientUserId: 39, projectType: "project" });

    // The proven engine is driven with the accepted offer as a TITLE narrowing,
    // never a fixed price, scoped to the tenant (customerId), for the sow type.
    expect(generateSowDocumentMock).toHaveBeenCalledTimes(1);
    expect(generateSowDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mspCustomerId: 1,
        documentOwnerUserId: 39,
        projectId: 909,
        docTypeKey: "sow",
        selectedWorkstreamTitles: ["BCDR Implementation — recommended for your environment"],
        forceRegenerate: true,
      }),
    );
    // No fixed price is ever handed to the engine.
    const sowArgs = generateSowDocumentMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sowArgs).not.toHaveProperty("amountCents");
    expect(sowArgs).not.toHaveProperty("priceCents");
    // acceptedByUserId provided → no need to resolve a portal user.
    expect(resolveCustomerPortalUserIdMock).not.toHaveBeenCalled();
  });

  it("2. add_on offer: no project, no SOW", async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([{ ...PROJECT_OFFER, serviceId: 12 }]))
      .mockReturnValueOnce(selectChain([{ name: "Extra Seats", description: null, serviceClass: "add_on" }]));

    const result = await fulfillAcceptedProjectOffer({ offerId: 7, acceptedByUserId: 39 });

    expect(result.status).toBe("not_a_project");
    expect(mockInsert).not.toHaveBeenCalled();
    expect(generateSowDocumentMock).not.toHaveBeenCalled();
  });

  it("3. offer not found → offer_not_found, nothing generated", async () => {
    mockSelect.mockReturnValueOnce(selectChain([]));

    const result = await fulfillAcceptedProjectOffer({ offerId: 999 });

    expect(result.status).toBe("offer_not_found");
    expect(generateSowDocumentMock).not.toHaveBeenCalled();
  });

  it("4. offer with no serviceId → no_service", async () => {
    mockSelect.mockReturnValueOnce(selectChain([{ ...PROJECT_OFFER, serviceId: null }]));

    const result = await fulfillAcceptedProjectOffer({ offerId: 7 });

    expect(result.status).toBe("no_service");
    expect(generateSowDocumentMock).not.toHaveBeenCalled();
  });

  it("5. project offer with a null tenant → no_customer (engine cannot be scoped)", async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([{ ...PROJECT_OFFER, customerId: null }]))
      .mockReturnValueOnce(selectChain([PROJECT_SERVICE]));

    const result = await fulfillAcceptedProjectOffer({ offerId: 7, acceptedByUserId: 39 });

    expect(result.status).toBe("no_customer");
    expect(mockInsert).not.toHaveBeenCalled();
    expect(generateSowDocumentMock).not.toHaveBeenCalled();
  });

  it("6. project offer, no accepting login: owner resolved from the tenant's portal user", async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([PROJECT_OFFER]))
      .mockReturnValueOnce(selectChain([PROJECT_SERVICE]));
    mockInsert.mockReturnValue(insertChain([{ id: 42 }]));
    resolveCustomerPortalUserIdMock.mockResolvedValue(88);

    const result = await fulfillAcceptedProjectOffer({ offerId: 7 });

    expect(resolveCustomerPortalUserIdMock).toHaveBeenCalledWith(1);
    expect(result.status).toBe("sow_generating");
    const insertedValues = mockInsert.mock.results[0]?.value.values.mock.calls[0]?.[0];
    expect(insertedValues).toMatchObject({ clientUserId: 88 });
    expect(generateSowDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({ documentOwnerUserId: 88, mspCustomerId: 1 }),
    );
  });

  it("7. project offer with no resolvable owner → no_owner, nothing generated", async () => {
    mockSelect
      .mockReturnValueOnce(selectChain([PROJECT_OFFER]))
      .mockReturnValueOnce(selectChain([PROJECT_SERVICE]));
    resolveCustomerPortalUserIdMock.mockResolvedValue(null);

    const result = await fulfillAcceptedProjectOffer({ offerId: 7 });

    expect(result.status).toBe("no_owner");
    expect(mockInsert).not.toHaveBeenCalled();
    expect(generateSowDocumentMock).not.toHaveBeenCalled();
  });
});
