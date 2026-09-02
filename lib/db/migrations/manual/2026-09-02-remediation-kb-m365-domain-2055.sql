-- #2055 — Remediation knowledge base: the m365: domain, authored & published.
--
-- Populates remediation_knowledge_base with verified "this is wrong → here is how
-- to fix it" content for EVERY active m365: check (2 rows): message-center,
-- service-health. Follows the #1924 authoring standard exactly (reference:
-- 2026-08-31-remediation-kb-identity-domain-1924.sql).
--
-- AUTHORING STANDARD (see #1924):
--   * Every row is verified against real Microsoft Learn / official Microsoft docs
--     that were actually fetched in build session #2055 (2026-09-02). The URLs in
--     source_urls are those pages.
--   * verified_by is an HONEST AGENT attribution — never a human name. The content
--     is agent-authored and awaiting a human spot-check (filed as a Shane To-Do).
--   * Tenant-specific values use angle-bracket placeholders (<UserObjectId>, …),
--     never a fabricated real value.
--   * fix_route_capability is the finding-side CEILING (#1539): you_must_run when a
--     real customer-runnable fix script is authored in a step's `code`;
--     admin_center_only when the real fix is portal-only. NEVER we_can_run here —
--     that shape requires a live config pack mapped to the check (#1925's job).
--
-- Idempotent: keyed on check_key via ON CONFLICT DO UPDATE, safe to re-run. Additive
-- content only — no schema change (#1539 already built the columns).

BEGIN;

INSERT INTO remediation_knowledge_base (
  check_key, title, summary, prerequisites, admin_center_path, admin_center_url,
  remediation_steps, expected_outcome, validation_step, validation_command,
  source_urls, verified_against, last_verified_at, verified_by, status, fix_route_capability, notes
) VALUES

(
  'm365:message-center',
  $ttl$Triage Microsoft 365 Message Center posts tagged as major update$ttl$,
  $sum$This check surfaces majorChangeCount > 0 when Microsoft 365 Message Center carries at least one post tagged "Major update" — Microsoft's own designation for changes communicated at least 30 days in advance because they can affect daily productivity (mailboxes, meetings, delegation, sharing/access), customizations (themes, web parts, deployed Copilot agents), visible capacity limits, data location, or introduce a new service/app turned on by default. A major-update post that sits untriaged in Message Center is a known, dated change the org had real advance warning of but never assigned an owner to act on — the opposite of a surprise outage, and entirely preventable with a routine triage step. This is a heads-up signal, not a misconfiguration by itself: the finding is the absence of a triage process around it, not a setting to toggle.$sum$,
  jsonb_build_array(
    $prq$Any built-in admin role with Message Center access (most roles qualify), or the dedicated Message center reader role for read/share-only access with no other privileges. Roles that do NOT have Message Center access per Microsoft's own list: Compliance Administrator, Conditional Access Administrator, Customer Lockbox access approver, Device Administrators, Directory Readers, Directory Synchronization Accounts, Directory Writers, Intune Service Administrator, Privileged Role Administrator, Reports Reader$prq$,
    $prq$Microsoft Graph ServiceMessage.Read.All — already in REQUIRED_MT_SCOPES, the same permission this exact check (m365:message-center) and message-center-sync.ts already use against this identical endpoint, so no new tenant consent is needed$prq$,
    $prq$Microsoft Graph PowerShell SDK module Microsoft.Graph.Devices.ServiceAnnouncement (Get-MgServiceAnnouncementMessage), only if triaging outside the admin portal$prq$
  ),
  $apath$Microsoft 365 admin center → Health → Message center → filter Tag = "Major update"$apath$,
  $aurl$https://go.microsoft.com/fwlink/p/?linkid=2070717$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open Health → Message center in the admin center and filter Tag = "Major update" to see every 30-day-advance-notice post; use the Act by column (populated only when Microsoft requires action by a specific date) to sort by urgency.$stp$),
    jsonb_build_object('text', $stp$Pull the same list programmatically to build an operational triage worklist — this is the same endpoint this check itself reads:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'ServiceMessage.Read.All'
Get-MgServiceAnnouncementMessage -Filter "isMajorChange eq true" -All |
  Select-Object Id, Title, ActionRequiredByDateTime, Services |
  Sort-Object ActionRequiredByDateTime$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For each open major-update post, assign a named owner and due date. Microsoft's own supported path for this is syncing Message center posts to Microsoft Planner tasks (message pane → sync-to-Planner action) so the task is tracked to completion outside the admin center rather than relying on the post's read/unread state.$stp$),
    jsonb_build_object('text', $stp$Turn on major-update email routing so future posts reach the right person without a manual portal check: Message center → Preferences → Email tab → confirm "Send me emails for major updates" is checked, and add up to two email addresses.$stp$)
  ),
  $eo$Every open "Major update" Message Center post has a named owner and is tracked to its Act by date (via Planner sync or an equivalent tracked task), and the admin(s) responsible for triage have major-update email notifications enabled so a newly posted major update is routed to a person rather than surfacing only on the next scheduled check.$eo$,
  $vs$Re-filter Message center by Tag = "Major update" and confirm no post past its Act by date remains unactioned (still unread/unarchived with no linked task); confirm Message center → Preferences → Email shows "Send me emails for major updates" enabled for the responsible admin(s).$vs$,
  $vc$Get-MgServiceAnnouncementMessage -Filter "isMajorChange eq true" -All | Where-Object { $_.ActionRequiredByDateTime -and ([datetime]$_.ActionRequiredByDateTime) -lt (Get-Date) } | Select-Object Id, Title, ActionRequiredByDateTime$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/graph/api/resources/serviceannouncement?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/serviceannouncement-list-messages?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/manage/message-center?view=o365-worldwide$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Devices.ServiceAnnouncement)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2055) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Rated you_must_run on the same basis as onedrive:active-users (#2052): the PowerShell step is a real, customer-runnable diagnostic that builds the actual triage worklist this finding calls for, even though the underlying "fix" (Planner task ownership, email preferences) is a portal/process action, not a one-shot toggle. Confirmed via a direct fetch of https://learn.microsoft.com/en-us/graph/api/serviceupdatemessage-update (404 — no documented Graph endpoint to mark a message read/archived/favorited exists), so no PATCH-based "mark handled" step is offered here; marking read/archived stays a manual portal action.$note$
),

(
  'm365:service-health',
  $ttl$Route Microsoft 365 service health incidents/advisories to a named owner$ttl$,
  $sum$This check flags operationalServiceCount != totalServiceCount — at least one Microsoft 365 service subscribed by the tenant is reporting a serviceHealthStatus other than serviceOperational (investigating, serviceDegradation, serviceInterruption, restoringService, extendedRecovery, investigationSuspended, serviceRestored, postIncidentReviewPublished, falsePositive, mitigated(External), resolved(External), confirmed, reported). Every one of these states originates and is resolved entirely on Microsoft's side — there is nothing in the tenant to reconfigure — so the real, tenant-side gap this check is protecting against is silence: without email routing or a subscribed owner, the first the organization hears about a live incident is a help-desk call from an affected user, not an admin who already saw it on the Service health dashboard. Microsoft explicitly does not surface planned maintenance here — that is Message Center's job (see m365:message-center) — so every row this check can flag is a genuine unplanned advisory or incident.$sum$,
  jsonb_build_array(
    $prq$Service Support Administrator or Helpdesk Administrator role (Microsoft's documented minimum to view Service health); Global Administrator and several other built-in roles can also view it$prq$,
    $prq$Microsoft Graph ServiceHealth.Read.All — already in REQUIRED_MT_SCOPES, the same permission this exact check (m365:service-health) already uses against this identical endpoint, so no new tenant consent is needed$prq$,
    $prq$Microsoft Graph PowerShell SDK module Microsoft.Graph.Devices.ServiceAnnouncement (Get-MgServiceAnnouncementHealthOverview), only for scripted/out-of-band status pulls between scheduled check runs$prq$
  ),
  $apath$Microsoft 365 admin center → Health → Service health$apath$,
  $aurl$https://go.microsoft.com/fwlink/p/?linkid=2024339$aurl$,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open Health → Service health and review the Overview tab: "Issues for your organization to act on" (issues detected in your environment needing action) and "Active issues Microsoft is working on" (incidents/advisories in progress), each showing Status, User Impact, and Issue type (incident vs. advisory).$stp$),
    jsonb_build_object('text', $stp$Pull the same per-service status and its active issues programmatically, useful for correlating against what this check flagged between its own scheduled runs:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'ServiceHealth.Read.All'
Get-MgServiceAnnouncementHealthOverview -ExpandProperty "issues" |
  Where-Object { $_.Status -ne 'serviceOperational' } |
  Select-Object Service, Status, @{N='ActiveIssueTitles';E={$_.Issues.Title -join '; '}}$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Turn on tenant-wide service health email routing so future incidents reach a real person: Service health → Customize → Email → check "Send me email notifications about service health" → add up to two email addresses and choose which services/event types (incidents vs. advisories) to be notified for. Portal-only; no documented PowerShell equivalent for this preference.$stp$),
    jsonb_build_object('text', $stp$For the specific active issue(s) this check flagged, open the issue detail page and select "Manage notifications for this issue" to subscribe a named owner to just that issue's updates through to Service Restored, rather than relying on someone re-checking the dashboard.$stp$)
  ),
  $eo$An admin holding at minimum Service Support Administrator or Helpdesk Administrator access has tenant-wide service health email notifications enabled, and every service this check flagged as non-operational has a named owner subscribed to its issue updates, so the next incident is routed to a person immediately rather than discovered only on the next scheduled check or a user's help-desk call.$eo$,
  $vs$Re-open Health → Service health and confirm the previously flagged service(s) now show serviceOperational, or — for a still-active issue — confirm a specific admin is subscribed via "Manage notifications for this issue"; separately confirm Customize → Email → "Send me email notifications about service health" is enabled for at least one responsible admin.$vs$,
  $vc$Get-MgServiceAnnouncementHealthOverview | Where-Object { $_.Status -ne 'serviceOperational' } | Select-Object Service, Status$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/graph/api/serviceannouncement-list-healthoverviews?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/servicehealth?view=graph-rest-1.0$url$,
    $url$https://learn.microsoft.com/en-us/microsoft-365/enterprise/view-service-health?view=o365-worldwide$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Devices.ServiceAnnouncement)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2055) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Rated admin_center_only on the same basis as onedrive:sync-errors (#2052): the two real state-changing fixes (tenant-wide service-health email preferences, per-issue "Manage notifications for this issue") are both documented as portal-only with no PowerShell equivalent; the PowerShell step above is a genuine read-only diagnostic pull, not a fix command. serviceHealthStatus enum values captured in this row's summary are the full documented set as of the 2026-09-02 fetch, not an abbreviated list.$note$
)

ON CONFLICT (check_key) DO UPDATE SET
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  prerequisites = EXCLUDED.prerequisites,
  admin_center_path = EXCLUDED.admin_center_path,
  admin_center_url = EXCLUDED.admin_center_url,
  remediation_steps = EXCLUDED.remediation_steps,
  expected_outcome = EXCLUDED.expected_outcome,
  validation_step = EXCLUDED.validation_step,
  validation_command = EXCLUDED.validation_command,
  source_urls = EXCLUDED.source_urls,
  verified_against = EXCLUDED.verified_against,
  last_verified_at = EXCLUDED.last_verified_at,
  verified_by = EXCLUDED.verified_by,
  status = EXCLUDED.status,
  fix_route_capability = EXCLUDED.fix_route_capability,
  notes = EXCLUDED.notes,
  updated_at = now();

-- Self-mark this migration as run (Git #497 — Simulator Studio Migrations tree).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-02-remediation-kb-m365-domain-2055.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- Verify: how many m365: rows are published after this migration.
SELECT
  count(*) FILTER (WHERE check_key LIKE 'm365:%') AS m365_rows,
  count(*) FILTER (WHERE check_key LIKE 'm365:%' AND status = 'published') AS m365_published,
  count(*) AS total_rows
FROM remediation_knowledge_base;
