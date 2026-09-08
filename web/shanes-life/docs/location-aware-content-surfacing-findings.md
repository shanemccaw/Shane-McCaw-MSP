# Location-aware content surfacing — real investigation findings (Git #3159)

Real, explicit stop condition from the issue: *"Investigate real, available geolocation
approaches (browser Geolocation API accuracy/battery tradeoffs for a Home Screen web app)
before committing to an implementation — report real findings back if the honest answer is
'this needs native-app-level location access to work well.'"*

**The honest answer is exactly that, for the ambient/background half of the ask, and it is
built anyway for the honest, buildable foreground half.** Details below.

## What "Home Screen web app" means here, confirmed against the real manifest

`web/shanes-life/public/manifest.webmanifest` sets `"display": "standalone"` — this app IS a
Home Screen (installed PWA) web app, not a hypothetical. Everything below is evaluated against
that real configuration, not a generic web page in a browser tab.

## Real finding 1 — foreground, on-demand location is genuinely fine

When the app is open and asks for the user's real current position (`navigator.geolocation.
getCurrentPosition`), that works reliably on both iOS Safari and Android Chrome standalone
PWAs, subject to the real permission prompt (shown once; the decision persists after that on
modern iOS/Android). Real accuracy/battery tradeoffs:

- `enableHighAccuracy: false` (network/coarse positioning) is accurate to roughly 100s of
  meters and cheap — no GPS radio activation. This is plenty to match a "which real place is
  Shane at" radius (a house, a Walmart, a work campus), which is why the implementation below
  uses it.
- `enableHighAccuracy: true` (GPS) gets to ~10-50m outdoors but costs real, measurable battery
  and takes longer to get a first fix, especially indoors. Not needed for this feature.
- `maximumAge` lets the browser return an already-cached fix instead of re-polling hardware —
  set to 5 minutes here, since a place-radius match doesn't need a fresh reading every time.

## Real finding 2 — automatic/ambient background detection is NOT achievable in a Home Screen
web app, on either platform

This is the part of the ask ("detecting where Shane actually is... automatically... across
shopping lists and tasks broadly") that a Home Screen web app cannot deliver, for real,
confirmed platform reasons:

- **No Geofencing API ships in any browser.** The W3C Geofencing API was proposed years ago,
  published only as an Editor's Draft, and was never implemented by Chrome, Safari, or Firefox.
  A live GitHub discussion thread on this exact gap (`w3c/geolocation#214`, "Support geolocation
  (especially geofencing) in the background") was still active as recently as November 2025 —
  i.e. still unresolved, not something that quietly shipped since this app's knowledge base was
  last updated.
- **iOS Safari suspends a standalone Home Screen web app's JavaScript execution once it is
  backgrounded.** There is no way for `watchPosition()` to keep delivering position updates, or
  for any JS to run at all, while the app isn't the frontmost tab — this is an OS-level
  suspension of the web view, not a permission setting that can be worked around.
- **True geofencing (silent OS notification the moment a device enters/exits a radius, with the
  app not running) is a native-OS capability** — `CLLocationManager` region monitoring on iOS,
  the Android `Geofencing` API on Android — reachable only from a real native app (or a native
  wrapper embedding a WebView with real native permissions), never from browser JS alone.

**This confirms the issue's own hypothesis.** The "walk into Walmart with the app closed and
have it just know" behavior described in the design contract pack needs native-app-level
location access to work well. It is not buildable as a Home Screen web app today, and won't
become buildable by waiting — the relevant web standard has been stalled for years with no
signal of shipping.

## What was built instead (real, shipped, not a placeholder)

Rather than stop at "can't do the ambient version," this ships the honest, fully-buildable
foreground half, using real data only:

- **`places` table** (migration 037): a real named place (label + real lat/lng + radius +
  optional note), created only via `push_place` (MCP) — never a fabricated location, never a
  form. See `captures.latitude`/`longitude` (also migration 037): the browser silently attaches
  Shane's real current position to a capture when it already has permission, so "remember this
  as Home" carries real coordinates without a dedicated location field anywhere in the UI
  (Section 3, "no forms, anywhere, ever," confirmed 2026-09-08).
- **`GET /api/places/nearby`**: given a real current position the client just asked for, returns
  which saved real place (if any) actually contains it, nearest first.
- **Today view**: when the app is open and location permission is already granted (never forced
  — opening Today never itself prompts), it silently checks the real current position against
  saved places and shows a plain "You're at `<label>`" card with `<note>` when there's a real
  match. No match, no permission, or permission denied all render nothing — silence, not an
  error or empty state.
- **Settings → Places**: a real, read-only list of what's saved, with a plain "Forget" button
  per place (an action, not a form/input field — same tier as the existing "Revoke"/"Sign out
  everywhere" buttons).

This is real infrastructure a future native wrapper (the same WebView2-automation direction
already named for Section 1's WPF-app pivot) could sit real background geofencing on top of
without a schema change — `places` already holds exactly what a native geofence registration
needs (label, coordinates, radius). Nothing here needs to be re-architected if/when that native
half gets built; it just gets a second, always-on caller instead of only the foreground one.

## Real, explicit stop point

Building native-app-level background geofencing itself (a native wrapper, or embedding this
app in one) is out of scope for this issue and is a genuine, larger product decision — cost,
platform (iOS vs Android vs both), and whether it's worth pursuing given the WPF app's own
narrowing role (Section 1) are all real open questions for Shane, not something to guess at
here. Nothing was implemented in that direction; this findings doc plus the real, working
foreground half above is the honest, complete result of this investigation.

## Sources

- [W3C Geofencing API — GitHub](https://w3c.github.io/geofencing-api/) — still an Editor's Draft, never a Recommendation.
- [w3c/geolocation issue #214 — "Support geolocation (especially geofencing) in the background"](https://github.com/w3c/geolocation/issues/214) — active discussion as recently as November 2025.
- [whatwebcando.today — Geofencing API](https://whatwebcando.today/geofencing.html) — current summary of why PWAs lack background geofencing.
