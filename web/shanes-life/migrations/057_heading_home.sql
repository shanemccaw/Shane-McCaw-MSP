-- Real "Heading Home" quick action (Git #3216, Feature #3237): which real house Shane is
-- heading toward, plus real Tesla navigation + climate-preconditioning commands sent from the
-- widget/Next card.
--
-- Real, open question the issue itself raised -- "which home?" -- resolved here as: track which
-- real house Shane was last confirmed away from (a real, observed fact, same "trust stated facts
-- immediately" discipline as things.mjs/store-aisles.mjs), and use that as the recommended
-- default. Never a silent guess with no way to override -- the widget/Next card action always
-- names the resolved house out loud and offers the other one as a real one-tap alternative, so a
-- wrong recommendation costs one extra tap, not a wrong-driveway trip.
--
-- places.house: tags a saved place as one of Shane's own real houses (his own free-text label,
-- same convention things.house/money.mjs's BILL_CATEGORIES already use for "h1"/"h2" -- not a
-- new vocabulary). Nullable: most places (Walmart, NASA) are not a house at all. Set the same
-- way every other place field is -- conversationally, via push_place -- never a form.
ALTER TABLE places ADD COLUMN IF NOT EXISTS house text;

-- presence_state: the one real row per user recording where the foreground app last observed
-- Shane to be. Updated as a side effect of the existing /api/places/nearby check (Git #3159) --
-- no new client-side geolocation call, no background polling (the same "no browser API for
-- that" finding #3159's own migration header already recorded still holds). This is what lets
-- the /widget page -- server-rendered, no client JS, unable to ask for a live position itself --
-- know "away from a house" without ever taking a live GPS read of its own.
CREATE TABLE IF NOT EXISTS presence_state (
    user_id           uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_place_id  uuid REFERENCES places(id) ON DELETE SET NULL,
    current_place_label text,
    current_house     text,        -- places.house of the current place, or NULL if away from both houses (or nowhere matched)
    last_house        text,        -- most recent house Shane was confirmed away from -- the real "which home" recommendation
    last_house_at     timestamptz, -- when that departure was observed
    last_triggered_at timestamptz, -- last real Heading Home command send, for the tap-through's own idempotency window
    updated_at        timestamptz NOT NULL DEFAULT now()
);
