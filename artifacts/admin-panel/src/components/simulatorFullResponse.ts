// artifacts/admin-panel/src/components/simulatorFullResponse.ts
//
// Pure logic for Simulator Studio's "Full Response" run mode (Simulator Studio
// Part A). Split out from SimulatorEndpointCanvas.tsx (a .tsx importing React)
// so it can be unit-tested directly, matching the flowTree.ts / ancestorOutputs.ts
// convention already used elsewhere in this app.
//
// A monitor check's field scoping can live in TWO places: the dedicated
// `select_params` column (joined onto the endpoint as a separate query string
// in SimulatorEndpointCanvas's `effectiveEndpoint`) OR `$select=...` embedded
// directly in `endpoint` itself (real seeded checks do both — see
// lib/db/migrations/manual/2026-07-22-irm-alerts-monitor-check.sql, which bakes
// `$select=` into the endpoint string alongside `$filter=`). Full Response mode
// has to strip `$select` wherever it appears, or it would silently do nothing
// for the checks authored the second way.
//
// Deliberately narrow: only `$select=...` segments are removed. `$filter`,
// `$expand`, `$top` and any other query parameter are left untouched, because
// those shape WHICH items come back (or how many), not which fields on each
// item — stripping them would change the result set, not just widen it.

export function stripSelectParam(url: string): string {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return url;
  const base = url.slice(0, queryStart);
  const query = url.slice(queryStart + 1);
  const kept = query.split("&").filter((part) => !/^\$select=/i.test(part));
  if (kept.length === 0) return base;
  return `${base}?${kept.join("&")}`;
}
