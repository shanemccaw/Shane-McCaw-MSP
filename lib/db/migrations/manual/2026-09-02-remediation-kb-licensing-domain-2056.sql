-- #2056 — Remediation knowledge base: the licensing: domain, authored & published.
--
-- Populates remediation_knowledge_base with verified "this is wrong → here is how
-- to fix it" content for the ONE active licensing: check: project-online-detection.
-- Follows the #1924 authoring standard exactly (reference:
-- 2026-08-31-remediation-kb-identity-domain-1924.sql).
--
-- AUTHORING STANDARD (see #1924):
--   * Every row is verified against real Microsoft Learn / official Microsoft docs
--     that were actually fetched in build session #2056 (2026-09-02). The URLs in
--     source_urls are those pages.
--   * verified_by is an HONEST AGENT attribution — never a human name. The content
--     is agent-authored and awaiting a human spot-check (filed as a Shane To-Do).
--   * Tenant-specific values use angle-bracket placeholders, never a fabricated
--     real value.
--   * fix_route_capability is the finding-side CEILING (#1539): you_must_run when a
--     real customer-runnable fix script is authored in a step's `code`;
--     admin_center_only when the real fix is portal-only / a program, not a
--     single script. NEVER we_can_run here — that shape requires a live config
--     pack mapped to the check (#1925's job).
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
  'licensing:project-online-detection',
  $ttl$Plan and execute the Project Online migration ahead of the September 30, 2026 retirement$ttl$,
  $sum$Microsoft is retiring Project Online on September 30, 2026 — a published Modern Lifecycle retirement date, not a rumor — after which the tenant loses access to Project Online itself and to the project data stored in it. This finding means the tenant currently holds at least one provisioned Project Online SKU (Project Online Premium, Project Online Professional, or Project Online Essentials — commercially rebranded Planner and Project Plan 5, Planner and Project Plan 3, and Planner Plan 1 respectively), so there is a real, time-boxed migration need, not a hypothetical one. Microsoft's own retirement guidance directs customers toward Planner with premium capabilities, the consolidated successor to Project for the web and classic Planner — existing Project Online Plan 3/5 license holders already carry entitlement to the new Planner premium experience and to the Project desktop app under Microsoft's transition plan, so in most cases the migration need is about moving data and workflows, not necessarily buying a new license.$sum$,
  jsonb_build_array(
    $prq$License Administrator or Global Administrator role to view current Project Online subscription counts and per-user license assignment in the Microsoft 365 admin center$prq$,
    $prq$Directory.Read.All or Organization.Read.All Microsoft Graph permission to read /subscribedSkus — already in REQUIRED_MT_SCOPES, the same permission this check itself uses against this identical endpoint, so no new tenant consent is needed$prq$,
    $prq$A decision-maker (PMO or IT leadership) sign-off on the target platform and migration timeline — Planner Premium's feature set (a 3,000-task cap, no native financial tracking or automatic resource leveling) differs materially from Project Online, so this is a real business decision, not just a technical toggle$prq$
  ),
  $apath$Microsoft 365 admin center → Billing → Your products (view current Project Online subscription and assigned-license counts); Billing → Licenses → select the Project Online product → Assign licenses (to review or reassign individual users)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Inventory exactly which Project Online SKUs are provisioned and how many are actually assigned — this is the same /subscribedSkus read this check itself performs:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Organization.Read.All'
Get-MgSubscribedSku | Where-Object { $_.SkuPartNumber -in @('PROJECTPREMIUM','PROJECTPROFESSIONAL','PROJECT_ESSENTIALS') } |
  Select-Object SkuPartNumber, CapabilityStatus, ConsumedUnits, @{N='Enabled';E={$_.PrepaidUnits.Enabled}}$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Confirm what the tenant's specific plan tier already carries forward before assuming a new purchase is needed: Project Online Premium (Plan 5) and Project Online Professional (Plan 3) holders are already entitled to Planner with premium capabilities and to the Project desktop app under Microsoft's own transition plan; Project Online Essentials (Plan 1) has a narrower successor tier. Review Microsoft's retirement announcement for the exact entitlement mapping for the SKUs found in step 1.$stp$),
    jsonb_build_object('text', $stp$Export the tenant's Project Online data — project plans, schedules, resource assignments, custom fields, and Project Web App reporting data — before the retirement date. There is no in-place automatic conversion of a Project Online schedule into a Planner plan, so anything not exported before September 30, 2026 is at risk of being unreachable.$stp$),
    jsonb_build_object('text', $stp$Once the migration target and license tier are confirmed, reassign the correct Planner Premium tier to the affected users (Microsoft 365 admin center → Billing → Licenses) and schedule the cutover date ahead of September 30, 2026 so no user is left without access mid-transition.$stp$)
  ),
  $eo$Every user currently on a Project Online SKU has a confirmed migration target (Planner with premium capabilities, unless a decision-maker has explicitly chosen an alternative such as Project Server Subscription Edition or Dynamics 365 Project Operations), the tenant's Project Online data has been exported ahead of the retirement date, and license reassignment is scheduled to complete before September 30, 2026.$eo$,
  $vs$Re-run the subscribedSkus check and confirm every previously flagged Project Online license either has a documented migration plan on file or has already been reassigned to its Planner Premium successor tier ahead of the retirement date.$vs$,
  $vc$Get-MgSubscribedSku | Where-Object { $_.SkuPartNumber -in @('PROJECTPREMIUM','PROJECTPROFESSIONAL','PROJECT_ESSENTIALS') } | Select-Object SkuPartNumber, ConsumedUnits$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/lifecycle/products/project-online$url$,
    $url$https://techcommunity.microsoft.com/blog/plannerblog/microsoft-project-online-is-retiring-what-you-need-to-know/4450558$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/users/licensing-service-plan-reference$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/subscribedsku-list$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com) lifecycle & licensing-service-plan-reference pages, fetched 2026-09-02; Microsoft Tech Community official Planner Blog retirement announcement, fetched 2026-09-02; Microsoft Graph API reference (subscribedSku-list) and Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2056) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$This is a licensing/retirement-awareness check (severity info), not a misconfiguration — there is no toggle that "fixes" it. Rated admin_center_only because the real remediation is a data-migration program plus a license-tier decision, not a single customer-runnable script; the Get-MgSubscribedSku command above is a genuine, real diagnostic to size the migration, not a fix action, which is why this is not rated you_must_run. PROJECTPREMIUM/PROJECTPROFESSIONAL/PROJECT_ESSENTIALS map to Project Online Premium/Professional/Essentials respectively (now commercially branded Planner and Project Plan 5/3, and Planner Plan 1) per Microsoft's own licensing-service-plan-reference page. No verified single admin.microsoft.com deep-link fragment for the Billing > Your products / Licenses pages was found in official docs (only a redirecting fwlink), so admin_center_url is left NULL rather than guessed.$note$
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
VALUES ('2026-09-02-remediation-kb-licensing-domain-2056.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- Verify: how many licensing: rows are published after this migration.
SELECT
  count(*) FILTER (WHERE check_key LIKE 'licensing:%') AS licensing_rows,
  count(*) FILTER (WHERE check_key LIKE 'licensing:%' AND status = 'published') AS licensing_published,
  count(*) AS total_rows
FROM remediation_knowledge_base;
