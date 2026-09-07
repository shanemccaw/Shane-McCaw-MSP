-- Shane's Life -- foundation schema (Git #3087, repointed onto the shared database by #3107).
--
-- WHERE THIS RUNS
-- ---------------
-- Against the SAME real Postgres database the ShanesSurvival WPF app already uses, on top of
-- its real migrations 001-012 -- not a database of its own. Design handoff README, "Data model
-- additions": "extending ShanesSurvival migrations 001-012", and contract Section 1's first
-- locked decision: one app, one login, one Postgres.
--
-- 013 is the next free number after ShanesSurvival's 012_transaction_tags.sql. The number space
-- is now SHARED across two directories -- desktop/ShanesSurvival/migrations/ and this one --
-- so the next free number must be checked against BOTH before naming a new file. Both runners
-- write the same real schema_migrations(filename, applied_at) ledger and each only ever executes
-- files from its own directory, so neither can run the other's.
--
-- Nothing in here touches, renames or reshapes any of ShanesSurvival's own 12 tables. Every name
-- below was checked against the live database first and none of them collide.
--
-- Design rules this schema exists to honour, straight out of
-- Design/design_handoff_shanes_life/ (README + contract.md):
--
--   * Section 3 "extensibility principle" -- the capture box is genuinely open. Claude must be
--     able to invent a sensible NEW category on the fly ("mom is coming to visit the 12th-18th")
--     without a developer shipping a feature first. So category is a real registry TABLE of
--     free-form slugs, NOT a Postgres enum, and every entity carries an open data jsonb
--     payload alongside its typed columns.
--   * Section 3 "single entry point" -- everything enters through captures, whatever the
--     medium (text / voice / photo) and whatever the source (web UI, MCP, a share link).
--   * Section 9 / handoff "Auth and sharing" -- PASSKEYS (WebAuthn) for the app. There is no
--     password column here on purpose: the design specifies passkey-only sign-in with no
--     password screen, and #3107 replaced the scrypt columns #3087 shipped.
--   * Section 10 -- the hosted app never calls a paid AI API at runtime. Classification arrives
--     from a Claude conversation via MCP and is STORED here; nothing in this schema implies
--     server-side inference.

-- Same shape ShanesSurvival's own MigrationRunner.cs creates, so whichever of the two runs
-- first on a fresh database produces a ledger the other can read and write.
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Real accounts + real server-side sessions
-- ---------------------------------------------------------------------------

-- No password columns. Sign-in is a WebAuthn assertion against webauthn_credentials below.
CREATE TABLE IF NOT EXISTS users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text        NOT NULL,
    name          text        NOT NULL,
    is_active     boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz
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
    ip           text,
    -- The credential this session was actually signed in with. The vault (migration 017) needs
    -- a FRESH assertion per reveal, and "fresh" is measured against this session's last one.
    credential_id     text,
    last_verified_at  timestamptz
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id, expires_at DESC);

-- ---------------------------------------------------------------------------
-- WebAuthn (passkeys) -- the ONLY way into this app
-- ---------------------------------------------------------------------------

-- One row per registered authenticator. public_key is the COSE key exactly as the authenticator
-- returned it; the server re-derives a verifying key from it on every assertion. Nothing secret
-- lives here -- a public key is public, which is the entire point of choosing passkeys over a
-- password hash for an app that guards real financial reference data.
CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id text        NOT NULL UNIQUE,          -- base64url, as sent by the browser
    public_key    bytea       NOT NULL,                 -- raw COSE_Key
    sign_count    bigint      NOT NULL DEFAULT 0,
    transports    text[]      NOT NULL DEFAULT '{}',
    aaguid        text,
    label         text        NOT NULL DEFAULT 'Passkey',
    backed_up     boolean     NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_used_at  timestamptz,
    revoked_at    timestamptz
);

CREATE INDEX IF NOT EXISTS webauthn_credentials_user_idx ON webauthn_credentials (user_id, created_at DESC);

-- Server-issued challenges. A WebAuthn challenge is single-use and short-lived; keeping it in
-- the database rather than in memory means a restart mid-sign-in fails closed instead of
-- accepting a replayed one, and it is the same store both processes would read if this ever
-- runs as more than one.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
    challenge  text PRIMARY KEY,                        -- base64url
    purpose    text        NOT NULL,                    -- registration | authentication | vault
    user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS webauthn_challenges_expiry_idx ON webauthn_challenges (expires_at);

-- Enrolling the FIRST passkey is the one thing a passkey-only app cannot do with a passkey.
-- A single-use, short-lived, out-of-band token (minted by `npm run enroll-passkey` at a real
-- terminal on this machine) is what bootstraps it -- and the same mechanism adds a new laptop.
-- Only the SHA-256 is stored, exactly like every other bearer secret in this app.
CREATE TABLE IF NOT EXISTS webauthn_enrollments (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text        NOT NULL UNIQUE,
    label      text        NOT NULL DEFAULT 'Passkey',
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    credential_id text
);

CREATE INDEX IF NOT EXISTS webauthn_enrollments_user_idx ON webauthn_enrollments (user_id, created_at DESC);

-- Real record of every authentication outcome -- the audit trail behind the sign-in rate limiter.
CREATE TABLE IF NOT EXISTS auth_events (
    id         bigserial PRIMARY KEY,
    at         timestamptz NOT NULL DEFAULT now(),
    email      text,
    user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
    event      text        NOT NULL,   -- login_ok | login_bad_assertion | login_unknown_credential
                                       -- login_inactive | login_throttled | logout
                                       -- passkey_registered | passkey_revoked | enroll_bad_token
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
    lead_days   integer,                                  -- handoff: new_category(name, icon, lead_days)
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

-- category / routed_to / build_requested are the handoff's own captures() columns. category is
-- FREE TEXT here on purpose -- Claude's read of a capture is recorded before any category row
-- necessarily exists, so this one deliberately does NOT reference categories(slug).
CREATE TABLE IF NOT EXISTS captures (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind            text        NOT NULL DEFAULT 'text',   -- text | voice | photo
    body_text       text,
    media_id        uuid REFERENCES media(id) ON DELETE SET NULL,
    source          text        NOT NULL DEFAULT 'web',    -- web | mcp | share
    status          text        NOT NULL DEFAULT 'pending',-- pending | classified | dismissed
    category        text,                                  -- Claude's read; free text, not an enum
    routed_to       text,                                  -- which room it landed in
    build_requested boolean     NOT NULL DEFAULT false,    -- "Scope a build" -> Review's teal badge
    entity_id       uuid,                                  -- FK added after entities exists
    classified_at   timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS captures_user_status_idx ON captures (user_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Entities -- one generic shape for every kind of thing (Section 3)
-- ---------------------------------------------------------------------------

-- A capture Claude files under a category nobody coded for lands here: same row shape whatever
-- it is. The TYPED rooms the design draws (dates, pets, lists, things, ... in migrations 014-018)
-- have real tables of their own; this is the open tail that lets a brand-new kind of thing exist
-- on the day Claude invents it, with no schema change and no developer.
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
