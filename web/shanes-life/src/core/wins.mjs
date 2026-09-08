// Shane's Life -- the real Wins log (Git #3151, design contract Section 3).
//
// Deliberately distinct from the "no gamification" rule (Section 3/8): no streaks, no badges,
// no completion percentage. Just real, hard-won milestones, in two ways:
//
//   1. Manual: "I did it, ..." -- either typed straight into the Wins tab's own quick capture
//      (source: 'shane'), or a Claude conversation calling the design's own `log_win` MCP tool
//      after classifying a universal-capture-box entry that says the same thing (source: 'claude').
//   2. Automatic, once Money unified (#3137): a real debt balance hitting $0, a critical debt
//      getting resolved, a deferred (unfunded) bill finally getting caught up -- see
//      detectMoneyWins() below (source: 'debt_paid_off').
//
// The `wins` table itself is migration 017. detectMoneyWins()'s own memory of "was this already
// resolved last time" is migration 033 (money_watch_state) -- see that file's own header for why
// a state transition, not a live read, is the only honest way to answer "did this just happen".

import { many, one, transaction } from "../db.mjs";
import { badRequest } from "../http.mjs";
import { loadMoneyAccounts, computeGateMath } from "./money.mjs";

/** Every real win, most recent first -- the Wins tab's own dated-rows list. */
export async function listWins(userId, { limit = 200 } = {}) {
  return many(
    `SELECT id, happened_on, text, source, created_at
       FROM wins
      WHERE user_id = $1
      ORDER BY happened_on DESC, created_at DESC
      LIMIT $2`,
    [userId, Math.min(Number(limit) || 200, 500)],
  );
}

/**
 * Record one real win. `happenedOn` defaults to today (the column's own default) -- a caller
 * only passes it to backdate something Shane says happened earlier ("I did it last Tuesday").
 */
export async function createWin(userId, { text, happenedOn = null, source = "shane" } = {}) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) throw badRequest("text is required");
  if (trimmed.length > 2000) throw badRequest("text is too long (2000 char limit)");
  if (!["shane", "claude", "debt_paid_off"].includes(source)) {
    throw badRequest("source must be one of: shane, claude, debt_paid_off");
  }

  return one(
    `INSERT INTO wins (user_id, happened_on, text, source)
     VALUES ($1, COALESCE($2, current_date), $3, $4)
     RETURNING id, happened_on, text, source, created_at`,
    [userId, happenedOn, trimmed, source],
  );
}

// ---------------------------------------------------------------------------
// automatic triggers -- real debt/bill state transitions
// ---------------------------------------------------------------------------

async function loadWatchState(userId, kind) {
  const rows = await many(
    `SELECT ref_id, resolved FROM money_watch_state WHERE user_id = $1 AND kind = $2`,
    [userId, kind],
  );
  return new Map(rows.map((r) => [r.ref_id, r.resolved]));
}

async function upsertWatchState(client, userId, kind, refId, resolved) {
  await client.query(
    `INSERT INTO money_watch_state (user_id, kind, ref_id, resolved, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, kind, ref_id) DO UPDATE
        SET resolved = EXCLUDED.resolved, updated_at = now()`,
    [userId, kind, refId, resolved],
  );
}

/**
 * Real trigger 1 & 2: a debt's real balance hits $0 (creates a win), or a debt that is
 * `is_critical` does the same (a differently-worded win, per the design calling this out as its
 * own trigger point rather than just folding it into the general case).
 *
 * Real trigger 3: a real bill account (role='bill') that was unfunded (shortfall > 0) becomes
 * funded (shortfall === 0) -- "a deferred bill finally caught up". Uses the same
 * computeGateMath() the Money tabs already read, so "funded" here can never disagree with what
 * Bills already shows.
 *
 * Never fires retroactively: a ref_id seen for the first time is seeded at its CURRENT resolved
 * state with no win created, so pre-existing payoffs from before this feature shipped are not
 * claimed as "just happened". Only a real false -> true transition, on a later call, fires one.
 */
export async function detectMoneyWins(userId) {
  const [debts, accounts] = await Promise.all([
    many(
      `SELECT id, creditor_name, balance, is_critical FROM debts ORDER BY creditor_name`,
    ),
    loadMoneyAccounts(),
  ]);
  const math = computeGateMath(accounts);

  const [debtState, billState] = await Promise.all([
    loadWatchState(userId, "debt"),
    loadWatchState(userId, "bill"),
  ]);

  const created = [];

  return transaction(async (client) => {
    for (const debt of debts) {
      const balance = Number(debt.balance);
      const resolvedNow = Number.isFinite(balance) && balance <= 0;
      const wasResolved = debtState.get(debt.id);
      if (wasResolved === undefined) {
        // First sight of this debt -- seed silently, no win.
        await upsertWatchState(client, userId, "debt", debt.id, resolvedNow);
        continue;
      }
      if (resolvedNow && !wasResolved) {
        const text = debt.is_critical
          ? `Critical debt resolved: ${debt.creditor_name} paid off.`
          : `${debt.creditor_name} paid off.`;
        const { rows } = await client.query(
          `INSERT INTO wins (user_id, text, source) VALUES ($1, $2, 'debt_paid_off')
           RETURNING id, happened_on, text, source, created_at`,
          [userId, text],
        );
        created.push(rows[0]);
      }
      if (resolvedNow !== wasResolved) {
        await upsertWatchState(client, userId, "debt", debt.id, resolvedNow);
      }
    }

    for (const bill of math.bills) {
      // A bill with no target or no Plaid balance yet has `funded: null` -- unknown is not a
      // transition, same convention the rest of money.mjs applies to warnings.
      if (bill.funded === null) continue;
      const wasFunded = billState.get(bill.id);
      if (wasFunded === undefined) {
        await upsertWatchState(client, userId, "bill", bill.id, bill.funded);
        continue;
      }
      if (bill.funded && !wasFunded) {
        const { rows } = await client.query(
          `INSERT INTO wins (user_id, text, source) VALUES ($1, $2, 'debt_paid_off')
           RETURNING id, happened_on, text, source, created_at`,
          [userId, `${bill.name} caught up.`],
        );
        created.push(rows[0]);
      }
      if (bill.funded !== wasFunded) {
        await upsertWatchState(client, userId, "bill", bill.id, bill.funded);
      }
    }

    return created;
  });
}
