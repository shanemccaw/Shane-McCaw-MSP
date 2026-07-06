# CRM & Client Portal — Complete Reference Documentation

> **Audience:** Shane McCaw (day-to-day operations) and future developers/contractors.
> **Purpose:** AI-ready structured reference for generating client journey diagrams, onboarding flow charts, portal navigation maps, and automation suggestions without reading source code.
> **Last updated:** 2026-07-06

---

## Table of Contents

1. [CRM Architecture Overview](#1-crm-architecture-overview)
2. [Client Account Lifecycle](#2-client-account-lifecycle)
3. [Client Authentication Flow](#3-client-authentication-flow)
4. [Onboarding Wizard](#4-onboarding-wizard)
5. [Quick Win Diagnostic Flow](#5-quick-win-diagnostic-flow)
6. [Presentation and SOW Viewer](#6-presentation-and-sow-viewer)
7. [Pay-Today Discount and Payment Plans](#7-pay-today-discount-and-payment-plans)
8. [Post-Payment Project Provisioning](#8-post-payment-project-provisioning)
9. [Client Portal Dashboard](#9-client-portal-dashboard)
10. [Projects Section](#10-projects-section)
11. [Services Section](#11-services-section)
12. [Billing Section](#12-billing-section)
13. [Messaging Section](#13-messaging-section)
14. [M365 Intelligence Sections](#14-m365-intelligence-sections)
15. [Admin CRM Views (Pipeline & Delivery)](#15-admin-crm-views-pipeline--delivery)
16. [Client-Admin Data Flows and Sync](#16-client-admin-data-flows-and-sync)
17. [Secrets and External Integrations](#17-secrets-and-external-integrations)

---

## 1. CRM Architecture Overview

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend framework | React + Vite + TypeScript |
| Routing | Wouter (`base` set to artifact `BASE_URL`) |
| State / data fetching | TanStack Query (React Query) v5, 30s stale time |
| Styling | Tailwind CSS v4 |
| UI kit | shadcn/ui + Lucide icons |
| Build system | pnpm workspace monorepo |

### Artifact Path

- **Directory:** `artifacts/crm/`
- **Workspace package:** `@workspace/crm`
- **Preview path:** `/crm/` (proxied through the Replit reverse proxy)
- **Production path:** same as above on the deployed domain

### Dual-Interface Architecture

The CRM artifact serves **two separate audiences** on the same codebase:

| Audience | Entry URL | Gating component |
|----------|-----------|-----------------|
| **Clients** | `/crm/` → redirects to `/portal` | `RequireAuth role="client"` + `RequireEngagement` |
| **Admins** | `/crm/` → immediately redirects to `/admin-panel/` | `window.location.href` redirect (bypasses React router) |

Admins never see the client portal UI. Any admin hitting a `/crm/` path is silently forwarded to the Admin Panel.

### `RequireEngagement` Auth Gate

`RequireEngagement` is a React component wrapping all gated portal routes. On every page navigation it calls `GET /api/portal/onboarding/wizard-status` and follows this decision tree:

```
hasActiveEngagement = true  →  render portal page (gate lifted)
wizardResultsReady = true   →  redirect to /portal/onboarding/results
needsOnboarding = true      →  redirect to /portal/onboarding/wizard
otherwise                   →  redirect to /portal/diagnostic
```

Network/parse errors fail closed (treated as `needsOnboarding: true`) so a client is never silently unblocked by an API outage.

**Routes exempt from `RequireEngagement`** (inside `RequireAuth` only):
- `/portal/onboarding/wizard` — wizard itself
- `/portal/onboarding/results` — Quick Win results
- `/portal/automation-setup` — App Registration management (can update credentials post-onboarding)
- `/portal/diagnostic` and `/portal/diagnostic/:projectId` — live diagnostic viewer

**Public routes** (no auth required):
- `/shared-results/:token` — shareable diagnostic results
- `/portal/presentation/:id` — SOW/proposal viewer (token-based access)
- `/portal/onboarding/select`, `/portal/onboarding/contract`, `/portal/onboarding/success` — purchase funnel
- `/reset-password` — password reset form
- `/portal/diagnostic-sim` — diagnostic simulation preview

---

## 2. Client Account Lifecycle

### Path A — Guest Purchase (New Client)

```
1.  Client completes Stripe Checkout on the public site
2.  Stripe fires checkout.session.completed webhook
3.  Server calls ensureClientAccount(email, name)
        → INSERT INTO users ... ON CONFLICT DO UPDATE (no-op)
        → Returns { id } of existing or newly created user
4.  Server calls ensureClientSetupToken(userId)
        → PostgreSQL advisory lock (namespace 43083 + userId) prevents duplicate emails
        → Inserts row in account_setup_tokens (72h TTL, usedAt=NULL)
        → Returns { token, isNew }
5.  If isNew=true → sends "account-setup" email with link:
        /portal/onboarding/success?setup_token=<token>
6.  Client clicks email link → OnboardingSuccess page
        → User enters their chosen password
        → Calls POST /api/auth/setup-password { token, password }
        → Token is marked usedAt=now, password hash saved, access+refresh tokens issued
        → Client is now authenticated
7.  Client is redirected to onboarding wizard → RequireEngagement sees needsOnboarding=true
```

### Path B — Returning Client (Existing Account)

```
1.  Client purchases an additional service
2.  Stripe webhook fires → ensureClientAccount returns existing user id
3.  Server checks buyer.passwordHash:
        → passwordHash IS set (client already set a password)
        → sends "onboarding-confirmation" email (no setup link)
4.  Client logs in at /crm/ with existing credentials
5.  RequireEngagement sees hasActiveEngagement=true → portal renders
```

> **Branching condition is `buyer.passwordHash`**, not `ensureClientSetupToken.isNew`. The switch between "account-setup" and "onboarding-confirmation" emails is determined solely by whether the user record already has a password hash. `ensureClientSetupToken` is only called in the new-client path (no password) and its `isNew` flag controls only whether to re-send the setup email within an active 72h window.

### Key Database Tables

| Table | Purpose |
|-------|---------|
| `users` | User accounts; `role` = "admin" or "client"; `linkedLeadId` FK to CRM lead |
| `account_setup_tokens` | 72h one-time tokens for first-password setup |
| `password_reset_tokens` | 1h tokens for forgot-password resets |
| `impersonation_tokens` | 30-min single-use admin impersonation tokens |

### CRM Lead Wiring

When a client account is provisioned, `ensureLeadForClient(userId, email, name, company)` is called:
1. Checks `users.linkedLeadId` — returns early if already wired
2. Upserts a row in `leads` with `source="purchase"`, `status="converted"`, `stage="Lead"`
3. Updates `users.linkedLeadId` to point at the lead

---

## 3. Client Authentication Flow

### Login Flow

```
POST /api/auth/login  { email, password }

Rate limit: 10 attempts per 15 min (prod), 200 per 15 min (dev)

1. Look up user by email (case-insensitive)
2. If user.passwordHash is null → 401 "No password set — check your email for a setup link"
3. bcrypt.compare(password, user.passwordHash)
4. Check mfa_enrollments and webauthn_credentials for active enrollments
   → If any found: return { mfaRequired: true, mfaToken, methods[] }   (10-min signed JWT)
   → If none found: issue access + refresh tokens and return { accessToken, refreshToken, user }
```

### MFA Methods

| Method | Available to | Notes |
|--------|-------------|-------|
| TOTP (authenticator app) | Clients + Admins | Standard RFC 6238 |
| SMS OTP | **Clients only** | Not available for admin accounts |
| Passkey / WebAuthn | Clients + Admins | Stored in `webauthn_credentials` |

When MFA is required, the client receives a temporary `mfaToken` (10-min TTL) and must complete a second factor before receiving their real access token.

### JWT Dual-Token Architecture

| Token | TTL | Storage | Contents |
|-------|-----|---------|---------|
| Access token | **8 hours** | React state (in-memory) + `Authorization: Bearer` header | Full user payload (id, email, name, company, role) |
| Refresh token | **30 days** | HttpOnly cookie (`refreshToken`, path `/api/auth`) | `{ id }` only |

The `AuthContext.tsx` in the frontend:
- On mount, calls `POST /api/auth/refresh` using the cookie to silently restore session
- Proactively refreshes the access token **5 minutes before expiry** using a `setTimeout`
- All API calls go through `fetchWithAuth()` which retries automatically with a fresh token on a 401 response
- Mobile clients (Shane Admin App) also receive `refreshToken` in the response body because they cannot use cookies

### Impersonation

Admins can generate a single-use `impersonation_token` (30-min TTL) for any client. The client URL contains `?impersonation_token=<token>`. On load, `AuthContext` detects the query parameter, calls `POST /api/auth/impersonate-exchange`, and establishes a short 30-min session where `user.impersonatedBy` is set to the admin's ID.

### Forgot Password Flow

```
POST /api/auth/forgot-password  { email }
→ Always returns 200 immediately (prevents email enumeration)

If user found and has NO password yet (purchase path):
    → Generate new account_setup_token (72h)
    → Send "account-setup" email with /portal/onboarding/success?setup_token=<token>

If user found and HAS a password:
    → Generate password_reset_token (1h)
    → Send "password-reset" email with /crm/reset-password?token=<token>

If user not found: silently ignore
```

### Session Management

- `POST /api/auth/logout` — clears the `refreshToken` cookie; client clears in-memory state
- Admin at `/admin-panel/` uses the **same JWT backend** (`/api/auth/login`, `/api/auth/refresh`, HttpOnly cookie) as clients. The only admin-specific `sessionStorage` usage is `adminReturnTo` — the redirect path to restore after login — not credentials or passwords

---

## 4. Onboarding Wizard

**Component:** `artifacts/crm/src/pages/portal/OnboardingWizard.tsx`
**Route:** `/portal/onboarding/wizard`
**Re-run mode:** `/portal/m365-wizard` (update mode, skips intro, accessible post-onboarding via Automation Setup)

The wizard gates the full portal — until completion, `RequireEngagement` redirects here for all portal URLs.

### Step 1 — Azure App Registration Setup

**Purpose:** Connect the client's Microsoft 365 tenant so automation scripts can run.

**Data collected:**
| Field | Azure Name | Where to find it |
|-------|-----------|-----------------|
| `tenantId` | Directory (tenant) ID | Azure Portal → Entra ID → Overview |
| `azureClientId` | Application (client) ID | App Registration → Overview |
| `clientSecret` | Client secret value | App Registration → Certificates & secrets → New secret |

**Required App Registration permissions (Application type, not Delegated):**
- `Directory.Read.All`
- `SecurityEvents.Read.All`
- `Exchange.ManageAsApp`
- `Sites.Read.All`
- `Reports.Read.All`
- `Policy.Read.All`
- `DeviceManagementConfiguration.Read.All`
- (additional permissions shown in `artifacts/crm/src/lib/requiredPermissions.ts`)

**Submission flow:**
1. Client submits credentials → `PUT /api/portal/app-registration`
2. Server calls `testClientCredentials()` — attempts a real Graph API call to verify
3. If valid: Client Secret is stored in **Azure Key Vault** as `client-{userId}-app-secret`; only `tenantId`, `azureClientId`, and `keyVaultSecretName` are stored in the `client_app_registrations` DB table
4. If invalid: 400 error returned; credentials are never persisted

### Step 2 — Quick Win Diagnostic

**Purpose:** Run an automated Security Baseline Diagnostic against the connected tenant.

Two execution paths:
| Path | Trigger | Description |
|------|---------|-------------|
| **Automated** | App Registration credentials valid + permissions granted | `useQuickWinRealImpl` fetches real scores from `/api/portal/quick-win/scorecard`; plays them through a timed animation sequence |
| **Manual fallback** | Permissions insufficient or automation unavailable | `WizardManualScripts` UI: client downloads a PowerShell `.ps1` file, runs it locally, uploads result JSON |

### Step 3 — Review Results

**Displays:**
- Overall M365 Score (0–100)
- Five category breakdown scores (see §5 for score computation)
- "Next Best Action" recommendation
- Prompt to proceed to the portal dashboard

### Wizard Completion

The wizard has two separate completion endpoints that set user-level timestamp flags:

| Action | Endpoint | Flag set |
|--------|---------|---------|
| Wizard steps complete (App Reg + credentials) | `POST /api/portal/onboarding/complete` | `users.onboardingWizardCompletedAt = now` |
| Quick Win diagnostic complete | `POST /api/portal/onboarding/quick-win-complete` | `users.quickWinCompletedAt = now` |

After `onboardingWizardCompletedAt` is set, `GET /api/portal/onboarding/wizard-status` returns `needsOnboarding: false`. After `quickWinCompletedAt` is set and no active quick-win project remains, it returns `wizardResultsReady: true`. Once the client has an active project or service, `hasActiveEngagement: true` is returned and the full portal unlocks.

---

## 5. Quick Win Diagnostic Flow

### Entry Points

| Route | Description |
|-------|------------|
| `/portal/diagnostic` | Auto-resolves to client's `quick_win` project |
| `/portal/diagnostic/:projectId` | Specific project diagnostic |
| `/portal/onboarding/wizard` (Step 2) | Wizard-embedded diagnostic |
| `/portal/diagnostic-sim` | Public simulation preview (no auth, no real data) |

### Orbital Command Sphere Animation

The `OrbitalCommandSphere.tsx` component provides the visual centerpiece:
- **Central sphere:** Translucent wireframe globe with custom Three.js shaders cycling through brand colors (`#0078D4` Blue → `#A67BFF` Purple → `#00B4D8` Teal)
- **Three orbital rings:** Concentric rings representing Security, Productivity, and Governance data layers
- **Racing particles:** 20 particles per ring pulsing to simulate active data processing
- **Equatorial scan pulse:** Horizontal laser sweep rotating every 8 seconds
- **Star field:** 2,000 twinkling background particles

The animation plays while the background API calls resolve — it is a UX layer only; the actual scan is a server-side data fetch.

### Scan Execution

```
1. useQuickWinRealImpl binds to project via BIND_PROJECT action
2. GET /api/portal/quick-win/scorecard → returns M365 health scores per category
3. Score data is "played" through timed sequence (category by category with artificial telemetry lines)
4. Categories processed: Security → Compliance → Governance → Copilot AI → Adoption
5. On completion → overall score derived from category average
```

### 5-Category Health Scorecard

Scores are computed from boolean M365 configuration flags using `m365BoolScore()` (counts `true` flags ÷ total flags × 100).

**Category label → DB/API score key mapping** (defined in `useQuickWinRealImpl.ts` as `CATEGORY_TO_SCORE_KEY`):

| Display label | Score key (DB/API) | Contributing Signals |
|--------------|-------------------|---------------------|
| **Security** | `security` | MFA enforced, Conditional Access enabled, Intune enrolled, AAD P1/P2, Defender, DLP, Compliance Center, Sensitivity Labels, Retention Policies |
| **Compliance** | `compliance` | DLP, Purview/Compliance Center, Sensitivity Labels, Retention Policies, Insider Risk |
| **Copilot AI** | `copilot` | Copilot licenses, MFA enforced (prerequisite), Sensitivity Labels (prerequisite), DLP, Retention Policies |
| **Governance** | `governance` | Retention Policies, Sensitivity Labels, External Sharing controls |
| **Adoption** | `productivity` | Active user percentage (`activeUserPercent`), all users licensed |

> **Important:** The display label "Adoption" maps to score key `productivity` in the API response, DB columns, and health history records. Use `productivity` in any code, query, or API integration; use "Adoption" only in client-facing copy.

**Health score thresholds:**
| Score | Status | Color |
|-------|--------|-------|
| ≥ 70 | Healthy | Green (`#22c55e`) |
| 40–69 | Attention | Amber (`#f59e0b`) |
| < 40 | Critical | Red (`#ef4444`) |

### Data Storage

| Table | What is stored |
|-------|---------------|
| `client_health_history` | Time-series health score records per category per client |
| `client_m365_profiles` | Full M365 configuration profile (the boolean flags) |
| `projects` | Quick Win project record (`projectType: "quick_win"`) |

### Events Emitted

| Event | Trigger | Consumer |
|-------|---------|---------|
| `m365.health_check_complete` | Diagnostic completes successfully | Workflow engine — may trigger follow-up automations |
| `m365.diagnostic_failed` | Scan errors out | Workflow engine — may trigger Shane notification |
| `BIND_PROJECT` | Project ID resolved | `QuickWinModeContext` — starts animation |
| `SET_SCORE` | Each category finishes | `QuickWinModeContext` — updates score ring |
| `COMPLETE_STEP` | All categories done | `QuickWinModeContext` — triggers summary view |

### Quick Win Escalation

When a client clicks "Start Full Engagement" after viewing results:
```
POST /api/portal/quick-win/escalate
→ Creates a new full engagement project linked to the quick_win project
→ Client is redirected to the new project detail page
→ RequireEngagement now sees hasActiveEngagement=true
```

---

## 6. Presentation and SOW Viewer

**Component:** `artifacts/crm/src/pages/portal/PortalPresentation.tsx`
**Route:** `/portal/presentation/:id`
**Auth:** Accessible without login if client holds a share token; also accessible to authenticated clients

The presentation is the key conversion step between lead and paid client. Shane generates and sends a presentation/SOW from the Admin Panel; clients interact with it here.

### Step Flow

Steps are built dynamically by `buildSteps()` in `PresentationFlow.tsx`:

```
welcome → doc(s) → sow → [phase_gen] → payment → contract → checkout → confirmation
```

| Step kind | Label | Description |
|-----------|-------|-------------|
| `welcome` | Overview | Intro to the proposal |
| `doc` | Document title | Any attached supporting documents (one step per doc) |
| `sow` | Scope & Pricing | Phase toggles + live price recalculation |
| `phase_gen` | Building Plan | Transient AI regeneration step (only inserted if scope was changed) |
| `payment` | Payment Options | Plan selection + Pay-Today offer |
| `contract` | Agreement | SOW agreement text + e-signature |
| `checkout` | Complete Payment | Stripe Checkout redirect |
| `confirmation` | Confirmed | Post-payment success screen |

> **`readOnly` mode:** When `readOnly=true` (public share token access), steps `phase_gen`, `payment`, `contract`, `checkout`, and `confirmation` are omitted from the step list. The viewer can only browse the proposal.

### Presentation Status State Machine

| Status | Meaning | Initial landing step |
|--------|---------|---------------------|
| `"draft"` | Proposal open, not yet signed or paid | `welcome` (step 0) |
| `"signed"` | Agreement signed; payment not yet completed | `checkout` (retry Stripe) |
| `"paid"` | Payment confirmed | `confirmation` |

### Step Navigation Gates

The step sequence enforces two gates:

**Gate 1 — Agreement (`contract`) requires a plan:**
If the URL deep-links to `contract` and no payment plan is selected AND the agreement is not already signed (`signedAt` is null), the router redirects to the `payment` step.

**Gate 2 — Checkout (`checkout`) requires a signed agreement:**
If the URL deep-links to `checkout` and `signedAt` is null, the router redirects to `contract` (or `payment` if no plan chosen either).

In other words: **plan selection → sign agreement → Stripe checkout**.

### `sow` Step — Scope & Pricing

**Visible data:**
- List of workstream phases with names, descriptions, and individual prices
- "Workstream Subtotal" (sum of selected phases)
- "Price Adjustments" (manual line items for complexity/travel/sprawl)
- "Grand Total"

**Client actions:**
- Toggle individual phases on/off
- Price recalculates in real-time via `deriveEffectiveSowData()`

**Admin-visible side-effects:**
- When client reduces scope → `sow.scope_reduced` event emitted
- If AI phase generation is configured → `phase_gen` step is inserted and an SSE stream regenerates project plan tasks to match the selected scope
- Phase generation state is broadcast via `broadcastPresentationScopeChange()` and replayed for late-connecting admin tabs via `replayPhaseGenState()`

### `payment` Step — Payment Options

See §7 for Pay-Today discount details.

**Payment plan options:**

| Plan | Description | Stripe behavior |
|------|-------------|----------------|
| **Pay in Full** | Charge full SOW total upfront | Standard `payment_intent_data` |
| **20% Deposit + Phased** | Charge 20% immediately; remainder charged per phase completion | `setup_future_usage: "off_session"` — stores payment method for future auto-charges |

### `contract` Step — Agreement

**Visible data:**
- Scoped Statement of Work (dynamic legal agreement reflecting selected phases)
- Full pricing table
- Signature canvas (`react-signature-canvas`)

**Client actions:**
- Draw electronic signature
- Submit signed agreement → `signedAt` recorded, `status` set to `"signed"`, router advances to `checkout`

### `checkout` Step — Complete Payment

Stripe Checkout opens in the same tab. On success, Stripe redirects back with `?payment=success`. The frontend detects this query parameter and advances to the `confirmation` step.

### `confirmation` Step

Shows project details, the assigned project ID, and links to the client portal dashboard.

---

## 7. Pay-Today Discount and Payment Plans

### Offer Eligibility Window

```
GET /api/portal/presentations/:id/offer

→ Records firstVisitedAt on the presentation if not already set
→ Offer window = firstVisitedAt + 72 hours
→ Returns OfferState:
    {
      active: boolean,           // false when window expired or no PAY-TODAY coupon found
      expiresAt: string | null,  // ISO timestamp of when the 72h window closes
      savingsAmount: number,     // discount amount in dollars (e.g. 150.00)
      discountedTotal: number,   // final price after discount in dollars
      originalTotal: number,     // pre-discount total in dollars
      variant: "adjustments_waived" | "percentage_off" | null,
      discountPct?: number       // only present when variant="percentage_off"
    }
```

**`firstVisitedAt` anchoring:** The offer endpoint sets `firstVisitedAt` on the presentation record if it is not already set, at the time of the first `GET /api/portal/presentations/:id/offer` call. This may be triggered by the owner/admin previewing the payment step as well as the client, so the clock starts on first fetch of the offer route, not strictly on the client's first view.

> **Note on units:** All three monetary fields (`savingsAmount`, `discountedTotal`, `originalTotal`) are returned in **dollars** by the offer API endpoint (computed as `cents / 100`). Stripe's `amount_off` coupon parameter is in **cents** — the checkout handler multiplies back up from the dollar-based arithmetic.

### PAY-TODAY Coupon Configuration

The discount amount is driven by a row in the `coupons` database table:

| Column | Value |
|--------|-------|
| `code` | `PAY-TODAY` |
| `discountValue` | Percentage (e.g., `10` = 10%) or absolute amount |
| `discountType` | `"percentage"` or `"adjustments_waived"` |

**To change the discount amount:** Update the `coupons` table via the Admin Panel → no code change or Stripe Dashboard action required.

### Discount Variants

| Variant | Behavior |
|---------|---------|
| `adjustments_waived` | All manual price adjustment line items are removed from the total |
| `percentage_off` | `discountValue`% is deducted from the grand total |

### PAY-TODAY Banner (`PayTodayBanner.tsx`)

- Renders only when `offer.active === true` and a positive `remaining` countdown exists
- Displays countdown in `HH:MM:SS` format (derived from `offer.expiresAt`)
- Discount label: `"adjustments waived"` when `variant="adjustments_waived"`; `"X% off"` when `variant="percentage_off"` (uses `offer.discountPct`)
- Banner disappears automatically when `expiresAt` passes (countdown hits 0) or `active` becomes `false`

### Stripe Coupon Creation at Checkout

To prevent displayed-vs-charged discrepancy:
1. Server computes discount amount in **integer cents** (same arithmetic as the offer endpoint)
2. Calls `stripe.coupons.create({ amount_off: <cents>, currency: "usd", ... })` — creates a one-time Stripe coupon
3. Applies coupon to the Checkout Session → discount appears as a named line item in Stripe's reporting

---

## 8. Post-Payment Project Provisioning

### Trigger

`checkout.session.completed` Stripe webhook → `processStripeEvent()` → dispatches based on `metadata.type`:

| `metadata.type` | Handler |
|----------------|---------|
| `onboarding_purchase` | Full `provisionOnboardingProject()` flow (§8 below) |
| `presentation_checkout` | Mark presentation as paid; emit `agreement_signed` event |
| `service_purchase` | Create invoice; notify admin; no new project workspace |

### Idempotency

The Stripe session ID is used as an idempotency key. If the webhook fires twice (Stripe retries), the second call finds the already-created project/invoice records and exits early without duplicating anything.

### `provisionOnboardingProject()` — What Gets Created

```
Input: { stripeSessionId, clientUserId, services[], amount }

1. Create projects record
   - clientUserId, name derived from purchased service
   - status: "active", projectType: "engagement"
   - progress: 0

2. If client has a SharePoint site configured:
   - createProjectFolder(tenantId, clientId, projectName)  [Graph API]
   - Store SharePoint folder URL on the project record

3. For each purchased service:
   a. Create client_services record (links user → service)
   b. Look up workflow_template for this service
      - If found: seed workflow_steps from template
      - If not found: use getDefaultSteps(serviceCategory) fallback
   c. Seed kanban_tasks for the FIRST workflow step only
      - Resolve task metadata (instructions, checklists, artifacts) from asset library tables
      - Set checklistState = {}, uploadedArtifacts = []
   d. Create invoices record (status: "paid", stripePaymentIntentId)

4. Notifications:
   - Admin in-app notification (notificationsTable)
   - Web push to admin browsers (sendWebPushToAdmins)
   - SMS to Shane (sendAdminSms via Twilio)
   - Admin email alert (adminPurchaseAlertEmail via Resend)
   - Client in-app notification ("Project Ready")
   - Client portal welcome message from "Shane" in messages thread
   - Client email (onboarding-confirmation email via Resend)

5. If client is new (no prior password):
   - ensureClientSetupToken() → account-setup email sent

6. Events emitted:
   - agreement_signed workflow event → triggers downstream automations
     (AI document generation, additional notifications)
```

### Template Metadata Resolution

Kanban tasks are seeded with fully-resolved metadata:

| Metadata field | Source |
|---------------|--------|
| `instructions` | `instruction_sets` table (FK `instructionSetId`) or inline array |
| `checklist` | `checklists` table (FK `checklistId`) or inline array |
| `artifactsProduced` | `artifact_sets` table (FK `artifactsId`) or inline array |
| `clientDeliverables` | `deliverable_sets` table (FK `deliverablesId`) or inline array |
| `linkedRunbook` | `script_modules` or `powershell_scripts` table (FK `runbookId` — must be UUID) |
| `customerDownload` | `powershell_scripts` table (FK `customerDownloadScriptId`) |
| `documentGeneration` | `taskMetadata.documentGeneration` field on template task |

---

## 9. Client Portal Dashboard

**Component:** `artifacts/crm/src/pages/portal/ClientProjectDashboard.tsx`
**Route:** `/portal` (exact match)

### Visible Data

| Widget | Description |
|--------|------------|
| **M365 Environment Health Scorecard** | 5-category radar chart + overall ring. Shows latest score and delta from baseline. Color-coded by threshold (green/amber/red). If no scan data: shows "Mission Status" baseline checklist |
| **Active Projects** | Cards per active project: name, phase, progress bar, target date, current task |
| **Automation Activity Banner** | `PortalActivityBanner` — live updates on running AI workflows or background scripts |
| **Alerts** | Overdue invoices, due invoices, unread message count |
| **Unread Messages Badge** | Red dot on sidebar Messages item if unread messages exist |

### Health Widget (Sidebar)

The `OverallHealthWidget` in the sidebar (`PortalLayout.tsx`) shows:
- Overall score as a mini ring chart (44×44 px SVG)
- Status label (Healthy / Attention / Critical)
- Baseline score → current score → delta indicator
- Clickable → navigates to `/portal/health`

Data source: `GET /api/portal/health/summary`

---

## 10. Projects Section

### Project List — `/portal/projects`

**Component:** `PortalProjects.tsx`

Organizes work into two tracks:

| Track | Description |
|-------|------------|
| **Track 01: Project Engagements** | Time-boxed fixed-scope projects with a `SegmentedStepBar` showing phases |
| **Track 02: Retainer Advisory** | Ongoing advisory retainers highlighting "Priority Access" and active SLAs |

**Visible data per project:**
- Project name and status
- Completion percentage (calculated from completed kanban tasks / total tasks)
- Current phase name
- Target completion date
- Sign-Off Card when project is completed (client formally accepts deliverables)

### Project Detail — `/portal/projects/:id`

**Component:** `PortalProjectDetail.tsx`

#### Kanban Board

Tasks organized into columns:

| Column | Description |
|--------|------------|
| **Backlog** | Upcoming tasks not yet started |
| **In Progress** | Tasks currently being worked |
| **Waiting on Customer** | Tasks blocked on client action/input |
| **Review** | Tasks awaiting client review |
| **Done** | Completed tasks |

**Task card features:**
- Task title, description, assigned phase
- Instructions list (admin-authored, visible to client)
- Checklist items with completion state
- **Script download button** — if task has `customerDownload`, client can download a PowerShell script
- **Q&A thread** — resolved threads collapse to a summary view; active threads shown expanded
- Artifact deliverables list

#### Undo Banner

When a task is moved to Done, a timed undo banner appears with a progress-bar countdown. Client can revert the move during the countdown window.

#### SSE Real-Time Sync

The client kanban subscribes to `GET /api/portal/projects/:id/kanban-events?token=<jwt>` (Server-Sent Events). The JWT is passed as a query parameter because the browser's `EventSource` API cannot send custom headers. Any task change made by the admin side instantly propagates to the client's board.

### Project Archive — `/portal/archive`

Conditionally shown in sidebar navigation when the client has archived projects. Lists completed/closed projects with their final deliverables.

---

## 11. Services Section

**Component:** `PortalServices.tsx`
**Route:** `/portal/services`

### Visible Data

| Element | Description |
|---------|------------|
| **Available Packages** | Consulting packages the client can purchase (links to public site `/services/`) |
| **Active Services** | Currently engaged services with progress display |
| **Service → Project Link** | Each active service links to its associated project detail page |

### Service Status Flow

```
client_services.status transitions:
  "pending"   → service purchased, not yet activated
  "active"    → Shane has marked it active (Admin Panel action)
  "completed" → all workflow steps finished
  "paused"    → retainer paused
  "cancelled" → service cancelled
```

---

## 12. Billing Section

**Component:** `PortalBilling.tsx`
**Route:** `/portal/billing`

### Invoices

- Full invoice history list with status badges: **Paid**, **Due**, **Overdue**
- **Running total** shown for active subscriptions (e.g., retainers)
- **Pay** button on unpaid invoices → creates a new Stripe Checkout Session
- **Paginated receipts** — "Download Receipt" links to Stripe-generated PDF receipts
- **SharePoint invoice link** — if uploaded, links to invoice PDF in the client's SharePoint folder

### Invoice Detail — `/portal/billing/invoices/:id`

**Component:** `PortalInvoiceDetail.tsx`

Shows line items, dates, payment method last 4, and direct Stripe receipt URL.

### Contracts

- List of signed SOWs and agreements
- **View Agreement** — renders the agreement text inline
- Status: Signed / Pending Signature

### Contract Detail — `/portal/billing/contracts/:id`

**Component:** `PortalContractDetail.tsx`

Full agreement text display with signing metadata (date, IP, signature image if stored).

### Address & Profile Management

Client can update billing address (street, city, state, ZIP) via `PATCH /api/portal/profile`. Saved address is applied to the Stripe Customer record for pre-filling checkout forms.

---

## 13. Messaging Section

**Component:** `PortalMessages.tsx`
**Route:** `/portal/messages`

### Visible Data

- Threaded message history between client and Shane
- Sender identity (client name / "Shane McCaw Consulting")
- Timestamps
- Read status indicator

### Message Model

The portal implements a flat, append-only conversation stream between the client and Shane. Messages are stored in the `messages` table with `readByAdmin` and `readByClient` flags.

**Exposed API endpoints (client-facing):**

| Method | Endpoint | Purpose |
|--------|---------|---------|
| `GET` | `/api/portal/messages` | Fetch full message history for the authenticated client |
| `POST` | `/api/portal/messages` | Send a new message |

> There is no server-side `/resolve` endpoint or `/unread-count` endpoint. Thread-resolution and unread-count features visible in the UI are derived client-side from message state or managed through the full message list response.

### Client Actions

| Action | API call | Admin side-effect |
|--------|---------|------------------|
| Fetch history | `GET /api/portal/messages` | — |
| Send message | `POST /api/portal/messages` | Creates message with `readByAdmin=false`; admin in-app notification created; admin push notification sent; admin SMS if configured |

### Unread Badge

The sidebar Messages item shows a red badge driven by the count of messages where `readByClient=false` in the fetched message list.

### Real-Time Updates

Messages are polled every **10 seconds** (no SSE for messages — polling only). The composer supports Shift+Enter for multi-line messages.

---

## 14. M365 Intelligence Sections

### M365 Profile — `/portal/m365-profile`

**Component:** `PortalM365Profile.tsx`

A technical inventory of the client's tenant configuration. All data originates from the automated diagnostic scan and is stored in `client_m365_profiles.profile` (JSONB).

**Visible data:**
- License tier and seat counts
- MFA status, Conditional Access policies
- Active user percentage
- SharePoint usage, Teams adoption
- Defender and Intune enrollment status
- DLP, Sensitivity Labels, Retention Policies
- Insider Risk configuration

### Automation Setup — `/portal/automation-setup`

**Component:** `PortalAppRegistration.tsx`

Allows the client to manage their Azure App Registration credentials.

**Actions:**
- View current App Registration status (verified / unverified / expired)
- Re-verify credentials → triggers a fresh `testClientCredentials()` call
- Update Tenant ID, Client ID, or Client Secret
- View permission check results (which Graph permissions are granted)

**Badge:** A `1` badge appears on the sidebar Automation Setup item when the App Registration is pending verification or credentials have expired.

**Note:** This route is **not** wrapped in `RequireEngagement` — clients can access it even if onboarding is incomplete, to fix credential issues.

### Security — `/portal/security`

**Component:** `PortalSecurity.tsx`

Security posture view derived from M365 profile data.

**Visible data:**
- MFA enforcement status
- Conditional Access coverage
- Defender for Endpoint/Identity status
- Security Score (from the Security health category)
- Recommended remediation steps

### Insights — `/portal/insights`

**Component:** `PortalInsights.tsx`

AI-generated benchmark report comparing the client's M365 environment to industry averages.

**Data flow:**
```
Admin triggers insight generation (or automation fires it)
→ AI generates benchmark HTML/PDF
→ Stored in insights_generated_documents table
→ Client views rendered output
```

Insights cover: Security posture vs. industry, Adoption vs. peers, Governance maturity level, Copilot readiness ranking.

### Journey Map — `/portal/journey`

**Component:** `PortalJourneyMap.tsx`

Long-term roadmap visualization showing:
- Completed milestones (past phases, delivered documents)
- Current phase in progress
- Planned future phases
- Projected timeline to key outcomes

### Environment Health — `/portal/health`

**Component:** `PortalHealthScore.tsx`

Time-series heatmap of all 5 domain scores across all recorded health checks.

**Visible data:**
- Per-category score history (line chart or heatmap)
- Overall score trend (first scan baseline → current)
- Delta indicators per category
- Timestamp of each scan

Data source: `client_health_history` table.

### Quick Wins — `/portal/quick-wins`

**Component:** `QuickWinResultsPage.tsx`

Final results view after the Quick Win diagnostic, outside the wizard context. Shows:
- Overall M365 score ring
- 5-category breakdown
- "Quick Win" action items (highest-impact, lowest-effort improvements)
- Option to escalate to a full engagement

---

## 15. Admin CRM Views (Pipeline & Delivery)

These views live in the **Admin Panel** (`/admin-panel/`), not the CRM artifact. Documented here because they are how Shane manages the clients whose portal is described above.

### Pipeline Workspace

#### Lead List

- All captured leads from the public site quiz, contact form, and purchases
- Sortable by score, date, status, source

#### Lead Detail Page

**Visible data:**
| Section | Contents |
|---------|---------|
| **Quiz Data** | Raw answers from the lead magnet / qualification quiz |
| **Lead Score** | Composite 0–100 score with sub-score breakdown (Fit, Pain, Maturity, Intent, Urgency) |
| **Evidence** | Text list of signals that contributed to the score |
| **Next Best Action** | Recommended workflow type (e.g., "Discovery Call", "Proposal Preparation") |
| **Contact Info** | Name, email, company, phone |
| **Activity Timeline** | All events: form submissions, visits, email opens, purchases |

#### Lead Scoring Engine Details

| Sub-score | Max | Signals |
|-----------|-----|---------|
| **Fit** | 25 | Employee count (size bonus), industry match (high-fit list), license tier |
| **Pain** | 30 | Pain point keywords matched against `PAIN_POINT_SCORES` dictionary |
| **Maturity** | 20 | IT team size, tenant age in years, maturity indicator keywords |
| **Intent** | 15 | Lead source (lead_magnet=4pts, contact_form=3pts), engagement signal keywords |
| **Urgency** | 10 | Urgency signal keywords (audit deadline, board mandate, budget approved, etc.) |

**Next Best Action routing:**

| Score | Pain keywords | Next Step |
|-------|-------------|-----------|
| Any | "copilot" or "ai" | Copilot Readiness Assessment |
| ≥ 70 | "compliance" | Compliance Review |
| ≥ 65 | "governance" or "compliance" | Governance Assessment |
| ≥ 75 | (none of above) | Proposal Preparation |
| ≥ 60 | "tenant", "migration", "health" | Tenant Health Audit |
| ≥ 60 | (none of above) | Discovery Call |
| < 60 | (any) | Discovery Call |

#### Opportunity Pipeline

- Deal stage Kanban: Lead → Qualified → Proposal Sent → Negotiation → Closed Won/Lost
- SOW link (opens presentation for admin preview)
- `scoreSnapshot` stored at opportunity creation time

### Delivery Workspace

#### Client Detail Page

**Visible data:**
| Section | Contents |
|---------|---------|
| **Profile** | Name, email, company, phone, address |
| **M365 Signals** | Health score, App Registration status, last scan date |
| **Project List** | All projects with status, progress, current phase |
| **Message History** | Full thread between client and Shane |
| **Billing Summary** | Invoice list, payment status, total revenue |
| **Impersonate** | Button to generate impersonation token → opens portal as the client |

#### Project Detail Page (Admin View)

**Visible data:**
- Phase list (from workflow template steps)
- Admin-side kanban board (synced real-time with client view via SSE)
- Activity log (all state transitions, comments, file uploads)
- SharePoint folder link (opens OneDrive/SharePoint directly)
- PowerShell script runner (trigger Azure Automation runbooks against client tenant)

**Admin actions:**
- Move tasks between columns → broadcasts via `broadcastKanbanChange()` → client sees update instantly
- Add/edit task notes and checklist items
- Mark service as Active
- Trigger phase completion → auto-charges phased payment if payment method stored
- Generate AI documents (SOW, reports) via kanban task auto-fire

#### Admin Kanban Auto-Fire

When a kanban task with a `linkedRunbook` moves to "Done":
1. `autoFireFirstBacklogScript()` or `autoFireDocumentCard()` fires (via `kanban-auto-fire.ts`)
2. Runbook is submitted to Azure Automation against the client's tenant
3. Results stored in `script_run_results`
4. Side-effects (health score update, document generation, etc.) executed in `kanban-auto-fire.ts` — **not** in `processRunInBackground`; any new post-run side-effects must exist in both code paths

---

## 16. Client-Admin Data Flows and Sync

### Kanban Task Sync

```
Admin moves task (Admin Panel kanban)
  → PATCH /api/admin/projects/:id/tasks/:taskId
  → broadcastKanbanChange(projectId, change)
  → All registered SSE clients for that projectId receive the event
  → Client kanban re-renders with new task position

Client moves task (portal kanban)
  → PATCH /api/portal/projects/:id/tasks/:taskId
  → Same broadcastKanbanChange broadcast
  → Admin kanban re-renders
```

### Message Threading

```
Client sends message → POST /api/portal/messages
  → messagesTable insert (readByAdmin=false, readByClient=true)
  → Admin notification created
  → Admin web push sent

Admin replies → POST /api/admin/messages
  → messagesTable insert (readByAdmin=true, readByClient=false)
  → Client notification created
  → Client push notification sent (if mobile token registered)

Client views messages → GET /api/portal/messages
  → returns full message list; client-side code identifies unread items
    by readByClient=false; no dedicated per-message read-mark endpoint exists

Admin reads message → readByAdmin flag updated server-side
  → Admin unread badge recalculates on next poll
```

### Invoice Status Propagation

```
Stripe checkout.session.completed webhook
  → invoices record created with status="paid"
  → visible immediately in client billing section

Admin manually creates invoice
  → invoices record with status="pending"
  → client sees "Due" badge

Admin marks invoice paid
  → invoices.status = "paid"
  → client billing updates on next poll
```

### Contract Signing State

```
Client signs on PortalPresentation
  → contracts record updated with signedAt, signatureData
  → presentation status = "signed"
  → RequireEngagement re-evaluates (hasActiveEngagement may become true)
  → agreement_signed workflow event fires → downstream automations
```

### Progress Percentage Calculation

```
progress = (completed kanban tasks / total kanban tasks for project) × 100

Computed in: syncProjectProgress() in kanban-phase-advance.ts
Stored in: projects.progress (integer 0–100)
Displayed in: portal dashboard project card, admin project detail
```

### Phase Completion and Auto-Charge

```
Admin marks all tasks in a phase as done
  → advancePhaseIfComplete() evaluates phase completion
  → If phased payment plan: Stripe off-session charge fires for the phase amount
    (uses stored payment method from initial 20% deposit)
  → project.phase_changed event emitted
  → Notifications sent to client and admin
  → Next phase's kanban tasks seeded from template
```

---

## 17. Secrets and External Integrations

### Stripe

| Secret | Purpose | Environment |
|--------|---------|------------|
| `STRIPE_SECRET_KEY` | Stripe API — test payments | Dev only (`sk_test_…`) |
| `STRIPE_SECRET_KEY_PROD` | Stripe API — live payments | Production only (`sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification | Dev endpoint (`*.replit.dev`) |
| `STRIPE_WEBHOOK_SECRET_PROD` | Webhook signature verification | Prod endpoint (custom domain) |

**Environment detection:** `getStripeKey()` checks `REPLIT_DOMAINS` — if any domain does NOT end with `.replit.dev`, production mode is assumed and `STRIPE_SECRET_KEY_PROD` is required.

**Webhook endpoint:** `POST /api/portal/stripe/webhook`
**Required event:** `checkout.session.completed`

**Post-deploy steps:**
```bash
# Check/create webhook endpoints
pnpm --filter @workspace/scripts run sync-webhooks -- --fix

# Apply DB migrations to production
pnpm --filter @workspace/scripts run migrate-prod
```

### Microsoft Graph API

| Secret | Purpose |
|--------|---------|
| `GRAPH_CLIENT_ID` | App Registration client ID for server-side Graph API calls |
| `GRAPH_CLIENT_SECRET` | App Registration client secret |
| `GRAPH_TENANT_ID` | Azure AD tenant ID |
| `GRAPH_MAIL_USER_ID` | Mailbox UPN/ID used for sending emails via Graph |
| `SHAREPOINT_OWNER_UPN` | Shane's UPN — added as group owner to every new client SharePoint site |

**Used for:**
- `createProjectFolder()` — creates a SharePoint folder in the client's site
- `uploadFileToClientContracts()` — uploads signed contracts to SharePoint
- Calendar reading on the `/book` page (`Calendars.Read` and `Calendars.ReadWrite` App permissions required)

If Graph credentials are absent, SharePoint provisioning is silently skipped (warning logged, no error thrown).

### Azure Key Vault

| Secret | Purpose |
|--------|---------|
| `AZURE_CLIENT_ID` | Service principal for Key Vault access |
| `AZURE_CLIENT_SECRET` | Service principal client secret |
| `AZURE_TENANT_ID` | Azure AD tenant for the service principal |
| `AZURE_KEY_VAULT_URL` | Full vault URL (`https://my-vault.vault.azure.net`) |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription (for Automation account) |
| `AZURE_AUTOMATION_RESOURCE_GROUP` | Resource group containing the Automation account |
| `AZURE_AUTOMATION_ACCOUNT_NAME` | Azure Automation account name |

**Purpose:** Client App Registration secrets (`client-{userId}-app-secret`) are stored here, never in the primary database. Retrieved at automation run time via `getSecretValue()`.

**Required RBAC:** Service principal needs **Key Vault Secrets User** on the vault, **Automation Operator** on the Automation account.

### Twilio SMS

| Secret | Purpose |
|--------|---------|
| `TWILIO_ACCOUNT_SID` | Twilio account identifier |
| `TWILIO_AUTH_TOKEN` | Twilio auth credential |
| `TWILIO_FROM_NUMBER` | Sending number in E.164 (e.g., `+12025551234`) |
| `SHANE_PHONE_NUMBER` | Destination number in E.164 |

**When SMS fires:**
- `service_purchase` checkout completed
- `onboarding_purchase` checkout completed

**Graceful degradation:** If any secret is missing, `sendAdminSms()` logs a warning and returns silently — no error thrown.

### Resend Email

Configured via the Replit Resend integration (no manual secret required if using the integration connector).

**Email templates used:**

| Template | Trigger | Recipient |
|----------|---------|----------|
| `account-setup` | New client purchase (no prior account) | Client |
| `onboarding-confirmation` | Returning client purchase | Client |
| `password-reset` | Forgot password (account has password) | Client |
| `admin-purchase-alert` | Any purchase completes | Shane (admin) |
| `closure-request` | Client submits project closure request | Shane |
| `status-report-reply` | Shane replies to a status report | Client |
| `client-thread-reply` | Shane sends a portal message | Client |
| `admin-thread-reply` | Client sends a portal message | Shane |
| `retainer-resumed` | Cancelled retainer is resumed | Client |
| `app-reg-expiry-alert` | App Registration nearing expiry | Client |

### Web Push / Browser Push Notifications

| Secret | Purpose |
|--------|---------|
| `VAPID_PUBLIC_KEY` | VAPID public key (base64url, `BN…` or `BA…`) |
| `VAPID_PRIVATE_KEY` | VAPID private key (base64url) |

**Generate once:**
```bash
node -e "const wp=require('web-push');console.log(wp.generateVAPIDKeys())"
```

**Service worker:** `artifacts/admin-panel/public/sw.js` handles the `push` event and shows OS-level notifications even when the Admin Panel tab is closed.

**Graceful degradation:** If VAPID secrets are absent, `sendWebPushToAdmins()` logs a warning and returns silently.

### Mobile Push Notifications

Device tokens are stored in `device_tokens` table (registered via the Shane Admin App). Push notifications are sent via `sendPushNotifications()` in `artifacts/api-server/src/lib/push.ts`.

---

*Document generated from source code analysis of `artifacts/crm/` and `artifacts/api-server/` as of 2026-07-06. Update this document whenever the portal routing, auth flow, or provisioning logic changes.*
