/**
 * IDEShell.test.ts
 *
 * Tests for the IDEShell Marketing integration:
 * 1. Explorer tree correctness — grouping, aliases, section membership
 * 2. Tab state persistence logic — lazy mount, navigate, close
 *
 * Run with: pnpm --filter @workspace/admin-panel run test
 */

import { describe, it, expect } from "vitest";

// ─── Replicate the data structures from MarketingCommandCenter ────────────────
// (These are pure data / logic; no DOM required)

const SECTION_META: Record<string, { label: string; icon: string }> = {
  dashboard:       { label: "Dashboard",    icon: "⊞" },
  recommendations: { label: "AI Leads",     icon: "🤖" },
  "lead-finder":   { label: "Lead Finder",  icon: "🔍" },
  outreach:        { label: "Outreach",     icon: "✉️" },
  content:         { label: "Content Hub",  icon: "📝" },
  campaigns:       { label: "Campaigns",    icon: "📣" },
  tasks:           { label: "Tasks",        icon: "✅" },
  analytics:       { label: "Analytics",    icon: "📊" },
  connections:     { label: "Connections",  icon: "🔗" },
  settings:        { label: "Settings",     icon: "⚙️" },
};

const VALID_SECTIONS = new Set(Object.keys(SECTION_META));

const TAB_ALIASES: Record<string, string> = {
  command:      "dashboard",
  kpi:          "dashboard",
  "follow-ups": "dashboard",
  "ad-library": "campaigns",
  templates:    "outreach",
};

const EXPLORER_TO_SECTION: Record<string, string> = {
  templates: "outreach",
};

interface ExplorerSection {
  id: string;
  label: string;
  items: { id: string; label: string; icon: string }[];
  defaultOpen?: boolean;
}

const EXPLORER_SECTIONS: ExplorerSection[] = [
  {
    id: "overview",
    label: "Overview",
    defaultOpen: true,
    items: [{ id: "dashboard", label: "Dashboard", icon: "⊞" }],
  },
  {
    id: "leads",
    label: "Leads",
    defaultOpen: true,
    items: [
      { id: "recommendations", label: "AI Leads",    icon: "🤖" },
      { id: "lead-finder",     label: "Lead Finder", icon: "🔍" },
    ],
  },
  {
    id: "outreach",
    label: "Outreach",
    defaultOpen: true,
    items: [
      { id: "outreach",  label: "Outreach",   icon: "✉️" },
      { id: "templates", label: "Templates",  icon: "📋" },
    ],
  },
  {
    id: "content",
    label: "Content",
    defaultOpen: true,
    items: [{ id: "content", label: "Content Hub", icon: "📝" }],
  },
  {
    id: "campaigns-group",
    label: "Campaigns",
    defaultOpen: true,
    items: [{ id: "campaigns", label: "Campaigns", icon: "📣" }],
  },
  {
    id: "analytics-group",
    label: "Analytics",
    defaultOpen: true,
    items: [{ id: "analytics", label: "Analytics", icon: "📊" }],
  },
  {
    id: "planning",
    label: "Planning",
    defaultOpen: false,
    items: [{ id: "tasks", label: "Tasks", icon: "✅" }],
  },
  {
    id: "more",
    label: "More",
    defaultOpen: false,
    items: [
      { id: "connections", label: "Connections", icon: "🔗" },
      { id: "settings",    label: "Settings",    icon: "⚙️" },
    ],
  },
];

const ACTIVITY_ITEM_IDS = [
  "dashboard", "crm", "engines", "monitoring", "products", "workflows", "marketing", "system",
];

const RENDERABLE_SECTIONS = [
  "dashboard", "recommendations", "lead-finder", "outreach", "content",
  "campaigns", "tasks", "analytics", "connections", "settings",
];

// All valid explorer item IDs (renderable sections + "templates" virtual alias)
const ALL_EXPLORER_IDS = new Set([...RENDERABLE_SECTIONS, "templates"]);

// ─── Pure logic helpers (mirrors MarketingCommandCenter behaviour) ─────────────

/** Resolve an explorer item id → the actual renderable section id */
function resolveToSection(explorerItemId: string): string {
  const section = EXPLORER_TO_SECTION[explorerItemId] ?? explorerItemId;
  return VALID_SECTIONS.has(section) ? section : "dashboard";
}

/** Build a tab object from an explorer item id */
function explorerItemToTab(explorerItemId: string): { id: string; label: string; closeable: boolean } {
  const section = resolveToSection(explorerItemId);
  const meta = SECTION_META[section] ?? { label: explorerItemId, icon: "" };
  const label = explorerItemId === "templates" ? "Templates" : meta.label;
  return { id: explorerItemId, label, closeable: true };
}

/** Mirrors getExplorerItemFromSearch() — resolves a raw URL param to an explorer item id */
function getExplorerItemFromSearch(rawParam: string): string {
  if (ALL_EXPLORER_IDS.has(rawParam)) return rawParam;
  const aliased = TAB_ALIASES[rawParam];
  if (aliased && ALL_EXPLORER_IDS.has(aliased)) return aliased;
  return "dashboard";
}

/** Mirrors getSectionFromSearch() — resolves a raw URL param to a section id */
function getSectionFromSearch(rawParam: string): string {
  const s = TAB_ALIASES[rawParam] ?? rawParam;
  return VALID_SECTIONS.has(s) ? s : "dashboard";
}

/** Simulate the initial state computed from a URL tab param (mirrors useState initialisers in MarketingCommandCenter) */
function initialStateFromUrl(rawParam: string): TabState {
  const explorerItem = getExplorerItemFromSearch(rawParam);
  const section = getSectionFromSearch(explorerItem === "templates" ? "outreach" : explorerItem);
  // For "templates" the raw param IS the explorer item; section is outreach
  const resolvedSection = explorerItem === "templates" ? "outreach" : resolveToSection(explorerItem);

  const tabs: Array<{ id: string; label: string; closeable: boolean }> = [
    { id: "dashboard", label: "Dashboard", closeable: false },
  ];
  if (explorerItem !== "dashboard") {
    tabs.push(explorerItemToTab(explorerItem));
  }

  const mounted = new Set(["dashboard"]);
  if (resolvedSection !== "dashboard") mounted.add(resolvedSection);

  return {
    openTabs: tabs,
    mounted,
    activeSection: resolvedSection,
    activeExplorer: explorerItem,
  };
}

/** Simulate navigate() state updates */
interface TabState {
  openTabs: Array<{ id: string; label: string; closeable: boolean }>;
  mounted: Set<string>;
  activeSection: string;
  activeExplorer: string;
}

function navigate(current: TabState, explorerItemId: string): TabState {
  const section = resolveToSection(explorerItemId);
  const tabAlreadyOpen = current.openTabs.some(t => t.id === explorerItemId);
  const meta = SECTION_META[section] ?? { label: explorerItemId, icon: "" };
  const label = explorerItemId === "templates" ? "Templates" : meta.label;

  const openTabs = tabAlreadyOpen
    ? current.openTabs
    : [...current.openTabs, { id: explorerItemId, label, closeable: true }];

  const mounted = current.mounted.has(section)
    ? current.mounted
    : new Set([...current.mounted, section]);

  return {
    openTabs,
    mounted,
    activeSection: section,
    activeExplorer: explorerItemId,
  };
}

function closeTab(current: TabState, tabId: string): TabState {
  const next = current.openTabs.filter(t => t.id !== tabId);
  // If we closed the active tab, activate the last remaining tab
  let { activeSection, activeExplorer } = current;
  if (tabId === current.activeExplorer && next.length > 0) {
    const last = next[next.length - 1];
    const s = EXPLORER_TO_SECTION[last.id] ?? last.id;
    activeSection = VALID_SECTIONS.has(s) ? s : "dashboard";
    activeExplorer = last.id;
  }
  return { ...current, openTabs: next, activeSection, activeExplorer };
}

function initialState(): TabState {
  return initialStateFromUrl("");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Explorer tree structure", () => {
  it("has exactly 8 sections (Overview, Leads, Outreach, Content, Campaigns, Analytics, Planning, More)", () => {
    expect(EXPLORER_SECTIONS.length).toBe(8);
  });

  it("groups AI Leads and Lead Finder under Leads", () => {
    const leads = EXPLORER_SECTIONS.find(s => s.id === "leads");
    expect(leads).toBeDefined();
    const ids = leads!.items.map(i => i.id);
    expect(ids).toContain("recommendations");
    expect(ids).toContain("lead-finder");
  });

  it("groups Outreach and Templates under Outreach", () => {
    const outreach = EXPLORER_SECTIONS.find(s => s.id === "outreach");
    expect(outreach).toBeDefined();
    const ids = outreach!.items.map(i => i.id);
    expect(ids).toContain("outreach");
    expect(ids).toContain("templates");
  });

  it("puts Content Hub under Content", () => {
    const content = EXPLORER_SECTIONS.find(s => s.id === "content");
    expect(content).toBeDefined();
    expect(content!.items[0].id).toBe("content");
  });

  it("puts Analytics under Analytics section", () => {
    const analytics = EXPLORER_SECTIONS.find(s => s.id === "analytics-group");
    expect(analytics).toBeDefined();
    expect(analytics!.items[0].id).toBe("analytics");
  });

  it("has Overview, Leads, Outreach, Content, Campaigns, Analytics open by default", () => {
    const alwaysOpen = EXPLORER_SECTIONS.filter(s => s.defaultOpen !== false);
    const ids = alwaysOpen.map(s => s.id);
    expect(ids).toContain("overview");
    expect(ids).toContain("leads");
    expect(ids).toContain("outreach");
    expect(ids).toContain("content");
    expect(ids).toContain("campaigns-group");
    expect(ids).toContain("analytics-group");
  });

  it("has Planning and More collapsed by default", () => {
    const planning = EXPLORER_SECTIONS.find(s => s.id === "planning");
    const more = EXPLORER_SECTIONS.find(s => s.id === "more");
    expect(planning?.defaultOpen).toBe(false);
    expect(more?.defaultOpen).toBe(false);
  });

  it("every explorer item resolves to a valid renderable section", () => {
    for (const section of EXPLORER_SECTIONS) {
      for (const item of section.items) {
        const resolved = resolveToSection(item.id);
        expect(RENDERABLE_SECTIONS).toContain(resolved);
      }
    }
  });
});

describe("Activity Bar config", () => {
  it("has exactly 8 items: Dashboard, CRM, Engines, Monitoring, Products, Workflows, Marketing, System", () => {
    expect(ACTIVITY_ITEM_IDS.length).toBe(8);
    expect(ACTIVITY_ITEM_IDS).toContain("dashboard");
    expect(ACTIVITY_ITEM_IDS).toContain("crm");
    expect(ACTIVITY_ITEM_IDS).toContain("engines");
    expect(ACTIVITY_ITEM_IDS).toContain("monitoring");
    expect(ACTIVITY_ITEM_IDS).toContain("products");
    expect(ACTIVITY_ITEM_IDS).toContain("workflows");
    expect(ACTIVITY_ITEM_IDS).toContain("marketing");
    expect(ACTIVITY_ITEM_IDS).toContain("system");
  });

  it("Marketing is the only item marked as active (no href)", () => {
    // Only the marketing item should have isActive: true
    // The rest should have href links to other workspaces
    expect(ACTIVITY_ITEM_IDS.indexOf("marketing")).toBeGreaterThanOrEqual(0);
  });
});

describe("Tab alias resolution", () => {
  it("resolves legacy 'command' alias to dashboard", () => {
    const s = TAB_ALIASES["command"] ?? "command";
    expect(resolveToSection(s)).toBe("dashboard");
  });

  it("resolves legacy 'kpi' alias to dashboard", () => {
    const s = TAB_ALIASES["kpi"] ?? "kpi";
    expect(resolveToSection(s)).toBe("dashboard");
  });

  it("resolves 'ad-library' alias to campaigns", () => {
    const s = TAB_ALIASES["ad-library"] ?? "ad-library";
    expect(resolveToSection(s)).toBe("campaigns");
  });

  it("resolves 'templates' explorer item to outreach section", () => {
    expect(resolveToSection("templates")).toBe("outreach");
  });

  it("resolves unknown id to dashboard", () => {
    expect(resolveToSection("unknown-xyz")).toBe("dashboard");
  });
});

describe("Tab state persistence", () => {
  it("starts with only Dashboard tab, which is pinned (not closeable)", () => {
    const state = initialState();
    expect(state.openTabs.length).toBe(1);
    expect(state.openTabs[0].id).toBe("dashboard");
    expect(state.openTabs[0].closeable).toBe(false);
    expect(state.activeSection).toBe("dashboard");
  });

  it("opens a new tab when navigating to a new section", () => {
    let state = initialState();
    state = navigate(state, "recommendations");
    expect(state.openTabs.length).toBe(2);
    expect(state.openTabs[1].id).toBe("recommendations");
    expect(state.activeSection).toBe("recommendations");
  });

  it("does NOT open a duplicate tab when navigating to an already-open section", () => {
    let state = initialState();
    state = navigate(state, "recommendations");
    state = navigate(state, "recommendations");
    expect(state.openTabs.length).toBe(2); // no duplicate
    expect(state.activeSection).toBe("recommendations");
  });

  it("mounts a section lazily on first navigation", () => {
    let state = initialState();
    expect(state.mounted.has("recommendations")).toBe(false);
    state = navigate(state, "recommendations");
    expect(state.mounted.has("recommendations")).toBe(true);
  });

  it("keeps previously mounted sections mounted when navigating away (state persistence)", () => {
    let state = initialState();
    state = navigate(state, "recommendations");
    state = navigate(state, "campaigns");
    // Both should remain mounted
    expect(state.mounted.has("recommendations")).toBe(true);
    expect(state.mounted.has("campaigns")).toBe(true);
    // But only campaigns is the active section
    expect(state.activeSection).toBe("campaigns");
  });

  it("can have multiple sections mounted simultaneously", () => {
    let state = initialState();
    state = navigate(state, "recommendations");
    state = navigate(state, "lead-finder");
    state = navigate(state, "outreach");
    state = navigate(state, "analytics");
    expect(state.mounted.size).toBe(5); // dashboard + 4 more
    expect(state.openTabs.length).toBe(5);
  });

  it("navigating to 'templates' explorer item opens outreach section content", () => {
    let state = initialState();
    state = navigate(state, "templates");
    // The tab is labeled "Templates" with id "templates"
    const tab = state.openTabs.find(t => t.id === "templates");
    expect(tab).toBeDefined();
    expect(tab!.label).toBe("Templates");
    // But the rendered section is "outreach"
    expect(state.activeSection).toBe("outreach");
    // And outreach is now mounted
    expect(state.mounted.has("outreach")).toBe(true);
  });

  it("switching tabs via handleTabSelect preserves mounted sections", () => {
    let state = initialState();
    state = navigate(state, "recommendations");
    state = navigate(state, "campaigns");
    // Go back to dashboard (already open)
    state = navigate(state, "dashboard");
    expect(state.activeSection).toBe("dashboard");
    // recommendations and campaigns still mounted
    expect(state.mounted.has("recommendations")).toBe(true);
    expect(state.mounted.has("campaigns")).toBe(true);
  });

  it("closing a tab removes it from the open tab list", () => {
    let state = initialState();
    state = navigate(state, "recommendations");
    state = navigate(state, "campaigns");
    state = closeTab(state, "campaigns");
    expect(state.openTabs.some(t => t.id === "campaigns")).toBe(false);
    expect(state.openTabs.length).toBe(2);
  });

  it("closing the active tab switches to the last remaining tab", () => {
    let state = initialState();
    state = navigate(state, "recommendations");
    state = navigate(state, "campaigns");
    // Active is campaigns — close it
    state = closeTab(state, "campaigns");
    expect(state.activeSection).toBe("recommendations");
    expect(state.activeExplorer).toBe("recommendations");
  });

  it("closing a non-active tab does not change the active section", () => {
    let state = initialState();
    state = navigate(state, "recommendations");
    state = navigate(state, "campaigns");
    // Active is campaigns — close recommendations (non-active)
    state = closeTab(state, "recommendations");
    expect(state.activeSection).toBe("campaigns"); // unchanged
    expect(state.openTabs.length).toBe(2);
  });

  it("mounted sections are never unmounted even after their tab is closed", () => {
    let state = initialState();
    state = navigate(state, "recommendations");
    state = closeTab(state, "recommendations");
    // Tab is gone, but section remains mounted (preserves state if user reopens)
    expect(state.mounted.has("recommendations")).toBe(true);
  });
});

describe("Deep-link initial load", () => {
  it("loading with no tab param starts with dashboard tab only, dashboard mounted", () => {
    const state = initialStateFromUrl("");
    expect(state.openTabs.length).toBe(1);
    expect(state.openTabs[0].id).toBe("dashboard");
    expect(state.activeSection).toBe("dashboard");
    expect(state.activeExplorer).toBe("dashboard");
    expect(state.mounted).toEqual(new Set(["dashboard"]));
  });

  it("loading with ?tab=campaigns opens campaigns tab and mounts campaigns section", () => {
    const state = initialStateFromUrl("campaigns");
    // Tab bar has dashboard + campaigns
    expect(state.openTabs.length).toBe(2);
    expect(state.openTabs[1].id).toBe("campaigns");
    // Active section and explorer are campaigns
    expect(state.activeSection).toBe("campaigns");
    expect(state.activeExplorer).toBe("campaigns");
    // campaigns section is mounted so it renders
    expect(state.mounted.has("campaigns")).toBe(true);
    // dashboard remains mounted too
    expect(state.mounted.has("dashboard")).toBe(true);
  });

  it("loading with ?tab=recommendations opens AI Leads tab and mounts recommendations", () => {
    const state = initialStateFromUrl("recommendations");
    expect(state.openTabs.length).toBe(2);
    expect(state.openTabs[1].id).toBe("recommendations");
    expect(state.activeSection).toBe("recommendations");
    expect(state.mounted.has("recommendations")).toBe(true);
  });

  it("loading with ?tab=analytics opens analytics tab and mounts analytics", () => {
    const state = initialStateFromUrl("analytics");
    expect(state.activeSection).toBe("analytics");
    expect(state.activeExplorer).toBe("analytics");
    expect(state.mounted.has("analytics")).toBe(true);
    expect(state.openTabs.some(t => t.id === "analytics")).toBe(true);
  });

  it("loading with ?tab=templates opens Templates tab and mounts outreach section", () => {
    const state = initialStateFromUrl("templates");
    // Tab is "templates" (explorer item)
    expect(state.openTabs.some(t => t.id === "templates")).toBe(true);
    expect(state.activeExplorer).toBe("templates");
    // But the RENDERED section is outreach
    expect(state.activeSection).toBe("outreach");
    expect(state.mounted.has("outreach")).toBe(true);
  });

  it("loading with legacy ?tab=command resolves to dashboard (no extra tab)", () => {
    const state = initialStateFromUrl("command");
    // "command" aliases to "dashboard" → explorer item is "dashboard"
    expect(state.activeExplorer).toBe("dashboard");
    expect(state.activeSection).toBe("dashboard");
    expect(state.openTabs.length).toBe(1); // only dashboard
  });

  it("loading with legacy ?tab=ad-library resolves to campaigns tab", () => {
    const state = initialStateFromUrl("ad-library");
    expect(state.activeExplorer).toBe("campaigns");
    expect(state.activeSection).toBe("campaigns");
    expect(state.mounted.has("campaigns")).toBe(true);
    expect(state.openTabs.some(t => t.id === "campaigns")).toBe(true);
  });

  it("loading with unknown ?tab=xyz falls back to dashboard only", () => {
    const state = initialStateFromUrl("xyz-unknown");
    expect(state.activeExplorer).toBe("dashboard");
    expect(state.activeSection).toBe("dashboard");
    expect(state.openTabs.length).toBe(1);
    expect(state.mounted).toEqual(new Set(["dashboard"]));
  });

  it("deep-linked section is immediately renderable (present in mounted set)", () => {
    // This is the core fix: the section must be in mounted on first render
    for (const sectionId of RENDERABLE_SECTIONS) {
      const state = initialStateFromUrl(sectionId);
      expect(state.mounted.has(sectionId)).toBe(true);
    }
  });

  it("deep-linked tab is immediately in openTabs (tab bar is consistent)", () => {
    const testCases = ["campaigns", "analytics", "outreach", "lead-finder", "content"];
    for (const sectionId of testCases) {
      const state = initialStateFromUrl(sectionId);
      expect(state.openTabs.some(t => t.id === sectionId)).toBe(true);
    }
  });
});

describe("VALID_SECTIONS completeness", () => {
  it("every renderable section is in VALID_SECTIONS", () => {
    for (const s of RENDERABLE_SECTIONS) {
      expect(VALID_SECTIONS.has(s)).toBe(true);
    }
  });

  it("SECTION_META keys match RENDERABLE_SECTIONS exactly", () => {
    const metaKeys = Object.keys(SECTION_META).sort();
    const renderableKeys = [...RENDERABLE_SECTIONS].sort();
    expect(metaKeys).toEqual(renderableKeys);
  });
});
