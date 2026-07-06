# Shane McCaw Consulting — Public Website Reference

> **Audience**: Shane McCaw (operational reference) and future developers/contractors.  
> **Purpose**: Complete, structured reference for the public marketing website at `artifacts/shane-mccaw-consulting`. Detailed enough that an AI tool (Copilot, Claude, etc.) can generate workflow drawings, navigation diagrams, user flow charts, and marketing copy recommendations directly from this document — no code reading required.

---

## Table of Contents

1. [Site Architecture Overview](#1-site-architecture-overview)
2. [Navigation Structure](#2-navigation-structure)
3. [Page-by-Page Reference](#3-page-by-page-reference)
4. [Quiz and Assessment Flows](#4-quiz-and-assessment-flows)
5. [Quick Win Selector Quiz](#5-quick-win-selector-quiz)
6. [Lead Capture Pipeline](#6-lead-capture-pipeline)
7. [Micro-Offers Catalog and Checkout Flow](#7-micro-offers-catalog-and-checkout-flow)
8. [Retainer Plans and Quiz Flow](#8-retainer-plans-and-quiz-flow)
9. [Landing Page System (`/lp/:slug`)](#9-landing-page-system-lpslug)
10. [Contact, Book, and Resources Flows](#10-contact-book-and-resources-flows)
11. [SEO and Meta Structure](#11-seo-and-meta-structure)

---

## 1. Site Architecture Overview

### Technology Stack

| Layer | Technology |
|---|---|
| Framework | React 18 + Vite |
| Routing | Wouter (client-side SPA, no SSR) |
| Styling | Tailwind CSS v4 |
| UI Components | shadcn/ui + Lucide React + react-icons/fa |
| Forms | react-hook-form + zod + @hookform/resolvers |
| State / Server State | @tanstack/react-query |
| SEO | Custom `SEOMeta` component (imperative DOM mutation, no react-helmet) |
| Analytics | Custom `initTracker()` / `trackPageview()` / `trackEvent()` in `src/lib/analytics.ts` |
| Markdown | react-markdown (article content) |
| PDF | @react-pdf/renderer (client-side PDF generation for lead magnets) |

### Artifact Details

| Property | Value |
|---|---|
| Artifact ID | `artifacts/shane-mccaw-consulting` |
| Workspace package | `@workspace/shane-mccaw-consulting` |
| Preview path | `/` (mounted at site root) |
| Backend API | `@workspace/api-server` at `/api` |
| CRM portal | `@workspace/crm` at `/crm/` |
| Admin panel | `@workspace/admin-panel` at `/admin-panel/` |
| Build type | Static SPA (Vite) — all packages are `devDependencies` |

### Site Purpose

A professional marketing website for Shane McCaw Consulting, positioning Shane McCaw (Lead M365 Architect at NASA, 30-year Microsoft ecosystem veteran) as the premier Microsoft 365 and Copilot AI consultant. The site generates leads, sells fixed-price consulting packages, and books discovery calls.

### Complete Route Table

| Route | Component | Purpose | Auth Required |
|---|---|---|---|
| `/` | `Home` | Home/landing page with service directory | No |
| `/about` | `About` | Shane's biography, career timeline, NASA credentials | No |
| `/services` | `Services` | Full service directory across all three tracks | No |
| `/services/microsoft-365` | `Microsoft365` | M365 Architecture & Strategy service page | No |
| `/services/copilot-ai` | `CopilotAI` | Copilot & AI service page | No |
| `/services/sharepoint` | `SharePoint` | SharePoint service page | No |
| `/services/power-platform` | `PowerPlatform` | Power Platform service page | No |
| `/services/governance` | `Governance` | Governance service page | No |
| `/services/cloud-migration` | `CloudMigration` | Cloud Migration service page | No |
| `/services/m365-training` | `M365Training` | M365 Training & Enablement service page | No |
| `/services/security-hardening` | `SecurityHardening` | Security Hardening service page | No |
| `/micro-offers` | `MicroOffers` | Fixed-price Quick Win packages catalog | No |
| `/micro-offers/:slug` | `MicroOfferDetail` | Individual Quick Win package detail | No |
| `/pricing` | `Pricing` | Transparent pricing for all engagement types | No |
| `/resources` | `Resources` | Article library + lead magnet | No |
| `/resources/:slug` | `ArticlePage` | Individual article reader | No |
| `/contact` | `Contact` | AI-powered conversational contact / lead capture | No |
| `/book` | `Book` | Discovery call booking (Graph API calendar) | No |
| `/privacy` | `Privacy` | Privacy policy | No |
| `/admin` | `Admin` | Password-protected admin (legacy) | Password (sessionStorage) |
| `/customer-command-center` | `CustomerCommandCenter` | Client self-service panel | No |
| `/copilot-quiz` | `CopilotQuiz` | Copilot Readiness Assessment (standalone implementation) | No |
| `/m365-health-quiz` | `M365HealthQuiz` | M365 Tenant Health Assessment | No |
| `/sharepoint-readiness-quiz` | `SharePointQuiz` | SharePoint Architecture Assessment | No |
| `/power-platform-quiz` | `PowerPlatformQuiz` | Power Platform Maturity Assessment | No |
| `/security-compliance-quiz` | `SecurityQuiz` | Security & Compliance Assessment | No |
| `/teams-maturity-quiz` | `TeamsQuiz` | Teams Health Assessment | No |
| `/migration-readiness-quiz` | `MigrationQuiz` | Cloud Migration Readiness Assessment | No |
| `/governance-maturity-quiz` | `GovernanceQuiz` | Governance Maturity Assessment | No |
| `/quiz/results/:leadId` | `QuizResultsPage` | Shareable quiz results page (token-gated) | `?token=` query param |
| `/retainers` | `RetainersOverview` | Retainer plan comparison | No |
| `/retainer-quiz` | `RetainerQuiz` | Retainer Selector Quiz | No |
| `/retainers/architect-essentials` | `ArchitectEssentials` | Essentials retainer detail | No |
| `/retainers/architect-growth` | `ArchitectGrowth` | Growth retainer detail | No |
| `/retainers/architect-enterprise` | `ArchitectEnterprise` | Enterprise retainer detail | No |
| `/quick-win-quiz` | `QuickWinQuiz` | Quick Win Selector Quiz | No |
| `/quick-win/results/:resultId` | `QuickWinResultsPage` | Quick Win quiz results (server-stored) | No |
| `/how-it-works` | `HowItWorks` | Engagement model explainer (8 steps) | No |
| `/how-it-works/technical` | `TechnicalOverview` | Technical deep-dive on automation stack | No |
| `/lp/:slug` | `LandingPage` | Dynamic CMS-driven landing pages | Optional (landing_page_only) |
| `*` | `NotFound` | 404 page | No |

### Global Behaviors

- **Scroll-to-top**: Every route change calls `window.scrollTo(0, 0)` unless there is a URL hash anchor.
- **Analytics**: Every route change fires `trackPageview(location)`.
- **Toast notifications**: A global `<Toaster>` from shadcn/ui is mounted in `App.tsx` for all toast notifications.
- **QueryClient**: A single `QueryClient` instance wraps all server-state fetching.
- **Base URL**: Wouter router is initialized with `import.meta.env.BASE_URL` (strips trailing slash) to support path-prefixed deployments.

---

## 2. Navigation Structure

### Header Behavior

| Condition | Header Style |
|---|---|
| Home page (`/`), user has not scrolled past 20px | Transparent, `py-5` |
| Home page, scrolled past 20px | Deep Navy (`#0A2540/95`), backdrop-blur, `py-3.5`, bottom shadow |
| Any other route | Deep Navy (`#0A2540/95`), backdrop-blur, `py-3.5`, bottom shadow |

The header is `position: fixed; top: 0; z-index: 50`. All pages with hero sections add `pt-[172px]` to clear the header.

### Desktop Navigation (≥ `lg` breakpoint)

Five dropdown groups + one standalone link + two action buttons:

| Position | Type | Label | Trigger |
|---|---|---|---|
| 1 | Dropdown | Services | Click (toggle) |
| 2 | Dropdown | Quick Wins | Click (toggle) |
| 3 | Dropdown | Retainers | Click (toggle) |
| 4 | Dropdown | Assessments | Click (toggle) |
| 5 | Plain link | Resources | Direct to `/resources` |
| 6 | Dropdown | Company | Click (toggle) |
| — | Action button | Client Login | Direct link to `/crm/` |
| — | CTA button | Book a Call | Direct link to `/book` |

Active state: dropdown trigger turns Electric Blue (`text-primary`) when the current route is within that group's child routes.

Dropdown close triggers: clicking outside the `<ul>`, pressing `Escape`, route change, or selecting an item. Arrow key navigation is supported within open dropdowns.

### Dropdown Contents

**Services dropdown** (2-column grid):

| Label | Route |
|---|---|
| Service Overview | `/services` |
| M365 Architecture & Strategy | `/services/microsoft-365` |
| M365 Training | `/services/m365-training` |
| Copilot & AI | `/services/copilot-ai` |
| SharePoint | `/services/sharepoint` |
| Power Platform | `/services/power-platform` |
| Governance | `/services/governance` |
| Cloud Migration | `/services/cloud-migration` |

**Quick Wins dropdown** (2-column grid):

| Label | Route |
|---|---|
| All Quick Wins | `/micro-offers` |
| Start Here (Quiz) | `/quick-win-quiz` |
| Tenant Health Audit | `/micro-offers/tenant-health-audit` |
| Power Platform Quick-Start | `/micro-offers/power-platform-quick-start` |
| Governance Foundations | `/micro-offers/governance-foundations` |
| Migration Readiness Assessment | `/micro-offers/migration-readiness-assessment` |
| Copilot Readiness Assessment | `/micro-offers/copilot-readiness-assessment` |
| Microsoft 365 Training & Enablement | `/micro-offers/m365-training-enablement` |

**Retainers dropdown** (single column, 224px wide):

| Label | Route |
|---|---|
| All Retainer Plans | `/retainers` |
| Start Here (Quiz) | `/retainer-quiz` |
| Architect Essentials | `/retainers/architect-essentials` |
| Architect Growth | `/retainers/architect-growth` |
| Architect Enterprise | `/retainers/architect-enterprise` |

**Assessments dropdown** (2-column grid):

| Label | Route |
|---|---|
| Copilot Readiness Assessment | `/copilot-quiz` |
| M365 Health Assessment | `/m365-health-quiz` |
| SharePoint Readiness Assessment | `/sharepoint-readiness-quiz` |
| Power Platform Risk Assessment | `/power-platform-quiz` |
| Security & Compliance Assessment | `/security-compliance-quiz` |
| Teams Maturity Assessment | `/teams-maturity-quiz` |
| Migration Readiness Assessment | `/migration-readiness-quiz` |
| Governance Maturity Assessment | `/governance-maturity-quiz` |

**Company dropdown** (single column, 176px wide):

| Label | Route |
|---|---|
| About | `/about` |
| How We Work | `/how-it-works` |
| Pricing | `/pricing` |
| Contact | `/contact` |

### Mobile Navigation (< `lg` breakpoint)

A hamburger button (`Menu` / `X` icon) in the top-right of the header toggles a full-screen-height overlay menu. The mobile menu contains the same five section groups (Services, Quick Wins, Retainers, Assessments, Company) as expandable accordion sections (each with a `ChevronDown` toggle), plus a standalone Resources link, a Client Login button, and a Book a Call CTA. Each group is separated by a horizontal divider. Menu closes on route change.

### Footer

Two-column layout (stacks on mobile):

| Column | Contents |
|---|---|
| Brand | "Shane McCaw Consulting", "Vero Beach, FL", tagline: M365 · Copilot AI · SharePoint · Power Platform |
| Retainer Plans | Links to Architect Essentials, Growth, Enterprise |
| Quick Links | How It Works, Pricing, Quick Wins, Resources, Contact |
| CTA | "Schedule a Consultation" button → `/book` |

Footer bottom bar: copyright year (dynamic), Privacy Policy link → `/privacy`.

---

## 3. Page-by-Page Reference

### 3.1 Core Pages

---

#### Home (`/`)

**Title**: `Enterprise Microsoft 365 & Copilot AI Consulting | Shane McCaw — NASA's Lead M365 Architect`  
**Meta Description**: Positions Shane as NASA's Lead M365 Architect, 30-year Microsoft veteran, available for enterprise consulting.  
**JSON-LD**: `ProfessionalService` schema  
**Primary CTA**: "Book a Free Discovery Call" → `/book`

**Content Sections** (in order):

1. **Hero** — Full-width navy hero. Headline emphasizes Shane's NASA role. Authority badges: `FedRAMP`, `FISMA`, `ITAR`, `GCC High`. Secondary CTA: "See Fixed-Price Packages."
2. **Who I Work With** — Three ICP cards: Mid-Market Enterprises (200–2,000 employees), Regulated Industries & Gov Contractors, Startups & Scale-Ups. Each card lists 4 pain points.
3. **Productized Services (Quick Wins)** — Dynamic grid of micro-offers fetched from `/api/services?type=micro_offer`. Each card shows name, price, turnaround time, key inclusions, CTA to detail page. "Start Here" quiz link.
4. **Fractional Architect Retainers** — Dynamic grid of retainer plans fetched from `/api/services`. Three plans with pricing and highlights.
5. **NASA Authority Strip** — Dark navy section reinforcing Shane's NASA credentials with four points: security-first, governance-before-deployment, highest-tier compliance, real Copilot deployment experience.
6. **CTA Section** — "Book a Free Discovery Call" and "View All Fixed-Price Packages."

**Dynamic Data**: Micro-offer and retainer service records from `/api/services`. Falls back gracefully if the API is unavailable.  
**Lead Collection**: None directly — links to `/book` or CRM onboarding.

---

#### About (`/about`)

**Title**: `About Shane McCaw | NASA's Lead Microsoft 365 Architect & Copilot SME`  
**Meta Description**: 30-year Microsoft veteran, current NASA Lead M365 Architect.  
**Primary CTA**: "Book a Free Call" → `/book`; "Contact Shane" → `/contact`

**Content Sections**:

1. **Hero** — "30 Years Inside the Microsoft Ecosystem" headline. NASA badge.
2. **Career Timeline** — Four milestones:
   - 1994–2010: Software Developer & Architect (Microsoft ecosystem)
   - 2010–2016: Founder & Principal Architect (McCawSoft)
   - 2016–2018: Director of Technologies (Planet Technologies, Microsoft Gold Partner)
   - 2018–Present: Lead M365 Architect & Copilot SME (NASA) — marked as current/active
3. **Why NASA Experience Matters** — Four principles: security-first, governance-before-deployment, FISMA High compliance, real Copilot deployment experience.
4. **Core Competencies** — List of 15+ competency badges: M365 Architecture, Microsoft Copilot, Copilot Governance, SharePoint Online, Microsoft Teams, OneDrive, Entra ID, Conditional Access, DLP, Microsoft Purview, Power Platform, Azure AD, Exchange Online, Intune, Microsoft Viva, etc.
5. **Who I Help & Why** — Engagement trigger scenarios: organizations that received an audit finding, failed a migration, are planning Copilot, have governance gaps.
6. **Consulting Philosophy** — Three-part philosophy card.
7. **ConsultationCTA** — Standardized reusable bottom CTA component.

**Dynamic Data**: None — fully static.

---

#### Services (`/services`)

**Title**: `All Microsoft 365 Services — Architecture, Quick Wins & Retainers | Shane McCaw Consulting`  
**JSON-LD**: `OfferCatalog` schema  
**Primary CTA**: "Book a Free Discovery Call" → `/book`

**Content Sections**:

1. **Hero** — "Every Service, One Architect" headline. NASA authority subtext.
2. **NASA Authority Strip** — Reused credential strip.
3. **Track 01 — Fixed-Price Quick Wins (Entry)** — Dynamic cards from `useServices("micro_offer")`. Each rendered as `<OfferCard>`.
4. **Track 02 — Project-Based Engagements (Core)** — Dynamic cards from `useEngagementProjects()`. Each rendered as `<ServiceProjectCard>` or `<EngagementProjectCard>`.
5. **Track 03 — Fractional Architecture (Strategic)** — Dynamic retainer cards. Each rendered as `<RetainerCard>`.
6. **Assessment Selector** — `<AssessmentSelector>` component linking to all 8 assessment quizzes.

**Dynamic Data**: All three service tracks load from API. Services are grouped by `serviceType` field.

---

#### Pricing (`/pricing`)

**Title**: `Pricing — Transparent Microsoft 365 Consulting Fees | Shane McCaw Consulting`  
**JSON-LD**: `ItemList` + `FAQPage` schemas  
**Primary CTA**: "Book a Free Scoping Call" → `/book`

**Content Sections**:

1. **Hero** — "Transparent Pricing. No Surprises." headline.
2. **Why Fixed Pricing** — Three reasons: no hourly billing surprises, defined scope, single-project price.
3. **Three Ways to Engage** — Comparison strip: Entry (Quick Wins, starting $3,000), Core (Projects, $7,500–$35,000+), Strategic (Retainers, from $2,500/mo).
4. **Quick Wins Track** — Cards from `useServices("micro_offer")` showing price, turnaround, CTA.
5. **Project-Based Track** — Cards from `useEngagementProjects()`.
6. **Retainer Track** — Cards from `useServices("retainer")` via `<RetainerCard>`.
7. **FAQ** — 7 frequently asked questions:
   - How quickly can an engagement start?
   - Do you work with small businesses?
   - Is everything done remotely?
   - How are project engagements scoped?
   - Can I start with a Quick Win and move to a retainer?
   - What does a retainer look like month to month?
   - What M365 licenses are required for Copilot?

**Dynamic Data**: All pricing data loaded from API. Fallback prices display if API is unavailable.

---

#### Privacy (`/privacy`)

**Title**: `Privacy Policy | Shane McCaw Consulting`  
Static legal document page. No dynamic data, no lead collection.

---

#### How It Works (`/how-it-works`)

**Title**: `How It Works | Shane McCaw Consulting`  
**Primary CTA**: "Book a Free Discovery Call"; "Read the Technical Overview" → `/how-it-works/technical`

**Content Sections** — 8 numbered steps explaining the automated engagement model:

1. **Secure Tenant Connection** — Client creates Azure App Registration in their own Entra ID. Client secret stored in Azure Key Vault (not in the database). Zero-trust, least-privilege access.
2. **Automation Runs Inside Your Tenant** — PowerShell runbooks execute via Azure Automation, reading from Microsoft Graph and Azure AD APIs. Read-only, idempotent.
3. **AI Analysis and Scoring** — Runbook output passed to Claude (Anthropic) for multi-dimension scoring. Categories: Security, Governance, Licensing, Copilot Readiness, Teams/SharePoint adoption.
4. **Auto-Generated Project in Client Portal** — Findings auto-create a structured project with phased workflow (Discovery → Analysis → Remediation → Validation), Kanban task board, document storage, status reports.
5. **Shane Reviews and Refines** — Human expert validation of all AI outputs. Shane adds practitioner context, re-ranks items, prepares findings for presentation.
6. **Findings Session** — Live presentation of the scored assessment. Shane walks through every finding, explains root causes, answers questions in real time.
7. **Ongoing Monitoring** (for retainer clients) — Proactive tenant health monitoring continues post-engagement.
8. **Data Privacy** — How client data is protected throughout the process.

---

#### Technical Overview (`/how-it-works/technical`)

**Title**: `Technical Architecture Overview | Shane McCaw Consulting`  
Deep-dive companion to `/how-it-works`. Documents the Azure Automation runbook pipeline, Microsoft Graph permissions model, AI processing pipeline, and client portal architecture. No lead collection.

---

#### Customer Command Center (`/customer-command-center`)

**Title**: `Client Command Center | Shane McCaw Consulting`  
Self-service hub page for clients. Redirects authenticated clients toward the CRM portal. Not a primary acquisition page.

---

#### Admin (`/admin`)

Password-protected using `sessionStorage` key. Provides legacy article management interface. Note: full admin functionality has migrated to the Admin Panel artifact at `/admin-panel/`.

---

### 3.2 Service Pages

All service pages share a common structure:

1. **Hero** — Deep Navy background, service name, tagline, two CTAs: primary ("Book a Discovery Call" → `/book`) and secondary (assessment quiz link).
2. **What We Do** — Description of the service and scope.
3. **Who It's For** — ICP cards (industry, company size, role).
4. **Engagement Model** — How the service is delivered.
5. **Deliverables** — What the client receives.
6. **Investment** — Pricing or pricing range.
7. **ConsultationCTA** — Standardized bottom CTA.

| Route | Service Name | Primary Quiz Link |
|---|---|---|
| `/services/microsoft-365` | M365 Architecture & Strategy | `/m365-health-quiz` |
| `/services/copilot-ai` | Copilot & AI | `/copilot-quiz` |
| `/services/sharepoint` | SharePoint | `/sharepoint-readiness-quiz` |
| `/services/power-platform` | Power Platform | `/power-platform-quiz` |
| `/services/governance` | Governance | `/governance-maturity-quiz` |
| `/services/cloud-migration` | Cloud Migration | `/migration-readiness-quiz` |
| `/services/m365-training` | M365 Training & Enablement | `/m365-health-quiz` |
| `/services/security-hardening` | Security Hardening | `/security-compliance-quiz` |

---

### 3.3 Retainer Pages

Covered in detail in [Section 8](#8-retainer-plans-and-quiz-flow).

---

### 3.4 Assessment Pages

Covered in detail in [Section 4](#4-quiz-and-assessment-flows).

---

### 3.5 Utility Pages

| Route | Purpose |
|---|---|
| `/not-found` (catch-all `*`) | 404 page with "Go Home" CTA |
| `/privacy` | Privacy policy |
| `/quiz/results/:leadId` | Shareable quiz results (token-gated) |
| `/quick-win/results/:resultId` | Quick Win quiz results |

---

## 4. Quiz and Assessment Flows

### Overview

The site has **9 assessments** total: 8 standard AI-powered assessments (using `GenericQuizModal`) and 1 standalone Copilot Readiness Assessment with its own full-page implementation.

All standard assessments follow an identical flow:

```
Visitor lands on quiz page
       │
       ▼
Hero + "Start Assessment" button
       │
       ▼ (click)
Modal opens → Intro screen
       │
       ▼ (click "Start the Assessment")
API call: POST /api/quiz/chat { messages: [], quizType }
       │
       ▼ Claude Haiku generates Question 1
Questioning phase (10 questions total)
  ├── User types answer
  ├── Live Scorecard updates (provisional, heuristic)
  ├── POST /api/quiz/chat { messages: [...], quizType }
  └── Claude Haiku generates next question
       │
       ▼ (after answer 10)
Lead capture form: Name*, Work Email*, Company (optional)
       │
       ▼ (submit)
POST /api/quiz/submit { name, email, company, conversation, quizType }
       │
       ├── API scores conversation via Claude Haiku
       ├── Inserts row into quiz_leads table (quiz_leads only — NOT leads)
       ├── Triggers admin push notification
       ├── Generates PDF report (pdf-lib)
       └── Sends PDF to user via Resend email
       │
       ▼
Results screen (in modal)
  ├── Total score (0–100) and maturity tier badge
  ├── Category score bars (5 categories, each 0–10)
  ├── AI-generated "What This Means" narrative
  ├── Service recommendation with upsell card
  ├── ROI projection
  ├── Share link (tokenized: /quiz/results/:leadId?token=...)
  └── PDF resend form (change email)
```

### AI Model Used

**All quiz conversations and scoring**: `claude-haiku-4-5` (Anthropic, via `@workspace/integrations-anthropic-ai`).

The system prompt is quiz-type-specific. For each quiz, Claude is instructed to:
1. Ask one conversational question at a time across the 5 categories (2 questions per category).
2. After 10 answers, produce a structured JSON scoring object with `categoryScores`, `tier`, `recommendedService`, `whatThisMeans`, `whyThisFits`, `roiProjection`.

### Data Collected (All Assessments)

| Field | Source |
|---|---|
| `name` | Lead capture form |
| `email` | Lead capture form |
| `company` | Lead capture form (optional) |
| `conversation` | Array of `{role, content}` message objects (full Q&A) |
| `quizType` | Hard-coded per quiz page |
| `categoryScores` | AI-scored JSON: 5 scores, each 0–10 |
| `totalScore` | Sum of category scores, normalized 0–100 |
| `tier` | One of: Beginner / Developing / Emerging / Advanced / Ready |
| `recommendedService` | AI-selected service name |
| `analysisText` | AI narrative: `whatThisMeans`, `whyThisFits`, `roiProjection` |

### Maturity Tiers

| Tier | Color | Meaning |
|---|---|---|
| Beginner | Red | Significant configuration gaps; immediate action needed |
| Developing | Orange | Making progress but hidden gaps remain |
| Emerging | Yellow | Reasonable shape; edge cases and technical debt present |
| Advanced | Blue | Mature and well-managed; ready for next-level capabilities |
| Ready | Teal | Excellent; enterprise-grade posture |

### Quiz PDF Report

Generated server-side using `pdf-lib`. Two-page A4 document:
- **Page 1**: Header (Shane McCaw Consulting branding), report title, client name, date, total score box (large), maturity tier label, category score bars, "What This Means" narrative.
- **Page 2**: Service recommendation card, "Why This Fits" section, ROI projection.

Delivered via Resend email immediately after submission. Resend form in results screen allows changing the delivery address.

### Shareable Results Link

Format: `/quiz/results/:leadId?token=<resendToken>`

The `resendToken` is a server-generated opaque string stored in `quiz_leads`. Anyone with the link can view that lead's results. Shane can share this link with prospects or use it for follow-up.

---

### 4.1 Standard Assessment Specifications

#### Copilot Readiness Assessment (`/copilot-quiz`)

**Full title**: Copilot for Microsoft 365 Readiness Assessment  
**`quizType`**: `copilot`  
**Implementation**: Standalone page component (not `GenericQuizModal`) — has additional full-page hero, dimension breakdown, and testimonial sections visible before/after the modal.  
**PDF filename**: `copilot-readiness-report.pdf`  
**Report title**: `Copilot for M365 Readiness Report`

**5 Categories (2 questions each)**:
1. **Infrastructure & Identity** — M365 licensing tier; Azure AD/Entra ID setup (managed vs. hybrid)
2. **Data & Compliance** — Data classification/sensitivity labeling; data residency and regulatory compliance
3. **AI Literacy** — Staff familiarity with AI tools; AI training programs or acceptable-use policies
4. **Change Management** — Past technology adoption approach; executive sponsorship and cross-department buy-in
5. **Business Process** — Most time-consuming processes; process documentation and standardization

**Tier Upsells** (exact mappings from `TIER_UPSELLS` in `CopilotQuiz.tsx`):
- **Beginner**: M365 Tenant Health Audit · from $4,500 · "Start Here" badge
- **Developing**: Copilot for M365 Readiness Assessment · from $5,000 · "Recommended" badge
- **Emerging**: Copilot for M365 Readiness Assessment · from $5,000 · "Next Step" badge
- **Advanced**: Power Platform Quick-Start · from $6,000 · "High Impact" badge
- **Ready**: Governance Foundations Package · from $12,000 · "Enterprise Grade" badge

---

#### M365 Tenant Health Assessment (`/m365-health-quiz`)

**`quizType`**: `m365-health`  
**Report title**: `Microsoft 365 Tenant Health Report`

**5 Categories** (keys: `securityPosture, identityConditionalAccess, collaborationSprawl, adminRolesShadowIT, dlpSensitivityLabels`):
1. **Security Posture** — Microsoft Secure Score engagement; Defender for Office 365 configuration; anti-phishing and anti-malware policies; DKIM/DMARC/SPF email authentication
2. **Identity & Conditional Access** — MFA coverage across all accounts; Conditional Access policy breadth and enforcement; Entra ID configuration; privileged identity management
3. **Collaboration Sprawl** — Teams and SharePoint governance: naming conventions, site/team lifecycle policies, guest access controls, sprawl and shadow IT indicators
4. **Admin Roles & Shadow IT** — Global Admin count and least-privilege practices; admin role hygiene; monitoring tools in use; shadow IT and unsanctioned app usage
5. **DLP & Sensitivity Labels** — Sensitivity label deployment and coverage; DLP policy configuration and scope; data classification maturity; information protection readiness

**Tier Upsells**:
- Beginner → Developing → Emerging: M365 Tenant Health Audit (from $4,500)
- Advanced: Copilot for M365 Readiness Assessment (from $5,000)
- Ready: Governance Foundations Package (from $12,000)

---

#### SharePoint Architecture Assessment (`/sharepoint-readiness-quiz`)

**`quizType`**: `sharepoint`  
**Report title**: `SharePoint Architecture Assessment Report`

**5 Categories** (keys: `infoArchitecture, searchMetadata, contentLifecycle, governanceGaps, migrationReadiness`):
1. **Information Architecture** — Hub site structure; naming conventions; site hierarchy; provisioning process; whether the environment was designed or grew organically
2. **Search & Metadata** — Content findability; search configuration quality; managed properties usage; metadata tagging practices; navigation structure consistency
3. **Content Lifecycle** — What happens to content when projects end or employees leave; retention and archiving policies; inactive site handling; lifecycle management documentation
4. **Governance Gaps** — Inherited vs unique permissions; external sharing posture; guest access controls; known governance gaps; oversharing risks; ownership accountability
5. **Migration Readiness** — Whether a SharePoint migration or modernisation is planned; technical debt identified; blockers to migration; documentation accuracy; legacy content volume

**Tier Upsells**:
- Beginner/Developing/Emerging: SharePoint Consulting service
- Advanced/Ready: Governance Foundations Package or Architect Essentials Retainer

---

#### Power Platform Maturity Assessment (`/power-platform-quiz`)

**`quizType`**: `power-platform`  
**Report title**: `Power Platform Maturity Assessment Report`

**5 Categories** (keys: `environmentStrategy, dlpMakerPermissions, appSprawlDataRisk, monitoringCompliance, governanceReadiness`):
1. **Environment Strategy** — Environment structure (dev/test/prod); naming conventions; who can create environments; approval process; capacity planning
2. **DLP & Maker Permissions** — DLP policy configuration across environments; connector governance; maker permission tiers; who can build what; maker enablement guardrails
3. **App Sprawl & Data Risk** — App volume in production; undocumented or abandoned apps; data sensitivity of connected sources; unmanaged connections; data residency concerns
4. **Monitoring & Compliance** — Flow failure alerting and monitoring; CoE toolkit adoption; capacity utilisation awareness; compliance with IT governance policies; audit capability
5. **Governance Readiness** — Whether a formal Power Platform governance framework exists; documentation quality; IT strategy alignment; expansion plans; Centre of Excellence maturity

**Tier Upsells**:
- Beginner: Power Platform Quick-Start (from $6,000)
- Developing/Emerging: Governance Foundations Package
- Advanced/Ready: Architect Growth or Architect Enterprise Retainer

---

#### Security & Compliance Assessment (`/security-compliance-quiz`)

**`quizType`**: `security-compliance`  
**Report title**: `M365 Security & Compliance Assessment Report`

**5 Categories** (keys: `identityAccess, dataProtection, insiderRiskCompliance, auditEDiscovery, regulatoryReadiness`):
1. **Identity & Access Control** — MFA coverage; Conditional Access policy breadth and enforcement; Entra ID configuration; privileged identity management and just-in-time access
2. **Data Protection** — Sensitivity label deployment and coverage; DLP policy configuration and enforcement; information protection maturity; data classification practices
3. **Insider Risk & Compliance** — Insider Risk Manager policy deployment; Communication Compliance configuration; Compliance Manager usage and improvement score; compliance posture
4. **Audit & eDiscovery** — Audit log retention configuration; eDiscovery readiness and tested capability; Content Search usage; audit log review processes
5. **Regulatory Readiness** — Applicable regulatory framework mapping (HIPAA, CMMC, FedRAMP, SOX, GDPR, NIST); Purview compliance control configuration; audit readiness posture

**Tier Upsells**:
- Beginner/Developing: Tenant Health Audit + Governance Foundations
- Emerging/Advanced: Governance Foundations Package
- Ready: Architect Enterprise Retainer

---

#### Teams Health Assessment (`/teams-maturity-quiz`)

**`quizType`**: `teams`  
**Report title**: `Microsoft Teams Health Assessment Report`

**5 Categories** (keys: `lifecycleNaming, adoptionCulture, guestChannelStructure, appGovernance, collaborationGovernance`):
1. **Lifecycle & Naming** — Team and channel creation policies; naming convention enforcement; ownership assignment at provisioning; lifecycle management (expiry policies, archiving, inactive team remediation)
2. **Adoption & Culture** — Which departments use Teams as primary collaboration tool vs email; adoption barriers; training and enablement provided; executive modelling of Teams use
3. **Guest & Channel Structure** — External guest access controls and review processes; standard vs private vs shared channel governance; channel structure consistency; external collaboration policies
4. **App Usage Governance** — Third-party apps in Teams; app approval and governance policies; app catalogue governance; advanced feature usage (Copilot summaries, polls, breakout rooms)
5. **Collaboration Governance** — Meeting recording retention policies; information architecture within Teams; content findability; alignment between Teams and SharePoint governance policies

**Tier Upsells**:
- Beginner/Developing: M365 Tenant Health Audit or M365 Training & Enablement
- Emerging: Governance Foundations Package
- Advanced/Ready: Architect Essentials or Copilot Readiness Assessment

---

#### Migration Readiness Assessment (`/migration-readiness-quiz`)

**`quizType`**: `migration`  
**Report title**: `Cloud Migration Readiness Assessment Report`

**5 Categories** (keys: `sourceComplexity, permissionsMetadata, securityBlockers, timelineRealism, migrationGovernance`):
1. **Source Complexity & ROT** — Scale and platform of source environment; data volumes; Redundant/Obsolete/Trivial (ROT) data; whether a pre-migration clean-up phase is planned; legacy system dependencies
2. **Permissions & Metadata** — Permission complexity in source environment; inheritance vs unique permissions; metadata richness and tagging quality; whether permissions and metadata will migrate or be rebuilt
3. **IA & Security Blockers** — Information architecture blockers; regulatory and security requirements that could slow migration; legacy authentication systems; compliance framework migration obligations
4. **Timeline Realism** — Planned migration timeline and approach (phased vs big-bang); cut-over planning; schedule risks; resource constraints; executive commitment; prior failed migration attempts
5. **Migration Governance** — Migration project governance (owner, steering committee, communication plan); rollback procedures; success criteria; post-migration validation plan; end-user training scope

**Tier Upsells**:
- Beginner/Developing: Migration Readiness Assessment micro-offer
- Emerging: M365 Tenant Health Audit post-migration
- Advanced/Ready: Governance Foundations Package

---

#### Governance Maturity Assessment (`/governance-maturity-quiz`)

**`quizType`**: `governance`  
**Report title**: `M365 Governance Maturity Assessment Report`

**5 Categories** (keys: `policiesRoles, lifecycleManagement, securityComplianceControls, monitoringReporting, adoptionAccountability`):
1. **Policies & Roles** — Whether formal governance policies exist (acceptable use, data classification, naming conventions); who owns governance; RACI model; policy review frequency
2. **Lifecycle Management** — Team, site, group, and mailbox lifecycle policies; owner accountability processes; archiving and deletion procedures; inactive resource remediation; guest account expiry
3. **Security & Compliance Controls** — Technical enforcement of governance through M365 controls: Conditional Access, sensitivity labels, DLP policies, retention, Purview compliance framework implementation
4. **Monitoring & Reporting** — How governance compliance is monitored and reported; reports reviewed and by whom; governance audit frequency; tooling used (Compliance Manager, M365 admin reports)
5. **Adoption & Accountability** — How governance policies are communicated to end users and new joiners; training approach; accountability mechanisms for violations; exception handling and escalation

**Tier Upsells**:
- Beginner → Emerging: Governance Foundations Package (from $12,000)
- Advanced/Ready: Architect Essentials or Architect Growth Retainer

---

## 5. Quick Win Selector Quiz

### Overview

Route: `/quick-win-quiz`  
Component: `QuickWinsSelectorQuiz` (rendered inside a `QuickWinQuiz` page wrapper)  
Type: **Logic-based** (no AI, no lead capture — pure weighted scoring)  
Duration: 10 questions, ~2–3 minutes  
Output: Ranked recommendation of up to 3 Quick Win packages

### Quiz Mechanism

Each question has 4 answer options. Each option carries a `scores` map assigning 0–3 points to specific package slugs. After all 10 answers, slugs are ranked by accumulated points, highest first. The top 1–3 non-zero results are shown as recommendations.

### 6 Scoreable Package Slugs

| Slug | Package Name |
|---|---|
| `tenant-health-audit` | M365 Tenant Health Audit |
| `power-platform-quick-start` | Power Platform Quick-Start |
| `governance-foundations` | Governance Foundations Package |
| `migration-readiness-assessment` | Migration Readiness Assessment |
| `copilot-readiness-assessment` | Copilot for M365 Readiness Assessment |
| `m365-training-enablement` | Microsoft 365 Training & Enablement |

### 10 Questions and Scoring Logic

| Q# | Question Focus | Top Scoring Slug |
|---|---|---|
| 1 | Biggest M365 challenge right now | Matches stated challenge directly (3 pts) |
| 2 | Last formal tenant audit | `tenant-health-audit` if never/long ago; `copilot-readiness-assessment` if recent |
| 3 | Copilot deployment plans | `copilot-readiness-assessment` (3 pts) or `m365-training-enablement` (3 pts) |
| 4 | Data governance maturity | `governance-foundations` if ad hoc/on-paper; `copilot-readiness-assessment` if strong |
| 5 | Migration plans | `migration-readiness-assessment` if planned/evaluating; `tenant-health-audit` if recently migrated |
| 6 | Day-to-day M365 tool effectiveness | `m365-training-enablement` if poor/mixed; `power-platform-quick-start` if good but underusing automation |
| 7 | Manual repetitive processes | `power-platform-quick-start` (3 pts) |
| 8 | Tenant user count | `governance-foundations` for 1,000+; spread across all for mid-market |
| 9 | Compliance frameworks | `governance-foundations` + `tenant-health-audit` (2–3 pts each) |
| 10 | Desired outcome | Maps directly to matching package (3 pts) |

### Result Submission

On quiz completion, the client-side calls:

```
POST /api/quiz/quick-win/submit
Body: { answers: Record<questionId, selectedAnswerIndex>, scores: Record<slug, number>, rankedSlugs: string[] }
Response: { resultId: number }
```

On success: navigates to `/quick-win/results/:resultId` (server-stored results page).  
On failure: shows inline results in the quiz component (fallback).

### Results Page (`/quick-win/results/:resultId`)

Fetches stored results from `/api/quiz/quick-win/results/:resultId`. Displays:
- Top 3 ranked packages with "Best Match" badge on #1
- Each package: name, tagline, "View package details" link
- CTAs: "View All Quick Wins" and "Book a Discovery Call"

### Analytics (No PII)

The fallback `results` phase fires a fire-and-forget:

```
POST /api/quiz-selector/result
Body: { slugs: string[] }   // top 1–3 recommended slugs
```

Stored in `quiz_analytics_events` table (`eventName = "quick_wins_selector_result"`) for Admin Panel reporting. No PII collected.

---

## 6. Lead Capture Pipeline

### Architecture Note: Two Parallel Tracking Systems

The site uses **two separate lead tracking systems** that do not merge automatically:

| System | Table | What it holds | How accessed |
|---|---|---|---|
| **Quiz Leads** | `quiz_leads` | Full quiz conversations, AI scores, tier, PDF delivery metadata | Admin Panel → Quiz Leads |
| **CRM Leads** | `leads` | Contact/purchase-sourced leads, status, scoring, opportunities | Admin Panel → CRM / Leads |

Quiz submission writes to `quiz_leads` only. A quiz respondent enters the `leads` table only if they separately submit the contact form, download a lead magnet, or complete a Stripe purchase.

### All Lead Entry Points

| Source | Table(s) written | Endpoint / Trigger |
|---|---|---|
| Assessment quiz submission | `quiz_leads` | `POST /api/quiz/submit` |
| Resources lead magnet (checklist download) | `leads` (`source: "lead_magnet"`) | `POST /api/leads` (client-side) |
| Contact AI chat (when AI has name + email) | `leads` (`source: "contact_form"`) | `POST /api/leads` (client fires after AI signals completion) |
| Stripe checkout completed | `leads` (`source: "purchase"`, `status: "converted"`) | `ensureLeadForClient()` inside Stripe webhook |
| SOW delivery | `opportunities` (promoted from `leads`) | `ensureOpportunityForSow()` inside SOW delivery flow |

### Quiz Submission — Detailed Flow

```
1. Visitor lands on quiz page (one of 9 assessment routes)
2. Visitor completes 10 AI-powered questions (Claude Haiku via /api/quiz/chat)
3. Visitor submits name + email + (optional) company
4. POST /api/quiz/submit { name, email, company, conversation[], quizType } fires:

   STEP A — AI scoring:
     Claude Haiku reads the full conversation and returns JSON:
     { categoryScores: { key: 0-10, ... }, recommendedService, whatThisMeans,
       whyThisFits, roiProjection }
     Tier is derived server-side from totalScore:
       ≥46 → Ready, ≥36 → Advanced, ≥26 → Emerging, ≥16 → Developing, else Beginner

   STEP B — quiz_leads INSERT:
     { name, email, company, quizType, conversation (JSON array), categoryScores (JSON),
       totalScore (sum of categoryScores), tier, analysisText (JSON), recommendedService }
     Returns leadId.

   STEP C — Admin notifications (fire-and-forget, non-blocking):
     INSERT into notifications table for every user WHERE role = 'admin'
     sendWebPushToAdmins({ title: "New quiz lead: <name>", body: "<company> — <tier>" })
     Send email notification to Shane's ADMIN_EMAIL via Resend

   STEP D — PDF generation and email (fire-and-forget, non-blocking):
     generateQuizPdf(pdfData) — pdf-lib server-side
     sendEmailWithAttachment(lead email, subject, brandedHtml, [pdf attachment])

   STEP E — Response:
     { success, leadId, resendToken, totalScore, tier, recommendedService,
       categoryScores, serviceDescription, whatThisMeans, whyThisFits, roiProjection }

5. Frontend shows results modal (score, tier, recommendation, share link)
6. Quiz lead visible in Admin Panel under "Quiz Leads" with full conversation log
   — it does NOT appear in CRM Leads unless a separate action creates it there
```

### CRM Lead Lifecycle (`leads` table)

```
new → contacted → qualified → converted
```

| Status | Trigger |
|---|---|
| `new` | Contact form submission, lead magnet download, or Stripe purchase |
| `contacted` | Admin manually updates status in Admin Panel |
| `qualified` | SOW delivered or lead manually promoted |
| `converted` | Stripe purchase completed (set immediately by `ensureLeadForClient`) |

### Opportunities (`opportunities` table)

Created or promoted via `ensureOpportunityForSow()` when a SOW document is delivered to a client. This links a CRM lead to a formal opportunity record with a service name and SOW metadata.

### Lead Scoring Engine (Admin Panel utility — not part of quiz flow)

`lead-scorer.ts` scores existing `leads` records in the Admin Panel. It is a CRM analytics utility, not part of the quiz submission path. It computes a composite 0–100 score from five dimensions:

| Dimension | Max | Key Signals |
|---|---|---|
| **Fit** | 25 | Employee count (500+ = 12pts, 100–499 = 8pts), high-fit industry (+7pts), license tier (E3/E5 = +6pts) |
| **Pain** | 30 | Pain point keywords: governance (8), compliance (8), security (7), migration (7), copilot (6), sharepoint/power platform (5) |
| **Maturity** | 20 | IT team size, tenant age, maturity indicators (dedicated IT team, existing M365, previous consultant) |
| **Intent** | 15 | Engagement signals: lead magnet (+4), contact form (+3), completed quiz (+4), pricing page visit (+4), referral (+4) |
| **Urgency** | 10 | Urgency signals: audit deadline (+4), compliance deadline (+4), board mandate (+3), budget approved (+3) |

### Next Best Action Logic (Admin Panel utility — not part of quiz flow)

`determineNextStep()` in `lead-scorer.ts` suggests follow-up workflow types for CRM `leads` records viewed in the Admin Panel:

| Score + Pain | Recommended Next Step |
|---|---|
| Pain includes "governance" or "compliance", score ≥ 65 | Governance Assessment or Compliance Review |
| Pain includes "copilot" or "ai" | Copilot Readiness |
| Score ≥ 75 | Proposal Prep |
| Score ≥ 60 + tenant/migration pain | Tenant Health Audit |
| Score ≥ 60 | Discovery Call |
| All others | Discovery Call |

---

## 7. Micro-Offers Catalog and Checkout Flow

### Catalog (`/micro-offers`)

Lists all Quick Win packages grouped into three tiers:

| Tier | Color | Purpose | Offers |
|---|---|---|---|
| **Entry** | Electric Blue | Baseline assessment — ideal starting point | M365 Tenant Health Audit, Migration Readiness Assessment |
| **Core** | Bright Teal | Targeted deliverables for a specific problem | Power Platform Quick-Start, Copilot for M365 Readiness Assessment |
| **Strategic** | Amber | In-depth assessments for regulated/complex environments | Governance Foundations Package |

Service cards are loaded dynamically from `/api/services?type=micro_offer`. Each card shows: name, price, turnaround, key inclusions, "View Overview" button (opens `ServiceOverviewModal` — a gated PDF overview requiring email capture), and "Get Started" CTA.

A "Not sure which package fits?" quiz CTA at the top links to `/quick-win-quiz`.

### Individual Package Detail (`/micro-offers/:slug`)

Each package has a full detail page with:
1. **Hero** — Package name, badge (tier/price), turnaround, primary CTAs.
2. **Problem Statement** — Specific pain this package solves.
3. **Deliverables** — Exact list of what the client receives.
4. **How It Works** — 3–4 step engagement process.
5. **Ideal Client Profile (ICP)** — Company size (200–2,000), industries (Healthcare, Legal, Financial, Gov Contractors, Defense), decision maker roles (IT Director, VP IT, CTO, CISO), licensing profile (M365 E3/E5), revenue band ($20M–$500M).
6. **Investment** — Price display (flat fee or range), comparison to alternatives.
7. **TestimonialDiscountCallout** — Social proof + urgency component.
8. **CTA** — "Start This Package" → CRM onboarding or Stripe checkout.

### Service Overview Modal (PDF Lead Gate)

The `ServiceOverviewModal` component:
1. Visitor clicks "View Overview" on a micro-offer card.
2. Modal opens with the package overview content.
3. If visitor has not provided email: email capture form shown.
4. On form submit: `POST /api/leads` with `source: "lead_magnet"`.
5. PDF overview is then displayed/downloaded.

This creates a `lead_magnet` status lead before the visitor has purchased.

### End-to-End Checkout Flow

```
1. Visitor on micro-offer page or CRM onboarding
2. Clicks "Get Started" / "Start This Package"
       │
       ▼
3. CRM Portal: /crm/portal/onboarding/select
   (if via landing page: LP access token validated first)
       │
       ▼
4. Client selects service, reviews SOW
       │
       ▼
5. Payment options (Stripe checkout or invoice)
   - POST /api/portal/checkout/session { serviceId }
   - Stripe creates Checkout Session (price from DB)
       │
       ▼
6. Stripe Checkout hosted page
       │
       ▼ (payment success)
7. Stripe webhook fires: checkout.session.completed
       │
       ├── POST /api/webhooks/stripe
       ├── Creates user account (if new client)
       ├── Creates client service record
       ├── Fires ensureLeadForClient() → CRM lead created/linked
       ├── Sends SMS to Shane via Twilio (if secrets configured)
       ├── Triggers automated project onboarding
       └── Sends welcome email via Resend
       │
       ▼
8. Client redirected to /crm/portal — project is live
```

---

## 8. Retainer Plans and Quiz Flow

### Three Retainer Tiers

| Plan | Route | Price (fallback) | Hours/Month | Response Time |
|---|---|---|---|---|
| **Architect Essentials** | `/retainers/architect-essentials` | $1,500/mo¹ | 10 hours | 1 business day |
| **Architect Growth** | `/retainers/architect-growth` | $6,000/mo | 25 hours | 2 hours (business hours) |
| **Architect Enterprise** | `/retainers/architect-enterprise` | $11,000/mo | 50 hours | Same day |

Prices and hours are loaded from `/api/services` (retainer service records). Fallback values display if the API is unavailable.

¹ **Essentials pricing inconsistency in current code**: `ArchitectEssentials.tsx` falls back to `$1,500`, `RetainerSelectorQuiz.tsx` uses `$1,500` in the result card, but `RetainersOverview.tsx` falls back to `$2,500`. The database value is authoritative; both fallbacks exist in source as of the current build.

### Architect Essentials

**Best for**: Mid-market orgs (200–2,000 employees) in stable state; regulated industries needing ongoing expert oversight; IT teams with a senior escalation gap; orgs evaluating Copilot or SharePoint modernization.

**Typical Month**:
- Week 1: 60-min strategy call, review tenant health and priorities
- Week 2: Async delivery on agreed priority (architecture review, governance policy draft, Teams topology, Copilot checklist, licensing analysis)
- Week 3: Async implementation support or policy review
- Week 4: Written monthly summary + risks + next-month priorities

**Not included**: Full project execution, unlimited meetings, MSP helpdesk, device management.

**Primary CTA**: "Book a Discovery Call" → `/book`

---

### Architect Growth

**Best for**: Orgs mid-way through M365 modernization or Copilot rollout; regulated industries (finance, healthcare, federal contractors); complex SharePoint/Teams/Power Platform environments; companies that have outgrown ad-hoc consulting.

**Features**:
- 25 hours/month consulting
- 2-hour priority response (business hours)
- Two 60-min strategy calls/month
- 8 hours hands-on configuration and build
- Architecture design and modernization roadmap
- Governance and security framework builds
- Copilot adoption framework and readiness scoring
- Power Platform solution oversight
- Proactive tenant health monitoring
- Monthly written summary + risks + recommendations

**Not included**: Full project execution, unlimited unscheduled calls, MSP ticket handling, device management.

---

### Architect Enterprise

**Best for**: Regulated industries and complex governance environments (healthcare, finance, federal, defense primes); multi-workload M365 deployments (SharePoint + Teams + Power Platform + Copilot + Entra ID simultaneously); orgs deploying Copilot at scale; organizations needing weekly architecture leadership.

**Features**:
- 50 hours/month consulting
- Same-day response (business hours)
- Weekly 60-min architecture leadership sessions
- Unlimited async support via dedicated Teams/Slack channel
- Governance framework builds and policy authoring
- Copilot for M365 deployment leadership
- Power Platform guardrails and Center of Excellence setup
- Quarterly Roadmap Review with leadership team
- Proactive tenant health monitoring + risk flagging
- Monthly written architecture summary

**Not included**: Project execution, unlimited unscheduled live meetings, MSP helpdesk, device management.

---

### Retainers Overview Page (`/retainers`)

**Title**: `Fractional Microsoft 365 Architecture — Monthly Retainer Plans | Shane McCaw Consulting`

**Content Sections**:
1. **Hero** — "Senior M365 Architecture Without the Full-Time Hire" headline.
2. **Three-column plan comparison** — Cards from API with pricing, hours, features list.
3. **Comparison Table** — Tabular feature comparison across all three tiers.
4. **Who Retainers Are For** — ICP description.
5. **Retainer Selector Quiz CTA** — Links to `/retainer-quiz`.
6. **ConsultationCTA** — Bottom CTA.

---

### Retainer Selector Quiz (`/retainer-quiz`)

**Type**: Logic-based (no AI, no lead capture — weighted scoring across three tier keys)  
**Component**: `RetainerSelectorQuiz` (used inside `RetainerQuiz` page)  
**Duration**: 10 questions, ~2 minutes  
**Output**: Recommendation of Essentials, Growth, or Enterprise

The quiz scores each answer against three `TierKey` values (`"Essentials"`, `"Growth"`, `"Enterprise"` — capitalized). Each of the 10 questions has three options mapping to the three tiers. After all questions, the tier with the highest accumulated score is returned by `determineTier()` (Enterprise beats Growth in a tie, Growth beats Essentials). Results render inline in the same page (no navigation) and show:
- Recommended plan headline (e.g., "Architect Growth")
- Price and hours summary
- Plan explanation paragraph
- Two CTAs: "See the [Plan] Plan" → retainer detail page, "Book a Discovery Call" → `/book`
- "Compare all retainer tiers" section: 3-column grid linking to all three retainer detail pages, with the recommended tier highlighted in Electric Blue

No alignment percentages are shown. No "alternative plan suggestions" text — the alternative plans are simply linked in the 3-column comparison grid. "Retake the quiz" button resets to Question 1.

---

## 9. Landing Page System (`/lp/:slug`)

### Overview

The `/lp/:slug` route renders dynamic, CMS-driven marketing landing pages. Slugs are managed via the Admin Panel. Each slug maps to a `landing_pages` database record that contains structured content fields and an array of layout blocks.

### Data Fetching

```
GET /api/landing-pages/:slug          → public page (must be published)
GET /api/landing-pages/:slug?preview=<token>  → preview unpublished page
```

If the slug is not found or unpublished (without preview token), a "Page Not Found" state is shown.

### Landing Page Data Schema

| Field | Type | Description |
|---|---|---|
| `slug` | string | URL identifier |
| `title` | string | Page `<title>` tag |
| `headline` | string | Hero H1 text |
| `subheadline` | string | Hero subtitle |
| `valuePropBlocks` | array | Up to 3 icon + heading + body value proposition items |
| `cta` | object | `{ buttonText, href, subtext }` — primary CTA configuration |
| `published` | boolean | Controls public visibility |
| `linkedService` | object | Optional linked service (for LP-only gated offers) |
| `layoutBlocks` | array | Ordered content blocks (see below) |

### Layout Block Types

Each block has a `blockType` string and a `content` object. Blocks render in the order they appear in the array.

| blockType | Description | Key content fields |
|---|---|---|
| `why_this_matters` | Full-width body text with "Why This Matters" label | `body` |
| `authority` | Dark navy section: Shane's bio, compliance badges, stats | `heading`, `body`, `complianceBadges[]`, `stats[]` |
| `process` | Numbered step cards (horizontal desktop, vertical mobile) | `steps[]` — each with `step`, `title`, `description`, `note` |
| `trust_badges` | Badge strip (rendered in hero, not standalone section) | `badges[]` |
| `rich_text` | Prose section with optional checklist list | `title`, `body`, `list[]` |
| `faq` | Accordion FAQ with "Questions Answered" label | `title`, `items[]` — each with `q`, `a` |
| `testimonials` | Three-column testimonial cards | `items[]` — each with `quote`, `author`, `role`, `company` |
| `problem_solution` | Side-by-side problem (red) and solution (blue) cards | `problem`, `solution`, `bullets[]` |
| `checklist` | Two-column grid of checkmark items | `title`, `items[]` |
| `stats_bar` | Dark navy horizontal stats strip | `stats[]` — each with `value`, `label` |
| `featured_quote` | Centered large blockquote | `quote`, `attribution` |
| `quiz_cta` | Quiz link section with pulsing badge | `quizType`, `title`, `description`, `buttonText` |

### Three Landing Page Use-Cases

#### 1. Token-Gated Offers (`linkedService.visibility = "landing_page_only"`)

Used for exclusive or private service offerings that are only accessible through this LP. Flow:
1. Visitor arrives at `/lp/:slug`.
2. Page renders with CTA button showing "Sign Up to Access."
3. Visitor clicks CTA → `POST /api/landing-pages/:slug/token` → server issues a time-limited LP access token.
4. Token stored in `sessionStorage` (`onboardingLpToken`) and `localStorage` (keyed by expiry timestamp).
5. Browser redirects to `/crm/portal/onboarding/select?serviceId=<id>`.
6. CRM validates the token before proceeding with onboarding.

#### 2. Lead Magnets

LP links to an assessment quiz or download. `cta.href` points to a quiz route (e.g., `/copilot-quiz`). No token logic — standard navigation. The `quiz_cta` layout block is used to embed a quiz invitation inline.

#### 3. Service-Specific Campaign Pages

LP mirrors a specific micro-offer or retainer page with custom copy. `cta.href` links directly to `/book` or `/micro-offers/:slug`. No token gating.

### LP CRM Effects

Any LP interaction that proceeds to the CRM onboarding flow results in:
1. User account creation (if new client) via Stripe checkout.
2. `ensureLeadForClient()` call — lead created or existing lead linked to new user.
3. Service project auto-created in CRM portal.

---

## 10. Contact, Book, and Resources Flows

### Contact Page (`/contact`)

**Title**: `Contact Shane McCaw | Microsoft 365 Architect — Vero Beach, FL`

**Lead Collection Method**: AI-powered conversational chat interface (not a static form).

**Chat Flow** (single endpoint — `POST /api/contact-chat` handles both init and ongoing conversation):
1. Page loads → `POST /api/contact-chat { messages: [] }` (empty array = initialization). AI assistant replies with a greeting/first question. No separate init endpoint.
2. Visitor types messages in the chat input (textarea). **Enter** sends the message; **Shift+Enter** inserts a newline.
3. Each user turn → `POST /api/contact-chat { messages: [...full conversation...] }` → AI (Claude) responds with `{ reply: string, lead?: LeadPayload }`.
4. AI conversationally gathers: name, email, company, company size, service area of interest, how they found the site, their specific question or message.
5. When the AI has collected enough information, the response includes a `lead` object. If name or email is missing, the assistant prompts for them. Once both are present, the client fires `POST /api/leads { name, email, company, companySize, serviceArea, message, source: "contact_form", howFound }`.
6. `identifyLead(email)` is called for analytics tracking.
7. Submitted state shown: "Message received" confirmation with "Book a Free Call" CTA.

**AI behavior**: The AI assistant is instructed to be helpful and qualify the lead through natural conversation, not interrogate them with form-style questions.

**Sidebar content**: Email address, "Vero Beach, FL" location, response time expectation.

---

### Book Page (`/book`)

**Title**: `Book a Free Discovery Call | Shane McCaw — NASA's Lead Microsoft 365 Architect`

**Purpose**: Direct scheduling for 30-minute discovery calls. No lead capture form — scheduling is the action.

**Content Sections**:
1. **Hero** — "Book Your Free 30-Minute Discovery Call." Positions as a working session, not a sales call.
2. **What to Expect** — 4 bullet points: assess M365 environment, identify 2–3 quick wins, discuss fit with transparency, walk away with clarity and actionable next steps.
3. **What This Call Is NOT** — 5 negatives: not a sales pitch, not generic advice, not a commitment, not handed to a junior, not a 90-minute deep-dive.
4. **Outcomes** — 4 outcomes: picture of biggest M365 gaps, 2–3 quick wins implementable immediately, honest fit guidance, zero pressure.
5. **Calendar Booking** — `CalendarBooking` component reading Shane's real Exchange Online calendar via Microsoft Graph API. Shows available slots dynamically. If Graph credentials are absent, shows a clear placeholder state (no crash).

**Graph API Integration**: `Calendars.Read` + `Calendars.ReadWrite` application permissions required on the service principal (`GRAPH_CLIENT_ID`). Uses `GRAPH_MAIL_USER_ID` mailbox.

---

### Resources Page (`/resources`)

**Title**: `Microsoft 365 & Copilot AI Insights — Resources & Articles | Shane McCaw Consulting`

**Purpose**: Content library for SEO and lead generation.

**Content Sections**:
1. **Hero** — "Expert Insights. Practical Guidance." headline.
2. **Resource Library Overview** — Three category cards: Articles (from the article library), Assessments (links to quiz pages), Downloads (lead magnet).
3. **Start Here** — Scenario-to-resource mapping: "We're planning a Copilot rollout" → Copilot quiz; "Our governance is a mess" → Governance quiz; "We're migrating from Exchange on-prem" → Migration quiz; etc.
4. **Lead Magnet** — "Copilot for M365 Readiness Checklist" — email + name capture form. On submit:
   - `POST /api/leads { name, email, source: "lead_magnet" }` creates a CRM lead.
   - Client-side generates a PDF using `@react-pdf/renderer` (`CopilotReadinessPDF` component).
   - PDF downloaded directly in browser (no server-side generation).
5. **Article Filter Bar** — Category buttons: All, Copilot AI Tips, M365 Best Practices, Power Platform How-Tos, Governance & Compliance, Digital Transformation.
6. **Article Grid** — Filterable grid of article cards from the static `articles` data. Each card shows: title, category badge, read time, short excerpt, share count (from `/api/shares`), share buttons (LinkedIn, X), "Read Article" link.

**Share Counts**: Fetched from `GET /api/shares` on mount. Updates when articles are shared (tracked server-side).

---

### Article Page (`/resources/:slug`)

**Title**: `<article.title> | Shane McCaw Consulting`

**Purpose**: Individual long-form article reader.

**Content Sections** (in order):
1. **Dark Navy Hero** — Back link (`← Back to Resources`), article category badge, date, read time, article H1 title, summary paragraph.
2. **Article body** — `react-markdown` rendered Markdown with custom component overrides (`h2`, `h3`, `p`, `ul`, `li`, `blockquote`, `strong`). Content from `src/content/articles/<slug>.md`.
3. **Author Bio** — `AuthorBio` component immediately after the article body: Shane's name, NASA role, 30-year experience description.
4. **Share section** (single, at bottom) — "More articles" back link + `<ShareButtons>` component: LinkedIn `<a>` tag (share-offsite URL), X/Twitter `<a>` tag (intent/tweet URL), "Copy link" clipboard button. These are plain link/button elements — no `POST` call is made from `ArticlePage`.
5. **ConsultationCTA** — Full-width bottom CTA section.

**JSON-LD**: Each article page includes an `Article` schema with `headline`, `description`, `datePublished`, `url`, `author` (Person: Shane McCaw), and `publisher` (Organization: Shane McCaw Consulting). Note: article share counts are tracked in `Resources.tsx` (the listing page), not in `ArticlePage.tsx`.

**Available Articles** (from `src/content/articles/`):

| Filename | Category |
|---|---|
| `copilot-rollout-failing.md` | Copilot AI Tips |
| `dlp-sensitivity-labels.md` | Governance & Compliance |
| `m365-migration-checklist.md` | M365 Best Practices |
| `m365-tenant-health-check.md` | M365 Best Practices |
| `power-automate-approval-workflows.md` | Power Platform How-Tos |
| `sharepoint-intranet-architecture.md` | M365 Best Practices |

---

## 11. SEO and Meta Structure

### SEOMeta Component

All pages use the `SEOMeta` component (`src/components/SEOMeta.tsx`) which imperatively sets meta tags via DOM manipulation (not react-helmet).

**Tags set on every page**:
- `document.title`
- `meta[name="description"]`
- `meta[property="og:type"]` = `"website"`
- `meta[property="og:site_name"]` = `"Shane McCaw Consulting"`
- `meta[property="og:title"]`
- `meta[property="og:description"]`
- `meta[property="og:image"]` (absolute URL)
- `meta[property="og:url"]` (when `ogUrl` prop provided)
- `meta[name="twitter:card"]` = `"summary_large_image"`
- `meta[name="twitter:title"]`
- `meta[name="twitter:description"]`
- `meta[name="twitter:image"]`

### OG Image Strategy

**Default OG image**: `/og-image.png` (used as fallback when no `ogImage` prop is passed to `SEOMeta`).

**Pages with custom OG images** (page-specific `ogImage` prop overrides the default):

| Page | OG Image File |
|---|---|
| SharePoint service page | `/og-image-sharepoint.png` |
| Power Platform service page | `/og-image-power-platform.png` |
| Cloud Migration service page | `/og-image-cloud-migration.png` |
| M365 Health Assessment quiz | `/og-image-m365-health-quiz.png` |
| SharePoint Architecture Assessment quiz | `/og-image-sharepoint-quiz.png` |
| Power Platform Maturity Assessment quiz | `/og-image-power-platform-quiz.png` |
| Security & Compliance Assessment quiz | `/og-image-security-quiz.png` |
| Teams Health Assessment quiz | `/og-image-teams-quiz.png` |
| Migration Readiness Assessment quiz | `/og-image-migration-quiz.png` |
| Governance Maturity Assessment quiz | `/og-image-governance-quiz.png` |

**Pages that do NOT use `SEOMeta`** (and therefore have no dynamic meta injection):
- `CopilotQuiz.tsx` — manages its own page without `SEOMeta`
- `LandingPage.tsx` — dynamic CMS-driven pages; meta is not overridden via `SEOMeta`

All other pages use `SEOMeta` with page-specific `title` and `description` props and fall back to `/og-image.png` for social sharing images.

The `SEOMeta` component converts relative image paths (starting with `/`) to absolute URLs using `window.location.origin` before injecting them into `og:image` and `twitter:image` meta tags.

### Meta Description Patterns by Page Type

| Page Type | Pattern |
|---|---|
| Home | "NASA Lead M365 Architect + service area + value prop" |
| Service pages | "Service name + specific deliverable + Shane's credential" |
| Quiz/Assessment pages | "Assessment type + what you get (PDF report) + time estimate" |
| Quick Win detail | "Package name + price anchor + specific deliverable" |
| Retainer pages | "Retainer name + hours + response time + who it's for" |
| Resources/Articles | "Article title + specific M365 insight preview" |
| Book | "Free 30-min call + NASA credential + no sales pitch" |

### JSON-LD Structured Data

| Page | Schema Type | Key Fields |
|---|---|---|
| Home | `ProfessionalService` | name, description, serviceType, areaServed, provider |
| Services overview | `OfferCatalog` | name, description, itemListElement (each service as `Offer`) |
| Micro-offers catalog | `ItemList` | itemListElement (each offer as `ListItem` > `Offer` with price/priceCurrency) |
| Pricing | `ItemList` + `FAQPage` | FAQ items as `Question`/`Answer` pairs |
| Individual articles (`/resources/:slug`) | `Article` | headline, description, datePublished, url, author (Person), publisher (Organization) |

Structured data is injected as a `<script type="application/ld+json">` tag with id `jsonld-page`. Updated on route change. Only one JSON-LD block is active at a time.

### Sitemap

A static `sitemap.xml` exists at `artifacts/shane-mccaw-consulting/public/sitemap.xml` and is served at `/sitemap.xml`. It is **hand-authored** — not auto-generated. Known gap: new articles published via the Admin Panel and new landing pages created via the CMS do not automatically appear in the sitemap. Any new public route must be added to `public/sitemap.xml` manually after creation.

### Analytics

The analytics module (`src/lib/analytics.ts`) exports:
- `initTracker()` — called once on app mount
- `trackPageview(path)` — called on every route change
- `trackEvent(name, properties)` — called for specific interactions (quiz starts, CTA clicks marked with `data-track="nav"`)
- `identifyLead(email)` — called when a lead's email is captured

The implementation in `analytics.ts` integrates with whatever analytics provider is configured (structure is provider-agnostic from the page components' perspective).
