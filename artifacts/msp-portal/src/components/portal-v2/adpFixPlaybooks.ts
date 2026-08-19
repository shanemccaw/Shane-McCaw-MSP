/**
 * adpFixPlaybooks.ts — the eleven Adoption playbooks.
 *
 * Transcribed from `ADP_FIXES` (`Customer Portal Shell.dc.html` 12865-12921) and
 * assembled through the prototype's own mapper (12922-12940).
 *
 * ── This mapper BRANCHES, where Compliance's and Licensing's do not ────────
 * Both of those wrap every playbook with the same two steps. Adoption's first
 * step depends on `canAutomate`:
 *
 *   can: true  → "This one has a real technical enabler behind it, so it can be
 *                 staged for you or run by your team from the steps below."
 *   can: false → "This is a people play, not a write action — there is no switch
 *                 to throw. The steps below are the play itself, and we can run
 *                 it with you or hand it over."
 *
 * And `canAutomate` is passed straight through to the panel, so the four people
 * plays do NOT offer the Graph route at all. This is the only pillar where a
 * fix legitimately has nothing to automate, and flattening it to `true` would
 * put an "Automate via Microsoft Graph" button on a training session.
 *
 * Its closing step is different again: adoption is reviewed on a monthly rhythm
 * rather than confirmed by a re-scan, so the closer says so instead of asking
 * for one.
 *
 * ── Eleven keys for twelve references ──────────────────────────────────────
 * Six back the plays (`adp-adp-01` … `adp-adp-06`, from `'adp-' + id.toLowerCase()`)
 * and six back the enablers — but the "Copilot prerequisites" enabler points at
 * `adp-adp-02`, the OneDrive play, because the prerequisite IS that rollout.
 * That reuse is the prototype's, not a transcription slip.
 */

import type { FixPlaybook } from "./fixPanelLibrary";
import { ADP_ORANGE } from "./adpDashboardData";

const ENABLER_STEP =
  "This one has a real technical enabler behind it, so it can be staged for you or run by your team from the steps below.";
const PEOPLE_PLAY_STEP =
  "This is a people play, not a write action — there is no switch to throw. The steps below are the play itself, and we can run it with you or hand it over.";
const MONTHLY_RHYTHM_STEP =
  "Adoption moves on a monthly rhythm, not on a re-scan. The next scan picks up the numbers; the play is reviewed at the date in the plan.";

interface AdpFixSpec {
  key: string;
  title: string;
  desc: string;
  can: boolean;
  risk: string;
  reward: string;
  manual: string[];
  graph: string[];
  result: string;
}

const ADP_FIXES: readonly AdpFixSpec[] = [
  {
    key: "adp-adp-01",
    title: "Copilot enablement play",
    desc: "Two 45-minute sessions per department with a prompt card for the three tasks that department actually does, lowest-usage departments first. No technical change — the licences and features are already in place.",
    can: false,
    risk: "The honest risk is that a session gets scheduled, half the department misses it, and the recording never gets watched. Champions hosting rather than IT announcing is what prevents that, which is why the champions play runs alongside this one.",
    reward: "27 idle seats start producing something, and Finance and Operations move from 12% to a target of 50% weekly active.",
    manual: [
      "Confirm department order from the usage report: Operations and Finance first, Legal last.",
      "Name one champion per department to host the session and answer questions in-channel afterwards.",
      "Run session one: the three tasks that department repeats most, live, in their own documents.",
      "Publish the prompt card and the recording in that department’s channel, not by email.",
      "Run session two a fortnight later using questions collected from the channel.",
      "Review weekly active users per department at week 6 and repeat where it has not moved.",
    ],
    graph: [
      "Reading 30-day Copilot usage by user and surface",
      "Ranking departments by usage gap and document volume",
      "Building the per-department task list from real file activity",
      "Scheduling sessions with named champions as hosts",
      "Publishing prompt cards to department channels",
      "Reporting weekly active users by department at week 6",
    ],
    result: "Enablement plan built for 6 departments with named champions and per-department prompt cards. First two sessions scheduled for Operations and Finance.",
  },
  {
    key: "adp-adp-02",
    title: "Stage the Known Folder Move profile",
    desc: "An Intune configuration profile that silently moves Desktop, Documents and Pictures into OneDrive, signs in with the work account, and blocks personal-account sync. Pilot on 20 devices, then the remaining 64.",
    can: true,
    risk: "Six devices hold large local archives, and a first sync during working hours would saturate their upload for a morning. Those six are staged out of hours. Beyond that, users generally do not notice this happening.",
    reward: "84 devices stop keeping work only on local disks, and the largest blind spot in Copilot grounding closes without asking anyone to change how they work.",
    manual: [
      "Create the OneDrive configuration profile in Intune with silent KFM, silent account configuration, and personal-account sync blocked.",
      "Assign to a pilot ring of 20 devices and confirm KFM reports enabled within 24 hours.",
      "Identify the 6 devices with local archives over 20 GB and schedule their first sync out of hours.",
      "Assign to the remaining 64 devices.",
      "Confirm first-sync completion per user, and follow up on any device that has not reported in 7 days.",
    ],
    graph: [
      "Reading existing device configuration profiles and assignments",
      "Creating the silent Known Folder Move profile",
      "Assigning to a 20-device pilot ring",
      "Identifying large local archives for out-of-hours staging",
      "Rolling out to the remaining 64 devices",
      "Verifying first-sync completion per user",
    ],
    result: "KFM profile staged and piloted on 20 devices with 100% enablement. Remaining 64 scheduled, with 6 large-archive devices set to sync out of hours.",
  },
  {
    key: "adp-adp-03",
    title: "Channel-first play",
    desc: "Move two real workflows per department into channels with a named owner, instead of asking people to use channels more. Finance and Legal get a lower target by design.",
    can: false,
    risk: "Behaviour plays fail when they are announced rather than led. This one only works if champions pick workflows people already find annoying — an imposed workflow gets abandoned in a fortnight.",
    reward: "Institutional memory becomes searchable, new joiners stop needing three conversations for context, and Copilot can finally see how the work actually happens.",
    manual: [
      "With each champion, pick two workflows that currently live in chat and cause repeated questions.",
      "Create or reuse a channel per workflow with a named owner and a pinned one-paragraph purpose.",
      "Run the first instance of each workflow in-channel with the champion present.",
      "Leave the chat threads alone — do not migrate history, just start new work in the right place.",
      "Review channel message share per department monthly, with a lower target for Finance and Legal.",
    ],
    graph: [
      "Reading channel versus chat message share per department",
      "Identifying repeated question patterns from chat volume",
      "Setting up workflow channels with named owners",
      "Running the first in-channel instance per workflow",
      "Reporting channel share monthly by department",
      "Adjusting targets for departments with legitimate privacy needs",
    ],
    result: "12 workflows identified across 6 departments with owners named. First instances scheduled; Finance and Legal targets set lower deliberately.",
  },
  {
    key: "adp-adp-04",
    title: "Scope the Teams Phone rollout — or release the licences",
    desc: "41 licensed seats have never been provisioned. This scopes the rollout properly, and costs the alternative honestly: releasing the licences is $3,936 a year back.",
    can: false,
    risk: "Number porting is the long pole and it is outside anyone’s control once lodged. Nothing else should depend on the cutover date. If calling is not actually wanted, scoping it is wasted effort — which is why the release option is presented alongside, not after.",
    reward: "Either 41 people get calling on the device they already use, with call history and recording where the rest of your records live, or $3,936 a year goes back.",
    manual: [
      "Decide first, with Sales and Operations, whether calling is wanted at all. Everything after this is conditional on that answer.",
      "If yes: lodge the porting request early, since release dates drive the whole plan.",
      "Configure calling policies, emergency addresses per site, and voicemail defaults.",
      "Pilot with 8 people in Sales for two weeks before the wider cutover.",
      "If no: move the 41 licences to the Licensing recovery list and lodge the reduction before the renewal date.",
    ],
    graph: [
      "Reading Teams Phone licence assignment and provisioning state",
      "Preparing the calling policy and emergency address configuration",
      "Producing the porting request pack",
      "Costing the release-the-licences alternative",
      "Presenting both options with dates and figures",
      "Recording the decision either way",
    ],
    result: "Both options costed and presented: rollout scoped at 10 weeks with porting dependencies, or $3,936 a year recovered. Awaiting the decision from Sales and Operations.",
  },
  {
    key: "adp-adp-05",
    title: "Build the first three Power BI reports",
    desc: "Build the finance pack, the operations dashboard and the sales pipeline with the people who currently make them by hand. Not a training course — three real reports.",
    can: false,
    risk: "Reports built by a consultant and handed over get abandoned. The sequence is deliberate: we build the first, co-build the second, and watch the third — if the third one is not built by your team, the play has not worked.",
    reward: "Three recurring manual reports become automatic, the duplicate Power BI subscription reason disappears, and the E5 entitlement starts earning.",
    manual: [
      "Confirm workspace ownership and licensing model first, so reports are not owned by one person’s account.",
      "Sit with the person who currently produces the finance pack and rebuild it in Power BI as-is — do not improve it yet.",
      "Publish to a shared workspace with the finance team as viewers.",
      "Co-build the operations dashboard with their analyst leading.",
      "Watch them build the sales pipeline report, and only answer questions.",
      "Measure hours saved on the three reports at month 3.",
    ],
    graph: [
      "Confirming Power BI workspace ownership and licensing",
      "Rebuilding the finance pack as-is in Power BI",
      "Publishing to a shared workspace with viewer access",
      "Co-building the operations dashboard",
      "Handing the third report to your analyst",
      "Measuring hours saved at month 3",
    ],
    result: "Workspace ownership confirmed and the finance pack rebuilt and published. Operations dashboard co-build scheduled; third report assigned to your analyst.",
  },
  {
    key: "adp-adp-06",
    title: "Stage auto-recording for internal recurring meetings",
    desc: "A Teams meeting policy change that turns on auto-recording for internal recurring meetings, with HR and Legal excluded by policy scope rather than by asking people to remember.",
    can: true,
    risk: "Recording by default changes how some people speak in meetings. The exclusion scope and a plainly worded note about how to turn it off for a given meeting are what make this land well rather than badly.",
    reward: "Recap and follow-up actions — the Copilot features people actually like — start working on meetings that would otherwise have left no trace.",
    manual: [
      "Create a meeting policy with AutoRecording enabled, scoped to internal recurring meetings.",
      "Exclude HR and Legal by assigning them a policy without auto-recording.",
      "Write the note yourself, in your own voice: what is recorded, why, how to turn it off, and where recordings live.",
      "Send the note a week before the policy applies.",
      "Review recording share and recap usage at week 6.",
    ],
    graph: [
      "Reading current Teams meeting policies and assignments",
      "Creating an auto-recording policy for internal recurring meetings",
      "Assigning an exclusion policy to HR and Legal",
      "Scheduling the policy change a week after the comms note",
      "Applying the policy",
      "Reporting recording share and recap usage at week 6",
    ],
    result: "Auto-recording policy staged with HR and Legal excluded, scheduled to apply a week after your comms note goes out.",
  },
  {
    key: "adp-champions",
    title: "Extend the champions network to every department",
    desc: "6 champions cover 3 departments. Finance, Operations and Legal have none — and those three are the bottom three on every adoption measure on this page. That correlation is not a coincidence.",
    can: false,
    risk: "A champion volunteered by their manager rather than by themselves becomes an extra task they resent. Ask for volunteers, and give them something real: early access, a direct line to us, and visible credit.",
    reward: "Every play on this page lands better with a champion in the room. This is the enabler that multiplies the other five.",
    manual: [
      "Ask each department head for a volunteer rather than a nomination.",
      "Give champions a private channel with us in it, 30 minutes a fortnight, and early access to anything new.",
      "Give them the monthly adoption pack for their own department so they can see their own numbers.",
      "Name them publicly so people know who to ask.",
      "Review the network quarterly — champions move on and the role should be easy to hand over.",
    ],
    graph: [
      "Mapping current champions against adoption by department",
      "Requesting volunteers from the 3 uncovered departments",
      "Setting up the champions channel and fortnightly cadence",
      "Wiring per-department adoption packs to each champion",
      "Publishing the champion list",
      "Scheduling the quarterly review",
    ],
    result: "Volunteer requests sent to Finance, Operations and Legal, with the champions channel and fortnightly cadence in place for the existing 6.",
  },
  {
    key: "adp-training-plan",
    title: "Put a standing training cadence in place",
    desc: "No sessions have run in six months, and the Copilot pilot opened with no enablement at all. A standing monthly slot beats a one-off campaign every time.",
    can: false,
    risk: "A recurring session with nothing new to say empties out within three months. Content is driven by what the usage reports show, not by a curriculum, so there is always a reason to attend.",
    reward: "Adoption stops depending on rollout moments and starts compounding.",
    manual: [
      "Book a standing 30-minute monthly slot, same time each month.",
      "Pick each month’s topic from the previous month’s usage report — the biggest gap wins.",
      "Record every session and keep them in one place people can find.",
      "Keep a running list of questions from the channel and answer them live rather than presenting slides.",
      "Review attendance and usage impact quarterly, and stop it if it is not moving anything.",
    ],
    graph: [
      "Establishing the monthly training slot and calendar entries",
      "Deriving the first three topics from usage gaps",
      "Setting up the session library location",
      "Wiring the question channel into session planning",
      "Recording attendance against usage change",
      "Scheduling the quarterly effectiveness review",
    ],
    result: "Monthly cadence booked with the first three topics derived from usage gaps, and a session library set up where people can actually find it.",
  },
  {
    key: "adp-comms-channel",
    title: "Create a standing channel for feature announcements",
    desc: "Changes currently arrive unannounced. One channel where features, changes and short how-tos land means the next rollout does not start by spending goodwill.",
    can: false,
    risk: "A channel nobody reads is worse than nothing. Post rarely, post useful, and never use it for anything other than what it says on the tin.",
    reward: "Every subsequent play has somewhere to launch from, and people stop discovering changes by being surprised by them.",
    manual: [
      "Create the channel in the All Company team with a pinned purpose statement.",
      "Agree the rule: only changes that affect how people work, no more than one post a week.",
      "Post the next real change through it rather than by email.",
      'Include a one-line "what this means for you" in every post — that is the part people read.',
      "Review readership at month 3 and adjust frequency down, not up, if engagement drops.",
    ],
    graph: [
      "Creating the announcements channel with a pinned purpose",
      "Setting the posting cadence and content rule",
      "Publishing the next change through the channel",
      "Measuring readership per post",
      "Reviewing engagement at month 3",
      "Adjusting cadence based on readership",
    ],
    result: "Announcements channel created in the All Company team with a posting rule and the next change queued to launch through it.",
  },
  {
    key: "adp-monthly-pack",
    title: "Automate a monthly adoption pack per department",
    desc: "Usage reports get pulled manually when someone asks, which means nobody sees their own numbers. A monthly pack per department puts the data in front of the people who can move it.",
    can: true,
    risk: "Per-department numbers can read as a league table if they are presented that way. Frame each pack against that department’s own last month, not against other departments.",
    reward: "Progress becomes visible to the people responsible for it, which is most of what drives it.",
    manual: [
      "Define the four metrics per department: channel share, OneDrive sync, Copilot weekly active, mobile configured.",
      "Automate the pull from the usage reports on the first of each month.",
      "Send each pack to the department head and their champion, showing their own trend rather than a ranking.",
      "Include one suggested action per pack, not a list.",
      "Review at month 3 whether the packs are being opened — if not, change the format rather than the frequency.",
    ],
    graph: [
      "Defining the four per-department adoption metrics",
      "Automating the monthly usage report pull",
      "Generating per-department packs with own-trend framing",
      "Distributing to department heads and champions",
      "Tracking pack open rates",
      "Reviewing format effectiveness at month 3",
    ],
    result: "Monthly pack automated for 6 departments with own-trend framing and one suggested action each. First send scheduled for the 1st.",
  },
  {
    key: "adp-report-transparency",
    title: "Publish a short note on how usage data is used",
    desc: "Usage reports show real names, which is what makes per-department targeting possible. Saying so plainly, before anyone asks, is the difference between a coaching programme and surveillance.",
    can: false,
    risk: "None, other than the conversation it might start — which is a conversation worth having on your terms rather than after a rumour.",
    reward: "The adoption programme keeps the goodwill it needs, and nobody discovers the reporting by accident.",
    manual: [
      "Write a short note: what is measured, what it is used for, what it is never used for, and who can see it.",
      "Confirm the position with HR before publishing.",
      "Publish in the announcements channel and link it from the monthly packs.",
      "Keep the option to switch reports to anonymised names, and say what would trigger that.",
    ],
    graph: [
      "Reading the current report anonymisation setting",
      "Drafting the transparency note with HR review",
      "Publishing to the announcements channel",
      "Linking the note from the monthly packs",
      "Recording the position in the adoption programme record",
      "Noting the anonymisation option and its trigger",
    ],
    result: "Transparency note drafted for HR review, ready to publish alongside the first monthly pack.",
  },
];

/** The prototype's `adpFixLibrary` build (12922-12940), branch included. */
export const ADP_FIX_PLAYBOOKS: Readonly<Record<string, FixPlaybook>> = Object.fromEntries(
  ADP_FIXES.map((f) => [
    f.key,
    {
      key: f.key,
      title: f.title,
      pillarColor: ADP_ORANGE,
      description: f.desc,
      // Passed through, NOT forced true. Four of these have nothing to automate.
      canAutomate: f.can,
      sopRef: "Written procedure attached from the SOP library",
      riskText: f.risk,
      rewardText: f.reward,
      manualSteps: [
        // No link on this step — unlike Compliance's Purview and Licensing's
        // admin-centre openers, there is nowhere to send anyone.
        { text: f.can ? ENABLER_STEP : PEOPLE_PLAY_STEP },
        ...f.manual.map((text) => ({ text })),
        { text: MONTHLY_RHYTHM_STEP },
      ],
      graphSteps: f.graph,
      resultSummary: f.result,
    } satisfies FixPlaybook,
  ]),
);
