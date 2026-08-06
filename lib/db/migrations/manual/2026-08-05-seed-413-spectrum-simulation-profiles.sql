-- 2026-08-05-seed-413-spectrum-simulation-profiles.sql
--
-- Git #413 — seeds the three spectrum reference profiles into
-- signal_simulation_profiles so the SAME three tenants verified offline in
-- artifacts/api-server/src/lib/pillar-denominator-spectrum-413.test.ts can be
-- driven through the real Simulator Studio (SimulationProfilesManager.tsx →
-- POST /api/admin/signal-rules/simulation-profiles/:id/run).
--
-- Safe to run: three INSERTs into a tool-only table. No schema change, nothing
-- dropped, no existing row touched. Re-running creates duplicates by design
-- (the table has no natural key) — delete by name first if you want exactly one
-- of each; the DELETE is provided, commented out, at the bottom.
--
-- ── READ THIS BEFORE TRUSTING WHAT THE TOOL SHOWS YOU ────────────────────────
-- POST /simulation-profiles/:id/run does NOT compute any pillar display score.
-- Verified against the route (admin-signal-rules.ts): it returns firedSignals,
-- ruleTrace, includedProjects/excludedProjects and a previous-run diff. There is
-- no computePillarDisplayScore call anywhere in it and no denominator involved,
-- so it CANNOT by itself confirm or refute the #413 denominator fix.
--
-- What it CAN confirm, which is still worth having: that each profile below
-- genuinely fires the signals it is supposed to fire against the live rule
-- corpus. That is the numerator. Pair it with
-- GET /api/admin/signal-rules/customer-pillar-scores/:customerId — which DOES
-- run the real, now package-scoped chain — against the real test tenant to see
-- the denominator half on live data.
--
-- Recommended full loop:
--   1. Run this file.
--   2. Simulator Studio → run each of the three profiles → confirm the fired
--      signal sets differ the way the spectrum expects (bad ≫ middling ≫ none).
--   3. GET /api/admin/signal-rules/customer-pillar-scores/<test tenant's
--      msp_customers.id> and compare against the same call before deploying —
--      that is the fix's real, live before/after.
--
-- ── PROVENANCE of each profile ───────────────────────────────────────────────
-- CONFIRMED on tenant c4c814d4-3afe-441e-9145-62461d0a4fd3 (#413, by Shane):
--   0 Conditional Access policies · 14 Global Administrators ·
--   no break-glass account · EEEU (Everyone Except External Users) sharing.
-- ENTAILED (marked in the row's description, not presented as separate
--   findings): with zero CA policies there can be no CA MFA coverage and no CA
--   legacy-auth block.
-- HAND-AUTHORED: the middling and healthy profiles. They are reference points
--   for the shape of the scale, not observed tenants, and their descriptions say
--   so in the tool's own UI.
--
-- The profile_updates keys are the real merged-profile shape
-- (mergeMonitorProfileRows stamps `<checkKey>__itemCount` per check;
-- bridgeLegacyProfileKeys supplies conditionalAccessPolicyCount;
-- identity:global-admin-count's mapping targetField supplies globalAdminCount).
-- parsed_findings use deriveMonitorFindings' real "<checkKey>: <severity>
-- severity condition matched" string shape.

BEGIN;

-- ── 1. The confirmed-critical real test tenant ───────────────────────────────
INSERT INTO signal_simulation_profiles (name, description, profile_updates, parsed_findings, tags)
VALUES (
  '#413 spectrum — real test tenant c4c814d4 (confirmed critical)',
  'Git #413 reference profile. CONFIRMED real on tenant c4c814d4-3afe-441e-9145-62461d0a4fd3: '
  || '0 Conditional Access policies, 14 Global Administrators, no break-glass account, EEEU sharing. '
  || 'The identity:ca-mfa-coverage and identity:ca-legacy-auth-block entries are ENTAILED by the zero-CA-policy '
  || 'finding (no CA policies means no CA MFA coverage and no CA legacy-auth block), not separate confirmed findings. '
  || 'Six of core:security-baseline''s 29 checks broken.',
  '{
    "conditionalAccessPolicyCount": 0,
    "globalAdminCount": 14,
    "identity:break-glass-health__itemCount": 1,
    "sharepoint:tenant-sharing-capability__itemCount": 1,
    "identity:ca-mfa-coverage__itemCount": 1,
    "identity:ca-legacy-auth-block__itemCount": 1
  }'::jsonb,
  '[
    "identity:ca-policy-count: critical severity condition matched (0 Conditional Access policies)",
    "identity:global-admin-count: critical severity condition matched (14 Global Administrators)",
    "identity:break-glass-health: critical severity condition matched (no break-glass account)",
    "sharepoint:tenant-sharing-capability: critical severity condition matched (Everyone Except External Users sharing)"
  ]'::jsonb,
  '["413", "spectrum", "confirmed-real"]'::jsonb
);

-- ── 2. Middle of the range ───────────────────────────────────────────────────
INSERT INTO signal_simulation_profiles (name, description, profile_updates, parsed_findings, tags)
VALUES (
  '#413 spectrum — middling reference tenant (hand-authored)',
  'Git #413 reference profile. HAND-AUTHORED, not an observed tenant — a reference point for the middle of '
  || 'the scale: real controls in place (6 CA policies, 3 Global Admins) with two genuine warning-level gaps '
  || 'left open. Two of core:security-baseline''s 29 checks broken.',
  '{
    "conditionalAccessPolicyCount": 6,
    "globalAdminCount": 3,
    "identity:stale-accounts__itemCount": 1,
    "devices:os-patch-compliance__itemCount": 1
  }'::jsonb,
  '[
    "identity:stale-accounts: warning severity condition matched",
    "devices:os-patch-compliance: warning severity condition matched"
  ]'::jsonb,
  '["413", "spectrum", "hand-authored"]'::jsonb
);

-- ── 3. The healthy end ───────────────────────────────────────────────────────
INSERT INTO signal_simulation_profiles (name, description, profile_updates, parsed_findings, tags)
VALUES (
  '#413 spectrum — healthy reference tenant (hand-authored)',
  'Git #413 reference profile. HAND-AUTHORED, not an observed tenant — the clean end of the scale: every '
  || 'core:security-baseline check passing, 12 CA policies, 2 Global Admins. Should fire nothing and score 100 '
  || 'on every pillar its package genuinely feeds. Any signal firing against this profile is a rule-direction '
  || 'bug worth chasing (see the severity_rules direction work, #402/#408).',
  '{
    "conditionalAccessPolicyCount": 12,
    "globalAdminCount": 2
  }'::jsonb,
  '[]'::jsonb,
  '["413", "spectrum", "hand-authored"]'::jsonb
);


INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-05-seed-413-spectrum-simulation-profiles.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;

-- Verify what landed:
--   SELECT id, name, jsonb_object_keys(profile_updates) FROM signal_simulation_profiles
--   WHERE tags @> '["413"]'::jsonb ORDER BY id;

-- To remove / re-seed cleanly:
--   DELETE FROM signal_simulation_profiles WHERE tags @> '["413"]'::jsonb;
