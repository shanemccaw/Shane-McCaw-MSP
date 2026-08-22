# Handoff: Marketing Site + Checkout

## Overview

The public marketing site for Shane McCaw Consulting, an M365 governance platform, plus the
unified checkout that every offering funnels into. This is a separate deliverable from the
customer portal (`design_handoff_customer_portal`) — the two share a brand and a design
system, but nothing else. Where a marketing page links into the portal, treat it as an
external link.

**The site is diagnostic-first.** The product is not sold as software; it is sold as a free
read-only scan that produces a score, and everything after that is priced work against the
findings. Every page is written to move the visitor toward one of two actions: run the free
scan, or buy a specific priced thing.

**Visual mode: dark.** Slate-950 canvas, Electric Blue and Bright Teal accents, Inter
throughout. The portal is the light surface; the marketing site never is.

## Fidelity

**High-fidelity.** Final colours, typography, spacing, motion and copy. All copy is final
and written in Shane's voice: direct, outcome-first, mildly confrontational, specific
technical nouns, numbers that carry weight. **Do not rewrite the copy.** Recreate the
layouts accurately using the target codebase's existing component library.

## About the design files

These are **design references created in HTML** — prototypes showing intended look and
behaviour, not production code to copy. Each `.dc.html` file opens directly in a browser
(keep `support.js`, `doc-page.js` and `_ds/` alongside, as bundled). The task is to
**recreate these designs in the target stack**, not to lift the markup.

The prototype has no router: pages link to each other with plain relative `<a href>` to
`.dc.html` filenames. Production needs real routes.

---

## Page inventory

### Entry and core

| File | Route | Purpose |
|---|---|---|
| `Marketing Home.dc.html` | `/` | Free-scan hero with a live readout mock, credibility strip, the six pillars, the Copilot add-on band, portal mock, four entry doors |
| `Marketing Free Scan.dc.html` | `/scan` | The free scan itself: consent, a live six-sector scanner, then results with findings by severity |
| `Marketing Solutions.dc.html` | `/solutions` | Index of the seven workload deep-dives |

### The six pillars

One page each, same skeleton, own colour and watermark icon:

| File | Route | Colour |
|---|---|---|
| `Marketing Pillar - Governance.dc.html` | `/pillars/governance` | `#3b82f6` |
| `Marketing Pillar - Security.dc.html` | `/pillars/security` | `#8b5cf6` |
| `Marketing Pillar - Compliance.dc.html` | `/pillars/compliance` | `#e2e8f0` |
| `Marketing Pillar - Licensing.dc.html` | `/pillars/licensing` | `#14b8a6` |
| `Marketing Pillar - Adoption.dc.html` | `/pillars/adoption` | `#f97316` |
| `Marketing Pillar - Health.dc.html` | `/pillars/health` | `#22c55e` |

### Workload deep-dives

`Marketing Solutions - Copilot | Governance | SharePoint | Power Platform | Teams |
Migration | M365 Health` → `/solutions/<slug>`.

### Offerings

| File | Route | Purpose |
|---|---|---|
| `Marketing Monitoring.dc.html` | `/monitoring` | Tenant monitoring: the six engines, tier comparison, per-seat pricing, the five-step finding workflow |
| `Marketing Quick-Start Packs.dc.html` | `/quick-start` | 15 fixed-price packs, multi-select with a running total |
| `Marketing Retainers.dc.html` | `/retainers` | Architect retainer tiers |
| `Marketing Pricing.dc.html` | `/pricing` | Everything priced, on one page |

### Checkout and post-purchase

| File | Route | Purpose |
|---|---|---|
| `Marketing Buy.dc.html` | `/buy` | **The one checkout for all three products.** Reads `?product=` |
| `Quick-Start Change Record.dc.html` | `/records/:id` | Printable before → after change record (paged document, PDF + CSV) |
| `Marketing Checkout.dc.html` | — | Earlier checkout exploration, superseded by `Marketing Buy`. Included for reference only; do not build |

### Shared

| File | Purpose |
|---|---|
| `Marketing Nav.dc.html` | Fixed header. Takes `current` (`home`/`watch`/`monitoring`/`quickstart`/`retainers`/`pricing`) to mark the active item |
| `Marketing Footer.dc.html` | Site footer |
| `doc-page.js` | Paged-document shell used only by the change record — owns print geometry |
| `_ds/` | The bound Shane McCaw MSP design system (tokens + components) |

---

## Navigation

The header is one row: logo lockup, six links, one CTA (`Scan My Tenant · Free`). Links are
Home, **What We Watch** (a hover dropdown: the six pillars in one column with their icon
tiles, the seven deep-dives in another), Monitoring, Quick-Start, Retainers, Pricing.

**Active state**: white label at weight 700 plus a 2px `#60a5fa` underline
(`box-shadow: inset 0 -2px 0 0`). Inactive links are `#94a3b8` at 600. "What We Watch"
lights up on any pillar or deep-dive page. The row never wraps — `flex-wrap: nowrap` on
the header row, `wrap` on the inner link list, so at narrow widths the links wrap among
themselves instead of orphaning the CTA.

---

## The checkout — one flow, three products

`Marketing Buy.dc.html` is a single component that serves monitoring, retainers and packs.
Product comes from `?product=monitoring|retainer|pack`; `?tier=<key>` preselects, `?seats=`
carries a seat estimate, `?packs=k1,k2` carries a multi-pack basket, `?scanned=1` means the
visitor already granted read-only access during a free scan.

Layout is two columns: choices on the left, a sticky summary on the right. The summary card
holds the total, the line items, **the payment fields, the terms checkbox, then the pay
button** — in that order. The right column sticks and scrolls independently of the product
list (`max-height: calc(100vh - 40px)`).

### Rules that differ by product

- **Monitoring** cannot be priced before the tenant reports its seat count, so the tenant
  connection comes **before** the card. Until it is connected the CTA reads "Connect your
  tenant to continue" and payment is not offered.
- **Retainers** need no tenant access. The scan connection is offered and skippable.
- **Packs** are multi-select with square checkboxes and a summed one-time total.
- **Terms**: an "I agree" checkbox gates the pay button (it reads "Accept the terms to
  continue" until ticked). It must **not** hide the payment fields.

### Step rails

- Monitoring: Connect → Tier → Pay → Create account → Portal
- Retainer: Tier → Pay → Create account → Portal
- Pack: Pack → Pay → Create account → Write access → **Scan → Approve → Record**

### The pack path after payment (the part that matters)

This is the flow the Quick-Start page promises, built truthfully:

1. **Write consent.** Everything up to here ran on a read-only app registration. This screen
   asks for write scopes, named, scoped to the purchased packs.
2. **Targeted scan.** A read of just the settings these packs touch, with the new scopes —
   not the read taken at checkout. Five steps, progress bar.
3. **Dry run.** Every write the packs perform, grouped by pack: what it touches, the value
   **now**, the value **after**, an impact chip (*no user impact* / *users will notice* /
   *blocks something today*), and whether it is reversible. Rows the scan found already true
   are dropped. Disruptive rows name what they break and any report-only period. The user
   can deselect any row — deselected writes are never sent. A run-window picker (now /
   tonight / next change window) and a sticky bar with "N of M changes approved".
4. **Execution.** Writes applied in dependency order, one progress screen. If one fails the
   run stops and everything before it stays with a rollback point.
5. **Record.** The final step in the rail. Summary tiles (applied / declined / already
   correct / rollback-until), then a setting → before → after → result table per pack, the
   verification-scan note, and a link to the printable record.

**A pure Quick-Start customer never enters the portal.** That is why the record lives in the
flow and as its own page rather than as a portal deep-link. Copy on these screens must not
send them to the portal.

### The change record

`Quick-Start Change Record.dc.html` is a real document, not a dashboard screen: site nav and
a dark header band with the record ID and Download PDF / Download CSV / Back to packs, then a
paged document below (running header and footer per printed page). It carries authorisation
and the scopes used, timestamps for consent / approval / execution / revocation, a
before → after table per pack, the verification scan, the rollback window, what was declined
and the fact it can still be applied, and an appendix of the accounts affected.

Download PDF prints the document with the site chrome hidden (`@media print`). Download CSV
serialises every pack/setting/before/after/result row client-side.

---

## Page structure and visual system

Every page follows the same skeleton: nav → hero (copy left, a live-looking artefact right)
→ a mid-page band → content sections → a CTA row → footer.

**Page gradient per page.** Two large low-opacity radial glows in the page's own colour —
roughly `circle 1100px at 76% -20%` at 11–13%, plus a smaller one lower-left at 5–7% —
fading to transparent over the slate canvas. Never a hard-edged colour block.

**Watermark icon.** One large stroke glyph behind the hero at 3.5–13% opacity, sometimes with
a coloured drop-shadow: the pillar's own icon on pillar pages, an ECG heartbeat on Monitoring,
a gear-with-a-bolt on Quick-Start, a users glyph on Retainers, a receipt on Pricing.

**Hero artefact card.** Semi-transparent and blended, not a flat panel:
`linear-gradient(160deg, <colour>/.10, rgba(11,21,36,.52) 55%, rgba(11,21,36,.34))`, a
hairline border in the page colour at ~22%, `backdrop-filter: blur(3px)`, a soft outer glow
and a 1px inner top highlight — so the gradient and watermark read through it.

**Section seams.** The mid-page band is `linear-gradient(180deg, transparent, #050d1e 16%,
#050d1e 84%, transparent)` with a faint page-colour tint on top — no hairline borders
between sections.

**Pillar identity is an icon, never a dot.** Wherever a pillar is named, it carries its own
Lucide-style glyph in a tinted rounded tile (`<colour>1A` fill, `<colour>33` border):
Governance a shield-check, Security a padlock, Compliance scales, Licensing a circled
dollar, Adoption users, Health a pulse line. This holds in the nav dropdown, the scan
readout, the pillar cards, the "six pillars" strips, the monitored-tenant feed and the
engine cards. Plain coloured dots are still correct for non-pillar meanings — severity,
feature bullets, used-vs-idle legends.

**Copilot is an add-on, not a seventh pillar.** On Home it sits below the six in its own
full-width band: a "COPILOT · ADD-ON" divider, then a box in teal/violet with the AI spark
icon and the 41 readiness score.

---

## Design tokens

**Brand**: Deep Navy `#0A2540` · Electric Blue `#0078D4` (hover `#005A9E`) · Bright Teal
`#00B4D8` · Off-White `#F7F9FC`.

**Dark canvas**: page `#020617`, raised sections `#050d1e`, cards `#0b1524`, hairline borders
`rgba(30,41,59,.9–.95)`.

**Text**: `#f8fafc` primary, `#cbd5e1` secondary, `#94a3b8` body, `#64748b` meta, `#475569`
faint.

**Semantic**: `#34d399` good/applied · `#fbbf24` attention/declined · `#f87171` urgent ·
`#60a5fa` link/accent · `#22d3ee` Copilot · `#a78bfa` portal/violet.

**Pillars**: Governance `#3b82f6` · Security `#8b5cf6` · Compliance `#e2e8f0` · Licensing
`#14b8a6` · Adoption `#f97316` · Health `#22c55e`.

**Type**: Inter 400–800. Hero h1 `clamp(30px,3.4vw,40px)` weight 800 at `-.03em`; section h2
24px/800 at `-.025em`; body 13.5–15px at 1.7; eyebrows 10px/700 uppercase at `.2em`. Prices
and counters use `font-variant-numeric: tabular-nums`.

**Radii**: cards 14–18px, buttons and inputs 8–10px, pills 999px, icon tiles 5–10px.

**Gradient CTA**: `linear-gradient(90deg,#3b82f6,#8b5cf6)`, white text, weight 700.

**Motion**: restrained. 150–300ms colour and border transitions, hover border-intensifies to
the accent, gentle card lift. No parallax or bounce.

---

## Out of scope / needs building for real

- **Routing.** The prototype has none. Production needs real routes and deep links (a record,
  a pack basket, a checkout state must all be linkable).
- **Payments.** Stripe. The prototype fakes the card fields and the delay.
- **The scan.** The free scan and the targeted pack scan are both simulated on timers. The
  real thing is a read-only Graph app registration and its results.
- **Graph write-back.** The dry run's before/after values and the execution engine are
  authored data in the prototype. Production reads live values, writes in dependency order,
  and stores a prior value per action for rollback.
- **Auth.** Account creation, email code, password and MFA screens are modelled but not real.
- **Seat-count pricing.** Priced client-side from a per-seat table; production reads the
  tenant's licensed seat count.
- **CSV/PDF.** The record's CSV is built from the DOM in the prototype; production should
  generate both server-side from the execution log.
