-- Git #603 (Epic #597 stage 5): reconcile post-payment agreement recording
-- for the live-scope SOW cart checkout (#598-#602).
--
-- assessment_sow_agreements.doc_id was NOT NULL, FK'd to a stored
-- insights_generated_documents row -- a document the live engine-based cart
-- flow never has (journeyScopeFromOffers() always returns docId: null; it
-- reads the Sales Offer Engine directly, never a stored document). This adds
-- a checkout_session_id path alongside doc_id, so a live-cart agreement can
-- be recorded without a stored document, and makes doc_id nullable so it can
-- be genuinely absent rather than forced.
--
-- Also extends checkout_sessions with the live-scope sign() step's own real
-- signature capture (JourneySignaturePanel's drawn-PNG + typed-name wire
-- contract) and the pre/post pay-in-full-coupon totals, both confirmed with
-- Shane 2026-08-08.

ALTER TABLE assessment_sow_agreements
  ALTER COLUMN doc_id DROP NOT NULL;

ALTER TABLE assessment_sow_agreements
  ADD COLUMN IF NOT EXISTS checkout_session_id uuid REFERENCES checkout_sessions(id) ON DELETE CASCADE;

ALTER TABLE assessment_sow_agreements
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;

CREATE UNIQUE INDEX IF NOT EXISTS asa_checkout_session_uidx
  ON assessment_sow_agreements (checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS asa_stripe_payment_intent_uidx
  ON assessment_sow_agreements (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- Exactly one of the two paths must identify what was signed.
ALTER TABLE assessment_sow_agreements
  DROP CONSTRAINT IF EXISTS asa_doc_or_session_check;
ALTER TABLE assessment_sow_agreements
  ADD CONSTRAINT asa_doc_or_session_check
  CHECK (doc_id IS NOT NULL OR checkout_session_id IS NOT NULL);

ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS sow_signature_data text;
ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS sow_signer_name text;
ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS sow_signature_ip text;
ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS sow_selected_phase_titles jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS sow_cart_original_total_cents integer;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-08-sow-cart-agreement-recording-603.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
