// artifacts/admin-panel/src/hooks/useAiCostSegments.ts
//
// Backs the StatusBar's "Today: $X.XX" / "Month: $X.XX" segments (initiative:
// ai-cost-governance-billing-rollup, Phase 3 / Issue #51).
//
// Owned by GlobalIDEShell and threaded into StatusBar as props — StatusBar
// itself stays a pure presentational component, the same way liveVisitors and
// campaignBadges are already threaded rather than self-fetched.
//
// ── Why seed + delta, and not just SSE ───────────────────────────────────────
// The hub's broadcastToHubWithReplay caches only the LAST event per channel,
// which for "ai-cost" is a single per-call DELTA — not a running total. So the
// totals are seeded once from GET /admin/ai-billing/summary and each SSE frame
// is added on top. A frame is never treated as an absolute value.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLiveStream } from "@/hooks/useLiveStream";

/** How long the transient "▲ $x.xx" delta chip stays up before fading out. */
const DELTA_HOLD_MS = 2000;
/** Must match .sale-flash-exit's animation duration in index.css. */
const DELTA_FADE_MS = 300;

export interface AiCostTransaction {
  eventId: string | null;
  occurredAt: string | null;
  costCents: number;
  mspName: string | null;
  customerName: string | null;
  generatedArtifactName: string | null;
  generatedArtifactType: string | null;
  feature: string | null;
  nodeType: string | null;
}

export interface AiCostSegments {
  todayCents: number | null;
  monthCents: number | null;
  /** Accumulated cost of the deltas currently being flashed, in cents. */
  deltaCents: number;
  /** True while the delta chip is on screen (including its fade-out). */
  deltaVisible: boolean;
  /** True during the fade-out tail, so the chip can take the exit animation. */
  deltaExiting: boolean;
  recent: AiCostTransaction[];
  recentLoading: boolean;
  /** Fetch the last-10 list — called on segment hover, not on mount. */
  loadRecent: () => void;
}

/** Read a number off an untrusted SSE frame payload. */
function frameNumber(data: Record<string, unknown>, key: string): number {
  const v = data[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function frameString(data: Record<string, unknown>, key: string): string | null {
  const v = data[key];
  return typeof v === "string" ? v : null;
}

export function useAiCostSegments(): AiCostSegments {
  const { fetchWithAuth, accessToken } = useAuth();
  const [todayCents, setTodayCents] = useState<number | null>(null);
  const [monthCents, setMonthCents] = useState<number | null>(null);

  const [deltaCents, setDeltaCents] = useState(0);
  const [deltaVisible, setDeltaVisible] = useState(false);
  const [deltaExiting, setDeltaExiting] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [recent, setRecent] = useState<AiCostTransaction[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);

  // ── Seed the totals on mount ───────────────────────────────────────────────
  // The viewer's own UTC offset goes with the request so "Today" rolls over at
  // the admin's midnight rather than UTC's (see resolveRangeBounds server-side).
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    const tz = new Date().getTimezoneOffset();

    const seed = async (range: "today" | "month", apply: (cents: number) => void) => {
      try {
        const res = await fetchWithAuth(
          `/api/admin/ai-billing/summary?range=${range}&tzOffsetMinutes=${tz}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { totalCostCents?: number };
        if (cancelled) return;
        if (typeof data.totalCostCents === "number") apply(data.totalCostCents);
      } catch {
        // Leave the segment null — StatusBar renders nothing rather than a
        // fabricated $0.00 for a total it could not actually read.
      }
    };

    void seed("today", setTodayCents);
    void seed("month", setMonthCents);
    return () => { cancelled = true; };
  }, [accessToken, fetchWithAuth]);

  // ── Apply SSE deltas on top ────────────────────────────────────────────────
  const { frames } = useLiveStream(accessToken ? "ai-cost" : null);
  // useLiveStream buffers frames newest-first and prepends. Track the newest
  // frame already applied so a re-render never re-adds a cost that was already
  // counted; on reconnect the buffer resets and the marker simply won't be
  // found, so only the genuinely new frames get applied.
  const lastAppliedIdRef = useRef<string | null>(null);
  // Lets the frames effect read the current chip visibility WITHOUT depending
  // on it — a dependency there would re-run the effect on every chip state
  // change and re-apply the same frames.
  const deltaVisibleRef = useRef(false);
  deltaVisibleRef.current = deltaVisible;

  useEffect(() => {
    if (frames.length === 0) return;
    const seenIdx = frames.findIndex((f) => f.id === lastAppliedIdRef.current);
    const fresh = seenIdx === -1 ? frames : frames.slice(0, seenIdx);
    lastAppliedIdRef.current = frames[0]!.id;
    if (fresh.length === 0) return;

    const added = fresh.reduce((acc, f) => acc + frameNumber(f.data, "costCents"), 0);
    if (added === 0) return;

    // A call that just happened is inside both windows, so both segments move.
    setTodayCents((v) => (v === null ? v : v + added));
    setMonthCents((v) => (v === null ? v : v + added));

    // Rapid successive calls accumulate into the ONE chip and restart its
    // timers rather than stacking a second chip or leaking a timer.
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    setDeltaCents((v) => (deltaVisibleRef.current ? v + added : added));
    setDeltaExiting(false);
    setDeltaVisible(true);
    holdTimerRef.current = setTimeout(() => {
      setDeltaExiting(true);
      fadeTimerRef.current = setTimeout(() => {
        setDeltaVisible(false);
        setDeltaExiting(false);
        setDeltaCents(0);
      }, DELTA_FADE_MS);
    }, DELTA_HOLD_MS);
  }, [frames]);

  useEffect(() => () => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
  }, []);

  // ── Hover popover data ─────────────────────────────────────────────────────
  const loadRecent = useCallback(() => {
    if (!accessToken) return;
    setRecentLoading(true);
    fetchWithAuth("/api/admin/ai-billing/recent?limit=10")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("recent fetch failed"))))
      .then((data: { events?: Record<string, unknown>[] }) => {
        setRecent(
          (data.events ?? []).map((e) => ({
            eventId: frameString(e, "eventId"),
            occurredAt: frameString(e, "occurredAt"),
            costCents: frameNumber(e, "costCents"),
            mspName: frameString(e, "mspName"),
            customerName: frameString(e, "customerName"),
            generatedArtifactName: frameString(e, "generatedArtifactName"),
            generatedArtifactType: frameString(e, "generatedArtifactType"),
            feature: frameString(e, "feature"),
            nodeType: frameString(e, "nodeType"),
          })),
        );
      })
      .catch(() => { /* popover shows its empty state rather than stale data */ })
      .finally(() => setRecentLoading(false));
  }, [accessToken, fetchWithAuth]);

  return {
    todayCents,
    monthCents,
    deltaCents,
    deltaVisible,
    deltaExiting,
    recent,
    recentLoading,
    loadRecent,
  };
}
