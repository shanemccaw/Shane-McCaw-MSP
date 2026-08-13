// artifacts/admin-panel/src/components/activeDirectoryTreeState.ts
//
// Pure read/write helpers for ActiveDirectoryTree's expand/collapse
// persistence, mirroring simulatorTreeState.ts's LS_TREE_STATE convention —
// same shared-default, no-per-user-scoping precedent GlobalIDEShell.tsx's own
// nav tree (LS_NAV_EXPANDED) already established.

export const LS_AD_TREE_STATE = "active_directory_tree_expanded_v1";

export interface AdPersistedTreeState {
  mspsOpen: boolean;
  groupsOpen: boolean;
  ousOpen: boolean;
  expandedMspIds: number[];
  // Phase 10 (Issue #91): expand state for each Tenant node's nested Users list.
  expandedCustomerIds: number[];
}

const DEFAULTS: AdPersistedTreeState = {
  mspsOpen: true,
  groupsOpen: true,
  ousOpen: true,
  expandedMspIds: [],
  expandedCustomerIds: [],
};

export function readAdTreeState(): AdPersistedTreeState {
  try {
    const raw = localStorage.getItem(LS_AD_TREE_STATE);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return DEFAULTS;
    const { mspsOpen, groupsOpen, ousOpen, expandedMspIds, expandedCustomerIds } = parsed as Record<string, unknown>;
    return {
      mspsOpen: typeof mspsOpen === "boolean" ? mspsOpen : DEFAULTS.mspsOpen,
      groupsOpen: typeof groupsOpen === "boolean" ? groupsOpen : DEFAULTS.groupsOpen,
      ousOpen: typeof ousOpen === "boolean" ? ousOpen : DEFAULTS.ousOpen,
      expandedMspIds: Array.isArray(expandedMspIds)
        ? expandedMspIds.filter((x): x is number => typeof x === "number")
        : [],
      expandedCustomerIds: Array.isArray(expandedCustomerIds)
        ? expandedCustomerIds.filter((x): x is number => typeof x === "number")
        : [],
    };
  } catch {
    return DEFAULTS;
  }
}

export function writeAdTreeState(state: AdPersistedTreeState): void {
  try {
    localStorage.setItem(LS_AD_TREE_STATE, JSON.stringify(state));
  } catch {
    // Storage can be full or blocked (private browsing) — collapse state just
    // won't survive a reload, matching simulatorTreeState.ts's own fallback.
  }
}
