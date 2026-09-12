-- #2037 — Phase 2 fan-out from #1925: author write packs for the App Governance
-- (appgov:*) slice. Same "map first, author second" discipline #1925 established.
--
-- LIVE STATE BEFORE THIS MIGRATION (local PostgreSQL 18, shanemccawmsp):
--   9 appgov:* checks exist in monitor_checks. None carry a check_key anywhere in
--   config_pack_templates. Two of the nine (dormant-service-principals,
--   workload-identity-risk) are directly remediable by an ALREADY-EXECUTION-READY
--   template that exists in baseline_action_templates but was never bound to any
--   pack or check_key:
--     action.disable-risky-app          PATCH /servicePrincipals/{{spId}} {accountEnabled:false}
--     microrem.remove-risky-app-consent DELETE /oauth2PermissionGrants/{{grantId}}
--   Per the #1925 Phase-1 rule ("a template that writes the setting a check reads
--   is that check's remediation" — map it, don't duplicate it), this migration BINDS
--   those two existing rows rather than re-authoring them.
--
-- MICROSOFT DOCS FETCHED THIS SESSION (2026-09-12), not recalled — exact shapes taken
-- verbatim from these pages:
--   Update servicePrincipal (accountEnabled)  https://learn.microsoft.com/en-us/graph/api/serviceprincipal-update
--        PATCH /servicePrincipals/{id}  body {"accountEnabled": false}  -> 204  (Application.ReadWrite.All)
--   Delete oAuth2PermissionGrant               https://learn.microsoft.com/en-us/graph/api/oauth2permissiongrant-delete
--        DELETE /oauth2PermissionGrants/{id}  -> 204  (DelegatedPermissionGrant.ReadWrite.All)
--   Delete application                         https://learn.microsoft.com/en-us/graph/api/application-delete
--        DELETE /applications/{id}  -> 204  (Application.ReadWrite.All). Soft-deletes to a
--        recoverable container for 30 days — confirmed on this same page ("apps are moved to
--        a temporary container and can be restored within 30 days").
--   Restore deleted item (directory object)    https://learn.microsoft.com/en-us/graph/api/directory-deleteditems-restore
--        POST /directory/deletedItems/{id}/restore  -> 200  (Application.ReadWrite.All for an
--        application). This is the real, explicit single-step reverse for the delete above.
--
-- RESEARCHED AND DELIBERATELY NOT AUTOMATED — appgov:cert-secret-expiration. The issue body
-- flagged this "likely admin_center_only"; verified why against real docs this session:
--   application: removePassword  https://learn.microsoft.com/en-us/graph/api/application-removepassword
--        POST /applications/{id}/removePassword {keyId}  -> 204  (Application.ReadWrite.All).
--        Real, safe, no proof requirement — removing an ALREADY-EXPIRED secret cannot break
--        anything live.
--   application: removeKey       https://learn.microsoft.com/en-us/graph/api/application-removekey
--        POST /applications/{id}/removeKey {keyId, proof}  -> 204. The **proof** field is a
--        JWT that "must be signed with a private key that corresponds to one of the existing
--        valid certificates associated with the application" — a key the platform does not
--        hold and cannot generate on the tenant's behalf. Certificate removal is therefore
--        structurally not automatable by this platform, full stop.
-- The check's own severity fires on `expiredPasswordCredentialCount > 0 || expiredKeyCredentialCount
-- > 0` — one combined finding for both credential kinds. A template that only clears the
-- password half would let the platform claim "fixed" on a finding still expired on its
-- certificate half. Left check_key NULL rather than mis-map; not authoring removePassword/
-- removeKey templates here since neither would be bound to anything in this pack.
--
-- ALSO DELIBERATELY LEFT NULL — appgov:consent-policy-status, appgov:enterprise-app-count,
-- appgov:enterprise-app-registration-list. Each carries `severity_rules = '[]'::jsonb` (verified
-- live, all three) — no expression in any of them ever evaluates to a warning/critical finding,
-- so there is no misconfigured state for a we_can_run fix to remediate. Same "leave NULL where
-- there's genuinely nothing to map" discipline #1925 Phase 1 used, not force-fitting a write pack
-- onto a check with no failure mode.
--
-- DISTINCT TEMPLATE IDS. Both disable-service-principal checks (dormant, risky) remediate by
-- the identical PATCH-accountEnabled write, and both revoke-consent checks (risky-permission-
-- grants, unreviewed-consents) remediate by the identical DELETE-grant write — same shape #1925
-- hit with public-groups/public-teams visibility. getStepId() keys the pack graph on template_id;
-- a duplicate template_id inside one pack breaks the topological sort (#1484). Each check
-- therefore gets its own template_id row: the two pre-existing templates are reused as-is for
-- one check apiece, and a new sibling template_id is authored for the other.
--
-- reversible=false / reverse_template_id=NULL on the two reused templates (unchanged — this
-- migration does not modify their existing rows beyond check_key) and on the two newly-authored
-- disable/revoke siblings, for the same reason #1925 gave: no explicit single-step reverse is
-- authored here, so the historical reversible-template count is not inflated by a sibling of an
-- already-irreversible action. action.delete-stale-app-registration is the one genuine exception
-- — Graph's own deletedItems/restore endpoint IS a real, documented, single-step reverse, so it
-- gets reversible=true + reverse_template_id, following the exact "only where a real reverse
-- genuinely exists" rule #1925 set. requires_verification_gate=true on it, matching this table's
-- existing convention for every other directory-object DELETE (action.delete-group,
-- action.delete-user, action.delete-ca-policy, action.unenroll-device all carry it).
--
-- IDEMPOTENT. New templates upsert on their unique template_id (DO NOTHING); the pack upserts
-- on its unique pack_key; all five check_key mapping rows (two on pre-existing templates, three
-- on new ones) insert/update only where not already correctly set. A re-run writes nothing new.
-- Additive; reversible by setting the five check_key columns back to NULL and deleting the two
-- new rows this migration inserts into baseline_action_templates. All five target check_keys
-- exist in monitor_checks (FK satisfied, verified live before writing this file).

BEGIN;

-- ── 1. The three new write templates (the two reused ones already exist) ─────
INSERT INTO baseline_action_templates
  (template_id, label, description, category, endpoint, method, body_template, required_variables, success_criteria, status, reversible, reverse_template_id, requires_verification_gate)
VALUES
  ('action.disable-dormant-service-principal',
   'Disable Dormant Service Principal',
   'Disables a service principal with zero app role assignments (nothing provisioned to use it) via PATCH /servicePrincipals/{id} (Application.ReadWrite.All), so it can no longer authenticate while it is investigated/decommissioned. Remediates appgov:dormant-service-principals. Sibling of the pre-existing action.disable-risky-app (kept as its own template_id per the duplicate-template_id-in-pack rule, #1484). Ref: https://learn.microsoft.com/en-us/graph/api/serviceprincipal-update',
   'security', '/servicePrincipals/{{spId}}', 'PATCH',
   '{"accountEnabled": false}'::jsonb,
   '["spId"]'::jsonb, '{"expectStatus": 204}'::jsonb, 'active', false, NULL, false),

  ('action.revoke-unreviewed-consent-grant',
   'Revoke Unreviewed Consent Grant',
   'Revokes a self-consented (consentType Principal, no administrator review) OAuth2 permission grant via DELETE /oauth2PermissionGrants/{id} (DelegatedPermissionGrant.ReadWrite.All). Remediates appgov:unreviewed-consents. Sibling of the pre-existing microrem.remove-risky-app-consent (kept as its own template_id per the duplicate-template_id-in-pack rule, #1484). Ref: https://learn.microsoft.com/en-us/graph/api/oauth2permissiongrant-delete',
   'security', '/oauth2PermissionGrants/{{grantId}}', 'DELETE',
   '{}'::jsonb,
   '["grantId"]'::jsonb, '{"expectStatus": 204}'::jsonb, 'active', false, NULL, false),

  ('action.delete-stale-app-registration',
   'Delete Stale App Registration',
   'Deletes an app registration older than the tenant''s aging threshold via DELETE /applications/{id} (Application.ReadWrite.All). Graph soft-deletes to a recoverable container for 30 days. Remediates appgov:stale-app-registrations. Ref: https://learn.microsoft.com/en-us/graph/api/application-delete',
   'security', '/applications/{{appId}}', 'DELETE',
   '{}'::jsonb,
   '["appId"]'::jsonb, '{"expectStatus": 204}'::jsonb, 'active', true, 'action.restore-deleted-application', true),

  ('action.restore-deleted-application',
   'Restore Deleted App Registration',
   'Restores a soft-deleted application object within its 30-day recovery window via POST /directory/deletedItems/{id}/restore (Application.ReadWrite.All). The real, explicit single-step reverse for action.delete-stale-app-registration. Ref: https://learn.microsoft.com/en-us/graph/api/directory-deleteditems-restore',
   'security', '/directory/deletedItems/{{appId}}/restore', 'POST',
   '{}'::jsonb,
   '["appId"]'::jsonb, '{"expectStatus": 200}'::jsonb, 'active', false, NULL, false)
ON CONFLICT (template_id) DO NOTHING;

-- ── 2. The themed pack ───────────────────────────────────────────────────────
INSERT INTO config_packs (pack_key, label, description, categories, status)
VALUES
  ('app-governance-v1', 'App Governance Baseline',
   'Hardens Microsoft Entra app governance: disables dormant and risk-flagged service principals, revokes risky and unreviewed OAuth2 consent grants, and removes stale app registrations.',
   ARRAY['Governance','Security'], 'active')
ON CONFLICT (pack_key) DO NOTHING;

-- ── 3. Bind each template to the check it remediates ─────────────────────────
-- (covers both the two pre-existing reused templates and the three newly-authored ones)
INSERT INTO config_pack_templates (pack_id, template_id, check_key, sort_order)
SELECT cp.id, v.template_id, v.check_key, v.sort_order
  FROM config_packs cp
  CROSS JOIN (VALUES
    ('action.disable-risky-app',                   'appgov:workload-identity-risk',      1),
    ('action.disable-dormant-service-principal',   'appgov:dormant-service-principals',  2),
    ('microrem.remove-risky-app-consent',          'appgov:risky-permission-grants',     3),
    ('action.revoke-unreviewed-consent-grant',     'appgov:unreviewed-consents',         4),
    ('action.delete-stale-app-registration',       'appgov:stale-app-registrations',     5)
  ) AS v(template_id, check_key, sort_order)
 WHERE cp.pack_key = 'app-governance-v1'
   AND NOT EXISTS (
     SELECT 1 FROM config_pack_templates x
      WHERE x.pack_id = cp.id AND x.check_key = v.check_key
   );

-- Verification — the pack, its five templates, and the new we_can_run total.
SELECT cp.pack_key, cpt.sort_order, cpt.template_id, cpt.check_key
  FROM config_pack_templates cpt JOIN config_packs cp ON cp.id = cpt.pack_id
 WHERE cp.pack_key = 'app-governance-v1' ORDER BY cpt.sort_order;

SELECT count(DISTINCT cpt.check_key) AS we_can_run_checks
  FROM config_pack_templates cpt JOIN config_packs cp ON cp.id = cpt.pack_id
 WHERE cpt.check_key IS NOT NULL AND cpt.template_id IS NOT NULL AND cp.status = 'active';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-12-app-governance-write-pack-2037.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
