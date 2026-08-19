/**
 * licFixPlaybooks.ts — the thirteen Licensing remediation playbooks.
 *
 * Transcribed from `LIC_FIXES` (`Customer Portal Shell.dc.html` 12515-12580) and
 * assembled through the prototype's own mapper (12582-12599).
 *
 * ── The wrapper here is NOT the same as Compliance's ───────────────────────
 * Both pillars wrap every playbook with a leading and a trailing step, and the
 * text differs on both ends. Licensing's opener draws the line the whole pillar
 * turns on — licence ASSIGNMENT changes run through Graph or the admin centre,
 * but QUANTITY and SUBSCRIPTION changes are commerce actions that run through
 * Billing or a partner. Its closer says the recovered amount lands on the
 * savings ledger with a date and an authoriser, where Compliance's says export
 * the evidence pack. Sharing one wrapper between the two would put the wrong
 * sentence on eleven playbooks.
 *
 * ── Thirteen, not six ──────────────────────────────────────────────────────
 * Six back the recovery items; the other seven back the "Why the waste recurs"
 * policy rows, every one of which carries a wrench. That is the pillar's own
 * argument made structural: recovering the money once is a fix, and stopping it
 * recurring is a different fix.
 */

import type { FixPlaybook } from "./fixPanelLibrary";
import { LIC_HERO, LIC_TEAL } from "./licDashboardData";

/** The two steps the mapper adds around every fix's own `manual` list. */
const COMMERCE_VS_GRAPH =
  "Licence assignment changes run through Graph or the admin centre; quantity and subscription changes are commerce actions and run through Billing or your partner. The steps say which is which.";
const RESCAN_AND_LEDGER =
  "Come back to this screen and click Re-scan. The recovered amount is added to the savings ledger with the date and who authorised it.";

interface LicFixSpec {
  key: string;
  title: string;
  desc: string;
  risk: string;
  reward: string;
  manual: string[];
  graph: string[];
  result: string;
}

const LIC_FIXES: readonly LicFixSpec[] = [
  {
    key: "lic-e5-unassigned",
    title: "Lodge a renewal reduction for 26 unassigned E5 seats",
    desc: `38 E5 seats are purchased and assigned to nobody, of which 12 are deliberately held for Q3 hiring. The other 26 are $1,560 a month, $18,720 a year, and the reduction can only be lodged before the annual renewal on ${LIC_HERO.renewal}.`,
    risk: "Reducing committed quantity is not reversible mid-term. If hiring accelerates beyond the approved plan, additional seats bought later cost more than the committed rate.",
    reward: "$18,720 a year out of the next commitment, with the 12 planned-headcount seats untouched.",
    manual: [
      "Reconcile the unassigned count against the approved hiring plan so the number you lodge survives scrutiny.",
      "Confirm the 12 acknowledged seats stay in the commitment.",
      "In the Microsoft 365 admin centre, open Billing → Your products → the E5 subscription, and reduce the quantity effective at renewal.",
      "Where the agreement runs through a partner or EA, the reduction goes through them — lodge it in writing with the renewal date referenced.",
      "Add the renewal date to the finance calendar with a 60-day reminder so this does not repeat.",
    ],
    graph: [
      "Reading subscribedSkus for prepaid versus consumed units",
      "Reconciling unassigned seats against the approved hiring plan",
      "Excluding the 12 acknowledged-spend seats",
      "Preparing the renewal reduction request with figures and dates",
      "Adding a 60-day pre-renewal reminder to the finance calendar",
      "Filing the request with the licence evidence pack",
    ],
    result: "Renewal reduction prepared for 26 seats worth $18,720 a year, with the 12 planned-headcount seats retained and a 60-day pre-renewal reminder set.",
  },
  {
    key: "lic-copilot-reassign",
    title: "Reassign 27 idle Copilot seats to the waiting list",
    desc: "27 of 68 assigned Copilot seats show no activity in 30 days while 34 people have open requests. This changes nothing on the invoice and converts $810 a month of committed spend into capability someone asked for.",
    risk: "Reclaiming a seat from someone who was about to start using it generates a bad first impression of the programme. The 7-day keep-or-release note exists to avoid that.",
    reward: "$810 a month of already-committed spend starts producing something, and the waiting list clears without a purchase.",
    manual: [
      "Pull 30-day Copilot activity per assigned user.",
      "Email the 27 idle holders a keep-or-release note with a 7-day window and a one-line explanation.",
      "Reclaim the seats nobody keeps and assign them from the waiting list, oldest request first.",
      "Set a 30-day idle-then-reclaim rule so the next round happens without anyone chasing it.",
      "Report utilisation before and after to the CIO — this is the number the programme is judged on.",
    ],
    graph: [
      "Reading 30-day Copilot activity for 68 assigned users",
      "Sending keep-or-release notices to 27 idle holders",
      "Reclaiming unclaimed seats after the 7-day window",
      "Assigning seats from the waiting list, oldest first",
      "Creating the 30-day idle-reclaim rule",
      "Reporting utilisation before and after",
    ],
    result: "27 idle seats surfaced: 19 released and reassigned from the waiting list, 8 retained by their holders. Copilot utilisation moves from 60% to 88%.",
  },
  {
    key: "lic-disabled-accounts",
    title: "Reclaim 11 E5 seats from disabled accounts",
    desc: "11 disabled accounts still hold an E5 licence — $660 a month of consumed seats. Four need their mailbox preserved, so mailbox handling runs before licence removal.",
    risk: "Removing a licence from a mailbox with no hold and no shared conversion deletes that mailbox 30 days later. That is the one irreversible step here, which is why 4 of the 11 are handled differently.",
    reward: "11 seats become available for the waiting list immediately, and the billed quantity reduces at renewal.",
    manual: [
      "List disabled accounts holding licences, with mailbox size and hold state per account.",
      "For the 4 that need preservation: convert to a shared mailbox, or apply an inactive-mailbox hold before touching the licence.",
      "Remove licence assignments from all 11 through Graph or the group that assigns them.",
      "Assign the freed seats from the waiting list.",
      "Add licence removal to the offboarding runbook so the next 11 do not accumulate.",
    ],
    graph: [
      "Listing disabled accounts with assigned licences",
      "Reading mailbox size and hold state per account",
      "Converting 4 mailboxes to shared or applying inactive holds",
      "Removing 11 licence assignments",
      "Assigning freed seats from the waiting list",
      "Updating the offboarding runbook",
    ],
    result: "11 seats reclaimed with 4 mailboxes preserved as shared. Seats reassigned from the waiting list; offboarding runbook updated.",
  },
  {
    key: "lic-powerbi-duplicate",
    title: "Cancel the duplicate Power BI Pro subscription",
    desc: "All 12 standalone Power BI Pro holders already have Power BI Pro through E5. The standalone subscription is monthly, so cancelling reaches the next invoice: $168 a month, $2,016 a year.",
    risk: "Very low. The only failure mode is a workspace pinned to the standalone tenant assignment, which is verified per user before cancellation.",
    reward: "$2,016 a year off the next invoice, and one fewer subscription to reconcile.",
    manual: [
      "Verify per user that SPE_E5 includes the POWER_BI_PRO service plan and that it is enabled, not disabled, on their assignment.",
      "Confirm no workspace or capacity is tied to the standalone assignment.",
      "Remove the standalone licence from all 12 users.",
      "Cancel the subscription in Billing → Your products so the seats stop billing.",
      "Turn off self-service purchase for Power BI, or the same 12 seats reappear next quarter.",
    ],
    graph: [
      "Comparing service plans between E5 and the standalone SKU per user",
      "Verifying workspace dependencies",
      "Removing 12 standalone assignments",
      "Cancelling the subscription in commerce",
      "Disabling self-service purchase for Power BI",
      "Verifying the next invoice preview",
    ],
    result: "Duplicate subscription cancelled for all 12 users, $2,016 a year removed from the next invoice, and self-service purchase disabled for Power BI.",
  },
  {
    key: "lic-addons-idle",
    title: "Remove idle Visio and superseded Defender P1 seats",
    desc: "9 Visio seats (3 unassigned, 6 with no launch in 90 days) and 36 Defender for Office P1 seats superseded by E5. Both monthly-billed: $207 a month, $2,484 a year.",
    risk: "Two of the six idle Visio users are architects who work in bursts. Removing their seat during a quiet fortnight looks like a cost saving and reads to them as a tool being taken away — hence the keep-or-release note rather than a silent removal.",
    reward: "$2,484 a year off the next invoice with no loss of capability, since Defender P1 is already covered by E5.",
    manual: [
      "Confirm the Defender P1 entitlement inside E5 is enabled for all 36 holders, then remove the standalone add-on.",
      "Send the 6 idle Visio holders a 7-day keep-or-release note that names the release date.",
      "Remove the 3 unassigned Visio seats immediately — nobody to ask.",
      "Reduce both subscription quantities in commerce so the seats stop billing.",
      "Recheck Visio launches in 30 days to catch anyone who was genuinely mid-cycle.",
    ],
    graph: [
      "Verifying Defender entitlement coverage inside E5 for 36 users",
      "Removing 36 superseded add-on assignments",
      "Sending keep-or-release notes to 6 idle Visio holders",
      "Removing 3 unassigned Visio seats",
      "Reducing subscription quantities in commerce",
      "Scheduling a 30-day Visio recheck",
    ],
    result: "Defender P1 removed for all 36 users and Visio reduced by 7 seats after the notice window. $2,232 a year removed; 2 architects kept their seats.",
  },
  {
    key: "lic-shared-mailboxes",
    title: "Remove licences from 6 shared mailboxes that do not need one",
    desc: "Six shared mailboxes between 2 and 18 GB carry an Exchange Online Plan 1 licence. A shared mailbox needs no licence below 50 GB and without a litigation hold. $24 a month, $288 a year.",
    risk: "A shared mailbox on litigation hold or over 50 GB does need a licence. Both conditions are checked per mailbox rather than assumed, and one of the eight seats is legitimately retained.",
    reward: "$288 a year, and a licence position that stands up in an audit line by line.",
    manual: [
      "Confirm size under 50 GB and LitigationHoldEnabled false for each of the 6.",
      "Remove the licence assignment from each mailbox account.",
      "Confirm mail flow and delegate access still work — removing a licence from a shared mailbox does not affect either, but confirm rather than assert.",
      "Reduce the EXCHANGESTANDARD quantity to 2 in commerce.",
      "Note the archive-only exception so the remaining seats are explainable.",
    ],
    graph: [
      "Reading size and hold state for 8 licensed shared mailboxes",
      "Confirming 6 are eligible for licence removal",
      "Removing 6 licence assignments",
      "Verifying mail flow and delegate access",
      "Reducing the subscription quantity to 2",
      "Recording the retained exception",
    ],
    result: "6 licences removed with mail flow and delegate access verified, quantity reduced to 2, and the archive-only exception recorded.",
  },
  {
    key: "lic-self-service",
    title: "Turn off self-service purchase",
    desc: "Users can buy Power BI, Visio and Project licences on a card. That is how 12 duplicate Power BI Pro seats appeared, and it means spend arrives outside procurement with no cost-centre attribution.",
    risk: "People who bought their own tool will need to request it. Without a fast request route this reads as IT taking something away, so publish the route first.",
    reward: "Licence spend goes back through one door, with attribution and without duplicate purchases.",
    manual: [
      "Install the MSCommerce module and read current policy: Get-MSCommerceProductPolicies -PolicyId AllowSelfServicePurchase.",
      "Set AllowSelfServicePurchase to Disabled per product ID for Power BI, Visio and Project.",
      "Publish the request route with a one-working-day turnaround.",
      "Reconcile existing self-service subscriptions into the central agreement where they are still needed.",
      "Recheck the policy quarterly — Microsoft adds new products to self-service over time.",
    ],
    graph: [
      "Reading self-service purchase policy per product",
      "Disabling self-service purchase for 3 products",
      "Publishing the licence request route",
      "Reconciling existing self-service subscriptions",
      "Verifying policy state",
      "Scheduling a quarterly policy recheck",
    ],
    result: "Self-service purchase disabled for Power BI, Visio and Project. 2 existing self-service subscriptions reconciled into the central agreement.",
  },
  {
    key: "lic-offboarding",
    title: "Add licence reclamation to the offboarding runbook",
    desc: "Nothing in offboarding removes licences, which is why 11 disabled accounts hold $660 a month of E5 seats. This is the fix that stops the number coming back.",
    risk: "The step needs mailbox handling built into it, or an over-eager reclamation deletes a mailbox someone needed. The runbook step includes the hold-and-convert check for that reason.",
    reward: "Seats return to the pool within a day of a departure instead of within a year of a scan.",
    manual: [
      "Add a step: check mailbox size and hold state, convert to shared or apply an inactive hold where required.",
      "Add a step: remove licence assignments and return seats to the pool.",
      "Add a post-check: no disabled account holds a licence more than 7 days after the leave date.",
      "Wire both into the leaver ticket template so they cannot be skipped.",
      "Backfill against the last 12 months of leavers.",
    ],
    graph: [
      "Adding mailbox handling and licence removal steps to the runbook",
      "Adding the 7-day post-check",
      "Wiring the steps into the leaver ticket template",
      "Backfilling against 12 months of leavers",
      "Reporting backfill findings",
      "Scheduling the first monthly post-check report",
    ],
    result: "Offboarding runbook updated with mailbox handling, licence removal, and a 7-day post-check. Backfill found the 11 accounts already in the queue above.",
  },
  {
    key: "lic-group-licensing",
    title: "Move licence assignment to groups",
    desc: "Only 41 of 240 E5 assignments come from a group. Direct assignment is why reclamation is manual, why seats drift, and why the 4 assignment errors went unnoticed.",
    risk: "Migrating assignment method can briefly double-assign or, done carelessly, remove a licence and its service plans from a user mid-day. Run it in waves with verification between each.",
    reward: "Joiners and leavers become automatic, and licence position follows the directory instead of being maintained by hand.",
    manual: [
      "Create licence groups per SKU and per service-plan variation you genuinely need.",
      "Assign licences to the groups and add users in waves of 50, verifying after each wave.",
      "Remove direct assignments only after the group assignment shows as applied for that user.",
      "Watch licenseAssignmentStates for errors during each wave.",
      "Document which group grants what, so the next administrator does not undo it.",
    ],
    graph: [
      "Creating licence groups per SKU",
      "Assigning licences at group level",
      "Migrating users in waves of 50 with verification",
      "Removing direct assignments after confirmation",
      "Monitoring licenseAssignmentStates for errors",
      "Documenting the group-to-SKU mapping",
    ],
    result: "Group-based licensing live for E5 and Copilot with 202 users migrated in 5 waves. Direct assignments removed after per-user verification.",
  },
  {
    key: "lic-idle-rule",
    title: "Create an idle-seat reclamation rule",
    desc: "No SKU has a reclamation rule. Copilot at $30 a seat is where this matters most: 30 days of inactivity should trigger a keep-or-release notice automatically rather than waiting for a quarterly review.",
    risk: "An automatic rule with too short a window annoys people who were on leave. Thirty days plus a 7-day notice handles annual leave; two weeks would not.",
    reward: "Utilisation holds above 90% without anyone policing it, and the waiting list stops existing.",
    manual: [
      "Set the thresholds per SKU: 30 days for Copilot, 60 for Visio and Project, 90 for E5 downgrades.",
      "Configure the notice to go to the holder with a 7-day keep-or-release window and a clear reason.",
      "Exclude accounts on approved leave from the rule.",
      "Route reclaimed seats to the waiting list automatically, oldest request first.",
      "Report monthly on seats reclaimed and reassigned so the rule earns its place.",
    ],
    graph: [
      "Configuring idle thresholds per SKU",
      "Setting up keep-or-release notices with a 7-day window",
      "Excluding approved-leave accounts",
      "Wiring reclaimed seats to the waiting list",
      "Enabling the monthly reclamation report",
      "Running the first cycle in report-only mode",
    ],
    result: "Idle-seat rule configured per SKU with leave exclusions, running in report-only mode for one cycle before it starts reclaiming.",
  },
  {
    key: "lic-assignment-errors",
    title: "Clear 4 failing licence assignments",
    desc: "3 users have a CountViolation and 1 a DependencyViolation, which means those assignments never applied. Those people are unlicensed in practice while the seats look consumed.",
    risk: "None. These are already broken; fixing them is strictly an improvement.",
    reward: "Four people get the licence they are supposed to have, and the consumed-seat count starts telling the truth.",
    manual: [
      "Read licenseAssignmentStates for every user and filter to entries with an error value.",
      "For CountViolation, free seats first — the reclamation items above provide them.",
      "For DependencyViolation, enable the prerequisite service plan or assign the base SKU it depends on.",
      "Re-apply the assignment and confirm the state clears.",
      "Add an assignment-error check to the monthly licence report.",
    ],
    graph: [
      "Reading licenseAssignmentStates across all users",
      "Classifying the 4 errors by type",
      "Freeing seats to resolve CountViolations",
      "Resolving the DependencyViolation prerequisite",
      "Re-applying and verifying the assignments",
      "Adding an error check to the monthly report",
    ],
    result: "All 4 failing assignments resolved and verified. Assignment-error monitoring added to the monthly licence report.",
  },
  {
    key: "lic-renewal-calendar",
    title: "Put the renewal reduction deadline on the finance calendar",
    desc: `The annual E5 commitment renews on ${LIC_HERO.renewal}. Quantity reductions must be lodged before then, and nothing currently reminds anyone — which is how 38 unassigned seats renewed once already.`,
    risk: "None. It is a calendar entry with an owner.",
    reward: "The largest single recovery on this page stops depending on somebody remembering.",
    manual: [
      "Add the renewal date to the finance calendar with 90, 60 and 30-day reminders.",
      "Name the owner: the Controller, with IT as the data provider.",
      "Attach a standing agenda item — unassigned seats, idle seats, and headcount plan — to the 60-day reminder.",
      "Repeat for every subscription with an annual term, not just E5.",
    ],
    graph: [
      "Reading subscription terms and renewal dates from commerce",
      "Creating calendar entries with 90, 60 and 30-day reminders",
      "Assigning the Controller as owner with IT as data provider",
      "Attaching the standing agenda item",
      "Extending the pattern to all annual subscriptions",
      "Confirming the first reminder is scheduled",
    ],
    result: "Renewal reminders set at 90, 60 and 30 days for all 3 annual subscriptions, owned by the Controller with a standing agenda item attached.",
  },
  {
    key: "lic-cost-centre",
    title: "Attribute licence spend to cost centres",
    desc: "Assignments carry no department or cost-centre attribution, so licence spend cannot be split for the finance review — which is the first thing asked when a recovery is proposed.",
    risk: "None technically. It needs the department field to be accurate in the directory, and in places it is not.",
    reward: "Every figure on this page can be split by cost centre, which is what turns a licence report into a finance conversation.",
    manual: [
      "Audit the department and company name fields in the directory for accuracy.",
      "Map department to cost centre with finance, once, and keep it in one place.",
      "Extend the licence report to group spend by cost centre.",
      "Reconcile the total against the invoice so the attribution is provably complete.",
      "Publish the split monthly with the recovery pipeline alongside it.",
    ],
    graph: [
      "Auditing directory department attribution for 1,240 users",
      "Applying the finance department-to-cost-centre mapping",
      "Extending the licence report with cost-centre grouping",
      "Reconciling attributed spend against the invoice total",
      "Publishing the monthly split",
      "Flagging 31 users with missing attribution",
    ],
    result: "Licence spend now attributed by cost centre and reconciled to the invoice, with 31 users flagged for missing department data.",
  },
];

/** The prototype's `licFixLibrary` build (12582-12599), wrapper included. */
export const LIC_FIX_PLAYBOOKS: Readonly<Record<string, FixPlaybook>> = Object.fromEntries(
  LIC_FIXES.map((f) => [
    f.key,
    {
      key: f.key,
      title: f.title,
      pillarColor: LIC_TEAL,
      description: f.desc,
      canAutomate: true,
      sopRef: "Written procedure attached from the SOP library",
      riskText: f.risk,
      rewardText: f.reward,
      manualSteps: [
        { text: COMMERCE_VS_GRAPH, link: "https://admin.microsoft.com/#/subscriptions" },
        ...f.manual.map((text) => ({ text })),
        { text: RESCAN_AND_LEDGER },
      ],
      graphSteps: f.graph,
      resultSummary: f.result,
    } satisfies FixPlaybook,
  ]),
);
