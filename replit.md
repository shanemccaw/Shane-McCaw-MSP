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

- The booking calendar on `/book` and `/contact` uses `MicrosoftBookingsEmbed.tsx`. To activate: set up a Bookings page in the M365 admin portal, then set `VITE_BOOKINGS_URL` in Replit Secrets to the booking page URL (format: `https://outlook.office365.com/book/...`). No code changes needed — the component reads the env var automatically. Until then, a branded placeholder card is shown.
- Contact form uses react-hook-form + zod but has no backend submission — shows a toast on success
- Header is transparent on `/` and solid Deep Navy on all other pages (via scroll + location detection)
- **SMS order alerts**: When a Stripe payment completes, the server sends Shane an SMS via Twilio. Requires four secrets in Replit Secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (both from console.twilio.com), `TWILIO_FROM_NUMBER` (your Twilio number in E.164 format, e.g. `+12025551234`), and `SHANE_PHONE_NUMBER` (destination in E.164 format). SMS is silently skipped (with a warning log) if any secret is missing. Helper is at `artifacts/api-server/src/lib/sms.ts`; hooked into `processStripeEvent` in `portal.ts` for both `service_purchase` and `onboarding_purchase` event types.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
