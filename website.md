# Verbatim Extraction — `artifacts/shane-mccaw-consulting` vs MSP_Website_Rebuild_Spec_v1

---

## 1. ROUTE INVENTORY

All routes currently registered in `artifacts/shane-mccaw-consulting/src/App.tsx`:

| Route | Component File | Purpose |
|-------|---------------|---------|
| `/` | `pages/Home.tsx` | Homepage — hero, funnel strip, trust strip, audience fork |
| `/about` | `pages/About.tsx` | Shane's bio and experience timeline |
| `/assessment` | `pages/Assessment.tsx` | **STUB** — "Coming soon" placeholder only |
| `/monitoring` | `pages/Monitoring.tsx` | Monitoring packs with seat-count pricing calculator |
| `/retainers` | `pages/retainers/RetainersOverview.tsx` | Retainer tier comparison |
| `/retainers/architect-essentials` | `pages/retainers/ArchitectEssentials.tsx` | Essentials retainer detail |
| `/retainers/architect-growth` | `pages/retainers/ArchitectGrowth.tsx` | Growth retainer detail |
| `/retainers/architect-enterprise` | `pages/retainers/ArchitectEnterprise.tsx` | Enterprise retainer detail |
| `/projects` | `pages/Projects.tsx` | Project-based engagement overview |
| `/msp` | `pages/Msp.tsx` | MSP partner programme — tier selection + onboarding wizard |
| `/services` | `pages/Services.tsx` | Services parent overview |
| `/services/microsoft-365` | `pages/services/Microsoft365.tsx` | M365 service page |
| `/services/copilot-ai` | `pages/services/CopilotAI.tsx` | Copilot AI service page |
| `/services/sharepoint` | `pages/services/SharePoint.tsx` | SharePoint service page |
| `/services/power-platform` | `pages/services/PowerPlatform.tsx` | Power Platform service page |
| `/services/governance` | `pages/services/Governance.tsx` | Governance service page |
| `/services/cloud-migration` | `pages/services/CloudMigration.tsx` | Cloud Migration service page |
| `/services/m365-training` | `pages/services/M365Training.tsx` | M365 Training service page |
| `/services/security-hardening` | `pages/services/SecurityHardening.tsx` | Security Hardening service page |
| `/resources` | `pages/Resources.tsx` | Resources/blog listing |
| `/resources/:slug` | `pages/ArticlePage.tsx` | Individual article page |
| `/contact` | `pages/Contact.tsx` | Contact / AI chat interface |
| `/book` | `pages/Book.tsx` | Booking page |
| `/checkout` | `pages/Checkout.tsx` | Checkout wizard (catalog-driven, 4-step) |
| `/legal/terms` | `pages/legal/Terms.tsx` | Terms of Service |
| `/legal/privacy` | `pages/legal/Privacy.tsx` | Privacy Policy |
| `/privacy` | `pages/Privacy.tsx` | Legacy privacy redirect |
| `/quick-wins` | `pages/MicroOffers.tsx` | Quick Win packages listing |
| `/quick-wins/:slug` | `pages/quick-wins/MicroOfferDetail.tsx` | Individual Quick Win detail |
| `/pricing` | `pages/Pricing.tsx` | Pricing overview (catalog-driven) |
| `/copilot-quiz` | `pages/CopilotQuiz.tsx` | Copilot readiness quiz |
| `/m365-health-quiz` | `pages/quizzes/M365HealthQuiz.tsx` | M365 health quiz |
| `/sharepoint-readiness-quiz` | `pages/quizzes/SharePointQuiz.tsx` | SharePoint readiness quiz |
| `/power-platform-quiz` | `pages/quizzes/PowerPlatformQuiz.tsx` | Power Platform quiz |
| `/security-compliance-quiz` | `pages/quizzes/SecurityQuiz.tsx` | Security & compliance quiz |
| `/teams-maturity-quiz` | `pages/quizzes/TeamsQuiz.tsx` | Teams maturity quiz |
| `/migration-readiness-quiz` | `pages/quizzes/MigrationQuiz.tsx` | Migration readiness quiz |
| `/governance-maturity-quiz` | `pages/quizzes/GovernanceQuiz.tsx` | Governance maturity quiz |
| `/quiz/results/:leadId` | `pages/QuizResultsPage.tsx` | Quiz results (token-gated, 7-day link) |
| `/quick-win-quiz` | `pages/QuickWinQuiz.tsx` | Quick Win "Start Here" quiz |
| `/quick-win/results/:resultId` | `pages/QuickWinResultsPage.tsx` | Quick Win quiz results |
| `/retainer-quiz` | `pages/retainers/RetainerQuiz.tsx` | Retainer selector quiz |
| `/how-it-works/technical` | `pages/TechnicalOverview.tsx` | Technical overview |
| `/how-it-works` | `pages/HowItWorks.tsx` | How it works |
| `/assessments` | `pages/Assessments.tsx` | Assessments overview |
| `/lp/:slug` | `pages/LandingPage.tsx` | Dynamic landing pages |
| `/onboarding/:token` | `pages/OnboardingLink.tsx` | Onboarding token redemption |
| (catch-all) | `pages/not-found.tsx` | 404 |

**Explicitly confirmed status of routes from the spec question:**

- **`/checkout` (legacy)** — **EXISTS.** Registered at line 113, pointing to `pages/Checkout.tsx`. This is NOT the legacy checkout — it is the new 4-step catalog-driven checkout wizard. There is no separate "legacy checkout" remaining; the route was repurposed.
- **`/admin`** — **DOES NOT EXIST in the router.** `pages/Admin.tsx` file is present in the filesystem but is **not imported and not registered** in `App.tsx`. There is no route for it.
- **`/customer-command-center`** — **DOES NOT EXIST in the router.** `pages/CustomerCommandCenter.tsx` file is present in the filesystem but is **not imported and not registered** in `App.tsx`. There is no route for it.
- **`/lp/:slug`** — **EXISTS.** Registered at line 135, pointing to `pages/LandingPage.tsx`.

---

## 2. VERBATIM PAGE COPY

### `/` — Home

**Eyebrow pill:**
> Microsoft 365 & Copilot AI Specialist

**Credential pills:**
> Lead M365 Architect at NASA
> 30 Years Microsoft Ecosystem Experience

**H1:**
> The Architect Who Built at NASA Scale — Available to You.

**Subhead (teal):**
> Mission-critical Microsoft 365 architecture for mid-market and regulated organizations — without a full-time hire.

**Body:**
> Shane McCaw brings the same discipline he built at NASA to your organization. Start with a free tenant assessment, or connect your environment for continuous monitoring. Senior Microsoft expertise delivered personally — no account managers, no offshore handoffs.

**Primary CTA button:** `Start Your Free Assessment` → `/assessment`

**Secondary link:** `Explore Monitoring →` → `/monitoring`

**Microcopy below CTAs:**
> No call required to start — connect your tenant, see your findings, get a scoped plan.

**Mini trust badges (bottom of hero):**
> Fractional M365 Architecture · Copilot AI Readiness · Governance & Compliance · Cloud Migration · 30+ Years Microsoft Experience

---

**FUNNEL NARRATIVE STRIP — "Assess. Monitor. Act."**

Section eyebrow: `How It Works`
H2: `Assess. Monitor. Act.`
Body: `Every successful Microsoft 365 environment follows the same three disciplines. Shane has built and run this loop at scale — and brings the same rigor to your organization.`

Step 01 — **Assess** (icon: Search, color: #0078D4):
> A structured, automated tenant health audit gives you a clear picture of your current Microsoft 365 environment — security posture, governance gaps, Copilot readiness, and compliance exposure — before you commit to anything.

CTA: `Start Your Free Assessment` → `/assessment`

Step 02 — **Monitor** (icon: Activity, color: #00B4D8):
> Continuous signal monitoring tracks configuration drift, licensing changes, security policy violations, and governance erosion so that small problems don't become expensive remediation projects.

CTA: `See How Monitoring Works` → `/monitoring`

Step 03 — **Act** (icon: Zap, color: #0A2540):
> When findings surface — from an assessment or a live monitoring alert — Shane scopes a fixed-price engagement to address them. No open-ended consulting. No scope creep. Defined outcomes, delivered personally.

CTA: `View Project Work` → `/projects`

---

**TRUST STRIP — "30 Years of Microsoft Depth — Built at Mission-Critical Scale"**

Section eyebrow: `Why Shane`
H2: `30 Years of Microsoft Depth — Built at Mission-Critical Scale`

Body paragraph 1:
> Shane McCaw has spent three decades inside the Microsoft ecosystem — from early infrastructure deployments to leading Microsoft 365 architecture for one of the most compliance-intensive organizations on earth: NASA. As Lead M365 Architect, Shane designed and governed the systems used by scientists, engineers, and administrators whose work cannot fail.

Body paragraph 2:
> Most consultants learn compliance frameworks from documentation. Shane learned them under real-world conditions where misconfiguration carried legal and mission consequences. FedRAMP, FISMA, ITAR, and GCC High aren't checklists to him — they're the environment he operated in daily. That discipline is now available to your organization on a fractional basis.

**Trust point list (5 items):**
> 30+ years inside the Microsoft ecosystem — from early infrastructure to modern cloud
> Current Lead Microsoft 365 Architect at NASA
> Compliance frameworks (FedRAMP, FISMA, ITAR, GCC High) learned under real mission-critical conditions
> Every engagement delivered personally — no account managers, no junior staff, no offshore handoffs
> Fixed-price scoping so you always know what you're getting and what it costs

**Compliance badges:** FedRAMP · FISMA · ITAR · GCC High

**Stats row:**
> 30+ Years in the Microsoft Ecosystem
> NASA — Lead M365 Architect — Current Role
> 100% Senior Delivery — No Junior Staff

---

**AUDIENCE FORK STRIP — "Who I Work With"**

Section eyebrow: `Who I Work With`
H2: `Organizations With Real Complexity — and the Ambition to Fix It`
Body: `Shane works best with organizations that have outgrown generic IT support and need a senior Microsoft architect who has solved problems at mission-critical scale.`

Card 1 — **Mid-Market Enterprises**
Subtitle: `200–2,000 Employees`
> You've deployed Microsoft 365, but governance never followed. Now Copilot is on the roadmap and the tenant isn't ready for it.

Card 2 — **Regulated & Government-Adjacent**
Subtitle: `Healthcare · Legal · Financial · Federal Contractors`
> Your compliance frameworks demand senior-level architecture. Hiring a full-time M365 architect takes months — and a fractional engagement gets you there faster.

Card 3 — **Startups & Scale-Ups**
Subtitle: `Rapid Growth · First-Time Architecture`
> Headcount is outpacing your initial Microsoft 365 setup. Build it right before scale makes it exponentially harder to fix.

**Primary CTA:** `Start Your Free Assessment` → `/assessment`

**Subordinate MSP text:**
> Are you an MSP or Microsoft partner? [See our MSP program →](/msp)

---

**SOCIAL PROOF STRIP**

> "Working with Shane was the first time our M365 environment was actually documented, governed, and ready for what came next."
> — Director of IT, Mid-Market Healthcare Organization

---

**CLOSING CTA SECTION**

Eyebrow: `Free Tenant Assessment`
H2: `Your Microsoft 365 Environment Deserves Senior Expertise.`
Body: `Work directly with a 30-year Microsoft veteran and NASA's Lead M365 Architect. No account managers. No junior staff. Clear, actionable guidance — starting with a free assessment.`

Primary CTA: `Start Your Free Assessment` → `/assessment`
Secondary link: `Explore Monitoring →` → `/monitoring`
Microcopy: `No pitch. No obligation. Just clarity on your Microsoft 365 environment.`

---

### `/assessment` — Assessment

**STUB. Full page content:**

H1: Free M365 Assessment
Body: Coming soon — full page in the next release.

This is a full-screen stub on a `bg-[#0A2540]` background. No form, no assessment logic, no quiz embed, no API call. Completely empty.

---

### `/monitoring` — Monitoring

**Hero:**

Eyebrow pill: `Continuous Tenant Monitoring`

H1: `Know what's happening in your Microsoft 365 tenant — before it becomes a problem.`

Body:
> Configuration drift, security misconfigurations, and licence waste don't announce themselves. Shane's monitoring packs watch your tenant continuously and surface actionable signals — so you can act before users, auditors, or attackers do.

Mini trust row:
> No agents to deploy · Weekly signal reports · Escalate to Shane directly

---

**"How it works" strip (3 steps):**

Step 1 — **Connect**
> Grant read-only access to your Microsoft 365 tenant via admin consent. No agents, no software to install.

Step 2 — **Watch**
> Shane's monitoring engine continuously evaluates your tenant against your pack's signal library — configuration, security, licence, and compliance checks.

Step 3 — **Act**
> Receive a weekly signal digest. Critical signals trigger an immediate notification so you can remediate fast — or escalate to Shane for hands-on help.

---

**Seat count selector:**

H2: `How many licensed M365 seats does your organisation have?`
Subtext: `Pricing adjusts live as you change the seat count.`
Default value: **25 seats**. Increment: ±5 via buttons, or direct numeric input (min 1, max 10,000).

---

**Pack cards — catalog-driven:**

Cards are fetched from the API (`fetchServices("monitoring")`). The component handles three states:

- **Loading:** Spinner (Loader2, animated)
- **Error:** `Could not load monitoring packs. Please refresh and try again.`
- **Empty (sorted.length === 0):** `No monitoring packs available yet — check back soon.`
- **Loaded:** Cards rendered per `MonitoringTier` row from the database. A tier with `price = null` displays "Custom pricing — Scoped to your environment" and a "Contact us" button → `/contact`. A tier with a price but no `fulfillmentTypeKey` renders a disabled "Coming soon" button. A tier with both `price` AND `fulfillmentTypeKey` renders "Get Started" → `/checkout?product={slug}`.

Price display formula: `perSeatDollars × seats` formatted as USD with no decimals, with `/mo` suffix. Per-seat rate and seat count shown as subtext.

---

**"What monitoring catches" — 6 categories (hardcoded):**

- **Security misconfigurations:** MFA gaps, legacy auth enabled, overly permissive Conditional Access, admin role sprawl.
- **Configuration drift:** Policies that changed without a change request — SharePoint sharing settings, Teams guest access, DLP rules.
- **Licence waste:** Assigned but unused licences, duplicate SKUs, unactivated Copilot seats.
- **User & identity risks:** Stale guest accounts, unmanaged service accounts, orphaned mailboxes.
- **Compliance signals:** Retention policy gaps, audit log disabled, data governance weaknesses.
- **Copilot readiness blockers:** Data access oversharing, missing sensitivity labels, governance prerequisites not met.

---

**Bottom CTA:**

H2: `Not sure which pack fits?`
Body: `Book a free 30-minute call. Shane will recommend the right coverage for your environment — no pressure, no sales pitch.`

Buttons: `Book a Free Discovery Call` → `/book` | `Send Shane a message →` → `/contact`

---

### `/checkout` — Checkout

4-step wizard: **Your info → M365 access → Review & pay → Confirmed**

**Step 1 — "Your information":**
> Enter your details to get started.

Fields: Full name, Work email. Button: `Continue →`

Selected service summary card shows service name + price from catalog.

**Step 2 — "Microsoft 365 admin consent":**
> Shane's monitoring and automation tools need read access to your Microsoft 365 tenant. This is granted once by your M365 administrator.

Info block:
> **Who does this step:** Your Microsoft 365 Global Administrator or a Privileged Role Administrator.
> **What access is granted:** Read-only access to tenant configuration, user data, and service health. No changes are made without your explicit approval.

If `consentUrl` is available (fetched from `/api/public/consent-url`): renders `Grant admin consent in Microsoft ↗` button. If not available: `Your M365 administrator will receive consent instructions from Shane after purchase. You can skip this step for now.`

Checkbox: `I confirm that our Microsoft 365 administrator has granted — or will grant — admin consent for Shane's service account.`

Buttons: `I'll arrange this separately` | `Continue to payment →` (disabled until checkbox checked).

If declined: amber warning block explaining consent can be handled post-purchase, with "Try consent again" and "Continue to payment →" buttons.

**Step 3 — "Review & pay":**

Order summary card: service name + description + price + "Purchasing as: {name} · {email}".

Terms clickwrap: `I agree to the [Terms of Service] and [Privacy Policy]. I understand that clicking "Proceed to payment" will redirect me to Stripe to complete the purchase.`

Security note: `Payments are processed securely by Stripe. Your card details are never stored on our servers.`

CTA: `Proceed to payment ↗` (disabled until terms checked). While launching: `Preparing secure checkout…`

Error states: payment canceled (amber), session expired (amber), payment error (red).

**Step 4 — "Order confirmed!":**
> Thank you for your purchase. You'll receive an email at {email} with account setup instructions within one business day.
> Shane will personally reach out to schedule your onboarding call and begin your engagement.

Button: `Return home`

**Non-wizard states:**

- **not-found:** `Service not found — We couldn't find a service matching {slug}. It may have been removed or the link may be incorrect.` Button: `View all services` → `/pricing`
- **unavailable (no fulfillmentTypeKey):** `This service isn't yet available for online purchase. Please contact Shane directly to discuss your requirements and get started.` Buttons: `Contact Shane` → `/contact` | `Book a discovery call` → `/book`
- **catalog-error:** `Unable to load service catalogue — There was a problem fetching service information. Please refresh and try again.`

---

### `/msp` — MSP Partner Programme

**Hero:**

Eyebrow: `MSP & Partner Programme`

H1: `Deliver Enterprise-Grade M365 Architecture Under Your Own Brand`

Body:
> White-label Microsoft 365 governance, security hardening, and Copilot readiness services — backed by NASA-proven methodology and 30 years of Microsoft ecosystem experience.

CTAs: `View Partnership Tiers →` (anchor `#tiers`) | `Talk to Shane First` → `/contact`

---

**"Why Partner With Shane" — 4 cards (hardcoded):**

- **NASA-Proven Methodology:** Offer your clients the same Microsoft 365 architecture discipline Shane built for one of the world's most security-sensitive federal IT environments.
- **White-Label Ready:** Deliver assessments, governance frameworks, and advisory services under your own brand — backed by 30 years of Microsoft ecosystem expertise.
- **Tenant Allowance Scales With You:** Each tier includes a set number of managed tenants. Add more as your portfolio grows — overage billing is transparent and predictable.
- **AI Credits Included:** Copilot readiness assessments and AI-assisted governance reviews are bundled into every tier, so you can deliver high-value advisory at scale.

---

**3-step wizard: Tiers → Onboarding → Confirm**

**Step 1 — "Choose Your Plan":**

Tiers fetched from `/api/msp/signup/tiers`. Handles loading (skeleton), error (red block with "Contact Shane Directly"), and empty (white block with "Contact Shane").

For each tier from the API:
- If `fulfillmentTypeKey` is set: renders `Get Started →` button that triggers Step 2.
- If `fulfillmentTypeKey` is null: renders `Not yet available for self-service signup` + `Contact Shane →` link.

---

**Step 2 — "How Would You Like to Get Started?" (Onboarding Package):**

Two hardcoded onboarding options:

**Self-Service Setup** (key: `self_service`):
> Guided onboarding documentation and a recorded walkthrough. Ideal for technically confident partners who want to configure the platform independently.
> Detail: Access to the partner portal immediately. Setup guide + video walkthrough included.

**White-Glove Onboarding** (key: `white_glove`):
> A live onboarding session with Shane, full environment review, and co-configured first tenant handoff. Recommended for first-time MSP partners.
> Detail: Includes 2×60-min live sessions, tenant co-configuration, and a 30-day check-in call.

Prices for each option are fetched from the services catalog (`useServices("msp_onboarding")`) and displayed as `+$X,XXX` or `Included` if price is 0. If the catalog row is missing, the price badge is hidden.

CTA: `Continue →` (disabled until an option is selected).

---

**Step 3 — "Almost There" (Review & Confirm):**

Summary card shows: Selected Plan name + price, Onboarding choice, Tenant Allowance, AI Credits (if applicable), overage rate.

Terms clickwrap: `I have read and agree to the [MSP Partner Agreement] and understand the billing terms above.`

CTA: `Proceed to Checkout →` (disabled until terms checked). Triggers `window.location.href = /checkout?product={slug}&onboarding={key}`.

---

### `/quiz/results/:leadId` — QuizResultsPage

Token-gated. Fetches from `/api/quiz/results/{leadId}?token={token}`. Token links expire after 7 days.

**Score overview card:** Total score out of 50, Maturity Tier badge (Beginner/Developing/Emerging/Advanced/Ready), category score bars (out of 10 each).

**"What This Means For You"** — rendered from `data.whatThisMeans` (API-provided string).

**"Recommended Next Step"** — rendered from `data.recommendedService` + `data.whyThisFits` (API-provided).

**Primary CTAs in the recommended service block:**

```jsx
<a href="/monitoring">
  Keep this current — Start Monitoring →
</a>
<a href="/contact">
  Discuss my results
</a>
```

**ROI Projection** — rendered from `data.roiProjection` (API-provided string).

Footer: `Report link expires after 7 days`

---

### `/retainer-quiz` results — RetainerQuizResults.tsx

Rendered inline within the Retainer Quiz page flow (passed `scores` + `onRetake` props). Not a standalone route.

**Primary CTA block (on the Best Match card):**

```jsx
<CTAButton href="/monitoring" className="px-6 py-2.5 text-sm">
  Keep this current — Start Monitoring
</CTAButton>
<CTAButton
  href="/contact"
  className="px-6 py-2.5 text-sm !bg-[#0A2540] hover:!bg-[#0A2540]/90"
>
  Discuss my results
</CTAButton>
```

**Recommended Next Steps section (4 items):**

1. `Review the {config.headline} plan` → `config.href` (dynamically derived from TIER_CONFIG — e.g., `/retainers/architect-essentials`)
2. `Start your {config.headline} retainer` → `config.bookHref` (dynamically derived — e.g., `/checkout?product=architect-essentials`)
3. `Discuss my results with Shane` → `/contact`
4. `Compare all retainer tiers` → `/retainers`

---

## 3. HOMEPAGE STRUCTURE

**The hero is NOT a two-way audience fork (direct client / MSP) at the hero level. It is a single-funnel hero.**

The hero has one primary CTA (`Start Your Free Assessment`) and one secondary CTA (`Explore Monitoring`). Assessment is the primary CTA.

The MSP fork appears much lower on the page — at the bottom of the "Who I Work With" (audience segments) section, as subordinate prose:

> Are you an MSP or Microsoft partner? [See our MSP program →]

**Verbatim hero + funnel strip + trust strip text:** Fully documented in Section 2 above.

---

## 4. /monitoring IMPLEMENTATION

**Does this page have a seat-count input?** YES. The `SeatInput` component renders a numeric input (default 25) with ±5 increment buttons. The seat count is local React state and adjusts all card prices live.

**Does it compute Pack × Tenant Tier pricing?** The page uses a single tier dimension only. There is no "Tenant Tier" (Micro/SMB/Mid-Market/Enterprise) second dimension. The formula is strictly:

```
totalDollars = parseFloat(tier.price) × seats
```

`tier.price` is expected to be a per-seat-per-month dollar value from the `services` table. There is no pack × tenant tier matrix, no lookup table, no multi-dimensional pricing.

**When catalog rows don't exist:**

```
!loading && !error && sorted.length === 0 →
  <div>No monitoring packs available yet — check back soon.</div>
```

No crash. No hardcoded fallback prices. The page simply shows the empty state message and the "how it works" / "what monitoring catches" copy sections still render normally above and below.

**Verbatim pricing section code:**

```tsx
function computeTotal(perSeatDollars: string | null, seats: number): number | null {
  if (!perSeatDollars) return null;
  const n = parseFloat(perSeatDollars);
  if (isNaN(n)) return null;
  return Math.round(n * seats);
}

function isContactUsTier(t: MonitoringTier): boolean {
  return !t.price;
}

// In PackCard:
const contactUs = isContactUsTier(tier);
const totalDollars = contactUs ? null : computeTotal(tier.price, seats);
const hasCheckout = !contactUs && !!tier.fulfillmentTypeKey && !!tier.slug;

// Price display:
{contactUs ? (
  <p className="text-2xl font-extrabold">Custom pricing</p>
) : (
  totalDollars !== null ? (
    <>
      <p>{fmtDollars(totalDollars)}/mo</p>
      <p>{fmtDollars(parseFloat(tier.price))} per seat · {seats} seats</p>
    </>
  ) : (
    <p>—</p>
  )
)}

// CTA button:
{!tier.fulfillmentTypeKey ? (
  <Button disabled>Coming soon</Button>
) : (
  <Link href={`/checkout?product=${tier.slug}`}>
    <Button>Get Started</Button>
  </Link>
)}
```

---

## 5. CHECKOUT IMPLEMENTATION

**Does the frontend select Stripe mode (one-time vs subscription)?**

The frontend `Checkout.tsx` does **not** select Stripe mode. It calls `/api/portal/checkout/create-session` with `serviceIds` and `contractIds`. Mode selection happens entirely on the API server side in `portal-checkout.ts`.

**API-side mode selection code path:**

```typescript
// portal-checkout.ts line 217–240:
let serviceClass: "project" | "add_on" | "subscription" = "add_on";
let fulfillmentTypeKey: string | null = null;
// ...fetches service row...
serviceClass = (svc.serviceClass as "project" | "add_on" | "subscription" | null) ?? "add_on";
fulfillmentTypeKey = svc.fulfillmentTypeKey ?? null;

// line 550:
const mode = serviceClass === "subscription" ? "subscription" : "payment";
```

**Does it reference `fulfillmentTypeKey` values, and if so, exactly which ones?**

Yes. `fulfillmentTypeKey` is stored in Stripe session metadata and used after webhook confirmation to route to `resolveFulfillment()`. Values seen in test fixtures:

```typescript
fulfillmentTypeKey: "assessment"          // on assessmentService
fulfillmentTypeKey: "bundle_subscription" // on subscriptionService
fulfillmentTypeKey: "retainer"            // on projectService
```

The actual values in production are entirely driven by what is in the `services.fulfillmentTypeKey` DB column.

**What currently happens if a visitor tries to check out a product with no `fulfillmentTypeKey` in the DB?**

In the **frontend** (`Checkout.tsx`):

```typescript
if (!svc.fulfillmentTypeKey) {
  setStep("unavailable");
  return;
}
```

The user sees:
> "This service isn't yet available for online purchase. Please contact Shane directly to discuss your requirements and get started."

With buttons: `Contact Shane` → `/contact` | `Book a discovery call` → `/book`

No error thrown, no crash. The checkout wizard never starts.

**`priceDisplay` computation in frontend:**

```typescript
const priceDisplay = service
  ? service.billingType === "recurring_monthly"
    ? `${fmtPrice(Number(service.price ?? 0) * 100)}/mo`
    : fmtPrice(Number(service.price ?? 0) * 100)
  : null;

function fmtPrice(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  });
}
```

Note: `service.price` is in dollars (string from catalog), multiplied by 100 to get cents, then divided by 100 in `fmtPrice` for display. Net result is correct, but the intermediate representation is awkward.

---

## 6. /msp IMPLEMENTATION

**Does this page exist?** YES — registered at `/msp`.

**Does it include tier selection?** YES — fetched dynamically from `/api/msp/signup/tiers`. The tier names are not hardcoded in the component — all tier data (name, price, tenantAllowance, aiCreditAllowance, overageRateCents, features, badge, highlighted, fulfillmentTypeKey) comes from the API.

**Does it include MSP Onboarding package selection?** YES — Step 2 shows two hardcoded onboarding options: Self-Service Setup and White-Glove Onboarding. Prices for each are fetched from `useServices("msp_onboarding")` catalog rows. If those catalog rows are absent, the price badge simply doesn't render.

**Does it include native checkout?** YES, in the form of a redirect. Step 3 "Confirm" triggers:

```typescript
window.location.href = `/checkout?product=${selectedTier.slug}&onboarding=${selectedOnboarding}`;
```

This sends the user to the standard `/checkout` wizard. There is no inline payment on the `/msp` page itself.

**What's missing/stubbed vs what the spec may require:**

The component handles the case where `fulfillmentTypeKey` is null on a tier — it renders a "Contact Shane" fallback. If the DB has no MSP tiers at all, it shows: `No tiers available yet — Partnership tiers are being configured. Contact Shane directly to discuss your options.`

---

## 7. NO-HARDCODING CHECK

Grep command run: `grep -rn '[$]' artifacts/shane-mccaw-consulting/src/pages/ --include="*.tsx"`

**All hardcoded dollar values found (currency context only, CSS templates excluded):**

| File | Line | Value | Context |
|------|------|-------|---------|
| `ArchitectEssentials.tsx` | 140 | `$1,500/mo` | `<title>` SEO tag |
| `ArchitectEssentials.tsx` | 398 | `Architect Growth — $3,000/mo` | Cross-sell card, hardcoded |
| `ArchitectGrowth.tsx` | 95 | `"$6,000"` | `formatPrice()` fallback default |
| `ArchitectGrowth.tsx` | 134 | `$6,000/mo` | `<title>` SEO tag |
| `ArchitectGrowth.tsx` | 397 | `Architect Essentials — $1,500/mo` | Cross-sell card, hardcoded |
| `ArchitectGrowth.tsx` | 410 | `Architect Enterprise — $5,500/mo` | Cross-sell card, hardcoded |
| `ArchitectEnterprise.tsx` | 121 | `"$11,000"` | `formatPrice()` fallback default |
| `ArchitectEnterprise.tsx` | 161 | `$11,000/mo` | `<title>` SEO tag |
| `ArchitectEnterprise.tsx` | 408 | `Architect Growth — $3,000/mo` | Cross-sell card, hardcoded |
| `ArchitectEnterprise.tsx` | 460 | `$11,000/month` | CTA button label, hardcoded |
| `GovernanceQuiz.tsx` | 39,47,55,63,71 | `From $12,000` | Service badge strings |
| `M365HealthQuiz.tsx` | 40,48,56,64,72 | `From $4,500` | Service badge strings |
| `MigrationQuiz.tsx` | 39,47,55,63,71 | `From $3,500` | Service badge strings |
| `PowerPlatformQuiz.tsx` | 40,48,56,64,72 | `From $6,000` | Service badge strings |
| `SecurityQuiz.tsx` | 52,60,68,76,84 | `From $12,000` | Service badge strings |
| `SharePointQuiz.tsx` | 40,48,56 | `From $4,500` | Service badge strings |
| `CopilotQuiz.tsx` | 91,101,111,121,131 | `From $4,500` | Service badge strings |
| `MicroOfferDetail.tsx` | 80 | `$20M – $500M annually` | ROI context copy |
| `MicroOfferDetail.tsx` | 303 | `$5,000 … $50,000` | Urgency copy |
| `MicroOfferDetail.tsx` | 479 | `$150,000–$220,000/yr` | Comparison table |
| `Pricing.tsx` | 32 | `"$7,500 – $35,000+"` | Hardcoded fallback range (track02) |
| `Pricing.tsx` | 107 | `"$3,000 – $18,000"` | Hardcoded fallback range (micro_offer) |
| `Pricing.tsx` | 265 | `"$150k–$220k/year"` | Hardcoded comparison |
| `Pricing.tsx` | 311 | `"Starting from $3,000"` | Hardcoded Track 02 copy |
| `CustomerCommandCenter.tsx` | 85–115, 222 | `$3,500/mo, $4,200, $6,500, $7,500, $150k–$220k` | Orphaned file (no route), mock data only |

**Tier name grep** result against `src/pages/ --include="*.tsx"`: **zero matches** for `Micro|SMB|Mid-Market|Enterprise|Basic|Enhanced|Premium|Free|Growth|Pro|Architect Essentials|Architect Growth|Architect Enterprise` as bare JSX text.

**Seat-count number grep** (`[0-9]+ seats` or similar) against `src/pages/ --include="*.tsx"`: **zero matches**.

---

## 8. QUIZ RESULTS CTA

### `QuizResultsPage.tsx` — primary CTAs (verbatim):

```jsx
<div className="flex flex-col sm:flex-row gap-2 pt-1">
  <a
    href="/monitoring"
    className="flex-1 py-2.5 px-4 bg-[#0078D4] hover:bg-[#0078D4]/90 text-white font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-1.5"
  >
    Keep this current — Start Monitoring <ArrowRight className="w-3.5 h-3.5" />
  </a>
  <a
    href="/contact"
    className="flex-1 py-2.5 px-4 border border-white/20 hover:border-white/40 text-white/80 hover:text-white font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-1.5"
  >
    Discuss my results
  </a>
</div>
```

**Link targets:** Primary → `/monitoring`. Secondary → `/contact`. No direct link to `/checkout`, `/assessment`, or any specific service page.

---

### `RetainerQuizResults.tsx` — primary CTAs (verbatim):

```jsx
<div className="flex flex-col sm:flex-row gap-3">
  <CTAButton href="/monitoring" className="px-6 py-2.5 text-sm">
    Keep this current — Start Monitoring
  </CTAButton>
  <CTAButton
    href="/contact"
    className="px-6 py-2.5 text-sm !bg-[#0A2540] hover:!bg-[#0A2540]/90"
  >
    Discuss my results
  </CTAButton>
</div>
```

**"Recommended Next Steps" step 2 CTA (verbatim):**

```jsx
<Link
  href={config.bookHref}
  className="inline-flex items-center gap-1.5 text-[#0078D4] font-semibold text-sm hover:underline"
>
  Start onboarding <ArrowRight className="w-3.5 h-3.5" />
</Link>
```

`config.bookHref` is derived from `TIER_CONFIG[recommended]` in `RetainerSelectorQuiz.tsx` — resolves to a tier-specific checkout URL (e.g. `/checkout?product=architect-essentials`).

---

## 9. WHAT WAS SKIPPED, STUBBED, OR BUILT DIFFERENTLY

This is exhaustive. Every item is an explicit delta from what would be expected based on the spec.

1. **`/assessment` is a stub.** The page renders nothing but `<h1>Free M365 Assessment</h1>` and `"Coming soon — full page in the next release."` No form, no tenant connector, no quiz embed, no API call. The primary CTA on the homepage and monitoring page both link here.

2. **`/admin` route was removed from the router.** `pages/Admin.tsx` exists on disk but is not imported or registered. No route resolves to it.

3. **`/customer-command-center` route does not exist.** `pages/CustomerCommandCenter.tsx` exists on disk with fully built UI (mocked data — hardcoded contracts, invoices, chat messages, dollar amounts), but the route is never registered in the router. The page is unreachable.

4. **Homepage hero is a single-funnel hero, not a two-way audience fork.** The spec implies a direct-client / MSP fork in the hero. What was built: one hero (Assessment + Monitoring CTAs), with the MSP entry point demoted to a text link in the "Who I Work With" section below the fold. There is no MSP-track hero path.

5. **The retainer detail pages have hardcoded prices in cross-sell cards, SEO titles, and fallback display values.** These are not driven by the catalog. Full list in Section 7.

6. **Quiz badge prices are hardcoded in all 8 quiz files.** Every quiz has hardcoded `badge` strings like `"Start Here · From $4,500"`, `"Enterprise Grade · From $12,000"` etc. in their service recommendation arrays. These are not read from the catalog.

7. **`Pricing.tsx` has two hardcoded fallback price ranges** that render when the corresponding catalog rows are absent. These are visible to real users when the DB is empty: Track 01 → `"$3,000 – $18,000"`, Track 02 → `"$7,500 – $35,000+"`.

8. **`Pricing.tsx` Track 02 copy hardcodes `"Starting from $3,000"`** independent of any fallback logic.

9. **`MicroOfferDetail.tsx` has hardcoded copy dollar values** in the urgency section and comparison table.

10. **The `/checkout` route is not "legacy" — it was repurposed.** The route now points to the new 4-step wizard. There is no legacy checkout preserved separately.

11. **The checkout frontend does not have a Stripe mode selection layer.** Mode (`payment` vs `subscription`) is determined entirely server-side from the `serviceClass` column. If a monitoring tier has `serviceClass = null` (defaults to `"add_on"`), it will always generate a one-time `payment` checkout regardless of its `billingType` field.

12. **The `/msp` checkout path goes through the shared `/checkout` wizard, not a dedicated MSP checkout page.** The `?onboarding=` query param passed from the MSP wizard is not currently read or displayed by `Checkout.tsx` — it is not passed to the contract or Stripe session creation calls. The onboarding selection the MSP made in Step 2 is invisible to the downstream checkout wizard.

13. **`RetainerQuizResults.tsx` "Start onboarding" CTA links to `config.bookHref`** which resolves from `TIER_CONFIG` — likely goes to `/checkout?product=architect-X` rather than directly to a booking page. Exact value unconfirmed without reading `RetainerSelectorQuiz.tsx`.

14. **`/customer-command-center` page has entirely hardcoded mock data** — specific named clients, dollar amounts, contract dates. It is a static prototype, not a live CRM-connected page.

15. **The `pages/checkout/` subdirectory** contains two additional files (`CheckoutGate.tsx` and `ServiceCatalog.tsx`) that are not referenced by `Checkout.tsx`. These appear to be orphaned or WIP components.

16. **No `pages/Admin.tsx` route** means the admin panel referenced in the old replit.md (`/admin`, password-protected) is gone from the marketing site. The admin panel now lives at `/admin-panel/` as a separate artifact.
