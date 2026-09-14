import type { ReactNode } from "react";

/**
 * Shared chrome for the Consent and Onboarding surface (Feature #1650, Git
 * #3993) — `Design/portal/design_handoff_full_site/screens/Consent and
 * Onboarding.dc.html`. Every scene in that export shares this same top bar
 * (brand + a live state dot/line) and centered card layout; this is that
 * chrome, factored out so consent-success/declined/tenant-conflict/
 * onboarding-link don't each re-draw it.
 */
export function ConsentOnboardingShell({
  stateLine,
  isAlert = false,
  children,
  footer,
}: {
  /** e.g. "Consent callback · portal origin · granted" — the design's {{stateLine}}. */
  stateLine: string;
  /** Red dot instead of green — the design's declined/tenant-conflict tone. */
  isAlert?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="dark flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-2.5 px-5 pt-4 sm:px-7">
        <span className="flex size-[26px] flex-none items-center justify-center rounded-[7px] bg-gradient-to-br from-primary to-status-blue text-[10px] font-extrabold tracking-wide text-primary-foreground">
          SM
        </span>
        <span className="text-[13px] font-semibold text-foreground">Shane McCaw Consulting</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={`size-1.5 rounded-full ${isAlert ? "bg-destructive" : "bg-status-green"}`} />
          {stateLine}
        </span>
      </div>

      <div className="flex flex-1 flex-col items-center gap-3.5 px-5 py-9 sm:py-14">
        {children}
        {footer}
      </div>
    </div>
  );
}

export function ConsentCard({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "danger" }) {
  return (
    <div
      className={`flex w-full max-w-[600px] flex-col gap-3.5 rounded-2xl border p-6 pb-6 ${
        tone === "danger" ? "border-destructive/30 bg-destructive/5" : "border-border/60 bg-card/40"
      }`}
    >
      {children}
    </div>
  );
}
