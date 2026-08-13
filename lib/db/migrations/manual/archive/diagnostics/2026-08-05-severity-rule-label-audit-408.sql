-- ════════════════════════════════════════════════════════════════════════════
-- Git #408 — severity_rules label audit: which rules will still fall back to
-- the generic "{severity} finding detected" title after #408's code fix lands?
--
-- READ-ONLY. Nothing here writes. Every statement is a SELECT.
--
-- WHY THIS IS SQL AND NOT CODE: monitor_checks.severity_rules is jsonb DATA
-- held only in the database. The repo contains literal severity-rule objects in
-- exactly two manual migrations (2026-07-31-dlp-label-monitor-checks-212.sql,
-- 8 rules, and 2026-08-04-sharepoint-admin-executor-394.sql, 1 rule) — all 9 of
-- which DO carry a label, confirmed by direct read. Every other rule in the
-- corpus was authored straight into the database, so no Claude Code session can
-- see it. This file is the audit; it asks the questions, the database answers.
--
-- WHAT CHANGED IN CODE (artifacts/api-server/src/lib/monitor-executor.ts +
-- diagnostics-runner.ts): classifySeverity now returns
-- { severity, label } instead of the bare severity string, and
-- buildFindingTitle uses that label as the finding's title. A rule WITHOUT a
-- label still works — it just falls back to the old generic text. So an
-- unlabelled rule is no longer a silent nothing: it is precisely a finding that
-- will still read "warning finding detected" to a customer.
--
-- ORDER OF EVALUATION MATTERS HERE: classifySeverity returns the FIRST rule
-- whose expression matches, so an unlabelled rule sitting ahead of a labelled
-- one shadows it. Part C looks for exactly that.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- PART A — The headline number. How much of the corpus is labelled?
-- ════════════════════════════════════════════════════════════════════════════

WITH rules AS (
  SELECT c.key AS check_key,
         c.status AS check_status,
         elem->>'severity' AS severity,
         NULLIF(TRIM(COALESCE(elem->>'label', '')), '') AS label
  FROM monitor_checks c
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.severity_rules, '[]'::jsonb)) AS elem
)
SELECT COUNT(*)                                          AS total_rules,
       COUNT(*) FILTER (WHERE label IS NOT NULL)         AS labelled,
       COUNT(*) FILTER (WHERE label IS NULL)             AS unlabelled,
       COUNT(*) FILTER (WHERE check_status = 'active')   AS active_rules,
       COUNT(*) FILTER (WHERE check_status = 'active'
                          AND label IS NULL)             AS active_unlabelled
FROM rules;


-- ════════════════════════════════════════════════════════════════════════════
-- PART B — Every unlabelled rule, named. This is the backfill work list.
--
-- Read `severity` alongside `expression`: a rule whose severity is 'ok' is a
-- clean-state rule, and an unlabelled one there is far less consequential than
-- an unlabelled 'critical'/'high' rule, which is a red finding a customer will
-- read as "critical finding detected" and learn nothing from.
-- ════════════════════════════════════════════════════════════════════════════

SELECT c.key                              AS check_key,
       c.label                            AS check_label,
       c.status                           AS check_status,
       ord.idx                            AS rule_index,
       elem->>'severity'                  AS severity,
       elem->>'expression'                AS expression
FROM monitor_checks c
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.severity_rules, '[]'::jsonb))
     WITH ORDINALITY AS ord(elem, idx)
WHERE NULLIF(TRIM(COALESCE(elem->>'label', '')), '') IS NULL
ORDER BY (c.status = 'active') DESC,
         CASE lower(elem->>'severity')
           WHEN 'critical' THEN 1 WHEN 'high' THEN 1
           WHEN 'warning'  THEN 2 WHEN 'medium' THEN 2
           WHEN 'low'      THEN 3
           ELSE 4
         END,
         c.key, ord.idx;


-- ════════════════════════════════════════════════════════════════════════════
-- PART C — Shadowing: a labelled rule that can never be reached because an
-- unlabelled rule ahead of it in the same array matches first.
--
-- These are the worst case — the check LOOKS labelled from a glance at its
-- rules, but the customer still gets generic text — so they are worth fixing
-- ahead of a plain unlabelled rule.
-- ════════════════════════════════════════════════════════════════════════════

WITH rules AS (
  SELECT c.key AS check_key,
         c.status AS check_status,
         ord.idx AS idx,
         NULLIF(TRIM(COALESCE(ord.elem->>'label', '')), '') AS label
  FROM monitor_checks c
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.severity_rules, '[]'::jsonb))
       WITH ORDINALITY AS ord(elem, idx)
)
SELECT check_key,
       check_status,
       MIN(idx) FILTER (WHERE label IS NULL)     AS first_unlabelled_index,
       MIN(idx) FILTER (WHERE label IS NOT NULL) AS first_labelled_index
FROM rules
GROUP BY check_key, check_status
HAVING MIN(idx) FILTER (WHERE label IS NULL) IS NOT NULL
   AND MIN(idx) FILTER (WHERE label IS NOT NULL) IS NOT NULL
   AND MIN(idx) FILTER (WHERE label IS NULL) < MIN(idx) FILTER (WHERE label IS NOT NULL)
ORDER BY (check_status = 'active') DESC, check_key;


-- ════════════════════════════════════════════════════════════════════════════
-- PART D — Corroboration from real findings already written. Which check keys
-- have historically produced the generic title, and how often?
--
-- msp_diagnostic_findings.title is what customers actually saw. Rows matching
-- the generic pattern are the real-world footprint of this bug; after #408 they
-- should stop appearing for any check whose matched rule carries a label.
-- Keep this output — it is the before-picture for the post-fix comparison.
-- ════════════════════════════════════════════════════════════════════════════

SELECT check_key,
       severity,
       COUNT(*)      AS generic_titled_findings,
       MIN(created_at) AS first_seen,
       MAX(created_at) AS last_seen
FROM msp_diagnostic_findings
WHERE title ~ '^[a-zA-Z]+ finding detected$'
GROUP BY check_key, severity
ORDER BY generic_titled_findings DESC, check_key;


-- ════════════════════════════════════════════════════════════════════════════
-- NO BACKFILL IS INCLUDED HERE ON PURPOSE.
--
-- A label is a researched sentence about what a specific matched condition
-- MEANS for a specific tenant. Generating one mechanically ("Rule matched on
-- governance:auto-labeling-coverage") would put text in front of customers that
-- is no more informative than the generic fallback it replaced, while looking
-- like real editorial work — the exact plausible-but-empty failure #408 is
-- about. Run Parts A–C, and the UPDATEs get written against the real gaps they
-- return, per check, with real wording.
-- ════════════════════════════════════════════════════════════════════════════
