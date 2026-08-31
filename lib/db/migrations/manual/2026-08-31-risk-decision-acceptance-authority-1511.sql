-- Role-based risk-acceptance authority (Git #1511)
--
-- msp_risk_decisions.client_approver stores a person — name, title, email,
-- signedAt, ipAddress, signatureHash. That is EVIDENCE OF WHO SIGNED. It
-- cannot also be what GRANTS the right to sign: people leave and change jobs,
-- and the authority to accept risk must survive them.
--
-- Authority resolves through the Ownership/RACI matrix (#1491): whoever
-- currently holds Accountable (A) on the M365 workload this risk's check_key
-- resolves to (#1523's settled rule — RACI attaches to the service, findings
-- inherit it, risks derive from findings), via lib/tenant-workloads.ts's
-- resolveWorkloadForCheckKey. These four columns record BOTH ends of that
-- resolution — the role/workload that authorised, and the individual who
-- exercised it — alongside (never instead of) client_approver's signature
-- evidence.
--
-- ALL NULLABLE, ALL ADDITIVE. Null across all four means the risk's check_key
-- resolved to no workload (a free-standing liability record, or a
-- cross-cutting check category) — the honest, unresolved case. No backfill:
-- every existing row predates this resolution and stays null.
--
-- Drizzle schema lives in lib/db/src/schema/msp.ts (hand-written; no
-- drizzle-kit push).

BEGIN;

ALTER TABLE msp_risk_decisions
  ADD COLUMN IF NOT EXISTS authorizing_workload_id text,
  ADD COLUMN IF NOT EXISTS authorizing_workload_label text,
  ADD COLUMN IF NOT EXISTS authorizing_holder_person_ids jsonb,
  ADD COLUMN IF NOT EXISTS signed_by_person_id text;

-- Self-marking run record so Simulator Studio's Migrations tree (Git #497)
-- reflects DB reality regardless of which console ran this file.
INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-08-31-risk-decision-acceptance-authority-1511.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();

COMMIT;
