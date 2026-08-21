/**
 * ccPageData.ts — the Change Control module's fixtures and pure derivations.
 *
 * This is a FULL REBUILD against the current design, which is now a standalone
 * module (`Design/design_handoff_customer_portal/Change Control.dc.html`, 2,795
 * lines) and a materially different page from the round-one inline-shell tab
 * strip (register / schedule / vault) that used to live here. The new page has
 * five sub-views — briefing / register / catalogue / calendar / review — plus a
 * per-CR record view and a deep-linkable policy view (`ccView === 'settings'`)
 * that the shell's header badge and alerts target.
 *
 * ── UI-only, fixtures are the design's own ─────────────────────────────────
 * Every value here is transcribed verbatim from the design's logic class (the
 * `Component` at the bottom of the .dc.html). Copy is final: nothing is
 * reworded, shortened or "improved". A later pass wires the page to live data;
 * until then this module is the single place a value lives, so the wiring pass
 * has one file to change rather than JSX to hunt through.
 *
 * ── Why a css() string parser, against the house style ─────────────────────
 * The neighbouring portal-v2 pages write React style objects. This design is an
 * order of magnitude more style-heavy: dozens of inline styles are COMPUTED in
 * the logic class as CSS strings from tones and state. Hand-converting every one
 * to a camelCase object is where a port of this size drops a pixel or a colour.
 * Keeping the design's CSS strings verbatim and parsing them once at render time
 * is the lower-defect choice here, so `css()` exists and the derivations below
 * carry the design's exact strings. Inline styles in this design use only
 * standard properties plus `backdrop-filter` / `text-wrap`, all of which
 * kebab→camel cleanly; the one vendor prefix (`-webkit-font-smoothing`) is in
 * the design's <style> block, never an element style.
 */

import type { CSSProperties } from "react";

/** The design's monospace stack (proto: 'SF Mono',Menlo,Consolas,monospace). */
export const CC_MONO = "'SF Mono',Menlo,Consolas,monospace";

/**
 * Parse a design CSS string into a React style object. Splits declarations on
 * `;` (no inline style in this design contains a `;` inside a value) and each
 * declaration on its FIRST `:` (values carry `:`-free content but do carry `/`,
 * commas and parentheses, e.g. `grid-column:1 / span 15`,
 * `background:linear-gradient(...)`). Property names are kebab→camel; values are
 * kept as strings, which React accepts for every property.
 */
export function css(input: string): CSSProperties {
  const out: Record<string, string> = {};
  for (const decl of input.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const rawKey = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!rawKey || !value) continue;
    const key = rawKey.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[key] = value;
  }
  return out as CSSProperties;
}

/* ── Tone helpers — proto pill()/riskTone()/stateTone()/aiTone() ──────────── */

/** proto pill() — a small inline-flex chip in a tone with a matching wash. */
export function pill(text: string, tone: string, bg?: string): string {
  return (
    "display:inline-flex;align-items:center;align-self:flex-start;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700;letter-spacing:.04em;white-space:nowrap;color:" +
    tone +
    ";background:" +
    (bg || "rgba(148,163,184,.1)") +
    ";border:1px solid " +
    tone +
    "40"
  );
}

export function riskTone(r: string): string {
  return r === "High" ? "#f87171" : r === "Medium" ? "#fbbf24" : "#34d399";
}

export function stateTone(s: string): string {
  if (/retro|Emergency/.test(s)) return "#f87171";
  return s === "Awaiting approval"
    ? "#fbbf24"
    : s === "Draft"
      ? "#94a3b8"
      : s === "In test"
        ? "#60a5fa"
        : s === "Rolled back"
          ? "#f87171"
          : s === "Deployed"
            ? "#34d399"
            : "#cbd5e1";
}

export function aiTone(n: number): string {
  return n >= 65 ? "#f87171" : n >= 40 ? "#fbbf24" : "#34d399";
}

/* ── Types ─────────────────────────────────────────────────────────────────── */

export interface CrPipeStage {
  readonly name: string;
  readonly status: string;
  readonly note: string;
  readonly prov: boolean;
  readonly tone?: string;
}
export interface CrCheck {
  readonly label: string;
  readonly ok: boolean;
  readonly meta: string;
}
/** A rollback / deployment step. `owner` is the design's field name; it holds a time or duration. */
export interface CrStep {
  readonly text: string;
  readonly mono: string;
  readonly owner: string;
}
export interface CrPerson {
  readonly name: string;
  readonly org: string;
  readonly state: string;
  readonly sig: string;
  readonly tone: string;
}
export interface CrAudit {
  readonly at: string;
  readonly event: string;
  readonly detail: string;
  readonly diff: string;
  readonly tone: string;
}
export interface CrAiFactor {
  readonly weight: string;
  readonly label: string;
}
export interface CrAiDep {
  readonly from: string;
  readonly to: string;
  readonly tag: string;
  readonly note: string;
  readonly tone: string;
}
export interface CrAiSuggested {
  readonly text: string;
  readonly action: string;
}
export interface CrLinked {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly tag: string;
  readonly tone: string;
}
export interface CrImpact {
  readonly func: string;
  readonly user: string;
  readonly ops: string;
  readonly outage: string;
  readonly comms: string;
  readonly downtime: string;
}
export interface CrRollback {
  readonly post: string;
  readonly eng: string;
  readonly steps: readonly CrStep[];
  readonly checks: readonly CrCheck[];
}
export interface CrTest {
  readonly plan: string;
  readonly env: string;
  readonly status: string;
  readonly notes: string;
  readonly evidence: readonly CrCheck[];
}
export interface CrDeploy {
  readonly window: string;
  readonly people: string;
  readonly monitor: string;
  readonly steps: readonly CrStep[];
  readonly postval: readonly CrCheck[];
}
export interface CrAi {
  readonly band: string;
  readonly factors: readonly CrAiFactor[];
  readonly deps: readonly CrAiDep[];
  readonly suggested: readonly CrAiSuggested[];
  readonly impact: string;
  readonly impactMeta: string;
}
export interface CrPir {
  readonly outcome: string;
  readonly window: string;
  readonly finding: string;
  readonly cost: string;
  readonly lessons: readonly CrCheck[];
  readonly next: string;
  readonly signed: string;
}
export interface ChangeRequest {
  readonly code: string;
  readonly title: string;
  readonly workload: string;
  readonly cls: string;
  readonly priority: string;
  readonly risk: string;
  readonly state: string;
  readonly mc: string;
  readonly chan: string;
  readonly window: string;
  readonly countdown: string;
  readonly accounts: string;
  readonly aiScore: number;
  readonly rollbackReady: boolean;
  readonly missing: readonly string[];
  readonly short?: boolean;
  readonly desc: string;
  readonly just: string;
  readonly scope: string;
  readonly deps: string;
  readonly secImpact: string;
  readonly compImpact: string;
  readonly pre: string;
  readonly post: string;
  readonly capturedAt: string;
  readonly impact?: CrImpact;
  readonly rollback?: CrRollback;
  readonly test?: CrTest;
  readonly deploy?: CrDeploy;
  readonly ai: CrAi;
  readonly audit: readonly CrAudit[];
  readonly approvals: { readonly submitter: CrPerson; readonly peer: CrPerson; readonly approver: CrPerson };
  readonly pipe: readonly CrPipeStage[];
  readonly linked: readonly CrLinked[];
  readonly incidents?: readonly CrLinked[];
  readonly pir?: CrPir;
}

export interface FreezeDef {
  readonly label: string;
  readonly range: string;
  readonly from: number;
  readonly to: number;
  readonly owner: string;
  readonly reason: string;
  readonly policy: string;
}
export interface FreezeRow {
  name: string;
  range: string;
  state: string;
  owner: string;
  scope: string;
  emergencies: string;
  tone: string;
  start?: string;
  end?: string;
}
export interface McSentenceSeg {
  readonly 0: string;
  readonly 1: string;
}
export interface McChange {
  readonly id: string;
  readonly title: string;
  readonly group: string;
  readonly groupSub: string;
  readonly time: string;
  readonly timeSub: string;
  readonly day: number;
  readonly optOut: number;
  readonly tone: string;
  readonly state: string;
  readonly impact: string;
  readonly sentence: ReadonlyArray<readonly [string, string]>;
  readonly why: string;
  readonly how: ReadonlyArray<{ readonly call: string; readonly result: string }>;
  readonly ifWrong: string;
  readonly whereNote: string;
  readonly linkedCr: string;
}
export interface CatalogueItem {
  readonly cat: string;
  readonly name: string;
  readonly n: number;
  readonly runs: string;
  readonly what: string;
  readonly who: string;
  readonly window: string;
  readonly approval: string;
  readonly guard: string;
}
export interface NotifRule {
  event: string;
  channel: string;
  to: string;
  lead: string;
  on: boolean;
}
export interface AgendaItem {
  code: string;
  item: string;
  mins: string;
}
export interface Conflict {
  readonly a: string;
  readonly b: string;
  readonly surface: string;
  readonly tone: string;
  readonly note: string;
}
export interface Decision {
  readonly code: string;
  readonly label: string;
  readonly due: string;
  readonly tone: string;
  readonly cons: string;
}
export interface BriefDef {
  readonly group: string;
  readonly groupSub: string;
  readonly time: string;
  readonly timeSub: string;
  readonly who: string;
  readonly whoOrg: string;
  readonly init: string;
  readonly where: string;
  readonly whereNote: string;
  readonly sentence: ReadonlyArray<readonly [string, string]>;
  readonly why: string;
  readonly how: ReadonlyArray<{ readonly call: string; readonly result: string }>;
  readonly ifWrong: string;
}
export interface SecDef {
  readonly key: string;
  readonly num: string;
  readonly label: string;
  readonly intro: string;
  readonly req: boolean;
}

/* ── Fixtures — transcribed verbatim from the design's logic class ──────────── */

/** proto crs() — the five change requests, each with its full 11-section record. */
export const CC_CRS: readonly ChangeRequest[] = [
  {
    code: "CR-0142",
    title: "Block legacy authentication for all mailboxes",
    workload: "Exchange Online · Entra ID",
    cls: "Normal",
    priority: "High",
    risk: "High",
    state: "Awaiting approval",
    mc: "MC1042318",
    chan: "Standard release",
    window: "Tue 25 Aug · 21:00–23:00",
    countdown: "in 5 days",
    accounts: "1,240 mailboxes",
    aiScore: 72,
    rollbackReady: true,
    missing: [],
    desc: "Disable basic authentication for POP, IMAP, SMTP AUTH and Exchange ActiveSync tenant-wide, and enforce modern auth through a Conditional Access policy scoped to all mailbox-enabled accounts.",
    just: "Nine of the 41 open Copilot gate items trace back to legacy auth being reachable. Two service accounts were password-sprayed in July; both were reachable over IMAP. This closes the vector and unblocks four downstream gate items.",
    scope: "Halden Materials tenant · all mailbox-enabled accounts · excludes the two scanner mailboxes migrated to OAuth on 12 Aug",
    deps: "CR-0139 (OAuth on scanner mailboxes) — deployed 14 Aug. Multifunction devices in Bay 3 must be on firmware 4.2 or later.",
    secImpact: "Removes password-spray and credential-stuffing paths against mailbox protocols. Reduces the tenant attack surface; introduces no new privileged access.",
    compImpact: "Satisfies Cyber Essentials Plus authentication control and ISO 27001 A.9.4.2. Evidence is filed against the Copilot readiness gate.",
    pre: '{\n  "AllowBasicAuthImap": true,\n  "AllowBasicAuthPop": true,\n  "AllowBasicAuthSmtp": true,\n  "AllowBasicAuthActiveSync": true,\n  "caPolicy": null\n}',
    post: '{\n  "AllowBasicAuthImap": false,\n  "AllowBasicAuthPop": false,\n  "AllowBasicAuthSmtp": false,\n  "AllowBasicAuthActiveSync": false,\n  "caPolicy": "CA-014 Block legacy auth",\n  "state": "enabled"\n}',
    capturedAt: "18 Aug 09:14 UTC",
    impact: {
      func: "POP, IMAP and SMTP AUTH clients stop connecting. Outlook 2016 and later, OWA, mobile Outlook and Teams are unaffected.",
      user: "11 accounts still authenticate over IMAP — 9 are the Bay 3 scanners, 2 are personal iOS Mail profiles. Both users have Outlook mobile installed already.",
      ops: "The nightly invoice export via SMTP AUTH moves to a Graph send. That script is owned by Finance and has been rewritten but not cut over.",
      outage: "No planned outage. Failure mode is a scanner unable to send, not a mailbox unable to receive.",
      comms: "Yes — a two-stage notice to the 11 affected accounts, and a Bay 3 note to Facilities.",
      downtime: "No downtime required.",
    },
    rollback: {
      post: "Basic auth re-enabled per protocol, CA-014 set to report-only rather than deleted, so the audit trail and the policy body survive the rollback.",
      eng: "Dana Whitlock · Shane McCaw Consulting",
      steps: [
        { text: "Set CA-014 to report-only. Do not delete it.", mono: 'PATCH /v1.0/identity/conditionalAccess/policies/CA-014 { "state": "enabledForReportingButNotEnforced" }', owner: "~2 min" },
        { text: "Re-enable the affected protocols on the authentication policy.", mono: "Set-AuthenticationPolicy -AllowBasicAuthImap $true -AllowBasicAuthSmtp $true", owner: "~5 min" },
        { text: "Force policy refresh on the affected mailboxes rather than waiting for the 24h cache.", mono: 'Set-User -Identity <upn> -AuthenticationPolicy "Legacy-Interim"', owner: "~10 min" },
        { text: "Confirm a test IMAP bind succeeds from the Bay 3 subnet, then post the rollback note to the CR.", mono: "", owner: "~5 min" },
      ],
      checks: [
        { label: "Test IMAP bind from Bay 3 returns OK", ok: true, meta: "scripted" },
        { label: "Nightly invoice export completes on the next run", ok: true, meta: "scripted" },
        { label: "CA-014 present and report-only, not deleted", ok: true, meta: "scripted" },
        { label: "Sign-in logs show no new legacy-auth failures for the 11 accounts", ok: true, meta: "manual · 24h" },
      ],
    },
    test: {
      plan: "Apply CA-014 in report-only for seven days against the full tenant, then enforce against a pilot ring of 25 accounts including one Bay 3 scanner and both iOS Mail users. Read sign-in logs for legacy-auth attempts and confirm the modern-auth path succeeds for each client type.",
      env: "Production, report-only ring",
      status: "Passed",
      notes: "Report-only ran 11–18 Aug. 1,412 legacy-auth attempts logged, all from the 11 known accounts. Pilot enforcement on 25 accounts produced no help-desk tickets across four working days.",
      evidence: [
        { label: "Sign-in log export · legacy auth attempts 11–18 Aug (CSV, 1,412 rows)", ok: true, meta: "passed" },
        { label: "Pilot ring enforcement screenshots · Outlook, OWA, iOS Outlook", ok: true, meta: "passed" },
        { label: "Bay 3 scanner OAuth send test · 4 devices", ok: true, meta: "passed" },
        { label: "Finance invoice export via Graph · dry run", ok: false, meta: "not run" },
      ],
    },
    pipe: [
      { name: "Dev", status: "Not provisioned", note: "Halden Materials has no development tenant. Changes of this class are validated in report-only against production instead.", prov: false },
      { name: "Test", status: "Not provisioned", note: "No separate test tenant. The report-only ring is the compensating control and is recorded as such.", prov: false },
      { name: "Stage", status: "Pilot ring · passed", note: "25 accounts, enforced 14–18 Aug. Sign-in evidence attached in section 5.", prov: true, tone: "#34d399" },
      { name: "Prod", status: "Awaiting approval", note: "Full tenant. Gated on the customer approval and the 25 Aug window.", prov: true, tone: "#fbbf24" },
    ],
    approvals: {
      submitter: { name: "Shane McCaw", org: "Shane McCaw Consulting · Lead architect", state: "Submitted 18 Aug 09:22", sig: "sig 4f2a·c19e", tone: "#94a3b8" },
      peer: { name: "Dana Whitlock", org: "Shane McCaw Consulting · Senior engineer", state: "Peer review passed 18 Aug 15:40", sig: "sig 8b71·02da", tone: "#34d399" },
      approver: { name: "Priya Raman", org: "Halden Materials · IT Director", state: "Waiting for signature", sig: "no signature on file", tone: "#fbbf24" },
    },
    deploy: {
      window: "Tue 25 Aug 21:00–23:00 UTC · inside the Tue–Thu change window, outside the month-end blackout",
      people: "Dana Whitlock executing · Shane McCaw on call · Priya Raman reachable for the go/no-go",
      monitor: "Sign-in failure rate and mail-flow queue watched for 60 minutes after the change, then at the 09:00 business-open check. An alert fires if legacy-auth failures exceed 20 in any 15-minute window.",
      steps: [
        { text: "Snapshot the authentication policy and CA policy set to the CR record.", mono: "GET /v1.0/policies/authenticationMethodsPolicy", owner: "21:00" },
        { text: "Enforce CA-014 tenant-wide.", mono: 'PATCH /v1.0/identity/conditionalAccess/policies/CA-014 { "state": "enabled" }', owner: "21:10" },
        { text: "Disable basic auth per protocol on the tenant authentication policy.", mono: "Set-AuthenticationPolicy -AllowBasicAuth* $false", owner: "21:20" },
        { text: "Run the post-change validation set and attach the output.", mono: "", owner: "21:40" },
        { text: "Hold the window open until 23:00 in case the Bay 3 scanners need the interim policy.", mono: "", owner: "23:00" },
      ],
      postval: [
        { label: "Modern auth sign-in succeeds for Outlook, OWA and Outlook mobile", ok: true, meta: "scripted" },
        { label: "Mail flow queue under 50 messages at T+30", ok: true, meta: "scripted" },
        { label: "Bay 3 scanners send successfully over OAuth", ok: true, meta: "manual" },
        { label: "Copilot gate items 12, 19, 27 and 33 re-scan clear", ok: true, meta: "next scan" },
      ],
    },
    audit: [
      { at: "18 Aug 09:22 UTC", event: "Change request created", detail: "Shane McCaw · from Security pillar finding SEC-014", diff: "", tone: "#60a5fa" },
      { at: "18 Aug 09:14 UTC", event: "Pre-change snapshot captured", detail: "Automated · Graph read of the authentication and CA policy set", diff: "authPolicy.AllowBasicAuthImap: true · caPolicy: null", tone: "#64748b" },
      { at: "18 Aug 11:05 UTC", event: "Impact assessment completed", detail: "Shane McCaw · 11 affected accounts identified from sign-in logs", diff: "", tone: "#60a5fa" },
      { at: "18 Aug 12:31 UTC", event: "Rollback plan attached", detail: "Dana Whitlock · 4 steps, 4 validation checks", diff: "", tone: "#60a5fa" },
      { at: "18 Aug 15:40 UTC", event: "Peer review passed", detail: "Dana Whitlock · signature 8b71·02da", diff: "peerReview: pending → passed", tone: "#34d399" },
      { at: "18 Aug 15:41 UTC", event: "Separation of duties enforced", detail: "Submitter Shane McCaw blocked from the approver role on this record", diff: "", tone: "#a78bfa" },
      { at: "19 Aug 08:02 UTC", event: "Sent for customer approval", detail: "Priya Raman notified · Halden Materials", diff: "state: in review → awaiting approval", tone: "#fbbf24" },
    ],
    ai: {
      band: "High — two signatures and a witnessed window",
      factors: [
        { weight: "+28", label: "Blast radius: 1,240 mailboxes, no per-user staging available" },
        { weight: "+19", label: "Authentication path change — failure locks users out rather than degrading" },
        { weight: "+14", label: "One unmet dependency: the Finance invoice export has not been cut over" },
        { weight: "+11", label: "No dev or test tenant; validation rests on a report-only ring" },
        { weight: "−12", label: "Rollback is a single policy state flip, tested and reversible in under 10 minutes" },
      ],
      deps: [
        { from: "CA-014", to: "All mailbox-enabled accounts", tag: "enforces", note: "Overlaps CA-007 (require MFA) — no conflicting grant controls found.", tone: "#60a5fa" },
        { from: "Bay 3 scanners", to: "SMTP AUTH", tag: "breaks", note: "Migrated to OAuth under CR-0139. Firmware 4.2 confirmed on 4 of 4 devices.", tone: "#fbbf24" },
        { from: "Finance invoice export", to: "SMTP AUTH", tag: "breaks", note: "Graph rewrite exists, dry run not completed. This is the open risk in the change.", tone: "#f87171" },
        { from: "Copilot gate 12, 19, 27, 33", to: "Legacy auth disabled", tag: "unblocks", note: "Four gate items clear on the next scan if this holds.", tone: "#34d399" },
      ],
      suggested: [
        { text: "Set CA-014 to report-only rather than deleting it, so the policy body and audit trail survive a rollback.", action: "In the plan" },
        { text: "Stage an interim authentication policy for the Bay 3 scanners before the window opens, so a scanner failure does not force a full rollback.", action: "Add to plan" },
        { text: "Hold the Finance invoice export dry run as a go/no-go gate at 21:00 rather than a post-deployment check.", action: "Add to plan" },
      ],
      impact: "Reads the tenant against the proposed payload: 1,240 mailboxes in scope, 11 with legacy-auth activity in the last 30 days, 2 automation paths depending on SMTP AUTH. No Conditional Access conflict, no break-glass account caught in the policy scope. The single unmitigated path is the Finance invoice export — everything else in scope has a tested modern-auth route.",
      impactMeta: "Generated 19 Aug 08:04 from the Graph read, sign-in logs and the change payload. Re-runs on every payload edit.",
    },
    linked: [
      { id: "MC1042318", title: "Basic authentication permanently disabled in Exchange Online", note: "Microsoft enforces this from 1 October regardless of this CR. Doing it deliberately in a window is the difference between a change and an outage.", tag: "Enforced 1 Oct", tone: "#f87171" },
      { id: "MC1039902", title: "Conditional Access policy templates update", note: "Adds the template CA-014 was built from. No action, informational only.", tag: "Informational", tone: "#64748b" },
    ],
  },
  {
    code: "CR-0147",
    title: "Open Teams external access to Halden supplier domains",
    workload: "Microsoft Teams",
    cls: "Normal",
    priority: "Normal",
    risk: "Medium",
    state: "Draft",
    mc: "",
    chan: "",
    window: "Not scheduled",
    countdown: "—",
    accounts: "340 users in Procurement and Logistics",
    aiScore: 54,
    rollbackReady: false,
    missing: ["impact", "rollback", "test", "deploy"],
    desc: "Allow federated chat and meeting join with four named supplier domains, scoped to the Procurement and Logistics groups rather than tenant-wide.",
    just: "Procurement runs supplier calls over personal WhatsApp today because federation is closed. That is the data-leak path the compliance pillar flagged as CMP-009.",
    scope: "Teams external access · allow-list of 4 domains · Procurement and Logistics security groups",
    deps: "Needs the supplier domain list confirmed by Procurement. CMP-009 stays open until this lands.",
    secImpact: "Introduces federated chat with named external tenants. Anonymous join and unmanaged-domain federation stay off.",
    compImpact: "Closes CMP-009. Requires the external-communications clause in the data handling standard to be updated first.",
    pre: '{\n  "externalAccess": "blocked",\n  "allowedDomains": []\n}',
    post: '{\n  "externalAccess": "allowList",\n  "allowedDomains": ["haldensupply.com", "nordkalk.fi", "brantfield.co.uk", "meridian-freight.com"]\n}',
    capturedAt: "19 Aug 07:40 UTC",
    pipe: [
      { name: "Dev", status: "Not provisioned", note: "No development tenant in this contract.", prov: false },
      { name: "Test", status: "Not provisioned", note: "No test tenant. A pilot ring is the compensating control once the test plan exists.", prov: false },
      { name: "Stage", status: "Not started", note: "No pilot ring defined yet — section 5 is empty.", prov: true, tone: "#64748b" },
      { name: "Prod", status: "Blocked", note: "Cannot be scheduled while four required sections are incomplete.", prov: true, tone: "#f87171" },
    ],
    approvals: {
      submitter: { name: "Priya Raman", org: "Halden Materials · IT Director", state: "Drafted 19 Aug 07:40", sig: "unsigned draft", tone: "#94a3b8" },
      peer: { name: "Not assigned", org: "Shane McCaw Consulting", state: "Peer review not started", sig: "no signature on file", tone: "#64748b" },
      approver: { name: "Not assigned", org: "Approver must differ from the submitter", state: "Blocked — record incomplete", sig: "no signature on file", tone: "#f87171" },
    },
    audit: [
      { at: "19 Aug 07:40 UTC", event: "Change request drafted", detail: "Priya Raman · from Compliance finding CMP-009", diff: "", tone: "#60a5fa" },
      { at: "19 Aug 07:41 UTC", event: "Pre-change snapshot captured", detail: "Automated · Graph read of Teams external access configuration", diff: "externalAccess: blocked · allowedDomains: []", tone: "#64748b" },
      { at: "19 Aug 07:44 UTC", event: "Risk scored", detail: "Automated · 54 of 100, medium band", diff: "", tone: "#a78bfa" },
    ],
    ai: {
      band: "Medium — peer review and one approval",
      factors: [
        { weight: "+22", label: "Opens a new external communication path into the tenant" },
        { weight: "+16", label: "Four required sections are missing, so residual risk is unassessed" },
        { weight: "+9", label: "Data handling standard has not been updated for external chat" },
        { weight: "−13", label: "Scoped to two security groups and four named domains, not tenant-wide" },
      ],
      deps: [
        { from: "Teams external access", to: "Data handling standard v3", tag: "requires", note: "The standard forbids external chat. Update it in the same change or the CR contradicts your own policy.", tone: "#fbbf24" },
        { from: "CMP-009", to: "This change", tag: "closes", note: "Compliance finding stays open until the allow-list is live and evidenced.", tone: "#34d399" },
      ],
      suggested: [
        { text: "Rollback is a one-line revert to externalAccess: blocked with the allow-list emptied. Existing federated threads become read-only rather than disappearing.", action: "Use as plan" },
        { text: "Pilot with one supplier domain and 20 Procurement users for five working days before the full allow-list.", action: "Add to plan" },
        { text: "Attach the updated data handling standard as a dependency so the two land together.", action: "Add to plan" },
      ],
      impact: "Reads the tenant against the proposed payload: 340 users in the two named groups, no anonymous-join settings touched, no guest access change. Four domains resolve to managed Microsoft 365 tenants, which keeps the federation trusted rather than open. The unassessed part is retention — external chat lands in mailboxes covered by a 3-year retention policy, which Procurement has not been told about.",
      impactMeta: "Generated 19 Aug 07:44 from the Graph read and the change payload. Re-runs on every payload edit.",
    },
    linked: [],
  },
  {
    code: "CR-0144",
    title: "Retire the shared Reception mailbox password and move to OAuth",
    workload: "Exchange Online",
    cls: "Standard",
    priority: "Normal",
    risk: "Low",
    state: "In test",
    mc: "",
    chan: "Standard release",
    window: "Thu 20 Aug · 20:00–21:00",
    countdown: "tomorrow",
    accounts: "1 shared mailbox, 6 delegates",
    aiScore: 21,
    rollbackReady: true,
    missing: [],
    short: true,
    desc: "Convert the Reception shared mailbox from a licensed account with a known password to a properly delegated shared mailbox with no sign-in.",
    just: "A shared password held by six people is the finding the security pillar raised as SEC-021, and it also frees one E3 licence.",
    scope: "Reception@haldenmaterials.com · 6 delegates in the Front of House group",
    deps: "None.",
    secImpact: "Removes a shared credential and one interactive sign-in path. Delegation is auditable per user.",
    compImpact: "Closes SEC-021. Evidence filed against the access control standard.",
    pre: '{\n  "recipientTypeDetails": "UserMailbox",\n  "accountEnabled": true,\n  "assignedLicenses": ["ENTERPRISEPACK"]\n}',
    post: '{\n  "recipientTypeDetails": "SharedMailbox",\n  "accountEnabled": false,\n  "assignedLicenses": [],\n  "fullAccess": ["FrontOfHouse"]\n}',
    capturedAt: "17 Aug 10:02 UTC",
    pipe: [
      { name: "Dev", status: "Not provisioned", note: "No development tenant in this contract.", prov: false },
      { name: "Test", status: "Not provisioned", note: "No test tenant. A single-mailbox pilot is the compensating control.", prov: false },
      { name: "Stage", status: "In test", note: "Delegation applied alongside the password until 20 Aug, so both paths work during the overlap.", prov: true, tone: "#60a5fa" },
      { name: "Prod", status: "Scheduled", note: "Sign-in disabled and licence reclaimed in the 20 Aug window.", prov: true, tone: "#fbbf24" },
    ],
    approvals: {
      submitter: { name: "Dana Whitlock", org: "Shane McCaw Consulting · Senior engineer", state: "Submitted 17 Aug 10:15", sig: "sig 1c04·77bb", tone: "#94a3b8" },
      peer: { name: "Shane McCaw", org: "Shane McCaw Consulting · Lead architect", state: "Peer review passed 17 Aug 12:02", sig: "sig 90fe·3a12", tone: "#34d399" },
      approver: { name: "Priya Raman", org: "Halden Materials · IT Director", state: "Approved 17 Aug 16:20 — standard change, pre-authorised class", sig: "sig 2de8·b410", tone: "#34d399" },
    },
    audit: [
      { at: "17 Aug 10:15 UTC", event: "Change request created", detail: "Dana Whitlock · from Security finding SEC-021", diff: "", tone: "#60a5fa" },
      { at: "17 Aug 12:02 UTC", event: "Peer review passed", detail: "Shane McCaw · signature 90fe·3a12", diff: "peerReview: pending → passed", tone: "#34d399" },
      { at: "17 Aug 16:20 UTC", event: "Approved", detail: "Priya Raman · standard change, pre-authorised class", diff: "state: awaiting approval → approved", tone: "#34d399" },
      { at: "18 Aug 09:30 UTC", event: "Delegation applied in overlap mode", detail: "Dana Whitlock · FrontOfHouse granted full access, password still valid", diff: 'fullAccess: [] → ["FrontOfHouse"]', tone: "#60a5fa" },
    ],
    ai: {
      band: "Low — peer review and one approval",
      factors: [
        { weight: "+9", label: "Six delegates depend on the mailbox during business hours" },
        { weight: "+7", label: "Licence reclaim is irreversible within the same billing period" },
        { weight: "−14", label: "Overlap window means both access paths work until cutover" },
      ],
      deps: [
        { from: "Front of House group", to: "Reception mailbox", tag: "delegates", note: "Six members, all licensed. Delegation verified 18 Aug.", tone: "#34d399" },
        { from: "Reception E3 licence", to: "Licence pool", tag: "returns", note: "One seat back. Licensing pillar picks it up on the next scan.", tone: "#2dd4bf" },
      ],
      suggested: [
        { text: "Keep the password valid for 72 hours after delegation so a reception handover does not become an incident.", action: "In the plan" },
        { text: "Reclaim the licence a full billing period after cutover rather than the same night.", action: "Add to plan" },
      ],
      impact: "One mailbox, six delegates, no policy surface touched. The only real exposure is a reception shift that has not been told the shared password is going away.",
      impactMeta: "Generated 17 Aug 10:18 from the Graph read and the change payload.",
    },
    linked: [],
  },
  {
    code: "CR-0136",
    title: "Enforce sensitivity labels on all SharePoint document libraries",
    workload: "SharePoint · Purview",
    cls: "Normal",
    priority: "Normal",
    risk: "High",
    state: "Rolled back",
    mc: "MC1038744",
    chan: "Targeted release",
    window: "Tue 5 Aug · 21:00–23:00",
    countdown: "closed",
    accounts: "212 libraries",
    aiScore: 68,
    rollbackReady: true,
    missing: [],
    short: true,
    desc: "Apply the Confidential default label to every document library and enable mandatory labelling on upload.",
    just: "The compliance pillar cannot evidence data classification without default labels. This was the fastest route to CMP-004.",
    scope: "All 212 SharePoint document libraries · mandatory labelling on upload",
    deps: "Purview label taxonomy v2 published 1 Aug.",
    secImpact: "Improves classification coverage. No permission change.",
    compImpact: "Would have closed CMP-004. Still open after the rollback.",
    pre: '{\n  "defaultLabel": null,\n  "mandatoryLabelling": false\n}',
    post: '{\n  "defaultLabel": "Confidential",\n  "mandatoryLabelling": true\n}',
    capturedAt: "5 Aug 20:55 UTC",
    pipe: [
      { name: "Dev", status: "Not provisioned", note: "No development tenant in this contract.", prov: false },
      { name: "Test", status: "Not provisioned", note: "No test tenant. Two libraries were used as the pilot.", prov: false },
      { name: "Stage", status: "Passed", note: "2 libraries labelled 1–4 Aug with no reported friction. Too small a sample, in hindsight.", prov: true, tone: "#34d399" },
      { name: "Prod", status: "Rolled back", note: "Deployed 5 Aug 21:10, rolled back 6 Aug 08:40 after Sales could not share externally.", prov: true, tone: "#f87171" },
    ],
    approvals: {
      submitter: { name: "Shane McCaw", org: "Shane McCaw Consulting · Lead architect", state: "Submitted 1 Aug 14:20", sig: "sig 55aa·10bd", tone: "#94a3b8" },
      peer: { name: "Dana Whitlock", org: "Shane McCaw Consulting · Senior engineer", state: "Peer review passed 2 Aug 09:10", sig: "sig 71c2·4e09", tone: "#34d399" },
      approver: { name: "Priya Raman", org: "Halden Materials · IT Director", state: "Approved 4 Aug 11:05", sig: "sig 3ba9·d771", tone: "#34d399" },
    },
    audit: [
      { at: "5 Aug 21:10 UTC", event: "Deployed to production", detail: "Dana Whitlock · 212 libraries, 4 batches", diff: 'defaultLabel: null → "Confidential" · mandatoryLabelling: false → true', tone: "#34d399" },
      { at: "6 Aug 08:12 UTC", event: "Monitoring alert", detail: "External sharing failures 41 in 15 minutes, threshold 20", diff: "", tone: "#f87171" },
      { at: "6 Aug 08:31 UTC", event: "Rollback authorised", detail: "Priya Raman · verbal go, logged by Shane McCaw", diff: "", tone: "#fbbf24" },
      { at: "6 Aug 08:40 UTC", event: "Rollback executed", detail: "Dana Whitlock · 4 steps, all validation checks passed", diff: 'defaultLabel: "Confidential" → null · mandatoryLabelling: true → false', tone: "#f87171" },
      { at: "6 Aug 09:15 UTC", event: "Post-rollback state confirmed", detail: "External sharing restored on all 212 libraries. CMP-004 reopened.", diff: "", tone: "#64748b" },
    ],
    ai: {
      band: "High — retrospective on a rolled-back change",
      factors: [
        { weight: "+31", label: "Mandatory labelling blocks upload paths, not just classification" },
        { weight: "+18", label: "Pilot sample was 2 libraries out of 212" },
        { weight: "+12", label: "Label taxonomy had no external-sharing exception defined" },
        { weight: "−9", label: "Rollback was scripted and completed in 9 minutes" },
      ],
      deps: [
        { from: "Confidential label", to: "External sharing policy", tag: "conflicts", note: "The label blocks anonymous links. Sales relies on them for tender documents. This is what broke.", tone: "#f87171" },
        { from: "CMP-004", to: "This change", tag: "reopened", note: "Compliance finding is open again. A per-library approach is the retry route.", tone: "#fbbf24" },
      ],
      suggested: [
        { text: "Retry per library group rather than tenant-wide, starting with Finance and HR where external sharing is already off.", action: "Raise as CR" },
        { text: "Define a General External label with anonymous links permitted before touching Sales libraries.", action: "Raise as CR" },
      ],
      impact: "The rollback held. 212 libraries back to their pre-change state, external sharing confirmed working, no data loss and no labels stranded on documents uploaded during the 11-hour window — those 47 files kept the Confidential label and are listed in the rollback note.",
      impactMeta: "Generated 6 Aug 09:20 from the post-rollback Graph read.",
    },
    linked: [
      { id: "MC1038744", title: "Sensitivity label default behaviour change for SharePoint libraries", note: "Microsoft changed the interaction with anonymous links on 30 July. This is the behaviour the change ran into.", tag: "Root cause", tone: "#f87171" },
    ],
    incidents: [
      { id: "INC-2214", title: "Sales unable to share tender documents externally", note: "41 users, 11 hours, raised 08:12 and closed by the rollback at 08:40. Two tender submissions went out a day late.", tag: "Caused by this change", tone: "#f87171" },
    ],
    pir: {
      outcome: "Failed. The label applied cleanly to all 212 libraries and broke external sharing on every one of them.",
      window: "Yes — deployed 21:10, inside the approved window, by the named engineer.",
      finding: "No. CMP-004 reopened on 6 August and is still open.",
      cost: "11 hours of degraded sharing, 41 users, two late tender submissions, one 9-minute rollback.",
      lessons: [
        { label: "A two-library pilot is not a pilot for a 212-library change", ok: true, meta: "agreed" },
        { label: "Label taxonomy needed an external-sharing exception before enforcement, not after", ok: true, meta: "agreed" },
        { label: "Monitoring caught it in 90 minutes — the alert threshold was right", ok: true, meta: "kept" },
        { label: "The rollback plan was tested and worked exactly as written", ok: true, meta: "kept" },
        { label: "Sales was never asked how they share tender documents", ok: false, meta: "action" },
      ],
      next: "Retry per library group, Finance and HR first where external sharing is already off, and define a General External label with anonymous links permitted before Sales libraries are touched. Not during the ERP freeze.",
      signed: "Reviewed 11 August by Shane McCaw and Dana Whitlock. Priya Raman signed the retrospective on 12 August.",
    },
  },
  {
    code: "CR-0151",
    title: "Remove the transport rule that was queueing all inbound external mail",
    workload: "Exchange Online",
    cls: "Emergency",
    priority: "Emergency",
    risk: "High",
    state: "Emergency · retro approval due",
    mc: "",
    chan: "",
    window: "18 Aug · 02:14, unplanned",
    countdown: "8h left to document",
    accounts: "All inbound mail · 1,240 mailboxes",
    aiScore: 61,
    rollbackReady: true,
    missing: ["test", "pir"],
    short: true,
    desc: 'Disable the transport rule "Quarantine unauthenticated senders" that was queueing every inbound external message, and release the 4,100 messages held behind it.',
    just: "All inbound external mail stopped at 01:34. The rule had been edited by a Microsoft-side connector template change and was matching every unauthenticated hop, not just failures.",
    scope: "Halden Materials tenant · all inbound mail flow",
    deps: "Raised from INC-2231. No dependent changes.",
    secImpact: "Removes an anti-spoofing control until it is rebuilt correctly. Accepted for the duration of the incident and recorded as a temporary risk.",
    compImpact: "Emergency change under your change policy. Requires retrospective approval inside 24 hours and a PIR inside 48.",
    pre: '{\n  "rule": "Quarantine unauthenticated senders",\n  "state": "Enabled",\n  "queued": 4100\n}',
    post: '{\n  "rule": "Quarantine unauthenticated senders",\n  "state": "Disabled",\n  "queued": 0,\n  "released": 4100\n}',
    capturedAt: "18 Aug 02:12 UTC",
    impact: {
      func: "Inbound external mail flows again. Anti-spoof quarantine is off until the rule is rebuilt.",
      user: "Every user was affected for 40 minutes. 4,100 messages released, none lost.",
      ops: "The rule has to be rebuilt against the new connector template before it goes back on — that is CR-0152, drafted.",
      outage: "The outage was already live. This change ended it.",
      comms: "Yes — sent at 02:30 to all users and to Priya Raman by SMS.",
      downtime: "No further downtime.",
    },
    rollback: {
      post: "The rule re-enabled as it stands, which reinstates the outage. Only meaningful if disabling it turns out not to be the cause.",
      eng: "Dana Whitlock · Shane McCaw Consulting",
      steps: [
        { text: "Re-enable the transport rule.", mono: 'Set-TransportRule -Identity "Quarantine unauthenticated senders" -Enabled $true', owner: "~1 min" },
        { text: "Confirm the queue behaviour returns, then escalate to Microsoft support with the message trace.", mono: "", owner: "~10 min" },
      ],
      checks: [
        { label: "Inbound test message from an external domain delivers", ok: true, meta: "scripted" },
        { label: "Queue depth returns to zero", ok: true, meta: "scripted" },
        { label: "Message trace attached to the incident", ok: true, meta: "manual" },
      ],
    },
    pipe: [
      { name: "Dev", status: "Not provisioned", note: "No development tenant in this contract.", prov: false },
      { name: "Test", status: "Skipped", note: "Emergency change during a live outage. The skip is recorded, not implied.", prov: false },
      { name: "Stage", status: "Skipped", note: "No staging on an emergency. This is what the retrospective review is for.", prov: true, tone: "#f87171" },
      { name: "Prod", status: "Deployed 02:14", note: "Mail flow restored 02:16. Verified at 02:20 and again at 09:00.", prov: true, tone: "#34d399" },
    ],
    approvals: {
      submitter: { name: "Dana Whitlock", org: "Shane McCaw Consulting · senior engineer, on call", state: "Raised 02:12 during INC-2231", sig: "sig e410·77c2", tone: "#94a3b8" },
      peer: { name: "Shane McCaw", org: "Shane McCaw Consulting · lead architect", state: "Verbal peer review 02:13, logged at 02:21", sig: "sig 0c9d·41ab", tone: "#34d399" },
      approver: { name: "Priya Raman", org: "Halden Materials · IT Director", state: "Retrospective approval outstanding — 8 hours left", sig: "no signature on file", tone: "#f87171" },
    },
    deploy: {
      window: "Unplanned · 18 August 02:14, during INC-2231",
      people: "Dana Whitlock executing · Shane McCaw verbal authority · Priya Raman notified by SMS at 02:30",
      monitor: "Queue depth and inbound delivery watched continuously to 03:00, then at the 09:00 business-open check.",
      steps: [
        { text: "Capture the rule state and the queue depth before touching anything.", mono: "Get-TransportRule | Export-Clixml", owner: "02:12" },
        { text: "Disable the rule.", mono: 'Set-TransportRule -Identity "Quarantine unauthenticated senders" -Enabled $false', owner: "02:14" },
        { text: "Release the held messages in batches of 500.", mono: "Release-QuarantineMessage -Identity <id>", owner: "02:16" },
        { text: "Notify all users and the IT Director, and open the follow-up CR to rebuild the rule.", mono: "", owner: "02:30" },
      ],
      postval: [
        { label: "Inbound external mail delivers end to end", ok: true, meta: "verified 02:16" },
        { label: "All 4,100 held messages released, none lost", ok: true, meta: "verified 02:41" },
        { label: "Business-open check at 09:00 clear", ok: true, meta: "verified" },
        { label: "Follow-up CR raised to rebuild the rule", ok: false, meta: "CR-0152 drafted, not submitted" },
      ],
    },
    audit: [
      { at: "18 Aug 01:34 UTC", event: "Incident INC-2231 opened", detail: "Automated · inbound mail queue depth alert", diff: "", tone: "#f87171" },
      { at: "18 Aug 02:12 UTC", event: "Emergency change raised", detail: "Dana Whitlock · pre-change state captured before any action", diff: "rule.state: Enabled · queued: 4100", tone: "#fbbf24" },
      { at: "18 Aug 02:13 UTC", event: "Verbal peer review", detail: "Shane McCaw · logged at 02:21 with the reason for the verbal path", diff: "", tone: "#34d399" },
      { at: "18 Aug 02:14 UTC", event: "Deployed under emergency authority", detail: "Dana Whitlock · transport rule disabled", diff: "rule.state: Enabled → Disabled", tone: "#34d399" },
      { at: "18 Aug 02:41 UTC", event: "4,100 messages released", detail: "Dana Whitlock · 9 batches, none lost", diff: "queued: 4100 → 0", tone: "#34d399" },
      { at: "18 Aug 09:02 UTC", event: "Retrospective approval requested", detail: "Priya Raman notified · 24-hour clock started at 02:14", diff: "", tone: "#fbbf24" },
    ],
    ai: {
      band: "High — emergency path, retrospective approval required",
      factors: [
        { weight: "+24", label: "Anti-spoofing control removed and not yet rebuilt" },
        { weight: "+18", label: "No test or staging evidence — emergency path" },
        { weight: "+13", label: "Follow-up CR to restore the control is drafted, not submitted" },
        { weight: "−16", label: "Pre-change state captured before the change, so the rollback is exact" },
      ],
      deps: [
        { from: "INC-2231", to: "This change", tag: "caused", note: "The incident is the reason the emergency path was used. Closed at 02:45.", tone: "#f87171" },
        { from: "Anti-spoof quarantine", to: "CR-0152", tag: "owes", note: "The control stays off until the rule is rebuilt against the new connector template.", tone: "#fbbf24" },
      ],
      suggested: [
        { text: "Submit CR-0152 to rebuild the rule before the retrospective review, so the review has a fix to approve rather than a gap to note.", action: "Raise as CR" },
        { text: "Record the removed anti-spoof control as a temporary accepted risk with an expiry date, not an open-ended gap.", action: "Add to plan" },
      ],
      impact: "Mail flow restored in two minutes. The residual exposure is the anti-spoofing rule being off across all 1,240 mailboxes, which widens the phishing surface until CR-0152 lands. Nothing else in the tenant changed.",
      impactMeta: "Generated 18 Aug 02:20 from the pre-change capture and the message trace.",
    },
    linked: [],
    incidents: [
      { id: "INC-2231", title: "All inbound external mail queued for 40 minutes", note: "Opened 01:34 by the queue-depth alert, closed 02:45. This change is what closed it.", tag: "Caused this change", tone: "#f87171" },
    ],
  },
];

/** proto FREEZE — the active ERP go-live freeze. */
export const CC_FREEZE: FreezeDef = {
  label: "ERP go-live freeze",
  range: "Mon 24 – Fri 28 August",
  from: 24,
  to: 28,
  owner: "Priya Raman · Halden Materials IT Director",
  reason: "Halden Materials cuts over to the new ERP on 24 August. Every order, invoice and licence lookup runs through it that week, and nothing in the tenant changes until Finance signs off the first close.",
  policy: "Emergency changes only, and only with a written exception from the freeze owner. A normal change inside the freeze cannot be approved — it moves or it waits.",
};

/** proto MSC — the two Microsoft Message Center changes landing in the window. */
export const CC_MSC: readonly McChange[] = [
  {
    id: "MC1049877",
    title: 'OneDrive and SharePoint default sharing link becomes "people with existing access"',
    group: "Saturday 22 August",
    groupSub: "Microsoft rolls it out · your opt-out closes Friday 21",
    time: "22 Aug",
    timeSub: "rollout begins",
    day: 22,
    optOut: 21,
    tone: "#fbbf24",
    state: "Opt-out closes in 2 days",
    impact: "High tenant impact",
    sentence: [
      ["Microsoft", "who"],
      [" is ", ""],
      ["changing the default sharing link on every SharePoint and OneDrive site", "what"],
      [" from ", ""],
      ["Saturday 22 August", "when"],
      [" in ", ""],
      ["your production tenant,", "where"],
      ["whether the change is approved here or not — and your opt-out closes on Friday.", ""],
    ],
    why: 'Microsoft is tightening a default that most tenants never set. Halden has 212 libraries relying on "anyone with the link" for tender documents, so this lands on the same surface CR-0136 already broke once.',
    how: [
      { call: "sharingCapability default → existingAccess", result: "new links default to people who already have access" },
      { call: "Set-SPOTenant -DefaultSharingLinkType Internal", result: "the opt-out, available until 21 Aug" },
    ],
    ifWrong: "There is no rollback after the 22nd — only a tenant setting you re-apply afterwards, and every link created in between keeps the new behaviour. Deciding before Friday is the whole difference.",
    whereNote: "Your tenant, on Microsoft's schedule. No approval path, no freeze protection.",
    linkedCr: "Raise a CR to set the default deliberately",
  },
  {
    id: "MC1051144",
    title: "Teams anonymous meeting join default flips to allowed",
    group: "Wednesday 26 August",
    groupSub: "inside your freeze · Microsoft does not observe it",
    time: "26 Aug",
    timeSub: "rollout begins",
    day: 26,
    optOut: 0,
    tone: "#f87171",
    state: "No opt-out",
    impact: "Medium tenant impact",
    sentence: [
      ["Microsoft", "who"],
      [" is ", ""],
      ["flipping anonymous meeting join to allowed on your Teams meeting policy", "what"],
      [" on ", ""],
      ["Wednesday 26 August", "when"],
      [" — ", ""],
      ["four days into your ERP go-live freeze,", "where"],
      ["because Microsoft does not observe your freeze and never has.", ""],
    ],
    why: "It changes who can join a meeting without signing in. Your compliance pillar counts anonymous join as an external-access control, so this moves a control you are audited on, during the week you had chosen to change nothing.",
    how: [{ call: "allowAnonymousUsersToJoinMeeting → true", result: "tenant default only; an explicit policy value survives" }],
    ifWrong: "Set the value explicitly before the 26th and the rollout cannot touch it. Do nothing and you find out at the audit, not at the change.",
    whereNote: "Your tenant, mid-freeze. A freeze binds your engineers, not Microsoft.",
    linkedCr: "Raise a CR to pin the value before the 26th",
  },
];

/** proto CATALOGUE — the 24 pre-approved standard changes. */
export const CC_CATALOGUE: readonly CatalogueItem[] = [
  { cat: "Mail", name: "Add a shared mailbox", n: 14, runs: "14 raised in 30 days", what: "Creates the mailbox, applies delegation from a named group, consumes no licence.", who: "Your IT team, or ours", window: "Any time · no window needed", approval: "Pre-approved · no peer review", guard: "Refused if the name collides with an existing distribution list or mailbox." },
  { cat: "Identity", name: "Onboard a user", n: 23, runs: "23 raised in 30 days", what: "Creates the account, assigns the licence pack for the named role, enrols MFA, adds the standard groups.", who: "Your IT team, or ours", window: "Any time · no window needed", approval: "Pre-approved · no peer review", guard: "Refused if the licence pool has no seat left — that becomes a Normal change instead." },
  { cat: "Identity", name: "Offboard a user", n: 9, runs: "9 raised in 30 days", what: "Revokes sessions, converts the mailbox to shared, hands OneDrive to the manager, reclaims the licence after 30 days.", who: "Your IT team, or ours", window: "Any time · no window needed", approval: "Pre-approved · HR reference required on the request", guard: "Licence reclaim is held 30 days and logged, not immediate." },
  { cat: "Licensing", name: "Add or remove a licence", n: 31, runs: "31 raised in 30 days", what: "Assigns or releases a licence against an existing account, with the cost delta shown before it runs.", who: "Your IT team, or ours", window: "Any time · no window needed", approval: "Pre-approved under 10 seats · above that it becomes a Normal change", guard: "Above 10 seats it routes to the full path because it changes your bill." },
  { cat: "Identity", name: "Reset MFA for a user", n: 17, runs: "17 raised in 30 days", what: "Clears the registered methods and forces re-enrolment at next sign-in.", who: "Your IT team, or ours", window: "Any time · no window needed", approval: "Pre-approved · identity check recorded on the request", guard: "The person who verified identity is named on the record. No name, no run." },
  { cat: "Files", name: "Restore a deleted file, site or mailbox item", n: 6, runs: "6 raised in 30 days", what: "Restores from the retention hold to the original location, or to a staging library if the original is gone.", who: "Your IT team, or ours", window: "Any time · no window needed", approval: "Pre-approved · no peer review", guard: "Restores outside the retention period route to a Normal change with a cost estimate." },
  { cat: "Identity", name: "Add a user to a security group", n: 44, runs: "44 raised in 30 days", what: "Adds an existing account to a named group. Groups that grant admin rights are excluded.", who: "Your IT team, or ours", window: "Any time · no window needed", approval: "Pre-approved · no peer review", guard: "Refused for any group that carries a privileged role or a Conditional Access exclusion." },
  { cat: "Identity", name: "Unlock an account", n: 12, runs: "12 raised in 30 days", what: "Clears the lockout and records who verified the person.", who: "Your IT team, or ours", window: "Any time", approval: "Pre-approved · identity check recorded", guard: "Three unlocks in seven days routes to a Normal change and a look at why." },
  { cat: "Identity", name: "Extend a guest account", n: 5, runs: "5 raised in 30 days", what: "Pushes the expiry out by a named period with the sponsor recorded.", who: "Your IT team, or ours", window: "Any time", approval: "Pre-approved up to 90 days", guard: "Beyond 90 days it becomes a Normal change with the sponsor named on it." },
  { cat: "Mail", name: "Add an email alias", n: 19, runs: "19 raised in 30 days", what: "Adds a proxy address to an existing mailbox on a verified domain.", who: "Your IT team, or ours", window: "Any time", approval: "Pre-approved · no peer review", guard: "Refused on unverified domains and on anything that collides with an existing address." },
  { cat: "Mail", name: "Set an out-of-office on someone else's mailbox", n: 4, runs: "4 raised in 30 days", what: "Sets the automatic reply on a mailbox where the owner is unreachable.", who: "Your IT team, or ours", window: "Any time", approval: "Pre-approved · manager reference on the request", guard: "The manager who asked is named on the record." },
  { cat: "Mail", name: "Release a quarantined message", n: 27, runs: "27 raised in 30 days", what: "Releases a specific message to the recipient and records the verdict it was held under.", who: "Your IT team, or ours", window: "Any time", approval: "Pre-approved · except for malware verdicts", guard: "Malware and high-confidence phish are refused and route to the security path." },
  { cat: "Mail", name: "Add a mail contact", n: 3, runs: "3 raised in 30 days", what: "Creates an external contact in the directory so it appears in the address book.", who: "Your IT team, or ours", window: "Any time", approval: "Pre-approved", guard: "Personal mail domains are flagged on the record." },
  { cat: "Files", name: "Create a SharePoint site from a template", n: 8, runs: "8 raised in 30 days", what: "Provisions a site from an approved template with the standard retention and sharing settings applied.", who: "Your IT team, or ours", window: "Any time", approval: "Pre-approved for approved templates only", guard: "A site outside the template set is a Normal change." },
  { cat: "Files", name: "Grant access to a site or library", n: 22, runs: "22 raised in 30 days", what: "Adds a person or group to an existing permission level. External parties are excluded.", who: "Your IT team, or ours", window: "Any time", approval: "Pre-approved · site owner reference required", guard: "Refused for anything external, and for sites marked sensitive." },
  { cat: "Files", name: "Increase a site storage quota", n: 2, runs: "2 raised in 30 days", what: "Raises the quota on an existing site within the tenant pool.", who: "Your IT team, or ours", window: "Any time", approval: "Pre-approved under 500 GB", guard: "Above 500 GB or outside the pool becomes a Normal change with a cost line." },
  { cat: "Teams", name: "Create a Team from a template", n: 11, runs: "11 raised in 30 days", what: "Creates the Team with two named owners, standard channels and the retention label applied.", who: "Your IT team, or ours", window: "Any time", approval: "Pre-approved · two owners required", guard: "Refused with fewer than two owners." },
  { cat: "Teams", name: "Add a guest to a Team", n: 7, runs: "7 raised in 30 days", what: "Invites an external person into an existing Team with the sponsor recorded.", who: "Your IT team, or ours", window: "Any time", approval: "Pre-approved · sponsor named", guard: "Refused for personal mail domains and for Teams marked sensitive." },
  { cat: "Teams", name: "Archive a Team", n: 3, runs: "3 raised in 30 days", what: "Archives the Team and sets its site read-only. Content stays searchable and restorable.", who: "Your IT team, or ours", window: "Any time", approval: "Pre-approved · owner notified", guard: "Teams with guests or private channels route to a Normal change." },
  { cat: "Devices", name: "Wipe a lost or stolen device", n: 2, runs: "2 raised in 30 days", what: "Issues a remote wipe and records who authorised it.", who: "Your IT team, or ours", window: "Immediate", approval: "Pre-approved · manager or owner authorisation recorded", guard: "Personal devices get a selective wipe, not a full one." },
  { cat: "Devices", name: "Enrol a replacement device", n: 15, runs: "15 raised in 30 days", what: "Enrols the device, applies the compliance policy and restores the user's app set.", who: "Your IT team, or ours", window: "Any time", approval: "Pre-approved", guard: "Refused if the old device is still active and unassigned." },
  { cat: "Devices", name: "Retire a device record", n: 6, runs: "6 raised in 30 days", what: "Removes the stale record after the device has stopped syncing for 90 days.", who: "Your IT team, or ours", window: "Any time", approval: "Pre-approved after 90 days of no sync", guard: "Anything still syncing is refused." },
  { cat: "Licensing", name: "Move a user between licence packs", n: 13, runs: "13 raised in 30 days", what: "Swaps the pack, keeping the mailbox and OneDrive intact, and shows the cost delta first.", who: "Your IT team, or ours", window: "Any time", approval: "Pre-approved when the delta is under $100 a month", guard: "A downgrade that would drop a service in use is refused with the list." },
  { cat: "Licensing", name: "Release licences from disabled accounts", n: 4, runs: "4 raised in 30 days", what: "Reclaims licences from accounts disabled more than 30 days, converting mailboxes to shared first.", who: "Ours", window: "Any time", approval: "Pre-approved · monthly batch", guard: "Accounts on legal hold are skipped and listed." },
];

/** proto CAT_PROMOTE — the candidate the catalogue proposes promoting. */
export const CC_CAT_PROMOTE = {
  name: "Add a guest to a Team",
  note: "Raised as a Normal change four times in the last 60 days, approved every time, never rolled back. That is a standard change wearing the wrong hat.",
  gain: "Promoting it drops the peer review and the window, and cuts about three days off each request.",
} as const;

/** proto FREEZES — the freeze calendar's declared freezes. */
export const CC_FREEZES: readonly FreezeRow[] = [
  { name: "ERP go-live freeze", range: "24 – 28 August", state: "Active in 5 days", owner: "Priya Raman", scope: "Whole tenant", emergencies: "Exempt, with the freeze owner's written approval", tone: "#f87171", start: "2026-08-24", end: "2026-08-28" },
  { name: "Quarter close", range: "29 – 30 September", state: "Scheduled", owner: "Priya Raman", scope: "Exchange Online, SharePoint, licensing", emergencies: "Exempt", tone: "#fbbf24", start: "2026-09-29", end: "2026-09-30" },
  { name: "Year end", range: "22 December – 2 January", state: "Scheduled · recurring", owner: "Priya Raman", scope: "Whole tenant", emergencies: "Exempt, with a written approval and a PIR inside 48 hours", tone: "#fbbf24", start: "2026-12-22", end: "2027-01-02" },
];

/** proto NOTIF — the policy view's notification rules. */
export const CC_NOTIF: readonly NotifRule[] = [
  { event: "Microsoft enforcement date approaching", channel: "Email · Teams", to: "Priya Raman, IT team", lead: "30 days ahead, then 7, then 1", on: true },
  { event: "Message Center post with tenant impact", channel: "Email", to: "Priya Raman", lead: "Within 4 hours of publication", on: true },
  { event: "Change request awaiting your signature", channel: "Email", to: "The named approver", lead: "Daily until signed", on: true },
  { event: "Change deployed, or rolled back", channel: "Teams · #m365-changes", to: "IT team", lead: "Immediately", on: true },
  { event: "Freeze starts or ends", channel: "Email · Teams", to: "Everyone with tenant access", lead: "3 days ahead", on: true },
  { event: "Emergency change raised", channel: "SMS · Teams", to: "Priya Raman, Shane McCaw", lead: "Immediately", on: true },
  { event: "Post-implementation review overdue", channel: "Email", to: "The change owner", lead: "5 days after deployment", on: false },
];

/** proto CAB — the change review (CAB) content. */
export const CC_CAB = {
  next: { when: "Thursday 21 August · 15:00–15:30 UTC", where: "Teams · recurring weekly", chair: "Shane McCaw", attendees: "Priya Raman · Dana Whitlock · Marcus Bell (Procurement, for CR-0147)" },
  agenda: [
    { code: "CR-0151", item: "Retrospective approval and PIR for the 02:14 emergency change", mins: "5 min" },
    { code: "MC1049877", item: "Decide the OneDrive sharing default before Microsoft decides it on Friday", mins: "10 min" },
    { code: "CR-0142", item: "Approve for 25 August, or move it out of the ERP freeze", mins: "8 min" },
    { code: "CR-0147", item: "Procurement to confirm the four supplier domains", mins: "5 min" },
    { code: "CR-0136", item: "Retry approach for sensitivity labels, per library group", mins: "5 min" },
  ] as AgendaItem[],
  last: {
    when: "Thursday 14 August",
    decisions: [
      "CR-0144 approved as a standard change, cutover 20 August.",
      "ERP go-live freeze declared for 24–28 August. Priya Raman owns it, emergencies exempt with written approval.",
      "The sensitivity label retry is deferred until after the ERP cutover — no second attempt during go-live.",
      "Post-implementation reviews become a standing agenda item after the CR-0136 rollback went unreviewed for a week.",
    ],
  },
};

/** proto CONFLICTS — collisions detected on the briefing timeline. */
export const CC_CONFLICTS: readonly Conflict[] = [
  { a: "CR-0136 retry", b: "MC1049877", surface: "SharePoint and OneDrive sharing defaults", tone: "#fbbf24", note: "Both touch the sharing surface within a fortnight. Retrying the labels before Microsoft's new default lands means testing against a default that is about to change underneath you." },
  { a: "CR-0147", b: "MC1051144", surface: "Teams external and anonymous access", tone: "#f87171", note: "The CR opens federation to four supplier domains in the same week Microsoft flips anonymous join to allowed. Approved as they stand, two external-access controls move at once and neither change can be blamed cleanly." },
];

/** proto DECISIONS — the decisions-due set the stat card lists. */
export const CC_DECISIONS: readonly Decision[] = [
  { code: "CR-0151", label: "Retrospectively approve the emergency change", due: "Today · 8 hours left", tone: "#f87171", cons: "An emergency change without a retrospective approval inside 24 hours is an audit finding, and the transport rule stays undocumented." },
  { code: "MC1049877", label: "Decide the OneDrive sharing default", due: "Friday 21 August", tone: "#fbbf24", cons: "Microsoft applies its own default on the 22nd, and every link created after that keeps the new behaviour whether you meant it or not." },
  { code: "CR-0142", label: "Sign CR-0142, or move it out of the freeze", due: "Before Monday 24 August", tone: "#fbbf24", cons: "The 25 August window sits inside the ERP freeze. Miss it and the next window is 1 September — four weeks out from Microsoft turning legacy auth off for you." },
  { code: "CR-0136", label: "Complete the post-implementation review", due: "Overdue by 8 days", tone: "#f87171", cons: "A rolled-back change with no recorded lesson. CMP-004 is still open and the retry has nothing to learn from." },
  { code: "CR-0147", label: "Confirm the four supplier domains", due: "No date set", tone: "#94a3b8", cons: "Procurement owes the list. Until it lands the CR cannot be assessed and CMP-009 stays open." },
];

/** proto MSC_TRAY — the off-timeline Microsoft item. */
export const CC_MSC_TRAY = {
  id: "MC1042318",
  label: "Basic auth permanently disabled · 1 October · CR-0142 already gets ahead of it",
  tone: "#f87171",
} as const;

/** proto WINDOW_DAY — the briefing gantt day each scheduled CR lands on. */
export const CC_WINDOW_DAY: Record<string, number> = { "CR-0142": 25, "CR-0144": 20, "CR-0151": 18 };

/** proto BRIEFS — the who/what/when/where/why/how briefing sentences per CR. */
export const CC_BRIEFS: Record<string, BriefDef> = {
  "CR-0151": {
    group: "Tuesday 18 August",
    groupSub: "already ran · retrospective approval due today",
    time: "02:14",
    timeSub: "unplanned",
    who: "Dana Whitlock",
    whoOrg: "Shane McCaw Consulting · on call, verbal authority from Shane McCaw",
    init: "DW",
    where: "Production",
    whereNote: "No test, no staging, no window — an emergency change, and the skip is on the record",
    sentence: [
      ["Dana Whitlock", "who"],
      [" already ", ""],
      ["disabled the transport rule that was queueing every inbound external message", "what"],
      [" at ", ""],
      ["02:14 on Tuesday", "when"],
      [" in ", ""],
      ["production,", "where"],
      ["because mail flow had been down for 40 minutes and the rule was matching every unauthenticated hop.", ""],
    ],
    why: "INC-2231. All inbound external mail stopped at 01:34 after a Microsoft connector template change altered how the rule matched. This change is what ended the outage.",
    how: [
      { call: 'Set-TransportRule "Quarantine unauthenticated senders" -Enabled $false', result: "mail flow restored at 02:16" },
      { call: "Release-QuarantineMessage · 9 batches", result: "4,100 messages released, none lost" },
    ],
    ifWrong: "Re-enabling the rule reinstates the outage, so the real risk is the other way: anti-spoof quarantine is off across 1,240 mailboxes until CR-0152 rebuilds it, and CR-0152 is still a draft.",
  },
  "CR-0144": {
    group: "Thursday 20 August",
    groupSub: "tomorrow · inside your Tue–Thu window",
    time: "20:00",
    timeSub: "UTC · 1 hour",
    who: "Dana Whitlock",
    whoOrg: "Shane McCaw Consulting · senior engineer",
    init: "DW",
    where: "Production",
    whereNote: "No dev or test tenant — a 72-hour overlap is the compensating control",
    sentence: [
      ["Dana Whitlock", "who"],
      [" is ", ""],
      ["switching the Reception mailbox off its shared password", "what"],
      [" on ", ""],
      ["Thursday at 20:00", "when"],
      [" in ", ""],
      ["production,", "where"],
      ["because six people know that password and every one of them is a way in.", ""],
    ],
    why: "Six people share one password on a licensed mailbox. That is finding SEC-021, and it also frees an E3 seat.",
    how: [
      { call: "Set-Mailbox -Identity Reception -Type Shared", result: "UserMailbox → SharedMailbox" },
      { call: 'PATCH /v1.0/users/{id} { "accountEnabled": false }', result: "interactive sign-in removed" },
      { call: "Add-MailboxPermission -User FrontOfHouse -AccessRights FullAccess", result: "6 delegates, auditable per user" },
    ],
    ifWrong: "Re-enable the account and restore the password from the vault. Nine minutes, scripted, and the delegation stays in place either way.",
  },
  "CR-0142": {
    group: "Tuesday 25 August",
    groupSub: "in 5 days · waiting on one signature",
    time: "21:00",
    timeSub: "UTC · 2 hours",
    who: "Dana Whitlock",
    whoOrg: "Dana Whitlock executing · Shane McCaw on call",
    init: "DW",
    where: "Production",
    whereNote: "Validated in a report-only ring and a 25-account pilot instead of a test tenant",
    sentence: [
      ["Dana Whitlock", "who"],
      [" is ", ""],
      ["turning off legacy authentication across all 1,240 mailboxes", "what"],
      [" on ", ""],
      ["Tuesday at 21:00", "when"],
      [" in ", ""],
      ["production,", "where"],
      ["because two service accounts were password-sprayed in July over IMAP — and Microsoft turns it off for you on 1 October regardless.", ""],
    ],
    why: "Nine of the 41 open Copilot gate items trace back to legacy auth being reachable. Doing it in a window is the difference between a change and an outage.",
    how: [
      { call: 'PATCH /identity/conditionalAccess/policies/CA-014 { "state": "enabled" }', result: "CA-014 enforced tenant-wide" },
      { call: "Set-AuthenticationPolicy -AllowBasicAuth* $false", result: "POP, IMAP, SMTP AUTH, ActiveSync closed" },
    ],
    ifWrong: "CA-014 goes to report-only rather than being deleted, protocols come back on, and the Bay 3 scanners get an interim policy. Under ten minutes, tested.",
  },
  "CR-0147": {
    group: "Not scheduled",
    groupSub: "cannot be scheduled — four required sections are empty",
    time: "—",
    timeSub: "no window",
    who: "Nobody yet",
    whoOrg: "Drafted by Priya Raman · no engineer assigned",
    init: "—",
    where: "Production",
    whereNote: "No pilot ring defined yet",
    sentence: [
      ["Nobody", "who"],
      [" is scheduled to ", ""],
      ["open Teams federation to four supplier domains", "what"],
      [" — ", ""],
      ["no window,", "when"],
      ["because the record still owes an impact assessment, a rollback plan, a test plan and a deployment plan.", ""],
    ],
    why: "Procurement runs supplier calls over personal WhatsApp because federation is closed. That is the leak path compliance raised as CMP-009.",
    how: [{ call: "externalAccess: blocked → allowList", result: "4 named domains, 2 security groups" }],
    ifWrong: "Unknown — that is the point. No rollback plan on the record, so this cannot be approved.",
  },
  "CR-0136": {
    group: "Closed · 6 August",
    groupSub: "deployed, then rolled back in nine minutes",
    time: "08:40",
    timeSub: "rolled back",
    who: "Dana Whitlock",
    whoOrg: "Shane McCaw Consulting · authorised by Priya Raman",
    init: "DW",
    where: "Production",
    whereNote: "Pilot was 2 libraries out of 212 — too small a sample",
    sentence: [
      ["Dana Whitlock", "who"],
      [" rolled back ", ""],
      ["mandatory sensitivity labels on 212 SharePoint libraries", "what"],
      [" on ", ""],
      ["6 August at 08:40", "when"],
      [" in ", ""],
      ["production,", "where"],
      ["because the Confidential label blocked the anonymous links Sales uses for tenders.", ""],
    ],
    why: "CMP-004 needed evidence of data classification. The label delivered it and broke external sharing at the same time.",
    how: [
      { call: 'defaultLabel: "Confidential" → null', result: "external sharing restored on 212 libraries" },
      { call: "mandatoryLabelling: true → false", result: "47 files keep the label, listed in the rollback note" },
    ],
    ifWrong: "It already did. The rollback held, no data was lost, and the retry route is per library group starting with Finance and HR.",
  },
};

/** proto SECS — the 11 record sections. */
export const CC_SECS: readonly SecDef[] = [
  { key: "request", num: "01", label: "Request", intro: "What is being changed, why, and who it touches. Filled at intake.", req: true },
  { key: "impact", num: "02", label: "Impact assessment", intro: "Functional, user and operational impact, outage risk, and whether comms or downtime are needed.", req: true },
  { key: "rollback", num: "03", label: "Rollback plan", intro: "The steps that put the tenant back, who runs them, and how you prove it worked.", req: true },
  { key: "approvals", num: "04", label: "Approval workflow", intro: "Submitter, peer reviewer and approver. The approver cannot be the submitter — the record enforces it.", req: true },
  { key: "test", num: "05", label: "Testing and validation", intro: "The test plan, where it ran, the evidence, and the pass or fail verdict.", req: true },
  { key: "env", num: "06", label: "Environment separation", intro: "Dev, test, stage and production. Stages this tenant does not have are recorded as not provisioned, with the compensating control named.", req: false },
  { key: "deploy", num: "07", label: "Deployment plan", intro: "The steps that run, the window they run in, who is on it, and what is watched afterwards.", req: true },
  { key: "audit", num: "08", label: "Audit log", intro: "Every lifecycle event with a timestamp, an actor and the diff. Append-only.", req: false },
  { key: "release", num: "09", label: "Release coordination", intro: "Release channel and the Microsoft Message Center posts this change is tied to.", req: false },
  { key: "ai", num: "10", label: "AI change planning", intro: "Automated risk scoring, dependency graphing and impact analysis, re-run on every payload edit.", req: false },
  { key: "pir", num: "11", label: "Post-implementation review", intro: "After it ran: did it do what it was for, what did it cost, and what does the next change learn from it.", req: false },
];

/** proto CAL_EVENTS — the freeze-calendar day markers. */
export const CC_CAL_EVENTS: Record<string, ReadonlyArray<{ label: string; tone: string }>> = {
  "2026-08-18": [{ label: "CR-0151 window", tone: "#60a5fa" }],
  "2026-08-20": [{ label: "CR-0144 window", tone: "#60a5fa" }],
  "2026-08-25": [{ label: "CR-0142 window · inside the freeze", tone: "#f87171" }],
  "2026-08-26": [{ label: "MC1051144 lands · Microsoft, not yours", tone: "#a78bfa" }],
  "2026-09-15": [{ label: "CR-0148 window", tone: "#60a5fa" }],
  "2026-10-01": [{ label: "Basic auth disabled · Microsoft", tone: "#a78bfa" }],
};

export const CC_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Briefing gantt calendar — 17–31 Aug, 15 columns (proto DAYS). */
export const CC_DAYS: ReadonlyArray<{ d: number; w: string }> = [
  { d: 17, w: "M" }, { d: 18, w: "T" }, { d: 19, w: "W" }, { d: 20, w: "T" }, { d: 21, w: "F" },
  { d: 22, w: "S" }, { d: 23, w: "S" }, { d: 24, w: "M" }, { d: 25, w: "T" }, { d: 26, w: "W" },
  { d: 27, w: "T" }, { d: 28, w: "F" }, { d: 29, w: "S" }, { d: 30, w: "S" }, { d: 31, w: "M" },
];
export const CC_WIN_DAYS = [18, 19, 20, 25, 26, 27];
export const CC_BLACKOUT = [28, 29, 30, 31];
export const CC_TODAY = 19;

/** proto GANTT — the CR bar geometry on the briefing timeline (1-indexed columns over 15). */
export const CC_GANTT: Record<string, { start: number; span: number; label: string; phase: { start: number; span: number; label: string } | null }> = {
  "CR-0151": { start: 2, span: 1, label: "deployed 02:14 · emergency", phase: null },
  "CR-0142": { start: 9, span: 1, label: "21:00 · 2h enforcement window", phase: { start: 1, span: 2, label: "pilot ring, 25 accounts" } },
  "CR-0144": { start: 4, span: 1, label: "20:00 · cutover", phase: { start: 2, span: 2, label: "password + delegation overlap" } },
};

/** proto MSG — the Microsoft-row bar geometry on the briefing timeline. */
export const CC_MSG: Record<string, { start: number; span: number; label: string; phase: { start: number; span: number; label: string } | null }> = {
  MC1049877: { start: 6, span: 1, label: "rollout begins", phase: { start: 1, span: 5, label: "opt-out window closes 21 Aug" } },
  MC1051144: { start: 10, span: 1, label: "rollout begins · mid-freeze", phase: null },
};

/** proto viewTabs — the five sub-views. The record view is opened from within, not a tab. */
export const CC_VIEW_TABS: ReadonlyArray<{ key: string; label: string; sub: string }> = [
  { key: "briefing", label: "Briefing", sub: "who · what · when · where · why · how" },
  { key: "register", label: "Register", sub: "every CR, filterable" },
  { key: "catalogue", label: "Catalogue", sub: "pre-approved standard changes" },
  { key: "calendar", label: "Freezes & notices", sub: "your freeze calendar, who gets told" },
  { key: "review", label: "Change review", sub: "agenda, minutes, reviews due" },
];

/** The five real sub-view URL slugs, mirrored in portalV2Nav.ts and App.tsx. */
export const CC_VIEW_KEYS = ["briefing", "register", "catalogue", "calendar", "review"] as const;
export type CcView = (typeof CC_VIEW_KEYS)[number] | "settings" | "record";

/** proto kindCss — the who/what/when/where sentence-segment styling. */
export const CC_KIND_CSS: Record<string, string> = {
  who: "color:#93c5fd;font-weight:700;border-bottom:1px solid rgba(147,197,253,.35)",
  what: "color:#f8fafc;font-weight:700",
  when: "color:#fbbf24;font-weight:700;border-bottom:1px solid rgba(251,191,36,.35)",
  where: "color:#2dd4bf;font-weight:700;border-bottom:1px solid rgba(45,212,191,.35)",
  "": "color:#94a3b8",
};

/* ── Pure derivations — the design's logic, extracted for unit testing ─────── */

/** proto secDone — is a required section present (not in `missing`). */
export function secDone(cr: ChangeRequest, key: string): boolean {
  return (cr.missing || []).indexOf(key) < 0;
}

/** proto compOf — required-section completeness. */
export function compOf(cr: ChangeRequest): { done: number; total: number; pct: number } {
  const reqs = CC_SECS.filter((s) => s.req);
  const done = reqs.filter((s) => secDone(cr, s.key)).length;
  return { done, total: reqs.length, pct: Math.round((done / reqs.length) * 100) };
}

/** proto editableBy — which sections the customer approver can edit. */
export function editableBy(secKey: string): boolean {
  return ["request", "approvals"].indexOf(secKey) >= 0;
}

/**
 * proto inFreeze — does a CR's window collide with the freeze. `freezeActive`
 * is a design prop (default true); a moved CR no longer collides.
 */
export function inFreeze(
  code: string,
  opts: { freezeActive?: boolean; moved?: Record<string, string> } = {},
): boolean {
  if (opts.freezeActive === false) return false;
  if ((opts.moved || {})[code]) return false;
  const d = CC_WINDOW_DAY[code];
  return !!d && d >= CC_FREEZE.from && d <= CC_FREEZE.to;
}

/** proto STAT_SETS — which codes each stat card filters the briefing to. */
export const CC_STAT_SETS: Record<string, readonly string[]> = {
  decisions: ["CR-0151", "MC1049877", "CR-0142", "CR-0136", "CR-0147"],
  waiting: ["CR-0142", "CR-0151"],
  incomplete: ["CR-0147", "CR-0151"],
  scheduled: ["CR-0144", "CR-0142", "MC1049877", "MC1051144"],
  closed: ["CR-0136", "CR-0151"],
  freeze: ["CR-0142", "MC1051144"],
};

/** proto matchSF — is a code in the active stat filter's set (or no filter). */
export function matchSF(code: string, statFilter: string | null): boolean {
  return !statFilter || (CC_STAT_SETS[statFilter] || []).indexOf(code) >= 0;
}

export interface RegisterFilters {
  readonly query: string;
  readonly fRisk: string;
  readonly fState: string;
  readonly fWork: string;
  readonly statFilter: string | null;
}

/**
 * proto register predicate (renderVals `shown`) — the stat filter, the free-text
 * search over code+title+workload+mc, and the three selects.
 */
export function filterRegister(crs: readonly ChangeRequest[], f: RegisterFilters): ChangeRequest[] {
  const q = f.query.trim().toLowerCase();
  return crs.filter((c) => {
    if (!matchSF(c.code, f.statFilter)) return false;
    if (q && !`${c.code} ${c.title} ${c.workload} ${c.mc}`.toLowerCase().includes(q)) return false;
    if (f.fRisk !== "All risk" && c.risk !== f.fRisk) return false;
    if (f.fState !== "All states" && c.state !== f.fState) return false;
    if (f.fWork !== "All workloads" && !c.workload.includes(f.fWork)) return false;
    return true;
  });
}

/** The register's approval-state label and tone (proto renderVals rows). */
export function apprState(state: string): { label: string; tone: string } {
  const label =
    state === "Awaiting approval"
      ? "Awaiting signature"
      : state === "Draft"
        ? "Not submitted"
        : state === "Rolled back"
          ? "Approved, reverted"
          : /retro/.test(state)
            ? "Retro approval due"
            : "Approved";
  const tone =
    state === "Awaiting approval"
      ? "#fbbf24"
      : state === "Draft"
        ? "#94a3b8"
        : state === "Rolled back" || /retro/.test(state)
          ? "#f87171"
          : "#34d399";
  return { label, tone };
}

/**
 * proto gantt bar geometry — the label column that trails a bar. The design
 * clamps the trailing label so a bar near the right edge does not overflow the
 * 15-column grid: it starts at min(start+span, 15) and spans max(1, 16 -
 * (start+span)). Extracted because an off-by-one here silently pushes a label
 * off the timeline.
 */
export function barTextSpan(start: number, span: number): { col: number; span: number } {
  return { col: Math.min(start + span, 15), span: Math.max(1, 16 - (start + span)) };
}

/** proto CARD_ORDER — the briefing card order once brief + MS cards are merged. */
export const CC_CARD_ORDER = ["CR-0151", "CR-0144", "MC1049877", "CR-0142", "MC1051144", "CR-0147", "CR-0136"];

/** proto order — the briefing gantt / brief-card CR order. */
export const CC_BRIEF_ORDER = ["CR-0151", "CR-0144", "CR-0142", "CR-0147", "CR-0136"];

export interface CalCell {
  blank: boolean;
  d: string;
  key?: string;
  hasSomething: boolean;
  today: boolean;
  weekend: boolean;
  sel: boolean;
  fzTone: string | null;
  isFzStart: boolean;
  fzName: string;
  events: ReadonlyArray<{ label: string; tone: string }>;
}
export interface CalDayDetail {
  key: string;
  title: string;
  hasFz: boolean;
  fzName: string;
  fzRange: string;
  fzOwner: string;
  fzScope: string;
  fzEmerg: string;
  fzTone: string;
  hasEvents: boolean;
  events: ReadonlyArray<{ label: string; tone: string }>;
  verdict: string;
}
export interface CalendarModel {
  title: string;
  monthOffset: number;
  cells: CalCell[];
  dows: string[];
  note: string;
  day: CalDayDetail | null;
}

const CAL_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * proto buildCalendar — the freeze calendar month grid. Pure over (monthOffset,
 * freezes, calDay): computes the lead blanks, the day cells with freeze / event
 * / weekend / today styling flags, the in-month freeze note, and the selected
 * day's detail. Anchored to the design's fixed clock (base August 2026, today
 * 2026-08-20) so the fixture stays in the state the design draws.
 */
export function buildCalendar(
  monthOffset: number,
  freezes: readonly FreezeRow[],
  calDay: string | null,
): CalendarModel {
  const base = new Date(2026, 7 + monthOffset, 1);
  const y = base.getFullYear();
  const m = base.getMonth();
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const iso = (dd: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const fzs = freezes.filter((f) => f.start);

  const cells: CalCell[] = [];
  for (let i = 0; i < lead; i++) {
    cells.push({ blank: true, d: "", hasSomething: false, today: false, weekend: false, sel: false, fzTone: null, isFzStart: false, fzName: "", events: [] });
  }
  for (let d = 1; d <= days; d++) {
    const k = iso(d);
    const fz = fzs.filter((f) => f.start! <= k && k <= f.end!)[0];
    const evs = CC_CAL_EVENTS[k] || [];
    const wd = new Date(y, m, d).getDay();
    const weekend = wd === 0 || wd === 6;
    const today = k === "2026-08-20";
    const isStart = !!fz && k === fz.start;
    const sel = calDay === k;
    const hasSomething = !!fz || evs.length > 0;
    cells.push({
      blank: false,
      d: String(d),
      key: k,
      hasSomething,
      today,
      weekend,
      sel,
      fzTone: fz ? fz.tone : null,
      isFzStart: isStart,
      fzName: isStart ? fz.name : "",
      events: evs.map((e) => ({ label: e.label, tone: e.tone })),
    });
  }

  const monthKey = `${y}-${String(m + 1).padStart(2, "0")}`;
  const inMonth = fzs.filter(
    (f) => f.start!.slice(0, 7) === monthKey || (f.start! < `${monthKey}-01` && f.end! >= `${monthKey}-01`),
  );

  let day: CalDayDetail | null = null;
  if (calDay) {
    const dt = new Date(`${calDay}T00:00:00`);
    const fz = fzs.filter((f) => calDay >= f.start! && calDay <= f.end!)[0];
    const evs = CC_CAL_EVENTS[calDay] || [];
    day = {
      key: calDay,
      title: `${CAL_DAY_NAMES[dt.getDay()]} ${dt.getDate()} ${CC_MONTHS[dt.getMonth()]} ${dt.getFullYear()}`,
      hasFz: !!fz,
      fzName: fz ? fz.name : "",
      fzRange: fz ? fz.range : "",
      fzOwner: fz ? fz.owner : "",
      fzScope: fz ? fz.scope : "",
      fzEmerg: fz ? fz.emergencies : "",
      fzTone: fz ? fz.tone : "#f87171",
      hasEvents: evs.length > 0,
      events: evs.map((e) => ({ label: e.label, tone: e.tone })),
      verdict: fz
        ? "Nothing may ship on this date. Anything already booked into it needs the freeze owner's written approval or a new window."
        : evs.length
          ? "This date is open. What is listed is already booked against it."
          : "Nothing booked, no freeze. This date is available.",
    };
  }

  return {
    title: `${CC_MONTHS[m]} ${y}`,
    monthOffset,
    cells,
    dows: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    note: inMonth.length ? inMonth.map((f) => `${f.name} · ${f.range}`).join("   ·   ") : "No freeze declared this month.",
    day,
  };
}

/* ── Legend for the briefing timeline (proto legend). ──────────────────────── */
export const CC_LEGEND: ReadonlyArray<{ label: string; tone: string }> = [
  { label: "Awaiting approval", tone: "#fbbf24" },
  { label: "In test", tone: "#60a5fa" },
  { label: "Draft · blocked", tone: "#94a3b8" },
  { label: "Change window Tue–Thu", tone: "rgba(0,120,212,.35)" },
  { label: "Month-end blackout", tone: "rgba(251,191,36,.35)" },
  { label: "Freeze — nothing may change", tone: "rgba(248,113,113,.6)" },
];

/** proto catalogue category order. */
export const CC_CATS = ["Identity", "Mail", "Files", "Teams", "Devices", "Licensing"] as const;
