#!/bin/bash
set -e
pnpm install --no-frozen-lockfile

# Rebuild all composite lib declarations (lib/db, lib/api-zod, etc.) so that
# api-server and other consumers always see up-to-date type definitions.
# Without this, adding new schema entries (e.g. WfNode variants) compiles
# correctly in the source but the stale dist/**.d.ts files make the consuming
# packages treat the new cases as dead/unreachable code at runtime.
echo "Building lib declarations…"
pnpm run typecheck:libs

# Guard: static drift check (no DB connection required).
# Fails (exit 1) and blocks the merge if:
#   - The schema file changed since the last `generate` run (hash mismatch)
#   - A journal entry is missing its .sql file
#   - A .sql file exists on disk but is NOT tracked in the journal (orphan —
#     invisible to both migrate-dev and migrate-prod, silently never applied)
echo "Running migration drift check…"
pnpm --filter @workspace/scripts run check-drift

# Apply pending Drizzle-generated SQL migrations to the dev database.
# Uses the journal-based migrate-dev runner (not drizzle-kit push) so that:
#   - Each migration is tracked in __drizzle_migrations and never re-applied.
#   - "Already exists" errors (column/table/constraint) are handled gracefully
#     via savepoints — safe when the dev DB was patched by hand before tracking.
#   - No interactive TTY prompts are required (push/push-force can hang or fail
#     in non-interactive post-merge shells when schema changes need confirmation).
echo "Applying pending migrations to dev database…"
if pnpm --filter @workspace/scripts run migrate-dev; then
  echo "Dev database migrations applied."
else
  echo "ERROR: migrate-dev failed — see output above."
  echo "Fix the migration error, then run: pnpm --filter @workspace/scripts run migrate-dev"
  exit 1
fi

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
