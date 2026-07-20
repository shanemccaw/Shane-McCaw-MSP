-- Customer Notification Preferences UI
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- One row per (user, category). Absence of a row = default (in-app on, email off).
-- Governs delivery of the existing Notification Center bell (notifications table,
-- see artifacts/api-server/src/lib/notification-center.ts) to CustomerUser recipients
-- only — it never touches policy_rules severity/cooldown/escalation, which stay
-- MSP-configured.

CREATE TABLE IF NOT EXISTS "customer_notification_preferences" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "category" text NOT NULL,
  "in_app_enabled" boolean NOT NULL DEFAULT true,
  "email_enabled" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_notif_prefs_user_category_uidx"
  ON "customer_notification_preferences" ("user_id", "category");
