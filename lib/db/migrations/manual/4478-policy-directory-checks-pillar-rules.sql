-- #4478 — 24 policy:*/directory:* checks resolve to no pillar in pillarForCheckKey
-- (artifacts/api-server/src/lib/pillar-summary-stats.ts:319), because
-- PILLAR_CHECK_DOMAINS is keyed by prefix ("policy"/"directory" aren't in it),
-- and a blanket prefix mapping can't be correct anyway — directory:* alone
-- spans licensing, governance, security and health checks. Real
-- signal_derivation_rules rows give pillarForCheckKey's rules-map path
-- (buildCheckKeyPillarMap) per-check precision instead.
--
-- All impact/weight columns are left at their neutral defaults (0) — this
-- migration's only job is real pillar attribution for the War Room cards,
-- not calibrating new scoring weights, which is a separate product decision
-- these rows deliberately don't make.

-- No unique constraint exists on source_key/signal_key, so idempotency is
-- enforced with an explicit NOT EXISTS guard per row rather than ON CONFLICT.
INSERT INTO signal_derivation_rules
  (signal_key, rule_type, source_key, pillar, category, description)
SELECT v.signal_key, v.rule_type, v.source_key, v.pillar, v.category, v.description
FROM (VALUES
  -- policy:* — mostly identity/auth security policy (per #4478's own note)
  ('signal.policy.activity-based-timeout',            'threshold', 'policy:activity-based-timeout',            'security',   'policy', 'Idle session sign-out policy'),
  ('signal.policy.admin-consent-workflow',             'threshold', 'policy:admin-consent-workflow',             'security',   'policy', 'Admin consent workflow for app permission requests'),
  ('signal.policy.app-management-policies',            'threshold', 'policy:app-management-policies',            'security',   'policy', 'App registration/management restriction policies'),
  ('signal.policy.authentication-flows',               'threshold', 'policy:authentication-flows',               'security',   'policy', 'Authentication flow policy (e.g. device code, self-service)'),
  ('signal.policy.authentication-methods-policy',      'threshold', 'policy:authentication-methods-policy',      'security',   'policy', 'Authentication methods policy / legacy per-user MFA migration state'),
  ('signal.policy.authentication-strength-policies',   'threshold', 'policy:authentication-strength-policies',   'security',   'policy', 'Conditional access authentication strength policies'),
  ('signal.policy.claims-mapping-policies',            'threshold', 'policy:claims-mapping-policies',            'security',   'policy', 'Token claims mapping policies'),
  ('signal.policy.cross-tenant-access-default',        'threshold', 'policy:cross-tenant-access-default',        'security',   'policy', 'Default cross-tenant B2B access policy'),
  ('signal.policy.cross-tenant-identity-sync-template', 'threshold', 'policy:cross-tenant-identity-sync-template', 'security',  'policy', 'Cross-tenant identity synchronization policy template'),
  ('signal.policy.cross-tenant-m365-capabilities',     'threshold', 'policy:cross-tenant-m365-capabilities',     'security',   'policy', 'Cross-tenant Microsoft 365 app/service capability policy'),
  ('signal.policy.cross-tenant-partners',              'threshold', 'policy:cross-tenant-partners',              'security',   'policy', 'Per-partner cross-tenant access policy overrides'),
  ('signal.policy.default-app-management-policy',      'threshold', 'policy:default-app-management-policy',      'security',   'policy', 'Tenant-wide default app management policy'),
  ('signal.policy.external-identities-policy',         'threshold', 'policy:external-identities-policy',         'security',   'policy', 'External identities (B2B/B2C) collaboration policy'),
  ('signal.policy.home-realm-discovery',               'threshold', 'policy:home-realm-discovery',               'security',   'policy', 'Home realm discovery policy for federated sign-in routing'),
  ('signal.policy.security-defaults',                  'threshold', 'policy:security-defaults',                  'security',   'policy', 'Azure AD security defaults enablement'),
  ('signal.policy.terms-of-use-agreements',            'threshold', 'policy:terms-of-use-agreements',            'compliance', 'policy', 'Terms of Use agreement acceptance tracking'),
  ('signal.policy.token-issuance-policies',            'threshold', 'policy:token-issuance-policies',            'security',   'policy', 'Token issuance policy'),
  ('signal.policy.token-lifetime-policies',            'threshold', 'policy:token-lifetime-policies',            'security',   'policy', 'Token lifetime policy'),
  -- directory:* — judged per-check, not by prefix (per #4478's own note)
  ('signal.directory.cloud-licensing-allotment-exhausted',       'threshold', 'directory:cloud-licensing-allotment-exhausted',       'licensing',  'directory', 'A licensing SKU pool is fully consumed'),
  ('signal.directory.cloud-licensing-assignment-disabled-plans', 'threshold', 'directory:cloud-licensing-assignment-disabled-plans', 'licensing',  'directory', 'License assignments carrying disabled service plans'),
  ('signal.directory.cloud-licensing-assignment-errors',         'threshold', 'directory:cloud-licensing-assignment-errors',         'licensing',  'directory', 'License assignment errors on user accounts'),
  ('signal.directory.org-contact-provisioning-errors',           'threshold', 'directory:org-contact-provisioning-errors',           'governance', 'directory', 'Mail-enabled organizational contact provisioning errors'),
  ('signal.directory.partner-delegated-admin-relationships',     'threshold', 'directory:partner-delegated-admin-relationships',     'security',   'directory', 'Granular Delegated Admin Privileges (GDAP) partner relationships'),
  -- 'architecture' is deliberate, not a typo: signal_derivation_rules.pillar
  -- stores the ENGINE pillar name, and ENGINE_PILLAR_FOR_DISPLAY_PILLAR maps
  -- the display pillar "health" to the engine pillar "architecture" (the only
  -- one of the seven where display and engine names differ) — storing 'health'
  -- here would round-trip through pillarForRulePillar to nothing.
  ('signal.directory.service-health-active-incidents',           'threshold', 'directory:service-health-active-incidents',           'architecture', 'directory', 'Active Microsoft 365 service health incidents')
) AS v(signal_key, rule_type, source_key, pillar, category, description)
WHERE NOT EXISTS (
  SELECT 1 FROM signal_derivation_rules existing WHERE existing.source_key = v.source_key
);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4478-policy-directory-checks-pillar-rules.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
