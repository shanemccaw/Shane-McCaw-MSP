-- Account/Session Basics — real login-session tracking
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- Adds user_sessions: one row per logical login (password, MFA-completed, or
-- impersonation exchange). Distinct from the existing msp_refresh_tokens table,
-- which tracks the raw rotating refresh-token chain — refresh-token rotation
-- updates current_token_hash on the SAME user_sessions row (see
-- artifacts/api-server/src/lib/session-tracking.ts) so last_active_at reflects
-- the real session lifetime rather than each individual token rotation.
-- Impersonation sessions carry no refresh token, so current_token_hash stays
-- null for those rows.
--
-- Powers: self-service "Active Sessions" + "Login History" in
-- /settings/security, and the team-management "revoke sessions for this
-- employee" action in customer-team.tsx (same table, scoped by user_id).

CREATE TABLE IF NOT EXISTS "user_sessions" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "session_type" text NOT NULL DEFAULT 'standard',
  "login_method" text NOT NULL,
  "current_token_hash" text,
  "impersonated_by_user_id" integer,
  "user_agent" text,
  "ip_address" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_active_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  CONSTRAINT "user_sessions_session_type_check"
    CHECK ("session_type" IN ('standard', 'impersonation')),
  CONSTRAINT "user_sessions_login_method_check"
    CHECK ("login_method" IN ('password', 'totp', 'sms', 'passkey', 'impersonation'))
);

CREATE INDEX IF NOT EXISTS "user_sessions_user_id_idx" ON "user_sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "user_sessions_current_token_hash_idx" ON "user_sessions" ("current_token_hash");
CREATE INDEX IF NOT EXISTS "user_sessions_created_at_idx" ON "user_sessions" ("created_at");
