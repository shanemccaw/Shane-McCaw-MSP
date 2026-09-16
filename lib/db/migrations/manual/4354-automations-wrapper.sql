-- 4354-automations-wrapper.sql
--
-- Git #4354 — real unified Automation wrapper. One record that wraps a Script
-- Library script (#4291), a Runbook (#3479) or a Remediation Step (#3471), and
-- can additionally be linked to a POA&M, a Change Control / CAB change request,
-- and a Remediation Step. Distinct from `automation_registry` (#3771): that is a
-- manual Microsoft-ecosystem catalogue with no execution; this wraps a real
-- executable/actionable row and delegates run + history to its existing
-- mechanism.
--
-- Additive only (new table). Safe to run against local dev and reversible
-- (DROP TABLE would restore prior state). The wrapped row is a polymorphic
-- (type + wrapped_ref_id text) reference because the three underlying tables do
-- not share a PK type (powershell_scripts.id is UUID; portal_runbooks.id and
-- remediation_tracker_steps.id are serial ints). Governance links are real
-- nullable FKs (all serial-int targets).

CREATE TABLE IF NOT EXISTS automations (
  id                          SERIAL PRIMARY KEY,
  customer_id                 INTEGER NOT NULL,
  msp_id                      INTEGER NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  type                        TEXT NOT NULL,
  wrapped_ref_id              TEXT NOT NULL,
  name                        TEXT NOT NULL,
  description                 TEXT,
  linked_poam_id              INTEGER REFERENCES msp_poams(id) ON DELETE SET NULL,
  linked_cab_id               INTEGER REFERENCES msp_change_requests(id) ON DELETE SET NULL,
  linked_remediation_step_id  INTEGER REFERENCES remediation_tracker_steps(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS automations_customer_id_idx ON automations (customer_id);
CREATE INDEX IF NOT EXISTS automations_msp_id_idx ON automations (msp_id);
CREATE INDEX IF NOT EXISTS automations_type_ref_idx ON automations (type, wrapped_ref_id);

-- Self-mark so Simulator Studio's Migrations tree reflects DB reality (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('4354-automations-wrapper.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
