/**
 * hltDashboardData.ts — the Health pillar dashboard fixture.
 *
 * Transcribed from the prototype's own Health logic
 * (`Customer Portal Shell.dc.html` lines 12945-13285).
 *
 * ── The prototype opens with a naming problem, and solves it on the page ────
 * Its source comment: "the overview is 'M365 Health' across all six pillars.
 * This page is the infrastructure and configuration layer underneath it, so it
 * is titled and located explicitly."
 *
 * In the current handoff that disambiguation is carried by exactly two things,
 * and no more: a back link reading "M365 Health overview" rather than
 * "Overview" — the only pillar whose back link differs — and a LOCATOR CHIP ROW
 * of all six pillars with "· you are here" appended to this one (proto
 * 2891-2897). An earlier revision also had a prose disambiguation banner; the
 * current design dropped it (there is no `hltBanner`/`bannerTitle` symbol
 * anywhere in the shell), so it is not reproduced here.
 *
 * ── Debt goes down, so the trend is inverted ───────────────────────────────
 * The trend counts OPEN DEBT ITEMS, where lower is better, and its end-point
 * dot is RED on a GREEN line. The caption says why in words: "The last point is
 * red because the direction changed, not because the number is high." Colouring
 * that dot green — the obvious choice from every other pillar — would state the
 * opposite of what the page says.
 *
 * ── Design content, not tenant data ─────────────────────────────────────────
 * The prototype's fictional Halden Materials figures, in one module.
 *
 * ── Debt items are now real (Git #1442) ──────────────────────────────────────
 * Same #1255 pattern `cmpDrilldownModel.ts`'s `cmpFindingRowFromLive` already
 * proved for Compliance's Open gaps page: `HLT_FINDINGS` stays as the
 * loading-state placeholder only. Once the tenant's own Health pillar card
 * (`live.pillars.find(p => p.key === "health")`) is `present`, its real
 * `findings` render through `hltFindingRowFromLive` below, including a real
 * empty list when the tenant genuinely has none — never the fixture's Halden
 * Materials copy once a real payload has arrived.
 */

import type { PortalV2Finding } from "./portalV2Model";

export type HltTone = "red" | "amber" | "green";
export type HltServiceTone = "red" | "amber" | "green" | "blue";
export type HltSeverity = "high" | "medium" | "low";

/** `hltGreen` (12950). */
export const HLT_GREEN = "#22C55E";
export const HLT_GREEN_TEXT = "#4ade80";

export const HLT_TONE: Readonly<Record<HltTone, string>> = {
  red: "#f87171",
  amber: "#c2a63d",
  green: "#34d399",
};

export const HLT_SERVICE_TONE: Readonly<Record<HltServiceTone, string>> = {
  ...HLT_TONE,
  blue: "#60a5fa",
};

/** Hero copy — 12951 and the literals inline in the markup. */
export const HLT_HERO = {
  score: 66,
  /** Hardcoded in the ring markup (2940) and RED — debt is trending up. */
  delta: "-2 this month",
  /** The back link reads differently here than on any other pillar. */
  backLabel: "M365 Health overview",
  /** The fixture/unscored fallback only — see `hltAcceptedStripSuffix` for the live sentence. */
  acceptedStripSuffix: "accepted risk on record · AD FS retained",
  eyebrow: "Where the debt is",
  headline: "You cleared 57 objects across scans 1 to 8. The last two scans added 7 back.",
  standfirst:
    "Nothing runs on a schedule, so the count rises between manual passes. The fix for that is the boring one: thresholds and cleanup rules, not another cleanup weekend.",
  trendLabel: "Open debt items · lower is better",
  trendCaption:
    "128 → 71 → 78. The last point is red because the direction changed, not because the number is high.",
} as const;

// NO-BACKEND-TO-WIRE: no per-scan historical time series of "open debt item
// count" exists anywhere in the platform. `pillar.trend.series` (the real,
// replayed history `useLivePillarHero` exposes) is the pillar's SCORE history,
// a different measurement — plotting it here would silently answer a
// question the design never asked. `HLT_DEBT_HISTORY` and the trend drawn
// from it stay fixture-only, and the page renders an honest no-live-data
// state for this widget rather than this invented 10-point series.
export const HLT_DEBT_HISTORY: readonly number[] = [128, 121, 113, 104, 96, 88, 79, 71, 74, 78];

/**
 * `hltTrend` (12953-12966). A FOURTH distinct domain across the six pillars:
 * floor padded by EIGHT, ceiling by SIX. Governance/Security/Compliance use ±3;
 * Adoption uses −4/+3; Licensing anchors at 0 with a ×1.12 ceiling. The wider
 * pad here is because the series spans 128 down to 71 — a ±3 pad on that range
 * would put the endpoints hard against the frame.
 */
export function hltTrendGeometry() {
  const w = 280;
  const h = 84;
  const min = Math.min(...HLT_DEBT_HISTORY) - 8;
  const max = Math.max(...HLT_DEBT_HISTORY) + 6;
  const pts = HLT_DEBT_HISTORY.map((v, i) => {
    const x = (i / (HLT_DEBT_HISTORY.length - 1)) * w;
    const y = h - ((v - min) / (max - min || 1)) * h;
    return { x: +x.toFixed(1), y: +y.toFixed(1) };
  });
  return {
    w,
    h,
    line: pts.map((p) => `${p.x},${p.y}`).join(" "),
    area:
      `M${pts[0].x},${h} L` +
      pts.map((p) => `${p.x},${p.y}`).join(" L") +
      ` L${pts[pts.length - 1].x},${h} Z`,
    lastX: pts[pts.length - 1].x,
    lastY: pts[pts.length - 1].y,
  };
}

/* The three hero stats are declared after the tables they sum — see below. */

/* ── Directory sync & hybrid — HLT_SYNC (12982-12991) ─────────────────────── */

// NO-BACKEND-TO-WIRE: no check anywhere in the catalog reads Entra Connect /
// hybrid sync state (Get-ADSyncScheduler, Connect Health agent status, sync
// error counts) — that data lives on the customer's own on-premises sync
// server via PowerShell, not Microsoft Graph, and no `requires_customer_script`
// check for it has been built. This table is not rendered anywhere on the
// current page (dead fixture, kept for the prototype's own record); the hero
// stat it would have backed ("Directory sync" below) is tagged separately.
export const HLT_SYNC: readonly { stage: string; state: string; tone: HltTone; detail: string }[] = [
  { stage: "Entra Connect Sync", state: "Running · v2.1.20.0", tone: "red", detail: "Two versions behind. Microsoft only supports the current and previous release, and builds older than 18 months stop syncing without warning." },
  { stage: "Last successful sync", state: "3 hours ago", tone: "amber", detail: "Delta sync runs every 30 minutes. A 3-hour gap means the last four cycles did not complete cleanly." },
  { stage: "Sync errors", state: "14 objects", tone: "red", detail: "9 duplicate attribute, 3 invalid UPN suffix, 2 federated domain mismatch. Those 14 people do not exist correctly in the cloud." },
  { stage: "Staging server", state: "None", tone: "red", detail: "One sync server, no staging mode standby. If it fails, on-premises changes stop reaching the cloud until it is rebuilt." },
  { stage: "Password hash sync", state: "Enabled", tone: "green", detail: "Correct, and the right choice for resilience. It keeps sign-in working if federation has a bad day." },
  { stage: "Password writeback", state: "Off", tone: "amber", detail: "Self-service password reset cannot write back on-premises, so a cloud reset leaves the on-prem password unchanged." },
  { stage: "Connect Health agent", state: "Not reporting", tone: "red", detail: "Silent for 11 days. Microsoft’s own alerting on this server is effectively off." },
  { stage: "Sync scope", state: "3 stale OUs", tone: "amber", detail: "Three organisational units in scope contain only disabled or deleted objects, which is where most of the duplicate-attribute errors come from." },
];

/* ── Stale object inventory — HLT_OBJECTS (13002-13012) ───────────────────── */

export interface HltObject {
  type: string;
  count: number;
  oldest: string;
  where: string;
  note: string;
  tone: HltTone;
  fixKey: string;
}

export const HLT_OBJECTS: readonly HltObject[] = [
  { type: "Stale device records", count: 31, oldest: "412 days since last sign-in", where: "Entra ID", note: "No cleanup rule exists, so device records accumulate indefinitely.", tone: "amber", fixKey: "hlt-stale-devices" },
  { type: "Duplicate device records", count: 9, oldest: "2 records for the same hardware ID", where: "Entra ID + Intune", note: "Re-enrolled devices that left the old record behind. Compliance reporting counts both.", tone: "amber", fixKey: "hlt-duplicate-devices" },
  { type: "App registrations with no owner", count: 61, oldest: "created 4 years ago", where: "Entra ID", note: "When a credential expires there is nobody to notify, which is how a reporting job failed silently for 8 days.", tone: "red", fixKey: "hlt-app-owners" },
  { type: "Credentials expiring in 30 days", count: 3, oldest: "12 days away", where: "App registrations", note: "Two belong to unowned registrations, so nothing is watching them.", tone: "red", fixKey: "hlt-credentials" },
  { type: "Credentials already expired", count: 1, oldest: "expired 8 days ago", where: "App registrations", note: "The Legacy Reporting Service — still retrying 44 times a day and failing.", tone: "red", fixKey: "hlt-credentials" },
  // NOTE: this one points at a SECURITY pillar key, not a Health one — the same
  // dormant service principals are the OAuth page's subject from the consent
  // angle. Cross-pillar by design; see the note on HLT_DRIFT below.
  { type: "Service principals with no sign-in", count: 14, oldest: "18 months dormant", where: "Enterprise apps", note: "Dormant service principals keep their grants. Cross-referenced on the Security OAuth page.", tone: "amber", fixKey: "oauth-dormant" },
  { type: "Empty security groups", count: 18, oldest: "created 3 years ago", where: "Entra ID", note: "Several are referenced in Conditional Access exclusions, so they are not simply deletable.", tone: "amber", fixKey: "hlt-empty-groups" },
  { type: "Unassigned Intune profiles", count: 6, oldest: "created 14 months ago", where: "Intune", note: "Profiles that exist and target nothing. They make the real configuration harder to read.", tone: "amber", fixKey: "hlt-orphan-profiles" },
  { type: "Disabled accounts never removed", count: 23, oldest: "disabled 14 months ago", where: "Entra ID", note: "11 still hold licences and 4 still own groups — both tracked on their own pages.", tone: "amber", fixKey: "hlt-disabled-accounts" },
];

/** `hltObjectTotal` (13024) — summed, and it is the "78" the hero stat prints. */
export function hltObjectTotalFor(objects: readonly { count: number }[]): number {
  return objects.reduce((a, o) => a + o.count, 0);
}

export const HLT_OBJECT_TOTAL = hltObjectTotalFor(HLT_OBJECTS);

/**
 * Overlay real counts onto the itemized inventory (Git #1340, then widened by
 * #1442). Investigated all 9 rows against the real check each maps to — a
 * count matching the fixture row's LABEL is not the same as a count matching
 * what the row actually CLAIMS, same standard #1233's OAuth evidence page
 * wiring already applied:
 *
 *   - "Stale device records"        -> intune.staleDeviceRecordCount
 *     (devices:stale-duplicate-records) — matches exactly.
 *   - "Duplicate device records"    -> intune.duplicateDeviceRecordCount
 *     (same check, the duplicate-hardware-ID half) — matches exactly.
 *   - "Credentials already expired" -> governance.expiredPasswordCredentialCount
 *     + governance.expiredKeyCredentialCount (appgov:cert-secret-expiration,
 *     #541) — matches exactly; the fixture row does not split by credential
 *     type, so the two real halves are summed.
 *   - "Unassigned Intune profiles"  -> intune.unassignedProfileCount
 *     (devices:unassigned-intune-profiles, #1260) — matches exactly: a
 *     profile with an empty `assignments` expand targets nothing, exactly the
 *     fixture row's own description.
 *   - "Empty security groups"       -> governance.emptySecurityGroupCount
 *     (governance:empty-security-groups, #1260) — matches exactly, filtered to
 *     pure security groups so it never counts M365 groups or DLs.
 *   - "Service principals with no sign-in" -> governance.dormantServicePrincipalCount
 *     (appgov:dormant-service-principals, #1260) — the closest REAL, non-beta
 *     v1.0 proxy available (a provisioning-state signal: zero app-role
 *     assignments), not literal observed sign-in activity. See that
 *     migration's own HONESTY NOTE before assuming this counts sign-in
 *     events; the fixture row's locked copy is reproduced as-is regardless.
 *   - "Disabled accounts never removed" -> identity.disabledAccountCount
 *     (identity:disabled-accounts) — matches exactly.
 *   - "App registrations with no owner" -> NOT WIRED.
 *     // NO-BACKEND-TO-WIRE: no check anywhere in the catalog can answer
 *     // "does this app registration have an owner" — appgov:stale-app-
 *     // registrations (#551) counts createdDateTime AGE bands only, with no
 *     // ownership expand in its stored properties, and the one ownerless-*
 *     // check that exists (governance:ownerless-groups) is GROUPS, a
 *     // different Graph resource. Stays on fixture, rendered as an honest
 *     // no-live-data row rather than a silent fixture number.
 *   - "Credentials expiring in 30 days" -> NOT WIRED.
 *     // NO-BACKEND-TO-WIRE: appgov:cert-secret-expiration (#541) can only
 *     // express "already expired" — its migration states plainly that
 *     // evalClause's day-operators are anchored backward from now only
 *     // (olderThanDays/newerThanDays), so a forward-looking "expiring within
 *     // N days" window does not exist as a signal yet. Stays on fixture,
 *     // rendered as an honest no-live-data row rather than a silent fixture
 *     // number.
 *
 * A null/unresolved field leaves that row on its fixture value — same
 * partial-overlay contract `securityOauthPageWithLive` and
 * `adpWorkloadsWithLive` use. Returns the SAME array reference when nothing
 * resolved, so a caller can tell "live" from "fixture" with `===`.
 */
export interface HltObjectsLive {
  staleDeviceRecordCount: number | null;
  duplicateDeviceRecordCount: number | null;
  expiredCredentialCount: number | null;
  unassignedIntuneProfileCount: number | null;
  emptySecurityGroupCount: number | null;
  dormantServicePrincipalCount: number | null;
  disabledAccountCount: number | null;
}

/** The 2 of 9 stale-object-inventory rows with no real check to overlay — see
 * the `NO-BACKEND-TO-WIRE:` comments above `hltObjectsWithLive`. Exported so
 * the page can render these two specific rows as an honest no-live-data state
 * instead of a silent fixture count. */
export const HLT_OBJECTS_NO_BACKEND: ReadonlySet<string> = new Set([
  "App registrations with no owner",
  "Credentials expiring in 30 days",
]);

export function hltObjectsWithLive(
  objects: readonly HltObject[],
  live: HltObjectsLive,
): readonly HltObject[] {
  if (Object.values(live).every((v) => v == null)) {
    return objects;
  }
  return objects.map((o) => {
    if (o.type === "Stale device records" && live.staleDeviceRecordCount != null) {
      return { ...o, count: live.staleDeviceRecordCount };
    }
    if (o.type === "Duplicate device records" && live.duplicateDeviceRecordCount != null) {
      return { ...o, count: live.duplicateDeviceRecordCount };
    }
    if (o.type === "Credentials already expired" && live.expiredCredentialCount != null) {
      return { ...o, count: live.expiredCredentialCount };
    }
    if (o.type === "Unassigned Intune profiles" && live.unassignedIntuneProfileCount != null) {
      return { ...o, count: live.unassignedIntuneProfileCount };
    }
    if (o.type === "Empty security groups" && live.emptySecurityGroupCount != null) {
      return { ...o, count: live.emptySecurityGroupCount };
    }
    if (o.type === "Service principals with no sign-in" && live.dormantServicePrincipalCount != null) {
      return { ...o, count: live.dormantServicePrincipalCount };
    }
    if (o.type === "Disabled accounts never removed" && live.disabledAccountCount != null) {
      return { ...o, count: live.disabledAccountCount };
    }
    return o;
  });
}

/**
 * Overlay the hero's "Stale objects" stat with a live-aware total (Git
 * #1340). `total` should come from `hltObjectTotalFor(hltObjectsWithLive(...))`
 * so the hero card and the itemized list below it always agree — the same
 * "same underlying data" requirement #1340 called out by name. Only 3 of 9
 * object classes have any live backing (see `hltObjectsWithLive`), so this is
 * always a PARTIAL live total when anything is live at all, never a fully
 * live 166 — that partial-ness is inherent to the data, not a bug.
 */
export function hltHeroStatsWithObjectTotal(
  stats: typeof HLT_HERO_STATS,
  total: number,
): typeof HLT_HERO_STATS {
  return stats.map((s) => (s.label === "Stale objects" ? { ...s, value: String(total) } : s));
}

/* ── Configuration drift — HLT_DRIFT (14835-14888) ────────────────────────── */

// NO-BACKEND-TO-WIRE: this 12-row table (and the "N of 47 tracked settings"
// hero stat / alert / approved counts derived from it) has no wiring path
// today, even though a REAL configuration-drift engine genuinely exists —
// investigated before tagging, per this issue's own instruction not to guess.
// `drift_events` (lib/db/src/schema/msp.ts) + `dashboard-resolvers.ts`'s
// `resolveDriftEvents` are real and portal-reachable today via
// `POST /api/dashboard/resolve` against the 17 `drift.*DriftCount` metric keys
// (lib/dashboard-registry/src/metrics.ts) — `m365-health/useM365HealthLive.ts`
// already consumes those same keys elsewhere in this app, as aggregate
// counts. But the SHAPE this table needs is a different, larger thing than an
// aggregate count: a per-setting inventory of all 47 tracked settings,
// including the ones that currently MATCH baseline ("clean" rows) and the
// ones recorded as a deliberate "accepted position" — neither of which
// `drift_events` represents at all (it only stores rows for settings that
// have actually deviated). Its own real verdict enum
// (`approved` / `attributed_unapproved` / `unattributed` / `informational`)
// is also not a 1:1 match for this table's six-value `HltVerdict` scale.
// Wiring this properly needs a product decision on that verdict-taxonomy
// mapping and on how (or whether) to represent "clean"/"accepted" rows the
// real engine doesn't track — the same "check exists, wiring is separate
// scoped follow-up" split #1260's own migration used. Until that decision is
// made, this table stays on fixture and the page renders an honest
// no-live-data state in its place rather than this invented inventory.
export type HltVerdict =
  | "unapproved"
  | "unattributed"
  | "drifted"
  | "approved"
  | "accepted"
  | "clean";

/**
 * `HLT_VERDICT` (14851-14858). Drift only means something next to the change
 * record: a setting that moved with an approved CR is process working; the same
 * setting moving without one is the finding. The `group` is the sort key — the
 * three group-0 verdicts (the alerts) float to the top, then approved, then
 * accepted positions, then the clean rows that match the baseline.
 */
export const HLT_VERDICT: Readonly<
  Record<HltVerdict, { c: string; label: string; lead: string; group: number }>
> = {
  unapproved: { c: "#f87171", label: "Changed without approval", lead: "No change request covers this", group: 0 },
  unattributed: { c: "#f87171", label: "Nobody owns this change", lead: "Made before the baseline — no actor, no request", group: 0 },
  drifted: { c: "#f97316", label: "Drifted on its own", lead: "Nobody changed it. The scope stopped matching reality", group: 0 },
  approved: { c: "#34d399", label: "Approved", lead: "Change control worked", group: 1 },
  accepted: { c: "#c2a63d", label: "Accepted position", lead: "Recorded decision, not a change", group: 2 },
  clean: { c: "#34d399", label: "Matches baseline", lead: "", group: 3 },
};

/**
 * The drift owners (`d.owner`).
 *
 * ── Emptied of the fictional Halden roster (Git #1342) ──────────────────────
 * The prototype resolved each row's owner through `raciChip` from the shared RACI
 * roster (7599-7609), and this map reproduced the four people the drift rows
 * reference: Priya Raman, Shane McCaw, Marcus Lee, Aisha Bello. The Health page is
 * WIRED (real pillar hero, object inventory), and this config-drift table renders
 * on it, so those fictional employees rendered as the "Answers for it" owner on a
 * real customer's screen — the same leak class as #1213-1216.
 *
 * There is no ownership/RACI table in the schema for any tenant (see
 * `ownershipWire.ts`'s header), so there is genuinely no owner to resolve to. The
 * map is now empty: `hltDriftOwner` already degrades an unknown id to the honest
 * "Unassigned" chip, so every drift row shows an honest unassigned owner rather
 * than an invented name. When a real drift-ownership source exists this map (or
 * its replacement) is where the real names hydrate.
 */
export const HLT_DRIFT_PEOPLE: Readonly<Record<string, { name: string; tone: string }>> = {};

/** Two-letter initials from a name, matching the prototype's `initialsOf` (7643). */
export function hltOwnerInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** The owner chip for a drift row — initials, name and tone, or an unassigned mark. */
export function hltDriftOwner(id: string): { init: string; name: string; tone: string } {
  const p = HLT_DRIFT_PEOPLE[id];
  return p
    ? { init: hltOwnerInitials(p.name), name: p.name, tone: p.tone }
    : { init: "—", name: "Unassigned", tone: "rgba(248,113,113,.14)" };
}

/**
 * Eight of these twelve rows carry a fixKey belonging to ANOTHER pillar —
 * `gov-drift-*`, `cmp-retention-coverage`, `cmp-audit-retention`, `ca-CA201-…`,
 * `legacy-smtp-off`. That is the design's point: drift is detected here and
 * remediated where the setting lives, so the wrench routes to the owning
 * pillar's playbook rather than duplicating it. Only the ones with no other home
 * (`hlt-compliance-grace`, `hlt-teams-policy-sprawl`) get a Health playbook.
 */
export interface HltDrift {
  setting: string;
  baseline: string;
  current: string;
  who: string;
  when: string;
  scope: string;
  tone: HltTone;
  fixKey: string | null;
  verdict: HltVerdict;
  owner: string;
  cr?: string;
  crNote?: string;
}

export const HLT_DRIFT: readonly HltDrift[] = [
  { setting: "DefaultSharingLinkType", baseline: "Direct", current: "AnonymousAccess", who: "d.cho@tenant.com", when: "18 days ago", scope: "SharePoint tenant", tone: "red", fixKey: "gov-drift-default-link", verdict: "unapproved", owner: "pr" },
  { setting: "TransportConfig · SmtpClientAuthenticationDisabled", baseline: "True", current: "False", who: "Unknown — pre-baseline", when: "Before scan 1", scope: "Exchange Online", tone: "red", fixKey: "legacy-smtp-off", verdict: "unattributed", owner: "pr" },
  { setting: "CA201 policy state", baseline: "On", current: "On, 6 exclusions added", who: "a.reyes@tenant.com", when: "6 weeks ago", scope: "Conditional Access", tone: "red", fixKey: "ca-CA201-AllUsers-AllApps-RequireMFA", verdict: "unapproved", owner: "sm" },
  { setting: "CA301 policy state", baseline: "On", current: "Report-only", who: "a.reyes@tenant.com", when: "94 days ago", scope: "Conditional Access", tone: "red", fixKey: "ca-CA301-Guests-AllApps-RequireMFA", verdict: "approved", owner: "sm", cr: "CR-0098", crNote: "Put into report-only for the guest MFA pilot. The CR closed 63 days ago and it was never taken back out." },
  { setting: "Intune compliance grace period", baseline: "1 day", current: "14 days", who: "k.osei@tenant.com", when: "5 weeks ago", scope: "Intune", tone: "amber", fixKey: "hlt-compliance-grace", verdict: "approved", owner: "ml", cr: "CR-0110", crNote: "Raised to stop the Bay 3 device lockouts during the scanner replacement. Approved, due to revert when the scanners land." },
  { setting: "Teams meeting policy assignment", baseline: "Global for all", current: "3 custom policies, 2 unused", who: "r.delgado@tenant.com", when: "2 months ago", scope: "Teams", tone: "amber", fixKey: "hlt-teams-policy-sprawl", verdict: "unapproved", owner: "pr" },
  { setting: "Retention policy scope", baseline: "All mailboxes", current: "Static scope, 12 uncovered", who: "Scope not updated", when: "8 months ago", scope: "Purview", tone: "red", fixKey: "cmp-retention-coverage", verdict: "drifted", owner: "ab" },
  { setting: "Site sharing on 3 sites", baseline: "Inherit tenant", current: "Site-level override", who: "Site admins", when: "Various", scope: "SharePoint sites", tone: "red", fixKey: "gov-drift-reset-sites", verdict: "unapproved", owner: "ml" },
  { setting: "Guest invitation setting", baseline: "Admins and inviters", current: "Everyone", who: "Unknown — pre-baseline", when: "Before scan 1", scope: "Entra ID", tone: "red", fixKey: "gov-guests-invites", verdict: "unattributed", owner: "sm" },
  { setting: "Audit retention policy", baseline: "1 year (planned)", current: "180 days (Standard)", who: "Licence-constrained", when: "n/a", scope: "Purview", tone: "amber", fixKey: "cmp-audit-retention", verdict: "accepted", owner: "ab", cr: "CMP-A3", crNote: "Not a change. The Audit Standard ceiling is 180 days and the licence to lift it is not held." },
  { setting: "Password expiry policy", baseline: "Never expires", current: "Never expires", who: "—", when: "—", scope: "Entra ID", tone: "green", fixKey: null, verdict: "clean", owner: "sm" },
  { setting: "Security defaults", baseline: "Off (CA in use)", current: "Off", who: "—", when: "—", scope: "Entra ID", tone: "green", fixKey: null, verdict: "clean", owner: "sm" },
];

/** `hltDriftCount` (14888) — non-green rows, which is the "10 of 47" figure. */
export const HLT_DRIFT_COUNT = HLT_DRIFT.filter((d) => d.tone !== "green").length;

export interface HltDriftRow extends HltDrift {
  isAlert: boolean;
  hasCr: boolean;
}

/**
 * `hltDriftRows` (14860-14885). Sorted by verdict group so the unexplained
 * changes sit at the top, then the ones with an approved change record, then
 * accepted positions, then the clean rows. The sort is stable, so rows inside a
 * group keep their declared order.
 */
export function hltDriftRows(): readonly HltDriftRow[] {
  return HLT_DRIFT.slice()
    .sort((a, b) => HLT_VERDICT[a.verdict].group - HLT_VERDICT[b.verdict].group)
    .map((d) => ({ ...d, isAlert: HLT_VERDICT[d.verdict].group === 0, hasCr: !!d.cr }));
}

/** `hltDriftAlerts` (14886) — rows that changed with no request behind them. */
export const HLT_DRIFT_ALERTS = hltDriftRows().filter((r) => r.isAlert).length;

/** `hltDriftApproved` (14887) — rows tied to a change record. */
export const HLT_DRIFT_APPROVED = hltDriftRows().filter((r) => r.hasCr).length;

/**
 * `kbInfo('hlt-drift')` (8131-8132) — the info-dot tooltip on the drift header.
 * The full article opens the knowledge-base overlay (a later part); the hover
 * card reproduces the title, the summary and the "Click to read it" cue.
 */
export const HLT_DRIFT_KBI = {
  title: "Configuration drift",
  summary: "A setting that moved. The question is whether a change request moved it.",
} as const;

/** `hltMcCount` (19819) — the Message Center notice count on the service-health header. */
export const HLT_MC_COUNT = "452";

/**
 * The three hero stats (2989-3005).
 *
 * TWO DIFFERENT OBJECT COUNTS LIVE ON THIS PAGE, and they are not a mistake.
 * The hero's "Stale objects" binds `hltObjectTotal` — the sum of ALL NINE
 * classes in the inventory, 166 — and its sub-label says "Across 9 object
 * classes". Debt item HLT-05 and the trend series both say 78, which is that
 * same inventory MINUS app registrations (61), credentials (3+1) and disabled
 * accounts (23): each of those three has its own debt item and its own
 * remediation, so counting them in the debt total would double-count the work.
 *
 * Both figures are the prototype's, and both are correct for what they measure.
 * The values are filled FROM the tables rather than typed, so the hero cannot
 * silently drift from the rows beneath it — which is exactly the mistake this
 * transcription made first time round, by hardcoding 78 here.
 */
export const HLT_HERO_STATS: readonly { label: string; value: string; sub: string }[] = [
  { label: "Directory sync", value: "14 errors", sub: "Unsupported build, no standby server" },
  {
    label: "Stale objects",
    value: String(HLT_OBJECT_TOTAL),
    sub: "Across 9 object classes, no cleanup rule",
  },
  {
    label: "Config drift",
    value: `${HLT_DRIFT_COUNT} of 47`,
    sub: "Settings that no longer match the baseline",
  },
];

/**
 * Overlay the honest no-live-data state onto the 2 of 3 hero stats with no
 * backend at all (#1442) — "Directory sync" (see the `NO-BACKEND-TO-WIRE:` tag
 * above `HLT_SYNC`) and "Config drift" (see the tag above `HLT_DRIFT`). Only
 * "Stale objects" has any real backing (`hltHeroStatsWithObjectTotal`), so
 * this always runs AFTER that overlay, replacing the other two unconditionally
 * rather than leaving them as silent fixture numbers.
 */
export function hltHeroStatsHonest(
  stats: typeof HLT_HERO_STATS,
  noDataValue: string,
): typeof HLT_HERO_STATS {
  return stats.map((s) =>
    s.label === "Directory sync"
      ? { ...s, value: noDataValue, sub: "No live data available" }
      : s.label === "Config drift"
        ? { ...s, value: noDataValue, sub: "No live data available" }
        : s,
  );
}

/**
 * The five object classes the DEBT count covers — the ones with no debt item of
 * their own. Their sum is the 78 that HLT-05 and the trend series quote.
 */
export const HLT_DEBT_OBJECT_CLASSES: readonly string[] = [
  "Stale device records",
  "Duplicate device records",
  "Service principals with no sign-in",
  "Empty security groups",
  "Unassigned Intune profiles",
];

export const HLT_DEBT_OBJECT_TOTAL = HLT_OBJECTS.filter((o) =>
  HLT_DEBT_OBJECT_CLASSES.includes(o.type),
).reduce((a, o) => a + o.count, 0);

/* ── Debt items — HLT_FINDINGS (13053-13119) ──────────────────────────────── */

export interface HltFinding {
  id: string;
  sev: HltSeverity;
  title: string;
  debt: string;
  why: string;
  evidence: { k: string; v: string }[];
  action: string;
  actionSub: string;
  fixKey: string;
}

/**
 * `hltSevMeta` (13119). The labels are the pillar's own vocabulary — Degrading /
 * Accruing / Housekeeping — not Critical / High / Low. Debt accrues; it does not
 * threaten. And this is the only pillar with a THIRD severity band.
 */
export const HLT_SEV_META: Readonly<Record<HltSeverity, { c: string; label: string }>> = {
  high: { c: "#f87171", label: "Degrading" },
  medium: { c: "#c2a63d", label: "Accruing" },
  low: { c: "#60a5fa", label: "Housekeeping" },
};

export const HLT_FINDINGS: readonly HltFinding[] = [
  {
    id: "HLT-01",
    sev: "high",
    title: "The Exchange hybrid server is past end of support",
    debt: "Unsupported since 14 October 2025",
    why: "Exchange 2019 reached end of support on 14 October 2025, so this server receives no security updates, no time-zone updates, and no support case coverage. It still works, which is exactly why it has stayed. Hybrid mail flow, free/busy lookups, and on-premises mailbox moves all depend on it.",
    evidence: [
      { k: "Build", v: "15.2.1544.4 · Exchange 2019 CU14, released before end of support" },
      { k: "Role in the estate", v: "Hybrid mail flow, free/busy federation, and the mailbox migration endpoint" },
      { k: "Mailboxes on-premises", v: "0 — every mailbox is already in the cloud" },
      { k: "Why it is still there", v: "Directory writeback and the hybrid configuration were never decommissioned after the migration finished" },
      { k: "Free/busy failures", v: "2 users currently affected, both with corrupted on-premises calendar permissions" },
      { k: "The actual options", v: "Move to Exchange Server Subscription Edition to stay hybrid, or decommission the last server now that no mailboxes remain on-premises" },
    ],
    action: "Scope the hybrid decommission",
    actionSub: "No mailboxes remain on-premises — decommission is the cheaper path, and we cost both",
    fixKey: "hlt-exchange-eol",
  },
  {
    id: "HLT-02",
    sev: "high",
    title: "Entra Connect is two versions behind with 14 objects failing to sync",
    debt: "Single point of failure, no standby",
    why: "The sync server is running an unsupported build, has no staging-mode standby, and its Connect Health agent has been silent for eleven days. Fourteen objects fail every cycle with duplicate attribute and UPN suffix errors, which means fourteen people do not exist correctly in the cloud.",
    evidence: [
      { k: "Version", v: "v2.1.20.0 — two releases behind. Microsoft supports the current and previous version only, and builds over 18 months old stop working." },
      { k: "Sync errors", v: "9 duplicate attribute, 3 invalid UPN suffix, 2 federated domain mismatch" },
      { k: "Root cause of most errors", v: "3 stale OUs in sync scope containing only disabled or deleted objects" },
      { k: "Resilience", v: "One server, no staging-mode standby. A failure stops on-premises changes reaching the cloud until it is rebuilt from scratch." },
      { k: "Monitoring", v: "Connect Health agent has not reported for 11 days, so Microsoft’s own alerting on this server is off" },
      { k: "Order of work", v: "Fix the errors first, then upgrade, then build the standby. Upgrading with 14 failing objects just moves the failures to a new build." },
    ],
    action: "Clear the sync errors, upgrade, then build a standby",
    actionSub: "Three stages in that order, each verified before the next",
    fixKey: "hlt-connect-sync",
  },
  {
    id: "HLT-03",
    sev: "medium",
    title: "61 app registrations have no owner and 4 credentials are expiring or expired",
    debt: "Nobody to notify when something breaks",
    why: "An unowned app registration has nobody to warn when its credential expires. That is not theoretical here — the Legacy Reporting Service credential expired eight days ago and the job has been failing 44 times a day since, unnoticed. Two of the three credentials expiring in the next month belong to unowned registrations.",
    evidence: [
      { k: "Registrations with no owner", v: "61 of 148" },
      { k: "Expired", v: "1 — Legacy Reporting Service, 8 days ago, 44 failed token requests a day" },
      { k: "Expiring within 30 days", v: "3, the nearest in 12 days. Two are unowned." },
      { k: "No lifetime policy", v: "App management policies are not configured, so credentials can be created with no expiry at all — 4 currently have none" },
      { k: "Related", v: "The same 61 registrations appear on the Security OAuth page from the consent and permission angle" },
    ],
    action: "Assign owners and enforce a credential lifetime policy",
    actionSub: "Owners proposed from usage; policy caps new credentials at 6 months",
    fixKey: "hlt-app-owners",
  },
  {
    id: "HLT-04",
    sev: "medium",
    title: "10 settings have drifted from your recorded baseline",
    debt: "Configuration no longer matches the record",
    why: "Ten settings differ from the baseline recorded at scan 1. Two changed before the baseline existed and cannot be attributed, and eight have a name and a date attached. Drift is not automatically wrong — but drift nobody decided is how a tenant ends up in a state nobody can explain.",
    evidence: [
      { k: "Drifted settings", v: "10 of 47 tracked" },
      { k: "Attributable", v: "8 have an actor and a timestamp from the audit log" },
      { k: "Unattributable", v: "2 predate the baseline. They are recorded as unknown rather than guessed." },
      { k: "Highest consequence", v: "DefaultSharingLinkType and SMTP AUTH — both already have their own findings on other pillars" },
      { k: "Change windows", v: "6 of the 8 attributable changes were made outside a change window with no ticket reference" },
      { k: "Baseline age", v: "Recorded at scan 1, 14 scans ago. It should be re-signed after this remediation round." },
    ],
    action: "Reconcile drift and re-sign the baseline",
    actionSub: "Each drift either reverted or adopted into the baseline deliberately",
    fixKey: "hlt-baseline-reconcile",
  },
  {
    id: "HLT-05",
    sev: "medium",
    title: "78 stale technical objects are accumulating with no cleanup rule",
    debt: "Entropy with no counter-pressure",
    why: "Thirty-one stale devices, nine duplicates, eighteen empty groups, six unassigned profiles, and fourteen dormant service principals. None of it is dangerous. All of it makes the real configuration harder to read, makes compliance counts wrong, and slows down every future investigation.",
    evidence: [
      { k: "Total objects", v: "78, up from 71 two scans ago" },
      { k: "Devices", v: "31 with no sign-in in 90+ days, oldest 412 days" },
      { k: "Duplicates", v: "9 device records sharing a hardware ID with another record" },
      { k: "Groups", v: "18 empty security groups, several referenced in Conditional Access exclusions — those are not simply deletable" },
      { k: "Why the count went up", v: "The last cleanup was scan 8. Nothing runs on a schedule, so the count rises between manual passes." },
      { k: "Effect on other pillars", v: "Device compliance percentages and licence counts are both computed against inflated denominators until this is cleaned" },
    ],
    action: "Run the cleanup and set the recurring rules",
    actionSub: "One pass now, then automatic thresholds so the count stops climbing",
    fixKey: "hlt-stale-devices",
  },
  {
    id: "HLT-06",
    sev: "low",
    title: "34 Message Center posts are unreviewed, 3 of them affect your configuration",
    debt: "Changes arriving unread",
    why: "Microsoft publishes changes to the Message Center and three of the current posts touch settings you rely on. Unread, they become surprises. This is the cheapest item on the page and the one most likely to prevent an incident nobody saw coming.",
    evidence: [
      { k: "Unreviewed posts", v: "34, oldest 4 months" },
      { k: "Relevant to your tenant", v: "3 — a Teams policy default change, a SharePoint sharing default, and a Conditional Access evaluation change" },
      { k: "Service advisories open", v: "3, all informational, none affecting users today" },
      { k: "Incidents in the last 30 days", v: "1 — Exchange Online delayed mail delivery, resolved in 4 hours" },
      { k: "No routing", v: "Nothing forwards relevant posts to a person or a channel, so review depends on someone remembering to look" },
    ],
    action: "Route Message Center posts to a channel with a weekly review",
    actionSub: "Filtered to services you actually use, not the full firehose",
    fixKey: "hlt-message-center",
  },
];

export const HLT_FINDING_COUNT = HLT_FINDINGS.length;

/**
 * Real evidence field names the server sends for Health-pillar checks, mapped
 * to the human label the row shows — the same `CMP_EVIDENCE_LABELS` idiom
 * `cmpDrilldownModel.ts` uses (#1255). A `checkKey` this catalogue doesn't
 * recognise still renders — humanised from the field name — rather than being
 * dropped.
 */
const HLT_EVIDENCE_LABELS: Readonly<Record<string, string>> = {
  staleDeviceRecordCount: "Stale device records",
  duplicateDeviceRecordCount: "Duplicate device records",
  unassignedIntuneProfileCount: "Unassigned Intune profiles",
  emptySecurityGroupCount: "Empty security groups",
  dormantServicePrincipalCount: "Service principals with no assigned access",
  disabledAccountCount: "Disabled accounts never removed",
  expiredPasswordCredentialCount: "Expired app secrets",
  expiredKeyCredentialCount: "Expired app certificates",
};

/** camelCase field name -> "Field name", for an evidence key not in the catalogue above. */
function hltHumanizeEvidenceKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The evidence rows a live finding's `evidence` object produces — same
 * curated name-list-subset contract #1255 established (never the raw
 * `extractedProperties` blob). Empty when the finding carries no evidence. */
function hltLiveEvidenceRows(evidence: Record<string, unknown> | null | undefined): { k: string; v: string }[] {
  if (!evidence) return [];
  const rows: { k: string; v: string }[] = [];
  for (const [key, value] of Object.entries(evidence)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      rows.push({ k: HLT_EVIDENCE_LABELS[key] ?? hltHumanizeEvidenceKey(key), v: String(value) });
      continue;
    }
    const names = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    if (names.length > 0) {
      rows.push({ k: HLT_EVIDENCE_LABELS[key] ?? hltHumanizeEvidenceKey(key), v: names.join(", ") });
    }
  }
  return rows;
}

/**
 * Map one real `war-room-pillars` Health finding (#1255's widened
 * `PortalV2Finding`) into the same `HltFinding` shape the page already
 * renders, so `portal-v2-health.tsx` needs no separate rendering path for
 * live vs fixture rows — the exact same seam `cmpFindingRowFromLive` proved
 * for Compliance.
 *
 * Honest-gap fields: this pillar's fixture carries a THIRD severity band
 * (Housekeeping/"low") that the real payload's `critical`/`warning` scale has
 * no signal for, so a live finding is always Degrading or Accruing, never
 * Housekeeping — an honest byproduct of what the engine actually measures,
 * not a fabrication. `debt` (the short state line under the severity chip)
 * and `why` fall back to the server's own `description`/`whyItMatters` when
 * present, and to an explicit "not authored yet" statement when they are not
 * — never an invented sentence. Same for `action`/`actionSub`: absent a
 * bespoke fix mapping, `fixKey` is the checkKey itself, which `playbookFor`
 * resolves to the generic "Apply the recommended change" flow.
 */
export function hltFindingRowFromLive(f: PortalV2Finding): HltFinding {
  const why = f.whyItMatters ?? f.description ?? "No further narrative is available for this finding yet.";
  const evidence = hltLiveEvidenceRows(f.evidence);
  return {
    id: f.checkKey,
    sev: f.severity === "critical" ? "high" : "medium",
    title: f.title,
    debt: f.recommendation?.category ?? (f.severity === "critical" ? "Open, unaddressed" : "Accruing"),
    why,
    evidence:
      evidence.length > 0
        ? evidence
        : [{ k: "Where this comes from", v: f.description ?? "Detected by the last scan; no further detail captured." }],
    action: f.recommendation?.action ?? "Apply the recommended change",
    actionSub: f.recommendation?.estimatedEffort
      ? `Estimated effort: ${f.recommendation.estimatedEffort}`
      : "Opens the fix flow for this finding",
    fixKey: f.checkKey,
  };
}

/** Map every real Health finding into the debt-item row shape, worst first (server order preserved). */
export function hltFindingRowsFromLive(findings: readonly PortalV2Finding[]): HltFinding[] {
  return findings.map(hltFindingRowFromLive);
}

/* ── Accepted risk — HLT_ACCEPTED (13150-13156) ───────────────────────────── */

// NO-BACKEND-TO-WIRE: there is no accepted-risk persistence anywhere in the
// platform. `openAcceptRisk`'s `onConfirm` on this page is a no-op (`() =>
// {}`), and the standalone Risk Register page (`portal-v2-risk-register.tsx`)
// this strip links to is itself 100% fixture with no write path either — the
// "Accept this risk" flow records nothing today, so there is no real decision
// to read back. This card and the strip's leading count render an honest
// no-live-data state rather than this invented "AD FS retained" example.

export const HLT_ACCEPTED: readonly {
  id: string;
  title: string;
  rationale: string;
  compensating: string;
  owner: string;
  approved: string;
  review: string;
  register: string;
  note: string;
}[] = [
  {
    id: "HLT-A1",
    title: "AD FS retained alongside cloud authentication",
    rationale:
      "Two line-of-business applications authenticate against AD FS and neither vendor supports modern authentication before their 2027 release. Removing AD FS would break both.",
    compensating:
      "AD FS servers patched monthly, certificate expiry monitored with a 60-day alert, and extranet lockout enabled. Password hash sync stays on so cloud sign-in survives an AD FS outage.",
    owner: "Head of Infrastructure",
    approved: "11 January 2026",
    review: "30 April 2027",
    register: "RR-2026-002",
    note: "Reviewed against the vendor roadmap rather than a calendar date, so the review moves if their release slips.",
  },
];

/**
 * The accepted-risk strip's suffix sentence (proto 2913-2923), decided on #1273:
 * the worst (highest-severity, most-recent-if-tied) REAL finding on this
 * tenant's own health payload, never the hardcoded "AD FS retained" text and
 * never a generic placeholder.
 *
 * "Most-recent-if-tied" is the decision's own tiebreak, but `msp_diagnostic_findings`
 * carries no per-finding timestamp on this wire — every finding for a tenant is
 * written in ONE batch when its scan run completes (see war-room-pillar-stats.ts's
 * own header), so a created-at column would not actually distinguish findings
 * from the same run. `worstFindingTitle` is the pillar's own `findings[0]` —
 * already ordered severity-first, then by the platform's real signal-weight
 * ranking (`compareRankedFindings`, the same ranking every other headline/
 * satellite/chip in the app reads as "worst first") — which is the honest
 * tiebreak this data actually supports.
 *
 * Falls back to the design fixture's own sentence, exactly as `useLivePillarHero`'s
 * score/delta fall back to `HLT_HERO`, when the tenant has no live finding to
 * report (unscored, or a clean scan with nothing critical/warning open).
 */
export function hltAcceptedStripSuffix(worstFindingTitle: string | null | undefined): string {
  return worstFindingTitle ? `accepted risk on record · ${worstFindingTitle}` : HLT_HERO.acceptedStripSuffix;
}

/** The accepted card's meta grid (13159-13164). Note "Accepted", not "Approved". */
export function hltAcceptedMeta(a: (typeof HLT_ACCEPTED)[number]) {
  return [
    { k: "Owner", v: a.owner },
    { k: "Accepted", v: a.approved },
    { k: "Next review", v: a.review },
    { k: "Risk register", v: a.register },
  ];
}

/* ── Service health & incoming changes — HLT_SERVICE (13166-13172) ────────── */

// NO-BACKEND-TO-WIRE: the tenant's real Message Center POSTS are wired
// (useMessageCenter.ts, shared with /portal-v2/ms-changes) and render live
// when the tenant has real posts. The two other row kinds this fixture mixes
// in — service INCIDENT and ADVISORY status — have no backend anywhere in
// this platform; Message Center carries posts only, never incident/advisory
// status. When there are no real live posts, the page renders an honest
// no-live-data state for this panel rather than this invented 5-row mix.

export const HLT_SERVICE: readonly {
  title: string;
  kind: string;
  when: string;
  impact: string;
  tone: HltServiceTone;
}[] = [
  { title: "Teams meeting policy default change", kind: "Message Center · MC-914203", when: "Rolling out from 12 September", impact: "Affects the 3 custom meeting policies you have in place. One of them relies on the current default.", tone: "amber" },
  { title: "SharePoint default sharing link change", kind: "Message Center · MC-908771", when: "Rolling out from 28 August", impact: "Interacts with the DefaultSharingLinkType drift already on this page. Fix the drift before this lands.", tone: "amber" },
  { title: "Conditional Access evaluation change", kind: "Message Center · MC-921044", when: "Announced, no date", impact: "Changes how report-only results are surfaced. Relevant while CA301 is still report-only.", tone: "blue" },
  { title: "Exchange Online delayed delivery", kind: "Incident EX1094882 · resolved", when: "9 days ago, 4h 12m", impact: "Root cause published. No action required, recorded for the reliability log.", tone: "green" },
  { title: "Teams advisory · call quality", kind: "Advisory TM1102341 · open", when: "Since 3 days ago", impact: "Informational. No users have reported impact and no configuration change is suggested.", tone: "blue" },
];

/* ── Provenance — HLT_PROV (13181-13190) ──────────────────────────────────── */

export const HLT_PROV: readonly {
  src: "graph" | "ps" | "derived";
  call: string;
  scope: string;
  note: string;
}[] = [
  { src: "ps", call: "Get-ADSyncScheduler | Select SyncCycleEnabled,NextSyncCyclePolicyType,LastSyncCycleStartTimeInUTC", scope: "Local admin on the sync server", note: "Sync cadence and last cycle. Runs on the server itself, not from the container." },
  { src: "graph", call: "/v1.0/directory/onPremisesSynchronization", scope: "OnPremDirectorySynchronization.Read.All", note: "Cloud-side view of sync configuration and feature state, including password writeback." },
  { src: "graph", call: "/beta/directory/deviceLocalCredentials · /v1.0/devices?$filter=approximateLastSignInDateTime le {date}", scope: "Device.Read.All", note: "Stale device identification by last sign-in, which is the field the cleanup rule uses." },
  { src: "graph", call: "/v1.0/applications?$select=id,displayName,passwordCredentials,keyCredentials&$expand=owners", scope: "Application.Read.All", note: "Credential expiry and ownership in one call — the source of both the 61 and the 4." },
  { src: "graph", call: "/v1.0/policies/appManagementPolicies", scope: "Policy.Read.All", note: "Whether a credential lifetime policy exists. Returns empty, which is why credentials with no expiry are possible." },
  { src: "graph", call: "/v1.0/serviceAnnouncement/messages · /serviceAnnouncement/issues", scope: "ServiceMessage.Read.All", note: "Message Center posts and service incidents, filtered to services this tenant actually uses." },
  { src: "ps", call: "Get-HybridConfiguration · Get-ExchangeServer | Select Name,AdminDisplayVersion,Edition", scope: "Exchange on-premises: View-Only Organization Management", note: "Hybrid configuration state and the on-premises build number behind the end-of-support finding." },
  { src: "derived", call: "drift(setting) = compare(currentValue, signedBaseline[setting]) + attribution(auditLog)", scope: "—", note: "Every tracked setting compared against the signed baseline, with the audit log supplying who and when. Two settings predate the baseline and are reported as unattributable rather than guessed." },
];
