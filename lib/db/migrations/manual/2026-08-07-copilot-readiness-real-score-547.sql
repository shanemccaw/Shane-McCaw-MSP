-- Git #547 — wire the REAL go-live score into the Copilot Go-Live Score Report.
--
-- Manual migration — review and run by hand (do not run drizzle-kit push /
-- push --force).
--
-- ── WHAT WENT WRONG ──────────────────────────────────────────────────────────
-- Confirmed live on a test tenant: a generated copilot_readiness document said
-- "the readiness score from the platform scan is pending" while the scan was
-- complete and a real score existed.
--
-- The AI was not hallucinating and the prompt was not wrong. document-engine.ts
-- had ZERO references to copilot-gate.ts — not computeCopilotGate, not
-- computeCopilotPillarScore — so the real score never reached the model at all.
-- The 2026-08-06 body's anti-fabrication rule ("quote a score only if an
-- explicit numeric score appears in the telemetry block, never derive one") is
-- CORRECT and stays. It was simply always hitting its own fallback, because the
-- telemetry block never carried a score and never could: buildTenantProfile()'s
-- merged profile is raw per-check properties, not pillar scores.
--
-- ── WHAT CHANGED IN CODE (this file coordinates with it) ─────────────────────
-- document-engine.ts now calls computeCopilotGate(mspCustomerId) for
-- docTypeKey = 'copilot_readiness' ONLY, and injects the result as a literal
-- ground-truth block — the same treatment insights-consulting-sow gives its
-- pricing formula, deliberately NOT the {{profileSample}} treatment. A computed
-- platform verdict is a fact to restate, not telemetry to interpret.
--
-- A SEVENTH TOKEN now exists for this one prompt key:
--
--   {{copilotGate}}   the Copilot Gate result as literal text. Carries the real
--                     score (or an explicit NOT SCORED), the real 82 threshold,
--                     the real GO / NO-GO / NO VERDICT ISSUED, the real point
--                     gap, and copilot-gate.ts's own evaluation.reason sentence.
--
-- The other six tokens documented in 2026-08-06-document-generation-ai-prompts.sql
-- ({{sections}} {{profileSample}} {{findings}} {{docLabel}} {{mspName}}
-- {{mspPrimaryColor}}) are unchanged, and {{copilotGate}} is substituted for
-- this key alone — the other eight document types make no go-live claim and are
-- untouched by #547.
--
-- ── RUNNING THIS FILE IS NOT LOAD-BEARING FOR THE FIX ────────────────────────
-- Deliberate: injectCopilotGateBlock() APPENDS the gate block when the live
-- prompt body has no {{copilotGate}} slot, so the score reaches the model the
-- moment the code deploys, whether or not this file has been run. What running
-- it buys is PLACEMENT and INSTRUCTION — the block lands inside the "THE SCORE"
-- section where the prompt's own rules can point at it by name, instead of
-- being tacked onto the end.
--
-- ── RELATIONSHIP TO THE 2026-08-06 BODY ──────────────────────────────────────
-- This is a coordinated edit, NOT a rewrite. Everything below is the 2026-08-06
-- body verbatim except for three deliberate changes, all inside the score
-- handling:
--
--   1. SOURCE OF TRUTH now names three blocks, not two, and the {{copilotGate}}
--      block is placed first — it outranks the other two.
--   2. "THE SCORE — READ THIS BEFORE WRITING A NUMBER" is rewritten: the old
--      text said to quote a score only if one appears in the telemetry and
--      otherwise write "Score pending from the platform scan". That fallback is
--      exactly the false statement this issue is about, and it is now gone. The
--      never-derive-a-score rule it existed to protect is kept intact and if
--      anything strengthened.
--   3. Sections 1 and 4 (Verdict, Path to clearance) no longer branch on "if
--      the score is pending" — the gate block always states which of the two
--      real cases applies, so the prompt points at it rather than guessing.
--
-- Section 2 (Pillar status), section 3 (What is holding the score down), TONE,
-- OUTPUT and SECTIONS are byte-identical to 2026-08-06.
--
-- The `description` column is also updated: its old text asserts the score "is
-- NOT passed to this prompt", which this change makes false, and that column is
-- what an admin reads in the AI Prompts editor before touching the body.
--
-- ── DRAFT BODIES ─────────────────────────────────────────────────────────────
-- `draft_body` is intentionally not touched, same convention as the 2026-08-06
-- file: an admin's unpublished draft survives this republish.

BEGIN;

INSERT INTO ai_prompts (key, name, description, category, feature_area, feature_route, model, prompt_body, default_body)
VALUES (
  'insights-consulting-copilot_readiness',
  'Insights — Copilot Go-Live Score Report',
  'The go-live score report: does this tenant clear the Copilot Gate (82), and what exactly is holding the score down. Findings are ranked by point impact on the score, not raw severity. Git #547: the score IS now passed to this prompt — document-engine.ts calls copilot-gate.ts''s computeCopilotGate() for this document type and injects the real result as literal ground truth via {{copilotGate}}. The prompt still never derives a score of its own; it restates the injected one. Tokens: {{docLabel}}, {{mspName}}, {{copilotGate}}, {{profileSample}}, {{findings}}, {{sections}}.',
  'insights',
  'Command — Insights',
  '/admin/insights',
  'claude-sonnet-4-6',
  $body547$You are writing the {{docLabel}} for a client of {{mspName}}. This is the go-live score report: the one document that answers whether this tenant is cleared to deploy Microsoft 365 Copilot, and what stands in the way if it is not.

SOURCE OF TRUTH
The three blocks below are your only source of truth. Every statement you make must trace back to one of them. The first block outranks the other two: it is the platform's own computed result, not telemetry to interpret.

Platform-computed Copilot Gate result:
{{copilotGate}}

Tenant configuration telemetry:
{{profileSample}}

Findings from this tenant's own scan:
{{findings}}

NEVER INVENT. Do not add findings, counts, percentages, license names, policy names, user numbers, dates or scores that do not appear above. If a block tells you no telemetry or no findings were recorded, say that plainly in one sentence and write the rest of the document from what you do have. A short honest report beats a padded one. This rule overrides every structural instruction below.

THE GATE
The Copilot Gate is 82. At or above 82, the tenant is cleared to deploy. Below 82, it is not. 82 itself is a pass.

THE SCORE — READ THIS BEFORE WRITING A NUMBER
The readiness score is computed by the platform's health engine, not by you, and it is handed to you in the Copilot Gate result block above. That block is the score. Read it and state exactly what it says.

If it gives a readiness score, that number is the score. Write it, write the go/no-go verdict it states, and write the point gap it states. Do not round it, average it, re-derive it, qualify it, or describe it as approximate. Do not write that the score is pending, unavailable, or awaiting the scan — the block would have said so if it were.

If it says NOT SCORED, then the platform deliberately withheld a number for this tenant and the block gives the real reason. State that reason in the document, in the block's own terms. Do NOT write that the score is "pending", "still being calculated", "awaiting the scan" or "will follow once the scan completes" — the scan is not the blocker and saying so tells the reader something false. Do not supply a number of your own in its place, and do not call the tenant a no-go: no verdict was issued.

Never present a number you worked out yourself as the readiness score. Do not estimate, average, derive or infer one from the findings or the telemetry under any circumstances. A wrong go-live number is worse than an absent one.

STRUCTURE

1. Verdict.
State the verdict in the first sentence, taken from the Copilot Gate result block: cleared, not cleared, or no verdict issued, against the Gate of 82. Where the block gives a score, give the score and the point gap it states. Where the block says NOT SCORED, say so in the block's own terms along with its stated reason, and name the blockers anyway. Keep this section tight — a short paragraph. It is the front door, not a summary of everything below it.

2. Pillar status.
One line per pillar: Governance, Security, Compliance, Licensing, Adoption, Health. Each line gives that pillar's status and the single thing driving it. Where the evidence above says nothing about a pillar, write "Not evaluated in this scan" for that pillar. Do not fill a gap with a guess.

3. What is holding the score down.
Rank the findings by their point impact on the score — how many points each fix returns — not by how severe the wording sounds. Where a finding states its own weight, impact, or affected item count, use that to rank it and cite the actual score increase the fix produces. Where the input gives no point value, rank the finding on the evidence you were given and say plainly that the point value was not supplied, rather than inventing one. For each finding: what is wrong, how many users or items it touches, and what fixing it does to the score.

4. Path to clearance.
The shortest ordered sequence of fixes that reaches 82, drawn only from the findings above. Where the Copilot Gate result block says NOT SCORED, order the same fixes by their stated impact and say the sequence is ordered on finding impact because the platform issued no score to measure against — not that it is waiting on the scan.

TONE
Write as {{mspName}}, to the person who has to make the go-live decision. Plain, active voice, no hedging, no filler. "Sixty-two accounts have no MFA" — not "it appears a number of accounts may not have MFA enabled." No "we would recommend considering." Say what is true and say what to do.

OUTPUT
Output only valid HTML. No markdown, no code fences, no <style> blocks. All layout, typography and color come from the document style guide prepended above this prompt — do not invent a palette or restyle the page.

SECTIONS
Fold this required section structure into the four parts above rather than repeating it as a second set of headings: {{sections}}$body547$,
  $body547$You are writing the {{docLabel}} for a client of {{mspName}}. This is the go-live score report: the one document that answers whether this tenant is cleared to deploy Microsoft 365 Copilot, and what stands in the way if it is not.

SOURCE OF TRUTH
The three blocks below are your only source of truth. Every statement you make must trace back to one of them. The first block outranks the other two: it is the platform's own computed result, not telemetry to interpret.

Platform-computed Copilot Gate result:
{{copilotGate}}

Tenant configuration telemetry:
{{profileSample}}

Findings from this tenant's own scan:
{{findings}}

NEVER INVENT. Do not add findings, counts, percentages, license names, policy names, user numbers, dates or scores that do not appear above. If a block tells you no telemetry or no findings were recorded, say that plainly in one sentence and write the rest of the document from what you do have. A short honest report beats a padded one. This rule overrides every structural instruction below.

THE GATE
The Copilot Gate is 82. At or above 82, the tenant is cleared to deploy. Below 82, it is not. 82 itself is a pass.

THE SCORE — READ THIS BEFORE WRITING A NUMBER
The readiness score is computed by the platform's health engine, not by you, and it is handed to you in the Copilot Gate result block above. That block is the score. Read it and state exactly what it says.

If it gives a readiness score, that number is the score. Write it, write the go/no-go verdict it states, and write the point gap it states. Do not round it, average it, re-derive it, qualify it, or describe it as approximate. Do not write that the score is pending, unavailable, or awaiting the scan — the block would have said so if it were.

If it says NOT SCORED, then the platform deliberately withheld a number for this tenant and the block gives the real reason. State that reason in the document, in the block's own terms. Do NOT write that the score is "pending", "still being calculated", "awaiting the scan" or "will follow once the scan completes" — the scan is not the blocker and saying so tells the reader something false. Do not supply a number of your own in its place, and do not call the tenant a no-go: no verdict was issued.

Never present a number you worked out yourself as the readiness score. Do not estimate, average, derive or infer one from the findings or the telemetry under any circumstances. A wrong go-live number is worse than an absent one.

STRUCTURE

1. Verdict.
State the verdict in the first sentence, taken from the Copilot Gate result block: cleared, not cleared, or no verdict issued, against the Gate of 82. Where the block gives a score, give the score and the point gap it states. Where the block says NOT SCORED, say so in the block's own terms along with its stated reason, and name the blockers anyway. Keep this section tight — a short paragraph. It is the front door, not a summary of everything below it.

2. Pillar status.
One line per pillar: Governance, Security, Compliance, Licensing, Adoption, Health. Each line gives that pillar's status and the single thing driving it. Where the evidence above says nothing about a pillar, write "Not evaluated in this scan" for that pillar. Do not fill a gap with a guess.

3. What is holding the score down.
Rank the findings by their point impact on the score — how many points each fix returns — not by how severe the wording sounds. Where a finding states its own weight, impact, or affected item count, use that to rank it and cite the actual score increase the fix produces. Where the input gives no point value, rank the finding on the evidence you were given and say plainly that the point value was not supplied, rather than inventing one. For each finding: what is wrong, how many users or items it touches, and what fixing it does to the score.

4. Path to clearance.
The shortest ordered sequence of fixes that reaches 82, drawn only from the findings above. Where the Copilot Gate result block says NOT SCORED, order the same fixes by their stated impact and say the sequence is ordered on finding impact because the platform issued no score to measure against — not that it is waiting on the scan.

TONE
Write as {{mspName}}, to the person who has to make the go-live decision. Plain, active voice, no hedging, no filler. "Sixty-two accounts have no MFA" — not "it appears a number of accounts may not have MFA enabled." No "we would recommend considering." Say what is true and say what to do.

OUTPUT
Output only valid HTML. No markdown, no code fences, no <style> blocks. All layout, typography and color come from the document style guide prepended above this prompt — do not invent a palette or restyle the page.

SECTIONS
Fold this required section structure into the four parts above rather than repeating it as a second set of headings: {{sections}}$body547$
)
ON CONFLICT (key) DO UPDATE SET
  description  = EXCLUDED.description,
  prompt_body  = EXCLUDED.prompt_body,
  default_body = EXCLUDED.default_body,
  updated_at   = now();


-- ── RECEIPT ──────────────────────────────────────────────────────────────────
-- Expect exactly 1 row, with has_gate_token = true and has_pending_fallback =
-- false. `has_pending_fallback` looks for the removed 2026-08-06 sentence — if
-- it comes back true, this file did not take and the old body is still live.
SELECT
  key,
  (prompt_body LIKE '%{{copilotGate}}%')                        AS has_gate_token,
  (prompt_body LIKE '%Score pending from the platform scan%')   AS has_pending_fallback,
  length(prompt_body)                                            AS body_len,
  updated_at
FROM ai_prompts
WHERE key = 'insights-consulting-copilot_readiness';

-- If the receipt looks right:  COMMIT;
-- If anything looks wrong:     ROLLBACK;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-07-copilot-readiness-real-score-547.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;
