-- Decommission Legacy CRM — Phase A (#135, parent #77).
--
-- Run manually (per repo convention: no drizzle-kit push). Idempotent.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1 — REQUIRED BACKFILL. Run this BEFORE deploying the #135 code.
-- ─────────────────────────────────────────────────────────────────────────────
-- #83 shipped this same backfill COMMENTED OUT and labelled "OPTIONAL", because
-- at that point `lead_staging` was additive and every reader was still on the
-- legacy tables. #135 re-points readers at `lead_staging`, which flips the
-- backfill from optional to load-bearing: without it, every re-pointed surface
-- (Admin Overview lead lists and the assessments feed, client quiz history,
-- portal quiz results, the public personalization tier, the quiz-pain recalculate
-- endpoint) reads an EMPTY table and honestly reports nothing. That is a silent
-- data-visibility regression, not an error anyone would see in a log.
--
-- If #83's optional block was already run, this is a no-op: every statement is
-- guarded by NOT EXISTS / IS NULL, so a second run inserts and updates nothing.
--
-- Every backfilled row lands with zoho_sync_state = 'local', so nothing is
-- pushed to Zoho until something explicitly queues it.

BEGIN;

-- ── leads → lead_staging ─────────────────────────────────────────────────────
INSERT INTO lead_staging (
  name, email, company, phone, role, location, source, status, how_found,
  service_area, message, company_size, notes, score, previous_score, stage,
  last_qualified_at, industry, employee_count, license_tier, tenant_age,
  it_team_size, pain_points, maturity_indicators, engagement_signals,
  urgency_signals, priority_score, pricing_influence_score, deleted_at,
  created_at, updated_at, legacy_lead_id
)
SELECT
  l.name, l.email, l.company, l.phone, l.role, l.location, l.source, l.status,
  l.how_found, l.service_area, l.message, l.company_size, l.notes, l.score,
  l.previous_score, l.stage, l.last_qualified_at, l.industry, l.employee_count,
  l.license_tier, l.tenant_age, l.it_team_size, l.pain_points,
  l.maturity_indicators, l.engagement_signals, l.urgency_signals,
  l.priority_score, l.pricing_influence_score, l.deleted_at, l.created_at,
  l.updated_at, l.id
FROM leads l
WHERE NOT EXISTS (SELECT 1 FROM lead_staging s WHERE s.legacy_lead_id = l.id);

-- ── quiz_leads → lead_staging, merging onto an already-staged email ──────────
-- email is the identity key the Zoho upsert uses, so a quiz submission from an
-- address that is already staged updates that row rather than inserting a second.
UPDATE lead_staging s
SET quiz_type            = q.quiz_type,
    total_score          = q.total_score,
    tier                 = q.tier,
    recommended_service  = q.recommended_service,
    category_scores      = q.category_scores,
    analysis_text        = q.analysis_text,
    lead_offer_result    = q.lead_offer_result,
    conversation         = q.conversation,
    detected_seats       = q.detected_seats,
    contacted_at         = q.contacted_at,
    legacy_quiz_lead_id  = q.id,
    updated_at           = now()
FROM quiz_leads q
WHERE lower(s.email) = lower(q.email)
  AND s.legacy_quiz_lead_id IS NULL;

-- ── quiz_leads with no staged email yet ──────────────────────────────────────
INSERT INTO lead_staging (
  name, email, company, source, status, quiz_type, total_score, tier,
  recommended_service, category_scores, analysis_text, lead_offer_result,
  conversation, detected_seats, contacted_at, created_at, legacy_quiz_lead_id
)
SELECT
  q.name, q.email, q.company, 'quiz', 'new', q.quiz_type, q.total_score,
  q.tier, q.recommended_service, q.category_scores, q.analysis_text,
  q.lead_offer_result, q.conversation, q.detected_seats, q.contacted_at,
  q.created_at, q.id
FROM quiz_leads q
WHERE NOT EXISTS (SELECT 1 FROM lead_staging s WHERE s.legacy_quiz_lead_id = q.id)
  AND NOT EXISTS (SELECT 1 FROM lead_staging s WHERE lower(s.email) = lower(q.email));

-- ── Carry the old recommended_leads pointer onto the new staging pointer ─────
UPDATE recommended_leads r
SET converted_lead_staging_id = s.id
FROM lead_staging s
WHERE s.legacy_lead_id = r.converted_lead_id
  AND r.converted_lead_id IS NOT NULL
  AND r.converted_lead_staging_id IS NULL;

COMMIT;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2 — VERIFICATION. Run after Part 1; all three should return 0.
-- ─────────────────────────────────────────────────────────────────────────────
-- Any leads row with no staging row:
--   SELECT count(*) FROM leads l
--   WHERE NOT EXISTS (SELECT 1 FROM lead_staging s WHERE s.legacy_lead_id = l.id);
--
-- Any quiz_leads row neither merged nor inserted:
--   SELECT count(*) FROM quiz_leads q
--   WHERE NOT EXISTS (SELECT 1 FROM lead_staging s WHERE s.legacy_quiz_lead_id = q.id)
--     AND NOT EXISTS (SELECT 1 FROM lead_staging s WHERE lower(s.email) = lower(q.email));
--
-- Any recommended_leads pointer left unbridged:
--   SELECT count(*) FROM recommended_leads r
--   WHERE r.converted_lead_id IS NOT NULL AND r.converted_lead_staging_id IS NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART 3 — NO TABLE DROPS IN THIS PHASE. Deliberate; see below.
-- ─────────────────────────────────────────────────────────────────────────────
-- #135's spec expected `leads`, `quiz_leads`, `opportunities` and
-- `lead_qualifications` to be droppable once the routes and pages stopped reading
-- them. A fresh audit says none of the four can drop in Phase A, and shipping a
-- DROP here would break work that is explicitly out of this phase's scope.
--
-- `opportunities` — still WRITTEN by `crm-pipeline.ts` (ensureOpportunityForSow),
--   which is Phase B's file (#136), and still READ through `GET /api/opportunities`
--   by admin-panel's ConvertToTaskModal and the Workflow Builder / Workflow List
--   object pickers, plus shane-mobile's pipeline screens. Not droppable.
--
-- `lead_qualifications` — still written and read by `POST /api/leads/qualification/
--   :id/approve|reject|snooze` and `GET /api/leads/qualification/pending`, which
--   back admin-panel's QualificationModal (NOT one of the four pages #135 deletes),
--   and by inbox.ts's qualify-and-promote path. Not droppable.
--
-- `leads` — has NINE inbound FK columns, three of them NOT NULL:
--     opportunities.lead_id          NOT NULL, ON DELETE CASCADE   (#136)
--     lead_qualifications.lead_id    NOT NULL, ON DELETE CASCADE   (#136)
--     lead_intent_events.lead_id     NOT NULL, ON DELETE CASCADE   (#113/#114)
--     users.linked_lead_id           ON DELETE SET NULL
--     emails.linked_lead_id          ON DELETE SET NULL
--     email_events.lead_id           ON DELETE SET NULL
--     follow_up_events.lead_id       ON DELETE SET NULL
--     marketing_tasks.related_lead_id ON DELETE SET NULL
--     inbox_message_links.lead_id    ON DELETE SET NULL
--     outreach_templates.lead_id     ON DELETE SET NULL
--   and it is still INSERTED INTO by three out-of-scope modules —
--   `crm-pipeline.ts` (x2, #136) and `lead-intent.ts` (#113/#114). Dropping it
--   would require re-keying satellite tables owned by two other issues. Not
--   droppable in Phase A.
--
--   (All three of those writers DO also call `ensureLeadStagingForEmail`, which is
--   why re-pointing READS at `lead_staging` is safe: staging is a superset. It is
--   the WRITES that keep `leads` alive.)
--
-- `quiz_leads` — the only one with zero inbound FKs, and after #135 nothing in
--   api-server reads or writes it. It is STILL not dropped here, for one reason:
--   the Part 1 backfill reads it, and `quiz_analytics_events` rows carry a
--   `quizLeadId` inside a JSON `properties` blob with no FK to enforce or migrate.
--   Drop it in Phase B once that blob is reconciled, with:
--     -- DROP TABLE IF EXISTS quiz_leads;
--   Left commented deliberately — do not run it in this phase.
