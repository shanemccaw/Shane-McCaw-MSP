# Shane McCaw Consulting — Website Documentation

**Generated:** July 9, 2026  
**Source:** Live page source files in `artifacts/shane-mccaw-consulting/src/pages/` and `src/App.tsx`

---

## Brand Overview

| Element | Value |
|---------|-------|
| **Brand Name** | Shane McCaw Consulting |
| **Positioning** | NASA's Lead M365 Architect — available to your organization on a fractional basis |
| **Primary Color** | Deep Navy `#0A2540` |
| **Accent Color** | Electric Blue `#0078D4` |
| **Highlight Color** | Bright Teal `#00B4D8` |
| **Background** | Off-White `#F7F9FC` |
| **Font** | Inter |
| **Founder** | Shane McCaw — Lead Microsoft 365 Architect & Copilot SME at NASA; 30-year Microsoft ecosystem veteran |

All pages share a global Layout: a Header (transparent on `/`, solid Deep Navy on all other routes) and a Footer.

---

## Table of Contents

**Page Sections**

- [§1 — Home (`/`)](#1--home-)
- [§2 — About (`/about`)](#2--about-about)
- [§3 — Services Hub (`/services`)](#3--services-hub-services)
- [§4 — Microsoft 365 Architecture (`/services/microsoft-365`)](#4--microsoft-365-architecture-servicesmicrosoft-365)
- [§5 — Copilot AI (`/services/copilot-ai`)](#5--copilot-ai-servicescopilot-ai)
- [§6 — SharePoint (`/services/sharepoint`)](#6--sharepoint-servicessharepoint)
- [§7 — Power Platform (`/services/power-platform`)](#7--power-platform-servicespower-platform)
- [§8 — Governance Foundations (`/services/governance`)](#8--governance-foundations-servicesgovernance)
- [§9 — Cloud Migration (`/services/cloud-migration`)](#9--cloud-migration-servicescloud-migration)
- [§10 — M365 Training (`/services/m365-training`)](#10--m365-training-servicesm365-training)
- [§11 — Security Hardening (`/services/security-hardening`)](#11--security-hardening-servicessecurity-hardening)
- [§12 — Quick Wins (`/quick-wins`)](#12--quick-wins-quick-wins)
- [§13 — Quick Win Detail (`/quick-wins/:slug`)](#13--quick-win-detail-quick-winsslug)
- [§14 — Pricing (`/pricing`)](#14--pricing-pricing)
- [§15 — Resources (`/resources`)](#15--resources-resources)
- [§16 — Article Page (`/resources/:slug`)](#16--article-page-resourcesslug)
- [§17 — Contact (`/contact`)](#17--contact-contact)
- [§18 — Book (`/book`)](#18--book-book)
- [§19 — Privacy Policy (`/privacy`)](#19--privacy-policy-privacy)
- [§20 — Admin Redirect (`/admin`)](#20--admin-redirect-admin)
- [§21 — Customer Command Center (`/customer-command-center`)](#21--customer-command-center-customer-command-center)
- [§22 — Copilot Quiz (`/copilot-quiz`)](#22--copilot-quiz-copilot-quiz)
- [§23 — M365 Health Quiz (`/m365-health-quiz`)](#23--m365-health-quiz-m365-health-quiz)
- [§24 — SharePoint & Intranet Readiness Quiz (`/sharepoint-readiness-quiz`)](#24--sharepoint--intranet-readiness-quiz-sharepoint-readiness-quiz)
- [§25 — Power Platform Maturity Quiz (`/power-platform-quiz`)](#25--power-platform-maturity-quiz-power-platform-quiz)
- [§26 — Security & Compliance Maturity Quiz (`/security-compliance-quiz`)](#26--security--compliance-maturity-quiz-security-compliance-quiz)
- [§27 — Teams Collaboration Maturity Quiz (`/teams-maturity-quiz`)](#27--teams-collaboration-maturity-quiz-teams-maturity-quiz)
- [§28 — Migration Readiness Quiz (`/migration-readiness-quiz`)](#28--migration-readiness-quiz-migration-readiness-quiz)
- [§29 — Governance Maturity Quiz (`/governance-maturity-quiz`)](#29--governance-maturity-quiz-governance-maturity-quiz)
- [§30 — Quiz Results Page (`/quiz/results/:leadId`)](#30--quiz-results-page-quizresultsleadid)
- [§31 — Retainers Overview (`/retainers`)](#31--retainers-overview-retainers)
- [§32 — Quick Win Quiz (`/quick-win-quiz`)](#32--quick-win-quiz-quick-win-quiz)
- [§33 — Quick Win Results Page (`/quick-win/results/:resultId`)](#33--quick-win-results-page-quick-winresultsresultid)
- [§34 — Retainer Quiz (`/retainer-quiz`)](#34--retainer-quiz-retainer-quiz)
- [§35 — Architect Essentials Retainer (`/retainers/architect-essentials`)](#35--architect-essentials-retainer-retainersarchitect-essentials)
- [§36 — Architect Growth Retainer (`/retainers/architect-growth`)](#36--architect-growth-retainer-retainersarchitect-growth)
- [§37 — Architect Enterprise Retainer (`/retainers/architect-enterprise`)](#37--architect-enterprise-retainer-retainersarchitect-enterprise)
- [§38 — Technical Overview (`/how-it-works/technical`)](#38--technical-overview-how-it-workstechnical)
- [§39 — How It Works (`/how-it-works`)](#39--how-it-works-how-it-works)
- [§40 — Assessments (`/assessments`)](#40--assessments-assessments)
- [§41 — Landing Pages (`/lp/:slug`)](#41--landing-pages-lpslug)

**Appendices**

- [Appendix A — Global Navigation](#appendix-a--global-navigation)
- [Appendix B — Key CTAs by Page](#appendix-b--key-ctas-by-page)
- [Appendix C — Pricing Reference](#appendix-c--pricing-reference-verbatim-from-source)

---

## Complete Route Registry

All routes registered in `src/App.tsx`:

| Route | Component | Section |
|-------|-----------|---------|
| `/` | Home | §1 |
| `/about` | About | §2 |
| `/services` | Services | §3 |
| `/services/microsoft-365` | Microsoft365 | §4 |
| `/services/copilot-ai` | CopilotAI | §5 |
| `/services/sharepoint` | SharePoint | §6 |
| `/services/power-platform` | PowerPlatform | §7 |
| `/services/governance` | Governance | §8 |
| `/services/cloud-migration` | CloudMigration | §9 |
| `/services/m365-training` | M365Training | §10 |
| `/services/security-hardening` | SecurityHardening | §11 |
| `/quick-wins` | MicroOffers | §12 |
| `/quick-wins/:slug` | MicroOfferDetail | §13 |
| `/pricing` | Pricing | §14 |
| `/resources` | Resources | §15 |
| `/resources/:slug` | ArticlePage | §16 |
| `/contact` | Contact | §17 |
| `/book` | Book | §18 |
| `/privacy` | Privacy | §19 |
| `/admin` | Admin | §20 |
| `/customer-command-center` | CustomerCommandCenter | §21 |
| `/copilot-quiz` | CopilotQuiz | §22 |
| `/m365-health-quiz` | M365HealthQuiz | §23 |
| `/sharepoint-readiness-quiz` | SharePointQuiz | §24 |
| `/power-platform-quiz` | PowerPlatformQuiz | §25 |
| `/security-compliance-quiz` | SecurityQuiz | §26 |
| `/teams-maturity-quiz` | TeamsQuiz | §27 |
| `/migration-readiness-quiz` | MigrationQuiz | §28 |
| `/governance-maturity-quiz` | GovernanceQuiz | §29 |
| `/quiz/results/:leadId` | QuizResultsPage | §30 |
| `/retainers` | RetainersOverview | §31 |
| `/quick-win-quiz` | QuickWinQuiz | §32 |
| `/quick-win/results/:resultId` | QuickWinResultsPage | §33 |
| `/retainer-quiz` | RetainerQuiz | §34 |
| `/retainers/architect-essentials` | ArchitectEssentials | §35 |
| `/retainers/architect-growth` | ArchitectGrowth | §36 |
| `/retainers/architect-enterprise` | ArchitectEnterprise | §37 |
| `/how-it-works/technical` | TechnicalOverview | §38 |
| `/how-it-works` | HowItWorks | §39 |
| `/assessments` | Assessments | §40 |
| `/lp/:slug` | LandingPage | §41 |

---

## §1 — Home (`/`)

**Purpose:** Primary marketing homepage. Introduces Shane, showcases services, explains the engagement process, and drives discovery-call bookings.

**SEO Title:** `Enterprise Microsoft 365 & Copilot AI Consulting | Shane McCaw Consulting`  
**SEO Description:** `Shane McCaw is NASA's Lead Microsoft 365 Architect — 30 years of Microsoft expertise, delivering M365 tenant audits, Copilot AI readiness, SharePoint, and governance. Fixed-price packages, senior-level delivery.`

### Layout / Sections

**1. Hero**
- **Kicker pill:** `Current Microsoft 365 Architect & Copilot SME — NASA`
- **Credential badges:** `Lead M365 Architect at NASA` · `30 Years Microsoft Ecosystem Experience`
- **H1:** `The Architect Who Built at NASA Scale — Available to You.`
- **Tagline:** `Mission-critical Microsoft 365 architecture for mid-market and regulated organizations — without a full-time hire.`
- **Body:** *Shane McCaw brings the same discipline he built at NASA to your organization. Fixed-price assessments. Fractional architecture retainers. Senior Microsoft expertise delivered personally — no account managers, no offshore handoffs.*
- **CTAs:** `Book a Discovery Call` → `/book` | `Start with the Free Copilot Snapshot` → `/lp/copilot-readiness-lead-generation-campaign`
- **Hero footnote:** *No call required — connect your tenant, watch the diagnosis run, get a scoped proposal.*
- **Capability badges (bottom of hero):** `Fractional M365 Architecture` · `Copilot AI Readiness` · `Governance & Compliance` · `Cloud Migration` · `30+ Years Microsoft Experience`

**2. Who I Work With (3 cards)**
- **Kicker:** `Who I Work With`
- **H2:** `Organizations With Real Complexity — and the Ambition to Fix It`
- **Subtext:** *Shane works best with organizations that have outgrown generic IT support and need a senior Microsoft architect who has solved problems at mission-critical scale.*

| Card | Audience | Subtitle | Pain Points |
|------|----------|----------|-------------|
| 1 | Mid-Market Enterprises | 200–2,000 Employees | M365 sprawl from years of ungoverned growth; governance gaps blocking Copilot adoption; shadow IT undermining security posture; failed or stalled migration projects |
| 2 | Regulated Industries & Gov Contractors | Healthcare · Legal · Financial · Federal | HIPAA, SOC 2, and CMMC readiness on M365; data residency and sovereignty requirements; FedRAMP, FISMA, and ITAR for gov contractors; GCC High configuration for defense-adjacent workloads |
| 3 | Startups & Scale-Ups | Rapid Growth · First-Time Architecture | Poor tenant foundation from early configuration shortcuts; audit preparation with no existing governance framework; rapid headcount growth with no onboarding automation; first-time enterprise architecture requirements |

**3. Productized Services**
- **Kicker:** `Fixed-Price Engagements`
- **H2:** `Productized Services`
- **Subtext:** *Scoped packages with fixed pricing, defined timelines, and clear deliverables. No open-ended consulting fees. No scope creep.*
- Cards loaded dynamically from `/api/services?type=micro_offer` (shows name, price, turnaround, tagline, inclusions)
- Each card CTA: `Get Started` → `/crm/portal/onboarding/select?service={slug}` | `Learn More` → service detail page
- Bottom CTA: `View All Fixed-Price Packages` → `/quick-wins`

**4. Fractional Architect Retainers**
- **Kicker:** `Fractional Architecture`
- **H2:** `Fractional Architect Retainers`
- **Subtext:** *Ongoing senior M365 architecture leadership on a monthly basis — strategic direction, hands-on delivery, and direct access to Shane.*
- **Context banner:** *A full-time M365 Architect costs $150,000–$220,000/year — plus benefits, equity, and months to recruit.*
- Cards loaded dynamically from `/api/services?type=retainer`
- Each card CTA: `Get Started` → `/crm/portal/onboarding/select?service={slug}`
- Footer link: `Compare all retainer tiers in detail` → `/retainers`

**5. Why Shane**
- **Kicker:** `Why Shane`
- **H2:** `30 Years of Microsoft Ecosystem Depth — Built at Mission-Critical Scale`
- **Body:** Shane McCaw has spent three decades inside the Microsoft ecosystem — from early infrastructure deployments to leading Microsoft 365 architecture for one of the most compliance-intensive organizations on earth: NASA. As Lead M365 Architect, Shane designed and governed the systems used by scientists, engineers, and administrators whose work cannot fail. That discipline is now available to your organization on a fractional basis.
- **Second paragraph:** Most consultants learn compliance frameworks from documentation. Shane learned them under real-world conditions where misconfiguration carried legal and mission consequences. FedRAMP, FISMA, ITAR, and GCC High aren't checklists to him — they're the environment he operated in daily.
- **Stats:** `30+` Years in the Microsoft Ecosystem | `NASA` Lead M365 Architect — Current Role | `100%` Senior Delivery — No Junior Staff

**6. How Engagements Work (3-step)**

| Step | Title | Description | Note |
|------|-------|-------------|------|
| 01 | Discover | A free 30-minute discovery call to understand your current M365 environment, key pain points, and what success looks like for your organization. | No pitch. No obligation. |
| 02 | Diagnose | A Quick Entry Engagement — Tenant Health Audit or Migration Readiness Assessment — gives you a clear, prioritized picture of your environment before committing to a larger project. | Fixed price. Delivered in 5 business days. |
| 03 | Architect & Execute | Based on the findings, we scope a fixed-price project, a fractional retainer, or both. Every engagement is delivered personally by Shane. | No handoffs. No junior staff. |

**7. Behind the Scenes — Automation**
- **Kicker:** `Behind the Scenes`
- **H2:** `Not questionnaires. Live data from your tenant.`
- **Body:** Every engagement starts with automation running inside your Microsoft 365 environment — reading the real configuration, not a self-assessment survey. Shane's PowerShell runbooks collect structured data, AI scores the findings, and a project workspace appears in your portal before your first meeting.

| Step | Title | Description |
|------|-------|-------------|
| 01 | You connect your tenant | A short setup wizard guides you through creating a read-only Azure App Registration. You own it — and can revoke access at any time. |
| 02 | Automation collects findings | Shane's runbooks execute inside your tenant via Azure Automation — reading licensing, security policies, SharePoint, Teams, and Copilot readiness. No manual surveys. |
| 03 | AI scores, Shane validates | Claude analyses the structured findings and scores your environment across security, governance, and Copilot readiness. Shane reviews every output before you see it. |
| 04 | Your Proposal Is Generated Automatically | When your diagnostic completes, our Signal Engine evaluates every finding — security, compliance, governance, identity, and Copilot readiness — and automatically builds a scoped, priced Statement of Work in your client portal. You review the findings, toggle which phases you want included, and the price updates live. Sign with e-signature. Pay with Stripe. Shane begins work. |

- Footer links: `See Quick Win packages and pricing →` `/quick-wins` | `See the full process →` `/how-it-works`

**8. Free Discovery Call**
- **Kicker:** `Free Discovery Call`
- **H2:** `What We'll Cover in Your Discovery Call`
- **Subtext:** A 30-minute conversation to understand your environment and give you a clear sense of what's possible — before you commit to anything.
- **3 Cards:** 1. Your Current Landscape — where your M365 environment stands today | 2. Key Risks & Opportunities — compliance gaps, governance liabilities, and adoption blockers | 3. Which Offer Fits Best — Quick Entry Assessment, fixed-price package, or fractional retainer based on your actual situation
- **CTA:** `Book Your Discovery Call` → `/book`
- **Footnote:** *No pitch. No obligation. Just clarity on your Microsoft 365 environment.*

**9. Closing CTA**
- **H2:** `Your Microsoft 365 Environment Deserves Senior Expertise.`
- **Subtext:** Work directly with a 30-year Microsoft veteran and NASA's Lead M365 Architect. No account managers. No junior staff. Clear, actionable guidance — starting with a free call.
- **CTA:** `Book Your Discovery Call` → `/book`
- **Footnote:** *No pitch. No obligation. Just clarity.*

---

## §2 — About (`/about`)

**Purpose:** Establishes Shane's credentials, career history, philosophy, and working style to build trust with prospective clients.

**SEO Title:** `About Shane McCaw | NASA's M365 Architect & Copilot SME | Shane McCaw Consulting`

### Layout / Sections

**1. Hero**
- **H1:** `NASA's Lead M365 Architect. Available to You.`
- **Subtext:** *For over 30 years, Shane McCaw has lived inside the Microsoft ecosystem — building enterprise architecture, navigating complex migrations, and leading governance at the highest compliance tier in the federal government. That depth is available to your organization, delivered personally.*
- **CTA:** `Book a Free Discovery Call` → `/book`
- **Stat pills:** `30+ Years` Microsoft ecosystem | `NASA` Lead M365 Architect | `20+` Microsoft Certifications

**2. The NASA Advantage**
- **H2:** `What Working at NASA Every Day Means for You`
- **Body:** NASA's Microsoft 365 environment operates under constraints that most enterprise IT teams will never encounter — FISMA High compliance requirements, sensitive research data, multi-agency collaboration needs, and zero tolerance for misconfiguration. Working inside that environment since 2018 has fundamentally shaped how Shane thinks about architecture, governance, and deployment risk. He is not applying theoretical best practices. He is applying what he learned yesterday, in production, under real stakes.

| Point | Description |
|-------|-------------|
| Security-first by default | At NASA, there is no acceptable error rate for misconfiguration. Every architecture decision starts with a failure-mode analysis — a discipline Shane applies to every client engagement. |
| Governance before deployment | Federal compliance requirements mean governance frameworks aren't optional or retrofittable. They're foundational. Shane designs governance into the architecture from day one. |
| Compliance at the highest tier | Operating in a FISMA High, FedRAMP-authorized M365 environment has given Shane familiarity with compliance standards that directly translates to regulated private-sector clients. |
| Real Copilot deployment experience | Shane has navigated Copilot deployment in one of the most constrained M365 environments in existence — working through the actual governance, labeling, and rollout challenges that other consultants are still theorizing about. |

**3. Career Timeline**

| Years | Role | Organization |
|-------|------|--------------|
| 1994–2010 | Software Developer & Architect | Microsoft ecosystem |
| 2010–2016 | Founder & Principal Architect | McCawSoft |
| 2016–2018 | Director of Technologies | Planet Technologies |
| 2018–Present *(Current)* | Lead Microsoft 365 Architect & Copilot SME | NASA |

**4. Recognition**
- **Heading:** `Forum of Innovation Award Winner · 20+ Microsoft Certifications`
- *Shane has been recognized with the Forum of Innovation Award for contributions to enterprise technology and Microsoft ecosystem innovation. He holds more than 20 Microsoft certifications — earned over decades of real-world practice, not exam preparation.*

**5. Elevator Pitch (verbatim)**

> "I'm Shane McCaw. I've spent thirty years inside the Microsoft ecosystem — writing code, building enterprise architecture, and for the past six years running M365 governance and Copilot deployment strategy at NASA. That's my day job. I also consult with organizations that need someone who has actually operated at that level.
>
> Most Microsoft consultants will give you best practices from a playbook. I give you what I tested last week in one of the most security-constrained, compliance-heavy Microsoft environments in the federal government. If your organization is serious about getting M365 right — governance, Copilot readiness, SharePoint, security architecture — I can help you do it the way it's done when there's no margin for error.
>
> Engagements are direct. You work with me, not a team I oversee. Everything I deliver is designed to leave your organization more capable, not more dependent on a retainer."

— **Shane McCaw**, Lead M365 Architect & Copilot SME, NASA · Founder, McCawSoft

**6. Philosophy — Hands-On. Direct. No Shortcuts.**

| Principle | Detail |
|-----------|--------|
| Every engagement is personal. | Shane handles his engagements directly. No project managers, no junior consultants, no offshore team. When you hire Shane McCaw Consulting, you get Shane. |
| Governance is not a phase. It's a foundation. | Most M365 problems — oversharing, compliance gaps, Copilot risk — trace back to governance that was never properly designed. Shane builds it in from the start. |
| The goal is your independence. | Shane's engagements are structured to leave organizations more capable, not more dependent. Documentation and knowledge transfer are non-negotiable deliverables. |
| Recommendations are specific to your environment. | No templated playbooks. Shane's advice is based on a real assessment of your tenant, your data, and your organizational context. |

**7. Who Works With Shane**

- Mid-market organizations (100–5,000 seats) — too large to wing their M365 setup, too lean to hire a full-time architect
- Government contractors — FISMA, NIST, and FedRAMP expertise in an M365 context
- Regulated industries — healthcare, financial services, and legal with precision data governance requirements
- Organizations evaluating Copilot — who need someone who has actually deployed it in a demanding environment

**8. Core Competencies (20 items)**

Microsoft 365 Architecture · Microsoft Copilot for M365 · Copilot Governance & Readiness · SharePoint Online · Microsoft Teams · OneDrive for Business · Exchange Online · Entra ID (Azure AD) · Power Platform · Power Automate · Power Apps · Microsoft Purview · Sensitivity Labels · DLP Policy Design · Retention & Records Management · Conditional Access · Information Architecture · Enterprise Governance Frameworks · Cloud Migration Strategy · M365 Tenant Health & Optimization

---

## §3 — Services Hub (`/services`)

**Purpose:** Overview of all service areas. Cards link to the 8 dedicated service pages.

**H1:** `Microsoft 365 Services`  
**Subtext:** *End-to-end Microsoft 365 architecture, governance, and deployment — delivered by a 30-year veteran and NASA's Lead M365 Architect.*

### Service Cards (8)

| Service | Route | Summary |
|---------|-------|---------|
| Microsoft 365 Architecture | `/services/microsoft-365` | Full-tenant governance and architecture for complex M365 environments |
| Copilot AI Readiness | `/services/copilot-ai` | Governance-first Copilot deployment — from assessment to rollout |
| SharePoint & Intranet | `/services/sharepoint` | Architecture, governance, and migration for SharePoint Online |
| Power Platform | `/services/power-platform` | Apps, automation, and governance for Power Platform |
| Governance Foundations | `/services/governance` | The compliance backbone your M365 tenant needs before anything else |
| Cloud Migration | `/services/cloud-migration` | Exchange, SharePoint, and Google Workspace → Microsoft 365 migrations |
| M365 Training | `/services/m365-training` | Live, role-specific Microsoft 365 training for your team |
| Security Hardening | `/services/security-hardening` | M365 tenant security assessment and hardening against the CIS Benchmark |

---

## §4 — Microsoft 365 Architecture (`/services/microsoft-365`)

**Purpose:** Dedicated service page for full-tenant M365 architecture and governance engagements.

### Layout / Sections

**1. Hero** — Service name, kicker `Services · Microsoft 365`, price/turnaround badge, CTAs (Book a Call / Buy Now), optional PDF download button.

**2. Who It's For**
- Mid-market companies (200–2,000 employees)
- Healthcare, legal, financial services, and government contractors
- Fast-growing startups needing enterprise-grade M365 architecture
- IT leaders who need senior-level expertise without a full-time hire

**3. Common Problems (8)**
- Teams and SharePoint sprawl — hundreds of ungoverned sites and teams
- Overshared content with no sensitivity labels or DLP policies
- Excessive global admins and over-privileged service accounts
- Legacy authentication still enabled, bypassing Conditional Access
- No retention or deletion policies — rising compliance exposure
- No lifecycle governance — expired groups persist indefinitely
- No provisioning standards — every team is configured differently
- No security baselines — Secure Score ignored, defaults left in place

**4. What You Get (7)**
- A governed tenant with documented policies and enforced standards
- A secure identity plane — MFA, Conditional Access, PIM in place
- A compliant data estate — sensitivity labels, DLP, and retention active
- A rationalized Teams and SharePoint architecture with a provisioning model
- A modernized security posture aligned to your regulatory requirements
- A prioritized remediation roadmap you can hand to your IT team
- A clear operating model so governance doesn't drift again

**5. Why Shane**

| Point | Detail |
|-------|--------|
| NASA-Scale Experience | Shane served as Lead Microsoft 365 Architect at NASA — one of the most complex, security-sensitive M365 environments in the world. That discipline applies directly to your organization. |
| Compliance-First Architecture | Deep expertise in FedRAMP, FISMA High, ITAR, and GCC High requirements. Shane designs environments that satisfy the strictest regulatory frameworks without sacrificing usability. |
| Senior-Level Delivery, Fractional Cost | You get 30 years of Microsoft ecosystem experience on call — without the overhead of a full-time senior hire. Fixed-price packages mean no billing surprises. |
| Practitioner, Not a Generalist | Shane doesn't subcontract or hand your project to a junior team. He does the work himself, with direct accountability for every recommendation and implementation. |

**6. Dynamic Sections** — micro-offer OfferCards (Quick Win packages from API); Retainer tier cards; Engagement project cards matched by trigger keys; Assessment CTA block; After-purchase section; TestimonialDiscountCallout.

---

## §5 — Copilot AI (`/services/copilot-ai`)

**Purpose:** Dedicated page for Copilot for Microsoft 365 readiness, governance, and deployment advisory.

### Layout / Sections

**1. Hero** — Service name, Copilot quiz CTA (`/copilot-quiz`).

**2. Service Comparison Table**

| | Copilot Readiness Assessment | Governance Foundations Package | Deployment Retainer |
|--|--|--|--|
| **Best For** | Organizations evaluating Copilot readiness before enabling any licenses | Organizations needing governance remediation before a safe Copilot rollout can proceed | Organizations that have deployed Copilot and need ongoing oversight and adoption support |
| **Scope** | Readiness audit across data governance, identity, sensitivity labeling, licensing, and change management | Full M365 governance framework — DLP, sensitivity labels, lifecycle policies, permissions, compliance alignment | Embedded advisory: Copilot governance, adoption monitoring, architecture guidance, escalation support |
| **Timeline** | 2 weeks | 6 weeks | Ongoing — month-to-month |
| **Price** | $5,000–$8,000 | $12,000–$18,000 | $2,500 / $6,000 / $11,000 per month |
| **Key Deliverables** | Readiness report, rollout roadmap, pilot group recommendations, quick-win remediation actions | Governance playbook, DLP policies, sensitivity label taxonomy, lifecycle rules, compliance alignment documentation | Monthly advisory hours, adoption reviews, architecture guidance, governance monitoring, executive reporting |
| **Ongoing Support** | One-time — can feed into governance package or retainer | One-time — optionally followed by Copilot deployment retainer | Continuous — cancel or adjust tier with 30-day notice |

**3. Copilot Readiness Assessment Includes (8 items)**
- Assessment of data governance and sensitivity labeling maturity
- SharePoint & OneDrive hygiene review
- Identity & permission sprawl analysis
- Licensing readiness validation
- Change management capacity evaluation
- Phased Copilot rollout roadmap
- Pilot group recommendations
- Success metrics and adoption plan

**4. Compliance Frameworks:** HIPAA · SOC 2 · FIN · CMMC · ITAR · FedRAMP

**5. Why Shane**

| Point | Detail |
|-------|--------|
| NASA Copilot SME | Shane served as Subject Matter Expert for Copilot for Microsoft 365 at NASA — one of the most security-sensitive and compliance-intensive federal environments in the US. He's not studying the technology, he's deployed it at scale. |
| Governance-First Methodology | Copilot without governance is a data exposure risk. Shane's methodology resolves governance prerequisites before any licenses are enabled. |

**6. Dynamic Sections** — FixedPriceOfferCard components; Retainer tier cards; Engagement projects; FollowOnProjects; After-purchase section.

---

## §6 — SharePoint (`/services/sharepoint`)

**Purpose:** Dedicated page for SharePoint Online architecture, governance, and migration advisory.

### Layout / Sections

**1. Hero** — Service name, pricing from API (fallbacks: Governance $12,000–$18,000, Migration $3,500–$5,000).

**2. Service Comparison Table**

| | Governance Foundations Package | Migration Readiness Assessment | Architect Retainer |
|--|--|--|--|
| **Best For** | Building a governed SharePoint foundation before any migration | Organizations migrating from legacy SharePoint, file servers, or Google Workspace | Organizations needing ongoing SharePoint architecture, governance, and advisory |
| **Scope** | Full governance framework — policies, permissions, naming conventions, lifecycle, and DLP | Discovery, risk analysis, and validated migration plan — no execution | Embedded advisory: architecture guidance, governance reviews, and escalation support |
| **Timeline** | 6 weeks | 1 week | Ongoing — month-to-month |
| **Price** | $12,000–$18,000 | $3,500–$5,000 | $2,500 / $6,000 / $11,000 per month |
| **Key Deliverables** | Governance playbook, naming conventions, lifecycle policies, DLP configuration, permissions model, training session | Risk register, migration blocker analysis, phased migration plan, tool recommendations, executive summary | Monthly advisory hours, architecture reviews, governance monitoring, escalation access |
| **Ongoing Support** | One-time — optionally followed by retainer | One-time — feeds into governance or managed migration | Continuous — cancel or adjust with 30 days' notice |

**3. Dynamic Sections** — Assessment CTA; Retainer cards; Engagement projects; FixedPriceOfferCard; After-purchase section; TestimonialDiscountCallout.

---

## §7 — Power Platform (`/services/power-platform`)

**Purpose:** Dedicated page for Power Apps, Power Automate, and Power Platform governance services.

### Layout / Sections

**1. Hero** — Service name, pricing badges.

**2. Service Comparison Table**

| | Power Platform Quick Start | Governance Foundations Package | Architect Retainer |
|--|--|--|--|
| **Best For** | Organizations with a specific automation or app use case ready to scope and build | Organizations needing governance structure before scaling Power Platform across the business | Organizations running ongoing Power Platform programs needing embedded senior architect oversight |
| **Scope** | One fully built, production-ready Power App or Power Automate flow — scoped in week 1 | M365 and Power Platform governance framework — DLP, environment strategy, lifecycle policies, naming conventions | Embedded advisory: roadmap execution, governance monitoring, IT team mentoring, escalation support |
| **Timeline** | 4 weeks (30-day delivery) | 6 weeks | Ongoing — month-to-month |
| **Price** | $6,000–$10,000 | $12,000–$18,000 | $2,500 / $6,000 / $11,000 per month |
| **Key Deliverables** | Production-ready solution, architecture documentation, error handling, monitoring, training session, governance alignment | Governance playbook, DLP rules, environment strategy, naming conventions, lifecycle policies, change management process | Monthly advisory hours, architecture reviews, governance monitoring, roadmap execution, executive reporting |
| **Ongoing Support** | One-time — can follow with governance or retainer | One-time — positions org to scale Power Platform safely | Continuous — cancel or adjust with 30 days' notice |

**3. Quick Start Build Deliverables (8)**
Requirements discovery workshop · Solution architecture & data model · One production-ready Power App or Power Automate flow · Dataverse or SharePoint data structure · Error handling & monitoring · Documentation & handoff · Governance alignment · Live training session

**4. What Shane Delivers**
Power Apps for replacing spreadsheets and manual processes · Power Automate workflows for approvals, notifications, and system integration · Dataverse data modeling · Integration with M365, Dynamics, Salesforce, ServiceNow · Governance, DLP, and environment strategy · Automation roadmap development · Training & enablement

**5. Who It's For**
- Mid-market organizations (200–2,000 employees) with underutilized Power Platform licenses
- IT teams who know they need automation but can't staff or scope it internally
- Organizations with manual approval processes, spreadsheet-driven workflows, or disconnected business systems

**6. Dynamic Sections** — Assessment CTA; Retainer cards; Engagement projects; FixedPriceOfferCard; After-purchase section; TestimonialDiscountCallout.

---

## §8 — Governance Foundations (`/services/governance`)

**Purpose:** Dedicated page for the M365 Governance Foundations Package — the compliance backbone before migrations or AI rollouts.

### Layout / Sections

**1. Hero** — Service name, price range, turnaround badge.

**2. Service Comparison Table**

| | Governance Foundations Package | Migration Readiness Assessment | Architect Retainer |
|--|--|--|--|
| **Best For** | Regulated organizations needing defensible governance before any migration, AI rollout, or build-out | Organizations planning a legacy migration after governance remediation | Organizations needing continuous governance oversight, compliance monitoring, and architecture advisory |
| **Scope** | Full M365 governance framework — DLP, sensitivity labels, retention schedules, permissions, lifecycle policies, compliance alignment | Discovery, risk analysis, and validated migration plan — no execution | Embedded advisory: governance reviews, compliance monitoring, escalation support, architecture guidance |
| **Timeline** | 6 weeks | 1 week | Ongoing — month-to-month |
| **Price** | $12,000–$18,000 | $3,500–$5,000 | $2,500 / $6,000 / $11,000 per month |
| **Key Deliverables** | Governance playbook, DLP policies, sensitivity label taxonomy, retention schedules, compliance alignment review, admin documentation | Readiness report, risk register, migration blocker analysis, sequenced migration roadmap, go/no-go recommendation | Monthly advisory hours, governance reviews, compliance monitoring, architecture guidance, executive reporting |
| **Ongoing Support** | One-time — optionally followed by retainer or Copilot readiness assessment | One-time — feeds into managed migration or retainer | Continuous — cancel or adjust with 30 days' notice |

**3. Package Includes (10 items)**
- Governance maturity assessment across the full M365 tenant
- Naming conventions and site/team lifecycle policies
- Data Loss Prevention (DLP) policy design and implementation
- Microsoft Purview sensitivity labeling taxonomy and auto-labeling
- Retention schedules and records management configuration
- Teams and SharePoint governance model with permission scoping
- Admin roles, privileged access review, and least-privilege remediation
- Change management process design and documentation
- Compliance alignment review (HIPAA, CMMC, SOX, FIN, ITAR, FedRAMP)
- Policy documentation package and governance playbook

**4. What Shane Delivers (feature tiles)**

| Feature | Detail |
|---------|--------|
| Data Loss Prevention | Configure DLP policies that automatically detect and protect sensitive data — SSNs, financial records, health information, and classified content — before it leaves your environment. |
| Sensitivity Labeling | Microsoft Purview sensitivity label taxonomy — automatically applied to content matching your classification rules. |
| Retention & Records Management | Retention schedules scoped by data type and regulatory requirement. |
| Teams & SharePoint Governance | Provisioning models, lifecycle policies, naming conventions, permission scoping. |
| Admin Role Rationalization | Least-privilege access, PIM configuration, break-glass accounts. |
| Compliance Alignment | HIPAA, CMMC, SOX, FIN, ITAR, FedRAMP review mapped to your governance state. |

**5. Dynamic Sections** — Assessment CTA; Retainer cards; Engagement projects; FixedPriceOfferCard; After-purchase section; TestimonialDiscountCallout.

---

## §9 — Cloud Migration (`/services/cloud-migration`)

**Purpose:** Dedicated page for planning Exchange Online, SharePoint Online, and Google Workspace → Microsoft 365 migrations.

### Layout / Sections

**1. Hero** — Service name, price range badges.

**2. Service Comparison Table**

| | Migration Readiness Assessment | Governance Foundations Package | Architect Retainer |
|--|--|--|--|
| **Best For** | Organizations needing a clear picture before committing to a migration | Tenants with governance debt that must be resolved before workloads move | Organizations needing continuous senior architect oversight month-to-month |
| **Scope** | Discovery, risk analysis, and a validated migration plan — no execution | Full governance framework design and policy enforcement across M365 | Embedded advisory: architecture, execution guidance, escalation support |
| **Timeline** | 1 week | 6 weeks | Ongoing — month-to-month |
| **Price** | $3,500–$5,000 | $12,000–$18,000 | $2,500 / $6,000 / $11,000 per month |
| **Key Deliverables** | Readiness report, risk register, sequenced migration roadmap, go/no-go recommendation | Governance framework, naming conventions, lifecycle rules, security baseline, retention architecture | Monthly advisory hours, architecture reviews, escalation access, progress reporting |
| **Ongoing Support** | One-time — can feed into retainer or managed migration | One-time — optionally followed by retainer | Continuous — cancel or adjust with 30 days' notice |

**3. Migration Types Covered**

| Migration | Key Points |
|-----------|-----------|
| Exchange → Exchange Online | On-premises AD synced to Azure AD via AAD Connect with MFA at cutover; full mailbox permissions/shared mailboxes/distribution groups preserved; hybrid coexistence; batched cutover with rollback triggers; dual-delivery validation before DNS cutover guarantees zero message loss. |
| SharePoint → SharePoint Online | Identity remapped to Azure AD pre-migration; site collection permissions and item-level permission chains fully preserved; parallel access during migration; site-by-site cutover with stakeholder sign-off gates; SPMT-based migration with checksum validation and delta sync. |
| Google Workspace → Microsoft 365 | Google accounts mapped to M365 identities with Azure AD SSO and MFA pre-migration; Drive sharing permissions translated to SharePoint/OneDrive equivalents; MX split routing coexistence; app-by-app cutover (Calendar/Contacts first, then Gmail/Drive); Google Takeout + migration tooling with 100% item count parity reconciliation. |

**4. Dynamic Sections** — Assessment CTA; Retainer cards; Engagement projects; FixedPriceOfferCard; After-purchase section; TestimonialDiscountCallout.

---

## §10 — M365 Training (`/services/m365-training`)

**Purpose:** Live, instructor-led Microsoft 365 training tailored to the organization's configuration.

### Layout / Sections

**1. Hero** — Service name, price/turnaround badge, CTAs.

**2. Training Modules (6)**

| Module | Description |
|--------|-------------|
| Outlook | Email organization, calendar management, delegation, rules, shared mailboxes, and mobile configuration for everyday productivity. |
| Microsoft Teams | Channels, meetings, chat best practices, app integrations, and governance etiquette for effective team collaboration. |
| SharePoint & OneDrive | Document storage, co-authoring, version control, sharing permissions, and intranet navigation built for your site structure. |
| Exchange | Exchange Online administration, mailbox management, distribution lists, mail flow rules, and hybrid configuration fundamentals. |
| Copilot for Microsoft 365 | Practical Copilot use across Teams, Outlook, Word, Excel, and PowerPoint — what it can do, how to prompt it effectively, and what to watch for. |
| Power Platform Basics | Introduction to Power Automate and Power Apps — how to automate routine tasks and build simple business tools without writing code. |

**3. What's Included (6 items)**
- Live, instructor-led training sessions (remote or on-site)
- Custom agenda tailored to your organization's M365 configuration
- Session recordings for team members who can't attend live
- Resource packs: quick-reference cards, tip sheets, and links
- Q&A time built into every session
- Post-training support window (email questions welcome)

**4. Who It's For (6 segments)**
- Organizations onboarding employees to Microsoft 365 for the first time
- Teams migrating from Google Workspace, Slack, or legacy on-premises tools
- Companies rolling out Copilot and needing structured change management
- IT departments that want role-specific training rather than generic vendor content
- Organizations whose licenses are underused because staff never got proper onboarding
- Regulated industries where correct tool use is part of compliance

**5. Why It Works**

| Point | Detail |
|-------|--------|
| Taught by a Practitioner, Not a Trainer | Shane is a Lead Microsoft 365 Architect who has used every tool in real enterprise and federal environments. Training comes with architectural context — not just click-through demos. |
| NASA-Proven Curriculum | Shane developed and delivered M365 training at NASA, where adoption was mission-critical and incorrect tool use had real consequences. |
| Tailored to Your Configuration | Training is built around your tenant, your SharePoint sites, your Teams structure, and your governance policies — not a generic sample environment. |

**6. Dynamic Sections** — Retainer cards; Copilot quiz CTA; FixedPriceOfferCard.

---

## §11 — Security Hardening (`/services/security-hardening`)

**Purpose:** Fixed-scope M365 security assessment and hardening against the CIS M365 Foundations Benchmark.

### Layout / Sections

**1. Hero** — Service name, compliance badges, CTAs.

**2. Risk Areas Addressed (4)**

| Risk | Detail |
|------|--------|
| Identity & access misconfigurations | Legacy authentication still enabled, over-privileged service accounts, and no Conditional Access policies — the #1 breach vector in cloud environments. |
| Overshared data and no DLP | Sensitive files accessible company-wide with no Data Loss Prevention policies — one misconfigured sharing link away from a compliance incident. |
| Ignored Secure Score | Microsoft's built-in Secure Score surfaces critical gaps most tenants never address. Defaults are not safe defaults. |
| No audit logging or SIEM feed | Without unified audit logging, you cannot detect or reconstruct a breach — and regulators know it. |

**3. Deliverables (8)**
- Full tenant security assessment against CIS M365 Foundations Benchmark
- Conditional Access policy design and implementation review
- Privileged Identity Management (PIM) configuration and least-privilege audit
- Data Loss Prevention policy review and gap analysis
- Microsoft Secure Score uplift roadmap with prioritized remediation actions
- Admin role rationalization and break-glass account hardening
- Audit log configuration and unified logging review
- Written security hardening report and executive summary

**4. Compliance Frameworks:** HIPAA · SOC 2 · CMMC · ITAR · FedRAMP · FISMA

**5. Why Shane**

| Point | Detail |
|-------|--------|
| NASA Security Architecture Experience | Shane served as Lead M365 Architect at NASA under FedRAMP High, FISMA, and ITAR requirements — some of the most demanding security mandates in any sector. |
| Misconfiguration Is the #1 Breach Vector | IBM's 2024 data confirms it: misconfiguration — not zero-day exploits — causes the majority of cloud breaches. Shane's assessment targets exactly these gaps before they become incidents. |
| Fixed Scope, No Billing Surprises | A defined security hardening engagement with a clear deliverable set — not an open-ended consulting retainer that expands without warning. You know what you're getting before you sign. |
| Practitioner, Not a Generalist | Shane doesn't subcontract. Every assessment, recommendation, and deliverable comes from 30 years of hands-on Microsoft ecosystem experience. |

**6. Dynamic Sections** — Retainer cards; FollowOnProjects; Engagement projects; FixedPriceOfferCard; After-purchase section.

---

## §12 — Quick Wins (`/quick-wins`)

**Purpose:** Catalogue of all fixed-price micro-offer packages. Track 01 — Entry tier.

**H1:** `Fixed-Price Quick Wins`  
**Kicker:** `Start Without Risk`  
**Subtext:** *Every engagement starts with a defined scope, a fixed price, and a clear deliverable. Buy online, no discovery call required.*

### Layout / Sections

**1. Hero** — H1, kicker, subtext, CTA.

**2. Quick Win Package Grid** — OfferCard components loaded dynamically from `/api/services?type=micro_offer`. Each card shows: name, tagline, price, turnaround, key inclusions, CTA `Buy Now` (Stripe checkout) + `Learn More` link to `/quick-wins/:slug`.

**3. How It Works (4 steps)**
1. Choose a package — browse and select the Quick Win that fits your most urgent need
2. Purchase online — fixed price, paid with Stripe; no discovery call required for Tier 1
3. Automation runs — Shane's runbooks execute inside your tenant via Azure Automation
4. Deliverable delivered — report, roadmap, and recommendations within the stated turnaround

**4. CTA** — `Not sure which Quick Win fits? Take the quiz →` `/quick-win-quiz`

---

## §13 — Quick Win Detail (`/quick-wins/:slug`)

**Purpose:** Individual detail page for each micro-offer service. All content loaded dynamically from the API by slug. Renders a loading skeleton while fetching; shows `NotFound` if the slug does not resolve.

### Layout / Sections

1. **Hero** — Service name (H1), tagline, price badge, turnaround badge, `Buy Now` (Stripe checkout) CTA + `Book a Call` CTA, optional PDF overview download button
2. **Ideal Customer Profile (ICP)** — Four attribute tiles: Company Size (200–2,000 employees), Industry/Compliance context, IT team profile, Engagement stage
3. **What's Included** — Bullet list from `service.inclusions`
4. **What You Get** — Output deliverables from `service.deliverables`
5. **How It Works** — 4-step card matching the automation pipeline (connect tenant → runbooks collect findings → AI scores → receive deliverable)
6. **Why This Fits** — Contextual narrative connecting service to common pain points
7. **TestimonialDiscountCallout** — Social proof strip
8. **ServiceOverviewModal** — Downloadable PDF service overview (if PDF is uploaded for the service)

---

## §14 — Pricing (`/pricing`)

**Purpose:** Full pricing transparency page showing all three engagement tracks, comparison table, engagement project examples, and FAQs.

**H1:** `Transparent Pricing. No Surprises.`  
**Kicker:** `Pricing`  
**Subtext:** *Three ways to engage — entry-level fixed-price packages, project-based engagements, and fractional retainers. Every option is scoped before you commit.*

### Layout / Sections

**1. Hero** — H1, kicker, subtext, `Book a Discovery Call` CTA.

**2. Three Engagement Tracks (cards)**

| Track | Name | Price (fallback) | Timeline |
|-------|------|------------------|----------|
| Track 01 — Entry | Fixed-Price Quick Wins | $3,000–$18,000 fixed | 5–15 business days |
| Track 02 — Core | Project-Based Engagements | $7,500–$35,000+ fixed | 4–12 weeks |
| Track 03 — Strategic *(Most Popular)* | Monthly Fractional Retainer | $2,500–$11,000/month | Ongoing — month-to-month |

*Live prices are DB-driven; page displays fallback values above when no services exist in the database.*

**3. Quick Wins Section** — Dynamic OfferCard grid from `/api/services?type=micro_offer`.

**4. Retainer Plans Section** — Dynamic RetainerCard grid (3 tiers). Footer note: *All retainer tiers include access to all service areas. Hours are used as the engagement requires and do not roll over.*

**5. Comparison Table — Which Engagement Is Right for You?** (`#compare`)

| Dimension | Track 01 — Entry | Track 02 — Core | Track 03 — Strategic |
|-----------|------------------|-----------------|----------------------|
| Best For | Organizations needing fast, low-risk diagnostics or defined point solutions | Organizations with a clear multi-phase problem needing fixed-scope project with defined deliverables | Organizations needing continuous senior architect oversight, governance guidance, and a standing escalation resource |
| Scope | One scoped deliverable per package — defined in advance, no discovery call required | Multi-phase project work scoped after a free discovery call — fixed fee, fixed deliverables, fixed timeline | Embedded fractional advisory: architecture reviews, execution guidance, policy decisions, and escalation support |
| Timeline | 5–15 business days per package | 4–12 weeks depending on complexity | Ongoing — month-to-month, cancel with 30 days' notice |
| Price | DB-driven (fallback: $3,000–$18,000 fixed) | DB-driven (fallback: $7,500–$35,000+ fixed project fee) | DB-driven (fallback: $2,500/$6,000/$11,000 per month) |
| Key Deliverables | Diagnostic report, risk register, remediation roadmap, or configured environment | Detailed proposal before commitment, fixed SOW, defined milestones, change orders for scope changes | Monthly advisory hours, architecture reviews, escalation access, and written end-of-month summary |
| Commitment | One-time — can feed into Core project or retainer | One-time project — optionally followed by retainer | Continuous — adjust tier or cancel with 30 days' notice at any time |

**6. Engagement Projects** — Dynamic EngagementProjectCard grid from `/api/engagement-projects`.

**7. FAQs (7, accordion)**

| Question | Answer Summary |
|----------|----------------|
| How quickly can an engagement start? | Quick Wins: 3–5 business days. Retainers/projects: 1–2 weeks after signing. Urgent situations can often be accelerated. |
| Do you work with small businesses or only enterprises? | Both. The same governance challenges appear at 50-seat organizations — often with less margin for error, not more. Shane calibrates scope and pricing to actual size. |
| Is everything done remotely? | Yes, 100% remote. Shane is based in Vero Beach, FL, and serves clients nationally. |
| How are project-based engagements scoped and priced? | Fixed-fee proposal after free discovery call — defined deliverables, timeline, and single project price. Typically $7,500–$35,000+. No hourly billing, no scope creep without a signed change order. |
| Can I start with a Quick Win and move to a retainer? | That's the most common path. Any Quick Win investment can be credited toward the first month of a retainer. |
| What does a retainer actually look like month to month? | Hours used as the engagement requires — architecture reviews, configuration review, time-sensitive questions, or new workload design. Written monthly summary. Hours do not roll over. |
| What M365 licenses are required for Copilot? | M365 E3 or E5 base license plus the Copilot add-on ($30/user/month). Data governance and sensitivity labeling must be in place first. |

---

## §15 — Resources (`/resources`)

**Purpose:** Blog / article library. Showcases expertise and drives organic SEO.

**H1:** `Resources & Insights`  
**Kicker:** `Resources`  
**Subtext:** *Practical Microsoft 365 guidance from NASA's Lead M365 Architect.*

### Layout / Sections

**1. Hero** — H1, kicker, search bar, category filter tabs.

**2. Article Grid** — Cards loaded from `/api/articles`. Each card shows: category badge (Electric Blue pill), title (H3), summary, date, reading time, LinkedIn/X share buttons with live share counts, `Read More →` link to `/resources/:slug`.

**3. Free Assessment Quizzes**
- **Kicker:** `Free · AI-Powered · 5 Minutes`
- **H2:** `Free Assessment Quizzes`
- **Subtext:** *Benchmark your Microsoft 365 environment with a free AI-powered assessment. Each quiz delivers a personalized PDF report with your score, risks, and next steps.*

| Quiz | Route | Badge |
|------|-------|-------|
| Copilot Readiness | `/copilot-quiz` | Most Popular |
| M365 Health Check | `/m365-health-quiz` | — |
| SharePoint & Intranet Readiness | `/sharepoint-readiness-quiz` | — |
| Power Platform Maturity | `/power-platform-quiz` | — |
| Security & Compliance Maturity | `/security-compliance-quiz` | — |
| Teams Collaboration Maturity | `/teams-maturity-quiz` | — |
| Migration Readiness | `/migration-readiness-quiz` | — |
| Governance Maturity | `/governance-maturity-quiz` | — |

---

## §16 — Article Page (`/resources/:slug`)

**Purpose:** Renders a single article from Markdown source. Content fetched from `/api/articles/:slug`.

### Layout / Sections
1. **Breadcrumb** — `Resources / [Article Title]`
2. **Hero** — Article title (H1), meta strip: date · reading time · category badge
3. **Body** — Markdown rendered to HTML (headings, body paragraphs, bullet lists, code blocks)
4. **Social Share** — LinkedIn and X (Twitter) share buttons with live share count (incremented via `POST /api/shares`)
5. **Related Articles** — 3 cards from the same category
6. **CTA Block** — Discovery call CTA (`Book Your Discovery Call` → `/book`)

---

## §17 — Contact (`/contact`)

**Purpose:** Conversational AI-powered contact interface. Replaces a traditional static form with a Claude-backed chat that qualifies leads and saves them to the CRM.

**SEO Title:** `Contact Shane McCaw | Microsoft 365 Consultant | Shane McCaw Consulting`  
**SEO Description:** `Contact Shane McCaw — NASA's Lead Microsoft 365 Architect. Get expert answers about M365, Copilot AI, SharePoint, and governance. Expect a personal response within 1 business day.`

**Kicker:** `Contact Shane McCaw`  
**H1:** `Get in Touch`  
**Subtext 1:** *You're contacting the Lead M365 Architect at NASA — 30 years of Microsoft ecosystem experience, now available to mid‑market and regulated‑industry organizations.*  
**Subtext 2:** *Tell me what you're dealing with and you'll get a straight, senior‑level answer on whether and how I can help — no fluff, no sales pitch.*

### Layout / Sections

1. **Hero banner** — Deep Navy background, kicker + H1 + two-line subtext.
2. **Who I Work With (4 cards)** — Mid-Market Organizations (200–2,000 employees) · Regulated Industries (healthcare, finance, legal, defence) · Government Contractors (CMMC, FedRAMP, ITAR) · Internal IT Teams (M365 architecture help without headcount).
3. **AI Chat Interface** — Conversational chat UI connected to `/api/contact-chat` (Claude-powered). Opens with an AI greeting. Chat-style messages, typing indicator, message history for the session. On completion, lead is saved via `POST /api/leads` with `source: "contact_form"`. Fallback direct email: `info@shanemccaw.com`.
4. **Contact Details sidebar** — Email · Location (Vero Beach, FL) · Response time pledge.
5. **Alternative CTAs** — `Book a Discovery Call` → `/book`

---

## §18 — Book (`/book`)

**Purpose:** Discovery call booking page. Uses live Exchange Online calendar to show available slots.

**H1:** `Book a Free Discovery Call`  
**Kicker:** `Schedule`  
**Subtext:** *A 30-minute call with Shane — no pitch, no pressure. Just a clear look at your M365 environment and what the right next step might be.*

### Layout / Sections

1. **Calendar Slot Picker** (`CalendarBooking` component) — Fetches available 30-minute slots from `/api/book/slots` (Exchange Online via Microsoft Graph API). Gracefully shows empty state if Graph credentials are absent. User selects date and time slot.
2. **Booking Form** — Name, email, company, brief description of environment/need. Submits to `/api/book/request`.
3. **What to Expect (3 points)** — Shane reviews your situation before the call · You'll leave with at least one clear next step · No follow-up pitch unless you ask for one
4. **Confirmation** — Success message after successful booking

**What the call covers:** Current M365 environment state · Top compliance, governance, or adoption challenges · Which engagement track fits your situation

---

## §19 — Privacy Policy (`/privacy`)

**Purpose:** Legal privacy policy page.

**H1:** `Privacy Policy`

### Layout / Sections

- **Effective Date** — Displayed at top
- **Information Collected** — Contact form submissions, quiz lead data (name, email, company), analytics events, booking requests
- **How Data Is Used** — Service delivery, email follow-up (quiz PDF reports), booking confirmation, analytics
- **Data Storage** — No persistent user accounts on the public site; quiz results stored by ID for shareable results page
- **Third-Party Services** — Stripe (payments), Resend (transactional email), Microsoft Graph (calendar booking), Anthropic Claude (AI quiz and chat)
- **Contact** — Email address for privacy inquiries

---

## §20 — Admin Redirect (`/admin`)

**Purpose:** Redirect stub only — no rendered content.

**Behavior:** Immediately executes `window.location.replace("/admin-panel/")` to redirect the browser to the separate Admin Panel artifact at `/admin-panel/`.

---

## §21 — Customer Command Center (`/customer-command-center`)

**Purpose:** Client-facing portal for existing clients to track engagement projects, view diagnostics, sign SOW, and make payments.

**Access:** Token-authenticated clients via URL or login.

### Layout / Sections

1. **Project Overview** — Engagement name, status badge (pending/active/complete), current phase indicator
2. **Diagnostic Findings** — Scored assessment results with category score breakdown
3. **Statement of Work (SOW)** — Phase list with toggle controls; client can include/exclude phases; price updates live as phases are toggled
4. **Agreement** — E-signature panel — locked until payment is confirmed (status `"paid"` or `"signed"`)
5. **Payment** — Stripe payment panel; **PAY-TODAY banner** (72-hour countdown discount offer when applicable — configured via `coupons` DB table with `code = 'PAY-TODAY'`)
6. **Progress Timeline** — Milestone tracker showing completed and upcoming phases
7. **Document Vault** — Deliverables uploaded by Shane (reports, roadmaps, architecture documents)
8. **Messaging** — Async message thread between client and Shane

---

## §22 — Copilot Quiz (`/copilot-quiz`)

**Purpose:** AI-powered 10-question Copilot Readiness Assessment. Scores the tenant across 5 categories and provides a tier recommendation with recommended service CTA.

**Quiz Type:** `copilot`  
**SEO Title:** `Copilot Readiness Assessment | Shane McCaw Consulting`  
**Badge:** `Most Popular`

**Intro Title:** `Is Your Microsoft 365 Tenant Ready for Copilot?`  
**Intro Description:** *Find out in 10 questions. Get a personalised readiness score and PDF report delivered to your inbox.*

### Layout / Sections

**1. Hero** — Full-width navy background, H1, subtext, `Start Assessment` CTA.

**2. Quiz Interface** — Chat-style conversational interface. AI generates adaptive questions via `/api/quiz/start` and `/api/quiz/answer`. Falls back to 10 static questions if the AI call fails.

**3. Quiz States:** `idle` → `intro` → `questioning` → `lead-capture` → `submitting` → `results`

**4. Lead Capture** — Name (required), Email (required), Company (optional)

**5. Five Scoring Categories**
1. Infrastructure & Identity
2. Data & Compliance
3. AI Literacy & Prompt Skills
4. Change Management
5. Business Process Readiness

**6. Fallback Questions (10)** — Cover: Secure Score/Defender, DKIM/DMARC/SPF, MFA coverage, Conditional Access, Teams/SharePoint structure, inactive sites/groups, Global Admin count/PIM, shadow IT, sensitivity labels, DLP policies.

**7. Results** — Total score /100, tier badge, category breakdown bars, AI-generated `whatThisMeans` narrative, recommended service with CTA, email PDF report option.

**Tier Upsell Map**

| Tier | Recommended Service |
|------|-------------------|
| Beginner | M365 Tenant Health Audit — from $4,500 |
| Developing | Copilot Readiness Assessment |
| Emerging | Copilot Readiness Assessment |
| Advanced | Copilot Readiness Assessment or Governance Foundations |
| Ready | Architect Retainer |

---

## §23 — M365 Health Quiz (`/m365-health-quiz`)

**Purpose:** AI-powered 10-question M365 Tenant Health Assessment.

**Quiz Type:** `m365-health`  
**Intro Title:** `How Healthy Is Your Microsoft 365 Tenant?`  
**Intro Description:** *Answer 10 AI-powered questions across 5 health dimensions. Takes around 5 minutes. You'll receive a personalised PDF report and service recommendation by email.*

### Five Scoring Categories
1. Security Posture
2. Identity & Conditional Access
3. Teams/SharePoint Sprawl
4. Admin Roles & Shadow IT
5. DLP & Sensitivity Labels

### Fallback Questions (10)
Secure Score/Defender anti-phishing configuration · DKIM/DMARC/SPF publication and enforcement · MFA coverage across all accounts · Conditional Access policies (compliant devices, legacy auth block, location restrictions) · Teams/SharePoint environment structure (named conventions vs. organic growth) · Inactive or ownerless sites/groups visibility · Global Admin count and PIM/JIT access controls · Shadow IT and unsanctioned apps · Microsoft Purview sensitivity label deployment · DLP policies blocking/alerting on sensitive data sharing

### Tier Upsell Map

| Tier | Badge / CTA |
|------|-------------|
| Beginner | Start Here · From $4,500 — M365 Tenant Health Audit |
| Developing | M365 Tenant Health Audit |
| Emerging | Governance Foundations Package |
| Advanced | Architect Retainer or specialist assessment |
| Ready | Light retainer for ongoing governance oversight |

---

## §24 — SharePoint & Intranet Readiness Quiz (`/sharepoint-readiness-quiz`)

**Purpose:** AI-powered 10-question SharePoint Architecture Assessment.

**Quiz Type:** `sharepoint`  
**Intro Title:** `How Well-Architected Is Your SharePoint Environment?`  
**Intro Description:** *Answer 10 AI-powered questions across 5 architecture dimensions. Takes around 5 minutes. You'll receive a personalised PDF report and recommendation by email.*

### Five Scoring Categories
1. Information Architecture
2. Search & Metadata
3. Content Lifecycle
4. Governance Gaps
5. Migration Readiness

### Fallback Questions (10)
SharePoint environment structure (hub model vs. organic growth) · Site collection count and naming convention process · Permissions management (inherited vs. accumulated unique permissions) · Site lifecycle policies (expiry, ownership reviews, archiving) · Content findability and search quality · Search managed properties and promoted results · Content retention/archiving process for departed employees · Metadata and content type consistency vs. folder structures · Departmental adoption and engagement levels · SharePoint training and adoption campaigns

### Tier Upsell Map

| Tier | Badge / Recommended Service |
|------|--------------------------|
| Beginner | Start Here · From $4,500 — M365 Tenant Health Audit |
| Developing | Recommended · From $12,000 — Governance Foundations Package |
| Emerging | Next Step · From $12,000 — Governance Foundations Package |
| Advanced | Architect Retainer |
| Ready | Light retainer for architecture oversight |

---

## §25 — Power Platform Maturity Quiz (`/power-platform-quiz`)

**Purpose:** AI-powered 10-question Power Platform Maturity Assessment.

**Quiz Type:** `power-platform`  
**Intro Title:** `How Mature Is Your Power Platform Practice?`  
**Intro Description:** *Answer 10 AI-powered questions across 5 maturity dimensions. Takes around 5 minutes. You'll receive a personalised PDF report and recommendation by email.*

### Five Scoring Categories
1. Environment Strategy
2. DLP & Maker Permissions
3. App Sprawl & Data Risk
4. Monitoring & Compliance
5. Governance Readiness

### Fallback Questions (10)
Power Platform governance and CoE toolkit deployment · Environment strategy (dev/test/prod separation) · Number of active makers and training level · Training and enablement programmes · Data sources used and connection security · Dataverse evaluation vs. SharePoint/Excel data sources · Power Automate automation types deployed · Flow failure monitoring and maintenance processes · AI Builder feature exploration/deployment · Copilot features in Power Apps/Power Automate awareness

### Tier Upsell Map

| Tier | Badge / Recommended Service |
|------|--------------------------|
| Beginner | Start Here · From $6,000 — Power Platform Quick-Start |
| Developing | Recommended · From $6,000 — Power Platform Quick-Start |
| Emerging | Next Step · From $6,000 — Power Platform Quick-Start |
| Advanced | Governance Foundations Package |
| Ready | Architect Retainer |

---

## §26 — Security & Compliance Maturity Quiz (`/security-compliance-quiz`)

**Purpose:** AI-powered 10-question M365 Security Posture Assessment.

**Quiz Type:** `security-compliance`  
**Intro Title:** `How Secure Is Your Microsoft 365 Environment?`  
**Intro Description:** *Answer 10 AI-powered questions across 5 security dimensions. Takes around 5 minutes. You'll receive a personalised PDF security report by email.*

### Five Scoring Categories
1. Identity & Access Control
2. Data Protection
3. Insider Risk & Compliance
4. Audit & eDiscovery
5. Regulatory Readiness

### Fallback Questions (10)
MFA enforcement (all users, Conditional Access, compliant devices, risk signals) · PIM/JIT access controls for Global Admins · Microsoft Purview sensitivity labels (auto vs. manual application) · DLP policies detecting and blocking sensitive data in email/Teams/SharePoint · Insider Risk Management policies (data theft, policy violations, disgruntled employee detection) · Communication Compliance for regulatory violations in Teams/email · Unified Audit Logs enabled and retained 90+ days · eDiscovery/Content Search experience and testing · Compliance frameworks subject to (HIPAA, CMMC, FedRAMP, SOX, GDPR, NIST) · Purview Compliance Manager score review and gap remediation

### Tier Upsell Map

| Tier | Badge / Recommended Service |
|------|--------------------------|
| Beginner | Critical · From $12,000 — Governance Foundations Package |
| Developing | Recommended · From $12,000 — Governance Foundations Package |
| Emerging | Next Step · From $12,000 — Governance Foundations Package |
| Advanced | Security Hardening Assessment |
| Ready | Architect Retainer for ongoing security oversight |

---

## §27 — Teams Collaboration Maturity Quiz (`/teams-maturity-quiz`)

**Purpose:** AI-powered 10-question Microsoft Teams Health Assessment.

**Quiz Type:** `teams`  
**Intro Title:** `How Well Is Your Organisation Using Microsoft Teams?`  
**Intro Description:** *Answer 10 AI-powered questions across 5 Teams health dimensions. Takes around 5 minutes. You'll receive a personalised PDF report and recommendation by email.*

### Five Scoring Categories
1. Lifecycle & Naming
2. Adoption & Culture
3. Guest & Channel Structure
4. App Usage Governance
5. Collaboration Governance

### Fallback Questions (10)
Teams and channel creation process (governed provisioning vs. free creation) · Lifecycle policies for ended projects / departed employees · Meeting quality (camera/mic, background noise, punctuality) · Teams Phone evaluation or deployment · Channel structure consistency across teams · File storage in Teams/SharePoint vs. email/personal OneDrive workarounds · Departmental adoption levels (who uses Teams vs. email/other) · Structured adoption campaigns (champions, newsletters, enablement sessions) · Third-party app integrations and governance · Advanced meeting features (recordings, transcripts, Copilot summaries, breakout rooms, polls)

### Tier Upsell Map

| Tier | Badge / Recommended Service |
|------|--------------------------|
| Beginner | Start Here · From $4,500 — M365 Tenant Health Audit |
| Developing | Recommended · From $12,000 — Governance Foundations Package |
| Emerging | Next Step · From $12,000 — Governance Foundations Package |
| Advanced | Architect Retainer |
| Ready | Light retainer for lifecycle governance oversight |

---

## §28 — Migration Readiness Quiz (`/migration-readiness-quiz`)

**Purpose:** AI-powered 10-question Cloud Migration Readiness Assessment.

**Quiz Type:** `migration`  
**Intro Title:** `How Ready Is Your Organisation to Migrate to Microsoft 365?`  
**Intro Description:** *Answer 10 AI-powered questions across 5 migration readiness dimensions. Takes around 5 minutes. You'll receive a personalised PDF readiness report by email.*

### Five Scoring Categories
1. Source Complexity & ROT
2. Permissions & Metadata
3. IA & Security Blockers
4. Timeline Realism
5. Migration Governance

### Fallback Questions (10)
Source systems and mailbox/distribution group inventory · User and data volume (mailbox count, email size, file share volume) · Identity infrastructure (AD → Entra ID sync, non-Microsoft IdP migration) · MFA enforcement from day one and legacy authentication compatibility · Sensitive content inventory and labeling/DLP plan for migration · Compliance requirements during migration (HIPAA, CMMC, FedRAMP, GDPR) · Executive sponsorship, budget approval, and timeline commitment · Stakeholder engagement and communication plan · Rollback procedures and tested recovery scenarios · Application and integration compatibility testing (LOB apps, connectors)

### Tier Upsell Map

| Tier | Badge / Recommended Service |
|------|--------------------------|
| Beginner | Start Here · From $3,500 — Migration Readiness Assessment |
| Developing | Recommended · From $3,500 — Migration Readiness Assessment |
| Emerging | Next Step · From $3,500 — Migration Readiness Assessment |
| Advanced | Governance Foundations Package (pre-migration) |
| Ready | Architect Retainer to oversee execution |

---

## §29 — Governance Maturity Quiz (`/governance-maturity-quiz`)

**Purpose:** AI-powered 10-question M365 Governance Maturity Assessment.

**Quiz Type:** `governance`  
**Intro Title:** `How Mature Is Your Microsoft 365 Governance Framework?`  
**Intro Description:** *Answer 10 AI-powered questions across 5 governance dimensions. Takes around 5 minutes. You'll receive a personalised PDF governance maturity report — delivered instantly to your inbox.*

### Five Scoring Categories
1. Policies & Roles
2. Lifecycle Management
3. Security & Compliance Controls
4. Monitoring & Reporting
5. Adoption & Accountability

### Fallback Questions (10)
DLP policies (SSN, financial records, health information blocking) · Microsoft Purview sensitivity labels (auto vs. manual, consistent deployment) · Records management and retention schedules (Purview Retention Policies) · Litigation hold / eDiscovery process documentation and testing · Admin access governance (least-privilege, periodic review, PIM usage) · External guest access policies (invite controls, expiry, access scope) · Compliance framework coverage (HIPAA, CMMC, FedRAMP, SOX, ITAR, GDPR) and Purview configuration · Compliance gap analysis within last 12 months and remediation tracking · Documented governance policies (acceptable use, Teams/SharePoint governance, data classification, admin access review) · Technical enforcement vs. paper-only governance (DLP blocking, Conditional Access device compliance, Purview retention actions)

### Tier Upsell Map

| Tier | Badge / Recommended Service |
|------|--------------------------|
| Beginner | Critical · From $12,000 — Governance Foundations Package |
| Developing | Recommended · From $12,000 — Governance Foundations Package |
| Emerging | Next Step · From $12,000 — Governance Foundations Package |
| Advanced | Governance Foundations Package (to close remaining gaps) |
| Ready | Architect Retainer for ongoing governance oversight |

---

## §30 — Quiz Results Page (`/quiz/results/:leadId`)

**Purpose:** Shareable, persistent results page. Loads stored quiz results from `/api/quiz/results/:leadId`.

### Layout / Sections

1. **Header** — Score badge with tier colour, total score display, tier name
2. **Category Score Bars** — One bar per category, colour-coded: teal (≥7/10), Electric Blue (≥4/10), red (<4/10), labeled with score out of 10
3. **What This Means** — AI-generated narrative (`whatThisMeans`)
4. **Why This Fits** — AI-generated explanation of recommended service (`whyThisFits`)
5. **ROI Projection** — AI-generated ROI narrative (`roiProjection`)
6. **Recommended Service** — Service name with `Book a Call` CTA
7. **Share Button** — Copy permalink to clipboard (copies `window.location.href`)

### Tier Colour Coding

| Tier | Colour |
|------|--------|
| Beginner | Red |
| Developing | Orange |
| Emerging | Yellow |
| Advanced | Blue |
| Ready | Teal |

### Data Shape

```
QuizResultsData {
  name, totalScore, tier, quizType,
  categoryScores (Record<string,number>),
  categoryConfig (key + label pairs),
  recommendedService, reportName,
  whatThisMeans, whyThisFits, roiProjection, createdAt
}
```

---

## §31 — Retainers Overview (`/retainers`)

**Purpose:** Dedicated overview of all three monthly fractional architect retainer tiers.

**H1:** `Fractional Architect. Strategic Access.`  
**Kicker:** `Monthly Retainer Plans`  
**Subtext:** *Ongoing senior-level Microsoft 365 architecture and governance advisory — without the overhead of a full-time hire.*

### Layout / Sections

**1. Hero** — H1, kicker, subtext, `Book a Discovery Call` CTA.

**2. Three Plan Cards** (data from API, fallbacks below)

| Plan | Fallback Price | Fallback Hours | Description |
|------|---------------|----------------|-------------|
| **Architect Essentials** | $2,500/mo | 10 hours/month | Async-first access to a senior M365 architect — ideal for stable environments that need expert oversight without a full-time hire. |
| **Architect Growth** | $6,000/mo | 25 hours/month | Active project delivery and architecture leadership — for organizations running a modernization or Copilot rollout. |
| **Architect Enterprise** | $11,000/mo | 50 hours/month | Embedded senior architect with dedicated channel access and weekly leadership sessions — for complex, regulated, or compliance-intensive environments. |

**3. Common to all plans** — Access to all M365 service areas; monthly written summary; all work delivered by Shane personally.

**4. Retainer Quiz CTA** — *"Not sure which plan fits? Take the 2-minute quiz."* → `/retainer-quiz`

**5. Comparison Table** — Features matrix across all three tiers.

**6. CTAs per plan** — `Learn More` → `/retainers/architect-essentials` etc. | `Book a Call` → `/book`

---

## §32 — Quick Win Quiz (`/quick-win-quiz`)

**Purpose:** 10-question interactive selector quiz to recommend the best-fit Quick Win package for the visitor's M365 environment.

**SEO Title:** `Quick Win Selector Quiz — Find Your Best-Fit M365 Package | Shane McCaw Consulting`  
**SEO Description:** *Answer 10 short questions and get a personalised recommendation for the Microsoft 365 Quick Win package that best fits your organisation's needs.*

### Layout / Sections

**1. Hero (Deep Navy)**
- **Kicker:** `Quick Win Quiz`
- **H1:** `Find the Right Quick Win for Your M365 Environment`
- **Subtext:** *10 questions. 2–3 minutes. A personalised recommendation — no discovery call required.*

**2. Quiz Section (Off-White background)**
- Renders the `QuickWinsSelectorQuiz` component
- 10 scored questions across 6 service dimensions:
  - M365 Tenant Health
  - Power Platform Automation
  - Governance
  - Migration Readiness
  - AI & Copilot Readiness
  - Training & Enablement
- On completion, redirects to `/quick-win/results/:resultId` with the top-ranked service recommendation

---

## §33 — Quick Win Results Page (`/quick-win/results/:resultId`)

**Purpose:** Personalized results page after completing the Quick Win Quiz. Loads stored quiz result from `/api/quick-win-quiz/results/:resultId`.

### Layout / Sections

1. **Header** — Result ID, completion date, intro copy
2. **Dimension Score Bars** — One bar per dimension (M365 Tenant Health, Power Platform Automation, Governance, Migration Readiness, AI & Copilot Readiness, Training & Enablement), scored /10
3. **Top Recommendation** — #1 ranked Quick Win service card with name, tagline, price, turnaround, and `Buy Now` / `Learn More` CTAs
4. **Runner-Up Recommendations** — #2 and #3 ranked services as smaller cards
5. **All Scored Dimensions Table** — Full breakdown of all 6 dimension scores with labels
6. **Retake Quiz** — `Retake Quiz` button → `/quick-win-quiz`

### Recommendation Data Shape

```
QuizResult {
  id, answers (Record<string,number>),
  scores (Record<QuizSlug,number>),
  rankedSlugs: string[],
  recommendations: Array<{rank, slug, score, service: ServiceData | null}>,
  createdAt
}
```

**Dimension Labels**

| Slug | Label |
|------|-------|
| tenant-health-audit | M365 Tenant Health |
| power-platform-quick-start | Power Platform Automation |
| governance-foundations | Governance |
| migration-readiness-assessment | Migration Readiness |
| copilot-readiness-assessment | AI & Copilot Readiness |
| m365-training-enablement | Training & Enablement |

---

## §34 — Retainer Quiz (`/retainer-quiz`)

**Purpose:** 2-minute interactive quiz to recommend the best-fit retainer tier (Essentials, Growth, or Enterprise).

**SEO Title:** `Retainer Selector Quiz — Find Your Best-Fit M365 Architect Plan | Shane McCaw Consulting`  
**SEO Description:** *Not sure which retainer plan is right for you? Answer 10 questions and get an instant recommendation — Architect Essentials, Growth, or Enterprise — based on your organization's needs.*

### Layout / Sections

**1. Hero (Deep Navy)**
- **Kicker:** `2-Minute Quiz`
- **H1:** `Which Retainer Plan Is Right for You?`
- **Subtext:** *Answer 10 questions about your organization's M365 environment and support needs. We'll recommend the Architect Essentials, Growth, or Enterprise plan — and explain exactly why.*
- **Trust badges:** `10 questions` · `Instant recommendation` · `No sign-up required`

**2. Quiz** — Renders `RetainerSelectorQuiz` component. 10 questions scored across three tier keys: `essentials` / `growth` / `enterprise`. On completion, renders inline `RetainerQuizResults` with the winning tier, score breakdown, and direct CTA to book/subscribe.

---

## §35 — Architect Essentials Retainer (`/retainers/architect-essentials`)

**Purpose:** Dedicated detail page for the entry-level fractional retainer.

**H1:** `Architect Essentials`  
**Price:** $1,500/month *(fallback; live price from API)*  
**Hours:** 10 hours/month *(fallback)*

### Layout / Sections

**1. Hero** — H1, price, hours, `Get Started` CTA.

**2. Fallback Deliverables (6)**
- 10 hours of consulting per month
- Email and Teams support
- Monthly strategy call (60 min)
- Standard response within 1 business day
- Access to all M365 service areas
- Monthly written summary

**3. Who It's For (5 segments)**

| Segment | Detail |
|---------|--------|
| Mid-market organizations | 200–2,000 employees running M365 in a stable state who need a senior architect available on demand — without the cost of a full-time hire. |
| Regulated industries and government contractors | Healthcare, finance, federal contractors, and state agencies needing ongoing expert oversight to maintain compliance posture. |
| IT teams with a senior escalation gap | Teams managing M365 day-to-day who hit architectural, governance, or security limits they can't resolve internally — and need a 30-year Microsoft veteran in their corner. |
| Compliance and governance risk organizations | Organizations that received an audit finding, failed a security review, or know their governance posture is undocumented and need it corrected methodically. |
| Organizations evaluating Copilot or SharePoint modernization | Teams not yet ready for a full project sprint but wanting expert oversight as they assess readiness and build the internal business case. |

**4. Typical Month**

| Week | Activity |
|------|----------|
| Week 1 | 60-minute strategy call. Shane reviews tenant health, open risks from the previous month, and agrees on this month's one or two priorities. No agenda-building overhead — you arrive, you focus. |
| Week 2 | Async delivery on the agreed priority: an architecture review finding, a governance policy draft, a Teams topology recommendation, a Copilot readiness checklist, or a licensing optimization analysis. |
| Week 3 | Follow-up review, Q&A, course corrections, or a second async deliverable. |
| Week 4 | Written summary of the month's work, hours used, open items, and recommended priorities for next month. |

**5. Additional Sections** — TestimonialDiscountCallout; Compare Plans → `/retainers`; Book a Call CTA.

---

## §36 — Architect Growth Retainer (`/retainers/architect-growth`)

**Purpose:** Dedicated detail page for the mid-tier fractional retainer for active modernization programs.

**H1:** `Architect Growth`  
**Price:** $6,000/month *(live from API)*  
**Hours:** 25 hours/month

### Layout / Sections

**1. Hero** — H1, price, hours, `Get Started` CTA.

**2. Features (10 items)**
- 25 hours of senior architecture consulting per month
- 2-hour priority response during business hours
- Two strategy calls per month (60 min each)
- 8 hours of hands-on configuration and build work
- Architecture design and modernisation roadmap
- Governance and security framework builds
- Copilot adoption framework and readiness scoring
- Power Platform solution oversight
- Proactive tenant health monitoring
- Monthly written summary, risks, and next-step recommendations

**3. Hours Used For (9 areas)**
Architecture design and documentation · Governance and compliance frameworks · Security and identity architecture · SharePoint information architecture and Teams architecture · Power Platform solution oversight · Copilot readiness and deployment guidance · Roadmap and modernisation planning · Escalation support for critical issues · Documentation and clarity deliverables

**4. Not Included (5 items)**
- Full project execution or end-to-end delivery management
- Unlimited meetings or unscheduled calls
- Junior staff — all work is done by Shane personally
- MSP-style ticket handling or helpdesk support
- Device management, endpoint security, or desktop support

**5. Who It's For (5 segments)**
- Organisations mid-way through an M365 modernisation or Copilot rollout who need consistent senior direction every week
- Regulated industries — finance, healthcare, federal contractors — requiring rigorous governance and security architecture
- Complex SharePoint, Teams, and Power Platform IT teams that generate frequent architecture questions and decisions
- Companies that have outgrown ad-hoc consulting and need predictable, senior-level access without hiring a full-time architect
- Organisations planning a governance overhaul, security hardening, or licence optimisation initiative

**6. Typical Month**

| Week | Activity |
|------|----------|
| Week 1 | Strategy and alignment call (60 min) — review open workstreams, confirm this month's priorities, and surface any tenant alerts from proactive health monitoring. |
| Week 2 | Deep-dive architecture work — design sessions, roadmap documentation, Copilot readiness scoring, governance policy builds, or SharePoint information architecture sprint. |
| Week 3 | Second strategy call + hands-on configuration or build work (8 hours included). |
| Week 4 | Written summary: work completed, hours used, risks, and next-month priorities. |

**7. Additional Sections** — TestimonialDiscountCallout; Compare Plans → `/retainers`.

---

## §37 — Architect Enterprise Retainer (`/retainers/architect-enterprise`)

**Purpose:** Dedicated detail page for the top-tier fractional retainer for complex, regulated, or multi-workload enterprises.

**H1:** `Architect Enterprise`  
**Price:** $11,000/month *(live from API)*  
**Hours:** 50 hours/month

### Layout / Sections

**1. Hero** — H1, price, hours, `Get Started` CTA.

**2. Features (12 items)**
- 50 hours of senior consulting per month
- Same-day response (within business hours)
- Weekly architecture leadership sessions (60 min)
- Unlimited async support via dedicated Teams/Slack channel
- Governance framework builds and policy authoring
- Copilot for Microsoft 365 deployment leadership
- Power Platform guardrails and Center of Excellence setup
- SharePoint and Teams architecture design and oversight
- Quarterly Roadmap Review with your leadership team
- Dedicated Teams or Slack channel — direct access to Shane
- Proactive tenant health monitoring and risk flagging
- Monthly written architecture summary and next-steps brief

**3. Hours Used For (10 areas)**
Architecture design sessions and whiteboarding · Governance policy authoring and documentation · Copilot readiness assessments and deployment leadership · SharePoint and Teams topology planning · Power Platform solution review and guardrail design · Security posture reviews and hardening recommendations · Licensing analysis and optimization advisory · Cross-team alignment calls and stakeholder briefings · Tenant health monitoring and incident escalation support · Written deliverables: summaries, roadmaps, architecture briefs

**4. Not Included (5 items)**
- Project execution or hands-on technical implementation
- Unlimited or unscheduled live meetings beyond the weekly session
- Junior or delegated staff — all work is Shane, senior-only
- MSP-style helpdesk or ticket resolution
- Device management, endpoint support, or hardware advisory

**5. Who It's For (4 segments)**

| Segment | Detail |
|---------|--------|
| Regulated industries and complex governance environments | Healthcare, finance, federal contractors, and defense primes where M365 misconfiguration is a compliance liability — and where governance documentation must withstand regulatory scrutiny. |
| Organizations with complex multi-workload M365 deployments | Enterprises running SharePoint, Teams, Power Platform, Copilot, and Entra ID simultaneously who need coordinated architectural oversight — not siloed advice. |
| Organizations deploying Copilot for Microsoft 365 at scale | IT leadership preparing for or actively rolling out Copilot who need a senior architect to lead readiness assessment, data governance prerequisites, and adoption architecture. |
| Organizations running a large-scale modernization initiative | Multi-year cloud modernization programs requiring embedded senior oversight across phases. |

**6. Additional Sections** — TestimonialDiscountCallout; Compare Plans → `/retainers`.

---

## §38 — Technical Overview (`/how-it-works/technical`)

**Purpose:** Technical deep-dive explaining the diagnostic automation pipeline, Signal Engine, and client portal architecture. Targeted at IT directors and technical evaluators.

**H1:** `How the Automation Works`  
**Kicker:** `Technical Overview`

### Layout / Sections

1. **Architecture Prose** — Azure Automation Account → PowerShell Runbooks → Microsoft Graph API → Structured JSON findings → AI scoring (Claude/Anthropic) → Signal Engine → SOW generation
2. **Security & Privacy** — Read-only App Registration (customer creates it, can revoke it); no data stored beyond engagement scope; customer controls described
3. **Signal Engine** — Explains how structured findings map to engagement projects and fixed-price deliverables; projects are triggered by scored signal keys from the runbook output
4. **Compliance Standards Alignment** — How assessment output maps to HIPAA, CMMC, FedRAMP, FISMA, ITAR, SOC 2
5. **CTAs** — `See Quick Wins` → `/quick-wins` | `Book a Call` → `/book`

---

## §39 — How It Works (`/how-it-works`)

**Purpose:** Plain-English explanation of the full engagement process — from discovery call through automated diagnostic to proposal and delivery.

**H1:** `How Shane's Engagements Work`  
**Kicker:** `The Process`

### Layout / Sections

1. **Three-Phase Overview** — Discover (free call) → Diagnose (Quick Win diagnostic) → Architect & Execute (fixed-price project or retainer). Same 3-step structure as the Home page.
2. **Automation Deep Dive** — Expanded detail on the runbook-based tenant scan, AI scoring, and automated SOW generation (4-step visual matching §1 §7).
3. **What You Get Before Your First Meeting** — Portal workspace, scored findings, preliminary project scoping already available.
4. **Fixed-Price Guarantee** — No scope creep without a signed change order; no hourly billing.
5. **Link to technical detail** — `See the full technical overview →` `/how-it-works/technical`
6. **CTAs** — `Start with a Quick Win` → `/quick-wins` | `Book a Discovery Call` → `/book`

---

## §40 — Assessments (`/assessments`)

**Purpose:** Hub page for all eight AI-powered assessment quizzes.

**H1:** `Free Microsoft 365 Assessments`  
**Kicker:** `AI-Powered · Free · 5 Minutes`  
**Subtext:** *Answer 10 AI-generated questions. Get a personalized PDF report with your score, tier, risks, and recommended next steps — delivered to your email.*

### Layout / Sections

**1. Hero** — H1, kicker, subtext, CTA grid.

**2. Quiz Cards (8)**

| Quiz | Route | Description |
|------|-------|-------------|
| Copilot Readiness | `/copilot-quiz` | Is your tenant ready for Microsoft 365 Copilot? Score across infrastructure, data, AI literacy, change management, and business process. |
| M365 Health Check | `/m365-health-quiz` | Benchmark your tenant health across security posture, identity, Conditional Access, collaboration sprawl, and data protection. |
| SharePoint & Intranet Readiness | `/sharepoint-readiness-quiz` | Assess your SharePoint architecture, permissions governance, search quality, content lifecycle, and adoption depth. |
| Power Platform Maturity | `/power-platform-quiz` | Measure your Power Platform governance, maker skills, data connectivity, automation maturity, and AI Builder readiness. |
| Security & Compliance Maturity | `/security-compliance-quiz` | Evaluate identity & access controls, data protection, device management, threat detection, and compliance framework readiness. |
| Teams Collaboration Maturity | `/teams-maturity-quiz` | Score your Teams governance, meetings & calling setup, information architecture, adoption culture, and app governance. |
| Migration Readiness | `/migration-readiness-quiz` | Check your source inventory accuracy, identity readiness, data governance, stakeholder alignment, and risk planning completeness. |
| Governance Maturity | `/governance-maturity-quiz` | Assess your DLP & sensitivity labels, retention & records management, access governance, compliance framework, and policy documentation. |

**3. How Assessments Work (4 steps)**
1. Click Start — Launch the AI-powered assessment for your area of interest
2. Answer 10 Questions — Adaptive AI questions in a chat-style interface (static fallbacks if AI unavailable)
3. Enter your details — Name, email, company (optional)
4. Receive your report — Personalized PDF with score, tier, category breakdown, and recommended service

**4. Scoring Tiers**

| Tier | Score Range | Color |
|------|-------------|-------|
| Beginner | 0–29 | Red |
| Developing | 30–49 | Orange |
| Emerging | 50–69 | Yellow |
| Advanced | 70–89 | Blue |
| Ready | 90–100 | Teal |

---

## §41 — Landing Pages (`/lp/:slug`)

**Purpose:** Dynamically rendered campaign landing pages. All content managed via the Admin Panel. Each landing page links to one service and renders any combination of content blocks defined in the admin.

### Layout / Sections

**1. Hero** — H1 from `linkedService.name`, subtext from `linkedService.description`, price badge, `Buy Now` / `Book a Call` CTAs.

**2. Content Blocks** (ordered by admin)

| Block Type | Content Shape |
|------------|--------------|
| `why_this_matters` | Opening value proposition body paragraph |
| `authority` | heading, body, complianceBadges[], stats[] (stat + label) |
| `process` | steps[] (step number, title, description, optional note) |
| `trust_badges` | badges[] |
| `rich_text` | optional title, body, optional list[] |
| `faq` | optional title, items[] (q + a) |
| `testimonials` | items[] (quote, author, optional role/company) |
| `problem_solution` | problem, solution, optional bullets[] |
| `checklist` | optional title, items[] |
| `stats_bar` | stats[] (value + label) |
| `featured_quote` | quote, optional attribution |
| `quiz_cta` | quizType, optional title/description/buttonText |

**3. Linked Service Offer Card** — Shows service price, turnaround, inclusions.

**4. Footer CTA** — `Book a Call` → `/book`

---

## Appendix A — Global Navigation

### Header

- **Logo:** `Shane McCaw Consulting` wordmark with Rocket icon (links to `/`)
- **Background:** Transparent on `/` (homepage); solid Deep Navy `#0A2540/95` with backdrop-blur on all other routes (or when scrolled past 20 px on homepage)
- **Desktop nav:** 5 dropdowns + 1 plain link + `Client Login` link + `Book a Call` CTA
- **Mobile nav:** Hamburger → collapsible accordion sections per group

#### Desktop nav structure

| Element | Type | Label | Route |
|---------|------|-------|-------|
| 1 | Dropdown | Services | — |
| 2 | Dropdown | Quick Wins | — |
| 3 | Dropdown | Retainers | — |
| 4 | Dropdown | Assessments | — |
| 5 | Plain link | Resources | `/resources` |
| 6 | Dropdown | Company | — |
| 7 | Link | Client Login | `/crm/` |
| 8 | CTA button | Book a Call | `/book` |

#### Services dropdown (8 items)

| Label | Route |
|-------|-------|
| Service Overview | `/services` |
| M365 Architecture & Strategy | `/services/microsoft-365` |
| M365 Training | `/services/m365-training` |
| Copilot & AI | `/services/copilot-ai` |
| SharePoint | `/services/sharepoint` |
| Power Platform | `/services/power-platform` |
| Governance | `/services/governance` |
| Cloud Migration | `/services/cloud-migration` |

#### Quick Wins dropdown (8 items)

| Label | Route |
|-------|-------|
| All Quick Wins | `/quick-wins` |
| Start Here | `/quick-win-quiz` |
| Tenant Health Audit | `/quick-wins/tenant-health-audit` |
| Power Platform Quick-Start | `/quick-wins/power-platform-quick-start` |
| Governance Foundations | `/quick-wins/governance-foundations` |
| Migration Readiness Assessment | `/quick-wins/migration-readiness-assessment` |
| Copilot Readiness Assessment | `/quick-wins/copilot-readiness-assessment` |
| Microsoft 365 Training & Enablement | `/quick-wins/m365-training-enablement` |

#### Retainers dropdown (5 items)

| Label | Route |
|-------|-------|
| All Retainer Plans | `/retainers` |
| Start Here | `/retainer-quiz` |
| Architect Essentials | `/retainers/architect-essentials` |
| Architect Growth | `/retainers/architect-growth` |
| Architect Enterprise | `/retainers/architect-enterprise` |

#### Assessments dropdown (9 items — first is featured with FREE badge)

| Label | Route | Note |
|-------|-------|------|
| Free Copilot Readiness Snapshot | `/lp/copilot-readiness-lead-generation-campaign` | Featured item, teal highlight, FREE badge |
| Copilot Readiness Assessment | `/copilot-quiz` | |
| M365 Health Assessment | `/m365-health-quiz` | |
| SharePoint Readiness Assessment | `/sharepoint-readiness-quiz` | |
| Power Platform Risk Assessment | `/power-platform-quiz` | |
| Security & Compliance Assessment | `/security-compliance-quiz` | |
| Teams Maturity Assessment | `/teams-maturity-quiz` | |
| Migration Readiness Assessment | `/migration-readiness-quiz` | |
| Governance Maturity Assessment | `/governance-maturity-quiz` | |

#### Company dropdown (4 items)

| Label | Route |
|-------|-------|
| About | `/about` |
| How We Work | `/how-it-works` |
| Pricing | `/pricing` |
| Contact | `/contact` |

### Footer

- **Logo + tagline**
- **Services** column — links to all 8 service sub-pages
- **Company** column — About · Resources · Contact · Book
- **Compliance badges:** FedRAMP · FISMA · ITAR · GCC High
- **Copyright:** Shane McCaw Consulting

---

## Appendix B — Key CTAs by Page

| Page | Primary CTA | Target |
|------|-------------|--------|
| Home | Book Your Discovery Call | `/book` |
| About | Book a Free Discovery Call | `/book` |
| All service pages | Book a Discovery Call | `/book` |
| Quick Wins hub | Browse packages | `/quick-wins` |
| Quick Win Detail | Buy Now | Stripe checkout |
| Pricing | Book a Call | `/book` |
| Resources | Read More (per article) | `/resources/:slug` |
| Contact | Book a Free Discovery Call | `/book` |
| All quiz pages | Start Assessment / Get Started | quiz route |
| Retainers overview | Get Started / Book a Call | `/book` |
| Retainer detail pages | Get Started | `/book` |
| Quick Win Quiz | (embedded quiz, completes to results) | `/quick-win/results/:resultId` |
| Retainer Quiz | (embedded quiz, shows results inline) | — |

---

## Appendix C — Pricing Reference (Verbatim from Source)

*Note: Live prices are DB-managed via the Admin Panel and may differ from these static source fallbacks.*

| Service | Price (static fallback) |
|---------|------------------------|
| Copilot Readiness Assessment | $5,000–$8,000 |
| Governance Foundations Package | $12,000–$18,000 |
| Migration Readiness Assessment | $3,500–$5,000 |
| Power Platform Quick Start Build | $6,000–$10,000 |
| Project-based engagements (general range) | $7,500–$35,000+ |
| Architect Essentials Retainer | $2,500/month · 10 hours |
| Architect Growth Retainer | $6,000/month · 25 hours |
| Architect Enterprise Retainer | $11,000/month · 50 hours |
| Microsoft 365 Copilot add-on (Microsoft list price) | $30/user/month (requires M365 E3 or E5 base) |
| Track 01 Quick Wins range (dynamic, fallback) | $3,000–$18,000 |
| Track 02 Project range (dynamic, fallback) | $7,500–$35,000+ |

---

*End of documentation. All 41 registered routes covered.*
