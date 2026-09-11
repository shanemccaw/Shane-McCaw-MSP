-- 2026-09-11-drop-legacy-site-analytics-tables-3610.sql
--
-- #3610 — #123 scoped dropping analytics_sessions/analytics_pageviews/
-- analytics_site_events (the homegrown pre-GA4 site-analytics tracker,
-- lib/db/drizzle/0034_site_analytics.sql) but never actually executed the
-- drop. All three tables still exist, still empty.
--
-- Two real blockers surfaced before this could land safely, both now fixed:
--   - #3625: admin-marketing.ts's KPI/analytics/analytics-insights/
--     active-campaign-badges endpoints were still querying these tables live.
--     Repointed to honest 0/empty values pending a GA4-backed rebuild (#3437).
--   - #3644: seed-system-workflows.ts's Engagement Offer Delayed Follow-Up
--     workflow (`get_session_end` sql_query node) still referenced
--     analytics_sessions in a COALESCE fallback leg. Removed; the node now
--     reads engagement_offer_firings.fired_at directly.
--
-- Re-confirmed at the time this file was written: zero rows in all three
-- tables (`SELECT count(*)` = 0 each against local Postgres) and zero
-- INSERT/.insert(...) call sites anywhere in the repo (the ingestion route,
-- routes/analytics.ts, was deleted by #123) — nothing has written to them
-- since, and a repo-wide grep for both the raw table names and their Drizzle
-- export names (analyticsSessionsTable/analyticsPageviewsTable/
-- analyticsSiteEventsTable) now returns zero live call sites, only
-- historical comments. The Drizzle definitions themselves are removed from
-- lib/db/src/schema/index.ts in the same commit as this file.
--
-- Destructive (drops tables) — per CLAUDE.md's Database section this is run
-- by Shane himself, not applied unattended by an agent. Safe to run any time;
-- CASCADE not needed, nothing else references these tables' rows (no FKs in).

BEGIN;

DROP TABLE IF EXISTS analytics_site_events;
DROP TABLE IF EXISTS analytics_pageviews;
DROP TABLE IF EXISTS analytics_sessions;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-11-drop-legacy-site-analytics-tables-3610.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
