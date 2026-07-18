/**
 * Phase 1.5 — exception-tracker (lib/exception-tracker.ts) coverage.
 *
 * Proves:
 *   1. normalizeMessage collapses dynamic tokens (numbers, UUIDs) so recurring
 *      instances group under one fingerprint.
 *   2. computeFingerprint is stable for the same name/file/line/normalized
 *      message and differs when the (normalized) message genuinely differs.
 *   3. parseTopFrame extracts the first in-repo frame across POSIX and Windows
 *      path separators.
 *   4. captureException issues a group upsert carrying the auto-reopen /
 *      occurrence-increment `set`, and an occurrence insert carrying the active
 *      request context's traceId as correlationId.
 *
 * Grouping *behaviour* (occurrenceCount → 2, resolved→open reopen,
 * suppressed-stays-suppressed) is enforced by the onConflictDoUpdate SQL and
 * can only be proven against a live DB (no test DB exists here); this file
 * asserts the correct upsert is *issued*.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@workspace/db", () => {
  const groupInserts: Record<string, unknown>[] = [];
  const groupUpserts: { target: unknown; set: Record<string, unknown> }[] = [];
  const occurrenceInserts: Record<string, unknown>[] = [];

  const makeValuesResult = (table: { __name?: string }, values: Record<string, unknown>) => {
    if (table.__name === "exception_groups") groupInserts.push(values);
    else if (table.__name === "exception_occurrences") occurrenceInserts.push(values);
    return {
      onConflictDoUpdate: (cfg: { target: unknown; set: Record<string, unknown> }) => {
        groupUpserts.push(cfg);
        return Promise.resolve([]);
      },
      // Also awaitable directly (the occurrence insert has no onConflict).
      then: (resolve: (v: unknown) => void) => resolve([]),
    };
  };

  return {
    __groupInserts: groupInserts,
    __groupUpserts: groupUpserts,
    __occurrenceInserts: occurrenceInserts,
    db: {
      insert: (table: { __name?: string }) => ({
        values: (values: Record<string, unknown>) => makeValuesResult(table, values),
      }),
    },
    exceptionGroupsTable: {
      __name: "exception_groups",
      fingerprint: "fingerprint",
      occurrenceCount: "occurrence_count",
      status: "status",
    },
    exceptionOccurrencesTable: { __name: "exception_occurrences" },
  };
});

import * as dbModule from "@workspace/db";
import {
  captureException,
  normalizeMessage,
  parseTopFrame,
  computeFingerprint,
} from "./exception-tracker.ts";
import { runWithRequestContext } from "./request-context.ts";

const mock = dbModule as unknown as {
  __groupInserts: Record<string, unknown>[];
  __groupUpserts: { target: unknown; set: Record<string, unknown> }[];
  __occurrenceInserts: Record<string, unknown>[];
};

beforeEach(() => {
  mock.__groupInserts.length = 0;
  mock.__groupUpserts.length = 0;
  mock.__occurrenceInserts.length = 0;
});

describe("normalizeMessage", () => {
  it("collapses numbers and UUIDs to placeholders", () => {
    expect(normalizeMessage("user 123 not found")).toBe("user <n> not found");
    expect(
      normalizeMessage("tenant 550e8400-e29b-41d4-a716-446655440000 missing"),
    ).toBe("tenant <uuid> missing");
  });
});

describe("computeFingerprint", () => {
  it("is stable for identical inputs and 32 hex chars", () => {
    const a = computeFingerprint("TypeError", "/app/src/x.ts", 10, "boom <n>");
    const b = computeFingerprint("TypeError", "/app/src/x.ts", 10, "boom <n>");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it("groups messages that normalize to the same string; separates ones that don't", () => {
    const fpA1 = computeFingerprint("Error", "/app/src/x.ts", 5, normalizeMessage("user 123 not found"));
    const fpA2 = computeFingerprint("Error", "/app/src/x.ts", 5, normalizeMessage("user 456 not found"));
    const fpB = computeFingerprint("Error", "/app/src/x.ts", 5, normalizeMessage("db connection lost"));
    expect(fpA1).toBe(fpA2); // same bug, different runtime value → one group
    expect(fpA1).not.toBe(fpB); // genuinely different message → separate group
  });
});

describe("parseTopFrame", () => {
  it("extracts the first in-repo frame (POSIX), skipping node_modules", () => {
    const stack = [
      "Error: boom",
      "    at bar (/app/node_modules/pkg/index.js:1:1)",
      "    at foo (/app/src/lib/thing.ts:42:10)",
    ].join("\n");
    expect(parseTopFrame(stack)).toEqual({
      file: "/app/src/lib/thing.ts",
      line: 42,
      functionName: "foo",
    });
  });

  it("handles Windows drive-letter paths and backslash separators", () => {
    const stack = ["Error: boom", "    at foo (C:\\app\\src\\lib\\thing.ts:42:10)"].join("\n");
    expect(parseTopFrame(stack)).toEqual({
      file: "C:\\app\\src\\lib\\thing.ts",
      line: 42,
      functionName: "foo",
    });
  });

  it("returns nulls when there is no in-repo frame", () => {
    expect(parseTopFrame(undefined)).toEqual({ file: null, line: null, functionName: null });
    expect(parseTopFrame("Error: x\n    at f (/app/node_modules/p/i.js:1:1)")).toEqual({
      file: null,
      line: null,
      functionName: null,
    });
  });
});

describe("captureException", () => {
  function errWithStack(name: string, message: string): Error {
    const err = new Error(message);
    err.name = name;
    // Point at a non-existent file so readCodeFrame is a no-op (null) and the
    // fingerprint is deterministic regardless of the test runner's real stack.
    err.stack = `${name}: ${message}\n    at handler (/nonexistent/src/lib/route.ts:88:12)`;
    return err;
  }

  it("issues a group upsert with an auto-reopen/increment set and matching fingerprint", async () => {
    await captureException(errWithStack("TypeError", "boom 7"), {
      channel: "system.core",
      source: "caught",
    });

    expect(mock.__groupInserts).toHaveLength(1);
    expect(mock.__groupUpserts).toHaveLength(1);

    const expectedFp = computeFingerprint(
      "TypeError",
      "/nonexistent/src/lib/route.ts",
      88,
      normalizeMessage("boom 7"),
    );
    expect(mock.__groupInserts[0]!.fingerprint).toBe(expectedFp);
    expect(mock.__groupInserts[0]!.status).toBe("open");

    const set = mock.__groupUpserts[0]!.set;
    expect(set).toHaveProperty("occurrenceCount"); // occurrence_count + 1
    expect(set).toHaveProperty("status"); // CASE WHEN resolved THEN open ...
    expect(set.lastSeenAt).toBeInstanceOf(Date);
  });

  it("records an occurrence carrying the active request context's traceId", async () => {
    await runWithRequestContext(
      { traceId: "22222222-2222-2222-2222-222222222222", mspId: 5, customerId: 9, actor: null },
      async () => {
        await captureException(errWithStack("Error", "in context"), {
          channel: "admin.exceptions",
          source: "caught",
        });
      },
    );

    expect(mock.__occurrenceInserts).toHaveLength(1);
    const occ = mock.__occurrenceInserts[0]!;
    expect(occ.correlationId).toBe("22222222-2222-2222-2222-222222222222");
    expect(occ.mspId).toBe(5);
    expect(occ.customerId).toBe(9);
    expect(occ.channel).toBe("admin.exceptions");
  });

  it("redacts a secret-like errorMessage for storage without changing the fingerprint", async () => {
    await captureException(errWithStack("Error", 'auth failed password: "abc"'), {
      channel: "c",
      source: "caught",
    });

    expect(mock.__groupInserts).toHaveLength(1);
    const stored = mock.__groupInserts[0]!.errorMessage as string;
    expect(stored).not.toContain("abc"); // secret value scrubbed
    expect(stored).toContain("[Redacted]");

    // Fingerprint is computed from the UNREDACTED normalized message, so
    // redaction cannot alter grouping.
    const expectedFp = computeFingerprint(
      "Error",
      "/nonexistent/src/lib/route.ts",
      88,
      normalizeMessage('auth failed password: "abc"'),
    );
    expect(mock.__groupInserts[0]!.fingerprint).toBe(expectedFp);
  });

  it("does NOT collide two errors that differ only inside a secret segment", async () => {
    // Both redact to the same stored string, but fingerprinting sees the
    // unredacted normalized message — so they stay in SEPARATE groups (no
    // unintended collision; the only quirk is identical-looking stored text).
    await captureException(errWithStack("Error", 'password: "alpha"'), { channel: "c", source: "caught" });
    await captureException(errWithStack("Error", 'password: "bravo"'), { channel: "c", source: "caught" });

    expect(mock.__groupInserts).toHaveLength(2);
    expect(mock.__groupInserts[0]!.fingerprint).not.toBe(mock.__groupInserts[1]!.fingerprint);
    expect(mock.__groupInserts[0]!.errorMessage).toBe(mock.__groupInserts[1]!.errorMessage);
  });

  it("groups two instances of the same error under one fingerprint", async () => {
    await captureException(errWithStack("Error", "user 1 gone"), { channel: "c", source: "caught" });
    await captureException(errWithStack("Error", "user 2 gone"), { channel: "c", source: "caught" });

    expect(mock.__groupInserts).toHaveLength(2);
    // Both normalize to "user <n> gone" at the same frame → identical fingerprint,
    // so the DB upsert collapses them into one group (proven at the app level here).
    expect(mock.__groupInserts[0]!.fingerprint).toBe(mock.__groupInserts[1]!.fingerprint);
  });
});
