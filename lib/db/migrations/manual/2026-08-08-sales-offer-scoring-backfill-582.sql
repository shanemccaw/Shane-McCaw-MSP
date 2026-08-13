-- Git #582 (backfill) - Add missing scoring rows for the original 11 active
-- eligibility rule groups #582's rule_type fix created, closing the same
-- minScore=40 gate that #585/#586/#589 were each built to avoid on their own
-- new rows.
--
-- WHY THIS EXISTS
-- computeSalesOfferEngine() (sales-offer-engine.ts) drops every candidate
-- scoring below config.minScore (default 40, sales_offer_config has 0 rows
-- so the default always applies). Score only accumulates from
-- rule_type='scoring' groups firing. The 12 rows #582 fixed rule_type on are
-- ALL rule_type='eligibility' with zero matching 'scoring' rows between
-- them (confirmed live) -- so even with eligibility now correctly evaluated,
-- every one of those candidates still scores 0 and gets filtered to nothing.
-- This was flagged but not fixed when #585 was originally built ("separate
-- pre-existing gap, flagged not fixed here").
--
-- SCOPE: 11 of the 12, not 12
-- Of #582's 12 eligibility rows, 1 (key='offer-dlp-report-on-dlp-violations',
-- service_id=83) is is_active=false -- a deliberately unpriced/unreviewed
-- "lighter add-on" row, same reasoning as the entra-id-premium/defender rows
-- in 2026-07-22-license-gap-sales-offer-wiring.sql (inactive until priced).
-- This backfill only targets is_active=true eligibility rows, so that one is
-- correctly skipped -- it should get its scoring row when it's activated for
-- real, not backfilled blind here.
--
-- MECHANISM: derived, not hand-typed
-- Rather than re-typing each of the 11 rows' service_id/required_signal_keys
-- by hand (real risk of a transcription mismatch against the live rows this
-- session already introspected once and got wrong twice on jsonb casting),
-- this INSERT ... SELECT copies key/service_id/required_signal_keys/logic
-- directly off each live eligibility row and only changes what a scoring
-- row needs to differ on: rule_type, key suffix, score_contribution. Scoped
-- with `key LIKE 'offer-%'` (confirmed live: all and only #582's original 12
-- keys use that prefix -- #585/#586/#589's keys never do) and a NOT EXISTS
-- guard so this can never create a second scoring row for a service that
-- already has one, including from a future re-run.
--
-- score_contribution=60, same placeholder value #585/#586/#589 all used --
-- clears the default minScore=40 floor with margin; not derived from real
-- ranking data, since none exists yet. Tune later via the admin Sales Offer
-- Engine rule-group editor.
--
-- Safe to run repeatedly: ON CONFLICT (key) DO NOTHING, and the NOT EXISTS
-- guard means a second run finds nothing left to insert. No UPDATE/DELETE.

BEGIN;

INSERT INTO sales_offer_rule_groups
  (key, label, description, rule_type, service_id, required_signal_keys, logic, score_contribution, is_active, sort_order)
SELECT
  eg.key || '-scoring',
  eg.label || ' - Scoring',
  'Relevance score contribution mirroring this eligibility rule (#582 scoring backfill).',
  'scoring',
  eg.service_id,
  eg.required_signal_keys,
  eg.logic,
  60,
  true,
  (SELECT COALESCE(MAX(sort_order), 0) FROM sales_offer_rule_groups) + ROW_NUMBER() OVER (ORDER BY eg.id)
FROM sales_offer_rule_groups eg
WHERE eg.rule_type = 'eligibility'
  AND eg.is_active = true
  AND eg.key LIKE 'offer-%'
  AND eg.service_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sales_offer_rule_groups sg
    WHERE sg.service_id = eg.service_id AND sg.rule_type = 'scoring'
  )
ON CONFLICT (key) DO NOTHING;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-08-sales-offer-scoring-backfill-582.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- ── Verification ─────────────────────────────────────────────────────────
-- Run after all four migrations (#585, #586, #589, this backfill) land.
-- Expect real counts for BOTH rule_type='eligibility' AND rule_type=
-- 'scoring' -- if 'scoring' is still 0 or far below 'eligibility', something
-- in this pass did not actually commit.
SELECT rule_type, is_active, count(*)
FROM sales_offer_rule_groups
GROUP BY rule_type, is_active
ORDER BY rule_type, is_active;
