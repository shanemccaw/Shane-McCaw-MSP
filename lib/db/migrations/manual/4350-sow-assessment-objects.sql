-- 4350-sow-assessment-objects.sql
--
-- Git #4350 — SOW & Assessment expansion. The four operator-authored assessment
-- objects that the read-only #3475 viewer never had as real CRUD rows: Scope
-- Item, Finding, Gap, Risk. Evidence is NOT re-modelled here — it reuses the
-- shared evidence/evidence_links layer (#4353) via linked_type
-- 'scope_item'|'finding'|'gap'|'risk'. Conversions target existing tables:
-- Gap→POA&M (msp_poams), Gap/Risk→CAB (msp_change_requests), Gap→Automation
-- (automations, #4354) — those links are real nullable FKs here.
--
-- Additive only (four new tables). Safe against local dev and reversible
-- (DROP TABLE restores prior state). Scoping mirrors `automations`: customer_id
-- (tenants.id space, no FK) + msp_id (FK msps, cascade). Peer cross-object links
-- (related_*_id) are soft integer references with no FK, to avoid a circular
-- finding⇄gap⇄risk FK cycle — the same soft-reference pattern evidence_links and
-- automations already use.

-- A. Scope Definition
CREATE TABLE IF NOT EXISTS assessment_scope_items (
  id                 SERIAL PRIMARY KEY,
  customer_id        INTEGER NOT NULL,
  msp_id             INTEGER NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  category           TEXT NOT NULL,
  title              TEXT NOT NULL,
  description        TEXT,
  priority           TEXT NOT NULL DEFAULT 'medium',
  status             TEXT NOT NULL DEFAULT 'proposed',
  created_by_user_id INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assessment_scope_items_customer_idx ON assessment_scope_items (customer_id);
CREATE INDEX IF NOT EXISTS assessment_scope_items_msp_idx ON assessment_scope_items (msp_id);

-- B. Assessment Findings
CREATE TABLE IF NOT EXISTS assessment_findings (
  id                 SERIAL PRIMARY KEY,
  customer_id        INTEGER NOT NULL,
  msp_id             INTEGER NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  description        TEXT,
  severity           TEXT NOT NULL DEFAULT 'medium',
  category           TEXT,
  related_gap_id     INTEGER,
  status             TEXT NOT NULL DEFAULT 'open',
  created_by_user_id INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assessment_findings_customer_idx ON assessment_findings (customer_id);
CREATE INDEX IF NOT EXISTS assessment_findings_msp_idx ON assessment_findings (msp_id);

-- C. Gap Analysis
CREATE TABLE IF NOT EXISTS assessment_gaps (
  id                        SERIAL PRIMARY KEY,
  customer_id               INTEGER NOT NULL,
  msp_id                    INTEGER NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  title                     TEXT NOT NULL,
  description               TEXT,
  severity                  TEXT NOT NULL DEFAULT 'medium',
  category                  TEXT,
  related_finding_id        INTEGER,
  related_risk_id           INTEGER,
  recommended_remediation   TEXT,
  status                    TEXT NOT NULL DEFAULT 'open',
  converted_to_poam_id      INTEGER REFERENCES msp_poams(id) ON DELETE SET NULL,
  converted_to_cab_id       INTEGER REFERENCES msp_change_requests(id) ON DELETE SET NULL,
  converted_to_automation_id INTEGER REFERENCES automations(id) ON DELETE SET NULL,
  created_by_user_id        INTEGER,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assessment_gaps_customer_idx ON assessment_gaps (customer_id);
CREATE INDEX IF NOT EXISTS assessment_gaps_msp_idx ON assessment_gaps (msp_id);

-- D. Risk Register
CREATE TABLE IF NOT EXISTS assessment_risks (
  id                   SERIAL PRIMARY KEY,
  customer_id          INTEGER NOT NULL,
  msp_id               INTEGER NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  description          TEXT,
  likelihood           TEXT NOT NULL DEFAULT 'medium',
  impact               TEXT NOT NULL DEFAULT 'medium',
  severity             TEXT NOT NULL DEFAULT 'medium',
  category             TEXT,
  related_gap_id       INTEGER,
  status               TEXT NOT NULL DEFAULT 'open',
  converted_to_poam_id INTEGER REFERENCES msp_poams(id) ON DELETE SET NULL,
  converted_to_cab_id  INTEGER REFERENCES msp_change_requests(id) ON DELETE SET NULL,
  created_by_user_id   INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assessment_risks_customer_idx ON assessment_risks (customer_id);
CREATE INDEX IF NOT EXISTS assessment_risks_msp_idx ON assessment_risks (msp_id);

-- Self-mark so Simulator Studio's Migrations tree reflects DB reality (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4350-sow-assessment-objects.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
