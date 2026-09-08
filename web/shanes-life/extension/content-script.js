// Runs on every page (manifest's <all_urls>) looking for a real login form. Two jobs:
// notice the form and ask the background worker which vault entries might belong to it, and
// -- only after Shane clicks a real suggestion and a real fresh WebAuthn assertion completes
// in the popup the background worker opens -- fill the real value in and get out of the way.
// Never asks for or holds a plaintext value itself; SL_FIND_MATCHES only ever returns the
// same masked shape the Vault room's own list does (id/label/site/username, no secret).

const CHIP_ID = "sl-vault-autofill-chip";

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

function showChip(passwordField, text, { spinner = false, onClick = null } = {}) {
  removeChip();
  const chip = document.createElement("div");
  chip.id = CHIP_ID;
  chip.setAttribute(
    "style",
    "position:fixed;z-index:2147483647;bottom:16px;right:16px;max-width:280px;" +
      "background:#1a1a1a;color:#f2f2f2;font:13px system-ui,sans-serif;padding:10px 14px;" +
      "border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.3);cursor:" +
      (onClick ? "pointer" : "default") + ";line-height:1.4;",
  );
  chip.textContent = (spinner ? "⏳ " : "🔐 ") + text;
  if (onClick) chip.addEventListener("click", onClick);
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
  const { passwordField, usernameField } = fields;
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: "SL_FIND_MATCHES", hostname: location.hostname });
  } catch {
    return; // extension context gone (reload/update) -- nothing to show
  }
  if (!response?.ok) {
    if (response?.reason === "signed-out") {
      showChip(passwordField, "Sign in to Shane's Life to autofill this login.");
    }
    // "not-configured" (no App URL set in the extension's options yet) says nothing on a
    // random page -- that would be noise on every site until Shane sets it up once.
    return;
  }
  if (response.matches.length === 0) return;

  const label = (m) => (m.username ? `${m.label} (${m.username})` : m.label);
  const chip = showChip(
    passwordField,
    response.matches.length === 1
      ? `Fill from vault: ${label(response.matches[0])}`
      : `${response.matches.length} vault logins for this site — click to choose`,
    { onClick: () => requestReveal(response.matches, { passwordField, usernameField }) },
  );
  chip._matches = response.matches;
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

async function requestReveal(matches, fields) {
  const entry = pickEntry(matches);
  if (!entry) {
    removeChip();
    return;
  }
  showChip(fields.passwordField, `Waiting for Face ID for "${entry.label}"…`, { spinner: true });

  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: "SL_REQUEST_REVEAL", entryId: entry.id });
  } catch {
    showChip(fields.passwordField, "Could not reach the extension. Try again.");
    return;
  }
  if (!response?.ok) {
    showChip(fields.passwordField, "Autofill isn't set up yet — set the App URL in the extension's options.");
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
    showChip(fields.passwordField, reason);
    setTimeout(removeChip, 4000);
    return;
  }

  setNativeValue(fields.passwordField, message.value);
  if (fields.usernameField && message.username) setNativeValue(fields.usernameField, message.username);
  removeChip();
});

const form = findLoginForm();
if (form) offerMatches(form);
