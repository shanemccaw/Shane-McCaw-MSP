/**
 * govPages.ts — the Governance drill-down page content.
 *
 * Transcribed VERBATIM from `GOV_PAGES` in
 * `Customer Portal Shell.dc.html` (line 7329 onward). Copy is final and written
 * in Shane's voice; the handoff says explicitly not to rewrite, shorten or
 * "improve" any of it, so every string here is character-for-character the
 * prototype's.
 *
 * ── This is design content, not tenant data ─────────────────────────────────
 * The numbers below (23 drift events, 9 anonymous links, the named accounts)
 * are the prototype's fictional tenant. They are NOT presented as live figures:
 * the page that renders them carries an explicit banner saying so, and the
 * fixture lives here — one file — so it can be swapped for the real
 * evidence read once a customer-scoped route exists for it.
 *
 * The real backend for this page does not exist yet. The nearest real source is
 * `tenant_check_item_details.items` (the full evidence list, keyed on the M365
 * `tenants.tenantId`, NOT the customerId JWT claim) plus `monitor_checks.endpoint`
 * for the provenance calls — which is why the provenance block below is modelled
 * on real Graph/PowerShell calls rather than invented ones. Wiring that is Phase
 * 3 of the build plan.
 */

export type GovTone = "red" | "amber" | "green" | "blue" | "slate";
export type GovProvenanceSrc = "graph" | "ps" | "derived";

export interface GovProvenanceEntry {
  src: GovProvenanceSrc;
  call: string;
  scope: string;
  note: string;
}

export interface GovStat {
  label: string;
  value: string;
  sub: string;
  tone: GovTone;
  /** When present, the stat gets a wrench that opens the CR gate on this key. */
  fixKey?: string;
}

export interface GovTableCol {
  label: string;
  /** CSS grid track, e.g. "minmax(96px,.7fr)". */
  w: string;
  mono?: boolean;
}

export interface GovRowAction {
  label: string;
  sub: string;
  fixKey: string;
}

export interface GovTableRow {
  cells: string[];
  chips?: { label: string; tone: GovTone }[];
  detail: {
    facts: { k: string; v: string }[];
    groups?: { label: string; items: { primary: string; secondary: string }[] }[];
    actions?: GovRowAction[];
  };
}

export interface GovPolicyRow {
  name: string;
  detail: string;
  status: string;
  tone: GovTone;
  fixKey?: string;
}

export interface GovPage {
  heading: string;
  purpose: string;
  note: string;
  provenance: GovProvenanceEntry[];
  stats: GovStat[];
  risks: string[];
  table: { label: string; note: string; cols: GovTableCol[]; rows: GovTableRow[] };
  policy: { label: string; note: string; rows: GovPolicyRow[] };
}

/** Tone → hex. Verbatim `govToneC` (line 7327). Note amber is #c2a63d here. */
export const GOV_TONE: Readonly<Record<GovTone, string>> = {
  red: "#f87171",
  amber: "#c2a63d",
  green: "#34d399",
  blue: "#60a5fa",
  slate: "#94a3b8",
};

/** Provenance source → label + hex. Verbatim `govSrcMeta` (line 7322). */
export const GOV_SRC_META: Readonly<Record<GovProvenanceSrc, { label: string; c: string }>> = {
  graph: { label: "Graph", c: "#60a5fa" },
  ps: { label: "PowerShell", c: "#22d3ee" },
  derived: { label: "Derived", c: "#a78bfa" },
};

/** The mono stack the prototype's `mono` helper expands to. */
export const GOV_MONO = "'SF Mono',Menlo,Consolas,monospace";

export const GOV_PAGES: Readonly<Record<string, GovPage>> = {
  "governance-sharing-drift": {
    heading: "External Sharing Drift",
    purpose:
      "Every sharing change since your first scan — who made it, on what, and whether it took your tenant further from baseline. Drift is visibility, not a fix queue: some of these are legitimate.",
    note: "Sharing events are not in the directory audit log. They come from the unified audit log (SharePoint sharing record types), which is why this page reads from both Graph and Exchange Online PowerShell in your container.",
    provenance: [
      {
        src: "ps",
        call: "Search-UnifiedAuditLog -RecordType SharePointSharingOperation -Operations SharingSet,SharingInvitationCreated,AnonymousLinkCreated,AddedToSecureLink,SharingPolicyChanged -StartDate (Get-Date).AddDays(-30)",
        scope: "Exchange Online: View-Only Audit Logs",
        note: "The event stream behind every row on this page. Paginate with -SessionId and -SessionCommand ReturnLargeSet.",
      },
      {
        src: "graph",
        call: "POST /beta/security/auditLog/queries",
        scope: "AuditLogsQuery.Read.All",
        note: "Async alternative to Search-UnifiedAuditLog. Better for backfill; slower for the 24-hour delta.",
      },
      {
        src: "ps",
        call: "Get-SPOSite -Limit All | Select Url,SharingCapability,SharingDomainRestrictionMode,DisableSharingForNonOwners",
        scope: "SharePoint Administrator",
        note: "Per-site sharing posture, compared against the tenant baseline to compute drift.",
      },
      {
        src: "ps",
        call: "Get-SPOTenant | Select SharingCapability,DefaultSharingLinkType,DefaultLinkPermission,RequireAnonymousLinksExpireInDays,PreventExternalUsersFromResharing,SharingDomainRestrictionMode",
        scope: "SharePoint Administrator",
        note: "The tenant baseline. Every setting in the policy block below comes from this call.",
      },
      {
        src: "graph",
        call: "/v1.0/sites/{siteId}/drive/items/{itemId}/permissions",
        scope: "Sites.Read.All",
        note: "Resolves a sharing event to the live link: scope, expiry, and whether it still grants edit.",
      },
      {
        src: "derived",
        call: "baselineDelta(site.SharingCapability, tenant.SharingCapability)",
        scope: "—",
        note: "A site is in drift when its own capability is more permissive than the tenant setting. This is the field the score is built on.",
      },
    ],
    stats: [
      { label: "Drift events", value: "23", sub: "last 30 days, 3 new since last scan", tone: "red" },
      {
        label: "Anonymous links created",
        value: "9",
        sub: "4 with edit permission",
        tone: "red",
        fixKey: "gov-drift-anon-expiry",
      },
      {
        label: "Sites above baseline",
        value: "3",
        sub: "own setting is more permissive",
        tone: "red",
        fixKey: "gov-drift-reset-sites",
      },
      { label: "Policy changes", value: "2", sub: "tenant or site sharing settings", tone: "amber" },
      { label: "Mean time to detection", value: "11 hrs", sub: "event to your dashboard", tone: "green" },
    ],
    risks: [
      'Nine anonymous links were created in 30 days and none of them expire — the tenant has no expiry set, so an "Anyone" link is permanent until someone remembers it',
      "Four of those nine grant edit, not view, so the recipient can change the document and its version history",
      "Three sites now carry a sharing capability more permissive than the tenant baseline, all set by site admins rather than by policy",
      "Resharing by external users is permitted, so a link handed to one vendor can be forwarded onward without a further event in your tenant",
      "Two sharing policy changes in 30 days were made outside a change window, and neither has a ticket reference",
    ],
    table: {
      label: "Drift Timeline",
      note: "Newest first. Operation names are the audit-log values so you can search for them directly.",
      cols: [
        { label: "When", w: "minmax(96px,.7fr)", mono: true },
        { label: "Operation", w: "minmax(150px,1.1fr)", mono: true },
        { label: "Target", w: "minmax(160px,1.5fr)" },
        { label: "Actor", w: "minmax(130px,1fr)" },
        { label: "Scan", w: "minmax(64px,.5fr)", mono: true },
      ],
      rows: [
        {
          cells: [
            "3 days ago",
            "AnonymousLinkCreated",
            "Client Deliverables · /FY26 Pricing.xlsx",
            "j.park@tenant.com",
            "scan 14",
          ],
          chips: [
            { label: "Edit link", tone: "red" },
            { label: "No expiry", tone: "red" },
          ],
          detail: {
            facts: [
              { k: "Link scope", v: "Anyone with the link · edit · no expiry date set" },
              {
                k: "Site",
                v: "/sites/client-deliverables · SharingCapability: ExternalUserAndGuestSharing",
              },
              {
                k: "Audit record",
                v: "RecordType 14 (SharePointSharingOperation) · Operation AnonymousLinkCreated",
              },
              {
                k: "Access since",
                v: "41 opens from 9 distinct IPs, 3 of them outside your approved countries",
              },
              {
                k: "Baseline position",
                v: "The tenant allows this. The site allows this. Nothing was violated — which is the finding.",
              },
            ],
            groups: [
              {
                label: "Why this one is first",
                items: [
                  {
                    primary: "Edit + no expiry + pricing data",
                    secondary:
                      "The combination, not any single attribute, is what makes it the highest-value row on the page",
                  },
                ],
              },
            ],
            actions: [
              {
                label: "Set a 30-day expiry on anonymous links tenant-wide",
                sub: "Applies to new links; existing links get an expiry stamped on next access",
                fixKey: "gov-drift-anon-expiry",
              },
            ],
          },
        },
        {
          cells: ["5 days ago", "SharingSet", "Q3 Sales Enablement", "k.osei@tenant.com", "scan 14"],
          chips: [{ label: "Site above baseline", tone: "red" }],
          detail: {
            facts: [
              {
                k: "Change",
                v: "Site SharingCapability raised from ExistingExternalUserSharingOnly to ExternalUserAndGuestSharing",
              },
              { k: "Made by", v: "Site collection administrator, not a SharePoint Administrator" },
              {
                k: "Tenant baseline",
                v: "ExistingExternalUserSharingOnly — this site is now more permissive than the tenant intends",
              },
              {
                k: "Effect",
                v: "Anonymous links became possible on this site the moment the change was made",
              },
            ],
            groups: [
              {
                label: "How this happens",
                items: [
                  {
                    primary: "Site admins can raise their own site above the tenant setting",
                    secondary:
                      "The tenant value is a ceiling for new sites, not an enforced floor for existing ones",
                  },
                ],
              },
            ],
            actions: [
              {
                label: "Reset this site to inherit the tenant baseline",
                sub: "Removes the site-level exception and closes the drift",
                fixKey: "gov-drift-reset-sites",
              },
            ],
          },
        },
        {
          cells: [
            "9 days ago",
            "SharingInvitationCreated",
            "Vendor Onboarding Packet",
            "m.alvarez@tenant.com",
            "scan 13",
          ],
          chips: [{ label: "New guest", tone: "amber" }],
          detail: {
            facts: [
              { k: "Invited", v: "a.klein@vendor-partner.com · guest account created on acceptance" },
              { k: "Permission", v: "Contribute on the document library" },
              { k: "Guest count effect", v: "Took the tenant from 33 to 34 guests" },
              { k: "Assessment", v: "Legitimate. Listed for the record, not as a problem." },
            ],
            groups: [],
            actions: [],
          },
        },
        {
          cells: [
            "15 days ago",
            "AnonymousLinkCreated",
            "Marketing Assets · brand-kit.zip",
            "r.delgado@tenant.com",
            "scan 12",
          ],
          chips: [
            { label: "View link", tone: "amber" },
            { label: "No expiry", tone: "red" },
          ],
          detail: {
            facts: [
              { k: "Link scope", v: "Anyone with the link · view · no expiry" },
              {
                k: "Content sensitivity",
                v: "Brand assets. Low sensitivity, but the link is still permanent.",
              },
              { k: "Access since", v: "312 opens — this link has been distributed widely" },
            ],
            groups: [
              {
                label: "Pattern worth naming",
                items: [
                  {
                    primary: "Permanent links become distribution channels",
                    secondary:
                      "A link with 312 opens and no expiry is now infrastructure. Expiry has to be introduced deliberately, not silently.",
                  },
                ],
              },
            ],
            actions: [
              {
                label: "Set a 30-day expiry on anonymous links tenant-wide",
                sub: "This link needs a replacement plan first — 312 opens means someone depends on it",
                fixKey: "gov-drift-anon-expiry",
              },
            ],
          },
        },
        {
          cells: [
            "18 days ago",
            "SharingPolicyChanged",
            "Tenant · DefaultSharingLinkType",
            "d.cho@tenant.com",
            "scan 12",
          ],
          chips: [
            { label: "Tenant-level", tone: "red" },
            { label: "No ticket", tone: "amber" },
          ],
          detail: {
            facts: [
              { k: "Change", v: "DefaultSharingLinkType changed from Direct to AnonymousAccess" },
              {
                k: "Effect",
                v: 'Every share dialog now defaults to "Anyone with the link" rather than "Specific people"',
              },
              { k: "Made by", v: "d.cho@tenant.com — account since disabled" },
              { k: "Change record", v: "None. No ticket reference and no approval trail." },
              {
                k: "Correlation",
                v: "7 of the 9 anonymous links in this window were created after this change",
              },
            ],
            groups: [
              {
                label: "Why this is the root cause row",
                items: [
                  {
                    primary: "One default changed user behaviour at scale",
                    secondary:
                      "Users did not start choosing anonymous links. The dialog started choosing it for them.",
                  },
                ],
              },
            ],
            actions: [
              {
                label: "Set the default sharing link back to Specific people",
                sub: "The single highest-leverage change on this page",
                fixKey: "gov-drift-default-link",
              },
            ],
          },
        },
        {
          cells: [
            "22 days ago",
            "AddedToSecureLink",
            "Board Materials · Q2 Pack",
            "External: c.obi@advisory.com",
            "scan 11",
          ],
          chips: [{ label: "Reshared", tone: "red" }],
          detail: {
            facts: [
              {
                k: "What happened",
                v: "An external user added another external user to an existing secure link",
              },
              { k: "Original recipient", v: "c.obi@advisory.com, invited by the CFO 4 months ago" },
              { k: "Added", v: "j.mercer@advisory.com — never invited by anyone in your tenant" },
              { k: "Setting that allows it", v: "PreventExternalUsersFromResharing: False" },
            ],
            groups: [
              {
                label: "Why resharing matters more than it looks",
                items: [
                  {
                    primary: "The chain leaves your audit trail",
                    secondary:
                      "You see the add. You do not see what happens after the person you never invited forwards it again.",
                  },
                ],
              },
            ],
            actions: [
              {
                label: "Block resharing by external users",
                sub: "External recipients can still use their own link, but cannot extend it to others",
                fixKey: "gov-drift-block-resharing",
              },
            ],
          },
        },
      ],
    },
    policy: {
      label: "Tenant sharing settings",
      note: "Read from Get-SPOTenant. These are the settings that decide whether next month looks like this one.",
      rows: [
        {
          name: "SharingCapability",
          detail:
            "ExistingExternalUserSharingOnly at tenant level, but 3 sites sit above it. The tenant value does not clamp existing sites.",
          status: "Drift",
          tone: "red",
          fixKey: "gov-drift-reset-sites",
        },
        {
          name: "DefaultSharingLinkType",
          detail:
            'AnonymousAccess. Every share dialog opens on "Anyone with the link" — changed 18 days ago with no change record.',
          status: "Anonymous",
          tone: "red",
          fixKey: "gov-drift-default-link",
        },
        {
          name: "RequireAnonymousLinksExpireInDays",
          detail:
            "0 — anonymous links never expire. Microsoft supports up to 730 days; 30 is the common baseline.",
          status: "No expiry",
          tone: "red",
          fixKey: "gov-drift-anon-expiry",
        },
        {
          name: "PreventExternalUsersFromResharing",
          detail: "False. External recipients can add other external users to a link you granted.",
          status: "Allowed",
          tone: "red",
          fixKey: "gov-drift-block-resharing",
        },
        {
          name: "DefaultLinkPermission",
          detail:
            "Edit. A default that hands out write access unless the user notices and changes it.",
          status: "Edit",
          tone: "amber",
          fixKey: "gov-drift-default-permission",
        },
        {
          name: "SharingDomainRestrictionMode",
          detail:
            "None. Sharing is permitted with any external domain, including personal mail providers.",
          status: "Unrestricted",
          tone: "amber",
          fixKey: "gov-drift-domain-allowlist",
        },
        {
          name: "Alert policy on AnonymousLinkCreated",
          detail:
            "No alert configured, so the 11-hour detection time depends entirely on the scan cadence.",
          status: "Missing",
          tone: "amber",
          fixKey: "gov-drift-alert",
        },
      ],
    },
  },
};

export function govPageFor(key: string | undefined): GovPage | null {
  return (key && GOV_PAGES[key]) || null;
}
