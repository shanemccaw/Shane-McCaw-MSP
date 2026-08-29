-- #1496 — Change Control approval model + `canApproveChanges` capability flag.
--
-- `msp_change_requests.approved_by` is a single free-text string: it records that
-- ONE party approved and nothing else — no history, no rejection reason, no
-- second approver, no stage, no SLA, no delegated authority. This migration adds:
--   1. `users.can_approve_changes` — the customer-side capability flag for
--      approving/rejecting a change to the live tenant (distinct from
--      can_approve_purchases / can_manage_team; overloading either would grant an
--      authority nobody granted).
--   2. `cr_approvals` — the durable approval ledger, one row per approver decision.
-- Both additive. `msp_change_requests.approved_by` stays as a denormalised display
-- cache of the final decision so the existing displayStatus() derivation keeps
-- working; cr_approvals is the truth behind it.

BEGIN;

-- 1. The customer-side capability flag.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_approve_changes boolean NOT NULL DEFAULT false;

-- 2. The approval ledger.
CREATE TABLE IF NOT EXISTS cr_approvals (
  id                     serial PRIMARY KEY,
  change_request_id      integer NOT NULL REFERENCES msp_change_requests(id) ON DELETE CASCADE,
  msp_id                 integer NOT NULL REFERENCES msps(id) ON DELETE CASCADE,
  tenant_id              text NOT NULL,
  stage                  integer NOT NULL DEFAULT 1,
  decision               text NOT NULL DEFAULT 'pending',   -- pending | approved | rejected | superseded
  approver_role          text NOT NULL,                     -- customer | msp | catalog_inherited | microsoft_forced
  approver_person_id     text,
  approver_name          text,
  on_behalf_of_person_id text,
  reason                 text,
  decided_at             timestamptz,
  due_at                 timestamptz,
  escalated_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cr_approvals_change_request_id_idx ON cr_approvals(change_request_id);
CREATE INDEX IF NOT EXISTS cr_approvals_msp_tenant_idx ON cr_approvals(msp_id, tenant_id);
CREATE INDEX IF NOT EXISTS cr_approvals_pending_due_idx ON cr_approvals(decision, due_at);

-- 3. Backfill: every EXISTING change request gets its real approval record, so the
--    ledger reflects reality rather than starting empty. Faithful to what each row
--    already asserts via approved_by/status:
--      • rejected            → one 'rejected' row (reason = the stored approved_by note)
--      • has an approver      → one 'approved' row (microsoft_forced when the approver
--                               names Microsoft, else msp — the historical approver side)
--      • pending, no approver → one 'pending' customer slot carrying an SLA due date
--    Only CRs with no existing cr_approvals are seeded, so this is safe to re-run.
INSERT INTO cr_approvals (
  change_request_id, msp_id, tenant_id, stage, decision, approver_role,
  approver_person_id, approver_name, reason, decided_at, due_at, created_at, updated_at
)
SELECT
  cr.id,
  cr.msp_id,
  cr.tenant_id,
  1,
  CASE
    WHEN cr.status = 'rejected' THEN 'rejected'
    WHEN cr.approved_by IS NOT NULL AND btrim(cr.approved_by) <> '' THEN 'approved'
    ELSE 'pending'
  END,
  CASE
    WHEN cr.approved_by IS NOT NULL AND cr.approved_by LIKE 'Microsoft%' THEN 'microsoft_forced'
    WHEN cr.status = 'rejected' OR (cr.approved_by IS NOT NULL AND btrim(cr.approved_by) <> '') THEN 'msp'
    ELSE 'customer'
  END,
  NULL,
  CASE WHEN cr.approved_by IS NOT NULL AND btrim(cr.approved_by) <> '' THEN cr.approved_by ELSE NULL END,
  CASE WHEN cr.status = 'rejected' THEN cr.approved_by ELSE NULL END,
  CASE
    WHEN cr.status = 'rejected' OR (cr.approved_by IS NOT NULL AND btrim(cr.approved_by) <> '') THEN cr.updated_at
    ELSE NULL
  END,
  -- SLA due date only for a still-pending, unapproved slot: created_at + N days by risk/class.
  CASE
    WHEN cr.status <> 'rejected' AND (cr.approved_by IS NULL OR btrim(cr.approved_by) = '') THEN
      cr.created_at + CASE
        WHEN cr.change_class = 'emergency' THEN interval '1 day'
        WHEN cr.risk_level = 'critical'   THEN interval '1 day'
        WHEN cr.risk_level = 'high'       THEN interval '2 days'
        WHEN cr.risk_level = 'medium'     THEN interval '5 days'
        ELSE interval '7 days'
      END
    ELSE NULL
  END,
  cr.created_at,
  now()
FROM msp_change_requests cr
WHERE NOT EXISTS (SELECT 1 FROM cr_approvals a WHERE a.change_request_id = cr.id);

-- Self-mark so Simulator Studio's Migrations tree reflects DB reality (Git #497).
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-29-cr-approvals-model-1496.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
