-- Shane's Life -- People & Patterns: a private per-person reflection journal (Git #3157,
-- design contract Section 7).
--
-- Real, explicit boundary from the contract, quoted directly: NOT a companion or chatbot
-- persona. A private journal capturing Shane's own words about people in his life
-- (family/household members), threaded under the right person. The patterns read back
-- (src/core/people.mjs's computePatterns) are deliberately dumb -- word counts and timing over
-- Shane's own words, quoted back verbatim. No summary sentences, no opinions, no AI call
-- (Section 10: the hosted app does no inference of its own -- this is plain deterministic code).
--
-- Two typed tables, per the real decision recorded on #3116: rooms use their own typed tables
-- (lists/list_items, things, contacts, ...), not the generic entities/entity_items pair.
--
-- "Threaded under the relevant person automatically based on who's mentioned" (Section 7) is a
-- Claude-conversation classification step, same architecture as everything else in this app
-- (Section 10) -- Claude reads a pending capture (list_captures), recognises who it's about, and
-- calls the log_person_note MCP tool with that person's name. This table layer just needs a
-- stable, forgiving way to resolve a name to the same person every time; see people_user_name_key
-- below.

CREATE TABLE IF NOT EXISTS people (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         text        NOT NULL,
    relationship text,                                   -- optional, free text -- "property manager", "Mom"
    archived_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One person per (user, lower(name)) -- a later note about "Dana" threads onto the same real
-- person row, it never silently creates a second "Dana" next to her.
CREATE UNIQUE INDEX IF NOT EXISTS people_user_name_key ON people (user_id, lower(name));

CREATE TABLE IF NOT EXISTS person_entries (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    person_id   uuid        NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    body_text   text        NOT NULL,
    kind        text        NOT NULL DEFAULT 'text',      -- text | voice | photo -- same vocabulary captures.kind uses
    source      text        NOT NULL DEFAULT 'shane',      -- shane (typed straight into this room) | claude (threaded from the one-box capture)
    capture_id  uuid REFERENCES captures(id) ON DELETE SET NULL, -- set when this arrived via the one-box capture + Claude classification
    happened_at timestamptz NOT NULL DEFAULT now(),        -- when Shane says it happened -- defaults to now, backdatable like wins.happened_on
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS person_entries_person_idx ON person_entries (person_id, happened_at DESC);
CREATE INDEX IF NOT EXISTS person_entries_user_idx   ON person_entries (user_id, happened_at DESC);
