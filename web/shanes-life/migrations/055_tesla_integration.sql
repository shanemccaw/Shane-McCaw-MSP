-- Real Tesla Fleet API integration (Git #3158, Feature #3237): the read-only OAuth connection,
-- encrypted token storage, and the webhook bearer tokens the "Heading Out" checklist's real
-- proactive trigger needs.
--
-- Real, deliberate scope boundary, spelled out in this build's bookend: this is READ access
-- only (`vehicle_device_data` scope -- vehicle list, climate state). Sending a real vehicle
-- command (start preconditioning, unlock) needs Tesla's separate command-signing keypair/
-- protocol and belongs to sibling Features #3216/#3218 under the same Feature-tier parent
-- #3237, not this checklist-trigger issue.
--
-- tesla_accounts: one real OAuth connection per user, same encryption discipline vault.mjs
-- already uses for the password vault (migration 017/052) -- AES-256-GCM, the key OUTSIDE the
-- database (SL_VAULT_KEY, reused here rather than a second key: one key, one rotation story,
-- same reasoning vault.mjs's own header gives for "one vault, one key" applied to a second real
-- secret class). access_token is genuinely optional to keep encrypted at rest (short-lived,
-- refreshed on demand) but stored the same way as refresh_token for one consistent code path
-- rather than a special case for "this one is less sensitive."
CREATE TABLE IF NOT EXISTS tesla_accounts (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tesla_user_id        text,                          -- Tesla's own subject id from the id_token, if present
    access_ciphertext    bytea       NOT NULL,
    access_iv            bytea       NOT NULL,
    access_auth_tag      bytea       NOT NULL,
    refresh_ciphertext   bytea       NOT NULL,
    refresh_iv           bytea       NOT NULL,
    refresh_auth_tag     bytea       NOT NULL,
    key_id               text        NOT NULL DEFAULT 'v1',
    scope                text,
    token_expires_at     timestamptz NOT NULL,
    vehicle_id           text,                          -- Tesla's numeric vehicle id (string: exceeds JS safe-int range)
    vehicle_vin          text,
    vehicle_display_name text,
    connected_at         timestamptz NOT NULL DEFAULT now(),
    last_refreshed_at    timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

-- One real Tesla connection per user -- this app has exactly one real user today, but the
-- constraint is what makes "already connected" a real, queryable fact rather than a convention.
CREATE UNIQUE INDEX IF NOT EXISTS tesla_accounts_user_key ON tesla_accounts (user_id);

-- Real bearer tokens for the inbound /hooks/tesla/:token webhook -- an external trigger (IFTTT,
-- Apple Shortcuts automation, Home Assistant) posts here when it observes real climate
-- preconditioning start. Same real shape as widget_tokens (migration 046): high-entropy value
-- handed out once, only its SHA-256 stored, scoped to one user, revocable -- this app's one
-- established pattern for "a headless client needs its own long-lived credential."
CREATE TABLE IF NOT EXISTS tesla_hook_tokens (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   text        NOT NULL UNIQUE,
    label        text        NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS tesla_hook_tokens_user_idx ON tesla_hook_tokens (user_id, created_at DESC);
