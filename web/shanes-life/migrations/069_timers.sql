-- Standalone ad-hoc timers (Git #3307, real decision from Shane 2026-09-09).
--
-- The design contract's own Capture grammar list (§112-123, item 3) names "8 min timer for
-- pasta" as a real capture-grammar example, but there was no entity, table or route for a
-- standalone timer created from the general capture box outside a live Cook/Tonight session
-- (`mealTickTimer`/`mealBeepTimer` in public/app.js are client-only state scoped to that one
-- live session and reset on leaving the view). Shane's own real decision: this must be a real
-- server-side timer, not client-side-only state -- "the cooking is only good if the timer
-- replaces dumb Siri and manual clocks," meaning it has to fire even when the phone isn't being
-- looked at, same as a real physical timer or Siri would. Delivery reuses the existing real
-- web-push/nudge infrastructure (`src/core/nudges.mjs`, `src/core/push-subscriptions.mjs`).
--
-- `fires_at` is computed once at creation (`now() + duration_seconds`), not recomputed on read,
-- so a timer keeps counting down correctly across a server restart -- the same real reasoning
-- `tesla_scheduled_commands.scheduled_for` already uses (Git #3218's own migration comment: "a
-- setTimeout-only countdown would die on every redeploy; this is a persisted row").
-- `fired_at`/`canceled_at` are both nullable and mutually exclusive in practice (server.mjs's
-- sweep only ever sets `fired_at` on a row where `canceled_at IS NULL`); keeping them as two
-- real timestamp columns rather than one status enum answers "when" as well as "whether" for
-- free, matching how this app already tracks nudge_events' own sent_at/held_at pair.
CREATE TABLE IF NOT EXISTS timers (
    id                bigserial PRIMARY KEY,
    user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label             text,
    duration_seconds  integer NOT NULL CHECK (duration_seconds > 0),
    fires_at          timestamptz NOT NULL,
    fired_at          timestamptz,
    canceled_at       timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);

-- The real sweep query (server.mjs, every ~20s -- much tighter than the 5-minute Tesla/snooze
-- sweeps, since a real timer can genuinely be "2 minutes" and still needs to fire on time):
-- WHERE canceled_at IS NULL AND fired_at IS NULL AND fires_at <= now().
CREATE INDEX IF NOT EXISTS timers_due_idx ON timers (fires_at) WHERE fired_at IS NULL AND canceled_at IS NULL;
CREATE INDEX IF NOT EXISTS timers_user_active_idx ON timers (user_id, fires_at) WHERE fired_at IS NULL AND canceled_at IS NULL;
