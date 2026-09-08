// The real 1-3/day nudge cap (migration 018, Git #3107) -- "the fourth is HELD, never
// stacked." Dates' day-before appointment reminder (Git #3136) and Pets' vaccine lead-time
// reminder are the real callers.
//
// Git #3160 (migration 036) adds the real act-on-notification half: every sent nudge is also
// pushed as a real OS notification (see notifyUser() below), with real action buttons (mark
// done / snooze / dismiss) a service worker can act on without opening the app. See
// public/sw.js for the client side and src/routes/api.mjs's /api/nudges/:id/action for what an
// action actually does.

import { one, many, query, transaction } from "../db.mjs";
import { notifyUser } from "./push-subscriptions.mjs";

const DEFAULT_CAP = 3;

// Real action buttons per nudge kind, per the issue's own real scope ("mark done, snooze,
// dismiss" matching the iOS native slide-down pattern). Dismiss is always available; "done" is
// only offered for kinds that have a real underlying effect to perform (see
// /api/nudges/:id/action in routes/api.mjs) -- offering a "done" button with nothing behind it
// would be exactly the fake-affordance failure this app's own design contract rules out
// elsewhere (no gamification, no fabricated completion state).
const ACTIONS_BY_KIND = {
  appointment: [
    { action: "done", title: "Mark done" },
    { action: "snooze", title: "Snooze 1h" },
    { action: "dismiss", title: "Dismiss" },
  ],
  vaccine: [
    { action: "done", title: "Mark given" },
    { action: "snooze", title: "Snooze 1h" },
    { action: "dismiss", title: "Dismiss" },
  ],
};
const DEFAULT_ACTIONS = [
  { action: "snooze", title: "Snooze 1h" },
  { action: "dismiss", title: "Dismiss" },
];

export function actionsForKind(kind) {
  return ACTIONS_BY_KIND[kind] || DEFAULT_ACTIONS;
}

/**
 * Queue a real nudge for today, respecting the real per-day cap. `countsToCap: false` (meds
 * batches, per the non-negotiables) never consumes a cap slot and is always sent. Over cap, the
 * row is still written -- with `held_at` set instead of `sent_at` -- so "N of up to 3 nudges
 * today" and the held state are both answerable from the database, never silently dropped.
 *
 * A held nudge never fires a real OS push -- pushing it would defeat the whole point of the cap
 * (the fourth is held, not just relabeled). Only a genuinely sent row pushes.
 */
export async function queueNudge({ userId, kind, title, body = null, payload = {}, countsToCap = true, cap = DEFAULT_CAP }) {
  const row = await transaction(async (client) => {
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
      // Git #3161/#3160/#3189: `cap` was passed as a third bind param here but never referenced
      // in the SQL text (the row's own `cap` is already set by the upsert above) -- Postgres
      // cannot infer a type for a wholly unused parameter and rejected every real call with
      // "could not determine data type of parameter $2", silently swallowed by every caller's
      // own try/catch (server.mjs's reminder sweeps). Two concurrent builds (#3160 and #3161)
      // independently hit and fixed this same real bug the same night; #3189 is the filed
      // finding.
      await client.query(
        `UPDATE nudges SET
            count = count + CASE WHEN $2 THEN 0 ELSE 1 END,
            held_count = held_count + CASE WHEN $2 THEN 1 ELSE 0 END,
            updated_at = now()
          WHERE user_id = $1 AND day = current_date`,
        [userId, overCap],
      );
    }

    return eventRows[0];
  });

  if (row.sent_at) await pushNudge(row);
  return row;
}

async function pushNudge(row) {
  try {
    await notifyUser(row.user_id, {
      title: row.title,
      body: row.body || "",
      url: pushUrlForNudge(row),
      tag: `nudge-${row.id}`,
      nudgeId: row.id,
      kind: row.kind,
      actions: actionsForKind(row.kind),
    });
  } catch (err) {
    // A push failure is never allowed to make queueNudge itself fail -- the nudge_events row
    // (the in-app tray's real source of truth) is already committed regardless.
    console.error(`[push] notifyUser failed for nudge ${row.id}:`, err.message);
  }
}

/** Where tapping the notification body itself (not an action button) should land -- the real
 * fallback the design contract names for when action-button interactivity isn't available. */
function pushUrlForNudge(row) {
  if (row.kind === "appointment") return `/#/date/${row.payload?.dateId ?? ""}`;
  if (row.kind === "vaccine") return `/#/pet/${row.payload?.petId ?? ""}`;
  return "/";
}

export async function todayCapStatus(userId) {
  const row = await one(
    `SELECT count, held_count, cap FROM nudges WHERE user_id = $1 AND day = current_date`,
    [userId],
  );
  return row || { count: 0, held_count: 0, cap: DEFAULT_CAP };
}

/** Today's real nudges -- the in-app fallback surface for act-on-notification when a tap opened
 * the app instead of firing an action button (the design contract's own stated fallback). */
export async function listToday(userId) {
  return many(
    `SELECT * FROM nudge_events WHERE user_id = $1 AND day = current_date ORDER BY created_at DESC`,
    [userId],
  );
}

export async function getNudgeEvent(userId, id) {
  return one("SELECT * FROM nudge_events WHERE id = $1 AND user_id = $2", [id, userId]);
}

/**
 * Records that a real action was taken on a real nudge -- from a service-worker background
 * fetch (a slide-down action button, no app open) or from inside the app. Any real underlying
 * effect the action implies (marking an appointment done, a vaccine given) is a separate call
 * the API route makes; this file owns only the nudge's own state.
 */
export async function setNudgeAction(userId, id, action) {
  if (!["done", "snooze", "dismiss"].includes(action)) {
    throw new Error(`Unknown nudge action: ${action}`);
  }
  const snoozeClause = action === "snooze" ? "snoozed_until = now() + interval '1 hour'" : "snoozed_until = NULL";
  const { rows } = await query(
    `UPDATE nudge_events SET action = $3, actioned_at = now(), ${snoozeClause}
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [id, userId, action],
  );
  return rows[0] || null;
}

/**
 * Real housekeeping call: re-delivers every snoozed nudge whose hour is up as a fresh real push,
 * then clears its snooze state (back to a normal pending/actionable nudge, not held again --
 * snoozing an already-sent nudge never re-consumes a cap slot).
 */
export async function redeliverSnoozedNudges() {
  const due = await many(
    `SELECT * FROM nudge_events WHERE action = 'snooze' AND snoozed_until IS NOT NULL AND snoozed_until <= now()`,
  );
  for (const row of due) {
    await query(`UPDATE nudge_events SET action = NULL, actioned_at = NULL, snoozed_until = NULL WHERE id = $1`, [row.id]);
    await pushNudge(row);
  }
  return due.length;
}
