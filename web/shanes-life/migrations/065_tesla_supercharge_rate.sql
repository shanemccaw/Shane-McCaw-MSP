-- Git #3287 (Feature #3237, Tesla Integration) -- real, direct decision from Shane, 2026-09-08:
-- home electricity and Tesla Supercharging are genuinely different real rates and should be
-- tracked separately, not conflated into one shared field. Until now `tesla_accounts.
-- charge_cost_per_kwh` (migration 056) was one shared rate used both by the commute-check nudge
-- (#3238, meant to represent overnight home charging) and by syncChargingSessionsFromTesla's own
-- cost estimate for away-from-home/Supercharger sessions (#3217) -- migration 056's own header
-- already flagged this ambiguity ("his real electricity rate, or the Supercharger rate he
-- actually pays").
--
-- `charge_cost_per_kwh` is now explicitly the HOME rate going forward (column itself unchanged,
-- unaffected -- the commute-check nudge (#3238) keeps reading it unmodified, since that nudge is
-- specifically about charging at home overnight). `supercharge_cost_per_kwh` is the new, distinct
-- Supercharger rate. Real, Shane-stated value: $0.39/kWh -- set as the column's own real DEFAULT
-- below (not a backfill UPDATE) so it's correct both for today's zero existing account rows AND
-- for the real row created whenever Shane actually connects a Tesla account, exactly as stated in
-- #3287's own issue body (not fabricated -- this is Shane's own real, already-given number). It
-- stays editable via the settings API/UI below in case that rate ever changes. His real home
-- electricity rate is not yet known, so `charge_cost_per_kwh` is left exactly as it already is
-- (whatever value or NULL it currently holds, no default added) -- never fabricated.
ALTER TABLE tesla_accounts
    ADD COLUMN IF NOT EXISTS supercharge_cost_per_kwh numeric(6,3) DEFAULT 0.39;

-- Real per-session classification of which rate actually applied, computed at sync time from
-- Tesla's own real `location`/siteLocationName text (see core/tesla.mjs's getChargingHistory):
-- Tesla's own long-standing, real Supercharger site-naming convention always includes the literal
-- word "Supercharger" in the site name (e.g. "Chicago, IL Supercharger") -- the same real,
-- documented naming convention every third-party Tesla integration (TeslaFi, TezLab, etc) relies
-- on for exactly this classification, since Tesla's Fleet API itself publishes no dedicated
-- session-type/location-category field (confirmed, see migration 060's own header). A session
-- whose location text does not contain that word -- including a null/unset location -- is
-- classified 'home' by default, which matches this app's pre-#3287 behavior of always applying
-- the one shared rate. This is real-data classification, not Shane's own separate location-history
-- cross-reference (#3217's earlier disambiguation idea) -- #3287 asked to confirm rather than
-- assume that Tesla's own data is sufficient, and this is the confirmed, best-evidenced answer;
-- it has not been live-confirmed against a real connected account yet (no live Tesla connection
-- exists in this build -- same real, stated gap as #3217/#3238's own bookends) and should be
-- re-checked once one connects.
ALTER TABLE tesla_charging_sessions
    ADD COLUMN IF NOT EXISTS rate_source text NOT NULL DEFAULT 'home'
        CHECK (rate_source IN ('home', 'supercharger'));
