-- ============================================================================
-- New executorType 'dns' for exchange:dkim-spf-dmarc-status + drop
-- exchange:auto-forwarding-rules from assess:copilot-readiness (#496)
-- Parent epic #180. Manual migration — Shane runs this himself (no
-- DATABASE_URL in the Claude Code environment; nothing here has been
-- executed).
-- ============================================================================
--
-- ── KEY-NAME CORRECTION, confirmed against the live catalog before writing
--    this file (docs/check_key.json, docs/endpoints.json, and the #491
--    migration's own UPDATE targets) ───────────────────────────────────────
-- #496's issue text names 'compliance:dkim-spf-dmarc-status' and
-- 'compliance:auto-forwarding-rules'. Neither key exists — there is no
-- `compliance` engine namespace for either check anywhere in the catalog.
-- The real, live rows are 'exchange:dkim-spf-dmarc-status' and
-- 'exchange:auto-forwarding-rules' (both under the `exchange` namespace,
-- alongside every other Exchange Online check #491 wired). This file targets
-- the real keys, per #496's own "confirm and correct, don't assume" instruction.
--
-- ── WHAT THIS DOES ───────────────────────────────────────────────────────────
-- Part A: repoints exchange:dkim-spf-dmarc-status off the PowerShell/EXO
--         transport #491 gave it and onto the new 'dns' executor (code half
--         committed alongside this file — MONITOR_CHECK_EXECUTOR_TYPES in
--         lib/db/src/schema/msp.ts, runDnsCheck() + the executorType === 'dns'
--         branch in monitor-executor.ts's executeMonitorCheck()).
-- Part B: removes exchange:auto-forwarding-rules from the
--         assess:copilot-readiness package's check set (junction-table
--         membership IS the on/off switch here — monitoring_package_checks has
--         no status column, so deletion, not a flag flip, is the right
--         mechanism; confirmed by reading the table's own schema).
-- Part C: read-only receipts (before + after, both parts).
--
-- ── WHY exchange:dkim-spf-dmarc-status IS MOVING OFF POWERSHELL ─────────────
-- #491 (2026-08-06-exchange-checks-executor-wiring-491.sql) pointed this check
-- at PS get-dkim-disabled-domains (Get-DkimSigningConfig), explicitly flagging
-- at the time that only the DKIM third of the check's name was covered by that
-- cmdlet — SPF/DMARC are public DNS TXT records, not Exchange/Graph
-- configuration, and #491 had no DNS lookup capability to reach them with.
-- Epic #180's real-scope correction (discovered live, recorded on #496) then
-- found the PowerShell path itself was never viable for this check regardless:
-- Connect-ExchangeOnline app-only auth requires the tenant's connecting app to
-- hold the Entra directory role "Exchange Administrator" — Shane rejected that
-- as too broad a platform-wide grant ("would never allow this to register at
-- NASA"). SPF/DMARC need zero tenant auth at all (public DNS), and DKIM is
-- checkable the same way against Microsoft 365's two default key-rotation
-- selector names (selector1/selector2._domainkey.<domain>) — covering all
-- three thirds of the check's name via one Graph-free, PowerShell-free, no-
-- tenant-credential DNS lookup, which is what 'dns' now does.
--
-- exchange:auto-forwarding-rules has NO DNS equivalent (mail-flow/transport
-- rules are internal Exchange config, not published externally) and still
-- needs the same rejected broad grant to reach any other way — Shane's
-- explicit call (recorded on #496) is to drop it from what ships now rather
-- than build the narrower custom-role-group EXO workaround. It stays on
-- 'powershell' / cmdlet_unavailable exactly as #491 left it; this migration
-- does not touch monitor_checks for that key at all, only its
-- assess:copilot-readiness package membership. NOTE, flagged not fixed: the
-- key also remains linked to core:security-baseline
-- (2026-07-21-repopulate-monitoring-package-checks.sql) — #496's explicit
-- scope is assess:copilot-readiness only, so that linkage is deliberately
-- left as-is here.
--
-- ── REAL TESTBED TENANT ──────────────────────────────────────────────────────
-- c4c814d4-3afe-441e-9145-62461d0a4fd3 / mccawsoft2.onmicrosoft.com
-- Real public DNS lookups against this domain were run from this Claude Code
-- session (no DB needed for this, it's plain public DNS): SPF FOUND
-- ("v=spf1 include:spf.protection.outlook.com -all"), DMARC not found at
-- _dmarc.mccawsoft2.onmicrosoft.com, DKIM not found at either default
-- selector — all three genuinely checked, not assumed; DKIM/DMARC absence is
-- an honest real result for this tenant, not a bug.
--
-- Safe to run repeatedly: the UPDATE and DELETE below are both idempotent.

-- ══════════════════════════════════════════════════════════════════════════════════
-- PART A — exchange:dkim-spf-dmarc-status: BEFORE receipt, then repoint to 'dns'
-- ══════════════════════════════════════════════════════════════════════════════════

-- Run first, keep the output: confirms the row is exactly where #491 left it
-- (executor_type = 'powershell', ps_cmdlet_key = 'get-dkim-disabled-domains')
-- before this file changes it.
SELECT key, status, executor_type, ps_cmdlet_key, ps_params, endpoint, properties, mapping, severity_rules
FROM monitor_checks
WHERE key = 'exchange:dkim-spf-dmarc-status';

BEGIN;

-- The executor emits exactly ONE item per run — a domain's DNS posture is a
-- single fact, same reasoning the sharepoint-admin tenant-wide-setting
-- operations use (#394) — carrying these seven fields (see runDnsCheck() in
-- monitor-executor.ts for exactly how each is derived):
--   domain                              text  the tenant's own domain queried
--   spfRecord                           text  the raw "v=spf1..." TXT value, or null
--   spfConfigured                       bool  spfRecord is not null
--   dmarcRecord                         text  the raw "v=DMARC1..." TXT value, or null
--   dmarcConfigured                     bool  dmarcRecord is not null
--   dkimCheckedSelectors                array ["selector1","selector2"] (always, for transparency)
--   dkimFoundAtDefaultSelectors         array which of the two default selectors actually had a record
--   dkimConfiguredAtDefaultSelectors    bool  dkimFoundAtDefaultSelectors is non-empty
--
-- severity_rules below are worded per #496's explicit instruction: DKIM's rule
-- reads as "not found at Microsoft 365's default selectors", never "DKIM is
-- not configured" — a tenant using custom/rotated selector names could have a
-- real record this check cannot see, so the label must not assert certainty
-- it doesn't have. SPF/DMARC absence IS a confident negative (there is no
-- vendor-side selector ambiguity for either), so those two labels assert
-- plainly.
--
-- `endpoint` is NOT NULL on monitor_checks but is meaningless on this
-- executor — executor_type = 'dns' never reads it. Replaced with an explicit
-- placeholder, same convention runSharePointAdminCheck's migration used.
-- ps_cmdlet_key/ps_params are cleared (NULL) since this check no longer uses
-- the PowerShell transport at all.

UPDATE monitor_checks
SET executor_type  = 'dns',
    ps_cmdlet_key  = NULL,
    ps_params      = NULL,
    endpoint       = '(unused — executor_type=dns drives dispatch, not endpoint)',
    properties     = '[]'::jsonb,
    mapping        = '[
      {"sourceField":"domain","targetField":"domain","transform":"first"},
      {"sourceField":"spfRecord","targetField":"spfRecord","transform":"first"},
      {"sourceField":"spfConfigured","targetField":"spfConfigured","transform":"first"},
      {"sourceField":"dmarcRecord","targetField":"dmarcRecord","transform":"first"},
      {"sourceField":"dmarcConfigured","targetField":"dmarcConfigured","transform":"first"},
      {"sourceField":"dkimCheckedSelectors","targetField":"dkimCheckedSelectors","transform":"first"},
      {"sourceField":"dkimFoundAtDefaultSelectors","targetField":"dkimFoundAtDefaultSelectors","transform":"first"},
      {"sourceField":"dkimConfiguredAtDefaultSelectors","targetField":"dkimConfiguredAtDefaultSelectors","transform":"first"}
    ]'::jsonb,
    severity_rules = '[
      {"expression":"spfConfigured == false","severity":"warning",
       "label":"No SPF record found on the domain"},
      {"expression":"dmarcConfigured == false","severity":"warning",
       "label":"No DMARC record found at _dmarc.<domain>"},
      {"expression":"dkimConfiguredAtDefaultSelectors == false","severity":"info",
       "label":"No DKIM record found at Microsoft 365''s default selectors (selector1/selector2) -- a tenant using custom or rotated selector names may still have DKIM configured; this does not rule that out"}
    ]'::jsonb,
    updated_at     = now()
WHERE key = 'exchange:dkim-spf-dmarc-status';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-06-dns-executor-dkim-spf-dmarc-496.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════════
-- PART B — exchange:auto-forwarding-rules: BEFORE receipt, then drop from
--          assess:copilot-readiness
-- ══════════════════════════════════════════════════════════════════════════════════

-- Run first, keep the output: confirms whether the row is actually linked to
-- assess:copilot-readiness before this file touches anything (the package's
-- checks are DB-resident with no committed seed in this repo, per #441's own
-- confirmed finding for a different check — same situation here, so this is
-- not assumed).
SELECT package_key, check_key, sort_order
FROM monitoring_package_checks
WHERE check_key = 'exchange:auto-forwarding-rules'
ORDER BY package_key;

BEGIN;

-- monitoring_package_checks has no status/active column (confirmed by reading
-- its schema in lib/db/src/schema/msp.ts) — row PRESENCE is the only signal
-- executeMonitoringPackage() reads to decide package membership, so deletion
-- is the correct "disable" mechanism here, not a flag flip. Scoped to
-- assess:copilot-readiness only, per #496's explicit instruction; the
-- monitor_checks row itself and its separate core:security-baseline linkage
-- are both left untouched.
DELETE FROM monitoring_package_checks
WHERE package_key = 'assess:copilot-readiness'
  AND check_key = 'exchange:auto-forwarding-rules';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-06-dns-executor-dkim-spf-dmarc-496.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════════
-- PART C — READ-ONLY receipts
-- ══════════════════════════════════════════════════════════════════════════════════

-- 1. The repointed DNS check.
SELECT key, status, executor_type, endpoint, mapping, severity_rules
FROM monitor_checks
WHERE key = 'exchange:dkim-spf-dmarc-status';

-- 2. Nothing else moved: every other check must still be 'graph', 'powershell',
--    or 'sharepoint-admin'.
SELECT executor_type, count(*)
FROM monitor_checks
GROUP BY executor_type
ORDER BY executor_type;

-- 3. exchange:auto-forwarding-rules is gone from assess:copilot-readiness...
SELECT package_key, check_key, sort_order
FROM monitoring_package_checks
WHERE check_key = 'exchange:auto-forwarding-rules'
ORDER BY package_key;
-- ...expect ONLY 'core:security-baseline' (or zero rows if it was never
-- linked to assess:copilot-readiness in the first place) — never
-- 'assess:copilot-readiness'.

-- 4. The real testbed tenant's domain, for the manual DNS smoke test below.
SELECT id, customer_name, tenant_id, domain
FROM tenants
WHERE tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3'
   OR domain = 'mccawsoft2.onmicrosoft.com';


-- ── HOW TO EXERCISE IT AFTER RUNNING THIS ────────────────────────────────────
-- No credentials of any kind required — this is the whole point of the 'dns'
-- executor.
--
--   import { executeMonitorCheck } from "./monitor-executor";
--   import { db, monitorChecksTable } from "@workspace/db";
--   import { eq } from "drizzle-orm";
--
--   const [check] = await db.select().from(monitorChecksTable)
--     .where(eq(monitorChecksTable.key, "exchange:dkim-spf-dmarc-status"));
--   const result = await executeMonitorCheck({
--     check,
--     tenantId: "c4c814d4-3afe-441e-9145-62461d0a4fd3",
--     triggerId: "manual-dns-executor-smoke-test",
--     skipIdempotency: true,
--     includeItems: true,
--   });
--   // Expect: result.status === "ok", result.itemCount === 1,
--   // result.extractedProperties.domain === "mccawsoft2.onmicrosoft.com",
--   // spfConfigured === true (real SPF record confirmed present from this
--   // session's own live lookup), dmarcConfigured and
--   // dkimConfiguredAtDefaultSelectors reflecting whatever this tenant's real
--   // current DNS state is at run time (both were false as of this session's
--   // lookup, an honest "not found", not a bug).
--
-- The Simulator Studio also calls executeMonitorCheck() directly per check, so
-- running this check there exercises the same real dispatch path.
