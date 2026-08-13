-- Backfill: direct-client accounts created via Admin Panel -> Delivery -> Clients
-- ("Add Client") that ended up with msp_users.customer_id = NULL.
--
-- Root cause (fixed in code this session, see PLATFORM_BUILD.md
-- "direct-client-customer-linkage-fix"): POST /admin/clients called
-- ensureDirectCustomerRecord(client.id) followed by ensureClientMspUser(client.id)
-- with no tenantId, so the new msp_customers row's id was silently discarded and
-- ensureClientMspUser had nothing to resolve customer_id from. The client could
-- log in (auth works, msp_users row exists) but every customer-scoped route
-- rejected them with "No customer account associated with this user".
--
-- This migration is READ-ONLY. It surfaces the affected accounts for Shane to
-- review by hand — auto-guessing the mapping is NOT safe here: the direct-business
-- MSP can have multiple "Direct Customer" placeholder rows with generic names, and
-- there is no reliable signal (tenantId, email, etc.) tying a given orphaned
-- msp_users row to one specific msp_customers row.
--
-- Manual migration — review and run by hand (do not run drizzle-kit push/push --force).

-- ── Step 1: find the affected msp_users rows ───────────────────────────────────
-- (broken accounts: CustomerUser role, no customer_id, under whichever MSP is
-- currently flagged is_direct_business = true)
SELECT
  mu.id                AS msp_users_id,
  mu.user_id,
  u.email               AS user_email,
  u.name                AS user_name,
  u.company             AS user_company,
  u.created_at          AS user_created_at,
  mu.msp_id,
  m.name                AS msp_name
FROM msp_users mu
JOIN users u ON u.id = mu.user_id
JOIN msps m ON m.id = mu.msp_id
WHERE mu.customer_id IS NULL
  AND mu.msp_role = 'CustomerUser'
  AND u.role = 'client'
  AND m.is_direct_business = true
ORDER BY u.created_at;

-- ── Step 2: for each affected user above, find candidate msp_customers rows ────
-- under the same direct-business MSP to link them to. Run this per user_id from
-- Step 1 (or adapt into a single query) — a candidate is "unambiguous" only when
-- exactly one row is returned; if more than one comes back (e.g. several generic
-- "Direct Customer" placeholders), do NOT guess — link manually after confirming
-- with Shane which is correct (by created_at proximity to the user, company name,
-- tenantId, etc.).
--
-- SELECT mc.id, mc.name, mc.tenant_id, mc.status, mc.created_at
-- FROM msp_customers mc
-- JOIN msps m ON m.id = mc.msp_id
-- WHERE m.is_direct_business = true
-- ORDER BY mc.created_at;

-- ── Step 3 (commented — adapt per row, do NOT run as a bulk statement) ─────────
-- Once a specific (msp_users.id, msp_customers.id) pair has been confirmed by
-- hand for a given affected account:
--
-- UPDATE msp_users
-- SET customer_id = <confirmed_msp_customers_id>, updated_at = now()
-- WHERE id = <msp_users_id_from_step_1>
--   AND customer_id IS NULL; -- safety: no-op if already linked by another process
