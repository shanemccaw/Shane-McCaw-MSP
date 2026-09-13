repo: shanemccaw/Shane-McCaw-MSP
branch: main
path: artifacts/shane-mccaw-consulting

## Last sync
date: 2026-08-21T17:56:02Z
commit: b2ad875638da

### Updated in this project
- The site's primary section is now "What We Watch": six pillar pages (Governance, Security, Compliance, Licensing, Adoption, Health) matching the portal's PILLARS, each a data-story page grounded in real portal modules (Ownership/RACI, Change Control, Risk Register, PII Governance, Microsoft Changes, Active Runbooks, Remediation Tracker, Policy Decisions, My Architect) and selling monitoring + retainer → SOW. The old Security & Compliance solutions page became `Marketing Pillar - Security.dc.html` (evidence section moved to the Compliance pillar); the 8 workload pages remain as deep-dives linked from pillar pages and the nav dropdown.
- Assessments and the Copilot quiz were removed from the public site at the user's direction (the free scan carries that job now): both pages deleted, and every nav/footer/home/pricing/monitoring/pack reference re-pointed at the free scan. The funnel is now Free scan → priced SOW → chosen phases → Portal.
- All 8 Solutions pages are now full standalone flagship pages recreating `/projects/:slug` (SolutionTopicPage.tsx expanded structure + the flagship layer rolled out to all 8 topics in `solutionsTopics.ts`): per-topic claim headings, animated 5-stage How-It-Works showcase (incl. Migration's remapped gate sequence and M365 Health's 7-pillar scan), portal preview with all 7 pillar rings, per-topic drift-trend / license-scatter / surface-radar panels, and the funnel explainer. Copy taken verbatim from `solutionsTopics.ts`; each page carries its own title + meta description.
- The shared slug-filtered `Solution Topic` template and its data file were removed — every topic is its own page now.
- Non-Copilot quiz CTAs route to the Free Scan instead (those topic quizzes are intentionally not built, per earlier product decision); doc-products blocks stay omitted per the user's earlier request.

## Sync history
- 2026-08-21T16:22:54Z — Copilot solution page rebuilt as a full recreation of `/projects/copilot` (SolutionTopicPage.tsx + copilot flagship): every section, the animated 5-stage HowItWorksShowcase, illustrative Portal preview with all 7 pillar rings, surface radar, "Projects We Can Scope for You", and the funnel explainer. Solutions dropdown + 8 topic pages sourced from `src/data/solutionsTopics.ts`. Monitoring pricing rebuilt to the real catalog structure. "Ask Shane" chat bubble added to the marketing footer.
- 2026-08-21T04:56:52Z — Rebuilt the marketing website as 6 real pages (Home, Monitoring, Quick-Start Packs, Retainers, Assessments, Pricing), grounded in the real funnel model (Quiz → Assessment → Project → Retainer), real Monitoring engines/pricing mechanics, real Quick-Start Pack catalog, and real Copilot Readiness pillar stats — copy rewritten in the same honest voice, not copied verbatim. Non-Copilot assessment quizzes intentionally excluded per product decision. Visual theme matches this project's Customer Portal Shell dark palette.

## Screen map
| Project screen | Repo files |
|---|---|
| Marketing Home.dc.html | src/pages/Home.tsx, src/pages/Pricing.tsx (funnel model) |
| Marketing Monitoring.dc.html | src/pages/Monitoring.tsx |
| Marketing Quick-Start Packs.dc.html | src/pages/Products.tsx |
| Marketing Retainers.dc.html | src/pages/retainers/RetainersOverview.tsx |
| Marketing Pricing.dc.html | src/pages/Pricing.tsx |
| Marketing Solutions - Copilot.dc.html | src/data/solutionsTopics.ts (copilot), src/pages/solutions/SolutionTopicPage.tsx, src/components/design-system/HowItWorksShowcase.tsx |
| Marketing Pillar - Security.dc.html (+ 5 sibling pillar pages) | Customer Portal Shell PILLARS + module nav; src/data/solutionsTopics.ts (security-compliance) |
| Marketing Solutions - Governance.dc.html | src/data/solutionsTopics.ts (governance), src/pages/solutions/SolutionTopicPage.tsx |
| Marketing Solutions - SharePoint.dc.html | src/data/solutionsTopics.ts (sharepoint), src/pages/solutions/SolutionTopicPage.tsx |
| Marketing Solutions - Teams.dc.html | src/data/solutionsTopics.ts (teams), src/pages/solutions/SolutionTopicPage.tsx |
| Marketing Solutions - Power Platform.dc.html | src/data/solutionsTopics.ts (power-platform), src/pages/solutions/SolutionTopicPage.tsx |
| Marketing Solutions - Migration.dc.html | src/data/solutionsTopics.ts (migration), src/pages/solutions/SolutionTopicPage.tsx |
| Marketing Solutions - M365 Health.dc.html | src/data/solutionsTopics.ts (m365-health), src/pages/solutions/SolutionTopicPage.tsx |
