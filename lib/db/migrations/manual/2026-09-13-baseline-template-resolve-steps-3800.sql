-- #3800 — resolve-then-write: add the `resolve_steps` column to
-- baseline_action_templates.
--
-- WHY. `baseline_action_templates` was a single {endpoint, method, body_template}
-- row with {{var}} substitution only (resolveBaselineTemplateRequest,
-- artifacts/api-server/src/lib/workflow-executor.ts). It had no way to express
-- "look up an id from a filtered read, then use it in the write" — the read-informs-
-- the-next-write half of the same chaining `config_pack_templates.parameter_mapping`
-- already does for a create step's OWN output. That gap blocked every ADMX-based
-- action (groupPolicyConfigurations + definitionValues), KFM included: a
-- definitionValues write needs a definitionId resolved from a live, filtered
-- GET /deviceManagement/groupPolicyDefinitions (discovered in #2039, filed as #3800).
--
-- `resolve_steps` holds an ordered array of BaselineTemplateResolveStep — each a
-- filtered Graph GET whose selected item's field(s) are assigned into the payload,
-- so the endpoint/body can reference them via {{var}}. Steps run in order before the
-- write, each seeing the vars every earlier step assigned. Executed by
-- runBaselineTemplateAgainstTenant → resolveTemplateLookups; a required step that
-- resolves nothing FAILS CLOSED (no write). Empty [] for every existing single-call
-- template, so this is purely additive and changes no current behavior.
--
-- ADDITIVE. New non-null jsonb column with a default; no data rewrite, reversible by
-- DROP COLUMN. Run in-session against the local DATABASE_URL per CLAUDE.md.

BEGIN;

ALTER TABLE baseline_action_templates
  ADD COLUMN IF NOT EXISTS resolve_steps jsonb NOT NULL DEFAULT '[]'::jsonb;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-13-baseline-template-resolve-steps-3800.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
