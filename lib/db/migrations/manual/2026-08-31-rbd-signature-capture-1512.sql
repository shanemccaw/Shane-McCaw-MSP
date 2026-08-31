-- #1512 — Risk Register: signed RBD document render and signature capture.
--
-- Additive only. Extends #1508's msp_rbd_versions (done — see
-- 2026-08-30-rbd-document-versioning-1508.sql) with the two fields genuinely
-- missing from SOW-flow signature parity, and points msp_report_runs at RBD
-- versions rather than building a second render/storage table.
--
-- msp_rbd_versions already carries signed_by (jsonb: name/title/email/
-- signed_at/ip_address/signature_hash) and signed_at from #1508 — that
-- already covers signerName/signedAt/signedIp. What's missing versus
-- msp_sows' real signature capture:
--   * signature_data  — the actual drawn signature (base64 PNG), not just a
--                        tamper-evidence hash of it
--   * share_token(+expiry) — unauthenticated review/sign link, same
--                        mechanism msp_sows already uses
--
-- msp_report_runs gets one new nullable, unconstrained column (rbd_version_uid)
-- so a "risk_decision_document" run can be looked up by the version it
-- rendered — no FK, same convention as its existing customer_id column, so a
-- version's own lifecycle can never be blocked by a report run referencing it.

BEGIN;

ALTER TABLE msp_rbd_versions
  ADD COLUMN IF NOT EXISTS signature_data text,
  ADD COLUMN IF NOT EXISTS share_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS share_token_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS msp_rbd_versions_share_token_idx ON msp_rbd_versions (share_token);

COMMENT ON COLUMN msp_rbd_versions.signature_data IS
  'Base64 PNG data-URL of the drawn signature (#1512). Same shape as '
  'msp_sows.signature_data. Null until signed.';
COMMENT ON COLUMN msp_rbd_versions.share_token IS
  'Unauthenticated review/sign link token (#1512), same mechanism as '
  'msp_sows.share_token. Null until an MSP operator generates one.';

ALTER TABLE msp_report_runs
  ADD COLUMN IF NOT EXISTS rbd_version_uid uuid;

CREATE INDEX IF NOT EXISTS msp_report_runs_rbd_version_uid_idx ON msp_report_runs (rbd_version_uid);

COMMENT ON COLUMN msp_report_runs.rbd_version_uid IS
  'Set only for doc_type = ''risk_decision_document'' runs (#1512): the '
  'msp_rbd_versions.version_uid this run rendered. No FK by design, same as '
  'customer_id above.';

SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'msp_rbd_versions'
   AND column_name IN ('signature_data', 'share_token', 'share_token_expires_at')
 ORDER BY ordinal_position;

SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'msp_report_runs'
   AND column_name = 'rbd_version_uid';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-rbd-signature-capture-1512.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
