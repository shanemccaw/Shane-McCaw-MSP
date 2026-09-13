/**
 * Pure builders that turn (live customers + current selection + expansion state)
 * into the flat descriptor arrays the shell renders — the tree, the icon rail,
 * the breadcrumb, the command palette, the context path and the status bar.
 * This is the faithful port of the design logic class's `renderVals`
 * (`MSP Console.dc.html`), with the mock `tenantData` replaced by the real
 * directory rows and the array-index tenant key replaced by the real customer id.
 */
import type { DirectoryCustomer } from "@/api/console-api";
import type { IconName } from "./icons";
import {
  CHILD_GROUPS, MSP_PAGES, DEFAULT_TENANT_PAGE,
  tenantPageMeta, mspPageMeta, groupForPage,
  type Selection,
} from "./nav";
import { action, statusDot, text } from "./tokens";

export interface TreeHandlers {
  navigate: (sel: Selection) => void;
  toggleTenant: (id: number) => void;
  toggleGroup: (key: string) => void;
  toggleMsp: () => void;
}

export type ChevronKind = "chevron-down" | "chevron-right" | "dot";

export interface TreeNode {
  key: string;
  label: string;
  icon: IconName;
  iconColor: string;
  chevron: ChevronKind;
  chevronVisible: boolean;
  indent: number;
  height: number;
  fontSize: number;
  fontWeight: number;
  bg: string;
  fg: string;
  meta: string;
  click: () => void;
}

export interface RailNode {
  key: string;
  label: string;
  icon: IconName;
  color: string;
  bg: string;
  line: string;
  bar: string;
  divider: boolean;
  click: () => void;
}

export interface Crumb {
  key: string;
  label: string;
  sep: IconName;
  isLast: boolean;
  onClick?: () => void;
}

export interface Command {
  key: string;
  label: string;
  group: "ROOT" | "MSP" | "NODE";
  icon: IconName;
  run: () => void;
}

/** The tenant status dot, from real directory fields only. */
export function statusDotColor(c: DirectoryCustomer): string {
  if (c.lastScanAt == null) return statusDot.neverScanned;
  if (c.openSignals > 0) return statusDot.warnings;
  return statusDot.healthy;
}

const tenantName = (c: DirectoryCustomer) => c.name || c.domain || `Customer ${c.id}`;
const seatsLabel = (c: DirectoryCustomer) => (c.seats == null ? "" : c.seats.toLocaleString());

// ── Tree (expanded) ──────────────────────────────────────────────────────────

export function buildTreeNodes(
  customers: DirectoryCustomer[],
  sel: Selection,
  openTenants: Set<number>,
  openGroups: Set<string>,
  mspOpen: boolean,
  treeQuery: string,
  h: TreeHandlers,
): TreeNode[] {
  const q = treeQuery.trim().toLowerCase();
  const nodes: TreeNode[] = [];
  const mspSel = sel.kind === "msp" ? sel.page : null;
  const selTenant = sel.kind === "tenant" ? sel.tenant : sel.kind === "page" ? sel.tenant : null;
  const selPage = sel.kind === "page" ? sel.page : null;

  // Root 1 — Shane McCaw Consulting (also the MSP settings entry)
  nodes.push({
    key: "root:consulting", label: "Shane McCaw Consulting", icon: "building",
    iconColor: "#7dd3fc", chevron: "chevron-down", chevronVisible: true,
    indent: 8, height: 30, fontSize: 12.5, fontWeight: 700,
    bg: mspSel === "settings" ? action.selectedRow : "transparent",
    fg: mspSel === "settings" ? "#ffffff" : text.secondary,
    meta: "MSP",
    click: () => h.navigate({ kind: "msp", page: "settings" }),
  });

  // Operations group
  nodes.push({
    key: "grp:operations", label: "Operations", icon: "briefcase",
    iconColor: "#7dd3fc", chevron: mspOpen ? "chevron-down" : "chevron-right", chevronVisible: true,
    indent: 22, height: 28, fontSize: 12.5, fontWeight: 600,
    bg: "transparent", fg: text.secondary, meta: "",
    click: () => h.toggleMsp(),
  });
  if (mspOpen) {
    for (const p of MSP_PAGES) {
      if (p.id === "settings") continue; // lives on the Consulting root above
      if (q && !p.label.toLowerCase().includes(q)) continue;
      const active = mspSel === p.id;
      nodes.push({
        key: `msp:${p.id}`, label: p.label, icon: p.icon,
        iconColor: active ? "#93c5fd" : text.label, chevron: "dot", chevronVisible: false,
        indent: 44, height: 28, fontSize: 12.5, fontWeight: active ? 600 : 500,
        bg: active ? action.selectedRow : "transparent",
        fg: active ? "#ffffff" : text.muted, meta: "",
        click: () => h.navigate({ kind: "msp", page: p.id }),
      });
    }
  }

  // Root 2 — Managed Tenants
  nodes.push({
    key: "root:tenants", label: "Managed Tenants", icon: "network",
    iconColor: "#7dd3fc", chevron: "chevron-down", chevronVisible: true,
    indent: 22, height: 28, fontSize: 12.5, fontWeight: 600,
    bg: sel.kind === "root" ? action.selectedRoot : "transparent",
    fg: sel.kind === "root" ? "#ffffff" : text.secondary,
    meta: String(customers.length),
    click: () => h.navigate({ kind: "root" }),
  });

  for (const c of customers) {
    const matches = !q || tenantName(c).toLowerCase().includes(q) || (c.domain ?? "").toLowerCase().includes(q);
    if (!matches && q) continue;
    const isOpen = openTenants.has(c.id) || (!!q && matches);
    const here = selTenant === c.id;
    nodes.push({
      key: `tenant:${c.id}`, label: tenantName(c), icon: "building-2",
      iconColor: statusDotColor(c), chevron: isOpen ? "chevron-down" : "chevron-right", chevronVisible: true,
      indent: 44, height: 30, fontSize: 13, fontWeight: here ? 600 : 500,
      bg: here && !selPage ? action.selectedRowSoft : "transparent",
      fg: here ? text.strong : text.secondary,
      meta: seatsLabel(c),
      click: () => h.toggleTenant(c.id),
    });
    if (!isOpen) continue;

    for (const g of CHILD_GROUPS) {
      if (g.leaf) {
        const active = here && selPage === g.id;
        nodes.push({
          key: `leaf:${c.id}:${g.id}`, label: g.label, icon: g.icon,
          iconColor: active ? "#93c5fd" : text.label, chevron: "dot", chevronVisible: false,
          indent: 64, height: 28, fontSize: 12.5, fontWeight: active ? 600 : 500,
          bg: active ? action.selectedRow : "transparent",
          fg: active ? "#ffffff" : text.muted, meta: "",
          click: () => h.navigate({ kind: "page", tenant: c.id, page: g.id }),
        });
        continue;
      }
      const gkey = `${c.id}:${g.id}`;
      const gOpen = openGroups.has(gkey) || (!!q);
      const holdsCurrent = here && (g.children ?? []).some((ch) => ch.id === selPage);
      nodes.push({
        key: `group:${gkey}`, label: g.label, icon: g.icon,
        iconColor: holdsCurrent ? "#93c5fd" : text.label,
        chevron: gOpen ? "chevron-down" : "chevron-right", chevronVisible: true,
        indent: 64, height: 28, fontSize: 12, fontWeight: holdsCurrent || gOpen ? 600 : 500,
        bg: holdsCurrent && !gOpen ? action.selectedRowSoft : "transparent",
        fg: holdsCurrent || gOpen ? text.secondary : text.muted, meta: "",
        click: () => {
          if (gOpen) h.toggleGroup(gkey);
          else h.navigate({ kind: "page", tenant: c.id, page: (g.children ?? [])[0].id });
        },
      });
      if (!gOpen) continue;
      for (const ch of g.children ?? []) {
        const sub = here && selPage === ch.id;
        nodes.push({
          key: `child:${c.id}:${ch.id}`, label: ch.label, icon: ch.icon,
          iconColor: sub ? "#93c5fd" : text.label, chevron: "dot", chevronVisible: false,
          indent: 84, height: 26, fontSize: 12, fontWeight: sub ? 600 : 500,
          bg: sub ? action.selectedRow : "transparent",
          fg: sub ? "#ffffff" : text.muted, meta: "",
          click: () => h.navigate({ kind: "page", tenant: c.id, page: ch.id }),
        });
      }
    }
  }

  return nodes;
}

// ── Icon rail (collapsed) ────────────────────────────────────────────────────

export function buildRailNodes(
  customers: DirectoryCustomer[],
  sel: Selection,
  h: TreeHandlers,
): RailNode[] {
  const rail: RailNode[] = [];
  const mspSel = sel.kind === "msp" ? sel.page : null;
  const selTenant = sel.kind === "tenant" ? sel.tenant : sel.kind === "page" ? sel.tenant : null;

  rail.push({
    key: "rail:consulting", label: "Shane McCaw Consulting", icon: "building",
    color: mspSel === "settings" ? "#93c5fd" : "#7dd3fc",
    bg: mspSel === "settings" ? "rgba(96,165,250,.16)" : "transparent",
    line: mspSel === "settings" ? "rgba(96,165,250,.4)" : "transparent",
    bar: mspSel === "settings" ? "#60a5fa" : "transparent", divider: false,
    click: () => h.navigate({ kind: "msp", page: "settings" }),
  });
  for (const p of MSP_PAGES) {
    if (p.id === "settings") continue;
    const on = mspSel === p.id;
    rail.push({
      key: `rail:msp:${p.id}`, label: `Operations — ${p.label}`, icon: p.icon,
      color: on ? "#93c5fd" : text.label,
      bg: on ? "rgba(96,165,250,.16)" : "transparent",
      line: on ? "rgba(96,165,250,.4)" : "transparent",
      bar: on ? "#60a5fa" : "transparent", divider: false,
      click: () => h.navigate({ kind: "msp", page: p.id }),
    });
  }
  customers.forEach((c, i) => {
    const on = selTenant === c.id;
    rail.push({
      key: `rail:tenant:${c.id}`, label: tenantName(c), icon: "building-2",
      color: statusDotColor(c),
      bg: on ? "rgba(96,165,250,.16)" : "transparent",
      line: on ? "rgba(96,165,250,.4)" : "transparent",
      bar: on ? "#60a5fa" : "transparent", divider: i === 0,
      click: () => h.navigate(
        sel.kind === "page" ? { kind: "page", tenant: c.id, page: sel.page } : { kind: "tenant", tenant: c.id },
      ),
    });
  });
  return rail;
}

// ── Breadcrumb ───────────────────────────────────────────────────────────────

export function buildCrumbs(sel: Selection, customers: DirectoryCustomer[], h: TreeHandlers): Crumb[] {
  const crumbs: Crumb[] = [];
  const findTenant = (id: number) => customers.find((c) => c.id === id) ?? null;

  if (sel.kind === "msp") {
    const mp = mspPageMeta(sel.page);
    crumbs.push({
      key: "c:consulting", label: "Shane McCaw Consulting", sep: "building", isLast: false,
      onClick: () => h.navigate({ kind: "msp", page: "settings" }),
    });
    crumbs.push({ key: "c:msp", label: mp?.label ?? "", sep: "chevron-right", isLast: true });
    return crumbs;
  }

  crumbs.push({
    key: "c:tenants", label: "Managed Tenants", sep: "network",
    isLast: sel.kind === "root",
    onClick: sel.kind === "root" ? undefined : () => h.navigate({ kind: "root" }),
  });

  if (sel.kind === "tenant" || sel.kind === "page") {
    const c = findTenant(sel.tenant);
    const name = c ? tenantName(c) : `Customer ${sel.tenant}`;
    crumbs.push({
      key: "c:tenant", label: name, sep: "chevron-right",
      isLast: sel.kind === "tenant",
      onClick: sel.kind === "tenant" ? undefined : () => h.navigate({ kind: "tenant", tenant: sel.tenant }),
    });
    if (sel.kind === "page") {
      const grp = groupForPage(sel.page);
      if (grp) {
        crumbs.push({
          key: "c:group", label: grp.label, sep: "chevron-right", isLast: false,
          onClick: () => h.navigate({ kind: "page", tenant: sel.tenant, page: (grp.children ?? [])[0].id }),
        });
      }
      const p = tenantPageMeta(sel.page);
      crumbs.push({ key: "c:page", label: p?.label ?? "", sep: "chevron-right", isLast: true });
    }
  }
  return crumbs;
}

// ── Command palette ──────────────────────────────────────────────────────────

export function buildCommands(customers: DirectoryCustomer[], h: TreeHandlers): Command[] {
  const cmds: Command[] = [
    { key: "cmd:root", label: "Managed Tenants", group: "ROOT", icon: "network", run: () => h.navigate({ kind: "root" }) },
  ];
  for (const p of MSP_PAGES) {
    cmds.push({
      key: `cmd:msp:${p.id}`, label: `Operations › ${p.label}`, group: "MSP", icon: p.icon,
      run: () => h.navigate({ kind: "msp", page: p.id }),
    });
  }
  for (const c of customers) {
    for (const p of buildTenantPageList()) {
      cmds.push({
        key: `cmd:${c.id}:${p.id}`, label: `${tenantName(c)} › ${p.label}`, group: "NODE", icon: p.icon,
        run: () => h.navigate({ kind: "page", tenant: c.id, page: p.id }),
      });
    }
  }
  return cmds;
}

function buildTenantPageList() {
  const out: { id: string; label: string; icon: IconName }[] = [];
  for (const g of CHILD_GROUPS) {
    if (g.leaf) out.push({ id: g.id, label: g.label, icon: g.icon });
    else for (const c of g.children ?? []) out.push(c);
  }
  return out;
}

// ── Header context path + status bar + page metadata ─────────────────────────

export function contextPath(sel: Selection, customers: DirectoryCustomer[]): string {
  const find = (id: number) => customers.find((c) => c.id === id) ?? null;
  if (sel.kind === "msp") return `Shane McCaw Consulting · ${mspPageMeta(sel.page)?.label ?? ""}`;
  if (sel.kind === "tenant") {
    const c = find(sel.tenant);
    return c ? `${tenantName(c)} · Tenant control` : "Tenant control";
  }
  if (sel.kind === "page") {
    const c = find(sel.tenant);
    return `${c?.domain ?? tenantName(c ?? ({ id: sel.tenant } as DirectoryCustomer))} · ${tenantPageMeta(sel.page)?.label ?? ""}`;
  }
  return "Directory root";
}

export interface PageMeta { eyebrow: string; title: string; note: string; }

export function pageMeta(sel: Selection, customers: DirectoryCustomer[]): PageMeta {
  const find = (id: number) => customers.find((c) => c.id === id) ?? null;
  if (sel.kind === "root") {
    return {
      eyebrow: "DIRECTORY",
      title: "Managed Tenants",
      note: "Every tenant in your book. Expand one in the tree to work inside it.",
    };
  }
  if (sel.kind === "msp") {
    const mp = mspPageMeta(sel.page);
    // #2597 — SOPs is the first Operations page with a real module built; its
    // eyebrow/note are the design's own exact copy (`MSP Console.dc.html`
    // logic class). Other Operations pages keep the generic fallback until
    // they land their own module.
    if (sel.page === "sops") {
      return {
        eyebrow: "STANDARD OPERATING PROCEDURES",
        title: "SOPs",
        note: "The procedures this MSP authors, and every run fired against a customer's tenant.",
      };
    }
    if (sel.page === "offboarding") {
      return {
        eyebrow: "OFFBOARDING",
        title: "Offboarding",
        note: "This is the whole MSP, and it only runs one way — forward, with no undo.",
      };
    }
    if (sel.page === "policy") {
      return {
        eyebrow: "POLICY DECISIONS + POLICY ENGINE",
        title: "Policy",
        note: "Customer-signed policy decisions and this MSP's own standing policies — two different real things that can produce the same route outcome.",
      };
    }
    // #2624 — Account Security's eyebrow/title are the design's own exact
    // copy (`Account Security.dc.html`'s header, screen 39).
    if (sel.page === "acctsec") {
      return {
        eyebrow: "ACCOUNT SECURITY",
        title: "Act on another account's credentials",
        note: "Password reset, temporary password, MFA and session actions against a real account — every one audited, and every one held to a real server-side role ceiling.",
      };
    }
    if (sel.page === "dlq") {
      return {
        eyebrow: "DEAD LETTER QUEUE",
        title: "Work that gave up",
        note: "Parked items from every writer that gives up on a job — replay what the workflow engine can rebuild, close out the rest by hand.",
      };
    }
    if (sel.page === "retention") {
      return {
        eyebrow: "RETENTION QUEUE",
        title: "Requests to delete something early",
        note: "A customer deletes a record and it enters a holding period rather than disappearing. If they ask for it gone sooner, that request lands here for an operator to approve, decline, or talk about and restore instead.",
      };
    }
    if (sel.page === "revenue") {
      return {
        eyebrow: "PARTNER REVENUE",
        title: "Partner Revenue",
        note: "Two halves that must never be totalled: what you pay the platform, verified with the payment processor, and your own resale worksheet, which nothing here charges or reconciles.",
      };
    }
    if (sel.page === "plan") {
      return {
        eyebrow: "PLATFORM SUBSCRIPTION — SELF-SERVICE",
        title: "Your plan",
        note: "The MSP's own plan and payment method.",
      };
    }
    if (sel.page === "reports") {
      return {
        eyebrow: "REPORTS",
        title: "Definitions, runs and canvases",
        note: "Every generated document, every custom canvas, and the schedules nothing yet executes.",
      };
    }
    return { eyebrow: "OPERATIONS · MSP-WIDE", title: mp?.label ?? "", note: "" };
  }
  const c = find(sel.tenant);
  const name = c ? tenantName(c) : `Customer ${sel.tenant}`;
  if (sel.kind === "tenant") {
    return {
      eyebrow: `TENANT CONTROL · ${c?.domain ?? ""}`.trim(),
      title: name,
      note: "The tenant control surface — subscription, consent, scanning and every control this console has against it.",
    };
  }
  const p = tenantPageMeta(sel.page);
  const grp = groupForPage(sel.page);
  return {
    eyebrow: `${grp ? grp.label.toUpperCase() + " · " : ""}${name.toUpperCase()}`,
    title: p?.label ?? "",
    note: "",
  };
}

export function statusLeft(sel: Selection, customers: DirectoryCustomer[]): string {
  if (sel.kind === "tenant" || sel.kind === "page") {
    const c = customers.find((x) => x.id === sel.tenant);
    if (!c) return "";
    const seats = c.seats == null ? "—" : c.seats.toLocaleString();
    const people = c.people == null ? "—" : String(c.people);
    return `${tenantName(c)} · ${seats} seats · ${people} people`;
  }
  const totalSeats = customers.reduce((sum, c) => sum + (c.seats ?? 0), 0);
  const seatsPart = totalSeats > 0 ? ` · ${totalSeats.toLocaleString()} seats` : "";
  const n = customers.length;
  return `${n} ${n === 1 ? "tenant" : "tenants"}${seatsPart}`;
}

export function statusRight(sel: Selection, customers: DirectoryCustomer[], roleLabel: string): string {
  if (sel.kind === "tenant" || sel.kind === "page") {
    const c = customers.find((x) => x.id === sel.tenant);
    if (c) return `Last scan ${formatScan(c.lastScanAt)}`;
  }
  return `Signed in as ${roleLabel}`;
}

export function formatScan(iso: string | null): string {
  if (!iso) return "no run";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "no run";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export { tenantName, DEFAULT_TENANT_PAGE };
