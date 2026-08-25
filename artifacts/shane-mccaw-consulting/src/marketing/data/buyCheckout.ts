// Data layer for the unified checkout (/buy), recreated from the logic class at the bottom of
// Design/design_handoff_marketing/Marketing Buy.dc.html. Everything the checkout prices or lists
// lives here, in one place, rather than as literals inside Buy.tsx — the repo's no-hardcoding rule
// (no prices / tier names / seat counts baked into .tsx) and the handoff's "every number on screen
// comes from the data layer … so it can be swapped for real data" convention.
//
// Provenance of the figures (mirrors quickStartPacks.ts's own header):
//   • Pack names + prices are imported from quickStartPacks.ts (the canonical Quick-Start fixture,
//     verified live against the `services` table 2026-08-21) so the two pages can never drift; only
//     the Buy page's own shorter option-copy lives here.
//   • Monitoring per-seat rates/floors and the retainer prices are carried verbatim from the
//     Marketing Monitoring / Marketing Retainers design mocks (same figures the /monitoring and
//     /retainers pages show). Per the README "Out of scope": production reads the tenant's licensed
//     seat count and the live catalog, so these are the swappable fixture, not the source of truth.
//   • RETAINER NOTE (same correction Retainers.tsx documents): the design mock's four tiers include
//     an "Advisory" $900/5hrs tier — `architect-advisory-retainer` has had a live `services` row
//     since 2026-08-25's recovery, alongside the three fixed hour-based tiers (Essentials/Growth/
//     Enterprise at $1,500/$3,000/$5,500). The four are reproduced here because the Buy design is a
//     self-contained checkout; incoming ?tier= from /retainers is one of essentials/growth/enterprise
//     (which match), and Advisory is reachable only by direct link or as the default fallback.

import { PACKS as QS_PACKS } from "./quickStartPacks";

export const money = (n: number): string =>
  "$" + Math.round(n).toLocaleString("en-US");

// ── Monitoring: per-seat/month by seat bracket, with a monthly floor per bracket ────────────────
export type BracketKey = "micro" | "smb" | "mid" | "ent";

export interface Bracket {
  key: BracketKey;
  max: number;
}

export const BRACKETS: Bracket[] = [
  { key: "micro", max: 25 },
  { key: "smb", max: 100 },
  { key: "mid", max: 499 },
  { key: "ent", max: Infinity },
];

export interface MonTier {
  key: string;
  name: string;
  desc: string;
  rates: Record<BracketKey, number>;
  floors: Record<BracketKey, number>;
  flat?: number;
}

export const MON_TIERS: MonTier[] = [
  {
    key: "foundation",
    name: "Foundation",
    desc: "30 checks across all six pillars, risk register, documented decisions.",
    rates: { micro: 12, smb: 9, mid: 7, ent: 5 },
    floors: { micro: 180, smb: 300, mid: 900, ent: 3000 },
  },
  {
    key: "growth",
    name: "Growth",
    desc: "129 checks, one-click runbooks, the SOP library, remediation tracking.",
    rates: { micro: 18, smb: 14, mid: 11, ent: 8 },
    floors: { micro: 270, smb: 500, mid: 1500, ent: 5000 },
  },
  {
    key: "premier",
    name: "Premier",
    desc: "Everything in Growth, plus change control, RACI, security plan, PII governance.",
    rates: { micro: 22.5, smb: 17.5, mid: 13.75, ent: 10 },
    floors: { micro: 497.5, smb: 625, mid: 1875, ent: 6250 },
    flat: 160,
  },
];

// ── Retainers: fixed monthly price by hours ─────────────────────────────────────────────────────
export interface RetTier {
  key: string;
  name: string;
  price: number;
  desc: string;
}

export const RET_TIERS: RetTier[] = [
  { key: "advisory", name: "Advisory", price: 900, desc: "5 hours a month. A name to call before something goes wrong." },
  { key: "essentials", name: "Essentials", price: 1500, desc: "8 hours a month. Real architectural guidance, not a help desk." },
  { key: "growth", name: "Growth", price: 3000, desc: "16 hours a month. An architect who owns initiatives." },
  { key: "enterprise", name: "Enterprise", price: 5500, desc: "30 hours a month. FTE-level architecture, without the hire." },
];

// ── Packs: name + price sourced from the canonical Quick-Start fixture; the Buy page carries its
// own shorter option-copy (the design's, final for this page) keyed by pack key. ────────────────
export interface BuyPack {
  key: string;
  name: string;
  price: number;
  desc: string;
}

const BUY_PACK_DESC: Record<string, string> = {
  entra: "A new or half-configured tenant taken to a real identity baseline in one pass.",
  breakglass: "A verified emergency admin credential, released only after multi-recipient verification and logged end to end.",
  ca: "Conditional Access policies configured and enforced, not just named in a report.",
  pim: "Admin roles under PIM: eligible instead of standing, with approval before elevation.",
  mfa: "Every user enrolled and enforced, including the accounts sitting outside policy today.",
  hygiene: "Stale access, unverified security info and accounts nobody closed, cleared out.",
  onboard: "Account, licences, groups and access for a new hire in one run.",
  offboard: "Access disabled, sessions and licences reclaimed, data retained to your policy.",
  incident: "Containment steps for an incident in progress, executed rather than recommended.",
  recovery: "Sessions revoked, credentials reset, access locked down on one account.",
  device: "Intune devices brought into line with the policies they were meant to enforce.",
  email: "Forwarding rules, delegate access and transport rules reviewed and closed.",
  oversharing: "Links reviewed, exposure removed, sharing policy enforced tenant-wide.",
  licensing: "Unused licences reclaimed and reassigned so spend matches headcount.",
  copilot: "The tenant configured before Copilot reaches anyone.",
};

export const PACKS: BuyPack[] = QS_PACKS.map((p) => ({
  key: p.key,
  name: p.name,
  price: p.price,
  desc: BUY_PACK_DESC[p.key] ?? p.desc,
}));

export const PACKS_BY_KEY: Record<string, BuyPack> = Object.fromEntries(
  PACKS.map((p) => [p.key, p]),
);

// ── The dry run: every write a pack performs, as the dry run states it — what it touches, the value
// now, the value after, its user-impact class, and whether it can be reversed from the Portal.
// Authored data per the README ("Graph write-back … are authored data in the prototype"). ───────
export type Impact = "safe" | "notice" | "disruptive";

export interface DryAction {
  id: string;
  title: string;
  touches: string;
  from: string;
  to: string;
  impact: Impact;
  reversible: boolean;
  note?: string;
  // a change the targeted scan may find already true, and therefore drop before execution
  mayBeSatisfied?: boolean;
}

export const DRY_ACTIONS: Record<string, DryAction[]> = {
  entra: [
    { id: "en1", title: "Create the break-glass account", touches: "1 new cloud-only account", from: "None exists", to: "bg-admin@tenant.onmicrosoft.com, excluded from CA", impact: "safe", reversible: true },
    { id: "en2", title: "Block legacy authentication", touches: "Tenant-wide CA policy", from: "Allowed on 4 protocols", to: "Blocked, report-only for 7 days first", impact: "disruptive", reversible: true, note: "3 accounts signed in with legacy auth in the last 30 days. They are named in the report-only result before enforcement." },
    { id: "en3", title: "Restrict guest invitations", touches: "External collaboration settings", from: "Anyone in the tenant can invite", to: "Admins and the guest-inviter role only", impact: "notice", reversible: true },
    { id: "en4", title: "Enforce a group naming policy", touches: "M365 group creation", from: "No policy", to: "Prefix by department, blocked-word list applied", impact: "safe", reversible: true, mayBeSatisfied: true },
    { id: "en5", title: "Set self-service password reset scope", touches: "SSPR configuration", from: "Disabled", to: "Enabled for all users, 2 methods required", impact: "notice", reversible: true },
  ],
  breakglass: [
    { id: "bg1", title: "Create two break-glass accounts", touches: "2 new cloud-only accounts", from: "None exists", to: "Excluded from all CA policies, 64-character passphrase", impact: "safe", reversible: true },
    { id: "bg2", title: "Store credentials in the sealed record", touches: "Portal credential vault", from: "Nothing stored", to: "Split-knowledge release, 3 named verifiers", impact: "safe", reversible: true },
    { id: "bg3", title: "Alert on any use of the accounts", touches: "Sign-in alert rule", from: "No rule", to: "Immediate alert to 3 recipients on any sign-in", impact: "safe", reversible: true },
  ],
  ca: [
    { id: "ca1", title: "Require MFA for administrators", touches: "CA policy, 8 directory roles", from: "Not enforced", to: "Enforced, no exclusions beyond break-glass", impact: "disruptive", reversible: true },
    { id: "ca2", title: "Require compliant or hybrid-joined devices", touches: "CA policy, all users", from: "Not enforced", to: "Report-only for 7 days, then enforced", impact: "disruptive", reversible: true, note: "Report-only first. 41 unmanaged devices would be blocked today, listed for you before enforcement." },
    { id: "ca3", title: "Block sign-in from unsupported countries", touches: "Named location policy", from: "No location policy", to: "Allow-list of 3 countries", impact: "notice", reversible: true },
    { id: "ca4", title: "Require MFA for risky sign-ins", touches: "CA policy, all users", from: "Not enforced", to: "Enforced at medium risk and above", impact: "notice", reversible: true, mayBeSatisfied: true },
    { id: "ca5", title: "Block legacy authentication", touches: "Tenant-wide CA policy", from: "Allowed", to: "Blocked", impact: "disruptive", reversible: true },
  ],
  pim: [
    { id: "pm1", title: "Convert standing admins to eligible", touches: "12 role assignments", from: "Permanent active", to: "Eligible, activation required", impact: "disruptive", reversible: true, note: "12 accounts lose standing privilege. Each keeps the role and activates it on demand with justification." },
    { id: "pm2", title: "Require approval to activate Global Administrator", touches: "PIM role setting", from: "No approval", to: "2 named approvers, 8-hour maximum", impact: "notice", reversible: true },
    { id: "pm3", title: "Require justification and MFA on activation", touches: "All privileged roles", from: "Not required", to: "Required on every activation", impact: "safe", reversible: true },
    { id: "pm4", title: "Set an access review on privileged roles", touches: "Quarterly review", from: "No review", to: "Quarterly, owner-attested", impact: "safe", reversible: true },
  ],
  mfa: [
    { id: "mf1", title: "Enrol the 380 users outside the policy", touches: "User authentication methods", from: "380 users unenrolled", to: "Registration campaign, 14-day grace", impact: "disruptive", reversible: true },
    { id: "mf2", title: "Move privileged accounts to phishing-resistant methods", touches: "12 privileged accounts", from: "Authenticator push", to: "FIDO2 or Windows Hello required", impact: "disruptive", reversible: true },
    { id: "mf3", title: "Disable SMS as a method", touches: "Authentication methods policy", from: "Enabled for all", to: "Disabled, except 4 named exceptions", impact: "notice", reversible: true },
    { id: "mf4", title: "Turn off legacy per-user MFA", touches: "Per-user MFA state", from: "Mixed with CA", to: "CA only, per-user cleared", impact: "safe", reversible: true, mayBeSatisfied: true },
  ],
  hygiene: [
    { id: "hy1", title: "Disable accounts dormant over 90 days", touches: "23 accounts", from: "Enabled, unused", to: "Disabled, licences reclaimed after 30 days", impact: "notice", reversible: true },
    { id: "hy2", title: "Remove stale guest accounts", touches: "61 guests", from: "Active, no sign-in in 180 days", to: "Removed from all groups, then deleted", impact: "notice", reversible: true },
    { id: "hy3", title: "Revoke unused OAuth app consents", touches: "7 applications", from: "Consented, no use in 90 days", to: "Consent revoked", impact: "notice", reversible: true },
    { id: "hy4", title: "Remove empty security groups", touches: "14 groups", from: "Empty", to: "Deleted", impact: "safe", reversible: true },
  ],
  onboard: [
    { id: "on1", title: "Publish the joiner runbook", touches: "Portal runbook library", from: "No runbook", to: "11 steps, Graph-executable", impact: "safe", reversible: true },
    { id: "on2", title: "Create role-based licence groups", touches: "6 dynamic groups", from: "Manual assignment", to: "Group-based licensing by job title", impact: "notice", reversible: true },
    { id: "on3", title: "Set the default access template", touches: "New-user defaults", from: "No template", to: "Teams, SharePoint and mailbox defaults per role", impact: "safe", reversible: true },
  ],
  offboard: [
    { id: "of1", title: "Publish the leaver runbook", touches: "Portal runbook library", from: "No runbook", to: "14 steps, Graph-executable", impact: "safe", reversible: true },
    { id: "of2", title: "Configure mailbox and OneDrive retention on exit", touches: "Retention policy", from: "30 days, default", to: "1 year, manager delegated access", impact: "notice", reversible: true },
    { id: "of3", title: "Revoke sessions and tokens on disable", touches: "Sign-in revocation", from: "Not automated", to: "Immediate revocation in the runbook", impact: "safe", reversible: true },
  ],
  incident: [
    { id: "in1", title: "Publish the containment runbook", touches: "Portal runbook library", from: "No runbook", to: "Account isolation, token revocation, mailbox rule sweep", impact: "safe", reversible: true },
    { id: "in2", title: "Enable mailbox auditing everywhere", touches: "1,240 mailboxes", from: "Default auditing", to: "Full audit set, 1-year retention", impact: "safe", reversible: true, mayBeSatisfied: true },
    { id: "in3", title: "Create the high-risk sign-in alert", touches: "Alert rule", from: "No rule", to: "Alert plus automatic session revocation", impact: "notice", reversible: true },
  ],
  recovery: [
    { id: "rc1", title: "Publish the recovery runbook", touches: "Portal runbook library", from: "No runbook", to: "Restore order, owner sign-off gates", impact: "safe", reversible: true },
    { id: "rc2", title: "Extend deleted-item retention", touches: "SharePoint and Exchange", from: "14 and 30 days", to: "93 and 30 days", impact: "safe", reversible: true },
    { id: "rc3", title: "Verify restore points for 96 teams", touches: "Backup verification", from: "Never verified", to: "Weekly verification job", impact: "safe", reversible: true },
  ],
  device: [
    { id: "dv1", title: "Publish compliance policies", touches: "Intune, 3 platforms", from: "No policy", to: "Encryption, patch level and PIN required", impact: "disruptive", reversible: true, note: "41 devices are non-compliant today. They keep access for the 14-day grace period." },
    { id: "dv2", title: "Require app protection on mobile", touches: "Intune app policies", from: "Not configured", to: "No copy-out, PIN, wipe on jailbreak", impact: "notice", reversible: true },
    { id: "dv3", title: "Enable BitLocker reporting", touches: "Windows estate", from: "Not reported", to: "Key escrow verified in Entra", impact: "safe", reversible: true },
  ],
  email: [
    { id: "em1", title: "Disable SMTP AUTH tenant-wide", touches: "Exchange Online", from: "Enabled", to: "Disabled, 2 named exceptions", impact: "disruptive", reversible: true },
    { id: "em2", title: "Publish anti-phishing policy", touches: "Defender for Office", from: "Default only", to: "Impersonation protection on 14 executives", impact: "notice", reversible: true },
    { id: "em3", title: "Turn on Safe Links and Safe Attachments", touches: "All mailboxes", from: "Partial coverage", to: "Full coverage, dynamic delivery", impact: "notice", reversible: true, mayBeSatisfied: true },
    { id: "em4", title: "Block auto-forwarding to external domains", touches: "Outbound spam policy", from: "Allowed", to: "Blocked, 3 existing rules removed", impact: "disruptive", reversible: true },
  ],
  oversharing: [
    { id: "ov1", title: "Expire existing anonymous links", touches: "212 sites, 1,847 links", from: "No expiry", to: "30-day expiry applied", impact: "disruptive", reversible: true, note: "Links older than 30 days stop working at the next scan. The list is exportable before you approve." },
    { id: "ov2", title: "Change the default sharing link type", touches: "Tenant sharing settings", from: "Anyone with the link", to: "Specific people", impact: "notice", reversible: true },
    { id: "ov3", title: "Restrict site-level external sharing", touches: "4 sensitive sites", from: "Org-wide", to: "Existing guests only", impact: "notice", reversible: true },
    { id: "ov4", title: "Publish sensitivity labels", touches: "4 labels", from: "None published", to: "Published to all, no default", impact: "safe", reversible: true },
  ],
  licensing: [
    { id: "lc1", title: "Reclaim licences from dormant accounts", touches: "38 licences", from: "Assigned, unused 90 days", to: "Unassigned at the next renewal date", impact: "notice", reversible: true },
    { id: "lc2", title: "Remove duplicate service plans", touches: "14 users", from: "E3 plus overlapping add-ons", to: "Add-ons removed, E3 retained", impact: "safe", reversible: true },
    { id: "lc3", title: "Move to group-based licensing", touches: "6 groups", from: "Direct assignment", to: "Group-based, by department", impact: "notice", reversible: true },
  ],
  copilot: [
    { id: "cp1", title: "Restrict Copilot to the pilot cohort", touches: "Copilot licence assignment", from: "Unassigned", to: "6 named users in a pilot group", impact: "safe", reversible: true },
    { id: "cp2", title: "Apply the sensitivity label baseline", touches: "3,412 documents", from: "Unlabelled", to: "Auto-labelled by content type", impact: "notice", reversible: true },
    { id: "cp3", title: "Close org-wide sharing on 4 sensitive sites", touches: "SharePoint permissions", from: "Shared org-wide", to: "Named groups only", impact: "disruptive", reversible: true },
    { id: "cp4", title: "Restrict Copilot web grounding", touches: "Copilot settings", from: "Enabled", to: "Disabled until the pilot review", impact: "notice", reversible: true, mayBeSatisfied: true },
    { id: "cp5", title: "Turn on Copilot usage telemetry", touches: "Usage reporting", from: "Not collected", to: "Per-user weekly active reporting", impact: "safe", reversible: true },
  ],
};

export const PRE_SCAN: string[] = [
  "Reading tenant configuration with the new write scopes",
  "Comparing each pack action against the live value",
  "Checking which changes are already true",
  "Resolving dependencies between the approved packs",
  "Building the dry run",
];

export const READ_SCOPES: string[] = [
  "Read-only, through Microsoft’s own consent screen",
  "No agent installed, no password ever requested",
  "Revocable from your tenant at any time",
];

export interface WriteScope {
  scope: string;
  why: string;
}

// Offered to a monitoring/retainer buyer who wants SOP remediation applied for them (optional).
export const SOP_WRITE_SCOPES: WriteScope[] = [
  { scope: "Policy.ReadWrite.ConditionalAccess", why: "Lets a runbook fix a policy gap instead of describing it." },
  { scope: "Directory.ReadWrite.All", why: "Removes stale guests and role assignments the engines flag." },
  { scope: "Sites.FullControl.All", why: "Closes oversharing on the specific sites a finding names." },
];

// Required for a pack to run its writes (mandatory, scoped to what the pack touches).
export const WRITE_SCOPES: WriteScope[] = [
  { scope: "Policy.ReadWrite.ConditionalAccess", why: "Creates the policies the pack ships, in report-only first." },
  { scope: "Directory.ReadWrite.All", why: "Creates the groups and role assignments the pack depends on." },
  { scope: "Application.ReadWrite.OwnedBy", why: "Manages only the app registrations this pack creates — nothing pre-existing." },
];

// ── Pure pricing helpers (ported from the design's logic class) ─────────────────────────────────
export function bracketFor(n: number): Bracket {
  return BRACKETS.find((b) => n <= b.max) || BRACKETS[BRACKETS.length - 1];
}

// Monthly price for a monitoring tier at a given seat count: max(seats × rate, floor) + optional
// flat. A retainer tier (no rates, a flat `price`) returns its price unchanged.
export function monthly(
  tier: MonTier | RetTier | undefined,
  seats: number,
): number {
  if (!tier || !("rates" in tier)) {
    return tier && "price" in tier ? tier.price : 0;
  }
  const b = bracketFor(seats).key;
  return Math.max(seats * tier.rates[b], tier.floors[b]) + (tier.flat || 0);
}
