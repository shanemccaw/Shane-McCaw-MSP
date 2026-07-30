-- Checkout verification codes — #143 (parent #132), Phase 5 checkout redesign.
--
-- New table backing the 6-digit email verification code shown on the public
-- checkout's redesigned "confirmed" step (self-serve / non-signature purchases
-- only). The code GATES the existing account-setup token flow: on a correct
-- code the server mints a normal account_setup_tokens row and the client
-- proceeds through the unchanged /auth/setup-password endpoint. Only a bcrypt
-- hash of the code is stored (same hashing scheme as user passwords).
--
-- purchase_type drives the 3-wrong-attempts lockout behavior (confirmed with
-- Shane): 'free' → the verification flow locks and the buyer restarts checkout;
-- 'paid' → a fresh code is auto-resent, a paying buyer is never dead-ended.
--
-- Additive: new table only, no existing tables touched.
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).

CREATE TABLE IF NOT EXISTS "checkout_verification_codes" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "code_hash" text NOT NULL,
  "purchase_type" text NOT NULL CHECK ("purchase_type" IN ('free', 'paid')),
  "expires_at" timestamptz NOT NULL,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checkout_verification_codes_user_idx
  ON checkout_verification_codes (user_id);
