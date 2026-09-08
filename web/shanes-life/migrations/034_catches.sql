-- Shane's Life -- Catches: real expense-cutting mechanisms (Git #3153).
--
-- Numbered 034, not 033: a concurrent build's 033_wins_watch_state.sql was already applied to
-- the shared local `finances` database when this file was written, even though it had not yet
-- landed on origin/main -- exactly the live, moving-target collision this build's own prompt
-- warned about (checked live via schema_migrations, not assumed from the checked-out tree).
--
-- Real, separate finding while checking that: a `catches` table already existed live in that
-- same shared local database -- (id, user_id, kind, text, detail jsonb, dismissed_at,
-- created_at), 0 rows -- with NO matching migration file anywhere in this repo's git history
-- (checked `git log --all` across every local branch/worktree) and no code anywhere on disk
-- referencing it. The likeliest real explanation is an earlier, uncommitted attempt at this
-- exact issue whose worktree was cleaned up before it ever committed -- worktree cleanup removes
-- the git checkout, not any real database mutation a session made from inside it. Filed as
-- #3177 (see this build's own bookend/issue comment). Dropping and recreating was blocked by
-- this session's own sandboxing, so this migration instead adopts the live column name (`detail`,
-- not `payload`) and ADDs the one real column it was missing, rather than fighting the orphan --
-- there is nothing behind it (0 rows) so this is exactly as safe as a fresh CREATE.
--
-- Design contract Section 4 ("Real expense-cutting mechanisms, confirmed 2026-09-05") names five
-- real catch types: renewal watch, forgotten-money sweep, duplicate-request catch,
-- borrowed-from-bill detection (the parked ShanesSurvival idea, #2886, now real here too via the
-- unified database), and bulk-buy suggestion. The design's own prototype logic class already
-- names the real shape this schema follows almost verbatim: `catches(kind, text, dismissed_at)`
-- (README.md, "Real data model" section) -- this gives it a real table, a real per-user scope
-- (the prototype was single-state, this app is not), and `detail` for whatever numbers a given
-- kind needs to show without re-parsing `text`.
--
-- `dedupe_key` is what stops a real recurring sweep (server.mjs's housekeeping interval, same
-- pattern as Dates' day-before reminders) from re-raising the SAME real fact every six hours: a
-- borrowed-from-bill catch keys on the real transaction id (one real event, one row, forever),
-- a renewal keys on the dates row id, a bulk-buy keys on merchant + the real 30-day bucket it was
-- observed in, a forgotten-money sweep keys on the calendar day it was raised. The unique index
-- is scoped to (user_id, kind, dedupe_key) so a detector can freely re-run and upsert without a
-- read-then-write race, and the app-level upsert (core/catches.mjs) only refreshes `text` while
-- `dismissed_at IS NULL` -- "Got it" on a real catch must not be un-dismissed by the next sweep
-- finding the same real underlying fact still true.

CREATE TABLE IF NOT EXISTS catches (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind         text        NOT NULL,               -- renewal | forgotten_money | duplicate_request
                                                      -- | borrowed_from_bill | bulk_buy
    text         text        NOT NULL,               -- the real, ready-to-read line the Money
                                                      -- screen's Catches card shows verbatim
    detail       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    dedupe_key   text        NOT NULL DEFAULT '',    -- backfilled below for any pre-existing rows;
                                                      -- the NOT NULL constraint (no default) is
                                                      -- applied after the backfill so this stays
                                                      -- idempotent against a table that predates
                                                      -- this column
    dismissed_at timestamptz,                        -- "Got it" -- set once, never auto-cleared
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- A table created by an earlier run of THIS file already has every column with the right
-- default; a table that predates this migration (see header) only needs the one it was missing.
ALTER TABLE catches ADD COLUMN IF NOT EXISTS dedupe_key text;
UPDATE catches SET dedupe_key = id::text WHERE dedupe_key IS NULL;
ALTER TABLE catches ALTER COLUMN dedupe_key SET NOT NULL;
ALTER TABLE catches ALTER COLUMN dedupe_key DROP DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS catches_user_kind_dedupe_key ON catches (user_id, kind, dedupe_key);
CREATE INDEX IF NOT EXISTS catches_user_open_idx ON catches (user_id, created_at DESC) WHERE dismissed_at IS NULL;

-- Duplicate-request catch (Section 4: "If Ronnie and DJ both mention needing something similar
-- without knowing it") needs to know WHO asked for a list_items row -- nothing on this typed
-- shape (migration 016) carried that before now. Free text, not a person_id FK: the same
-- "genuinely open, no fixed enum" principle Section 3 applies to captures applies here -- Claude
-- (or Shane, typing "Ronnie needs paper towels") states a name, it does not select one from a
-- pre-registered People list that may not have a row for a mentioned person yet.
ALTER TABLE list_items ADD COLUMN IF NOT EXISTS requested_by text;
