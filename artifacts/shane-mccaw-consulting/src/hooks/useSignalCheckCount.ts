import { useState, useEffect } from "react";

// Real live count of platform signal-derivation rules the free scan evaluates
// (GET /api/public/signal-check-count -- see api-server/src/routes/public-signal-checks.ts).
// Single source for every marketing "N checks" mention (Git #1351) so it can't drift out of
// sync with the real rule count the way 9 independently hardcoded "158" literals did.
const FALLBACK_COUNT = 158;

export function useSignalCheckCount(): number {
  const [count, setCount] = useState<number>(FALLBACK_COUNT);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/public/signal-check-count")
      .then((r) => {
        if (!r.ok) throw new Error("signal-check-count fetch failed");
        return r.json() as Promise<{ count: number }>;
      })
      .then((data) => {
        if (!cancelled && typeof data.count === "number") setCount(data.count);
      })
      .catch(() => {
        // Keep the fallback -- marketing copy still renders sensibly if the fetch fails.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return count;
}
