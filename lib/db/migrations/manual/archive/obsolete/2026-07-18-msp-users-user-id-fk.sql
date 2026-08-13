-- msp_users.user_id foreign key constraint
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).
--
-- Context: msp_users.user_id has never had a foreign key to users.id — the
-- original creation migration (0157_add_msp_platform_tables.sql) defined it
-- as a bare "integer NOT NULL UNIQUE" with no .references(). This means
-- orphaned msp_users rows (user_id pointing at a deleted/nonexistent users
-- row) are possible and nothing has ever prevented them.
--
-- Step 1 — find any orphaned rows first:
--
--   SELECT mu.id, mu.user_id, mu.msp_id, mu.customer_id, mu.msp_role
--   FROM msp_users mu
--   LEFT JOIN users u ON u.id = mu.user_id
--   WHERE u.id IS NULL;
--
-- Step 2 — if the query above returns rows, decide whether to delete them or
-- relink them to a valid users.id. This is a data-integrity call only Shane
-- can make — do not uncomment/run the DELETE below without reviewing the
-- orphaned rows first.
--
-- DELETE FROM msp_users
-- WHERE id IN (/* paste orphaned msp_users.id values from the SELECT above */);
--
-- Step 3 — once there are zero orphaned rows, add the constraint:

ALTER TABLE "msp_users" DROP CONSTRAINT IF EXISTS "msp_users_user_id_fkey";
ALTER TABLE "msp_users"
  ADD CONSTRAINT "msp_users_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;