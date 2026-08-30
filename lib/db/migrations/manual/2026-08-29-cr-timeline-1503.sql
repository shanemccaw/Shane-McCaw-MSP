-- #1503 — Change Control CR timeline: cr_events, cr_comments, cr_attachments.
--
-- There was no per-CR event history anywhere in the platform. `msp_audit_logs`
-- is platform-wide and carries nothing CR-shaped; "Add a comment" was one of
-- five dead buttons in the retired prototype (proto 1513-1524, no `onClick`).
--
-- All three tables are ADDITIVE and APPEND-ONLY: no UPDATE, no DELETE, no
-- soft-edit column anywhere in this file or in the application code that
-- writes to them. A change request is immutable after close — that is what
-- makes the register defensible — and the timeline follows the same rule: a
-- correction is a new row, never an edit to an old one.
--
-- `cr_events` is also the source table for #1506 (change metrics): lead time,
-- success rate, emergency ratio and CAB throughput are all derivable from this
-- table without a second pass — see its column comments in
-- lib/db/src/schema/msp.ts for exactly how.
--
-- Part 1 creates the three tables.
-- Part 2 backfills `cr_events` for every CR that predates this feature, from
-- the two real sources of truth that already exist: `msp_change_requests`
-- itself (for the `raised` event and, where the CR has already left
-- `pending_approval`, its current lifecycle state) and `cr_approvals` (for
-- every approval-ledger decision already recorded, #1496). Nothing is
-- invented: every backfilled row's `occurredAt` is the best REAL timestamp
-- available for that transition (the approval's own `decided_at`, or the CR's
-- `created_at`/`updated_at` where no more precise moment was ever recorded —
-- true of every CR that predates this feature, since nothing captured
-- per-transition timing before now). Idempotent: safe to re-run.

BEGIN;

-- ─── Part 1: the three tables ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cr_events (
  id                 serial PRIMARY KEY,
  change_request_id  integer NOT NULL REFERENCES msp_change_requests(id) ON DELETE CASCADE,
  msp_id             integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  tenant_id          text NOT NULL,
  event_type         text NOT NULL,   -- raised | approved | rejected | superseded | scheduled | in_progress | completed | rolled_back
  from_value         text,
  to_value           text NOT NULL,
  stage              integer,
  actor_role         text NOT NULL,   -- customer | msp | microsoft | system
  actor_person_id    text,
  actor_name         text,
  reason             text,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cr_events_change_request_id_idx ON cr_events(change_request_id);
CREATE INDEX IF NOT EXISTS cr_events_msp_tenant_idx ON cr_events(msp_id, tenant_id);
CREATE INDEX IF NOT EXISTS cr_events_type_occurred_idx ON cr_events(event_type, occurred_at);

CREATE TABLE IF NOT EXISTS cr_comments (
  id                 serial PRIMARY KEY,
  change_request_id  integer NOT NULL REFERENCES msp_change_requests(id) ON DELETE CASCADE,
  msp_id             integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  tenant_id          text NOT NULL,
  author_role        text NOT NULL,   -- customer | msp
  author_person_id   text NOT NULL,
  author_name        text NOT NULL,
  body               text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cr_comments_change_request_id_idx ON cr_comments(change_request_id);
CREATE INDEX IF NOT EXISTS cr_comments_msp_tenant_idx ON cr_comments(msp_id, tenant_id);

CREATE TABLE IF NOT EXISTS cr_attachments (
  id                   serial PRIMARY KEY,
  change_request_id    integer NOT NULL REFERENCES msp_change_requests(id) ON DELETE CASCADE,
  msp_id               integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  tenant_id            text NOT NULL,
  kind                 text NOT NULL DEFAULT 'other',  -- evidence | test_result | approval_email | other
  label                text NOT NULL,
  external_url         text,
  mime_type            text,
  size_bytes           integer,
  uploaded_by_role     text NOT NULL,  -- customer | msp
  uploaded_by_person_id text NOT NULL,
  uploaded_by_name     text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cr_attachments_change_request_id_idx ON cr_attachments(change_request_id);
CREATE INDEX IF NOT EXISTS cr_attachments_msp_tenant_idx ON cr_attachments(msp_id, tenant_id);

-- ─── Part 2: backfill cr_events for pre-existing CRs ────────────────────────

-- 2a. One `raised` event per existing CR, at its real created_at. `requestedBy`
--     is free text (an email, or the literal "Microsoft 365 change routing"
--     string m365-change-router.ts writes) — actor_role is derived from real
--     evidence: the routing literal names Microsoft; otherwise a join to
--     `users` on that email's real platform role tells us customer vs msp;
--     unresolvable (no matching user — e.g. a hold-window/runbook system
--     actor) falls back to 'system' rather than guessing.
INSERT INTO cr_events (
  change_request_id, msp_id, tenant_id, event_type, from_value, to_value,
  actor_role, actor_person_id, actor_name, occurred_at, created_at
)
SELECT
  cr.id,
  cr.msp_id,
  cr.tenant_id,
  'raised',
  NULL,
  'pending_approval',
  CASE
    WHEN cr.requested_by = 'Microsoft 365 change routing' THEN 'microsoft'
    WHEN u.msp_role IN ('MSPOperator', 'MSPAdmin', 'PlatformAdmin') THEN 'msp'
    WHEN u.id IS NOT NULL THEN 'customer'
    ELSE 'system'
  END,
  CASE WHEN u.id IS NOT NULL THEN 'u' || u.id::text ELSE NULL END,
  cr.requested_by,
  cr.created_at,
  cr.created_at
FROM msp_change_requests cr
LEFT JOIN users u ON u.email = cr.requested_by
WHERE NOT EXISTS (
  SELECT 1 FROM cr_events e WHERE e.change_request_id = cr.id AND e.event_type = 'raised'
);

-- 2b. One event per already-decided cr_approvals row (#1496's approval ledger —
--     decision values approved/rejected/superseded map 1:1 onto cr_events'
--     vocabulary). approver_role -> actor_role: microsoft_forced -> microsoft
--     (the forcing party is named, same honesty rule cr_approvals itself
--     documents); catalog_inherited -> msp (the human whose catalog approval it
--     inherited, recorded in approver_name); customer/msp pass straight through.
INSERT INTO cr_events (
  change_request_id, msp_id, tenant_id, event_type, from_value, to_value, stage,
  actor_role, actor_person_id, actor_name, reason, occurred_at, created_at
)
SELECT
  a.change_request_id,
  a.msp_id,
  a.tenant_id,
  a.decision,
  'pending',
  a.decision || ' (stage ' || a.stage::text || ')',
  a.stage,
  CASE
    WHEN a.approver_role = 'microsoft_forced' THEN 'microsoft'
    WHEN a.approver_role = 'catalog_inherited' THEN 'msp'
    ELSE a.approver_role
  END,
  a.approver_person_id,
  a.approver_name,
  a.reason,
  COALESCE(a.decided_at, a.updated_at, a.created_at),
  COALESCE(a.decided_at, a.updated_at, a.created_at)
FROM cr_approvals a
WHERE a.decision IN ('approved', 'rejected', 'superseded')
  AND NOT EXISTS (
    SELECT 1 FROM cr_events e
    WHERE e.change_request_id = a.change_request_id
      AND e.event_type = a.decision
      AND e.stage = a.stage
  );

-- 2c. The CR's CURRENT lifecycle state, for any CR that has already moved past
--     `pending_approval`/the approval ledger's own terminal states (scheduled,
--     in_progress, completed, rolled_back — `rejected` is fully covered by 2b
--     for every rejection that went through the approval ledger, and by the
--     direct-decline path below for the one that does not). occurred_at is the
--     CR's own updated_at: the true transition moment was never recorded
--     before this feature existed, and this is the best real evidence there is.
INSERT INTO cr_events (
  change_request_id, msp_id, tenant_id, event_type, from_value, to_value,
  actor_role, actor_name, occurred_at, created_at
)
SELECT
  cr.id, cr.msp_id, cr.tenant_id, cr.status, NULL, cr.status,
  'system', 'Backfilled from msp_change_requests.status at migration time',
  cr.updated_at, cr.updated_at
FROM msp_change_requests cr
WHERE cr.status IN ('scheduled', 'in_progress', 'completed', 'rolled_back')
  AND NOT EXISTS (
    SELECT 1 FROM cr_events e WHERE e.change_request_id = cr.id AND e.event_type = cr.status
  );

-- 2d. `rejected` CRs whose rejection did NOT go through the approval ledger —
--     the direct `/portal/change-control/:code/decline` path
--     (m365-change-router.ts's declineRoutedChangeToRisk) never writes to
--     cr_approvals, only to msp_change_requests.status. Covers exactly the gap
--     2b leaves.
INSERT INTO cr_events (
  change_request_id, msp_id, tenant_id, event_type, from_value, to_value,
  actor_role, actor_name, reason, occurred_at, created_at
)
SELECT
  cr.id, cr.msp_id, cr.tenant_id, 'rejected', NULL, 'rejected',
  'system', COALESCE(cr.approved_by, 'Backfilled from msp_change_requests.status at migration time'),
  cr.approved_by,
  cr.updated_at, cr.updated_at
FROM msp_change_requests cr
WHERE cr.status = 'rejected'
  AND NOT EXISTS (
    SELECT 1 FROM cr_events e WHERE e.change_request_id = cr.id AND e.event_type = 'rejected'
  );

-- Self-mark so Simulator Studio's Migrations tree reflects DB reality (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-29-cr-timeline-1503.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;

-- ─── Verification (run after COMMIT) ────────────────────────────────────────

-- Expect one 'raised' event per existing CR:
-- SELECT count(*) FROM cr_events WHERE event_type = 'raised';
-- SELECT count(*) FROM msp_change_requests;  -- should match

-- Expect cr_comments / cr_attachments to start empty (no backfill source exists for either):
-- SELECT count(*) FROM cr_comments;
-- SELECT count(*) FROM cr_attachments;
