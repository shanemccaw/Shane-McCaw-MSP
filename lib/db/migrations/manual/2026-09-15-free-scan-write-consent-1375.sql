-- 2026-09-15-free-scan-write-consent-1375.sql — Git #1375 (Phase of Feature #1352)
--
-- The Free Scan Remediate step's write-consent decision, recorded on the
-- Prospect's own engagement row.
--
-- Additive and reversible: three nullable columns, no default, no backfill, no
-- constraint on existing rows. The authoritative write grant is unchanged and
-- still lives in `tenants.consent.writeBack`, written only by the
-- Microsoft-verified callback in routes/consent.ts — these columns record what
-- happened at THIS step, which that key cannot express (a decline never reaches
-- Microsoft at all, and a "sent to the consent screen but never came back" is
-- otherwise indistinguishable from "never started").

ALTER TABLE free_scan_engagements
  ADD COLUMN IF NOT EXISTS write_consent_decision   text,
  ADD COLUMN IF NOT EXISTS write_consent_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS write_consent_scopes     jsonb;

-- The three real values the Drizzle enum declares. Named so a later reader can
-- see the vocabulary in the database itself rather than only in TypeScript.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'free_scan_engagements_write_consent_decision_check'
  ) THEN
    ALTER TABLE free_scan_engagements
      ADD CONSTRAINT free_scan_engagements_write_consent_decision_check
      CHECK (write_consent_decision IS NULL
             OR write_consent_decision IN ('requested', 'granted', 'declined'));
  END IF;
END $$;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-15-free-scan-write-consent-1375.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
