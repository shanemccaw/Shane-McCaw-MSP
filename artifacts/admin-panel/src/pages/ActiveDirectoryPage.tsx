// artifacts/admin-panel/src/pages/ActiveDirectoryPage.tsx
//
// Legacy /system/active-directory surface, deprecated per Shane's call
// (Git #4499): AdminV2's MSP Directory (screen id `msp-directory`) now has
// full parity plus reassignment/findings-drill-down this page never had
// (#4492, #4493). This page no longer fetches or renders any directory
// data itself — just a notice pointing at the real screen.

import { useLocation } from "wouter";
import { FolderTree, ArrowRight } from "lucide-react";
import { Button } from "../components/ui/button";

export function ActiveDirectoryPage() {
  const [, navigate] = useLocation();

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background font-sans text-foreground">
      <header className="flex h-9 shrink-0 items-center gap-2.5 border-b border-border bg-card px-3 select-none">
        <span className="text-[11px] font-semibold tracking-wide text-foreground">Active Directory</span>
        <span className="rounded-sm border border-border bg-background px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
          Platform admin
        </span>
      </header>

      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card">
            <FolderTree className="h-6 w-6 text-muted-foreground" />
          </div>
          <h1 className="text-base font-semibold text-foreground">This page has moved</h1>
          <p className="text-sm text-muted-foreground">
            Active Directory has moved to MSP Directory. This page is no longer maintained — use MSP
            Directory for MSP/tenant/customer/group management going forward.
          </p>
          <Button onClick={() => navigate("/adminv2/msp-directory")} className="gap-1.5">
            Go to MSP Directory
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
