/**
 * resolve-fulfillment.test.ts (vitest)
 *
 * Tests for the shared resolveFulfillment function:
 *   1. Purchase-triggered fan-out — emits the correct event
 *   2. Signal-triggered fan-out  — same mechanism, different trigger label
 *   3. Idempotency — duplicate call with same key is a no-op
 *   4. Unknown / inactive type  — returns "unknown_type", no event emitted
 *   5. Concurrent race guard    — DB-level ON CONFLICT → "duplicate"
 *   6. resolveFulfillmentForSignal — key derivation + delegation
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ── Environment stubs ─────────────────────────────────────────────────────────
process.env.DATABASE_URL = "postgres://test";

// ── DB mock ───────────────────────────────────────────────────────────────────
let selectReturnValue: unknown[] = [];
let insertReturnValue: unknown[] = [{ key: "test-idem-key" }];

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock("@workspace/db", () => {
  const db = {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
  };

  return {
    db,
    pool: { end: vi.fn() },
    fulfillmentTypesTable: { key: "key", isActive: "is_active" },
    fulfillmentIdempotencyTable: {
      idempotencyKey: "idempotency_key",
      fulfillmentTypeKey: "fulfillment_type_key",
      payload: "payload",
    },
    clientServicesTable: {
      clientUserId: "client_user_id",
      serviceId: "service_id",
      status: "status",
    },
  };
});

// ── tenant-signals mock (client_services.clientUserId resolution) ─────────────
const resolveCustomerPortalUserIdMock = vi.fn();
vi.mock("./tenant-signals", () => ({
  resolveCustomerPortalUserId: resolveCustomerPortalUserIdMock,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col, _val) => ({ col: _col, val: _val })),
}));

// ── Workflow executor mock ────────────────────────────────────────────────────
const emitWorkflowEventMock = vi.fn().mockResolvedValue(undefined);
vi.mock("./workflow-executor", () => ({
  emitWorkflowEvent: emitWorkflowEventMock,
}));

// ── Logger mock ───────────────────────────────────────────────────────────────
vi.mock("./logger", () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

// ── Helper to rebuild the fluent db chain for select ────────────────────────
function makeSelectChain(results: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(results),
  };
  return chain;
}

// ── Helper to rebuild the fluent db chain for insert ────────────────────────
function makeInsertChain(results: unknown[]) {
  const chain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(results),
  };
  return chain;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("resolveFulfillment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emitWorkflowEventMock.mockResolvedValue(undefined);
  });

  it("1. emits fulfillment.<key> for a purchase trigger", async () => {
    // First select → returns the FulfillmentType row
    // Second select → idempotency check returns empty (not seen before)
    mockSelect
      .mockReturnValueOnce(makeSelectChain([{ key: "assessment", isActive: true, recurring: false }]))
      .mockReturnValueOnce(makeSelectChain([]));
    // Insert succeeds → returns a row (idempotency slot claimed)
    mockInsert.mockReturnValue(makeInsertChain([{ key: "idem-1" }]));

    const { resolveFulfillment } = await import("./resolve-fulfillment");

    const result = await resolveFulfillment({
      fulfillmentTypeKey: "assessment",
      idempotencyKey: "stripe-cs-test-001",
      trigger: "purchase",
      payload: { clientUserId: 42, amountCents: 50000 },
    });

    expect(result.status).toBe("emitted");
    expect(result.eventName).toBe("fulfillment.assessment");
    expect(emitWorkflowEventMock).toHaveBeenCalledOnce();
    expect(emitWorkflowEventMock).toHaveBeenCalledWith(
      "fulfillment.assessment",
      expect.objectContaining({
        fulfillmentTypeKey: "assessment",
        idempotencyKey: "stripe-cs-test-001",
        trigger: "purchase",
        clientUserId: 42,
        amountCents: 50000,
        recurring: false,
      }),
    );
  });

  it("2. emits for a signal trigger — same mechanism", async () => {
    mockSelect
      .mockReturnValueOnce(makeSelectChain([{ key: "retainer", isActive: true, recurring: true }]))
      .mockReturnValueOnce(makeSelectChain([]));
    mockInsert.mockReturnValue(makeInsertChain([{ key: "idem-2" }]));

    const { resolveFulfillment } = await import("./resolve-fulfillment");

    const result = await resolveFulfillment({
      fulfillmentTypeKey: "retainer",
      idempotencyKey: "signal:crm:high_intent:svc:5:client:7:2026-07-11",
      trigger: "signal",
      payload: { signalKey: "crm:high_intent", clientUserId: 7, serviceId: 5 },
    });

    expect(result.status).toBe("emitted");
    expect(result.eventName).toBe("fulfillment.retainer");
    expect(emitWorkflowEventMock).toHaveBeenCalledWith(
      "fulfillment.retainer",
      expect.objectContaining({ trigger: "signal", signalKey: "crm:high_intent" }),
    );
  });

  it("3. returns 'duplicate' when idempotency key is already recorded", async () => {
    mockSelect
      .mockReturnValueOnce(makeSelectChain([{ key: "assessment", isActive: true, recurring: false }]))
      .mockReturnValueOnce(makeSelectChain([{ idempotencyKey: "stripe-cs-test-001" }])); // already seen

    const { resolveFulfillment } = await import("./resolve-fulfillment");

    const result = await resolveFulfillment({
      fulfillmentTypeKey: "assessment",
      idempotencyKey: "stripe-cs-test-001",
      trigger: "purchase",
      payload: {},
    });

    expect(result.status).toBe("duplicate");
    expect(emitWorkflowEventMock).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("4. returns 'unknown_type' for an unregistered key", async () => {
    mockSelect.mockReturnValueOnce(makeSelectChain([])); // type lookup misses

    const { resolveFulfillment } = await import("./resolve-fulfillment");

    const result = await resolveFulfillment({
      fulfillmentTypeKey: "nonexistent_type",
      idempotencyKey: "idem-xyz",
      trigger: "purchase",
      payload: {},
    });

    expect(result.status).toBe("unknown_type");
    expect(emitWorkflowEventMock).not.toHaveBeenCalled();
  });

  it("4b. returns 'unknown_type' when type is inactive", async () => {
    mockSelect.mockReturnValueOnce(
      makeSelectChain([{ key: "assessment", isActive: false, recurring: false }]),
    );

    const { resolveFulfillment } = await import("./resolve-fulfillment");

    const result = await resolveFulfillment({
      fulfillmentTypeKey: "assessment",
      idempotencyKey: "idem-inactive",
      trigger: "purchase",
      payload: {},
    });

    expect(result.status).toBe("unknown_type");
    expect(emitWorkflowEventMock).not.toHaveBeenCalled();
  });

  it("5. returns 'duplicate' when DB insert returns empty (concurrent race)", async () => {
    mockSelect
      .mockReturnValueOnce(makeSelectChain([{ key: "assessment", isActive: true, recurring: false }]))
      .mockReturnValueOnce(makeSelectChain([])); // idempotency check clean
    mockInsert.mockReturnValue(makeInsertChain([])); // insert returns nothing → lost race

    const { resolveFulfillment } = await import("./resolve-fulfillment");

    const result = await resolveFulfillment({
      fulfillmentTypeKey: "assessment",
      idempotencyKey: "concurrent-race-key",
      trigger: "purchase",
      payload: {},
    });

    expect(result.status).toBe("duplicate");
    expect(emitWorkflowEventMock).not.toHaveBeenCalled();
  });

  it("7. monitoring_subscription purchase provisions an active client_services row (Git #1164)", async () => {
    mockSelect
      .mockReturnValueOnce(makeSelectChain([{ key: "monitoring_subscription", isActive: true, recurring: true }]))
      .mockReturnValueOnce(makeSelectChain([])); // idempotency check clean
    mockInsert
      .mockReturnValueOnce(makeInsertChain([{ key: "idem-monitoring" }])) // idempotency insert
      .mockReturnValueOnce(makeInsertChain([{ id: 501 }])); // client_services insert
    resolveCustomerPortalUserIdMock.mockResolvedValueOnce(42);

    const { resolveFulfillment } = await import("./resolve-fulfillment");

    const result = await resolveFulfillment({
      fulfillmentTypeKey: "monitoring_subscription",
      idempotencyKey: "portal_offer_checkout:direct:99:sub_123",
      trigger: "purchase",
      payload: { offerId: 99, customerId: 7, serviceId: 6, subscriptionId: "sub_123" },
    });

    expect(result.status).toBe("emitted");
    expect(resolveCustomerPortalUserIdMock).toHaveBeenCalledWith(7);
    expect(mockInsert).toHaveBeenCalledTimes(2);
    const clientServicesInsertCall = mockInsert.mock.calls[1];
    expect(clientServicesInsertCall[0]).toEqual({
      clientUserId: "client_user_id",
      serviceId: "service_id",
      status: "status",
    });
    const clientServicesValuesArg = mockInsert.mock.results[1].value.values.mock.calls[0][0];
    expect(clientServicesValuesArg).toMatchObject({
      clientUserId: 42,
      serviceId: 6,
      status: "active",
      progress: 0,
      stripeSubscriptionId: "sub_123",
    });
  });

  it("7b. monitoring_subscription purchase with no resolvable portal user skips the write without throwing", async () => {
    mockSelect
      .mockReturnValueOnce(makeSelectChain([{ key: "monitoring_subscription", isActive: true, recurring: true }]))
      .mockReturnValueOnce(makeSelectChain([]));
    mockInsert.mockReturnValueOnce(makeInsertChain([{ key: "idem-monitoring-2" }]));
    resolveCustomerPortalUserIdMock.mockResolvedValueOnce(null);

    const { resolveFulfillment } = await import("./resolve-fulfillment");

    const result = await resolveFulfillment({
      fulfillmentTypeKey: "monitoring_subscription",
      idempotencyKey: "portal_offer_checkout:direct:100:sub_456",
      trigger: "purchase",
      payload: { offerId: 100, customerId: 8, serviceId: 6 },
    });

    expect(result.status).toBe("emitted");
    expect(mockInsert).toHaveBeenCalledTimes(1); // idempotency row only — no client_services insert
  });

  it("7c. monitoring_subscription purchase missing serviceId/customerId skips the write without throwing", async () => {
    mockSelect
      .mockReturnValueOnce(makeSelectChain([{ key: "monitoring_subscription", isActive: true, recurring: true }]))
      .mockReturnValueOnce(makeSelectChain([]));
    mockInsert.mockReturnValueOnce(makeInsertChain([{ key: "idem-monitoring-3" }]));

    const { resolveFulfillment } = await import("./resolve-fulfillment");

    const result = await resolveFulfillment({
      fulfillmentTypeKey: "monitoring_subscription",
      idempotencyKey: "portal_offer_checkout:direct:101:sub_789",
      trigger: "purchase",
      payload: { offerId: 101, customerId: 9 }, // no serviceId
    });

    expect(result.status).toBe("emitted");
    expect(resolveCustomerPortalUserIdMock).not.toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("7d. direct-checkout passes clientUserId directly — provisions without a tenant→user lookup (Git #1165)", async () => {
    mockSelect
      .mockReturnValueOnce(makeSelectChain([{ key: "monitoring_subscription", isActive: true, recurring: true }]))
      .mockReturnValueOnce(makeSelectChain([])); // idempotency clean
    mockInsert
      .mockReturnValueOnce(makeInsertChain([{ key: "idem-monitoring-4" }])) // idempotency row
      .mockReturnValueOnce(makeInsertChain([{ id: 777 }])); // client_services row

    const { resolveFulfillment } = await import("./resolve-fulfillment");

    const result = await resolveFulfillment({
      fulfillmentTypeKey: "monitoring_subscription",
      idempotencyKey: "direct_checkout:session:cs_abc:svc:6",
      trigger: "purchase",
      // The direct marketing checkout already resolved the buyer's users.id and
      // passes it straight through; customerId (tenant) is null here.
      payload: { clientUserId: 5, customerId: null, serviceId: 6, subscriptionId: "sub_direct" },
    });

    expect(result.status).toBe("emitted");
    // The explicit users.id short-circuits the tenant→user resolver entirely.
    expect(resolveCustomerPortalUserIdMock).not.toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledTimes(2);
    const clientServicesValuesArg = mockInsert.mock.results[1].value.values.mock.calls[0][0];
    expect(clientServicesValuesArg).toMatchObject({
      clientUserId: 5,
      serviceId: 6,
      status: "active",
      stripeSubscriptionId: "sub_direct",
    });
  });
});

describe("resolveFulfillmentForSignal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emitWorkflowEventMock.mockResolvedValue(undefined);
  });

  it("6. derives a deterministic key and delegates to resolveFulfillment", async () => {
    mockSelect
      .mockReturnValueOnce(makeSelectChain([{ key: "assessment", isActive: true, recurring: false }]))
      .mockReturnValueOnce(makeSelectChain([]));
    mockInsert.mockReturnValue(makeInsertChain([{ key: "auto-key" }]));

    const { resolveFulfillmentForSignal } = await import("./resolve-fulfillment");

    const result = await resolveFulfillmentForSignal({
      fulfillmentTypeKey: "assessment",
      signalKey: "m365:low_security_score",
      clientUserId: 99,
      serviceId: 12,
    });

    expect(result.status).toBe("emitted");
    expect(emitWorkflowEventMock).toHaveBeenCalledWith(
      "fulfillment.assessment",
      expect.objectContaining({
        trigger: "signal",
        signalKey: "m365:low_security_score",
        clientUserId: 99,
        serviceId: 12,
      }),
    );
  });

  it("6b. uses a caller-supplied idempotencyKey override when provided", async () => {
    mockSelect
      .mockReturnValueOnce(makeSelectChain([{ key: "retainer", isActive: true, recurring: true }]))
      .mockReturnValueOnce(makeSelectChain([]));
    mockInsert.mockReturnValue(makeInsertChain([{ key: "custom-key" }]));

    const { resolveFulfillmentForSignal } = await import("./resolve-fulfillment");

    const result = await resolveFulfillmentForSignal({
      fulfillmentTypeKey: "retainer",
      signalKey: "crm:warm_lead",
      idempotencyKey: "my-custom-idem-key-xyz",
    });

    expect(result.status).toBe("emitted");
    expect(result.idempotencyKey).toBe("my-custom-idem-key-xyz");
  });
});
