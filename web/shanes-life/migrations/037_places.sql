-- Real physical places + geo-tagged captures (Git #3159 -- "Location-aware content
-- surfacing").
--
-- Real investigation finding, recorded in full at
-- web/shanes-life/docs/location-aware-content-surfacing-findings.md: automatic, ambient
-- background geofencing ("the app knows I just walked into Walmart without me touching it")
-- is NOT buildable in a Home Screen web app -- neither iOS nor Android exposes background
-- geolocation/geofencing to browser JS, and the W3C Geofencing API draft was never
-- implemented by any browser. What IS real and buildable today is FOREGROUND, on-demand:
-- Shane opens the app (or it's already open) and the app checks real current position against
-- real saved places. This migration is the real data model for that -- honest about what it
-- is, and reusable without a schema change if a future native wrapper adds real background
-- geofencing on top of the same rows.
--
-- No forms, anywhere, ever (contract pack Section 3, confirmed 2026-09-08): a place is never
-- created through a dedicated "add place" form. It is captured the same way everything else in
-- this app is -- Shane types "remember this as Home" (or similar) into the one real universal
-- capture box while he is actually standing there, the browser's OWN native permission prompt
-- (not an in-app form) supplies the real current coordinates, and Claude reads the geo-tagged
-- capture over MCP and calls push_place. That is why `captures` grows latitude/longitude here
-- too, not just `places` -- the capture is the one real entry point; `places` is just what
-- Claude files from it.

ALTER TABLE captures
    ADD COLUMN IF NOT EXISTS latitude  double precision,
    ADD COLUMN IF NOT EXISTS longitude double precision;

CREATE TABLE IF NOT EXISTS places (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label         text        NOT NULL,                 -- Shane's own words: "Home", "Walmart", "NASA" -- open, not an enum (Section 3's extensibility principle)
    latitude      double precision NOT NULL,
    longitude     double precision NOT NULL,
    radius_meters integer     NOT NULL DEFAULT 150,      -- how close counts as "there" -- real GPS drift means a house-sized radius under-matches
    note          text,                                  -- what to surface there, in Shane's own words (e.g. "grab the shopping list")
    created_by    text        NOT NULL DEFAULT 'claude', -- shane | claude -- almost always claude (push_place, from a geo-tagged capture)
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Saying "remember this as Home" again re-centers the same real place rather than leaving a
-- stale duplicate -- same upsert-on-name pattern things/store_aisles already use, same reason.
CREATE UNIQUE INDEX IF NOT EXISTS places_user_label_key ON places (user_id, lower(label));
