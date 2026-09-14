-- ============================================================================
-- #4109 — invoices: versioned re-issue with reason for SENT invoices
-- ============================================================================
-- Part of #1692 (Billing).
--
-- Shane's decision (2026-09-14): MSP-console operators can create/update/delete
-- UNSENT (status='draft') invoices freely. A SENT invoice (status in
-- due/paid/overdue) is never edited in place — revising it creates a new row
-- (a new "version" of the same logical invoice) and marks the prior row
-- `status = 'superseded'`, with the reason recorded on the new row.
--
-- `status` stays plain TEXT with no DB CHECK (same convention as every other
-- enum-shaped text column in this table already) — 'superseded' is added as a
-- source-level enum value only (lib/db/src/schema/index.ts, INVOICE_STATUSES),
-- nothing here needs to declare it.
--
-- Additive only: three new nullable/defaulted columns plus a supporting index.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS supersedes_invoice_id integer REFERENCES invoices(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS revision_reason text;

CREATE INDEX IF NOT EXISTS invoices_supersedes_invoice_id_idx
  ON invoices (supersedes_invoice_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-14-invoice-versioned-reissue-4109.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
