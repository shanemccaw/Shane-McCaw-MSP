-- Composite index on (lead_id, event_type) so dedup lookups stay fast as the table grows.
-- The site_visit dedup check filters by both columns on every qualifying pageview;
-- without this index Postgres falls back to a sequential scan.
CREATE INDEX IF NOT EXISTS lead_intent_events_lead_event_idx
  ON lead_intent_events (lead_id, event_type);
