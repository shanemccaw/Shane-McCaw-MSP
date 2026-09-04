import { db, mspRiskDecisionsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

/**
 * #2529 — `msp_risk_decisions.registerRef` ("the register entry number an
 * acceptance was recorded under, e.g. RR-2026-014") had no writer anywhere:
 * every insert into `msp_risk_decisions` left it NULL, so the Risk Register
 * page's "register" cell was silently blank for every risk in the system.
 *
 * Format mirrors the doc comment's own example and the same per-row-code
 * convention already used everywhere else on this row (`rbdId` /
 * `formatChangeRequestCode`) — a fixed year prefix plus the row's own
 * sequential id, zero-padded to at least 3 digits.
 */
export function formatRegisterRef(id: number): string {
  return `RR-2026-${String(id).padStart(3, "0")}`;
}

/**
 * Assigns `registerRef` to a `msp_risk_decisions` row right after insert —
 * the id isn't known until the insert returns, so this can't be set inline
 * in `.values(...)`. Guarded on `registerRef IS NULL` so it's safe to call
 * unconditionally after every insert/upsert path, including the
 * `onConflictDoUpdate`/`onConflictDoNothing` paths that return an
 * already-existing row: a row that already carries a register ref is left
 * alone, never overwritten.
 */
export async function assignRegisterRef(id: number): Promise<string> {
  const registerRef = formatRegisterRef(id);
  await db
    .update(mspRiskDecisionsTable)
    .set({ registerRef })
    .where(and(eq(mspRiskDecisionsTable.id, id), isNull(mspRiskDecisionsTable.registerRef)));
  return registerRef;
}
