-- Engagement Offer Firings — Delayed Follow-Up dispatch tracking
--
-- Supports two new workflows built on top of the existing Engagement Offer
-- Engine (engagement_offer_rules / engagement_offer_firings, both already
-- live): "Delayed Follow-Up" and "Purchase Cancellation Guard".
--
-- follow_up_dispatched_at — set once a Delayed Follow-Up workflow run has
--   been spawned for this firing. The dispatcher (dispatch_engagement_followups
--   node, polling every 15 min) treats NULL as "not yet dispatched" — this is
--   the idempotency guard so the same firing never spawns two follow-up runs.
--
-- follow_up_run_id — the wf_runs.id of the spawned Delayed Follow-Up run.
--   Lets the Purchase Cancellation Guard workflow cancel the EXACT in-flight
--   run for a lead (by ID, the same mechanism POST /admin/workflows/runs/:id/cancel
--   uses) rather than guessing which run belongs to which lead.
--
-- Safe to run repeatedly (IF NOT EXISTS).

ALTER TABLE engagement_offer_firings
  ADD COLUMN IF NOT EXISTS follow_up_dispatched_at timestamp;

ALTER TABLE engagement_offer_firings
  ADD COLUMN IF NOT EXISTS follow_up_run_id integer REFERENCES wf_runs(id) ON DELETE SET NULL;
