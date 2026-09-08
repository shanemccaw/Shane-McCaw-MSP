// The real 1-3/day nudge cap (migration 018, Git #3107) -- "the fourth is HELD, never
// stacked." Nothing in this app queued a real nudge_events row yet; Dates' day-before
// appointment reminder (Git #3136, the contract's one stated clock exception) is the first
// real caller.

import { one, transaction } from "../db.mjs";

const DEFAULT_CAP = 3;

/**
 * Queue a real nudge for today, respecting the real per-day cap. `countsToCap: false` (meds
 * batches, per the non-negotiables) never consumes a cap slot and is always sent. Over cap, the
 * row is still written -- with `held_at` set instead of `sent_at` -- so "N of up to 3 nudges
 * today" and the held state are both answerable from the database, never silently dropped.
 */
export async function queueNudge({ userId, kind, title, body = null, payload = {}, countsToCap = true, cap = DEFAULT_CAP }) {
  return transaction(async (client) => {
    const { rows: dayRows } = await client.query(
      `INSERT INTO nudges (user_id, day, cap) VALUES ($1, current_date, $2)
       ON CONFLICT (user_id, day) DO UPDATE SET cap = EXCLUDED.cap
       RETURNING count, held_count, cap`,
      [userId, cap],
    );
    const day = dayRows[0];
    const overCap = countsToCap && day.count >= day.cap;

    const { rows: eventRows } = await client.query(
      `INSERT INTO nudge_events (user_id, kind, title, body, payload, counts_to_cap, sent_at, held_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6, CASE WHEN $7 THEN NULL ELSE now() END, CASE WHEN $7 THEN now() ELSE NULL END)
       RETURNING *`,
      [userId, kind, title, body, JSON.stringify(payload), countsToCap, overCap],
    );

    if (countsToCap) {
      await client.query(
        `UPDATE nudges SET
            count = count + CASE WHEN $3 THEN 0 ELSE 1 END,
            held_count = held_count + CASE WHEN $3 THEN 1 ELSE 0 END,
            updated_at = now()
          WHERE user_id = $1 AND day = current_date`,
        [userId, cap, overCap],
      );
    }

    return eventRows[0];
  });
}

export async function todayCapStatus(userId) {
  const row = await one(
    `SELECT count, held_count, cap FROM nudges WHERE user_id = $1 AND day = current_date`,
    [userId],
  );
  return row || { count: 0, held_count: 0, cap: DEFAULT_CAP };
}
