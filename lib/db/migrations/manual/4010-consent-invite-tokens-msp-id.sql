-- #4010 — MSP-issued onboarding links bridge into the consent-invite mechanism.
-- Additive: a nullable msp_id on consent_invite_tokens. Null keeps every
-- existing token's behavior (new customer objects attach to the
-- isDirectBusiness MSP); when set, GET /api/consent/callback creates the
-- tenants row under this MSP and runs the cross-MSP tenant conflict guard
-- against it.

BEGIN;

ALTER TABLE consent_invite_tokens ADD COLUMN IF NOT EXISTS msp_id integer;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4010-consent-invite-tokens-msp-id.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
