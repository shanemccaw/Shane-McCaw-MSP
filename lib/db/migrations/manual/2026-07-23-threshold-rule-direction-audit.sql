-- ============================================================================
-- Audit and Fix Threshold Rule Direction Across All Signals
-- Manual migration — Shane reviews the AUDIT output, then runs the FIX block.
--
-- No direct DB access in the Claude Code environment. The live rows are DB-only,
-- so this file does NOT hand-list them or guess directions from rule/check names.
-- Instead it derives each rule's correct direction AND its correct fix FROM THE
-- CHECK'S OWN severity_rules — the one authoritative, per-check encoding of "which
-- way is bad" — and produces the reviewable before/after table when Shane runs it
-- against live data. This is the ca-policy-count fix generalised correctly.
-- ============================================================================
--
-- THE BUG (confirmed live on signal.identity.ca-policy-count, already fixed
-- separately — do NOT re-fix that one):
--
--   A `signal_derivation_rules` row with rule_type='threshold' evaluates in
--   evaluateRule() (tenant-signals.ts:776) as:
--
--       fires  ⇔  mergedProfile[source_key || '__itemCount']  >  compare_value
--
--   It can ONLY fire when the check's item count is HIGH. Correct for a check
--   whose returned items ARE the problem (any risky sign-in, any orphaned team,
--   any anonymous link — "found some = bad"). BACKWARDS for a check that counts
--   something that SHOULD exist, where ZERO is the alarm (0 Conditional Access
--   policies, < 2 break-glass accounts, SSPR not configured): `> 0` can never
--   fire on 0, so the real gap is INVISIBLE — a silent false-negative finding.
--
-- WHY NAMES CAN'T DECIDE THIS, AND WHAT DOES:
--
--   `_itemCount` (monitor-executor.ts:357) is just `items.length` — the raw
--   count of rows the check's Graph query returned. Whether those items are
--   "problems" or "good things" is decided by each check's OWN config, DB-only.
--   Several checks are genuinely ambiguous from their key:
--     • identity:global-admin-count — healthy is a NON-ZERO band (2–4 w/ break-
--       glass, metrics.ts:133); neither > 0 NOR = 0 is right.
--     • identity:break-glass-health — counts HEALTHY break-glass accts (bad < 2)
--       or UNHEALTHY ones (bad > 0)? Opposite fixes.
--     • governance:access-review-* — completed (0 bad) vs overdue (high bad)?
--
--   The authoritative answer is the check's own `severity_rules`: an array of
--   {expression, severity} the executor evaluates (classifySeverity /
--   evalConditionGrammar, monitor-executor.ts) to decide what state is "bad."
--   REAL expression grammar (verified against the two live check rows in
--   2026-07-22-irm-alerts-monitor-check.sql:56 and
--   2026-07-22-project-online-sku-detection.sql:78):
--
--       "{{fieldName}} > 0"                         -- placeholders are {{...}}
--       "{{projectPlanFiveCount}} > 0 || {{...}} > 0"
--       "{{severity_values}} contains high"
--       "{{id_count}} > 0"                          -- property <name>_count key
--
--   The OPERATOR the check uses against its count field is the direction:
--       {{X}} >  N  / >= N  / length> N   → HIGH is bad → threshold `> 0` CORRECT
--       {{X}} == 0 / <  N   / <= N        → ZERO/LOW is bad → threshold `> 0` BACKWARDS
--   and X is the exact field to flip onto, N the real minimum to preserve.
--
-- SCOPE (locked to the task):
--   • ONLY rule_type='threshold' AND msp_id IS NULL.
--   • profile_key_* / findings_keyword rows — untouched (already encode direction
--     or aren't count-thresholds).
--   • MSP-scoped threshold rows (msp_id IS NOT NULL) — out of scope, untouched.
--   • crm.* / drift.* source_keys — dead for an unrelated source_key-format bug;
--     direction is moot there — untouched.
--   • Impact columns (weight, *_impact) were retuned separately — NEVER touched.
--     This migration only ever changes rule_type / source_key / compare_value.
-- ============================================================================


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ SHARED CLASSIFIER — used by every step below.                              │
-- │ Each step re-declares these CTEs so it is standalone-runnable. Read this    │
-- │ once; the logic is identical everywhere it appears.                        │
-- │                                                                            │
-- │   scoped        the in-scope threshold rules                               │
-- │   sev(rule_id,  each rule's check's severity blob, plus the FIRST severity  │
-- │       …)        clause we can parse into (field, operator, number).         │
-- │                                                                            │
-- │ The clause parser pulls `{{field}} OP number` out of the severity blob:    │
-- │   sev_field  — the {{…}} placeholder name the check compares                │
-- │   sev_op     — one of  >  >=  <  <=  ==                                     │
-- │   sev_num    — the numeric literal it compares against                     │
-- │ A blob with only `contains`/boolean/no-count clauses yields NULLs → the     │
-- │ rule is classed AMBIGUOUS_REVIEW (never auto-changed).                     │
-- └──────────────────────────────────────────────────────────────────────────┘


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ STEP 0 — Baseline counts. Last live trace put this near ~50–60; re-verify.  │
-- └──────────────────────────────────────────────────────────────────────────┘
SELECT
  count(*)                                                    AS threshold_platform_rules_in_scope_plus_out,
  count(*) FILTER (WHERE source_key NOT LIKE 'crm.%'
                     AND source_key NOT LIKE 'drift.%')       AS in_scope_rules,
  count(*) FILTER (WHERE source_key LIKE 'crm.%'
                      OR source_key LIKE 'drift.%')           AS crm_drift_out_of_scope,
  count(DISTINCT source_key)                                  AS distinct_check_keys_referenced
FROM signal_derivation_rules
WHERE rule_type = 'threshold' AND msp_id IS NULL;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ STEP 1 — THE AUDIT TABLE (READ-ONLY). The reviewable before/after.          │
-- └──────────────────────────────────────────────────────────────────────────┘
WITH scoped AS (
  SELECT r.id AS rule_id, r.signal_key, r.source_key, r.compare_value
  FROM signal_derivation_rules r
  WHERE r.rule_type = 'threshold' AND r.msp_id IS NULL
    AND r.source_key NOT LIKE 'crm.%' AND r.source_key NOT LIKE 'drift.%'
),
sev AS (
  SELECT
    s.rule_id, s.signal_key, s.source_key, s.compare_value,
    (c.key IS NOT NULL) AS check_exists,
    -- Original CASE preserved: the {{field}} names are camelCase profile keys
    -- (e.g. projectPlanFiveCount) that evaluateRule() looks up verbatim in the
    -- merged profile. Lower-casing the blob would corrupt the flip target, so we
    -- keep original case and use a case-insensitive char class [A-Za-z0-9_].
    COALESCE((
      SELECT string_agg(e->>'expression', '  ;;  ')
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(c.severity_rules)='array' THEN c.severity_rules ELSE '[]'::jsonb END) e
    ), '') AS sev_blob
  FROM scoped s
  LEFT JOIN monitor_checks c ON c.key = s.source_key
),
parsed AS (
  SELECT
    sev.*,
    -- FIRST "{{field}} OP number" clause in the blob, on the ORIGINAL-case blob
    -- so the captured field keeps its camelCase. [1]=field [2]=operator [3]=number.
    (regexp_match(sev_blob, '\{\{\s*([A-Za-z0-9_]+)\s*\}\}\s*(>=|<=|==|>|<)\s*([0-9]+)'))[1] AS sev_field,
    (regexp_match(sev_blob, '\{\{\s*([A-Za-z0-9_]+)\s*\}\}\s*(>=|<=|==|>|<)\s*([0-9]+)'))[2] AS sev_op,
    (regexp_match(sev_blob, '\{\{\s*([A-Za-z0-9_]+)\s*\}\}\s*(>=|<=|==|>|<)\s*([0-9]+)'))[3] AS sev_num
  FROM sev
)
SELECT
  p.rule_id, p.signal_key,
  p.source_key                                   AS before_source_key,
  'threshold'                                    AS before_rule_type,
  p.compare_value                                AS before_compare_value,
  -- ── classification ───────────────────────────────────────────────────────
  CASE
    WHEN NOT p.check_exists THEN 'NO_CHECK'
    WHEN p.source_key IN ('identity:global-admin-count','identity:break-glass-health')
      THEN 'BAND_METRIC'
    WHEN p.sev_op IS NULL THEN 'AMBIGUOUS_REVIEW'
    WHEN p.sev_op IN ('>','>=') THEN 'BAD_WHEN_PRESENT'
    WHEN p.sev_op IN ('<','<=','==') THEN 'BAD_WHEN_ABSENT'
    ELSE 'AMBIGUOUS_REVIEW'
  END AS direction,
  CASE
    WHEN NOT p.check_exists THEN 'NO_CHECK (source_key matches no monitor_checks row — dead rule, leave as-is)'
    WHEN p.source_key IN ('identity:global-admin-count','identity:break-glass-health')
      THEN 'BAND_REVIEW (healthy is a non-zero band; neither >0 nor =0 fits this fix''s pattern — out of scope)'
    WHEN p.sev_op IS NULL
      THEN 'AMBIGUOUS_REVIEW (severity_rules have no {{field}} OP number clause — read the expr, decide by hand)'
    WHEN p.sev_op IN ('>','>=') THEN 'CORRECT_AS_IS (check''s own severity fires on HIGH count)'
    WHEN p.sev_op IN ('<','<=','==') THEN 'NEEDS_FLIP (check''s own severity fires on ZERO/LOW count)'
    ELSE 'AMBIGUOUS_REVIEW'
  END AS verdict,
  -- ── the exact fix STEP 3 will apply, derived from the check's own severity ──
  CASE
    WHEN p.sev_op = '=='                       THEN 'profile_key_eq'
    WHEN p.sev_op IN ('<','<=')                THEN 'profile_key_lt'
    ELSE NULL
  END AS after_rule_type,
  CASE WHEN p.sev_op IN ('==','<','<=') THEN p.sev_field ELSE NULL END AS after_source_key,
  CASE
    WHEN p.sev_op = '=='  THEN '0'
    WHEN p.sev_op = '<'   THEN p.sev_num                       -- "< 2"  → profile_key_lt X 2
    WHEN p.sev_op = '<='  THEN (p.sev_num::int + 1)::text      -- "<= 1" → "< 2" (lt is strict)
    ELSE NULL
  END AS after_compare_value,
  p.sev_field AS check_severity_field, p.sev_op AS check_severity_op, p.sev_num AS check_severity_num,
  left(p.sev_blob, 300) AS check_severity_expr_sample
FROM parsed p
ORDER BY
  CASE
    WHEN NOT p.check_exists THEN 4
    WHEN p.source_key IN ('identity:global-admin-count','identity:break-glass-health') THEN 1
    WHEN p.sev_op IS NULL THEN 2
    WHEN p.sev_op IN ('<','<=','==') THEN 0     -- NEEDS_FLIP first
    ELSE 3
  END,
  p.signal_key, p.source_key;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ STEP 2 — WHY the fix flips onto the check's OWN severity field, not raw     │
-- │ __itemCount (read before running STEP 3).                                  │
-- │                                                                            │
-- │ A naive `profile_key_eq source_key||'__itemCount' = 0` would be a NEW bug:  │
-- │ mergeMonitorProfileRows() (tenant-signals.ts:326) sets                     │
-- │     mergedProfile[checkKey||'__itemCount'] = props._itemCount ?? 0         │
-- │ for the LATEST row of every check REGARDLESS of status, and the executor    │
-- │ writes itemCount=0 on status=error / consent_revoked / license_gap         │
-- │ (monitor-executor.ts:623/673/705). So `__itemCount = 0` is TRUE both when   │
-- │ the check genuinely found zero AND when it FAILED — a "zero is bad" signal  │
-- │ built on it would fire on every errored tenant. False-negative → false-     │
-- │ positive. Not acceptable.                                                  │
-- │                                                                            │
-- │ The check's severity field (the {{X}} it compares, e.g. {{caPolicyCount}}, │
-- │ {{id_count}}, {{projectPlanFiveCount}}) is a mapping/property value written │
-- │ only from a real OK response — the same status-aware kind of key the        │
-- │ ca-policy fix used (conditionalAccessPolicyCount, ok-derived). Flipping     │
-- │ onto THAT field, with the check's own operator/threshold, is the fix.      │
-- │                                                                            │
-- │ WHY THE NAMED FIELD IS AUTOMATICALLY STATUS-SAFE: on status = error /       │
-- │ consent_revoked / license_gap the executor writes extractedProperties = {}  │
-- │ (monitor-executor.ts:632/682/714), so the mapping field is ABSENT from the  │
-- │ merged profile — not 0. evaluateRule's profile_key_eq does                  │
-- │ String(profile[X]) === '0', and String(undefined) === '0' is FALSE          │
-- │ (tenant-signals.ts:759), so an errored check does NOT false-fire the eq-0    │
-- │ gap rule. The raw __itemCount, by contrast, is force-set to 0 on those same │
-- │ error rows — which is exactly the trap this flip avoids.                    │
-- │                                                                            │
-- │ Preview EXACTLY the rows STEP 3 will change:                               │
-- └──────────────────────────────────────────────────────────────────────────┘
WITH scoped AS (
  SELECT r.id AS rule_id, r.signal_key, r.source_key, r.compare_value
  FROM signal_derivation_rules r
  WHERE r.rule_type = 'threshold' AND r.msp_id IS NULL
    AND r.source_key NOT LIKE 'crm.%' AND r.source_key NOT LIKE 'drift.%'
    AND r.source_key NOT IN ('identity:global-admin-count','identity:break-glass-health')
),
parsed AS (
  SELECT s.rule_id, s.signal_key, s.source_key, s.compare_value,
    (regexp_match(COALESCE((SELECT string_agg(e->>'expression','  ;;  ')
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.severity_rules)='array' THEN c.severity_rules ELSE '[]'::jsonb END) e),''),
      '\{\{\s*([A-Za-z0-9_]+)\s*\}\}\s*(>=|<=|==|>|<)\s*([0-9]+)')) AS m
  FROM scoped s JOIN monitor_checks c ON c.key = s.source_key
)
SELECT
  rule_id, signal_key,
  'threshold' AS before_rule_type, source_key AS before_source_key, compare_value AS before_compare_value,
  CASE m[2] WHEN '==' THEN 'profile_key_eq' ELSE 'profile_key_lt' END AS after_rule_type,
  m[1] AS after_source_key,
  CASE m[2] WHEN '==' THEN '0' WHEN '<' THEN m[3] WHEN '<=' THEN (m[3]::int + 1)::text END AS after_compare_value
FROM parsed
WHERE m IS NOT NULL AND m[2] IN ('==','<','<=')
ORDER BY signal_key, source_key;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ STEP 3 — THE AUTO-FIX (WRITES). Run ONLY after reviewing STEP 1 + STEP 2.   │
-- │ Transactioned with a RETURNING receipt. Flips ONLY rules the check's own    │
-- │ severity proves are zero/low-is-bad, onto that check's own severity field,  │
-- │ preserving the check's operator/threshold. Never touches band/no-check/     │
-- │ ambiguous rules, impacts, MSP rows, or crm/drift rows. Idempotent (an       │
-- │ already-flipped row is no longer rule_type='threshold').                   │
-- │                                                                            │
-- │ ►► If STEP 1/STEP 2 show NO NEEDS_FLIP rows, DO NOT run this — it means      │
-- │    every in-scope threshold rule is already correctly high-is-bad and the   │
-- │    only direction bug was ca-policy-count (already fixed). A valid outcome. │
-- └──────────────────────────────────────────────────────────────────────────┘
-- BEGIN;
--
-- WITH scoped AS (
--   SELECT r.id AS rule_id, r.source_key
--   FROM signal_derivation_rules r
--   WHERE r.rule_type = 'threshold' AND r.msp_id IS NULL
--     AND r.source_key NOT LIKE 'crm.%' AND r.source_key NOT LIKE 'drift.%'
--     AND r.source_key NOT IN ('identity:global-admin-count','identity:break-glass-health')
-- ),
-- parsed AS (
--   SELECT s.rule_id,
--     (regexp_match(COALESCE((SELECT string_agg(e->>'expression','  ;;  ')
--       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.severity_rules)='array' THEN c.severity_rules ELSE '[]'::jsonb END) e),''),
--       '\{\{\s*([A-Za-z0-9_]+)\s*\}\}\s*(>=|<=|==|>|<)\s*([0-9]+)')) AS m
--   FROM scoped s JOIN monitor_checks c ON c.key = s.source_key
-- ),
-- to_flip AS (
--   SELECT rule_id,
--     m[1] AS new_source_key,
--     CASE m[2] WHEN '==' THEN 'profile_key_eq' ELSE 'profile_key_lt' END AS new_rule_type,
--     CASE m[2] WHEN '==' THEN '0' WHEN '<' THEN m[3] WHEN '<=' THEN (m[3]::int + 1)::text END AS new_compare_value
--   FROM parsed
--   WHERE m IS NOT NULL AND m[2] IN ('==','<','<=')
-- )
-- UPDATE signal_derivation_rules r
-- SET rule_type     = f.new_rule_type,
--     source_key    = f.new_source_key,
--     compare_value = f.new_compare_value,
--     updated_at    = now()
-- FROM to_flip f
-- WHERE r.id = f.rule_id
--   AND r.rule_type = 'threshold'      -- guard: only flip a still-threshold row
--   AND r.msp_id IS NULL
-- RETURNING r.id, r.signal_key, r.rule_type AS new_rule_type, r.source_key AS new_source_key, r.compare_value AS new_compare_value;
--
-- -- If the RETURNING receipt matches STEP 2's preview exactly:  COMMIT;  else:  ROLLBACK;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ STEP 4 — POST-FIX VERIFICATION (READ-ONLY). Run after COMMIT.               │
-- └──────────────────────────────────────────────────────────────────────────┘
-- (a) No in-scope threshold rule should remain whose check's severity fires on
--     a zero/low count. Expect 0.
WITH scoped AS (
  SELECT r.id, r.source_key FROM signal_derivation_rules r
  WHERE r.rule_type = 'threshold' AND r.msp_id IS NULL
    AND r.source_key NOT LIKE 'crm.%' AND r.source_key NOT LIKE 'drift.%'
    AND r.source_key NOT IN ('identity:global-admin-count','identity:break-glass-health')
)
SELECT count(*) AS unflipped_zero_is_bad_rules_should_be_zero
FROM scoped s JOIN monitor_checks c ON c.key = s.source_key
WHERE (regexp_match(COALESCE((SELECT string_agg(e->>'expression','  ;;  ')
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.severity_rules)='array' THEN c.severity_rules ELSE '[]'::jsonb END) e),''),
        '\{\{\s*[A-Za-z0-9_]+\s*\}\}\s*(==|<=|<)\s*[0-9]+')) IS NOT NULL;

-- (b) The rules STEP 3 flipped: confirm they now read profile_key_eq/_lt against
--     a real severity field.
SELECT r.id, r.signal_key, r.rule_type, r.source_key, r.compare_value, r.updated_at
FROM signal_derivation_rules r
WHERE r.rule_type IN ('profile_key_eq','profile_key_lt')
  AND r.msp_id IS NULL
  AND r.updated_at > now() - interval '10 minutes'
ORDER BY r.updated_at DESC;

-- (c) Sanity: the flip fields must be keys the merge actually produces. Each
--     new source_key should appear as a mapping targetField OR a <prop>_count
--     property key on its (old) check. If a row here shows produced=false, that
--     field isn't written by any OK response — bring it back as a bridge task
--     (like ca-policy's conditionalAccessPolicyCount), don't leave it dark.
--     Run this BEFORE the flip too, by reading STEP 2's after_source_key values.
SELECT
  c.key AS check_key,
  m.after_source_key,
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.mapping)='array' THEN c.mapping ELSE '[]'::jsonb END) mm
    WHERE mm->>'targetField' = m.after_source_key
  )
  OR EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(c.properties)='array' THEN c.properties ELSE '[]'::jsonb END) pp
    WHERE m.after_source_key = pp || '_count'
  ) AS field_is_produced_by_check
FROM (
  -- re-derive STEP 2's (check_key, after_source_key) pairs
  WITH scoped AS (
    SELECT r.source_key FROM signal_derivation_rules r
    WHERE r.rule_type = 'threshold' AND r.msp_id IS NULL
      AND r.source_key NOT LIKE 'crm.%' AND r.source_key NOT LIKE 'drift.%'
      AND r.source_key NOT IN ('identity:global-admin-count','identity:break-glass-health')
  )
  SELECT DISTINCT s.source_key AS check_key,
    (regexp_match(COALESCE((SELECT string_agg(e->>'expression','  ;;  ')
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cc.severity_rules)='array' THEN cc.severity_rules ELSE '[]'::jsonb END) e),''),
      '\{\{\s*([A-Za-z0-9_]+)\s*\}\}\s*(==|<=|<)\s*[0-9]+'))[1] AS after_source_key
  FROM scoped s JOIN monitor_checks cc ON cc.key = s.source_key
) m
JOIN monitor_checks c ON c.key = m.check_key
WHERE m.after_source_key IS NOT NULL;
