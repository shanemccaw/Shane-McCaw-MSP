import { useMemo } from "react";
import { useServices } from "./useServices";
import { PACKS } from "../marketing/data/quickStartPacks";

/**
 * Cross-references the static Quick-Start Pack fixture (quickStartPacks.ts) against
 * the real public `services` catalogue by exact name match -- the same identity
 * quickStartPacks.ts's own header comment already used to validate pack pricing --
 * rather than a manually maintained "these packs aren't real yet" list, which had
 * already drifted from reality once (Git #1304: the issue that raised this assumed
 * only 3 of 15 packs lacked a real row; a live query found 5 actually did).
 */
export function useQuickStartPackAvailability(): { availableKeys: Set<string>; loading: boolean } {
  const { services, loading } = useServices();

  const availableKeys = useMemo(() => {
    const realNames = new Set(services.map((s) => s.name));
    return new Set(PACKS.filter((p) => realNames.has(p.name)).map((p) => p.key));
  }, [services]);

  return { availableKeys, loading };
}
