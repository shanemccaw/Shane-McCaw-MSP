-- ============================================================================
-- #339 — Full item detail collection: table + its own monitoring package
-- ============================================================================
-- WHY THIS EXISTS
--   monitor-executor.ts genuinely computes the FULL item list across all pages
--   for every check (that is how the count/score is derived at all), but only
--   returns it when the caller passes `includeItems: true`. The real scoring
--   scan does not pass it, so the complete list is computed and then discarded —
--   deliberately, to keep no extra memory on the hot path. Meanwhile
--   tenant_monitor_profiles.raw_response stores only the FIRST page (five rows
--   for a CSV usage report) by design, so it is not a usable source either.
--   Remediation documents promise to list ALL affected items, not a sample.
--
-- THE SHAPE, per the issue's FINAL decision (comment 5160077230):
--   The existing scoring scan is NOT changed. A separate, real monitoring
--   package runs the same checks with includeItems: true, in PARALLEL with the
--   scoring scan, and persists the complete item lists here. By the time a
--   remediation document or a War Room per-item dialog needs full detail, it is
--   already collected rather than fetched reactively at the point of need.
--
-- Idempotent: IF NOT EXISTS / ON CONFLICT DO NOTHING throughout. Safe to re-run.
-- Nothing here alters monitor_checks, tenant_monitor_profiles, or the
-- core:security-baseline package.
-- ============================================================================

-- ── 1. The full-item-list table ─────────────────────────────────────────────
-- Mirrors lib/db/src/schema/msp.ts :: tenantCheckItemDetailsTable.
--
-- THE TRUNCATION RULE (load-bearing, same rule simulator_check_runs follows):
-- a row holds the COMPLETE item list or none of it and says why in
-- items_omitted_reason. A silent prefix would make a remediation document
-- confidently under-report affected items — the exact failure this table exists
-- to prevent — so `items` is NULL whenever the payload could not be stored whole.
CREATE TABLE IF NOT EXISTS "tenant_check_item_details" (
  "id"                    serial PRIMARY KEY,
  "detail_id"             uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  -- Groups every check row produced by ONE detail-collection run.
  "run_id"                uuid NOT NULL,
  "tenant_id"             text NOT NULL,
  -- tenants.id when known; nullable for the same pre-customer / orphaned-run
  -- case msp_diagnostic_runs already tolerates.
  "customer_id"           integer,
  "check_key"             text NOT NULL,
  "check_schema_version"  integer NOT NULL DEFAULT 1,
  -- Snapshotted so a later package edit cannot rewrite what this run covered.
  "package_key"           text NOT NULL,
  -- The executor triggerId this collection used. Deliberately its OWN value and
  -- never the scoring run's: the executor idempotency key is
  -- "{tenant_id}:{check_key}:{trigger_id}", so sharing a trigger_id with the
  -- scoring scan would hand back that run's cached, item-less result instead of
  -- performing a real fetch.
  "trigger_id"            text NOT NULL,
  -- The tenant_monitor_profiles row this same collection wrote, for traceability.
  "profile_id"            uuid,
  -- Same vocabulary as tenant_monitor_profiles.status (no CHECK constraint
  -- there either): ok | error | consent_revoked | requires_script |
  -- license_gap | partial. A detail collection runs the same real checks
  -- through the same executor, so it lands in exactly the same states.
  "status"                text NOT NULL DEFAULT 'ok',
  "item_count"            integer NOT NULL DEFAULT 0,
  "page_count"            integer NOT NULL DEFAULT 0,
  -- The FULL fetched item list, or NULL when omitted (see items_omitted).
  "items"                 jsonb,
  "items_omitted"         boolean NOT NULL DEFAULT false,
  "items_omitted_reason"  text,
  "error_message"         text,
  "collected_at"          timestamptz NOT NULL DEFAULT now(),
  "created_at"            timestamptz NOT NULL DEFAULT now()
);

-- One row per check per detail run — the collector upserts on this.
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_check_item_details_run_check_idx"
  ON "tenant_check_item_details" ("run_id", "check_key");
-- The primary read: "the most recent complete item list for this check on this
-- tenant" — what a remediation document or a War Room per-item dialog asks for.
CREATE INDEX IF NOT EXISTS "tenant_check_item_details_tenant_check_collected_idx"
  ON "tenant_check_item_details" ("tenant_id", "check_key", "collected_at");
CREATE INDEX IF NOT EXISTS "tenant_check_item_details_tenant_idx"
  ON "tenant_check_item_details" ("tenant_id");
CREATE INDEX IF NOT EXISTS "tenant_check_item_details_run_idx"
  ON "tenant_check_item_details" ("run_id");

-- ── 2. The detail-collection monitoring package ─────────────────────────────
-- A real monitoring_packages row, per the issue's final decision — NOT a
-- background enhancement bolted onto the scoring run. It is its own entry in
-- the package/check system so the room and document generation can query
-- "what did the detail collection cover" independently of a scan's scoring.
--
-- engines = [] ON PURPOSE. `engines` is "which engine scores to recompute after
-- a run"; this package must never contribute to or re-trigger scoring, which is
-- the whole point of separating it from core:security-baseline.
--
-- platform_cost_cents = 0: this is platform infrastructure feeding document
-- completeness, not a sellable monitoring tier.
INSERT INTO monitoring_packages (key, label, description, engines, status, platform_cost_cents)
VALUES (
  'detail:full-item-collection',
  'Full Item Detail Collection',
  'Collects the COMPLETE per-check item list (includeItems) for every active check and persists it to tenant_check_item_details. Runs in parallel with the scoring scan and never contributes to scoring — it exists so remediation documents and War Room per-item dialogs can list every affected item rather than a sample.',
  '[]'::jsonb,
  'active',
  0
)
ON CONFLICT (key) DO NOTHING;

-- ── 3. Link the covered checks ──────────────────────────────────────────────
-- SCOPE DECISION — every ACTIVE check in the catalog, not a curated subset.
--   core:security-baseline is deliberately a curated entry-tier subset (29 of
--   the ~133 checks; see 2026-07-21-repopulate-monitoring-package-checks.sql).
--   That curation is right for a first-look scoring product and wrong here:
--   remediation documents promise to list all affected items across EVERY
--   finding category, so a curated detail package would reintroduce exactly the
--   incompleteness this issue exists to close.
--
--   Populated by INSERT..SELECT from monitor_checks rather than a hardcoded key
--   list, so it is genuinely "all active checks" as of the day this is run and
--   cannot silently disagree with the catalog.
--
--   >>> SHANE: if you want this narrowed (cost/adoption checks whose item lists
--       no document ever cites, PowerShell-executor checks that need the
--       customer-side runner, or very-large-item-count checks), delete rows from
--       monitoring_package_checks for this package key — the collector reads the
--       junction at run time, so pruning takes effect with no code change:
--         DELETE FROM monitoring_package_checks
--          WHERE package_key = 'detail:full-item-collection'
--            AND check_key IN (...);
--   <<<
--
-- sort_order = alphabetical by key, purely so the run order is deterministic
-- and reproducible; nothing reads it as a priority.
INSERT INTO monitoring_package_checks (package_key, check_key, sort_order)
SELECT
  'detail:full-item-collection',
  mc.key,
  (row_number() OVER (ORDER BY mc.key))::int - 1
FROM monitor_checks mc
WHERE mc.status = 'active'
ON CONFLICT (package_key, check_key) DO NOTHING;

-- ── 4. Verify (read-only) ───────────────────────────────────────────────────
-- Expect: one package row, and a linked-check count equal to the active-check
-- count. If they disagree, checks were added/activated after this ran — re-run
-- section 3, it is idempotent.
SELECT
  (SELECT count(*) FROM monitoring_packages       WHERE key = 'detail:full-item-collection')          AS package_rows,
  (SELECT count(*) FROM monitoring_package_checks WHERE package_key = 'detail:full-item-collection')  AS linked_checks,
  (SELECT count(*) FROM monitor_checks            WHERE status = 'active')                            AS active_checks;
