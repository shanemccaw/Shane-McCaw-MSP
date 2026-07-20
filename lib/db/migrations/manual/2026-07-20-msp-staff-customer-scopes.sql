-- MSP Staff Customer Scopes — per-staff-member tenant-access restriction
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- Adds an ADDITIVE, OPT-IN restriction of which customers a given MSP staff
-- member (MSPAdmin / MSPOperator) may access. Default behavior is UNCHANGED:
-- a staff member with ZERO rows in this table has UNRESTRICTED access to every
-- customer in their MSP (the historical behavior). Once one or more rows exist
-- for a staff user, that user is restricted to EXACTLY that set of customers.
--
-- Runtime consumers:
--   * assertCustomerAccess() in artifacts/api-server/src/middlewares/requireAuth.ts
--     — the single source of truth for customer ownership; every single-customer
--     route (customer detail, diagnostics, documents, mission control, offers,
--     etc.) flows through it or the resolveAccessibleCustomerIds() helper.
--   * Cross-customer list/aggregate routes (GET /api/msp/customers, /api/msp/alerts,
--     /api/msp/documents-hub) narrow their result set to the staff member's
--     assigned customers when scoped.
--   * GET/PUT /api/msp/settings/users/:userId/customer-scopes (msp-settings.ts)
--     read/write the assignment set from user-management.tsx.
--
-- id-space: staff_user_id is a users.id (matches req.user.id / the :userId route
-- param / the JWT claim used at enforcement sites). customer_id is an
-- msp_customers.id (the customer organisation). msp_id is denormalized from the
-- staff member's MSP for fast per-MSP indexing and a defense-in-depth fence.

CREATE TABLE IF NOT EXISTS "msp_staff_customer_scopes" (
  "id" serial PRIMARY KEY,
  "msp_id" integer NOT NULL REFERENCES "msps"("id") ON DELETE CASCADE,
  "staff_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "customer_id" integer NOT NULL REFERENCES "msp_customers"("id") ON DELETE CASCADE,
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- One scope row per (staff member, customer) pair — idempotent re-assignment.
CREATE UNIQUE INDEX IF NOT EXISTS "msp_staff_customer_scopes_staff_customer_uniq"
  ON "msp_staff_customer_scopes" ("staff_user_id", "customer_id");
CREATE INDEX IF NOT EXISTS "msp_staff_customer_scopes_staff_user_id_idx"
  ON "msp_staff_customer_scopes" ("staff_user_id");
CREATE INDEX IF NOT EXISTS "msp_staff_customer_scopes_customer_id_idx"
  ON "msp_staff_customer_scopes" ("customer_id");
CREATE INDEX IF NOT EXISTS "msp_staff_customer_scopes_msp_id_idx"
  ON "msp_staff_customer_scopes" ("msp_id");
