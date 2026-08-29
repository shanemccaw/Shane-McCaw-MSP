# Shane McCaw MSP — Design System

Everything below is extracted from the live codebase (`lib/copilot-scan-scene/src/journeyTokens.ts`,
604 lines) and the design system tokens. Nothing here is invented. These are the exact values the
Copilot Readiness product renders with today.

Hand this to Claude Design as the foundation before designing any screen.

---

## 1. Canvas and brand

```
--canvas        #020617   slate-950. The dark canvas. Every portal screen sits on this.
--brand-navy    #0A2540   chrome, sidebar, headings
--brand-navy-900 #061a2e  deeper navy for recessed backgrounds
--brand-blue    #0078D4   primary (Microsoft blue)
--brand-blue-strong #005A9E  hover / pressed
--brand-teal    #00B4D8   accent, highlights, and every delta figure
--brand-offwhite #F7F9FC
```

**Typeface: Inter, weights 400–800.** Sole typeface on every surface. No exceptions.

### Ink on dark

```
heading         #f8fafc
body            #94a3b8
body-strong     #cbd5e1   verdict lines, scan status
micro/eyebrow   #64748b
de-emphasised   #475569   the "before" half of a before → after pair
```

### Slate scale

```
950 #020617 · 900 #0f172a · 850 #172033 · 800 #1e293b
700 #334155 · 500 #64748b · 400 #94a3b8 · 300 #cbd5e1 · 100 #f1f5f9
```

---

## 2. The six pillars — identity colours

**Identity is constant. It never changes with score.** This is the system's own stated rule:
*"identity is constant and severity is what tells the truth."*

| Pillar | Primary | Accent | Icon path (24×24, round caps/joins) |
|---|---|---|---|
| Governance | `#3B82F6` | `#60A5FA` | `M16 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1zM2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1zM12 3v18M7 21h5M9 6h6M3 10h4M17 10h4` |
| Security | `#8B5CF6` | `#A78BFA` | `M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1 1 0 0 1 1.3 0C14.3 3.8 16.8 5 18.8 5a1 1 0 0 1 1 1z` |
| Compliance | `#F3F4F6` | `#D1D5DB` | `M16 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1zM2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1zM7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2` |
| Licensing | `#14B8A6` | `#2DD4BF` | `M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76zM16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 18V6` |
| Adoption | `#F97316` | `#FB923C` | `M18 21a8 8 0 0 0-16 0M10 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3` |
| Health | `#22C55E` | `#4ADE80` | `M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2` |

**Copilot** is not a pillar — it is the roll-up. Its mark:

```
M12 3l1.7 4.4L18 9l-4.3 1.6L12 15l-1.7-4.4L6 9l4.3-1.6zM18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z
```

### Per-pillar ambient glow — use verbatim, do not derive

These are **hand-tuned and not interchangeable.** Compliance's near-white gets a cooler,
lower-opacity two-stop mix so it reads as light rather than washed-out grey. Adoption's orange sits
at `.26` where the others are `.28`–`.30`. A derived `colour @ 16%` looked plausible and was wrong
on every one of them.

```css
governance: radial-gradient(closest-side, rgba(59,130,246,.30), rgba(2,6,23,0) 100%)
security:   radial-gradient(closest-side, rgba(139,92,246,.30), rgba(2,6,23,0) 100%)
compliance: radial-gradient(closest-side, rgba(226,232,240,.22), rgba(148,163,184,.12) 58%, rgba(2,6,23,0) 100%)
licensing:  radial-gradient(closest-side, rgba(20,184,166,.30), rgba(2,6,23,0) 100%)
adoption:   radial-gradient(closest-side, rgba(249,115,22,.26), rgba(2,6,23,0) 100%)
health:     radial-gradient(closest-side, rgba(34,197,94,.28), rgba(2,6,23,0) 100%)
```

### Per-pillar accent band — 3px, across the top of a card

```css
linear-gradient(90deg, {primary}, {accent})
```

### The full-spectrum treatment

For anything spanning all six pillars — the roll-up report, the remediation guide, the SOW. They
take the Copilot identity **rather than a seventh invented colour.**

```css
band: linear-gradient(90deg,#3B82F6,#8B5CF6,#22D3EE,#F3F4F6)
glow: radial-gradient(closest-side, rgba(59,130,246,.30), rgba(139,92,246,.20) 46%,
                      rgba(34,211,238,.14) 70%, rgba(2,6,23,0) 100%)
orb:  conic-gradient(from 0deg,#3B82F6,#8B5CF6,#22D3EE,#F3F4F6,#8B5CF6,#3B82F6)
```

The orb **never changes with score** — identity is constant.

---

## 3. Severity — universal, never pillar-driven

**This is what drives the score-dynamic shell.**

```
score >= 60          healthy      #34d399   (on dark)   #15803d (on light)
score >= 50          attention    #fbbf24               #d97706
score  < 50          critical     #f87171               #dc2626
```

Labels: `Healthy` · `Attention required` · `Critical`

**A null score is NOT a severity.** A pillar with no evaluable rule renders an *unavailable* state.
Never a red zero.

One score, one colour, everywhere. A pillar scoring 57 is amber on every screen it appears on.

### The Copilot Gate — the only gate number

```
COPILOT_GATE_TARGET = 82
>= 82  "Safe to deploy"
<  82  "Not safe yet"
```

Distinct from severity and not in conflict with it. A tenant at 70 is a legitimately green number
that has not cleared the Gate, and the copy says exactly that.

---

## 4. Glass, glow and gradient vocabulary

Extracted verbatim from the Copilot Readiness Reveal.

**Ambient page wash** — large, soft, behind content:
```css
radial-gradient(circle, rgba(0,120,212,.13), transparent)
radial-gradient(circle, rgba(0,180,216,.10), transparent)
radial-gradient(circle, rgba(59,130,246,.15), transparent)
```

**Glass panel fill** — over the `#020617` canvas:
```css
linear-gradient(135deg, rgba(0,120,212,.12), rgba(139,92,246,.10))
linear-gradient(120deg, rgba(0,120,212,.14), rgba(139,92,246,.12))
```

**Hairline borders on dark:** `rgba(255,255,255,.10)`
**Elevate on hover:** `rgba(255,255,255,.04)` → `.09` on active

**Column / bar fills** — transparent at top, `55%` alpha at the base:
```css
linear-gradient(to bottom, {pillar}00, {pillar}8c)
```

**Pill / chip:** `border: 1px solid {pillar}59` · `border-radius: 999px` · `padding: 4px 10px`

**Ring / halo mask:**
```css
radial-gradient(circle, transparent 63%, #000 68%, #000 73%, transparent 78%)
```

**Deltas and improvements use teal (`#00B4D8`), never a severity colour** — an improvement is not
a severity.

---

## 5. The score-dynamic shell

The shell takes the tenant's overall severity band and washes it corner to corner, **bottom-left
to top-right**, bleeding up into the top chrome.

Use the severity colours above, at ambient-wash opacity — this is atmosphere, not a status bar. It
must never fight the pillar identity colours sitting on top of it.

```css
/* critical */
background:
  radial-gradient(120% 90% at 0% 100%, rgba(248,113,113,.18), rgba(2,6,23,0) 62%),
  #020617;

/* attention */
background:
  radial-gradient(120% 90% at 0% 100%, rgba(251,191,36,.15), rgba(2,6,23,0) 62%),
  #020617;

/* healthy */
background:
  radial-gradient(120% 90% at 0% 100%, rgba(52,211,153,.14), rgba(2,6,23,0) 62%),
  #020617;
```

Opacity descends with severity on purpose — a bad tenant should feel it, a good tenant should feel
calm rather than congratulated. Alpha is a starting point, not a mandate; tune it so text contrast
holds at every band.

**Transition between bands should be slow and unremarkable.** The wash changes when a scan lands.
A snap from green to red is alarming in a way the data usually is not.

---

## 6. Hard rules

- **No emoji, ever.** Icons are lucide-react, or the pillar paths above.
- **No fabricated tenant names, company names, or people.** No "Halden Materials", no
  "jordan.diaz@tenant.com". Real shapes with empty values, or an honest empty state.
- **Dark canvas is the default and only theme for the portal.**
- Identity colour never encodes severity. Severity never encodes identity.
- A missing value renders as unavailable, never as zero and never as red.
