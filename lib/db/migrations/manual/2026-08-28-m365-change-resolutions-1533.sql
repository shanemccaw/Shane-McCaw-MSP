-- Git #1533 (part of #1494) — M365 Changes resolution layer: schema.
--
-- The RESOLUTION layer — the other half of #1494's split. An interpretation
-- (m365_change_interpretations, #1532) names WHAT to count; a resolution row is
-- that count actually run against ONE tenant's real estate: "you have 412
-- mailboxes with EWS enabled". One row per (interpretation × customer),
-- overwritten on re-measure — the tenant's CURRENT answer, not a history.
--
-- The number is the hinge (#1533): zero affected objects = the post is noise for
-- that customer; non-zero with a deadline = the routing trigger. Zero must only
-- ever be a MEASURED zero: where no probe exists or it could not run, status is
-- 'not_measured' and affected_count is NULL — never 0 — and the portal keeps its
-- honest wording ("your tenant has not been read against this notice").
--
-- No second probe mechanism: `basis` records which EXISTING infrastructure
-- produced the number — 'monitor_check' (tenant_monitor_profiles / a live
-- executeMonitorCheck, which dispatches Graph / ca-ps-execution PowerShell /
-- sharepoint-admin / dns by the check's own executorType) or 'license_snapshot'
-- (license_assignment_snapshots, covering the SKU cases).
--
-- Shane To-Do: run this file against the local PostgreSQL 18 install before the
-- resolution endpoints are used. Until it runs, resolution reads honestly report
-- nothing measured — never fixture data.

CREATE TABLE IF NOT EXISTS m365_change_resolutions (
    id                SERIAL PRIMARY KEY,
    msp_id            integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
    customer_id       integer NOT NULL,        -- tenants.id; no FK by design (matches msp_message_center_items.customer_id)
    tenant_id         text NOT NULL,           -- M365 tenant GUID the count ran against, for provenance
    interpretation_id integer NOT NULL REFERENCES m365_change_interpretations(id) ON DELETE CASCADE,
    status            text NOT NULL,           -- "measured" | "not_measured" | "error"
    affected_count    integer,                 -- NULL unless measured — a not-measured answer is never zero
    basis             text,                    -- "monitor_check" | "license_snapshot"; NULL unless measured
    basis_detail      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- provenance: checkKey/live/profileStatus, matchedSkus/snapshotRunId, not_measured reason
    error_message     text,
    measured_at       timestamptz,             -- NULL unless measured
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- The upsert identity: one current answer per interpretation per customer.
CREATE UNIQUE INDEX IF NOT EXISTS m365_change_resolutions_interp_customer_uidx
    ON m365_change_resolutions (interpretation_id, customer_id);

CREATE INDEX IF NOT EXISTS m365_change_resolutions_msp_id_idx
    ON m365_change_resolutions (msp_id);
CREATE INDEX IF NOT EXISTS m365_change_resolutions_customer_id_idx
    ON m365_change_resolutions (customer_id);
CREATE INDEX IF NOT EXISTS m365_change_resolutions_interpretation_idx
    ON m365_change_resolutions (interpretation_id);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-28-m365-change-resolutions-1533.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
