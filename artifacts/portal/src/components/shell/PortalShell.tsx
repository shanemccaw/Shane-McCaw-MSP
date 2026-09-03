import { useEffect, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { TopBar, type Breadcrumb } from "./TopBar";
import { PillarTabStrip } from "./PillarTabStrip";
import { SidebarNav } from "./SidebarNav";
import { usePillarSummaryShell } from "./usePillarSummary";
import { SEVERITY_WASH, SEVERITY_WASH_ORDER } from "./severityWash";

function useBreadcrumb(): Breadcrumb {
  const [location] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);

  if (location === "/") return { current: "Overview" };
  if (location === "/support") return { current: "Support" };

  if (location === "/coming-soon") {
    const feature = params.get("feature");
    const group = params.get("group");
    if (feature && group === "pillar") return { parent: "Pillars", current: feature };
    if (feature) return { current: feature };
  }

  return { current: "Portal" };
}

/**
 * The real portal application shell (Git #1819), replacing the bare frame
 * `components/layout.tsx` used to be. Builds, per the issue's own scope, the
 * top bar, the six-pillar tab strip, the sidebar module nav, the content
 * slot, and the frame-level severity wash — see build-journal/1819.md for
 * what is deliberately NOT built here (the Tenant Status card / live scan
 * progress, the three popovers' contents, the right-slide panel, ShaneBot
 * dock and Settings container all mount inside this shell under their own
 * chained issues, #1820-#1824).
 */
export function PortalShell({ children }: { children: ReactNode }) {
  const breadcrumb = useBreadcrumb();
  const { scores, overallSeverity } = usePillarSummaryShell();

  // docs/design-system.md §6: "Dark canvas is the default and only theme for
  // the portal." `.dark` (index.css) is literally this app's Customer Portal
  // palette, but <ThemeProvider> otherwise defaults to the OS preference —
  // this frame is what actually owns the canvas, so it's what enforces that.
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <div
      className="relative w-full overflow-hidden"
      style={{ height: "100dvh", background: "#020617", fontFamily: "Inter, system-ui, sans-serif" }}
    >
      {/* Static top-right ambient glow — always present, independent of severity. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(700px 420px at 100% 0%, rgba(0,180,216,.05), transparent)" }}
      />
      {/* Severity wash — every band mounted, cross-faded by opacity so a band
          change is a slow transition rather than a snap (docs/design-system.md §5). */}
      {SEVERITY_WASH_ORDER.map((band) => (
        <div
          key={band}
          className="pointer-events-none absolute inset-0"
          style={{
            background: SEVERITY_WASH[band],
            opacity: overallSeverity === band ? 1 : 0,
            transition: "opacity 1800ms cubic-bezier(.4,0,.2,1)",
          }}
        />
      ))}

      <div className="relative flex h-full flex-col">
        <TopBar breadcrumb={breadcrumb} />
        <PillarTabStrip scores={scores} />
        <div className="flex min-h-0 flex-1">
          <SidebarNav />
          <div className="relative flex min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      </div>
    </div>
  );
}
