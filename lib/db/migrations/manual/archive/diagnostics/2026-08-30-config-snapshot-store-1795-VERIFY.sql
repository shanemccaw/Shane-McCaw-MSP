-- Git #1795 — behavioural verification of the configuration snapshot store.
--
-- Exercises every guarantee the schema claims, against the REAL local database, and
-- ROLLS BACK at the end so no rows are left behind. Nothing here is a mock: each case
-- runs the actual DDL-enforced constraint or trigger and reports what Postgres did.
--
-- Run:  psql "$DATABASE_URL" -f <this file>
-- Expect: every line PASS, and zero rows remaining afterwards.
--
-- Diagnostic file: performs DML but commits none of it, so it deliberately carries no
-- simulator_migration_runs self-marking INSERT (it changes no schema and no data).

BEGIN;

DO $verify$
DECLARE
  v_tenant       integer;
  v_entra        text;
  v_snapshot     integer;
  v_obj_id       bigint;
  v_msg          text;
  v_pass         integer := 0;
  v_fail         integer := 0;
BEGIN
  SELECT id, tenant_id INTO v_tenant, v_entra FROM tenants WHERE is_testbed = true ORDER BY id LIMIT 1;
  RAISE NOTICE 'Using real tenant id=% entra=%', v_tenant, v_entra;

  -- ── 1. A registry row cannot be collectable without an identity strategy ──
  BEGIN
    INSERT INTO config_snapshot_resource_types
      (resource_key, display_name, surface, workload, read_transport,
       identity_strategy, is_collectable)
    VALUES ('verify:1795:no-identity', 'verify', 'identity', 'AzureAD', 'graph',
            'unresolved', true);
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL  1. collectable-without-identity was ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  1. collectable-without-identity rejected';
  END;

  -- ── 2. A non-collectable row must state why ──────────────────────────────
  BEGIN
    INSERT INTO config_snapshot_resource_types
      (resource_key, display_name, surface, workload, read_transport,
       identity_strategy, identity_property_names, is_collectable, not_collectable_reason)
    VALUES ('verify:1795:no-reason', 'verify', 'identity', 'AzureAD', 'graph',
            'graph-id', '["id"]'::jsonb, false, NULL);
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL  2. not-collectable-without-reason was ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  2. not-collectable-without-reason rejected';
  END;

  -- ── 3. graph-id must name its identity property ──────────────────────────
  BEGIN
    INSERT INTO config_snapshot_resource_types
      (resource_key, display_name, surface, workload, read_transport,
       identity_strategy, identity_property_names, is_collectable)
    VALUES ('verify:1795:empty-props', 'verify', 'identity', 'AzureAD', 'graph',
            'graph-id', '[]'::jsonb, true);
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL  3. graph-id with no named property was ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  3. graph-id with no named property rejected';
  END;

  -- A valid registry row, for the rest of the run.
  INSERT INTO config_snapshot_resource_types
    (resource_key, display_name, surface, workload, read_transport, graph_version,
     graph_path, is_collection, identity_strategy, identity_property_names,
     identity_basis, is_collectable, shape_provenance)
  VALUES ('verify:1795:ok', 'verify', 'policy', 'AzureAD', 'graph', 'v1.0',
          '/policies/authorizationPolicy', false, 'graph-id', '["id"]'::jsonb,
          'verification fixture', true, 'derived_from_graph_metadata');
  v_pass := v_pass + 1;
  RAISE NOTICE 'PASS  4. valid registry row accepted';

  -- ── 5. A running snapshot cannot carry sealed_at ─────────────────────────
  BEGIN
    INSERT INTO tenant_config_snapshots (tenant_id, entra_tenant_id, trigger, status, sealed_at)
    VALUES (v_tenant, v_entra, 'manual', 'running', now());
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL  5. running snapshot with sealed_at was ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  5. running snapshot with sealed_at rejected';
  END;

  INSERT INTO tenant_config_snapshots
    (tenant_id, entra_tenant_id, trigger, trigger_ref, status, collector_version)
  VALUES (v_tenant, v_entra, 'manual', 'Git #1795 schema verification', 'running', 'verify')
  RETURNING id INTO v_snapshot;
  v_pass := v_pass + 1;
  RAISE NOTICE 'PASS  6. running snapshot created (id=%)', v_snapshot;

  -- ── 7. Objects are writable while the snapshot is running ────────────────
  INSERT INTO tenant_config_snapshot_objects
    (snapshot_row_id, tenant_id, resource_key, object_identity, identity_strategy,
     display_name, object_json, object_hash, property_count, source_ref)
  VALUES (v_snapshot, v_tenant, 'verify:1795:ok', 'obj-a', 'graph-id', 'Object A',
          '{"id":"obj-a","displayName":"Object A","createdDateTime":"2026-01-01T00:00:00Z"}'::jsonb,
          'hash-a', 3, '/policies/authorizationPolicy')
  RETURNING id INTO v_obj_id;
  v_pass := v_pass + 1;
  RAISE NOTICE 'PASS  7. object stored while running (id=%)', v_obj_id;

  -- ── 8. Duplicate identity within one snapshot is unwritable ──────────────
  BEGIN
    INSERT INTO tenant_config_snapshot_objects
      (snapshot_row_id, tenant_id, resource_key, object_identity, identity_strategy,
       object_json, object_hash)
    VALUES (v_snapshot, v_tenant, 'verify:1795:ok', 'obj-a', 'graph-id',
            '{"id":"obj-a"}'::jsonb, 'hash-dup');
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL  8. duplicate object_identity was ACCEPTED';
  EXCEPTION WHEN unique_violation THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  8. duplicate object_identity rejected';
  END;

  -- ── 9. Fidelity: the stored object is byte-for-byte what went in ─────────
  IF EXISTS (
    SELECT 1 FROM tenant_config_snapshot_objects
     WHERE id = v_obj_id
       AND object_json ? 'createdDateTime'
       AND object_json->>'createdDateTime' = '2026-01-01T00:00:00Z'
  ) THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS  9. undeclared property (createdDateTime, Git #1846) survived storage';
  ELSE
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL  9. undeclared property was LOST';
  END IF;

  -- ── 10. "collected" cannot claim zero objects ────────────────────────────
  BEGIN
    INSERT INTO tenant_config_snapshot_resource_status
      (snapshot_row_id, resource_key, read_transport, status, object_count)
    VALUES (v_snapshot, 'verify:1795:collected-zero', 'graph', 'collected', 0);
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL 10. collected with object_count=0 was ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS 10. collected with object_count=0 rejected';
  END;

  -- ── 11. "skipped" cannot omit its reason ─────────────────────────────────
  BEGIN
    INSERT INTO tenant_config_snapshot_resource_status
      (snapshot_row_id, resource_key, read_transport, status, skip_reason)
    VALUES (v_snapshot, 'verify:1795:skip-no-reason', 'graph', 'skipped', NULL);
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL 11. skipped without skip_reason was ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS 11. skipped without skip_reason rejected';
  END;

  -- ── 12. "empty" cannot carry a skip reason — it is not a failure ─────────
  BEGIN
    INSERT INTO tenant_config_snapshot_resource_status
      (snapshot_row_id, resource_key, read_transport, status, skip_reason, object_count)
    VALUES (v_snapshot, 'verify:1795:empty-with-reason', 'graph', 'empty',
            'permission_denied', 0);
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL 12. empty with a skip_reason was ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS 12. empty with a skip_reason rejected';
  END;

  -- The four honest outcomes, all valid.
  INSERT INTO tenant_config_snapshot_resource_status
    (snapshot_row_id, resource_key, read_transport, status, object_count, request_ref)
  VALUES (v_snapshot, 'verify:1795:ok', 'graph', 'collected', 1, '/policies/authorizationPolicy');
  INSERT INTO tenant_config_snapshot_resource_status
    (snapshot_row_id, resource_key, read_transport, status, object_count, reason_detail)
  VALUES (v_snapshot, 'verify:1795:none-of-these', 'graph', 'empty', 0,
          'tenant genuinely has zero objects of this type');
  INSERT INTO tenant_config_snapshot_resource_status
    (snapshot_row_id, resource_key, read_transport, status, skip_reason, reason_detail, http_status, error_code)
  VALUES (v_snapshot, 'verify:1795:no-licence', 'graph', 'failed', 'license_required',
          'Entra ID P2 not present on this tenant', 403,
          'Authentication_RequestFromNonPremiumTenantOrB2CTenant');
  INSERT INTO tenant_config_snapshot_resource_status
    (snapshot_row_id, resource_key, read_transport, status, skip_reason, reason_detail)
  VALUES (v_snapshot, 'verify:1795:no-executor', 'azure-rm', 'skipped', 'no_executor',
          'no executor exists for the azure-rm transport (Git #1849)');
  v_pass := v_pass + 1;
  RAISE NOTICE 'PASS 13. collected / empty / failed / skipped all recorded with honest reasons';

  -- ── 14. is_complete cannot be asserted while anything failed ─────────────
  BEGIN
    UPDATE tenant_config_snapshots
       SET status = 'sealed', sealed_at = now(), is_complete = true,
           resource_types_targeted = 4, resource_types_collected = 1,
           resource_types_empty = 1, resource_types_failed = 1, resource_types_skipped = 1,
           object_count = 1
     WHERE id = v_snapshot;
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL 14. is_complete=true with failures was ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS 14. is_complete=true with failures rejected';
  END;

  -- Seal honestly.
  UPDATE tenant_config_snapshots
     SET status = 'sealed', sealed_at = now(), finished_at = now(), is_complete = false,
         resource_types_targeted = 4, resource_types_collected = 1,
         resource_types_empty = 1, resource_types_failed = 1, resource_types_skipped = 1,
         object_count = 1
   WHERE id = v_snapshot;
  v_pass := v_pass + 1;
  RAISE NOTICE 'PASS 15. snapshot sealed with is_complete=false (honest incompleteness)';

  -- ── 16. A sealed snapshot's objects cannot be updated ────────────────────
  BEGIN
    UPDATE tenant_config_snapshot_objects SET display_name = 'tampered' WHERE id = v_obj_id;
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL 16. UPDATE of a sealed snapshot object was ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS 16. UPDATE rejected: %', left(v_msg, 90);
  END;

  -- ── 17. A sealed snapshot's objects cannot be surgically deleted ─────────
  BEGIN
    DELETE FROM tenant_config_snapshot_objects WHERE id = v_obj_id;
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL 17. DELETE of a sealed snapshot object was ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS 17. DELETE of a sealed snapshot object rejected';
  END;

  -- ── 18. Completeness rows are evidence too, and equally frozen ───────────
  BEGIN
    UPDATE tenant_config_snapshot_resource_status
       SET status = 'empty', skip_reason = NULL
     WHERE snapshot_row_id = v_snapshot AND resource_key = 'verify:1795:no-licence';
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL 18. rewriting a sealed failure as "empty" was ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS 18. rewriting a sealed failure as "empty" rejected';
  END;

  -- ── 19. The header's point-in-time identity is immutable ─────────────────
  BEGIN
    UPDATE tenant_config_snapshots SET captured_at = now() - interval '10 days'
     WHERE id = v_snapshot;
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL 19. rewriting captured_at was ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS 19. rewriting captured_at rejected';
  END;

  -- ── 20. A sealed snapshot cannot be re-opened ────────────────────────────
  BEGIN
    UPDATE tenant_config_snapshots SET status = 'running', sealed_at = NULL
     WHERE id = v_snapshot;
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL 20. re-opening a sealed snapshot was ACCEPTED';
  EXCEPTION WHEN raise_exception THEN
    v_pass := v_pass + 1;
    RAISE NOTICE 'PASS 20. re-opening a sealed snapshot rejected';
  END;

  -- ── 21. Retention still works: deleting the header cascades ──────────────
  BEGIN
    DELETE FROM tenant_config_snapshots WHERE id = v_snapshot;
    IF NOT EXISTS (SELECT 1 FROM tenant_config_snapshot_objects WHERE snapshot_row_id = v_snapshot)
       AND NOT EXISTS (SELECT 1 FROM tenant_config_snapshot_resource_status WHERE snapshot_row_id = v_snapshot)
    THEN
      v_pass := v_pass + 1;
      RAISE NOTICE 'PASS 21. whole-snapshot retention delete cascaded (immutability guards a surgical edit, not a retention sweep)';
    ELSE
      v_fail := v_fail + 1;
      RAISE NOTICE 'FAIL 21. cascade left orphans behind';
    END IF;
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    v_fail := v_fail + 1;
    RAISE NOTICE 'FAIL 21. retention delete was BLOCKED by the immutability trigger: %', left(v_msg, 90);
  END;

  RAISE NOTICE '─────────────────────────────────────────────';
  RAISE NOTICE 'RESULT: % passed, % failed', v_pass, v_fail;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'Git #1795 schema verification FAILED (% failures)', v_fail;
  END IF;
END;
$verify$;

ROLLBACK;
