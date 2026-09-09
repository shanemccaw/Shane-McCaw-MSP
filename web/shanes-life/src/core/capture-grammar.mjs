// Deterministic instant capture grammar (Git #3292, Feature #3220, Epic #3086).
//
// Real, confirmed gap this closes: no deterministic server-side capture classifier existed at
// all. Every capture -- however clear-cut -- landed in the pending inbox and sat there until an
// actual Claude conversation processed it (confirmed live: "Drill is at home", "Add Tesla" and
// "add the movie X to my list" all sat unprocessed for hours). Every "capture grammar" phrase
// documented across this app's own design docs and MCP tool descriptions has always described
// what CLAUDE recognises when reading the inbox -- never something the raw Node backend matched
// on its own. This module is that missing matcher.
//
// Same real, already-locked principle BuildConsole's own Ctrl+K command center uses (Epic #2017,
// `desktop/ShaneBuilder/docs/Command Center (Ctrl+K).md`): one surface (the existing capture
// textarea -- no second UI element), a fixed, PRIORITY-ORDERED list of real pattern checks run on
// submit, each recognized pattern mapped to instant, deterministic execution -- never a model
// call. Ctrl+K checks `#123` before `GET /path` before a URL before a CLI verb before SQL before
// a service name before falling through to "ask AI"; this module checks a small, fixed
// vocabulary (meds/Tesla/money/dates/things/lists/...) in the same spirit, adapted to capture
// text instead of pasted shell commands.
//
// The exhaustive rule list below is compiled from two real, authoritative sources -- not
// invented: the design contract's own "Capture grammar" section
// (Design/design_handoff_shanes_life/README.md §112-123, plus the Tesla-room grammar at §52 and
// the Money-room grammar at §65/136), and the literal capture-grammar phrases already written
// into this codebase's own real MCP tool descriptions (`src/mcp/tools.mjs` -- "add my Kia Forte",
// "did an oil change on the Kia, $45", "pepper rabies due february 2027", "plumber is Ray
// 321-555-0142", etc.). Every rule below cites which one it came from.
//
// Genuinely ambiguous phrasing is a real, explicit non-goal (issue #3292's own words): this is
// not an AI/NLP layer, it is the same category of deterministic pattern matching as
// BuildConsole's own paste-detection. "Add Tesla" (bare, real vehicle-make word) is treated as
// clear enough to act on; "add my new couch" is not, and correctly falls through untouched. A
// capture that matches nothing here is unaffected -- it lands in the pending inbox exactly as it
// always has.
//
// -- Fail-safe contract (read this before adding a rule) --------------------------------------
// A rule's `run()` returns exactly one of three things, and the dispatcher (runCaptureGrammar,
// bottom of this file) treats each differently:
//   1. `{ message }`                 -- resolved cleanly. Instant execute, real confirmation,
//                                        NO pending-inbox row is ever created for this capture.
//   2. `{ fallback: true }`          -- the trigger phrase matched, but something the rule needs
//                                        to safely execute did not resolve (an unrecognised
//                                        vehicle/pet/store/date, an "X:" prefix that isn't an
//                                        existing person's name...). Treated EXACTLY like no
//                                        match at all: the raw text still goes to the pending
//                                        inbox, unmodified, for Claude to sort out. This is what
//                                        keeps a false-positive regex match from ever losing or
//                                        corrupting a real stated fact -- see the per-rule
//                                        comments below for which failure mode each rule treats
//                                        this way (a DATA-bearing statement whose resolution
//                                        failed) vs. which return a direct message instead (a
//                                        pure command/query, where there is no fact to lose).
//   3. throws                        -- treated the same as `{ fallback: true }` (caught
//                                        centrally). A bug in this module must never be the
//                                        reason a real capture goes missing.
// A rule's `match()` never touches the database -- it is pure, so `matchRule()` (below) is fully
// unit-testable with no DB (see capture-grammar.test.mjs). All real resolution/DB work happens
// in `run()`.

import { record } from "./audit.mjs";
import * as contacts from "./contacts.mjs";
import { slugify } from "./categories.mjs";
import * as dates from "./dates.mjs";
import * as lists from "./lists.mjs";
import * as medications from "./medications.mjs";
import * as money from "./money.mjs";
import * as pantry from "./pantry.mjs";
import * as people from "./people.mjs";
import * as pets from "./pets.mjs";
import * as places from "./places.mjs";
import * as prices from "./prices.mjs";
import * as pushSubscriptions from "./push-subscriptions.mjs";
import * as storeAisles from "./store-aisles.mjs";
import * as tesla from "./tesla.mjs";
import { TeslaError } from "./tesla.mjs";
import * as things from "./things.mjs";
import * as timers from "./timers.mjs";
import * as vehicles from "./vehicles.mjs";
import * as wins from "./wins.mjs";

const FALLBACK = { fallback: true };

// ---------------------------------------------------------------------------------------------
// Pure parsing helpers -- no DB, real unit tests cover these directly.
// ---------------------------------------------------------------------------------------------

const MONTH_INDEX = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const MONTH_NAMES_RE = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun[e]?|jul[y]?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

/** The first real "<month> <day>[, <year>]" or, failing that, "<month> <year>" token anywhere in
 *  the text -- "dr appointment oct 3rd 2pm dr fonji every 6 weeks" finds "oct 3rd"; "pepper
 *  rabies due february 2027" finds "february 2027" (day omitted, defaults to the 1st -- an
 *  honest approximation of a vet-given month/year with no specific day, same as this app accepts
 *  a vague "due" date anywhere else). Returns null when nothing date-shaped is in the text at
 *  all -- a genuine parse miss, handled by each rule's own fallback. */
export function extractDateTokens(text) {
  const dayRe = new RegExp(`\\b(${MONTH_NAMES_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`, "i");
  const m = text.match(dayRe);
  if (m) {
    const monthIndex = MONTH_INDEX[m[1].toLowerCase()];
    const day = Number(m[2]);
    if (monthIndex !== undefined && day >= 1 && day <= 31) {
      return { monthIndex, day, year: m[3] ? Number(m[3]) : null, dayOmitted: false, matchText: m[0] };
    }
  }
  const yearOnlyRe = new RegExp(`\\b(${MONTH_NAMES_RE})\\.?\\s+(\\d{4})\\b`, "i");
  const m2 = text.match(yearOnlyRe);
  if (m2) {
    const monthIndex = MONTH_INDEX[m2[1].toLowerCase()];
    if (monthIndex !== undefined) {
      return { monthIndex, day: 1, year: Number(m2[2]), dayOmitted: true, matchText: m2[0] };
    }
  }
  return null;
}

/** "2pm" / "2:30pm" -> "14:30". Null when no real clock time is stated. */
export function extractTime(text) {
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) hour += 12;
  const minute = m[2] ? Number(m[2]) : 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "every 6 weeks" -> 42, "every other day"... not handled (real, arbitrary N only, matching
 *  push_date's own "ARBITRARY real recurrence" documentation) -- "every month" -> 30. Null when
 *  no recurrence is stated (a one-off date). */
export function extractRecurrenceDays(text) {
  const m = text.match(/\bevery\s+(\d+)?\s*(day|days|week|weeks|month|months)\b/i);
  if (!m) return null;
  const n = m[1] ? Number(m[1]) : 1;
  const unit = m[2].toLowerCase();
  if (unit.startsWith("day")) return n;
  if (unit.startsWith("week")) return n * 7;
  return n * 30;
}

const DURATION_UNIT_RE = "hours?|hrs?|hr|minutes?|mins?|seconds?|secs?|sec";

function durationUnitToSeconds(unit) {
  const u = unit.toLowerCase();
  if (u.startsWith("h")) return 3600;
  if (u.startsWith("s")) return 1;
  return 60; // every minute-family spelling (minute, minutes, min, mins)
}

function cleanTimerLabel(raw) {
  const l = String(raw ?? "").trim().replace(/[.!?]+$/, "").trim();
  return l ? l.slice(0, 200) : null;
}

/** Git #3307's real capture-grammar timer parse -- "8 min timer for pasta" (duration before the
 *  word "timer") and "set a timer for 5 minutes[, for the rice]" (duration after it) are both
 *  real, named examples from Shane's own decision comment. Returns null when "timer" is present
 *  but no real duration is stated -- a genuine parse miss, same fallback discipline every other
 *  helper here uses. */
export function extractTimerDuration(text) {
  const before = text.match(
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${DURATION_UNIT_RE})\\s+timer\\b(?:\\s+for\\s+(.+))?`, "i"),
  );
  if (before) {
    const seconds = Math.round(Number(before[1]) * durationUnitToSeconds(before[2]));
    if (seconds > 0) return { seconds, label: cleanTimerLabel(before[3]) };
  }
  const after = text.match(
    new RegExp(`\\btimer\\b.*?\\bfor\\s+(\\d+(?:\\.\\d+)?)\\s*(${DURATION_UNIT_RE})\\b(?:\\s+for\\s+(.+))?`, "i"),
  );
  if (after) {
    const seconds = Math.round(Number(after[1]) * durationUnitToSeconds(after[2]));
    if (seconds > 0) return { seconds, label: cleanTimerLabel(after[3]) };
  }
  return null;
}

/** "495" -> "8 min", "90" -> "1 min 30 sec", "45" -> "45 sec" -- the real confirmation text a
 *  matched timer capture returns, and the Today tray card's own display. */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours} hr`);
  if (minutes > 0) parts.push(`${minutes} min`);
  if (seconds > 0 && hours === 0) parts.push(`${seconds} sec`);
  return parts.length > 0 ? parts.join(" ") : "0 sec";
}

function isoFromParts(year, monthIndex, day) {
  const mm = String(monthIndex + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** A stated month/day with no year rolls forward to next year when that date has already passed
 *  this year -- "ronnie's birthday dec 14" said in January still means THIS December, but said in
 *  December 20th means next December. */
export function resolveDateTokenToISO(tokens, asOf = new Date()) {
  if (!tokens) return null;
  let year = tokens.year;
  if (!year) {
    const candidate = new Date(asOf.getFullYear(), tokens.monthIndex, tokens.day);
    const today = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
    year = candidate < today ? asOf.getFullYear() + 1 : asOf.getFullYear();
  }
  return isoFromParts(year, tokens.monthIndex, tokens.day);
}

/** The next real calendar date this day-of-month falls on -- "mom's coming to visit the
 *  12th-18th" has no month at all, just a day (or day range); rolls into next month once the
 *  day has already passed this month. */
export function resolveNextDayOfMonthISO(day, asOf = new Date()) {
  let year = asOf.getFullYear();
  let month = asOf.getMonth();
  if (day < asOf.getDate()) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return isoFromParts(year, month, Math.min(day, 28));
}

/** Real, deterministic exact -> starts-with -> substring resolution -- the same tiered shape
 *  `log_car_maintenance`'s own MCP handler and `money.resolveAccount` already use everywhere
 *  else in this app for "which real X did Shane mean." Ambiguous or not-found both come back
 *  `{ ok: false }` rather than guessing. */
export function tieredMatch(candidates, needle, nameOf = (c) => c.name) {
  const n = String(needle ?? "").trim().toLowerCase();
  if (!n) return { ok: false, reason: "empty" };
  const tiers = [
    candidates.filter((c) => nameOf(c).toLowerCase() === n),
    candidates.filter((c) => nameOf(c).toLowerCase().startsWith(n)),
    candidates.filter((c) => nameOf(c).toLowerCase().includes(n)),
  ];
  for (const tier of tiers) {
    if (tier.length === 1) return { ok: true, match: tier[0] };
    if (tier.length > 1) return { ok: false, reason: "ambiguous", candidates: tier };
  }
  return { ok: false, reason: "not_found" };
}

/** Title-cases a stated phrase for a new list name -- "house projects" -> "House Projects".
 *  Unlike categories.mjs's own titleCase (which expands a slug), this works on the raw stated
 *  words directly, since a list's own display name (not a category slug) is what Shane typed. */
function titleCasePhrase(phrase) {
  return String(phrase || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Capitalizes just the first letter -- an item's own stated text ("tent stakes", "headlamp")
 *  keeps its own casing otherwise, unlike a list's own name above. Mirrors the prototype's own
 *  `cap1` used for exactly this in `nlst`/`atl`/`li` (Git #3305). */
function cap1(s) {
  const str = String(s || "");
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

const KNOWN_VEHICLE_MAKES =
  "tesla|kia|ford|toyota|honda|chevrolet|chevy|nissan|jeep|ram|gmc|hyundai|subaru|mazda|bmw|audi|" +
  "mercedes|volkswagen|vw|dodge|chrysler|buick|cadillac|lincoln|volvo|lexus|acura|infiniti|mitsubishi|porsche";

// ---------------------------------------------------------------------------------------------
// Rules, in real priority order (first match wins -- same "checked in this order" discipline as
// BuildConsole's own mode detection).
// ---------------------------------------------------------------------------------------------

const RULES = [
  // 1. Person note (README §114: "dana: …"). The one rule that deliberately does NOT execute on
  //    a bare regex match -- `addPersonEntry` auto-creates a person on first mention, so firing
  //    this for every "Word: rest of sentence" capture would fabricate a People entry out of
  //    ordinary prose ("Note: buy milk"). Real gate: only fires when the name before the colon
  //    already matches a real, existing person. No match there -> FALLBACK, exactly as if this
  //    rule did not exist -- the raw text still reaches the inbox.
  //
  //    Excludes a name ending in "list" (real person is never named that) so "gifts list: …" /
  //    "new list: …" fall through to the Lists room's own rules below instead of being claimed
  //    here first and lost to FALLBACK -- a real person is never named "… list" (Git #3305).
  {
    name: "person_note",
    match(text) {
      const m = text.match(/^([A-Za-z][A-Za-z .'-]{0,40}):\s*(.+)$/);
      if (!m) return null;
      if (/\blist$/i.test(m[1].trim())) return null;
      return { name: m[1].trim(), note: m[2].trim() };
    },
    async run(userId, { name, note }) {
      const person = await people.findPersonByName(userId, name);
      if (!person) return FALLBACK;
      const { entry } = await people.addPersonEntry(userId, {
        personName: person.name,
        bodyText: note,
        source: "shane",
      });
      return { message: `Filed under ${person.name}.`, entryId: entry.id };
    },
  },

  // 2. Meds (README §115: "took my meds", "evening meds done"). A batch word in the text wins;
  //    with none stated, resolve against today's real state -- exactly one batch still untaken
  //    today is unambiguous, more than one (or none) is not. mark_med_batch_taken's own MCP
  //    description names this the real capture-grammar entry point.
  {
    name: "meds_batch_taken",
    match(text) {
      if (!/\bmeds?\b/i.test(text)) return null;
      if (!/\b(took|taking|take|did|done|finished)\b/i.test(text)) return null;
      const batch = text.match(/\b(morning|evening|bed|afternoon|noon|midday|night)\b/i);
      return { statedBatch: batch ? batch[1].toLowerCase() : null };
    },
    async run(userId, { statedBatch }) {
      let batch = statedBatch;
      if (!batch) {
        const today = await medications.getMedsToday(userId);
        const untaken = today.batches.filter((b) => !b.takenToday);
        if (untaken.length !== 1) return FALLBACK;
        batch = untaken[0].batch;
      }
      const row = await medications.markBatchTaken(userId, batch, { source: "web" });
      return { message: `${row.batch[0].toUpperCase()}${row.batch.slice(1)} meds marked taken.` };
    },
  },

  // 3. Tesla stop (checked before "warm" below, since "stop warming up the car" contains "warm
  //    ... up" too -- README §52 doesn't name a stop phrase explicitly, but tesla.mjs's own
  //    stopPreconditioning exists specifically because the room's "Warm it up" toggle needs one).
  {
    name: "tesla_stop_preconditioning",
    match(text) {
      return /\b(stop (the )?(preconditioning|warming)|turn off (the )?(car|tesla|climate))\b/i.test(text) ? {} : null;
    },
    async run(userId) {
      return teslaCommandMessage(() => tesla.stopPreconditioning(userId), "Climate turned off.");
    },
  },

  // 4. Tesla charge read (README §52: "check the car" / "how's the battery" -> a read; the real,
  //    dedicated on-demand charge-status path issue #3292 itself calls out as missing, with the
  //    honest waking-car state -- see tesla.mjs's getChargeStateOrWaking). Checked BEFORE the
  //    warm/precondition command below: a question like "is the car warming up" or "what's my
  //    car's charge at" must resolve as a READ, never as a command to actually start warming it.
  {
    name: "tesla_charge_status",
    match(text) {
      return /\b(how'?s the (battery|charge)|what'?s (my|the) (car'?s?\s+)?charge|car'?s?\s+charge\b|check (the )?(car|tesla)\b)/i.test(
        text,
      )
        ? {}
        : null;
    },
    async run(userId) {
      try {
        const state = await tesla.getChargeStateOrWaking(userId);
        if (state.waking) return { message: state.message };
        const chargingNote = state.chargingState && state.chargingState !== "Disconnected" ? ` · ${state.chargingState}` : "";
        return {
          message: `${state.vehicleDisplayName || "The car"} is at ${state.batteryLevel}% · ${state.batteryRangeMiles} mi range${chargingNote}.`,
        };
      } catch (err) {
        if (err instanceof TeslaError) return { message: err.message };
        throw err;
      }
    },
  },

  // 5. Tesla climate read (README §52's "is the car warming up" side of "a read") -- same
  //    checked-before-the-command-rules reasoning as charge above.
  {
    name: "tesla_climate_status",
    match(text) {
      return /\b(is the car (warming|preconditioning)|climate status|car'?s?\s+climate)\b/i.test(text) ? {} : null;
    },
    async run(userId) {
      try {
        const state = await tesla.getVehicleClimateState(userId);
        const tempNote = state.insideTempC != null ? ` · inside ${Math.round(state.insideTempC)}°C` : "";
        const onNote = state.isClimateOn ? (state.isPreconditioning ? "preconditioning" : "on") : "off";
        return { message: `${state.vehicleDisplayName || "The car"} climate is ${onNote}${tempNote}.` };
      } catch (err) {
        if (err instanceof TeslaError && err.code === "VEHICLE_ASLEEP") {
          return { message: "The car is asleep and needs to wake up first -- this can take up to a minute. Try again shortly." };
        }
        if (err instanceof TeslaError) return { message: err.message };
        throw err;
      }
    },
  },

  // 6. Tesla warm (README §52: "warm it up" / "precondition" / "start the car" -> preconditioning).
  //    Requires a real object word ("it"/"the car"/"the tesla") before "up", and "precondition"
  //    only as a bare imperative -- not "-ing", which the read rule above already claimed.
  {
    name: "tesla_warm_preconditioning",
    match(text) {
      return /\b(warm(?:ing)?\s+(?:it|the car|the tesla)\s*up|^precondition\b|\bprecondition the (car|tesla)\b|start the car)\b/i.test(
        text,
      )
        ? {}
        : null;
    },
    async run(userId) {
      return teslaCommandMessage(() => tesla.startPreconditioning(userId), "Warming it up.");
    },
  },

  // 7. Tesla trunk (README §52: "open the trunk" / "pop the trunk" -> actuate_trunk, "no confirm
  //    by voice, same as the Tesla app's one tap").
  {
    name: "tesla_open_trunk",
    match(text) {
      return /\b(open|pop) the trunk\b/i.test(text) ? {} : null;
    },
    async run(userId) {
      return teslaCommandMessage(() => tesla.openTrunkNow(userId), "Trunk opening.");
    },
  },

  // 8. Tesla heading home (README §52: "heading home" / "take me home" -> Heading home to the
  //    recommended house). A pure command with no fact of its own to lose, so a missing "Home"
  //    place is a direct, real message -- not a fallback to the inbox, which can't drive a car.
  {
    name: "tesla_heading_home",
    match(text) {
      return /\b(heading home|head(?:ing)? home|take me home)\b/i.test(text) ? {} : null;
    },
    async run(userId) {
      const saved = await places.listPlaces(userId);
      const home = saved.find((p) => /^home$/i.test(p.label) || /^h1$/i.test(p.house ?? ""));
      if (!home) {
        return { message: "No place saved as \"Home\" yet -- say \"remember this as Home\" while you're there." };
      }
      return teslaCommandMessage(
        () => tesla.sendHeadingHomeCommands(userId, { latitude: home.latitude, longitude: home.longitude, label: home.label }),
        `Heading home to ${home.label}.`,
      );
    },
  },

  // 9. Tesla commute distance (README §52: "commute is 120 miles" -> commute_miles_needed).
  //    updateCommuteSettings SETS every field unconditionally (not additive) -- read the real
  //    current settings first and only change commuteMilesNeeded, or every other real stated
  //    setting (the cost-per-kWh rates, the nudge toggle) would be silently wiped.
  {
    name: "tesla_commute_miles",
    match(text) {
      const m = text.match(/\bcommute\s+is\s+(\d+(?:\.\d+)?)\s*(?:miles|mi)\b/i);
      return m ? { miles: Number(m[1]) } : null;
    },
    async run(userId, { miles }) {
      try {
        const existing = (await tesla.getCommuteSettings(userId)) || {};
        await tesla.updateCommuteSettings(userId, { ...existing, commuteMilesNeeded: miles });
        return { message: `Commute set to ${miles} miles.` };
      } catch (err) {
        if (err instanceof TeslaError) return { message: err.message };
        throw err;
      }
    },
  },

  // 9b. Tesla home electricity rate (Git #3318, README "Drawn in the same pass" item 6's own
  //     literal example: "home electricity is 14 cents" -> charge_cost_per_kwh). Every home
  //     charging session's cost estimate (the Charging card's own real per-session row) is null
  //     -- "rate not set" -- until this real rate is stated; same read-existing-first discipline
  //     as commute miles above, so this never wipes the Supercharger rate or the commute nudge's
  //     other real settings.
  {
    name: "tesla_home_electricity_rate",
    match(text) {
      const m = text.match(/\bhome electricity (?:is|costs?)\s+\$?(\d+(?:\.\d+)?)\s*(cents?|¢|dollars?)?\b/i);
      if (!m) return null;
      const amount = Number(m[1]);
      const ratePerKwh = /cents?|¢/i.test(m[2] || "") ? amount / 100 : amount;
      return { ratePerKwh };
    },
    async run(userId, { ratePerKwh }) {
      try {
        const existing = (await tesla.getCommuteSettings(userId)) || {};
        await tesla.updateCommuteSettings(userId, { ...existing, chargeCostPerKwh: ratePerKwh });
        return { message: `Home electricity set to $${ratePerKwh.toFixed(2)}/kWh. Every home charging session gets a real estimate now.` };
      } catch (err) {
        if (err instanceof TeslaError) return { message: err.message };
        throw err;
      }
    },
  },

  // 10. Money what-if (README §119/154: "what if I spend 60" -> Money what-if). Pure read-only
  //     arithmetic, so its own returned `.text` is always a real, direct answer either way.
  {
    name: "money_what_if",
    match(text) {
      const m = text.match(/^what if i (?:spend|spent|bought|buy)\s+\$?(\d+(?:\.\d{1,2})?)/i);
      return m ? { amount: Number(m[1]) } : null;
    },
    async run(userId, { amount }) {
      const result = await money.whatIf(userId, amount);
      return { message: result.text };
    },
  },

  // 11. Money "give X 300" / "put 300 toward X" (README §136: "simulates from DirectDeposit").
  {
    name: "money_give_or_put",
    match(text) {
      let m = text.match(/^give\s+(.+?)\s+\$?(\d+(?:\.\d{1,2})?)$/i);
      if (m) return { to: m[1].trim(), amount: Number(m[2]) };
      m = text.match(/^put\s+\$?(\d+(?:\.\d{1,2})?)\s+toward(?:s)?\s+(.+)$/i);
      if (m) return { amount: Number(m[1]), to: m[2].trim() };
      return null;
    },
    async run(userId, { amount, to }) {
      const result = await money.simulateTransfer(userId, { amount, from: "Direct Deposit", to });
      return { message: [result.headline, result.text, result.footer].filter(Boolean).join(" ") };
    },
  },

  // 12. Money "move 200 from X to Y" (README §119: "move 200 from Direct Deposit to Tesla" ->
  //     transfer simulator).
  {
    name: "money_move_transfer",
    match(text) {
      const m = text.match(/^move\s+\$?(\d+(?:\.\d{1,2})?)\s+from\s+(.+?)\s+to\s+(.+)$/i);
      return m ? { amount: Number(m[1]), from: m[2].trim(), to: m[3].trim() } : null;
    },
    async run(userId, { amount, from, to }) {
      const result = await money.simulateTransfer(userId, { amount, from, to });
      return { message: [result.headline, result.text, result.footer].filter(Boolean).join(" ") };
    },
  },

  // 13. Smoking log (README §119: "smoked" / "bought a pack" -> smoking log).
  {
    name: "money_smoke_log",
    match(text) {
      return /^(?:i\s+)?(smoked|had a cigarette|bought a pack|pack of cigarettes)\b/i.test(text) ? {} : null;
    },
    async run(userId) {
      const row = await money.logSmoke(userId, {});
      return { message: `Logged. ${row.packs} pack${row.packs === 1 ? "" : "s"}.` };
    },
  },

  // 14. Wins (README §119: "I did it, …" / "paid off …" -> Wins). log_win's own MCP description:
  //     "Use this for anything Shane states as already having happened" -- the raw text IS the
  //     win, in Shane's own words.
  {
    name: "wins_log",
    match(text) {
      return /^(i did it\b|paid off\s)/i.test(text) ? {} : null;
    },
    async run(userId, _groups, rawText) {
      const win = await wins.createWin(userId, { text: rawText, source: "shane" });
      return { message: "Win logged.", winId: win.id };
    },
  },

  // 15. Pet vaccine due (set_vehicle's own tool-description precedent for the literal example:
  //     "pepper rabies due february 2027" -- push_date's description). Upserts against that
  //     pet's own existing vaccine by name (Section 8: say it again, it corrects rather than
  //     duplicates) -- same idiom things.recordThing/contacts already use.
  {
    name: "pet_vaccine_due",
    match(text) {
      const m = text.match(/^([a-z][a-z']{1,30})\s+([a-z][a-z ]{1,30}?)\s+due\s+(.+)$/i);
      if (!m) return null;
      const tokens = extractDateTokens(m[3]);
      if (!tokens) return null;
      return { petName: m[1].trim(), vaccineName: m[2].trim(), tokens };
    },
    async run(userId, { petName, vaccineName, tokens }) {
      const allPets = await pets.listPets(userId);
      const petResult = tieredMatch(allPets, petName);
      if (!petResult.ok) return FALLBACK;
      const pet = await pets.getPet(userId, petResult.match.id);
      const dueOn = resolveDateTokenToISO(tokens);
      const existing = tieredMatch(pet.vaccines || [], vaccineName);
      if (existing.ok) {
        await pets.updateVaccine(userId, pet.id, existing.match.id, { dueOn });
      } else {
        await pets.createVaccine(userId, pet.id, { name: vaccineName, dueOn });
      }
      return { message: `${pet.name}'s ${vaccineName} due ${dueOn}.` };
    },
  },

  // 16. Birthday (README §120: "ronnie's birthday dec 14" -> yearly, 10-day lead).
  {
    name: "date_birthday",
    match(text) {
      const m = text.match(/^(.+?)'s\s+birthday(?:\s+is)?\s+(?:on\s+)?(.+)$/i);
      if (!m) return null;
      const tokens = extractDateTokens(m[2]);
      if (!tokens) return null;
      return { name: m[1].trim(), tokens };
    },
    async run(userId, { name, tokens }) {
      const atDate = resolveDateTokenToISO(tokens);
      const row = await dates.createDate({
        userId,
        kind: "birthday",
        title: `${name}'s birthday`,
        atDate,
        intervalDays: 365,
        source: "web",
      });
      return { message: `${name}'s birthday saved for ${atDate}.`, dateId: row.id };
    },
  },

  // 17. Visit (README §120: "mom's coming to visit the 12th-18th" -> Visits created on the fly).
  {
    name: "date_visit",
    match(text) {
      const m = text.match(/^(.+?)'s\s+coming(?:\s+to)?\s+visit\b.*?(\d{1,2})(?:st|nd|rd|th)?(?:\s*-\s*(\d{1,2})(?:st|nd|rd|th)?)?/i);
      if (!m) return null;
      return { name: m[1].trim(), startDay: Number(m[2]), endDay: m[3] ? Number(m[3]) : null };
    },
    async run(userId, { name, startDay, endDay }) {
      if (startDay < 1 || startDay > 31) return FALLBACK;
      const atDate = resolveNextDayOfMonthISO(startDay);
      const notes = endDay ? `${startDay}-${endDay}` : null;
      const row = await dates.createDate({
        userId,
        kind: "visit",
        title: `${name} visiting`,
        atDate,
        notes,
        source: "web",
      });
      return { message: `${name} visiting, starting ${atDate}.`, dateId: row.id };
    },
  },

  // 18. Want-to-go event (README §120: "want to go to the air show nov 7" -> event, 14-day lead).
  {
    name: "date_event",
    match(text) {
      const m = text.match(/^(?:i\s+)?want to go to\s+(?:the\s+)?(.+)$/i);
      if (!m) return null;
      const tokens = extractDateTokens(m[1]);
      if (!tokens) return null;
      const title = m[1].slice(0, m[1].toLowerCase().lastIndexOf(tokens.matchText.toLowerCase())).trim() || m[1].trim();
      return { title, tokens };
    },
    async run(userId, { title, tokens }) {
      const atDate = resolveDateTokenToISO(tokens);
      const row = await dates.createDate({ userId, kind: "event", title, atDate, source: "web" });
      return { message: `${title} saved for ${atDate}.`, dateId: row.id };
    },
  },

  // 19. Appointment / vet (README §120: "dr appointment oct 3rd 2pm dr fonji every 6 weeks" ->
  //     Dates, month/day/time/provider/arbitrary interval).
  {
    name: "date_appointment",
    match(text) {
      if (!/\b(appointment|apt\.?)\b/i.test(text) && !/\bvet\b/i.test(text)) return null;
      const tokens = extractDateTokens(text);
      if (!tokens) return null;
      // "dr appointment ... dr fonji" -- "dr" said generically before "appointment" itself is
      // real too, so take the first "dr <word>" whose word ISN'T one of those generic terms
      // (real, honest disambiguation, not a guess at which "dr" came first).
      const genericAfterDr = new Set(["appointment", "apt", "visit", "checkup", "office"]);
      const providerWord = [...text.matchAll(/\b(?:dr\.?|doctor)\s+([A-Za-z][a-z]+)/gi)]
        .map((m) => m[1])
        .find((word) => !genericAfterDr.has(word.toLowerCase()));
      const providerName = providerWord ? providerWord[0].toUpperCase() + providerWord.slice(1).toLowerCase() : null;
      return {
        kind: /\bvet\b/i.test(text) ? "vet" : "appointment",
        provider: providerName ? `Dr. ${providerName}` : null,
        tokens,
        time: extractTime(text),
        intervalDays: extractRecurrenceDays(text),
      };
    },
    async run(userId, { kind, provider, tokens, time, intervalDays }) {
      const atDate = resolveDateTokenToISO(tokens);
      const title = provider || (kind === "vet" ? "Vet appointment" : "Appointment");
      const row = await dates.createDate({
        userId,
        kind,
        title,
        atDate,
        atTime: time,
        intervalDays,
        provider,
        source: "web",
      });
      return { message: `${title} saved for ${atDate}${time ? ` ${time}` : ""}.`, dateId: row.id };
    },
  },

  // 20. Who fixed what (set_contact's own MCP description: "plumber is Ray 321-555-0142").
  {
    name: "contact_trade",
    match(text) {
      const m = text.match(
        /^(plumber|electrician|handyman|contractor|hvac(?:\s*tech)?|locksmith|roofer|landscaper|exterminator|pool guy|pest control|painter|mechanic)\s+is\s+([A-Za-z][A-Za-z '.-]*?)(?:[,]?\s+([\d()+\-. ]{7,20}))?\s*$/i,
      );
      if (!m) return null;
      return { trade: m[1].trim(), name: m[2].trim(), phone: m[3] ? m[3].trim() : null };
    },
    async run(userId, { trade, name, phone }) {
      const row = await contacts.recordContact(userId, { name, phone, trade });
      return { message: `${name} (${trade}) saved${phone ? ` · ${phone}` : ""}.`, contactId: row.id };
    },
  },

  // 21. Add a vehicle (set_vehicle's own MCP description's literal example: "add my Kia Forte").
  //     Gated on a real, known-make allowlist to bound false-positive risk on a bare "add X" --
  //     the ONE deliberate exception to "add" being otherwise unclaimed by any rule here.
  {
    name: "vehicle_add",
    match(text) {
      const m = text.match(new RegExp(`^add\\s+(?:my\\s+|a\\s+|an\\s+)?(?:new\\s+)?((?:${KNOWN_VEHICLE_MAKES})\\b[\\w .'-]*)$`, "i"));
      return m ? { name: m[1].trim() } : null;
    },
    async run(userId, { name }) {
      const existing = await vehicles.listVehicles(userId);
      const already = existing.find((v) => v.name.toLowerCase() === name.toLowerCase());
      if (already) return { message: `${already.name} is already in Cars.` };
      const row = await vehicles.createVehicle(userId, { name });
      return { message: `${row.name} added to Cars.`, vehicleId: row.id };
    },
  },

  // 22. Log real vehicle maintenance (log_car_maintenance's own MCP description's literal
  //     example: "did an oil change on the Kia, $45"). A real vehicle name that doesn't resolve
  //     is a genuine data-bearing statement Claude can still recover from the inbox -> fallback.
  {
    name: "vehicle_maintenance_log",
    match(text) {
      const m = text.match(
        /^(?:did\s+(?:an?\s+)?)?(.+?)\s+on\s+(?:the\s+)?([A-Za-z][A-Za-z0-9 ]{1,40}?)[,]?\s+\$(\d+(?:\.\d{1,2})?)(?:,?\s+at\s+(\d+)\s*(?:miles|mi)\b)?\s*$/i,
      );
      if (!m) return null;
      return { description: m[1].trim(), vehicle: m[2].trim(), amount: Number(m[3]), mileage: m[4] ? Number(m[4]) : null };
    },
    async run(userId, { description, vehicle, amount, mileage }) {
      const all = await vehicles.listVehicles(userId);
      const resolved = tieredMatch(all, vehicle);
      if (!resolved.ok) return FALLBACK;
      const row = await vehicles.logMaintenance(userId, resolved.match.id, { description, amount, mileage });
      return { message: `${description} on the ${resolved.match.name} logged, $${amount.toFixed(2)}.`, vehicleId: row.id };
    },
  },

  // 23. Manual-watch refill ordered (mark_medication_ordered's own real "Ordered it" action, said
  //     instead of tapped).
  {
    name: "medication_ordered",
    match(text) {
      const m = text.match(/^ordered\s+(?:my\s+)?(.+)$/i);
      return m ? { name: m[1].trim() } : null;
    },
    async run(userId, { name }) {
      const today = await medications.getMedsToday(userId);
      const resolved = tieredMatch(today.refills.needsYou, name);
      if (!resolved.ok) return FALLBACK;
      const row = await medications.markMedicationOrdered(userId, resolved.match.id);
      return { message: `${resolved.match.name} marked ordered.`, nextRefillOn: row.next_refill_on };
    },
  },

  // 24. New list, explicit (Git #3305, the Lists room's own "What changed... the Lists room"
  //     §3: "new list: Camping" / "new list: Camping: headlamp"). Creates an empty list, or one
  //     with a real first item already on it when a second colon/segment is stated. An existing
  //     list of the same name is not recreated -- it just opens, same as the shelf's own dashed
  //     "+" card behavior.
  {
    name: "new_list",
    match(text) {
      const m = text.match(/^(?:new list|make a list|start a list)(?:\s+called|\s+named)?[:\s]+([^:]+?)(?:[:\s]+(.+))?$/i);
      if (!m) return null;
      const name = m[1].trim();
      if (!name) return null;
      return { name, firstItem: m[2] ? m[2].trim() : null };
    },
    async run(userId, { name, firstItem }) {
      const title = titleCasePhrase(name);
      const all = await lists.listAllListNames(userId);
      const isNew = !all.some((l) => l.name.toLowerCase() === title.toLowerCase());
      const list = await lists.getOrCreateListByName(userId, {
        name: title,
        category: slugify(title),
        categoryMeta: {
          label: title,
          icon: "list-checks",
          color: "indigo",
          itemNoun: "item",
          description: `${title} -- a list Shane started.`,
        },
      });
      const item = firstItem ? cap1(firstItem) : null;
      if (item) await lists.addListItems(userId, list.id, [item]);
      return {
        message: isNew
          ? `New list: ${title}.${item ? ` ${item} is the first thing on it.` : ""}`
          : `${title} already exists.${item ? ` Added ${item}.` : ""}`,
      };
    },
  },

  // 25. Add to a named list, prefix-matched, create on miss (Git #3305, same "the Lists room"
  //     §3: "gifts list: speaker for DJ", "add tent stakes to the camping list" -- list names
  //     match by prefix, create on miss). Two real phrasings the design names explicitly: "<list>
  //     list: <item>" and "add/put <item> to/on/in the <list> list". `listAllListNames` includes
  //     Shopping so "shopping list: milk" still finds the real run rather than spawning a shadow
  //     list.
  {
    name: "named_list_add",
    match(text) {
      // Real, named list only -- "add milk to the list" (no list actually named) is genuinely
      // ambiguous and must fall through untouched, not resolve to a nonsense list called "the".
      const isGenericName = (n) => !n || /^(?:the|my|a|an|it|that|this|list)$/i.test(n);
      let m = text.match(/^(?:add|put)\s+(.+?)\s+(?:to|on|in)\s+(?:the\s+|my\s+)?(.+?)\s+list[.!]*$/i);
      if (m && !isGenericName(m[2].trim())) return { item: m[1].trim(), rawName: m[2].trim() };
      m = text.match(/^([a-z][a-z ]{1,40}?)\s+list[:\s]+(.+)$/i);
      if (m && !isGenericName(m[1].trim())) return { item: m[2].trim(), rawName: m[1].trim() };
      return null;
    },
    async run(userId, { item: rawItem, rawName }) {
      if (!rawItem || !rawName) return FALLBACK;
      const item = cap1(rawItem);
      const all = await lists.listAllListNames(userId);
      const resolved = tieredMatch(all, rawName);
      if (!resolved.ok && resolved.reason === "ambiguous") return FALLBACK;
      const name = resolved.ok ? resolved.match.name : titleCasePhrase(rawName);
      const isNew = !resolved.ok;
      const list = await lists.getOrCreateListByName(userId, {
        name,
        category: slugify(name),
        categoryMeta: {
          label: name,
          icon: "list-checks",
          color: "indigo",
          itemNoun: "item",
          description: `${name} -- a list Shane started.`,
        },
      });
      await lists.addListItems(userId, list.id, [item]);
      return {
        message: isNew ? `New list: ${name}. ${item} is the first thing on it.` : `Added to ${name}: ${item}.`,
      };
    },
  },

  // 26. Watch/read lists (issue #3292's own named example: "push_list for Watch/Books";
  //     README §120: "watch …" / "read …" -> Lists, list created if missing).
  {
    name: "watch_or_read_list",
    match(text) {
      const m = text.match(/^(watch|read)\s+(.+)$/i);
      return m ? { verb: m[1].toLowerCase(), item: m[2].trim() } : null;
    },
    async run(userId, { verb, item }) {
      const isWatch = verb === "watch";
      const list = await lists.getOrCreateListByName(userId, {
        name: isWatch ? "Watch" : "Books",
        category: isWatch ? "watch" : "books",
        categoryMeta: {
          label: isWatch ? "Watch" : "Books",
          icon: isWatch ? "clapperboard" : "book-open",
          color: "violet",
          itemNoun: "item",
          description: isWatch ? "Movies and shows to watch, pushed by Claude or added directly." : "Books to read.",
        },
      });
      await lists.addListItems(userId, list.id, [item]);
      return { message: `Added "${item}" to ${list.name}.` };
    },
  },

  // 27. Occasional-purchase "What I Like" list (Git #3311, sub-issue of #3229/#3305's own real
  //     Lists capture-grammar pattern): "I sometimes get X" / "add X to what I like" -- the
  //     literal phrasings the issue names. Resolves to the SAME conventionally-named list
  //     (lists.OCCASIONAL_LIST_NAME) prices.mjs's real deal-match check looks up by name, same
  //     real "no dedicated table" shape as Watch/Books/Heading Out above.
  {
    name: "occasional_purchase_add",
    match(text) {
      let m = text.match(/^i\s+sometimes\s+get\s+(.+)$/i);
      if (m) return { item: m[1].trim() };
      m = text.match(/^add\s+(.+?)\s+to\s+what\s+i\s+like$/i);
      if (m) return { item: m[1].trim() };
      return null;
    },
    async run(userId, { item }) {
      if (!item) return FALLBACK;
      const list = await lists.getOrCreateListByName(userId, {
        name: lists.OCCASIONAL_LIST_NAME,
        category: lists.OCCASIONAL_LIST_CATEGORY,
        categoryMeta: {
          label: lists.OCCASIONAL_LIST_NAME,
          icon: "heart",
          color: "rose",
          itemNoun: "item",
          description: "Occasional-purchase items Shane buys sometimes, not routinely -- worth a nudge if a real weekly-ad deal or coupon matches one (Git #3311).",
        },
      });
      await lists.addListItems(userId, list.id, [item]);
      return { message: `Added "${item}" to ${lists.OCCASIONAL_LIST_NAME}.` };
    },
  },

  // 28. "Where's X" (README §121: "where's the drill?" -> answers in a toast). Pure read -- a
  //     genuine no-match still gets a real, honest answer rather than a fallback, since nothing
  //     Shane said risks being lost by answering rather than filing it.
  {
    name: "where_is_thing",
    match(text) {
      const m = text.match(/^where(?:'s|\s+is)\s+(?:my|the|a|an)?\s*(.+?)\??$/i);
      return m ? { q: m[1].trim() } : null;
    },
    async run(userId, { q }) {
      if (!q) return FALLBACK;
      const found = await things.findThing(userId, q);
      if (!found) return { message: `Nothing on file for "${q}".` };
      const houseNote = found.house ? ` at ${found.house}` : "";
      return { message: `${found.name} is ${found.place}${houseNote}.` };
    },
  },

  // 29. Thing location (README §122: "X is in the garage" -> Things, requires a place word;
  //     issue #3292's own confirmed-live example "Drill is at home" -- "the" is optional there,
  //     so this accepts both).
  {
    name: "thing_location",
    match(text) {
      const m = text.match(/^(.+?)\s+is\s+(in|at)\s+(?:the\s+)?(.+)$/i);
      return m ? { name: m[1].trim(), preposition: m[2].toLowerCase(), place: m[3].trim() } : null;
    },
    async run(userId, { name, preposition, place }) {
      if (!name || !place) return FALLBACK;
      const row = await things.recordThing(userId, { name, place });
      return { message: `${row.name} lives ${preposition} ${row.place}.`, thingId: row.id };
    },
  },

  // 30. Aisle memory (README §122: "pasta aisle 12 end cap" -> aisle memory). No store is stated
  //     in the design's own example -- resolves against the current Shopping run's real stated
  //     store (#3108). A run with no store set yet is a genuine data-bearing statement Claude can
  //     still recover -> fallback, not a blocking message.
  {
    name: "aisle_memory",
    match(text) {
      const m = text.match(/^(.+?)\s+aisle\s+(\d+)\b\s*(.*)$/i);
      return m ? { item: m[1].trim(), aisle: Number(m[2]), note: m[3].trim() || null } : null;
    },
    async run(userId, { item, aisle, note }) {
      const list = await lists.getOrCreateShoppingList(userId);
      const detail = await lists.getListDetail(userId, list.id);
      if (!detail.store) return FALLBACK;
      const spot = await storeAisles.recordAisle(userId, detail.store, item, aisle, note);
      const matchingItem = detail.items.find((i) => i.text.toLowerCase().includes(item.toLowerCase()));
      if (matchingItem) {
        await lists.setListItemNote(list.id, matchingItem.id, `Aisle ${aisle}${note ? ` · ${note}` : ""}`);
      }
      return { message: `${item} -> aisle ${aisle}${note ? ` · ${note}` : ""} at ${detail.store}, remembered.`, spotId: spot.id };
    },
  },

  // 31. Real price stated (log_price's own MCP description's literal examples: "chicken breasts
  //     are $3.49 now", "paid $12 for the detergent at Aldi"). Store falls back to the current
  //     Shopping run's stated store when not said explicitly; still unresolved -> fallback (a
  //     real price is worth keeping for Claude to ask about, not worth losing).
  {
    name: "log_price",
    match(text) {
      let m = text.match(/^(.+?)\s+(?:is|are)\s+\$(\d+(?:\.\d{1,2})?)\s*(?:now)?\.?$/i);
      if (m) return { item: m[1].trim(), price: Number(m[2]), store: null };
      m = text.match(/^paid\s+\$(\d+(?:\.\d{1,2})?)\s+for\s+(?:the\s+|a\s+|an\s+)?(.+?)(?:\s+at\s+(.+))?$/i);
      if (m) return { item: m[2].trim(), price: Number(m[1]), store: m[3] ? m[3].trim() : null };
      m = text.match(/^spent\s+\$(\d+(?:\.\d{1,2})?)\s+on\s+(?:the\s+|a\s+|an\s+)?(.+?)(?:\s+at\s+(.+))?$/i);
      if (m) return { item: m[2].trim(), price: Number(m[1]), store: m[3] ? m[3].trim() : null };
      return null;
    },
    async run(userId, { item, price, store }) {
      let resolvedStore = store;
      if (!resolvedStore) {
        const list = await lists.getOrCreateShoppingList(userId);
        const detail = await lists.getListDetail(userId, list.id);
        resolvedStore = detail.store;
      }
      if (!resolvedStore) return FALLBACK;
      const row = await prices.recordPrice(userId, {
        storeName: resolvedStore,
        itemText: item,
        priceCents: Math.round(price * 100),
        source: "shane",
      });
      return { message: `${row.item_text} · $${price.toFixed(2)} at ${row.store_name}, logged.` };
    },
  },

  // 32. Grocery add (README §122: "grocery words -> the run"; issue #3292's own real MCP
  //     precedent, push_list). Deliberately gated behind an explicit shopping verb ("add" is
  //     already claimed by vehicle_add above, and a bare noun phrase is too broad to trust).
  {
    name: "grocery_add",
    match(text) {
      const m = text.match(/^(?:grab|pick up|need)\s+(.+)$/i);
      if (!m) return null;
      const items = m[1]
        .replace(/\s+(?:from|at)\s+the\s+store$/i, "")
        .split(/\s*,\s*|\s+and\s+/i)
        .map((s) => s.trim())
        .filter((s) => s && s.length <= 60);
      return items.length ? { items } : null;
    },
    async run(userId, { items }) {
      const list = await lists.getOrCreateShoppingList(userId);
      await lists.addListItems(userId, list.id, items);
      return { message: `Added ${items.join(", ")} to the run.` };
    },
  },

  // 32. Queue for the next run (Git #3300: "Next [house] run · take" -- the Things room's own
  //     checklist of what to bring, distinct from thing_location above and from the
  //     Tesla-triggered Heading Out list, #3158). "take/bring X to <house>" queues a real thing
  //     already on file (or files a new one, defaulting its home to "Home" per the design's own
  //     "supplies default to Home").
  {
    name: "queue_take",
    match(text) {
      const m = text.match(/^(?:take|bring)\s+(?:the\s+)?(.+?)\s+to\s+(?:the\s+)?(.+)$/i);
      return m ? { name: m[1].trim(), takeForHouse: m[2].trim() } : null;
    },
    async run(userId, { name, takeForHouse }) {
      if (!name || !takeForHouse) return FALLBACK;
      const row = await things.queueForTake(userId, { name, takeForHouse });
      return { message: `${row.name} queued for the next ${row.take_for_house} run.`, thingId: row.id };
    },
  },

  // 33. Real pantry quantity stated (#3308's own literal example: "I have 2 lbs of chicken
  //     breasts") -- an absolute real quantity, not additive. Requires a real number and a real
  //     unit word before "of" (the app's own real spoken shape for this) rather than a bare "I
  //     have X" -- that broader form risks false positives ("I have 2 hours", "I have 2 kids")
  //     nowhere near a real pantry statement, so it's deliberately left unmatched here (falls
  //     through to the inbox, same as any other genuinely ambiguous capture).
  {
    name: "pantry_have",
    match(text) {
      const m = text.match(/^i have\s+(\d+(?:\.\d+)?)\s+([a-z]+)\s+of\s+(.+)$/i);
      return m ? { quantity: Number(m[1]), unit: m[2].trim(), name: m[3].trim() } : null;
    },
    async run(userId, { quantity, unit, name }) {
      const row = await pantry.setPantryQuantity(userId, { name, quantity, unit });
      return { message: `${row.name}: ${row.quantity}${row.unit ? ` ${row.unit}` : ""} on hand.`, pantryItemId: row.id };
    },
  },

  // 34. Real pantry restock (#3308's own literal example: "bought 3 cans of diced tomatoes") --
  //     adds a real delta on top of whatever's already on file, rather than replacing it (the
  //     real distinction from pantry_have above: "bought" is additive, "I have" is a fresh count).
  {
    name: "pantry_bought",
    match(text) {
      const m = text.match(/^bought\s+(\d+(?:\.\d+)?)\s+([a-z]+)\s+of\s+(.+)$/i);
      return m ? { quantity: Number(m[1]), unit: m[2].trim(), name: m[3].trim() } : null;
    },
    async run(userId, { quantity, unit, name }) {
      const row = await pantry.adjustPantryQuantity(userId, { name, delta: quantity, unit });
      return { message: `${row.name}: ${row.quantity}${row.unit ? ` ${row.unit}` : ""} now on hand.`, pantryItemId: row.id };
    },
  },

  // 35. Real pantry depletion (#3308's own literal example: "used the last of the rosemary") --
  //     zeroes an already-known real item. Genuinely nothing on file for this name is a real
  //     fallback, not silently discarded -- "used the last of X" naming something never tracked
  //     is still worth Claude seeing in the inbox (it may be a genuinely new real item to file).
  {
    name: "pantry_used_last",
    match(text) {
      const m = text.match(/^used\s+the\s+last\s+of\s+(?:the\s+|my\s+)?(.+)$/i);
      return m ? { name: m[1].trim() } : null;
    },
    async run(userId, { name }) {
      const row = await pantry.depletePantryItem(userId, name, null);
      if (!row) return FALLBACK;
      return { message: `${row.name} marked used up.`, pantryItemId: row.id };
    },
  },

  // 36. Standalone timer (Git #3307, README §112-123 item 3: "8 min timer for pasta"; Shane's
  //     own decision comment adds "set a timer for 5 minutes"). A pure command with no stated
  //     fact to lose, so a "timer" with no real duration falls straight through to the inbox
  //     rather than a fallback -- there's nothing here worth Claude re-reading either, but the
  //     fail-safe contract only distinguishes fallback vs. no-match for a DATA-bearing capture,
  //     and this one just isn't. Server-side entity + real web push, not client-only state -- see
  //     timers.mjs and server.mjs's runTimerSweep for why.
  {
    name: "timer_set",
    match(text) {
      if (!/\btimer\b/i.test(text)) return null;
      return extractTimerDuration(text);
    },
    async run(userId, { seconds, label }) {
      const row = await timers.createTimer(userId, { label, durationSeconds: seconds });
      const ready = pushSubscriptions.isConfigured() && (await pushSubscriptions.hasAnySubscription(userId));
      const warning = ready ? "" : " Turn on notifications in Settings so this can actually alert you.";
      return {
        message: `Timer set for ${formatDuration(seconds)}${label ? ` -- ${label}` : ""}.${warning}`,
        timerId: row.id,
      };
    },
  },
];

const RULES_BY_NAME = new Map(RULES.map((r) => [r.name, r]));

/** Shared shape for the Tesla command rules -- a successful command is a real, immediate
 *  confirmation; a real TeslaError (not connected, no vehicle selected, the command proxy isn't
 *  configured) is a real, honest direct message too, since there is no user-stated fact at risk
 *  in a bare command like "warm it up." */
async function teslaCommandMessage(fn, successMessage) {
  try {
    await fn();
    return { message: successMessage };
  } catch (err) {
    if (err instanceof TeslaError) return { message: err.message };
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/** Pure classification -- runs every rule's `match()` in priority order and returns the first
 *  hit, doing no I/O at all. This is what capture-grammar.test.mjs exercises directly. */
export function matchRule(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  for (const rule of RULES) {
    const groups = rule.match(raw);
    if (groups) return { rule: rule.name, groups };
  }
  return null;
}

/**
 * The real dispatcher: classify, then (if matched) execute against the real database. Called
 * from `POST /api/captures` before a pending-capture row is ever written -- see routes/api.mjs.
 * Never throws: any real failure inside a rule's own `run()` is treated as `{ matched: false }`
 * (the same as no match at all), so a bug here can never be the reason a real capture goes
 * missing -- worst case, this module behaves as if it doesn't exist yet.
 */
export async function runCaptureGrammar({ userId, text }) {
  const raw = String(text ?? "").trim();
  const found = matchRule(raw);
  if (!found) return { matched: false };

  const rule = RULES_BY_NAME.get(found.rule);
  try {
    const outcome = await rule.run(userId, found.groups, raw);
    if (!outcome || outcome.fallback) return { matched: false };
    await record({
      userId,
      actor: "web",
      actorLabel: `capture-grammar:${found.rule}`,
      action: `capture_grammar.${found.rule}`,
      detail: { text: raw },
    });
    return { matched: true, rule: found.rule, message: outcome.message };
  } catch (err) {
    // A rule matched the trigger phrase but genuinely failed to execute (a real HttpError from a
    // core module, or an unexpected bug in this file) -- fail safe. The raw text still reaches
    // the pending inbox exactly as if this module had never run, never a lost or half-applied
    // capture. Server-side only; not shown to Shane.
    console.warn(`[capture-grammar] rule "${found.rule}" matched but failed to execute: ${err.message}`);
    return { matched: false };
  }
}
