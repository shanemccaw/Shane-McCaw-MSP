-- #2041 — Remediation knowledge base: the governance: domain, authored & published.
--
-- Populates remediation_knowledge_base with verified "this is wrong → here is how
-- to fix it" content for EVERY active governance: check (15 rows). Follows the
-- authoring standard set by #1924 and its identity: domain reference migration
-- (lib/db/migrations/manual/2026-08-31-remediation-kb-identity-domain-1924.sql).
--
-- AUTHORING STANDARD (see #1924, applied here per #2041):
--   * Every row is verified against real Microsoft Learn / official Microsoft docs
--     that were actually fetched in build session #2041 (2026-09-02). The URLs in
--     source_urls are those pages.
--   * verified_by is an HONEST AGENT attribution — never a human name. The content
--     is agent-authored and awaiting a human spot-check (filed as a Shane To-Do).
--   * Tenant-specific values use angle-bracket placeholders (<GroupObjectId>, …),
--     never a fabricated real value.
--   * fix_route_capability is the finding-side CEILING (#1539): you_must_run when a
--     real customer-runnable fix script is authored in a step's `code`;
--     admin_center_only when the real fix is portal-only / a judgment call. NEVER
--     we_can_run here — that shape requires a live config pack mapped to the check
--     (#1925's job).
--
-- Idempotent: keyed on check_key via ON CONFLICT DO UPDATE, safe to re-run. Additive
-- content only — no schema change (#1539 already built the columns).

BEGIN;

INSERT INTO remediation_knowledge_base (
  check_key, title, summary, prerequisites, admin_center_path, admin_center_url,
  remediation_steps, expected_outcome, validation_step, validation_command,
  source_urls, verified_against, last_verified_at, verified_by, status, fix_route_capability, notes
) VALUES

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Access reviews
-- ─────────────────────────────────────────────────────────────────────────────

(
  'governance:access-review-completion',
  $ttl$Ensure access reviews are completed on schedule$ttl$,
  $sum$A low completion rate on access reviews means reviewers are not resolving who should keep access before the review's due date, so departed employees, contractors who finished an engagement, or users who changed roles can retain access indefinitely. Access reviews only reduce risk if reviewers actually respond — an unanswered review with "If reviewers don't respond" left at "No change" silently keeps every unreviewed user's access exactly as it was, so a low completion rate is functionally the same as never having reviewed access at all.$sum$,
  jsonb_build_array(
    $prq$Identity Governance Administrator (or Global Administrator) to view and manage access reviews$prq$,
    $prq$Microsoft Entra ID Governance or Microsoft Entra Suite license (some capabilities also work with Entra ID P2)$prq$,
    $prq$Reviewers (group owners, selected users, or self-review users) who can actually receive and act on the review email$prq$
  ),
  $apath$Microsoft Entra admin center → Identity Governance → Access Reviews$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Open ID Governance → Access Reviews and sort/filter by the Progress column to find reviews with low completion (few of N users reviewed) relative to how close they are to their Due date.$stp$),
    jsonb_build_object('text', $stp$For an in-progress review with unresponsive reviewers, check whether Reminders was enabled under Advanced settings when the review was created — reviewers get a mid-cycle nudge email only if this was turned on. If it wasn't, update the review's Current settings to enable it for the rest of this cycle.$stp$),
    jsonb_build_object('text', $stp$Confirm "If reviewers don't respond" is set deliberately (Take recommendations, Remove access, or Approve access) rather than left at "No change", and that "Auto apply results to resource" is enabled — otherwise a completed review's decisions sit un-applied even after reviewers finish.$stp$),
    jsonb_build_object('text', $stp$If a fallback reviewer is needed (e.g. a group owner review where the group has no active owner), add one under the review's reviewer settings so reviews don't stall with nobody assigned.$stp$)
  ),
  $eo$Each recurring access review shows Progress at or near 100% by its Due date each cycle, with a deliberate "If reviewers don't respond" fallback and Auto apply results enabled, so access decisions take effect on schedule instead of silently expiring unresolved.$eo$,
  $vs$Re-open ID Governance → Access Reviews after the review period ends and confirm Progress reached 100% (or the residual is understood and expected), then open the review's Results to confirm decisions show as Applied.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/id-governance/access-reviews-overview$url$,
    $url$https://learn.microsoft.com/en-us/entra/id-governance/create-access-review$url$,
    $url$https://learn.microsoft.com/en-us/entra/id-governance/perform-access-review$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2041) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$No single command reliably reports "completion rate" — Progress is a portal-only signal (and the Graph accessReviewInstance/decisions APIs can compute it, but no verified simple PowerShell one-liner exists), so validation_command is intentionally NULL rather than invented.$note$
),

(
  'governance:overdue-access-reviews',
  $ttl$Resolve overdue access reviews$ttl$,
  $sum$An access review still open past its scheduled Due date without applied results means denied users have not actually been removed and approved users have not been re-certified — the due date passing has no automatic effect unless "Auto apply results to resource" was enabled, so the tenant keeps granting access nobody has re-confirmed until an admin manually applies the outcome or the underlying platform job catches up.$sum$,
  jsonb_build_array(
    $prq$Identity Governance Administrator to view, stop, or apply results to access reviews$prq$,
    $prq$Microsoft Entra ID Governance or Microsoft Entra Suite license$prq$
  ),
  $apath$Microsoft Entra admin center → Identity Governance → Access Reviews → select the review whose Due date has passed$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Filter Access Reviews for a Due date in the past combined with Progress under 100% to find genuinely overdue reviews (as distinct from ones that finished on time).$stp$),
    jsonb_build_object('text', $stp$If "Auto apply results to resource" was enabled, decisions apply automatically once the review closes — confirm this actually happened by checking Results rather than assuming it did. If it wasn't enabled, open the review and manually apply the results.$stp$),
    jsonb_build_object('text', $stp$For a multi-stage review stuck because a stage hasn't reached its full configured duration, use "Stop current stage" in the review's overview to force progression to the next stage rather than waiting out the remaining time.$stp$),
    jsonb_build_object('text', $stp$Going forward, enable "Auto apply results to resource" on the review's Series settings (not just Current) so every future recurrence resolves automatically at its due date without needing a manual apply step.$stp$)
  ),
  $eo$No access review shows a Due date in the past with Progress under 100% and unapplied results; every completed review's decisions (access removed or retained) have actually been applied, not just recorded.$eo$,
  $vs$Re-check the Access Reviews list for any review with a past Due date and Progress under 100%, and open Results on the previously overdue review to confirm decisions show Applied rather than Pending.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/id-governance/create-access-review$url$,
    $url$https://learn.microsoft.com/en-us/entra/id-governance/perform-access-review$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2041) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  NULL
),

(
  'governance:guest-access-reviews',
  $ttl$Cover every guest account with an active access review$ttl$,
  $sum$A guest account that isn't in scope of any recurring access review keeps whatever standing access it was originally granted with nobody ever re-confirming it's still needed — Microsoft's own guidance on external identity governance treats this as the core control: every B2B guest's access should be periodically re-certified by a group owner or the guest themselves, because unlike employees, guests have no HR feed or offboarding process that automatically signals when their access should end.$sum$,
  jsonb_build_array(
    $prq$Identity Governance Administrator to create and manage access reviews$prq$,
    $prq$Microsoft Entra ID Governance, Microsoft Entra Suite, or Entra ID P2 license (required to use access reviews at all)$prq$
  ),
  $apath$Microsoft Entra admin center → Identity Governance → Access Reviews → New access review → Teams + Groups$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Create a review covering guests: New access review → select "Teams + Groups" → choose "All Microsoft 365 groups with guest users" for tenant-wide guest coverage (dynamic and role-assignable groups are excluded by design), or "Select Teams + groups" to target a specific set. Set Scope to Guest users only.$stp$),
    jsonb_build_object('text', $stp$Assign reviewers — Group owner(s) is the recommended default for a group-scoped review, with a fallback reviewer specified for groups that currently have no active owner (see governance:ownerless-groups).$stp$),
    jsonb_build_object('text', $stp$Set a recurrence appropriate to the guest population's risk (quarterly is a common baseline), enable "Auto apply results to resource", and set "Action to apply on denied guest users" to either remove the guest's membership from the resource, or (for the tenant-wide "all guests" case) "Block user from signing-in for 30 days, then remove user from the tenant" if the goal is full cleanup rather than just resource-scoped access removal.$stp$),
    jsonb_build_object('text', $stp$For guests who hold no group membership at all and so wouldn't be caught by a group-scoped review, first build a dynamic group to bring them into scope, then review that group: (user.userType -eq "Guest") -and (user.accountEnabled -eq true)$stp$)
  ),
  $eo$Every guest user in the tenant is covered by at least one active, recurring access review — either the tenant-wide "All Microsoft 365 groups with guest users" review, or an explicit guest-scoped review against a group or dynamic group that includes them — so no guest's access goes uncertified indefinitely.$eo$,
  $vs$In Access Reviews, confirm a review exists scoped to guest users whose status is Active/recurring (not deleted or expired), and cross-check the guest population under Entra ID → Users (filter User type = Guest) against that review's target group(s) to confirm coverage.$vs$,
  NULL,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/id-governance/access-reviews-overview$url$,
    $url$https://learn.microsoft.com/en-us/entra/id-governance/create-access-review$url$,
    $url$https://learn.microsoft.com/en-us/entra/id-governance/access-reviews-external-users$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2041) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  NULL
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Groups hygiene
-- ─────────────────────────────────────────────────────────────────────────────

(
  'governance:dynamic-group-usage',
  $ttl$Keep dynamic group membership rules healthy$ttl$,
  $sum$A dynamic membership group whose rule processing has stalled (membershipRuleProcessingState = Paused rather than On) stops adding or removing members entirely — every Conditional Access policy, application role assignment, or license assignment scoped to that group is silently working off stale membership until processing resumes. Because members can't be added or removed manually on a dynamic group, a broken rule can leave access frozen at whatever it was when processing last succeeded, in either direction: someone who should have lost access keeps it, or someone who should have gained it never does.$sum$,
  jsonb_build_array(
    $prq$Groups Administrator or User Administrator to view and edit dynamic membership rules$prq$,
    $prq$Microsoft Entra ID P1 license (or Intune for Education) covering each unique user who is a member of any dynamic membership group — tenant-wide license count, not a per-member assignment$prq$
  ),
  $apath$Microsoft Entra admin center → Identity → Groups → All groups → select group → Dynamic membership rules$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Check each dynamic group's processing state — a group stuck in Paused, or one whose Overview shows a persistent processing error, needs attention before its membership can be trusted.$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Group.Read.All'
Get-MgGroup -GroupId "<GroupObjectId>" -Property DisplayName,MembershipRule,MembershipRuleProcessingState |
  Select-Object DisplayName, MembershipRule, MembershipRuleProcessingState$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Confirm license coverage tenant-wide: count the unique users across all dynamic membership groups and verify at least that many Microsoft Entra ID P1 (or Intune for Education) licenses exist in the organization — the license doesn't need to be assigned to each member individually, but the tenant-wide count must cover them, or processing pauses.$stp$),
    jsonb_build_object('text', $stp$Audit the rule text itself for common breakage: a referenced on-premises-synced attribute whose write permissions or value shape changed, or a rule referencing an extension attribute/custom directory extension that was later removed. Rebuild the expression in the rule builder or text box under Dynamic membership rules.$stp$),
    jsonb_build_object('text', $stp$After fixing the rule or licensing, verify actual membership matches intent rather than trusting the portal count alone — spot-check a handful of users against the rule's logic.$stp$, 'code', $cod$Get-MgGroupMember -GroupId "<GroupObjectId>" -All | Select-Object Id$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Every dynamic group's MembershipRuleProcessingState reads "On", and current membership matches what the rule should produce given today's directory attribute values — no group is silently frozen on stale membership.$eo$,
  $vs$Re-query MembershipRuleProcessingState on the affected group(s) and confirm it reads "On", then re-run the member list and spot-check a few users against the rule's logic.$vs$,
  $vc$Get-MgGroup -GroupId "<GroupObjectId>" -Property DisplayName,MembershipRuleProcessingState | Select-Object DisplayName, MembershipRuleProcessingState$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/users/groups-dynamic-membership$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/group?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Groups), Microsoft Graph v1.0 group resource$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2041) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$membershipRuleProcessingState (On/Paused) and membershipRule are real, documented properties on the Microsoft Graph group resource, confirmed directly against the v1.0 resource reference. Rule authoring itself stays a judgment call, not a scriptable "fix" — hence admin_center_only despite the diagnostic PowerShell above.$note$
),

(
  'governance:group-expiration-policy',
  $ttl$Configure a tenant-wide expiration policy for Microsoft 365 groups$ttl$,
  $sum$Without a group expiration policy, Microsoft 365 groups never expire or prompt an owner to renew them — an abandoned group from a finished project, a one-off committee, or a former team keeps its membership, permissions, and connected SharePoint site/Teams channel live indefinitely. Microsoft's own activity-based auto-renewal means a genuinely active group won't be disrupted by turning expiration on (it renews itself automatically ~35 days before expiring based on real usage), so the policy mainly catches groups that have gone truly dormant.$sum$,
  jsonb_build_array(
    $prq$Groups Administrator or User Administrator to configure and manage the expiration policy$prq$,
    $prq$Microsoft Entra ID P1 or P2 license held (not necessarily assigned) for the members of all groups the policy applies to$prq$
  ),
  $apath$Microsoft Entra admin center → Identity → Groups → All groups → Expiration$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Entra ID → Groups → All groups → Expiration. Set the group lifetime in days (30 days minimum; Microsoft's presets or a custom value), an email address to receive renewal/expiration notices for groups with no owner, and whether expiration applies to All, Selected (up to 500), or None of the Microsoft 365 groups.$stp$),
    jsonb_build_object('text', $stp$Be aware that any existing group older than the configured interval is initially set to 35 days until expiration (unless auto-renewed or manually renewed by an owner), so expect a wave of renewal notices right after first enabling this.$stp$),
    jsonb_build_object('text', $stp$Configure via Microsoft Graph PowerShell for a scripted/repeatable setup:$stp$, 'code', $cod$Install-Module Microsoft.Graph -Scope CurrentUser
Connect-MgGraph -Scopes "Directory.ReadWrite.All"

New-MgGroupLifecyclePolicy -AlternateNotificationEmails "<NotifyEmailAddress>" `
  -GroupLifetimeInDays 365 -ManagedGroupTypes All$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Confirm the policy is actually in effect:$stp$, 'code', $cod$Get-MgGroupLifecyclePolicy$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$A single tenant-wide group expiration policy exists (ManagedGroupTypes = All, or explicitly Selected groups) with a defined GroupLifetimeInDays and a notification email for ownerless groups, so dormant Microsoft 365 groups are flagged for renewal or automatically deleted rather than accumulating indefinitely.$eo$,
  $vs$Re-run Get-MgGroupLifecyclePolicy and confirm it returns a policy with the intended GroupLifetimeInDays and ManagedGroupTypes; check the admin center's Expiration page shows the same settings.$vs$,
  $vc$Get-MgGroupLifecyclePolicy | Select-Object Id, GroupLifetimeInDays, ManagedGroupTypes, AlternateNotificationEmails$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/users/groups-lifecycle$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Groups)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2041) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Only one expiration policy can exist per tenant for all Microsoft 365 groups — if one already exists, use Update-MgGroupLifecyclePolicy instead of New-MgGroupLifecyclePolicy (both documented on the same source page).$note$
),

(
  'governance:empty-security-groups',
  $ttl$Investigate and resolve empty security groups$ttl$,
  $sum$A security group with zero members grants no access to anyone today, but if it's still referenced by a Conditional Access policy, an application role assignment, or a SharePoint/file permission, it represents dead-but-still-wired access control — if it's later repopulated (a rejoin, a bulk add, or an attacker adding themselves) without anyone re-verifying what it's still connected to, it can quietly resurrect access nobody intended to grant. An empty group left around with no explanation also makes every subsequent access review and audit harder to reason about correctly.$sum$,
  jsonb_build_array(
    $prq$Groups Administrator or User Administrator to manage or delete groups$prq$,
    $prq$Global Reader or Reports Reader (or access to Conditional Access / Enterprise Applications) to check where a group is still referenced before deleting it$prq$
  ),
  $apath$Microsoft Entra admin center → Identity → Groups → All groups → select group → Members (to confirm zero members)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Enumerate empty security groups (pure security groups — securityEnabled true, mailEnabled false — matching this check's own scan) using Microsoft Graph PowerShell:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Group.Read.All'
Get-MgGroup -Filter "securityEnabled eq true and mailEnabled eq false" -ConsistencyLevel eventual -All |
  ForEach-Object {
    $count = (Get-MgGroupMember -GroupId $_.Id -All | Measure-Object).Count
    if ($count -eq 0) { [PSCustomObject]@{ DisplayName = $_.DisplayName; Id = $_.Id } }
  }$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Before deleting any group, check whether it's still referenced: Conditional Access → Policies (search each policy's Assignments → Users → Include/Exclude groups), Enterprise Applications → (app) → Users and groups, and any SharePoint/Teams permission that names the group.$stp$),
    jsonb_build_object('text', $stp$If genuinely unused and unreferenced, delete it: Entra ID → Groups → All groups → select the group → Delete. If it IS referenced (for example, a break-glass exclusion group deliberately kept empty), document why and leave it rather than deleting a group a live policy depends on.$stp$),
    jsonb_build_object('text', $stp$If it should have members but doesn't, add the correct members/owners instead of deleting it — an empty group that's still actively referenced elsewhere is a membership gap, not dead weight.$stp$)
  ),
  $eo$Every security group is either populated with the members it's meant to have, or has been deleted because it's genuinely unused and unreferenced — no group sits empty while still wired into a Conditional Access policy, application assignment, or resource permission.$eo$,
  $vs$Re-run the empty-security-group scan and confirm the count has dropped to only groups deliberately kept for a documented reason; spot-check a couple of those against Conditional Access/app assignments to confirm they're genuinely still referenced.$vs$,
  $vc$Get-MgGroup -Filter "securityEnabled eq true and mailEnabled eq false" -ConsistencyLevel eventual -All | ForEach-Object { $count = (Get-MgGroupMember -GroupId $_.Id -All | Measure-Object).Count; if ($count -eq 0) { $_.DisplayName } }$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/fundamentals/how-to-manage-groups$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.groups/get-mggroupmember?view=graph-powershell-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Groups)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2041) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$Deciding which empty groups to delete versus keep is a per-group judgment call (is it referenced elsewhere, is it deliberately a placeholder), not something a single script can safely automate — hence admin_center_only despite the detection script above.$note$
),

(
  'governance:ownerless-groups',
  $ttl$Assign an owner to every group$ttl$,
  $sum$A group with zero owners has no one accountable for its membership — nobody gets prompted to renew it before an expiration policy deletes it, an owner-reviewed access review falls back to whatever fallback reviewer was configured (or goes unreviewed if none was set), and nobody is positioned to notice if the group's purpose or membership has drifted from what it was created for. Ownerless groups are a recurring root cause behind both stale access and access reviews that technically complete with no real reviewer engagement.$sum$,
  jsonb_build_array(
    $prq$Groups Administrator or User Administrator to add owners$prq$
  ),
  $apath$Microsoft Entra admin center → Identity → Groups → All groups → select group → Owners → + Add owners$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Identify ownerless groups tenant-wide:$stp$, 'code', $cod$Connect-MgGraph -Scopes 'Group.Read.All'
Get-MgGroup -All | ForEach-Object {
  $owners = (Get-MgGroupOwner -GroupId $_.Id -All | Measure-Object).Count
  if ($owners -eq 0) { [PSCustomObject]@{ DisplayName = $_.DisplayName; Id = $_.Id } }
}$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For each, assign at least one — ideally two — owners who actually know the group's purpose: typically whoever originally requested it, or the current lead of the team the resource it gates access to belongs to. Where the original requester has left the organization, assign it to their manager or the team's current lead instead of leaving it ownerless.$stp$),
    jsonb_build_object('text', $stp$Add the owner via the admin center (Groups → All groups → group → Owners → + Add owners), or scripted for bulk remediation:$stp$, 'code', $cod$$newOwner = @{ "@odata.id" = "https://graph.microsoft.com/v1.0/users/<UserObjectId>" }
New-MgGroupOwnerByRef -GroupId "<GroupObjectId>" -BodyParameter $newOwner$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Every group in the directory has at least one active owner who can be held accountable for its membership and who will be the default reviewer in an owner-based access review, rather than falling through to a fallback reviewer or going unreviewed.$eo$,
  $vs$Re-run the ownerless-group scan and confirm the count is zero, or only covers groups deliberately excluded (for example, certain system-managed groups).$vs$,
  $vc$Get-MgGroup -All | ForEach-Object { $owners = (Get-MgGroupOwner -GroupId $_.Id -All | Measure-Object).Count; if ($owners -eq 0) { $_.DisplayName } }$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/fundamentals/how-to-manage-groups$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/microsoft.graph.groups/new-mggroupownerbyref?view=graph-powershell-1.0$url$,
    $url$https://learn.microsoft.com/en-us/entra/id-governance/create-access-review$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Groups)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2041) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  NULL
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Guest lifecycle
-- ─────────────────────────────────────────────────────────────────────────────

(
  'governance:guest-count',
  $ttl$Govern uncontrolled growth of guest accounts$ttl$,
  $sum$A guest account count that grows steadily with no corresponding governance process (a restricted inviter list, entitlement management, or periodic access review) signals an expanding, ungoverned attack surface — every additional B2B guest is a standing identity in the directory, and unmanaged growth usually means invitations aren't tracked back to a business sponsor, an approver, or an expiration point, so nobody can say with confidence why any given guest still has access.$sum$,
  jsonb_build_array(
    $prq$User Administrator or Guest Inviter to review/restrict who can invite guests$prq$,
    $prq$Global Administrator or External Identity Provider Administrator to change External collaboration settings$prq$,
    $prq$Microsoft Entra ID Governance license if pairing with Entitlement Management or Access Reviews for ongoing guest lifecycle control$prq$
  ),
  $apath$Microsoft Entra admin center → External Identities → External collaboration settings$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Establish the current baseline and who can invite guests: External Identities → External collaboration settings → Guest invite settings. The default is "Anyone in the organization can invite guest users including guests and non-admins" — tighten this to "Member users and users assigned to specific admin roles" or "Only users assigned to specific admin roles" if invitations should be governed rather than fully open.$stp$),
    jsonb_build_object('text', $stp$For users who need to invite guests without a broader admin role, assign them the Guest Inviter role specifically rather than widening the tenant-wide setting:$stp$, 'code', $cod$Import-Module Microsoft.Graph.Identity.DirectoryManagement
$role = Get-MgDirectoryRole | Where-Object { $_.DisplayName -eq "Guest Inviter" }
$dirObject = @{ "@odata.id" = "https://graph.microsoft.com/v1.0/directoryObjects/<UserObjectId>" }
New-MgDirectoryRoleMemberByRef -DirectoryRoleId $role.Id -BodyParameter $dirObject$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Route new guest access through Entitlement Management access packages instead of ad-hoc invitations where possible, so every guest has a recorded requestor, approver, and expiration policy rather than accumulating indefinitely.$stp$),
    jsonb_build_object('text', $stp$Pair this with governance:guest-staleness's access-review-based cleanup so guests with no ongoing sign-in activity are disabled and removed rather than left as permanent standing accounts, keeping the count from only ever growing.$stp$)
  ),
  $eo$Guest invitations are routed through a governed path (a restricted inviter list, the Guest Inviter role for specific individuals, or Entitlement Management) rather than open self-service by everyone, and the guest count trend is periodically reviewed against a known baseline instead of growing unexplained.$eo$,
  $vs$Re-check External collaboration settings confirms Guest invite settings is restricted as intended, and re-run the guest count/domain breakdown to compare against the prior baseline.$vs$,
  $vc$Get-MgUser -Filter "userType eq 'Guest'" -ConsistencyLevel eventual -CountVariable guestCount -All | Measure-Object | Select-Object -ExpandProperty Count$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/external-id/user-properties$url$,
    $url$https://learn.microsoft.com/en-us/entra/external-id/external-collaboration-settings-configure$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph PowerShell SDK (Microsoft.Graph.Identity.DirectoryManagement, Microsoft.Graph.Users)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2041) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  NULL
),

(
  'governance:guest-staleness',
  $ttl$Monitor and clean up stale guest accounts$ttl$,
  $sum$A guest account with no sign-in activity in 90+ days is very likely a collaboration that ended without anyone removing the access it was granted for — Microsoft's own guest-lifecycle guidance treats 90 days as the standard inactivity threshold, and a stale guest is pure downside: it's a standing credential into the tenant with no ongoing business justification, discoverable by anyone probing the directory, and it inflates governance:guest-count without contributing anything.$sum$,
  jsonb_build_array(
    $prq$Identity Governance Administrator to create the access review; Reports Reader to inspect sign-in activity$prq$,
    $prq$Microsoft Entra ID Governance or Microsoft Entra Suite license$prq$,
    $prq$Microsoft Entra ID P1 or P2 to read the signInActivity property via Microsoft Graph (AuditLog.Read.All, User.Read.All permissions)$prq$
  ),
  $apath$Microsoft Entra admin center → Identity Governance → Dashboard → Guest access governance card → View inactive guests$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Review the built-in inactive guest report first: ID Governance → Dashboard → Guest access governance → View inactive guests. It defaults to a 90-day inactivity threshold (configurable via Edit inactivity threshold) and breaks guests down by never-signed-in vs. inactive-since-last-sign-in.$stp$),
    jsonb_build_object('text', $stp$Create a dynamic group scoping the guest population you want to govern, for example by domain:$stp$, 'code', $cod$(user.userType -eq "Guest") -and (user.mail -contains "@<PartnerDomain>") -and (user.accountEnabled -eq true)$cod$, 'codeLanguage', $lng$text$lng$),
    jsonb_build_object('text', $stp$Create an access review against that group: ID Governance → Access Reviews → New access review → Teams + Groups → Select Teams + groups → the dynamic group, Scope = Guest users only, and check "Inactive users (on tenant level) only" with Days inactive set to the same threshold (this deliberately excludes recently-created guests, so a guest can sign in at least once before being swept up).$stp$),
    jsonb_build_object('text', $stp$In Settings, enable "Auto apply results to resource", set "If reviewers don't respond" and "Action to apply on denied guest users" to "Block user from signing in for 30 days, then remove user from the tenant", and enable the "No sign-in within 30 days" reviewer decision helper so reviewers get a denial recommendation based on real activity.$stp$)
  ),
  $eo$Guest accounts with no sign-in activity past the organization's inactivity threshold are caught by a recurring access review, blocked from signing in, and removed after 30 days if no one intervenes — stale guests no longer persist indefinitely as unreviewed standing access.$eo$,
  $vs$Re-open the inactive guest report on the ID Governance dashboard and confirm the inactive-guest count is trending down / matches only guests still within an active review's grace period; confirm the access review's Results show denied guests actually transitioned to blocked/removed.$vs$,
  $vc$Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/users?`$filter=userType eq 'Guest' and signInActivity/lastSignInDateTime le 2026-06-04T00:00:00Z&`$select=displayName,mail,signInActivity" | Select-Object -ExpandProperty value$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/entra/identity/users/clean-up-stale-guest-accounts$url$,
    $url$https://learn.microsoft.com/en-us/entra/identity/monitoring-health/howto-manage-inactive-user-accounts$url$,
    $url$https://learn.microsoft.com/en-us/entra/id-governance/access-reviews-external-users$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Microsoft Graph v1.0 (signInActivity)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2041) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'admin_center_only',
  $note$The validation_command date (2026-06-04) is a 90-day-back placeholder relative to this migration's authored date (2026-09-02) — substitute the tenant's actual threshold date when running it. signInActivity requires Entra ID P1/P2 and cannot be combined with other $filter properties per Microsoft's documented constraint.$note$
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Discoverability
-- ─────────────────────────────────────────────────────────────────────────────

(
  'governance:public-groups-discoverable',
  $ttl$Restrict Microsoft 365 group discoverability to Private where open membership isn't intended$ttl$,
  $sum$A Microsoft 365 group set to Public visibility can be joined by anyone in the tenant without owner approval, and per Microsoft's own definition of the setting, its content and conversations are visible to any authenticated user — for a group holding anything beyond genuinely open, tenant-wide content, Public discoverability means membership and content exposure are effectively ungoverned: anyone who finds the group in search can self-join with no owner ever asked to approve it.$sum$,
  jsonb_build_array(
    $prq$Groups Administrator, Exchange Administrator, or the group's own owner to change its privacy setting$prq$,
    $prq$Exchange Online PowerShell (Connect-ExchangeOnline) for scripted/bulk remediation$prq$
  ),
  $apath$Microsoft 365 admin center → Teams & groups → Active teams & groups → select group → Settings → Privacy$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Enumerate public Microsoft 365 groups and confirm with each group's owner whether Public is actually intended — a genuinely open, tenant-wide group (e.g. an all-company announcements list) is a legitimate use of Public; most project- or team-scoped groups aren't.$stp$),
    jsonb_build_object('text', $stp$For each group that should be restricted, change Privacy from Public to Private in the Microsoft 365 admin center: select the group → Settings → Privacy → Private → Save.$stp$),
    jsonb_build_object('text', $stp$For scripted/bulk remediation, use Exchange Online PowerShell:$stp$, 'code', $cod$Connect-ExchangeOnline
Set-UnifiedGroup -Identity "<GroupName>" -AccessType Private$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Communicate the change to existing members/owners before flipping visibility — members already in the group are unaffected, but going forward new members need an owner's approval to join rather than being able to self-join via search.$stp$)
  ),
  $eo$Only groups the business has deliberately decided should be open tenant-wide remain Public; every other Microsoft 365 group requires owner approval to join and its content is no longer visible to the whole tenant by default.$eo$,
  $vs$Re-run the public-group enumeration and confirm the remaining Public groups match only the intentionally-public set; spot-check a remediated group's visibility now shows Private.$vs$,
  $vc$Get-MgGroup -Filter "groupTypes/any(c:c eq 'Unified')" -ConsistencyLevel eventual -All -Property Id,DisplayName,Visibility | Where-Object { $_.Visibility -eq 'Public' } | Select-Object DisplayName, Id$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/microsoft-365/admin/create-groups/manage-groups$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/set-unifiedgroup$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/group?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Exchange Online Management (Set-UnifiedGroup), Microsoft Graph PowerShell SDK, Microsoft Graph v1.0 group resource (visibility property)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2041) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  NULL
),

(
  'governance:public-teams-discoverable',
  $ttl$Restrict public Microsoft Teams to Private where open membership isn't intended$ttl$,
  $sum$A Team set to Public visibility can be found and joined by anyone in the tenant without owner approval, and because every Team is backed by a Microsoft 365 group whose visibility drives this, joining exposes the Team's standard channels, files, and chat history immediately. Unlike a plain M365 group, Teams surfaces "Public" as a first-class, searchable "join team" affordance right in the client, so an unreviewed Public team is one search away from picking up an unintended member — this is rarely the intent for a project or departmental Team.$sum$,
  jsonb_build_array(
    $prq$Teams Administrator (for the MicrosoftTeams PowerShell module) or Groups Administrator for the underlying group$prq$,
    $prq$MicrosoftTeams PowerShell module (Connect-MicrosoftTeams) for scripted remediation$prq$
  ),
  $apath$Microsoft Teams admin center → Teams → Manage teams → select team → Settings (or in the Teams client: team name → … → Edit team → Privacy)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Enumerate public Teams and confirm with each Team's owner whether Public visibility is genuinely intended.$stp$),
    jsonb_build_object('text', $stp$For each Team that should be restricted, change Privacy from Public to Private directly in the Teams client (team name → … → Edit team → Privacy → Private) or via the Teams admin center.$stp$),
    jsonb_build_object('text', $stp$For scripted/bulk remediation, use the MicrosoftTeams PowerShell module:$stp$, 'code', $cod$Connect-MicrosoftTeams
Set-Team -GroupId "<TeamGroupId>" -Visibility Private$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Re-communicate to owners that new members must now be added directly (or requested and approved) rather than self-joining via search.$stp$)
  ),
  $eo$Only Teams the business has deliberately decided should be open tenant-wide remain Public; every other Team requires an owner to add members rather than allowing tenant-wide self-join via search.$eo$,
  $vs$Re-run the public-Team enumeration and confirm the remaining Public teams match only the intentionally-public set.$vs$,
  $vc$Get-MgGroup -Filter "resourceProvisioningOptions/Any(x:x eq 'Team')" -ConsistencyLevel eventual -All -Property Id,DisplayName,Visibility | Where-Object { $_.Visibility -eq 'Public' } | Select-Object DisplayName, Id$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/powershell/module/teams/set-team?view=teams-ps$url$,
    $url$https://learn.microsoft.com/en-us/graph/api/resources/group?view=graph-rest-1.0$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; MicrosoftTeams PowerShell module, Microsoft Graph PowerShell SDK, Microsoft Graph v1.0 group resource (visibility property)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2041) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  NULL
),

-- ─────────────────────────────────────────────────────────────────────────────
-- CLUSTER: Microsoft Purview — labels & retention
-- ─────────────────────────────────────────────────────────────────────────────

(
  'governance:auto-labeling-coverage',
  $ttl$Configure auto-labeling policies for sensitivity labels$ttl$,
  $sum$Without an active auto-labeling policy, sensitivity labels only ever get applied when a user manually picks one — that leaves the large volume of content created before labeling existed, or by users who never engage with the label prompt, permanently unclassified. An auto-labeling policy is the only mechanism that applies labels at the service level to existing SharePoint, OneDrive, and Exchange content regardless of user behavior, which is exactly why Microsoft gates it behind a mandatory simulation run first — a badly-scoped condition can mislabel a large volume of content very quickly once turned on.$sum$,
  jsonb_build_array(
    $prq$Compliance Administrator or Compliance Data Administrator role to turn a policy on after simulation (the Turn on policy button stays greyed out without one of these, even after a successful simulation)$prq$,
    $prq$Data Classification Content Viewer role (included in Content Explorer Content Viewer / Information Protection / Information Protection Investigators role groups) to review simulation results — Global Administrators do not have this by default$prq$,
    $prq$Auditing turned on for Microsoft 365, required for simulation to run at all$prq$,
    $prq$Sensitivity labels already created; if the label applies encryption, it must be configured for "Assign permissions now" with "User access to content expires" set to Never before it can be auto-applied to SharePoint/OneDrive content$prq$
  ),
  $apath$Microsoft Purview portal → Solutions → Information Protection → Auto-labeling → + Create auto-labeling policy$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm prerequisites before creating anything — audit logging on, sensitivity labels already created, and (if the label encrypts) the label set to "Assign permissions now" / "Never" expires. Missing any one of these typically makes a policy run with zero matches and no visible error, which is the most common reason auto-labeling "isn't working."$stp$),
    jsonb_build_object('text', $stp$Create the auto-labeling policy: choose a sensitive information type or trainable classifier condition and the label to apply, scope the SharePoint/OneDrive/Exchange locations, and save. The policy is created in simulation mode by default and cannot label anything live yet.$stp$),
    jsonb_build_object('text', $stp$Review the simulation results (budget the full 12-hour target completion window) using an account with the Data Classification Content Viewer role, and confirm the matched content is genuinely what should carry that label. Simulation shows only a single policy's result — if more than one auto-labeling policy could apply to the same content, expect the enforced outcome once all policies are live to differ from any one simulation.$stp$),
    jsonb_build_object('text', $stp$Turn the policy on (requires Compliance Administrator or Compliance Data Administrator) once simulation results look correct.$stp$),
    jsonb_build_object('text', $stp$For bulk/scripted policy creation via Security & Compliance PowerShell:$stp$, 'code', $cod$New-AutoSensitivityLabelPolicy -Name "<AutoLabelingPolicyName>" -SharePointLocation "<SharePointSiteUrl>" -ApplySensitivityLabel "<LabelName>" -Mode TestWithoutNotifications
New-AutoSensitivityLabelRule -Policy "<AutoLabelingPolicyName>" -Name "<AutoLabelingRuleName>" -ContentContainsSensitiveInformation @{"name"="<SensitiveInfoTypeGuid>";"mincount"="2"} -Workload SharePoint$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$At least one auto-labeling policy is turned On (not left indefinitely in simulation) and covers the SharePoint/OneDrive/Exchange locations holding sensitive but currently-unlabeled content, so labels get applied at the service level rather than depending entirely on manual user action.$eo$,
  $vs$In the Purview portal, confirm the policy's status is On (not Simulation or Ready to turn on), and monitor Activity explorer for matched items actually receiving the label in production rather than just in a simulation run.$vs$,
  $vc$Get-AutoSensitivityLabelPolicy | Select-Object Name, Mode, Enabled$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/purview/apply-sensitivity-label-automatically$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Security & Compliance PowerShell (ExchangePowerShell module)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2041) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  $note$Simulation mode supports up to 4,000,000 matched files; a policy matching more than that can't be turned on until the conditions are narrowed and simulation re-run.$note$
),

(
  'governance:sensitivity-label-adoption',
  $ttl$Publish sensitivity labels so users can actually apply them$ttl$,
  $sum$A sensitivity label that's been created but never added to a published label policy is invisible to users — it won't appear in Office apps or any other supporting service no matter how well-designed the label taxonomy is, so low "percentage of content covered by sensitivity labels" often isn't users declining to label content, it's that there's nothing to select. Low adoption even after publishing usually traces to the label policy's target group being too narrow, or the default/mandatory labeling settings that drive real usage never having been turned on.$sum$,
  jsonb_build_array(
    $prq$Permissions to create and manage sensitivity labels — see Purview's Information Protection admin/contributor role groups$prq$,
    $prq$Sensitivity labels already created before they can be published$prq$
  ),
  $apath$Microsoft Purview portal → Solutions → Information Protection → Sensitivity labels (create) and → Label policies (publish)$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm the labels needed already exist and are scoped correctly (Files & other data assets, Emails, Groups & sites, Meetings) under Information Protection → Sensitivity labels.$stp$),
    jsonb_build_object('text', $stp$Publish them via a label policy: Label policies → Publish labels, select the labels to publish, and target the appropriate users/groups — groups are recommended over individual users for lower ongoing maintenance, since removing a user from the group automatically removes the policy for them. Completing the wizard automatically publishes the policy; there's no separate publish/republish action.$stp$),
    jsonb_build_object('text', $stp$To drive real adoption rather than just visibility, configure the policy's default label and, where appropriate, "require users to apply a label" (mandatory labeling) so content doesn't go out unlabeled by omission.$stp$),
    jsonb_build_object('text', $stp$Budget up to 24 hours for label and policy changes to propagate to Office apps and services before troubleshooting adoption numbers — some surfaces update within the hour, but group-membership-dependent scoping can take up to 48 hours.$stp$),
    jsonb_build_object('text', $stp$Script label/policy creation for bulk rollout via Security & Compliance PowerShell:$stp$, 'code', $cod$New-Label -Name "<LabelName>" -DisplayName "<Display Name>" -ToolTip "<Tooltip text>"
New-LabelPolicy -Name "<PolicyName>" -Labels "<LabelName>" -ExchangeLocation All -ModernGroupLocation All$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Every sensitivity label intended for use is included in a published, currently-active label policy targeted at the users who need it, with default/mandatory labeling configured wherever the business needs coverage to be complete rather than opportunistic.$eo$,
  $vs$Confirm in Label policies that the relevant policy is published/active and its assigned users/groups actually cover the intended population; check Content explorer / Activity explorer for label-applied volume trending upward after propagation.$vs$,
  $vc$Get-Label | Format-Table -Property DisplayName, Name, Guid, ContentType$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/purview/create-sensitivity-labels$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Security & Compliance PowerShell (ExchangePowerShell module)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2041) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  NULL
),

(
  'governance:retention-label-adoption',
  $ttl$Publish and drive real application of retention labels$ttl$,
  $sum$A retention label that exists but was never published through a label policy never reaches users' apps, and one that's published but never set as a default (or applied via auto-apply) depends entirely on individual users remembering to hand-apply it document by document — low retention-label adoption almost always traces to one of those two gaps, not to users declining to label content. Without labeled content, the organization can't reliably demonstrate what's being retained or deleted, and e-discovery or audit requests fall back to guessing at unlabeled data.$sum$,
  jsonb_build_array(
    $prq$Permissions for records management or data lifecycle management — see the respective "Get started" articles' permissions sections in the Purview portal$prq$,
    $prq$Retention labels already created via File plan manager before they can be published$prq$
  ),
  $apath$Microsoft Purview portal → Solutions → Records Management (or Data Lifecycle Management) → Policies → Label policies → Publish labels$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Confirm the retention labels needed already exist (File plan manager) before attempting to publish.$stp$),
    jsonb_build_object('text', $stp$Publish them: Label policies → Publish labels, select the labels, choose Static or Adaptive scope (Adaptive requires an adaptive scope to already exist), and select the target locations (SharePoint, OneDrive, Exchange, etc.). Budget up to a day for SharePoint/OneDrive and up to 7 days for Exchange before labels appear for users.$stp$),
    jsonb_build_object('text', $stp$Drive actual application rather than just availability: set a default retention label on document libraries/folders that predominantly hold one content type so unlabeled items inherit it automatically, instead of relying solely on manual per-item labeling.$stp$),
    jsonb_build_object('text', $stp$If labels haven't appeared after 7 days, check the label policy's Status for an (Error) state and retry distribution:$stp$, 'code', $cod$Set-RetentionCompliancePolicy -Identity "<PolicyName>" -RetryDistribution$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$For Exchange specifically, confirm the per-mailbox label-processing job (runs roughly every 7 days) has actually run before assuming the policy itself is broken:$stp$, 'code', $cod$$logProps = Export-MailboxDiagnosticLogs <user> -ExtendedProperties
([xml]$logProps.MailboxLog).Properties.MailboxTable.Property | Where-Object { $_.Name -like "ELC*" }$cod$, 'codeLanguage', $lng$powershell$lng$)
  ),
  $eo$Retention labels needed for the organization's content are published to the relevant SharePoint/OneDrive/Exchange locations, with default-label configuration applied wherever manual per-item labeling alone would leave adoption low, and no label policy sits in a persistent (Error) distribution state.$eo$,
  $vs$Confirm the label policy's Status in Label policies shows successful distribution (no Error), spot-check a document library's default label setting, and confirm newly created items in that library inherit the label without manual action.$vs$,
  $vc$Get-RetentionCompliancePolicy | Select-Object Name, Enabled$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/purview/create-apply-retention-labels$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/new-retentioncompliancepolicy$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Security & Compliance PowerShell (ExchangePowerShell module)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2041) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  NULL
),

(
  'governance:retention-policy-coverage',
  $ttl$Cover every required workload with an active retention policy$ttl$,
  $sum$Low "percentage of workloads covered by a retention policy" means some combination of Exchange, SharePoint, OneDrive, Microsoft 365 Groups, or Teams locations have no retention policy holding their content — for an uncovered workload, content can be deleted (accidentally, or by a departing employee) with nothing to fall back on, and any compliance or legal obligation to retain that workload's content for a minimum period goes unmet. A policy that exists but is disabled, or was created with `-IsSimulation`, counts as coverage in name only and exerts no real preservation.$sum$,
  jsonb_build_array(
    $prq$Permissions for data lifecycle management — see the get-started-with-data-lifecycle-management article's permissions section in the Purview portal$prq$,
    $prq$Target SharePoint sites must be indexed before they can be added to a policy; mailboxes must exist as normal Exchange Online mailboxes$prq$
  ),
  $apath$Microsoft Purview portal → Solutions → Data Lifecycle Management → Policies → Retention policies → + New retention policy$apath$,
  NULL,
  jsonb_build_array(
    jsonb_build_object('text', $stp$Inventory current coverage by workload (Exchange, SharePoint, OneDrive, Microsoft 365 Groups, Teams channel/chat messages) against the retention policies that already exist, and identify which workloads have no active policy applying to them.$stp$),
    jsonb_build_object('text', $stp$Create a retention policy for each uncovered workload — Static scope for a straightforward "entire location" or explicit include/exclude policy, or Adaptive scope for one driven by dynamically-evaluated membership (adaptive scopes must already exist to use this option).$stp$),
    jsonb_build_object('text', $stp$For a policy meant to cover everything in a workload rather than a subset, leave the location toggle at its default of applying to the entire location; use explicit includes/excludes only when a genuine subset is intended.$stp$),
    jsonb_build_object('text', $stp$Script coverage for a straightforward Exchange + SharePoint policy via Security & Compliance PowerShell:$stp$, 'code', $cod$New-RetentionCompliancePolicy -Name "<PolicyName>" -ExchangeLocation All -SharePointLocation All -Enabled $true
New-RetentionComplianceRule -Policy "<PolicyName>" -RetentionDuration <Days> -RetentionComplianceAction Keep$cod$, 'codeLanguage', $lng$powershell$lng$),
    jsonb_build_object('text', $stp$Only apply Preservation Lock (-RestrictiveRetention $true) once the retention settings are confirmed correct — a locked policy can be extended but never reduced, disabled, or turned off.$stp$)
  ),
  $eo$Every workload the organization is obligated (by policy or compliance requirement) to retain has at least one enabled, non-simulation retention policy actively applying to it — no workload is silently uncovered.$eo$,
  $vs$Re-run the workload coverage inventory against Get-RetentionCompliancePolicy and confirm each required workload now maps to at least one Enabled policy; spot-check that the policy actually lists that workload's location (ExchangeLocation/SharePointLocation/etc.) rather than an empty location set, since a policy with no locations placed nothing on hold.$vs$,
  $vc$Get-RetentionCompliancePolicy | Select-Object Name, Enabled, ExchangeLocation, SharePointLocation, OneDriveLocation, ModernGroupLocation$vc$,
  jsonb_build_array(
    $url$https://learn.microsoft.com/en-us/purview/retention$url$,
    $url$https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/new-retentioncompliancepolicy$url$
  ),
  $vag$Microsoft Learn (learn.microsoft.com), fetched 2026-09-02; Security & Compliance PowerShell (ExchangePowerShell module)$vag$,
  '2026-09-02'::timestamptz,
  $vby$Claude Sonnet 5 (build #2041) — agent-authored, verified against Microsoft Learn; awaiting human spot-check$vby$,
  'published',
  'you_must_run',
  NULL
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
VALUES ('2026-09-02-remediation-kb-governance-domain-2041.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- Verify: how many governance: rows are published after this migration.
SELECT
  count(*) FILTER (WHERE check_key LIKE 'governance:%') AS governance_rows,
  count(*) FILTER (WHERE check_key LIKE 'governance:%' AND status = 'published') AS governance_published,
  count(*) AS total_rows
FROM remediation_knowledge_base;
