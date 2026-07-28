// artifacts/admin-panel/src/components/ActiveDirectoryCenterCanvas.tsx
//
// Phase 1 middle detail pane: dispatched-by-selected-type stub only ("selected:
// <type> <name>"), same event-driven hand-off convention SimulatorLeftTree's
// canvases use (window CustomEvent, not prop-drilled state). Full per-type
// detail rendering (MSP/Customer/RBAC Group/User) is additive in Phases 2/3/4/6
// — this phase only builds the dispatch mechanism those phases plug into.

import { useEffect, useState } from "react";
import { FolderTree } from "lucide-react";
import { AD_SELECT_EVENT, type AdSelectedObject, type AdSelectedType } from "./ActiveDirectoryTree";

const TYPE_LABEL: Record<AdSelectedType, string> = {
  msp: "MSP",
  customer: "Customer",
  group: "RBAC Group",
  user: "User",
};

export function ActiveDirectoryCenterCanvas() {
  const [selected, setSelected] = useState<AdSelectedObject | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<AdSelectedObject>).detail;
      setSelected(detail);
    };
    window.addEventListener(AD_SELECT_EVENT, handler);
    return () => window.removeEventListener(AD_SELECT_EVENT, handler);
  }, []);

  if (!selected) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select an MSP, Customer, or Group in the tree — or search — to view it here.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <FolderTree className="h-8 w-8 text-muted-foreground/50" />
      <p className="font-mono text-sm text-foreground">
        selected: {TYPE_LABEL[selected.type]} {selected.label}
      </p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Full detail rendering for this object type is a later phase of the Active Directory initiative
        (docs/build-plans/active-directory.md).
      </p>
    </div>
  );
}
