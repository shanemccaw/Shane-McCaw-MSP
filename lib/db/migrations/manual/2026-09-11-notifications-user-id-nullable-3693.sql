-- Git #3693 — real schema/DB drift found while adding MSP-staff notification
-- preferences: notifications.user_id is NOT NULL in the live database, but the
-- Drizzle schema (lib/db/src/schema/index.ts's notificationsTable) has always
-- declared it nullable, and notification-center.ts's msp_user recipient branch
-- deliberately never sets userId (it sets mspUserId instead — see
-- createNotification()'s `...(userId !== undefined ? { userId } : {})` insert
-- spread). The real, observed effect: every `createNotification()` call for an
-- `msp_user` recipient has been throwing a NOT NULL violation on insert,
-- caught and logged as "notification-center: failed to create notification
-- (non-fatal)" and silently swallowed — msp_user in-app notifications have
-- never actually been persisted. Confirmed live via
-- msp-settings-notification-preferences.live-db.test.ts, which reproduced the
-- exact NOT NULL violation before this migration.
--
-- @migration-gate: auto-approved
-- @gate-reason: DROP NOT NULL only — explicitly listed as non-destructive in
-- CLAUDE.md's destructive-migration-gate section (reversible, loses no data).
-- Brings the live column in line with the schema definition that has always
-- described it, not a new relaxation.

BEGIN;

ALTER TABLE notifications
  ALTER COLUMN user_id DROP NOT NULL;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-11-notifications-user-id-nullable-3693.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
