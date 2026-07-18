import fs from "fs";
import { createHash } from "crypto";
import { db, exceptionGroupsTable, exceptionOccurrencesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getRequestContext } from "./request-context.ts";

interface CaptureOptions {
  channel: string;
  source: "caught" | "uncaught";
}

// Code frames read the original source line into the group row. The server
// runs as a bundled dist/index.mjs, so this only ever resolves in dev (where
// src/ is present and --enable-source-maps maps frames back to .ts paths). In
// production the group is still fully created from name/file/line/stack alone.
const CODE_FRAMES_ENABLED = process.env.NODE_ENV !== "production";

// Best-effort scrub of an obvious hardcoded secret before a value lands in a
// table with no retention limit. Not a security boundary — just a guard
// against the common `secret: "..."` pattern leaking into stored data. Used
// for two storage-time concerns: dev-only code frames AND the stored
// errorMessage (renamed from redactCodeFrame now that it serves both).
const SECRET_LIKE_RE =
  /(secret|password|token|apikey|api_key)\s*[:=]\s*["'`][^"'`]+["'`]/gi;

function redactSecrets(text: string): string {
  return text.replace(SECRET_LIKE_RE, (m) => m.split(/[:=]/)[0] + ": [Redacted]");
}

// Strip dynamic tokens (numbers, UUIDs) from an error message so recurring
// instances of "the same bug" with different runtime values group together
// under one fingerprint instead of creating a new group per occurrence.
export function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\b\d+\b/g, "<n>");
}

export function parseTopFrame(
  stack: string | undefined,
): { file: string | null; line: number | null; functionName: string | null } {
  if (!stack) return { file: null, line: null, functionName: null };
  const lines = stack.split("\n").slice(1);
  // Skip node_modules / internal frames — find the first frame inside this
  // repo's src. Match both POSIX (/src/) and Windows (\src\) separators, since
  // source-map-rewritten frames can carry either depending on the platform.
  const appFrame = lines.find((l) => /[\\/]src[\\/]/.test(l) && !l.includes("node_modules"));
  if (!appFrame) return { file: null, line: null, functionName: null };
  const match = appFrame.match(/at (?:(.+?)\s+)?\(?(.+?):(\d+):(\d+)\)?$/);
  if (!match) return { file: null, line: null, functionName: null };
  return {
    functionName: match[1] ?? null,
    file: match[2] ?? null,
    line: match[3] ? parseInt(match[3], 10) : null,
  };
}

function readCodeFrame(file: string | null, line: number | null): string | null {
  if (!CODE_FRAMES_ENABLED || !file || !line) return null;
  try {
    const lines = fs.readFileSync(file, "utf-8").split("\n");
    const start = Math.max(0, line - 3);
    const end = Math.min(lines.length, line + 2);
    const raw = lines
      .slice(start, end)
      .map((l, i) => `${start + i + 1}${start + i + 1 === line ? " >" : "  "} ${l}`)
      .join("\n");
    return redactSecrets(raw);
  } catch {
    return null; // File not readable at runtime — non-fatal, group still created without a code frame.
  }
}

export function computeFingerprint(
  errorName: string,
  file: string | null,
  line: number | null,
  normalizedMessage: string,
): string {
  const raw = `${errorName}|${file ?? "unknown"}|${line ?? 0}|${normalizedMessage}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export async function captureException(err: Error, opts: CaptureOptions): Promise<void> {
  try {
    const { file, line, functionName } = parseTopFrame(err.stack);
    const normalizedMessage = normalizeMessage(err.message ?? "");
    // Redaction is a storage-time concern only. Fingerprinting uses the
    // unredacted normalizedMessage so grouping is unaffected — redaction can
    // never merge two genuinely different errors into one group.
    const storedErrorMessage = redactSecrets(err.message ?? "");
    const fingerprint = computeFingerprint(err.name ?? "Error", file, line, normalizedMessage);
    const codeFrame = readCodeFrame(file, line);
    const ctx = getRequestContext();
    const now = new Date();

    await db
      .insert(exceptionGroupsTable)
      .values({
        fingerprint,
        errorName: err.name ?? "Error",
        errorMessage: storedErrorMessage,
        file,
        line,
        functionName,
        codeFrame,
        stackSample: err.stack ?? null,
        channel: opts.channel,
        source: opts.source,
        status: "open",
        occurrenceCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: exceptionGroupsTable.fingerprint,
        set: {
          occurrenceCount: sql`${exceptionGroupsTable.occurrenceCount} + 1`,
          lastSeenAt: now,
          // Auto-reopen: a "resolved" group that fires again is a regression.
          // A "suppressed" group stays suppressed regardless — that's the
          // whole point of suppression.
          status: sql`CASE WHEN ${exceptionGroupsTable.status} = 'resolved' THEN 'open' ELSE ${exceptionGroupsTable.status} END`,
        },
      });

    await db.insert(exceptionOccurrencesTable).values({
      fingerprint,
      correlationId: ctx?.traceId ?? null,
      channel: opts.channel,
      mspId: ctx?.mspId ?? null,
      customerId: ctx?.customerId ?? null,
      occurredAt: now,
    });
  } catch (captureErr) {
    // Never let exception tracking itself crash the app or recurse into logger.
    console.error("exception-tracker: capture failed", captureErr);
  }
}
