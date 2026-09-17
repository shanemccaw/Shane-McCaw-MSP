import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useLocation, useSearch } from "wouter";
import { PILLARS, PILLAR_KEYS } from "@workspace/copilot-scan-scene/journeyTokens";
import { TopBar, type Breadcrumb } from "./TopBar";
import { PillarTabStrip } from "./PillarTabStrip";
import { SidebarNav } from "./SidebarNav";
import { usePillarSummaryShell } from "./usePillarSummary";
import { SEVERITY_WASH, SEVERITY_WASH_ORDER } from "./severityWash";
import { TenantStatusCard } from "./TenantStatusCard";
import { ScanLogPanel } from "./ScanLogPanel";
import { useScanState } from "./useScanState";
import { ScanStateContext } from "./scanStateContext";
import { TestimonialPromptBanner } from "@/components/testimonials/TestimonialPromptBanner";

/**
 * Git #4004 / Shell.dc.html's own `_rz` resize handler: "measured against
 * its own width" (Mobile Preview.dc.html), not the window's — the real
 * source measures `rootRef.current.getBoundingClientRect().width`, not
 * `window.innerWidth` / a media query, so an embedded or letterboxed shell
 * still gets its own drawer/bottom-sheet breakpoint. Same 760px threshold
 * the ScanLogPanel bottom sheet already used.
 */
function useNarrowShell(ref: RefObject<HTMLDivElement | null>): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setNarrow(el.getBoundingClientRect().width < 760);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return narrow;
}

function useBreadcrumb(): Breadcrumb {
  const [location] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);

  if (location === "/") return { current: "Overview" };
  if (location === "/support") return { current: "Support" };
  if (location === "/requests") return { current: "Requests" };
  if (location === "/testimonials") return { current: "Testimonials" };
  if (location === "/my-architect") return { current: "My Architect" };
  if (location === "/break-glass" || location.startsWith("/break-glass/")) return { current: "Break-glass access" };

  const pillarMatch = PILLAR_KEYS.find((k) => location === `/pillars/${k}`);
  if (pillarMatch) return { parent: "Pillars", current: PILLARS[pillarMatch].label };

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
 * what is deliberately NOT built here. The Tenant Status card / live scan
 * progress (this file's own #1824) now mounts here too, via `SidebarNav`'s
 * reserved `footerSlot`; the three popovers' contents, ShaneBot dock and
 * Settings container remain out of scope, under their own chained issues
 * (#1820-#1823).
 */
export function PortalShell({ children }: { children: ReactNode }) {
  const breadcrumb = useBreadcrumb();
  const scan = useScanState();
  // Git #4557 — `scan.phase` is the real, reactive completion signal
  // (SSE + adaptive poll); passing it in lets the tab-strip/wash's one-shot
  // `/api/portal/pillars` fetch refetch the instant a run actually finishes,
  // instead of only ever reading whatever was true at mount.
  const { scores, overallSeverity } = usePillarSummaryShell(scan.phase);
  const rootRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrowShell(rootRef);
  const [scanLogOpen, setScanLogOpen] = useState(false);
  // Shell.dc.html's own `drawer` state is raw ("open/closed, as last
  // requested"); `drawerOpen` is always the *derived* `narrow && drawer` —
  // so widening back past 760px silently closes the drawer without a
  // separate reset effect, and re-narrowing never reopens a stale request.
  const [drawerRequested, setDrawerRequested] = useState(false);
  const drawerOpen = narrow && drawerRequested;
  const sidebarShow = !narrow || drawerOpen;

  // The frame-level score isn't a separate fetch — it's the same real
  // per-pillar scores the tab strip already reads, averaged the identical
  // way usePillarSummaryShell derives overallSeverity from them, so the two
  // numbers can never disagree about what was actually observed.
  const scoredValues = Object.values(scores).filter((s) => s.scored && s.score !== null);
  const overallScore =
    scoredValues.length === 0
      ? null
      : Math.round(scoredValues.reduce((sum, s) => sum + (s.score as number), 0) / scoredValues.length);

  // docs/design-system.md §6: "Dark canvas is the default and only theme for
  // the portal." `.dark` (index.css) is literally this app's Customer Portal
  // palette, but <ThemeProvider> otherwise defaults to the OS preference —
  // this frame is what actually owns the canvas, so it's what enforces that.
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <ScanStateContext.Provider value={scan}>
      <div
        ref={rootRef}
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
          <TopBar
            breadcrumb={breadcrumb}
            narrow={narrow}
            drawerOpen={drawerOpen}
            onToggleDrawer={() => setDrawerRequested((v) => !v)}
          />
          <TestimonialPromptBanner />
          <PillarTabStrip scores={scores} />
          <div className="relative flex min-h-0 flex-1">
            {/* Shell.dc.html: scrim sits behind the drawer, closes it on click,
                only ever mounted while the drawer is actually open. */}
            {drawerOpen ? (
              <div
                className="absolute inset-0"
                style={{ zIndex: 56, background: "rgba(2,6,23,.62)" }}
                onClick={() => setDrawerRequested(false)}
                aria-hidden="true"
              />
            ) : null}
            {sidebarShow ? (
              <SidebarNav
                narrow={narrow}
                onNavigate={() => setDrawerRequested(false)}
                footerSlot={
                  <TenantStatusCard
                    scan={scan}
                    overallScore={overallScore}
                    overallSeverity={overallSeverity}
                    onOpenLog={() => setScanLogOpen(true)}
                  />
                }
              />
            ) : null}
            <div className="relative flex min-h-0 flex-1 overflow-y-auto">{children}</div>
          </div>
          {/* README "Right-slide detail panel": content is derived at render
              time from live scan state, not snapshotted when it opens — `scan`
              here is the same live object the card reads, so the panel never
              freezes on stale data while it's open. */}
          {scanLogOpen ? <ScanLogPanel scan={scan} narrow={narrow} onClose={() => setScanLogOpen(false)} /> : null}
        </div>
      </div>
    </ScanStateContext.Provider>
  );
}
