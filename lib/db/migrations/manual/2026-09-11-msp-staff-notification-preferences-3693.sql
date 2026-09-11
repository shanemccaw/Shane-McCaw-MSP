-- Git #3693 — MSP-staff alert preferences (how MSP staff want to be notified).
--
-- Mirrors customer_notification_preferences' exact shape and "absence of a row
-- = default" convention (in-app delivery on, email delivery off), applied to
-- MSP staff instead of customers. Confirmed via direct schema check: no
-- per-MSP-staff-user notification/alert preferences table existed anywhere
-- (msp_alert_rules / msp_alert_events are rule/event definitions, not per-user
-- delivery preferences).
--
-- Scoped by user_id only, same as the customer table — an MSP staff member's
-- mspId is already carried on their own users row, so no separate msp_id
-- column is needed to know whose preferences these are.
--
-- Categories reuse the existing shared CATEGORY_STYLES taxonomy
-- (artifacts/api-server/src/routes/notifications.ts) that already fires into
-- both /portal/notifications and /msp/notifications via the one shared
-- `notifications` table — genuinely the same categories, not a new MSP-side
-- vocabulary.

BEGIN;

CREATE TABLE IF NOT EXISTS msp_staff_notification_preferences (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category text NOT NULL,
  in_app_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS msp_staff_notif_prefs_user_category_uidx
  ON msp_staff_notification_preferences (user_id, category);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-11-msp-staff-notification-preferences-3693.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
