-- Git #1534 (part of #1494) — Automatic routing of resolved Microsoft changes
-- into Change Control and Risk.
--
-- Routing is the third stage after interpretation (#1532, WHAT the change is) and
-- resolution (#1533, HOW MANY objects it touches for a tenant). It decides what a
-- resolved change BECOMES. Shane's settled rule (#1534, 2026-08-28):
--   • measured, affected_count > 0, AND a real structural date on the tenant's
--     Message Center post → AUTO-CREATE a Change Request, with Microsoft as the
--     implementer (#1497: every change gets a CR, including auto-approved ones).
--   • undated (incl. #1536's "date unclear") OR zero affected objects → PROPOSE
--     a CR only; nothing is created.
--   • a routed CR the customer later declines → an accepted risk (#1514).
-- That gate is the ONLY noise control; there is no second suppression mechanism.
--
-- This migration is ADDITIVE and idempotent: new nullable columns on
-- msp_change_requests and msp_risk_decisions, and one new ledger table. Nothing
-- is back-filled — every pre-routing CR/risk row leaves the new columns NULL.
--
-- Run against the local PostgreSQL 18 install in the same session that adds the
-- Drizzle definitions (additive DDL — a normal, reversible part of the task).

-- ── msp_change_requests: intake axis, implementer, link back to the announcement ─
ALTER TABLE msp_change_requests ADD COLUMN IF NOT EXISTS intake                    text;
ALTER TABLE msp_change_requests ADD COLUMN IF NOT EXISTS implementer               text;
ALTER TABLE msp_change_requests ADD COLUMN IF NOT EXISTS source_kind               text;
ALTER TABLE msp_change_requests ADD COLUMN IF NOT EXISTS source_graph_message_id   text;
ALTER TABLE msp_change_requests ADD COLUMN IF NOT EXISTS source_interpretation_id  integer;
ALTER TABLE msp_change_requests ADD COLUMN IF NOT EXISTS source_resolution_id      integer;

-- One auto-routed CR per (interpretation × tenant): the routing sweep's
-- idempotency guard. Partial — only routed rows carry source_interpretation_id —
-- so it never constrains wizard/drift CRs (which leave it NULL).
CREATE UNIQUE INDEX IF NOT EXISTS msp_change_requests_routed_interp_tenant_uidx
    ON msp_change_requests (source_interpretation_id, tenant_id)
    WHERE source_interpretation_id IS NOT NULL;

-- ── msp_risk_decisions: Change-Control ⟷ Risk pointers (#1514) ────────────────
ALTER TABLE msp_risk_decisions ADD COLUMN IF NOT EXISTS spawned_by_change_request_id    integer;
ALTER TABLE msp_risk_decisions ADD COLUMN IF NOT EXISTS discharged_by_change_request_id integer;

-- ── m365_change_routings: the routing decision ledger (+ proposal store) ─────────
CREATE TABLE IF NOT EXISTS m365_change_routings (
    id                  SERIAL PRIMARY KEY,
    msp_id              integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
    customer_id         integer NOT NULL,      -- tenants.id; no FK by design (matches m365_change_resolutions.customer_id)
    tenant_id           text NOT NULL,         -- M365 tenant GUID routed against, for provenance
    interpretation_id   integer NOT NULL REFERENCES m365_change_interpretations(id) ON DELETE CASCADE,
    resolution_id       integer,               -- the count this decision was taken against; NULL when decision = 'none'
    graph_message_id    text,                  -- the tenant's Message Center announcement, when one exists
    decision            text NOT NULL,         -- 'auto_created' | 'proposed' | 'declined_risk' | 'none'
    reason              text NOT NULL,         -- 'auto_created' | 'undated' | 'zero_affected' | 'not_measured' | 'no_announcement'
    intake              text,                  -- 'informed' | 'approval' | 'advisory'; NULL when nothing routed
    affected_count      integer,               -- snapshot at routing time; NULL when not measured
    has_structural_date boolean NOT NULL DEFAULT false,
    change_request_id   integer,               -- set when decision = 'auto_created'
    risk_decision_id    integer,               -- set when decision = 'declined_risk'
    routed_at           timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- The upsert identity: one current routing decision per interpretation per customer.
CREATE UNIQUE INDEX IF NOT EXISTS m365_change_routings_interp_customer_uidx
    ON m365_change_routings (interpretation_id, customer_id);

CREATE INDEX IF NOT EXISTS m365_change_routings_msp_id_idx        ON m365_change_routings (msp_id);
CREATE INDEX IF NOT EXISTS m365_change_routings_customer_id_idx   ON m365_change_routings (customer_id);
CREATE INDEX IF NOT EXISTS m365_change_routings_decision_idx      ON m365_change_routings (decision);
CREATE INDEX IF NOT EXISTS m365_change_routings_change_request_idx ON m365_change_routings (change_request_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-29-m365-change-routing-1534.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
