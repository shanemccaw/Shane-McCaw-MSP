# Marketing Site — Parallel Build Plan

Full replacement of the live marketing site (`artifacts/shane-mccaw-consulting`,
36 existing pages) with the new design
(`Design/design_handoff_marketing/`, 23 real pages + shared Nav/Footer,
committed by Shane). Tracked under Epic #1093.

## Standing rules for every part

- **Design tokens are gospel — nothing overrides them.** Confirmed by Shane
  directly: deep navy `#0A2540`, electric blue `#0078D4`, bright teal
  `#00B4D8`, dark canvas `#020617`, exactly as specified in the README's
  Design Tokens section. Ignore any instinct to "match the existing site" —
  this fully replaces it, not blends with it.
- **Copy is final.** The README states this explicitly: "Do not rewrite the
  copy." Written in Shane's voice — reproduce verbatim.
- **This phase is UI/content only for anything genuinely unbuilt** —
  payments (Stripe), the real free scan, Graph write-back, auth, and
  server-side CSV/PDF generation are all explicitly out of scope per the
  README's own list. Build the real-looking prototype flow; real backend
  wiring is a later, separate pass.
- **Exception: pricing is NOT fixture.** Monitoring, Quick-Start Packs, and
  Retainers pages must use the REAL data already committed to the database
  tonight (real per-seat monitoring pricing, the real 15 priced packs, the
  real 3-tier — soon 4-tier — retainer set) — not the prototype's own
  placeholder numbers. This is static, known-correct content, not a backend
  dependency.
- **Read the real `.dc.html` file directly for fidelity** — pull exact
  spacing/color/copy, don't approximate from the README's prose alone. Same
  discipline that mattered repeatedly on the portal build.
- **`Marketing Checkout.dc.html` is explicitly reference-only — do not build
  it.** Superseded by `Marketing Buy.dc.html`.

---

# Part 0 — Nav, Footer, routing scaffold · RUN ALONE, FIRST

**Owns:** the marketing site's shared header/footer components, `App.tsx`
route registration for all 23 real pages (stubs only in this part).

```
Read Design/design_handoff_marketing/README.md in full, then Marketing
Nav.dc.html and Marketing Footer.dc.html directly.

Rebuild the site's shared Nav and Footer components in
artifacts/shane-mccaw-consulting to match these exactly — the header takes a
`current` prop (home/watch/monitoring/quickstart/retainers/pricing) to mark
the active nav item, the "What We Watch" dropdown holds the six pillars in
one column and seven deep-dives in another, the row never wraps
(flex-wrap: nowrap on the header row, wrap on the inner link list).

Design tokens are gospel, confirmed by Shane directly — deep navy #0A2540,
electric blue #0078D4, bright teal #00B4D8, dark canvas #020617, exactly as
the README's Design Tokens section specifies. Do not blend with or default
toward the existing site's current look — this fully replaces it.

Register real routes in App.tsx for all 23 real pages listed in the README's
page inventory (do NOT route Marketing Checkout.dc.html — reference only,
superseded). Stub content only in this part — just render each page's title,
wrapped in the new Nav/Footer. Add a literal insertion-marker comment so
later parts know where to add real content without guessing a line.

Copy is final — reproduce verbatim wherever any real text appears even at
this stage. No emoji.

Gate: tsc clean, npm test, npm run build. Report what you built and confirm
every one of the 23 routes resolves to a real (even if stub) page.
```

---

# Wave 1 — Home, Free Scan, Solutions index

**Part 1 — Home**
```
Build Marketing Home.dc.html into a real page (route /). Read the file
directly for exact fidelity — free-scan hero with a live readout mock,
credibility strip, the six pillars (each with its own icon tile per the
README's "pillar identity is an icon, never a dot" rule), the Copilot
add-on band (its own full-width section below the six, NOT a seventh
pillar — teal/violet box, AI spark icon, real 41/82 readiness score,
matching the real portal Copilot gate constant), portal mock, four entry
doors. Reuse the real Nav/Footer from Part 0.

Gate: tsc clean, tests, build. Report what matches vs any real gaps found.
```

**Part 2 — Free Scan**
```
Build Marketing Free Scan.dc.html into a real page (route /scan). This is
the most novel page — consent screen, a live-looking six-sector scanner
animation (simulated on a timer per the README's own "out of scope" list —
do not attempt a real scan here), then results with findings by severity.
Read the file directly, 769 lines, the largest single page — take real care
with fidelity here since it's the site's primary conversion path.

Gate: tsc clean, tests, build. Report what matches vs any real gaps found.
```

**Part 3 — Solutions index**
```
Build Marketing Solutions.dc.html into a real page (route /solutions) — the
index of the seven workload deep-dives. Read the file directly for fidelity.

Gate: tsc clean, tests, build.
```

---

# Wave 2 — The six pillar pages

**Part 4**
```
Build all six pillar pages: Marketing Pillar - Governance/Security/
Compliance/Licensing/Adoption/Health.dc.html → routes /pillars/<slug>. Same
skeleton across all six per the README, own color and watermark icon per
page (Governance #3b82f6 shield-check, Security #8b5cf6 padlock, Compliance
#e2e8f0 scales, Licensing #14b8a6 circled dollar, Adoption #f97316 users,
Health #22c55e pulse line). Read each file directly — do not assume identical
content just because the skeleton matches; check each for real differences.

Gate: tsc clean, tests, build. Report per-page confirmation, not just "all six
done."
```

---

# Wave 3 — The seven workload deep-dives

**Part 5**
```
Build all seven deep-dive pages: Marketing Solutions -
Copilot/Governance/SharePoint/Power Platform/Teams/Migration/M365 Health.dc.html
→ routes /solutions/<slug>. Read each file directly for real content — sizes
vary significantly (Governance is 385 lines / 62KB, most others are ~210-230
lines), so do not assume uniform depth.

Gate: tsc clean, tests, build. Report per-page confirmation.
```

---

# Wave 4 — Offerings (real pricing data, not fixture)

**Part 6 — Monitoring**
```
Build Marketing Monitoring.dc.html → route /monitoring. Six engines, tier
comparison, per-seat pricing, the five-step finding workflow. USE REAL
PRICING — the actual Foundation/Growth/Premier per-seat rates and brackets
already committed to the database tonight, not the prototype's own numbers
if they differ. Confirm the real numbers before writing them in (Foundation
$12/$9/$7/$5 per seat by bracket, Growth $18/$14/$11/$8, Premier
$22.50/$17.50/$13.75/$10 + $160 flat, all with the 15-seat floor) — verify
against the live services table rather than trusting this prompt's numbers
blindly, in case anything's changed since.

Gate: tsc clean, tests, build. Report whether real vs. prototype pricing
matched or needed correcting.
```

**Part 7 — Quick-Start Packs**
```
Build Marketing Quick-Start Packs.dc.html → route /quick-start. 15 fixed-
price packs (not the prototype's count if it differs — there are genuinely
15 real packs now), multi-select with a running total. USE REAL PRICING —
Entra ID Quick-Start $799, Onboarding $149, Offboarding $199, Security
Incident Response $299, Compromised Account Recovery $149, Break-Glass
Access $249, Conditional Access Baseline $199, Privileged Access $299,
Device Compliance $249, Email Security $249, Identity Hygiene $249, Baseline
Licensing $199, SharePoint & OneDrive Oversharing $349, MFA Enforcement
$299, Copilot Readiness $499 — verify against the live services table
before writing these in, in case anything's changed.

Gate: tsc clean, tests, build. Report whether real vs. prototype pricing
matched or needed correcting.
```

**Part 8 — Retainers**
```
Build Marketing Retainers.dc.html → route /retainers. USE REAL PRICING —
Advisory $900/5hrs, Essentials $1,500/8hrs (highlighted as most-popular),
Growth $3,000/16hrs, Enterprise $5,500/30hrs, all hours-based with NO seat
gating on any tier — verify against the live services table before writing
these in.

Gate: tsc clean, tests, build. Report whether real vs. prototype pricing
matched or needed correcting.
```

**Part 9 — Pricing** *(blocked by 6, 7, 8 — needs their real numbers to stay consistent)*
```
Build Marketing Pricing.dc.html → route /pricing — everything priced, on one
page. Pull the same real numbers used in Parts 6-8 (Monitoring, Quick-Start,
Retainers) — this page must stay consistent with those three, not introduce
a fourth independent source of the same numbers. Read those three pages'
final committed code if built already, not just the prototype file, to
guarantee consistency.

Gate: tsc clean, tests, build. Report any inconsistency found and how it was
resolved.
```

---

# Wave 5 — Checkout and post-purchase (most complex, do last)

**Part 10 — Buy (unified checkout)**
```
Build Marketing Buy.dc.html → route /buy. The single checkout for all three
products (monitoring/retainer/pack), reading real query params
(?product=, ?tier=, ?seats=, ?packs=, ?scanned=). Read the README's "The
checkout — one flow, three products" section in full before starting — the
product-specific rules matter (monitoring requires tenant connection before
pricing/payment is even offered; retainers skip tenant connection; packs are
multi-select with a summed total; the terms checkbox gates payment but must
never hide the payment fields). The step rails differ by product — build all
three (Connect→Tier→Pay→Account→Portal for monitoring; Tier→Pay→Account→
Portal for retainer; Pack→Pay→Account→Write access→Scan→Approve→Record for
packs).

The pack post-payment flow (write consent → targeted scan → dry run →
execution → record) is simulated per the README's "out of scope" list — real
Graph write-back is separate, later work. Build the realistic-looking flow
with authored before/after data, not a real write path.

This is the largest, most novel page (1,142 lines) — take real care, this is
the site's actual conversion mechanism.

Gate: tsc clean, tests, build. Report explicitly on all three product paths
tested, not just one.
```

**Part 11 — Change Record**
```
Build Quick-Start Change Record.dc.html → route /records/:id. A real
document, not a dashboard screen — site nav + dark header band (record ID,
Download PDF/CSV, Back to packs) + a paged document below with running
header/footer per printed page. Reuse doc-page.js's print-geometry pattern
if reusable, or rebuild its intent in the target stack. Download PDF should
hide site chrome via @media print; Download CSV serializes the
setting/before/after/result rows — client-side is fine for now per the
README (server-side generation is separate, later work).

Gate: tsc clean, tests, build. Report the print/CSV behavior confirmed
working.
```

---

## Wave order

```
Wave 1   Part 0                          (alone — creates the seams)
Wave 2   Part 1 · 2 · 3                  (Home, Free Scan, Solutions index)
Wave 3   Part 4 · 5                      (6 pillars, 7 deep-dives)
Wave 4   Part 6 · 7 · 8                  (Monitoring, Quick-Start, Retainers — parallel)
Wave 5   Part 9                          (Pricing — blocked by Wave 4)
Wave 6   Part 10 · 11                    (Buy, Change Record — most complex, do last)
```
