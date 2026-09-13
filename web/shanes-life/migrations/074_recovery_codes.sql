-- Real account-recovery codes (Git #3246).
--
-- #3246 documented a genuine gap: this app is passkey-only with no password anywhere, and until
-- now the ONLY way back in if the sole enrolled passkey is lost was `npm run enroll-passkey` --
-- a real, working path, but one that needs a terminal and DATABASE_URL on the host. Shane's own
-- resolution, recorded on the issue: (1) one-time recovery codes, minted at real account setup
-- (or retroactively for an existing account), delivered by email, typed in to regain access; and
-- (2) if a second passkey is registered, ordinary sign-in with it already covers recovery -- nothing
-- to add there.
--
-- Ten single-use codes per account. Hashed exactly like every other bearer secret in this app
-- (src/auth/tokens.mjs's fingerprint discipline) -- only the SHA-256 of the normalised code is
-- ever written, same as webauthn_enrollments.token_hash. Redeeming one invalidates AND
-- regenerates the whole set (src/core/recovery-codes.mjs), not just the one used -- standard
-- recovery-code hygiene, and the reason there is no "used codes" bookkeeping beyond used_at: a
-- redemption throws the entire batch away and mints a fresh one.

CREATE TABLE IF NOT EXISTS recovery_codes (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  text        NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    used_at    timestamptz
);

CREATE INDEX IF NOT EXISTS recovery_codes_user_idx ON recovery_codes (user_id, created_at DESC);
