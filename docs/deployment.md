# Deployment Guide — Shane McCaw Consulting Platform

## Overview

The platform is a pnpm monorepo deployed on **Replit**. All artifacts share a single Replit deployment that runs a global reverse proxy routing traffic by path. Each artifact binds to its own `PORT` environment variable injected by the workflow system.

---

## Artifacts & Preview Paths

| Artifact | Dir | Preview Path |
|---|---|---|
| Public Website | `artifacts/shane-mccaw-consulting` | `/` |
| API Server | `artifacts/api-server` | `/api` |
| Admin Panel | `artifacts/admin-panel` | `/admin-panel` |
| CRM / Client Portal | `artifacts/crm` | `/crm` |
| MSP Portal | `artifacts/msp-portal` | `/portal` |
| Shane Mobile (Expo) | `artifacts/shane-mobile` | `/shane-mobile` |

---

## MSP Portal — Deployment Path

### Development (Replit Workspace)

1. The `artifacts/msp-portal: web` workflow starts the Vite dev server.
2. Use `restart_workflow "artifacts/msp-portal: web"` or the Replit workflow panel to start/restart it.
3. Access at `https://<replit-dev-domain>/portal/`.

### Production (Replit Deploy)

1. Click **Deploy** in the Replit header (or use the Deployment tab).
2. Replit builds each artifact and exposes them under the same path-based routing.
3. The MSP portal static build is served under `/portal/` by the reverse proxy.

#### Pre-deploy Checklist

- [ ] All required secrets are set in Replit Secrets (see below)
- [ ] `pnpm run typecheck` passes cleanly across all packages
- [ ] `pnpm --filter @workspace/scripts run migrate-prod` has been run to apply any new DB migrations
- [ ] `pnpm --filter @workspace/scripts run sync-webhooks -- --fix` has been run to register/verify Stripe webhook endpoints
- [ ] `STRIPE_SECRET_KEY_PROD` is set (live key, not test key)

---

## Required Secrets

### Core / Always Required

| Secret | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Replit-provisioned DB) |
| `ADMIN_PASSWORD` | Protects `/admin` on the public site |

### Stripe Payments

| Secret | When Used |
|---|---|
| `STRIPE_SECRET_KEY` | Dev workspace (test key, `sk_test_…`) |
| `STRIPE_SECRET_KEY_PROD` | Production deployment (live key, `sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | Dev webhook signing secret |
| `STRIPE_WEBHOOK_SECRET_PROD` | Prod webhook signing secret |

### Azure / M365

| Secret | Purpose |
|---|---|
| `AZURE_CLIENT_ID` | Service principal for Key Vault + Automation |
| `AZURE_CLIENT_SECRET` | Service principal secret |
| `AZURE_TENANT_ID` | Azure AD tenant |
| `AZURE_KEY_VAULT_URL` | Key Vault URL (`https://my-vault.vault.azure.net`) |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription containing Automation account |
| `AZURE_AUTOMATION_RESOURCE_GROUP` | Resource group for Automation account |
| `AZURE_AUTOMATION_ACCOUNT_NAME` | Automation account name |
| `GRAPH_CLIENT_ID` | Service principal for Microsoft Graph |
| `GRAPH_CLIENT_SECRET` | Graph service principal secret |
| `GRAPH_TENANT_ID` | Tenant for Graph API |
| `GRAPH_MAIL_USER_ID` | Mailbox UPN for Graph mail/calendar reads |
| `SHAREPOINT_OWNER_UPN` | Shane's UPN — auto-added as owner on provisioned sites |

### Notifications

| Secret | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID` | SMS order alerts (Twilio) |
| `TWILIO_AUTH_TOKEN` | Twilio auth |
| `TWILIO_FROM_NUMBER` | Twilio sender number (E.164) |
| `SHANE_PHONE_NUMBER` | Destination for SMS alerts (E.164) |
| `VAPID_PUBLIC_KEY` | Browser push notifications (VAPID) |
| `VAPID_PRIVATE_KEY` | VAPID private key |

### External Integrations (Optional)

| Secret | Purpose |
|---|---|
| `GOOGLE_SEARCH_CONSOLE_KEY_JSON` | SEO ranking sync |
| `GOOGLE_SEARCH_CONSOLE_SITE_URL` | Exact Search Console site URL |
| `LINKEDIN_ACCESS_TOKEN` | LinkedIn post workflow node |
| `LINKEDIN_ORG_ID` | LinkedIn org ID |
| `TWITTER_API_KEY` | Twitter post workflow node |
| `TWITTER_API_SECRET` | Twitter API secret |
| `TWITTER_ACCESS_TOKEN` | Twitter account token |
| `TWITTER_ACCESS_TOKEN_SECRET` | Twitter token secret |
| `TWITTER_BEARER_TOKEN` | Twitter bearer (optional) |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | Facebook post workflow node |
| `FACEBOOK_PAGE_ID` | Facebook Page ID |

---

## CI Checks

Run the following before every deploy or PR merge:

```bash
# 1. Full typecheck (libs + all artifacts)
pnpm run typecheck

# 2. Unit/integration tests
pnpm --filter @workspace/api-server run test

# 3. Apply DB migrations to production
pnpm --filter @workspace/scripts run migrate-prod

# 4. Verify/fix Stripe webhook endpoints
pnpm --filter @workspace/scripts run sync-webhooks -- --fix

# 5. Check for schema drift
pnpm --filter @workspace/scripts run check-migration-drift
```

If any step fails, the deployment should be blocked until fixed.

---

## Database Migrations

- Migrations live in `lib/db/drizzle/` (SQL files) and `lib/db/src/schema/` (Drizzle schema).
- Development: `pnpm --filter @workspace/scripts run migrate-dev`
- Production: `pnpm --filter @workspace/scripts run migrate-prod` (idempotent — safe to re-run)
- **Never apply raw SQL directly to the production database without going through the migration pipeline.**

---

## Rollback

1. In the Replit Deployment tab, select a previous deployment snapshot and click **Restore**.
2. Run `pnpm --filter @workspace/scripts run migrate-prod` after rollback to ensure DB state matches the restored code (migrations are additive; downward schema rollback is a manual operation — see incident response runbook).

---

## MSP Portal — Typecheck & Build Verification

```bash
# Typecheck only (preferred for CI)
pnpm --filter @workspace/msp-portal run typecheck

# Vite build (requires PORT and BASE_PATH env vars — run via workflow, not bare shell)
# Use restart_workflow instead of pnpm build from the shell
```
