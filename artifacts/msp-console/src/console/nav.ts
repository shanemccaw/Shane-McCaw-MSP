/**
 * Information architecture for the MSP Console tree, breadcrumb and command
 * palette. Two roots (README "Tree sidebar"): "Shane McCaw Consulting" →
 * Operations (9 MSP-wide pages), and "Managed Tenants" → each tenant → 7 page
 * groups. The group/leaf/page ids, labels and Lucide icon names are taken
 * verbatim from the design's own logic class in `MSP Console.dc.html` — that
 * class is the specification for these data shapes.
 *
 * Nothing here is customer data; it is the fixed page map every tenant shares.
 * The tenant list itself comes from the live directory endpoint, never from here.
 */
import type { IconName } from "./icons";

export interface LeafPage {
  id: string;
  label: string;
  icon: IconName;
}

export interface Group {
  id: string;
  label: string;
  icon: IconName;
  /** A leaf group is itself a page (Overview, Audit log); no children. */
  leaf?: boolean;
  children?: LeafPage[];
}

/** The seven tenant page groups, in tree order. */
export const CHILD_GROUPS: Group[] = [
  { id: "overview", label: "Overview", icon: "gauge", leaf: true },
  {
    id: "g.monitor", label: "Monitoring", icon: "radar", children: [
      { id: "signals", label: "Signals", icon: "radar" },
      { id: "diag", label: "Diagnostics", icon: "stethoscope" },
      { id: "rem", label: "Remediation", icon: "wrench" },
    ],
  },
  {
    id: "cc", label: "Change Control", icon: "git-pull-request", children: [
      { id: "cc.register", label: "CR register", icon: "list-checks" },
      { id: "cc.catalog", label: "Standard Catalog", icon: "book-open" },
      { id: "cc.cab", label: "CAB", icon: "gavel" },
      { id: "cc.calendars", label: "Freeze & maintenance", icon: "calendar-x" },
      { id: "cc.deps", label: "Dependencies", icon: "waypoints" },
      { id: "cc.exec", label: "Executions", icon: "play" },
      { id: "cc.pir", label: "PIRs", icon: "clipboard-check" },
    ],
  },
  {
    id: "g.gov", label: "Governance", icon: "scale", children: [
      { id: "risk", label: "Risk Register", icon: "shield-alert" },
      { id: "poams", label: "POA&Ms", icon: "list-todo" },
      { id: "raci", label: "Ownership", icon: "users-round" },
      { id: "run", label: "Runbooks", icon: "book-open" },
      { id: "dr", label: "Data rights", icon: "scale" },
      // Security Plan (Git #2603, Feature #1689) — no Claude Design export exists
      // for this screen; built directly against the real endpoints per Shane's
      // 2026-09-15 authorization. See SecurityPlan.tsx's own agent-built banner.
      { id: "sp", label: "Security Plan", icon: "file-check" },
    ],
  },
  {
    // 2026-09-15 design refresh (#4150) — OU Assignment now sits right after
    // Team, before Break-glass/Launch Control/Webhooks. Azure Credential
    // (newer than this design pass) stays last, untouched.
    id: "g.access", label: "Access & identity", icon: "key-round", children: [
      { id: "team", label: "Team", icon: "users" },
      { id: "ou", label: "OU Assignment", icon: "folder-tree" },
      { id: "bg", label: "Break-glass", icon: "key-round" },
      { id: "lc", label: "Launch Control", icon: "rocket" },
      { id: "wh", label: "Webhooks", icon: "webhook" },
      // Azure Credential (Git #3968, Feature #3966) — the client's app
      // registration credential for the M365 tenant this customer maps to.
      { id: "azurecred", label: "Azure Credential", icon: "cloud" },
    ],
  },
  {
    // 2026-09-15 design refresh (#4150) — full reorder: Contracts → Offers &
    // SOWs → Status Reports → Marketplace → Documents → Billing.
    id: "g.comm", label: "Commercial", icon: "receipt", children: [
      { id: "contracts", label: "Contracts", icon: "file-text" },
      // Offers & SOWs (Git #4014, README screen 66) — the richer 63–66
      // contract-pack pass's own whole-book SOW lifecycle for this customer.
      { id: "offers-sows", label: "Offers & SOWs", icon: "signature" },
      { id: "status-reports", label: "Status Reports", icon: "file-pen" },
      // Marketplace Purchase (Git #3819, README screen 47) — buying a
      // catalog item on this customer's behalf, charged to the MSP's card.
      { id: "marketplace", label: "Marketplace", icon: "shopping-cart" },
      { id: "hub", label: "Documents", icon: "files" },
      { id: "billing", label: "Billing", icon: "receipt" },
    ],
  },
  { id: "audit", label: "Audit log", icon: "history", leaf: true },
];

/**
 * The MSP-wide Operations pages, in tree order. The original nine are the
 * "Operations (9 MSP-wide pages)" README calls its own cross-tenant group;
 * `offboarding`, `policy`, `staff` and `acctsec` are four of the seventeen
 * contract-pack screens (README screens 38-50, 63-66) to land here — Staff
 * Roster (#2662) and Account Security both sit under Operations rather than
 * per-tenant on purpose, because their routes resolve their target by MSP
 * id, never by tenant (README "Where they sit in the tree").
 */
export const MSP_PAGES: LeafPage[] = [
  { id: "settings", label: "MSP settings", icon: "settings" },
  { id: "exec", label: "Executive view", icon: "chart-line" },
  { id: "timeline", label: "Activity timeline", icon: "activity" },
  { id: "config", label: "Configuration State", icon: "database" },
  { id: "sales", label: "Sales", icon: "handshake" },
  { id: "sla", label: "Scope & SLA", icon: "gauge" },
  { id: "sops", label: "SOPs", icon: "scroll-text" },
  { id: "docs", label: "Documents", icon: "files" },
  { id: "connectors", label: "SharePoint connectors", icon: "plug" },
  { id: "offboarding", label: "Offboarding", icon: "log-out" },
  // Delivery Projects (Git #4246, part of #3433) — the real, live typed-card
  // Kanban board relocated from admin-panel's CRM (`ProjectDetail.tsx`,
  // `Projects.tsx`). Genuinely global (fetches `/api/admin/projects` across
  // every client, not filtered by tenant), so it sits here in Operations
  // rather than the per-tenant `CHILD_GROUPS` tree — same placement logic as
  // "Projects" (Simple Kanban) directly below, which is a *different* system:
  // that one is per-customer buckets/cards (#3773); this one is a single
  // customer's fixed-pipeline delivery project with typed task cards. Icon
  // `layers` deliberately distinct from `kanban` (already used below) so the
  // two don't read as the same feature in the tree.
  { id: "delivery-projects", label: "Delivery Projects", icon: "layers" },
  // Projects (Git #2621, Feature #2561) — the design's own MSP-wide
  // Operations placement (`MSP Console.dc.html`'s `mspSel === "projects"`,
  // between Offboarding and Retainer hours). Free-form buckets/cards per
  // customer, Phase 1 only — not to be confused with the pre-existing,
  // unrelated project-scoped Kanban on the admin-panel Delivery Projects
  // board (`ProjectDetail.tsx`, fixed pipeline, #3433's target).
  { id: "projects", label: "Projects", icon: "kanban" },
  { id: "policy", label: "Policy engine", icon: "shield-check" },
  // Microsoft Changes (Git #2600, Feature #1688) — authoring is universal
  // (once per announcement, applied to every tenant, #1532), same
  // "Operations, not per-tenant" reasoning as everything else on this list;
  // the per-tenant resolution/routing review happens inside the page itself.
  { id: "m365changes", label: "Microsoft Changes", icon: "megaphone" },
  { id: "staff", label: "Staff Roster", icon: "user-plus" },
  { id: "acctsec", label: "Account Security", icon: "key-round" },
  // Consent and Onboarding (Git #2627, README screen 64) — its routes resolve
  // their target by mspId's own book, same "Operations, not per-tenant"
  // reasoning acctsec's own comment above documents for that page.
  { id: "consent", label: "Consent & Onboarding", icon: "user-check" },
  { id: "dlq", label: "Dead Letter Queue", icon: "trash-2" },
  { id: "plan", label: "Plan & billing", icon: "credit-card" },
  { id: "reports", label: "Reports", icon: "file-bar-chart-2" },
  { id: "retention", label: "Retention Queue", icon: "hourglass" },
  // Retainer Hours (Git #2618, Feature #2560's real remaining scope) — an
  // MSP-wide picker page (customer switch lives inside the page itself), same
  // "Operations, not per-tenant" shape as Retention Queue immediately above.
  { id: "retainer", label: "Retainer hours", icon: "hourglass" },
  { id: "revenue", label: "Partner Revenue", icon: "handshake" },
  // Audit Log (Git #4012, README screen 63), mounted here unfiltered and
  // again per tenant (CHILD_GROUPS' "audit" leaf above) with customerId set
  // — same component, one prop, per the README's tree-placement table.
  { id: "audit", label: "Audit log", icon: "history" },
  // Requests and Support Chat (Git #2650, Feature #2570) — the operator's
  // org-scoped ticket queue. Agent-built (no Design export exists yet, see
  // the module's own header); MSP-wide, not per-tenant, same reasoning as
  // Audit Log's own Operations placement above.
  { id: "requests", label: "Requests & Support", icon: "life-buoy" },
];

const msp = (id: string): LeafPage => {
  const p = MSP_PAGES.find((x) => x.id === id);
  if (!p) throw new Error(`MSP_GROUPS references unknown MSP_PAGES id: ${id}`);
  return p;
};

/**
 * Operations gains real grouping in the 2026-09-15 design refresh (#4150) —
 * three named collapsible groups, reusing the same `Group` shape
 * `CHILD_GROUPS` already uses for tenant pages. `settings` (the section
 * header, rendered on the Consulting root) and `exec`/`projects`/`retainer`
 * stay top-level, ungrouped — see `MSP_TOP_LEVEL_IDS`.
 */
export const MSP_GROUPS: Group[] = [
  {
    id: "delivery", label: "Client Delivery", icon: "briefcase",
    children: ["timeline", "sales", "sla", "sops", "config", "policy", "m365changes", "reports", "delivery-projects"].map(msp),
  },
  {
    id: "access", label: "Access & Accounts", icon: "shield",
    children: ["consent", "staff", "acctsec", "docs", "connectors"].map(msp),
  },
  {
    id: "billing", label: "Billing & Lifecycle", icon: "credit-card",
    children: ["revenue", "plan", "audit", "retention", "dlq", "offboarding"].map(msp),
  },
];

const MSP_GROUPED_IDS = new Set(MSP_GROUPS.flatMap((g) => (g.children ?? []).map((c) => c.id)));

/** Operations pages rendered top-level, ungrouped (excludes `settings`, which lives on the Consulting root). */
export const MSP_TOP_LEVEL_IDS: string[] = MSP_PAGES
  .map((p) => p.id)
  .filter((id) => id !== "settings" && !MSP_GROUPED_IDS.has(id));

/** Flattened tenant pages (leaf groups + every group child). */
export const CHILD_PAGES: LeafPage[] = CHILD_GROUPS.reduce<LeafPage[]>((acc, g) => {
  if (g.leaf) acc.push({ id: g.id, label: g.label, icon: g.icon });
  else for (const c of g.children ?? []) acc.push(c);
  return acc;
}, []);

/** The first page shown when a tenant node is opened. */
export const DEFAULT_TENANT_PAGE = "overview";

const CHILD_PAGE_BY_ID = new Map(CHILD_PAGES.map((p) => [p.id, p]));
const MSP_PAGE_BY_ID = new Map(MSP_PAGES.map((p) => [p.id, p]));

export function tenantPageMeta(pageId: string): LeafPage | undefined {
  return CHILD_PAGE_BY_ID.get(pageId);
}

export function mspPageMeta(pageId: string): LeafPage | undefined {
  return MSP_PAGE_BY_ID.get(pageId);
}

/** The group that owns a tenant page id (null for leaf-group pages). */
export function groupForPage(pageId: string): Group | null {
  return (
    CHILD_GROUPS.find((g) => !g.leaf && (g.children ?? []).some((c) => c.id === pageId)) ??
    null
  );
}

/** The Operations group that owns an MSP-wide page id (null for top-level pages). */
export function groupForMspPage(pageId: string): Group | null {
  return MSP_GROUPS.find((g) => (g.children ?? []).some((c) => c.id === pageId)) ?? null;
}

// ── Selection ↔ route ────────────────────────────────────────────────────────
// Every selection has a real URL (README "Navigation").

export type Selection =
  | { kind: "root" }
  | { kind: "tenant"; tenant: number }
  | { kind: "page"; tenant: number; page: string }
  | { kind: "msp"; page: string };

export function selectionToPath(sel: Selection): string {
  switch (sel.kind) {
    case "root": return "/tenants";
    case "tenant": return `/tenants/${sel.tenant}`;
    case "page": return `/tenants/${sel.tenant}/${sel.page}`;
    case "msp": return `/ops/${sel.page}`;
  }
}

/**
 * Parse a router-relative path into a selection. Returns null for anything that
 * is not a recognised console route (the caller renders NotFound).
 */
export function parseLocation(path: string): Selection | null {
  const clean = path.split("?")[0].replace(/\/+$/, "") || "/";
  if (clean === "/" || clean === "/tenants") return { kind: "root" };

  const opsMatch = clean.match(/^\/ops\/([^/]+)$/);
  if (opsMatch) {
    const page = decodeURIComponent(opsMatch[1]);
    return mspPageMeta(page) ? { kind: "msp", page } : null;
  }

  const tenantMatch = clean.match(/^\/tenants\/([^/]+)$/);
  if (tenantMatch) {
    const id = Number(tenantMatch[1]);
    return Number.isFinite(id) ? { kind: "tenant", tenant: id } : null;
  }

  const pageMatch = clean.match(/^\/tenants\/([^/]+)\/([^/]+)$/);
  if (pageMatch) {
    const id = Number(pageMatch[1]);
    const page = decodeURIComponent(pageMatch[2]);
    if (!Number.isFinite(id) || !tenantPageMeta(page)) return null;
    return { kind: "page", tenant: id, page };
  }

  return null;
}
