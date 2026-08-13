-- 2026-07-31 — #270 (Copilot Assessment epic #183)
--
-- The quiz now collects a real Tool Usage answer, and QuizProfile.toolUsage is
-- no longer an always-empty array. final-report-narrative-generator.ts now
-- substitutes a {{toolUsage}} token, and its code fallback carries the new
-- line — but seedAiPrompts() inserts with ON CONFLICT DO NOTHING, so any
-- environment where the 'assessment-final-report-narrative' row already exists
-- keeps the old body and would never show the model the tool answers.
--
-- This adds the line to that stored row, and only to a row that doesn't already
-- have it (idempotent, safe to re-run). It edits ONLY that one prompt; a body
-- an admin has hand-edited still gets the extra line appended after its own
-- "Outcome priorities" line rather than being overwritten.
--
-- Nothing breaks if this is never run: the .replace() is a no-op against a body
-- with no {{toolUsage}} token, and the narrative simply won't mention tools.
--
-- Run manually — Claude Code has no DB access in this environment.

UPDATE ai_prompts
SET prompt_body = CASE
      WHEN prompt_body LIKE '%{{toolUsage}}%' THEN prompt_body
      ELSE replace(
        prompt_body,
        '- Outcome priorities: {{outcomePriorities}}',
        E'- Outcome priorities: {{outcomePriorities}}\n- Microsoft 365 surfaces this organization works in daily: {{toolUsage}}'
      )
    END,
    -- default_body too, or the admin editor's "reset to default" silently drops
    -- the token again.
    default_body = CASE
      WHEN default_body LIKE '%{{toolUsage}}%' THEN default_body
      ELSE replace(
        default_body,
        '- Outcome priorities: {{outcomePriorities}}',
        E'- Outcome priorities: {{outcomePriorities}}\n- Microsoft 365 surfaces this organization works in daily: {{toolUsage}}'
      )
    END,
    updated_at = NOW()
WHERE key = 'assessment-final-report-narrative'
  AND (prompt_body NOT LIKE '%{{toolUsage}}%' OR default_body NOT LIKE '%{{toolUsage}}%');

-- Verify: both flags should come back true.
-- SELECT key,
--        prompt_body  LIKE '%{{toolUsage}}%' AS body_has_token,
--        default_body LIKE '%{{toolUsage}}%' AS default_has_token
-- FROM ai_prompts WHERE key = 'assessment-final-report-narrative';

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-07-31-final-report-prompt-tool-usage-270.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
