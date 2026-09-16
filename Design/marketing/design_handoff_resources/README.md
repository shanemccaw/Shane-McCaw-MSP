# Resources & Article pages — change pack

Date: 15 September 2026
Project: MARKETING HOME
Design system: Shane McCaw MSP Design System

## What's in this pack

- `files/` — the four Design Components touched, plus `support.js` (the runtime).
  Drop them into the project root to reproduce this state.
- `screenshots/` — rendered captures of both new pages.

## New pages

### Marketing Resources.dc.html
The blog index, adapted from the `Resources.dc.html` design in the
Shane McCaw marketing-site project and rebuilt on this project's shell
(`Marketing Nav` / `Marketing Footer` via `dc-import`).

Sections, in order:
1. Hero — "Resources & Field Notes" eyebrow, headline, positioning paragraph.
2. Featured article — latest post with a published / reading time / author rail.
   Hidden automatically when a filter or search is active.
3. Browse — search field plus category pills with live counts, and a responsive
   card grid. Each card carries category, title, summary, date, reading time,
   LinkedIn and X share links, and a Read More link.
4. What gets published here — the two-track explainer (Tactical guides, Field notes).
5. Go deeper — Copilot Readiness Checklist lead capture with idle / sending / sent states.
6. Closing CTA — Book a Consultation.

All seven articles carry the frontmatter verbatim from the source design
(title, category, summary, date, reading time).

### Marketing Article.dc.html
The article template all seven slugs resolve to.

- Reads `?slug=` from the URL; falls back to the `slug` tweak, then to the newest article.
- Header with category badge, date, reading time, title, summary, and a back link.
- Sticky "On this page" table of contents, hidden below 980px.
- Body renders three block types: paragraphs, bulleted lists, and highlighted callouts.
- Author block (Shane McCaw, Lead M365 Architect at NASA) with a LinkedIn / X share row.
- "Keep reading" — three related articles, same category first.
- Closing CTA matching the index page.

Full written body content exists for all seven articles.

## Edits to shared components

### Marketing Nav.dc.html
- Added a `resources` nav item pointing at `Marketing Resources.dc.html`.
- Tightened link padding (7px 8px to 7px 6px) and font size (12px to 11.5px) so
  seven top-level items stay on a single 58px row at preview widths.

### Marketing Footer.dc.html
- Added a Resources link to the Company column.

## Fixes applied during review

- `white-space:nowrap` on category badges, filter pills and the
  "Book a Consultation" CTA, which were breaking mid-phrase inside their capsules.
- Article links repointed from a placeholder anchor to
  `Marketing Article.dc.html?slug=<slug>`.

## Open items

- The lead-capture form on the Resources page simulates submission (1.4s, then a
  success message). It is not wired to a mailing list or file delivery.
- Share counts from the source design's `/api/shares` were dropped; share links
  are live, counts are not displayed.
- Terms and Privacy links in the footer still point at `/terms` and `/privacy`.
