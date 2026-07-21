# Public Website Rebuild — Reference Doc (v2)

Supersedes `MSP_Website_Rebuild_Spec_v1.docx` in full. Built from ground-truth codebase audits (Fable + Sonnet 4.6 Thinking passes, July 2026), not assumption. This document is the single source of truth for the rebuild going forward.

---

## 1. Revenue hierarchy

1. **Monitoring subscription — the hero, the core business.** Recurring. Everything else feeds it.
2. **Assessment (free/paid)** — the qualifying mechanism. Real, consent-gated tenant scan. Produces the findings that make Monitoring the obvious next step.
3. **Quick-Start Packs / Products** — two types. **Proactive configuration packs** ("build your tenant," baseline apply, break-glass credential delivery — via a separate in-progress Graph API write-back capability) sell standalone on the site, no prerequisite scan; conversion to Monitoring is the hoped-for follow-on, not the trigger. **Signal-triggered packs** (from real scan findings) generate and check out through the Portal's Sales Offer Engine — but the website itself should still recognize a known lead's pain points (from quiz/assessment history) and emphasize the relevant proactive pack accordingly. See §3, Personalization.
4. **Retainer / Fractional Consulting** — SEO-indexable page + own order flow, but the real conversion path is mostly existing Monitoring customers upgrading, not cold traffic.
5. **Quiz** — free, self-report lead magnet. Demoted to a recovery/SEO-feeder role, not a primary nav destination.

Primary funnel logic: **Assessment is pushed first everywhere.** If a visitor won't commit to consent, route to Quiz instead. Quiz results route back into Assessment or Monitoring.

---

## 2. Funnels (verified against real mechanisms)

| Funnel | Steps | Verified mechanism |
|---|---|---|
| **Quiz** (free, self-report) | AI-conversational questions → Lead Gen (results/PDF/upsell CTA) | Real — AI-scored 5 dimensions, gated on email, PDF via Graph email |
| **Assessment — Free** | Lead Gen → Consent → full real scan (limited doc delivered) → Account Creation → Portal | Real — Graph-based diagnostics, same depth as paid, deliberately limited output document |
| **Assessment — Paid** | Lead Gen → Consent → full real scan → Stripe → Account Creation → Portal | Same mechanism as Free, gated by payment |
| **Monitoring** (3 tiers) | Lead Capture → Consent → Stripe → Account Creation → Portal | Real — catalog-driven tiers. **Correction: per-seat pricing is not blocked, just lives somewhere other than where an earlier audit looked.** `services.price`/`services.base_price` are correctly `null` on Monitoring tier rows — real pricing lives in `services.typeAttributes` (jsonb, shape validated by `productTypeConfig.ts`): `tenantTierLabel`, `seatMin`/`seatMax`, `seatCountFloor` (minimum billable seats even if actual seat count is lower), `pricePerUserMonth`, `flatMonthlySurcharge`, `includedEngines`/`includedFeatures`, `minMspPlanTier`. Pricing display and checkout must compute `pricePerUserMonth × max(actualSeats, seatCountFloor) + flatMonthlySurcharge` — no schema rebuild needed, this mechanism already exists and is purpose-built for exactly this. Don't defer per-seat pricing display waiting on work that isn't necessary. |
| **Quick-Start Packs / other products** | Lead Capture → Consent → Stripe → Account Creation → Portal | Catalog-driven. Two product types: (a) **proactive "build your tenant" configuration packs** (baseline apply, break-glass account delivery, via a separate in-progress Graph API write-back capability) — sold standalone on the public site, no prerequisite scan; (b) **signal-triggered packs from real diagnostic findings** — offer *generation and checkout* is genuinely Portal-side (Sales Offer Engine, needs live tenant scan data) and stays out of website scope. **However:** the website itself should be identity-aware and dynamic, not static/anonymous-only. Real, already-verified infrastructure supports this — the checkout gate already detects existing client sessions and redirects toward Portal; quiz submissions persist real pain points/maturity/engagement/urgency signals per lead; client-side analytics (`identifyLead`, session + intent tracking) already ties behavior to a known lead over time. The public site should use this to reshape what a *recognized* visitor sees — different hero messaging, highlighted packs matched to their quiz pain points, a "welcome back, here's what we found" moment for anyone with an in-progress Assessment — without duplicating the Portal's actual offer-generation/checkout mechanism. |
| **MSP** (3 tiers) | Free/White-Glove Onboarding → MSA/DPA (MSP Partner ToS + Data Processing Agreement) → Checkout → Account Creation → Portal | Real, confirmed live on current checkout template |

All funnels converge on the same backbone: **Payment → Account Creation → Portal handoff.** Consent gates any funnel touching real tenant data; MSA/DPA gates the MSP relationship itself (contractual, not tenant-technical).

**Confirmed autonomous proof points** (safe to market):
- MSP-Portal public share-link SOW sign → charge fires immediately, no human gate (`msp-sow.ts`)
- CRM presentation sign → Stripe → webhook → `agreement_signed`, no human gate (legacy path — confirm MSP-Portal parity before using this specific example; CRM is being deprecated)
- Real platform-level trust story: tenant isolation enforced (not just claimed), read-only impersonation, explainable scoring lineage, exception tracking, idempotent operations, testbed isolation for all simulation

**To-verify, not yet claimable:**
- Graph API write-back capability (powers proactive Quick-Start config packs: baseline apply, break-glass credential delivery) — in progress in a separate chat, not yet confirmed live. Products page copy for proactive packs should not overclaim until this lands.
- "Generate Campaign from Current Events" workflow — confirmed to exist in DB (`wf_definitions` id 887), trigger/run status/output unconfirmed
- Self-serve MSP signup provisioning — known metadata-key bug, must be fixed before launch
- MSA/DPA-signing step in self-serve MSP flow — confirmed present on current template, not yet re-verified post-rebuild

---

## 3. Personalization — the site sells what we already found

This is not a single page and not a minor content tweak — it's a property of the entire site. Every relevant page should be able to say to a recognized visitor: **"here's your real score for this exact thing, and here's what closes the gap"** — right there on the page they're already looking at, not a separate dashboard they have to go find. The pitch is direct: we already know what you need better than you know your own tenant.

**Account requirement, clarified:** Assessment (free or paid) always requires an account — no exception. **Quiz is the only funnel in the entire site that does not require login.** This changes the recognition mechanism:
- **Assessment visitors:** always have an account by the time results exist. Personalized pages (§4 Solutions/Topic pages) are primarily **login-gated** — real session, not a workaround. A tokenized magic-link in the results-delivery email is a nice-to-have convenience (click straight in from email, get logged in), not the load-bearing mechanism.
- **Quiz-only visitors (no account):** the only real anonymous-recognition problem on the site. Use a cookie-based session ID (same imperfect-but-useful pattern as ad retargeting — persists until cleared, good enough for this purpose) to tie browsing behavior, time-on-site, and services viewed back to the same visitor across return trips, feeding both quiz-pain-point personalization and the engagement-based auto-bundle trigger below, even before they've committed to anything.

**What this requires, mapped to what's already real:**
- **Real stats to show:** the scan itself is real (Graph-based diagnostics, same engine whether free or paid) — the website surfaces a subset of the same findings already computed, not a re-scan or a fake summary
- **Real offers to show (Assessment tier):** offers are genuinely generated by the Sales Offer Engine from those findings — the website *displays* that already-computed output; it does not duplicate the generation logic itself, which stays Portal/engine-side
- **Also real and reusable:** the checkout gate's existing-session detection, and quiz-derived pain points/maturity/engagement/urgency signals — both still apply for visitors who *are* logged in or have quiz history without a full Assessment yet
- **REAL — Lead Offer Engine (quiz-tier personalization, landed):** `POST /quiz/submit` synchronously computes an offer right after the lead is saved — category scores → inferred product signals (with confidence) → matched rule groups → scored candidates → AI-determined discount, hard-capped server-side. `GET /quiz/results/:leadId` returns it as `leadOffer` — up to 3 candidates, already sorted by relevance, with `adjustedPriceCents` pre-clamped and ready to display as-is, and `rationale` already written in "based on what you told us" tone matching the confidence-tier rule below. `null` means no offer generated (silent, doesn't fail the quiz submission) — the frontend must handle that state, not assume an offer always exists. **This is a fully separate system from the Sales Offer Engine** — zero shared code, deliberately isolated, matching the confidence-tier split already in this doc. Don't re-verify or restate its output as more certain than the rationale text already implies.
- **Partially real, needs a decision:** general quiz-driven cross-page inference (category scores → product signals with confidence) is what the Lead Offer Engine actually does — confirmed real. **Not confirmed:** specific open-text buying-signal inference (detecting "my CEO said so" style organizational context from free-text answers and reshaping the pitch toward the actual decision-maker). The landed engine works off category *scores*, not free-text parsing — don't assume this specific sub-feature exists until it's explicitly verified against the engine's actual inputs.
- **REAL but incomplete — Engagement Offer Engine (the auto-bundling mechanism):** checks distinct-pages-viewed + a self-computed intent score within a time window. When a rule's thresholds are crossed, it already computes `discountPct` and `eligibleServiceIds` — the actual bundle-and-discount decision is real. It fires a named workflow event (`emitWorkflowEvent`) — **both consumption paths are confirmed in scope, not either/or:**
  1. **Delayed follow-up workflow — specified, to build in the engine chat, not here:** the missing workflow that consumes the emitted event should queue the offer as an email/in-app follow-up **1–2 hours after the visitor has left the site**, not immediately — reads as a genuine follow-up nudge, not a chase. This is the recovery path for anyone who didn't convert in-session; it's what makes the 15-min cron's off-session backstop actually useful (currently pointless without a consumer). Mechanically: SQL Query Node pulls the lead's real session end time; Delay Node pauses until (session end + 2 hours) — not 2 hours from event-fire time, since the triggering event can fire mid-session.
   **Companion guard workflow, also specified:** a second workflow listens for a real purchase/checkout-completion event; if the purchased item overlaps the pending follow-up's `eligibleServiceIds` for that same lead, it cancels the in-flight delayed-follow-up run so an offer never goes out for something already bought. Needs confirming: whether the Workflow Engine supports cancelling an in-flight run by ID — not confirmed by either audit — and the exact real event name for purchase completion, not guessed.
  2. **Live page-load query (website-side, this rebuild):** while a recognized visitor is still actively browsing, the site queries current engagement-offer eligibility and renders the bundle directly on the page — real-time "show me right now" upsell, encouraging quick deals in-session rather than waiting for email. This is what actually delivers the in-session "the site's paying attention" feeling from §3's thesis.
  Emit the event either way; both consumers should exist.
  **✅ RESOLVED — timing:** the 15-minute batch interval is no longer the only trigger. A synchronous call to `evaluateEngagementOfferForLead()` now runs inside `maybeFireIntentEvent`/`maybeFireCtaFormIntentEvent` in `analytics.ts`, firing immediately whenever a new qualifying intent event is recorded for an identified lead. The 15-minute cron remains as an off-session backstop (catches leads who left before triggering anything, useful for email follow-up), but the in-session reaction is now real and immediate, matching the site's "pays attention right now" thesis. No further action needed on this point.

**Confidence tiers, important for copy tone:** cold visitor (no data) → generic marketing. Quiz-only visitor (self-reported, 5 questions, inferred) → "based on what you told us" framing, softer, offer to scope further. Assessment-verified visitor (real Graph-based scan) → state the number as fact, no hedging. Don't let quiz-tier inference talk with Assessment-tier certainty — it isn't verified yet, and shouldn't sound like it is.

**Headlines themselves are part of this, not just body copy.** Example, same page, three states:
- Cold: "Most Copilot deployments fail. Yours doesn't have to."
- Quiz-inferred: "Complete your Copilot Readiness with a custom-tailored plan — here's what we think you need."
- Assessment-verified, paid tier: the real score, the real gap, and — critically — **the actual scoped phases and price already sitting in their real project SOW/presentation**, with a direct click-through link into it. Not a generic "get a quote" CTA — the real priced deliverable they already have, one click from where they're standing. The presentation flow is currently being migrated into MSP-Portal (in flight, separate chat) — link this to the Portal-native presentation once that work lands; don't build against the CRM version, it's being retired.

**The thesis, in one line:** when we know someone, the site shouldn't read like it's still fishing for them — it should read like Shane is actually in the room talking to them. Every mechanism above is in service of that one feeling, not personalization for its own sake.

---

## 4. Tracking — everything captured, first-party, in our own DB

Ground rule: every mechanism in §3 runs on data. Full-path tracking isn't a reporting nice-to-have here — it's the fuel. If it's not tracked, it can't personalize, can't trigger the auto-bundle, can't feed the confidence tiers. This is infrastructure, not an add-on.

**Explicitly not in scope:** literal session replay / video-style screen recording (Hotjar/FullStory-style). What's wanted is complete, structured, queryable data — every page, every click, every dwell time, reconstructable as a full path — not a recording to watch.

**Already real, confirmed by audit (good foundation):**
- First-party Postgres tables already exist: `analytics_sessions`, `analytics_site_events`, `analytics_pageviews` — not a third-party SaaS, already yours
- Session continuity via `sessionStorage`, sent via `navigator.sendBeacon`
- Global click delegation tracks `outbound_click`, `cta_click` (tagged elements), `nav_click`, general `click`
- Named tracking functions already exist: `identifyLead`, `trackEvent`, `trackAssessmentStarted`
- Server-side intent scoring already weights events (`form_submit`, `reply`, `cta_click`, `site_visit`, `email_open`, `link_click`) into a hot-lead score — **now admin-configurable** (`lead_scoring_rules`, `lead_scoring_tracked_pages`, `lead_scoring_config`) rather than hardcoded constants; same API surface, no frontend impact, just tunable from Admin Panel now
- **REAL, backend expanded:** the event schema (`eventType` enum) now also supports form-field-level tracking (`form_viewed`, `form_started`, `form_abandoned`, `field_focus`, `field_blur`, `field_error`, `field_autofill_detected`), error/friction tracking (`error_404`, `error_js`, `error_api`, `broken_link_click`, `slow_page_load`, `form_submission_failed`), and lightweight behavioral events (`rage_click`, `dead_click`, `idle_timeout`) alongside the original 6 types. Most need no new backend schema — `analytics_site_events` already accepts arbitrary metadata `jsonb`, just correct frontend firing logic

**Old frontend tracking code — delete, don't port:** `artifacts/shane-mccaw-consulting/src/lib/analytics.ts` has a confirmed pre-existing bug (named conversion events firing `eventType` strings never in the backend's validated enum — silently rejected the whole time) and should be deleted entirely as part of this rebuild, not fixed or carried forward. Build the new site's tracking fresh against the updated schema from day one. The same general pattern (session-scoped, `sendBeacon()`-based delivery, event delegation over per-element listeners) is fine to keep as a *pattern* — just reimplemented cleanly, not copied file-for-file.

**Real gaps against "everything," still open:**
- `sessionStorage` expires on tab close — doesn't persist across return visits. §3 already calls for a durable cookie-based session ID for anonymous (Quiz-only) visitors; this is the same requirement, generalized to all tracking, not just personalization
- **Time-on-page / dwell time** — not yet confirmed as implemented, needed for the Engagement Offer Engine's intent-score input and for genuine "how long were they actually reading this" analysis
- **Scroll depth** — not yet confirmed as implemented
- **Full path reconstruction** (the literal sequence of pages a visitor moved through, not just isolated events) should be a first-class queryable view, not something reconstructed after the fact from scattered event rows
- **Multi-touch attribution** (joining a lead's sessions over time) still needs a new reporting query to be written — single-touch UTM/referrer capture already works today
- A/B testing infrastructure and session replay/heatmaps remain explicitly deferred to the later phase — confirmed still true, not built, not needed right now per earlier direction

**Build implication:** every page built in Stage 1 (Shell/Core) should wire into the tracking layer from day one — page view, dwell time, and scroll depth as base instrumentation on the shared layout, not bolted on per-page later. Everything stored first-party, queryable directly, no dependency on a third-party analytics platform for anything that matters to the business.

**Logging integration, non-negotiable — confirmed, not a guess:** every tracked event already flows through the platform's locked logging spine on the channel **`growth.website-analytics`** — already wired, nothing left to add on that front. Events are visible/queryable live in Admin Panel's existing Observability tooling, same as every other platform log line.

**Session replay — resolved:** in scope, but specifically as **recorded, reviewable-after-the-fact** session replay (understand where people land, click, drop off) — not live real-time observation of someone actively browsing. That distinction matters for what gets built: a recording/reconstruction system, not a live-viewer.

**Capture vs. visualization — both in scope for this project, sequenced not deferred:** raw event capture (rage_click, dead_click, idle_timeout, scroll/mouse position) starts day one, Stage 1 — schema's ready, just needs correct frontend firing logic. **The heatmap renderer and session-replay reconstruction player are also in scope for this rebuild — not pushed to a separate later effort — just sequenced as Stage 4**, built once there's real data and a working site to layer it onto, per the staged build order. This meaningfully expands Stage 4's scope beyond just the personalization/auto-bundling mechanics already listed there — worth knowing going in, not a small addition.

**Realistic sequencing:** the full taxonomy below is the target spec, not a Stage 1 checklist. Stage 1 covers the load-bearing basics (page views, navigation, CTAs, forms, funnel steps) plus raw event capture for behavioral/heatmap data. **Stage 4 (Differentiators/Features) now includes the heatmap renderer, session-replay reconstruction player, and A/B testing infrastructure** alongside personalization and auto-bundling — all part of this rebuild, just built last, on top of a working site with real data already banked.

### Full event taxonomy (target spec)

**Every page load:** URL, page title, referrer, UTM parameters, device type, browser, OS, screen resolution, language, time on page, scroll depth, bounce detection, exit intent, page load performance (LCP, FID, CLS), first/last interaction timestamp

**Every navigation action:** header/footer/sidebar menu clicks, mobile menu open/close + item clicks, breadcrumb clicks, logo click, back-button usage, internal/external link clicks, anchor jumps, pagination clicks, tab switches, accordion open/close, modal open/close

**Every CTA:** primary/secondary/tertiary clicks, hero/sticky-bar/pricing/feature/footer/blog/inline CTA clicks, hover events, visibility (did it appear on screen), conversion attribution

**Every form interaction:** viewed, started, completed, abandoned, field focus/blur/error/validation-failure, autofill detection, submit clicks, multi-step progress, conversion time, friction points. Forms covered: contact, demo request, newsletter signup, lead magnet download, trial signup, assessment request, support request, pricing inquiry

**Pricing & purchase intent:** pricing page views, monthly/yearly tab switches, plan/feature comparison interactions, expand-features clicks, add-ons clicks, upgrade/buy-now/start-trial clicks, cart interactions, coupon usage, payment attempt/failure/success

**Content engagement:** blog views/scroll depth/read time/share/CTA clicks, resource/PDF/whitepaper downloads, case study views, video play/pause/completion/watch %, podcast listens, image gallery interactions

**Search:** search bar usage, queries, result count, result clicks, abandonment, zero-result searches, autocomplete usage

**A/B testing & personalization:** variant exposure/performance, personalized content/CTA/banner exposure, geo-based and behavior-based personalization, return-visitor personalization

**Lead magnet & download:** download clicks/completions/failures, gated-content unlocks, email-capture conversions, lead magnet attribution

**Behavioral (recorded/reviewable, not live — see resolved decision above; deferred to later phase):** scroll depth at 25/50/75/100%, idle time, rage clicks, dead clicks, hover intent, mouse-movement/scroll/click heatmaps, session duration, session replay, multi-page session flow, new-vs-returning segmentation

**Component-level:** cards, feature blocks, testimonials, FAQ accordion, pricing comparison tables, feature tabs, product carousels, image sliders, video embeds, code blocks, interactive demos, embedded forms, embedded calculators

**Contact & support:** chat widget open, chat message sent, chatbot interactions, escalation, phone/email link clicks, support page views, support CTA clicks

**Location & attribution:** geo location, IP region, full UTM set (source/medium/campaign/term/content), first-touch/last-touch/multi-touch attribution, referral/social/paid-ad source

**Authentication (where login exists):** login page views/attempts/failures/success, MFA prompt/success/failure, password reset request/completion, account creation/deletion

**Error & friction:** 404s, 500s, JS errors, API errors, form validation errors, broken link clicks, slow page loads, failed downloads/video loads/form submissions

**Conversion funnel, with drop-off at every stage:** Landing → Pricing → CTA → Form → Submit → Conversion → Product usage

---

## 5. Sitemap

| Page | Role | Notes |
|---|---|---|
| **Home** | Cold visitor: Monitoring as hero/headline offer, Assessment as the free-proof-first CTA beside it. **Recognized visitor: real pillar scores front and center** (governance, compliance, adoption, Copilot, architecture, licensing, security — the Architecture Health Engine's actual pillars), directing them straight to whichever topic page needs attention most | |
| **Assessment** | Free/Paid real-scan product, consent-gated | Primary top-of-funnel push, site-wide |
| **Solutions / Topic pages** (Copilot, Security & Compliance, Governance, SharePoint, Power Platform, Teams, Migration, M365 Health) | Each page is the personalization surface for its domain — real score + specific remediation/offer for a recognized visitor, generic domain marketing for a cold one | Reinstated — previously marked killed/folded into Monitoring, corrected here. Topic set mirrors the 8 existing quiz categories, reusing an already-established taxonomy rather than inventing a new one. This is where the site-wide personalization concept (§3) actually lives, page by page |
| **Resources / Articles** | New page — blog/article content. Cold visitor reads generically; **recognized visitor reading a Copilot article sees a nudge tied to their real Copilot score** ("this article covers X — based on your scan, you need X and Y to get there") | Content pipeline already exists: Weekly Article Generator workflow (real, cron-scheduled, drafts only — human still publishes). Personalized nudge layer is new, same build category as other personalization mechanics |
| **Monitoring** | 3-tier pricing, self-checkout | Main commercial page |
| **Products / Quick-Start Packs** | Catalog page, pulls from real product catalog | |
| **Retainer / Fractional Consulting** | SEO-indexable, own order flow | Framed as upgrade path for existing Monitoring customers |
| **MSP / Partners** | 3-tier, onboarding choice, MSA/DPA-gated checkout | |
| **Trust & Security** | Platform-level proof-point story (tenant isolation, audit trail, exception tracking, etc.) | New page — supports every funnel, shouldn't be buried in Monitoring copy |
| **About** | Personal NASA bio | Strictly personal-credential framing — never platform capability (see Guardrails) |
| **Quiz** | Individual quiz landing pages (SEO/paid-traffic) + single hub | Demoted from nav-primary to recovery/feeder role |
| **Contact / Book a Call** | Cold visitor: standard contact form, low-commitment fallback. **Recognized/logged-in visitor: no generic form** — direct route into Portal's real AI support chat (grounded in their actual account data, human escalation available) instead of making an existing customer re-explain themselves | |
| **Legal** | Privacy Policy, Terms of Service, MSP Partner ToS, DPA | Linked from checkout, not nav |
| **Login** | Handoff to Portal | |

**Killed (revised):** old generic `/pricing` page (superseded by Monitoring) · `/projects` (superseded by Portal) · any route that only ever pointed into `/crm/` or the legacy presentation flow. Individual topic pages are **not** killed — reinstated per §3, they're the mechanism, not decoration.

---

## 5. Design system

**Direction:** charcoal + glass + restrained gradient. Not navy, not literal space/NASA imagery, not generic "AI SaaS dark-mode-plus-gradient" template. Personal references: Tesla Model 3 (sleek, charcoal, minimal), iOS glass/dark mode, Microsoft Copilot's gradient blending — done with restraint, not everywhere.

### Color tokens
| Token | Value | Use |
|---|---|---|
| `--charcoal-0` | `#1A1A1C` | Page background |
| `--charcoal-1` | `#232326` | Panel/card background |
| `--glass-fill` | `rgba(255,255,255,0.06)` | Glass panel fill |
| `--glass-border` | `rgba(255,255,255,0.12)` | Glass panel border |
| `--text-primary` | `#F5F5F7` | Headlines, primary text |
| `--text-secondary` | `#9A9AA3` | Body/supporting text |
| `--text-tertiary` | `#6B6B72` | Labels, captions |
| `--accent-blue` | `#5B8DEF` | Gradient start |
| `--accent-violet` | `#9B7CFF` | Gradient end |

Gradient (`--accent-blue` → `--accent-violet`) is used **sparingly and deliberately**: headline emphasis (one line/phrase, not the whole headline), primary CTAs, and live data numbers. Never as a full-background wash. Everything else stays flat charcoal/white.

### Typography
- **Display/headlines:** Space Grotesk (500/700) — geometric, technical, distinctive
- **Body/UI:** Inter (400/500/600)
- **Numbers that matter** (stats, scores, prices): IBM Plex Mono (500) — deliberate continuity with the Portal's own "every number that matters gets monospace" rule, without touching the Portal itself

### Surfaces
- Frosted glass panels (`backdrop-filter: blur(24px)` + `--glass-fill` + `--glass-border`) for anything showing live data or a key conversion moment
- Flat charcoal cards elsewhere — glass is reserved, not default

### Signature element
The floating glass stat panel (e.g. "Tenant health — 98.2" / "Signals watched — 312") — doubles as brand signature and literal product preview. Reusable pattern across Home, Assessment, and Monitoring hero sections.

### Restraint rules
- Gradient in at most 2–3 places per page
- No decorative motion beyond deliberate micro-interactions (hover states, live-data pulse) — no scroll-jacking, no particle effects
- No literal space/rocket/NASA imagery — the NASA credibility lives in copy (About page, bio), never in visual motifs

---

## 6. Guardrails carried forward (non-negotiable)

- NASA background = personal bio credential only, never framed as platform capability or government authorization
- No FedRAMP/GCC/GCC-High/government-contractor marketing anywhere on the site — platform explicitly excludes government tenants
- No compliance claims (SOC 2, HIPAA, etc.) beyond what's formally documented — currently: "building toward SOC 2 Type I," nothing further
- Known live violations to fix during rebuild, not carry forward: forced compliance-badge injection in the AI landing-page generator (`admin-marketing.ts:2432` — hardcodes FedRAMP/FISMA/ITAR/GCC High/HIPAA/SOC 2/NIST badges into every generated page); fabricated data surfaces (Command Center, Team Members, hardcoded health/security percentages) — not website-scope directly, but must not be screenshotted/referenced as proof in site copy
- Shane is the CURRENT M365 Architect at NASA — confirmed directly by Shane. Always present tense ("M365 Architect at NASA"), never "Former." This has regressed multiple times across this project (later tasks copying stale prior-page phrasing) — every prompt touching any page with this reference should explicitly verify present tense, not assume it's already correct.
- No platform-level claims of federal/FedRAMP/FISMA/GCC alignment or hardening, in any phrasing — locked, applies regardless of tone/voice direction requested in any future task. Shane's personal NASA credential is always fair game stated with full confidence; claims about the platform's compliance posture or lineage to real mission-control systems are not, unless and until actually true and verified.

---

## 7. Build sequencing

Staged, in order — each stage builds on a working prior stage, not in parallel:

1. **Shell / Core** — design tokens, layout shell (header/footer/nav), routing skeleton, no real content yet. Establishes the charcoal/glass/gradient system as reusable components.
2. **Pages** — every sitemap page scaffolded and routed, using real components from Stage 1, placeholder/lorem content where real copy isn't ready yet.
3. **Content** — real copy, real product/catalog data wired in, real funnel CTAs pointing to the right next step per §2.
4. **Differentiators / Features** — the advanced dynamic layer: site-wide personalization across topic pages, Home, Resources, and Contact (§3), identity-aware recognition, engagement-based auto-bundling, **and the full analytics visualization layer** (heatmap renderer, session-replay reconstruction player, A/B testing infrastructure — raw capture for these starts back in Stage 1, per §4). Built last, on top of a working site, not blocking the earlier stages — but a genuinely large stage on its own, not a light finishing pass.

---

*Reference doc — supersedes v1. Living document; update as pages are built and verified.*
