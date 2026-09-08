// Runs on every page (manifest's <all_urls>) looking for a real login form. Two real jobs:
// notice the form and ask the background worker which vault entries might belong to it, and
// fill the real value in once a real value actually exists to fill -- either the one-click
// trusted path (Git #3276) or, after a real fresh WebAuthn assertion completes in the popup
// the background worker opens, the original per-reveal path. Never asks for or holds a
// plaintext value itself; SL_FIND_MATCHES only ever returns the same masked shape the Vault
// room's own list does (id/label/site/username/alwaysAsk, no secret).

const CHIP_ID = "sl-vault-autofill-chip";

// The design's own real palette (Shanes Life 19, 1a/1c): a 300px-max dark pill, blue when a
// one-click Fill is available, amber when it isn't yet. `_ds` is Tailwind-token-driven CSS the
// app's own pages get from the design system's stylesheet import; a content script injected
// into an arbitrary third-party page has none of that, so these are the same colors as plain
// literals -- the one place in this repo a hardcoded hex is the honest choice, not a shortcut.
const CHIP_BG = "rgba(9,22,40,.96)";
const CHIP_BORDER_TRUSTED = "1px solid rgba(255,255,255,.12)";
const CHIP_BORDER_UNTRUSTED = "1px solid rgba(251,191,36,.35)";
const CHIP_ICON_BG_TRUSTED = "rgba(148,163,184,.18)";
const CHIP_ICON_BG_UNTRUSTED = "rgba(251,191,36,.14)";

function findLoginForm() {
  const passwordField = Array.from(document.querySelectorAll('input[type="password"]')).find(
    (el) => el.offsetParent !== null, // visible only -- a hidden confirm-password clone isn't the target
  );
  if (!passwordField) return null;

  const form = passwordField.closest("form") || document;
  const candidates = Array.from(
    form.querySelectorAll('input[type="text"], input[type="email"], input:not([type])'),
  );
  const usernameField =
    candidates.find((el) => (el.autocomplete || "").includes("username")) ||
    candidates.find((el) => /user|email|login/i.test(el.name + " " + el.id)) ||
    candidates[0] ||
    null;

  return { passwordField, usernameField };
}

/** Setting `.value` directly does not fire the events a React/Vue-controlled input listens
 *  for, so a framework-backed login form silently keeps showing empty right after a "successful"
 *  fill. The native setter + a real InputEvent is the standard workaround (the same trick every
 *  real autofill extension uses) -- it goes through the framework's own change-detection instead
 *  of around it. */
function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function removeChip() {
  document.getElementById(CHIP_ID)?.remove();
}

/** The design's own 300px pill (1a/1c): a vault-critter-ish icon tile, two text lines, one
 *  action button. `trusted` picks the blue-vs-amber skin; `actionLabel`/`onAction` drive the
 *  one button ("Fill" one-click, or "Unlock" to open the Face ID popup). */
function showChip(entry, { trusted, actionLabel, onAction, subtitle, spinner = false }) {
  removeChip();
  const chip = document.createElement("div");
  chip.id = CHIP_ID;
  chip.setAttribute(
    "style",
    "all:initial;position:fixed;z-index:2147483647;bottom:16px;right:16px;max-width:300px;" +
      `box-sizing:border-box;padding:8px 8px 8px 10px;border-radius:999px;background:${CHIP_BG};` +
      `border:${trusted ? CHIP_BORDER_TRUSTED : CHIP_BORDER_UNTRUSTED};` +
      "box-shadow:0 14px 40px rgba(0,0,0,.35);display:flex;align-items:center;gap:10px;" +
      "color:#EEF2F8;font:13px/1.3 -apple-system,system-ui,sans-serif;",
  );

  const iconTile = document.createElement("div");
  iconTile.setAttribute(
    "style",
    `width:36px;height:36px;border-radius:50%;background:${trusted ? CHIP_ICON_BG_TRUSTED : CHIP_ICON_BG_UNTRUSTED};` +
      "display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;",
  );
  iconTile.textContent = spinner ? "⏳" : "🔐"; // hourglass while waiting, else a lock
  chip.append(iconTile);

  const textBox = document.createElement("div");
  textBox.setAttribute("style", "flex:1;min-width:0;");
  const line1 = document.createElement("div");
  line1.setAttribute(
    "style",
    "font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;",
  );
  line1.textContent = entry.username ? `${entry.label} · ${entry.username}` : entry.label;
  const line2 = document.createElement("div");
  line2.setAttribute(
    "style",
    `font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${trusted ? "#8597AD" : "#fbbf24"};`,
  );
  line2.textContent = subtitle;
  textBox.append(line1, line2);
  chip.append(textBox);

  if (actionLabel) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = actionLabel;
    btn.setAttribute(
      "style",
      "all:initial;height:32px;padding:0 14px;border-radius:999px;font:13px/32px -apple-system,system-ui,sans-serif;" +
        `font-weight:600;flex-shrink:0;cursor:pointer;color:#fff;background:${trusted ? "#1A8CFF" : "transparent"};` +
        (trusted ? "" : "border:1px solid rgba(255,255,255,.25);"),
    );
    if (onAction) btn.addEventListener("click", onAction);
    chip.append(btn);
  }

  document.documentElement.appendChild(chip);
  return chip;
}

// The one login form this page appears to have, and its fields -- kept at module scope so a
// reveal requested from the extension's popup toolbar UI (which has no in-page chip of its
// own to click) still knows where to fill, not only a reveal requested from this page's own
// chip.
let detectedFields = null;

async function offerMatches(fields) {
  detectedFields = fields;
  const { passwordField } = fields;
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: "SL_FIND_MATCHES", hostname: location.hostname });
  } catch {
    return; // extension context gone (reload/update) -- nothing to show
  }
  if (!response?.ok) {
    if (response?.reason === "signed-out") {
      showChip(
        { label: "Shane's Life", username: null },
        { trusted: false, subtitle: "Sign in to autofill this login.", actionLabel: null },
      );
    }
    // "not-configured" (no App URL set in the extension's options yet) says nothing on a
    // random page -- that would be noise on every site until Shane sets it up once.
    return;
  }
  if (response.matches.length === 0) return;

  offerEntry(response.matches, response.trust, fields);
}

function pickEntry(matches) {
  if (matches.length === 1) return matches[0];
  // A plain confirm() per candidate -- no framework, no build step (matches the rest of this
  // app's own stated approach), and there are realistically 2-3 logins per site, never a list
  // long enough for this to be tedious.
  for (const entry of matches) {
    if (window.confirm(`Fill "${entry.label}"${entry.username ? ` (${entry.username})` : ""}? Cancel to see the next option.`)) {
      return entry;
    }
  }
  return null;
}

/** Renders the chip for ONE chosen entry (`matches.length === 1` skips straight here; more
 *  than one asks first via `pickEntry`, same as before Git #3276). Design 1a vs 1c: a trusted,
 *  non-always-ask entry gets the blue "Fill" one-click chip; anything else gets the amber
 *  "Unlock" chip that opens the real Face ID popup. */
function offerEntry(matches, trust, fields) {
  const entry = matches.length === 1 ? matches[0] : pickEntry(matches);
  if (!entry) {
    removeChip();
    return;
  }
  const canOneClick = Boolean(trust) && !entry.alwaysAsk;
  if (canOneClick) {
    const daysLeft = Math.max(0, Math.ceil((new Date(trust.expiresAt).getTime() - Date.now()) / 86_400_000));
    showChip(entry, {
      trusted: true,
      subtitle: `Vault · trusted · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`,
      actionLabel: "Fill",
      onAction: () => tryOneClickFill(entry, fields),
    });
  } else {
    showChip(entry, {
      trusted: false,
      subtitle: "Face ID once · 30 days of one-click fills",
      actionLabel: "Unlock",
      onAction: () => requestReveal(entry, fields),
    });
  }
}

async function tryOneClickFill(entry, fields) {
  showChip(entry, { trusted: true, subtitle: "Filling…", actionLabel: null, spinner: true });
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: "SL_TRY_FILL", entryId: entry.id, hostname: location.hostname });
  } catch {
    showChip(entry, { trusted: false, subtitle: "Could not reach the extension.", actionLabel: null });
    return;
  }
  if (response?.ok) {
    setNativeValue(fields.passwordField, response.value);
    if (fields.usernameField && response.username) setNativeValue(fields.usernameField, response.username);
    showChip(entry, { trusted: true, subtitle: "Filled · logged", actionLabel: null });
    setTimeout(removeChip, 2000);
    return;
  }
  // The one-click path refused (trust expired/revoked, or this entry always asks) -- fall back
  // to the exact same real Face ID path a first-time fill would have taken.
  requestReveal(entry, fields);
}

async function requestReveal(entry, fields) {
  showChip(entry, { trusted: false, subtitle: `Waiting for Face ID for "${entry.label}"…`, actionLabel: null, spinner: true });

  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: "SL_REQUEST_REVEAL", entryId: entry.id });
  } catch {
    showChip(entry, { trusted: false, subtitle: "Could not reach the extension. Try again.", actionLabel: null });
    return;
  }
  if (!response?.ok) {
    showChip(entry, { trusted: false, subtitle: "Not set up yet — set the App URL in Settings.", actionLabel: null });
    return;
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "SL_FILL") return;
  const fields = detectedFields;
  if (!fields) return;

  if (!message.ok) {
    const reason =
      message.reason === "cancelled"
        ? "Cancelled."
        : message.reason === "timeout"
          ? "Timed out waiting for Face ID."
          : message.message || "That didn't reveal.";
    showChip({ label: "Vault Autofill", username: null }, { trusted: false, subtitle: reason, actionLabel: null });
    setTimeout(removeChip, 4000);
    return;
  }

  setNativeValue(fields.passwordField, message.value);
  if (fields.usernameField && message.username) setNativeValue(fields.usernameField, message.username);
  showChip({ label: "Vault Autofill", username: null }, { trusted: true, subtitle: "Filled · logged", actionLabel: null });
  setTimeout(removeChip, 2000);
});

const form = findLoginForm();
if (form) offerMatches(form);
