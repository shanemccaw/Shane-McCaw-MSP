// Standalone ad-hoc timers (Git #3307, migration 069). Real, server-side timer entity, distinct
// from Recipes' own `mealTickTimer`/`mealBeepTimer` (public/app.js -- client-only state scoped to
// a live `#/cook/<id>`/`#/tonight` session, reset on leaving the view). Shane's own real decision
// on this issue: "the cooking is only good if the timer replaces dumb Siri and manual clocks" --
// this has to fire even when the phone isn't being looked at, so `fires_at` is computed once at
// creation and the real alert goes out through the existing web-push path (see server.mjs's
// runTimerSweep, which calls queueNudge -> notifyUser), not a client-side setTimeout.

import { many, one } from "../db.mjs";
import { badRequest, notFound } from "../http.mjs";

function normaliseLabel(label) {
  if (label === undefined || label === null) return null;
  const l = String(label).trim().slice(0, 200);
  return l || null;
}

function normaliseDurationSeconds(durationSeconds) {
  const n = Number(durationSeconds);
  if (!Number.isFinite(n) || n <= 0) throw badRequest("durationSeconds must be a real positive number");
  // A day is a generous real ceiling for "an ad-hoc kitchen/task timer" -- this is not a
  // scheduler, and Dates already owns anything that's really a future appointment/event.
  if (n > 24 * 60 * 60) throw badRequest("durationSeconds must be 24 hours or less");
  return Math.round(n);
}

/** Creates one real timer, `fires_at` computed now so it survives a redeploy mid-countdown. */
export async function createTimer(userId, { label, durationSeconds }) {
  const seconds = normaliseDurationSeconds(durationSeconds);
  const l = normaliseLabel(label);
  // Git #3161/#3160-class Postgres param-inference trap (see nudges.mjs's own header): reusing
  // $3 both as the plain integer column value and inside an interval expression makes Postgres
  // deduce two conflicting types for the one placeholder ("inconsistent types deduced for
  // parameter $3" -- caught live against the real local database on the first attempt, then
  // again on a `* interval` retry, not guessed). Binding the same real seconds value to two
  // separate placeholders sidesteps the whole class instead of chasing the right cast.
  return one(
    `INSERT INTO timers (user_id, label, duration_seconds, fires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4))
     RETURNING *`,
    [userId, l, seconds, seconds],
  );
}

/** Every real timer this user has running right now -- Today tray's own source of truth for the
 *  "see/cancel an active standalone timer" real scope item. */
export async function listActive(userId) {
  return many(
    `SELECT * FROM timers WHERE user_id = $1 AND canceled_at IS NULL AND fired_at IS NULL ORDER BY fires_at ASC`,
    [userId],
  );
}

/** Real "+1 min" (Git #3318, README "Drawn in the same pass" item 6: the Today-tray timer chip's
 *  own real `+1 min` button, `d.timerPlus` in the prototype) -- pushes `fires_at` out by the given
 *  real number of seconds (default 60) server-side, same "the countdown is the server's, not the
 *  phone's" discipline the whole timer entity exists for (see this file's own header). Same
 *  not-found-or-already-fired shape as cancelTimer above. */
export async function extendTimer(userId, id, seconds = 60) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) throw badRequest("seconds must be a real positive number");
  const row = await one(
    `UPDATE timers SET fires_at = fires_at + make_interval(secs => $3)
      WHERE id = $1 AND user_id = $2 AND canceled_at IS NULL AND fired_at IS NULL
      RETURNING *`,
    [id, userId, Math.round(n)],
  );
  if (!row) throw notFound("Timer not found, or it already fired.");
  return row;
}

/** Real cancel -- a no-op turned honest error once a timer has already fired or was already
 *  canceled, same "not found, or it already ran" shape `tesla.cancelScheduledCommand` uses. */
export async function cancelTimer(userId, id) {
  const row = await one(
    `UPDATE timers SET canceled_at = now()
      WHERE id = $1 AND user_id = $2 AND canceled_at IS NULL AND fired_at IS NULL
      RETURNING *`,
    [id, userId],
  );
  if (!row) throw notFound("Timer not found, or it already fired.");
  return row;
}

/** Every user's own due, unfired, uncanceled timer -- server.mjs's real sweep query. Cross-user
 *  on purpose (same shape as tesla.mjs's dispatchDueCommands): one sweep, not one per user. */
export async function findDue() {
  return many(
    `SELECT * FROM timers WHERE canceled_at IS NULL AND fired_at IS NULL AND fires_at <= now()`,
  );
}

/** Marks a timer fired -- called once the real push for it has actually been sent (or attempted;
 *  see nudges.mjs's own "a push failure never blocks the record" reasoning -- a timer that fired
 *  five minutes ago and failed to push must not fire the SAME push again next sweep). */
export async function markFired(id) {
  return one(`UPDATE timers SET fired_at = now() WHERE id = $1 RETURNING *`, [id]);
}
