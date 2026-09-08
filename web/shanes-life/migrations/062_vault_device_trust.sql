-- Vault room (Git #3272), two real, additive halves:
--
--   1. vault_device_trust -- the 30-day trusted-browser model the README's own "Sep 8 night"
--      pass describes: "one real WebAuthn reveal mints a vault_device_trust token (shape of
--      widget_tokens: handed out once, SHA-256 stored, label, expires_at = 30 days,
--      revoked_at)". Same real shape as migration 046's widget_tokens for the same reason that
--      table copied mcp_tokens' shape (013) -- a high-entropy value handed out once, only its
--      SHA-256 stored, scoped to exactly one user, revocable. The minting/consuming ceremony
--      itself (POST /api/vault/:id/fill, the extension's own popup) is #3276's real scope, not
--      this issue's -- this table is what that work builds on, plus this room's own real
--      "Browser add-on" card, which only ever lists and Forgets what already exists here.
--
--      last_used_at is real (not decorative): the design's own device row shows "last fill
--      yesterday, navyfederal.org", and the fill route (#3276) is what will stamp it.
--
--   2. vault.always_ask -- "forces the existing Face ID reveal path per entry even with a
--      trusted device" (README). Default false, so today's behaviour (Face ID every time, since
--      no device is ever trusted yet) is unchanged; the flag only starts mattering once #3276's
--      fill route checks it. This room already surfaces it: a lock + "always asks" on a login
--      row, flippable by capture ("Navy Federal always asks" / "stop asking for Amazon") or by
--      the row's own Edit form.

CREATE TABLE IF NOT EXISTS vault_device_trust (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   text        NOT NULL UNIQUE,
    label        text        NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    expires_at   timestamptz NOT NULL DEFAULT now() + interval '30 days',
    revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS vault_device_trust_user_idx ON vault_device_trust (user_id, created_at DESC);

ALTER TABLE vault ADD COLUMN IF NOT EXISTS always_ask boolean NOT NULL DEFAULT false;
