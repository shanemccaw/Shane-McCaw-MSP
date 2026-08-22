/**
 * remediationData.ts — the Operate → Remediation Tracker fixture, Round Four.
 *
 * TRANSCRIBED from the prototype's rebuilt `rt` module IIFE
 * ('Customer Portal Shell.dc.html' 20678-20793 for the catalogue, 20680/20807/
 * 20825/20696-20972 for the constants). Every user-facing string is the
 * design's, verbatim — copy is final.
 *
 * ── ROUND FOUR: from a 3-phase checklist to a 7-phase working tracker ───────
 * The old fixture had three phases (Governance & Security / Compliance &
 * Licensing / Adoption & Health) and thirty p-id tasks. Round Four rebuilt the
 * tracker into SEVEN phases in dependency order — Discovery, Stabilization,
 * Baseline, Hardening, Copilot Readiness, Drift Cleanup, Identity Hygiene — with
 * 31 tasks, each gated by its own change request, hold window and evidence, and
 * scored only when a re-scan proves it. The phases now live in the LEFT NAV
 * (see portalV2Nav.ts REMEDIATION_PHASE_SUBS); this module is the catalogue they
 * group and the derivation reads (remediationModel.ts).
 *
 * ── STATUS/VERIFICATION IS REAL, THE CATALOGUE IS FIXTURE — UNCHANGED ───────
 * The load-bearing separation the previous build established survives the
 * rebuild: whether a task is DONE, VERIFIED or ACCEPTED is NOT carried here. It
 * comes over the wire from the customer's own `remediation_tracker_steps` rows
 * (GET /api/portal/remediation-tracker via useRemediationTracker), resolved per
 * task through the `stepId` field below and remediationLive.ts. The design's own
 * demo `done`/`verified` flags are deliberately NOT ported — a fixture flag and
 * a real row would fight over the same counter, and the platform's position is
 * that "done" and "verified" are facts it holds, not ones a design fixture
 * asserts. Everything else on a task — its CR stage, hold window and evidence
 * state — is the design's SEED, placeholder structural data for this shell pass;
 * wiring those to real persistence is the separate data pass.
 *
 * ── `stepId`: the real-data seam ────────────────────────────────────────────
 * Each task carries the platform step id (`s1`…`s30`) for the same underlying
 * finding, or `null` where the platform has no step for it (the three Discovery
 * reads, the two adoption items #757 removed, and the drift re-close). This is
 * the correspondence the previous build held in remediationLive.ts's RT_STEP_ID
 * map, re-keyed onto the Round Four task ids — same real steps, same real
 * connection, through the new structure.
 */

export type RtSeverity = "Critical" | "Attention" | "Low risk";

export type RtPillarKey =
  | "governance"
  | "security"
  | "compliance"
  | "licensing"
  | "adoption"
  | "health";

export type RtPhaseKey =
  | "discovery"
  | "stabilization"
  | "baseline"
  | "hardening"
  | "copilot"
  | "drift"
  | "identity";

export type RtEvidenceState = "missing" | "submitted" | "approved";

/** A task's hold window seed — prototype `t.hold` (e.g. shell 20707). */
export interface RtHoldSeed {
  readonly left: string;
  readonly of: string;
  readonly verdict: string;
  readonly state: "running" | "closing" | "extended" | "released";
  readonly why: string;
}

/** One remediation task — a finding being closed. Prototype `T` (20691-20793). */
export interface RemediationTask {
  readonly id: string;
  readonly ph: RtPhaseKey;
  readonly pl: RtPillarKey;
  /** Title. */
  readonly t: string;
  /** The problem. */
  readonly pr: string;
  /** The fix. */
  readonly fx: string;
  readonly sv: RtSeverity;
  /** Effort estimate, e.g. "8h". */
  readonly ef: string;
  readonly fee: number;
  readonly bill: "Retainer" | "Billed";
  /** True when the task routes through a change request. */
  readonly cr: boolean;
  /** CR stage seed, 0-6 across CR_STAGES; 7 = closed (past Evidence). */
  readonly crs: number;
  /** Evidence state seed. */
  readonly evst: RtEvidenceState;
  /** The evidence artefacts this task owes. */
  readonly ev: readonly string[];
  readonly hold: RtHoldSeed | null;
  /** Task ids this task depends on. */
  readonly dep: readonly string[];
  /** The playbook this task runs. */
  readonly pb: string;
  /** Graph calls the runbook makes. */
  readonly gr: readonly string[];
  /** Manual steps the runbook needs. */
  readonly mn: readonly string[];
  /** For a re-remediation task, the id of the original task that drifted. */
  readonly drift: string | null;
  /** A Message Center post id this task answers, if any. */
  readonly mc: string | null;
  /**
   * The platform step id for the same finding, or null where the platform holds
   * no step. This is the real-data seam — see the header. NOT part of the
   * design; the platform's own correspondence.
   */
  readonly stepId: string | null;
}

/** One phase of the remediation programme. Prototype `PH` (20681-20689). */
export interface RemediationPhase {
  readonly k: RtPhaseKey;
  /** The two-digit ordinal, "01"…"07". */
  readonly n: string;
  readonly name: string;
  /** Target date, e.g. "12 August". */
  readonly due: string;
  readonly status: "Complete" | "On Track" | "At Risk" | "Blocked";
}

/** prototype `PH` 20681-20689. */
export const RT_PHASES: readonly RemediationPhase[] = [
  { k: "discovery", n: "01", name: "Discovery", due: "12 August", status: "Complete" },
  { k: "stabilization", n: "02", name: "Stabilization", due: "26 August", status: "On Track" },
  { k: "baseline", n: "03", name: "Baseline", due: "9 September", status: "At Risk" },
  { k: "hardening", n: "04", name: "Hardening", due: "30 September", status: "On Track" },
  { k: "copilot", n: "05", name: "Copilot Readiness", due: "21 October", status: "Blocked" },
  { k: "drift", n: "06", name: "Drift Cleanup", due: "4 November", status: "On Track" },
  { k: "identity", n: "07", name: "Identity Hygiene", due: "18 November", status: "On Track" },
];

/** prototype `T` 20691-20793. */
export const RT_TASKS: readonly RemediationTask[] = [
  { id: "d1", ph: "discovery", pl: "governance", t: "Baseline read of all 1,847 sites and 96 teams", pr: "212 sites are shared org-wide and no inventory existed.", fx: "Read-only Graph enumeration of every site, team and sharing link, filed as the scan-1 baseline.",
    sv: "Low risk", ef: "4h", fee: 0, bill: "Retainer", cr: false, crs: 7, evst: "approved", ev: ["Graph response set, 1,847 sites", "Scan 1 verdict, 3 August 06:00"], hold: null, dep: [],
    pb: "PB-01 Tenant enumeration", gr: ["GET /sites?search=*", "GET /groups?$filter=resourceProvisioningOptions/Any(x:x eq 'Team')"], mn: [], drift: null, mc: null, stepId: null },
  { id: "d2", ph: "discovery", pl: "security", t: "Identity and MFA inventory across 1,240 users", pr: "14 accounts had no MFA and nobody knew which.", fx: "Full registration-detail read, cross-checked against directory role assignments.",
    sv: "Low risk", ef: "3h", fee: 0, bill: "Retainer", cr: false, crs: 7, evst: "approved", ev: ["authenticationMethods export, 1,240 users", "Privileged role assignment list"], hold: null, dep: [],
    pb: "PB-02 Identity inventory", gr: ["GET /reports/authenticationMethods/userRegistrationDetails", "GET /roleManagement/directory/roleAssignments"], mn: [], drift: null, mc: null, stepId: null },
  { id: "d3", ph: "discovery", pl: "compliance", t: "Label and DLP coverage report", pr: "61% of content carries no sensitivity label and Teams chat has no DLP.", fx: "Coverage read across labels, DLP policies and retention scope, per workload.",
    sv: "Low risk", ef: "5h", fee: 0, bill: "Retainer", cr: false, crs: 7, evst: "submitted", ev: ["Label coverage export", "DLP policy scope, 9 workloads"], hold: null, dep: [],
    pb: "PB-03 Purview coverage", gr: ["GET /security/informationProtection/labelPolicySettings"], mn: ["Export DLP policy scope from Purview"], drift: null, mc: null, stepId: null },

  { id: "s1", ph: "stabilization", pl: "security", t: "Audit and fix MFA on the 11 admin accounts", pr: "14 accounts without MFA. Four are Global Admins.", fx: "Enforce registration, revoke sessions and confirm each method is phishing-resistant.",
    sv: "Critical", ef: "6h", fee: 1450, bill: "Billed", cr: true, crs: 6, evst: "submitted", ev: ["Post-change method export", "Session revocation log", "Approver identity, D. Whitmore"], hold: null, dep: [],
    pb: "PB-11 Admin MFA enforcement", gr: ["POST /users/{id}/authentication/methods", "POST /users/{id}/revokeSignInSessions"], mn: ["Confirm each admin re-registers within 24h"], drift: null, mc: null, stepId: "s7" },
  { id: "s3", ph: "stabilization", pl: "governance", t: "Close org-wide sharing on the four sensitive sites", pr: "Four sites holding regulated content are open to everyone in the tenant.", fx: "Remove the org-wide link, re-permission from the owner group, notify affected members.",
    sv: "Critical", ef: "8h", fee: 2100, bill: "Billed", cr: true, crs: 5, evst: "missing", ev: ["Permission set before and after", "Owner sign-off per site"], dep: [],
    hold: { left: "36h", of: "72h", verdict: "Clear at scan 14", state: "running", why: "A 72-hour window runs before the second site batch, so a wrongly removed permission surfaces while it is still cheap to reverse." },
    pb: "PB-14 Sharing link removal", gr: ["DELETE /sites/{id}/permissions/{permId}"], mn: ["Notify the 38 members who lose access"], drift: null, mc: null, stepId: "s1" },
  { id: "s5", ph: "stabilization", pl: "governance", t: "Revoke the 2,940 existing anonymous links", pr: "2,940 anonymous links, none of them expiring.", fx: "Bulk revoke by age band, oldest first, with an owner notification per site.",
    sv: "Critical", ef: "12h", fee: 2800, bill: "Billed", cr: true, crs: 0, evst: "missing", ev: ["Revocation log per link", "Owner notification receipts"], hold: null, dep: ["s3"],
    pb: "PB-15 Anonymous link revocation", gr: ["DELETE /shares/{shareId}"], mn: ["Agree the age bands with the site owners"], drift: null, mc: "MC1098234", stepId: "s4" },
  { id: "s2", ph: "stabilization", pl: "security", t: "Reduce 11 standing Global Admins to 2", pr: "Eleven permanent Global Admins, nine of them unused in 90 days.", fx: "Move nine to eligible-only under PIM, keep two break-glass accounts excluded.",
    sv: "Critical", ef: "10h", fee: 2400, bill: "Billed", cr: true, crs: 4, evst: "missing", ev: ["PIM assignment export", "Break-glass account attestation"], hold: null, dep: [],
    pb: "PB-12 Privileged role reduction", gr: ["POST /roleManagement/directory/roleEligibilityScheduleRequests"], mn: ["Confirm break-glass credentials are sealed and tested"], drift: null, mc: null, stepId: "s11" },
  { id: "s4", ph: "stabilization", pl: "security", t: "Reinstate the Finance Safe Links policy", pr: "Policy disabled 14 June, unrecorded, never re-enabled.", fx: "Re-enable with the original scope and add it to the signed baseline.",
    sv: "Attention", ef: "2h", fee: 480, bill: "Retainer", cr: true, crs: 1, evst: "missing", ev: ["Policy state before and after"], hold: null, dep: [],
    pb: "PB-13 Defender policy restore", gr: [], mn: ["Re-enable in Defender, compare against the 13 June export"], drift: null, mc: null, stepId: "s12" },

  { id: "b1", ph: "baseline", pl: "health", t: "Capture a signed configuration baseline", pr: "No baseline on record, so nothing can be called drift.", fx: "Snapshot every monitored setting, have it signed, and pin it as the comparison point.",
    sv: "Critical", ef: "6h", fee: 1600, bill: "Billed", cr: false, crs: 7, evst: "missing", ev: ["Signed baseline document", "Hash of the configuration snapshot"], hold: null, dep: [],
    pb: "PB-21 Baseline capture", gr: ["GET /policies", "GET /admin/sharepoint/settings"], mn: ["Counter-signature from the IT owner"], drift: null, mc: null, stepId: "s27" },
  { id: "b2", ph: "baseline", pl: "governance", t: "Expire all future anonymous links", pr: "Anonymous links are created with no expiry by default.", fx: "Set a 30-day tenant default and a 30-day cap at site level.",
    sv: "Attention", ef: "1h", fee: 0, bill: "Retainer", cr: true, crs: 7, evst: "approved", ev: ["Tenant setting before and after"], hold: null, dep: [],
    pb: "PB-22 Sharing defaults", gr: ["PATCH /admin/sharepoint/settings"], mn: [], drift: null, mc: "MC1098234", stepId: "s3" },
  { id: "b3", ph: "baseline", pl: "governance", t: "Apply a 12-month lifecycle policy", pr: "148 sites inactive for more than a year, none of them reviewed.", fx: "Attestation at 12 months, archive at 15, delete at 18, with owner escalation.",
    sv: "Attention", ef: "5h", fee: 1250, bill: "Billed", cr: true, crs: 2, evst: "missing", ev: ["Policy definition", "First attestation run output"], hold: null, dep: [],
    pb: "PB-23 Site lifecycle", gr: [], mn: ["Agree the archive destination and retention overlap"], drift: null, mc: null, stepId: "s5" },
  { id: "b4", ph: "baseline", pl: "compliance", t: "Raise audit log retention above 90 days", pr: "90-day audit retention, below the one-year obligation in the ISMS.", fx: "Move to a 365-day audit retention policy on the privileged and file activity sets.",
    sv: "Attention", ef: "2h", fee: 0, bill: "Retainer", cr: true, crs: 7, evst: "approved", ev: ["Retention policy export", "Sample query over day 120"], hold: null, dep: [],
    pb: "PB-24 Audit retention", gr: [], mn: [], drift: null, mc: null, stepId: "s18" },

  { id: "h2", ph: "hardening", pl: "security", t: "Scope Conditional Access to privileged roles", pr: "No CA policy targeted privileged roles.", fx: "Require phishing-resistant MFA and a compliant device for every privileged role.",
    sv: "Critical", ef: "7h", fee: 1900, bill: "Billed", cr: true, crs: 7, evst: "approved", ev: ["Policy JSON, report-only then enforced", "What-if results for 12 accounts", "Approver identity, S. McCaw"], hold: null, dep: [],
    pb: "PB-31 Privileged CA", gr: ["POST /identity/conditionalAccess/policies"], mn: [], drift: null, mc: null, stepId: "s8" },
  { id: "h1", ph: "hardening", pl: "security", t: "Disable legacy authentication", pr: "1,106 legacy sign-ins in 30 days, mostly SMTP AUTH.", fx: "Block legacy auth tenant-wide after moving the four service accounts to modern auth.",
    sv: "Critical", ef: "9h", fee: 2200, bill: "Billed", cr: true, crs: 6, evst: "submitted", ev: ["Legacy sign-in count before and after", "Service account migration log"], dep: [],
    hold: { left: "4h", of: "48h", verdict: "Clear at scan 14, no legacy sign-ins in 41h", state: "closing", why: "The block stays report-only for 48 hours so a missed service account shows up as a failed sign-in, not an outage." },
    pb: "PB-32 Legacy auth block", gr: ["POST /identity/conditionalAccess/policies"], mn: ["Confirm the four service accounts before enforcing"], drift: null, mc: "MC1105442", stepId: "s10" },
  { id: "h3", ph: "hardening", pl: "compliance", t: "Extend DLP to Teams chat and OneDrive", pr: "No DLP policy covers Teams chat, where most regulated content now moves.", fx: "Extend the existing policy set to chat and OneDrive, notify-only first, then block.",
    sv: "Critical", ef: "11h", fee: 2650, bill: "Billed", cr: true, crs: 3, evst: "missing", ev: ["Policy scope export", "Two weeks of notify-only match data"], hold: null, dep: [],
    pb: "PB-33 DLP extension", gr: [], mn: ["Agree the notify-only period with the compliance owner"], drift: null, mc: null, stepId: "s16" },
  { id: "h4", ph: "hardening", pl: "security", t: "Take device compliance out of report-only", pr: "88 non-compliant devices still reach tenant data.", fx: "Enforce the compliance grant after a two-week remediation window for the 88.",
    sv: "Attention", ef: "6h", fee: 1400, bill: "Billed", cr: true, crs: 5, evst: "missing", ev: ["Non-compliant device list, before and after", "Helpdesk ticket references"], hold: null, dep: [],
    pb: "PB-34 Device compliance enforcement", gr: ["GET /deviceManagement/managedDevices"], mn: ["Chase the 88 device owners through the service desk"], drift: null, mc: null, stepId: "s13" },

  { id: "c1", ph: "copilot", pl: "compliance", t: "Publish a mandatory baseline label set", pr: "61% of content is unlabelled, so Copilot has no instruction to obey.", fx: "Four labels published in order, piloted for two weeks, then defaulted.",
    sv: "Critical", ef: "14h", fee: 3400, bill: "Billed", cr: true, crs: 0, evst: "missing", ev: ["Label definitions", "Pilot group feedback", "Publication order sign-off"], hold: null, dep: ["h3"],
    pb: "PB-41 Label taxonomy rollout", gr: [], mn: ["Board pack owners confirm the marking wording"], drift: null, mc: null, stepId: "s14" },
  { id: "c2", ph: "copilot", pl: "compliance", t: "Auto-label regulated content", pr: "690 PII, 412 financial and 84 PHI documents carry no label.", fx: "Auto-labelling policies per classifier, simulation first, then enforce.",
    sv: "Attention", ef: "10h", fee: 2400, bill: "Billed", cr: true, crs: 1, evst: "missing", ev: ["Simulation results per classifier", "False-positive review notes"], hold: null, dep: ["c1"],
    pb: "PB-42 Auto-labelling", gr: [], mn: ["Review the first 100 simulated matches with the data owner"], drift: null, mc: null, stepId: "s15" },
  { id: "c3", ph: "copilot", pl: "licensing", t: "Reclaim the 22 dormant Copilot seats", pr: "22 Copilot seats unused for 60 days, $18,400 a year.", fx: "Fourteen-day notice, then reclaim and hold six for the executive pilot.",
    sv: "Attention", ef: "3h", fee: 0, bill: "Retainer", cr: true, crs: 7, evst: "approved", ev: ["Usage export per seat", "Notice sent to 22 users", "Reclaim confirmation"], hold: null, dep: [],
    pb: "PB-43 Seat reclamation", gr: ["DELETE /users/{id}/assignLicense"], mn: [], drift: null, mc: null, stepId: "s19" },
  { id: "c4", ph: "copilot", pl: "licensing", t: "Reconcile the 47 mismatched SKU assignments", pr: "47 assignments sit outside the licensing pattern for their role.", fx: "Reconcile against the role matrix and move the 31 legacy group licences.",
    sv: "Attention", ef: "7h", fee: 1700, bill: "Billed", cr: true, crs: 6, evst: "missing", ev: ["Assignment diff, before and after"], hold: null, dep: [],
    pb: "PB-44 SKU reconciliation", gr: ["POST /users/{id}/assignLicense"], mn: ["Confirm the role matrix with HR"], drift: null, mc: null, stepId: "s21" },

  { id: "dr1", ph: "drift", pl: "governance", t: "Re-close org-wide sharing on two sites that reverted", pr: "Two of the four sites were re-shared org-wide on 12 August, six days after the fix.", fx: "Re-remove the link, then put the two sites under a sharing-change alert.",
    sv: "Critical", ef: "3h", fee: 720, bill: "Retainer", cr: true, crs: 2, evst: "missing", ev: ["Drift detection record, scan 13", "Permission set after re-close"], hold: null, dep: [],
    pb: "PB-14 Sharing link removal", gr: ["DELETE /sites/{id}/permissions/{permId}"], mn: ["Ask the site owner why it was re-shared"], drift: "s3", mc: null, stepId: null },
  { id: "dr2", ph: "drift", pl: "security", t: "Re-enable CA01 and remove the 14 June exclusion", pr: "CA01 was disabled and an exclusion group added, outside any change window.", fx: "Re-enable, remove the exclusion, and raise the change as unauthorised.",
    sv: "Attention", ef: "2h", fee: 480, bill: "Retainer", cr: true, crs: 6, evst: "submitted", ev: ["Policy JSON diff", "Audit log entry for the 14 June change"], hold: null, dep: [],
    pb: "PB-31 Privileged CA", gr: ["PATCH /identity/conditionalAccess/policies/{id}"], mn: [], drift: "h2", mc: null, stepId: "s9" },
  { id: "dr3", ph: "drift", pl: "health", t: "Put drift telemetry on the tenant", pr: "37 configuration changes in 90 days, none recorded or reviewed.", fx: "Hourly configuration read against the signed baseline, alerting on deviation.",
    sv: "Critical", ef: "4h", fee: 0, bill: "Retainer", cr: false, crs: 7, evst: "missing", ev: ["First 24 hours of drift telemetry"], hold: null, dep: ["b1"],
    pb: "PB-51 Drift telemetry", gr: ["GET /policies", "GET /admin/sharepoint/settings"], mn: [], drift: null, mc: null, stepId: "s30" },
  { id: "dr4", ph: "drift", pl: "health", t: "Resolve the 214 OneDrive sync errors", pr: "214 clients reporting sync errors, most on path length.", fx: "Fix the path-length offenders, then re-baseline the sync health report.",
    sv: "Attention", ef: "8h", fee: 1900, bill: "Billed", cr: false, crs: 7, evst: "missing", ev: ["Sync error count before and after"], hold: null, dep: [],
    pb: "PB-52 Sync remediation", gr: [], mn: ["Rename the 41 offending folder paths with the owners"], drift: null, mc: null, stepId: "s28" },

  { id: "i1", ph: "identity", pl: "licensing", t: "Move to group-based licensing", pr: "31 licences still come from legacy direct assignment.", fx: "Group-based assignment per role, with direct assignments removed after verification.",
    sv: "Low risk", ef: "5h", fee: 1200, bill: "Billed", cr: true, crs: 5, evst: "missing", ev: ["Group membership export", "Assignment diff"], hold: null, dep: ["c4"],
    pb: "PB-61 Group licensing", gr: ["PATCH /groups/{id}/assignLicense"], mn: [], drift: null, mc: null, stepId: "s22" },
  { id: "i6", ph: "identity", pl: "governance", t: "Put Teams creation behind a request", pr: "61 teams, 22 of them with a single member.", fx: "Restrict creation to a request flow with an owner and a purpose recorded.",
    sv: "Attention", ef: "6h", fee: 1450, bill: "Billed", cr: true, crs: 4, evst: "missing", ev: ["Directory setting before and after", "Request form definition"], hold: null, dep: [],
    pb: "PB-62 Team provisioning", gr: ["PATCH /groupSettings/{id}"], mn: ["Publish the request route to the service desk"], drift: null, mc: null, stepId: "s6" },
  { id: "i7", ph: "identity", pl: "compliance", t: "Extend retention to the six uncovered workloads", pr: "Retention covers 3 of 9 workloads, including nothing in Teams chat.", fx: "One policy per workload, scoped to the obligation that requires it.",
    sv: "Critical", ef: "9h", fee: 2200, bill: "Billed", cr: true, crs: 1, evst: "missing", ev: ["Policy scope per workload", "Obligation mapping"], hold: null, dep: [],
    pb: "PB-63 Retention extension", gr: [], mn: ["Confirm the retention period per obligation with legal"], drift: null, mc: "MC1102771", stepId: "s17" },
  { id: "i5", ph: "identity", pl: "health", t: "Attest and dispose of 148 inactive sites", pr: "148 sites inactive over a year, 19 channels orphaned.", fx: "Owner attestation, then archive or delete under the lifecycle policy.",
    sv: "Attention", ef: "10h", fee: 2400, bill: "Billed", cr: true, crs: 6, evst: "missing", ev: ["Attestation responses per site", "Disposal log", "Archive location record"], hold: null, dep: ["b3"],
    pb: "PB-64 Site disposal", gr: ["DELETE /sites/{id}"], mn: ["Chase the 22 owners who have not attested"], drift: null, mc: null, stepId: "s29" },
  { id: "i2", ph: "identity", pl: "adoption", t: "Pull the real usage baseline", pr: "412 users have not opened Teams in 30 days.", fx: "Per-department usage baseline so enablement is aimed where it pays.",
    sv: "Low risk", ef: "3h", fee: 0, bill: "Retainer", cr: false, crs: 7, evst: "approved", ev: ["Usage report per department"], hold: null, dep: [],
    pb: "PB-71 Usage baseline", gr: ["GET /reports/getTeamsUserActivityUserDetail"], mn: [], drift: null, mc: null, stepId: "s23" },
  { id: "i8", ph: "identity", pl: "adoption", t: "Move one recurring workflow per department into Teams", pr: "Operations at 38% and Field Services at 26% of expected use.", fx: "One recurring workflow per department moved, measured on the same usage data.",
    sv: "Attention", ef: "12h", fee: 2900, bill: "Billed", cr: false, crs: 7, evst: "missing", ev: ["Workflow definition per department", "Usage delta after four weeks"], hold: null, dep: ["i2"],
    pb: "PB-72 Workflow migration", gr: [], mn: ["Run the workshop with each department lead"], drift: null, mc: null, stepId: null },
  { id: "i3", ph: "identity", pl: "adoption", t: "Train the three ready personas", pr: "516 users need fundamentals before Copilot means anything.", fx: "Three persona sessions, recorded, with a prompt drip in Teams afterwards.",
    sv: "Low risk", ef: "16h", fee: 3800, bill: "Billed", cr: false, crs: 7, evst: "missing", ev: ["Attendance per session", "Post-session usage delta"], hold: null, dep: ["i2"],
    pb: "PB-73 Persona enablement", gr: [], mn: ["Book the three sessions with the department leads"], drift: null, mc: null, stepId: null },
];

/** Flattened in phase order — the design keeps `T` flat and groups by `ph`. */
export const RT_ALL_TASKS: readonly RemediationTask[] = RT_TASKS;

/** prototype `CR_STAGES` (20680). 7 stages; index 7 = closed. */
export const RT_CR_STAGES: readonly string[] = [
  "Prepare",
  "SIA / CIA",
  "Rollback plan",
  "Submit",
  "Approve",
  "Execute",
  "Evidence",
];

export type RtStateKey =
  | "completed"
  | "evidence"
  | "held"
  | "blocked"
  | "wcr"
  | "wapp"
  | "progress"
  | "released"
  | "accepted";

/** prototype `ST` (20825-20835). Nine operational task states. */
export const RT_STATES: Readonly<Record<RtStateKey, { label: string; c: string }>> = {
  completed: { label: "Completed", c: "#34d399" },
  evidence: { label: "Waiting for Evidence", c: "#fbbf24" },
  held: { label: "Held", c: "#22d3ee" },
  blocked: { label: "Blocked", c: "#f87171" },
  wcr: { label: "Waiting for CR", c: "#93c5fd" },
  wapp: { label: "Waiting for Approval", c: "#c4b5fd" },
  progress: { label: "In Progress", c: "#60a5fa" },
  released: { label: "Released", c: "#94a3b8" },
  accepted: { label: "Accepted as-is", c: "#a78bfa" },
};

/** prototype `rtSevMeta` (15969). */
export const RT_SEV_COLOR: Readonly<Record<RtSeverity, string>> = {
  Critical: "#f87171",
  Attention: "#fbbf24",
  "Low risk": "#94a3b8",
};

/** prototype `W` (20807). Severity → point weight. */
export const RT_SEV_WEIGHT: Readonly<Record<RtSeverity, number>> = {
  Critical: 3,
  Attention: 2,
  "Low risk": 1,
};

/** prototype `rtPillarColor` (15970). */
export const RT_PILLAR_COLOR: Readonly<Record<RtPillarKey, string>> = {
  governance: "#3B82F6",
  security: "#8B5CF6",
  compliance: "#cbd5e1",
  licensing: "#14B8A6",
  adoption: "#F97316",
  health: "#22C55E",
};

/** prototype `pillarName` (20796). Display label + render order. */
export const RT_PILLAR_LABEL: Readonly<Record<RtPillarKey, string>> = {
  governance: "Governance",
  security: "Security",
  compliance: "Compliance",
  licensing: "Licensing",
  adoption: "Adoption",
  health: "Health",
};

export const RT_PILLAR_ORDER: readonly RtPillarKey[] = [
  "governance",
  "security",
  "compliance",
  "licensing",
  "adoption",
  "health",
];

/** prototype `rtPillarScores` (15971). Base score per pillar, at scan 1. */
export const RT_PILLAR_BASE: Readonly<Record<RtPillarKey, number>> = {
  governance: 34,
  security: 38,
  compliance: 29,
  licensing: 57,
  adoption: 46,
  health: 44,
};

/** prototype `rtPillarTargets` (15972). The score a pillar hits when all of it is scored. */
export const RT_PILLAR_TARGET: Readonly<Record<RtPillarKey, number>> = {
  governance: 61,
  security: 72,
  compliance: 58,
  licensing: 79,
  adoption: 68,
  health: 70,
};

export interface RtRescanOption {
  readonly k: string;
  readonly label: string;
}

/** prototype `RT_RESCAN` (15976-15980). */
export const RT_RESCAN: readonly RtRescanOption[] = [
  { k: "nightly", label: "Scan 15 · tonight 02:00" },
  { k: "weekly", label: "Scan 18 · Mon 26 Aug" },
  { k: "window", label: "When the window closes · 24 Aug" },
];

export interface RtMessageCenterPost {
  readonly id: string;
  readonly title: string;
  readonly when: string;
  readonly impact: string;
  readonly need: "Remediation required" | "Already in the plan";
  /** The task id this post maps to. */
  readonly task: string;
}

/** prototype `MC` (21131-21134). Message Center posts with tenant impact. */
export const RT_MESSAGE_CENTER: readonly RtMessageCenterPost[] = [
  { id: "MC1098234", title: "Anonymous sharing links will default to a 30-day expiry", when: "Rolling out from 14 September", impact: "Your 2,940 non-expiring links keep working until an owner edits them, then inherit the new default with no warning.", need: "Remediation required", task: "s5" },
  { id: "MC1102771", title: "Teams private channel retention behaviour changes", when: "Rolling out from 2 October", impact: "12 private channels sit outside retention scope today. After the change their backing sites are treated separately for eDiscovery.", need: "Remediation required", task: "i7" },
  { id: "MC1105442", title: "Basic authentication for SMTP AUTH permanently disabled", when: "Enforced from 1 November", impact: "1,106 legacy sign-ins in the last 30 days, four of them from service accounts that will stop sending mail.", need: "Already in the plan", task: "h1" },
];

/** Every task keyed by id — prototype `byId` (20794). */
export const RT_BY_ID: Readonly<Record<string, RemediationTask>> = Object.fromEntries(
  RT_TASKS.map((t) => [t.id, t]),
);

/** Phase display name by key — prototype `phName` (20795). */
export const RT_PHASE_NAME: Readonly<Record<string, string>> = Object.fromEntries(
  RT_PHASES.map((p) => [p.k, p.name]),
);
