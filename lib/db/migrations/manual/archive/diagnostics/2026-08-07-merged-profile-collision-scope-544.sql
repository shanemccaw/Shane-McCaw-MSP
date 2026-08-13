-- ============================================================================
-- Git #544 — mergedProfile generic property-name collision: REAL SCOPE
-- DIAGNOSTIC ONLY. Pure SELECT. No DDL, no DML, no self-marking INSERT
-- (diagnostics are exempt per CLAUDE.md — this file lives in
-- archive/diagnostics/, not the tracked migration set).
--
-- WHY THIS FILE EXISTS
-- -------------------
-- `mergeMonitorProfileRows()` (artifacts/api-server/src/lib/tenant-signals.ts)
-- builds the tenant's `mergedProfile` as:
--
--     for (const row of monitorRows) {                 // ORDER BY check_key ASC
--       Object.assign(mergedProfile, row.extractedProperties ?? {});
--       mergedProfile[`${row.checkKey}__itemCount`] = props["_itemCount"] ?? 0;
--     }
--
-- `Object.assign` does not namespace. Any property NAME emitted by two or more
-- checks silently overwrites, and because `fetchLatestMonitorProfileRows()`
-- orders by `check_key ASC`, the check whose key sorts LAST alphabetically wins
-- deterministically on every single build. No error, no warning, no log line.
--
-- Three distinct producers of property names exist, all merged into the same
-- flat namespace (artifacts/api-server/src/lib/monitor-executor.ts,
-- `applyMapping`):
--   1. RAW EXTRACTION — for every entry P in `monitor_checks.properties`,
--      applyMapping emits `P_count`, `P_first`, `P_values` (lines 893-895).
--      These names carry NO check identity at all. This is the class that
--      produced #544's live `displayName_count` proof (15 checks).
--   2. MAPPING TARGET FIELDS — every `monitor_checks.mapping[].targetField`
--      (line 900 onward). Author-chosen, usually check-specific, but nothing
--      enforces uniqueness across checks.
--   3. THE `_itemCount` AUTO-KEY — stamped unconditionally on EVERY check
--      (line 1278), so the bare `_itemCount` collides across the entire
--      catalog by construction. (The synthetic `<checkKey>__itemCount` written
--      by mergeMonitorProfileRows is a SEPARATE, correctly-namespaced key and
--      is NOT affected — see PART C.)
--   4. LICENSE-GAP MARKERS — `_licenseGap` / `_licenseGapCode` /
--      `_licenseGapFeature` (monitor-executor.ts 2575-2576, 2633-2634), written
--      by every PS-backed check that hits an unavailable cmdlet. Same flat
--      namespace, so every license-gapped check in a tenant fights over them.
--
-- HOW TO RUN
-- ----------
-- Run each PART separately in the SQL console and paste the output back onto
-- GitHub issue #544. PART A and PART B answer different questions and BOTH are
-- needed: A is what the CONFIG can produce (catalog-wide, tenant-independent),
-- B is what a real tenant's stored rows ACTUALLY collided on last scan.
-- ============================================================================


-- ============================================================================
-- PART A — PREDICTED collisions from the monitor_checks CONFIG (catalog-wide)
-- ----------------------------------------------------------------------------
-- Every property name the catalog is capable of emitting, and every check that
-- would emit it. `alphabetical_winner` is literally the value mergedProfile
-- would end up holding, because check_key ASC ordering makes max(check_key)
-- the last writer.
--
-- Read `origins` carefully:
--   'properties[]'        -> a generic raw-extraction key (the displayName_count
--                            class). Almost always a genuine, meaningless
--                            collision — these names describe a Graph field,
--                            not a check.
--   'mapping.targetField' -> an author-named field. A collision here may be
--                            intentional (two checks agreeing on one concept)
--                            or accidental. Needs a human read.
--   both                  -> worst case: one check's deliberate mapping output
--                            is being clobbered by another check's incidental
--                            raw extraction, or vice versa.
-- ============================================================================
WITH generated AS (
  -- 1. raw extraction: properties[] -> P_count / P_first / P_values
  SELECT c.key AS check_key,
         (p.value #>> '{}') || sfx.s AS prop_name,
         'properties[]'::text AS origin
  FROM monitor_checks c
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(c.properties) = 'array' THEN c.properties ELSE '[]'::jsonb END
  ) AS p(value)
  CROSS JOIN (VALUES ('_count'), ('_first'), ('_values')) AS sfx(s)
  WHERE c.status = 'active'
    AND coalesce(p.value #>> '{}', '') <> ''

  UNION ALL

  -- 2. mapping target fields
  SELECT c.key,
         m->>'targetField',
         'mapping.targetField'::text
  FROM monitor_checks c
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(c.mapping) = 'array' THEN c.mapping ELSE '[]'::jsonb END
  ) AS m
  WHERE c.status = 'active'
    AND coalesce(m->>'targetField', '') <> ''

  UNION ALL

  -- 3. the unconditional _itemCount auto-key (every check, always)
  SELECT c.key, '_itemCount'::text, 'applyMapping auto-key'::text
  FROM monitor_checks c
  WHERE c.status = 'active'
)
SELECT
  g.prop_name,
  count(DISTINCT g.check_key)                                   AS producing_checks,
  max(g.check_key)                                              AS alphabetical_winner,
  string_agg(DISTINCT g.origin, ' + ')                          AS origins,
  string_agg(DISTINCT g.check_key, ', ' ORDER BY g.check_key)   AS all_producers
FROM generated g
GROUP BY g.prop_name
HAVING count(DISTINCT g.check_key) > 1
ORDER BY count(DISTINCT g.check_key) DESC, g.prop_name;


-- ============================================================================
-- PART A2 — headline counts for PART A (one row, easy to paste)
-- ============================================================================
WITH generated AS (
  SELECT c.key AS check_key, (p.value #>> '{}') || sfx.s AS prop_name, 'properties[]'::text AS origin
  FROM monitor_checks c
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.properties)='array' THEN c.properties ELSE '[]'::jsonb END) AS p(value)
  CROSS JOIN (VALUES ('_count'), ('_first'), ('_values')) AS sfx(s)
  WHERE c.status='active' AND coalesce(p.value #>> '{}','') <> ''
  UNION ALL
  SELECT c.key, m->>'targetField', 'mapping.targetField'::text
  FROM monitor_checks c
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.mapping)='array' THEN c.mapping ELSE '[]'::jsonb END) AS m
  WHERE c.status='active' AND coalesce(m->>'targetField','') <> ''
  UNION ALL
  SELECT c.key, '_itemCount'::text, 'applyMapping auto-key'::text FROM monitor_checks c WHERE c.status='active'
), per_prop AS (
  SELECT prop_name, count(DISTINCT check_key) AS n,
         bool_or(origin = 'properties[]') AS from_raw,
         bool_or(origin = 'mapping.targetField') AS from_mapping
  FROM generated GROUP BY prop_name
)
SELECT
  (SELECT count(*) FROM monitor_checks WHERE status='active')     AS active_checks,
  count(*)                                                        AS distinct_property_names,
  count(*) FILTER (WHERE n > 1)                                   AS colliding_names,
  count(*) FILTER (WHERE n > 1 AND from_raw AND NOT from_mapping) AS colliding_raw_extraction_only,
  count(*) FILTER (WHERE n > 1 AND from_mapping AND NOT from_raw) AS colliding_mapping_only,
  count(*) FILTER (WHERE n > 1 AND from_raw AND from_mapping)     AS colliding_mixed,
  max(n)                                                          AS worst_collision_width
FROM per_prop;


-- ============================================================================
-- PART B — OBSERVED collisions in real stored tenant data
-- ----------------------------------------------------------------------------
-- Replicates `fetchLatestMonitorProfileRows()` EXACTLY (SELECT DISTINCT ON
-- check_key, ORDER BY check_key, collected_at DESC) and then flattens
-- extracted_properties the way Object.assign does, so `winner_check` /
-- `winning_value` are the literal values the running platform holds.
--
-- `collision_class` is the answer to "are the colliding values meaningfully
-- different, or coincidentally compatible?":
--   'MEANINGFULLY DIFFERENT' -> real data is being destroyed (displayName_count
--                               class: 495 vs 104 vs 27 vs 18).
--   'identical values'       -> harmless today, but still a latent bug: the
--                               values agree by coincidence, not by contract.
--
-- Scope to one tenant by uncommenting the WHERE below; leave it out to sweep
-- every tenant at once.
-- ============================================================================
WITH latest AS (
  SELECT DISTINCT ON (tmp.tenant_id, tmp.check_key)
    tmp.tenant_id,
    tmp.check_key,
    tmp.status,
    tmp.extracted_properties
  FROM tenant_monitor_profiles tmp
  -- WHERE tmp.tenant_id = 'c4c814d4-3afe-441e-9145-62461d0a4fd3'
  ORDER BY tmp.tenant_id, tmp.check_key, tmp.collected_at DESC
), kv AS (
  SELECT l.tenant_id, l.check_key, l.status, e.key AS prop_name, e.value AS prop_value
  FROM latest l
  CROSS JOIN LATERAL jsonb_each(coalesce(l.extracted_properties, '{}'::jsonb)) AS e
)
SELECT
  kv.tenant_id,
  kv.prop_name,
  count(*)                                                    AS producing_checks,
  count(DISTINCT kv.prop_value)                               AS distinct_values,
  CASE WHEN count(DISTINCT kv.prop_value) > 1
       THEN 'MEANINGFULLY DIFFERENT'
       ELSE 'identical values' END                            AS collision_class,
  (array_agg(kv.check_key  ORDER BY kv.check_key DESC))[1]    AS winner_check,
  left((array_agg(kv.prop_value ORDER BY kv.check_key DESC))[1]::text, 120)
                                                              AS winning_value,
  string_agg(kv.check_key || ' = ' || left(kv.prop_value::text, 40), '  |  ' ORDER BY kv.check_key)
                                                              AS every_producer_and_value
FROM kv
GROUP BY kv.tenant_id, kv.prop_name
HAVING count(*) > 1
ORDER BY
  kv.tenant_id,
  (count(DISTINCT kv.prop_value) > 1) DESC,
  count(*) DESC,
  kv.prop_name;


-- ============================================================================
-- PART C — CONSUMER RISK: which signal_derivation_rules actually read a
--          colliding bare key TODAY
-- ----------------------------------------------------------------------------
-- evaluateRule() (tenant-signals.ts ~1117) reads mergedProfile two ways:
--   • rule_type = 'threshold'          -> mergedProfile[source_key || '__itemCount']
--                                         ALREADY NAMESPACED. Structurally immune.
--   • rule_type = 'profile_key_%'      -> mergedProfile[source_key]
--                                         BARE. Exposed to the collision.
--   • rule_type = 'findings_keyword'   -> does not read mergedProfile at all.
--
-- This part joins the exposed rules against the PART A collision set. Any row
-- returned is a rule that is, right now, silently evaluating another check's
-- data.
-- ============================================================================
WITH generated AS (
  SELECT c.key AS check_key, (p.value #>> '{}') || sfx.s AS prop_name
  FROM monitor_checks c
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.properties)='array' THEN c.properties ELSE '[]'::jsonb END) AS p(value)
  CROSS JOIN (VALUES ('_count'), ('_first'), ('_values')) AS sfx(s)
  WHERE c.status='active' AND coalesce(p.value #>> '{}','') <> ''
  UNION ALL
  SELECT c.key, m->>'targetField'
  FROM monitor_checks c
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.mapping)='array' THEN c.mapping ELSE '[]'::jsonb END) AS m
  WHERE c.status='active' AND coalesce(m->>'targetField','') <> ''
  UNION ALL
  SELECT c.key, '_itemCount'::text FROM monitor_checks c WHERE c.status='active'
), colliding AS (
  SELECT prop_name,
         count(DISTINCT check_key) AS producing_checks,
         max(check_key) AS alphabetical_winner,
         string_agg(DISTINCT check_key, ', ' ORDER BY check_key) AS all_producers
  FROM generated GROUP BY prop_name HAVING count(DISTINCT check_key) > 1
)
SELECT
  r.signal_key,
  r.rule_type,
  r.source_key,
  r.compare_value,
  col.producing_checks,
  col.alphabetical_winner  AS check_whose_value_the_rule_actually_reads,
  col.all_producers
FROM signal_derivation_rules r
JOIN colliding col ON col.prop_name = r.source_key
WHERE r.rule_type LIKE 'profile_key_%'
ORDER BY col.producing_checks DESC, r.signal_key;


-- ============================================================================
-- PART C2 — rule-type exposure census (denominator for the fix decision)
-- ============================================================================
SELECT
  rule_type,
  count(*) AS rules,
  count(DISTINCT source_key) AS distinct_source_keys,
  CASE
    WHEN rule_type = 'threshold'        THEN 'IMMUNE - reads <source_key>__itemCount (namespaced)'
    WHEN rule_type = 'findings_keyword' THEN 'IMMUNE - does not read mergedProfile'
    WHEN rule_type LIKE 'profile_key_%' THEN 'EXPOSED - reads a bare mergedProfile key'
    ELSE 'NOT IMPLEMENTED by evaluateRule() - always returns false (separate issue)'
  END AS exposure
FROM signal_derivation_rules
GROUP BY rule_type
ORDER BY count(*) DESC;


-- ============================================================================
-- PART D — DOCUMENT-GENERATION exposure
-- ----------------------------------------------------------------------------
-- document-engine.ts scopes {{profileSample}} with
-- `matchesProfilePattern(key, pattern)` — exact match, or prefix match when the
-- pattern ends in '*'. With `included_profile_key_patterns = '[]'` the engine
-- falls back to THE ENTIRE mergedProfile, collided winners included, and hands
-- it to the AI as ground truth.
--
-- D1: current scoping state of every document type.
-- ============================================================================
SELECT
  key,
  label,
  category,
  pipeline_category,
  jsonb_array_length(coalesce(included_profile_key_patterns, '[]'::jsonb)) AS profile_patterns,
  coalesce(included_profile_key_patterns, '[]'::jsonb)                     AS patterns,
  CASE
    WHEN jsonb_array_length(coalesce(included_profile_key_patterns, '[]'::jsonb)) = 0
      THEN 'UNSCOPED - receives the FULL mergedProfile, every collided winner included'
    ELSE 'scoped - see PART D2 for which colliding keys still get through'
  END AS exposure
FROM document_types
ORDER BY key;


-- ============================================================================
-- D2: for any document type that IS scoped, which colliding keys its patterns
--     still admit (exact + prefix semantics, case-insensitive, mirroring
--     matchesProfilePattern exactly).
-- ============================================================================
WITH generated AS (
  SELECT c.key AS check_key, (p.value #>> '{}') || sfx.s AS prop_name
  FROM monitor_checks c
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.properties)='array' THEN c.properties ELSE '[]'::jsonb END) AS p(value)
  CROSS JOIN (VALUES ('_count'), ('_first'), ('_values')) AS sfx(s)
  WHERE c.status='active' AND coalesce(p.value #>> '{}','') <> ''
  UNION ALL
  SELECT c.key, m->>'targetField'
  FROM monitor_checks c
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.mapping)='array' THEN c.mapping ELSE '[]'::jsonb END) AS m
  WHERE c.status='active' AND coalesce(m->>'targetField','') <> ''
  UNION ALL
  SELECT c.key, '_itemCount'::text FROM monitor_checks c WHERE c.status='active'
), colliding AS (
  SELECT prop_name, count(DISTINCT check_key) AS producing_checks, max(check_key) AS alphabetical_winner
  FROM generated GROUP BY prop_name HAVING count(DISTINCT check_key) > 1
), pats AS (
  SELECT dt.key AS doc_type, (pat.value #>> '{}') AS pattern
  FROM document_types dt
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(dt.included_profile_key_patterns, '[]'::jsonb)) AS pat(value)
)
SELECT
  p.doc_type,
  p.pattern,
  col.prop_name       AS colliding_key_admitted,
  col.producing_checks,
  col.alphabetical_winner AS value_actually_supplied_by
FROM pats p
-- starts_with()/= rather than LIKE: property names are full of '_', which LIKE
-- would treat as a single-character wildcard and silently over-match. This
-- mirrors matchesProfilePattern's real semantics (startsWith / ===, both
-- lower-cased) exactly.
JOIN colliding col
  ON (right(p.pattern, 1) = '*' AND starts_with(lower(col.prop_name), lower(left(p.pattern, length(p.pattern) - 1))))
  OR (right(p.pattern, 1) <> '*' AND lower(col.prop_name) = lower(p.pattern))
ORDER BY p.doc_type, col.producing_checks DESC, col.prop_name;


-- ============================================================================
-- PART E — BAKED-IN CORRUPTION: stored simulation profiles
-- ----------------------------------------------------------------------------
-- admin-signal-rules.ts (~2207-2227, "import from consented tenant") snapshots
-- buildTenantProfile()'s mergedProfile straight into a stored simulation
-- profile as jsonb. Any collision present at import time is FROZEN into that
-- row permanently — re-running the scan will not fix it. This part lists the
-- imported profiles and how many colliding key names each one carries, so we
-- know whether the fix also needs a re-import step.
--
-- (Table `signal_simulation_profiles`, column `profile_updates` — verified
-- against admin-signal-rules.ts's INSERT in the import-from-consented-tenant
-- route, not guessed.)
-- ============================================================================
WITH generated AS (
  SELECT c.key AS check_key, (p.value #>> '{}') || sfx.s AS prop_name
  FROM monitor_checks c
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.properties)='array' THEN c.properties ELSE '[]'::jsonb END) AS p(value)
  CROSS JOIN (VALUES ('_count'), ('_first'), ('_values')) AS sfx(s)
  WHERE c.status='active' AND coalesce(p.value #>> '{}','') <> ''
  UNION ALL
  SELECT c.key, m->>'targetField'
  FROM monitor_checks c
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.mapping)='array' THEN c.mapping ELSE '[]'::jsonb END) AS m
  WHERE c.status='active' AND coalesce(m->>'targetField','') <> ''
  UNION ALL
  SELECT c.key, '_itemCount'::text FROM monitor_checks c WHERE c.status='active'
), colliding AS (
  SELECT prop_name FROM generated GROUP BY prop_name HAVING count(DISTINCT check_key) > 1
)
SELECT
  sp.id,
  sp.name,
  count(*) FILTER (WHERE col.prop_name IS NOT NULL) AS colliding_keys_frozen_in,
  count(*)                                          AS total_keys
FROM signal_simulation_profiles sp
CROSS JOIN LATERAL jsonb_each(coalesce(sp.profile_updates, '{}'::jsonb)) AS e(key, value)
LEFT JOIN colliding col ON col.prop_name = e.key
GROUP BY sp.id, sp.name
ORDER BY 3 DESC NULLS LAST, sp.id;
