-- Git #3938: demote write_action_catalog row 204 (action.submit-file-detonation) off
-- execution_ready. Live-tested against the real testbed tenant via
-- runBaselineTemplateAgainstTenant(): the template's existing endpoint
-- (POST /security/alerts_v2) returned a real 403 insufficient_privilege /
-- "Account is not provisioned" — either Microsoft Defender for Endpoint isn't
-- provisioned/licensed on this tenant, or /security/alerts_v2 doesn't support this
-- write shape. Not confirmed which; needs a real Defender-for-Endpoint-provisioned
-- tenant to resolve, which this repo does not have access to. Until then this action
-- cannot be trusted as execution-ready, so it is demoted to an honest pending status.

UPDATE write_action_catalog
SET
  status = 'endpoint_design_pending',
  blocked_reason = 'Live-tested against the real testbed tenant (c4c814d4-3afe-441e-9145-62461d0a4fd3) via runBaselineTemplateAgainstTenant(): POST /security/alerts_v2 (this template''s existing endpoint) returned a real 403 insufficient_privilege — {"error":{"code":"Unauthorized","message":"Unauthorized request - Account is not provisioned."}}. Not confirmed whether this is a tenant-provisioning gap (Defender for Endpoint not licensed/provisioned on this tenant, same class as #3937''s Entra P1 gap) or whether /security/alerts_v2 genuinely does not support this write shape. Separately open: POST /security/alerts_v2 with only a comment field may create a NEW alert rather than act on an existing suspicious file/URL already flagged by Defender, so the template''s body shape may not match what "submit for detonation" actually needs even once provisioning is resolved. Needs verification against a real Microsoft Defender for Endpoint-provisioned tenant before re-promoting to execution_ready. See Git #3938.',
  snapshot_notes = COALESCE(snapshot_notes || E'\n\n', '') || 'Git #3938 (2026-09-13): demoted from execution_ready — real 403 from testbed tenant, provisioning/endpoint-shape unresolved, needs a real Defender-for-Endpoint-provisioned tenant to verify.'
WHERE id = 204
  AND template_id = 'action.submit-file-detonation';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-13-demote-submit-file-detonation-3938.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
