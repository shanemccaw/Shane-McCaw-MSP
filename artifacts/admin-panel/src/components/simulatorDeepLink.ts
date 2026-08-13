// artifacts/admin-panel/src/components/simulatorDeepLink.ts
//
// #379 — the ONE definition of Simulator Studio's deep-link URL shape.
//
// Two surfaces have to agree on it: whoever builds the link (Active Directory's
// expanded run findings) and whoever reads it (SimulatorStudioPage). Keeping the
// path and the param name in one module is what stops those two from drifting
// into a link that points at nothing.
//
// ROUTE, confirmed in admin-panel's OWN router — not msp-portal's: App.tsx
// registers `<Route path="/system/:section">`, SystemWorkspace dispatches
// `case "simulator"` to SimulatorStudioPage, and workspaceNav lists it at
// `/system/simulator` (it is also the System workspace's defaultPath).
//
// BASE PATH: the wouter Router is mounted with
// `base={import.meta.env.BASE_URL}`, and wouter's <Link>/navigate apply that
// base themselves. So this returns a base-RELATIVE path and callers must not
// hand-prefix it.

export const SIMULATOR_STUDIO_PATH = "/system/simulator";

/** Query param SimulatorStudioPage reads on load to auto-select a check. */
export const SIMULATOR_CHECK_PARAM = "checkKey";

/**
 * Deep link to one monitor check, already loaded in Simulator Studio's endpoint
 * canvas. Check keys are colon-namespaced ("identity:pim-eligible-roles"), so
 * the value is encoded; URLSearchParams decodes it on the other side.
 */
export function simulatorStudioCheckPath(checkKey: string): string {
  return `${SIMULATOR_STUDIO_PATH}?${SIMULATOR_CHECK_PARAM}=${encodeURIComponent(checkKey)}`;
}
