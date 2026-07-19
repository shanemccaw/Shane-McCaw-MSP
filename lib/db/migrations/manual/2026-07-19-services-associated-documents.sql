-- Services — associated documents
--
-- Adds a structured document-mapping column to `services`, driving the automated
-- Assessment document-generation workflow ("Assessment Document Generation —
-- Service-Mapped, Sequenced SOW"). Distinct from the existing marketing
-- `deliverables` string[] column, which is unstructured display copy.
--
-- Shape: jsonb array of objects, each:
--   {
--     "docType":         "executive_summary" | "security_posture_report" | ... ,
--     "category":        "report" | "consulting",
--     "title":           "Executive Summary",
--     "customerVisible": true | false
--   }
--
-- customerVisible=false documents are generated internal-only (they ground the
-- consolidated SOW's accuracy) and are excluded from the customer-facing
-- presentation built at the end of generation. The consolidated_sow is generated
-- separately, after these, and is always customer-visible.
--
-- Safe to run repeatedly (IF NOT EXISTS). Existing rows get NULL, which the
-- find_object "service" workflow node treats as an empty document list.

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS associated_documents jsonb;
