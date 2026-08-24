-- Build Sets — an optional named group shared by a stack of related builds
-- (the `--buildSet <name>` build-prompt header flag, alongside --title/--model/
-- --effort). Shane regularly queues 10-20 related builds together, properly
-- blocked by their parents; today every green build tears down and rebuilds ALL
-- four local dev services (Marketing, Portal, Admin Panel, API Server), which
-- causes real memory/resource churn on his dev box. When a build carries a
-- buildSet name, the scripts/dev-server coordinator DEFERS the dev-server restart
-- until every member of the set has merged into the shared checkout, then fires
-- exactly ONE restart+rebuild for the combined changes and runs the combined test
-- pass once. Ungrouped builds (build_set IS NULL) keep the existing per-build
-- coalescing behavior unchanged.
--
-- Nullable, no default — a purely additive column; existing rows and every
-- existing query are unaffected.
ALTER TABLE bt_build_queue ADD COLUMN IF NOT EXISTS build_set text;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-24-build-queue-build-set.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
