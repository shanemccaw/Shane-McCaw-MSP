import { useState, useEffect } from "react";

let cache: Record<string, string[]> | null = null;
let inflight: Promise<Record<string, string[]>> | null = null;

async function fetchMapping(): Promise<Record<string, string[]>> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = fetch("/api/public/service-page-triggers")
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, string[]>>) : Promise.resolve({})))
    .catch(() => ({}))
    .then((data) => {
      cache = data;
      inflight = null;
      return data;
    });
  return inflight;
}

export function useServicePageTriggerKeys(pageSlug: string): { triggerKeys: string[]; loading: boolean } {
  const [triggerKeys, setTriggerKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchMapping().then((mapping) => {
      if (!cancelled) {
        setTriggerKeys(mapping[pageSlug] ?? []);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [pageSlug]);

  return { triggerKeys, loading };
}
