-- Fix Exchange Checks Sending Literal Pseudo-URI to Graph (#491)
-- Manual migration — Shane runs this himself (no DATABASE_URL in the Claude env).
--
-- ── WHAT THIS DOES ───────────────────────────────────────────────────────────────
-- #485 found all 11 `exchange:*` monitor_checks rows have `endpoint` set to a
-- literal PowerShell-style pseudo-URI (e.g. `exchange-online://Get-TransportRule`)
-- that was never intercepted — executor_type defaults to 'graph' for every row
-- (lib/db/src/schema/msp.ts:1696) and nothing ever set it to 'powershell' for
-- these 11, so Graph got the literal string concatenated onto its base URL and
-- correctly 400'd ("Resource not found for the segment 'exchange-online:'").
-- #491 is the wiring fix. Investigated PER CHECK, not assumed uniform (10 of 11
-- go PowerShell, 1 has a genuine Graph v1.0 equivalent) — see each UPDATE's own
-- comment for the specific reasoning and citations.
--
-- ── WHAT THIS DELIBERATELY DOES NOT TOUCH ───────────────────────────────────────
-- `mapping` / `properties` / `severity_rules` on all 11 rows are left completely
-- untouched. These checks already exist (unlike #212's DLP/Label checks, which
-- were fresh INSERTs) and this session has no DATABASE_URL/read access to see
-- what's currently configured — guessing field names or PostFilter thresholds
-- against un-inspectable existing severity_rules risked contradicting whatever
-- scoring Shane (or a prior session) already set up. `_itemCount = items.length`
-- (set unconditionally by applyMapping()) is correct regardless of what the
-- `mapping` rows' sourceField names are — at worst a named display property
-- comes back null if a field name doesn't match the real cmdlet's output shape,
-- not a severity/status regression. FLAGGED for Shane: once real items flow,
-- confirm severity_rules on `litigation-hold-coverage` / `archive-mailbox-rate`
-- / `antispam-policy-coverage` / `dkim-spf-dmarc-status` / `connector-health` /
-- `auto-forwarding-rules` still make sense against the PostFilter-narrowed
-- "gap count" shape the PS side now returns for those (see entrypoint.ps1's
-- #491 catalog comments) rather than a raw total.
--
-- ── PER-CHECK ROUTING (researched against current Microsoft Learn docs and this
--    codebase's real architecture, 2026-08-06 — full citations in
--    services/ps-execution/entrypoint.ps1's #491 catalog block) ──────────────────
--   exchange:antispam-policy-coverage -> PS get-antispam-policies (Get-HostedContentFilterPolicy).
--     No Graph v1.0 equivalent — EOP anti-spam policies are Exchange-only.
--   exchange:mailbox-quota-utilization -> PS get-mailbox-quota-utilization (composed
--     Get-Mailbox | Get-MailboxStatistics script — no Graph v1.0 mailbox-quota
--     endpoint exists, and Get-MailboxStatistics alone has no tenant-wide form in
--     EXO, confirmed against Microsoft Learn: Identity is Mandatory=True).
--   exchange:litigation-hold-coverage -> PS get-litigation-hold-gap (Get-Mailbox,
--     PostFilter narrows to LitigationHoldEnabled=$false). No Graph equivalent.
--   exchange:transport-rule-count -> PS get-transport-rules (Get-TransportRule).
--     No Graph equivalent — mail flow rules are Exchange-only.
--   exchange:shared-mailbox-licensing -> PS get-shared-mailboxes (Get-Mailbox
--     -RecipientTypeDetails SharedMailbox). No Graph equivalent for recipient
--     type; the "Licensing" half of this check's name is NOT covered (would need
--     a Graph assignedLicenses cross-reference per mailbox UPN — out of scope,
--     flagged in entrypoint.ps1's own comment).
--   exchange:mail-flow-rule-review -> PS get-transport-rules (SAME cmdletKey as
--     transport-rule-count — one catalog entry, two check rows, no PostFilter;
--     "review" reads as "here's the full list", not a pre-filtered subset).
--   exchange:connector-health -> PS get-inbound-connector-tls-gap
--     (Get-InboundConnector, PostFilter narrows to RequireTls=$false — Microsoft's
--     own documented connector security-baseline flag). No Graph equivalent.
--   exchange:distribution-list-count -> GRAPH, real endpoint (see below). Exchange
--     distribution groups ARE represented as Microsoft Graph `group` resources
--     (mailEnabled=true, securityEnabled=false, not in the 'Unified' groupType) —
--     confirmed against Microsoft Learn's groups-overview docs. executor_type
--     stays 'graph' (the existing default); only `endpoint` changes.
--   exchange:archive-mailbox-rate -> PS get-archive-mailbox-gap (Get-Mailbox,
--     PostFilter narrows to ArchiveStatus != 'Active'). No Graph equivalent.
--   exchange:auto-forwarding-rules -> PS get-auto-forward-risk-policies
--     (Get-HostedOutboundSpamFilterPolicy, PostFilter narrows to
--     AutoForwardingMode='On'). Deliberately NOT Get-InboxRule (the literal
--     pseudo-URI's cmdlet) — Get-InboxRule requires a per-mailbox Identity in EXO
--     (confirmed via Microsoft Learn) and has no tenant-wide form, same limitation
--     Graph's own messageRules per-user equivalent has; rerouted to the real
--     tenant-wide EXO security-baseline control for external auto-forwarding
--     instead. FLAGGED: this check's untouched severity_rules were presumably
--     authored against a per-mailbox-rule-count assumption that never actually
--     ran — confirm thresholds against this policy-level count (usually 0 or 1).
--   exchange:dkim-spf-dmarc-status -> PS get-dkim-disabled-domains
--     (Get-DkimSigningConfig, PostFilter narrows to Enabled=$false). FLAGGED:
--     only the DKIM third of this check's name is covered — SPF/DMARC are public
--     DNS TXT records, not Exchange/Graph configuration, and would need a DNS
--     lookup capability this container doesn't have. Out of #491's wiring-fix
--     scope, not fabricated.
--
-- ── CRITICAL PREREQUISITE — NOT SOMETHING THIS MIGRATION CAN DO ─────────────────
-- All 9 new PS cmdletKeys above are Exchange Online Management cmdlets (Get-Mailbox,
-- Get-TransportRule, etc.) — NOT Security & Compliance/Purview cmdlets. They
-- require the ps-execution container to open a Connect-ExchangeOnline session
-- (added this session, entrypoint.ps1's `Session = "exchange"` branch), which
-- needs the SAME app-only cert already used for Graph/Purview to ALSO be granted
-- the Exchange.ManageAsApp API permission and have its service principal added to
-- an Exchange RBAC role group (e.g. "View-Only Organization Management"). This
-- session has no Azure/Graph/DB reachability to configure or verify that — until
-- it's done, every one of these 9 checks will surface as `cmdlet_unavailable`
-- (an honest license_gap-shaped result, not silently wrong data — see
-- monitor-executor.ts's licenseGapFeatureForCmdletKey/#491 comments), not "ok".
--
-- ── REAL TESTBED TENANT ──────────────────────────────────────────────────────
-- c4c814d4-3afe-441e-9145-62461d0a4fd3 / mccawsoft2.onmicrosoft.com
--
-- Safe to run repeatedly: every UPDATE is a no-op if already applied (idempotent
-- via WHERE key = ... AND executor_type IS DISTINCT FROM the target).

BEGIN;

UPDATE "monitor_checks" SET
  "endpoint" = '(unused — executorType=powershell drives dispatch, not endpoint)',
  "executor_type" = 'powershell',
  "ps_cmdlet_key" = 'get-antispam-policies',
  "ps_params" = '{"Organization":"{organization}"}'::jsonb
WHERE "key" = 'exchange:antispam-policy-coverage';

UPDATE "monitor_checks" SET
  "endpoint" = '(unused — executorType=powershell drives dispatch, not endpoint)',
  "executor_type" = 'powershell',
  "ps_cmdlet_key" = 'get-mailbox-quota-utilization',
  "ps_params" = '{"Organization":"{organization}"}'::jsonb
WHERE "key" = 'exchange:mailbox-quota-utilization';

UPDATE "monitor_checks" SET
  "endpoint" = '(unused — executorType=powershell drives dispatch, not endpoint)',
  "executor_type" = 'powershell',
  "ps_cmdlet_key" = 'get-litigation-hold-gap',
  "ps_params" = '{"Organization":"{organization}","ResultSize":"Unlimited"}'::jsonb
WHERE "key" = 'exchange:litigation-hold-coverage';

UPDATE "monitor_checks" SET
  "endpoint" = '(unused — executorType=powershell drives dispatch, not endpoint)',
  "executor_type" = 'powershell',
  "ps_cmdlet_key" = 'get-transport-rules',
  "ps_params" = '{"Organization":"{organization}"}'::jsonb
WHERE "key" = 'exchange:transport-rule-count';

UPDATE "monitor_checks" SET
  "endpoint" = '(unused — executorType=powershell drives dispatch, not endpoint)',
  "executor_type" = 'powershell',
  "ps_cmdlet_key" = 'get-shared-mailboxes',
  "ps_params" = '{"Organization":"{organization}","ResultSize":"Unlimited","RecipientTypeDetails":"SharedMailbox"}'::jsonb
WHERE "key" = 'exchange:shared-mailbox-licensing';

UPDATE "monitor_checks" SET
  "endpoint" = '(unused — executorType=powershell drives dispatch, not endpoint)',
  "executor_type" = 'powershell',
  "ps_cmdlet_key" = 'get-transport-rules',
  "ps_params" = '{"Organization":"{organization}"}'::jsonb
WHERE "key" = 'exchange:mail-flow-rule-review';

UPDATE "monitor_checks" SET
  "endpoint" = '(unused — executorType=powershell drives dispatch, not endpoint)',
  "executor_type" = 'powershell',
  "ps_cmdlet_key" = 'get-inbound-connector-tls-gap',
  "ps_params" = '{"Organization":"{organization}"}'::jsonb
WHERE "key" = 'exchange:connector-health';

-- Real Graph v1.0 equivalent — see header. `NOT groupTypes/any(...)` requires
-- ConsistencyLevel: eventual, which monitor-executor.ts's graphFetchForTenant
-- already attaches automatically to any GET whose URL contains `$filter=`
-- (artifacts/api-server/src/lib/monitor-executor.ts, ~line 1381) — no code
-- change needed for that. executor_type stays 'graph' (already the default);
-- set explicitly here so the row's intent is unambiguous, not implicit.
UPDATE "monitor_checks" SET
  "endpoint" = '/groups?$filter=mailEnabled eq true and securityEnabled eq false and NOT groupTypes/any(c:c eq ''Unified'')',
  "executor_type" = 'graph'
WHERE "key" = 'exchange:distribution-list-count';

UPDATE "monitor_checks" SET
  "endpoint" = '(unused — executorType=powershell drives dispatch, not endpoint)',
  "executor_type" = 'powershell',
  "ps_cmdlet_key" = 'get-archive-mailbox-gap',
  "ps_params" = '{"Organization":"{organization}","ResultSize":"Unlimited"}'::jsonb
WHERE "key" = 'exchange:archive-mailbox-rate';

UPDATE "monitor_checks" SET
  "endpoint" = '(unused — executorType=powershell drives dispatch, not endpoint)',
  "executor_type" = 'powershell',
  "ps_cmdlet_key" = 'get-auto-forward-risk-policies',
  "ps_params" = '{"Organization":"{organization}"}'::jsonb
WHERE "key" = 'exchange:auto-forwarding-rules';

UPDATE "monitor_checks" SET
  "endpoint" = '(unused — executorType=powershell drives dispatch, not endpoint)',
  "executor_type" = 'powershell',
  "ps_cmdlet_key" = 'get-dkim-disabled-domains',
  "ps_params" = '{"Organization":"{organization}"}'::jsonb
WHERE "key" = 'exchange:dkim-spf-dmarc-status';


INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-06-exchange-checks-executor-wiring-491.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════════
-- READ-ONLY: verify all 11 rows
-- ══════════════════════════════════════════════════════════════════════════════════

SELECT key, executor_type, ps_cmdlet_key, endpoint, ps_params, status
FROM monitor_checks
WHERE key IN (
  'exchange:antispam-policy-coverage',
  'exchange:mailbox-quota-utilization',
  'exchange:litigation-hold-coverage',
  'exchange:transport-rule-count',
  'exchange:shared-mailbox-licensing',
  'exchange:mail-flow-rule-review',
  'exchange:connector-health',
  'exchange:distribution-list-count',
  'exchange:archive-mailbox-rate',
  'exchange:auto-forwarding-rules',
  'exchange:dkim-spf-dmarc-status'
)
ORDER BY key;


-- ── HOW TO RUN THE END-TO-END TEST (NOT DONE HERE — needs a live DB + the real
--    container + the Exchange RBAC prerequisite above, none reachable from the
--    Claude Code environment) ─────────────────────────────────────────────────
--   import { executeMonitorCheck } from "./monitor-executor";
--   import { db, monitorChecksTable } from "@workspace/db";
--   import { inArray } from "drizzle-orm";
--
--   const TENANT_ID = "c4c814d4-3afe-441e-9145-62461d0a4fd3";
--   const KEYS = [
--     "exchange:antispam-policy-coverage", "exchange:mailbox-quota-utilization",
--     "exchange:litigation-hold-coverage", "exchange:transport-rule-count",
--     "exchange:shared-mailbox-licensing", "exchange:mail-flow-rule-review",
--     "exchange:connector-health", "exchange:distribution-list-count",
--     "exchange:archive-mailbox-rate", "exchange:auto-forwarding-rules",
--     "exchange:dkim-spf-dmarc-status",
--   ];
--   const checks = await db.select().from(monitorChecksTable).where(inArray(monitorChecksTable.key, KEYS));
--   for (const check of checks) {
--     const result = await executeMonitorCheck({
--       check, tenantId: TENANT_ID, triggerId: "manual-491-smoke-test",
--       skipIdempotency: true, includeItems: true,
--     });
--     console.log(check.key, result.status, result.itemCount, result.extractedProperties);
--   }
--   // Expect: every result.status === "ok" once the Exchange RBAC prerequisite is
--   // configured. Until then, expect "license_gap" with
--   // _licenseGapCode: "cmdlet_unavailable" — an honest, already-handled result,
--   // not a bug. A genuine license_gap signature (as opposed to the RBAC-gap
--   // explanation above) is also possible and cannot be distinguished from here —
--   // #491's own issue text flags this: check the real error text once live data
--   // flows, and if any of these 11 show a genuine SKU-tier signature (not
--   // cmdlet_unavailable, e.g. a real 403 naming a missing add-on), that's new
--   // information this migration's routing fix could not have anticipated.
