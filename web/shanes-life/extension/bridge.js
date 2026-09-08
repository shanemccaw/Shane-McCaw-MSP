// The ONLY content script that runs on the real app's own origin -- registered dynamically
// by background.js (see registerBridgeForConfiguredOrigin) for whatever App URL is configured
// in options.html, because the app has no fixed public host yet to hardcode into manifest.json.
//
// public/app.js does the real work: when the popup background.js opened carries
// ?extReveal=<id>&extNonce=<n>, it drives the app's EXISTING per-entry WebAuthn reveal
// ceremony (the same one the Vault room's own "Reveal" button uses) and, on success or
// failure, dispatches a plain DOM CustomEvent on `window` -- `sl:extension-reveal` /
// `sl:extension-reveal-error`. This script's only job is relaying that event across the
// isolated-world boundary into the extension's own message bus, since a content script and
// the page it runs on cannot call each other's functions directly.
window.addEventListener("sl:extension-reveal", (event) => {
  chrome.runtime.sendMessage({
    type: "SL_REVEAL_RESULT",
    nonce: event.detail.nonce,
    ok: true,
    value: event.detail.value,
    username: event.detail.username,
  });
});

window.addEventListener("sl:extension-reveal-error", (event) => {
  chrome.runtime.sendMessage({
    type: "SL_REVEAL_RESULT",
    nonce: event.detail.nonce,
    ok: false,
    reason: event.detail.reason,
    message: event.detail.message,
  });
});
