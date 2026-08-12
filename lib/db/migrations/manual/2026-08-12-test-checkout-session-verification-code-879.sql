-- Git #879 (Epic #803): fixed test-manifest fixture for
-- test-manifests/437-verification-code-flow.json.
--
-- The manifest exercises POST /api/public/flow/send-verification-code and
-- POST /api/public/flow/verify-code. Both routes only ever act on a
-- checkout_sessions row that is already status='paid' (resolvePaidSession in
-- public-assessment-account.ts) -- there is no dev/test bypass route for that
-- transition (only two code paths ever write status='paid', and both require
-- a real completed Stripe PaymentIntent: public-assessment-payment.ts and
-- portal-assessment.ts). Per this repo's rule against live DB writes from a
-- Claude Code session, this seeds that one fixture row directly instead.
--
-- BEFORE RUNNING: replace <TEST_MAILBOX_UPN> below with the exact same
-- mailbox UPN/address already configured as GRAPH_TEST_MAILBOX_ID for #878's
-- graphTests Mail.Read poll -- the verification email has to land in the
-- same inbox the manifest's graphTests step polls, or the mail-poll step
-- will time out with no match.
--
-- Idempotent / re-runnable: ON CONFLICT resets status/email/expiry so the
-- fixture is always paid and non-expired no matter how many manifest runs
-- (or partial runs) happened since it was last seeded. Uses a fixed id so
-- the manifest can reference it as a literal sessionId (this manifest
-- framework's apiTests/graphTests are static JSON -- there's no "create a
-- session" step to chain from).

INSERT INTO checkout_sessions (
  id, product_slug, full_name, email, company, seats, status, expires_at
) VALUES (
  '43700000-0000-4000-8000-000000000001',
  'copilot-readiness-assessment',
  'Regression Test Buyer',
  '<TEST_MAILBOX_UPN>',
  'Test Manifest Fixtures',
  1,
  'paid',
  now() + interval '10 years'
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  status = 'paid',
  expires_at = now() + interval '10 years',
  updated_at = now();

-- Clear out any leftover verification-code rows from a prior manual test run
-- so a fresh manifest run always starts from a clean slate (send-verification-
-- code itself only deletes UNverified rows, and would otherwise leave a
-- stale already-verified row sitting alongside the new one).
DELETE FROM checkout_email_verifications
WHERE session_id = '43700000-0000-4000-8000-000000000001';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-12-test-checkout-session-verification-code-879.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
