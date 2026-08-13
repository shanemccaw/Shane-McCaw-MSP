/**
 * Unit tests for the outbound webhook delivery engine.
 *
 * Tests cover:
 *  - HMAC-SHA256 signature generation and verification
 *  - generateWebhookSecret format
 *  - fanOutWebhooks: event-type filtering, tenant-scope, active/inactive
 *  - Delivery success/failure path recorded in DB mock
 *  - getDeliveryLog returning rows from DB
 *
 * Mocking approach:
 *  - mock.module() stubs @workspace/db, drizzle-orm, and ./logger.ts
 *  - globalThis.fetch is replaced per-test
 *  - fire-and-forget delivery awaited via a short setTimeout(0) flush
 *
 * Run: pnpm --filter @workspace/api-server run test
 */

import { describe, it, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// ── Shared mutable DB state ───────────────────────────────────────────────────

type WebhookRow = {
  webhookId: string;
  url: string;
  secret: string;
  eventTypes: string[];
  isActive: boolean;
  ownerType: string;
  mspId: number | null;
  customerId: number | null;
};

let webhookRows: WebhookRow[] = [];
let deliveryRows: Record<string, unknown>[] = [];
let insertedValues: Record<string, unknown>[] = [];
let updatedValues: Record<string, unknown>[] = [];

// ── DB mock helpers ───────────────────────────────────────────────────────────

function makeSelectChain(rows: unknown[]) {
  const c: Record<string, unknown> = {
    from: () => c,
    where: () => c,
    limit: () => c,
    orderBy: () => c,
    leftJoin: () => c,
    then: (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res),
    catch: (rej: (e: unknown) => unknown) => Promise.resolve(rows).catch(rej),
  };
  return c;
}

mock.module("./logger.ts", {
  namedExports: {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  },
});

mock.module("@workspace/db", {
  namedExports: {
    db: {
      select: (_cols?: unknown) => makeSelectChain(
        deliveryRows.length > 0 ? deliveryRows : webhookRows
      ),
      insert: () => ({
        values: (vals: Record<string, unknown>) => {
          insertedValues.push(vals);
          return {
            returning: () => Promise.resolve([{ deliveryId: "delivery-uuid-1" }]),
          };
        },
      }),
      update: () => ({
        set: (vals: Record<string, unknown>) => {
          updatedValues.push(vals);
          return { where: () => Promise.resolve() };
        },
      }),
    },
    outboundWebhooksTable: {
      webhookId: "webhookId_col",
      url: "url_col",
      secret: "secret_col",
      eventTypes: "eventTypes_col",
      isActive: "isActive_col",
      ownerType: "ownerType_col",
      mspId: "mspId_col",
      customerId: "customerId_col",
    },
    outboundWebhookDeliveriesTable: {
      deliveryId: "deliveryId_col",
      webhookId: "webhookId_col",
      eventId: "eventId_col",
      eventType: "eventType_col",
      attempt: "attempt_col",
      status: "status_col",
      statusCode: "statusCode_col",
      responseSnippet: "responseSnippet_col",
      requestBodySnapshot: "requestBodySnapshot_col",
      nextRetryAt: "nextRetryAt_col",
      deliveredAt: "deliveredAt_col",
      createdAt: "createdAt_col",
    },
  },
});

mock.module("drizzle-orm", {
  namedExports: {
    eq: (_a: unknown, _b: unknown) => "eq_clause",
    and: (..._args: unknown[]) => "and_clause",
    desc: (_col: unknown) => "desc_clause",
    or: (..._args: unknown[]) => "or_clause",
    inArray: (_col: unknown, _vals: unknown[]) => "inArray_clause",
    sql: Object.assign((_s: TemplateStringsArray) => "sql_clause", { raw: () => "sql_raw" }),
  },
});

// ── Lazy import ───────────────────────────────────────────────────────────────

let generateWebhookSecret: () => string;
let verifySignature: (secret: string, body: string, signature: string) => boolean;
let signPayload: (secret: string, body: string) => string;
let fanOutWebhooks: (event: {
  eventId: string;
  eventType: string;
  occurredAt: Date;
  mspId?: number | null;
  customerId?: number | null;
  payload?: Record<string, unknown>;
}) => Promise<void>;
let getDeliveryLog: (webhookId: string, limit?: number) => Promise<unknown[]>;

before(async () => {
  const mod = await import("./webhook-delivery.ts");
  generateWebhookSecret = mod.generateWebhookSecret;
  verifySignature = mod.verifySignature;
  signPayload = mod.signPayload;
  fanOutWebhooks = mod.fanOutWebhooks;
  getDeliveryLog = mod.getDeliveryLog;
});

// ── Reset state between tests ─────────────────────────────────────────────────

beforeEach(() => {
  webhookRows = [];
  deliveryRows = [];
  insertedValues = [];
  updatedValues = [];
});

// ── Helper: flush fire-and-forget promises ────────────────────────────────────

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

// ── generateWebhookSecret ─────────────────────────────────────────────────────

describe("generateWebhookSecret", () => {
  it("returns a string starting with whsec_", () => {
    const secret = generateWebhookSecret();
    assert.ok(secret.startsWith("whsec_"), `Expected whsec_ prefix, got: ${secret}`);
  });

  it("returns a 70-char string (whsec_ 6 + 64 hex chars)", () => {
    const secret = generateWebhookSecret();
    assert.equal(secret.length, 6 + 64);
  });

  it("generates unique secrets each call", () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    assert.notEqual(a, b);
  });
});

// ── signPayload / verifySignature ─────────────────────────────────────────────

describe("verifySignature", () => {
  it("validates a correctly signed payload (using signPayload output)", () => {
    const secret = "whsec_" + "a".repeat(64);
    const body = JSON.stringify({ foo: "bar" });
    const sig = signPayload(secret, body);

    assert.ok(verifySignature(secret, body, sig));
  });

  it("rejects a tampered payload", () => {
    const secret = "whsec_" + "b".repeat(64);
    const body = JSON.stringify({ foo: "bar" });
    const tampered = JSON.stringify({ foo: "baz" });
    const sig = signPayload(secret, body);

    assert.ok(!verifySignature(secret, tampered, sig));
  });

  it("rejects a wrong secret", () => {
    const secret = "whsec_" + "c".repeat(64);
    const wrongSecret = "whsec_" + "d".repeat(64);
    const body = JSON.stringify({ event: "test" });
    const sig = signPayload(secret, body);

    assert.ok(!verifySignature(wrongSecret, body, sig));
  });

  it("verifySignature output matches manual HMAC-SHA256", () => {
    const secret = "whsec_" + "e".repeat(64);
    const body = '{"hello":"world"}';
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

    assert.equal(signPayload(secret, body), expected);
    assert.ok(verifySignature(secret, body, expected));
  });
});

// ── fanOutWebhooks ────────────────────────────────────────────────────────────

describe("fanOutWebhooks", () => {
  it("skips delivery when no webhooks are configured", async () => {
    webhookRows = [];

    let fetchCalled = false;
    const orig = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    };

    await fanOutWebhooks({ eventId: "e1", eventType: "tenant.created", occurredAt: new Date(), mspId: 1 });

    (globalThis as Record<string, unknown>).fetch = orig;
    assert.ok(!fetchCalled, "fetch should not be called with no webhooks");
  });

  it("delivers to matching active webhook and records the insert", async () => {
    const secret = generateWebhookSecret();
    webhookRows = [
      {
        webhookId: "wh-1",
        url: "https://example.com/hook",
        secret,
        eventTypes: ["tenant.created"],
        isActive: true,
        ownerType: "msp",
        mspId: 10,
        customerId: null,
      },
    ];

    let capturedBody = "";
    let capturedSig = "";
    const orig = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = async (_url: string, opts: RequestInit) => {
      capturedBody = opts.body as string;
      capturedSig = (opts.headers as Record<string, string>)["X-Webhook-Signature"] ?? "";
      return new Response("{}", { status: 200 });
    };

    await fanOutWebhooks({
      eventId: "e2",
      eventType: "tenant.created",
      occurredAt: new Date(),
      mspId: 10,
      payload: { name: "Acme" },
    });

    await flushAsync();
    (globalThis as Record<string, unknown>).fetch = orig;

    assert.ok(capturedBody.length > 0, "body should be non-empty");
    const parsed = JSON.parse(capturedBody) as Record<string, unknown>;
    assert.equal(parsed["eventType"], "tenant.created", "payload.eventType should match");
    assert.ok(capturedSig.startsWith("sha256="), "sig header must start with sha256=");

    assert.ok(insertedValues.length >= 1, "Should insert a delivery record");
    assert.equal((insertedValues[0] as Record<string, unknown>)["webhookId"], "wh-1");
  });

  it("skips inactive webhooks", async () => {
    const secret = generateWebhookSecret();
    webhookRows = [
      {
        webhookId: "wh-inactive",
        url: "https://example.com/inactive",
        secret,
        eventTypes: ["tenant.created"],
        isActive: false,
        ownerType: "msp",
        mspId: 20,
        customerId: null,
      },
    ];

    let fetchCalled = false;
    const orig = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    };

    await fanOutWebhooks({ eventId: "e3", eventType: "tenant.created", occurredAt: new Date(), mspId: 20 });

    (globalThis as Record<string, unknown>).fetch = orig;
    assert.ok(!fetchCalled, "Inactive webhook should not receive delivery");
  });

  it("skips webhooks not subscribed to the event type", async () => {
    const secret = generateWebhookSecret();
    webhookRows = [
      {
        webhookId: "wh-2",
        url: "https://example.com/hook2",
        secret,
        eventTypes: ["project.created"],
        isActive: true,
        ownerType: "msp",
        mspId: 30,
        customerId: null,
      },
    ];

    let fetchCalled = false;
    const orig = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    };

    await fanOutWebhooks({ eventId: "e4", eventType: "tenant.created", occurredAt: new Date(), mspId: 30 });

    (globalThis as Record<string, unknown>).fetch = orig;
    assert.ok(!fetchCalled, "Webhook not subscribed to event type should not be called");
  });

  it("skips webhooks with mismatched tenant scope", async () => {
    const secret = generateWebhookSecret();
    webhookRows = [
      {
        webhookId: "wh-3",
        url: "https://example.com/hook3",
        secret,
        eventTypes: ["tenant.created"],
        isActive: true,
        ownerType: "msp",
        mspId: 40,
        customerId: null,
      },
    ];

    let fetchCalled = false;
    const orig = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    };

    // Different mspId — should not match
    await fanOutWebhooks({ eventId: "e5", eventType: "tenant.created", occurredAt: new Date(), mspId: 99 });

    (globalThis as Record<string, unknown>).fetch = orig;
    assert.ok(!fetchCalled, "Webhook with mismatched mspId should not receive delivery");
  });

  it("records a failure update on non-2xx HTTP response", async () => {
    const secret = generateWebhookSecret();
    webhookRows = [
      {
        webhookId: "wh-4",
        url: "https://example.com/hook4",
        secret,
        eventTypes: ["project.created"],
        isActive: true,
        ownerType: "msp",
        mspId: 50,
        customerId: null,
      },
    ];

    const orig = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = async () =>
      new Response("Internal Server Error", { status: 500 });

    await fanOutWebhooks({ eventId: "e6", eventType: "project.created", occurredAt: new Date(), mspId: 50 });

    // Flush the fire-and-forget attemptDelivery call
    await flushAsync();
    (globalThis as Record<string, unknown>).fetch = orig;

    const failedUpdate = updatedValues.find(
      (d) => (d as Record<string, unknown>)["statusCode"] === 500,
    );
    assert.ok(failedUpdate, "Expected a DB update row with statusCode=500");
  });
});

// ── getDeliveryLog ────────────────────────────────────────────────────────────

describe("getDeliveryLog", () => {
  it("returns mapped delivery rows from DB", async () => {
    deliveryRows = [
      {
        deliveryId: "d-uuid-1",
        webhookId: "wh-uuid-1",
        eventId: "e-uuid-1",
        eventType: "tenant.created",
        attempt: 1,
        status: "success",
        statusCode: 200,
        responseSnippet: null,
        nextRetryAt: null,
        deliveredAt: new Date("2026-07-01T00:00:00Z"),
        createdAt: new Date("2026-07-01T00:00:00Z"),
      },
    ];

    const result = await getDeliveryLog("wh-uuid-1", 20);

    assert.ok(Array.isArray(result), "getDeliveryLog should return an array");
    assert.equal(result.length, 1);
    assert.equal((result[0] as Record<string, unknown>)["deliveryId"], "d-uuid-1");
    assert.equal((result[0] as Record<string, unknown>)["eventType"], "tenant.created");
    assert.equal((result[0] as Record<string, unknown>)["status"], "success");
  });
});
