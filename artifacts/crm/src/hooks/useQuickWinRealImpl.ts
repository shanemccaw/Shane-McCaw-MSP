import { useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { AsyncRunAutoStep, AsyncEscalateToProject, QuickWinItem } from "@/context/QuickWinModeContext";

// Maps Quick Win category labels to M365 score keys.
// Exported so FullScreenWrapper can use the same canonical mapping
// when updating category bars — prevents key drift between the two files.
export const CATEGORY_TO_SCORE_KEY: Record<string, string> = {
  Security: "security",
  "Copilot AI": "copilot",
  Governance: "governance",
  Compliance: "compliance",
  Adoption: "productivity",
};

interface Scorecard {
  hasProfile: boolean;
  scores: Record<string, number>;
  telemetry: Record<string, string[]>;
  subsystemsChecked: string[];
}

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// Fallback telemetry shown when no M365 profile is on file
const FALLBACK_TELEMETRY = [
  "Connecting to Microsoft 365 scoring API…",
  "No M365 profile found for this tenant.",
  "Complete your M365 profile to enable live scoring.",
  "Diagnostic complete (no profile data).",
];

/**
 * Returns real `runAutoStep` and `escalateToProject` implementations backed
 * by the `/api/portal/quick-win/scorecard` and `/api/portal/quick-win/escalate`
 * API endpoints.
 *
 * - `runAutoStep` fetches the client's actual M365 scores and plays through
 *   domain-specific telemetry lines that describe exactly what was checked.
 * - `escalateToProject` creates a real engagement project and returns its ID.
 */
export function useQuickWinRealImpl() {
  const { fetchWithAuth } = useAuth();

  // Cache the scorecard for the lifetime of the QuickWin session so multiple
  // auto-steps in the same Quick Win don't re-fetch the same data.
  const scorecardCache = useRef<Scorecard | null>(null);

  const runAutoStep: AsyncRunAutoStep = useCallback(
    async (qw: QuickWinItem, _stepIndex: number, onProgress, onScoreUpdate, onTelemetry) => {
      const scoreKey = CATEGORY_TO_SCORE_KEY[qw.category ?? ""] ?? "security";

      onTelemetry("Connecting to Microsoft 365 scoring API…");
      onProgress(8);
      await delay(350);

      // Fetch scorecard (once per session)
      if (!scorecardCache.current) {
        try {
          const res = await fetchWithAuth("/api/portal/quick-win/scorecard");
          if (res.ok) {
            scorecardCache.current = (await res.json()) as Scorecard;
          }
        } catch {
          // Non-fatal — will fall back to generic messages
        }
      }

      const scorecard = scorecardCache.current;
      const score = scorecard?.scores?.[scoreKey] ?? 0;
      const lines: string[] = scorecard?.hasProfile
        ? (scorecard.telemetry?.[scoreKey] ?? FALLBACK_TELEMETRY)
        : FALLBACK_TELEMETRY;

      // Play through telemetry lines with realistic pacing
      for (let i = 0; i < lines.length; i++) {
        onTelemetry(lines[i]);
        await delay(280 + Math.random() * 160);
        // Progress from 8% up to 92% across the telemetry lines
        onProgress(Math.round(8 + ((i + 1) / lines.length) * 84));
      }

      onScoreUpdate(score);
      onProgress(100);
      onTelemetry(`Score recorded: ${score}/100`);
      await delay(300);
    },
    [fetchWithAuth],
  );

  const escalateToProject: AsyncEscalateToProject = useCallback(
    async (qw: QuickWinItem) => {
      try {
        const res = await fetchWithAuth("/api/portal/quick-win/escalate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quickWinId: qw.id,
            quickWinTitle: qw.title,
            category: qw.category,
          }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { projectId: number };
        return String(data.projectId);
      } catch {
        return null;
      }
    },
    [fetchWithAuth],
  );

  return { runAutoStep, escalateToProject };
}
