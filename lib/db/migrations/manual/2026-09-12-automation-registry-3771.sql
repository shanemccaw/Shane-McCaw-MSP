-- 2026-09-12-automation-registry-3771.sql
--
-- Git #3771 — Automation registry: a persistent, browsable list of the
-- Microsoft-ecosystem automations Shane builds for a customer — Power
-- Automate flows and Power Platform/Azure AI Studio agents, same shape,
-- distinguished by `type`. Deliberately NOT a time-log stream — that already
-- exists (retainer_work_log, #1293) and is unchanged by this migration.
--
-- Scoping matches every other customer-scoped table in this schema:
-- customer_id is a tenants.id carried WITHOUT a foreign key; msp_id
-- references msps for MSP-scoped reads. Enum-ish columns (type, status) are
-- plain text with no CHECK, per the repo convention, so the vocabulary can
-- widen in code without a migration.
--
-- Hand-written to be run by Shane, or self-run by an agent for additive DDL
-- per CLAUDE.md's Database section. Idempotent: safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS automation_registry (
  id           SERIAL PRIMARY KEY,
  customer_id  INTEGER NOT NULL,
  msp_id       INTEGER NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  name         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS automation_registry_customer_id_idx
  ON automation_registry (customer_id);
CREATE INDEX IF NOT EXISTS automation_registry_msp_id_idx
  ON automation_registry (msp_id);

-- Self-marking run record so Simulator Studio's Migrations tree reflects
-- reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-12-automation-registry-3771.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
