-- ════════════════════════════════════════════════════════════════════════════
-- Git #402 — Transform vocabulary audit: which ACTIVE monitor checks name a
-- transform the executor does not implement, and what will the two transforms
-- added in #402 actually do to each rule that names them?
--
-- READ-ONLY. Nothing here writes. Every statement is a SELECT.
--
-- WHY THIS IS SQL AND NOT CODE: monitor_checks.mapping is jsonb DATA held only
-- in the database. Nothing in the repo records what any live check's mapping
-- says, so #402's list of affected checks — copilot:usage-activity,
-- license:copilot-assignment, license:sku-utilization,
-- teams:guest-settings-governance (raw) and license:unused-assigned
-- (countWhere) — could NOT be confirmed from a Claude Code session. Parts B and
-- C below are that confirmation, stated as questions this SQL answers rather
-- than as findings.
--
-- One discrepancy worth knowing before you read the output: an earlier
-- migration, lib/db/drizzle/0191_update_monitor_checks_transforms.sql, already
-- rewrote 'raw' -> 'groupByCount' and 'countWhere' -> 'countDuplicates', but
-- only for keys spelled 'licensing:sku-utilization',
-- 'copilot:license-readiness', 'cost:license-waste-estimate' and
-- 'licensing:duplicate-assignments'. #402 names 'license:sku-utilization' —
-- a DIFFERENT prefix. Part B matches on the suffix so it finds the rows under
-- either spelling; if both exist, that is itself the finding.
--
-- What #402 added (artifacts/api-server/src/lib/monitor-executor.ts):
--   raw   — pass the real objects through unmodified. sourceField decides
--           which: a whole-item spelling ('', '.', '*', 'item', 'items',
--           'value', 'value[]') -> the FULL item array; any other sourceField
--           -> that property off every item. A sourceField that resolves on NO
--           item falls back to the whole item array AND WARNS, because that is
--           what every rule broken by #402 looks like.
--   countWhere('<expression>')
--         — count matches using the SAME condition grammar severity_rules use
--           (evalConditionGrammar). sourceField naming an array field counts
--           ENTRIES inside those arrays; otherwise it counts ITEMS.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- PART A — Every distinct transform actually in use, vs the real switch
-- statement. This is the census #402 asks for ("there could be more").
--
-- A transform outside the implemented list does NOT fail: it lands in the
-- default branch, emits a raw array of values, and the downstream numeric
-- signal rule silently reads nothing. Read the verdict column.
-- ════════════════════════════════════════════════════════════════════════════

WITH implemented(name) AS (
  VALUES ('none'), ('count'), ('exists'), ('first'), ('join'), ('raw'),
         ('countTruthy'), ('countFalse'), ('countEmptyArray'),
         ('countEquals'), ('countIfLastSignInOlderThan'),
         ('groupByCount'), ('countDuplicates'),
         ('valueWhere'), ('flattenValues'), ('countDuplicatesBy'),
         ('countWhere')
),
rules AS (
  SELECT c.key AS check_key,
         c.status AS check_status,
         elem->>'sourceField' AS source_field,
         elem->>'targetField' AS target_field,
         COALESCE(elem->>'transform', 'none') AS transform
  FROM monitor_checks c
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.mapping, '[]'::jsonb)) AS elem
)
SELECT r.transform,
       split_part(r.transform, '(', 1) AS base_name,
       COUNT(*) AS rule_count,
       COUNT(*) FILTER (WHERE r.check_status = 'active') AS active_rule_count,
       string_agg(DISTINCT r.check_key, ', ' ORDER BY r.check_key) AS checks,
       CASE
         WHEN i.name IS NULL
           THEN 'NOT IMPLEMENTED — silently emits a raw array; any numeric signal rule reading this target is dark'
         WHEN split_part(r.transform, '(', 1) IN ('raw')
           THEN 'implemented by #402 — see Part C for which reading each rule gets'
         WHEN split_part(r.transform, '(', 1) IN ('countWhere')
           THEN 'implemented by #402 — see Part D for whether the predicate parses'
         ELSE 'implemented'
       END AS verdict
FROM rules r
LEFT JOIN implemented i ON i.name = split_part(r.transform, '(', 1)
GROUP BY r.transform, i.name
ORDER BY (i.name IS NULL) DESC, rule_count DESC;


-- ════════════════════════════════════════════════════════════════════════════
-- PART B — The five checks #402 names, in full. Confirms (or refutes) that each
-- still carries the transform the issue says it does, and shows the key prefix
-- actually in use ('license:' vs 'licensing:', per the 0191 discrepancy above).
--
-- If a row here comes back with a transform OTHER than raw/countWhere, the
-- issue's list is stale for that check and nothing about it needs doing.
-- ════════════════════════════════════════════════════════════════════════════

SELECT c.key AS check_key,
       c.status AS check_status,
       elem->>'sourceField' AS source_field,
       elem->>'targetField' AS target_field,
       COALESCE(elem->>'transform', 'none') AS transform,
       CASE
         WHEN COALESCE(elem->>'transform', 'none') IN ('raw', 'countWhere')
           OR COALESCE(elem->>'transform', 'none') LIKE 'countWhere(%'
           THEN 'STILL AFFECTED — was dark before #402'
         ELSE 'not affected — this rule names something else'
       END AS verdict
FROM monitor_checks c
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.mapping, '[]'::jsonb)) AS elem
WHERE c.key LIKE '%usage-activity'
   OR c.key LIKE '%copilot-assignment'
   OR c.key LIKE '%sku-utilization'
   OR c.key LIKE '%guest-settings-governance'
   OR c.key LIKE '%unused-assigned'
ORDER BY c.key, elem->>'targetField';


-- ════════════════════════════════════════════════════════════════════════════
-- PART C — Every `raw` rule and the reading it will now get.
--
-- This is the one thing #402 could not decide from the repo: "raw" has two
-- honest meanings and only sourceField says which. Rows marked "WHOLE ITEM
-- ARRAY" get the full fetched objects. Rows marked "per-item property" get that
-- property off every item — correct only if the property really exists on this
-- endpoint's shape; if it does not, the executor now falls back to the whole
-- items and WARNS (grep the run logs for "passed through the WHOLE items").
--
-- ACTION, where a rule reads "per-item property" but the check wants the list:
-- set sourceField to 'value'. That is a one-line jsonb edit, deliberately NOT
-- done here — #402 says implement the transforms and stop.
-- ════════════════════════════════════════════════════════════════════════════

SELECT c.key AS check_key,
       c.status AS check_status,
       COALESCE(elem->>'sourceField', '') AS source_field,
       elem->>'targetField' AS target_field,
       CASE
         WHEN COALESCE(TRIM(elem->>'sourceField'), '') IN ('', '.', '*', 'item', 'items', 'value', 'value[]')
           THEN 'WHOLE ITEM ARRAY — the full fetched objects land in this target'
         ELSE 'per-item property "' || (elem->>'sourceField') || '" — falls back to the whole items (with a warning) if it resolves on nothing'
       END AS reading
FROM monitor_checks c
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.mapping, '[]'::jsonb)) AS elem
WHERE COALESCE(elem->>'transform', '') = 'raw'
ORDER BY c.key;


-- ════════════════════════════════════════════════════════════════════════════
-- PART D — Every `countWhere` rule, and whether its predicate actually parses.
--
-- The argument is a condition expression, so it routinely contains the other
-- quote character. The executor accepts countWhere('...') and countWhere("...")
-- with the OUTER quote absent from the inside; anything else (bare countWhere,
-- empty predicate, unquoted predicate) degrades to the default branch and warns
-- rather than counting a confident 0.
-- ════════════════════════════════════════════════════════════════════════════

SELECT c.key AS check_key,
       c.status AS check_status,
       elem->>'sourceField' AS source_field,
       elem->>'targetField' AS target_field,
       COALESCE(elem->>'transform', '') AS transform,
       CASE
         WHEN COALESCE(elem->>'transform', '') ~ '^countWhere\(\s*''[^'']+''\s*\)$'
           OR COALESCE(elem->>'transform', '') ~ '^countWhere\(\s*"[^"]+"\s*\)$'
           THEN 'parses — predicate runs through the same grammar as severity_rules'
         ELSE 'MALFORMED — no parsable predicate; warns and emits a raw array (it does NOT count 0 silently)'
       END AS verdict,
       CASE
         WHEN COALESCE(TRIM(elem->>'sourceField'), '') IN ('', '.', '*', 'item', 'items', 'value', 'value[]')
           THEN 'counts ITEMS'
         ELSE 'counts ENTRIES inside "' || (elem->>'sourceField') || '" when that resolves to an array, otherwise ITEMS (with a warning)'
       END AS scope
FROM monitor_checks c
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.mapping, '[]'::jsonb)) AS elem
WHERE COALESCE(elem->>'transform', '') LIKE 'countWhere%'
ORDER BY c.key;


-- ════════════════════════════════════════════════════════════════════════════
-- PART E — Live proof, from the last profile each affected check actually
-- wrote: is the target currently empty while the automatic property extraction
-- beside it is full? That contradiction IS the bug #402 reports.
--
-- Re-run this AFTER a fresh scan of the same tenant. The same rows should come
-- back with a populated target — for license:sku-utilization, the real SKU list
-- (Simulator Studio shows the same values under skuPartNumber_values, which was
-- never broken).
--
-- NOTE on raw_response: graphFetchPaginated stores only the FIRST page, so the
-- shape below is proof of SHAPE, never of totals.
-- ════════════════════════════════════════════════════════════════════════════

-- tenant_monitor_profiles carries the check's KEY (check_key text), not its id —
-- profiles are written per checkKey, so that is the only join that exists.
WITH raw_targets AS (
  SELECT c.key AS check_key,
         elem->>'targetField' AS target_field,
         COALESCE(elem->>'transform', '') AS transform
  FROM monitor_checks c
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.mapping, '[]'::jsonb)) AS elem
  WHERE COALESCE(elem->>'transform', '') = 'raw'
     OR COALESCE(elem->>'transform', '') LIKE 'countWhere%'
),
latest AS (
  SELECT DISTINCT ON (p.check_key, p.tenant_id)
         p.check_key, p.tenant_id, p.collected_at, p.extracted_properties
  FROM tenant_monitor_profiles p
  ORDER BY p.check_key, p.tenant_id, p.collected_at DESC
)
SELECT t.check_key,
       t.transform,
       t.target_field,
       l.tenant_id,
       l.collected_at,
       jsonb_typeof(l.extracted_properties -> t.target_field) AS target_type,
       CASE jsonb_typeof(l.extracted_properties -> t.target_field)
         WHEN 'array' THEN jsonb_array_length(l.extracted_properties -> t.target_field)
         ELSE NULL
       END AS target_array_len,
       (l.extracted_properties ->> '_itemCount') AS item_count,
       CASE
         WHEN l.extracted_properties -> t.target_field IS NULL
           THEN 'target key absent entirely'
         WHEN jsonb_typeof(l.extracted_properties -> t.target_field) = 'array'
              AND jsonb_array_length(l.extracted_properties -> t.target_field) = 0
              AND COALESCE((l.extracted_properties ->> '_itemCount')::int, 0) > 0
           THEN 'THE BUG — empty target while the run fetched real items'
         ELSE 'populated'
       END AS verdict
FROM raw_targets t
JOIN latest l ON l.check_key = t.check_key
ORDER BY t.check_key, l.collected_at DESC;


-- Shape proof for license:sku-utilization specifically: the SKU list Graph
-- really returned on the stored first page, beside what the mapping produced.
SELECT p.check_key,
       p.tenant_id,
       p.collected_at,
       jsonb_array_length(COALESCE(p.raw_response -> 'value', '[]'::jsonb)) AS skus_on_first_page,
       (SELECT string_agg(v->>'skuPartNumber', ', ' ORDER BY v->>'skuPartNumber')
          FROM jsonb_array_elements(COALESCE(p.raw_response -> 'value', '[]'::jsonb)) v) AS sku_part_numbers,
       p.extracted_properties
FROM tenant_monitor_profiles p
WHERE p.check_key LIKE '%sku-utilization'
ORDER BY p.collected_at DESC
LIMIT 5;

