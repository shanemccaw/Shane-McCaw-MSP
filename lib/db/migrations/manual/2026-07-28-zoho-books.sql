-- Manual Migration: Zoho Books (invisible sync only — revenue + AI cost expenses, no UI), Issue #87
-- Target: Postgres database. To be run manually by Shane.
--
-- Three additive, nullable columns, all idempotency-tracking only (Zoho Books
-- has no in-platform UI, so none of these are ever displayed):
--   zoho_connection.zoho_books_org_id — Zoho Books' organization id, a third
--     distinct Zoho identifier separate from zoho_org_id (CRM) and
--     zoho_portal_id (Projects). Not known at OAuth callback time; resolved
--     lazily on first Zoho Books call (GET /books/v3/organizations) and
--     cached here.
--   users.zoho_books_contact_id — Zoho Books Contact id. Deliberately
--     separate from zoho_contact_id (Zoho CRM's pointer, different Zoho
--     product with a different record space).
--   invoices.zoho_books_invoice_id — Zoho Books Invoice id, so a retried
--     webhook/job can check "already synced" before calling
--     zoho_books_create_invoice again.

ALTER TABLE zoho_connection ADD COLUMN IF NOT EXISTS zoho_books_org_id TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS zoho_books_contact_id TEXT;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS zoho_books_invoice_id TEXT;
