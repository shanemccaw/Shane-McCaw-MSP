// Pure tab-state engine for the global IDE shell — the generalization of the
// tab semantics proven inside the old IDEShell/MarketingCommandCenter pair:
// open-on-navigate, no duplicates, keep-mounted on switch, close activates
// the last remaining tab. Pure data logic, unit-tested in IDEShell.test.ts.

export interface ShellTab {
  /** Tab key — the route pathname (query excluded: one tab per page). */
  id: string;
  label: string;
}

export interface TabState {
  tabs: ShellTab[];
  activeId: string | null;
}

export function initialTabState(): TabState {
  return { tabs: [], activeId: null };
}

/** Navigate to a path: open its tab if missing, activate it. */
export function openTab(state: TabState, id: string, label: string): TabState {
  const existing = state.tabs.find(t => t.id === id);
  if (existing) {
    // Refresh label (detail tabs can resolve better labels later)
    const tabs = existing.label === label
      ? state.tabs
      : state.tabs.map(t => (t.id === id ? { ...t, label } : t));
    return { tabs, activeId: id };
  }
  return { tabs: [...state.tabs, { id, label }], activeId: id };
}

/**
 * Close a tab. Returns the next state plus the id that should become active
 * (null if no tabs remain — caller navigates to the workspace default).
 */
export function closeTab(state: TabState, id: string): { state: TabState; nextActiveId: string | null } {
  const idx = state.tabs.findIndex(t => t.id === id);
  if (idx === -1) return { state, nextActiveId: state.activeId };
  const tabs = state.tabs.filter(t => t.id !== id);
  if (state.activeId !== id) {
    return { state: { tabs, activeId: state.activeId }, nextActiveId: state.activeId };
  }
  const next = tabs.length > 0 ? tabs[Math.min(idx, tabs.length - 1)].id : null;
  return { state: { tabs, activeId: next }, nextActiveId: next };
}

/** Select an already-open tab. No-op if unknown. */
export function selectTab(state: TabState, id: string): TabState {
  if (!state.tabs.some(t => t.id === id)) return state;
  return { ...state, activeId: id };
}
