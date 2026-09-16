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

  useMemo(() => {
    if (import.meta.env.DEV && !loading && availableKeys.size === PACKS.length) {
      // Git #4405: every pack now has a real services row, so any test/UI logic still
      // relying on "at least one pack is not-yet-available" (e.g. buy-page.json's PACK6
      // group) has nothing left to gate against and needs to be rewritten, not repointed.
      console.warn(
        "[useQuickStartPackAvailability] All Quick-Start Packs now have a real services row " +
          "-- availableKeys covers the full PACKS list. Anything still assuming a not-yet-" +
          "available pack exists (e.g. test-manifests/marketing/buy-page.json's PACK6 group) " +
          "must be updated; there is no pack left to repoint at (see Git #4405).",
      );
    }
  }, [availableKeys, loading]);

  return { availableKeys, loading };
}
