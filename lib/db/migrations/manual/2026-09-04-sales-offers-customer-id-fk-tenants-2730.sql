-- sales_offers.customer_id FK repoint: users(id) -> tenants(id) (#2730)
-- Manual migration - review and run by hand (do not run drizzle-kit push/push --force).
--
-- Live (confirmed via `psql "$DATABASE_URL" -c '\d sales_offers'`):
--   "sales_offers_tenant_id_fkey" FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE SET NULL
-- The constraint is a naming fossil from when the column was literally named
-- tenant_id (renamed to customer_id in drizzle/0192_rename_sales_offers_tenant_id.sql,
-- which -- as a plain column rename -- never touched the constraint name or target).
--
-- Every real write path into sales_offers.customer_id writes a tenants.id, not a
-- users.id:
--   - persistSalesOfferCandidates() (sales-offer-engine.ts) writes the customerId
--     it receives straight through; that customerId traces to
--     runSalesOfferEngineForTenant(customerId) -> buildTenantProfile(customerId),
--     which queries `tenantsTable.id = customerId` (tenant-signals.ts).
--   - msp-marketplace-purchase.ts's checkout insert resolves customerId via
--     resolveScopedCustomer() against tenants.id before inserting.
-- And most real read paths already agree (msp-sow.ts's offer-accept handler,
-- dashboard-resolvers.ts, project-sow-fulfillment.ts, the three portal routes
-- reading the JWT's tenant-level customerId claim). A handful of consumers
-- (msp-executive-data.ts / #2722, msp-customer-timeline.ts, portal-customer-search.ts,
-- portal-customer-timeline.ts, admin-active-directory.ts's user-delete census)
-- incorrectly bridged/filtered it as a users.id instead - fixed alongside this
-- migration in the same commit, not left as a stale FK with patched call sites.
--
-- Live data confirmed safe to repoint (2026-09-04): all 5 sales_offers rows have
-- customer_id = 1, which is a real tenants.id (no orphans against tenants).
--
-- Full writeup: docs/offers-and-sow-acceptance-msp-console-contract-pack.md section 6b.

BEGIN;

ALTER TABLE "sales_offers" DROP CONSTRAINT IF EXISTS "sales_offers_tenant_id_fkey";

ALTER TABLE "sales_offers"
  ADD CONSTRAINT "sales_offers_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "tenants"("id") ON DELETE SET NULL;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-04-sales-offers-customer-id-fk-tenants-2730.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
