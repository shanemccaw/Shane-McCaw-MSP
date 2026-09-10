// Shane's Life -- dev floaty panel override store (Git #3146, README "Prototype tweaks" /
// First Slice Prototype's own `today`/`weather`/`sky`/`nextDemo` props). This is the real,
// shared state the floaty panel (dev-panel.js) writes and theme.js/weather.js/app.js read, so
// every override takes effect live -- no reload, no waiting on a real Open-Meteo call or the
// real device clock to match what's being tested (the issue's own Verification section).
//
// Persisted in localStorage (not memory-only) so an override survives an accidental reload mid-
// test session -- the issue's own "Real reset control... so testing doesn't leave the app stuck
// in a fake state" (scope item 4, implemented below as resetDevOverrides()) is the real safety
// net for that, not making persistence itself awkward.

const STORE_KEY = "sl:devOverrides";
const MODE_KEY = "sl:devMode";

/** `auto`/`live` are each override's real "off" value -- exactly the prototype's own defaults
 *  for `sky`/`nextDemo`/`weather`; `today` off is the empty string (no override parses to
 *  null, see theme.js's `parseTodayOverride`). */
export const DEV_OVERRIDE_DEFAULTS = { today: "", weather: "live", sky: "auto", nextDemo: "auto" };

function readStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEV_OVERRIDE_DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEV_OVERRIDE_DEFAULTS, ...parsed };
  } catch {
    return { ...DEV_OVERRIDE_DEFAULTS };
  }
}

let overrides = readStore();
const listeners = new Set();

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(overrides));
  } catch {
    // Private-browsing/quota failure -- the in-memory value still works for the rest of this
    // page load, it just won't survive a reload. Not worth surfacing to a dev-only tool.
  }
  listeners.forEach((fn) => fn(overrides));
}

/** Current `{ today, weather, sky, nextDemo }`. Always all four keys, even before the panel has
 *  ever been opened. */
export function getDevOverrides() {
  return overrides;
}

export function setDevOverride(key, value) {
  if (!(key in DEV_OVERRIDE_DEFAULTS)) return;
  overrides = { ...overrides, [key]: value };
  persist();
}

/** Scope item 4: "Real reset control back to auto/live for every override, so testing doesn't
 *  leave the app stuck in a fake state." */
export function resetDevOverrides() {
  overrides = { ...DEV_OVERRIDE_DEFAULTS };
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // See persist() above.
  }
  listeners.forEach((fn) => fn(overrides));
}

/** Called by app.js's render() (or anything else re-rendering the current room) so an override
 *  change repaints immediately -- the issue's own scope item 3 ("Real live effect"). */
export function onDevOverridesChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------------------
// Dev-only gating (scope item 2: "must never appear in a real production build for anyone but
// Shane; confirm the real mechanism -- a build flag, an admin-only route, a keyboard shortcut --
// rather than assuming one").
//
// This app has exactly one real account (src/auth/webauthn.mjs's own words: "the correct choice
// for a single-user app") -- there is no second person to hide the panel from once signed in.
// The real risk this gates against isn't a stranger finding it (WebAuthn passkeys already gate
// every session), it's the panel cluttering Shane's own daily-use screen by default. So the real
// mechanism is a persistent opt-in flag, closest of the issue's three named options to "a build
// flag": visiting the app with `?dev=1` in the URL sets it (and `?dev=0` clears it), then the
// param is stripped from the URL bar so it never leaks into a reload, a bookmark or a shared
// link. Once set it stays set (this device only, localStorage) until explicitly turned off the
// same way -- the panel never appears for a first-time or normal visit.
export function isDevModeEnabled() {
  try {
    return localStorage.getItem(MODE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Reads and consumes a `?dev=1`/`?dev=0` URL flag once at startup (app.js's start()). Returns
 *  whether dev mode is enabled after applying it. */
export function resolveDevModeFromUrl() {
  const params = new URLSearchParams(location.search);
  if (params.has("dev")) {
    const on = params.get("dev") === "1";
    try {
      if (on) localStorage.setItem(MODE_KEY, "1");
      else localStorage.removeItem(MODE_KEY);
    } catch {
      // Falls through to isDevModeEnabled() below, which will just read the unset default.
    }
    params.delete("dev");
    const clean = `${location.pathname}${params.toString() ? `?${params}` : ""}${location.hash}`;
    history.replaceState(null, "", clean);
  }
  return isDevModeEnabled();
}
