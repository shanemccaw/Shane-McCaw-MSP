-- Git #1592 — Settings: Change control policy + Departments have NO
-- persistence endpoint at all.
--
-- portal-v2-settings.tsx's "Change control policy" and "Departments" sections
-- were 100% client-only React state (flagged honestly by #1463's
-- pv2-set-cc-nodata / pv2-set-dept-nodata badges, never built). This migration
-- is the backend: four new tables, all additive, all scoped by customer_id
-- (tenants.id, straight off the JWT — no FK, matching portal_ownership_* and
-- m365_change_routings.customer_id above).
--
-- NOT #1496's approval model. #1496 ("Change Control: Approval model +
-- canApproveChanges capability flag") is still open/unbuilt — it will be the
-- per-CHANGE approval decision trail (cr_approvals: stage, decision, reason,
-- decidedAt) attached to an individual msp_change_requests row.
-- portal_change_control_policy below is the tenant-wide POLICY consulted when a
-- change request is evaluated (what is gated, how many signatures, who is
-- eligible to sign) — a different object, recorded as settled on #1592 itself.
-- portal_change_control_approvers.person_id reuses the same wire-person-id
-- convention ("u{id}") as portal_ownership_assignments.owner_person_id, so the
-- two models share one identity scheme rather than inventing a second.
--
-- Departments' headcounts are NOT stored here — they are computed live from
-- users.department for this tenant's active users. This migration only adds
-- the mapping overlay (map a department to a security group instead of the
-- Entra attribute).
--
-- Run against the local PostgreSQL 18 install in the same session that adds
-- the Drizzle definitions (additive DDL — a normal, reversible part of the task).

-- ── Change control policy: the tenant-wide master switch + rules ─────────────
CREATE TABLE IF NOT EXISTS portal_change_control_policy (
    id                        SERIAL PRIMARY KEY,
    customer_id               integer NOT NULL,
    enabled                   boolean NOT NULL DEFAULT true,
    gated                     jsonb NOT NULL DEFAULT '{}',
    required_signatures       integer NOT NULL DEFAULT 1,
    require_separate_approver boolean NOT NULL DEFAULT true,
    enforce_freeze_calendar   boolean NOT NULL DEFAULT false,
    allow_emergency_path      boolean NOT NULL DEFAULT false,
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS portal_change_control_policy_customer_id_idx
    ON portal_change_control_policy (customer_id);

-- ── Who may approve, by band ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_change_control_approvers (
    id           SERIAL PRIMARY KEY,
    customer_id  integer NOT NULL,
    band         text NOT NULL,   -- 'normal' | 'emergency'
    person_id    text NOT NULL,   -- wire person id, "u{id}" — an active user of this tenant
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_change_control_approvers_customer_id_idx
    ON portal_change_control_approvers (customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS portal_change_control_approvers_customer_band_person_idx
    ON portal_change_control_approvers (customer_id, band, person_id);

-- ── Notification rules, one row per event key ─────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_change_control_notifications (
    id              SERIAL PRIMARY KEY,
    customer_id     integer NOT NULL,
    event_key       text NOT NULL,   -- see CC_NOTIF_EVENT_KEYS
    channel         text NOT NULL,
    recipient_text  text NOT NULL,
    lead_time       text NOT NULL,
    enabled         boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_change_control_notifications_customer_id_idx
    ON portal_change_control_notifications (customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS portal_change_control_notifications_customer_event_idx
    ON portal_change_control_notifications (customer_id, event_key);

-- ── Departments: the group-mapping overlay only (headcounts stay live) ───────
CREATE TABLE IF NOT EXISTS portal_department_mappings (
    id                 SERIAL PRIMARY KEY,
    customer_id        integer NOT NULL,
    department_name    text NOT NULL,             -- exactly as it appears on users.department
    source             text NOT NULL DEFAULT 'attribute',  -- 'attribute' | 'group'
    security_group_id  text,
    security_group_name text,
    unmapped_fallback  text NOT NULL DEFAULT 'attribute_fallback', -- 'unmapped' | 'attribute_fallback'
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_department_mappings_customer_id_idx
    ON portal_department_mappings (customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS portal_department_mappings_customer_department_idx
    ON portal_department_mappings (customer_id, department_name);

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-29-portal-settings-cc-policy-departments-1592.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
