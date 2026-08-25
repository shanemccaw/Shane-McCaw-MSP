-- ============================================================================
-- msp_risk_decisions.check_key — accepted-risk suppression key (Git #1279)
-- ============================================================================
-- Manual migration — self-executed via direct local Postgres / shaneapp://executeSql
-- per current CLAUDE.md. Idempotent: ADD COLUMN / CREATE INDEX IF NOT EXISTS.
--
-- ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
-- #1279: the customer-tenant alert engine (#1278) needed a way to know "has
-- this finding already been explicitly accepted as risk" before firing/
-- re-firing an alert. msp_risk_decisions had no structured link to any
-- automated check anywhere — controlViolated/framework/obligation are all
-- free text (see the table's own schema comment), and no msp_diagnostic_findings/
-- overshared_items row references a decision either. Rather than fake a match
-- off free text (unsafe — a false match would silently swallow a real new
-- finding), this adds the one real, optional link: the monitor_checks.key the
-- decision covers, when it was raised against a specific automated check.
--
-- NULL is expected and common — a decision authored as a free-standing
-- liability record (the RiskBasedDecisionConsole's normal flow today) has no
-- single check to name. The alert engine only suppresses when this is set AND
-- the decision is status='active' (see customer-tenant-alert-engine.ts).
--
-- Populated today only via a direct POST /api/msp/rbd body field (checkKey) —
-- there is no RiskBasedDecisionConsole UI to set it yet; that's a real seam,
-- not an oversight (see the #1279 issue comment).
-- ============================================================================

ALTER TABLE msp_risk_decisions ADD COLUMN IF NOT EXISTS check_key TEXT;

CREATE INDEX IF NOT EXISTS msp_risk_decisions_tenant_check_status_idx
  ON msp_risk_decisions (tenant_id, check_key, status);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-25-risk-decision-check-key-1279.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
