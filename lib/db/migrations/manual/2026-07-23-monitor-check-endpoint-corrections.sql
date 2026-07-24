-- Monitor Check Endpoint Corrections — Real Graph v1.0 Syntax Fixes
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- ── WHY THIS IS SQL AND NOT CODE ────────────────────────────────────────────────
-- Every monitor check's request URL is DATA, stored in monitor_checks.endpoint.
-- monitor-executor.ts:executeMonitorCheck() passes check.endpoint straight into
-- graphFetchPaginated(), which does exactly one thing with it: prefixes it with
-- https://graph.microsoft.com/v1.0 unless it already starts with "http". There is
-- no per-check request-building logic anywhere in the repo. So a check whose
-- stored endpoint has the wrong Graph syntax can ONLY be fixed here, by changing
-- the stored string — there is no TypeScript to edit for these.
--
-- The two genuinely code-side bugs in this batch were fixed separately in
-- commit 8588ec38 (usage-report CSV bodies being handed to JSON.parse, and the
-- {id} placeholder never being substituted). This file is the data half.
--
-- ── SOURCE OF TRUTH ─────────────────────────────────────────────────────────────
-- Failures were confirmed from live error_message rows on the real test tenant
-- (msp_customers.id = 4). Every replacement endpoint below was verified against
-- current learn.microsoft.com Graph v1.0 documentation; the specific doc page is
-- cited per statement. Where the correct endpoint could NOT be confirmed, the
-- statement is left COMMENTED OUT with the open question stated plainly rather
-- than guessed at — a wrong endpoint on a production scan is worse than a known
-- gap.
--
-- ── HOW TO RUN ──────────────────────────────────────────────────────────────────
-- PART A is read-only: it shows the current endpoint for every check this file
-- touches, so the before/after is on the record before anything changes.
-- PART B is the corrections, inside a transaction. Review PART A's output first,
-- then run PART B and check the receipt before COMMIT.
--
-- NOT verified against live data from the authoring environment: there is no
-- DATABASE_URL available to Claude Code sessions in this repo. Shane runs this
-- and re-runs a scan to confirm the real before/after failing-check counts.


-- ════════════════════════════════════════════════════════════════════════════════
-- PART A — READ-ONLY: current stored endpoints for every check touched below
-- ════════════════════════════════════════════════════════════════════════════════

SELECT key, method, endpoint, status
FROM monitor_checks
WHERE key IN (
  'adoption:email-activity-trend',
  'adoption:overall-active-rate',
  'adoption:sharepoint-onedrive-trend',
  'adoption:teams-activity-trend',
  'copilot:active-usage-rate',
  'copilot:usage-by-app',
  'onedrive:storage-utilization',
  'platform:branding-config',
  'identity:pim-eligible-roles',
  'identity:pim-groups',
  'adoption:planner-usage',
  'identity:continuous-access-evaluation',
  'devices:app-protection-coverage',
  'devices:update-rings-config',
  'teams:rooms-device-health'
)
ORDER BY key;


-- ════════════════════════════════════════════════════════════════════════════════
-- PART B — CORRECTIONS
-- Review PART A output first. Run inside the transaction and check the receipt.
-- ════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Microsoft 365 usage reports — mandatory period parameter ────────────────
-- Real error: "Resource not found for the segment 'getEmailActivityUserDetail'"
-- (and equivalents). These are OData BOUND FUNCTIONS: the period argument is part
-- of the path segment, in parentheses with single quotes — NOT a query string.
-- `?period=D7` is wrong and produces exactly the observed error; `(period='D7')`
-- is correct. Valid values for these: D7, D30, D90, D180 (ALL is NOT valid here).
-- Docs: learn.microsoft.com/en-us/graph/api/reportroot-getemailactivityuserdetail
--       (and the sibling getOffice365ActiveUserDetail / getSharePointSiteUsageDetail
--        / getOneDriveUsageAccountDetail / getTeamsUserActivityUserDetail pages)
-- Permission: Reports.Read.All (Application) — already in REQUIRED_MT_SCOPES.
--
-- These endpoints answer 302 -> a pre-authenticated CSV download. That response
-- shape is handled by the companion code fix (8588ec38); without it these checks
-- would fail on JSON.parse even with the correct URL. Both halves are required.
--
-- D7 chosen deliberately: it is the shortest window, so it is the cheapest call
-- and the most responsive to change. Widen per-check later if a trend needs it.

UPDATE monitor_checks
SET endpoint = '/reports/getEmailActivityUserDetail(period=''D7'')', updated_at = now()
WHERE key = 'adoption:email-activity-trend';

UPDATE monitor_checks
SET endpoint = '/reports/getOffice365ActiveUserDetail(period=''D7'')', updated_at = now()
WHERE key = 'adoption:overall-active-rate';

UPDATE monitor_checks
SET endpoint = '/reports/getSharePointSiteUsageDetail(period=''D7'')', updated_at = now()
WHERE key = 'adoption:sharepoint-onedrive-trend';

UPDATE monitor_checks
SET endpoint = '/reports/getTeamsUserActivityUserDetail(period=''D7'')', updated_at = now()
WHERE key = 'adoption:teams-activity-trend';

-- ── 2. Copilot usage reports — /copilot/ path segment + period ─────────────────
-- Same bound-function period syntax, but note the PATH IS DIFFERENT: Microsoft
-- has superseded /reports/getMicrosoft365Copilot* with the /copilot/reports/
-- segment ("Going forward, use the Microsoft 365 Copilot usage APIs under the
-- /copilot URL path segment"). Using the old /reports/ path is a second reason
-- these two fail beyond the missing period.
-- Docs: learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/api/
--       admin-settings/reports/copilotreportroot-getmicrosoft365copilotusageuserdetail
--       ...-getmicrosoft365copilotusercounttrend
-- Permission: Reports.Read.All (Application) — already in REQUIRED_MT_SCOPES.
-- Response: v1.0 returns 200 with a CSV stream directly (no 302) — also covered
-- by the companion CSV fix.
-- Caveat: only licensed Copilot users appear. A tenant with no Copilot licences
-- legitimately returns an empty report; that is real data, not a failure.

UPDATE monitor_checks
SET endpoint = '/copilot/reports/getMicrosoft365CopilotUsageUserDetail(period=''D7'')', updated_at = now()
WHERE key = 'copilot:active-usage-rate';

-- usage-by-app: getMicrosoft365CopilotUsageUserDetail gives per-app LAST ACTIVITY
-- DATE columns only. getMicrosoft365CopilotUserCountTrend is the real per-app
-- breakdown (enabled/active user counts per app per day), which is what a
-- "usage by app" signal actually wants.
UPDATE monitor_checks
SET endpoint = '/copilot/reports/getMicrosoft365CopilotUserCountTrend(period=''D7'')', updated_at = now()
WHERE key = 'copilot:usage-by-app';

-- ── 3. platform:branding-config — {id} placeholder ─────────────────────────────
-- Real error: "Invalid object identifier '{id}'" — the literal braces went to
-- Graph. The v1.0 shape genuinely requires the organization GUID inline; there is
-- no `me`/`default` alias for the {organizationId} segment (the default/0 alias
-- exists only one level deeper, on /branding/localizations).
-- Docs: learn.microsoft.com/en-us/graph/api/organizationalbranding-get
--
-- The companion code fix (8588ec38) makes resolveEndpointPlaceholders substitute
-- {id} with the real tenant GUID, so the stored string below is now correct AS
-- WRITTEN and needs no change if it already reads /organization/{id}/branding.
-- This statement is therefore a NORMALISER: it guarantees the stored value is
-- exactly the form the resolver understands.
--
-- KNOWN REMAINING CAVEAT (not fixable here, flagged for Shane): the docs mark
-- Accept-Language a REQUIRED header on this endpoint, and graphFetchForTenant
-- sends no Accept-Language. Graph may still answer without it. Also note a 404
-- from this endpoint means "no branding configured" — a completely normal state
-- for most tenants — and will currently be recorded as a check error rather than
-- an honest "not configured". Worth a follow-up; not silently changed here.
UPDATE monitor_checks
SET endpoint = '/organization/{id}/branding', updated_at = now()
WHERE key = 'platform:branding-config';

-- ── 4. onedrive:storage-utilization — quota is metadata, not a download ────────
-- Real error: "InvalidDownloadToken" — thrown by /content paths, which stream
-- file BYTES. Quota is a facet on the drive object itself, so no download is
-- involved. Docs: learn.microsoft.com/en-us/graph/api/drive-get
--
-- Deliberately NOT using /sites/{id}/drive or /drives/{id}: drive-get's doc table
-- lists Application permissions as "Not supported", so an app-only quota read is
-- UNCONFIRMED, and it would also require per-site iteration. The usage report
-- below returns Storage Used / Storage Allocated per account in ONE call under
-- Reports.Read.All, which the platform already holds and which is already proven
-- to work for the other report checks in this file.
UPDATE monitor_checks
SET endpoint = '/reports/getOneDriveUsageAccountDetail(period=''D7'')', updated_at = now()
WHERE key = 'onedrive:storage-utilization';

-- ── 5. identity:pim-groups — $filter is MANDATORY ──────────────────────────────
-- PIM for Groups requires $filter scoping the request to a principalId or a
-- groupId: "This method requires the $filter (eq) query parameter to scope the
-- request to a principalId or a groupId."
-- Docs: learn.microsoft.com/en-us/graph/api/privilegedaccessgroup-list-eligibilityschedules
--
-- NOT UPDATED — DELIBERATE, AND THIS NEEDS SHANE'S DECISION.
-- There is no tenant-wide form of this endpoint. It cannot be expressed as a
-- single stored URL: covering a tenant requires iterating every group and issuing
-- one request per group, which the executor's one-check-one-URL model does not
-- support. Writing any single-group URL here would produce a check that silently
-- reports on ONE group while appearing to cover the tenant — worse than the
-- current honest failure.
-- OPEN QUESTION: either this check is dropped, or the executor needs a real
-- fan-out capability. Not decided unilaterally.
--
-- UPDATE monitor_checks SET endpoint = '...' WHERE key = 'identity:pim-groups';

-- ── 6. identity:pim-eligible-roles — the '*' culture error ─────────────────────
-- Real error: "CultureNotFoundException... '*' is an invalid culture identifier."
-- /roleManagement/directory/roleEligibilitySchedules is a VALID v1.0 path that
-- requires no filter, so the base path is not the problem — a literal '*' in the
-- stored query string is. Graph does not support wildcard $select/$expand; the
-- '*' reaches a server-side culture parse and throws this misleading error.
--
-- I investigated the leading external theory that a global `Accept-Language: *`
-- header was the cause: it is FALSE for this codebase. There is no
-- Accept-Language header anywhere in the repo (graphFetchForTenant sends only
-- Authorization + Content-Type), so the '*' can only be coming from the stored
-- endpoint string itself.
--
-- Docs: learn.microsoft.com/en-us/graph/api/rbacapplication-list-roleeligibilityschedules
-- Permission: RoleEligibilitySchedule.Read.Directory / RoleManagement.Read.All.
--   >> NOTE: neither is in REQUIRED_MT_SCOPES. Directory.Read.All does NOT cover
--   >> this. Even with the URL corrected, this check may still fail on scope.
--   >> Reported, NOT added — scope changes force re-consent on every tenant and
--   >> belong to their own task.
--
-- $expand=principal is the documented, supported expansion (vs the invalid '*').
UPDATE monitor_checks
SET endpoint = '/roleManagement/directory/roleEligibilitySchedules?$expand=principal', updated_at = now()
WHERE key = 'identity:pim-eligible-roles';

-- ── 7. adoption:planner-usage — required owner filter ──────────────────────────
-- Real error: "This entity set must be queried with a filter on owner property,
-- or container type and container external id, or contextScenarioId."
-- Docs: learn.microsoft.com/en-us/graph/api/planner-list-plans
--
-- NOT UPDATED — DELIBERATE, same structural reason as pim-groups plus a harder
-- blocker. /planner/plans?$filter=owner eq '{group-id}' covers ONE group; there
-- is no tenant-wide Planner enumeration. Worse, Microsoft's own sources conflict
-- on whether Planner supports APPLICATION permissions at all (the API reference
-- lists Tasks.Read.All as an Application permission; multiple Microsoft Q&A
-- answers state plainly that Planner supports delegated permissions only). If
-- app-only is genuinely unsupported, this check can never work in an unattended
-- MSP scan and should be retired rather than fixed.
-- OPEN QUESTION for Shane: confirm app-only Planner access against a live tenant
-- before any work is invested here.
--
-- UPDATE monitor_checks SET endpoint = '...' WHERE key = 'adoption:planner-usage';

-- ── 8. identity:continuous-access-evaluation — no v1.0 endpoint exists ─────────
-- Real error: "Resource not found for the segment 'conditionalAccess'".
-- Confirmed: there is NO v1.0 CAE endpoint. The standalone CAE policy object
-- exists only in beta (/beta/identity/continuousAccessEvaluationPolicy) and is
-- itself superseded — it carries a `migrate` property because CAE has been folded
-- into Conditional Access as a session control.
--
-- Two hard blockers against pointing this check at the beta path:
--   (a) graphFetchForTenant hardcodes GRAPH_BASE = .../v1.0 and prefixes every
--       non-http endpoint with it, so a "/beta/..." string becomes
--       /v1.0/beta/... — a beta endpoint is UNREACHABLE by stored-path alone.
--   (b) Depending on a superseded beta singleton for a production signal is the
--       wrong target anyway.
--
-- The honest v1.0 answer is to read CAE as a session control inside Conditional
-- Access policies, which IS v1.0 and IS already covered by Policy.Read.All:
--   /identity/conditionalAccess/policies?$select=id,displayName,sessionControls
-- Left COMMENTED because this changes what the check MEANS (from "is the CAE
-- policy on" to "which CA policies enable CAE session control"), and the check's
-- mapping/severity_rules would need to match — and this task is explicitly
-- forbidden from touching mapping or severity rules. Shane's call.
--
-- >> IMPLEMENTED (approved) in 2026-07-24-cae-check-reframe.sql — endpoint +
-- >> mapping + severity_rules + signal derivation rule, with the direction and the
-- >> beta-only-sub-property caveat worked out there. Run THAT file, not the line
-- >> below, for this check. Kept here as the historical record of the proposal.
--
-- UPDATE monitor_checks
-- SET endpoint = '/identity/conditionalAccess/policies?$select=id,displayName,sessionControls', updated_at = now()
-- WHERE key = 'identity:continuous-access-evaluation';

-- ── 9. devices:app-protection-coverage / devices:update-rings-config ───────────
-- Real error: HTTP 503 with a raw IIS "Service Unavailable" HTML body, BYTE-
-- IDENTICAL before and after re-consent — which rules out a scope gap.
-- Both stored paths are confirmed VALID v1.0:
--   /deviceAppManagement/managedAppPolicies   (Application: DeviceManagementApps.Read.All)
--   /deviceManagement/deviceConfigurations    (Application: DeviceManagementConfiguration.Read.All)
-- Docs: learn.microsoft.com/en-us/graph/api/intune-mam-managedapppolicy-list
--       learn.microsoft.com/en-us/graph/api/intune-deviceconfig-deviceconfiguration-list
--
-- NOT UPDATED — the URL is not the bug, so changing it would be a guess.
-- Two real findings to hand back instead:
--   (a) DeviceManagementApps.Read.All is NOT in REQUIRED_MT_SCOPES (the list has
--       DeviceManagementConfiguration.Read.All and DeviceManagementManagedDevices
--       .Read.All, but not the Apps one). app-protection-coverage needs it.
--       Reported, not added — scope task, re-consent consequence.
--   (b) Both doc pages carry the same note: "The Microsoft Graph API for Intune
--       requires an active Intune license for the tenant." An HTML (not JSON)
--       error body means the response never came from the Graph OData stack at
--       all — consistent with an unlicensed/unprovisioned Intune tenant or a
--       service-side gateway failure, NOT a malformed request.
-- The companion code fix (8588ec38) at least turns the resulting crash into a
-- readable "non-JSON body" error naming the content-type, instead of a bare
-- JSON.parse SyntaxError.

-- ── 10. teams:rooms-device-health — wrong resource entirely, and beta-only ─────
-- Real error: 401 from proxy.msua01.manage.microsoft.com/DeviceFE/... — the
-- Intune device-management proxy, reached because the stored endpoint is the
-- generic /deviceManagement/managedDevices with nothing selecting Teams Rooms
-- hardware. Confirmed still failing after re-consent, so not a scope gap.
--
-- The correct resource is teamworkDevice: /teamwork/devices (+ /{id}/health),
-- Application permission TeamworkDevice.Read.All.
-- Docs: learn.microsoft.com/en-us/graph/api/teamworkdevice-list
--
-- NOT UPDATED — three independent blockers, any one of which is disqualifying:
--   (a) There is NO v1.0 teamworkDevice API. It is beta-only, and per blocker (a)
--       in section 8 above, graphFetchForTenant cannot reach /beta at all.
--   (b) TeamworkDevice.Read.All is not in REQUIRED_MT_SCOPES (reported, not added).
--   (c) Microsoft's own docs state these beta teamworkDevice management APIs
--       "will be deprecated by November 2025 and will no longer be supported
--       after that date" — that date has PASSED, and no successor has been
--       announced. Microsoft additionally warns these APIs may become billable.
-- Pointing a production check at a deprecated, unreachable, unconsented beta API
-- would be strictly worse than the current honest failure. Recommend retiring
-- this check unless Shane wants Teams Rooms coverage badly enough to fund beta
-- support + a new scope + acceptance of the deprecation risk.

-- ── RECEIPT — review before COMMIT ─────────────────────────────────────────────
SELECT key, endpoint, updated_at
FROM monitor_checks
WHERE key IN (
  'adoption:email-activity-trend',
  'adoption:overall-active-rate',
  'adoption:sharepoint-onedrive-trend',
  'adoption:teams-activity-trend',
  'copilot:active-usage-rate',
  'copilot:usage-by-app',
  'onedrive:storage-utilization',
  'platform:branding-config',
  'identity:pim-eligible-roles'
)
ORDER BY key;

-- Expected: 9 rows updated (4 usage reports + 2 copilot + branding normaliser
-- + onedrive quota + pim-eligible-roles).
-- If the receipt looks right:   COMMIT;
-- If anything looks wrong:      ROLLBACK;

COMMIT;
