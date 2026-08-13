/**
 * telemetry-retention-nodes.ts
 *
 * Dedicated handler for the `platform_log_stream_prune` workflow node type.
 * Called directly from the executor case block — no opaque dispatcher.
 * Scope: platform_log_stream ONLY. exception_groups/exception_occurrences
 * and msp_event_store are explicitly out of scope — see the node's own
 * description and Phase 4's implementation prompt for why.
 */

import { db, platformLogStreamTable } from "@workspace/db";
import { lt } from "drizzle-orm";
import { logger } from "./logger";
const log = logger.child({ channel: "system.core" });

export async function handlePlatformLogStreamPrune(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const retentionDays = Number(payload.retentionDays ?? 7);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const result = await db
    .delete(platformLogStreamTable)
    .where(lt(platformLogStreamTable.occurredAt, cutoff));

  const rowsDeleted = result.rowCount ?? 0;
  log.info({ retentionDays, cutoff: cutoff.toISOString(), rowsDeleted }, "platform_log_stream_prune: completed");

  return { retentionDays, cutoffIso: cutoff.toISOString(), rowsDeleted };
}
