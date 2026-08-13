-- Git #549 — persist the matched severity rule's real label on every
-- tenant_monitor_profiles row.
--
-- PROBLEM
--   monitor_checks.severity_rules is a jsonb array of {expression, severity, label}.
--   The label is the human-written sentence an author actually wrote (e.g. #470's
--   "No sensitivity labels are configured in this tenant ..."). But collection
--   time only ever persisted `severity_matched` — the BAND ("warning") — so
--   deriveMonitorFindingsWithKeys() (tenant-signals.ts) had nothing to say and
--   built every finding as
--     "<check_key>: <severity> severity condition matched on latest monitoring scan"
--   which is what every document's {{findings}} list has been showing.
--
-- WHY A COLUMN AND NOT A READ-TIME LOOKUP
--   Confirmed against real seeded rules, not assumed: a single check CAN carry
--   two rules with the SAME severity and different labels —
--   exchange:dkim-spf-dmarc-status has "warning"/"No SPF record found on the
--   domain" AND "warning"/"No DMARC record found at _dmarc.<domain>" (see
--   2026-08-06-dns-executor-dkim-spf-dmarc-496.sql). classifySeverity() returns
--   the FIRST match, so recovering the label from the band alone at read time is
--   ambiguous and could state the wrong fact to a customer.
--   Second, independent reason: labels interpolate {{path}} tokens against that
--   run's own extracted properties (#418), so the rendered sentence is
--   run-specific and cannot be reconstructed later from the rule text.
--
-- NULLABLE ON PURPOSE, NO BACKFILL HERE
--   Every historical row keeps NULL. NULL means "no label was captured", and
--   every consumer falls back to the existing generic sentence rather than
--   inventing one. Backfilling would mean re-running today's severity_rules
--   against rows collected before those rules were edited (#470/#487 changed
--   several tonight) and stamping historical results with newer text — the
--   opposite of honest. Rows refresh naturally on the next scan.

BEGIN;

ALTER TABLE tenant_monitor_profiles
  ADD COLUMN IF NOT EXISTS severity_label text;

COMMENT ON COLUMN tenant_monitor_profiles.severity_label IS
  'Git #549: the matched severity_rules entry''s own label, already {{token}}-interpolated against this run''s extracted_properties. NULL = no label captured (rule had none, interpolation was incomplete, nothing matched, or the row predates this column) — consumers fall back to generic finding text.';

-- ── RECEIPT ──────────────────────────────────────────────────────────────────
-- Expect: one row, column_name = severity_label, data_type = text,
-- is_nullable = YES. Historical rows are all NULL until the next scan writes.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'tenant_monitor_profiles'
  AND column_name = 'severity_label';

SELECT count(*) AS total_rows,
       count(severity_label) AS rows_with_label,
       count(*) FILTER (WHERE severity_matched IS NOT NULL) AS rows_with_band
FROM tenant_monitor_profiles;

-- If the receipt looks right:  COMMIT;
-- If anything looks wrong:     ROLLBACK;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-07-severity-label-on-monitor-profiles-549.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
