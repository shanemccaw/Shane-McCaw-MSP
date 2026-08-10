// engagebay_batch_drain node handler (EngageBay Webhooks + Workflow Nodes, #105).
//
// Drains a bounded batch of pending `engagebay_*` jobs from the existing
// msp_job_queue, dispatching each to a registered EngageBay job handler. Runs
// as a first-class workflow node inside the seeded "EngageBay Queue Drain"
// 5-minute schedule workflow — NOT via the msp-jobs.ts setInterval worker —
// so every batch is a visible, logged run in Simulator Studio. Mirrors
// zoho-batch-drain.ts.
//
// The per-jobType handlers themselves (engagebay_create_contact, …) are this
// same phase's node layer and register here via registerEngageBayJobHandler();
// this file ships the drain mechanism only. Retry/backoff/DLQ semantics
// deliberately mirror msp-jobs.ts so an engagebay_* job behaves like every
// other queued job once it fails.

import { db, mspJobQueueTable, mspDlqStoreTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { captureDlqFailure } from "./dlq.ts";
import { captureException } from "./exception-tracker.ts";

const log = logger.child({ channel: "integration.engagebay" });

export type EngageBayJobHandler = (job: {
  jobId: string;
  jobType: string;
  payload: Record<string, unknown>;
  mspId: number | null;
  customerId: number | null;
  attemptCount: number;
}) => Promise<Record<string, unknown>>;

const engagebayJobHandlers = new Map<string, EngageBayJobHandler>();

/** The node layer registers one handler per engagebay_* jobType here. */
export function registerEngageBayJobHandler(jobType: string, handler: EngageBayJobHandler): void {
  engagebayJobHandlers.set(jobType, handler);
}

export function getRegisteredEngageBayJobTypes(): string[] {
  return [...engagebayJobHandlers.keys()];
}

/**
 * Runs `worker` over `items` with at most `limit` in flight at once. Results
 * keep item order; a rejection is captured per-item, never thrown. Pure —
 * exported for unit tests.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(items.length);
  const cap = Math.max(1, Math.floor(limit));
  let next = 0;

  async function lane(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, () => lane()));
  return results;
}

interface ClaimedEngageBayJob {
  [key: string]: unknown;
  id: number;
  job_id: string;
  job_type: string;
  payload: Record<string, unknown>;
  msp_id: number | null;
  customer_id: number | null;
  attempt_count: number;
  max_attempts: number;
}

// A job stuck in 'running' longer than this is presumed orphaned by a crashed
// run and is returned to 'pending' (its attempt was already counted).
const STALE_RUNNING_MINUTES = 15;

/**
 * Which msp_job_queue rows belong to this drain. EngageBay job types have
 * been snake_case (`engagebay_create_contact`) from the start — unlike Zoho's
 * Foundation, there is no legacy dot-notation prefix to also match.
 */
const ENGAGEBAY_JOB_TYPE_PREDICATE = "left(job_type, 10) = 'engagebay_'";

/**
 * The engagebay_batch_drain node handler. Claims up to `batchSize` (default
 * 20) due pending engagebay_* jobs with FOR UPDATE SKIP LOCKED, marks them
 * running, then executes them with at most `concurrency` (default 5)
 * simultaneous EngageBay calls — conservative, since EngageBay publishes no
 * per-org concurrency limit (unlike Zoho's documented 5–25). Returns counts;
 * never throws.
 */
export async function handleEngageBayBatchDrain(
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const batchSize = Math.max(1, Math.min(Number(data.batchSize ?? 20) || 20, 100));
  const concurrency = Math.max(1, Math.min(Number(data.concurrency ?? 5) || 5, 25));

  try {
    // Self-heal: return orphaned running jobs (crashed prior drain) to pending.
    const requeued = await db.execute(sql`
      UPDATE msp_job_queue
      SET status = 'pending', started_at = NULL
      WHERE status = 'running'
        AND ${sql.raw(ENGAGEBAY_JOB_TYPE_PREDICATE)}
        AND started_at < NOW() - INTERVAL '${sql.raw(String(STALE_RUNNING_MINUTES))} minutes'
      RETURNING id
    `);
    if (requeued.rows.length > 0) {
      log.warn({ count: requeued.rows.length }, "engagebay-drain: requeued stale running jobs");
    }

    // Claim + mark running in one short transaction so row locks release
    // before any EngageBay API call is made.
    const claimed = await db.transaction(async (tx) => {
      const jobs = await tx.execute<ClaimedEngageBayJob>(sql`
        SELECT id, job_id, job_type, payload, msp_id, customer_id,
               attempt_count, max_attempts
        FROM msp_job_queue
        WHERE status = 'pending'
          AND ${sql.raw(ENGAGEBAY_JOB_TYPE_PREDICATE)}
          AND scheduled_at <= NOW()
        ORDER BY scheduled_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `);
      if (jobs.rows.length > 0) {
        const ids = jobs.rows.map((r) => r.id);
        await tx.execute(sql`
          UPDATE msp_job_queue
          SET status = 'running', started_at = NOW(), attempt_count = attempt_count + 1
          WHERE id IN ${ids}
        `);
      }
      return jobs.rows;
    });

    if (claimed.length === 0) {
      return { claimed: 0, succeeded: 0, failed: 0, retried: 0, batchSize, concurrency };
    }

    let succeeded = 0;
    let failed = 0;
    let retried = 0;

    await runWithConcurrency(claimed, concurrency, async (row) => {
      const attemptCount = row.attempt_count + 1;
      const handler = engagebayJobHandlers.get(row.job_type);

      if (!handler) {
        // No handler registered — park in DLQ, same as msp-jobs.ts does for
        // unknown job types.
        await db.execute(sql`
          UPDATE msp_job_queue
          SET status = 'failed', completed_at = NOW(),
              error_message = 'No EngageBay job handler registered for job type'
          WHERE id = ${row.id}
        `);
        await db.insert(mspDlqStoreTable).values({
          sourceEventId: row.job_id,
          eventType: row.job_type,
          payload: row.payload,
          errorMessage: `No EngageBay job handler registered for job type: ${row.job_type}`,
          attemptCount,
          mspId: row.msp_id ?? undefined,
          customerId: row.customer_id ?? undefined,
        });
        captureDlqFailure(row.job_type, `No EngageBay job handler registered for job type: ${row.job_type}`);
        failed++;
        log.warn({ jobId: row.job_id, jobType: row.job_type }, "engagebay-drain: no handler — parked in DLQ");
        return;
      }

      try {
        const result = await handler({
          jobId: row.job_id,
          jobType: row.job_type,
          payload: row.payload,
          mspId: row.msp_id,
          customerId: row.customer_id,
          attemptCount,
        });
        await db.execute(sql`
          UPDATE msp_job_queue
          SET status = 'completed', completed_at = NOW(), result = ${JSON.stringify(result)}::jsonb
          WHERE id = ${row.id}
        `);
        succeeded++;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorStack = err instanceof Error ? err.stack : undefined;

        if (attemptCount >= row.max_attempts) {
          await db.execute(sql`
            UPDATE msp_job_queue
            SET status = 'failed', completed_at = NOW(),
                error_message = ${errorMessage}, error_stack = ${errorStack ?? null}
            WHERE id = ${row.id}
          `);
          await db.insert(mspDlqStoreTable).values({
            sourceEventId: row.job_id,
            eventType: row.job_type,
            payload: row.payload,
            errorMessage,
            errorStack,
            attemptCount,
            mspId: row.msp_id ?? undefined,
            customerId: row.customer_id ?? undefined,
          });
          void captureException(err instanceof Error ? err : new Error(errorMessage), { channel: "integration.engagebay", source: "dlq" });
          failed++;
          log.error({ jobId: row.job_id, jobType: row.job_type, errorMessage }, "engagebay-drain: exhausted retries — parked in DLQ");
        } else {
          const backoffSec = Math.pow(2, attemptCount) * 30;
          const retryAt = new Date(Date.now() + backoffSec * 1000);
          await db.execute(sql`
            UPDATE msp_job_queue
            SET status = 'pending', started_at = NULL,
                error_message = ${errorMessage}, error_stack = ${errorStack ?? null},
                scheduled_at = ${retryAt.toISOString()}
            WHERE id = ${row.id}
          `);
          retried++;
          log.warn({ jobId: row.job_id, jobType: row.job_type, backoffSec }, "engagebay-drain: failed — scheduled retry");
        }
      }
    });

    const summary = { claimed: claimed.length, succeeded, failed, retried, batchSize, concurrency };
    log.info(summary, "engagebay-drain: batch complete");
    return summary;
  } catch (err) {
    // Batch nodes return counts, never throw — the run stays green and the
    // error is visible in the node output + logs.
    log.error({ err }, "engagebay-drain: batch failed");
    return { claimed: 0, succeeded: 0, failed: 0, retried: 0, error: String(err), batchSize, concurrency };
  }
}
