// Shane's Life -- live weather for the Today tray sky (Git #3144, "Today v3").
//
// Real source and real WMO mapping, exactly as spec'd (design handoff README's "Today v3 --
// Header" section, ported byte-for-byte from the First Slice Prototype's own fetch): Open-Meteo,
// Brevard County coords. Production should read the phone's own geolocation instead of a fixed
// lat/long -- that's real device-location work, out of this Feature's scope (filed as its own
// finding, see build-journal/3144.md), so this stays the one fixed coordinate pair the design
// itself specifies until that lands.
const WX_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=28.36&longitude=-80.68&current=temperature_2m,weather_code,is_day&temperature_unit=fahrenheit";

const WX_LABEL = { storm: "Storms", snow: "Snow", rain: "Rain", cloud: "Cloudy", fog: "Fog", sun: "Sunny", moon: "Clear" };

/** Glow color behind the meta row's weather light, per kind -- README's own values. */
export const WX_GLOW = {
  sun: "rgba(253,224,71,.4)",
  moon: "rgba(226,232,240,.3)",
  cloud: "rgba(203,213,225,.28)",
  rain: "rgba(96,165,250,.34)",
  storm: "rgba(139,92,246,.4)",
  snow: "rgba(248,250,252,.36)",
};

/** WMO weather_code -> the six real visual kinds this app draws sky/particle treatments for.
 *  Fog (45-48) draws as `cloud` (the design's own choice -- "fog (cloud icon, label 'Fog')") --
 *  only the label text below distinguishes it, never the visual kind. */
function wmoKind(code, isDay) {
  if (code >= 95) return "storm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if (code >= 2) return "cloud";
  return isDay ? "sun" : "moon";
}

function wmoLabel(kind, code) {
  if (kind === "cloud" && code >= 45 && code <= 48) return WX_LABEL.fog;
  return WX_LABEL[kind];
}

/** The design's own stated fallback -- "until the feed answers: a sample" -- shown instantly so
 *  the header never waits on a network round-trip before it can render at all. */
export function sampleWeather(isDay) {
  return isDay ? { kind: "sun", tempF: 86, text: "86° · Sunny" } : { kind: "moon", tempF: 74, text: "74° · Clear" };
}

let cached = null; // { kind, tempF, text }
let inFlight = null;

export function cachedWeather() {
  return cached;
}

/** Fetches once and caches for the rest of this page load. Resolves to `null` on any failure --
 *  weather is decorative, never something that should break the tray. */
export function fetchWeather() {
  if (cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  inFlight = fetch(WX_URL)
    .then((r) => r.json())
    .then((j) => {
      const c = j.current;
      const kind = wmoKind(c.weather_code, !!c.is_day);
      const tempF = Math.round(c.temperature_2m);
      cached = { kind, tempF, text: `${tempF}° · ${wmoLabel(kind, c.weather_code)}` };
      return cached;
    })
    .catch(() => null)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
