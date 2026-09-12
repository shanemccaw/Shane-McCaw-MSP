-- #2040 — Phase 2 (fan-out from #1925): author the low-risk SSPR-admin write pack
-- for the uncovered identity:sspr-config check.
--
-- WHY. identity:sspr-config reads /policies/authorizationPolicy and its ONLY severity
-- rule (warning) fires when adminSsprAllowed == true — i.e. when tenant administrators
-- are allowed to use Self-Service Password Reset, which the rule's own label calls out
-- as wrong: "sensitive roles should use phishing-resistant authentication only, not
-- SSPR." No template wrote that setting, so the check could never reach we_can_run.
-- This authors the remediation aligned with the check's severity rule: disable admin
-- SSPR.
--
-- DOC-VERIFIED THIS SESSION (2026-09-12), not recalled:
--   authorizationPolicy resource ... https://learn.microsoft.com/en-us/graph/api/resources/authorizationpolicy
--     allowedToUseSSPR (Boolean): "Indicates whether ADMINISTRATORS of the tenant can
--     use the Self-Service Password Reset (SSPR)." — verbatim; it is admin-specific and
--     is NOT deprecated. This exactly matches the check's adminSsprAllowed mapping
--     (monitor_checks.mapping: allowedToUseSspr -> adminSsprAllowed), so the check is
--     correctly grounded and its remediation is to set allowedToUseSSPR = false.
--   Update authorizationPolicy ..... https://learn.microsoft.com/en-us/graph/api/authorizationpolicy-update
--     PATCH /policies/authorizationPolicy -> 204 No Content (Policy.ReadWrite.Authorization).
--   Same endpoint + method + 204 shape as the already-live quickstart-v1.restrict-guest-access
--   template (also a PATCH /policies/authorizationPolicy), which is the proven precedent here.
--
-- RISK. Low, and NOT a lockout risk: disabling admin SSPR does not lock any admin out —
-- it only removes the self-service reset path for privileged accounts (the secure posture
-- the check recommends); admins recover via other administrators or the break-glass
-- account. This is a normal reversible additive write (re-enable by PATCHing true), so
-- unlike the CA family in the sibling migration it is safe to dry-run normally. It is
-- still only AUTHORED here — no apply against any tenant by this build.
--
-- No {{variables}}: the body is a fixed literal, so there is nothing to bind and
-- required_variables is []. reversible=false / reverse_template_id=NULL (no explicit
-- single-step reverse template authored — the documented 6-template reverse count is not
-- inflated; the logical reverse is the same PATCH with true). requires_verification_gate
-- =false (no break-glass secret involved).
--
-- IDEMPOTENT. Template upserts on template_id (DO NOTHING); pack upserts on pack_key;
-- the mapping row inserts only WHERE NOT EXISTS for (pack_id, check_key). A re-run writes
-- nothing. identity:sspr-config exists in monitor_checks (FK satisfied).

BEGIN;

-- ── 1. The write template ────────────────────────────────────────────────────
INSERT INTO baseline_action_templates
  (template_id, label, description, category, endpoint, method, body_template, required_variables, success_criteria, status, reversible, requires_verification_gate)
VALUES
  ('action.disable-admin-sspr',
   'Disable Self-Service Password Reset for Administrators',
   'Sets authorizationPolicy.allowedToUseSSPR to false via PATCH /policies/authorizationPolicy (Policy.ReadWrite.Authorization), so tenant administrators can no longer use Self-Service Password Reset — privileged accounts should rely on phishing-resistant authentication instead. Remediates identity:sspr-config (whose warning fires when admins are allowed to use SSPR). Reversible by PATCHing the same property back to true. Ref: https://learn.microsoft.com/en-us/graph/api/authorizationpolicy-update',
   'security', '/policies/authorizationPolicy', 'PATCH',
   '{"allowedToUseSSPR": false}'::jsonb,
   '[]'::jsonb, '{"expectStatus": 204}'::jsonb, 'active', false, false)
ON CONFLICT (template_id) DO NOTHING;

-- ── 2. The themed pack ───────────────────────────────────────────────────────
INSERT INTO config_packs (pack_key, label, description, categories, status)
VALUES
  ('identity-sspr-admin-v1', 'Administrator SSPR Hardening',
   'Disables Self-Service Password Reset for tenant administrators, so privileged accounts rely on phishing-resistant authentication rather than SSPR.',
   ARRAY['Identity','Security'], 'active')
ON CONFLICT (pack_key) DO NOTHING;

-- ── 3. Bind the template to the check it remediates ──────────────────────────
INSERT INTO config_pack_templates (pack_id, template_id, check_key, sort_order)
SELECT cp.id, 'action.disable-admin-sspr', 'identity:sspr-config', 1
  FROM config_packs cp
 WHERE cp.pack_key = 'identity-sspr-admin-v1'
   AND NOT EXISTS (
     SELECT 1 FROM config_pack_templates x
      WHERE x.pack_id = cp.id AND x.check_key = 'identity:sspr-config'
   );

-- Verification — the pack, its template, and the new we_can_run total.
SELECT cp.pack_key, cpt.sort_order, cpt.template_id, cpt.check_key
  FROM config_pack_templates cpt JOIN config_packs cp ON cp.id = cpt.pack_id
 WHERE cp.pack_key = 'identity-sspr-admin-v1' ORDER BY cpt.sort_order;

SELECT count(DISTINCT cpt.check_key) AS we_can_run_checks
  FROM config_pack_templates cpt JOIN config_packs cp ON cp.id = cpt.pack_id
 WHERE cpt.check_key IS NOT NULL AND cpt.template_id IS NOT NULL AND cp.status = 'active';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-12-identity-sspr-admin-hardening-write-pack-2040.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
