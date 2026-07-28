-- =============================================================================
-- FILE A of 2 — insights_generated_documents.msp_customer_id
--
-- SAFE TO RUN. Additive only: adds a NULLABLE column and backfills it.
-- Nothing in this file can fail an existing INSERT or drop any data.
--
-- Run this file, then read the verification SELECT at the bottom.
-- File B (`2026-07-28-igd-msp-customer-id-B-not-null-and-index.sql`) must NOT
-- be run until that straggler count is ZERO.
--
-- WHY: `insights_generated_documents.customer_id` is a `users.id` — ONE
-- arbitrary login out of however many a tenant has. Every customer-scoped read
-- therefore has to fan out through the `msp_users` bridge, and a document
-- becomes unfindable if that particular login is ever unlinked. This column
-- owns the document by TENANT (`msp_customers.id`) directly. `customer_id`
-- stays, as the document OWNER (which login generated/receives it) rather than
-- as the scope.
-- =============================================================================

-- ── Step 1: add the column (nullable for now — File B makes it NOT NULL) ──────
ALTER TABLE insights_generated_documents
  ADD COLUMN IF NOT EXISTS msp_customer_id INTEGER REFERENCES msp_customers(id);


-- ── Step 2: backfill from the msp_users bridge ───────────────────────────────
-- `msp_users.user_id` is UNIQUE, so this join matches at most one row per
-- document and the result is deterministic (no arbitrary row-pick).
-- A `msp_users` row with a NULL `customer_id` (MSP staff, not a customer
-- contact) matches but contributes NULL — those rows stay stragglers below,
-- which is correct: they have no tenant.
UPDATE insights_generated_documents d
SET msp_customer_id = mu.customer_id
FROM msp_users mu
WHERE mu.user_id = d.customer_id
  AND d.msp_customer_id IS NULL;


-- ── Step 3: VERIFICATION — read this before going anywhere near File B ───────
-- Not part of the UPDATE. Counts every row the backfill could not resolve,
-- grouped by doc_type so it is obvious what is unmatched.
--
-- Expect these categories of straggler:
--   * documents whose customer_id is NULL outright (never had an owner)
--   * documents owned by a users.id with no msp_users row at all
--     (orphaned test rows, deleted accounts)
--   * documents owned by a login whose msp_users.customer_id is NULL
--     (MSP staff account, not a customer contact)
--
-- If this returns ZERO ROWS, File B is safe to run.
-- If it returns rows, resolve or delete them FIRST — deliberately, by hand.
-- Nothing in this migration deletes a document.
SELECT
  d.doc_type,
  COUNT(*)                                        AS unmatched_rows,
  COUNT(*) FILTER (WHERE d.customer_id IS NULL)   AS owner_is_null,
  COUNT(*) FILTER (WHERE d.customer_id IS NOT NULL
                     AND mu.user_id IS NULL)      AS no_msp_users_row,
  COUNT(*) FILTER (WHERE mu.user_id IS NOT NULL
                     AND mu.customer_id IS NULL)  AS msp_user_has_no_customer,
  MIN(d.created_at)                               AS oldest,
  MAX(d.created_at)                               AS newest
FROM insights_generated_documents d
LEFT JOIN msp_users mu ON mu.user_id = d.customer_id
WHERE d.msp_customer_id IS NULL
GROUP BY d.doc_type
ORDER BY unmatched_rows DESC;


-- ── Step 4: the single number that gates File B ──────────────────────────────
-- Must be 0.
SELECT COUNT(*) AS total_stragglers_must_be_zero_before_file_b
FROM insights_generated_documents
WHERE msp_customer_id IS NULL;
