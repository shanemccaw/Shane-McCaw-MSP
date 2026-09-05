# Resources Page — Contract Pack

**Purpose:** Real content/design brief for Claude Design to build the Resources page
in the new marketing design system (Epic #1093 rebuild). This page has no design
today — it exists only in the old site's visual language. **Functionality is not
changing.** This is a design pass on an already-real, already-working page, not a
rescoping of what it does.

**Status:** Design pending. No `Design/marketing/resources/` export exists yet —
per the same rule already in force for Portal (`Design/portal/`): **no export = no
design, full stop.** Nothing gets built against this page until a real export lands
in that folder.

---

## 1. What this page is

The site's content hub: tactical M365/Copilot guides and Shane's field notes,
filterable by category, with a lead-magnet download and a soft consult CTA. It
reinforces NASA-authority positioning through the byline/bio framing around the
content, not through the article prose itself.

It is not part of the original 23-page rebuild list (#1185–#1197) — it's new scope,
added because the real, live page has never had a design pass in the new system.

---

## 2. Real mechanics — confirmed live, carrying over unchanged

Audited directly against `artifacts/shane-mccaw-consulting` on `main` before writing
this pack (Build Queue Method §3.1):

- **Category filter tabs**, 5 locked categories + "All" (exact names, case-sensitive,
  governed by `src/content/articles/README.md`):
  - Copilot AI Tips
  - M365 Best Practices
  - Power Platform How-Tos
  - Governance & Compliance
  - Digital Transformation
- **Search box** — substring match across title/summary/category
- **Featured-article slot** — newest article gets a large hero treatment, but only
  in the default view (no active filter, no search query); any filter or search
  switches to a plain results grid
- **Per-article card** — title, summary, date, reading time, LinkedIn/X share
  buttons with live share counts, "Read More"
- **Lead magnet** — name + work email form → downloads "M365 Copilot Readiness
  Checklist" PDF, posts to real `/api/leads`
- **Closing CTA** — 30-minute discovery call, NASA/30-years line

**Real backend already wired — do not treat any of this as needing new endpoints:**
- `routes/leads.ts` — lead capture
- `routes/shares.ts` — share counting
- `routes/downloads.ts` — download tracking
- `src/content/articles/*.md` — 8 real published articles, frontmatter-driven
  (`slug`, `category`, `title`, `summary`, `date`), no code change needed to publish
  a new one

---

## 3. Explicitly NOT in scope for this pass

- No new article content — the 8 existing articles carry over as-is
- No new categories — the 5 are locked by the README; changing them is a separate,
  future decision, not part of this design pass
- No backend changes — leads/shares/downloads endpoints are real and untouched
- No new lead-magnet asset — same Copilot Readiness Checklist PDF

---

## 4. Tone

Per `authority-voice-and-product.md` — but flagging a real, existing inconsistency
rather than silently resolving it: the live copy on this page today ("written from
the field," "field notes") reads noticeably warmer/more casual than the elite-
authority register used on the rest of the site.

Open question for Shane, not yet decided: does Resources keep a slightly warmer
register as the one deliberately-human page on the site, or does it get pulled into
the same NASA-authority tone as everywhere else? Design should proceed with the
existing (warmer) copy verbatim either way for this pass — a tone change is copy
work, not a design-system decision, and copy is not being touched here.

---

## 5. What Claude Design needs to produce

A real export at `Design/marketing/resources/` (subfolder name matches whatever
Claude Design's own convention is, same pattern as
`Design/portal/design_handoff_ui_shell/`), covering:

- Category filter tab treatment (5 + All)
- Search input
- Featured-article hero module
- Standard article card (grid)
- Lead-magnet panel
- Closing CTA panel

All against the new design tokens (deep navy `#0A2540`, electric blue `#0078D4`,
bright teal `#00B4D8`, dark canvas `#020617`) and the same shared Nav/Footer already
built in Part 0 of the marketing rebuild.

---

## 6. Build sequencing (once export lands)

Follows the same phase discipline as every other Portal/Marketing design-gated
Feature: no wire-up issue gets filed until the real export exists in
`Design/marketing/resources/`. When it lands, file the build issue then — not
before.
