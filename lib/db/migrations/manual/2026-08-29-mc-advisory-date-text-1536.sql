-- Git #1536 (part of #1494) — advisory prose date for Message Center posts.
--
-- The horizon buckets are keyed off actionRequiredByDateTime -> endDateTime ->
-- startDateTime -> lastModifiedDateTime (portal-message-center.ts's
-- effectiveDate()). That chain always resolves to SOME date, but the date it
-- resolves to is not always the one a reader actually wants: Microsoft's own
-- "[Rollout Schedule]" section frequently states a specific, readable window
-- ("Rollout begins in mid-October 2026 and is expected to complete by late
-- November 2026") that is more precise than the structural fields carry, and
-- occasionally disagrees with them outright (the structural endDateTime is
-- sometimes a generic outer bound, not the date the prose actually names).
--
-- Per #1536's decision: this prose IS extracted, into this SEPARATE advisory
-- column, and rendered as the prose it came from. It never populates
-- actionRequiredByDateTime, and it never drives bucket placement — doing
-- either would be the same class of failure as synthesising a date outright.
-- See m365-message-center-date-quality.ts's extractAdvisoryDateText(), parsed
-- ONCE per post at sync time, mirroring roadmap_feature_ids' own convention
-- (#1531) of a column populated once by message-center-sync.ts rather than
-- re-parsed on every read.
--
-- Also backs the OTHER half of #1536's decision: an honest "date unclear"
-- first-class bucket for a post that carries neither actionRequiredByDateTime
-- nor endDateTime at all (portal-message-center.ts's hasStructuralDate() /
-- DATE_UNCLEAR sentinel). That column-existence gap is already covered by the
-- struct columns; nothing new is needed in the DB for it. This migration is
-- the advisory-text half only.

ALTER TABLE "msp_message_center_items"
  ADD COLUMN IF NOT EXISTS "advisory_date_text" text;

-- No SQL backfill here on purpose, same reasoning as #1531's own migration:
-- reimplementing extractAdvisoryDateText()'s prose-parsing rules in a second,
-- SQL-only form risks the two silently drifting apart. Rows already synced
-- before this column existed are backfilled by running the ONE real parser —
-- artifacts/api-server/src/lib/m365-message-center-date-quality.ts's own
-- backfillMessageCenterAdvisoryDates() — against already-stored bodyContent
-- (a one-off self-run, or the next daily message-center-sync.ts pass,
-- whichever comes first; either path is idempotent).
--
-- Not urgent to run before deploy: this column touches
-- msp_message_center_items, the table the ALREADY-LIVE daily
-- message-center-sync.ts job writes for every real tenant, so the code that
-- reads/writes it checks for the column's existence first
-- (hasAdvisoryDateTextColumn()) and degrades to "not yet available" rather
-- than throwing — the sync and the portal route both keep working exactly as
-- before until this migration runs, and the column switches on automatically
-- the moment it does.

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-29-mc-advisory-date-text-1536.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
