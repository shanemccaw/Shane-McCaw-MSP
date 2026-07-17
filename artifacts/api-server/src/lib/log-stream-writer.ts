/**
 * Log Stream Writer (Phase 1a)
 *
 * Batched, fire-and-forget mirror of pino log output into the
 * `platform_log_stream` table. Wired in from lib/logger.ts's `logMethod` hook —
 * with 1,500+ log call sites, inserting on every call would add a DB round-trip
 * to hot paths, so entries are queued in memory and flushed on a timer (or when
 * the queue fills).
 *
 * Failures here must NEVER affect the app: flush errors are written straight to
 * stderr via `console.error`, NOT through `logger` (which would recurse back
 * into this same hook).
 */

import { db, platformLogStreamTable } from "@workspace/db";

interface QueuedLogEntry {
  channel: string;
  level: string;
  message: string;
  meta: Record<string, unknown> | null;
  correlationId: string | null;
  mspId: number | null;
  customerId: number | null;
  occurredAt: Date;
}

const queue: QueuedLogEntry[] = [];
const MAX_QUEUE_SIZE = 500;
const FLUSH_INTERVAL_MS = 1000;

export function enqueueLogEntry(entry: QueuedLogEntry): void {
  queue.push(entry);
  if (queue.length >= MAX_QUEUE_SIZE) {
    void flush();
  }
}

async function flush(): Promise<void> {
  if (queue.length === 0) return;
  // Drain the whole queue into one batched INSERT (N rows, one round-trip).
  const batch = queue.splice(0, queue.length);
  try {
    await db.insert(platformLogStreamTable).values(batch);
  } catch (err) {
    // Never let log-stream failures affect the app — log to stderr directly,
    // NOT through the logger (would recurse back into this same hook).
    console.error("log-stream-writer: flush failed", err);
  }
}

setInterval(() => {
  void flush();
}, FLUSH_INTERVAL_MS).unref();

// Flush on shutdown so the last <1s of logs aren't lost.
process.on("beforeExit", () => {
  void flush();
});
