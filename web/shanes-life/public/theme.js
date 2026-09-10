// Shane's Life -- Seasons & holidays theming (Git #3145, "Today v3" README section "Seasons
// and holidays"). One real rule (`themeKey`) + one real flag table (`THEMES`), exactly as the
// design handoff specifies -- ported byte-for-byte (dates, colors, hat/peeker symbol ids, fox
// lines) from the First Slice Prototype's own wired `themeKey`/`THEME_BASE`/`THEMES`/`themeFor`/
// `parseToday`, which is the one file with all v2 logic actually wired end-to-end. Where the
// README's prose and the prototype's real wiring disagree (the README's Sky layer bullet lists
// Winter/Spring/Summer sky tints, but the prototype's own `sky: th.thSky || SKY[skyKey]` never
// reads them -- only the five holiday keys ever set `thSky`), this follows the prototype, the
// project's own documented tie-breaker for a "design has dead renderVals" mismatch.

/** The Nth weekday-of-month helper the design uses for "the fourth Thursday of November"
 *  (Thanksgiving). `weekday` is JS's 0=Sunday..6=Saturday; here always 4 (Thursday). */
import { getDevOverrides } from "./dev-overrides.js";

function nthWeekday(year, month, weekday, n) {
  const first = new Date(year, month, 1).getDay();
  return 1 + ((weekday - first + 7) % 7) + 7 * (n - 1);
}

/** October -> halloween; Oct 28 -> birthday; November up to and including the fourth Thursday
 *  -> thanksgiving, after it -> christmas; December <=25 -> christmas, 26-31 and Jan 1 ->
 *  newyear; otherwise Jan-Feb winter, Mar-May spring, Jun-Aug summer, Sep-Nov fall. */
export function themeKey(date) {
  const month = date.getMonth();
  const day = date.getDate();
  const turkeyDay = nthWeekday(date.getFullYear(), 10, 4, 4); // November, 4th Thursday
  if (month === 9) return day === 28 ? "birthday" : "halloween";
  if (month === 10) return day <= turkeyDay ? "thanksgiving" : "christmas";
  if (month === 11) return day <= 25 ? "christmas" : "newyear";
  if (month === 0 && day === 1) return "newyear";
  return month <= 1 ? "winter" : month <= 4 ? "spring" : month <= 7 ? "summer" : "fall";
}

/** Flags per theme (all default false/null) -- README's own exact list. */
const THEME_BASE = {
  peeker: null, hatOn: false, hat: null, peekHatOn: false, peekHat: null,
  lights: false, snowcap: false, wreath: false, bunting: false, balloons: false, web: false,
  pumpkins: false, cake: false, pie: false, turkey: false, snowman: false, tree: false,
  leafpile: false, tulips: false, sunflower: false, wLeaves: false, wSnow: false,
  wConfetti: false, wBats: false, wFireworks: false, wPetals: false, wFireflies: false,
  wSleigh: false, thSky: null, thFox: null, orangeMoon: false,
};

/** The five real holiday sky gradients (README "Header -- Sky layer"), identical values to the
 *  prototype's own `SKY.halloween/birthday/thanksgiving/christmas/newyear`. A holiday sky wins
 *  over time-of-day; time-of-day still runs for every season (see theme.thSky usage in app.js). */
const HOLIDAY_SKY = {
  halloween:
    "radial-gradient(120% 70% at 50% -20%,rgba(168,85,247,.34),rgba(168,85,247,0) 70%),radial-gradient(2px 2px at 24% 36px,rgba(255,255,255,.6),rgba(255,255,255,0)),radial-gradient(2px 2px at 58% 20px,rgba(255,255,255,.5),rgba(255,255,255,0))",
  birthday: "radial-gradient(120% 70% at 50% -20%,rgba(244,114,182,.3),rgba(244,114,182,0) 70%)",
  thanksgiving: "radial-gradient(120% 70% at 50% -20%,rgba(251,146,60,.3),rgba(251,146,60,0) 70%)",
  christmas:
    "radial-gradient(120% 70% at 50% -20%,rgba(96,165,250,.28),rgba(96,165,250,0) 70%),radial-gradient(2px 2px at 30% 30px,rgba(255,255,255,.6),rgba(255,255,255,0)),radial-gradient(2px 2px at 70% 16px,rgba(255,255,255,.5),rgba(255,255,255,0))",
  newyear:
    "radial-gradient(120% 70% at 50% -20%,rgba(99,102,241,.32),rgba(99,102,241,0) 70%),radial-gradient(2px 2px at 20% 40px,rgba(255,255,255,.7),rgba(255,255,255,0)),radial-gradient(2px 2px at 62% 24px,rgba(255,255,255,.6),rgba(255,255,255,0)),radial-gradient(2px 2px at 84% 58px,rgba(255,255,255,.7),rgba(255,255,255,0)),radial-gradient(2px 2px at 40% 12px,rgba(255,255,255,.5),rgba(255,255,255,0))",
};

/** README "Seasons and holidays" bullets, verbatim -- hat/peeker symbol ids point at the
 *  <symbol>s added to public/critters-sprite.svg (h-*, ph-*, pkw-ghost) alongside this Feature. */
const THEMES = {
  fall: { wLeaves: true },
  halloween: {
    thSky: HOLIDAY_SKY.halloween, hatOn: true, hat: "h-witch", peeker: "pkw-ghost",
    wBats: true, wLeaves: true, pumpkins: true, web: true, orangeMoon: true,
    thFox: "Spooky season, Shane. Nothing needs you yet. Boo.",
  },
  birthday: {
    thSky: HOLIDAY_SKY.birthday, hatOn: true, hat: "h-party", peekHatOn: true, peekHat: "ph-party",
    wConfetti: true, wBats: true, bunting: true, balloons: true, cake: true, pumpkins: true, web: true,
    orangeMoon: true, thFox: "Happy birthday, Shane! Nothing needs you today but cake.",
  },
  thanksgiving: {
    thSky: HOLIDAY_SKY.thanksgiving, hatOn: true, hat: "h-leaf",
    wLeaves: true, pie: true, turkey: true, leafpile: true,
    thFox: "Happy Thanksgiving, Shane. Pie's in the yard, nothing needs you.",
  },
  christmas: {
    thSky: HOLIDAY_SKY.christmas, hatOn: true, hat: "h-santa", peekHatOn: true, peekHat: "ph-santa",
    wSnow: true, wSleigh: true, lights: true, snowcap: true, wreath: true, snowman: true, tree: true,
    thFox: "Merry Christmas, Shane. Lights are on, nothing needs you.",
  },
  newyear: {
    thSky: HOLIDAY_SKY.newyear, hatOn: true, hat: "h-ny", peekHatOn: true, peekHat: "ph-ny",
    wFireworks: true, wSnow: true, lights: true, snowcap: true, snowman: true,
    thFox: "Happy New Year, Shane. Fresh calendar, nothing needs you yet.",
  },
  winter: { wSnow: true, snowcap: true },
  spring: { wPetals: true, tulips: true },
  summer: { wFireflies: true, sunflower: true },
};

/** Real theme for a date: base flags + the season/holiday's own flags, plus the one real
 *  cross-theme rule the spec names -- Oct 25-31 (excluding the 28th, its own full birthday
 *  theme) layers birthday bunting/balloons on top of Halloween without switching the theme
 *  away from it. */
export function themeFor(date) {
  const key = themeKey(date);
  const theme = { key, ...THEME_BASE, ...(THEMES[key] || {}) };
  if (key === "halloween" && date.getDate() >= 25) {
    theme.bunting = true;
    theme.balloons = true;
  }
  return theme;
}

/** The four accepted override formats, ported byte-for-byte from the First Slice Prototype's
 *  own `parseToday` (door() logic) so a `?today=` override resolves identically to the
 *  design's own dev tweak: "2026-12-25", "12/25/2026", "12/25", "Dec 25 2026". Returns null (no
 *  override) for an absent/empty/unparseable value -- never throws. */
export function parseTodayOverride(raw) {
  const s = raw == null ? "" : String(raw).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12);
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/);
  if (m) {
    let y = m[3] ? +m[3] : new Date().getFullYear();
    if (y < 100) y += 2000;
    return new Date(y, +m[1] - 1, +m[2], 12);
  }
  const d = new Date(s);
  return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
}

/** The app's real override entry point. The dev floaty panel (Git #3146, `dev-panel.js`) is the
 *  primary real mechanism now -- it writes to `dev-overrides.js`'s live store, so a `today`
 *  override there takes effect on the very next render, no reload. The `?today=` query param
 *  (Git #3145, the mechanism built before the panel UI existed) still works as a fallback for a
 *  cold-load/shareable-link override. Only the calendar date is overridden -- the clock hour
 *  driving the sky phase and the fox's Morning/Afternoon/Evening opener always stays the
 *  device's real current time, exactly as the prototype's own `hour` (always
 *  `new Date().getHours()`, never touched by `dateNow`) does it. */
export function todayOverride() {
  const panelValue = getDevOverrides().today;
  if (panelValue) return parseTodayOverride(panelValue);
  return parseTodayOverride(new URLSearchParams(location.search).get("today"));
}
