# Handoff: Shane McCaw Consulting — Marketing Site Rebuild

## Overview

Fifteen marketing pages for Shane McCaw Consulting (Microsoft 365 architecture, Copilot readiness, governance and security consulting). The pages sell one thing: direct access to Shane, positioned as NASA's Lead Microsoft 365 Architect with 30 years in the Microsoft ecosystem, through Architect Retainers from $900/month and a $5,000 Copilot Readiness Assessment. The design replaces the current site's visual language with the "locked" navy / Electric Blue / Bright Teal system on a slate-950 canvas.

Target repository: `shanemccaw/Shane-McCaw-MSP`, app `artifacts/shane-mccaw-consulting` (React + Vite + Tailwind CSS v4 + shadcn/ui "new-york" + Lucide). `github.md` at the project root maps every screen to the source files it was built from.

## About the Design Files

Every `*.dc.html` file in this bundle is a **design reference written in HTML**. They are prototypes that show the intended look and behavior, not production code to copy. The task is to **recreate these designs inside the existing React + Tailwind codebase**, using its `Layout`, `Header`, `Footer`, shadcn primitives and Lucide icons. Where a page already exists in the repo (Contact, Resources, ArticlePage, Solutions, About), this is a design pass on it: routes, data files, `/api/leads`, `/api/shares`, Stripe checkout and the markdown article pipeline stay as they are.

Open any file directly in a browser to see it. `support.js` and `_ds/` are the prototype runtime and token stylesheets; they are not deliverables.

## Fidelity

**High-fidelity.** Colors, typography, spacing, copy and interaction states are final. Recreate pixel-perfectly with the codebase's existing libraries. All copy is verbatim and should not be rewritten.

## Global Rules

- **No email address anywhere on the site, and no `mailto:` links.** Contact happens through the Contact form only. Remove the `mailto:` links that exist today in `PortalSupportHandoff.tsx`, `Privacy.tsx`, `legal/*.tsx` when those pages get their pass.
- **NASA exclusion copy** appears on Work With Me, Contact, About and every Solution page: Shane's NASA role is a personal credential, not an endorsement, and organizations that work with, contract to, or partner with NASA cannot be taken on.
- **No emoji.** Emphasis comes from type and color.
- **One brand mark**: 36×36 tile, `border-radius:12px`, `linear-gradient(135deg,#3b82f6,#8b5cf6)`, white Lucide `ShieldCheck` (20px, stroke 2). Same tile in header and footer on every page. Wordmark "Shane McCaw" in Space Grotesk 700 16px, `letter-spacing:-.02em`.

## Shared Chrome

### Header (all pages)
- `position:fixed; top:0; height:72px; z-index:50`, background `rgba(2,6,23,.88)` + `backdrop-filter:blur(24px)`, bottom border `1px solid rgba(30,41,59,.8)`. Content container `max-width:1280px`, horizontal padding `clamp(16px,4vw,32px)`. `<main>` gets `padding-top:72px`.
- Desktop (≥1024px): logo left; nav center — Assessment · Solutions (dropdown) · Fractional Architecture · About Shane · Resources · Contact; CTA right "Talk to Shane →" (`background:#0078D4`, hover `#005A9E`, `border-radius:12px`, padding `9px 16px`, 14px/600 white).
- Nav link: 14px/500 `#B5B5BC`, padding `8px 14px`, radius 8px; hover `color:#F5F5F7; background:rgba(255,255,255,.04)`. Active page: `color:#00B4D8; background:rgba(255,255,255,.06)`.
- Solutions dropdown: `width:400px`, two columns, `background:rgba(5,12,29,.97)`, border `1px solid rgba(30,41,59,.9)`, radius 16px, padding 8px; items 13px/500 `#F5F5F7`, radius 12px, hover `background:rgba(255,255,255,.06); color:#00B4D8`. Eight items: Copilot & AI, Security & Compliance, Governance, SharePoint, Power Platform, Teams, Migration, M365 Health.
- Mobile (<1024px): hamburger (Lucide `Menu`, 24px, button padding 10px). Menu panel below the bar: rows 14px/500 `#F5F5F7`, padding `12px 12px`; Solutions sub-rows padding `11px 24px` `#B5B5BC`; full-width "Talk to Shane" button at the bottom (`#0078D4`, radius 12px, padding `12px 16px`).

### Footer (all pages)
- `background:#020617`, top border `1px solid rgba(30,41,59,.8)`, padding `64px clamp(16px,4vw,32px) 40px`, container 1280px.
- Five flex columns (wrap): brand (mark + "Shane McCaw Consulting" Space Grotesk 600 16px; tagline "Vero Beach, FL — M365 · Copilot AI · SharePoint · Power Platform" 14px `#B5B5BC`), Get Started, Solutions (8 links), Company (About Shane, Resources, Contact, Ask a Question → Contact), Legal (Terms, Privacy). Column heads 14px/600 `#F5F5F7`; links 14px `#B5B5BC` hover `#F5F5F7`, 10px vertical gap.
- Bottom bar: 12px `#B5B5BC` — "© 2026 Shane McCaw Consulting. All rights reserved. Shane's role at NASA is a personal credential; this practice is independent of NASA." + Privacy Policy link.

### Recurring patterns
- **Eyebrow**: 26×1px gradient rule (`linear-gradient(90deg,#00B4D8,rgba(0,180,216,.15))`) + label 11px/600 uppercase `letter-spacing:.16em` `#00B4D8`.
- **Section heading**: Inter 800, `clamp(24px,4vw,34px)` (page heroes `clamp(28px,4vw,44px)`), `letter-spacing:-.025em`, `line-height:1.1–1.14`, `#f8fafc`, `text-wrap:pretty`. Accent word in `#a78bfa` (violet) on heroes, `#00B4D8` on section heads.
- **Body**: 15–17px, `line-height:1.6–1.65`, `#94a3b8`; emphasized body `#cbd5e1`.
- **Card**: `background:rgba(15,23,42,.5)`, border `1px solid rgba(30,41,59,.9)`, radius 16px, padding 22–24px; hover `border-color:rgba(0,120,212,.4)`; link cards also `transform:translateY(-3px)`, transition 200ms.
- **Feature panel** (hero side panels, CTA blocks): border `1px solid rgba(0,120,212,.3)`, radius 20–24px, `background: radial-gradient(900px 380px at 8% -10%, rgba(0,120,212,.18), transparent 60%), linear-gradient(168deg, rgba(10,37,64,.5), #070d1e 64%)`.
- **Violet hero panel** (stat stacks on Work With Me / About): border `1px solid rgba(139,92,246,.22)`, radius 18px, `linear-gradient(160deg, rgba(139,92,246,.10), rgba(11,21,36,.52) 55%, rgba(11,21,36,.34))`, `box-shadow: 0 0 60px rgba(139,92,246,.13), inset 0 1px 0 rgba(148,163,184,.08)`.
- **Hero background**: `radial-gradient(circle 1100px at 76% -20%, rgba(139,92,246,.12), transparent 62%), radial-gradient(circle 800px at 6% 12%, rgba(0,120,212,.06), transparent 66%)` plus a 440–470px Lucide glyph at `right:-60px`, `opacity:.1–.11`, `stroke:#a78bfa`, `stroke-width:.7–.8`, `filter:drop-shadow(0 0 26px rgba(139,92,246,.3))`. Section has `overflow:hidden`.
- **Icon tile**: 40×40 (36 in dense lists), radius 12px, `background:{accent}/10`, border `1px solid {accent}/20`, glyph in the accent at 20px.
- **Primary CTA (gradient)**: `linear-gradient(90deg,#3b82f6,#8b5cf6)`, white, 600, radius 12px; large `min-height:52px; padding:0 26px; font-size:16px`, medium `44px / 0 20px / 14px`, full-width form button `50px / 15px / radius 10px`. Always ends with a Lucide `ArrowRight` 16px.
- **Outline CTA**: transparent, `color:#e2e8f0`, border `rgba(148,163,184,.3)`, same sizes.
- **Check list item**: 14px `#94a3b8` with Lucide `Check` 14px `#00B4D8` stroke 2.5, gap 6px.
- **Pill / badge**: 10.5px/700 uppercase `letter-spacing:.1em`, radius 999px, padding `5px 11px`, `#60a5fa` on `rgba(96,165,250,.1)` with border `rgba(96,165,250,.2)`; teal variant `#00B4D8` on `rgba(0,180,216,.1)` / `.3` border.
- **Form field**: label 13px/500 `#cbd5e1` above; input `padding:11px 12px`, radius 9px, border `1px solid rgba(148,163,184,.28)`, `background:rgba(2,6,23,.55)`, text 14px `#f1f5f9`, placeholder `#64748b`; focus `border-color:#0078D4; box-shadow:0 0 0 3px rgba(0,120,212,.25)`. On viewports <1024px inputs render at 16px to stop iOS zoom.
- **Spinner**: Lucide `Loader2` 28px `#0078D4`, 1s linear rotation.

## Screens / Views

### 1. Work With Me — `Work With Me.dc.html` (route: home / retainers)
Purpose: sell the four Architect Retainer tiers and take payment.
- **Hero**: two-column grid `repeat(auto-fit, minmax(min(100%,420px),1fr))`, gap `clamp(40px,6vw,80px)`. Left: eyebrow "Fractional Microsoft 365 Architecture"; H1 "The Architect Behind NASA's Microsoft 365 — Retainers From $900/Month." (accent span violet); two lead paragraphs; CTAs "Start at $900/mo →" (gradient lg) + "Compare the four tiers" (outline lg); check row "No proposal cycle · No SOW · No minimum term". Right: violet stat panel with three rows (2026 / Innovation Forum Award; 30 / Years in the Microsoft ecosystem; 6 / Pillars scanned from live Graph telemetry with a 3×2 grid of pillar chips — Governance `#60a5fa` Share2, Security `#a78bfa` Shield, Compliance `#D1D5DB` FileCheck, Licensing `#2dd4bf` CircleDollarSign, Adoption `#fb923c` Users, Health `#4ADE80` Activity). Stat numbers `clamp(52px,6.5vw,80px)` 800 `letter-spacing:-.045em`.
- **Credibility strip**: `background:rgba(15,23,42,.4)`, top/bottom hairlines; four columns `minmax(min(100%,230px),1fr)`, each with a teal top rule, Menlo 11px index (01–04), 17px/700 title, 14px body.
- **Retainer tiers** (`#tiers`): heading "Every Hour Is Shane's. Choose How Many."; four rows separated by hairlines. Row: Menlo index · name 19px/700 (+ "Start here" teal pill on Advisory) · fit copy · hours (30px/800 + "hrs / month") · price (30px/800 + "/ mo") · "Start retainer" gradient button (150px min). Data: Advisory 5 hrs $900; Essentials 8 hrs $1,500; Growth 16 hrs $3,000; Enterprise 30 hrs $5,500. Clicking a row toggles an inline checkout panel (feature-panel style, two columns): left = "You're starting" eyebrow, tier name, price, five check items, cancellation note; right = Stripe Payment Element (Work email, Card number, Expiry/CVC/ZIP in `repeat(auto-fit,minmax(min(100%,88px),1fr))`), full-width "Start retainer · $X/mo" button, lock note. States: idle → processing (spinner "Confirming with Stripe…", 1.6s in prototype) → done (teal panel "Retainer started / {tier} is active."). Only one tier open at a time; opening scrolls the row to 96px below the top. Advisory is open on load.
- **Scoped retainers** (behind a flag, hidden by default): vCISO / Governance Retainer from $4,500/mo; Copilot Governance Retainer from $2,000/mo; outline "Request scoping →" buttons.
- **Assessment section** (`#assessment`): eyebrow "The Copilot Readiness Assessment · $5,000", H2 "The Same Tool Paying Customers Run Today.", two paragraphs, CTA "Start the assessment · $5,000 →" + "One-time. Commercial tenants only."; right: 2×3 grid of six pillar cards (icon tile + uppercase colored label + one line).
- **Close + contact** (`#contact`): feature panel, two columns; left eyebrow "Direct Engagement", H2 "Five Hours a Month With NASA's Lead Microsoft 365 Architect.", copy, "Start at $900/mo →"; right: inline "Ask a question first" form (Name, Work email, Company, What's stuck textarea, "Send to Shane") with sending/sent states. Footer "Contact"/"Ask a Question" links go to the Contact page.

### 2. Contact — `Contact.dc.html`
Purpose: the only contact channel; a form plus what happens next.
- **Hero + form**: container 1160px. Eyebrow "Contact · Direct to Shane"; H1 "Send the Problem. Shane Replies Within 24 Hours." (second sentence violet); lead. Below, two-column grid `minmax(min(100%,400px),1fr)`, gap `clamp(32px,5vw,64px)`.
  - Left card (feature panel, radius 20px): eyebrow "Send Shane a Message"; Name + Work email (two-up `minmax(min(100%,180px),1fr)`), Company, optional chip picker "What you're considering" (Architect Retainer / Copilot Readiness Assessment / Not sure yet — single select, toggles off on second tap; selected chip `background:rgba(0,120,212,.18)`, border `#0078D4`, check icon), "What's stuck" textarea (5 rows), inline validation line `#fca5a5` "Add your name, a work email and a sentence about what's stuck." when name/email/message are empty, full-width "Send to Shane →", note "Goes to Shane directly. He cannot take on organizations that work with, contract to, or partner with NASA."
  - States: sending (spinner, "Sending to Shane…", min-height 520px) → sent (CheckCircle tile, eyebrow "Sent", "Shane has it." 24px/800, paragraph, weekend note with Clock icon).
  - Right column: eyebrow "What Happens Next", H2 "Four Steps, All of Them With Shane."; vertical stepper — 40×40 numbered tiles (Menlo 12px, teal border `rgba(0,180,216,.35)`, fill `.08`) joined by a 1px `rgba(30,41,59,.9)` line; each step has a teal 11px uppercase kicker, 17px/700 title, 14.5px body:
    1. Within 24 hours — Shane replies himself — "Your message goes to his inbox, not a queue. He answers it within 24 hours on the next business day."
    2. 30 minutes · Free — A free consultation — "You pick a time. Thirty minutes on the issues you're facing and how Shane can help. No pitch."
    3. Your decision — You decide — "If it fits, you choose the engagement: a retainer tier or the Copilot Readiness Assessment. If it doesn't, you leave with a clearer picture and no obligation."
    4. From $900 a month — Purchase the hours. Work starts. — "Hours are purchased up front by card through Stripe. Shane schedules the first session and the engagement begins."
    Then the check row "No proposal cycle · No SOW · No minimum term".
- **Details strip** (`background:rgba(15,23,42,.4)`): three icon-tile items — MapPin "Based in Vero Beach, FL / Working with clients nationwide, on Eastern time."; Mail "The form is the front door / No public inbox. Messages sent here reach Shane directly, and his reply comes from his own address."; ShieldAlert (amber `#FBBF24`) "One exclusion / …cannot take on organizations that work with, contract to, or partner with NASA."
- Backend: post to the existing lead/contact endpoint; no `mailto:`.

### 3. About Shane — `About Shane.dc.html`
Purpose: credibility. Sections in order: hero (H1 "30 Years in the Microsoft Ecosystem. Currently NASA's Lead M365 Architect. Still Doing the Work." + violet stat panel 30+/NASA/20+/2026); "Available for Engagements" panel + three paragraphs; "Who I Help — and Why" (three cards with pill, Core challenge / Shane's angle blocks, italic quote); "Why IT Leaders Bring Me In" (six trigger rows with 36px icon tiles + "Why It Works" side panel); Background (four paragraphs + sticky pull-quote with SM avatar); "The NASA Advantage" (copy + four cards); Timeline "30 Years. One Ecosystem." (three rows — date column `flex:0 0 clamp(120px,15vw,180px)` Menlo teal, body column `flex:1 1 380px` wraps under on phones; "Current" solid-teal pill on the NASA row; award band beneath); "Hands-On. Direct. No Shortcuts." (four numbered principles); Core Competencies (20 pill chips, 13px/500 `#cbd5e1`, border `rgba(148,163,184,.22)`); "How You Can Work With Me" (six link cards, first one highlighted with blue border/gradient); final centered CTA panel "Your Microsoft 365 environment deserves senior expertise." with "Book a Consultation" (gradient, MessageSquare icon) + "Start at $900/mo" (outline), "No pitch. No obligation. Just clarity.", NASA disclaimer.

### 4. Assessment — `Assessment.dc.html`
The $5,000 Copilot Readiness Assessment landing (imported from the existing Copilot Readiness design; header/footer updated to the shared chrome). Keep its scroll-reveal/parallax behavior, seven-question quiz, six pillar chapters with benchmark bars, programme cards and Stripe checkout as built. Reduced-motion users get no animation.

### 5. Resources — `Resources.dc.html`
Purpose: content hub. Hero (eyebrow "Resources & Field Notes", H1 "Practical Microsoft 365 guidance, written from the field" with teal accent, lead). **Featured article** (default view only: no filter, no query): feature panel radius 24px, two columns — left "Latest article" label + category pill, 36px title link, summary, "Read Article →" (gradient md) + date · reading time · share count; right meta rail with teal left border: Published / Reading time / By Shane McCaw, Lead M365 Architect at NASA. **Browse**: search input (Lucide Search, `type=search`, substring match on title+summary+category) + category pills ("All" + the five categories present, with counts; active `#0078D4` fill). Grid `repeat(auto-fill,minmax(min(100%,300px),1fr))`, gap 16px; card: category pill, 18px/700 title link, summary (flex:1), footer row with date · reading time · shares, LinkedIn / X share icons (8px padding hit area) and "Read More →" (13px/600 teal). Empty state card with "Show all articles". **What gets published here** (two cards: Tactical guides, Field notes). **Go deeper**: glass panel (`rgba(255,255,255,.05)`, border `rgba(255,255,255,.12)`, blur 24px) with the M365 Copilot Readiness Checklist lead magnet — First name + Work email, "Download Free Checklist" (disabled until name + valid email), sending → success message; posts to `/api/leads`. **Closing CTA**: "Found a gap you'd rather not tackle alone?" → "Book a Consultation" → Contact.
- Article links: `/resources/{slug}` in production (prototype uses `Article.dc.html?slug=`). Share URLs use `https://shanemccaw.com/resources/{slug}`.
- Categories (locked, exact): Copilot AI Tips · M365 Best Practices · Power Platform How-Tos · Governance & Compliance · Digital Transformation.

### 6. Article — `Article.dc.html` (route `/resources/:slug`)
Purpose: read one article; content column `max-width:800px`.
- **Header** (hairline below, hero gradient): "← Back to Resources" 13px/600 teal; meta row — category pill with Tag icon, Calendar + date, Clock + reading time (12.5px `#94a3b8`); H1 `clamp(28px,4.2vw,46px)` 800; summary `clamp(16px,2.2vw,19px)` `#94a3b8` max 680px; byline row above a hairline — 36px SM tile (blue→teal gradient, radius 10px, "SM" 12.5px/800) + "Shane McCaw" 14px/700 + "Lead M365 Architect at NASA · 30 years in the Microsoft ecosystem" 12.5px.
- **Body** (markdown → components): base 17px/1.75 `#cbd5e1`. `h2` `clamp(22px,3vw,27px)` 700 `#f8fafc` margin `44px 0 14px`; `h3` 19px 700 margin `32px 0 10px`; `p` margin-bottom 20px; `strong` 600 `#f8fafc`; `ul` no bullets, 10px gap, each `li` flex with a 6px teal dot (`margin-top:11px`) — or, when the item starts with "N. ", a Menlo 12px teal two-digit number instead of the dot; `blockquote` → card with teal border `rgba(0,180,216,.3)`, fill `.06`, radius 16px, padding `22px 26px`, Quote glyph 22px at 60% teal, text 16.5px/500 `#f1f5f9`; `hr` hairline; a closing italic line renders 14.5px italic `#94a3b8`.
- No assessment CTA or personalized nudge below the body: the live site's "Take the Free … Assessment" cards (`ArticleAssessmentCTA.tsx`, `ArticlePersonalizedNudge.tsx`) are removed in this design.
- **Author bio** card (radius 20px, margin-top 56px): 64px SM tile (radius 18px, 22px/800), eyebrow "About the Author", "Shane McCaw" 21px/800, "Lead Microsoft 365 Architect · NASA" 14px/600 teal, bio paragraph (verbatim from `AuthorBio.tsx`), "Book a Free Discovery Call" gradient md button with CalendarDays icon → Contact.
- **Footer row**: "← More articles" + Share: LinkedIn, X (glass pills, 12.5px/600, padding `10px 14px`, radius 9px, hover teal border) and "Copy link" → "Copied!" (green `#4ADE80`) for 2s.
- **Consultation CTA**: full-bleed; radial glow `radial-gradient(ellipse 70% 60% at 50% 50%, rgba(0,120,212,.16), transparent 75%)` + 40px grid overlay at 4% opacity; centered eyebrow "Free 30-Minute Discovery Call", H2 "Your Microsoft 365 Environment Deserves Senior Expertise", paragraph, "Book a Consultation" (gradient, 56px, padding 0 40px), "No pitch. No obligation. Just clarity."
- Article data: the seven published `.md` files in `src/content/articles`, frontmatter-driven; reading time = words / 200.

### 7. Solutions index — `Solutions.dc.html`
Hero (eyebrow "Solutions · Eight Deep Dives", H1 "Pick the part of the tenant that is keeping you up. Shane has run it at NASA scale."). Grid `minmax(min(100%,300px),1fr)` of eight link cards: icon tile in the topic accent, uppercase topic label in the accent, 19px/700 headline, 14px excerpt, "{Topic} deep dive →". The Copilot card is highlighted (violet border `rgba(139,92,246,.3)`, blue→violet gradient fill). Then the shared "How working with Shane goes" four-step section and the "Bring the decision. Leave with the answer." close panel.

Topic accents: Copilot `#38bdf8` (Sparkles) · Security `#a78bfa` (Shield) · Governance `#60a5fa` (Share2) · SharePoint `#22d3ee` (Layers) · Power Platform `#f59e0b` (Zap) · Teams `#818cf8` (Users) · Migration `#fb7185` (ArrowLeftRight) · M365 Health `#4ADE80` (Activity).

### 8–15. Solution pages — `Solution - *.dc.html` (eight files)
One route per topic (`/solutions/copilot`, `/solutions/security`, `/solutions/governance`, `/solutions/sharepoint`, `/solutions/power-platform`, `/solutions/teams`, `/solutions/migration`, `/solutions/health`). Identical layout, topic-specific copy and accent (all copy lives in the `TOPICS` array inside any of these files):
- **Hero**: eyebrow "Deep dive · {Label}"; H1 in two parts, second part in the topic accent (Copilot uses a blue→violet gradient text); lead + sub paragraphs; CTAs "Work with Shane on this · from $900/mo →" + "Talk to Shane first"; check row "Read-only review, run by Shane · Nothing installed · NASA contractors and partners excluded". Right: "What Shane's review typically finds" panel (tinted in the accent) with three metric rows — label, bold value, 10px progress bar (blue `#60a5fa`, amber `#fbbf24`, red `#f87171`), sub-line — and a closing note. Header label "Illustrative, not your tenant".
- **Two paths** (`background:rgba(15,23,42,.4)`): eyebrow + H2 + lead; two timeline cards — "How it usually goes" (red pill, hollow grey dots, red end dot) and "How it goes with Shane" (teal pill, blue dots, teal end dot); 11px dots joined by 1px lines, 14px/700 titles, 13px bodies.
- **The work, by name**: H2 per topic, standing paragraph about advisory hours vs fixed-price SOWs, three or four project cards (name 15px/700, body 13px, uppercase teal "when" label above a hairline).
- **Deep dive switcher**: rounded bar with "← All solutions" (10px uppercase) and eight `white-space:nowrap` pills (9px 14px, 12px; active = teal border/fill, inactive = hairline, hover teal border).
- Shared "How working with Shane goes" and close panel ("Bring the {topic} decision. Leave with the answer.").

## Interactions & Behavior

- Header dropdown toggles on click; mobile menu toggles on hamburger; both close on resize across the 1024px breakpoint.
- Hover transitions 150–300ms on color/border/transform; card lift `translateY(-3px)`; no bounces or parallax outside the Assessment page.
- Forms validate on submit (Contact: name, email, message required; Resources lead magnet: name + regex email, button disabled until valid). Show the spinner state while the request is in flight, then the success state in place. Errors: inline red line, never an alert.
- Retainer checkout: only one tier expanded; expanding scrolls that row into view (96px offset); processing → done states as above.
- Copy link uses `navigator.clipboard.writeText`, shows "Copied!" for 2000ms.
- Solutions switcher, Resources category pills and Contact chips are single-select.
- Responsive: fluid containers (`max-width` 1160/1280 with `clamp()` padding); every multi-column layout uses `repeat(auto-fit, minmax(min(100%, Npx), 1fr))` or flex-wrap so it stacks under ~400px columns; `overflow-x:hidden` on body; tap targets ≥ 40–44px; inputs 16px under 1024px.

## State Management

- Header: `narrow` (viewport < 1024), `menuOpen`, `solOpen`.
- Work With Me: `openTier` (slug | null), per-tier payment state `idle | processing | done`, contact form state `idle | sending | sent`.
- Contact: form state `idle | sending | sent`, `interest` (chip), `error` flag.
- Resources: `cat` ("All" | category), `query`, lead form fields + `idle | sending | sent`; `showFeatured = cat === "All" && !query && results.length`.
- Article: current slug (route param), `copied` flag.
- Solution pages: pinned topic per route; no client switching.

## Design Tokens

Colors — canvas `#020617`; surfaces `rgba(15,23,42,.4/.5/.6)`, `rgba(2,6,23,.55)`; hairlines `rgba(30,41,59,.8/.9)`, `rgba(148,163,184,.2–.3)`; text `#f8fafc` (headings), `#f1f5f9`, `#e2e8f0`, `#cbd5e1` (body), `#94a3b8` (secondary), `#B5B5BC` (chrome), `#64748b` (placeholder); Deep Navy `#0A2540`; Electric Blue `#0078D4` (hover `#005A9E`); Bright Teal `#00B4D8` (hover `#5ed2ea`); blue-500 `#3b82f6`, blue-400 `#60a5fa`, violet `#8b5cf6` / `#a78bfa`; signal accents `#38bdf8 #22d3ee #2dd4bf #f59e0b #fbbf24 #fb923c #f87171 #fb7185 #818cf8 #4ADE80 #D1D5DB`.

Type — Inter 400/500/600/700/800 (body 14–17px, line-height 1.5–1.75); Space Grotesk 600/700 for the wordmark only; Menlo/ui-monospace 11–13px for indices and dates. Headings `letter-spacing:-.02 to -.028em`; eyebrows uppercase `.14–.18em`.

Spacing — 4px base; section padding `clamp(40px,6vw,64px)` to `clamp(56px,9vw,104px)`; grid gaps 14–16px (cards), `clamp(24px,4vw,64px)` (two-column sections); containers 800 (article), 940 (close panels), 1160 (content), 1280 (chrome).

Radii — 8px nav links, 9–10px inputs/buttons, 12px tiles and lg buttons, 16px cards, 18–20px panels, 24px CTA blocks, 999px pills.

Shadows — hairline borders do the work; violet glow `0 0 60px rgba(139,92,246,.13)`; focus ring `0 0 0 3px rgba(0,120,212,.25)`.

## Assets

- Icons: Lucide (`lucide-react`) — ShieldCheck, ArrowRight, ArrowLeft, Check, CheckCircle2, ChevronDown, Menu, Search, Tag, Calendar, CalendarDays, Clock, MapPin, Mail, ShieldAlert, Sparkles, Shield, Share2, Layers, Zap, Users, ArrowLeftRight, Activity, FileCheck, CircleDollarSign, Lock, Loader2, Link2, MessageSquare, Quote, Download, LayoutGrid. LinkedIn and X glyphs from `react-icons`.
- No photography. Decorative hero glyphs are oversized Lucide icons.
- Fonts: Inter (already in the codebase), Space Grotesk 500/700 via Google Fonts.
- Brand mark: gradient ShieldCheck tile described above (replaces the flat "SM" favicon tile in the header).

## Screenshots

Viewport captures of every page at the preview width (top of page; scroll states and mobile are described above), in `screenshots/`:

- `01-work-with-me.jpg`, `02-contact.jpg`, `03-about-shane.jpg`, `04-assessment.jpg`, `05-resources.jpg`, `06-article.jpg`, `07-solutions-index.jpg`
- `08-solution-copilot-ai.jpg` through `15-solution-m365-health.jpg` (one per solution page)

Open the matching `.dc.html` file for the full page, hover states, and the form / checkout states.

## Files

- `Work With Me.dc.html`, `Contact.dc.html`, `About Shane.dc.html`, `Assessment.dc.html`, `Resources.dc.html`, `Article.dc.html`, `Solutions.dc.html`
- `Solution - Copilot AI.dc.html`, `Solution - Security Compliance.dc.html`, `Solution - Governance.dc.html`, `Solution - SharePoint.dc.html`, `Solution - Power Platform.dc.html`, `Solution - Teams.dc.html`, `Solution - Migration.dc.html`, `Solution - M365 Health.dc.html`
- `github.md` — screen → source-file map; `CLAUDE.md` — project rules (no email on the site)
- `screenshots/` — one capture per page
- `support.js`, `_ds/` — prototype runtime and token CSS (reference only, not to be shipped)
