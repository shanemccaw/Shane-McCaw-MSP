/**
 * Log-stream → SSE hub live bridge (Phase 3a)
 *
 * log-stream-writer's `enqueueLogEntry` batches entries for a periodic Postgres
 * insert. That batching adds up to FLUSH_INTERVAL_MS of latency, which is fine
 * for the durable mirror but too slow for the admin live-stream UI. This bridge
 * is the immediate, in-process tap: it fans each entry out to hub subscribers
 * (and, transitively, the firehose) the instant it is logged.
 *
 * Delivery is keyed by the entry's own `channel` (engine.sla, system.core, …)
 * with `mspId` as the scope, so a client on ?channel=engine.sla&mspId=42 sees
 * exactly that engine's activity for that MSP, while ?channel=* sees everything.
 */
import { broadcastToHub } from "./sse-hub.ts";

export function bridgeLogEntryToHub(entry: {
  channel: string;
  level: string;
  message: string;
  meta: Record<string, unknown> | null;
  correlationId: string | null;
  mspId: number | null;
}): void {
  broadcastToHub(entry.channel, entry.mspId, {
    type: "log",
    level: entry.level,
    message: entry.message,
    correlationId: entry.correlationId,
    meta: entry.meta,
  });
}
