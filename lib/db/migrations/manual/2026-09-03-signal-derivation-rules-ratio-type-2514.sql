-- #2514 — Cross-check ratio rule type (profile_key_ratio) for evaluateRule()
--
-- REAL GAP (documented on #2514, discovered fixing #2187): every ruleType
-- `evaluateRule()` (artifacts/api-server/src/lib/tenant-signals.ts) recognizes
-- reads exactly ONE profile key. `signal.copilot.license-vs-total-users`
-- (id 2735 as seeded) needs a genuine percentage — copilotLicenseCount (from
-- the `copilot:license-vs-total-users` check) against totalUserCount (from
-- `identity:department-directory`, a DIFFERENT check) — and no existing
-- ruleType can combine two profile keys. The row was stuck on `threshold`
-- reading `copilot:license-vs-total-users__itemCount > 0`, which only asks
-- "did the check run and produce any items" — never a real ratio.
--
-- DECISION (Shane, #2514): option (b) — a new cross-check ruleType,
-- `profile_key_ratio`, evaluated in evaluateRule() against the already-merged
-- cross-check tenant profile — NOT a single-check applyMapping() ratio
-- transform (option a, monitor-executor.ts, explicitly left untouched here).
--
-- WHY THIS DOES NOT REPEAT #553's REJECTED DESIGN: #553 rejected a "derived
-- check type reading another check's stored output" for staleness/ordering
-- reasons — a check reading a SEPARATE, potentially-stale cached row written
-- by a different check run. `evaluateRule()` has no such problem: it already
-- runs against the live `mergedProfile` built fresh at evaluation time in the
-- SAME call, for the SAME tenant snapshot. Reading `sourceKey` (numerator)
-- and `denominatorKey` (denominator) off that one already-merged, already-fresh
-- object carries no staleness or evaluation-order risk — both values come from
-- the identical snapshot every other single-key rule already reads from.
--
-- SCHEMA: signal_derivation_rules gets one new nullable column,
-- `denominator_key` — additive, matches this table's existing pattern
-- (compare_value already means "numeric threshold" for every other ruleType,
-- so the denominator gets its own column rather than overloading that one).
-- Null for every ruleType except profile_key_ratio.
--
-- RETUNE (the real, live proof this isn't dead code): the actual
-- signal.copilot.license-vs-total-users row is retuned below to
-- ruleType = 'profile_key_ratio', source_key = 'copilotLicenseCount'
-- (numerator), denominator_key = 'totalUserCount' (denominator),
-- compare_value = '50'. Direction is fixed at "<" (fires when computed
-- coverage % is BELOW compare_value) — mirroring the existing single-fixed-
-- direction "threshold" ruleType precedent (always ">") rather than adding
-- unused _gt/_lt flexibility ahead of a real need. 50% matches the KB
-- narrative already seeded for this check ("a small consumedUnits relative
-- to total users usually means Copilot was purchased for a pilot group and
-- never expanded" — 2026-09-02-remediation-kb-copilot-domain-2048.sql) and
-- the existing example:adoption "Low License Utilization" precedent (lt 40).
-- Matched by signal_key + prior rule_type so this is safe to re-run and does
-- not clobber a hand-edited row that has already moved past the old
-- 'threshold' placeholder.

ALTER TABLE signal_derivation_rules
  ADD COLUMN IF NOT EXISTS denominator_key text;

UPDATE signal_derivation_rules
SET
  rule_type = 'profile_key_ratio',
  source_key = 'copilotLicenseCount',
  denominator_key = 'totalUserCount',
  compare_value = '50',
  description = 'Auto-generated from copilot:license-vs-total-users -- fires when Copilot license coverage (copilotLicenseCount / totalUserCount) is below 50%, indicating a stalled or pilot-only rollout. Retuned #2514 from a placeholder itemCount>0 threshold to a real cross-check ratio.',
  updated_at = now()
WHERE signal_key = 'signal.copilot.license-vs-total-users'
  AND rule_type = 'threshold'
  AND source_key = 'copilot:license-vs-total-users';

-- ── VERIFY (run last) ──────────────────────────────────────────────────────
SELECT id, signal_key, rule_type, source_key, denominator_key, compare_value
FROM signal_derivation_rules
WHERE signal_key = 'signal.copilot.license-vs-total-users';

-- ── Self-marking run record (Simulator Studio Migrations tree, Git #497) ───
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-03-signal-derivation-rules-ratio-type-2514.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
