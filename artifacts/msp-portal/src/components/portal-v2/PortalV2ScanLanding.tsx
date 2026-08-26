/**
 * PortalV2ScanLanding.tsx — Scene 0, ported as the Customer Portal v2 landing
 * experience for a customer who arrives with no scan data yet (Git #1298).
 *
 * WHAT THIS IS AND WHY IT EXISTS
 * ------------------------------
 * A CustomerUser logs straight into `/portal-v2` (the Overview) — they do NOT
 * come through the old Copilot Readiness journey, whose Scene 0 fired at
 * consent time. So a freshly-created tenant hits the Overview with nothing to
 * grade and no scan progress to watch. This ports the SAME Scene 0 the journey
 * uses — `RevealScanOverlay` (the live-scan radar) and `RevealNoScanGate` (the
 * "no scan yet" backstop) — as a full-bleed overlay that owns the viewport
 * until the tenant has a scan, then hands off to the Overview underneath.
 *
 * It is a PORT, not a rebuild: the progress UI is the real `RevealScanOverlay`
 * component, unchanged; the auto-trigger decision is the already-extracted,
 * unit-tested `decideAutoScan` / `shouldBlockNeverScanned`; the run itself is
 * driven by the real `useScanStatus` + `useCopilotJourney` data. The only thing
 * that genuinely differs from the journey's Scene 0 is the destination — where
 * the journey dissolves Scene 0 into Scenes 1-9, this dissolves it into the
 * Overview (`onComplete`).
 *
 * THE TRIGGER QUESTION (investigated per the issue)
 * -------------------------------------------------
 * `debug-trigger-scan` is the platform's ONLY scan trigger and is hard-gated
 * server-side to testbed tenants (portal-assessment.ts). A REAL customer's scan
 * fires at consent time (consent.ts's runDiagnostics) — there is no self-serve
 * trigger for them, to stop AI-credit spam. So this handles the trigger exactly
 * the way the journey's Scene 0 does and NO more: for a testbed tenant with no
 * scan, it POSTs the debug trigger; for a real tenant with no scan, it shows
 * the no-scan gate rather than inventing a second trigger pathway. This never
 * calls the trigger endpoint for a real customer.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { useScanStatus } from "@/lib/scan-status-context";

import { RevealNoScanGate } from "@/components/copilot-journey/RevealNoScanGate";
import { RevealScanOverlay } from "@/components/copilot-journey/RevealScanOverlay";
import { tenantStrip } from "@/components/copilot-journey/journeyModel.ts";
import { OVERLAY_FADE_MS } from "@/components/copilot-journey/journeyMotion.ts";
import { decideAutoScan } from "@/components/copilot-journey/revealAutoScan.ts";
import { shouldBlockNeverScanned } from "@/components/copilot-journey/neverScannedGate.ts";
import { useCopilotJourney } from "@/components/copilot-journey/useCopilotJourney.ts";
import "@/components/copilot-journey/copilot-journey.css";

export function PortalV2ScanLanding({ onComplete }: { onComplete: () => void }) {
  const { user, fetchWithAuth } = useAuth();
  const {
    data: scanStatusData,
    loaded: scanStatusLoaded,
    reportTriggerStarted,
    reportTriggerError,
  } = useScanStatus();

  // Decorative motion only — matches the journey's Scene 0.
  const [reduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  // Viewport size for the radar's stage scale. Scene 0's own `measure()` also
  // tracks scroll/scenes; here only vw/vh matter, so this is the whole of it.
  const [vp, setVp] = useState(() => ({
    vw: typeof window === "undefined" ? 1440 : window.innerWidth,
    vh: typeof window === "undefined" ? 900 : window.innerHeight,
  }));
  useEffect(() => {
    const onResize = () => setVp({ vw: window.innerWidth, vh: window.innerHeight });
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* ---------------------------------------------------------------- *
   * Tenant identity. Same source the journey's Scene 0 strip uses.
   * ---------------------------------------------------------------- */
  const [customerName, setCustomerName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchWithAuth("/api/portal/dashboard")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { customerName?: string | null } | null) => {
        if (!cancelled && body?.customerName) setCustomerName(body.customerName);
      })
      .catch(() => {
        /* strip degrades to "Your tenant"; useCopilotJourney beacons real failures */
      });
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  const live = useCopilotJourney({ tenantName: customerName, seatCount: null });
  const { view, scan } = live;

  /* ---------------------------------------------------------------- *
   * Auto-start a scan for a tenant that has genuinely never had one —
   * ported verbatim from copilot-readiness.tsx's #367 effect. Testbed
   * only ever POSTs the debug trigger; a real tenant reports why none can
   * start (autoTriggerError → the no-scan gate) instead of inventing a
   * second trigger pathway.
   * ---------------------------------------------------------------- */
  const autoTriggerRef = useRef(false);
  const [awaitingAutoScan, setAwaitingAutoScan] = useState(false);
  const [autoTriggerError, setAutoTriggerError] = useState<string | null>(null);

  // Testbed-only persisted pause on the auto-trigger, so Shane's edit-DB →
  // reload → inspect loop can hold the overlay/gate open without a run firing.
  const pauseAutoScanKey =
    user?.customerId != null ? `debug:pauseAutoScan:${user.customerId}` : null;
  const [pauseAutoScan, setPauseAutoScan] = useState(() => {
    if (typeof window === "undefined" || !pauseAutoScanKey) return false;
    return window.localStorage.getItem(pauseAutoScanKey) === "1";
  });
  const togglePauseAutoScan = useCallback(() => {
    if (!pauseAutoScanKey) return;
    setPauseAutoScan((prev) => {
      const next = !prev;
      if (next) window.localStorage.setItem(pauseAutoScanKey, "1");
      else window.localStorage.removeItem(pauseAutoScanKey);
      return next;
    });
  }, [pauseAutoScanKey]);

  useEffect(() => {
    if (autoTriggerRef.current) return;
    if (pauseAutoScan) return;
    const decision = decideAutoScan(scanStatusData);
    if (decision.kind === "skip") return;

    autoTriggerRef.current = true;

    if (decision.kind === "unavailable") {
      setAutoTriggerError(decision.message);
      return;
    }

    setAwaitingAutoScan(true);
    void (async () => {
      try {
        const res = await fetchWithAuth("/api/portal/assessment/debug-trigger-scan", {
          method: "POST",
        });
        if (!res.ok) {
          let message = `Trigger request failed (${res.status})`;
          try {
            const body = (await res.json()) as { error?: string };
            if (body?.error) message = body.error;
          } catch {
            // non-JSON error body — keep the status-code message
          }
          reportTriggerError(message);
          setAutoTriggerError(message);
          setAwaitingAutoScan(false);
          return;
        }
        let startedRunId: string | null = null;
        try {
          const body = (await res.json()) as { runId?: unknown };
          if (typeof body?.runId === "string" && body.runId) startedRunId = body.runId;
        } catch {
          // No/unreadable body — fall back to poll discovery, as before.
        }
        reportTriggerStarted(startedRunId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Network error triggering scan";
        reportTriggerError(message);
        setAutoTriggerError(message);
        setAwaitingAutoScan(false);
      }
    })();
  }, [pauseAutoScan, scanStatusData, reportTriggerStarted, reportTriggerError, fetchWithAuth]);

  // The no-scan gate's retry re-runs the gating decision rather than just
  // refetching, so a failed trigger isn't a permanent dead end.
  const retryAutoTrigger = useCallback(() => {
    autoTriggerRef.current = false;
    setAutoTriggerError(null);
  }, []);

  /* ---------------------------------------------------------------- *
   * Overlay lifecycle + the handoff to Overview.
   *
   * The journey latches `scanDismissed` once a run it watched finishes so a
   * second run can't re-open Scene 0 over a customer already reading the
   * narrative. Here that same latch is the trigger to hand off: the instant
   * the watched scan completes, dissolve the overlay and — after its fade —
   * reveal the Overview underneath (`onComplete`).
   * ---------------------------------------------------------------- */
  const [scanDismissed, setScanDismissed] = useState(false);
  const sawScanRunning = useRef(false);
  useEffect(() => {
    if (scan.running) {
      sawScanRunning.current = true;
      return;
    }
    if (sawScanRunning.current) setScanDismissed(true);
  }, [scan.running]);

  const overlayOpen = (scan.running || awaitingAutoScan) && !scanDismissed;

  // Force-100% is testbed-only and lets the completion → Overview handoff be
  // reviewed without waiting out a real scan. Purely a display-timing override:
  // the real progress props pass through untouched when off.
  const [forceProgressComplete, setForceProgressComplete] = useState(false);
  const overlayProgress = forceProgressComplete ? 1 : scan.progress;
  const overlayChecksDone = forceProgressComplete ? scan.checksTotal : scan.checksDone;

  // A genuinely never-scanned tenant with nothing running and nothing about to
  // trigger — the real-customer-whose-consent-scan-hasn't-landed case. Shows
  // the no-scan gate; there is no completion to hand off here, they wait/retry.
  const neverScannedBlocked = shouldBlockNeverScanned({
    loaded: scanStatusLoaded,
    isPreview: false,
    everScanned: scan.everScanned,
    running: scan.running,
    awaitingAutoScan,
  });

  // Hand off to the Overview once the watched scan has finished AND the overlay
  // has had its fade. Fired off the dismissal latch, delayed by the overlay's
  // own fade duration so the reveal reads as a dissolve into the dashboard, not
  // a jump cut. `onComplete` is stable enough to leave out of deps here — the
  // guard makes this fire exactly once.
  const handedOff = useRef(false);
  useEffect(() => {
    if (!scanDismissed || handedOff.current) return;
    handedOff.current = true;
    const timer = window.setTimeout(onComplete, OVERLAY_FADE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanDismissed]);

  const isTestbed = scanStatusData?.isTestbed === true;

  return (
    <div className="cj-dark">
      {isTestbed ? (
        <>
          <button
            type="button"
            onClick={() => setForceProgressComplete((p) => !p)}
            style={debugBtnStyle(12)}
          >
            {forceProgressComplete ? "[DEBUG] Show Live Progress" : "[DEBUG] Force 100%"}
          </button>
          <button type="button" onClick={togglePauseAutoScan} style={debugBtnStyle(44)}>
            {pauseAutoScan ? "[DEBUG] Resume Auto-Scan" : "[DEBUG] Pause Auto-Scan"}
          </button>
          <button type="button" onClick={onComplete} style={debugBtnStyle(76)}>
            [DEBUG] Skip to Overview
          </button>
        </>
      ) : null}

      <RevealNoScanGate
        open={neverScannedBlocked}
        message={autoTriggerError}
        onRetry={retryAutoTrigger}
      />

      <RevealScanOverlay
        open={overlayOpen}
        tenantLabel={tenantStrip(view.tenant)}
        pillars={view.pillars}
        progress={overlayProgress}
        checksDone={overlayChecksDone}
        checksTotal={scan.checksTotal}
        currentCheckLabel={scan.currentCheckLabel}
        vw={vp.vw}
        vh={vp.vh}
        reduced={reduced}
        isTestbed={isTestbed}
      />
    </div>
  );
}

/** The testbed debug button chrome, top-right, matching Scene 0's own. */
function debugBtnStyle(top: number): import("react").CSSProperties {
  return {
    position: "fixed",
    top,
    right: 12,
    zIndex: 9999,
    padding: "4px 10px",
    fontSize: 11,
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(0,0,0,0.6)",
    color: "rgba(255,255,255,0.7)",
    cursor: "pointer",
  };
}
