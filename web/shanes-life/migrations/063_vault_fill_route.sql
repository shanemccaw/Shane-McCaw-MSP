-- Vault Autofill add-on's 30-day trusted-device model (Git #3276), the real route half of what
-- migration 062 (Git #3272) built the table for. That migration's own comment says it plainly:
-- "Minting/consuming the ceremony itself (POST /api/vault/:id/fill, the extension's own popup)
-- is #3276's real scope, not this issue's." This is that scope, two real additive columns:
--
--   1. vault_reveals.via -- so a reveal audit row can say HOW it happened. Every reveal before
--      this migration ran through the real per-entry WebAuthn ceremony (credential_id NOT NULL
--      in practice, even though the column itself was never constrained that way); those all
--      backfill to 'owner'. A reveal driven by POST /api/vault/:id/fill authenticates with a
--      vault_device_trust bearer token instead of a fresh assertion, and writes 'extension-
--      trusted' -- the design's own literal words ("writes vault_reveals with via =
--      'extension-trusted'").
--
--   2. vault_reveals.device_trust_id -- which real trusted browser authorised a trusted fill,
--      so the audit trail says WHICH device, not just that it wasn't a fresh assertion.
--      credential_id stays nullable for exactly this row shape: a trusted-device fill has no
--      credential_id of its own, because no assertion ran for it. ON DELETE SET NULL rather
--      than CASCADE -- Forgetting a device revokes it (062's forgetDevice), it never deletes
--      the row, so this never actually fires from that path; it exists only so a hypothetical
--      future hard-delete of a trust row can't take a real audit row down with it.
--
--   3. vault_device_trust.last_used_site -- the Vault room's own Browser add-on card (062,
--      app.js deviceTrustRow) already renders "last fill {ago}" off last_used_at; the design's
--      own device row goes one further ("last fill yesterday, navyfederal.org"), and that needs
--      somewhere real to read the site from. Stamped by the fill route alongside last_used_at,
--      not derived after the fact -- there is no other durable record of which site a trusted
--      fill was actually for.

ALTER TABLE vault_reveals ADD COLUMN IF NOT EXISTS via text NOT NULL DEFAULT 'owner';

ALTER TABLE vault_reveals DROP CONSTRAINT IF EXISTS vault_reveals_via_check;
ALTER TABLE vault_reveals ADD CONSTRAINT vault_reveals_via_check
  CHECK (via IN ('owner', 'extension-trusted'));

ALTER TABLE vault_reveals ADD COLUMN IF NOT EXISTS device_trust_id uuid
  REFERENCES vault_device_trust(id) ON DELETE SET NULL;

ALTER TABLE vault_device_trust ADD COLUMN IF NOT EXISTS last_used_site text;
