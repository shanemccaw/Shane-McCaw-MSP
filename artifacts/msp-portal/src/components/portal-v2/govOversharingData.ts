/**
 * govOversharingData.ts — the Overshared SharePoint drill-down fixture.
 *
 * Transcribed VERBATIM from the prototype's `governance-oversharing` logic
 * (`Customer Portal Shell.dc.html` lines 11096-11400) — the non-`isPublicTeams`
 * branch of every one of those derivations.
 *
 * ── Which prototype section this is, and which it is NOT ────────────────────
 * The handoff README says the drill-down template's reference implementation is
 * "the Overshared SharePoint page (`governance-oversharing-full`)". Reading the
 * prototype, that pointer conflates three different sections:
 *
 *   • `isGovDetailV2`            (proto 4453-4625) — the GOV_PAGES-driven
 *     template that actually matches the README's stated anatomy: purpose →
 *     provenance → stat cards → evidence table → policy → wrench fixes. Ported
 *     already, in `govPages.ts` + `pages/portal-v2-gov-detail.tsx`.
 *   • `isGovOversharingDetail`   (proto 4671-5057) — what `governance-oversharing`
 *     ACTUALLY renders, and therefore what the Overshared SharePoint page is.
 *     THIS FILE. It has no provenance block and no tenant-policy block; it has a
 *     collapsed Top Risks band, two paginated evidence lists, per-site runbooks
 *     and an accept-risk flow, none of which the V2 template has.
 *   • `governance-oversharing-full` (proto 4627-4669) — the enterprise-scale
 *     "view all 23,412 sites" bulk list, reached from the governance finding row
 *     only when the tenant is large. See `govOversharingAllData` at the bottom.
 *
 * The prototype wins over the README's prose, per the handoff's own rule that
 * the markup and the logic class are the specification.
 *
 * ── Design content, not tenant data ─────────────────────────────────────────
 * Every figure here is the prototype's fictional Halden Materials tenant. The
 * fixture is one module so the swap to a real evidence read is a single-file
 * change — the nearest real source being `tenant_check_item_details.items` keyed
 * on the M365 `tenants.tenantId`.
 */

export type OversharingTone = "red" | "yellow" | "green";

export interface OversharingStat {
  label: string;
  value: string;
  sub: string;
  status: OversharingTone;
  /** `iconSvg` name — mapped to its lucide-react equivalent at render. */
  icon: "mail" | "users" | "key" | "git-commit";
  showFix: boolean;
  fixKey: string | null;
}

export interface SitePrincipal {
  name: string;
  upn: string;
  role?: string;
}

export interface OversharingSite {
  id: number;
  name: string;
  context: string;
  visibility: "Public" | "Private";
  admins: SitePrincipal[];
  guests: SitePrincipal[];
  status: "open" | "accepted";
  acceptedOn?: string;
  acceptedTerm?: string;
}

export interface AnonymousLink {
  id: number;
  site: string;
  file: string;
  type: "Edit" | "View";
  status: "active" | "expired";
}

/* ── Page copy — `oversharingHeading` / `oversharingDesc` (11140-11143) ────── */

export const OVERSHARING_HEADING = "Overshared SharePoint";
export const OVERSHARING_DESC =
  "Full sharing posture for this site — capability, external access, admins, and drift against your tenant baseline.";

/** `oversharingListLabel` / the admin+guest word pairs (11144-11148). */
export const OVERSHARING_LIST_LABEL = "Affected Sites";
export const ADMIN_WORD = "admins";
export const GUEST_WORD = "guests";
export const ADMIN_HEADER = "Site Admins";
export const GUEST_HEADER = "Guest Members";
/** `oversharingItemWord` (11152) — used by the all-resolved copy. */
export const ITEM_WORD = "site";

/**
 * `statusVisual` (11158-11162). Note yellow deliberately ignores its own `c` for
 * the wash and uses amber #fbbf24/#f59e0b, and that each tone carries its own
 * padding AND value size — severity changes the card's physical weight, not just
 * its colour. Same inconsistency as `GOV_STATUS_META`; preserved for the same
 * reason.
 */
export const OVERSHARING_STATUS_VISUAL: Readonly<
  Record<OversharingTone, { c: string; wash: string; pad: string; valSize: number }>
> = {
  red: {
    c: "#f87171",
    wash: "linear-gradient(160deg, #f8717112, rgba(15,23,42,.5))",
    pad: "13px 15px",
    valSize: 16,
  },
  yellow: {
    c: "#c2a63d",
    wash: "linear-gradient(135deg, #fbbf2426, #f59e0b14, rgba(15,23,42,.5))",
    pad: "10px 12px",
    valSize: 14,
  },
  green: {
    c: "#34d399",
    wash: "linear-gradient(160deg, #34d39910, rgba(15,23,42,.5))",
    pad: "8px 10px",
    valSize: 12,
  },
};

/** `oversharingStatCardDefs`, non-public-Teams branch (11166-11171). */
export const OVERSHARING_STATS: readonly OversharingStat[] = [
  {
    label: "Sharing Capability",
    value: "Enabled",
    sub: "ExternalUserAndGuestSharing",
    status: "red",
    icon: "mail",
    showFix: true,
    fixKey: "sharing-capability",
  },
  {
    label: "External Users",
    value: "14",
    sub: "with direct or inherited access",
    status: "red",
    icon: "users",
    showFix: false,
    fixKey: null,
  },
  {
    label: "Anonymous Links",
    value: "3 active, 1 expired",
    sub: "2 allow editing",
    status: "red",
    icon: "key",
    showFix: false,
    fixKey: null,
  },
  {
    label: "Sharing Drift",
    value: "Exceeds baseline",
    sub: "Site sharing > tenant policy",
    status: "red",
    icon: "git-commit",
    showFix: true,
    fixKey: "sharing-drift",
  },
];

/** `oversharingTopRisks`, non-public-Teams branch (11193-11199). */
export const OVERSHARING_TOP_RISKS: readonly string[] = [
  "Public Team exposes the entire site to anyone in the tenant",
  "Anonymous links found with edit access, not just view",
  "External users have edit permissions, not just view",
  "Excessive site admins on some sites increase exposure",
  "Site sharing capability exceeds the tenant-wide baseline policy",
];

/* ── The runbooks the per-site actions open (11262-11294) ──────────────────── */

export const CONVERT_TO_PRIVATE_STEPS: readonly string[] = [
  "Notify all site admins that this site is scheduled for conversion to Private",
  "Enable Restricted Content Discoverability (RCD) immediately — blocks this site from SharePoint search and Copilot results while the process runs",
  "Allow admins to submit a business justification to keep the site public (e.g. community practice, training, all-hands)",
  "If no admin responds within 30 days, convert the site to Private automatically",
];

export const REDUCE_ADMINS_STEPS: readonly string[] = [
  "Communicate to all current site admins that admin access will be reduced to 2",
  "Allow time for admins to remove themselves voluntarily",
  "Send a reminder to admins who haven’t acted",
  "Admin action: remove all but the 2 admins selected to remain",
];

export const MANAGE_GUESTS_STEPS: readonly string[] = [
  "Email all site admins: do you know this guest and are they still needed?",
  "Wait for admin response",
  "If needed — file a Risk-Based Decision (RBD) to formally accept and document why",
  "If not needed — admin removes the guest, or removal proceeds automatically",
];

/* ── Evidence: the sites (11296-11310) ────────────────────────────────────── */

const GENERATED_SITE_NAMES = [
  "Regional Ops",
  "Partner Exports",
  "Finance Close",
  "HR Onboarding",
  "Legal Archive",
  "IT Runbooks",
  "Design Assets",
  "Product Specs",
];

/**
 * `govSiteDetailRaw0` — 5 written-out sites plus 119 generated, `.map` giving
 * each its index as `id`. The generated block's arithmetic is the prototype's
 * exactly, including `(i * 7 + 12) % 300 + 4` binding as `((i*7+12) % 300) + 4`.
 */
const RAW_SITES: Omit<OversharingSite, "id">[] = [
  {
    name: "Client Deliverables (SharePoint)",
    context: "340 files · external link active",
    visibility: "Public",
    admins: [
      { name: "Alex Rivera", upn: "alex.rivera@tenant.com" },
      { name: "Jamie Chen", upn: "jamie.chen@tenant.com" },
      { name: "Priya Nair", upn: "priya.nair@tenant.com" },
      { name: "Diego Alvarez", upn: "diego.alvarez@tenant.com" },
      ...Array.from({ length: 48 }, (_, i) => ({
        name: `Staff Member ${i + 1}`,
        upn: `user${i + 1}.staff@tenant.com`,
      })),
    ],
    guests: [
      { name: "Rosa Delgado", upn: "r.delgado@tenant.com", role: "Contributor" },
      { name: "Kwame Osei", upn: "k.osei@tenant.com", role: "Viewer" },
    ],
    status: "open" as const,
  },
  {
    name: "Marketing Assets Hub",
    context: "89 files · external link active",
    visibility: "Public",
    admins: [
      { name: "Sam Whitfield", upn: "sam.whitfield@tenant.com" },
      { name: "Devon Cho", upn: "devon.cho@tenant.com" },
      { name: "Alex Rivera", upn: "alex.rivera@tenant.com" },
    ],
    guests: [{ name: "Jin Park", upn: "j.park@tenant.com", role: "Viewer" }],
    status: "open" as const,
  },
  {
    name: "All-Company Town Hall (Teams)",
    context: "Recording archive · intentionally public",
    visibility: "Public",
    admins: [
      { name: "Priya Nair", upn: "priya.nair@tenant.com" },
      { name: "Jamie Chen", upn: "jamie.chen@tenant.com" },
    ],
    guests: [],
    status: "accepted" as const,
    acceptedOn: "Jun 18, 2026",
    acceptedTerm: "90-day term",
  },
  {
    name: "Vendor Onboarding Packet",
    context: "12 files · external link active",
    visibility: "Private",
    admins: [
      { name: "Alex Rivera", upn: "alex.rivera@tenant.com" },
      { name: "Jamie Chen", upn: "jamie.chen@tenant.com" },
      { name: "Priya Nair", upn: "priya.nair@tenant.com" },
      { name: "Diego Alvarez", upn: "diego.alvarez@tenant.com" },
      { name: "Sam Whitfield", upn: "sam.whitfield@tenant.com" },
    ],
    guests: [
      { name: "Beau Ferris", upn: "b.ferris@tenant.com", role: "Contributor" },
      { name: "Lena Mercer", upn: "l.mercer@tenant.com", role: "Contributor" },
      { name: "Chidi Obi", upn: "c.obi@tenant.com", role: "Viewer" },
    ],
    status: "open" as const,
  },
  {
    name: "Q3 Sales Enablement",
    context: "54 files · external link active",
    visibility: "Private",
    admins: [
      { name: "Devon Cho", upn: "devon.cho@tenant.com" },
      { name: "Alex Rivera", upn: "alex.rivera@tenant.com" },
    ],
    guests: [],
    status: "open" as const,
  },
  ...Array.from({ length: 119 }, (_, i) => ({
    name: `${GENERATED_SITE_NAMES[i % 8]} #${i + 6}`,
    context: `${((i * 7 + 12) % 300) + 4} files · external link active`,
    visibility: (i % 3 === 0 ? "Public" : "Private") as "Public" | "Private",
    admins: [{ name: "Site Admin", upn: "siteadmin@tenant.com" }],
    guests: i % 4 === 0 ? [{ name: "External Guest", upn: "guest@partner.com", role: "Viewer" }] : [],
    status: "open" as const,
  })),
];

export const OVERSHARING_SITES: readonly OversharingSite[] = RAW_SITES.map((s, i) => ({
  ...s,
  id: i,
}));

/* ── Evidence: the anonymous links (11208-11219) ──────────────────────────── */

const GENERATED_LINK_SITES = [
  "Regional Ops",
  "Partner Exports",
  "Finance Close",
  "HR Onboarding",
  "Legal Archive",
];
const GENERATED_LINK_FILES = ["Report", "Contract", "Deck", "Export", "Notes"];
const GENERATED_LINK_EXTS = ["docx", "xlsx", "pdf", "pptx"];

/** `anonymousLinksRaw` — 4 written-out links plus 91 generated. */
const RAW_ANON_LINKS: Omit<AnonymousLink, "id">[] = [
  {
    site: "Client Deliverables (SharePoint)",
    file: "Q3_Contract_Draft.docx",
    type: "Edit" as const,
    status: "active" as const,
  },
  {
    site: "Client Deliverables (SharePoint)",
    file: "Budget_2026.xlsx",
    type: "Edit" as const,
    status: "active" as const,
  },
  {
    site: "Marketing Assets Hub",
    file: "Campaign_Assets.zip",
    type: "View" as const,
    status: "active" as const,
  },
  {
    site: "Vendor Onboarding Packet",
    file: "Vendor_Agreement.pdf",
    type: "View" as const,
    status: "expired" as const,
  },
  ...Array.from({ length: 91 }, (_, i) => ({
    site: `${GENERATED_LINK_SITES[i % 5]} #${i + 6}`,
    file: `${GENERATED_LINK_FILES[i % 5]}_${i + 6}.${GENERATED_LINK_EXTS[i % 4]}`,
    type: (i % 3 === 0 ? "Edit" : "View") as "Edit" | "View",
    status: (i % 5 === 0 ? "expired" : "active") as "active" | "expired",
  })),
];

export const OVERSHARING_ANON_LINKS: readonly AnonymousLink[] = RAW_ANON_LINKS.map((l, i) => ({
  ...l,
  id: i,
}));

/** `govSitesPageSize` (11331) and `anonLinksPageSize` (11221). */
export const SITES_PAGE_SIZE = 8;
export const ANON_LINKS_PAGE_SIZE = 6;

/** `siteVisFilterOptions` / `linkStatusFilterOptions`, non-Teams (11247-11262). */
export const SITE_VIS_FILTERS: readonly { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "public", label: "Public" },
  { key: "private", label: "Private" },
  { key: "accepted", label: "Accepted" },
];

export const LINK_STATUS_FILTERS: readonly { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "expired", label: "Expired" },
];

/** `govAcceptedSitesCount` (11318) — drives the all-resolved copy. */
export const ACCEPTED_SITES_COUNT = OVERSHARING_SITES.filter(
  (s) => s.status === "accepted",
).length;

/* ── The enterprise-scale bulk list, `governance-oversharing-full` ─────────── */

/**
 * `govOverTotal` / `govOverPageSize` / `govOverSampleNames` (16821-16836).
 *
 * A separate page from the one above: at 23,412 sites the design stops offering
 * an expandable evidence list and offers search, select-and-bulk-fix, export and
 * a pager instead. Its rows are synthesised per page rather than held as a list,
 * which is the prototype saying plainly that this page is a server-side query.
 */
export const GOV_OVER_TOTAL = 23412;
export const GOV_OVER_PAGE_SIZE = 12;
export const GOV_OVER_SAMPLE_NAMES: readonly string[] = [
  "Client Deliverables",
  "Marketing Assets Hub",
  "Vendor Onboarding Packet",
  "Q3 Sales Enablement",
  "Regional Ops Archive",
  "Partner Portal Exports",
  "Finance Close Docs",
  "Legal Templates Library",
  "HR Onboarding Kits",
  "Facilities Vendor Bids",
  "IT Runbook Backups",
  "Product Roadmap Decks",
];

export function govOverRowsForPage(page: number): { id: number; name: string; context: string }[] {
  return GOV_OVER_SAMPLE_NAMES.map((n, i) => {
    const seed = (page - 1) * GOV_OVER_PAGE_SIZE + i + 1;
    return {
      id: seed,
      name: `${n} #${seed}`,
      context: `${40 + (seed % 300)} files · external link active · last accessed ${(seed % 27) + 1}d ago`,
    };
  });
}
