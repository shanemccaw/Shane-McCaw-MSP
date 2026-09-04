-- #1922: services.category (and service_type) empty string on id=131
-- ("M365 Launch Control — Plus Add-On"). This row is a recurring add-on
-- layered on top of a Growth/Pro subscription tier, same real kind as
-- ids 176-179 ("Change Control — *"), which already carry
-- category='Add-ons' / service_type='recurring_addon'. Confirmed against
-- shared billing_type='recurring_monthly' and identical "... Add-On(s)"
-- naming pattern. Not part of #1591's Group B/C (project/config_pack) —
-- that fix already covered those; this is an independent, out-of-scope
-- row #1591 filed as this issue.

UPDATE services
SET category = 'Add-ons',
    service_type = 'recurring_addon'
WHERE id = 131
  AND (category IS NULL OR category = '')
  AND (service_type IS NULL OR service_type = '');

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-services-category-backfill-131-1922.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
