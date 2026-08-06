-- Copilot Assessment quiz catalog -> real DB-backed tables — #271, sub-issue of
-- #258, parent epic #183.
--
-- Problem this fixes (confirmed with Shane on #271): ADAPTIVE_CLUSTERS /
-- ADAPTIVE_PERSONAS / ADAPTIVE_USE_CASES / ADAPTIVE_OUTCOME_PRIORITIES lived as
-- hardcoded objects in msp-portal's quizCatalog.ts. They were shallow (4 entries
-- per industry at every level) and outcomes had NO persona linkage at all, so
-- the chain downstream AI persona generation needs — cluster -> persona ->
-- use cases -> outcomes — was broken at its last hop.
--
-- Shane populates the real content himself by direct SQL (Copilot deep-research
-- output). This issue is infrastructure only: no admin CRUD UI and no JSON
-- import tool were built, confirmed explicitly.
--
-- SHAPE NOTES
--
-- 1. Levels reference each other by KEY, not by id. quiz_personas carries its
--    cluster_key; quiz_use_cases and quiz_outcomes carry their persona_key. This
--    is the same filter-tag pattern the hardcoded catalogs already used
--    (`clusterId` / `personaId` on a tile), and it is deliberate rather than a
--    shortcut around foreign keys:
--      - the wizard fetches one industry's whole catalog once and filters in
--        memory, so selecting a cluster narrows the persona list with no round
--        trip — exactly the behaviour that existed before this change;
--      - Shane's INSERTs stay hand-writable, because a row names its parent with
--        the same readable key he is already typing rather than an id he would
--        have to look up.
--    The cost is that an orphan row (a persona_key naming a persona that does
--    not exist) is possible; the verification queries at the bottom of this file
--    find them, and the read route simply never surfaces an orphan.
--
-- 2. persona_key = '*' means "applies to every persona in this industry".
--    Outcomes are persona-scoped from now on, but the EXISTING outcome content
--    migrated in the companion data file genuinely has no persona linkage — it
--    was industry-scoped. Writing '*' says that honestly instead of duplicating
--    each outcome under every persona, which would falsely claim a specificity
--    the content does not have. The read route maps '*' back to "no linkage", so
--    those rows render under any persona selection — identical to pre-#271
--    behaviour. Shane replaces them with real persona-keyed rows as the real
--    content lands.
--
-- 3. industry = 'default' is a real, expected value, not a placeholder. The read
--    route falls back to it when an industry has no rows of its own, mirroring
--    the wizard's own `ADAPTIVE_X[industry] || ADAPTIVE_X['default']` fallback.
--
-- 4. UNIQUE differs by level on purpose. A persona is unique on
--    (industry, persona_key) WITHOUT the cluster: the persona key is the answer
--    value the wizard stores and every downstream lookup resolves, so the same
--    key under two clusters would make that lookup ambiguous. A use case or
--    outcome, by contrast, includes persona_key in its uniqueness — the same use
--    case legitimately belongs to more than one persona, and the wizard dedupes
--    by key when several selected personas surface it.
--
-- No data is created here. This file only creates the structures; the companion
-- file 2026-07-31-quiz-catalog-migrate-existing-271.sql loads the existing
-- hardcoded content so nothing regresses to an empty quiz.
--
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).

CREATE TABLE IF NOT EXISTS "quiz_persona_clusters" (
  "id" serial PRIMARY KEY,
  "industry" text NOT NULL,
  "cluster_key" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "icon_name" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "quiz_persona_clusters_industry_key_uq" UNIQUE ("industry", "cluster_key")
);

CREATE INDEX IF NOT EXISTS "quiz_persona_clusters_industry_idx"
  ON "quiz_persona_clusters" ("industry");

CREATE TABLE IF NOT EXISTS "quiz_personas" (
  "id" serial PRIMARY KEY,
  "industry" text NOT NULL,
  "cluster_key" text NOT NULL,
  "persona_key" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "icon_name" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "quiz_personas_industry_key_uq" UNIQUE ("industry", "persona_key")
);

CREATE INDEX IF NOT EXISTS "quiz_personas_industry_cluster_idx"
  ON "quiz_personas" ("industry", "cluster_key");

CREATE TABLE IF NOT EXISTS "quiz_use_cases" (
  "id" serial PRIMARY KEY,
  "industry" text NOT NULL,
  "persona_key" text NOT NULL,
  "use_case_key" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "icon_name" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "quiz_use_cases_industry_persona_key_uq" UNIQUE ("industry", "persona_key", "use_case_key")
);

CREATE INDEX IF NOT EXISTS "quiz_use_cases_industry_persona_idx"
  ON "quiz_use_cases" ("industry", "persona_key");

CREATE TABLE IF NOT EXISTS "quiz_outcomes" (
  "id" serial PRIMARY KEY,
  "industry" text NOT NULL,
  "persona_key" text NOT NULL,
  "outcome_key" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "icon_name" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "quiz_outcomes_industry_persona_key_uq" UNIQUE ("industry", "persona_key", "outcome_key")
);

CREATE INDEX IF NOT EXISTS "quiz_outcomes_industry_persona_idx"
  ON "quiz_outcomes" ("industry", "persona_key");

-- ── Verification — run after applying (and again after each content load) ─────
--
-- 1. All four tables exist and are empty on first apply:
-- SELECT 'clusters' AS level, count(*) FROM "quiz_persona_clusters"
-- UNION ALL SELECT 'personas',  count(*) FROM "quiz_personas"
-- UNION ALL SELECT 'use_cases', count(*) FROM "quiz_use_cases"
-- UNION ALL SELECT 'outcomes',  count(*) FROM "quiz_outcomes";
--
-- 2. Orphan check — a persona naming a cluster that does not exist. Expect 0
--    rows. The read route never surfaces an orphan, so a non-zero count here is
--    silently-missing content, not an error anyone would otherwise see:
-- SELECT p.industry, p.persona_key, p.cluster_key
--   FROM "quiz_personas" p
--   LEFT JOIN "quiz_persona_clusters" c
--     ON c.industry = p.industry AND c.cluster_key = p.cluster_key
--  WHERE c.id IS NULL;
--
-- 3. Same for use cases and outcomes, ignoring the '*' industry-wide sentinel.
--    Expect 0 rows from each:
-- SELECT u.industry, u.use_case_key, u.persona_key
--   FROM "quiz_use_cases" u
--   LEFT JOIN "quiz_personas" p
--     ON p.industry = u.industry AND p.persona_key = u.persona_key
--  WHERE u.persona_key <> '*' AND p.id IS NULL;
--
-- SELECT o.industry, o.outcome_key, o.persona_key
--   FROM "quiz_outcomes" o
--   LEFT JOIN "quiz_personas" p
--     ON p.industry = o.industry AND p.persona_key = o.persona_key
--  WHERE o.persona_key <> '*' AND p.id IS NULL;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-07-31-quiz-catalog-tables-271.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
