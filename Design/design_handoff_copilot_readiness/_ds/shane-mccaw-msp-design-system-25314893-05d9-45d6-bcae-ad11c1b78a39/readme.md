# Shane McCaw MSP — Design System

A brand & UI design system for **Shane McCaw Consulting**, a Microsoft 365 governance
platform and consultancy. Shane McCaw is positioned as a *Lead Microsoft 365 Architect
at NASA* and 30-year Microsoft-ecosystem veteran; the product is an **M365 Governance
SaaS** powered by six automated "signal engines" (Drift, Security, Health, SLA, Scope
Creep, Sales Offer) that continuously monitor a client's Microsoft 365 tenant via the
Microsoft Graph API.

The business spans several surfaces that share one brand:

| Surface | What it is | Visual mode |
|---------|-----------|-------------|
| **Marketing website** (`shane-mccaw-consulting`) | Public site: assessments, monitoring pricing, diagnostics quizzes, retainers, MSP-reseller program, resources/blog | **Dark** — slate-950 canvas, Electric-Blue accents |
| **MSP / Client Portal** (`msp-portal`) | Authenticated app: customer dashboards, SOWs, SLAs, billing, offers, kanban | **Light** default (Off-White + Navy chrome), with a Deep-Navy dark mode |
| **CRM**, **Admin Panel** | Internal ops tools | Share the portal's shadcn token system |
| **Mobile** (`shane-mobile`) | Expo/React-Native companion | Same palette |

All web surfaces are **React + Vite + Tailwind CSS v4 + shadcn/ui ("new-york" style) +
Lucide icons**, sharing the same brand palette (Deep Navy / Electric Blue / Bright Teal /
Off-White) and the **Inter** typeface.

## Sources

Built by reading the source repository (not screenshots):

- **GitHub:** `shanemccaw/Shane-McCaw-MSP` — <https://github.com/shanemccaw/Shane-McCaw-MSP>
  - Canonical token definitions: `artifacts/msp-portal/src/index.css` (full light+dark
    shadcn theme with brand HSL mappings) and
    `artifacts/shane-mccaw-consulting/src/index.css`.
  - Real screens: `artifacts/shane-mccaw-consulting/src/pages/Home.tsx`,
    `components/Header.tsx`, `components/Footer.tsx`; `artifacts/msp-portal/src/pages/login.tsx`.
  - Brand mark: `artifacts/shane-mccaw-consulting/public/favicon.svg` (the "SM" tile) and
    `public/og-image.png`.

Explore that repository further to build higher-fidelity recreations of any specific screen.

---

## CONTENT FUNDAMENTALS

**Voice:** confident, expert, and slightly provocative — a specialist who has seen the
failure modes and isn't shy about naming them. Authority is earned through the **NASA**
credential, repeated as social proof ("Built by NASA's M365 Copilot Architect",
"the same framework NASA runs on").

- **Person:** speaks to **"your tenant," "your seat count"** (second person). Shane is
  referred to in the third person ("Shane McCaw wrote the governance framework NASA
  distributed agency-wide").
- **Tone:** direct, outcome-first, mildly confrontational headlines that name the pain:
  - *"Your Microsoft 365 Tenant, Watched Every Hour of Every Day"*
  - *"Stop Finding Out About Problems Six Months Late"*
  - *"An assessment tells you what's wrong today. Monitoring tells you the second it happens again."*
- **Casing:** hero **H1s are Title Case**; section H2s mix Title Case and sentence case;
  eyebrows and micro-labels are **UPPERCASE with wide letter-spacing** ("SIGNAL
  INTELLIGENCE DIAGNOSTICS — FREE"). Body copy is sentence case.
- **Structure:** short punchy sentences, concrete verbs (*hunts, fingerprints, fires,
  tracks, surfaces*), specific technical nouns (drift, guest access, OAuth apps, MFA gaps,
  SOW, Graph API). Numbers are load-bearing ("6 engines", seat counts, prices).
- **Product naming:** capitalized proper nouns for features — **Drift Engine, Security
  Engine, Tenant Monitoring, Free Telemetry Snapshots, Architect Retainers, Signal
  Intelligence Diagnostics**.
- **Emoji:** **none.** Never used. Emphasis comes from typography and color, not glyphs.
- **CTAs:** imperative and specific — "See Monitoring Pricing", "Run Free Diagnostic",
  "Start Monitoring", "Contact Shane McCaw" (not "Learn more" / "Submit").

---

## VISUAL FOUNDATIONS

**Palette.** Four brand colors anchor everything:
- **Deep Navy `#0A2540`** — chrome, sidebars, headings, the dark canvas base.
- **Electric Blue `#0078D4`** (Microsoft blue) — the primary action color. Hover/pressed
  deepens to `#005A9E`. On the dark marketing site this reads as `blue-600 #2563eb` →
  hover `blue-500 #3b82f6`, with `blue-400 #60a5fa` for accent text and icons.
- **Bright Teal `#00B4D8`** — highlight / accent, gradient partner to the blue.
- **Off-White `#F7F9FC`** — the light product background.
- Plus a full **slate scale** (`950 #020617` … `100 #f1f5f9`) that the marketing site is
  built on, and a set of **semantic "signal" accents** (violet, red, emerald, amber,
  yellow, teal, indigo — each used at `-400/-500` with `/10` tint fills and `/20` borders)
  that color-code the diagnostic categories.
- **Max 1–2 background colors per view.** Marketing: slate-950. Portal: off-white (or navy
  dark mode). Never a rainbow.

**Two theme modes.** The system ships light (`:root`, the portal default) and dark
(`.dark` scope, the portal dark mode and the marketing canvas). Semantic tokens
(`--background`, `--primary`, `--card`, `--sidebar` …) resolve per mode.

**Typography.** **Inter** exclusively, weights 400–800. Headlines are heavy
(**700–800**) and set **tight** (`-0.02em`); big numbers/prices use 800. Eyebrows are
uppercase, semibold, wide-tracked. Body is 400/500 at comfortable 1.5 line-height. Georgia
is a rare serif fallback for legal prose; Menlo mono appears only for codes (MFA, tokens).

**Spacing & layout.** 4px base step. Page container `max-w-7xl` (1280px). Fixed header
(80px desktop / 64px mobile), `backdrop-blur` + translucent navy. Portal has a 256px navy
sidebar. Generous section padding (py-16/20), 8-unit grid gaps between cards.

**Corner radii.** Two radius cultures: the **apps/portal** use a tight **`0.375rem` (6px)**
on inputs/buttons/small cards; the **marketing site** rounds cards to **`1rem`
(rounded-2xl)**, buttons/panels to `0.75rem`, CTA blocks to `1.5rem`, and pills/badges to
**full**. Icon tiles are `rounded-xl`.

**Cards.** Marketing: `bg-slate-900` / `slate-900/60`, hairline `slate-800/80` border,
no heavy shadow — depth comes from the border and a hover **border-color shift to
`blue-500/40`** (plus a subtle `-translate-y` lift on service cards). Portal/light: white
card, `#e7ebf0` border, soft navy-tinted `--shadow-sm`.

**Borders.** Hairline and low-contrast: translucent slate on dark, `~8–12%` navy on light.
Borders (not shadows) do most of the separation work on dark.

**Shadows.** Two families: neutral **navy-tinted** shadows for light surfaces
(`rgba(10,37,64,.05–.20)`), and colored **blue "glow"** shadows for emphasis CTAs on dark
(`shadow-lg shadow-blue-600/30`). Teal glow is available for accent moments.

**Backgrounds & texture.** Mostly flat solid navy/slate. Accents: faint **grid lines** and
large **concentric-circle** motifs (see OG image), soft **radial blue glows**
(`bg-blue-500/5 blur-3xl`) behind CTA blocks, and restrained **linear gradients**
(`from-blue-950/20 to-slate-900` panels; `blue→teal` for the logo mark and hero tiles). No
photography-driven heroes on the marketing site; imagery, when present, is cool-toned and
technical (dashboards, telemetry). **No purple-gradient hero soup.**

**Iconography in tiles.** Icons live in **rounded-xl tinted tiles** — `bg-{color}/10`
fill, `border-{color}/20`, `text-{color}-400` glyph — a signature pattern repeated for
engines, stats, nav dropdowns, and feature lists.

**Animation.** Restrained and functional: `transition-colors`/`transition-all` at
150–300ms, gentle hover lifts (`-translate-y-1`), chevrons that nudge `translate-x-1` on
hover, dropdown chevrons rotating 180°, a fade-in on hero elements, spinner loaders. No
bounces, no parallax, no showy motion.

**Hover / press states.** Hover = lighten/darken via a low-opacity overlay ("hover-elevate"
= `rgba` overlay at ~3%; active ~8%), border-color intensifying to the accent, or a
one-step-lighter background (`bg-blue-600 → bg-blue-500`, `bg-slate-900 → bg-slate-800`).
Focus = 1–2px `--ring` (Electric Blue) outline. No shrink-on-press; depth is color, not
scale (except the deliberate card lift).

**Transparency & blur.** Used deliberately: the fixed header is `bg-slate-950/95
backdrop-blur-md`; tint fills (`/10`, `/20`) for badges and tiles; `/40`–`/80` opacities on
borders and dividers to keep them hairline. Login cards use `bg-card/95 backdrop-blur`.

---

## ICONOGRAPHY

- **Primary icon set: [Lucide](https://lucide.dev)** (`lucide-react`), stroke style, 2px
  weight — used everywhere: nav, feature cards, stats, buttons, form fields. Common glyphs:
  `ShieldCheck` (the de-facto brand/logo icon), `Zap`, `Activity`, `Layers`, `Lock`,
  `Clock`, `ArrowRight`, `ChevronRight/Down`, `Radar`, `Sparkles`, `Users`, `CheckCircle2`,
  `AlertTriangle`, `Brain`, `GitMerge`, `Share2`, `KeyRound`, `Loader2`.
  In these design-system cards Lucide is loaded from CDN (`unpkg.com/lucide`) and rendered
  with `data-lucide` + `lucide.createIcons()`.
- **Secondary:** `react-icons/fa` (Font Awesome) appears in a few marketing spots.
- **Icon presentation:** almost always inside a **rounded-xl tinted tile** (see Visual
  Foundations). Standalone icons inherit the accent color of their category.
- **Emoji:** never used. **Unicode glyphs:** only the arrow `→` occasionally in link
  affordances. No custom icon font, no PNG icon sprites.
- **Brand mark:** a rounded-square **"SM"** tile. The favicon is a flat Deep-Navy tile
  (`assets/logo.svg`); the richer marketing/OG treatment fills the tile with a
  `blue→teal` gradient (reproduced by the `Logo` component). There is **no separate
  wordmark logo file** in the source — the wordmark is set in Inter.

### Assets
- `assets/logo.svg` — the "SM" brand mark (copied from the source favicon).
- `artifacts/shane-mccaw-consulting/public/` — copied `og-image.png` and `opengraph.jpg`
  (brand social cards) for reference.

---

## Components

Reusable React primitives (see `components/`). The source apps use the full shadcn/ui
"new-york" set (55 UI files); this system rebuilds the primitives that actually appear in
the product's real screens, plus the brand composites unique to Shane McCaw.

**Core (`components/core/`):**
- **Button** — primary/secondary/outline/ghost/destructive/link; sizes sm/default/lg/icon.
- **Badge** — solid variants + `soft` tinted "signal" pills (8 tones).
- **Card** (+ CardHeader, CardTitle, CardDescription, CardContent, CardFooter) — surface
  container with optional `interactive` hover-lift.
- **Input** (+ **Label**) — labelled text field with hint/error states.
- **Alert** — inline info/success/warning/destructive feedback banner.

**Marketing composites (`components/marketing/`):**
- **Logo** — the gradient "SM" mark + wordmark lockup.
- **Eyebrow** — the uppercase tracked label / tinted capsule above headlines.
- **StatCard** — icon + big value + label metric tile.
- **EngineCard** — the icon/eyebrow/title/description feature ("signal engine") card.
- **ServiceCard** — priced offering / catalog card (category, duration, price + CTA).

### Intentional additions
- **Logo** and **Eyebrow** are added wrappers (the source renders these inline). They
  capture recurring brand patterns so they stay consistent; both mirror exact source values.

---

## UI Kits

Full-screen click-through recreations composing the components above:
- **`ui_kits/marketing-website/`** — the public marketing site (dark): hero, credibility
  strip, six-engine grid, live seat-count pricing catalog, CTA, footer.
- **`ui_kits/client-portal/`** — the authenticated portal (light + navy chrome): sign-in
  and a customer dashboard.

---

## Index / Manifest

Root files:
- `styles.css` — **the entry point.** `@import` manifest only. Consumers link this.
- `tokens/` — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `elevation.css`.
- `thumbnail.html` — homepage tile.
- `components/core/`, `components/marketing/` — primitives (`.jsx` + `.d.ts` +
  `.prompt.md` + one `@dsCard` HTML per folder).
- `ui_kits/marketing-website/`, `ui_kits/client-portal/` — screen recreations.
- `assets/` — logo + reference brand images.
- `SKILL.md` — Agent-Skills wrapper for reuse in Claude Code.
- `readme.md` — this file.

The Design System tab renders every `@dsCard`-tagged HTML: foundation specimens (Type,
Colors, Spacing, Brand), the two component cards, and the UI-kit screens.
