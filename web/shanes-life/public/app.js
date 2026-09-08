// Shane's Life -- the app shell. Plain ES modules, no framework, no build step.
//
// Every number and every row on this screen comes from a real endpoint. There is no fixture
// module anywhere in this directory and there must never be one.

import {
  initCritters,
  loadCritterSprite,
  resetCritterRender,
  critterIcon,
  critterFor,
  attachPeeker,
  attachPeekerHat,
  attachRoomWatermark,
  rollPeekers,
} from "./critters.js";
import { fetchWeather, sampleWeather, cachedWeather, WX_GLOW } from "./weather.js";
import { themeFor, todayOverride } from "./theme.js";

const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  user: null,
  route: "today",
  entity: null,
  attachment: null, // { mediaId, kind, label }
  cookRecipeId: null,
};

// Cook mode's own transient client state (Git #3125) -- deliberately not persisted server-side
// or to localStorage, same as the design's own `this.setState({ cook: { id, step, checks } })`:
// it's a single real cooking session in front of Shane right now, reset whenever he leaves it or
// reloads. { recipeId, stepIndex, checks: { "<stepIndex>-<ingIndex>": true } }.
let cookSession = null;

// Wake Lock API handle (Git #3125's "screen stays awake in cook mode"). Feature-detected --
// unsupported browsers just don't get the lock, cook mode still works otherwise.
let wakeLock = null;

async function requestCookWakeLock() {
  if (wakeLock || !("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch {
    // Denied (not visible, battery saver, etc) -- cook mode still works, the screen just may sleep.
  }
}

async function releaseCookWakeLock() {
  if (!wakeLock) return;
  try {
    await wakeLock.release();
  } catch {
    // Already released.
  }
  wakeLock = null;
}

// A wake lock is auto-released by the browser whenever the tab loses visibility; re-acquire it
// if Shane comes back to the tab while still genuinely in cook mode.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.route === "cook") requestCookWakeLock();
});

// ---------------------------------------------------------------------------
// Tonight -- multi-dish synchronized cooking (Git #3126, sub-issue of #3086, reuses Cook mode's
// (#3125) per-dish step/timer shape and #3124's recipes as the real dishes).
//
// Deliberately NOT persisted server-side or to localStorage -- same real intent as cookSession
// above (#3125): a live multi-dish cook is a single real session in front of Shane right now,
// reset if he leaves the tab and comes back later, matching the First Slice Prototype's own
// PERSIST list, which excludes `meal`/`alarm` for the exact same reason.
//
// { dishes: [{id, name, minutes, steps}], startedAt, started: {id: epochMs}, snoozed: {id:
// epochMs}, done }. `dishes` is a snapshot of the recipes picked at Start time -- Tonight's own
// real dish set for this session, not re-fetched every tick.
let mealSession = null;
// The one real alarm showing right now, if any: { kind: "start", dishId, big, label, next } or
// { kind: "done", label, next }. Only one alarm is ever shown at a time (matches the prototype's
// own `!st.alarm` tick guard).
let mealAlarm = null;
// Which recipes are checked in the idle "pick tonight's dishes" screen, before Start is pressed.
let mealSelection = new Set();
let mealTickTimer = null;
let mealWakeLock = null;
let mealAudioCtx = null;
let mealBeepTimer = null;

const MEAL_SNOOZE_MS = 2 * 60 * 1000; // real 2 minutes, matching the design's own snooze shift

function mmss(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function mealTotalMinutes(dishes) {
  return Math.max(...dishes.map((d) => d.minutes));
}

/** The real moment everything finishes: the latest of every ALREADY-STARTED dish's own real
 *  finish time, falling back to the plan (start + total) before anything has started -- exactly
 *  the prototype's own `mealFinish`. A snoozed, not-yet-started dish can genuinely push this
 *  later once it does start; that's real, correct behavior, not a bug. */
function mealFinishTime(session) {
  const finishTimes = session.dishes.filter((d) => session.started[d.id]).map((d) => session.started[d.id] + d.minutes * 60000);
  if (finishTimes.length > 0) return Math.max(...finishTimes);
  return session.startedAt + mealTotalMinutes(session.dishes) * 60000;
}

/** One dish's real live state against the session, at a given moment -- the prototype's own
 *  `dishState`. Every dish is already past "idle" the instant a session exists (the longest dish
 *  starts immediately in `startMeal`), so this only ever returns cooking/due/waiting/done. */
function mealDishState(dish, session, now) {
  if (session.started[dish.id]) {
    const leftMs = dish.minutes * 60000 - (now - session.started[dish.id]);
    return leftMs <= 0 ? { phase: "done", leftMs: 0 } : { phase: "cooking", leftMs };
  }
  const fin = mealFinishTime(session);
  const startsAt = session.snoozed[dish.id] || fin - dish.minutes * 60000;
  const dt = startsAt - now;
  return dt <= 0 ? { phase: "due", startsInMs: 0 } : { phase: "waiting", startsInMs: dt };
}

function playMealBeep() {
  try {
    if (!mealAudioCtx) mealAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const beep = () => {
      const o = mealAudioCtx.createOscillator();
      const g = mealAudioCtx.createGain();
      o.type = "square";
      o.frequency.value = 880;
      g.gain.value = 0.15;
      o.connect(g);
      g.connect(mealAudioCtx.destination);
      o.start();
      o.stop(mealAudioCtx.currentTime + 0.18);
    };
    beep();
    if (!mealBeepTimer) mealBeepTimer = setInterval(beep, 450);
  } catch {
    // No AudioContext (or blocked before any user gesture) -- the alarm still shows visually.
  }
}
function stopMealBeep() {
  if (mealBeepTimer) {
    clearInterval(mealBeepTimer);
    mealBeepTimer = null;
  }
}

async function requestMealWakeLock() {
  if (mealWakeLock || !("wakeLock" in navigator)) return;
  try {
    mealWakeLock = await navigator.wakeLock.request("screen");
    mealWakeLock.addEventListener("release", () => {
      mealWakeLock = null;
    });
  } catch {
    // Denied -- the session still runs, the screen just may sleep.
  }
}
async function releaseMealWakeLock() {
  if (!mealWakeLock) return;
  try {
    await mealWakeLock.release();
  } catch {
    // Already released.
  }
  mealWakeLock = null;
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && mealSession && !mealSession.done) requestMealWakeLock();
});

function ensureMealTick() {
  if (mealTickTimer) return;
  mealTickTimer = setInterval(onMealTick, 1000);
}
function stopMealTick() {
  if (mealTickTimer) {
    clearInterval(mealTickTimer);
    mealTickTimer = null;
  }
}

/** Runs every second for the life of a real Tonight session, independent of whichever screen
 *  Shane is actually looking at -- a "start this dish now" alert has to be able to interrupt him
 *  on Shopping just as much as on Tonight itself. Matches the prototype's own global `onTick`. */
function onMealTick() {
  if (!mealSession || mealSession.done || mealAlarm) return;
  const now = Date.now();
  const fin = mealFinishTime(mealSession);
  const due = mealSession.dishes.find((d) => !mealSession.started[d.id] && now >= (mealSession.snoozed[d.id] || fin - d.minutes * 60000));
  if (due) {
    const lead = mealSession.dishes.find((d) => mealSession.started[d.id] && d.id !== due.id);
    const leadText = lead ? ` · ${lead.name.toLowerCase()} has ${mmss(Math.max(0, lead.minutes * 60000 - (now - mealSession.started[lead.id])))} left` : "";
    mealAlarm = {
      kind: "start",
      dishId: due.id,
      big: `${due.minutes}:00`,
      label: `${due.name} goes in now`,
      next: `${due.name} · ${due.minutes} min${leadText}`,
    };
    playMealBeep();
    renderMealAlarmOverlay();
    return;
  }
  const allIn = mealSession.dishes.every((d) => mealSession.started[d.id]);
  const allDone = allIn && mealSession.dishes.every((d) => now - mealSession.started[d.id] >= d.minutes * 60000);
  if (allDone) {
    mealSession.done = true;
    mealAlarm = { kind: "done", label: "Everything's done", next: "Plate up. Half for the Rental." };
    playMealBeep();
    renderMealAlarmOverlay();
    return;
  }
  // Nothing due -- just refresh the live countdown text if Tonight is the screen actually
  // showing it, recomputed from the cached `mealSession.dishes` snapshot, not a re-fetch. Cook
  // mode's own mealChipStrip only updates on Shane's next real interaction there (Back/Next/a
  // dish's own alarm) rather than every second, to avoid re-fetching /api/recipes on a timer.
  if (state.route === "tonight") render();
}

function startMeal(dishes) {
  const total = mealTotalMinutes(dishes);
  const first = dishes.find((d) => d.minutes === total) || dishes[0];
  const now = Date.now();
  mealSession = { dishes, startedAt: now, started: { [first.id]: now }, snoozed: {}, done: false };
  mealAlarm = null;
  mealSelection = new Set();
  ensureMealTick();
  requestMealWakeLock();
  renderMealAlarmOverlay();
}

function stopMeal() {
  mealSession = null;
  mealAlarm = null;
  stopMealTick();
  stopMealBeep();
  releaseMealWakeLock();
  renderMealAlarmOverlay();
}

/** The one real full-screen alarm overlay, appended directly to <body> rather than the routed
 *  `#view` -- it has to keep showing across a hash navigation Shane makes while it's up (e.g. he
 *  taps into Shopping while "Potatoes go in now" is ringing), which `view.replaceChildren()` on
 *  every render() would otherwise wipe. Hidden whenever there is no real alarm to show. */
function renderMealAlarmOverlay() {
  let overlay = document.getElementById("meal-alarm-overlay");
  if (!overlay) {
    overlay = el("div", { id: "meal-alarm-overlay", class: "meal-alarm-overlay" });
    document.body.append(overlay);
  }
  if (!mealAlarm) {
    overlay.hidden = true;
    overlay.replaceChildren();
    return;
  }
  const a = mealAlarm;
  const stop = () => {
    stopMealBeep();
    if (a.kind === "start") {
      mealSession.started[a.dishId] = Date.now();
    }
    mealAlarm = null;
    renderMealAlarmOverlay();
    render();
  };
  const snooze = () => {
    stopMealBeep();
    if (a.kind === "start") {
      mealSession.snoozed[a.dishId] = Date.now() + MEAL_SNOOZE_MS;
    }
    mealAlarm = null;
    renderMealAlarmOverlay();
    render();
  };
  overlay.hidden = false;
  overlay.replaceChildren(
    el("div", { class: "meal-alarm-card" }, [
      el("div", { class: "meal-alarm-big", text: a.kind === "start" ? a.big : "0:00" }),
      el("div", { class: "meal-alarm-label", text: a.label }),
      el("div", { class: "meal-alarm-next", text: a.next }),
      el("div", { class: "meal-alarm-actions" }, [
        el("button", { class: "meal-alarm-primary", text: a.kind === "start" ? "It's in" : "Plate up", onClick: stop }),
        el("button", { class: "meal-alarm-secondary", text: a.kind === "start" ? "Give me 2 minutes" : "Keep warm 5 minutes", onClick: snooze }),
      ]),
    ]),
  );
}

// ---------------------------------------------------------------------------
// fetch helpers
// ---------------------------------------------------------------------------

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof Blob) ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }
  if (!res.ok) {
    const err = new Error(payload?.error || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Location (Git #3159, "Location-aware content surfacing")
//
// Real investigation finding (docs/location-aware-content-surfacing-findings.md): a Home
// Screen web app cannot detect arrival at a place in the background -- neither iOS nor Android
// exposes background geolocation/geofencing to browser JS. What IS real and buildable is
// foreground/on-demand: ask for the real current position only while the app is actually open,
// and never force the native permission prompt on every load -- that's genuinely annoying, and
// the design's own "nudges rationed" spirit (Section 3) applies just as much to a permission
// dialog as it does to a notification.
//
// getRealPosition() is used two ways: (1) a capture submit always tries it, low-power, short
// timeout -- the browser's OWN native prompt asks the first time, never an in-app form (Section
// 3, "no forms, anywhere, ever"); a denial or timeout just means the capture saves with no
// coordinates, exactly as if this feature didn't exist. (2) the Today view only tries it
// silently when permission is ALREADY granted, so opening Today never itself triggers a prompt.
async function geoPermissionState() {
  if (!navigator.permissions?.query) return "unsupported"; // Safari's Permissions API coverage for geolocation is inconsistent -- treat "can't tell" as "don't assume granted"
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state; // "granted" | "prompt" | "denied"
  } catch {
    return "unsupported";
  }
}

function getRealPosition({ timeout = 4000 } = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null), // denied, unavailable, or timed out -- all the same real answer: no position this time
      { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout }, // low-power: a few hundred meters of accuracy is plenty to match a saved place's radius, and battery is a real cost (contract pack's own "not assumed simple" flag)
    );
  });
}

const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
};

// critterSlot defaults to "idle" (1e, "Idle... 'nothing to look at' state" per the critter
// spec, Git #3119) -- the generic "nothing here" moment. Things' own empty state passes
// "notfound" (1w, "Things '?' ... empty search") instead, per the spec's own mapping.
function empty(message, hint, critterSlot = "idle") {
  return el("div", { class: "empty" }, [
    critterIcon(critterSlot, { size: 64 }),
    el("p", { text: message }),
    hint ? el("p", { class: "small", text: hint }) : null,
  ]);
}

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diffDays = Math.round((d - new Date()) / 86_400_000);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diffDays === 0) return `today ${time}`;
  if (diffDays === 1) return `tomorrow ${time}`;
  if (diffDays === -1) return `yesterday ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` ${time}`;
}

// "last 8 minutes ago" -- the real, clever usage signal design screen v4-settings-claude-widget
// wants for the widget's own render count: minute/hour granularity close in, falling back to
// when() once it's far enough out that minutes stop being a useful unit.
function agoShort(iso) {
  if (!iso) return null;
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  return when(iso);
}

// Git #3218's real countdown display -- agoShort above is past-only ("X minutes ago"); a
// scheduled command is always in the future, so it needs its own short "in X minutes" form.
function inShort(iso) {
  if (!iso) return null;
  const diffMin = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (diffMin <= 0) return "any moment now";
  if (diffMin === 1) return "in 1 minute";
  return `in ${diffMin} minutes`;
}

// ---------------------------------------------------------------------------
// Today v3 -- the cute skin, sky and real weather (Git #3144, "Round 2 rebuild").
//
// Design source: Design/design_handoff_shanes_life/README.md ("Today v3 -- the cute skin")
// and the First Slice Prototype's own `door()` logic, ported byte-for-byte for the sky
// gradients, WMO-driven weather layers, and the fox's greeting buckets. Holiday/season
// theming (flags, particles, roof/yard decorations) is explicitly out of this issue's scope
// (its own sibling Feature) -- only time-of-day sky runs here, never a holiday overlay.
// ---------------------------------------------------------------------------

const WDN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SKY_GRADIENT = {
  dawn: "radial-gradient(120% 70% at 50% -20%,rgba(253,186,116,.26),rgba(253,186,116,0) 70%)",
  day: "radial-gradient(120% 70% at 50% -20%,rgba(147,197,253,.16),rgba(147,197,253,0) 70%)",
  dusk: "radial-gradient(120% 70% at 50% -20%,rgba(196,181,253,.26),rgba(196,181,253,0) 70%)",
  night: "radial-gradient(120% 70% at 50% -20%,rgba(99,102,241,.3),rgba(99,102,241,0) 70%)",
};

/** dawn/day/dusk/night, exactly the design's own hour buckets -- device-local time, since
 *  "the phone's actual" clock is what the spec calls for once this leaves the prototype. */
function skyPhase(hour) {
  if (hour < 6 || hour >= 21) return "night";
  if (hour < 10) return "dawn";
  if (hour < 17) return "day";
  return "dusk";
}

/** "Morning, Shane." / "Afternoon, Shane." / "Evening, Shane." -- the fox's real opener,
 *  contract pack Section 1: always the first of the bubble's two real parts. */
function foxOpener(hour) {
  const word = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
  return `${word}, Shane.`;
}

/** "HH:MM" (24h, as dates.mjs stores at_time) -> "2:00 PM". */
function formatTime12(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return "";
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** The night layer (21:00-06:00): 26 twinkling stars, two four-point sparkles, Saturn, Mars and
 *  one shooting star, ported verbatim (coordinates/timings) from the First Slice Prototype. */
const NIGHT_LAYER_HTML = `<div style="position:absolute;left:0;right:0;top:0;bottom:0;background:linear-gradient(180deg,rgba(2,6,23,.78),rgba(2,6,23,.35) 55%,rgba(2,6,23,0));pointer-events:none"></div><svg viewBox="0 0 402 300" preserveAspectRatio="xMidYMin slice" style="position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:hidden"><circle cx="24" cy="30" r="1" fill="#F8FAFC" style="animation:czTwinkle 2.2s 0.00s ease-in-out infinite"></circle><circle cx="70" cy="18" r="1.4" fill="#F8FAFC" style="animation:czTwinkle 2.7s 0.37s ease-in-out infinite"></circle><circle cx="118" cy="46" r="0.9" fill="#F8FAFC" style="animation:czTwinkle 3.2s 0.74s ease-in-out infinite"></circle><circle cx="160" cy="22" r="1.6" fill="#F8FAFC" style="animation:czTwinkle 3.7s 1.11s ease-in-out infinite"></circle><circle cx="205" cy="60" r="1.1" fill="#F8FAFC" style="animation:czTwinkle 4.2s 1.48s ease-in-out infinite"></circle><circle cx="250" cy="30" r="1" fill="#F8FAFC" style="animation:czTwinkle 2.2s 1.85s ease-in-out infinite"></circle><circle cx="300" cy="14" r="1.4" fill="#F8FAFC" style="animation:czTwinkle 2.7s 2.22s ease-in-out infinite"></circle><circle cx="345" cy="44" r="0.9" fill="#F8FAFC" style="animation:czTwinkle 3.2s 2.59s ease-in-out infinite"></circle><circle cx="380" cy="24" r="1.2" fill="#F8FAFC" style="animation:czTwinkle 3.7s 2.96s ease-in-out infinite"></circle><circle cx="40" cy="150" r="1" fill="#F8FAFC" style="animation:czTwinkle 4.2s 0.33s ease-in-out infinite"></circle><circle cx="96" cy="172" r="1.4" fill="#F8FAFC" style="animation:czTwinkle 2.2s 0.70s ease-in-out infinite"></circle><circle cx="140" cy="158" r="0.9" fill="#F8FAFC" style="animation:czTwinkle 2.7s 1.07s ease-in-out infinite"></circle><circle cx="190" cy="152" r="1.2" fill="#F8FAFC" style="animation:czTwinkle 3.2s 1.44s ease-in-out infinite"></circle><circle cx="236" cy="166" r="1" fill="#F8FAFC" style="animation:czTwinkle 3.7s 1.81s ease-in-out infinite"></circle><circle cx="278" cy="172" r="1.4" fill="#F8FAFC" style="animation:czTwinkle 4.2s 2.18s ease-in-out infinite"></circle><circle cx="300" cy="150" r="0.9" fill="#F8FAFC" style="animation:czTwinkle 2.2s 2.55s ease-in-out infinite"></circle><circle cx="365" cy="140" r="1.2" fill="#F8FAFC" style="animation:czTwinkle 2.7s 2.92s ease-in-out infinite"></circle><circle cx="150" cy="200" r="1" fill="#F8FAFC" style="animation:czTwinkle 3.2s 0.29s ease-in-out infinite"></circle><circle cx="60" cy="220" r="1.4" fill="#F8FAFC" style="animation:czTwinkle 3.7s 0.66s ease-in-out infinite"></circle><circle cx="260" cy="230" r="0.9" fill="#F8FAFC" style="animation:czTwinkle 4.2s 1.03s ease-in-out infinite"></circle><circle cx="350" cy="210" r="1.2" fill="#F8FAFC" style="animation:czTwinkle 2.2s 1.40s ease-in-out infinite"></circle><circle cx="110" cy="262" r="1" fill="#F8FAFC" style="animation:czTwinkle 2.7s 1.77s ease-in-out infinite"></circle><circle cx="300" cy="272" r="1.4" fill="#F8FAFC" style="animation:czTwinkle 3.2s 2.14s ease-in-out infinite"></circle><circle cx="200" cy="290" r="0.9" fill="#F8FAFC" style="animation:czTwinkle 3.7s 2.51s ease-in-out infinite"></circle><circle cx="20" cy="100" r="1.1" fill="#F8FAFC" style="animation:czTwinkle 4.2s 2.88s ease-in-out infinite"></circle><circle cx="380" cy="100" r="1.3" fill="#F8FAFC" style="animation:czTwinkle 2.2s 0.25s ease-in-out infinite"></circle><g stroke="#F8FAFC" stroke-width="1.2" stroke-linecap="round" style="animation:czTwinkle 3.6s .8s ease-in-out infinite"><path d="M330 22v-7M330 22v7M330 22h-7M330 22h7"></path></g><g stroke="#F8FAFC" stroke-width="1.2" stroke-linecap="round" style="animation:czTwinkle 4.2s 2s ease-in-out infinite"><path d="M84 244v-6M84 244v6M84 244h-6M84 244h6"></path></g><g transform="translate(332 164) rotate(-18)"><ellipse cx="0" cy="0" rx="19" ry="5" fill="none" stroke="rgba(253,224,71,.45)" stroke-width="2.4"></ellipse><circle r="9" fill="#E9C46A"></circle><path d="M-8.5 -2.5h17M-8 2.5h16" stroke="rgba(146,64,14,.45)" stroke-width="1.4"></path><path d="M-19 0 A19 5 0 0 0 19 0" fill="none" stroke="rgba(253,224,71,.8)" stroke-width="2.4"></path></g><circle cx="110" cy="162" r="7" fill="rgba(248,113,113,.18)"></circle><circle cx="110" cy="162" r="3.6" fill="#F87171"></circle><circle cx="109" cy="161" r="1.2" fill="rgba(255,255,255,.35)"></circle><g style="animation:czShoot 11s linear infinite"><line x1="0" y1="0" x2="30" y2="-4" stroke="rgba(255,255,255,.75)" stroke-width="1.4" stroke-linecap="round"></line><circle cx="0" cy="0" r="1.8" fill="#FFFFFF"></circle></g></svg>`;

const CLOUD_SVG =
  '<path d="M8 20 C 3 20 2 14 7 13 C 7 7 15 5 18 10 C 23 7 28 12 25 16 C 28 17 26 20 22 20 Z"';
const cloudTrio = (fill) => `
<svg viewBox="0 0 28 22" width="96" height="76" style="position:absolute;left:6%;top:30px;opacity:.55;animation:czCloudDrift 46s ease-in-out infinite">${CLOUD_SVG} fill="${fill}"></path></svg>
<svg viewBox="0 0 28 22" width="66" height="52" style="position:absolute;left:58%;top:64px;opacity:.45;animation:czCloudDrift 38s 9s ease-in-out infinite reverse">${CLOUD_SVG} fill="${fill}"></path></svg>
<svg viewBox="0 0 28 22" width="54" height="42" style="position:absolute;left:34%;top:118px;opacity:.35;animation:czCloudDrift 52s 4s ease-in-out infinite">${CLOUD_SVG} fill="${fill}"></path></svg>`;

// 14 streaks for rain, 18 (tighter-spaced) for storm -- the design's own two distinct counts.
const RAIN_STREAK_OFFSETS = [
  [3.0, 0.9, 0], [10.2, 1.02, 0.23], [17.5, 1.14, 0.46], [24.7, 1.26, 0.69],
  [31.9, 0.9, 0.92], [39.2, 1.02, 0.05], [46.4, 1.14, 0.28], [53.6, 1.26, 0.51],
  [60.8, 0.9, 0.74], [68.1, 1.02, 0.97], [75.3, 1.14, 0.1], [82.5, 1.26, 0.33],
  [89.8, 0.9, 0.56], [97.0, 1.02, 0.79],
];
const STORM_STREAK_OFFSETS = [
  [3.0, 0.9, 0], [8.5, 1.02, 0.23], [14.1, 1.14, 0.46], [19.6, 1.26, 0.69],
  [25.1, 0.9, 0.92], [30.6, 1.02, 0.05], [36.2, 1.14, 0.28], [41.7, 1.26, 0.51],
  [47.2, 0.9, 0.74], [52.8, 1.02, 0.97], [58.3, 1.14, 0.1], [63.8, 1.26, 0.33],
  [69.4, 0.9, 0.56], [74.9, 1.02, 0.79], [80.4, 1.14, 1.02], [85.9, 1.26, 0.15],
  [91.5, 0.9, 0.38], [97.0, 1.02, 0.61],
];
const rainStreaks = (color, offsets = RAIN_STREAK_OFFSETS) =>
  `<div style="position:absolute;inset:0;transform:skewX(-12deg)">${offsets.map(
    ([left, dur, delay]) =>
      `<div style="position:absolute;left:${left}%;top:0;width:1.5px;height:26px;border-radius:1px;background:linear-gradient(180deg,rgba(${color},0),rgba(${color},.7));animation:czRainFall ${dur}s ${delay}s linear infinite"></div>`,
  ).join("")}</div>`;

/** The weather-sky visual per current condition -- the design's own per-kind gradients,
 *  clouds, rain/storm streaks and snow dots (fog draws with the `cloud` kind, per spec). */
function weatherSkyHtml(kind) {
  if (kind === "sun") {
    return `<div style="position:absolute;inset:0;background:radial-gradient(70% 60% at 82% 0%,rgba(253,224,71,.2),rgba(253,224,71,0) 70%),linear-gradient(180deg,rgba(147,197,253,.12),rgba(147,197,253,0) 60%)"></div><svg viewBox="0 0 400 400" width="560" height="560" style="position:absolute;right:-230px;top:-300px;opacity:.16;animation:czSpin 140s linear infinite"><g fill="#FDE68A"><path d="M200 200 L60 20 L110 10 Z"></path><path d="M200 200 L320 30 L360 60 Z"></path><path d="M200 200 L20 180 L30 130 Z"></path><path d="M200 200 L390 220 L380 270 Z"></path><path d="M200 200 L150 390 L100 370 Z"></path><path d="M200 200 L300 380 L340 350 Z"></path></g></svg>`;
  }
  if (kind === "cloud") {
    return `<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(148,163,184,.24),rgba(148,163,184,0) 85%)"></div>${cloudTrio("rgba(226,232,240,.8)")}`;
  }
  if (kind === "rain") {
    return `<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(100,116,139,.34),rgba(100,116,139,0) 90%)"></div>${cloudTrio("rgba(203,213,225,.75)")}${rainStreaks("147,197,253")}`;
  }
  if (kind === "storm") {
    return `<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(30,27,75,.55),rgba(30,27,75,.15) 70%,rgba(30,27,75,0))"></div>${cloudTrio("rgba(148,163,184,.8)")}${rainStreaks(
      "165,180,252",
      STORM_STREAK_OFFSETS,
    )}<div style="position:absolute;inset:0;background:radial-gradient(80% 60% at 40% 0%,rgba(237,233,254,.6),rgba(237,233,254,0) 70%);animation:czFlash 6s linear infinite"></div><div style="position:absolute;inset:0;background:radial-gradient(70% 60% at 75% 10%,rgba(237,233,254,.5),rgba(237,233,254,0) 70%);animation:czFlash 6s 3.1s linear infinite"></div><svg viewBox="0 0 22 44" width="22" height="44" style="position:absolute;left:30%;top:40px;animation:czFlash 6s linear infinite"><path d="M13 0 L2 24 L10 24 L6 44 L21 16 L13 16 Z" fill="#FDE68A"></path></svg><svg viewBox="0 0 22 44" width="16" height="32" style="position:absolute;left:70%;top:70px;animation:czFlash 6s 3.1s linear infinite"><path d="M13 0 L2 24 L10 24 L6 44 L21 16 L13 16 Z" fill="#FDE68A"></path></svg>`;
  }
  if (kind === "snow") {
    return `<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(226,232,240,.2),rgba(226,232,240,0) 85%)"></div>${cloudTrio("rgba(241,245,249,.85)")}`;
  }
  return ""; // moon: no extra weather-sky wash, the night layer already carries it.
}

/** The meta row's weather-light icon, one per kind -- exact SVGs from the header spec. */
function weatherIconHtml(kind, moonColor) {
  if (kind === "sun") {
    return `<svg width="22" height="22" viewBox="0 0 24 22" style="position:relative;overflow:visible"><g stroke="#FDE68A" stroke-width="1.6" stroke-linecap="round" style="animation:czSpin 24s linear infinite;transform-box:fill-box;transform-origin:50% 50%"><path d="M12 1v3M12 18v3M2 11h3M19 11h3M4.9 3.9l2.1 2.1M17 16l2.1 2.1M4.9 18.1l2.1-2.1M17 6l2.1-2.1"></path></g><circle cx="12" cy="11" r="5.5" fill="#FDE68A"></circle></svg>`;
  }
  if (kind === "moon") {
    return `<svg width="22" height="22" viewBox="0 0 24 22" style="position:relative"><path d="M15 2 A9 9 0 1 0 21 16 A7.5 7.5 0 1 1 15 2 Z" fill="${moonColor}"></path><circle cx="9" cy="9" r="1.4" fill="rgba(0,0,0,.1)"></circle><circle cx="12" cy="15" r="1" fill="rgba(0,0,0,.1)"></circle></svg>`;
  }
  if (kind === "cloud") {
    return `<svg width="26" height="22" viewBox="0 0 28 22" style="position:relative"><path d="M8 20 C 3 20 2 14 7 13 C 7 7 15 5 18 10 C 23 7 28 12 25 16 C 28 17 26 20 22 20 Z" fill="rgba(226,232,240,.85)"></path></svg>`;
  }
  if (kind === "rain") {
    return `<svg width="26" height="26" viewBox="0 0 28 28" style="position:relative;overflow:visible"><path d="M8 20 C 3 20 2 14 7 13 C 7 7 15 5 18 10 C 23 7 28 12 25 16 C 28 17 26 20 22 20 Z" fill="rgba(203,213,225,.85)"></path><path d="M9 21v3M14 22v3M19 21v3" stroke="#93C5FD" stroke-width="1.6" stroke-linecap="round" style="animation:czRain .9s linear infinite"></path></svg>`;
  }
  if (kind === "storm") {
    return `<svg width="26" height="28" viewBox="0 0 28 30" style="position:relative;overflow:visible"><path d="M8 20 C 3 20 2 14 7 13 C 7 7 15 5 18 10 C 23 7 28 12 25 16 C 28 17 26 20 22 20 Z" fill="rgba(148,163,184,.9)"></path><path d="M8 21v3M20 22v3" stroke="#93C5FD" stroke-width="1.6" stroke-linecap="round" style="animation:czRain .9s linear infinite"></path><path d="M15 14 L11 22 L14 22 L13 29 L18 19 L15 19 Z" fill="#FDE68A" style="animation:czFlash 5s linear infinite"></path></svg>`;
  }
  return `<svg width="26" height="26" viewBox="0 0 28 28" style="position:relative;overflow:visible"><path d="M8 20 C 3 20 2 14 7 13 C 7 7 15 5 18 10 C 23 7 28 12 25 16 C 28 17 26 20 22 20 Z" fill="rgba(241,245,249,.9)"></path><g fill="#F8FAFC" style="animation:czRain 1.8s linear infinite"><circle cx="9" cy="22" r="1.3"></circle><circle cx="14" cy="23" r="1.3"></circle><circle cx="19" cy="22" r="1.3"></circle></g></svg>`; // snow
}

/** The full-phone weather-particle layer (Git #3145, README "Seasons and holidays -- Weather
 *  particles"): leaves/snow/confetti/bats/fireworks/petals/fireflies/sleigh, gated by the
 *  season/holiday theme's own flags -- not by live weather (that's weatherSkyHtml above, a
 *  separate system). Real shapes/colors/counts/timings ported verbatim from the First Slice
 *  Prototype; nothing here is approximated. Symbols (dk-leaf, dk-petal, dk-bat, dk-burst,
 *  dk-sleigh) live in critters-sprite.svg alongside the rest of the critter roster. */
function weatherParticlesHtml(theme) {
  let html = "";
  if (theme.wLeaves) {
    html +=
      '<svg width="14" height="14" viewBox="0 0 12 12" fill="#F97316" style="position:absolute;left:8%;top:-20px;animation:czLeaf 11s linear infinite"><use href="#dk-leaf"></use></svg><svg width="12" height="12" viewBox="0 0 12 12" fill="#FBBF24" style="position:absolute;left:20%;top:-20px;animation:czLeaf 12s 2s linear infinite"><use href="#dk-leaf"></use></svg><svg width="14" height="14" viewBox="0 0 12 12" fill="#EF4444" style="position:absolute;left:33%;top:-20px;animation:czLeaf 10s 4s linear infinite"><use href="#dk-leaf"></use></svg><svg width="11" height="11" viewBox="0 0 12 12" fill="#F59E0B" style="position:absolute;left:47%;top:-20px;animation:czLeaf 13s 1s linear infinite"><use href="#dk-leaf"></use></svg><svg width="14" height="14" viewBox="0 0 12 12" fill="#F97316" style="position:absolute;left:60%;top:-20px;animation:czLeaf 9.5s 6s linear infinite"><use href="#dk-leaf"></use></svg><svg width="12" height="12" viewBox="0 0 12 12" fill="#FB923C" style="position:absolute;left:72%;top:-20px;animation:czLeaf 12.5s 3s linear infinite"><use href="#dk-leaf"></use></svg><svg width="13" height="13" viewBox="0 0 12 12" fill="#EF4444" style="position:absolute;left:85%;top:-20px;animation:czLeaf 11.5s 7s linear infinite"><use href="#dk-leaf"></use></svg><svg width="11" height="11" viewBox="0 0 12 12" fill="#FBBF24" style="position:absolute;left:94%;top:-20px;animation:czLeaf 10.5s 5s linear infinite"><use href="#dk-leaf"></use></svg>';
  }
  if (theme.wSnow) {
    html +=
      '<div style="position:absolute;left:5%;top:-8px;width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,.85);animation:czSnow 12s linear infinite"></div><div style="position:absolute;left:12%;top:-8px;width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.8);animation:czSnow 15s 3s linear infinite"></div><div style="position:absolute;left:20%;top:-8px;width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.9);animation:czSnow 10s 6s linear infinite"></div><div style="position:absolute;left:28%;top:-8px;width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.75);animation:czSnow 14s 1s linear infinite"></div><div style="position:absolute;left:36%;top:-8px;width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,.85);animation:czSnow 11s 8s linear infinite"></div><div style="position:absolute;left:44%;top:-8px;width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.8);animation:czSnow 16s 4s linear infinite"></div><div style="position:absolute;left:52%;top:-8px;width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.9);animation:czSnow 9.5s 2s linear infinite"></div><div style="position:absolute;left:60%;top:-8px;width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.75);animation:czSnow 13s 9s linear infinite"></div><div style="position:absolute;left:68%;top:-8px;width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,.85);animation:czSnow 12.5s 5s linear infinite"></div><div style="position:absolute;left:76%;top:-8px;width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.8);animation:czSnow 15.5s 7s linear infinite"></div><div style="position:absolute;left:84%;top:-8px;width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.9);animation:czSnow 10.5s 11s linear infinite"></div><div style="position:absolute;left:91%;top:-8px;width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.75);animation:czSnow 14.5s 2.5s linear infinite"></div><div style="position:absolute;left:97%;top:-8px;width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,.85);animation:czSnow 11.5s 6.5s linear infinite"></div><div style="position:absolute;left:40%;top:-8px;width:2px;height:2px;border-radius:50%;background:rgba(255,255,255,.7);animation:czSnow 17s 10s linear infinite"></div>';
  }
  if (theme.wConfetti) {
    html +=
      '<div style="position:absolute;left:6%;top:-10px;width:7px;height:3px;background:#F472B6;animation:czConf 6s linear infinite"></div><div style="position:absolute;left:14%;top:-10px;width:6px;height:3px;background:#FDE68A;animation:czConf 7s 1.5s linear infinite"></div><div style="position:absolute;left:23%;top:-10px;width:7px;height:3px;background:#60A5FA;animation:czConf 5.5s 3s linear infinite"></div><div style="position:absolute;left:31%;top:-10px;width:5px;height:5px;border-radius:50%;background:#4ADE80;animation:czConf 8s .5s linear infinite"></div><div style="position:absolute;left:40%;top:-10px;width:7px;height:3px;background:#F472B6;animation:czConf 6.5s 4s linear infinite"></div><div style="position:absolute;left:48%;top:-10px;width:6px;height:3px;background:#FDE68A;animation:czConf 5s 2s linear infinite"></div><div style="position:absolute;left:56%;top:-10px;width:5px;height:5px;border-radius:50%;background:#F87171;animation:czConf 7.5s 5s linear infinite"></div><div style="position:absolute;left:64%;top:-10px;width:7px;height:3px;background:#60A5FA;animation:czConf 6s 1s linear infinite"></div><div style="position:absolute;left:72%;top:-10px;width:6px;height:3px;background:#4ADE80;animation:czConf 5.5s 3.5s linear infinite"></div><div style="position:absolute;left:80%;top:-10px;width:7px;height:3px;background:#F472B6;animation:czConf 8s 2.5s linear infinite"></div><div style="position:absolute;left:88%;top:-10px;width:5px;height:5px;border-radius:50%;background:#FDE68A;animation:czConf 6.5s 6s linear infinite"></div><div style="position:absolute;left:95%;top:-10px;width:7px;height:3px;background:#60A5FA;animation:czConf 7s 4.5s linear infinite"></div><div style="position:absolute;left:36%;top:-10px;width:6px;height:3px;background:#F87171;animation:czConf 5s 7s linear infinite"></div><div style="position:absolute;left:68%;top:-10px;width:5px;height:5px;border-radius:50%;background:#F472B6;animation:czConf 6s 8s linear infinite"></div>';
  }
  if (theme.wBats) {
    html +=
      '<svg width="34" height="16" viewBox="0 0 34 16" style="position:absolute;left:-40px;top:74px;overflow:visible;animation:czBat 14s linear infinite"><use href="#dk-bat"></use></svg><svg width="26" height="12" viewBox="0 0 34 16" style="position:absolute;left:-40px;top:112px;overflow:visible;animation:czBat 18s 5s linear infinite"><use href="#dk-bat"></use></svg><svg width="30" height="14" viewBox="0 0 34 16" style="position:absolute;left:-40px;top:44px;overflow:visible;animation:czBat 16s 9s linear infinite"><use href="#dk-bat"></use></svg>';
  }
  if (theme.wSleigh) {
    html +=
      '<svg width="150" height="44" viewBox="0 0 150 44" style="position:absolute;left:0;top:62px;overflow:visible;animation:czSleigh 24s linear infinite"><use href="#dk-sleigh"></use></svg>';
  }
  if (theme.wFireworks) {
    html +=
      '<svg width="60" height="60" viewBox="0 0 60 60" style="position:absolute;left:14%;top:30px;color:#F472B6;animation:czBurst 3.2s ease-out infinite"><use href="#dk-burst"></use></svg><svg width="50" height="50" viewBox="0 0 60 60" style="position:absolute;left:60%;top:16px;color:#FDE68A;animation:czBurst 3.6s 1.1s ease-out infinite"><use href="#dk-burst"></use></svg><svg width="44" height="44" viewBox="0 0 60 60" style="position:absolute;left:38%;top:72px;color:#60A5FA;animation:czBurst 3s 2.2s ease-out infinite"><use href="#dk-burst"></use></svg><svg width="54" height="54" viewBox="0 0 60 60" style="position:absolute;left:78%;top:58px;color:#4ADE80;animation:czBurst 3.4s .6s ease-out infinite"><use href="#dk-burst"></use></svg>';
  }
  if (theme.wPetals) {
    html +=
      '<svg width="11" height="11" viewBox="0 0 10 10" fill="#F9A8D4" style="position:absolute;left:8%;top:-16px;animation:czPetal 13s linear infinite"><use href="#dk-petal"></use></svg><svg width="9" height="9" viewBox="0 0 10 10" fill="#FBCFE8" style="position:absolute;left:21%;top:-16px;animation:czPetal 15s 3s linear infinite"><use href="#dk-petal"></use></svg><svg width="11" height="11" viewBox="0 0 10 10" fill="#FDF2F8" style="position:absolute;left:35%;top:-16px;animation:czPetal 12s 6s linear infinite"><use href="#dk-petal"></use></svg><svg width="10" height="10" viewBox="0 0 10 10" fill="#F9A8D4" style="position:absolute;left:49%;top:-16px;animation:czPetal 16s 1s linear infinite"><use href="#dk-petal"></use></svg><svg width="9" height="9" viewBox="0 0 10 10" fill="#FBCFE8" style="position:absolute;left:62%;top:-16px;animation:czPetal 14s 8s linear infinite"><use href="#dk-petal"></use></svg><svg width="11" height="11" viewBox="0 0 10 10" fill="#F9A8D4" style="position:absolute;left:75%;top:-16px;animation:czPetal 13.5s 4s linear infinite"><use href="#dk-petal"></use></svg><svg width="9" height="9" viewBox="0 0 10 10" fill="#FDF2F8" style="position:absolute;left:88%;top:-16px;animation:czPetal 15.5s 10s linear infinite"><use href="#dk-petal"></use></svg><svg width="10" height="10" viewBox="0 0 10 10" fill="#FBCFE8" style="position:absolute;left:95%;top:-16px;animation:czPetal 12.5s 2s linear infinite"><use href="#dk-petal"></use></svg>';
  }
  if (theme.wFireflies) {
    html +=
      '<div style="position:absolute;left:10%;top:120px;width:4px;height:4px;border-radius:50%;background:#FDE68A;box-shadow:0 0 6px 2px rgba(253,224,71,.6);animation:czFirefly 4s ease-in-out infinite"></div><div style="position:absolute;left:24%;top:200px;width:3px;height:3px;border-radius:50%;background:#FDE68A;box-shadow:0 0 6px 2px rgba(253,224,71,.6);animation:czFirefly 5s 1s ease-in-out infinite"></div><div style="position:absolute;left:40%;top:90px;width:4px;height:4px;border-radius:50%;background:#FDE68A;box-shadow:0 0 6px 2px rgba(253,224,71,.6);animation:czFirefly 4.5s 2s ease-in-out infinite"></div><div style="position:absolute;left:56%;top:250px;width:3px;height:3px;border-radius:50%;background:#FDE68A;box-shadow:0 0 6px 2px rgba(253,224,71,.6);animation:czFirefly 5.5s .5s ease-in-out infinite"></div><div style="position:absolute;left:70%;top:150px;width:4px;height:4px;border-radius:50%;background:#FDE68A;box-shadow:0 0 6px 2px rgba(253,224,71,.6);animation:czFirefly 4.2s 3s ease-in-out infinite"></div><div style="position:absolute;left:84%;top:320px;width:3px;height:3px;border-radius:50%;background:#FDE68A;box-shadow:0 0 6px 2px rgba(253,224,71,.6);animation:czFirefly 6s 1.5s ease-in-out infinite"></div><div style="position:absolute;left:32%;top:330px;width:4px;height:4px;border-radius:50%;background:#FDE68A;box-shadow:0 0 6px 2px rgba(253,224,71,.6);animation:czFirefly 5s 2.5s ease-in-out infinite"></div><div style="position:absolute;left:90%;top:70px;width:3px;height:3px;border-radius:50%;background:#FDE68A;box-shadow:0 0 6px 2px rgba(253,224,71,.6);animation:czFirefly 4.8s 3.5s ease-in-out infinite"></div>';
  }
  return html;
}

/** Builds the whole sky+night+weather+meta+fox header for the Today tray, one framed region
 *  at the top of the room ("Today v3 -- Header"). `now` is the device's real current time
 *  (drives the hour-based sky phase -- never overridden, exactly like the prototype's own
 *  `hour`); `dateNow` is the (possibly `?today=`-overridden) calendar date shown in the meta
 *  row and fed to `themeFor()` -- see theme.js. `wx` is a real `{kind, tempF, text}` from
 *  weather.js (live or the spec's own until-it-answers sample). `theme` is `themeFor(dateNow)`
 *  (Git #3145): a holiday sky wins over time-of-day, the moon glow/color goes orange during
 *  Halloween/birthday week, and the fox gets its holiday hat. `whereText`/`whereColor` stay
 *  real, not fabricated: no location feed exists yet (see build-journal/3144.md), so this only
 *  ever shows the one state that's actually true, "Home", never the design's "· from location"
 *  qualifier that would claim a signal we don't have. */
function renderTodayHeader(now, dateNow, wx, foxLine, theme) {
  const hour = now.getHours();
  const phase = skyPhase(hour);
  const isNight = phase === "night";
  const orangeMoon = theme.orangeMoon && wx.kind === "moon";
  const scene = el("div", { class: "today-scene" }, [
    el("div", { class: "today-sky", style: `background:${theme.thSky || SKY_GRADIENT[phase]}` }),
    isNight ? el("div", { class: "today-night", html: NIGHT_LAYER_HTML }) : null,
    el("div", { class: "today-wx-sky", html: weatherSkyHtml(wx.kind) }),
  ]);

  const meta = el("div", { class: "today-meta" }, [
    el("span", { class: "today-meta-date" }, [
      el("span", { class: "today-date-text", text: `${WDN[dateNow.getDay()]}, ${MONN[dateNow.getMonth()]} ${dateNow.getDate()}` }),
      el("span", { text: "·" }),
      el("span", { class: "today-where" }, [
        el("span", {
          html:
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle></svg>',
        }),
        el("span", { text: "Home" }),
      ]),
    ]),
    el("span", { class: "today-wx-light" }, [
      el("span", { class: "today-wx-glow", style: `background:radial-gradient(ellipse at center,${orangeMoon ? "rgba(253,186,116,.42)" : WX_GLOW[wx.kind] || WX_GLOW.cloud},rgba(0,0,0,0) 72%)` }),
      wx.kind === "storm" ? el("span", { class: "today-wx-glow today-wx-glow-flash" }) : null,
      el("span", { class: "today-wx-text", text: wx.text }),
      el("span", { class: "today-wx-icon", html: weatherIconHtml(wx.kind, orangeMoon ? "#FDBA74" : "#F8FAFC") }),
    ]),
  ]);

  const fox = el("div", { class: "today-fox-row" }, [
    el("div", { class: "today-fox-pebble" }, [
      el("span", { html: '<svg width="64" height="64" viewBox="0 0 120 120" style="display:block;animation:czBreathe 4s ease-in-out infinite;transform-origin:50% 100%"><use href="#c-fox"></use></svg>' }),
      theme.hatOn ? el("span", { html: `<svg width="64" height="87.5" viewBox="0 -44 120 164" class="today-fox-hat"><use href="#${theme.hat}"></use></svg>` }) : null,
    ]),
    el("div", { class: "today-fox-bubble", text: foxLine }),
  ]);

  scene.append(el("div", { class: "today-scene-content" }, [meta, fox]));
  if (theme.wLeaves || theme.wSnow || theme.wConfetti || theme.wBats || theme.wFireworks || theme.wPetals || theme.wFireflies || theme.wSleigh) {
    scene.appendChild(el("div", { class: "today-wx-particles", html: weatherParticlesHtml(theme) }));
  }
  return scene;
}

/** $1.79, from integer cents -- the whole schema stores money as price_cents (Git #3112). */
function money(cents) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

/** "$1,230.22" / "-$5,239.69" from a real DOLLAR amount (not cents) -- the shape money.mjs's own
 *  routes return (`toDollars()`), for the Money "Now" tab (Git #3147). Distinct from money()
 *  above because that one takes integer cents; this one does not, and mixing them up silently
 *  divides a real balance by 100. null/undefined (an unknown balance, never "$0") renders as
 *  an em dash, matching money.mjs's own null-means-unknown convention. */
function dollars(amount) {
  if (amount === null || amount === undefined) return "—";
  const negative = amount < 0;
  const abs = Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${negative ? "-" : ""}$${abs}`;
}

/** A plain `date` column (YYYY-MM-DD), not a timestamp -- `when()` above is for the latter. */
function whenDate(isoDate) {
  if (!isoDate) return "";
  // observed_on is a plain SQL `date` column, but pg's driver parses it into a JS Date and
  // the API layer serializes that as a full ISO timestamp (e.g. "2026-09-07T04:00:00.000Z"),
  // not the bare "YYYY-MM-DD" this used to assume. Strip any time/zone portion before
  // reconstructing a local-midnight date so both shapes parse correctly (Git #3133).
  const datePart = String(isoDate).slice(0, 10);
  const d = new Date(`${datePart}T00:00:00`);
  const diffDays = Math.round((d - new Date(new Date().toDateString())) / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === -1) return "yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** "Mar 2020" -- month + year, no day (Git #3193: a pet's "born" line, distinct from whenDate's
 *  day-level format since a birthdate that old is never "3 days ago"). */
function monthYear(isoDate) {
  if (!isoDate) return null;
  const d = new Date(`${String(isoDate).slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString([], { month: "short", year: "numeric" });
}

/** Real full years since a birthdate (Git #3193, design contract Section 6 / README "Screens"
 *  #10: a pet card's "species · breed · age"). Same has-the-birthday-happened-yet math as any
 *  real age calculation -- a bare year subtraction over-counts until the birthday passes. */
function ageYears(bornISO) {
  if (!bornISO) return null;
  const born = new Date(`${String(bornISO).slice(0, 10)}T00:00:00`);
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const hadBirthdayThisYear = now.getMonth() > born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() >= born.getDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

async function loadMe() {
  const me = await api("/api/me");
  state.user = me.user;
  if (me.user) {
    // Critter daily roll (Git #3119) -- seeded from the SERVER's date, per the design handoff,
    // never the client clock, so every device rolls the same critter for a slot on a given day.
    if (me.serverDate) initCritters(me.serverDate);
  }
  return me.user;
}

// ---------------------------------------------------------------------------
// passkeys (WebAuthn)
//
// Design handoff, "Auth and sharing": passkeys for the app, no password screen. The browser
// speaks ArrayBuffers and the server speaks base64url, so these two helpers are the whole
// translation layer.
// ---------------------------------------------------------------------------

const b64urlToBytes = (str) => {
  const padded = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};

const bytesToB64url = (buf) => {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const passkeysAvailable = () =>
  typeof PublicKeyCredential !== "undefined" && Boolean(navigator.credentials);

/** A real sign-in: fetch a challenge, get an assertion, hand it back for verification. */
async function signInWithPasskey() {
  const options = await api("/api/auth/passkey/options", { method: "POST", body: "{}" });
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: b64urlToBytes(options.challenge),
      rpId: options.rpId,
      timeout: options.timeout,
      userVerification: options.userVerification,
      // No allowCredentials on purpose: the passkey is discoverable, so the authenticator
      // resolves the account itself. That is what lets this screen have no email field.
    },
  });
  if (!assertion) throw new Error("No passkey was chosen.");
  await api("/api/auth/passkey/verify", {
    method: "POST",
    body: JSON.stringify({
      challenge: options.challenge,
      id: assertion.id,
      response: {
        clientDataJSON: bytesToB64url(assertion.response.clientDataJSON),
        authenticatorData: bytesToB64url(assertion.response.authenticatorData),
        signature: bytesToB64url(assertion.response.signature),
        userHandle: assertion.response.userHandle ? bytesToB64url(assertion.response.userHandle) : null,
      },
    }),
  });
}

/** Register a passkey — from a single-use enrolment link, or from an already-signed-in session. */
async function createPasskey({ token = null, label = null } = {}) {
  const options = await api("/api/auth/enroll/options", {
    method: "POST",
    body: JSON.stringify({ token, label }),
  });
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: b64urlToBytes(options.challenge),
      rp: options.rp,
      user: {
        id: b64urlToBytes(options.user.id),
        name: options.user.name,
        displayName: options.user.displayName,
      },
      pubKeyCredParams: options.pubKeyCredParams,
      timeout: options.timeout,
      attestation: options.attestation,
      authenticatorSelection: options.authenticatorSelection,
      excludeCredentials: (options.excludeCredentials || []).map((c) => ({
        type: c.type,
        id: b64urlToBytes(c.id),
        transports: c.transports,
      })),
    },
  });
  if (!credential) throw new Error("No passkey was created.");
  return api("/api/auth/enroll/verify", {
    method: "POST",
    body: JSON.stringify({
      token,
      label,
      challenge: options.challenge,
      response: {
        clientDataJSON: bytesToB64url(credential.response.clientDataJSON),
        attestationObject: bytesToB64url(credential.response.attestationObject),
        transports: credential.response.getTransports ? credential.response.getTransports() : [],
      },
    }),
  });
}

/**
 * Run one real assertion against server-issued options, and shape the result into the body the
 * verifying endpoint expects. Shared by the two callers that need a fresh proof inside a live
 * session — the generic re-verify below, and the vault's per-entry reveal (Git #3150), which
 * uses its own challenge rather than this one's.
 */
async function passkeyAssertion(options) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: b64urlToBytes(options.challenge),
      rpId: options.rpId,
      timeout: options.timeout,
      userVerification: options.userVerification,
      allowCredentials: (options.allowCredentials || []).map((c) => ({
        type: c.type,
        id: b64urlToBytes(c.id),
        transports: c.transports,
      })),
    },
  });
  if (!assertion) throw new Error("No passkey was chosen.");
  return {
    challenge: options.challenge,
    id: assertion.id,
    response: {
      clientDataJSON: bytesToB64url(assertion.response.clientDataJSON),
      authenticatorData: bytesToB64url(assertion.response.authenticatorData),
      signature: bytesToB64url(assertion.response.signature),
    },
  };
}

/**
 * A fresh assertion inside a live session — what the vault reveal requires. Exported on the
 * module scope so the Money Feature can call it without reimplementing the dance.
 */
async function reverifyWithPasskey() {
  const options = await api("/api/auth/reverify/options", { method: "POST", body: "{}" });
  return api("/api/auth/reverify", {
    method: "POST",
    body: JSON.stringify(await passkeyAssertion(options)),
  });
}
window.shanesLife = { reverifyWithPasskey };

function authError(id, err) {
  const box = $(id);
  // A cancelled Face ID prompt is not a failure worth shouting about; everything else is real.
  if (err && (err.name === "NotAllowedError" || err.name === "AbortError")) {
    box.hidden = true;
    return;
  }
  box.textContent = err?.message || "That did not work.";
  box.hidden = false;
}

async function runAuthAction(button, errorId, action) {
  const error = $(errorId);
  error.hidden = true;
  button.disabled = true;
  try {
    await action();
  } catch (err) {
    authError(errorId, err);
  } finally {
    button.disabled = false;
  }
}

$("#passkey-signin").addEventListener("click", (event) =>
  runAuthAction(event.currentTarget, "#login-error", async () => {
    await signInWithPasskey();
    await start();
  }),
);

// The design's second control. The browser owns the cross-device picker (the QR / hybrid flow),
// so this is the same assertion call — what differs is that it never tries the platform
// authenticator silently first.
$("#passkey-signin-other").addEventListener("click", (event) =>
  runAuthAction(event.currentTarget, "#login-error", async () => {
    await signInWithPasskey();
    await start();
  }),
);

$("#passkey-enroll").addEventListener("click", (event) =>
  runAuthAction(event.currentTarget, "#enroll-error", async () => {
    const token = enrollmentTokenFromUrl();
    if (!token) throw new Error("This enrolment link is incomplete. Mint a new one.");
    await createPasskey({ token });
    // The token is single-use and already spent; get it out of the address bar.
    history.replaceState(null, "", location.pathname + location.search);
    await start();
  }),
);

$("#sign-out").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  state.user = null;
  showLogin();
});

/** The enrolment token rides in the fragment, so it never reaches the server in a request line. */
function enrollmentTokenFromUrl() {
  const match = /(?:^#|[#&])enroll=([^&]+)/.exec(location.hash || "");
  return match ? decodeURIComponent(match[1]) : null;
}

function showLogin() {
  $("#app-view").hidden = true;
  $("#enroll-view").hidden = true;
  $("#login-view").hidden = false;

  // Screen 1 has two drawings: "Continue with Face ID" on the phone, "Continue with passkey" on
  // the desktop. Same button, and the platform decides which copy is true.
  const onApple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  $("#passkey-signin-label").textContent = onApple ? "Continue with Face ID" : "Continue with passkey";

  if (!passkeysAvailable()) {
    const error = $("#login-error");
    error.textContent = "This browser cannot use passkeys, and this app has no password to fall back on.";
    error.hidden = false;
    $("#passkey-signin").disabled = true;
    $("#passkey-signin-other").disabled = true;
  }
}

function showEnroll() {
  $("#app-view").hidden = true;
  $("#login-view").hidden = true;
  $("#enroll-view").hidden = false;
  if (!passkeysAvailable()) {
    const error = $("#enroll-error");
    error.textContent = "This browser cannot create passkeys. Open this link on a device that can.";
    error.hidden = false;
    $("#passkey-enroll").disabled = true;
  }
}

// ---------------------------------------------------------------------------
// the universal capture box
// ---------------------------------------------------------------------------

const captureText = $("#capture-text");
const captureStatus = $("#capture-status");
const captureSend = $("#capture-send");

// Git #3275: 5 lines at 15px/1.35 line-height + the textarea's own 10px*2 vertical padding --
// kept in sync with app.css's `.capture textarea { max-height: 122px }`.
const CAPTURE_TEXTAREA_MAX_HEIGHT = 122;
// `field-sizing: content` (app.css) auto-grows the textarea itself where supported; this is
// only the JS fallback README's own "Real auto-grow" bullet calls for on browsers without it.
const SUPPORTS_FIELD_SIZING = typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content");

function updateCaptureSendState() {
  captureSend.classList.toggle("has-text", !!(captureText.value.trim() || state.attachment));
}

captureText.addEventListener("input", () => {
  if (!SUPPORTS_FIELD_SIZING) {
    captureText.style.height = "auto";
    captureText.style.height = Math.min(captureText.scrollHeight, CAPTURE_TEXTAREA_MAX_HEIGHT) + "px";
  }
  updateCaptureSendState();
});

// Enter inserts a newline (the textarea's own default behavior -- this used to preventDefault
// and submit on a bare Enter, which is exactly the friction README's "Capture bar redrawn"
// pass calls out). Only Send or ⌘/Ctrl+Enter submits.
captureText.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing) {
    event.preventDefault();
    $("#capture").requestSubmit();
  }
});

function setAttachment(attachment) {
  state.attachment = attachment;
  $("#capture-attachment").hidden = !attachment;
  if (attachment) $("#capture-attachment-label").textContent = attachment.label;
  updateCaptureSendState();
}

$("#capture-attachment-clear").addEventListener("click", () => setAttachment(null));

async function uploadBlob(blob, name) {
  const media = await api("/api/media", {
    method: "POST",
    body: blob,
    headers: { "content-type": blob.type || "application/octet-stream", "x-file-name": name || "" },
  });
  return media;
}

$("#capture-photo").addEventListener("click", () => $("#capture-file").click());

$("#capture-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  captureStatus.textContent = "Attaching photo…";
  try {
    const media = await uploadBlob(file, file.name);
    setAttachment({ mediaId: media.id, kind: "photo", label: `Photo attached (${Math.round(media.byte_size / 1024)} KB)` });
    captureStatus.textContent = "";
  } catch (err) {
    captureStatus.textContent = err.message;
  }
});

let recorder = null;
let recordedChunks = [];

$("#capture-voice").addEventListener("click", async () => {
  const button = $("#capture-voice");
  if (recorder && recorder.state === "recording") {
    recorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    captureStatus.textContent = "This browser cannot record audio. Type it or attach a photo instead.";
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size > 0 && recordedChunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      button.setAttribute("aria-pressed", "false");
      const blob = new Blob(recordedChunks, { type: recorder.mimeType || "audio/webm" });
      captureStatus.textContent = "Saving voice note…";
      try {
        const media = await uploadBlob(blob, "voice-note");
        setAttachment({ mediaId: media.id, kind: "voice", label: `Voice note attached (${Math.round(media.byte_size / 1024)} KB)` });
        captureStatus.textContent = "";
      } catch (err) {
        captureStatus.textContent = err.message;
      }
    };
    recorder.start();
    button.setAttribute("aria-pressed", "true");
    captureStatus.textContent = "Recording — tap the mic again to stop.";
  } catch (err) {
    captureStatus.textContent = `Microphone unavailable: ${err.message}`;
  }
});

$("#capture").addEventListener("submit", async (event) => {
  event.preventDefault();
  // Git #3275: a multi-line capture (the textarea now auto-grows to 5 lines instead of
  // submitting on Enter) is filed ONE LINE AT A TIME, each through the normal capture
  // grammar independently, then a single "N lines, each filed on its own" toast.
  const lines = captureText.value.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length && !state.attachment) return;
  const send = captureSend;
  send.disabled = true;
  captureStatus.textContent = "Saving…";
  try {
    // Git #3178: Shopping's own real dispatch, extracted verbatim from the design's
    // submitCapture(door) -- the SAME single capture box, in Shopping, adds plain text straight
    // to the run and saves a stated "<item> aisle <n> <note>" directly onto that item's aisle
    // memory, rather than the generic /api/captures triage a bare statement gets everywhere
    // else (which only ever surfaces on Inbox/Today, not live in the room that said it).
    if (state.route === "shopping" && lines.length && !state.attachment) {
      for (const line of lines) await submitShoppingCapture(line);
      captureText.value = "";
      captureText.style.height = "auto";
      updateCaptureSendState();
      if (lines.length > 1) {
        captureStatus.textContent = `${lines.length} lines, each filed on its own.`;
        setTimeout(() => (captureStatus.textContent = ""), 1800);
      } else {
        captureStatus.textContent = "";
      }
      return;
    }

    // Real current position, if the browser already has it (or is willing to ask, natively --
    // never an in-app form). Git #3159: this is what lets "remember this as Home" carry real
    // coordinates without a dedicated location field anywhere in this UI.
    const position = await getRealPosition();
    const linesToFile = lines.length ? lines : [""];
    for (let i = 0; i < linesToFile.length; i++) {
      // The attachment (if any) rides only on the first line -- a multi-line capture with a
      // photo/voice note attached shouldn't re-attach the same media to every filed line.
      await api("/api/captures", {
        method: "POST",
        body: JSON.stringify({
          text: linesToFile[i] || null,
          mediaId: i === 0 ? state.attachment?.mediaId ?? null : null,
          kind: i === 0 ? state.attachment?.kind || "text" : "text",
          latitude: position?.latitude ?? null,
          longitude: position?.longitude ?? null,
        }),
      });
    }
    captureText.value = "";
    captureText.style.height = "auto";
    setAttachment(null);
    // Trust stated facts immediately (Section 8) -- it is saved, no confirmation dialog.
    captureStatus.textContent = lines.length > 1 ? `${lines.length} lines, each filed on its own.` : "Got it.";
    setTimeout(() => (captureStatus.textContent = ""), 1800);
    await loadMe();
    if (state.route === "inbox" || state.route === "today") render();
  } catch (err) {
    captureStatus.textContent = err.message;
  } finally {
    send.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------

/** A brief, self-dismissing note -- design handoff's own "Directions" tap target ("Hands off
 *  to Maps when this is real... leave by about 40 minutes before"). No real toast/Undo overlay
 *  exists yet (README's own "Toast with Undo" is a separate, unbuilt overlay), so this is a
 *  small, real, self-contained stand-in rather than wiring a fake Maps handoff. */
function showQuickToast(message) {
  const node = el("div", { class: "quick-toast", text: message });
  document.body.append(node);
  setTimeout(() => node.remove(), 3500);
}

/** One pill-shaped Badge-style sticker, rotated -5deg per the cute-skin spec. `tone` picks the
 *  tint from the same accent palette the rest of the app already uses (README "Design tokens").
 *  `slate` (Git #3192) is Dates' own on-the-fly-kind fallback color (kindTint's `#94a3b8`),
 *  reused here rather than inventing a fifth tone. */
const STICKER_TONE = { blue: "96,165,250", indigo: "165,180,252", amber: "251,191,36", red: "248,113,113", green: "52,211,153", slate: "148,163,184" };
function sticker(tone, text) {
  return el("span", { class: "sticker", style: `background:rgba(${STICKER_TONE[tone]},.16);color:rgb(${STICKER_TONE[tone]})`, text });
}

function pillButton(tag, props, text, variant = "primary") {
  return el(tag, { ...props, class: `btn-pill ${variant}` }, [document.createTextNode(text)]);
}

/** The Next card: blob pebble (56px critter in a 64px tinted pebble), title + rotated sticker,
 *  a muted line, then two pill buttons -- design handoff "Next (one card, chosen by rule)".
 *  `variant` carries the pebble tint, critter slot, optional location-style border, title,
 *  sticker (tone+text or null), line text and its two buttons (or none, for "nothing next"). */
function nextCardV3({ pebbleBg, border, critterSlot, title, stickerEl, line, buttons }) {
  const head = el("div", { class: "next-head" }, [
    el("div", { class: "next-pebble", style: `background:${pebbleBg}` }, [critterIcon(critterSlot, { size: 56 })]),
    el("div", { class: "next-body" }, [
      el("div", { class: "next-title-row" }, [el("span", { class: "next-title", text: title }), stickerEl]),
      el("div", { class: "next-line", text: line }),
    ]),
  ]);
  const card = el("div", { class: "card next-card-v3", style: border ? `border-color:${border}` : "" }, [head]);
  if (buttons && buttons.length) card.append(el("div", { class: "pill-row" }, buttons));
  return card;
}

/** Real "one card, chosen by rule" pick order. Mirrors the design's own order: appointment
 *  today > real, location-observed "heading home" (Git #3216 -- server already withholds
 *  data.headingHome unless it's really away from a house AND Tesla's ready, and never sets it
 *  at all when an appointment's already showing, same real precedence the widget's own
 *  computeNextCard applies) > dinner window (16:00-21:00, meal not already finished) > open
 *  groceries > nothing. */
function resolveNextKind(data, hour) {
  if (data.appointmentToday) return "doctor";
  if (data.headingHome) return "headingHome";
  const mealDone = mealSession ? !!mealSession.done : false;
  if (hour >= 16 && hour < 21 && data.tonight && !mealDone) return "dinner";
  if (data.groceries && data.groceries.openCount > 0) return "home";
  if (data.next && data.next.length > 0) return "generic";
  return "none";
}

/** The fox's real matching line for whatever's actually in the Next card -- contract pack
 *  Section 1, Shane's own lines verbatim. "generic" (some other real due entity -- a bill
 *  reminder, a pet vaccine, etc.) isn't one of the five real cases that section spells out, so
 *  the fox stays at its opener alone rather than inventing unspec'd copy for it; the Next card
 *  itself still shows the real entity. */
function foxMatchLine(nextKind, data) {
  if (nextKind === "doctor") {
    const who = data.appointmentToday.provider || data.appointmentToday.title;
    const time = formatTime12(data.appointmentToday.atTime);
    return time ? `${who} at ${time} today. That's the one thing.` : `${who} today. That's the one thing.`;
  }
  if (nextKind === "headingHome") return `Heading to ${data.headingHome.recommendedLabel}? Send navigation and preconditioning now.`;
  if (nextKind === "dinner") return `Time to make dinner: ${data.tonight.dishText}.`;
  if (nextKind === "home") return "Groceries are ready for whenever you pass a store. Nothing pressing.";
  if (nextKind === "none") return "Nothing needs you. The day's yours.";
  return null;
}

function renderNextCardV3(data, nextKind) {
  if (nextKind === "doctor") {
    const appt = data.appointmentToday;
    const time = formatTime12(appt.atTime);
    return nextCardV3({
      pebbleBg: "rgba(96,165,250,.16)",
      border: "rgba(96,165,250,.45)",
      critterSlot: "comingup",
      title: appt.provider || appt.title,
      stickerEl: sticker("blue", time ? `Today · ${time}` : "Today"),
      line: appt.categoryLabel || (appt.kind === "vet" ? "Vet visit" : "Appointment"),
      buttons: [
        pillButton("a", { href: `#/date/${appt.id}` }, "Open the appointment", "primary"),
        pillButton(
          "button",
          {
            type: "button",
            onClick: () =>
              showQuickToast(`Directions -- leave by about 40 minutes before${time ? ` ${time}` : ""}.`),
          },
          "Directions",
          "ghost",
        ),
      ],
    });
  }
  if (nextKind === "dinner") {
    return nextCardV3({
      pebbleBg: "rgba(212,163,115,.18)",
      critterSlot: "dinner",
      title: "Dinner",
      stickerEl: sticker("amber", "Tonight"),
      line: `Tonight: ${data.tonight.dishText}`,
      buttons: [
        pillButton("a", { href: "#/tonight" }, "Start cooking", "primary"),
        pillButton("a", { href: "#/recipes" }, "Something else", "ghost"),
      ],
    });
  }
  if (nextKind === "headingHome") {
    const hh = data.headingHome;
    const alt = hh.alternatives[0]; // one real alternative is enough -- same real limit the widget's own card applies
    const sendHome = (house) => async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const result = await api("/api/tesla/heading-home", { method: "POST", body: JSON.stringify({ house }) });
        const navOk = result.navigation?.ok;
        const climateOk = result.climate?.ok;
        if (navOk && climateOk) showQuickToast(`Sent -- navigation + preconditioning to ${result.targetLabel}.`);
        else if (!navOk && !climateOk) showQuickToast("Tesla rejected both commands -- see Settings -> Tesla.");
        else showQuickToast(`${navOk ? "Navigation" : "Preconditioning"} sent, ${navOk ? "preconditioning" : "navigation"} was rejected -- see Settings -> Tesla.`);
        if (state.route === "today") render();
      } catch (err) {
        showQuickToast(err.message || "Couldn't reach Tesla.");
      } finally {
        btn.disabled = false;
      }
    };
    return nextCardV3({
      pebbleBg: "rgba(79,124,255,.16)",
      border: "rgba(79,124,255,.45)",
      critterSlot: "heading",
      title: hh.recommendedLabel,
      stickerEl: sticker("blue", hh.vehicleDisplayName || "Tesla"),
      line: "Navigation + preconditioning, one tap.",
      buttons: [
        pillButton("button", { type: "button", onClick: sendHome(hh.recommendedHouse) }, "Send it", "primary"),
        ...(alt ? [pillButton("button", { type: "button", onClick: sendHome(alt.house) }, `Not this -- ${alt.label}`, "ghost")] : []),
      ],
    });
  }
  if (nextKind === "home") {
    return nextCardV3({
      pebbleBg: "rgba(253,230,138,.16)",
      critterSlot: "shop",
      title: "Groceries",
      stickerEl: sticker("indigo", "From Claude"),
      line: `${data.groceries.openCount} item${data.groceries.openCount === 1 ? "" : "s"} · when you're near a store`,
      buttons: [
        pillButton("a", { href: "#/shopping" }, "Open Shopping", "primary"),
        pillButton(
          "button",
          {
            type: "button",
            onClick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              try {
                const share = await api("/api/shares", { method: "POST", body: JSON.stringify({ listId: data.groceries.listId }) });
                await navigator.clipboard?.writeText?.(share.url || `${location.origin}/l/${share.token}`);
                showQuickToast("Link copied.");
              } catch (err) {
                showQuickToast(err.message || "Couldn't create a link.");
              } finally {
                btn.disabled = false;
              }
            },
          },
          "Share link",
          "ghost",
        ),
      ],
    });
  }
  if (nextKind === "none") {
    return nextCardV3({
      pebbleBg: "rgba(209,213,219,.14)",
      critterSlot: "idle",
      title: "Nothing next",
      stickerEl: null,
      line: "The day's yours. New things land here as they come.",
      buttons: [],
    });
  }
  // "generic" -- the pre-existing due-entity list this room already had (a bill reminder, a pet
  // vaccine, etc.), kept working exactly as before rather than dropped for the new five cases.
  const wrap = el("div", { class: "section" });
  for (const item of data.next) wrap.append(entityTile(item));
  return wrap;
}

// ---------------------------------------------------------------------------
// Later, by moment -- balloons (Git #3164, README "Later, by moment -- balloons (0...n)").
//
// Fixed order and real colors straight off the First Slice Prototype's own `momentDefs` (its
// logic is the spec: README, "read `door()` in its logic for the exact expressions"). Each
// moment's condition is real server state from /api/today's `later` (computeLaterMoments() in
// api.mjs) -- Dinner is the one exception that also needs a client-only override: whether
// tonight's cook session is actually done lives only in `mealSession` (never persisted; see its
// own declaration), the same real limitation the Tonight teaser and roomsHouseSection's Recipes
// cell already live with.
const LATER_MOMENT_DEFS = {
  headingOut: { title: "Heading out", pebbleTint: "147,197,253", env: "#FB923C", critterSlot: "heading", route: "#/lists" },
  comingUp: { title: "Coming up", pebbleTint: "196,181,253", env: "#FDE68A", critterSlot: "comingup", route: "#/dates" },
  dinner: { title: "Dinner", pebbleTint: "212,163,115", env: "#5EEAD4", critterSlot: "dinner", route: null }, // route resolved per-render below
  rental: { title: "At the Rental", pebbleTint: "253,230,138", env: "#60A5FA", critterSlot: "home", route: "#/things" },
  idle: { title: "Idle", pebbleTint: "209,213,219", env: "#F9A8D4", critterSlot: "idle", route: "#/inbox" },
};

// README "Sky panel": wash color per season/holiday, same theme keys theme.js already produces.
const LATER_SKY_WASH = {
  halloween: "rgba(168,85,247,.16)",
  birthday: "rgba(244,114,182,.14)",
  thanksgiving: "rgba(251,146,60,.14)",
  christmas: "rgba(96,165,250,.14)",
  newyear: "rgba(99,102,241,.16)",
  spring: "rgba(134,239,172,.12)",
  summer: "rgba(253,224,71,.12)",
};

// README pennant colors, same theme keys.
const LATER_PENNANT = {
  halloween: "#A855F7",
  birthday: "#F472B6",
  thanksgiving: "#F97316",
  christmas: "#22C55E",
  newyear: "#FBBF24",
};

/** The balloon itself: 56x92 envelope in the moment's color, a pennant, a pebble tinted for the
 *  critter riding in the basket, sandbags and a woven basket -- README "Rows" geometry. Right-hand
 *  (odd-index) balloons are mirrored so they face the tag they float beside. */
function laterBalloonSvg({ critterSymbol, pebbleTint, env, pennant, flip, snowcap, dur, delay }) {
  const snowCap = snowcap
    ? `<path d="M18 6 Q28 -1 38 6" stroke="rgba(248,250,252,.9)" stroke-width="4" fill="none" stroke-linecap="round"/>`
    : "";
  return `<svg width="56" height="92" viewBox="0 0 56 92" style="overflow:visible;flex-shrink:0;animation:czFloat ${dur} ${delay} ease-in-out infinite alternate;transform-origin:50% 100%" aria-hidden="true">
    <line x1="28" y1="4" x2="28" y2="-6" stroke="#B07A4A" stroke-width="1.5"/>
    <path d="M28 -6 L38 -2 L28 2 Z" fill="${pennant}"/>
    <path d="M28 4 C44 4 52 17 52 30 C52 46 38 55 31 61 L25 61 C18 55 4 46 4 30 C4 17 12 4 28 4Z" fill="${env}"/>
    <path d="M28 4 C34 20 34 46 28 61 C22 46 22 20 28 4Z" fill="rgba(255,255,255,.32)"/>
    <path d="M28 4 C34 20 34 46 28 61 M28 4 C22 20 22 46 28 61" stroke="rgba(0,0,0,.14)" stroke-width="2" fill="none"/>
    <path d="M10 41 Q28 46 46 41" stroke="rgba(255,255,255,.45)" stroke-width="2" fill="none"/>
    <path d="M14 20 C16 12 20 8 24 6" stroke="rgba(255,255,255,.35)" stroke-width="2" stroke-linecap="round" fill="none"/>
    ${snowCap}
    <path d="M25 61 L19 79 M31 61 L37 79" stroke="#B07A4A" stroke-width="1.4" fill="none"/>
    <circle cx="28" cy="70" r="19" fill="rgba(${pebbleTint},.34)" stroke="rgba(255,255,255,.22)"/>
    <use href="#${critterSymbol}" x="8" y="50" width="40" height="40"/>
    <ellipse cx="16" cy="80" rx="5" ry="4" fill="#D6B08C"/>
    <ellipse cx="40" cy="80" rx="5" ry="4" fill="#D6B08C"/>
    <rect x="11" y="75" width="34" height="14" rx="2.5" fill="#D6B08C"/>
    <path d="M11 82 H45 M19 75 V89 M28 75 V89 M37 75 V89" stroke="rgba(120,53,15,.35)" stroke-width="1"/>
    <rect x="11" y="75" width="34" height="14" rx="2.5" fill="none" stroke="#B45309" stroke-width="1"/>
    <line x1="28" y1="89" x2="28" y2="92" stroke="#B07A4A" stroke-width="1.4"/>
  </svg>`;
}

/** One balloon + its luggage-tag note, laid out left/right alternating (README "Rows": `flex-
 *  direction:row` even, `row-reverse` odd). `route` is the real room the moment's data actually
 *  lives in -- tapping the whole row navigates there, same "the whole row is the tap target" rule
 *  as the design. */
function laterRow(moment, index, theme) {
  const left = index % 2 === 0;
  const dur = `${(5.5 + (index % 3) * 0.7).toFixed(1)}s`;
  const delay = `${(index * 0.9).toFixed(1)}s`;
  const delay2 = `${(index * 0.9 + 0.4).toFixed(1)}s`;
  const def = LATER_MOMENT_DEFS[moment.key];
  const pennant = LATER_PENNANT[theme.key] || "#F87171";

  const balloon = el("div", {
    style: `flex-shrink:0;transform:${left ? "none" : "scaleX(-1)"}`,
    html: laterBalloonSvg({
      critterSymbol: critterFor(def.critterSlot),
      pebbleTint: def.pebbleTint,
      env: def.env,
      pennant,
      flip: !left,
      snowcap: Boolean(theme.snowcap),
      dur,
      delay,
    }),
  });

  const tag = el(
    "div",
    { class: "later-tag", style: `animation:czFloat2 ${dur} ${delay2} ease-in-out infinite alternate` },
    [
      el("div", { class: "later-tag-title", text: def.title }),
      el("div", { class: "later-tag-line", text: moment.line }),
    ],
  );

  return el(
    "a",
    { class: "later-row", href: moment.route, style: `flex-direction:${left ? "row" : "row-reverse"}` },
    [balloon, tag],
  );
}

/** The koala-on-a-cloud empty state -- README "Empty": "the koala on his cloud (76px, `czFloat`
 *  7s) with two rising z's." Same shape as `empty()` above, custom-built because the design gives
 *  this one its own float animation instead of `empty()`'s static icon. */
function laterEmpty() {
  return el("div", { class: "later-empty" }, [
    el("div", { class: "later-empty-critter", html: `<svg width="76" height="76" viewBox="0 0 120 120" style="animation:czFloat 7s ease-in-out infinite alternate;transform-origin:50% 100%" aria-hidden="true"><use href="#${critterFor("idle")}"></use></svg><span class="later-z">z</span><span class="later-z later-z2">z</span>` }),
    el("div", {}, [
      el("div", { class: "later-tag-title", text: "Nothing later" }),
      el("div", { class: "later-tag-line", text: "Enjoy the day. Moments show up here as they come." }),
    ]),
  ]);
}

/**
 * The whole "Later, by moment" panel: label row (with its own peeker roll), the sky panel (wash,
 * clouds, a bird/bat crossing), then the balloon rows or the empty state. `data.later` is
 * /api/today's real computeLaterMoments() read; `theme` is the same seasonal theme viewToday
 * already resolved for the header. Returns `null` when there is genuinely nothing to render into
 * (never happens in practice -- Idle always exists once the inbox is non-empty, and the empty
 * state covers the rest -- but mirrors the other optional Today sections' own shape).
 */
function laterSection(data, theme) {
  const later = data.later || {};
  const moments = [];

  if (later.headingOut) {
    moments.push({ key: "headingOut", line: later.headingOut.names.join(" · "), route: "#/lists" });
  }
  if (later.comingUp) {
    moments.push({
      key: "comingUp",
      line: later.comingUp.map((d) => `${d.title} ${dueLabel(d.dueInDays, d.atDate)}`).join(" · "),
      route: "#/dates",
    });
  }
  // Dinner: a real plan exists on the server AND it hasn't been marked done in the live (client-
  // only) cook session -- same override roomsHouseSection() and resolveNextKind() already apply.
  const dinnerDone = Boolean(mealSession && mealSession.done);
  if (later.dinner && !dinnerDone) {
    moments.push({
      key: "dinner",
      line: `Tonight: ${later.dinner.dishText}`,
      route: mealSession ? "#/tonight" : "#/recipes",
    });
  }
  if (later.rental) {
    moments.push({ key: "rental", line: `${later.rental.did} · call ${later.rental.name}`, route: "#/things" });
  }
  if (later.idle) {
    const n = later.idle.count;
    moments.push({ key: "idle", line: `${n} thing${n === 1 ? "" : "s"} to look at, whenever`, route: "#/inbox" });
  }

  const wash = LATER_SKY_WASH[theme.key] || "rgba(147,197,253,.12)";
  // README: "no flyer during Christmas (the sleigh) or New Year (fireworks)" -- both already run
  // as their own full-phone weather-particle layer (see theme.js's wSleigh/wFireworks), so this
  // just steps aside rather than duplicating them in the smaller sky panel.
  const flyerBat = Boolean(theme.wBats);
  const flyerNone = Boolean(theme.wSleigh || theme.wFireworks);
  // dk-bat carries its own baked-in wing-flap keyframe (see critters-sprite.svg); dk-bird is a
  // static resting-wing drawing ported byte-for-byte from the design's own embedded sprite -- a
  // <use> can't animate just the inner wing paths of a shared symbol, so the bird crosses without
  // flapping. Decorative only; no real behavior lost.
  const flyerSymbol = flyerBat ? "dk-bat" : "dk-bird";
  const flyerViewBox = flyerBat ? "0 0 34 16" : "0 0 30 26";

  const sky = el("div", { class: "later-sky", style: `background:linear-gradient(180deg,${wash},transparent 85%)` }, [
    el("div", { class: "later-cloud later-cloud-1", html: `<svg viewBox="0 0 28 22" width="84" height="66" aria-hidden="true"><use href="#dk-cloud" fill="#E2E8F0"/></svg>` }),
    el("div", { class: "later-cloud later-cloud-2", html: `<svg viewBox="0 0 28 22" width="60" height="47" aria-hidden="true"><use href="#dk-cloud" fill="#E2E8F0"/></svg>` }),
    el("div", { class: "later-cloud later-cloud-3", html: `<svg viewBox="0 0 28 22" width="48" height="38" aria-hidden="true"><use href="#dk-cloud" fill="#E2E8F0"/></svg>` }),
    flyerNone
      ? null
      : el("div", {
          class: `later-flyer ${flyerBat ? "bat" : "bird"}`,
          style: `animation-duration:${flyerBat ? "18s" : "22s"}`,
          html: `<svg viewBox="${flyerViewBox}" width="30" height="26" aria-hidden="true"><use href="#${flyerSymbol}"/></svg>`,
        }),
    el(
      "div",
      { class: "later-rows" },
      moments.length > 0 ? moments.map((m, i) => laterRow(m, i, theme)) : [laterEmpty()],
    ),
  ]);

  return sky;
}

/** The Meds pill (design handoff "Meds pill"): one compact tap-through summary of today's next
 *  not-yet-taken batch, real counts split "for you" vs "for the pets" via each item's real
 *  `isPetCare` flag. Skipped entirely when nothing is tracked yet -- no invented batches. */
function medsPillSection(meds) {
  if (!meds || !meds.batches || meds.batches.length === 0) return null;
  const current = meds.batches.find((b) => !b.takenToday) || meds.batches[meds.batches.length - 1];
  const takenToday = current.takenToday;
  const yours = current.items.filter((i) => !i.isPetCare).length;
  const pets = current.items.filter((i) => i.isPetCare).length;
  const batchName = current.batch ? current.batch[0].toUpperCase() + current.batch.slice(1) : "Meds";
  const countLine = pets > 0 ? `${yours} for you, ${pets} for the pets` : `${yours} for you`;
  return el("section", { class: "section" }, [
    el(
      "a",
      { class: "card meds-pill", href: "#/meds" },
      [
        el("div", { class: "meds-pill-pebble" }, [critterIcon("meds", { size: 42 })]),
        el("div", { class: "meds-pill-body" }, [
          el("div", { class: "meds-pill-title", text: takenToday ? `${batchName} taken` : `${batchName} · ${countLine}` }),
          el("div", { class: "meds-pill-sub", text: current.items.map((i) => i.name).join(", ") }),
        ]),
        el("div", { class: `meds-pill-status ${takenToday ? "done" : "pending"}`, text: takenToday ? "done" : "not yet" }),
      ],
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Rooms -- the house (Git #3165, README "Rooms -- the house" + "Lamp rules").
//
// Replaces the flat tab-bar links to the real rooms below (the `<nav class="tabs">` this
// superseded is gone from index.html as of Git #3250) with the design's own illustrated house: a
// roof, a two-column floor grid, and a real lit/dark lamp per room driven by /api/today's own
// `rooms` object (roomsForToday() in api.mjs) -- never a guessed or hardcoded state. Floor order
// is the README's own literal order: Things | Lists; People | Dates; Recipes | Pets; Shopping |
// Money.
//
// Critter slots are reused from the existing 23-slot roster rather than inventing new artwork:
// Dates reuses "comingup" (the owl already drawn for the Later moment of the same name) and
// Recipes reuses "dinner" (the otter-chef already drawn for the Dinner moment) -- both already
// exist in critters-sprite.svg and thematically fit the room. Money reuses "moneyhdr" (the bear
// already used for the Money room's own page header). People routes to the real People &
// Patterns journal (#3157, landed the same day as this issue -- see viewPeople() below).
const ROOM_DEFS = [
  { key: "things", route: "#/things", title: "Things", critterSlot: "things", furniture: "r-things", tint: "251,146,60" },
  { key: "lists", route: "#/lists", title: "Lists", critterSlot: "lists", furniture: "r-lists", tint: "165,180,252" },
  { key: "people", route: "#/people", title: "People", critterSlot: "people", furniture: "r-people", tint: "167,139,250" },
  { key: "dates", route: "#/dates", title: "Dates", critterSlot: "comingup", furniture: "r-dates", tint: "244,114,182" },
  { key: "recipes", route: "#/recipes", title: "Recipes", critterSlot: "dinner", furniture: "r-recipes", tint: "45,212,191" },
  { key: "pets", route: "#/pets", title: "Pets", critterSlot: "pets", furniture: "r-pets", tint: "52,211,153" },
  { key: "shopping", route: "#/shopping", title: "Shopping", critterSlot: "shop", furniture: "r-shop", tint: "96,165,250" },
  { key: "money", route: "#/money", title: "Money", critterSlot: "moneyhdr", furniture: "r-money", tint: "251,191,36" },
  // Git #3241: Wins pulled out of Money's own tab switcher into its own real room -- the genuine
  // counterweight to Money's heavy content deserves its own glowing cell, not a buried tab. Uses
  // the "wins" critter slot (1n, c-wins/c-wins2 in critters-sprite.svg) that's been built to full
  // spec since #3119 waiting for exactly this room to land. tint is a warm rose, deliberately
  // distinct from Money's amber bear -- quiet, not celebratory neon.
  { key: "wins", route: "#/wins", title: "Wins", critterSlot: "wins", furniture: "r-wins", tint: "253,164,175" },
  // Git #3250: Meds and Inbox are the last two links pulled off the old flat `.tabs` bar --
  // README's own "ten rooms" list ("Money | Medicine ... Inbox | People") gives both a real tint
  // and furniture; appended here rather than reordering the eight rooms already shipped above,
  // to keep this a pure addition (any saved room order, Git #3215, still reconciles cleanly).
  { key: "meds", route: "#/meds", title: "Medicine", critterSlot: "meds", furniture: "r-meds", tint: "52,211,153" },
  { key: "inbox", route: "#/inbox", title: "Inbox", critterSlot: "idle", furniture: "r-inbox", tint: "147,197,253" },
];

/** The roof: polygon + ridge + chimney, README-exact geometry (viewBox 370x40). The two smoke
 *  puffs only show "while the kitchen lamp is lit" -- i.e. while the real Recipes room is lit. */
function roomsRoofHtml(recipesLit) {
  const smoke = recipesLit
    ? `<circle cx="282" cy="2" r="3.5" fill="rgba(226,232,240,.4)" style="animation:czDrift 4s ease-in-out infinite"/>
       <circle cx="288" cy="0" r="2.6" fill="rgba(226,232,240,.35)" style="animation:czDrift 4s 2s ease-in-out infinite"/>`
    : "";
  return `<svg viewBox="0 0 370 40" class="rooms-roof-svg" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="0,40 185,2 370,40" fill="rgba(148,163,184,.30)"/>
    <polyline points="0,40 185,2 370,40" fill="none" stroke="rgba(226,232,240,.35)" stroke-width="1.5"/>
    <rect x="276" y="5" width="16" height="22" fill="rgba(148,163,184,.55)"/>
    <rect x="273" y="2" width="22" height="4" fill="rgba(203,213,225,.6)"/>
    ${smoke}
  </svg>`;
}

/** One floor cell: furniture back wall, lamp, critter (asleep with two z's when dark), name and
 *  real subtitle line -- all tap-through to the room's own real page. */
function roomsCell({ key, route, title, critterSlot, furniture, tint }, lit, subtitle) {
  const cell = el(
    "a",
    {
      class: `rooms-cell ${lit ? "lit" : "dark"}`,
      href: route,
      style: lit
        ? `background:radial-gradient(60% 60% at 50% 0%,rgba(253,224,71,.16),transparent), rgba(${tint},.14)`
        : `background:rgba(${tint},.08)`,
    },
    [
      el("div", { class: "rooms-furniture", html: `<svg viewBox="0 0 170 34" preserveAspectRatio="xMidYMin meet" aria-hidden="true"><use href="#${furniture}"></use></svg>` }),
      el("div", { class: "rooms-lamp" }, [
        el("div", { class: "rooms-lamp-cord" }),
        el("div", { class: "rooms-lamp-bulb" }),
      ]),
      el("div", { class: "rooms-critter" }, [
        critterIcon(critterSlot, { size: 40 }),
        !lit ? el("span", { class: "rooms-z", text: "z" }) : null,
        !lit ? el("span", { class: "rooms-z", text: "z" }) : null,
      ]),
      el("div", { class: "rooms-cell-body" }, [
        el("div", { class: "rooms-cell-name", text: title }),
        el("div", { class: "rooms-cell-line", text: subtitle }),
      ]),
    ],
  );
  return cell;
}

/** ROOM_DEFS, real-ordered per `order` (a real permutation of ROOM_DEFS keys -- /api/today's own
 *  `roomOrder`, itself the reconciled read of the user's Settings "House · Room order" card, Git
 *  #3215). Falls back to ROOM_DEFS' own literal order (the grid's original shipped order) for any
 *  key `order` doesn't cover, so a stale/partial order client-side can never drop a room. */
function orderedRoomDefs(order) {
  if (!Array.isArray(order) || order.length === 0) return ROOM_DEFS;
  const byKey = new Map(ROOM_DEFS.map((def) => [def.key, def]));
  const ordered = order.map((key) => byKey.get(key)).filter(Boolean);
  for (const def of ROOM_DEFS) if (!order.includes(def.key)) ordered.push(def);
  return ordered;
}

/** The whole "Rooms -- the house" section: roof, the floor grid (11 real rooms as of Git #3250),
 *  and the yard. `rooms` is /api/today's own real per-room state (roomsForToday() in api.mjs); a
 *  live Tonight/Cook session (client-only state, never persisted -- see mealSession's own
 *  declaration) can additionally light the Recipes room even outside its server-computed
 *  16:00-21:00 window, same override resolveNextKind() already applies to the Next card's own
 *  "dinner" case. `order` is the user's real saved room order (Git #3215) -- undefined/empty
 *  renders the original shipped order. */
function roomsHouseSection(rooms, order) {
  let recipesLit = Boolean(rooms.recipes && rooms.recipes.lit);
  let recipesSubtitle = rooms.recipes ? rooms.recipes.subtitle : "Nothing planned right now";
  if (mealSession && !mealSession.done) {
    recipesLit = true;
    recipesSubtitle = "Cooking now";
  }

  const cells = orderedRoomDefs(order).map((def) => {
    if (def.key === "recipes") return roomsCell(def, recipesLit, recipesSubtitle);
    const room = rooms[def.key];
    const lit = Boolean(room && room.lit);
    const subtitle = room ? room.subtitle : "";
    return roomsCell(def, lit, subtitle);
  });

  return el("div", { class: "rooms-house" }, [
    el("div", { class: "rooms-roof" }, [
      el("div", { html: roomsRoofHtml(recipesLit) }),
      // Git #3250, README "Settings = the attic": a louvered gable vent tap target in the roof
      // is Settings' only real entry point now that the flat `.tabs` bar is gone -- the last of
      // the four links that bar carried (Today: the per-room house-icon back-link, Meds/Inbox:
      // the two rooms just above).
      el("a", { href: "#/settings", class: "rooms-vent", "aria-label": "Settings", title: "Settings" }, [
        el("span", {
          html: `<svg viewBox="0 0 48 34" aria-hidden="true"><path d="M8 34 V22 A16 16 0 0 1 40 22 V34 Z" fill="rgba(7,16,36,.85)" stroke="rgba(226,232,240,.6)" stroke-width="1.5"/><path d="M13 24 H35 M13 28 H35 M13 32 H35" stroke="rgba(148,163,184,.5)" stroke-width="1.2"/></svg>`,
        }),
      ]),
    ]),
    el("div", { class: "rooms-body" }, cells),
    el("div", { class: "rooms-yard" }),
  ]);
}

async function viewToday(view) {
  const data = await api("/api/today");

  const now = new Date();
  const hour = now.getHours();
  // `?today=` (Git #3145) overrides only the calendar date shown and the season/holiday theme
  // it drives -- the clock hour above stays real, exactly like the design's own dev tweak (see
  // theme.js's `todayOverride`).
  const dateNow = todayOverride() || now;
  const theme = themeFor(dateNow);
  const nextKind = resolveNextKind(data, hour);
  const matchLine = foxMatchLine(nextKind, data);
  // A holiday's own line (README "Seasons and holidays") wins over the generic opener+matchLine
  // pairing -- but a real doctor appointment today still wins over the holiday, exactly as the
  // prototype's own `foxLine` ternary orders it (doctor check before `th.thFox`).
  const foxLine = nextKind === "doctor" ? `${foxOpener(hour)} ${matchLine}` : theme.thFox || (matchLine ? `${foxOpener(hour)} ${matchLine}` : foxOpener(hour));
  const wx = cachedWeather() || sampleWeather(hour >= 7 && hour < 19);
  view.append(renderTodayHeader(now, dateNow, wx, foxLine, theme));
  // The design's own stated fallback: render instantly with the sample/cached weather, then
  // swap in the real Open-Meteo read the moment it answers (decorative only -- a failed fetch
  // just leaves the sample in place, see weather.js).
  if (!cachedWeather()) {
    fetchWeather().then((real) => {
      if (real && state.route === "today") render();
    });
  }

  // Real physical-place surfacing (Git #3159) -- foreground-only, on demand, same deferred
  // "render instantly, swap in the real read the moment it answers" pattern as weather above.
  // Only ever checks when permission is ALREADY granted (see getRealPosition's own header) --
  // opening Today never itself prompts for location. An empty slot reserves the real position
  // in the layout; fillNearbyPlaceSlot only ever puts something in it when a real match exists,
  // so a Shane with no places saved (or not near one) sees nothing here at all.
  const geoSlot = el("div");
  view.append(geoSlot);
  fillNearbyPlaceSlot(geoSlot);

  // Tonight teaser (Git #3126) -- purely real client state (mealSession is never persisted
  // server-side, see its own declaration), so this only ever shows while a live synchronized
  // cook session genuinely exists right now. Takes priority over #3127's own "Tonight" plan
  // label below when both would otherwise apply -- a live cook in progress is the more urgent
  // real state than a reminder of what the plan said.
  if (mealSession) {
    const label = mealSession.done ? "Done · plate up" : `everything done in ${mmss(Math.max(0, mealFinishTime(mealSession) - Date.now()))}`;
    view.append(
      el("section", { class: "section" }, [
        el("a", { class: "tile", href: "#/tonight", style: "display:flex;align-items:center;justify-content:space-between" }, [
          el("div", {}, [
            el("div", { class: "title", text: "Tonight · one finish" }),
            el("div", { class: "meta", text: `${mealSession.dishes.map((d) => d.name).join(", ")} · ${label}` }),
          ]),
          el("span", { class: "chip", text: "Open" }),
        ]),
      ]),
    );
  } else if (data.tonight) {
    // #3127's real "Tonight" teaser -- today's real planned dinner, matched against what Claude
    // pushed for the Sunday ritual. A label, not a timer: multi-dish Cook-mode timing is Git
    // #3126, above -- shown instead of this the moment a real synchronized session is running.
    view.append(
      el("section", { class: "section" }, [
        el("a", { class: "card", href: "#/recipes" }, [
          el("div", { class: "meta small", text: "Tonight" }),
          el("div", { class: "title", text: data.tonight.dishText }),
        ]),
      ]),
    );
  }

  // The rest of #3127's real moment-based meal nudges -- "don't forget to make lunch for
  // tomorrow," etc -- straight off whatever Claude pushed via push_meal_plan. Never a calendar;
  // the Tonight card above already covers tonight's own dinner nudge.
  const remainingNudges = (data.mealNudges || []).filter((n) => !(data.tonight && n.entryId === data.tonight.id));
  if (remainingNudges.length > 0) {
    const meals = el("section", { class: "section" }, [el("h2", { text: "Meals" })]);
    for (const nudge of remainingNudges) {
      meals.append(
        el("a", { class: "tile", href: "#/recipes" }, [
          el("div", { class: "title", text: nudge.text }),
        ]),
      );
    }
    view.append(meals);
  }

  // The label sits in its own row, separate from the card list below it -- attachPeeker turns
  // this row (and only this row) into the spec's "position:relative; display:flex;
  // align-items:flex-end" label row; the cards stay in normal block flow beneath it.
  const nextLabel = el("h2", { text: "Next" });
  const nextLabelRow = el("div", { class: "section-label-row" }, [nextLabel]);
  const next = el("section", { class: "section" }, [nextLabelRow, renderNextCardV3(data, nextKind)]);
  view.append(next);

  // Peeker (Git #3119): "Next" is the one tray section label this app actually has today, so it
  // gets the day's first peek roll (`b`). "Later" (below) is the spec's other real label beyond
  // Meds and Rooms and gets the next roll (`b+1` via rollPeekers()).
  // Rooms (Git #3165, below) is spec'd with a plain "Label row 32px" of its own, no peeker
  // described for it the way Next/Later carry one -- so it stays unattached, matching that.
  // Git #3145: a holiday can force a fixed peeker over the daily roll (Halloween's `pkw-ghost`
  // "instead of the cat"), and/or add a hat riding on top of whichever peeker is showing.
  attachPeeker(nextLabel, theme.peeker || rollPeekers()[0]);
  if (theme.peekHatOn) attachPeekerHat(nextLabel, theme.peekHat);

  // Later, by moment -- balloons (Git #3164): the second real tray label, gets the second peek
  // roll.
  const laterLabel = el("h2", { text: "Later, by moment" });
  const laterLabelRow = el("div", { class: "section-label-row" }, [laterLabel]);
  view.append(el("section", { class: "section" }, [laterLabelRow, laterSection(data, theme)]));
  attachPeeker(laterLabel, rollPeekers()[1]);

  const medsPill = medsPillSection(data.meds);
  if (medsPill) view.append(medsPill);

  // Rooms -- the house (Git #3165): the real illustrated-house nav replacing the flat tab-bar
  // links to these 8 rooms (see the trimmed <nav class="tabs"> in index.html).
  view.append(el("section", { class: "section" }, [el("h2", { text: "Rooms" }), roomsHouseSection(data.rooms || {}, data.roomOrder)]));

  if (data.pendingCaptures > 0) {
    view.append(
      el("section", { class: "section" }, [
        el("div", { class: "card" }, [
          el("div", { class: "spread" }, [
            el("div", {}, [
              el("div", { class: "title", text: `${data.pendingCaptures} waiting in the inbox` }),
              el("div", { class: "meta muted small", text: "Ask Claude to file them, or leave them. They keep." }),
            ]),
            el("a", { href: "#/inbox", class: "chip", text: "Open" }),
          ]),
        ]),
      ]),
    );
  }

  if (data.recent.length > 0) {
    const recent = el("section", { class: "section" }, [el("h2", { text: "Recent" })]);
    for (const item of data.recent) recent.append(entityTile(item));
    view.append(recent);
  }
}

/** Git #3159 -- fills `slot` with a real "You're at <place>" card if (and only if) the app
 *  already has location permission and a real saved place actually contains the real current
 *  position. Never requests permission itself, never shows a loading/empty state -- silence is
 *  the correct outcome for "no permission" and "nothing nearby" alike. */
async function fillNearbyPlaceSlot(slot) {
  if ((await geoPermissionState()) !== "granted") return;
  const position = await getRealPosition({ timeout: 3000 });
  if (!position || state.route !== "today") return;
  let nearby;
  try {
    nearby = (await api(`/api/places/nearby?lat=${position.latitude}&lng=${position.longitude}`)).items;
  } catch {
    return; // a failed real-time check is silent, same as no match -- never an error card here
  }
  if (!nearby?.length || state.route !== "today") return;
  const place = nearby[0]; // nearest real match only -- Today shows "only what's next" (Section 3), not a list
  slot.append(
    el("section", { class: "section" }, [
      el("div", { class: "card" }, [
        el("div", { class: "meta small", text: "You're at" }),
        el("div", { class: "title", text: place.label }),
        ...(place.note ? [el("div", { class: "meta muted small", text: place.note })] : []),
      ]),
    ]),
  );
}

function entityTile(entity) {
  const bits = [entity.category_label || entity.category];
  if (entity.item_count) bits.push(`${entity.checked_count}/${entity.item_count} done`);
  if (entity.share_count) bits.push(`${entity.share_count} shared`);
  const at = entity.remind_at || entity.occurs_at;
  if (at) bits.push(when(at));

  return el("a", { class: "tile", href: `#/entity/${entity.id}` }, [
    el("div", { class: "title", text: entity.title }),
    el("div", { class: "meta", text: bits.join(" · ") }),
  ]);
}

// Git #3277: Inbox's own real room header, via the generic roomHeader() (README "Rooms (sub
// pages)") -- same pattern #3192/#3193/#3194 already used, not a bespoke header. ROOM_DEFS' own
// tint for "inbox".
const INBOX_TINT = "147,197,253";

async function viewInbox(view) {
  const { captures } = await api("/api/captures?status=pending");

  roomHeader(view, INBOX_TINT, "Inbox");
  view.append(
    el("section", { class: "section" }, [
      el("h2", { text: "Unfiled" }),
      el("p", { class: "muted small", text: "Raw, exactly as it came in. Nothing here has been classified — that happens in a Claude conversation, over MCP." }),
    ]),
  );

  if (captures.length === 0) {
    view.append(empty("The inbox is clear.", "Anything you say into the box lands here first."));
    return;
  }

  for (const capture of captures) {
    const body = [];
    if (capture.body_text) body.push(el("div", { class: "title", text: capture.body_text }));
    if (capture.media_id) {
      if (String(capture.mime_type || "").startsWith("image/")) {
        body.push(el("img", { src: `/api/media/${capture.media_id}`, alt: "Captured photo", style: "max-width:100%;border-radius:10px;margin-top:.5rem" }));
      } else {
        body.push(el("audio", { controls: true, src: `/api/media/${capture.media_id}`, style: "width:100%;margin-top:.5rem" }));
      }
    }
    body.push(
      el("div", { class: "meta", text: `${capture.source} · ${when(capture.created_at) || new Date(capture.created_at).toLocaleString()}` }),
    );
    body.push(
      el("div", { class: "row", style: "margin-top:.6rem" }, [
        el("button", {
          class: "ghost small",
          text: "Dismiss",
          onClick: async (event) => {
            event.target.disabled = true;
            await api(`/api/captures/${capture.id}/dismiss`, { method: "POST" });
            render();
          },
        }),
      ]),
    );
    view.append(el("div", { class: "card" }, body));
  }
}

// Hub/spoke item-location memory + "Who fixed what" (Git #3156). Real search ("where's the
// drill?"), instant no-confirmation location capture (contract Section 8), and the real
// service-provider log, all real endpoints -- no fixture data.
function thingRow(t) {
  const where = t.house ? `${t.house}, ${t.place}` : t.place;
  return el("div", { class: "date-row" }, [
    el("div", { class: "body" }, [
      el("div", { class: "title small", text: `${t.name} → ${where}` }),
      el("div", { class: "meta", text: when(t.updated_at) || "" }),
      t.note ? el("div", { class: "meta", text: t.note }) : null,
    ]),
  ]);
}

function contactRow(c) {
  const whatWhen = [c.did, c.fixed_on ? whenDate(c.fixed_on) : null].filter(Boolean).join(" · ");
  return el("div", { class: "date-row" }, [
    el("div", { class: "body" }, [
      el("div", { class: "title small", text: c.trade ? `${c.name} (${c.trade})` : c.name }),
      whatWhen ? el("div", { class: "meta", text: whatWhen }) : null,
      c.phone ? el("div", { class: "meta", text: c.phone }) : null,
    ]),
  ]);
}

// Git #3277: Things' own real room header, via the generic roomHeader() (README "Rooms (sub
// pages)") -- same pattern #3192/#3193/#3194 already used, not a bespoke header. README's own
// room-tint table, "Things".
const THINGS_TINT = "251,146,60";

async function viewThings(view) {
  const [{ items: things, houses }, { items: contacts }, { entities }, { categories }] = await Promise.all([
    api("/api/things"),
    api("/api/contacts"),
    api("/api/entities?limit=200"),
    api("/api/categories"),
  ]);

  roomHeader(view, THINGS_TINT, "Things");

  // "Where's the...?" -- real, deterministic search (no AI call, per contract Section 10).
  // Answers inline right under the box, same "trust stated facts immediately" instant-answer
  // spirit as the design's own toast -- no page navigation needed to get the answer.
  const searchInput = el("input", { placeholder: "Where's the…", "aria-label": "Where's the...", autocomplete: "off" });
  const answer = el("div", { class: "meta", style: "min-height:1.2em" });
  const searchForm = el("form", { class: "row" }, [searchInput, el("button", { class: "small", type: "submit", text: "Find" })]);
  searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const q = searchInput.value.trim();
    if (!q) return;
    answer.textContent = "Looking…";
    const { thing } = await api(`/api/things/search?q=${encodeURIComponent(q)}`);
    answer.textContent = thing
      ? `${thing.name} is ${thing.house ? `at ${thing.house}, ` : ""}${thing.place}.`
      : `Nothing on file for "${q}" yet.`;
  });
  view.append(el("section", { class: "section" }, [searchForm, answer]));

  // "Just logged" -- newest-said-first, what recordThing's upsert-by-name keeps current.
  const recentSection = el("section", { class: "section" }, [el("h2", { text: "Just logged" })]);
  if (things.length === 0) {
    recentSection.append(empty("Nothing logged yet.", "Say \"the drill is in the garage\" in the capture box and Claude files it here.", "notfound"));
  } else {
    for (const t of things.slice(0, 8)) recentSection.append(thingRow(t));
  }
  view.append(recentSection);

  if (houses.length > 0) {
    const grouped = el("section", { class: "section" }, [el("h2", { text: "By house" })]);
    for (const h of houses) {
      const atHouse = things.filter((t) => t.house === h.house);
      grouped.append(
        el("div", { style: "margin-bottom:.6rem" }, [
          el("div", { class: "small muted", text: `${h.house} · ${h.thing_count}` }),
          el(
            "div",
            { class: "row" },
            atHouse.map((t) => el("span", { class: "chip", text: t.name })),
          ),
        ]),
      );
    }
    view.append(grouped);
  }

  // Git #3181: no dedicated "Add thing" form -- a location is a capture, same as everywhere
  // else in the app. Say "the drill is in the garage" in the universal capture box and Claude
  // routes it to set_thing over MCP. The upsert-by-name logic (recordThing) is unchanged.

  // "Who fixed what" -- real service-provider log.
  const contactsSection = el("section", { class: "section" }, [el("h2", { text: "Who fixed what" })]);
  if (contacts.length === 0) {
    contactsSection.append(empty("Nothing on file yet.", "Say \"Ray the plumber fixed the sink, 321-555-0142\" in the capture box and Claude files it here.", "notfound"));
  } else {
    for (const c of contacts) contactsSection.append(contactRow(c));
  }
  view.append(contactsSection);

  // Git #3181: no dedicated "Add contact" form -- a service-provider record is a capture too.
  // Say "the plumber is Ray, 321-555-0142" and Claude routes it to set_contact over MCP.

  const used = categories.filter((c) => c.entity_count > 0);
  if (used.length > 0) {
    const chips = el("div", { class: "row" }, [
      el("a", { class: "chip", href: "#/things", text: `all ${entities.length}` }),
      ...used.map((c) => el("a", { class: "chip", href: `#/things/${c.slug}`, text: `${c.label} ${c.entity_count}` })),
    ]);
    view.append(el("section", { class: "section" }, [el("h2", { text: "Categories" }), chips]));
  }

  const filter = state.categoryFilter;
  const shown = filter ? entities.filter((e) => e.category === filter) : entities;

  const list = el("section", { class: "section" }, [
    el("h2", { text: filter ? categories.find((c) => c.slug === filter)?.label || filter : "Everything" }),
  ]);
  if (shown.length === 0) {
    list.append(
      empty(
        "Nothing filed yet.",
        "Categories are open — Claude invents the right one when it files something, so this fills itself in.",
        "notfound",
      ),
    );
  } else {
    for (const entity of shown) list.append(entityTile(entity));
  }
  view.append(list);

  // Room watermark (Git #3119): "Things" is the one room from the critter spec's room map that
  // genuinely exists in this app today. Painted on the view itself, not the section, so it shows
  // through every row per the spec ("painted over the content so it shows through list rows").
  attachRoomWatermark(view, "things");
}

// People & Patterns (Git #3157, design contract Section 7) -- a private per-person reflection
// journal. NOT a companion or chatbot persona: a thread per person in Shane's own words, plus a
// deliberately dumb patterns readout (word counts and timing, quoted verbatim -- see
// people.computePatterns on the server). "Threaded automatically based on who's mentioned"
// happens in a Claude conversation (Section 10); this room's own capture bar is the direct,
// no-classification-needed path for filing a note straight against a person you're already
// looking at.

function personInitial(name) {
  return (name || "?").trim().charAt(0).toUpperCase() || "?";
}

function personRow(p) {
  return el("a", { class: "date-row", href: `#/person/${p.id}`, style: "text-decoration:none;color:inherit" }, [
    el("div", { class: "person-avatar", text: personInitial(p.name) }),
    el("div", { class: "body" }, [
      el("div", { class: "title small", text: p.name }),
      el("div", { class: "meta", text: [p.relationship, `${p.note_count} note${p.note_count === 1 ? "" : "s"}`, p.last_entry_at ? when(p.last_entry_at) : null].filter(Boolean).join(" · ") }),
    ]),
  ]);
}

// Git #3277: People's own real room header, via the generic roomHeader() (README "Rooms (sub
// pages)") -- same pattern #3192/#3193/#3194 already used, not a bespoke header. README's own
// room-tint table, "People".
const PEOPLE_TINT = "167,139,250";

async function viewPeople(view) {
  roomHeader(view, PEOPLE_TINT, "People");
  view.append(
    el("section", { class: "section" }, [
      el("p", { class: "muted small", text: "A private thread per person, in your own words. Only you can see this." }),
    ]),
  );

  // The real search/ask interface for pattern recall (Section 7) -- a name jumps straight to
  // that person's thread ("how have things with Dana been"); a word or phrase surfaces every
  // real note that used it, across everyone. Real, deterministic search, no AI call.
  const searchInput = el("input", { placeholder: "Search a name or a word…", "aria-label": "Search people and notes", autocomplete: "off" });
  const searchResults = el("div", { style: "margin-top:.5rem" });
  const searchForm = el("form", { class: "row" }, [searchInput, el("button", { class: "small", type: "submit", text: "Search" })]);
  searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const q = searchInput.value.trim();
    searchResults.replaceChildren();
    if (!q) return;
    const { people: matchedPeople, entries: matchedEntries } = await api(`/api/people?q=${encodeURIComponent(q)}`);
    if (matchedPeople.length === 0 && matchedEntries.length === 0) {
      searchResults.append(el("p", { class: "meta", text: `Nothing on file for "${q}" yet.` }));
      return;
    }
    for (const p of matchedPeople) searchResults.append(personRow({ ...p, note_count: 0, last_entry_at: null }));
    for (const e of matchedEntries) {
      searchResults.append(
        el("a", { class: "date-row", href: `#/person/${e.person_id}`, style: "text-decoration:none;color:inherit" }, [
          el("div", { class: "person-avatar", text: personInitial(e.person_name) }),
          el("div", { class: "body" }, [
            el("div", { class: "title small", text: e.person_name }),
            el("div", { class: "meta", text: `${when(e.happened_at)} · ${e.body_text}` }),
          ]),
        ]),
      );
    }
  });
  view.append(el("section", { class: "section" }, [searchForm, searchResults]));

  const { items } = await api("/api/people");
  const list = el("section", { class: "section" });
  if (items.length === 0) {
    list.append(empty("No one on file yet.", "Add someone below, or just write a note about them in the capture box.", "people"));
  } else {
    for (const p of items) list.append(personRow(p));
  }
  view.append(list);

  const nameInput = el("input", { placeholder: "Name, e.g. Dana", "aria-label": "Person's name" });
  const relInput = el("input", { placeholder: "Relationship (optional), e.g. property manager", "aria-label": "Relationship" });
  const addForm = el("form", { class: "section" }, [
    el("div", { class: "row" }, [nameInput, relInput, el("button", { class: "primary small", type: "submit", text: "Add person" })]),
  ]);
  addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    addForm.querySelectorAll("input,button").forEach((n) => (n.disabled = true));
    try {
      const person = await api("/api/people", { method: "POST", body: JSON.stringify({ name, relationship: relInput.value.trim() || null }) });
      location.hash = `#/person/${person.id}`;
    } finally {
      addForm.querySelectorAll("input,button").forEach((n) => (n.disabled = false));
    }
  });
  view.append(el("div", { class: "card" }, [addForm]));

  attachRoomWatermark(view, "people");
}

function personEntryRow(personId, e) {
  return el("div", { class: "date-row" }, [
    el("div", { class: "body" }, [
      el("div", { class: "meta", text: `${when(e.happened_at)}${e.kind !== "text" ? ` · ${e.kind}` : ""}` }),
      el("div", { text: e.body_text }),
    ]),
    el("button", {
      class: "ghost small danger",
      text: "Delete",
      onClick: async (event) => {
        if (!confirm("Delete this note?")) return;
        event.currentTarget.disabled = true;
        await api(`/api/people/${personId}/entries/${e.id}`, { method: "DELETE" });
        render();
      },
    }),
  ]);
}

async function viewPersonDetail(view, personId) {
  const { person, entries, patterns } = await api(`/api/people/${personId}`);

  const sinceLabel = person.first_entry_at
    ? `${person.note_count} note${person.note_count === 1 ? "" : "s"} since ${new Date(person.first_entry_at).toLocaleDateString([], { month: "long" })}`
    : "No notes yet";

  view.append(
    el("section", { class: "section" }, [
      el("a", { class: "ghost small", href: "#/people", text: "← People" }),
      el("div", { class: "card", style: "margin-top:.5rem" }, [
        el("div", { class: "row", style: "align-items:center" }, [
          el("div", { class: "person-avatar lg", text: personInitial(person.name) }),
          el("div", {}, [
            el("h1", { text: person.name, style: "margin:0 0 .15rem" }),
            el("div", { class: "meta", text: [person.relationship, sinceLabel].filter(Boolean).join(" · ") }),
          ]),
        ]),
      ]),
    ]),
  );

  // "From your own words" -- the patterns panel. Deliberately dumb (Section 7/8): word counts and
  // timing, quoted back verbatim. No summary sentence, no tone, no advice -- if computePatterns
  // found nothing real yet, this section just doesn't render, which is the honest answer.
  if (patterns.length > 0) {
    const patternsCard = el("div", { class: "card" }, [
      el("div", { class: "small muted", style: "text-transform:uppercase;letter-spacing:.08em;font-size:11px;margin-bottom:.4rem", text: "From your own words" }),
      ...patterns.map((p) => el("div", { class: "pattern-line", text: p.text })),
      el("div", { class: "pattern-footnote", text: "Counts and quotes only. Nothing here is an opinion." }),
    ]);
    view.append(el("section", { class: "section" }, [patternsCard]));
  }

  // Note about {person} -- the room's own direct capture bar, same one-box spirit as everywhere
  // else in the app but pre-threaded, since Shane is already looking at exactly who it's about.
  const noteInput = el("textarea", { placeholder: `Note about ${person.name}`, "aria-label": `Note about ${person.name}`, rows: "2" });
  const noteForm = el("form", { class: "section" }, [
    noteInput,
    el("div", { class: "row" }, [el("button", { class: "primary small", type: "submit", text: "Save note" })]),
  ]);
  noteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const bodyText = noteInput.value.trim();
    if (!bodyText) return;
    noteForm.querySelectorAll("textarea,button").forEach((n) => (n.disabled = true));
    try {
      await api(`/api/people/${personId}/entries`, { method: "POST", body: JSON.stringify({ bodyText }) });
      render();
    } finally {
      noteForm.querySelectorAll("textarea,button").forEach((n) => (n.disabled = false));
    }
  });
  view.append(el("div", { class: "card" }, [noteForm]));

  const notesSection = el("section", { class: "section" }, [
    el("div", { class: "row", style: "justify-content:space-between;align-items:center" }, [
      el("h2", { text: "Notes", style: "margin:0" }),
      el("button", {
        class: "ghost small",
        type: "button",
        text: "Export for therapist",
        onClick: async (event) => {
          event.currentTarget.disabled = true;
          try {
            const { text } = await api(`/api/people/${personId}/export`);
            const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = el("a", { href: url, download: `${person.name.replace(/[^a-z0-9]+/gi, "-")}-notes.txt` });
            document.body.append(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          } finally {
            event.currentTarget.disabled = false;
          }
        },
      }),
    ]),
  ]);
  if (entries.length === 0) {
    notesSection.append(empty("Nothing written yet.", "Say something about them above, or ask Claude to file one for you.", "people"));
  } else {
    for (const e of entries) notesSection.append(personEntryRow(personId, e));
  }
  view.append(notesSection);

  attachRoomWatermark(view, "people");
}

// Lists (Git #3155) -- the real, deliberately light-touch case Section 3 calls out: movies/shows
// to watch, recommended books, and anything else Claude files on the fly via `push_list`'s
// generic `category` path. Same real typed shape as Shopping (core/lists.mjs), just every list
// except the Shopping singleton, which keeps its own dedicated room. No bespoke design needed
// per the contract pack -- one simple check-circle row per item, same as the design's own
// "sensible list treatment" line.
// Lists (Git #3155, Round 2 visual rebuild Git #3194) -- the real, deliberately light-touch
// case Section 3 calls out: movies/shows to watch, recommended books, and anything else Claude
// files on the fly via `push_list`'s generic `category` path. Same real typed shape as Shopping
// (core/lists.mjs), just every list except the Shopping singleton, which keeps its own dedicated
// room. Real design source is the First Slice Prototype's own `showLists` block (`d.listGroups`),
// confirmed live by screenshots/07-lists.png -- NOT "Shanes Life 12 - Shared list.dc.html", which
// #3184 already built against for the separate no-login share page (public/share.js). Native
// chrome reuses the generic roomHeader() Dates/Pets already established (#3192/#3193), extended
// here with its optional right-side icon for the design's own critter blob pebble; the rows
// reuse Shopping's already-shipped .shop-list/.shop-check/.shop-item-row (Git #3178) rather than
// a parallel set of near-identical CSS.
const LISTS_TINT = "165,180,252"; // ROOMS' own real tint for "lists", matching the design's glow.

function listsItemRow(listId, item) {
  const box = el("div", {
    class: `shop-check${item.done ? " done" : ""}`,
    role: "checkbox",
    tabindex: "0",
    "aria-checked": item.done ? "true" : "false",
    "aria-label": item.text,
    html: item.done ? SHOP_CHECK_ICON : "",
  });
  const nameEl = el("div", { class: `shop-item-name${item.done ? " done" : ""}`, text: item.text });
  const subEl = item.note ? el("div", { class: "shop-item-sub", text: item.note }) : null;

  const toggleDone = async () => {
    if (box.classList.contains("pending")) return;
    box.classList.add("pending");
    try {
      const updated = await api(`/api/lists/${listId}/items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ checked: !item.done }),
      });
      item.done = updated.done;
      box.classList.toggle("done", item.done);
      box.innerHTML = item.done ? SHOP_CHECK_ICON : "";
      box.setAttribute("aria-checked", item.done ? "true" : "false");
      nameEl.classList.toggle("done", item.done);
    } finally {
      box.classList.remove("pending");
    }
  };
  box.addEventListener("click", toggleDone);
  box.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleDone();
    }
  });
  nameEl.addEventListener("click", toggleDone);

  // Remove lives behind the same trailing-chevron detail panel Shopping's own row uses (Git
  // #3178) rather than a permanent ghost button on the row -- the design never shows one
  // permanently either.
  const expandBtn = el("button", {
    type: "button",
    class: "shop-item-more",
    "aria-label": `More actions for ${item.text}`,
    "aria-expanded": "false",
    html: SHOP_CHEVRON_RIGHT_ICON,
  });
  const detail = el("div", { class: "shop-item-detail" });
  detail.hidden = true;
  expandBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const opening = detail.hidden;
    detail.hidden = !opening;
    expandBtn.classList.toggle("open", opening);
    expandBtn.setAttribute("aria-expanded", opening ? "true" : "false");
    if (opening) {
      detail.replaceChildren(
        el("div", { class: "shop-item-detail-inner" }, [
          el("div", { class: "row" }, [
            el("button", {
              class: "ghost small danger",
              text: "Remove",
              onClick: async (removeEvent) => {
                removeEvent.currentTarget.disabled = true;
                await api(`/api/lists/${listId}/items/${item.id}`, { method: "DELETE" });
                render();
              },
            }),
          ]),
        ]),
      );
    }
  });

  return el("li", { class: "shop-item-row" }, [
    el("div", { class: "shop-item-main" }, [box, el("div", { class: "shop-item-text" }, [nameEl, subEl]), expandBtn]),
    detail,
  ]);
}

/** One list = one design "group": an uppercase "{{name}} · N left" label (plus the same
 *  "New category" chip Dates already surfaces for an on-the-fly kind) over a rounded card of
 *  check-circle rows. */
function listsGroupCard(list) {
  const remaining = Math.max(0, (list.item_count ?? 0) - (list.done_count ?? 0));
  const label = el("span", {
    class: "shop-group-label",
    text: `${list.category_label || list.category || "List"} · ${remaining} left`,
  });
  const newBadge = list.created_by === "claude" ? el("span", { class: "chip", text: "New category" }) : null;

  // Git #3183: no dedicated "Add {noun}" form -- adding to a list is a capture, same as
  // starting one (see viewLists below). Say "watch The Bear" or "add The Bear to Watch" in the
  // universal capture box and Claude files it onto the right list.
  const ul = el("ul", { class: "shop-list" });
  api(`/api/lists/${list.id}`)
    .then((detail) => {
      ul.replaceChildren();
      if (detail.items.length === 0) {
        ul.append(el("li", { class: "muted small", style: "padding:12px 16px", text: "Nothing on this list yet." }));
      } else {
        for (const item of detail.items) ul.append(listsItemRow(list.id, item));
      }
    })
    .catch(() => {
      ul.replaceChildren(el("li", { class: "error small", style: "padding:12px 16px", text: "Couldn't load items." }));
    });
  return el("div", { style: "display:flex;flex-direction:column;gap:8px" }, [
    el("div", { class: "row", style: "align-items:center;gap:8px" }, [label, newBadge]),
    ul,
  ]);
}

// The design's own real, locked line (First Slice Prototype's showLists footer) -- shown under
// the lists whether or not any exist yet, per screenshots/07-lists.png. Copy is final.
const LISTS_HINT = 'Say "watch …" or "read …" and it lands here. A new kind of list shows up on its own the first time you need one. No form, ever.';

async function viewLists(view) {
  const { lists } = await api("/api/lists");

  roomHeader(view, LISTS_TINT, "Lists", { icon: critterIcon("lists", { size: 36 }) });

  if (lists.length === 0) {
    view.append(empty("No lists yet.", LISTS_HINT, "notfound"));
  } else {
    const section = el("section", { class: "section" });
    for (const list of lists) section.append(listsGroupCard(list));
    view.append(section);
    view.append(el("p", { class: "lists-footer-hint", text: LISTS_HINT }));
  }

  // Room watermark (Git #3119): "lists" (1j) is the critter slot the spec already carries for
  // this room.
  attachRoomWatermark(view, "lists");
}

// Recipes -- core list + ingredient matching (Git #3124). Cook mode, Tonight, and the Sunday
// ritual are each separate, real sibling Features; this screen only lists, matches against the
// real Shopping run, and lets Shane add what's missing or archive a recipe he doesn't want kept.
function recipeCard(recipe) {
  // Git #3190: the status badge is this card's sticker (README "Today v3 -- the cute skin"),
  // same rotated-pill treatment as the Next card's own sticker -- green for a real go, amber for
  // a real gap, not the plain uppercase `.chip` every other room's summary counts still use.
  const badge = recipe.canMake
    ? sticker("green", "You'll have everything")
    : sticker("amber", `Missing ${recipe.missing.join(", ")}`);

  // Cook mode (Git #3125): a recipe with no real steps saved has nothing to walk through, so
  // there's no live entry point for it -- Claude just hasn't pushed steps for this one yet.
  const cookBtn =
    recipe.steps.length > 0
      ? pillButton("button", { type: "button", onClick: () => { location.hash = `#/cook/${recipe.id}`; } }, "Cook", "primary")
      : null;

  const addMissingBtn = recipe.canMake
    ? null
    : pillButton(
        "button",
        {
          type: "button",
          onClick: async (event) => {
            event.currentTarget.disabled = true;
            try {
              await api(`/api/recipes/${recipe.id}/add-missing`, { method: "POST" });
              render();
            } finally {
              event.currentTarget.disabled = false;
            }
          },
        },
        "Add missing to Shopping",
        "ghost",
      );

  // README "Screens": "all buttons in 999px pill wrappers (outline -> ghost)" -- Remove keeps
  // its real destructive meaning (red text, README's own #f87171 red accent) but moves into the
  // same pill family as Cook/Add missing instead of the old plain rectangular button.
  const removeBtn = pillButton(
    "button",
    {
      type: "button",
      onClick: async (event) => {
        event.currentTarget.disabled = true;
        await api(`/api/recipes/${recipe.id}`, { method: "DELETE" });
        render();
      },
    },
    "Remove",
    "ghost danger",
  );

  return el("div", { class: "card recipe-card" }, [
    el("div", { class: "recipe-card-head" }, [
      el("div", {}, [
        el("div", { class: "title", text: recipe.name }),
        el("div", { class: "meta", text: [recipe.timeText, recipe.heartHealthy ? "heart-healthy" : null].filter(Boolean).join(" · ") }),
      ]),
      badge,
    ]),
    recipe.needs.length > 0
      ? el("p", { class: "small muted", style: "margin:.5rem 0 0", text: recipe.needs.join(", ") })
      : null,
    el("div", { class: "recipe-pill-row" }, [cookBtn, addMissingBtn, removeBtn].filter(Boolean)),
  ]);
}

async function viewRecipes(view) {
  const { recipes } = await api("/api/recipes");
  const { entries: planEntries } = await api("/api/meal-plan");
  const canMakeCount = recipes.filter((r) => r.canMake).length;

  // Native room chrome (Git #3190, design README "Screens": "Recipes, Cook, Tonight, Review
  // and Shopping keep their solid card-colored header band") -- same real shape Shopping
  // already shipped (#3178): back-to-Today link, title + a live count subtitle, spacer right
  // (no per-room icon action here the way Shopping's scan button is).
  view.append(
    el("div", { class: "recipe-header" }, [
      el("a", { href: "#/today", class: "recipe-header-back" }, [el("span", { html: ROOM_HOUSE_ICON }), el("span", { text: "Today" })]),
      el("div", { class: "recipe-header-center" }, [
        el("div", { class: "recipe-header-title", text: "Recipes" }),
        el("div", {
          class: "recipe-header-sub",
          text: recipes.length === 0 ? "Nothing saved yet" : `${canMakeCount} of ${recipes.length} you can make`,
        }),
      ]),
      el("div", { class: "recipe-header-spacer" }),
    ]),
  );
  view.append(el("div", { class: "recipe-header-bar" }));

  // #3127's real Sunday ritual: the week Claude planned, hosted and displayed here -- no
  // manual meal-planning calendar to author it in, only the one archive action to correct a
  // bad push (same "host, display, let Shane act" division of labor as Shopping/Recipes).
  if (planEntries.length > 0) {
    const plan = el("section", { class: "section" }, [el("h2", { text: "This week's plan" })]);
    for (const entry of planEntries) {
      plan.append(
        el("div", { class: "card recipe-card" }, [
          el("div", { class: "spread" }, [
            el("div", {}, [
              el("div", { class: "meta small", text: `${entry.date} · ${entry.mealType}` }),
              el("div", { class: "title", text: entry.dishText }),
            ]),
            pillButton(
              "button",
              {
                type: "button",
                onClick: async (event) => {
                  event.currentTarget.disabled = true;
                  await api(`/api/meal-plan/${entry.id}`, { method: "DELETE" });
                  render();
                },
              },
              "Remove",
              "ghost danger",
            ),
          ]),
        ]),
      );
    }
    view.append(plan);
  }

  // Section label reuses the design's own real desktop-browser vocabulary ("Saved", the group
  // of Claude-pushed recipes distinct from what's actively on the Aldi run) rather than
  // repeating the room's own "Recipes" title the native header above already carries.
  view.append(
    el("section", { class: "section" }, [
      el("div", { class: "spread" }, [
        el("h2", { text: "Saved" }),
        el("span", { class: "chip", text: `${canMakeCount} you can make from the list` }),
      ]),
      el("p", { class: "muted small", text: "Generated by Claude in a conversation, then pushed in — ask Claude for a recipe to add one." }),
    ]),
  );

  // Tonight (Git #3126): cooking two or more dishes so everything finishes together is its own
  // real screen, not another button on a recipe card -- surfaced here since Recipes is where
  // Shane already looks for what to make.
  view.append(
    el("section", { class: "section" }, [
      el("a", { class: "tile", href: "#/tonight", style: "display:flex;align-items:center;justify-content:space-between" }, [
        el("div", {}, [
          el("div", { class: "title", text: mealSession ? "Tonight — in progress" : "Tonight" }),
          el("div", { class: "meta", text: mealSession ? "A synchronized meal is cooking now" : "Cook two or more dishes so everything finishes together" }),
        ]),
        el("span", { class: "chip", text: mealSession ? "Open" : "Start" }),
      ]),
    ]),
  );

  if (recipes.length === 0) {
    view.append(
      empty(
        "No recipes saved yet.",
        "Ask Claude to build one and push it in — it'll show up here matched against what's already on the Shopping run.",
      ),
    );
  } else {
    const list = el("section", { class: "section" });
    for (const recipe of recipes) list.append(recipeCard(recipe));
    view.append(list);
  }
}

/** A step is a bare string (#3124-era pushes) or `{text, ings}` (Git #3125 onward) -- see
 *  recipes.mjs's normaliseSteps for the same real distinction, server-side. */
function stepText(step) {
  return typeof step === "string" ? step : step.text;
}
function stepIngs(step) {
  return typeof step === "string" ? [] : step.ings || [];
}

// Cook mode -- real step-by-step cooking view (Git #3125), the sibling Feature #3124 explicitly
// left out. "Unchecked ingredients never block Next" and "Screen stays awake in cook mode" are
// the design's own two locked, verbatim lines (contract pack prototype's real `cookFoot` text) --
// copied here exactly, not paraphrased.
//
// Git #3126 reuses this exact per-dish step view for a dish opened from inside a live Tonight
// session -- `cookMeal` mirrors the prototype's own `cookMeal`/`mealOn` distinction: back/done
// return to Tonight instead of Recipes, and a compact strip of every other dish's live status
// shows above the step card so Shane isn't blind to the rest of the meal while checking one dish.
async function viewCook(view, recipeId) {
  const { recipes } = await api("/api/recipes");
  const recipe = recipes.find((r) => r.id === recipeId);

  if (!recipe) {
    view.append(empty("Recipe not found.", "It may have been removed."));
    return;
  }
  const steps = recipe.steps || [];
  if (steps.length === 0) {
    view.append(empty("No steps saved for this recipe.", "Ask Claude to push real steps for it next time."));
    return;
  }

  if (!cookSession || cookSession.recipeId !== recipeId) {
    cookSession = { recipeId, stepIndex: 0, checks: {} };
  }
  cookSession.stepIndex = Math.min(cookSession.stepIndex, steps.length - 1);

  await requestCookWakeLock();

  const stepIndex = cookSession.stepIndex;
  const step = steps[stepIndex];
  const isLast = stepIndex + 1 >= steps.length;
  const ings = stepIngs(step);

  const cookMeal = !!(mealSession && !mealSession.done && mealSession.dishes.some((d) => d.id === recipeId));
  const exitTarget = cookMeal ? "#/tonight" : "#/recipes";
  const exitToRecipes = () => {
    cookSession = null;
    location.hash = exitTarget;
  };

  if (cookMeal) view.append(mealChipStrip(recipeId));

  view.append(
    el("section", { class: "section" }, [
      el("div", { class: "spread" }, [
        el("button", { class: "ghost small", text: cookMeal ? "← Tonight" : "← Recipes", onClick: exitToRecipes }),
        el("div", { style: "text-align:right" }, [
          el("div", { class: "title", text: recipe.name }),
          el("div", { class: "meta", text: `Step ${stepIndex + 1} of ${steps.length}` }),
        ]),
      ]),
    ]),
  );

  const ingList =
    ings.length > 0
      ? el(
          "ul",
          { class: "checklist" },
          ings.map((ing, i) => {
            const key = `${stepIndex}-${i}`;
            const done = !!cookSession.checks[key];
            const box = el("input", { type: "checkbox", ...(done ? { checked: true } : {}) });
            const label = el("span", { class: done ? "done" : "", text: ing });
            box.addEventListener("change", () => {
              cookSession.checks[key] = box.checked;
              render();
            });
            return el("li", {}, [box, label]);
          }),
        )
      : null;

  view.append(
    el("section", { class: "section" }, [
      el("div", { class: "card" }, [
        el("div", { class: "small muted", text: `Step ${stepIndex + 1}`, style: "text-transform:uppercase;letter-spacing:.05em" }),
        el("p", { style: "font-size:1.3rem;font-weight:700;margin:.35rem 0 0", text: stepText(step) }),
        ingList,
      ]),
    ]),
  );

  view.append(
    el("section", { class: "section" }, [
      el("div", { class: "row", style: "display:grid;grid-template-columns:1fr 2fr;gap:.6rem" }, [
        el("button", {
          class: "ghost",
          text: "Back",
          onClick: () => {
            if (stepIndex > 0) cookSession.stepIndex = stepIndex - 1;
            else exitToRecipes();
            render();
          },
        }),
        el("button", {
          class: "primary",
          text: isLast ? (cookMeal ? "Back to Tonight" : "Done cooking") : "Next step",
          onClick: () => {
            if (!isLast) {
              cookSession.stepIndex = stepIndex + 1;
              render();
            } else {
              exitToRecipes();
            }
          },
        }),
      ]),
      el("p", {
        class: "muted small",
        style: "text-align:center;margin-top:.5rem",
        text: "Screen stays awake in cook mode. Unchecked ingredients never block Next.",
      }),
    ]),
  );
}

// Tonight -- real multi-dish synchronized cooking (Git #3126). One dish starts immediately (the
// longest one), the rest start later so every dish finishes at the same real moment -- the
// prototype's own "longest dish starts first, shorter dishes start later so all finish together"
// logic, against real recipes with a real `cookMinutes` set instead of the prototype's fixed
// three-dish demo meal.

/** The compact strip of every OTHER dish's live status shown above Cook mode's step card while
 *  a Tonight session is active -- the prototype's own `mealChips`, so Shane isn't blind to the
 *  rest of the meal while he's checked into one dish's steps. */
function mealChipStrip(activeRecipeId) {
  const now = Date.now();
  const chips = mealSession.dishes.map((d) => {
    const ds = mealDishState(d, mealSession, now);
    const text = {
      cooking: `${d.name} · ${mmss(ds.leftMs)}`,
      due: `${d.name} · go now`,
      waiting: `${d.name} · in ${mmss(ds.startsInMs)}`,
      done: `${d.name} · done`,
    }[ds.phase];
    return el("span", { class: `chip${d.id === activeRecipeId ? " ok" : ""}`, text });
  });
  return el("section", { class: "section" }, [el("div", { class: "row" }, chips)]);
}

function mealDishCard(dish) {
  const now = Date.now();
  const ds = mealDishState(dish, mealSession, now);
  const statusText = {
    cooking: `${mmss(ds.leftMs)} left`,
    due: "go now",
    waiting: `starts in ${mmss(ds.startsInMs)}`,
    done: "done",
  }[ds.phase];
  const pct = ds.phase === "done" ? 100 : ds.phase === "cooking" ? Math.round(100 - (ds.leftMs / (dish.minutes * 60000)) * 100) : 0;

  // The design's own "canStart" affordance (prototype: `ds.phase === 'due'`) -- a due dish can be
  // started directly from its own card, not only via the alarm overlay's "It's in".
  const startNowBtn =
    ds.phase === "due"
      ? el("button", {
          class: "primary small",
          text: "It's in",
          onClick: () => {
            mealSession.started[dish.id] = Date.now();
            if (mealAlarm && mealAlarm.dishId === dish.id) {
              stopMealBeep();
              mealAlarm = null;
              renderMealAlarmOverlay();
            }
            render();
          },
        })
      : null;

  const cookBtn = el("button", { class: "ghost small", text: "Cook", onClick: () => { location.hash = `#/cook/${dish.id}`; } });

  return el("div", { class: `meal-dish meal-dish-${ds.phase}` }, [
    el("div", { class: "meal-dish-bar" }, [el("div", { class: "meal-dish-bar-fill", style: `width:${pct}%` })]),
    el("div", { class: "spread" }, [
      el("div", {}, [
        el("div", { class: "title", text: dish.name }),
        el("div", { class: "meta", text: `${dish.minutes} min total · ${statusText}` }),
      ]),
      el("div", { class: "row" }, [startNowBtn, cookBtn].filter(Boolean)),
    ]),
  ]);
}

async function viewTonight(view) {
  if (mealSession) {
    renderActiveMeal(view);
    return;
  }

  const { recipes } = await api("/api/recipes");
  // Eligibility, per migration 028's own real reasoning: a dish needs both a real cook time to
  // synchronize against and real steps to actually cook through.
  const eligible = recipes.filter((r) => r.cookMinutes && r.steps.length > 0);

  view.append(
    el("section", { class: "section" }, [
      el("h2", { text: "Tonight" }),
      el("p", {
        class: "muted small",
        text: "Pick tonight's dishes -- Tonight works out when each one has to start so everything finishes together.",
      }),
    ]),
  );

  if (eligible.length === 0) {
    view.append(
      empty(
        "No dishes ready for Tonight yet.",
        "Ask Claude to push a recipe with a real cook time (cookMinutes) and real steps -- that's what makes a recipe eligible to cook as part of a synchronized Tonight meal.",
      ),
    );
    return;
  }

  const list = el("section", { class: "section" });
  for (const recipe of eligible) {
    const checkbox = el("input", { type: "checkbox", ...(mealSelection.has(recipe.id) ? { checked: true } : {}) });
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) mealSelection.add(recipe.id);
      else mealSelection.delete(recipe.id);
      render();
    });
    list.append(
      el("label", { class: "tile", style: "display:flex;align-items:center;gap:.75rem;cursor:pointer" }, [
        checkbox,
        el("div", { style: "flex:1" }, [
          el("div", { class: "title", text: recipe.name }),
          el("div", { class: "meta", text: `${recipe.cookMinutes} min` }),
        ]),
      ]),
    );
  }
  view.append(list);

  const selectedCount = eligible.filter((r) => mealSelection.has(r.id)).length;
  view.append(
    el("section", { class: "section" }, [
      el("button", {
        class: "primary",
        text: selectedCount > 0 ? `Start Tonight — ${selectedCount} dish${selectedCount === 1 ? "" : "es"}` : "Pick at least one dish",
        ...(selectedCount === 0 ? { disabled: true } : {}),
        onClick: () => {
          const dishes = eligible
            .filter((r) => mealSelection.has(r.id))
            .map((r) => ({ id: r.id, name: r.name, minutes: r.cookMinutes, steps: r.steps }));
          if (dishes.length === 0) return;
          startMeal(dishes);
          render();
        },
      }),
    ]),
  );
}

function renderActiveMeal(view) {
  const session = mealSession;

  if (session.done) {
    view.append(
      el("section", { class: "section" }, [
        el("div", { class: "card" }, [
          el("div", { class: "title", text: "Everything's done" }),
          el("p", { class: "muted", style: "margin:.35rem 0 0", text: "Plate up. Half for the Rental." }),
        ]),
      ]),
    );
    view.append(
      el("section", { class: "section" }, [
        el("button", { class: "primary", text: "Clear tonight", onClick: () => { stopMeal(); render(); } }),
      ]),
    );
    return;
  }

  const leftMs = Math.max(0, mealFinishTime(session) - Date.now());

  view.append(
    el("section", { class: "section" }, [
      el("div", { class: "spread" }, [
        el("h2", { text: "Tonight" }),
        el("span", { class: "chip", text: "everything done together" }),
      ]),
      el("div", { class: "card" }, [
        el("div", { class: "meta", text: "Everything done in" }),
        el("div", { style: "font-size:2rem;font-weight:700;margin-top:.15rem", text: mmss(leftMs) }),
      ]),
    ]),
  );

  const list = el("section", { class: "section" });
  for (const dish of session.dishes) list.append(mealDishCard(dish));
  view.append(list);

  view.append(
    el("section", { class: "section" }, [
      el("button", { class: "ghost danger", text: "Stop cooking", onClick: () => { stopMeal(); render(); } }),
    ]),
  );
}

// Meds (Git #3135). Design/design_handoff_shanes_life/Shanes Life 07 - Meds.dc.html: a batch
// card per time of day, one real slide-to-take per batch (never per medication), and a Refills
// section split into "Needs you" (manual-watch) and "Handled automatically" (auto-refill). No
// adherence history or streak is shown anywhere on purpose (the design's own "Why") -- only
// today's real state.

const MEDS_CRITTER_SLOT = { morning: "morning", evening: "bedtime", bed: "bedtime" };
function medsCritterSlot(batch) {
  return MEDS_CRITTER_SLOT[batch] || "meds";
}

// el("svg", ...) would call document.createElement, which builds an unnamespaced element that
// cannot render SVG children -- these two icons need the real SVG namespace.
const SVG_NS = "http://www.w3.org/2000/svg";
function lineIcon(pathsHtml, { size = 20, strokeWidth = 2.5 } = {}) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", strokeWidth);
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = pathsHtml;
  return svg;
}

/**
 * A real drag-to-complete control, plain pointer events -- no framework. Dragging the knob past
 * ~70% of the track fires onComplete(); letting go short of that snaps the knob back. This is
 * the "single swipe per batch, not per-pill" control the design's own slide track draws.
 */
function attachSlideToTake(track, knob, onComplete) {
  let dragging = false;
  let startX = 0;
  let startLeft = 4;

  const knobWidth = 44;
  const margin = 4;

  function maxLeft() {
    return track.getBoundingClientRect().width - knobWidth - margin;
  }

  function setLeft(px) {
    knob.style.left = `${Math.max(margin, Math.min(maxLeft(), px))}px`;
  }

  knob.addEventListener("pointerdown", (event) => {
    dragging = true;
    startX = event.clientX;
    startLeft = knob.offsetLeft;
    knob.classList.add("dragging");
    knob.setPointerCapture(event.pointerId);
  });

  knob.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    setLeft(startLeft + (event.clientX - startX));
  });

  function release(event) {
    if (!dragging) return;
    dragging = false;
    knob.classList.remove("dragging");
    const threshold = maxLeft() * 0.7;
    if (knob.offsetLeft >= threshold) {
      setLeft(maxLeft());
      onComplete();
    } else {
      setLeft(margin);
    }
    if (event?.pointerId !== undefined && knob.hasPointerCapture?.(event.pointerId)) {
      knob.releasePointerCapture(event.pointerId);
    }
  }

  knob.addEventListener("pointerup", release);
  knob.addEventListener("pointercancel", release);
}

// The pill icon (lucide "Pill") the design puts in a tinted circle on every real item row.
const PILL_ICON_PATH = '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"></path><path d="m8.5 8.5 7 7"></path>';

// Git #3269: which "part of the day" a batch's own free-text name reads as. Claude names
// batches from natural language ("started X every morning"), so this matches by keyword rather
// than a fixed enum of exact batch names -- real, confirmed necessary since Shane's own real
// "night" batch doesn't match the design's literal "evening"/"bed" examples. Rank 3 (no keyword
// match, e.g. "as needed") is untimed: there's no real "later" for a medication you take
// whenever you need it, so it never collapses -- see viewMeds().
function medsDaypartRank(batchName) {
  const name = String(batchName || "").toLowerCase();
  if (/morning/.test(name)) return 0;
  if (/noon|midday|afternoon|lunch/.test(name)) return 1;
  if (/evening|night|bed|dinner/.test(name)) return 2;
  return 3;
}

function medBatchCard(batchState, { collapsed = false } = {}) {
  const { batch, items, takenToday, takenAt } = batchState;
  const label = batch.charAt(0).toUpperCase() + batch.slice(1);

  if (collapsed) {
    // Git #3269, design's real "later" treatment (Shanes Life 07 - Meds.dc.html's Evening
    // card): a single summary line instead of a full itemized list, for any timed batch that
    // isn't the one real "current" batch yet -- no items, no swipe, opacity .7 like the design's
    // own literal value. Names truncate rather than trying to fit Shane's real up-to-6-item
    // batches onto the design's own 1-2-item example line.
    const MAX_NAMES = 3;
    const names = items.map((item) => item.name);
    const summary =
      names.length > MAX_NAMES
        ? `${names.slice(0, MAX_NAMES).join(" · ")} · +${names.length - MAX_NAMES} more`
        : names.join(" · ");
    return el("div", { class: "card med-batch-collapsed" }, [
      el("div", { class: "spread" }, [
        el("div", { class: "row" }, [
          critterIcon(medsCritterSlot(batch), { size: 32 }),
          el("div", {}, [
            el("div", { class: "med-batch-title", text: label }),
            el("div", { class: "med-batch-summary", text: summary }),
          ]),
        ]),
        el("span", { class: "meta", text: "later" }),
      ]),
    ]);
  }

  const itemRows = items.map((item) =>
    el("div", { class: "med-item-row" }, [
      el("div", { class: "med-item-icon" }, [lineIcon(PILL_ICON_PATH, { size: 16 })]),
      el("span", { style: "flex:1", text: item.name }),
      item.doseNote ? el("span", { class: "med-dose", text: item.doseNote }) : null,
    ]),
  );

  const card = el("div", { class: "card" }, [
    el("div", { class: "spread" }, [
      el("div", { class: "row" }, [critterIcon(medsCritterSlot(batch), { size: 32 }), el("span", { class: "med-batch-title", text: label })]),
      el("span", { class: "meta", text: `${items.length} ${items.length === 1 ? "item" : "items"}` }),
    ]),
    ...itemRows,
  ]);

  if (takenToday) {
    card.append(
      el("div", { class: "slide-track done" }, [
        el("span", { text: `Taken ${when(takenAt)}` }),
        el("div", { class: "slide-knob" }, [lineIcon('<path d="M20 6 9 17l-5-5"></path>')]),
      ]),
      el("div", { class: "row", style: "margin-top:.5rem" }, [
        el("button", {
          class: "ghost small",
          text: "Undo",
          onClick: async (event) => {
            event.currentTarget.disabled = true;
            try {
              await api(`/api/medications/batches/${encodeURIComponent(batch)}/take`, { method: "DELETE" });
              render();
            } finally {
              event.currentTarget.disabled = false;
            }
          },
        }),
      ]),
    );
    return card;
  }

  const track = el("div", { class: "slide-track" }, [el("span", { text: "Slide when taken" })]);
  const knob = el("div", { class: "slide-knob" }, [
    lineIcon('<path d="m6 17 5-5-5-5"></path><path d="m13 17 5-5-5-5"></path>'),
  ]);
  track.append(knob);
  card.append(track);

  attachSlideToTake(track, knob, async () => {
    try {
      await api(`/api/medications/batches/${encodeURIComponent(batch)}/take`, { method: "POST" });
    } finally {
      render();
    }
  });

  return card;
}

// Same two icons the design puts in the two refill tiers' own tinted circles (lucide "Phone"
// for the manual-watch tier, the same check lineIcon already uses for a taken batch for the
// auto-refill tier).
const REFILL_PHONE_ICON_PATH =
  '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path>';
const REFILL_CHECK_ICON_PATH = '<path d="M20 6 9 17l-5-5"></path>';

function refillNeedsYouCard(item) {
  const daysLeft = item.daysLeft;
  const titleLine =
    daysLeft === null ? item.name : `${item.name} · ${daysLeft <= 0 ? "due now" : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`}`;

  const orderedButton = pillButton(
    "button",
    {
      type: "button",
      onClick: async (event) => {
        event.currentTarget.disabled = true;
        try {
          await api(`/api/medications/${item.id}/ordered`, { method: "POST" });
          render();
        } finally {
          event.currentTarget.disabled = false;
        }
      },
    },
    "Ordered it",
    "ghost",
  );
  // "Call pharmacy" (the design's own real second action) only ever appears once a real number
  // exists to call -- never a button pointed at nothing.
  const actions = item.pharmacyPhone
    ? [pillButton("a", { href: `tel:${item.pharmacyPhone}` }, "Call pharmacy", "primary"), orderedButton]
    : [orderedButton];

  return el("div", { class: "card refill-card" }, [
    el("div", { class: "refill-row" }, [
      el("div", { class: "refill-icon needs-you" }, [lineIcon(REFILL_PHONE_ICON_PATH, { size: 18 })]),
      el("div", { style: "flex:1;min-width:0" }, [
        el("div", { class: "refill-tier-label needs-you", text: "Needs you" }),
        el("div", { class: "title", style: "margin-top:3px", text: titleLine }),
        item.refillNote ? el("div", { class: "refill-days-left", text: item.refillNote }) : null,
      ]),
    ]),
    el("div", { class: "pill-row" }, actions),
  ]);
}

function refillsSection(refills) {
  const section = el("section", { class: "section" }, [
    el("h2", { text: "Refills" }),
  ]);

  if (refills.needsYou.length === 0 && refills.handled.length === 0) {
    section.append(el("p", { class: "muted small", text: "No medications on file yet." }));
    return section;
  }

  for (const item of refills.needsYou) section.append(refillNeedsYouCard(item));

  if (refills.handled.length > 0) {
    // Only ever names one real shared "next delivery" date -- when the handled meds' own real
    // nextRefillOn dates actually agree. Different real dates per item say "nothing to do"
    // instead of picking one and implying it covers all of them.
    const dates = refills.handled.map((h) => h.nextRefillOn).filter(Boolean);
    const sameDate = dates.length === refills.handled.length && dates.every((d) => d === dates[0]);
    const noteText = sameDate
      ? `Auto-refill · next delivery ${new Date(dates[0]).toLocaleDateString([], { month: "short", day: "numeric" })} · nothing to do`
      : "Auto-refill · nothing to do";

    section.append(
      el("div", { class: "card refill-row" }, [
        el("div", { class: "refill-icon handled" }, [lineIcon(REFILL_CHECK_ICON_PATH, { size: 18 })]),
        el("div", { style: "flex:1;min-width:0" }, [
          el("div", { class: "refill-tier-label handled", text: "Handled automatically" }),
          el("div", { style: "margin-top:3px;line-height:1.45", text: refills.handled.map((h) => h.name).join(", ") }),
          el("div", { class: "refill-days-left", text: noteText }),
        ]),
      ]),
    );
  }

  return section;
}

// Git #3191: Meds' own native header -- back "Today" / centered title / spacer, same real
// shape Today (#3174) and Shopping (#3178) already use, replacing the generic app-header this
// room used to fall back on (see render()'s hasOwnHeader).
function medsHeader() {
  return el("div", { class: "meds-header" }, [
    el("a", { href: "#/today", class: "meds-header-back" }, [chevron("left"), el("span", { text: "Today" })]),
    el("div", { class: "meds-header-title", text: "Meds" }),
    el("div", { class: "meds-header-spacer" }),
  ]);
}

async function viewMeds(view) {
  const { batches, refills } = await api("/api/medications");

  view.append(medsHeader());

  if (batches.length === 0) {
    view.append(
      empty(
        "No medications on file yet.",
        "Tell Claude something like \"started lisinopril 10mg every morning\" in the capture box and it'll show up here.",
        "meds",
      ),
    );
  } else {
    // Git #3269: chronological order (morning -> midday -> evening/night -> untimed), and only
    // the one real "current" batch -- the earliest untaken timed batch -- gets the design's full
    // itemized+swipe treatment. Every other untaken timed batch collapses to the design's
    // one-line "later" summary; untimed batches (e.g. "as needed") have no "later" state to
    // collapse into, so they always stay itemized. An already-taken batch keeps its existing
    // itemized + Undo card regardless of rank -- the design shows no "later, but taken" state,
    // and there's real value in seeing what was actually taken.
    const ordered = batches
      .map((batchState, i) => ({ batchState, rank: medsDaypartRank(batchState.batch), i }))
      .sort((a, b) => a.rank - b.rank || a.i - b.i);
    const current = ordered.find((b) => b.rank < 3 && !b.batchState.takenToday);

    const list = el("section", { class: "section" });
    for (const { batchState, rank } of ordered) {
      const collapsed = rank < 3 && !batchState.takenToday && batchState !== current?.batchState;
      list.append(medBatchCard(batchState, { collapsed }));
    }
    view.append(list);
  }

  view.append(refillsSection(refills));

  // Git #3183: no dedicated "Add medication" form -- a new medication is a capture, same
  // as everything else (contract pack Section 8). Say "started lisinopril 10mg every
  // morning, auto-refill" in the universal capture box and Claude calls set_medication.

  attachRoomWatermark(view, "meds");
}

// ---------------------------------------------------------------------------
// Money -- "Now" tab (Git #3147)
// ---------------------------------------------------------------------------
//
// The math and every real number here come from src/core/money.mjs's own /api/money/* routes
// (Git #3137, already live) -- this is pure UI wiring, no schema and no new endpoint. Bills,
// Cars and Vault are each their own real Feature on top of this one per the issue (Wins was too,
// #3151 -- Git #3241 later pulled it out into its own top-level room, viewWins() below); the
// segmented control below still shows the rest (matching the design), but only "Now" renders
// real content -- the rest say plainly that they aren't built yet, which is not fabricated data,
// just an honest placeholder.
//
// Protected / Urgent / Already handled read straight off getGateStatus()'s own real bill split:
// Protected = the gate bills (money already spoken for by the Income Gate's own due bills) plus
// the critical debts; Urgent = the other real bill accounts still short; Already handled = the
// other real bill accounts that are already fully funded. No separate "mark handled" table is
// invented for this -- there is no MCP tool or capture-grammar entry in the design's own spec
// that writes one, and a tap that didn't call any real mutation would be exactly the kind of fake
// interactivity this app refuses to ship.
//
// Git #3206 re-confirmed this against "Shanes Life 17 - Money v3.dc.html"'s own flag ("Paid ✓
// can't be a checkbox. It's inferred when Plaid sees the debit leave the bill account.") -- there
// is still no checkbox anywhere in this file. The one real gap the design's own example row
// ("Electric H2 · due today · $190.27 in ···1523 for $52") called out was the masked account
// number itself, not shown anywhere before this: moneyBillMeta below now surfaces it.

let moneyTab = "now"; // transient client-only state, same idiom as cookSession above

// Git #3241: Wins moved out of this tab switcher into its own top-level house-grid room
// (viewWins() below) -- no longer one of Money's own tabs.
const MONEY_TABS = [
  { key: "now", label: "Now" },
  { key: "bills", label: "Bills" },
  { key: "banks", label: "Banks" },
  { key: "bankruptcy", label: "Bankruptcy" },
  { key: "accounts", label: "Accounts" },
  { key: "cars", label: "Cars" },
  { key: "vault", label: "Vault" },
  { key: "documents", label: "Documents" },
];

// Git #3205: the real, shared two-week cycle card at the top of Now and Bills. `cycleCardOffset`
// is deliberately ONE piece of transient state shared by both tabs (not per-tab) -- paging back
// through cycles is a property of the real pay period itself, not of which tab happens to be
// showing it, so switching Now <-> Bills mid-page keeps the same cycle on screen.
let cycleCardOffset = 0;

/** `kind` is "now" or "bills" -- same card, different three real numbers per the design's own
 *  2a/2c options. Reads GET /api/money/cycle-card (money.mjs's getCycleCard) -- no client math
 *  beyond formatting. */
async function renderCycleCard(view, kind) {
  const card = await api(`/api/money/cycle-card?cyclesBack=${cycleCardOffset}`);

  const numbers =
    kind === "bills"
      ? [
          { label: "In DirectDeposit", value: card.bills.inDirectDepositFormatted },
          { label: "In bill accounts", value: card.bills.inBillAccountsFormatted },
          { label: "Still to fund", value: card.bills.stillToFundFormatted, amber: true },
        ]
      : [
          { label: "Came in", value: card.now.cameInFormatted },
          { label: "Spent", value: card.now.spentFormatted },
          { label: "Still to fund", value: card.now.stillToFundFormatted, amber: true },
        ];

  const subtitle = card.isCurrentCycle
    ? `this cycle · day ${card.dayIndex} of ${card.totalDays} · payday ${card.nextCheck.label}`
    : `${card.cyclesBack} cycle${card.cyclesBack === 1 ? "" : "s"} back`;

  view.append(
    el("div", { class: "card money-cycle-card" }, [
      el("div", { class: "money-cycle-head" }, [
        el("button", {
          type: "button",
          class: "money-cycle-page",
          "aria-label": "Previous cycle",
          onClick: () => {
            cycleCardOffset += 1;
            render();
          },
        }, [chevron("left")]),
        el("div", { class: "money-cycle-title" }, [
          el("div", { class: "money-cycle-dates", text: card.title }),
          el("div", { class: "small muted", text: subtitle }),
        ]),
        el("button", {
          type: "button",
          class: "money-cycle-page",
          "aria-label": "Next cycle",
          disabled: card.cyclesBack === 0,
          onClick: () => {
            if (card.cyclesBack === 0) return;
            cycleCardOffset -= 1;
            render();
          },
        }, [chevron("right")]),
      ]),
      el(
        "div",
        { class: "money-cycle-grid" },
        card.cells.map((c) =>
          el("div", { class: `money-cycle-cell${c.isToday ? " today" : c.isFuture ? " future" : ""}` }),
        ),
      ),
      el("div", { class: "money-cycle-paydays" }, [
        el("span", { text: `${card.lastCheck.label} · last check` }),
        card.isCurrentCycle ? el("span", { class: "money-cycle-today", text: "today" }) : null,
        el("span", { text: `${card.nextCheck.label} · next check` }),
      ]),
      el(
        "div",
        { class: "money-cycle-numbers" },
        numbers.map((n) =>
          el("div", {}, [
            el("div", { class: "small muted", text: n.label }),
            el("div", { class: "money-cycle-number", style: n.amber ? "color:#fbbf24" : "", text: n.value ?? "—" }),
          ]),
        ),
      ),
    ]),
  );
}

/** A minimal inline chevron -- same idea as the design's own `‹ ›` SVGs, no icon-font dependency. */
function chevron(direction) {
  const d = direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

// ---------------------------------------------------------------------------
// Money -> Banks (Git #3168): real Plaid item health + reconnect
//
// The reconnect flow lives here, in the web app, rather than in ShanesSurvival's WPF app, for a
// reason that is about where Shane is when a bank breaks, not about which codebase is nicer:
// the webhook that discovers the break has to land on an always-on hosted URL, and this is the
// always-on hosted half. Putting the alert here and the fix on his desktop would split one
// action across two apps and a walk to the PC.
//
// Plaid Link is loaded on demand, never in index.html -- a third-party script tag on every page
// load, for something used a handful of times a year, is not a trade this app makes.
// ---------------------------------------------------------------------------

const PLAID_LINK_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
const PLAID_RESUME_KEY = "sl_plaid_reconnect";
let plaidLinkLoader = null;

function loadPlaidLink() {
  if (window.Plaid) return Promise.resolve();
  if (plaidLinkLoader) return plaidLinkLoader;
  plaidLinkLoader = new Promise((resolvePromise, reject) => {
    const script = document.createElement("script");
    script.src = PLAID_LINK_SRC;
    script.async = true;
    script.onload = () => resolvePromise();
    script.onerror = () => {
      plaidLinkLoader = null;
      reject(new Error("Could not load Plaid Link. Check the connection and try again."));
    };
    document.head.append(script);
  });
  return plaidLinkLoader;
}

/**
 * Ask the server whether the reconnect genuinely took. Link's onSuccess only means the flow
 * finished; the server re-reads the item from Plaid before it will call anything fixed.
 */
async function finishPlaidReconnect(itemId) {
  const result = await api(`/api/money/banks/${itemId}/reconnect-complete`, { method: "POST" });
  return result;
}

/** Open real Plaid Link in update mode for one already-linked item. */
async function openPlaidReconnect(item, { onStatus }) {
  onStatus("Asking Plaid for a reconnect token…");
  const token = await api(`/api/money/banks/${item.id}/reconnect-token`, { method: "POST" });

  // Survives the OAuth-institution redirect bounce, which navigates the whole tab away and back.
  try {
    sessionStorage.setItem(PLAID_RESUME_KEY, JSON.stringify({ itemId: item.id, linkToken: token.linkToken }));
  } catch {
    // A blocked sessionStorage only costs the OAuth resume path; non-OAuth banks still work.
  }

  await loadPlaidLink();
  onStatus("Opening your bank…");

  return new Promise((resolvePromise) => {
    const handler = window.Plaid.create({
      token: token.linkToken,
      onSuccess: async () => {
        try {
          sessionStorage.removeItem(PLAID_RESUME_KEY);
        } catch {
          /* nothing to clean up */
        }
        onStatus("Checking with Plaid that it took…");
        try {
          resolvePromise(await finishPlaidReconnect(item.id));
        } catch (err) {
          resolvePromise({ healthy: false, error: err.message });
        }
      },
      onExit: (err) => {
        try {
          sessionStorage.removeItem(PLAID_RESUME_KEY);
        } catch {
          /* nothing to clean up */
        }
        resolvePromise({ cancelled: true, error: err ? err.display_message || err.error_message || err.error_code : null });
      },
    });
    handler.open();
  });
}

/**
 * The OAuth return leg. Banks that use OAuth send the browser away to their own site and back to
 * a pre-registered redirect_uri; Link then has to be re-created with `receivedRedirectUri` to
 * pick the session back up. Without this the flow dead-ends on a blank page after the bank.
 */
async function resumePlaidOAuthReturn() {
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(PLAID_RESUME_KEY) || "null");
  } catch {
    saved = null;
  }
  const returnTo = "/#/money";
  if (!saved?.linkToken || !saved?.itemId) {
    // Nothing to resume -- an expired session or a direct visit. Say so instead of hanging.
    location.replace(returnTo);
    return;
  }

  await loadPlaidLink();
  const handler = window.Plaid.create({
    token: saved.linkToken,
    receivedRedirectUri: window.location.href,
    onSuccess: async () => {
      try {
        sessionStorage.removeItem(PLAID_RESUME_KEY);
      } catch {
        /* nothing to clean up */
      }
      try {
        await finishPlaidReconnect(saved.itemId);
      } catch {
        // The Banks screen re-reads real state on load; a failure here is visible there.
      }
      moneyTab = "banks";
      location.replace(returnTo);
    },
    onExit: () => {
      try {
        sessionStorage.removeItem(PLAID_RESUME_KEY);
      } catch {
        /* nothing to clean up */
      }
      moneyTab = "banks";
      location.replace(returnTo);
    },
  });
  handler.open();
}

const BANK_HEALTH_COPY = {
  ok: { label: "Connected", tone: "ok" },
  login_required: { label: "Sign-in needed", tone: "bad" },
  pending_expiration: { label: "Access expiring", tone: "warn" },
  pending_disconnect: { label: "Disconnecting soon", tone: "warn" },
  revoked: { label: "Access revoked", tone: "bad" },
  error: { label: "Error", tone: "bad" },
};

function bankWhen(value, prefix) {
  if (!value) return null;
  return `${prefix} ${new Date(value).toLocaleString()}`;
}

function bankRow(item, { onReconnect }) {
  const copy = BANK_HEALTH_COPY[item.health] ?? { label: item.health, tone: "warn" };
  const statusColor = copy.tone === "ok" ? "hsl(var(--success))" : copy.tone === "warn" ? "#fbbf24" : "#f87171";
  const statusEl = el("div", { class: "bank-status" });

  const meta = [
    `${item.accountCount} account${item.accountCount === 1 ? "" : "s"}`,
    bankWhen(item.lastSyncedAt, "synced"),
    item.transactionsPendingSince ? "new transactions waiting for the desktop app" : null,
    bankWhen(item.consentExpiresAt, "access expires"),
  ].filter(Boolean);

  const children = [
    el("div", { class: "row", style: "justify-content:space-between;align-items:baseline;gap:8px" }, [
      el("div", { class: "bank-name", style: "font-weight:600", text: item.institutionName }),
      el("span", { class: "small", style: `font-weight:600;white-space:nowrap;color:${statusColor}`, text: copy.label }),
    ]),
    el("p", { class: "small muted", text: meta.join(" · ") }),
  ];

  if (item.healthMessage) {
    children.push(el("p", { class: "small", style: "color:#f87171", text: item.healthMessage }));
  }

  // An item Plaid has never been told to call will never report a problem on its own. That is a
  // real gap in coverage, and it belongs on screen rather than in a log nobody reads.
  if (!item.webhookUrl) {
    children.push(
      el("p", {
        class: "small muted",
        text: "No webhook registered with Plaid for this bank yet — its health is only checked when this app polls.",
      }),
    );
  }

  if (item.needsReconnect) {
    const button = el("button", {
      type: "button",
      class: "primary",
      text: "Reconnect",
      onClick: async () => {
        button.disabled = true;
        try {
          await onReconnect(item, (msg) => {
            statusEl.textContent = msg;
          });
        } finally {
          button.disabled = false;
        }
      },
    });
    children.push(el("div", { class: "row", style: "gap:8px;align-items:center" }, [button, statusEl]));
    // Design 1d's own words, verbatim -- Reconnect is the one tap Plaid requires, and Shane
    // should never wonder whether tapping it can move money.
    children.push(
      el("p", {
        class: "small muted",
        text: `Reconnect opens Plaid Link for ${item.institutionName} and comes straight back here. Balances only; nothing moves from this app.`,
      }),
    );
  }

  return el("div", { class: "card bank-row" }, children);
}

/** Shared by the Banks tab and the Accounts tab's Connected Banks card (Git #3211) -- one real
 *  reconnect flow, not two copies of the same Plaid Link + verify dance. `onDone` re-renders
 *  whichever screen is currently showing the row so a successful reconnect clears on screen. */
function bankReconnectHandler(onDone) {
  return async function reconnect(item, onStatus) {
    try {
      const result = await openPlaidReconnect(item, { onStatus });
      if (result.cancelled) {
        onStatus(result.error ? `Stopped: ${result.error}` : "Reconnect cancelled.");
        return;
      }
      if (result.healthy) {
        onStatus("Reconnected.");
        await onDone();
        return;
      }
      onStatus(result.error || "Plaid still reports this bank as needing attention.");
    } catch (err) {
      onStatus(err.message);
    }
  };
}

/** Git #3207 (design `Shanes Life 17 - Money v3.dc.html` #2d, "the envelope is the account's real
 *  balance"): "$X of $Y in ···NNNN" replaces the old "target $Y · has $Z" pair. A bill with no
 *  real target yet says so honestly instead of a fabricated $0/$0 line -- #2d again: "No Target
 *  becomes a prompt in the bill's own words," rendered by `noTargetPrompt()` below. The real
 *  Plaid-reported last-4 (Git #3206, `bill.mask`) is what backs "in ···NNNN" -- null, honestly,
 *  until Plaid has actually reported it (migration 043). */
function moneyBillMeta(bill) {
  const parts = [];
  if (bill.dueDay) parts.push(`due day ${bill.dueDay}`);
  const maskSuffix = bill.mask ? ` in ···${bill.mask}` : "";
  if (bill.target === null) {
    parts.push("no target yet");
    parts.push(`${dollars(bill.balance)}${maskSuffix}`);
  } else {
    parts.push(`${dollars(bill.target)} a month`);
    parts.push(`${dollars(bill.balance)} of ${dollars(bill.target)}${maskSuffix}`);
  }
  return parts.join(" · ");
}

/** The bill's own words, said back for a target it doesn't have yet -- design #2d's real
 *  example is `say "water is about 40"`; this is the same capture-grammar prompt for any bill,
 *  not a fabricated real amount (no target exists yet to report). */
function noTargetPrompt(bill) {
  return `say "${bill.name.toLowerCase()} is about 50"`;
}

/** % funded badge (Git #3207, design #2d): red under 30%, amber mid-range, emerald at 100% --
 *  replaces the old binary funded/short status text and the per-bill bar the design explicitly
 *  rejects ("No per-bill bars; the badge and the '$x of $y' line carry it"). */
function moneyPercentBadge(bill) {
  const percent = bill.fundedPercent;
  const tone = percent >= 100 ? "emerald" : percent >= 30 ? "amber" : "red";
  return el("span", { class: `money-percent-badge ${tone}`, text: `${percent}%` });
}

/** `showGateBadge` is for the Bills tab (Git #3148): unlike Now's Protected/Urgent/Already
 *  handled buckets, which already segregate gate bills into their own section, the Bills tab
 *  lists every bill account together, so it needs the inline "gate" badge to say which ones.
 *
 *  Git #3207: a bill with real months of unpaid arrears gets the same rotated -5deg red sticker
 *  the rest of the app already uses for critical (`sticker()`, design #2d: "'Months behind' is
 *  the −5° sticker the rest of the app uses for critical"), next to its name. */
function moneyBillRow(bill, { showGateBadge = false, onOpenDetail = null } = {}) {
  const nameChildren = [el("span", { text: bill.name })];
  if (showGateBadge && bill.isGate) nameChildren.push(el("span", { class: "chip gate", text: "gate" }));
  if (bill.monthsBehind) {
    nameChildren.push(sticker("red", `${bill.monthsBehind} month${bill.monthsBehind === 1 ? "" : "s"} behind`));
  }

  let statusEl;
  if (bill.target === null) {
    statusEl = el("span", { class: "money-bucket-status", text: noTargetPrompt(bill) });
  } else if (bill.warning) {
    statusEl = el("span", { class: "money-bucket-status critical", text: bill.warning });
  } else {
    statusEl = moneyPercentBadge(bill);
  }

  const row = el("div", { class: "money-bucket-row" }, [
    el("div", { class: "money-bucket-name" }, [
      el("div", { class: "row", style: "gap:.4rem" }, nameChildren),
      el("div", { class: "money-bucket-meta", text: moneyBillMeta(bill) }),
    ]),
    statusEl,
  ]);
  // Git #3212: tapping a real bill row opens the real bottom-sheet detail view -- envelope
  // breakdown, funding-history sparkline, Vault link. Optional (needs a real `bill.id`).
  if (onOpenDetail && bill.id) {
    row.style.cursor = "pointer";
    row.addEventListener("click", () => onOpenDetail(bill.id));
  }
  return row;
}

// ---------------------------------------------------------------------------
// Bill detail sheet (Git #3212, design `Shanes Life 17 - Money v3.dc.html` option 1e)
// ---------------------------------------------------------------------------
//
// Resolved on #3209: the rolled-over/this-cycle envelope split is a real, lightweight COMPUTED
// VIEW over two real Plaid balances (money.mjs's own header on getBillDetail has the full real
// arithmetic) -- never a separate assigned/envelopeBalance shadow ledger. One real read,
// GET /api/money/bills/:id, no client-side math beyond formatting.

/** Same tiny helper as `el()` (line 364) but for the SVG namespace -- `document.createElement`
 *  produces an HTMLUnknownElement for svg/polyline/etc, so real SVG nodes need `createElementNS`. */
function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? "" : v);
  }
  return node;
}

/** The funding-history sparkline -- same real visual language as `debtPayoffSparklineHtml`
 *  (Git #3210): a real polyline over real `bill_cycle_snapshots` points, honestly just a dot
 *  when only one real cycle has been captured so far. Wider than the debt one (this is the only
 *  chart on the sheet, not an inline row accessory) and labeled with the real first/last cycle
 *  dates underneath, same as the design's "Jun 12 ... Sep 18" caption.
 *
 *  Git #3240: real pointer/touch drag-to-scrub, deferred from #3212. `onScrub(point | null)` is
 *  called with the nearest real data point while a drag/tap is active over the chart, and with
 *  `null` on release -- the caller (openBillDetailSheet) owns the "Aug 21 · $520 of $612" callout
 *  label above the chart; this function only owns the SVG and its own dashed marker + dot. */
function billSparklineNode(sparkline, onScrub) {
  const W = 338, H = 64, PAD_Y = 8;
  const svg = svgEl("svg", {
    width: W,
    height: H,
    viewBox: `0 0 ${W} ${H}`,
    style: `display:block;width:100%;height:${H}px`,
  });
  if (!sparkline || sparkline.length === 0) return svg;

  const balances = sparkline.map((p) => Number(p.balance));
  const min = Math.min(0, ...balances);
  const max = Math.max(...balances, 1);
  const range = max - min || 1;
  const n = balances.length;

  const coords = balances.map((balance, i) => {
    const x = n === 1 ? W - 1 : 1 + (i / (n - 1)) * (W - 2);
    const y = PAD_Y + (1 - (balance - min) / range) * (H - PAD_Y * 2);
    return [x, y];
  });
  const [lastX, lastY] = coords[coords.length - 1];

  if (n > 1) {
    svg.append(
      svgEl("polyline", {
        fill: "none",
        stroke: "#60a5fa",
        "stroke-width": 2,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
        points: coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "),
      }),
    );
  }
  svg.append(svgEl("circle", { cx: lastX.toFixed(1), cy: lastY.toFixed(1), r: 3, fill: "#60a5fa" }));

  // Real "drag to scrub" marker (design 1e: a dashed vertical line + a ringed dot at the nearest
  // real point), hidden until a pointer/touch is actually down on the chart -- no interaction, no
  // marker, same honesty rule as the rest of this sheet.
  if (n > 1 && typeof onScrub === "function") {
    const scrubLine = svgEl("line", {
      x1: 0, y1: 0, x2: 0, y2: H,
      stroke: "rgba(238,242,248,.4)",
      "stroke-dasharray": "2 3",
      visibility: "hidden",
    });
    const scrubDot = svgEl("circle", {
      cx: 0, cy: 0, r: 5.5,
      fill: "var(--card, #1c1c1e)",
      stroke: "#60a5fa",
      "stroke-width": 2,
      visibility: "hidden",
    });
    svg.append(scrubLine, scrubDot);

    const nearestIndex = (clientX) => {
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return 0;
      const frac = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
    };
    const showAt = (index) => {
      const [x, y] = coords[index];
      scrubLine.setAttribute("x1", x.toFixed(1));
      scrubLine.setAttribute("x2", x.toFixed(1));
      scrubLine.setAttribute("visibility", "visible");
      scrubDot.setAttribute("cx", x.toFixed(1));
      scrubDot.setAttribute("cy", y.toFixed(1));
      scrubDot.setAttribute("visibility", "visible");
      onScrub(sparkline[index]);
    };
    const hide = () => {
      scrubLine.setAttribute("visibility", "hidden");
      scrubDot.setAttribute("visibility", "hidden");
      onScrub(null);
    };

    let dragging = false;
    svg.style.touchAction = "pan-y";
    svg.addEventListener("pointerdown", (e) => {
      dragging = true;
      svg.setPointerCapture(e.pointerId);
      showAt(nearestIndex(e.clientX));
    });
    svg.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      showAt(nearestIndex(e.clientX));
    });
    const release = (e) => {
      if (!dragging) return;
      dragging = false;
      if (svg.hasPointerCapture?.(e.pointerId)) svg.releasePointerCapture(e.pointerId);
      hide();
    };
    svg.addEventListener("pointerup", release);
    svg.addEventListener("pointercancel", release);
  }

  return svg;
}

/**
 * The real bottom-sheet bill detail view (Git #3212): balance vs. target, the real gate/%-funded
 * badges already established elsewhere in Money, the real rolled-over/this-cycle envelope
 * breakdown, the real funding-history sparkline, and the real "Payment reference in Vault ->"
 * link when one exists. Opened by tapping any bill row in Bills or Accounts.
 */
async function openBillDetailSheet(billId) {
  const dialog = el("dialog", { class: "sheet" });
  dialog.append(el("p", { class: "small muted", text: "Loading…" }));
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();

  let d;
  try {
    d = await api(`/api/money/bills/${encodeURIComponent(billId)}`);
  } catch (err) {
    dialog.replaceChildren(
      el("div", { class: "spread" }, [
        el("span", { class: "sheet-title", text: "Bill" }),
        el("button", { class: "ghost small", text: "Close", onClick: () => dialog.close() }),
      ]),
      el("p", { class: "small", style: "margin-top:.75rem", text: err?.message || "Could not load that bill." }),
    );
    return;
  }

  const nameChildren = [el("span", { style: "font-size:20px;font-weight:800;letter-spacing:-.01em", text: d.name })];
  if (d.isGate) nameChildren.push(el("span", { class: "chip gate", text: "gate" }));
  if (d.monthsBehind) nameChildren.push(sticker("red", `${d.monthsBehind} month${d.monthsBehind === 1 ? "" : "s"} behind`));

  const head = el("div", { class: "row", style: "justify-content:space-between;align-items:flex-start;gap:12px" }, [
    el("div", { style: "min-width:0" }, [
      el("div", { class: "row", style: "gap:.5rem;align-items:center;flex-wrap:wrap" }, nameChildren),
      el("div", { class: "small muted", style: "margin-top:3px", text: d.autoPaysLine }),
    ]),
    d.target !== null && !d.warning ? moneyPercentBadge(d) : null,
  ]);

  const bigBalance = el("div", { style: "display:flex;align-items:baseline;gap:10px;margin-top:14px;flex-wrap:wrap" }, [
    el("span", { style: "font-size:32px;font-weight:800;letter-spacing:-.02em", text: dollars(d.balance) }),
    el("span", {
      class: "small muted",
      text: d.target === null ? "no target set yet" : `in the envelope · target ${dollars(d.target)}`,
    }),
  ]);

  const breakdownRows = [];
  if (d.envelope.hasCycleSnapshot) {
    breakdownRows.push(["Rolled over from last cycle", dollars(d.envelope.rolledOver)]);
    breakdownRows.push(["This cycle's contribution", dollars(d.envelope.thisCycleContribution)]);
  }
  if (d.target !== null) {
    breakdownRows.push(d.funded ? ["Funded", dollars(0)] : ["Short of target", dollars(d.shortfall)]);
  }
  const breakdown =
    breakdownRows.length > 0
      ? el(
          "div",
          { class: "bill-sheet-breakdown" },
          breakdownRows.map(([label, value], i) =>
            el("div", { class: "bill-sheet-breakdown-row", style: i > 0 ? "border-top:1px solid hsl(var(--card-border) / .6)" : "" }, [
              el("span", { style: "flex:1", text: label }),
              el("span", { style: "font-weight:600", text: value }),
            ]),
          ),
        )
      : null;

  const cycleNote = el("p", {
    class: "small muted",
    style: "margin-top:10px",
    text: d.envelope.hasCycleSnapshot
      ? "Reassigning applies a delta, never an overwrite: a cycle reset leaves the rolled-over amount alone."
      : "Still building real cycle history for this bill -- the rolled-over/this-cycle split appears once a real cycle boundary has been captured.",
  });

  // Git #3240: the callout label lives above the chart, same slot as the design's own
  // "Aug 21 · $520 of $612" -- blank until a real drag/tap actually names a real point.
  const scrubCallout = el("span", {
    class: "small",
    style: "font-weight:600;color:#60a5fa;white-space:nowrap",
  });
  const scrubHint = el("span", { class: "small muted", text: "drag to scrub" });
  const onScrub = (point) => {
    scrubCallout.textContent = point
      ? point.targetAtRead !== null && point.targetAtRead !== undefined
        ? `${point.label} · ${dollars(point.balance)} of ${dollars(point.targetAtRead)}`
        : `${point.label} · ${dollars(point.balance)}`
      : "";
  };

  const sparklineSection = el("div", { style: "margin-top:14px" }, [
    el("div", { class: "row", style: "justify-content:space-between;align-items:baseline;gap:8px" }, [
      el("span", {
        class: "small muted",
        style: "text-transform:uppercase;letter-spacing:.1em;font-weight:600;font-size:.68rem",
        text: `Funded at each payday · ${d.sparkline.length} real cycle${d.sparkline.length === 1 ? "" : "s"}`,
      }),
      scrubCallout,
    ]),
    el("span", { style: "display:block;margin-top:6px" }, [billSparklineNode(d.sparkline, onScrub)]),
    d.sparkline.length > 0
      ? el("div", { class: "row", style: "justify-content:space-between", "aria-hidden": "true" }, [
          el("span", { class: "small muted", text: d.sparkline[0].label }),
          d.sparkline.length > 1 ? scrubHint : null,
          el("span", { class: "small muted", text: d.sparkline[d.sparkline.length - 1].label }),
        ])
      : el("p", { class: "small muted", text: "No real cycle history captured yet." }),
  ]);

  const vaultLinkEl = d.vaultEntry
    ? el(
        "button",
        {
          type: "button",
          class: "bill-sheet-vault-link",
          onClick: () => {
            dialog.close();
            moneyTab = "vault";
            render();
          },
        },
        [
          lineIcon('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>', { size: 14, strokeWidth: 2 }),
          el("span", { text: "Payment reference in Vault" }),
          el("span", { style: "margin-left:auto", text: "→" }),
        ],
      )
    : el("p", { class: "small muted", style: "margin-top:10px", text: "No Vault entry linked to this bill yet." });

  const previewBtn = el("button", {
    type: "button",
    class: "ghost small",
    style: "margin-top:14px",
    text: "Preview a hypothetical target →",
    onClick: () => {
      dialog.close();
      openEditBalanceSheet({
        id: d.id,
        name: d.name,
        targetFormatted: d.target === null ? null : dollars(d.target),
        balanceFormatted: dollars(d.balance),
      });
    },
  });

  dialog.replaceChildren(
    el("div", { class: "spread" }, [
      el("span", { class: "sheet-title", text: "Bill" }),
      el("button", { class: "ghost small", text: "Close", onClick: () => dialog.close() }),
    ]),
    el("div", { class: "sheet-body" }, [
      head,
      bigBalance,
      breakdown,
      cycleNote,
      sparklineSection,
      vaultLinkEl,
      previewBtn,
    ]),
  );
}

/** One real one-time pending event -- +$6,000 roof reimbursement, -$2,500 deductible -- shown
 *  on the Bills tab, "not counted until real" (Git #3148, design README screen 7's own words).
 *  Never folded into the shortfall math; money.mjs's getGateStatus() already keeps these
 *  separate (countedInMath: false) for exactly this reason. */
function moneyEventRow(ev) {
  const note = [ev.contingencyNotes, ev.expectedDate ? `expected ${ev.expectedDate}` : null, ev.status !== "pending" ? ev.status : null]
    .filter(Boolean)
    .join(" · ");
  return el("div", { class: "money-bucket-row" }, [
    el("div", { class: "money-bucket-name" }, [
      el("div", { text: ev.description }),
      note ? el("div", { class: "money-bucket-meta", text: note }) : null,
    ]),
    el("span", {
      class: `money-bucket-status ${ev.direction}`,
      text: `${ev.direction === "inflow" ? "+" : "−"}${dollars(ev.amount)}`,
    }),
  ]);
}

function moneyDebtRow(debt) {
  return el("div", { class: "money-bucket-row" }, [
    el("div", { class: "money-bucket-name" }, [
      el("div", { text: debt.creditor }),
      el("div", {
        class: "money-bucket-meta",
        text: ["critical", debt.isDelinquent ? `${debt.daysPastDue ?? "?"} days past due` : null, debt.notes]
          .filter(Boolean)
          .join(" · "),
      }),
    ]),
    el("span", { class: "money-bucket-status critical", text: dollars(debt.balance) }),
  ]);
}

// ---------------------------------------------------------------------------
// Accounts -> "Debts · critical first" overlay (Git #3210)
// ---------------------------------------------------------------------------
//
// Design `Shanes Life 17 - Money v3.dc.html` option 1d: real critical debts, each with a real
// payoff-progress sparkline, "same rows as ShanesSurvival". Real data from
// GET /api/money/debts/critical-overlay (money.mjs's getCriticalDebtOverlay) -- the sparkline
// points are real `debt_balance_history` snapshots, not fixture data; right after this ships
// there's only ever one real point per debt (today's), and the line fills in honestly as real
// payments land.

/** Small inline SVG line -- same visual language as the design's own polyline+dot, computed from
 *  real `{ date, balance }` points (dollars). A single real point draws just the dot; this is
 *  correct, not a bug -- there is no fabricated second point to connect it to. */
function debtPayoffSparklineHtml(sparkline) {
  const W = 64, H = 20, PAD_Y = 3;
  if (!sparkline || sparkline.length === 0) return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"></svg>`;

  const balances = sparkline.map((p) => Number(p.balance));
  const min = Math.min(...balances);
  const max = Math.max(...balances);
  const range = max - min || 1;
  const n = balances.length;

  const coords = balances.map((balance, i) => {
    const x = n === 1 ? W - 1 : 1 + (i / (n - 1)) * (W - 2);
    const y = n === 1 ? H / 2 : PAD_Y + (1 - (balance - min) / range) * (H - PAD_Y * 2);
    return [x, y];
  });
  const [lastX, lastY] = coords[coords.length - 1];
  const polyline =
    n > 1
      ? `<polyline fill="none" stroke="#60a5fa" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points="${coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}"></polyline>`
      : "";
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${polyline}<circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.2" fill="#60a5fa"></circle></svg>`;
}

function criticalDebtOverlayRow(debt) {
  const meta = [
    debt.minimumPayment ? `${dollars(debt.minimumPayment)}/mo` : null,
    debt.dueDay ? `due day ${debt.dueDay}` : null,
    debt.isDelinquent ? `${debt.daysPastDue ?? "?"} days past due` : null,
    debt.lastPaymentDate ? `last payment ${debt.lastPaymentDate}` : null,
  ].filter(Boolean);

  return el("div", { class: "money-bucket-row" }, [
    el("div", { class: "money-bucket-name" }, [
      el("div", { class: "row", style: "gap:.4rem;align-items:center" }, [
        el("span", { text: debt.creditor }),
        el("span", { class: "chip", text: "critical" }),
      ]),
      meta.length ? el("div", { class: "money-bucket-meta", text: meta.join(" · ") }) : null,
    ]),
    el("span", { style: "flex-shrink:0", html: debtPayoffSparklineHtml(debt.sparkline) }),
    el("span", { class: "money-bucket-status critical", text: dollars(debt.balance) }),
  ]);
}

async function appendCriticalDebtOverlayCard(view) {
  const overlay = await api("/api/money/debts/critical-overlay");
  if (overlay.debts.length === 0) return;

  const card = el("div", { class: "card money-bucket" }, [
    el("div", { class: "money-bucket-label", text: "Debts · critical first · same rows as ShanesSurvival" }),
    ...overlay.debts.map(criticalDebtOverlayRow),
  ]);
  if (overlay.summaryText) {
    card.append(el("p", { class: "small muted", style: "padding:0 1rem .7rem", text: overlay.summaryText }));
  }
  view.append(card);
}

/** Renders the what-if / transfer-simulator result inside an already-appended container, or
 *  empties it when there is nothing to show -- so "Clear" and re-asking both just re-call this. */
function renderMoneyResult(container, kind, result) {
  container.replaceChildren();
  if (!result) return;

  if (kind === "whatif") {
    const box = el("div", { class: "money-result-box whatif" }, [
      el("div", { style: "flex:1;min-width:0" }, [
        result.answerable ? el("div", { class: "money-result-head", text: result.headline }) : null,
        el("div", { text: result.text }),
      ]),
      el("button", { type: "button", class: "money-result-clear", text: "Clear", onClick: () => renderMoneyResult(container, kind, null) }),
    ]);
    container.append(box);
    return;
  }

  // transfer
  const box = el("div", { class: "money-result-box transfer" }, [
    el("div", { style: "display:flex;align-items:flex-start;gap:10px" }, [
      el("div", { style: "flex:1;min-width:0" }, [
        result.headline ? el("div", { class: "money-result-head", text: result.headline }) : null,
        el("div", { text: result.text }),
      ]),
      el("button", { type: "button", class: "money-result-clear", text: "Clear", onClick: () => renderMoneyResult(container, kind, null) }),
    ]),
    result.borrowedFromBill ? el("div", { class: "money-result-borrowed", text: result.borrowedFromBill }) : null,
    result.resolvable ? el("div", { class: "money-result-footer", text: result.footer }) : null,
  ]);
  container.append(box);
}

// Money -> Vault (Git #3150, widened into a real full password vault by Git #3242)
// ---------------------------------------------------------------------------
//
// The bill-payment reference vault. Design contract Section 9 flags it as "a real security
// requirement, not optional polish", and handoff README §7 is the layout spec: "lock note, rows
// with site + masked reference + Reveal (passkey overlay -> full value shown 20 s -> Copy).
// Copy clears the clipboard in 60 s."
//
// #3242 made it hold every real login rather than a handful of bill-payment references -- a real
// LastPass replacement, minus autofill, which is its own Feature (#3243) and not something this
// room can fake. Nothing about the security model got lighter for holding more: same key, same
// per-entry passkey assertion, same 20-second window, same audit row. The two visible additions
// are a real server-side search and a kind filter, and neither of them can reach a password --
// see listEntries: there is no plaintext password in the database to search.
//
// The real security lives on the server (src/core/vault.mjs + the /api/vault* routes): the
// plaintext is AES-256-GCM ciphertext in the column, the key is outside the database, and every
// reveal costs a real WebAuthn assertion bound to that one entry and writes a real vault_reveals
// row. Nothing here can weaken any of that -- this file never holds a ciphertext and cannot ask
// for a plaintext without an assertion the server verifies itself.
//
// What this file IS responsible for is the second half of the promise: that a revealed value
// stops being on screen. That is a real timer against the server's own `expiresAt`, not a
// decorative one, and the plaintext is dropped from JS memory when it fires.

/** The one entry currently revealed, and the timers keeping that honest. Module scope because
 *  only ever ONE value is on screen: revealing a second entry has to put the first one back
 *  behind its mask, not leave two plaintexts sitting there with only one live countdown. */
let vaultReveal = null; // { id, value, expiresAt, tick, restore }
let vaultClipboardTimer = null;

/** Transient client-only room state, same idiom as `moneyTab` above. Kept at module scope rather
 *  than inside the view so that a re-render after adding an entry lands back on the same filter
 *  and the same search instead of silently resetting them under Shane. */
let vaultQuery = "";
let vaultKindFilter = "all";

// -- Browser extension autofill bridge (Git #3243) -----------------------------------------
//
// #3243's own "how does the extension prove it's really Shane" question is answered by NOT
// giving the extension a credential of its own: the extension's background worker opens this
// app's own real, already-signed-in origin in a plain popup window carrying `?extReveal=<id>
// &extNonce=<n>` (see web/shanes-life/extension/background.js), and this is that popup's whole
// job -- run the EXACT SAME per-entry WebAuthn reveal ceremony the Vault room's own "Reveal"
// button runs (nothing here calls a different endpoint or skips a step), then hand the result
// back across the extension boundary via a plain DOM CustomEvent, which
// web/shanes-life/extension/bridge.js (a content script matched only to this app's own origin)
// relays into the extension's message bus. A page here has no way to talk to extension code
// directly, and a CustomEvent is the standard way across that boundary.
//
// Read once, off the real query string (not the hash -- the app's hash router already owns
// that, see parseRoute) at module load, before anything else touches the URL.
const extensionReveal = (() => {
  const params = new URLSearchParams(location.search);
  const id = params.get("extReveal");
  const nonce = params.get("extNonce");
  return id && nonce ? { id, nonce, handled: false } : null;
})();

/** Runs the real reveal ceremony for the one entry the extension asked for, then reports the
 *  outcome back across the page/extension boundary and closes the popup. Called once, from
 *  viewMoneyVault, after its own entries list is loaded -- so this never invents a lookup path
 *  the Vault room doesn't already have. */
async function completeExtensionReveal(entries) {
  if (!extensionReveal || extensionReveal.handled) return;
  extensionReveal.handled = true;

  const entry = entries.find((e) => e.id === extensionReveal.id);
  const fail = (reason, message) => {
    window.dispatchEvent(
      new CustomEvent("sl:extension-reveal-error", { detail: { nonce: extensionReveal.nonce, reason, message } }),
    );
  };

  if (!entry) return fail("not-found", "That vault entry no longer exists.");
  if (entry.kind !== "login") return fail("wrong-kind", "That entry isn't a login.");

  try {
    const options = await api(`/api/vault/${entry.id}/reveal/options`, { method: "POST", body: "{}" });
    const revealed = await api(`/api/vault/${entry.id}/reveal`, {
      method: "POST",
      body: JSON.stringify(await passkeyAssertion(options)),
    });
    window.dispatchEvent(
      new CustomEvent("sl:extension-reveal", {
        detail: { nonce: extensionReveal.nonce, value: revealed.value, username: entry.username || null },
      }),
    );
  } catch (err) {
    fail("reveal-failed", err?.message || "That did not reveal.");
  } finally {
    // A window this app didn't open itself can't close; one the extension opened, can.
    setTimeout(() => window.close(), 400);
  }
}

const VAULT_KIND_FILTERS = [
  { key: "all", label: "All" },
  { key: "login", label: "Logins" },
  { key: "bill_reference", label: "Bill refs" },
];

function hideVaultReveal() {
  if (!vaultReveal) return;
  clearInterval(vaultReveal.tick);
  const { restore } = vaultReveal;
  vaultReveal = null; // dropped before restore(), so the plaintext is gone even if that throws
  restore();
}

/** The design's Face ID overlay — "passkey overlay 900ms" in the README, except this one is up
 *  for exactly as long as the real assertion takes, which is the honest version of that. */
function vaultFaceOverlay() {
  const node = el("div", { class: "vault-face-overlay" }, [
    el("div", { class: "vault-face-ring" }, [
      lineIcon(
        '<path d="M8 14s1.5 2 4 2 4-2 4-2"></path><path d="M9 9h.01"></path><path d="M15 9h.01"></path>',
        { size: 46, strokeWidth: 2 },
      ),
    ]),
    el("div", { class: "vault-face-label", text: "Face ID to reveal" }),
  ]);
  document.body.append(node);
  return node;
}

/**
 * A real password generator (Git #3242). Replacing LastPass means replacing the thing that made
 * strong passwords possible in the first place — a lookup tool that still leaves Shane inventing
 * his own passwords has replaced the filing cabinet and not the reason for it.
 *
 * `crypto.getRandomValues`, never `Math.random`, and rejection sampling rather than `% alphabet`
 * — a modulo over a 256-value byte biases the first few characters of the alphabet, which is a
 * real (if small) weakness in the one thing here that exists to be unguessable. The generated
 * value is a plain client-side string until it is POSTed exactly like a typed one; it is never
 * derived server-side, so the server never sees a password it could have predicted.
 */
function generatePassword(length = 20) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+?";
  const limit = 256 - (256 % alphabet.length); // the biased tail, discarded rather than folded in
  let out = "";
  const buf = new Uint8Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (byte >= limit) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** Copy, then start the real 60-second clipboard wipe. Shared by the username copy (no assertion
 *  needed — a username is not the secret) and the revealed-password copy. */
async function vaultCopy(text, message, clearSeconds) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    showQuickToast("This browser wouldn't let the app write to the clipboard.");
    return;
  }
  showQuickToast(message);
  // The real wipe. Best-effort by nature: a browser can refuse a clipboard write with no user
  // gesture behind it, and nothing can clear a clipboard the user has already pasted from --
  // so this narrows the window rather than pretending to close it.
  if (vaultClipboardTimer) clearTimeout(vaultClipboardTimer);
  vaultClipboardTimer = setTimeout(async () => {
    try {
      await navigator.clipboard.writeText("");
    } catch {
      /* refused without a gesture; the 20-second display window is the real guarantee */
    }
  }, (clearSeconds ?? 60) * 1000);
}

/**
 * One vault row. Masked by default, always — the full value only ever replaces the mask after
 * `onReveal` has come back from a real, server-verified assertion.
 *
 * A login row (Git #3242) shows one more thing than a bill reference does, and deliberately only
 * one: the username, with its own Copy, unmasked and free. That is not a softening of the
 * security model — the username is the half of a credential that is printed on the sign-in page
 * anyway, and making it cost a passkey assertion would spend the assertion on the wrong half
 * while training the habit that assertions are cheap. The password stays behind the mask.
 */
function vaultRow(entry, { onReveal, onCopy, clipboardClearSeconds, onChanged }) {
  const isLogin = entry.kind === "login";
  const secretBox = el("div", { class: "vault-secret" });
  const maskEl = el("div", { class: "vault-masked", text: entry.masked });
  const revealBtn = el("button", { type: "button", class: "vault-reveal-btn", text: "Reveal" });
  const errorEl = el("div", { class: "vault-row-error", hidden: true });

  // Git #3248: edit and delete onto the same PATCH/DELETE /api/vault/:id that #3150 already
  // shipped and tested -- the room could create and reveal an entry but never fix or remove one,
  // so a wrong entry (rotated password, moved username, closed account) stayed wrong forever.
  const editBtn = el("button", { type: "button", class: "vault-copy-btn ghostish", text: "Edit" });
  const deleteBtn = el("button", { type: "button", class: "vault-copy-btn ghostish danger", text: "Delete" });
  const editForm = el("div", { class: "vault-edit-form", hidden: true });

  // The real username line, with its own copy — the whole daily point of a password manager
  // without autofill is that neither half has to be retyped from a screenshot.
  const usernameRow = entry.username
    ? el("div", { class: "vault-username-row" }, [
        el("span", { class: "vault-username", text: entry.username }),
        el("button", {
          type: "button",
          class: "vault-copy-btn ghostish",
          text: "Copy user",
          onClick: () =>
            vaultCopy(entry.username, "Username copied — clears in 60 seconds.", clipboardClearSeconds),
        }),
      ])
    : null;

  // Real password age, off `secret_updated_at` (migration 052) — the one number that answers "how
  // old is this password", which `updated_at` cannot because renaming a row moves it too.
  const ageEl =
    isLogin && entry.secretUpdatedAt
      ? el("div", { class: "vault-row-site", text: `password set ${agoShort(entry.secretUpdatedAt)}` })
      : null;

  const row = el("div", { class: "vault-row" }, [
    el("div", { class: "vault-row-head" }, [
      el("div", { class: "vault-row-name" }, [
        el("div", { class: "vault-row-label" }, [
          el("span", { text: entry.label }),
          entry.hasNotes ? el("span", { class: "vault-notes-chip", text: "notes" }) : null,
        ]),
        entry.site
          ? el("div", { class: "vault-row-site", text: isLogin ? entry.site : `pay at ${entry.site}` })
          : null,
        // Git #3212: the other half of the bill sheet's "Payment reference in Vault ->" link --
        // real, so an entry already linked to a bill account says so here too.
        entry.billAccountName ? el("div", { class: "vault-row-site", text: `for ${entry.billAccountName}` }) : null,
        ageEl,
      ]),
      el("div", { class: "vault-row-actions" }, [editBtn, deleteBtn, revealBtn]),
    ]),
    usernameRow,
    maskEl,
    secretBox,
    errorEl,
    editForm,
  ]);

  function showMasked() {
    secretBox.replaceChildren();
    maskEl.hidden = false;
    revealBtn.hidden = false;
  }

  function showValue(revealed) {
    maskEl.hidden = true;
    revealBtn.hidden = true;

    const countdown = el("span", { class: "vault-countdown" });
    const copyBtn = el("button", {
      type: "button",
      class: "vault-copy-btn",
      text: "Copy",
      onClick: () => onCopy(revealed),
    });
    secretBox.replaceChildren(
      el("div", { class: "vault-value-box" }, [
        el("span", { class: "vault-value", text: revealed.value }),
        countdown,
        copyBtn,
      ]),
      // Notes ride the same window and the same assertion (see vault.reveal's own note): a
      // recovery code sitting beside a password is worth no less than the password.
      revealed.notes ? el("pre", { class: "vault-notes", text: revealed.notes }) : null,
    );

    // The real window, measured against the server's own deadline rather than a local 20s
    // countdown started whenever this happened to render — the two cannot drift apart.
    const deadline = new Date(revealed.expiresAt).getTime();
    const secondsLeft = () => Math.ceil((deadline - Date.now()) / 1000);
    const tick = setInterval(() => {
      // The room can be navigated away from mid-window. A detached node still holds the value,
      // so the timer has to notice and drop it rather than counting down into nothing.
      if (!row.isConnected || secondsLeft() <= 0) {
        hideVaultReveal();
        return;
      }
      countdown.textContent = `${secondsLeft()}s`;
    }, 250);
    countdown.textContent = `${Math.max(0, secondsLeft())}s`;

    // Whatever was revealed before this goes back behind its own mask first -- one value on
    // screen at a time, each with a live countdown that is genuinely counting it down.
    hideVaultReveal();
    vaultReveal = {
      id: entry.id,
      value: revealed.value,
      expiresAt: revealed.expiresAt,
      tick,
      restore: showMasked,
    };
  }

  revealBtn.addEventListener("click", async () => {
    errorEl.hidden = true;
    revealBtn.disabled = true;
    const overlay = vaultFaceOverlay();
    try {
      showValue(await onReveal(entry));
    } catch (err) {
      // A cancelled Face ID prompt is a decision, not a failure worth shouting about — same
      // judgement the sign-in screen already makes.
      if (err && (err.name === "NotAllowedError" || err.name === "AbortError")) return;
      errorEl.textContent = err?.message || "That did not reveal.";
      errorEl.hidden = false;
    } finally {
      overlay.remove();
      revealBtn.disabled = false;
    }
  });

  // Real edit -- prefilled from the masked entry the room already has, never a re-reveal. The
  // whole point (see this function's own header) is that fixing a label or rotating a password
  // must not cost re-typing the password just to change what's around it: `secret` is only sent
  // if the "New password" field is actually filled in, and `updateEntry` leaves the ciphertext
  // (and secret_updated_at) alone when it's omitted.
  function openEdit() {
    errorEl.hidden = true;
    const labelInput = el("input", { "aria-label": "What this is for", value: entry.label, required: true });
    const siteInput = el("input", { "aria-label": "Site", value: entry.site || "" });
    const usernameInput = isLogin
      ? el("input", { autocomplete: "off", "aria-label": "Username", value: entry.username || "" })
      : null;
    const maskedInput = !isLogin
      ? el("input", { "aria-label": "Masked hint shown by default", value: entry.masked || "" })
      : null;
    const secretInput = el("input", {
      type: "password",
      autocomplete: "new-password",
      "aria-label": isLogin ? "New password (leave blank to keep the current one)" : "New account number (leave blank to keep the current one)",
      placeholder: isLogin ? "New password — leave blank to keep the current one" : "New account number — leave blank to keep the current one",
    });
    const generateBtn = isLogin ? el("button", { type: "button", class: "ghost small", text: "Generate" }) : null;
    generateBtn?.addEventListener("click", () => {
      secretInput.type = "text";
      secretInput.value = generatePassword();
      secretInput.focus();
    });
    const editError = el("p", { class: "vault-row-error", hidden: true });
    const saveBtn = el("button", { type: "submit", class: "primary small", text: "Save" });
    const cancelBtn = el("button", { type: "button", class: "ghost small", text: "Cancel" });

    const form = el("form", { class: "vault-edit-fields" }, [
      el("div", { class: "row" }, [labelInput, siteInput]),
      usernameInput ? el("div", { class: "row" }, [usernameInput]) : null,
      maskedInput ? el("div", { class: "row" }, [maskedInput]) : null,
      el("div", { class: "row" }, [secretInput, generateBtn]),
      editError,
      el("div", { class: "vault-edit-actions" }, [saveBtn, cancelBtn]),
    ]);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const cleanLabel = labelInput.value.trim();
      if (!cleanLabel) return;
      editError.hidden = true;
      const controls = form.querySelectorAll("input,button,textarea");
      controls.forEach((n) => (n.disabled = true));
      const patch = {};
      if (cleanLabel !== entry.label) patch.label = cleanLabel;
      if (siteInput.value.trim() !== (entry.site || "")) patch.site = siteInput.value.trim();
      if (usernameInput && usernameInput.value.trim() !== (entry.username || "")) {
        patch.username = usernameInput.value.trim();
      }
      if (maskedInput && maskedInput.value.trim() !== (entry.masked || "")) patch.masked = maskedInput.value.trim();
      if (secretInput.value.trim()) patch.secret = secretInput.value.trim();
      try {
        await api(`/api/vault/${entry.id}`, { method: "PATCH", body: JSON.stringify(patch) });
        await onChanged();
      } catch (err) {
        editError.textContent = err?.message || "That did not save.";
        editError.hidden = false;
        controls.forEach((n) => (n.disabled = false));
      }
    });

    cancelBtn.addEventListener("click", () => closeEdit());

    editForm.replaceChildren(form);
    editForm.hidden = false;
    maskEl.hidden = true;
    secretBox.replaceChildren();
    revealBtn.hidden = true;
    editBtn.hidden = true;
    deleteBtn.hidden = true;
    labelInput.focus();
  }

  function closeEdit() {
    editForm.hidden = true;
    editForm.replaceChildren();
    editBtn.hidden = false;
    deleteBtn.hidden = false;
    showMasked();
  }

  editBtn.addEventListener("click", openEdit);

  // Delete is irreversible and takes the reveal history with it (ON DELETE CASCADE) -- a real
  // confirm step, same idiom this app already uses for other irreversible deletes (e.g. removing
  // a pet's care record), not a bare button one misclick away.
  deleteBtn.addEventListener("click", async () => {
    if (!confirm(`Delete "${entry.label}"? This can't be undone.`)) return;
    errorEl.hidden = true;
    deleteBtn.disabled = true;
    editBtn.disabled = true;
    try {
      await api(`/api/vault/${entry.id}`, { method: "DELETE" });
      await onChanged();
    } catch (err) {
      errorEl.textContent = err?.message || "That did not delete.";
      errorEl.hidden = false;
      deleteBtn.disabled = false;
      editBtn.disabled = false;
    }
  });

  showMasked();
  return row;
}

/**
 * The real add card (Git #3242 widened it from "add a reference" to the two real kinds).
 *
 * Git #3183 no-forms audit: deliberately kept, not missed. Contract pack Section 8's "no forms,
 * anywhere, ever" is itself scoped to what the capture-parsing layer can act on -- and the vault
 * has no MCP tool on purpose (Section 9: "genuinely sensitive, needs real security engineering,
 * not a casual text field"). Routing a real account number through the universal capture box
 * would mean it passes through Claude/MCP before encryption, which defeats the vault's entire
 * real security purpose. #3242 makes that exception stronger rather than weaker: `captures`
 * stores `body_text` in the clear and `list_captures` hands it to a Claude conversation over a
 * bearer token, so a password typed into the one box would be a plaintext password in a
 * plaintext column, readable from any chat, before the vault ever saw it. This stays a real
 * dedicated form; the value goes straight into an AES-256-GCM ciphertext server-side and is
 * never echoed back by any list or sent to Claude.
 */
function vaultAddCard(gate, onSaved) {
  let kind = vaultKindFilter === "bill_reference" ? "bill_reference" : "login";

  const labelInput = el("input", { "aria-label": "What this is for", required: true });
  const siteInput = el("input", { "aria-label": "Site" });
  const usernameInput = el("input", { autocomplete: "off", "aria-label": "Username", placeholder: "shane@example.com" });
  const secretInput = el("input", { type: "password", autocomplete: "new-password", "aria-label": "The secret", required: true });
  const generateBtn = el("button", { type: "button", class: "ghost small", text: "Generate" });
  const notesInput = el("textarea", { rows: 2, "aria-label": "Notes (encrypted)", placeholder: "Recovery codes, security answers — encrypted, same as the password" });
  const maskedInput = el("input", { "aria-label": "Masked hint shown by default" });
  // Git #3212: the other half of the bill sheet's real "Payment reference in Vault ->" link --
  // a real bill account this entry is the payment reference for, so the jump has somewhere real
  // to land. Only ever offered on a bill reference; a login is for nothing bill-specific.
  const billSelect = el(
    "select",
    { "aria-label": "Which bill this is the payment reference for (optional)" },
    [
      el("option", { value: "", text: "Not a bill payment reference" }),
      ...gate.bills.map((b) => el("option", { value: b.id, text: b.name })),
    ],
  );

  const usernameRow = el("div", { class: "row" }, [usernameInput]);
  const notesRow = el("div", { class: "row" }, [notesInput]);
  const billRow = el("div", { class: "row" }, [billSelect]);
  const maskedRow = el("div", { class: "row" }, [maskedInput]);
  const addError = el("p", { class: "vault-row-error", hidden: true });
  const title = el("h3", { class: "vault-add-title" });

  const kindTabs = el(
    "div",
    { class: "vault-add-kinds", role: "tablist" },
    [
      { key: "login", label: "Login" },
      { key: "bill_reference", label: "Bill reference" },
    ].map((k) =>
      el("button", {
        type: "button",
        class: "vault-add-kind",
        text: k.label,
        "data-kind": k.key,
        onClick: () => {
          kind = k.key;
          applyKind();
        },
      }),
    ),
  );

  function applyKind() {
    const login = kind === "login";
    for (const btn of kindTabs.children) {
      btn.classList.toggle("active", btn.dataset.kind === kind);
      btn.setAttribute("aria-selected", String(btn.dataset.kind === kind));
    }
    title.textContent = login ? "Add a login" : "Add a reference";
    labelInput.placeholder = login ? "Navy Federal" : "Mortgage · servicer";
    siteInput.placeholder = login ? "navyfederal.org" : "mrcooper.com";
    secretInput.placeholder = login ? "Password" : "Account number";
    secretInput.setAttribute("aria-label", login ? "The password" : "The account number");
    maskedInput.placeholder = "NFCU checking •••• 4821 (optional)";
    // A login's mask is a fixed dot run and nothing else -- letting a hint be written for one
    // would just be somewhere to accidentally write part of the password down in the clear.
    maskedRow.hidden = login;
    usernameRow.hidden = !login;
    notesRow.hidden = !login;
    billRow.hidden = login;
    generateBtn.hidden = !login;
  }

  generateBtn.addEventListener("click", () => {
    secretInput.type = "text"; // it has to be readable to be worth generating
    secretInput.value = generatePassword();
    secretInput.focus();
  });

  const form = el("form", { class: "section" }, [
    el("div", { class: "row" }, [labelInput, siteInput]),
    usernameRow,
    el("div", { class: "row" }, [secretInput, generateBtn]),
    notesRow,
    maskedRow,
    billRow,
    // Git #3195: primary CTA of this room's own kept form gets the same 999px pill treatment
    // Recipes (#3190) already proved out for a room's own primary action button.
    el("button", { type: "submit", class: "btn-pill primary vault-add-submit", text: "Add to the vault" }),
    addError,
  ]);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!labelInput.value.trim() || !secretInput.value.trim()) return;
    addError.hidden = true;
    const controls = form.querySelectorAll("input,button,select,textarea");
    controls.forEach((n) => (n.disabled = true));
    try {
      await api("/api/vault", {
        method: "POST",
        body: JSON.stringify({
          kind,
          label: labelInput.value,
          site: siteInput.value,
          username: kind === "login" ? usernameInput.value : null,
          secret: secretInput.value,
          notes: kind === "login" ? notesInput.value : null,
          masked: kind === "login" ? "" : maskedInput.value,
          billAccountId: kind === "login" ? null : billSelect.value || null,
        }),
      });
      // The password is out of this page's memory the moment it is stored, and the field goes
      // back to being a password field so a generated value can't sit there readable.
      secretInput.value = "";
      secretInput.type = "password";
      notesInput.value = "";
      await onSaved();
    } catch (err) {
      addError.textContent = err?.message || "That didn't save.";
      addError.hidden = false;
    } finally {
      controls.forEach((n) => (n.disabled = false));
    }
  });

  applyKind();
  // Git #3195: the vault's own list card above already got the 22px blob radius (#3242/#3150);
  // this kept add-entry card sat at the plain 16px `.card` radius right below it in the same
  // room -- a real, visible inconsistency, not a design choice. `.vault-card` is reused rather
  // than a new class since it's the same real card, same room, same radius.
  return el("div", { class: "card vault-card" }, [title, kindTabs, form]);
}

/**
 * A real LastPass CSV import (Git #3247). Same no-forms exception as vaultAddCard above, for the
 * same reason: this has to be a dedicated form, not the capture box and not an MCP tool, because
 * a plaintext CSV of every password Shane owns must never pass through `captures.body_text` or a
 * Claude conversation. The chosen file is read client-side with `File.text()` and POSTed whole to
 * `/api/vault/import` -- never staged anywhere else first.
 */
function vaultImportCard(onImported) {
  const fileInput = el("input", {
    type: "file",
    accept: ".csv,text/csv",
    "aria-label": "LastPass export (CSV)",
  });
  const importBtn = el("button", { type: "button", class: "ghost small", text: "Import" });
  const status = el("p", { class: "vault-row-error", hidden: true });

  importBtn.addEventListener("click", async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      status.className = "vault-row-error";
      status.textContent = "Choose a LastPass CSV export first.";
      status.hidden = false;
      return;
    }
    status.hidden = true;
    fileInput.disabled = true;
    importBtn.disabled = true;
    try {
      const text = await file.text();
      const { summary } = await api("/api/vault/import", {
        method: "POST",
        headers: { "content-type": "text/csv" },
        body: text,
      });
      const { created, updated, errors, total } = summary;
      status.className = errors ? "vault-row-error" : "small muted";
      status.textContent =
        `Imported ${created + updated} of ${total} (${created} new, ${updated} updated).` +
        (errors ? ` ${errors} row${errors === 1 ? "" : "s"} failed -- check the export for a missing password.` : "");
      status.hidden = false;
      fileInput.value = "";
      await onImported();
    } catch (err) {
      status.className = "vault-row-error";
      status.textContent = err?.message || "That import didn't work.";
      status.hidden = false;
    } finally {
      fileInput.disabled = false;
      importBtn.disabled = false;
    }
  });

  return el("div", { class: "card" }, [
    el("h3", { class: "vault-add-title", text: "Import from LastPass" }),
    el("p", {
      class: "small muted",
      text: "Export the LastPass vault as a CSV and bring it in here -- every login becomes a real, encrypted entry. Re-importing the same file updates matching entries by site and username instead of duplicating them.",
    }),
    el("div", { class: "row" }, [fileInput, importBtn]),
    status,
  ]);
}

async function viewMoneyVault(view) {
  const [first, gate] = await Promise.all([api("/api/vault"), api("/api/money/gate")]);
  const { keyConfigured, clipboardClearSeconds } = first;

  if (extensionReveal && !extensionReveal.handled) {
    view.append(
      el("div", { class: "vault-lock-note" }, [
        el("span", { text: "Confirm with Face ID to autofill this password in the browser extension…" }),
      ]),
    );
  }

  view.append(
    el("div", { class: "vault-lock-note" }, [
      lineIcon(
        '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>',
        { size: 14, strokeWidth: 2 },
      ),
      el("span", {
        text: "Encrypted at rest. Face ID every time. Revealed for 20 seconds, then gone. No screenshot round-trip.",
      }),
    ]),
  );

  // A real deployment fact, said out loud here rather than failing at the first Reveal tap: with
  // no SL_VAULT_KEY in the environment there is no key to decrypt with, and the honest answer is
  // that the room cannot work, not that the entries are missing.
  if (!keyConfigured) {
    view.append(
      el("div", { class: "card" }, [
        el("p", { text: "The vault's encryption key isn't set on this server, so nothing here can be added or revealed." }),
        el("p", { class: "small muted", text: "SL_VAULT_KEY needs 32 bytes of base64 randomness in the environment. It lives outside the database on purpose." }),
      ]),
    );
    attachRoomWatermark(view, "vault");
    return;
  }

  const copy = (revealed) =>
    vaultCopy(
      revealed.value,
      "Copied — Clears from the clipboard in 60 seconds. Never a screenshot.",
      clipboardClearSeconds,
    );

  const reveal = async (entry) => {
    const options = await api(`/api/vault/${entry.id}/reveal/options`, { method: "POST", body: "{}" });
    return api(`/api/vault/${entry.id}/reveal`, {
      method: "POST",
      body: JSON.stringify(await passkeyAssertion(options)),
    });
  };

  // Real search (Git #3242 scope item 2), run in the database. The list repaints in place rather
  // than through render(): a full re-render would rebuild the search box mid-keystroke and take
  // the caret with it.
  const searchInput = el("input", {
    type: "search",
    class: "vault-search",
    autocomplete: "off",
    placeholder: "Search a site, service or username…",
    "aria-label": "Search the vault",
    value: vaultQuery,
  });
  const filterRow = el("div", { class: "vault-filters" });
  const list = el("div");

  async function refresh() {
    // Anything revealed belongs to a row that is about to be thrown away — put it back behind its
    // mask first so the plaintext isn't left alive in a detached node with its own live timer.
    hideVaultReveal();
    const params = new URLSearchParams();
    if (vaultKindFilter !== "all") params.set("kind", vaultKindFilter);
    if (vaultQuery.trim()) params.set("q", vaultQuery.trim());
    const query = params.toString();
    const { entries, counts } = await api(`/api/vault${query ? `?${query}` : ""}`);

    // A real fresh WebAuthn assertion for the one entry the extension's popup asked for --
    // the same ceremony a normal "Reveal" tap below runs, just kicked off automatically since
    // there's nothing else to click in a bare popup window. Fires at most once per page load
    // (extensionReveal.handled), so the debounced search re-running refresh() doesn't re-prompt.
    if (extensionReveal && !extensionReveal.handled) completeExtensionReveal(entries);

    filterRow.replaceChildren(
      ...VAULT_KIND_FILTERS.map((f) =>
        el("button", {
          type: "button",
          class: `vault-filter${vaultKindFilter === f.key ? " active" : ""}`,
          text: `${f.label} ${counts[f.key === "all" ? "all" : f.key] ?? 0}`,
          onClick: () => {
            vaultKindFilter = f.key;
            refresh();
          },
        }),
      ),
    );

    if (entries.length === 0) {
      list.replaceChildren(
        vaultQuery.trim()
          ? empty(`Nothing in the vault matches "${vaultQuery.trim()}".`, "Search looks at the name, the site and the username — never the password, because there is no readable password to look at.", "notfound")
          : empty(
              "Nothing in the vault yet.",
              "A login and its password, or which site to pay a bill at and the account number that site needs. Add the first one below.",
              "vault",
            ),
      );
      return;
    }

    const card = el("div", { class: "vault-card" });
    for (const entry of entries) {
      card.append(vaultRow(entry, { onReveal: reveal, onCopy: copy, clipboardClearSeconds, onChanged: refresh }));
    }
    list.replaceChildren(card);
  }

  // Debounced so typing a site name is one settled query rather than one per keystroke.
  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    vaultQuery = searchInput.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refresh, 180);
  });
  // A search box inside a page that has no other form must not reload the page on Enter.
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") event.preventDefault();
  });

  view.append(el("div", { class: "vault-search-row" }, [searchInput]), filterRow, list);
  await refresh();

  view.append(
    el("p", {
      class: "vault-foot-note",
      text: "Every login, and which account number goes where. Real encryption from version one, flagged as a requirement, not polish.",
    }),
  );

  view.append(vaultAddCard(gate, refresh));
  view.append(vaultImportCard(refresh));

  // Room watermark (Git #3119): the critter spec's own room map says "Money Bills and Cars ->
  // bear, Vault -> vault".
  attachRoomWatermark(view, "vault");
}

// -- Money -> Important documents (Git #3244) ---------------------------------------------
//
// Wills, life insurance, and the like. Real, deliberate reuse of the vault's own visual
// language (vault-row/vault-value-box/etc. CSS classes, the Face ID overlay, the reveal
// countdown) rather than a second parallel set of styles for what is the same real security
// idiom on a different content type -- one encrypted-detail card, gated by a passkey, shown
// for 20 real seconds. `documentReveal` is this tab's own module-scope "one thing revealed at
// a time" state, distinct from `vaultReveal` -- the two rooms are different tabs and a document
// reveal must not silently re-mask whatever is open in Vault, or vice versa.

let documentReveal = null; // { id, tick, restore }

function hideDocumentReveal() {
  if (!documentReveal) return;
  clearInterval(documentReveal.tick);
  const { restore } = documentReveal;
  documentReveal = null;
  restore();
}

/** One document row. doc_type/name/location/summaryHint are real plaintext -- shown up front,
 *  same as the vault's label/site/masked -- only `details` (provider, policy number,
 *  beneficiary, executor, whatever matters) needs a reveal. */
function documentRow(doc, { onReveal, onCopy }) {
  const detailBox = el("div", { class: "vault-secret" });
  const maskEl = el("div", {
    class: "vault-masked",
    text: doc.summaryHint || "Tap Reveal for the real details on file",
  });
  const revealBtn = el("button", { type: "button", class: "vault-reveal-btn", text: "Reveal" });
  const errorEl = el("div", { class: "vault-row-error", hidden: true });

  const row = el("div", { class: "vault-row" }, [
    el("div", { class: "vault-row-head" }, [
      el("div", { class: "vault-row-name" }, [
        el("div", { class: "vault-row-label", text: doc.name }),
        el("div", { class: "vault-row-site", text: doc.docType }),
        doc.location ? el("div", { class: "vault-row-site", text: `at ${doc.location}` }) : null,
      ]),
      revealBtn,
    ]),
    maskEl,
    detailBox,
    errorEl,
  ]);

  function showMasked() {
    detailBox.replaceChildren();
    maskEl.hidden = false;
    revealBtn.hidden = false;
  }

  function showValue(revealed) {
    maskEl.hidden = true;
    revealBtn.hidden = true;

    const countdown = el("span", { class: "vault-countdown" });
    const copyBtn = el("button", {
      type: "button",
      class: "vault-copy-btn",
      text: "Copy",
      onClick: () => onCopy(revealed),
    });
    detailBox.replaceChildren(
      el("div", { class: "vault-value-box" }, [
        el("span", { class: "vault-value", style: "white-space:pre-wrap;text-align:left", text: revealed.details }),
        countdown,
        copyBtn,
      ]),
    );

    const deadline = new Date(revealed.expiresAt).getTime();
    const secondsLeft = () => Math.ceil((deadline - Date.now()) / 1000);
    const tick = setInterval(() => {
      if (!row.isConnected || secondsLeft() <= 0) {
        hideDocumentReveal();
        return;
      }
      countdown.textContent = `${secondsLeft()}s`;
    }, 250);
    countdown.textContent = `${Math.max(0, secondsLeft())}s`;

    hideDocumentReveal();
    documentReveal = { id: doc.id, tick, restore: showMasked };
  }

  revealBtn.addEventListener("click", async () => {
    errorEl.hidden = true;
    revealBtn.disabled = true;
    const overlay = vaultFaceOverlay();
    try {
      showValue(await onReveal(doc));
    } catch (err) {
      if (err && (err.name === "NotAllowedError" || err.name === "AbortError")) return;
      errorEl.textContent = err?.message || "That did not reveal.";
      errorEl.hidden = false;
    } finally {
      overlay.remove();
      revealBtn.disabled = false;
    }
  });

  showMasked();
  return row;
}

async function viewMoneyDocuments(view) {
  const { documents, keyConfigured } = await api("/api/documents");

  view.append(
    el("div", { class: "vault-lock-note" }, [
      lineIcon(
        '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><path d="M14 2v6h6"></path>',
        { size: 14, strokeWidth: 2 },
      ),
      el("span", {
        text: "Wills, life insurance, and the like -- real documents, not credentials, but the same real security bar as the Vault: encrypted at rest, Face ID every time, revealed for 20 seconds.",
      }),
    ]),
  );

  if (!keyConfigured) {
    view.append(
      el("div", { class: "card" }, [
        el("p", { text: "The same encryption key the Vault uses isn't set on this server, so nothing here can be added or revealed." }),
        el("p", { class: "small muted", text: "SL_VAULT_KEY needs 32 bytes of base64 randomness in the environment." }),
      ]),
    );
    attachRoomWatermark(view, "moneyhdr");
    return;
  }

  // Real search (item 2 of the issue's scope): "where's my will", "who's my life insurance
  // beneficiary" -- answered directly from the real doc_type/name/location on file, no reveal
  // needed just to find the right document.
  const searchInput = el("input", { placeholder: "where's my will…", "aria-label": "Search documents" });
  const searchResults = el("div", { class: "vault-card", style: "margin-top:8px" });
  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) {
      searchResults.replaceChildren();
      searchResults.hidden = true;
      return;
    }
    searchTimer = setTimeout(async () => {
      const { documents: hits } = await api(`/api/documents/search?q=${encodeURIComponent(q)}`);
      searchResults.hidden = false;
      searchResults.replaceChildren(
        hits.length === 0
          ? el("p", { class: "small muted", style: "padding:.6rem 1rem", text: "Nothing on file matches that." })
          : el("div", {}, hits.map((h) =>
              el("div", { class: "vault-row-head", style: "padding:.6rem 1rem" }, [
                el("div", { class: "vault-row-name" }, [
                  el("div", { class: "vault-row-label", text: h.name }),
                  el("div", { class: "vault-row-site", text: h.docType }),
                  h.location ? el("div", { class: "vault-row-site", text: `at ${h.location}` }) : null,
                ]),
              ]),
            )),
      );
    }, 200);
  });
  searchResults.hidden = true;
  view.append(el("div", { class: "card" }, [el("h3", { class: "vault-add-title", text: "Find a document" }), searchInput, searchResults]));

  const copy = async (revealed) => {
    try {
      await navigator.clipboard.writeText(revealed.details);
    } catch {
      showQuickToast("This browser wouldn't let the app write to the clipboard.");
      return;
    }
    showQuickToast("Copied.");
  };

  const reveal = async (doc) => {
    const options = await api(`/api/documents/${doc.id}/reveal/options`, { method: "POST", body: "{}" });
    return api(`/api/documents/${doc.id}/reveal`, {
      method: "POST",
      body: JSON.stringify(await passkeyAssertion(options)),
    });
  };

  if (documents.length === 0) {
    view.append(
      empty(
        "Nothing on file yet.",
        "Wills, life insurance, deeds, titles, whatever matters -- what it is, where it lives, and the real details worth surfacing at a glance. Add the first one below.",
        "vault",
      ),
    );
  } else {
    const card = el("div", { class: "vault-card" });
    for (const doc of documents) {
      card.append(documentRow(doc, { onReveal: reveal, onCopy: copy }));
    }
    view.append(card);
  }

  // Same "real dedicated form" exception the vault takes (Git #3183 no-forms audit), for the
  // same reason: this is genuinely sensitive content, and routing it through the universal
  // capture box would mean it passes through Claude/MCP before encryption, defeating the whole
  // point. No MCP tool for this module either -- same precedent as vault.mjs.
  const typeInput = el("input", { placeholder: "Will · Life insurance · Deed · …", "aria-label": "What kind of document this is", required: true });
  const nameInput = el("input", { placeholder: "Northwestern Mutual term life", "aria-label": "Name", required: true });
  const locationInput = el("input", { placeholder: "Safe deposit box at NFCU", "aria-label": "Where it lives" });
  const hintInput = el("input", { placeholder: "Summary shown before Reveal (optional)", "aria-label": "Summary hint" });
  const detailsInput = el("textarea", {
    placeholder: "Provider, policy number, beneficiary, executor -- whatever matters at a glance",
    "aria-label": "The real details",
    required: true,
    rows: 3,
  });
  const addError = el("p", { class: "vault-row-error", hidden: true });
  const addForm = el("form", { class: "section" }, [
    el("div", { class: "row" }, [typeInput, nameInput]),
    el("div", { class: "row" }, [locationInput, hintInput]),
    detailsInput,
    el("button", { type: "submit", class: "ghost small", text: "Add a document" }),
    addError,
  ]);
  addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!typeInput.value.trim() || !nameInput.value.trim() || !detailsInput.value.trim()) return;
    addError.hidden = true;
    addForm.querySelectorAll("input,button,textarea").forEach((n) => (n.disabled = true));
    try {
      await api("/api/documents", {
        method: "POST",
        body: JSON.stringify({
          docType: typeInput.value,
          name: nameInput.value,
          location: locationInput.value,
          summaryHint: hintInput.value,
          details: detailsInput.value,
        }),
      });
      typeInput.value = "";
      nameInput.value = "";
      locationInput.value = "";
      hintInput.value = "";
      detailsInput.value = "";
      render();
    } catch (err) {
      addError.textContent = err?.message || "That didn't save.";
      addError.hidden = false;
      addForm.querySelectorAll("input,button,textarea").forEach((n) => (n.disabled = false));
    }
  });
  view.append(el("div", { class: "card" }, [el("h3", { class: "vault-add-title", text: "Add a document" }), addForm]));

  // Same watermark as the rest of Money's own sub-tabs that have no bespoke critter of their
  // own (Bills/Banks/Accounts/Cars) -- only Vault and Wins got one in the critter spec's room
  // map.
  attachRoomWatermark(view, "moneyhdr");
}

/** Git #3207 (design #2c, "Behind · 6 bills · 19 payments"): one row of the Behind summary --
 *  bill name, real months behind, real last-paid date, real amount owed. No "for <month>" --
 *  that's the design mockup's own inference on top of a single real `last_paid_date`, not a
 *  field this app actually stores; `last paid <date>` is the honest version of the same fact. */
function moneyBehindRow(bill) {
  const meta = bill.lastPaidDate
    ? `${bill.monthsBehind} month${bill.monthsBehind === 1 ? "" : "s"} · last paid ${whenDate(bill.lastPaidDate)}`
    : `${bill.monthsBehind} month${bill.monthsBehind === 1 ? "" : "s"}`;
  return el("div", { class: "money-bucket-row" }, [
    el("div", { class: "money-bucket-name" }, [
      el("span", { text: bill.name }),
      el("div", { class: "money-bucket-meta", text: meta }),
    ]),
    el("span", { class: "money-bucket-status critical", text: dollars(bill.owed) }),
  ]);
}

/** Money's Bills tab (Git #3148): every real bill account, plus real one-time pending events
 *  "not counted until real" -- design README screen 7. Reads the same GET /api/money/gate
 *  #3137 already built (getGateStatus() in src/core/money.mjs); no new backend, no fixture. */
async function viewMoneyBills(view) {
  await renderCycleCard(view, "bills");

  const gate = await api("/api/money/gate");

  // "Behind" (Git #3207, design #2c): a real, distinct list from the funded/grouped bill
  // accounts below it, sorted by real amount owed -- getGateStatus() already returns it
  // pre-sorted (computeGateMath's own `behind`).
  const behindCard = el("div", { class: "card money-bucket" }, [
    el("div", { class: "money-bucket-label urgent", text: `Behind · ${gate.behind.length} bill${gate.behind.length === 1 ? "" : "s"} · ${dollars(gate.behindOwed)} owed` }),
  ]);
  if (gate.behind.length === 0) {
    behindCard.append(el("p", { class: "muted small", style: "padding:0 1rem .7rem", text: "Nothing behind right now." }));
  } else {
    for (const bill of gate.behind) behindCard.append(moneyBehindRow(bill));
  }
  view.append(behindCard);

  const billsCard = el("div", { class: "card money-bucket" }, [
    el("div", { class: "money-bucket-label", text: "Bill accounts · funded from Direct Deposit" }),
  ]);
  if (gate.bills.length === 0) {
    billsCard.append(el("p", { class: "muted small", style: "padding:0 1rem .7rem", text: "No bill-role accounts assigned yet in ShanesSurvival." }));
  } else {
    for (const bill of gate.bills) {
      billsCard.append(moneyBillRow(bill, { showGateBadge: true, onOpenDetail: openBillDetailSheet }));
    }
  }
  view.append(billsCard);

  const eventsCard = el("div", { class: "card money-bucket" }, [
    el("div", { class: "money-bucket-label", text: "One-time, pending · not counted until real" }),
  ]);
  if (gate.pendingEvents.length === 0) {
    eventsCard.append(el("p", { class: "muted small", style: "padding:0 1rem .7rem", text: "Nothing pending right now." }));
  } else {
    for (const ev of gate.pendingEvents) eventsCard.append(moneyEventRow(ev));
  }
  view.append(eventsCard);

  if (gate.warnings.length > 0) {
    view.append(el("p", { class: "muted small", text: gate.warnings.join(" ") }));
  }

  // README's watermark map: "Money Bills and Cars -> bear" (moneyhdr's c-bear/c-bear2 variants).
  attachRoomWatermark(view, "moneyhdr");
}

// ---------------------------------------------------------------------------
// Money -> "Bankruptcy" tab (Git #3163)
// ---------------------------------------------------------------------------
//
// Ported from Finance-Tracker's `BankruptcyItem` -- fully modeled and CRUD'd there, never
// surfaced on any screen (FINANCE_TRACKER_AUDIT.md §6, "dead sub-feature"). This is the real
// screen that was never built, reading/writing the SAME `debts` table get_gate_status's own
// Protected bucket reads (src/core/money.mjs), not a second, disconnected list.

function debtBadges(d) {
  const chips = [];
  if (d.includedInBankruptcy) chips.push(el("span", { class: "chip", text: "in filing" }));
  if (d.debtType) chips.push(el("span", { class: "chip", text: d.debtType }));
  if (d.isCritical) chips.push(el("span", { class: "chip", text: "critical" }));
  if (d.isDelinquent) chips.push(el("span", { class: "chip", text: `${d.daysPastDue ?? "?"} days past due` }));
  return chips;
}

function debtCard(d) {
  const rows = [
    el("div", { class: "row", style: "justify-content:space-between;align-items:baseline" }, [
      el("div", { class: "title", text: d.creditor }),
      el("div", { class: "money-amount", style: "font-size:20px", text: dollars(d.balance) }),
    ]),
    el("div", { class: "row", style: "gap:.4rem;flex-wrap:wrap" }, debtBadges(d)),
  ];
  const meta = [
    d.originalBalance ? `${dollars(d.balance)} of ${dollars(d.originalBalance)} original` : null,
    d.minimumPayment ? `min ${dollars(d.minimumPayment)}/mo` : null,
    d.dueDay ? `due day ${d.dueDay}` : null,
    d.lastPaymentDate ? `last payment ${d.lastPaymentDate}` : null,
  ].filter(Boolean);
  if (meta.length) rows.push(el("div", { class: "small muted", text: meta.join(" · ") }));
  if (d.notes) rows.push(el("div", { class: "small", text: d.notes }));

  // Git #3196: no dedicated edit/delete buttons or form -- a real natural-language capture
  // ("Chrysler Capital's balance is now $7,900", "remove the Chrysler Capital debt") typed into
  // the universal capture box routes through set_debt/delete_debt, same as every other real
  // action in this app (same treatment #3182 gave the Cars tab).
  rows.push(
    el("div", { class: "small muted", style: "margin-top:.5rem", text: `Say what changed below, e.g. "${d.creditor}'s balance is now $X" or "remove the ${d.creditor} debt".` }),
  );

  return el("div", { class: "card" }, rows);
}

async function viewMoneyBankruptcy(view) {
  const { debts } = await api("/api/money/debts");

  view.append(
    el("p", { class: "small muted", text: "Real debts already tracked in ShanesSurvival, organized for bankruptcy-filing context. Ported from Finance-Tracker's own debt tracker, which was built but never surfaced." }),
  );

  if (debts.length === 0) {
    view.append(empty("No debts on file yet.", "Say one below, e.g. \"add a debt: Chrysler Capital, $8,200\", and Claude adds it.", "idle"));
  } else {
    view.append(el("section", { class: "section" }, debts.map(debtCard)));
  }

  // Git #3196: no dedicated add-debt form -- "add a debt: Chrysler Capital, $8,200, part of the
  // bankruptcy filing" typed into the universal capture box below routes through set_debt.

  attachRoomWatermark(view, "moneyhdr");
}

// ---------------------------------------------------------------------------
// Money -- "Accounts" tab (Git #3170)
// ---------------------------------------------------------------------------
//
// Every real account, sectioned by role, ported in shape from Finance-Tracker's accounts.tsx
// (FINANCE_TRACKER_AUDIT.md §1): % funded per section, masked last-4, Plaid-linked badge,
// "N underfunded", Total Envelope Balance, Connected Banks. All real numbers come from
// GET /api/money/accounts (src/core/money.mjs's getAccountsOverview) -- no fixture, no client
// math beyond formatting. See that function's own header for why Connected Banks here is a
// real, honest status READ and not a disconnect/reconnect action -- that's #3168's job.

function accountRow(account) {
  const statusText =
    account.status === "funded"
      ? "funded"
      : account.status === "short"
        ? `short ${account.shortfallFormatted}`
        : account.balanceFormatted === null
          ? "balance unknown"
          : null;
  const statusClass =
    account.status === "funded" ? "funded" : account.status === "short" ? (account.isGate ? "critical" : "short") : "";

  return el("div", { class: "money-bucket-row" }, [
    el("div", { class: "money-bucket-name" }, [
      el("span", { text: account.name }),
      el("div", { class: "money-bucket-meta" }, [
        el("span", { text: account.masked ?? "no mask yet -- run a sync" }),
        el("span", { class: "chip", style: "margin-left:.4rem", text: account.institutionName }),
        account.reconnectRequired ? el("span", { class: "chip verdict", style: "margin-left:.4rem", text: "Reconnect needed" }) : null,
      ]),
    ]),
    el("span", {
      class: `money-bucket-status ${statusClass}`,
      text: statusText ?? account.balanceFormatted ?? "—",
    }),
  ]);
}

/** Live "short by $X -- needs funds from [account]" preview for one bill account's target,
 *  computed on the server (money.previewAccountTarget) every time the input changes -- never
 *  persisted. See that function's own header for why this never writes target_amount. */
function openEditBalanceSheet(account) {
  const dialog = el("dialog", { class: "sheet" });
  const resultEl = el("div", { class: "small", style: "min-height:1.2em" });
  const targetInput = el("input", {
    type: "number",
    step: "0.01",
    inputmode: "decimal",
    placeholder: account.targetFormatted ?? "0.00",
    "aria-label": "Hypothetical target amount",
  });
  const previewBtn = el("button", { type: "button", class: "primary small", text: "Preview" });

  async function runPreview() {
    if (!targetInput.value) return;
    resultEl.textContent = "…";
    try {
      const result = await api(
        `/api/money/accounts/${encodeURIComponent(account.id)}/preview-target?target=${encodeURIComponent(targetInput.value)}`,
      );
      resultEl.textContent = result.answerable ? result.text : result.text;
      resultEl.style.color = result.answerable && result.funded ? "hsl(var(--success))" : "";
    } catch (err) {
      resultEl.textContent = err?.message || "Could not preview that.";
    }
  }
  previewBtn.addEventListener("click", runPreview);

  dialog.append(
    el("div", { class: "spread" }, [
      el("span", { class: "sheet-title", text: `Edit balance -- ${account.name}` }),
      el("button", { class: "ghost small", text: "Close", onClick: () => dialog.close() }),
    ]),
    el("div", { class: "sheet-body" }, [
      el("p", { class: "small muted", text: `Current balance: ${account.balanceFormatted ?? "unknown"}. Real Plaid balance -- this app never edits it directly.` }),
      el("p", { class: "small muted", text: "Type a target funding amount to see the live short-by warning. This is a preview only -- saving a new target is done in ShanesSurvival." }),
      el("div", { class: "row" }, [targetInput, previewBtn]),
      resultEl,
    ]),
  );
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}

async function viewMoneyAccounts(view) {
  const [overview, banks] = await Promise.all([api("/api/money/accounts"), api("/api/money/banks")]);

  const totalCard = el("div", { class: "card section" }, [
    el("span", { class: "small muted", text: "Total Envelope Balance" }),
    el("div", { class: "money-amount", text: overview.totalEnvelopeFormatted ?? "unknown" }),
    el("p", { class: "small muted", text: "Every real account's current balance, added together." }),
  ]);
  view.append(totalCard);

  await appendCriticalDebtOverlayCard(view);

  if (overview.sections.length === 0) {
    view.append(el("div", { class: "card" }, [el("p", { class: "muted", text: "No real accounts synced from ShanesSurvival yet." })]));
  }

  for (const section of overview.sections) {
    const labelParts = [section.label];
    if (section.fundedPercent !== null) labelParts.push(`${section.fundedPercent}% funded`);
    if (section.underfundedCount > 0) labelParts.push(`${section.underfundedCount} underfunded`);

    const sectionCard = el("div", { class: "card money-bucket" }, [
      el("div", { class: "money-bucket-label", text: labelParts.join(" · ") }),
    ]);
    for (const account of section.accounts) {
      const row = accountRow(account);
      // Git #3212: a bill row's real tap target is now the detail sheet (envelope breakdown,
      // funding history, Vault link) -- openEditBalanceSheet's hypothetical-target preview is
      // still real and reachable, now as a link inside that sheet, not the row's own tap.
      if (section.role === "bill") {
        row.style.cursor = "pointer";
        row.addEventListener("click", () => openBillDetailSheet(account.id));
      }
      sectionCard.append(row);
    }
    view.append(sectionCard);
  }

  // Real reconnect UI (Git #3211/design 1d) -- the same bankRow + Plaid Link update-mode flow
  // #3168 built for the Banks tab, not a second, read-only copy of it. A bank that has gone
  // amber here can be fixed here, without a trip to the dedicated Banks tab.
  const banksCard = el("div", { class: "card section" }, [
    el("span", { class: "small muted", text: "Connected Banks" }),
  ]);
  if (!banks.configured) {
    banksCard.append(el("p", { class: "small muted", text: "Plaid is not configured on this server." }));
  } else if (banks.items.length === 0) {
    banksCard.append(el("p", { class: "small muted", text: "No real Plaid connections yet." }));
  } else {
    const reconnect = bankReconnectHandler(render);
    for (const item of banks.items) banksCard.append(bankRow(item, { onReconnect: reconnect }));
  }
  view.append(banksCard);

  if (overview.warnings.length > 0) {
    view.append(
      el("div", { class: "card section" }, [
        el("p", { class: "small muted", text: "Warnings" }),
        ...overview.warnings.map((w) => el("p", { class: "small", text: w })),
      ]),
    );
  }

  attachRoomWatermark(view, "moneyhdr");
}

/** One real win row: the date and the real, hard-won text. `debt_paid_off` is styled like the
 *  funded/covered green used everywhere else in Money -- a real automatic milestone, not manual
 *  input, gets the same "this is settled" color as a funded bill. Git #3195: that status is now
 *  a rotated `sticker()`, the same real badge treatment Recipes (#3190) and the Next card (#3144)
 *  already proved out, replacing the plain uppercase chip every other still-unbuilt room uses. */
function moneyWinRow(win) {
  return el("div", { class: "money-bucket-row" }, [
    el("div", { class: "money-bucket-name" }, [
      el("div", { text: win.text }),
      el("div", { class: "money-bucket-meta", text: win.happened_on }),
    ]),
    win.source === "debt_paid_off" ? sticker("green", "automatic") : null,
  ]);
}

/** Wins -- its own real house-grid room (Git #3241, pulled out of Money's own tab switcher; the
 *  underlying data/logic is unchanged -- still GET /api/money/wins, still wins.mjs's own
 *  createWin/listWins). Every real win, dated, most recent first: manual "I did it" captures
 *  (source 'shane', typed right here) and Claude's `log_win` (source 'claude') land the same as
 *  the automatic ones detectMoneyWins() creates server-side (source 'debt_paid_off'). Deliberately
 *  no streak, badge or completion percentage anywhere on this room (Section 3/8). */
// Git #3277: Wins' own real room header, via the generic roomHeader() (README "Rooms (sub
// pages)") -- same pattern #3192/#3193/#3194 already used, not a bespoke header. README's own
// room-tint table, "Wins".
const WINS_TINT = "253,164,175";

async function viewWins(view) {
  const { wins } = await api("/api/money/wins");

  roomHeader(view, WINS_TINT, "Wins");
  view.append(
    el("section", { class: "section" }, [
      el("p", { class: "muted small", text: "Real wins · no streaks, no badges" }),
    ]),
  );

  // Git #3183: no dedicated "Log a win" form -- the design's own words are "Shane should be
  // able to just say 'I did it' and have it land here," which is exactly the universal
  // capture box (log_win over MCP already exists for it), not a second text field here too.

  // Git #3195: Round 2 visual rebuild -- the room's one real content card gets the same 22px
  // blob radius Vault's own list card (#3242/#3150) and Recipes' (#3190) already carry.
  const winsCard = el("div", { class: "card money-bucket wins-card" });
  if (wins.length === 0) {
    winsCard.append(empty("Nothing logged yet.", "Say \"I did it\" in the capture box, or a real debt hitting $0 lands here on its own.", "wins"));
  } else {
    for (const win of wins) winsCard.append(moneyWinRow(win));
  }
  view.append(winsCard);

  attachRoomWatermark(view, "wins");
}

async function viewMoneyBanks(view) {
  const data = await api("/api/money/banks");

  if (!data.configured) {
    view.append(
      el("div", { class: "card" }, [
        el("p", {
          text: "Plaid is not configured on this server, so nothing here can reach your banks.",
        }),
        el("p", {
          class: "small muted",
          text: "Set SL_PLAID_CLIENT_ID and SL_PLAID_SECRET, then reload. The connections themselves are unaffected — the desktop app keeps syncing.",
        }),
      ]),
    );
    return;
  }

  const broken = data.items.filter((i) => i.needsReconnect);

  const statusLine = el("p", { class: "small muted" });
  const refreshBtn = el("button", {
    type: "button",
    class: "ghost small",
    text: "Check with Plaid",
    onClick: async () => {
      refreshBtn.disabled = true;
      statusLine.textContent = "Asking Plaid about every bank…";
      try {
        await api("/api/money/banks/refresh", { method: "POST" });
        await render();
      } catch (err) {
        statusLine.textContent = err.message;
      } finally {
        refreshBtn.disabled = false;
      }
    },
  });

  const headerChildren = [
    el("div", { class: "row", style: "justify-content:space-between;align-items:baseline" }, [
      el("h3", { style: "margin:0", text: broken.length ? `${broken.length} bank${broken.length === 1 ? "" : "s"} need attention` : "All banks connected" }),
      refreshBtn,
    ]),
    el("p", {
      class: "small muted",
      text: "Syncing is the desktop app's job. This screen exists so a broken connection finds you before the next sync does.",
    }),
    statusLine,
  ];

  // The honest version of "webhooks are on": on a localhost origin Plaid cannot deliver anything,
  // so the screen says the health shown is poll-only rather than implying live events.
  if (!data.webhookDeliverable) {
    headerChildren.push(
      el("p", {
        class: "small muted",
        text: `Plaid can only call a public HTTPS address, and this server answers on ${data.webhookUrl}. Health here comes from polling until the app is deployed.`,
      }),
    );
  }

  view.append(el("div", { class: "card section" }, headerChildren));

  const reconnect = bankReconnectHandler(render);

  if (data.items.length === 0) {
    view.append(
      el("div", { class: "card" }, [
        el("p", { class: "muted", text: "No banks are linked yet. Linking a new bank is done in the desktop app." }),
      ]),
    );
  } else {
    for (const item of data.items) view.append(bankRow(item, { onReconnect: reconnect }));
  }

  // Real webhook receipts. Proof the receiver is genuinely being called, rather than a claim.
  const { events } = await api("/api/money/banks/events?limit=10");
  view.append(
    el("div", { class: "card section" }, [
      el("h3", { style: "margin:0 0 6px", text: "Recent webhooks from Plaid" }),
      events.length === 0
        ? el("p", { class: "small muted", text: "Plaid has not called this app yet." })
        : el(
            "div",
            { class: "bank-events" },
            events.map((ev) =>
              el("p", {
                class: "small muted",
                text: `${new Date(ev.receivedAt).toLocaleString()} · ${ev.type}: ${ev.code}${ev.errorCode ? ` (${ev.errorCode})` : ""}${ev.verified ? "" : " · REJECTED"}${ev.note ? ` · ${ev.note}` : ""}`,
              }),
            ),
          ),
    ]),
  );
}

/** Transfer Instructions' own card -- pulled into a function because both the initial Now-tab
 *  render and Distribute Paycheck's own "Apply" step need to redraw it (a fresh plan changes what
 *  it shows) without reloading the whole tab. */
async function renderTransferInstructions(container) {
  container.replaceChildren();
  const data = await api("/api/money/transfer-instructions");
  if (data.groups.length === 0) {
    container.append(
      el("div", { class: "card money-bucket" }, [
        el("div", { class: "money-bucket-label", text: "Transfer instructions" }),
        el("p", { class: "muted small", style: "padding:0 1rem .7rem", text: "No real pending plan right now -- run Distribute Paycheck below to create one." }),
      ]),
    );
    return;
  }

  const rows = data.groups.map((g) =>
    el("div", { class: "money-bucket-row" }, [
      el("div", { class: "money-bucket-name" }, [
        el("span", { text: g.accountName }),
      ]),
      el("div", { class: "row", style: "gap:.5rem;align-items:center" }, [
        el("span", { class: "money-bucket-status", text: g.amountFormatted }),
        el("button", {
          type: "button",
          class: "ghost small",
          text: "Mark as Transferred",
          onClick: async (event) => {
            event.currentTarget.disabled = true;
            await api(`/api/money/transfer-instructions/${encodeURIComponent(g.accountId)}/mark-transferred`, { method: "POST" });
            await renderTransferInstructions(container);
          },
        }),
      ]),
    ]),
  );

  const copyBtn = el("button", {
    type: "button",
    class: "small",
    text: "Copy transfer instructions",
    onClick: () => {
      const lines = ["Transfer Instructions", ""];
      for (const g of data.groups) lines.push(`Transfer ${g.amountFormatted} → ${g.accountName}`);
      navigator.clipboard?.writeText(lines.join("\n"));
    },
  });

  container.append(
    el("div", { class: "card money-bucket" }, [
      el("div", { class: "row", style: "justify-content:space-between;align-items:baseline;padding:0 1rem" }, [
        el("div", { class: "money-bucket-label", text: `Transfer instructions · ${data.totalFormatted} total` }),
      ]),
      ...rows,
      el("div", { class: "row", style: "padding:.6rem 1rem" }, [copyBtn]),
      el("p", { class: "small muted", style: "padding:0 1rem .7rem", text: data.footer }),
    ]),
  );
}

// ---------------------------------------------------------------------------
// Money -- Home-tab decision tools (Git #3171)
// ---------------------------------------------------------------------------
//
// Real port of Finance-Tracker's Home/Overview screen (FINANCE_TRACKER_AUDIT.md section 1/5,
// contract pack Section 12), adapted to the real architecture already established in money.mjs's
// own header for this app: a Shane's Life "bill" is its own real, separate bank account, not a
// virtual split of one pooled checking account -- see money.mjs's own section header for the full
// translation. Four tools, rendered on the Now tab right after the Available-to-spend card, the
// same real position Finance-Tracker's own Home tab puts them (right after its Safe-to-Spend
// hero, before its Attention Needed alerts).

async function renderMoneyDecisionTools(view, gate) {
  // -- Period Review --------------------------------------------------------
  const review = await api("/api/money/period-review");
  view.append(
    el("div", { class: "card section" }, [
      el("div", { class: "small muted", text: "Period Review · this pay cycle" }),
      el("div", { class: "row", style: "justify-content:space-between;margin-top:.5rem" }, [
        el("div", {}, [el("div", { class: "small muted", text: "Available" }), el("div", { style: "font-weight:700", text: review.availableFormatted ?? "unknown" })]),
        el("div", {}, [el("div", { class: "small muted", text: "Spent" }), el("div", { style: "font-weight:700", text: review.spentFormatted })]),
        el("div", {}, [
          el("div", { class: "small muted", text: "Still Due" }),
          el("div", { style: `font-weight:700;color:${review.stillDue > 0 ? "#f87171" : ""}`, text: review.stillDueFormatted }),
        ]),
      ]),
      el("p", { class: "small muted", style: "margin-top:.5rem", text: review.identity }),
    ]),
  );

  // -- Skip Suggestions -------------------------------------------------------
  const skip = await api("/api/money/skip-suggestions");
  if (skip.shown && skip.suggestions.length > 0) {
    view.append(
      el("div", { class: "card money-bucket" }, [
        el("div", { class: "money-bucket-label urgent", text: `Skip suggestions · short ${skip.deficitFormatted}` }),
        ...skip.suggestions.map((b) => moneyBillRow(b)),
        el("p", { class: "small muted", style: "padding:0 1rem .7rem", text: skip.text }),
      ]),
    );
  }

  // -- Distribute Paycheck (Git #3208 refinement of #3171's own build) --------------------------
  // Git #3183 no-forms audit: a real-time calculation tool (preview, then an editable plan),
  // same reasoning as the what-if/transfer-simulator forms above -- not a form for adding or
  // editing a fact about the world. The amount field starts prefilled with the real current
  // Income Gate balance (the design's own Budget Day framing: the split is drawn from what
  // actually landed, not a number Shane has to go look up and type) but stays editable for a
  // different real amount.
  const distributeResultEl = el("div");
  const distributeAmountInput = el("input", {
    type: "number",
    step: "0.01",
    inputmode: "decimal",
    placeholder: "3000",
    value: gate?.gate?.balance ?? "",
    "aria-label": "Paycheck amount",
  });
  const distributeForm = el("form", { class: "row" }, [
    distributeAmountInput,
    el("button", { type: "submit", class: "ghost small", text: "Distribute this paycheck" }),
  ]);
  distributeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const amount = distributeAmountInput.value;
    if (!amount) return;
    const preview = await api(`/api/money/distribute-preview?amount=${encodeURIComponent(amount)}`);
    renderDistributePreview(distributeResultEl, amount, preview);
  });

  view.append(
    el("div", { class: "card section" }, [
      el("div", { class: "small muted", text: "Distribute Paycheck" }),
      distributeForm,
      distributeResultEl,
    ]),
  );

  // Auto-run the preview once on load whenever there's a real Income Gate balance to split --
  // same "the split just shows up on payday" idea the design's own Budget Day card has, without
  // waiting on Shane to press submit first.
  if (gate?.gate?.balance) {
    const preview = await api(`/api/money/distribute-preview?amount=${encodeURIComponent(gate.gate.balance)}`);
    renderDistributePreview(distributeResultEl, gate.gate.balance, preview);
  }

  // -- Transfer Instructions ----------------------------------------------------
  const transferInstructionsEl = el("div");
  await renderTransferInstructions(transferInstructionsEl);
  view.append(transferInstructionsEl);

  /** Step 2 of Distribute Paycheck: the preview's own allocations, due-soonest-first, each
   *  editable, with real running totals (Left in the gate account / Available to spend after the
   *  split -- recomputed live client-side as the amounts change, Git #3208 scope item 2), the
   *  real "what stays short" statement (item 3), and a real copyable transfer block for the NFCU
   *  app (item 1). Apply persists the (possibly hand-edited) allocations as the real pending plan
   *  and redraws Transfer Instructions above. */
  function renderDistributePreview(container, sourceAmount, preview) {
    container.replaceChildren();
    if (preview.allocations.length === 0) {
      container.append(el("p", { class: "small muted", text: preview.text }));
      return;
    }

    // Pre-split baselines, across EVERY real bill (not just the ones in this split) -- the same
    // `gate` status object the Now tab already loaded before calling renderMoneyDecisionTools, so
    // this needs no second round trip and stays correct even for a bill that isn't part of this
    // allocation set (skipped, or already fully funded).
    const gateBalanceCents = preview.gate?.balance != null ? Math.round(preview.gate.balance * 100) : null;
    const totalAvailableBeforeCents = gate?.totalAvailable != null ? Math.round(gate.totalAvailable * 100) : null;
    const totalShortfallBeforeCents = gate?.totalShortfall != null ? Math.round(gate.totalShortfall * 100) : null;

    const leftInGateEl = el("span", { style: "font-weight:700", "font-variant-numeric": "tabular-nums", text: preview.leftInGateFormatted ?? "unknown" });
    const availableAfterEl = el("span", { style: "font-weight:700", "font-variant-numeric": "tabular-nums", text: preview.availableAfterSplitFormatted ?? "unknown" });

    const rows = preview.allocations.map((a) => {
      const input = el("input", {
        type: "number",
        step: "0.01",
        inputmode: "decimal",
        value: a.amount,
        style: "width:5.5rem",
        "aria-label": `Amount for ${a.name}`,
      });
      input.addEventListener("input", recomputeRunningTotals);
      return {
        accountId: a.accountId,
        name: a.name,
        shortfallCents: Math.round((a.shortfall ?? 0) * 100),
        input,
        row: el("div", { class: "money-bucket-row" }, [
          el("div", { class: "money-bucket-name" }, [
            el("span", { text: a.name }),
            a.dueLabel ? el("div", { class: "money-bucket-meta", text: a.dueLabel }) : null,
          ]),
          input,
        ]),
      };
    });

    /** Live-recomputes the two running totals as Shane edits an allocation amount, without a
     *  round trip -- re-derives computeGateMath's own identity (totalAvailable - totalShortfall)
     *  from the pre-split baselines above plus whatever is currently typed into each row, so both
     *  numbers stay correct as amounts move between rows rather than freezing at the server's
     *  first answer (Git #3208 scope item 2: "both live-computed as the split changes"). A
     *  bill's own shortfall reduction is capped at that bill's real shortfall -- overfunding one
     *  on purpose (a real "give Rent 2000" style override) still only closes its own real gap. */
    function recomputeRunningTotals() {
      let allocatedCents = 0;
      let shortfallReducedCents = 0;
      for (const r of rows) {
        const cents = Math.round((Number(r.input.value) || 0) * 100);
        allocatedCents += cents;
        shortfallReducedCents += Math.min(cents, r.shortfallCents);
      }
      if (gateBalanceCents != null) {
        leftInGateEl.textContent = dollars((gateBalanceCents - allocatedCents) / 100);
      }
      if (totalAvailableBeforeCents != null && totalShortfallBeforeCents != null) {
        const totalAvailableAfterCents = totalAvailableBeforeCents - allocatedCents;
        const totalShortfallAfterCents = totalShortfallBeforeCents - shortfallReducedCents;
        availableAfterEl.textContent = dollars((totalAvailableAfterCents - totalShortfallAfterCents) / 100);
      }
    }

    const applyBtn = el("button", { type: "button", class: "small", text: "Apply this plan" });
    applyBtn.addEventListener("click", async () => {
      applyBtn.disabled = true;
      try {
        await api("/api/money/distribute", {
          method: "POST",
          body: JSON.stringify({
            sourceAmount,
            allocations: rows.map((r) => ({ accountId: r.accountId, amount: r.input.value })),
          }),
        });
        container.replaceChildren(el("p", { class: "small ok", text: "Plan saved. See Transfer Instructions below." }));
        await renderTransferInstructions(transferInstructionsEl);
      } finally {
        applyBtn.disabled = false;
      }
    });

    const copyBtn = el("button", {
      type: "button",
      class: "ghost small",
      text: `Copy all ${rows.length} for the NFCU app`,
      onClick: () => navigator.clipboard?.writeText(preview.copyText ?? ""),
    });

    container.append(
      el("div", { class: "money-bucket", style: "margin-top:.5rem" }, [
        el("div", { class: "row", style: "justify-content:space-between;padding:.6rem 1rem 0" }, [
          el("span", { class: "small muted", text: `From ${preview.gate?.name ?? "the Income Gate"}${preview.gate?.masked ? ` ${preview.gate.masked}` : ""}` }),
          el("span", { class: "small muted", text: "due soonest first" }),
        ]),
        ...rows.map((r) => r.row),
        el("div", { class: "money-bucket-row" }, [
          el("span", { style: "flex:1;font-weight:600", text: `Left in ${preview.gate?.name ?? "the source account"}` }),
          leftInGateEl,
        ]),
        el("div", { class: "money-bucket-row" }, [
          el("div", { style: "flex:1;min-width:0" }, [
            el("span", { style: "font-weight:600", text: "Available to spend" }),
            el("span", { class: "small muted", text: " after the split · deposit + spend accounts" }),
          ]),
          availableAfterEl,
        ]),
        el("div", { class: "row", style: "padding:.6rem 1rem" }, [copyBtn, applyBtn]),
        preview.stillShortText ? el("p", { class: "small", style: "padding:0 1rem .3rem;color:#fbbf24", text: preview.stillShortText }) : null,
        el("p", {
          class: "small muted",
          style: "padding:0 1rem .7rem",
          text: `${preview.text} Nothing has moved; these are the transfers to make. Say "skip Netflix" or "give Rent 2000" and the list recomputes.`,
        }),
      ]),
    );
  }
}

// Git #3277: Money's own real room header, via the generic roomHeader() (README "Rooms (sub
// pages)") -- same pattern #3192/#3193/#3194 already used, not a bespoke header. README's own
// room-tint table, "Meds and Money" share this tint. Sits above the tab bar below so the two
// don't duplicate navigation chrome; #3273 (Money nav restructure) is still open as of this
// writing, so this is built compatible with Money's CURRENT tab structure and left for #3273 to
// adjust further.
const MONEY_TINT = "251,191,36";

async function viewMoney(view) {
  // The extension's own reveal popup (see the extensionReveal bridge above) opens straight to
  // #/money with no way to also pick the Vault tab through the UI -- it's a popup with nothing
  // else to click. Force it once so the real reveal ceremony below has something to render into.
  if (extensionReveal && !extensionReveal.handled) moneyTab = "vault";

  roomHeader(view, MONEY_TINT, "Money");
  view.append(
    el("section", { class: "section" }, [
      el("p", { class: "muted small", text: "Never moves money. Do it at NFCU, then it syncs." }),
    ]),
  );

  view.append(
    el(
      "div",
      { class: "money-tabs" },
      MONEY_TABS.map((tab) =>
        el("button", {
          type: "button",
          class: `money-tab${moneyTab === tab.key ? " active" : ""}`,
          text: tab.label,
          onClick: () => {
            moneyTab = tab.key;
            render();
          },
        }),
      ),
    ),
  );

  if (moneyTab === "bills") {
    await viewMoneyBills(view);
    return;
  }

  if (moneyTab === "banks") {
    await viewMoneyBanks(view);
    return;
  }

  if (moneyTab === "bankruptcy") {
    await viewMoneyBankruptcy(view);
    return;
  }

  if (moneyTab === "accounts") {
    await viewMoneyAccounts(view);
    return;
  }

  if (moneyTab === "cars") {
    await viewMoneyCars(view);
    return;
  }

  if (moneyTab === "vault") {
    await viewMoneyVault(view);
    return;
  }

  if (moneyTab === "documents") {
    await viewMoneyDocuments(view);
    return;
  }

  if (moneyTab !== "now") {
    const label = MONEY_TABS.find((t) => t.key === moneyTab)?.label ?? moneyTab;
    view.append(
      el("div", { class: "card" }, [
        el("p", { class: "muted", text: `${label} is its own real Feature, built on top of this one -- not wired here yet.` }),
      ]),
    );
    return;
  }

  await renderCycleCard(view, "now");

  const gate = await api("/api/money/gate");

  if (gate.budgetDay) {
    const bd = gate.budgetDay;
    const cardChildren = [
      el("div", { class: "row", style: "justify-content:space-between" }, [
        el("span", { class: "small muted", style: "font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#60a5fa", text: "Budget Day · payday" }),
      ]),
      el("p", { text: bd.line }),
    ];

    if (bd.landedAmountFormatted) {
      cardChildren.push(el("p", { style: "font-weight:700", text: `${bd.landedAmountFormatted} lands in ${bd.name}.` }));
    }

    if (bd.dueBeforeNextCheck && bd.dueBeforeNextCheck.bills.length > 0) {
      cardChildren.push(
        el("p", {
          class: "small muted",
          text: `Before the next check: ${bd.dueBeforeNextCheck.bills.map((b) => `${b.name} ${b.amountFormatted ?? "unknown"}`).join(", ")}.` +
            (bd.coveredByLanding === false
              ? ` This landing doesn't cover it -- short ${dollars((bd.dueBeforeNextCheck.total ?? 0) - (bd.landedAmount ?? 0))}.`
              : bd.coveredByLanding === true
                ? " This landing covers it."
                : ""),
        }),
      );
    }

    if (bd.couponing && bd.couponing.text) {
      cardChildren.push(el("p", { class: "small muted", text: bd.couponing.text }));
    }

    view.append(
      el("div", { class: "card money-budgetday-card" }, cardChildren),
    );
  }

  const availableCard = el("div", { class: "card section" });
  availableCard.append(
    el("div", { class: "row", style: "justify-content:space-between;align-items:baseline" }, [
      el("span", { class: "small muted", text: "Available to spend" }),
      gate.budgetDay ? el("span", { class: "small muted", text: gate.budgetDay.line }) : null,
    ]),
    el("div", {
      class: "money-amount",
      style: gate.isCovered === false ? "color:#f87171" : "",
      text: gate.availableToSpendFormatted ?? "unknown",
    }),
  );

  if (gate.availableToSpend !== null) {
    const barColor = gate.isCovered === false ? "#f87171" : gate.spokenForPercent >= 60 ? "#fbbf24" : "hsl(var(--success))";
    availableCard.append(
      el("p", { class: "small muted", text: `${dollars(gate.totalAvailable)} available, ${dollars(gate.totalShortfall)} spoken for.` }),
      el("div", { class: "budget-bar" }, [el("div", { class: "budget-bar-fill", style: `width:${gate.spokenForPercent}%;background:${barColor}` })]),
      el("div", { class: "row", style: "justify-content:space-between" }, [
        el("span", {
          class: "small muted",
          style: "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap",
          text: gate.unfundedNames.length ? `${dollars(gate.totalShortfall)} spoken for · ${gate.unfundedNames.join(", ")}` : "Nothing spoken for",
        }),
        el("span", {
          class: "small",
          style: `font-weight:600;white-space:nowrap;color:${gate.isCovered ? "hsl(var(--success))" : "#f87171"}`,
          text: gate.isCovered ? "Covered" : `Short ${dollars(-gate.availableToSpend)}`,
        }),
      ]),
    );
  } else {
    availableCard.append(el("p", { class: "small muted", text: gate.warnings[0] ?? "Available to spend is unknown right now." }));
  }

  if (gate.habit.line) {
    availableCard.append(el("p", { class: "money-habit-line", text: gate.habit.line }));
  }

  // Git #3183 no-forms audit: kept, same reasoning as Things' "Where's the..." search
  // (#3181) -- these two are real-time simulations (a read, never a write), not a form for
  // creating or editing data, so Section 8's rule doesn't reach them. Both are also reachable
  // by asking Claude the same question in plain language (footer note below).
  const whatIfResultEl = el("div");
  const whatIfInput = el("input", { type: "number", step: "0.01", inputmode: "decimal", placeholder: "60", "aria-label": "What-if amount" });
  const whatIfForm = el("form", { class: "row" }, [
    whatIfInput,
    el("button", { type: "submit", class: "ghost small", text: "What if I spend this?" }),
  ]);
  whatIfForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const amount = whatIfInput.value;
    if (!amount) return;
    const result = await api(`/api/money/what-if?amount=${encodeURIComponent(amount)}`);
    renderMoneyResult(whatIfResultEl, "whatif", result);
  });
  availableCard.append(whatIfForm, whatIfResultEl);

  const transferResultEl = el("div");
  const fromInput = el("input", { placeholder: "From, e.g. Direct Deposit", "aria-label": "Transfer source account" });
  const toInput = el("input", { placeholder: "To, e.g. Tesla", "aria-label": "Transfer destination account" });
  const amountInput = el("input", { type: "number", step: "0.01", inputmode: "decimal", placeholder: "200", "aria-label": "Transfer amount" });
  const transferForm = el("form", { class: "section" }, [
    el("div", { class: "row" }, [fromInput, toInput, amountInput]),
    el("button", { type: "submit", class: "ghost small", text: "Simulate a transfer" }),
  ]);
  transferForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!fromInput.value || !toInput.value || !amountInput.value) return;
    transferForm.querySelectorAll("input,button").forEach((n) => (n.disabled = true));
    try {
      const result = await api("/api/money/simulate-transfer", {
        method: "POST",
        body: JSON.stringify({ from: fromInput.value, to: toInput.value, amount: amountInput.value }),
      });
      renderMoneyResult(transferResultEl, "transfer", result);
    } finally {
      transferForm.querySelectorAll("input,button").forEach((n) => (n.disabled = false));
    }
  });
  availableCard.append(transferForm, transferResultEl);

  availableCard.append(
    el("p", { class: "small muted", text: 'Ask below, from here or from Claude on your phone: "what if I spend 60" · "move 200 from Direct Deposit to Tesla"' }),
  );

  view.append(availableCard);

  await renderMoneyDecisionTools(view, gate);

  // Protected -- money already spoken for: the Income Gate's own gate bills, plus critical debts.
  const protectedRows = [...gate.gateBills.map(moneyBillRow), ...gate.protectedDebts.map(moneyDebtRow)];
  if (protectedRows.length) {
    view.append(el("div", { class: "card money-bucket" }, [el("div", { class: "money-bucket-label", text: "Protected" }), ...protectedRows]));
  }

  const urgentBills = gate.otherBills.filter((b) => b.funded === false);
  if (urgentBills.length) {
    view.append(
      el("div", { class: "card money-bucket" }, [
        el("div", { class: "money-bucket-label urgent", text: "Urgent" }),
        ...urgentBills.map(moneyBillRow),
      ]),
    );
  }

  const handledBills = gate.otherBills.filter((b) => b.funded === true);
  if (handledBills.length) {
    view.append(
      el("div", { class: "card money-bucket handled" }, [
        el("div", { class: "money-bucket-label", text: "Already handled" }),
        ...handledBills.map(moneyBillRow),
      ]),
    );
  }

  if (gate.warnings.length) {
    view.append(
      el("div", { class: "card section" }, [
        el("p", { class: "small muted", text: "Warnings" }),
        ...gate.warnings.map((w) => el("p", { class: "small", text: w })),
      ]),
    );
  }

  await appendCatchesCard(view);
  await appendIncomeRulesCard(view);
}

// ---------------------------------------------------------------------------
// Money -> Catches (Git #3153, wired to the Now tab Git #3201)
// ---------------------------------------------------------------------------
//
// The design's own Catches card (README, Money screen section: "Catches (Renewal watch,
// Forgotten money, Duplicate request, Borrowed from a bill, Bulk buy; 'Got it' dismisses)"),
// backed by src/core/catches.mjs's five real detectors -- see that module's own header for
// exactly what each one looks for. GET /api/money/catches runs the detectors fresh on every
// screen open (cheap upserts against already-synced data) so this is never stale. "Got it" is
// the one real action here, same single-click-dismiss shape as the Inbox's Dismiss button and
// Income Rules' Remove -- Section 8's "no forms" rule doesn't reach it.

const CATCH_KIND_LABELS = Object.freeze({
  renewal: "Renewal watch",
  forgotten_money: "Forgotten money",
  duplicate_request: "Duplicate request",
  borrowed_from_bill: "Borrowed from a bill",
  bulk_buy: "Bulk buy",
});

function catchRow(c) {
  return el("div", { class: "money-bucket-row" }, [
    el("div", { class: "money-bucket-name" }, [
      el("div", { class: "money-bucket-meta", text: CATCH_KIND_LABELS[c.kind] ?? c.kind }),
      el("span", { text: c.text }),
    ]),
    el("button", {
      type: "button",
      class: "ghost small",
      text: "Got it",
      onClick: async (event) => {
        event.target.disabled = true;
        await api(`/api/money/catches/${c.id}/dismiss`, { method: "POST", body: "{}" });
        render();
      },
    }),
  ]);
}

async function appendCatchesCard(view) {
  const { catches } = await api("/api/money/catches");

  const card = el("div", { class: "card section" }, [
    el("div", { class: "row", style: "justify-content:space-between" }, [
      el("span", { class: "small muted", style: "font-weight:600;letter-spacing:.05em;text-transform:uppercase", text: "Catches" }),
    ]),
    ...(catches.length ? catches.map(catchRow) : [el("p", { class: "small muted", text: "Nothing caught right now." })]),
  ]);
  view.append(card);
}

// ---------------------------------------------------------------------------
// Money -> Income Rules + transaction auto-scan (Git #3169)
// ---------------------------------------------------------------------------
//
// Real port of Finance-Tracker's IncomeRule + scanTransactions() -- see
// src/core/income-rules.mjs's own header for the full real reasoning. Contract pack Section 8
// ("no forms, anywhere, ever") is why this card is READ-ONLY plus single-click actions (Set
// primary, Remove, Scan) -- the same class of interaction as Catches' "Got it" or Vault's
// Reveal, which Section 8's own rule doesn't reach. Adding or editing a rule's several typed
// fields is a real conversation with Claude (add_income_rule/update_income_rule), not a form
// here; the hint text below says so, matching the app's own established "ask Claude" wording
// used everywhere else a record needs several fields (e.g. recipes, vehicles).

function incomeRuleMatchDescription(rule) {
  const verb = rule.matchType === "starts_with" ? "starts with" : rule.matchType === "exact" ? "is exactly" : "contains";
  const range =
    rule.minAmount != null && rule.maxAmount != null
      ? ` (${dollars(rule.minAmount)}–${dollars(rule.maxAmount)})`
      : rule.minAmount != null
        ? ` (≥ ${dollars(rule.minAmount)})`
        : rule.maxAmount != null
          ? ` (≤ ${dollars(rule.maxAmount)})`
          : "";
  return `${rule.accountName} → ${rule.sourceName} · ${verb} "${rule.matchText}"${range}`;
}

async function appendIncomeRulesCard(view) {
  const { rules, sources } = await api("/api/money/income-rules");

  const sourceRow = (source) =>
    el("div", { class: "money-bucket-row" }, [
      el("div", { class: "money-bucket-name" }, [
        el("span", { text: source.name }),
        source.isPrimary ? el("span", { class: "money-bucket-status", style: "color:hsl(var(--success))", text: "PRIMARY" }) : null,
      ]),
      source.isPrimary
        ? null
        : el("button", {
            type: "button",
            class: "ghost small",
            text: "Set primary",
            onClick: async (event) => {
              event.target.disabled = true;
              await api(`/api/money/income-sources/${source.id}/primary`, { method: "POST", body: "{}" });
              render();
            },
          }),
    ]);

  const ruleRow = (rule) =>
    el("div", { class: "money-bucket-row" }, [
      el("div", { class: "money-bucket-name" }, [
        el("span", { text: rule.name }),
        el("div", { class: "money-bucket-meta", text: incomeRuleMatchDescription(rule) }),
      ]),
      el("span", { class: "row", style: "gap:.5rem;align-items:center" }, [
        rule.isActive ? null : el("span", { class: "small muted", text: "paused" }),
        el("button", {
          type: "button",
          class: "ghost small",
          text: "Remove",
          onClick: async (event) => {
            event.target.disabled = true;
            await api(`/api/money/income-rules/${rule.id}`, { method: "DELETE" });
            render();
          },
        }),
      ]),
    ]);

  const card = el("div", { class: "card section" }, [
    el("div", { class: "row", style: "justify-content:space-between" }, [
      el("span", { class: "small muted", style: "font-weight:600;letter-spacing:.05em;text-transform:uppercase", text: "Income sources" }),
    ]),
    ...(sources.length ? sources.map(sourceRow) : [el("p", { class: "small muted", text: "No income sources yet." })]),
  ]);
  view.append(card);

  const scanResultEl = el("div");
  const scanButton = el("button", { type: "button", class: "ghost small", text: "Scan transactions" });
  scanButton.addEventListener("click", async () => {
    scanButton.disabled = true;
    scanButton.textContent = "Scanning…";
    try {
      const result = await api("/api/money/income-rules/scan", { method: "POST", body: "{}" });
      const summary =
        result.matched === 0
          ? result.warnings[0] ?? "Nothing new -- no matching deposits found in the scanned window."
          : `${result.created + result.linked} income entr${result.created + result.linked === 1 ? "y" : "ies"} recorded ` +
            `(${result.transactionsScanned} transaction${result.transactionsScanned === 1 ? "" : "s"} scanned, ` +
            `${result.alreadyLogged} already logged).`;
      scanResultEl.replaceChildren(el("p", { class: "small", text: summary }));
    } catch (err) {
      scanResultEl.replaceChildren(el("p", { class: "small", text: err.message || "Scan failed." }));
    } finally {
      scanButton.disabled = false;
      scanButton.textContent = "Scan transactions";
    }
  });

  const rulesCard = el("div", { class: "card section" }, [
    el("div", { class: "row", style: "justify-content:space-between" }, [
      el("span", { class: "small muted", style: "font-weight:600;letter-spacing:.05em;text-transform:uppercase", text: "Income rules" }),
      scanButton,
    ]),
    ...(rules.length
      ? rules.map(ruleRow)
      : [el("p", { class: "small muted", text: "No income rules yet." })]),
    scanResultEl,
    el("p", { class: "small muted", text: 'Add or edit rules by asking Claude, e.g. "add an income rule for COM2 TREAS 310 deposits into DirectDeposit, credit NASA Salary."' }),
  ]);
  view.append(rulesCard);
}

// ---------------------------------------------------------------------------
// Money -- "Cars" tab (Git #3149)
// ---------------------------------------------------------------------------
//
// One card per real vehicle (Tesla Model 3, Kia Forte): design README line 37, "rows text,
// all-in $/mo 22px/800, $/yr, next maintenance with lead time." Every number comes straight off
// /api/cars, which is src/core/vehicles.mjs's own real math over the linked accounts row,
// insurance, amortised registration and real trailing-12-month maintenance spend -- see that
// module's own header for exactly what each component means.

function carReminderLine(label, r) {
  if (!r) return null;
  const cls = r.overdue ? "small money-bucket-status critical" : r.dueSoon ? "small money-habit-line" : "small muted";
  return el("div", { class: cls, text: `${label} ${dueLabel(r.dueInDays, r.on)} (${whenDate(r.on)})` });
}

// Git #3213 (design 1f, "Cars · no forms"): the only real signal the client has that a capture
// just landed on a given vehicle is "the vehicle's most recent maintenance log entry has an id I
// haven't shown yet" -- captures classify asynchronously in a separate Claude conversation (see
// captures.mjs's own header), so there is no request/response moment to hang a toast off of.
// localStorage remembers the last entry id this browser has already shown per vehicle; the FIRST
// time a vehicle is ever seen here, its current lastEntry is recorded silently (no sticker/toast)
// so pre-existing history doesn't read as "just now" on a fresh login.
function carLastSeenKey(vehicleId) {
  return `carsLastSeenMaintenance:${vehicleId}`;
}

/** Returns true only when this vehicle's newest entry is genuinely new since we last looked, and
 *  records it as seen either way -- callers get one honest "just now" per real change, not a
 *  reshow on every reload. */
function checkAndMarkCarMaintenanceSeen(vehicle) {
  const entry = vehicle.maintenance.lastEntry;
  if (!entry) return false;
  const key = carLastSeenKey(vehicle.id);
  const stored = localStorage.getItem(key);
  localStorage.setItem(key, entry.id);
  return stored !== null && stored !== entry.id;
}

function carOnboardingDismissed() {
  return localStorage.getItem("carsOnboardingDismissed") === "1";
}

// Design 1f's "Say it, it lands" card -- the three example sentences shown once as onboarding
// copy, dismissible once the grammar is learned (the design's own words: "shown once ... then
// they can go"), same three examples verbatim.
function carOnboardingCard(onDismiss) {
  const examples = [
    { line: '"oil change on the Kia, $84"', hint: "maintenance cost, rolled into the monthly average" },
    { line: '"Tesla\'s at 40,900 miles"', hint: "mileage, moves the next-maintenance line" },
    { line: '"we got a 2019 Odyssey, $410 a month, Allstate $96"', hint: "a new card here, and its loan as a bill account" },
  ];
  return el("div", { class: "card" }, [
    el("div", { class: "row", style: "justify-content:space-between;align-items:baseline" }, [
      el("div", { class: "small", style: "font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted-foreground)", text: "Say it, it lands" }),
      el("button", {
        class: "ghost small",
        text: "Got it",
        onClick: () => {
          localStorage.setItem("carsOnboardingDismissed", "1");
          onDismiss();
        },
      }),
    ]),
    ...examples.map((e) =>
      el("div", { class: "row", style: "margin-top:.5rem;flex-direction:column;align-items:flex-start;gap:.1rem" }, [
        el("div", { text: e.line }),
        el("div", { class: "small muted", text: e.hint }),
      ]),
    ),
    el("p", { class: "small muted", style: "margin:.6rem 0 0", text: "One number per car so \"is it worth keeping\" has an answer. Registration and oil changes use the same lead-time reminders as appointments and show up in Dates." }),
  ]);
}

/** The five-second Undo toast (design 1f): "Logged $84.00 on the Kia Forte... Undo", a real
 *  DELETE of that exact maintenance row, not a generic edit form. */
function showCarMaintenanceUndoToast(vehicle, entry, onUndone) {
  let dismissed = false;
  const node = el("div", { class: "quick-toast car-undo-toast" }, [
    el("div", { class: "car-undo-check" }, [
      lineIcon('<path d="M20 6 9 17l-5-5"></path>'),
    ]),
    el("div", { style: "flex:1;min-width:0;text-align:left" }, [
      el("div", { style: "font-weight:600", text: `Logged ${dollars(entry.amount)} on the ${vehicle.name}` }),
      el("div", { class: "small muted", text: `Maintenance · ${entry.description} · in the monthly average` }),
    ]),
    el("button", {
      class: "ghost small",
      text: "Undo",
      onClick: async (event) => {
        if (dismissed) return;
        dismissed = true;
        event.currentTarget.disabled = true;
        try {
          await api(`/api/cars/${vehicle.id}/maintenance/${entry.id}`, { method: "DELETE" });
        } finally {
          node.remove();
          onUndone();
        }
      },
    }),
  ]);
  document.body.append(node);
  setTimeout(() => {
    if (!dismissed) node.remove();
  }, 5000);
}

function carCard(vehicle, { justNow } = {}) {
  const rows = [];
  if (vehicle.loan) {
    rows.push(
      vehicle.loan.missing
        ? el("div", { class: "small", text: "Loan account is linked but no longer exists." })
        : el("div", { class: "small", text: `${vehicle.loan.accountName}: ${dollars(vehicle.loan.paymentDue)}/mo · ${dollars(vehicle.loan.savedTowardPayment)} saved toward it · due day ${vehicle.loan.dueDay ?? "?"}` }),
    );
  }
  if (vehicle.insurance.amountPerMonth) {
    rows.push(el("div", { class: "small", text: `Insurance: ${dollars(vehicle.insurance.amountPerMonth)}/mo` }));
  }
  if (vehicle.registration.amountPerYear) {
    rows.push(el("div", { class: "small", text: `Registration: ${dollars(vehicle.registration.amountPerYear)}/yr` }));
  }
  rows.push(
    el("div", {
      class: "small",
      text: vehicle.maintenance.spendLast12Months
        ? `Maintenance, last 12 months: ${dollars(vehicle.maintenance.spendLast12Months)}`
        : "Maintenance, last 12 months: nothing logged yet",
    }),
  );
  // Design 1f's real delta line -- only meaningful, and only shown, the moment the change that
  // produced it is itself new; otherwise it's just restating the same average every visit.
  if (justNow && vehicle.maintenance.lastEntry && vehicle.maintenance.previousAveragePerMonth !== null) {
    rows.push(
      el("div", {
        class: "small",
        text: `12-mo average: ${dollars(vehicle.maintenance.averagePerMonth)}/mo, was ${dollars(vehicle.maintenance.previousAveragePerMonth)} before today's ${dollars(vehicle.maintenance.lastEntry.amount)}`,
      }),
    );
  }
  // Real, live mileage status off Tesla's own odometer (Git #3217) -- null whenever this
  // vehicle isn't Tesla-synced or the real numbers it needs (a synced reading, a logged
  // maintenance mileage) don't exist yet, so this line simply doesn't appear rather than
  // showing a half-known number.
  const byMileage = vehicle.maintenance.byMileage;
  if (byMileage?.milesUntilNextByMileage !== null && byMileage?.milesUntilNextByMileage !== undefined) {
    rows.push(
      el("div", {
        class: byMileage.overdueByMileage ? "small money-bucket-status critical" : "small muted",
        text: byMileage.overdueByMileage
          ? `${byMileage.milesSinceLastService.toLocaleString()} mi since last service -- overdue by mileage (every ${vehicle.maintenance.intervalMiles.toLocaleString()} mi)`
          : `${byMileage.milesUntilNextByMileage.toLocaleString()} mi until next service (real odometer: ${byMileage.currentMileage.toLocaleString()} mi)`,
      }),
    );
  }

  const reminders = [
    carReminderLine("Registration due", vehicle.registration.reminder),
    vehicle.maintenance.next ? carReminderLine(vehicle.maintenance.next.note || "Next maintenance", vehicle.maintenance.next) : null,
  ].filter(Boolean);

  const titleRow = [el("div", { class: "title", text: vehicle.name })];
  if (justNow) titleRow.push(sticker("blue", "just now"));

  return el("a", { class: "tile", href: `#/car/${vehicle.id}` }, [
    el("div", { class: "row", style: "justify-content:space-between;align-items:baseline" }, [
      el("div", { class: "row", style: "gap:.4rem;align-items:baseline" }, titleRow),
      el("div", { style: "text-align:right" }, [
        el("div", { class: "money-amount", style: "font-size:22px", text: vehicle.allInPerMonthFormatted }),
        el("div", { class: "small muted", text: `${vehicle.allInPerYearFormatted}/yr all-in` }),
      ]),
    ]),
    ...rows,
    ...reminders,
  ]);
}

async function viewMoneyCars(view) {
  const { vehicles } = await api("/api/cars");
  const justNowIds = new Set(vehicles.filter(checkAndMarkCarMaintenanceSeen).map((v) => v.id));

  if (vehicles.length === 0) {
    view.append(empty("No vehicles on file yet.", "Say the name below, e.g. \"add my Kia Forte\", and Claude adds it.", "idle"));
  } else {
    view.append(el("section", { class: "section" }, vehicles.map((v) => carCard(v, { justNow: justNowIds.has(v.id) }))));
  }

  if (!carOnboardingDismissed()) {
    const onboarding = carOnboardingCard(() => onboarding.remove());
    view.append(onboarding);
  }

  // Git #3182: no dedicated add-vehicle form -- "add my Kia Forte" typed into the universal
  // capture box below routes through set_vehicle, same as every other real action in this app.

  // "Money Bills and Cars -> bear" per the critter spec's room-watermark map (moneyhdr slot).
  attachRoomWatermark(view, "moneyhdr");

  // Git #3213: the real, five-second Undo toast for whichever vehicle just got a fresh entry.
  // At most one shows per view load (stacking several on a single tab switch reads as noise, not
  // help) -- the newest of the freshly-seen ones wins.
  const justNowVehicle = vehicles.find((v) => justNowIds.has(v.id));
  if (justNowVehicle) {
    showCarMaintenanceUndoToast(justNowVehicle, justNowVehicle.maintenance.lastEntry, () => render());
  }
}

async function viewCarDetail(view, vehicleId) {
  const vehicle = await api(`/api/cars/${vehicleId}`);

  view.append(
    el("section", { class: "section" }, [
      el("div", { class: "card" }, [
        el("h1", { text: vehicle.name, style: "margin:0 0 .25rem" }),
        el("div", { class: "money-amount", style: "font-size:22px", text: vehicle.allInPerMonthFormatted }),
        el("div", { class: "small muted", text: `${vehicle.allInPerYearFormatted}/yr all-in` }),
        el("div", { class: "row", style: "margin-top:.75rem" }, [
          el("a", { class: "ghost small", href: "#/money", text: "← Money" }),
        ]),
        // Git #3182: no dedicated delete button -- "remove the {vehicle.name}" typed into the
        // universal capture box below routes through delete_vehicle, and removes its maintenance
        // history along with it, same as the form used to.
        el("p", { class: "muted small", style: "margin:.5rem 0 0", text: `Say "remove the ${vehicle.name}" below to delete it.` }),
      ]),
    ]),
  );

  const details = el("section", { class: "section" }, [el("h2", { text: "Details" })]);
  const dCard = el("div", { class: "card" });
  if (vehicle.loan) {
    dCard.append(
      vehicle.loan.missing
        ? el("p", { class: "small", text: "Loan account is linked but no longer exists." })
        : el("p", { class: "small", text: `Loan: ${vehicle.loan.accountName}, ${dollars(vehicle.loan.paymentDue)}/mo, ${dollars(vehicle.loan.savedTowardPayment)} saved, due day ${vehicle.loan.dueDay ?? "?"}` }),
    );
  } else {
    dCard.append(el("p", { class: "small muted", text: "No loan account linked." }));
  }
  dCard.append(el("p", { class: "small", text: `Insurance: ${dollars(vehicle.insurance.amountPerMonth)}/mo` }));
  dCard.append(
    el("p", {
      class: "small",
      text: vehicle.registration.amountPerYear
        ? `Registration: ${dollars(vehicle.registration.amountPerYear)}/yr${vehicle.registration.reminder ? ` · due ${whenDate(vehicle.registration.reminder.on)}` : ""}`
        : "Registration: not on file.",
    }),
  );
  details.append(dCard);
  view.append(details);

  const maint = el("section", { class: "section" }, [
    el("h2", { text: "Maintenance" }),
    vehicle.maintenance.intervalMiles
      ? el("p", { class: "muted small", text: `Every ${vehicle.maintenance.intervalMiles.toLocaleString()} miles.` })
      : null,
  ]);
  const mCard = el("div", { class: "card" });
  mCard.append(el("p", { class: "small", text: `Spend, last 12 months: ${dollars(vehicle.maintenance.spendLast12Months)}` }));
  if (vehicle.maintenance.next) {
    mCard.append(el("p", { class: "small", text: `Next: ${vehicle.maintenance.next.note || "due"} -- ${dueLabel(vehicle.maintenance.next.dueInDays, vehicle.maintenance.next.on)} (${whenDate(vehicle.maintenance.next.on)})` }));
  }
  // Real, live mileage status (Git #3217) -- see carCard's own comment on why this is null
  // rather than shown half-known.
  const detailByMileage = vehicle.maintenance.byMileage;
  if (detailByMileage?.milesUntilNextByMileage !== null && detailByMileage?.milesUntilNextByMileage !== undefined) {
    mCard.append(
      el("p", {
        class: detailByMileage.overdueByMileage ? "small money-bucket-status critical" : "small",
        text: detailByMileage.overdueByMileage
          ? `Overdue by mileage: ${detailByMileage.milesSinceLastService.toLocaleString()} real mi since last service (interval is ${vehicle.maintenance.intervalMiles.toLocaleString()} mi)`
          : `By mileage: ${detailByMileage.milesUntilNextByMileage.toLocaleString()} mi left until next service (real odometer: ${detailByMileage.currentMileage.toLocaleString()} mi)`,
      }),
    );
  }
  if (vehicle.maintenanceLog.length === 0) {
    mCard.append(el("p", { class: "muted small", text: "No maintenance logged yet." }));
  }
  for (const entry of vehicle.maintenanceLog) {
    mCard.append(
      el("div", { class: "date-row" }, [
        el("div", { class: "body" }, [
          el("div", { class: "title small", text: entry.description }),
          el("div", { class: "meta", text: `${whenDate(entry.performedOn)}${entry.mileage ? ` · ${entry.mileage.toLocaleString()} mi` : ""}` }),
        ]),
        el("div", { class: "when", text: dollars(entry.amount) }),
      ]),
    );
  }

  // Git #3182: no dedicated maintenance-logging form -- "oil change on the {vehicle.name}, $60"
  // typed into the universal capture box below routes through log_car_maintenance, same as the
  // form used to.
  mCard.append(
    el("p", { class: "muted small", style: "margin-top:.6rem", text: `Say what was done below, e.g. "oil change on the ${vehicle.name}, $60".` }),
  );
  maint.append(mCard);
  view.append(maint);

  // Real Tesla<->Cars link + charging sessions (Git #3217). Kept as its own section rather than
  // folded into Maintenance/Details above -- it's a genuinely separate real concern (a live sync
  // relationship, not a stated number), and only ever meaningful for whichever one vehicle is
  // actually the connected Tesla.
  const tesla = el("section", { class: "section" }, [el("h2", { text: "Tesla" })]);
  const tCard = el("div", { class: "card" });
  if (!vehicle.tesla.synced) {
    tCard.append(
      el("p", { class: "small muted", text: "Not linked to the connected Tesla -- link it to get a real, live odometer reading and real charging session data instead of typing mileage in by hand." }),
      el("button", {
        class: "ghost small",
        text: "Sync this vehicle with Tesla",
        onClick: async (event) => {
          event.target.disabled = true;
          try {
            await api(`/api/cars/${vehicle.id}/tesla-sync`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
            render();
          } catch (err) {
            event.target.disabled = false;
            tCard.append(el("p", { class: "small error", text: err.message }));
          }
        },
      }),
    );
  } else {
    tCard.append(
      el("p", { class: "small", text: vehicle.tesla.mileageSyncedAt ? `Real odometer last synced ${whenDate(vehicle.tesla.mileageSyncedAt)}.` : "Linked -- no real odometer sync yet." }),
      el("div", { class: "row", style: "gap:.5rem" }, [
        el("button", {
          class: "ghost small",
          text: "Sync now",
          onClick: async (event) => {
            event.target.disabled = true;
            await api("/api/tesla/sync", { method: "POST" });
            render();
          },
        }),
        el("button", {
          class: "ghost small danger",
          text: "Stop syncing",
          onClick: async (event) => {
            event.target.disabled = true;
            await api(`/api/cars/${vehicle.id}/tesla-sync`, { method: "PATCH", body: JSON.stringify({ enabled: false }) });
            render();
          },
        }),
      ]),
    );

    const chargingHeader = el("p", { class: "small muted", style: "margin-top:.75rem", text: "Loading real charging sessions…" });
    tCard.append(chargingHeader);
    const { sessions } = await api("/api/tesla/charging-sessions");
    chargingHeader.remove();
    if (sessions.length === 0) {
      tCard.append(el("p", { class: "small muted", style: "margin-top:.75rem", text: "No real charging sessions synced yet." }));
    } else {
      tCard.append(el("p", { class: "small muted", style: "margin-top:.75rem", text: "Real charging sessions from Tesla. Cost is an estimate (your own rate × real kWh added) -- Tesla's API does not expose real per-session cost to a personal account." }));
      for (const s of sessions) {
        tCard.append(
          el("div", { class: "date-row" }, [
            el("div", { class: "body" }, [
              el("div", { class: "title small", text: s.location || "Charging session" }),
              el("div", { class: "meta", text: `${s.startedAt ? whenDate(s.startedAt) : "unknown date"}${s.energyAddedKwh !== null ? ` · ${s.energyAddedKwh} kWh` : ""}` }),
            ]),
            el("div", { class: "when", text: s.costEstimate !== null ? `~${dollars(s.costEstimate)}` : "?" }),
          ]),
        );
      }
    }
  }
  tesla.append(tCard);
  view.append(tesla);
}

async function viewEntity(view, entityId) {
  const entity = await api(`/api/entities/${entityId}`);

  view.append(
    el("section", { class: "section" }, [
      el("div", { class: "card" }, [
        el("div", { class: "row" }, [el("span", { class: "chip", text: entity.category_label || entity.category })]),
        el("h1", { text: entity.title, style: "margin:.5rem 0 0" }),
        entity.body ? el("p", { class: "muted", text: entity.body }) : null,
        entity.occurs_at ? el("p", { class: "meta muted small", text: `Happens ${when(entity.occurs_at)}` }) : null,
        entity.remind_at ? el("p", { class: "meta muted small", text: `Surfaces ${when(entity.remind_at)}` }) : null,
      ]),
    ]),
  );

  if (entity.items.length > 0) {
    const list = el("ul", { class: "checklist" });
    for (const item of entity.items) list.append(itemRow(entity.id, item));
    view.append(el("section", { class: "section" }, [el("h2", { text: `${entity.category_item_noun}s` }), list]));
  }

  const dataKeys = Object.keys(entity.data || {});
  if (dataKeys.length > 0) {
    view.append(
      el("section", { class: "section" }, [
        el("h2", { text: "Details" }),
        el("div", { class: "card" }, [
          el("pre", { class: "token", text: JSON.stringify(entity.data, null, 2) }),
        ]),
      ]),
    );
  }

  // Share links -- the mixed access model, from the owner's side.
  view.append(
    shareSection({
      shares: entity.shares,
      onCreate: (label) => api("/api/shares", { method: "POST", body: JSON.stringify({ entityId: entity.id, label, canCheck: true }) }),
      onRevoke: (id) => api(`/api/shares/${id}`, { method: "DELETE" }),
    }),
  );
}

/**
 * The owner-side "Shared links" card: current links plus a form to mint a new one. Shared
 * between a generic entity's page and the Shopping room, since #3116's share layer is
 * kind-agnostic (entityId or listId) -- this stays kind-agnostic too, driven purely by the
 * onCreate/onRevoke callbacks a caller supplies.
 */
function shareSection({ shares: shareList, onCreate, onRevoke, supportsAdd = false }) {
  const section = el("section", { class: "section" }, [el("h2", { text: "Shared links" })]);
  const live = shareList.filter((s) => !s.revoked_at);
  if (live.length === 0) {
    section.append(el("p", { class: "muted small", text: "Not shared with anyone." }));
  }
  for (const share of live) {
    const metaParts = [share.can_check ? "can tick items" : "view only"];
    if (share.can_add) metaParts.push("can add items");
    metaParts.push(`opened ${share.view_count}x`);
    section.append(
      el("div", { class: "card" }, [
        el("div", { class: "spread" }, [
          el("div", {}, [
            el("div", { class: "title", text: share.label || "Unlabelled link" }),
            el("div", { class: "meta", text: metaParts.join(" · ") }),
          ]),
          el("button", {
            class: "ghost small danger",
            text: "Revoke",
            onClick: async (event) => {
              event.target.disabled = true;
              await onRevoke(share.id);
              render();
            },
          }),
        ]),
      ]),
    );
  }

  const labelInput = el("input", { placeholder: "Who is this for? e.g. Ronnie", "aria-label": "Share label" });
  // Real capability expansion (Git #3186): off by default, same as can_check defaults on --
  // this is the one owner-facing control for a decision Shane made explicitly on the issue, not
  // a silent default flip for every link ever minted before it existed.
  const canAddInput = supportsAdd
    ? el("label", { class: "row small", style: "align-items:center;gap:.4rem;margin-top:.5rem" }, [
        el("input", { type: "checkbox", "aria-label": "Let this link add items too" }),
        el("span", { text: "Let this link add items too (aisle ordering + live activity)" }),
      ])
    : null;
  const result = el("div");
  section.append(
    el("div", { class: "card" }, [
      labelInput,
      canAddInput,
      el("div", { class: "row", style: "margin-top:.6rem" }, [
        el("button", {
          class: "primary small",
          text: "Create a no-login link",
          onClick: async (event) => {
            event.target.disabled = true;
            try {
              const canAdd = canAddInput ? canAddInput.querySelector("input").checked : false;
              const share = await onCreate(labelInput.value.trim() || null, canAdd);
              result.replaceChildren(
                el("p", { class: "small ok", text: "Copy it now — the link is shown once and cannot be recovered." }),
                el("pre", { class: "token", text: share.url }),
                el("button", {
                  class: "small",
                  text: "Copy link",
                  onClick: () => navigator.clipboard?.writeText(share.url),
                }),
              );
            } catch (err) {
              result.replaceChildren(el("p", { class: "small error", text: err.message }));
            } finally {
              event.target.disabled = false;
            }
          },
        }),
      ]),
      result,
    ]),
  );
  return section;
}

// ---------------------------------------------------------------------------
// Shopping -- the first room built on the typed lists/list_items shape (Git #3116's decision,
// #3088). "One run": the client never knows the list's id up front, it just asks /api/shopping
// and the server finds-or-creates the one real running list. Matches the shared chrome (cards,
// checklist rows) design handoff README's "Screens" section already establishes app-wide; the
// aisle/category grouping and cart-swipe options drawn in "Shanes Life 04 - Shopping.dc.html"
// are their own separate Feature (#3108), blocked_by this one. Scan -> real price (2a) is
// #3109's own scope, built below.
// ---------------------------------------------------------------------------

// Icons for a room's native chrome (Git #3178 built this for Shopping first) -- extracted
// verbatim from the real design markup ("Shanes Life - First Slice Prototype.dc.html"'s own
// "Today" back-link and scan-viewfinder icons), not invented fresh. The house icon is the
// generic README "Rooms (sub pages)" back-link (line 179: "the little house... + 'Today'"),
// not Shopping-specific -- Dates (#3192) is the second real caller, via roomHeader() below.
const ROOM_HOUSE_ICON =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M2.5 11.5 12 3.5l9.5 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M5.5 10v10.5h13V10" fill="rgba(96,165,250,.16)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path><rect x="10" y="13" width="4" height="4" rx="1" fill="#FDE68A"></rect></svg>';
const SHOP_SCAN_ICON =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><path d="M8 7v10"></path><path d="M12 7v10"></path><path d="M17 7v10"></path></svg>';
const SHOP_PIN_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle></svg>';
const SHOP_CHEVRON_DOWN_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>';
const SHOP_CHEVRON_RIGHT_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"></path></svg>';
const SHOP_CHECK_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>';

/**
 * Per-store price history (Git #3112): the item's real history, expanded inline rather than
 * routed to a separate screen -- there is no per-item detail route in this app's minimal hash
 * router, and the design keeps Shopping to one scrolling screen. Lives inside a compact item
 * row's tap-to-expand detail panel (Git #3178) alongside Remove and aisle-save -- see
 * shoppingItemRow/itemDetailPanel below.
 *
 * Git #3203: no dedicated "Log price" form -- "chicken breasts are $3.49 now" typed into the
 * universal capture box routes through log_price, same as every other real action in this app,
 * and (unlike the old form) also stamps the price straight onto this item's own row so the run's
 * running total actually moves without a barcode scan.
 */
function priceTools(item) {
  const wrap = el("div", { class: "price-tools" });
  const historyBtn = el("button", { class: "ghost small", type: "button", text: "History" });
  const panel = el("div");
  wrap.append(
    el("div", { class: "row" }, [historyBtn]),
    el("p", { class: "muted small", style: "margin:.35rem 0 0", text: `Say the price below, e.g. "${item.text} is $3.49 at Aldi", and Claude logs it.` }),
    panel,
  );

  historyBtn.addEventListener("click", async () => {
    if (panel.dataset.mode === "history") {
      panel.replaceChildren();
      panel.dataset.mode = "";
      return;
    }
    panel.dataset.mode = "history";
    panel.replaceChildren(el("p", { class: "small muted", text: "Loading…" }));
    const { history } = await api(`/api/prices?item=${encodeURIComponent(item.text)}`);
    if (history.length === 0) {
      panel.replaceChildren(el("p", { class: "small muted", text: "No real prices logged for this item yet." }));
      return;
    }
    const ul = el("ul", { class: "price-history" });
    for (const row of history) {
      ul.append(
        el("li", { class: "spread" }, [
          el("span", { text: row.store_name }),
          el("span", { class: "muted", text: `${money(row.price_cents)} · ${whenDate(row.observed_on)}` }),
        ]),
      );
    }
    panel.replaceChildren(ul);
  });

  return wrap;
}

/**
 * The four secondary actions the real design (04 / First Slice Prototype) never shows
 * permanently on a row -- Remove, Log price + History, and manual aisle-save -- collected into
 * one tap-to-expand panel (Git #3178). This is a real interaction-model decision, not a design
 * literal: the canonical prototype's whole row is `onClick=toggle` with no persistent affordance
 * for any of these four, so they move behind the row's own disclosure chevron instead of being
 * dropped. Real aisle-save stays gated on a store being set, same as before -- store_aisles is
 * keyed on (store, item).
 */
function itemDetailPanel(listId, item, { store } = {}) {
  const wrap = el("div", { class: "shop-item-detail-inner" });
  wrap.append(priceTools(item));

  if (store) {
    const aisleNum = el("input", { type: "number", min: "0", placeholder: "Aisle #", style: "width:70px", "aria-label": `Aisle for ${item.text}` });
    const aisleNote = el("input", { placeholder: "e.g. end cap", style: "flex:1", "aria-label": `Aisle note for ${item.text}` });
    const saveBtn = el("button", {
      class: "ghost small",
      text: "Save spot",
      onClick: async (event) => {
        const aisle = Number(aisleNum.value);
        if (!Number.isInteger(aisle) || aisle < 0) return;
        event.currentTarget.disabled = true;
        try {
          await api(`/api/lists/${listId}/items/${item.id}/aisle`, {
            method: "POST",
            body: JSON.stringify({ store, aisle, note: aisleNote.value.trim() || null }),
          });
          render();
        } finally {
          event.currentTarget.disabled = false;
        }
      },
    });
    wrap.append(el("div", { class: "row", style: "margin-top:.35rem" }, [aisleNum, aisleNote, saveBtn]));
  }

  wrap.append(
    el("div", { class: "row", style: "margin-top:.4rem" }, [
      el("button", {
        class: "ghost small danger",
        text: "Remove",
        onClick: async (event) => {
          event.currentTarget.disabled = true;
          await api(`/api/lists/${listId}/items/${item.id}`, { method: "DELETE" });
          render();
        },
      }),
    ]),
  );

  return wrap;
}

/**
 * The compact per-item row (Git #3178, real design 04 + First Slice Prototype): a 28px
 * checkbox, name with a passive "Aisle N · note" subline (the same real aisle-memory text
 * `item.note` already carries once a spot's been saved -- see POST .../aisle), a right-aligned
 * real price ("$1.79 · scanned" or "~$1.50" from last-known history), and a coupon/verdict pill
 * when Claude has pushed one. Everything else lives behind the trailing chevron's detail panel.
 */
function shoppingItemRow(listId, item, { store } = {}) {
  const box = el("div", {
    class: `shop-check${item.done ? " done" : ""}`,
    role: "checkbox",
    tabindex: "0",
    "aria-checked": item.done ? "true" : "false",
    "aria-label": item.text,
    html: item.done ? SHOP_CHECK_ICON : "",
  });
  const nameEl = el("div", { class: `shop-item-name${item.done ? " done" : ""}`, text: item.text });
  const subEl = item.note ? el("div", { class: "shop-item-sub", text: item.note }) : null;
  // Real provenance (Git #3186's decision comment): "so Shane can tell what a link holder added
  // vs. what he added himself" -- shown only for a share-originated add ("share" / "share:<label>",
  // never plain "owner"), which is the one case that actually needs calling out.
  const addedByEl =
    item.added_by && item.added_by !== "owner"
      ? el("div", { class: "shop-item-sub", text: `Added by ${item.added_by.replace(/^share:?/, "") || "a shared link"}` })
      : null;
  const verdict = verdictBadge(item.weeklyAdVerdict);

  // "$1.89 - scanned" (design 04, 2a) vs "~$1.50" from real per-store history (Git #3112,
  // prices.attachLatestPrices) -- price_source distinguishes a real scan from an estimate.
  const priceText =
    item.price_cents != null
      ? `${money(item.price_cents)}${item.price_source === "scan" ? " · scanned" : ""}`
      : item.lastPrice
        ? `~${money(item.lastPrice.priceCents)}`
        : "";
  const priceEl = priceText ? el("span", { class: `shop-item-price${item.price_source === "scan" ? " scanned" : ""}`, text: priceText }) : null;

  const toggleDone = async () => {
    if (box.classList.contains("pending")) return;
    box.classList.add("pending");
    try {
      const updated = await api(`/api/lists/${listId}/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ checked: !item.done }) });
      item.done = updated.done;
      box.classList.toggle("done", item.done);
      box.innerHTML = item.done ? SHOP_CHECK_ICON : "";
      box.setAttribute("aria-checked", item.done ? "true" : "false");
      nameEl.classList.toggle("done", item.done);
    } finally {
      box.classList.remove("pending");
    }
  };
  box.addEventListener("click", toggleDone);
  box.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleDone();
    }
  });
  nameEl.addEventListener("click", toggleDone);

  const expandBtn = el("button", { type: "button", class: "shop-item-more", "aria-label": `More actions for ${item.text}`, "aria-expanded": "false", html: SHOP_CHEVRON_RIGHT_ICON });
  const detail = el("div", { class: "shop-item-detail" });
  detail.hidden = true;
  expandBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const opening = detail.hidden;
    detail.hidden = !opening;
    expandBtn.classList.toggle("open", opening);
    expandBtn.setAttribute("aria-expanded", opening ? "true" : "false");
    if (opening) detail.replaceChildren(itemDetailPanel(listId, item, { store }));
  });

  return el("li", { class: "shop-item-row" }, [
    el("div", { class: "shop-item-main" }, [
      box,
      el("div", { class: "shop-item-text" }, [nameEl, subEl, addedByEl, verdict]),
      priceEl ? el("div", { class: "shop-item-side" }, [priceEl]) : null,
      expandBtn,
    ]),
    detail,
  ]);
}

// Weekly-ad cross-store verdict, coupon and multi-buy count (Git #3110) -- null until Claude has
// pushed a matching price/coupon over MCP (push_deals/push_coupons); most items show nothing
// here, same as every other "real data or nothing" surface in this app.
function verdictBadge(verdict) {
  if (!verdict) return null;
  const parts = [];
  if (verdict.priceCents != null) {
    const dollars = money(verdict.priceCents);
    parts.push(verdict.store ? `${verdict.store} ${dollars}${verdict.unit ? `/${verdict.unit}` : ""}` : dollars);
  } else if (verdict.store) {
    parts.push(verdict.store);
  }
  if (verdict.coupon) {
    const c = verdict.coupon;
    if (c.multiBuyCount && c.multiBuyPriceCents != null) {
      parts.push(`${c.multiBuyCount} for ${money(c.multiBuyPriceCents)}`);
    } else {
      parts.push(c.description);
    }
  }
  if (parts.length === 0) return null;
  return el("span", { class: "chip verdict", text: parts.join(" · ") });
}

// @zxing/browser is loaded on demand, never in index.html -- same reasoning as loadPlaidLink()
// above: a third-party script tag on every page load, for something used a handful of times a
// week, is not a trade this app makes. Vendored as a static file (see public/vendor/README.md)
// because this app has no client-side bundler; loading it as a classic script attaches
// `window.ZXingBrowser` (Git #3263 -- replaces the native `BarcodeDetector` API, which Safari
// has never implemented).
const ZXING_BROWSER_SRC = "/vendor/zxing-browser.min.js";
let zxingBrowserLoader = null;

function loadZxingBrowser() {
  if (window.ZXingBrowser) return Promise.resolve(window.ZXingBrowser);
  if (zxingBrowserLoader) return zxingBrowserLoader;
  zxingBrowserLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = ZXING_BROWSER_SRC;
    script.async = true;
    script.onload = () => resolve(window.ZXingBrowser);
    script.onerror = () => {
      zxingBrowserLoader = null;
      reject(new Error("Could not load the barcode scanner. Check the connection and try again."));
    };
    document.head.append(script);
  });
  return zxingBrowserLoader;
}

/**
 * The real scan sheet (design "Shanes Life 04 - Shopping.dc.html", option 2a). Decodes the live
 * camera feed with @zxing/browser (vendored at /vendor/zxing-browser.min.js, loaded on demand --
 * see loadZxingBrowser()) rather than the native `BarcodeDetector` API, which Safari has never
 * implemented in any context (Git #3263) -- ZXing decodes in software from the same
 * `getUserMedia` stream, so this works the same way on every browser, iOS Safari included. If
 * the camera itself is denied, or the scanner script fails to load, falls back to typing the
 * barcode by hand. Never a silent failure either way: a barcode that doesn't decode or doesn't
 * match anything still lands on a real state (unknown), never a dead end.
 */
async function openScanSheet(list) {
  const dialog = el("dialog", { class: "sheet" });
  const body = el("div", { class: "sheet-body" });
  dialog.append(
    el("div", { class: "spread" }, [
      el("span", { class: "sheet-title", text: "Scan" }),
      el("button", { class: "ghost small", text: "Close", onClick: () => dialog.close() }),
    ]),
    body,
  );
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());

  let stream = null;
  let scanControls = null;
  const video = el("video", { autoplay: "", playsinline: "", muted: "", class: "scan-video" });
  const status = el("p", { class: "small muted", text: "Point the camera at a barcode." });
  const manualInput = el("input", { placeholder: "Or type the barcode", inputmode: "numeric", "aria-label": "Barcode" });
  const manualForm = el("form", { class: "row" }, [manualInput, el("button", { class: "small", type: "submit", text: "Look up" })]);
  const resultBox = el("div");

  const stopCamera = () => {
    if (scanControls) {
      try {
        scanControls.stop();
      } catch {
        // Already stopped -- nothing more to release.
      }
      scanControls = null;
    }
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
  };
  dialog.addEventListener("close", stopCamera);

  async function runLookup(barcode) {
    status.textContent = "Looking it up…";
    resultBox.replaceChildren();
    try {
      const result = await api(`/api/lists/${list.id}/scan/lookup`, {
        method: "POST",
        body: JSON.stringify({ barcode }),
      });
      status.textContent = "";
      resultBox.replaceChildren(renderScanResult(list, dialog, result));
    } catch (err) {
      status.textContent = "";
      resultBox.replaceChildren(el("p", { class: "small error", text: err.message }));
    }
  }

  manualForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const barcode = manualInput.value.trim();
    if (!barcode) return;
    stopCamera();
    video.remove();
    runLookup(barcode);
  });

  body.append(video, status, resultBox, el("div", { class: "card" }, [manualForm]));

  try {
    const ZXingBrowser = await loadZxingBrowser();
    const reader = new ZXingBrowser.BrowserMultiFormatReader();
    let handled = false;
    const controls = await reader.decodeFromConstraints(
      { video: { facingMode: "environment" } },
      video,
      (result) => {
        if (handled || !dialog.open || !result) return;
        // A single failed decode frame (no barcode in view yet) has no `result` -- not a real
        // error, ZXing just keeps scanning the next frame on its own.
        handled = true;
        stopCamera();
        video.remove();
        runLookup(result.getText());
      },
    );
    if (!dialog.open) {
      // The sheet was closed while the scanner/camera was still starting up -- release it
      // immediately rather than leaking a live camera stream nobody can see.
      controls.stop();
    } else {
      scanControls = controls;
      stream = video.srcObject;
    }
  } catch (err) {
    // Camera denied/unavailable, or the scanner script itself failed to load -- real, honest
    // fallback to manual entry, never a dead end.
    video.remove();
    status.textContent = "Camera unavailable — type the barcode instead.";
  }

  dialog.showModal();
}

/** Renders one of the three real match states (exact / near / unknown) plus the price form. */
/** Real Open Food Facts enrichment (Git #3260) -- product image + per-100g nutrition facts +
 *  "genuinely high" flags, common to all three match states. `null` fields render nothing, the
 *  honest degrade for a barcode OFF has no data for. */
function renderOffEnrichment(result) {
  if (!result.productImage && !result.nutrition) return null;
  const parts = [];
  if (result.productImage) {
    parts.push(el("img", { src: result.productImage, alt: result.productName || "Product photo", class: "scan-product-image" }));
  }
  if (result.nutrition) {
    const n = result.nutrition;
    const flags = result.nutritionFlags || {};
    const row = (label, value, unit, isHigh) => {
      if (value == null) return null;
      const chips = [el("span", { class: "small", text: `${label} ${value}${unit}/100g` })];
      if (isHigh) chips.push(el("span", { class: "chip warn", text: "High" }));
      return el("div", { class: "row" }, chips);
    };
    const rows = [
      row("Sodium", n.sodiumG100g, "g", flags.highSodium),
      row("Saturated fat", n.saturatedFatG100g, "g", flags.highSaturatedFat),
      row("Sugars", n.sugarsG100g, "g", flags.highSugar),
      row("Fiber", n.fiberG100g, "g", false),
    ].filter(Boolean);
    if (rows.length > 0) {
      parts.push(el("div", { class: "card scan-nutrition" }, [el("div", { class: "small muted", text: "Per 100g" }), ...rows]));
    }
  }
  return parts.length > 0 ? el("div", { class: "scan-enrichment" }, parts) : null;
}

function renderScanResult(list, dialog, result) {
  const wrap = el("div", { class: "section" });
  const priceInput = el("input", { type: "number", step: "0.01", min: "0", placeholder: "0.00", inputmode: "decimal", "aria-label": "Price" });
  let chosenItemId = null;
  let chosenText = null;

  const enrichment = renderOffEnrichment(result);
  if (enrichment) wrap.append(enrichment);

  if (result.match === "exact") {
    wrap.append(
      el("div", { class: "card" }, [
        el("div", { class: "title", text: result.productName }),
        el("div", { class: "meta", text: result.lastPriceCents != null ? `On your list · last time ${formatPriceCents(result.lastPriceCents)}` : "On your list" }),
      ]),
    );
    chosenItemId = result.itemId;
    chosenText = result.itemId ? null : result.productName;
    if (result.lastPriceCents != null) priceInput.value = (result.lastPriceCents / 100).toFixed(2);
  } else if (result.match === "near") {
    wrap.append(el("p", { class: "small", text: `"${result.productName}" — is this one of these?` }));
    for (const c of result.candidates) {
      wrap.append(
        el("button", {
          class: "tile",
          text: c.text,
          onClick: (event) => {
            chosenItemId = c.id;
            chosenText = null;
            for (const b of wrap.querySelectorAll("button.tile")) b.removeAttribute("aria-pressed");
            event.currentTarget.setAttribute("aria-pressed", "true");
          },
        }),
      );
    }
    wrap.append(
      el("button", {
        class: "tile",
        text: "Something else",
        onClick: (event) => {
          chosenItemId = null;
          chosenText = result.productName || null;
          for (const b of wrap.querySelectorAll("button.tile")) b.removeAttribute("aria-pressed");
          event.currentTarget.setAttribute("aria-pressed", "true");
        },
      }),
    );
  } else {
    wrap.append(
      el("p", { class: "small", text: result.productName ? `"${result.productName}" isn't on your list.` : "Barcode not recognised." }),
    );
    wrap.append(
      el("button", {
        class: "tile",
        text: `Add "${result.productName || "this item"}" to the list`,
        onClick: (event) => {
          chosenItemId = null;
          chosenText = result.productName || "Scanned item";
          for (const b of wrap.querySelectorAll("button.tile")) b.removeAttribute("aria-pressed");
          event.currentTarget.setAttribute("aria-pressed", "true");
        },
      }),
    );
    wrap.append(el("p", { class: "small muted", text: "It's one of these:" }));
    for (const item of list.items.filter((i) => !i.done)) {
      wrap.append(
        el("button", {
          class: "tile",
          text: item.text,
          onClick: (event) => {
            chosenItemId = item.id;
            chosenText = null;
            for (const b of wrap.querySelectorAll("button.tile")) b.removeAttribute("aria-pressed");
            event.currentTarget.setAttribute("aria-pressed", "true");
          },
        }),
      );
    }
  }

  const saveError = el("p", { class: "small error" });
  const saveBtn = el("button", {
    class: "primary small",
    text: "Save price",
    onClick: async (event) => {
      const dollars = Number(priceInput.value);
      if (!Number.isFinite(dollars) || dollars < 0) {
        saveError.textContent = "Enter a real price.";
        return;
      }
      if (!chosenItemId && !chosenText) {
        saveError.textContent = "Pick what this is first.";
        return;
      }
      event.currentTarget.disabled = true;
      saveError.textContent = "";
      try {
        await api(`/api/lists/${list.id}/scan/save`, {
          method: "POST",
          body: JSON.stringify({
            barcode: result.barcode,
            itemId: chosenItemId,
            text: chosenText,
            priceCents: Math.round(dollars * 100),
          }),
        });
        dialog.close();
        render();
      } catch (err) {
        saveError.textContent = err.message;
        event.currentTarget.disabled = false;
      }
    },
  });

  wrap.append(el("div", { class: "row" }, [priceInput, saveBtn]), saveError);
  return wrap;
}

/**
 * The combined store + budget row (Git #3178, design 04): a location-pin pill with the store
 * name and a dropdown chevron, inline with the running total -- replacing the old two separate
 * boxy sections ("Publix" input box, then a separate "Update store" link below it). Tapping
 * either half swaps its display for an inline editor; there is no prompt() dialog anymore.
 */
function storeBudgetRow(list) {
  const storeDisplay = el("button", { type: "button", class: "shop-store-pill" }, [
    el("span", { html: SHOP_PIN_ICON }),
    el("span", { text: list.store || "Set a store" }),
    el("span", { html: SHOP_CHEVRON_DOWN_ICON }),
  ]);
  const storeInput = el("input", { value: list.store || "", placeholder: "e.g. Aldi", list: "known-stores", "aria-label": "Store" });
  const storeSave = el("button", { type: "button", class: "primary small", text: "Save" });
  const storeEdit = el("div", { class: "shop-store-edit" }, [storeInput, storeSave]);
  storeEdit.hidden = true;

  storeDisplay.addEventListener("click", () => {
    storeDisplay.hidden = true;
    storeEdit.hidden = false;
    storeInput.focus();
  });
  const commitStore = async () => {
    storeSave.disabled = true;
    try {
      await api(`/api/lists/${list.id}/store`, { method: "PATCH", body: JSON.stringify({ store: storeInput.value.trim() || null }) });
      render();
    } finally {
      storeSave.disabled = false;
    }
  };
  storeSave.addEventListener("click", commitStore);
  storeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitStore();
    }
  });

  // #3111: a real per-run budget + real running total. The total is real, not estimated -- it
  // sums list_items.price_cents, which only a real scan (#3109) ever sets, so it honestly reads
  // $0 until something on the run has actually been scanned.
  const overCents = list.overBudgetCents || 0;
  const over = overCents > 0;
  const budgetTotalRow = el("div", { class: "spread" }, [
    el("span", { class: "shop-budget-total", style: over ? "color:hsl(var(--destructive))" : "", text: money(list.totalCents) }),
    el("span", {
      class: "small muted",
      text: list.budget == null ? "set a budget" : over ? `${money(overCents)} over $${list.budget}` : `of $${list.budget}`,
    }),
  ]);
  const budgetDisplay = el("div", { class: "shop-budget-pill", role: "button", tabindex: "0" }, [budgetTotalRow]);
  if (list.budget != null) {
    const pct = Math.min(100, (list.totalCents / (list.budget * 100 || 1)) * 100);
    budgetDisplay.append(
      el("div", { class: "budget-bar" }, [
        el("div", { class: "budget-bar-fill", style: `width:${pct}%;background:hsl(var(--${over ? "destructive" : "warning"}))` }),
      ]),
    );
  }
  const budgetInput = el("input", { type: "number", step: "0.01", min: "0", value: list.budget == null ? "" : String(list.budget), placeholder: "Budget $", "aria-label": "Budget for this run" });
  const budgetSave = el("button", { type: "button", class: "primary small", text: "Save" });
  const budgetEdit = el("div", { class: "shop-budget-edit" }, [budgetInput, budgetSave]);
  budgetEdit.hidden = true;

  const openBudgetEdit = () => {
    budgetDisplay.hidden = true;
    budgetEdit.hidden = false;
    budgetInput.focus();
  };
  budgetDisplay.addEventListener("click", openBudgetEdit);
  budgetDisplay.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openBudgetEdit();
    }
  });
  const commitBudget = async () => {
    const raw = budgetInput.value.trim();
    const value = raw === "" ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) return;
    budgetSave.disabled = true;
    try {
      await api(`/api/lists/${list.id}/budget`, { method: "PATCH", body: JSON.stringify({ budget: value }) });
      render();
    } finally {
      budgetSave.disabled = false;
    }
  };
  budgetSave.addEventListener("click", commitBudget);
  budgetInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitBudget();
    }
  });

  return el("div", { class: "shop-storebar" }, [
    el("div", { class: "shop-store-slot" }, [storeDisplay, storeEdit]),
    el("div", { class: "shop-budget-slot" }, [budgetDisplay, budgetEdit]),
  ]);
}

/**
 * Informational-only "over budget" banner with the put-it-back / keep pair (design's own "I put
 * it back" / "Keep" copy) -- never blocks adding more. Offers the most-recently-priced items
 * first until enough of them would bring the run back under budget.
 */
function putBackBanner(list) {
  const overCents = list.overBudgetCents || 0;
  if (overCents <= 0) return null;
  const priced = list.items.filter((i) => i.price_cents != null).slice().reverse();
  let stillOver = overCents;
  const suggestions = [];
  for (const item of priced) {
    if (stillOver <= 0) break;
    suggestions.push(item);
    stillOver -= item.price_cents;
  }
  if (suggestions.length === 0) return null;
  const rows = suggestions.map((item) =>
    el("div", { class: "put-back-row" }, [
      el("div", { style: "flex:1" }, [el("span", { text: item.text }), el("span", { class: "who", text: money(item.price_cents) })]),
      el("button", {
        class: "small",
        text: "I put it back",
        onClick: async (event) => {
          event.currentTarget.disabled = true;
          await api(`/api/lists/${list.id}/items/${item.id}`, { method: "DELETE" });
          render();
        },
      }),
      el("button", { class: "ghost small", text: "Keep", onClick: (event) => event.currentTarget.closest(".put-back-row").remove() }),
    ]),
  );
  return el("div", { class: "card" }, [
    el("p", { class: "small", text: `${money(overCents)} over budget.` }),
    el("div", { class: "put-back" }, rows),
  ]);
}

/** Same fuzzy match as the design's own real `findItem` (First Slice Prototype): exact, then
 *  starts-with, then substring, then every word contained -- in that order, first hit wins. */
function findShoppingItem(items, query) {
  const l = String(query || "").toLowerCase().trim();
  if (!l) return null;
  const open = items.filter((i) => !i.done);
  const words = l.split(/\s+/);
  return (
    open.find((i) => i.text.toLowerCase() === l) ||
    open.find((i) => i.text.toLowerCase().startsWith(l)) ||
    open.find((i) => i.text.toLowerCase().includes(l)) ||
    open.find((i) => words.every((w) => i.text.toLowerCase().includes(w))) ||
    null
  );
}

/**
 * Shopping's own real capture dispatch (Git #3178), extracted from the design's own
 * `submitCapture(door)`: split on the same separators (",", ";", "and", "then") so "milk, eggs
 * and bread" adds three real items in one submission; a chunk shaped like "<item> aisle <n>
 * <note>" saves real aisle memory onto a fuzzy-matched item instead of adding a new one -- only
 * when a store is set, since store_aisles is keyed on (store, item). Everything else becomes a
 * new list item, same as the old dedicated "Add to Shopping" box did.
 */
async function submitShoppingCapture(text) {
  const list = state.shoppingList || (await api(`/api/shopping?order=${state.shoppingOrder || "flat"}`));
  const chunks = text
    .split(/\s*(?:,|;|\band\b|\bthen\b)\s*/i)
    .map((c) => c.trim())
    .filter(Boolean);

  const added = [];
  const aisleSaved = [];
  for (const chunk of chunks) {
    const m = list.store ? chunk.match(/^(.*?)\s*(?:is\s+(?:in|on)\s+)?aisle\s+(\d+)\s*[,.]?\s*(.*)$/i) : null;
    const target = m ? findShoppingItem(list.items, m[1]) : null;
    if (m && target) {
      await api(`/api/lists/${list.id}/items/${target.id}/aisle`, {
        method: "POST",
        body: JSON.stringify({ store: list.store, aisle: Number(m[2]), note: m[3].trim() || null }),
      });
      aisleSaved.push(target.text);
      continue;
    }
    const name = chunk.replace(/\b(remind me to|grab|get|buy|pick up|we need|need)\b/gi, "").trim();
    if (!name) continue;
    await api(`/api/lists/${list.id}/items`, { method: "POST", body: JSON.stringify({ items: [{ text: name }] }) });
    added.push(name);
  }

  const parts = [];
  if (added.length) parts.push(`${added.length} to the run`);
  if (aisleSaved.length) parts.push(`${aisleSaved.length} aisle spot${aisleSaved.length > 1 ? "s" : ""} saved`);
  captureStatus.textContent = parts.length ? parts.join(" · ") : "Got it.";
  setTimeout(() => (captureStatus.textContent = ""), 2200);
  render();
}

async function viewShopping(view) {
  const order = state.shoppingOrder || "flat";
  const [list, storesResult] = await Promise.all([api(`/api/shopping?order=${order}`), api("/api/stores")]);
  const remaining = list.items.filter((i) => !i.done).length;
  state.shoppingList = list; // read by the universal capture bar's shopping-room dispatch below.

  // Real stores already logged (Git #3112) -- offered as a datalist so the store-picker below
  // autocompletes onto the same store rather than a typo creating a near-duplicate.
  view.append(
    el(
      "datalist",
      { id: "known-stores" },
      storesResult.stores.map((s) => el("option", { value: s.name })),
    ),
  );

  // Native room chrome (Git #3178, design 04 + First Slice Prototype): back-to-Today link,
  // store name + a live count subtitle, and the scan icon that used to be its own button row.
  const subtitle = list.items.length === 0 ? "Nothing on the list" : remaining === 0 ? "all done" : `${remaining} left`;
  view.append(
    el("div", { class: "shop-header" }, [
      el("a", { href: "#/today", class: "shop-header-back" }, [el("span", { html: ROOM_HOUSE_ICON }), el("span", { text: "Today" })]),
      el("div", { class: "shop-header-center" }, [
        el("div", { class: "shop-header-title", text: list.store || "Shopping" }),
        el("div", { class: "shop-header-sub", text: subtitle }),
      ]),
      el("button", { type: "button", class: "shop-header-scan", "aria-label": "Scan a barcode", html: SHOP_SCAN_ICON, onClick: () => openScanSheet(list) }),
    ]),
  );
  view.append(el("div", { class: "shop-header-bar" }));

  // Flat / Category / Best path (Git #3108) -- the design's own real segmented control.
  const segment = (mode, label) =>
    el("button", {
      type: "button",
      class: `shop-segment-btn${order === mode ? " active" : ""}`,
      text: label,
      onClick: () => {
        state.shoppingOrder = mode;
        render();
      },
    });
  view.append(el("div", { class: "shop-segment" }, [segment("flat", "Flat"), segment("category", "Category"), segment("best", "Best path")]));

  view.append(storeBudgetRow(list));
  const banner = putBackBanner(list);
  if (banner) view.append(banner);

  // "Everything's in the cart." completion card (Git #3202, design First Slice Prototype
  // line ~1137's `d.allDone` block + README Screens section 3): once every real item on the
  // run is checked, offer the real fox completion state and a "Done shopping" action instead
  // of leaving the generic "Clear checked items" ghost button as the only way to close the
  // run out. Wired to the SAME real clear-checked endpoint the ghost button already uses --
  // #3112/#3108's price and aisle memory (item_prices / store_aisles) are keyed on item text
  // and store, not on the list_items rows this deletes, so "remembers it as your usual list"
  // is already true of that data; this card is the missing UI surface for it.
  const allDone = list.items.length > 0 && remaining === 0;
  if (allDone) {
    view.append(
      el("div", { class: "card shop-done-card" }, [
        el("div", { class: "shop-done-head" }, [
          el("span", { class: "shop-done-fox", html: '<svg width="52" height="52" viewBox="0 0 120 120" fill="none"><use href="#c-fox"></use></svg>' }),
          el("div", { class: "shop-done-title", text: "Everything's in the cart." }),
        ]),
        el("div", {
          class: "shop-done-sub",
          text: `Done clears the run and remembers it as your usual${list.store ? ` ${list.store}` : ""} list, prices and aisles included.`,
        }),
        el("button", {
          type: "button",
          class: "primary shop-done-btn",
          text: "Done shopping",
          onClick: async (event) => {
            event.currentTarget.disabled = true;
            await api(`/api/lists/${list.id}/clear-checked`, { method: "POST" });
            render();
          },
        }),
      ]),
    );
  }

  if (list.items.length === 0) {
    view.append(
      empty("Nothing on your list yet.", "Type into the box below, or ask Claude to push a list in over MCP.", "shop"),
    );
  } else if (order === "category") {
    for (const group of list.groups) {
      view.append(
        el("section", { class: "section" }, [
          el("div", { class: "shop-group-label", text: group.category }),
          el(
            "ul",
            { class: "shop-list" },
            group.items.map((item) => shoppingItemRow(list.id, item, { store: list.store })),
          ),
        ]),
      );
    }
  } else if (order === "best") {
    for (const group of list.groups) {
      view.append(
        el("section", { class: "section" }, [
          el("div", { class: "shop-group-label", text: `Aisle ${group.aisle}` }),
          el(
            "ul",
            { class: "shop-list" },
            group.items.map((item) => shoppingItemRow(list.id, item, { store: list.store })),
          ),
        ]),
      );
    }
    if (list.unknown?.length) {
      view.append(
        el("section", { class: "section" }, [
          el("p", { class: "small muted", style: "font-style:italic", text: list.store ? "No spot known yet -- say the aisle when you find it." : "Set a store above to start learning real aisle spots." }),
          el(
            "ul",
            { class: "shop-list" },
            list.unknown.map((item) => shoppingItemRow(list.id, item, { store: list.store })),
          ),
        ]),
      );
    }
  } else {
    const ul = el("ul", { class: "shop-list" });
    for (const item of list.items) ul.append(shoppingItemRow(list.id, item, { store: list.store }));
    view.append(el("section", { class: "section" }, [ul]));
  }

  // The dedicated "Add to Shopping" box and the standalone "Scan" button both used to live here
  // as their own separate controls. Design 04 / the First Slice Prototype show neither -- the
  // room has exactly one bottom bar (the universal capture box, its placeholder swapped to "Add,
  // or say where you found it" -- see render()) and the scan icon moved into the header above.

  if (remaining < list.items.length && !allDone) {
    view.append(
      el("div", { class: "row" }, [
        el("button", {
          class: "ghost small",
          text: "Clear checked items",
          onClick: async (event) => {
            event.currentTarget.disabled = true;
            await api(`/api/lists/${list.id}/clear-checked`, { method: "POST" });
            render();
          },
        }),
      ]),
    );
  }

  view.append(
    shareSection({
      shares: list.shares,
      supportsAdd: true,
      onCreate: (label, canAdd) => api("/api/shares", { method: "POST", body: JSON.stringify({ listId: list.id, label, canCheck: true, canAdd }) }),
      onRevoke: (id) => api(`/api/shares/${id}`, { method: "DELETE" }),
    }),
  );

  // Room watermark (Git #3119): "Shopping and the shared link -> shop pair" per the critter spec.
  attachRoomWatermark(view, "shop");
}

function itemRow(entityId, item) {
  const box = el("input", { type: "checkbox", ...(item.checked_at ? { checked: true } : {}) });
  const label = el("span", { class: item.checked_at ? "done" : "", text: item.text });
  const who = el("span", {
    class: "who",
    text: item.checked_by && item.checked_by !== "owner" ? `ticked by ${item.checked_by.replace(/^share:/, "")}` : "",
  });
  box.addEventListener("change", async () => {
    box.disabled = true;
    try {
      const updated = await api(`/api/entities/${entityId}/items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ checked: box.checked }),
      });
      label.className = updated.checked_at ? "done" : "";
      who.textContent = updated.checked_by && updated.checked_by !== "owner" ? `ticked by ${updated.checked_by.replace(/^share:/, "")}` : "";
    } finally {
      box.disabled = false;
    }
  });
  return el("li", {}, [box, el("div", {}, [label, item.note ? el("span", { class: "who", text: item.note }) : null, who])]);
}

/**
 * The passkeys on this account. A signed-in session may add another device without an enrolment
 * token — the session it already holds is the authorisation. It may not remove the last one:
 * there is no password to fall back on, so that would be a lockout, and the server refuses it.
 */
async function renderPasskeys(view) {
  const { passkeys } = await api("/api/passkeys");
  const section = el("section", { class: "section" }, [
    el("h2", { text: "Passkeys" }),
    el("p", {
      class: "muted small",
      text: "How you sign in. There is no password on this account.",
    }),
  ]);

  for (const key of passkeys) {
    section.append(
      el("div", { class: "card" }, [
        el("div", { class: "title", text: key.label }),
        el("div", {
          class: "meta",
          text:
            `added ${new Date(key.created_at).toLocaleDateString()} · ` +
            (key.last_used_at ? `last used ${when(key.last_used_at)}` : "never used") +
            (key.backed_up ? " · synced" : " · this device only"),
        }),
        passkeys.length > 1
          ? el("div", { class: "row", style: "margin-top:.75rem" }, [
              el("button", {
                class: "small danger",
                text: "Remove",
                onClick: async (event) => {
                  event.currentTarget.disabled = true;
                  try {
                    await api(`/api/passkeys/${key.id}`, { method: "DELETE" });
                    await render();
                  } catch (err) {
                    event.currentTarget.disabled = false;
                    alert(err.message);
                  }
                },
              }),
            ])
          : el("div", { class: "meta", text: "The only passkey on this account — add another before removing it." }),
      ]),
    );
  }

  section.append(
    el("div", { class: "row", style: "margin-top:.75rem" }, [
      el("button", {
        class: "small",
        text: "Add a passkey on this device",
        onClick: async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          try {
            await createPasskey({ label: `Passkey ${passkeys.length + 1}` });
            await render();
          } catch (err) {
            button.disabled = false;
            if (err.name !== "NotAllowedError" && err.name !== "AbortError") alert(err.message);
          }
        },
      }),
    ]),
  );

  view.append(section);
}

// Real Web Push subscribe/unsubscribe (Git #3160). base64url -> Uint8Array for
// pushManager.subscribe's applicationServerKey, which the Push API requires as raw bytes, not a
// string -- there is no built-in decoder for this in the browser.
function urlBase64ToUint8Array(base64url) {
  const padded = base64url.padEnd(base64url.length + ((4 - (base64url.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function renderPushSettings(view) {
  const section = el("section", { class: "section" }, [
    el("h2", { text: "Notifications" }),
    el("p", {
      class: "muted small",
      text: "Real nudges (day-before appointments, vaccine reminders) as real OS notifications on this device, with mark done / snooze / dismiss right on the notification.",
    }),
  ]);

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    section.append(el("div", { class: "card" }, [el("div", { class: "meta", text: "This browser doesn't support push notifications." })]));
    view.append(section);
    return;
  }

  const card = el("div", { class: "card" });
  section.append(card);
  view.append(section);

  async function refresh() {
    card.replaceChildren(el("div", { class: "meta", text: "Checking…" }));
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      card.replaceChildren(
        el("div", { class: "spread" }, [
          el("div", { class: "title", text: "Notifications are on" }),
          el("button", {
            class: "small danger",
            text: "Turn off",
            onClick: async (event) => {
              event.currentTarget.disabled = true;
              try {
                await api("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: subscription.endpoint }) });
                await subscription.unsubscribe();
              } finally {
                await refresh();
              }
            },
          }),
        ]),
      );
      return;
    }

    card.replaceChildren(
      el("button", {
        class: "primary small",
        text: "Turn on notifications",
        onClick: async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          try {
            const { publicKey } = await api("/api/push/vapid-public-key");
            if (!publicKey) {
              alert("Push isn't configured on the server yet.");
              return;
            }
            const permission = await Notification.requestPermission();
            if (permission !== "granted") return;
            const sub = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(publicKey),
            });
            await api("/api/push/subscribe", {
              method: "POST",
              body: JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: arrayBufferToBase64url(sub.getKey("p256dh")), auth: arrayBufferToBase64url(sub.getKey("auth")) } }),
            });
          } catch (err) {
            if (err.name !== "NotAllowedError") alert(err.message);
          } finally {
            button.disabled = false;
            await refresh();
          }
        },
      }),
    );
  }

  await refresh();
}

function arrayBufferToBase64url(buf) {
  const bytes = new Uint8Array(buf);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Real "House · Room order" Settings card (Git #3215, `v4-settings-room-order.png`) -- the
// first card, per github.md's own sync note. Up/down arrows (the real screenshot, not drag),
// each real room's own current lit/subtitle read (the same roomsForToday() state the house grid
// itself renders), and a real "Reset to the default order" action. Every reorder saves
// immediately -- no separate "Save" button, matching the rest of Settings' own instant-save
// actions (health context aside, which has an explicit Save because it's free text).
async function renderRoomOrderSettings(view) {
  const data = await api("/api/today");
  const rooms = data.rooms || {};
  let order = orderedRoomDefs(data.roomOrder).map((def) => def.key);

  const section = el("section", { class: "section" }, [
    el("div", { class: "section-label-row" }, [
      el("h2", { text: "House · Room order" }),
      el("span", { class: "meta small", text: "most used at the top" }),
    ]),
  ]);
  const list = el("div", { class: "card" });
  const resetBtn = el("button", { class: "ghost small", text: "Reset to the default order" });
  section.append(list, resetBtn);
  section.append(
    el("p", {
      class: "muted small",
      text: "Top of the list is the top floor, left before right. The house redraws as you go.",
    }),
  );
  view.append(section);

  async function saveOrder() {
    await api("/api/room-order", { method: "PATCH", body: JSON.stringify({ order }) });
  }

  function renderRows() {
    list.replaceChildren();
    order.forEach((key, i) => {
      const def = ROOM_DEFS.find((d) => d.key === key);
      const room = rooms[key];
      list.append(
        el("div", { class: "spread room-order-row" }, [
          el("div", { class: "row", style: "align-items:center;gap:.6rem" }, [
            critterIcon(def.critterSlot, { size: 32 }),
            el("div", {}, [
              el("div", { class: "title small", text: def.title }),
              el("div", { class: "meta", text: room ? room.subtitle : "" }),
            ]),
          ]),
          el("div", { class: "row" }, [
            el("button", {
              class: "ghost small icon-btn",
              text: "↑",
              "aria-label": `Move ${def.title} up`,
              disabled: i === 0,
              onClick: async () => {
                [order[i - 1], order[i]] = [order[i], order[i - 1]];
                renderRows();
                await saveOrder();
              },
            }),
            el("button", {
              class: "ghost small icon-btn",
              text: "↓",
              "aria-label": `Move ${def.title} down`,
              disabled: i === order.length - 1,
              onClick: async () => {
                [order[i + 1], order[i]] = [order[i], order[i + 1]];
                renderRows();
                await saveOrder();
              },
            }),
          ]),
        ]),
      );
    });
  }

  resetBtn.addEventListener("click", async () => {
    resetBtn.disabled = true;
    try {
      const res = await api("/api/room-order", { method: "DELETE" });
      order = res.order;
      renderRows();
    } finally {
      resetBtn.disabled = false;
    }
  });

  renderRows();
}

async function viewSettings(view) {
  const { tokens, endpoint } = await api("/api/mcp-tokens");

  await renderRoomOrderSettings(view);

  view.append(
    el("section", { class: "section" }, [
      el("h2", { text: "Account" }),
      el("div", { class: "card" }, [
        el("div", { class: "title", text: state.user.name }),
        el("div", { class: "meta", text: state.user.email }),
        // No password column exists anywhere in this schema (migration 013's own design
        // choice) -- sign-in is always a real WebAuthn assertion, so this is a real statement
        // of fact, not marketing copy.
        el("div", { class: "meta", style: "margin-top:.25rem", text: "Signed in with a passkey. No password exists for this account." }),
        el("div", { class: "row", style: "margin-top:.75rem" }, [
          el("button", {
            class: "small danger",
            text: "Sign out everywhere",
            onClick: async () => {
              await api("/api/auth/logout-everywhere", { method: "POST" });
              showLogin();
            },
          }),
        ]),
      ]),
    ]),
  );

  await renderPasskeys(view);
  await renderPushSettings(view);

  // Section 5's real health context -- stated once, read by Claude before it generates recipes
  // (Section 8: "state once, respected everywhere, forever"). Editable here too so it never has
  // to be re-said in a Claude conversation just because a session started this way instead.
  const { healthContext } = await api("/api/health-context");
  const healthInput = el("textarea", {
    rows: 3,
    placeholder: "e.g. stage 2 heart disease, hypertension — favor heart-healthy meals",
    "aria-label": "Health context",
    text: healthContext || "",
  });
  view.append(
    el("section", { class: "section" }, [
      el("h2", { text: "Health context" }),
      el("p", { class: "muted small", text: "Stated once, read by Claude before it generates recipes — never re-asked." }),
      el("div", { class: "card" }, [
        healthInput,
        el("div", { class: "row", style: "margin-top:.6rem" }, [
          el("button", {
            class: "primary small",
            text: "Save",
            onClick: async (event) => {
              event.currentTarget.disabled = true;
              try {
                await api("/api/health-context", { method: "PATCH", body: JSON.stringify({ healthContext: healthInput.value.trim() || null }) });
              } finally {
                event.currentTarget.disabled = false;
              }
            },
          }),
        ]),
      ]),
    ]),
  );

  // Real saved places (Git #3159). No add-place form here (Section 3, "no forms, anywhere,
  // ever") -- a place is only ever created by saying "remember this as Home" into the real
  // capture box while actually standing there; Claude files it over MCP (push_place). This is
  // read-only-plus-forget, same tier as "Sign out everywhere" / "Revoke" above -- a plain action
  // button, not a dedicated input field.
  const { items: savedPlaces } = await api("/api/places");
  const placesSection = el("section", { class: "section" }, [
    el("h2", { text: "Places" }),
    el("p", { class: "muted small", text: "Say “remember this as …” while you're actually there, and Claude files it here — with real content surfaced on Today when you're back." }),
  ]);
  if (savedPlaces.length === 0) {
    placesSection.append(el("p", { class: "muted small", text: "None saved yet." }));
  } else {
    for (const place of savedPlaces) {
      placesSection.append(
        el("div", { class: "card" }, [
          el("div", { class: "spread" }, [
            el("div", {}, [
              el("div", { class: "title", text: place.label }),
              el("div", { class: "meta", text: [place.house ? `House ${place.house.toUpperCase()}` : null, place.note || `${place.radius_meters}m radius`].filter(Boolean).join(" · ") }),
            ]),
            el("button", {
              class: "ghost small danger",
              text: "Forget",
              onClick: async (event) => {
                event.target.disabled = true;
                await api(`/api/places/${place.id}`, { method: "DELETE" });
                render();
              },
            }),
          ]),
        ]),
      );
    }
  }
  view.append(placesSection);

  const mcp = el("section", { class: "section" }, [
    el("h2", { text: "Claude (MCP)" }),
    el("p", { class: "muted small", text: "A token lets a Claude conversation write straight into this app. Everything it does is recorded under its label." }),
    el("div", { class: "card" }, [
      el("div", { class: "meta", text: "Endpoint" }),
      el("pre", { class: "token", text: endpoint }),
    ]),
  ]);

  for (const token of tokens.filter((t) => !t.revoked_at)) {
    mcp.append(
      el("div", { class: "card" }, [
        el("div", { class: "spread" }, [
          el("div", {}, [
            el("div", { class: "title", text: token.label }),
            el("div", { class: "meta", text: `${token.call_count} ${token.call_count === 1 ? "call" : "calls"} · ${token.last_used_at ? `last used ${when(token.last_used_at)}` : "never used"}` }),
          ]),
          el("button", {
            class: "ghost small danger",
            text: "Revoke",
            onClick: async (event) => {
              event.target.disabled = true;
              await api(`/api/mcp-tokens/${token.id}`, { method: "DELETE" });
              render();
            },
          }),
        ]),
      ]),
    );
  }

  const nameInput = el("input", { placeholder: "Name this connection, e.g. Claude on my phone", "aria-label": "Token label" });
  const issued = el("div");
  mcp.append(
    el("div", { class: "card" }, [
      nameInput,
      el("div", { class: "row", style: "margin-top:.6rem" }, [
        el("button", {
          class: "primary small",
          text: "Create token",
          onClick: async (event) => {
            event.target.disabled = true;
            try {
              const token = await api("/api/mcp-tokens", {
                method: "POST",
                body: JSON.stringify({ label: nameInput.value.trim() }),
              });
              issued.replaceChildren(
                el("p", { class: "small ok", text: "Shown once. Copy it now." }),
                el("pre", { class: "token", text: token.token }),
                el("p", { class: "small muted", text: "For a client that cannot set a header, use this URL instead:" }),
                el("pre", { class: "token", text: token.urlForm }),
              );
              nameInput.value = "";
            } catch (err) {
              issued.replaceChildren(el("p", { class: "small error", text: err.message }));
            } finally {
              event.target.disabled = false;
            }
          },
        }),
      ]),
      issued,
    ]),
  );
  view.append(mcp);

  // Home Screen widget (Git #3188) -- a third-party iOS "Widget Web" app's own token, since its
  // WKWebView shares neither this app's session cookie nor its passkeys.
  const { tokens: widgetTokenList } = await api("/api/widget-tokens");
  const widget = el("section", { class: "section" }, [
    el("h2", { text: "Home Screen widget" }),
    el("p", { class: "muted small", text: "Paste this URL into a Widget Web-style app (e.g. Widget Web 26) as the widget's page. It shows the same Next card Today does." }),
  ]);

  for (const token of widgetTokenList.filter((t) => !t.revoked_at)) {
    widget.append(
      el("div", { class: "card" }, [
        el("div", { class: "spread" }, [
          el("div", {}, [
            el("div", { class: "title", text: token.label }),
            el("div", {
              class: "meta",
              // Screenshot count IS how often the widget app has actually rendered the page
              // (Git #3214) -- a real, live usage signal, not just "a link was minted once".
              text: token.last_used_at
                ? `${token.screenshot_count} screenshot${token.screenshot_count === 1 ? "" : "s"} · last ${agoShort(token.last_used_at)}`
                : "never loaded",
            }),
          ]),
          el("button", {
            class: "ghost small danger",
            text: "Revoke",
            onClick: async (event) => {
              event.target.disabled = true;
              await api(`/api/widget-tokens/${token.id}`, { method: "DELETE" });
              render();
            },
          }),
        ]),
      ]),
    );
  }

  const widgetNameInput = el("input", { placeholder: "Name this widget, e.g. Home Screen", "aria-label": "Widget label" });
  const widgetIssued = el("div");
  widget.append(
    el("div", { class: "card" }, [
      widgetNameInput,
      el("div", { class: "row", style: "margin-top:.6rem" }, [
        el("button", {
          class: "primary small",
          text: "Create widget link",
          onClick: async (event) => {
            event.target.disabled = true;
            try {
              const token = await api("/api/widget-tokens", {
                method: "POST",
                body: JSON.stringify({ label: widgetNameInput.value.trim() }),
              });
              widgetIssued.replaceChildren(
                el("p", { class: "small ok", text: "Shown once. Copy it now." }),
                el("pre", { class: "token", text: token.urlForm }),
              );
              widgetNameInput.value = "";
            } catch (err) {
              widgetIssued.replaceChildren(el("p", { class: "small error", text: err.message }));
            } finally {
              event.target.disabled = false;
            }
          },
        }),
      ]),
      widgetIssued,
    ]),
  );
  widget.append(
    el("div", { class: "row" }, [
      el("a", { class: "small", href: "/api/widget-preview", target: "_blank", rel: "noopener", text: "Preview the widget page →" }),
    ]),
  );
  view.append(widget);

  await renderTeslaSettings(view);

  const { activity } = await api("/api/activity?limit=25");
  const log = el("section", { class: "section" }, [
    el("h2", { text: "Recent activity" }),
    el("p", { class: "muted small", text: "A real, transparent log of what Claude wrote -- every tool call, under its own client's label." }),
  ]);
  if (activity.length === 0) {
    log.append(el("p", { class: "muted small", text: "Nothing written yet." }));
  } else {
    for (const row of activity) {
      log.append(
        el("div", { class: "tile" }, [
          el("div", { class: "meta small", text: new Date(row.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) }),
          el("div", { class: "title small", text: activitySummary(row) }),
        ]),
      );
    }
  }
  view.append(log);
}

// Tesla (Git #3158): the real OAuth connection + vehicle pick + the webhook tokens that back the
// "Heading Out" checklist's real climate-preconditioning trigger. Connecting is a real top-level
// navigation (a plain <a href="/auth/tesla/start">), not a fetch -- Tesla's own authorize page is
// a whole separate site the browser has to actually visit, the same reason Plaid's Link SDK
// exists as client-side redirect handling rather than something `api()` could do.
async function renderTeslaSettings(view) {
  const status = await api("/api/tesla/status");
  const section = el("section", { class: "section" }, [
    el("h2", { text: "Tesla" }),
    el("p", { class: "muted small", text: "Powers the real \"Heading out\" nudge, triggered by climate preconditioning starting -- not a scheduled time." }),
  ]);

  if (!status.configured) {
    section.append(el("p", { class: "muted small", text: "Not configured on this server." }));
    view.append(section);
    return;
  }

  if (!status.connected) {
    section.append(
      el("div", { class: "card" }, [
        pillButton("a", { href: "/auth/tesla/start" }, "Connect Tesla", "primary"),
      ]),
    );
    view.append(section);
    return;
  }

  const vehicleCard = el("div", { class: "card" });
  if (status.vehicleId) {
    vehicleCard.append(
      el("div", { class: "title", text: status.vehicleDisplayName || "Vehicle connected" }),
      el("div", { class: "meta", text: `Connected ${agoShort(status.connectedAt)}` }),
    );
    const climateOut = el("div", { class: "meta", style: "margin-top:.5rem" });
    vehicleCard.append(
      el("div", { class: "row", style: "margin-top:.6rem" }, [
        el("button", {
          class: "ghost small",
          text: "Check climate now",
          onClick: async (event) => {
            event.target.disabled = true;
            try {
              const climate = await api("/api/tesla/climate");
              climateOut.textContent = climate.isPreconditioning
                ? "Preconditioning now"
                : climate.isClimateOn
                  ? "Climate on"
                  : "Climate off";
            } catch (err) {
              climateOut.textContent = err.message;
            } finally {
              event.target.disabled = false;
            }
          },
        }),
        el("button", {
          class: "ghost small danger",
          text: "Disconnect",
          onClick: async (event) => {
            event.target.disabled = true;
            await api("/api/tesla/disconnect", { method: "POST" });
            render();
          },
        }),
      ]),
      climateOut,
    );
  } else {
    // Connected to Tesla but no real vehicle chosen yet -- the account can hold more than one.
    const picker = el("div", { class: "muted small", text: "Loading vehicles…" });
    vehicleCard.append(el("div", { class: "title", text: "Connected -- pick a vehicle" }), picker);
    api("/api/tesla/vehicles")
      .then(({ vehicles }) => {
        if (vehicles.length === 0) {
          picker.textContent = "No vehicles found on this Tesla account.";
          return;
        }
        picker.replaceChildren(
          ...vehicles.map((v) =>
            el("div", { class: "row", style: "margin-top:.4rem" }, [
              el("button", {
                class: "ghost small",
                text: v.displayName || v.vin,
                onClick: async (event) => {
                  event.target.disabled = true;
                  await api("/api/tesla/vehicles/select", {
                    method: "POST",
                    body: JSON.stringify({ vehicleId: v.id, vin: v.vin, displayName: v.displayName }),
                  });
                  render();
                },
              }),
            ]),
          ),
        );
      })
      .catch((err) => {
        picker.textContent = err.message;
      });
  }
  section.append(vehicleCard);

  if (status.vehicleId) {
    section.append(await renderTeslaCommuteSettings());

    // Git #3218's real first Tesla-room automation: "Done shopping" -> a real 5-minute countdown
    // -> the real trunk opens.
    const commandsCard = el("div", { class: "card" }, [
      el("div", { class: "title", text: "Checkout-to-trunk" }),
      el("div", { class: "meta", text: "5 minutes after \"Done shopping\" clears the cart, the trunk opens automatically." }),
    ]);
    if (!status.commandsConfigured) {
      commandsCard.append(el("p", { class: "muted small", style: "margin-top:.5rem", text: "The vehicle-command proxy is not configured on this server -- this automation is armed but inert until it is." }));
    }
    const toggleRow = el("label", { class: "row", style: "margin-top:.6rem;align-items:center;gap:.5rem" }, [
      el("input", { type: "checkbox", ...(status.autoTrunkOnCheckout ? { checked: true } : {}) }),
      el("span", { text: "Auto-open trunk after checkout" }),
    ]);
    toggleRow.querySelector("input").addEventListener("change", async (event) => {
      event.target.disabled = true;
      try {
        await api("/api/tesla/auto-trunk-on-checkout", {
          method: "PATCH",
          body: JSON.stringify({ enabled: event.target.checked }),
        });
      } catch (err) {
        event.target.checked = !event.target.checked;
        alert(err.message);
      } finally {
        event.target.disabled = false;
      }
    });
    commandsCard.append(toggleRow);

    const pendingOut = el("div", { style: "margin-top:.5rem" });
    commandsCard.append(pendingOut);
    api("/api/tesla/scheduled-commands")
      .then(({ commands }) => {
        if (commands.length === 0) return;
        pendingOut.replaceChildren(
          ...commands.map((c) =>
            el("div", { class: "row spread", style: "align-items:center" }, [
              el("span", { class: "small", text: `Trunk opens ${inShort(c.scheduled_for)}` }),
              el("button", {
                class: "ghost small",
                text: "Cancel",
                onClick: async (event) => {
                  event.target.disabled = true;
                  await api(`/api/tesla/scheduled-commands/${c.id}`, { method: "DELETE" });
                  render();
                },
              }),
            ]),
          ),
        );
      })
      .catch(() => {});
    section.append(commandsCard);
  }

  // The real webhook tokens -- same shape/discipline as MCP and widget tokens above: a
  // high-entropy value shown exactly once, only its SHA-256 kept.
  const { tokens: hookTokens } = await api("/api/tesla/hook-tokens");
  section.append(
    el("p", { class: "muted small", style: "margin-top:.75rem", text: "A webhook link an external automation (iOS Shortcuts, IFTTT, Home Assistant) posts to when it observes real climate preconditioning start." }),
  );
  for (const token of hookTokens.filter((t) => !t.revoked_at)) {
    section.append(
      el("div", { class: "card" }, [
        el("div", { class: "spread" }, [
          el("div", {}, [
            el("div", { class: "title", text: token.label }),
            el("div", { class: "meta", text: token.last_used_at ? `last used ${agoShort(token.last_used_at)}` : "never used" }),
          ]),
          el("button", {
            class: "ghost small danger",
            text: "Revoke",
            onClick: async (event) => {
              event.target.disabled = true;
              await api(`/api/tesla/hook-tokens/${token.id}`, { method: "DELETE" });
              render();
            },
          }),
        ]),
      ]),
    );
  }

  const hookNameInput = el("input", { placeholder: "Name this trigger, e.g. Shortcuts automation", "aria-label": "Webhook label" });
  const hookIssued = el("div");
  section.append(
    el("div", { class: "card" }, [
      hookNameInput,
      el("div", { class: "row", style: "margin-top:.6rem" }, [
        el("button", {
          class: "primary small",
          text: "Create webhook link",
          onClick: async (event) => {
            event.target.disabled = true;
            try {
              const issued = await api("/api/tesla/hook-tokens", {
                method: "POST",
                body: JSON.stringify({ label: hookNameInput.value.trim() }),
              });
              hookIssued.replaceChildren(
                el("p", { class: "small ok", text: "Shown once. Copy it now." }),
                el("pre", { class: "token", text: issued.hookUrl }),
              );
              hookNameInput.value = "";
            } catch (err) {
              hookIssued.replaceChildren(el("p", { class: "small error", text: err.message }));
            } finally {
              event.target.disabled = false;
            }
          },
        }),
      ]),
      hookIssued,
    ]),
  );
  view.append(section);
}

// Tesla battery/charging-aware Money nudge settings (Git #3238). Every input here is real,
// Shane-entered data -- see core/tesla.mjs's own header and migration 056 for why the cost
// estimate can't come from Tesla directly (its Fleet API has no documented per-kWh pricing
// field). Rendered as its own card inside the Tesla section, only once a real vehicle is
// selected (the check needs a real battery-range read).
async function renderTeslaCommuteSettings() {
  const settings = await api("/api/tesla/commute-settings");
  const card = el("div", { class: "card" }, [
    el("div", { class: "title", text: "Charge for tomorrow's commute" }),
    el("p", { class: "muted small", text: "A real nudge if tonight's charge won't cover the commute distance below -- checked every few hours." }),
  ]);

  const enabledToggle = el("input", { type: "checkbox", checked: settings.lowBatteryNudgeEnabled || undefined });
  const commuteInput = el("input", {
    type: "number", step: "0.1", inputmode: "decimal", placeholder: "e.g. 42",
    value: settings.commuteMilesNeeded ?? "", "aria-label": "Commute miles needed",
  });
  const efficiencyInput = el("input", {
    type: "number", step: "0.01", inputmode: "decimal", placeholder: "e.g. 3.5",
    value: settings.efficiencyMilesPerKwh ?? "", "aria-label": "Vehicle efficiency, miles per kWh",
  });
  const costInput = el("input", {
    type: "number", step: "0.001", inputmode: "decimal", placeholder: "e.g. 0.36",
    value: settings.chargeCostPerKwh ?? "", "aria-label": "Cost per kWh",
  });
  const saveOut = el("div", { class: "small", style: "margin-top:.4rem" });
  const checkOut = el("div", { class: "small", style: "margin-top:.4rem" });

  card.append(
    el("label", { class: "row", style: "margin-top:.6rem" }, [enabledToggle, el("span", { text: " Enable this nudge" })]),
    el("label", { class: "small muted", text: "Commute miles needed tomorrow" }),
    commuteInput,
    el("label", { class: "small muted", style: "margin-top:.4rem", text: "Your vehicle's real efficiency (miles per kWh) -- optional, needed for a cost estimate" }),
    efficiencyInput,
    el("label", { class: "small muted", style: "margin-top:.4rem", text: "Your real cost per kWh (home electricity or Supercharger rate) -- optional, needed for a cost estimate" }),
    costInput,
    el("div", { class: "row", style: "margin-top:.6rem" }, [
      el("button", {
        class: "primary small",
        text: "Save",
        onClick: async (event) => {
          event.target.disabled = true;
          try {
            await api("/api/tesla/commute-settings", {
              method: "PATCH",
              body: JSON.stringify({
                lowBatteryNudgeEnabled: enabledToggle.checked,
                commuteMilesNeeded: commuteInput.value === "" ? null : Number(commuteInput.value),
                efficiencyMilesPerKwh: efficiencyInput.value === "" ? null : Number(efficiencyInput.value),
                chargeCostPerKwh: costInput.value === "" ? null : Number(costInput.value),
              }),
            });
            saveOut.textContent = "Saved.";
          } catch (err) {
            saveOut.textContent = err.message;
          } finally {
            event.target.disabled = false;
          }
        },
      }),
      el("button", {
        class: "ghost small",
        text: "Check now",
        onClick: async (event) => {
          event.target.disabled = true;
          try {
            const result = await api("/api/tesla/commute-check");
            if (!result.checked) checkOut.textContent = `Not checked (${result.reason}).`;
            else if (!result.needsCharge) checkOut.textContent = "Real range covers tomorrow's commute -- no charge needed.";
            else {
              const cost = result.costEstimate !== null ? ` About $${result.costEstimate.toFixed(2)} to cover it.` : "";
              checkOut.textContent = `${result.batteryRangeMiles} mi range vs ${result.commuteMilesNeeded} mi needed -- short ${result.shortfallMiles} mi.${cost}`;
            }
          } catch (err) {
            checkOut.textContent = err.message;
          } finally {
            event.target.disabled = false;
          }
        },
      }),
    ]),
    saveOut,
    checkOut,
  );
  return card;
}

// The real, per-client tool-call summary Recent activity shows (Git #3214: "Claude Desktop ·
// set_medication · Vitamin D3, morning, auto-refill"). detail.tool is the real MCP tool name a
// Claude conversation invoked -- see core/audit.mjs -- and falls back to the plain `web`/`widget`
// action string for non-MCP actors, which never carry a tool name. Whatever else is in `detail`
// (real values a handler actually recorded, never invented) joins in as the trailing summary.
function activitySummary(row) {
  const who = row.actor_label || (row.actor === "web" ? "You" : row.actor === "widget" ? "Widget" : row.actor);
  const tool = row.detail?.tool || row.action;
  const rest = Object.entries(row.detail || {})
    .filter(([k, v]) => k !== "tool" && v !== null && v !== undefined && typeof v !== "object")
    .map(([, v]) => String(v));
  const bits = [who, tool];
  if (rest.length > 0) bits.push(rest.join(", "));
  return bits.join(" · ");
}

// ---------------------------------------------------------------------------
// Dates (Git #3136) -- design handoff screens 8/9.
// Git #3192 -- Round 2 visual rebuild. No dedicated "Shanes Life NN - Dates.dc.html" export
// exists (#3183's own audit confirmed it), so this reuses the README's own generic "Rooms
// (sub pages) -- the same skin" spec (top tint glow + house back-link, Dates' real tint
// 244,114,182) plus the Round 2 building blocks already proven on Today (#3144): 22px
// cards/tiles, 999px pill buttons, and rotated -5deg stickers -- scoped to a `.dates-room`
// wrapper so it doesn't reflow the other rooms still waiting on their own pass
// (#3190/#3191/#3193-3195).
// ---------------------------------------------------------------------------

const DATES_TINT = "244,114,182"; // README's own room-tint table, "Dates".

/** Generic "Rooms (sub pages)" chrome (design README line 179): a translucent top glow
 *  tinted per room, plus the house back-link to Today. Shopping (#3178) built the back-link
 *  piece first, scoped to its own solid header band; this is the plain glow+back-link shape
 *  every *other* room's own Round 2 pass reuses verbatim. Dates is the first real caller.
 *
 *  `icon` (Git #3194, Lists is the first caller to need it) is the optional right-side blob
 *  pebble the First Slice Prototype's own "showLists" markup draws opposite the back-link
 *  (`d.cr.lists`) -- when passed, the title centers between the two, mirroring the same
 *  back/center/right symmetry Shopping's own header (#3178) already uses. Omitted, this is
 *  Dates/Pets' original plain back-link + left-flowing title, unchanged. */
function roomHeader(view, tintRgb, title, { icon } = {}) {
  view.append(
    el("div", { class: "room-scene" }, [
      el("div", { class: "room-glow", style: `background: radial-gradient(120% 70% at 50% -20%, rgba(${tintRgb},.22), transparent 70%)` }),
      el("div", { class: "room-header" }, [
        el("a", { href: "#/today", class: "room-header-back" }, [el("span", { html: ROOM_HOUSE_ICON }), el("span", { text: "Today" })]),
        el("div", { class: `room-header-title${icon ? " with-icon" : ""}`, text: title }),
        icon ? el("div", { class: "room-header-icon", style: `background:rgba(${tintRgb},.16)` }, [icon]) : null,
      ]),
    ]),
  );
}

// Tile colors, exactly screen 8's own table.
const KIND_TINT = {
  appointment: "#60a5fa",
  vet: "#2dd4bf",
  vaccine: "#2dd4bf",
  birthday: "#f472b6",
  event: "#fbbf24",
  holiday: "#a78bfa",
  visit: "#34d399",
  renewal: "#fb923c",
};

function kindTint(kind) {
  return KIND_TINT[kind] || "#94a3b8"; // slate, for a genuinely on-the-fly kind
}

function dateTileEl(atDateISO, kind) {
  const d = new Date(`${String(atDateISO).slice(0, 10)}T00:00:00`);
  const tint = kindTint(kind);
  return el(
    "div",
    { class: "date-tile", style: `background:${tint}26; color:${tint}; border:1px solid ${tint}59` },
    [
      el("span", { class: "month", text: d.toLocaleDateString([], { month: "short" }) }),
      el("span", { class: "day", text: String(d.getDate()) }),
    ],
  );
}

/** "today / tomorrow / Wed / in N days" -- design's own right-column vocabulary. */
function dueLabel(dueInDays, atDateISO) {
  if (dueInDays < 0) return "overdue";
  if (dueInDays === 0) return "today";
  if (dueInDays === 1) return "tomorrow";
  if (dueInDays <= 6) {
    const d = new Date(`${String(atDateISO).slice(0, 10)}T00:00:00`);
    return d.toLocaleDateString([], { weekday: "short" });
  }
  return `in ${dueInDays} days`;
}

// The seven known lead-time kinds (server's LEAD_DAYS_BY_KIND, minus the synthetic 'holiday'
// rows federal_holidays contributes) -- anything else is a genuinely on-the-fly category.
const KNOWN_DATE_KINDS = new Set(["appointment", "vet", "birthday", "event", "visit", "renewal", "vaccine"]);

function kindLabel(kind) {
  return kind
    .split("_")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function dateSummaryLine(item) {
  const bits = [item.category_label || kindLabel(item.kind)];
  if (item.at_time) bits.push(new Date(`1970-01-01T${item.at_time}`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  if (item.interval_days) bits.push(`every ${item.interval_days} days`);
  if (item.provider) bits.push(item.provider);
  return bits.join(" · ");
}

function dateRow(item) {
  const isOnTheFly = !item.isFederalHoliday && !KNOWN_DATE_KINDS.has(item.kind);
  const right = el("div", { class: "when", text: dueLabel(item.due_in_days, item.at_date) });
  const body = el("div", { class: "body" }, [
    el("div", { class: "row" }, [
      el("span", { class: "title", text: item.title }),
      // Git #3192: the rotated -5deg sticker (already proven on Today's Next card), not the
      // plain uppercase .chip badge -- tinted slate to match kindTint's own on-the-fly fallback.
      isOnTheFly ? sticker("slate", "New category") : null,
    ]),
    el("div", { class: "meta", text: dateSummaryLine(item) }),
    el("div", { class: "meta", text: `${item.lead_days}-day lead` }),
  ]);
  const row = el("div", { class: "date-row" }, [dateTileEl(item.at_date, item.kind), body, right]);
  if (item.isFederalHoliday) return el("div", { class: "tile" }, [row]);
  return el("a", { class: "tile", href: `#/date/${item.id}` }, [row]);
}

async function viewDates(view) {
  const { dates: items } = await api("/api/dates");

  roomHeader(view, DATES_TINT, "Dates");
  const room = el("div", { class: "dates-room" });

  const groups = [
    { label: "This week", items: items.filter((i) => i.due_in_days <= 6) },
    { label: "This month", items: items.filter((i) => i.due_in_days > 6 && i.due_in_days <= 31) },
    { label: "Later", items: items.filter((i) => i.due_in_days > 31) },
  ];

  if (items.length === 0) {
    room.append(
      empty(
        "Nothing on the calendar yet.",
        "Tell Claude something like \"dr appointment oct 3rd 2pm dr fonji every 6 weeks\" and it'll show up here.",
      ),
    );
  } else {
    for (const group of groups) {
      if (group.items.length === 0) continue;
      const section = el("section", { class: "section" }, [el("h2", { text: group.label })]);
      for (const item of group.items) section.append(dateRow(item));
      room.append(section);
    }
  }

  room.append(
    el("section", { class: "section" }, [
      el("p", { class: "muted small", text: "Federal holidays come from a real, live OPM source, refreshed monthly." }),
    ]),
  );

  view.append(room);
  attachRoomWatermark(view, "comingup");
}

function askRow(dateId, ask) {
  const row = el("div", { class: `ask-row${ask.asked_at ? " asked" : ""}` }, [
    el("div", { class: "text", text: ask.text }),
    el("button", {
      class: "ghost small",
      text: ask.asked_at ? "Asked" : "Mark asked",
      onClick: async (event) => {
        event.currentTarget.disabled = true;
        await api(`/api/dates/${dateId}/asks/${ask.id}`, {
          method: "PATCH",
          body: JSON.stringify({ asked: !ask.asked_at }),
        });
        await render();
      },
    }),
  ]);
  return row;
}

function visitRow(dateId, visit) {
  const photos = el("div", {}, visit.photos.map((p) =>
    el("span", { class: "photo-chip", text: p.label || "photo" }),
  ));
  return el("div", { class: "visit-row" }, [
    el("div", { class: "body" }, [
      el("div", { class: "title small", text: whenDate(visit.visited_on) }),
      visit.notes ? el("div", { class: "meta", text: visit.notes }) : null,
      visit.photos.length > 0 ? photos : null,
    ]),
  ]);
}

async function viewDateDetail(view, dateId) {
  const item = await api(`/api/dates/${dateId}`);

  const d = new Date(`${String(item.at_date).slice(0, 10)}T00:00:00`);
  const dateLine = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + (item.at_time ? ` · ${new Date(`1970-01-01T${item.at_time}`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "");

  roomHeader(view, DATES_TINT, item.title);
  const room = el("div", { class: "dates-room" });

  room.append(
    el("section", { class: "section" }, [
      el("div", { class: "card" }, [
        el("div", { class: "date-row" }, [
          dateTileEl(item.at_date, item.kind),
          el("div", { class: "body" }, [
            el("h1", { text: dateLine, style: "margin:0; font-size:20px" }),
            el("div", { class: "meta", text: dateSummaryLine(item) }),
          ]),
        ]),
        el("p", { class: "meta muted small", text: `Surfaces ${item.lead_days} day${item.lead_days === 1 ? "" : "s"} ahead.` }),
        item.notes ? el("p", { class: "muted", text: item.notes }) : null,
        el("div", { class: "row", style: "margin-top:.75rem" }, [
          el("button", {
            class: "small ghost",
            text: item.done_at ? "Mark not done" : "Mark done",
            onClick: async (event) => {
              event.currentTarget.disabled = true;
              await api(`/api/dates/${dateId}`, { method: "PATCH", body: JSON.stringify({ done: !item.done_at }) });
              location.hash = "#/dates";
            },
          }),
          el("button", {
            class: "small ghost danger",
            text: "Delete",
            onClick: async (event) => {
              if (!confirm("Delete this date?")) return;
              event.currentTarget.disabled = true;
              await api(`/api/dates/${dateId}`, { method: "DELETE" });
              location.hash = "#/dates";
            },
          }),
        ]),
      ]),
    ]),
  );

  // "Ask next time" -- appointments and vet visits only, per the design.
  if (item.kind === "appointment" || item.kind === "vet") {
    const asks = el("section", { class: "section" }, [el("h2", { text: "Ask next time" })]);
    const card = el("div", { class: "card" });
    if (item.asks.length === 0) card.append(el("p", { class: "muted small", text: "Nothing queued to ask yet." }));
    for (const ask of item.asks) card.append(askRow(dateId, ask));
    // Git #3183: no dedicated "Add" input for a new question -- attach_ask over MCP already
    // exists for it. Say "ask Dr. Fonji about the knee brace next time" and Claude matches
    // it onto this appointment by provider.
    asks.append(card);
    room.append(asks);

    // "Notes and photos, by visit."
    const visits = el("section", { class: "section" }, [el("h2", { text: "Notes and photos, by visit" })]);
    const visitCard = el("div", { class: "card" });
    if (item.visits.length === 0) visitCard.append(el("p", { class: "muted small", text: "No visits logged yet." }));
    for (const visit of item.visits) visitCard.append(visitRow(dateId, visit));
    // Git #3192 (contract pack Section 8, "no forms, anywhere, ever"): the "How did it go?"
    // notes textarea + "Log this visit" button was a real, dedicated form the #3183 no-forms
    // pass missed -- attach_visit already exists over MCP for exactly this ("This is 'Notes and
    // photos, by visit' on the date-detail screen", tools.mjs). Say "the vet visit went fine,
    // pepper's ear infection is clearing up" and it lands here, same as attach_ask above.
    visitCard.append(el("p", { class: "muted small", style: "margin-top:.6rem", text: "Tell Claude how it went and it shows up here." }));
    visits.append(visitCard);
    room.append(visits);
  } else {
    // Every other kind gets one explanatory note instead (design's own screen 9 spec).
    const explain = {
      holiday: "Real US federal holidays, pulled from OPM's live schedule and refreshed monthly.",
      birthday: "Yearly, with a 10-day lead.",
      event: "A want-to-go event, with a 14-day lead.",
      visit: "A visit window, with a 3-day lead.",
      renewal: "A renewal, with a 21-day lead -- worth pairing with Money's renewal watch.",
      vaccine: "A vaccine due date, with a 30-day lead.",
    };
    room.append(
      el("section", { class: "section" }, [
        el("p", { class: "muted small", text: explain[item.kind] || "A real, on-the-fly kind Claude created for this capture." }),
      ]),
    );
  }

  view.append(room);
  attachRoomWatermark(view, "comingup");
}

// ---------------------------------------------------------------------------
// pets (Git #3141 -- design contract pack Section 6)
// Git #3193 -- Round 2 visual rebuild. No dedicated "Shanes Life NN - Pets.dc.html" export
// exists (#3183's own audit confirmed it), so this follows the real design prose that does
// exist: README "Screens" #10 (44px initial avatar, species/breed/age, amber-when-in-lead-
// window due line) plus the rendered screenshots/06-pets.png reference -- and reuses the
// generic roomHeader() chrome Dates (#3192) built for exactly this ("every *other* room's own
// Round 2 pass reuses verbatim"), rather than a third bespoke header.
// ---------------------------------------------------------------------------

const PETS_TINT = "52,211,153"; // README's own room-tint table, "Pets".

function petCardEl(pet) {
  const age = ageYears(pet.born);
  const born = monthYear(pet.born);
  const ageBit = age === null ? null : born ? `${age}, born ${born}` : `${age}`;
  const meta = [pet.species, pet.breed, ageBit].filter(Boolean).join(" · ") || null;
  // A vaccine goes amber the moment it enters its lead window -- listPets already computes
  // surfacesInDays (dueInDays - leadDays) for exactly this, same "needs you" signal as Meds'
  // own .refill-days-left.due.
  const dueSoon = pet.nextVaccine !== null && pet.nextVaccine.surfacesInDays <= 0;
  const right = pet.nextVaccine
    ? el("div", { class: `when${dueSoon ? " due" : ""}`, text: `${pet.nextVaccine.name}: ${dueLabel(pet.nextVaccine.dueInDays, pet.nextVaccine.dueOn)}` })
    : el("div", { class: "when", text: "Nothing due" });
  return el("a", { class: "tile", href: `#/pet/${pet.id}` }, [
    el("div", { class: "date-row" }, [
      el("div", { class: "pet-avatar", text: personInitial(pet.name) }),
      el("div", { class: "body" }, [
        el("div", { class: "title", text: pet.name }),
        meta ? el("div", { class: "meta", text: meta }) : null,
      ]),
      right,
    ]),
  ]);
}

async function viewPets(view) {
  const items = await api("/api/pets");

  roomHeader(view, PETS_TINT, "Pets");
  const room = el("div", { class: "pets-room" });

  if (items.pets.length === 0) {
    room.append(
      empty(
        "No pets on file yet.",
        "Tell Claude something like \"we have a dog named Pepper, a lab\" and it'll show up here.",
        "pets",
      ),
    );
  } else {
    const list = el("section", { class: "section" }, items.pets.map(petCardEl));
    room.append(list);
  }

  // Real, verbatim explanatory copy from the design's own rendered reference (screenshots/
  // 06-pets.png, First Slice Prototype) -- same "vet visit is an appointment, feeding/meds ride
  // Meds, vaccines get a month's notice" prose as contract pack Section 6, not paraphrased.
  room.append(
    el("section", { class: "section" }, [
      el("p", {
        class: "muted small",
        text: "A vet visit is an appointment with the pet as the subject, same day-before reminder, same ask next time note. Feeding and pet meds ride the two Meds batches. Vaccines get a month's notice.",
      }),
    ]),
  );

  // Git #3183: no dedicated "Add pet" form -- a new pet is a capture (set_pet over MCP
  // already exists for it), same as everything else (contract pack Section 8).

  view.append(room);
  attachRoomWatermark(view, "pets");
}

function vaccineRow(petId, v) {
  const dueOnISO = v.due_on ? String(v.due_on).slice(0, 10) : null;
  const dueInDays = dueOnISO ? Math.round((new Date(dueOnISO) - new Date(new Date().toISOString().slice(0, 10))) / 86_400_000) : null;
  return el("div", { class: "date-row" }, [
    el("div", { class: "body" }, [
      el("div", { class: "title small", text: v.name }),
      el("div", { class: "meta", text: dueOnISO ? `Due ${whenDate(dueOnISO)}${v.fine_until ? ` (fine until ${whenDate(String(v.fine_until).slice(0, 10))})` : ""}` : "No due date on file." }),
      v.interval_days ? el("div", { class: "meta", text: `Every ${v.interval_days} days · ${v.lead_days}-day lead` }) : el("div", { class: "meta", text: `${v.lead_days}-day lead` }),
    ]),
    dueInDays === null ? null : el("div", { class: "when", text: dueLabel(dueInDays, dueOnISO) }),
    el("button", {
      class: "ghost small",
      text: "Given",
      onClick: async (event) => {
        event.currentTarget.disabled = true;
        await api(`/api/pets/${petId}/vaccines/${v.id}/given`, { method: "POST", body: JSON.stringify({}) });
        await render();
      },
    }),
  ]);
}

function careRow(petId, c) {
  return el("div", { class: "date-row" }, [
    el("div", { class: "body" }, [
      el("div", { class: "title small", text: c.name }),
      el("div", { class: "meta", text: `${kindLabel(c.batch)} batch${c.detail ? ` · ${c.detail}` : ""}` }),
    ]),
    el("button", {
      class: "ghost small danger",
      text: "Remove",
      onClick: async (event) => {
        if (!confirm(`Remove "${c.name}"?`)) return;
        event.currentTarget.disabled = true;
        await api(`/api/pets/${petId}/care/${c.id}`, { method: "DELETE" });
        await render();
      },
    }),
  ]);
}

async function viewPetDetail(view, petId) {
  const pet = await api(`/api/pets/${petId}`);

  view.append(
    el("section", { class: "section" }, [
      el("div", { class: "card" }, [
        el("h1", { text: pet.name, style: "margin:0 0 .25rem" }),
        // Git #3193: same age/born convention as the list card (petCardEl) -- whenDate's
        // day-level "Mon D" format drops the year, which is meaningless for a birthdate years
        // back (a pet "born Mar 15" reads like three days ago, not six years ago).
        el("div", { class: "meta", text: [pet.species, pet.breed, pet.born ? `${ageYears(pet.born)}, born ${monthYear(pet.born)}` : null].filter(Boolean).join(" · ") || "No details on file." }),
        pet.notes ? el("p", { class: "muted", text: pet.notes }) : null,
        el("div", { class: "row", style: "margin-top:.75rem" }, [
          el("button", {
            class: "small ghost danger",
            text: "Delete pet",
            onClick: async (event) => {
              if (!confirm(`Delete ${pet.name}? This removes their vaccines, care items and records too.`)) return;
              event.currentTarget.disabled = true;
              await api(`/api/pets/${petId}`, { method: "DELETE" });
              location.hash = "#/pets";
            },
          }),
        ]),
      ]),
    ]),
  );

  // Vaccines
  const vaccines = el("section", { class: "section" }, [el("h2", { text: "Vaccines" })]);
  const vCard = el("div", { class: "card" });
  if (pet.vaccines.length === 0) vCard.append(el("p", { class: "muted small", text: "No vaccines on file yet." }));
  for (const v of pet.vaccines) vCard.append(vaccineRow(petId, v));
  // Git #3183: no dedicated "Add" vaccine form -- set_pet_vaccine over MCP already exists
  // for it. Say "pepper's rabies is due february 2027" and it lands here.
  vaccines.append(vCard);
  view.append(vaccines);

  // Feeding & meds (Section 6: reuses the Meds batch system -- these merge into /api/medications).
  const care = el("section", { class: "section" }, [
    el("h2", { text: "Feeding & meds" }),
    el("p", { class: "muted small", text: "Shows up in the same Meds batch swipe as Shane's own." }),
  ]);
  const cCard = el("div", { class: "card" });
  if (pet.care.length === 0) cCard.append(el("p", { class: "muted small", text: "Nothing on file yet." }));
  for (const c of pet.care) cCard.append(careRow(petId, c));
  // Git #3183: no dedicated "Add" care-item form -- set_pet_care over MCP already exists
  // for it. Say "pepper gets a joint chew every morning" and it lands here.
  care.append(cCard);
  view.append(care);

  // Real vet-visit history, read back from Dates (subjectType 'pet').
  if (pet.vetDates.length > 0) {
    const visits = el("section", { class: "section" }, [el("h2", { text: "Vet visits" })]);
    const vetCard = el("div", { class: "card" });
    for (const d of pet.vetDates) {
      vetCard.append(
        el("a", { class: "tile", href: `#/date/${d.id}` }, [
          el("div", { class: "date-row" }, [
            el("div", { class: "body" }, [
              el("div", { class: "title small", text: d.title }),
              el("div", { class: "meta", text: `${whenDate(String(d.at_date).slice(0, 10))}${d.provider ? ` · ${d.provider}` : ""}` }),
            ]),
          ]),
        ]),
      );
    }
    visits.append(vetCard);
    view.append(visits);
  }

  // Records (photo chips) -- same media-or-url shape as date_photos.
  const records = el("section", { class: "section" }, [el("h2", { text: "Records" })]);
  const rCard = el("div", { class: "card" });
  if (pet.records.length === 0) rCard.append(el("p", { class: "muted small", text: "No records yet." }));
  else rCard.append(el("div", {}, pet.records.map((r) => el("span", { class: "photo-chip", text: r.label || "record" }))));
  records.append(rCard);
  view.append(records);

  attachRoomWatermark(view, "pets");
}

// ---------------------------------------------------------------------------
// routing
// ---------------------------------------------------------------------------

const TITLES = { today: "Today", shopping: "Shopping", recipes: "Recipes", meds: "Meds", money: "Money", wins: "Wins", inbox: "Inbox", dates: "Dates", pets: "Pets", lists: "Lists", things: "Things", people: "People", person: "", settings: "Settings", entity: "", cook: "Cook", date: "", pet: "", car: "", tonight: "Tonight" };

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [head, ...rest] = hash.split("/");
  state.route = head || "today";
  state.categoryFilter = state.route === "things" ? rest[0] || null : null;
  state.entity = state.route === "entity" ? rest[0] : null;
  state.cookRecipeId = state.route === "cook" ? rest[0] : null;
  state.dateId = state.route === "date" ? rest[0] : null;
  state.petId = state.route === "pet" ? rest[0] : null;
  state.carId = state.route === "car" ? rest[0] : null;
  state.personId = state.route === "person" ? rest[0] : null;
}

async function render() {
  parseRoute();
  const view = $("#view");
  view.replaceChildren();
  resetCritterRender(); // Git #3119: a slot's pair-alt only advances within a single screen.
  $("#view-title").textContent = TITLES[state.route] ?? "";

  // Git #3174: Today's own fox/weather scene (renderTodayHeader) IS the header per the real
  // design -- the generic title-bar chrome is leftover Foundation-era shell (#3087) that the
  // Today tray's Round 2 redesign never used. Git #3178: Shopping is the second room to get its
  // own native chrome (viewShopping's own .shop-header). Git #3190: Recipes is the third --
  // README "Screens" names it explicitly alongside Shopping ("Recipes... keep their solid
  // card-colored header band"), and its own content (title + live "you can make" count) now
  // supplies enough context on its own, same as #3190's own real question asked. Git #3191: Meds
  // is the fourth (viewMeds' own medsHeader). Git #3192: Dates and its detail screen are the
  // fifth and sixth, via the generic roomHeader() (README "Rooms (sub pages)"). Git #3193: Pets
  // is the seventh, the second real roomHeader() caller. Git #3194: Lists is the eighth, the
  // third roomHeader() caller and the first to pass its own right-side icon -- the generic bar's
  // only other real function was "Sign out", which Settings' own "Sign out everywhere"
  // (viewSettings) already covers, the same real check that cleared Shopping/Dates. Git #3277:
  // Things, People, Money, Wins and Inbox are the ninth through thirteenth -- the last five real
  // rooms in ROOM_DEFS that were still falling through to the old generic bar (whose only real
  // action, "Sign out", Settings already covers -- so those five had NO way back to Today at all).
  // Every real ROOM_DEFS room now has its own header. #app-view.no-header lets .view collapse its
  // top padding to just the native status-bar safe area instead of assuming a header row sits
  // above it (see app.css).
  const hasOwnHeader = state.route === "today" || state.route === "shopping" || state.route === "recipes" || state.route === "meds" || state.route === "dates" || state.route === "date" || state.route === "pets" || state.route === "lists" || state.route === "things" || state.route === "people" || state.route === "money" || state.route === "wins" || state.route === "inbox";
  $("#app-header").hidden = hasOwnHeader;
  $("#app-view").classList.toggle("no-header", hasOwnHeader);

  // Git #3178: the universal capture box is the SAME single bar in Shopping, not a second one --
  // the real design (First Slice Prototype's own submitCapture) just swaps its placeholder and,
  // in Shopping, its dispatch (see the #capture submit handler below).
  captureText.placeholder = state.route === "shopping" ? "Add, or say where you found it" : "Say anything…";

  // A wake lock (Git #3125) is only ever held for cook mode itself -- release it the moment
  // navigation moves anywhere else, rather than waiting on the tab losing visibility.
  if (state.route !== "cook") releaseCookWakeLock();

  try {
    if (state.route === "shopping") await viewShopping(view);
    else if (state.route === "recipes") await viewRecipes(view);
    else if (state.route === "tonight") await viewTonight(view);
    else if (state.route === "cook") await viewCook(view, state.cookRecipeId);
    else if (state.route === "meds") await viewMeds(view);
    else if (state.route === "money") await viewMoney(view);
    else if (state.route === "wins") await viewWins(view);
    else if (state.route === "inbox") await viewInbox(view);
    else if (state.route === "dates") await viewDates(view);
    else if (state.route === "date") await viewDateDetail(view, state.dateId);
    else if (state.route === "pets") await viewPets(view);
    else if (state.route === "pet") await viewPetDetail(view, state.petId);
    else if (state.route === "car") await viewCarDetail(view, state.carId);
    else if (state.route === "lists") await viewLists(view);
    else if (state.route === "things") await viewThings(view);
    else if (state.route === "people") await viewPeople(view);
    else if (state.route === "person") await viewPersonDetail(view, state.personId);
    else if (state.route === "settings") await viewSettings(view);
    else if (state.route === "entity") await viewEntity(view, state.entity);
    else await viewToday(view);
  } catch (err) {
    if (err.status === 401) return showLogin();
    view.replaceChildren(el("div", { class: "card" }, [el("p", { class: "error", text: err.message })]));
  }
}

window.addEventListener("hashchange", render);

// ---------------------------------------------------------------------------
// Pull-to-refresh (Git #3268, sub-issue of #3220/#3086)
//
// iOS Home Screen PWAs run in standalone display mode -- no URL bar/browser chrome, so there is
// nothing to natively pull down from once Shane's installed the app. This is a real in-app
// gesture rather than a reliance on native browser behavior, the same real class of platform
// quirk #3263 already found and fixed for getUserMedia/camera. Works the same in a regular
// browser tab too, so there's exactly one code path, not a standalone-detection branch.
// ---------------------------------------------------------------------------

const PTR_THRESHOLD = 64; // px of (resisted) pull distance before release triggers a refresh
const PTR_MAX_PULL = 100; // px cap on how far the indicator/content can be dragged
const PTR_RESISTANCE = 0.5; // real finger travel is damped so the drag never feels 1:1/rubbery

function attachPullToRefresh() {
  const view = $("#view");
  const indicator = $("#ptr-indicator");
  if (!view || !indicator) return;

  let startY = null;
  let pulling = false;
  let armed = false;
  let refreshing = false;

  const setPull = (distance) => {
    const eased = Math.min(distance, PTR_MAX_PULL);
    view.style.transform = distance > 0 ? `translateY(${eased}px)` : "";
    indicator.classList.add("ptr-visible");
    indicator.style.opacity = String(Math.min(eased / PTR_THRESHOLD, 1));
    indicator.style.transform = `translateY(${eased}px) scale(${Math.min(0.6 + eased / PTR_THRESHOLD * 0.4, 1)})`;
    armed = eased >= PTR_THRESHOLD;
    indicator.classList.toggle("ptr-armed", armed);
  };

  const reset = () => {
    view.classList.add("ptr-settling");
    view.style.transform = "";
    indicator.classList.remove("ptr-visible", "ptr-armed", "ptr-refreshing");
    indicator.style.opacity = "";
    indicator.style.transform = "";
    window.setTimeout(() => view.classList.remove("ptr-settling"), 220);
    startY = null;
    pulling = false;
    armed = false;
  };

  document.addEventListener(
    "touchstart",
    (e) => {
      // Only the genuine "already at the very top, pulling further down" gesture -- not mid-scroll,
      // never while a refresh from a previous pull is still in flight, and never on the sign-in/
      // enrolment screens (attachPullToRefresh is wired once at startup, before we know which
      // screen is showing).
      if (refreshing || window.scrollY > 0 || e.touches.length !== 1 || $("#app-view").hidden) return;
      startY = e.touches[0].clientY;
      pulling = true;
    },
    { passive: true },
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (!pulling || startY == null || refreshing) return;
      const deltaY = e.touches[0].clientY - startY;
      // A real upward drag, or the page having scrolled away from the top mid-gesture (e.g. a
      // room's own content grew), hands the gesture back to normal scrolling.
      if (deltaY <= 0 || window.scrollY > 0) {
        if (pulling) reset();
        return;
      }
      // Only once we're actually dragging past the top do we take over the touch -- this is what
      // stops the gesture from ever interfering with normal in-room scrolling.
      e.preventDefault();
      view.classList.remove("ptr-settling");
      setPull(deltaY * PTR_RESISTANCE);
    },
    { passive: false },
  );

  const finishPull = async () => {
    if (!pulling) return;
    pulling = false;
    if (!armed) return reset();

    refreshing = true;
    indicator.classList.add("ptr-refreshing");
    view.style.transform = `translateY(${PTR_THRESHOLD}px)`;
    indicator.style.opacity = "1";
    indicator.style.transform = `translateY(${PTR_THRESHOLD}px) scale(1)`;
    try {
      // render() (~line 8901) already re-fetches and redraws the current room's data -- the same
      // real hook the issue names, not a new refetch built alongside it.
      await render();
    } finally {
      refreshing = false;
      reset();
    }
  };

  document.addEventListener("touchend", finishPull, { passive: true });
  document.addEventListener("touchcancel", () => reset(), { passive: true });
}

async function start() {
  // The critter sprite (Git #3119) loads in parallel with everything else -- it's decorative,
  // so nothing in the real startup path waits on it.
  loadCritterSprite();
  // Wired once at startup regardless of route -- the gesture itself checks window.scrollY on
  // every touch, so it's always live for whichever room is on screen, not re-attached per room.
  attachPullToRefresh();
  // An enrolment link wins over everything: it is how the very first passkey gets created, and
  // at that moment there is by definition no session to load.
  if (enrollmentTokenFromUrl()) return showEnroll();
  const user = await loadMe();
  if (!user) return showLogin();
  // A Plaid OAuth bank sends the whole tab to its own site and back here (Git #3168). Resuming
  // has to happen before the normal render, or the return lands on the app shell with a live
  // Link session nobody ever picks back up.
  if (location.pathname === "/plaid-oauth") {
    $("#login-view").hidden = true;
    $("#app-view").hidden = false;
    return resumePlaidOAuthReturn();
  }
  $("#login-view").hidden = true;
  $("#enroll-view").hidden = true;
  $("#app-view").hidden = false;
  await render();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // A failed registration costs offline caching only; the app still works online.
  });
}

start().catch((err) => {
  console.error(err);
  showLogin();
});
