-- Git #578 — Generated document prose overuses em dashes, reads as AI-written.
--
-- Manual migration — review and run by hand (do not run drizzle-kit push /
-- push --force). No DATABASE_URL in this environment; NOT run here.
--
-- ── WHAT WENT WRONG ──────────────────────────────────────────────────────────
-- Confirmed with Shane 2026-08-08: generated documents (all 9 document types
-- plus the SOW path) lean heavily on em dashes for clause structure — a
-- stylistic tic that signals AI-written text in a document meant to read as a
-- professional assessment report.
--
-- ── SAME SHARED PROMPT AS #558 ───────────────────────────────────────────────
-- `insights-document-style` is the prompt #558 already patched (identifier
-- hygiene), prepended to every AI-generated client document via
-- prompt-loader.ts's getDocumentStylePrefix(). One append to that same row is
-- the whole fix, exactly like #558 — no per-document-type edit, none wanted.
--
-- ── WHY THIS IS AN APPEND, NOT A REPLACE ─────────────────────────────────────
-- The live `insights-document-style` body is NOT in this repo (see #558's own
-- migration for the full explanation). A `SET prompt_body = <full body>` here
-- would silently overwrite the approved style guide, including the theme
-- system and the #558 identifier-hygiene block. So this file APPENDS one
-- block to whatever is live, and appends it IDEMPOTENTLY: the CASE guards on
-- the block's own marker line, so re-running this file is a no-op rather than
-- a second copy of the rule. `default_body` gets the same append (and is left
-- alone when NULL) so a "Reset to default" in the AI Prompts admin UI cannot
-- silently revert the fix.
--
-- ── SCOPE ─────────────────────────────────────────────────────────────────────
-- One row. Same document-type coverage as #558 (all 9 types via
-- document-engine.ts, plus the SOW path via document-engine-sow.ts).
--
-- ── VERIFICATION ──────────────────────────────────────────────────────────────
-- Shane runs this by hand; no live model call is available in this
-- environment. Receipt query below confirms the block landed exactly once.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

WITH block AS (
  SELECT
    'EM DASH MINIMIZATION'::text AS marker,
    $emdash$
EM DASH MINIMIZATION — PREFER PERIODS, COMMAS, OR PARENTHESES

Minimize em dashes (—) in generated prose. Heavy em-dash use for clause
structure reads as a stylistic tic and signals AI-written text rather than a
professional assessment report.

For the same clause structure an em dash would join, prefer whichever of these
reads most naturally in context:

  - A period, splitting the thought into two sentences.
  - A comma, when the clause is a short aside within one sentence.
  - Parentheses, when the clause is a genuine parenthetical aside.

This is a preference for restraint, not an absolute ban: an occasional em dash
where no other punctuation reads as naturally is acceptable. The failure mode
this rule targets is habitual, repeated em-dash use as the default way to join
clauses throughout a document.
$emdash$::text AS body
)
UPDATE ai_prompts p
SET
  prompt_body = CASE
    WHEN position(b.marker in p.prompt_body) = 0
      THEN p.prompt_body || E'\n\n' || b.body
    ELSE p.prompt_body
  END,
  default_body = CASE
    WHEN p.default_body IS NULL THEN NULL
    WHEN position(b.marker in p.default_body) = 0
      THEN p.default_body || E'\n\n' || b.body
    ELSE p.default_body
  END,
  updated_at = now()
FROM block b
WHERE p.key = 'insights-document-style';

-- ── RECEIPT ──────────────────────────────────────────────────────────────────
-- Expect EXACTLY ONE row, with:
--   has_rule            = true
--   rule_occurrences    = 1        (2 means the idempotency guard did not hold)
--   default_has_rule    = true, or NULL if this row has no default_body
--   body_len                       (compare against the pre-run value: it must
--                                   have GROWN by the length of the block, not
--                                   shrunk to it — a shrink means a replace)
--
-- ZERO ROWS is a real failure, not a no-op: it means the
-- `insights-document-style` row does not exist in this database, in which case
-- getDocumentStylePrefix() returns "" and NO style guide (and therefore no part
-- of this fix) reaches any document. ROLLBACK and create the row first.
SELECT
  key,
  (position('EM DASH MINIMIZATION' in prompt_body) > 0)                       AS has_rule,
  (length(prompt_body) - length(replace(prompt_body, 'EM DASH MINIMIZATION', '')))
    / length('EM DASH MINIMIZATION')                                         AS rule_occurrences,
  (position('EM DASH MINIMIZATION' in default_body) > 0)                     AS default_has_rule,
  length(prompt_body)                                                        AS body_len,
  updated_at
FROM ai_prompts
WHERE key = 'insights-document-style';

-- If the receipt looks right:  COMMIT;
-- If anything looks wrong:     ROLLBACK;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-08-document-style-em-dash-minimization-578.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
