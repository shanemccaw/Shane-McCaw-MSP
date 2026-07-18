/**
 * IDEShell.test.ts
 *
 * Tests for the global IDE shell:
 * 1. Tab engine semantics — open-on-navigate, no duplicates, close behavior
 *    (the generalization of the tab logic proven in the old per-page IDEShell)
 * 2. Workspace navigation config integrity — trees, routes, activity bar
 * 3. Explorer active-item resolution (incl. ?tab= leaves)
 * 4. Property Panel selection resolution
 *
 * Run with: pnpm --filter @workspace/admin-panel run test
 */

import { describe, it, expect } from "vitest";
import {
  closeTab,
  initialTabState,
  openTab,
  selectTab,
  type TabState,
} from "@/components/shell/tabEngine";
import {
  WORKSPACES,
  buildCmdKEntries,
  findWorkspace,
  isItemActive,
  resolveTabMeta,
  workspaceLeaves,
  type TreeItem,
} from "@/components/shell/workspaceNav";
import { resolveShownSelection, type PropertySelection } from "@/components/shell/PropertyPanelContext";

// ─── Tab engine ───────────────────────────────────────────────────────────────

describe("Tab engine", () => {
  it("starts empty", () => {
    const state = initialTabState();
    expect(state.tabs.length).toBe(0);
    expect(state.activeId).toBeNull();
  });

  it("opens a tab on first navigation and activates it", () => {
    let state = initialTabState();
    state = openTab(state, "/pipeline/leads", "Leads");
    expect(state.tabs.length).toBe(1);
    expect(state.tabs[0]).toEqual({ id: "/pipeline/leads", label: "Leads" });
    expect(state.activeId).toBe("/pipeline/leads");
  });

  it("does NOT open a duplicate tab when navigating to an already-open page", () => {
    let state = initialTabState();
    state = openTab(state, "/pipeline/leads", "Leads");
    state = openTab(state, "/finance/invoices", "Invoices");
    state = openTab(state, "/pipeline/leads", "Leads");
    expect(state.tabs.length).toBe(2);
    expect(state.activeId).toBe("/pipeline/leads");
  });

  it("keeps previously opened tabs when navigating away (persistence)", () => {
    let state = initialTabState();
    state = openTab(state, "/pipeline/leads", "Leads");
    state = openTab(state, "/finance/invoices", "Invoices");
    state = openTab(state, "/command/overview", "Overview");
    expect(state.tabs.map(t => t.id)).toEqual([
      "/pipeline/leads",
      "/finance/invoices",
      "/command/overview",
    ]);
    expect(state.activeId).toBe("/command/overview");
  });

  it("refreshes the label when reopening with a better label", () => {
    let state = initialTabState();
    state = openTab(state, "/crm/leads/42", "Lead Detail");
    state = openTab(state, "/crm/leads/42", "Lead #42");
    expect(state.tabs.length).toBe(1);
    expect(state.tabs[0].label).toBe("Lead #42");
  });

  it("closing a non-active tab does not change the active tab", () => {
    let state = initialTabState();
    state = openTab(state, "/pipeline/leads", "Leads");
    state = openTab(state, "/finance/invoices", "Invoices");
    const { state: next, nextActiveId } = closeTab(state, "/pipeline/leads");
    expect(next.tabs.length).toBe(1);
    expect(nextActiveId).toBe("/finance/invoices");
    expect(next.activeId).toBe("/finance/invoices");
  });

  it("closing the active tab activates its neighbor", () => {
    let state = initialTabState();
    state = openTab(state, "/pipeline/leads", "Leads");
    state = openTab(state, "/finance/invoices", "Invoices");
    state = openTab(state, "/command/overview", "Overview");
    const { state: next, nextActiveId } = closeTab(state, "/command/overview");
    expect(nextActiveId).toBe("/finance/invoices");
    expect(next.tabs.some(t => t.id === "/command/overview")).toBe(false);
  });

  it("closing a middle active tab activates the tab that took its index", () => {
    let state = initialTabState();
    state = openTab(state, "/a", "A");
    state = openTab(state, "/b", "B");
    state = openTab(state, "/c", "C");
    state = selectTab(state, "/b");
    const { nextActiveId } = closeTab(state, "/b");
    expect(nextActiveId).toBe("/c");
  });

  it("closing the last remaining tab yields null (caller falls back to workspace default)", () => {
    let state = initialTabState();
    state = openTab(state, "/pipeline/leads", "Leads");
    const { state: next, nextActiveId } = closeTab(state, "/pipeline/leads");
    expect(next.tabs.length).toBe(0);
    expect(nextActiveId).toBeNull();
  });

  it("closing an unknown tab is a no-op", () => {
    let state = initialTabState();
    state = openTab(state, "/pipeline/leads", "Leads");
    const { state: next } = closeTab(state, "/nope");
    expect(next.tabs.length).toBe(1);
  });

  it("selectTab is a no-op for unknown ids", () => {
    let state: TabState = initialTabState();
    state = openTab(state, "/pipeline/leads", "Leads");
    expect(selectTab(state, "/nope").activeId).toBe("/pipeline/leads");
  });
});

// ─── Workspace navigation config ──────────────────────────────────────────────

describe("Workspace config integrity", () => {
  it("has exactly 7 workspaces in activity-bar order", () => {
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
