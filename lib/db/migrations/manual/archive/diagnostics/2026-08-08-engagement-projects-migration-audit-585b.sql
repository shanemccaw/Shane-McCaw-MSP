-- ============================================================================
-- #585 PRE-MIGRATION AUDIT, PART B -- follow-up after part A showed services
-- already contains matching serviceClass='project' rows for at least ids 1-6.
-- ============================================================================
-- READ-ONLY. Pure SELECT. No DDL, no DML. Split into three small queries so
-- none of them truncate the way the combined part-A run did at services id 39
-- of 91.
-- ============================================================================

-- Query A: every services row already tagged as a migrated project, in full,
-- so every engagement_projects row can be matched 1:1 (or flagged as missing
-- its services counterpart) before any new INSERT is written.
SELECT id, slug, name, category, service_class, base_price, max_price, price_cents,
       fulfillment_type_key, delivery_type, triggering_signal_keys, sort_order, is_public, visibility
FROM services
WHERE service_class = 'project' OR fulfillment_type_key = 'project_sow' OR category = 'project'
ORDER BY id;

-- Query B: the full real signal_key vocabulary (platform-wide rules only),
-- to verify every triggeredBy value on the 27 engagement_projects rows
-- against something that actually exists before it's used in an eligibility
-- rule's required_signal_keys.
SELECT DISTINCT signal_key
FROM signal_derivation_rules
WHERE msp_id IS NULL
ORDER BY signal_key;

-- Query C: every existing sales_offer_rule_groups row, to check whether any
-- of these 27 project services already has an eligibility group (avoid a
-- duplicate) and to confirm the real `key` naming convention in use so new
-- rows don't collide.
SELECT id, key, label, rule_type, service_id, required_signal_keys, logic, is_active, sort_order
FROM sales_offer_rule_groups
ORDER BY id;
