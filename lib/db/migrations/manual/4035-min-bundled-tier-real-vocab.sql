-- Git #4035 — write_action_catalog.min_bundled_tier held the placeholder
-- basic/enhanced/premium vocabulary while services.tier (the real, live
-- Monitoring tier a customer actually purchases) has always been
-- foundation/growth/premier. Shane's decision: rename the code to match the
-- real database vocabulary, not the other way around. This is the data half
-- of that rename — msp-launch-control.ts's MONITORING_TIER_RANK was renamed
-- in the same commit.
--
-- 1:1 by rank position, confirmed against real catalog rows before writing
-- this file: 'basic' rows are low-risk field edits (update display name,
-- department, job title...), 'enhanced' rows are create/reset/bulk actions
-- (create user, reset MFA, bulk CSV import...), 'premium' rows are
-- destructive/high-risk actions (delete user, remote wipe, PIM role
-- assignment...) — exactly the foundation/growth/premier ordering.

UPDATE write_action_catalog SET min_bundled_tier = 'foundation' WHERE min_bundled_tier = 'basic';
UPDATE write_action_catalog SET min_bundled_tier = 'growth'     WHERE min_bundled_tier = 'enhanced';
UPDATE write_action_catalog SET min_bundled_tier = 'premier'    WHERE min_bundled_tier = 'premium';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4035-min-bundled-tier-real-vocab.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
