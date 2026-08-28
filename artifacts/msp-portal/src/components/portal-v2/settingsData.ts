/**
 * settingsData.ts — the Settings page fixture.
 *
 * Transcribed from the prototype's own state and `renderVals()`
 * ('Customer Portal Shell.dc.html'):
 *
 *   • `ownPeople`      — 7223-7233   → OWN_PEOPLE_SEED
 *   • `ccPolicy`       — 7209-7210   → CC_POLICY_SEED
 *   • `ccNotif`        — 7258-7266   → CC_NOTIF_SEED
 *   • `RACI_PEOPLE`    — 7599-7609   → RACI_PEOPLE
 *   • `setNav`         — 19923-19927 → SET_NAV
 *   • `deptRows`       — 19943-19950 → DEPT_ROWS
 *   • `ownRoleDefs`    — 19997-20002 → OWN_ROLE_DEFS
 *   • `setRoutingRows` — 20005-20012 → SET_ROUTING_RULES
 *   • `ccGates`        — 19335-19341 → CC_GATES
 *   • `ccRules`        — 19352-19356 → CC_RULES
 *
 * Only the DATA is here. Every style string in those blocks is derived from the
 * row's own on/off state, so it belongs with the component that draws it, not
 * with the fixture — the same split riskRegisterData / riskRegisterModel uses.
 *
 * ── Why this page exists at all ─────────────────────────────────────────────
 * Settings is new in this handoff round. The round-one bundle had no Settings
 * page: `Ownership routing`, `People & roles` and `Change control policy` all
 * return ZERO hits in the round-one shell and 5 / 1 / 4 in this one. So none of
 * the Round Two "moved into Settings" changes were a move for this build —
 * there was nothing here to move from, and this is the first time the
 * destination has existed.
 *
 * ── Design content, not tenant data ─────────────────────────────────────────
 * The prototype's fictional Halden Materials tenant throughout. Every one of
 * these arrays is a seed for state a real backend will own; none of it is read
 * from the platform today, and the page says so where a customer can see it.
 */

/* ────────────────────────────────────────────────────────────────────────────
   People & roles
   ──────────────────────────────────────────────────────────────────────── */

/** `side` cycles in this order on click — prototype 19977. */
export const OWN_SIDES = ["Halden", "MSP", "External"] as const;
/**
 * A side is a STRING, not the three literals above.
 *
 * `OWN_SIDES` is the design fixture’s cycle, and its first entry is the
 * prototype’s fictional customer name. Once the people list comes from
 * `GET /api/portal/ownership` the customer side carries the TENANT’S OWN
 * name — it is rendered verbatim beside a person ("Joe Joe · IT Manager ·
 * Halden"), so pinning the type to "Halden" would mean either printing a
 * fictional company on a real person’s row or resolving the label somewhere
 * in the render, which is a tenant fact invented in the UI layer. The cycle
 * order is supplied per call instead — see `cycleSide`.
 */
export type OwnSide = string;

/** `kind` cycles in this order on click — prototype 19980. */
export const OWN_KINDS = ["Person", "Group", "Vendor"] as const;
export type OwnKind = (typeof OWN_KINDS)[number];

export interface OwnPerson {
  id: string;
  name: string;
  role: string;
  side: OwnSide;
  kind: OwnKind;
  /** Empty string means available. The prototype stores the RETURN DATE here,
      not a boolean, because the matrix prints it verbatim ("Back 22 September"). */
  away: string;
  /** Another person's `id`, or "" for no cover. */
  deputy: string;
}

/**
 * The nine people the whole ownership system is drawn from — prototype
 * 7223-7233. Ownership.dc.html carries a byte-identical copy as its own
 * standalone fallback (Ownership.dc.html 565-575); that duplication is the
 * prototype's way of letting the module open on its own, and here it collapses
 * to this one array because the shell is the owner either way.
 *
 * Note `desk` is a Group and `court` is a Vendor — the list is deliberately not
 * all Person, which is why `kind` is a field rather than an assumption.
 */
export const OWN_PEOPLE_SEED: readonly OwnPerson[] = [
  { id: "priya", name: "Priya Raman", role: "IT Manager", side: "Halden", kind: "Person", away: "", deputy: "marcus" },
  { id: "dan", name: "Dan Whitlock", role: "Operations Director", side: "Halden", kind: "Person", away: "", deputy: "priya" },
  { id: "marcus", name: "Marcus Lee", role: "Systems Administrator", side: "Halden", kind: "Person", away: "Back 22 September", deputy: "priya" },
  { id: "aisha", name: "Aisha Bello", role: "Compliance Lead", side: "Halden", kind: "Person", away: "", deputy: "" },
  { id: "ruth", name: "Ruth Okafor", role: "Sales Lead", side: "Halden", kind: "Person", away: "", deputy: "" },
  { id: "jo", name: "Jo Feltham", role: "Internal Comms", side: "Halden", kind: "Person", away: "", deputy: "desk" },
  { id: "shane", name: "Shane McCaw", role: "M365 Architect", side: "MSP", kind: "Person", away: "", deputy: "" },
  { id: "desk", name: "Service desk", role: "First line, 4 staff", side: "Halden", kind: "Group", away: "", deputy: "" },
  { id: "court", name: "R. Court", role: "External counsel", side: "External", kind: "Vendor", away: "", deputy: "" },
];

/** The toggle label for a person who is not away — prototype 19983. */
export const OWN_AVAILABLE_LABEL = "Available";

/** What `awayGo` writes when it toggles someone TO away — prototype 19984. */
export const OWN_AWAY_DEFAULT = "Away, back in a week";

export interface OwnRoleDef {
  tag: string;
  tone: string;
  text: string;
}

/**
 * "What each role means here" — prototype 19997-20002. The same four
 * definitions appear in Ownership.dc.html's `ROLE_KEYS` (712-717) against the
 * same four tones, so they are one list, not two.
 */
export const OWN_ROLE_DEFS: readonly OwnRoleDef[] = [
  { tag: "Responsible", tone: "#f87171", text: "Does the work. One name, never a group." },
  { tag: "Accountable", tone: "#fbbf24", text: "Answers for it afterwards, and approves it beforehand." },
  { tag: "Consulted", tone: "#60a5fa", text: "Asked before the window opens, not told after it closes." },
  { tag: "Informed", tone: "#a78bfa", text: "Told once it is done, in language they use." },
];

/* ────────────────────────────────────────────────────────────────────────────
   Ownership routing
   ──────────────────────────────────────────────────────────────────────── */

export interface RoutingRuleDef {
  k: string;
  label: string;
  live: string;
}

/**
 * The six routing rules — prototype 20005-20012. Each is ON unless explicitly
 * turned off (`(ownRules)[r.k] !== false`, 20013), so the seed state is an
 * empty object rather than six `true`s.
 */
export const SET_ROUTING_RULES: readonly RoutingRuleDef[] = [
  {
    k: "notify",
    label: "Tell the informed name when something changes",
    live: "Announcements and change notices go to whoever holds Informed on the object, not to a fixed distribution list.",
  },
  {
    k: "approve",
    label: "Route approvals to the accountable name",
    live: "A change request cannot be approved by the person who raised it. It goes to whoever is Accountable for the object it touches.",
  },
  {
    k: "consult",
    label: "Ask the consulted name before a window is booked",
    live: "The Consulted name gets the proposed window and can object before it is set, not after.",
  },
  {
    k: "escalate",
    label: "Escalate when the responsible name goes quiet",
    live: "Nothing moves for the set number of days and it goes to the accountable name, marked with an hourglass on the matrix.",
  },
  {
    k: "gap",
    label: "Block routing where there is no name",
    live: "An object with no Responsible cannot have work routed to it. It shows as a gap instead of silently going nowhere.",
  },
  {
    k: "cover",
    label: "Follow cover when someone is away",
    live: "Anything routed to a person who is away goes to their deputy for the dates of the handover, and says so.",
  },
];

/** `ownEscDays` — prototype 7235. */
export const OWN_ESC_DAYS_SEED = 5;

/* ────────────────────────────────────────────────────────────────────────────
   Departments
   ──────────────────────────────────────────────────────────────────────── */

export interface DeptRow {
  name: string;
  /** "group" reads from a security group; "attribute" reads the Entra field. */
  src: "group" | "attribute";
  n: number;
  group: string;
}

/**
 * prototype 19943-19950.
 *
 * NO-BACKEND-TO-WIRE: no portal-v2 endpoint reads department membership or
 * "map by security group" state — these rows and DEPT_UNMAPPED below are
 * fixture, and the "Set by group" drawer submit is a no-op stub with no
 * write behind it.
 */
export const DEPT_ROWS: readonly DeptRow[] = [
  { name: "Engineering", src: "attribute", n: 214, group: "Not set" },
  { name: "Sales", src: "attribute", n: 186, group: "Not set" },
  { name: "Operations", src: "group", n: 240, group: "SG-Operations-All" },
  { name: "Finance", src: "group", n: 74, group: "SG-Finance" },
  { name: "Legal", src: "attribute", n: 22, group: "Not set" },
  { name: "Customer Support", src: "group", n: 168, group: "SG-Support-Tier1+2" },
  { name: "Manufacturing", src: "attribute", n: 132, group: "Not set" },
];

/**
 * `deptUnmapped` — prototype 19942. A STRING in the prototype, and deliberately
 * NOT the difference between the seat count and the rows above (those sum to
 * 1,036 of 1,240, which would be 204 — it happens to agree, but the prototype
 * does not derive it, and the seat count is not on this page to derive it from).
 */
export const DEPT_UNMAPPED = "204";

/* ────────────────────────────────────────────────────────────────────────────
   Change control policy
   ──────────────────────────────────────────────────────────────────────── */

export interface CcPolicy {
  on: boolean;
  gated: Record<string, boolean>;
  approvals: number;
  separate: boolean;
  freeze: boolean;
  emergency: boolean;
  approvers: { normal: readonly string[]; emergency: readonly string[] };
}

/**
 * prototype 7209-7210.
 *
 * NO-BACKEND-TO-WIRE: no settings endpoint exists to persist Change control
 * policy — the master toggle, gates, signature rules, approvers, and
 * notification rules below are all client-only React state (see
 * portal-v2-settings.tsx's `useState(CC_POLICY_SEED)` /
 * `useState(CC_NOTIF_SEED)`). Every toggle in this section visibly reacts to
 * a click, but nothing here survives a page reload and nothing writes to any
 * tenant. Flagged rather than silently left to look like it saves.
 *
 * The prototype's `approvers` object carries a third key, `standard: 'auto'` —
 * a STRING where the other two are arrays of person ids. Nothing reads it:
 * `ccApproverBands` (19362-19364) iterates exactly two bands, `normal` and
 * `emergency`. It is dropped here rather than modelled as a union type that
 * would have to be narrowed at every use for a value no code path reaches.
 */
export const CC_POLICY_SEED: CcPolicy = {
  on: true,
  gated: { fix: true, sop: true, remediation: true, copilot: true, graph: true },
  approvals: 2,
  separate: true,
  freeze: true,
  emergency: true,
  approvers: { normal: ["dw", "pr"], emergency: ["dw", "sm"] },
};

export interface CcGateDef {
  k: string;
  label: string;
  sub: string;
}

/** "What is gated" — prototype 19335-19341. */
export const CC_GATES: readonly CcGateDef[] = [
  { k: "fix", label: "Fix a finding", sub: "The Fix panel, wherever it opens from" },
  { k: "sop", label: "Run an SOP or runbook", sub: "Guided procedures, automated or manual" },
  { k: "remediation", label: "Close a remediation item", sub: "Marking a finding remediated" },
  { k: "copilot", label: "Change a Copilot setting", sub: "Licences, agents, readiness gates" },
  { k: "graph", label: "Anything run via Microsoft Graph", sub: "Every automated write to the tenant" },
];

/** The three boolean rules under "The rules" — prototype 19352-19356. */
export const CC_RULES: readonly CcGateDef[] = [
  {
    k: "separate",
    label: "Signatures must be two different people",
    sub: "The person who raises it cannot be the one who approves it",
  },
  {
    k: "freeze",
    label: "Enforce the freeze calendar",
    sub: "Nothing may be scheduled inside a freeze without a written exception",
  },
  {
    k: "emergency",
    label: "Allow an emergency path",
    sub: "Run first, approve retrospectively within 24 hours",
  },
];

/** "Signatures required" — prototype 19347-19351. */
export const CC_APPROVAL_OPTS: ReadonlyArray<{ n: number; label: string }> = [
  { n: 1, label: "One" },
  { n: 2, label: "Two" },
  { n: 3, label: "Three" },
];

export const CC_APPROVER_BANDS: ReadonlyArray<{ band: "normal" | "emergency"; label: string }> = [
  { band: "normal", label: "Normal and standard changes" },
  { band: "emergency", label: "Emergency changes" },
];

/** The ids the approver chips iterate, in the prototype's order — 19365. */
export const CC_APPROVER_IDS: readonly string[] = ["dw", "pr", "sm", "ab", "rc", "ml"];

export interface RaciPerson {
  name: string;
  role: string;
  org: string;
  tone: string;
}

/**
 * prototype 7599-7609.
 *
 * ── This is NOT the same list as OWN_PEOPLE_SEED, and that is the prototype's
 * own inconsistency, reproduced rather than reconciled ──────────────────────
 * Different ids (`pr` / `dw` / `ml` vs `priya` / `dan` / `marcus`), and three
 * people carry a different role in each: Marcus Lee is "Systems Administrator"
 * in `ownPeople` and "Collaboration Lead" here; Ruth Okafor is "Sales Lead" vs
 * "Records Manager"; Jo Feltham is "Internal Comms" vs "Service Desk Lead".
 *
 * The approver chips read THIS list (19366), so editing someone's role under
 * People & roles does not change the role shown on their approver chip. That is
 * a real defect for a backend to resolve by having one people table; it is left
 * visible here because inventing the reconciliation would mean choosing which
 * of the two roles is correct, and the design does not say.
 */
export const RACI_PEOPLE: Readonly<Record<string, RaciPerson>> = {
  pr: { name: "Priya Raman", role: "IT Manager", org: "Halden Materials", tone: "#f472b6" },
  dw: { name: "Dan Whitlock", role: "Operations Director", org: "Halden Materials", tone: "#fbbf24" },
  ml: { name: "Marcus Lee", role: "Collaboration Lead", org: "Halden Materials", tone: "#60a5fa" },
  ab: { name: "Aisha Bello", role: "Compliance Lead", org: "Halden Materials", tone: "#34d399" },
  ro: { name: "Ruth Okafor", role: "Records Manager", org: "Halden Materials", tone: "#a78bfa" },
  jf: { name: "Jo Feltham", role: "Service Desk Lead", org: "Halden Materials", tone: "#22d3ee" },
  sm: { name: "Shane McCaw", role: "Principal Architect", org: "Shane McCaw Consulting", tone: "#38bdf8" },
  rc: { name: "R. Court", role: "Security Analyst", org: "Shane McCaw Consulting", tone: "#f87171" },
  sd: { name: "Service desk", role: "Group · 4 people", org: "Halden Materials", tone: "#94a3b8" },
};

export interface CcNotifRule {
  event: string;
  channel: string;
  to: string;
  lead: string;
  on: boolean;
}

/**
 * The notification-rules table — prototype 7258-7266.
 *
 * Note the LAST row seeds `on: false` while the other six seed `on: true`. That
 * is the row the design uses to show the Off state, so it is load-bearing copy,
 * not an oversight.
 */
export const CC_NOTIF_SEED: readonly CcNotifRule[] = [
  {
    event: "Microsoft enforcement date approaching",
    channel: "Email · Teams",
    to: "Priya Raman, IT team",
    lead: "30 days ahead, then 7, then 1",
    on: true,
  },
  {
    event: "Message Center post with tenant impact",
    channel: "Email",
    to: "Priya Raman",
    lead: "Within 4 hours of publication",
    on: true,
  },
  {
    event: "Change request raised",
    channel: "Email",
    to: "Priya Raman, Dan Whitlock",
    lead: "Immediately",
    on: true,
  },
  {
    event: "Change awaiting your signature",
    channel: "Email · Teams",
    to: "The named approver",
    lead: "Immediately, then daily until signed",
    on: true,
  },
  {
    event: "Change window opening",
    channel: "Teams",
    to: "IT team, service desk",
    lead: "24 hours ahead, then 1 hour",
    on: true,
  },
  {
    event: "Change deployed or rolled back",
    channel: "Email",
    to: "Priya Raman, service desk",
    lead: "Within 15 minutes",
    on: true,
  },
  {
    event: "Freeze declared or lifted",
    channel: "Email · Teams",
    to: "Everyone with an open change",
    lead: "Immediately",
    on: false,
  },
];

/* ────────────────────────────────────────────────────────────────────────────
   The page's own nav
   ──────────────────────────────────────────────────────────────────────── */

export type SetSectionKey = "routing" | "change" | "people" | "departments";

export interface SetNavItem {
  k: SetSectionKey;
  label: string;
  sub: string;
}

/**
 * prototype 19923-19927, in the prototype's own order.
 *
 * ── Round Two: "Settings nav trimmed" ──────────────────────────────────────
 * The changelog records two placeholder entries removed from this list,
 * "Scans and alerting" and "Tenant and billing". Both strings return ZERO hits
 * in BOTH the round-one and the round-two shell, so there is no state of this
 * design in which they were ever here — they existed only in an intermediate
 * revision this build never saw. Recorded so the next reader does not go
 * looking for a removal that has nothing to remove.
 *
 * ── This nav keeps its LEFT BAR ────────────────────────────────────────────
 * Round Two replaced the left vertical bar with a leading "↳" glyph "across
 * Change Control, Ownership, SOPs and Microsoft Changes sub-navigation" — this
 * list is none of those. The prototype still draws it with
 * `border-left:2px solid #0078D4` (19933), and that is reproduced. Applying the
 * glyph here would be following the changelog's prose past what it says and
 * past what the artefact does.
 */
export const SET_NAV: readonly SetNavItem[] = [
  { k: "routing", label: "Ownership routing", sub: "what the four names do" },
  { k: "change", label: "Change control policy", sub: "gating, approvals, freeze" },
  { k: "people", label: "People & roles", sub: "who is in the matrix" },
  { k: "departments", label: "Departments", sub: "how people are grouped" },
];

/** `setSection: 'routing'` — prototype 7222, and the fallback at 13942. */
export const SET_SECTION_DEFAULT: SetSectionKey = "routing";
