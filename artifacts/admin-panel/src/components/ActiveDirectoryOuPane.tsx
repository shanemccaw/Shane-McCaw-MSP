// artifacts/admin-panel/src/components/ActiveDirectoryOuPane.tsx
//
// Organizational Unit detail pane (Phase 5, Issue #65). OUs are a real,
// persisted container object, but policy enforcement is explicitly
// undefined per Shane — this pane states that honestly rather than
// rendering a blank/broken page or inventing policy logic.

import { FolderCog } from "lucide-react";

export function ActiveDirectoryOuPane({ name }: { name: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <FolderCog className="h-8 w-8 text-amber-600 dark:text-amber-500" />
      <p className="font-mono text-sm text-foreground">OU={name}</p>
      <div className="max-w-md rounded border border-amber-600/30 bg-amber-500/10 px-4 py-3 text-xs text-foreground/80">
        <p className="font-semibold text-amber-700 dark:text-amber-400">Policy enforcement not yet implemented</p>
        <p className="mt-1 text-muted-foreground">
          This Organizational Unit is a real container object, but it does not yet enforce any policy or restrict
          membership. Policy semantics (e.g. account lockout at the OU level) are reserved for a future version of
          the Active Directory initiative.
        </p>
      </div>
    </div>
  );
}
