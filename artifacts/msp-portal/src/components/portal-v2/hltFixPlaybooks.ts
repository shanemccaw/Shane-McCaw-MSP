/**
 * hltFixPlaybooks.ts — the thirteen Health playbooks.
 *
 * Transcribed from `HLT_FIXES` (`Customer Portal Shell.dc.html` 13199-13265) and
 * assembled through the prototype's own mapper (13266-13284).
 *
 * ── A fourth distinct wrapper ──────────────────────────────────────────────
 * Compliance opens with a Purview sign-in, Licensing with a commerce-versus-Graph
 * note, Adoption with a branch on `canAutomate`. Health's opener draws the line
 * this pillar turns on: cloud-side work runs through Graph from the container,
 * but anything touching the sync server or on-premises Exchange runs LOCALLY on
 * that server. It is the only pillar with work that cannot be done from the
 * container at all. Its closer is about the debt count dropping on the next
 * scan rather than an evidence pack or a savings ledger.
 *
 * ── Not every Health wrench lands here ─────────────────────────────────────
 * The drift table and the stale-object inventory both carry keys belonging to
 * OTHER pillars (`gov-drift-*`, `cmp-retention-coverage`, `ca-CA201-…`,
 * `oauth-dormant`). Drift is detected on this page and remediated where the
 * setting lives, so those route to the owning pillar's playbook. Several of
 * those pillars are not built yet, so those wrenches resolve to the generic
 * fallback for now — deliberately, and recorded in the manifest rather than
 * papered over with invented Health copies.
 */

import type { FixPlaybook } from "./fixPanelLibrary";
import { HLT_GREEN } from "./hltDashboardData";

const CLOUD_VS_LOCAL =
  "Cloud-side work runs through Graph from the container. Anything touching the sync server or on-premises Exchange runs locally on that server — the steps say which is which.";
const RESCAN_AND_DEBT =
  "Come back to this screen and click Re-scan. Cleared items drop out of the debt count on the next scan.";

interface HltFixSpec {
  key: string;
  title: string;
  desc: string;
  risk: string;
  reward: string;
  manual: string[];
  graph: string[];
  result: string;
}

const HLT_FIXES: readonly HltFixSpec[] = [
  {
    key: "hlt-exchange-eol",
    title: "Deal with the out-of-support Exchange hybrid server",
    desc: "Exchange 2019 has been out of support since 14 October 2025. No mailboxes remain on-premises, so the realistic choice is decommission the last hybrid server or move to Exchange Server Subscription Edition to keep hybrid capability.",
    risk: "Decommissioning a hybrid server is not a quick task and it is hard to reverse. Directory writeback, the migration endpoint, and free/busy federation all have to be unwound in order, and any application still relaying mail through the server has to be moved first.",
    reward: "The last unsupported, unpatched server in the estate stops existing, along with the hybrid configuration nobody has needed since the migration finished.",
    manual: [
      "Inventory everything still pointing at the server: SMTP relay clients, the migration endpoint, free/busy, and directory writeback.",
      "Move SMTP relay to direct send or a cloud connector — this is usually the item that blocks everything else.",
      "Fix the 2 broken free/busy delegations before removing federation, or they become permanent.",
      "Decide writeback: if Entra Connect stays for identity sync, keep it; if not, plan its removal in the same window.",
      "Run the Hybrid Configuration Wizard removal, then decommission the server following the documented order.",
      "Keep the server powered off but recoverable for 30 days rather than deleting it immediately.",
    ],
    graph: [
      "Reading hybrid configuration and Exchange build state",
      "Inventorying SMTP relay clients and mail flow dependencies",
      "Testing free/busy for the 2 affected users",
      "Producing the ordered decommission plan with dependencies",
      "Costing the Subscription Edition alternative alongside it",
      "Recording the decision and the 30-day recoverability window",
    ],
    result: "Both paths costed with an ordered decommission plan. 7 SMTP relay clients identified as the first dependency to move.",
  },
  {
    key: "hlt-connect-sync",
    title: "Clear sync errors, upgrade Entra Connect, then build a standby",
    desc: "14 objects fail every sync cycle, the build is two versions behind, and there is no staging-mode standby. Three stages, deliberately in that order.",
    risk: "Upgrading with 14 failing objects carries the failures into the new build and makes it harder to tell what the upgrade broke. Building a standby before the errors are fixed replicates a broken configuration. The order is the risk control.",
    reward: "Sync stops failing silently, the server is on a supported build, and a hardware failure stops being an outage that needs a rebuild from scratch.",
    manual: [
      "Remove the 3 stale OUs from sync scope — that clears most of the duplicate attribute errors on its own.",
      "Resolve the remaining duplicate attribute and UPN suffix errors object by object using IdFix or the Entra Connect error report.",
      "Confirm 0 sync errors across two consecutive full cycles before touching the build.",
      "Upgrade Entra Connect to the current release in a maintenance window, then verify a full sync cycle.",
      "Reinstall and re-register the Connect Health agent so Microsoft alerting works again.",
      "Build the second server in staging mode, verify it produces the same export preview, and document the failover procedure.",
    ],
    graph: [
      "Reading sync scope, errors, and version state",
      "Removing 3 stale OUs from sync scope",
      "Resolving 14 object errors individually",
      "Verifying two clean full sync cycles",
      "Upgrading to the current supported build",
      "Re-registering Connect Health and building the staging-mode standby",
    ],
    result: "Stage 1 complete: stale OUs removed and 11 of 14 errors cleared. 3 duplicate-attribute objects need a decision on which record wins before the upgrade proceeds.",
  },
  {
    key: "hlt-app-owners",
    title: "Assign app registration owners and cap credential lifetime",
    desc: "61 registrations have no owner, 1 credential has already expired, 3 expire within 30 days, and 4 have no expiry at all. An app management policy prevents the last category from recurring.",
    risk: "A credential lifetime policy applies to new credentials and rejects non-compliant ones, so a team that habitually creates never-expiring secrets will hit a failure the first time. Announce it before enforcing.",
    reward: "Expiry warnings reach a person, and the class of failure where a job dies quietly for 8 days stops being possible.",
    manual: [
      "Match each unowned registration to a department using its sign-in pattern and permissions, and propose owners for confirmation.",
      "Renew the expired Legacy Reporting Service credential or retire the app — it is failing 44 times a day either way.",
      "Renew the 3 credentials expiring within 30 days, starting with the one 12 days out.",
      "Create an app management policy capping password credential lifetime at 180 days and blocking credentials with no expiry.",
      "Enable expiry notifications to owners at 60 and 30 days.",
      "Announce the policy a fortnight before enforcing it.",
    ],
    graph: [
      "Reading all registrations with credentials and owners",
      "Proposing owners from usage and permission patterns",
      "Renewing 4 credentials in priority order",
      "Creating the app management policy with a 180-day cap",
      "Enabling owner notifications at 60 and 30 days",
      "Scheduling enforcement after the announcement window",
    ],
    result: "Owners proposed for all 61 registrations and 4 credentials renewed. Credential lifetime policy staged, enforcing in 14 days after the announcement.",
  },
  {
    key: "hlt-baseline-reconcile",
    title: "Reconcile configuration drift and re-sign the baseline",
    desc: "10 of 47 tracked settings differ from the baseline recorded at scan 1. Eight have an actor and a date; two predate the baseline. Each one gets reverted or adopted deliberately.",
    risk: "Reverting a drifted setting can break whatever the change was made for, and in two cases nobody knows why the change was made. Those two need a decision rather than a revert.",
    reward: "The tenant matches its own documentation again, and the next drift is visible against a baseline somebody has actually signed.",
    manual: [
      "Review the 8 attributable drifts with the person who made each change where they are still here.",
      "Revert the ones with no justification — the sharing default and the SMTP AUTH setting are handled by their own fixes.",
      "Adopt into the baseline the ones that turn out to be correct, with a note on why.",
      "For the 2 unattributable settings, decide the intended value from first principles and record it as a new decision.",
      "Re-sign the baseline with a date and an owner, and note that it supersedes the scan 1 version.",
      "Set drift alerting on the 12 settings with the highest consequence rather than all 47.",
    ],
    graph: [
      "Comparing 47 tracked settings against the signed baseline",
      "Attributing changes from the audit log",
      "Preparing revert-or-adopt recommendations per setting",
      "Applying approved reverts",
      "Re-signing the baseline with owner and date",
      "Enabling drift alerting on 12 high-consequence settings",
    ],
    result: "Reconciliation prepared: 6 reverts recommended, 2 adoptions, 2 needing a decision. Baseline ready to re-sign once those 2 are settled.",
  },
  {
    key: "hlt-stale-devices",
    title: "Clean up stale objects and set recurring rules",
    desc: "78 stale objects: 31 devices, 9 duplicates, 18 empty groups, 6 unassigned profiles, 14 dormant service principals. One pass now, then thresholds so the count stops climbing between manual cleanups.",
    risk: "Deleting a device record signs that device out and it has to re-register. Several empty groups are referenced in Conditional Access exclusions, and deleting those changes policy behaviour — those are excluded until each reference is checked.",
    reward: "Compliance percentages and licence counts stop being computed against inflated denominators, and the estate becomes readable again.",
    manual: [
      "Disable the 31 stale device records first rather than deleting, and delete after 30 days if nothing objects.",
      "Merge the 9 duplicate device records, keeping the one Intune currently manages.",
      "Check every empty group for Conditional Access, licensing, and app assignment references before deleting any of them.",
      "Delete the 6 unassigned Intune profiles after exporting their configuration for reference.",
      "Set the Entra device cleanup rule to 120 days so this runs continuously.",
      "Schedule a quarterly review for the object classes that cannot be automated.",
    ],
    graph: [
      "Identifying stale, duplicate, and empty objects by class",
      "Checking every empty group for policy references",
      "Disabling 31 stale device records with a 30-day deletion date",
      "Merging 9 duplicate device records",
      "Exporting and removing 6 unassigned profiles",
      "Enabling the 120-day device cleanup rule",
    ],
    result: "31 devices disabled with deletion dates set, 9 duplicates merged, and 6 profiles removed. 5 empty groups held back — they are referenced in Conditional Access exclusions.",
  },
  {
    key: "hlt-message-center",
    title: "Route Message Center posts to a channel with a weekly review",
    desc: "34 posts are unreviewed and 3 of them affect settings you rely on. Filtered routing plus a 15-minute weekly review turns surprises into scheduled decisions.",
    risk: "None, beyond the risk of routing the full firehose and having it ignored. The filter is what makes this work.",
    reward: "Changes to your configuration arrive as a decision on a Tuesday rather than as an incident on a Friday.",
    manual: [
      "Filter Message Center to the services in use and to change categories that require action.",
      "Route filtered posts into the IT operations channel through the Graph service announcement API or the built-in connector.",
      "Book a 15-minute weekly review with one named owner.",
      "Triage the 34-post backlog once, starting with the 3 that affect current configuration.",
      "Record decisions against the relevant posts so the review leaves a trail.",
    ],
    graph: [
      "Reading Message Center posts filtered to services in use",
      "Configuring routing into the IT operations channel",
      "Triaging the 34-post backlog by relevance",
      "Flagging the 3 posts affecting current configuration",
      "Booking the weekly review with a named owner",
      "Recording decisions against each post",
    ],
    result: "Routing configured and the backlog triaged: 3 posts flagged for action, 9 for awareness, 22 closed as not applicable.",
  },
  {
    key: "hlt-duplicate-devices",
    title: "Merge 9 duplicate device records",
    desc: "Nine hardware IDs appear twice in Entra ID, left behind by re-enrolment. Compliance reporting counts both records, so every device percentage on the portal is computed against an inflated denominator.",
    risk: "Merging the wrong direction removes the record Intune manages and the device shows as unmanaged until it re-registers. The rule is to keep whichever record Intune currently reports against.",
    reward: "Device counts and compliance percentages become accurate, which matters because other pillars quote them.",
    manual: [
      "List device records grouped by hardware ID where the count is greater than one.",
      "For each pair, identify which record Intune currently manages by last check-in.",
      "Delete the non-managed record.",
      "Confirm the device still reports compliant after the deletion.",
      "Recalculate device compliance percentages and note the corrected denominator.",
    ],
    graph: [
      "Grouping device records by hardware ID",
      "Identifying the Intune-managed record per pair",
      "Deleting 9 non-managed duplicate records",
      "Verifying compliance state per affected device",
      "Recalculating device totals",
      "Publishing the corrected denominator",
    ],
    result: "9 duplicates removed with compliance verified per device. Device total corrected from 212 to 203.",
  },
  {
    key: "hlt-credentials",
    title: "Renew the expired and expiring app credentials",
    desc: "One credential expired 8 days ago and its job has been failing 44 times a day since. Three more expire within 30 days, the nearest in 12 days, and two of those belong to unowned registrations.",
    risk: "Rotating a credential without updating the consuming service breaks it immediately. Each renewal needs the consumer identified first, which for the unowned registrations is the slow part.",
    reward: "Four integrations stop being scheduled outages.",
    manual: [
      "For each credential, identify the consuming service from sign-in logs before generating anything.",
      "Generate the new credential with a 180-day expiry and update the consumer.",
      "Verify a successful token request from the consumer, then remove the old credential.",
      "For the expired Legacy Reporting Service, decide first whether the app should be retired instead — it is failing into a report nobody reads.",
      "Record the renewal date and owner for each.",
    ],
    graph: [
      "Reading credential expiry across all registrations",
      "Identifying consuming services from sign-in logs",
      "Generating replacement credentials with 180-day expiry",
      "Verifying successful token requests per consumer",
      "Removing superseded credentials",
      "Recording renewal dates and owners",
    ],
    result: "3 credentials renewed and verified. The expired Legacy Reporting Service credential held pending the retire-or-rescope decision on the Security OAuth page.",
  },
  {
    key: "hlt-empty-groups",
    title: "Remove empty security groups that are safe to remove",
    desc: "18 empty security groups, several referenced in Conditional Access exclusions. An empty group in an exclusion is not harmless — it is a door propped open for nobody, which is fine until somebody is added to it.",
    risk: "Deleting a group referenced by a Conditional Access exclusion changes policy behaviour. Every reference is checked before anything is deleted, and referenced groups stay until the reference is removed deliberately.",
    reward: "Fewer objects, and the exclusion lists in Conditional Access start reflecting real intent.",
    manual: [
      "Check each group for references in Conditional Access, licensing, app assignment, and SharePoint permissions.",
      "Delete the unreferenced groups.",
      "For referenced groups, review the reference with the policy owner — an empty exclusion group usually means the exception ended.",
      "Remove the reference first, then the group.",
      "Record which groups were kept and why.",
    ],
    graph: [
      "Identifying empty security groups",
      "Checking references across policies and assignments",
      "Deleting unreferenced groups",
      "Reviewing exclusion references with policy owners",
      "Removing references then groups where agreed",
      "Recording retained groups with reasons",
    ],
    result: "13 empty groups deleted. 5 retained pending review of the Conditional Access exclusions that reference them.",
  },
  {
    key: "hlt-orphan-profiles",
    title: "Remove unassigned Intune profiles",
    desc: "Six configuration profiles exist and target nothing. They make the real configuration harder to read and turn every troubleshooting session into a longer one.",
    risk: "A profile that looks unassigned may be a staged rollback nobody documented. Export each configuration before deleting so it can be recreated.",
    reward: "What is actually applied to devices becomes readable at a glance.",
    manual: [
      "List configuration profiles with no assignments.",
      "Export each profile’s JSON so it can be recreated if needed.",
      "Check with the platform team whether any is a staged rollback.",
      "Delete the confirmed orphans.",
      "Note the export location in the Intune documentation.",
    ],
    graph: [
      "Listing configuration profiles with no assignments",
      "Exporting profile configuration as JSON",
      "Confirming none is a staged rollback",
      "Deleting 6 orphaned profiles",
      "Recording export locations",
      "Verifying no device configuration changed",
    ],
    result: "6 orphaned profiles exported and deleted, with no change to any device configuration.",
  },
  {
    key: "hlt-disabled-accounts",
    title: "Clear up 23 disabled accounts that were never removed",
    desc: "23 accounts have been disabled for between 6 weeks and 14 months. Eleven still hold licences, four still own groups, and all of them still count in reports.",
    risk: "Deleting an account deletes its mailbox after 30 days unless the mailbox is converted or put on hold. Four accounts own groups, and those owners have to be replaced before deletion or the groups become ownerless.",
    reward: "Licence counts, group ownership, and every per-user report stop including people who left.",
    manual: [
      "For each account, record mailbox size, hold state, group ownership, and licence assignment.",
      "Convert or hold the mailboxes that must be kept.",
      "Replace group ownership for the 4 that own groups.",
      "Remove licences, then delete the accounts after the 30-day soft-delete window is understood.",
      "Add a 90-day disabled-account review to the offboarding runbook.",
    ],
    graph: [
      "Reading state for 23 disabled accounts",
      "Recording mailbox, hold, ownership and licence position",
      "Converting or holding mailboxes that must be kept",
      "Replacing group ownership on 4 accounts",
      "Removing licences and scheduling deletions",
      "Adding the 90-day review to the offboarding runbook",
    ],
    result: "All 23 accounts assessed: 15 cleared for deletion, 4 need ownership replacement first, 4 mailboxes converted to shared.",
  },
  {
    key: "hlt-compliance-grace",
    title: "Return the Intune compliance grace period to baseline",
    desc: "The grace period was widened from 1 day to 14 five weeks ago. For 14 days a non-compliant device keeps full access, which quietly weakens every device-based Conditional Access control.",
    risk: "Narrowing the grace period means devices that are currently non-compliant lose access sooner. Check how many are in the grace window before applying, or you create a support queue on the day.",
    reward: "Device compliance means something again on the same timescale your policies assume.",
    manual: [
      "Count devices currently sitting in the grace window and why.",
      "Fix the underlying compliance failures for those devices first.",
      "Return the grace period to 1 day, or to 3 if the fleet genuinely needs it — document whichever you choose.",
      "Confirm with the person who widened it whether there was a reason that still applies.",
      "Add the setting to the drift-alerting list so a future change is noticed.",
    ],
    graph: [
      "Counting devices in the compliance grace window",
      "Identifying underlying compliance failures",
      "Remediating affected devices first",
      "Returning the grace period to baseline",
      "Confirming the change with the original actor",
      "Adding the setting to drift alerting",
    ],
    result: "11 devices found in the grace window and remediated. Grace period returned to 1 day and added to drift alerting.",
  },
  {
    key: "hlt-teams-policy-sprawl",
    title: "Consolidate Teams policy sprawl",
    desc: "Three custom meeting policies exist and two are assigned to nobody. One of the three depends on a default Microsoft is changing in September, per the Message Center post on this page.",
    risk: "Deleting a policy that is assigned somewhere unexpected changes meeting behaviour for those users. Assignment is checked per policy before anything is removed.",
    reward: "Meeting behaviour becomes explainable, and the September default change has one policy to review instead of three.",
    manual: [
      "List each custom policy with its assignment count.",
      "Delete the 2 with no assignments after exporting their settings.",
      "Review the remaining custom policy against the announced default change.",
      "Fold it back into the global policy if the difference no longer matters.",
      "Record what each surviving policy is for.",
    ],
    graph: [
      "Listing custom Teams policies with assignment counts",
      "Exporting settings for unassigned policies",
      "Deleting 2 unassigned policies",
      "Reviewing the remaining policy against the announced change",
      "Consolidating into the global policy where possible",
      "Recording the purpose of each surviving policy",
    ],
    result: "2 unassigned policies exported and removed. The remaining custom policy reviewed against the September change and scheduled for consolidation.",
  },
];

/** The prototype's `hltFixLibrary` build (13266-13284). */
export const HLT_FIX_PLAYBOOKS: Readonly<Record<string, FixPlaybook>> = Object.fromEntries(
  HLT_FIXES.map((f) => [
    f.key,
    {
      key: f.key,
      title: f.title,
      pillarColor: HLT_GREEN,
      canAutomate: true,
      description: f.desc,
      sopRef: "Written procedure attached from the SOP library",
      riskText: f.risk,
      rewardText: f.reward,
      manualSteps: [
        { text: CLOUD_VS_LOCAL, link: "https://entra.microsoft.com" },
        ...f.manual.map((text) => ({ text })),
        { text: RESCAN_AND_DEBT },
      ],
      graphSteps: f.graph,
      resultSummary: f.result,
    } satisfies FixPlaybook,
  ]),
);
