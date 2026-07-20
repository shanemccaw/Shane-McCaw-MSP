/**
 * IDEShell.test.ts
 *
 * Tests for the global IDE shell:
 * 1. Workspace navigation config integrity — trees, routes, ordering
 * 2. Explorer active-item resolution (incl. ?tab= leaves)
 * 3. Collapsible-node persistence keys + active-ancestor auto-expand chain
 * 4. Property Panel selection resolution
 *
 * Run with: pnpm --filter @workspace/admin-panel run test
 */

import { describe, it, expect } from "vitest";
import {
  WORKSPACES,
  activeAncestorKeys,
  buildCmdKEntries,
  findWorkspace,
  groupNodeKey,
  isItemActive,
  resolveTabMeta,
  sectionNodeKey,
  workspaceLeaves,
  type TreeItem,
} from "@/components/shell/workspaceNav";
import { resolveShownSelection, type PropertySelection } from "@/components/shell/PropertyPanelContext";

// ─── Workspace navigation config ──────────────────────────────────────────────

describe("Workspace config integrity", () => {
  it("has exactly 7 workspaces in tree order", () => {
    expect(WORKSPACES.map(w => w.id)).toEqual([
      "command", "pipeline", "delivery", "finance", "content", "system", "workflows",
    ]);
  });

  it("every workspace default path belongs to that workspace", () => {
    for (const ws of WORKSPACES) {
      expect(findWorkspace(ws.defaultPath)?.id).toBe(ws.id);
    }
  });

  it("every leaf has an absolute path and unique id", () => {
    const ids = new Set<string>();
    for (const ws of WORKSPACES) {
      for (const leaf of workspaceLeaves(ws)) {
        expect(leaf.path!.startsWith("/")).toBe(true);
        expect(ids.has(leaf.id)).toBe(false);
        ids.add(leaf.id);
      }
    }
  });

  it("every query-less leaf resolves back to its own tab label", () => {
    for (const ws of WORKSPACES) {
      for (const leaf of workspaceLeaves(ws)) {
        const [path, query] = leaf.path!.split("?");
        if (query) continue; // ?tab= leaves share their page's tab
        // Pages with ?tab= sections keep their canonical page label
        if (path === "/command/marketing" || path === "/delivery/baseline-templates") continue;
        const meta = resolveTabMeta(path);
        expect(meta.label).toBe(leaf.label);
      }
    }
  });

  it("marketing ?tab= leaves resolve to the single Marketing page tab", () => {
    expect(resolveTabMeta("/command/marketing").label).toBe("Marketing");
  });

  it("detail routes resolve to their workspace with id-suffixed labels", () => {
    expect(resolveTabMeta("/crm/leads/42")).toMatchObject({ label: "Lead #42", workspaceId: "pipeline" });
    expect(resolveTabMeta("/crm/invoices/7")).toMatchObject({ label: "Invoice #7", workspaceId: "finance" });
    expect(resolveTabMeta("/crm/projects/3")).toMatchObject({ label: "Project #3", workspaceId: "delivery" });
    expect(resolveTabMeta("/workflows/runs/9")).toMatchObject({ label: "Run #9", workspaceId: "workflows" });
    expect(resolveTabMeta("/prompt-center/5")).toMatchObject({ label: "Prompt #5", workspaceId: "command" });
  });

  it("legacy standalone pages are owned by the right workspace", () => {
    expect(findWorkspace("/crm/documents")?.id).toBe("delivery");
    expect(findWorkspace("/crm/status-reports")?.id).toBe("delivery");
    expect(findWorkspace("/crm/testimonials")?.id).toBe("delivery");
    expect(findWorkspace("/asset-library/checklists")?.id).toBe("content");
    expect(findWorkspace("/msp/plans")?.id).toBe("system");
    expect(findWorkspace("/msp")?.id).toBe("system");
  });

  it("legacy standalone pages appear as Explorer tree leaves", () => {
    const allPaths = WORKSPACES.flatMap(ws => workspaceLeaves(ws)).map(l => l.path);
    for (const p of [
      "/crm/documents", "/crm/status-reports", "/crm/testimonials",
      "/asset-library/checklists", "/asset-library/artifact-sets",
      "/asset-library/deliverable-sets", "/asset-library/categories",
      "/msp", "/msp/plans", "/msp/overrides", "/msp/reports",
    ]) {
      expect(allPaths).toContain(p);
    }
  });

  it("the marketing subtree mirrors the proven IDEShell grouping", () => {
    const command = WORKSPACES.find(w => w.id === "command")!;
    const marketing = command.sections.find(s => s.id === "marketing")!;
    const leads = marketing.items.find(i => i.id === "mkt-leads")!;
    expect(leads.children!.map(c => c.id)).toEqual(["mkt-recommendations", "mkt-lead-finder"]);
    const outreach = marketing.items.find(i => i.id === "mkt-outreach-group")!;
    expect(outreach.children!.map(c => c.id)).toEqual(["mkt-outreach", "mkt-templates"]);
  });

  it("Cmd+K entries cover every leaf across all workspaces", () => {
    const leafCount = WORKSPACES.reduce((n, ws) => n + workspaceLeaves(ws).length, 0);
    const entries = buildCmdKEntries();
    expect(entries.length).toBe(leafCount);
    expect(new Set(entries.map(e => e.id)).size).toBe(entries.length);
  });
});

// ─── Explorer active-item resolution ──────────────────────────────────────────

describe("Explorer active-item resolution", () => {
  const plain: TreeItem = { id: "leads", label: "Leads", path: "/pipeline/leads" };
  const tabbed: TreeItem = { id: "campaigns", label: "Campaigns", path: "/command/marketing?tab=campaigns" };
  const mktDashboard: TreeItem = { id: "dash", label: "Dashboard", path: "/command/marketing" };

  it("plain leaf matches its exact path and sub-paths", () => {
    expect(isItemActive(plain, "/pipeline/leads", "")).toBe(true);
    expect(isItemActive(plain, "/pipeline/leads/sub", "")).toBe(true);
    expect(isItemActive(plain, "/pipeline/clients", "")).toBe(false);
  });

  it("?tab= leaf requires both pathname and tab param to match", () => {
    expect(isItemActive(tabbed, "/command/marketing", "tab=campaigns")).toBe(true);
    expect(isItemActive(tabbed, "/command/marketing", "tab=outreach")).toBe(false);
    expect(isItemActive(tabbed, "/command/marketing", "")).toBe(false);
    expect(isItemActive(tabbed, "/delivery/projects", "tab=campaigns")).toBe(false);
  });

  it("the query-less Marketing Dashboard leaf yields to ?tab= siblings", () => {
    expect(isItemActive(mktDashboard, "/command/marketing", "")).toBe(true);
    expect(isItemActive(mktDashboard, "/command/marketing", "tab=campaigns")).toBe(false);
  });

  it("group nodes without paths are never active", () => {
    const group: TreeItem = { id: "g", label: "Group", children: [plain] };
    expect(isItemActive(group, "/pipeline/leads", "")).toBe(false);
  });
});

// ─── Collapsible-node keys + auto-expand chain ────────────────────────────────

describe("Collapsible-node persistence keys", () => {
  it("namespaces section keys by workspace so same-named sections don't collide", () => {
    // Both Command and System own a section with id "communications".
    const commandComms = sectionNodeKey("command", "communications");
    const systemComms = sectionNodeKey("system", "communications");
    expect(commandComms).toBe("command/communications");
    expect(systemComms).toBe("system/communications");
    expect(commandComms).not.toBe(systemComms);
  });

  it("builds group keys under their parent key", () => {
    const secKey = sectionNodeKey("command", "marketing");
    expect(groupNodeKey(secKey, "mkt-leads")).toBe("command/marketing/mkt-leads");
  });
});

describe("Active-ancestor auto-expand chain", () => {
  it("returns the workspace + section chain for a plain leaf", () => {
    // /pipeline/leads is a leaf under the pipeline > leads section.
    expect(activeAncestorKeys("/pipeline/leads", "")).toEqual([
      "pipeline",
      "pipeline/leads",
    ]);
  });

  it("includes the group node when the active leaf is nested in a group", () => {
    // /command/marketing?tab=recommendations is under command > marketing > mkt-leads.
    expect(activeAncestorKeys("/command/marketing", "tab=recommendations")).toEqual([
      "command",
      "command/marketing",
      "command/marketing/mkt-leads",
    ]);
  });

  it("falls back to just the owning workspace for a detail route with no leaf", () => {
    expect(activeAncestorKeys("/crm/leads/42", "")).toEqual(["pipeline"]);
  });

  it("returns an empty chain for a path owned by no workspace", () => {
    expect(activeAncestorKeys("/totally-unknown", "")).toEqual([]);
  });

  it("every key in the chain is a real, resolvable node key", () => {
    // The section key in the chain must correspond to an actual section.
    const chain = activeAncestorKeys("/delivery/fulfillment-queue", "");
    expect(chain[0]).toBe("delivery");
    expect(chain).toContain(sectionNodeKey("delivery", "fulfillment"));
  });
});

// ─── Property Panel ───────────────────────────────────────────────────────────

describe("Property Panel selection resolution", () => {
  const explorerSel: PropertySelection = {
    source: "explorer",
    title: "Leads",
    properties: [{ label: "Route", value: "/pipeline/leads", mono: true }],
  };
  const tabFallback: PropertySelection = {
    source: "tab",
    title: "Invoices",
    properties: [{ label: "Workspace", value: "Finance" }],
  };

  it("shows the explicit selection when one is published", () => {
    expect(resolveShownSelection(explorerSel, tabFallback)).toBe(explorerSel);
  });

  it("falls back to active-tab metadata when nothing is selected", () => {
    expect(resolveShownSelection(null, tabFallback)).toBe(tabFallback);
  });

  it("shows nothing when there is neither a selection nor a fallback", () => {
    expect(resolveShownSelection(null, null)).toBeNull();
  });
});
