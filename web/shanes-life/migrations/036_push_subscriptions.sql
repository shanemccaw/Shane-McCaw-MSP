-- Shane's Life -- real Web Push subscriptions (Git #3160, "Enhanced alerts: slide-down
-- notification actions").
--
-- Numbered 036: live `schema_migrations` on the shared local `finances` database already has
-- 035_people_patterns.sql applied (a concurrent build, not yet on origin/main when this file was
-- written) on top of the 034_catches.sql this worktree already had -- checked live, not assumed
-- from the checked-out tree, per this build's own prompt warning.
--
-- Nothing in this app has ever actually SENT a web push notification (public/sw.js's own comment:
-- "nothing sends one yet"). This is the real subscription-storage half of making that true: one
-- row per browser endpoint a user has granted push permission to (a phone can have more than one
-- -- reinstalling the Home Screen app produces a new PushSubscription with a new endpoint, and
-- the old one should keep working until it 404s/410s on its own rather than being guessed away).
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   text        NOT NULL,
    p256dh     text        NOT NULL,  -- subscription's public key, base64url
    auth       text        NOT NULL,  -- subscription's auth secret, base64url
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- One row per real endpoint. Re-subscribing (permission re-granted, browser rotated the
-- endpoint) is a normal event, not an error -- upsert on conflict rather than fail.
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_key ON push_subscriptions (endpoint);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);

-- Real act-on-notification state on the existing nudge_events row (018) -- "mark done, snooze,
-- dismiss" per the issue's own real scope. action/actioned_at record what was actually done and
-- when, whether that action arrived from a service-worker background fetch (tapping a slide-down
-- action button, no app open) or from inside the app itself. snoozed_until is real: a snoozed
-- nudge is re-delivered by the housekeeping loop once it passes, not just hidden client-side.
ALTER TABLE nudge_events ADD COLUMN IF NOT EXISTS action text;              -- done | snooze | dismiss
ALTER TABLE nudge_events ADD COLUMN IF NOT EXISTS actioned_at timestamptz;
ALTER TABLE nudge_events ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;

CREATE INDEX IF NOT EXISTS nudge_events_snoozed_idx ON nudge_events (snoozed_until)
  WHERE snoozed_until IS NOT NULL AND action = 'snooze';
