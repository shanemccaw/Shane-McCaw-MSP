-- Zoho CRM (#83) — lead_staging + Zoho pointer columns.
--
-- Run manually (per repo convention: no drizzle-kit push). Idempotent and
-- wrapped in a single transaction, so a partial earlier run is safe to repeat.
--
-- Scope note: this migration is ADDITIVE. It does NOT drop `leads`,
-- `quiz_leads` or `quick_win_quiz_results`, and it does not repoint the ten
-- foreign keys that currently reference `leads.id` (opportunities,
-- lead_qualifications, inbox_message_links, outreach_templates,
-- recommended_leads, users.linked_lead_id and four others). ~28 source files
-- still read those tables; retiring them is #84, gated on this phase landing.
-- Until then `lead_staging` is the canonical row for anything Zoho-bound and
-- the legacy tables are a read-compatibility surface.

BEGIN;

-- ── lead_staging ─────────────────────────────────────────────────────────────
-- Column set is the audited union of the real `leads` and `quiz_leads` shapes.
-- `quick_win_quiz_results` is NOT merged in: those rows have no name or email
-- at all, so they cannot be leads. They gain a promotion pointer instead.
CREATE TABLE IF NOT EXISTS lead_staging (
  id                        serial PRIMARY KEY,

  -- identity
  name                      text NOT NULL,
  email                     text NOT NULL,
  company                   text,
  phone                     text,
  role                      text,
  location                  text,

  -- provenance
  source                    text NOT NULL DEFAULT 'contact_form',
  status                    text NOT NULL DEFAULT 'new',
  how_found                 text,
  service_area              text,
  message                   text,
  company_size              text,
  notes                     text,

  -- Zoho linkage. Zoho record ids are 18-19 digit numeric strings — text, not
  -- integer/bigint.
  zoho_lead_id              text,
  zoho_converted_at         timestamptz,
  zoho_sync_state           text NOT NULL DEFAULT 'local',
  zoho_sync_error           text,
  zoho_synced_at            timestamptz,

  -- Qualification / Scoring Engine (unchanged semantics, from `leads`)
  score                     integer NOT NULL DEFAULT 0,
  previous_score            integer NOT NULL DEFAULT 0,
  stage                     text NOT NULL DEFAULT 'Cold',
  last_qualified_at         timestamp,
  industry                  text,
  employee_count            integer,
  license_tier              text,
  tenant_age                integer,
  it_team_size              integer,
  pain_points               jsonb NOT NULL DEFAULT '[]'::jsonb,
  maturity_indicators       jsonb NOT NULL DEFAULT '[]'::jsonb,
  engagement_signals        jsonb NOT NULL DEFAULT '[]'::jsonb,
  urgency_signals           jsonb NOT NULL DEFAULT '[]'::jsonb,
  priority_score            integer NOT NULL DEFAULT 0,
  pricing_influence_score   integer NOT NULL DEFAULT 0,

  -- Quiz result columns (from `quiz_leads`)
  quiz_type                 text,
  total_score               integer NOT NULL DEFAULT 0,
  tier                      text,
  recommended_service       text,
  category_scores           jsonb NOT NULL DEFAULT '{}'::jsonb,
  analysis_text             jsonb DEFAULT '{"whatThisMeans":"","whyThisFits":"","roiProjection":""}'::jsonb,
  lead_offer_result         jsonb DEFAULT NULL,
  conversation              jsonb NOT NULL DEFAULT '[]'::jsonb,
  detected_seats            integer,
  contacted_at              timestamp,

  -- pre-cutover row pointers (dropped in #84)
  legacy_lead_id            integer,
  legacy_quiz_lead_id       integer,

  deleted_at                timestamp,
  created_at                timestamp NOT NULL DEFAULT now(),
  updated_at                timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_staging_email_idx         ON lead_staging (email);
CREATE INDEX IF NOT EXISTS lead_staging_zoho_lead_id_idx  ON lead_staging (zoho_lead_id);
CREATE INDEX IF NOT EXISTS lead_staging_sync_state_idx    ON lead_staging (zoho_sync_state);

-- ── users.zoho_contact_id ────────────────────────────────────────────────────
-- Bare pointer, same shape as the existing users.linked_lead_id: no FK,
-- because the referenced record lives in Zoho, not in this database.
ALTER TABLE users ADD COLUMN IF NOT EXISTS zoho_contact_id text;

-- ── quick_win_quiz_results.lead_staging_id ───────────────────────────────────
-- Anonymous results stay anonymous until identity capture promotes them.
ALTER TABLE quick_win_quiz_results
  ADD COLUMN IF NOT EXISTS lead_staging_id integer REFERENCES lead_staging(id) ON DELETE SET NULL;

-- ── Scoring-evidence side-records ────────────────────────────────────────────
-- opportunities / lead_qualifications keep every scoring column exactly as-is;
-- they simply gain a pointer to the Zoho Deal the evidence produced.
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS zoho_deal_id    text,
  ADD COLUMN IF NOT EXISTS lead_staging_id integer REFERENCES lead_staging(id) ON DELETE SET NULL;

ALTER TABLE lead_qualifications
  ADD COLUMN IF NOT EXISTS zoho_deal_id    text,
  ADD COLUMN IF NOT EXISTS lead_staging_id integer REFERENCES lead_staging(id) ON DELETE SET NULL;

-- ── recommended_leads.converted_lead_id → Zoho ───────────────────────────────
-- The old column was an FK to leads.id. A converted recommendation now becomes
-- a staged lead immediately and a Zoho Lead asynchronously, so both pointers
-- exist: the local one is set at conversion time, the Zoho one when the drain
-- reports the real id. The old column is left in place for #84 to drop, so this
-- migration cannot lose data if it is run before the app is redeployed.
ALTER TABLE recommended_leads
  ADD COLUMN IF NOT EXISTS converted_zoho_lead_id     text,
  ADD COLUMN IF NOT EXISTS converted_lead_staging_id  integer REFERENCES lead_staging(id) ON DELETE SET NULL;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- OPTIONAL BACKFILL — review before running. Deliberately separate from the
-- schema transaction above so the schema can land without moving any data.
--
-- Copies existing leads and quiz_leads into lead_staging, keeping the source
-- row id in legacy_lead_id / legacy_quiz_lead_id. Re-runnable: the NOT EXISTS
-- guards mean a second run inserts nothing. Every backfilled row lands with
-- zoho_sync_state = 'local', so nothing is pushed to Zoho until something
-- explicitly queues it.
--
-- BEGIN;
--
-- INSERT INTO lead_staging (
--   name, email, company, phone, role, location, source, status, how_found,
--   service_area, message, company_size, notes, score, previous_score, stage,
--   last_qualified_at, industry, employee_count, license_tier, tenant_age,
--   it_team_size, pain_points, maturity_indicators, engagement_signals,
--   urgency_signals, priority_score, pricing_influence_score, deleted_at,
--   created_at, updated_at, legacy_lead_id
-- )
-- SELECT
--   l.name, l.email, l.company, l.phone, l.role, l.location, l.source, l.status,
--   l.how_found, l.service_area, l.message, l.company_size, l.notes, l.score,
--   l.previous_score, l.stage, l.last_qualified_at, l.industry, l.employee_count,
--   l.license_tier, l.tenant_age, l.it_team_size, l.pain_points,
--   l.maturity_indicators, l.engagement_signals, l.urgency_signals,
--   l.priority_score, l.pricing_influence_score, l.deleted_at, l.created_at,
--   l.updated_at, l.id
-- FROM leads l
-- WHERE NOT EXISTS (SELECT 1 FROM lead_staging s WHERE s.legacy_lead_id = l.id);
--
-- -- quiz_leads whose email is already staged are merged into that row rather
-- -- than inserted twice, since email is the identity key the Zoho upsert uses.
-- UPDATE lead_staging s
-- SET quiz_type            = q.quiz_type,
--     total_score          = q.total_score,
--     tier                 = q.tier,
--     recommended_service  = q.recommended_service,
--     category_scores      = q.category_scores,
--     analysis_text        = q.analysis_text,
--     lead_offer_result    = q.lead_offer_result,
--     conversation         = q.conversation,
--     detected_seats       = q.detected_seats,
--     contacted_at         = q.contacted_at,
--     legacy_quiz_lead_id  = q.id,
--     updated_at           = now()
-- FROM quiz_leads q
-- WHERE lower(s.email) = lower(q.email)
--   AND s.legacy_quiz_lead_id IS NULL;
--
-- INSERT INTO lead_staging (
--   name, email, company, source, status, quiz_type, total_score, tier,
--   recommended_service, category_scores, analysis_text, lead_offer_result,
--   conversation, detected_seats, contacted_at, created_at, legacy_quiz_lead_id
-- )
-- SELECT
--   q.name, q.email, q.company, 'quiz', 'new', q.quiz_type, q.total_score,
--   q.tier, q.recommended_service, q.category_scores, q.analysis_text,
--   q.lead_offer_result, q.conversation, q.detected_seats, q.contacted_at,
--   q.created_at, q.id
-- FROM quiz_leads q
-- WHERE NOT EXISTS (SELECT 1 FROM lead_staging s WHERE s.legacy_quiz_lead_id = q.id)
--   AND NOT EXISTS (SELECT 1 FROM lead_staging s WHERE lower(s.email) = lower(q.email));
--
-- -- Carry the old recommended_leads pointer onto the new staging pointer.
-- UPDATE recommended_leads r
-- SET converted_lead_staging_id = s.id
-- FROM lead_staging s
-- WHERE s.legacy_lead_id = r.converted_lead_id
--   AND r.converted_lead_id IS NOT NULL
--   AND r.converted_lead_staging_id IS NULL;
--
-- COMMIT;
