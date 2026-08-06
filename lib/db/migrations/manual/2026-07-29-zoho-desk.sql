-- Manual Migration: Zoho Desk (connected to Support Chat human-escalation), Issue #89
-- Target: Postgres database. To be run manually by Shane.
--
-- Two additive, nullable columns:
--   zoho_connection.zoho_desk_org_id — Zoho Desk's organization id, a fourth
--     distinct Zoho identifier separate from zoho_org_id (CRM), zoho_portal_id
--     (Projects) and zoho_books_org_id (Books). Not known at OAuth callback
--     time; resolved lazily on first Zoho Desk call
--     (GET /api/v1/organizations) and cached here. Sent as an `orgId` HTTP
--     header on every Zoho Desk call, unlike the other three products.
--   users.zoho_desk_contact_id — links a local user to the Zoho Desk Contact
--     created for them on first escalation, mirroring users.zoho_contact_id
--     (CRM) and users.zoho_books_contact_id (Books). Distinct record space
--     from both.
--
-- Manual prerequisite (per #89, same category as CRM's custom Lead fields):
-- Shane must have at least one Department configured in Zoho Desk before
-- ticket creation can be tested live. The department id ticket creation uses
-- is read from ZOHO_DESK_DEFAULT_DEPARTMENT_ID (env var / Replit secret),
-- same convention as ZOHO_BOOKS_AI_EXPENSE_ACCOUNT_ID.

ALTER TABLE zoho_connection ADD COLUMN IF NOT EXISTS zoho_desk_org_id TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS zoho_desk_contact_id TEXT;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-07-29-zoho-desk.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
