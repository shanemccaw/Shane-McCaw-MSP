/**
 * Phase 0 — Correlation ID spine (AsyncLocalStorage) end-to-end test.
 *
 * Proves the contract introduced by lib/request-context.ts:
 *   1. One traceId per request (forwarded X-Trace-Id or generated once),
 *      echoed in the x-trace-id response header.
 *   2. requireAuth enriches the SAME context with mspId/customerId/actor
 *      once the JWT is verified.
 *   3. mspRequestLog reads the SAME traceId (no second id generated).
 *   4. dispatchUnsafe events inherit the request's traceId as correlationId
 *      when the caller doesn't pass one explicitly.
 *   5. An explicitly passed correlationId still wins.
 *   6. Outside any request (background jobs), dispatch falls back to a
 *      fresh randomUUID() — unchanged pre-Phase-0 behaviour.
 *
 * The real express middleware chain from app.ts is replicated here with the
 * REAL request-context, requireAuth, mspRequestLog and event-bus modules;
 * only the DB layer and webhook fan-out are mocked.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import pinoHttp from "pino-http";
import pino from "pino";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

process.env.JWT_SECRET = "request-context-spine-test-secret";

vi.mock("@workspace/db", () => {
  const insertCalls: { table: { __name?: string }; values: Record<string, unknown> }[] = [];
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "orderBy", "leftJoin", "innerJoin", "groupBy"]) {
      c[m] = () => chain();
    }
    c["then"] = (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve);
    return c;
  };
  return {
    __insertCalls: insertCalls,
    db: {
      select: () => chain(),
      insert: (table: { __name?: string }) => ({
        values: async (values: Record<string, unknown>) => {
          insertCalls.push({ table, values });
          return [];
        },
      }),
      update: () => ({ set: () => ({ where: async () => [] }) }),
      delete: () => ({ where: async () => [] }),
    },
    mspEventStoreTable: { __name: "msp_event_store" },
    mspCustomersTable: { __name: "msp_customers" },
    mspAuditLogsTable: { __name: "msp_audit_logs" },
    outboundWebhooksTable: { __name: "outbound_webhooks" },
    outboundWebhookDeliveriesTable: { __name: "outbound_webhook_deliveries" },
  };
});

vi.mock("../lib/webhook-delivery.ts", () => ({
  fanOutWebhooks: vi.fn(async () => {}),
}));

import { runWithRequestContext, getRequestContext } from "../lib/request-context.ts";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { mspRequestLog } from "../middlewares/mspRequestLog.ts";
import { dispatchUnsafe, systemActor } from "../lib/event-bus.ts";
import * as dbModule from "@workspace/db";

const insertCalls = (dbModule as unknown as {
  __insertCalls: { table: { __name?: string }; values: Record<string, unknown> }[];
}).__insertCalls;

function eventStoreInserts() {
  return insertCalls.filter((c) => c.table.__name === "msp_event_store");
}

// ── Test app: replicates the app.ts middleware order exactly ──────────────────

function buildApp() {
  const app = express();

  // 1. ALS context — must be the very first middleware (app.ts)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const forwarded = req.headers["x-trace-id"];
    const traceId =
      typeof forwarded === "string" && UUID_RE.test(forwarded) ? forwarded : randomUUID();
    runWithRequestContext({ traceId, mspId: null, customerId: null, actor: null }, next);
  });

  // 2. pino-http reusing the ALS traceId (app.ts genReqId)
  app.use(
    pinoHttp({
      logger: pino({ enabled: false }),
      genReqId() {
        return getRequestContext()?.traceId ?? randomUUID();
      },
    }),
  );

  // 3. Echo traceId header (app.ts)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const traceId = (req as unknown as { id?: string }).id ?? randomUUID();
    res.setHeader("x-trace-id", traceId);
    next();
  });

  // 4. MSP router: mspRequestLog before requireAuth, like /api/msp/v1
  const mspRouter = express.Router();
  mspRouter.use(mspRequestLog);
  mspRouter.get("/ping", requireAuth, async (req: Request, res: Response) => {
    const explicit = req.query["explicitCorrelation"];
    await dispatchUnsafe({
      eventType: "test.spine.ping",
      source: "request-context-spine-test",
      actor: systemActor(),
      mspId: 42,
      customerId: 99,
      ...(typeof explicit === "string" && explicit.length > 0
        ? { correlationId: explicit }
        : {}),
      payload: {},
    });
    res.json({
      ctx: getRequestContext(),
      localsTraceId: res.locals["traceId"],
    });
  });
  app.use("/api/msp/v1", mspRouter);

  return app;
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = buildApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  insertCalls.length = 0;
});

function makeToken(): string {
  return jwt.sign(
    { id: 7, email: "op@test.example", role: "client", mspRole: "MSPAdmin", mspId: 42, customerId: 99 },
    process.env.JWT_SECRET as string,
  );
}

describe("correlation id spine (AsyncLocalStorage)", () => {
  it("forwarded x-trace-id flows to response header, auth-enriched context, res.locals, and event correlationId", async () => {
    const traceId = randomUUID();
    const res = await fetch(`${baseUrl}/api/msp/v1/ping`, {
      headers: { authorization: `Bearer ${makeToken()}`, "x-trace-id": traceId },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-trace-id")).toBe(traceId);

    const body = (await res.json()) as {
      ctx: { traceId: string; mspId: number | null; customerId: number | null; actor: { id: number; role: string } | null };
      localsTraceId: string;
    };
    // One id everywhere — no second generation point
    expect(body.ctx.traceId).toBe(traceId);
    expect(body.localsTraceId).toBe(traceId);
    // requireAuth enriched the SAME context once the JWT resolved
    expect(body.ctx.mspId).toBe(42);
    expect(body.ctx.customerId).toBe(99);
    expect(body.ctx.actor).toEqual({ id: 7, role: "MSPAdmin" });

    // The dispatched event inherited the request's traceId as correlationId
    const events = eventStoreInserts();
    expect(events).toHaveLength(1);
    expect(events[0]!.values["correlationId"]).toBe(traceId);
  });

  it("generates one traceId when none is forwarded and events still inherit it", async () => {
    const res = await fetch(`${baseUrl}/api/msp/v1/ping`, {
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    expect(res.status).toBe(200);
    const headerTraceId = res.headers.get("x-trace-id");
    expect(headerTraceId).toMatch(/^[0-9a-f-]{36}$/);

    const body = (await res.json()) as { ctx: { traceId: string }; localsTraceId: string };
    expect(body.ctx.traceId).toBe(headerTraceId);
    expect(body.localsTraceId).toBe(headerTraceId);

    const events = eventStoreInserts();
    expect(events).toHaveLength(1);
    expect(events[0]!.values["correlationId"]).toBe(headerTraceId);
  });

  it("an explicitly passed correlationId still wins over the request traceId", async () => {
    const explicit = randomUUID();
    const traceId = randomUUID();
    const res = await fetch(
      `${baseUrl}/api/msp/v1/ping?explicitCorrelation=${explicit}`,
      { headers: { authorization: `Bearer ${makeToken()}`, "x-trace-id": traceId } },
    );
    expect(res.status).toBe(200);

    const events = eventStoreInserts();
    expect(events).toHaveLength(1);
    expect(events[0]!.values["correlationId"]).toBe(explicit);
    expect(events[0]!.values["correlationId"]).not.toBe(traceId);
  });

  it("rejects a non-UUID forwarded x-trace-id and regenerates so dispatch still succeeds", async () => {
    const res = await fetch(`${baseUrl}/api/msp/v1/ping`, {
      headers: { authorization: `Bearer ${makeToken()}`, "x-trace-id": "not-a-uuid'; DROP TABLE--" },
    });
    expect(res.status).toBe(200);
    const headerTraceId = res.headers.get("x-trace-id");
    expect(headerTraceId).toMatch(/^[0-9a-f-]{36}$/);

    const events = eventStoreInserts();
    expect(events).toHaveLength(1);
    expect(events[0]!.values["correlationId"]).toBe(headerTraceId);
  });

  it("outside any request context, dispatch falls back to a fresh randomUUID (background-job behaviour unchanged)", async () => {
    expect(getRequestContext()).toBeUndefined();
    await dispatchUnsafe({
      eventType: "test.spine.background",
      source: "request-context-spine-test",
      actor: systemActor(),
      mspId: 42,
      payload: {},
    });
    await dispatchUnsafe({
      eventType: "test.spine.background",
      source: "request-context-spine-test",
      actor: systemActor(),
      mspId: 42,
      payload: {},
    });
    const events = eventStoreInserts();
    expect(events).toHaveLength(2);
    const [a, b] = events.map((e) => e.values["correlationId"] as string);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(b).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });
});
