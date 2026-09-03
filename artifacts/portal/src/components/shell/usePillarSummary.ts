import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { PILLAR_KEYS, severityForScore, type PillarKey, type Severity } from "@workspace/copilot-scan-scene/journeyTokens";

/**
 * Minimal client-side mirror of the real `GET /api/portal/pillars` wire shape
 * (`PillarSummaryPayload` / `PillarSummaryCard`, artifacts/api-server/src/lib/
 * pillar-summary-stats.ts) — only the fields the shell needs. Apps in this
 * monorepo don't share types across the artifacts/* boundary (see CLAUDE.md,
 * "Workspace / monorepo"), so this is typed independently rather than
 * imported from the server package.
 */
interface PillarSummaryCardWire {
  pillar: PillarKey | "copilot";
  score: number | null;
  evaluation: { status: "scored" | "insufficient_data" | "not_evaluated" };
}

interface PillarSummaryPayloadWire {
  pillars: PillarSummaryCardWire[];
}

export interface PillarShellScore {
  readonly score: number | null;
  readonly scored: boolean;
}

export interface PillarSummaryShellState {
  /** One entry per design's six shell pillars, in `PILLAR_KEYS` order. */
  readonly scores: Readonly<Record<PillarKey, PillarShellScore>>;
  /**
   * The frame-level severity band, derived from the real average of every
   * currently-scored shell pillar. `"none"` when nothing is scored yet
   * (never scanned, or a scan that hasn't produced enough signal) — the
   * severity wash renders its own "none" state rather than guessing.
   */
  readonly overallSeverity: Severity | "none";
  readonly loading: boolean;
  /** True once a request has resolved (success or failure) at least once. */
  readonly loaded: boolean;
}

const EMPTY_SCORES: Readonly<Record<PillarKey, PillarShellScore>> = Object.fromEntries(
  PILLAR_KEYS.map((key) => [key, { score: null, scored: false }]),
) as Record<PillarKey, PillarShellScore>;

/**
 * The shell's own read of `/api/portal/pillars` — the real per-pillar scores
 * for the pillar tab strip, and the real overall severity band for the
 * frame-level wash (README: "The severity wash from the design export lives
 * here, at the frame level"). Both come from the same fetch so the tab
 * scores and the wash can never disagree about what was actually observed.
 */
export function usePillarSummaryShell(): PillarSummaryShellState {
  const { fetchWithAuth, user } = useAuth();
  const [scores, setScores] = useState<Readonly<Record<PillarKey, PillarShellScore>>>(EMPTY_SCORES);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);

    void fetchWithAuth("/api/portal/pillars", undefined, { silent: true })
      .then((res) => (res.ok ? (res.json() as Promise<PillarSummaryPayloadWire>) : null))
      .then((data) => {
        if (cancelled || !data) return;
        const next: Record<PillarKey, PillarShellScore> = { ...EMPTY_SCORES };
        for (const card of data.pillars) {
          if (card.pillar === "copilot") continue; // Copilot is the roll-up, not a shell tab.
          const key = card.pillar as PillarKey;
          if (!PILLAR_KEYS.includes(key)) continue;
          next[key] = {
            score: card.evaluation.status === "scored" ? card.score : null,
            scored: card.evaluation.status === "scored",
          };
        }
        setScores(next);
      })
      .catch(() => {
        // Leave EMPTY_SCORES — an unreachable pillar summary renders the
        // honest "never scanned" shape rather than a fabricated score.
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user, fetchWithAuth]);

  const scoredValues = PILLAR_KEYS.map((k) => scores[k]).filter((s) => s.scored && s.score !== null);
  const overallSeverity: Severity | "none" =
    scoredValues.length === 0
      ? "none"
      : severityForScore(scoredValues.reduce((sum, s) => sum + (s.score as number), 0) / scoredValues.length);

  return { scores, overallSeverity, loading, loaded };
}
