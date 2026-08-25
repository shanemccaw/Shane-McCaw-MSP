-- ============================================================================
-- Customer Portal Alert Preferences — real schema (Git #1276)
-- ============================================================================
-- Manual migration — hand-written per CLAUDE.md (no drizzle-kit push). Idempotent:
-- CREATE TABLE / CREATE INDEX IF NOT EXISTS — safe to re-run.
--
-- ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
-- portal-v2-alert-preferences.tsx (alertPrefsData.ts / alertPrefsModel.ts) has
-- had a fully-interactive UI with NO backing storage since it was built — every
-- toggle, preset, quiet-hours window and recipient lived in useState only and
-- reset on refresh (confirmed via #1236's investigation). Decision (a) from the
-- original #1276 scoping: a NEW taxonomy (7 conceptual categories: findings/
-- drift/progress/reviews/remediation/billing/support), NOT folded into the
-- existing 15-technical-category `customer_notification_preferences` table,
-- which stays exactly as-is for the Notification Center bell.
--
-- This is also the real implementation of the customer-delivery seam #1278
-- built for exactly this purpose (`customer-alert-delivery.ts`
-- `resolveCustomerAlertPreferences`) and the digest-batching / quiet-hours hold
-- the #1278 sign-off explicitly scoped into this issue, not that one.
--
-- ── SCOPING ──────────────────────────────────────────────────────────────────
-- Scoped by `customer_id` (tenants.id, the JWT customerId) — ALERTS ARE ABOUT
-- ONE MONITORED TENANT, so any portal user for that tenant edits the same
-- shared profile. The primary recipient ("you") is never a stored row; it is
-- always the requesting user's own account, resolved live at read time.
--
-- ── ON THE ENUM COLUMNS ──────────────────────────────────────────────────────
-- `category`, `mode`, `active_preset`, `hold_reason` are plain TEXT with NO
-- Postgres enum type and NO CHECK constraint — same convention as
-- customer_tenant_alert_rules.condition_type. `threshold` is a category-specific
-- sensitivity key (differs per category — see alertPrefsData.ts ALERT_CATS)
-- and is validated app-side only.
-- ============================================================================

BEGIN;

-- ── customer_alert_preferences — one row per (customer, category) ────────────
CREATE TABLE IF NOT EXISTS customer_alert_preferences (
  id              SERIAL PRIMARY KEY,
  customer_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  email_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  mode            TEXT NOT NULL DEFAULT 'immediate',
  threshold       TEXT NOT NULL DEFAULT 'any',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_alert_prefs_customer_category_uidx
  ON customer_alert_preferences (customer_id, category);

-- ── customer_alert_settings — one row per customer (quiet hours + preset) ────
CREATE TABLE IF NOT EXISTS customer_alert_settings (
  id                       SERIAL PRIMARY KEY,
  customer_id              INTEGER NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  active_preset            TEXT NOT NULL DEFAULT 'balanced',
  quiet_hours_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_hours_from         TEXT NOT NULL DEFAULT '19:00',
  quiet_hours_to           TEXT NOT NULL DEFAULT '07:30',
  quiet_break_for_critical BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_user_id       INTEGER REFERENCES users(id)
);

-- ── customer_alert_recipients — additional recipients beyond the logged-in user
CREATE TABLE IF NOT EXISTS customer_alert_recipients (
  id                SERIAL PRIMARY KEY,
  customer_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email             TEXT NOT NULL,
  role              TEXT,
  scope_categories  TEXT[],
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_alert_recipients_customer_email_uidx
  ON customer_alert_recipients (customer_id, email);

-- ── customer_alert_digest_queue — daily/weekly digest batching AND the
-- quiet-hours hold ("sent in one email when the window closes"), discriminated
-- by hold_reason. Drained by customer-alert-digest.ts on the same 5-minute pass
-- evaluateCustomerTenantRules (#1278) rides.
CREATE TABLE IF NOT EXISTS customer_alert_digest_queue (
  id                SERIAL PRIMARY KEY,
  customer_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id          INTEGER NOT NULL REFERENCES customer_tenant_alert_events(id) ON DELETE CASCADE,
  alert_category    TEXT NOT NULL,
  severity          TEXT NOT NULL,
  summary           TEXT NOT NULL,
  deep_link_path    TEXT,
  hold_reason       TEXT NOT NULL,
  due_at            TIMESTAMPTZ NOT NULL,
  queued_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at           TIMESTAMPTZ,
  digest_batch_id   UUID
);
CREATE INDEX IF NOT EXISTS customer_alert_digest_queue_due_idx
  ON customer_alert_digest_queue (due_at);
CREATE INDEX IF NOT EXISTS customer_alert_digest_queue_customer_pending_idx
  ON customer_alert_digest_queue (customer_id, sent_at);

-- ── Self-mark for Simulator Studio's Migrations tree (#497) ──────────────────
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-25-customer-alert-preferences-1276.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
