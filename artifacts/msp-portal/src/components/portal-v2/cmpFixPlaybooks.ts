/**
 * cmpFixPlaybooks.ts — the six Compliance remediation playbooks.
 *
 * Transcribed from `CMP_FIXES` (`Customer Portal Shell.dc.html` 12224-12255) and
 * assembled through the prototype's OWN mapper (12256-12274), which is not a
 * formality: it wraps every compliance playbook with a leading Purview sign-in
 * step and a trailing re-scan-and-export step that are NOT in the per-fix data.
 * Writing the manual steps out flat would silently drop both from all six.
 *
 * ── Why these are here rather than left to the fallback ────────────────────
 * The Governance pass flagged that `govPages.ts`'s sharing-drift wrenches all
 * resolve to the generic fallback playbook, because their fixKeys exist in
 * neither FIX_PLAYBOOKS nor the prototype. These six DO exist in the prototype,
 * they are referenced by name from the Open Gaps rows this page renders, and
 * the page's whole claim is that a gap cites its obligation and offers a real
 * procedure. Shipping them against the fallback would make every gap on the
 * richest compliance page say "Apply the recommended change".
 *
 * `pillarColor` is `#E2E8F0` per the prototype's mapper — Compliance's near-white
 * identity, not the `#F3F4F6` the README's token table lists for pillar tiles.
 * The mapper is what the fix panel actually reads, so it wins.
 */

import type { FixPlaybook } from "./fixPanelLibrary";

/** The prototype's `pillarColor` for every compliance playbook (12260). */
const COMPLIANCE = "#E2E8F0";

/** The two steps the mapper adds around every fix's own `manual` list. */
const PURVIEW_SIGN_IN =
  "Sign in to the Microsoft Purview portal with a Compliance Administrator account. Some steps below need Security & Compliance PowerShell — they say so where they do.";
const RESCAN_AND_EXPORT =
  "Come back to this screen and click Re-scan to confirm the change took effect, then export the evidence pack for your records.";

interface CmpFixSpec {
  key: string;
  title: string;
  desc: string;
  risk: string;
  reward: string;
  manual: string[];
  graph: string[];
  result: string;
}

const CMP_FIXES: readonly CmpFixSpec[] = [
  {
    key: "cmp-retention-coverage",
    title: "Cover the 12 uncovered mailboxes with an adaptive-scope retention policy",
    desc: "12 of 1,240 mailboxes fall outside every retention policy, including two in the finance team you marked in SOX scope. A static scope caused this — it does not pick up accounts created after it was set.",
    risk: "Once a retention policy applies, users can no longer permanently delete affected mail during the retention period. Storage in the Recoverable Items folder grows, and shared mailboxes need their quota checked first.",
    reward: "The gap closes for these 12 and cannot reopen, because an adaptive scope re-evaluates membership rather than holding a fixed list.",
    manual: [
      "In the Purview portal, open Data lifecycle management → Retention policies.",
      "Create an adaptive scope for all user and shared mailboxes rather than a static list.",
      'Set the retention period to 7 years with the action "retain items, then delete".',
      "Apply the policy to Exchange email locations and run Policy lookup on the 12 mailboxes to confirm coverage.",
      "Record the policy name and effective date in the retention schedule document — the effective date is what the auditor asks for.",
    ],
    graph: [
      "Authenticating with Purview (Exchange Online Management, Compliance PowerShell)",
      "Reading current policy scopes and comparing to the full mailbox list from Graph",
      "Creating an adaptive scope covering user and shared mailboxes",
      "Applying a 7-year retain-then-delete policy",
      "Running Policy lookup against the 12 previously uncovered mailboxes",
      "Recording the effective date and exporting the coverage evidence",
    ],
    result: "All 1,240 mailboxes now covered by an adaptive-scope 7-year policy. Coverage evidence exported with the effective date recorded.",
  },
  {
    key: "cmp-audit-retention",
    title: "Extend audit retention beyond 180 days",
    desc: "Audit (Standard) retains 180 days and the ceiling is not configurable. Audit (Premium) retains one year, with a ten-year add-on, and requires E5 or the Audit add-on licence.",
    risk: "This is a licence change with a real monthly cost, and it is not retroactive — nothing before the change is recoverable. The seats that need it should be chosen deliberately rather than tenant-wide.",
    reward: "Incident reconstruction stops depending on discovering the incident within six months, and the HIPAA six-year documentation requirement becomes reachable.",
    manual: [
      "Compare the Audit add-on cost against E5 for the 41 seats currently on the Compliance add-on.",
      "Assign the licence to the accounts whose activity matters most for reconstruction: all administrators, finance, and legal.",
      "In Purview, open Audit → Audit retention policies and create a one-year policy for those accounts.",
      "Set a second policy at ten years for administrator activity if the add-on is purchased.",
      "Record the change date. Everything before it stays at 180 days permanently.",
    ],
    graph: [
      "Reading current audit configuration and licence assignments",
      "Modelling the licence delta for 41 seats",
      "Assigning Audit Premium to administrator, finance, and legal accounts",
      "Creating a one-year audit retention policy for those accounts",
      "Verifying ingestion and retention state",
      "Recording the effective date in the evidence pack",
    ],
    result: "Audit retention extended to one year for administrator, finance, and legal accounts. Effective date recorded; prior records remain at 180 days.",
  },
  {
    key: "cmp-preservation-lock",
    title: "Apply Preservation Lock to the retention policy",
    desc: "Preservation Lock is the control Microsoft documents as meeting the non-rewritable, non-erasable requirement in SEC 17a-4(f). Right now six Global Administrators can delete or shorten your only retention policy.",
    risk: "This is permanent. Once locked, nobody — including Microsoft support — can turn the policy off, delete it, or shorten its period. Locations and labels can be added but never removed. Get the schedule right first; adaptive scopes do not support the lock, so the policy must use a static or non-adaptive scope.",
    reward: "Retention stops being a matter of administrator discretion and becomes a control you can demonstrate to a regulator.",
    manual: [
      "Have the retention schedule reviewed and signed off by whoever owns records — this is the gate, not a formality.",
      "Confirm the policy scope is correct and complete, because locations cannot be removed later.",
      "Confirm E5 or equivalent licensing for Preservation Lock.",
      'Connect to Security & Compliance PowerShell and run Set-RetentionCompliancePolicy -Identity "<policy>" -RestrictiveRetention $true.',
      "Confirm with Get-RetentionCompliancePolicy that RestrictiveRetention reads True, and file that output as evidence.",
    ],
    graph: [
      "Confirming the retention schedule has a recorded sign-off",
      "Verifying policy scope completeness and licence eligibility",
      "Applying RestrictiveRetention to the policy",
      "Reading back the policy state for the evidence pack",
      "Filing the confirmation output with a timestamp",
      "Triggering rescan",
    ],
    result: "Preservation Lock applied. RestrictiveRetention reads True and the confirmation output is filed in the evidence pack, timestamped.",
  },
  {
    key: "cmp-sensitivity-labels",
    title: "Publish the four sensitivity labels",
    desc: "Four labels exist in the label store and none is published, so no user has ever seen one. Every downstream control that references them currently matches nothing.",
    risk: "Users see a new labelling control in Office apps, which needs a short note explaining it. A mandatory-labelling requirement too early generates friction, so this runs staged.",
    reward: "Classification exists, DLP starts matching, and one of the three findings holding the Copilot gate closed is cleared.",
    manual: [
      "In Purview, open Information protection → Label policies and publish the four labels to all users.",
      "Set the default label to Internal, and leave mandatory labelling off for the first two weeks.",
      "Send the one-paragraph explanation to users before the policy takes effect.",
      "After two weeks, enable mandatory labelling and require a justification to downgrade.",
      "Confirm your DLP policies reference the published label GUIDs, not the draft ones.",
    ],
    graph: [
      "Reading the label store and existing label policies",
      "Publishing 4 labels to all users with Internal as the default",
      "Scheduling mandatory labelling for a two-week delay",
      "Re-pointing DLP rules at the published label identifiers",
      "Verifying label availability in Office and Copilot surfaces",
      "Triggering rescan",
    ],
    result: "4 labels published with Internal as the default. Mandatory labelling scheduled for two weeks out; DLP rules re-pointed at the published labels.",
  },
  {
    key: "cmp-disposition",
    title: "Name reviewers and clear the 1,940-item disposition backlog",
    desc: "Disposition review is enabled on the label but no reviewer is named, so 1,940 items have passed their retention period with nobody to approve their disposal. The backlog grew by 330 last quarter.",
    risk: "Disposition is irreversible once approved. Reviewers need enough context to decide, so the first cycle runs in batches with a legal check on anything touching an open matter.",
    reward: "Over-retention starts shrinking instead of growing, and each disposal produces a record with a reviewer, a date, and a reason — which is the evidence an auditor actually asks for.",
    manual: [
      "In Purview, open Records management → Disposition and confirm which labels have review enabled.",
      "Assign named reviewers per label — records owner for financial, legal for anything under hold.",
      "Work the backlog in batches of 200, oldest first.",
      "Cross-check every batch against active holds before approving.",
      "Export the disposition record for each approved batch and file it with the retention evidence.",
    ],
    graph: [
      "Reading disposition queue and label review configuration",
      "Assigning named reviewers per label",
      "Cross-checking the queue against active legal holds",
      "Presenting the first batch of 200 for review",
      "Exporting disposition records per approved batch",
      "Triggering rescan",
    ],
    result: "Reviewers assigned per label and the first batch of 200 processed. Disposition records exported; 1,740 items remain queued.",
  },
  {
    key: "cmp-stale-holds",
    title: "Prepare the release of two holds from a closed matter",
    desc: "Two In-Place Holds from matter LIT-2023-04 are still active on 6 mailboxes 26 months after the matter closed, preserving data that should have been disposed of and clouding your preservation posture in any future matter.",
    risk: "Releasing a hold that should still be in place is the one mistake you cannot undo here, which is why nothing is released without a signed authorisation from counsel.",
    reward: "Preservation reflects live obligations rather than accumulated history, and the six mailboxes come back under the normal retention schedule.",
    manual: [
      "Confirm with counsel in writing that matter LIT-2023-04 is closed and no successor matter relies on the hold.",
      "Export the current hold configuration and the affected mailbox list as a before-state record.",
      "Obtain a signed release authorisation naming the two holds.",
      "Remove the holds with Remove-CaseHoldPolicy and Remove-MailboxSearch, in that order.",
      "Confirm the 6 mailboxes are now governed only by the standard retention policy, and file the authorisation with the output.",
    ],
    graph: [
      "Reading hold configuration for matter LIT-2023-04",
      "Exporting the before-state record for 6 mailboxes",
      "Requesting signed release authorisation from counsel",
      "Removing the two holds once authorisation is on file",
      "Confirming standard retention now governs the 6 mailboxes",
      "Filing the authorisation with the removal output",
    ],
    result: "Release package prepared for counsel: before-state export, authorisation form, and the exact removal sequence. Nothing is removed until the signature is on file.",
  },
];

/**
 * The prototype's `complianceFixLibrary` build (12256-12274), including the two
 * wrapper steps and the absent `sopRef` — which `fixPanelData` substitutes, so
 * no SOP number is invented here either.
 */
export const CMP_FIX_PLAYBOOKS: Readonly<Record<string, FixPlaybook>> = Object.fromEntries(
  CMP_FIXES.map((f) => [
    f.key,
    {
      key: f.key,
      title: f.title,
      pillarColor: COMPLIANCE,
      description: f.desc,
      canAutomate: true,
      sopRef: "Written procedure attached from the SOP library",
      riskText: f.risk,
      rewardText: f.reward,
      manualSteps: [
        { text: PURVIEW_SIGN_IN, link: "https://purview.microsoft.com" },
        ...f.manual.map((text) => ({ text })),
        { text: RESCAN_AND_EXPORT },
      ],
      graphSteps: f.graph,
      resultSummary: f.result,
    } satisfies FixPlaybook,
  ]),
);
