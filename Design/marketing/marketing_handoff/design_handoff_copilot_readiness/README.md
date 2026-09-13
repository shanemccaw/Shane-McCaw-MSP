# Handoff: Copilot Readiness Reveal → Documents → SOW → Checkout

## Overview

The complete post-scan customer journey for the Copilot Readiness Assessment, in four screens:

1. **Copilot Readiness Reveal** — a linear scroll narrative that opens with a live tenant scan and pays it off with the readiness verdict and six pillar findings.
2. **Document Viewer** — the in-app reader for the nine generated reports.
3. **SOW Proposal** — scope selection (phases + optional services) with live totals and e-signature.
4. **Checkout** — order confirmation, pay-in-full vs phased, Stripe frame, kickoff confirmation.

This replaces every prior results-page iteration (the wizard-style results UI, the War Room concept). It is the sole post-scan destination.

## About the Design Files

The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy. The task is to **recreate these designs in the target codebase's existing environment** (React + Vite + Tailwind v4 + shadcn/ui "new-york" + Lucide, per the Shane McCaw MSP platform) using its established patterns, components and tokens.

Each `.dc.html` file is a self-contained prototype. They use a small in-house streaming-template runtime (`support.js`) — **ignore that runtime entirely**. What matters is the markup structure, the inline style values, and the logic class at the bottom of each file, which contains the real state machine and animation math. Read the logic class; it is the specification.

`standalone/` contains fully offline single-file versions of each screen — open these in a browser to interact with the designs.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, motion timings and copy. Recreate pixel-accurately using the codebase's existing component library. All copy is final and written in Shane's voice — do not rewrite it.

---

## Screen 1 — Copilot Readiness Reveal

**File:** `Copilot Readiness Reveal.dc.html`
**Purpose:** Make an IT decision-maker understand and feel their tenant's Copilot readiness inside 30 seconds. One continuous vertical scroll, ten scenes (0–9), fixed order, no nav, no skip-ahead.

### Structure

| Scene | Section height | Content |
|---|---|---|
| 0 | Fixed overlay, no scroll | Live radar scan |
| 1 | 170vh sticky | The verdict — score + six satellites |
| 2–7 | 280vh sticky each | Governance, Security, Compliance, Licensing, Adoption, Health |
| 8 | 240vh sticky | White-Glove Copilot Adoption |
| 9 | 340vh sticky | Full picture + document generation + CTA |

Scroll is locked (`body { overflow: hidden }`) during Scene 0 and released the moment the scan completes.

### Scene 0 — The Scan

Full-bleed overlay on `#020617`. A six-wedge radar, one wedge per pillar, sitting on a 1000×700 stage that scales down to fit the viewport (`Math.min(1, vw/1080, vh/760)`).

- SVG viewBox `-260 -260 520 520`, inner radius **104**, outer radius **214**.
- Six wedges at 60° increments, each filled with a per-pillar `radialGradient` (`#wg0`–`#wg5`): white at 0.55 alpha at offset 0.47, the pillar color at full at 0.56, fading to 0.06 alpha at the rim. This gradient is what gives the radar depth — a flat fill at varying opacity was explicitly rejected.
- Hub glow: `radialGradient` white → `#22D3EE` → `#3B82F6` → transparent, radius 122, drawn under the wedges.
- A slow sheen wedge (64° arc, white radial gradient at 0.22 alpha) rotates once every **9s**.
- Guide rings at r=104 and r=214 at `rgba(148,163,184,.14–.16)` — near-ambient, deliberately not schematic. Spokes are `rgba(2,6,23,.55)` at 1.5px (they read as gaps between wedges).
- Wedge opacity per pillar: `0.58 + 0.42 * pillarProgress`.
- Curated chips (2–4 per wedge) fade in inside each wedge as material findings land. These are **not** a running log of all checks — every chip shown must reappear in that pillar's reveal scene.
- Counter reads `"112 of 158 signals evaluated"` and the current check name streams beneath.

**Duration:** the real scan takes 1–2 minutes. The prototype fakes it at `checkMs` per check; in production the wedge fills must be driven by real per-pillar completion counts from the scan job, and multiple pillars can be in progress simultaneously. Treat each wedge as a progress bar that fills to 100%.

### Scene 1 — The Verdict

940×790 stage, `transform: scale(min(1, vw/1020, vh/860))`.

- Center: eyebrow `COPILOT READINESS SCORE` (11px/600/.22em uppercase, `#64748b`), the score at **210px/800/-0.05em** in severity red `#f87171`, and `NOT FLIGHT-READY` (12px/700/.14em uppercase, red).
- Score counts 0 → 41 over the first 58% of a 2600ms timeline, eased `1-(1-t)³`.
- Holographic orb behind the number: a constant Copilot identity mark (blue → violet → cyan → white spectrum), 300px. **It never changes with the score** — identity is constant, severity tells the truth.
- Six satellites at **radius 290**, 60° apart, each showing a real, specific finding — never a score. Scene 1 is the hook; scores are Scene 9's job. Collapsing them makes Scene 1 a duplicate of the payoff. Finding text is 19px/700 in `#f8fafc`. Each arm is a **zero-size div with `transform-origin: 0 0`** — this matters: sizing the arm to its label makes `rotate()` pivot on the label's own centre, which pushes every satellite to a different radius. Labels are fixed 264×46, `margin-left:-132px; margin-top:-23px`, `white-space: nowrap`, counter-rotated to stay upright.
- Ring rotates -26° → 0° during the reveal, then settles. Never continuous rotation.
- Below: the verdict line at 23px/500, then a subtle scroll cue (no button).

### Scenes 2–7 — The Six Pillars

**Structurally identical every time — sameness is the feature.** Two-column grid at ≥940px, `minmax(0,1.35fr) / minmax(280px,.65fr)`, gap `min(9vw,120px)`; single stacked column below that (headline and copy first, score panel below, full width).

Each scene reveals five blocks as its section scrolls through its 280vh span, each an eased fade + 24px rise:

| Block | Progress window |
|---|---|
| Pillar badge + name | 0.03 → 0.20 |
| Headline finding | 0.12 → 0.32 |
| Why it matters to Copilot | 0.26 → 0.44 |
| The score | 0.34 → 0.52 (number counts 0.34 → 0.60) |
| What fixing it does | 0.56 → 0.74 |

- Headline: `clamp(30px, min(4.4vw,6.6vh), 60px)` / 800 / -0.03em / 1.06, `#f8fafc`.
- Copilot-risk sentence: `clamp(15px, min(1.5vw,2.5vh), 19px)` / 500 / 1.55, `#94a3b8`, max 640px.
- Score: `clamp(62px, min(9vw,14vh), 124px)` / 800, severity-colored, with `/100` in `#475569`.
- Accent glow: a faint radial glow in the pillar's identity color behind the score number only. Not a full per-pillar background.
- Fix preview: `34 → 61 +27`, with the projected value in the `#0078D4 → #00B4D8` gradient and the delta in `#00B4D8`. Non-interactive in v1.
- **Weighted landing:** critical pillars (scores in the 30s) get a small overshoot/settle wobble; "attention required" pillars glide smoothly. The motion reflects the data rather than repeating identically six times.
- **Pillar sparklines.** A thin single-stroke 92×28 trend line beside the score, in the pillar's identity color (not severity — the line shows shape, not pass/fail), with a soft outer glow (a 4px stroke at 0.2 alpha behind a 1.5px crisp stroke, `feGaussianBlur stdDeviation 2.4`) and a 2.4r end dot. Plus a severity-colored delta ("−8 pts") and the window label. No axis, no gridlines, no fill, no interactivity — that belongs in the document viewer's fuller version.
  **A sparkline only renders where real time-series data exists.** The `TRENDS` array in the logic class holds one entry per pillar; `null` renders nothing. Currently populated: Security (Secure Score history), Adoption (D7–D180 usage), Health (audit log). Governance and Licensing are `null` pending a codebase check; Compliance is point-in-time DLP only. **Never interpolate or synthesise a trend** — a fabricated trend line is a fabricated statistic wearing a chart's credibility. Build the pattern once, prune entries to `null` after the check, not before.
- **One margin note, exactly once in the whole experience** — a handwritten-style annotation beside "Four of them are Global Admins": *"— this is the one I'd fix first."* A second instance anywhere tips it into gimmick. Cap at one, full stop.

### Scene 8 — White-Glove Copilot Adoption

A standalone scene, deliberately. It was first crammed into the Full Picture close, where the fit-to-viewport transform shrank the whole composition to make room — so it now sizes independently, exactly like a pillar scene, and shares none of Scene 9's scaling logic.

- **No ring, no orb, no satellites.** Typographic presence only, consistent with the sparse register everywhere else.
- Left-anchored on the same padding as the pillar scenes (`0 9vw 0 clamp(52px,8vw,120px)`), with a faint teal ambient glow behind the type.
- Eyebrow: a gradient icon tile (blue→violet tint, teal border) + `THE ADD-ON`.
- Headline at the pillar-scene size class — `clamp(30px, min(4.4vw,6.6vh), 60px)` / 800 / -0.03em, capped at 20ch: *"Remediation fixes your tenant. This is how your people actually use it."*
- **The product name reads as a named offering, not bolded body text** — a pill with a 1px `rgba(0,180,216,.34)` border, a `blue → violet` gradient tint fill, and a small `#3B82F6 → #00B4D8` gradient dot.
- Supporting line at the pillar body size class, max 62ch: the comms, pilot cohort, prompt drip and enablement sessions in brief.
- **No pricing or tier detail here** — that lives exclusively in the SOW. This scene exists so a non-technical buyer sees the option before pricing.
- Reveals in three eased blocks (0.04→0.22, 0.12→0.34, 0.28→0.50 of its scroll span), then a scroll cue into Scene 9.

### Scene 9 — The Full Picture

1300×660 stage, `scale(min(1, vw/1420, vh/740))`. Left: the orb, the score 41, and the remediated 68. Right: the closing headline, the document set, the CTAs.

- The six satellites (radius **240**, labels 172×50, nowrap, same zero-size-arm rule) fade in showing each pillar's contributed score — this is where scores belong.
- The row is `flex-wrap: nowrap` at ≥1180px so the orb sits **left** of the text column; below that it stacks. A fit-to-viewport scale keeps it inside 100vh — anything added to the right column shrinks the whole composition, so keep that column short.
- The document list is a **fixed 2-column grid**, not `auto-fit`.
- **Tracer lines:** as each satellite appears, a thin light tracer briefly draws from it inward to the center number. This is the single moment that visually proves the premise — six findings becoming one number.
- **Document generation is shown in progress, not ready.** A live `"3 of 9 ready"` counter with a progress bar, reusing the trust mechanic from the Scene 0 radar. When generation completes the same view transitions to document access.
- Primary CTA into the Executive Summary; secondary text link *"Discuss my results with Shane McCaw →"*. Both persist.
- Shane's credibility line closes it.

### Progress rail

Fixed left edge, vertically centered, 9 ticks of 2px × 24px with 9px gaps. Current scene: `#00B4D8`, `scaleX(2.4)`. Passed: `rgba(0,120,212,.6)`. Upcoming: `rgba(51,65,85,.7)`. Active scene is whichever section has `top ≤ 0.4vh` and `bottom > 0.6vh`.

### Reduced motion

When `prefers-reduced-motion: reduce` is set: drop the ring rotation, all `translateY` parallax entrances, and the sheen. **Keep the count-up numbers** — they are informational, not decorative. Replace everything else with a fast plain crossfade.

---

## Screen 2 — Document Viewer

**File:** `Document Viewer.dc.html`
**Purpose:** Where the engagement fee gets justified with real depth. Calm, legible, premium. **Deliberately carries none of the reveal's motion language** — no parallax, no scroll-pinning, no count-ups. Light theme (`#F7F9FC` canvas) against a navy sidebar.

### Layout

- **Sidebar 268px** (`navWidth` prop, 230–340), `--brand-navy`, collapses to `0px` below 940px and becomes a bottom sheet behind a "Documents" button in the header.
- Sidebar holds: brand lockup, the tenant identity strip (same one as the reveal's Scene 0 header), a `"4 of 9 ready"` counter with progress bar, the nine-document switcher, and Shane's credibility line.
- Switcher rows reuse **Scene 9's status dot pattern** — teal for ready, muted and pulsing (`genPulse`, 1600ms) for still generating.
- **Header:** current document title, `Download as PDF` (outline, `sm` — visually subordinate to reading in-app), a persistent primary **"Ready to fix this? →"** into the SOW, and a close action back to the reveal.
- **Body:** white card, max-width 820px, `1px #e7ebf0` border, 10px radius, `0 1px 2px rgba(10,37,64,.05)`, padding `clamp(28px,4vw,58px)`. Real report prose — 15–16px body at 1.6–1.65, measures capped at 62–66ch.

### Findings color language

Same split as the reveal: **pillar identity color** (fixed, from the palette below) marks *what a finding is* — the 7px square swatch beside each pillar name, the eyebrow, the left border on finding rows. **Severity color** (red/amber/green) marks *how bad it is* — score numbers, the Critical/Attention/Healthy tag, delta values. A Compliance score of 29 is red; a Compliance score of 90 is green. Compliance's own color plays no part in that.

### States

- **Ready** — full document rendered.
- **Still generating** — the same in-progress treatment as Scene 9's close: spinner, `"{title} is still generating"`, `"4 of 9 ready"`, progress bar, and a line explaining they can close the page and will be notified. Never a blank or broken page.

### ShaneBot — UI only

No chat logic, grounding or backend in this scope. Build:

- A **docked pill** bottom-right (`#0A2540`, 999px radius, `0 8px 24px rgba(10,37,64,.24)`) with a chevron that rotates 180° when open.
- On click it **expands upward** from its docked position — `transform-origin: 100% 100%`, opacity 0→1 over 220ms, `translateY(16px) scale(0.9)` → `none` over 260ms `cubic-bezier(.2,.8,.2,1)`. Not a centered modal, not a separate page.
- Panel interior: header, an "Asking about" context block, placeholder body copy, three suggestion chips, and a disabled input reading `"Ask about this report…"` with a `SOON` marker.

### "Ask Shane" hover affordance — UI only

Askable content is marked `data-ask` (finding rows, table rows, body paragraphs).

- The affordance **anchors to the hovered element, not the cursor** — computed from the element's `getBoundingClientRect()` (right edge minus 158px, top minus 14px, clamped to the viewport). It must never follow mouse movement; a tooltip that chases the cursor can never be clicked.
- Uses `mouseover`/`mouseout` with an early return when the pointer moves into the affordance itself (`relatedTarget` check on `[data-ask-affordance]`) plus a 260ms dismiss delay, so the hover holds across the gap between content and affordance — the way a native dropdown tolerates moving into its popup.
- Dismissed on scroll.
- Clicking passes that content into ShaneBot's panel as context (opening it if closed). **Not verified on a real touch device** — if it doesn't read as discoverable on a phone, replace the tap-to-reveal with a small persistent icon docked beside each finding on narrow viewports, which was the original spec.

---

## Screen 3 — SOW Proposal

**File:** `SOW Proposal.dc.html`
**Purpose:** Turn the findings into a scope the customer configures and signs. Dark theme, back on `#020617`.

### Layout

Two columns: phase list `flex: 1 1 540px`, sticky summary rail `flex: 1 1 300px` at `top: 88px`. Wraps to one column naturally.

### Phases

Six cards, one per pillar, each showing: pillar eyebrow with identity swatch, phase title, scope description (max 52ch), price, a toggle, and a footer tying it to the findings it addresses plus its score delta.

| Phase | Pillar | Price | Delta | Weeks |
|---|---|---|---|---|
| 1 Identity & Access Hardening | Security | $6,400 | 38 → 72 | 2 |
| 2 Sharing Exposure Remediation | Governance | $9,800 | 34 → 61 | 3 |
| 3 Data Protection Baseline | Compliance | $8,600 | 29 → 58 | 3 |
| 4 Licence Rationalisation | Licensing | $3,200 | 57 → 79 | 1 |
| 5 Adoption Enablement | Adoption | $5,400 | 46 → 68 | 2 |
| 6 Drift Baseline & Handover | Health | $2,800 | 44 → 70 | 1 |

**Phase 1 is locked.** It carries a `REQUIRED` badge and its switch is rendered in a distinct disabled state — dashed `rgba(100,116,139,.85)` track, muted `rgba(51,65,85,.55)` fill, grey `#475569` knob with a padlock glyph, `cursor: not-allowed` — and has **no click handler at all**. It must be genuinely inert, not just styled differently. A badge saying "Required" over a working toggle is worse than no badge.

Toggling any other phase recalculates: the one-off total, the phase count, the week estimate, and the projected readiness score (the mean of the six resulting pillar scores, so removing a phase visibly costs points).

### Optional services

Below a dashed divider, framed honestly: *"Nothing here fixes a finding."*

- **Tenant Monitoring** — toggle plus three tier cards (Essential $890, Growth $1,480, Enterprise $2,350). Growth is labelled *"your seat count"* for a 1,240-seat tenant. Default on, Growth selected.
- **White-Glove Copilot Adoption** — toggle plus three tier cards: Essential $2,400 (self-serve content pack), Growth $6,800 + $400/mo (team-run setup, live sessions), Enterprise $14,500 + $900/mo (full programme, monthly reporting). Default off, Growth pre-selected. Tiers are described by **delivery model, not seat bands** — unlike Monitoring, so Growth is labelled "recommended", never "your seat count".
- **Architect Retainer** — 8 hours a month, $2,200, cancel with 30 days. Default off.

### Summary rail

The sticky header total is explicitly labelled **"Today {upfront} then {monthly}"** — `upfront` includes the adoption one-off setup fee, `monthly` includes its recurring. An unlabelled figure that silently drops a line item on a screen the customer signs is misleading; both figures must account for the same set of selections.

One-off total, an adoption-programme line when selected, monthly recurring, and readiness `41 → projected` with the projected value colored by severity (green ≥60, amber ≥50, red below). Plus the line that keeps this honest: *"Removing a phase is a scope decision, not a discount — the findings it addresses stay in your reports, unremediated."*

### E-signature

Restyle the platform's **existing e-signature panel** rather than building a new one. Full name, role, a signature pad placeholder, and an authorisation checkbox that gates the submit button (`opacity .45` / `pointer-events: none` until checked, and the label changes from *"Confirm authorisation to sign"* to *"Sign and return this scope"*).

---

## Screen 4 — Checkout

**File:** `Checkout.dc.html`
**Purpose:** The quiet close of the arc. Deliberately less chrome than every prior screen — **no ShaneBot, no document navigation, nothing competing for attention.**

### Order summary — read only

The signed scope, locked. Seven rows (six phases + monitoring), each phase carrying its pillar identity swatch. **No toggles** — adjustment happened on the SOW; this is confirmation, not another decision point. Default carried state totals **$36,200** one-off plus **$1,480/mo**.

### Payment method

Two equal-weight cards, not a default plus a buried alternative:

- **Pay in full** — $36,200, one charge today.
- **Phased** — a `depositPct` deposit (default 40% = $14,480), with each remaining phase invoiced on the day that phase is signed off as complete. Selecting it expands a full invoice schedule (deposit, then per-phase amounts at `price × (1 - pct)`, then Phases 4–6 combined) plus the terms: due 14 days from sign-off, customer approves each phase before it bills.

### Payment form

The frame is ours — dark, Inter, brand colors, 6px radii, `--brand-blue` focus rings. **The form itself is the platform's existing Stripe integration.** Do not rebuild it; the fields in the prototype are visual placeholders for where Stripe Elements mounts.

### Trust signals

Specific, never generic. Stripe named explicitly. Plain statement that card details never reach Shane McCaw Consulting. The one deadline mentioned is the **real** 30-day unpaid-SOW expiry ("holds its quoted pricing until 2 September 2026"). **No countdown timers, no "X spots left," no fabricated scarcity.**

### Confirmation / kickoff

On success the whole screen becomes a kickoff state (`ckRise`, 520ms) that reads as the start of something rather than a receipt: what was paid, then TODAY / WEEK 1 / ONGOING — Shane reviews the scope within one business day, Phase 1 begins, every phase tracked against the finding that generated it. Primary action opens the remediation tracker. That downstream tracking UI is out of scope here; this is the handoff moment into it.

---

## Design Tokens

Bound design system: **Shane McCaw MSP** (`_ds/shane-mccaw-msp-design-system-.../`). Use its tokens and components; the values below are what the prototypes resolve to.

### Brand

| Token | Value |
|---|---|
| Deep Navy | `#0A2540` |
| Electric Blue | `#0078D4` (hover `#005A9E`) |
| Bright Teal | `#00B4D8` |
| Off-White | `#F7F9FC` |
| Dark canvas | `#020617` (slate-950) |

### Pillar identity colors (fixed — never severity-driven)

| Pillar | Primary | Accent |
|---|---|---|
| Governance | `#3B82F6` | `#60A5FA` |
| Security | `#8B5CF6` | `#A78BFA` |
| Compliance | `#F3F4F6` | `#D1D5DB` |
| Licensing | `#14B8A6` | `#2DD4BF` |
| Adoption | `#F97316` | `#FB923C` |
| Health | `#22C55E` | `#4ADE80` |
| Copilot (center) | full-spectrum blue→violet→cyan→white | holographic shimmer |

### Severity colors (universal — never pillar-driven)

| State | On dark | On light |
|---|---|---|
| Critical | `#f87171` | `#dc2626` |
| Attention | `#fbbf24` | `#d97706` |
| Healthy | `#34d399` | `#15803d` |

Delta values keep the existing `#0078D4 → #00B4D8` gradient treatment.

### Neutrals

`#f8fafc` headings on dark · `#94a3b8` body on dark · `#64748b` micro-labels · `#475569` de-emphasised numerals · `rgba(30,41,59,.9)` hairline borders on dark · `#e7ebf0` borders on light · `#3d5875` body on light.

### Type — Inter throughout

- Display: 800, `-0.03em` to `-0.05em`, line-height 0.94–1.16
- Section headings: 700, `-0.015em`
- Body: 500, 1.55–1.65
- Eyebrows: 9.5–11px, 600, `.20–.22em`, uppercase
- All numerals: `font-variant-numeric: tabular-nums`

### Radii

6px inputs/buttons · 10–14px cards · 16px emphasis panels · 999px pills · 11px icon tiles.

### Motion

150–260ms for state transitions. Scroll reveals eased `1-(1-t)³`. Radar sheen 9s. ShaneBot expand 260ms `cubic-bezier(.2,.8,.2,1)`. Verdict count-up 2600ms. No bounces.

---

## Data Contract

**Every number and fact on screen is real, live, and specific to the tenant that just completed the scan.** Nothing is a template value. The prototypes use one consistent fictional tenant — **Halden Materials, 1,240 seats, scanned 3 August 2026, score 41** — as a stand-in. Treat every number in the mocks as bound to real data.

Each scene needs, per pillar: the headline finding, the pillar score, the Copilot-risk sentence, the supporting evidence facts, the projected post-remediation score, and the remediation line. These come from the pillar-tagged findings and signal scores already live in the platform.

### Two-phase wait — do not collapse these into one

1. **The scan (1–2 min).** Scene 0. Full-screen radar for the whole duration is correct at this length.
2. **Document generation (5+ min, tenant-size dependent).** Happens **after** the reveal.

The reveal fires the instant the scan completes and must **never** be gated on document generation. At Scene 9 the nine documents are shown generating, not ready. A notification on the platform's existing delivery channel (the one used for purchase/onboarding confirmations) links into the viewer when the set completes. The in-page progress state and the notification are two views of one generation status, not two mechanisms.

---

## Out of scope / flagged

- **ShaneBot functionality** — UI, docked state, expand animation and context-passing target only. Grounding on documents + SOW needs its own architecture proposal.
- **v2 interactivity on the pillars** — letting a visitor scrub back and toggle a remediation to watch the central number move. Deliberately excluded from v1 so it doesn't fight the linear hook.
- **The remediation tracker** — Checkout's confirmation hands off to it; its UI isn't designed here.
- **White-Glove Adoption fulfillment** — Scene 8 and the SOW tier cards are the customer-facing surface only. The delivery architecture (manual vs automated per tier, Teams channel provisioning, prompt-drip workflow node, program report cadence) is an open architecture proposal, not designed here. Pricing shown is the current proposal's figures.
- **Six of the nine reports have no body content yet** — Executive Summary, Security Posture and Governance Maturity are written out in the viewer; the other six render the still-generating state. Wire them to real generated content or commission the copy.
- **No imagery in the pillar scenes** — type, number and sparkline only. Deliberate, but a decision worth re-confirming.
- **Billing/payment backend** — reuses the live Stripe integration.

## Assets

No images or bitmaps. All graphics are inline SVG (the radar, tracers, Lucide-style stroke icons) or CSS gradients. The "SM" brand mark is a `blue → teal` gradient tile with the wordmark set in Inter — use the codebase's existing `Logo` component. Icons should come from `lucide-react` rather than the hand-rolled SVG paths in the prototypes. **No emoji anywhere** — the brand never uses them.

## Files

| File | Screen |
|---|---|
| `Copilot Readiness Reveal.dc.html` | Screen 1 |
| `Document Viewer.dc.html` | Screen 2 |
| `SOW Proposal.dc.html` | Screen 3 |
| `Checkout.dc.html` | Screen 4 |
| `standalone/*.html` | Offline single-file versions — open these to interact |
| `_ds/` | The bound Shane McCaw MSP design system (tokens + components) |
| `support.js` | Prototype runtime only — ignore, do not port |
