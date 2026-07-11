/**
 * MSP Background Job Framework
 *
 * A simple, DB-backed background job queue that other subsystems extend.
 * Workers use PostgreSQL's SELECT … FOR UPDATE SKIP LOCKED for safe concurrent
 * polling — no two workers will pick up the same job.
 *
 * Usage (producer):
 *   await enqueueJob("provision_tenant", { customerId: 42 }, { mspId: 7 });
 *
 * Usage (consumer — register a handler before starting the worker loop):
 *   registerJobHandler("provision_tenant", async (job) => {
 *     // do work — return result or throw to trigger retry
 *     return { provisioned: true };
 *   });
 *   startJobWorker();
 *
 * The worker loop runs inside the same process. For heavier workloads,
 * call startJobWorker() from multiple processes or pods — each instance
 * safely claims its own jobs via SKIP LOCKED.
 */

import { randomUUID } from "crypto";
import { db, mspJobQueueTable, mspDlqStoreTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "./logger";

// ── Handler registry ──────────────────────────────────────────────────────────

export type JobHandler = (job: {
  jobId: string;
  jobType: string;
  payload: Record<string, unknown>;
  mspId: number | null;
  customerId: number | null;
  attemptCount: number;
  correlationId: string | null;
}) => Promise<Record<string, unknown>>;

const handlers = new Map<string, JobHandler>();

/**
 * Register a handler for a specific job type.
 * Call this before starting the worker loop.
 */
export function registerJobHandler(jobType: string, handler: JobHandler): void {
  handlers.set(jobType, handler);
}

// ── Producer ──────────────────────────────────────────────────────────────────

export interface EnqueueJobOptions {
  mspId?: number;
  customerId?: number;
  maxAttempts?: number;
  scheduledAt?: Date;
  correlationId?: string;
}

/**
 * Enqueue a background job. Returns the jobId of the newly created job.
 */
export async function enqueueJob(
  jobType: string,
  payload: Record<string, unknown>,
  opts: EnqueueJobOptions = {},
): Promise<string> {
  const jobId = randomUUID();
  await db.insert(mspJobQueueTable).values({
    jobId,
    jobType,
    status: "pending",
    mspId: opts.mspId,
    customerId: opts.customerId,
    payload,
    maxAttempts: opts.maxAttempts ?? 3,
    scheduledAt: opts.scheduledAt ?? new Date(),
    correlationId: opts.correlationId ? opts.correlationId as unknown as string : undefined,
  });
  logger.info({ jobId, jobType, mspId: opts.mspId }, "msp-jobs: enqueued");
  return jobId;
}

// ── Worker ────────────────────────────────────────────────────────────────────

let workerInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Claim and execute up to `batchSize` pending jobs that are due.
 * Uses SELECT … FOR UPDATE SKIP LOCKED so concurrent callers don't collide.
 * Called automatically by startJobWorker() on a polling interval.
 */
export async function processJobs(batchSize = 5): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const now = new Date();

      // Claim pending jobs that are due — SKIP LOCKED is essential for concurrency
      const jobs = await tx.execute<{
        id: number;
        job_id: string;
        job_type: string;
        payload: Record<string, unknown>;
        msp_id: number | null;
        customer_id: number | null;
        attempt_count: number;
        max_attempts: number;
        correlation_id: string | null;
      }>(sql`
        SELECT id, job_id, job_type, payload, msp_id, customer_id,
               attempt_count, max_attempts, correlation_id
        FROM msp_job_queue
        WHERE status = 'pending'
          AND scheduled_at <= ${now.toISOString()}
        ORDER BY scheduled_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `);

      if (!jobs.rows.length) return;

      for (const row of jobs.rows) {
        // Mark as running
        await tx.execute(sql`
          UPDATE msp_job_queue
          SET status = 'running', started_at = NOW(),
              attempt_count = attempt_count + 1
          WHERE id = ${row.id}
        `);

        const handler = handlers.get(row.job_type);
        if (!handler) {
          // No handler registered — park in DLQ immediately
          await tx.execute(sql`
            UPDATE msp_job_queue
            SET status = 'failed', completed_at = NOW(),
                error_message = 'No handler registered for job type'
            WHERE id = ${row.id}
          `);
          await tx.insert(mspDlqStoreTable).values({
            sourceEventId: row.job_id as unknown as string,
            eventType: row.job_type,
            payload: row.payload as Record<string, unknown>,
            errorMessage: `No handler registered for job type: ${row.job_type}`,
            attemptCount: row.attempt_count + 1,
            mspId: row.msp_id ?? undefined,
            customerId: row.customer_id ?? undefined,
          });
          logger.warn({ jobId: row.job_id, jobType: row.job_type }, "msp-jobs: no handler — parked in DLQ");
          continue;
        }

        try {
          const result = await handler({
            jobId: row.job_id,
            jobType: row.job_type,
            payload: row.payload as Record<string, unknown>,
            mspId: row.msp_id,
            customerId: row.customer_id,
            attemptCount: row.attempt_count + 1,
            correlationId: row.correlation_id,
          });

          await tx.execute(sql`
            UPDATE msp_job_queue
            SET status = 'completed', completed_at = NOW(), result = ${JSON.stringify(result)}::jsonb
            WHERE id = ${row.id}
          `);
          logger.info({ jobId: row.job_id, jobType: row.job_type }, "msp-jobs: completed");
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          const errorStack = err instanceof Error ? err.stack : undefined;
          const newAttemptCount = row.attempt_count + 1;

          if (newAttemptCount >= row.max_attempts) {
            // Exhausted retries — mark failed and send to DLQ
            await tx.execute(sql`
              UPDATE msp_job_queue
              SET status = 'failed', completed_at = NOW(),
                  error_message = ${errorMessage}, error_stack = ${errorStack ?? null}
              WHERE id = ${row.id}
            `);
            await tx.insert(mspDlqStoreTable).values({
              sourceEventId: row.job_id as unknown as string,
              eventType: row.job_type,
              payload: row.payload as Record<string, unknown>,
              errorMessage,
              errorStack,
              attemptCount: newAttemptCount,
              mspId: row.msp_id ?? undefined,
              customerId: row.customer_id ?? undefined,
            });
            logger.error({ jobId: row.job_id, jobType: row.job_type, errorMessage }, "msp-jobs: exhausted retries — parked in DLQ");
          } else {
            // Schedule retry with exponential back-off (2^attempt * 30s)
            const backoffSec = Math.pow(2, newAttemptCount) * 30;
            const retryAt = new Date(Date.now() + backoffSec * 1000);
            await tx.execute(sql`
              UPDATE msp_job_queue
              SET status = 'pending', started_at = NULL,
                  error_message = ${errorMessage}, error_stack = ${errorStack ?? null},
                  scheduled_at = ${retryAt.toISOString()}
              WHERE id = ${row.id}
            `);
            logger.warn({ jobId: row.job_id, jobType: row.job_type, backoffSec }, "msp-jobs: failed — scheduling retry");
          }
        }
      }
    });
  } catch (err) {
    logger.error({ err }, "msp-jobs: processJobs transaction failed");
  }
}

/**
 * Start the background worker polling loop.
 * Call once at server startup. Safe to call multiple times — subsequent calls
 * are no-ops when the worker is already running.
 *
 * @param pollIntervalMs  How often to poll for new jobs (default 5 seconds)
 * @param batchSize       Jobs to claim per tick (default 5)
 */
export function startJobWorker(pollIntervalMs = 5_000, batchSize = 5): void {
  if (workerInterval !== null) return;
  logger.info({ pollIntervalMs, batchSize }, "msp-jobs: worker started");
  workerInterval = setInterval(() => { void processJobs(batchSize); }, pollIntervalMs);
  // Don't let the interval block process exit
  if (workerInterval.unref) workerInterval.unref();
}

/**
 * Stop the background worker (useful for clean shutdown / tests).
 */
export function stopJobWorker(): void {
  if (workerInterval !== null) {
    clearInterval(workerInterval);
    workerInterval = null;
    logger.info({}, "msp-jobs: worker stopped");
  }
}

// ── Admin helpers ─────────────────────────────────────────────────────────────

/**
 * Cancel a pending job by jobId. No-op if already running/completed/failed.
 */
export async function cancelJob(jobId: string): Promise<boolean> {
  const result = await db
    .update(mspJobQueueTable)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(and(eq(mspJobQueueTable.jobId, jobId), eq(mspJobQueueTable.status, "pending")));
  return (result as unknown as { rowCount?: number })?.rowCount === 1;
}

/**
 * Re-queue a failed job for retry by resetting it to pending.
 */
export async function requeueJob(jobId: string): Promise<boolean> {
  const result = await db
    .update(mspJobQueueTable)
    .set({
      status: "pending",
      scheduledAt: new Date(),
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      errorStack: null,
    })
    .where(and(eq(mspJobQueueTable.jobId, jobId), eq(mspJobQueueTable.status, "failed")));
  return (result as unknown as { rowCount?: number })?.rowCount === 1;
}
