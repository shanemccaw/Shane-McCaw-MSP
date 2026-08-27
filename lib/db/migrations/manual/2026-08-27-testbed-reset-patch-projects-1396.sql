-- 2026-08-27-testbed-reset-patch-projects-1396.sql
--
-- Real patch to #1329's comprehensive reset -- projects (and its FK
-- dependents) were genuinely missed. #1329's schema search looked for
-- tenant_id (text) / customer_id (integer) columns; projects.client_user_id
-- references users.id instead, a different FK shape that search didn't
-- catch. Confirmed via schema read (lib/db/src/schema/index.ts) after Shane
-- found real "Project & release schedule" data survive a real #1329 run.
--
-- insights_generated_documents and insights_automations also reference
-- projectId, but are already customer_id-scoped in #1329's original DELETE
-- list -- not touched again here, no incremental risk.
--
-- client_services is DELIBERATELY EXCLUDED from this patch. It has a real
-- project_id FK but represents actual purchased/active service state
-- (Monitoring tier assignment, etc.) -- clearing it could remove the test
-- account's Premier tier assignment. Flagged for Shane's explicit decision,
-- not wiped by default.

BEGIN;

DO $$
DECLARE
  v_tenant_id INT;
  v_tenant_guid TEXT := 'c4c814d4-3afe-441e-9145-62461d0a4fd3';
  v_user_ids INT[];
BEGIN
  SELECT id INTO v_tenant_id FROM tenants WHERE tenant_id = v_tenant_guid;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Testbed tenant not found -- aborting, nothing changed.';
  END IF;

  SELECT array_agg(id) INTO v_user_ids FROM users WHERE tenant_id = v_tenant_id;

  IF v_user_ids IS NULL THEN
    RAISE NOTICE 'No user rows found for this tenant -- nothing to clean.';
    RETURN;
  END IF;

  -- Children first (FK dependents), projects table last.
  DELETE FROM workflow_steps WHERE project_id IN (SELECT id FROM projects WHERE client_user_id = ANY(v_user_ids));
  DELETE FROM kanban_tasks WHERE project_id IN (SELECT id FROM projects WHERE client_user_id = ANY(v_user_ids));
  DELETE FROM documents WHERE project_id IN (SELECT id FROM projects WHERE client_user_id = ANY(v_user_ids));
  DELETE FROM reports WHERE project_id IN (SELECT id FROM projects WHERE client_user_id = ANY(v_user_ids));
  DELETE FROM invoices WHERE project_id IN (SELECT id FROM projects WHERE client_user_id = ANY(v_user_ids));
  DELETE FROM project_updates WHERE project_id IN (SELECT id FROM projects WHERE client_user_id = ANY(v_user_ids));
  DELETE FROM contracts WHERE project_id IN (SELECT id FROM projects WHERE client_user_id = ANY(v_user_ids));
  DELETE FROM status_reports WHERE project_id IN (SELECT id FROM projects WHERE client_user_id = ANY(v_user_ids));
  DELETE FROM project_closures WHERE project_id IN (SELECT id FROM projects WHERE client_user_id = ANY(v_user_ids));
  DELETE FROM audit_logs WHERE project_id IN (SELECT id FROM projects WHERE client_user_id = ANY(v_user_ids));
  DELETE FROM opportunities WHERE project_id IN (SELECT id FROM projects WHERE client_user_id = ANY(v_user_ids));
  DELETE FROM client_callback_tokens WHERE project_id IN (SELECT id FROM projects WHERE client_user_id = ANY(v_user_ids));
  DELETE FROM quick_win_presentations WHERE project_id IN (SELECT id FROM projects WHERE client_user_id = ANY(v_user_ids));

  DELETE FROM projects WHERE client_user_id = ANY(v_user_ids);

  RAISE NOTICE 'Project data cleared for tenant id=%, users=%', v_tenant_id, v_user_ids;
END $$;

COMMIT;
