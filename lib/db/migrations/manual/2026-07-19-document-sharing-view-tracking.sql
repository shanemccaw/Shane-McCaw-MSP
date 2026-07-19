-- Extend Document Sharing + View Tracking Beyond SOWs
--
-- 1. presentation_doc_views.presentation_id was NOT NULL, which meant a
--    document view event could only be recorded in the context of a Quick
--    Win presentation. General documents (customer-documents.tsx, assessment
--    results) are opened outside that flow, so this loosens the column to
--    nullable — document_id (already nullable, already FK'd to
--    insights_generated_documents) becomes the required identifier instead
--    when presentation_id is absent. Enforced at the application layer.
ALTER TABLE presentation_doc_views ALTER COLUMN presentation_id DROP NOT NULL;

-- 2. quick_win_result_shares was single-purpose (diagnostic score snapshot
--    shares). Generalize it to also carry general-document shares, reusing
--    its proven token/expiry/view-count machinery rather than a parallel
--    table. share_kind discriminates the two; document_id is only set for
--    "document" shares; scores_snapshot is only set for "quick_win_scores"
--    shares (now nullable).
ALTER TABLE quick_win_result_shares
  ADD COLUMN IF NOT EXISTS share_kind TEXT NOT NULL DEFAULT 'quick_win_scores',
  ADD COLUMN IF NOT EXISTS document_id INTEGER REFERENCES insights_generated_documents(id) ON DELETE CASCADE;

ALTER TABLE quick_win_result_shares ALTER COLUMN scores_snapshot DROP NOT NULL;
