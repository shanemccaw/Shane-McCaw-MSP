repo: shanemccaw/Shane-McCaw-MSP
branch: main
path: artifacts/shane-mccaw-consulting

## Last sync
date: 2026-09-05T21:52:00Z

### Updated in this project
- Each of the 8 solution deep dives is now its own page (Solution - *.dc.html); Solutions.dc.html is the index that links to them
- Header dropdown, mobile menu, footer and all in-page solution links repointed from Solutions.dc.html#topic to the standalone pages

## Sync history
- 2026-09-05T21:44:54Z — Article page built from ArticlePage.tsx with all 7 article bodies verbatim; Resources cards link to Article.dc.html?slug=…
- 2026-09-05T21:33:10Z — Contact page built as its own screen (form + what-happens-next flow); no email address displayed anywhere on the site; all Contact links repointed to Contact.dc.html
- 2026-09-05T18:46:11Z — Resources page built from the live Resources.tsx copy (verbatim) and the 7 published article frontmatters; category order and reading-time formula from content/articles/README.md and data/articles.ts; Solutions deep dives mapped to catalog project rows (PRODUCT_CATALOG.md §7), unpriced
- 2026-09-05T17:19:07Z — retainer pricing verified (services row 168, $900/mo, 5 hrs/mo); Copilot Assessment landing read as visual reference; StripePaymentElement checkout confirmed

## Screen map
| Screen | Repo files |
|---|---|
| Work With Me page | artifacts/shane-mccaw-consulting/src/pages/CopilotAssessmentLanding.tsx, artifacts/shane-mccaw-consulting/src/pages/home/dsComponents.tsx, artifacts/shane-mccaw-consulting/src/components/Header.tsx, artifacts/shane-mccaw-consulting/src/components/Footer.tsx, artifacts/shane-mccaw-consulting/src/pages/retainers/RetainersOverview.tsx, PRODUCT_CATALOG.md |
| Solutions index + 8 solution pages (Solution - *.dc.html) | artifacts/shane-mccaw-consulting/src/pages/home/quizData.ts, PRODUCT_CATALOG.md |
| Assessment page | (imported from the live Copilot Readiness design; header/footer from Header.tsx, Footer.tsx) |
| Resources page | artifacts/shane-mccaw-consulting/src/pages/Resources.tsx, artifacts/shane-mccaw-consulting/src/data/articles.ts, artifacts/shane-mccaw-consulting/src/content/articles/*.md |
| Contact page | artifacts/shane-mccaw-consulting/src/pages/Contact.tsx, artifacts/shane-mccaw-consulting/src/components/ConsultationCTA.tsx, artifacts/shane-mccaw-consulting/src/pages/Privacy.tsx, artifacts/shane-mccaw-consulting/src/components/Header.tsx, artifacts/shane-mccaw-consulting/src/components/Footer.tsx |
| Article page | artifacts/shane-mccaw-consulting/src/pages/ArticlePage.tsx, artifacts/shane-mccaw-consulting/src/components/AuthorBio.tsx, artifacts/shane-mccaw-consulting/src/components/ArticleAssessmentCTA.tsx, artifacts/shane-mccaw-consulting/src/components/ArticlePersonalizedNudge.tsx, artifacts/shane-mccaw-consulting/src/components/ConsultationCTA.tsx, artifacts/shane-mccaw-consulting/src/content/articles/*.md |
