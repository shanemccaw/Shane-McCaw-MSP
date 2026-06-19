#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

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

# Sync the services catalogue from dev to production database.
# Skipped silently when PROD_DATABASE_URL is not set (safe to run locally).
if [ -n "$PROD_DATABASE_URL" ]; then
  echo "Syncing services catalogue to production database…"
  pnpm --filter @workspace/scripts run sync-services || \
    echo "WARNING: Services sync failed — see output above. Run manually: pnpm --filter @workspace/scripts run sync-services"
else
  echo "Skipping services sync (PROD_DATABASE_URL not set)."
fi
