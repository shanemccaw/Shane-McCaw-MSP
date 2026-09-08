// Shane's Life -- the critter roster (Git #3119).
//
// Ported from the design handoff's "Shanes Life 14 - Critters.dc.html" and the handoff
// README's Critters section: 23 slots in pairs (Idle has three), six wide "Kilroy" peekers, and
// the daily-roll hash that keeps a slot's pick stable everywhere it shows for the whole day.
//
// Fixed, never rolled, per the spec: the sign-in fox (slot 1t, symbol #c-fox) is wired directly
// in index.html per #3117 and is untouched here. The alarm / shared-link-waiting bird (slot 1v,
// symbol #c-bird) ships in the sprite so a future alarm screen can use it, but nothing calls it
// yet -- there is no alarm feature built.
//
// What's wired into the live app today, and what is not: this app (public/index.html,
// public/app.js) is the "Today / Shopping / Inbox / Things / Settings" shell, not the full
// room-based prototype the design spec was drawn against (tray Later rows, Meds, Money, Dates,
// Pets, Lists, People, Heading Out, Wins, Vault, Budget Day -- none of those screens exist yet;
// each is its own Feature issue under #3086). Every slot and both peeker/watermark mechanisms
// below are built to full spec so those Feature issues can wire them in the moment their screens
// land. Today, the slots with a genuine, real host in the app are: the "Next" tray label peeker,
// the "Idle" empty-state icon, the Things room's "Things" watermark + "Nothing found" empty-state
// icon, and (Git #3088) the Shopping room's "shop" watermark + empty-state icon. See app.js for
// exactly where.

const SLOTS = {
  heading: { id: "1a", name: "Heading out", variants: ["c-heading", "c-heading2"] },
  comingup: { id: "1b", name: "Coming up", variants: ["c-comingup", "c-comingup2"] },
  dinner: { id: "1c", name: "Dinner", variants: ["c-dinner", "c-dinner2"] },
  home: { id: "1d", name: "At home", variants: ["c-home", "c-home2"] },
  idle: { id: "1e", name: "Idle", variants: ["c-idle", "c-snail", "c-sloth"] },
  shop: { id: "1f", name: "At the store", variants: ["c-shop", "c-shop2"] },
  nasa: { id: "1g", name: "At NASA", variants: ["c-nasa", "c-nasa2"] },
  pets: { id: "1h", name: "Pets", variants: ["c-pets", "c-pets2"] },
  meds: { id: "1i", name: "Meds", variants: ["c-meds", "c-meds2"] },
  lists: { id: "1j", name: "Lists", variants: ["c-lists", "c-lists2"] },
  things: { id: "1k", name: "Things", variants: ["c-things", "c-things2"] },
  people: { id: "1l", name: "People", variants: ["c-people", "c-people2"] },
  vault: { id: "1m", name: "Vault", variants: ["c-vault", "c-vault2"] },
  wins: { id: "1n", name: "Wins", variants: ["c-wins", "c-wins2"] },
  budget: { id: "1o", name: "Budget Day", variants: ["c-budget", "c-budget2"] },
  morning: { id: "1p", name: "Morning meds", variants: ["c-morning", "c-morning2"] },
  bedtime: { id: "1q", name: "Bedtime meds", variants: ["c-bedtime", "c-bedtime2"] },
  timer: { id: "1r", name: "Timer", variants: ["c-timer", "c-timer2"] },
  builds: { id: "1s", name: "Builds running", variants: ["c-builds", "c-builds2"] },
  signin: { id: "1t", name: "Sign in", variants: ["c-fox"] }, // fixed, never rolled -- see index.html
  moneyhdr: { id: "1u", name: "Money header", variants: ["c-bear", "c-bear2"] },
  alarm: { id: "1v", name: "Alarm, shared-link waiting", variants: ["c-bird"] }, // fixed, never rolled
  notfound: { id: "1w", name: "Nothing found", variants: ["c-cat", "c-cat2"] },
};

// Declared order matters: the peek roll below picks four consecutive entries starting at `b`.
const PEEKERS = ["pkw-cat", "pkw-fox", "pkw-rac", "pkw-frog", "pkw-bear", "pkw-owl"];

/**
 * 32-bit FNV-1a. Exact port of the hash in the .dc.html spec (`const hash = s => { let h =
 * 2166136261; ... }`) -- must match byte-for-byte or the roll picks a different critter than
 * the design previewed.
 */
function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The dateKey format the spec's own hash input uses: unpadded Y-M-D (`2026-9-7`, not
 * `2026-09-07`). Padding would change the hash input and roll a different critter than the
 * design previewed, so this stays exactly what the .dc.html computes
 * (`d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()`).
 */
export function dateKeyFrom(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

let dateKey = null;
let peekOrder = null;
const dailyPick = new Map(); // slotKey -> variant index rolled for today
const usedThisRender = new Map(); // slotKey -> how many times drawn on the current screen

/**
 * Call once per app load with the SERVER's date (never the client clock -- the spec is explicit:
 * "evaluated once at first open from the server date"). Safe to call again on every load; it
 * only actually re-rolls when the date key has changed.
 */
export function initCritters(serverDateKeyOrDate) {
  const key = serverDateKeyOrDate instanceof Date ? dateKeyFrom(serverDateKeyOrDate) : String(serverDateKeyOrDate);
  if (key === dateKey) return;
  dateKey = key;
  dailyPick.clear();
  peekOrder = null;
}

function rollIndex(slotKey, variantCount) {
  if (variantCount <= 1) return 0;
  const slot = SLOTS[slotKey];
  return fnv1a(`${dateKey}|${slot.name}`) % variantCount;
}

/** Reset per-screen alt-pair tracking. Call at the start of every view render. */
export function resetCritterRender() {
  usedThisRender.clear();
}

/**
 * The symbol id to draw for a slot right now. The first draw on a screen shows the day's roll; a
 * second draw of the *same* slot on the *same* screen (the spec's own example: Dinner row +
 * Recipes row both showing the Dinner slot) takes the next variant in the pair instead, so a
 * critter never repeats beside itself.
 */
export function critterFor(slotKey) {
  if (!dateKey) throw new Error("initCritters() must run before critterFor()");
  const slot = SLOTS[slotKey];
  if (!slot) throw new Error(`Unknown critter slot "${slotKey}"`);
  if (!dailyPick.has(slotKey)) dailyPick.set(slotKey, rollIndex(slotKey, slot.variants.length));
  const uses = usedThisRender.get(slotKey) || 0;
  usedThisRender.set(slotKey, uses + 1);
  const base = dailyPick.get(slotKey);
  const idx = uses === 0 ? base : (base + uses) % slot.variants.length;
  return slot.variants[idx];
}

/** Four peekers for the day, in the tray's fixed label order: Next, Later, Meds, Rooms. */
export function rollPeekers() {
  if (!dateKey) throw new Error("initCritters() must run before rollPeekers()");
  if (!peekOrder) {
    const b = fnv1a(`${dateKey}|peek`) % PEEKERS.length;
    peekOrder = [0, 1, 2, 3].map((n) => PEEKERS[(b + n) % PEEKERS.length]);
  }
  return peekOrder;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * `size` is a convenience for a square box (both width and height). For a non-square viewBox,
 * pass `width` and/or `height` instead -- whichever one is omitted is derived from the other
 * using the viewBox's own real aspect ratio, so the <svg>'s width/height attributes (which set
 * its intrinsic aspect ratio, independent of viewBox) never disagree with the viewBox they're
 * framing. Forcing both attributes to the same square `size` regardless of viewBox squeezed the
 * wide peeker viewBox (260x64) into a square intrinsic ratio, distorting it (#3129).
 */
function svgEl(symbolId, { size, width, height, className, viewBox = "0 0 120 120" } = {}) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  const [, , vbWidth, vbHeight] = viewBox.split(/\s+/).map(Number);
  const aspect = vbWidth && vbHeight ? vbWidth / vbHeight : 1;
  let w = width ?? size;
  let h = height ?? size;
  if (w == null && h != null) w = h * aspect;
  if (h == null && w != null) h = w / aspect;
  svg.setAttribute("width", String(Math.round(w * 100) / 100));
  svg.setAttribute("height", String(Math.round(h * 100) / 100));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("role", "img");
  if (className) svg.setAttribute("class", className);
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#${symbolId}`);
  svg.append(use);
  return svg;
}

/** A rolled critter icon for the given slot, sized per the design's placement (36/40/44/104px). */
export function critterIcon(slotKey, { size = 36, className } = {}) {
  return svgEl(critterFor(slotKey), { size, className });
}

let spriteLoaded = null;

/**
 * Fetches and injects the critter sprite (public/critters-sprite.svg) once. Injected into the
 * DOM rather than referenced via <img>/<object>, because iOS Safari -- this app's real target,
 * it's a Home Screen PWA -- does not reliably resolve <use> against gradient fills across an
 * external SVG document.
 */
export function loadCritterSprite() {
  if (spriteLoaded) return spriteLoaded;
  spriteLoaded = fetch("/critters-sprite.svg")
    .then((res) => res.text())
    .then((markup) => {
      const holder = document.createElement("div");
      holder.setAttribute("aria-hidden", "true");
      holder.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
      holder.innerHTML = markup;
      document.body.prepend(holder);
    })
    .catch(() => {
      // Decorative only -- a failed sprite fetch means plain rooms instead of critters, never a
      // broken app.
    });
  return spriteLoaded;
}

/**
 * Positions a peeker over the right edge of a tray section label per the spec's exact geometry.
 * The label's own container gets `position:relative; display:flex; align-items:flex-end;
 * min-height:40px`; the peeker sits `left: <label width + 30>px; right:0; bottom:-18px;
 * height:52px`, which lands its ledge line (y=52 in the symbol's own 260x64 viewBox) on the
 * card's top border, with the head clipped and only paws/toes crossing onto the card face.
 */
export function attachPeeker(labelEl, symbolId) {
  const container = labelEl.parentElement;
  container.style.position = "relative";
  container.style.display = "flex";
  container.style.alignItems = "flex-end";
  container.style.minHeight = "40px";
  const svg = svgEl(symbolId, { height: 52, className: "critter-peeker", viewBox: "0 0 260 64" });
  svg.setAttribute("preserveAspectRatio", "xMidYMax meet");
  svg.style.position = "absolute";
  svg.style.left = `${labelEl.offsetWidth + 30}px`;
  svg.style.right = "0";
  svg.style.bottom = "-18px";
  svg.style.height = "52px";
  svg.style.width = "auto";
  container.append(svg);
  return svg;
}

/**
 * A holiday hat riding on top of a peeker already placed by attachPeeker() (Git #3145, README
 * "Seasons and holidays": "holiday hat overlay in the same box" as the peeker). Same left/width
 * geometry as attachPeeker so the hat tracks whichever peeker is showing; the design's own
 * viewBox ("0 -16 260 80") and no-viewBox-on-the-symbol rule (see the ph-* <symbol>s in
 * critters-sprite.svg) keep the hat's own coordinate space independent of the peeker beneath it.
 */
export function attachPeekerHat(labelEl, symbolId) {
  const container = labelEl.parentElement;
  const svg = svgEl(symbolId, { height: 65, className: "peeker-hat", viewBox: "0 -16 260 80" });
  svg.setAttribute("preserveAspectRatio", "xMidYMax meet");
  svg.style.left = `${labelEl.offsetWidth + 30}px`;
  svg.style.right = "0";
  svg.style.width = "auto";
  container.append(svg);
  return svg;
}

/**
 * The faint 260px room watermark: `opacity:.12`, `position:absolute; right:-44px; bottom:78px`,
 * `pointer-events:none`, painted over the content so it shows through list rows.
 */
export function attachRoomWatermark(container, slotKey) {
  container.style.position = container.style.position || "relative";
  const svg = svgEl(critterFor(slotKey), { size: 260, className: "critter-watermark" });
  svg.style.position = "absolute";
  svg.style.right = "-44px";
  svg.style.bottom = "78px";
  svg.style.opacity = ".12";
  svg.style.pointerEvents = "none";
  container.append(svg);
  return svg;
}
