// Real push-subscription storage (migration 036) + the real send path (Git #3160). Nothing
// called sendWebPush before this file existed -- see notifyUser() below, and nudges.mjs /
// server.mjs for who calls it.

import { many, one, query } from "../db.mjs";
import { sendWebPush, vapidPublicKey } from "../push/webpush.mjs";

export function isConfigured() {
  return vapidPublicKey() !== null;
}

/** Upsert on endpoint -- re-subscribing (permission re-granted, new device) is normal, not an error. */
export async function saveSubscription(userId, { endpoint, keys, userAgent = null }) {
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    throw new Error("endpoint, keys.p256dh and keys.auth are all required");
  }
  return one(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET
       user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent, last_seen_at = now()
     RETURNING *`,
    [userId, endpoint, keys.p256dh, keys.auth, userAgent],
  );
}

export async function removeSubscription(userId, endpoint) {
  await query("DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2", [userId, endpoint]);
}

async function subscriptionsFor(userId) {
  return many("SELECT * FROM push_subscriptions WHERE user_id = $1", [userId]);
}

/**
 * Sends `payload` as a real web push to every one of a user's real subscriptions. Silently a
 * no-op (not an error) if VAPID keys aren't configured -- the in-app tray is still the real
 * source of truth for a nudge; a missing push credential degrades to "no OS notification", not a
 * failed nudge. A subscription the push service reports gone (404/410) is deleted on the spot --
 * that is the real, expected way a stale subscription is discovered, not something to guess at.
 */
export async function notifyUser(userId, payload) {
  if (!isConfigured()) return { sent: 0, gone: 0, configured: false };

  const subs = await subscriptionsFor(userId);
  let sent = 0;
  let gone = 0;
  for (const sub of subs) {
    try {
      const result = await sendWebPush(sub, payload);
      if (result.gone) {
        await query("DELETE FROM push_subscriptions WHERE id = $1", [sub.id]);
        gone += 1;
      } else if (result.ok) {
        sent += 1;
      }
    } catch (err) {
      // A single dead/misbehaving endpoint must never block the rest of a user's real devices.
      console.error(`[push] send failed for subscription ${sub.id}:`, err.message);
    }
  }
  return { sent, gone, configured: true };
}
