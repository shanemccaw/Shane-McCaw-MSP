-- PowerShell-Backed Check Definitions (#211, per #209's approved design)
-- Manual migration — Shane runs this himself (no DATABASE_URL in the Claude env).
--
-- ── WHAT THIS DOES ───────────────────────────────────────────────────────────────
-- Part A: additive executorType/psCmdletKey/psParams columns on monitor_checks.
-- Part B: ONE test check definition (diagnostics:ps-execution-test) that routes
--         through the new PowerShell path, using #210's live-verified
--         get-connection-info placeholder cmdlet — not a real DLP/Label check
--         yet (that's #212). Proves the mechanism end-to-end via the real
--         check-dispatch path (executeMonitorCheck -> runPowerShellCheck ->
--         ps-execution-client.ts -> the real container), not an isolated test.
-- Part C: read-only receipt of the new row, to confirm it landed.
--
-- The CODE half of this capability is already committed
-- (monitor-executor.ts: runPowerShellCheck, resolvePsParamsPlaceholders,
-- the executorType branch in executeMonitorCheck; ps-execution-client.ts:
-- callPsExecution + PsExecutionError). This file is the DATA half.
--
-- ── REQUIRED ENV VARS (api-server side, not covered by this SQL) ─────────────────
-- PS_EXECUTION_CONTAINER_URL             — the live Container App's URL (#210).
-- PS_EXECUTION_BEARER_TOKEN_SECRET_NAME  — optional, defaults to
--   "ps-execution-bearer-token" (same Key Vault secret name entrypoint.ps1
--   reads at container startup, per #198's convention).
--
-- ══════════════════════════════════════════════════════════════════════════════════
-- PART A — SCHEMA: additive PowerShell-executor columns on monitor_checks
-- ══════════════════════════════════════════════════════════════════════════════════
-- executor_type defaults to 'graph' so every one of the existing 120 checks is
-- completely unaffected — this is the same additive-column shape the fan-out
-- work (2026-07-24) already used for exactly this kind of situation.

BEGIN;

ALTER TABLE monitor_checks
  ADD COLUMN IF NOT EXISTS executor_type text NOT NULL DEFAULT 'graph',
  ADD COLUMN IF NOT EXISTS ps_cmdlet_key text,
  ADD COLUMN IF NOT EXISTS ps_params     jsonb;

COMMENT ON COLUMN monitor_checks.executor_type IS
  '''graph'' (default, every pre-existing check) = the endpoint/method/... columns drive a Graph REST fetch. ''powershell'' = ps_cmdlet_key/ps_params drive a ps-execution container call instead.';
COMMENT ON COLUMN monitor_checks.ps_cmdlet_key IS
  'Identifier resolved server-side by the ps-execution container against its own code-owned cmdlet allowlist ($script:CmdletCatalog in entrypoint.ps1) — never a raw script string. NULL unless executor_type = ''powershell''.';
COMMENT ON COLUMN monitor_checks.ps_params IS
  'Static params merged with resolved tenant-identity context ({organization}/{tenantId} placeholders) at dispatch time. NULL unless executor_type = ''powershell''.';


INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-07-31-monitor-checks-powershell-executor.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════════
-- PART B — ONE test check definition on the PowerShell path
-- ══════════════════════════════════════════════════════════════════════════════════
-- get-connection-info -> Get-ConnectionInformation: the trivial, read-only
-- placeholder #210 built and live-verified end-to-end against the real
-- testbed tenant (mccawsoft2.onmicrosoft.com) via unattended cert-based
-- Connect-IPPSSession auth. It exercises the full connect/invoke/capture/
-- disconnect path but touches no tenant mail/compliance data.
--
-- `endpoint` is NOT NULL on monitor_checks (shared with every Graph check) but
-- is meaningless here — executorType = 'powershell' never reads it. A literal
-- placeholder documents that rather than leaving a real-looking-but-unused URL.
--
-- mapping extracts `State` (Get-ConnectionInformation's own field, per the
-- live #210 verification output: "State=Connected") to a plain property, just
-- to prove mapping/applyMapping runs unmodified over PS-sourced items same as
-- Graph-sourced ones. No severityRules — this is a wiring smoke test, not a
-- real finding.
--
-- ps_params.Organization is left as the {organization} placeholder rather
-- than a literal tenant domain, so this same check definition works for
-- whichever tenant it's run against (resolvePsParamsPlaceholders resolves it
-- from tenants.domain at dispatch time, falling back to the tenant GUID).

INSERT INTO monitor_checks (
  key, label, description,
  endpoint, method,
  executor_type, ps_cmdlet_key, ps_params,
  properties, mapping, severity_rules,
  engines, frequency, requires_customer_script,
  schema_version, status
) VALUES (
  'diagnostics:ps-execution-test',
  'PowerShell Execution Path (diagnostic)',
  'Smoke-test check proving the executorType=''powershell'' dispatch path (#211) end-to-end via #210''s live get-connection-info placeholder. Not a real DLP/Label finding — that''s #212. Safe to archive once #212 ships a real PS-backed check and this has served its purpose.',
  '(unused — executorType=powershell drives dispatch, not endpoint)',
  'GET',
  'powershell',
  'get-connection-info',
  '{"Organization":"{organization}"}'::jsonb,
  '[]'::jsonb,
  '[{"sourceField":"State","targetField":"connectionState","transform":"first"}]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  'daily',
  false,
  1,
  'active'
)
ON CONFLICT (key) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════════
-- PART C — READ-ONLY: verify the new row
-- ══════════════════════════════════════════════════════════════════════════════════

SELECT key, executor_type, ps_cmdlet_key, ps_params, mapping, status
FROM monitor_checks
WHERE key = 'diagnostics:ps-execution-test';


-- ── HOW TO RUN THE END-TO-END TEST (NOT DONE HERE — needs a live DB + the real
--    container, neither reachable from the Claude Code environment) ─────────────
-- This check is deliberately NOT wired into any monitoring_package_checks row —
-- it's a diagnostic, not a customer-facing package check. Exercise it directly
-- through the real dispatch path, e.g. from the Simulator Studio (which already
-- calls executeMonitorCheck() directly per-check), or a one-off:
--
--   import { executeMonitorCheck } from "./monitor-executor";
--   import { db, monitorChecksTable } from "@workspace/db";
--   import { eq } from "drizzle-orm";
--
--   const [check] = await db.select().from(monitorChecksTable)
--     .where(eq(monitorChecksTable.key, "diagnostics:ps-execution-test"));
--   const result = await executeMonitorCheck({
--     check,
--     tenantId: "<the testbed tenant's AAD GUID>",
--     triggerId: "manual-ps-execution-smoke-test",
--     skipIdempotency: true,
--     includeItems: true,
--   });
--   // Expect: result.status === "ok", result.itemCount >= 1,
--   // result.extractedProperties.connectionState === "Connected".
--
-- Requires PS_EXECUTION_CONTAINER_URL pointed at the live Container App and
-- the ps-execution-bearer-token Key Vault secret reachable from the api-server
-- environment (same Azure creds azure-keyvault.ts already uses).
