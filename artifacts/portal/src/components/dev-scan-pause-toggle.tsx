/**
 * DevScanPauseToggle (Git #4449)
 *
 * A small floating dev-only toggle for pausing/resuming SCHEDULED monitoring
 * scans against the real `/api/dev/scans/*` routes (registered only when
 * NODE_ENV !== "production" — see artifacts/api-server/src/routes/index.ts).
 * Gated on `import.meta.env.DEV` so it is structurally unreachable in a
 * production Portal build — never customer-facing under any condition.
 *
 * The pause only ever short-circuits a scheduled (Workflow Engine cron) run;
 * a manual "Scan Now" always executes regardless of this toggle's state.
 */

import { useEffect, useState } from "react";
import { Pause, Play, RadioTower } from "lucide-react";

export default function DevScanPauseToggle() {
  if (!import.meta.env.DEV) return null;

  const [paused, setPaused] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/dev/scans/pause-state");
        if (res.ok) {
          const data = (await res.json()) as { paused: boolean };
          setPaused(data.paused);
        }
      } catch {
        // non-fatal — toggle just won't populate an initial state
      }
    })();
  }, []);

  const toggle = async () => {
    if (paused === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/dev/scans/${paused ? "resume" : "pause"}`, { method: "POST" });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { paused: boolean };
      setPaused(data.paused);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  if (paused === null) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999]">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        title="Dev only — pauses SCHEDULED scans; manual scans still run"
        className={`flex items-center gap-2 px-3 py-2 rounded-full shadow-lg border text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          paused
            ? "bg-amber-500/90 border-amber-600 text-amber-950 hover:bg-amber-500"
            : "bg-purple-600/90 border-purple-700 text-white hover:bg-purple-600"
        }`}
      >
        {paused ? <Pause className="w-3.5 h-3.5" /> : <RadioTower className="w-3.5 h-3.5" />}
        {paused ? "Scheduled scans paused" : "Scheduled scans running"}
        {paused ? <Play className="w-3.5 h-3.5" /> : null}
      </button>
      {error && (
        <p className="mt-1 text-[10px] text-red-500 bg-white/90 dark:bg-black/70 rounded px-2 py-1">{error}</p>
      )}
    </div>
  );
}
