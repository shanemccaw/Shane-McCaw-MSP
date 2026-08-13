// artifacts/admin-panel/src/components/simulatorTreeState.ts
//
// Pure read/write helpers for SimulatorLeftTree's expand/collapse persistence.
// Split out from the component (a .tsx importing React/lucide) so this pure
// logic can be unit-tested directly, matching the flowTree.ts / ancestorOutputs.ts
// convention already used elsewhere in this app.
//
// Pure UI state (which tree nodes are open), not data — same shared-default,
// no-per-user-scoping convention GlobalIDEShell.tsx already uses for its own
// nav tree's LS_NAV_EXPANDED key. A reload used to reset every node back to
// its hardcoded default; this keeps whatever the operator last left open.

export const LS_TREE_STATE = "simulator_tree_expanded_v1";

export interface PersistedTreeState {
  sections: Record<string, boolean>;
  cats: Record<string, boolean>;
}

export function readTreeState(): PersistedTreeState | null {
  try {
    const raw = localStorage.getItem(LS_TREE_STATE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { sections, cats } = parsed as Record<string, unknown>;
    return {
      sections: sections && typeof sections === "object" ? (sections as Record<string, boolean>) : {},
      cats: cats && typeof cats === "object" ? (cats as Record<string, boolean>) : {},
    };
  } catch {
    return null;
  }
}

export function writeTreeState(state: PersistedTreeState): void {
  try {
    localStorage.setItem(LS_TREE_STATE, JSON.stringify(state));
  } catch {
    // Storage can be full or blocked (private browsing) — collapse state just
    // won't survive a reload, which is the pre-existing behavior.
  }
}

export const DEFAULT_EXPANDED_CATS: Record<string, boolean> = {
  billing: true,
  security: true,
  sla: true,
  crm: true,
  "QA Asserts": true,
  Maintenance: true,
};
