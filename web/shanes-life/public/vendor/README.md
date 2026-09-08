# Vendored client libraries

This app has no client-side bundler (`public/app.js` is a plain ES module served as-is), so a
third-party client dependency is vendored here as a single static file rather than pulled through
a build step.

## `zxing-browser.min.js`

- **Source:** `@zxing/browser` v0.2.1 (MIT), UMD build —
  https://unpkg.com/@zxing/browser@0.2.1/umd/zxing-browser.min.js
- **Why:** Safari has never implemented the native `BarcodeDetector` API (Git #3263). This is
  the standard cross-browser software fallback — it decodes barcodes from the existing
  `getUserMedia` video stream instead of relying on a native browser API. Self-contained (no
  external `require`s bundled in), attaches `window.ZXingBrowser` when loaded as a classic script.
- **Loaded:** lazily, only when the barcode scan sheet opens (`ensureZxing()` in `app.js`), not
  part of the app-shell precache — most sessions never open the scanner.
- **Upgrading:** re-download from the URL above at the desired version and replace this file;
  nothing else in this repo needs to change unless `@zxing/browser`'s public API changes.
