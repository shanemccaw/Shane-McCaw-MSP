/**
 * retainer-ledger-lock.ts — the ONE period-close lock every writer into
 * `retainer_work_log` shares (Git #4020 / #4026).
 *
 * `routes/msp-retainer.ts` (the MSP Console operator surface) originated this
 * lock: a per-customer advisory transaction lock plus a `retainer_period_closes`
 * check before every ledger write, answering 409 while a period is closed.
 * Shane's decision on #4026 (2026-09-14): AdminV2 (`routes/admin-retainer.ts`)
 * honors that same lock — no silent override, no admin bypass flag. Pulling the
 * lock/lock-check plumbing out here, instead of keeping a second copy in
 * admin-retainer.ts, is what makes "the same check" actually true rather than
 * two checks that can drift apart.
 */

import { db, retainerPeriodClosesTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import type { Response } from "express";
import type pino from "pino";

/** First key of the two-int advisory lock; the second is the customer id. */
const LEDGER_LOCK_NAMESPACE = 4020;

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type CloseRow = typeof retainerPeriodClosesTable.$inferSelect;

/** Thrown inside a ledger transaction to answer with a specific status. */
export class LedgerConflict extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Serialise every ledger write for one customer for the life of the transaction. */
export async function withLedgerLock<T>(customerId: number, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LEDGER_LOCK_NAMESPACE}, ${customerId})`);
    return fn(tx);
  });
}

export async function findClose(tx: Tx, customerId: number, periodKey: string): Promise<CloseRow | null> {
  const [row] = await tx
    .select()
    .from(retainerPeriodClosesTable)
    .where(and(eq(retainerPeriodClosesTable.customerId, customerId), eq(retainerPeriodClosesTable.periodKey, periodKey)))
    .limit(1);
  return row ?? null;
}

/** Throws LedgerConflict(409) when `periodKey` is closed for `customerId`. */
export async function assertPeriodOpen(tx: Tx, customerId: number, periodKey: string): Promise<void> {
  if (await findClose(tx, customerId, periodKey)) {
    throw new LedgerConflict(409, `Period ${periodKey} is closed. Reopen it before changing its hours.`);
  }
}

/** Uniform LedgerConflict → HTTP status mapping for every route that uses this lock. */
export function sendLedgerError(
  res: Response,
  err: unknown,
  log: pino.Logger,
  logMessage: string,
  publicMessage: string,
): void {
  if (err instanceof LedgerConflict) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  log.error({ err }, logMessage);
  res.status(500).json({ error: publicMessage });
}
