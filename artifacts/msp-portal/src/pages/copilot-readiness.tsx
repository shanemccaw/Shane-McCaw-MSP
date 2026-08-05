/**
 * copilot-readiness.tsx — Screen 1 of the post-scan journey: the Copilot
 * Readiness Reveal.
 *
 * Ten scenes on one continuous vertical scroll, fixed order, no nav and no
 * skip-ahead. Scene 0 is a fixed overlay that owns the viewport for the length
 * of the real scan; Scenes 1–9 are sticky sections whose heights ARE their
 * timing (a 280vh section gives its five blocks 180vh of travel to reveal
 * through). There is no step index and no router state — the scroll position is
 * the state, which is why this route has no `:section` param the way /war-room
 * does.
 *
 * Route: /copilot-readiness. Renders full-bleed, outside AppShell, like
 * /war-room — the shell would be covered either way.
 *
 * HONESTY
 * -------
 * Everything on screen comes from `useCopilotJourney()` — the tenant's real
 * pillar scores, its real `msp_diagnostic_findings` rows, the real overall
 * readiness figure and the real document generation state (a per-tenant set,
 * never a fixed nine). Where the platform has nothing, the scene renders an
 * unavailable state or an em dash; it never falls back to the design's stand-in
 * tenant. The fixture is reachable only behind `?preview=design`, which paints
 * `<PreviewBadge />` for as long as it is on screen.
 *
 * "Nothing" has three shapes and the scenes distinguish all three — see
 * `PayloadState` below. A payload that has not arrived is not the same as one
 * that arrived empty, and neither is the same as one that failed; collapsing
 * them is how a screen ends up narrating a scan it never received.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";

import { useAuth } from "@/lib/auth-context";
import { useScanStatus } from "@/lib/scan-status-context";
import { useVersionInfo } from "@/hooks/useVersionInfo";

import { JourneySvgDefs, PreviewBadge } from "@/components/copilot-journey/JourneyPrimitives";
import { RevealAdoptionScene } from "@/components/copilot-journey/RevealAdoptionScene";
import { RevealFullPicture } from "@/components/copilot-journey/RevealFullPicture";
import {
  PILLAR_WIDE_MIN_PX,
  RevealPillarScene,
} from "@/components/copilot-journey/RevealPillarScene";
import { RevealProgressRail } from "@/components/copilot-journey/RevealProgressRail";
import { RevealReconsentGate } from "@/components/copilot-journey/RevealReconsentGate";
import { RevealScanOverlay } from "@/components/copilot-journey/RevealScanOverlay";
import { RevealVerdict } from "@/components/copilot-journey/RevealVerdict";
import { tenantStrip } from "@/components/copilot-journey/journeyModel.ts";
import {
  BRAND,
  INK,
  RADIUS,
  type PillarKey,
} from "@/components/copilot-journey/journeyTokens.ts";
import {
  PREVIEW_CHECK_NAMES,
  PREVIEW_PILLARS,
  PREVIEW_PROJECTED_BY_PILLAR,
  PREVIEW_SIGNAL_COUNT,
  previewJourneyView,
} from "@/components/copilot-journey/journeyPreviewFixture.ts";
import { decideAutoScan } from "@/components/copilot-journey/revealAutoScan.ts";
import { activeSceneIndex, sceneProgress } from "@/components/copilot-journey/revealMath.ts";
import {
  useCopilotJourney,
  type JourneyScanState,
} from "@/components/copilot-journey/useCopilotJourney.ts";
import "@/components/copilot-journey/copilot-journey.css";
import { useReconsentKind } from "@/components/reconsent-pill.tsx";

/** Nine `[data-cj-scene]` sections — Scenes 1 through 9. Scene 0 is the overlay. */
const SCENE_COUNT = 9;

/** How long the `?preview=design&scan=1` simulated scan takes. */
const PREVIEW_SCAN_MS = 22_000;

/** Where "Discuss my results with Shane McCaw" goes — the portal's own chat. */
const DISCUSS_HREF = "/support";

/** The Document Viewer's index. It opens on whatever the set leads with. */
const DOCUMENTS_HREF = "/copilot-readiness/documents";

interface SceneMetrics {
  readonly progress: readonly number[];
  readonly active: number;
  readonly vw: number;
  readonly vh: number;
}

/**
 * How much of a payload the screen actually has. The scenes render three
 * distinct states from it, not two: a scene that has NOT received a scan result
 * must say nothing about one, which is a different thing from a scan that came
 * back with nothing to quote.
 */
type PayloadState = "loading" | "error" | "ready";

/**
 * The retry offered on a failed fetch. Built once and handed to both scenes as a
 * node so the two do not grow two different buttons — `refresh()` re-runs both
 * payloads, so one control is honest wherever it appears.
 */
function RefreshAction({ onRefresh }: { onRefresh: () => void }) {
  return (
    <button
      type="button"
      onClick={onRefresh}
      style={{
        alignSelf: "flex-start",
        marginTop: 4,
        padding: "8px 16px",
        borderRadius: RADIUS.control,
        border: `1px solid ${BRAND.blue}`,
        background: "transparent",
        color: INK.headingDark,
        fontFamily: "inherit",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      Try again
    </button>
  );
}

/**
 * The one hand-written margin note in the whole experience, and the only place
 * it is allowed to come from.
 *
 * It is withheld on a live render, and that is not an oversight. The note names
 * a specific finding of the design's stand-in tenant ("Four Global Admins
 * without MFA"), so on a real tenant it would be an assertion nobody checked —
 * the exact failure the data contract exists to prevent. Restoring it live needs
 * a per-tenant "fix this first" annotation on the wire, not a copy edit here.
 */
function previewMarginNote(key: PillarKey): string | null {
  const entry = PREVIEW_PILLARS.find((p) => p.key === key);
  return entry && "marginNote" in entry ? entry.marginNote : null;
}

export default function CopilotReadinessPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { fetchWithAuth, logout } = useAuth();
  const versionInfo = useVersionInfo();

  const params = useMemo(() => new URLSearchParams(search), [search]);
  const isPreview = params.get("preview") === "design";
  // The design's own `skipScan` prop defaults to true, so a preview opens on the
  // verdict; `&scan=1` plays Scene 0 for review.
  const previewScanRunning = isPreview && params.get("scan") === "1";

  // Decorative motion only. The count-ups stay on either way — they are
  // informational, and freezing them would hide what the scenes exist to say.
  const [reduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  /* ---------------------------------------------------------------- *
   * Tenant identity. Same source the War Room uses (#327 made
   * `customerName` reachable for the Assessment role on this route).
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
        /* The strip degrades to "Your tenant" — not worth a beacon of its own,
           and `useCopilotJourney` already reports the payload failures. */
      });
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  const live = useCopilotJourney({
    tenantName: customerName,
    // No seat count reaches the portal today, so the strip prints the name
    // alone rather than a number nobody measured.
    seatCount: null,
    // Projected post-remediation scores come from the SOW's phase deltas. No SOW
    // is fetched on this screen, so live pillars show no fix preview at all.
    projectedByPillar: isPreview ? PREVIEW_PROJECTED_BY_PILLAR : undefined,
  });

  const view = isPreview ? previewJourneyView() : live.view;

  /* ---------------------------------------------------------------- *
   * Broken/stale consent (#370). Same detection `<ReconsentPill />` already
   * uses on /dashboard — never rebuilt here, just surfaced differently: a
   * full-screen gate instead of a nav nudge, because this page has no nav for
   * the pill to live in and nothing genuine to reveal underneath it. A design
   * preview is never a real tenant, so it can never be gated by this.
   * Checked ahead of #367's auto-trigger effect below — a tenant whose
   * consent is broken is a different real state than one that has never been
   * scanned, and there is no point auto-triggering a scan for the former.
   * ---------------------------------------------------------------- */
  const liveReconsentKind = useReconsentKind();
  const reconsentKind = isPreview ? null : liveReconsentKind;

  /* ---------------------------------------------------------------- *
   * Auto-start a scan for a tenant that has genuinely never had one, rather
   * than falling through to a verdict scene with nothing to show (#367).
   *
   * `debug-trigger-scan` is the platform's ONLY scan trigger and it is
   * hard-gated server-side to testbed tenants (see portal-assessment.ts) —
   * real customers never get a self-serve trigger, to stop AI-credit spam.
   * A real customer's scan already fired at consent time (consent.ts's
   * runDiagnostics), so reaching this state for one means that scan
   * genuinely hasn't landed yet, not that none exists to find. Inventing a
   * second, self-serve trigger pathway for real tenants here is exactly what
   * this fix must not do — so this mirrors war-room.tsx's own
   * `handleTriggerScan` guard rather than calling the endpoint blind.
   * ---------------------------------------------------------------- */
  const { data: scanStatusData, reportTriggerStarted, reportTriggerError } = useScanStatus();
  const autoTriggerRef = useRef(false);
  const [awaitingAutoScan, setAwaitingAutoScan] = useState(false);
  const [autoTriggerError, setAutoTriggerError] = useState<string | null>(null);

  useEffect(() => {
    if (isPreview) return;
    // A broken-consent tenant takes priority over the never-scanned case —
    // see the #370 block above. Don't hold `autoTriggerRef` open here: once
    // reconsent completes and `reconsentKind` clears, this effect should still
    // get its normal shot at deciding whether a scan needs triggering.
    if (reconsentKind !== null) return;
    if (autoTriggerRef.current) return;
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
  }, [isPreview, reconsentKind, scanStatusData, reportTriggerStarted, reportTriggerError, fetchWithAuth]);

  // Lets the retry button re-run the gating decision above instead of just
  // refetching pillars/status, which would leave a tenant with a failed
  // trigger permanently stuck.
  const retryAutoTrigger = useCallback(() => {
    autoTriggerRef.current = false;
    setAutoTriggerError(null);
  }, []);

  const scanUnavailable = autoTriggerError !== null;

  /* ---------------------------------------------------------------- *
   * Payload readiness.
   *
   * `live.error` is set when EITHER fetch fails, so neither state is derived
   * from it alone — a status failure must not blank out pillar findings that
   * did arrive. Each scene asks the narrower question: did anything land for
   * ME? `buildPillarViews()` always returns six entries whether or not a
   * payload arrived, so emptiness across all six is the only available signal
   * that nothing did.
   * ---------------------------------------------------------------- */
  const pillarsHaveData = useMemo(
    () =>
      view.pillars.some(
        (p) => p.score !== null || p.headline !== null || p.chips.length > 0,
      ),
    [view.pillars],
  );

  const pillarState: PayloadState = isPreview
    ? "ready"
    : scanUnavailable && !pillarsHaveData
      ? "error"
      : !live.pillarsLoaded
        ? "loading"
        : live.error && !pillarsHaveData
          ? "error"
          : "ready";

  // One state for both consumers of the status payload — Scene 1's headline
  // figure and Scene 9's document set — because they fail and arrive together.
  const statusHasData = view.readinessScore !== null || view.generation.total > 0;
  const statusState: PayloadState = isPreview
    ? "ready"
    : scanUnavailable && !statusHasData
      ? "error"
      : !live.statusLoaded
        ? "loading"
        : live.error && !statusHasData
          ? "error"
          : "ready";

  const { refresh } = live;
  const retryAction = useMemo(
    () => <RefreshAction onRefresh={scanUnavailable ? retryAutoTrigger : refresh} />,
    [scanUnavailable, retryAutoTrigger, refresh],
  );

  /* ---------------------------------------------------------------- *
   * Scene 0 — the scan.
   * ---------------------------------------------------------------- */

  // The preview's simulated run, so Scene 0's composition can be reviewed on a
  // tenant that is not mid-scan. Never reachable without `?preview=design`.
  const [previewT, setPreviewT] = useState(0);
  useEffect(() => {
    if (!previewScanRunning) return undefined;
    const began = performance.now();
    const timer = setInterval(() => {
      const t = Math.min(1, (performance.now() - began) / PREVIEW_SCAN_MS);
      setPreviewT(t);
      if (t >= 1) clearInterval(timer);
    }, 70);
    return () => clearInterval(timer);
  }, [previewScanRunning]);

  const scan: JourneyScanState = useMemo(() => {
    if (!isPreview) return live.scan;
    const done = Math.round(PREVIEW_SIGNAL_COUNT * previewT);
    return {
      running: previewScanRunning && previewT < 1,
      everScanned: true,
      progress: previewT,
      checksDone: done,
      checksTotal: PREVIEW_SIGNAL_COUNT,
      currentCheckLabel:
        previewT >= 1
          ? null
          : PREVIEW_CHECK_NAMES[
              Math.min(PREVIEW_CHECK_NAMES.length - 1, Math.floor(previewT * PREVIEW_CHECK_NAMES.length))
            ],
      runId: null,
    };
  }, [isPreview, live.scan, previewScanRunning, previewT]);

  // Latched so a second run cannot re-open the overlay over a customer who is
  // already halfway down the narrative. A tenant with results and nothing
  // running (`everScanned && !running`) never sees Scene 0 at all. A tenant
  // who has genuinely never been scanned DOES see it (#367): the auto-trigger
  // effect above either starts a real run (testbed) or reports why none can
  // start (a real tenant, see `autoTriggerError`) — `awaitingAutoScan` holds
  // the overlay open for the stretch between the trigger POST returning and
  // the poll observing the new run as `active`, so the verdict scene never
  // flashes in behind it for that gap.
  const [scanDismissed, setScanDismissed] = useState(false);
  const sawScanRunning = useRef(false);
  useEffect(() => {
    if (scan.running) {
      sawScanRunning.current = true;
      return undefined;
    }
    if (sawScanRunning.current) setScanDismissed(true);
    return undefined;
  }, [scan.running]);

  // Testbed-only replay of the already-dismissed Scene 0 overlay (#367 debug
  // tooling). Does not touch `scan`/`awaitingAutoScan` and never re-POSTs
  // debug-trigger-scan — it only forces the overlay's visibility back open so
  // Shane can review it again, toggled off the same way it was toggled on.
  const [replayScene0, setReplayScene0] = useState(false);
  const toggleReplayScene0 = useCallback(() => {
    setReplayScene0((prev) => {
      const next = !prev;
      setScanDismissed(!next);
      return next;
    });
  }, []);

  const overlayOpen = (scan.running || awaitingAutoScan || replayScene0) && !scanDismissed;

  // Scene 1 plays on arrival rather than on scroll, so it starts the moment the
  // overlay releases — but not before the status payload has landed, or the
  // count-up would run to a score that is not known yet.
  const verdictStart = !overlayOpen && (isPreview || live.statusLoaded);

  /* ---------------------------------------------------------------- *
   * Scroll measurement. One rAF-coalesced handler for all nine scenes.
   * ---------------------------------------------------------------- */
  const [metrics, setMetrics] = useState<SceneMetrics>(() => ({
    progress: [],
    active: 0,
    vw: typeof window === "undefined" ? 1440 : window.innerWidth,
    vh: typeof window === "undefined" ? 900 : window.innerHeight,
  }));

  const measure = useCallback(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-cj-scene]"));
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rects = nodes.map((node) => {
      const r = node.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    });
    const progress = rects.map((r) => sceneProgress(r, vh));
    const active = activeSceneIndex(rects, vh);

    setMetrics((prev) => {
      const unchanged =
        prev.vw === vw &&
        prev.vh === vh &&
        prev.active === active &&
        prev.progress.length === progress.length &&
        progress.every((p, i) => Math.abs(p - prev.progress[i]) < 0.0015);
      return unchanged ? prev : { progress, active, vw, vh };
    });
  }, []);

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    // A narrative that resumes two thirds of the way down after a refresh is
    // incoherent, so the page always opens at the top.
    const previousBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, 0);

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    // A backgrounded tab drops scroll events; this re-syncs on return.
    document.addEventListener("visibilitychange", schedule);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", schedule);
      document.documentElement.style.scrollBehavior = previousBehavior;
    };
  }, [measure]);

  // Re-measure once the overlay releases: the page has been unscrollable until
  // now and no scroll event will fire until the customer moves.
  useEffect(() => {
    if (overlayOpen) return undefined;
    measure();
    return undefined;
  }, [overlayOpen, measure]);

  const sceneProgressAt = useCallback(
    (index: number) => metrics.progress[index] ?? 0,
    [metrics.progress],
  );

  const pillarWide = metrics.vw >= PILLAR_WIDE_MIN_PX;

  // #370: a tenant whose Graph/SharePoint access is broken has nothing real
  // for the scroll experience to reveal, so it is replaced outright rather
  // than rendered underneath a small nav-style nudge this no-nav page has
  // nowhere to put. All hooks above still run every render regardless — this
  // only decides what to paint.
  if (reconsentKind !== null) {
    return <RevealReconsentGate kind={reconsentKind} />;
  }

  return (
    <div
      className="cj-dark"
      // A normal document-flow root: this page scrolls the window. Pinning it
      // with `position:fixed; inset:0` would make the sticky scenes measure
      // against a scroll container the rail and `getBoundingClientRect()` do not
      // agree about.
      style={{ position: "relative", background: BRAND.canvas, minHeight: "100vh" }}
    >
      <JourneySvgDefs />
      {isPreview ? <PreviewBadge /> : null}

      <RevealProgressRail active={metrics.active} count={SCENE_COUNT} />

      <button
        type="button"
        onClick={() => void logout()}
        style={{
          position: "fixed",
          top: 12,
          left: 12,
          zIndex: 9999,
          padding: "4px 10px",
          fontSize: 11,
          borderRadius: 6,
          border: "1px solid rgba(255,255,255,0.15)",
          background: "rgba(0,0,0,0.4)",
          color: "rgba(255,255,255,0.55)",
          cursor: "pointer",
        }}
      >
        Sign out
      </button>

      {!isPreview && scanStatusData?.isTestbed ? (
        <button
          onClick={toggleReplayScene0}
          style={{
            position: "fixed",
            top: 12,
            right: 12,
            zIndex: 9999,
            padding: "4px 10px",
            fontSize: 11,
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(0,0,0,0.6)",
            color: "rgba(255,255,255,0.7)",
            cursor: "pointer",
          }}
        >
          {replayScene0 ? "[DEBUG] Close Scene 0 replay" : "[DEBUG] Replay Scene 0"}
        </button>
      ) : null}

      <RevealScanOverlay
        open={overlayOpen}
        tenantLabel={tenantStrip(view.tenant)}
        pillars={view.pillars}
        progress={scan.progress}
        checksDone={scan.checksDone}
        checksTotal={scan.checksTotal}
        currentCheckLabel={scan.currentCheckLabel}
        vw={metrics.vw}
        vh={metrics.vh}
        reduced={reduced}
        isTestbed={!isPreview && scanStatusData?.isTestbed}
      />

      <RevealVerdict
        start={verdictStart}
        tenantName={view.tenant.name}
        score={view.readinessScore}
        pillars={view.pillars}
        vw={metrics.vw}
        vh={metrics.vh}
        reduced={reduced}
        payloadState={statusState}
        retryAction={retryAction}
      />

      {/* Scenes 2–7. One component six times — sameness is the feature. */}
      {view.pillars.map((pillar, i) => (
        <RevealPillarScene
          key={pillar.key}
          sceneIndex={i + 2}
          pillar={pillar}
          projected={isPreview ? PREVIEW_PROJECTED_BY_PILLAR[pillar.key] ?? null : null}
          // Exactly one margin note in the whole experience, on Security alone.
          marginNote={isPreview && pillar.key === "security" ? previewMarginNote(pillar.key) : null}
          progress={sceneProgressAt(i + 1)}
          wide={pillarWide}
          reduced={reduced}
          showTenantBoundCopy={isPreview}
          payloadState={pillarState}
          retryAction={retryAction}
        />
      ))}

      <RevealAdoptionScene progress={sceneProgressAt(7)} reduced={reduced} />

      <RevealFullPicture
        view={view}
        progress={sceneProgressAt(8)}
        vw={metrics.vw}
        vh={metrics.vh}
        reduced={reduced}
        discussHref={DISCUSS_HREF}
        onOpenDocuments={() => navigate(DOCUMENTS_HREF)}
        payloadState={statusState}
        retryAction={retryAction}
      />

      <div style={{ textAlign: "center", padding: "0 0 32px" }}>
        <span style={{ fontSize: 10.5, fontWeight: 500, color: INK.deemphasised }}>
          v{versionInfo.display}
        </span>
      </div>
    </div>
  );
}
