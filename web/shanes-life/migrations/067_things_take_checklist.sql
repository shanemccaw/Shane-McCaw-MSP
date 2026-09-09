-- "Next [house] run -- Take" checklist (Git #3300, Feature #3230 Things).
--
-- Both real design sources agree on a section the real implementation has never had: a
-- checklist of things that live at one house (default: Home) but need to ride along on the
-- next real run to another house (the Rental) -- distinct from the "Lives at <house>"
-- location-memory chips `viewThings()` already renders, and distinct from the "Heading Out"
-- list (#3158, `lists`/`list_items`, name = 'heading out') which is the live, Tesla-triggered
-- departure checklist. This is the Things room's own concept: "supplies default to Home; the
-- 'take' list only exists because a run is coming" (Shanes Life 09 - Things.dc.html's own "Why"
-- callout).
--
-- `take_for_house` is the queue: non-null means "take this thing to that house next run."
-- `take_done` is this run's own checked-off state (mirrors list_items.done -- checked, not yet
-- cleared). `quantity` backs the design's "Printer paper x2" / "HVAC filter, 16x25" display.
-- `is_grocery` backs the design's teal "groceries" badge on an item split off a shopping run at
-- capture time (e.g. "Milk, bread for the Rental").
ALTER TABLE things
    ADD COLUMN IF NOT EXISTS take_for_house text,
    ADD COLUMN IF NOT EXISTS take_done      boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS quantity       integer,
    ADD COLUMN IF NOT EXISTS is_grocery     boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS things_take_for_house_idx ON things (user_id, take_for_house) WHERE take_for_house IS NOT NULL;
