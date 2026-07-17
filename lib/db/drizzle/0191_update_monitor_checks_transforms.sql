UPDATE monitor_checks
SET mapping = COALESCE(
  (
    SELECT jsonb_agg(
      CASE 
        WHEN elem->>'transform' = 'raw' THEN jsonb_set(elem, '{transform}', '"groupByCount"')
        ELSE elem
      END
    )
    FROM jsonb_array_elements(mapping) AS elem
  ),
  '[]'::jsonb
)
WHERE key IN ('licensing:sku-utilization', 'copilot:license-readiness', 'cost:license-waste-estimate');

UPDATE monitor_checks
SET mapping = COALESCE(
  (
    SELECT jsonb_agg(
      CASE 
        WHEN elem->>'transform' = 'countWhere' THEN jsonb_set(elem, '{transform}', '"countDuplicates"')
        ELSE elem
      END
    )
    FROM jsonb_array_elements(mapping) AS elem
  ),
  '[]'::jsonb
)
WHERE key = 'licensing:duplicate-assignments';
