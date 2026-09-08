-- Shane's Life -- Wins log automatic triggers (Git #3151).
--
-- The `wins` table itself already exists (017): manual "I did it" captures land there directly.
-- What's missing is a way to detect the three real automatic trigger points the design calls
-- out (Section 3): a debt's real balance hitting $0, a critical debt getting resolved, a
-- deferred (unfunded) bill finally caught up.
--
-- All three are STATE TRANSITIONS in tables this app does not own (ShanesSurvival's own `debts`
-- and `accounts`, kept live by Plaid syncs this app never triggers) -- so "did this just happen"
-- can only be answered by remembering what the state was last time and comparing. This table is
-- that memory: one row per (user, real debt or bill account) recording whether it was resolved
-- the last time anyone checked. A transition from false -> true is what fires a Win; the row is
-- then updated so the same real payoff never fires twice.
--
-- Seeded silently on first sight (no row yet) rather than firing retroactively -- a debt that was
-- ALREADY paid off before this migration ran is not a "just now" win, and guessing otherwise
-- would be exactly the kind of fabricated milestone the design's own "no gamification, real
-- milestones only" rule (Section 3/8) rules out.
CREATE TABLE IF NOT EXISTS money_watch_state (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       text        NOT NULL,                  -- debt | bill
    ref_id     uuid        NOT NULL,                  -- debts.id or accounts.id (ShanesSurvival's own real rows)
    resolved   boolean     NOT NULL DEFAULT false,     -- debt: balance <= 0. bill: shortfall == 0 (funded).
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS money_watch_state_user_kind_ref_key ON money_watch_state (user_id, kind, ref_id);
