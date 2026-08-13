-- ============================================================================
-- copilot:sensitivity-labels-exist & governance:sensitivity-label-adoption —
-- missing zero-count severity rule (#470)
-- Manual — run by hand, not drizzle-kit. No DATABASE_URL in this environment.
-- ============================================================================
--
-- SYMPTOM (confirmed against tenant c4c814d4-3afe-441e-9145-62461d0a4fd3, run
-- 2e21d478-8783-427c-968d-6b48199b0e96): both checks correctly fetch real
-- Graph data and extract labelCount / sensitivityLabelCount — including the
-- real value 0 for a tenant with no sensitivity labels configured — but
-- monitor_checks.severity_rules for both is an empty jsonb array ([]).
-- classifySeverity() (artifacts/api-server/src/lib/monitor-executor.ts) loops
-- over severity_rules and returns null when nothing matches; with no rules at
-- all, EVERY result — including a genuine 0 — falls through to the generic
-- "ok" / "Check passed" outcome. Both checks were reclassified into the
-- Compliance pillar with real compliance_impact weight in #469's related SQL,
-- but that weighting can never fire because the underlying check never
-- registers as a failing signal.
--
-- REFERENCE (untouched by this migration): governance:auto-labeling-coverage
-- already has the correct pattern — one rule keyed on its own falsy signal
-- (autoLabelingPolicyExists == false, severity warning, with a label). This
-- migration applies the same pattern to the other two checks, using each
-- check's own extracted property name rather than copying the reference
-- rule's expression verbatim.
--
-- Both set to "warning" (not "critical") to match the reference check's own
-- severity band for the same underlying condition (no sensitivity labels
-- configured) — these are two closely-related checks on the same real-world
-- signal, and there is no basis in the issue for treating one more severely
-- than the other.

UPDATE monitor_checks
SET severity_rules = '[
  {
    "severity": "warning",
    "expression": "labelCount == 0",
    "label": "No sensitivity labels are configured in this tenant — Copilot cannot classify or protect content sensitivity without labels in place"
  }
]'::jsonb,
    updated_at = now()
WHERE key = 'copilot:sensitivity-labels-exist';

UPDATE monitor_checks
SET severity_rules = '[
  {
    "severity": "warning",
    "expression": "sensitivityLabelCount == 0",
    "label": "No sensitivity labels have been adopted in this tenant — content is not being classified for governance or compliance"
  }
]'::jsonb,
    updated_at = now()
WHERE key = 'governance:sensitivity-label-adoption';

-- Verify: expect the new rule on both, endpoint/status unchanged.
SELECT key, status, severity_rules
FROM monitor_checks
WHERE key IN ('copilot:sensitivity-labels-exist', 'governance:sensitivity-label-adoption');

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-06-sensitivity-label-severity-rules-470.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
