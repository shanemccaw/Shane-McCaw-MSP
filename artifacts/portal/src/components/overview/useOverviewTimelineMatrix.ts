import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import type { TimelineMatrixResponseWire } from "./types";

const MATRIX_URL = "/api/portal/customer/timeline/matrix";

export interface TimelineWindow {
  readonly key: string;
  readonly label: string;
  readonly back: number;
  readonly fwd: number;
  /** Days between axis tick marks — display-only, never sent to the API. */
  readonly step: number;
}

/** Matches the design's own three window presets (Overview.dc.html `WINDOWS`). */
export const TIMELINE_WINDOWS: readonly TimelineWindow[] = [
  { key: "2w", label: "2 WKS", back: 7, fwd: 7, step: 2 },
  { key: "5w", label: "5 WKS", back: 14, fwd: 21, step: 7 },
  { key: "q", label: "QUARTER", back: 30, fwd: 60, step: 14 },
];

export interface OverviewTimelineMatrixState {
  readonly data: TimelineMatrixResponseWire | null;
  readonly loading: boolean;
  readonly loaded: boolean;
  readonly error: boolean;
}

/**
 * The real `GET /api/portal/customer/timeline/matrix` read backing the
 * Overview Matrix/List timeline card (#4129) — separate from
 * `useOverviewTimeline`'s cursor-paginated "Happened" feed, since this one
 * needs a forward-looking window too.
 */
export function useOverviewTimelineMatrix(win: TimelineWindow): OverviewTimelineMatrixState {
  const { fetchWithAuth, user } = useAuth();
  const [data, setData] = useState<TimelineMatrixResponseWire | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);

    void fetchWithAuth(`${MATRIX_URL}?back=${win.back}&fwd=${win.fwd}`, undefined, { silent: true })
      .then(async (res) => {
        if (!res.ok) throw new Error(`timeline matrix ${res.status}`);
        return (await res.json()) as TimelineMatrixResponseWire;
      })
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [user, fetchWithAuth, win.back, win.fwd]);

  return { data, loading, loaded, error };
}
