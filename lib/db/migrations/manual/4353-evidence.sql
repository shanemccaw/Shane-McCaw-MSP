-- #4353 — the real SHARED Evidence object (evidence + evidence_links).
--
-- Distinct from #3503's `evidence_attachments` (a narrow 1:1 screenshot store
-- pinned to one remediation step or change execution). This is the GENERAL
-- object #4345 (POA&M/milestone), #4349 (Documents), and #4350 (SOW/Assessment
-- finding/gap/risk) all attach to, so they reuse ONE object rather than three.
--
-- `evidence`       — one row per real piece of evidence: an uploaded file
--                    (kind='file', file_ref = server-relative path under
--                    UPLOADS_DIR/evidence) OR an external link (kind='link',
--                    file_ref = URL).
-- `evidence_links` — polymorphic-by-explicit-type join: one evidence row can be
--                    linked to MANY object types (milestone|document|finding|
--                    gap|risk|kanban_card|poam). linked_id is TEXT because the
--                    seven target tables key differently. No FK on the target
--                    (soft link, same convention as evidence_attachments); the
--                    FK to evidence(id) IS real and cascades.
--
-- Additive, nullable where not essential, reversible. Safe to re-run (IF NOT EXISTS).

BEGIN;

CREATE TABLE IF NOT EXISTS evidence (
  id SERIAL PRIMARY KEY,
  msp_id INTEGER NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  customer_id INTEGER,
  kind TEXT NOT NULL,
  file_ref TEXT NOT NULL,
  original_filename TEXT,
  content_type TEXT,
  file_size_bytes INTEGER,
  description TEXT,
  uploaded_by_user_id INTEGER,
  uploaded_by_person_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evidence_msp_customer_idx
  ON evidence (msp_id, customer_id);

CREATE TABLE IF NOT EXISTS evidence_links (
  id SERIAL PRIMARY KEY,
  evidence_id INTEGER NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  linked_type TEXT NOT NULL,
  linked_id TEXT NOT NULL,
  linked_by_user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS evidence_links_unique_idx
  ON evidence_links (evidence_id, linked_type, linked_id);

CREATE INDEX IF NOT EXISTS evidence_links_target_idx
  ON evidence_links (linked_type, linked_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4353-evidence.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
