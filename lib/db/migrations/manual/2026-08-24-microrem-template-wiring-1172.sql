-- 2026-08-24-microrem-template-wiring-1172.sql
--
-- Git #1172 — persist the remediation-service → microrem-template wiring into
-- the catalog so the DB is self-describing. Writes services.type_attributes.templateId
-- for each of the twelve micro-remediation products that have a real executable
-- baseline_action_template (the `microrem.*` family).
--
-- The application code (lib/remediation-catalog.ts) already resolves these via a
-- declared static fallback map, so this migration is a DURABILITY/consistency
-- step, not a functional prerequisite — nothing breaks if it has not run.
--
-- The service slug → template id relationship is NOT a naming rule (e.g.
-- remediate-enable-ca-policy → microrem.enforce-ca-policy), so each row is set
-- explicitly. The two remaining micro-remediation products
-- (remediate-increase-storage-quota, remediate-release-quarantine) have NO
-- executable template today and are deliberately left with no templateId.
--
-- Reversible: to undo, remove the 'templateId' and 'wiredAt' keys from the
-- affected services.type_attributes. No schema/DDL change; data only.

BEGIN;

UPDATE services s
SET type_attributes =
      COALESCE(s.type_attributes, '{}'::jsonb)
      || jsonb_build_object('templateId', m.template_id, 'wiredAt', '2026-08-24')
FROM (VALUES
  ('remediate-block-file-hash',           'microrem.block-file-hash'),
  ('remediate-deactivate-ownerless-team', 'microrem.deactivate-ownerless-team'),
  ('remediate-enable-mailbox-archive',    'microrem.enable-mailbox-archive'),
  ('remediate-enable-ca-policy',          'microrem.enforce-ca-policy'),
  ('remediate-force-password-reset',      'microrem.force-password-reset'),
  ('remediate-isolate-device',            'microrem.isolate-device'),
  ('remediate-device-compliance-gap',     'microrem.remediate-device-compliance'),
  ('remediate-remove-sharing-link',       'microrem.remove-sharing-link'),
  ('remediate-remove-risky-app-consent',  'microrem.remove-risky-app-consent'),
  ('remediate-remove-stale-group-member', 'microrem.remove-stale-group-member'),
  ('remediate-remove-waste-license',      'microrem.remove-unused-license'),
  ('remediate-revoke-sessions',           'microrem.revoke-sign-in-sessions')
) AS m(slug, template_id)
WHERE s.slug = m.slug
  AND s.category = 'micro_remediation';

-- Also persist services.type_attributes.packKey for the config-pack products
-- that are missing it, so the pack → executable link is data-driven too. Only
-- fills where absent (the five Quick-Start packs already carry it); values match
-- existing config_packs.pack_key rows.
UPDATE services s
SET type_attributes =
      COALESCE(s.type_attributes, '{}'::jsonb)
      || jsonb_build_object('packKey', p.pack_key, 'wiredAt', '2026-08-24')
FROM (VALUES
  ('entra-id-quickstart-v1',                'quickstart-v1'),
  ('onboarding-pack-v1',                    'onboarding-v1'),
  ('offboarding-pack-v1',                   'offboarding-v1'),
  ('security-incident-response-pack-v1',    'security-incident-response-v1'),
  ('compromised-account-recovery-pack-v1',  'compromised-account-recovery-v1'),
  ('baseline-licensing-pack-v1',            'baseline-licensing-v1'),
  ('break-glass-access-pack-v1',            'break-glass-access-v1'),
  ('conditional-access-baseline-pack-v1',   'conditional-access-baseline-v1'),
  ('device-compliance-pack-v1',             'device-compliance-v1'),
  ('email-security-pack-v1',                'email-security-v1'),
  ('identity-hygiene-pack-v1',              'identity-hygiene-v1'),
  ('privileged-access-pack-v1',             'privileged-access-v1')
) AS p(slug, pack_key)
WHERE s.slug = p.slug
  AND s.category = 'config_pack'
  AND (s.type_attributes->>'packKey') IS NULL;

-- Self-marking row so Simulator Studio's Migrations tree (Git #497) reflects DB
-- reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-24-microrem-template-wiring-1172.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
