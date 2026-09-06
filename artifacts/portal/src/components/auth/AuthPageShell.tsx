import type { ReactNode } from "react";

/**
 * Shared chrome for the 6 unauthenticated Auth Core screens (#2991, Feature
 * #1648) — sign-in, account setup, forgot/reset password, sign-in help. The
 * design (`Design/portal/design_handoff_full_site/screens/Auth *.dc.html`)
 * fixes this surface to a dark, always-navy background regardless of the
 * signed-in app's own light/dark preference (there is no user yet to have a
 * preference), so this wraps its children in `dark` to force the app's own
 * dark theme tokens rather than inventing a second palette — the token
 * values (`--background: 229 84% 5%`, `--primary: 206 100% 52%`) already
 * land within a few percent of the design's literal `#020617`/`#0078D4`.
 */
export function AuthPageShell({
  title,
  subtitle,
  maxWidthClassName = "max-w-[430px]",
  children,
}: {
  title: string;
  subtitle: string;
  maxWidthClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="dark flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex flex-1 items-start justify-center px-5 py-14">
        <div className={`flex w-full flex-col gap-5 ${maxWidthClassName}`}>
          <div className="flex items-center gap-3">
            <span className="flex size-9 flex-none items-center justify-center rounded-[10px] bg-gradient-to-br from-primary to-status-blue text-sm font-extrabold text-primary-foreground">
              SM
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-tight text-foreground">{title}</span>
              <span className="text-xs text-muted-foreground">{subtitle}</span>
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
