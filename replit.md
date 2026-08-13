# Shane McCaw Consulting

A professional multi-page consulting website for Shane McCaw — Lead Microsoft 365 Architect at NASA and 30-year Microsoft ecosystem veteran.

## Run & Operate

- `pnpm --filter @workspace/shane-mccaw-consulting run dev` — run the web app (port 20446)
- `pnpm run typecheck` — full typecheck across all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Wouter (routing) + Tailwind CSS v4
- UI: shadcn/ui components + Lucide React icons + react-icons/fa
- Forms: react-hook-form + zod + @hookform/resolvers
- No backend — purely presentational static site

## Where things live

- `artifacts/shane-mccaw-consulting/src/App.tsx` — router with all 15 routes registered
- `artifacts/shane-mccaw-consulting/src/index.css` — theme (Inter font, Deep Navy/Electric Blue palette)
- `artifacts/shane-mccaw-consulting/src/components/` — Header, Footer, Layout, CTAButton, ServiceCard
- `artifacts/shane-mccaw-consulting/src/pages/` — all page files

## Pages

| Route | Component |
|-------|-----------|
| `/` | Home |
| `/about` | About |
| `/services` | Services (parent) |
| `/services/microsoft-365` | Microsoft365 |
| `/services/copilot-ai` | CopilotAI |
| `/services/sharepoint` | SharePoint |
| `/services/power-platform` | PowerPlatform |
| `/services/governance` | Governance |
| `/services/cloud-migration` | CloudMigration |
| `/quick-wins` | MicroOffers |
| `/pricing` | Pricing |
| `/resources` | Resources |
| `/contact` | Contact |
| `/book` | Book |
| `/admin` | Admin (password-protected) |

## Admin Panel

- URL: `/admin`
- Protected by `ADMIN_PASSWORD` secret (set in Replit Secrets)
- Password stored in `sessionStorage` for the browser session — no cookies
- API routes live in `artifacts/api-server/src/routes/admin-articles.ts`
- All `/api/admin/articles` endpoints require `Authorization: Bearer <password>` header
- Reads/writes Markdown files in `artifacts/shane-mccaw-consulting/src/content/articles/`
- Changes appear immediately in the Vite dev server (HMR); in production, a redeploy surfaces new articles to the public site

## Brand Colors

- Deep Navy: `#0A2540` (CSS: `bg-[#0A2540]` or `bg-sidebar`)
- Electric Blue: `#0078D4` (CSS: `text-primary` / `bg-primary`)
- Bright Teal: `#00B4D8`
- Off-White: `#F7F9FC`

## Product

A marketing website for Shane McCaw Consulting positioning Shane as the premier Microsoft 365 and Copilot AI consultant. Includes full service pages, fixed-price micro-offer packages, retainer pricing, resource/blog section, contact form with validation, and a Microsoft Bookings embed for scheduling.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Tenant Signal Enable/Disable

- Admins can toggle any Tenant Signal (regular or `adj:*` adjustment signal) off in the Admin Panel's Tenant Signals page — a toggle switch appears next to each signal in the list, with a "Disabled" badge shown when off.
- State lives in the `signal_enabled_state` table (`signal_key` PK, `enabled` boolean default true). A missing row means enabled — existing signals are unaffected until an admin explicitly toggles one.
- API: `GET /api/admin/signal-rules/enabled-state` (full map) and `PATCH /api/admin/signal-rules/:signalKey/enabled` (toggle one, audit-logged). The signal list endpoints (`/api/admin/engagement-projects/signals`, `/api/admin/signal-rules/adjustment-signals`) also embed `enabled` on each signal object.
- Disabled signals are skipped entirely in `computeTenantSignals` (rules not evaluated, so they can never fire) — this is enforced everywhere signals are computed: admin evaluate/preview/health/dry-run endpoints, and both paths of SOW generation in `consolidated-sow-generator.ts` (DB-eval path and the `signalsOverride` path used by the workflow executor). Disabled adjustment signals therefore never authorize pricing adjustments in `sow-pricing.ts`, since that logic keys off the already-filtered fired-signal set.
- Disabling a signal is not retroactive — already-generated SOW documents keep whatever signals fired at generation time.

## Gotchas

- The booking calendar on `/book` uses `CalendarBooking.tsx` which reads Shane's real Exchange Online calendar via the Microsoft Graph API. To activate: grant the existing service principal (`GRAPH_CLIENT_ID`) two **Application** permissions in Azure AD — `Calendars.Read` and `Calendars.ReadWrite` — then admin-consent them. No new secrets are required; the same `GRAPH_MAIL_USER_ID` mailbox is used. If Graph credentials are absent, the slot list will be empty and a clear placeholder is shown (no crash). `MicrosoftBookingsEmbed.tsx` and `VITE_BOOKINGS_URL` are no longer used by the book page.
- Contact form uses react-hook-form + zod but has no backend submission — shows a toast on success
- Header is transparent on `/` and solid Deep Navy on all other pages (via scroll + location detection)
- **SMS order alerts**: When a Stripe payment completes, the server sends Shane an SMS via Twilio. Requires four secrets in Replit Secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (both from console.twilio.com), `TWILIO_FROM_NUMBER` (your Twilio number in E.164 format, e.g. `+12025551234`), and `SHANE_PHONE_NUMBER` (destination in E.164 format). SMS is silently skipped (with a warning log) if any secret is missing. Helper is at `artifacts/api-server/src/lib/sms.ts`; hooked into `processStripeEvent` in `portal.ts` for both `service_purchase` and `onboarding_purchase` event types.
- **SharePoint owner assignment**: Set `SHAREPOINT_OWNER_UPN` in Replit Secrets to Shane's Microsoft 365 UPN (e.g. `shane@contoso.com`) or Azure AD object ID (found in the M365 admin centre under Users → Shane's profile). When set, every newly-provisioned client SharePoint site automatically adds Shane as a group owner, giving him full access from SharePoint and Teams. If the secret is missing, provisioning continues normally — a warning is logged but no error is thrown.
- **Browser push notifications (background delivery)**: OS-level push alerts require two VAPID secrets in Replit Secrets: `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Generate them once with `npx web-push generate-vapid-keys` (or `node -e "const wp=require('web-push');console.log(wp.generateVAPIDKeys())"`), then paste the `publicKey` value into `VAPID_PUBLIC_KEY` and `privateKey` into `VAPID_PRIVATE_KEY`. Without these secrets, all `sendWebPushToAdmins()` calls are silently skipped and a warning is emitted at server startup. Pushes are delivered by the browser vendor's push service even when the Admin Panel tab is closed, as long as the browser is running. The service worker at `artifacts/admin-panel/public/sw.js` handles the `push` event and shows the OS notification.
- **PAY-TODAY discount offer**: When a client first views a presentation's payment step, the server records `firstVisitedAt` on the presentation and derives a 72-hour offer window. The offer state (savings, discounted total, countdown expiry) is returned by `GET /api/portal/presentations/:id/offer` and rendered in `PaymentOptionsPanel.tsx` + `PayTodayBanner.tsx`. The discount is configured via a row in the internal `coupons` DB table with `code = 'PAY-TODAY'` and `discountValue` set to the desired percentage — create or update it via the Admin Panel (no Stripe Dashboard action needed). At checkout, the server computes the discount amount in cents (same rounding path as the offer endpoint) and creates a one-time Stripe coupon with `amount_off` so the discount appears as a named line item in Stripe's reporting. Both offer display and Stripe charge use the same cents-based arithmetic so there is never a displayed-vs-charged discrepancy. The countdown in `PayTodayBanner.tsx` displays in `HH:MM:SS` format; the percentage label is derived dynamically from `coupon.discountValue`. The Agreement step is locked until payment is confirmed (status `"paid"` or `"signed"`); sidebar indicators and overview cards enforce this gate in addition to the footer.

## Docs

Operational and architectural reference documents live in `/docs/`:

| Document | Purpose |
|----------|---------|
| [`docs/architecture-overview.md`](docs/architecture-overview.md) | Auth model, event bus contract, workflow engine node types, engine registry, tiered data ownership |
| [`docs/architecture.md`](docs/architecture.md) | Full component map, route namespaces, data flows, DB table groups, third-party integrations |
| [`docs/acceptance-checklist.md`](docs/acceptance-checklist.md) | Go-live gate — one verifiable item per completed MSP Portal capability |
| [`docs/runbooks/dlq-replay.md`](docs/runbooks/dlq-replay.md) | Step-by-step procedure to replay failed DLQ entries |
| [`docs/runbooks/workflow-run-remediation.md`](docs/runbooks/workflow-run-remediation.md) | Diagnose and remediate stuck / failed workflow runs |
| [`docs/runbooks/key-vault-credential-rotation.md`](docs/runbooks/key-vault-credential-rotation.md) | Rotate an MSP's Azure Key Vault credentials without downtime |
| [`docs/runbooks/incident-response.md`](docs/runbooks/incident-response.md) | Production incident triage, severity levels, and escalation path |

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

## Stripe Secrets

| Secret | Format | Environment |
|--------|--------|-------------|
| `STRIPE_SECRET_KEY` | `sk_test_…` | **Dev only** — used when `REPLIT_DOMAINS` is absent (local / Replit dev workspace) |
| `STRIPE_SECRET_KEY_PROD` | `sk_live_…` | **Production only** — used when `REPLIT_DOMAINS` is present (deployed app); required for live payments |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | Signing secret for the dev webhook endpoint (`*.replit.dev`) |
| `STRIPE_WEBHOOK_SECRET_PROD` | `whsec_…` | Signing secret for the prod webhook endpoint (e.g. `shanemccaw.com`) |

**Redeploy checklist:** Before going live, ensure `STRIPE_SECRET_KEY_PROD` is set in Replit Secrets. Without it the deployed API will throw on startup and payments will be broken.

**After every deploy, run the migrate-prod pipeline** to apply DDL migrations AND data migrations (including the engagement project signal-key backfill) to the production database:
```
pnpm --filter @workspace/scripts run migrate-prod
```
This is idempotent — safe to run repeatedly. Legacy migration `0012_engagement_project_signal_keys` updates any `engagement_projects.triggered_by` values that still contain legacy plan-name strings to use canonical signal keys, ensuring all projects appear correctly in SOW generation.

**Syncing webhook endpoints:** After every deploy (or if the payment webhook stops firing), run:
```
pnpm --filter @workspace/scripts run sync-webhooks          # check only
pnpm --filter @workspace/scripts run sync-webhooks -- --fix # check + auto-create missing endpoints
```
The script automatically picks `STRIPE_SECRET_KEY` in dev and `STRIPE_SECRET_KEY_PROD` in production based on whether `REPLIT_DOMAINS` is set. It will exit with an error and a clear message if the required key is missing.

## Azure Script Runner Secrets

Required to enable the Script Runner (PowerShell Runbook execution) in the Admin Panel:

| Secret | Description |
|--------|-------------|
| `AZURE_CLIENT_ID` | App Registration (service principal) client ID used to authenticate with Azure Key Vault and Automation |
| `AZURE_CLIENT_SECRET` | App Registration client secret |
| `AZURE_TENANT_ID` | The Azure AD tenant ID for the service principal |
| `AZURE_KEY_VAULT_URL` | Full URL of the Key Vault (e.g. `https://my-vault.vault.azure.net`) — customer credentials are stored here by name, never in the DB |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID containing the Automation account |
| `AZURE_AUTOMATION_RESOURCE_GROUP` | Resource group name containing the Azure Automation account |
| `AZURE_AUTOMATION_ACCOUNT_NAME` | Name of the Azure Automation account |

The service principal needs: **Key Vault Secrets User** and **Key Vault Certificates User** on the vault, and **Automation Operator** on the Automation account.

## Google Search Console Secrets

Required to enable automatic SEO ranking sync in the Admin Panel (Marketing → SEO Rankings → "Sync Search Console"):

| Secret | Description |
|--------|-------------|
| `GOOGLE_SEARCH_CONSOLE_KEY_JSON` | Full contents of the Google service account JSON key file (created in Google Cloud Console → IAM → Service Accounts → create key → JSON). The service account must be granted **Full** permission on the site in Google Search Console. |
| `GOOGLE_SEARCH_CONSOLE_SITE_URL` | Exact site URL as registered in Search Console (e.g. `https://shanemccawconsulting.com/` — include the trailing slash if that's how it's registered). |

If either secret is missing, clicking "Sync Search Console" shows a clear error message in the card without crashing. Manual keyword entry is always available as a fallback.

## Social Media Connector Secrets

Required to enable the `post_linkedin`, `post_twitter`, and `post_facebook` workflow nodes.

### LinkedIn (`post_linkedin`)

| Secret | Description |
|--------|-------------|
| `LINKEDIN_ACCESS_TOKEN` | Long-lived OAuth 2.0 access token for a LinkedIn app with `w_organization_social` scope. Create an app at [LinkedIn Developer Portal](https://developer.linkedin.com/), request the Marketing Developer Platform product, then exchange an auth code for a 60-day token (or set up token refresh). |
| `LINKEDIN_ORG_ID` | Numeric LinkedIn organisation/company ID (found in the URL of the company admin page, e.g. `https://www.linkedin.com/company/12345678/admin/` → `12345678`). Can also be set per-node in the config panel. |

Posts to the UGC Posts API (`POST /v2/ugcPosts`) as an organisation post. Text-only in this iteration. Outputs `{{linkedinPostId}}` and `{{linkedinPostUrl}}`.

### Twitter / X (`post_twitter`)

| Secret | Description |
|--------|-------------|
| `TWITTER_API_KEY` | API key (consumer key) from the Twitter Developer Portal app |
| `TWITTER_API_SECRET` | API key secret (consumer secret) |
| `TWITTER_ACCESS_TOKEN` | Access token for the account/page you want to post as |
| `TWITTER_ACCESS_TOKEN_SECRET` | Access token secret |
| `TWITTER_BEARER_TOKEN` | App-only bearer token (optional; not used for posting but useful for future read operations) |

Create a project and app at [developer.twitter.com](https://developer.twitter.com/), set **Read and Write** permissions, then generate access tokens under "Keys and Tokens". Signing uses OAuth 1.0a HMAC-SHA1 — no external library required. Outputs `{{twitterTweetId}}` and `{{twitterTweetUrl}}`.

### Facebook (`post_facebook`)

| Secret | Description |
|--------|-------------|
| `FACEBOOK_PAGE_ACCESS_TOKEN` | Page access token with `pages_manage_posts` and `publish_pages` permissions. Generate via [Meta for Developers → Graph API Explorer](https://developers.facebook.com/tools/explorer/) selecting your Page, or via a long-lived token exchange. |
| `FACEBOOK_PAGE_ID` | Numeric Facebook Page ID (visible in the Page's About section or via Graph API `me?fields=id`). Can also be set per-node in the config panel. |

Posts to `/{page-id}/feed` on the Facebook Graph API v19. Text-only in this iteration. Outputs `{{facebookPostId}}` and `{{facebookPostUrl}}`.

## Browser Push Notification Secrets

Required to enable OS-level browser push notifications in the Admin Panel notification drawer:

| Secret | Description |
|--------|-------------|
| `VAPID_PUBLIC_KEY` | VAPID public key (base64url, starts with `BN…` or `BA…`) |
| `VAPID_PRIVATE_KEY` | VAPID private key (base64url) |

**One-time key generation** (run locally or in a Replit shell):
```
node -e "const wp = require('web-push'); const keys = wp.generateVAPIDKeys(); console.log(keys);"
```
Or with npx: `npx web-push generate-vapid-keys`

Copy the `publicKey` value into `VAPID_PUBLIC_KEY` and `privateKey` into `VAPID_PRIVATE_KEY` in Replit Secrets. No other configuration is needed. If either secret is missing, push dispatch is silently skipped (with a warning log) and the feature gracefully degrades — the notification bell continues to work normally.
