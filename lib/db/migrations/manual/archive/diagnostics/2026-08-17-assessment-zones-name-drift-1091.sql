-- Diagnostic (read-only, no schema/data change) for Git #1091.
--
-- assessmentZones.ts ZONE_ASSIGNMENTS claims to be confirmed against all 21
-- real assessment rows (services.id 13-33, per
-- lib/db/migrations/manual/2026-07-20-assessment-detail-content.sql), matched
-- by exact service name. That confirmation predates 3+ weeks of drift --
-- this verifies those exact names still exist unchanged in the live
-- services table.
--
-- Run via shaneapp://executeSql. Any row returned means a mismatch: a
-- hardcoded name in assessmentZones.ts with no exact match in services
-- (id 13-33), OR a services row (id 13-33) whose name isn't referenced by
-- any of the 21 hardcoded names. Flag any result back on #1091 --
-- do not silently patch assessmentZones.ts with a guessed mapping.

WITH expected_names(name) AS (
  VALUES
    ('Security Posture Assessment'),
    ('Conditional Access Assessment'),
    ('Entra ID / Identity Assessment'),
    ('Intune / Device Management Assessment'),
    ('Compliance Framework Mapping Audit — SOC 2'),
    ('Compliance Framework Mapping Audit — NIST CSF'),
    ('Compliance Framework Mapping Audit — ISO 27001'),
    ('Compliance Framework Mapping Audit — CMMC Level 1-2'),
    ('Data Governance Assessment'),
    ('Copilot Data Exposure Assessment'),
    ('SharePoint Assessment'),
    ('Teams Assessment'),
    ('Exchange Online Assessment'),
    ('Copilot Readiness Snapshot'),
    ('Copilot Readiness Assessment'),
    ('License Waste Audit'),
    ('License & Cost Optimization Assessment'),
    ('Tenant Governance Snapshot'),
    ('M365 Tenant Health Audit'),
    ('Migration Readiness Assessment'),
    ('Adoption & Change Management Maturity Assessment')
),
live_services AS (
  SELECT id, name FROM services WHERE id BETWEEN 13 AND 33
)
-- Hardcoded names with no exact match among live services 13-33
-- (renamed, deleted, or id reassigned outside 13-33).
SELECT
  'hardcoded_name_not_in_live_range' AS mismatch_type,
  e.name AS assessmentzones_name,
  NULL::int AS live_id,
  NULL::text AS live_name
FROM expected_names e
WHERE NOT EXISTS (SELECT 1 FROM live_services s WHERE s.name = e.name)

UNION ALL

-- Live services in id range 13-33 whose exact name isn't one of the 21
-- hardcoded names (renamed in DB since assessmentZones.ts was last confirmed,
-- or a row that was never part of the original 21).
SELECT
  'live_row_not_in_hardcoded_list' AS mismatch_type,
  NULL AS assessmentzones_name,
  s.id AS live_id,
  s.name AS live_name
FROM live_services s
WHERE NOT EXISTS (SELECT 1 FROM expected_names e WHERE e.name = s.name)

ORDER BY mismatch_type, live_id;

-- Sanity check: full listing of what's actually live in the range, for
-- manual eyeballing alongside the diff above.
SELECT id, name FROM services WHERE id BETWEEN 13 AND 33 ORDER BY id;
