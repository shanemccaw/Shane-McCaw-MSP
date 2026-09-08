// Shane's Life -- the app shell. Plain ES modules, no framework, no build step.
//
// Every number and every row on this screen comes from a real endpoint. There is no fixture
// module anywhere in this directory and there must never be one.

import {
  initCritters,
  loadCritterSprite,
  resetCritterRender,
  critterIcon,
  attachPeeker,
  attachRoomWatermark,
  rollPeekers,
} from "./critters.js";

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

/** $1.79, from integer cents -- the whole schema stores money as price_cents (Git #3112). */
function money(cents) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
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

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

async function loadMe() {
  const me = await api("/api/me");
  state.user = me.user;
  if (me.user) {
    setInboxBadge(me.pendingCaptures);
    // Critter daily roll (Git #3119) -- seeded from the SERVER's date, per the design handoff,
    // never the client clock, so every device rolls the same critter for a slot on a given day.
    if (me.serverDate) initCritters(me.serverDate);
  }
  return me.user;
}

function setInboxBadge(count) {
  const badge = $("#inbox-badge");
  badge.textContent = count > 0 ? String(count) : "";
  badge.hidden = !count;
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
 * A fresh assertion inside a live session — what the vault reveal requires. Exported on the
 * module scope so the Money Feature can call it without reimplementing the dance.
 */
async function reverifyWithPasskey() {
  const options = await api("/api/auth/reverify/options", { method: "POST", body: "{}" });
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
  return api("/api/auth/reverify", {
    method: "POST",
    body: JSON.stringify({
      challenge: options.challenge,
      id: assertion.id,
      response: {
        clientDataJSON: bytesToB64url(assertion.response.clientDataJSON),
        authenticatorData: bytesToB64url(assertion.response.authenticatorData),
        signature: bytesToB64url(assertion.response.signature),
      },
    }),
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

captureText.addEventListener("input", () => {
  captureText.style.height = "auto";
  captureText.style.height = Math.min(captureText.scrollHeight, 128) + "px";
});

// Enter sends, Shift+Enter breaks the line. Capture friction is the core enemy
// (contract pack Section 2) -- reaching for a button should be optional.
captureText.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("#capture").requestSubmit();
  }
});

function setAttachment(attachment) {
  state.attachment = attachment;
  $("#capture-attachment").hidden = !attachment;
  if (attachment) $("#capture-attachment-label").textContent = attachment.label;
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
  const text = captureText.value.trim();
  if (!text && !state.attachment) return;
  const send = $("#capture-send");
  send.disabled = true;
  captureStatus.textContent = "Saving…";
  try {
    await api("/api/captures", {
      method: "POST",
      body: JSON.stringify({
        text: text || null,
        mediaId: state.attachment?.mediaId ?? null,
        kind: state.attachment?.kind || "text",
      }),
    });
    captureText.value = "";
    captureText.style.height = "auto";
    setAttachment(null);
    // Trust stated facts immediately (Section 8) -- it is saved, no confirmation dialog.
    captureStatus.textContent = "Got it.";
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

async function viewToday(view) {
  const data = await api("/api/today");
  setInboxBadge(data.pendingCaptures);

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
  const next = el("section", { class: "section" }, [nextLabelRow]);
  if (data.next.length === 0) {
    next.append(
      el("div", { class: "card" }, [
        el("p", { class: "muted", text: "Nothing is due. That is the whole message." }),
      ]),
    );
  } else {
    for (const item of data.next) {
      next.append(entityTile(item));
    }
  }
  view.append(next);

  // Peeker (Git #3119): "Next" is the one tray section label this app actually has today, so it
  // gets the day's first peek roll (`b`). Later/Meds/Rooms are the spec's other three tray
  // labels and get the next three (`b+1..b+3` via rollPeekers()), but none of those sections
  // exist in this app yet -- there's no tray Later row, Meds card or Rooms list to attach them
  // to. Wire those the moment those screens land.
  attachPeeker(nextLabel, rollPeekers()[0]);

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

  const recent = el("section", { class: "section" }, [el("h2", { text: "Recent" })]);
  if (data.recent.length === 0) {
    recent.append(
      empty("Nothing here yet.", "Type into the box below, or ask Claude to push something in over MCP."),
    );
  } else {
    for (const item of data.recent) recent.append(entityTile(item));
  }
  view.append(recent);
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

async function viewInbox(view) {
  const { captures } = await api("/api/captures?status=pending");
  setInboxBadge(captures.length);

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

async function viewThings(view) {
  const [{ entities }, { categories }] = await Promise.all([
    api("/api/entities?limit=200"),
    api("/api/categories"),
  ]);

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

// Recipes -- core list + ingredient matching (Git #3124). Cook mode, Tonight, and the Sunday
// ritual are each separate, real sibling Features; this screen only lists, matches against the
// real Shopping run, and lets Shane add what's missing or archive a recipe he doesn't want kept.
function recipeCard(recipe) {
  const badge = recipe.canMake
    ? el("span", { class: "chip ok", text: "You'll have everything" })
    : el("span", { class: "chip", text: `Missing ${recipe.missing.join(", ")}` });

  const addMissingBtn = recipe.canMake
    ? null
    : el("button", {
        class: "primary small",
        text: "Add missing to Shopping",
        onClick: async (event) => {
          event.currentTarget.disabled = true;
          try {
            await api(`/api/recipes/${recipe.id}/add-missing`, { method: "POST" });
            render();
          } finally {
            event.currentTarget.disabled = false;
          }
        },
      });

  const removeBtn = el("button", {
    class: "ghost small danger",
    text: "Remove",
    onClick: async (event) => {
      event.currentTarget.disabled = true;
      await api(`/api/recipes/${recipe.id}`, { method: "DELETE" });
      render();
    },
  });

  // Cook mode (Git #3125): a recipe with no real steps saved has nothing to walk through, so
  // there's no live entry point for it -- Claude just hasn't pushed steps for this one yet.
  const cookBtn =
    recipe.steps.length > 0
      ? el("button", { class: "primary small", text: "Cook", onClick: () => { location.hash = `#/cook/${recipe.id}`; } })
      : null;

  return el("div", { class: "card" }, [
    el("div", { class: "spread" }, [
      el("div", {}, [
        el("div", { class: "title", text: recipe.name }),
        el("div", { class: "meta", text: [recipe.timeText, recipe.heartHealthy ? "heart-healthy" : null].filter(Boolean).join(" · ") }),
      ]),
      badge,
    ]),
    recipe.needs.length > 0
      ? el("p", { class: "small muted", style: "margin:.5rem 0 0", text: recipe.needs.join(", ") })
      : null,
    el("div", { class: "row", style: "margin-top:.6rem" }, [cookBtn, addMissingBtn, removeBtn].filter(Boolean)),
  ]);
}

async function viewRecipes(view) {
  const { recipes } = await api("/api/recipes");
  const { entries: planEntries } = await api("/api/meal-plan");

  // #3127's real Sunday ritual: the week Claude planned, hosted and displayed here -- no
  // manual meal-planning calendar to author it in, only the one archive action to correct a
  // bad push (same "host, display, let Shane act" division of labor as Shopping/Recipes).
  if (planEntries.length > 0) {
    const plan = el("section", { class: "section" }, [el("h2", { text: "This week's plan" })]);
    for (const entry of planEntries) {
      plan.append(
        el("div", { class: "card" }, [
          el("div", { class: "spread" }, [
            el("div", {}, [
              el("div", { class: "meta small", text: `${entry.date} · ${entry.mealType}` }),
              el("div", { class: "title", text: entry.dishText }),
            ]),
            el("button", {
              class: "ghost small danger",
              text: "Remove",
              onClick: async (event) => {
                event.currentTarget.disabled = true;
                await api(`/api/meal-plan/${entry.id}`, { method: "DELETE" });
                render();
              },
            }),
          ]),
        ]),
      );
    }
    view.append(plan);
  }

  view.append(
    el("section", { class: "section" }, [
      el("div", { class: "spread" }, [
        el("h2", { text: "Recipes" }),
        el("span", { class: "chip", text: `${recipes.filter((r) => r.canMake).length} you can make from the list` }),
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
function lineIcon(pathsHtml, { size = 20 } = {}) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.5");
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

function medBatchCard(batchState) {
  const { batch, items, takenToday, takenAt } = batchState;
  const label = batch.charAt(0).toUpperCase() + batch.slice(1);

  const itemRows = items.map((item) =>
    el("div", { class: "med-item-row" }, [
      el("span", { text: item.name }),
      item.doseNote ? el("span", { class: "med-dose", text: item.doseNote }) : null,
    ]),
  );

  const card = el("div", { class: "card" }, [
    el("div", { class: "spread" }, [
      el("div", { class: "row" }, [critterIcon(medsCritterSlot(batch), { size: 32 }), el("span", { class: "title", text: label })]),
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

function refillNeedsYouCard(item) {
  const daysLeft = item.daysLeft;
  const dueSoon = daysLeft !== null && daysLeft <= 3;
  return el("div", { class: "card refill-row" }, [
    el("div", { style: "flex:1;min-width:0" }, [
      el("div", { class: "refill-tier-label needs-you", text: "Needs you" }),
      el("div", { class: "title", style: "margin-top:3px", text: daysLeft === null ? item.name : `${item.name} · ${daysLeft <= 0 ? "due now" : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`}` }),
      item.refillNote ? el("div", { class: `refill-days-left ${dueSoon ? "due" : ""}`, text: item.refillNote }) : null,
    ]),
    el("button", {
      class: "small",
      text: "Ordered it",
      onClick: async (event) => {
        event.currentTarget.disabled = true;
        try {
          await api(`/api/medications/${item.id}/ordered`, { method: "POST" });
          render();
        } finally {
          event.currentTarget.disabled = false;
        }
      },
    }),
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
    section.append(
      el("div", { class: "card refill-row" }, [
        el("div", { style: "flex:1;min-width:0" }, [
          el("div", { class: "refill-tier-label handled", text: "Handled automatically" }),
          el("div", { style: "margin-top:3px;line-height:1.45", text: refills.handled.map((h) => h.name).join(", ") }),
          el("div", { class: "refill-days-left", text: "Auto-refill · nothing to do" }),
        ]),
      ]),
    );
  }

  return section;
}

async function viewMeds(view) {
  const { batches, refills } = await api("/api/medications");

  view.append(
    el("section", { class: "section" }, [
      el("h2", { text: "Meds" }),
      el("p", { class: "muted small", text: "One slide per batch, not one tap per pill." }),
    ]),
  );

  if (batches.length === 0) {
    view.append(empty("No medications on file yet.", "Add one below, or ask Claude to add one for you.", "meds"));
  } else {
    const list = el("section", { class: "section" });
    for (const batchState of batches) list.append(medBatchCard(batchState));
    view.append(list);
  }

  view.append(refillsSection(refills));

  // Direct entry (same "reachable without going through Claude" idiom as createRecipe/
  // createEntity) -- most real medications will still be added by Claude over MCP
  // (set_medication), but there is no reason the web UI can't add one too.
  const nameInput = el("input", { placeholder: "Medication name", "aria-label": "Medication name" });
  const doseInput = el("input", { placeholder: "Dose, e.g. 1 tablet", "aria-label": "Dose" });
  const batchInput = el("input", { placeholder: "Batch, e.g. morning", "aria-label": "Batch", list: "med-batches" });
  const batchOptions = el(
    "datalist",
    { id: "med-batches" },
    batches.map((b) => el("option", { value: b.batch })),
  );
  const tierSelect = el("select", { "aria-label": "Refill tier" }, [
    el("option", { value: "manual", text: "Manual-watch (needs you)" }),
    el("option", { value: "auto", text: "Auto-refill (handled)" }),
  ]);
  const addForm = el("form", { class: "section" }, [
    nameInput,
    el("div", { class: "row" }, [doseInput, batchInput, batchOptions]),
    el("div", { class: "row" }, [tierSelect, el("button", { class: "primary small", type: "submit", text: "Add medication" })]),
  ]);
  addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    const batch = batchInput.value.trim();
    if (!name || !batch) return;
    addForm.querySelectorAll("input,select,button").forEach((n) => (n.disabled = true));
    try {
      await api("/api/medications", {
        method: "POST",
        body: JSON.stringify({ name, doseNote: doseInput.value.trim() || null, batch, refillTier: tierSelect.value }),
      });
      render();
    } finally {
      addForm.querySelectorAll("input,select,button").forEach((n) => (n.disabled = false));
    }
  });
  view.append(el("div", { class: "card" }, [addForm]));

  attachRoomWatermark(view, "meds");
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
function shareSection({ shares: shareList, onCreate, onRevoke }) {
  const section = el("section", { class: "section" }, [el("h2", { text: "Shared links" })]);
  const live = shareList.filter((s) => !s.revoked_at);
  if (live.length === 0) {
    section.append(el("p", { class: "muted small", text: "Not shared with anyone." }));
  }
  for (const share of live) {
    section.append(
      el("div", { class: "card" }, [
        el("div", { class: "spread" }, [
          el("div", {}, [
            el("div", { class: "title", text: share.label || "Unlabelled link" }),
            el("div", { class: "meta", text: `${share.can_check ? "can tick items" : "view only"} · opened ${share.view_count}x` }),
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
  const result = el("div");
  section.append(
    el("div", { class: "card" }, [
      labelInput,
      el("div", { class: "row", style: "margin-top:.6rem" }, [
        el("button", {
          class: "primary small",
          text: "Create a no-login link",
          onClick: async (event) => {
            event.target.disabled = true;
            try {
              const share = await onCreate(labelInput.value.trim() || null);
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

/**
 * Per-store price history (Git #3112): a "log a price" form and the item's real history, both
 * expanded inline rather than routed to a separate screen -- there is no per-item detail route
 * in this app's minimal hash router, and the design keeps Shopping to one scrolling screen.
 */
function priceTools(item) {
  const wrap = el("div", { class: "price-tools" });
  const logBtn = el("button", { class: "ghost small", type: "button", text: "Log price" });
  const historyBtn = el("button", { class: "ghost small", type: "button", text: "History" });
  const panel = el("div");
  wrap.append(el("div", { class: "row" }, [logBtn, historyBtn]), panel);

  logBtn.addEventListener("click", () => {
    if (panel.dataset.mode === "log") {
      panel.replaceChildren();
      panel.dataset.mode = "";
      return;
    }
    panel.dataset.mode = "log";
    const storeInput = el("input", { placeholder: "Store, e.g. Aldi", "aria-label": "Store", list: "known-stores" });
    const priceInput = el("input", { type: "number", step: "0.01", min: "0", placeholder: "0.00", "aria-label": "Price" });
    const dateInput = el("input", { type: "date", value: new Date().toISOString().slice(0, 10), "aria-label": "Date" });
    const saveBtn = el("button", { class: "primary small", type: "button", text: "Save price" });
    const msg = el("span", { class: "small" });
    saveBtn.addEventListener("click", async () => {
      const storeName = storeInput.value.trim();
      const dollars = Number(priceInput.value);
      if (!storeName || !Number.isFinite(dollars) || dollars < 0) {
        msg.className = "small error";
        msg.textContent = "A store and a real price are both required.";
        return;
      }
      saveBtn.disabled = true;
      try {
        await api("/api/prices", {
          method: "POST",
          body: JSON.stringify({
            storeName,
            itemText: item.text,
            priceCents: Math.round(dollars * 100),
            observedOn: dateInput.value || null,
          }),
        });
        render();
      } catch (err) {
        msg.className = "small error";
        msg.textContent = err.message;
        saveBtn.disabled = false;
      }
    });
    panel.replaceChildren(
      el("div", { class: "card" }, [
        el("div", { class: "row" }, [storeInput, priceInput, dateInput]),
        el("div", { class: "row", style: "margin-top:.4rem" }, [saveBtn, msg]),
      ]),
    );
  });

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

function shoppingItemRow(listId, item, { store } = {}) {
  const box = el("input", { type: "checkbox", ...(item.done ? { checked: true } : {}), "aria-label": item.text });
  const label = el("span", { class: item.done ? "done" : "", text: item.text });
  box.addEventListener("change", async () => {
    box.disabled = true;
    try {
      const updated = await api(`/api/lists/${listId}/items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ checked: box.checked }),
      });
      label.className = updated.done ? "done" : "";
    } finally {
      box.disabled = false;
    }
  });
  const remove = el("button", {
    class: "ghost small danger",
    text: "Remove",
    onClick: async (event) => {
      event.currentTarget.disabled = true;
      await api(`/api/lists/${listId}/items/${item.id}`, { method: "DELETE" });
      render();
    },
  });
  // "$1.89 - scanned" (design 04, 2a) vs a plain note -- price_source distinguishes a real scan
  // from a manual price someone might type in later (#3109).
  const priceLine =
    item.price_cents != null
      ? el("span", { class: item.price_source === "scan" ? "who ok" : "who", text: `${money(item.price_cents)}${item.price_source === "scan" ? " · scanned" : ""}` })
      : null;
  // "last time $X at Store" -- real per-store history (Git #3112), attached server-side by
  // GET /api/shopping (prices.attachLatestPrices), not invented here.
  const priceHint = item.lastPrice
    ? el("span", { class: "who", text: `last time ${money(item.lastPrice.priceCents)} at ${item.lastPrice.storeName} (${whenDate(item.lastPrice.observedOn)})` })
    : null;

  // Real aisle memory (Git #3108): "say where you found it once; next trip the list walks the
  // store in order." Only offered once a store is set -- store_aisles is keyed on (store, item).
  let aisleControl = null;
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
    aisleControl = el("div", { class: "row", style: "margin-top:.35rem" }, [aisleNum, aisleNote, saveBtn]);
  }

  return el("li", { class: "shopping-row" }, [
    el("div", { class: "row" }, [
      box,
      el("div", { style: "flex:1" }, [
        label,
        item.note ? el("span", { class: "who", text: item.note }) : null,
        priceLine,
        priceHint,
        verdictBadge(item.weeklyAdVerdict),
      ]),
      remove,
    ]),
    priceTools(item),
    aisleControl,
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

/**
 * The real scan sheet (design "Shanes Life 04 - Shopping.dc.html", option 2a). Decodes with the
 * browser's native BarcodeDetector where it exists (Chrome/Edge/Android); everywhere else --
 * and if the camera itself is denied -- falls back to typing the barcode by hand. Never a
 * silent failure either way: a barcode that doesn't decode or doesn't match anything still
 * lands on a real state (unknown), never a dead end.
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
  const video = el("video", { autoplay: "", playsinline: "", muted: "", class: "scan-video" });
  const status = el("p", { class: "small muted", text: "Point the camera at a barcode." });
  const manualInput = el("input", { placeholder: "Or type the barcode", inputmode: "numeric", "aria-label": "Barcode" });
  const manualForm = el("form", { class: "row" }, [manualInput, el("button", { class: "small", type: "submit", text: "Look up" })]);
  const resultBox = el("div");

  const stopCamera = () => {
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

  if ("BarcodeDetector" in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const detector = new window.BarcodeDetector({
        formats: supported.filter((f) => ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"].includes(f)),
      });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      video.srcObject = stream;
      let stopped = false;
      const tick = async () => {
        if (stopped || !dialog.open) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length > 0) {
            stopped = true;
            stopCamera();
            video.remove();
            await runLookup(codes[0].rawValue);
            return;
          }
        } catch {
          // A single failed detect frame is not a real error -- keep scanning.
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch (err) {
      // Camera denied/unavailable -- real, honest fallback to manual entry, never a dead end.
      video.remove();
      status.textContent = "Camera unavailable — type the barcode instead.";
    }
  } else {
    // No BarcodeDetector on this browser (e.g. Safari/iOS as of this writing) -- same honest
    // fallback, not a feature that silently does nothing.
    video.remove();
    status.textContent = "This browser can't scan a live camera feed — type the barcode instead.";
  }

  dialog.showModal();
}

/** Renders one of the three real match states (exact / near / unknown) plus the price form. */
function renderScanResult(list, dialog, result) {
  const wrap = el("div", { class: "section" });
  const priceInput = el("input", { type: "number", step: "0.01", min: "0", placeholder: "0.00", inputmode: "decimal", "aria-label": "Price" });
  let chosenItemId = null;
  let chosenText = null;

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

// #3111: a real per-run budget + real running total + an informational "put it back" card.
// The total is real, not estimated -- it sums list_items.price_cents, which only a real scan
// (#3109) ever sets, so it honestly reads $0 until something on the run has actually been
// scanned. Deliberately whole-list, not cart-vs-still-to-get: the issue's own real scope says
// the total "updates live as items are added/removed," not as items are checked off -- that
// richer split belongs to the store-path Feature (#3108), not this one.
function budgetCard(list) {
  const overCents = list.overBudgetCents || 0;
  const over = overCents > 0;

  const totalLine = el("div", { class: "spread budget-total-row" }, [
    el("span", { class: "budget-total", style: over ? "color:hsl(var(--destructive))" : "", text: money(list.totalCents) }),
    el("span", {
      class: "small muted",
      text: list.budget == null ? "set a budget" : over ? `${money(overCents)} over $${list.budget}` : `of $${list.budget}`,
    }),
  ]);
  totalLine.addEventListener("click", async () => {
    const draft = prompt("Budget for this run ($, blank to clear)", list.budget == null ? "" : String(list.budget));
    if (draft === null) return;
    const value = draft.trim() === "" ? null : Number(draft);
    if (value !== null && (!Number.isFinite(value) || value < 0)) return;
    await api(`/api/lists/${list.id}/budget`, { method: "PATCH", body: JSON.stringify({ budget: value }) });
    render();
  });

  const children = [totalLine];

  if (list.budget != null) {
    const pct = Math.min(100, (list.totalCents / (list.budget * 100 || 1)) * 100);
    children.push(
      el("div", { class: "budget-bar" }, [
        el("div", { class: "budget-bar-fill", style: `width:${pct}%;background:hsl(var(--${over ? "destructive" : "warning"}))` }),
      ]),
    );
  }

  if (over) {
    // Put-it-back: informational only, never blocks the add. Offers the most-recently-priced
    // items first (design handoff's own "I put it back" / "Keep" pair) until enough of them
    // would bring the run back under budget.
    const priced = list.items.filter((i) => i.price_cents != null).slice().reverse();
    let stillOver = overCents;
    const suggestions = [];
    for (const item of priced) {
      if (stillOver <= 0) break;
      suggestions.push(item);
      stillOver -= item.price_cents;
    }
    if (suggestions.length > 0) {
      const rows = suggestions.map((item) =>
        el("div", { class: "put-back-row" }, [
          el("div", { style: "flex:1" }, [
            el("span", { text: item.text }),
            el("span", { class: "who", text: money(item.price_cents) }),
          ]),
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
      children.push(el("div", { class: "put-back" }, rows));
    }
  }

  return el("div", { class: "card budget-card" }, children);
}

async function viewShopping(view) {
  const order = state.shoppingOrder || "flat";
  const [list, storesResult] = await Promise.all([api(`/api/shopping?order=${order}`), api("/api/stores")]);
  const remaining = list.items.filter((i) => !i.done).length;

  // Real stores already logged (Git #3112) -- offered as a datalist so "Log price" autocompletes
  // onto the same store rather than a typo creating a near-duplicate.
  view.append(
    el(
      "datalist",
      { id: "known-stores" },
      storesResult.stores.map((s) => el("option", { value: s.name })),
    ),
  );

  view.append(
    el("section", { class: "section" }, [
      el("div", { class: "spread" }, [
        el("h2", { text: "The run" }),
        el("span", { class: "chip", text: list.items.length === 0 ? "empty" : remaining === 0 ? "all done" : `${remaining} left` }),
      ]),
    ]),
  );

  view.append(budgetCard(list));

  // Which real store this run is at -- what Best-path ordering and aisle memory both key off.
  const storeInput = el("input", { value: list.store || "", placeholder: "Which store? e.g. Aldi", "aria-label": "Store" });
  const storeForm = el("form", { class: "row" }, [
    storeInput,
    el("button", { class: "ghost small", type: "submit", text: list.store ? "Update store" : "Set store" }),
  ]);
  storeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    storeInput.disabled = true;
    try {
      await api(`/api/lists/${list.id}/store`, { method: "PATCH", body: JSON.stringify({ store: storeInput.value.trim() || null }) });
      render();
    } finally {
      storeInput.disabled = false;
    }
  });
  view.append(el("div", { class: "card" }, [storeForm]));

  // Flat / Category / Best path (Git #3108) -- the design's own real segmented control.
  const segment = (mode, label) =>
    el("button", {
      class: order === mode ? "primary small" : "ghost small",
      text: label,
      onClick: () => {
        state.shoppingOrder = mode;
        render();
      },
    });
  view.append(
    el("div", { class: "row", style: "margin:.5rem 0" }, [
      segment("flat", "Flat"),
      segment("category", "Category"),
      segment("best", "Best path"),
    ]),
  );

  if (list.items.length === 0) {
    view.append(
      empty("Nothing on your list yet.", "Type into the box below, or ask Claude to push a list in over MCP.", "shop"),
    );
  } else if (order === "category") {
    for (const group of list.groups) {
      view.append(
        el("section", { class: "section" }, [
          el("h3", { class: "small muted", text: group.category }),
          el(
            "ul",
            { class: "checklist" },
            group.items.map((item) => shoppingItemRow(list.id, item, { store: list.store })),
          ),
        ]),
      );
    }
  } else if (order === "best") {
    for (const group of list.groups) {
      view.append(
        el("section", { class: "section" }, [
          el("h3", { class: "small muted", text: `Aisle ${group.aisle}` }),
          el(
            "ul",
            { class: "checklist" },
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
            { class: "checklist" },
            list.unknown.map((item) => shoppingItemRow(list.id, item, { store: list.store })),
          ),
        ]),
      );
    }
  } else {
    const ul = el("ul", { class: "checklist" });
    for (const item of list.items) ul.append(shoppingItemRow(list.id, item, { store: list.store }));
    view.append(el("section", { class: "section" }, [ul]));
  }

  const addInput = el("input", { placeholder: "Add to Shopping", "aria-label": "Add an item" });
  const addForm = el("form", { class: "row" }, [
    addInput,
    el("button", { class: "primary small", type: "submit", text: "Add" }),
  ]);
  addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = addInput.value.trim();
    if (!text) return;
    addInput.disabled = true;
    try {
      await api(`/api/lists/${list.id}/items`, { method: "POST", body: JSON.stringify({ items: [{ text }] }) });
      render();
    } finally {
      addInput.disabled = false;
    }
  });
  view.append(el("div", { class: "card" }, [addForm]));

  view.append(
    el("div", { class: "row" }, [
      el("button", {
        class: "small",
        text: "Scan",
        onClick: () => openScanSheet(list),
      }),
    ]),
  );

  if (remaining < list.items.length) {
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
      onCreate: (label) => api("/api/shares", { method: "POST", body: JSON.stringify({ listId: list.id, label, canCheck: true }) }),
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

async function viewSettings(view) {
  const { tokens, endpoint } = await api("/api/mcp-tokens");

  view.append(
    el("section", { class: "section" }, [
      el("h2", { text: "Account" }),
      el("div", { class: "card" }, [
        el("div", { class: "title", text: state.user.name }),
        el("div", { class: "meta", text: state.user.email }),
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

  const { activity } = await api("/api/activity?limit=25");
  const log = el("section", { class: "section" }, [el("h2", { text: "Recent activity" })]);
  if (activity.length === 0) {
    log.append(el("p", { class: "muted small", text: "Nothing written yet." }));
  } else {
    for (const row of activity) {
      log.append(
        el("div", { class: "tile" }, [
          el("div", { class: "title small", text: row.action }),
          el("div", { class: "meta", text: `${row.actor}${row.actor_label ? ` (${row.actor_label})` : ""} · ${new Date(row.at).toLocaleString()}` }),
        ]),
      );
    }
  }
  view.append(log);
}

// ---------------------------------------------------------------------------
// Dates (Git #3136) -- design handoff screens 8/9.
// ---------------------------------------------------------------------------

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
      isOnTheFly ? el("span", { class: "chip", text: "New category" }) : null,
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

  const groups = [
    { label: "This week", items: items.filter((i) => i.due_in_days <= 6) },
    { label: "This month", items: items.filter((i) => i.due_in_days > 6 && i.due_in_days <= 31) },
    { label: "Later", items: items.filter((i) => i.due_in_days > 31) },
  ];

  if (items.length === 0) {
    view.append(
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
      view.append(section);
    }
  }

  view.append(
    el("section", { class: "section" }, [
      el("p", { class: "muted small", text: "Federal holidays come from a real, live OPM source, refreshed monthly." }),
    ]),
  );

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

  view.append(
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
    const input = el("input", { placeholder: "Something to ask next time", "aria-label": "New question" });
    card.append(
      el("div", { class: "row", style: "margin-top:.6rem" }, [
        input,
        el("button", {
          class: "small",
          text: "Add",
          onClick: async (event) => {
            const text = input.value.trim();
            if (!text) return;
            event.currentTarget.disabled = true;
            await api(`/api/dates/${dateId}/asks`, { method: "POST", body: JSON.stringify({ text }) });
            await render();
          },
        }),
      ]),
    );
    asks.append(card);
    view.append(asks);

    // "Notes and photos, by visit."
    const visits = el("section", { class: "section" }, [el("h2", { text: "Notes and photos, by visit" })]);
    const visitCard = el("div", { class: "card" });
    if (item.visits.length === 0) visitCard.append(el("p", { class: "muted small", text: "No visits logged yet." }));
    for (const visit of item.visits) visitCard.append(visitRow(dateId, visit));
    const notesInput = el("textarea", { placeholder: "How did it go?", "aria-label": "Visit notes", rows: 2 });
    visitCard.append(
      el("div", { style: "margin-top:.6rem" }, [
        notesInput,
        el("div", { class: "row", style: "margin-top:.4rem" }, [
          el("button", {
            class: "small",
            text: "Log this visit",
            onClick: async (event) => {
              event.currentTarget.disabled = true;
              await api(`/api/dates/${dateId}/visits`, {
                method: "POST",
                body: JSON.stringify({ notes: notesInput.value.trim() || null }),
              });
              await render();
            },
          }),
        ]),
      ]),
    );
    visits.append(visitCard);
    view.append(visits);
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
    view.append(
      el("section", { class: "section" }, [
        el("p", { class: "muted small", text: explain[item.kind] || "A real, on-the-fly kind Claude created for this capture." }),
      ]),
    );
  }

  attachRoomWatermark(view, "comingup");
}

// ---------------------------------------------------------------------------
// pets (Git #3141 -- design contract pack Section 6)
// ---------------------------------------------------------------------------

function petCardEl(pet) {
  const meta = [pet.species, pet.breed].filter(Boolean).join(" · ") || null;
  const right = pet.nextVaccine
    ? el("div", { class: "when", text: `${pet.nextVaccine.name}: ${dueLabel(pet.nextVaccine.dueInDays, pet.nextVaccine.dueOn)}` })
    : null;
  return el("a", { class: "tile", href: `#/pet/${pet.id}` }, [
    el("div", { class: "date-row" }, [
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

  view.append(
    el("section", { class: "section" }, [
      el("h2", { text: "Pets" }),
      el("p", { class: "muted small", text: "Vet visits show up on Dates; vaccines, feeding and meds live here." }),
    ]),
  );

  if (items.pets.length === 0) {
    view.append(empty("No pets on file yet.", "Add one below, or ask Claude to add one for you.", "pets"));
  } else {
    const list = el("section", { class: "section" }, items.pets.map(petCardEl));
    view.append(list);
  }

  const nameInput = el("input", { placeholder: "Pet's name", "aria-label": "Pet name" });
  const speciesInput = el("input", { placeholder: "Species, e.g. dog", "aria-label": "Species" });
  const breedInput = el("input", { placeholder: "Breed", "aria-label": "Breed" });
  const addForm = el("form", { class: "section" }, [
    nameInput,
    el("div", { class: "row" }, [speciesInput, breedInput, el("button", { class: "primary small", type: "submit", text: "Add pet" })]),
  ]);
  addForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    addForm.querySelectorAll("input,button").forEach((n) => (n.disabled = true));
    try {
      await api("/api/pets", {
        method: "POST",
        body: JSON.stringify({ name, species: speciesInput.value.trim() || null, breed: breedInput.value.trim() || null }),
      });
      render();
    } finally {
      addForm.querySelectorAll("input,button").forEach((n) => (n.disabled = false));
    }
  });
  view.append(el("div", { class: "card" }, [addForm]));

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
        el("div", { class: "meta", text: [pet.species, pet.breed, pet.born ? `born ${whenDate(pet.born)}` : null].filter(Boolean).join(" · ") || "No details on file." }),
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
  const vName = el("input", { placeholder: "Vaccine name, e.g. Rabies", "aria-label": "Vaccine name" });
  const vDue = el("input", { type: "date", "aria-label": "Due date" });
  vCard.append(
    el("div", { class: "row", style: "margin-top:.6rem" }, [
      vName,
      vDue,
      el("button", {
        class: "small",
        text: "Add",
        onClick: async (event) => {
          const name = vName.value.trim();
          if (!name) return;
          event.currentTarget.disabled = true;
          await api(`/api/pets/${petId}/vaccines`, { method: "POST", body: JSON.stringify({ name, dueOn: vDue.value || null }) });
          await render();
        },
      }),
    ]),
  );
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
  const cName = el("input", { placeholder: "e.g. Joint chew", "aria-label": "Care item name" });
  const cBatch = el("input", { placeholder: "Batch, e.g. morning", "aria-label": "Batch" });
  cCard.append(
    el("div", { class: "row", style: "margin-top:.6rem" }, [
      cName,
      cBatch,
      el("button", {
        class: "small",
        text: "Add",
        onClick: async (event) => {
          const name = cName.value.trim();
          const batch = cBatch.value.trim();
          if (!name || !batch) return;
          event.currentTarget.disabled = true;
          await api(`/api/pets/${petId}/care`, { method: "POST", body: JSON.stringify({ name, batch }) });
          await render();
        },
      }),
    ]),
  );
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

const TITLES = { today: "Today", shopping: "Shopping", recipes: "Recipes", meds: "Meds", inbox: "Inbox", dates: "Dates", pets: "Pets", things: "Things", settings: "Settings", entity: "", cook: "Cook", date: "", pet: "", tonight: "Tonight" };

function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [head, ...rest] = hash.split("/");
  state.route = head || "today";
  state.categoryFilter = state.route === "things" ? rest[0] || null : null;
  state.entity = state.route === "entity" ? rest[0] : null;
  state.cookRecipeId = state.route === "cook" ? rest[0] : null;
  state.dateId = state.route === "date" ? rest[0] : null;
  state.petId = state.route === "pet" ? rest[0] : null;
}

async function render() {
  parseRoute();
  const view = $("#view");
  view.replaceChildren();
  resetCritterRender(); // Git #3119: a slot's pair-alt only advances within a single screen.
  $("#view-title").textContent = TITLES[state.route] ?? "";

  // A wake lock (Git #3125) is only ever held for cook mode itself -- release it the moment
  // navigation moves anywhere else, rather than waiting on the tab losing visibility.
  if (state.route !== "cook") releaseCookWakeLock();

  for (const tab of document.querySelectorAll(".tabs a")) {
    if (tab.dataset.tab === state.route) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }

  try {
    if (state.route === "shopping") await viewShopping(view);
    else if (state.route === "recipes") await viewRecipes(view);
    else if (state.route === "tonight") await viewTonight(view);
    else if (state.route === "cook") await viewCook(view, state.cookRecipeId);
    else if (state.route === "meds") await viewMeds(view);
    else if (state.route === "inbox") await viewInbox(view);
    else if (state.route === "dates") await viewDates(view);
    else if (state.route === "date") await viewDateDetail(view, state.dateId);
    else if (state.route === "pets") await viewPets(view);
    else if (state.route === "pet") await viewPetDetail(view, state.petId);
    else if (state.route === "things") await viewThings(view);
    else if (state.route === "settings") await viewSettings(view);
    else if (state.route === "entity") await viewEntity(view, state.entity);
    else await viewToday(view);
  } catch (err) {
    if (err.status === 401) return showLogin();
    view.replaceChildren(el("div", { class: "card" }, [el("p", { class: "error", text: err.message })]));
  }
}

window.addEventListener("hashchange", render);

async function start() {
  // The critter sprite (Git #3119) loads in parallel with everything else -- it's decorative,
  // so nothing in the real startup path waits on it.
  loadCritterSprite();
  // An enrolment link wins over everything: it is how the very first passkey gets created, and
  // at that moment there is by definition no session to load.
  if (enrollmentTokenFromUrl()) return showEnroll();
  const user = await loadMe();
  if (!user) return showLogin();
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
