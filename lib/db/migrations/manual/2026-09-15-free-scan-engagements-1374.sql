-- 2026-09-15-free-scan-engagements-1374.sql
--
-- Git #1374 (Phase of Feature #1352, Free Scan) — the Review step's engagement
-- record: the Statement of Work a Free Scan Prospect scopes, signs and pays for.
--
-- Additive only: one new table, no changes to any existing one. Run by the
-- building session against the local DATABASE_URL per CLAUDE.md's Database
-- section; Replit/Staging picks it up at release time (#1630).
--
-- Keyed on customer_id (tenants.id) because the Prospect reaches the Review
-- screen through two real doors that are the SAME engagement: the live flow's
-- checkout sessionId (#1358) and the emailed return link (#1359), which has no
-- checkout session at all. checkout_session_id records the live door when that
-- is the one used — it is the Stripe binding, not the identity.

BEGIN;

CREATE TABLE IF NOT EXISTS free_scan_engagements (
  id                             serial PRIMARY KEY,
  customer_id                    integer NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  checkout_session_id            uuid REFERENCES checkout_sessions(id) ON DELETE SET NULL,
  sow_reference                  text NOT NULL,
  selected_phase_slugs           jsonb NOT NULL DEFAULT '[]'::jsonb,
  selected_addons                jsonb NOT NULL DEFAULT '[]'::jsonb,
  payment_plan                   text NOT NULL DEFAULT 'full',
  signer_name                    text,
  signer_role                    text,
  signature_data                 text,
  signature_ip                   text,
  terms_accepted_at              timestamptz,
  signed_at                      timestamptz,
  signed_sow_snapshot            jsonb,
  agreed_services_cents          integer,
  agreed_recurring_monthly_cents integer,
  charged_cents                  integer,
  deposit_pct                    integer,
  status                         text NOT NULL DEFAULT 'draft',
  stripe_payment_intent_id       text,
  paid_at                        timestamptz,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS free_scan_engagements_checkout_session_idx
  ON free_scan_engagements (checkout_session_id);

-- One Stripe PaymentIntent can only ever belong to one engagement.
CREATE UNIQUE INDEX IF NOT EXISTS free_scan_engagements_payment_intent_uidx
  ON free_scan_engagements (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- A signed row must carry the whole signature block, never a partial one.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'free_scan_engagements_signature_check'
  ) THEN
    ALTER TABLE free_scan_engagements
      ADD CONSTRAINT free_scan_engagements_signature_check
      CHECK (
        signed_at IS NULL
        OR (signer_name IS NOT NULL
            AND signer_role IS NOT NULL
            AND signature_data IS NOT NULL
            AND terms_accepted_at IS NOT NULL)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'free_scan_engagements_payment_plan_check'
  ) THEN
    ALTER TABLE free_scan_engagements
      ADD CONSTRAINT free_scan_engagements_payment_plan_check
      CHECK (payment_plan IN ('full', 'phased'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'free_scan_engagements_status_check'
  ) THEN
    ALTER TABLE free_scan_engagements
      ADD CONSTRAINT free_scan_engagements_status_check
      CHECK (status IN ('draft', 'signed', 'paid'));
  END IF;
END $$;

-- Self-marking run record, per CLAUDE.md's manual-migration rule.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-15-free-scan-engagements-1374.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
