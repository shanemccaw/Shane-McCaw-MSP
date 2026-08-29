-- Git #1531 (part of #1494) — join roadmap items to Message Center posts on
-- the Microsoft roadmap feature ID.
--
-- Roadmap (m365_roadmap_items, #1530) is the 90-day-and-beyond horizon: what
-- Microsoft intends, global and unauthenticated. Message Center
-- (msp_message_center_items) is the this-week/next-week horizon: it is now
-- landing in a real tenant's feed, with actionRequiredByDateTime. A roadmap
-- item typically precedes its Message Center post by months; the item CROSSES
-- OVER when it lands in a tenant's feed, and that crossing is when the
-- affected-object count stops being hypothetical.
--
-- The join key is the roadmap feature ID, which Message Center posts routinely
-- carry in their own body.content (a "Roadmap ID 124981" line, or a link to
-- microsoft.com/microsoft-365/roadmap carrying the ID). This column persists
-- what m365-roadmap-mc-link.ts's extractRoadmapFeatureIds() finds in a post's
-- body, parsed ONCE by message-center-sync.ts at sync time — never re-parsed
-- per read — mirroring m365_roadmap_items.cloud_instances' own convention of a
-- jsonb array with its GIN index added here rather than in the Drizzle schema.

ALTER TABLE "msp_message_center_items"
  ADD COLUMN IF NOT EXISTS "roadmap_feature_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS "msp_message_center_items_roadmap_feature_ids_gin"
  ON "msp_message_center_items" USING gin ("roadmap_feature_ids");

-- No SQL backfill here on purpose: reimplementing extractRoadmapFeatureIds()'s
-- pattern set in a second, SQL-only regex risks the two silently drifting apart
-- (fix a pattern in the TS parser and this file quietly stays behind). Rows
-- already synced before this column existed are backfilled by running the ONE
-- real parser — artifacts/api-server/src/lib/m365-roadmap-mc-link.ts's own
-- backfillMessageCenterRoadmapLinks() — against already-stored bodyContent
-- (a one-off self-run, or the next daily message-center-sync.ts pass, whichever
-- comes first; either path is idempotent).
--
-- Not urgent to run before deploy: this column touches msp_message_center_items,
-- the table the ALREADY-LIVE daily message-center-sync.ts job writes for every
-- real tenant, so the code that reads/writes it checks for the column's
-- existence first (hasRoadmapFeatureIdsColumn() in m365-roadmap-mc-link.ts) and
-- degrades to "not yet available" rather than throwing — the sync and the
-- #1532 admin candidates route both keep working exactly as before until this
-- migration runs, and the join switches on automatically the moment it does.

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-29-mc-roadmap-feature-link-1531.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
