-- 1911-purge-plaintext-generated-credentials.sql
--
-- Git #1911 (implements the #1900 finding).
--
-- Purges the plaintext break-glass Global Administrator passwords that the
-- config-pack orchestrator left behind in the workflow-run audit trail.
--
-- #1900 reported three rows in `wf_run_node_outputs`. A live sweep of the local
-- database on 2026-08-30 found the plaintext in FOUR places, not one — the
-- existing `redactSensitivePayloadKeys` strips only TOP-LEVEL keys, so every
-- nested copy the engine accumulates under `steps.*` / `nodes.*` survived it:
--
--   wf_runs.payload                  3 rows  (30166, 30171, 30301) — top level
--   wf_run_node_outputs.output       3 rows  (each run's `start` node) — top level
--   wf_run_node_outputs.input        3 rows  — NESTED under steps.start / nodes.*
--   wf_node_output_samples.sample    2 rows  (definition 30656 + 30657, node `start`)
--
-- All three runs are terminally `failed` testbed runs from 2026-08-26 that died
-- before the break-glass gate, so nothing here is resumable and no live secret is
-- being destroyed.
--
-- The redaction is KEY-SCOPED to `generatedPassword` and applied recursively. It
-- deliberately does NOT use a blanket /password|secret/i key match: the same run
-- tables legitimately carry `passwordExpirationDays`,
-- `passwordProtectionPolicyExists`, `passwordValidityPeriodInDays_*` and similar
-- real scan-result fields, and a blanket strip would destroy them.
--
-- The key is replaced with a visible sentinel rather than deleted, so the audit
-- trail records that a redaction happened instead of silently missing a field.
--
-- An UPDATE alone leaves the old tuple in the heap, so the three touched tables
-- are VACUUM FULL'd at the end (outside the transaction) to actually reclaim the
-- pages holding the plaintext. Largest of them is 62 MB — cheap.

BEGIN;

-- Session-scoped recursive redactor. pg_temp is dropped with the session, so this
-- leaves no permanent function behind.
CREATE OR REPLACE FUNCTION pg_temp.redact_json_key(doc jsonb, target text, sentinel text)
RETURNS jsonb AS $fn$
DECLARE
  k text;
  acc jsonb;
BEGIN
  IF doc IS NULL THEN
    RETURN NULL;
  ELSIF jsonb_typeof(doc) = 'object' THEN
    acc := '{}'::jsonb;
    FOR k IN SELECT jsonb_object_keys(doc) LOOP
      IF k = target THEN
        acc := acc || jsonb_build_object(k, to_jsonb(sentinel));
      ELSE
        acc := acc || jsonb_build_object(k, pg_temp.redact_json_key(doc -> k, target, sentinel));
      END IF;
    END LOOP;
    RETURN acc;
  ELSIF jsonb_typeof(doc) = 'array' THEN
    RETURN COALESCE(
      (SELECT jsonb_agg(pg_temp.redact_json_key(e, target, sentinel))
         FROM jsonb_array_elements(doc) e),
      '[]'::jsonb
    );
  ELSE
    RETURN doc;
  END IF;
END;
$fn$ LANGUAGE plpgsql IMMUTABLE;

UPDATE wf_runs
   SET payload = pg_temp.redact_json_key(payload, 'generatedPassword', '[REDACTED:#1911]')
 WHERE payload::text LIKE '%generatedPassword%';

UPDATE wf_run_node_outputs
   SET output = pg_temp.redact_json_key(output, 'generatedPassword', '[REDACTED:#1911]')
 WHERE output::text LIKE '%generatedPassword%';

UPDATE wf_run_node_outputs
   SET input = pg_temp.redact_json_key(input, 'generatedPassword', '[REDACTED:#1911]')
 WHERE input::text LIKE '%generatedPassword%';

UPDATE wf_node_output_samples
   SET sample = pg_temp.redact_json_key(sample, 'generatedPassword', '[REDACTED:#1911]')
 WHERE sample::text LIKE '%generatedPassword%';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('1911-purge-plaintext-generated-credentials.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- Reclaim the heap pages that still hold the pre-UPDATE tuples. Must run outside
-- a transaction block.
VACUUM FULL wf_runs;
VACUUM FULL wf_run_node_outputs;
VACUUM FULL wf_node_output_samples;
