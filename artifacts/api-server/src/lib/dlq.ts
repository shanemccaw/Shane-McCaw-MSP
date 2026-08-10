/**
 * Dead Letter Queue (DLQ) Store
 *
 * Failed events/messages are parked here for inspection and replay.
 * Operations: enqueue, list, resolve (replay | discard | manual).
 */

import { db, mspDlqStoreTable } from "@workspace/db";
import { eq, isNull, desc, and, sql } from "drizzle-orm";
import { logger } from "./logger";
import { captureException } from "./exception-tracker.ts";
const log = logger.child({ channel: "system.dlq" });

export interface DlqEnqueueOptions {
  eventType: string;
  payload: Record<string, unknown>;
  errorMessage: string;
  errorStack?: string;
  sourceEventId?: string;
  mspId?: number;
  customerId?: number;
}

export type DlqResolution = "replayed" | "discarded" | "manual";

export interface DlqResolveOptions {
  resolution: DlqResolution;
}

/**
 * Feeds a DLQ item into the same exception-tracker + GitHub-auto-file
 * pipeline every other captured error goes through (fingerprinted/grouped
 * by exception-tracker.ts, filed under Epic #530 by exception-github-sync.ts
 * in production). Exported so the raw-insert call sites that can't route
 * through enqueueDlq() (msp-jobs.ts's two sites run inside an existing `tx`,
 * and enqueueDlq() always writes via the plain `db` handle) can still get
 * the same treatment without duplicating this. Fire-and-forget — never
 * await this from a DLQ write path, it must never add latency there.
 */
export function captureDlqFailure(eventType: string, errorMessage: string, errorStack?: string | null): void {
  const err = new Error(errorMessage);
  if (errorStack) err.stack = errorStack;
  void captureException(err, { channel: "system.dlq", source: "dlq" });
}

/**
 * Enqueue a failed item into the DLQ.
 * Never throws — DLQ failures are logged and swallowed.
 */
export async function enqueueDlq(opts: DlqEnqueueOptions): Promise<string | null> {
  try {
    const [row] = await db
      .insert(mspDlqStoreTable)
      .values({
        eventType: opts.eventType,
        payload: opts.payload,
        errorMessage: opts.errorMessage,
        errorStack: opts.errorStack ?? null,
        sourceEventId: opts.sourceEventId ?? null,
        mspId: opts.mspId ?? null,
        customerId: opts.customerId ?? null,
      })
      .returning({ dlqId: mspDlqStoreTable.dlqId });

    log.warn(
      { dlqId: row?.dlqId, eventType: opts.eventType },
      "dlq: item enqueued",
    );
    captureDlqFailure(opts.eventType, opts.errorMessage, opts.errorStack);

    return row?.dlqId ?? null;
  } catch (err) {
    log.error({ err, eventType: opts.eventType }, "dlq: enqueue failed (non-fatal)");
    return null;
  }
}

/**
 * List unresolved DLQ items, newest first.
 * When mspId is provided, only that MSP's items are returned (tenant fence).
 * PlatformAdmins may omit mspId to see all items.
 */
export async function listDlqItems(mspId?: number) {
  const condition = mspId !== undefined
    ? and(isNull(mspDlqStoreTable.resolvedAt), eq(mspDlqStoreTable.mspId, mspId))
    : isNull(mspDlqStoreTable.resolvedAt);

  return db
    .select()
    .from(mspDlqStoreTable)
    .where(condition)
    .orderBy(desc(mspDlqStoreTable.createdAt));
}

/**
 * Mark a DLQ item as resolved.
 * Returns true when the row was found and updated; false when not found.
 */
export async function resolveDlqItem(
  dlqId: string,
  opts: DlqResolveOptions,
): Promise<boolean> {
  const [updated] = await db
    .update(mspDlqStoreTable)
    .set({
      resolvedAt: new Date(),
      resolution: opts.resolution,
    })
    .where(eq(mspDlqStoreTable.dlqId, dlqId))
    .returning({ dlqId: mspDlqStoreTable.dlqId });

  return !!updated;
}

/**
 * Increment attempt count and update lastAttemptAt for a retry.
 * Uses an atomic SQL increment to avoid read-modify-write races.
 */
export async function incrementDlqAttempt(dlqId: string): Promise<void> {
  await db
    .update(mspDlqStoreTable)
    .set({
      lastAttemptAt: new Date(),
      attemptCount: sql`${mspDlqStoreTable.attemptCount} + 1`,
    })
    .where(eq(mspDlqStoreTable.dlqId, dlqId));
}
