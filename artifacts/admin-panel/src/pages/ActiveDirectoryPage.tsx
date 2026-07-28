// artifacts/admin-panel/src/pages/ActiveDirectoryPage.tsx
//
// Phase 1 IDE shell for the Active Directory admin surface: left Explorer tree
// (OU=MSPs + nested Customers, Groups, universal search) + center detail pane
// (dispatch-by-selected-type stub). Mirrors SimulatorStudioPage.tsx's
// left-tree/center-canvas composition inside the app-level GlobalIDEShell —
// no new IDE paradigm, just this initiative's own two panels.

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../components/ui/resizable";
import { ActiveDirectoryTree } from "../components/ActiveDirectoryTree";
import { ActiveDirectoryCenterCanvas } from "../components/ActiveDirectoryCenterCanvas";

export function ActiveDirectoryPage() {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background font-sans text-foreground">
      <header className="flex h-9 shrink-0 items-center gap-2.5 border-b border-border bg-card px-3 select-none">
        <span className="text-[11px] font-semibold tracking-wide text-foreground">Active Directory</span>
        <span className="rounded-sm border border-border bg-background px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
          Platform admin
        </span>
      </header>

      <div className="min-h-0 flex-1">
        <ResizablePanelGroup direction="horizontal" autoSaveId="active-directory-h">
          <ResizablePanel id="ad-explorer" order={1} defaultSize={22} minSize={16} maxSize={36}>
            <ActiveDirectoryTree />
          </ResizablePanel>
          <ResizableHandle className="w-px bg-border" />
          <ResizablePanel id="ad-canvas" order={2} defaultSize={78} minSize={40}>
            <ActiveDirectoryCenterCanvas />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
