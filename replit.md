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
| `/micro-offers` | MicroOffers |
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

## Gotchas

- The booking calendar on `/book` uses `CalendarBooking.tsx` which reads Shane's real Exchange Online calendar via the Microsoft Graph API. To activate: grant the existing service principal (`GRAPH_CLIENT_ID`) two **Application** permissions in Azure AD — `Calendars.Read` and `Calendars.ReadWrite` — then admin-consent them. No new secrets are required; the same `GRAPH_MAIL_USER_ID` mailbox is used. If Graph credentials are absent, the slot list will be empty and a clear placeholder is shown (no crash). `MicrosoftBookingsEmbed.tsx` and `VITE_BOOKINGS_URL` are no longer used by the book page.
- Contact form uses react-hook-form + zod but has no backend submission — shows a toast on success
- Header is transparent on `/` and solid Deep Navy on all other pages (via scroll + location detection)
- **SMS order alerts**: When a Stripe payment completes, the server sends Shane an SMS via Twilio. Requires four secrets in Replit Secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (both from console.twilio.com), `TWILIO_FROM_NUMBER` (your Twilio number in E.164 format, e.g. `+12025551234`), and `SHANE_PHONE_NUMBER` (destination in E.164 format). SMS is silently skipped (with a warning log) if any secret is missing. Helper is at `artifacts/api-server/src/lib/sms.ts`; hooked into `processStripeEvent` in `portal.ts` for both `service_purchase` and `onboarding_purchase` event types.
- **SharePoint owner assignment**: Set `SHAREPOINT_OWNER_UPN` in Replit Secrets to Shane's Microsoft 365 UPN (e.g. `shane@contoso.com`) or Azure AD object ID (found in the M365 admin centre under Users → Shane's profile). When set, every newly-provisioned client SharePoint site automatically adds Shane as a group owner, giving him full access from SharePoint and Teams. If the secret is missing, provisioning continues normally — a warning is logged but no error is thrown.

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
