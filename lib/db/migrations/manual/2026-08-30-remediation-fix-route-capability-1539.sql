-- #1539 — Fix route as a first-class dimension (Remediation Tracking foundation).
--
-- Adds the finding-side fix-route CEILING to remediation_knowledge_base. This is
-- the best shape a check's authored content can reach before a tenant's own
-- write-back consent is applied on top of it (that half resolves at read time in
-- remediation-fix-route.ts — it is deliberately NOT stored per tenant).
--
--   admin_center_only (default) — no authored script; only an admin-centre path.
--   you_must_run                — a script exists (remediation_steps[].code) but
--                                 nothing automates it.
--   we_can_run                  — scriptable AND a config pack maps the check.
--
-- Additive, nullable-with-default, reversible. Safe to re-run (IF NOT EXISTS).

BEGIN;

ALTER TABLE remediation_knowledge_base
  ADD COLUMN IF NOT EXISTS fix_route_capability text NOT NULL DEFAULT 'admin_center_only';

-- Seed existing rows from real content, best shape first so a stronger signal
-- wins. A check that a live config pack maps is scriptable-and-automatable
-- regardless of what its steps look like; a check with any step carrying `code`
-- is at least self-runnable; everything else stays admin-centre-only.
UPDATE remediation_knowledge_base kb
SET fix_route_capability = 'we_can_run'
WHERE EXISTS (
  SELECT 1
  FROM config_pack_templates cpt
  JOIN config_packs cp ON cp.id = cpt.pack_id
  WHERE cpt.check_key = kb.check_key
    AND cpt.template_id IS NOT NULL
    AND cp.status = 'active'
);

UPDATE remediation_knowledge_base kb
SET fix_route_capability = 'you_must_run'
WHERE fix_route_capability = 'admin_center_only'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(kb.remediation_steps) AS step
    WHERE COALESCE(step->>'code', '') <> ''
  );

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-30-remediation-fix-route-capability-1539.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
