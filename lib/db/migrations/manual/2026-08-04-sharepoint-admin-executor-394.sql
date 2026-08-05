-- ============================================================================
-- sharepoint:tenant-sharing-capability -> the real sharepoint-admin.ts path (#394)
-- Parent epic #343. Manual migration — Shane runs this himself (no DATABASE_URL
-- in the Claude Code environment; nothing here has been executed).
-- ============================================================================
--
-- ── WHAT THIS DOES ───────────────────────────────────────────────────────────
-- Part A: ONE additive column, monitor_checks.sp_operation.
-- Part B: repoints sharepoint:tenant-sharing-capability off Graph and onto the
--         new 'sharepoint-admin' executor, including the mapping/properties that
--         match what that executor really emits.
-- Part C: read-only receipts (before + after).
--
-- ── SYMPTOM THIS FIXES (real, from this platform's own data) ─────────────────
-- The check's stored endpoint is the literal string
-- `sharepoint-admin://tenant-settings`, which was being sent to Microsoft Graph
-- verbatim. Every run for months has produced the same failure:
--   Graph API error 400: {"error":{"code":"BadRequest","message":
--   "Resource not found for the segment 'sharepoint-admin:'."}}
-- Graph has no tenant-sharing-capability API at all: tenant-wide external
-- sharing lives on the SharePoint Online resource
-- (00000003-0000-0ff1-ce00-000000000000), read via CSOM ProcessQuery against
-- {prefix}-admin.sharepoint.com with a CERTIFICATE-based app-only token. That
-- integration already exists and is already cert-tested —
-- artifacts/api-server/src/lib/sharepoint-admin.ts's
-- getTenantSharingCapability() — it had simply never been wired into check
-- dispatch. This file is the DATA half of that wiring.
--
-- The CODE half is committed alongside this file:
--   monitor-executor.ts — SHAREPOINT_ADMIN_OPERATIONS (a code-owned registry),
--     runSharePointAdminCheck(), and the executorType === 'sharepoint-admin'
--     branch in executeMonitorCheck().
--   lib/db/src/schema/msp.ts — 'sharepoint-admin' added to
--     MONITOR_CHECK_EXECUTOR_TYPES, plus the spOperation column below.
--
-- ── PREREQUISITE THAT IS *NOT* SQL (see the note at the bottom) ──────────────
-- Sites.FullControl.All on "Office 365 SharePoint Online" must be admin-
-- consented for the tenant being scanned. That consent is tracked separately
-- from Graph consent (tenants.consent -> 'sharepoint'), and this migration
-- neither grants nor checks it. Part C's last query reports it.

-- ══════════════════════════════════════════════════════════════════════════════════
-- PART A — SCHEMA: one additive column on monitor_checks
-- ══════════════════════════════════════════════════════════════════════════════════
-- Deliberately ONE column, not a family. executor_type already exists (added by
-- 2026-07-31-monitor-checks-powershell-executor.sql) and needs no DDL change —
-- it is a plain `text` column with a 'graph' default and no CHECK constraint, so
-- the new value is accepted as-is and every existing row keeps reading 'graph'.
--
-- No params column is added: getTenantSharingCapability() takes only the tenant
-- ref, and the tenant ref is resolved at dispatch time from the tenant's own
-- identity (tenants.tenant_id for the AAD GUID; the SharePoint host prefix from
-- tenants.domain, the initial *.onmicrosoft.com domain consent.ts already
-- stamps). Storing either of those on the check row would duplicate identity
-- that already exists and would make one check definition tenant-specific.
-- A future site-scoped operation (e.g. per-site storage quota) that genuinely
-- needs arguments can add its own params column then, additively, the same way.

BEGIN;

ALTER TABLE monitor_checks
  ADD COLUMN IF NOT EXISTS sp_operation text;

COMMENT ON COLUMN monitor_checks.sp_operation IS
  'Identifier resolved server-side against the code-owned SHAREPOINT_ADMIN_OPERATIONS registry in monitor-executor.ts — never a URL and never a script, the same contract ps_cmdlet_key follows. NULL unless executor_type = ''sharepoint-admin''.';

COMMENT ON COLUMN monitor_checks.executor_type IS
  '''graph'' (default, every pre-existing check) = the endpoint/method/... columns drive a Graph REST fetch. ''powershell'' = ps_cmdlet_key/ps_params drive a ps-execution container call instead. ''sharepoint-admin'' = sp_operation drives a certificate-authenticated SharePoint Online tenant-admin call (sharepoint-admin.ts) instead.';

COMMIT;


-- ══════════════════════════════════════════════════════════════════════════════════
-- PART B — BEFORE receipt, then repoint the check
-- ══════════════════════════════════════════════════════════════════════════════════
-- Run this SELECT first and keep the output: the current mapping/properties/
-- severity_rules were written against a Graph response that never once arrived
-- (see the 400 above), so Part B replaces the mapping and properties. Nothing
-- else about the row changes.

SELECT key, status, executor_type, endpoint, method, properties, mapping, severity_rules
FROM monitor_checks
WHERE key = 'sharepoint:tenant-sharing-capability';

-- The executor emits exactly ONE item per run — a tenant-wide setting is a
-- single fact — carrying these four fields, derived in code from the real
-- SharingCapability enum sharepoint-admin.ts returns:
--   sharingCapability        int     0..3 (Microsoft's SharingCapability enum)
--   sharingCapabilityName    text    'Disabled' | 'ExternalUserSharingOnly'
--                                    | 'ExternalUserAndGuestSharing'
--                                    | 'ExistingExternalUserSharingOnly'
--   externalSharingEnabled   bool    capability <> Disabled
--   anonymousSharingEnabled  bool    capability = ExternalUserAndGuestSharing
--                                    (the "Anyone" level — sign-in-free links)
-- The mapping below lifts all four onto extracted_properties with the same
-- names, via the existing `first` transform (one item in, one value out).
--
-- `endpoint` is NOT NULL on monitor_checks (shared with every Graph check) but
-- is meaningless on this executor — executor_type = 'sharepoint-admin' never
-- reads it. It is replaced with an explicit placeholder rather than left as the
-- dead `sharepoint-admin://tenant-settings` URL, which reads like a real
-- endpoint and is exactly what caused this bug. Same convention
-- diagnostics:ps-execution-test already uses.

UPDATE monitor_checks
SET executor_type = 'sharepoint-admin',
    sp_operation  = 'tenant-sharing-capability',
    endpoint      = '(unused — executor_type=sharepoint-admin drives dispatch, not endpoint)',
    properties    = '[]'::jsonb,
    mapping       = '[
      {"sourceField":"sharingCapability","targetField":"sharingCapability","transform":"first"},
      {"sourceField":"sharingCapabilityName","targetField":"sharingCapabilityName","transform":"first"},
      {"sourceField":"externalSharingEnabled","targetField":"externalSharingEnabled","transform":"first"},
      {"sourceField":"anonymousSharingEnabled","targetField":"anonymousSharingEnabled","transform":"first"}
    ]'::jsonb,
    updated_at    = now()
WHERE key = 'sharepoint:tenant-sharing-capability';

-- OPTIONAL, NOT RUN BY DEFAULT — severity_rules are left exactly as they are.
-- If the BEFORE receipt shows rules written against the old imagined Graph
-- fields, they will simply never match (classifySeverity skips what it can't
-- resolve) and the check will report OK with real data and no finding. This is
-- the honest rule keyed on what the executor actually emits — uncomment and run
-- it after reviewing the BEFORE output:
--
-- UPDATE monitor_checks
-- SET severity_rules = '[
--       {"expression":"anonymousSharingEnabled == true","severity":"warning",
--        "label":"Tenant-wide sharing allows Anyone (anonymous) links"}
--     ]'::jsonb,
--     updated_at = now()
-- WHERE key = 'sharepoint:tenant-sharing-capability';


-- ══════════════════════════════════════════════════════════════════════════════════
-- PART C — READ-ONLY receipts
-- ══════════════════════════════════════════════════════════════════════════════════

-- 1. The repointed row.
SELECT key, status, executor_type, sp_operation, endpoint, mapping, severity_rules
FROM monitor_checks
WHERE key = 'sharepoint:tenant-sharing-capability';

-- 2. Nothing else moved: every other check must still be 'graph' or 'powershell'.
SELECT executor_type, count(*)
FROM monitor_checks
GROUP BY executor_type
ORDER BY executor_type;

-- 3. The real blocker check — does the tenant you are about to scan actually
--    have the SEPARATE SharePoint consent? Graph consent does NOT imply it:
--    Sites.FullControl.All is an Application permission on a DIFFERENT resource
--    and is stamped into tenants.consent -> 'sharepoint' by
--    /api/admin/sharepoint-consent/callback. No row/key = never granted, which
--    is what the portal's ReconsentPill surfaces as its third state.
--    Expect status = 'granted' AND grants containing 'Sites.FullControl.All';
--    anything else means this check will fail with a SharePoint 401, NOT a
--    Graph consent problem, and the fix is the /portal/consent/sharepoint-link
--    flow, not a re-consent of Graph.
SELECT t.id,
       t.customer_name,
       t.tenant_id,
       t.domain,
       t.consent -> 'graph'      ->> 'status' AS graph_consent_status,
       t.consent -> 'sharepoint' ->> 'status' AS sharepoint_consent_status,
       t.consent -> 'sharepoint' ->  'grants' AS sharepoint_permissions_granted
FROM tenants t
WHERE t.is_testbed = true
   OR t.status = 'active'
ORDER BY t.is_testbed DESC, t.id;


-- ── HOW TO EXERCISE IT AFTER RUNNING THIS ────────────────────────────────────
-- Requires MT_APP_CLIENT_ID + MT_APP_CERT_PRIVATE_KEY + MT_APP_CERT_THUMBPRINT
-- in the api-server environment (the certificate on the multi-tenant app
-- registration — a client secret is rejected by the SharePoint resource), and
-- the tenant's SharePoint consent from query 3 above.
--
--   import { executeMonitorCheck } from "./monitor-executor";
--   import { db, monitorChecksTable } from "@workspace/db";
--   import { eq } from "drizzle-orm";
--
--   const [check] = await db.select().from(monitorChecksTable)
--     .where(eq(monitorChecksTable.key, "sharepoint:tenant-sharing-capability"));
--   const result = await executeMonitorCheck({
--     check,
--     tenantId: "<the testbed tenant's AAD GUID>",
--     triggerId: "manual-sharepoint-admin-smoke-test",
--     skipIdempotency: true,
--     includeItems: true,
--   });
--   // Expect: result.status === "ok", result.itemCount === 1, and
--   // result.extractedProperties.sharingCapabilityName being one of the four
--   // real enum names — NOT the old "Resource not found for the segment" 400.
--
-- The Simulator Studio also calls executeMonitorCheck() directly per check, so
-- running this check there exercises the same real dispatch path.
