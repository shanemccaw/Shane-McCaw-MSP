-- ============================================================================
-- #585 PRE-MIGRATION AUDIT, PART C -- root-causing "invalid input syntax for
-- type json" on INSERT INTO sales_offer_rule_groups
-- ============================================================================
-- READ-ONLY except Query D, which is a single throwaway test row wrapped in
-- its own transaction that always rolls back -- it never commits, so it
-- cannot corrupt real data no matter what it proves.
--
-- WHY THIS FILE EXISTS
--   Two different literal-construction techniques for required_signal_keys
--   both failed with the identical error:
--     1. '["a","b"]'::jsonb   (a JSON-formatted text literal, cast to jsonb)
--     2. jsonb_build_array('a','b')  (built server-side from plain SQL string
--        arguments -- there is no JSON text for Postgres to parse here at all)
--   (2) cannot fail with "invalid input syntax for type json" from anything
--   in the VALUES list itself -- there is no json-typed input in that
--   expression. Since the error is identical both times, and Part 1 (an
--   INSERT into fulfillment_types, same file, same jsonb_build_array()
--   pattern) succeeds every time, the cause is not in my SQL text at all --
--   it is something specific to inserting into sales_offer_rule_groups: a
--   trigger, a check constraint, or a generated column casting some OTHER
--   column (label/description/key -- none of which are JSON, all of which
--   are ordinary sentence text) to json/jsonb somewhere server-side.
--   Queries A-C below find out what. Query D isolates whether it's about
--   THIS row's content at all, or literally any insert into this table.
-- ============================================================================

-- Query A: every trigger attached to sales_offer_rule_groups, and the
-- function body each one runs -- looking for any ::json / ::jsonb cast on a
-- non-jsonb column (label, description, key, rule_type, logic).
SELECT t.tgname AS trigger_name,
       t.tgtype,
       p.proname AS function_name,
       pg_get_functiondef(p.oid) AS function_body
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE c.relname = 'sales_offer_rule_groups'
  AND NOT t.tgisinternal;

-- Query B: every CHECK constraint on sales_offer_rule_groups (a constraint
-- expression referencing e.g. label::json or description::jsonb would throw
-- exactly this error on any row whose text isn't valid JSON -- i.e. every
-- real label/description ever written).
SELECT conname, pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'sales_offer_rule_groups'::regclass;

-- Query C: full column list with types and default expressions -- looking
-- for a GENERATED ALWAYS AS column, or a DEFAULT expression referencing json,
-- on any column (not just required_signal_keys).
SELECT column_name, data_type, udt_name, column_default,
       is_generated, generation_expression
FROM information_schema.columns
WHERE table_name = 'sales_offer_rule_groups'
ORDER BY ordinal_position;

-- Query D: minimal isolated test insert -- proves whether ANY new row into
-- this table hits the same error, independent of my specific label/
-- description/signal-key content. Always rolls back; never commits, so it
-- is safe to run even against production data.
BEGIN;
INSERT INTO sales_offer_rule_groups
  (key, label, rule_type, service_id, required_signal_keys, logic, is_active)
VALUES
  ('__585_diagnostic_test_row__', 'Diagnostic Test Row', 'eligibility',
   (SELECT id FROM services WHERE slug = 'pim-rollout'),
   jsonb_build_array('signal.identity.pim-permanent-roles'), 'OR', false);
ROLLBACK;
