-- ════════════════════════════════════════════════════════════════════════════
-- Git #401 — Expressibility audit: which ACTIVE monitor checks have a real,
-- correct-in-principle signal that the mapping/severity vocabulary cannot say?
--
-- READ-ONLY. Nothing here writes. Every statement is a SELECT.
--
-- WHY THIS IS SQL AND NOT CODE: monitor_checks.mapping and .severity_rules are
-- jsonb DATA, not a TypeScript union. The executor cannot reject an unknown
-- transform at authoring time, and three separate checks were found stuck by
-- hand in one session (#401's own text). This is that hunt done systematically
-- instead of one check at a time.
--
-- The vocabulary as of #401 (artifacts/api-server/src/lib/monitor-executor.ts):
--   mapping transforms — none, count, exists, first, join, countTruthy,
--     countFalse, countEmptyArray, countEquals('x'),
--     countIfLastSignInOlderThan(N), groupByCount, countDuplicates
--   severity/fan-out grammar — == != > < >= <= , contains ,
--     length> length< length>= length<= length== ,
--     olderThanDays N , newerThanDays N , && , ||
--
-- Run each part and read the `verdict` column. Parts A, C and E are the ones
-- that name a REAL blocked check; B and D are weaker signals that need a human
-- read of the check's intent before acting.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- PART A — Transforms that are NOT implemented.
--
-- The highest-value query here. An unimplemented transform does not error: it
-- falls through applyMapping's default branch and emits a RAW ARRAY, which no
-- numeric signal rule can read, so the resolver quietly drops to _itemCount.
-- The check looks configured, runs green, and reports the wrong number forever.
--
-- Note the trap this is built to catch: #401 nearly shipped the transform under
-- the name "countEmpty" while the implemented name is "countEmptyArray". One
-- character of drift between the authored data and the code is invisible
-- everywhere except here (and, since #401, in a runtime log.warn).
-- ════════════════════════════════════════════════════════════════════════════

SELECT c.key,
       c.label,
       c.status,
       m->>'sourceField'  AS source_field,
       m->>'targetField'  AS target_field,
       m->>'transform'    AS transform,
       'UNIMPLEMENTED TRANSFORM — emits a raw array, signal silently lost' AS verdict
FROM monitor_checks c
CROSS JOIN LATERAL jsonb_array_elements(c.mapping) AS m
WHERE c.status = 'active'
  AND COALESCE(m->>'transform', 'none') !~
      '^(none|count|exists|first|join|countTruthy|countFalse|countEmptyArray|groupByCount|countDuplicates'
      || '|countEquals\(\s*''.*''\s*\)|countIfLastSignInOlderThan\(\s*\d+\s*\))$'
ORDER BY c.key;


-- ════════════════════════════════════════════════════════════════════════════
-- PART B — Nested-array candidates: the endpoint fetches a nested collection
-- ($expand), but no mapping rule reads emptiness of one.
--
-- This is the governance:ownerless-groups shape generalised. An $expand costs
-- real Graph load, so a check that pays for one and then never reads the
-- expanded collection is either wasting the expansion or — the interesting
-- case — was written wanting "how many have NONE of these" and settled for
-- something else.
--
-- WEAK SIGNAL: an $expand is also legitimately used to read a single nested
-- object (e.g. `$expand=principal` on roleEligibilitySchedules, which is not a
-- collection at all). Read the check's intent before acting on a row here.
-- ════════════════════════════════════════════════════════════════════════════

SELECT c.key,
       c.label,
       c.endpoint,
       (SELECT string_agg(DISTINCT m->>'transform', ', ')
          FROM jsonb_array_elements(c.mapping) m) AS transforms_used,
       CASE
         WHEN c.mapping = '[]'::jsonb THEN 'EXPANDS BUT MAPS NOTHING — only _itemCount survives'
         ELSE 'expands a nested collection but never counts emptiness — countEmptyArray candidate?'
       END AS verdict
FROM monitor_checks c
WHERE c.status = 'active'
  AND (c.endpoint ILIKE '%$expand=%' OR COALESCE(c.fan_out_source, '') ILIKE '%$expand=%')
  AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(c.mapping) m
        WHERE m->>'transform' = 'countEmptyArray'
      )
ORDER BY c.key;


-- ════════════════════════════════════════════════════════════════════════════
-- PART C — Date fields compared with a NON-date operator.
--
-- The identity:hybrid-sync-health / governance:overdue-access-reviews shape. A
-- severity rule that names a timestamp-ish key and then compares it with ==, >,
-- <, >= or <= is doing one of three things, all wrong:
--   * `>` / `<` on an ISO string  -> Number(left) is NaN, so the clause is
--     ALWAYS false. A dead rule that looks alive.
--   * `== null` alone             -> catches "never happened" but is blind to
--     "happened, but far too long ago" — the actual staleness question.
--   * `contains "2026"`           -> a year-prefix hack that silently rots.
-- Since #401 the honest form is `field olderThanDays N` (see the file header).
--
-- Deliberately matched on the KEY NAME, not the value: severity_rules are
-- evaluated before any tenant data exists here, so the field name is the only
-- available evidence of intent.
-- ════════════════════════════════════════════════════════════════════════════

SELECT c.key,
       c.label,
       r->>'expression' AS expression,
       r->>'severity'   AS severity,
       CASE
         WHEN r->>'expression' ~ '[<>]=?\s*[0-9]'
           THEN 'DEAD RULE — numeric compare against an ISO string is always false; use olderThanDays N'
         WHEN r->>'expression' ILIKE '%contains%'
           THEN 'DATE-AS-STRING HACK — substring match on a timestamp; use olderThanDays N'
         ELSE 'date-ish key compared without date semantics — confirm intent, olderThanDays N may be the real rule'
       END AS verdict
FROM monitor_checks c
CROSS JOIN LATERAL jsonb_array_elements(c.severity_rules) AS r
WHERE c.status = 'active'
  AND r->>'expression' ~* '(DateTime|_date|Date[A-Z_ ]|lastSync|lastSignIn|expir|renew|endDate|startDate|createdOn|reviewEnd)'
  AND r->>'expression' !~ '(olderThanDays|newerThanDays)'
ORDER BY c.key;


-- ════════════════════════════════════════════════════════════════════════════
-- PART D — Checks that CANNOT produce a finding at all.
--
-- Not a vocabulary gap as such, but the same silent-failure family and the
-- cheapest thing to look at while you are in here: an active check with zero
-- severity rules can run green forever and never once raise anything. Some of
-- these are legitimate (pure data-collection checks feeding a resolver); the
-- column says which is which so the legitimate ones can be dismissed fast.
-- ════════════════════════════════════════════════════════════════════════════

SELECT c.key,
       c.label,
       jsonb_array_length(c.mapping)        AS mapping_rules,
       jsonb_array_length(c.severity_rules) AS severity_rules,
       CASE
         WHEN jsonb_array_length(c.severity_rules) = 0 AND jsonb_array_length(c.mapping) = 0
           THEN 'NO RULES AND NO MAPPING — this check can only ever report _itemCount'
         ELSE 'no severity rules — collection-only? confirm a resolver actually reads its target fields'
       END AS verdict
FROM monitor_checks c
WHERE c.status = 'active'
  AND jsonb_array_length(c.severity_rules) = 0
ORDER BY jsonb_array_length(c.mapping), c.key;


-- ════════════════════════════════════════════════════════════════════════════
-- PART E — Severity rules whose source key NOTHING produces.
--
-- The phantom-key class: an expression referencing a key that the check's own
-- mapping targetFields / properties never emit. resolvePathInData returns
-- undefined, the clause is false, and the rule is dead on arrival — the same
-- silent nothing as an unimplemented transform, reached from the other side.
--
-- Two stated limits, so nobody reads an empty result as an all-clear:
--   * It only sees the `{{key}}` form. The grammar also accepts a BARE
--     identifier as a path, but a bare token is textually indistinguishable
--     from a string literal (`status == active`), so matching those would
--     invent false positives. Bare-path rules are simply not covered.
--   * It does not model the `_count`/`_first`/`_values` property suffixes,
--     `_itemCount`, or `{{_fanOut.*}}`; those are excluded rather than
--     reported.
-- Treat output as a shortlist to read, not a verdict to act on blind.
-- ════════════════════════════════════════════════════════════════════════════

WITH produced AS (
  SELECT c.id,
         c.key,
         ARRAY(SELECT m->>'targetField' FROM jsonb_array_elements(c.mapping) m)
         || ARRAY(SELECT p.value #>> '{}' FROM jsonb_array_elements(c.properties) p) AS keys
  FROM monitor_checks c
  WHERE c.status = 'active'
),
tokens AS (
  SELECT c.key AS check_key,
         r->>'expression' AS expression,
         t.token,
         p.keys
  FROM monitor_checks c
  JOIN produced p ON p.id = c.id
  CROSS JOIN LATERAL jsonb_array_elements(c.severity_rules) AS r
  CROSS JOIN LATERAL regexp_matches(r->>'expression', '\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}', 'g') AS t(token)
  WHERE c.status = 'active'
)
SELECT DISTINCT
       check_key,
       expression,
       token[1] AS referenced_key,
       'PHANTOM KEY — no mapping targetField or property produces it; rule can never fire' AS verdict
FROM tokens
WHERE token[1] <> ALL (keys)
  AND token[1] NOT IN ('_itemCount')
  AND token[1] !~ '_(count|first|values)$'
ORDER BY check_key;
