-- Manual Migration: Visitor identity bridge, Issue #123
-- Target: Postgres database. To be run manually by Shane.
--
-- Retiring the homegrown site-analytics tracker (issue #123) removes
-- routes/analytics.ts and its POST /api/analytics/identify endpoint, which
-- was the only write path for analytics_sessions.identified_email. That
-- column turned out to be load-bearing: public-personalization.ts resolves
-- a visitor's durable smc_sid cookie session to their email through it, to
-- drive both personalization-tier resolution (GET
-- /api/public/personalization/state) and Engagement Offer eligibility
-- (GET /api/public/personalization/engagement-offer). Dropping it outright
-- would have silently broken both (every visitor stuck on "cold" /
-- "not eligible" forever, even right after quiz submission).
--
-- visitor_identities is a minimal, purpose-built replacement — just the
-- sessionId -> email bridge, decoupled from the traffic-tracking columns
-- (entryPage, utm*, deviceType, startedAt, etc.) analytics_sessions also
-- carried. Those traffic-tracking concerns are superseded by GA4; this
-- table is NOT traffic analytics, it is the personalization layer's sole
-- identity mechanism, so it does not get dropped alongside the rest of the
-- retired system. The old analytics_sessions/pageviews/site_events tables
-- are intentionally left undropped for now — see PLATFORM_BUILD.md's #123
-- entry: admin-marketing.ts's dashboard metrics still read them and
-- repointing that is out of this issue's scope.

CREATE TABLE IF NOT EXISTS visitor_identities (
  session_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  identified_at TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-07-29-visitor-identities.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
