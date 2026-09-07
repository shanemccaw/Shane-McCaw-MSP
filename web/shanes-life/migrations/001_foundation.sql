-- Shane's Life -- real foundation schema (Git #3087).
--
-- Design rules this schema exists to honour, straight out of
-- desktop/ShanesSurvival/docs/shanes-life-design-contract-pack.md:
--
--   * Section 3 "extensibility principle" -- the capture box is genuinely open. Claude must be
--     able to invent a sensible NEW category on the fly ("mom is coming to visit the 12th-18th")
--     without a developer shipping a feature first. So category is a real registry TABLE of
--     free-form slugs, NOT a Postgres enum, and every entity carries an open data jsonb
--     payload alongside its typed columns.
--   * Section 3 "single entry point" -- everything enters through captures, whatever the
--     medium (text / voice / photo) and whatever the source (web UI, MCP, a share link).
--   * Section 9 -- real auth, plus shareable links that need NO login.
--   * Section 10 -- the hosted app never calls a paid AI API at runtime. Classification arrives
--     from a Claude conversation via MCP and is STORED here; nothing in this schema implies
--     server-side inference.

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    ran_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Real accounts + real server-side sessions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email           text        NOT NULL,
    name            text        NOT NULL,
    -- scrypt (Node built-in crypto). Real per-user salt; no shared pepper stored in the row.
    password_hash   text        NOT NULL,
    password_salt   text        NOT NULL,
    password_params text        NOT NULL,
    is_active       boolean     NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_login_at   timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));

-- Opaque server-side sessions. The cookie carries a random token; only its SHA-256 is stored,
-- so a database read never yields a usable session credential.
CREATE TABLE IF NOT EXISTS sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   text        NOT NULL UNIQUE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz,
    user_agent   text,
    ip           text
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id, expires_at DESC);

-- Real record of every authentication outcome -- the audit trail behind the login rate limiter.
CREATE TABLE IF NOT EXISTS auth_events (
    id         bigserial PRIMARY KEY,
    at         timestamptz NOT NULL DEFAULT now(),
    email      text,
    user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
    event      text        NOT NULL,   -- login_ok | login_bad_password | login_unknown_user
                                       -- login_inactive | login_throttled | logout
    ip         text,
    user_agent text
);

CREATE INDEX IF NOT EXISTS auth_events_at_idx ON auth_events (at DESC);

-- ---------------------------------------------------------------------------
-- Categories -- an OPEN registry, deliberately not an enum (Section 3)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS categories (
    slug        text PRIMARY KEY,
    label       text        NOT NULL,
    item_noun   text        NOT NULL DEFAULT 'item',
    icon        text        NOT NULL DEFAULT 'sparkles',  -- lucide-style name; UI falls back
    color       text        NOT NULL DEFAULT 'slate',
    description text,
    created_by  text        NOT NULL DEFAULT 'claude',    -- claude | shane | system
    created_at  timestamptz NOT NULL DEFAULT now(),
    use_count   integer     NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Captures -- the single entry point for everything (Section 3)
-- ---------------------------------------------------------------------------

-- Attachments live in Postgres, not on disk: Replit's filesystem is ephemeral across
-- redeploys, and a photo of an after-visit summary is exactly the thing that must survive one.
CREATE TABLE IF NOT EXISTS media (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mime_type     text        NOT NULL,
    byte_size     integer     NOT NULL,
    sha256        text        NOT NULL,
    original_name text,
    bytes         bytea       NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS media_user_idx ON media (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS captures (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind          text        NOT NULL DEFAULT 'text',   -- text | voice | photo
    body_text     text,
    media_id      uuid REFERENCES media(id) ON DELETE SET NULL,
    source        text        NOT NULL DEFAULT 'web',    -- web | mcp | share
    status        text        NOT NULL DEFAULT 'pending',-- pending | classified | dismissed
    entity_id     uuid,                                  -- FK added after entities exists
    classified_at timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS captures_user_status_idx ON captures (user_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Entities -- one generic shape for every kind of thing (Section 3)
-- ---------------------------------------------------------------------------

-- A shopping list, an appointment, a birthday, "mom is visiting the 12th-18th", a movie to
-- watch -- all the same row shape. What differs is category (open) and data (open jsonb).
-- Shopping Lists, the next Feature, is a consumer of this table, not a new table.
CREATE TABLE IF NOT EXISTS entities (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category    text        NOT NULL REFERENCES categories(slug),
    title       text        NOT NULL,
    body        text,
    status      text        NOT NULL DEFAULT 'open',   -- open | done | archived (free-form tolerant)
    occurs_at   timestamptz,                            -- when the thing happens, if it happens
    remind_at   timestamptz,                            -- when it should surface (lead time lives here)
    data        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    capture_id  uuid REFERENCES captures(id) ON DELETE SET NULL,
    source      text        NOT NULL DEFAULT 'web',     -- web | mcp
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS entities_user_idx     ON entities (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS entities_category_idx ON entities (user_id, category, created_at DESC);
CREATE INDEX IF NOT EXISTS entities_remind_idx   ON entities (user_id, remind_at) WHERE remind_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS entities_data_idx     ON entities USING gin (data);

ALTER TABLE captures DROP CONSTRAINT IF EXISTS captures_entity_id_fkey;
ALTER TABLE captures
    ADD CONSTRAINT captures_entity_id_fkey
    FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE SET NULL;

-- Child rows: list items, checklist entries, per-appointment notes. Generic on purpose.
CREATE TABLE IF NOT EXISTS entity_items (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id  uuid        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    position   integer     NOT NULL DEFAULT 0,
    text       text        NOT NULL,
    note       text,
    checked_at timestamptz,
    checked_by text,                                    -- owner | share:<label> -- who ticked it
    data       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    media_id   uuid REFERENCES media(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS entity_items_entity_idx ON entity_items (entity_id, position, created_at);

-- ---------------------------------------------------------------------------
-- Share links -- the mixed access model (Section 9)
-- ---------------------------------------------------------------------------

-- A capability URL. Only the SHA-256 of the token is stored, exactly like a session, so the
-- database never holds a working link. can_check is the whole point of the mixed model:
-- handing someone a shopping list they can tick off without ever creating an account.
CREATE TABLE IF NOT EXISTS share_links (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_id    uuid        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    token_hash   text        NOT NULL UNIQUE,
    label        text,
    can_check    boolean     NOT NULL DEFAULT true,
    expires_at   timestamptz,
    revoked_at   timestamptz,
    view_count   integer     NOT NULL DEFAULT 0,
    last_seen_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS share_links_entity_idx ON share_links (entity_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- MCP access + audit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mcp_tokens (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   text        NOT NULL UNIQUE,
    label        text        NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    revoked_at   timestamptz,
    call_count   integer     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS mcp_tokens_user_idx ON mcp_tokens (user_id, created_at DESC);

-- Every write that did not come from a logged-in browser session is recorded. MCP is a real
-- write plane reachable from any Claude conversation; it gets a real audit trail from day one.
CREATE TABLE IF NOT EXISTS activity_log (
    id          bigserial PRIMARY KEY,
    at          timestamptz NOT NULL DEFAULT now(),
    user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
    actor       text        NOT NULL,   -- web | mcp | share
    actor_label text,                   -- MCP token label, or share link label
    action      text        NOT NULL,   -- e.g. entity.create, entity.item.check, share.create
    entity_id   uuid,
    detail      jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS activity_log_at_idx      ON activity_log (at DESC);
CREATE INDEX IF NOT EXISTS activity_log_user_at_idx ON activity_log (user_id, at DESC);

-- ---------------------------------------------------------------------------
-- Seed: the two categories the foundation itself uses.
-- These are real structural rows, not sample content -- no entities, no items, no fake data.
-- Every other category gets created on the fly by Claude, which is the entire point.
-- ---------------------------------------------------------------------------

INSERT INTO categories (slug, label, item_noun, icon, color, description, created_by)
VALUES
  ('note', 'Note', 'line', 'sticky-note', 'slate',
   'A plain captured thought that has not been classified into anything more specific yet.',
   'system'),
  ('list', 'List', 'item', 'list-checks', 'sky',
   'A generic checklist. Shopping Lists build on this shape rather than a table of their own.',
   'system')
ON CONFLICT (slug) DO NOTHING;
