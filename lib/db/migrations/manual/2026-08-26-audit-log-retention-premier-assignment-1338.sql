-- Assign the orphaned compliance:audit-log-retention check to core:premier (#1338)
-- Manual migration — Shane runs this himself (schema/data changes are hand-written
-- per the standing rule, never drizzle-kit push).
--
-- ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
-- compliance:audit-log-retention is a REAL, active check (added by #754, label
-- "Audit Log Retention Policy" — reads Get-UnifiedAuditLogRetentionPolicy over the
-- ps-execution container; backs Remediation Guide Step 18). Confirmed live in the
-- local Postgres this session:
--     SELECT key, status FROM monitor_checks WHERE key='compliance:audit-log-retention';
--       -> compliance:audit-log-retention | active
-- ...but it is assigned to ZERO packages — it has no row at all in
-- monitoring_package_checks. Confirmed live this session:
--     SELECT package_key FROM monitoring_package_checks
--       WHERE check_key='compliance:audit-log-retention';   ->  (0 rows)
-- A check with no package membership is never scanned for any tenant regardless of
-- what tier they hold, so it can produce no findings and no profile data. The
-- Compliance pillar page's "Audit Retention" and "Admin Activity Trail" area cards
-- (CMP_AREA_LINKS) therefore had no real producer to wire to — a package problem,
-- not a frontend one. This makes the check reachable before the frontend wiring in
-- the same #1338 change reads it.
--
-- ── WHY core:premier ─────────────────────────────────────────────────────────
-- Audit-log retention is a Premier-tier compliance/evidence concern, and every
-- other compliance:* / exchange:* check the Compliance page wires to is already a
-- core:premier member (compliance:missing-labels/label-errors/weak-dlp-policies/
-- zero-dlp-policies/dlp-incidents, exchange:litigation-hold-coverage — all in
-- core:premier, verified this session). Adding audit-log-retention to the SAME
-- package keeps the whole Compliance cluster running on one consistent tier rather
-- than leaving one sibling orphaned. sort_order 18 co-locates it immediately after
-- the existing compliance cluster (weak-dlp-policies is 17).
--
-- Scope is deliberately narrow: this assigns the check to core:premier ONLY. It
-- does not touch the other tiers, does not modify the check definition, and does
-- not fabricate any tenant data — it only makes an already-authored check eligible
-- to run.
--
-- Safe to run repeatedly: INSERT ... ON CONFLICT DO NOTHING (the
-- (package_key, check_key) unique constraint makes a re-run a no-op).

BEGIN;

-- Guard: the check must genuinely exist and be active before we assign it, so a
-- typo or a rolled-back #754 can never create a dangling membership row (the FK to
-- monitor_checks(key) would reject it anyway, but this fails loudly and early).
INSERT INTO "monitoring_package_checks" ("package_key", "check_key", "sort_order")
SELECT 'core:premier', 'compliance:audit-log-retention', 18
WHERE EXISTS (
  SELECT 1 FROM monitor_checks WHERE key = 'compliance:audit-log-retention'
)
ON CONFLICT DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-26-audit-log-retention-premier-assignment-1338.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- ── READ-ONLY verification ───────────────────────────────────────────────────
SELECT package_key, check_key, sort_order
FROM monitoring_package_checks
WHERE check_key = 'compliance:audit-log-retention'
ORDER BY package_key;
