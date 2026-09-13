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
      { id: "raci", label: "Ownership", icon: "users-round" },
      { id: "run", label: "Runbooks", icon: "book-open" },
      { id: "dr", label: "Data rights", icon: "scale" },
    ],
  },
  {
    id: "g.access", label: "Access & identity", icon: "key-round", children: [
      { id: "team", label: "Team", icon: "users" },
      { id: "bg", label: "Break-glass", icon: "key-round" },
      { id: "lc", label: "Launch Control", icon: "rocket" },
      { id: "wh", label: "Webhooks", icon: "webhook" },
    ],
  },
  {
    id: "g.comm", label: "Commercial", icon: "receipt", children: [
      { id: "status-reports", label: "Status Reports", icon: "file-pen" },
      { id: "contracts", label: "Contracts", icon: "file-text" },
      { id: "hub", label: "Documents", icon: "files" },
      { id: "billing", label: "Billing", icon: "receipt" },
    ],
  },
  { id: "audit", label: "Audit log", icon: "history", leaf: true },
];

/** The nine MSP-wide Operations pages, in tree order. */
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
];

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
