/**
 * Phase 1a-fix — log-stream mirror hook (lib/logger.ts) regression coverage.
 *
 * Proves:
 *   1. A single logger.info() call produces exactly one queued entry with
 *      the correct level (the level-mapping bug caught manually in Phase 1a).
 *   2. Child-logger channel bindings flow into the mirrored entry.
 *   3. Rapid successive calls are drained into ONE batched INSERT, not one
 *      per call.
 *   4. The active request context's traceId is mirrored as correlationId.
 *   5. Sensitive fields (authorization header) are redacted in the mirrored
 *      meta, not just in pino's own stdout serialization.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@workspace/db", () => {
  const insertCalls: { table: { __name?: string }; values: Record<string, unknown>[] }[] = [];
  return {
    __insertCalls: insertCalls,
    db: {
      insert: (table: { __name?: string }) => ({
        values: async (values: Record<string, unknown>[]) => {
          insertCalls.push({ table, values });
          return [];
        },
      }),
    },
    platformLogStreamTable: { __name: "platform_log_stream" },
  };
});

import * as dbModule from "@workspace/db";
import { logger } from "../lib/logger.ts";
import { runWithRequestContext } from "../lib/request-context.ts";

const insertCalls = (dbModule as unknown as {
  __insertCalls: { table: { __name?: string }; values: Record<string, unknown>[] }[];
}).__insertCalls;

// The writer only flushes on its 1s timer, at MAX_QUEUE_SIZE, or on
// 'beforeExit'. Firing 'beforeExit' manually gives tests a deterministic
// flush point without waiting out the real timer.
async function flushQueue() {
  process.emit("beforeExit", 0);
  await new Promise((resolve) => setTimeout(resolve, 10));
}

beforeEach(() => {
  insertCalls.length = 0;
});

describe("log stream mirror (lib/logger.ts)", () => {
  it("mirrors logger.info to exactly one queued entry with the correct level", async () => {
    logger.info({ foo: "bar" }, "hello world");
    await flushQueue();

    expect(insertCalls).toHaveLength(1);
    const rows = insertCalls[0]!.values;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.level).toBe("info");
    expect(rows[0]!.message).toBe("hello world");
  });

  it("carries a child logger's channel binding into the mirrored entry", async () => {
    logger.child({ channel: "engine.sla" }).warn("scope drift detected");
    await flushQueue();

    expect(insertCalls).toHaveLength(1);
    const rows = insertCalls[0]!.values;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.channel).toBe("engine.sla");
    expect(rows[0]!.level).toBe("warn");
  });

  it("batches rapid successive calls into a single INSERT with all rows", async () => {
    logger.error("first");
    logger.error("second");
    logger.error("third");
    await flushQueue();

    expect(insertCalls).toHaveLength(1);
    const rows = insertCalls[0]!.values;
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.message)).toEqual(["first", "second", "third"]);
  });

  it("mirrors the active request context's traceId as correlationId", async () => {
    runWithRequestContext(
      { traceId: "11111111-1111-1111-1111-111111111111", mspId: null, customerId: null, actor: null },
      () => {
        logger.info("inside request context");
      },
    );
    await flushQueue();

    expect(insertCalls).toHaveLength(1);
    const rows = insertCalls[0]!.values;
    expect(rows[0]!.correlationId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("redacts the authorization header in the mirrored meta", async () => {
    logger.error(
      { req: { headers: { authorization: "Bearer secret123" } } },
      "test",
    );
    await flushQueue();

    expect(insertCalls).toHaveLength(1);
    const rows = insertCalls[0]!.values;
    const meta = rows[0]!.meta as { req: { headers: { authorization: string } } };
    expect(meta.req.headers.authorization).toBe("[Redacted]");
  });
});
