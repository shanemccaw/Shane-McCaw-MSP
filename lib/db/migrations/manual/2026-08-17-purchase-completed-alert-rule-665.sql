-- ============================================================================
-- #665 — Migrate hardcoded purchase-sale push notification into the real
--        configurable msp_alert_rules system (Option 2: event-triggered path)
-- ============================================================================
-- Manual migration — self-executed via SSH psql against the live dev DB per
-- current CLAUDE.md (direct DB access is a real, confirmed option; the old
-- "write it and hand it to Shane" default is obsolete for a reversible seed).
-- Idempotent: ON CONFLICT DO NOTHING on the seed, ON CONFLICT DO UPDATE on the
-- self-marking row — safe to re-run.
--
-- ── ON THE TWO ENUM ADDITIONS — SAID OUT LOUD ──────────────────────────────
-- The schema change for this issue widens two Drizzle enums in
-- lib/db/src/schema/msp.ts:
--   * MSP_ALERT_CONDITION_TYPES  += "purchase_completed"
--   * MSP_ALERT_SEVERITIES        += "info"
-- Both `msp_alert_rules.condition_type` and `msp_alert_rules.severity` are
-- plain TEXT columns with NO Postgres enum type and NO CHECK constraint
-- (verified live 2026-08-17: only the PK and the rule_key UNIQUE constraint
-- exist on this table). Drizzle's `text("...", { enum: [...] })` is a
-- TypeScript-level narrowing only — it emits no DDL. So there is deliberately
-- NO `ALTER TYPE` / `ALTER TABLE ... ADD CONSTRAINT` here: the DB already
-- accepts these string values as-is. The enum widening is purely an
-- application-level type change; this file's only real DB effect is seeding
-- the rule row below.
--
-- ── WHAT THIS CLOSES ────────────────────────────────────────────────────────
-- Purchase/sale push notifications previously existed as direct, hardcoded
-- sendWebPushToAdmins() calls baked into msp-billing-webhook.ts (checkout.
-- session.completed) and portal-assessment.ts (Stripe webhook) — real and
-- working, but outside the admin-configurable rules system, so severity /
-- cooldown / delivery channel could not be tuned from the UI the way every
-- other alert can. Seeding this row + the new fireEventRule() direct-fire path
-- in alert-engine.ts turns the sale notification into a normal, configurable
-- msp_alert_rules row with exactly one delivery mechanism.
--
-- ── SEED CHOICES (from #665's build-plan comment) ──────────────────────────
--   severity        = 'info'   — a sale is neither a warning nor a critical
--                                condition.
--   delivery_email  = false    — email-on-every-sale is noisier than push;
--                                Shane can flip this from the existing admin UI.
--   delivery_push   = true     — matches today's push-only behaviour.
--   cooldown_minutes= 0        — every distinct sale should fire; the per-event
--                                summary already carries the unique amount/name.
--   threshold=1, window_minutes=0 — unused on the direct-fire path (never read
--                                by getConditionValue), set to sane no-op values.
--   deep_link_path  = '/billing'
-- ============================================================================

BEGIN;

-- ── READ-ONLY: what exists today (expect zero rows before this runs) ─────────
SELECT rule_key, condition_type, severity, enabled, delivery_email, delivery_push, cooldown_minutes
FROM msp_alert_rules
WHERE rule_key = 'purchase_completed';

-- ── THE SEED ─────────────────────────────────────────────────────────────────
INSERT INTO msp_alert_rules (
  rule_key, label, description, condition_type, threshold, window_minutes,
  severity, enabled, delivery_email, delivery_push, cooldown_minutes, deep_link_path
) VALUES (
  'purchase_completed',
  'Purchase completed',
  'Fires immediately when a real sale/checkout completes.',
  'purchase_completed',
  1,
  0,
  'info',
  true,
  false,
  true,
  0,
  '/billing'
)
ON CONFLICT (rule_key) DO NOTHING;

-- ── VERIFY (expect exactly one row, matching the seed choices above) ─────────
SELECT rule_key, condition_type, severity, enabled, delivery_email, delivery_push, cooldown_minutes, deep_link_path
FROM msp_alert_rules
WHERE rule_key = 'purchase_completed';

-- ── Self-mark for Simulator Studio's Migrations tree (#497) ──────────────────
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-17-purchase-completed-alert-rule-665.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
