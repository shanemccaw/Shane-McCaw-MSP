-- Manual Migration: Zoho Projects (msp-portal only), Issue #85
-- Target: Postgres database. To be run manually by Shane.
--
-- Two additive, nullable columns:
--   zoho_connection.zoho_portal_id — Zoho Projects' portal id, a distinct
--     concept from zoho_org_id (CRM's org identifier). Not known at OAuth
--     callback time; resolved lazily on first Zoho Projects call
--     (GET /projects/v3/portals/) and cached here.
--   projects.zoho_project_id — links an existing local project row to the
--     Zoho Project that feeds its Zoho Projects board. Independent of
--     kanban_tasks / project-kanban.tsx's local delivery board, which this
--     issue does not touch.

ALTER TABLE zoho_connection ADD COLUMN IF NOT EXISTS zoho_portal_id TEXT;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS zoho_project_id TEXT;
