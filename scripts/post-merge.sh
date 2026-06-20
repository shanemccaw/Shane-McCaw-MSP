#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db push-force

# Verify Stripe webhook endpoints are registered for every production domain.
# This is a check-only pass (no --fix) so it never blocks a deploy.
# It exits 0 when endpoints match, 1 when mismatches are found (non-fatal here),
# and 2 when env vars needed to run the check are missing (also non-fatal).
if [ -n "$STRIPE_SECRET_KEY" ] && [ -n "$REPLIT_DOMAINS" ]; then
  echo "Checking Stripe webhook endpoints…"
  pnpm --filter @workspace/scripts run sync-webhooks || \
    echo "WARNING: Stripe webhook sync check found issues — see output above. Run with --fix or update Stripe Dashboard manually."
else
  echo "Skipping Stripe webhook check (STRIPE_SECRET_KEY or REPLIT_DOMAINS not set)."
fi

# Apply schema migrations to production, then sync the services catalogue.
# Both steps run when either PROD_DATABASE_URL or DATABASE_URL_PROD is set.
# Skipped silently when neither is set (safe to run locally).
if [ -n "$PROD_DATABASE_URL" ] || [ -n "$DATABASE_URL_PROD" ]; then
  echo "Applying schema migrations to production database…"
  if pnpm --filter @workspace/scripts run migrate-prod; then
    echo "Migrations applied. Syncing services catalogue to production database…"
    pnpm --filter @workspace/scripts run sync-services || \
      echo "WARNING: Services sync failed — see output above. Run manually: pnpm --filter @workspace/scripts run sync-services"
  else
    echo "ERROR: migrate-prod failed — skipping services sync to avoid writing into a stale schema."
    echo "Fix the migration error above, then run manually:"
    echo "  pnpm --filter @workspace/scripts run migrate-prod"
    echo "  pnpm --filter @workspace/scripts run sync-services"
  fi
else
  echo "Skipping migrations and services sync (PROD_DATABASE_URL and DATABASE_URL_PROD are not set)."
fi
