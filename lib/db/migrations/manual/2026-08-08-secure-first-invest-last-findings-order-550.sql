-- Git #550 — Secure-first, Invest-last deterministic finding ordering.
--
-- Manual migration — review and run by hand (do not run drizzle-kit push /
-- push --force). No DATABASE_URL in this environment; not run here.
--
-- ── WHAT WENT WRONG ──────────────────────────────────────────────────────────
-- Confirmed live (2026-08-08) on the copilot_readiness document: Step 1 of
-- "Path to clearance" was a Microsoft license purchase suggestion, Step 2 was
-- "0 Conditional Access policies" — a free, critical, immediately-actionable
-- fix that should obviously rank first. The prompt body trusted the MODEL to
-- rank findings by point impact alone, with no instruction distinguishing a
-- fix the customer can do right now for free from one that requires a
-- Microsoft purchase first.
--
-- ── WHAT CHANGED IN CODE (this file coordinates with it) ─────────────────────
-- document-engine.ts now pre-sorts the findings list BEFORE it reaches either
-- prompt, for docTypeKey IN ('copilot_readiness', 'remediation_plan') only:
--
--   sortFindingsSecureFirstInvestLast(scopedFindings, categorizedFindings)
--
-- A real, deterministic, two-tier STABLE partition — Tier 1 (every finding NOT
-- classified license_gap, in the order they already arrive) always precedes
-- Tier 2 (every license_gap-classified finding, Git #484-#488/#495's
-- established `tenant_monitor_profiles.status = 'license_gap'` classification,
-- in the same relative order among themselves) — never the reverse, regardless
-- of either finding's own point value. This is NOT a prompt instruction the
-- model is trusted to follow; it happens in code before {{findings}} is
-- assembled, so the ordering is guaranteed correct regardless of what the
-- model does with it.
--
-- This file's job is the other half: telling both prompts the ordering is
-- already guaranteed, so the model does not attempt to re-sort the findings
-- itself in prose (which could reintroduce exactly this bug even with the
-- code-level guarantee upstream — a model that re-ranks by "point impact"
-- alone in its own writing would recreate the license-first ordering the fix
-- exists to prevent).
--
-- ── SCOPE — WHY ONLY THESE TWO PROMPTS ────────────────────────────────────────
-- Investigated all 7 other document prompts in
-- 2026-08-06-document-generation-ai-prompts.sql for the same pattern before
-- touching only two. Every one of them DOES rank/order its findings, but never
-- on "point impact toward the Copilot Gate score" — each ranks on its own
-- pillar-specific dimension instead: governance_maturity_report/
-- security_posture_report/compliance_alignment_report/operational_health_report
-- order "by the reduction in exposure/disruption each fix delivers/closes";
-- license_optimization_report orders "by annual saving ... or recoverable
-- seats"; adoption_report orders "by the disruption each item is likely to
-- cause". None of these are framed as a race to a numeric gate the way
-- copilot_readiness (the Gate itself) and remediation_plan ("using the same
-- basis as the score report") explicitly are — they are pillar deep-dives, not
-- action plans toward a single go/no-go threshold. Matches Shane's own read in
-- the issue. Left untouched; no code or prompt change needed for them.
--
-- ── A REAL GAP FOUND DURING THIS INVESTIGATION, FLAGGED, NOT SILENTLY FIXED ──
-- Traced the full findings pipeline (tenant-signals.ts's buildTenantProfile /
-- deriveMonitorFindingsWithKeys) before writing the sort. Confirmed a PINNED
-- test in build-tenant-profile.test.ts ("license_gap row is NOT a finding
-- (status != ok)") means a monitor check whose latest status is 'license_gap'
-- can NEVER become an entry in {{findings}} today — deriveMonitorFindingsWithKeys
-- skips any row whose status isn't 'ok' before a finding string is ever built.
-- So under current data, Tier 2 of the sort below will always be empty: no
-- finding reaching either prompt can currently BE license_gap-classified. The
-- live "Microsoft license purchase suggestion" Shane saw most likely came from
-- the model reading raw license-gap boolean flags out of {{profileSample}}
-- telemetry (e.g. hasAADP1orP2: false) and volunteering a recommendation from
-- them, not from a sortable {{findings}} entry.
-- The sort implemented here is still the correct, real, code-level fix the
-- issue asked for — it is forward-compatible the moment any future finding
-- source legitimately produces a license_gap-classified entry (CategorizedFinding
-- .isLicenseGap, tenant-signals.ts) — but it does NOT by itself change what
-- Shane observed live, because the object of that observation isn't in
-- {{findings}}. Recommend a follow-up issue to address the {{profileSample}}
-- license-flag behavior directly (e.g. an explicit "do not propose license
-- purchases ahead of free/available findings" instruction scoped to profile
-- telemetry, mirroring this file's {{findings}} guarantee).
--
-- ── RELATIONSHIP TO PRIOR BODIES ─────────────────────────────────────────────
-- insights-consulting-copilot_readiness: coordinated edit of the 2026-08-07
-- (#547) body — only "3. What is holding the score down." and
-- "4. Path to clearance." change; everything else (SOURCE OF TRUTH, THE GATE,
-- THE SCORE, section 1/2, TONE, OUTPUT, SECTIONS) is byte-identical to #547.
-- insights-consulting-remediation_plan: coordinated edit of the 2026-08-06
-- body — only the "RANKING" section changes; everything else is
-- byte-identical.
--
-- `draft_body` is intentionally not touched, same convention as the prior
-- prompt-editing migrations: an admin's unpublished draft survives this
-- republish.

BEGIN;

-- ── insights-consulting-copilot_readiness ────────────────────────────────────

INSERT INTO ai_prompts (key, name, description, category, feature_area, feature_route, model, prompt_body, default_body)
VALUES (
  'insights-consulting-copilot_readiness',
  'Insights — Copilot Go-Live Score Report',
  'The go-live score report: does this tenant clear the Copilot Gate (82), and what exactly is holding the score down. Git #550: findings arrive PRE-ORDERED Secure-first/Invest-last (every finding needing no new Microsoft license purchase before every finding that does, regardless of point value) — document-engine.ts guarantees this in code before {{findings}} is built; the prompt states the fact and forbids re-sorting. Within each tier, findings are still ranked by point impact on the score. Git #547: the score IS passed to this prompt via {{copilotGate}}; the prompt still never derives a score of its own. Tokens: {{docLabel}}, {{mspName}}, {{copilotGate}}, {{profileSample}}, {{findings}}, {{sections}}.',
  'insights',
  'Command — Insights',
  '/admin/insights',
  'claude-sonnet-4-6',
  $body550a$You are writing the {{docLabel}} for a client of {{mspName}}. This is the go-live score report: the one document that answers whether this tenant is cleared to deploy Microsoft 365 Copilot, and what stands in the way if it is not.

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
The findings above are already given to you in a fixed, deliberate order and you must WRITE them in that order — do not re-rank, re-sort, or reshuffle them. They are ordered Secure-first, Invest-last: every finding the tenant can fix right now at no additional cost comes before every finding that requires acquiring a new Microsoft license or add-on, no matter how many points either one is worth. Within each of those two groups the findings are ranked by their point impact on the score — how many points each fix returns — not by how severe the wording sounds. Where a finding states its own weight, impact, or affected item count, cite the actual score increase the fix produces. Where the input gives no point value, say plainly that the point value was not supplied, rather than inventing one. For each finding: what is wrong, how many users or items it touches, and what fixing it does to the score.

4. Path to clearance.
The shortest ordered sequence of fixes that reaches 82, drawn only from the findings above, IN THE ORDER THEY ARE GIVEN. Do not move a license-purchase finding ahead of a free, available-today finding, even if the license-gated one returns more points — that reordering is exactly the mistake this document must not make. Where the Copilot Gate result block says NOT SCORED, order the same fixes on their given order and say the sequence is ordered on finding impact within the free-fixes-first grouping because the platform issued no score to measure against — not that it is waiting on the scan.

TONE
Write as {{mspName}}, to the person who has to make the go-live decision. Plain, active voice, no hedging, no filler. "Sixty-two accounts have no MFA" — not "it appears a number of accounts may not have MFA enabled." No "we would recommend considering." Say what is true and say what to do.

OUTPUT
Output only valid HTML. No markdown, no code fences, no <style> blocks. All layout, typography and color come from the document style guide prepended above this prompt — do not invent a palette or restyle the page.

SECTIONS
Fold this required section structure into the four parts above rather than repeating it as a second set of headings: {{sections}}$body550a$,
  $body550a$You are writing the {{docLabel}} for a client of {{mspName}}. This is the go-live score report: the one document that answers whether this tenant is cleared to deploy Microsoft 365 Copilot, and what stands in the way if it is not.

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
The findings above are already given to you in a fixed, deliberate order and you must WRITE them in that order — do not re-rank, re-sort, or reshuffle them. They are ordered Secure-first, Invest-last: every finding the tenant can fix right now at no additional cost comes before every finding that requires acquiring a new Microsoft license or add-on, no matter how many points either one is worth. Within each of those two groups the findings are ranked by their point impact on the score — how many points each fix returns — not by how severe the wording sounds. Where a finding states its own weight, impact, or affected item count, cite the actual score increase the fix produces. Where the input gives no point value, say plainly that the point value was not supplied, rather than inventing one. For each finding: what is wrong, how many users or items it touches, and what fixing it does to the score.

4. Path to clearance.
The shortest ordered sequence of fixes that reaches 82, drawn only from the findings above, IN THE ORDER THEY ARE GIVEN. Do not move a license-purchase finding ahead of a free, available-today finding, even if the license-gated one returns more points — that reordering is exactly the mistake this document must not make. Where the Copilot Gate result block says NOT SCORED, order the same fixes on their given order and say the sequence is ordered on finding impact within the free-fixes-first grouping because the platform issued no score to measure against — not that it is waiting on the scan.

TONE
Write as {{mspName}}, to the person who has to make the go-live decision. Plain, active voice, no hedging, no filler. "Sixty-two accounts have no MFA" — not "it appears a number of accounts may not have MFA enabled." No "we would recommend considering." Say what is true and say what to do.

OUTPUT
Output only valid HTML. No markdown, no code fences, no <style> blocks. All layout, typography and color come from the document style guide prepended above this prompt — do not invent a palette or restyle the page.

SECTIONS
Fold this required section structure into the four parts above rather than repeating it as a second set of headings: {{sections}}$body550a$
)
ON CONFLICT (key) DO UPDATE SET
  description  = EXCLUDED.description,
  prompt_body  = EXCLUDED.prompt_body,
  default_body = EXCLUDED.default_body,
  updated_at   = now();

-- ── insights-consulting-remediation_plan ─────────────────────────────────────

INSERT INTO ai_prompts (key, name, description, category, feature_area, feature_route, model, prompt_body, default_body)
VALUES (
  'insights-consulting-remediation_plan',
  'Insights — Remediation Plan',
  'The remediation NARRATIVE only. Git #550: findings arrive PRE-ORDERED Secure-first/Invest-last (every finding needing no new Microsoft license purchase before every finding that does, regardless of point value) — document-engine.ts guarantees this in code before {{findings}} is built; the prompt states the fact and forbids re-sorting. Within each tier, findings are still ranked by point impact on the readiness score. Deliberately writes no PowerShell and no admin-centre click paths — that content is supplied per finding by the #493 remediation-knowledge-base appendix, which document-engine.ts renders after this output and which carries per-finding provenance this prompt cannot. Tokens: {{docLabel}}, {{mspName}}, {{profileSample}}, {{findings}}, {{sections}}.',
  'insights',
  'Command — Insights',
  '/admin/insights',
  'claude-sonnet-4-6',
  $body550b$You are writing the {{docLabel}} for a client of {{mspName}}. Its purpose is to set out what is wrong with this tenant, in the order it should be fixed, and what changes when each item is dealt with.

WHAT THIS DOCUMENT IS NOT
A separate, per-finding step-by-step remediation appendix is appended after your output. Where a human-verified knowledge-base entry exists for a finding, that appendix renders it exactly as written; where one does not, it renders AI-generated guidance under an explicit "verify before running" warning. Provenance is stated per finding there. It cannot be stated for anything you write here.

So, in your narrative:
- Do NOT write PowerShell, Microsoft Graph, Azure CLI or any other runnable commands. Point the reader to the "Remediation Detail — Step by Step" appendix instead.
- Do NOT write numbered click-path instructions for the Microsoft admin centres.
- DO write the prioritisation, the sequence, the current state, the business impact, the effort and timeline, the risk of acting and of not acting, and how success is measured. That is what this document is for, and the appendix covers none of it.

SOURCE OF TRUTH
The two blocks below are your only source of truth. Every statement you make must trace back to one of them.

Tenant configuration telemetry:
{{profileSample}}

Findings from this tenant's own scan:
{{findings}}

NEVER INVENT. Do not add findings, counts, percentages, account or policy names, dates or scores that do not appear above. Do not invent a finding to fill out a phase. If a block tells you no telemetry or no findings were recorded, say that plainly in one sentence and write the rest of the plan from what you do have — a plan covering three real findings is worth more than one covering ten invented ones. This rule overrides every structural instruction below.

RANKING
The findings above are already given to you in a fixed, deliberate order — write them, and the CLOSING sequence below, in that order. Do not re-rank, re-sort, or reshuffle them. They are ordered Secure-first, Invest-last: every finding that requires no new Microsoft license purchase comes before every finding that does, no matter how many points either one is worth — this platform does not resell Microsoft licensing, so a license-gated recommendation is never prioritised ahead of a fix the client can make today for free. Within each of those two groups the findings are ranked by their point impact on the readiness score — how many points each fix returns — using the same basis as the score report, not by how severe the wording sounds. Where a finding states its own weight, impact, or affected item count, cite the point movement the fix produces. Where the input gives no point value, say plainly that the point value was not supplied. Do not invent a point value, and do not present a score you calculated yourself.

FOR EACH FINDING, IN THE GIVEN ORDER
- Current state: what is true today, with the real numbers from the evidence.
- Impact if fixed: what changes — the point movement where it is known, and the concrete operational or risk change either way.
- Effort and sequencing: roughly what it takes, what has to happen first, and what it unblocks.
- Risk: what could go wrong doing it, and what continues if it is not done.

CLOSING
A short ordered sequence: what gets done first, second, third, and why that order — following the given order above, never moving a license-purchase item ahead of a free, available-today item. Then how the client will know it worked — the observable change, not a restatement of the fix.

TONE
Write as {{mspName}} to the person who has to approve the work. Plain, active voice, no hedging, no filler. "Sixty-two accounts have no MFA; fixing it returns eleven points and closes the largest single hole in the tenant" — not "addressing MFA coverage would likely yield meaningful improvement." No "we recommend considering." Say what is wrong, what it costs, and what to do first.

OUTPUT
Output only valid HTML. No markdown, no code fences, no <style> blocks. All layout, typography and color come from the document style guide prepended above this prompt — do not invent a palette or restyle the page.

SECTIONS
Follow this required section structure, folding the ranked findings above into it rather than adding a duplicate set of headings. Where the structure below names a section that would call for commands or click paths, write that section as narrative and defer the mechanics to the appendix: {{sections}}$body550b$,
  $body550b$You are writing the {{docLabel}} for a client of {{mspName}}. Its purpose is to set out what is wrong with this tenant, in the order it should be fixed, and what changes when each item is dealt with.

WHAT THIS DOCUMENT IS NOT
A separate, per-finding step-by-step remediation appendix is appended after your output. Where a human-verified knowledge-base entry exists for a finding, that appendix renders it exactly as written; where one does not, it renders AI-generated guidance under an explicit "verify before running" warning. Provenance is stated per finding there. It cannot be stated for anything you write here.

So, in your narrative:
- Do NOT write PowerShell, Microsoft Graph, Azure CLI or any other runnable commands. Point the reader to the "Remediation Detail — Step by Step" appendix instead.
- Do NOT write numbered click-path instructions for the Microsoft admin centres.
- DO write the prioritisation, the sequence, the current state, the business impact, the effort and timeline, the risk of acting and of not acting, and how success is measured. That is what this document is for, and the appendix covers none of it.

SOURCE OF TRUTH
The two blocks below are your only source of truth. Every statement you make must trace back to one of them.

Tenant configuration telemetry:
{{profileSample}}

Findings from this tenant's own scan:
{{findings}}

NEVER INVENT. Do not add findings, counts, percentages, account or policy names, dates or scores that do not appear above. Do not invent a finding to fill out a phase. If a block tells you no telemetry or no findings were recorded, say that plainly in one sentence and write the rest of the plan from what you do have — a plan covering three real findings is worth more than one covering ten invented ones. This rule overrides every structural instruction below.

RANKING
The findings above are already given to you in a fixed, deliberate order — write them, and the CLOSING sequence below, in that order. Do not re-rank, re-sort, or reshuffle them. They are ordered Secure-first, Invest-last: every finding that requires no new Microsoft license purchase comes before every finding that does, no matter how many points either one is worth — this platform does not resell Microsoft licensing, so a license-gated recommendation is never prioritised ahead of a fix the client can make today for free. Within each of those two groups the findings are ranked by their point impact on the readiness score — how many points each fix returns — using the same basis as the score report, not by how severe the wording sounds. Where a finding states its own weight, impact, or affected item count, cite the point movement the fix produces. Where the input gives no point value, say plainly that the point value was not supplied. Do not invent a point value, and do not present a score you calculated yourself.

FOR EACH FINDING, IN THE GIVEN ORDER
- Current state: what is true today, with the real numbers from the evidence.
- Impact if fixed: what changes — the point movement where it is known, and the concrete operational or risk change either way.
- Effort and sequencing: roughly what it takes, what has to happen first, and what it unblocks.
- Risk: what could go wrong doing it, and what continues if it is not done.

CLOSING
A short ordered sequence: what gets done first, second, third, and why that order — following the given order above, never moving a license-purchase item ahead of a free, available-today item. Then how the client will know it worked — the observable change, not a restatement of the fix.

TONE
Write as {{mspName}} to the person who has to approve the work. Plain, active voice, no hedging, no filler. "Sixty-two accounts have no MFA; fixing it returns eleven points and closes the largest single hole in the tenant" — not "addressing MFA coverage would likely yield meaningful improvement." No "we recommend considering." Say what is wrong, what it costs, and what to do first.

OUTPUT
Output only valid HTML. No markdown, no code fences, no <style> blocks. All layout, typography and color come from the document style guide prepended above this prompt — do not invent a palette or restyle the page.

SECTIONS
Follow this required section structure, folding the ranked findings above into it rather than adding a duplicate set of headings. Where the structure below names a section that would call for commands or click paths, write that section as narrative and defer the mechanics to the appendix: {{sections}}$body550b$
)
ON CONFLICT (key) DO UPDATE SET
  description  = EXCLUDED.description,
  prompt_body  = EXCLUDED.prompt_body,
  default_body = EXCLUDED.default_body,
  updated_at   = now();

-- ── RECEIPT ──────────────────────────────────────────────────────────────────
-- Expect exactly 2 rows, both has_ordering_note = true.
SELECT
  key,
  (prompt_body LIKE '%Secure-first, Invest-last%') AS has_ordering_note,
  length(prompt_body)                              AS body_len,
  updated_at
FROM ai_prompts
WHERE key IN ('insights-consulting-copilot_readiness', 'insights-consulting-remediation_plan')
ORDER BY key;

-- If the receipt looks right:  COMMIT;
-- If anything looks wrong:     ROLLBACK;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-08-secure-first-invest-last-findings-order-550.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
COMMIT;
