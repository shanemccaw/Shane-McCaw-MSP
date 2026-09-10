-- 2026-09-10 — Git #3106
--
-- print_tokens.document_id -> insights_generated_documents(id) was NO ACTION
-- (no ON DELETE clause at all). #2984 already keys the documents purger's
-- `print_tokens` target to the terminated tenant's own logins (userId key
-- space), which clears the common case. The residual case: a print token
-- minted by an MSP STAFF account against a customer's generated document is
-- outside that key space (a staff account has no tenant_id, or a different
-- one) and still blocks the insights_generated_documents DELETE, aborting
-- the entire 7-year purge transaction.
--
-- A print token is a short-lived, single-use capability scoped to exactly
-- one document (document_id is NOT NULL — SET NULL is not viable without
-- also relaxing that constraint, and an orphaned token with nothing to
-- render has no remaining purpose anyway). ON DELETE CASCADE is the honest
-- semantics: once the document is gone, any token minted for it is
-- meaningless and should go with it. This also removes the ordering
-- constraint on the `documents` purger module entirely — print_tokens no
-- longer needs to be cleared ahead of insights_generated_documents.
--
-- Additive/reversible: drops and re-adds one FK constraint definition. No
-- data is deleted by running this migration itself.
--
-- Safe to re-run.

ALTER TABLE print_tokens
  DROP CONSTRAINT IF EXISTS print_tokens_document_id_fkey;

ALTER TABLE print_tokens
  ADD CONSTRAINT print_tokens_document_id_fkey
  FOREIGN KEY (document_id) REFERENCES insights_generated_documents(id) ON DELETE CASCADE;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-10-print-tokens-document-id-cascade-3106.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
