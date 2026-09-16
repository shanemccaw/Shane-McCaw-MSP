-- #4426 — token→tenant linkage for the MSP onboarding-link flow so a deferred
-- retainer selection can be auto-applied to the RIGHT new customer.
--
-- Purely additive: two new nullable columns, no existing column or behaviour changed.
--
--   1. consent_invite_tokens.onboarding_link_token — the onboarding-link token a
--      consent invite was minted from (only the MSP-onboarding start-consent path
--      sets it). The bridge that makes the write-back below unambiguous rather
--      than an email+mspId guess (#4424's stated wrong-customer risk when two
--      onboarding flows for the same email/MSP overlap).
--
--   2. msp_onboarding_links.resulting_customer_id — the tenants.id the consent
--      callback provisions for that link, written back once admin consent
--      completes. Exposed by GET /api/msp/onboarding/links so MyArchitect can poll
--      for it and then apply the retainer settings against the real customer.
--
-- Both reference tenants.id-space with no FK, matching the deliberate no-FK
-- convention on the sibling columns in these tables (Phase 7 audit).

ALTER TABLE consent_invite_tokens
  ADD COLUMN IF NOT EXISTS onboarding_link_token text;

ALTER TABLE msp_onboarding_links
  ADD COLUMN IF NOT EXISTS resulting_customer_id integer;

-- Self-mark so Simulator Studio's Migrations tree reflects DB reality (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4426-onboarding-token-tenant-linkage.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
