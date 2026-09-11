-- Git #3451 — wire msp_poams into the platform retention lifecycle (EPIC #1944).
--
-- The accelerated-delete review queue (record_deletions.acceleration_state =
-- 'pending', served by GET /api/msp/retention/queue) could never gain a row:
-- the lifecycle mechanism (lib/retention/lifecycle.ts, #1947) was fully built
-- and reachable, but zero modules had registered a record type or called
-- softDelete()/requestAcceleration(). #1944's own body names "POA&M soft
-- delete (#1935) — the trigger" as the expected first real producer.
--
-- This adds the soft-delete triple (the same shape retention.ts's
-- softDeleteColumns() defines — not spread directly here to avoid the
-- msp.ts <-> retention.ts circular schema import that helper would require,
-- see schema/msp.ts's own comment on mspPoamsTable) so a POA&M can actually
-- be soft-deleted through softDelete(), which is what lets record_deletions
-- gain its first real row.

ALTER TABLE msp_poams
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by text,
  ADD COLUMN IF NOT EXISTS delete_reason text;

INSERT INTO simulator_migration_runs (filename, ran_at)
VALUES ('2026-09-11-msp-poams-soft-delete-3451.sql', now())
ON CONFLICT (filename) DO UPDATE SET ran_at = now();
