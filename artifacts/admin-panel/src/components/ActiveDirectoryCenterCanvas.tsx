// artifacts/admin-panel/src/components/ActiveDirectoryCenterCanvas.tsx
//
// Middle detail pane, dispatched by selected object type (window CustomEvent,
// not prop-drilled state — same event-driven hand-off convention
// SimulatorLeftTree's canvases use). Phase 2 adds the real MSP Object
// renderer (ActiveDirectoryMspPane); Customer/RBAC Group/User stay Phase-1
// stubs ("selected: <type> <name>") until their own phases (3/4/6) ship.

import { useEffect, useState } from "react";
import { FolderTree } from "lucide-react";
import { AD_SELECT_EVENT, type AdSelectedObject, type AdSelectedType } from "./ActiveDirectoryTree";
import { ActiveDirectoryMspPane } from "./ActiveDirectoryMspPane";
import { ActiveDirectoryGroupPane } from "./ActiveDirectoryGroupPane";

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

  if (selected.type === "msp") {
    return <ActiveDirectoryMspPane key={selected.id} mspId={Number(selected.id)} />;
  }

  if (selected.type === "group") {
    return <ActiveDirectoryGroupPane key={selected.id} role={String(selected.id)} />;
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
