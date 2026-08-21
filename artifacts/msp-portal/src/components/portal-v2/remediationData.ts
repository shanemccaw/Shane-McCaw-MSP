/**
 * remediationData.ts — the Operate → Remediation Tracker fixture (Part 5).
 *
 * EXTRACTED from the prototype's own `RT_PHASES` array
 * ('Customer Portal Shell.dc.html' 15665-15702), evaluated rather than retyped.
 * Every string is the design's, verbatim.
 *
 * ── This is the run-down, not the copilot-readiness guide ───────────────────
 * The prototype builds TWO things off `RT_PHASES`: the copilot-readiness page's
 * phase cards / hire price (that surface is `Design/Remediation Tracker.dc.html`
 * and lives in the copilot-journey code, out of Part 5's scope) and THIS page,
 * the Operate module `rtRun` (shell 5961-6013 markup, 20380-20441 logic). The
 * `rtRun` section renders NO price — it is "a run-down of what has been fixed and
 * what has not" (the prototype's own comment, 20381) — so remediation-tracker-
 * pricing.ts, which is server-side and ports the OTHER design file's pricing,
 * has nothing to rebuild here.
 *
 * ── STATUS vs VERIFICATION — the load-bearing separation ────────────────────
 * A step's `status` (done / not / accepted) is one fact; whether a real scan has
 * VERIFIED that claim is a separate one. Only a real scan's
 * `reverifyRemediationTrackerSteps()` (#732, server-side) may set a step
 * verified — never UI or tick state. So NO task below carries `verified`, and
 * the model reads `verified` straight off the fixture (always false here): the
 * "Fixed and verified" counter honestly reads 0, and a done-but-unverified task
 * reads "Awaiting re-scan", exactly as the design intends. See
 * components/copilot-journey/useRemediationTracker.ts for the real vocabulary.
 *
 * UI-only: design content for the fictional Halden Materials tenant. A later
 * pass wires it to real tracker rows; keeping the fixture in one module is what
 * makes that a single-file change.
 */

export type RtSeverity = "Critical" | "Attention" | "Low risk";

export type RtPillarKey =
  | "governance"
  | "security"
  | "compliance"
  | "licensing"
  | "adoption"
  | "health";

/** One remediation task — a finding being closed. */
export interface RemediationTask {
  id: string;
  title: string;
  /** The finding evidence, shown after "Found by the scan · ". */
  ev: string;
  sev: RtSeverity;
  pillar: RtPillarKey;
  /** True when Shane's team runs it rather than the customer's. */
  shane?: boolean;
  /** The tracked status: whether the change has been done. */
  done?: boolean;
  /**
   * Whether a real scan has VERIFIED the fix. Deliberately never set in this
   * fixture — see the header. Present on the type only so the model can read it.
   */
  verified?: boolean;
}

/** One phase of the remediation programme. */
export interface RemediationPhase {
  kicker: string;
  name: string;
  weeks: string;
  due: string;
  fee: number;
  state: string;
  tasks: readonly RemediationTask[];
}

/** prototype 15665-15702. */
export const RT_PHASES: readonly RemediationPhase[] = [
  {
    kicker: "Phase 1",
    name: "Governance & Security",
    weeks: "Weeks 1–4",
    due: "16 September",
    fee: 16200,
    state: "In progress",
    tasks: [
      { id: "p1a", title: "Close org-wide sharing on the four sensitive sites", ev: "212 sites shared org-wide", sev: "Critical", pillar: "governance", shane: true, done: true },
      { id: "p1b", title: "Export the remaining 208 sites and route to owners", ev: "212 sites shared org-wide", sev: "Attention", pillar: "governance" },
      { id: "p1c", title: "Expire all future anonymous links", ev: "2,940 non-expiring links", sev: "Attention", pillar: "governance" },
      { id: "p1d", title: "Revoke the 2,940 existing anonymous links", ev: "2,940 non-expiring links", sev: "Critical", pillar: "governance" },
      { id: "p1e", title: "Apply a 12-month lifecycle policy", ev: "148 inactive sites", sev: "Attention", pillar: "governance" },
      { id: "p1f", title: "Put Teams creation behind a request", ev: "61 teams, 22 single-member", sev: "Attention", pillar: "governance" },
      { id: "p1g", title: "Audit and fix MFA on the 11 admin accounts", ev: "14 accounts without MFA", sev: "Critical", pillar: "security", shane: true, done: true },
      { id: "p1h", title: "Scope Conditional Access to privileged roles", ev: "No privileged-role CA policy", sev: "Critical", pillar: "security", shane: true, done: true },
      { id: "p1i", title: "Re-enable CA01 and remove the 14 June exclusion", ev: "CA baseline deviation", sev: "Attention", pillar: "security" },
      { id: "p1j", title: "Disable legacy authentication", ev: "1,106 legacy sign-ins", sev: "Critical", pillar: "security" },
      { id: "p1k", title: "Reduce 11 standing Global Admins to 2", ev: "11 permanent admin accounts", sev: "Critical", pillar: "security" },
      { id: "p1l", title: "Reinstate the Finance Safe Links policy", ev: "Policy disabled 14 June", sev: "Attention", pillar: "security" },
      { id: "p1m", title: "Take device compliance out of report-only", ev: "88 non-compliant devices", sev: "Attention", pillar: "security" },
    ],
  },
  {
    kicker: "Phase 2",
    name: "Compliance & Licensing",
    weeks: "Weeks 3–7",
    due: "21 October",
    fee: 11800,
    state: "Not started",
    tasks: [
      { id: "p2a", title: "Publish a mandatory baseline label set", ev: "61% of content unlabelled", sev: "Critical", pillar: "compliance" },
      { id: "p2b", title: "Auto-label regulated content", ev: "690 PII · 412 financial · 84 PHI", sev: "Attention", pillar: "compliance" },
      { id: "p2c", title: "Extend DLP to Teams chat and OneDrive", ev: "No DLP on Teams chat", sev: "Critical", pillar: "compliance" },
      { id: "p2d", title: "Extend retention to the six uncovered workloads", ev: "Retention on 3 of 9 workloads", sev: "Critical", pillar: "compliance" },
      { id: "p2e", title: "Raise audit log retention above 90 days", ev: "90-day audit retention", sev: "Attention", pillar: "compliance" },
      { id: "p2f", title: "Identify the 22 dormant Copilot seats", ev: "$18,400 a year in waste", sev: "Low risk", pillar: "licensing" },
      { id: "p2g", title: "Reclaim them after a 14-day notice", ev: "22 unused Copilot seats", sev: "Attention", pillar: "licensing" },
      { id: "p2h", title: "Reconcile the 47 mismatched SKU assignments", ev: "47 assignments off pattern", sev: "Attention", pillar: "licensing" },
      { id: "p2i", title: "Move to group-based licensing", ev: "31 licences from legacy groups", sev: "Low risk", pillar: "licensing" },
    ],
  },
  {
    kicker: "Phase 3",
    name: "Adoption & Health",
    weeks: "Weeks 6–10",
    due: "18 November",
    fee: 8200,
    state: "Not started",
    tasks: [
      { id: "p3a", title: "Pull the real usage baseline", ev: "412 users dormant 30+ days", sev: "Low risk", pillar: "adoption" },
      { id: "p3b", title: "Move one recurring workflow per department into Teams", ev: "Operations 38% · Field 26%", sev: "Attention", pillar: "adoption" },
      { id: "p3c", title: "Train the three ready personas", ev: "516 users need fundamentals", sev: "Low risk", pillar: "adoption" },
      { id: "p3d", title: "Stop attaching documents to email by default", ev: "44% of traffic is attachments", sev: "Low risk", pillar: "adoption" },
      { id: "p3e", title: "Capture a signed configuration baseline", ev: "No baseline on record", sev: "Critical", pillar: "health" },
      { id: "p3f", title: "Resolve the 214 OneDrive sync errors", ev: "214 clients with sync errors", sev: "Attention", pillar: "health" },
      { id: "p3g", title: "Attest and dispose of 148 inactive sites", ev: "19 orphaned channels", sev: "Attention", pillar: "health" },
      { id: "p3h", title: "Put drift telemetry on the tenant", ev: "37 unreviewed changes", sev: "Critical", pillar: "health" },
    ],
  },
];

/**
 * Display label per pillar key — prototype `pillars` map (20383). Also the
 * render order the grouped list uses.
 */
export const RT_PILLAR_LABEL: Readonly<Record<RtPillarKey, string>> = {
  governance: "Governance",
  security: "Security",
  compliance: "Compliance",
  licensing: "Licensing",
  adoption: "Adoption",
  health: "Health",
};

/** The order the groups render in — prototype `Object.keys(pillars)` (20411). */
export const RT_PILLAR_ORDER: readonly RtPillarKey[] = [
  "governance",
  "security",
  "compliance",
  "licensing",
  "adoption",
  "health",
];

/** One row's owner chip. */
export interface RtOwner {
  init: string;
  name: string;
  tone: string;
}

/**
 * Each pillar's RESPONSIBLE owner — prototype `raciChip(t.pillar)` resolving
 * `RACI_OWN[pillar].r` against `RACI_PEOPLE` (7599-7624). The design draws a
 * pinned RACI popover on click (shell `raciHover` state); this build carries the
 * name on the chip's native `title` (which the prototype also sets) rather than
 * reproducing shell machinery a page must not touch.
 */
export const RT_PILLAR_OWNER: Readonly<Record<RtPillarKey, RtOwner>> = {
  governance: { init: "SM", name: "Shane McCaw", tone: "#38bdf8" },
  security: { init: "RC", name: "R. Court", tone: "#f87171" },
  compliance: { init: "AB", name: "Aisha Bello", tone: "#34d399" },
  licensing: { init: "PR", name: "Priya Raman", tone: "#f472b6" },
  adoption: { init: "ML", name: "Marcus Lee", tone: "#60a5fa" },
  health: { init: "JF", name: "Jo Feltham", tone: "#22d3ee" },
};
