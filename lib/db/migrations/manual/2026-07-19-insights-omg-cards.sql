-- Assessment Results Viewer — OMG cards
--
-- Adds AI-extracted "OMG card" storage to insights_generated_documents. Cards are
-- the most alarming/notable findings pulled from each document's content, each with
-- a color-coded severity and a large headline number. Extracted lazily on the
-- customer's first view of a document and persisted here so re-views and re-renders
-- never re-run the AI call.
--
-- Safe to run repeatedly (IF NOT EXISTS). Existing rows get NULL, which the
-- extractor treats as "not yet extracted" and fills in on first view.

ALTER TABLE insights_generated_documents
  ADD COLUMN IF NOT EXISTS omg_cards jsonb;

ALTER TABLE insights_generated_documents
  ADD COLUMN IF NOT EXISTS omg_cards_generated_at timestamp;
