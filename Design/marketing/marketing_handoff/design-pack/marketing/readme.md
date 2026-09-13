# Marketing Design Pack

A portable extraction of the **dark marketing-site** patterns actually built for the
Shane McCaw Consulting M365-governance brand — the public site (home, six pillar pages,
workload deep-dives, pricing, checkout). It sits on top of the base **Shane McCaw MSP
Design System** (tokens, Button/Card/Badge primitives) and adds the marketing site's own
page-level patterns: the radial-glow hero background, the watermark glyph, the glass
artefact card, category identity chips, and the gradient CTA.

**Use this pack when building another dark, diagnostic-led B2B marketing site** — it is
not the whole brand system, just the marketing layer. For the full brand (light portal,
CRM, mobile) go to the base design system this was extracted from.

## Source

Built from the `Copilot Readiness Scroll Narrative` project's marketing surface
(`design_handoff_marketing/` and the `Marketing *.dc.html` files), which itself recreates
`shanemccaw/Shane-McCaw-MSP` (`artifacts/shane-mccaw-consulting`). See that repo for the
canonical component source if you have access.

---

## CONTENT FUNDAMENTALS

Confident, expert, mildly provocative — a specialist naming failure modes plainly.
Second person ("your tenant"); the brand is referred to in third person. Headlines name the
pain directly: *"Ask who owns Exchange. Watch the room go quiet."* Eyebrows and micro-labels
are UPPERCASE with wide letter-spacing; H1s are Title Case; body is sentence case and short.
No emoji, ever. CTAs are imperative and specific ("Scan My Tenant · Free"), never "Learn
more". Numbers are load-bearing — seat counts, prices, counts of checks run.

## VISUAL FOUNDATIONS

- **Canvas**: always dark. Page `#020617`, raised sections `#050d1e`, cards `#0b1524`.
  Max one accent color live per page (the page's own category color).
- **Page gradient**: two large low-opacity radial glows in the page's accent color — one
  top-right at ~11–13% opacity, a smaller one lower-left at ~5–7% — fading to transparent.
  Never a hard-edged color block.
- **Watermark glyph**: one large stroke icon behind the hero at 3.5–13% opacity.
- **Hero artefact card**: semi-transparent and blended (`linear-gradient(160deg, color/10,
  navy/52% 55%, navy/34%)`), hairline border in the page color at ~22%, `blur(3px)`, soft
  glow, 1px inner top highlight — never a flat panel.
- **Section seams**: body sections are separated by a gradient-to-raised-navy transition,
  not hairline borders.
- **Category identity**: any named category (a pillar, a workload) always carries its own
  stroke glyph in a tinted rounded tile — never a plain colored dot. Dots are reserved for
  severity/legend meaning only.
- **Type**: Inter 400–800. Hero H1 `clamp(30px,3.4vw,40px)` / 800 / `-.03em`; H2 24px / 800
  / `-.025em`; body 13.5–15px / 1.7; eyebrows 10px / 700 uppercase / `.2em`. Numbers use
  tabular figures.
- **Radii**: cards 14–18px, buttons/inputs 8–10px, pills full, icon tiles 5–10px.
- **Primary CTA**: `linear-gradient(90deg,#3b82f6,#8b5cf6)`, white text, weight 700 — reserve
  for the single most important action per view. Secondary is a hairline outline button.
- **Motion**: restrained. 150–300ms color/border transitions, hover intensifies the border to
  the accent, a gentle lift on interactive cards. No parallax, no bounce.

## ICONOGRAPHY

Lucide-style stroke icons (2px weight), always inside a tinted rounded-tile ("icon in a
box") for any category identity. No icon font, no PNG sprites, no emoji. The arrow glyph
(→, as inline SVG) is the only decorative mark used on CTAs.

## Index

- `styles.css` — import manifest, link this one file.
- `tokens/` — colors, typography, spacing, elevation, fonts (Inter via Google Fonts — no
  local font files were available to copy; flag if you need the actual webfont binaries).
- `assets/logo.svg` — the brand mark.
- `components/marketing/` — Nav, Footer, PillarIdentity, GlassArtefactCard,
  PageGradientSection (+ SeamSection), GradientButton (+ OutlineButton). These are the
  patterns specific to this marketing layer; generic primitives (base Button, Card, Badge,
  Input) live in the base Shane McCaw MSP design system this was extracted from.
- `SKILL.md` — Agent Skills wrapper for reuse in Claude Code.

## Note on brand names in the components

Sample text ("Brand Name", "Category label", "Primary CTA") was left generic in the
component defaults — swap in your own brand's copy and colors; the pillar colors/glyphs are
this brand's specific six-category system and should be replaced with your own categories.

## How to use this pack in another project

1. Copy the `design-pack/marketing/` folder as the **root** of a new, empty project.
2. In that new project's Share menu, set **File type: Design System** — this makes the
   Design System tab compile `components/` and render the `@dsCard`-tagged files.
3. Attach that design system to any project that should build marketing pages in this
   style.
