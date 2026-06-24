import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";

const CACHE_VERSION = "v1";
const KEY = (name: string) => `@offline_cache:${CACHE_VERSION}:${name}`;
const RESOURCES = [
  { key: "admin-kpis", queryKey: ["admin-kpis"] },
  { key: "admin-clients", queryKey: ["admin-clients"] },
  { key: "projects", queryKey: ["projects"] },
  { key: "leads", queryKey: ["leads"] },
  { key: "admin-conversations", queryKey: ["admin-conversations"] },
] as const;

/**
 * Hydrates TanStack Query cache from AsyncStorage on mount,
 * then persists it on every successful query fetch.
 */
export function useOfflineCache() {
  const qc = useQueryClient();

  // Hydrate on mount
  useEffect(() => {
    void (async () => {
      for (const res of RESOURCES) {
        try {
          const raw = await AsyncStorage.getItem(KEY(res.key));
          if (!raw) continue;
          const { data, ts } = JSON.parse(raw) as { data: unknown; ts: number };
          // Only hydrate if data is less than 24 hours old
          if (Date.now() - ts < 86_400_000) {
            qc.setQueryData(res.queryKey, data);
          }
        } catch {
          // Silent — stale cache is fine to ignore
        }
      }
    })();
  }, [qc]);

  const persist = useCallback(
    async (name: string, data: unknown) => {
      try {
        await AsyncStorage.setItem(KEY(name), JSON.stringify({ data, ts: Date.now() }));
      } catch {
        // Storage full or unavailable — best-effort
      }
    },
    [],
  );

  const clear = useCallback(async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter((k) => k.startsWith(`@offline_cache:${CACHE_VERSION}:`));
      if (cacheKeys.length > 0) {
        await AsyncStorage.multiRemove(cacheKeys);
      }
    } catch {
      // Ignore
    }
  }, []);

  return { persist, clear };
}
