-- Git #4349: Documents workspace — attach a Document Hub document to a POA&M,
-- CAB meeting, or support ticket. Additive, non-destructive.

CREATE TABLE IF NOT EXISTS document_hub_attachments (
  id SERIAL PRIMARY KEY,
  msp_id INTEGER NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES insights_generated_documents(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('poam', 'cab_meeting', 'support_ticket')),
  target_ref_id TEXT NOT NULL,
  target_label TEXT NOT NULL,
  attached_by_user_id INTEGER,
  attached_by_person_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_hub_attachments_document_id_idx
  ON document_hub_attachments (document_id);

CREATE INDEX IF NOT EXISTS document_hub_attachments_target_idx
  ON document_hub_attachments (target_kind, target_ref_id);

CREATE INDEX IF NOT EXISTS document_hub_attachments_msp_idx
  ON document_hub_attachments (msp_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4349-document-hub-attachments.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
