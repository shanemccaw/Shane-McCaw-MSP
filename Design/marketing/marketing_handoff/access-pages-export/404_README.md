# 404 Page — Handoff to Claude Code

Everything needed to rebuild the Shane McCaw Consulting 404 page in the real
React + Vite + Tailwind marketing app. The design source is the DC file in this
folder; open `Marketing 404.dc.html` in a browser to see the reference render.

## What's in this folder

| File | Purpose |
|------|---------|
| `Marketing 404.dc.html` | The design. Template markup + a logic class holding all page data (destinations, search index, readout rows). |
| `Marketing Nav.dc.html` | Site header the page composes. Already exists in the app as `components/Header.tsx` — do not port this file, use the app's own header. |
| `Marketing Footer.dc.html` | Same: use the app's existing `components/Footer.tsx`. |
| `support.js` | Runtime that renders the DC files locally. Not part of the production app. |
| `_ds/…` | Design-system tokens and bundle (colors, type, spacing, elevation). Reference for exact values; the app already has these in `src/index.css`. |

## The page

Route: `/*` catch-all → `NotFound` page. Dark marketing canvas (`slate-950`).

Sections, top to bottom:

1. **Hero** — violet-tinted radial glow, large low-opacity "search with an X in
   it" watermark on the right. Copy is fixed and should not be reworded:
   - Eyebrow: `ERROR 404 · PAGE NOT FOUND` with a blinking violet dot
   - H1: "This page ran off to go check a compliance score."
   - "Good news: your tenant's fine." / "Bad news: this page isn't."
   - CTAs: `Scan My Tenant · Free` (gradient primary) + `Back to the homepage`
2. **Diagnostic readout card** — semi-transparent violet card, seven rows: the
   six pillars all `Pass` (green pill), then `This page` → `404` (red pill).
   The joke lands in the card, so keep the pillar icons and pill styling exact.
3. **Search bar** — filters the destination grid live over `label + blurb +
   keys`. Match count on the right ("18 pages" / "3 matches").
4. **Destination grid** — 18 cards, auto-fill `minmax(258px, 1fr)`: free scan,
   six pillars, monitoring, packs, retainers, pricing, six deep-dives, full
   catalogue. Empty state has its own copy ("Two 404s in one visit is
   impressive.").
5. **"Most people who land here wanted one of these"** — four ranked rows with
   tag / label / meta / arrow, then seven quick-topic pills.
6. **Report block** — broken-link report CTA + all-pricing link, and a mono
   `Requested URL` card.

## Data to wire up

- **Search index** — `D` in the logic class: `{ label, blurb, href, icon,
  color, keys }`. `keys` is a space-separated synonym list carrying the search
  terms users actually type (`mfa`, `licence waste`, `merger`, `cheap`). Move it
  to a typed const in the app, e.g. `src/data/siteIndex.ts`; it is the same
  index the site's real search should use.
- **`requestedUrl`** — currently a prop with a placeholder value. In the app,
  read `useLocation().pathname` and render that.
- **"Report this broken link"** — currently links to Home. Should POST the
  requested URL + `document.referrer` to the support endpoint, then show an
  inline confirmation (no new page).
- **Icons** — inline SVG paths in `ICONS` map 1:1 to Lucide glyphs
  (`ShieldCheck`, `Lock`, `Scale`, `CircleDollarSign`, `Users`, `Activity`,
  `Search`, `Monitor`, `Package`, `Clock`, `DollarSign`, `Sparkles`,
  `LayoutGrid`). Use `lucide-react` rather than porting the paths.

## Style values used

Canvas `#020617`. Cards `#0b1524`, border `rgba(30,41,59,.9)`, radius 14px,
hover → border `rgba(59,130,246,.45)` + background `#0e1a2c`. Hero card radius
18px on a `rgba(139,92,246,.10)` → `rgba(11,21,36,.34)` gradient with
`0 0 60px rgba(139,92,246,.13)` glow. Icon tiles: `{color}1A` fill,
`{color}33` border, 9px radius. Primary CTA
`linear-gradient(90deg,#3b82f6,#8b5cf6)`. Inter throughout; H1 800 / -.03em,
card titles 700 at 13.5px, body 11.5–14px in `#94a3b8`.

## Notes

- Nothing on this page requires auth or an API call to be useful — search and
  navigation are client-side. Keep it that way; a 404 must render even when the
  backend is down.
- Set the HTTP status to 404 on the server route so the page isn't indexed.
- The page has no analytics wired. If you add it, log the requested path and
  referrer only.
