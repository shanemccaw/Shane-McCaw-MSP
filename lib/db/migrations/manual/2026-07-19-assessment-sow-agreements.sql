-- Assessment SOW agreements — signature + payment record for the Assessment
-- "payment plan" wizard step (Task 5). insights_generated_documents holds the
-- SOW scope/pricing; this table holds the signed acceptance + chosen plan +
-- checkout/payment lifecycle, which that table has no columns for.
--
-- Safe to run more than once (IF NOT EXISTS throughout).

CREATE TABLE IF NOT EXISTS assessment_sow_agreements (
  id                          SERIAL PRIMARY KEY,
  doc_id                      INTEGER NOT NULL REFERENCES insights_generated_documents(id) ON DELETE CASCADE,
  client_user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id                 INTEGER,
  msp_id                      INTEGER,
  selected_workstream_titles  JSONB NOT NULL DEFAULT '[]'::jsonb,
  scope_key                   TEXT NOT NULL DEFAULT '',
  agreed_total_cents          INTEGER NOT NULL,
  discounted_total_cents      INTEGER,
  coupon_code                 TEXT,
  window_state_at_signing     TEXT,   -- 'discount' | 'standard' | 'expired'
  payment_plan                TEXT NOT NULL,  -- 'full' | 'phased'
  signature_data              TEXT NOT NULL,
  signer_name                 TEXT NOT NULL,
  signature_ip                TEXT,
  signed_at                   TIMESTAMP NOT NULL DEFAULT now(),
  status                      TEXT NOT NULL DEFAULT 'pending_payment',
                              -- 'pending_payment' | 'paid' | 'awaiting_provider_setup' | 'free_activated'
  stripe_session_id           TEXT,
  paid_at                     TIMESTAMP,
  created_at                  TIMESTAMP NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS asa_doc_idx ON assessment_sow_agreements (doc_id);
CREATE INDEX IF NOT EXISTS asa_client_user_idx ON assessment_sow_agreements (client_user_id);

-- Idempotency for the Stripe webhook — one agreement row per checkout session.
CREATE UNIQUE INDEX IF NOT EXISTS asa_stripe_session_uidx
  ON assessment_sow_agreements (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
