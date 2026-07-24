-- Orphaned test rule cleanup: signal_key = 'governance:id_count'
-- =============================================================================
-- Context
-- -------
-- A rule was created through the Simulator's (old) free-text signal-key field
-- with signal_key = 'governance:id_count'. It evaluates and "fires" in the
-- trace/test view (rule evaluation is naming-convention-agnostic by design) but
-- has ZERO effect on real customer dashboard scoring, because pillar scoring
-- only aggregates rules whose signal_key has a registered custom_signals catalog
-- row. 'governance:id_count' has no such row, so this rule is a silent orphan.
--
-- The rule-creation flow has now been fixed so a new orphan can never be created
-- (POST /api/admin/signal-rules refuses an uncatalogued signal unless it is
-- registered atomically). This file only deals with the ONE pre-existing orphan.
--
-- NOTHING here runs automatically. Shane decides between Option A and Option B.
-- Run the diagnostic first, then EXACTLY ONE of the two options (not both).
-- No DATABASE_URL is available in the Claude Code environment, so this is
-- hand-authored for manual execution / review.
-- =============================================================================


-- ── 0. DIAGNOSTIC — confirm the real current state before changing anything ──
-- Expect: one or more signal_derivation_rules rows for the key, and ZERO
-- custom_signals rows (that missing catalog row is exactly what orphans it).

SELECT 'rules' AS what,
       id, signal_key, rule_type, source_key, compare_value, description,
       group_id, sort_order, msp_id, created_at
  FROM signal_derivation_rules
 WHERE signal_key = 'governance:id_count'
 ORDER BY id;

SELECT 'groups' AS what,
       id, signal_key, label, logic, sort_order
  FROM signal_rule_groups
 WHERE signal_key = 'governance:id_count'
 ORDER BY id;

SELECT 'catalog' AS what,
       key, label, description, is_builtin, is_adjustment, enabled
  FROM custom_signals
 WHERE key = 'governance:id_count';   -- expected: 0 rows (that's the orphan)


-- ─────────────────────────────────────────────────────────────────────────────
-- OPTION A — DELETE the orphan rule(s) entirely.
-- Use this if the rule was purely a throwaway test with no real intent behind it.
-- ─────────────────────────────────────────────────────────────────────────────
-- BEGIN;
--   DELETE FROM signal_derivation_rules WHERE signal_key = 'governance:id_count';
--   DELETE FROM signal_rule_groups     WHERE signal_key = 'governance:id_count';
--   INSERT INTO signal_rule_audit_log (action, signal_key, rule_id, before, after, admin_user_id, note)
--     VALUES ('delete', 'governance:id_count', NULL, NULL, NULL, NULL,
--             'Removed orphaned test rule (no custom_signals catalog entry) — manual cleanup 2026-07-24');
-- COMMIT;


-- ─────────────────────────────────────────────────────────────────────────────
-- OPTION B — CONVERT the orphan into a REAL, properly-catalogued signal, so the
-- existing rule(s) start counting toward real scoring. Use this if the rule
-- expresses something genuinely worth measuring.
--
-- IMPORTANT: pick a real label/description/expected_impact. The values below are
-- reasonable defaults for an "identity object count" governance signal — edit
-- them to match what this signal should actually mean before running.
-- ─────────────────────────────────────────────────────────────────────────────
-- BEGIN;
--   INSERT INTO custom_signals (key, label, description, expected_impact, is_adjustment)
--   VALUES (
--     'governance:id_count',
--     'Identity object count',                                    -- label (edit me)
--     'Tracks the tenant identity object count as a governance signal.', -- description (edit me)
--     'Surfaces identity-sprawl governance work as the object count grows.',  -- expected_impact (edit me)
--     false                                                       -- is_adjustment
--   )
--   ON CONFLICT (key) DO NOTHING;
--   INSERT INTO signal_rule_audit_log (action, signal_key, rule_id, before, after, admin_user_id, note)
--     VALUES ('custom_signal_created', 'governance:id_count', NULL, NULL, NULL, NULL,
--             'Converted orphaned test rule into a real catalogued signal — manual cleanup 2026-07-24');
-- COMMIT;
-- -- After Option B, re-run the diagnostic: custom_signals should now return 1 row
-- -- and the existing rule(s) will begin contributing to real dashboard scoring.
