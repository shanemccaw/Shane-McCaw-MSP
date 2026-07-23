-- ============================================================================
-- Close Signal Coverage Gaps Across All Real Monitor Checks
-- Manual migration — Shane reviews the AUDIT output, then runs the GENERATE
-- block. (No direct DB access in the Claude Code environment — the actual live
-- monitor_checks catalog + the ~198 signal_derivation_rules are DB-only runtime
-- data, NOT in source control. This file therefore does the audit AND the
-- rule generation IN SQL, against the live data, so every decision is made from
-- each check's OWN real config — its severity_rules, mapping and key domain —
-- not guessed from a name. This is the same "trace the real implementation, in
-- SQL, run by Shane" shape as 2026-07-23-threshold-rule-direction-audit.sql.)
-- ============================================================================
--
-- WHAT THIS TASK IS (and how it differs from the direction-audit task):
--
--   • The DIRECTION-AUDIT task (2026-07-23-threshold-rule-direction-audit.sql)
--     fixes EXISTING rules that fire in the WRONG direction. It never adds rows.
--   • THIS task finds real, active monitor_checks that have ZERO
--     signal_derivation_rules pointing at them AT ALL — real Graph data is
--     being collected (the check runs, extracted_properties gets populated) but
--     nothing ever evaluates it into a signal, so that data is invisible to
--     scoring, upsells, and the assessment radar entirely. This task ONLY ADDS
--     new rows for checks that currently have none.
--
--   NON-OVERLAP GUARANTEE: every write here is guarded by
--     NOT EXISTS (a rule already fed by this check)
--   using the EXACT same producible-key + fed-by logic as
--   2026-07-23-pillar-coverage-live-TRACE.sql (buildProducibleProfileKeys() /
--   ruleIsFedByPackage() in pillar-coverage.ts). So a check that already has a
--   rule — even a WRONG-DIRECTION one the other task will fix — is treated as
--   COVERED and left entirely alone here. The two files cannot double-cover a
--   check or fight over the same row.
--
-- THE FEEDING MODEL (mirrors pillar-coverage.ts exactly — see that file's header
-- and 2026-07-23-pillar-coverage-live-TRACE.sql Q3/Q4). A check "feeds" a rule
-- when:
--   • threshold rule       — its source_key IS the check key (evaluateRule reads
--                            profile[source_key||'__itemCount'], stamped per check)
--   • profile_key_* rule   — its source_key is one of the keys the check PRODUCES:
--                            a mapping[].targetField, a <prop>_count/_first/_values
--                            raw-extraction key, the synthetic <checkKey>__itemCount,
--                            a bridged legacy key whose producer check is present,
--                            or a runtime license-gap flag (hasAADP1orP2/hasDefender)
--                            producible by any Graph (non-script) check
--   • findings_keyword rule— its source_key (keyword) appears case-insensitively
--                            inside a check key (deriveMonitorFindings strings
--                            start with the check key)
--
-- DIRECTION DISCIPLINE (same as the parallel task — do NOT default to a generic
-- threshold-on-itemCount that could repeat the direction bug class):
--   For each zero-coverage check we classify BY ITS OWN severity_rules whether
--   HIGH-count is bad or ZERO/LOW-count is bad, then pick the rule accordingly:
--     • HIGH-is-bad (severity expr uses count/length  >  / >= / contains) —
--       the returned items ARE the problem (risky sign-ins, anonymous links,
--       stale guests). Rule = `threshold` on the bare check key, compare 0
--       (evaluateRule fires when itemCount > 0). Correct + safe: a check that
--       errors writes itemCount=0, so `> 0` does NOT false-fire on failure.
--     • ZERO/LOW-is-bad (severity expr uses count/length  ==0 / < / <=) —
--       a thing that SHOULD exist is missing (0 CA policies, 0 break-glass).
--       A raw `__itemCount = 0` here is UNSAFE: mergeMonitorProfileRows stamps
--       `<checkKey>__itemCount` for EVERY row regardless of status, defaulting to
--       0 when the row carries no properties — which is exactly what an
--       error/consent_revoked/requires_script row writes — so it would
--       false-fire on every failed tenant (this is exactly why the ca-policy fix
--       flipped onto a status-aware bridged key). We therefore only build a
--       zero-is-bad rule when the check exposes a STATUS-AWARE named count
--       (a mapping[].targetField with a count* transform, derived from an ok
--       row) — rule = `profile_key_eq <thatField> = 0`. If no such key exists,
--       we DO NOT fabricate one: the check is reported as a real gap that needs
--       a status-aware bridge key (a separate, honest fix), not closed with a
--       false-positive rule.
--       WHY A mapping targetField IS SAFE HERE (code-verified, monitor-executor.ts):
--         error / consent_revoked / requires_script rows write
--         `extractedProperties: {}` (monitor-executor.ts:533/544/632/713/809/937),
--         so the mapping targetField key is ABSENT from the merged profile on a
--         failed check — and profile_key_eq compares String(undefined) === '0',
--         which is FALSE. It therefore cannot false-fire on a failed tenant, unlike
--         the raw `<checkKey>__itemCount`, which mergeMonitorProfileRows stamps to
--         0 for EVERY row regardless of status (tenant-signals.ts:326).
--       ONE REMAINING EDGE CASE, called out honestly: a `license_gap` row DOES
--         write the real `extracted` object (monitor-executor.ts:671/682), so a
--         license-gapped tenant can legitimately show a mapping count of 0 and the
--         zero-is-bad rule WILL fire for it. That is arguably correct (the
--         capability genuinely is absent), but it reads as a config gap rather than
--         a licensing gap. If Shane prefers those separated, pair the rule with the
--         existing security:lacks_* license-gap signals rather than changing it.
--     • BAND metric (a healthy NON-ZERO range — global-admin-count 2–4,
--       break-glass 2+) — neither >0 nor =0 is right; reported for a hand-built
--       band rule, NOT auto-generated (same carve-out as the direction task).
--     • AMBIGUOUS (severity_rules don't compare a count we can read, or are
--       empty) — reported "real check, no meaningful rule condition exists",
--       NOT fabricated.
--
-- PILLAR + IMPACT DISCIPLINE (matches the retuning applied to the other ~198
-- rules — ONE dominant pillar for the check's real domain, small 0–2 spillover,
-- never a flat placeholder). The dominant pillar is derived from the check-key
-- DOMAIN PREFIX (`<domain>:<check-name>`), which is the real, stable domain
-- signal in this catalog (`identity:ca-policy-count`, `security:secure-score`,
-- `licensing:sku-utilization`, …):
--     security:  , identity:                 -> dominant SECURITY   (identity is a security sub-domain)
--     governance: , appgov:                  -> dominant GOVERNANCE
--     compliance:                            -> dominant COMPLIANCE
--     adoption:                              -> dominant ADOPTION
--     copilot:                               -> dominant COPILOT
--     architecture: , m365:                  -> dominant ARCHITECTURE (platform/service health)
--     licensing:                             -> dominant LICENSING
--   Dominant magnitude scales with the check's own worst severity
--   (critical 60 / high 45 / warning|medium 30 / else 20); realistic small
--   spillover (0–2) is added only to genuinely-adjacent pillars per domain
--   (e.g. security↔compliance, licensing↔architecture, adoption↔copilot), never
--   a flat value across all seven. severity/category/pillar/confidence/weight
--   are set consistently with how the other rules are populated.
--   signal_key follows the existing signal.{domain}.{check-name} convention.
--
--   CATEGORY vs PILLAR (a real finding, not a stylistic choice): `category` is
--   what scopes a rule into an engine's Configuration tab — engine-registry.ts
--   matches it against each engine's `categoryPrefix`, and only 'security' and
--   'governance' are registered among the pillars (the Security Engine owns
--   'security'; the Architecture Health Engine owns 'governance' AND rolls up
--   compliance/adoption/copilot/architecture/licensing under that one prefix).
--   Writing a raw domain like 'licensing'/'identity'/'m365' into `category`
--   would match NO engine and leave the rule invisible/uneditable in every
--   Configuration tab. So category = the OWNING ENGINE's prefix, while the
--   precise pillar is carried on the separate `pillar` field (and the impacts).
--
-- Safe to run repeatedly: every INSERT is NOT-EXISTS / ON CONFLICT guarded; the
-- generator's guard is the fed-by check itself, so a second run is a no-op once
-- the gaps are closed.
-- ============================================================================


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ SHARED CTE — reused verbatim by every query below. Produces, per active    │
-- │ check, everything needed to decide coverage + direction + pillar.          │
-- │                                                                            │
-- │ NOTE ON PACKAGE SCOPE: pillar-coverage.ts computes producible keys FROM A   │
-- │ PACKAGE's checks. Coverage-of-a-CHECK (this task) is package-independent:   │
-- │ a check is "covered" iff SOME platform rule (msp_id IS NULL) is fed by IT   │
-- │ specifically. So producible keys here are computed per-check (the keys THAT │
-- │ ONE check produces), and a rule is "fed by this check" iff its source_key   │
-- │ is in that check's own producible set (or, for threshold, equals its key;   │
-- │ for findings_keyword, is a substring of its key). This is the exact same    │
-- │ ruleIsFedByPackage() logic narrowed to a single check — which is the honest │
-- │ definition of "this check feeds this rule".                                 │
-- └──────────────────────────────────────────────────────────────────────────┘

-- ─── Q0. Baseline counts (READ-ONLY) ─────────────────────────────────────────
SELECT
  (SELECT count(*) FROM monitor_checks WHERE status = 'active')                   AS active_checks,
  (SELECT count(*) FROM signal_derivation_rules WHERE msp_id IS NULL)             AS platform_rules,
  (SELECT count(DISTINCT source_key) FROM signal_derivation_rules WHERE msp_id IS NULL) AS distinct_source_keys;
-- Expect active_checks ≈ 120–122 per the prior live trace. If it is materially
-- different, STOP and reconcile before trusting the gap list below.


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ PART A — THE AUDIT (READ-ONLY). Every active check, is it fed by ANY rule?  │
-- │ This is the reviewable gap list Shane signs off on before PART B writes.    │
-- └──────────────────────────────────────────────────────────────────────────┘
WITH active AS (
  SELECT c.key, c.label, c.mapping, c.properties, c.severity_rules,
         c.requires_customer_script, c.engines
  FROM monitor_checks c
  WHERE c.status = 'active'
),
-- Per-check producible profile keys (mirrors buildProducibleProfileKeys for ONE check).
producible AS (
  SELECT a.key AS check_key, a.key AS profile_key FROM active a          -- bare check key
  UNION
  SELECT a.key, a.key || '__itemCount' FROM active a                     -- synthetic itemCount
  UNION
  SELECT a.key, m.elem->>'targetField'                                   -- mapping targetFields
  FROM active a, LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(a.mapping)='array' THEN a.mapping ELSE '[]'::jsonb END) AS m(elem)
  WHERE m.elem->>'targetField' IS NOT NULL
  UNION
  SELECT a.key, p.prop || suffix.s                                       -- raw property extraction keys
  FROM active a,
       LATERAL jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(a.properties)='array' THEN a.properties ELSE '[]'::jsonb END) AS p(prop),
       LATERAL (VALUES ('_count'),('_first'),('_values')) AS suffix(s)
  UNION
  SELECT a.key, f.k                                                      -- runtime license-gap flags
  FROM active a, (VALUES ('hasAADP1orP2'),('hasDefender')) AS f(k)
  WHERE a.requires_customer_script = false
  UNION
  SELECT b.producer, b.k                                                 -- bridged legacy keys (per producer)
  FROM (VALUES
    ('conditionalAccessPolicyCount',   'identity:ca-policy-count'),
    ('conditionalAccessPoliciesCount', 'identity:ca-policy-count'),
    ('securityScore',                  'security:secure-score')
  ) AS b(k, producer)
  WHERE EXISTS (SELECT 1 FROM active WHERE key = b.producer)
),
-- Is each check fed by at least one platform rule? (ruleIsFedByPackage per-check.)
fed AS (
  SELECT a.key AS check_key,
    EXISTS (
      SELECT 1 FROM signal_derivation_rules r
      WHERE r.msp_id IS NULL
        AND (
          (r.rule_type = 'threshold' AND r.source_key = a.key)
          OR (r.rule_type = 'findings_keyword' AND r.source_key <> ''
              AND a.key ILIKE '%' || r.source_key || '%')
          OR (r.rule_type NOT IN ('threshold','findings_keyword')
              AND EXISTS (SELECT 1 FROM producible p
                          WHERE p.check_key = a.key AND p.profile_key = r.source_key))
        )
    ) AS is_fed
  FROM active a
)
SELECT
  a.key                          AS check_key,
  a.label,
  a.requires_customer_script,
  a.engines,
  -- the check's own worst severity + whether its severity_rules compare a count
  lower(COALESCE(
    (SELECT string_agg(e->>'expression', ' ;; ')
     FROM jsonb_array_elements(
       CASE WHEN jsonb_typeof(a.severity_rules)='array' THEN a.severity_rules ELSE '[]'::jsonb END) e),
    '')) AS severity_expr_blob,
  -- first status-aware count targetField (for the zero-is-bad safe path)
  (SELECT (m->>'targetField')
   FROM jsonb_array_elements(
     CASE WHEN jsonb_typeof(a.mapping)='array' THEN a.mapping ELSE '[]'::jsonb END) m
   WHERE (m->>'transform') IN
     ('count','countTruthy','countEquals','countFalse','countDuplicates','countIfLastSignInOlderThan')
   ORDER BY (m->>'targetField') LIMIT 1) AS first_count_target_field
FROM active a
JOIN fed ON fed.check_key = a.key
WHERE fed.is_fed = false
ORDER BY a.key;
-- ►► THIS is the definitive zero-coverage gap list. Read it. Every row here is a
--    real active check that collects Graph data no signal ever evaluates. If it
--    returns ZERO rows, coverage is already complete — do NOT run PART B, and
--    report "no gaps: all active checks are fed by ≥1 rule" (a valid outcome).


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ PART A2 — PER-GAP CLASSIFICATION (READ-ONLY). For every gap check from      │
-- │ PART A, derive exactly what PART B WOULD build (or why it can't safely),    │
-- │ so the whole write is reviewable up front. Nothing here writes.            │
-- └──────────────────────────────────────────────────────────────────────────┘
WITH active AS (
  SELECT c.key, c.label, c.mapping, c.properties, c.severity_rules,
         c.requires_customer_script
  FROM monitor_checks c WHERE c.status = 'active'
),
producible AS (
  SELECT a.key AS check_key, a.key AS profile_key FROM active a
  UNION SELECT a.key, a.key || '__itemCount' FROM active a
  UNION SELECT a.key, m.elem->>'targetField'
        FROM active a, LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(a.mapping)='array' THEN a.mapping ELSE '[]'::jsonb END) AS m(elem)
        WHERE m.elem->>'targetField' IS NOT NULL
  UNION SELECT a.key, p.prop || suffix.s
        FROM active a, LATERAL jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(a.properties)='array' THEN a.properties ELSE '[]'::jsonb END) AS p(prop),
             LATERAL (VALUES ('_count'),('_first'),('_values')) AS suffix(s)
  UNION SELECT a.key, f.k FROM active a, (VALUES ('hasAADP1orP2'),('hasDefender')) AS f(k)
        WHERE a.requires_customer_script = false
  UNION SELECT b.producer, b.k
        FROM (VALUES ('conditionalAccessPolicyCount','identity:ca-policy-count'),
                     ('conditionalAccessPoliciesCount','identity:ca-policy-count'),
                     ('securityScore','security:secure-score')) AS b(k, producer)
        WHERE EXISTS (SELECT 1 FROM active WHERE key = b.producer)
),
gaps AS (
  SELECT a.*
  FROM active a
  WHERE NOT EXISTS (
    SELECT 1 FROM signal_derivation_rules r
    WHERE r.msp_id IS NULL
      AND (
        (r.rule_type = 'threshold' AND r.source_key = a.key)
        OR (r.rule_type = 'findings_keyword' AND r.source_key <> ''
            AND a.key ILIKE '%' || r.source_key || '%')
        OR (r.rule_type NOT IN ('threshold','findings_keyword')
            AND EXISTS (SELECT 1 FROM producible p
                        WHERE p.check_key = a.key AND p.profile_key = r.source_key))
      )
  )
),
classified AS (
  SELECT
    g.key AS check_key,
    g.label,
    split_part(g.key, ':', 1) AS domain,
    lower(COALESCE(
      (SELECT string_agg(e->>'expression', ' ;; ')
       FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(g.severity_rules)='array' THEN g.severity_rules ELSE '[]'::jsonb END) e),
      '')) AS sev_blob,
    -- worst severity the check itself declares (drives dominant impact magnitude)
    (SELECT max(
        CASE lower(e->>'severity')
          WHEN 'critical' THEN 4 WHEN 'high' THEN 3
          WHEN 'warning' THEN 2 WHEN 'medium' THEN 2
          WHEN 'low' THEN 1 WHEN 'info' THEN 1 WHEN 'informational' THEN 1 ELSE 0 END)
     FROM jsonb_array_elements(
       CASE WHEN jsonb_typeof(g.severity_rules)='array' THEN g.severity_rules ELSE '[]'::jsonb END) e
    ) AS worst_sev_rank,
    (SELECT (m->>'targetField')
     FROM jsonb_array_elements(
       CASE WHEN jsonb_typeof(g.mapping)='array' THEN g.mapping ELSE '[]'::jsonb END) m
     WHERE (m->>'transform') IN
       ('count','countTruthy','countEquals','countFalse','countDuplicates','countIfLastSignInOlderThan')
     ORDER BY (m->>'targetField') LIMIT 1) AS count_target
  FROM gaps g
),
directed AS (
  SELECT c.*,
    CASE
      -- band metrics: hand-built rule needed, not auto-generated
      WHEN c.check_key IN ('identity:global-admin-count','identity:break-glass-health')
        THEN 'BAND_METRIC'
      -- zero/low-is-bad
      WHEN c.sev_blob ~ '(_itemcount|count)\s*(==|<=|<)\s*0'
        OR c.sev_blob ~ 'length\s*(==|<=|<)\s*0?'
        OR c.sev_blob ~ '(_itemcount|count)\s*(<|<=)\s*[1-9]'
        THEN 'ZERO_IS_BAD'
      -- high-is-bad (the common case): count/length > / >=, or a `contains` match
      WHEN c.sev_blob ~ '(_itemcount|count)\s*(>|>=)'
        OR c.sev_blob ~ 'length\s*(>|>=)'
        OR c.sev_blob ~ 'contains'
        THEN 'HIGH_IS_BAD'
      ELSE 'AMBIGUOUS'
    END AS direction
  FROM classified c
)
SELECT
  d.check_key, d.domain, d.label, d.worst_sev_rank, d.direction, d.count_target,
  -- dominant pillar for the domain
  CASE d.domain
    WHEN 'security' THEN 'security' WHEN 'identity' THEN 'security'
    WHEN 'governance' THEN 'governance' WHEN 'appgov' THEN 'governance'
    WHEN 'compliance' THEN 'compliance'
    WHEN 'adoption' THEN 'adoption'
    WHEN 'copilot' THEN 'copilot'
    WHEN 'architecture' THEN 'architecture' WHEN 'm365' THEN 'architecture'
    WHEN 'licensing' THEN 'licensing'
    ELSE '(unmapped domain — review)'
  END AS dominant_pillar,
  -- what PART B will do
  CASE d.direction
    WHEN 'HIGH_IS_BAD'  THEN 'BUILD threshold(' || d.check_key || ' > 0)'
    WHEN 'ZERO_IS_BAD'  THEN
      CASE WHEN d.count_target IS NOT NULL
           THEN 'BUILD profile_key_eq(' || d.count_target || ' = 0)'
           ELSE 'REPORT ONLY — zero-is-bad but no status-aware count field (needs a bridge key; do NOT fabricate)'
      END
    WHEN 'BAND_METRIC'  THEN 'REPORT ONLY — band metric (healthy non-zero range; needs a hand-built band rule)'
    ELSE 'REPORT ONLY — no readable count condition in severity_rules (no meaningful rule condition exists)'
  END AS action,
  left(d.sev_blob, 200) AS severity_expr_sample
FROM directed d
ORDER BY
  CASE d.direction WHEN 'HIGH_IS_BAD' THEN 0 WHEN 'ZERO_IS_BAD' THEN 1
                   WHEN 'BAND_METRIC' THEN 2 ELSE 3 END,
  d.domain, d.check_key;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ PART B — GENERATE THE NEW RULES (WRITES). Run ONLY after reviewing PART A / │
-- │ PART A2. Wrapped in a transaction with a RETURNING receipt. It builds ONE   │
-- │ real signal_derivation_rules row (inside its own OR group) per gap check    │
-- │ that PART A2 classified BUILDABLE (HIGH_IS_BAD, or ZERO_IS_BAD with a        │
-- │ status-aware count field). It NEVER touches band metrics, ambiguous checks, │
-- │ zero-is-bad-without-a-safe-key checks, existing rows, MSP rows, or impacts  │
-- │ on any existing rule.                                                       │
-- │                                                                            │
-- │ Idempotent: the fed-by guard (same as PART A) means an already-covered      │
-- │ check — including one covered by a row PART B added on a prior run — is      │
-- │ skipped, so re-running is a no-op.                                          │
-- └──────────────────────────────────────────────────────────────────────────┘
-- BEGIN;
--
-- DO $$
-- DECLARE
--   rec         record;
--   v_domain    text;
--   v_name      text;
--   v_signal    text;
--   v_pillar    text;
--   v_category  text;          -- owning-engine category prefix ('security' | 'governance')
--   v_dom_imp   integer;       -- dominant-pillar impact magnitude
--   v_severity  text;
--   v_group_id  integer;
--   v_rule_type text;
--   v_src       text;
--   v_cmp       text;
--   -- per-pillar impacts, defaulted to 0, dominant + small spillover set below
--   gi int; si int; ci int; ai int; coi int; archi int; li int;
-- BEGIN
--   FOR rec IN
--     WITH active AS (
--       SELECT c.key, c.label, c.mapping, c.properties, c.severity_rules, c.requires_customer_script
--       FROM monitor_checks c WHERE c.status = 'active'
--     ),
--     producible AS (
--       SELECT a.key AS check_key, a.key AS profile_key FROM active a
--       UNION SELECT a.key, a.key || '__itemCount' FROM active a
--       UNION SELECT a.key, m.elem->>'targetField'
--             FROM active a, LATERAL jsonb_array_elements(
--               CASE WHEN jsonb_typeof(a.mapping)='array' THEN a.mapping ELSE '[]'::jsonb END) AS m(elem)
--             WHERE m.elem->>'targetField' IS NOT NULL
--       UNION SELECT a.key, p.prop || suffix.s
--             FROM active a, LATERAL jsonb_array_elements_text(
--                    CASE WHEN jsonb_typeof(a.properties)='array' THEN a.properties ELSE '[]'::jsonb END) AS p(prop),
--                  LATERAL (VALUES ('_count'),('_first'),('_values')) AS suffix(s)
--       UNION SELECT a.key, f.k FROM active a, (VALUES ('hasAADP1orP2'),('hasDefender')) AS f(k)
--             WHERE a.requires_customer_script = false
--       UNION SELECT b.producer, b.k
--             FROM (VALUES ('conditionalAccessPolicyCount','identity:ca-policy-count'),
--                          ('conditionalAccessPoliciesCount','identity:ca-policy-count'),
--                          ('securityScore','security:secure-score')) AS b(k, producer)
--             WHERE EXISTS (SELECT 1 FROM active WHERE key = b.producer)
--     ),
--     gaps AS (
--       SELECT a.* FROM active a
--       WHERE NOT EXISTS (
--         SELECT 1 FROM signal_derivation_rules r
--         WHERE r.msp_id IS NULL
--           AND (
--             (r.rule_type = 'threshold' AND r.source_key = a.key)
--             OR (r.rule_type = 'findings_keyword' AND r.source_key <> '' AND a.key ILIKE '%' || r.source_key || '%')
--             OR (r.rule_type NOT IN ('threshold','findings_keyword')
--                 AND EXISTS (SELECT 1 FROM producible p WHERE p.check_key = a.key AND p.profile_key = r.source_key))
--           )
--       )
--     )
--     SELECT
--       g.key AS check_key, g.label,
--       split_part(g.key, ':', 1) AS domain,
--       lower(COALESCE((SELECT string_agg(e->>'expression',' ;; ')
--         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(g.severity_rules)='array' THEN g.severity_rules ELSE '[]'::jsonb END) e),'')) AS sev_blob,
--       (SELECT max(CASE lower(e->>'severity')
--           WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'warning' THEN 2 WHEN 'medium' THEN 2
--           WHEN 'low' THEN 1 WHEN 'info' THEN 1 WHEN 'informational' THEN 1 ELSE 0 END)
--        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(g.severity_rules)='array' THEN g.severity_rules ELSE '[]'::jsonb END) e) AS worst_sev_rank,
--       (SELECT (m->>'targetField')
--        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(g.mapping)='array' THEN g.mapping ELSE '[]'::jsonb END) m
--        WHERE (m->>'transform') IN ('count','countTruthy','countEquals','countFalse','countDuplicates','countIfLastSignInOlderThan')
--        ORDER BY (m->>'targetField') LIMIT 1) AS count_target
--     FROM gaps g
--   LOOP
--     v_domain := rec.domain;
--     v_name   := split_part(rec.check_key, ':', 2);
--     IF v_name = '' THEN v_name := rec.check_key; END IF;   -- domainless key: use whole key
--     v_signal := 'signal.' || v_domain || '.' || v_name;
--
--     -- ── direction → rule_type/source_key/compare_value ────────────────────
--     IF rec.check_key IN ('identity:global-admin-count','identity:break-glass-health') THEN
--       CONTINUE;  -- BAND_METRIC: hand-built rule only
--     ELSIF (rec.sev_blob ~ '(_itemcount|count)\s*(==|<=|<)\s*0'
--            OR rec.sev_blob ~ 'length\s*(==|<=|<)\s*0?'
--            OR rec.sev_blob ~ '(_itemcount|count)\s*(<|<=)\s*[1-9]') THEN
--       -- ZERO_IS_BAD: only buildable if a status-aware count field exists
--       IF rec.count_target IS NULL THEN
--         CONTINUE;  -- real gap, needs a bridge key — do NOT fabricate
--       END IF;
--       v_rule_type := 'profile_key_eq';
--       v_src       := rec.count_target;
--       v_cmp       := '0';
--     ELSIF (rec.sev_blob ~ '(_itemcount|count)\s*(>|>=)'
--            OR rec.sev_blob ~ 'length\s*(>|>=)'
--            OR rec.sev_blob ~ 'contains') THEN
--       -- HIGH_IS_BAD: threshold on the bare check key (>0). Safe: errored rows
--       -- write itemCount=0, so >0 never false-fires on failure.
--       v_rule_type := 'threshold';
--       v_src       := rec.check_key;
--       v_cmp       := '0';
--     ELSE
--       CONTINUE;  -- AMBIGUOUS: no readable count condition — no meaningful rule exists
--     END IF;
--
--     -- ── dominant pillar for the domain ────────────────────────────────────
--     v_pillar := CASE v_domain
--       WHEN 'security' THEN 'security' WHEN 'identity' THEN 'security'
--       WHEN 'governance' THEN 'governance' WHEN 'appgov' THEN 'governance'
--       WHEN 'compliance' THEN 'compliance'
--       WHEN 'adoption' THEN 'adoption'
--       WHEN 'copilot' THEN 'copilot'
--       WHEN 'architecture' THEN 'architecture' WHEN 'm365' THEN 'architecture'
--       WHEN 'licensing' THEN 'licensing'
--       ELSE 'architecture'   -- unmapped domain: default to architecture (platform health), reviewable
--     END;
--
--     -- ── dominant impact magnitude from the check's own worst severity ─────
--     v_dom_imp := CASE COALESCE(rec.worst_sev_rank, 0)
--       WHEN 4 THEN 60 WHEN 3 THEN 45 WHEN 2 THEN 30 ELSE 20 END;
--     v_severity := CASE COALESCE(rec.worst_sev_rank, 0)
--       WHEN 4 THEN 'critical' WHEN 3 THEN 'high' WHEN 2 THEN 'medium'
--       WHEN 1 THEN 'low' ELSE 'low' END;
--
--     -- ── category = the ENGINE that owns this rule's Configuration tab ──────
--     -- Only 'security' and 'governance' are registered engine categoryPrefixes
--     -- (engine-registry.ts): the Security Engine owns 'security'; the
--     -- Architecture Health Engine owns 'governance' AND rolls up ALL the other
--     -- health pillars (compliance/adoption/copilot/architecture/licensing) under
--     -- that one prefix. A raw domain like 'licensing'/'identity'/'m365' as
--     -- category would match NO engine and make the rule invisible in every
--     -- Configuration tab — so category is the owning engine's prefix, while the
--     -- precise pillar is carried on the separate `pillar` field.
--     v_category := CASE WHEN v_pillar = 'security' THEN 'security' ELSE 'governance' END;
--
--     -- ── per-pillar impacts: dominant + realistic small (0–2) spillover ────
--     gi := 0; si := 0; ci := 0; ai := 0; coi := 0; archi := 0; li := 0;
--     IF    v_pillar = 'security'     THEN si := v_dom_imp; ci := 2; archi := 1;   -- security ↔ compliance/arch
--     ELSIF v_pillar = 'governance'   THEN gi := v_dom_imp; ci := 2; si := 1;      -- governance ↔ compliance/security
--     ELSIF v_pillar = 'compliance'   THEN ci := v_dom_imp; si := 2; gi := 1;      -- compliance ↔ security/governance
--     ELSIF v_pillar = 'adoption'     THEN ai := v_dom_imp; coi := 2; archi := 1;  -- adoption ↔ copilot/arch
--     ELSIF v_pillar = 'copilot'      THEN coi := v_dom_imp; ai := 2; li := 1;     -- copilot ↔ adoption/licensing
--     ELSIF v_pillar = 'architecture' THEN archi := v_dom_imp; si := 1; li := 1;   -- arch ↔ security/licensing
--     ELSIF v_pillar = 'licensing'    THEN li := v_dom_imp; archi := 2; coi := 1;  -- licensing ↔ arch/copilot
--     END IF;
--
--     -- ── write the OR group + the single rule ──────────────────────────────
--     INSERT INTO signal_rule_groups
--       (signal_key, logic, label, sort_order,
--        governance_impact, security_impact, compliance_impact, adoption_impact,
--        copilot_impact, architecture_impact, licensing_impact,
--        severity, category, pillar, confidence, weight)
--     VALUES
--       (v_signal, 'OR',
--        'Auto-coverage: ' || COALESCE(rec.label, rec.check_key), 0,
--        gi, si, ci, ai, coi, archi, li,
--        v_severity, v_category, v_pillar, 70, v_dom_imp)
--     RETURNING id INTO v_group_id;
--
--     INSERT INTO signal_derivation_rules
--       (signal_key, group_id, rule_type, source_key, compare_value, description, sort_order,
--        governance_impact, security_impact, compliance_impact, adoption_impact,
--        copilot_impact, architecture_impact, licensing_impact,
--        severity, category, pillar, confidence, weight, priority)
--     VALUES
--       (v_signal, v_group_id, v_rule_type, v_src, v_cmp,
--        'Auto-generated to close a signal-coverage gap: monitor check "'
--          || rec.check_key || '" collects real Graph data that no rule evaluated. '
--          || CASE WHEN v_rule_type = 'threshold'
--                  THEN 'Fires when the check returns ≥1 item (its severity_rules treat a high count as the problem).'
--                  ELSE 'Fires when the check''s status-aware count field ' || v_src
--                       || ' is 0 (its severity_rules treat absence as the problem).' END,
--        0,
--        gi, si, ci, ai, coi, archi, li,
--        v_severity, v_category, v_pillar, 70, v_dom_imp,
--        CASE COALESCE(rec.worst_sev_rank,0) WHEN 4 THEN 80 WHEN 3 THEN 60 WHEN 2 THEN 40 ELSE 20 END);
--
--     RAISE NOTICE 'coverage-gap closed: % -> % (%, %=% , src=% cmp=%)',
--       rec.check_key, v_signal, v_pillar, v_rule_type, v_severity, v_src, v_cmp;
--   END LOOP;
-- END $$;
--
-- -- Receipt: every rule PART B just created (updated in the last few minutes).
-- SELECT r.id, r.signal_key, r.rule_type, r.source_key, r.compare_value,
--        r.pillar, r.severity, r.weight,
--        r.governance_impact, r.security_impact, r.compliance_impact,
--        r.adoption_impact, r.copilot_impact, r.architecture_impact, r.licensing_impact
-- FROM signal_derivation_rules r
-- WHERE r.msp_id IS NULL
--   AND r.description LIKE 'Auto-generated to close a signal-coverage gap:%'
--   AND r.created_at > now() - interval '10 minutes'
-- ORDER BY r.signal_key;
--
-- -- Review the receipt against PART A2's "action" column. If it matches:
-- --   COMMIT;
-- -- otherwise:
-- --   ROLLBACK;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ PART C — THE HONEST NON-CLOSABLE LIST (READ-ONLY). Run after COMMIT (or     │
-- │ instead of PART B if you only want the report). Every gap check PART B      │
-- │ deliberately did NOT auto-close, with the real reason — these are NOT to be │
-- │ closed with a fabricated rule; each is a genuine, separate follow-up.       │
-- └──────────────────────────────────────────────────────────────────────────┘
WITH active AS (
  SELECT c.key, c.label, c.mapping, c.properties, c.severity_rules, c.requires_customer_script
  FROM monitor_checks c WHERE c.status = 'active'
),
producible AS (
  SELECT a.key AS check_key, a.key AS profile_key FROM active a
  UNION SELECT a.key, a.key || '__itemCount' FROM active a
  UNION SELECT a.key, m.elem->>'targetField'
        FROM active a, LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(a.mapping)='array' THEN a.mapping ELSE '[]'::jsonb END) AS m(elem)
        WHERE m.elem->>'targetField' IS NOT NULL
  UNION SELECT a.key, p.prop || suffix.s
        FROM active a, LATERAL jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(a.properties)='array' THEN a.properties ELSE '[]'::jsonb END) AS p(prop),
             LATERAL (VALUES ('_count'),('_first'),('_values')) AS suffix(s)
  UNION SELECT a.key, f.k FROM active a, (VALUES ('hasAADP1orP2'),('hasDefender')) AS f(k)
        WHERE a.requires_customer_script = false
  UNION SELECT b.producer, b.k
        FROM (VALUES ('conditionalAccessPolicyCount','identity:ca-policy-count'),
                     ('conditionalAccessPoliciesCount','identity:ca-policy-count'),
                     ('securityScore','security:secure-score')) AS b(k, producer)
        WHERE EXISTS (SELECT 1 FROM active WHERE key = b.producer)
),
gaps AS (
  SELECT a.* FROM active a
  WHERE NOT EXISTS (
    SELECT 1 FROM signal_derivation_rules r
    WHERE r.msp_id IS NULL
      AND (
        (r.rule_type = 'threshold' AND r.source_key = a.key)
        OR (r.rule_type = 'findings_keyword' AND r.source_key <> '' AND a.key ILIKE '%' || r.source_key || '%')
        OR (r.rule_type NOT IN ('threshold','findings_keyword')
            AND EXISTS (SELECT 1 FROM producible p WHERE p.check_key = a.key AND p.profile_key = r.source_key))
      )
  )
),
classified AS (
  SELECT g.key AS check_key, g.label,
    lower(COALESCE((SELECT string_agg(e->>'expression',' ;; ')
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(g.severity_rules)='array' THEN g.severity_rules ELSE '[]'::jsonb END) e),'')) AS sev_blob,
    (SELECT (m->>'targetField')
     FROM jsonb_array_elements(CASE WHEN jsonb_typeof(g.mapping)='array' THEN g.mapping ELSE '[]'::jsonb END) m
     WHERE (m->>'transform') IN ('count','countTruthy','countEquals','countFalse','countDuplicates','countIfLastSignInOlderThan')
     ORDER BY (m->>'targetField') LIMIT 1) AS count_target
  FROM gaps g
)
SELECT check_key, label,
  CASE
    WHEN check_key IN ('identity:global-admin-count','identity:break-glass-health')
      THEN 'BAND METRIC — healthy is a NON-ZERO range; neither >0 nor =0 is a valid alarm. Needs a hand-built band rule (e.g. profile_key_lt on the healthy floor). Not fabricated.'
    WHEN (sev_blob ~ '(_itemcount|count)\s*(==|<=|<)\s*0'
          OR sev_blob ~ 'length\s*(==|<=|<)\s*0?'
          OR sev_blob ~ '(_itemcount|count)\s*(<|<=)\s*[1-9]')
         AND count_target IS NULL
      THEN 'ZERO-IS-BAD but NO status-aware count field to compare against 0. A raw __itemCount=0 would false-fire on every errored/consent-revoked tenant. Needs a status-aware bridge key (like ca-policy''s conditionalAccessPolicyCount). Not fabricated.'
    WHEN NOT (sev_blob ~ '(_itemcount|count)\s*(>|>=|==|<=|<)'
              OR sev_blob ~ 'length\s*(>|>=|==|<=|<)'
              OR sev_blob ~ 'contains')
      THEN 'NO MEANINGFUL RULE CONDITION EXISTS — the check''s severity_rules do not compare a count/length we can read (descriptive/informational data only, or empty severity_rules). Not fabricated.'
    ELSE '(should have been closed by PART B — investigate if this row appears)'
  END AS why_not_closed,
  left(sev_blob, 220) AS severity_expr_sample
FROM classified
WHERE check_key IN ('identity:global-admin-count','identity:break-glass-health')
   OR ((sev_blob ~ '(_itemcount|count)\s*(==|<=|<)\s*0'
        OR sev_blob ~ 'length\s*(==|<=|<)\s*0?'
        OR sev_blob ~ '(_itemcount|count)\s*(<|<=)\s*[1-9]') AND count_target IS NULL)
   OR NOT (sev_blob ~ '(_itemcount|count)\s*(>|>=|==|<=|<)'
           OR sev_blob ~ 'length\s*(>|>=|==|<=|<)'
           OR sev_blob ~ 'contains')
ORDER BY check_key;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ PART D — POST-GENERATE VERIFICATION (READ-ONLY). Run after COMMIT.          │
-- └──────────────────────────────────────────────────────────────────────────┘
-- (a) Remaining zero-coverage checks should be EXACTLY the PART C set (band /
--     no-safe-key / no-condition). Any OTHER check here is an unclosed gap —
--     investigate. Expect this list == PART C's list.
WITH active AS (
  SELECT c.key, c.mapping, c.properties, c.severity_rules, c.requires_customer_script
  FROM monitor_checks c WHERE c.status = 'active'
),
producible AS (
  SELECT a.key AS check_key, a.key AS profile_key FROM active a
  UNION SELECT a.key, a.key || '__itemCount' FROM active a
  UNION SELECT a.key, m.elem->>'targetField'
        FROM active a, LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(a.mapping)='array' THEN a.mapping ELSE '[]'::jsonb END) AS m(elem)
        WHERE m.elem->>'targetField' IS NOT NULL
  UNION SELECT a.key, p.prop || suffix.s
        FROM active a, LATERAL jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(a.properties)='array' THEN a.properties ELSE '[]'::jsonb END) AS p(prop),
             LATERAL (VALUES ('_count'),('_first'),('_values')) AS suffix(s)
  UNION SELECT a.key, f.k FROM active a, (VALUES ('hasAADP1orP2'),('hasDefender')) AS f(k)
        WHERE a.requires_customer_script = false
  UNION SELECT b.producer, b.k
        FROM (VALUES ('conditionalAccessPolicyCount','identity:ca-policy-count'),
                     ('conditionalAccessPoliciesCount','identity:ca-policy-count'),
                     ('securityScore','security:secure-score')) AS b(k, producer)
        WHERE EXISTS (SELECT 1 FROM active WHERE key = b.producer)
)
SELECT count(*) AS remaining_zero_coverage_checks_should_equal_part_c
FROM active a
WHERE NOT EXISTS (
  SELECT 1 FROM signal_derivation_rules r
  WHERE r.msp_id IS NULL
    AND (
      (r.rule_type = 'threshold' AND r.source_key = a.key)
      OR (r.rule_type = 'findings_keyword' AND r.source_key <> '' AND a.key ILIKE '%' || r.source_key || '%')
      OR (r.rule_type NOT IN ('threshold','findings_keyword')
          AND EXISTS (SELECT 1 FROM producible p WHERE p.check_key = a.key AND p.profile_key = r.source_key))
    )
);

-- (b) Every rule PART B created carries a real dominant pillar impact (>0) and a
--     real severity — none defaulted to a flat all-zero placeholder. Expect all
--     rows to show a single dominant *_impact matching their pillar.
SELECT r.signal_key, r.rule_type, r.source_key, r.compare_value, r.pillar, r.severity,
       r.governance_impact, r.security_impact, r.compliance_impact, r.adoption_impact,
       r.copilot_impact, r.architecture_impact, r.licensing_impact
FROM signal_derivation_rules r
WHERE r.msp_id IS NULL
  AND r.description LIKE 'Auto-generated to close a signal-coverage gap:%'
ORDER BY r.signal_key;

-- (c) Sanity: no auto-generated rule accidentally collides with a pre-existing
--     signal_key (would mean two groups for one signal). Expect 0.
SELECT r.signal_key, count(DISTINCT r.group_id) AS group_count
FROM signal_derivation_rules r
WHERE r.msp_id IS NULL
  AND r.signal_key IN (
    SELECT signal_key FROM signal_derivation_rules
    WHERE description LIKE 'Auto-generated to close a signal-coverage gap:%'
  )
GROUP BY r.signal_key
HAVING count(DISTINCT r.group_id) > 1;
-- ============================================================================
