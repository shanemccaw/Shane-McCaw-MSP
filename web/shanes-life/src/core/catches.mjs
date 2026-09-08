// Catches -- real expense-cutting mechanisms (Git #3153, design contract Section 4).
//
// Five real catch types, matching the Money screen's own Catches card (README.md, Money screen
// section: "Catches (Renewal watch, Forgotten money, Duplicate request, Borrowed from a bill,
// Bulk buy; 'Got it' dismisses)") and the prototype's own real sample data:
//
//   { kind: 'Renewal watch', text: 'Allstate renews Oct 1 at +$31/mo unless you call first.' }
//   { kind: 'Forgotten money', text: 'Last sweep, Aug 30, turned up $1,512. Look again around Sep 30.' }
//   { kind: 'Duplicate request', text: 'Ronnie and DJ both mentioned paper towels this week. One buy covers both.' }
//   { kind: 'Borrowed from a bill', text: '$62 left Electric on Aug 28 for something else. Electric is short by exactly that.' }
//   { kind: 'Bulk buy', text: '7-Eleven, 14 stops in 30 days. Coffee by the case is cheaper.' }
//
// Every detector here reads REAL data already in this database -- dates (014), transactions
// (ShanesSurvival 001, read through #3107's unification), list_items.requested_by (033) -- and
// writes at most one real row per real, distinct thing found. None of them call out to Plaid or
// any paid API (Section 10): this is arithmetic and pattern-matching over data already synced.
//
// "Forgotten money" is explicitly the odd one out per the design's own words: "not automated
// (can't scan accounts that aren't linked), just a recurring prompt to go look." Its detector
// does not find anything real to report -- it just re-raises a periodic prompt, honestly labelled
// as such, never a fabricated dollar figure.

import { many, one } from "../db.mjs";
import { badRequest, notFound } from "../http.mjs";
import { formatMoney, toCents } from "./money.mjs";

export const KINDS = Object.freeze([
  "renewal",
  "forgotten_money",
  "duplicate_request",
  "borrowed_from_bill",
  "bulk_buy",
]);

const FORGOTTEN_MONEY_INTERVAL_DAYS = 30;
const DUPLICATE_REQUEST_WINDOW_DAYS = 30;
const BORROWED_LOOKBACK_DAYS = 45;
// An outflow this much smaller than the bill's own real target reads as "leftover pulled off the
// top before the bill gets paid" (the design's own Electric/$62 example), not the bill itself
// being paid -- a real bill payment is usually close to its full target.
const BORROWED_MAX_FRACTION_OF_TARGET = 0.5;
const BULK_BUY_LOOKBACK_DAYS = 30;
const BULK_BUY_MIN_STOPS = 4;
// "Small, frequent" per the 7-Eleven example -- a $15 ceiling keeps this from flagging a real
// recurring bill (rent, a car payment) that also happens to hit the same merchant every month.
const BULK_BUY_MAX_AVG_CENTS = 1500;

function humanDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Upsert one real catch. `dedupeKey` is what makes a real event a singleton row across repeated
 * sweeps (see migration 033's header for what each kind keys on). Refreshes `text`/`payload` on
 * a re-detect ONLY while the row is still undismissed -- "Got it" must not be undone by the next
 * sweep finding the same real underlying fact still true.
 */
async function upsertCatch(userId, { kind, text, payload = {}, dedupeKey }) {
  if (!KINDS.includes(kind)) throw badRequest(`Unknown catch kind: ${kind}`);
  return one(
    // The real column is `detail` (see migration 034's header -- a pre-existing, orphaned
    // `catches` table already used that name before this file's own CREATE TABLE ran, and this
    // adopts it rather than fighting it). Aliased to `payload` here and in every other query in
    // this module -- the JS-facing shape everywhere else in this app.
    `INSERT INTO catches (user_id, kind, text, detail, dedupe_key)
     VALUES ($1,$2,$3,$4::jsonb,$5)
     ON CONFLICT (user_id, kind, dedupe_key) DO UPDATE
        SET text = EXCLUDED.text, detail = EXCLUDED.detail
      WHERE catches.dismissed_at IS NULL
     RETURNING id, kind, text, detail AS payload, dedupe_key, dismissed_at, created_at`,
    [userId, kind, text, JSON.stringify(payload), String(dedupeKey).slice(0, 300)],
  );
}

// ---------------------------------------------------------------------------
// detectors
// ---------------------------------------------------------------------------

/**
 * Renewal watch: real `dates` rows of kind='renewal' (Section 4's own vocabulary, already in
 * migration 014's lead-time table at 21 days) whose real lead-time window has opened. Reuses
 * Dates wholesale rather than a second date-tracking mechanism -- a renewal IS a date, just one
 * Money's Catches card also surfaces.
 */
export async function detectRenewalWatch(userId) {
  const rows = await many(
    `SELECT id, title, at_date, lead_days, notes, provider
       FROM dates
      WHERE user_id = $1 AND kind = 'renewal' AND done_at IS NULL
        AND at_date <= current_date + (lead_days || ' days')::interval
        AND at_date >= current_date`,
    [userId],
  );
  const results = [];
  for (const row of rows) {
    const when = humanDate(row.at_date);
    const text = row.notes
      ? `${row.title} renews ${when} -- ${row.notes}`
      : `${row.title} renews ${when}${row.provider ? ` (${row.provider})` : ""}. Flagged before it auto-bills.`;
    results.push(
      await upsertCatch(userId, {
        kind: "renewal",
        text,
        payload: { dateId: row.id, atDate: row.at_date },
        // The dates row id alone would never re-raise a RECURRING renewal's next real occurrence
        // under a new key -- so the specific at_date is part of the key too.
        dedupeKey: `${row.id}:${String(row.at_date).slice(0, 10)}`,
      }),
    );
  }
  return results.filter(Boolean);
}

/**
 * Forgotten-money sweep: explicitly NOT automated (design's own words -- "can't scan accounts
 * that aren't linked"). A real, honest recurring prompt: if it has been more than
 * FORGOTTEN_MONEY_INTERVAL_DAYS since the last one was raised, raise another. Never invents a
 * dollar figure -- the design's own "$1,512" example was a real, manually-reported result of a
 * real sweep Shane did by hand; this detector cannot know that number and does not pretend to.
 */
export async function detectForgottenMoney(userId) {
  const last = await one(
    `SELECT created_at FROM catches WHERE user_id = $1 AND kind = 'forgotten_money'
      ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  const daysSince = last ? Math.floor((Date.now() - new Date(last.created_at).getTime()) / 86_400_000) : null;
  if (daysSince !== null && daysSince < FORGOTTEN_MONEY_INTERVAL_DAYS) return null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const text =
    daysSince === null
      ? "Worth a first sweep for old/forgotten accounts -- old checking, an emergency fund, OnePay, Apple Cash, anywhere money could be sitting unremembered."
      : `Last sweep for old/forgotten accounts was ${daysSince} days ago. Worth checking again.`;
  return upsertCatch(userId, {
    kind: "forgotten_money",
    text,
    payload: { daysSinceLast: daysSince },
    dedupeKey: todayIso,
  });
}

/**
 * Duplicate-request catch: two different real people (`list_items.requested_by`, migration 033)
 * asking for the same real thing without knowing it. Scoped to one list at a time -- the same
 * item requested on two DIFFERENT lists is not the accidental double-ask this exists to catch.
 * Normalises on lower/trim only (no stemming): "paper towels" vs "Paper Towels" match, "paper
 * towel" vs "paper towels" does not -- a false negative here costs nothing (the item just gets
 * bought twice, same as today), a false positive costs a wrong nudge, so this stays conservative.
 */
export async function detectDuplicateRequests(userId) {
  const rows = await many(
    `SELECT li.id, li.list_id, li.text, li.requested_by, li.created_at
       FROM list_items li
       JOIN lists l ON l.id = li.list_id
      WHERE l.user_id = $1 AND l.archived_at IS NULL
        AND li.done = false
        AND li.requested_by IS NOT NULL
        AND li.created_at >= now() - ($2 || ' days')::interval
      ORDER BY li.created_at`,
    [userId, DUPLICATE_REQUEST_WINDOW_DAYS],
  );

  const groups = new Map();
  for (const row of rows) {
    const key = `${row.list_id}:${row.text.trim().toLowerCase()}`;
    const requestor = row.requested_by.trim();
    if (!groups.has(key)) groups.set(key, { text: row.text.trim(), listId: row.list_id, requestors: new Map() });
    const group = groups.get(key);
    if (!group.requestors.has(requestor.toLowerCase())) group.requestors.set(requestor.toLowerCase(), requestor);
  }

  const results = [];
  for (const [key, group] of groups) {
    if (group.requestors.size < 2) continue;
    const names = [...group.requestors.values()];
    const nameList = names.length === 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
    results.push(
      await upsertCatch(userId, {
        kind: "duplicate_request",
        text: `${nameList} both mentioned needing "${group.text}". One buy covers everyone.`,
        payload: { listId: group.listId, itemText: group.text, requestedBy: names },
        dedupeKey: key,
      }),
    );
  }
  return results.filter(Boolean);
}

/**
 * Borrowed-from-bill detection: the parked ShanesSurvival idea (#2886), real here now via #3107's
 * unified database. Reads real transactions (ShanesSurvival's own table, Plaid's sign convention
 * -- outflows positive, same convention DashboardWindow's own spend_bleed already relies on) on
 * every real bill-role account, and flags any outflow meaningfully smaller than the bill's own
 * real target -- "$20 left before it hit Direct Deposit" reads as exactly this: a partial siphon,
 * not the bill itself getting paid (a real bill payment is close to its full target amount).
 * Heuristic, not certain -- stated as such in the module header -- but real, and keyed on the
 * real transaction id so the SAME real event is never raised twice.
 */
export async function detectBorrowedFromBill(userId) {
  const rows = await many(
    `SELECT t.id AS txn_id, t.amount, t.date, t.merchant_name, t.name,
            a.id AS account_id, a.name AS account_name, a.target_amount
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE a.role = 'bill'
        AND a.target_amount IS NOT NULL
        AND t.amount > 0
        AND t.amount < a.target_amount * $1
        AND t.date >= current_date - ($2 || ' days')::interval
      ORDER BY t.date DESC`,
    [BORROWED_MAX_FRACTION_OF_TARGET, BORROWED_LOOKBACK_DAYS],
  );

  const results = [];
  for (const row of rows) {
    const amountFormatted = formatMoney(toCents(row.amount));
    const what = row.merchant_name || row.name || "something other than its own bill";
    results.push(
      await upsertCatch(userId, {
        kind: "borrowed_from_bill",
        text: `${amountFormatted} left ${row.account_name} on ${humanDate(row.date)} for ${what}. ${row.account_name} is short by exactly that.`,
        payload: {
          accountId: row.account_id,
          accountName: row.account_name,
          transactionId: row.txn_id,
          amount: Number(row.amount),
          date: row.date,
          merchant: row.merchant_name,
        },
        // The real transaction id -- one real event, one row, forever.
        dedupeKey: row.txn_id,
      }),
    );
  }
  return results.filter(Boolean);
}

/**
 * Bulk-buy suggestion: the same real "7-Eleven, 14 stops in 30 days" pattern the design names,
 * grouped the same way ShanesSurvival's own DashboardService.LoadMerchantBleedAsync already
 * groups small transactions by merchant (same lookback shape, same "amount > 0 = real spend"
 * convention) -- reused as a pattern, not imported, since that method is scoped to one account
 * and this needs every real account at once.
 */
export async function detectBulkBuy(userId) {
  const rows = await many(
    `SELECT COALESCE(NULLIF(t.merchant_name, ''), 'Unknown merchant') AS merchant,
            COUNT(*)::int AS stops, SUM(t.amount) AS total, AVG(t.amount) AS avg_amount
       FROM transactions t
      WHERE t.amount > 0
        AND t.date >= current_date - ($1 || ' days')::interval
      GROUP BY merchant
     HAVING COUNT(*) >= $2 AND AVG(t.amount) <= $3
      ORDER BY COUNT(*) DESC`,
    [BULK_BUY_LOOKBACK_DAYS, BULK_BUY_MIN_STOPS, BULK_BUY_MAX_AVG_CENTS / 100],
  );

  // Bucketed by (real) calendar month, not just merchant -- so the same real habit keeps getting
  // one fresh catch a month if it continues, rather than being silenced forever the first time
  // it is dismissed.
  const monthBucket = new Date().toISOString().slice(0, 7);

  const results = [];
  for (const row of rows) {
    const avgFormatted = formatMoney(toCents(row.avg_amount));
    results.push(
      await upsertCatch(userId, {
        kind: "bulk_buy",
        text: `${row.merchant}, ${row.stops} stops in the last ${BULK_BUY_LOOKBACK_DAYS} days (${avgFormatted} each). Might be cheaper bought in bulk.`,
        payload: { merchant: row.merchant, stops: row.stops, total: Number(row.total), avgAmount: Number(row.avg_amount) },
        dedupeKey: `${row.merchant.toLowerCase()}:${monthBucket}`,
      }),
    );
  }
  return results.filter(Boolean);
}

/** Run every real detector for one user. Read-only against source data; writes only to `catches`
 *  itself. Safe to call on every request that shows the Money screen AND from the server's own
 *  periodic sweep (server.mjs) -- upserts make repeated calls idempotent. */
export async function runDetectors(userId) {
  const [renewal, forgottenMoney, duplicateRequest, borrowedFromBill, bulkBuy] = await Promise.all([
    detectRenewalWatch(userId),
    detectForgottenMoney(userId),
    detectDuplicateRequests(userId),
    detectBorrowedFromBill(userId),
    detectBulkBuy(userId),
  ]);
  return {
    renewal: renewal.length,
    forgottenMoney: forgottenMoney ? 1 : 0,
    duplicateRequest: duplicateRequest.length,
    borrowedFromBill: borrowedFromBill.length,
    bulkBuy: bulkBuy.length,
  };
}

// ---------------------------------------------------------------------------
// the public surface
// ---------------------------------------------------------------------------

/** Every real, undismissed catch, newest first -- what the Money screen's Catches card renders.
 *  Does NOT run the detectors itself (callers that want fresh data call runDetectors first) so a
 *  plain read never pays a five-query detection cost it might not need. */
export async function listCatches(userId, { includeDismissed = false } = {}) {
  return many(
    `SELECT id, kind, text, detail AS payload, dismissed_at, created_at
       FROM catches
      WHERE user_id = $1 ${includeDismissed ? "" : "AND dismissed_at IS NULL"}
      ORDER BY created_at DESC`,
    [userId],
  );
}

/** "Got it" -- the Catches card's one real action. Idempotent: dismissing an already-dismissed
 *  catch just confirms it again rather than erroring. */
export async function dismissCatch(userId, catchId) {
  const row = await one(
    `UPDATE catches SET dismissed_at = COALESCE(dismissed_at, now())
      WHERE id = $1 AND user_id = $2
      RETURNING id, kind, text, detail AS payload, dismissed_at, created_at`,
    [catchId, userId],
  );
  if (!row) throw notFound("Catch not found");
  return row;
}
