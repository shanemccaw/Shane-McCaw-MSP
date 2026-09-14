import type { ReactNode } from "react";

/**
 * Shared chrome for the 3 Public Share Pages (#4001, Feature #1663) — the
 * design (`Public Share Pages.dc.html`) fixes this surface to a dark,
 * always-navy background regardless of the signed-in app's own light/dark
 * preference, same reasoning `AuthPageShell` already documents for the Auth
 * Core screens: there is no user here to have a preference. `dark` forces
 * the app's own dark theme tokens rather than inventing a second palette.
 */
export function PublicShareShell({ topLine, children }: { topLine: string; children: ReactNode }) {
  return (
    <div className="dark flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-2.5 px-7 pt-4.5">
        <span className="flex size-[26px] flex-none items-center justify-center rounded-[7px] bg-gradient-to-br from-primary to-status-blue text-[10px] font-extrabold text-primary-foreground">
          SM
        </span>
        <span className="text-[13px] font-semibold text-foreground">Shane McCaw Consulting</span>
        <span className="ml-auto text-[11px] text-muted-foreground">{topLine}</span>
      </div>
      <div className="flex flex-1 flex-col items-center gap-3.5 px-6 pb-14 pt-7">{children}</div>
    </div>
  );
}
